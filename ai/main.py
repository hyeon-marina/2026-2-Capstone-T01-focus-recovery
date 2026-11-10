"""
AI 분석 서버 (AI-API-01: POST /api/ai/analyses)

BE(AiAnalysisClient)와의 계약:
- 요청: analysisId, sessionId, windowId, windowIndex, goalText, visits[5] (position 1~5)
- 성공(200): 요청 식별자 3개 + result, pNormal/pTransition/pDrift, contextUsed, contextResult,
  featureSnapshot, modelVersions, analyzedAt (UTC, 밀리초)
- 실패: {"code", "message", "fieldErrors"}
  INVALID_REQUEST(422) / ANALYSIS_ID_CONFLICT(409) / ANALYSIS_IN_PROGRESS(409) / AI_ANALYSIS_FAILED(500) / AI_NOT_READY(503)
분석 실패는 정상 결과(NORMAL 등)로 대체하지 않고 오류 코드로 응답한다.
"""
from __future__ import annotations

import hashlib
import json
import threading
from collections import OrderedDict
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import TYPE_CHECKING, List, Optional
from uuid import UUID

import uvicorn
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError
from starlette.concurrency import run_in_threadpool

from v2.contracts import V2Error, strict_json, validator as contract_validator
from v2.service import V2Service
from v2.authorization import require_service

if TYPE_CHECKING:
    from pipeline import FocusRecoveryPipeline

WINDOW_SIZE = 5  # Legacy v1 contract, independent from v2 composition size3.

MAX_REMEMBERED_ANALYSES = 1000  # analysisId 중복 판단용으로 기억하는 최근 분석 수


# ---------------------------------------------------------------------- 요청 스키마 (BE AiAnalysisRequest)
class VisitRequest(BaseModel):
    position: int
    visitId: UUID
    sequence: int
    browserTabKey: Optional[str] = None
    normalizedUrl: Optional[str] = None
    domain: Optional[str] = None
    title: str
    content: str
    searchQuery: Optional[str] = None
    isSearchResultPage: bool = False
    visitedAt: Optional[str] = None
    activeDurationMs: Optional[int] = None
    tabSwitchCount: Optional[int] = None
    behaviorVersion: Optional[int] = None


class AnalysisRequest(BaseModel):
    analysisId: UUID
    sessionId: UUID
    windowId: UUID
    windowIndex: int
    goalText: str
    visits: List[VisitRequest]


# ---------------------------------------------------------------------- 오류 응답
class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, field_errors: Optional[list] = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.field_errors = field_errors or []


def error_response(status: int, code: str, message: str, field_errors: Optional[list] = None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "message": message, "fieldErrors": field_errors or []})


# ---------------------------------------------------------------------- 모델 로드 상태
class ModelState:
    """서버는 바로 요청을 받고, 모델 로드가 끝나기 전 요청에는 AI_NOT_READY로 응답한다."""

    def __init__(self):
        self.pipeline: Optional[FocusRecoveryPipeline] = None
        self.load_error: Optional[str] = None
        # 모델 추론은 스레드 안전을 보장하지 않으므로 한 번에 하나씩 실행한다.
        self.inference_lock = threading.Lock()

    def load(self) -> None:
        try:
            from pipeline import FocusRecoveryPipeline

            pipeline = FocusRecoveryPipeline.from_default()
            # 첫 요청의 초기화 지연을 없애기 위해 READY 전에 한 번 추론한다.
            pipeline.embedding_model.warm_up()
            if pipeline.context_model is not None:
                pipeline.context_model.warm_up()
            self.pipeline = pipeline
        except Exception:  # 로드 실패 시 서버는 떠 있되 AI_NOT_READY로 응답한다
            self.load_error = "모델을 준비할 수 없습니다."
            print("[API] AI_NOT_READY")


class AnalysisRegistry:
    """
    analysisId별 요청 내용과 처리 상태를 기억한다. (메모리 보관, 서버 재시작 시 초기화)
    - 같은 analysisId + 다른 요청 내용: ANALYSIS_ID_CONFLICT
    - 같은 analysisId + 같은 요청 내용, 처리 중: ANALYSIS_IN_PROGRESS
    - 같은 analysisId + 같은 요청 내용, 완료: 저장된 응답을 그대로 반환
    - 실패한 분석은 기록을 지워 같은 analysisId로 다시 요청할 수 있게 한다.
    """

    def __init__(self, capacity: int):
        self.capacity = capacity
        self.entries: "OrderedDict[UUID, dict]" = OrderedDict()
        self.lock = threading.Lock()

    def begin(self, analysis_id: UUID, fingerprint: str) -> Optional[dict]:
        """처리를 시작한다. 이미 완료된 같은 요청이면 저장된 응답을 반환한다."""
        with self.lock:
            entry = self.entries.get(analysis_id)
            if entry is not None:
                if entry["fingerprint"] != fingerprint:
                    raise ApiError(409, "ANALYSIS_ID_CONFLICT", "같은 analysisId로 다른 내용의 분석 요청이 들어왔습니다.")
                if entry["response"] is None:
                    raise ApiError(409, "ANALYSIS_IN_PROGRESS", "같은 analysisId의 분석이 처리 중입니다.")
                self.entries.move_to_end(analysis_id)
                return entry["response"]
            self.entries[analysis_id] = {"fingerprint": fingerprint, "response": None}
            self._evict()
            return None

    def complete(self, analysis_id: UUID, response: dict) -> None:
        with self.lock:
            if analysis_id in self.entries:
                self.entries[analysis_id]["response"] = response

    def discard(self, analysis_id: UUID) -> None:
        with self.lock:
            self.entries.pop(analysis_id, None)

    def _evict(self) -> None:
        # 처리 중인 항목은 지우지 않고, 완료된 오래된 항목부터 지운다.
        for key in list(self.entries):
            if len(self.entries) <= self.capacity:
                break
            if self.entries[key]["response"] is not None:
                del self.entries[key]


state = ModelState()
registry = AnalysisRegistry(MAX_REMEMBERED_ANALYSES)
v2_service = V2Service(state.inference_lock)


def load_models():
    state.load()
    v2_service.load(state)  # v2 can load even if the legacy classifier is absent.


@asynccontextmanager
async def lifespan(app: FastAPI):
    threading.Thread(target=load_models, name="model-loader", daemon=True).start()
    yield


app = FastAPI(title="Focus Recovery AI Analysis API", lifespan=lifespan)


@app.exception_handler(ApiError)
async def handle_api_error(request: Request, exc: ApiError):
    return error_response(exc.status, exc.code, exc.message, exc.field_errors)


@app.exception_handler(RequestValidationError)
async def handle_validation_error(request: Request, exc: RequestValidationError):
    field_errors = [
        {"field": ".".join(str(part) for part in err["loc"] if part != "body"), "message": err["msg"]}
        for err in exc.errors()
    ]
    return error_response(422, "INVALID_REQUEST", "요청 형식이 올바르지 않습니다.", field_errors)


@app.exception_handler(Exception)
async def handle_unexpected_error(request: Request, exc: Exception):
    return error_response(500, "AI_ANALYSIS_FAILED", "분석을 완료할 수 없습니다.")


# ---------------------------------------------------------------------- 처리
def validate_request(request: AnalysisRequest) -> List[VisitRequest]:
    """방문 5개와 position 1~5를 검증하고 position 순서로 정렬해 반환한다."""
    field_errors = []
    if not request.goalText.strip():
        field_errors.append({"field": "goalText", "message": "최초 작업 목표가 비어 있습니다."})
    if len(request.visits) != WINDOW_SIZE:
        field_errors.append({"field": "visits", "message": f"방문은 정확히 {WINDOW_SIZE}개여야 합니다. (입력: {len(request.visits)}개)"})
    elif sorted(v.position for v in request.visits) != list(range(1, WINDOW_SIZE + 1)):
        field_errors.append({"field": "visits.position", "message": f"position은 1~{WINDOW_SIZE}가 한 번씩 있어야 합니다."})
    for i, visit in enumerate(request.visits):
        if not visit.title.strip() and not visit.content.strip():
            field_errors.append({"field": f"visits.{i}", "message": "제목과 본문이 모두 비어 있습니다."})
    if field_errors:
        raise ApiError(422, "INVALID_REQUEST", "요청 값이 올바르지 않습니다.", field_errors)
    return sorted(request.visits, key=lambda v: v.position)


def fingerprint_of(request: AnalysisRequest) -> str:
    canonical = json.dumps(request.model_dump(mode="json"), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def utc_now_millis() -> str:
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def normalized_probabilities(probabilities: dict) -> tuple:
    """BE는 세 확률의 합이 1(허용 오차 0.001)인지 검사하므로 합이 정확히 1이 되도록 정규화한다."""
    values = [probabilities["P_NORMAL"], probabilities["P_TRANSITION"], probabilities["P_DRIFT"]]
    total = sum(values)
    if not total > 0:
        raise RuntimeError("[API] 분류 확률의 합이 0입니다.")
    return tuple(v / total for v in values)


def model_versions(pipeline: FocusRecoveryPipeline) -> dict:
    classifier = pipeline.classifier
    trained_at = classifier.metadata.get("trainedAt", "unknown")
    versions = {
        "embedding": pipeline.embedding_model.model_name,
        "classifier": f"{classifier.model_type}@{trained_at}",
    }
    if pipeline.context_model is not None:
        versions["context"] = pipeline.context_model.config.version
    return versions


def feature_snapshot(pipeline: FocusRecoveryPipeline, features: List[float], relevances: List[float]) -> dict:
    names = pipeline.classifier.metadata.get("featureNames") or []
    if len(names) != len(features):
        names = [f"f{i}" for i in range(len(features))]
    return {"features": dict(zip(names, features)), "semanticRelevances": relevances}


def run_analysis(pipeline: FocusRecoveryPipeline, request: AnalysisRequest, visits: List[VisitRequest]) -> dict:
    from models.context import PageVisit

    page_visits = [PageVisit(title=v.title, content=v.content) for v in visits]
    behavior = None
    if pipeline.classifier.use_behavior:
        from pipeline import aggregate_behavior

        behavior = aggregate_behavior([v.activeDurationMs for v in visits], [v.tabSwitchCount for v in visits])
        if behavior is None:
            raise ApiError(422, "INVALID_REQUEST", "행동 특징을 사용하는 모델이지만 행동 측정값이 없는 방문이 있습니다.")

    try:
        with state.inference_lock:
            result = pipeline.analyze(request.goalText, page_visits, behavior)
    except ValueError:
        raise ApiError(422, "INVALID_REQUEST", "분석 입력을 처리할 수 없습니다.") from None
    except Exception:  # ContextAnalysisError 등 분석 실패
        raise ApiError(500, "AI_ANALYSIS_FAILED", "분석을 완료할 수 없습니다.") from None

    p_normal, p_transition, p_drift = normalized_probabilities(result.probabilities)
    return {
        "analysisId": str(request.analysisId),
        "sessionId": str(request.sessionId),
        "windowId": str(request.windowId),
        "result": result.result,
        "pNormal": p_normal,
        "pTransition": p_transition,
        "pDrift": p_drift,
        "contextUsed": result.context is not None,
        "contextResult": result.context.to_dict() if result.context is not None else None,
        "featureSnapshot": feature_snapshot(pipeline, result.features, result.semantic_relevances),
        "modelVersions": model_versions(pipeline),
        "analyzedAt": utc_now_millis(),
    }


# ---------------------------------------------------------------------- 엔드포인트
@app.get("/health")
def health():
    """모델 로드 상태 확인용 (Docker healthcheck 등)."""
    if state.pipeline is not None:
        return {"status": "READY"}
    status = 503
    message = state.load_error or "모델을 로드하는 중입니다."
    return error_response(status, "AI_NOT_READY", message)


def analyze(request: AnalysisRequest):
    """
    최초 목표와 최근 5개 방문을 분석하여 탐색 상태(NORMAL, TRANSITION, DRIFT)를 반환합니다.
    분석 실패는 정상 결과로 대체하지 않고 오류로 응답합니다.
    """
    pipeline = state.pipeline
    if pipeline is None:
        raise ApiError(503, "AI_NOT_READY", state.load_error or "모델을 로드하는 중입니다.")

    visits = validate_request(request)
    cached = registry.begin(request.analysisId, fingerprint_of(request))
    if cached is not None:
        return cached

    try:
        response = run_analysis(pipeline, request, visits)
    except BaseException:
        registry.discard(request.analysisId)
        raise
    registry.complete(request.analysisId, response)
    return response


async def read_body(request: Request, *, composition=False):
    raw = await request.body()
    try:
        body = json.loads(raw)
        if composition or (isinstance(body, dict) and "apiContractVersion" in body):
            return strict_json(raw)
        return body  # Preserve the legacy JSON parser for unversioned v1.
    except (ValueError, UnicodeError, RecursionError):
        # A malformed versioned payload must never enter the legacy analyzer.
        if composition or b'apiContractVersion' in raw:
            raise V2Error() from None
        raise ApiError(422, "INVALID_REQUEST", "요청 형식이 올바르지 않습니다.") from None


def execute_v2(kind, payload):
    try:
        return v2_service.execute(kind, payload)
    except V2Error as exc:
        return JSONResponse(status_code=exc.status, content=exc.body())
    except Exception:
        # No traceback or exception text containing model/request data.
        exc = V2Error(500, "AI_COMPOSITION_FAILED" if kind == "compose" else "AI_ANALYSIS_FAILED")
        return JSONResponse(status_code=exc.status, content=exc.body())


@app.exception_handler(V2Error)
async def handle_v2_error(request: Request, exc: V2Error):
    return JSONResponse(status_code=exc.status, content=exc.body())


@app.post("/api/ai/window-compositions")
async def window_compositions(request: Request):
    require_service(request)
    return await run_in_threadpool(execute_v2, "compose", await read_body(request, composition=True))


@app.post("/api/ai/analyses")
async def versioned_analysis(request: Request):
    body = await read_body(request)
    if isinstance(body, dict) and "apiContractVersion" in body:
        if type(body["apiContractVersion"]) in (int, float) and body["apiContractVersion"] == 1:
            pass
        else:
            require_service(request)
            return await run_in_threadpool(execute_v2, "analysis", body)
    try:
        legacy = AnalysisRequest.model_validate(body)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors()) from None
    return await run_in_threadpool(analyze, legacy)


def api_openapi():
    """Keep legacy DTO documentation and expose v2 from the same shared Schema."""
    from fastapi.openapi.utils import get_openapi
    if app.openapi_schema:
        return app.openapi_schema
    document = get_openapi(title=app.title, version=app.version, routes=app.routes)
    components = document.setdefault("components", {}).setdefault("schemas", {})
    legacy = AnalysisRequest.model_json_schema(ref_template="#/components/schemas/{model}")
    legacy["properties"]["apiContractVersion"] = {"const": 1}
    components.update(legacy.pop("$defs", {}))
    components["AnalysisRequest"] = legacy
    analysis = document["paths"]["/api/ai/analyses"]["post"]
    alternatives = [{"$ref": "#/components/schemas/AnalysisRequest"}]
    analysis["requestBody"] = {"required": True, "content": {"application/json": {"schema": {"oneOf": alternatives}}}}
    try:
        definitions = contract_validator("AnalysisRequest").schema["$defs"]
    except V2Error:
        # A standalone legacy image without the shared file still documents v1.
        app.openapi_schema = document
        return document

    def refs(value):
        if isinstance(value, list):
            return [refs(v) for v in value]
        if isinstance(value, dict):
            return {k: (v.replace("#/$defs/", "#/components/schemas/V2") if k == "$ref"
                        else refs(v)) for k, v in value.items()}
        return value

    components.update({"V2" + k: refs(v) for k, v in definitions.items()})
    alternatives.append({"$ref": "#/components/schemas/V2AnalysisRequest"})
    composition = document["paths"]["/api/ai/window-compositions"]["post"]
    composition["description"] = "합성 테스트 전용 v2. 정책 승인·운영 활성화 아님."
    composition["requestBody"] = {"required": True, "content": {"application/json": {
        "schema": {"$ref": "#/components/schemas/V2CompositionRequest"}}}}
    composition["responses"]["200"]["content"] = {"application/json": {
        "schema": {"$ref": "#/components/schemas/V2CompositionResponse"}}}
    analysis["responses"]["200"]["content"] = {"application/json": {"schema": {"anyOf": [
        {"$ref": "#/components/schemas/V2AnalysisResponse"}, {"type": "object", "description": "기존 v1 확률 응답"}]}}}
    for status in (422, 409, 500, 503):
        composition["responses"][str(status)] = {"description": "v2 failure", "content": {
            "application/json": {"schema": {"$ref": "#/components/schemas/V2FailureResponse"}}}}
        analysis["responses"][str(status)] = {"description": "v1 또는 v2 failure", "content": {
            "application/json": {"schema": {"anyOf": [
                {"$ref": "#/components/schemas/V2FailureResponse"},
                {"type": "object", "required": ["code", "message", "fieldErrors"],
                 "properties": {"code": {"type": "string"}, "message": {"type": "string"},
                                "fieldErrors": {"type": "array"}}, "additionalProperties": False}]}}}}
    app.openapi_schema = document
    return document


app.openapi = api_openapi


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

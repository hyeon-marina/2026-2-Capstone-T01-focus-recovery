import json
import threading
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from types import SimpleNamespace

import pytest

import main
from conftest import analysis_request, composition_request, signed
from test_v2_api import ANALYZE, COMPOSE, failure
from v2.contracts import V2Error
from v2.service import V2Service


def test_quarantine_precedes_receipts_and_rejects_late_result(client, monkeypatch):
    http, service = client
    body = analysis_request()
    assert http.post(ANALYZE, json=body).status_code == 200
    assert http.post(COMPOSE, json=composition_request()).status_code == 200
    service.invalidate_visits([body["visits"][0]["visitId"]])
    assert not service.analyses.entries and not service.compositions.entries
    failure(http.post(ANALYZE, json=body), 409, "PRIVACY_RETRACTED")
    failure(http.post(COMPOSE, json=composition_request()), 409, "PRIVACY_RETRACTED")


def test_inflight_quarantine_generation_barrier(client, monkeypatch):
    http, service = client
    body = analysis_request()
    started, release = threading.Event(), threading.Event()
    original = service.model.analyze
    def slow(*args):
        started.set()
        assert release.wait(5)
        return original(*args)
    monkeypatch.setattr(service.model, "analyze", slow)
    with ThreadPoolExecutor() as pool:
        pending = pool.submit(http.post, ANALYZE, json=body)
        try:
            assert started.wait(5)
            service.invalidate_visits([body["visits"][0]["visitId"]])
        finally:
            release.set()
        failure(pending.result(timeout=5), 409, "PRIVACY_RETRACTED")
    assert not service.analyses.entries
    assert service.model.embedding.cache_generation == 1
    assert all(kw["cache_generation"] == 0 for _, kw in service.model.embedding.calls)


def test_eviction_running_capacity_failed_binding_and_restart(client):
    _, service = client
    fresh = V2Service(capacity=1)
    first = composition_request()
    first_result = fresh.execute("compose", first)
    second = composition_request(4)
    second["composeRequestId"] = "00000000-0000-4000-8000-000000009999"
    fresh.execute("compose", signed(second))
    assert first["composeRequestId"] not in fresh.compositions.entries
    assert fresh.execute("compose", first) == first_result
    fresh.compositions.entries[first["composeRequestId"]]["running"] = True
    with pytest.raises(V2Error) as error:
        fresh.execute("compose", second)
    assert error.value.code == "AI_NOT_READY"
    fresh.invalidate_visits([first["visits"][0]["visitId"]])
    # New process loses both receipts AND quarantine: BE must replay privacy gate.
    restarted = V2Service(capacity=1)
    altered = deepcopy(first)
    altered["sessionId"] = second["composeRequestId"]
    assert restarted.execute("compose", signed(altered))["windows"]


def legacy_body():
    v2 = analysis_request()
    v1 = {k: v for k, v in v2.items() if k not in ("apiContractVersion", "inputFingerprint")}
    v1["visits"] = []
    for i in range(1, 6):
        visit = deepcopy(v2["visits"][0])
        visit.update(position=i, visitId=f"00000000-0000-4000-8000-{i:012d}", sequence=i,
                     browserTabKey="tab-synthetic", normalizedUrl="https://example.invalid/article",
                     domain="example.invalid", activeDurationMs=5000, tabSwitchCount=1, behaviorVersion=1)
        v1["visits"].append(visit)
    return v1


def legacy_pipeline():
    calls = []
    def analyze(goal, visits, behavior):
        calls.append((goal, visits, behavior))
        return SimpleNamespace(probabilities={"P_NORMAL": 0.6, "P_TRANSITION": 0.3, "P_DRIFT": 0.1},
                               result="NORMAL", context=None, features=[0.7], semantic_relevances=[0.7] * 5)
    pipeline = SimpleNamespace(
        classifier=SimpleNamespace(use_behavior=False, model_type="xgboost", metadata={"trainedAt": "synthetic-test"}),
        embedding_model=SimpleNamespace(model_name="synthetic-v1-embedding"), context_model=None, analyze=analyze)
    return pipeline, calls


def test_v1_be_ai_analysis_client_wire_compatibility(client, monkeypatch):
    http, service = client
    pipeline, calls = legacy_pipeline()
    monkeypatch.setattr(main.state, "pipeline", pipeline)
    body = legacy_body()
    response = http.post(ANALYZE, json=body)
    assert response.status_code == 200, response.text
    result = response.json()
    assert set(result) == {"analysisId", "sessionId", "windowId", "result", "pNormal", "pTransition",
                           "pDrift", "contextUsed", "contextResult", "featureSnapshot", "modelVersions", "analyzedAt"}
    # Mirrors the unchanged BE AiAnalysisClient.validate checks, not model accuracy.
    for key in ("analysisId", "sessionId", "windowId"): assert result[key] == body[key]
    assert result["result"] in ("NORMAL", "TRANSITION", "DRIFT")
    assert abs(sum(result[k] for k in ("pNormal", "pTransition", "pDrift")) - 1) < 0.001
    assert result["contextUsed"] is False and result["contextResult"] is None
    assert len(calls[0][1]) == 5
    assert http.post(ANALYZE, json=body).json() == result
    assert len(calls) == 1 and not service.analyses.entries
    # Same UUID may occur in different contract versions, with separate registries.
    assert http.post(ANALYZE, json=analysis_request()).status_code == 200
    body["apiContractVersion"] = 1
    assert http.post(ANALYZE, json=body).json() == result


def test_v1_lax_rules_and_position_sort_preserved(client, monkeypatch):
    pipeline, calls = legacy_pipeline()
    monkeypatch.setattr(main.state, "pipeline", pipeline)
    body = legacy_body()
    body["visits"].reverse()
    body["visits"][0].update(searchQuery="legacy-search-not-used", visitedAt=None, content="x")
    assert client[0].post(ANALYZE, json=body).status_code == 200
    assert calls[0][1][-1].content == "x"
    assert not hasattr(calls[0][1][-1], "searchQuery")
    body["analysisId"] = "00000000-0000-4000-8000-000000009999"
    raw = '{"goalText":"earlier legacy value",' + json.dumps(body)[1:]
    assert client[0].post(ANALYZE, content=raw, headers={"Content-Type": "application/json"}).status_code == 200
    assert calls[-1][0] == body["goalText"]


def test_v1_error_contract_and_no_v2_fallback(client, monkeypatch):
    http, service = client
    body = legacy_body()
    not_ready = http.post(ANALYZE, json=body)
    assert not_ready.status_code == 503 and set(not_ready.json()) == {"code", "message", "fieldErrors"}
    pipeline, calls = legacy_pipeline()
    monkeypatch.setattr(main.state, "pipeline", pipeline)
    invalid = deepcopy(body)
    invalid["visits"] = invalid["visits"][:3]
    response = http.post(ANALYZE, json=invalid)
    assert response.status_code == 422 and "apiContractVersion" not in response.json()
    invalid["analysisId"] = "bad-id"
    assert http.post(ANALYZE, json=invalid).status_code == 422
    service.model.context.outputs = [RuntimeError("synthetic inference failure")]
    failure(http.post(ANALYZE, json=analysis_request()), 500, "AI_ANALYSIS_FAILED")
    assert calls == []


def test_v1_load_error_state_preserved(monkeypatch, capsys):
    import sys
    def fail(): raise RuntimeError("synthetic loading failure")
    monkeypatch.setitem(sys.modules, "pipeline", SimpleNamespace(
        FocusRecoveryPipeline=SimpleNamespace(from_default=fail)))
    state = main.ModelState()
    state.load()
    assert state.pipeline is None and state.load_error
    captured = capsys.readouterr()
    assert "synthetic loading failure" not in captured.out + captured.err + state.load_error


def test_v2_load_does_not_require_legacy_classifier(client, monkeypatch):
    from models.context import LocalContextModel
    from models.embedding import LocalSemanticEmbeddingModel
    from conftest import FakeContext, FakeEmbedding
    def embedding_init(self): self.model_name = "mock"; self._cache_generation = 0
    monkeypatch.setattr(LocalSemanticEmbeddingModel, "__init__", embedding_init)
    monkeypatch.setattr(LocalSemanticEmbeddingModel, "warm_up", lambda self: None)
    monkeypatch.setattr(LocalContextModel, "__init__", lambda self: None)
    monkeypatch.setattr(LocalContextModel, "_generate", lambda *a, **kw: "{}")
    service = V2Service()
    service.load(SimpleNamespace(pipeline=None))
    assert service.model is not None


def test_registry_identity_lost_across_real_python_processes():
    import os
    import subprocess
    import sys
    from conftest import AI_DIR
    environment = {**os.environ, "PYTHONPATH": str(AI_DIR),
                   "AI_V2_ENABLED": "1", "AI_V2_PROFILE": "synthetic-test"}
    script = ("import json,sys; from v2.service import V2Service; "
              "print(json.dumps(V2Service().execute('compose',json.load(sys.stdin))))")
    body = composition_request()
    def execute(value):
        result = subprocess.run([sys.executable, "-c", script], input=json.dumps(value),
                                text=True, capture_output=True, check=True, env=environment, timeout=10)
        return json.loads(result.stdout)
    assert execute(body)["sessionId"] == body["sessionId"]
    body["sessionId"] = "00000000-0000-4000-8000-000000009999"
    # Same ID + different body is accepted by a new process: NOT persistent idempotency.
    assert execute(signed(body))["sessionId"] == body["sessionId"]


def test_v1_inference_error_envelope_stays_private(client, monkeypatch, capsys):
    pipeline, _ = legacy_pipeline()
    def fail(*args): raise RuntimeError("SENSITIVE_V1_BODY")
    pipeline.analyze = fail
    monkeypatch.setattr(main.state, "pipeline", pipeline)
    response = client[0].post(ANALYZE, json=legacy_body())
    assert response.status_code == 500 and response.json()["code"] == "AI_ANALYSIS_FAILED"
    assert set(response.json()) == {"code", "message", "fieldErrors"}
    captured = capsys.readouterr()
    assert "SENSITIVE_V1_BODY" not in response.text + captured.out + captured.err

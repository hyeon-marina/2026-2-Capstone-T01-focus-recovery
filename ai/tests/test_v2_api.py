import json
import threading
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy

import pytest

from conftest import CASES, SCENARIOS, analysis_request, composition_request, signed
from v2.contracts import V2Error, check, fingerprint, request_dto

COMPOSE = "/api/ai/window-compositions"
ANALYZE = "/api/ai/analyses"


def failure(response, status, code):
    assert response.status_code == status, response.text
    data = response.json()
    check("FailureResponse", data)
    assert data["code"] == code
    assert "pageResults" not in data and "result" not in data
    return data


@pytest.mark.parametrize("n", [1, 2, 3, 4, 5, 256])
def test_composition_sizes(client, n):
    http, _ = client
    body = composition_request(n)
    response = http.post(COMPOSE, json=body)
    assert response.status_code == 200
    data = check("CompositionResponse", response.json())
    assert len(data["windows"]) == max(0, n - 2)
    assert data["composedThroughSequence"] == n
    for i, window in enumerate(data["windows"]):
        assert window["visitIds"] == [v["visitId"] for v in body["visits"][i:i + 3]]
        assert window["endVisitId"] == window["visitIds"][-1]


@pytest.mark.parametrize("sequences,after,expected", [
    ([1, 3, 4, 6], 0, 2), ([1, 3, 4], 0, 1), ([3, 4, 6], 4, 1),
    ([9, 15], 9, 0), ([1, 3], 1, 0), ([1, 3, 4, 6, 8], 3, 3)])
def test_sparse_tail(client, sequences, after, expected):
    response = client[0].post(COMPOSE, json=composition_request(after=after, sequences=sequences))
    assert response.status_code == 200
    assert len(response.json()["windows"]) == expected
    assert response.json()["composedThroughSequence"] == sequences[-1]


@pytest.mark.parametrize("sequences,after", [([3, 2, 4], 0), ([1, 1, 4], 0),
    ([1, 3, 4], 2), ([1, 3, 4], 4), ([3, 4], 2), ([1, 2, 3, 4], 3)])
def test_cursor_and_order_rejected(client, sequences, after):
    failure(client[0].post(COMPOSE, json=composition_request(after=after, sequences=sequences)),
            422, "INVALID_REQUEST")


@pytest.mark.parametrize("mutation", ["version", "uuid", "duplicate", "extra", "empty", "257", "hash"])
def test_bad_composition(client, mutation):
    body = composition_request(257 if mutation == "257" else 3)
    if mutation == "version": body["apiContractVersion"] = 3
    if mutation == "uuid": body["sessionId"] = "bad-uuid"
    if mutation == "duplicate": body["visits"][1]["visitId"] = body["visits"][0]["visitId"]
    if mutation == "extra": body["visits"][0]["content"] = "sensitive-content"
    if mutation == "empty": body["visits"] = []
    signed(body)
    if mutation == "hash": body["inputFingerprint"] = "0" * 64
    failure(client[0].post(COMPOSE, json=body), 422, "INVALID_REQUEST")


def test_batch_boundary(client):
    http, _ = client
    first = composition_request(256)
    assert len(http.post(COMPOSE, json=first).json()["windows"]) == 254
    second = composition_request(sequences=[255, 256, 257, 259], after=256)
    second["composeRequestId"] = "00000000-0000-4000-8000-000000009999"
    # Keep tail UUIDs, not newly invented IDs for repeated visits.
    second["visits"][:2] = first["visits"][-2:]
    signed(second)
    response = http.post(COMPOSE, json=second)
    assert response.status_code == 200
    assert len(response.json()["windows"]) == 2
    assert response.json()["composedThroughSequence"] == 259


@pytest.mark.parametrize("name", ["omitted-visit", "missing-tail"])
def test_db_omission_belongs_to_be(client, name):
    case = next(c for c in SCENARIOS if c["name"] == name)
    # Stored prefix/tail facts are NOT present on the AI wire.
    assert client[0].post(COMPOSE, json=case["input"]["request"]).status_code == 200
    assert case["expected"]["error"] == "COMPOSE_INPUT_MISMATCH"


@pytest.mark.parametrize("kind", ["compose", "analysis"])
def test_replay_conflict_and_running(client, kind):
    http, service = client
    url, body = (COMPOSE, composition_request()) if kind == "compose" else (ANALYZE, analysis_request())
    response = http.post(url, json=body)
    assert response.status_code == 200
    assert http.post(url, json=body).json() == response.json()
    altered = deepcopy(body)
    altered["sessionId"] = "00000000-0000-4000-8000-000000009999"
    failure(http.post(url, json=signed(altered)), 409, kind.upper() + "_ID_CONFLICT")
    registry = service.compositions if kind == "compose" else service.analyses
    key = body["composeRequestId" if kind == "compose" else "analysisId"]
    registry.entries[key]["running"] = True
    failure(http.post(url, json=body), 409, kind.upper() + "_IN_PROGRESS")


def test_analysis_success_uses_real_orchestrator_with_mock_models(client):
    http, service = client
    body = analysis_request()
    body["visits"][1].update(isSearchResultPage=True, searchQuery="synthetic prerequisite query",
                              title="search title", content="synthetic organic result")
    response = http.post(ANALYZE, json=signed(body))
    assert response.status_code == 200, response.text
    data = check("AnalysisResponse", response.json())
    assert [p["label"] for p in data["pageResults"]] == ["DIRECT", "JUSTIFIED_DETOUR", "UNRELATED"]
    assert data["inputFingerprint"] == body["inputFingerprint"]
    assert data["modelVersions"]["context"] == "synthetic-context-mock"
    calls = service.model.embedding.calls
    assert [call[0][3] for call in calls] == [None, "synthetic prerequisite query", None]
    prompt = json.loads(service.model.context.calls[0][0])
    assert prompt["originalGoal"] == body["goalText"]
    assert prompt["visits"][1]["content"] == "synthetic organic result"
    assert prompt["visits"][1]["searchQuery"] == body["visits"][1]["searchQuery"]
    assert prompt["visits"][0]["searchQuery"] is None
    assert not any(k in data for k in ("result", "stateVersion", "pNormal"))


@pytest.mark.parametrize("path,value", [
    (("visits",), []), (("visits",), [{}, {}]),
    (("apiContractVersion",), "2"), (("apiContractVersion",), None), (("apiContractVersion",), 3),
    (("analysisId",), "bad"), (("sessionId",), "00000000-0000-1000-8000-000000000001"),
    (("goalText",), "x"), (("goalText",), " " * 5), (("goalText",), "a" * 151),
    (("windowIndex",), True), (("windowIndex",), 0), (("windowIndex",), 2147483648),
    (("visits", 0, "position"), 2), (("visits", 0, "position"), "1"),
    (("visits", 0, "sequence"), 0), (("visits", 1, "sequence"), 1),
    (("visits", 0, "title"), "x" * 501), (("visits", 0, "content"), "x" * 49),
    (("visits", 0, "content"), "x" * 5001), (("visits", 0, "content"), " " * 50),
    (("visits", 0, "content"), None), (("visits", 0, "searchQuery"), "not-null"),
    (("visits", 0, "isSearchResultPage"), True),
    (("visits", 0, "visitedAt"), "2026-11-10T00:00:00Z"),
    (("visits", 0, "visitedAt"), "2026-11-10T00:00:00.000+00:00"),
    (("visits", 0, "visitedAt"), "2026-02-30T00:00:00.000Z"),
    (("visits", 0, "visitedAt"), "2026-11-10T00:00:00.0000Z"),
    (("visits", 0, "visitedAt"), "2026-11-10T00:00:00.000Z\n"),
    (("visits", 0, "activeDurationMs"), 5000), (("participantId",), "private-person"),
    (("humanLabel",), "DIRECT"), (("split",), "test")])
def test_analysis_invalid(client, path, value):
    body = analysis_request()
    target = body
    for part in path[:-1]: target = target[part]
    target[path[-1]] = value
    failure(client[0].post(ANALYZE, json=signed(body)), 422, "INVALID_REQUEST")


def test_analysis_count_duplicates_hash_and_missing(client):
    http, service = client
    original = analysis_request()
    bad = []
    for n in [2, 4]:
        body = deepcopy(original)
        body["visits"] = (body["visits"] * 2)[:n]
        bad.append(signed(body))
    body = deepcopy(original)
    body["visits"][1]["visitId"] = body["visits"][0]["visitId"]
    bad.append(signed(body))
    body = deepcopy(original)
    body["inputFingerprint"] = "f" * 64
    bad.append(body)
    for key in original:
        body = deepcopy(original)
        del body[key]
        if key != "apiContractVersion": bad.append(body)
    for body in bad:
        failure(http.post(ANALYZE, json=body), 422, "INVALID_REQUEST")
    assert not service.model.embedding.calls


@pytest.mark.parametrize("profile,enabled", [(None, None), ("prod", "1"),
    ("test", "1"), ("synthetic-test", "0"), ("synthetic-test,prod", "1")])
def test_gate(client, monkeypatch, profile, enabled):
    for key, value in [("AI_V2_PROFILE", profile), ("AI_V2_ENABLED", enabled)]:
        monkeypatch.delenv(key, raising=False)
        if value is not None: monkeypatch.setenv(key, value)
    for url, body in [(COMPOSE, composition_request()), (ANALYZE, analysis_request())]:
        failure(client[0].post(url, json=body), 503, "AI_NOT_READY")


def test_composition_without_models_and_analysis_not_ready(client):
    http, service = client
    service.model = None
    assert http.post(COMPOSE, json=composition_request()).status_code == 200
    failure(http.post(ANALYZE, json=analysis_request()), 503, "AI_NOT_READY")


@pytest.mark.parametrize("kind", ["compose", "analysis"])
def test_parallel_duplicate(client, monkeypatch, kind):
    http, service = client
    started, release = threading.Event(), threading.Event()
    if kind == "analysis":
        original = service.model.analyze
        def slow(*args):
            started.set()
            assert release.wait(5)
            return original(*args)
        monkeypatch.setattr(service.model, "analyze", slow)
        url, body = ANALYZE, analysis_request()
    else:
        import v2.service as module
        original = module.compose
        def slow(*args):
            started.set()
            assert release.wait(5)
            return original(*args)
        monkeypatch.setattr(module, "compose", slow)
        url, body = COMPOSE, composition_request()
    with ThreadPoolExecutor() as pool:
        first = pool.submit(http.post, url, json=body)
        try:
            assert started.wait(5)
            failure(http.post(url, json=body), 409, kind.upper() + "_IN_PROGRESS")
        finally:
            release.set()
        assert first.result(timeout=5).status_code == 200


def test_wire_parser_privacy(client, capsys):
    http, _ = client
    for raw in ['{"apiContractVersion":2,"private-key":"secret",}',
                '{"apiContractVersion":2,"apiContractVersion":2}',
                '{"apiContractVersion":2,"content":NaN}',
                '{"apiContractVersion":2,"content":Infinity}']:
        response = http.post(ANALYZE, content=raw, headers={"Content-Type": "application/json"})
        failure(response, 422, "INVALID_REQUEST")
        assert "secret" not in response.text and "private-key" not in response.text
    assert "secret" not in capsys.readouterr().out


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_all_shared_schema_cases(case):
    # Schema-only fixtures intentionally have shape-only fingerprints.
    try:
        check(case["contract"], case["input"])
    except V2Error:
        assert not case["expected"]["valid"]
    else:
        assert case["expected"]["valid"]


@pytest.mark.parametrize("case", [s for s in SCENARIOS if s["kind"] in ("compose", "analysis-input")],
                         ids=lambda c: c["name"])
def test_reference_requests(case):
    body = case["input"]["request"] if case["kind"] == "compose" else case["input"]
    assert fingerprint(body) == body["inputFingerprint"]
    name = "CompositionRequest" if case["kind"] == "compose" else "AnalysisRequest"
    if case["expected"] == {"error": "INVALID_REQUEST"}:
        with pytest.raises(V2Error): request_dto(name, body)
    else:
        request_dto(name, body)


def test_canonical_golden_unicode_and_key_order():
    import runpy
    from conftest import ROOT
    reference = runpy.run_path(str(ROOT / "docs/contracts/v2/validate.py"))
    for body in [analysis_request(), composition_request(),
                 {"inputFingerprint": "ignore", "z": ["한글😀", {"b": 2, "a": "e\u0301\n\"\\"}], "a": None}]:
        assert fingerprint(body) == reference["fingerprint"](body)
        assert fingerprint(dict(reversed(list(body.items())))) == fingerprint(body)
    assert fingerprint({"v": "é"}) != fingerprint({"v": "e\u0301"})
    assert fingerprint({"v": [1, 2]}) != fingerprint({"v": [2, 1]})
    assert fingerprint({"v": 1.0}) == fingerprint({"v": 1})


def test_schema_unavailable_is_not_ready(client, monkeypatch):
    from v2.contracts import validator
    validator.cache_clear()
    monkeypatch.setenv("AI_V2_SCHEMA_PATH", "/private/tmp/focus87-nonexistent-schema.json")
    try:
        response = client[0].post(COMPOSE, json=composition_request())
        assert response.status_code == 503 and response.json()["code"] == "AI_NOT_READY"
    finally:
        validator.cache_clear()


@pytest.mark.parametrize("field", ["windowId", "analysisId", "inputFingerprint", "visitId"])
def test_final_response_pairing_cannot_be_bypassed(client, monkeypatch, field):
    http, service = client
    original = service.model.analyze
    def wrong(*args):
        response = original(*args)
        if field == "visitId":
            response["pageResults"][0][field] = response["pageResults"][1][field]
        else:
            response[field] = "a" * 64 if field == "inputFingerprint" else "00000000-0000-4000-8000-000000009999"
        return response
    monkeypatch.setattr(service.model, "analyze", wrong)
    failure(http.post(ANALYZE, json=analysis_request()), 500, "AI_ANALYSIS_FAILED")


def test_openapi_preserves_legacy_and_uses_shared_dtos(client, monkeypatch):
    import main
    monkeypatch.setattr(main.app, "openapi_schema", None)
    response = client[0].get("/openapi.json")
    assert response.status_code == 200
    document = response.json()
    variants = document["paths"][ANALYZE]["post"]["requestBody"]["content"]["application/json"]["schema"]["oneOf"]
    assert len(variants) == 2
    assert document["components"]["schemas"]["V2AnalysisRequest"]["properties"]["visits"]["maxItems"] == 3
    assert "activeDurationMs" in document["components"]["schemas"]["VisitRequest"]["properties"]

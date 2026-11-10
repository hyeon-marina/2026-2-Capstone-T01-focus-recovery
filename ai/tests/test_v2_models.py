import json
import math
import sys
import threading
from collections import OrderedDict
from copy import deepcopy
from types import SimpleNamespace

import pytest

from conftest import FakeContext, FakeEmbedding, analysis_request, signed
from models.embedding import LocalSemanticEmbeddingModel
from v2.contracts import V2Error
from v2.model import PageAnalysisModel, user_prompt
from test_v2_api import ANALYZE, failure


def valid_output(body):
    return json.loads(FakeContext()._generate(user_prompt(body)))


@pytest.mark.parametrize("mutation", ["label", "missing", "duplicate", "position", "visitId", "extra",
    "blank", "long", "email", "quote", "other-page-quote", "null", "not-json", "v1-state", "duplicate-key"])
def test_model_invalid_output_fails_after_one_retry(client, mutation, capsys):
    http, service = client
    body = analysis_request()
    output = valid_output(body)
    page = output["pageResults"][0]
    if mutation == "label": page["label"] = "FOCUSED"
    if mutation == "missing": output["pageResults"].pop()
    if mutation == "duplicate": output["pageResults"][1] = deepcopy(page)
    if mutation == "position": page["position"] = 3
    if mutation == "visitId": page["visitId"] = body["visits"][1]["visitId"]
    if mutation == "extra": page["private-value"] = "SENSITIVE_MODEL_SECRET"
    if mutation == "blank": page["rationale"] = " "
    if mutation == "long": page["rationale"] = "x" * 501
    if mutation == "email": page["rationale"] = "Contact synthetic-person@example.invalid"
    if mutation == "quote": page["rationale"] = body["visits"][0]["content"]
    if mutation == "other-page-quote": page["rationale"] = body["visits"][2]["content"]
    if mutation == "null": page["rationale"] = None
    if mutation == "v1-state": output = {"contextState": "FOCUSED"}
    raw = json.dumps(output)
    if mutation == "not-json": raw = "SENSITIVE_MODEL_SECRET"
    if mutation == "duplicate-key": raw = '{"pageResults":[],"pageResults":[]}'
    service.model.context.outputs = [raw, raw]
    response = http.post(ANALYZE, json=body)
    failure(response, 500, "AI_ANALYSIS_FAILED")
    assert len(service.model.context.calls) == 2
    logs = capsys.readouterr()
    assert "SENSITIVE_MODEL_SECRET" not in logs.out + logs.err + response.text


def test_invalid_then_valid_is_retried(client):
    http, service = client
    service.model.context.outputs = ['{"error":"INSUFFICIENT_EVIDENCE"}']
    assert http.post(ANALYZE, json=analysis_request()).status_code == 200
    assert len(service.model.context.calls) == 2


def test_inference_exception_private_and_not_cached(client, monkeypatch, capsys):
    http, service = client
    service.model.context.outputs = [RuntimeError("PRIVATE_TITLE PRIVATE_BODY PRIVATE_QUERY")]
    body = analysis_request()
    failure(http.post(ANALYZE, json=body), 500, "AI_ANALYSIS_FAILED")
    logs = capsys.readouterr()
    assert "PRIVATE_" not in logs.out + logs.err
    changed = deepcopy(body)
    changed["goalText"] = "Changed synthetic task"
    failure(http.post(ANALYZE, json=signed(changed)), 409, "ANALYSIS_ID_CONFLICT")
    assert http.post(ANALYZE, json=body).status_code == 200


@pytest.mark.parametrize("score", [float("nan"), float("inf"), -float("inf"), -1.0001, 1.0001, True])
def test_invalid_semantic_score(client, monkeypatch, score):
    http, service = client
    monkeypatch.setattr(service.model.embedding, "calculate_v2_relevance", lambda *a, **kw: score)
    failure(http.post(ANALYZE, json=analysis_request()), 500, "AI_ANALYSIS_FAILED")


def test_embedding_exception_no_labels(client, monkeypatch):
    def fail(*args, **kwargs): raise RuntimeError("secret-query")
    http, service = client
    monkeypatch.setattr(service.model.embedding, "calculate_v2_relevance", fail)
    failure(http.post(ANALYZE, json=analysis_request()), 500, "AI_ANALYSIS_FAILED")
    assert service.model.context.calls == []


def test_soft_inference_and_queue_timeout(client, monkeypatch):
    import v2.model as module
    http, service = client
    service.model.timeout_seconds = 0.01
    service.inference_lock.acquire()
    try:
        failure(http.post(ANALYZE, json=analysis_request()), 500, "AI_ANALYSIS_FAILED")
    finally:
        service.inference_lock.release()
    clock = iter([0, 0, 1])
    monkeypatch.setattr(module.time, "monotonic", lambda: next(clock))
    with pytest.raises(V2Error, match="AI_ANALYSIS_FAILED"):
        service.model.analyze(analysis_request(), 0)


def test_generation_sends_v2_prompt_budget_and_full_content(client):
    http, service = client
    body = analysis_request()
    for v in body["visits"]: v["content"] = "문" * 4999 + "😀"
    assert http.post(ANALYZE, json=signed(body)).status_code == 200
    prompt, options = service.model.context.calls[0]
    assert json.loads(prompt)["visits"][0]["content"] == body["visits"][0]["content"]
    assert "JUSTIFIED_DETOUR" in options["system_prompt"]
    assert options["max_new_tokens"] == 1024
    assert 0 < options["max_time"] <= service.model.timeout_seconds


def embedding_without_weights(monkeypatch):
    model = LocalSemanticEmbeddingModel.__new__(LocalSemanticEmbeddingModel)
    model.model_name, model.device = "Qwen/Qwen3-Embedding-0.6B", "cpu"
    model._cache, model._cache_lock, model._cache_generation = OrderedDict(), threading.Lock(), 0
    calls = []
    def encode(texts, **kwargs):
        calls.extend(texts)
        return [[float(len(t)), float(sum(map(ord, t)) % 31 + 1)] for t in texts]
    model.model = SimpleNamespace(encode=encode)
    def cosine(a, b):
        score = sum(x*y for x, y in zip(a, b)) / (math.hypot(*a) * math.hypot(*b))
        return SimpleNamespace(item=lambda: score)
    monkeypatch.setitem(sys.modules, "sentence_transformers", SimpleNamespace(util=SimpleNamespace(cos_sim=cosine)))
    return model, calls


def test_actual_embedding_cache_input_binding_goal_model_and_invalidation(monkeypatch):
    model, calls = embedding_without_weights(monkeypatch)
    def score(goal="goal-A", query="query-A", namespace="session-A", generation=0):
        return model.calculate_v2_relevance(goal, "title-A", "body-A", query,
                                           namespace=namespace, cache_generation=generation)
    first = score()
    assert -1 <= first <= 1
    assert score() == first and len(calls) == 2
    assert json.loads(calls[1]) == {"searchQuery": "query-A", "title": "title-A", "content": "body-A"}
    score(goal="goal-B")
    assert len(calls) == 3  # Goal re-embedded; no visitId-only score cache.
    score(query="query-B")
    assert len(calls) == 4
    score(namespace="session-B")
    assert len(calls) == 6
    model.model_name = "synthetic-changed-version"
    score()
    assert len(calls) == 8
    model.invalidate_cache()
    assert not model._cache
    score(generation=0)  # Late old inference after quarantine: no cache reads/writes.
    assert not model._cache
    score(generation=1)
    assert len(model._cache) == 2


def test_late_encoder_cannot_repopulate_cache(monkeypatch):
    model, _ = embedding_without_weights(monkeypatch)
    original = model.model.encode
    def encode(*a, **kw):
        result = original(*a, **kw)
        model.invalidate_cache()
        return result
    model.model.encode = encode
    model._embed("synthetic private input")
    assert not model._cache


def test_v1_embedding_text_and_cache_unchanged(monkeypatch):
    model, calls = embedding_without_weights(monkeypatch)
    model.calculate_relevance("goal", "title", "body")
    model.calculate_relevance("goal", "title", "body")
    assert calls == ["goal", "Title: title\nContent: body"]


def test_load_failure_keeps_composition_available(client, monkeypatch, capsys):
    from models.context import LocalContextModel
    from models.embedding import LocalSemanticEmbeddingModel
    from v2.service import V2Service
    def fail(*a, **kw): raise RuntimeError("PRIVATE_MODEL_ERROR")
    monkeypatch.setattr(LocalSemanticEmbeddingModel, "__init__", fail)
    service = V2Service()
    service.load(SimpleNamespace(pipeline=None))
    assert service.model is None
    assert capsys.readouterr().out.strip() == "[API v2] AI_NOT_READY"
    assert service.execute("compose", __import__("conftest").composition_request())["windows"]


def test_existing_context_settings_and_v1_validation_unchanged():
    from models.context import ContextModelConfig, LocalContextModel, PageVisit, SYSTEM_PROMPT
    assert ContextModelConfig.resolve().model_name == "Qwen/Qwen3-4B"
    assert ContextModelConfig.resolve().max_new_tokens == 128
    assert '"FOCUSED"' in SYSTEM_PROMPT
    result = LocalContextModel._parse_and_validate(
        '{"goalRelevance":0.7,"detourJustification":0.2,"driftDegree":0.1,"contextState":"FOCUSED"}')
    assert result.context_state == "FOCUSED"
    LocalContextModel.validate_input("legacy goal", [PageVisit("title", "content")] * 5)
    with pytest.raises(ValueError):
        LocalContextModel.validate_input("legacy goal", [PageVisit("title", "content")] * 3)


def test_actual_transformer_generation_adapter_preserves_v1_and_accepts_v2(monkeypatch):
    from contextlib import nullcontext
    from models.context import LocalContextModel, SYSTEM_PROMPT as V1_PROMPT
    from v2.model import SYSTEM_PROMPT as V2_PROMPT
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(no_grad=nullcontext))
    messages, generations = [], []
    class Batch(dict):
        def to(self, device): return self
    class Tokenizer:
        def apply_chat_template(self, value, **options):
            messages.append(value)
            assert options["enable_thinking"] is False
            return "synthetic tokenized prompt"
        def __call__(self, text, **options):
            return Batch(input_ids=SimpleNamespace(shape=(1, 4)))
        def decode(self, tokens, **options):
            assert tokens == [10, 11]
            return '{"synthetic":"model output"}'
    def generate(**options):
        generations.append(options)
        return [[0, 1, 2, 3, 10, 11]]
    context = LocalContextModel.__new__(LocalContextModel)
    context.tokenizer = Tokenizer()
    context.max_new_tokens = 128
    context.model = SimpleNamespace(device="cpu", config=SimpleNamespace(max_position_embeddings=2048), generate=generate)
    context._generate("v1")
    assert messages[-1][0]["content"] == V1_PROMPT
    assert generations[-1]["max_new_tokens"] == 128 and "max_time" not in generations[-1]
    context._generate("v2", max_new_tokens=1024, system_prompt=V2_PROMPT, max_time=1)
    assert messages[-1][0]["content"] == V2_PROMPT
    assert generations[-1]["max_new_tokens"] == 1024 and generations[-1]["max_time"] == 1
    context.model.config.max_position_embeddings = 100
    with pytest.raises(ValueError, match="context capacity"):
        context._generate("too long", max_new_tokens=1024, system_prompt=V2_PROMPT, max_time=1)

import json
import sys
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

AI_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_DIR))
ROOT = AI_DIR.parent

from v2.contracts import fingerprint
from v2.model import PageAnalysisModel
from v2.service import V2Service
import main

CASES = json.loads((ROOT / "docs/contracts/v2/fixtures/schema-cases.json").read_text())["cases"]
SCENARIOS = json.loads((ROOT / "docs/contracts/v2/fixtures/scenarios.json").read_text())["scenarios"]


def signed(body):
    body["inputFingerprint"] = fingerprint(body)
    return body


def analysis_request():
    return signed(deepcopy(next(c["input"] for c in CASES if c["name"] == "analysis-request")))


def composition_request(n=3, after=0, sequences=None):
    body = deepcopy(next(c["input"] for c in CASES if c["name"] == "compose-3"))
    body["afterSequence"] = after
    body["visits"] = [{"visitId": f"00000000-0000-4000-8000-{i:012d}", "sequence": sequence}
                      for i, sequence in enumerate(sequences or range(1, n + 1), 1)]
    return signed(body)


class FakeEmbedding:
    model_name = "synthetic-embedding-mock"
    cache_generation = 0

    def __init__(self):
        self.calls = []

    def calculate_v2_relevance(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return [-0.2, 0.4, 0.9][(len(self.calls) - 1) % 3]

    def invalidate_cache(self):
        self.cache_generation += 1


class FakeContext:
    config = SimpleNamespace(version="synthetic-context-mock")

    def __init__(self):
        self.calls, self.outputs = [], []

    def _generate(self, prompt, **kwargs):
        self.calls.append((prompt, kwargs))
        if self.outputs:
            value = self.outputs.pop(0)
            if isinstance(value, Exception):
                raise value
            return value
        data = json.loads(prompt)
        return json.dumps({"pageResults": [
            {"position": v["position"], "visitId": v["visitId"], "label": label,
             "rationale": rationale}
            for v, label, rationale in zip(data["visits"],
                ("DIRECT", "JUSTIFIED_DETOUR", "UNRELATED"),
                ("The page performs the original document comparison task.",
                 "This prerequisite explanation supports comparing the documents.",
                 "No link to the original document comparison is established."))]})


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("AI_V2_SERVICE_TOKEN", "synthetic-internal-service-token-95-0123456789")
    monkeypatch.setenv("AI_V2_ENABLED", "1")
    monkeypatch.setenv("AI_V2_PROFILE", "synthetic-test")
    service = V2Service(main.state.inference_lock)
    service.model = PageAnalysisModel(FakeEmbedding(), FakeContext())
    monkeypatch.setattr(main, "v2_service", service)
    monkeypatch.setattr(main, "registry", main.AnalysisRegistry(1000))
    monkeypatch.setattr(main.state, "pipeline", None)
    monkeypatch.setattr(main.state, "load_error", None)
    # No lifespan: unit tests never load/download weights or start loader threads.
    http = TestClient(main.app, raise_server_exceptions=False, headers={"Authorization": "Bearer synthetic-internal-service-token-95-0123456789"})
    try:
        yield http, service
    finally:
        http.close()

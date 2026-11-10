"""Independently check the synthetic V2LiveHttpTest wire artifacts."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "ai"))
from v2.contracts import check, compose, fingerprint, request_dto

directory = Path(sys.argv[1] if len(sys.argv) > 1 else "/private/tmp/focus89-http-evidence")
documents = {p.name: json.loads(p.read_text()) for p in directory.glob("*.json")}
assert len(documents) >= 6, "run V2LiveHttpTest first"
for name, value in documents.items():
    if name == "status.json":
        projection = {k: value[k] for k in ("apiContractVersion", "sessionId", "sessionStatus", "currentDecision", "lastSuccessfulState", "alert")}
        if projection["alert"]:
            projection["alert"] = {k: projection["alert"][k] for k in ("alertId", "alertType", "analysisId", "windowId", "stateVersion", "createdAt", "shownAt")}
        check("StatusResponse", projection)
    elif name == "states.json":
        check("StatePageResponse", value)
        for state in value["items"]:
            assert state["inputFingerprint"] == fingerprint({k: state[k] for k in ("analysisId", "ruleVersion", "behaviorSnapshot")})
    else:
        kind = ("Composition" if name.startswith("compose-") else "Analysis") + ("Request" if "-request" in name else "Response")
        (request_dto if kind.endswith("Request") else check)(kind, value)
        if kind == "CompositionResponse":
            assert value == compose(documents[name.replace("-response", "-request")])
        elif kind == "AnalysisResponse":
            request = documents["analysis-request.json"]
            assert all(value[k] == request[k] for k in ("apiContractVersion", "analysisId", "sessionId", "windowId", "inputFingerprint"))
            assert [(p["position"], p["visitId"]) for p in value["pageResults"]] == [(v["position"], v["visitId"]) for v in request["visits"]]
print(f"PASS: {len(documents)} actual HTTP documents; Schema, fingerprints, composition and analysis pairing")

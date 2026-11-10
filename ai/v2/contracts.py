"""Wire DTOs are validated directly against the shared contract, never a copy."""
import hashlib
import json
import math
import os
import re
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker


class V2Error(Exception):
    def __init__(self, status=422, code="INVALID_REQUEST", field="body"):
        self.status, self.code, self.field = status, code, field
        super().__init__(code)  # Never retain model output or request text in exceptions.

    def body(self):
        return {"apiContractVersion": 2, "code": self.code,
                "message": "요청을 처리할 수 없습니다.",
                "fieldErrors": ([{"field": self.field, "message": "계약 조건을 확인해주세요."}]
                                if self.status == 422 else [])}


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result

    def invalid_constant(_):
        raise ValueError("non-finite JSON number")

    return json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid_constant)


@lru_cache
def validator(name):
    path = Path(os.getenv("AI_V2_SCHEMA_PATH") or
                Path(__file__).resolve().parents[1] / "v2.schema.json")
    if not path.is_file() and not os.getenv("AI_V2_SCHEMA_PATH"):
        path = Path(__file__).resolve().parents[2] / "docs/contracts/v2/v2.schema.json"
    try:
        schema = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise V2Error(503, "AI_NOT_READY") from None
    checker = FormatChecker()

    @checker.checks("date-time", raises=(ValueError, TypeError))
    def exact_utc_millis(value):
        if not isinstance(value, str):
            return True
        if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z", value):
            return False
        datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ")
        return True

    return Draft202012Validator({"$ref": f"#/$defs/{name}", "$defs": schema["$defs"]}, format_checker=checker)


def check(name, value):
    # Error messages and paths from jsonschema can contain sensitive values/keys.
    if next(validator(name).iter_errors(value), None) is not None:
        raise V2Error()
    # JSON Schema considers 1.0 an integer: serialize it as canonical decimal 1.
    return canonical_numbers(value)


def canonical_numbers(value):
    if isinstance(value, dict):
        return {k: canonical_numbers(v) for k, v in value.items()}
    if isinstance(value, list):
        return [canonical_numbers(v) for v in value]
    if isinstance(value, float):
        if not math.isfinite(value):
            raise V2Error()
        return int(value) if value.is_integer() else value
    if isinstance(value, str):
        try:
            value.encode("utf-8")
        except UnicodeError:
            raise V2Error() from None
    return value


def fingerprint(value):
    body = canonical_numbers({k: v for k, v in value.items() if k != "inputFingerprint"})
    encoded = json.dumps(body, sort_keys=True, ensure_ascii=False,
                         separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def request_dto(name, body):
    body = check(name, body)
    if body["inputFingerprint"] != fingerprint(body):
        raise V2Error(field="inputFingerprint")
    visits = body["visits"]
    sequences = [v["sequence"] for v in visits]
    if len({v["visitId"] for v in visits}) != len(visits) or any(
            a >= b for a, b in zip(sequences, sequences[1:])):
        raise V2Error(field="visits")
    if name == "AnalysisRequest":
        if [v["position"] for v in visits] != [1, 2, 3]:
            raise V2Error(field="visits")
        if not body["goalText"].strip() or any(not v["content"].strip() or
                (v["isSearchResultPage"] and not v["searchQuery"].strip()) for v in visits):
            raise V2Error()
    else:
        after = body["afterSequence"]
        tail = [s for s in sequences if s <= after]
        # The cursor is a real visit, not an arithmetic count of sparse sequences.
        if sequences[-1] <= after or len(tail) > 2 or (after > 0 and
                (not tail or tail[-1] != after)):
            raise V2Error(field="afterSequence")
        # The true number/identity of prior visits is known only to BE storage.
    return body


def compose(body):
    visits = body["visits"]
    windows = []
    for i in range(len(visits) - 2):
        members = visits[i:i + 3]
        if members[-1]["sequence"] > body["afterSequence"]:
            windows.append({"visitIds": [v["visitId"] for v in members],
                            "endVisitId": members[-1]["visitId"]})
    return {**{k: body[k] for k in ("apiContractVersion", "composeRequestId", "sessionId",
                                   "afterSequence", "inputFingerprint")},
            "composedThroughSequence": visits[-1]["sequence"], "windows": windows}

"""Internal service authentication only; participant identity/consent stay at the BE boundary."""
import hmac
import os
from v2.contracts import V2Error


def require_service(request):
    secret = os.getenv("AI_V2_SERVICE_TOKEN", "")
    supplied = request.headers.get("authorization", "")
    if len(secret) < 32 or not hmac.compare_digest(supplied.encode("utf-8"), ("Bearer " + secret).encode("utf-8")):
        raise V2Error(401, "INVALID_REQUEST")

"""Actual AI FastAPI/contract/composition service, mocked model dependencies only.

No model loader, downloads or production data. Run from the repository root:
AI_V2_PROFILE=synthetic-test AI_V2_ENABLED=1 <test-venv>/bin/python be/src/test/python/v2_http_fixture.py --port 8897
"""
import argparse
import sys
from contextlib import asynccontextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "ai"))
sys.path.insert(0, str(ROOT / "ai/tests"))

import uvicorn
import main
from conftest import FakeContext, FakeEmbedding
from v2.model import PageAnalysisModel


@asynccontextmanager
async def no_model_loading(app):
    yield


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8897)
    parser.add_argument("--no-model", action="store_true")
    parser.add_argument("--fail-first-retraction", action="store_true")
    parser.add_argument("--retraction-journal")
    parser.add_argument("--retraction-secret")
    args = parser.parse_args()
    if args.retraction_journal:
        from v2.retractions import RetractionJournal, install_synthetic_retractions
        install_synthetic_retractions(main.app, main.v2_service, RetractionJournal(args.retraction_journal), args.retraction_secret or "")
    if args.fail_first_retraction:
        from fastapi.responses import JSONResponse
        failures = [1]
        @main.app.middleware("http")
        async def synthetic_transient_failure(request, call_next):
            if request.url.path == "/internal/v2/visit-retractions" and failures[0]:
                failures[0] -= 1
                return JSONResponse(status_code=503, content={"code": "SYNTHETIC_PROPAGATION_FAILURE"})
            return await call_next(request)
    main.app.router.lifespan_context = no_model_loading
    if not args.no_model:
        main.v2_service.model = PageAnalysisModel(FakeEmbedding(), FakeContext())
    uvicorn.run(main.app, host="127.0.0.1", port=args.port, log_level="warning")

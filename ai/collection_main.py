"""Private, single-worker v2 collection entrypoint; no legacy classifier or public API."""
import os
import threading
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from v2.service import V2Service
from v2.deployment import approved_release
from v2.authorization import require_service
from v2.contracts import V2Error, strict_json
from v2.retractions import RetractionJournal, install_retractions

from pathlib import Path
for env_key, filename in [('AI_V2_SERVICE_TOKEN','focus-recovery.v2.dispatch.service-token'),('AI_RETRACTION_SECRET','focus-recovery.v2.retraction.service-secret')]:
    path=Path('/run/collection-secrets') / filename
    if path.is_file(): os.environ[env_key]=path.read_text().strip()
service = V2Service()


def load():
    try:
        from models.offline import OfflineEmbedding, OfflineContext
        from v2.model import PageAnalysisModel
        embedding, context = OfflineEmbedding(), OfflineContext()
        embedding.warm_up()
        model = PageAnalysisModel(embedding, context)
        model.warm_up()
        service.model = model
    except Exception:
        print('[collection] AI_NOT_READY')


@asynccontextmanager
async def lifespan(app):
    if not approved_release():
        raise RuntimeError('COLLECTION_POLICY_BLOCKED')
    if len(os.getenv('AI_V2_SERVICE_TOKEN','')) < 32:
        raise RuntimeError('SERVICE_AUTH_REQUIRED')
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    # Single worker plus a durable journal. GPU memory is never claimed physically erased.
    journal = RetractionJournal(os.environ['AI_RETRACTION_JOURNAL'], initialize=False)
    install_retractions(app, service, journal, os.environ['AI_RETRACTION_SECRET'])
    threading.Thread(target=load, daemon=True).start()
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.exception_handler(V2Error)
async def failure(request, exc):
    return JSONResponse(status_code=exc.status, content=exc.body())


@app.get('/health')
def health():
    return JSONResponse(status_code=200 if approved_release() and service.model else 503,
                        content={'status':'READY' if approved_release() and service.model else 'AI_NOT_READY','realModel':service.model is not None})


async def execute(request, kind):
    require_service(request)
    if not approved_release():
        raise V2Error(503, 'AI_NOT_READY')
    try:
        body = strict_json(await request.body())
        return await run_in_threadpool(service.execute, kind, body)
    except V2Error:
        raise
    except Exception:
        raise V2Error(500, 'AI_ANALYSIS_FAILED') from None


@app.post('/api/ai/window-compositions')
async def compose(request: Request):
    return await execute(request, 'compose')


@app.post('/api/ai/analyses')
async def analyze(request: Request):
    return await execute(request, 'analysis')

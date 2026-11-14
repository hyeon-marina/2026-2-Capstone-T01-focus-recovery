"""Loopback, authenticated durable quarantine only; no inference or model loading.

Run with one worker, no access log, and the same persistent journal mounted into any
future collection AI worker. An ACK proves journal quarantine, never physical erasure.
"""
import os
import re
import stat
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from v2.contracts import V2Error
from v2.retractions import RetractionJournal, install_retractions
from v2.service import V2Service


def private_path(value, *, directory=False, may_create=False):
    path = Path(value)
    if not path.is_absolute() or any(p.is_symlink() for p in [path, *path.parents]):
        raise ValueError()
    if may_create and not path.exists():
        return path
    info = path.stat()
    expected = 0o700 if directory else 0o600
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != expected:
        raise ValueError()
    if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):
        raise ValueError()
    return path


def create_app():
    @asynccontextmanager
    async def lifespan(app):
        try:
            secret_file = private_path(os.environ['AI_RETRACTION_SECRET_FILE'])
            journal_file = Path(os.environ['AI_RETRACTION_JOURNAL'])
            private_path(str(journal_file.parent), directory=True)
            private_path(str(journal_file), may_create=True)
            secret = secret_file.read_text().strip()
            if not re.fullmatch(r'[A-Za-z0-9_-]{32,256}', secret):
                raise ValueError()
            journal = RetractionJournal(journal_file)
            install_retractions(app, V2Service(), journal, secret)
            app.state.journal = journal
        except (OSError, ValueError, KeyError, sqlite3.Error):
            raise RuntimeError('RETRACTION_CONFIG_INVALID') from None
        yield

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.get('/health')
    def health():
        try:
            app.state.journal.snapshot()
            return {'status': 'READY', 'mode': 'RETRACTION_ONLY', 'realModel': False}
        except V2Error:
            return JSONResponse(status_code=503, content={'status': 'AI_NOT_READY'})

    return app


app = create_app()

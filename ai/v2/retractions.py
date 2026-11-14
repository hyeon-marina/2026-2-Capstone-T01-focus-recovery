"""Durable retraction boundary. The public main never installs the internal route.

SQLite coordinates workers sharing one local file, not separate hosts/volumes. The acknowledgement
proves durable quarantine, not deletion of GPU/model memory or every worker's physical cache.
"""
from contextlib import contextmanager
import hmac
import os
import sqlite3
from pathlib import Path

from fastapi import Request
from fastapi.responses import JSONResponse
from v2.contracts import V2Error, strict_json


class RetractionJournal:
    def __init__(self, path):
        self.path = str(Path(path).resolve())
        fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(fd)
        os.chmod(self.path, 0o600)
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS retractions (id TEXT PRIMARY KEY, session TEXT NOT NULL, visit TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS revision (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL)")
            db.execute("INSERT OR IGNORE INTO revision VALUES (1, 0)")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(Path(self.path).as_uri() + "?mode=rw", uri=True, timeout=5)
        try:
            db.execute("PRAGMA synchronous=FULL")
            with db:
                yield db
        finally:
            db.close()

    def snapshot(self):
        try:
            with self.connect() as db:
                db.execute("BEGIN")
                revision = db.execute("SELECT value FROM revision WHERE id=1").fetchone()[0]
                rows = db.execute("SELECT session, visit FROM retractions").fetchall()
                return revision, {r[0] for r in rows}, {r[1] for r in rows}
        except (sqlite3.Error, OSError, TypeError):
            raise V2Error(503, "AI_NOT_READY") from None

    def retract(self, request_id, session_id, visit_id):
        try:
            with self.connect() as db:
                db.execute("BEGIN IMMEDIATE")
                existing = db.execute("SELECT session, visit FROM retractions WHERE id=?", (request_id,)).fetchone()
                if existing and existing != (session_id, visit_id):
                    raise V2Error(409, "RETRACTION_ID_CONFLICT")
                if not existing:
                    db.execute("INSERT INTO retractions VALUES (?, ?, ?)", (request_id, session_id, visit_id))
                    db.execute("UPDATE revision SET value=value+1 WHERE id=1")
        except (sqlite3.Error, OSError):
            raise V2Error(503, "AI_NOT_READY") from None


def install_retractions(app, service, journal, service_secret):
    """Explicitly installed by private entrypoints or isolated tests, never public main.

    Separate hosts require a coordinated store and worker acknowledgement protocol.
    """
    if len(service_secret) < 32:
        raise ValueError("retraction service secret required")
    service.privacy_store = journal
    service.refresh_privacy()

    @app.post("/internal/v2/visit-retractions", include_in_schema=False)
    async def retract(request: Request):
        try:
            supplied = request.headers.get("authorization", "")
            if not hmac.compare_digest(supplied, "Bearer " + service_secret):
                raise V2Error(401, "INVALID_REQUEST")
            payload = strict_json(await request.body())
            import re
            if not isinstance(payload, dict) or set(payload) != {"retractionId", "sessionId", "visitId"}:
                raise V2Error()
            for value in payload.values():
                if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", value):
                    raise V2Error()
            journal.retract(payload["retractionId"], payload["sessionId"], payload["visitId"])
            service.refresh_privacy()
            return {"retractionId": payload["retractionId"], "visitId": payload["visitId"],
                    "status": "QUARANTINED", "durable": True}
        except (ValueError, TypeError):
            return JSONResponse(status_code=422, content=V2Error().body())
        except V2Error as exc:
            return JSONResponse(status_code=exc.status, content=exc.body())


# Keep the existing fixture import compatible.
install_synthetic_retractions = install_retractions

"""RAW_ONLY must propagate quarantine without starting inference."""
import importlib
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from v2.retractions import RetractionJournal

SECRET = 'isolated-retraction-secret-0123456789abcdef'
PATH = '/internal/v2/visit-retractions'


def configured(tmp_path, monkeypatch):
    directory = tmp_path / 'private'
    directory.mkdir(mode=0o700)
    secret = directory / 'secret'
    secret.write_text(SECRET)
    secret.chmod(0o600)
    journal = directory / 'journal.sqlite'
    RetractionJournal.initialize_new(journal)  # Explicit provisioning, never implicit runtime recovery.
    monkeypatch.setenv('AI_RETRACTION_SECRET_FILE', str(secret))
    monkeypatch.setenv('AI_RETRACTION_JOURNAL', str(journal))
    monkeypatch.delenv('AI_V2_ENABLED', raising=False)
    monkeypatch.delenv('AI_V2_PROFILE', raising=False)
    return secret, journal


def test_raw_only_persistent_authenticated_replay_and_no_inference(tmp_path, monkeypatch):
    _, journal = configured(tmp_path, monkeypatch)
    entry = importlib.import_module('retraction_main')
    payloads = [dict(retractionId=str(uuid4()), sessionId=str(uuid4()), visitId=str(uuid4())) for _ in range(3)]
    for _ in range(2):
        with TestClient(entry.create_app()) as client:
            assert client.get('/health').json() == dict(status='READY', mode='RETRACTION_ONLY', realModel=False)
            assert client.post(PATH, json=payloads[0]).status_code == 401
            for path in ['/api/ai/analyses', '/api/ai/window-compositions']:
                assert client.post(path, json={}).status_code == 404
            for body in payloads:
                response = client.post(PATH, json=body, headers={'Authorization': 'Bearer ' + SECRET})
                assert response.status_code == 200
                assert response.json() == dict(retractionId=body['retractionId'], visitId=body['visitId'], status='QUARANTINED', durable=True)
            conflict = dict(payloads[0], visitId=str(uuid4()))
            assert client.post(PATH, json=conflict, headers={'Authorization': 'Bearer ' + SECRET}).status_code == 409
    revision, sessions, visits = RetractionJournal(journal).snapshot()
    assert revision == 3
    assert sessions == {p['sessionId'] for p in payloads}
    assert visits == {p['visitId'] for p in payloads}
    assert journal.stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize('fault', ['missing-secret', 'short-secret', 'public-secret', 'symlink-secret', 'public-directory', 'relative-journal', 'missing-journal', 'empty-journal', 'corrupt-journal'])
def test_retraction_startup_fails_closed(tmp_path, monkeypatch, fault):
    secret, journal = configured(tmp_path, monkeypatch)
    if fault == 'missing-secret': secret.unlink()
    if fault == 'short-secret': secret.write_text('too-short')
    if fault == 'public-secret': secret.chmod(0o644)
    if fault == 'symlink-secret':
        original = secret.with_name('original'); secret.rename(original); secret.symlink_to(original)
    if fault == 'public-directory': journal.parent.chmod(0o755)
    if fault == 'relative-journal': monkeypatch.setenv('AI_RETRACTION_JOURNAL', 'relative.sqlite')
    if fault == 'missing-journal': journal.unlink()
    if fault == 'empty-journal': journal.write_bytes(b'')
    if fault == 'corrupt-journal': journal.write_bytes(b'PRIVATE_SOURCE')
    entry = importlib.import_module('retraction_main')
    with pytest.raises(RuntimeError, match='RETRACTION_CONFIG_INVALID'):
        with TestClient(entry.create_app()): pass
    if fault == 'missing-journal': assert not journal.exists()
    if fault == 'empty-journal': assert journal.read_bytes() == b''
    if fault == 'corrupt-journal': assert journal.read_bytes() == b'PRIVATE_SOURCE'


def test_missing_journal_after_start_fails_closed(tmp_path, monkeypatch):
    _, journal = configured(tmp_path, monkeypatch)
    entry = importlib.import_module('retraction_main')
    with TestClient(entry.create_app()) as client:
        journal.unlink()
        assert client.get('/health').status_code == 503
        body = dict(retractionId=str(uuid4()), sessionId=str(uuid4()), visitId=str(uuid4()))
        response = client.post(PATH, json=body, headers={'Authorization': 'Bearer ' + SECRET})
        assert response.status_code == 503
        assert not journal.exists()


def test_explicit_provisioning_cannot_overwrite_existing_journal(tmp_path):
    journal = tmp_path / 'journal.sqlite'
    store = RetractionJournal.initialize_new(journal)
    payload = [str(uuid4()) for _ in range(3)]
    store.retract(*payload)
    before = journal.read_bytes()
    with pytest.raises(FileExistsError):
        RetractionJournal.initialize_new(journal)
    assert journal.read_bytes() == before
    assert RetractionJournal(journal, initialize=False).snapshot()[0] == 1

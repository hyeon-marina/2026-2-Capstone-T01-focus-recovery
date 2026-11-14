import pytest
from fastapi.testclient import TestClient
import collection_main

def test_unapproved_deployment_cannot_start(monkeypatch):
    monkeypatch.setattr(collection_main,'approved_release',lambda:False)
    with pytest.raises(RuntimeError,match='COLLECTION_POLICY_BLOCKED'):
        with TestClient(collection_main.app):pass

def test_approved_file_alone_without_internal_secret_cannot_start(monkeypatch):
    monkeypatch.setattr(collection_main,'approved_release',lambda:True)
    monkeypatch.delenv('AI_V2_SERVICE_TOKEN',raising=False)
    with pytest.raises(RuntimeError,match='SERVICE_AUTH_REQUIRED'):
        with TestClient(collection_main.app):pass


def test_missing_journal_blocks_approved_model_startup(monkeypatch, tmp_path):
    from v2.contracts import V2Error
    monkeypatch.setattr(collection_main, 'approved_release', lambda: True)
    monkeypatch.setenv('AI_V2_SERVICE_TOKEN', 'isolated-service-token-0123456789abcdef')
    monkeypatch.setenv('AI_RETRACTION_SECRET', 'isolated-retraction-secret-0123456789abcdef')
    journal = tmp_path / 'missing.sqlite'
    monkeypatch.setenv('AI_RETRACTION_JOURNAL', str(journal))
    monkeypatch.setattr(collection_main.threading, 'Thread', lambda **_: pytest.fail('Model loader must not start'))
    with pytest.raises(V2Error, match='AI_NOT_READY'):
        with TestClient(collection_main.app): pass
    assert not journal.exists()

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

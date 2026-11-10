import pytest
from conftest import composition_request, analysis_request


@pytest.mark.parametrize('path,body', [('/api/ai/window-compositions',composition_request),('/api/ai/analyses',analysis_request)])
@pytest.mark.parametrize('credential', ['', 'Bearer forged', 'Bearer participant-token-does-not-grant-internal-access'])
def test_public_or_participant_credentials_cannot_run_v2(client,path,body,credential):
    http,worker=client
    result=http.post(path,json=body(),headers={'Authorization':credential})
    assert result.status_code==401
    assert result.json()['code']=='INVALID_REQUEST'
    assert not worker.compositions.entries and not worker.analyses.entries
    assert not worker.model.context.calls
    assert credential not in result.text or not credential


def test_missing_server_credential_cannot_be_enabled_by_profile(client,monkeypatch):
    monkeypatch.delenv('AI_V2_SERVICE_TOKEN',raising=False)
    assert client[0].post('/api/ai/window-compositions',json=composition_request()).status_code==401


def test_rotated_service_credential_rejects_previous_token(client,monkeypatch):
    monkeypatch.setenv('AI_V2_SERVICE_TOKEN','rotated-synthetic-service-token-95-0123456789')
    assert client[0].post('/api/ai/analyses',json=analysis_request()).status_code==401
    assert client[0].post('/api/ai/analyses',json=analysis_request(),headers={'Authorization':'Bearer rotated-synthetic-service-token-95-0123456789'}).status_code==200

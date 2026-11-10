import multiprocessing
import threading
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from conftest import FakeEmbedding, FakeContext, analysis_request, composition_request
from v2.model import PageAnalysisModel
from v2.service import V2Service
from v2.contracts import V2Error
from v2.retractions import RetractionJournal, install_synthetic_retractions

SECRET = 'synthetic-service-only-secret-93-0123456789'
PATH = '/internal/v2/visit-retractions'


def retraction(body):
    return dict(retractionId=str(uuid4()), sessionId=body['sessionId'], visitId=body['visits'][0]['visitId'])


def service(journal):
    result = V2Service(privacy_store=journal)
    result.model = PageAnalysisModel(FakeEmbedding(), FakeContext())
    return result


@pytest.fixture
def synthetic(monkeypatch, tmp_path):
    monkeypatch.setenv('AI_V2_ENABLED', '1')
    monkeypatch.setenv('AI_V2_PROFILE', 'synthetic-test')
    journal = RetractionJournal(tmp_path / 'tombstones.sqlite')
    worker = service(journal)
    app = FastAPI()
    install_synthetic_retractions(app, worker, journal, SECRET)
    with TestClient(app) as http:
        yield http, worker, journal


def test_default_main_does_not_publish_internal_delete_route(client):
    assert client[0].post(PATH, json={}).status_code == 404


def test_authenticated_idempotent_journal_and_conflict(synthetic):
    http, worker, journal = synthetic
    body = analysis_request()
    worker.execute('analyze', body)
    r = retraction(body)
    assert http.post(PATH, json=r).status_code == 401
    assert journal.snapshot()[0] == 0
    headers = {'Authorization': 'Bearer ' + SECRET}
    first = http.post(PATH, json=r, headers=headers)
    assert first.status_code == 200 and first.json()['durable'] is True
    assert http.post(PATH, json=r, headers=headers).json() == first.json()
    assert journal.snapshot()[0] == 1
    changed = dict(r, visitId=str(uuid4()))
    assert http.post(PATH, json=changed, headers=headers).status_code == 409
    assert not worker.analyses.entries
    with pytest.raises(V2Error, match='PRIVACY_RETRACTED'):
        worker.execute('analyze', body)
    assert worker.model.embedding.cache_generation >= 1


@pytest.mark.parametrize('mutation', ['uuid', 'extra', 'null', 'missing', 'duplicate'])
def test_internal_request_rejects_invalid_shape_without_echo(synthetic, mutation):
    http, _, journal = synthetic
    r = retraction(analysis_request())
    if mutation == 'uuid': r['visitId'] = 'PRIVATE_SOURCE'
    if mutation == 'extra': r['source'] = 'PRIVATE_SOURCE'
    if mutation == 'null': r['visitId'] = None
    if mutation == 'missing': del r['sessionId']
    import json
    raw = json.dumps(r)
    if mutation == 'duplicate': raw = '{"visitId":"PRIVATE_SOURCE",' + raw[1:]
    response = http.post(PATH, content=raw, headers={'Authorization': 'Bearer ' + SECRET})
    assert response.status_code == 422 and 'PRIVATE_SOURCE' not in response.text
    assert journal.snapshot()[0] == 0


def test_shared_journal_invalidates_other_worker_cached_replay_and_restart(synthetic):
    _, first, journal = synthetic
    second = service(RetractionJournal(journal.path))
    body = analysis_request()
    first.execute('analyze', body)
    second.execute('analyze', body)
    r = retraction(body)
    journal.retract(r['retractionId'], r['sessionId'], r['visitId'])
    for worker in [first, second, service(RetractionJournal(journal.path))]:
        with pytest.raises(V2Error, match='PRIVACY_RETRACTED'):
            worker.execute('analyze', body)
        assert not worker.analyses.entries


@pytest.mark.parametrize('moment', ['before', 'during', 'before-return'])
def test_inflight_other_worker_retraction_blocks_late_registry_store(synthetic, monkeypatch, moment):
    _, worker, journal = synthetic
    body = analysis_request()
    r = retraction(body)
    entered, release = threading.Event(), threading.Event()
    original = worker.model.analyze
    def delayed(*args):
        if moment == 'during':
            entered.set(); assert release.wait(5)
        result = original(*args)
        if moment == 'before-return':
            entered.set(); assert release.wait(5)
        return result
    monkeypatch.setattr(worker.model, 'analyze', delayed)
    if moment == 'before':
        journal.retract(r['retractionId'], r['sessionId'], r['visitId'])
        with pytest.raises(V2Error, match='PRIVACY_RETRACTED'):
            worker.execute('analyze', body)
    else:
        with ThreadPoolExecutor() as pool:
            future = pool.submit(worker.execute, 'analyze', body)
            try:
                assert entered.wait(5)
                RetractionJournal(journal.path).retract(r['retractionId'], r['sessionId'], r['visitId'])
            finally:
                release.set()
            with pytest.raises(V2Error, match='PRIVACY_RETRACTED'):
                future.result(5)
    assert not worker.analyses.entries


def read_in_process(path, body, queue):
    try:
        V2Service(privacy_store=RetractionJournal(path)).execute('compose', body)
        queue.put('UNEXPECTED_SUCCESS')
    except V2Error as exc:
        queue.put(exc.code)


def test_separate_process_observes_persistent_tombstone(synthetic):
    _, _, journal = synthetic
    body = composition_request()
    r = retraction(body)
    journal.retract(r['retractionId'], r['sessionId'], r['visitId'])
    ctx = multiprocessing.get_context('spawn')
    queue = ctx.Queue()
    process = ctx.Process(target=read_in_process, args=(journal.path, body, queue))
    process.start(); process.join(10)
    try:
        assert process.exitcode == 0
        assert queue.get(timeout=2) == 'PRIVACY_RETRACTED'
    finally:
        if process.is_alive(): process.terminate(); process.join()
        queue.close()


def test_unavailable_journal_fails_closed_before_cached_replay(synthetic):
    _, worker, journal = synthetic
    body = analysis_request(); worker.execute('analyze', body)
    import os
    os.unlink(journal.path)
    with pytest.raises(V2Error, match='AI_NOT_READY'):
        worker.execute('analyze', body)

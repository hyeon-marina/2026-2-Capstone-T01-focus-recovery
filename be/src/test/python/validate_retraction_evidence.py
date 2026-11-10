"""Independent shared-Schema validation of synthetic HTTP/Chrome retraction evidence."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / 'ai'))
from v2.contracts import check


def load(path):
    return json.loads(Path(path).read_text())


def verify():
    http = load('/private/tmp/focus93-http-evidence/fe.json')
    requests = {}
    for request in http['requests']:
        check('PrivacyRetraction', request)
        assert request['retractionId'] not in requests
        requests[request['retractionId']] = request
    for ack in http['receipts']:
        check('RetractionAck', ack)
        assert ack['visitId'] == requests[ack['retractionId']]['visitId']
        assert ack['status'] == 'QUARANTINED'
    assert len(http['receipts']) > len(requests), 'lost ACK must replay an existing request'
    status = http['status']
    check('StatusResponse', {k: status[k] for k in ('apiContractVersion', 'sessionId', 'sessionStatus', 'currentDecision', 'lastSuccessfulState', 'alert')})
    assert status['currentDecision']['decisionStatus'] == 'INVALIDATED'
    assert status['lastSuccessfulState'] is None and status['alert'] is None
    for job in load('/private/tmp/focus93-http-evidence/be-targets.json'):
        assert job['status'] == 'QUARANTINED'
        targets = {t['type']: t for t in job['targets']}
        assert targets['BE_PAYLOADS']['evidence'] == 'SYNTHETIC_DB_PAYLOAD_ABSENCE_VERIFIED'
        assert targets['AI_CACHE_AND_MEMORY']['evidence'] == 'AI_DURABLE_QUARANTINE_ACK_ONLY'
        for name in ('CLIENT_LOCAL_COPIES', 'EXPORT_COPIES', 'TRAINED_ARTIFACTS', 'BACKUPS'):
            assert targets[name]['status'] == 'BLOCKED'
    browser = load('/private/tmp/focus91-mock-evidence/retractions.json')
    assert browser['quarantine']['status'] == 'RETRACTION_REQUIRED'
    assert browser['frozen'] == [e['request'] for e in browser['entries']]
    for entry in browser['entries']:
        check('PrivacyRetraction', entry['request'])
        check('RetractionAck', entry['ack'])
        assert entry['phase'] == 'acknowledged'
    print(f"PASS: {len(requests)} actual HTTP retractions, {len(http['receipts'])} receipts, {len(browser['entries'])} real Chrome entries; shared Schema and BLOCKED evidence preserved")
    print('LIMIT: synthetic evidence only; no production authentication, model inference, external deletion or PURGED proof')


if __name__ == '__main__':
    verify()

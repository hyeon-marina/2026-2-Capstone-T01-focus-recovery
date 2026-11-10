"""Independent contract checks of current #95 synthetic Chrome and real HTTP artifacts."""
import json
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'ai'))
from v2.contracts import check

for folder in ('focus95-chrome-http-evidence','focus95-chrome-evidence'):
    directory=Path('/private/tmp')/folder
    for name,kind in (('post','PageVisitPost'),('post-ack','PageVisitAck'),('patch','BehaviorPatch'),('patch-ack','BehaviorAck')):
        check(kind,json.loads((directory/(name+'.json')).read_text()))
    auth=json.loads((directory/'auth-consent.json').read_text())
    assert auth['authenticationRequired'] and auth['explicitConsentUI'] and auth['browserReauthentication']
    receipt=auth['wholeWithdrawal']['ack']
    assert receipt['requestId']==auth['wholeWithdrawal']['requestId']
    assert receipt['status']=='QUARANTINED' and receipt['unmet']
    assert auth['wholeWithdrawal']['phase']=='acknowledged'
status=json.loads(Path('/private/tmp/focus95-chrome-http-evidence/status.json').read_text())
check('StatusResponse',{k:status[k] for k in ('apiContractVersion','sessionId','sessionStatus','currentDecision','lastSuccessfulState','alert')})
assert status['sessionStatus']=='ENDED' and status['currentDecision']['decisionStatus']=='COMPLETED'
flow=json.loads(Path('/private/tmp/focus95-http-evidence/flow.json').read_text())
assert flow['withdrawal']['status']=='QUARANTINED' and len(flow['withdrawal']['sessions'])==2
assert all(s['status']=='INVENTORIED' for s in flow['withdrawal']['sessions'])
for target in flow['withdrawal']['targets']:
    if target['targetType'] in ('AI_CACHE_AND_MEMORY','BE_PAYLOADS'):
        assert target['processingStatus']=='VERIFIED'
    if target['targetType'] in ('CLIENT_LOCAL_COPIES','EXPORT_COPIES','TRAINED_ARTIFACTS','BACKUPS'):
        assert target['processingStatus']=='BLOCKED'
assert 'Bearer ' not in json.dumps(flow)
print('PASS: current #95 Chrome POST/PATCH wire, auth/consent UI and restart, real HTTP multi-session withdrawal, BLOCKED external evidence')
print('LIMIT: synthetic credentials/catalog and mock models; no operational enrollment, actual consent, external deletion or PURGED evidence')

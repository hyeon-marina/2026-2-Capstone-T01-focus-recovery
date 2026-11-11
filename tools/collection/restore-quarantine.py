#!/usr/bin/env python3
"""Generate SQL for an OFFLINE restored DB from the latest metadata ledger; never connects.
Leaves payload erasure/external copies unresolved and never emits PURGED or opens the gate.
"""
import argparse
import json
import os
from pathlib import Path
import re
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--ledger',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args()
d=json.loads(a.ledger.read_text())
uuid=re.compile(r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}')
def uid(v):
    if not isinstance(v,str) or not uuid.fullmatch(v):raise ValueError('Invalid ledger identifier')
    return "'"+v+"'"
def text(v):
    if not isinstance(v,str):raise ValueError('Invalid ledger text')
    return "CONVERT(X'"+v.encode().hex()+"' USING utf8mb4)"
sql=['-- OFFLINE restore only; review latest ledger provenance before execution.','START TRANSACTION;','UPDATE collection_release SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(3));']
for owner in d['participants']:
    v=uid(owner)
    sql += [f'UPDATE participant SET withdrawn_at=COALESCE(withdrawn_at,UTC_TIMESTAMP(3)) WHERE participant_id={v};',f'UPDATE consent_record SET withdrawn_at=COALESCE(withdrawn_at,UTC_TIMESTAMP(3)) WHERE participant_id={v};',f"UPDATE work_session SET privacy_status='QUARANTINED',privacy_revision=privacy_revision+1 WHERE owner_participant_id={v} AND privacy_status='CLEAR';"]
for session in d['sessions']:
    sql += [f"UPDATE work_session SET privacy_status='QUARANTINED',privacy_revision=privacy_revision+1 WHERE session_id={uid(session)} AND privacy_status='CLEAR';"]
for r in d['retractions']:
    if set(r)!={'retraction_id','session_id','visit_id','reason_code','observed_at','requested_at','input_fingerprint','prerequisites'}:raise ValueError('Unexpected ledger fields')
    if not re.fullmatch('[a-f0-9]{64}',r['input_fingerprint']):raise ValueError('Invalid fingerprint')
    if r['reason_code'] not in ('SENSITIVE_CONTENT','CONSENT_WITHDRAWN'):raise ValueError('Invalid reason')
    for k in ('observed_at','requested_at'):
        if not re.fullmatch(r'\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3,6}',r[k]):raise ValueError('Invalid time')
    rid,sid,vid=(uid(r[k]) for k in ('retraction_id','session_id','visit_id'))
    vals=[rid,sid,vid]+[text(r[k]) for k in ('reason_code','observed_at','requested_at','input_fingerprint')]
    sql += [f"INSERT IGNORE INTO privacy_retraction(retraction_id,session_id,visit_id,reason_code,observed_at,requested_at,input_fingerprint,processing_status,prerequisites) SELECT {','.join(vals)},'QUARANTINED',{text(r['prerequisites'])} WHERE EXISTS(SELECT 1 FROM work_session WHERE session_id={sid});",
            f'INSERT IGNORE INTO visit_tombstone(visit_id,session_id,retraction_id,created_at) SELECT {vid},{sid},{rid},UTC_TIMESTAMP(3) WHERE EXISTS(SELECT 1 FROM privacy_retraction WHERE retraction_id={rid} AND session_id={sid});']
sql += ["UPDATE analysis_window w JOIN work_session s ON s.session_id=w.session_id SET w.invalidated=TRUE,w.decision_dirty=FALSE WHERE s.privacy_status<>'CLEAR';",
        "UPDATE notification n JOIN work_session s ON s.session_id=n.session_id SET n.invalidated_at=COALESCE(n.invalidated_at,UTC_TIMESTAMP(3)) WHERE s.privacy_status<>'CLEAR' AND n.shown_at IS NULL;",
        'COMMIT;','-- Keep all services stopped. Reconcile AI journal and all external copies before reauthorization.']
fd=os.open(a.output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:f.write('\n'.join(sql)+'\n')
print('Prepared offline quarantine SQL; no database changed. Releases remain revoked.')

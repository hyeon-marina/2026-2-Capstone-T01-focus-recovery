"""Prepare an immutable policy from actual, privately retained decision records. No consent writes."""
import copy
import hashlib
import json
from datetime import date, timedelta
from pathlib import Path


def checksum(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def prepare(template, records, directory):
    n = copy.deepcopy(template)
    if records.get('confirmedByRecordOwner') is not True:
        raise ValueError('Actual record owner must verify all records; no automatic approval')
    for field in ['policyVersion', 'buildId', 'notBefore', 'expiresAt']:
        if not isinstance(records.get(field), str) or not records[field].strip():
            raise ValueError('Required: ' + field)
        n[field] = records[field]
    for field in ['teamDecisionRef', 'retentionRef', 'privacyEvidenceRef', 'startAuthorizationRef', 'goalReviewRef', 'institutionRef', 'siteReviewRef']:
        entry = records.get(field, {})
        path = Path(entry.get('file', ''))
        if not path.is_absolute():
            path = directory / path
        if path.is_symlink() or not path.is_file():
            raise ValueError('Missing actual evidence file: ' + field)
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if not raw.strip() or digest != entry.get('sha256'):
            raise ValueError('Evidence SHA-256 mismatch: ' + field)
        # Private records are retained by the team; never embed their contents or personal paths.
        n[field] = 'sha256:' + digest
    decision = records.get('institutionDecision')
    if decision not in ['NOT_REQUIRED', 'REQUIRED_SATISFIED']:
        raise ValueError('Actual institution decision required')
    n['institution'] = dict(decision=decision, evidenceRef=n.pop('institutionRef'))
    selected = records.get('sites')
    if template.get('siteScope') == 'PUBLIC_HTTP_HTTPS':
        selected = []
    elif not isinstance(selected, list) or not selected or any(s not in template['sites'] for s in selected):
        raise ValueError('Select only reviewed exact sites from the common policy')
    n['sites'] = selected
    n['status'] = 'CONFIRMED'
    n['plan']['revision'] = 1
    for goal in n['plan']['goals']:
        goal.update(status='CONFIRMED', evidenceRef=n['goalReviewRef'])
    n.pop('goalReviewRef')
    site_ref = n.pop('siteReviewRef')
    n['collectionScope'] += ' Site review: ' + site_ref
    n['retentionPolicy'] += ' Deletion register: ' + n['retentionRef']
    evaluation = records.get('finalEvaluationDate')
    if evaluation:
        n['retentionPolicy'] += ' Final evaluation: ' + evaluation + '; delete by: ' + (date.fromisoformat(evaluation) + timedelta(days=90)).isoformat()
    n['planChecksum'] = checksum(n['plan'])
    return n

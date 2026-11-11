"""A mounted, reviewed release is required in addition to the collection profile."""
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path


def approved_release():
    try:
        if os.getenv('AI_V2_PROFILE') != 'real-collection' or os.getenv('AI_V2_ENABLED') != '1':
            return False
        raw = Path(os.environ['COLLECTION_SITE_POLICY_FILE']).read_bytes()
        if len(raw) > 65536 or hashlib.sha256(raw).hexdigest() != os.environ['COLLECTION_POLICY_SHA256']:
            return False
        p = json.loads(raw)
        now = datetime.now(timezone.utc)
        if p['status'] != 'APPROVED' or not datetime.fromisoformat(p['notBefore'].replace('Z','+00:00')) <= now < datetime.fromisoformat(p['expiresAt'].replace('Z','+00:00')):
            return False
        return all(isinstance(p.get(k),str) and len(p[k]) >= 3 for k in ('buildId','policyId','policyVersion','approvalRef','contractApprovalRef','retentionRef','institutionRef','modelEvidenceRef','privacyEvidenceRef','startAuthorizationRef')) and bool(p['sites'])
    except (OSError, KeyError, ValueError, TypeError):
        return False

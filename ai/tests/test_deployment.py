import hashlib
import json
from datetime import datetime, timezone, timedelta
from v2.deployment import approved_release

def test_release_requires_reviewed_file_digest_and_expiry(tmp_path,monkeypatch):
    monkeypatch.setenv('AI_V2_PROFILE','real-collection');monkeypatch.setenv('AI_V2_ENABLED','1')
    assert not approved_release()
    now=datetime.now(timezone.utc)
    p={k:'synthetic-evidence' for k in ('buildId','policyId','policyVersion','approvalRef','contractApprovalRef','retentionRef','institutionRef','modelEvidenceRef','privacyEvidenceRef','startAuthorizationRef')}
    p.update(status='APPROVED',notBefore=(now-timedelta(hours=1)).isoformat(),expiresAt=(now+timedelta(hours=1)).isoformat(),sites=[{'origin':'https://example.org','pathPrefix':'/'}])
    f=tmp_path/'policy.json';raw=json.dumps(p).encode();f.write_bytes(raw)
    monkeypatch.setenv('COLLECTION_SITE_POLICY_FILE',str(f));monkeypatch.setenv('COLLECTION_POLICY_SHA256',hashlib.sha256(raw).hexdigest())
    assert approved_release()
    monkeypatch.setenv('COLLECTION_POLICY_SHA256','a'*64);assert not approved_release()
    p['status']='DRAFT';raw=json.dumps(p).encode();f.write_bytes(raw)
    monkeypatch.setenv('COLLECTION_POLICY_SHA256',hashlib.sha256(raw).hexdigest());assert not approved_release()

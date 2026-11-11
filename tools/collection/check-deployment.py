#!/usr/bin/env python3
"""Read-only preflight, no deployment or gate mutation. Exit 2 when prerequisites are absent."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
from datetime import datetime,timezone
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--env-file',required=True,type=Path);a=p.parse_args()
checks=[]
def check(name,ok):checks.append({'check':name,'status':'VERIFIED' if ok else 'BLOCKED'})
try:
 env={}
 for line in a.env_file.read_text().splitlines():
  if line.strip() and not line.lstrip().startswith('#'):
   k,v=line.split('=',1);env[k.strip()]=v.strip()
 raw=Path(env['COLLECTION_POLICY_FILE']).read_bytes();policy=json.loads(raw)
 check('policy_digest',hashlib.sha256(raw).hexdigest()==env['COLLECTION_POLICY_SHA256'])
 now=datetime.now(timezone.utc)
 check('approved_policy_artifact',policy['status']=='APPROVED' and datetime.fromisoformat(policy['notBefore'].replace('Z','+00:00'))<=now<datetime.fromisoformat(policy['expiresAt'].replace('Z','+00:00')))
 check('approval_evidence_references',all(policy.get(k) for k in ('approvalRef','contractApprovalRef','retentionRef','institutionRef','modelEvidenceRef','privacyEvidenceRef','startAuthorizationRef')))
 for name in ('mysql-root','spring.datasource.password','server.ssl.key-store-password','focus-recovery.v2.dispatch.service-token','focus-recovery.v2.retraction.service-secret'):
  f=Path(env['COLLECTION_SECRET_DIR'])/name
  check('protected_secret_'+name,f.is_file() and stat.S_IMODE(f.stat().st_mode)&0o077==0 and len(f.read_bytes())>=32)
 for name in ('backend.p12','backend-ca.pem','fullchain.pem','privkey.pem'):
  check('tls_'+name,(Path(env['COLLECTION_TLS_DIR'])/name).is_file())
 for name in ('qwen3-embedding','qwen3-4b'):
  d=Path(env['COLLECTION_MODEL_DIR'])/name
  check('model_files_'+name,(d/'config.json').is_file() and bool(list(d.glob('*.safetensors'))))
except (OSError,KeyError,ValueError,TypeError):check('configuration_complete',False)
# File checks cannot attest human approval or a live service.
checks.extend({'check':name,'status':'NOT_TESTED'} for name in ('database_release_authorization','public_https','real_model_inference','participants_consent','restored_retractions','three_person_pilot'))
print(json.dumps({'actualCollection':'BLOCKED','checks':checks},indent=2))
raise SystemExit(2 if any(c['status']=='BLOCKED' for c in checks) else 0)

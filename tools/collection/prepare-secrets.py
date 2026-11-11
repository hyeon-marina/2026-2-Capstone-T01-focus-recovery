#!/usr/bin/env python3
"""Prepare a NEW owner-only secret directory; never prints credentials or approval."""
import argparse
import os
from pathlib import Path
import secrets
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',required=True,type=Path);a=p.parse_args()
a.output.mkdir(mode=0o700,parents=True,exist_ok=False)
for name in ('mysql-root','spring.datasource.password','server.ssl.key-store-password','focus-recovery.v2.dispatch.service-token','focus-recovery.v2.retraction.service-secret'):
    fd=os.open(a.output/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f:f.write(secrets.token_urlsafe(48))
print('Created five protected secret files. No participant credential or policy was created.')

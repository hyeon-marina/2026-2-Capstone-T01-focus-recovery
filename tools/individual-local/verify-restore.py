#!/usr/bin/env python3
"""Restore ONLY an explicit SYNTHETIC-101 backup into a NEW schema; retain all source data.
Encrypts the backup, reapplies the latest metadata ledger, revokes releases and verifies quarantine.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid
import dataset as ds

if not __debug__:
    raise SystemExit('Validation requires Python without -O')

ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--fixture',required=True,type=Path);p.add_argument('--output',required=True,type=Path);p.add_argument('--recipient',required=True);a=p.parse_args()
c=json.loads(a.fixture.read_text());assert c['kind']=='SYNTHETIC-101' and c['container'].startswith('focus101-') and c['database']=='focus101_synthetic' and c['dbPort'] in (33111,33112,33113)
os.umask(0o077);a.output.mkdir(parents=True,exist_ok=False,mode=0o700)
def execute(command,body=''):
    r=subprocess.run(['docker','exec','-i',c['container'],'sh','-c','IFS= read -r MYSQL_PWD; export MYSQL_PWD; exec '+command],input=c['password']+'\n'+body,text=True,capture_output=True)
    if r.returncode:raise RuntimeError('Synthetic backup/restore command failed; no successful result published')
    return r.stdout
subprocess.run(['docker','start',c['container']],check=True,capture_output=True)
try:
    import time
    for _ in range(150):
        try:execute('mysql -uroot','SELECT 1;');break
        except RuntimeError:time.sleep(.2)
    else:raise RuntimeError('MySQL not ready')
    ledger=execute('mysql -uroot --batch --raw --skip-column-names focus101_synthetic',(ROOT/'tools/collection/retraction-ledger.sql').read_text())
    raw=execute('mysqldump -uroot --single-transaction --no-tablespaces --set-gtid-purged=OFF focus101_synthetic')
    ds.publish(a.output/'backup.sql.age',ds.age(raw.encode(),recipient=a.recipient))
    ds.publish(a.output/'privacy-ledger.json',ledger.encode())
    subprocess.run([sys.executable,str(ROOT/'tools/collection/restore-quarantine.py'),'--ledger',str(a.output/'privacy-ledger.json'),'--output',str(a.output/'quarantine.sql')],check=True,capture_output=True)
    schema='focus101_restore_'+uuid.uuid4().hex
    execute('mysql -uroot','CREATE DATABASE '+schema+';\nUSE '+schema+';\n'+raw+'\n'+(a.output/'quarantine.sql').read_text())
    query="SELECT COUNT(*) FROM page_visit; SELECT COUNT(*) FROM work_session WHERE privacy_status='QUARANTINED'; SELECT COUNT(*) FROM participant WHERE withdrawn_at IS NOT NULL; SELECT COUNT(*) FROM collection_release WHERE revoked_at IS NULL; SELECT COUNT(*) FROM collection_export_audit;"
    counts=[int(x) for x in execute('mysql -uroot --batch --skip-column-names '+schema,query).split()]
    source=[int(x) for x in execute('mysql -uroot --batch --skip-column-names focus101_synthetic',query).split()]
    metadata=json.loads(ledger)
    assert counts[0]==source[0] and counts[1]>=len(metadata['sessions']) and counts[2]>=len(metadata['participants']) and counts[3]==0 and counts[4]==source[4]
    result=dict(result='PASS',kind='SYNTHETIC-101-RESTORE',schema=schema,visits=counts[0],quarantinedSessions=counts[1],withdrawnParticipants=counts[2],activeReleases=counts[3],exportAudits=counts[4],sourceRowsPreserved=True,purged=False)
    ds.publish(a.output/'validation.json',ds.encoded(result));print(json.dumps(result))
finally:subprocess.run(['docker','stop',c['container']],capture_output=True)

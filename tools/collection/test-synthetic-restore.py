#!/usr/bin/env python3
"""Copy ONLY the dedicated synthetic DB into a NEW schema and verify restore quarantine.
Never changes/deletes source rows or existing schemas; leaves the new test schema for inspection.
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path
import uuid
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--db-file',required=True,type=Path);a=p.parse_args()
d=json.loads(a.db_file.read_text())
if d['database']!='focus97_synthetic' or d['port']!=3397 or not d['container'].startswith('focus97-'):p.error('Dedicated synthetic DB only')
base=['docker','exec','-i',d['container'],'sh','-c']
def execute(cmd,body):
    r=subprocess.run(base+['IFS= read -r MYSQL_PWD; export MYSQL_PWD; exec '+cmd],input=d['password']+'\n'+body,text=True,capture_output=True)
    if r.returncode:raise SystemExit('Synthetic DB command failed; no credentials or payload printed')
    return r.stdout
root=Path(__file__).resolve().parent
ledger=execute('mysql -uroot --batch --raw --skip-column-names focus97_synthetic',(root/'retraction-ledger.sql').read_text())
raw=execute('mysqldump -uroot --single-transaction --no-tablespaces --set-gtid-purged=OFF focus97_synthetic','')
schema='focus97_restore99_'+uuid.uuid4().hex
with tempfile.TemporaryDirectory(prefix='focus99-restore-') as t:
    source=Path(t)/'ledger.json';source.write_text(ledger);source.chmod(0o600)
    output=Path(t)/'restore.sql'
    subprocess.run([sys.executable,str(root/'restore-quarantine.py'),'--ledger',str(source),'--output',str(output)],check=True,capture_output=True)
    execute('mysql -uroot','CREATE DATABASE '+schema+';\nUSE '+schema+';\n'+raw+'\n'+output.read_text())
result=execute('mysql -uroot --batch --skip-column-names '+schema,"SELECT COUNT(*) FROM collection_release WHERE revoked_at IS NULL; SELECT COUNT(*) FROM participant WHERE withdrawn_at IS NOT NULL; SELECT COUNT(*) FROM work_session WHERE privacy_status='QUARANTINED'; SELECT COUNT(*) FROM visit_tombstone;")
counts=[int(v) for v in result.split()]
assert counts[0]==0
metadata=json.loads(ledger)
assert counts[1]>=len(metadata['participants']) and counts[2]>=len(metadata['sessions'])
print(json.dumps({'kind':'isolated-synthetic-restore','schema':schema,'activeReleases':counts[0],'withdrawnParticipants':counts[1],'quarantinedSessions':counts[2],'tombstones':counts[3],'purged':False}))

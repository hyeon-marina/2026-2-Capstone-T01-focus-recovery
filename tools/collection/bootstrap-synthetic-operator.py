#!/usr/bin/env python3
"""Offline bootstrap for the dedicated synthetic MySQL DB; no HTTP/default administrator."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--db-file', type=Path, required=True)
p.add_argument('--identity-reference-hash', required=True)
p.add_argument('--authority-ref', required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
db = json.loads(a.db_file.read_text())
if db['database'] != 'focus97_synthetic' or db['port'] != 3397 or not db['container'].startswith('focus97-') or a.output.exists():
    p.error('Fresh synthetic DB and new credential output file required')
root = Path(__file__).resolve().parents[2]
jars = [j for j in (root / 'be/build/libs').glob('*-SNAPSHOT.jar') if not j.name.endswith('-plain.jar')]
if len(jars) != 1:
    p.error('Build exactly one bootJar first')
with tempfile.NamedTemporaryFile(mode='w', suffix='.json', encoding='utf-8') as request:
    json.dump({'identityReferenceHash': a.identity_reference_hash, 'authorityRef': a.authority_ref, 'credentialFile': str(a.output.resolve())}, request)
    request.flush()
    env = os.environ.copy()
    env.update(DB_URL='jdbc:mysql://127.0.0.1:3397/focus97_synthetic?serverTimezone=UTC', DB_USERNAME='root', DB_PASSWORD=db['password'])
    result = subprocess.run([os.environ.get('COLLECTION_JAVA', 'java'), '-jar', str(jars[0]), '--spring.main.web-application-type=none', '--focus-recovery.collection.bootstrap-request=' + request.name], env=env)
raise SystemExit(result.returncode)

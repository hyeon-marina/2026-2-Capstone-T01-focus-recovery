#!/usr/bin/env python3
"""Start a fresh isolated MySQL container, never reuse an existing volume/container."""
import argparse
import json
import secrets
import subprocess
from pathlib import Path
from manage import write_secret

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--name', default='focus97-mysql-synthetic')
a = p.parse_args()
if not a.name.startswith('focus97-') or not all(c.isalnum() or c == '-' for c in a.name):
    p.error('Use a focus97- prefixed container name')
if a.output.exists():
    p.error('Output must be a new owner-only file')
password = secrets.token_urlsafe(32)
write_secret(a.output, {'container': a.name, 'database': 'focus97_synthetic', 'port': 3397, 'password': password})
# Secrets go through stdin, not the command line or console.
result = subprocess.run(['docker', 'run', '--name', a.name, '--detach', '--publish', '127.0.0.1:3397:3306',
    '--env-file', '/dev/stdin', 'mysql:8.4'], input=f'MYSQL_ROOT_PASSWORD={password}\nMYSQL_DATABASE=focus97_synthetic\n', text=True, capture_output=True)
if result.returncode:
    raise SystemExit('Database start failed; reserved secret file retained. Check Docker availability, name and port. No container was reused or removed.')
print(json.dumps({'container': a.name, 'port': 3397, 'database': 'focus97_synthetic', 'credentialsFile': str(a.output)}))

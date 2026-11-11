#!/usr/bin/env python3
"""Run Gradle against only the newly created loopback synthetic database."""
import argparse
import json
import os
from pathlib import Path
import subprocess

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--db-file', type=Path, required=True)
p.add_argument('--chrome')
p.add_argument('--ai-url', default='http://127.0.0.1:8897')
p.add_argument('--all', action='store_true')
a = p.parse_args()
if a.ai_url != 'http://127.0.0.1:8897':
    p.error('Dedicated synthetic AI port 8897 required')
db = json.loads(a.db_file.read_text())
if db['database'] != 'focus97_synthetic' or db['port'] != 3397 or not db['container'].startswith('focus97-'):
    p.error('Fresh focus97 synthetic DB required')
env = os.environ.copy()
env.update(FOCUS97_MYSQL_URL='jdbc:mysql://127.0.0.1:3397/focus97_synthetic?serverTimezone=UTC', FOCUS97_MYSQL_PASSWORD=db['password'], FOCUS97_AI_URL=a.ai_url)
if a.chrome:
    env['CHROMIUM_PATH'] = a.chrome
root = Path(__file__).resolve().parents[2]
command = ['./gradlew', 'test', '--rerun-tasks', '--console=plain']
if not a.all:
    command += ['--tests', '*Collection*Test', '--tests', '*V15MigrationTest', '--tests', '*V16MigrationTest']
command += ['bootJar']
raise SystemExit(subprocess.run(command, cwd=root / 'be', env=env).returncode)

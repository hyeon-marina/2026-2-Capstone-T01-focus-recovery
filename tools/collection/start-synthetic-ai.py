#!/usr/bin/env python3
"""Run existing FastAPI with explicitly mocked models and a durable synthetic journal."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--secrets-file', type=Path, required=True)
p.add_argument('--journal', type=Path, required=True)
a = p.parse_args()
secrets = json.loads(a.secrets_file.read_text())
if any(not isinstance(secrets.get(k), str) or len(secrets[k]) < 32 for k in ('serviceToken', 'retractionSecret')):
    p.error('Explicit independently generated service secrets required')
env = os.environ.copy()
env.update(AI_V2_PROFILE='synthetic-test', AI_V2_ENABLED='1', AI_V2_SERVICE_TOKEN=secrets['serviceToken'], AI_RETRACTION_SECRET=secrets['retractionSecret'])
root = Path(__file__).resolve().parents[2]
raise SystemExit(subprocess.run([sys.executable, str(root / 'be/src/test/python/v2_http_fixture.py'), '--port', '8897', '--retraction-journal', str(a.journal.resolve())], cwd=root, env=env).returncode)

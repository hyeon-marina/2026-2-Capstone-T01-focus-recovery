"""Validate synthetic FE wire evidence against the unchanged shared schema."""
import argparse
import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / 'docs/contracts/v2/v2.schema.json').read_text())
parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
args = parser.parse_args()

def validate(contract, value):
    schema = {'$ref': f'#/$defs/{contract}', '$defs': SCHEMA['$defs']}
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(value)

count = 0
for name, contract in [('post', 'PageVisitPost'), ('post-ack', 'PageVisitAck'), ('patch', 'BehaviorPatch'), ('patch-ack', 'BehaviorAck')]:
    path = args.directory / f'{name}.json'
    if path.exists():
        validate(contract, json.loads(path.read_text())); count += 1
path = args.directory / 'status.json'
if path.exists():
    data = json.loads(path.read_text())
    projection = {key: data[key] for key in ['apiContractVersion', 'sessionId', 'sessionStatus', 'currentDecision', 'lastSuccessfulState', 'alert']}
    if projection['alert']:
        projection['alert'] = {k: projection['alert'][k] for k in SCHEMA['$defs']['AlertCandidate']['properties']}
    validate('StatusResponse', projection); count += 1
assert count >= 4, 'Generate browser evidence first'
print(f'PASS: {count} synthetic FE wire artifacts/visits, shared Draft2020-12 Schema + FormatChecker')

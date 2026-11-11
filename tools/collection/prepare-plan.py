#!/usr/bin/env python3
"""Merge DRAFT goal candidates into a freshly fetched operator plan; never confirm goals."""
import argparse
import json
from pathlib import Path
from manage import write_secret
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--plan',required=True,type=Path)
p.add_argument('--output',required=True,type=Path)
a=p.parse_args()
plan=json.loads(a.plan.read_text())
candidates=json.loads((Path(__file__).resolve().parents[2]/'docs/data-collection/goals.candidates.json').read_text())
by_id={g['goalId']:g for g in candidates['goals']}
assert len(plan['goals'])==20 and len(plan['assignments'])==160
for g in plan['goals']:
    if g['status']=='DRAFT':g['description']=by_id[g['goalId']]['description']
write_secret(a.output,plan)
print('Prepared draft descriptions. Review before save-plan; no approval or registration performed.')

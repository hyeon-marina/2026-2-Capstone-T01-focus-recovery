import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import policy

class PolicyTest(unittest.TestCase):
    def test_requires_real_records_and_preserves_plan(self):
        root=Path(__file__).resolve().parents[2]/'docs/data-collection'
        template=json.loads((root/'TEAM_POLICY.json').read_text())
        records=json.loads((root/'policy-records.template.json').read_text())
        with tempfile.TemporaryDirectory() as temp:
            directory=Path(temp)
            with self.assertRaises(ValueError):policy.prepare(template,records,directory)
            records['confirmedByRecordOwner']=True
            with self.assertRaises(ValueError):policy.prepare(template,records,directory)
            # Synthetic evidence tests the mechanism, never published as an actual team decision.
            evidence=directory/'synthetic.txt';evidence.write_text('SYNTHETIC TEST ONLY')
            for k in list(records):
                if k.endswith('Ref'):records[k]={'file':evidence.name,'sha256':hashlib.sha256(evidence.read_bytes()).hexdigest()}
            records.update(institutionDecision='NOT_REQUIRED',notBefore='2026-11-11T00:00:00Z',expiresAt='2026-11-12T00:00:00Z',finalEvaluationDate='2026-12-01')
            n=policy.prepare(template,records,directory)
            self.assertEqual(n['plan']['assignments'],template['plan']['assignments'])
            self.assertEqual([g['description'] for g in n['plan']['goals']],[g['description'] for g in template['plan']['goals']])
            self.assertIn('2027-03-01',n['retentionPolicy'])
            self.assertEqual(n['planChecksum'],policy.checksum(n['plan']))
            records['teamDecisionRef']['sha256']='0'*64
            with self.assertRaises(ValueError):policy.prepare(template,records,directory)

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
class RestoreTest(unittest.TestCase):
 def test_conservative_restore_keeps_release_closed_and_rejects_invalid_ids(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);ledger=root/'ledger.json';out=root/'restore.sql'
   ledger.write_text(json.dumps({'participants':['99000000-0000-4000-8000-000000000001'],'sessions':[],'retractions':[]}))
   script=Path(__file__).with_name('restore-quarantine.py')
   self.assertEqual(subprocess.run([sys.executable,str(script),'--ledger',str(ledger),'--output',str(out)],capture_output=True).returncode,0)
   sql=out.read_text();self.assertIn('UPDATE collection_release SET revoked_at=',sql);self.assertIn("privacy_status='QUARANTINED'",sql)
   ledger.write_text(json.dumps({'participants':['invalid\';DROP TABLE participant;--'],'sessions':[],'retractions':[]}))
   self.assertNotEqual(subprocess.run([sys.executable,str(script),'--ledger',str(ledger),'--output',str(root/'invalid.sql')],capture_output=True).returncode,0)
if __name__=='__main__':unittest.main()

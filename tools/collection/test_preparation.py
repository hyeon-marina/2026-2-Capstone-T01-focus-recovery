import json
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
ROOT=Path(__file__).parent
class PreparationTest(unittest.TestCase):
 def test_model_download_rejects_mutable_revision_before_network(self):
  with tempfile.TemporaryDirectory() as t:
   target=Path(t)/'models'
   r=subprocess.run([sys.executable,str(ROOT/'prepare-models.py'),'--embedding-revision','main','--context-revision','a'*40,'--output',str(target)],capture_output=True)
   self.assertEqual(r.returncode,2);self.assertFalse(target.exists())
 def test_secret_files_are_new_private_and_not_printed(self):
  with tempfile.TemporaryDirectory() as t:
   target=Path(t)/'secrets';cmd=[sys.executable,str(ROOT/'prepare-secrets.py'),'--output',str(target)]
   r=subprocess.run(cmd,capture_output=True);self.assertEqual(r.returncode,0)
   self.assertEqual(len(list(target.iterdir())),5)
   for f in target.iterdir():
    self.assertEqual(stat.S_IMODE(f.stat().st_mode),0o600);self.assertNotIn(f.read_bytes(),r.stdout+r.stderr)
   self.assertNotEqual(subprocess.run(cmd,capture_output=True).returncode,0)
 def test_missing_deployment_configuration_is_blocked(self):
  with tempfile.TemporaryDirectory() as t:
   f=Path(t)/'env';f.write_text('COLLECTION_POLICY_FILE=\n')
   r=subprocess.run([sys.executable,str(ROOT/'check-deployment.py'),'--env-file',str(f)],capture_output=True)
   self.assertEqual(r.returncode,2);self.assertEqual(json.loads(r.stdout)['actualCollection'],'BLOCKED')
if __name__=='__main__':unittest.main()

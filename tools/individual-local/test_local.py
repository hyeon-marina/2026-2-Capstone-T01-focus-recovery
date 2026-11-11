import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import local

class LocalTest(unittest.TestCase):
    def test_initialization_never_reuses_an_existing_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            target=Path(temp);marker=target/'keep';marker.write_text('existing data')
            with patch.object(sys,'argv',['local.py','--directory',str(target),'init','--slot','A']):
                with self.assertRaises(FileExistsError):local.main()
            self.assertEqual(marker.read_text(),'existing data');self.assertEqual(len(list(target.iterdir())),1)
    def test_stop_cannot_kill_a_reused_pid(self):
        with tempfile.TemporaryDirectory() as temp:
            target=Path(temp);(target/'config.json').write_text(json.dumps(dict(project='focus-local-synthetic',dbPort=33101,tlsPort=9443)))
            (target/'backend.json').write_text(json.dumps(dict(pid=123,nonce='expected-instance')))
            with patch.object(sys,'argv',['local.py','--directory',str(target),'stop']),patch('local.subprocess.run',return_value=subprocess.CompletedProcess([],0,stdout='focus.local.instance=other\n')),patch('local.os.kill') as kill:
                with self.assertRaisesRegex(ValueError,'identity not verified'):local.main()
                kill.assert_not_called()
            self.assertTrue((target/'backend.json').exists())
    def test_profile_is_explicit_and_secrets_are_paths(self):
        env=local.env_for(dict(dbPort=33101,tlsPort=9443),Path('/synthetic/private'))
        self.assertEqual(env['SPRING_PROFILES_ACTIVE'],'individual-local')
        self.assertEqual(env['COLLECTION_SECRETS_DIR'],'/synthetic/private/secrets')
        self.assertNotIn('DB_PASSWORD', {k:env[k] for k in env if k.startswith('COLLECTION_')})
    def test_new_secret_is_owner_only_and_does_not_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            file=Path(temp)/'secret';local.private(file,'synthetic-secret')
            with self.assertRaises(FileExistsError):local.private(file,'replacement')
            self.assertEqual(file.read_text(),'synthetic-secret')

if __name__=='__main__':unittest.main()

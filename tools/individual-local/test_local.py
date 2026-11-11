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

class SelfSetupTest(unittest.TestCase):
    def test_requires_slot_and_prevents_other_slot(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as temp:
            d=Path(temp);local.private(d/'config.json',json.dumps(dict(slot='A')))
            a=SimpleNamespace(slot='B')
            with patch.object(local,'prerequisites'):
                with self.assertRaisesRegex(ValueError,'LOCAL_SLOT_MISMATCH'):local.self_setup(a,d)
            self.assertFalse((d/'owner.key').exists())
    @unittest.skipIf(sys.platform=='win32','POSIX permission test')
    def test_refuses_shared_and_symlink_inputs(self):
        import os
        with tempfile.TemporaryDirectory() as temp:
            d=Path(temp);file=d/'key';local.private(file,'synthetic')
            file.chmod(0o644)
            with self.assertRaisesRegex(ValueError,'LOCAL_OWNER'):local.protected(d)
            file.chmod(0o600);local.protected(d)
            (d/'link').symlink_to(file)
            with self.assertRaisesRegex(ValueError,'symlink'):local.protected(d)
    def test_plan_checksum_is_sorted_compact_utf8(self):
        import hashlib
        import io
        from contextlib import redirect_stdout
        with tempfile.TemporaryDirectory() as temp:
            file=Path(temp)/'policy.json';file.write_text(json.dumps(dict(plan=dict(revision=1,goals=['합성']))))
            result=io.StringIO()
            with redirect_stdout(result):local.main(['policy-checksum','--policy',str(file)])
            expected=hashlib.sha256('{"goals":["합성"],"revision":1}'.encode()).hexdigest()
            self.assertIn(expected,result.getvalue())


class RuntimeJarTest(unittest.TestCase):
    def test_running_jar_is_not_changed_by_workspace_rebuild(self):
        with tempfile.TemporaryDirectory() as temp:
            directory=Path(temp);source=directory/'source.jar';source.write_bytes(b'old-build')
            with patch.object(local,'jar',return_value=source):
                runtime=local.runtime_jar(directory,'backend-runtime.jar')
            source.write_bytes(b'new-build')
            self.assertEqual(runtime.read_bytes(),b'old-build')

class DefaultPolicyTest(unittest.TestCase):
    def test_repository_policy_is_default_and_checksum_is_required(self):
        from types import SimpleNamespace
        import hashlib
        with tempfile.TemporaryDirectory() as temp:
            d=Path(temp);a=SimpleNamespace(policy=None,policy_sha256=None)
            raw,digest=local.selected_policy(a,d,{})
            value=json.loads(raw)
            self.assertEqual(value['status'],'CONFIRMED')
            self.assertEqual(value['plan']['revision'],1)
            self.assertEqual(value['institution']['decision'],'UNRESOLVED')
            self.assertEqual(hashlib.sha256(raw).hexdigest(),digest)
            local.private(d/'site-policy.json',raw.decode())
            self.assertEqual(local.selected_policy(a,d,dict(policySha256=digest)),(raw,digest))
            (d/'site-policy.json').write_bytes(raw+b' ')
            with self.assertRaisesRegex(ValueError,'LOCAL_POLICY_CHECKSUM'):
                local.selected_policy(a,d,dict(policySha256=digest))
    def test_custom_policy_cannot_skip_checksum(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'policy.json';p.write_text('{}')
            with self.assertRaisesRegex(ValueError,'LOCAL_POLICY_CHECKSUM'):
                local.selected_policy(SimpleNamespace(policy=p,policy_sha256=None),p.parent,{})

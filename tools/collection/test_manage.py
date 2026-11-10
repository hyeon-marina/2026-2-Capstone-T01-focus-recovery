import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
spec = importlib.util.spec_from_file_location('manage', Path(__file__).with_name('manage.py'))
manage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manage)


class SecretFileTest(unittest.TestCase):
    def test_owner_only_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'credential.json'
            manage.write_secret(path, {'credential': 'synthetic-test'})
            self.assertEqual(json.loads(path.read_text())['credential'], 'synthetic-test')
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            with self.assertRaises(FileExistsError):
                manage.write_secret(path, {'credential': 'replaced'})

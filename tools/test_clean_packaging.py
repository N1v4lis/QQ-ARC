import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('packager', Path(__file__).with_name('package-clean-experimental.py'))
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)

class PackagingTests(unittest.TestCase):
    def test_existing_app_and_user_data_are_never_overwritten(self):
        with tempfile.TemporaryDirectory(prefix='qqaf-packaging-check-') as tmp:
            root = Path(tmp)
            source, output = root / 'source', root / 'output'
            source.mkdir()
            output.mkdir()
            (source / 'build-info.json').write_text(json.dumps({'version': '0.2.0'}))
            (source / 'qqaf.exe').write_bytes(b'new program fixture')
            existing = output / 'RS0.2.0-Resonance'
            existing.mkdir()
            (existing / 'build-info.json').write_text('existing bundle')
            (existing / 'qqaf.exe').write_bytes(b'running program fixture')
            (existing / 'user.sqlite').write_bytes(b'preserved user fixture')
            snapshot = {p.name: p.read_bytes() for p in existing.iterdir()}
            with patch.object(packager, 'verify', return_value={'verified': True}):
                result = packager.package(source, output)
            self.assertNotEqual(Path(result['directory']), existing)
            self.assertEqual(snapshot, {p.name: p.read_bytes() for p in existing.iterdir()})
            self.assertEqual((Path(result['directory']) / 'qqaf.exe').read_bytes(), b'new program fixture')

if __name__ == '__main__':
    unittest.main()

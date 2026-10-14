"""Piano install reuse/repair and browser-only offline preparation."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import piano_assets
import live


class PianoAssetsTest(unittest.TestCase):
    def test_reuse_repair_and_atomic_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); source = root/'C4.mp3'; data = b'sample fixture'; source.write_bytes(data)
            lock = root/'lock.json'; lock.write_text(json.dumps({'files': [{'path': 'C4.mp3', 'url': source.as_uri(), 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}]}))
            destination = root/'piano'
            piano_assets.prepare(destination, lock)
            with patch('urllib.request.urlopen', side_effect=AssertionError('must reuse verified sample')):
                piano_assets.prepare(destination, lock)
            (destination/'C4.mp3').write_bytes(b'corrupt')
            piano_assets.prepare(destination, lock)
            self.assertEqual((destination/'C4.mp3').read_bytes(), data)
            (destination/'C4.mp3').unlink(); source.write_bytes(b'bad download')
            with self.assertRaisesRegex(ValueError, 'Piano asset checksum mismatch'):
                piano_assets.prepare(destination, lock)
            self.assertFalse((destination/'ready.json').exists())
            self.assertFalse(list(destination.glob('*.partial')))

    def test_browser_only_offline_includes_piano(self):
        with patch('live.os.makedirs'), patch('live.os.path.exists', return_value=True), patch('live.prepare_scene_assets') as scene, patch('live.prepare_piano_assets') as piano, patch('magenta_install.prepare') as magenta:
            live.offline(magenta=False)
            scene.assert_called_once(); piano.assert_called_once(); magenta.assert_not_called()

    def test_pinned_manifest(self):
        lock = json.loads(piano_assets.LOCK.read_text())
        self.assertEqual([f['midi'] for f in lock['files'] if 'midi' in f], [60, 63, 66, 69, 72])
        self.assertEqual(lock['license'], 'CC BY 3.0')
        self.assertIn('Alexander Holm', lock['attribution'])
        self.assertTrue(all(lock['revision'] in f['url'] and len(f['sha256']) == 64 for f in lock['files']))
        self.assertTrue(any(f['path'] == 'README' for f in lock['files']))


if __name__ == '__main__':
    unittest.main()

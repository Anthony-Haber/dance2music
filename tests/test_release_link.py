import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('release_link', Path(__file__).resolve().parents[1] / 'packaging/macos/release_link.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ReleaseTests(unittest.TestCase):
    def test_only_completed_matching_release_is_linked(self):
        name = 'Dance2Music-1.2.3-arm64.dmg'
        digest = 'a' * 64
        url = 'https://github.com/Music-Intelligence-Lab/dance2music/releases/download/mac-v1.2.3/' + name
        asset = {'name': name, 'state': 'uploaded', 'size': 1234, 'browser_download_url': url, 'digest': 'sha256:' + digest}
        release = {'tag_name': 'mac-v1.2.3', 'published_at': '2026-10-19', 'draft': False, 'prerelease': False, 'assets': [asset]}
        manifest = {'version': '1.2.3', 'file': name, 'sha256': digest, 'bytes': 1234, 'notarized': True, 'architecture': 'arm64', 'minimum_macos': '14.0'}
        checksums = f'{digest}  {name}\n'
        self.assertEqual(MODULE.release_info(release, manifest, checksums)['url'], url)
        for update in ({'draft': True}, {'prerelease': True}, {'published_at': None}, {'tag_name': 'mac-v1.2.4'}, {'assets': []}):
            self.assertIsNone(MODULE.release_info({**release, **update}, manifest, checksums))
        for update in ({'notarized': False}, {'sha256': 'b' * 64}, {'bytes': 2**31}, {'version': '../other'}):
            self.assertIsNone(MODULE.release_info(release, {**manifest, **update}, checksums))
        self.assertIsNone(MODULE.release_info(release, manifest, 'wrong checksum'))
        self.assertIsNone(MODULE.release_info({**release, 'assets': [{**asset, 'digest': 'sha256:' + 'b' * 64}]}, manifest, checksums))


if __name__ == '__main__':
    unittest.main()

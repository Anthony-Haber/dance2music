"""Setup recovery, corrupt assets, relocatable receipts, and local HTTP boundaries."""
import hashlib
import http.client
import io
import json
from pathlib import Path
import shutil
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from launcher_assets import Installation, SetupError, prepare, read_catalog
from live import create_server
from magenta_assets import sha256
from magenta_runtime import MagentaRuntime


def descriptor(path, data):
    return {'path': path, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'url': 'https://example.invalid/' + path}


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.files = [descriptor('a', b'first'), descriptor('b', b'second')]
        self.events = []
        self.emit = lambda event, **fields: self.events.append((event, fields))

    def test_interruption_retry_offline_reuse_and_corruption(self):
        def interrupted(url, **_):
            if url.endswith('/b'):
                raise urllib.error.URLError('offline')
            return io.BytesIO(b'first')
        with self.assertRaisesRegex(SetupError, 'needs internet'):
            prepare(self.root, self.files, {}, self.emit, opener=interrupted)
        self.assertEqual((self.root / 'a').read_bytes(), b'first')
        self.assertFalse((self.root / 'installation.json').exists())
        self.assertFalse(list(self.root.glob('*.part')))
        (self.root / 'b.part').write_bytes(b'interrupted old download')
        requested = []
        def complete(url, **_):
            requested.append(url)
            return io.BytesIO(b'second')
        receipt = prepare(self.root, self.files, {}, self.emit, opener=complete)
        self.assertFalse((self.root / 'b.part').exists())
        self.assertEqual(len(requested), 1)
        self.assertNotIn(str(self.root), json.dumps(receipt))
        with patch('urllib.request.urlopen', side_effect=AssertionError('No network')) as network:
            prepare(self.root, self.files, {}, self.emit, opener=network)
        (self.root / 'a').write_bytes(b'wrong')  # same size must still fail
        with self.assertRaisesRegex(SetupError, 'missing or corrupt'):
            prepare(self.root, self.files, {}, self.emit)
        self.assertFalse((self.root / 'installation.json').exists())
        prepare(self.root, self.files, {}, self.emit, repair=True, opener=lambda *a, **k: io.BytesIO(b'first'))
        self.assertEqual(self.events[-1], ('verified', {'completed_bytes': 11, 'total_bytes': 11}))

    def test_checksum_and_disk_space_do_not_publish_readiness(self):
        for data in (b'wrong', b'too many bytes', b''):
            with self.assertRaises(SetupError):
                prepare(self.root, self.files, {'browser/ready.json': {}}, self.emit, opener=lambda *a, **k: io.BytesIO(data))
            self.assertFalse((self.root / 'installation.json').exists())
            self.assertFalse((self.root / 'browser/ready.json').exists())
            self.assertFalse(list(self.root.glob('*.part')))
        with patch('launcher_assets.shutil.disk_usage', return_value=SimpleNamespace(free=0)), patch('urllib.request.urlopen') as network:
            with self.assertRaisesRegex(SetupError, 'Free at least'):
                prepare(self.root, self.files, {}, self.emit, opener=network)
            network.assert_not_called()

    def test_upgrade_preserves_verified_compatible_assets(self):
        prepare(self.root, self.files[:1], {}, self.emit, opener=lambda *a, **k: io.BytesIO(b'first'))
        fetched = []
        def download(url, **_):
            fetched.append(url)
            return io.BytesIO(b'second')
        prepare(self.root, self.files, {}, self.emit, opener=download)
        self.assertEqual(fetched, [self.files[1]['url']])

    def test_catalog_pins_all_assets(self):
        files, markers = read_catalog(Path(__file__).resolve().parents[1])
        self.assertEqual(len(markers), 3)
        self.assertGreater(sum(a['bytes'] for a in files), 4_000_000_000)
        for a in files:
            self.assertEqual(len(a['sha256']), 64)
            self.assertGreater(a['bytes'], 0)
            self.assertNotIn('/latest/', a['url'])

    def test_relocation_and_signed_binary_tampering(self):
        resources = self.root / 'original/Contents/Resources'
        resources.mkdir(parents=True)
        repo = Path(__file__).resolve().parents[1]
        for relative in ['native/magenta/manifest.lock.json'] + [f'web/live/{name}-assets.lock.json' for name in ('mediapipe', 'scene', 'piano')]:
            target = resources / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(repo / relative, target)
        records = []
        for relative in ('Helpers/mrt2/mrt2_helper', 'Helpers/mrt2/mlx.metallib', 'Helpers/backend/dance2music-backend'):
            target = resources.parent / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b'binary')
            records.append(descriptor(relative, b'binary'))
        (resources / 'binaries.json').write_text(json.dumps({'schema': 1, 'files': records}))
        relocated = self.root / 'Moved App'
        (self.root / 'original').rename(relocated)
        installation = Installation(relocated / 'Contents/Resources', self.root / 'state')
        installation.verify_binaries()
        helper = relocated / 'Contents/Helpers/mrt2/mrt2_helper'
        helper.write_bytes(b'tamper')
        with self.assertRaisesRegex(SetupError, 'corrupt'):
            installation.verify_binaries()


class ServerTests(unittest.TestCase):
    def test_overlay_host_origin_port_and_csp(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            web = root / 'app/web'
            web.mkdir(parents=True)
            browser = root / 'state/browser/scene'
            browser.mkdir(parents=True)
            (browser / 'ready.json').write_text('{}')
            (web / 'index.html').write_text('bundled')
            runtime = MagentaRuntime(root / 'state', installation_check=lambda: (None, None, {'schema': 2}))
            server = create_server(web, runtime, browser_root=browser.parent, port=0, packaged=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            def get(path, headers=None):
                connection = http.client.HTTPConnection('127.0.0.1', server.server_port)
                connection.request('GET', path, headers=headers or {})
                result = connection.getresponse()
                data = result.read()
                connection.close()
                return result, data
            try:
                result, data = get('/live/vendor/scene/ready.json')
                self.assertEqual((result.status, data), (200, b'{}'))
                self.assertIn("connect-src 'self'", result.getheader('Content-Security-Policy'))
                self.assertEqual(get('/index.html')[1], b'bundled')
                self.assertEqual(get('/app/config')[1], b'{"packaged": true}')
                self.assertEqual(get('/index.html', {'Host': 'attacker.test'})[0].status, 403)
                self.assertEqual(get('/magenta/status', {'Origin': 'https://public.test', 'X-D2M-Local': '1'})[0].status, 403)
                self.assertEqual(get('/magenta/status', {'X-D2M-Local': '1'})[0].status, 200)
                with self.assertRaises(OSError):
                    create_server(web, runtime, port=server.server_port)
            finally:
                server.shutdown(); server.server_close(); thread.join()


if __name__ == '__main__':
    unittest.main()

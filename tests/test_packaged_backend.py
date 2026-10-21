"""Real backend process lifecycle with tiny offline fixture assets."""
import hashlib
import errno
import http.client
import json
import os
from pathlib import Path
import selectors
import socket
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.resources = self.root / 'Moved App.app/Contents/Resources'
        self.state = self.root / 'state'
        self.resources.mkdir(parents=True)
        self.state.mkdir()
        record = []
        for relative in ('Helpers/mrt2/mrt2_helper', 'Helpers/mrt2/mlx.metallib', 'Helpers/backend/dance2music-backend'):
            path = self.resources.parent / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'fixture')
            record.append({'path': relative, 'bytes': 7, 'sha256': hashlib.sha256(b'fixture').hexdigest()})
        (self.resources / 'binaries.json').write_text(json.dumps({'schema': 1, 'files': record}))
        native = self.resources / 'native/magenta'
        native.mkdir(parents=True)
        (native / 'manifest.lock.json').write_text(json.dumps({'models': {'revision': 'fixture', 'assets': []}}))
        web = self.resources / 'web/live'
        web.mkdir(parents=True)
        (web / 'index.html').write_text('offline fixture')
        for name in ('mediapipe', 'scene', 'piano'):
            (web / f'{name}-assets.lock.json').write_text('{"files": []}')

    def start(self, *extra, parent=None):
        process = subprocess.Popen([sys.executable, str(ROOT / 'packaged_backend.py'), '--resources', str(self.resources),
            '--state', str(self.state), '--logs', str(self.root / 'logs'), '--parent-pid', str(parent or os.getpid()), *extra],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        def cleanup():
            if process.poll() is None:
                process.terminate()
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: process.kill(); process.wait()
            process.stdout.close(); process.stderr.close()
        self.addCleanup(cleanup)
        return process

    def until(self, process, wanted):
        # Unbuffered OS reads avoid TextIOWrapper buffering hiding ready lines.
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        buffer = b''
        deadline = time.monotonic() + 20
        try:
            while time.monotonic() < deadline:
                if not selector.select(timeout=.2):
                    continue
                data = os.read(process.stdout.fileno(), 65536)
                if not data:
                    self.fail('Backend exited before event: ' + process.stderr.read())
                buffer += data
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    event = json.loads(line)
                    if event['event'] == wanted:
                        return event
                    if event['event'] == 'error':
                        self.fail(str(event))
            self.fail('Backend status timeout')
        finally:
            selector.close()

    def test_ready_singleton_shutdown_relaunch_and_port_conflict(self):
        with socket.socket() as probe:
            try: probe.bind(('127.0.0.1', 5092))
            except OSError as error:
                if error.errno != errno.EADDRINUSE:
                    raise
                self.skipTest('Port 5092 belongs to an existing service')
        process = self.start()
        self.assertEqual(self.until(process, 'ready')['url'], 'http://127.0.0.1:5092/live/')
        connection = http.client.HTTPConnection('127.0.0.1', 5092)
        connection.request('GET', '/live/')
        self.assertEqual(connection.getresponse().read(), b'offline fixture')
        connection.close()
        second = self.start()
        self.assertEqual(self.until(second, 'error')['code'], 'already_running')
        self.assertEqual(second.wait(timeout=5), 1)
        process.terminate(); self.assertEqual(process.wait(timeout=5), 0)
        again = self.start()
        self.until(again, 'ready')
        again.terminate(); again.wait(timeout=5)
        with socket.socket() as other:
            other.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            other.bind(('127.0.0.1', 5092)); other.listen()
            conflict = self.start()
            self.assertEqual(self.until(conflict, 'error')['code'], 'port_in_use')
            self.assertEqual(conflict.wait(timeout=5), 1)
            self.assertEqual(other.getsockname()[1], 5092)

    def test_launcher_parent_mismatch_exits(self):
        # An impossible launcher parent simulates a launcher that has exited.
        process = self.start(parent=2147483647)
        self.assertEqual(process.wait(timeout=5), 0)


if __name__ == '__main__':
    unittest.main()

"""Offline acceptance of an assembled app using an independent prepared asset tree.

Usage: python tests/test_packaged_app.py --app /path/Dance2Music.app --state /path/assets
The asset tree must contain verified magenta/ and browser/ files. No downloads
are permitted. This is development-machine evidence, not clean-Mac acceptance.
"""
import argparse
import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--live-seconds', type=int, default=0)
    parser.add_argument('--camera', action='store_true')
    parser.add_argument('--browser-assets', action='store_true', help='Exercise real pose/hand/scene assets and piano/recording')
    args = parser.parse_args()
    output = ROOT / 'output/packaged-acceptance'
    output.mkdir(parents=True, exist_ok=True)
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(args.app.resolve())], check=True)
    with tempfile.TemporaryDirectory(prefix='Dance2Music relocation ', dir='/private/tmp') as scratch:
        relocated = Path(scratch) / 'Renamed Dance2Music.app'
        subprocess.run(['ditto', str(args.app.resolve()), str(relocated)], check=True)
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(relocated)], check=True)
        contents = relocated / 'Contents'
        # No Python/Homebrew executable search path and no usable upstream
        # network path; the packaged process must use only its own resources.
        environment = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'en_US.UTF-8',
                       'HTTPS_PROXY': 'http://127.0.0.1:9', 'HTTP_PROXY': 'http://127.0.0.1:9',
                       'NO_PROXY': '127.0.0.1,localhost', 'TMPDIR': scratch}
        with (output / 'backend.log').open('w') as log:
            backend = subprocess.Popen([str(contents / 'Helpers/backend/dance2music-backend'),
                '--resources', str(contents / 'Resources'), '--state', str(args.state.resolve()),
                '--logs', str(output), '--parent-pid', str(os.getpid())],
                cwd=scratch, env=environment, stdout=subprocess.PIPE, stderr=log)
            try:
                selector = selectors.DefaultSelector()
                selector.register(backend.stdout, selectors.EVENT_READ)
                buffer = b''
                ready = False
                deadline = time.monotonic() + 120
                events = []
                try:
                    while not ready and time.monotonic() < deadline:
                        if not selector.select(timeout=.2):
                            continue
                        chunk = os.read(backend.stdout.fileno(), 65536)
                        if not chunk:
                            raise RuntimeError('Frozen backend exited; see output/packaged-acceptance/backend.log')
                        buffer += chunk
                        while b'\n' in buffer:
                            line, buffer = buffer.split(b'\n', 1)
                            event = json.loads(line)
                            events.append(event)
                            if event['event'] in ('downloading', 'error'):
                                raise RuntimeError('Offline setup failed: ' + str(event))
                            ready |= event['event'] == 'ready'
                finally:
                    selector.close()
                if not ready:
                    raise RuntimeError('Packaged startup timeout')
                (output / 'startup.json').write_text(json.dumps(events, indent=2) + '\n')
                print('PASS relocated, signed frozen backend with offline assets and system-only PATH', flush=True)
                test = 'test_packaged_browser.py' if args.browser_assets else 'test_browser_magenta.py'
                command = [sys.executable, str(ROOT / 'tests' / test), '--origin', 'http://127.0.0.1:5092']
                if args.live_seconds:
                    command += ['--live-seconds', str(args.live_seconds)]
                if args.camera:
                    command += ['--camera']
                subprocess.run(command, check=True, cwd=ROOT)
            finally:
                if backend.poll() is None:
                    backend.terminate()
                    try:
                        backend.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        backend.kill(); backend.wait()
                backend.stdout.close()
        print('PASS packaged server shutdown', flush=True)


if __name__ == '__main__':
    main()

"""Browser integration + independent ZIP validation.

Install playwright in a test environment; uses installed Google Chrome.
Run: python tests/test_browser_recording.py [--zones-root /path/to/v0.2]
"""
import argparse
import base64
import functools
import hashlib
import http.server
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import zipfile

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def check_zip(blob, zones_root):
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        assert archive.testzip() is None
        manifest = json.loads(archive.read('manifest.json'))
        assert manifest['schema'] == 'dance2music.recording'
        assert manifest['schema_version'] == 1
        for artifact in manifest['artifacts'].values():
            content = archive.read(artifact['path'])
            assert len(content) == artifact['size_bytes']
            assert hashlib.sha256(content).hexdigest() == artifact['sha256']
        rows = [json.loads(line) for line in archive.read('observations.jsonl').splitlines()]
    assert len(rows) == manifest['observation_count'] == 240
    assert all(b['timestamp_s'] > a['timestamp_s'] for a, b in zip(rows, rows[1:]))
    for row in rows:
        assert len(row['pose']['image_landmarks']) == len(row['pose']['world_landmarks']) == 33
        for inference in row['hands']['inferences']:
            for candidate in inference['candidates']:
                assert len(candidate['world_landmarks']) == len(candidate['image_landmarks']) == 21
                assert candidate['handedness'] and candidate['gestures']
    print('PASS Python ZIP, CRC, SHA-256, schema, timestamps and landmark evidence')
    if zones_root:
        with tempfile.TemporaryDirectory(prefix='dance2music-contract-') as temp:
            fixture = Path(temp) / 'observations.json'
            fixture.write_text(json.dumps(rows))
            subprocess.run([str(zones_root / '.venv/bin/python'),
                            str(ROOT / 'tests/validate_zones_pose.py'),
                            str(zones_root), str(fixture)], check=True,
                           env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})


def check_live_controls(page, origin):
    page.route('https://cdn.jsdelivr.net/npm/@mediapipe/**/vision_bundle.mjs',
               lambda route: route.fulfill(body=(ROOT / 'tests/vision-fixture.js').read_text(),
                                           content_type='text/javascript',
                                           headers={'Access-Control-Allow-Origin': '*'}))
    page.goto(origin + '/web/live/')
    assert page.locator('#rec').is_disabled()
    page.locator('#go').click()
    page.wait_for_function("document.querySelector('#go').textContent === 'Stop'")
    page.locator('#rec').click()
    page.wait_for_timeout(400)
    page.evaluate("""async () => {
        const { Engine } = await import('/web/live/audio.js');
        const update = Engine.prototype.update;
        Engine.prototype.update = function (...args) {
            Engine.prototype.update = update;
            throw new Error('injected sound failure');
        };
    }""")
    page.locator('#handMode').select_option('near')
    page.wait_for_timeout(500)
    page.locator('#handMode').select_option('far')
    page.wait_for_timeout(700)
    page.locator('#mirror').select_option('0')
    page.locator('#model').select_option('heavy')
    # Stop while the replacement pose model is still loading.
    with page.expect_download() as download:
        page.locator('#rec').click()
    bundle = Path(download.value.path()).read_bytes()
    with zipfile.ZipFile(io.BytesIO(bundle)) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        rows = [json.loads(line) for line in archive.read('observations.jsonl').splitlines()]
        for artifact in manifest['artifacts'].values():
            assert hashlib.sha256(archive.read(artifact['path'])).hexdigest() == artifact['sha256']
    assert rows and manifest['observation_count'] == len(rows)
    settings = [c['settings'] for c in manifest['configurations']]
    assert {'off', 'near', 'far'} <= {s['hands']['mode'] for s in settings}
    assert any(s['video_mirrored'] for s in settings)
    assert any(not s['video_mirrored'] for s in settings)
    assert all(s['pose_model']['asset_sha256'] == hashlib.sha256(b'fixture-model').hexdigest() for s in settings)
    assert any(r['pose']['status'] == 'not_detected' for r in rows)
    assert any(r['hands']['inferences'] for r in rows)
    assert all('world_landmarks' in r['pose'] for r in rows)
    assert any(r['analysis'] and r['analysis']['features'] for r in rows)
    assert any(r.get('analysis_error') == 'injected sound failure' and r['pose']['detected'] for r in rows)
    page.locator('#go').click()
    page.wait_for_function("document.querySelector('#go').textContent === 'Start'")
    assert page.locator('#recMsg a[download]').count() == 1
    print('PASS live controls: record, hand/mirror changes, stop during model load, ZIP download')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--zones-root', type=Path)
    args = parser.parse_args()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=ROOT))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True,
                                        args=['--autoplay-policy=no-user-gesture-required',
                                              '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
            page = browser.new_page(permissions=['camera'])
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route('**/fixture.task', lambda route: route.fulfill(body='fixture-model'))
            page.route('https://storage.googleapis.com/**', lambda route: route.fulfill(body='fixture-model'))
            origin = f'http://127.0.0.1:{server.server_port}'
            page.goto(origin + '/tests/browser.html')
            page.evaluate("""() => {
                import('/tests/recording.test.js').then(m => m.runTests()).then(
                    result => { window.testResult = result; }, error => { window.testError = error.stack; });
            }""")
            try:
                page.wait_for_function('window.testResult || window.testError', timeout=45000)
            except Exception:
                print('Completed before timeout:', page.evaluate('window.testProgress'), flush=True)
                raise
            assert not page.evaluate('window.testError'), page.evaluate('window.testError')
            result = page.evaluate('window.testResult')
            for test in result['passed']:
                print('PASS', test)
            data = page.evaluate("""() => new Promise(resolve => {
                const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.readAsDataURL(window.fixtureZip);
            })""")
            check_zip(base64.b64decode(data), args.zones_root)
            check_live_controls(page, origin)
            assert not errors, errors
            print('PASS no browser module/runtime errors')
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

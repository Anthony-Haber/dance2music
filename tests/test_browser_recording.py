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
import subprocess
import tempfile
import threading
import zipfile
from pathlib import Path

from live_ui_helpers import open_live_sections
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
    page.route('**/vision_bundle.mjs',
               lambda route: route.fulfill(body=(ROOT / 'tests/vision-fixture.js').read_text(),
                                           content_type='text/javascript',
                                           headers={'Access-Control-Allow-Origin': '*'}))
    page.goto(origin + '/web/live/')
    open_live_sections(page)
    assert page.locator('#rec').is_disabled()
    assert not page.locator('#recMic').is_checked()
    page.locator('#go').click()
    page.wait_for_function("document.querySelector('#go').textContent === 'Stop'")
    page.locator('#rec').click()
    page.wait_for_function("document.querySelector('#rec').textContent === 'Stop recording'")
    assert page.locator('#recMic').is_disabled()
    assert page.locator('#recWhat').is_disabled()
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
        assert manifest['microphone']['outcome'] == 'disabled'
        assert 'microphone' not in manifest['artifacts']
        assert len(archive.namelist()) == 7
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
    assert not page.locator('#recMic').is_disabled()
    print('PASS live controls: record, hand/mirror changes, stop during model load, ZIP download')


def check_microphone_controls(page, origin):
    # Chrome does not expose AudioSession; enforce Safari's category restriction
    # while keeping native browser microphone/MediaRecorder/ZIP behavior.
    page.add_init_script("""{
        const session = { type: 'auto' };
        Object.defineProperty(navigator, 'audioSession', { configurable: true, value: session });
        const access = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = constraints => {
            if (constraints.audio && !['auto', 'play-and-record'].includes(session.type))
                return Promise.reject(new DOMException('AudioSession category is not compatible with audio capture.', 'InvalidStateError'));
            return access(constraints);
        };
    }""")
    page.goto(origin + '/web/live/')
    open_live_sections(page)
    page.locator('#go').click()
    page.wait_for_function("document.querySelector('#go').textContent === 'Stop'")
    assert page.evaluate('navigator.audioSession.type') == 'playback'
    page.evaluate("""async () => {
        const { Recorder } = await import('/web/live/recorder.js');
        const start = Recorder.prototype.start;
        Recorder.prototype.start = function (...args) { window.liveRecorder = this; return start.apply(this, args); };
        window.originalMicrophoneAccess = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    }""")
    page.locator('#recMic').check()
    page.locator('#rec').click()
    page.wait_for_function("document.querySelector('#recMsg').textContent.includes('Microphone capture active')")
    assert page.locator('#micMsg').is_visible()
    assert 'Microphone capture active' in page.locator('#micMsg').inner_text()
    assert page.evaluate('navigator.audioSession.type') == 'play-and-record'
    assert page.locator('#recMic').is_disabled()
    page.wait_for_timeout(400)
    with page.expect_download() as download:
        page.locator('#rec').click()
    with zipfile.ZipFile(download.value.path()) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        assert manifest['microphone']['outcome'] == 'complete'
        artifact = manifest['artifacts']['microphone']
        assert hashlib.sha256(archive.read(artifact['path'])).hexdigest() == artifact['sha256']
    assert 'Separate microphone audio included' in page.locator('#recMsg').inner_text()
    assert page.evaluate('navigator.audioSession.type') == 'playback'
    assert page.locator('#recMic').is_checked() and not page.locator('#recMic').is_disabled()

    page.locator('#recWhat').select_option('audio')
    page.locator('#rec').click()
    page.wait_for_function("document.querySelector('#recMsg').textContent.includes('Microphone capture active')")
    page.wait_for_timeout(300)
    page.evaluate("window.liveRecorder.microphoneStream.getAudioTracks()[0].dispatchEvent(new Event('ended'))")
    page.wait_for_function("document.querySelector('#recMsg').textContent.includes('Microphone interrupted')")
    assert page.locator('#rec').inner_text() == 'Stop recording'
    with page.expect_download() as download:
        page.locator('#rec').click()
    with zipfile.ZipFile(download.value.path()) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        assert manifest['media']['audio_only'] and manifest['media']['complete']
        assert manifest['microphone']['outcome'] == 'interrupted'
        assert manifest['artifacts']['microphone']['size_bytes'] > 0
    assert 'Microphone interrupted: Microphone disconnected' in page.locator('#recMsg').inner_text()

    page.evaluate("""() => {
        navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
    }""")
    page.locator('#rec').click()
    page.wait_for_function("document.querySelector('#recMsg').textContent.includes('Microphone unavailable: NotAllowedError')")
    assert page.locator('#micMsg.warning').is_visible()
    assert 'No microphone file will be included' in page.locator('#micMsg').inner_text()
    page.wait_for_timeout(150)
    with page.expect_download():
        page.locator('#rec').click()
    assert 'Microphone unavailable: NotAllowedError' in page.locator('#recMsg').inner_text()
    assert page.locator('#micMsg.warning').is_visible()

    for cancel_app in [False, True]:
        page.evaluate("""() => {
            navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.resolveMicrophone = resolve; });
        }""")
        page.locator('#rec').click()
        page.wait_for_function("document.querySelector('#rec').textContent === 'Cancel recording'")
        assert 'Allow microphone access' in page.locator('#recMsg').inner_text()
        assert page.locator('#recMic').is_disabled()
        page.locator('#go' if cancel_app else '#rec').click()
        if cancel_app:
            page.wait_for_function("document.querySelector('#go').textContent === 'Start'")
        assert not page.locator('#recMic').is_disabled()
        assert 'Recording cancelled' in page.locator('#recMsg').inner_text()
        assert page.evaluate('navigator.audioSession.type') == 'playback'
        page.evaluate("""async () => {
            // A stream arriving after cancellation represents a permission request
            // accepted while the previous capture-compatible category was still set.
            navigator.audioSession.type = 'play-and-record';
            window.lateMicrophoneStream = await window.originalMicrophoneAccess({ audio: true, video: false });
            navigator.audioSession.type = 'playback';
            window.resolveMicrophone(window.lateMicrophoneStream);
        }""")
        page.wait_for_function("window.lateMicrophoneStream.getTracks().every(t => t.readyState === 'ended')")
        assert page.locator('#rec').inner_text() == 'Record'
    page.reload()
    open_live_sections(page)
    assert not page.locator('#recMic').is_checked()
    print('PASS microphone controls: default-off reload, native microphone capture, locked selection, repeated sound-only take, interruption/denial notices and pending cancellation')


def check_watch_recovery_controls(browser, origin):
    page = browser.new_page()
    page.add_init_script('''{
        const bluetooth = new EventTarget();
        window.watchChooserRequests = [];
        bluetooth.getAvailability = async () => false;
        bluetooth.requestDevice = async options => {
            watchChooserRequests.push(options);
            throw new DOMException('No device selected', 'NotFoundError');
        };
        Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: bluetooth });
    }''')
    try:
        page.goto(origin + '/web/live/')
        open_live_sections(page)
        page.wait_for_function("document.querySelector('#watchStatus').textContent.includes('cannot currently access')")
        assert page.locator('#watchHelp').get_attribute('open') is not None
        page.locator('#watchConnect').click()
        page.wait_for_function("document.querySelector('#watchStatus').textContent.includes('list was empty')")
        assert page.locator('#watchScanAll').count() == 0, 'no separate scanning step'
        requests = page.evaluate('window.watchChooserRequests')
        assert len(requests) == 1, 'one click opens one scanner; cancellation does not reopen it'
        assert requests[0]['filters'] == [{'namePrefix': 'M5StickC-IMU-'}]
        assert 'acceptAllDevices' not in requests[0]
        assert requests[0]['optionalServices'] == ['12345678-1234-5678-1234-56789abcdef0']
        page.locator('#watchHelp summary').click()
        page.wait_for_timeout(650)
        assert page.locator('#watchHelp').get_attribute('open') is None
        print('PASS watch connection UI: one-click watch prefix filtering, Bluetooth status, cancellation and dismissible guidance')
    finally:
        page.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--zones-root', type=Path)
    parser.add_argument('--watch-fixtures-dir', type=Path)
    args = parser.parse_args()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=ROOT))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                channel=None if os.environ.get('CHROME_EXECUTABLE') else 'chrome',
                executable_path=os.environ.get('CHROME_EXECUTABLE'), headless=True,
                args=['--autoplay-policy=no-user-gesture-required',
                      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
            page = browser.new_page(permissions=['camera'])
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route('**/vendor/mediapipe/*.task', lambda route: route.fulfill(body='fixture-model'))
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
            if args.watch_fixtures_dir:
                args.watch_fixtures_dir.mkdir(parents=True, exist_ok=True)
                for index in range(page.evaluate('window.watchFixtureZips.length')):
                    encoded = page.evaluate('''index => new Promise(resolve => {
                        const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]);
                        reader.readAsDataURL(window.watchFixtureZips[index]);
                    })''', index)
                    (args.watch_fixtures_dir / f'browser-{index}.zip').write_bytes(base64.b64decode(encoded))
            try:
                check_live_controls(page, origin)
                check_microphone_controls(page, origin)
            except Exception:
                print('Live UI failure:', page.locator('#recMsg').inner_text(), 'module errors:', errors, flush=True)
                raise
            assert not errors, errors
            print('PASS no browser module/runtime errors')
            check_watch_recovery_controls(browser, origin)
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

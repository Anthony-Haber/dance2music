"""Live disclosure, accessibility and responsive-layout checks in isolated Chrome."""
import functools
import http.server
import os
import threading
from pathlib import Path

from live_ui_helpers import open_control
from playwright.sync_api import sync_playwright
from test_browser_watch_autoconnect import MOCK

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'output' / 'live-layout'
SECTIONS = ['watchesSection', 'sceneSettings', 'soundSettings', 'handsSection', 'movementSettings', 'settingsHelp']


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def in_view(page, selector):
    box = page.locator(selector).bounding_box()
    assert box and box['y'] >= 0 and box['y'] + box['height'] <= page.viewport_size['height'], (selector, box)


def check(page, origin):
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script(MOCK + '''
      navigator.bluetooth.getDevices = async () => [];
      navigator.bluetooth.requestDevice = async () => autoDevices[chooserCalls++];
    ''')
    page.route('**/vision_bundle.mjs', lambda r: r.fulfill(body=(ROOT / 'tests/vision-fixture.js').read_text(), content_type='text/javascript'))
    page.route('**/*.task', lambda r: r.fulfill(body='fixture-model'))
    page.goto(origin + '/web/live/')
    page.wait_for_function("document.body.dataset.ready === 'true'")
    assert page.locator('aside > details').evaluate_all('(els) => els.map(e => e.id)') == SECTIONS
    assert page.locator('aside > details[open]').evaluate_all('(els) => els.map(e => e.id)') == ['watchesSection']
    for selector in ['#source', '#cam', '#sceneMode', '#go', '#rec', '#watchConnect']:
        in_view(page, selector)
    assert page.locator('#watchAuto').is_checked()
    assert page.locator('#watchShowPlots').count() == 0
    assert page.locator('#watchPlots').evaluate('e => e.open')
    page.screenshot(path=OUTPUT / 'desktop.png')

    # Space must operate the native disclosure, without starting the session.
    summary = page.locator('#soundSettings > summary')
    summary.focus(); page.keyboard.press('Space')
    page.wait_for_function("document.querySelector('#soundSettings').open")
    assert page.locator('#go').inner_text() == 'Start'
    assert summary.evaluate("e => getComputedStyle(e).outlineStyle") != 'none'
    page.locator('#timbre').select_option('glass')
    summary.focus(); page.keyboard.press('Enter')
    page.wait_for_function("!document.querySelector('#soundSettings').open")
    summary.focus(); page.keyboard.press('Enter')
    assert page.locator('#timbre').input_value() == 'glass'
    open_control(page, '#energyS')
    assert page.locator('#soundSettings').evaluate('e => e.open'), 'sections can stay open together'
    page.locator('#energyS').fill('5')
    page.locator('#energyS').dispatch_event('input')
    values = page.locator('aside input, aside select').evaluate_all('(els) => els.map(e => [e.id, e.value, e.checked])')
    for section in SECTIONS:
        page.locator('#' + section).evaluate('e => e.open = false')
    for section in SECTIONS:
        page.locator('#' + section).evaluate('e => e.open = true')
    assert values == page.locator('aside input, aside select').evaluate_all('(els) => els.map(e => [e.id, e.value, e.checked])')
    assert not page.locator('input:not([type=file]), select, textarea').evaluate_all('''els => els.filter(e =>
      !e.labels?.length && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby')).map(e => e.outerHTML)''')
    # Every generated control is reachable by opening its ancestor disclosures.
    for section in SECTIONS:
        page.locator('#' + section).evaluate('e => e.open = false')
    open_control(page, '#model')
    page.locator('#model').select_option('lite')
    in_view(page, '#go'); in_view(page, '#rec')
    page.locator('#settingsHelp > summary').click()
    page.locator('#watchesSection > summary').click()
    page.locator('#watchConnect').click()
    page.wait_for_function("document.querySelector('.watch-plot')?.dataset.state === 'streaming'")
    assert 'Battery 80%' in page.locator('#watchSlot0 .watch-device-state').inner_text()
    assert not page.locator('#watchSlot0 .watch-device-details').is_visible()
    page.locator('#watchSlot0 details > summary').click()
    assert 'M5StickC-IMU' in page.locator('#watchSlot0 .watch-device-details').inner_text()
    page.locator('#watchSlot0 button').click()
    assert page.locator('#watchSlot0 button').inner_text() == 'Reconnect'
    page.locator('#watchSlot0 button').click()
    page.wait_for_function("document.querySelector('.watch-plot')?.dataset.state === 'streaming'")
    page.locator('#watchesSection > summary').click()

    # Closing all panels must leave camera, audio, recording and watch samples running.
    page.locator('#go').click()
    page.wait_for_function("document.querySelector('#go').textContent === 'Stop'")
    assert page.locator('#go svg[aria-hidden=true]').count() == 1
    open_control(page, '#recWhat')
    page.locator('#recWhat').select_option('audio')
    page.locator('#settingsHelp > summary').click()
    page.locator('#rec').click()
    page.wait_for_function("document.querySelector('#rec').textContent === 'Stop recording'")
    page.wait_for_timeout(600)
    assert page.locator('#recMsg').get_attribute('data-elapsed')
    assert page.evaluate("document.querySelector('#v').srcObject.getVideoTracks()[0].readyState === 'live'")
    assert page.evaluate("document.querySelector('.watch-plot').dataset.state === 'streaming'")
    assert 'fps' in page.locator('#sessionMetrics').text_content()
    assert page.locator('#rec svg[aria-hidden=true]').count() == 1
    with page.expect_download() as download:
        page.locator('#rec').click()
    assert download.value.suggested_filename.endswith('.zip')
    assert page.locator('#recMsg a[download]').count() == 1
    page.locator('#go').click()
    page.wait_for_function("document.querySelector('#go').textContent === 'Start'")

    # A failure in a closed panel is discoverable and links to the recovery controls.
    page.evaluate('''() => { const e = document.querySelector('#sceneStatus');
      e.hidden = false; e.dataset.issue = 'true'; e.textContent = 'Scene failed. Try Rescan.'; }''')
    page.wait_for_selector('#sceneSettings > summary .section-warning', state='visible')
    page.locator('#sectionAlerts [data-section=sceneSettings]').click()
    assert page.locator('#sceneStatus').is_visible()
    page.evaluate("document.querySelector('#sceneStatus').hidden = true")

    # The missing-file error stays beside Start, then a real local video can start.
    page.locator('#source').select_option('file')
    assert page.locator('#file').is_visible() and not page.locator('#cam').is_visible()
    assert page.locator('#sceneMode').is_disabled()
    page.locator('#go').click()
    page.wait_for_function("document.querySelector('#status').textContent.includes('choose a video file')")
    assert page.locator('#status').is_visible()
    page.evaluate('''async () => {
      const c = document.createElement('canvas'); c.width = 160; c.height = 120;
      const stream = c.captureStream(10), r = new MediaRecorder(stream), chunks = [];
      const finished = new Promise(resolve => { r.onstop = resolve; });
      r.ondataavailable = e => chunks.push(e.data); r.start();
      const paint = setInterval(() => { c.getContext('2d').fillRect(0, 0, 160, 120); }, 50);
      await new Promise(resolve => setTimeout(resolve, 400)); r.stop(); await finished;
      clearInterval(paint); stream.getTracks().forEach(t => t.stop());
      const files = new DataTransfer(); files.items.add(new File(chunks, 'movement.webm', {type:r.mimeType}));
      document.querySelector('#file').files = files.files;
    }''')
    page.locator('#go').click()
    page.wait_for_function("document.querySelector('#go').textContent === 'Stop'")
    assert page.evaluate("document.querySelector('#v').src.startsWith('blob:')")
    page.locator('#go').click()
    page.wait_for_function("document.querySelector('#go').textContent === 'Start'")
    page.locator('#source').select_option('camera')
    for mode in ['models', 'percussion-kit', 'percussion-hand', 'percussion-metal', 'floor-piano', 'none']:
        page.locator('#sceneMode').select_option(mode)
        assert page.locator('#sceneMode').input_value() == mode

    for width, height, name in [(390, 844, 'mobile'), (683, 384, 'zoom-200')]:
        # A 1366 x 768 browser at 200% zoom has a 683 x 384 CSS viewport.
        page.set_viewport_size({'width':width, 'height':height})
        page.reload(); page.wait_for_function("document.body.dataset.ready === 'true'")
        page.evaluate('window.scrollTo(0, 0)')  # Check the initial viewport, independent of reload scroll restoration.
        assert page.locator('aside > details[open]').evaluate_all('(els) => els.map(e => e.id)') == ['watchesSection']
        assert page.locator('#model').input_value() == 'lite'
        assert page.locator('#timbre').input_value() == 'glass'
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert page.locator('#watchConnect').bounding_box()['y'] < page.locator('#workspace').bounding_box()['y']
        if name == 'mobile':
            in_view(page, '#go'); in_view(page, '#watchConnect')
        page.screenshot(path=OUTPUT / f'{name}-initial.png')
        for section in SECTIONS[1:]:
            page.locator('#' + section + ' > summary').click()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), section
        page.screenshot(path=OUTPUT / f'{name}.png', full_page=True)
        page.locator('#performanceView').click()
        assert page.locator('#performanceView').inner_text() == 'Exit performance view'
        assert not page.locator('#go').is_visible()
        page.locator('#performanceView').click()
        assert page.locator('#go').is_visible()
        page.keyboard.press('f')
        assert page.locator('#performanceView').get_attribute('aria-pressed') == 'true'
        page.keyboard.press('Escape')
        page.wait_for_function("!document.body.classList.contains('perf')")
    assert not errors, errors
    print('PASS layout/order, keyboard/focus, labels, preserved values/defaults, sticky actions, watches, camera/video, recording/download, warnings, mobile/200% reflow, performance view and no browser errors', flush=True)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=ROOT))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                channel=None if os.environ.get('CHROME_EXECUTABLE') else 'chrome',
                executable_path=os.environ.get('CHROME_EXECUTABLE'), headless=True,
                args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
                      '--autoplay-policy=no-user-gesture-required'])
            try:
                page = browser.new_page(viewport={'width':1366, 'height':768}, permissions=['camera'], accept_downloads=True)
                check(page, f'http://127.0.0.1:{server.server_port}')
            except Exception:
                print('UI failure:', page.locator('#status').text_content(), page.locator('#recMsg').text_content(), flush=True)
                page.screenshot(path=OUTPUT / 'failure.png')
                raise
            finally:
                browser.close()
    finally:
        server.shutdown(); server.server_close()


if __name__ == '__main__':
    main()

"""Magenta connection and source cancellation regressions without native models.

Uses a fake camera, explicit pose fixtures, and a held socket-close promise.
Run with a Python environment containing Playwright and installed Chrome.
"""
import functools
import http.server
from pathlib import Path
import threading

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def source_changes(page, origin):
    page.route('**/vision_bundle.mjs', lambda r: r.fulfill(
        body=(ROOT / 'tests/vision-fixture.js').read_text(), content_type='text/javascript'))
    page.route('**/*.task', lambda r: r.fulfill(body='fixture-model'))
    page.goto(origin + '/web/live/')
    page.wait_for_function("document.body.dataset.ready==='true'")
    page.locator('#sceneMode').select_option('none')
    page.evaluate('''async()=>{
      const {MagentaScene}=await import('/web/live/magenta.js');
      const close=MagentaScene.prototype.closeSocket;
      window.pendingCloses=[];
      MagentaScene.prototype.closeSocket=function(){
        const closed=close.call(this);
        if(!window.holdNextClose)return closed;
        window.holdNextClose=false;
        return closed.then(()=>new Promise(resolve=>pendingCloses.push(resolve)));
      };
      const open=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.cameraRequests=0;window.openedTracks=[];
      navigator.mediaDevices.getUserMedia=async options=>{
        cameraRequests++;const stream=await open(options);openedTracks.push(...stream.getTracks());return stream;
      };
      const create=URL.createObjectURL.bind(URL);
      window.fileRequests=0;URL.createObjectURL=value=>{fileRequests++;return create(value);};
    }''')

    def start():
        page.locator('#go').click()
        page.wait_for_function("document.querySelector('#go').textContent==='Stop'")

    def stop():
        page.locator('#go').click()
        page.wait_for_function("document.querySelector('#go').textContent==='Start'")
        assert page.evaluate("openedTracks.every(t=>t.readyState==='ended')")

    def resolve(index):
        page.evaluate('''async index=>{
          pendingCloses[index]();
          // Let the held continuation and any attempted source acquisition run.
          await new Promise(resolve=>setTimeout(resolve,100));
        }''', index)

    for source, restart in (('camera', False), ('file', False), ('camera', True)):
        page.locator('#source').select_option('camera')
        start()
        if source == 'file':
            page.locator('#file').set_input_files({
                'name': 'fixture.mp4', 'mimeType': 'video/mp4', 'buffer': b'fixture'})
        page.evaluate('window.pendingCloses=[];window.holdNextClose=true')
        if source == 'camera':
            resolution = '640x480' if page.locator('#res').input_value() != '640x480' else '1280x720'
            page.locator('#res').select_option(resolution)
        else:
            page.locator('#source').select_option('file')
        page.wait_for_function('pendingCloses.length===1')
        stop()
        if restart:
            start()
        requests = page.evaluate('[cameraRequests,fileRequests]')
        resolve(0)
        assert page.evaluate('[cameraRequests,fileRequests]') == requests, 'canceled change must not reopen either source'
        if restart:
            assert page.locator('#go').inner_text() == 'Stop'
            stop()
        else:
            assert page.locator('#go').inner_text() == 'Start'
            assert page.evaluate("openedTracks.every(t=>t.readyState==='ended')")

    # Reserve the newer request immediately, even while both closes are pending.
    start()
    requests = page.evaluate('cameraRequests')
    page.evaluate('window.pendingCloses=[];window.holdNextClose=true')
    page.locator('#res').select_option('640x480')
    page.wait_for_function('pendingCloses.length===1')
    page.evaluate('window.holdNextClose=true')
    page.locator('#res').select_option('1280x720')
    page.wait_for_function('pendingCloses.length===2')
    resolve(0)
    assert page.evaluate('cameraRequests') == requests, 'older request must not open while its replacement is pending'
    resolve(1)
    page.wait_for_function('(count)=>cameraRequests===count+1', arg=requests)
    page.wait_for_function("document.querySelector('#v').srcObject.getVideoTracks()[0].readyState==='live'")
    stop()
    print('PASS source changes canceled by Stop, restart, and a newer pending request', flush=True)


def main():
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=ROOT))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True, args=[
                '--autoplay-policy=no-user-gesture-required',
                '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
            context = browser.new_context(permissions=['camera'])
            context.route('**/*', lambda r: r.continue_() if r.request.url.startswith(origin + '/') else r.abort())
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(origin + '/tests/browser.html')
            passed = page.evaluate("async()=>{const m=await import('/tests/magenta.test.js');return m.runMagentaTests();}")
            print('PASS', *passed, flush=True)
            print('PASS connecting/reconnecting notes, shared ownership, tracking loss and input modes', flush=True)
            source_changes(page, origin)
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()

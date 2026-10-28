"""Automatic watch connection tests. Uses isolated Chrome and simulated devices.

No physical watch connections or changes to the user's Chrome profile.
"""
import functools
import http.server
from pathlib import Path
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from live import CHROME_WATCH_ARGS


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


MOCK = '''{
    window.chooserCalls = 0;
    window.autoDevices = Array.from({length:4}, (_, id) => {
        const device = new EventTarget(), characteristic = new EventTarget();
        Object.assign(device, {id:String(id), attempts:0, name:`M5StickC-IMU-${id < 2 ? '00' : '01'}-${id % 2 ? 'R' : 'L'}`});
        characteristic.startNotifications = async () => {};
        device.gatt = {connected:false, connect:async () => {
            device.attempts++; device.gatt.connected = true;
            return {getPrimaryService:async () => ({getCharacteristic:async uuid => uuid.endsWith('def2')
                ? {writeValueWithResponse:async()=>{}} : characteristic})};
        }, disconnect:() => {device.gatt.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'));}};
        setInterval(() => {
            if (!device.gatt.connected) return;
            const v = new DataView(new ArrayBuffer(36));
            [Math.sin(performance.now()/300 + id), 0, 1, 0, 0, 0].forEach((x,i)=>v.setFloat32(i*4,x,true));
            v.setBigUint64(24, BigInt(Date.now()), true); v.setUint8(32, 2); v.setUint8(33, id%2); v.setUint8(35, 80);
            characteristic.value=v; characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
        }, 20);
        return device;
    });
    const bluetooth = new EventTarget();
    bluetooth.getDevices = async () => autoDevices;
    bluetooth.getAvailability = async () => true;
    bluetooth.requestDevice = async () => {chooserCalls++;throw Error('Unexpected permission chooser');};
    Object.defineProperty(navigator, 'bluetooth', {value:bluetooth,configurable:true});
}'''


def check_app(browser, origin):
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script(MOCK)
    streaming = "[...document.querySelectorAll('.watch-plot')].filter(e=>e.dataset.state==='streaming').length===4"
    try:
        page.goto(origin + '/web/live/')
        page.wait_for_function(streaming)
        assert page.locator('.watch-plot:visible').count() == 4
        assert page.locator('#watchAuto').is_checked()
        assert page.locator('#watchConnect').is_disabled()
        assert page.evaluate('chooserCalls') == 0
        assert page.locator('#go').inner_text() == 'Start'
        page.evaluate('autoDevices[2].gatt.disconnect()')
        page.wait_for_function("document.querySelector('#watchSlot2').textContent.includes('retrying automatically')")
        assert page.locator('.watch-plot').nth(2).is_hidden()
        page.wait_for_function(streaming)
        assert page.locator('.watch-plot:visible').count() == 4
        assert page.evaluate('autoDevices[2].attempts') == 2
        page.locator('#watchSlot0 button').click()
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        page.wait_for_timeout(2200)
        assert page.evaluate('autoDevices[0].gatt.connected') is False
        assert page.locator('#watchSlot0 button').inner_text() == 'Reconnect'
        page.locator('#watchSlot0 button').click()
        page.wait_for_function(streaming)
        page.reload()
        page.wait_for_function(streaming)
        assert page.evaluate('chooserCalls') == 0, 'reload never opens a chooser'
        page.locator('#watchAuto').uncheck()
        page.reload()
        page.wait_for_function("document.querySelector('#watchAuto').onchange !== null")
        assert not page.locator('#watchAuto').is_checked(), 'opt-out persists'
        assert page.evaluate('autoDevices.every(d=>d.attempts===0) && chooserCalls===0')
        page.locator('#watchAuto').check()
        page.wait_for_function(streaming)
        assert not errors, errors
        print('PASS app automatic startup/reload, four streaming graphs, dropped connection, manual pause and persistent opt-out', flush=True)
    finally:
        page.close()


def main():
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=ROOT))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True, args=CHROME_WATCH_ARGS)
            try:
                page = browser.new_page()
                # Check the real API before installing any mocks. No request for
                # device access: only the launcher feature and API availability.
                page.goto(origin + '/tests/')
                assert page.evaluate("typeof navigator.bluetooth.getDevices === 'function'")
                assert page.evaluate("typeof BluetoothDevice.prototype.watchAdvertisements === 'function'")
                print('PASS installed Chrome exposes remembered-device and advertisement APIs with launcher feature', flush=True)
                results = page.evaluate('''async () => {
                    const { autoConnectTests } = await import('/tests/watch-autoconnect.test.js');
                    return autoConnectTests();
                }''')
                for result in results:
                    print('PASS', result, flush=True)
                page.close()
                check_app(browser, origin)
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()

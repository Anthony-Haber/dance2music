"""Live plot integration with actual BLE decoding and mocked notifications.

Run with the same Playwright environment as test_browser_recording.py.
"""
import functools
import http.server
from pathlib import Path
import threading

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def check_watch_plots(browser, origin, screenshot=None):
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=2)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script('''{
        let chosen = 0;
        window.plotChooserRequests = [];
        window.plotDevices = Array.from({length:4}, (_, id) => {
            const device = new EventTarget(), characteristic = new EventTarget();
            device.id = String(id); device.name = `M5StickC-IMU-${id < 2 ? '00' : '01'}-${id % 2 ? 'R' : 'L'}`;
            characteristic.startNotifications = async () => {};
            device.gatt = {connected:false, connect:async () => {
                device.gatt.connected = true;
                return {getPrimaryService:async () => ({getCharacteristic:async uuid => uuid.endsWith('def2')
                    ? {writeValueWithResponse:async()=>{}} : characteristic})};
            }, disconnect:() => {device.gatt.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'));}};
            device.emit = phase => {
                if (!device.gatt.connected) return;
                const packet = new DataView(new ArrayBuffer(36));
                [Math.sin(phase + id) * (id + 1) / 2, Math.cos(phase * 1.4) / 2, 1 + Math.sin(phase * 2) / 3, 0, 0, 0]
                    .forEach((value, axis) => packet.setFloat32(axis * 4, value, true));
                packet.setBigUint64(24, BigInt(Date.now()), true); packet.setUint8(32, 2);
                packet.setUint8(33, id % 2); packet.setUint8(35, 80);
                characteristic.value = packet; characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
            };
            return device;
        });
        const bluetooth = new EventTarget();
        bluetooth.getAvailability = async()=>true;
        bluetooth.requestDevice = async options=>{plotChooserRequests.push(options);return plotDevices[chosen++];};
        Object.defineProperty(navigator, 'bluetooth', {value:bluetooth,configurable:true});
    }''')
    try:
        page.goto(origin + '/web/live/')
        page.wait_for_function("document.querySelector('#watchConnect').onclick !== null")
        assert page.locator('#watchPlots').is_hidden()
        assert page.locator('#watchProgress').inner_text() == '0 of 4 watches connected.'
        page.select_option('#watchLegs', '')
        assert page.locator('#watchProgress').inner_text() == '0 of 2 watches connected.'
        page.select_option('#watchLegs', '01')
        # Hook the exported view class only to inspect the data delivered by the
        # real app wiring, and the recorder to verify both receive notifications.
        page.evaluate('''async () => {
            const { WatchPlots } = await import('/web/live/watch-plots.js');
            const { Recorder } = await import('/web/live/recorder.js');
            const append = WatchPlots.prototype.append, receive = Recorder.prototype.watchSample;
            WatchPlots.prototype.append = function(...args) {window.plots=this;return append.apply(this,args);};
            window.recorderReceipts = 0;
            Recorder.prototype.watchSample = function(...args) {recorderReceipts++;return receive.apply(this,args);};
        }''')
        for index in range(4):
            page.locator('#watchConnect').click()
            page.wait_for_function('''count => document.querySelector('#watchProgress').textContent ===
                (count===4 ? 'All 4 watches connected.' : `${count} of 4 watches connected.`)''', arg=index + 1)
            request = page.evaluate('plotChooserRequests.at(-1)')
            assert request['filters'] == [{'namePrefix': 'M5StickC-IMU-'}]
            assert request.get('exclusionFilters', []) == [
                {'name': f'M5StickC-IMU-{i//2:02d}-' + ('R' if i%2 else 'L')} for i in range(index)]
            if index < 3:
                assert page.locator('#watchConnect').inner_text() == 'Connect next watch'
        assert page.locator('#watchConnect').is_disabled()
        assert page.locator('#watchConnect').inner_text() == 'All watches connected'
        assert page.locator('#watchPlots').is_visible()
        page.evaluate('''() => {
            window.plotTimer = setInterval(() => plotDevices.forEach(d=>d.emit(performance.now()/250)), 20);
        }''')
        page.wait_for_function("[...document.querySelectorAll('.watch-plot')].every(e=>e.dataset.state==='streaming')")
        page.wait_for_timeout(900)
        assert page.locator('#go').inner_text() == 'Start', 'plots must work without camera or music'
        assert page.locator('.watch-plot canvas').count() == 4
        before = page.locator('.watch-plot canvas').first.evaluate('c=>c.toDataURL()')
        page.wait_for_timeout(250)
        after = page.locator('.watch-plot canvas').first.evaluate('c=>c.toDataURL()')
        assert before != after, 'notification-driven chart must change'
        state = page.evaluate('''() => ({counts:plots.histories.map(h=>h.length),recorded:recorderReceipts,
            last:plots.histories.map(h=>h.values().at(-1)), canvases:[...document.querySelectorAll('.watch-plot canvas')].map(c=>[c.width,c.clientWidth])})''')
        assert all(count > 20 for count in state['counts'])
        assert sum(state['counts']) == state['recorded'], 'graphs must not consume or duplicate recorder notifications'
        assert all(sample['device_id'] == i and sample['role'] == i % 2 for i, sample in enumerate(state['last']))
        assert all(width == css_width * 2 for width, css_width in state['canvases']), 'Retina sizing'
        if screenshot:
            page.locator('#watchPlots').screenshot(path=str(screenshot))
        page.select_option('#watchSignal', 'magnitude')
        page.wait_for_function("document.querySelector('.watch-plot-values').textContent.includes('|a|')")
        page.select_option('#watchSignal', 'gyro')
        page.wait_for_function("document.querySelector('.watch-plot-values').textContent.includes('°/s')")
        assert 'reports zero' in page.locator('#watchPlotHint').inner_text()
        assert 'X 0.00' in page.locator('.watch-plot-values').first.inner_text()
        page.select_option('#watchWindow', '20')
        assert page.evaluate('plots.windowMs') == 20000
        page.locator('#watchShowPlots').uncheck()
        count = page.evaluate('recorderReceipts')
        page.wait_for_timeout(150)
        assert page.locator('#watchPlots').is_hidden()
        assert page.evaluate('recorderReceipts') > count, 'hiding plots must not stop samples'
        page.locator('#watchShowPlots').check()
        page.locator('#watchSlot2 button').click()
        page.wait_for_function("document.querySelectorAll('.watch-plot')[2].dataset.state==='disconnected'")
        assert page.locator('#watchProgress').inner_text() == '3 of 4 watches connected.'
        assert page.locator('#watchConnect').is_disabled(), 'selected watches use their Reconnect control'
        assert page.locator('#watchSlot2 button').inner_text() == 'Reconnect'
        page.wait_for_function("document.querySelectorAll('.watch-plot-values')[2].textContent.includes('Waiting')")
        page.set_viewport_size({'width': 390, 'height': 844})
        page.wait_for_timeout(100)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'mobile layout must not overflow'
        # Deterministic history/gap checks use the production view's canvas path.
        page.evaluate('''async () => {
            clearInterval(plotTimer); plots.destroy();
            const { WatchHistory } = await import('/web/live/watch-plots.js');
            const h = new WatchHistory();
            for(let i=0;i<10000;i++)h.append({ax:i},i);
            if(h.length>4096 || h.values().at(-1).ax!==9999)throw Error('History is not bounded');
            h.append({ax:1},40000);
            if(h.length!==1)throw Error('Expired samples retained');
            plots.histories.forEach(h=>h.clear()); plots.signal='acceleration';
            const s={device_id:0,ax:1,ay:0,az:1,gx:0,gy:0,gz:0};
            [1000,1020,1500,1520].forEach(t=>plots.histories[0].append(s,t));
            const ctx=plots.cards[0].canvas.getContext('2d'), move=ctx.moveTo.bind(ctx), line=ctx.lineTo.bind(ctx);
            let starts=0,segments=0;
            ctx.moveTo=(...a)=>{if(ctx.lineWidth===1.5)starts++;return move(...a);};
            ctx.lineTo=(...a)=>{if(ctx.lineWidth===1.5)segments++;return line(...a);};
            plots.draw(1600);
            if(starts!==6||segments!==6)throw Error(`Gap was bridged: ${starts}/${segments}`);
            plots.draw(23000);
            if(plots.histories[0].length)throw Error('Stale data did not expire');
        }''')
        assert not errors, errors
        print('PASS watch setup: four selections, exclusions, progress, completion, reconnect controls and two-watch configuration')
        print('PASS four live plots: notification routing, camera independence, signals, gaps, bounded history, hide/show, Retina and mobile layout')
    finally:
        page.close()


def main():
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=ROOT))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            check_watch_plots(browser, f'http://127.0.0.1:{server.server_port}', Path('/private/tmp/d2m-watch-plots.png'))
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

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
                return {getPrimaryService:async () => {
                    if (window.holdPlotSetup) await new Promise(resolve => {window.releasePlotSetup=resolve;});
                    return {getCharacteristic:async uuid => uuid.endsWith('def2')
                        ? {writeValueWithResponse:async()=>{}} : characteristic};
                }};
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
        assert page.locator('#watchShowPlots').count() == 0, 'the panel header is the only graph visibility control'
        assert page.locator('.watch-plot:visible').count() == 0
        camera_only_height = page.locator('#stage').bounding_box()['height']
        assert camera_only_height == page.viewport_size['height'], 'no graph space without connected watches'
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
            if index == 0:
                page.evaluate('window.holdPlotSetup = true')
            page.locator('#watchConnect').click()
            if index == 0:
                page.wait_for_function('!!window.releasePlotSetup')
                page.wait_for_timeout(550)  # Include the periodic UI refresh while GATT setup is pending.
                assert page.locator('#watchPlots').is_hidden(), 'a pending connection must not reserve graph space'
                page.evaluate('holdPlotSetup = false; releasePlotSetup()')
            page.wait_for_function('''count => document.querySelector('#watchProgress').textContent ===
                (count===4 ? 'All 4 watches connected.' : `${count} of 4 watches connected.`)''', arg=index + 1)
            assert page.locator('.watch-plot:visible').count() == index + 1, 'only connected limbs have graphs'
            if index == 0:
                assert page.locator('.watch-plot').first.bounding_box()['width'] == page.locator('.watch-plot-grid').bounding_box()['width']
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

        # Native disclosure frees camera space without touching connections or samples.
        expanded_height = page.locator('#stage').bounding_box()['height']
        summary = page.locator('#watchPlots > summary')
        expanded_chevron = summary.evaluate("e => getComputedStyle(e, '::after').transform")
        assert expanded_chevron == page.locator('#watchesSection > summary').evaluate("e => getComputedStyle(e, '::after').transform")
        summary.focus(); page.keyboard.press('Space')
        assert not page.locator('#watchPlots').evaluate('e => e.open')
        assert summary.evaluate("e => getComputedStyle(e, '::after').transform") != expanded_chevron
        assert page.locator('#watchPlots').is_visible() and page.locator('#watchSignal').is_hidden()
        assert page.locator('.watch-plot:visible').count() == 0
        assert page.locator('#stage').bounding_box()['height'] > expanded_height + 150
        count = page.evaluate('recorderReceipts')
        frame = page.evaluate('plots.lastFrame')
        page.wait_for_timeout(200)
        assert page.evaluate('recorderReceipts') > count, 'collapsing graphs must not stop samples'
        assert page.evaluate('plots.lastFrame') == frame, 'collapsed graphs do not redraw'
        assert page.evaluate('plotDevices.every(d => d.gatt.connected)')
        assert page.locator('#go').inner_text() == 'Start', 'Space on the disclosure must not start the camera'
        page.keyboard.press('Enter')
        page.wait_for_function('last => plots.lastFrame > last', arg=frame)
        assert page.locator('.watch-plot:visible').count() == 4
        assert page.locator('#watchSignal').input_value() == 'gyro'
        assert page.locator('#watchWindow').input_value() == '20'

        page.locator('#watchSlot2 button').click()
        page.wait_for_function("document.querySelectorAll('.watch-plot')[2].dataset.state==='disconnected'")
        assert page.locator('#watchProgress').inner_text() == '3 of 4 watches connected.'
        assert page.locator('#watchConnect').is_disabled(), 'selected watches use their Reconnect control'
        assert page.locator('#watchSlot2 button').inner_text() == 'Reconnect'
        assert page.locator('.watch-plot').nth(2).is_hidden()
        assert page.locator('.watch-plot:visible').count() == 3
        summary.click()
        for index in [0, 1, 3]:
            page.locator(f'#watchSlot{index} button').click()
        assert page.locator('#watchPlots').is_hidden(), 'remembered watches must not keep the graph panel visible'
        assert page.evaluate('plots.watches.devices.size') == 4
        assert page.locator('#stage').bounding_box()['height'] == camera_only_height
        page.locator('#watchSlot0 button').click()
        page.wait_for_selector('#watchPlots', state='visible')
        assert not page.locator('#watchPlots').evaluate('e => e.open'), 'reconnecting preserves the collapsed view'
        summary.click()
        assert page.locator('.watch-plot:visible').count() == 1
        page.wait_for_function("document.querySelector('.watch-plot').dataset.state === 'streaming'")
        page.set_viewport_size({'width': 390, 'height': 844})
        page.wait_for_timeout(100)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'mobile layout must not overflow'
        mobile_height = page.locator('#workspace').bounding_box()['height']
        summary.click()
        assert page.locator('#workspace').bounding_box()['height'] < mobile_height - 100
        assert page.locator('.watch-plot:visible').count() == 0
        summary.click()
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

        # Migrate a saved unchecked checkbox to a collapsed, reachable panel.
        page.evaluate("localStorage.setItem('d2m:watchPlots', 'false')")
        page.reload()
        page.wait_for_function("document.body.dataset.ready === 'true'")
        page.locator('#watchConnect').click()
        page.wait_for_selector('#watchPlots', state='visible')
        assert not page.locator('#watchPlots').evaluate('e => e.open')
        summary.click()
        page.wait_for_function("localStorage.getItem('d2m:watchPlots') === 'true'")
        summary.click()
        page.wait_for_function("localStorage.getItem('d2m:watchPlots') === 'false'")
        page.reload()
        page.wait_for_function("document.body.dataset.ready === 'true'")
        assert not page.locator('#watchPlots').evaluate('e => e.open'), 'collapsed preference survives reload'
        assert not errors, errors
        print('PASS watch setup: four selections, exclusions, progress, completion, reconnect controls and two-watch configuration')
        print('PASS connected-only graphs, zero-watch camera space, keyboard collapse/reopen, uninterrupted samples, retained settings, disconnect/reconnect, signals, gaps, bounded history, Retina and mobile layout')
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

"""Opt-in real four-watch test through the app's Chrome Bluetooth chooser.

No fake Bluetooth adapter, camera access, or firmware changes. Selects only the
four explicitly named M5 watches; disconnects them on completion. Requires
Chrome Bluetooth permission and four watches advertising pairs 00 and 01.
"""
import argparse
import asyncio
import base64
import functools
import http.server
import json
from pathlib import Path
import threading

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
NAMES = {f'M5StickC-IMU-{pair}-{role}' for pair in ('00', '01') for role in ('L', 'R')}


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


async def run(args):
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0),
        functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(channel='chrome', headless=False)
            try:
                page = await browser.new_page()
                await page.goto(f'http://127.0.0.1:{server.server_port}/web/live/')
                await page.bring_to_front()
                cdp = await page.context.new_cdp_session(page)
                await cdp.send('DeviceAccess.enable')
                prompt = {}
                consumed_prompts = set()
                def update_prompt(event):
                    if event['id'] not in consumed_prompts:
                        prompt.update(event)
                cdp.on('DeviceAccess.deviceRequestPrompted', update_prompt)
                await page.evaluate('''async () => {
                    const { Watches } = await import('/web/live/watches.js');
                    const connect = Watches.prototype.connect;
                    window.hardwareSamples = [];
                    Watches.prototype.connect = function(...args) {
                        if (!window.hardwareWatches) {
                            const receive = this.onSample;
                            this.onSample = (sample, receipt) => {
                                hardwareSamples.push({...sample, receipt});
                                window.hardwareRecorder?.watchSample(sample, receipt);
                                receive(sample, receipt);
                            };
                        }
                        window.hardwareWatches = this;
                        return connect.apply(this, args);
                    };
                }''')
                selected = set()
                for _ in range(4):
                    prompt.clear()
                    await page.click('#watchConnect')
                    for _ in range(120):
                        candidate = next((device for device in prompt.get('devices', [])
                            if device['name'] in NAMES - selected), None)
                        if candidate:
                            consumed_prompts.add(prompt['id'])
                            await cdp.send('DeviceAccess.selectPrompt',
                                {'id': prompt['id'], 'deviceId': candidate['id']})
                            selected.add(candidate['name'])
                            break
                        await asyncio.sleep(.25)
                    else:
                        if prompt.get('id'):
                            await cdp.send('DeviceAccess.cancelPrompt', {'id': prompt['id']})
                        raise AssertionError('No remaining watch found. Check Chrome Bluetooth permission and other connected apps.')
                    await page.wait_for_function('''name => [...hardwareWatches.devices.values()].some(
                        device => device.name === name && hardwareWatches.status(device) === 'streaming')''',
                        arg=candidate['name'], timeout=20000)
                    print('CONNECTED', candidate['name'], flush=True)
                    await asyncio.sleep(.5)
                # Synthetic video/audio exercise the real recorder while every
                # sensor notification comes from the four physical watches.
                await page.evaluate('''async () => {
                    const { Recorder } = await import('/web/live/recorder.js');
                    window.hardwareRecorder = new Recorder();
                    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 120;
                    const context = canvas.getContext('2d');
                    window.hardwarePainter = setInterval(() => {
                        context.fillStyle = '#234'; context.fillRect(0,0,160,120);
                        context.fillStyle = '#fff'; context.fillText('Watch hardware test', 10,60);
                    }, 33);
                    const video = document.createElement('video'); video.muted = true;
                    window.hardwareVideoStream = canvas.captureStream(30);
                    video.srcObject = hardwareVideoStream; await video.play();
                    window.hardwareAudio = new AudioContext(); await hardwareAudio.resume();
                    const destination = hardwareAudio.createMediaStreamDestination();
                    const oscillator = hardwareAudio.createOscillator(); oscillator.connect(destination); oscillator.start();
                    await hardwareRecorder.start({engine:{recordStream:()=>destination.stream}, video, overlay:canvas,
                        mirror:()=>false, label:()=>['Hardware test','','white'], audioOnly:false,
                        configuration:{source:{id:'hardware-test',type:'synthetic'},hands:{mode:'off'}}, watches:hardwareWatches});
                }''')
                await asyncio.sleep(3)
                await page.evaluate('''() => {
                    const device = [...hardwareWatches.devices.values()].find(d => d.device_id === 2);
                    hardwareWatches.disconnect(device.device.id);
                }''')
                await asyncio.sleep(.7)
                await page.evaluate('''async () => {
                    const device = [...hardwareWatches.devices.values()].find(d => d.device_id === 2);
                    await hardwareWatches.reconnect(device.device.id);
                }''')
                await asyncio.sleep(3)
                result = await page.evaluate('''async () => {
                    const saved = await hardwareRecorder.stop();
                    const bytes = await (await fetch(saved.url)).blob();
                    const encoded = await new Promise(resolve => {
                        const reader = new FileReader(); reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(bytes);
                    });
                    return {zip:encoded, report:[...hardwareWatches.devices.values()].map(device => {
                        const samples=hardwareSamples.filter(s=>s.device_id===device.device_id);
                        return {name:device.name, device_id:device.device_id, role:device.role, status:hardwareWatches.status(device),
                            error:device.error, rate_hz:hardwareWatches.rate(device), sample_count:samples.length, battery:device.battery,
                            sync_success:device.sync.every(s=>s.success),
                            mean_acceleration_g:samples.reduce((n,s)=>n+Math.hypot(s.ax,s.ay,s.az),0)/samples.length,
                            gyro_max:Math.max(...samples.flatMap(s=>[Math.abs(s.gx),Math.abs(s.gy),Math.abs(s.gz)]))};
                    })};
                }''')
                assert len(result['report']) == 4
                assert all(device['sample_count'] > 100 and device['sync_success'] and not device['error']
                           for device in result['report']), result['report']
                args.output.mkdir(parents=True, exist_ok=True)
                (args.output / 'hardware.zip').write_bytes(base64.b64decode(result['zip']))
                (args.output / 'report.json').write_text(json.dumps(result['report'], indent=2) + '\n')
                print(json.dumps(result['report'], indent=2), flush=True)
                await page.evaluate('''async () => {
                    for (const id of hardwareWatches.devices.keys()) hardwareWatches.disconnect(id);
                    clearInterval(hardwarePainter); hardwareVideoStream.getTracks().forEach(t=>t.stop());
                    await hardwareAudio.close();
                }''')
                print('PASS four physical watches, time sync, recording and explicit reconnect; all released', flush=True)
            finally:
                await browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='Directory for the hardware report and recording ZIP')
    asyncio.run(run(parser.parse_args()))

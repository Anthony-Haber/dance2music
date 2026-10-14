"""Render genuine body-synth test inputs, then run the native MRT2 proof gate.

Requires Playwright/Chrome and a built mrt2_probe. No external requests are
allowed in the browser. This is an automated conditioning gate, not the
ten-minute camera/pose-throughput or listening acceptance test.
"""
import argparse
import base64
import functools
import http.server
from pathlib import Path
import subprocess
import threading
import sys
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from magenta_assets import verify


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--probe', type=Path, default=ROOT / '.magenta/build-native/mrt2_probe')
    parser.add_argument('--model', choices=('base', 'small'), default='small')
    parser.add_argument('--output', type=Path, default=ROOT / 'output/magenta-native-gate')
    parser.add_argument('--inputs-only', action='store_true', help='Render body-synth fixtures only; does not run or pass the native gate')
    args = parser.parse_args()
    missing = verify(args.assets, args.model)
    if missing:
        raise RuntimeError('Missing/corrupt assets: ' + ', '.join(missing))
    args.output.mkdir(parents=True, exist_ok=True)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=ROOT))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True, args=['--autoplay-policy=no-user-gesture-required'])
            page = browser.new_page()
            page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(origin + '/') else route.abort())
            page.goto(origin + '/tests/browser.html')
            for i in range(2):
                pcm = page.evaluate('''async variant=>{
                  const {magentaInput}=await import('/tests/magenta-input.js');
                  return Promise.race([magentaInput(variant),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Body synth rendering timed out')),60000))]);
                }''', i)
                (args.output / f'input-{i}.f32').write_bytes(base64.b64decode(pcm))
            browser.close()
        if args.inputs_only:
            print('Body-synth fixtures rendered. Native MRT2 gate has not run.')
            return 0
        with (args.output / 'native.log').open('w') as log:
            result = subprocess.run([str(args.probe.resolve()), str(args.assets.resolve()), args.model,
                str(args.output / 'input-0.f32'), str(args.output / 'input-1.f32'), str(args.output)],
                stdout=log, stderr=subprocess.STDOUT, timeout=600)
        print((args.output / 'native.log').read_text())
        return result.returncode
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    raise SystemExit(main())

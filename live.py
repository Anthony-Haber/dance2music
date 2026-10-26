#!/usr/bin/env python3
"""Serve the live tool (web/) on localhost, where browsers allow the camera.

    python live.py              # http://127.0.0.1:5092/live/
    python live.py --offline    # prepare browser assets and the native Magenta
                                # helper/models for later use without internet

Opens Chrome when installed, otherwise the default browser.
The page prefers the local copy when it exists and falls back to the CDN.
"""
import argparse
import functools
import http.server
import os
import shutil
import signal
import subprocess
import sys
import urllib.request
import webbrowser
from pathlib import Path
from urllib.parse import urlsplit
from browser_assets import prepare as prepare_browser_assets
from scene_assets import prepare as prepare_scene_assets
from piano_assets import prepare as prepare_piano_assets
from magenta_runtime import MagentaRuntime

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, 'web')
VENDOR = os.path.join(WEB, 'live', 'vendor', 'mediapipe')
MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/'
MODEL = ('https://storage.googleapis.com/mediapipe-models/pose_landmarker/'
         'pose_landmarker_{m}/float16/1/pose_landmarker_{m}.task')
FILES = ['vision_bundle.mjs'] + [f'wasm/vision_wasm{v}_internal.{e}'
                                 for v in ('', '_module', '_nosimd') for e in ('js', 'wasm')]
# Chrome still gates persisted Bluetooth permissions and getDevices() behind
# this feature. It retains the initial device chooser and service permissions.
# Scope the launch to Bluetooth instead of enabling all experimental web APIs.
CHROME_WATCH_ARGS = ['--enable-features=WebBluetoothNewPermissionsBackend']


def open_browser(url):
    """Prefer Chrome, falling back to the default browser if unavailable."""
    if sys.platform == 'darwin':
        # Launch the executable from the same context as this server. On macOS
        # the Launch Services (`open -a`) path exhibited empty BLE discovery,
        # while a direct launch with the same Chrome profile received watches.
        # Keep Chrome outside the server's process group so Ctrl+C stops only
        # the server. Chrome handles reuse of an already-running profile.
        for application in (Path('/Applications/Google Chrome.app'),
                            Path.home() / 'Applications/Google Chrome.app'):
            executable = application / 'Contents/MacOS/Google Chrome'
            if not executable.is_file():
                continue
            try:
                subprocess.Popen([str(executable), *CHROME_WATCH_ARGS, url], stdin=subprocess.DEVNULL,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 start_new_session=True)
                return True
            except OSError:
                pass
        # Launch Services can still find installations in nonstandard locations.
        # Keep the URL an operand so an already-running Chrome receives it too.
        try:
            if subprocess.run(['open', '-a', 'Google Chrome', url, '--args', *CHROME_WATCH_ARGS],
                              stderr=subprocess.DEVNULL).returncode == 0:
                return True
        except OSError:
            pass
    else:
        candidates = ['google-chrome', 'google-chrome-stable', 'chrome']
        if sys.platform == 'win32':
            candidates += [os.path.join(os.environ[root], 'Google', 'Chrome',
                                       'Application', 'chrome.exe')
                           for root in ('LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)')
                           if os.environ.get(root)]
        for candidate in candidates:
            executable = shutil.which(candidate)
            if executable and webbrowser.BackgroundBrowser([executable, *CHROME_WATCH_ARGS, '%s']).open(url):
                return True
    return webbrowser.open(url)


def offline(magenta=True):
    prepare_browser_assets()
    prepare_scene_assets()
    prepare_piano_assets()
    if magenta:
        from magenta_install import prepare as prepare_magenta
        prepare_magenta()


def create_server(website=WEB, runtime=None, *, browser_root=None, port=5092, packaged=False):
    """Serve explicit read-only resources; mutable browser assets may be external."""
    runtime = runtime or MagentaRuntime()
    website = Path(website).resolve()
    class Handler(http.server.SimpleHTTPRequestHandler):
        extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                          '.mjs': 'text/javascript', '.js': 'text/javascript',
                          '.wasm': 'application/wasm'}
        def do_GET(self):
            if not self.allowed_host():
                return
            if urlsplit(self.path).path == '/app/config':
                import json
                data = json.dumps({'packaged': packaged}).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            if not runtime.handle(self):
                super().do_GET()

        def allowed_host(self):
            if packaged and self.headers.get('Host') != f'127.0.0.1:{self.server.server_port}':
                self.send_error(403, 'Application host required')
                return False
            return True

        def do_HEAD(self):
            if self.allowed_host():
                super().do_HEAD()

        def translate_path(self, path):
            translated = Path(super().translate_path(path))
            relative = translated.relative_to(website)
            if browser_root is not None and relative.parts[:2] == ('live', 'vendor'):
                return str(Path(browser_root).joinpath(*relative.parts[2:]))
            return str(translated)

        def end_headers(self):
            if packaged:
                # Session startup cannot fall back to an external CDN. Workers
                # inherit this policy, including ONNX and MediaPipe fetches.
                self.send_header('Content-Security-Policy', "default-src 'self' blob: data:; script-src 'self' blob: 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' blob: data:")
            super().end_headers()

        def log_message(self, format, *args):
            # WebSocket URL contains a short-lived local launch token.
            if self.path.startswith('/magenta/'):
                return
            super().log_message(format, *args)

    return http.server.ThreadingHTTPServer(('127.0.0.1', port),
                                          functools.partial(Handler, directory=str(website)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--offline', action='store_true', help='Prepare assets and the native Magenta helper for offline use (initial setup requires downloads), then serve')
    ap.add_argument('--without-magenta', action='store_true', help='Prepare browser assets only; omit the optional native Magenta installation')
    ap.add_argument('--port', type=int, default=5092)
    ap.add_argument('--no-browser', action='store_true')
    a = ap.parse_args()
    if a.offline:
        offline(magenta=not a.without_magenta)
    runtime = MagentaRuntime()
    srv = create_server(runtime=runtime, port=a.port)
    url = f'http://127.0.0.1:{a.port}/live/'
    print(url, flush=True)
    print('Press Ctrl+C in this terminal to stop the server.', flush=True)
    if not a.no_browser:
        print('Chrome watch permissions: pair each watch once; previously paired watches reconnect automatically.', flush=True)
        print('If Chrome was already open, fully quit it and restart this command to enable remembered watches.', flush=True)
        open_browser(url)
    def terminate(signum, frame):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, terminate)
    try:
        srv.serve_forever()
    finally:
        runtime.stop(shutdown=True)
        srv.server_close()


if __name__ == '__main__':
    main()

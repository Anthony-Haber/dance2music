#!/usr/bin/env python3
"""Serve the live tool (web/) on localhost, where browsers allow the camera.

    python live.py              # http://127.0.0.1:5092/live/
    python live.py --offline    # prepare browser assets and the native Magenta
                                # helper/models for later use without internet

The page prefers the local copy when it exists and falls back to the CDN.
"""
import argparse
import functools
import http.server
import os
import signal
import urllib.request
import webbrowser
from scene_assets import prepare as prepare_scene_assets
from piano_assets import prepare as prepare_piano_assets
from magenta_runtime import MagentaRuntime

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, 'web')
VENDOR = os.path.join(WEB, 'live', 'vendor', 'mediapipe')
MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/'
MODEL = ('https://storage.googleapis.com/mediapipe-models/pose_landmarker/'
         'pose_landmarker_{m}/float16/latest/pose_landmarker_{m}.task')
FILES = ['vision_bundle.mjs'] + [f'wasm/vision_wasm{v}_internal.{e}'
                                 for v in ('', '_module', '_nosimd') for e in ('js', 'wasm')]


def offline(magenta=True):
    os.makedirs(os.path.join(VENDOR, 'wasm'), exist_ok=True)
    jobs = [(MP + f, os.path.join(VENDOR, f)) for f in FILES]
    jobs += [(MODEL.format(m=m), os.path.join(VENDOR, f'pose_landmarker_{m}.task'))
             for m in ('lite', 'full', 'heavy')]
    jobs += [('https://storage.googleapis.com/mediapipe-models/gesture_recognizer/'
              'gesture_recognizer/float16/1/gesture_recognizer.task',
              os.path.join(VENDOR, 'gesture_recognizer.task'))]
    for url, dst in jobs:
        if not os.path.exists(dst):
            print('get', os.path.relpath(dst, ROOT))
            urllib.request.urlretrieve(url, dst)
    print('offline copy ready:', os.path.relpath(VENDOR, ROOT))
    prepare_scene_assets()
    prepare_piano_assets()
    if magenta:
        from magenta_install import prepare as prepare_magenta
        prepare_magenta()


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

    class Handler(http.server.SimpleHTTPRequestHandler):
        extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                          '.mjs': 'text/javascript', '.js': 'text/javascript',
                          '.wasm': 'application/wasm'}
        def do_GET(self):
            if not runtime.handle(self):
                super().do_GET()

        def log_message(self, format, *args):
            # WebSocket URL contains a short-lived local launch token.
            if self.path.startswith('/magenta/'):
                return
            super().log_message(format, *args)

    srv = http.server.ThreadingHTTPServer(('127.0.0.1', a.port),
                                          functools.partial(Handler, directory=WEB))
    url = f'http://127.0.0.1:{a.port}/live/'
    print(url)
    if not a.no_browser:
        webbrowser.open(url)
    def terminate(signum, frame):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, terminate)
    try:
        srv.serve_forever()
    finally:
        runtime.stop()
        srv.server_close()


if __name__ == '__main__':
    main()

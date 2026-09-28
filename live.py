#!/usr/bin/env python3
"""Serve the live tool (web/) on localhost, where browsers allow the camera.

    python live.py              # http://127.0.0.1:5092/live/
    python live.py --offline    # first download MediaPipe (wasm + models) into
                                # web/live/vendor/mediapipe so a venue needs no internet

The page prefers the local copy when it exists and falls back to the CDN.
"""
import argparse
import functools
import http.server
import os
import urllib.request
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, 'web')
VENDOR = os.path.join(WEB, 'live', 'vendor', 'mediapipe')
MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/'
MODEL = ('https://storage.googleapis.com/mediapipe-models/pose_landmarker/'
         'pose_landmarker_{m}/float16/latest/pose_landmarker_{m}.task')
FILES = ['vision_bundle.mjs'] + [f'wasm/vision_wasm{v}_internal.{e}'
                                 for v in ('', '_module', '_nosimd') for e in ('js', 'wasm')]


def offline():
    os.makedirs(os.path.join(VENDOR, 'wasm'), exist_ok=True)
    jobs = [(MP + f, os.path.join(VENDOR, f)) for f in FILES]
    jobs += [(MODEL.format(m=m), os.path.join(VENDOR, f'pose_landmarker_{m}.task'))
             for m in ('lite', 'full', 'heavy')]
    for url, dst in jobs:
        if not os.path.exists(dst):
            print('get', os.path.relpath(dst, ROOT))
            urllib.request.urlretrieve(url, dst)
    print('offline copy ready:', os.path.relpath(VENDOR, ROOT))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--offline', action='store_true')
    ap.add_argument('--port', type=int, default=5092)
    a = ap.parse_args()
    if a.offline:
        offline()

    class Handler(http.server.SimpleHTTPRequestHandler):
        extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                          '.mjs': 'text/javascript', '.js': 'text/javascript',
                          '.wasm': 'application/wasm'}

    srv = http.server.ThreadingHTTPServer(('127.0.0.1', a.port),
                                          functools.partial(Handler, directory=WEB))
    url = f'http://127.0.0.1:{a.port}/live/'
    print(url)
    webbrowser.open(url)
    srv.serve_forever()


if __name__ == '__main__':
    main()

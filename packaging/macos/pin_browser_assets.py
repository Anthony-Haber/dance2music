"""Maintainer-only: fetch immutable MediaPipe assets and regenerate their lock."""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def main():
    base = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/'
    paths = ['vision_bundle.mjs', 'vision_bundle.mjs.map', 'README.md', 'package.json'] + [
        f'wasm/vision_wasm{variant}_internal.{ext}'
        for variant in ('', '_module', '_nosimd') for ext in ('js', 'wasm')]
    jobs = [(p, base + p) for p in paths]
    for name in ('lite', 'full', 'heavy'):
        file = f'pose_landmarker_{name}'
        jobs.append((file + '.task', f'https://storage.googleapis.com/mediapipe-models/pose_landmarker/{file}/float16/1/{file}.task'))
    jobs.append(('gesture_recognizer.task', 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task'))
    files = []
    for path, url in jobs:
        digest, size = hashlib.sha256(), 0
        with urllib.request.urlopen(url, timeout=120) as response:
            for block in iter(lambda: response.read(1024 * 1024), b''):
                size += len(block)
                digest.update(block)
        files.append(dict(path=path, url=url, size=size, sha256=digest.hexdigest()))
        print(path, size, flush=True)
    (ROOT / 'web/live/mediapipe-assets.lock.json').write_text(json.dumps(
        {'schema': 1, 'runtime': '1.0.1', 'model_version': 'float16/1', 'license': 'Apache-2.0', 'files': files}, indent=2) + '\n')


if __name__ == '__main__':
    main()

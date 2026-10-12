"""Pinned scene assets; no Python inference or runtime dependency installation."""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent
LOCK = ROOT / 'web/live/scene-assets.lock.json'
VENDOR = ROOT / 'web/live/vendor/scene'


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def prepare(destination=VENDOR, lock_path=LOCK):
    lock = json.loads(lock_path.read_text())
    destination = Path(destination)
    (destination / 'ready.json').unlink(missing_ok=True)
    for asset in lock['files']:
        target = destination / asset['path']
        if target.exists() and target.stat().st_size == asset['size'] and digest(target) == asset['sha256']:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(target.suffix + '.partial')
        print('get scene/' + asset['path'], flush=True)
        try:
            with urllib.request.urlopen(asset['url'], timeout=120) as response, temporary.open('wb') as out:
                for block in iter(lambda: response.read(1024 * 1024), b''):
                    out.write(block)
            if temporary.stat().st_size != asset['size'] or digest(temporary) != asset['sha256']:
                raise ValueError('Scene asset checksum mismatch: ' + asset['path'])
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    # Written last: interrupted/partial installations never advertise readiness.
    marker = destination / 'ready.json.partial'
    marker.write_text(json.dumps({'lock_sha256': digest(lock_path)}))
    marker.replace(destination / 'ready.json')
    print('offline scene assets verified:', destination)


if __name__ == '__main__':
    prepare()

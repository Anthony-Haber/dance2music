"""Pinned MRT2 installation assets. Downloads are explicit, never session-time.

The native proof gate uses ``python magenta_assets.py --download --model small``.
Omit --model to install both sizes. --verify performs no network requests.
"""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parent
LOCK = ROOT / 'native/magenta/manifest.lock.json'
DEFAULT_ROOT = ROOT / '.magenta'


def manifest():
    return json.loads(LOCK.read_text())


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def assets(model='both'):
    return [a for a in manifest()['models']['assets']
            if model == 'both' or not a['path'].startswith('models/')
            or a['path'].startswith(f'models/mrt2_{model}/')]


def valid(path, asset):
    return (path.is_file() and path.stat().st_size == asset['bytes']
            and sha256(path) == asset['sha256'])


def verify(root=DEFAULT_ROOT, model='both'):
    """Return missing/corrupt assets, including files with the correct size."""
    return [a['path'] for a in assets(model) if not valid(Path(root) / a['path'], a)]


def download_asset(asset, root, revision):
    path = Path(root) / asset['path']
    if valid(path, asset):
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + '.part')
    url = (f'https://huggingface.co/google/magenta-realtime-2/resolve/'
           f'{revision}/{asset["path"]}')
    print('get', asset['path'], flush=True)
    try:
        with urllib.request.urlopen(url, timeout=120) as response, partial.open('wb') as dest:
            for block in iter(lambda: response.read(1024 * 1024), b''):
                dest.write(block)
        if not valid(partial, asset):
            raise ValueError(f'Hash/size mismatch: {asset["path"]}')
        partial.replace(path)
    finally:
        partial.unlink(missing_ok=True)


def prepare(root=DEFAULT_ROOT, model='both'):
    lock = manifest()
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(lambda a: download_asset(a, root, lock['models']['revision']), assets(model)))
    missing = verify(root, model)
    if missing:
        raise RuntimeError('MRT2 installation incomplete: ' + ', '.join(missing))
    print(f'MRT2 {model} model assets verified (native helper still requires a build).')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=DEFAULT_ROOT)
    parser.add_argument('--model', choices=('base', 'small', 'both'), default='both')
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--download', action='store_true')
    action.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    if args.download:
        prepare(args.root, args.model)
    else:
        missing = verify(args.root, args.model)
        print(json.dumps({'assets_verified': not missing, 'missing_or_corrupt': missing}, indent=2))
        return int(bool(missing))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

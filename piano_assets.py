"""Verified, same-origin acoustic-piano assets; no native build required."""
from pathlib import Path
from scene_assets import prepare as prepare_assets

ROOT = Path(__file__).resolve().parent
LOCK = ROOT / 'web/live/piano-assets.lock.json'
VENDOR = ROOT / 'web/live/vendor/piano'


def prepare(destination=VENDOR, lock_path=LOCK):
    prepare_assets(destination, lock_path, name='piano')


if __name__ == '__main__':
    prepare()

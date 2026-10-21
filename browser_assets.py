"""Pinned pose and hand assets, shared by CLI preparation and Mac packaging."""
from pathlib import Path
from scene_assets import prepare as prepare_assets

ROOT = Path(__file__).resolve().parent
LOCK = ROOT / 'web/live/mediapipe-assets.lock.json'


def prepare(destination=ROOT / 'web/live/vendor/mediapipe'):
    prepare_assets(destination, LOCK, name='mediapipe')

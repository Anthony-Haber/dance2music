"""Where things live. Everything big stays out of git (see .gitignore)."""
import glob
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'output')          # landmarks, features, renders
VIDEOS = os.path.join(ROOT, 'videos')       # source clips

# The rope's performance engine (soniqflow-m5stack-python). Only the
# `dance_pose.py music` stage and `sonify.py` need it; motion/harmony/synths
# do not.
ROPEFLOW = os.environ.get('ROPEFLOW_ROOT', os.path.expanduser(
    '~/Documents/00-projects/00-active/music/rope-flow-music/m5stack-rope'))


def find_video(stem):
    """A clip by name: videos/ first, then ~/Downloads."""
    for d in (VIDEOS, os.path.expanduser('~/Downloads')):
        hits = glob.glob(os.path.join(d, stem + '.*'))
        if hits:
            return hits[0]
    raise FileNotFoundError(f'{stem}: put the clip in {VIDEOS}')

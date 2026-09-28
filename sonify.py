#!/usr/bin/env python3
"""Sonify a dance from its own vocabulary — no pulse, no drum machine.

The measurement said this dance has no beat (139 accents, period
confidence 0.00), so anything built on a clock fights the material.
What it does have is six shapes (`vocabulary.py`) and a body that moves
continuously between them. So:

  the shape sets the harmony   — a chord per shape, voiced by the same
                                 voice-led quartet the rope uses, so the
                                 top voice steps when the shape changes
                                 and holds while it lasts
  the body works the sound     — hands high → expression, arms wide →
                                 brightness, speed → bow pressure, all as
                                 CC lanes, continuously
  nothing keeps time           — no drums, no grid; a change is heard
                                 because the harmony moves, not because a
                                 bar came round

    python sonify.py videos/VIDEO-....mp4 [--watch]

Writes `<stem>__sonify.mid` (four section tracks with their CC lanes, to
drop straight on the SWAM tracks in Live), `.wav`, and with `--watch` a
watchable version.
"""
import argparse
import json
import os
import sys

import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
from config import ROPEFLOW as _ROPE  # noqa: E402
for _p in (_ROPE, os.path.join(_ROPE, 'tools')):
    if os.path.isdir(_p) and _p not in sys.path:
        sys.path.append(_p)

from dance_pose import (out_dir, _fill_gaps, _smooth, overlay,  # noqa: E402
                        L_SH, R_SH, L_HIP, R_HIP, L_WR, R_WR, L_AN, R_AN)
from vocabulary import OUT as VOCAB_OUT  # noqa: E402

# what each discovered shape sounds like. One key, mostly triads — the
# `one key` lesson from the listening lab — with the register following
# the body: on the floor is warm, overhead is bright.
SHAPE_MUSIC = {
    0: ('Am',    'warm',   'rest'),      # standing, arms down
    1: ('C',     'bright', 'lift'),      # both arms overhead
    2: ('F',     'normal', 'lunge'),     # wide lunge, one arm out
    3: ('G',     'normal', 'reach'),     # standing, one arm up
    4: ('Dm',    'warm',   'ground'),    # hands and feet on the floor
    5: ('Em',    'warm',   'fold'),      # deep fold
}
CC_EXPRESSION, CC_VIBRATO, CC_BOW = 11, 1, 2
SECTIONS = [7, 8, 0, 5]          # violin, viola, cello, bass (the roto channels)


def load(video):
    d = np.load(os.path.join(out_dir(video), 'landmarks.npz'))
    W, t, fps = _fill_gaps(d['W']), d['t'], float(d['fps'])
    cl = json.load(open(os.path.join(VOCAB_OUT, 'clusters.json')))
    name = os.path.basename(video)
    ws = sorted((w for w in cl['windows'] if w['video'] == name), key=lambda w: w['t'])
    if not ws:
        raise SystemExit(f'no vocabulary for {name}: run vocabulary.py over it first')
    wt = np.array([w['t'] for w in ws])
    wl = np.array([w['shape'] for w in ws])
    shape = wl[np.clip(np.searchsorted(wt, t) - 1, 0, len(wl) - 1)]
    return W, t, fps, shape, cl['k']


def controls(W, fps):
    """The three things the body does to the sound, each 0..1."""
    sho = (W[:, L_SH] + W[:, R_SH]) / 2
    hip = (W[:, L_HIP] + W[:, R_HIP]) / 2
    torso = np.maximum(0.05, np.linalg.norm(sho - hip, axis=1))
    high = np.maximum((hip[:, 1] - W[:, L_WR, 1]), (hip[:, 1] - W[:, R_WR, 1])) / torso
    wide = np.linalg.norm(W[:, L_WR] - W[:, R_WR], axis=1) / torso
    limbs = np.stack([W[:, j] for j in (L_WR, R_WR, L_AN, R_AN)], axis=1)
    speed = np.linalg.norm(np.gradient(limbs, axis=0), axis=2).mean(1) * fps / torso

    def norm(x, lo=5, hi=95, smooth=0.35):
        x = _smooth(x, max(3, int(smooth * fps)))
        a, b = np.percentile(x, lo), np.percentile(x, hi)
        return np.clip((x - a) / max(1e-6, b - a), 0, 1)
    return norm(high), norm(wide), norm(speed, smooth=0.5)


def sonify(video, seconds=None, wav=True):
    import perform_render as PR
    from perform.harmony import QuartetVoicer, shifted_ranges
    W, t, fps, shape, _k = load(video)
    T = len(t) if not seconds else min(len(t), int(seconds * fps))
    high, wide, speed = controls(W, fps)
    voicers = {r: QuartetVoicer(shifted_ranges(r)) for r in ('warm', 'normal', 'bright')}
    events, sounding, cur_shape, cur_reg = [], {}, None, None
    cc_every = max(1, int(fps / 15))                       # ~15 Hz control lanes
    last_cc = {}
    for i in range(T):
        ts = float(t[i])
        s = int(shape[i])
        if s != cur_shape and s in SHAPE_MUSIC:
            chord, reg, _name = SHAPE_MUSIC[s]
            v = voicers[reg].voice(chord)
            if cur_reg is not None and reg != cur_reg:
                for r, vc in voicers.items():             # keep the line across registers
                    if r != reg:
                        vc.prev = None
            cur_shape, cur_reg = s, reg
            if v:
                # legato: only the voices that actually moved
                for ch, note in zip(SECTIONS, [v[3], v[2], v[1], v[0]]):
                    old = sounding.get(ch)
                    if old != note:
                        if old is not None:
                            events.append((ts, [0x80 | ch, old, 0]))
                        events.append((ts, [0x90 | ch, int(note),
                                            int(50 + 50 * speed[i])]))
                        sounding[ch] = int(note)
        if i % cc_every == 0:
            # loudness from how high the hands are and how fast; brightness
            # from how open the body is; bow pressure from speed alone
            expr = int(np.clip(22 + 105 * (0.55 * high[i] + 0.45 * speed[i]), 0, 127))
            vib = int(np.clip(10 + 90 * wide[i], 0, 127))
            bow = int(np.clip(20 + 100 * speed[i], 0, 127))
            for ch in SECTIONS:
                for cc, val in ((CC_EXPRESSION, expr), (CC_VIBRATO, vib), (CC_BOW, bow)):
                    if last_cc.get((ch, cc)) != val:
                        events.append((ts, [0xB0 | ch, cc, val]))
                        last_cc[(ch, cc)] = val
    for ch, note in sounding.items():
        events.append((float(t[T - 1]), [0x80 | ch, note, 0]))
    events.sort(key=lambda e: e[0])
    base = os.path.join(out_dir(video),
                        f'{os.path.splitext(os.path.basename(video))[0]}__sonify')
    PR._write_midi(base + '.mid', events, SECTIONS, float(t[0]))
    if wav:
        PR._write_wav(base + '.mid', base + '.wav', PR.SF2_DEFAULT)
    changes = sum(1 for e in events if (e[1][0] & 0xF0) == 0x90)
    print(f'{base}.wav  {changes} note events, '
          f'{sum(1 for e in events if (e[1][0] & 0xF0) == 0xB0)} CC messages, '
          f'{len(set(shape[:T]))} shapes used')
    return base


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('video')
    ap.add_argument('--seconds', type=float, default=None)
    ap.add_argument('--watch', action='store_true', help='also render the video')
    a = ap.parse_args()
    base = sonify(a.video, a.seconds)
    if a.watch:
        overlay(a.video, base, a.seconds)


if __name__ == '__main__':
    main()

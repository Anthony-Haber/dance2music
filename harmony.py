#!/usr/bin/env python3
"""Pose picks the chord of a ii–V–I; the voices glide between them by step.

The rules (first match wins, otherwise the chord holds):

    V   all down     both hands below mid-thigh
    ii  one side     both hands past the same side of both feet
    I   at home      each hand and each foot on its own side of the body
                     (left limbs left of the hips' midline, in the body's
                     own frame, so it survives her turning her back)

A new chord has to be read for `DWELL_S` without a break before it sounds,
so passing through a shape on the way somewhere else does not change it.

The voicings are rootless (the bass takes the root), chosen so every voice
moves by at most a whole step between any two of the chords:

    Dm9    F  A  C  E       over D
    G13    F  A  B  E       over G     (ii → V moves one voice, C → B)
    G7alt  F  A♭ B  E♭      over G     (every voice a half step from both neighbours)
    Cmaj9  E  G  B  D       over C

    python harmony.py      # print how often each rule fires
"""
import os
import sys

import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

import motion as M  # noqa: E402
from dance_pose import (L_WR, R_WR, L_AN, R_AN, L_HIP, R_HIP, L_KN, R_KN)  # noqa: E402

DWELL_S = 0.35         # a reading must last this long to change the chord
DOWN_AT = 0.5          # "down": below this fraction of the way from hips to knees
SIDE_MARGIN = 0.15     # "one side": this many torsos past the outer foot
HOME_MARGIN = 0.05     # "at home": this many torsos onto its own side

CHORDS = {
    'ii': dict(symbol='Dm9', bass=38, voices=(53, 57, 60, 64)),
    'V': dict(symbol='G13', bass=43, voices=(53, 57, 59, 64)),
    'Valt': dict(symbol='G7alt', bass=43, voices=(53, 56, 59, 63)),
    'I': dict(symbol='Cmaj9', bass=36, voices=(52, 55, 59, 62)),
}
DEGREE = {'ii': 'ii', 'V': 'V', 'Valt': 'V', 'I': 'I'}


def read_pose(f):
    """Per frame: which rule the pose satisfies ('ii', 'V', 'I' or '')."""
    P, tl = f['P'], f['tl']
    hip = (P[:, L_HIP] + P[:, R_HIP]) / 2
    knee_y = (P[:, L_KN, 1] + P[:, R_KN, 1]) / 2
    wr = P[:, [L_WR, R_WR]]
    an = P[:, [L_AN, R_AN]]

    # V: both hands low (image y grows downward)
    down_y = hip[:, 1] + DOWN_AT * (knee_y - hip[:, 1])
    down = (wr[:, :, 1] > down_y[:, None]).all(1)

    # ii: both hands beyond the same side of both feet, on screen
    m = SIDE_MARGIN * tl
    left = (wr[:, :, 0] < an[:, :, 0].min(1)[:, None] - m[:, None]).all(1)
    right = (wr[:, :, 0] > an[:, :, 0].max(1)[:, None] + m[:, None]).all(1)
    side = left | right

    # I: every limb on its own side, measured along the hips' own left→right
    axis = P[:, L_HIP] - P[:, R_HIP]
    width = np.linalg.norm(axis, axis=1)
    u = axis / np.maximum(width, 1e-6)[:, None]
    def lat(j):                                             # + = her left
        return ((P[:, j] - hip) * u).sum(1) / tl
    hm = HOME_MARGIN
    home = ((lat(L_WR) > hm) & (lat(R_WR) < -hm) & (lat(L_AN) > hm) & (lat(R_AN) < -hm)
            & (width > 0.25 * tl))                           # side-on: can't tell

    # tracking we cannot trust reads as nothing
    ok = f['conf'][:, [L_WR, R_WR, L_AN, R_AN, L_HIP, R_HIP]].min(1) > 0.5
    raw = np.where(down, 'V', np.where(side, 'ii', np.where(home, 'I', '')))
    return np.where(ok, raw, ''), dict(down=down, side=side, home=home, down_y=down_y)


def chords(f, alt_weight=None):
    """Held chord per frame after the dwell, starting on I.

    `alt_weight`: if given, V becomes G7alt while the Weight is high
    (on above 0.55, off below 0.4), so strong movement adds tension."""
    raw, guides = read_pose(f)
    fps = f['fps']
    need = max(1, int(DWELL_S * fps))
    cur, run_lab, run_n = 'I', '', 0
    out = []
    for r in raw:
        if r and r == run_lab:
            run_n += 1
        else:
            run_lab, run_n = r, 1 if r else 0
        if run_lab and run_n >= need and run_lab != cur:
            cur = run_lab
        out.append(cur)
    out = np.array(out, dtype=object)
    if alt_weight is not None:
        hot, on = np.zeros(len(out), bool), False
        for i, w in enumerate(alt_weight):
            on = w > 0.55 if not on else w > 0.4
            hot[i] = on
        # no alteration shorter than half a second: tension, not flicker
        need_alt = max(1, int(0.5 * fps))
        i = 0
        while i < len(hot):
            j = i
            while j < len(hot) and hot[j] == hot[i]:
                j += 1
            if j - i < need_alt and i > 0:
                hot[i:j] = hot[i - 1]
            i = j
        out = np.where((out == 'V') & hot, 'Valt', out)
        # a V shorter than that at the edge of an alteration takes its neighbour's colour
        fam = {'V', 'Valt'}
        i = 0
        while i < len(out):
            j = i
            while j < len(out) and out[j] == out[i]:
                j += 1
            if out[i] in fam and j - i < need_alt:
                if j < len(out) and out[j] in fam:
                    out[i:j] = out[j]
                elif i > 0 and out[i - 1] in fam:
                    out[i:j] = out[i - 1]
            i = j
    return out, raw, guides


def segments(f, held):
    t = f['t'] - f['t'][0]
    seg, a = [], 0
    for i in range(1, len(held) + 1):
        if i == len(held) or held[i] != held[a]:
            c = str(held[a])
            seg.append(dict(t0=round(float(t[a]), 3), t1=round(float(t[i - 1]), 3),
                            chord=c, symbol=CHORDS[c]['symbol'], degree=DEGREE[c]))
            a = i
    return seg


def main():
    for stem in M.stems():
        f = M.load(stem)
        held, raw, _ = chords(f)
        dur = f['t'][-1] - f['t'][0]
        seg = segments(f, held)
        share = {k: float(np.mean(raw == k)) for k in ('I', 'ii', 'V', '')}
        print(f"{stem}: raw reads I {share['I']:.0%}  ii {share['ii']:.0%}  "
              f"V {share['V']:.0%}  none {share['']:.0%}   "
              f"{len(seg) - 1} changes ({60 * (len(seg) - 1) / dur:.0f}/min), "
              f"median chord {np.median([s['t1'] - s['t0'] for s in seg]):.1f}s")


if __name__ == '__main__':
    main()

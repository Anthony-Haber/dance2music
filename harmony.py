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
from dance_pose import (L_WR, R_WR, L_AN, R_AN, L_HIP, R_HIP, L_KN, R_KN, L_SH, R_SH)  # noqa: E402

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


# ── six chords from where the hands are, relative to the torso ─────────
#
# The hands' midpoint h̄ and their spread, in torso lengths from the torso
# centre c (halfway between the shoulders' and the hips' midpoints).
# λ = (h̄x − cx)/ℓ is positive toward her left when she faces the camera
# (her left hand appears on the right of the camera's picture); μ = (h̄y − cy)/ℓ
# is positive downward.
#
#     centred |λ| < 0.35:  raised (μ < −0.5), or spread > 1.8 with μ < 0.5  →  IV
#                          otherwise (including arms hanging)  →  I
#     her left  λ ≥ 0.35:  up (μ < 0) → vi,   down → ii
#     her right λ ≤ −0.35: up (μ < 0) → iii,  down → V
#
# Voicings are not fixed: each new chord's four pitch classes are placed on
# the four voices to move them as little as possible (voice_lead), so any
# chord can follow any other by steps.

SIX = {
    'I':   dict(symbol='Cmaj9',   bass=36, pcs=(4, 7, 11, 2)),   # E G B D
    'ii':  dict(symbol='Dm9',     bass=38, pcs=(5, 9, 0, 4)),    # F A C E
    'iii': dict(symbol='Em7(11)', bass=40, pcs=(7, 11, 2, 9)),   # G B D A
    'IV':  dict(symbol='Fmaj9',   bass=41, pcs=(9, 0, 4, 7)),    # A C E G
    'V':   dict(symbol='G13',     bass=43, pcs=(11, 4, 5, 9)),   # B E F A
    'vi':  dict(symbol='Am9',     bass=45, pcs=(0, 4, 7, 11)),   # C E G B
}
CENTRE_BAND, RAISED_AT, WIDE_AT = 0.35, -0.5, 1.8
WIDE_BELOW = 0.5        # "wide" only counts with the hands above the hips
DWELL6_S = 0.5          # the regions tile the whole space, so ask for a little more
VOICE_RANGE = (50, 70)
START_VOICING = (52, 55, 59, 62)


def voice_lead(prev, pcs, lo=VOICE_RANGE[0], hi=VOICE_RANGE[1]):
    """Place pitch classes on the voices, least total motion, inside [lo, hi]."""
    from itertools import permutations
    best = None
    for perm in permutations(pcs):
        out = []
        for p, pc in zip(prev, perm):
            m = p + ((pc - p) % 12)                 # the nearest pc at or above p …
            if m - p > 6:
                m -= 12                            # … or below it, whichever is closer
            while m < lo:
                m += 12
            while m > hi:
                m -= 12
            out.append(m)
        cost = (sum(abs(a - b) for a, b in zip(out, prev)),
                max(abs(a - b) for a, b in zip(out, prev)))
        if best is None or cost < best[0]:
            best = (cost, tuple(out))
    return best[1]


def read_regions(f):
    """Per frame: which of the six regions the hands are in ('' if unsure)."""
    P, tl = f['P'], f['tl']
    c = ((P[:, L_SH] + P[:, R_SH]) / 2 + (P[:, L_HIP] + P[:, R_HIP]) / 2) / 2
    hb = (P[:, L_WR] + P[:, R_WR]) / 2
    lam = (hb[:, 0] - c[:, 0]) / tl
    mu = (hb[:, 1] - c[:, 1]) / tl
    spread = np.linalg.norm(P[:, L_WR] - P[:, R_WR], axis=1) / tl
    centred = np.abs(lam) < CENTRE_BAND
    up = mu < 0
    wide = (spread > WIDE_AT) & (mu < WIDE_BELOW)          # arms open, not hands on the floor
    raw = np.where(centred, np.where((mu < RAISED_AT) | wide, 'IV', 'I'),
                   np.where(lam > 0, np.where(up, 'vi', 'ii'), np.where(up, 'iii', 'V')))
    ok = f['conf'][:, [L_WR, R_WR, L_SH, R_SH, L_HIP, R_HIP]].min(1) > 0.5
    return np.where(ok, raw, ''), dict(c=c, lam=lam, mu=mu, spread=spread)


def chords6(f):
    """Held chord per frame (after the dwell) and its voice-led voicing."""
    raw, guides = read_regions(f)
    need = max(1, int(DWELL6_S * f['fps']))
    cur, run_lab, run_n, voicing = 'I', '', 0, START_VOICING
    held, voices = [], []
    for r in raw:
        if r and r == run_lab:
            run_n += 1
        else:
            run_lab, run_n = r, 1 if r else 0
        if run_lab and run_n >= need and run_lab != cur:
            cur = run_lab
            voicing = voice_lead(voicing, SIX[cur]['pcs'])
        held.append(cur)
        voices.append(voicing)
    return np.array(held, dtype=object), np.array(voices, float), raw, guides


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
            spec = CHORDS.get(c) if c in DEGREE else SIX[c]
            seg.append(dict(t0=round(float(t[a]), 3), t1=round(float(t[i - 1]), 3),
                            chord=c, symbol=spec['symbol'], degree=DEGREE.get(c, c)))
            a = i
    return seg


def main():
    # every pair of the six chords, voice-led from every other: the largest step
    worst = 0
    for a in SIX:
        va = voice_lead(START_VOICING, SIX[a]['pcs'])
        for b in SIX:
            vb = voice_lead(va, SIX[b]['pcs'])
            worst = max(worst, max(abs(x - y) for x, y in zip(va, vb)))
    print(f'six chords: largest single-voice move between any two = {worst} semitones')
    for stem in M.stems():
        f = M.load(stem)
        held, _v, raw, _g = chords6(f)
        seg = segments(f, held)
        dur = f['t'][-1] - f['t'][0]
        share = '  '.join(f"{k} {np.mean(raw == k):.0%}" for k in list(SIX) + [''])
        print(f"{stem} six: {share}   {len(seg) - 1} changes ({60 * (len(seg) - 1) / dur:.0f}/min), "
              f"chords used {sorted(set(held))}")
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

#!/usr/bin/env python3
"""How she moves, not where she is: velocity, acceleration, jerk, and the
four Laban Efforts computed from them.

Pose tells you the shape; the sound in `synths.py` is driven by motion
instead. Derivatives amplify tracker jitter (a 2 px wobble at 30 fps is
60 px/s of fake speed, and worse for acceleration), so the cleaning is
the first half of this file:

  1. gate     landmarks the tracker is unsure of (visibility < 0.5) are dropped
  2. Hampel   a point more than 3 robust sigmas from its local median is a
              glitch, not a movement, and is dropped too
  3. fill     short gaps are interpolated; gaps longer than 0.3 s get zero
              confidence, so nothing downstream hears a limb it cannot see
  4. low-pass zero-phase Butterworth at 5 Hz (human movement lives below
              that; the tracker's jitter mostly does not). Zero-phase because
              this is offline, so the smoothing costs no latency
  5. derive   Savitzky–Golay derivatives (a local polynomial fit, not a
              finite difference) for velocity, acceleration, jerk
  6. floor    each limb's residual speed when nearly still is subtracted
              in quadrature, so resting is silence rather than hiss

Everything is in torso lengths (shoulders to hips, rolling median over 5 s)
so the numbers mean the same whether she is near the camera or far.

The Efforts, following the usual computational reading (Larboulette & Gibet):
    Weight   strong ↔ light        peak kinetic energy of the limbs, 0.5 s
    Time     sudden ↔ sustained    mean acceleration of the limbs, 0.5 s
    Space    direct ↔ indirect     how straight the hands travel, 1 s
    Flow     bound  ↔ free         jerkiness: jerk relative to acceleration
                                   (raw jerk is ~acceleration again, and would
                                   just be Time twice)
plus Shape (how much room the body takes, its hull) and travel (the hips
crossing the floor).

    python motion.py            # all clips with landmarks

Writes `output/_motion/<stem>/motion.npz` and
`_motion/cleaning.png` (raw vs cleaned speed, to check the filter).
"""
import glob
import json
import os
import sys
import warnings

import numpy as np
from scipy.ndimage import maximum_filter1d, median_filter, uniform_filter1d
from scipy.signal import butter, filtfilt, find_peaks, savgol_filter
from scipy.spatial import ConvexHull

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

from dance_pose import (NOSE, L_SH, R_SH, L_EL, R_EL, L_WR, R_WR,  # noqa: E402
                        L_HIP, R_HIP, L_KN, R_KN, L_AN, R_AN)

from config import OUT as POSE_ROOT  # noqa: E402
OUT = os.path.join(POSE_ROOT, '_motion')

# the end effectors whose motion we listen to, plus the pelvis for travel
PARTS = ('head', 'lhand', 'rhand', 'lfoot', 'rfoot')
PART_J = (NOSE, L_WR, R_WR, L_AN, R_AN)
HULL_J = [NOSE, L_SH, R_SH, L_EL, R_EL, L_WR, R_WR, L_HIP, R_HIP, L_KN, R_KN, L_AN, R_AN]

VIS_MIN = 0.5
CUTOFF_HZ = 5.0
MAX_GAP_S = 0.3


# ── cleaning ──────────────────────────────────────────────────────────

def _hampel(x, half, nsig=3.0, floor=1.0):
    """NaN out samples far from their local median (robust glitch filter)."""
    pad = np.pad(x, half, mode='edge')
    win = np.lib.stride_tricks.sliding_window_view(pad, 2 * half + 1)
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', RuntimeWarning)
        med = np.nanmedian(win, axis=1)
        mad = 1.4826 * np.nanmedian(np.abs(win - med[:, None]), axis=1)
    out = x.copy()
    out[np.abs(x - med) > nsig * np.maximum(mad, floor)] = np.nan
    return out


def _fill(x, max_gap):
    """Interpolate NaNs; return the filled series and a 0/1 confidence."""
    bad = np.isnan(x)
    conf = (~bad).astype(float)
    if bad.all():
        return np.zeros_like(x), np.zeros_like(x)
    if bad.any():
        x = x.copy()
        x[bad] = np.interp(np.flatnonzero(bad), np.flatnonzero(~bad), x[~bad])
        # short gaps are trusted (interpolation is fine), long ones are not
        idx = np.flatnonzero(np.diff(np.r_[0, bad.astype(int), 0]))
        for a, b in zip(idx[::2], idx[1::2]):
            if b - a <= max_gap:
                conf[a:b] = 1.0
    return x, conf


def clean(X, fps, w, h):
    """Landmarks (T, 33, 4 normalised) → filtered pixels, confidence, raw pixels."""
    T = len(X)
    P = X[:, :, :2].astype(np.float64) * [w, h]
    vis = np.nan_to_num(X[:, :, 3].astype(np.float64))
    raw = P.copy()
    P[vis < VIS_MIN] = np.nan
    half = max(2, int(0.15 * fps))
    conf = np.ones((T, 33))
    b, a = butter(4, CUTOFF_HZ / (fps / 2))
    for j in range(33):
        cj = np.ones(T)
        for c in range(2):
            col = _hampel(P[:, j, c], half)
            col, cc = _fill(col, int(MAX_GAP_S * fps))
            raw[:, j, c], _ = _fill(raw[:, j, c], 10 ** 9)
            P[:, j, c] = filtfilt(b, a, col)
            cj = np.minimum(cj, cc)
        conf[:, j] = uniform_filter1d(cj, max(3, int(0.2 * fps)))   # soft edges
    return P, conf, raw


def torso_px(P, fps):
    sho = (P[:, L_SH] + P[:, R_SH]) / 2
    hip = (P[:, L_HIP] + P[:, R_HIP]) / 2
    tl = np.linalg.norm(sho - hip, axis=1)
    tl = median_filter(tl, size=int(5 * fps) | 1, mode='nearest')
    g = np.median(tl)
    return np.clip(tl, 0.6 * g, 1.4 * g)


def derivatives(P, fps):
    d = 1.0 / fps
    odd = lambda s: int(s * fps) | 1                      # noqa: E731
    V = savgol_filter(P, odd(0.23), 3, deriv=1, delta=d, axis=0)
    A = savgol_filter(P, odd(0.37), 3, deriv=2, delta=d, axis=0)
    J = savgol_filter(P, odd(0.50), 4, deriv=3, delta=d, axis=0)
    return V, A, J


# ── features ──────────────────────────────────────────────────────────

def features(stem):
    d = np.load(os.path.join(POSE_ROOT, stem, 'landmarks.npz'))
    X, t, fps = d['X'], d['t'].astype(float), float(d['fps'])
    w, h = int(d['width']), int(d['height'])
    P, conf, raw = clean(X, fps, w, h)
    tl = torso_px(P, fps)
    V, A, J = derivatives(P, fps)
    n = lambda M: np.linalg.norm(M, axis=2) / tl[:, None]  # noqa: E731
    pj = list(PART_J)
    c5 = conf[:, pj]
    spd, acc, jrk = n(V)[:, pj] * c5, n(A)[:, pj] * c5, n(J)[:, pj] * c5

    # jitter floor: what a limb reads when it is as still as it gets
    floor = np.percentile(spd, 10, axis=0)
    spd = np.sqrt(np.maximum(0, spd ** 2 - floor ** 2))

    # the same speed with none of the cleaning, for the diagnostic
    Vraw = np.gradient(raw, axis=0) * fps
    spd_raw = np.linalg.norm(Vraw, axis=2)[:, pj] / tl[:, None]

    pelvis = (P[:, L_HIP] + P[:, R_HIP]) / 2
    pv = (V[:, L_HIP] + V[:, R_HIP]) / 2 / tl[:, None]
    pel_spd = np.linalg.norm(pv, axis=1)

    win = lambda s: max(3, int(s * fps))                   # noqa: E731
    weight = np.sqrt(maximum_filter1d((spd ** 2).sum(1) + 2 * pel_spd ** 2, win(0.5)))
    weight = uniform_filter1d(weight, win(0.3))        # the max-hold leaves steps
    time_ = uniform_filter1d(acc.mean(1), win(0.5))
    a_sum = uniform_filter1d(acc[:, 1:].sum(1), win(0.5))
    j_sum = uniform_filter1d(jrk[:, 1:].sum(1), win(0.5))
    # Hz-like: how fast the acceleration itself turns. The constant keeps a
    # nearly-still body (tiny a, tiny j) from reading as wildly jerky.
    flow = uniform_filter1d(j_sum / (a_sum + 4.0), win(0.5))

    # Space: straightness of each hand's path over 1 s, weighted by path length
    hw = win(0.5)
    dirs, lens = [], []
    for j in (L_WR, R_WR):
        step = np.linalg.norm(V[:, j], axis=1) / fps / tl
        path = np.convolve(step, np.ones(2 * hw + 1), mode='same')
        Pj = np.pad(P[:, j], ((hw, hw), (0, 0)), mode='edge')
        disp = np.linalg.norm(Pj[2 * hw:] - Pj[:-2 * hw], axis=1) / tl
        dirs.append(np.clip(disp / np.maximum(path, 1e-6), 0, 1))
        lens.append(path)
    dirs, lens = np.array(dirs), np.array(lens)
    space = (dirs * lens).sum(0) / np.maximum(lens.sum(0), 1e-6)
    moving = lens.sum(0) > 0.4                          # under ~half a torso: undefined
    space = np.where(moving, space, np.nan)
    space, _ = _fill(space, 10 ** 9)
    space = uniform_filter1d(space, win(0.3))

    hull = np.zeros(len(t))
    for i in range(len(t)):
        try:
            hull[i] = ConvexHull(P[i, HULL_J]).volume / tl[i] ** 2
        except Exception:
            hull[i] = hull[i - 1] if i else 0
    shape = uniform_filter1d(hull, win(0.2))

    return dict(stem=stem, t=t, fps=fps, w=w, h=h, P=P.astype(np.float32),
                V=V.astype(np.float32), conf=conf.astype(np.float32), tl=tl,
                speed=spd, accel=acc, jerk=jrk, speed_raw=spd_raw,
                weight=weight, time=time_, flow=flow, space=space, shape=shape,
                travel=pv[:, 0], pelvis=pelvis)


FEATS = ('weight', 'time', 'flow', 'space', 'shape', 'travel')


def normalise(all_f):
    """Pool the clips (same dancer, same studio) so 'strong' means the same in each."""
    ref = {}
    for k in FEATS + ('speed', 'accel'):
        pool = np.concatenate([np.ravel(f[k]) for f in all_f])
        lo, hi = (np.percentile(pool, 2), np.percentile(pool, 98))
        if k == 'travel':
            m = np.percentile(np.abs(pool), 98)
            lo, hi = -m, m
        if k == 'space':
            lo, hi = 0.0, 1.0            # already a ratio
        ref[k] = (float(lo), float(hi))
    for f in all_f:
        for k in FEATS:
            lo, hi = ref[k]
            f['n_' + k] = np.clip((f[k] - lo) / (hi - lo), 0, 1)
        lo, hi = ref['speed']
        f['n_speed'] = np.clip(f['speed'] / hi, 0, 1)
    # sudden events: acceleration peaks per limb, one threshold for all clips
    pool = np.concatenate([f['accel'][:, 1:].ravel() for f in all_f])
    thr = float(np.percentile(pool, 85))
    top = float(np.percentile(pool, 99.5))
    for f in all_f:
        ev = []
        for k, part in enumerate(PARTS):
            if part == 'head':
                continue
            pk, pr = find_peaks(f['accel'][:, k], height=thr, prominence=0.5 * thr,
                                distance=max(1, int(0.25 * f['fps'])))
            for i, hgt in zip(pk, pr['peak_heights']):
                ev.append((float(f['t'][i]), part, float(min(1, (hgt - thr) / (top - thr) + 0.25))))
        f['events'] = sorted(ev)
    return ref


def save(f):
    d = os.path.join(OUT, f['stem'])
    os.makedirs(d, exist_ok=True)
    ev = f.pop('events')
    np.savez_compressed(os.path.join(d, 'motion.npz'), **f)
    with open(os.path.join(d, 'events.json'), 'w') as fh:
        json.dump(ev, fh)
    f['events'] = ev


def load(stem):
    d = os.path.join(OUT, stem)
    f = dict(np.load(os.path.join(d, 'motion.npz'), allow_pickle=True))
    for k in ('stem',):
        f[k] = str(f[k])
    for k in ('fps',):
        f[k] = float(f[k])
    for k in ('w', 'h'):
        f[k] = int(f[k])
    f['events'] = [tuple(e) for e in json.load(open(os.path.join(d, 'events.json')))]
    return f


def diagnostic(f, path, seconds=(20, 32)):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    t = f['t']
    m = (t >= seconds[0]) & (t <= seconds[1])
    fig, ax = plt.subplots(3, 1, figsize=(10, 7), sharex=True)
    ax[0].plot(t[m], f['speed_raw'][m, 2], color='#bbb', lw=0.8, label='raw frame difference')
    ax[0].plot(t[m], f['speed'][m, 2], color='#2c5aa0', lw=1.6, label='cleaned')
    ax[0].set_ylabel('right hand speed\n(torsos/s)')
    ax[0].legend(frameon=False, fontsize=8)
    ax[1].plot(t[m], f['accel'][m, 2], color='#c0392b', lw=1.2)
    ax[1].set_ylabel('acceleration\n(torsos/s²)')
    ax[2].plot(t[m], f['n_weight'][m], label='Weight')
    ax[2].plot(t[m], f['n_time'][m], label='Time')
    ax[2].plot(t[m], f['n_flow'][m], label='Flow')
    ax[2].plot(t[m], f['space'][m], label='Space')
    ax[2].legend(frameon=False, fontsize=8, ncol=4)
    ax[2].set_ylabel('efforts (0..1)')
    ax[2].set_xlabel('seconds')
    for a in ax:
        a.spines[['top', 'right']].set_visible(False)
    fig.suptitle(f"{f['stem']}: cleaning and efforts", fontsize=10)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)


def stems():
    return sorted(os.path.basename(os.path.dirname(p))
                  for p in glob.glob(os.path.join(POSE_ROOT, 'VIDEO-*', 'landmarks.npz')))


def main():
    all_f = [features(s) for s in stems()]
    ref = normalise(all_f)
    os.makedirs(OUT, exist_ok=True)
    json.dump(ref, open(os.path.join(OUT, 'norm.json'), 'w'), indent=1)
    for f in all_f:
        c = np.corrcoef([f['n_weight'], f['n_time'], f['n_flow'], f['space'], f['n_shape']])
        print(f"{f['stem']}: {len(f['t'])} frames, {len(f['events'])} sudden events; "
              f"corr W–T {c[0, 1]:.2f}  T–F {c[1, 2]:.2f}  W–S {c[0, 3]:.2f}  W–Shape {c[0, 4]:.2f}")
        save(f)
    diagnostic(all_f[0], os.path.join(OUT, 'cleaning.png'))
    print(os.path.join(OUT, 'cleaning.png'))


if __name__ == '__main__':
    main()

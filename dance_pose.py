#!/usr/bin/env python3
"""Dance → the rope's music engine. A tangent, not a product.

The rope gives the engine three things: a stream of whooshes (when), a
movement name at each of them (what), and a slow energy (how much). A
dancer on video can give the same three things through MediaPipe pose,
and then the whole performance layer — the voice-led quartet, the drum
loop on the rope clock — plays a dance instead.

    python dance_pose.py track  <video> [--every 1]
    python dance_pose.py signals <video>
    python dance_pose.py music   <video> [--preset SWAM-Performance]
    python dance_pose.py all     <video>

Everything lands in `output/<video-stem>/`.

What the labels mean (rule-based, so they can be read and argued with):
    reach      a wrist above the shoulders
    open       arms wide, out to the sides
    close      arms in, near the body
    turn       the shoulder line rotating quickly
    travel     the hips moving across the floor
    low        hips dropped — a plié, a floor moment
    still      none of the above
"""
import argparse
import json
import math
import os
import subprocess
import sys

import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
from config import OUT as OUT_ROOT, ROPEFLOW as _ROPE  # noqa: E402
for _p in (_ROPE, os.path.join(_ROPE, 'tools'), os.path.join(_ROPE, 'scripts')):
    if os.path.isdir(_p) and _p not in sys.path:
        sys.path.append(_p)

# MediaPipe pose landmark ids we care about
NOSE, L_SH, R_SH, L_EL, R_EL, L_WR, R_WR = 0, 11, 12, 13, 14, 15, 16
L_HIP, R_HIP, L_KN, R_KN, L_AN, R_AN = 23, 24, 25, 26, 27, 28
LIMBS = [L_WR, R_WR, L_EL, R_EL, L_AN, R_AN, L_KN, R_KN]

EDGES = [(L_SH, R_SH), (L_SH, L_EL), (L_EL, L_WR), (R_SH, R_EL), (R_EL, R_WR),
         (L_SH, L_HIP), (R_SH, R_HIP), (L_HIP, R_HIP), (L_HIP, L_KN), (L_KN, L_AN),
         (R_HIP, R_KN), (R_KN, R_AN)]

LABELS = ('reach', 'open', 'close', 'turn', 'travel', 'low', 'still')

# a dance map: seven states, one key, mostly triads (the `one key` lesson)
DANCE_CHORDS = {'reach': 'G', 'open': 'C', 'close': 'Am', 'turn': 'Em',
                'travel': 'F', 'low': 'Dm', 'still': '_repeat', 'unknown': '_repeat'}
DANCE_DRUMS = {'reach': 'ride groove', 'open': 'backbeat', 'close': 'brushes',
               'turn': 'funk', 'travel': 'four on the floor', 'low': 'half-time',
               'still': 'sparse'}


def out_dir(video):
    d = os.path.join(OUT_ROOT, os.path.splitext(os.path.basename(video))[0])
    os.makedirs(d, exist_ok=True)
    return d


# ── 1. pose ───────────────────────────────────────────────────────────

def track(video, every=1):
    """MediaPipe pose per frame → landmarks.npz (T, 33, 4: x, y, z, vis)."""
    import cv2
    import mediapipe as mp
    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    pose = mp.solutions.pose.Pose(model_complexity=1, smooth_landmarks=True,
                                  min_detection_confidence=0.5, min_tracking_confidence=0.5)
    pts, wpts, times, seen = [], [], [], 0
    i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if i % every == 0:
            res = pose.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            if res.pose_landmarks:
                lm = res.pose_landmarks.landmark
                pts.append([[p.x, p.y, p.z, p.visibility] for p in lm])
                wl = res.pose_world_landmarks
                wpts.append([[p.x, p.y, p.z] for p in wl.landmark] if wl
                            else np.full((33, 3), np.nan))
                seen += 1
            else:
                pts.append(np.full((33, 4), np.nan))
                wpts.append(np.full((33, 3), np.nan))
            times.append(i / fps)
            if len(times) % 300 == 0:
                print(f'   {times[-1]:6.1f}s  {seen}/{len(times)} frames with a body')
        i += 1
    cap.release()
    pose.close()
    X = np.asarray(pts, dtype=np.float32)
    W = np.asarray(wpts, dtype=np.float32)
    out = os.path.join(out_dir(video), 'landmarks.npz')
    np.savez_compressed(out, X=X, W=W, t=np.asarray(times, np.float32), fps=fps / every,
                        width=w, height=h, frames=n)
    print(f'{out}  {X.shape[0]} frames, {seen} with a body ({100 * seen / max(1, len(pts)):.0f}%)')
    return out


# ── 2. signals ────────────────────────────────────────────────────────

def _smooth(x, n):
    if n <= 1:
        return x
    k = np.ones(n) / n
    return np.convolve(np.nan_to_num(x), k, mode='same')


def _fill_gaps(A):
    """Linear interpolation across frames the tracker missed."""
    A = A.copy()
    for j in range(A.shape[1]):
        for c in range(A.shape[2]):
            col = A[:, j, c]
            bad = np.isnan(col)
            if bad.all():
                col[:] = 0
            elif bad.any():
                col[bad] = np.interp(np.flatnonzero(bad), np.flatnonzero(~bad), col[~bad])
    return A


def signals(video):
    """landmarks → when (accents), what (labels), how much (energy).

    Pose semantics come from MediaPipe's *world* landmarks: metres,
    hip-centred, so "a wrist above the shoulders" means the same thing
    whether she is upright, folded over or side-on to the camera. Where
    the body is in the room (travel) can only come from the image."""
    from scipy.signal import find_peaks
    d = np.load(os.path.join(out_dir(video), 'landmarks.npz'))
    X, t, fps = _fill_gaps(d['X']), d['t'], float(d['fps'])
    W = _fill_gaps(d['W']) if 'W' in d else None
    T = len(t)
    if W is None:
        raise SystemExit('re-run `track`: this take has no world landmarks')
    hip_img = (X[:, L_HIP, :2] + X[:, R_HIP, :2]) / 2
    sho_w = (W[:, L_SH] + W[:, R_SH]) / 2
    hip_w = (W[:, L_HIP] + W[:, R_HIP]) / 2
    torso = np.maximum(0.05, np.linalg.norm(sho_w - hip_w, axis=1))     # ~0.4-0.5 m

    # speed of the limbs about the body, in torsos per second
    v = np.linalg.norm(np.gradient(W[:, LIMBS], axis=0), axis=2) * fps / torso[:, None]
    speed = _smooth(v.mean(axis=1), max(3, int(fps / 10)))
    energy_env = _smooth(speed, max(5, int(3 * fps)))                   # ~3 s, as the rope's
    energy = np.clip(energy_env / max(1e-6, np.percentile(energy_env, 90)), 0, 1)

    # accents: peaks of the fast speed envelope
    prom = max(0.05, float(np.percentile(speed, 75) - np.percentile(speed, 25)) * 0.6)
    idx, props = find_peaks(speed, prominence=prom, distance=max(3, int(fps * 0.22)))
    peaks = [{'type': 'peak', 'time': float(t[i]), 'amplitude': float(speed[i]),
              'prominence': float(props['prominences'][k])} for k, i in enumerate(idx)]
    iv = np.diff([p['time'] for p in peaks]) if len(peaks) > 2 else np.array([0.6])
    period = float(np.median(iv)) if len(iv) else 0.6
    conf = float(max(0.0, 1 - 2 * (np.std(iv) / max(1e-6, np.mean(iv))))) if len(iv) > 2 else 0.3
    for p in peaks:
        p['period'], p['period_confidence'] = period, conf

    # ── what the body is doing (world: y is down, x across, z toward camera)
    wr_h = np.maximum((sho_w[:, 1] - W[:, L_WR, 1]), (sho_w[:, 1] - W[:, R_WR, 1])) / torso
    spread = np.linalg.norm(W[:, L_WR] - W[:, R_WR], axis=1) / torso
    # how far the hands are from the body's middle: in, or out
    reach_out = np.maximum(np.linalg.norm(W[:, L_WR] - sho_w, axis=1),
                           np.linalg.norm(W[:, R_WR] - sho_w, axis=1)) / torso
    yaw = np.unwrap(np.arctan2(W[:, R_SH, 2] - W[:, L_SH, 2], W[:, R_SH, 0] - W[:, L_SH, 0]))
    turn = np.abs(_smooth(np.gradient(yaw) * fps, max(3, int(fps / 4)))) / math.pi
    travel = np.abs(_smooth(np.gradient(hip_img[:, 0]) * fps, max(3, int(fps / 4)))) * 6
    ank = (W[:, L_AN, 1] + W[:, R_AN, 1]) / 2
    stand = np.percentile(ank - hip_w[:, 1], 85)                        # upright hip-to-ankle
    low = 1 - (ank - hip_w[:, 1]) / max(1e-6, stand)                    # 0 upright, 1 collapsed
    fold = (hip_w[:, 1] - sho_w[:, 1]) / torso                          # 1 upright, ~0 folded

    raw = np.empty(T, dtype=object)
    for i in range(T):
        # shape before transition: a folded or dropped body is something you
        # can see, where turning is something the body is passing through
        if wr_h[i] > 0.55 and fold[i] > 0.55:
            raw[i] = 'reach'
        elif low[i] > 0.28 or fold[i] < 0.5:
            raw[i] = 'low'
        elif turn[i] > 0.28:
            raw[i] = 'turn'
        elif travel[i] > 0.5:
            raw[i] = 'travel'
        elif spread[i] > 2.0 or reach_out[i] > 1.25:
            raw[i] = 'open'
        elif speed[i] > 0.35:
            raw[i] = 'close'
        else:
            raw[i] = 'still'
    # a state has to be the majority of a half-second to count as one
    win = max(3, int(fps / 2) | 1)
    out_lab = []
    for i in range(T):
        lo, hi = max(0, i - win // 2), min(T, i + win // 2 + 1)
        vals, counts = np.unique(raw[lo:hi].astype(str), return_counts=True)
        out_lab.append(str(vals[np.argmax(counts)]))

    sig = {'fps': fps, 'seconds': float(t[-1]), 'peaks': peaks,
           'period': period, 'period_confidence': conf,
           'labels_at_peaks': [{'t': p['time'],
                                'label': out_lab[min(T - 1, int(p['time'] * fps))]}
                               for p in peaks],
           'shares': {k: float(np.mean([l == k for l in out_lab])) for k in LABELS}}
    np.savez_compressed(os.path.join(out_dir(video), 'signals.npz'),
                        t=t, energy=energy, speed=speed,
                        labels=np.array(out_lab, dtype='U10'))
    json.dump(sig, open(os.path.join(out_dir(video), 'signals.json'), 'w'), indent=1)
    print(f"{len(peaks)} accents, median {period:.2f}s (conf {conf:.2f}), "
          f"{sig['seconds']:.0f}s")
    print('  ' + '  '.join(f'{k} {100 * v:.0f}%' for k, v in
                           sorted(sig['shares'].items(), key=lambda x: -x[1]) if v > 0.01))
    changes = sum(1 for a, b in zip(out_lab, out_lab[1:]) if a != b)
    print(f'  {changes} label changes ({changes / max(1, sig["seconds"]) * 60:.0f}/min)')
    return sig


# ── 3. music ──────────────────────────────────────────────────────────

class DanceContext:
    """What perform_render.simulate needs, from a dance instead of a rope."""

    def __init__(self, video, seconds=None):
        self.take = os.path.splitext(os.path.basename(video))[0]
        d = np.load(os.path.join(out_dir(video), 'signals.npz'), allow_pickle=True)
        self.t, self.energy_curve, self.frame_labels = d['t'], d['energy'], d['labels']
        sig = json.load(open(os.path.join(out_dir(video), 'signals.json')))
        self.fps = sig['fps']
        self.t0 = float(self.t[0])
        self.t1 = float(self.t[-1]) if not seconds else min(float(self.t[-1]), self.t0 + seconds)
        self.peaks = [p for p in sig['peaks'] if p['time'] <= self.t1]
        self.labels = [(p['time'], self.label_at(p['time']), 0.9) for p in self.peaks]

    def label_at(self, ts):
        return str(self.frame_labels[min(len(self.frame_labels) - 1, int(ts * self.fps))])

    def energy_at(self, ts):
        return float(self.energy_curve[min(len(self.energy_curve) - 1, int(ts * self.fps))])


def music(video, preset_name='SWAM-Performance', seconds=None, wav=True):
    import perform_render as PR
    ctx = DanceContext(video, seconds)
    preset = json.load(open(os.path.join(_ROPE, 'data', 'presets', f'{preset_name}.json')))
    preset.setdefault('chord_mappings', {})['library'] = dict(DANCE_CHORDS)
    preset.setdefault('drum_loop', {})['patterns'] = dict(DANCE_DRUMS)
    preset['drum_loop']['enabled'] = True
    eng, events = PR.simulate(ctx, preset)
    base = os.path.join(out_dir(video), f'{ctx.take}__{preset_name}')
    stats = PR.write_outputs(ctx, eng, events, base, wav=wav)
    print(f"{base}.wav  {stats.get('harmony_notes', 0)} harmony notes, "
          f"{stats.get('drum_hits', 0)} drum hits, bar {stats.get('bar_seconds')}s")
    return base, stats


def limbs_music(video, seconds=None, key=(0, 2, 4, 7, 9), wav=True):
    """A second sonification: four limbs, four voices, no chords at all.

    The chord mapping asks "which of seven states is this?" and then plays
    music at you. This asks nothing: each limb IS a voice, its pitch is how
    high it is, it sounds when it moves and rests when it stops. You hear
    the body's shape rather than a reading of it — and two different dances
    cannot come out the same, which a seven-state map cannot promise.

    Pentatonic, so four independent voices never grate.
    """
    import perform_render as PR
    d = np.load(os.path.join(out_dir(video), 'landmarks.npz'))
    W, t, fps = _fill_gaps(d['W']), d['t'], float(d['fps'])
    sho = (W[:, L_SH] + W[:, R_SH]) / 2
    hip = (W[:, L_HIP] + W[:, R_HIP]) / 2
    torso = np.maximum(0.05, np.linalg.norm(sho - hip, axis=1))
    voices = [(L_WR, 7, (67, 91)), (R_WR, 8, (60, 84)),      # violin, viola
              (L_AN, 0, (48, 72)), (R_AN, 5, (40, 64))]      # cello, bass
    T = len(t) if not seconds else min(len(t), int(seconds * fps))
    events, held = [], {}
    for j, (lm, ch, (lo, hi)) in enumerate(voices):
        # height above the hips, in torsos: -1 (on the floor) to +1.5 (overhead)
        h = (hip[:, 1] - W[:, lm, 1]) / torso
        v = np.linalg.norm(np.gradient(W[:, lm], axis=0), axis=1) * fps / torso
        v = _smooth(v, max(3, int(fps / 6)))
        span = max(1e-3, np.percentile(h[:T], 95) - np.percentile(h[:T], 5))
        x = _smooth(np.clip((h - np.percentile(h[:T], 5)) / span, 0, 1), max(3, int(fps / 5)))
        degrees = len(key) * 3                                # three octaves of the scale
        last_note, quiet_since, last_change = None, 0, -9.0
        # a voice moves when the limb changes level, not when it jitters:
        # at most one new note every 0.22 s, and only once the new step has
        # held for a tenth of a second
        hold = max(2, int(fps * 0.1))
        for i in range(T):
            step = int(round(x[i] * (degrees - 1)))
            if i + hold < T and any(int(round(x[i + k] * (degrees - 1))) != step
                                    for k in range(hold)):
                continue
            note = lo + 12 * (step // len(key)) + key[step % len(key)]
            note = int(max(lo, min(hi, note)))
            moving = v[i] > 0.28
            ts = float(t[i])
            if moving:
                quiet_since = i
                if last_note != note and ts - last_change >= 0.22:
                    if last_note is not None:
                        events.append((ts, [0x80 | ch, last_note, 0]))
                    vel = int(max(35, min(120, 45 + 70 * min(1.0, v[i] / 1.6))))
                    events.append((ts, [0x90 | ch, note, vel]))
                    last_note, last_change = note, ts
            elif last_note is not None and i - quiet_since > fps * 0.7:
                events.append((ts, [0x80 | ch, last_note, 0]))
                last_note = None
            if i % max(1, int(fps / 12)) == 0:                # expression, ~12 Hz
                events.append((ts, [0xB0 | ch, 11, int(max(0, min(127, 30 + 97 * min(1.0, v[i] / 1.8))))]))
        if last_note is not None:
            events.append((float(t[T - 1]), [0x80 | ch, last_note, 0]))
        held[ch] = True
    events.sort(key=lambda e: e[0])
    base = os.path.join(out_dir(video),
                        f'{os.path.splitext(os.path.basename(video))[0]}__limbs')
    PR._write_midi(base + '.mid', events, [7, 8, 0, 5], float(t[0]))
    if wav:
        PR._write_wav(base + '.mid', base + '.wav', PR.SF2_DEFAULT)
    notes = [e for e in events if (e[1][0] & 0xF0) == 0x90]
    print(f'{base}.wav  {len(notes)} notes across four limbs')
    return base


# ── 4. watch it ───────────────────────────────────────────────────────

def overlay(video, base, seconds=None):
    """The dance with its skeleton, its label, and the music it made."""
    import cv2
    d = np.load(os.path.join(out_dir(video), 'landmarks.npz'))
    s = np.load(os.path.join(out_dir(video), 'signals.npz'), allow_pickle=True)
    X, fps = d['X'], float(d['fps'])
    labels, energy = s['labels'], s['energy']
    cap = cv2.VideoCapture(video)
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    tmp = os.path.join(out_dir(video), '_overlay.mp4')
    vw = cv2.VideoWriter(tmp, cv2.VideoWriter_fourcc(*'mp4v'), fps, (w, h))
    limit = int((seconds or 1e9) * fps)
    i = 0
    while i < min(len(X), limit):
        ok, frame = cap.read()
        if not ok:
            break
        p = X[i]
        if not np.isnan(p[:, 0]).all():
            pix = [(int(p[j, 0] * w), int(p[j, 1] * h)) for j in range(33)]
            for a, b in EDGES:
                cv2.line(frame, pix[a], pix[b], (90, 220, 255), 2, cv2.LINE_AA)
            for j in LIMBS + [L_SH, R_SH, L_HIP, R_HIP]:
                cv2.circle(frame, pix[j], 4, (60, 90, 240), -1, cv2.LINE_AA)
        lab = str(labels[min(len(labels) - 1, i)])
        e = float(energy[min(len(energy) - 1, i)])
        cv2.rectangle(frame, (0, h - 54), (w, h), (18, 17, 15), -1)
        cv2.putText(frame, lab, (14, h - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.8,
                    (239, 233, 223), 2, cv2.LINE_AA)
        cv2.rectangle(frame, (w - 170, h - 32), (w - 170 + int(150 * e), h - 22),
                      (79, 122, 224), -1)
        cv2.putText(frame, 'energy', (w - 170, h - 40), cv2.FONT_HERSHEY_SIMPLEX, 0.4,
                    (154, 144, 134), 1, cv2.LINE_AA)
        vw.write(frame)
        i += 1
    cap.release()
    vw.release()
    # the generated music only: whatever was playing in the room is another
    # piece of music, and two of them at once tells you nothing
    out = base + '.mp4'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-i', base + '.wav',
                    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast',
                    '-crf', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k',
                    '-shortest', '-movflags', '+faststart', out], check=True)
    os.remove(tmp)
    print(out)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('stage', choices=['track', 'signals', 'music', 'limbs', 'overlay', 'all'])
    ap.add_argument('video')
    ap.add_argument('--every', type=int, default=1)
    ap.add_argument('--preset', default='SWAM-Performance')
    ap.add_argument('--seconds', type=float, default=None)
    a = ap.parse_args()
    if a.stage in ('track', 'all'):
        track(a.video, a.every)
    if a.stage in ('signals', 'all'):
        signals(a.video)
    if a.stage in ('music', 'all'):
        base, _ = music(a.video, a.preset, a.seconds)
    if a.stage == 'limbs':
        base = limbs_music(a.video, a.seconds)
        overlay(a.video, base, a.seconds)
        return
    if a.stage == 'overlay':
        base = os.path.join(out_dir(a.video),
                            f'{os.path.splitext(os.path.basename(a.video))[0]}__{a.preset}')
    if a.stage in ('overlay', 'all'):
        overlay(a.video, base, a.seconds)


if __name__ == '__main__':
    main()

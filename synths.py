#!/usr/bin/env python3
"""Motion → simple synths, one idea per video, so you can hear what makes what.

Every idea follows one rule: **moving makes the sound, the feature colours
it**. Loudness always comes from some speed, so stillness is silence; the
Laban feature named in the title shapes the one thing it is mapped to.
Nothing here keeps time, and each idea uses one or two plain sound sources
(sines, noise, plucked strings, one FM voice, a detuned pad).

    organ    each limb's speed → the loudness of its own sine (four notes of Cmaj7)
    siren    each hand's speed → its pitch and loudness (faster = higher)
    wind     Weight → loudness and brightness of wind; hips crossing → pan
    plucks   Time: every sudden acceleration of a limb plucks that limb's string
    fm       Flow: jerkiness → harshness of one FM tone; speed → loudness
    space    Space: straight hand paths → a pure fifth, wandering ones → detuned
    breath   Shape: the body growing or shrinking → a breath; bigger = brighter
    efforts  wind + plucks + fm + space together, with stems to solo in the page

    python synths.py                  # everything
    python synths.py --ideas wind plucks --clips 10-53-11 --seconds 20
    python synths.py --serve          # the page, on :5091

Needs `motion.py` to have run. Writes `_motion/<stem>/<idea>.mp4|.wav|.json`
and `_motion/manifest.json`, which `_motion/index.html` reads.
"""
import argparse
import json
import os
import subprocess
import sys
from multiprocessing import Pool

import numpy as np
import soundfile as sf
from numba import njit
from scipy.signal import fftconvolve

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

import motion as M  # noqa: E402
from dance_pose import (EDGES, L_WR, R_WR, L_AN, R_AN, L_HIP, R_HIP)  # noqa: E402

SR = 44100
JOINT = dict(zip(M.PARTS, M.PART_J))
PART_NAME = {'head': 'head', 'lhand': 'left hand', 'rhand': 'right hand',
             'lfoot': 'left foot', 'rfoot': 'right foot'}

# colours: (BGR for the video, hex for the page)
COL = {'chord': ((255, 255, 255), '#ffffff'),'lhand': ((80, 170, 255), '#ffaa50'), 'rhand': ((255, 180, 90), '#5ab4ff'),
       'lfoot': ((120, 220, 120), '#78dc78'), 'rfoot': ((200, 120, 240), '#f078c8'),
       'weight': ((90, 110, 240), '#f06e5a'), 'time': ((80, 210, 250), '#fad250'),
       'flow': ((230, 140, 200), '#c88ce6'), 'space': ((120, 230, 200), '#c8e678'),
       'shape': ((230, 220, 120), '#78dce6'), 'travel': ((200, 200, 200), '#c8c8c8')}


# ── DSP ───────────────────────────────────────────────────────────────

@njit(cache=True)
def _onepole(x, a):
    y = np.empty_like(x)
    s = x[0]
    for i in range(len(x)):
        s += a * (x[i] - s)
        y[i] = s
    return y


def ctrl(f, x, n, tau=0.03):
    """A frame-rate control (30 Hz) → audio rate, glided so it never zips."""
    ta = np.arange(n) / SR
    y = np.interp(ta, f['t'] - f['t'][0], np.asarray(x, float))
    return _onepole(y, 1 - np.exp(-1 / (tau * SR)))


def osc(freq):
    return 2 * np.pi * np.cumsum(freq) / SR


@njit(cache=True)
def _svf(x, fc, q, sr):
    """Time-varying TPT state-variable filter → (lowpass, bandpass)."""
    lp = np.empty_like(x)
    bp = np.empty_like(x)
    ic1 = 0.0
    ic2 = 0.0
    k = 1.0 / q
    for i in range(len(x)):
        g = np.tan(np.pi * min(fc[i], 0.45 * sr) / sr)
        a1 = 1.0 / (1.0 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
        v3 = x[i] - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        lp[i] = v2
        bp[i] = v1
    return lp, bp


@njit(cache=True)
def _pluck(freq, n, bright, loss, seed):
    """Karplus–Strong: a noise burst circulating in a delay line."""
    np.random.seed(seed)
    N = max(2, int(44100 / freq))
    buf = np.random.uniform(-1, 1, N)
    for _ in range(int(3 * (1 - bright)) + 1):      # darker burst = softer pluck
        for i in range(N):
            buf[i] = 0.5 * (buf[i] + buf[i - 1])
    out = np.empty(n)
    j = 0
    for i in range(n):
        a = buf[j]
        b = buf[(j + 1) % N]
        out[i] = a
        buf[j] = loss * 0.5 * (a + b)
        j = (j + 1) % N
    return out


def saw(phase, harm=14):
    """Band-limited sawtooth (additive), bright enough, no aliasing."""
    return sum(np.sin(k * phase) / k for k in range(1, harm + 1)) * (2 / np.pi)


def pan(x, p):
    """Mono → stereo, equal-power; p in 0 (left) .. 1 (right)."""
    p = np.clip(p, 0, 1)
    return np.stack([x * np.cos(p * np.pi / 2), x * np.sin(p * np.pi / 2)], 1)


_IR = None


def reverb(y, wet=0.2):
    global _IR
    if _IR is None:
        rng = np.random.default_rng(7)
        n = int(1.6 * SR)
        env = np.exp(-np.arange(n) / (0.35 * SR))
        _IR = [np.convolve(rng.standard_normal(n) * env, np.ones(6) / 6, 'same') for _ in range(2)]
        _IR = [ir / np.sqrt((ir ** 2).sum()) for ir in _IR]
    w = np.stack([fftconvolve(y[:, c], _IR[c])[:len(y)] for c in range(2)], 1)
    return (1 - wet) * y + wet * w


def screen_x(f, part):
    return f['P'][:, JOINT[part], 0] / f['w']


# ── the ideas ─────────────────────────────────────────────────────────
# each returns (stems {name: stereo}, drivers [...], extras {...})
# a driver is what the video and the page show: a 0..1 signal with a label
# saying what it does, a colour, and optionally the joint it lives on.

def organ(f, n):
    notes = {'lfoot': 130.81, 'rfoot': 196.0, 'lhand': 329.63, 'rhand': 493.88}
    names = {'lfoot': 'C3', 'rfoot': 'G3', 'lhand': 'E4', 'rhand': 'B4'}
    out, drivers = 0, []
    for part, hz in notes.items():
        k = M.PARTS.index(part)
        s = f['n_speed'][:, k]
        amp = ctrl(f, s ** 1.3, n, 0.04)
        ph = osc(np.full(n, hz))
        tone = np.sin(ph) + 0.2 * np.sin(2 * ph) + 0.08 * np.sin(3 * ph)
        out = out + pan(0.22 * amp * tone, ctrl(f, screen_x(f, part), n, 0.1))
        drivers.append(dict(key=part, signal=s, joint=part,
                            label=f'{PART_NAME[part]} speed → {names[part]} loudness'))
    return {'organ': out}, drivers, {}


def siren(f, n):
    out, drivers = 0, []
    for part in ('lhand', 'rhand'):
        k = M.PARTS.index(part)
        s = f['n_speed'][:, k]
        hz = ctrl(f, 220 * 2 ** (2.6 * s), n, 0.06)        # 220 Hz → ~1.3 kHz
        amp = ctrl(f, np.clip(s * 1.4, 0, 1) ** 1.4, n, 0.04)
        ph = osc(hz)
        tone = np.sin(ph) - np.sin(3 * ph) / 9 + np.sin(5 * ph) / 25   # soft triangle
        out = out + pan(0.3 * amp * tone, ctrl(f, screen_x(f, part), n, 0.1))
        drivers.append(dict(key=part, signal=s, joint=part,
                            label=f'{PART_NAME[part]} speed → pitch + loudness'))
    return {'siren': out}, drivers, {}


def wind(f, n):
    W = f['n_weight']
    rng = np.random.default_rng(1)
    noise = rng.standard_normal(n)
    fc = ctrl(f, 180 * 2 ** (5.2 * W), n, 0.05)           # 180 Hz → ~6.5 kHz
    lp, bp = _svf(noise, fc, 1.2, SR)
    amp = ctrl(f, np.clip(1.3 * W, 0, 1) ** 0.9, n, 0.05)
    trav = f['n_travel']
    y = pan(0.5 * amp * (0.6 * bp + 0.4 * lp), ctrl(f, trav, n, 0.25))
    return {'wind': y}, [
        dict(key='weight', signal=W, label='Weight (strong ↔ light) → loudness + brightness'),
        dict(key='travel', signal=trav, joint='pelvis', label='hips crossing the floor → left / right'),
    ], {}


def plucks(f, n):
    notes = {'lfoot': 110.0, 'rfoot': 164.81, 'lhand': 523.25, 'rhand': 659.26}
    names = {'lfoot': 'A2', 'rfoot': 'E3', 'lhand': 'C5', 'rhand': 'E5'}
    y = np.zeros((n, 2))
    t0 = f['t'][0]
    fps = f['fps']
    L = int(2.5 * SR)
    for i, (t, part, s) in enumerate(f['events']):
        a = int((t - t0) * SR)
        if a >= n:
            continue
        note = _pluck(notes[part], L, 0.35 + 0.6 * s, 0.996, i)
        fr = min(len(f['t']) - 1, int((t - t0) * fps))
        stereo = pan(0.45 * (0.25 + 0.75 * s) * note, f['P'][fr, JOINT[part], 0] / f['w'])
        m = min(L, n - a)
        y[a:a + m] += stereo[:m]
    drivers = []
    for part in notes:
        k = M.PARTS.index(part)
        drivers.append(dict(key=part, signal=np.clip(f['accel'][:, k] / f['acc_hi'], 0, 1),
                            joint=part, label=f'{PART_NAME[part]} sudden → pluck {names[part]}'))
    return {'plucks': y}, drivers, {'events': True}


def fm(f, n):
    F = f['n_flow']
    W = f['n_weight']
    index = ctrl(f, 0.3 + 7 * F ** 1.2, n, 0.06)
    amp = ctrl(f, np.clip(W * 1.3, 0, 1) ** 1.2, n, 0.05)
    hz = 110.0
    ph_c = osc(np.full(n, hz))
    ph_m = osc(np.full(n, hz * 2))
    tone = np.sin(ph_c + index * np.sin(ph_m))
    tone2 = np.sin(1.5 * ph_c + 0.6 * index * np.sin(1.5 * ph_m))   # a fifth above
    y = pan(0.28 * amp * (tone + 0.5 * tone2), np.full(n, 0.5))
    return {'fm': y}, [
        dict(key='flow', signal=F, label='Flow (jerky ↔ smooth) → harshness'),
        dict(key='weight', signal=W, label='overall speed → loudness'),
    ], {}


def space(f, n):
    S = f['space']
    hands = np.clip(f['n_speed'][:, 1:3].mean(1) * 1.6, 0, 1)
    wander = ctrl(f, (1 - S) ** 1.3, n, 0.15)              # 0 direct … 1 indirect
    amp = ctrl(f, hands ** 1.2, n, 0.05)
    ta = np.arange(n) / SR
    out = 0
    for hz, rate, sign, p in ((220.0, 0.31, 1, 0.3), (329.63, 0.47, -1, 0.7), (440.0, 0.71, 1, 0.5)):
        cents = sign * 38 * wander * np.sin(2 * np.pi * rate * ta)
        ph = osc(hz * 2 ** (cents / 1200))
        v, _ = _svf(saw(ph, 10), np.full(n, 1800.0), 0.7, SR)
        out = out + pan(0.16 * amp * v, np.full(n, p))
    return {'space': out}, [
        dict(key='space', signal=S, joint='hands_trail',
             label='Space: straight hand paths → pure, wandering → detuned'),
        dict(key='rhand', signal=hands, label='hands speed → loudness'),
    ], {}


def breath(f, n):
    sh = f['n_shape']
    fps = f['fps']
    rate = np.gradient(M.uniform_filter1d(sh, max(3, int(0.3 * fps)))) * fps
    grow = np.clip(np.abs(rate) / np.percentile(np.abs(rate), 97), 0, 1)
    amp = ctrl(f, grow ** 1.2, n, 0.06)
    fc = ctrl(f, 200 * 2 ** (4.5 * sh), n, 0.08)           # small body dark, big bright
    ph = osc(np.full(n, 73.42))                             # D2 + D3 + A3
    src = saw(ph, 24) + 0.6 * saw(2 * ph, 12) + 0.4 * saw(3 * ph, 8)
    noise = np.random.default_rng(3).standard_normal(n) * 0.35
    lp, _ = _svf(src + noise, fc, 0.9, SR)
    y = pan(0.3 * amp * lp, np.full(n, 0.5))
    return {'breath': y}, [
        dict(key='shape', signal=grow, joint='hull', label='body growing or shrinking → loudness'),
        dict(key='travel', signal=sh, label='how much room the body takes → brightness'),
    ], {}


def efforts(f, n):
    parts = {}
    drivers = []
    for fn, gain in ((wind, 0.8), (plucks, 0.7), (fm, 0.55), (space, 0.6)):
        st, dr, _ = fn(f, n)
        for k, v in st.items():
            parts[k] = gain * v
        drivers.append(dr[0])
    drivers[1] = dict(key='time', signal=f['n_time'], label='Time (sudden ↔ sustained) → plucks')
    return parts, drivers, {'events': True, 'stems': True}


# ── ii–V–I: pose picks the chord, the four Efforts play it ────────────

def _hz(f, midi, n, tau):
    """Glide in pitch (semitones), not in Hz, so every step sounds even."""
    return 440.0 * 2 ** ((ctrl(f, midi, n, tau) - 69) / 12)


def _twofive(f, n, alt):
    import harmony as H
    held, raw, guides = H.chords(f, alt_weight=f['n_weight'] if alt else None)
    VO = np.array([H.CHORDS[c]['voices'] for c in held], float)       # (T, 4)
    BA = np.array([H.CHORDS[c]['bass'] for c in held], float)
    W, F, S = f['n_weight'], f['n_flow'], f['space']
    hands = np.clip(f['n_speed'][:, 1:3].mean(1) * 1.6, 0, 1)
    ta = np.arange(n) / SR
    stems = {}

    # pad (Space): four voices glide to the next chord by step
    wander = ctrl(f, (1 - S) ** 1.3, n, 0.15)
    amp = ctrl(f, 0.15 + 0.85 * hands ** 1.2, n, 0.06)
    pad = 0
    for v, (rate, sign, p) in enumerate(((0.31, 1, 0.25), (0.47, -1, 0.75),
                                         (0.71, 1, 0.4), (0.23, -1, 0.6))):
        cents = sign * 30 * wander * np.sin(2 * np.pi * rate * ta)
        hz = _hz(f, VO[:, v], n, 0.25) * 2 ** (cents / 1200)
        lp, _ = _svf(saw(osc(hz), 10), np.full(n, 1600.0), 0.7, SR)
        pad = pad + pan(0.2 * amp * lp, np.full(n, p))
    stems['pad'] = pad

    # bass (Flow): one FM voice on the root, harsher when jerky
    bhz = _hz(f, BA, n, 0.12)
    index = ctrl(f, 0.3 + 4 * F ** 1.2, n, 0.06)
    ph = osc(bhz)
    bamp = ctrl(f, 0.2 + 0.8 * np.clip(W * 1.3, 0, 1), n, 0.06)
    stems['bass'] = pan(0.2 * bamp * np.sin(ph + index * np.sin(ph)), np.full(n, 0.5))

    # plucks (Time): each limb plucks its own tone of the chord sounding now
    y = np.zeros((n, 2))
    t0, fps, L = f['t'][0], f['fps'], int(2.5 * SR)
    for i, (t, part, s) in enumerate(f['events']):
        a = int((t - t0) * SR)
        if a >= n:
            continue
        fr = min(len(f['t']) - 1, int((t - t0) * fps))
        midi = {'lfoot': BA[fr] + 12, 'rfoot': VO[fr, 1],
                'lhand': VO[fr, 2] + 12, 'rhand': VO[fr, 3] + 12}[part]
        note = _pluck(440 * 2 ** ((midi - 69) / 12), L, 0.35 + 0.6 * s, 0.996, i)
        st = pan(0.55 * (0.25 + 0.75 * s) * note, f['P'][fr, JOINT[part], 0] / f['w'])
        m = min(L, n - a)
        y[a:a + m] += st[:m]
    stems['plucks'] = y

    # wind (Weight), and the same wind through resonators tuned to the chord
    rng = np.random.default_rng(1)
    noise = rng.standard_normal(n)
    wamp = ctrl(f, np.clip(1.3 * W, 0, 1) ** 0.9, n, 0.05)
    trav = ctrl(f, f['n_travel'], n, 0.25)
    lp, bp = _svf(noise, ctrl(f, 180 * 2 ** (5.2 * W), n, 0.05), 1.2, SR)
    plain = 0.6 * bp + 0.4 * lp
    stems['wind'] = pan(0.5 * wamp * plain, trav)
    tuned = 0
    for v in range(4):
        for octv in (12, 24):
            _, b = _svf(noise, _hz(f, VO[:, v] + octv, n, 0.25), 60.0, SR)
            tuned = tuned + b
    tuned *= np.sqrt(np.mean(plain ** 2) / (np.mean(tuned ** 2) + 1e-12))
    stems['wind tuned'] = pan(0.5 * wamp * tuned, trav)

    drivers = [
        dict(key='weight', signal=W, label='Weight → wind (plain and tuned to the chord)'),
        dict(key='time', signal=f['n_time'], label='Time → plucks on chord tones'),
        dict(key='flow', signal=F, label='Flow → bass harshness (FM)'),
        dict(key='space', signal=S, label='Space → pad in tune / drifting'),
    ]
    return stems, drivers, {'events': True, 'chords': (held, raw, guides)}


def twofive(f, n):
    return _twofive(f, n, alt=False)


def twofive_alt(f, n):
    return _twofive(f, n, alt=True)


IDEAS = {
    'organ': (organ, 'Limb organ', 'four limbs, four sines; each speed is a loudness'),
    'siren': (siren, 'Hand sirens', 'faster hands, higher and louder'),
    'wind': (wind, 'Weight → wind', 'strong movement blows harder and brighter'),
    'plucks': (plucks, 'Time → plucks', 'every sudden limb plucks its own string'),
    'fm': (fm, 'Flow → FM', 'jerky movement is harsh, smooth movement is pure'),
    'space': (space, 'Space → tuning', 'direct paths in tune, wandering paths out of tune'),
    'breath': (breath, 'Shape → breath', 'the body opening and closing breathes'),
    'efforts': (efforts, 'Four Efforts', 'wind + plucks + FM + tuning, mixable'),
    'twofive': (twofive, 'ii–V–I from pose', 'pose picks the chord; voices glide by step'),
    'twofive_alt': (twofive_alt, 'ii–V–I, altered', 'as before; strong movement alters the V'),
}


# ── rendering ─────────────────────────────────────────────────────────

def master(stems):
    mix = sum(stems.values())
    mix = reverb(mix)
    peak = np.max(np.abs(mix)) + 1e-9
    g = 0.89 / peak
    return np.tanh(mix * g * 1.1) / np.tanh(1.1), g


def _text_layer(w, h, lines):
    """Pre-render text with PIL once (cv2's Hershey fonts are ugly)."""
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    for (x, y, text, size, rgb) in lines:
        try:
            font = ImageFont.truetype('/System/Library/Fonts/SFNS.ttf', size)   # has → and ↔
        except Exception:
            font = ImageFont.load_default()
        dr.text((x, y), text, font=font, fill=rgb + (255,))
    a = np.asarray(img).astype(np.float32)
    return a[..., [2, 1, 0]], a[..., 3:4] / 255


def render_video(video, f, idea, drivers, extras, wav, out, seconds=None):
    import cv2
    title, sub = IDEAS[idea][1], IDEAS[idea][2]
    cap = cv2.VideoCapture(video)
    w, h, fps = f['w'], f['h'], f['fps']
    T = len(f['t']) if not seconds else min(len(f['t']), int(seconds * fps))
    PAN_H = 16 + 56 * len(drivers)
    head_rgb, head_a = _text_layer(w, 74, [(16, 12, title, 28, (245, 240, 230)),
                                           (16, 46, sub, 16, (190, 185, 175))])
    rows = [(16, 8 + 56 * r, d['label'], 15, tuple(int(c) for c in
             bytes.fromhex(COL[d['key']][1][1:]))) for r, d in enumerate(drivers)]
    pan_rgb, pan_a = _text_layer(w, PAN_H, rows)
    proc = subprocess.Popen(
        ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24',
         '-s', f'{w}x{h}', '-r', f'{fps}', '-i', '-', '-i', wav,
         '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
         '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest',
         '-movflags', '+faststart', out], stdin=subprocess.PIPE)
    P, V = f['P'], f['V']
    flash = []                               # (frame, part, strength)
    if extras.get('events'):
        flash = [(int((t - f['t'][0]) * fps), part, s) for t, part, s in f['events']]
    hist = int(5 * fps)
    ch = extras.get('chords')
    badges = {}
    if ch:
        import harmony as H
        DEG_COL = {'I': (120, 220, 120), 'ii': (255, 180, 90), 'V': (80, 170, 255)}
        for c, spec in H.CHORDS.items():
            rgb = DEG_COL[H.DEGREE[c]][::-1]
            badges[c] = _text_layer(200, 74, [(0, 4, spec['symbol'], 30, rgb),
                                              (0, 44, H.DEGREE[c], 18, (200, 195, 185))])
    for i in range(T):
        ok, frame = cap.read()
        if not ok:
            break
        frame = (frame * 0.65).astype(np.uint8)
        pts = P[i].astype(int)
        for a, b in EDGES:
            cv2.line(frame, tuple(pts[a]), tuple(pts[b]), (150, 150, 150), 2, cv2.LINE_AA)
        for d in drivers:
            col = COL[d['key']][0]
            v = float(d['signal'][i])
            j = d.get('joint')
            if j in JOINT:
                p = pts[JOINT[j]]
                vel = V[i, JOINT[j]] * 0.12
                ln = np.linalg.norm(vel)
                if ln > 160:
                    vel = vel * 160 / ln
                if ln > 4:
                    cv2.arrowedLine(frame, tuple(p), tuple((p + vel).astype(int)), col, 3,
                                    cv2.LINE_AA, tipLength=0.3)
                cv2.circle(frame, tuple(p), int(5 + 26 * v), col, 2, cv2.LINE_AA)
            elif j == 'pelvis':
                p = ((P[i, L_HIP] + P[i, R_HIP]) / 2).astype(int)
                dx = int((v - 0.5) * 240)
                if abs(dx) > 6:
                    cv2.arrowedLine(frame, tuple(p), (p[0] + dx, p[1]), col, 3, cv2.LINE_AA,
                                    tipLength=0.3)
            elif j == 'hands_trail':
                for jj in (L_WR, R_WR):
                    tr = P[max(0, i - int(fps)):i + 1, jj].astype(np.int32)
                    cv2.polylines(frame, [tr], False, col, 2, cv2.LINE_AA)
            elif j == 'hull':
                hp = cv2.convexHull(pts[M.HULL_J].astype(np.int32))
                cv2.polylines(frame, [hp], True, col, 2, cv2.LINE_AA)
        for (fi, part, s) in flash:
            age = i - fi
            if 0 <= age < int(0.4 * fps):
                k = age / (0.4 * fps)
                p = pts[JOINT[part]]
                cv2.circle(frame, tuple(p), int(10 + 60 * k), COL[part][0],
                           max(1, int(6 * (1 - k) * (0.4 + s))), cv2.LINE_AA)
        if ch:
            _draw_rules(frame, f, i, ch)
        # header
        top = frame[:74].astype(np.float32) * 0.35
        frame[:74] = (top * (1 - head_a) + head_rgb * head_a).astype(np.uint8)
        if ch:
            brgb, ba = badges[ch[0][i]]
            x0 = w - 130
            reg = frame[:74, x0:x0 + 130].astype(np.float32)
            frame[:74, x0:x0 + 130] = (reg * (1 - ba[:, :130]) + brgb[:, :130] * ba[:, :130]).astype(np.uint8)
        # bottom panel: one row per driver, a 5 s trace ending now
        y0 = h - PAN_H
        bot = frame[y0:].astype(np.float32) * 0.3
        frame[y0:] = (bot * (1 - pan_a) + pan_rgb * pan_a).astype(np.uint8)
        for r, d in enumerate(drivers):
            col = COL[d['key']][0]
            s = d['signal'][max(0, i - hist):i + 1]
            yb = y0 + 56 * r + 54
            xs = np.linspace(w - 16 - (w - 32) * len(s) / hist, w - 16, len(s))
            ys = yb - 26 * np.clip(s, 0, 1)
            cv2.polylines(frame, [np.stack([xs, ys], 1).astype(np.int32)], False, col, 2,
                          cv2.LINE_AA)
        proc.stdin.write(frame.tobytes())
    cap.release()
    proc.stdin.close()
    proc.wait()


def _draw_rules(frame, f, i, ch):
    """The three pose rules as lines on the body; the one being read is lit."""
    import cv2
    import harmony as H
    held, raw, g = ch
    P, tl = f['P'][i], f['tl'][i]
    r = raw[i]
    lit = {'I': (120, 220, 120), 'ii': (255, 180, 90), 'V': (80, 170, 255)}
    dim = (110, 110, 110)
    hip = (P[L_HIP] + P[R_HIP]) / 2
    # V: the "down" line at mid-thigh
    y = int(g['down_y'][i])
    cv2.line(frame, (int(hip[0] - 1.3 * tl), y), (int(hip[0] + 1.3 * tl), y),
             lit['V'] if r == 'V' else dim, 2 if r == 'V' else 1, cv2.LINE_AA)
    # ii: past the outer feet
    m = H.SIDE_MARGIN * tl
    ax = P[[L_AN, R_AN], 0]
    for x in (ax.min() - m, ax.max() + m):
        cv2.line(frame, (int(x), int(hip[1] - 1.6 * tl)), (int(x), int(P[L_AN, 1] + 20)),
                 lit['ii'] if r == 'ii' else dim, 2 if r == 'ii' else 1, cv2.LINE_AA)
    # I: the body's own midline (perpendicular to the hips)
    u = P[L_HIP] - P[R_HIP]
    u = u / (np.linalg.norm(u) + 1e-6)
    nrm = np.array([-u[1], u[0]])
    a, b = hip - 1.6 * tl * nrm, hip + 1.2 * tl * nrm
    cv2.line(frame, tuple(a.astype(int)), tuple(b.astype(int)),
             lit['I'] if r == 'I' else dim, 2 if r == 'I' else 1, cv2.LINE_AA)


def run(job):
    stem, idea, seconds = job
    f = M.load(stem)
    f['acc_hi'] = json.load(open(os.path.join(M.OUT, 'norm.json')))['accel'][1]
    n = len(f['t']) if not seconds else min(len(f['t']), int(seconds * f['fps']))
    n = int((n / f['fps']) * SR)
    fn, _title, _sub = IDEAS[idea]
    stems, drivers, extras = fn(f, n)
    mix, g = master(stems)
    d = os.path.join(M.OUT, stem)
    wav = os.path.join(d, f'{idea}.wav')
    sf.write(wav, mix.astype(np.float32), SR, subtype='PCM_16')
    stem_files = {}
    if len(stems) == 1:
        stem_files[next(iter(stems))] = os.path.basename(wav)
    else:
        for k, v in stems.items():
            p = os.path.join(d, f"{idea}__{k.replace(' ', '_')}.wav")
            sf.write(p, np.clip(reverb(v) * g, -1, 1).astype(np.float32), SR, subtype='PCM_16')
            stem_files[k] = os.path.basename(p)
    from config import find_video
    video = find_video(stem)
    render_video(video, f, idea, drivers, extras, wav, os.path.join(d, f'{idea}.mp4'), seconds)
    step = max(1, int(round(f['fps'] / 15)))
    meta = dict(idea=idea, video=f'{idea}.mp4', stems=stem_files,
                drivers=[dict(key=x['key'], label=x['label'], color=COL[x['key']][1],
                              signal=[round(float(v), 3) for v in x['signal'][::step]])
                         for x in drivers],
                rate=f['fps'] / step, duration=float(f['t'][-1] - f['t'][0]))
    if 'chords' in extras:
        import harmony as H
        meta['chords'] = H.segments(f, extras['chords'][0])
    json.dump(meta, open(os.path.join(d, f'{idea}.json'), 'w'))
    print(f'{stem} {idea}: done')
    return stem, idea


def manifest():
    clips = []
    for stem in M.stems():
        d = os.path.join(M.OUT, stem)
        have = [i for i in IDEAS if os.path.exists(os.path.join(d, f'{i}.json'))]
        if have:
            clips.append(dict(stem=stem, ideas=have))
    ideas = [dict(id=k, title=v[1], sub=v[2], doc=v[0].__name__) for k, v in IDEAS.items()]
    json.dump(dict(clips=clips, ideas=ideas), open(os.path.join(M.OUT, 'manifest.json'), 'w'),
              indent=1)
    import shutil
    shutil.copy(os.path.join(_HERE, 'web', 'index.html'), os.path.join(M.OUT, 'index.html'))


def serve(port=5091):
    import functools
    import http.server
    import webbrowser
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=M.OUT)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), h)
    print(f'http://127.0.0.1:{port}/')
    webbrowser.open(f'http://127.0.0.1:{port}/')
    srv.serve_forever()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ideas', nargs='*', default=list(IDEAS))
    ap.add_argument('--clips', nargs='*', default=None, help='substrings of clip names')
    ap.add_argument('--seconds', type=float, default=None)
    ap.add_argument('--jobs', type=int, default=4)
    ap.add_argument('--serve', action='store_true', help='just open the page')
    a = ap.parse_args()
    if a.serve:
        manifest()
        return serve()
    stems = [s for s in M.stems() if not a.clips or any(c in s for c in a.clips)]
    jobs = [(s, i, a.seconds) for s in stems for i in a.ideas]
    if a.jobs > 1 and len(jobs) > 1:
        with Pool(a.jobs) as p:
            p.map(run, jobs)
    else:
        for j in jobs:
            run(j)
    manifest()


if __name__ == '__main__':
    main()

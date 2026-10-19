// Spectral bass: the body shapes the SPECTRUM of one sustained bass note; clear
// hand strokes step the note up or down the scale. DOM-free, audio-free: tested in Node.
//
//   body (from ../movement-dictionary/measure.js)   →  spectrum of the bass
//     hands' height (hips → overhead)                  brightness: the slope of the partials
//     hands' span (together → wide apart)              a resonant peak travelling up the partials
//     lean to her left / her right                     hollow (even partials fade) / organ (odd partials fade)
//     the spine's curve                                stretch: partials pulled sharp, bell-like
//     how fast the body moves                          roughness: partials beat and shimmer
//   a clear vertical hand stroke                       the note steps up or down the scale
//
// Loudness is held constant (the spectrum is normalised): the dancer shapes colour, not volume.

export const SP = {
  partials: 48, maxHz: 9000,
  slopeDark: 2.0, slopeBright: 0.55,    // amplitude ∝ n^-slope: about −12 dB/oct (hands low) to −3.3 dB/oct (hands up)
  heightLow: -0.1, heightHigh: 2.0,     // torsos above the hips: hands by the sides → overhead
  spanLow: 0.3, spanHigh: 2.7,          // torsos between the wrists: together → wide open
  peakLowHz: 110, peakOctaves: 5,      // the peak travels 110 Hz → 3.5 kHz
  peakGainMax: 8, peakWidthWide: 0.8, peakWidthNarrow: 0.2,   // sharpness 0 → 1: ×1 → ×9 at its centre, 0.8 → 0.2 octaves wide
  leanFull: 0.4,                        // sin(tilt) sideways for a full effect (~24°)
  fadeOdd: 0.92, fadeEven: 0.95,        // how much of the odd / even partials a full lean removes
  curveFull: 45, stretchMax: 0.0006,    // spine curve (deg) for the full stretch; f_n = f0·n·√(1 + B n²)
  energyLow: 0.8, energyHigh: 6,        // body lengths/s: still → shimmering
  // strokes
  strokeAt: 4.5,                        // body lengths/s of vertical hand speed: a clear stroke
  strokeRatio: 1.5,                     // vertical must dominate horizontal by this much
  strokeS: 0.04,                        // smoothing of the hand velocity (s)
  rearm: 0.4,                           // the hand must slow below rearm × strokeAt before the next stroke
  strokeGapS: 0.5,                      // at most one stroke (either hand) this often
  // the scale
  tonic: 38,                            // D2
  scale: [0, 2, 3, 5, 7, 9, 10],        // D dorian: works over an open-fifth accompaniment
  low: 31, high: 50,                    // G1 … D3
};

const clip = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const LWR = 15, RWR = 16;

// the five controls, each 0..1 (lean −1..1), from a measure.js frame
export function controls(f) {
  const W = f.geo.wld, hip = f.geo.hip, tw = f.geo.torsoW;
  const hs = [W[LWR], W[RWR]].filter(Boolean).map(w => (hip[1] - w[1]) / tw);     // world y points down
  const height = hs.length ? hs.reduce((a, b) => a + b) / hs.length : 0;
  const span = W[LWR] && W[RWR] ? Math.hypot(W[LWR][0] - W[RWR][0], W[LWR][1] - W[RWR][1], W[LWR][2] - W[RWR][2]) / tw : 1;
  return {
    height, span,
    bright: clip((height - SP.heightLow) / (SP.heightHigh - SP.heightLow)),
    peak: clip((span - SP.spanLow) / (SP.spanHigh - SP.spanLow)),
    lean: clip(f.vertical.left / SP.leanFull, -1, 1),
    stretch: clip(f.spine.curve / SP.curveFull),
    energy: clip((f.motion.speed - SP.energyLow) / (SP.energyHigh - SP.energyLow)),
  };
}

// ── the instrument: every pose of the Movement Dictionary is a SOURCE (0..1, 0.5 = neutral
// for the two-sided ones), every synth parameter a KNOB; one source per knob, set in the
// page. A knob follows its source and nothing else, so the instrument is predictable.
const two = x => (clip(x, -1, 1) + 1) / 2;
export const SOURCES = {
  handsUp:    ['hands up (height)',            (f, c) => c.bright],
  handsApart: ['hands apart',                  (f, c) => c.peak],
  leanSide:   ['lean: right ↔ left',           (f, c) => (c.lean + 1) / 2],
  leanFwd:    ['lean: back ↔ forward',         f => two(f.vertical.forward / SP.leanFull)],
  tilt:       ['tilt, any direction',          f => clip(f.vertical.tilt / 30)],
  spineCurl:  ['spine: arch ↔ curl',           f => two(f.spine.curl / 0.5)],
  spineCurve: ['spine curve',                  (f, c) => c.stretch],
  headPitch:  ['head: down ↔ up',              f => two(f.head.pitch / 30)],
  headYaw:    ['head: right ↔ left',           f => two(f.head.yaw / 60)],
  elbowKnee:  ['elbow to knee, same side',     f => 1 - clip((Math.min(f.pairs.LL ?? 9, f.pairs.RR ?? 9) - 0.3) / 1.0)],
  elbowKneeX: ['elbow to the opposite knee',   f => 1 - clip((Math.min(f.pairs.LR ?? 9, f.pairs.RL ?? 9) - 0.3) / 1.0)],
  reach:      ['arms reach (breath)',          f => f.arms.breath ?? 0],
  circle:     ['a hand circling (how fast)',   f => clip(Math.max(...['lhand', 'rhand'].map(k => (f.circles[k] && f.circles[k].active ? Math.abs(f.circles[k].rate) : 0))) / 2)],
  speed:      ['moving fast',                  (f, c) => c.energy],
  openMax:    ['hand open (the more open)',    (f, c, h) => h.openMax],
  openL:      ['left hand open',               (f, c, h) => h.openL],
  openR:      ['right hand open',              (f, c, h) => h.openR],
};
// [id, label, default source, value when fixed, how the 0..1 knob reads]
export const KNOBS = [
  ['volume',   'volume',             'openMax',    0.8,  v => (v < 0.02 ? 'off' : `${Math.round(-36 * (1 - v))} dB`)],
  ['bright',   'brightness',         'handsUp',    0.4,  v => `${Math.round(100 * v)}%`],
  ['peak',     'peak position',      'handsApart', 0.4,  v => `${Math.round(SP.peakLowHz * 2 ** (SP.peakOctaves * v))} Hz`],
  ['sharp',    'peak sharpness',     'leanFwd',    0.35, v => `${Math.round(100 * v)}%`],
  ['lean',     'octaves ↔ hollow',   'leanSide',   0.5,  v => (Math.abs(v - 0.5) < 0.03 ? 'neither' : v > 0.5 ? `hollow ${Math.round(200 * (v - 0.5))}%` : `octaves ${Math.round(200 * (0.5 - v))}%`)],
  ['stretch',  'stretch (bell)',     'spineCurve', 0,    v => `${Math.round(100 * v)}%`],
  ['rough',    'roughness',          'speed',      0,    v => `${Math.round(100 * v)}%`],
  ['lfoRate',  'LFO rate',           'headPitch',  0.5,  v => `${lfoHz(v).toFixed(2)} Hz`],
  ['lfoDepth', 'LFO depth',          'elbowKnee',  0,    v => `${Math.round(100 * v)}%`],
  ['pan',      'pan',                'headYaw',    0.5,  v => (Math.abs(v - 0.5) < 0.03 ? 'centre' : `${v > 0.5 ? 'left' : 'right'} ${Math.round(200 * Math.abs(v - 0.5))}%`)],
  ['sub',      'sub octave',         'fixed',      0.3,  v => `${Math.round(100 * v)}%`],
];
export const lfoHz = v => 0.25 * 2 ** (5 * v);                 // 0.25 → 8 Hz, log
export const volumeGain = v => (v < 0.02 ? 0 : 10 ** (-36 * (1 - v) / 20));   // the knob is in dB: −36 → 0
// routing: { knobId: { src, value, inv } }
export const defaultRouting = () => Object.fromEntries(KNOBS.map(([id, , src, value]) => [id, { src, value, inv: false }]));
export function knobs(f, c, hands, routing) {
  const out = {};
  for (const [id, , , fixed] of KNOBS) {
    const r = routing[id] || { src: 'fixed', value: fixed };
    let v = r.src === 'fixed' || !SOURCES[r.src] ? r.value ?? fixed : SOURCES[r.src][1](f, c, hands);
    if (r.inv && r.src !== 'fixed') v = 1 - v;
    out[id] = clip(v);
  }
  return out;
}
// knob values → the spectrum's controls (lean is two-sided: hollow > 0.5 > octaves)
export const toSpectrum = k => ({ bright: k.bright, peak: k.peak, sharp: k.sharp, lean: 2 * k.lean - 1, stretch: k.stretch, energy: k.rough });

// the spectrum of a bass note at f0 under controls c: partial frequencies and gains (unit energy)
export function spectrum(f0, c) {
  const slope = SP.slopeDark + (SP.slopeBright - SP.slopeDark) * c.bright;
  const fc = SP.peakLowHz * 2 ** (SP.peakOctaves * c.peak), B = SP.stretchMax * c.stretch * c.stretch;
  const sharp = c.sharp ?? 0.35, pg = SP.peakGainMax * sharp, pw = SP.peakWidthWide + (SP.peakWidthNarrow - SP.peakWidthWide) * sharp;
  const freqs = [], gains = [];
  for (let n = 1; n <= SP.partials; n++) {
    const fn = f0 * n * Math.sqrt(1 + B * n * n);
    let g = n ** -slope;
    g *= 1 + pg * Math.exp(-((Math.log2(fn / fc)) ** 2) / (2 * pw ** 2));
    if (n > 1) {
      if (c.lean > 0 && n % 2 === 0) g *= 1 - SP.fadeEven * c.lean;          // her left: hollow, like a clarinet
      if (c.lean < 0 && n % 2 === 1) g *= 1 + SP.fadeOdd * c.lean;           // her right: octaves, like an organ
    }
    if (fn > SP.maxHz) g = 0;
    freqs.push(fn); gains.push(g);
  }
  const e = Math.sqrt(gains.reduce((s, g) => s + g * g, 0)) || 1;
  return { freqs, gains: gains.map(g => g / e), fc };
}

// the spectral centroid (Hz) of a spectrum: one number for "how bright"
export const centroid = ({ freqs, gains }) => {
  let a = 0, b = 0; gains.forEach((g, i) => { a += freqs[i] * g * g; b += g * g; }); return b ? a / b : 0;
};

// the bass note: steps up and down the scale, inside [low, high]
export function scaleStep(m, dir) {
  for (let n = m + dir; n >= SP.low && n <= SP.high; n += dir)
    if (SP.scale.includes(((n - SP.tonic) % 12 + 12) % 12)) return n;
  return m;
}

// clear vertical hand strokes: { type: 'stroke', hand, dir } with dir +1 up, −1 down
export class Strokes {
  constructor() { this.reset(); }
  reset() { this.h = {}; this.last = -1e9; }
  update(f, t) {
    const ev = [], I = f.geo.img, s = f.geo.bodyI || f.geo.torsoI || 1;
    for (const [hand, i] of [['left', LWR], ['right', RWR]]) {
      const p = I[i]; if (!p) continue;
      const h = this.h[hand] = this.h[hand] || { prev: null, t: null, v: [0, 0], armed: true };
      if (h.prev) {
        const dt = Math.max(1e-3, t - h.t), k = 1 - Math.exp(-dt / SP.strokeS);
        h.v = [h.v[0] + k * ((p[0] - h.prev[0]) / dt / s - h.v[0]), h.v[1] + k * ((p[1] - h.prev[1]) / dt / s - h.v[1])];
        const vy = h.v[1], vx = h.v[0];
        if (h.armed && Math.abs(vy) > SP.strokeAt && Math.abs(vy) > SP.strokeRatio * Math.abs(vx) && t - this.last >= SP.strokeGapS) {
          ev.push({ type: 'stroke', hand, dir: vy < 0 ? 1 : -1, speed: Math.abs(vy) });   // image y points down
          h.armed = false; this.last = t;
        } else if (!h.armed && Math.hypot(vx, vy) < SP.rearm * SP.strokeAt) h.armed = true;
      }
      h.prev = p; h.t = t;
    }
    return ev;
  }
}

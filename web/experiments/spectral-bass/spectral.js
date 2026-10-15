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
  peakLowHz: 110, peakOctaves: 5, peakGain: 3, peakWidth: 0.45,   // the peak: 110 Hz → 3.5 kHz, ×(1+3) at its centre, width in octaves
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

// the spectrum of a bass note at f0 under controls c: partial frequencies and gains (unit energy)
export function spectrum(f0, c) {
  const slope = SP.slopeDark + (SP.slopeBright - SP.slopeDark) * c.bright;
  const fc = SP.peakLowHz * 2 ** (SP.peakOctaves * c.peak), B = SP.stretchMax * c.stretch * c.stretch;
  const freqs = [], gains = [];
  for (let n = 1; n <= SP.partials; n++) {
    const fn = f0 * n * Math.sqrt(1 + B * n * n);
    let g = n ** -slope;
    g *= 1 + SP.peakGain * Math.exp(-((Math.log2(fn / fc)) ** 2) / (2 * SP.peakWidth ** 2));
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

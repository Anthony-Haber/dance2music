// The mapping matrix: every sound parameter (a destination) reads one movement
// feature (a source) through a curve, into a range. Defaults reproduce the
// hard-wired mapping of the offline ii–V–I / six-chord demos.
//
//   s = source value (0…1);  s ← 1 − s if inverted;  c = clip(gain · s, 0, 1)^exp
//   value = lo + (hi − lo) · c            (linear destinations)
//   value = lo · (hi / lo)^c              (frequencies: equal steps in pitch)
//
// With source "none", s = 0, so the destination sits at `lo` (a constant).

export const SOURCES = [
  ['none', 'none (constant = min)'],
  ['hands', 'hand speed'], ['body', 'body speed'],
  ['weight', 'Weight (strong ↔ light)'], ['time', 'Time (sudden ↔ sustained)'],
  ['flow', 'Flow (jerky ↔ smooth)'], ['space', 'Space (direct ↔ wandering)'],
  ['energy', 'energy, integrated'], ['height', 'hands height'], ['spread', 'hands spread'],
  ['lateral', 'hands left ↔ right'], ['travel', 'hips travel'],
  ['rhythm', 'rhythm regularity'], ['tempoN', 'tempo'],
  ['bounce', 'hip bounce (probability)'], ['bounceTempoN', 'hip bounce tempo'],
  ['openL', 'left hand openness'], ['openR', 'right hand openness'], ['openMax', 'most open hand'],
  ['fingers', 'fingers raised (both hands)'],
];

// att / rel: rise and fall time constants (s) of the glide into the parameter
export const DESTS = {
  'pad.level':    { label: 'pad level', lo: 0, hi: 1, min: 0, max: 1, src: 'hands', exp: 1.2, att: 0.06, rel: 0.4 },
  'pad.bright':   { label: 'pad brightness', unit: 'Hz', lo: 1600, hi: 1600, min: 300, max: 8000, log: true, src: 'none', att: 0.1, rel: 0.1 },
  'pad.detune':   { label: 'pad detune', unit: 'cents', lo: 0, hi: 30, min: 0, max: 80, src: 'space', inv: true, exp: 1.3, att: 0.15, rel: 0.15 },
  'bass.level':   { label: 'bass level', lo: 0, hi: 1, min: 0, max: 1, src: 'weight', gain: 1.3, att: 0.06, rel: 0.4 },
  'bass.harsh':   { label: 'bass harshness (FM index)', lo: 0.3, hi: 4.3, min: 0, max: 12, src: 'flow', exp: 1.2, att: 0.06, rel: 0.06 },
  'wind.level':   { label: 'wind level', lo: 0, hi: 1, min: 0, max: 1, src: 'weight', gain: 1.3, exp: 0.9, att: 0.05, rel: 0.05 },
  'wind.bright':  { label: 'wind brightness', unit: 'Hz', lo: 180, hi: 6500, min: 80, max: 12000, log: true, src: 'weight', att: 0.05, rel: 0.05 },
  'wind.pan':     { label: 'wind pan', lo: -1, hi: 1, min: -1, max: 1, src: 'travel', att: 0.25, rel: 0.25 },
  'tuned.level':  { label: 'tuned wind level', lo: 0, hi: 1, min: 0, max: 1, src: 'weight', gain: 1.3, exp: 0.9, att: 0.05, rel: 0.05 },
  'plucks.level': { label: 'plucks level', lo: 1, hi: 1, min: 0, max: 1.5, src: 'none', att: 0.05, rel: 0.05 },
  'reverb':       { label: 'reverb (wet)', lo: 0.2, hi: 0.2, min: 0, max: 0.8, src: 'none', att: 0.3, rel: 0.3 },
  'drums.level':  { label: 'drums level', lo: 0, hi: 1, min: 0, max: 1.5, src: 'bounce', gain: 1.2, att: 0.3, rel: 1.0 },
};

const BASE = { gain: 1, exp: 1, inv: false, log: false, unit: '' };
export function defaults() {
  const m = {};
  for (const [k, d] of Object.entries(DESTS)) {
    const { src, lo, hi, gain, exp, inv } = { ...BASE, ...d };
    m[k] = { src, lo, hi, gain, exp, inv };
  }
  return m;
}

export const PRESETS = {
  'Moving = sound': {},
  'Pad floor': { 'pad.level': { lo: 0.15 }, 'bass.level': { lo: 0.2 } },
  'Agitation': {
    'pad.level': { src: 'energy', lo: 0, gain: 1.5, exp: 1 },
    'bass.level': { src: 'energy', gain: 1.5 },
    'pad.bright': { src: 'energy', lo: 700, hi: 4500 },
    'reverb': { src: 'energy', lo: 0.35, hi: 0.12 },
  },
  'Sculpt': {
    'pad.bright': { src: 'height', lo: 500, hi: 5000 },
    'pad.detune': { src: 'spread', inv: false, lo: 0, hi: 45, exp: 1.5 },
    'wind.pan': { src: 'lateral' },
    'bass.harsh': { src: 'time', gain: 1.3 },
  },
  'Hands': {
    'pad.bright': { src: 'openMax', lo: 500, hi: 5000 },
    'wind.level': { src: 'openMax', gain: 1.2 },
    'bass.harsh': { src: 'fingers', lo: 0.3, hi: 6, gain: 1 },
  },
  'Rhythm': {
    'drums.level': { src: 'rhythm', gain: 1.6 },
    'pad.level': { src: 'energy', gain: 1.4, exp: 1 },
    'wind.level': { src: 'hands', gain: 1 },
  },
};

export function applyPreset(name, custom = {}) {
  const m = defaults(), p = PRESETS[name] || custom[name] || {};
  for (const [k, o] of Object.entries(p)) if (m[k]) Object.assign(m[k], o);
  return m;
}

const clip = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// every destination's value for these features
export function evaluate(m, f) {
  const out = {};
  for (const [k, d] of Object.entries(DESTS)) {
    const q = m[k]; let s = q.src === 'none' ? 0 : (f[q.src] ?? 0);
    if (q.inv) s = 1 - s;
    const c = clip(q.gain * s) ** q.exp;
    out[k] = d.log ? Math.max(1, q.lo) * (Math.max(1, q.hi) / Math.max(1, q.lo)) ** c : q.lo + (q.hi - q.lo) * c;
  }
  return out;
}

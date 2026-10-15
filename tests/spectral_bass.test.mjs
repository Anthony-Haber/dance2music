// web/experiments/spectral-bass/spectral.js: the body → spectrum mapping and the hand strokes.
// Run: node --test tests/spectral_bass.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { Dictionary } from '../web/experiments/movement-dictionary/measure.js';
import { SP, controls, spectrum, centroid, scaleStep, Strokes } from '../web/experiments/spectral-bass/spectral.js';

// a body facing the camera, world metres (origin at the hips, y down)
const BASE = {
  0: [0, -0.68, -0.1], 7: [0.07, -0.7, 0], 8: [-0.07, -0.7, 0],
  11: [0.18, -0.5, 0], 12: [-0.18, -0.5, 0], 13: [0.22, -0.25, 0], 14: [-0.22, -0.25, 0],
  15: [0.24, 0, 0], 16: [-0.24, 0, 0], 23: [0.1, 0, 0], 24: [-0.1, 0, 0], 25: [0.1, 0.45, 0], 26: [-0.1, 0.45, 0],
};
function frameOf(P) {
  const world = [], image = [];
  for (let i = 0; i < 33; i++) { const p = P[i];
    world.push(p ? { x: p[0], y: p[1], z: p[2] } : null);
    image.push(p ? { x: 0.5 + p[0] * 0.4, y: 0.5 + p[1] * 0.4, visibility: 1 } : { x: 0, y: 0, visibility: 0 }); }
  return { world, image };
}
const with_ = (over) => ({ ...BASE, ...over });
function hold(d, P, t0, secs) { let o; for (let i = 0; i <= secs * 30; i++) { const { image, world } = frameOf(P); o = d.update(image, world, t0 + i / 30); } return o; }
const NEUTRAL = { bright: 0.3, peak: 0.3, lean: 0, stretch: 0, energy: 0 };

test('the spectrum has unit energy whatever the body does', () => {
  for (const c of [NEUTRAL, { ...NEUTRAL, bright: 1, peak: 1 }, { ...NEUTRAL, lean: 1 }, { ...NEUTRAL, lean: -1, stretch: 1 }]) {
    const e = Math.hypot(...spectrum(73.4, c).gains);
    assert.ok(Math.abs(e - 1) < 1e-9, `energy ${e}`);
  }
});

test('hands up: brighter (the centroid rises); hands apart: the peak moves up', () => {
  const d = new Dictionary();
  const down = controls(hold(d, BASE, 0, 0.5));
  const up = controls(hold(d, with_({ 13: [0.22, -0.8, 0], 14: [-0.22, -0.8, 0], 15: [0.2, -1.05, 0], 16: [-0.2, -1.05, 0] }), 1, 0.5));
  assert.ok(down.bright < 0.1 && up.bright > 0.9, `bright ${down.bright} → ${up.bright}`);
  assert.ok(centroid(spectrum(73.4, { ...NEUTRAL, bright: up.bright })) > 2 * centroid(spectrum(73.4, { ...NEUTRAL, bright: down.bright })));
  const wide = controls(hold(d, with_({ 13: [0.45, -0.5, 0], 14: [-0.45, -0.5, 0], 15: [0.72, -0.5, 0], 16: [-0.72, -0.5, 0] }), 2, 0.5));
  assert.ok(wide.peak > 0.9 && down.peak < 0.4, `peak ${down.peak} → ${wide.peak}`);
  assert.ok(spectrum(73.4, { ...NEUTRAL, peak: wide.peak }).fc > 8 * spectrum(73.4, { ...NEUTRAL, peak: down.peak }).fc);
});

test('lean left hollows (even partials fade), lean right keeps the octaves (odd fade); the fundamental stays', () => {
  const L = spectrum(73.4, { ...NEUTRAL, lean: 1 }).gains, R = spectrum(73.4, { ...NEUTRAL, lean: -1 }).gains;
  const even = g => g.filter((_, i) => (i + 1) % 2 === 0).reduce((s, x) => s + x * x, 0);
  assert.ok(even(L) < 0.02, `even energy leaning left ${even(L)}`);
  const N = spectrum(73.4, NEUTRAL).gains, oddUp = g => g.filter((_, i) => i > 0 && (i + 1) % 2 === 1).reduce((s, x) => s + x * x, 0);
  assert.ok(even(R) >= even(N) && oddUp(R) < 0.2 * oddUp(N), `leaning right: even ${even(R)} (upright ${even(N)}), odd above 1 ${oddUp(R)} (upright ${oddUp(N)})`);
  assert.ok(L[0] > 0.3 && R[0] > 0.3);
});

test('the spine curve stretches the partials sharp', () => {
  const f = spectrum(73.4, { ...NEUTRAL, stretch: 1 }).freqs;
  assert.ok(f[0] / 73.4 < 1.001 && f[19] / (73.4 * 20) > 1.1, `partial 20 ratio ${f[19] / (73.4 * 20)}`);
});

test('the note steps through D dorian and stays in range', () => {
  assert.equal(scaleStep(38, 1), 40); assert.equal(scaleStep(40, 1), 41); assert.equal(scaleStep(38, -1), 36);
  assert.equal(scaleStep(SP.high, 1), SP.high); assert.equal(scaleStep(SP.low, -1), SP.low);
});

test('a hand stroke up and then down steps once each; a sideways sweep does not', () => {
  const d = new Dictionary(), s = new Strokes();
  let t = 0; const run = (P, secs) => { const ev = []; for (let i = 0; i < secs * 30; i++) { t += 1 / 30; const { image, world } = frameOf(P(i / (secs * 30))); ev.push(...s.update(d.update(image, world, t), t)); } return ev; };
  run(() => BASE, 0.5);
  const up = run(u => with_({ 15: [0.24 + 0.1 * u, -0.9 * u, 0] }), 0.25);               // the left wrist up 0.9 m in a quarter second
  assert.deepEqual(up.map(e => [e.hand, e.dir]), [['left', 1]]);
  run(() => with_({ 15: [0.34, -0.9, 0] }), 0.6);
  const down = run(u => with_({ 15: [0.34 - 0.1 * u, -0.9 + 0.9 * u, 0] }), 0.25);
  assert.deepEqual(down.map(e => [e.hand, e.dir]), [['left', -1]]);
  run(() => BASE, 0.6);
  const side = run(u => with_({ 16: [-0.24 - 0.8 * u, -0.1 * u, 0] }), 0.25);            // a sideways sweep
  assert.equal(side.length, 0);
});

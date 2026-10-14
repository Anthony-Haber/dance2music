// web/experiments/movement-dictionary/measure.js on synthetic bodies.
// Run: node --test tests/movement_dictionary.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { Dictionary } from '../web/experiments/movement-dictionary/measure.js';

// a body facing the camera, world metres (origin at the hips, y down, z away from the camera)
const BASE = {
  0: [0, -0.68, -0.1], 7: [0.07, -0.7, 0], 8: [-0.07, -0.7, 0],
  11: [0.18, -0.5, 0], 12: [-0.18, -0.5, 0], 13: [0.22, -0.25, 0], 14: [-0.22, -0.25, 0],
  15: [0.24, 0, 0], 16: [-0.24, 0, 0], 23: [0.1, 0, 0], 24: [-0.1, 0, 0], 25: [0.1, 0.45, 0], 26: [-0.1, 0.45, 0],
};
const rotZ = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]];   // lean to her left
const rotX = (p, a) => [p[0], p[1] * Math.cos(a) - p[2] * Math.sin(a), p[2] * Math.cos(a) + p[1] * Math.sin(a)];  // lean forward
function frameOf(P, shift = [0, 0]) {
  const world = [], image = [];
  for (let i = 0; i < 33; i++) {
    const p = P[i];
    world.push(p ? { x: p[0], y: p[1], z: p[2] } : null);
    image.push(p ? { x: 0.5 + shift[0] + p[0] * 0.4, y: 0.5 + shift[1] + p[1] * 0.4, visibility: 1 } : { x: 0, y: 0, visibility: 0 });
  }
  return { world, image };
}
const map = (P, f) => Object.fromEntries(Object.entries(P).map(([k, v]) => [k, f(v, +k)]));
function hold(d, P, t0, secs, shift) { let o; for (let i = 0; i <= secs * 30; i++) { const { image, world } = frameOf(P, shift); o = d.update(image, world, t0 + i / 30); } return o; }
const rad = x => x * Math.PI / 180;

test('upright: no tilt; leaning 20° to her left reads 20° towards 90°', () => {
  const d = new Dictionary();
  assert.ok(hold(d, BASE, 0, 0.5).vertical.tilt < 1);
  const o = hold(d, map(BASE, p => rotZ(p, rad(20))), 1, 1);
  assert.ok(Math.abs(o.vertical.tilt - 20) < 1.5, `tilt ${o.vertical.tilt}`);
  assert.ok(Math.abs(o.vertical.dir - 90) < 5, `dir ${o.vertical.dir}`);
});

test('leaning forward (towards the camera) reads direction 0°', () => {
  const o = hold(new Dictionary(), map(BASE, p => rotX(p, rad(25))), 0, 1);
  assert.ok(Math.abs(o.vertical.tilt - 25) < 2, `tilt ${o.vertical.tilt}`);
  assert.ok(Math.abs(o.vertical.dir) < 6, `dir ${o.vertical.dir}`);
});

test('spine: the head curling forward over the shoulders is a positive curl', () => {
  const d = new Dictionary(); hold(d, BASE, 0, 0.5); d.calibrate();
  const curled = map(BASE, (p, i) => ([0, 7, 8].includes(i) ? [p[0], p[1] + 0.03, p[2] - 0.15] : p));
  const o = hold(d, curled, 1, 1);
  assert.ok(o.spine.curl > 0.3 && o.spine.curve > 20, `curl ${o.spine.curl} curve ${o.spine.curve}`);
});

test('head: turning the nose 45° to her left reads yaw ≈ +45 and a sharp turn', () => {
  const d = new Dictionary(); hold(d, BASE, 0, 0.5); d.calibrate();
  const earMid = [0, -0.7, 0], turn = a => map(BASE, (p, i) => {
    if (i !== 0) return p; const v = [p[0] - earMid[0], p[2] - earMid[2]];
    return [earMid[0] + v[0] * Math.cos(a) - v[1] * Math.sin(a), p[1], earMid[2] + v[0] * Math.sin(a) + v[1] * Math.cos(a)]; });
  let events = [];
  for (let i = 0; i <= 3; i++) { const { image, world } = frameOf(turn(rad(45 * i / 3)), [0, 0]); events.push(...d.update(image, world, 1 + i / 30).events); }
  const o = hold(d, turn(rad(45)), 1.3, 0.6);
  assert.ok(Math.abs(o.head.yaw - 45) < 4, `yaw ${o.head.yaw}`);
  assert.ok(events.some(e => e.type === 'turn'), 'a fast turn is an event');
});

test('elbows and knees: distances in torso lengths, contact when they meet', () => {
  const d = new Dictionary();
  const o = hold(d, BASE, 0, 0.3);
  assert.ok(Math.abs(o.pairs.LL - 0.7 / 0.5) < 0.05, `LL ${o.pairs.LL}`);
  const folded = { ...BASE, 13: [0.12, 0.35, -0.05] };
  let ev = []; for (let i = 0; i < 20; i++) { const { image, world } = frameOf(folded); ev.push(...d.update(image, world, 1 + i / 30).events); }
  assert.ok(ev.some(e => e.type === 'contact' && e.pair === 'LL'), JSON.stringify(ev));
});

test('circles: a hand circling once a second is detected with its rate, direction and quarter turns; a reversal is an event', () => {
  const d = new Dictionary(); let t = 0; const ev = [];
  const step = dir => { const a = dir * 2 * Math.PI * t, P = { ...BASE, 16: [-0.45 + 0.2 * Math.cos(a), -0.1 - 0.2 * Math.sin(a), 0] };
    const { image, world } = frameOf(P); const o = d.update(image, world, t); ev.push(...o.events); t += 1 / 30; return o; };
  let o; for (let i = 0; i < 90; i++) o = step(1);
  assert.ok(o.circles.rhand.active, 'active');
  assert.ok(Math.abs(Math.abs(o.circles.rhand.rate) - 1) < 0.2, `rate ${o.circles.rhand.rate}`);
  assert.ok(ev.filter(e => e.type === 'quarter' && e.point === 'rhand').length >= 6);
  const before = o.circles.rhand.dir;
  for (let i = 0; i < 90; i++) o = step(-1);
  assert.equal(o.circles.rhand.dir, -before);
  assert.ok(ev.some(e => e.type === 'reverse' && e.point === 'rhand'), 'reversal');
});

test('lead: the head moving before the hips is a head-led movement, with its travel time', () => {
  const d = new Dictionary(); hold(d, BASE, 0, 1);
  const ev = []; let t = 1;
  for (let i = 0; i < 30; i++) {          // head starts at once, the whole body 0.3 s later
    const s = t - 1, headDx = 0.8 * s, bodyDx = s > 0.3 ? 0.8 * (s - 0.3) : 0;
    const P = map(BASE, (p, k) => [p[0] + ([0, 7, 8].includes(k) ? headDx : 0), p[1], p[2]]);
    const { image, world } = frameOf(P, [bodyDx * 0.4, 0]);
    ev.push(...d.update(image, world, t).events); t += 1 / 30;
  }
  const lead = ev.find(e => e.type === 'lead');
  assert.ok(lead, JSON.stringify(ev));
  assert.equal(lead.lead, 'head');
  assert.ok(lead.lag > 0.15 && lead.lag < 0.5, `lag ${lead.lag}`);
});

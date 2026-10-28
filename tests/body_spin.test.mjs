// Same complete observation sequences through Python and browser implementations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BodySpin, SPIN } from '../web/experiments/movement-dictionary/spin.js';
import { Dictionary } from '../web/experiments/movement-dictionary/measure.js';
import { Sound } from '../web/experiments/movement-dictionary/sound.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const localPython = fileURLToPath(new URL('../.venv/bin/python', import.meta.url));
const python = process.env.PYTHON || (existsSync(localPython) ? localPython : 'python3');
const reference = JSON.parse(execFileSync(python,
  ['-c', "import runpy; runpy.run_path('tests/test_body_spin.py', run_name='__main__')"],
  { cwd: root, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }));

test('browser thresholds match the authoritative Python reference', () => assert.deepEqual(SPIN, reference.config));
for (const sequence of reference.cases) test(`Python spin parity: ${sequence.name}`, () => {
  const spin = new BodySpin();
  for (const [i, frame] of sequence.frames.entries()) {
    const actual = spin.update(frame.image, frame.world, frame.t);
    for (const [key, expected] of Object.entries(frame.expected)) {
      if (typeof expected === 'number') assert.ok(Math.abs(actual[key] - expected) < 1e-7,
        `${sequence.name} frame ${i} ${key}: ${actual[key]} != ${expected}`);
      else assert.equal(actual[key], expected, `${sequence.name} frame ${i} ${key}`);
    }
  }
});
test('body spin p95 stays under the 5ms processing budget', () => {
  const spin = new BodySpin(), timings = [];
  for (const frame of reference.cases[0].frames) {
    const start = performance.now(); spin.update(frame.image, frame.world, frame.t); timings.push(performance.now() - start);
  }
  const p95 = timings.sort((a, b) => a - b)[Math.floor(timings.length * 0.95)];
  console.log(`Body spin p95 ${p95.toFixed(3)} ms (budget 5 ms)`); assert.ok(p95 < 5);
});

test('Dictionary counts half turns and emits exactly one event per confirmed half', () => {
  const dict = new Dictionary(); let out, events = 0, quarters = 0;
  for (const frame of reference.cases[0].frames) {
    out = dict.update(frame.image, frame.world, frame.t, 1280, 720);
    if (out) events += out.events.filter(e => e.type === 'spin').length;
    if (out) quarters += out.events.filter(e => e.type === 'spin_quarter').length;
  }
  assert.equal(out.spin.half_turns, 2); assert.equal(events, 2);
  assert.equal(out.spin.quarter_turns, 4); assert.equal(quarters, 4);
  const header = Dictionary.csvHeader().split(','), row = Dictionary.csvRow(out).split(',');
  assert.equal(header.length, row.length);
  assert.equal(row[header.indexOf('spin_half_turns')], '2.000');
  assert.equal(row[header.indexOf('spin_quarter_turns')], '4.000');
});
test('Dictionary reports the first 90-degree turn in profile without an image swap', () => {
  const dict = new Dictionary(); let out;
  for (const frame of reference.cases[0].frames.slice(0, 31)) out = dict.update(frame.image, frame.world, frame.t);
  assert.equal(out.spin.quarter_turns, 1); assert.equal(out.spin.half_turns, 0);
  assert.equal(out.spin.hands_swapped, false); assert.equal(out.spin.legs_swapped, false);
  assert.equal(out.events.filter(e => e.type === 'spin_quarter').length, 1);
});
test('Dictionary cannot reuse stale torso points as fresh spin evidence', () => {
  const dict = new Dictionary(), frame = reference.cases[0].frames[0];
  dict.update(frame.image, frame.world, 0);
  const image = structuredClone(frame.image); image[11].visibility = 0;
  const out = dict.update(image, frame.world, 1 / 30);
  assert.equal(out.spin.tracked, false); assert.equal(out.spin.active, false);
});
test('body turn diagnostics work before a face is ever visible', () => {
  const dict = new Dictionary(), frame = structuredClone(reference.cases[0].frames[60]);
  for (const i of [0, 2, 5, 7, 8]) frame.image[i].visibility = 0;
  dict.update(frame.image, frame.world, 0);
  assert.equal(dict.bodySpin.out.tracked, true); assert.equal(dict.bodySpin.out.face_visible, false);
});
test('spin stereo uses measured phase and centers on tracking loss or another study', () => {
  const sound = Object.create(Sound.prototype), values = [];
  sound.spinPan = { pan: {} }; sound.set = (param, value) => values.push(value);
  sound.updateSpin({ active: true, phase_degrees: 90 }, { spin: true });
  sound.updateSpin({ active: true, phase_degrees: 270 }, { circles: true });
  sound.updateSpin({ active: false, phase_degrees: 90 }, { spin: true });
  sound.updateSpin({ active: true, phase_degrees: 90 }, { head: true });
  assert.deepEqual(values, [0.7, 0, 0, 0]);
});
test('Bakarji Circles keeps its original rate-integrated stereo effect', () => {
  const sound = Object.create(Sound.prototype), values = [];
  sound.spinPan = { pan: {} }; sound.set = (param, value) => values.push(value);
  sound.updateSpin({ active: false, phase_degrees: 0 }, { circles: true }, { active: true, rate: 180 });
  assert.ok(Math.abs(values[0] - 0.7 * Math.sin(Math.PI / 30)) < 1e-10);
});

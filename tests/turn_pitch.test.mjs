import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TurnPitch, TURN_PITCH } from '../web/experiments/movement-dictionary/turn-pitch.js';
import { Choir, VOICES } from '../web/experiments/movement-dictionary/harmony.js';
import { Dictionary } from '../web/experiments/movement-dictionary/measure.js';
import { Sound } from '../web/experiments/movement-dictionary/sound.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = fileURLToPath(new URL('../.venv/bin/python', import.meta.url));
const python = process.env.PYTHON || (existsSync(local) ? local : 'python3');
const reference = JSON.parse(execFileSync(python,
  ['-c', "import runpy; runpy.run_path('tests/test_turn_pitch.py', run_name='__main__')"],
  { cwd: root, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }));
const spin = (left, right = 0) => ({ tracked: true, quarter_event: true, left_quarter_turns: left, right_quarter_turns: right });
const neutral = s => ({ vertical: { tilt: 0, left: 0, forward: 0 }, head: { pitch: 0 }, spine: { curl: 0 },
  pairs: { LL: 2, RR: 2, LR: 2, RL: 2 }, spin: s });
test('turn pitch browser config agrees with the Python contract', () => assert.deepEqual(TURN_PITCH, reference.config));
for (const sequence of reference.cases) test(`Python turn pitch parity: ${sequence.name}`, () => {
  const p = new TurnPitch();
  for (const f of sequence.frames) {
    assert.deepEqual(p.update(f.spin, { enabled: f.enabled }), f.expected);
    assert.deepEqual(p.apply([50, 57, 62, 66]), f.notes);
  }
});
test('choir follows D-major tonic steps while preserving chord intervals and note labels', () => {
  const c = new Choir(), base = c.sounding();
  const tonics = ['E4', 'F♯4', 'G4', 'A4', 'B4', 'C♯5', 'D5', 'E5'];
  const offsets = [2, 4, 5, 7, 9, 11, 12, 14];
  for (let i = 0; i < tonics.length; i++) {
    const ev = c.update(neutral(spin(i + 1)), { spin: true }, i);
    assert.equal(c.describe().turn_name, tonics[i]);
    for (const n of VOICES) assert.equal(c.sounding()[n] - base[n], offsets[i]);
    assert.equal(ev.filter(e => e.type === 'transpose').length, 1);
  }
  assert.equal(c.describe().chord_name, 'E');
  assert.equal(c.update(neutral(spin(8)), { spin: true }, 8).filter(e => e.type === 'transpose').length, 0);
});
test('other studies keep their original pitch; returning to turns resumes stored pitch without replay', () => {
  const c = new Choir(), base = c.sounding();
  c.update(neutral(spin(1)), { spin: true }, 0);
  c.update(neutral(spin(2)), { head: true }, 1);
  assert.deepEqual(c.sounding(), base);
  c.update(neutral({ ...spin(2), quarter_event: false }), { spin: true }, 2);
  assert.equal(c.sounding().bass, base.bass + 2);
});
test('actual detector -> choir produces four pitch changes for one full turn', () => {
  const fixtures = JSON.parse(execFileSync(python,
    ['-c', "import runpy; runpy.run_path('tests/test_body_spin.py', run_name='__main__')"],
    { cwd: root, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }));
  const dict = new Dictionary(), choir = new Choir(); let events = 0;
  for (const f of fixtures.cases[0].frames) {
    const out = dict.update(f.image, f.world, f.t);
    if (out) events += choir.update(out, { spin: true }, f.t).filter(e => e.type === 'transpose').length;
  }
  assert.equal(events, 4); assert.equal(choir.describe().turn_name, 'A4');
  assert.deepEqual(choir.sounding(), { bass: 57, tenor: 64, alto: 69, soprano: 73 });
});
test('audio retunes all sustained choir oscillators and bass partials to the changed notes', () => {
  const choir = new Choir(), sound = Object.create(Sound.prototype), targets = new Map();
  sound.ctx = {}; sound.set = (param, frequency) => targets.set(param, frequency);
  sound.parts = [1, 2, 3].map(n => ({ n, o1: { frequency: {} }, o2: { frequency: {} } }));
  sound.voices = Object.fromEntries(['tenor', 'alto', 'soprano'].map(n => [n, { note: null, oscs: [{ frequency: {} }, { frequency: {} }] }]));
  choir.update(neutral(spin(1)), { spin: true }, 0); sound.updateChoirPitch(choir);
  const freq = midi => 440 * 2 ** ((midi - 69) / 12);
  for (const n of ['tenor', 'alto', 'soprano']) for (const osc of sound.voices[n].oscs)
    assert.equal(targets.get(osc.frequency), freq(choir.sounding()[n]));
  for (const p of sound.parts) assert.equal(targets.get(p.o1.frequency), freq(40) * p.n);
});
test('pitch controller p95 stays below the 1ms budget', () => {
  const p = new TurnPitch(), timings = [];
  for (let i = 0; i < 2000; i++) {
    const begin = performance.now(); p.update(spin(i)); p.apply([50, 57, 62, 66]); timings.push(performance.now() - begin);
  }
  const p95 = timings.sort((a, b) => a - b)[1900]; console.log(`Turn pitch p95 ${p95.toFixed(3)} ms (budget 1 ms)`);
  assert.ok(p95 < 1);
});

// web/experiments/movement-dictionary/harmony.js: the choir moves one voice at a time.
// Run: node --test tests/movement_dictionary_choir.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { Choir, triad, voiceTo, VOICES, RELATIVE, LEADING } from '../web/experiments/movement-dictionary/harmony.js';

const ALL = { vertical: true, spine: true, head: true, pairs: true, circles: true };
const frame = ({ tilt = 0, left = 0, forward = 0, LL = 1.5, RR = 1.5, LR = 1.8, RL = 1.8, pitch = 0, curl = 0 } = {}) =>
  ({ vertical: { tilt, left, forward }, pairs: { LL, RR, LR, RL }, head: { pitch }, spine: { curl } });
const pcs = v => VOICES.map(n => ((v[n] - 62) % 12 + 12) % 12);
const isChord = (v, sym) => pcs(v).every(p => triad(sym).includes(p)) && triad(sym).every(p => pcs(v).includes(p));

function run(c, f, t0, secs) {
  const moves = []; let t = t0;
  for (; t < t0 + secs; t += 1 / 30) for (const e of c.update(f, ALL, t)) if (e.type === 'move') moves.push(e);
  return { moves, t };
}

test('upright is the tonic: D F♯ A, bass on D', () => {
  const c = new Choir(); run(c, frame(), 0, 1);
  assert.ok(isChord(c.voices, 'I'), JSON.stringify(c.voices));
  assert.equal((c.voices.bass - 62 + 120) % 12, 0);
  assert.equal(c.describe().chord, 'I');
});

test('a held lean to her left goes to IV, one voice per step', () => {
  const c = new Choir(); run(c, frame(), 0, 1);
  const { moves } = run(c, frame({ tilt: 30, left: 0.5 }), 1, 3);
  assert.ok(isChord(c.voices, 'IV'), JSON.stringify(c.voices));
  assert.ok(moves.length >= 2, 'IV is two notes from I, plus the bass');
  for (let i = 1; i < moves.length; i++) assert.ok(moves[i].to !== undefined);
  // never two voices in one step: consecutive moves are at least stepS apart
  assert.equal(new Set(moves.map(m => m.voice)).size, moves.length, 'each voice moved once');
  assert.equal(c.describe().chord, 'IV');
});

test('a lean to her right goes to V; upright comes home', () => {
  const c = new Choir(); run(c, frame(), 0, 1);
  run(c, frame({ tilt: 30, left: -0.5 }), 1, 3); assert.ok(isChord(c.voices, 'V'));
  run(c, frame(), 4, 3); assert.ok(isChord(c.voices, 'I'));
});

test('elbows and knees folding on one side: the relative (I→vi), a single voice', () => {
  const c = new Choir(); run(c, frame(), 0, 1);
  const before = { ...c.voices };
  const { moves } = run(c, frame({ LL: 0.5 }), 1, 2);
  assert.ok(isChord(c.voices, 'vi'), JSON.stringify(c.voices));
  const changed = VOICES.filter(n => c.voices[n] !== before[n]).filter(n => n !== 'bass');
  assert.equal(changed.length, 1, 'one upper voice moves (the bass follows the new root)');
  assert.ok(moves.length >= 1);
});

test('a crossed pair closing: the other neighbour (I→iii); with a lean, IV→vi and V→vii°', () => {
  for (const [lean, want] of [[0, LEADING.I], [0.5, LEADING.IV], [-0.5, LEADING.V]]) {
    const c = new Choir(); run(c, frame(), 0, 1);
    run(c, frame({ tilt: lean ? 30 : 0, left: lean, LR: 0.6 }), 1, 4);
    assert.ok(isChord(c.voices, want), `${want}: ${JSON.stringify(c.voices)}`);
  }
  assert.deepEqual([RELATIVE.I, RELATIVE.IV, RELATIVE.V], ['vi', 'ii', 'iii']);
});

test('the head bends the soprano a step and lets it go; the spine bends the tenor', () => {
  const c = new Choir(); run(c, frame(), 0, 1);
  const base = c.sounding();
  run(c, frame({ pitch: 20 }), 1, 0.2); assert.ok(c.sounding().soprano > base.soprano, 'head up: soprano up');
  run(c, frame({ pitch: -20 }), 1.3, 0.2); assert.ok(c.sounding().soprano < base.soprano, 'head down: soprano down');
  run(c, frame(), 1.6, 0.2); assert.equal(c.sounding().soprano, base.soprano, 'released');
  run(c, frame({ curl: 0.4 }), 2, 0.2); assert.ok(c.sounding().tenor < base.tenor, 'curling the spine lowers the tenor');
});

test('voiceTo keeps common tones and does not cross voices', () => {
  const v = voiceTo({ bass: 50, tenor: 57, alto: 62, soprano: 66 }, 'vi');
  assert.ok(v.tenor < v.alto && v.alto < v.soprano);
  assert.ok(isChord(v, 'vi'));
});

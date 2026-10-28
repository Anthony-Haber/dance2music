import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { InstrumentController } from '../../web/live/instrument-controller.js';
import { InstrumentFrames, cameraConstraints } from '../../web/live/instrument-frame.js';
import { voiceLead, symbol } from '../../web/live/instrument-harmony.js';
import { Hands, associateHands } from '../../web/live/hands.js';

const native = JSON.parse(gunzipSync(readFileSync(new URL('./native-reference.json.gz', import.meta.url))));
const controllerTimes = [];
test('Displayed hand direction pairs reverse their intervals and restore the voicing', () => {
  // Website displayed L is controller R; displayed R is controller L.
  const pairs = [
    [['left', 'left'], ['right', 'right'], -5],
    [['left', 'right'], ['right', 'left'], -2],
    [['left', 'up'], ['left', 'down'], -3],
    [['right', 'up'], ['right', 'down'], 4],
    [['up', 'left'], ['down', 'left'], 7],
    [['up', 'right'], ['down', 'right'], 1],
    [['up', 'up'], ['down', 'down'], 12],
    [['up', 'down'], ['down', 'up'], 6],
  ];
  const offsets = { center: [0, 0], left: [-60, 0], right: [60, 0], up: [0, -60], down: [0, 60] };
  for (let root = 0; root < 12; root++) for (const [a, b, delta] of pairs) {
    for (const [forward, backward, step] of [[a, b, delta], [b, a, -delta]]) {
      const controller = new InstrumentController({}, { root, quality: 'major9' });
      let time = -0.04;
      const hold = ([displayLeft, displayRight] = ['center', 'center']) => {
        let state;
        for (let i = 0; i < 12; i++) {
          time += 0.04;
          state = controller.update({ time_s: time, torso_center: [320, 240], torso_px: 100,
            hands: [['L', 350, displayRight], ['R', 290, displayLeft]].map(([side, x, direction]) => ({
              side, wrist: [x + offsets[direction][0], 240 + offsets[direction][1]], gesture: 'None', confidence: 0,
            })) });
        }
        return state;
      };
      const original = hold(), moved = hold(forward);
      assert.equal(moved.root_midi, original.root_midi + step);
      assert.deepEqual(moved.notes, original.notes.map(note => note + step));
      hold();
      const restored = hold(backward);
      assert.equal(restored.root_midi, original.root_midi);
      assert.deepEqual(restored.notes, original.notes);
      assert.equal(restored.quality, original.quality);
    }
  }
});
function compare(actual, expected, path = '') {
  if (typeof expected === 'number') assert.ok(Math.abs(actual - expected) < 1e-7, `${path}: ${actual} != ${expected}`);
  else if (expected && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), path);
    for (const key of Object.keys(expected)) compare(actual[key], expected[key], `${path}.${key}`);
  } else if (path.endsWith('root_feedback') && /^HOLD \d+%$/.test(expected)) {
    assert.ok(Math.abs(parseInt(actual.slice(5)) - parseInt(expected.slice(5))) <= 1, path);
  } else assert.equal(actual, expected, path);
}
for (const scenario of native.cases) test(`Python parity: ${scenario.name}`, () => {
  const controller = new InstrumentController(scenario.config, scenario.initial);
  for (const [index, record] of scenario.records.entries()) {
    if (record.command) controller[{ toggle_root_mode: 'toggleRootMode' }[record.command] || record.command]();
    const start = performance.now(), actual = controller.update(record.frame);
    controllerTimes.push(performance.now() - start);
    compare(actual, record.expected, `${scenario.name}[${index}]`);
  }
});
test('Controller processing remains below the native 5ms budget', () => {
  controllerTimes.sort((a, b) => a - b);
  const p95 = controllerTimes[Math.floor(controllerTimes.length * 0.95)];
  console.log(`controller p95 ${p95.toFixed(3)} ms (${controllerTimes.length} observations)`);
  assert.ok(p95 < 5);
});
test('All 300 chords and all 90,000 native voice-leading transitions', () => {
  const hash = createHash('sha256'), times = [];
  for (const chord of native.catalogue) {
    assert.equal(symbol(chord.root, chord.quality), chord.symbol);
    assert.deepEqual(voiceLead([], chord.root, chord.quality), chord.notes);
    for (const target of native.catalogue) {
      const start = performance.now();
      const notes = voiceLead(chord.notes, target.root, target.quality);
      times.push(performance.now() - start);
      hash.update(JSON.stringify(notes) + '\n');
      assert.equal(new Set(notes.map(n => n % 12)).size, notes.length);
    }
  }
  assert.equal(hash.digest('hex'), native.transition_sha256);
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)];
  console.log(`voice-leading p95 ${p95.toFixed(3)} ms (<5 ms budget)`);
  assert.ok(p95 < 5);
});
test('Invalid timing/configuration cannot silently produce a chord', () => {
  const controller = new InstrumentController();
  const frame = { time_s: 1, hands: [], torso_center: null, torso_px: null };
  controller.update(frame);
  for (const time_s of [1, 0, NaN, Infinity]) assert.throws(() => controller.update({ ...frame, time_s }), RangeError);
  assert.throws(() => new InstrumentController({ root_mode: 'bad' }), RangeError);
  assert.throws(() => new InstrumentController({ split_torsos: 0 }), RangeError);
});
test('Raw pose loss releases body wrist immediately; hand IDs survive crossing and mirror changes', () => {
  const adapter = new InstrumentFrames(), width = 640, height = 480;
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1, presence: 1 }));
  pose[11] = { ...pose[11], x: 0.4, y: 0.3 }; pose[12] = { ...pose[12], x: 0.6, y: 0.3 };
  pose[23].y = pose[24].y = 0.7;
  pose[16].x = 0.2; pose[15].x = 0.8;
  const hands = { L: { seen: true, gesture: 'Closed_Fist', score: 1, rawG: 'None', rawScore: 0, lastSeen: 1, gestureSince: 0.7 } };
  const frame = adapter.read(pose, hands, 1, width, height);
  assert.deepEqual(frame.hands.map(h => h.side), ['L', 'R']);
  compare(frame.hands.map(h => h.wrist[0]), [512, 128]);
  assert.equal(frame.hands[0].gesture_since, 0.7);
  pose[16].visibility = 0;
  assert.deepEqual(adapter.read(pose, hands, 1.04, width, height).hands.map(h => h.side), ['R']);
  assert.deepEqual(adapter.read(null, hands, 1.08, width, height).hands, []);
  assert.equal(adapter.previous.torso_px, null);
  pose[16].visibility = Infinity;
  assert.deepEqual(adapter.read(pose, hands, 1.12, width, height).hands.map(h => h.side), ['R']);
  const joint = Object.create(Hands.prototype); joint.instrument = true;
  assert.deepEqual(joint.joints('L'), [16, 14]); assert.deepEqual(joint.joints('R'), [15, 13]);
  joint.instrument = false; assert.deepEqual(joint.joints('L'), [15, 13]);
});
test('Phone capture prefers rear camera without forcing an old device ID', () => {
  const constraints = cameraConstraints({ width: 640, height: 480, deviceId: 'old', facing: 'environment', phone: true });
  assert.equal(constraints.audio, false); assert.equal(constraints.video.frameRate.ideal, 30);
  assert.deepEqual(constraints.video.facingMode, { ideal: 'environment' });
  assert.equal(constraints.video.deviceId, undefined);
});
test('One near-mode hand cannot manufacture a two-hand quality pair; crossing follows body wrists', () => {
  const right = { candidateIndex: 0, lm: [{ px: 200, py: 100 }] };
  const left = { candidateIndex: 1, lm: [{ px: 100, py: 100 }] };
  const wrists = { L: [100, 100], R: [200, 100] };
  assert.deepEqual(associateHands([right], wrists), { R: right });
  assert.deepEqual(associateHands([right, left], wrists), { L: left, R: right });
  assert.deepEqual(associateHands([left, right], { L: [200, 100], R: [100, 100] }), { L: right, R: left });
  assert.deepEqual(associateHands([left, right], { L: null, R: null }), {});
});

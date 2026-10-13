import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../../web/live/audio.js';
import { voiceLead } from '../../web/live/instrument-harmony.js';

class Parameter {
  constructor(value = 0) { this.value = value; this.calls = []; }
  setValueAtTime(value) { assert.ok(Number.isFinite(value)); this.value = value; this.calls.push(value); }
  setTargetAtTime(value, time, tau) {
    assert.ok(Number.isFinite(value)); this.value = value; this.calls.push(value); this.tau = tau;
  }
}
class AudioNode {
  constructor() {
    this.gain = new Parameter(); this.frequency = new Parameter(); this.detune = new Parameter();
    this.pan = new Parameter(); this.Q = new Parameter();
  }
  connect(node) { return node; }
  start() {} stop() {} disconnect() {} setPeriodicWave() {}
}
function engine() {
  const engine = new Engine();
  engine.ctx = { currentTime: 1, createGain: () => new AudioNode(), createStereoPanner: () => new AudioNode(),
    createOscillator: () => new AudioNode(), createBiquadFilter: () => new AudioNode(), createPeriodicWave: () => ({}) };
  engine.pamp = new AudioNode(); engine.res = Array.from({ length: 12 }, (_, i) =>
    ({ f: new AudioNode(), level: new AudioNode(), v: Math.floor(i / 2), o: i % 2 ? 24 : 12 }));
  engine.bc = new AudioNode(); engine.bm = new AudioNode(); return engine;
}
test('Every timbre sounds six tones and releases unused voices/resonators on a triad', () => {
  for (const timbre of ['native', 'saw', 'strings', 'glass', 'organ', 'choir']) {
    const synth = engine(); synth.setTimbre(timbre, true);
    assert.equal(synth.voices.length, 6);
    const notes = voiceLead([], 0, 'dominant13');
    synth.setChord({ key: 'C13', bass: 36, voices: notes, instrument: true }, true);
    synth.voices.forEach((voice, i) => {
      assert.ok(voice.out.gain.value > 0);
      assert.equal(voice.pitch[0][0].value, 100 * (notes[i] - 69) + voice.pitch[0][1]);
    });
    synth.setChord({ key: 'C', bass: 36, voices: [48, 52, 55], instrument: true });
    assert.deepEqual(synth.voices.slice(3).map(v => v.out.gain.value), [0, 0, 0]);
    assert.ok(synth.res.filter(r => r.v >= 3).every(r => r.level.gain.value === 0));
    assert.equal(synth.voices[0].pitch[0][0].tau, 0.060);
    assert.equal(synth.voices[0].out.gain.tau, 0.030);
  }
});
test('Bass register changes are applied even when chord key and upper pitches match', () => {
  const synth = engine(); synth.setTimbre('native', true);
  synth.setChord({ key: 'C', bass: 36, voices: [48, 52, 55] }, true);
  synth.setChord({ key: 'C', bass: 48, voices: [48, 52, 55] });
  assert.equal(synth.bc.detune.value, 100 * (48 - 69));
});

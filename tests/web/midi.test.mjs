import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MidiNotes, MidiOutput } from '../../web/live/midi.js';

const state = { notes: [48, 52, 55], root_midi: 48, gain: 1 };
function fixture() {
  let now = 0; const messages = [], status = [];
  const port = { id: 'a', name: 'virtual', state: 'connected', async open() {}, async close() {},
    send: message => messages.push(message) };
  const other = { ...port, id: 'b', send: message => messages.push(['b', ...message]) };
  const access = { outputs: new Map([['a', port], ['b', other]]) };
  const output = new MidiOutput({ navigator: { requestMIDIAccess: async opts => {
    assert.deepEqual(opts, { sysex: false }); return access;
  } }, secure: true, clock: () => now, notify: message => status.push(message) });
  return { output, messages, port, other, access, status, time: t => { now = t; } };
}
async function ready() {
  const f = fixture(); await f.output.connect(); await f.output.select('a');
  f.output.configure({ enabled: true, channel: 1, kind: 'chord' }); f.messages.length = 0; return f;
}

test('exact native MIDI sequence parity', () => {
  const notes = new MidiNotes(3);
  for (const frame of JSON.parse(fs.readFileSync(new URL('./midi-reference.json', import.meta.url)))) {
    assert.deepEqual(notes.update(frame.notes, frame.gain), frame.messages);
  }
});
test('invalid frames and channels are safe', () => {
  for (const channel of [0, 17, 1.5, true]) assert.throws(() => new MidiNotes(channel));
  for (const [notes, gain] of [[[128], 1], [[true], 1], [[60.5], 1], [[60], NaN], [[60], Infinity], [null, 1]]) {
    const n = new MidiNotes(); n.update([60], 1);
    assert.deepEqual(n.update(notes, gain), [[128, 60, 0], [176, 11, 0]]);
  }
});
test('optional output: no auto-selected port or notes', async () => {
  const f = fixture(); await f.output.connect(); f.output.update(state);
  assert.equal(f.output.port, null); assert.deepEqual(f.messages, []);
});
test('identical held chords do not retrigger and expression does not restart notes', async () => {
  const f = await ready(); f.output.update(state); f.messages.length = 0;
  f.output.update(state); assert.deepEqual(f.messages, []);
  f.output.update({ ...state, gain: 0.5 }); assert.deepEqual(f.messages, [[176, 11, 64]]);
});
test('root-only keeps quality changes silent but sends register changes', async () => {
  const f = await ready(); f.output.configure({ enabled: true, channel: 16, kind: 'root' }); f.messages.length = 0;
  f.output.update(state); assert.deepEqual(f.messages, [[191, 11, 127], [159, 48, 100]]);
  f.messages.length = 0; f.output.update({ ...state, notes: [48, 51, 55] }); assert.deepEqual(f.messages, []);
  f.output.update({ ...state, root_midi: 60 }); assert.deepEqual(f.messages, [[143, 48, 0], [159, 60, 100]]);
});
test('loss and 500ms stale frame watchdog release once', async () => {
  const f = await ready(); f.output.update(state); f.messages.length = 0;
  f.time(499); f.output.watchdog(); assert.deepEqual(f.messages, []);
  f.time(500); f.output.watchdog(); assert.equal(f.messages.filter(m => m[0] === 128).length, 3);
  f.messages.length = 0; f.output.watchdog(); assert.deepEqual(f.messages, []);
  f.output.update(state); f.messages.length = 0;
  f.output.update({ ...state, gain: 0 }); assert.equal(f.messages.filter(m => m[0] === 128).length, 3);
});
test('route and channel changes release on old channel before new notes', async () => {
  const f = await ready(); f.output.update(state); f.messages.length = 0;
  f.output.configure({ enabled: true, channel: 2, kind: 'chord' });
  assert.equal(f.messages.filter(m => m[0] === 128).length, 3);
  f.messages.length = 0; f.output.update(state); assert.equal(f.messages[1][0], 145);
  f.output.configure({ enabled: false, channel: 2, kind: 'chord' }); f.messages.length = 0;
  f.output.update(state); assert.deepEqual(f.messages, []);
});
test('port changes release old output, disconnect/reconnect never auto-selects', async () => {
  const f = await ready(); f.output.update(state); f.messages.length = 0;
  await f.output.select('b'); assert.equal(f.messages.filter(m => m[0] === 128).length, 3);
  f.other.state = 'disconnected'; f.access.onstatechange(); assert.equal(f.output.port, null);
  f.other.state = 'connected'; f.access.onstatechange(); f.messages.length = 0;
  f.output.update(state); assert.deepEqual(f.messages, []);
});
test('permission/unsupported/insecure/no-port failures are diagnosed', async () => {
  for (const setup of [{ navigator: {} }, { secure: false }, { navigator: { requestMIDIAccess: async () => { throw new Error('denied'); } } }]) {
    const status = []; const output = new MidiOutput({ secure: true, notify: m => status.push(m), ...setup });
    await output.connect(); assert.equal(output.port, null); assert.equal(status.length, 1);
  }
  const f = fixture(); f.access.outputs.clear(); await f.output.connect(); assert.match(f.status.at(-1), /No MIDI outputs/);
});
test('send failures clear ownership and require manual port selection', async () => {
  const f = await ready(); let calls = 0;
  f.port.send = m => { calls++; if (calls === 3) throw new Error('driver'); f.messages.push(m); };
  f.output.update(state); assert.equal(f.output.port, null); assert.equal(f.output.notes.active.size, 0);
  assert.equal(f.messages.filter(m => m[0] === 128).length, 3);
  assert.match(f.status.at(-1), /driver/);
});
test('open errors and racing port changes never send to stale port', async () => {
  const f = fixture(); await f.output.connect(); let finish;
  f.port.open = () => new Promise(resolve => { finish = resolve; });
  const first = f.output.select('a'); await f.output.select('b'); finish(); await first;
  assert.equal(f.output.port.id, 'b');
  f.port.open = async () => { throw new Error('busy'); }; await f.output.select('a');
  assert.equal(f.output.port, null); assert.match(f.status.at(-1), /busy/);
});
test('routing p95 stays below 1ms with six-note chords', () => {
  const n = new MidiNotes(), times = [];
  for (let i = 0; i < 4000; i++) {
    const t = performance.now(); n.update([48, 52, 55, 58, 62, 69].map(p => p + i % 2), 0.6);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b); const p95 = times[Math.floor(times.length * 0.95)];
  console.log('MIDI routing p95 ms:', p95); assert.ok(p95 < 1);
});

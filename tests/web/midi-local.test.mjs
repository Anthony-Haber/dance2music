import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalMidiAccess, requestLocalMidiAccess } from '../../web/live/midi-local.js';
import { MidiOutput } from '../../web/live/midi.js';

function fixture() {
  const names = ['IAC Driver ARIA_IN', 'IAC Driver ARIA_OUT'];
  const requests = [], batches = [], opened = [], closed = [], status = [];
  let failSend = false, gate = null;
  const sessions = new Map();
  const fetcher = async (url, options) => {
    assert.ok(url.startsWith('/api/midi/'));
    const action = url.split('/').at(-1), data = options.body ? JSON.parse(options.body) : null;
    requests.push({ action, data });
    assert.equal(options.credentials, 'same-origin');
    if (action !== 'ports') assert.equal(options.headers['Content-Type'], 'application/json');
    let body;
    if (action === 'ports') body = { ports: names.map(name => ({ id: name, name })) };
    if (action === 'open') {
      opened.push(data.port); const token = 'session-' + opened.length;
      sessions.set(token, { sequence: -1 }); body = { session: token };
    }
    if (action === 'send') {
      if (gate) { const waiting = gate; gate = null; await waiting; }
      if (failSend) return { ok: false, json: async () => ({ error: 'IAC disconnected' }) };
      const session = sessions.get(data.session);
      assert.ok(session); assert.equal(data.sequence, ++session.sequence);
      batches.push(data); body = { ok: true };
    }
    if (action === 'close') { closed.push(data.session); sessions.delete(data.session); body = { ok: true }; }
    return { ok: true, json: async () => body };
  };
  const localMidi = () => requestLocalMidiAccess({ location: { hostname: '127.0.0.1' }, fetcher });
  const output = new MidiOutput({ navigator: {}, secure: true, localMidi, notify: message => status.push(message) });
  return { output, localMidi, fetcher, names, requests, batches, opened, closed, status,
    fail: () => { failSend = true; }, block: promise => { gate = promise; } };
}
const state = { notes: [48, 52, 55], root_midi: 48, gain: 0.5 };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function ready() {
  const f = fixture(); await f.output.connect(); await f.output.select(f.names[0]);
  f.output.configure({ enabled: true, channel: 1, kind: 'chord' });
  await f.output.port.queue; f.batches.length = 0; return f;
}

test('Safari connects to actual server port names without selecting or sending', async () => {
  const f = fixture(); assert.deepEqual(f.requests, []);
  await f.output.connect();
  assert.deepEqual(f.output.ports().map(port => port.name), f.names);
  assert.equal(f.output.port, null); assert.deepEqual(f.opened, []);
  assert.match(f.status.at(-1), /IAC output port/);
  f.names.push('IAC Driver Anthony'); await f.output.connect();
  assert.deepEqual(f.output.ports().map(port => port.name), f.names);
});
test('Safari sends one ordered batch per chord and holds common notes/expression', async () => {
  const f = await ready(), port = f.output.port;
  f.output.update(state); await port.queue;
  assert.deepEqual(f.batches.at(-1).messages, [[176, 11, 64], [144, 48, 64], [144, 52, 64], [144, 55, 64]]);
  const count = f.batches.length;
  f.output.update(state); await port.queue; assert.equal(f.batches.length, count);
  f.output.update({ ...state, notes: [48, 51, 55], gain: 1 }); await port.queue;
  assert.deepEqual(f.batches.at(-1).messages, [
    [128,48,0], [128,52,0], [128,55,0], [176,11,127], [144,48,127], [144,51,127], [144,55,127],
  ]);
  f.output.silence(true); await port.queue;
  assert.deepEqual(f.batches.at(-1).messages, [[128, 48, 0], [128, 51, 0], [128, 55, 0], [176, 11, 0], [176, 64, 0], [176, 123, 0]]);
  await port.close(); assert.equal(f.closed.length, 1);
});
test('root/channel changes and tracking loss preserve the existing message contract', async () => {
  const f = await ready(), port = f.output.port;
  f.output.configure({ enabled: true, channel: 16, kind: 'root' }); await port.queue;
  f.output.update(state); await port.queue;
  assert.deepEqual(f.batches.at(-1).messages, [[191, 11, 64], [159, 48, 64]]);
  f.output.update({ ...state, root_midi: 60 }); await port.queue;
  assert.deepEqual(f.batches.at(-1).messages, [[143, 48, 0], [159, 60, 64]]);
  f.output.update({ ...state, gain: 0 }); await port.queue;
  assert.deepEqual(f.batches.at(-1).messages, [[143, 60, 0], [191, 11, 0]]);
  await port.close();
});
test('pending local deliveries stay ordered without replaying a closed selection', async () => {
  const f = await ready(), port = f.output.port;
  let finish; f.block(new Promise(resolve => { finish = resolve; }));
  f.output.update(state); await tick();
  f.output.update({ ...state, notes: [60, 64, 67] });
  const changing = f.output.select(f.names[1]);
  finish(); await changing;
  assert.equal(f.closed.length, 1);
  assert.equal(f.output.port.name, f.names[1]);
  assert.ok(!f.batches.some(batch => batch.messages.some(m => m[0] === 144 && m[1] === 60)));
  await f.output.port.close();
});
test('async native failures clear browser ownership and require explicit re-selection', async () => {
  const f = await ready(), port = f.output.port;
  f.fail(); f.output.update(state); await port.queue.catch(() => {}); await tick();
  assert.equal(f.output.port, null); assert.equal(f.output.notes.active.size, 0);
  assert.equal(f.closed.length, 1); assert.match(f.status.at(-1), /IAC disconnected/);
  const count = f.requests.length; f.output.update(state); assert.equal(f.requests.length, count);
});
test('refresh removes disconnected IAC destinations without automatic reconnect', async () => {
  const f = await ready(); f.names.shift(); await f.output.connect();
  assert.equal(f.output.port, null); assert.equal(f.closed.length, 1);
  assert.deepEqual(f.output.ports().map(port => port.name), f.names);
});
test('heartbeat maintains an unchanged held chord and stops when the port closes', async () => {
  const f = await ready(), port = f.output.port;
  await new Promise(resolve => setTimeout(resolve, 230)); await port.queue;
  assert.ok(f.batches.some(batch => batch.messages.length === 0));
  await port.close(); const count = f.requests.length;
  await new Promise(resolve => setTimeout(resolve, 220)); assert.equal(f.requests.length, count);
});
test('heartbeat failure reports disconnect and closes the native session', async () => {
  const f = await ready(); f.fail();
  await new Promise(resolve => setTimeout(resolve, 230)); await tick();
  assert.equal(f.output.port, null); assert.equal(f.closed.length, 1);
  assert.match(f.status.at(-1), /IAC disconnected/);
});
test('static/remote pages and unavailable local servers explain the supported launch', async () => {
  await assert.rejects(requestLocalMidiAccess({ location: { hostname: 'example.com' }, fetcher: () => assert.fail() }), /local instrument server/);
  const access = new LocalMidiAccess(async () => ({ ok: false, json: async () => { throw new Error('HTML 404'); } }));
  await assert.rejects(access.refresh(), /python live.py/);
});
test('native Web MIDI remains preferred and permission denial never invokes a bridge', async () => {
  const output = new MidiOutput({ secure: true, navigator: { requestMIDIAccess: async () => { throw new Error('denied'); } }, localMidi: () => assert.fail('permission bypass') });
  await output.connect(); assert.equal(output.access, null);
});

import { Watches } from '../web/live/watches.js';
import { mockDevice } from './watches.test.js';

const assert = (ok, message) => { if (!ok) throw Error(message); };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const four = () => Array.from({ length: 4 }, (_, id) => mockDevice(String(id), id < 2 ? '00' : '01', id % 2));

function fixture(allowed, options = {}) {
  let id = 0, prompts = 0, clock = 0;
  const timers = new Map();
  const bluetooth = { getDevices: async () => allowed, requestDevice: async () => { prompts++; throw Error('Unexpected chooser'); } };
  const watches = new Watches({ secure: true, bluetooth, now: () => clock,
    schedule: (fn, ms) => { timers.set(++id, { fn, ms }); return id; }, cancel: id => timers.delete(id), ...options });
  return { watches, timers, bluetooth, get prompts() { return prompts; },
    async next() {
      const [id, { fn, ms }] = timers.entries().next().value;
      timers.delete(id); clock += ms; fn(); await settle(); return ms;
    } };
}

export async function autoConnectTests() {
  const passed = [];
  {
    const devices = four(), unrelated = mockDevice('keyboard', '00', 0), otherPair = mockDevice('other', '99', 0);
    unrelated.name = 'Magic Keyboard';
    const f = fixture([...devices, devices[0], unrelated, otherPair]), w = f.watches;
    const samples = []; w.onSample = sample => samples.push(sample.device_id);
    await w.setAutoConnect(true);
    assert(w.activeCount === 4 && f.prompts === 0, 'restore all four without a chooser');
    assert(!unrelated.attempts && !otherPair.attempts, 'ignore unrelated and unassigned approved devices');
    devices.forEach(d => d.emit());
    assert(samples.join() === '0,1,2,3', 'restored notification routing retains all four limb IDs');
    devices[2].gatt.disconnect();
    await Promise.all([w.restoreAuthorized(), w.restoreAuthorized()]);
    assert(f.timers.size === 1 && devices[2].attempts === 1, 'focus/restore does not duplicate retry attempts');
    assert(await f.next() === 2000 && w.activeCount === 4, 'dropped watch reconnects automatically');
    assert(devices[2].discoveries === 2 && devices[2].writes.length === 2, 'automatic retry rediscovers and resynchronizes');
    devices[2].emit();
    assert(samples.length === 5 && samples.at(-1) === 2, 'reconnect has one notification handler');
    assert(w.devices.get('2').intervals.length === 2 && w.devices.get('2').intervals[0].end_ms !== null, 'automatic reconnect retains the gap');
    w.disconnect('0'); await w.restoreAuthorized();
    assert(f.timers.size === 0 && !devices[0].gatt.connected, 'manual Disconnect remains paused');
    await w.reconnect('0'); assert(devices[0].gatt.connected, 'Reconnect resumes manually paused watch');
    devices[1].gatt.disconnect(); await w.setAutoConnect(false);
    assert(f.timers.size === 0 && devices[0].gatt.connected, 'turning off cancels retries and retains healthy connections');
    devices[3].gatt.disconnect(); assert(f.timers.size === 0, 'automatic off prevents future retries');
    w.dispose(); assert(!devices.some(d => d.gatt.connected), 'dispose releases every device');
    passed.push('four authorized watches, filtering, no chooser, drop recovery, time sync, notification ownership, manual pause and automatic off');
  }
  {
    const d = four()[0]; d.failConnect = new DOMException('Out of range', 'NetworkError');
    const f = fixture([d]), w = f.watches; await w.setAutoConnect(true);
    for (const expected of [2000, 4000, 8000, 16000, 30000, 30000]) assert(await f.next() === expected, 'bounded exponential retry');
    d.failConnect = null; await f.next();
    assert(d.gatt.connected && f.timers.size === 0 && w.devices.get('0').failures === 0, 'returning watch stops backoff');
    d.gatt.disconnect(); assert(await f.next() === 2000, 'new interruption resets retry delay');
    w.dispose(); passed.push('out-of-range recovery and capped retry backoff');
  }
  {
    const devices = four().slice(0, 2), f = fixture([]), w = f.watches;
    await w.setAutoConnect(true);
    for (const d of devices) {
      d.failConnect = new DOMException('Out of range', 'NetworkError');
      f.bluetooth.requestDevice = async () => d;
      await w.connect().then(() => { throw Error('Expected manual connection failure'); }, () => {});
      assert(w.error === 'Out of range', 'manual failure is visible while waiting for recovery');
    }
    devices[0].failConnect = null; await f.next();
    assert(devices[0].gatt.connected && w.error === 'Out of range', 'another watch recovering cannot clear the same error text for a failed watch');
    devices[1].failConnect = null; await f.next();
    assert(w.activeCount === 2 && !w.error && [...w.devices.values()].every(d => !d.error), 'automatic recovery clears the corresponding manual connection error');
    w.dispose(); passed.push('manual connection failures clear only when the corresponding watch recovers');
  }
  {
    const d = four()[0], f = fixture([]), w = f.watches;
    await w.setAutoConnect(true);
    d.failConnect = new DOMException('Out of range', 'NetworkError');
    f.bluetooth.requestDevice = async () => d;
    await w.connect().catch(() => {});
    f.bluetooth.requestDevice = async () => { throw new DOMException('No device selected', 'NotFoundError'); };
    await w.connect().catch(() => {});
    const chooserError = w.error;
    assert(chooserError.includes('No watch selected'), 'new chooser error is visible');
    d.failConnect = null; await f.next();
    assert(d.gatt.connected && w.error === chooserError, 'automatic recovery preserves an unrelated chooser error');
    w.dispose(); passed.push('automatic recovery preserves unrelated chooser errors');
  }
  {
    const a = four()[0], duplicate = mockDevice('ambiguous', '00', 0), right = four()[1];
    const f = fixture([a, duplicate, right]), w = f.watches; await w.setAutoConnect(true);
    assert(!a.attempts && !duplicate.attempts && right.gatt.connected && w.autoMessage.includes('Multiple'), 'ambiguous limb is never chosen silently');
    f.bluetooth.requestDevice = async () => a;
    await w.connect(); assert(a.gatt.connected, 'user can resolve ambiguous slot with the chooser');
    w.dispose(); passed.push('ambiguous authorized devices require explicit selection');
  }
  {
    const allowed = deferred(), devices = four(), f = fixture(devices), w = f.watches;
    f.bluetooth.getDevices = () => allowed.promise;
    const restoring = w.setAutoConnect(true);
    await w.setAutoConnect(false); allowed.resolve(devices); await restoring;
    assert(w.activeCount === 0 && !devices.some(d => d.attempts), 'disable invalidates pending permission lookup');
    f.bluetooth.getDevices = async () => devices;
    w.setAssignments({ armsPairID: '01', legsPairID: null }); await w.setAutoConnect(true);
    assert(w.activeCount === 2 && w.devices.get('2').device_id === 0 && !devices[0].attempts, 'restoration honors remapped pair and disabled legs');
    w.dispose(); passed.push('pending permission cancellation and current pair assignments');
  }
  {
    const d = four()[0], selection = deferred(), allowed = deferred(), f = fixture([d]), w = f.watches;
    f.bluetooth.getDevices = () => allowed.promise;
    const restoring = w.setAutoConnect(true);
    f.bluetooth.requestDevice = () => selection.promise;
    const choosing = w.connect(); allowed.resolve([d]); await restoring;
    assert(w.pending === 1 && !d.attempts, 'restoration cannot take ownership of a watch during the permission chooser');
    selection.resolve(d); await choosing;
    assert(d.attempts === 1 && !w.error && w.pending === 0, 'chooser owns one connection without a duplicate-selection error');
    w.dispose(); passed.push('automatic restoration does not race the initial chooser');
  }
  {
    const d = four()[0], connection = deferred(), connect = d.gatt.connect;
    d.gatt.connect = async () => { await connection.promise; return connect(); };
    const f = fixture([d]), w = f.watches, restoring = w.setAutoConnect(true);
    await settle(); assert(w.activeCount === 1, 'pending GATT occupies a slot');
    w.disconnect(d.id); connection.resolve(); await restoring;
    assert(!d.gatt.connected && !d.discoveries && !f.timers.size, 'late GATT success is disconnected after cancel');
    w.dispose(); passed.push('manual cancellation while GATT connection is pending');
  }
  {
    const d = four()[0], signals = [];
    d.watchAdvertisements = async ({ signal }) => { signals.push(signal); };
    const f = fixture([d]), w = f.watches, restoring = w.setAutoConnect(true);
    await settle();
    assert(signals.length === 1 && !d.attempts && w.status(w.devices.get(d.id)) === 'looking for watch', 'restoration scans approved watch before GATT');
    d.dispatchEvent(new Event('advertisementreceived')); await restoring;
    assert(d.gatt.connected && signals[0].aborted && f.timers.size === 0, 'advertisement connects watch and ends scan');
    d.gatt.disconnect(); await f.next();
    assert(signals.length === 2 && f.timers.size === 1, 'drop starts fresh discovery');
    assert(await f.next() === 12000 && f.timers.size === 1 && !d.gatt.connected, 'discovery timeout retries without a chooser');
    await f.next(); await w.setAutoConnect(false); await settle();
    assert(signals.at(-1).aborted && !f.timers.size && !d.gatt.connected, 'automatic off cancels active advertisement scan');
    w.dispose(); passed.push('approved-device discovery, missing advertisements, scan cancellation');
  }
  {
    const d = four()[0]; d.failConnect = new DOMException('Permission revoked', 'SecurityError');
    const f = fixture([d]), w = f.watches; await w.setAutoConnect(true); await w.restoreAuthorized();
    assert(d.attempts === 1 && f.timers.size === 0 && w.devices.get('0').error.includes('revoked'), 'permission failure is visible without an endless retry');
    d.failConnect = null; await w.reconnect(d.id); assert(d.gatt.connected, 'explicit retry clears blocked state');
    w.dispose();
    const unsupported = fixture([]); delete unsupported.bluetooth.getDevices;
    await unsupported.watches.setAutoConnect(true);
    assert(unsupported.prompts === 0 && unsupported.watches.autoMessage.includes('After reopening the page'), 'missing getDevices explains selection after reopening without developer setup');
    unsupported.bluetooth.getDevices = async () => { throw new DOMException('Denied', 'SecurityError'); };
    await unsupported.watches.restoreAuthorized();
    assert(unsupported.watches.autoMessage.includes('Denied'), 'permission lookup failure is actionable');
    unsupported.watches.dispose();
    passed.push('revoked permissions, unsupported restoration and lookup errors');
  }
  return passed;
}

import { Watches, SERVICE, NOTIFY, TIME_SYNC, decodeWatchPacket, watchIdentity } from '../web/live/watches.js';
import { Recorder } from '../web/live/recorder.js';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const equal = (a, b, message) => assert(JSON.stringify(a) === JSON.stringify(b), message);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function rejects(fn, message) { let rejected = false; try { await fn(); } catch { rejected = true; } assert(rejected, message); }

export function packet(role = 0) {
  const view = new DataView(new ArrayBuffer(36));
  [1, 2, 3, 0, 0, 0].forEach((v, i) => view.setFloat32(i * 4, v, true));
  view.setBigUint64(24, 1730000000123n, true);
  [2, role, 9, 80].forEach((v, i) => view.setUint8(32 + i, v));
  return view;
}

export function mockDevice(id, pair, role) {
  const device = new EventTarget(); Object.assign(device, { id, name: `M5StickC-IMU-${pair}-${role ? 'R' : 'L'}`, discoveries: 0, writes: [], attempts: 0 });
  device.gatt = { connected: false, connect: async () => {
    device.attempts++; if (device.failConnect) throw device.failConnect;
    device.gatt.connected = true; return {
    getPrimaryService: async uuid => {
      assert(uuid === SERVICE, 'service UUID'); device.discoveries++;
      return { getCharacteristic: async uuid => {
        if (uuid === TIME_SYNC) return { writeValueWithResponse: async buffer => {
          if (device.failSync) throw new Error('sync unavailable');
          device.writes.push(new DataView(buffer).getBigUint64(0, true));
        } };
        assert(uuid === NOTIFY, 'notification UUID');
        device.characteristic = new EventTarget();
        device.characteristic.startNotifications = async () => { if (device.failSubscribe) throw new Error('subscription failed'); };
        return device.characteristic;
      } };
    },
  }; }, disconnect: () => { device.gatt.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')); } };
  device.emit = (value = packet(role)) => { device.characteristic.value = value; device.characteristic.dispatchEvent(new Event('characteristicvaluechanged')); };
  return device;
}

export async function watchTests(options, unpack, passed) {
  let clock = 10, selection, chooserOptions;
  const recorder = new Recorder();
  const watches = new Watches({ bluetooth: { requestDevice: async options => { chooserOptions = options; return selection; } }, secure: true,
    now: () => clock, epoch: () => 1730000000000, onSample: (sample, receipt) => recorder.watchSample(sample, receipt),
    locked: () => recorder.starting || recorder.recording });
  const devices = [0, 1, 2, 3].map(id => mockDevice(String(id), id < 2 ? '00' : '01', id % 2));
  const decoded = decodeWatchPacket(packet());
  equal([decoded.ax, decoded.ay, decoded.az, decoded.gx, decoded.gy, decoded.gz], [1, -2, 3, 0, 0, 0], 'canonical transform retains gyro zeros');
  equal([decoded.timestamp_ms, decoded.role, decoded.button_flags], ['1730000000123', 0, 9], 'reference v2 fields');
  for (const battery of [0, 255]) { const p = packet(); p.setUint8(35, battery); assert(decodeWatchPacket(p).battery === null, 'unknown battery'); }
  for (const invalid of [new DataView(new ArrayBuffer(32)), (() => { const p = packet(); p.setFloat32(0, NaN, true); return p; })(),
    (() => { const p = packet(); p.setUint8(32, 1); return p; })()]) await rejects(() => decodeWatchPacket(invalid), 'reject malformed packet');
  for (let id = 0; id < 4; id++) equal(watchIdentity(devices[id].name, watches.assignments).device_id, id, 'role/limb separation');
  // Four simultaneous connection attempts reserve separate chooser slots.
  const connections = devices.map(device => { selection = device; return watches.connect(); });
  await rejects(() => watches.connect(), 'fifth pending connection rejected');
  await Promise.all(connections);
  equal(chooserOptions, { filters: [{ namePrefix: 'M5StickC-IMU-' }], optionalServices: [SERVICE] },
    'Connect filters by watch name without requiring service UUIDs in advertisements');
  assert([...watches.devices.values()].every(d => d.connected), 'four simultaneous connections');
  devices.forEach(d => equal(String(d.writes[0]), '1730000000000', 'little endian epoch sync'));
  await rejects(() => watches.setAssignments({ armsPairID: '02', legsPairID: null }), 'connected assignments locked');
  devices[2].emit();
  assert(watches.status(watches.devices.get('2')) === 'streaming', 'independent streaming state');
  clock += 2001;
  assert(watches.status(watches.devices.get('2')).includes('no stream'), 'two second stale stream');
  devices[2].emit(packet(1));
  assert(watches.devices.get('2').error.includes('conflicts'), 'visible identity rejection');
  watches.disconnect('0'); selection = devices[0];
  await rejects(() => watches.connect(), 'duplicate device rejected');
  selection = mockDevice('duplicate-slot', '00', 0);
  await rejects(() => watches.connect(), 'occupied slot rejected');
  await watches.reconnect('0');
  equal(devices[0].discoveries, 2, 'reconnect repeats discovery'); equal(devices[0].writes.length, 2, 'reconnect repeats sync');
  for (const d of devices) watches.disconnect(d.id);
  selection = null; watches.bluetooth.requestDevice = async () => { throw new DOMException('cancelled', 'NotFoundError'); };
  await rejects(() => watches.connect(), 'chooser cancellation'); assert(watches.pending === 0, 'cancel releases reservation');
  assert(watches.discoveryHelp && watches.error.includes('list was empty'), 'empty chooser gives actionable recovery');
  devices[0].failSubscribe = true;
  await rejects(() => watches.reconnect('0'), 'failed subscription'); assert(!devices[0].gatt.connected, 'failed subscription disconnects');
  devices[0].failSubscribe = false; devices[0].failSync = true;
  await watches.reconnect('0'); assert(watches.devices.get('0').sync.at(-1).success === false, 'time sync failure retained');
  assert(new Watches({ secure: false }).supportMessage.includes('HTTPS'), 'insecure context status');
  assert(new Watches({ bluetooth: null, secure: true }).supportMessage.includes('unavailable'), 'unsupported browser status');
  let requestWasImmediate = false;
  const fallbackDevice = mockDevice('fallback', '00', 0);
  const fallback = new Watches({ secure: true, bluetooth: {
    getAvailability: async () => false,
    requestDevice: async options => { requestWasImmediate = true; chooserOptions = options; return fallbackDevice; },
  } });
  await fallback.refreshAvailability();
  assert(fallback.availabilityMessage.includes('system settings'), 'unavailable adapter explains permissions');
  const fallbackConnection = fallback.connect();
  assert(requestWasImmediate, 'Connect immediately starts the scanner within user activation');
  await fallbackConnection;
  equal(chooserOptions, { filters: [{ namePrefix: 'M5StickC-IMU-' }], optionalServices: [SERVICE] }, 'watch prefix filtering is the default');
  fallback.disconnect('fallback');
  const unrelated = mockDevice('unrelated', '01', 1); unrelated.name = 'Unrelated device';
  fallback.bluetooth.requestDevice = async () => unrelated;
  await rejects(() => fallback.connect(), 'unrelated device rejected before GATT connection');
  assert(!unrelated.gatt.connected && unrelated.discoveries === 0, 'identity validation also rejects an unrelated device returned by a faulty chooser');
  fallback.bluetooth.requestDevice = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  await rejects(() => fallback.connect(), 'permission denial');
  assert(fallback.error.includes('blocked') && fallback.discoveryHelp, 'blocked permission guidance');
  passed.push('watch v2 fixtures, identity, canonical axes, sync, four connections, conflicts, cancellation, stale and unsupported states');

  watches.now = () => performance.now();
  for (const d of devices) { if (!d.gatt.connected) await watches.reconnect(d.id); }
  // Real capture tests also export real browser media for the Python importer.
  window.watchFixtureZips = [];
  for (const [audioOnly, webm, microphone] of [[false, false, false], [false, true, true], [true, true, false]]) {
    devices.forEach(d => d.emit());
    const supported = MediaRecorder.isTypeSupported;
    const microphoneAccess = navigator.mediaDevices.getUserMedia;
    if (webm) MediaRecorder.isTypeSupported = type => !type.includes('mp4') && supported.call(MediaRecorder, type);
    if (microphone) navigator.mediaDevices.getUserMedia = async () => new MediaStream(options.engine.recordStream().getAudioTracks().map(t => t.clone()));
    try { await recorder.start({ ...options, watches, audioOnly, recordMicrophone: microphone }); }
    finally { MediaRecorder.isTypeSupported = supported; navigator.mediaDevices.getUserMedia = microphoneAccess; }
    const counts = [0, 0, 0, 0];
    for (let step = 0; step < 40; step++) {
      if (step === 10) watches.disconnect('2');
      if (step === 25) await watches.reconnect('2');
      devices.forEach((d, id) => { if (d.gatt.connected) { d.emit(); counts[id]++; } });
      await wait(20);
    }
    const stopping = recorder.stop(); devices.forEach(d => d.emit());
    const saved = await stopping, { files, manifest } = await unpack(saved);
    const rows = new TextDecoder().decode(files['imu_data.csv']).trim().split('\n');
    equal(rows.length - 1, counts.reduce((a, b) => a + b), 'capture excludes pre/post-roll notifications');
    equal(manifest.watches.devices.map(d => d.sample_count), counts, 'per-device actual counts');
    assert(rows.slice(1).every(line => Number(line.split(',')[0]) >= 0 && Number(line.split(',')[0]) <= manifest.duration_s), 'receipt-time boundaries');
    assert(manifest.watches.devices.find(d => d.device_id === 2).connection_intervals.length >= 2, 'disconnect gaps retained');
    assert(devices.every(d => d.gatt.connected), 'stop preserves all connections');
    window.watchFixtureZips.push(await (await fetch(saved.url)).blob());
  }
  // Pending microphone permission must not start IMU capture.
  const access = navigator.mediaDevices.getUserMedia; let resolveMic;
  navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { resolveMic = resolve; });
  const starting = recorder.start({ ...options, watches, recordMicrophone: true });
  devices.forEach(d => d.emit()); recorder.cancelStart();
  resolveMic(new MediaStream()); await starting;
  assert(!recorder.recording, 'pending microphone startup cancelled without capture');
  navigator.mediaDevices.getUserMedia = access;
  watches.disconnect('3');
  await recorder.start({ ...options, watches });
  devices[0].emit(); await wait(160);
  const Worker = window.Worker; window.Worker = class { constructor() { throw new Error('packaging failure'); } };
  try { await rejects(() => recorder.stop(), 'watch packaging failure'); } finally { window.Worker = Worker; }
  assert(recorder.recoveryFiles().some(f => f.name === 'imu_data.csv'), 'watch recovery CSV');
  const retried = await unpack(await recorder.retry());
  equal(retried.manifest.watches.sample_count, 1, 'partial session retry keeps only this recording');
  equal(retried.manifest.watches.device_count, 1, 'actual device count');
  devices.forEach(d => watches.disconnect(d.id));
  passed.push('watch recording boundaries, successive/partial sessions, gaps, pending microphone, recovery and checksums');
}

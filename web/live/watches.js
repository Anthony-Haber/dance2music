// T-Watch v2 capture. Receipt times always use the recorder's performance clock.
export const SERVICE = '12345678-1234-5678-1234-56789abcdef0';
export const NOTIFY = '12345678-1234-5678-1234-56789abcdef1';
export const TIME_SYNC = '12345678-1234-5678-1234-56789abcdef2';
export const LIMBS = ['Left arm', 'Right arm', 'Left leg', 'Right leg'];
export const CSV_HEADER = 'sync_time,timestamp_ms,device_id,ax,ay,az,gx,gy,gz,role,button_flags';

export function decodeWatchPacket(view) {
  if (!(view instanceof DataView) || view.byteLength !== 36) throw new Error('Expected a 36-byte v2 packet');
  if (view.getUint8(32) !== 2) throw new Error('Unsupported watch protocol version');
  const role = view.getUint8(33), battery = view.getUint8(35);
  if (role > 1) throw new Error('Invalid firmware L/R role');
  if (battery > 100 && battery !== 255) throw new Error('Invalid battery value');
  const axes = Array.from({ length: 6 }, (_, i) => view.getFloat32(i * 4, true));
  if (!axes.every(Number.isFinite)) throw new Error('Nonfinite watch sensor value');
  const [ax, ay, az, gx, gy, gz] = axes;
  return { timestamp_ms: view.getBigUint64(24, true).toString(),
    ax, ay: -ay, az, gx: -gx, gy, gz: -gz, role,
    button_flags: view.getUint8(34), battery: battery === 0 || battery === 255 ? null : battery };
}

export function watchIdentity(name, assignments) {
  // T-Watch uses the same advertised name as the reference M5 receiver.
  const match = /^M5StickC-IMU-(\d{2})-([LR])$/.exec(name || '');
  if (!match) throw new Error('Expected watch name M5StickC-IMU-<pair>-L/R');
  const pair_id = match[1], role = match[2] === 'L' ? 0 : 1;
  const base = pair_id === assignments.armsPairID ? 0 : pair_id === assignments.legsPairID ? 2 : null;
  if (base === null) throw new Error(`Pair ${pair_id} is not assigned to arms or legs`);
  return { pair_id, role, device_id: base + role, limb: LIMBS[base + role] };
}

export class Watches {
  constructor({ bluetooth = globalThis.navigator?.bluetooth, secure = globalThis.isSecureContext,
    now = () => performance.now(), epoch = () => Date.now(), onSample = () => {}, onChange = () => {},
    locked = () => false, assignments = { armsPairID: '00', legsPairID: '01' },
    schedule = (fn, ms) => setTimeout(fn, ms), cancel = timer => clearTimeout(timer) } = {}) {
    Object.assign(this, { bluetooth, secure, now, epoch, onSample, onChange, locked, schedule, cancel });
    this.devices = new Map(); this.pending = 0; this.error = ''; this.availability = null;
    this.connectionError = null;
    this.autoConnect = false; this.autoRevision = 0; this.restoring = 0; this.autoNotice = '';
    this.discoveryHelp = false; this.setAssignments(assignments);
  }
  get supportMessage() { return !this.secure ? 'Watches require HTTPS or localhost. Recording is still available.'
    : !this.bluetooth ? 'Web Bluetooth is unavailable in this browser. Recording is still available.' : ''; }
  get assignmentsLocked() { return this.locked() || this.pending > 0 || [...this.devices.values()].some(d => d.connected || d.connecting); }
  get activeCount() { return this.pending + [...this.devices.values()].filter(d => d.connected || d.connecting).length; }
  get autoMessage() {
    if (!this.autoConnect || this.supportMessage) return '';
    if (this.autoNotice) return this.autoNotice;
    if (!this.bluetooth?.getDevices) return 'Watches reconnect automatically while this page stays open. After reopening the page, select your watches again.';
    if (this.restoring) return 'Connecting previously paired watches…';
    return 'Pair each watch once. Previously paired watches connect automatically on this page.';
  }
  get availabilityMessage() { return this.availability === false
    ? 'Chrome cannot currently access Bluetooth. Check that Bluetooth is on and Chrome is allowed to use it in system settings.' : ''; }
  async refreshAvailability() {
    if (!this.bluetooth?.getAvailability) return;
    try { this.availability = await this.bluetooth.getAvailability(); }
    catch { this.availability = null; }
    this.onChange();
  }
  setAssignments(value) {
    if (this.assignmentsLocked) throw new Error('Disconnect watches and finish recording before changing pairs');
    const { armsPairID, legsPairID } = value;
    if (!/^\d{2}$/.test(armsPairID) || (legsPairID !== null && !/^\d{2}$/.test(legsPairID)) || armsPairID === legsPairID)
      throw new Error('Choose distinct two-digit pairs');
    this.autoRevision++;
    for (const d of this.devices.values()) {
      this.clearRetry(d); d.device.removeEventListener('gattserverdisconnected', d.disconnected);
    }
    this.devices.clear(); this.assignments = { armsPairID, legsPairID };
    if (this.autoConnect) void this.restoreAuthorized();
  }
  remember(device, identity) {
    if (this.devices.has(device.id)) return this.devices.get(device.id);
    if ([...this.devices.values()].some(d => d.device_id === identity.device_id)) throw new Error(`${identity.limb} slot is occupied`);
    const d = { ...identity, device, name: device.name, connected: false, connecting: false,
      lastSample: null, arrivals: [], battery: null, error: '', intervals: [], sync: [],
      paused: false, autoBlocked: false, attempt: 0, failures: 0, retryTimer: null, automaticAttempt: false,
      discovering: false, discoveryAbort: null };
    d.disconnected = () => this.detached(d);
    this.devices.set(device.id, d); device.addEventListener('gattserverdisconnected', d.disconnected);
    return d;
  }
  setAutoConnect(enabled) {
    this.autoConnect = enabled; this.autoRevision++; this.autoNotice = '';
    for (const d of this.devices.values()) {
      this.clearRetry(d);
      if (!enabled && d.connecting && d.automaticAttempt) this.cancelAttach(d);
    }
    this.onChange();
    return enabled ? this.restoreAuthorized() : Promise.resolve();
  }
  async restoreAuthorized() {
    if (!this.autoConnect || this.supportMessage || this.pending) return;
    const revision = this.autoRevision;
    this.restoring++; this.onChange();
    try {
      const allowed = this.bluetooth.getDevices ? await this.bluetooth.getDevices() : [];
      if (!this.autoConnect || revision !== this.autoRevision || this.pending) return;
      this.autoNotice = '';
      const slots = new Map();
      for (const device of allowed) {
        let identity;
        try { identity = watchIdentity(device.name, this.assignments); } catch { continue; }
        if (!slots.has(identity.device_id)) slots.set(identity.device_id, new Map());
        slots.get(identity.device_id).set(device.id, { device, identity });
      }
      for (const [id, candidates] of slots) {
        if ([...this.devices.values()].some(d => d.device_id === id)) continue;
        if (candidates.size > 1) {
          this.autoNotice = `Multiple paired watches match ${LIMBS[id]}. Use Connect watch to choose one.`;
          continue;
        }
        const { device, identity } = candidates.values().next().value;
        this.remember(device, identity);
      }
      const attempts = [];
      for (const d of this.devices.values()) {
        if (d.connected || d.connecting || d.paused || d.autoBlocked || d.retryTimer !== null) continue;
        if (this.activeCount >= 4) { this.queueRetry(d); continue; }
        attempts.push(this.attach(d, { automatic: true }));
      }
      await Promise.allSettled(attempts);
    } catch (error) {
      if (this.autoConnect && revision === this.autoRevision) this.autoNotice = `Could not restore paired watches: ${error.message}`;
    } finally { this.restoring--; this.onChange(); }
  }
  clearRetry(d) {
    if (d.retryTimer !== null) this.cancel(d.retryTimer);
    d.retryTimer = null;
  }
  queueRetry(d) {
    if (!this.autoConnect || d.paused || d.autoBlocked || d.connected || d.connecting || d.retryTimer !== null
        || this.devices.get(d.device.id) !== d) return;
    const delay = Math.min(30000, 2000 * 2 ** Math.min(4, Math.max(0, d.failures - 1)));
    d.retryTimer = this.schedule(() => {
      d.retryTimer = null;
      if (!this.autoConnect || d.paused || d.autoBlocked || d.connected || d.connecting) return;
      if (this.activeCount >= 4) { this.queueRetry(d); return; }
      void this.attach(d, { automatic: true }).catch(() => {});
    }, delay);
    this.onChange();
  }
  cancelAttach(d) {
    d.attempt++; this.clearRetry(d); d.discoveryAbort?.abort(); d.device.gatt.disconnect(); this.detached(d);
  }
  async discover(d) {
    // Restored permissions do not guarantee the device is in Chrome's current
    // adapter cache. Scan only this approved device before connecting to it.
    if (!d.device.watchAdvertisements) return;
    const controller = new AbortController();
    d.discoveryAbort = controller; d.discovering = true; this.onChange();
    let advertised, timeout;
    try {
      await new Promise((resolve, reject) => {
        advertised = resolve;
        d.device.addEventListener('advertisementreceived', advertised);
        controller.signal.addEventListener('abort', () => reject(new DOMException('Connection canceled', 'AbortError')), { once: true });
        timeout = this.schedule(() => reject(new DOMException('Watch not detected yet. Keep it on and nearby.', 'NetworkError')), 12000);
        Promise.resolve(d.device.watchAdvertisements({ signal: controller.signal })).catch(reject);
      });
    } finally {
      this.cancel(timeout); d.device.removeEventListener('advertisementreceived', advertised);
      controller.abort(); d.discoveryAbort = null; d.discovering = false;
    }
  }
  // One call/chooser per click preserves the browser's user activation.
  async connect() {
    if (this.supportMessage) throw new Error(this.supportMessage);
    if (this.activeCount >= 4)
      throw new Error('Four watches are already connected or connecting');
    this.pending++; this.error = ''; this.connectionError = null; this.onChange(); let choosing = true;
    try {
      // Match the firmware's shared name prefix. These watches advertise names
      // without service UUIDs, so keep service access in optionalServices only.
      // Do not await getAvailability here: the chooser needs this click's activation.
      const options = {
        filters: [{ namePrefix: 'M5StickC-IMU-' }],
        optionalServices: [SERVICE],
      };
      // Previously selected watches have their own Reconnect control. Keep
      // them out of subsequent choosers so the next selection fills a new slot.
      if (this.devices.size) options.exclusionFilters = [...this.devices.values()].map(d => ({ name: d.name }));
      const device = await this.bluetooth.requestDevice(options);
      const identity = watchIdentity(device.name, this.assignments);
      this.discoveryHelp = false;
      if (this.devices.has(device.id)) throw new Error('Watch already selected; use Reconnect');
      const d = this.remember(device, identity);
      this.pending--; choosing = false;
      await this.attach(d);
    } catch (error) {
      if (choosing) this.connectionError = null;
      if (choosing && error.name === 'NotFoundError') {
        this.discoveryHelp = true;
        this.error = 'No watch selected. Connect watch scans automatically. If the list was empty, check the connection help below.';
      } else if (['NotAllowedError', 'SecurityError'].includes(error.name)) {
        this.discoveryHelp = true;
        this.error = `Bluetooth access was blocked: ${error.message}. Allow Chrome to use Bluetooth in system settings and this site's permissions.`;
      } else this.error = error.message;
      throw error;
    } finally { if (choosing) this.pending--; this.onChange(); }
  }
  async reconnect(id) {
    const d = this.devices.get(id);
    if (!d || d.connected || d.connecting) return;
    if (this.activeCount >= 4)
      throw new Error('Four watches are already connected or connecting');
    d.paused = false; d.autoBlocked = false; d.failures = 0; this.clearRetry(d);
    await this.attach(d);
  }
  async attach(d, { automatic = false } = {}) {
    if (d.connected || d.connecting) return;
    this.clearRetry(d);
    const attempt = ++d.attempt;
    const check = () => {
      if (attempt !== d.attempt || this.devices.get(d.device.id) !== d) throw new DOMException('Connection canceled', 'AbortError');
    };
    d.connecting = true; d.automaticAttempt = automatic; d.error = '';
    if (!automatic) { this.error = ''; this.connectionError = null; }
    this.onChange();
    try {
      if (automatic) { await this.discover(d); check(); }
      // Re-discover every GATT object on each connection.
      const server = await d.device.gatt.connect(); check();
      d.connected = true; d.intervals.push({ start_ms: this.now(), end_ms: null });
      const service = await server.getPrimaryService(SERVICE); check();
      const sync = { at_ms: this.now(), epoch_ms: this.epoch(), success: false, error: null };
      d.sync.push(sync);
      try {
        const characteristic = await service.getCharacteristic(TIME_SYNC); check();
        const value = new DataView(new ArrayBuffer(8)); value.setBigUint64(0, BigInt(sync.epoch_ms), true);
        await characteristic.writeValueWithResponse(value.buffer); sync.success = true;
      } catch (error) { sync.error = error.message; d.error = `Time sync failed: ${error.message}`; }
      check();
      d.characteristic = await service.getCharacteristic(NOTIFY); check();
      d.notification = event => {
        const receipt = this.now();
        if (!d.connected || attempt !== d.attempt) return;
        try {
          const sample = decodeWatchPacket(event.target.value);
          if (sample.role !== d.role) throw new Error('Packet role conflicts with advertised watch identity');
          d.lastSample = receipt; d.battery = sample.battery;
          d.arrivals = d.arrivals.filter(t => receipt - t <= 2000); d.arrivals.push(receipt);
          this.onSample({ ...sample, device_id: d.device_id }, receipt);
        } catch (error) { d.error = error.message; this.onChange(); }
      };
      d.characteristic.addEventListener('characteristicvaluechanged', d.notification);
      await d.characteristic.startNotifications(); check();
      if (!d.device.gatt.connected || !d.connected) throw new Error('Watch disconnected during subscription');
      d.failures = 0;
      if (this.connectionError?.device === d) {
        if (this.error === this.connectionError.message) this.error = '';
        this.connectionError = null;
      }
    } catch (error) {
      // Only recovery of this manual failure may clear the shared status error.
      if (!automatic) this.connectionError = { device: d, message: error.message };
      if (error.name !== 'AbortError') {
        d.error = error.message; d.failures++;
        // Permission/protocol failures need a user's attention, not a retry loop.
        if (['SecurityError', 'NotAllowedError', 'NotFoundError'].includes(error.name)) d.autoBlocked = true;
      }
      d.device.gatt.disconnect(); this.detached(d); throw error;
    } finally {
      d.connecting = false; d.automaticAttempt = false; this.queueRetry(d); this.onChange();
    }
  }
  detached(d) {
    if (d.intervals.at(-1)?.end_ms === null) d.intervals.at(-1).end_ms = this.now();
    d.connected = false; d.lastSample = null; d.arrivals = [];
    d.characteristic?.removeEventListener('characteristicvaluechanged', d.notification);
    d.characteristic = null; this.queueRetry(d); this.onChange();
  }
  disconnect(id) {
    const d = this.devices.get(id);
    if (d) { d.paused = true; this.cancelAttach(d); }
  }
  dispose() {
    void this.setAutoConnect(false);
    for (const d of this.devices.values()) {
      this.disconnect(d.device.id); d.device.removeEventListener('gattserverdisconnected', d.disconnected);
    }
  }
  status(d) {
    if (d.connecting) return d.paused ? 'canceling connection' : d.discovering ? 'looking for watch' : 'connecting';
    if (!d.connected && d.retryTimer !== null) return 'disconnected · retrying automatically';
    if (!d.connected) return 'disconnected';
    return d.lastSample !== null && this.now() - d.lastSample <= 2000 ? 'streaming' : 'connected · no stream';
  }
  rate(d) {
    const times = d.arrivals.filter(t => this.now() - t <= 2000);
    return times.length > 1 ? (times.length - 1) * 1000 / Math.max(1, times.at(-1) - times[0]) : 0;
  }
  snapshot(start, end, counts) {
    return { assignments: { ...this.assignments }, protocol: 'v2', packet_bytes: 36,
      axes_orientation: 'v0.1-canonical', transform: ['ax', '-ay', 'az', '-gx', 'gy', '-gz'],
      alignment: 'browser_monotonic_receipt_time', devices: [...this.devices.values()].map(d => ({
        device_id: d.device_id, name: d.name, pair_id: d.pair_id, role: d.role, limb: d.limb,
        sample_count: counts[d.device_id],
        connection_intervals: d.intervals.filter(i => i.start_ms <= end && (i.end_ms ?? end) >= start)
          .map(i => ({ start_s: Math.max(0, (i.start_ms - start) / 1000), end_s: (Math.min(end, i.end_ms ?? end) - start) / 1000 })),
        time_sync: d.sync.filter(s => s.at_ms <= end).map(s => ({ ...s, timestamp_s: (s.at_ms - start) / 1000, at_ms: undefined })),
      })) };
  }
}

export class WatchCapture {
  constructor(start) { this.start = start; this.counts = [0, 0, 0, 0]; this.chunks = []; this.lines = [CSV_HEADER + '\n']; }
  append(s, receipt) {
    if (!Number.isFinite(receipt) || receipt < this.start) return;
    this.counts[s.device_id]++;
    this.lines.push([(receipt - this.start) / 1000, s.timestamp_ms, s.device_id,
      s.ax, s.ay, s.az, s.gx, s.gy, s.gz, s.role, s.button_flags].join(',') + '\n');
    if (this.lines.length >= 2048) { this.chunks.push(new Blob(this.lines)); this.lines = []; }
  }
  finish(manifest, watches, end, mediaName) {
    const count = this.counts.reduce((a, b) => a + b, 0), deviceCount = this.counts.filter(Boolean).length;
    manifest.watches = watches?.snapshot(this.start, end, this.counts) || {
      assignments: { armsPairID: '00', legsPairID: '01' }, devices: [], axes_orientation: 'v0.1-canonical', protocol: 'v2' };
    manifest.watches.sample_count = count; manifest.watches.device_count = deviceCount;
    const metadata = { schema_version: 1, recording_id: manifest.session_id, created_at: manifest.created_at,
      record_start_time_unix: Date.parse(manifest.created_at) / 1000, duration_seconds: manifest.duration_s,
      sample_count: count, device_count: deviceCount, hardware_version: 'v0.2', axes_orientation: 'v0.1-canonical',
      firmware_protocol: 'v2', subject: '', pattern: '', has_video: !manifest.media.audio_only,
      video_filename: manifest.media.audio_only ? null : mediaName, app_name: 'dance2music', source: 'browser-recording',
      alignment: 'browser_monotonic_receipt_time', pair_assignments: manifest.watches.assignments };
    const json = value => new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' });
    return [
      { key: 'imu', name: 'imu_data.csv', blob: new Blob([...this.chunks, ...this.lines], { type: 'text/csv' }) },
      { key: 'metadata', name: 'metadata.json', blob: json(metadata) },
      { key: 'recording_meta', name: 'recording_meta.json', blob: json({ subject: '', created: manifest.created_at,
        duration_s: manifest.duration_s, pair_id: manifest.watches.assignments.armsPairID, source: 'browser-recording' }) },
      { key: 'sensor_assignments', name: 'sensor-assignments.json', blob: json(manifest.watches.assignments) },
    ];
  }
}

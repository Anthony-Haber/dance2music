// Same-origin desktop bridge for browsers without navigator.requestMIDIAccess.
// No requests/devices/timers start until the user clicks Connect and selects a port.
const ROOT = '/api/midi/';

async function request(fetcher, action, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetcher(ROOT + action, {
      method: payload === undefined ? 'GET' : 'POST', cache: 'no-store',
      credentials: 'same-origin', signal: controller.signal,
      ...(payload === undefined ? {} : { headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), keepalive: true }),
    });
    let result;
    try { result = await response.json(); }
    catch { throw new Error('Start the local MIDI server with python live.py.'); }
    if (!response.ok) throw new Error(result.error || 'Local MIDI request failed.');
    return result;
  } finally { clearTimeout(timer); }
}

class LocalMidiPort {
  constructor(access, info) {
    this.access = access; this.id = info.id; this.name = info.name;
    this.state = 'connected'; this.connection = 'closed'; this.session = null;
    this.sequence = 0; this.generation = 0; this.queue = Promise.resolve();
    this.queued = 0; this.timer = null; this.opening = null; this.error = null;
  }
  async open() {
    if (this.session) return;
    if (this.opening) return this.opening;
    const generation = this.generation;
    this.opening = (async () => {
      const result = await this.access.request('open', { port: this.name });
      if (generation !== this.generation) {
        await this.access.request('close', { session: result.session });
        throw new Error('MIDI selection changed.');
      }
      this.session = result.session; this.sequence = 0; this.connection = 'open';
      this.queue = Promise.resolve(); this.error = null;
      this.timer = setInterval(() => {
        if (this.session && this.queued === 0) this.sendBatch([]).catch(error => this.failed(error));
      }, 200);
      this.timer.unref?.();
    })();
    try { await this.opening; } finally { this.opening = null; }
  }
  sendBatch(messages) {
    if (!this.session || this.state === 'disconnected') throw new Error('Local MIDI port is closed.');
    if (this.queued >= 16) throw new Error('Local MIDI connection is too slow; select the port again.');
    const session = this.session, generation = this.generation, sequence = this.sequence++;
    const snapshot = messages.map(message => [...message]);
    this.queued++;
    this.queue = this.queue.then(() => {
      if (generation !== this.generation || session !== this.session) return;
      return this.access.request('send', { session, sequence, messages: snapshot });
    }).finally(() => { this.queued--; });
    return this.queue;
  }
  async close() {
    this.generation++;
    clearInterval(this.timer); this.timer = null;
    const session = this.session; this.session = null; this.connection = 'closed';
    await this.queue.catch(() => {});
    if (session) await this.access.request('close', { session });
  }
  failed(error) {
    if (!this.session) return;
    this.error = error.message; this.state = 'disconnected';
    this.close().catch(() => {});
    this.access.onstatechange?.();
  }
}

export class LocalMidiAccess {
  constructor(fetcher = globalThis.fetch) {
    this.fetcher = fetcher; this.outputs = new Map(); this.onstatechange = null;
    this.localBridge = true;
  }
  request(action, payload) { return request(this.fetcher, action, payload); }
  async refresh() {
    const result = await this.request('ports');
    if (!Array.isArray(result.ports)) throw new Error('Local MIDI server returned an invalid port list.');
    const previous = this.outputs, current = new Map();
    for (const info of result.ports) {
      const existing = previous.get(info.id);
      current.set(info.id, existing?.state === 'connected' ? existing : new LocalMidiPort(this, info));
    }
    this.outputs = current;
    for (const [id, port] of previous) {
      if (current.has(id)) continue;
      port.state = 'disconnected'; await port.close().catch(() => {});
    }
    this.onstatechange?.();
  }
}

export async function requestLocalMidiAccess({ location = globalThis.location, fetcher = globalThis.fetch } = {}) {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(location?.hostname)) {
    throw new Error('Safari MIDI needs this Mac’s local instrument server (python live.py).');
  }
  const access = new LocalMidiAccess(fetcher);
  await access.refresh(); return access;
}

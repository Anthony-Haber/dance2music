// Translation of validated instrument/midi_lifecycle.py, plus optional Web MIDI transport.
import { requestLocalMidiAccess } from './midi-local.js';

// Pure translations of the Python span mapping. Coordinates share units and
// dimensions; world points retain arm lengths when reaching toward the camera.
export function handSpanGain(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length !== 33) return 0;
  const points = [15, 13, 11, 12, 14, 16].map(index => landmarks[index]);
  const dimensions = points[0]?.length;
  if (![2, 3].includes(dimensions) || points.some(point => !Array.isArray(point) ||
      point.length !== dimensions || !point.every(Number.isFinite))) return 0;
  const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
  const lengths = points.slice(1).map((point, i) => distance(points[i], point));
  if (lengths.some(length => length <= 0)) return 0;
  const together = lengths[2] * 0.25, maximum = lengths.reduce((sum, length) => sum + length, 0);
  return Math.min(1, Math.max(0, (distance(points[0], points[5]) - together) / (maximum - together)));
}

export class MidiSpan {
  constructor() { this.reset(); }
  reset() { this.gain = 0; this.owner = null; }
  update(landmarks, owner = null, active = true) {
    if (owner == null || this.owner == null) this.gain = handSpanGain(landmarks);
    this.owner = owner;
    return active ? this.gain : 0;
  }
}

export class MidiNotes {
  constructor(channel = 1) {
    if (!Number.isInteger(channel) || channel < 1 || channel > 16) throw new Error('MIDI channel must be 1–16');
    this.channel = channel - 1; this.active = new Set(); this.expression = null; this.velocity = null;
  }
  update(notes, gain) {
    if (!Array.isArray(notes) || !Number.isFinite(gain) || gain < 0 || gain > 1 ||
        notes.some(n => !Number.isInteger(n) || n < 0 || n > 127)) return this.release();
    const wanted = new Set(gain > 0 ? notes : []), expression = wanted.size ? Math.round(gain * 127) : 0;
    const velocity = wanted.size ? Math.max(1, expression) : null;
    // MIDI 1.0 needs a new attack to change velocity. Release before restarting
    // common notes; identical quantized levels continue sustaining.
    const refresh = velocity !== this.velocity;
    const messages = [...this.active].sort((a, b) => a - b).filter(n => !wanted.has(n) || refresh).map(n => [0x80 + this.channel, n, 0]);
    if (expression !== this.expression) { messages.push([0xB0 + this.channel, 11, expression]); this.expression = expression; }
    messages.push(...[...wanted].sort((a, b) => a - b).filter(n => !this.active.has(n) || refresh).map(n => [0x90 + this.channel, n, velocity]));
    this.active = wanted; this.velocity = velocity; return messages;
  }
  release(panic = false) {
    const messages = [...this.active].sort((a, b) => a - b).map(n => [0x80 + this.channel, n, 0]);
    this.active.clear();
    if (this.expression !== 0) messages.push([0xB0 + this.channel, 11, 0]);
    this.expression = 0; this.velocity = null;
    if (panic) messages.push([0xB0 + this.channel, 64, 0], [0xB0 + this.channel, 123, 0]);
    return messages;
  }
}

export class MidiOutput {
  constructor({ navigator = globalThis.navigator, secure = globalThis.isSecureContext,
                notify = () => {}, clock = () => performance.now(), localMidi = requestLocalMidiAccess } = {}) {
    this.navigator = navigator; this.secure = secure; this.notify = notify; this.clock = clock;
    this.access = null; this.port = null; this.notes = new MidiNotes(); this.generation = 0;
    this.lastFrame = null; this.enabled = false; this.kind = 'chord'; this.pending = false;
    this.localMidi = localMidi;
  }
  ports() { return [...(this.access?.outputs.values() || [])].filter(p => p.state !== 'disconnected'); }
  async connect() {
    if (this.pending) return;
    if (!this.secure) { this.notify('MIDI needs HTTPS or localhost.'); return; }
    this.pending = true;
    try {
      if (!this.access) this.access = this.navigator?.requestMIDIAccess ?
        await this.navigator.requestMIDIAccess({ sysex: false }) : await this.localMidi();
      else if (this.access.localBridge) await this.access.refresh();
      this.access.onstatechange = () => {
        if (this.port?.state === 'disconnected') {
          const error = this.port.error;
          this.silence(true); this.port = null; this.generation++;
          this.notify(error ? 'Local MIDI connection failed: ' + error + ' Select a port to resume.' :
            'MIDI port disconnected. Select a port to resume.');
        } else this.notify(this.port ? 'MIDI connected.' : 'Select a MIDI output port.');
      };
      this.notify(this.port ? 'MIDI connected.' : this.ports().length ?
        (this.access.localBridge ? 'Mac MIDI ready. Select your IAC output port.' : 'Select a MIDI output port.') :
        'No MIDI outputs. Enable the IAC Driver or create a virtual MIDI port, then refresh.');
    } catch (error) { this.notify('MIDI access failed: ' + error.message); }
    finally { this.pending = false; }
  }
  async select(id) {
    const generation = ++this.generation, old = this.port;
    this.silence(true); this.port = null;
    try {
      if (old) await old.close();
      if (generation !== this.generation) return;
      const port = this.ports().find(p => p.id === id);
      if (!port) { this.notify('Select a MIDI output port.'); return; }
      await port.open();
      if (generation !== this.generation) { if (this.port !== port) await port.close(); return; }
      if (port.state === 'disconnected') throw new Error('port disconnected');
      this.port = port; this.notify('MIDI connected. Start Anthony instrument to play.');
    } catch (error) { if (generation === this.generation) this.notify('Could not open MIDI port: ' + error.message); }
  }
  configure({ enabled, channel, kind }) {
    if (!['chord', 'root'].includes(kind)) throw new Error('Unknown MIDI note mode');
    if (this.enabled !== enabled || this.notes.channel !== channel - 1 || this.kind !== kind) {
      this.silence(true); this.notes = new MidiNotes(channel);
      this.enabled = enabled; this.kind = kind;
    }
  }
  send(messages) {
    if (!this.port) return;
    const port = this.port;
    const failed = error => {
      if (this.port !== port) return;
      // A partially sent chord may own notes. Try all note-offs even if one
      // fails; never replay stale notes automatically after a send error.
      const release = this.notes.release(true);
      if (port.sendBatch) { port.close().catch(() => {}); }
      else for (const message of release) { try { port.send(message); } catch {} }
      this.port = null; this.generation++; this.notify('MIDI send failed: ' + error.message + '. Select a port to retry.');
    };
    try {
      if (port.sendBatch) { if (messages.length) port.sendBatch(messages).catch(failed); }
      else for (const message of messages) port.send(message);
    } catch (error) { failed(error); }
  }
  update(state) {
    this.lastFrame = this.clock();
    if (!this.enabled || !this.port) return;
    this.send(this.notes.update(this.kind === 'root' ? [state?.root_midi] : state?.notes, state?.gain));
  }
  silence(panic = false) { this.lastFrame = null; this.send(this.notes.release(panic)); }
  watchdog() {
    if (this.lastFrame !== null && this.clock() - this.lastFrame >= 500) this.silence();
  }
}

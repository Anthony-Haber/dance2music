// Translation of validated instrument/midi_lifecycle.py, plus optional Web MIDI transport.
export class MidiNotes {
  constructor(channel = 1) {
    if (!Number.isInteger(channel) || channel < 1 || channel > 16) throw new Error('MIDI channel must be 1–16');
    this.channel = channel - 1; this.active = new Set(); this.expression = null;
  }
  update(notes, gain) {
    if (!Array.isArray(notes) || !Number.isFinite(gain) || gain < 0 || gain > 1 ||
        notes.some(n => !Number.isInteger(n) || n < 0 || n > 127)) return this.release();
    const wanted = new Set(gain > 0 ? notes : []), expression = wanted.size ? Math.round(gain * 127) : 0;
    const messages = [...this.active].sort((a, b) => a - b).filter(n => !wanted.has(n)).map(n => [0x80 + this.channel, n, 0]);
    if (expression !== this.expression) { messages.push([0xB0 + this.channel, 11, expression]); this.expression = expression; }
    messages.push(...[...wanted].sort((a, b) => a - b).filter(n => !this.active.has(n)).map(n => [0x90 + this.channel, n, 100]));
    this.active = wanted; return messages;
  }
  release(panic = false) {
    const messages = [...this.active].sort((a, b) => a - b).map(n => [0x80 + this.channel, n, 0]);
    this.active.clear();
    if (this.expression !== 0) messages.push([0xB0 + this.channel, 11, 0]);
    this.expression = 0;
    if (panic) messages.push([0xB0 + this.channel, 64, 0], [0xB0 + this.channel, 123, 0]);
    return messages;
  }
}

export class MidiOutput {
  constructor({ navigator = globalThis.navigator, secure = globalThis.isSecureContext,
                notify = () => {}, clock = () => performance.now() } = {}) {
    this.navigator = navigator; this.secure = secure; this.notify = notify; this.clock = clock;
    this.access = null; this.port = null; this.notes = new MidiNotes(); this.generation = 0;
    this.lastFrame = null; this.enabled = false; this.kind = 'chord'; this.pending = false;
  }
  ports() { return [...(this.access?.outputs.values() || [])].filter(p => p.state !== 'disconnected'); }
  async connect() {
    if (this.pending) return;
    if (!this.secure) { this.notify('MIDI needs HTTPS or localhost.'); return; }
    if (!this.navigator?.requestMIDIAccess) { this.notify('Web MIDI is unavailable. Use desktop Chrome, Edge or supported Firefox.'); return; }
    this.pending = true;
    try {
      if (!this.access) this.access = await this.navigator.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => {
        if (this.port?.state === 'disconnected') {
          this.silence(true); this.port = null; this.generation++;
          this.notify('MIDI port disconnected. Select a port to resume.');
        } else this.notify(this.port ? 'MIDI connected.' : 'Select a MIDI output port.');
      };
      this.notify(this.port ? 'MIDI connected.' : this.ports().length ? 'Select a MIDI output port.' : 'No MIDI outputs. Create a virtual MIDI port, then refresh.');
    } catch (error) { this.notify('MIDI access failed: ' + error.message + '. Check browser/site MIDI permission (Firefox may request an add-on).'); }
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
    try { for (const message of messages) this.port.send(message); }
    catch (error) {
      // A partially sent chord may own notes. Try all note-offs even if one
      // fails; never replay stale notes automatically after a send error.
      for (const message of this.notes.release(true)) { try { this.port.send(message); } catch {} }
      this.port = null; this.generation++; this.notify('MIDI send failed: ' + error.message + '. Select a port to retry.');
    }
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

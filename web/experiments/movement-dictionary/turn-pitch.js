// Browser translation of instrument/turn_pitch.py. One confirmed body quarter
// moves the transposition tonic one D-major degree; all choir intervals stay intact.
export const TURN_PITCH = Object.freeze({ tonic_midi: 62,
  scale: Object.freeze([0, 2, 4, 5, 7, 9, 11]), min_steps: -7, max_steps: 14 });

export class TurnPitch {
  constructor() { this.reset(); }
  reset() { this.steps = 0; this.counts = [0, 0]; this.enabled = true; this.state = this.snapshot(false); }
  snapshot(changed) {
    const cfg = TURN_PITCH, degree = ((this.steps % cfg.scale.length) + cfg.scale.length) % cfg.scale.length;
    const offset = this.enabled ? 12 * Math.floor(this.steps / cfg.scale.length) + cfg.scale[degree] : 0;
    const limit = !this.enabled ? 0 : this.steps === cfg.max_steps ? 1 : this.steps === cfg.min_steps ? -1 : 0;
    return { steps: this.steps, semitones: offset, tonic_midi: cfg.tonic_midi + offset, changed, enabled: this.enabled, limit };
  }
  update(spin, { enabled = true } = {}) {
    const oldOffset = this.state.semitones; this.enabled = enabled;
    if (spin) {
      const left = spin.left_quarter_turns, right = spin.right_quarter_turns;
      const event = spin.quarter_event, tracked = spin.tracked;
      if (Number.isInteger(left) && Number.isInteger(right) && left >= 0 && right >= 0 &&
          typeof event === 'boolean' && typeof tracked === 'boolean') {
        const previous = this.counts;
        if (left === 0 && right === 0) { this.steps = 0; this.counts = [left, right]; }
        else if (left >= previous[0] && right >= previous[1]) {
          this.counts = [left, right];
          const dl = left - previous[0], dr = right - previous[1];
          if (enabled && tracked && event && ((dl === 1 && dr === 0) || (dl === 0 && dr === 1)))
            this.steps = Math.max(TURN_PITCH.min_steps, Math.min(TURN_PITCH.max_steps, this.steps + (dl ? 1 : -1)));
        }
      }
    }
    const next = this.snapshot(false); this.state = this.snapshot(next.semitones !== oldOffset); return this.state;
  }
  apply(notes) {
    const shifted = notes.map(n => n + this.state.semitones);
    if (shifted.some(n => !Number.isInteger(n) || n < 0 || n > 127))
      throw new Error('Choir transposition would leave the MIDI note range 0..127');
    return shifted;
  }
}

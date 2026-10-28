// Device-free translation of instrument/controller.py. Seconds, mirrored pixels,
// MIDI pitches. Browser capture/drawing/audio live outside this module.
import { gestureQuality, mod12, rootRegion, symbol, voiceLead } from './instrument-harmony.js';
import { IntervalSelector, ROOT_MIDI_MIN, ROOT_MIDI_MAX } from './instrument-root.js';

export const CONFIG = Object.freeze({
  root_mode: 'interval', interval_neutral_torsos: 0.25, interval_axis_ratio: 1.25,
  interval_rearm_s: 0.20, close_s: 0.35, reopen_s: 0.20, arbitration_s: 0.25,
  root_dwell_s: 0.35, quality_dwell_s: 0.35, major_dwell_s: 1.5, max_gap_s: 0.20,
  confidence_min: 0.5, split_torsos: 1.0, dead_zone_torsos: 0.25,
  gain_exponent: 1.5, gain_radius_torsos: 0.75,
});
const GESTURES = new Set(['Closed_Fist', 'Open_Palm', 'Pointing_Up', 'Victory', 'Thumb_Up', 'Thumb_Down']);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
class Dwell {
  constructor() { this.candidate = null; this.since = 0; }
  read(value, now, seconds) {
    if (value === null || value !== this.candidate) { this.candidate = value; this.since = now; }
    return value !== null && now - this.since + 1e-9 >= seconds ? value : null;
  }
}
class FistGate {
  constructor() { this.armed = false; this.closed_since = null; this.open_since = null; this.closure_triggered = false; }
  read(gesture, now, config, since = null) {
    if (gesture == null) {
      this.armed = false; this.closed_since = this.open_since = null; this.closure_triggered = false; return false;
    }
    if (gesture !== 'Closed_Fist') {
      this.closed_since = null; this.closure_triggered = false;
      if (this.open_since === null) this.open_since = now;
      if (now - this.open_since + 1e-9 >= config.reopen_s) this.armed = true;
      return false;
    }
    this.open_since = null;
    if (this.closed_since === null) this.closed_since = since !== null ? Math.min(now, since) : now;
    if (this.armed && now - this.closed_since + 1e-9 >= config.close_s) {
      this.armed = false; this.closure_triggered = true; return true;
    }
    return false;
  }
  stableClosed(now, seconds) { return this.closed_since !== null && now - this.closed_since + 1e-9 >= seconds; }
}

export class InstrumentController {
  constructor(config = {}, initial = { root: 0, quality: 'major' }) {
    this.config = { ...CONFIG, ...config }; this.initial = { ...initial };
    for (const [key, value] of Object.entries(this.config)) {
      if (key === 'root_mode') { if (!['interval', 'midpoint'].includes(value)) throw new RangeError('Invalid root mode'); }
      else if (!Number.isFinite(value) || value <= 0) throw new RangeError(`Invalid ${key}`);
    }
    if (this.config.interval_axis_ratio <= 1 || this.config.confidence_min > 1) throw new RangeError('Invalid thresholds');
    this.reset();
  }
  reset() {
    this.chord = { ...this.initial }; this.root_midi = 48 + this.chord.root;
    this.root_mode = this.root_mode ?? this.config.root_mode; this.mode_changed = false;
    this.notes = voiceLead([], this.chord.root, this.chord.quality);
    this.locked = this.split = false; this.ball_owner = null;
    this.owned_radius_torsos = this.owned_gain = 0; this.last_time = null; this.clearTransients();
  }
  clearTransients() {
    this.gates = { L: new FistGate(), R: new FistGate() };
    this.root_dwell = new Dwell(); this.quality_dwell = new Dwell(); this.major_dwell = new Dwell();
    this.interval_selector = new IntervalSelector(); this.pending_since = null; this.pending_transfer = null;
    this.pending_sides = new Set(); this.pending_root = this.chord.root; this.pending_root_midi = this.root_midi;
    this.split_requested = false;
  }
  setRootMode(mode) {
    if (!['interval', 'midpoint'].includes(mode)) throw new RangeError('Root mode must be interval or midpoint');
    if (mode !== this.root_mode) {
      this.root_mode = mode; this.mode_changed = true; this.root_dwell = new Dwell(); this.interval_selector = new IntervalSelector();
    }
  }
  toggleRootMode() { this.setRootMode(this.root_mode === 'interval' ? 'midpoint' : 'interval'); }
  merge() {
    this.split = false; this.ball_owner = null; this.split_requested = false;
    this.pending_since = null; this.pending_transfer = null;
    Object.values(this.gates).forEach(gate => { gate.closure_triggered = false; });
  }
  update(frame) {
    const now = frame.time_s;
    if (!Number.isFinite(now) || now < 0 || (this.last_time !== null && now <= this.last_time))
      throw new RangeError('Controller timestamps must be finite and strictly increasing');
    if (frame.root_mode != null) this.setRootMode(frame.root_mode);
    if (this.last_time !== null && now - this.last_time > this.config.max_gap_s + 1e-9) this.clearTransients();
    this.last_time = now; const events = [];
    if (this.mode_changed) { events.push(`root_mode:${this.root_mode}`); this.mode_changed = false; }
    const hands = Object.fromEntries(frame.hands.map(h => [h.side, h]));
    const torsoValid = !!frame.torso_center && Number.isFinite(frame.torso_px) && frame.torso_px > 0;
    const gestures = Object.fromEntries(Object.entries(hands).map(([side, h]) => [side,
      torsoValid && h.confidence >= this.config.confidence_min && GESTURES.has(h.gesture) ? h.gesture : null]));
    const closures = new Set();
    for (const [side, gate] of Object.entries(this.gates))
      if (gate.read(gestures[side], now, this.config, hands[side]?.gesture_since ?? null)) closures.add(side);
    if (this.pending_since !== null && (!torsoValid || [...this.pending_sides].some(side => gestures[side] == null)))
      this.pending_since = null;
    const nearbyFists = frame.torso_px != null && frame.hands.length === 2 &&
      ['L', 'R'].every(side => gestures[side] === 'Closed_Fist') &&
      distance(hands.L.wrist, hands.R.wrist) <= this.config.split_torsos * frame.torso_px;
    const transferTarget = gestures.L === 'Closed_Fist' && gestures.R === 'Open_Palm' ? 'L'
      : gestures.R === 'Closed_Fist' && gestures.L === 'Open_Palm' ? 'R' : null;
    if (this.pending_since !== null && (transferTarget !== this.pending_transfer ||
        (this.pending_transfer !== null && [...this.pending_sides].some(side => gestures[side] !== 'Closed_Fist'))))
      this.pending_since = null;
    if (closures.size && this.pending_since === null) {
      this.pending_since = now; this.pending_root = this.chord.root; this.pending_root_midi = this.root_midi;
      this.pending_sides = new Set(closures); this.pending_transfer = transferTarget; this.root_dwell = new Dwell();
    } else if (closures.size) for (const side of closures) this.pending_sides.add(side);
    if (nearbyFists) {
      if (this.pending_since !== null || Object.values(this.gates).some(gate => gate.closure_triggered)) this.split_requested = true;
      this.pending_since = null;
      if (this.split_requested && Object.values(this.gates).every(gate => gate.stableClosed(now, this.config.close_s))) {
        this.split = this.ball_owner !== null ? false : !this.split; this.ball_owner = null;
        events.push(this.split ? 'split' : 'merge'); this.split_requested = false;
        Object.values(this.gates).forEach(gate => { gate.closure_triggered = false; });
      }
    } else {
      this.split_requested = false;
      if (this.pending_since !== null && now - this.pending_since + 1e-9 >= this.config.arbitration_s) {
        if (this.pending_transfer !== null) {
          this.transfer(frame, this.pending_transfer); events.push(`transfer:${this.pending_transfer}`);
        } else {
          this.locked = !this.locked;
          if (this.locked) { this.chord.root = this.pending_root; this.root_midi = this.pending_root_midi; }
          events.push(this.locked ? 'lock' : 'unlock');
        }
        this.pending_since = null; this.root_dwell = new Dwell();
      }
    }
    let rawRoot = null, root = this.chord.root, transposed = false;
    const rootAllowed = !this.locked && this.pending_since === null && !this.split_requested;
    if (this.root_mode === 'midpoint') {
      rawRoot = rootRegion(frame, this.config.dead_zone_torsos);
      if (rootAllowed) {
        const selected = this.root_dwell.read(rawRoot, now, this.config.root_dwell_s);
        if (selected !== null) {
          const target = this.root_midi + selected - this.chord.root;
          if (target >= ROOT_MIDI_MIN && target <= ROOT_MIDI_MAX) { root = selected; this.root_midi = target; }
        }
      } else this.root_dwell = new Dwell();
    } else {
      const fistActive = frame.hands.some(h => h.gesture === 'Closed_Fist' ||
        (h.raw_gesture === 'Closed_Fist' && h.raw_confidence >= this.config.confidence_min));
      const blocked = this.locked ? 'ROOT LOCKED' : !rootAllowed || fistActive ? 'FIST CONTROL' : null;
      const step = this.interval_selector.read(frame, this.config, blocked);
      if (this.interval_selector.candidate !== null) rawRoot = mod12(root + this.interval_selector.candidate);
      if (step !== null) {
        const target = this.root_midi + step, notes = this.notes.map(n => n + step);
        if (target >= ROOT_MIDI_MIN && target <= ROOT_MIDI_MAX && notes.every(n => n >= 0 && n <= 127)) {
          this.root_midi = target; this.notes = notes; root = mod12(target); transposed = true;
          events.push(`interval:${step >= 0 ? '+' : ''}${step}`);
        } else this.interval_selector.feedback = 'REGISTER LIMIT - RETURN TO CENTER';
      }
    }
    let quality = this.chord.quality, rawQuality = gestureQuality(gestures.L, gestures.R);
    if (rawQuality === 'major') rawQuality = null;
    const selectedQuality = this.quality_dwell.read(rawQuality, now, this.config.quality_dwell_s);
    if (selectedQuality !== null) quality = selectedQuality;
    const major = this.major_dwell.read(['L', 'R'].every(side => gestures[side] === 'Open_Palm') ? 'major' : null, now, this.config.major_dwell_s);
    if (major !== null) quality = major;
    const changed = root !== this.chord.root || quality !== this.chord.quality;
    if (changed || transposed) events.push('chord');
    if ((changed && !transposed) || quality !== this.chord.quality)
      this.notes = voiceLead(this.notes, root, quality, this.root_midi - (48 + root));
    this.chord = { root, quality }; const { balls, gain } = this.geometry(frame);
    return { time_s: now, root, quality, symbol: symbol(root, quality), notes: [...this.notes],
      locked: this.locked, split: this.split, balls, gain, events, root_candidate: rawRoot,
      pending_lock: (this.pending_since !== null && this.pending_transfer === null) || this.split_requested,
      root_mode: this.root_mode, root_midi: this.root_midi,
      hand_directions: [...this.interval_selector.directions], interval_candidate: this.interval_selector.candidate,
      root_armed: this.interval_selector.armed, root_feedback: this.interval_selector.feedback,
      ball_owner: this.ball_owner, pending_transfer: this.pending_since !== null ? this.pending_transfer : null };
  }
  transfer(frame, owner) {
    const { balls, gain } = this.geometry(frame);
    if (!frame.torso_px || !balls.length) return;
    this.owned_radius_torsos = Math.sqrt(balls.reduce((sum, ball) => sum + ball.radius ** 2, 0)) / frame.torso_px;
    this.owned_gain = gain; this.ball_owner = owner; this.split = false;
  }
  geometry(frame) {
    if (!frame.torso_px || !frame.torso_center) return { balls: [], gain: 0 };
    if (this.ball_owner !== null) {
      const owner = frame.hands.find(h => h.side === this.ball_owner);
      return { balls: owner ? [{ center: owner.wrist, radius: this.owned_radius_torsos * frame.torso_px, anchor: owner.side }] : [],
        gain: owner ? this.owned_gain : 0 };
    }
    if (frame.hands.length !== 2) return { balls: this.split ? frame.hands.map(h =>
      ({ center: h.wrist, radius: frame.torso_px * 0.12, anchor: h.side })) : [], gain: 0 };
    const [left, right] = frame.hands, radius = distance(left.wrist, right.wrist) / 2;
    const gain = Math.min(1, radius / frame.torso_px / this.config.gain_radius_torsos) ** this.config.gain_exponent;
    const balls = this.split ? frame.hands.map(h => ({ center: h.wrist, radius: radius / Math.sqrt(2), anchor: h.side }))
      : [{ center: left.wrist.map((p, i) => (p + right.wrist[i]) / 2), radius, anchor: 'middle' }];
    return { balls, gain };
  }
}

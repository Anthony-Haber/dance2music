// Translation of instrument/root_control.py. Positions use mirrored image pixels.
export const DIRECTIONS = ['left', 'right', 'up', 'down'];
// Internal L rows / R columns. Mixed pairs reverse only their vertical direction.
export const STEP_ROWS = [[-5, 2, 7, -7], [-2, 5, 1, -1], [-3, 4, 12, -6], [3, -4, 6, -12]];
export const ROOT_MIDI_MIN = 0, ROOT_MIDI_MAX = 106;
export function handOrigins(frame) {
  if (!frame.torso_center || !frame.torso_px) return {};
  const origins = {};
  for (const [side, shoulder, sign] of [['L', 12, 1], ['R', 11, -1]]) {
    const x = frame.pose_landmarks?.length ? frame.pose_landmarks[shoulder]?.[0]
      : frame.torso_center[0] + sign * 0.3 * frame.torso_px;
    if (Number.isFinite(x)) origins[side] = [x, frame.torso_center[1]];
  }
  return origins;
}
export function handDirections(frame, config) {
  const origins = handOrigins(frame);
  return ['L', 'R'].map(side => {
    const hand = frame.hands.find(h => h.side === side), origin = origins[side];
    if (!hand || !origin) return null;
    const dx = (hand.wrist[0] - origin[0]) / frame.torso_px;
    const dy = (hand.wrist[1] - origin[1]) / frame.torso_px;
    if (Math.hypot(dx, dy) <= config.interval_neutral_torsos) return 'center';
    if (Math.abs(dx) >= config.interval_axis_ratio * Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    if (Math.abs(dy) >= config.interval_axis_ratio * Math.abs(dx)) return dy > 0 ? 'down' : 'up';
    return 'diagonal';
  });
}
export class IntervalSelector {
  constructor() {
    this.directions = [null, null]; this.feedback = 'CENTER BOTH HANDS TO ARM';
    this.pair_since = 0; this.reset();
  }
  reset() { this.armed = false; this.neutral_since = null; this.pair = null; this.candidate = null; this.progress = 0; }
  read(frame, config, blocked = null) {
    this.directions = handDirections(frame, config);
    this.candidate = STEP_ROWS[DIRECTIONS.indexOf(this.directions[0])]?.[DIRECTIONS.indexOf(this.directions[1])] ?? null;
    this.progress = 0;
    if (blocked || this.directions.includes(null)) {
      this.reset(); this.feedback = blocked || 'BODY / WRISTS INCOMPLETE'; return null;
    }
    if (this.directions.every(d => d === 'center')) {
      this.pair = null;
      if (this.neutral_since === null) this.neutral_since = frame.time_s;
      if (frame.time_s - this.neutral_since + 1e-9 >= config.interval_rearm_s) this.armed = true;
      this.feedback = this.armed ? 'READY - MOVE BOTH HANDS' : 'HOLD CENTER TO ARM'; return null;
    }
    this.neutral_since = null;
    if (!this.armed) {
      this.pair = null;
      if (!/^(STEP APPLIED|REGISTER LIMIT)/.test(this.feedback)) this.feedback = 'CENTER BOTH HANDS TO ARM';
      return null;
    }
    if (this.candidate === null) { this.pair = null; this.feedback = 'MOVE BOTH HANDS; AVOID DIAGONALS'; return null; }
    if (!this.pair || this.pair.some((d, i) => d !== this.directions[i])) {
      this.pair = [...this.directions]; this.pair_since = frame.time_s;
    }
    this.progress = Math.min(1, (frame.time_s - this.pair_since) / config.root_dwell_s);
    this.feedback = `HOLD ${Math.round(this.progress * 100)}%`;
    if (frame.time_s - this.pair_since + 1e-9 < config.root_dwell_s) return null;
    const step = this.candidate; this.armed = false; this.pair = null;
    this.feedback = 'STEP APPLIED - RETURN TO CENTER'; return step;
  }
}

// Anthony's browser translation of instrument/body_spin.py, validated by
// live Python parity tests. Fresh, unmirrored MediaPipe image/world landmarks;
// t is monotonic seconds. Positive yaw turns to the dancer's own left.
export const SPIN = Object.freeze({
  visibility_min: 0.5, torso_agreement_degrees: 45, limb_agreement_degrees: 60,
  gap_seconds: 0.3, max_rate: 720, max_step: 75, rate_seconds: 0.12,
  active_rate: 90, order_fraction: 0.12, order_hold_seconds: 0.05,
  reversal_degrees: 20, evidence_degrees: 45, half_turn_degrees: 180, quarter_turn_degrees: 90,
});
const degrees = a => a * 180 / Math.PI;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export class BodySpin {
  constructor() { this.config = SPIN; this.reset(); }
  reset() { this.time = null; this.left = this.right = this.quarterLeft = this.quarterRight = 0; this.breakPath(); this.result('ready'); }
  breakPath() {
    this.angle = this.goodTime = null;
    this.progress = this.peak = this.rate = this.direction = 0;
    this.orders = {}; this.seen = {}; this.candidates = {}; this.pendingSwaps = {};
    this.swaps = { hands: false, legs: false };
    this.limbStart = {}; this.quarterPassed = 0;
  }
  point(points, i, world = false) {
    if (!points || points.length !== 33 || !points[i]) return null;
    const p = points[i], values = [p.x, p.y, p.z === undefined ? (world ? NaN : 0) : p.z,
      p.visibility === undefined ? 1 : p.visibility, p.presence === undefined ? 1 : p.presence];
    if (!values.every(v => typeof v === 'number' && Number.isFinite(v))) return null;
    const quality = Math.min(...values.slice(3));
    return quality >= SPIN.visibility_min ? [...values.slice(0, 3), Math.min(1, quality)] : null;
  }
  axis(image, world, left, right) {
    const il = this.point(image, left), ir = this.point(image, right);
    const wl = this.point(world, left, true), wr = this.point(world, right, true);
    if (!il || !ir || !wl || !wr) return null;
    const dx = wl[0] - wr[0], dz = wl[2] - wr[2];
    return Math.hypot(dx, dz) < 1e-6 ? null : [Math.atan2(dz, dx), Math.min(il[3], ir[3], wl[3], wr[3])];
  }
  order(image, left, right, span) {
    const a = this.point(image, left), b = this.point(image, right);
    if (!a || !b || Math.abs(a[0] - b[0]) < span * SPIN.order_fraction) return 0;
    return a[0] > b[0] ? 1 : -1;
  }
  result(status, { tracked = false, confidence = 0, face = false, active = false, event = false,
    quarterEvent = false, rotated = null } = {}) {
    return (this.out = {
      rate: tracked ? this.rate : 0, active, tracked, confidence, status,
      progress_degrees: Math.abs(this.progress), phase_degrees: this.angle === null ? 0 : degrees(this.angle),
      half_turns: this.left + this.right, left_half_turns: this.left, right_half_turns: this.right,
      direction: this.direction, event, hands_swapped: this.swaps.hands, legs_swapped: this.swaps.legs,
      face_visible: face,
      quarter_turns: this.quarterLeft + this.quarterRight,
      left_quarter_turns: this.quarterLeft, right_quarter_turns: this.quarterRight,
      quarter_progress_degrees: quarterEvent ? SPIN.quarter_turn_degrees : Math.min(SPIN.quarter_turn_degrees,
        Math.max(0, Math.abs(this.progress) - this.quarterPassed * SPIN.quarter_turn_degrees)),
      quarter_event: quarterEvent, hands_rotated: !!rotated?.hands, legs_rotated: !!rotated?.legs,
    });
  }
  update(image, world, t) {
    const cfg = SPIN;
    if (!Number.isFinite(t) || this.time !== null && t <= this.time) {
      this.breakPath(); return this.result('invalid timing');
    }
    this.time = t;
    const face = [0, 2, 5].every(i => this.point(image, i));
    const shoulders = this.axis(image, world, 11, 12), hips = this.axis(image, world, 23, 24);
    const statusMissing = shoulders && hips ? 'torso disagreement' : 'need torso';
    if (!shoulders || !hips || Math.abs(degrees(wrap(shoulders[0] - hips[0]))) > cfg.torso_agreement_degrees) {
      if (this.goodTime !== null && t - this.goodTime > cfg.gap_seconds) this.breakPath();
      this.rate = 0; return this.result(statusMissing, { face });
    }
    const yaw = Math.atan2(
      Math.sin(shoulders[0]) * shoulders[1] + Math.sin(hips[0]) * hips[1],
      Math.cos(shoulders[0]) * shoulders[1] + Math.cos(hips[0]) * hips[1]);
    const quality = Math.min(shoulders[1], hips[1]);
    if (this.goodTime !== null && t - this.goodTime > cfg.gap_seconds) this.breakPath();
    const dt = this.goodTime === null ? 0 : t - this.goodTime;
    const delta = this.angle === null ? 0 : degrees(wrap(yaw - this.angle));
    if (dt > 0 && Math.abs(delta) > Math.min(cfg.max_step, cfg.max_rate * dt + 3)) {
      this.breakPath(); this.angle = yaw; this.goodTime = t; return this.result('orientation jump', { face });
    }
    this.angle = yaw; this.goodTime = t;
    if (dt > 0) this.rate += (1 - Math.exp(-dt / cfg.rate_seconds)) * (delta / dt - this.rate);
    this.progress += delta;
    if (!this.direction && Math.abs(this.progress) >= 3 - 1e-7) this.direction = Math.sign(this.progress);
    if (this.direction) {
      this.peak = Math.max(this.peak, this.progress * this.direction);
      const retreat = this.peak - this.progress * this.direction;
      if (retreat >= cfg.reversal_degrees - 1e-7) {
        this.direction *= -1; this.progress = this.direction * retreat; this.peak = retreat;
        this.swaps = { hands: false, legs: false }; this.pendingSwaps = {};
        this.limbStart = {}; this.quarterPassed = 0;
      }
    }
    // Near a profile view a projected pair's ordering is unknown, not a swap.
    const torso = [11, 12, 23, 24].map(i => this.point(image, i));
    const xs = torso.map(p => p[0]), ys = torso.map(p => p[1]);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-6);
    const shoulderOrder = this.order(image, 11, 12, span), hipOrder = this.order(image, 23, 24, span);
    const bodyOrder = shoulderOrder === hipOrder ? shoulderOrder : 0;
    let support = false;
    const rotated = { hands: false, legs: false };
    for (const [name, options] of [['hands', [[15, 16]]], ['legs', [[25, 26], [27, 28]]]]) {
      const pair = options.find(p => this.axis(image, world, ...p));
      if (!pair) { delete this.candidates[name]; continue; }
      const axis = this.axis(image, world, ...pair);
      const aligned = Math.abs(degrees(wrap(axis[0] - yaw))) <= cfg.limb_agreement_degrees;
      support ||= aligned;
      if (name in this.seen && t - this.seen[name] > cfg.gap_seconds) {
        delete this.orders[name]; delete this.pendingSwaps[name];
        delete this.limbStart[name];
      }
      this.seen[name] = t;
      if (aligned) {
        this.limbStart[name] ??= axis[0];
        rotated[name] = Math.abs(degrees(wrap(axis[0] - this.limbStart[name]))) >= cfg.evidence_degrees - 1e-7;
      }
      const order = this.order(image, ...pair, span);
      if (!order) { delete this.candidates[name]; continue; }
      const previous = this.orders[name];
      if (previous === undefined) this.orders[name] = order;
      else if (previous !== order) {
        const candidate = this.candidates[name];
        if (!candidate || candidate[0] !== order) this.candidates[name] = [order, t];
        else if (t - candidate[1] >= cfg.order_hold_seconds) {
          this.orders[name] = order; delete this.candidates[name]; this.pendingSwaps[name] = [order, t];
        }
      } else delete this.candidates[name];
      const pending = this.pendingSwaps[name];
      if (pending && t - pending[1] <= cfg.gap_seconds && aligned && pending[0] === order && order === bodyOrder &&
          Math.abs(this.progress) >= cfg.evidence_degrees - 1e-7) this.swaps[name] = true;
    }
    let status = Math.abs(this.progress) >= 5 - 1e-7 ? 'turning' : 'ready', event = false;
    const quarterIndex = Math.floor((Math.abs(this.progress) + 1e-7) / cfg.quarter_turn_degrees);
    const quarterEvent = quarterIndex > this.quarterPassed && (rotated.hands || rotated.legs);
    if (quarterEvent) {
      if (this.progress > 0) this.quarterLeft++; else this.quarterRight++;
      this.quarterPassed = quarterIndex; status = 'quarter turn';
    } else if (quarterIndex > this.quarterPassed) status = 'quarter unconfirmed';
    const completed = Math.abs(this.progress) >= cfg.half_turn_degrees - 1e-7;
    if (completed) {
      event = this.swaps.hands || this.swaps.legs;
      if (event) { if (this.progress > 0) this.left++; else this.right++; }
      status = event ? 'half turn' : 'unconfirmed';
    }
    const out = this.result(status, { tracked: true, confidence: quality, face,
      active: support && Math.abs(this.rate) > cfg.active_rate, event, quarterEvent, rotated });
    if (completed) {
      this.progress -= Math.sign(this.progress) * cfg.half_turn_degrees; this.peak = Math.abs(this.progress);
      this.swaps = { hands: false, legs: false }; this.pendingSwaps = {};
      this.quarterPassed = 0; this.limbStart = {};
    }
    return out;
  }
}

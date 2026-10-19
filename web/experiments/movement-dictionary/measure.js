// Movement Dictionary: what the body is doing, in the five terms of a
// dancer's notes. DOM-free and audio-free, so it runs in Node tests.
//
//   1 spine     the curve of the spine; which end starts a movement (head or
//               tail) and how long the movement takes to travel to the other
//   2 head      where the head points (yaw, pitch) relative to the torso
//   3 pairs     elbow-to-knee distances, same side and crossed; contact
//   4 vertical  the tilt of the hip-to-head axis from vertical, and its direction
//   5 circles   a point (a wrist, the head, the hips) travelling in a circle:
//               turning rate, size, direction, reversals, quarter turns;
//               and the whole body spinning about its vertical axis
//
// Inputs per frame: MediaPipe's 33 image landmarks (normalised x, y) and its
// 33 world landmarks (metres, origin at the hips, x to the image's right,
// y DOWN, z away from the camera). Posture (1–4) uses the world landmarks, so
// it reads forward/back lean too; motion (lead, circles) uses the image,
// scaled by the torso, because the world frame moves with the hips.
// Every constant is in MD and explained in README.md.
import { BodySpin } from './spin.js?v=body-turns-1';

export const MD = {
  smoothS: 0.08,               // landmark smoothing time constant (s)
  speedS: 0.1,                 // speed smoothing (s)
  // lead (note 1)
  restSpeed: 0.35,             // torsos/s: below this the body is at rest
  moveSpeed: 0.9,              // torsos/s: an end is "moving" above this
  restHoldS: 0.25,             // rest this long arms a new onset
  leadWindowS: 0.8,            // both ends must start within this window
  // head (note 2)
  turnRate: 160,               // deg/s: a sharp turn
  turnS: 0.04,                 // the turn rate's own (light) smoothing, so a quick turn registers
  turnGapS: 0.4,
  // pairs (note 3)
  contact: 0.28,               // torsos: elbow and knee touching
  // circles (note 5)
  circleMinSpeed: 0.6,         // torsos/s: slower is not a gesture
  circleWindowS: 1.2,          // the turning must add up over this window
  circleTurns: 0.7,            // ... to at least this many turns
  reverseS: 1.5,               // a circle restarting the other way within this long is a reversal
  // arms (added by the lab, not one of her notes)
  reachLow: 0.5, reachHigh: 1.3, // torsos from the trunk: arms by the sides → arms wide open
  reachOpen: 0.7,              // reach = 0.7 · the more open arm + 0.3 · the other
  motionS: 0.05,               // smoothing of the quick-movement speed (s): short, so a flick registers
  motionCap: 8,                // body lengths/s: faster than this is a landmark jumping, not a body
};

const MOVERS = [0, 13, 14, 15, 16, 25, 26];                 // nose, elbows, wrists, knees (plus the hips): who can trigger
const PTS = { NOSE: 0, LEAR: 7, REAR: 8, LSH: 11, RSH: 12, LEL: 13, REL: 14, LWR: 15, RWR: 16, LHIP: 23, RHIP: 24, LKN: 25, RKN: 26 };
export const CIRCLE_POINTS = { lhand: PTS.LWR, rhand: PTS.RWR, head: PTS.NOSE, hips: 'hips' };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], (a[2] || 0) - (b[2] || 0)];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], (a[2] || 0) + (b[2] || 0)];
const mul = (a, k) => [a[0] * k, a[1] * k, (a[2] || 0) * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + (a[2] || 0) * (b[2] || 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => Math.hypot(a[0], a[1], a[2] || 0);
const unit = a => { const n = norm(a) || 1; return mul(a, 1 / n); };
const mid = (a, b) => mul(add(a, b), 0.5);
const deg = r => r * 180 / Math.PI;
const UP = [0, -1, 0];                                       // world y points down
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// the body's own frame: L = towards her left, F = forward (towards the camera when she faces it), U = up
function frame(w) {
  const Lr = sub(w[PTS.LSH], w[PTS.RSH]), Lh = unit([Lr[0], 0, Lr[2]]);
  return { L: Lh, F: cross(Lh, UP), U: UP };
}

export class Dictionary {
  constructor() { this.reset(); }
  reset() {
    this.t = null; this.img = {}; this.wld = {}; this.neutral = { tiltL: 0, tiltF: 0, yaw: 0, pitch: -12, curl: 0, bend: 0 };
    this.speed = { head: 0, tail: 0 }; this.rest = 0; this.armed = true; this.onset = null; this.lastLead = null;
    this.yawPrev = null; this.yawRate = 0; this.lastTurn = -1e9;
    this.contactPrev = {}; this.circ = {}; this.bodySpin = new BodySpin(); this.out = null;
    this.mPrev = {}; this.mSpeed = 0;
  }

  // the dancer stands upright, looks ahead: her neutral becomes zero
  calibrate() {
    const o = this.out; if (!o) return false;
    this.neutral = { tiltL: o.vertical.rawL, tiltF: o.vertical.rawF, yaw: o.head.rawYaw, pitch: o.head.rawPitch,
                     curl: o.spine.rawCurl, bend: o.spine.rawBend };
    return true;
  }

  // image: 33 {x, y, visibility} normalised; world: 33 {x, y, z} metres; t seconds; W, H pixels
  update(image, world, t, W = 1, H = 1) {
    // The turn detector sees raw, fresh observations, including loss. The
    // general smoothed stores below may retain points for other studies.
    const spin = this.bodySpin.update(image, world, t);
    const dt = this.t === null ? 1 / 30 : Math.max(1e-3, Math.min(0.2, t - this.t));
    this.t = t;
    if (!image || !world) return (this.out = null);
    const a = 1 - Math.exp(-dt / MD.smoothS);
    const keep = (store, i, q) => { store[i] = store[i] ? add(mul(store[i], 1 - a), mul(q, a)) : q; };
    for (const i of Object.values(PTS)) {
      const m = image[i], w = world[i];
      if (!m || (m.visibility ?? 1) < 0.4) continue;
      keep(this.img, i, [m.x * W, m.y * H, 0]);
      if (w) keep(this.wld, i, [w.x, w.y, w.z]);
    }
    const I = this.img, Wd = this.wld;
    if (![PTS.LSH, PTS.RSH, PTS.LHIP, PTS.RHIP, PTS.NOSE].every(i => I[i] && Wd[i])) return (this.out = null);
    const events = [];
    if (spin.event) events.push({ type: 'spin', dir: spin.direction, half_turns: spin.half_turns });
    const { L, F } = frame(Wd);
    const hip = mid(Wd[PTS.LHIP], Wd[PTS.RHIP]), sh = mid(Wd[PTS.LSH], Wd[PTS.RSH]);
    const head = Wd[PTS.LEAR] && Wd[PTS.REAR] ? mid(Wd[PTS.LEAR], Wd[PTS.REAR]) : Wd[PTS.NOSE];
    const torsoW = norm(sub(sh, hip)) || 0.5;

    // ── 4 verticality: the hip→head axis against vertical ──
    const ax = unit(sub(head, hip));
    const rawL = dot(ax, L), rawF = dot(ax, F);
    const tl = rawL - this.neutral.tiltL, tf = rawF - this.neutral.tiltF;
    const tilt = deg(Math.asin(Math.min(1, Math.hypot(tl, tf))));
    const vertical = { tilt, dir: deg(Math.atan2(tl, tf)), left: tl, forward: tf, rawL, rawF };   // dir: 0 forward, 90 her left

    // ── 1 spine: the bend between lower (hips→shoulders) and upper (shoulders→head) ──
    const lo = unit(sub(sh, hip)), up = unit(sub(head, sh)), d = sub(up, lo);
    const rawCurl = dot(d, F), rawBend = dot(d, L);
    const curl = rawCurl - this.neutral.curl, bend = rawBend - this.neutral.bend;
    const curve = deg(Math.acos(Math.max(-1, Math.min(1, dot(lo, up)))));

    // which end leads: image speeds of head and tail (hip mid), in torsos/s
    const torsoI = Math.hypot(...sub(mid(I[PTS.LSH], I[PTS.RSH]), mid(I[PTS.LHIP], I[PTS.RHIP])).slice(0, 2)) || 1;
    const headI = I[PTS.NOSE], tailI = mid(I[PTS.LHIP], I[PTS.RHIP]);
    const sp = (key, p) => {
      const prev = this['prev_' + key]; this['prev_' + key] = p;
      if (!prev) return 0;
      const v = norm(sub(p, prev)) / dt / torsoI, k = 1 - Math.exp(-dt / MD.speedS);
      return (this.speed[key] += k * (v - this.speed[key]));
    };
    const sH = sp('head', headI), sT = sp('tail', tailI);
    if (Math.max(sH, sT) < MD.restSpeed) { this.rest += dt; if (this.rest > MD.restHoldS) { this.armed = true; this.onset = null; } }
    else this.rest = 0;
    if (this.armed) {
      this.onset = this.onset || {};
      if (sH > MD.moveSpeed && this.onset.head == null) this.onset.head = t;
      if (sT > MD.moveSpeed && this.onset.tail == null) this.onset.tail = t;
      const o = this.onset, first = Math.min(o.head ?? 1e9, o.tail ?? 1e9);
      if (first < 1e9 && (o.head != null && o.tail != null || t - first > MD.leadWindowS)) {
        const lead = (o.head ?? 1e9) <= (o.tail ?? 1e9) ? 'head' : 'tail';
        const lag = o.head != null && o.tail != null ? Math.abs(o.head - o.tail) : MD.leadWindowS;
        this.lastLead = { lead, lag, t }; events.push({ type: 'lead', lead, lag });
        this.armed = false; this.onset = null;
      }
    }
    const spine = { curve, curl, bend, rawCurl, rawBend, speedHead: sH, speedTail: sT, lead: this.lastLead };

    // ── 2 head: nose relative to the ears, against the torso frame ──
    const earMid = Wd[PTS.LEAR] && Wd[PTS.REAR] ? mid(Wd[PTS.LEAR], Wd[PTS.REAR]) : head;
    const hv = sub(Wd[PTS.NOSE], earMid);
    const rawYaw = deg(Math.atan2(dot(hv, L), dot(hv, F)));
    const rawPitch = deg(Math.atan2(dot(hv, UP), Math.hypot(dot(hv, L), dot(hv, F))));
    const yaw = rawYaw - this.neutral.yaw, pitch = rawPitch - this.neutral.pitch;
    if (this.yawPrev !== null) this.yawRate += (1 - Math.exp(-dt / MD.turnS)) * ((yaw - this.yawPrev) / dt - this.yawRate);
    this.yawPrev = yaw;
    if (Math.abs(this.yawRate) > MD.turnRate && t - this.lastTurn > MD.turnGapS) {
      this.lastTurn = t; events.push({ type: 'turn', dir: Math.sign(this.yawRate), yaw });
    }
    const headOut = { yaw, pitch, rate: this.yawRate, rawYaw, rawPitch };

    // ── 3 elbows and knees: four distances in torso lengths ──
    const dist = (p, q) => (Wd[p] && Wd[q] ? norm(sub(Wd[p], Wd[q])) / torsoW : null);
    const pairs = { LL: dist(PTS.LEL, PTS.LKN), RR: dist(PTS.REL, PTS.RKN), LR: dist(PTS.LEL, PTS.RKN), RL: dist(PTS.REL, PTS.LKN) };
    for (const [k, v] of Object.entries(pairs)) {
      const on = v !== null && v < MD.contact;
      if (on && !this.contactPrev[k]) events.push({ type: 'contact', pair: k, crossed: k === 'LR' || k === 'RL' });
      this.contactPrev[k] = on;
    }

    // ── arms: reach = each wrist's distance from the trunk (the hips→shoulders segment), in torsos ──
    const fromTrunk = q => { const s0 = sub(sh, hip), u = Math.max(0, Math.min(1, dot(sub(q, hip), s0) / (dot(s0, s0) || 1)));
                             return norm(sub(q, add(hip, mul(s0, u)))) / torsoW; };
    const reachL = Wd[PTS.LWR] ? fromTrunk(Wd[PTS.LWR]) : null, reachR = Wd[PTS.RWR] ? fromTrunk(Wd[PTS.RWR]) : null;
    const rs = [reachL, reachR].filter(x => x !== null);                   // the more open arm counts most
    const reach = rs.length === 2 ? MD.reachOpen * Math.max(...rs) + (1 - MD.reachOpen) * Math.min(...rs) : rs.length ? rs[0] : null;
    const arms = { reachL, reachR, reach,
                   breath: reach === null ? null : Math.max(0, Math.min(1, (reach - MD.reachLow) / (MD.reachHigh - MD.reachLow))) };

    // ── quick movement: the fastest of head, elbows, wrists, knees and hips, in torsos/s ──
    // scaled by the body's largest visible segment (the torso alone shrinks when she lies down or turns),
    // and the SECOND fastest point, so one landmark that jumps is not a movement
    const seg = (i, j) => (I[i] && I[j] ? Math.hypot(I[i][0] - I[j][0], I[i][1] - I[j][1]) : 0);
    const bodyI = Math.max(torsoI, 1.4 * seg(PTS.LSH, PTS.RSH), seg(PTS.LHIP, PTS.LKN), seg(PTS.RHIP, PTS.RKN));
    const sp2 = [];
    for (const [k, p] of [...MOVERS.map(i => [i, I[i]]), ['hips', tailI]]) {
      if (!p) continue; const q = this.mPrev[k]; this.mPrev[k] = p;
      if (q) sp2.push(Math.min(MD.motionCap, norm(sub(p, q)) / dt / bodyI));
    }
    sp2.sort((x, y) => y - x);
    this.mSpeed += (1 - Math.exp(-dt / MD.motionS)) * ((sp2[1] ?? sp2[0] ?? 0) - this.mSpeed);
    const motion = { speed: this.mSpeed };

    // ── 5 circles: the direction of travel turning steadily, per point ──
    const circles = {};
    for (const [name, idx] of Object.entries(CIRCLE_POINTS)) {
      const p = idx === 'hips' ? tailI : I[idx]; if (!p) continue;
      const c = this.circ[name] = this.circ[name] || { prev: null, v: [0, 0], ang: null, hist: [], phase: 0, sign: 0, active: false, qturn: 0 };
      if (c.prev) {
        const k = 1 - Math.exp(-dt / MD.speedS), vel = [(p[0] - c.prev[0]) / dt / torsoI, (p[1] - c.prev[1]) / dt / torsoI];
        c.v = [c.v[0] + k * (vel[0] - c.v[0]), c.v[1] + k * (vel[1] - c.v[1])];
        const speed = Math.hypot(c.v[0], c.v[1]);
        // image y points down: negate it so positive turning = counter-clockwise as the viewer sees it
        const ang = Math.atan2(-c.v[1], c.v[0]);
        let dAng = 0;
        if (speed > MD.circleMinSpeed && c.ang !== null) dAng = wrap(ang - c.ang);
        c.ang = speed > MD.circleMinSpeed ? ang : null;
        c.hist.push([t, dAng, speed]); while (c.hist.length && c.hist[0][0] < t - MD.circleWindowS) c.hist.shift();
        const turned = c.hist.reduce((s, h) => s + h[1], 0), span = Math.max(1e-3, t - c.hist[0][0]);
        const rate = turned / span;                                  // rad/s, signed
        const active = Math.abs(turned) > MD.circleTurns * 2 * Math.PI;
        const sign = Math.sign(rate);
        // a reversal: the turning flips sign, either while circling or by restarting the
        // other way soon after (the turning cancels out for a moment as she reverses)
        const flipped = sign !== 0 && c.sign !== 0 && sign !== c.sign;
        if (active && flipped && (c.active || t - (c.lastActive ?? -1e9) < MD.reverseS)) events.push({ type: 'reverse', point: name, dir: sign });
        if (active) c.lastActive = t;
        if (active) {
          c.phase += dAng;
          const q = Math.floor(c.phase / (Math.PI / 2));
          if (q !== c.qturn) { events.push({ type: 'quarter', point: name, dir: Math.sign(q - c.qturn), size: speed / Math.max(0.5, Math.abs(rate)) }); c.qturn = q; }
        } else c.qturn = Math.floor(c.phase / (Math.PI / 2));
        if (active && !c.active && !(flipped && t - (c.lastActive ?? -1e9) < MD.reverseS)) events.push({ type: 'circle', point: name, dir: sign });
        c.active = active; if (active) c.sign = sign;
        circles[name] = { active, dir: c.sign, rate: rate / (2 * Math.PI), radius: active ? speed / Math.max(0.5, Math.abs(rate)) : 0,
                          phase: c.phase, speed };
      }
      c.prev = p;
    }
    return (this.out = { t, vertical, spine, head: headOut, pairs, arms, motion, circles, spin, events,
                         geo: { img: I, wld: Wd, hip, torsoW, torsoI, bodyI, headI, tailI } });
  }

  // one CSV row per frame (for recordings): the measured values, not the landmarks
  static csvHeader() {
    return 't,tilt,tilt_dir,tilt_left,tilt_forward,spine_curve,spine_curl,spine_bend,speed_head,speed_tail,lead,lead_lag,' +
           'head_yaw,head_pitch,head_rate,elbow_knee_LL,elbow_knee_RR,elbow_knee_LR,elbow_knee_RL,reach_L,reach_R,speed_max,' +
           'circle_lhand,circle_rhand,circle_head,circle_hips,spin_rate,events,' +
           'spin_half_turns,spin_progress_deg,spin_tracked,spin_hands_swap,spin_legs_swap,spin_face_visible,' +
           'spin_status,spin_left_halves,spin_right_halves';
  }
  static csvRow(o) {
    if (!o) return '';
    const f = x => (x === null || x === undefined ? '' : typeof x === 'number' ? x.toFixed(3) : x);
    const c = n => (o.circles[n] && o.circles[n].active ? f(o.circles[n].rate) : '0');
    const lead = o.events.find(e => e.type === 'lead');
    return [f(o.t), f(o.vertical.tilt), f(o.vertical.dir), f(o.vertical.left), f(o.vertical.forward), f(o.spine.curve), f(o.spine.curl),
            f(o.spine.bend), f(o.spine.speedHead), f(o.spine.speedTail), lead ? lead.lead : '', lead ? f(lead.lag) : '',
            f(o.head.yaw), f(o.head.pitch), f(o.head.rate), f(o.pairs.LL), f(o.pairs.RR), f(o.pairs.LR), f(o.pairs.RL),
            f(o.arms.reachL), f(o.arms.reachR), f(o.motion.speed),
            c('lhand'), c('rhand'), c('head'), c('hips'), f(o.spin.rate),
            o.events.map(e => e.type + (e.point ? ':' + e.point : e.pair ? ':' + e.pair : '')).join(' '),
            f(o.spin.half_turns), f(o.spin.progress_degrees), +o.spin.tracked, +o.spin.hands_swapped,
            +o.spin.legs_swapped, +o.spin.face_visible, o.spin.status,
            f(o.spin.left_half_turns), f(o.spin.right_half_turns)].join(',');
  }
}

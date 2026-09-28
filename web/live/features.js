// Live features: the same quantities as motion.py, computed causally.
//
// Offline we can look ahead (zero-phase filtering, centred windows). Live we
// only have the past, so every centred window becomes a trailing one and the
// zero-phase Butterworth becomes a One Euro filter, which smooths hard when
// a joint is slow (jitter) and lightly when it is fast (little lag).
// Every constant is documented in methods.html, section "Live".

export const J = { NOSE: 0, L_SH: 11, R_SH: 12, L_EL: 13, R_EL: 14, L_WR: 15, R_WR: 16,
                   L_HIP: 23, R_HIP: 24, L_KN: 25, R_KN: 26, L_AN: 27, R_AN: 28 };
export const PARTS = ['head', 'lhand', 'rhand', 'lfoot', 'rfoot'];
export const PART_J = [J.NOSE, J.L_WR, J.R_WR, J.L_AN, J.R_AN];
export const EDGES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24],
                      [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
const TRACKED = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

// References from the three Sep 21 clips (output/_motion/norm.json, and the
// pooled acceleration percentiles used for sudden events).
export const REF = {
  weight: [0.896, 36.35], time: [0.906, 45.28], flow: [4.13, 10.90],
  travel: 2.471, speed98: 10.20, accelThr: 18.41, accelTop: 119.4,
};

export const P = {           // tunables (the page exposes some as sliders)
  visMin: 0.5, maxGapS: 0.3, confTau: 0.1,
  euroMinCutoff: 1.2, euroBeta: 0.004, euroDCutoff: 1.0,
  // causal Savitzky–Golay: least-squares polynomial over the trailing window,
  // differentiated at its newest point (offline uses the centred version)
  vel: [0.23, 2], acc: [0.3, 2], jerk: [0.5, 3],      // [window s, degree]
  glitchTorsos: 1.2, glitchFrames: 3,
  torsoS: 5, torsoLongS: 60, floorS: 20, floorPct: 10,
  weightWinS: 0.25, weightTau: 0.06, boxS: 0.25, spaceS: 0.7, spaceTau: 0.08,
  flowK: 4, eventGap: 0.23,
  gain: { weight: 1, time: 1, flow: 1, space: 1 },   // sensitivities
};

const lp = (dt, hz) => 1 - Math.exp(-2 * Math.PI * hz * dt);
const clip = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// k-th derivative at τ = 0 of the degree-d least-squares fit to (τ_i, x_i)
function polyDeriv(ts, xs, d, k) {
  const n = d + 1, A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (let i = 0; i < ts.length; i++) {
    const pw = [1]; for (let q = 1; q < 2 * n; q++) pw.push(pw[q - 1] * ts[i]);
    for (let r = 0; r < n; r++) { for (let c = 0; c < n; c++) A[r][c] += pw[r + c]; A[r][n] += pw[r] * xs[i]; }
  }
  for (let c = 0; c < n; c++) {                       // Gaussian elimination
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    if (Math.abs(A[c][c]) < 1e-12) return 0;
    for (let r = 0; r < n; r++) if (r !== c) {
      const m = A[r][c] / A[c][c]; for (let q = c; q <= n; q++) A[r][q] -= m * A[c][q];
    }
  }
  let fact = 1; for (let q = 2; q <= k; q++) fact *= q;
  return fact * A[k][n] / A[k][k];
}

class OneEuro {            // Casiez, Roussel & Vogel, CHI 2012
  constructor() { this.x = null; this.dx = 0; }
  filter(x, dt) {
    if (this.x === null) { this.x = x; return x; }
    const dxRaw = (x - this.x) / dt;
    this.dx += lp(dt, P.euroDCutoff) * (dxRaw - this.dx);
    const fc = P.euroMinCutoff + P.euroBeta * Math.abs(this.dx);
    this.x += lp(dt, fc) * (x - this.x);
    return this.x;
  }
}

class Window {             // trailing window of (t, value) samples
  constructor(seconds) { this.s = seconds; this.t = []; this.v = []; }
  push(t, v) {
    this.t.push(t); this.v.push(v);
    while (this.t.length && this.t[0] < t - this.s) { this.t.shift(); this.v.shift(); }
  }
  mean() { let s = 0; for (const x of this.v) s += x; return this.v.length ? s / this.v.length : 0; }
  max() { let m = -Infinity; for (const x of this.v) m = Math.max(m, x); return this.v.length ? m : 0; }
  pct(q) { if (!this.v.length) return 0; const a = [...this.v].sort((x, y) => x - y);
           return a[Math.min(a.length - 1, Math.floor(q / 100 * a.length))]; }
  first() { return this.v[0]; }
}

export class Features {
  constructor() { this.reset(); }

  reset() {
    this.t = null;
    this.joint = {};
    for (const j of TRACKED) this.joint[j] = {
      ex: new OneEuro(), ey: new OneEuro(), p: null, v: [0, 0], a: [0, 0], jk: [0, 0], hist: [],
      conf: 0, missing: 1e9, glitch: 0,
    };
    this.torso = new Window(P.torsoS); this.torsoLong = new Window(P.torsoLongS);
    this.floor = PARTS.map(() => new Window(P.floorS)); this.floorVal = PARTS.map(() => 0);
    this.floorAt = 0;
    this.E = new Window(P.weightWinS); this.weightS = 0;
    this.acc = new Window(P.boxS); this.aSum = new Window(P.boxS); this.jSum = new Window(P.boxS);
    this.flowBox = new Window(P.boxS);
    this.hands = [new Window(P.spaceS), new Window(P.spaceS)];   // step lengths
    this.handPos = [new Window(P.spaceS), new Window(P.spaceS)];
    this.spaceS = 0.5;
    this.armed = PARTS.map(() => true); this.peak = PARTS.map(() => 0);
    this.lastEvent = PARTS.map(() => -1e9); this.prevA = PARTS.map(() => 0);
    this.out = null;
  }

  // lms: 33 normalised landmarks {x, y, visibility}; t in seconds
  update(lms, t, W, H) {
    const dt = this.t === null ? 1 / 30 : Math.max(1e-3, Math.min(0.2, t - this.t));
    this.t = t;
    const ell = this.torso.v.length ? this.torsoLen() : 0.25 * H;
    const events = [];

    for (const j of TRACKED) {
      const s = this.joint[j], m = lms && lms[j];
      const seen = m && (m.visibility ?? 1) >= P.visMin;
      let x = seen ? m.x * W : null, y = seen ? m.y * H : null;
      // glitch guard: a jump no body can make in one frame is the tracker, not her
      if (seen && s.p && Math.hypot(x - s.p[0], y - s.p[1]) > P.glitchTorsos * ell
          && s.glitch < P.glitchFrames) { s.glitch++; x = null; }
      else if (seen) s.glitch = 0;
      if (x === null) { s.missing += dt; }
      else {
        s.missing = 0;
        const p = [s.ex.filter(x, dt), s.ey.filter(y, dt)];
        s.hist.push([t, p[0], p[1]]);
        while (s.hist[0][0] < t - P.jerk[0]) s.hist.shift();
        const fit = ([win, deg], k) => {
          const h = s.hist.filter(q => q[0] >= t - win - 1e-6);
          if (h.length < deg + 2) return null;
          const ts = h.map(q => q[0] - t);
          return [polyDeriv(ts, h.map(q => q[1]), deg, k), polyDeriv(ts, h.map(q => q[2]), deg, k)];
        };
        s.v = fit(P.vel, 1) || s.v; s.a = fit(P.acc, 2) || s.a; s.jk = fit(P.jerk, 3) || s.jk;
        s.p = p;
      }
      const target = s.missing <= P.maxGapS && s.p ? 1 : 0;
      s.conf += lp(dt, 1 / (2 * Math.PI * P.confTau)) * (target - s.conf);
      if (s.missing > P.maxGapS) { s.v = [0, 0]; s.a = [0, 0]; s.jk = [0, 0]; s.hist = []; }
    }

    const g = j => this.joint[j];
    if (!g(J.L_SH).p || !g(J.L_HIP).p || !g(J.R_SH).p || !g(J.R_HIP).p) return null;
    const mid = (a, b) => [(g(a).p[0] + g(b).p[0]) / 2, (g(a).p[1] + g(b).p[1]) / 2];
    const sho = mid(J.L_SH, J.R_SH), hip = mid(J.L_HIP, J.R_HIP);
    const tl = Math.hypot(sho[0] - hip[0], sho[1] - hip[1]);
    this.torso.push(t, tl); this.torsoLong.push(t, tl);
    const L = this.torsoLen();

    const norm2 = v => Math.hypot(v[0], v[1]);
    const spd = [], acc = [], jrk = [];
    PART_J.forEach((j, e) => {
      const s = g(j);
      spd.push(s.conf * norm2(s.v) / L); acc.push(s.conf * norm2(s.a) / L);
      jrk.push(s.conf * norm2(s.jk) / L);
    });
    // jitter floor: each limb's resting reading, subtracted in quadrature
    spd.forEach((x, e) => this.floor[e].push(t, x));
    if (t - this.floorAt > 0.5) {
      this.floorVal = this.floor.map(w => w.pct(P.floorPct)); this.floorAt = t;
    }
    const s = spd.map((x, e) => Math.sqrt(Math.max(0, x * x - this.floorVal[e] ** 2)));

    const pv = [(g(J.L_HIP).v[0] + g(J.R_HIP).v[0]) / 2 / L, (g(J.L_HIP).v[1] + g(J.R_HIP).v[1]) / 2 / L];
    const pel = norm2(pv);

    // Weight: peak kinetic energy over the last 0.5 s
    this.E.push(t, s.reduce((q, x) => q + x * x, 0) + 2 * pel * pel);
    this.weightS += lp(dt, 1 / (2 * Math.PI * P.weightTau)) * (Math.sqrt(this.E.max()) - this.weightS);
    // Time: mean acceleration; Flow: jerk relative to acceleration
    this.acc.push(t, acc.reduce((q, x) => q + x, 0) / 5);
    this.aSum.push(t, acc.slice(1).reduce((q, x) => q + x, 0));
    this.jSum.push(t, jrk.slice(1).reduce((q, x) => q + x, 0));
    this.flowBox.push(t, this.jSum.mean() / (this.aSum.mean() + P.flowK));
    // Space: straightness of each hand's last second
    let num = 0, den = 0;
    [J.L_WR, J.R_WR].forEach((j, k) => {
      if (!g(j).p) return;
      this.hands[k].push(t, norm2(g(j).v) * dt / L);
      this.handPos[k].push(t, g(j).p.slice());
      const path = this.hands[k].v.reduce((q, x) => q + x, 0);
      const p0 = this.handPos[k].first(), p1 = g(j).p;
      const d = clip(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / L / Math.max(path, 1e-6));
      num += d * path; den += path;
    });
    if (den > 0.4) this.spaceS += lp(dt, 1 / (2 * Math.PI * P.spaceTau)) * (num / den - this.spaceS);

    // sudden events: a limb's acceleration crossing the threshold, fired at its peak
    const thr = REF.accelThr / P.gain.time;
    for (let e = 1; e < 5; e++) {
      const a = acc[e];
      if (a < 0.5 * thr) this.armed[e] = true;
      if (this.armed[e] && a > thr) this.peak[e] = Math.max(this.peak[e], a);
      if (this.peak[e] > 0 && a < this.prevA[e] && t - this.lastEvent[e] > P.eventGap) {
        const str = Math.min(1, (this.peak[e] - thr) / (REF.accelTop - thr) + 0.25);
        events.push({ part: PARTS[e], strength: str, x: g(PART_J[e]).p[0] / W });
        this.lastEvent[e] = t; this.armed[e] = false; this.peak[e] = 0;
      }
      this.prevA[e] = a;
    }

    const n = (x, [lo, hi], k = 1) => clip(k * (x - lo) / (hi - lo));
    this.out = {
      t, L, events,
      speed: s, nspeed: s.map(x => clip(x / REF.speed98)), accel: acc,
      weight: n(this.weightS, REF.weight, P.gain.weight),
      time: n(this.acc.mean(), REF.time, P.gain.time),
      flow: n(this.flowBox.mean(), REF.flow, P.gain.flow),
      space: clip(0.5 + (this.spaceS - 0.5) * P.gain.space),
      travel: clip((pv[0] + REF.travel) / (2 * REF.travel)),
      pos: j => g(j).p, conf: j => g(j).conf, vel: j => g(j).v,
    };
    return this.out;
  }

  torsoLen() {
    const long = this.torsoLong.pct(50);
    return clip(this.torso.pct(50), 0.6 * long, 1.4 * long);
  }
}

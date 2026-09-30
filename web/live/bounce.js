// Is she bouncing, and where in the bounce is she? A discrete Bayesian filter
// over (tempo, phase), in the family of the "bar pointer" beat trackers
// (Whiteley, Cemgil & Godsill 2006; Krebs, Böck & Widmer 2015), observing
// only the vertical position of the hips.
//
//   state      tempo period T_j (log-spaced, 50–180 bpm) × phase φ_k ∈ [0, 1)
//   transition φ ← φ + Δt/T  (+ a little phase diffusion), T random-walks
//              to its neighbours, and a small leak to uniform lets it re-lock
//   observation  z = hip height, detrended and scaled to unit amplitude,
//              z | φ ~ N(−cos 2πφ, σ²)      (φ = 0 is the bottom: the beat)
//   bottoms    the beat is not assumed to sit at φ = 0: the hip height is
//              averaged per phase bin of the model, and the beat is placed at
//              that profile's minimum, so a quick drop and slow rise still
//              puts the beat on the real bottom
//   evidence   a running Bayes factor of this model against "not bouncing",
//              z ~ N(0, ½), with forgetting, gives P(bouncing)
//
// All times in seconds on one clock (the camera frames' capture times).

export const B = {
  bpmLo: 50, bpmHi: 180, nT: 40, nP: 48,
  sigma: 0.45, tempoStep: 0.04, phaseDiff: 0.01, leak: 0.002,
  corrS: 0.1,               // evidence per frame is tempered: frames are not independent
  forgetS: 3, prior: 0.2,   // Bayes-factor memory, prior probability of bouncing
  detrendS: 2, ampS: 3, ampMin: 0.02,
  warmS: 1.5,               // no evidence until this much history
  bottomRate: 0.15, shapeFrom: 0.7,  // phase-profile averaging rate, and the P it needs
};

const TAU = 2 * Math.PI;

export class Bounce {
  constructor() { this.reset(); }

  reset() {
    this.T = Array.from({ length: B.nT }, (_, j) =>
      60 / B.bpmHi * Math.pow(B.bpmHi / B.bpmLo, j / (B.nT - 1)));
    this.p = new Float64Array(B.nT * B.nP).fill(1 / (B.nT * B.nP));
    this.cos = Float64Array.from({ length: B.nP }, (_, k) => Math.cos(TAU * k / B.nP));
    this.hist = []; this.t = null; this.t0 = null; this.logBF = 0; this.amp = 0;
    this.h = Float64Array.from(this.cos, c => -c);            // observation mean −cos 2πφ
    this.beatPhase = 0;
    this.prof = Float64Array.from(this.cos, c => -c); this.profN = new Float64Array(B.nP);
    this.out = { prob: 0, tempo: 0, period: 0.6, phase: 0, nextBeat: null, amp: 0, z: 0 };
  }

  // y: hip height in torso lengths (up positive), t: seconds
  update(y, t) {
    const dt = this.t === null ? 1 / 30 : Math.min(0.25, Math.max(1e-3, t - this.t));
    this.t = t; if (this.t0 === null) this.t0 = t;
    // detrend (trailing mean) and scale by the trailing RMS
    this.hist.push([t, y]);
    while (this.hist[0][0] < t - Math.max(B.detrendS, B.ampS)) this.hist.shift();
    let m = 0, n = 0; for (const [ti, yi] of this.hist) if (ti >= t - B.detrendS) { m += yi; n++; }
    m /= n;
    let v = 0, nv = 0; for (const [ti, yi] of this.hist) if (ti >= t - B.ampS) { v += (yi - m) ** 2; nv++; }
    this.amp = Math.sqrt(v / nv);
    const z = (y - m) / (Math.SQRT2 * this.amp + 1e-4);

    this.predict(dt);

    // likelihood under the bounce model, and the model evidence
    const { nT, nP } = B, s2 = B.sigma * B.sigma;
    const w = t - this.t0 < B.warmS ? 0 : Math.min(1, dt / B.corrS);
    const lik = new Float64Array(nP);
    for (let k = 0; k < nP; k++) lik[k] = Math.exp(-((z - this.h[k]) ** 2) / (2 * s2)) / Math.sqrt(TAU * s2);
    let ev1 = 0;
    for (let j = 0; j < nT; j++) for (let k = 0; k < nP; k++) ev1 += this.p[j * nP + k] * lik[k];
    const ev0 = Math.exp(-(z * z)) / Math.sqrt(Math.PI);              // N(0, ½)
    const lam = Math.exp(-dt / B.forgetS);
    this.logBF = lam * this.logBF + w * (Math.log(ev1 + 1e-300) - Math.log(ev0 + 1e-300));
    // posterior over (tempo, phase), with the tempered likelihood
    let tot = 0;
    for (let j = 0; j < nT; j++) for (let k = 0; k < nP; k++) {
      const q = this.p[j * nP + k] * Math.pow(lik[k], w); this.p[j * nP + k] = q; tot += q;
    }
    for (let i = 0; i < this.p.length; i++) this.p[i] /= tot;

    // read out: most probable tempo, circular mean of phase within it
    let bj = 0, bm = -1;
    for (let j = 0; j < nT; j++) { let s = 0; for (let k = 0; k < nP; k++) s += this.p[j * nP + k]; if (s > bm) { bm = s; bj = j; } }
    let c = 0, sn = 0;
    for (let k = 0; k < nP; k++) { const q = this.p[bj * nP + k]; c += q * this.cos[k]; sn += q * Math.sin(TAU * k / nP); }
    const phase = ((Math.atan2(sn, c) / TAU) + 1) % 1;
    const T = this.T[bj];
    // where the real bottom falls in the model's phase: average z in each
    // phase bin (not fed back into the likelihood, so it cannot chase itself),
    // and place the beat at the lowest point of that profile. Averaging over
    // many cycles removes tracker noise; the profile keeps the bounce's shape.
    const probNow = 1 / (1 + Math.exp(-(this.logBF + Math.log(B.prior / (1 - B.prior)))));
    if (probNow > B.shapeFrom && w > 0) {
      const x = phase * nP, k0 = Math.floor(x), f = x - k0;
      for (const [kk, wt] of [[k0 % nP, 1 - f], [(k0 + 1) % nP, f]]) {
        this.prof[kk] += B.bottomRate * wt * (z - this.prof[kk]); this.profN[kk] += wt;
      }
      if (this.profN.every(c => c > 0.5)) {
        const sm = k => this.prof[k];
        let km = 0; for (let k = 1; k < nP; k++) if (sm(k) < sm(km)) km = k;
        const y0 = sm((km + nP - 1) % nP), y1 = sm(km), y2 = sm((km + 1) % nP);
        const off = (y0 - 2 * y1 + y2) > 1e-9 ? 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2) : 0;
        this.beatPhase = (((km + off) / nP) % 1 + 1) % 1;
      }
    }
    const toBeat = ((this.beatPhase - phase) % 1 + 1) % 1;
    const gate = Math.min(1, Math.max(0, (this.amp - B.ampMin) / B.ampMin));   // not moving: not bouncing
    const prior = Math.log(B.prior / (1 - B.prior));
    const prob = gate / (1 + Math.exp(-(this.logBF + prior)));
    this.out = { prob, tempo: 60 / T, period: T, phase, beatPhase: this.beatPhase,
                 nextBeat: t + (toBeat < 1e-3 ? 1 : toBeat) * T, template: this.h,
                 amp: this.amp, z, conc: Math.hypot(c, sn) };
    return this.out;
  }

  predict(dt) {
    const { nT, nP } = B, q = new Float64Array(this.p.length);
    for (let j = 0; j < nT; j++) {
      const shift = dt / this.T[j] * nP, s0 = Math.floor(shift), f = shift - s0;
      for (let k = 0; k < nP; k++) {
        const v = this.p[j * nP + k]; if (v === 0) continue;
        const k1 = (k + s0) % nP, k2 = (k + s0 + 1) % nP;
        q[j * nP + k1] += v * (1 - f); q[j * nP + k2] += v * f;
      }
    }
    // phase diffusion, tempo random walk, leak to uniform
    const d = B.phaseDiff, e = B.tempoStep, u = B.leak / (nT * nP);
    for (let j = 0; j < nT; j++) for (let k = 0; k < nP; k++) {
      const at = (jj, kk) => q[jj * nP + ((kk + nP) % nP)];
      const ph = (1 - 2 * d) * at(j, k) + d * (at(j, k - 1) + at(j, k + 1));
      const jl = Math.max(0, j - 1), jh = Math.min(nT - 1, j + 1);
      const tm = e * (at(jl, k) + at(jh, k)) - 2 * e * at(j, k);
      this.p[j * nP + k] = (1 - B.leak) * (ph + tm) + u;
    }
  }
}

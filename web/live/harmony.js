// Pose → chord, the same rules as harmony.py, with the dwell measured in
// seconds instead of frames (a live camera does not keep a fixed rate).
import { J } from './features.js';

export const H = { dwellS: 0.35, downAt: 0.5, sideMargin: 0.15, homeMargin: 0.05,
                   altOn: 0.55, altOff: 0.4, altMinS: 0.5 };

export const CHORDS = {
  ii:   { symbol: 'Dm9',    degree: 'ii', bass: 38, voices: [53, 57, 60, 64] },
  V:    { symbol: 'G13',    degree: 'V',  bass: 43, voices: [53, 57, 59, 64] },
  Valt: { symbol: 'G7alt',  degree: 'V',  bass: 43, voices: [53, 56, 59, 63] },
  I:    { symbol: 'Cmaj9',  degree: 'I',  bass: 36, voices: [52, 55, 59, 62] },
  Am:   { symbol: 'Am add9', degree: '',  bass: 45, voices: [57, 60, 64, 71] },
};

// which rule the pose satisfies now: 'V', 'ii', 'I' or ''
export function readPose(f) {
  const p = f.pos, ok = [J.L_WR, J.R_WR, J.L_AN, J.R_AN, J.L_HIP, J.R_HIP].every(j => p(j) && f.conf(j) > 0.5);
  if (!ok) return { rule: '', guides: null };
  const L = f.L, lw = p(J.L_WR), rw = p(J.R_WR), la = p(J.L_AN), ra = p(J.R_AN);
  const hip = [(p(J.L_HIP)[0] + p(J.R_HIP)[0]) / 2, (p(J.L_HIP)[1] + p(J.R_HIP)[1]) / 2];
  const kneeY = p(J.L_KN) && p(J.R_KN) ? (p(J.L_KN)[1] + p(J.R_KN)[1]) / 2 : hip[1] + L;
  const downY = hip[1] + H.downAt * (kneeY - hip[1]);
  const m = H.sideMargin * L, lo = Math.min(la[0], ra[0]) - m, hi = Math.max(la[0], ra[0]) + m;
  const ax = [p(J.L_HIP)[0] - p(J.R_HIP)[0], p(J.L_HIP)[1] - p(J.R_HIP)[1]];
  const width = Math.hypot(ax[0], ax[1]), u = [ax[0] / (width || 1), ax[1] / (width || 1)];
  const lat = q => ((q[0] - hip[0]) * u[0] + (q[1] - hip[1]) * u[1]) / L;
  const hm = H.homeMargin;
  const guides = { downY, lo, hi, hip, u, L };
  if (lw[1] > downY && rw[1] > downY) return { rule: 'V', guides };
  if ((lw[0] < lo && rw[0] < lo) || (lw[0] > hi && rw[0] > hi)) return { rule: 'ii', guides };
  if (lat(lw) > hm && lat(rw) < -hm && lat(la) > hm && lat(ra) < -hm && width > 0.25 * L)
    return { rule: 'I', guides };
  return { rule: '', guides };
}

export class ChordFollower {
  constructor(mode = 'twofive') { this.mode = mode; this.reset(); }
  reset() { this.cur = 'I'; this.run = ''; this.since = 0; this.hot = false; this.hotSince = -1e9;
            this.shown = this.mode === 'fixed' ? 'Am' : 'I'; this.shownSince = 0; }
  // returns the chord key sounding now
  update(f, t) {
    const r = readPose(f);
    this.last = r;
    if (this.mode === 'fixed') return (this.shown = 'Am');
    if (r.rule !== this.run) { this.run = r.rule; this.since = t; }
    if (this.run && this.run !== this.cur && t - this.since >= H.dwellS) this.cur = this.run;
    let want = this.cur;
    if (this.mode === 'twofive_alt' && this.cur === 'V') {
      const on = this.hot ? f.weight > H.altOff : f.weight > H.altOn;
      if (on !== this.hot && t - this.hotSince >= H.altMinS) { this.hot = on; this.hotSince = t; }
      if (this.hot) want = 'Valt';
    }
    if (want !== this.shown) { this.shown = want; this.shownSince = t; }
    return this.shown;
  }
}

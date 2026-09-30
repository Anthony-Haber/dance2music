// Pose → chord, the same rules as harmony.py, with the dwell measured in
// seconds instead of frames (a live camera does not keep a fixed rate).
import { J } from './features.js';

export const H = { dwellS: 0.35, dwell6S: 0.5, centreBand: 0.35, raisedAt: -0.5, wideAt: 1.8,
                   wideBelow: 0.5, downAt: 0.5, sideMargin: 0.15, homeMargin: 0.05,
                   altOn: 0.55, altOff: 0.4, altMinS: 0.5 };

export const CHORDS = {
  ii:   { symbol: 'Dm9',    degree: 'ii', bass: 38, voices: [53, 57, 60, 64] },
  V:    { symbol: 'G13',    degree: 'V',  bass: 43, voices: [53, 57, 59, 64] },
  Valt: { symbol: 'G7alt',  degree: 'V',  bass: 43, voices: [53, 56, 59, 63] },
  I:    { symbol: 'Cmaj9',  degree: 'I',  bass: 36, voices: [52, 55, 59, 62] },
  Am:   { symbol: 'Am add9', degree: '',  bass: 45, voices: [57, 60, 64, 71] },
};

// six chords, voice-led (harmony.py · SIX): pitch classes, not fixed voicings
export const SIX = {
  I:   { symbol: 'Cmaj9',   degree: 'I',   bass: 36, pcs: [4, 7, 11, 2] },
  ii:  { symbol: 'Dm9',     degree: 'ii',  bass: 38, pcs: [5, 9, 0, 4] },
  iii: { symbol: 'Em7(11)', degree: 'iii', bass: 40, pcs: [7, 11, 2, 9] },
  IV:  { symbol: 'Fmaj9',   degree: 'IV',  bass: 41, pcs: [9, 0, 4, 7] },
  V:   { symbol: 'G13',     degree: 'V',   bass: 43, pcs: [11, 4, 5, 9] },
  vi:  { symbol: 'Am9',     degree: 'vi',  bass: 45, pcs: [0, 4, 7, 11] },
};
export const chordInfo = (mode, key) => (mode === 'six' ? SIX[key] : CHORDS[key]);

function* perms(a) { if (a.length <= 1) { yield a; return; }
  for (let i = 0; i < a.length; i++) for (const r of perms([...a.slice(0, i), ...a.slice(i + 1)])) yield [a[i], ...r]; }

// least total motion from `prev` to the pitch classes, inside [lo, hi]
export function voiceLead(prev, pcs, lo = 50, hi = 70) {
  let best = null;
  for (const perm of perms(pcs)) {
    const out = prev.map((p, i) => {
      let m = p + (((perm[i] - p) % 12) + 12) % 12;
      if (m - p > 6) m -= 12;
      while (m < lo) m += 12; while (m > hi) m -= 12;
      return m;
    });
    const tot = out.reduce((q, m, i) => q + Math.abs(m - prev[i]), 0);
    const mx = Math.max(...out.map((m, i) => Math.abs(m - prev[i])));
    if (!best || tot < best.tot || (tot === best.tot && mx < best.mx)) best = { tot, mx, out };
  }
  return best.out;
}

// which of the six regions the hands' midpoint is in
export function readRegions(f) {
  const p = f.pos, ok = [J.L_WR, J.R_WR, J.L_SH, J.R_SH, J.L_HIP, J.R_HIP].every(j => p(j) && f.conf(j) > 0.5);
  if (!ok) return { rule: '', guides: null };
  const L = f.L, m2 = (a, b) => [(p(a)[0] + p(b)[0]) / 2, (p(a)[1] + p(b)[1]) / 2];
  const sh = m2(J.L_SH, J.R_SH), hp = m2(J.L_HIP, J.R_HIP), c = [(sh[0] + hp[0]) / 2, (sh[1] + hp[1]) / 2];
  const hb = m2(J.L_WR, J.R_WR);
  const lam = (hb[0] - c[0]) / L, mu = (hb[1] - c[1]) / L;     // + = her left (camera's right), + = down
  const spread = Math.hypot(p(J.L_WR)[0] - p(J.R_WR)[0], p(J.L_WR)[1] - p(J.R_WR)[1]) / L;
  let rule;
  if (Math.abs(lam) < H.centreBand) rule = (mu < H.raisedAt || (spread > H.wideAt && mu < H.wideBelow)) ? 'IV' : 'I';
  else if (lam > 0) rule = mu < 0 ? 'vi' : 'ii';
  else rule = mu < 0 ? 'iii' : 'V';
  return { rule, guides: { six: true, c, hb, L } };
}

// fingers raised on both hands together: 1 → I … 5 → V, 6+ → vi; 0 (fists) holds
const BY_COUNT = ['', 'I', 'ii', 'iii', 'IV', 'V', 'vi'];
export function readFingers(hands) {
  if (!hands || !hands.anySeen()) return { rule: '', guides: null };
  return { rule: BY_COUNT[Math.min(6, hands.total())], guides: null };
}

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
  constructor(mode = 'six') { this.mode = mode; this.reset(); }
  reset() { this.cur = 'I'; this.run = ''; this.since = 0; this.hot = false; this.hotSince = -1e9;
            this.shown = this.mode === 'fixed' ? 'Am' : 'I'; this.shownSince = 0;
            this.voicing = [52, 55, 59, 62]; }
  // the chord sounding now, as {key, symbol, degree, bass, voices}
  chord() {
    if (this.mode === 'six' || this.mode === 'fingers') return { key: this.shown, ...SIX[this.shown], voices: this.voicing };
    return { key: this.shown, ...CHORDS[this.shown] };
  }
  // returns the chord key sounding now
  // hands: live hand state (for the fingers mode); frozen: a gesture holds the chord
  update(f, t, hands = null, frozen = false) {
    const fingers = this.mode === 'fingers', six = this.mode === 'six' || fingers;
    const r = fingers ? readFingers(hands) : this.mode === 'six' ? readRegions(f) : readPose(f);
    this.last = r;
    if (this.mode === 'fixed') return (this.shown = 'Am');
    if (r.rule !== this.run) { this.run = r.rule; this.since = t; }
    if (!frozen && this.run && this.run !== this.cur && t - this.since >= (six ? H.dwell6S : H.dwellS)) {
      this.cur = this.run;
      if (six) this.voicing = voiceLead(this.voicing, SIX[this.cur].pcs);
    }
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

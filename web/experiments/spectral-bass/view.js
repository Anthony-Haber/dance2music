// Spectral bass: the body (faint), the hands' strokes, and the spectrum as it sounds.
const J = { LSH: 11, RSH: 12, LEL: 13, REL: 14, LWR: 15, RWR: 16, LHIP: 23, RHIP: 24, LKN: 25, RKN: 26 };
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const noteName = m => NAMES[m % 12] + (Math.floor(m / 12) - 1);

export class View {
  constructor(canvas) { this.cv = canvas; this.g = canvas.getContext('2d'); this.flash = []; }

  // f: the frame (measure.js); c: controls; spec: the spectrum sounding; note: MIDI; strokes: this frame's
  draw(f, k, mirror, c, spec, note, strokes, hands = null) {
    const g = this.g, cv = this.cv, now = performance.now(), d = devicePixelRatio || 1;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
    if (f) {
      g.setTransform(mirror ? -k : k, 0, 0, k, mirror ? cv.width : 0, 0);
      const I = f.geo.img, s = 1 / k;
      const line = (a, b, col, w) => { if (!a || !b) return; g.strokeStyle = col; g.lineWidth = w * s; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); };
      for (const [a, b] of [[J.LSH, J.RSH], [J.LSH, J.LHIP], [J.RSH, J.RHIP], [J.LHIP, J.RHIP], [J.LHIP, J.LKN], [J.RHIP, J.RKN]])
        line(I[a], I[b], 'rgba(235,230,220,.3)', 1.5);
      // the arms carry the spectrum: brighter as they rise, the span between the hands drawn
      const col = `hsla(${40 - 30 * c.bright}, 90%, ${55 + 20 * c.bright}%, ${0.5 + 0.5 * c.bright})`;
      for (const [a, b, w] of [[J.LSH, J.LEL, J.LWR], [J.RSH, J.REL, J.RWR]]) { line(I[a], I[b], col, 3); line(I[b], I[w], col, 3); }
      if (I[J.LWR] && I[J.RWR]) { g.setLineDash([6 * s, 6 * s]); line(I[J.LWR], I[J.RWR], `rgba(120,200,255,${0.3 + 0.6 * c.peak})`, 2); g.setLineDash([]); }
      // hands: the landmarks the hand model found, and a ring at the wrist as wide as the hand is open
      if (hands) for (const [side, j] of [['left', J.LWR], ['right', J.RWR]]) {
        const h = hands[side], w = I[j]; if (!w) continue;
        if (h.lm) { g.fillStyle = 'rgba(255,255,255,.8)'; for (const p of h.lm) { g.beginPath(); g.arc(p[0], p[1], 1.8 * s, 0, 7); g.fill(); } }
        g.strokeStyle = h.seen ? `rgba(255,240,200,${0.4 + 0.6 * h.open})` : 'rgba(255,255,255,.25)'; g.lineWidth = 2.5 * s;
        g.setLineDash(h.seen ? [] : [4 * s, 4 * s]); g.beginPath(); g.arc(w[0], w[1], (8 + 26 * h.open) * s, 0, 7); g.stroke(); g.setLineDash([]);
      }
      for (const e of strokes) this.flash.push({ e, at: now, p: I[e.hand === 'left' ? J.LWR : J.RWR] });
      this.flash = this.flash.filter(x => now - x.at < 600);
      for (const { e, at, p } of this.flash) {
        if (!p) continue; const a = 1 - (now - at) / 600, L = 60 * s, y = p[1] - e.dir * L * (1 - a);
        g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = 4 * s;
        g.beginPath(); g.moveTo(p[0], y + e.dir * L * 0.5); g.lineTo(p[0], y - e.dir * L * 0.5); g.stroke();
        g.beginPath(); g.moveTo(p[0] - 12 * s, y - e.dir * (L * 0.5 - 14 * s)); g.lineTo(p[0], y - e.dir * L * 0.5); g.lineTo(p[0] + 12 * s, y - e.dir * (L * 0.5 - 14 * s)); g.stroke();
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (spec) this.spectrum(spec, note, d);
  }

  // the partials as bars on a log-frequency axis, in dB; the note name; the peak's place
  spectrum({ freqs, gains, fc }, note, d) {
    const g = this.g, W = this.cv.width, H = this.cv.height, h = Math.min(170 * d, H * 0.28), y0 = H - 14 * d, x0 = 16 * d, x1 = W - 16 * d;
    const fx = f => x0 + (x1 - x0) * Math.log(f / 30) / Math.log(10000 / 30);
    g.save(); g.fillStyle = 'rgba(10,10,10,.55)'; g.fillRect(0, y0 - h - 34 * d, W, h + 48 * d);
    gains.forEach((a, i) => {
      if (!a || freqs[i] > 10000) return;
      const db = 20 * Math.log10(a), v = Math.max(0, (db + 60) / 60), x = fx(freqs[i]);
      g.fillStyle = `hsla(${200 - 170 * Math.min(1, i / 24)}, 85%, 62%, .9)`;
      g.fillRect(x - 1.5 * d, y0 - v * h, 3 * d, v * h);
    });
    g.strokeStyle = 'rgba(120,200,255,.7)'; g.setLineDash([4 * d, 4 * d]); g.beginPath(); g.moveTo(fx(fc), y0 - h); g.lineTo(fx(fc), y0); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#efe9df'; g.font = `600 ${26 * d}px -apple-system, sans-serif`; g.textBaseline = 'bottom';
    g.fillText(noteName(note), x0, y0 - h - 6 * d);
    g.fillStyle = '#9a9086'; g.font = `${12 * d}px -apple-system, sans-serif`;
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000]) g.fillText(f >= 1000 ? f / 1000 + 'k' : f, fx(f) - 8 * d, y0 + 13 * d);
    g.restore();
  }
}

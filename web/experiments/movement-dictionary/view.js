// Movement Dictionary: what is measured, drawn on the body (video pixels).
const COL = { axis: '#78dc78', warn: '#ffaa50', hot: '#fa6060', spine: '#c8b4ff', head: '#5ab4ff', pair: '#f0a050', circle: '#5ac8c8', dim: 'rgba(235,230,220,.35)' };
const lerpCol = u => (u < 0.5 ? COL.axis : u < 0.8 ? COL.warn : COL.hot);
const VCOL = { bass: 'rgba(120,220,120,1)', tenor: 'rgba(200,180,255,1)', alto: 'rgba(240,160,80,1)', soprano: 'rgba(90,180,255,1)' };
const OWNER_LABEL = { bass: 'axis', tenor: 'spine', alto: 'elbows, knees', soprano: 'head' };
const CHORD_NAME = { I: 'D', ii: 'Em', iii: 'F♯m', IV: 'G', V: 'A', vi: 'Bm', 'vii°': 'C♯°' };
const J = { NOSE: 0, LSH: 11, RSH: 12, LEL: 13, REL: 14, LWR: 15, RWR: 16, LHIP: 23, RHIP: 24, LKN: 25, RKN: 26 };

export class View {
  constructor(canvas) { this.cv = canvas; this.g = canvas.getContext('2d'); this.trails = {}; this.flash = []; }

  // f: the frame from measure.js; S: studies and switches; k: pixel scale (canvas px per video px)
  draw(f, S, k, mirror, choir = null) {
    const g = this.g, cv = this.cv;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
    if (!f) return;
    g.setTransform(mirror ? -k : k, 0, 0, k, mirror ? cv.width : 0, 0);
    const I = f.geo.img, P = j => I[j], s = 1 / k, now = performance.now();
    const line = (a, b, col, w) => { if (!a || !b) return; g.strokeStyle = col; g.lineWidth = w * s; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); };
    const dot = (p, col, r) => { if (!p) return; g.fillStyle = col; g.beginPath(); g.arc(p[0], p[1], r * s, 0, 7); g.fill(); };
    const label = (p, text, col) => { if (!p) return; g.save(); g.translate(p[0], p[1]); if (mirror) g.scale(-1, 1);
      g.font = `600 ${15 * s}px -apple-system, sans-serif`; g.fillStyle = col; g.fillText(text, 12 * s, -8 * s); g.restore(); };
    const hip = f.geo.tailI, head = f.geo.headI, sh = P(J.LSH) && P(J.RSH) ? [(P(J.LSH)[0] + P(J.RSH)[0]) / 2, (P(J.LSH)[1] + P(J.RSH)[1]) / 2] : null;
    // a faint body for orientation
    for (const [a, b] of [[J.LSH, J.RSH], [J.LSH, J.LEL], [J.LEL, J.LWR], [J.RSH, J.REL], [J.REL, J.RWR], [J.LSH, J.LHIP], [J.RSH, J.RHIP], [J.LHIP, J.RHIP], [J.LHIP, J.LKN], [J.RHIP, J.RKN]])
      line(P(a), P(b), COL.dim, 1.5);
    // 4 verticality: the axis, and a plumb line from the hips
    if (S.vertical) {
      const u = Math.min(1, f.vertical.tilt / 45), L = f.geo.torsoI * 1.6;
      line(hip, [hip[0], hip[1] - L], 'rgba(255,255,255,.25)', 1.5);
      line(hip, head, lerpCol(u), 5); dot(hip, lerpCol(u), 6);
      const side = f.vertical.tilt < 4 ? 'upright' : Math.abs(f.vertical.dir) < 45 ? 'forward' : Math.abs(f.vertical.dir) > 135 ? 'back' : f.vertical.dir > 0 ? 'to her left' : 'to her right';
      label([(hip[0] + head[0]) / 2 - 90 / k, (hip[1] + head[1]) / 2], `${f.vertical.tilt.toFixed(0)}° ${f.vertical.tilt < 4 ? '' : side}`, lerpCol(u));
    }
    // 1 spine: hips → shoulders → head; the leading end flashes
    if (S.spine && sh) {
      line(hip, sh, COL.spine, 4); line(sh, head, COL.spine, 4);
      [hip, sh, head].forEach(p => dot(p, COL.spine, 5));
      const ld = f.spine.lead;
      if (ld && f.t - ld.t < 1.2) { const end = ld.lead === 'head' ? head : hip, a = 1 - (f.t - ld.t) / 1.2;
        g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = 3 * s; g.beginPath(); g.arc(end[0], end[1], (14 + 40 * (1 - a)) * s, 0, 7); g.stroke();
        label(end, `${ld.lead}-led · ${ld.lag.toFixed(2)} s`, '#fff'); }
      label([sh[0], sh[1] + 22 / k], `curve ${f.spine.curve.toFixed(0)}°`, COL.spine);
    }
    // 2 head: an arrow along the gaze (yaw), its height for the pitch
    if (S.head && head) {
      const y = f.head.yaw * Math.PI / 180, len = f.geo.torsoI * 0.6, dir = -1;   // her left is the image's right (unmirrored)
      const tip = [head[0] - dir * Math.sin(y) * len, head[1] - Math.sin(f.head.pitch * Math.PI / 180) * len * 0.6];
      line(head, tip, COL.head, 4); dot(tip, COL.head, 5);
      label(tip, `${Math.abs(f.head.yaw).toFixed(0)}° ${f.head.yaw > 0 ? 'left' : 'right'} · ${Math.abs(f.head.pitch).toFixed(0)}° ${f.head.pitch > 0 ? 'up' : 'down'}`, COL.head);
    }
    // 3 elbows and knees
    if (S.pairs) {
      const pairs = [];
      if (S.pairMode !== 'crossed') pairs.push(['LL', J.LEL, J.LKN], ['RR', J.REL, J.RKN]);
      if (S.pairMode !== 'same') pairs.push(['LR', J.LEL, J.RKN], ['RL', J.REL, J.LKN]);
      for (const [key, a, b] of pairs) {
        const d = f.pairs[key]; if (d === null) continue;
        const u = Math.max(0, 1 - d / 1.3);
        line(P(a), P(b), `rgba(240,160,80,${0.25 + 0.75 * u})`, 2 + 5 * u);
        if (P(a) && P(b)) label([(P(a)[0] + P(b)[0]) / 2, (P(a)[1] + P(b)[1]) / 2], d.toFixed(2), COL.pair);
      }
    }
    // arms: shoulder → elbow → wrist, wider and brighter as they open; the breath at the hand
    if (S.arms && f.arms.reach !== null) {
      for (const [sh_, el, wr, r] of [[J.LSH, J.LEL, J.LWR, f.arms.reachL], [J.RSH, J.REL, J.RWR, f.arms.reachR]]) {
        if (r === null) continue; const u = Math.max(0, Math.min(1, (r - 0.5) / 0.8)), col = `rgba(255,220,150,${0.3 + 0.7 * u})`;
        line(P(sh_), P(el), col, 2 + 6 * u); line(P(el), P(wr), col, 2 + 6 * u); dot(P(wr), col, 5 + 6 * u);
      }
      if (sh) label([sh[0], sh[1] - f.geo.torsoI * 0.35], `breath ${Math.round(100 * f.arms.breath)}%`, 'rgba(255,220,150,1)');
    }
    // 5 circles: a trail per point while it circles
    if (S.circles) {
      const pos = { lhand: P(J.LWR), rhand: P(J.RWR), head, hips: hip };
      for (const [name, c] of Object.entries(f.circles)) {
        const tr = this.trails[name] = this.trails[name] || [];
        if (pos[name]) tr.push([now, pos[name], c.active]);
        while (tr.length && tr[0][0] < now - 1500) tr.shift();
        for (let i = 1; i < tr.length; i++) if (tr[i][2]) {
          g.strokeStyle = `rgba(90,200,200,${(i / tr.length) * 0.9})`; g.lineWidth = 4 * s;
          g.beginPath(); g.moveTo(...tr[i - 1][1]); g.lineTo(...tr[i][1]); g.stroke(); }
        if (c.active && pos[name]) label(pos[name], `${c.dir > 0 ? '↺' : '↻'} ${Math.abs(c.rate).toFixed(1)}/s`, COL.circle);
      }
      if (f.spin.active && head) label([head[0], head[1] - f.geo.torsoI * 0.5], `spin ${Math.abs(f.spin.rate).toFixed(0)}°/s`, COL.circle);
    }
    // contacts and turns flash
    for (const e of f.events) if (e.type === 'contact' || e.type === 'turn' || e.type === 'reverse') this.flash.push({ e, at: now });
    this.flash = this.flash.filter(x => now - x.at < 500);
    for (const { e, at } of this.flash) {
      const a = 1 - (now - at) / 500;
      const p = e.type === 'contact' ? P(e.pair[0] === 'L' ? J.LEL : J.REL) : e.type === 'turn' ? head : { lhand: P(J.LWR), rhand: P(J.RWR), head, hips: hip }[e.point];
      if (!p) continue;
      g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = 3 * s; g.beginPath(); g.arc(p[0], p[1], (10 + 30 * (1 - a)) * s, 0, 7); g.stroke();
    }
    if (!choir) return;
    // the body part that owns a voice glows in that voice's colour when the voice moves
    const own = { vertical: hip, spine: sh, pairs: P(J.LEL) && P(J.LKN) ? [(P(J.LEL)[0] + P(J.LKN)[0]) / 2, (P(J.LEL)[1] + P(J.LKN)[1]) / 2] : null, head };
    for (const m of choir.moves) {
      const p = own[m.owner]; if (!p) continue;
      const a = 1 - (now - m.at) / 900;
      g.fillStyle = VCOL[m.voice].replace('1)', `${0.25 * a})`); g.beginPath(); g.arc(p[0], p[1], (26 + 20 * (1 - a)) * s, 0, 7); g.fill();
      g.strokeStyle = VCOL[m.voice].replace('1)', `${a})`); g.lineWidth = 3 * s; g.stroke();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.choirPanel(choir, now);
  }

  // the chord and the four voices, bottom left (screen pixels); a voice that just moved is lit
  choirPanel({ desc, moves }, now) {
    const g = this.g, d = devicePixelRatio || 1, x0 = 18 * d, w = 210 * d, rows = ['soprano', 'alto', 'tenor', 'bass'];
    const y0 = this.cv.height - 18 * d - (rows.length * 22 + 54) * d;
    g.save(); g.fillStyle = 'rgba(10,10,10,.55)'; g.fillRect(x0 - 10 * d, y0 - 8 * d, w, (rows.length * 22 + 62) * d);
    g.textBaseline = 'top'; g.fillStyle = '#efe9df'; g.font = `600 ${26 * d}px -apple-system, sans-serif`;
    g.fillText(`${desc.chord}  ${CHORD_NAME[desc.chord] || ''}`, x0, y0);
    if (desc.target !== desc.chord) { g.font = `${13 * d}px -apple-system, sans-serif`; g.fillStyle = '#9a9086'; g.fillText(`→ ${desc.target} ${CHORD_NAME[desc.target] || ''}`, x0 + 120 * d, y0 + 10 * d); }
    rows.forEach((v, i) => {
      const y = y0 + (40 + i * 22) * d, m = moves.filter(x => x.voice === v).pop(), a = m ? 1 - (now - m.at) / 900 : 0;
      if (a > 0) { g.fillStyle = VCOL[v].replace('1)', `${0.3 * a})`); g.fillRect(x0 - 6 * d, y - 2 * d, w - 8 * d, 20 * d); }
      g.font = `${13 * d}px -apple-system, sans-serif`; g.fillStyle = VCOL[v]; g.fillText(v, x0, y);
      g.fillStyle = '#efe9df'; g.font = `600 ${14 * d}px -apple-system, sans-serif`; g.fillText(desc.names[v], x0 + 70 * d, y);
      g.fillStyle = '#9a9086'; g.font = `${11.5 * d}px -apple-system, sans-serif`; g.fillText(OWNER_LABEL[v], x0 + 118 * d, y + 1 * d);
    });
    g.restore();
  }
}

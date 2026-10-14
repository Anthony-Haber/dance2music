// Movement Dictionary: the sound. Plain Web Audio, one shared harmony.
//
//   drone   the body's axis as one resonating thing: partials on the root
//           (4 verticality) tilt detunes, bends and brightens it, pans it, and
//           a held lean steps the harmony; (1 spine) the curve stretches the
//           partials (inharmonic), a head- or tail-led movement sweeps through
//           them from that end; (2 head) a vowel filter and stereo focus
//   pairs   (3) elbow to knee: a second voice whose interval to the first
//           follows the distance; contact strikes a note; closing a crossed
//           pair adds a dissonant upper voice
//   circles (5) a note per quarter turn on the chord, register from the size,
//           panned round with the circle; a reversal reverses it with an accent;
//           a whole-body spin rotates the whole sound
//
// Every constant is in SD and in README.md.

export const SD = {
  rootMidi: 38,                 // D2
  partials: 10,
  level: 0.16,
  glide: 0.06,                  // parameter glide (s)
  tiltFull: 45,                 // degrees that count as a full tilt
  maxBendCents: 100, maxDetuneCents: 22,
  stepAt: 25, stepHoldS: 1.0, homeAt: 10,   // a held lean past stepAt takes a harmonic step; upright returns home
  inharm: 0.0025,               // stretch of the partials at a fully curved spine
  curveFull: 45,                // spine curve (deg) that counts as fully curved
  sweepMin: 0.12, sweepMax: 1.2,
  pairsLevel: 0.07, crossLevel: 0.06,
  circleLevel: 0.22,
};
const mtof = m => 440 * 2 ** ((m - 69) / 12);
const clip = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const VOWEL = { oo: [300, 870], ah: [730, 1090], ee: [270, 2290] };
const CHORD = [0, 4, 7, 12, 16, 19, 24];

// elbow–knee distance (torsos) → interval (cents): together = unison, close = slow beating, then third, fifth, octave
export function pairCents(d) {
  const pts = [[0, 0], [0.3, 30], [0.6, 400], [0.9, 700], [1.3, 1200]];
  if (d >= 1.3) return 1200;
  for (let i = 1; i < pts.length; i++) if (d <= pts[i][0]) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (d - x0) / (x1 - x0);
  }
  return 1200;
}

export class Sound {
  constructor() { this.ctx = null; }

  async start() {
    if (this.ctx) { await this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    this.spinPan = ctx.createStereoPanner();
    this.master.connect(this.spinPan).connect(comp).connect(ctx.destination);
    this.rec = ctx.createMediaStreamDestination(); comp.connect(this.rec);
    // ── drone ──
    this.root = SD.rootMidi; this.rootTarget = SD.rootMidi; this.step = 0; this.leanSince = null;
    this.dFilter = ctx.createBiquadFilter(); this.dFilter.type = 'lowpass'; this.dFilter.frequency.value = 900; this.dFilter.Q.value = 0.7;
    this.dPan = ctx.createStereoPanner(); this.dGain = ctx.createGain(); this.dGain.gain.value = 0;
    this.dFilter.connect(this.dPan).connect(this.dGain).connect(this.master);
    this.ex = ctx.createGain(); this.ex.gain.value = 0.5; this.ex.connect(this.dPan);     // sweeps bypass the lowpass: bright
    // head: a two-formant vowel filter on the drone, panned with the gaze
    this.f1 = ctx.createBiquadFilter(); this.f1.type = 'bandpass'; this.f1.Q.value = 6;
    this.f2 = ctx.createBiquadFilter(); this.f2.type = 'bandpass'; this.f2.Q.value = 8;
    this.hPan = ctx.createStereoPanner(); this.hGain = ctx.createGain(); this.hGain.gain.value = 0;
    this.f1.connect(this.hPan); this.f2.connect(this.hPan); this.hPan.connect(this.hGain).connect(this.master);
    this.parts = [];
    for (let n = 1; n <= SD.partials; n++) {
      const g = ctx.createGain(), e = ctx.createGain(); g.gain.value = 0.6 / n; e.gain.value = 0;
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      for (const o of [o1, o2]) { o.type = 'sine'; o.connect(g); o.connect(e); o.start(); }
      g.connect(this.dFilter); g.connect(this.f1); g.connect(this.f2); e.connect(this.ex);
      this.parts.push({ n, o1, o2, g, e });
    }
    // pairs: per side a reference tone and an interval tone; a dissonant upper voice for the crosses
    this.pairs = {};
    for (const side of ['L', 'R']) {
      const pan = ctx.createStereoPanner(); pan.pan.value = side === 'L' ? -0.5 : 0.5;
      const g = ctx.createGain(); g.gain.value = 0; pan.connect(g).connect(this.master);
      const a = ctx.createOscillator(), b = ctx.createOscillator(); a.type = b.type = 'triangle';
      a.connect(pan); b.connect(pan); a.start(); b.start();
      const x = ctx.createOscillator(), xg = ctx.createGain(); x.type = 'sawtooth'; xg.gain.value = 0;
      const xf = ctx.createBiquadFilter(); xf.type = 'lowpass'; xf.frequency.value = 2200;
      x.connect(xf).connect(xg).connect(pan); x.start();
      this.pairs[side] = { g, a, b, x, xg, pan };
    }
    this.circ = {}; this.wind = {};
  }

  now() { return this.ctx.currentTime; }
  set(param, v, tau = SD.glide) { param.setTargetAtTime(v, this.now(), tau); }

  // f: the frame from measure.js; S: which studies are on and the switches; moving: 0..1 recent movement
  update(f, S, moving) {
    if (!this.ctx || !f) return;
    const t = this.now();
    const droneOn = S.vertical || S.spine || S.head;
    // ── harmony: a held lean steps towards that side, upright comes home ──
    const v = f.vertical;
    if (S.vertical) {
      if (v.tilt > SD.stepAt && Math.abs(v.left) > Math.abs(v.forward) * 0.6) {
        const side = v.left > 0 ? 5 : 7;                      // her left: IV, her right: V
        if (!this.leanSince || this.leanSide !== side) { this.leanSince = t; this.leanSide = side; }
        if (t - this.leanSince > SD.stepHoldS) this.step = side;
      } else { this.leanSince = null; if (v.tilt < SD.homeAt) this.step = 0; }
    } else this.step = 0;
    this.root = SD.rootMidi + this.step;
    // ── drone ──
    const u = S.vertical ? clip(v.tilt / SD.tiltFull) : 0;
    const bend = SD.maxBendCents * u, det = SD.maxDetuneCents * u;
    const c = S.spine && S.spineCurve ? clip(f.spine.curve / SD.curveFull) : 0, B = SD.inharm * c * c;
    const f0 = mtof(this.root) * 2 ** (bend / 1200);
    for (const p of this.parts) {
      const fn = f0 * p.n * Math.sqrt(1 + B * p.n * p.n);
      this.set(p.o1.frequency, fn, 0.08); this.set(p.o2.frequency, fn * 2 ** (det / 1200), 0.08);
    }
    const fade = S.fadeStill ? clip(0.15 + moving) : 1;
    this.set(this.dGain.gain, droneOn ? SD.level * fade * (S.head && !S.vertical && !S.spine ? 0.35 : 1) : 0, 0.15);
    const fwd = S.vertical ? clip(v.forward * 1.5, -1, 1) : 0;
    this.set(this.dFilter.frequency, 380 * 2 ** (3 * u) * 2 ** (1.2 * fwd));
    this.set(this.dPan.pan, S.vertical ? clip(-v.left * 1.6, -1, 1) : 0);     // her left = the listener's left when mirrored
    // ── head: vowel from pitch (down oo, level ah, up ee), focus from yaw ──
    if (S.head) {
      const h = f.head, s = clip(h.pitch / 30, -1, 1);
      const [a1, a2] = s < 0 ? [VOWEL.ah, VOWEL.oo] : [VOWEL.ah, VOWEL.ee], k = Math.abs(s);
      this.set(this.f1.frequency, a1[0] + (a2[0] - a1[0]) * k); this.set(this.f2.frequency, a1[1] + (a2[1] - a1[1]) * k);
      this.set(this.hPan.pan, clip(-h.yaw / 60, -1, 1)); this.set(this.hGain.gain, 0.9 * fade, 0.15);
    } else this.set(this.hGain.gain, 0, 0.15);
    // ── pairs: per side, the same-side and/or the crossed distance (the switch) ──
    const base = mtof(this.root + 24);
    for (const side of ['L', 'R']) {
      const P = this.pairs[side], same = f.pairs[side + side], cross = f.pairs[side === 'L' ? 'LR' : 'RL'];
      const useSame = S.pairs && S.pairMode !== 'crossed' && same !== null;
      const useCross = S.pairs && S.pairMode !== 'same' && cross !== null;
      const d = useSame ? same : useCross ? cross : 1.3;
      this.set(P.a.frequency, base); this.set(P.b.frequency, base * 2 ** (pairCents(d) / 1200));
      this.set(P.g.gain, useSame || useCross ? SD.pairsLevel : 0, 0.1);
      this.set(P.x.frequency, base * 2 ** (13 / 12));                 // a minor ninth above: tension
      this.set(P.xg.gain, useCross ? SD.crossLevel / SD.pairsLevel * clip(1 - cross) ** 2 : 0, 0.08);
    }
    // ── whole-body spin turns the whole sound round ──
    this.spinPhase = (this.spinPhase || 0) + (f.spin.rate || 0) * Math.PI / 180 / 30;
    this.set(this.spinPan.pan, S.circles && f.spin.active ? 0.7 * Math.sin(this.spinPhase) : 0, 0.05);
    // ── circles that stopped can wind down like a top ──
    if (S.circles && S.windDown) for (const [name, c] of Object.entries(f.circles)) {
      const w = this.wind[name];
      if (c.active) this.wind[name] = { rate: Math.abs(c.rate), dir: c.dir, size: c.radius, next: null };
      else if (w && w.rate > 0.15) {
        w.next = w.next ?? t; if (t >= w.next) { this.note(name, w.dir, w.size, 0.6); w.rate *= 0.82; w.next = t + 0.25 / w.rate; }
      }
    }
  }

  // events from measure.js
  event(e, S, f) {
    if (!this.ctx) return;
    const t = this.now();
    if (e.type === 'lead' && S.spine && S.spineLead) {                         // a sweep through the partials from the leading end
      const span = clip(e.lag, SD.sweepMin, SD.sweepMax), N = this.parts.length;
      this.parts.forEach((p, i) => {
        const k = e.lead === 'head' ? N - 1 - i : i, at = t + span * k / N;
        p.e.gain.cancelScheduledValues(t); p.e.gain.setValueAtTime(0, at);
        p.e.gain.linearRampToValueAtTime(0.5 / Math.sqrt(p.n), at + 0.03); p.e.gain.setTargetAtTime(0, at + 0.03, 0.18 + span * 0.15);
      });
    }
    if (e.type === 'turn' && S.head) this.strike(mtof(this.root + 31), e.dir > 0 ? -0.7 : 0.7, 0.12, [1, 2.01, 3.02], [0.7, 0.3, 0.15]);
    if (e.type === 'contact' && S.pairs && (S.pairMode === 'both' || (S.pairMode === 'crossed') === e.crossed)) {
      const side = e.pair[0], d = 0.2, f0 = mtof(this.root + 24) * 2 ** (pairCents(d) / 1200);
      this.strike(f0, side === 'L' ? -0.5 : 0.5, 0.2, [1, 2.756, 5.404, 8.933], [1.5, 0.6, 0.35, 0.2]);   // a struck bar
    }
    if (e.type === 'quarter' && S.circles) { this.note(e.point, e.dir, e.size, 1); if (this.wind[e.point]) this.wind[e.point].next = null; }
    if (e.type === 'reverse' && S.circles) { this.note(e.point, e.dir, 0.4, 1.4); this.note(e.point, e.dir, 0.4, 1.0, 0.07); }
  }

  // one circle note: the next chord tone in the circle's direction, register from the circle's size
  note(point, dir, size, vel = 1, delay = 0) {
    const c = this.circ[point] = this.circ[point] || { i: 0, phase: 0 };
    c.i = (c.i + (dir >= 0 ? 1 : CHORD.length - 1)) % CHORD.length; c.phase += dir * Math.PI / 2;
    const s = clip(size ?? 0.5, 0.15, 1.5), octave = s < 0.35 ? 24 : s < 0.8 ? 12 : 0;
    const m = this.root + 12 + octave + CHORD[c.i], amp = SD.circleLevel * vel * clip(0.4 + s, 0.4, 1.3);
    this.strike(mtof(m), 0.8 * Math.cos(c.phase), amp, [1, 2, 3], [0.9, 0.35, 0.2], delay, 'triangle');
  }

  strike(f0, pan, amp, ratios, decays, delay = 0, type = 'sine') {
    const ctx = this.ctx, t = ctx.currentTime + delay, p = ctx.createStereoPanner(); p.pan.value = clip(pan, -1, 1);
    p.connect(this.master);
    ratios.forEach((r, i) => {
      if (f0 * r > 16000) return;
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = f0 * r;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp / (i + 1), t + 0.005);
      g.gain.setTargetAtTime(0, t + 0.005, decays[i] / 3);
      o.connect(g).connect(p); o.start(t); o.stop(t + decays[i] * 2 + 0.1);
    });
  }
}

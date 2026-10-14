// Movement Dictionary: the sound. Plain Web Audio.
//
//   choir   tenor, alto and soprano sing the chord that harmony.js leads one
//           voice at a time: each voice is two detuned saws with vibrato through
//           three vowel formants, gliding to its next note like a singer; a voice
//           that moves swells a little so the change is heard
//   hum     the bass voice: a stack of partials on the bass note (4 verticality:
//           tilt detunes, bends, opens and pans it); (1 spine) a head- or
//           tail-led movement sweeps through its partials from that end, and the
//           curve stretches them
//   head    (2) the choir's vowel (down oo, level ah, up ee) and where it sits in
//           the stereo field; a sharp turn sounds a soft accent
//   pairs   (3) elbow and knee touching strike a note of the chord
//   circles (5) the chord's notes one per quarter turn, travelling round; a
//           reversal reverses them; a whole-body spin turns the whole sound
//   arms    (added) the choir's breath: arms by the sides it hums, quiet and
//           dark; reaching out it opens to full voice, bright and breathy
//   trigger (a switch) sound only while something moves quickly: a fast
//           attack when a point passes the threshold, a short release after
//
// Every constant is in SD and in README.md.

export const SD = {
  partials: 10, humLevel: 0.12,
  voiceLevel: 0.075, glide: 0.09, vibratoHz: 5.2, vibratoCents: 14, swell: 1.8,
  tiltFull: 45, maxBendCents: 60, maxDetuneCents: 18,
  inharm: 0.0025, curveFull: 45, sweepMin: 0.12, sweepMax: 1.2,
  circleLevel: 0.2,
  breathRest: 0.75,               // the breath when the arms study is off (the choir as it was)
  breathFloor: 0.25, cutLow: 600, cutOctaves: 4, airLevel: 0.4,    // level 0.25 + b, low-pass 600·2^(4b) Hz, breath noise
  trigFull: 2.5, trigAttack: 0.015, trigRelease: 0.2,              // full at 2.5× the threshold; attack and release (s)
};
const mtof = m => 440 * 2 ** ((m - 69) / 12);
const clip = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
// formants (Hz) and their gains for three vowels
const VOWEL = { oo: [[300, 1], [870, 0.35], [2240, 0.12]], ah: [[730, 1], [1090, 0.5], [2440, 0.25]], ee: [[270, 1], [2290, 0.45], [3010, 0.3]] };
const PAN = { tenor: -0.35, alto: 0.3, soprano: 0.05 };

export class Sound {
  constructor() { this.ctx = null; }

  async start() {
    if (this.ctx) { await this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
    const rev = this.reverb(ctx, 2.4), wet = ctx.createGain(); wet.gain.value = 0.28;
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    this.spinPan = ctx.createStereoPanner();
    this.gate = ctx.createGain(); this.gate.gain.value = 1;            // the trigger
    this.master.connect(this.gate).connect(this.spinPan); this.spinPan.connect(comp); this.spinPan.connect(rev).connect(wet).connect(comp);
    comp.connect(ctx.destination);
    this.rec = ctx.createMediaStreamDestination(); comp.connect(this.rec);
    // ── the hum (bass voice) ──
    this.hFilter = ctx.createBiquadFilter(); this.hFilter.type = 'lowpass'; this.hFilter.frequency.value = 700; this.hFilter.Q.value = 0.7;
    this.hPan = ctx.createStereoPanner(); this.hGain = ctx.createGain(); this.hGain.gain.value = 0;
    this.hFilter.connect(this.hPan).connect(this.hGain).connect(this.master);
    this.ex = ctx.createGain(); this.ex.gain.value = 0.45; this.ex.connect(this.hPan);          // sweeps bypass the lowpass
    this.parts = [];
    for (let n = 1; n <= SD.partials; n++) {
      const g = ctx.createGain(), e = ctx.createGain(); g.gain.value = 0.6 / n; e.gain.value = 0;
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      for (const o of [o1, o2]) { o.type = 'sine'; o.connect(g); o.connect(e); o.start(); }
      g.connect(this.hFilter); e.connect(this.ex);
      this.parts.push({ n, o1, o2, g, e });
    }
    // ── the choir ──
    this.choirPan = ctx.createStereoPanner(); this.choirGain = ctx.createGain(); this.choirGain.gain.value = 0;
    this.choirLP = ctx.createBiquadFilter(); this.choirLP.type = 'lowpass'; this.choirLP.Q.value = 0.5; this.choirLP.frequency.value = 4800;
    this.choirPan.connect(this.choirLP).connect(this.choirGain).connect(this.master);
    // breath noise, shared by the voices, shaped by their formants
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = nb; noise.loop = true; noise.start();
    this.air = ctx.createGain(); this.air.gain.value = 0; noise.connect(this.air);
    const vib = ctx.createOscillator(); vib.frequency.value = SD.vibratoHz; vib.start();
    this.voices = {};
    for (const name of ['tenor', 'alto', 'soprano']) {
      const src = ctx.createGain(), out = ctx.createGain(), pan = ctx.createStereoPanner(), lvl = ctx.createGain();
      src.gain.value = 0.5; out.gain.value = 1; pan.pan.value = PAN[name]; lvl.gain.value = SD.voiceLevel;
      const vd = ctx.createGain(); vd.gain.value = SD.vibratoCents * (0.85 + 0.3 * Math.random()); vib.connect(vd);
      const oscs = [-7, 7].map(c => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = c; vd.connect(o.detune); o.connect(src); o.start(); return o; });
      const forms = VOWEL.ah.map(([fq, gn]) => { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = fq; b.Q.value = 9;
        const g = ctx.createGain(); g.gain.value = gn * 3; src.connect(b).connect(g).connect(out); return { b, g }; });
      this.air.connect(src);
      out.connect(lvl).connect(pan).connect(this.choirPan);
      this.voices[name] = { oscs, forms, lvl, pan, note: null };
    }
    this.circ = {}; this.wind = {};
  }

  now() { return this.ctx.currentTime; }
  set(param, v, tau = 0.06) { param.setTargetAtTime(v, this.now(), tau); }

  // f: the frame (measure.js); S: studies and switches; moving: 0..1 recent movement; choir: harmony.js
  update(f, S, moving, choir) {
    if (!this.ctx || !f) return;
    const t = this.now(), sing = choir.sounding(), fade = S.fadeStill ? clip(0.15 + moving) : 1;
    // ── the hum on the bass note ──
    const v = f.vertical, u = S.vertical ? clip(v.tilt / SD.tiltFull) : 0;
    const c = S.spine && S.spineCurve ? clip(f.spine.curve / SD.curveFull) : 0, B = SD.inharm * c * c;
    const f0 = mtof(sing.bass - 12) * 2 ** (SD.maxBendCents * u / 1200), det = SD.maxDetuneCents * u;
    for (const p of this.parts) {
      const fn = f0 * p.n * Math.sqrt(1 + B * p.n * p.n);
      this.set(p.o1.frequency, fn, SD.glide); this.set(p.o2.frequency, fn * 2 ** (det / 1200), SD.glide);
    }
    this.set(this.hGain.gain, SD.humLevel * fade, 0.15);
    const fwd = S.vertical ? clip(v.forward * 1.5, -1, 1) : 0;
    this.set(this.hFilter.frequency, 320 * 2 ** (3 * u) * 2 ** (1.2 * fwd));
    this.set(this.hPan.pan, S.vertical ? clip(-v.left * 1.6, -1, 1) : 0);
    // ── the choir, breathing with the arms ──
    const b = S.arms && f.arms.breath !== null ? f.arms.breath : SD.breathRest;
    this.breath = b;
    this.set(this.choirGain.gain, fade * (SD.breathFloor + b), 0.12);
    this.set(this.choirLP.frequency, SD.cutLow * 2 ** (SD.cutOctaves * b), 0.12);
    this.set(this.air.gain, S.arms ? SD.airLevel * b * b : 0, 0.12);
    // ── the trigger: sound only while moving quickly ──
    if (S.trigger) {
      const on = S.triggerAt, d = clip((f.motion.speed - on) / (on * (SD.trigFull - 1)));
      this.drive = d; this.set(this.gate.gain, Math.sqrt(d), d > (this.lastDrive ?? 0) ? SD.trigAttack : SD.trigRelease);
      this.lastDrive = d;
    } else { this.drive = 1; this.set(this.gate.gain, 1, 0.1); }
    for (const [name, V] of Object.entries(this.voices)) {
      const fq = mtof(sing[name]);
      if (V.note !== sing[name]) { V.oscs.forEach(o => this.set(o.frequency, fq, SD.glide)); V.note = sing[name]; }
    }
    // the head: the vowel from its pitch, the choir's place from its turn
    let vowel = VOWEL.ah;
    if (S.head) {
      const s = clip(f.head.pitch / 30, -1, 1), to = s < 0 ? VOWEL.oo : VOWEL.ee, k = Math.abs(s);
      vowel = VOWEL.ah.map(([fq, g], i) => [fq + (to[i][0] - fq) * k, g + (to[i][1] - g) * k]);
      this.set(this.choirPan.pan, clip(-f.head.yaw / 60, -0.8, 0.8));
    } else this.set(this.choirPan.pan, 0);
    for (const V of Object.values(this.voices)) V.forms.forEach((F, i) => { this.set(F.b.frequency, vowel[i][0], 0.08); this.set(F.g.gain, vowel[i][1] * 3, 0.08); });
    // ── a whole-body spin turns the whole sound round ──
    this.spinPhase = (this.spinPhase || 0) + (f.spin.rate || 0) * Math.PI / 180 / 30;
    this.set(this.spinPan.pan, S.circles && f.spin.active ? 0.7 * Math.sin(this.spinPhase) : 0, 0.05);
    // ── circles that stopped can wind down like a top ──
    if (S.circles && S.windDown) for (const [name, cc] of Object.entries(f.circles)) {
      const w = this.wind[name];
      if (cc.active) this.wind[name] = { rate: Math.abs(cc.rate), dir: cc.dir, size: cc.radius, next: null };
      else if (w && w.rate > 0.15) {
        w.next = w.next ?? t; if (t >= w.next) { this.note(name, w.dir, w.size, 0.6, choir); w.rate *= 0.82; w.next = t + 0.25 / w.rate; }
      }
    }
  }

  // events: from measure.js (the body) and from harmony.js (the choir)
  event(e, S, choir) {
    if (!this.ctx) return;
    const t = this.now(), sing = choir.sounding();
    if (e.type === 'move' && this.voices[e.voice]) {               // the voice that moves swells a little
      const L = this.voices[e.voice].lvl.gain; L.cancelScheduledValues(t); L.setValueAtTime(L.value, t);
      L.linearRampToValueAtTime(SD.voiceLevel * SD.swell, t + 0.08); L.setTargetAtTime(SD.voiceLevel, t + 0.12, 0.35);
    }
    if (e.type === 'lead' && S.spine && S.spineLead) {              // a sweep through the hum from the leading end
      const span = clip(e.lag, SD.sweepMin, SD.sweepMax), N = this.parts.length;
      this.parts.forEach((p, i) => {
        const k = e.lead === 'head' ? N - 1 - i : i, at = t + span * k / N;
        p.e.gain.cancelScheduledValues(t); p.e.gain.setValueAtTime(0, at);
        p.e.gain.linearRampToValueAtTime(0.5 / Math.sqrt(p.n), at + 0.03); p.e.gain.setTargetAtTime(0, at + 0.03, 0.18 + span * 0.15);
      });
    }
    if (e.type === 'turn' && S.head) this.strike(mtof(sing.soprano + 12), e.dir > 0 ? -0.7 : 0.7, 0.1, [1, 2.01, 3.02], [0.7, 0.3, 0.15]);
    if (e.type === 'contact' && S.pairs && (S.pairMode === 'both' || (S.pairMode === 'crossed') === e.crossed))
      this.strike(mtof(sing.alto), e.pair[0] === 'L' ? -0.5 : 0.5, 0.18, [1, 2.756, 5.404, 8.933], [1.5, 0.6, 0.35, 0.2]);   // a struck bar on the alto's note
    if (e.type === 'quarter' && S.circles) { this.note(e.point, e.dir, e.size, 1, choir); if (this.wind[e.point]) this.wind[e.point].next = null; }
    if (e.type === 'reverse' && S.circles) { this.note(e.point, e.dir, 0.4, 1.4, choir); this.note(e.point, e.dir, 0.4, 1.0, choir, 0.07); }
  }

  // a circle note: the choir's chord, one tone per quarter turn, in the circle's direction
  note(point, dir, size, vel, choir, delay = 0) {
    const s = choir.sounding(), tones = [s.tenor, s.alto, s.soprano, s.tenor + 12, s.alto + 12, s.soprano + 12];
    const c = this.circ[point] = this.circ[point] || { i: 0, phase: 0 };
    c.i = (c.i + (dir >= 0 ? 1 : tones.length - 1)) % tones.length; c.phase += dir * Math.PI / 2;
    const sz = clip(size ?? 0.5, 0.15, 1.5), up = sz < 0.35 ? 12 : sz < 0.8 ? 0 : -12;
    this.strike(mtof(tones[c.i] + up), 0.8 * Math.cos(c.phase), SD.circleLevel * vel * clip(0.4 + sz, 0.4, 1.3), [1, 2, 3], [0.9, 0.35, 0.2], delay, 'triangle');
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

  // a small hall: decaying noise as the impulse response
  reverb(ctx, secs) {
    const n = Math.round(ctx.sampleRate * secs), ir = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2.5; }
    const c = ctx.createConvolver(); c.buffer = ir; return c;
  }
}

// Spectral bass: the sound. Plain Web Audio.
//
//   bass           one oscillator per partial (spectral.js), each with its own gain,
//                  retuned every frame: the body moves the spectrum, the note glides
//   roughness      fast movement detunes the partials against each other (they beat)
//                  and flickers their levels (they shimmer)
//   accompaniment  a quiet groove (kick, snare, hats) and an open fifth (D, A, E) high
//                  above, so the bass has a place; with it on, a hand stroke lands on
//                  the next eighth note
//
// Every constant is in SB and in README.md.
import { SP, spectrum, scaleStep } from './spectral.js';

export const SB = {
  bassLevel: 0.32, glide: 0.06, specTau: 0.05,
  roughCents: 28, roughFlicker: 0.55,
  bpm: 92, drumLevel: 0.5, padLevel: 0.05, pad: [62, 69, 76],   // D4 A4 E5
};
const mtof = m => 440 * 2 ** ((m - 69) / 12);
const clip = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

export class Sound {
  constructor() { this.ctx = null; this.note = SP.tonic; this.pending = []; this.accomp = true; }

  async start() {
    if (this.ctx) { await this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
    const rev = this.reverb(ctx, 2.2), wet = ctx.createGain(); wet.gain.value = 0.22;
    this.out = ctx.createGain(); this.out.gain.value = 0.9;
    this.out.connect(comp); this.out.connect(rev).connect(wet).connect(comp); comp.connect(ctx.destination);
    this.rec = ctx.createMediaStreamDestination(); comp.connect(this.rec);
    // the bass: one oscillator per partial
    this.bass = ctx.createGain(); this.bass.gain.value = 0; this.bass.connect(this.out);
    this.det = Array.from({ length: SP.partials }, (_, i) => (i === 0 ? 0 : Math.random() * 2 - 1));   // roughness: a fixed random tuning per partial
    this.parts = [];
    for (let n = 1; n <= SP.partials; n++) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = mtof(this.note) * n; g.gain.value = 0;
      o.connect(g).connect(this.bass); o.start(); this.parts.push({ o, g });
    }
    // the accompaniment
    this.drums = ctx.createGain(); this.drums.gain.value = SB.drumLevel; this.drums.connect(this.out);
    this.padBus = ctx.createGain(); this.padBus.gain.value = 0; this.padBus.connect(this.out);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.connect(this.padBus);
    for (const m of SB.pad) for (const c of [-6, 6]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = c; o.connect(lp); o.start(); }
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.step = 0; this.nextT = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  now() { return this.ctx.currentTime; }
  set(p, v, tau) { p.setTargetAtTime(v, this.now(), tau); }

  // c: controls (spectral.js); quantise: land strokes on the beat
  update(c, opts) {
    if (!this.ctx) return;
    this.accomp = opts.accomp; this.quantise = opts.accomp && opts.quantise;
    this.set(this.drums.gain, opts.accomp ? SB.drumLevel : 0, 0.2); this.set(this.padBus.gain, opts.accomp ? SB.padLevel : 0, 0.4);
    if (!this.quantise) this.flush(this.now());
    this.set(this.bass.gain, SB.bassLevel, 0.2);
    const sp = spectrum(mtof(this.note), c), e = c.energy;
    this.spec = sp;
    sp.freqs.forEach((fq, i) => {
      const p = this.parts[i];
      this.set(p.o.frequency, fq * 2 ** (SB.roughCents * e * this.det[i] / 1200), SB.glide);
      const flick = 1 - SB.roughFlicker * e * Math.random();
      this.set(p.g.gain, sp.gains[i] * flick, SB.specTau);
    });
  }

  // a stroke: step the note now, or on the next eighth when the groove is on
  stroke(dir) { this.pending.push(dir); if (!this.quantise) this.flush(this.now()); }
  flush(t) {
    while (this.pending.length) {
      const dir = this.pending.shift(), m = scaleStep(this.note, dir);
      if (m !== this.note) { this.note = m; this.onNote && this.onNote(m, dir, t); }
    }
  }

  // the groove, scheduled ahead: kick, snare, hats on a 16-step bar; strokes land on eighths
  schedule() {
    const ctx = this.ctx, sixteenth = 60 / SB.bpm / 4;
    while (this.nextT < ctx.currentTime + 0.12) {
      const s = this.step % 16, t = this.nextT;
      if (this.accomp) {
        if (s === 0 || s === 7 || s === 10) this.kick(t);
        if (s === 4 || s === 12) this.snare(t);
        if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.5 : 0.28);
      }
      if (this.quantise && s % 2 === 0 && this.pending.length) setTimeout(() => this.flush(t), Math.max(0, (t - ctx.currentTime) * 1000));
      this.step++; this.nextT += sixteenth;
    }
  }
  kick(t) { const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(this.drums); o.start(t); o.stop(t + 0.4); }
  snare(t) { const n = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    n.buffer = this.noise; f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
    g.gain.setValueAtTime(0.45, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    n.connect(f).connect(g).connect(this.drums); n.start(t); n.stop(t + 0.2); }
  hat(t, a) { const n = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    n.buffer = this.noise; f.type = 'highpass'; f.frequency.value = 7500;
    g.gain.setValueAtTime(a * 0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    n.connect(f).connect(g).connect(this.drums); n.start(t, Math.random() * 0.5); n.stop(t + 0.06); }

  reverb(ctx, secs) {
    const n = Math.round(ctx.sampleRate * secs), ir = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2.5; }
    const c = ctx.createConvolver(); c.buffer = ir; return c;
  }
}

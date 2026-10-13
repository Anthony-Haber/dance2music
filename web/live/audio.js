// Web Audio version of the offline layers (synths.py · _twofive). Controls
// arrive at the camera's frame rate and reach the sound through
// setTargetAtTime, which is exactly the one-pole glide of the offline code
// (time constant τ). Pitches glide in cents via `detune` on a 440 Hz base,
// so, as offline, every semitone step sounds equal.
import { CHORDS } from './harmony.js';
const ATTACK = 0.06, RELEASE = 0.4;     // pad and bass: swell fast, ring out slowly

const cents = m => 100 * (m - 69);

export class Engine {
  constructor() { this.ctx = null; this.layers = {}; this.chord = null; }

  // Must run synchronously inside the user's tap: iOS only lets an
  // AudioContext make sound if it was created or resumed during a gesture,
  // and mutes Web Audio with the ring/silent switch unless the page says it
  // is playing media.
  unlock() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    if (!this.keepAlive) {              // older iOS: a playing <audio> element does the same
      const el = this.keepAlive = document.createElement('audio');
      el.src = URL.createObjectURL(silentWav()); el.loop = true;
      el.setAttribute('playsinline', ''); el.volume = 0.01;
    }
    this.keepAlive.play().catch(() => {});
    if (!this.ctx) this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx.resume().catch(() => {});
    const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate), s = this.ctx.createBufferSource();
    s.buffer = b; s.connect(this.ctx.destination); s.start();
    return this.ctx;
  }

  async start(sinkId) {
    const ctx = this.ctx || this.unlock();
    if (sinkId && ctx.setSinkId) { try { await ctx.setSinkId(sinkId); } catch (e) {} }
    const now = ctx.currentTime;

    // master: dry + reverb → limiter → out
    this.bus = ctx.createGain();
    const dry = this.dry = ctx.createGain(); dry.gain.value = 0.8;
    const wet = this.wet = ctx.createGain(); wet.gain.value = 0.2;
    const verb = ctx.createConvolver(); verb.buffer = this.impulse(); verb.normalize = false;
    this.master = ctx.createGain(); this.master.gain.value = 1;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -6; lim.knee.value = 0; lim.ratio.value = 20;
    lim.attack.value = 0.003; lim.release.value = 0.1;
    // instrument volume (a mapping destination: e.g. the sphere) sits before the reverb split
    this.inst = ctx.createGain(); this.inst.gain.value = 1;
    this.bus.connect(this.inst);
    this.inst.connect(dry).connect(this.master);
    this.inst.connect(verb).connect(wet).connect(this.master);
    this.master.connect(lim).connect(ctx.destination);
    this.meter = ctx.createAnalyser(); this.meter.fftSize = 512; lim.connect(this.meter);
    this.limiter = lim; this.recDest = null;

    const layer = name => { const g = ctx.createGain(); g.connect(this.bus);
                            this.layers[name] = g; return g; };
    for (const k of ['pad', 'bass', 'plucks', 'wind', 'wind tuned']) layer(k);
    // drums: hits → dlevel (the mapping) → the drums fader
    this.layers['drums'] = ctx.createGain(); this.dlevel = ctx.createGain(); this.dlevel.gain.value = 0;
    this.drumFader = ctx.createGain();
    this.layers['drums'].connect(this.dlevel).connect(this.drumFader).connect(this.bus);
    this.beatAt = undefined;

    // shared noise source for both winds
    const nb = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = gauss();
    this.noiseBuf = nb;
    const noise = ctx.createBufferSource(); noise.buffer = nb; noise.loop = true; noise.start();

    // wind: noise → (0.6 band-pass + 0.4 low-pass), cutoff and level from Weight
    this.wbp = ctx.createBiquadFilter(); this.wbp.type = 'bandpass'; this.wbp.Q.value = 1.2;
    this.wlp = ctx.createBiquadFilter(); this.wlp.type = 'lowpass'; this.wlp.Q.value = 1.6;
    const wb = ctx.createGain(); wb.gain.value = 0.6; const wl = ctx.createGain(); wl.gain.value = 0.4;
    this.wamp = ctx.createGain(); this.wamp.gain.value = 0;
    this.wpan = ctx.createStereoPanner();
    noise.connect(this.wbp).connect(wb).connect(this.wamp);
    noise.connect(this.wlp).connect(wl).connect(this.wamp);
    this.wamp.connect(this.wpan).connect(this.layers['wind']);

    // wind tuned: eight resonators on the chord tones, an octave and two up
    this.tamp = ctx.createGain(); this.tamp.gain.value = 0;
    this.tpan = ctx.createStereoPanner();
    const makeup = ctx.createGain(); makeup.gain.value = 4;
    this.res = [];
    for (let v = 0; v < 4; v++) for (const o of [12, 24]) {
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 60; f.frequency.value = 440;
      noise.connect(f).connect(makeup); this.res.push({ f, v, o });
    }
    makeup.connect(this.tamp).connect(this.tpan).connect(this.layers['wind tuned']);

    // pad: four voices, detuned by slow LFOs when paths wander. The voices'
    // sound (the timbre) is swappable; they all feed padBus → timbre post-chain
    // → level → brightness low-pass → the pad fader.
    this.pamp = ctx.createGain(); this.pamp.gain.value = 0;
    const plp = this.plp = ctx.createBiquadFilter(); plp.type = 'lowpass'; plp.frequency.value = 1600; plp.Q.value = -3;
    this.pamp.connect(plp).connect(this.layers['pad']);
    this.setTimbre(this.timbre || 'saw', true);

    // bass: FM on the root. Adding Δ to `frequency` is scaled by 2^(detune/1200)
    // like the base, so a deviation of I·440 on the 440 base is I·f at any pitch.
    this.bc = ctx.createOscillator(); this.bm = ctx.createOscillator();
    this.bc.frequency.value = 440; this.bm.frequency.value = 440;
    this.bdev = ctx.createGain(); this.bdev.gain.value = 0;
    this.bm.connect(this.bdev).connect(this.bc.frequency);
    this.bamp = ctx.createGain(); this.bamp.gain.value = 0;
    this.bc.connect(this.bamp).connect(this.layers['bass']);
    this.bc.start(now); this.bm.start(now);

    this.setChord('I', true);
    return ctx;
  }

  // ── pad timbres ───────────────────────────────────────────────────
  // Each voice: oscillators whose `detune` params carry the pitch (in cents,
  // plus a fixed offset per oscillator), one LFO for the wander detune, and an
  // output panned into padBus. Swapping timbre rebuilds the voices and keeps
  // the chord.
  setTimbre(name, building = false) {
    this.timbre = name;
    if (!this.ctx || !this.pamp) return;
    const ctx = this.ctx, now = ctx.currentTime;
    if (this.voices) for (const v of this.voices) v.nodes.forEach(n => { try { n.stop && n.stop(); n.disconnect(); } catch (e) {} });
    if (this.padBus) { this.padBus.disconnect(); (this.padPost || []).forEach(n => n.disconnect()); }
    this.padBus = ctx.createGain(); this.formants = null; this.padPost = [];
    let post = this.padBus;
    if (name === 'choir') {          // three formant band-passes in parallel, vowel-morphed
      const sum = ctx.createGain(); sum.gain.value = 3.2;
      this.formants = [1, 0.55, 0.3].map(g => { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 9;
        const a = ctx.createGain(); a.gain.value = g; this.padBus.connect(f).connect(a).connect(sum); this.padPost.push(f, a); return f; });
      this.padPost.push(sum); post = sum; this.setVowel(this.vowel ?? 0.5, now, true);
    }
    post.connect(this.pamp);
    const organ = ctx.createPeriodicWave(new Float32Array([0, 1, 0.8, 0.5, 0.6, 0, 0.35, 0, 0.3]), new Float32Array(9));
    const osc = (type, base = 440) => { const o = ctx.createOscillator(); if (type === 'organ') o.setPeriodicWave(organ); else o.type = type;
                                          o.frequency.value = base; o.start(now); return o; };
    this.voices = [[0.31, 1, -0.5], [0.47, -1, 0.5], [0.71, 1, -0.2], [0.23, -1, 0.2]].map(([r, sign, pan], i) => {
      const lfo = ctx.createOscillator(); lfo.frequency.value = r; lfo.start(now);
      const depth = ctx.createGain(); depth.gain.value = 0; lfo.connect(depth);
      const out = ctx.createGain(), pn = ctx.createStereoPanner(); pn.pan.value = pan; out.connect(pn).connect(this.padBus);
      const nodes = [lfo, depth, out, pn], pitch = [];
      const vib = (hz, cents) => { const l = ctx.createOscillator(), g = ctx.createGain(); l.frequency.value = hz * (1 + 0.07 * i);
                                   g.gain.value = cents; l.connect(g); l.start(now); nodes.push(l, g); return g; };
      const add = (o, off, gain, vibrato) => { const g = ctx.createGain(); g.gain.value = gain; o.connect(g).connect(out);
        depth.connect(o.detune); if (vibrato) vibrato.connect(o.detune); pitch.push([o.detune, off]); nodes.push(o, g); return o; };
      if (name === 'strings') {       // two saws ±8 cents, 5.3 Hz vibrato
        const vb = vib(5.3, 12); add(osc('sawtooth'), -8, 0.13, vb); add(osc('sawtooth'), 8, 0.13, vb);
      } else if (name === 'glass') {  // FM bell: modulator at 3.5 × the carrier, index 1.2
        const c = add(osc('sine'), 0, 0.22), m = osc('sine', 440 * 3.5), dev = ctx.createGain();
        dev.gain.value = 1.2 * 440 * 3.5; m.connect(dev).connect(c.frequency); depth.connect(m.detune);
        pitch.push([m.detune, 0]); nodes.push(m, dev);
      } else if (name === 'organ') {  // drawbar-like harmonics 1, 2, 3, 4, 6, 8
        add(osc('organ'), 0, 0.16);
      } else if (name === 'choir') {  // saws through the formants, a slow vocal vibrato
        add(osc('sawtooth'), 0, 0.2, vib(4.8, 15));
      } else {
        add(osc('sawtooth'), 0, 0.2);
      }
      return { depth, sign, pitch, nodes };
    });
    if (!building && this.chord) { const c = this.chord; this.chordKey = null; this.setChord(c, true); }
  }

  // vowel 0 … 1: "oo" → "o" → "a" → "e" → "ee" (formant frequencies, Hz)
  setVowel(x, t, instant = false) {
    this.vowel = x;
    if (!this.formants) return;
    const V = [[300, 870, 2240], [450, 800, 2830], [730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010]];
    const u = Math.max(0, Math.min(1, x)) * (V.length - 1), i = Math.min(V.length - 2, Math.floor(u)), f = u - i;
    this.formants.forEach((flt, k) => { const hz = V[i][k] * (1 - f) + V[i + 1][k] * f;
      instant ? flt.frequency.setValueAtTime(hz, t) : flt.frequency.setTargetAtTime(hz, t, 0.08); });
  }

  impulse() {   // same recipe as synths.reverb: noise · e^{-t/0.35}, 1.6 s, smoothed, unit energy
    const ctx = this.ctx, n = Math.floor(1.6 * ctx.sampleRate);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let e = 0;
      for (let i = 0; i < n; i++) d[i] = gauss() * Math.exp(-i / (0.35 * ctx.sampleRate));
      for (let i = n - 1; i >= 5; i--) d[i] = (d[i] + d[i - 1] + d[i - 2] + d[i - 3] + d[i - 4] + d[i - 5]) / 6;
      for (let i = 0; i < n; i++) e += d[i] * d[i];
      const g = 1 / Math.sqrt(e); for (let i = 0; i < n; i++) d[i] *= g;
    }
    return b;
  }

  // chord: {key, bass, voices} (voices may be voice-led, not fixed)
  setChord(chord, instant = false) {
    if (typeof chord === 'string') chord = { key: chord, ...CHORDS[chord] };
    const sig = chord.key + chord.voices.join();
    if (!this.ctx || !this.voices || sig === this.chordKey) return;
    this.chordKey = sig; this.chord = chord;
    const t = this.ctx.currentTime, set = (param, v, tau) =>
      instant ? param.setValueAtTime(v, t) : param.setTargetAtTime(v, t, tau);
    this.voices.forEach((v, i) => v.pitch.forEach(([param, off]) => set(param, cents(this.chord.voices[i]) + off, 0.25)));
    this.res.forEach(r => set(r.f.detune, cents(this.chord.voices[r.v] + r.o), 0.25));
    set(this.bc.detune, cents(this.chord.bass), 0.12);
    set(this.bm.detune, cents(this.chord.bass), 0.12);
  }

  // f: live features, mirror: whether the picture (and so pan) is mirrored
  // v: destination values from mapping.evaluate; dest: their glide times
  update(f, v, dest, mirror, drums) {
    if (!this.ctx || !f) return;
    const t = this.ctx.currentTime;
    const sx = x => (mirror ? 1 - x : x) * 2 - 1;          // screen x → pan −1…1
    const set = (param, k, scale = 1) => this.ar(param, scale * v[k], t, dest[k].att, dest[k].rel);
    set(this.pamp.gain, 'pad.level');
    set(this.inst.gain, 'inst.level');
    if (this.formants) this.setVowel(v['pad.vowel'], t);
    set(this.plp.frequency, 'pad.bright');
    this.voices.forEach(o => this.ar(o.depth.gain, o.sign * v['pad.detune'], t, dest['pad.detune'].att, dest['pad.detune'].rel));
    set(this.bamp.gain, 'bass.level', 0.2);
    set(this.bdev.gain, 'bass.harsh', 440);                // deviation I·440 on the 440 base = I·f
    set(this.wamp.gain, 'wind.level', 0.5);
    set(this.tamp.gain, 'tuned.level', 0.5);
    set(this.wbp.frequency, 'wind.bright'); set(this.wlp.frequency, 'wind.bright');
    const pan = Math.max(-1, Math.min(1, (mirror ? -1 : 1) * v['wind.pan']));   // as seen
    this.ar(this.wpan.pan, pan, t, dest['wind.pan'].att, dest['wind.pan'].rel);
    this.ar(this.tpan.pan, pan, t, dest['wind.pan'].att, dest['wind.pan'].rel);
    set(this.wet.gain, 'reverb'); this.ar(this.dry.gain, 1 - v['reverb'], t, 0.3, 0.3);
    set(this.dlevel.gain, 'drums.level');
    this.pluckLevel = v['plucks.level'];
    for (const ev of f.events) {
      this.pluck(ev, sx(ev.x));
      if (drums.hits) this.hit({ lfoot: 'kick', rfoot: 'kick', lhand: 'snare', rhand: 'hat' }[ev.part],
                               this.ctx.currentTime, ev.strength, sx(ev.x));
    }
    if (drums.groove && drums.enabled !== false) this.groove(f, drums);
    if (drums.bounce) this.bounceGroove(drums.bounce, drums);
  }

  // The hip-locked groove. bo.nextBeat is the next bottom of her bounce, on
  // the camera's capture clock (performance.now, in s). getOutputTimestamp maps
  // that clock to the audio clock *at the speaker*, so a hit scheduled at the
  // mapped time is heard when her hip is at the bottom (plus the sync offset).
  bounceGroove(bo, cfg) {
    const ctx = this.ctx, now = ctx.currentTime, T = bo.period;
    const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
    const toCtx = ms => (ts && ts.performanceTime ? ts.contextTime + (ms - ts.performanceTime) / 1000
                                                  : now + (ms - performance.now()) / 1000);
    const base = bo.nextBeat * 1000 + (cfg.offsetMs || 0) + (cfg.accent === 'up' ? 500 * T : 0);
    this.scheduled = (this.scheduled || []).filter(b => b > performance.now() - 2000);
    for (const ms of [base, base + 1000 * T]) {
      const at = toCtx(ms);
      if (at < now + 0.005 || at > now + 0.25) continue;               // too late, or not yet
      if (this.lastBeatAt !== undefined && at - this.lastBeatAt < 0.6 * T) continue;   // already have it
      this.lastBeatAt = at; this.beatN = (this.beatN || 0) + 1;
      this.hit('kick', at, 0.95);
      if (this.beatN % 2 === 0) this.hit('snare', at, 0.8);
      this.hit('hat', at + T / 2, 0.55, 0.3);
      this.scheduled.push(ms - (cfg.offsetMs || 0));   // for the ring drawn at her hip
    }
  }

  // ── percussion ─────────────────────────────────────────────────────
  // Three synthesised voices; each hit is a handful of nodes that stop themselves.
  hit(kind, t, vel, pan = 0) {
    const ctx = this.ctx, out = ctx.createStereoPanner(); out.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(this.layers['drums']);
    const env = (g, peak, decay) => { g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(1e-4, t + decay); };
    const noise = (hp, bp) => { const n = ctx.createBufferSource(); n.buffer = this.noiseBuf;
      n.loopStart = Math.random() * 3; const f = ctx.createBiquadFilter();
      f.type = hp ? 'highpass' : 'bandpass'; f.frequency.value = hp || bp; f.Q.value = hp ? 0.7 : 0.8;
      n.connect(f); n.start(t, Math.random() * 3); n.stop(t + 0.4); return f; };
    vel = 0.35 + 0.65 * Math.min(1, vel);
    if (kind === 'kick') {                 // sine, pitch falling 150 → 45 Hz
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      env(g, 0.9 * vel, 0.4); o.connect(g).connect(out); o.start(t); o.stop(t + 0.45);
    } else if (kind === 'snare') {         // band-passed noise + a short 185 Hz body
      const g = ctx.createGain(); env(g, 0.5 * vel, 0.18); noise(0, 1800).connect(g).connect(out);
      const o = ctx.createOscillator(), go = ctx.createGain(); o.type = 'triangle'; o.frequency.value = 185;
      env(go, 0.35 * vel, 0.1); o.connect(go).connect(out); o.start(t); o.stop(t + 0.15);
    } else {                               // hat: high-passed noise, 50 ms
      const g = ctx.createGain(); env(g, 0.25 * vel, 0.05); noise(7000).connect(g).connect(out);
    }
  }

  // A beat at the detected tempo, phase-locked to her onsets: kick on 1 and 3,
  // snare on 2 and 4, hats on the eighths. Its level is the drums.level mapping
  // (by default the rhythm regularity), so it fades in only as she gets regular.
  groove(f, drums) {
    const ctx = this.ctx, now = ctx.currentTime, T = f.period;
    const toAudio = x => x - drums.clock;                  // feature time → audio time
    if (this.beatAt === undefined || this.beatAt < now - 60) { this.beatAt = toAudio(f.lastOnset); this.step = 0; this.Tprev = T; }
    // tempo drifted: keep the next scheduled eighth where it was, change the spacing after it
    if (Math.abs(T - this.Tprev) > 1e-3) { this.beatAt += (this.step / 2) * (this.Tprev - T); this.Tprev = T; }
    if (this.beatAt + (this.step / 2) * T < now - 2 * T) {        // fell behind (tab hidden…): catch up
      this.step += 2 * Math.ceil((now - this.beatAt - (this.step / 2) * T) / T); }
    // nudge the grid toward a fresh onset that lands near a beat
    if (f.lastOnset !== this.seenOnset) {
      this.seenOnset = f.lastOnset;
      const on = toAudio(f.lastOnset), k = Math.round((on - this.beatAt) / T), err = on - (this.beatAt + k * T);
      if (Math.abs(err) < T / 4) this.beatAt += 0.3 * err;
    }
    while (this.beatAt + (this.step / 2) * T < now + 0.12) {  // schedule 120 ms ahead
      const at = this.beatAt + (this.step / 2) * T, eighth = this.step % 8;
      if (at > now - 0.01) {
        if (eighth === 0 || eighth === 4) this.hit('kick', at, 0.9);
        if (eighth === 2 || eighth === 6) this.hit('snare', at, 0.8);
        this.hit('hat', at, eighth % 2 ? 0.45 : 0.7, 0.3);
      }
      this.step++;
    }
  }


  ar(param, v, t, att = ATTACK, rel = RELEASE) {   // one-pole glide, separate rise and fall times
    const last = param._target ?? param.value;
    if (Math.abs(v - last) < 1e-4 * (Math.abs(v) + 1e-3)) return;
    param.setTargetAtTime(v, t, v > last ? att : rel);
    param._target = v;
  }

  idle() {   // nobody in frame: everything that follows movement falls silent
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const g of [this.wamp, this.tamp]) g.gain.setTargetAtTime(0, t, 0.3);
    for (const g of [this.pamp, this.bamp]) { g.gain.setTargetAtTime(0, t, 0.6); g.gain._target = 0; }
  }

  pluck(ev, pan) {
    const c = this.chord, midi = { lfoot: c.bass + 12, rfoot: c.voices[1],
                                   lhand: c.voices[2] + 12, rhand: c.voices[3] + 12 }[ev.part];
    const ctx = this.ctx, sr = ctx.sampleRate, n = Math.floor(2.5 * sr);
    const buf = ctx.createBuffer(1, n, sr), y = buf.getChannelData(0);
    const hz = 440 * 2 ** ((midi - 69) / 12), N = Math.max(2, Math.floor(sr / hz));
    const z = new Float32Array(N);
    for (let i = 0; i < N; i++) z[i] = Math.random() * 2 - 1;
    const passes = Math.floor(3 * (1 - (0.35 + 0.6 * ev.strength))) + 1;
    for (let p = 0; p < passes; p++) for (let i = 0; i < N; i++) z[i] = 0.5 * (z[i] + z[(i + N - 1) % N]);
    for (let i = 0, j = 0; i < n; i++) {
      const a = z[j], b = z[(j + 1) % N]; y[i] = a; z[j] = 0.996 * 0.5 * (a + b); j = (j + 1) % N;
    }
    const s = ctx.createBufferSource(); s.buffer = buf;
    const g = ctx.createGain(); g.gain.value = (this.pluckLevel ?? 1) * 0.55 * (0.25 + 0.75 * ev.strength);
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    s.connect(g).connect(p).connect(this.layers['plucks']); s.start();
  }

  // a MediaStream of exactly what goes to the speakers, for the recorder
  recordStream() {
    if (!this.recDest) { this.recDest = this.ctx.createMediaStreamDestination(); this.limiter.connect(this.recDest); }
    return this.recDest.stream;
  }

  level(name, v) {
    const g = name === 'drums' ? this.drumFader : this.layers[name];
    if (g) g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }
  masterLevel(v) { if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03); }
  peak() {
    if (!this.meter) return 0;
    const a = new Float32Array(this.meter.fftSize); this.meter.getFloatTimeDomainData(a);
    let m = 0; for (const x of a) m = Math.max(m, Math.abs(x)); return m;
  }
  async stop() {
    if (this.ctx) await this.ctx.close();
    this.ctx = null; this.chordKey = null; this.layers = {}; this.recDest = null;
    if (this.keepAlive) this.keepAlive.pause();
  }
}

function gauss() {   // Box–Muller
  let u = 0; while (!u) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

function silentWav(seconds = 1, sr = 8000) {   // a tiny silent 8-bit WAV
  const n = seconds * sr, b = new DataView(new ArrayBuffer(44 + n));
  const w = (o, str) => [...str].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); b.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true);
  b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, sr, true);
  b.setUint32(28, sr, true); b.setUint16(32, 1, true); b.setUint16(34, 8, true);
  w(36, 'data'); b.setUint32(40, n, true);
  for (let i = 0; i < n; i++) b.setUint8(44 + i, 128);
  return new Blob([b], { type: 'audio/wav' });
}

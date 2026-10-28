// Movement Dictionary: the choir. Four voices (bass, tenor, alto, soprano) sing
// a chord in D major; the body chooses where the harmony goes, and the choir
// gets there ONE VOICE AT A TIME, the way a choir changes chords: the common
// tones hold, one voice steps, then the next.
//
//   where to (the target chord)
//     upright                 I     (her notes: upright is the home, the hum)
//     a held lean left/right  IV / V
//     elbow and knee folding in on the same side   → the relative chord:
//                             I→vi, IV→ii, V→iii    (one note away)
//     a crossed pair closing  → the other neighbour: I→iii, IV→vi, V→vii°
//   each voice belongs to a part of the body, which can also bend it a step
//   up or down (a neighbour note, a suspension) and let it go back:
//     bass = the axis (verticality), tenor = the spine, alto = elbows and knees,
//     soprano = the head
// DOM-free, audio-free: tested in Node.
import { TurnPitch } from './turn-pitch.js?v=turn-notes-1';

export const HM = {
  tonic: 62,                      // D (MIDI); the key is D major
  stepS: 0.35,                    // one voice moves at most this often
  leanAt: 22, leanHoldS: 0.35, homeAt: 10, sideOverFwd: 0.4,   // degrees: a held lean past leanAt changes the function; under homeAt it is home
  foldSame: 0.75, foldCross: 0.95, release: 0.15,   // elbow–knee distances (torsos) that fold; hysteresis
  headUp: 12, headDown: -15,      // degrees of head pitch that bend the soprano
  curlAt: 0.22, archAt: -0.15,    // spine curl (forward +) that bends the tenor
};
export const VOICES = ['bass', 'tenor', 'alto', 'soprano'];
export const OWNER = { bass: 'vertical', tenor: 'spine', alto: 'pairs', soprano: 'head' };
const RANGE = { bass: [38, 57], tenor: [48, 67], alto: [55, 74], soprano: [62, 81] };
const SCALE = [0, 2, 4, 5, 7, 9, 11];                    // major
const DEG = { I: 0, ii: 1, iii: 2, IV: 3, V: 4, vi: 5, 'vii°': 6 };
const NAMES = ['D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B', 'C', 'C♯'];
export const RELATIVE = { I: 'vi', IV: 'ii', V: 'iii' };          // one note away (the relative)
export const LEADING = { I: 'iii', IV: 'vi', V: 'vii°' };         // one note away (the other neighbour)

// pitch classes (relative to the tonic) of the triad on a degree
export function triad(sym) {
  const d = DEG[sym];
  return [0, 2, 4].map(k => SCALE[(d + k) % 7]);
}
export const noteName = m => NAMES[((m - HM.tonic) % 12 + 12) % 12] + (Math.floor((m - 12) / 12));

// the nearest MIDI note of pitch class pc (relative to the tonic) to m, inside [lo, hi]
function nearest(m, pc, [lo, hi]) {
  let best = null;
  for (let o = lo; o <= hi; o++) if (((o - HM.tonic) % 12 + 12) % 12 === pc && (best === null || Math.abs(o - m) < Math.abs(best - m))) best = o;
  return best;
}
function* perms(a) { if (a.length <= 1) { yield a; return; }
  for (let i = 0; i < a.length; i++) for (const r of perms([...a.slice(0, i), ...a.slice(i + 1)])) yield [a[i], ...r]; }

// the voicing of `sym` closest to `cur` ({bass, tenor, alto, soprano}): bass on the root
// (the hum is the root), the upper three share the triad, least total motion
export function voiceTo(cur, sym) {
  const pcs = triad(sym), out = { bass: nearest(cur.bass, pcs[0], RANGE.bass) };
  let best = null;
  for (const p of perms(pcs)) {
    const v = { tenor: nearest(cur.tenor, p[0], RANGE.tenor), alto: nearest(cur.alto, p[1], RANGE.alto), soprano: nearest(cur.soprano, p[2], RANGE.soprano) };
    if (!(v.tenor < v.alto && v.alto < v.soprano)) continue;                 // no crossing
    const cost = Math.abs(v.tenor - cur.tenor) + Math.abs(v.alto - cur.alto) + Math.abs(v.soprano - cur.soprano);
    if (!best || cost < best.cost) best = { cost, v };
  }
  return { ...out, ...(best ? best.v : { tenor: cur.tenor, alto: cur.alto, soprano: cur.soprano }) };
}

// one diatonic step up (+1) or down (−1) from m, in the key
export function scaleStep(m, dir) {
  for (let k = 1; k <= 2; k++) { const n = m + dir * k; if (SCALE.includes(((n - HM.tonic) % 12 + 12) % 12)) return n; }
  return m + dir;
}

export class Choir {
  constructor() { this.reset(); }
  reset() {
    this.func = 'I'; this.variant = null; this.target = 'I';
    this.voices = voiceTo({ bass: 50, tenor: 57, alto: 62, soprano: 66 }, 'I');   // D3, A3, D4, F♯4
    this.lastMove = -1e9; this.leanSince = null; this.leanSide = null; this.bend = { tenor: 0, soprano: 0 };
    this.fold = { same: false, cross: false }; this.chord = 'I';
    this.turnPitch = new TurnPitch();
  }

  updateTurn(spin, S) {
    const from = this.turnPitch.state.semitones;
    const state = this.turnPitch.update(spin, { enabled: !!S.spin });
    return state.changed ? [{ type: 'transpose', from, to: state.semitones, steps: state.steps }] : [];
  }

  // f: a frame from measure.js; S: which studies are on; t in seconds. Returns the events of this frame.
  update(f, S, t) {
    const ev = this.updateTurn(f.spin, S);
    // the function, from the lean (verticality)
    const v = f.vertical;
    if (S.vertical && v.tilt > HM.leanAt && Math.abs(v.left) > Math.abs(v.forward) * HM.sideOverFwd) {
      const side = v.left > 0 ? 'IV' : 'V';                      // her left: IV, her right: V
      if (this.leanSide !== side) { this.leanSide = side; this.leanSince = t; }
      if (t - this.leanSince >= HM.leanHoldS) this.func = side;
    } else { this.leanSide = null; if (!S.vertical || v.tilt < HM.homeAt) this.func = 'I'; }
    // the variant, from elbows and knees folding in (with hysteresis)
    if (S.pairs) {
      const P = f.pairs, m = (a, b) => Math.min(a ?? 9, b ?? 9);
      const same = m(P.LL, P.RR), cross = m(P.LR, P.RL);
      this.fold.same = same < HM.foldSame - (this.fold.same ? -HM.release : 0);
      this.fold.cross = cross < HM.foldCross - (this.fold.cross ? -HM.release : 0);
    } else this.fold = { same: false, cross: false };
    this.variant = this.fold.cross ? 'L' : this.fold.same ? 'R' : null;
    const want = this.variant === 'R' ? RELATIVE[this.func] : this.variant === 'L' ? LEADING[this.func] : this.func;
    if (want !== this.target) { this.target = want; ev.push({ type: 'target', chord: want }); }
    // the bends: the head bends the soprano, the spine the tenor (a neighbour note, held while the gesture is)
    this.bend.soprano = S.head ? (f.head.pitch > HM.headUp ? 1 : f.head.pitch < HM.headDown ? -1 : 0) : 0;
    this.bend.tenor = S.spine ? (f.spine.curl > HM.curlAt ? -1 : f.spine.curl < HM.archAt ? 1 : 0) : 0;
    // one voice at a time towards the target: the smallest step first, upper voices before the bass
    if (t - this.lastMove >= HM.stepS) {
      const goal = voiceTo(this.voices, this.target);
      const todo = VOICES.filter(n => goal[n] !== this.voices[n])
        .sort((a, b) => Math.abs(goal[a] - this.voices[a]) - Math.abs(goal[b] - this.voices[b]) || (a === 'bass') - (b === 'bass'));
      if (!todo.length && this.chord !== this.target) { this.chord = this.target; ev.push({ type: 'arrive', chord: this.chord }); }
      if (todo.length) {
        const n = todo[0], from = this.voices[n];
        this.voices = { ...this.voices, [n]: goal[n] }; this.lastMove = t;
        ev.push({ type: 'move', voice: n, from, to: goal[n], owner: OWNER[n] });
        if (todo.length === 1) { this.chord = this.target; ev.push({ type: 'arrive', chord: this.chord }); }
      }
    }
    return ev;
  }

  // what each voice sings now: its chord tone, bent a scale step where a gesture holds it
  sounding() {
    const s = { ...this.voices };
    for (const n of ['tenor', 'soprano']) if (this.bend[n]) s[n] = scaleStep(s[n], this.bend[n]);
    const shifted = this.turnPitch.apply(VOICES.map(n => s[n]));
    return Object.fromEntries(VOICES.map((name, i) => [name, shifted[i]]));
  }
  // the chord being sung (its symbol while all four voices are on it, else the one it is leaving) and its notes
  describe() {
    const voices = this.sounding(), turn = this.turnPitch.state;
    const chordName = sym => noteName(HM.tonic + SCALE[DEG[sym]] + turn.semitones).replace(/-?\d+$/, '') +
      (sym === 'vii°' ? '°' : sym === sym.toLowerCase() ? 'm' : '');
    return { chord: this.chord, target: this.target, func: this.func, variant: this.variant, voices,
      names: Object.fromEntries(VOICES.map(n => [n, noteName(voices[n])])), turn,
      turn_name: noteName(turn.tonic_midi), chord_name: chordName(this.chord), target_name: chordName(this.target) };
  }
}

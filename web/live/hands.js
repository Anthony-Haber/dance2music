// Hands: MediaPipe Gesture Recognizer (21 landmarks per hand + 7 canned
// gestures), either on the whole frame (near the camera) or on a crop around
// each wrist found by the pose model (a full-body dancer's hands are ~85 px
// across in a 576×1024 frame: full-frame detection found 2% of them on the
// Sep 21 clips, crops 52–55%).
//
// Per hand we derive: finger count (0–5), openness (0 fist … 1 open palm)
// and the canned gesture, each debounced so a flicker does not act.

import { J } from './features.js';

const MODEL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task';
export const GESTURES = ['Closed_Fist', 'Open_Palm', 'Pointing_Up', 'Thumb_Up', 'Thumb_Down', 'Victory', 'ILoveYou'];
export const HS = { crop: 256, cropTorso: 1.1, cropMinPx: 64, reach: 0.35,
                    gestureMin: 0.5, gestureHoldS: 0.35, fingersHoldS: 0.3, openTau: 0.1 };

const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// fingers extended, from landmarks (rotation-invariant distance tests):
// a finger is out if its tip is clearly farther from the wrist than its PIP
// joint; the thumb if its tip is farther from the pinky's base than its IP
// joint. On 1,926 hands cropped from the Sep 21 clips: the four fingers read
// 4 on 98% of Open_Palm detections, the thumb reads out on 95% of them and
// on 81% of Thumb_Up (the stricter rule first tried: 69% and 42%).
export function fingerState(lm) {
  const out = [];
  out.push(d2(lm[4], lm[17]) > d2(lm[3], lm[17]));
  for (const [tip, pip] of [[8, 6], [12, 10], [16, 14], [20, 18]]) out.push(d2(lm[tip], lm[0]) > 1.15 * d2(lm[pip], lm[0]));
  // openness: tip-to-wrist over knuckle-to-wrist, ≈1.0 curled … ≈2.0 straight
  let r = 0; for (const [tip, mcp] of [[8, 5], [12, 9], [16, 13], [20, 17]]) r += d2(lm[tip], lm[0]) / Math.max(1e-6, d2(lm[mcp], lm[0]));
  const open = Math.min(1, Math.max(0, (r / 4 - 1.1) / 0.8));
  return { fingers: out.filter(Boolean).length, open, ext: out };
}

class Hand {             // debounced state of one hand
  constructor() { this.reset(); }
  reset() { this.seen = false; this.fingers = 0; this.open = 0; this.gesture = 'None'; this.score = 0;
            this.candG = 'None'; this.candGSince = 0; this.candF = 0; this.candFSince = 0; this.lastSeen = -1e9;
            this.lm = null; this.box = null; this.rawG = 'None'; }
  update(res, t) {
    if (!res) { if (t - this.lastSeen > 0.4) { this.seen = false; this.lm = null; } return; }
    this.seen = true; this.lastSeen = t; this.lm = res.lm; this.box = res.box;
    const st = fingerState(res.lm);
    const dt = Math.max(0.01, t - (this.tPrev ?? t)); this.tPrev = t;
    this.open += (1 - Math.exp(-dt / HS.openTau)) * (st.open - this.open);
    if (st.fingers !== this.candF) { this.candF = st.fingers; this.candFSince = t; }
    if (t - this.candFSince >= HS.fingersHoldS) this.fingers = this.candF;
    const g = res.gesture && res.score >= HS.gestureMin ? res.gesture : 'None';
    this.rawG = g;
    if (g !== this.candG) { this.candG = g; this.candGSince = t; }
    if (t - this.candGSince >= HS.gestureHoldS) { this.gesture = this.candG; this.score = res.score; }
  }
}

export class Hands {
  constructor() { this.mode = 'off'; this.rec = {}; this.L = new Hand(); this.R = new Hand(); this.n = 0;
                  this.canvas = document.createElement('canvas'); this.canvas.width = this.canvas.height = HS.crop;
                  this.cx = this.canvas.getContext('2d', { willReadFrequently: false }); this.tLast = {}; this.ms = 0; }

  async load(vision, mode) {
    this.mode = mode; this.L.reset(); this.R.reset();
    if (mode === 'off') return;
    const opts = (numHands, delegate) => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO',
      numHands, minHandDetectionConfidence: 0.3, minHandPresenceConfidence: 0.3, minTrackingConfidence: 0.3 });
    const make = async n => { try { return await vision.mod.GestureRecognizer.createFromOptions(vision.fileset, opts(n, 'GPU')); }
                              catch (e) { return vision.mod.GestureRecognizer.createFromOptions(vision.fileset, opts(n, 'CPU')); } };
    // VIDEO mode needs rising timestamps per recogniser: one per crop, or one for the frame
    if (mode === 'far' && !this.rec.L) { this.rec.L = await make(1); this.rec.R = await make(1); }
    if (mode === 'near' && !this.rec.F) this.rec.F = await make(2);
  }

  // f: live features (pose, in video pixels), tMs: a rising timestamp
  detect(video, f, tMs) {
    if (this.mode === 'off' || !f) return;
    const t = tMs / 1000, t0 = performance.now(), W = video.videoWidth, H = video.videoHeight;
    if (this.mode === 'far') {
      // alternate hands frame by frame: each hand at half the frame rate
      const side = this.n++ % 2 ? 'R' : 'L', wj = side === 'L' ? J.L_WR : J.R_WR, ej = side === 'L' ? J.L_EL : J.R_EL;
      const w = f.pos(wj), e = f.pos(ej), hand = this[side];
      if (!w || f.conf(wj) < 0.3) { hand.update(null, t); return; }
      const c = e ? [w[0] + HS.reach * (w[0] - e[0]), w[1] + HS.reach * (w[1] - e[1])] : w;
      const sz = Math.max(HS.cropMinPx, HS.cropTorso * f.L), box = [c[0] - sz / 2, c[1] - sz / 2, sz, sz];
      this.drawCrop(video, box, W, H);
      const ts = Math.max(tMs, (this.tLast[side] ?? 0) + 1); this.tLast[side] = ts;
      const r = this.rec[side].recognizeForVideo(this.canvas, ts);
      hand.update(this.pick(r, 0, box, W, H), t);
    } else {
      const ts = Math.max(tMs, (this.tLast.F ?? 0) + 1); this.tLast.F = ts;
      const r = this.rec.F.recognizeForVideo(video, ts);
      // assign detected hands to her wrists by distance (handedness labels assume a mirrored selfie)
      const found = (r.landmarks || []).map((lm, i) => this.pick(r, i, [0, 0, W, H], W, H));
      for (const side of ['L', 'R']) {
        const w = f.pos(side === 'L' ? J.L_WR : J.R_WR);
        let best = null, bd = Infinity;
        for (const h of found) { const dx = h.lm[0].px - (w ? w[0] : 1e9), dy = h.lm[0].py - (w ? w[1] : 1e9), dd = dx * dx + dy * dy;
          if (dd < bd) { bd = dd; best = h; } }
        if (best && found.length > 1) found.splice(found.indexOf(best), 1);
        this[side].update(best, t);
      }
    }
    this.ms = performance.now() - t0;
  }

  drawCrop(video, [x, y, w, h], W, H) {       // clamp the source rect; pad the rest black
    const g = this.cx, S = HS.crop; g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    const sx = Math.max(0, x), sy = Math.max(0, y), ex = Math.min(W, x + w), ey = Math.min(H, y + h);
    if (ex <= sx || ey <= sy) return;
    g.drawImage(video, sx, sy, ex - sx, ey - sy, (sx - x) / w * S, (sy - y) / h * S, (ex - sx) / w * S, (ey - sy) / h * S);
  }

  // one detected hand → landmarks (also in video pixels, for drawing) + gesture
  pick(r, i, [x, y, w, h]) {
    if (!r || !r.landmarks || !r.landmarks[i]) return null;
    const lm = r.landmarks[i].map(p => ({ x: p.x, y: p.y, px: x + p.x * w, py: y + p.y * h }));
    const g = r.gestures && r.gestures[i] && r.gestures[i][0];
    return { lm, gesture: g ? g.categoryName : 'None', score: g ? g.score : 0, box: [x, y, w, h] };
  }

  // sources for the mapping matrix, and the total finger count
  sources() {
    const L = this.L, R = this.R;
    return { openL: L.seen ? L.open : 0, openR: R.seen ? R.open : 0,
             openMax: Math.max(L.seen ? L.open : 0, R.seen ? R.open : 0),
             fingers: ((L.seen ? L.fingers : 0) + (R.seen ? R.fingers : 0)) / 10 };
  }
  total() { return (this.L.seen ? this.L.fingers : 0) + (this.R.seen ? this.R.fingers : 0); }
  anySeen() { return this.L.seen || this.R.seen; }
}

export const HAND_EDGES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];

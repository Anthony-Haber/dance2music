// Hand openness for a full-body dancer. Her hands are small in the frame (full-frame
// detection found 2% of them on her clips), so the hand model runs on a crop around
// each wrist found by the pose, extended along the forearm, one hand per frame in turn
// (the method of the kinesonic app: crops found 52–55% of her hands).
//
// openness r = mean over the four fingers of |tip − wrist| / |knuckle − wrist|, in the
// hand's 3D world landmarks: ≈1.0 a fist … ≈2.0 an open palm. The log of it is the
// control (log r from ln 1.05 to ln 1.9 → 0..1), so equal changes of the hand are
// equal steps of the knob. A hand not seen holds its last value for HO.holdS, then
// glides to open, so losing the hand never silences the instrument by surprise.

export const HO = { crop: 256, cropTorso: 1.1, cropMinPx: 64, reach: 0.35,
                    rFist: 1.05, rOpen: 1.9, tau: 0.08, holdS: 1.0, release: 0.6 };
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';
const PT = { left: [15, 13], right: [16, 14] };     // wrist, elbow (pose)

// openness (0..1, log scale) from 21 landmarks {x, y, z}
export function openness(L) {
  let r = 0;
  for (const [tip, mcp] of [[8, 5], [12, 9], [16, 13], [20, 17]]) {
    const d = (a, b) => Math.hypot(L[a].x - L[b].x, L[a].y - L[b].y, (L[a].z || 0) - (L[b].z || 0));
    r += d(tip, 0) / Math.max(1e-6, d(mcp, 0));
  }
  r /= 4;
  return { r, open: Math.min(1, Math.max(0, Math.log(r / HO.rFist) / Math.log(HO.rOpen / HO.rFist))) };
}

export class Hands {
  constructor() {
    this.lm = null; this.n = 0; this.tLast = 0;
    this.h = { left: { open: 1, seen: false, last: -1e9, lm: null }, right: { open: 1, seen: false, last: -1e9, lm: null } };
    this.cv = document.createElement('canvas'); this.cv.width = this.cv.height = HO.crop; this.g = this.cv.getContext('2d');
  }
  async load(vision) {
    const o = delegate => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numHands: 1,
                             minHandDetectionConfidence: 0.3, minHandPresenceConfidence: 0.3, minTrackingConfidence: 0.3 });
    try { this.lm = await vision.mod.HandLandmarker.createFromOptions(vision.fileset, o('GPU')); }
    catch { this.lm = await vision.mod.HandLandmarker.createFromOptions(vision.fileset, o('CPU')); }
  }

  // f: the pose frame (measure.js, image pixels in f.geo.img); t seconds
  detect(video, f, t) {
    const side = this.n++ % 2 ? 'right' : 'left', H = this.h[side];
    if (this.lm && f) {
      const I = f.geo.img, w = I[PT[side][0]], e = I[PT[side][1]];
      if (w) {
        const c = e ? [w[0] + HO.reach * (w[0] - e[0]), w[1] + HO.reach * (w[1] - e[1])] : w;
        const sz = Math.max(HO.cropMinPx, HO.cropTorso * f.geo.torsoI), box = [c[0] - sz / 2, c[1] - sz / 2, sz, sz];
        this.crop(video, box);
        const ts = Math.max(t * 1000, this.tLast + 1); this.tLast = ts;
        const r = this.lm.detectForVideo(this.cv, ts);
        const lmk = r.landmarks && r.landmarks[0], wl = r.worldLandmarks && r.worldLandmarks[0];
        if (lmk) {
          const { open, r: ratio } = openness(wl || lmk), dt = Math.min(0.3, t - (H.tPrev ?? t)); H.tPrev = t;
          H.open += (1 - Math.exp(-Math.max(dt, 0.033) / HO.tau)) * (open - H.open); H.ratio = ratio;
          H.seen = true; H.last = t; H.lm = lmk.map(p => [box[0] + p.x * box[2], box[1] + p.y * box[3]]);
          return;
        }
      }
    }
    // not seen: hold, then glide to open
    if (t - H.last > HO.holdS) { H.seen = false; H.lm = null; H.open += (1 - Math.exp(-0.033 / HO.release)) * (1 - H.open); }
  }
  crop(video, [x, y, w, h]) {
    const g = this.g, S = HO.crop, W = video.videoWidth, Hh = video.videoHeight;
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    const sx = Math.max(0, x), sy = Math.max(0, y), ex = Math.min(W, x + w), ey = Math.min(Hh, y + h);
    if (ex > sx && ey > sy) g.drawImage(video, sx, sy, ex - sx, ey - sy, (sx - x) / w * S, (sy - y) / h * S, (ex - sx) / w * S, (ey - sy) / h * S);
  }
  sources() { const L = this.h.left, R = this.h.right; return { openL: L.open, openR: R.open, openMax: Math.max(L.open, R.open) }; }
}

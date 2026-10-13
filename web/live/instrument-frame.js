// Browser pose -> Python-compatible mirrored pixels. Raw landmark confidence
// gates geometry; retained display features never keep a lost wrist sounding.
export class InstrumentFrames {
  constructor() { this.reset(); }
  reset() { this.previous = null; }
  read(landmarks, hands, time_s, width, height) {
    const valid = p => p && [p.x, p.y].every(Number.isFinite) &&
      [p.visibility ?? 0, p.presence ?? p.visibility ?? 0].every(score =>
        Number.isFinite(score) && score >= 0.3 && score <= 1);
    const raw = landmarks?.length === 33 ? landmarks.map(p => valid(p) ? [(1 - p.x) * width, p.y * height] : null) : [];
    const reliableTorso = landmarks?.length === 33 && [11, 12, 23, 24].every(i =>
      valid(landmarks[i]) && landmarks[i].visibility >= 0.5 && (landmarks[i].presence ?? landmarks[i].visibility) >= 0.5);
    let torso_center = null, torso_px = null;
    if (reliableTorso) {
      const shoulder = raw[11].map((p, i) => (p + raw[12][i]) / 2);
      const hip = raw[23].map((p, i) => (p + raw[24][i]) / 2);
      const length = Math.hypot(shoulder[0] - hip[0], shoulder[1] - hip[1]);
      if (length >= 10) { torso_px = length; torso_center = shoulder.map((p, i) => (p + hip[i]) / 2); }
    }
    const dt = this.previous ? time_s - this.previous.time_s : 0;
    const alpha = 1 - Math.exp(-dt / 0.04);
    const pose_landmarks = raw.map((point, i) => {
      const old = this.previous?.pose_landmarks[i];
      return point && old && dt > 0 && dt <= 0.2 ? point.map((p, j) => old[j] + alpha * (p - old[j])) : point;
    });
    const observations = [];
    for (const [side, joint] of [['L', 16], ['R', 15]]) {
      const wrist = pose_landmarks[joint]; if (!wrist) continue;
      const h = hands?.[side], fresh = h?.seen && time_s - h.lastSeen <= 0.4;
      observations.push({ side, wrist, gesture: fresh ? h.gesture : 'None', confidence: fresh ? h.score : 0,
        raw_gesture: fresh ? h.rawG : 'None', raw_confidence: fresh ? h.rawScore : 0,
        gesture_since: fresh ? h.gestureSince : null });
    }
    let energy = 0;
    if (torso_px && this.previous && dt > 0 && dt <= 0.2) {
      const speeds = observations.flatMap(h => {
        const old = this.previous.hands.find(p => p.side === h.side);
        return old ? [Math.hypot(h.wrist[0] - old.wrist[0], h.wrist[1] - old.wrist[1]) / torso_px / dt] : [];
      });
      energy = Math.min(1, speeds.reduce((a, b) => a + b, 0) / Math.max(1, speeds.length) / 3);
    }
    const frame = { time_s, hands: observations, torso_center, torso_px, energy, pose_landmarks };
    this.previous = frame; return frame;
  }
}

export function instrumentChord(state) {
  return { key: `${state.root}:${state.quality}:${state.root_midi}`, symbol: state.symbol,
    degree: '', bass: Math.max(0, state.root_midi - 12), voices: state.notes, instrument: true };
}

export function cameraConstraints({ width, height, deviceId = '', facing = '', phone = false }) {
  return { audio: false, video: {
    ...(facing ? { facingMode: { ideal: facing } } : deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: phone ? 30 : 60 },
  } };
}

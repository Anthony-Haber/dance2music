// Portable raw observations, independent of the display's smoothing/retention.
const finite = x => Number.isFinite(x) ? x : null;
const xyz = p => [finite(p?.x), finite(p?.y), finite(p?.z)];
const points = (list, count) => Array.from({ length: count }, (_, i) => xyz(list?.[i]));
const categories = list => (list || []).map(c => ({ index: c.index ?? null,
  category_name: c.categoryName ?? null, display_name: c.displayName ?? null, score: finite(c.score) }));
export const copyJSON = value => JSON.parse(JSON.stringify(value,
  (_, x) => typeof x === 'number' ? finite(x) : x));

export function snapshotPose(result, error = null) {
  const lm = result?.landmarks?.[0];
  return { status: error ? 'error' : lm ? 'detected' : 'not_detected', error,
    detected: !!lm, pose_count: result?.landmarks?.length || 0,
    image_landmarks: points(lm, 33), world_landmarks: points(result?.worldLandmarks?.[0], 33),
    visibility: Array.from({ length: 33 }, (_, i) => finite(lm?.[i]?.visibility)),
    presence: Array.from({ length: 33 }, (_, i) => finite(lm?.[i]?.presence)) };
}

export function snapshotHandInference(result, box, width, height, taskTimestamp, side = null, inputSize = [width, height]) {
  const [x, y, w, h] = box;
  return { task_timestamp_ms: taskTimestamp, attempted_side: side,
    crop_px: box.slice(), input_size: inputSize.slice(),
    status: result.landmarks?.length ? 'detected' : 'not_detected', associations: {},
    candidates: (result.landmarks || []).map((lm, i) => ({
      candidate_index: i, detector_image_landmarks: points(lm, 21),
      image_landmarks: points(lm, 21).map(([a, b, c]) => [
        a === null ? null : (x + a * w) / width,
        b === null ? null : (y + b * h) / height,
        c === null ? null : c * w / width]),
      world_landmarks: points(result.worldLandmarks?.[i], 21),
      handedness: categories((result.handedness || result.handednesses)?.[i]),
      gestures: categories(result.gestures?.[i]),
    })) };
}

export function handDisplayState(hands, startMs) {
  const state = side => {
    const h = hands[side];
    return { seen: h.seen, last_observed_timestamp_s: h.lastSeen < 0 ? null : h.lastSeen - startMs / 1000,
      fingers: h.fingers, openness: h.open, gesture: h.gesture, gesture_score: h.score };
  };
  return { left: state('L'), right: state('R') };
}

export class Observations {
  constructor(startMs, metadata = {}) {
    this.startMs = startMs; this.count = 0; this.lastMs = -Infinity;
    this.chunks = []; this.lines = []; this.characters = 0; this.configurations = [];
    this.lastConfiguration = ''; this.lastMediaTime = null; this.lastSource = null; this.segment = 0;
    this.manifest = { schema: 'dance2music.recording', schema_version: 1,
      session_id: crypto.randomUUID(), created_at: new Date().toISOString(),
      timing: { mode: 'monotonic_inference', performance_origin_ms: startMs,
        observation_video_frame_alignment: 'independent_sampling' },
      landmark_layouts: { pose: 'mediapipe-pose-33-v1', hands: 'mediapipe-hand-21-v1' },
      coordinates: { image: 'normalized_inference_pixels', world: 'detector_world_meters',
        application_mirror_applied_to_inference: false, source_pixels_mirrored: 'unknown',
        hand_depth_transform: 'detector_z * crop_width / source_width' },
      ...copyJSON(metadata) };
  }

  configuration(value, nowMs) {
    const encoded = JSON.stringify(value);
    if (encoded !== this.lastConfiguration) {
      this.configurations.push({ timestamp_s: Math.max(0, (nowMs - this.startMs) / 1000),
        settings: copyJSON(value) });
      this.lastConfiguration = encoded;
    }
    return this.configurations.length - 1;
  }

  append({ nowMs, mediaTime, captureTime, expectedDisplayTime, presentedFrames, configuration, ...data }) {
    // Never invent repeated observations in the RAF fallback or across sessions.
    if (!Number.isFinite(nowMs) || nowMs < this.startMs || nowMs <= this.lastMs) return;
    const source = configuration.source?.id;
    const discontinuity = this.count > 0 && (source !== this.lastSource ||
      (Number.isFinite(mediaTime) && this.lastMediaTime !== null && mediaTime < this.lastMediaTime));
    if (discontinuity) this.segment++;
    const row = { frame_index: this.count++, timestamp_s: (nowMs - this.startMs) / 1000,
      task_timestamp_ms: nowMs, source_timestamp_s: finite(mediaTime),
      capture_timestamp_s: Number.isFinite(captureTime) ? (captureTime - this.startMs) / 1000 : null,
      expected_display_timestamp_s: Number.isFinite(expectedDisplayTime) ? (expectedDisplayTime - this.startMs) / 1000 : null,
      presented_frames: finite(presentedFrames), source_segment: this.segment,
      source_discontinuity: discontinuity, configuration_index: this.configuration(configuration, nowMs), ...data };
    const line = JSON.stringify(row, (_, x) => typeof x === 'number' ? finite(x) : x) + '\n';
    this.lines.push(line); this.characters += line.length;
    if (this.characters >= 256 * 1024) this.flush();
    this.lastMs = nowMs; this.lastMediaTime = finite(mediaTime); this.lastSource = source;
  }

  flush() {
    if (this.lines.length) this.chunks.push(new Blob(this.lines, { type: 'application/x-ndjson' }));
    this.lines = []; this.characters = 0;
  }

  finish(endMs) {
    this.flush();
    return { observations: new Blob(this.chunks, { type: 'application/x-ndjson' }),
      manifest: { ...this.manifest, duration_s: (endMs - this.startMs) / 1000,
        observation_count: this.count, configurations: this.configurations } };
  }
}

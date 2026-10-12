import { Observations, snapshotPose, snapshotHandInference, handDisplayState } from '../web/live/observations.js';
import { Hands } from '../web/live/hands.js';
import { Recorder, packageRecording } from '../web/live/recorder.js';
import { modelAsset } from '../web/live/model-assets.js';

function assert(ok, message) { if (!ok) throw new Error(message); }
function equal(actual, expected, message) { assert(JSON.stringify(actual) === JSON.stringify(expected), message); }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const landmark = i => ({ x: 0.1 + i / 100, y: 0.2 + i / 100, z: -i / 100, visibility: 0.9 });
const poseResult = () => ({ landmarks: [Array.from({ length: 33 }, (_, i) => landmark(i))],
  worldLandmarks: [Array.from({ length: 33 }, (_, i) => ({ x: i / 50, y: i / 60, z: -i / 70 }))] });
const handResult = () => ({ landmarks: [Array.from({ length: 21 }, (_, i) => landmark(i))],
  worldLandmarks: [Array.from({ length: 21 }, (_, i) => ({ x: i / 1000, y: i / 2000, z: -i / 3000 }))],
  handedness: [[{ index: 0, categoryName: 'Left', score: 0.94 }]],
  gestures: [[{ index: 1, categoryName: 'Open_Palm', score: 0.8 }]] });
const configuration = mode => ({ source: { id: 'fixture', type: 'camera', width: 640, height: 480 },
  pose_model: { family: 'PoseLandmarker', quality: 'full', asset_sha256: 'a'.repeat(64),
    runtime: { version: 'fixture' }, delegate: 'cpu', running_mode: 'video', num_poses: 1,
    detection_threshold: 0.5, presence_threshold: 0.5, tracking_threshold: 0.5, segmentation_masks: false },
  hands: { mode }, preview_mirrored: false, video_mirrored: false });

export async function runTests() {
  const passed = [];
  window.testProgress = passed;
  const result = poseResult(), raw = snapshotPose(result);
  result.landmarks[0][0].x = 9;
  assert(raw.image_landmarks[0][0] === 0.1, 'raw pose owns its values');
  assert(raw.presence.every(x => x === null), 'missing presence stays missing');
  equal(snapshotPose({}).image_landmarks, Array.from({ length: 33 }, () => [null, null, null]), 'no-pose dimensions');
  const invalid = poseResult(); invalid.landmarks[0][3].x = Infinity;
  assert(snapshotPose(invalid).image_landmarks[3][0] === null, 'nonfinite pose coordinate');
  passed.push('pose copying, confidence and missing data');

  const inference = snapshotHandInference(handResult(), [-10, 20, 200, 200], 640, 480, 1200, 'L');
  const p = inference.candidates[0];
  equal(p.image_landmarks[0], [10 / 640, 60 / 480, 0], 'crop xy including padding');
  assert(p.image_landmarks[1][2] === -0.01 * 200 / 640, 'crop z scaling');
  equal(p.world_landmarks[1], [0.001, 0.0005, -1 / 3000], 'world xyz unchanged');
  assert(p.handedness[0].score === 0.94 && p.gestures[0].category_name === 'Open_Palm', 'categories');
  passed.push('hand crop/depth/world/category preservation');

  const video = document.createElement('video');
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
  const g = canvas.getContext('2d'); g.fillStyle = '#24b'; g.fillRect(0, 0, 640, 480);
  const source = canvas.captureStream(30); video.srcObject = source; video.muted = true;
  const painter = setInterval(() => { g.fillStyle = `hsl(${performance.now() % 360} 60% 50%)`; g.fillRect(0, 0, 640, 480); }, 30);
  await video.play();
  const f = { pos: () => [200, 200], conf: () => 1, L: 100 };
  const hands = new Hands();
  hands.rec = { L: { recognizeForVideo: handResult }, R: { recognizeForVideo: handResult }, F: { recognizeForVideo: handResult } };
  assert(hands.detect(video, f, 1, true).status === 'disabled', 'off mode');
  hands.mode = 'far';
  const left = hands.detect(video, f, 1000, true), right = hands.detect(video, f, 1034, true);
  equal(left.inferences.map(i => i.attempted_side), ['L'], 'fresh left only');
  equal(right.inferences.map(i => i.attempted_side), ['R'], 'fresh right only');
  assert(handDisplayState(hands, 1000).left.last_observed_timestamp_s === 0, 'retained display has old time');
  assert(hands.detect(video, null, 1068, true).reason === 'pose_unavailable', 'pose gap');
  assert(hands.detect(video, { ...f, conf: () => 0 }, 1102, true).reason === 'wrist_unavailable', 'wrist gap');
  hands.rec.F.recognizeForVideo = () => ({}); hands.mode = 'near';
  const missing = hands.detect(video, f, 1136, true);
  assert(missing.inferences[0].status === 'not_detected' && !missing.inferences[0].candidates.length, 'no stale hands');
  passed.push('near/far/off, alternating freshness, pose/wrist/detection gaps');

  // Exact model-byte hashing and async mode changes without actual ML downloads.
  const asset = await modelAsset('/tests/fixture.task');
  const expectedHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('fixture-model'))),
    b => b.toString(16).padStart(2, '0')).join('');
  equal(asset.sha256, expectedHash, 'model digest');
  const loadingHands = new Hands();
  let resolveModel;
  const vision = { local: true, fileset: {}, mod: { GestureRecognizer: { createFromOptions: async (_, options) => {
    equal(Array.from(options.baseOptions.modelAssetBuffer), Array.from(new TextEncoder().encode('fixture-model')), 'exact task bytes');
    return new Promise(resolve => { resolveModel = resolve; });
  } } } };
  const loading = loadingHands.load(vision, 'near');
  assert(loadingHands.detect(video, f, 1, true).reason === 'model_loading', 'loading is a gap');
  while (!resolveModel) await wait(5);
  await loadingHands.load(vision, 'off'); resolveModel({ recognizeForVideo: handResult }); await loading;
  assert(loadingHands.mode === 'off' && !loadingHands.loading, 'stale model load cannot enable hands');
  await loadingHands.load(vision, 'near');
  equal(loadingHands.configuration().models.F.asset_sha256, expectedHash, 'effective model provenance');
  passed.push('model provenance and rapid async hand-mode changes');

  const observations = new Observations(1000);
  for (let i = 0; i < 240; i++) observations.append({ nowMs: 1000 + i * 34,
    mediaTime: i < 120 ? i / 30 : (i - 120) / 30, captureTime: 990 + i * 34,
    configuration: configuration(i < 80 ? 'off' : i < 160 ? 'far' : 'near'),
    pose: i === 30 ? snapshotPose({}) : raw,
    hands: i < 80 ? { status: 'disabled', inferences: [] } : i % 2 ? left : right,
    analysis: { events: [], unavailable: NaN } });
  observations.append({ nowMs: 1000, configuration: configuration('off') });
  assert(observations.count === 240, 'nonmonotonic frames excluded');
  assert(observations.chunks.length > 1, 'observations serialized incrementally');
  const fixture = observations.finish(9200);
  const rows = (await fixture.observations.text()).trim().split('\n').map(JSON.parse);
  assert(rows[120].source_discontinuity && rows[120].source_segment === 1, 'video loop segment');
  assert(rows[120].timestamp_s > rows[119].timestamp_s, 'loop keeps monotonic record time');
  assert(rows[0].capture_timestamp_s < 0, 'pre-roll capture time not clamped');
  equal(fixture.manifest.configurations.map(c => c.settings.hands.mode), ['off', 'far', 'near'], 'configuration timeline');
  assert(rows.every(r => r.analysis.unavailable === null), 'valid JSON missing values');
  const fixtureZip = await packageRecording({ ...fixture, mediaName: 'recording.webm', media: new Blob(['test media']) });
  window.fixtureZip = fixtureZip;
  passed.push('chunking, time gaps/loops, configuration timeline, ZIP/checksums fixture');

  const ctx = new AudioContext(), dest = ctx.createMediaStreamDestination(), osc = ctx.createOscillator();
  osc.connect(dest); osc.start(); await ctx.resume();
  const engine = { recordStream: () => dest.stream };
  const recorder = new Recorder();
  const options = { engine, video, overlay: canvas, mirror: () => true, label: () => ['C', 'I', 'white'],
    audioOnly: false, configuration: configuration('off') };
  recorder.start(options);
  let overlapRejected = false;
  try { recorder.start(options); } catch { overlapRejected = true; }
  assert(overlapRejected, 'overlapping start rejected');
  const recordPose = () => recorder.observe({ nowMs: performance.now(), mediaTime: video.currentTime,
    configuration: configuration('off'), pose: snapshotPose(poseResult()), hands: { status: 'disabled', inferences: [] } });
  recordPose(); await wait(350); recordPose();
  const saved = await recorder.stop();
  assert(saved.observations === 2 && !recorder.busy && !recorder.active, 'recording finalized');
  assert(dest.stream.getAudioTracks()[0].readyState === 'live', 'instrument stream not stopped');
  const zipped = new Uint8Array(await (await fetch(saved.url)).arrayBuffer());
  const files = window.fflate.unzipSync(zipped), manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  const mediaName = manifest.artifacts.media.path;
  const playback = document.createElement('video'); playback.muted = true;
  const playbackUrl = URL.createObjectURL(new Blob([files[mediaName]], { type: manifest.media.mime_type }));
  playback.src = playbackUrl; await playback.play();
  assert(playback.videoWidth === 640 && playback.videoHeight === 480, 'saved video decodes');
  playback.pause(); URL.revokeObjectURL(playbackUrl);
  passed.push('native video/audio recording, decoded playback, track ownership and overlap guard');

  recorder.start({ ...options, audioOnly: true }); recordPose(); await wait(150);
  const OriginalWorker = window.Worker;
  window.Worker = class { constructor() { throw new Error('injected worker failure'); } };
  let failed = false;
  try { await recorder.stop(); } catch { failed = true; }
  finally { window.Worker = OriginalWorker; }
  assert(failed && recorder.pending && !recorder.busy, 'failed packaging retained');
  assert(recorder.recoveryFiles().length === 3, 'recovery downloads');
  const retried = await recorder.retry();
  const audioFiles = window.fflate.unzipSync(new Uint8Array(await (await fetch(retried.url)).arrayBuffer()));
  const audioManifest = JSON.parse(new TextDecoder().decode(audioFiles['manifest.json']));
  assert(audioManifest.media.audio_only && audioManifest.observation_count === 1, 'audio-only keeps pose data');
  assert(!recorder.pending, 'retry releases retained bundle input');
  recorder.releaseDownloads();
  passed.push('audio-only, repeat session reset, worker failure, recovery and retry');
  clearInterval(painter); source.getTracks().forEach(t => t.stop()); video.pause(); await ctx.close();
  return { passed, fixtureSize: fixtureZip.size };
}

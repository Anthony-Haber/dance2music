import { Observations, snapshotPose, snapshotHandInference, handDisplayState } from '../web/live/observations.js';
import { Hands } from '../web/live/hands.js';
import { Recorder, packageRecording } from '../web/live/recorder.js';
import { modelAsset } from '../web/live/model-assets.js';
import { Engine } from '../web/live/audio.js';

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

async function unpack(saved) {
  const files = window.fflate.unzipSync(new Uint8Array(await (await fetch(saved.url)).arrayBuffer()));
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  for (const artifact of Object.values(manifest.artifacts)) {
    const bytes = files[artifact.path];
    assert(bytes.length === artifact.size_bytes, 'artifact size');
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      b => b.toString(16).padStart(2, '0')).join('');
    equal(digest, artifact.sha256, 'artifact SHA-256');
  }
  return { files, manifest };
}

async function microphoneTests(options, ctx, passed) {
  const originalAccess = navigator.mediaDevices.getUserMedia;
  const audioSessionDescriptor = Object.getOwnPropertyDescriptor(navigator, 'audioSession');
  Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { type: 'playback' } });
  const unlockEngine = new Engine(); unlockEngine.ctx = ctx;
  unlockEngine.keepAlive = { play: () => Promise.resolve() };
  const OriginalRecorder = window.MediaRecorder;
  const OriginalWorker = window.Worker;
  const micDest = ctx.createMediaStreamDestination(), micOsc = ctx.createOscillator();
  micOsc.frequency.value = 880; micOsc.connect(micDest); micOsc.start();
  const recorder = new Recorder();
  let requests = 0, micStream;
  const acquire = async constraints => {
    equal(constraints, { audio: true, video: false }, 'default microphone and processing constraints');
    // Reproduce Safari's exact failure if playback mode was not changed before access.
    if (!['auto', 'play-and-record'].includes(navigator.audioSession.type))
      throw new DOMException('AudioSession category is not compatible with audio capture.', 'InvalidStateError');
    requests++; micStream = new MediaStream(micDest.stream.getAudioTracks().map(track => track.clone()));
    return micStream;
  };
  const released = stream => {
    assert(stream.getTracks().every(t => t.readyState === 'ended'), 'microphone tracks released');
    equal(navigator.audioSession.type, 'playback', 'playback mode restored after microphone cleanup');
  };
  try {
    navigator.mediaDevices.getUserMedia = acquire;
    await recorder.start(options); await wait(120);
    const off = await unpack(await recorder.stop());
    assert(requests === 0 && off.manifest.microphone.outcome === 'disabled', 'default off never requests microphone');
    assert(!off.manifest.artifacts.microphone && Object.keys(off.files).length === 3, 'default bundle files unchanged');
    for (const audioOnly of [false, true]) {
      await recorder.start({ ...options, audioOnly, recordMicrophone: true });
      assert(recorder.microphone.outcome === 'recording', 'microphone active');
      unlockEngine.unlock();
      equal(navigator.audioSession.type, 'play-and-record', 'sound unlock keeps microphone-compatible audio session');
      recorder.observe({ nowMs: performance.now(), mediaTime: 0, configuration: configuration('off'), pose: snapshotPose({}) });
      await wait(450);
      const { files, manifest } = await unpack(await recorder.stop()); released(micStream);
      const mic = manifest.microphone, artifact = manifest.artifacts.microphone;
      assert(mic.selected && mic.outcome === 'complete' && !mic.error, 'microphone finalized');
      assert(mic.start_offset_s >= 0 && mic.end_offset_s > mic.start_offset_s && mic.end_offset_s <= manifest.duration_s + 0.1,
        'recording-relative microphone offsets');
      assert(mic.mime_type.startsWith('audio/') && mic.settings !== null, 'actual microphone MIME/settings');
      assert(/^microphone\.(m4a|webm)$/.test(artifact.path) && artifact.size_bytes > 0, 'separate microphone artifact');
      const player = document.createElement('audio');
      const url = URL.createObjectURL(new Blob([files[artifact.path]], { type: mic.mime_type }));
      player.src = url; await player.play(); player.pause(); URL.revokeObjectURL(url);
      if (audioOnly) {
        const frequency = async bytes => {
          const buffer = await ctx.decodeAudioData(bytes.slice().buffer), samples = buffer.getChannelData(0);
          const start = Math.floor(samples.length / 3), end = Math.floor(samples.length * 2 / 3);
          let crossings = 0;
          for (let i = start + 1; i < end; i++) if (samples[i - 1] < 0 && samples[i] >= 0) crossings++;
          return crossings * buffer.sampleRate / (end - start);
        };
        assert(Math.abs(await frequency(files[artifact.path]) - 880) < 30, 'microphone contains its own audio');
        assert(Math.abs(await frequency(files[manifest.artifacts.media.path]) - 440) < 30, 'instrument audio remains separate');
      }
    }
    passed.push('default-off permission guard, separate playable microphone in both modes, checksums, settings, offsets and unmixed audio');

    for (const name of ['NotAllowedError', 'NotFoundError']) {
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('injected acquisition failure', name); };
      await recorder.start({ ...options, recordMicrophone: true }); await wait(120);
      equal(navigator.audioSession.type, 'playback', 'denied/missing microphone restores playback');
      const { manifest, files } = await unpack(await recorder.stop());
      assert(manifest.microphone.outcome === 'unavailable' && manifest.microphone.error.includes(name), 'acquisition reason recorded');
      assert(!manifest.artifacts.microphone && files[manifest.artifacts.media.path].length, 'main recording survives microphone acquisition failure');
    }
    navigator.mediaDevices.getUserMedia = acquire;
    for (const failure of ['constructor', 'start', 'format']) {
      window.MediaRecorder = class extends OriginalRecorder {
        static isTypeSupported(type) { return failure === 'format' && type.startsWith('audio/') ? false : OriginalRecorder.isTypeSupported(type); }
        constructor(stream, config) {
          if (stream === micStream && failure === 'constructor') throw new Error('injected microphone initialization failure');
          super(stream, config); this.isMic = stream === micStream;
        }
        start(...args) { if (this.isMic && failure === 'start') throw new Error('injected microphone start failure'); super.start(...args); }
      };
      await recorder.start({ ...options, recordMicrophone: true }); released(micStream); await wait(120);
      const { manifest } = await unpack(await recorder.stop());
      assert(manifest.microphone.outcome === 'unavailable' && manifest.microphone.error, 'microphone initialization failure recorded');
      assert(!manifest.artifacts.microphone && manifest.artifacts.media.size_bytes, 'main recording survives initialization failure');
    }
    window.MediaRecorder = OriginalRecorder;
    await recorder.start({ ...options, recordMicrophone: true });
    recorder.microphoneRec.ondataavailable = () => {}; await wait(120);
    const empty = await unpack(await recorder.stop()); released(micStream);
    assert(empty.manifest.microphone.outcome === 'no_audio' && !empty.manifest.artifacts.microphone, 'empty microphone capture omits artifact');
    // Failure of main startup must also release an already acquired microphone.
    let paints = 0;
    for (const failureOptions of [
      { engine: { recordStream: () => { throw new Error('main startup failed'); } } },
      { mirror: () => { if (++paints === 2) throw new Error('main painting failed after both recorders started'); return false; } },
    ]) {
      let rejected = false;
      try { await recorder.start({ ...options, recordMicrophone: true, ...failureOptions }); }
      catch { rejected = true; }
      assert(rejected && !recorder.starting && !recorder.recording, 'main startup failure clears startup'); released(micStream);
      assert(recorder.ownedTracks.length === 0, 'failed main startup releases owned tracks');
    }
    passed.push('denied/missing microphone, unsupported format, constructor/start failures and main startup cleanup');

    for (const interruption of ['disconnect', 'error', 'stop']) {
      const statuses = [];
      await recorder.start({ ...options, recordMicrophone: true, onMicrophoneStatus: value => statuses.push(value.outcome) });
      const capturedStream = micStream; await wait(250);
      if (interruption === 'disconnect') capturedStream.getAudioTracks()[0].dispatchEvent(new Event('ended'));
      else if (interruption === 'error') recorder.microphoneRec.onerror({ error: new Error('injected microphone error') });
      else recorder.microphoneRec.stop();
      await wait(50); released(capturedStream);
      assert(recorder.active && statuses.includes('interrupted'), 'main capture continues and microphone status updates');
      recorder.observe({ nowMs: performance.now(), configuration: configuration('off'), pose: snapshotPose({}) });
      const { manifest } = await unpack(await recorder.stop());
      assert(manifest.microphone.outcome === 'interrupted' && manifest.microphone.error && manifest.artifacts.microphone.size_bytes,
        'interrupted microphone audio preserved');
      assert(manifest.observation_count === 1 && manifest.media.complete, 'observations/main media continue');
    }
    passed.push('microphone disconnect/error/unexpected stop preserves available audio and continues main capture');

    let resolveAccess;
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { resolveAccess = resolve; });
    const starting = recorder.start({ ...options, recordMicrophone: true });
    assert(recorder.starting, 'permission pending');
    unlockEngine.unlock();
    equal(navigator.audioSession.type, 'play-and-record', 'pending permission keeps capture-compatible mode through sound unlock');
    let overlapRejected = false;
    try { await recorder.start(options); } catch { overlapRejected = true; }
    assert(overlapRejected, 'overlap blocked while requesting permission');
    recorder.cancelStart(); assert(await starting === null && !recorder.starting, 'pending permission cancelled immediately');
    await recorder.start(options); // A superseding recording must survive the old permission response.
    const late = new MediaStream(micDest.stream.getAudioTracks().map(track => track.clone()));
    resolveAccess(late); await wait(0); released(late);
    assert(recorder.active && recorder.microphone.outcome === 'disabled', 'late permission cannot change newer recording');
    await wait(120); await recorder.stop();
    let rejectAccess;
    navigator.mediaDevices.getUserMedia = () => new Promise((_, reject) => { rejectAccess = reject; });
    const denying = recorder.start({ ...options, recordMicrophone: true }); recorder.cancelStart(); await denying;
    rejectAccess(new DOMException('late denial', 'NotAllowedError')); await wait(0);
    assert(!recorder.recording && !recorder.starting, 'late denial after cancellation ignored');
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { resolveAccess = resolve; });
    const racing = recorder.start({ ...options, recordMicrophone: true });
    const arriving = await acquire({ audio: true, video: false });
    resolveAccess(arriving); queueMicrotask(() => recorder.cancelStart());
    assert(await racing === null, 'cancellation during stream handoff'); released(arriving);
    // A cancelled request's eventual stream must not reset a newer capture's mode.
    const oldStart = recorder.start({ ...options, recordMicrophone: true });
    const resolveOld = resolveAccess;
    recorder.cancelStart(); await oldStart;
    navigator.mediaDevices.getUserMedia = acquire;
    await recorder.start({ ...options, recordMicrophone: true });
    const staleStream = new MediaStream(micDest.stream.getAudioTracks().map(track => track.clone()));
    resolveOld(staleStream); await wait(0);
    assert(staleStream.getTracks().every(track => track.readyState === 'ended'), 'stale capture released');
    equal(navigator.audioSession.type, 'play-and-record', 'stale permission does not reset newer capture audio session');
    await wait(120); await recorder.stop(); released(micStream);
    passed.push('permission pending overlap guard, cancellation, late stream cleanup, superseded session and late denial');
    passed.push('Safari audio-session rejection regression, sound unlock during capture/permission, playback restoration and stale-request isolation');

    navigator.mediaDevices.getUserMedia = acquire;
    await recorder.start({ ...options, audioOnly: true, recordMicrophone: true }); await wait(250);
    window.Worker = class { constructor() { throw new Error('injected microphone packaging failure'); } };
    let failed = false;
    try { await recorder.stop(); } catch { failed = true; }
    finally { window.Worker = OriginalWorker; }
    released(micStream);
    assert(failed && recorder.pending.microphone.size, 'microphone retained for retry');
    const recovery = recorder.recoveryFiles();
    assert(recovery.length === 4 && recovery.some(f => f.name.startsWith('microphone.')), 'microphone recovery download');
    const microphoneRecovery = await (await fetch(recovery.find(f => f.name.startsWith('microphone.')).url)).arrayBuffer();
    const { manifest, files } = await unpack(await recorder.retry());
    equal(Array.from(new Uint8Array(microphoneRecovery)), Array.from(files[manifest.artifacts.microphone.path]), 'retry retains identical microphone bytes');
    let sizeRejected = false;
    try { await packageRecording({ media: new Blob(['main']), mediaName: 'recording.webm', observations: new Blob(),
      microphone: { size: 0xffffffff }, manifest: {} }); } catch (error) { sizeRejected = error.message.includes('4 GB'); }
    assert(sizeRejected, 'microphone included in ZIP size limit');
    const progress = [];
    const progressZip = await packageRecording({ media: new Blob(['main']), mediaName: 'recording.webm',
      observations: new Blob(), microphone: new Blob([new Uint8Array(700 * 1024)]), microphoneName: 'microphone.webm', manifest: {} },
    value => progress.push(value));
    assert(progress[0] === 0 && progress.some(value => value > 0 && value < 99) && progress.at(-1) === 99,
      'ZIP progress counts microphone bytes');
    const progressFiles = window.fflate.unzipSync(new Uint8Array(await progressZip.arrayBuffer()));
    assert(progressFiles['microphone.webm'].length === 700 * 1024, 'microphone packaged without truncation');
    passed.push('microphone ZIP recovery/retry and ZIP32 size bound');
  } finally {
    navigator.mediaDevices.getUserMedia = originalAccess; window.MediaRecorder = OriginalRecorder; window.Worker = OriginalWorker;
    recorder.cancelStart(); if (recorder.recording) await recorder.stop();
    recorder.releaseMicrophone(); recorder.releaseDownloads(); micOsc.stop(); micDest.stream.getTracks().forEach(track => track.stop());
    if (audioSessionDescriptor) Object.defineProperty(navigator, 'audioSession', audioSessionDescriptor);
    else delete navigator.audioSession;
  }
}

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
  await recorder.start(options);
  let overlapRejected = false;
  try { await recorder.start(options); } catch { overlapRejected = true; }
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

  await recorder.start({ ...options, audioOnly: true }); recordPose(); await wait(150);
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
  await microphoneTests(options, ctx, passed);
  clearInterval(painter); source.getTracks().forEach(t => t.stop()); video.pause(); await ctx.close();
  return { passed, fixtureSize: fixtureZip.size };
}

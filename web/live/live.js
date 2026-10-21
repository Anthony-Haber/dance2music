// Dance2Music Live: camera → MediaPipe Pose → causal features → Web Audio.
import { Features, P, EDGES, J, PART_J, PARTS } from './features.js';
import { ChordFollower, H as HP } from './harmony.js';
import { Engine } from './audio.js';
import { SOURCES, DESTS, PRESETS, defaults, applyPreset, evaluate } from './mapping.js';
import { Bounce } from './bounce.js';
import { Hands, GESTURES, HAND_EDGES } from './hands.js';
import { Recorder } from './recorder.js';
import { SceneController } from './scene/controller.js';
import { ScenePointerControls } from './scene/drag.js';
import { sceneMode, isPercussion, SCENE_MODES, INSTRUMENTS } from './scene/instruments.js';
import { modelAsset, runtimeIdentity } from './model-assets.js';
import { snapshotPose, handDisplayState } from './observations.js';
import { MagentaScene } from './magenta.js';
import { PianoPlayer } from './piano.js';
import { availability, availableScene, downloadLink as appDownloadLink } from './app-availability.js';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/';
const MODEL = m => `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${m}/float16/1/pose_landmarker_${m}.task`;
const LOCAL = 'vendor/mediapipe/';       // `python live.py --offline` fills this

const $ = id => document.getElementById(id);
const magentaAvailability = await availability();
const magentaOption = $('sceneMode').querySelector('[value="magenta"]');
if (magentaAvailability.mobile) magentaOption.remove();
else if (!magentaAvailability.available) {
  magentaOption.disabled = true;
  magentaOption.textContent = 'Google Magenta (Mac app required)';
  $('magentaInstall').hidden = false;
  if (magentaAvailability.local) $('magentaInstallStatus').textContent = magentaAvailability.message || 'Open Dance2Music and complete setup, then reload this page.';
  else appDownloadLink($('magentaDownload'), $('magentaInstallStatus'));
}
const v = $('v'), cv = $('c'), g = cv.getContext('2d');
const store = {
  get(k, d) { try { const x = localStorage.getItem('d2m:' + k); return x === null ? d : JSON.parse(x); } catch (e) { return d; } },
  set(k, x) { try { localStorage.setItem('d2m:' + k, JSON.stringify(x)); } catch (e) {} },
};

let vision = null, landmarker = null, landmarkerKey = '', stream = null, running = false;
let poseModel = null, modelGeneration = 0, currentSource = null;
let starting = false, stopping = false, sessionGeneration = 0, sourceGeneration = 0, sourceURL = null;
const sceneWanted = () => $('sceneMode').value !== 'none' && $('source').value === 'camera';
const scene = new SceneController({canvas: $('sceneLayer'), onChange: () => recordConfiguration(),
  onPianoEvent: event => piano.event(event,scene),
  onStatus: ({state, message}) => {
    $('sceneStatus').textContent = message;
    $('sceneStatus').hidden = state === 'off';
    $('sceneRescan').disabled = !['active', 'empty'].includes(state);
    if (state === 'failed') disableSceneMask();
  }});
const feats = new Features(), engine = new Engine();
const piano = new PianoPlayer(engine);
let follower = new ChordFollower(store.get('mode', 'six'));
const bounce = new Bounce(), hands = new Hands(), recorder = new Recorder();
const magenta = new MagentaScene(engine,scene,{store,mirror:()=>$('mirror').value==='1',onChange:()=>recordConfiguration()});
let lastBounce = null, lastCapMs = 0;
let lastVals = null, lastF = null, flashes = [], fpsT = [], inferMs = 0, t0 = performance.now();

async function disableSceneMask() {
  const target = landmarker;
  if (!poseModel?.segmentation_masks || !target?.setOptions) return;
  try {
    await target.setOptions({outputSegmentationMasks: false});
    if (landmarker !== target) return;
    poseModel = {...poseModel, segmentation_masks: false};
    landmarkerKey = poseModel.quality + ':false'; recordConfiguration();
  } catch {}
}

// ── setup ───────────────────────────────────────────────────────────
const exists = async url => { try { return (await fetch(url, { method: 'HEAD' })).ok; } catch (e) { return false; } };

async function loadLandmarker() {
  const model = $('model').value;
  const generation = ++modelGeneration, masks = sceneWanted(), key = model + ':' + masks;
  if (landmarker && landmarkerKey === key) return landmarker;
  status('loading pose model…');
  if (!vision) {
    const local = await exists(LOCAL + 'vision_bundle.mjs');
    const base = local ? new URL(LOCAL, location.href).href : MP;
    const mod = await import(base + 'vision_bundle.mjs');
    vision = { mod, fileset: await mod.FilesetResolver.forVisionTasks(base + 'wasm'), local, base };
  }
  const localModel = LOCAL + `pose_landmarker_${model}.task`;
  const path = (await exists(localModel)) ? localModel : MODEL(model);
  const asset = await modelAsset(path);
  const opts = delegate => ({ baseOptions: { modelAssetBuffer: asset.bytes, delegate }, runningMode: 'VIDEO',
                              numPoses: 1, outputSegmentationMasks: masks, minPoseDetectionConfidence: 0.5,
                              minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
  let delegate = 'GPU', loaded;
  try { loaded = await vision.mod.PoseLandmarker.createFromOptions(vision.fileset, opts(delegate)); }
  catch (e) { delegate = 'CPU'; loaded = await vision.mod.PoseLandmarker.createFromOptions(vision.fileset, opts(delegate)); }
  if (generation !== modelGeneration) { loaded.close(); return landmarker; }
  if (landmarker) landmarker.close();
  landmarker = loaded;
  landmarkerKey = key;
  poseModel = { family: 'PoseLandmarker', quality: model, asset: path, asset_sha256: asset.sha256,
    runtime: runtimeIdentity(vision), delegate: delegate.toLowerCase(), running_mode: 'video', num_poses: 1,
    detection_threshold: 0.5, presence_threshold: 0.5, tracking_threshold: 0.5, segmentation_masks: masks };
  recordConfiguration();
  return landmarker;
}

async function listDevices() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  const cams = devs.filter(d => d.kind === 'videoinput');
  const want = store.get('cam', '');
  $('cam').innerHTML = cams.map((d, i) =>
    `<option value="${d.deviceId}" ${d.deviceId === want ? 'selected' : ''}>${d.label || 'camera ' + (i + 1)}</option>`).join('')
    || '<option value="">no camera found</option>';
  const outs = devs.filter(d => d.kind === 'audiooutput');
  const canSink = 'setSinkId' in AudioContext.prototype;
  $('outRow').hidden = !canSink;
  if (canSink) {
    const wantOut = store.get('out', '');
    $('out').innerHTML = '<option value="">system default</option>' + outs.filter(d => d.deviceId !== 'default')
      .map(d => `<option value="${d.deviceId}" ${d.deviceId === wantOut ? 'selected' : ''}>${d.label || 'output'}</option>`).join('');
  }
}

async function openCamera() {
  const generation = ++sourceGeneration, session = sessionGeneration;
  const [w, h] = $('res').value.split('x').map(Number);
  const id = $('cam').value;
  if (stream) stream.getTracks().forEach(t => t.stop());
  const opened = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
    deviceId: id ? { exact: id } : undefined, width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 60 } } });
  if (generation !== sourceGeneration || session !== sessionGeneration) { opened.getTracks().forEach(t => t.stop()); return; }
  stream = opened;
  if (sourceURL) { URL.revokeObjectURL(sourceURL); sourceURL = null; }
  v.srcObject = stream; v.src = '';
  await v.play();
  if (generation !== sourceGeneration || session !== sessionGeneration) return;
  currentSource = { id: crypto.randomUUID(), type: 'camera', width: v.videoWidth, height: v.videoHeight };
  recordConfiguration();
  await listDevices();               // labels appear only after permission
}

async function openFile() {
  const generation = ++sourceGeneration, session = sessionGeneration;
  const f = $('file').files[0];
  if (!f) throw new Error('choose a video file first');
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (sourceURL) URL.revokeObjectURL(sourceURL);
  v.srcObject = null; v.src = sourceURL = URL.createObjectURL(f); v.loop = true; v.muted = true;
  await v.play();
  if (generation !== sourceGeneration || session !== sessionGeneration) return;
  currentSource = { id: crypto.randomUUID(), type: 'file', file_name: f.name, size_bytes: f.size,
    last_modified_ms: f.lastModified, width: v.videoWidth, height: v.videoHeight };
  recordConfiguration();
}

function lockSessionOptions() {
  $('sceneMode').disabled = running || starting || stopping || $('source').value !== 'camera';
  for (const id of ['source', 'cam', 'res', 'model', 'file']) $(id).disabled = starting || stopping;
  $('sceneControls').hidden = !sceneWanted();
  $('magentaControls').hidden = !magentaAvailability.available||$('sceneMode').value!=='magenta'||!sceneWanted();
  const isPiano=$('sceneMode').value==='floor-piano';
  $('pianoControls').hidden=!isPiano;
  const percussion=isPercussion($('sceneMode').value);
  $('sceneTouchRow').hidden=percussion||$('sceneMode').value==='magenta'||isPiano;
  $('sceneDragHelp').textContent=isPiano?'Drag the whole keyboard onto clear detected floor. At an edge it settles at the closest fitting spot. Esc cancels; Rescan rebuilds placement. Dragging releases all notes.':'Drag an object with the mouse to move it onto a detected floor or tabletop. At an edge, it settles at the closest fitting spot. Show surfaces reveals available areas. Esc cancels a drag; Rescan resets positions.';
  $('sceneInteractionHelp').textContent=percussion
    ? SCENE_MODES[$('sceneMode').value].instruments.map(id=>INSTRUMENTS[id].label).join(' · ')+'. Tap or bump with any body part for sound and sparks. Pull your hand or foot back and tap again to repeat; resting contact plays once. Adjust “objects” in Mix. Touches are approximate.'
    : 'Tap a shape with a hand or foot for sparks and a note in the current chord. Adjust “objects” in Mix. Touches are approximate.';
  $('sceneTouchHelp').textContent=percussion
    ? 'Yellow boxes surround instruments. Cyan dots have body depth; yellow dots are waiting for depth. Gaps between instrument parts do not trigger hits.'
    : 'Yellow boxes are touch areas. Cyan dots have hand/foot depth; yellow dots are still waiting for depth.';
  if($('sceneMode').value==='magenta')$('sceneInteractionHelp').textContent='Approach a colored prompt with any visible body part to change the music. Click its label to edit. Sidebar prompts remain available when objects are hidden.';
  if(isPiano){
    $('sceneInteractionHelp').textContent='Step onto a key with a visible foot near the floor. Hold to let the piano decay. Lift your foot or jump, then land on the same key to replay; stepping off also damps it. Use Objects in Mix for volume. Clear the floor during scanning. Foot contact is approximate.';
    $('sceneTouchHelp').textContent='Cyan dots have foreground foot depth. Only toes (or heels when toes are uncertain) close to the floor play keys. Hands and knees do not play.';
  }
  $('sceneNote').textContent = $('source').value === 'camera'
    ? 'Live camera · stop to change · Chrome on Apple Silicon' : '3D objects are unavailable for video files.';
}
async function start() {
  if (starting || running || stopping) return;
  $('sceneMode').value = availableScene($('sceneMode').value, magentaAvailability.available);
  store.set('sceneMode', $('sceneMode').value);
  scene.setMode($('sceneMode').value);
  const generation = ++sessionGeneration;
  lastF = null;
  starting = true; $('go').textContent = 'Cancel'; lockSessionOptions();
  engine.unlock();
  try {
    status('opening source…');
    if ($('source').value === 'camera') await openCamera(); else await openFile();
    if (generation !== sessionGeneration) return;
    $('hint').hidden = true;
    draw();
    await loadLandmarker();
    if (generation !== sessionGeneration) return;
    feats.reset(); follower.reset(); bounce.reset(); bounceOn = false;
    if ($('handMode').value !== 'off') status('loading hand model…');
    await hands.load(vision, $('handMode').value);
    if (generation !== sessionGeneration) return;
    if(sceneWanted()&&$('sceneMode').value==='floor-piano'){
      await piano.load(message=>{$('pianoStatus').textContent=message;});
      if(generation!==sessionGeneration)return;
      $('pianoStatus').textContent='Piano samples ready';
    }
    if (sceneWanted()) await scene.start(v, currentSource.id, $('sceneMode').value);
    if (generation !== sessionGeneration) return;
    await engine.start($('out').value || undefined);
    if (generation !== sessionGeneration) { await engine.stop(); return; }
    applyMix(); applySens(); watchAudio();
    piano.setListening($('pianoListening').value,sceneWanted()&&$('sceneMode').value==='floor-piano');
    running = true; starting = false; $('badge').hidden = false;
    $('go').textContent = 'Stop'; $('go').disabled = false; lockSessionOptions();
    $('rec').disabled = !window.MediaRecorder || recorder.busy || !!recorder.pending;
    status('camera running — waiting for movement');
    loop();
    if(sceneWanted()&&$('sceneMode').value==='magenta')magenta.start();
  } catch (e) {
    if (generation !== sessionGeneration) return;
    await stop(); status('could not start: ' + e.message);
    if($('sceneMode').value==='floor-piano')$('pianoStatus').textContent=e.message;
  }
}

async function stop() {
  if (stopping) return;
  stopping = true; starting = false; ++sessionGeneration; ++sourceGeneration; ++modelGeneration;
  running = false; scene.stop(); $('go').disabled = true; lockSessionOptions();
  piano.stop();
  const magentaStopped=magenta.stop();
  if (recorder.starting) cancelRecordingStart();
  // Include the note-off damping tail in the final audible mix and the events
  // in final_analysis even when pose callbacks have already stopped.
  if(recorder.recording&&$('sceneMode').value==='floor-piano')await new Promise(resolve=>setTimeout(resolve,180));
  if (recorder.recording) await finishRecording();
  $('rec').disabled = true;
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null; v.pause();
  await magentaStopped;piano.dispose();await engine.stop();
  stopping = false; $('go').textContent = 'Start'; $('go').disabled = false;
  $('hint').hidden = false; $('tap').hidden = true; lockSessionOptions(); status('stopped');
}

// iOS can leave the context suspended, or interrupt it when the camera
// starts or a call comes in: then one more tap brings the sound back.
function watchAudio() {
  const ctx = engine.ctx; if (!ctx) return;
  const check = () => { $('tap').hidden = !running || ctx.state === 'running'; };
  ctx.onstatechange = check; setTimeout(check, 800);
}
$('tap').onclick = () => { engine.unlock(); setTimeout(() => { if (engine.ctx) $('tap').hidden = engine.ctx.state === 'running'; }, 300); };
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && running && engine.ctx && engine.ctx.state !== 'running') $('tap').hidden = false; });

// ── the loop: one pose per new video frame ────────────────────────────
function loop() {
  const generation = sessionGeneration;
  if (!running) return;
  let lastVideoTime = null;
  const next = () => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(frame) : requestAnimationFrame(frame));
  function frame(nowCb, meta) {
    if (!running || generation !== sessionGeneration) return;
    if (v.readyState >= 2 && landmarker) {
      if (!meta && v.currentTime === lastVideoTime) { next(); return; }
      lastVideoTime = v.currentTime;
      const now = performance.now(), W = v.videoWidth, H = v.videoHeight;
      // when the camera took this frame (same clock as performance.now); the
      // bounce tracker and the groove use it so the beat lands on the real body
      const capMs = (meta && (meta.captureTime || meta.expectedDisplayTime)) || now;
      const timing = { nowMs: now, mediaTime: meta?.mediaTime ?? v.currentTime,
        captureTime: meta?.captureTime, expectedDisplayTime: meta?.expectedDisplayTime,
        presentedFrames: meta?.presentedFrames };
      let rawPose = null, rawHands = { mode: hands.mode, status: 'skipped', reason: 'pose_error', inferences: [] };
      try { landmarker.detectForVideo(v, now, res => {
        inferMs = performance.now() - now;
        scene.copyPerson(res.segmentationMasks?.[0], now);
        rawPose = recorder.active ? snapshotPose(res) : null;
        const lms = res.landmarks && res.landmarks[0];
        scene.observePose(lms,now);
        magenta.observe(lms,now);
        const touchEvents=scene.takeTouchEvents();
        const t = (now - t0) / 1000;
        const f = lms ? feats.update(lms.map(p => ({ x: p.x, y: p.y, visibility: p.visibility })), t, W, H) : null;
        try { rawHands = hands.detect(v, f, now, recorder.active); }
        catch (error) { rawHands = { mode: hands.mode, status: 'error', error: error.message, inferences: [] }; }
        if (f) {
          // hips: raw landmark heights (no smoothing: the filter is the smoothing)
          const lh = lms[23], rh = lms[24];
          if (lh && rh && (lh.visibility ?? 1) > 0.5 && (rh.visibility ?? 1) > 0.5)
            lastBounce = bounce.update(-((lh.y + rh.y) / 2) * H / f.L, capMs / 1000);
          lastCapMs = capMs;
          const bo = lastBounce;
          Object.assign(f, hands.sources(), { bounce: bo ? bo.prob : 0,
                                              bounceTempoN: bo ? Math.min(1, Math.max(0, (bo.tempo - 50) / 130)) : 0 });
          gestureActions(t);
          follower.update(f, t, hands, frozen);
          engine.setChord(follower.chord());
          lastVals = evaluate(mapping, f);
          updateBounceGate(bo, t);
          const drums = { hits: drumMode.includes('hits'), groove: drumMode.includes('body'),
                          clock: t - engine.ctx.currentTime, enabled: drumsEnabled,
                          bounce: drumMode.includes('bounce') && bounceOn && drumsEnabled ? bo : null,
                          offsetMs: +$('syncOff').value, accent: $('accent').value };
          engine.update(f, lastVals, DESTS, mirror(), drums);
          for (const ev of f.events) flashes.push({ ...ev, t0: now });
        } else engine.idle();
        for(const event of touchEvents)event.sound=engine.touchObject(event,mirror());
        lastF = f;
        if (recorder.active) recorder.observe({ ...timing, configuration: recordingConfiguration(),
          pose: rawPose, hands: rawHands,
          analysis: { features: f, hand_display_state: handDisplayState(hands, recorder.t0),
            bounce: lastBounce, chord: follower.chord(), mapped_controls: f ? lastVals : null,
            drums_enabled: drumsEnabled, bounce_gate: bounceOn, chord_held: frozen,
            feature_clock_offset_s: (t0 - recorder.t0) / 1000,
            gesture_transitions: f ? frameGestureEvents : [],
            ...($('sceneMode').value==='magenta'?{magenta_events:magenta.takeEvents(recorder.t0),magenta_weights:[...magenta.spatial.weights]}:{}),
            ...($('sceneMode').value==='floor-piano'?{piano_events:piano.takeEvents(recorder.t0)}:{}),
            scene_touch_events: touchEvents.filter(event=>event.effect_timestamp_ms>=recorder.t0).map(event=>({...event,timestamp_s:(event.timestamp_ms-recorder.t0)/1000})) } });
      }); } catch (error) {
        if (recorder.active) recorder.observe({ ...timing, configuration: recordingConfiguration(),
          pose: rawPose || snapshotPose(null, error.message), hands: rawHands, analysis: null, analysis_error: error.message });
        status('frame analysis failed: ' + error.message);
      }
      scene.pose(now);
      fpsT.push(now); while (fpsT.length && fpsT[0] < now - 1000) fpsT.shift();
      draw();
    }
    next();
  }
  next();
}

// the groove starts after P(bouncing) has stayed above 0.8 for 0.8 s and
// stops after it has stayed below 0.4 for 1 s
let bounceOn = false, bounceSince = 0;
function updateBounceGate(bo, t) {
  const p = bo ? bo.prob : 0, want = bounceOn ? p > 0.4 : p > 0.8;
  if (want === bounceOn) bounceSince = t;
  else if (t - bounceSince >= (bounceOn ? 1.0 : 0.8)) { bounceOn = want; bounceSince = t; }
}

// ── gestures → actions ──────────────────────────────────────────────
const ACTIONS = [['none', '—'], ['hold', 'hold the chord (while shown)'], ['drumsOn', 'drums on'],
                 ['drumsOff', 'drums off'], ['drumsToggle', 'drums on/off'], ['nextPreset', 'next mapping preset'],
                 ['nextMode', 'next harmony mode'], ['mute', 'mute / unmute']];
const DEFAULT_ACTIONS = { Closed_Fist: 'hold', Open_Palm: 'none', Pointing_Up: 'none', Thumb_Up: 'drumsOn',
                          Thumb_Down: 'drumsOff', Victory: 'nextPreset', ILoveYou: 'mute' };
let actions = { ...DEFAULT_ACTIONS, ...store.get('actions', {}) };
let frozen = false, drumsEnabled = true, lastG = { L: 'None', R: 'None' }, gestureLog = '';
let frameGestureEvents = [];
function gestureActions(t) {
  frameGestureEvents = [];
  frozen = false;
  for (const side of ['L', 'R']) {
    const h = hands[side], g = h.seen ? h.gesture : 'None';
    if (actions[g] === 'hold') frozen = true;
    if (g === lastG[side]) continue;
    lastG[side] = g;
    frameGestureEvents.push({ side, gesture: g, action: actions[g] || 'none' });
    const a = actions[g]; if (!a || a === 'none' || a === 'hold') continue;
    if (a === 'drumsOn') drumsEnabled = true;
    else if (a === 'drumsOff') drumsEnabled = false;
    else if (a === 'drumsToggle') drumsEnabled = !drumsEnabled;
    else if (a === 'nextPreset') { const names = Object.keys(PRESETS), i = (names.indexOf(lastPreset) + 1) % names.length;
      lastPreset = names[i]; mapping = applyPreset(lastPreset, custom); mapChanged(); }
    else if (a === 'nextMode') { const ms = ['six', 'fingers', 'twofive', 'twofive_alt', 'fixed'];
      $('mode').value = ms[(ms.indexOf($('mode').value) + 1) % ms.length]; $('mode').onchange(); }
    else if (a === 'mute') engine.masterLevel(engine.master && engine.master.gain.value > 0 ? 0 : mix.master.vol);
    gestureLog = `${side === 'L' ? 'left' : 'right'} ${g.replace('_', ' ')} → ${ACTIONS.find(x => x[0] === a)[1]}`;
  }
}
let lastPreset = 'Moving = sound';

const mirror = () => $('mirror').value === '1';
const scenePointer=new ScenePointerControls(cv,scene,{mirror,onHint:message=>{
  $('sceneDragStatus').textContent=message;$('sceneDragStatus').hidden=!message;
}});

// ── drawing ─────────────────────────────────────────────────────────
const COL = { lhand: '#ffaa50', rhand: '#5ab4ff', lfoot: '#78dc78', rfoot: '#f078c8', head: '#ddd' };
const DEG = { I: '#78dc78', ii: '#5ab4ff', iii: '#5ac8c8', IV: '#c88ce6', V: '#ffaa50', vi: '#fa78a0', '': '#efe9df' };

function draw() {
  const W = v.videoWidth, H = v.videoHeight;
  const box = $('stage').getBoundingClientRect();
  const s = Math.min(box.width / W, box.height / H);
  const dw = Math.round(W * s), dh = Math.round(H * s);
  if (cv.width !== Math.round(dw * devicePixelRatio) || cv.height !== Math.round(dh * devicePixelRatio)) {
    cv.width = dw * devicePixelRatio; cv.height = dh * devicePixelRatio;
    cv.style.width = dw + 'px'; cv.style.height = dh + 'px';
  }
  v.style.width = dw + 'px'; v.style.height = dh + 'px';
  v.classList.toggle('mirror', mirror());
  $('sceneLayer').style.width = dw + 'px'; $('sceneLayer').style.height = dh + 'px';
  $('sceneLayer').classList.toggle('mirror', mirror());
  const k = s * devicePixelRatio;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cv.width, cv.height);
  g.setTransform(mirror() ? -k : k, 0, 0, k, mirror() ? cv.width : 0, 0);
  const f = lastF;
  if (!f) { g.setTransform(1, 0, 0, 1, 0, 0); return; }
  const p = f.pos, lw = 2 / s;
  // rule guides
  const r = follower.last;
  if (r && r.guides && r.guides.six) drawRegions(r);
  else if (r && r.guides && follower.mode !== 'fixed') {
    const gd = r.guides, L = gd.L, lit = (rule, c) => (g.strokeStyle = r.rule === rule ? c : 'rgba(150,150,150,.5)',
                                                       g.lineWidth = (r.rule === rule ? 3 : 1.2) / s);
    lit('V', DEG.V); line(gd.hip[0] - 1.3 * L, gd.downY, gd.hip[0] + 1.3 * L, gd.downY);
    lit('ii', DEG.ii);
    for (const x of [gd.lo, gd.hi]) line(x, gd.hip[1] - 1.6 * L, x, gd.hip[1] + 1.4 * L);
    lit('I', DEG.I);
    const nrm = [-gd.u[1], gd.u[0]];
    line(gd.hip[0] - 1.6 * L * nrm[0], gd.hip[1] - 1.6 * L * nrm[1], gd.hip[0] + 1.2 * L * nrm[0], gd.hip[1] + 1.2 * L * nrm[1]);
  }
  // skeleton
  g.strokeStyle = 'rgba(235,230,220,.8)'; g.lineWidth = lw;
  for (const [a, b] of EDGES) if (p(a) && p(b)) line(p(a)[0], p(a)[1], p(b)[0], p(b)[1]);
  // limbs: ring = speed, arrow = velocity
  PART_J.forEach((j, e) => {
    if (!e || !p(j)) return;
    const c = COL[PARTS[e]], q = p(j), vel = f.vel(j);
    g.strokeStyle = c; g.lineWidth = 2.5 / s;
    g.beginPath(); g.arc(q[0], q[1], (5 + 26 * f.nspeed[e]) / s, 0, 7); g.stroke();
    let dx = vel[0] * 0.12, dy = vel[1] * 0.12; const n = Math.hypot(dx, dy);
    if (n > 160 / s) { dx *= 160 / s / n; dy *= 160 / s / n; }
    if (n > 4) line(q[0], q[1], q[0] + dx, q[1] + dy);
  });
  if ($('sphereShow').value !== 'off') drawSphere(f, s);
  // hands: landmarks, and each hand's state
  for (const side of ['L', 'R']) {
    const h = hands[side]; if (!h.seen || !h.lm) continue;
    g.strokeStyle = side === 'L' ? '#ffaa50' : '#5ab4ff'; g.lineWidth = 1.5 / s;
    for (const [a, b] of HAND_EDGES) line(h.lm[a].px, h.lm[a].py, h.lm[b].px, h.lm[b].py);
    if (hands.mode === 'far' && h.box) { g.strokeStyle = 'rgba(200,200,200,.25)'; g.strokeRect(...h.box); }
  }
  // hips: the bounce, and a ring at every beat, drawn when the frame on screen
  // reaches the beat's time, so the ring should coincide with her lowest point
  const hp = p(J.L_HIP) && p(J.R_HIP) ? [(p(J.L_HIP)[0] + p(J.R_HIP)[0]) / 2, (p(J.L_HIP)[1] + p(J.R_HIP)[1]) / 2] : null;
  if (hp && lastBounce && drumMode.includes('bounce')) {
    const on = bounceOn;
    g.strokeStyle = on ? '#7fd0ff' : 'rgba(127,208,255,.35)'; g.lineWidth = 2 / s;
    line(hp[0] - 0.5 * f.L, hp[1], hp[0] + 0.5 * f.L, hp[1]);
    for (const bp of engine.scheduled || []) {
      const age = lastCapMs - bp;
      if (age >= 0 && age < 180) { const a = age / 180;
        g.strokeStyle = `rgba(127,208,255,${1 - a})`; g.lineWidth = 5 * (1 - a) / s + 1 / s;
        g.beginPath(); g.arc(hp[0], hp[1], (0.25 + 0.4 * a) * f.L, 0, 7); g.stroke(); }
    }
  }
  // pluck flashes
  const now = performance.now();
  flashes = flashes.filter(fl => now - fl.t0 < 400);
  for (const fl of flashes) {
    const q = p(PART_J[PARTS.indexOf(fl.part)]); if (!q) continue;
    const a = (now - fl.t0) / 400;
    g.strokeStyle = COL[fl.part]; g.lineWidth = Math.max(1, 7 * (1 - a) * (0.4 + fl.strength)) / s;
    g.beginPath(); g.arc(q[0], q[1], (10 + 60 * a) / s, 0, 7); g.stroke();
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  // chord badge and rule list
  const c = follower.chord();
  $('sym').textContent = c.symbol; $('sym').style.color = DEG[c.degree];
  $('deg').textContent = c.degree;
  document.querySelectorAll('#rules [data-r]').forEach(d =>
    d.classList.toggle('now', !!r && d.dataset.r === r.rule));
  handReadout();
  meters(f);
}
// the six regions around the torso, the hands' midpoint as a dot
function drawRegions(r) {
  const { c, hb, L } = r.guides, b = HP.centreBand * L, dim = 'rgba(170,170,170,.55)';
  const x0 = c[0] - b, x1 = c[0] + b, top = c[1] - 1.6 * L, bot = c[1] + 1.4 * L, ry = c[1] + HP.raisedAt * L;
  const s = cv.width / v.videoWidth / devicePixelRatio;
  g.strokeStyle = dim; g.lineWidth = 1.2 / s;
  line(x0, top, x0, bot); line(x1, top, x1, bot);
  line(x0 - 1.4 * L, c[1], x0, c[1]); line(x1, c[1], x1 + 1.4 * L, c[1]); line(x0, ry, x1, ry);
  const labels = { vi: [x1 + 0.6 * L, c[1] - 0.6 * L], ii: [x1 + 0.6 * L, c[1] + 0.8 * L],
                   iii: [x0 - 0.6 * L, c[1] - 0.6 * L], V: [x0 - 0.6 * L, c[1] + 0.8 * L],
                   IV: [c[0], ry - 0.25 * L], I: [c[0], c[1] + 1.2 * L] };
  for (const [k, [x, y]] of Object.entries(labels)) {
    const on = r.rule === k;
    g.save(); g.translate(x, y); if (mirror()) g.scale(-1, 1);          // keep text readable
    g.font = `${on ? 600 : 400} ${(on ? 26 : 18) / s}px -apple-system, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = on ? DEG[k] : dim; g.fillText(k, 0, 0); g.restore();
  }
  g.fillStyle = DEG[r.rule] || '#eee';
  g.beginPath(); g.arc(hb[0], hb[1], 7 / s, 0, 7); g.fill();
}
// the sphere between the hands: a glowing ball, radius = half the hands'
// distance, flickering with energy and throwing sparks that rise like fire
let sparks = [], sparkT = performance.now();
function drawSphere(f, s) {
  const c = f.sphereC, R = f.sphereR, now = performance.now(), dt = Math.min(0.1, (now - sparkT) / 1000);
  sparkT = now;
  if (!c || R < 2 || f.sphere <= 0) { sparks = []; return; }
  const e = f.energy, style = $('sphereShow').value;
  const fl = 1 + 0.05 * Math.sin(now / 45) + 0.035 * Math.sin(now / 23 + 1) + 0.08 * e * Math.sin(now / 11);
  const r = Math.max(4 / s, R * fl);
  const col = style === 'light' ? hexRgb(DEG[follower.chord().degree] || '#ffffff') : null;
  const stops = col ? [[0, `rgba(255,255,255,.95)`], [0.3, `rgba(${col},.75)`], [0.75, `rgba(${col},.3)`], [1, `rgba(${col},0)`]]
                    : [[0, 'rgba(255,250,225,.95)'], [0.3, 'rgba(255,200,90,.8)'], [0.65, 'rgba(255,100,30,.45)'], [1, 'rgba(190,30,10,0)']];
  g.save(); g.globalCompositeOperation = 'lighter';
  const gr = g.createRadialGradient(c[0], c[1], 0, c[0], c[1], r * 1.25);
  for (const [o, cl] of stops) gr.addColorStop(o, cl);
  g.fillStyle = gr; g.beginPath(); g.arc(c[0], c[1], r * 1.25, 0, 7); g.fill();
  g.strokeStyle = col ? `rgba(${col},.55)` : 'rgba(255,170,70,.5)'; g.lineWidth = 1.5 / s;
  g.beginPath(); g.arc(c[0], c[1], r, 0, 7); g.stroke();
  // sparks from the surface, more with energy; fire rises, light drifts
  const n = Math.round(1 + 8 * e + 6 * f.sphere);
  for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, sp = (40 + 160 * Math.random()) * (0.4 + e) / s;
    sparks.push({ x: c[0] + r * Math.cos(a), y: c[1] + r * Math.sin(a), vx: sp * Math.cos(a), vy: sp * Math.sin(a) - (col ? 0 : 60 / s),
                  life: 0.4 + 0.5 * Math.random(), age: 0 }); }
  sparks = sparks.filter(p => (p.age += dt) < p.life).slice(-300);
  for (const p of sparks) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= (col ? 0 : 120 / s) * dt;
    const a = 1 - p.age / p.life;
    g.fillStyle = col ? `rgba(${col},${0.8 * a})` : `rgba(255,${Math.round(140 + 100 * a)},60,${0.85 * a})`;
    g.beginPath(); g.arc(p.x, p.y, (1 + 2.5 * a) / s, 0, 7); g.fill(); }
  g.restore();
}
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(',');

function line(x0, y0, x1, y1) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }

// ── meters and status ───────────────────────────────────────────────
const METERS = [['weight', 'Weight', '#f06e5a'], ['time', 'Time', '#fad250'],
                ['flow', 'Flow', '#c88ce6'], ['space', 'Space', '#c8e678'],
                ['energy', 'energy', '#ff9a60'], ['rhythm', 'rhythm', '#7fd0ff'], ['bounce', 'hip bounce', '#7fd0ff'],
                ['out', 'output', '#efe9df']];
$('meters').innerHTML = METERS.map(([k, n, c]) =>
  `<div class="meter"><span>${n}</span><div class="bar"><i id="m-${k}" style="background:${c}"></i></div></div>`).join('');
let statusAt = 0;
function meters(f) {
  for (const [k] of METERS.slice(0, 6)) $('m-' + k).style.width = (100 * f[k]).toFixed(0) + '%';
  const bo = lastBounce;
  $('bounceTxt').textContent = !bo ? 'hips not seen' :
    `hips: P(bouncing) ${(100 * bo.prob).toFixed(0)}%` + (bo.prob > 0.3 ? `, ${bo.tempo.toFixed(0)} bpm` : '') +
    (bounceOn ? ' · groove on' : '') + (drumsEnabled ? '' : ' · drums off (gesture)');
  $('m-bounce').style.width = (100 * (bo ? bo.prob : 0)).toFixed(0) + '%';
  $('tempo').textContent = f.rhythm > 0.2 ? `${f.tempo.toFixed(0)} bpm, regularity ${(100 * f.rhythm).toFixed(0)}%`
                                          : `no steady pulse (${(100 * f.rhythm).toFixed(0)}%)`;
  if (lastVals) for (const k of Object.keys(DESTS)) {
    const d = DESTS[k], val = lastVals[k], el = $('mv:' + k); if (!el) continue;
    const frac = d.log ? Math.log(val / d.min) / Math.log(d.max / d.min) : (val - d.min) / (d.max - d.min);
    el.style.width = (100 * Math.max(0, Math.min(1, frac))).toFixed(0) + '%';
  }
  $('m-out').style.width = Math.min(100, 100 * engine.peak()).toFixed(0) + '%';
  const now = performance.now();
  if (now - statusAt > 500 && engine.ctx) {
    statusAt = now;
    const lat = 1000 * ((engine.ctx.baseLatency || 0) + (engine.ctx.outputLatency || 0));
    status(`${fpsT.length} fps · pose ${inferMs.toFixed(0)} ms · audio ${lat.toFixed(0)} ms · ` +
           `${v.videoWidth}×${v.videoHeight}${vision && vision.local ? ' · offline models' : ''}`);
  }
}
function status(s) { $('status').textContent = s; }

// ── mixer and sensitivity ───────────────────────────────────────────
const LAYERS = [['pad', 1], ['bass', 1], ['plucks', 1], ['wind', 1], ['wind tuned', 0.6], ['drums', 0.8], ['objects', 0.8]];
const mix = store.get('mix', Object.fromEntries(LAYERS.map(([k, d]) => [k, { vol: d, mute: false }]).concat([['master', { vol: 1 }]])));
const slider = (key, val, min, max, step, cls = '') =>
  `<input type="range" min="${min}" max="${max}" step="${step}" value="${val}" data-k="${key}" class="${cls}">`;
$('mix').innerHTML = LAYERS.map(([k,defaultVolume]) => `<span>${k}</span>
  <button data-k="${k}" class="${mix[k]?.mute ? '' : 'on'}">${mix[k]?.mute ? 'off' : 'on'}</button>
  ${slider(k, mix[k]?.vol ?? defaultVolume, 0, 1.5, 0.01)}<span class="val" id="mv-${k.replace(' ', '_')}"></span>`).join('') +
  `<span>master</span><span></span>${slider('master', mix.master?.vol ?? 1, 0, 1.5, 0.01)}<span class="val" id="mv-master"></span>` +
  `<span>pad floor</span><button id="floorBtn">off</button>${slider('__floor', 0, 0, 0.5, 0.01)}<span class="val" id="mv-floor"></span>`;
function applyMix() {
  for (const [k,defaultVolume] of LAYERS) {
    const m = mix[k] || (mix[k] = { vol: defaultVolume, mute: false });
    engine.level(k, m.mute ? 0 : m.vol);
    $('mv-' + k.replace(' ', '_')).textContent = Math.round(m.vol * 100) + '%';
  }
  engine.masterLevel(mix.master.vol); $('mv-master').textContent = Math.round(mix.master.vol * 100) + '%';
  store.set('mix', mix);
}
$('mix').addEventListener('input', e => { const k = e.target.dataset.k; if (!k) return;
  if (k === '__floor') { mapping['pad.level'].lo = +e.target.value; mapChanged(); return; }
  (mix[k] = mix[k] || {}).vol = +e.target.value; if (engine.ctx) applyMix(); else store.set('mix', mix); });
$('mix').addEventListener('click', e => {
  if (e.target.id === 'floorBtn') { const m = mapping['pad.level'];
    m.lo = m.lo > 0 ? 0 : (store.get('floorOn', 0.15)); mapChanged(); return; }
  const k = e.target.dataset.k; if (!k || e.target.tagName !== 'BUTTON') return;
  mix[k].mute = !mix[k].mute; e.target.classList.toggle('on', !mix[k].mute);
  e.target.textContent = mix[k].mute ? 'off' : 'on'; if (engine.ctx) applyMix(); else store.set('mix', mix); });

const SENS = [['weight', 'Weight', 0.25, 3, 1], ['time', 'Suddenness', 0.25, 3, 1],
              ['flow', 'Flow', 0.25, 3, 1], ['space', 'Space', 0.25, 3, 1],
              ['smooth', 'Smoothing', 0.3, 4, 1.2], ['hold', 'Chord hold', 0.1, 1.5, 0.5]];
const sens = store.get('sens', Object.fromEntries(SENS.map(s => [s[0], s[4]])));
$('sens').innerHTML = SENS.map(([k, n, lo, hi]) => `<span>${n}</span><span></span>
  ${slider(k, sens[k] ?? 1, lo, hi, 0.05)}<span class="val" id="sv-${k}"></span>`).join('');
function applySens() {
  for (const [k] of SENS.slice(0, 4)) { P.gain[k] = sens[k]; $('sv-' + k).textContent = '×' + (+sens[k]).toFixed(2); }
  P.euroMinCutoff = 4.3 - sens.smooth;            // more smoothing = lower One Euro cutoff
  HP.dwell6S = sens.hold ?? 0.5; HP.dwellS = 0.7 * HP.dwell6S;
  $('sv-hold').textContent = HP.dwell6S.toFixed(2) + ' s';
  $('sv-smooth').textContent = P.euroMinCutoff.toFixed(1) + ' Hz';
  store.set('sens', sens);
}
$('sens').addEventListener('input', e => { const k = e.target.dataset.k; if (!k) return;
  sens[k] = +e.target.value; applySens(); });
applySens();

// ── mapping matrix ──────────────────────────────────────────────────
const custom = store.get('customPresets', {});
let mapping = store.get('mapping', null) || defaults();
for (const [k, d] of Object.entries(defaults())) mapping[k] = { ...d, ...(mapping[k] || {}) };
let drumMode = store.get('drums', 'groove');
const fmt = (d, x) => d.log ? Math.round(x) : +(+x).toFixed(2);

function presetList() {
  $('preset').innerHTML = '<option value="">choose a preset…</option>' +
    [...Object.keys(PRESETS), ...Object.keys(custom).map(k => k)].map(k =>
      `<option value="${k}">${k}${custom[k] ? ' (yours)' : ''}</option>`).join('');
}
function renderMapping() {
  const opts = sel => SOURCES.map(([k, n]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${n}</option>`).join('');
  $('map').innerHTML = Object.entries(DESTS).map(([k, d]) => { const m = mapping[k];
    const num = (f, v, step) => `<input type="number" data-k="${k}" data-f="${f}" value="${fmt(d, v)}" step="${step}">`;
    const st = d.log ? 1 : 0.01;
    return `<details class="dest"><summary><span class="dn">${d.label}</span>
        <span class="ds">${SOURCES.find(s => s[0] === m.src)[1].split(' (')[0]}</span>
        <span class="bar small"><i id="mv:${k}"></i></span></summary>
      <div class="dgrid">
        <span>source</span><select data-k="${k}" data-f="src">${opts(m.src)}</select>
        <span>min ${d.unit || ''}</span>${num('lo', m.lo, st)}
        <span>max ${d.unit || ''}</span>${num('hi', m.hi, st)}
        <span>gain</span>${num('gain', m.gain, 0.05)}
        <span>curve (exp)</span>${num('exp', m.exp, 0.05)}
        <span>invert</span><input type="checkbox" data-k="${k}" data-f="inv" ${m.inv ? 'checked' : ''}>
      </div></details>`; }).join('');
  const lo = mapping['pad.level'].lo;
  $('floorBtn').textContent = lo > 0 ? 'on' : 'off'; $('floorBtn').classList.toggle('on', lo > 0);
  document.querySelector('[data-k="__floor"]').value = lo;
  $('mv-floor').textContent = Math.round(lo * 100) + '%';
}
function mapChanged(rerender = true) {
  store.set('mapping', mapping);
  if (mapping['pad.level'].lo > 0) store.set('floorOn', mapping['pad.level'].lo);
  if (rerender) { const open = [...document.querySelectorAll('#map details[open] [data-f=src]')].map(e => e.dataset.k);
    renderMapping();
    open.forEach(k => document.querySelector(`#map [data-k="${k}"]`)?.closest('details')?.setAttribute('open', '')); }
}
$('map').addEventListener('change', e => {
  const k = e.target.dataset.k, fld = e.target.dataset.f; if (!k || !fld) return;
  mapping[k][fld] = fld === 'src' ? e.target.value : fld === 'inv' ? e.target.checked : +e.target.value;
  mapChanged(fld === 'src');
});
$('preset').onchange = () => { const n = $('preset').value; if (!n) return;
  mapping = applyPreset(n, custom); mapChanged(); $('preset').value = ''; status('preset: ' + n); };
$('savePreset').onclick = () => { const n = prompt('Name for this mapping'); if (!n) return;
  custom[n] = JSON.parse(JSON.stringify(mapping)); store.set('customPresets', custom); presetList(); };
$('exportMap').onclick = () => { const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(mapping, null, 1)], { type: 'application/json' }));
  a.download = 'dance2music-mapping.json'; a.click(); };
$('importMap').onchange = async () => { const f = $('importMap').files[0]; if (!f) return;
  try { const m = JSON.parse(await f.text()); for (const k of Object.keys(DESTS)) if (m[k]) mapping[k] = { ...mapping[k], ...m[k] };
        mapChanged(); } catch (e) { status('could not read that mapping'); } };
$('drumMode').value = drumMode;
$('timbre').value = store.get('timbre', 'saw'); engine.timbre = $('timbre').value;
$('timbre').onchange = () => { store.set('timbre', $('timbre').value); engine.setTimbre($('timbre').value); };
$('sphereShow').value = store.get('sphereShow', 'fire');
$('sphereShow').onchange = () => store.set('sphereShow', $('sphereShow').value);
$('syncOff').value = store.get('syncOff', 0); $('syncV').textContent = $('syncOff').value + ' ms';
$('syncOff').oninput = () => { store.set('syncOff', +$('syncOff').value); $('syncV').textContent = $('syncOff').value + ' ms'; };
$('accent').value = store.get('accent', 'down'); $('accent').onchange = () => store.set('accent', $('accent').value);
$('handMode').value = store.get('handMode', 'off');
$('handMode').onchange = async () => { store.set('handMode', $('handMode').value);
  if (running && vision) { status('loading hand model…');
    const restartMagenta=magenta.active,session=sessionGeneration;
    if(restartMagenta)await magenta.stop();
    const loading = hands.load(vision, $('handMode').value); recordConfiguration();
    try { await loading; status('hands: ' + hands.mode); }
    catch (error) { status('could not load hands: ' + error.message); }
    finally { recordConfiguration();if(restartMagenta&&running&&session===sessionGeneration)magenta.start(); } } };
$('gestures').innerHTML = GESTURES.map(gname => `<span>${gname.replace('_', ' ')}</span><select data-g="${gname}">` +
  ACTIONS.map(([k, n]) => `<option value="${k}" ${actions[gname] === k ? 'selected' : ''}>${n}</option>`).join('') + '</select>').join('');
$('gestures').onchange = e => { const gname = e.target.dataset.g; if (!gname) return;
  actions[gname] = e.target.value; store.set('actions', actions); };
$('drumMode').onchange = () => { drumMode = $('drumMode').value; store.set('drums', drumMode); };
$('energyS').value = store.get('energyS', 3); P.energyS = +$('energyS').value;
$('energyV').textContent = P.energyS + ' s';
$('energyS').oninput = () => { P.energyS = +$('energyS').value; store.set('energyS', P.energyS);
  $('energyV').textContent = P.energyS + ' s'; };
presetList(); renderMapping();

// ── controls ────────────────────────────────────────────────────────
for (const id of ['mode', 'model', 'res', 'mirror', 'source']) {
  const saved = store.get(id, null); if (saved !== null) $(id).value = saved;
}
$('camRow').hidden = $('source').value !== 'camera'; $('fileRow').hidden = $('source').value !== 'file';
$('sceneMode').value = availableScene(sceneMode(store.get('sceneMode', null), store.get('sceneObjects', false)), magentaAvailability.available);
store.set('sceneMode', $('sceneMode').value);
scene.setMode($('sceneMode').value);
$('pianoListening').value=store.get('pianoListening','piano-only')==='piano-body'?'piano-body':'piano-only';
piano.listening=$('pianoListening').value;
$('pianoListening').onchange=()=>{store.set('pianoListening',$('pianoListening').value);piano.setListening($('pianoListening').value,sceneWanted()&&$('sceneMode').value==='floor-piano');recordConfiguration();};
$('pianoNearCamera').checked=store.get('pianoNearCamera',true)!==false;
scene.setPianoNearCamera($('pianoNearCamera').checked);
$('pianoNearCamera').onchange=()=>{scenePointer.cancel();store.set('pianoNearCamera',$('pianoNearCamera').checked);scene.setPianoNearCamera($('pianoNearCamera').checked);};
scene.mirror=$('mirror').value==='1';
$('sceneMode').onchange = () => { $('sceneMode').value=availableScene($('sceneMode').value,magentaAvailability.available);store.set('sceneMode', $('sceneMode').value);scene.setMode($('sceneMode').value);lockSessionOptions(); };
$('sceneDebug').onchange = () => { scene.debug = $('sceneDebug').checked; $('sceneTouchHelp').hidden=!scene.debug;recordConfiguration(); };
$('sceneTouch').checked = store.get('sceneTouch',true); scene.setTouchEnabled($('sceneTouch').checked);
$('sceneTouch').onchange = () => { store.set('sceneTouch',$('sceneTouch').checked);scene.setTouchEnabled($('sceneTouch').checked);recordConfiguration(); };
$('sceneRescan').onclick = () => scene.rescan();
setInterval(() => { if (sceneWanted()) $('sceneMetrics').textContent = scene.metrics(); }, 500);
lockSessionOptions();
$('go').onclick = () => (running || starting ? stop() : start());
const RULES = {
  six: [['I', 'hands centred, at rest (arms hanging counts)'], ['IV', 'hands centred and raised, or spread wide'],
        ['vi', 'hands to your left, up'], ['ii', 'hands to your left, down'],
        ['iii', 'hands to your right, up'], ['V', 'hands to your right, down']],
  twofive: [['V', 'both hands below mid-thigh'], ['ii', 'both hands past one side of both feet'],
            ['I', 'each hand and foot on its own side']],
};
RULES.twofive_alt = RULES.twofive; RULES.fixed = [];
RULES.fingers = [['I', '1 finger (both hands together)'], ['ii', '2 fingers'], ['iii', '3 fingers'],
                 ['IV', '4 fingers'], ['V', '5 fingers'], ['vi', '6 or more'], ['', 'no fingers (fists) holds the chord; needs hand tracking on']];
function showRules() {
  const m = $('mode').value;
  $('rules').innerHTML = (RULES[m] || []).map(([d, t]) =>
    `<div data-r="${d}"><b style="color:${DEG[d]}">${d}</b>${t}</div>`).join('') +
    (m === 'six' ? '<div class="note">“hands” = their midpoint, relative to your torso; left/right as you face the camera</div>' : '');
}
$('mode').onchange = () => { store.set('mode', $('mode').value); follower = new ChordFollower($('mode').value);
                              showRules(); if (engine.ctx) engine.setChord(follower.chord(), true); };
showRules();
async function changeSource() {
  if (!running) return;
  const session = sessionGeneration, change = sourceGeneration + 1;
  scene.stop();await magenta.stop();
  piano.setListening($('pianoListening').value,sceneWanted()&&$('sceneMode').value==='floor-piano');
  try {
    if ($('source').value === 'camera') await openCamera(); else await openFile();
    if (!running || session !== sessionGeneration || change !== sourceGeneration) return;
    await loadLandmarker();
    if(sceneWanted()&&$('sceneMode').value==='floor-piano'&&!piano.buffers){
      await piano.load(message=>{$('pianoStatus').textContent=message;});
      $('pianoStatus').textContent='Piano samples ready';
    }
    if (sceneWanted() && running && session === sessionGeneration && change === sourceGeneration) await scene.start(v, currentSource.id, $('sceneMode').value);
    if(sceneWanted()&&$('sceneMode').value==='magenta'&&running&&session===sessionGeneration&&change===sourceGeneration)magenta.start();
  } catch (error) { status('could not change source: ' + error.message); }
}
$('source').onchange = () => { store.set('source', $('source').value);
  $('camRow').hidden = $('source').value !== 'camera'; $('fileRow').hidden = $('source').value !== 'file';
  lockSessionOptions(); changeSource(); };
$('cam').onchange = () => { store.set('cam', $('cam').value); changeSource(); };
$('res').onchange = () => { store.set('res', $('res').value); changeSource(); };
$('mirror').onchange = () => { scenePointer.cancel();scene.mirror=mirror();store.set('mirror', $('mirror').value); recordConfiguration(); };
$('model').onchange = async () => { store.set('model', $('model').value);
  if (running) {
    const restartMagenta=magenta.active,session=sessionGeneration;
    if(restartMagenta)await magenta.stop();
    try { await loadLandmarker(); } catch (error) { status('could not load pose model: ' + error.message); }
    finally {if(restartMagenta&&running&&session===sessionGeneration)magenta.start();}
  } };
$('out').onchange = async () => { store.set('out', $('out').value);
  if (engine.ctx && engine.ctx.setSinkId) await engine.ctx.setSinkId($('out').value || ''); };
$('file').onchange = () => changeSource();

document.addEventListener('keydown', e => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)||e.target.isContentEditable||e.target.closest('dialog')) return;
  if (e.key === ' ') { e.preventDefault(); running || starting ? stop() : start(); }
  else if (e.key === 'r') { if (running) toggleRecord(); }
  else if (e.key === 'f') { document.body.classList.toggle('perf');
    if (document.body.classList.contains('perf')) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {}); }
  else if ('12345'.includes(e.key)) { $('mode').value = ['six', 'fingers', 'twofive', 'twofive_alt', 'fixed'][+e.key - 1]; $('mode').onchange(); }
  else if (e.key === 'm') { engine.masterLevel(engine.master && engine.master.gain.value > 0 ? 0 : mix.master.vol); }
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) document.body.classList.remove('perf'); });

// fill device lists if permission was granted before
navigator.mediaDevices?.enumerateDevices && listDevices().catch(() => {});
if (!window.isSecureContext) status('needs https or localhost for the camera');

function handReadout() {
  if (hands.mode === 'off') { $('handTxt').textContent = 'hand tracking off'; return; }
  const one = (h, n) => !h.seen ? `${n}: —` : `${n}: ${h.fingers} finger${h.fingers === 1 ? '' : 's'}, open ${(100 * h.open).toFixed(0)}%` +
    (h.gesture !== 'None' ? `, ${h.gesture.replace('_', ' ')}` : '');
  $('handTxt').textContent = `${one(hands.L, 'left')} · ${one(hands.R, 'right')}` + (hands.ms ? ` · ${hands.ms.toFixed(0)} ms` : '') +
    (frozen ? ' · chord held' : '') + (gestureLog ? `\nlast: ${gestureLog}` : '');
}

// ── recording ───────────────────────────────────────────────────────
function recordingConfiguration() {
  return { source: currentSource && { ...currentSource, width: v.videoWidth, height: v.videoHeight },
    pose_model: poseModel, hands: hands.configuration(),
    scene: { ...scene.configuration(), selected: $('sceneMode').value !== 'none',...($('sceneMode').value==='magenta'?{magenta:magenta.configuration()}:{}),...($('sceneMode').value==='floor-piano'?{piano:piano.configuration()}:{}) },
    preview_mirrored: mirror(), video_mirrored: mirror(),
    harmony_mode: $('mode').value, mapping, sensitivity: P, gesture_actions: actions,
    drum_mode: drumMode, timbre: engine.timbre, mix, sync_offset_ms: +$('syncOff').value };
}
function recordConfiguration() {
  if (recorder.active) recorder.configuration(recordingConfiguration());
}
// Also capture control changes between inference frames (e.g. while hidden).
document.querySelector('aside').addEventListener('change', recordConfiguration);

function downloadLink({ name, url }) {
  const a = document.createElement('a'); a.href = url; a.download = name; a.textContent = name; return a;
}
function packagingProgress(progress) { $('recMsg').textContent = `Preparing recording bundle… ${progress ?? 0}%`; }
// A fresh page always starts with microphone capture off, including form restoration.
$('recMic').checked = false;
window.addEventListener('pageshow', () => { if (!recorder.starting && !recorder.recording) $('recMic').checked = false; });
let recordingStartGeneration = 0;
function lockRecordingOptions(locked) { $('recMic').disabled = locked; $('recWhat').disabled = locked; }
function cancelRecordingStart() {
  ++recordingStartGeneration; recorder.cancelStart(); lockRecordingOptions(false);
  $('micMsg').hidden = true;
  $('rec').textContent = '● Record'; $('recMsg').textContent = 'Recording cancelled.';
}
function microphoneStatus(mic = recorder.microphone) {
  const message = $('micMsg');
  message.hidden = !mic?.selected;
  if (!mic?.selected) return;
  message.classList.toggle('warning', ['unavailable', 'interrupted', 'no_audio'].includes(mic.outcome));
  const descriptions = {
    pending: 'Microphone: waiting for permission…',
    recording: 'Microphone capture active — saved as a separate audio file.',
    complete: 'Microphone audio captured as a separate file.',
    unavailable: 'Microphone unavailable. No microphone file will be included.',
    interrupted: 'Microphone capture was interrupted. Any captured audio is kept in the ZIP.',
    no_audio: 'No microphone audio was captured. The ZIP has no microphone file.',
  };
  message.textContent = descriptions[mic.outcome] + (mic.error ? ' ' + mic.error : '');
}
function recordingStatus() {
  let message = 'Recording movement data and ' + ($('recWhat').value === 'audio' ? 'sound' : 'video + sound');
  const mic = recorder.microphone;
  if (mic?.selected) message += mic.outcome === 'recording' ? '. Microphone capture active (separate file).'
    : `. Microphone ${mic.outcome === 'interrupted' ? 'interrupted' : 'unavailable'}: ${mic.error}`;
  $('recMsg').textContent = message;
  microphoneStatus();
}
let finishingRecording = null;
function finishRecording(retry = false) {
  if (finishingRecording) return finishingRecording;
  finishingRecording = (async () => {
    $('rec').disabled = true; $('recDot').hidden = true;
    $('rec').classList.remove('on'); $('rec').textContent = 'Preparing…';
    packagingProgress(0);
    try {
      const r = await (retry ? recorder.retry(packagingProgress) : recorder.stop(packagingProgress));
      if (r) {
        microphoneStatus(r.microphone);
        const a = downloadLink(r);
        $('recMsg').replaceChildren(document.createTextNode(`Bundle ready (${(r.size / 1e6).toFixed(1)} MB, ${r.seconds.toFixed(0)} s, ${r.observations} observations). Download again: `), a);
        a.click();
        if (r.mediaError) $('recMsg').append(document.createTextNode(' Media was interrupted: ' + r.mediaError));
        if (r.microphone?.selected) $('recMsg').append(document.createTextNode(
          r.microphone.outcome === 'complete' ? ' Separate microphone audio included.'
            : r.microphone.outcome === 'no_audio' ? ' No microphone audio was captured.'
              : ` Microphone ${r.microphone.outcome}: ${r.microphone.error}`));
      }
    } catch (error) {
      microphoneStatus();
      $('recMsg').textContent = 'Could not package recording: ' + error.message + '. ';
      const retryButton = document.createElement('button'); retryButton.textContent = 'Retry ZIP';
      retryButton.onclick = () => finishRecording(true); $('recMsg').append(retryButton);
      for (const file of recorder.recoveryFiles()) $('recMsg').append(' ', downloadLink(file));
      const discard = document.createElement('button'); discard.textContent = 'Clear recording';
      discard.onclick = () => { recorder.pending = null; recorder.releaseDownloads();
        $('micMsg').hidden = true;
        $('recMsg').textContent = ''; $('rec').disabled = !running; };
      $('recMsg').append(' ', discard);
    } finally {
      lockRecordingOptions(false);
      $('rec').textContent = '● Record'; $('rec').disabled = !running || !!recorder.pending;
      finishingRecording = null;
    }
  })();
  return finishingRecording;
}
async function toggleRecord() {
  if (finishingRecording || recorder.busy || recorder.pending) return;
  if (recorder.starting) { cancelRecordingStart(); return; }
  if (!recorder.recording) {
    const generation = ++recordingStartGeneration;
    lockRecordingOptions(true);
    microphoneStatus({ selected: $('recMic').checked, outcome: 'pending' });
    try {
      const starting = recorder.start({ engine, video: v, overlay: cv, mirror, sceneLayer: now => scene.render(now),
        audioOnly: $('recWhat').value === 'audio',
        recordMicrophone: $('recMic').checked, onMicrophoneStatus: recordingStatus,
        configuration: recordingConfiguration, onUnexpectedStop: () => finishRecording(),
        finalAnalysis: () => $('sceneMode').value==='magenta'?{magenta_events:magenta.takeEvents(recorder.t0)}:$('sceneMode').value==='floor-piano'?{piano_events:piano.takeEvents(recorder.t0)}:null,
        label: () => { const c = follower.chord(); return [c.symbol, c.degree, DEG[c.degree] || '#efe9df']; } });
      if (recorder.starting) {
        $('rec').textContent = 'Cancel recording';
        $('recMsg').textContent = 'Waiting for microphone permission… Press Cancel recording to cancel.';
      }
      const type = await starting;
      if (generation !== recordingStartGeneration || !type) return;
      $('rec').classList.add('on'); $('rec').textContent = '■ Stop recording'; $('recDot').hidden = false;
      status('recording ' + type.split(';')[0]);
      recordingStatus();
      recTick();
    } catch (e) {
      if (generation !== recordingStartGeneration) return;
      lockRecordingOptions(false); $('rec').textContent = '● Record';
      $('micMsg').hidden = true;
      $('recMsg').textContent = 'Could not record: ' + e.message; status('could not record: ' + e.message);
    }
  } else {
    await finishRecording();
  }
}
function recTick() {
  if (!recorder.active) return;
  const s = Math.floor(recorder.elapsed());
  $('recDot').textContent = `● REC ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  setTimeout(recTick, 250);
}
$('rec').onclick = () => toggleRecord();
// Local integrity verification is asynchronous. Do not accept a scene or
// Start click before saved settings and their event handlers are installed.
$('sceneMode').disabled = false;
$('go').disabled = false;
document.body.dataset.ready = 'true';
status('idle');

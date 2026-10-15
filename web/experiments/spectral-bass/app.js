// Spectral bass: camera (or a video) → MediaPipe Pose → measure.js (shared with the
// Movement Dictionary) → spectral.js (controls, strokes) → sound.js, drawn by view.js.
import { Dictionary } from '../movement-dictionary/measure.js';
import { SP, controls, centroid, Strokes, SOURCES, KNOBS, knobs, defaultRouting, lfoHz } from './spectral.js';
import { Hands } from './hands.js';
import { Sound } from './sound.js';
import { View, noteName } from './view.js';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/';
const MODEL = m => `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${m}/float16/latest/pose_landmarker_${m}.task`;
const $ = id => document.getElementById(id);
const store = { get(k, d) { try { const x = localStorage.getItem('sb:' + k); return x === null ? d : JSON.parse(x); } catch { return d; } },
                set(k, v) { try { localStorage.setItem('sb:' + k, JSON.stringify(v)); } catch {} } };

const v = $('v'), cv = $('c');
const dict = new Dictionary(), strokes = new Strokes(), sound = new Sound(), view = new View(cv), hands = new Hands();
let vision = null, landmarker = null, modelKey = '', stream = null, running = false, last = null, lastC = null, lastK = null, handsLoaded = false;
const rows = []; let recorder = null, chunks = [], recT0 = 0, noteLog = [];

for (const id of ['accomp', 'quantise', 'strokeAt', 'lfoTarget', 'handsOn', 'mirror', 'model', 'source']) {
  const x = store.get(id, null); if (x !== null) $(id).value = x;
  $(id).addEventListener('change', () => store.set(id, $(id).value));
}
$('source').addEventListener('change', () => { $('fileRow').hidden = $('source').value !== 'file'; });
$('fileRow').hidden = $('source').value !== 'file';
const opts = () => ({ accomp: $('accomp').value === '1', quantise: $('quantise').value === '1', lfoTarget: $('lfoTarget').value });

// the knob table: one row per knob, its source, ⇄ to reverse it, a slider when held
let routing = { ...defaultRouting(), ...store.get('routing', {}) };
const bars = {};
function buildKnobs() {
  const box = $('knobs'); box.innerHTML = '';
  for (const [id, label] of KNOBS) {
    const r = routing[id], row = document.createElement('div'); row.className = 'knob';
    const sel = document.createElement('select');
    sel.innerHTML = Object.entries(SOURCES).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('') + '<option value="fixed">held (slider)</option>';
    sel.value = r.src;
    const inv = document.createElement('button'); inv.className = 'inv' + (r.inv ? ' on' : ''); inv.textContent = '⇄'; inv.title = 'reverse';
    const bar = document.createElement('div'); bar.className = 'bar'; bar.innerHTML = '<i></i><span></span>';
    const sl = document.createElement('input'); sl.type = 'range'; sl.min = 0; sl.max = 1; sl.step = 0.01; sl.value = r.value; sl.hidden = r.src !== 'fixed';
    const save = () => store.set('routing', routing);
    sel.onchange = () => { r.src = sel.value; sl.hidden = r.src !== 'fixed'; save(); };
    inv.onclick = () => { r.inv = !r.inv; inv.classList.toggle('on', r.inv); save(); };
    sl.oninput = () => { r.value = +sl.value; save(); };
    row.append(Object.assign(document.createElement('span'), { textContent: label }), sel, inv, bar, sl);
    box.append(row); bars[id] = bar;
  }
}
buildKnobs();
$('reset').onclick = () => { routing = defaultRouting(); store.set('routing', routing); buildKnobs(); };
function showKnobs(k) {
  for (const [id, , , , fmt] of KNOBS) { const b = bars[id]; if (!b || !k) continue;
    b.firstChild.style.width = `${Math.round(100 * k[id])}%`; b.lastChild.textContent = fmt(k[id]); }
}
const status = s => ($('status').textContent = s);
sound.onNote = (m, dir) => noteLog.push({ m, dir, at: performance.now() });

async function loadPose() {
  const m = $('model').value;
  if (landmarker && modelKey === m) return;
  status('loading the pose model…');
  if (!vision) { const mod = await import(MP + 'vision_bundle.mjs'); vision = { mod, fileset: await mod.FilesetResolver.forVisionTasks(MP + 'wasm') }; }
  const o = delegate => ({ baseOptions: { modelAssetPath: MODEL(m), delegate }, runningMode: 'VIDEO', numPoses: 1,
                           minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
  let lm; try { lm = await vision.mod.PoseLandmarker.createFromOptions(vision.fileset, o('GPU')); }
  catch { lm = await vision.mod.PoseLandmarker.createFromOptions(vision.fileset, o('CPU')); }
  if (landmarker) landmarker.close(); landmarker = lm; modelKey = m;
}
async function loadHands() {
  if (handsLoaded || $('handsOn').value !== '1') return;
  status('loading the hand model…'); await hands.load(vision); handsLoaded = true;
}

async function start() {
  $('go').disabled = true;
  try {
    await sound.start();                                   // inside the click: browsers unlock audio here
    await loadPose(); await loadHands();
    status('opening the source…');
    if ($('source').value === 'file') {
      const f = $('file').files[0]; if (!f) throw new Error('choose a video file first');
      v.srcObject = null; v.src = URL.createObjectURL(f); v.loop = true;
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
      v.srcObject = stream;
    }
    await v.play();
    dict.reset(); strokes.reset(); running = true; $('hint').hidden = true;
    $('go').textContent = 'Stop'; $('cal').disabled = false; $('rec').disabled = !window.MediaRecorder;
    loop();
  } catch (e) { status('could not start: ' + e.message); }
  $('go').disabled = false;
}
async function stop() {
  if (recorder) await toggleRecord();
  running = false; if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; v.pause();
  if (sound.ctx) await sound.ctx.suspend();
  $('go').textContent = 'Start'; $('cal').disabled = true; $('rec').disabled = true; $('hint').hidden = false; status('stopped');
}
$('go').onclick = () => (running ? stop() : start());
$('handsOn').addEventListener('change', () => { if (running && vision) loadHands().then(() => status('hands on')); });

function loop() {
  const next = () => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(frame) : requestAnimationFrame(frame));
  const fps = [];
  function frame() {
    if (!running) return;
    if (v.readyState >= 2 && landmarker) {
      const now = performance.now(), W = v.videoWidth, H = v.videoHeight;
      const res = landmarker.detectForVideo(v, now);
      const f = dict.update(res.landmarks && res.landmarks[0], res.worldLandmarks && res.worldLandmarks[0], now / 1000, W, H);
      last = f; let ev = [];
      if (f) {
        SP.strokeAt = +$('strokeAt').value;
        if (handsLoaded && $('handsOn').value === '1') hands.detect(v, f, f.t);
        const c = lastC = controls(f);
        const k = lastK = knobs(f, c, hands.sources(), routing);
        ev = strokes.update(f, f.t);
        for (const e of ev) sound.stroke(e.dir);
        sound.update(k, opts());
        if (recorder) rows.push([f.t - recT0, ...KNOBS.map(([id]) => k[id]), sound.spec ? centroid(sound.spec) : '', sound.note,
                                 ev.map(e => e.hand + (e.dir > 0 ? ':up' : ':down')).join(' ')]
                                 .map(x => (typeof x === 'number' ? x.toFixed(3) : x)).join(','));
      }
      layout(W, H);
      view.draw(f, cv.width / W, $('mirror').value === '1', lastK || { bright: 0, peak: 0 }, sound.spec, sound.note, ev, handsLoaded ? hands.h : null);
      readout(f); showKnobs(lastK);
      fps.push(now); while (fps.length && fps[0] < now - 1000) fps.shift();
      status(f ? `${fps.length} fps` : `${fps.length} fps · no body in view: step back so your whole body is seen`);
    }
    next();
  }
  next();
}

function layout(W, H) {
  const box = $('stage').getBoundingClientRect(), s = Math.min(box.width / W, box.height / H);
  const dw = Math.round(W * s), dh = Math.round(H * s), d = devicePixelRatio || 1;
  if (cv.width !== dw * d) { cv.width = dw * d; cv.height = dh * d; cv.style.width = dw + 'px'; cv.style.height = dh + 'px'; }
  v.style.width = dw + 'px'; v.style.height = dh + 'px';
  v.classList.toggle('mirror', $('mirror').value === '1');
}

function readout(f) {
  if (!f || !lastK) { $('read').innerHTML = '<span>body</span><span>not in view</span>'; return; }
  const n = noteLog.filter(x => performance.now() - x.at < 4000).length, H = hands.h;
  const hand = s => (!handsLoaded ? 'off' : H[s].seen ? `${Math.round(100 * H[s].open)}% open` : 'not seen (holding)');
  const r = [['note', `${noteName(sound.note)}${n ? ` · ${n} step${n > 1 ? 's' : ''} in 4 s` : ''}`],
             ['left hand', hand('left')], ['right hand', hand('right')],
             ['LFO', `${lfoHz(lastK.lfoRate).toFixed(2)} Hz, ${Math.round(100 * lastK.lfoDepth)}% on ${$('lfoTarget').selectedOptions[0].textContent}`],
             ['centroid', sound.spec ? `${Math.round(centroid(sound.spec))} Hz` : '–']];
  $('read').innerHTML = r.map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('');
}

// calibrate: three seconds to stand upright; that posture becomes zero lean and zero curve
$('cal').onclick = () => {
  let k = 3; const c = $('count'); c.hidden = false; c.textContent = k;
  const tick = setInterval(() => { k--; if (k > 0) { c.textContent = k; return; }
    clearInterval(tick); c.hidden = true; $('calMsg').textContent = dict.calibrate() ? 'calibrated: that posture is now upright' : 'no body in view: step back and calibrate again'; }, 1000);
};

// recording: the view (video + drawing) with the sound, and the controls as CSV
const comp = document.createElement('canvas');
async function toggleRecord() {
  if (!recorder) {
    comp.width = v.videoWidth; comp.height = v.videoHeight; const g = comp.getContext('2d');
    const paint = () => { if (!recorder) return; const m = $('mirror').value === '1';
      g.save(); if (m) { g.translate(comp.width, 0); g.scale(-1, 1); } g.drawImage(v, 0, 0, comp.width, comp.height); g.restore();
      g.drawImage(cv, 0, 0, comp.width, comp.height); requestAnimationFrame(paint); };
    const streamOut = new MediaStream([...comp.captureStream(30).getVideoTracks(), ...sound.rec.stream.getAudioTracks()]);
    const type = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
    recorder = new MediaRecorder(streamOut, type ? { mimeType: type, videoBitsPerSecond: 6e6 } : undefined);
    chunks = []; rows.length = 0; recT0 = performance.now() / 1000;
    recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
    recorder.start(1000); paint();
    $('rec').textContent = '■ Stop'; $('rec').classList.add('on'); $('recDot').hidden = false;
  } else {
    const r = recorder; recorder = null;
    await new Promise(res => { r.onstop = res; r.stop(); });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/(\d{8})/, '$1-');
    save(new Blob(chunks, { type: r.mimeType.split(';')[0] }), `spectral-bass-${stamp}.${r.mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
    const head = 't,' + KNOBS.map(([id]) => id).join(',') + ',centroid_hz,note,strokes\n';
    setTimeout(() => save(new Blob([`# ${JSON.stringify({ ...opts(), routing })}\n` + head + rows.join('\n')], { type: 'text/csv' }), `spectral-bass-${stamp}.csv`), 400);
    $('rec').textContent = '● Record'; $('rec').classList.remove('on'); $('recDot').hidden = true;
  }
}
function save(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
$('rec').onclick = () => toggleRecord();
window.spectralBass = { dict, sound, strokes, hands, get knobs() { return lastK; }, get last() { return last; }, get controls() { return lastC; } };   // for the console and tests

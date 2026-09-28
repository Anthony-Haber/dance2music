// Dance2Music Live: camera → MediaPipe Pose → causal features → Web Audio.
import { Features, P, EDGES, J, PART_J, PARTS } from './features.js';
import { ChordFollower, CHORDS } from './harmony.js';
import { Engine } from './audio.js';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/';
const MODEL = m => `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${m}/float16/latest/pose_landmarker_${m}.task`;
const LOCAL = 'vendor/mediapipe/';       // `python live.py --offline` fills this

const $ = id => document.getElementById(id);
const v = $('v'), cv = $('c'), g = cv.getContext('2d');
const store = {
  get(k, d) { try { const x = localStorage.getItem('d2m:' + k); return x === null ? d : JSON.parse(x); } catch (e) { return d; } },
  set(k, x) { try { localStorage.setItem('d2m:' + k, JSON.stringify(x)); } catch (e) {} },
};

let vision = null, landmarker = null, landmarkerKey = '', stream = null, running = false;
const feats = new Features(), engine = new Engine();
let follower = new ChordFollower(store.get('mode', 'twofive'));
let lastF = null, flashes = [], fpsT = [], inferMs = 0, t0 = performance.now();

// ── setup ───────────────────────────────────────────────────────────
const exists = async url => { try { return (await fetch(url, { method: 'HEAD' })).ok; } catch (e) { return false; } };

async function loadLandmarker() {
  const model = $('model').value;
  if (landmarker && landmarkerKey === model) return landmarker;
  status('loading pose model…');
  if (!vision) {
    const local = await exists(LOCAL + 'vision_bundle.mjs');
    const base = local ? new URL(LOCAL, location.href).href : MP;
    const mod = await import(base + 'vision_bundle.mjs');
    vision = { mod, fileset: await mod.FilesetResolver.forVisionTasks(base + 'wasm'), local };
  }
  const localModel = LOCAL + `pose_landmarker_${model}.task`;
  const path = (await exists(localModel)) ? localModel : MODEL(model);
  if (landmarker) landmarker.close();
  const opts = delegate => ({ baseOptions: { modelAssetPath: path, delegate }, runningMode: 'VIDEO',
                              numPoses: 1, minPoseDetectionConfidence: 0.5,
                              minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
  try { landmarker = await vision.mod.PoseLandmarker.createFromOptions(vision.fileset, opts('GPU')); }
  catch (e) { landmarker = await vision.mod.PoseLandmarker.createFromOptions(vision.fileset, opts('CPU')); }
  landmarkerKey = model;
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
  const [w, h] = $('res').value.split('x').map(Number);
  const id = $('cam').value;
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
    deviceId: id ? { exact: id } : undefined, width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 60 } } });
  v.srcObject = stream; v.src = '';
  await v.play();
  await listDevices();               // labels appear only after permission
}

async function openFile() {
  const f = $('file').files[0];
  if (!f) throw new Error('choose a video file first');
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  v.srcObject = null; v.src = URL.createObjectURL(f); v.loop = true; v.muted = true;
  await v.play();
}

async function start() {
  engine.unlock();                     // first, while we are still inside the tap (iOS)
  try {
    $('go').disabled = true;
    await loadLandmarker();
    status('opening source…');
    if ($('source').value === 'camera') await openCamera(); else await openFile();
    feats.reset(); follower.reset();
    await engine.start($('out').value || undefined);
    applyMix(); applySens();
    watchAudio();
    running = true; $('hint').hidden = true; $('badge').hidden = false;
    $('go').textContent = 'Stop'; $('go').disabled = false;
    loop();
  } catch (e) {
    status('could not start: ' + e.message); $('go').disabled = false;
  }
}

async function stop() {
  running = false;
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null; v.pause();
  await engine.stop();
  $('go').textContent = 'Start'; $('hint').hidden = false; $('tap').hidden = true; status('stopped');
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
  if (!running) return;
  const next = () => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(frame) : requestAnimationFrame(frame));
  function frame() {
    if (!running) return;
    if (v.readyState >= 2 && landmarker) {
      const now = performance.now(), W = v.videoWidth, H = v.videoHeight;
      landmarker.detectForVideo(v, now, res => {
        inferMs = performance.now() - now;
        const lms = res.landmarks && res.landmarks[0];
        const t = (now - t0) / 1000;
        const f = lms ? feats.update(lms.map(p => ({ x: p.x, y: p.y, visibility: p.visibility })), t, W, H) : null;
        if (f) {
          const key = follower.update(f, t);
          engine.setChord(key);
          engine.update(f, mirror());
          for (const ev of f.events) flashes.push({ ...ev, t0: now });
        } else engine.idle();
        lastF = f;
      });
      fpsT.push(now); while (fpsT.length && fpsT[0] < now - 1000) fpsT.shift();
      draw();
    }
    next();
  }
  next();
}

const mirror = () => $('mirror').value === '1';

// ── drawing ─────────────────────────────────────────────────────────
const COL = { lhand: '#ffaa50', rhand: '#5ab4ff', lfoot: '#78dc78', rfoot: '#f078c8', head: '#ddd' };
const DEG = { I: '#78dc78', ii: '#5ab4ff', V: '#ffaa50', '': '#efe9df' };

function draw() {
  const W = v.videoWidth, H = v.videoHeight;
  const box = $('stage').getBoundingClientRect();
  const s = Math.min(box.width / W, box.height / H);
  const dw = Math.round(W * s), dh = Math.round(H * s);
  if (cv.width !== dw * devicePixelRatio) {
    cv.width = dw * devicePixelRatio; cv.height = dh * devicePixelRatio;
    cv.style.width = dw + 'px'; cv.style.height = dh + 'px';
  }
  v.style.width = dw + 'px'; v.style.height = dh + 'px';
  v.classList.toggle('mirror', mirror());
  const k = s * devicePixelRatio;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cv.width, cv.height);
  g.setTransform(mirror() ? -k : k, 0, 0, k, mirror() ? cv.width : 0, 0);
  const f = lastF;
  if (!f) { g.setTransform(1, 0, 0, 1, 0, 0); return; }
  const p = f.pos, lw = 2 / s;
  // rule guides
  const r = follower.last;
  if (r && r.guides && follower.mode !== 'fixed') {
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
  const c = CHORDS[follower.shown];
  $('sym').textContent = c.symbol; $('sym').style.color = DEG[c.degree];
  $('deg').textContent = c.degree;
  document.querySelectorAll('#rules [data-r]').forEach(d =>
    d.classList.toggle('now', !!r && d.dataset.r === r.rule));
  meters(f);
}
function line(x0, y0, x1, y1) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }

// ── meters and status ───────────────────────────────────────────────
const METERS = [['weight', 'Weight', '#f06e5a'], ['time', 'Time', '#fad250'],
                ['flow', 'Flow', '#c88ce6'], ['space', 'Space', '#c8e678'], ['out', 'output', '#efe9df']];
$('meters').innerHTML = METERS.map(([k, n, c]) =>
  `<div class="meter"><span>${n}</span><div class="bar"><i id="m-${k}" style="background:${c}"></i></div></div>`).join('');
let statusAt = 0;
function meters(f) {
  for (const [k] of METERS.slice(0, 4)) $('m-' + k).style.width = (100 * f[k]).toFixed(0) + '%';
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
const LAYERS = [['pad', 1], ['bass', 1], ['plucks', 1], ['wind', 1], ['wind tuned', 0.6]];
const mix = store.get('mix', Object.fromEntries(LAYERS.map(([k, d]) => [k, { vol: d, mute: false }]).concat([['master', { vol: 1 }]])));
const slider = (key, val, min, max, step, cls = '') =>
  `<input type="range" min="${min}" max="${max}" step="${step}" value="${val}" data-k="${key}" class="${cls}">`;
$('mix').innerHTML = LAYERS.map(([k]) => `<span>${k}</span>
  <button data-k="${k}" class="${mix[k]?.mute ? '' : 'on'}">${mix[k]?.mute ? 'off' : 'on'}</button>
  ${slider(k, mix[k]?.vol ?? 1, 0, 1.5, 0.01)}<span class="val" id="mv-${k.replace(' ', '_')}"></span>`).join('') +
  `<span>master</span><span></span>${slider('master', mix.master?.vol ?? 1, 0, 1.5, 0.01)}<span class="val" id="mv-master"></span>`;
function applyMix() {
  for (const [k] of LAYERS) {
    const m = mix[k] || (mix[k] = { vol: 1, mute: false });
    engine.level(k, m.mute ? 0 : m.vol);
    $('mv-' + k.replace(' ', '_')).textContent = Math.round(m.vol * 100) + '%';
  }
  engine.masterLevel(mix.master.vol); $('mv-master').textContent = Math.round(mix.master.vol * 100) + '%';
  store.set('mix', mix);
}
$('mix').addEventListener('input', e => { const k = e.target.dataset.k; if (!k) return;
  (mix[k] = mix[k] || {}).vol = +e.target.value; if (engine.ctx) applyMix(); else store.set('mix', mix); });
$('mix').addEventListener('click', e => { const k = e.target.dataset.k; if (!k || e.target.tagName !== 'BUTTON') return;
  mix[k].mute = !mix[k].mute; e.target.classList.toggle('on', !mix[k].mute);
  e.target.textContent = mix[k].mute ? 'off' : 'on'; if (engine.ctx) applyMix(); else store.set('mix', mix); });

const SENS = [['weight', 'Weight', 0.25, 3, 1], ['time', 'Suddenness', 0.25, 3, 1],
              ['flow', 'Flow', 0.25, 3, 1], ['space', 'Space', 0.25, 3, 1],
              ['smooth', 'Smoothing', 0.3, 4, 1.2]];
const sens = store.get('sens', Object.fromEntries(SENS.map(s => [s[0], s[4]])));
$('sens').innerHTML = SENS.map(([k, n, lo, hi]) => `<span>${n}</span><span></span>
  ${slider(k, sens[k] ?? 1, lo, hi, 0.05)}<span class="val" id="sv-${k}"></span>`).join('');
function applySens() {
  for (const [k] of SENS.slice(0, 4)) { P.gain[k] = sens[k]; $('sv-' + k).textContent = '×' + (+sens[k]).toFixed(2); }
  P.euroMinCutoff = 4.3 - sens.smooth;            // more smoothing = lower One Euro cutoff
  $('sv-smooth').textContent = P.euroMinCutoff.toFixed(1) + ' Hz';
  store.set('sens', sens);
}
$('sens').addEventListener('input', e => { const k = e.target.dataset.k; if (!k) return;
  sens[k] = +e.target.value; applySens(); });
applySens();

// ── controls ────────────────────────────────────────────────────────
for (const id of ['mode', 'model', 'res', 'mirror', 'source']) {
  const saved = store.get(id, null); if (saved !== null) $(id).value = saved;
}
$('camRow').hidden = $('source').value !== 'camera'; $('fileRow').hidden = $('source').value !== 'file';
$('go').onclick = () => (running ? stop() : start());
$('mode').onchange = () => { store.set('mode', $('mode').value); follower = new ChordFollower($('mode').value);
                              $('rules').style.opacity = $('mode').value === 'fixed' ? 0.35 : 1; };
$('rules').style.opacity = $('mode').value === 'fixed' ? 0.35 : 1;
$('source').onchange = () => { store.set('source', $('source').value);
  $('camRow').hidden = $('source').value !== 'camera'; $('fileRow').hidden = $('source').value !== 'file'; };
$('cam').onchange = async () => { store.set('cam', $('cam').value); if (running && stream) await openCamera(); };
$('res').onchange = async () => { store.set('res', $('res').value); if (running && stream) await openCamera(); };
$('mirror').onchange = () => store.set('mirror', $('mirror').value);
$('model').onchange = async () => { store.set('model', $('model').value); if (running) await loadLandmarker(); };
$('out').onchange = async () => { store.set('out', $('out').value);
  if (engine.ctx && engine.ctx.setSinkId) await engine.ctx.setSinkId($('out').value || ''); };
$('file').onchange = () => { if (running) openFile(); };

document.addEventListener('keydown', e => {
  if (['INPUT', 'SELECT'].includes(e.target.tagName)) return;
  if (e.key === ' ') { e.preventDefault(); running ? stop() : start(); }
  else if (e.key === 'f') { document.body.classList.toggle('perf');
    if (document.body.classList.contains('perf')) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {}); }
  else if ('123'.includes(e.key)) { $('mode').value = ['twofive', 'twofive_alt', 'fixed'][+e.key - 1]; $('mode').onchange(); }
  else if (e.key === 'm') { engine.masterLevel(engine.master && engine.master.gain.value > 0 ? 0 : mix.master.vol); }
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) document.body.classList.remove('perf'); });

// fill device lists if permission was granted before
navigator.mediaDevices?.enumerateDevices && listDevices().catch(() => {});
if (!window.isSecureContext) status('needs https or localhost for the camera');

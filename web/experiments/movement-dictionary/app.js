// Movement Dictionary: camera (or a video) → MediaPipe Pose (image + world
// landmarks) → measure.js → sound.js, drawn by view.js.
import { Dictionary } from './measure.js';
import { Sound } from './sound.js';
import { View } from './view.js';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/';
const MODEL = m => `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${m}/float16/latest/pose_landmarker_${m}.task`;
const $ = id => document.getElementById(id);
const store = { get(k, d) { try { const x = localStorage.getItem('md:' + k); return x === null ? d : JSON.parse(x); } catch { return d; } },
                set(k, v) { try { localStorage.setItem('md:' + k, JSON.stringify(v)); } catch {} } };

const STUDIES = {
  vertical: ['<b>Verticality.</b> Upright, the body is a steady hum on one note. Tilt and the hum shifts: it detunes, bends up to a semitone at 45° and opens up; leaning to a side pans it there, leaning forward brightens it, back darkens it. Hold a lean past 25° for a second and the harmony steps that way; come back upright and it returns home.',
             { vertical: true }],
  spine: ['<b>Spine, head and tail.</b> The spine is the hum itself. When a movement starts at the head, a bright sweep falls through the hum from top to bottom; when it starts at the tail, it rises from the bottom. The time the movement takes to travel from one end to the other is the length of the sweep. Curving the spine stretches the hum\'s overtones: straight is pure, curved is metallic.',
          { spine: true }],
  head: ['<b>The head, on its own.</b> Where the head points steers the sound. Looking down gives an "oo", level an "ah", up an "ee"; turning to a side moves the voice to that side. A sharp turn of the head sounds a soft accent in the new direction. The spine and the head are measured separately, so turning the head changes nothing else.',
         { head: true }],
  pairs: ['<b>Elbows and knees.</b> Each elbow and knee is a pair of voices. Touching is one note (unison); close, the two notes slowly beat against each other; as they part the interval opens to a third, a fifth, an octave. A touch strikes a note. A crossed pair (an elbow to the opposite knee) adds a tense upper voice as it closes.',
          { pairs: true }],
  circles: ['<b>Circles.</b> A hand, the head or the hips travelling in a circle plays the chord one note per quarter turn, and the sound travels round with it. The faster the circle, the faster the notes; small circles are high and quiet, big circles low and full; reversing reverses the notes, with an accent. Spinning the whole body turns the whole sound round.',
            { circles: true }],
  together: ['<b>Together.</b> All five at once: the hum from the axis and the spine, steered by the head, with elbows and knees and circles on top.',
             { vertical: true, spine: true, head: true, pairs: true, circles: true }],
};

const v = $('v'), cv = $('c');
const dict = new Dictionary(), sound = new Sound(), view = new View(cv);
let vision = null, landmarker = null, modelKey = '', stream = null, running = false, moving = 0, last = null;
let study = store.get('study', 'vertical');
const rows = []; let recorder = null, chunks = [], recT0 = 0;

function settings() {
  const S = { ...STUDIES[study][1] };
  S.fadeStill = $('fadeStill').value === '1';
  S.spineLead = $('spineMode').value !== 'curve'; S.spineCurve = $('spineMode').value !== 'lead';
  S.pairMode = $('pairMode').value; S.windDown = $('windDown').value === '1';
  return S;
}
function showStudy(s) {
  study = s; store.set('study', s);
  document.querySelectorAll('#studies button').forEach(b => b.classList.toggle('on', b.dataset.s === s));
  $('what').innerHTML = STUDIES[s][0];
}
document.querySelectorAll('#studies button').forEach(b => (b.onclick = () => showStudy(b.dataset.s)));
for (const id of ['fadeStill', 'spineMode', 'pairMode', 'windDown', 'mirror', 'model', 'source']) {
  const x = store.get(id, null); if (x !== null) $(id).value = x;
  $(id).addEventListener('change', () => store.set(id, $(id).value));
}
$('source').addEventListener('change', () => { $('fileRow').hidden = $('source').value !== 'file'; });
$('fileRow').hidden = $('source').value !== 'file';
showStudy(study);
const status = s => ($('status').textContent = s);

async function loadPose() {
  const m = $('model').value;
  if (landmarker && modelKey === m) return;
  status('loading the pose model…');
  if (!vision) { const mod = await import(MP + 'vision_bundle.mjs'); vision = { mod, fileset: await mod.FilesetResolver.forVisionTasks(MP + 'wasm') }; }
  const opts = delegate => ({ baseOptions: { modelAssetPath: MODEL(m), delegate }, runningMode: 'VIDEO', numPoses: 1,
                              minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
  let lm; try { lm = await vision.mod.PoseLandmarker.createFromOptions(vision.fileset, opts('GPU')); }
  catch { lm = await vision.mod.PoseLandmarker.createFromOptions(vision.fileset, opts('CPU')); }
  if (landmarker) landmarker.close(); landmarker = lm; modelKey = m;
}

async function start() {
  $('go').disabled = true;
  try {
    await sound.start();                                   // inside the click: browsers unlock audio here
    await loadPose();
    status('opening the source…');
    if ($('source').value === 'file') {
      const f = $('file').files[0]; if (!f) throw new Error('choose a video file first');
      v.srcObject = null; v.src = URL.createObjectURL(f); v.loop = true;
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
      v.srcObject = stream;
    }
    await v.play();
    dict.reset(); running = true; $('hint').hidden = true;
    $('go').textContent = 'Stop'; $('cal').disabled = false; $('rec').disabled = !window.MediaRecorder;
    loop();
  } catch (e) { status('could not start: ' + e.message); }
  $('go').disabled = false;
}
async function stop() {
  if (recorder) await toggleRecord();
  running = false; if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; v.pause();
  sound.update({ vertical: { tilt: 0, left: 0, forward: 0 }, spine: { curve: 0 }, head: {}, pairs: {}, circles: {}, spin: {} },
               { pairMode: 'both' }, 0);
  if (sound.ctx) await sound.ctx.suspend();
  $('go').textContent = 'Start'; $('cal').disabled = true; $('rec').disabled = true; $('hint').hidden = false; status('stopped');
}
$('go').onclick = () => (running ? stop() : start());

function loop() {
  if (!running) return;
  const next = () => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(frame) : requestAnimationFrame(frame));
  let fps = [];
  function frame() {
    if (!running) return;
    if (v.readyState >= 2 && landmarker) {
      const now = performance.now(), W = v.videoWidth, H = v.videoHeight;
      const res = landmarker.detectForVideo(v, now);
      const f = dict.update(res.landmarks && res.landmarks[0], res.worldLandmarks && res.worldLandmarks[0], now / 1000, W, H);
      last = f;
      const S = settings();
      if (f) {
        moving += 0.05 * (Math.min(1, Math.max(f.spine.speedHead, f.spine.speedTail) / 1.5) - moving);
        sound.update(f, S, moving);
        for (const e of f.events) sound.event(e, S, f);
        if (recorder) rows.push(Dictionary.csvRow({ ...f, t: f.t - recT0 }));
      }
      layout(W, H); view.draw(f, S, cv.width / W, $('mirror').value === '1');
      readout(f);
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
  if (!f) { $('read').innerHTML = '<span>body</span><span>not in view</span>'; return; }
  const r = [];
  const S = STUDIES[study][1], n = (x, d = 0) => (x === null || x === undefined ? '–' : x.toFixed(d));
  if (S.vertical) r.push(['tilt', `${n(f.vertical.tilt)}°`], ['direction', f.vertical.tilt < 4 ? 'upright' : `${n(f.vertical.dir)}° (0 forward, 90 her left)`]);
  if (S.spine) r.push(['spine curve', `${n(f.spine.curve)}°`], ['last start', f.spine.lead ? `${f.spine.lead.lead}, ${n(f.spine.lead.lag, 2)} s to travel` : '–']);
  if (S.head) r.push(['head turn', `${n(Math.abs(f.head.yaw))}° ${f.head.yaw > 0 ? 'left' : 'right'}`], ['head tilt', `${n(Math.abs(f.head.pitch))}° ${f.head.pitch > 0 ? 'up' : 'down'}`]);
  if (S.pairs) r.push(['left elbow–knee', n(f.pairs.LL, 2)], ['right elbow–knee', n(f.pairs.RR, 2)], ['crossed', `${n(f.pairs.LR, 2)} · ${n(f.pairs.RL, 2)}`]);
  if (S.circles) for (const [k, c] of Object.entries(f.circles)) if (c.active) r.push([`circle: ${k}`, `${n(Math.abs(c.rate), 1)} turns/s ${c.dir > 0 ? 'anticlockwise' : 'clockwise'}`]);
  if (S.circles && f.spin.active) r.push(['spin', `${n(Math.abs(f.spin.rate))}°/s`]);
  $('read').innerHTML = r.map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('') + '<span class="note">distances in torso lengths</span><span></span>';
}

// calibrate: three seconds to stand upright and look ahead; that posture becomes zero
$('cal').onclick = () => {
  let k = 3; const c = $('count'); c.hidden = false; c.textContent = k;
  const tick = setInterval(() => { k--; if (k > 0) { c.textContent = k; return; }
    clearInterval(tick); c.hidden = true; $('calMsg').textContent = dict.calibrate() ? 'calibrated: that posture is now upright and looking ahead' : 'no body in view: step back and calibrate again'; }, 1000);
};

// recording: the view (video + drawing) with the sound, and the measurements as CSV
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
    const ext = r.mimeType.includes('mp4') ? 'mp4' : 'webm';
    save(new Blob(chunks, { type: r.mimeType.split(';')[0] }), `movement-dictionary-${study}-${stamp}.${ext}`);
    const meta = `# study=${study} ${JSON.stringify(settings())}\n`;
    setTimeout(() => save(new Blob([meta + Dictionary.csvHeader() + '\n' + rows.join('\n')], { type: 'text/csv' }), `movement-dictionary-${study}-${stamp}.csv`), 400);
    $('rec').textContent = '● Record'; $('rec').classList.remove('on'); $('recDot').hidden = true;
  }
}
function save(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
$('rec').onclick = () => toggleRecord();
window.movementDictionary = { dict, sound, get last() { return last; } };   // for the console and tests

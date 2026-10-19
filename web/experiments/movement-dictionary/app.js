// Movement Dictionary: camera (or a video) → MediaPipe Pose (image + world
// landmarks) → measure.js → sound.js, drawn by view.js.
import { Dictionary } from './measure.js?v=body-turns-1';
import { Sound } from './sound.js?v=body-turns-1';
import { View } from './view.js?v=body-turns-1';
import { Choir } from './harmony.js';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/';
const MODEL = m => `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${m}/float16/latest/pose_landmarker_${m}.task`;
const $ = id => document.getElementById(id);
// Anthony's study/options must not overwrite Joseph's settings on the same
// localhost origin. Existing preferences can seed this experiment once read.
const store = { get(k, d) { try { const x = localStorage.getItem('md:anthony:' + k) ?? localStorage.getItem('md:' + k);
                  return x === null ? d : JSON.parse(x); } catch { return d; } },
                set(k, v) { try { localStorage.setItem('md:anthony:' + k, JSON.stringify(v)); } catch {} } };

const STUDIES = {
  vertical: ['<b>Verticality: the bass.</b> Upright is home: the choir sings the tonic (D major) over a steady hum. Tilt and the hum shifts: it detunes, bends and opens; a side lean pans it. Hold a lean to your left for half a second and the choir moves to IV (G), to your right to V (A), one voice at a time; come back upright and it walks home.',
             { vertical: true }],
  spine: ['<b>Spine: the tenor.</b> When a movement starts at the head, a bright sweep falls through the hum; when it starts at the tail, it rises. The time it takes to travel along the spine is the sweep\'s length. Curling forward bends the tenor a step down, arching back a step up, and it returns when you straighten; curving also makes the hum metallic.',
          { spine: true }],
  head: ['<b>Head: the soprano.</b> The choir sings the vowel of your head: looking down "oo", level "ah", up "ee"; turning moves the choir to that side. Looking up past 12° lifts the soprano a step, looking down lowers it, like a suspension that resolves when you look ahead again. A sharp turn sounds a soft accent.',
         { head: true }],
  pairs: ['<b>Elbows and knees: the alto.</b> Fold an elbow towards the knee on the same side and the choir moves to the relative chord: one voice changes (I becomes vi, Bm). Bring an elbow towards the opposite knee and it moves to the other neighbour (I becomes iii, F♯m). Open again and it returns. With a lean they combine: IV goes to ii or vi, V to iii or vii°. A touch strikes the alto\'s note.',
          { pairs: true }],
  arms: ['<b>Arms: the breath.</b> Not one of her five notes: an addition. How far your hands reach from your body is how much the choir breathes. Arms by your sides, it hums, quiet and dark; reaching out (to the sides, forward or up) it opens to full voice, brighter, with breath in it. The harmony does not change: only how fully it is sung.',
          { arms: true }],
  circles: ['<b>Circles.</b> A hand, the head or the hips travelling in a circle plays the choir\'s chord one note per quarter turn, and the sound travels round with it. The faster the circle, the faster the notes; small circles are high, big circles low; reversing reverses the notes, with an accent. Spinning the whole body turns the whole sound round.',
            { circles: true }],
  spin: ['<b>Body turns.</b> Each 180° turn counts once. Shoulders and hips must rotate together, with a hand or leg position swap confirming the turn. Turning faster moves the sound in stereo. Crossed arms or a disappearing face alone do not count. The direction labels follow your own body, including in mirrored view.',
         { spin: true }],
  together: ['<b>Together.</b> The whole choir: the lean chooses I, IV or V, elbows and knees turn it to a relative, the spine and the head bend their voices, circles play the chord. The arms set how fully it sings. Every change happens one voice at a time, so moving through positions sounds like a choir finding its way.',
             { vertical: true, spine: true, head: true, pairs: true, arms: true, circles: true, spin: true }],
};

const v = $('v'), cv = $('c');
const dict = new Dictionary(), sound = new Sound(), view = new View(cv), choir = new Choir();
let moves = [];
let vision = null, landmarker = null, modelKey = '', stream = null, running = false, moving = 0, last = null;
let study = location.hash === '#body-turns' ? 'spin' : store.get('study', 'vertical');
if (!(study in STUDIES)) study = 'vertical';
let spinFlashUntil = 0;
const rows = []; let recorder = null, chunks = [], recT0 = 0;

function settings() {
  const S = { ...STUDIES[study][1] };
  S.fadeStill = $('fadeStill').value === '1';
  S.spineLead = $('spineMode').value !== 'curve'; S.spineCurve = $('spineMode').value !== 'lead';
  S.pairMode = $('pairMode').value; S.windDown = $('windDown').value === '1';
  S.trigger = $('trigger').value === '1'; S.triggerAt = +$('triggerAt').value;
  return S;
}
function showStudy(s) {
  study = s; store.set('study', s);
  document.querySelectorAll('#studies button').forEach(b => b.classList.toggle('on', b.dataset.s === s));
  $('what').innerHTML = STUDIES[s][0];
  const turns = !!(STUDIES[s][1].spin || STUDIES[s][1].circles);
  $('turnReadout').hidden = $('turnPanel').hidden = !turns;
  showSpin();
}
document.querySelectorAll('#studies button').forEach(b => (b.onclick = () => showStudy(b.dataset.s)));
for (const id of ['fadeStill', 'spineMode', 'pairMode', 'windDown', 'trigger', 'triggerAt', 'mirror', 'model', 'source']) {
  const x = store.get(id, null); if (x !== null) $(id).value = x;
  $(id).addEventListener('change', () => store.set(id, $(id).value));
}
$('source').addEventListener('change', () => { $('fileRow').hidden = $('source').value !== 'file'; });
$('fileRow').hidden = $('source').value !== 'file';
const trigRow = () => ($('trigRow').hidden = $('trigger').value !== '1');
$('trigger').addEventListener('change', trigRow); trigRow();
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
    dict.reset(); choir.reset(); spinFlashUntil = 0; $('turnLast').textContent = 'No half turns counted yet';
    running = true; $('hint').hidden = true;
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
$('resetTurns').onclick = () => {
  dict.bodySpin.reset(); spinFlashUntil = 0; $('turnLast').textContent = 'No half turns counted yet'; showSpin();
};

function showSpin() {
  const s = dict.bodySpin.out;
  const dir = s.direction > 0 ? 'your left' : s.direction < 0 ? 'your right' : 'either direction';
  const messages = { ready: 'Ready for a 180° turn', turning: `Turning to ${dir}`,
    'half turn': `180° turn to ${dir} counted`, unconfirmed: 'Turn unconfirmed: keep hands or knees visible',
    'need torso': 'Show both shoulders and hips', 'torso disagreement': 'Torso tracking uncertain',
    'orientation jump': 'Tracking jumped: turn not counted', 'invalid timing': 'Tracking restarted' };
  $('turnCount').textContent = `${s.half_turns} half turn${s.half_turns === 1 ? '' : 's'}`;
  $('turnDetail').textContent = messages[s.status] || s.status;
  $('turnProgress').value = Math.min(180, s.progress_degrees);
  const evidence = [s.hands_swapped && 'hands', s.legs_swapped && 'legs'].filter(Boolean).join(' + ');
  const rows = [['progress', `${Math.min(180, s.progress_degrees).toFixed(0)}° / 180°`],
    ['turn speed', `${Math.abs(s.rate).toFixed(0)}°/s`], ['half turns', `${s.left_half_turns} left · ${s.right_half_turns} right`],
    ['torso', s.tracked ? 'shoulders + hips agree' : messages[s.status] || s.status],
    ['limb confirmation', evidence || 'waiting for a swap'],
    ['pose face cues', s.face_visible ? 'visible' : 'weak or missing']];
  $('turnValues').innerHTML = rows.map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('');
  if (s.event) {
    spinFlashUntil = performance.now() + 900;
    $('turnLast').textContent = `Last: 180° to ${dir} · ${evidence} confirmed`;
  } else if (s.status === 'unconfirmed') {
    $('turnLast').textContent = 'Last attempt: turn unconfirmed; keep hands or knees visible';
  }
  $('turnReadout').classList.toggle('detected', performance.now() < spinFlashUntil);
}

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
        const cev = choir.update(f, S, f.t);
        sound.update(f, S, moving, choir);
        for (const e of [...f.events, ...cev]) sound.event(e, S, choir);
        for (const e of cev) if (e.type === 'move') moves.push({ ...e, at: performance.now() });
        moves = moves.filter(m => performance.now() - m.at < 900);
        if (recorder) { const c = choir.describe();
          rows.push(Dictionary.csvRow({ ...f, t: f.t - recT0 }) + `,${c.chord},${Object.values(c.names).join(' ')},${cev.filter(e => e.type === 'move').map(e => e.voice).join(' ')},${(sound.breath ?? 0).toFixed(3)},${(sound.drive ?? 1).toFixed(3)}`); }
      } else sound.updateSpin(dict.bodySpin.out, S);
      layout(W, H); view.draw(f, S, cv.width / W, $('mirror').value === '1', { desc: choir.describe(), moves });
      readout(f);
      showSpin();
      fps.push(now); while (fps.length && fps[0] < now - 1000) fps.shift();
      status(f ? `${fps.length} fps` : dict.bodySpin.out.tracked ? `${fps.length} fps · torso tracked; show your face for the other studies` :
        `${fps.length} fps · no body in view: step back so your whole body is seen`);
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
  const c = choir.describe();
  r.push(['choir', `${c.chord}${c.target !== c.chord ? ' → ' + c.target : ''}`], ['voices', `${c.names.bass} ${c.names.tenor} ${c.names.alto} ${c.names.soprano}`]);
  const S = STUDIES[study][1], n = (x, d = 0) => (x === null || x === undefined ? '–' : x.toFixed(d));
  if (S.vertical) r.push(['tilt', `${n(f.vertical.tilt)}°`], ['direction', f.vertical.tilt < 4 ? 'upright' : `${n(f.vertical.dir)}° (0 forward, 90 her left)`]);
  if (S.spine) r.push(['spine curve', `${n(f.spine.curve)}°`], ['last start', f.spine.lead ? `${f.spine.lead.lead}, ${n(f.spine.lead.lag, 2)} s to travel` : '–']);
  if (S.head) r.push(['head turn', `${n(Math.abs(f.head.yaw))}° ${f.head.yaw > 0 ? 'left' : 'right'}`], ['head tilt', `${n(Math.abs(f.head.pitch))}° ${f.head.pitch > 0 ? 'up' : 'down'}`]);
  if (S.pairs) r.push(['left elbow–knee', n(f.pairs.LL, 2)], ['right elbow–knee', n(f.pairs.RR, 2)], ['crossed', `${n(f.pairs.LR, 2)} · ${n(f.pairs.RL, 2)}`]);
  if (S.arms) r.push(['reach', `left ${n(f.arms.reachL, 2)} · right ${n(f.arms.reachR, 2)}`], ['breath', `${n(100 * (f.arms.breath ?? 0))}%`]);
  const T = settings();
  if (T.trigger) r.push(['movement', `${n(f.motion.speed, 1)} body lengths/s (sounds above ${T.triggerAt})`]);
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
    setTimeout(() => save(new Blob([meta + Dictionary.csvHeader() + ',chord,voices,moved,breath,trigger\n' + rows.join('\n')], { type: 'text/csv' }), `movement-dictionary-${study}-${stamp}.csv`), 400);
    $('rec').textContent = '● Record'; $('rec').classList.remove('on'); $('recDot').hidden = true;
  }
}
function save(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
$('rec').onclick = () => toggleRecord();
window.movementDictionary = { dict, sound, get last() { return last; } };   // for the console and tests

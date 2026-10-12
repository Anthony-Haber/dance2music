// Record what you see and hear: the mirror view (video + skeleton + sphere +
// chord) composited on a canvas, and the instrument's own output (not the
// microphone), into one file you can download. MediaRecorder picks the
// container the browser supports: WebM (Chrome, Firefox) or MP4 (Safari).
// Media and timestamped observations are packaged locally in one ZIP.
import { Observations } from './observations.js';

const TYPES = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
const ATYPES = ['audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/webm'];
const pick = list => list.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';

export function packageRecording(input, onProgress = () => {}, makeWorker = () => new Worker(new URL('./bundle-worker.js', import.meta.url))) {
  return new Promise((resolve, reject) => {
    const worker = makeWorker();
    const fail = message => { worker.terminate(); reject(new Error(message)); };
    worker.onerror = event => { event.preventDefault(); fail(event.message || 'ZIP worker failed'); };
    worker.onmessageerror = () => fail('Could not read ZIP worker output');
    worker.onmessage = ({ data }) => {
      if (data.error) fail(data.error);
      else if (data.blob) { worker.terminate(); resolve(data.blob); }
      else onProgress(data.progress);
    };
    try { worker.postMessage(input); } catch (error) { fail(error.message); }
  });
}

export class Recorder {
  constructor() { this.rec = null; this.comp = document.createElement('canvas'); this.cg = this.comp.getContext('2d');
    this.busy = false; this.urls = []; this.pending = null; }
  get active() { return !!this.rec && this.rec.state === 'recording'; }
  get recording() { return this.rec !== null; }

  // engine: for its audio tap; video, overlay: the elements to composite;
  // label(): text to burn in (the chord); mirror(): whether to flip the video
  start({ engine, video, overlay, label, mirror, audioOnly, configuration, onUnexpectedStop }) {
    if (this.recording || this.busy || this.pending) throw new Error('Finish or recover the previous recording first');
    // Own cloned tracks; stopping a recording must not stop the instrument.
    const audio = new MediaStream(engine.recordStream().getAudioTracks().map(track => track.clone()));
    this.ownedTracks = audio.getTracks();
    let stream, type;
    try {
      if (audioOnly) { stream = audio; type = pick(ATYPES); }
      else {
        const W = video.videoWidth, H = video.videoHeight, scale = Math.min(1, 1920 / Math.max(W, H));
        this.comp.width = Math.round(W * scale / 2) * 2; this.comp.height = Math.round(H * scale / 2) * 2;
        this.paint = () => {
          const g = this.cg, w = this.comp.width, h = this.comp.height;
          g.save(); if (mirror()) { g.translate(w, 0); g.scale(-1, 1); }
          g.drawImage(video, 0, 0, w, h); g.restore();
          if (overlay.width) g.drawImage(overlay, 0, 0, w, h);
          const [sym, deg, col] = label();
          g.font = `600 ${Math.round(h / 16)}px -apple-system, sans-serif`; g.textAlign = 'right'; g.fillStyle = col;
          g.fillText(sym, w - h / 40, h / 12);
          g.font = `${Math.round(h / 36)}px -apple-system, sans-serif`; g.fillStyle = '#ddd'; g.fillText(deg, w - h / 40, h / 12 + h / 28);
        };
        const loop = () => { if (!this.active) return; this.paint(); this.raf = requestAnimationFrame(loop); };
        const videoTracks = this.comp.captureStream(30).getVideoTracks();
        this.ownedTracks.push(...videoTracks);
        stream = new MediaStream([...videoTracks, ...audio.getAudioTracks()]);
        type = pick(TYPES); this.paint(); this.loopStart = loop;
      }
      this.chunks = []; this.mediaError = null; this.endMs = null;
      this.rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6e6, audioBitsPerSecond: 192e3 } : undefined);
      this.type = this.rec.mimeType || type || (audioOnly ? 'audio/webm' : 'video/webm');
      this.rec.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
      this.rec.onerror = event => { this.mediaError = event.error?.message || 'Media recording interrupted'; };
      this.done = new Promise(res => { this.rec.onstop = () => {
        this.endMs ??= performance.now(); res();
        if (!this.busy) onUnexpectedStop?.();
      }; });
      this.t0 = performance.now();
      this.observations = new Observations(this.t0, { media: { mime_type: this.type,
        audio_only: audioOnly, width: audioOnly ? null : this.comp.width,
        height: audioOnly ? null : this.comp.height, nominal_fps: audioOnly ? null : 30,
        composited: !audioOnly, audio_source: 'instrument_output', overlays_burned_in: !audioOnly } });
      this.observations.configuration(configuration, this.t0);
      this.rec.start(1000);
      if (this.loopStart) this.loopStart();
      this.releaseDownloads();
      return this.type;
    } catch (error) {
      this.rec = null; this.loopStart = null; this.observations = null;
      this.cleanupTracks(); throw error;
    }
  }

  observe(observation) { if (this.active) this.observations.append(observation); }
  configuration(value) { if (this.active) this.observations.configuration(value, performance.now()); }

  async stop(onProgress) {
    if (this.busy) return null;
    if (!this.rec) return null;
    this.busy = true; this.endMs ??= performance.now();
    try {
      if (this.rec.state !== 'inactive') this.rec.stop();
      cancelAnimationFrame(this.raf); await this.done;
      const media = new Blob(this.chunks, { type: this.type.split(';')[0] });
      const ext = this.type.includes('mp4') ? (this.type.startsWith('audio') ? 'm4a' : 'mp4') : 'webm';
      const { observations, manifest } = this.observations.finish(this.endMs);
      manifest.media.error = this.mediaError; manifest.media.complete = !this.mediaError;
      const date = manifest.created_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      this.name = `dance2music-${date}-${manifest.session_id.slice(0, 8)}.zip`;
      this.pending = { media, mediaName: `recording.${ext}`, observations, manifest };
    } finally {
      this.cleanupTracks(); this.rec = null; this.loopStart = null;
      this.chunks = []; this.observations = null; this.busy = false;
    }
    return this.retry(onProgress);
  }

  async retry(onProgress) {
    if (this.busy || !this.pending) return null;
    this.busy = true;
    try {
      const blob = await packageRecording(this.pending, onProgress);
      this.releaseDownloads();
      const result = { name: this.name, url: this.url(blob), size: blob.size,
        seconds: this.pending.manifest.duration_s, observations: this.pending.manifest.observation_count,
        mediaError: this.pending.manifest.media.error };
      this.pending = null;
      return result;
    } finally { this.busy = false; }
  }

  recoveryFiles() {
    if (!this.pending) return [];
    this.releaseDownloads();
    return [[this.pending.mediaName, this.pending.media], ['observations.jsonl', this.pending.observations],
      ['manifest.json', new Blob([JSON.stringify({ ...this.pending.manifest, packaging_incomplete: true }, null, 2)],
        { type: 'application/json' })]].map(([name, blob]) => ({ name, url: this.url(blob) }));
  }
  url(blob) { const url = URL.createObjectURL(blob); this.urls.push(url); return url; }
  releaseDownloads() { for (const url of this.urls) URL.revokeObjectURL(url); this.urls = []; }
  cleanupTracks() { cancelAnimationFrame(this.raf); for (const track of this.ownedTracks || []) track.stop(); this.ownedTracks = []; }
  elapsed() { return this.active ? (performance.now() - this.t0) / 1000 : 0; }
}

// Record what you see and hear: the mirror view (video + skeleton + sphere +
// chord) composited on a canvas, and the instrument's own output (not the
// microphone), into one file you can download. MediaRecorder picks the
// container the browser supports: WebM (Chrome, Firefox) or MP4 (Safari).

const TYPES = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
const ATYPES = ['audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/webm'];
const pick = list => list.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';

export class Recorder {
  constructor() { this.rec = null; this.comp = document.createElement('canvas'); this.cg = this.comp.getContext('2d'); }
  get active() { return !!this.rec && this.rec.state === 'recording'; }

  // engine: for its audio tap; video, overlay: the elements to composite;
  // label(): text to burn in (the chord); mirror(): whether to flip the video
  start({ engine, video, overlay, label, mirror, audioOnly }) {
    const audio = engine.recordStream();
    let stream, type;
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
      stream = new MediaStream([...this.comp.captureStream(30).getVideoTracks(), ...audio.getAudioTracks()]);
      type = pick(TYPES); this.paint(); this.loopStart = loop;
    }
    this.chunks = []; this.type = type || (audioOnly ? 'audio/webm' : 'video/webm');
    this.rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6e6, audioBitsPerSecond: 192e3 } : undefined);
    this.rec.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.done = new Promise(res => { this.rec.onstop = res; });
    this.rec.start(1000);
    this.t0 = performance.now();
    if (this.loopStart) this.loopStart();
    return this.type;
  }

  async stop() {
    if (!this.rec) return null;
    this.rec.stop(); cancelAnimationFrame(this.raf); await this.done;
    const blob = new Blob(this.chunks, { type: this.type.split(';')[0] });
    const ext = this.type.includes('mp4') ? (this.type.startsWith('audio') ? 'm4a' : 'mp4') : 'webm';
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    const name = `dance2music-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    this.rec = null; this.loopStart = null;
    return { name, url, size: blob.size, seconds: (performance.now() - this.t0) / 1000 };
  }

  elapsed() { return this.active ? (performance.now() - this.t0) / 1000 : 0; }
}

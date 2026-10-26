import { LIMBS } from './watches.js';

const HISTORY_MS = 20000, CAPACITY = 4096, GAP_MS = 200;
const COLORS = ['#f18484', '#8addab', '#78baff'];

// Display history is bounded and separate from the recorder's complete stream.
export class WatchHistory {
  constructor() { this.clear(); }
  clear() { this.data = new Array(CAPACITY); this.head = 0; this.length = 0; }
  append(sample, receipt) {
    this.prune(receipt - HISTORY_MS);
    if (this.length === CAPACITY) { this.head = (this.head + 1) % CAPACITY; this.length--; }
    this.data[(this.head + this.length++) % CAPACITY] = { ...sample, receipt };
  }
  prune(before) {
    while (this.length && this.data[this.head].receipt < before) {
      this.data[this.head] = undefined; this.head = (this.head + 1) % CAPACITY; this.length--;
    }
  }
  values(after = -Infinity) {
    const result = [];
    for (let i = 0; i < this.length; i++) {
      const sample = this.data[(this.head + i) % CAPACITY];
      if (sample.receipt >= after) result.push(sample);
    }
    return result;
  }
}

export function plotValues(sample, signal) {
  return signal === 'magnitude' ? [Math.hypot(sample.ax, sample.ay, sample.az)]
    : signal === 'gyro' ? [sample.gx, sample.gy, sample.gz] : [sample.ax, sample.ay, sample.az];
}

export class WatchPlots {
  constructor(root, { now = () => performance.now() } = {}) {
    this.root = root; this.now = now; this.enabled = true; this.watches = null;
    this.signal = 'acceleration'; this.windowMs = 8000; this.lastFrame = -Infinity;
    this.histories = LIMBS.map(() => new WatchHistory());
    this.identities = LIMBS.map(() => null);
    this.cards = LIMBS.map((limb, id) => {
      const card = document.createElement('article'); card.className = 'watch-plot';
      const heading = document.createElement('div'); heading.className = 'watch-plot-heading';
      const title = document.createElement('strong'); title.textContent = limb;
      const status = document.createElement('span'); status.className = 'watch-plot-status';
      heading.append(title, status);
      const canvas = document.createElement('canvas');
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${limb}: waiting for watch samples`);
      const values = document.createElement('output'); values.className = 'watch-plot-values'; values.textContent = 'No samples yet';
      card.append(heading, canvas, values); root.querySelector('.watch-plot-grid').append(card);
      return { card, status, canvas, values, limb, id };
    });
    root.querySelector('#watchSignal').onchange = event => { this.signal = event.target.value; this.legend(); };
    root.querySelector('#watchWindow').onchange = event => { this.windowMs = Number(event.target.value) * 1000; };
    this.legend();
    this.animate = () => {
      const now = this.now();
      if (now - this.lastFrame >= 50 && !document.hidden && !root.hidden && root.getClientRects().length) {
        this.lastFrame = now; this.draw(now);
      }
      this.frame = requestAnimationFrame(this.animate);
    };
    this.frame = requestAnimationFrame(this.animate);
  }
  legend() {
    const unit = this.signal === 'gyro' ? '°/s' : 'g';
    const labels = this.signal === 'magnitude' ? ['Magnitude'] : ['X', 'Y', 'Z'];
    const legend = this.root.querySelector('.watch-plot-legend'); legend.replaceChildren();
    labels.forEach((label, index) => {
      const item = document.createElement('span'); item.textContent = `${label} (${unit})`;
      item.style.color = this.signal === 'magnitude' ? '#f2c078' : COLORS[index]; legend.append(item);
    });
    this.root.querySelector('#watchPlotHint').textContent = this.signal === 'gyro'
      ? 'T-Watch firmware reports zero gyro values; use acceleration to see motion.'
      : 'Live samples · acceleration includes gravity (about 1 g at rest) · gaps stay empty.';
  }
  append(sample, receipt) { this.histories[sample.device_id]?.append(sample, receipt); }
  setEnabled(enabled) { this.enabled = enabled; this.sync(this.watches); }
  sync(watches) {
    this.watches = watches;
    this.root.hidden = !this.enabled || !watches?.devices.size;
    for (const item of this.cards) {
      const device = watches && [...watches.devices.values()].find(d => d.device_id === item.id);
      const identity = device?.device.id ?? null;
      if (identity !== this.identities[item.id]) {
        this.histories[item.id].clear(); this.identities[item.id] = identity;
      }
      item.card.hidden = item.id >= 2 && watches?.assignments.legsPairID === null;
      const state = device ? watches.status(device) : 'not connected';
      item.status.textContent = device ? `${state} · ${watches.rate(device).toFixed(0)} Hz` : state;
      item.card.dataset.state = state;
    }
  }
  draw(now = this.now()) {
    const series = this.histories.map(history => { history.prune(now - HISTORY_MS); return history.values(now - this.windowMs); });
    const magnitude = this.signal === 'magnitude', unit = this.signal === 'gyro' ? '°/s' : 'g';
    // A common range lets the limbs be compared; a minimum range prevents
    // stationary sensor noise from being magnified to fill the chart.
    let extent = this.signal === 'gyro' ? 250 : 2;
    for (const samples of series) for (const sample of samples) {
      for (const value of plotValues(sample, this.signal)) extent = Math.max(extent, Math.abs(value) * 1.1);
    }
    extent = Math.ceil(extent * 2) / 2;
    for (const item of this.cards) {
      if (item.card.hidden) continue;
      const samples = series[item.id], canvas = item.canvas, width = canvas.clientWidth, height = canvas.clientHeight;
      if (!width || !height) continue;
      const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      }
      const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
      const left = 37, right = width - 9, top = 8, bottom = height - 20;
      const low = magnitude ? 0 : -extent;
      const x = time => left + (time - now + this.windowMs) / this.windowMs * (right - left);
      const y = value => bottom - (value - low) / (extent - low) * (bottom - top);
      ctx.font = '10px -apple-system, sans-serif'; ctx.fillStyle = '#a89f95'; ctx.lineWidth = 1;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (const value of magnitude ? [0, 1, extent] : [-extent, 0, extent]) {
        ctx.strokeStyle = '#34312d'; ctx.beginPath(); ctx.moveTo(left, y(value)); ctx.lineTo(right, y(value)); ctx.stroke();
        ctx.fillText(String(value), left - 5, y(value));
      }
      for (let i = 0; i <= 4; i++) {
        const px = left + i / 4 * (right - left);
        ctx.strokeStyle = '#272522'; ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, bottom); ctx.stroke();
      }
      ctx.textBaseline = 'bottom'; ctx.textAlign = 'left'; ctx.fillText(`−${this.windowMs / 1000} s`, left, height);
      ctx.textAlign = 'right'; ctx.fillText('now', right, height);
      ctx.save(); ctx.beginPath(); ctx.rect(left, top - 1, right - left, bottom - top + 2); ctx.clip();
      for (let axis = 0; axis < (magnitude ? 1 : 3); axis++) {
        ctx.strokeStyle = magnitude ? '#f2c078' : COLORS[axis]; ctx.lineWidth = 1.5; ctx.beginPath();
        let previous = null;
        for (const sample of samples) {
          const px = x(sample.receipt), py = y(plotValues(sample, this.signal)[axis]);
          if (!previous || sample.receipt - previous.receipt > GAP_MS) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
          previous = sample;
        }
        ctx.stroke();
      }
      ctx.restore();
      const latest = samples.at(-1), fresh = latest && now - latest.receipt <= GAP_MS && item.card.dataset.state.startsWith('streaming');
      const text = fresh ? plotValues(latest, this.signal).map((v, i) => `${magnitude ? '|a|' : ['X', 'Y', 'Z'][i]} ${v.toFixed(2)}`).join('   ') + ` ${unit}`
        : latest ? 'Waiting for new samples' : 'No samples in this window';
      if (item.values.textContent !== text) {
        item.values.textContent = text; canvas.setAttribute('aria-label', `${item.limb}, ${this.signal}: ${text}`);
      }
      if (!samples.length) {
        ctx.fillStyle = '#a89f95'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('Waiting for watch samples', (left + right) / 2, (top + bottom) / 2);
      }
    }
  }
  destroy() { cancelAnimationFrame(this.frame); }
}

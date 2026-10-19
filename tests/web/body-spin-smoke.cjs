// Real browser/UI loop with a synthetic video and pose model. No camera/model
// downloads. Start live.py separately. Requires Playwright and a Chromium binary.
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const python = process.env.PYTHON || path.join(root, '.venv/bin/python');
const reference = JSON.parse(execFileSync(python,
  ['-c', "import runpy; runpy.run_path('tests/test_body_spin.py', run_name='__main__')"],
  { cwd: root, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }));
const output = path.join(root, 'output/movement-dictionary');

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE, args: ['--mute-audio'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(frames => {
      localStorage.setItem('md:study', JSON.stringify('vertical'));
      globalThis.spinFrames = frames; globalThis.spinIndex = 0; globalThis.spinStopAt = 30;
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
        const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
        const g = canvas.getContext('2d');
        const paint = () => { g.fillStyle = '#181818'; g.fillRect(0, 0, 1280, 720); };
        paint(); const timer = setInterval(paint, 33), stream = canvas.captureStream(30);
        stream.getTracks().forEach(t => { const stop = t.stop.bind(t); t.stop = () => { clearInterval(timer); stop(); }; });
        globalThis.spinStream = stream; return stream;
      } });
    }, reference.cases[0].frames);
    await page.route('https://cdn.jsdelivr.net/npm/@mediapipe/**', route => route.fulfill({
      contentType: 'text/javascript', body: `
        export class FilesetResolver { static async forVisionTasks() { return {}; } }
        export class PoseLandmarker { static async createFromOptions() { return {
          close() {}, detectForVideo() {
            if (globalThis.spinForceLoss) return { landmarks: [], worldLandmarks: [] };
            const i = Math.min(globalThis.spinIndex++, globalThis.spinStopAt, spinFrames.length - 1);
            const f = spinFrames[i];
            if (i === globalThis.spinStopAt) globalThis.spinIndex = i;
            return { landmarks: [f.image], worldLandmarks: [f.world] };
          }
        }; } }` }));
    for (const [file, name, key] of [['sound.js', 'Sound', 'turnTestSound'], ['harmony.js', 'Choir', 'turnTestChoir']])
      await page.route(`**/${file}*`, route => route.fulfill({ contentType: 'text/javascript',
        body: fs.readFileSync(path.join(root, 'web/experiments/movement-dictionary', file), 'utf8')
          .replace(`export class ${name}`, `class Base${name}`) +
          `\nexport class ${name} extends Base${name} { constructor(...args) { super(...args); globalThis.${key} = this; } }` }));
    await page.goto((process.env.SPIN_URL || 'http://127.0.0.1:5094/experiments/movement-dictionary/') + '#body-turns');
    assert.equal(await page.locator('[data-s=spin]').getAttribute('class'), 'on');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('md:study'))), 'vertical');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('md:anthony:study'))), 'spin');
    assert.equal(await page.locator('#cal').isDisabled(), true);
    await page.locator('#go').click();
    await page.waitForFunction(() => document.querySelector('#turnCount').textContent === '1 quarter turn');
    assert.equal(await page.locator('#turnPitch').innerText(), 'Turn tonic: E4');
    assert.deepEqual(await page.evaluate(() => turnTestChoir.sounding()), { bass: 52, tenor: 59, alto: 64, soprano: 68 });
    await page.waitForFunction(() => Math.abs(turnTestSound.voices.soprano.oscs[0].frequency.value - 440 * 2 ** ((68 - 69) / 12)) < 1);
    assert.ok((await page.locator('#turnValues').innerText()).includes('0 (0 left · 0 right)'));
    assert.equal(await page.locator('#turnProgress').getAttribute('max'), '90');
    assert.ok((await page.locator('#turnLast').innerText()).includes('90°'));
    await page.evaluate(() => { globalThis.spinStopAt = 60; });
    await page.waitForFunction(() => document.querySelector('#turnCount').textContent === '2 quarter turns');
    assert.equal(await page.locator('#turnPitch').innerText(), 'Turn tonic: F♯4');
    assert.ok((await page.locator('#turnValues').innerText()).includes('1 (1 left · 0 right)'));
    assert.ok((await page.locator('#turnValues').innerText()).includes('weak or missing'));
    assert.ok((await page.locator('#turnLast').innerText()).includes('confirmed'));
    assert.equal(await page.locator('#cal').isEnabled(), true);
    await page.evaluate(() => { globalThis.spinStopAt = 120; });
    await page.waitForFunction(() => document.querySelector('#turnCount').textContent === '4 quarter turns');
    assert.equal(await page.locator('#turnPitch').innerText(), 'Turn tonic: A4');
    assert.deepEqual(await page.evaluate(() => turnTestChoir.sounding()), { bass: 57, tenor: 64, alto: 69, soprano: 73 });
    await page.waitForFunction(() => Math.abs(turnTestSound.parts[0].o1.frequency.value - 110) < 0.3);
    await page.locator('#mirror').selectOption('0');
    assert.equal(await page.locator('#turnCount').innerText(), '4 quarter turns');
    assert.ok((await page.locator('#turnValues').innerText()).includes('2 left · 0 right'));
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'body-turns-browser.png'), fullPage: true });
    await page.evaluate(() => { spinFrames.reverse(); spinIndex = 0; spinStopAt = 30; });
    await page.waitForFunction(() => document.querySelector('#turnCount').textContent === '5 quarter turns');
    assert.equal(await page.locator('#turnPitch').innerText(), 'Turn tonic: G4');
    await page.locator('[data-s=spine]').click();
    await page.waitForFunction(() => turnTestChoir.turnPitch.state.semitones === 0);
    await page.locator('[data-s=spin]').click();
    await page.waitForFunction(() => document.querySelector('#turnPitch').textContent === 'Turn tonic: G4');
    await page.locator('#resetTurns').click();
    assert.equal(await page.locator('#turnCount').innerText(), '0 quarter turns');
    assert.equal(await page.locator('#turnPitch').innerText(), 'Turn tonic: D4');
    await page.evaluate(() => { globalThis.spinForceLoss = true; });
    await page.waitForFunction(() => document.querySelector('#turnDetail').textContent === 'Show both shoulders and hips');
    await page.evaluate(() => { globalThis.spinForceLoss = false; });
    await page.locator('[data-s=spine]').click(); assert.equal(await page.locator('#turnPanel').isHidden(), true);
    await page.locator('[data-s=spin]').click(); assert.equal(await page.locator('#turnPanel').isVisible(), true);
    await page.locator('#go').click();
    assert.equal(await page.evaluate(() => spinStream.getTracks().every(t => t.readyState === 'ended')), true);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ tests: ['actual video/pose/UI loop', '90-degree quarter turn', '180-degree half turn', 'face absence',
      'D-major turn pitch', 'actual oscillator frequencies', 'held notes', 'right-turn descent', 'other studies keep original pitch',
      'separate Anthony settings', 'calibrate enables', 'mirror invariance', 'reset', 'complete pose loss', 'study switch', 'camera cleanup', 'mobile width'],
      synthetic: true, pageErrors: errors, screenshot: path.join(output, 'body-turns-browser.png') }, null, 2));
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });

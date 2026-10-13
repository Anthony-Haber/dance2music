// Integration smoke with synthetic MediaPipe outputs + browser fake camera.
// NODE_PATH may point to an existing Playwright install. No model downloads.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output/web-port'); fs.mkdirSync(output, { recursive: true });
const python = path.join(root, '.venv/Scripts/python.exe');
const server = spawn(python, ['-u', '-m', 'http.server', '5098', '--bind', '127.0.0.1'], { cwd: root, windowsHide: true });
const model = `
export const FilesetResolver = { forVisionTasks: async () => ({}) };
export const PoseLandmarker = { createFromOptions: async () => ({close(){}, detectForVideo(video,t,callback) {
  const lm = Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:1,presence:1}));
  lm[11].x=.35; lm[12].x=.65; lm[11].y=lm[12].y=.3;
  lm[23].x=.4; lm[24].x=.6; lm[23].y=lm[24].y=.7;
  lm[15].x=.38; lm[16].x=.62;
  if(globalThis.testWide){lm[15].x=.15; lm[16].x=.85;}
  callback(globalThis.testLoss ? {landmarks:[]} : {landmarks:[lm],worldLandmarks:[lm]});
} }) };
let nextHand=0;
export const GestureRecognizer = {createFromOptions: async () => {
 const side=nextHand++%2?'R':'L';
 return {close(){}, recognizeForVideo() {
  const lm=Array.from({length:21},(_,i)=>({x:.4+(i%4)*.04,y:.2+i*.025,z:0}));
  return {landmarks:[lm],gestures:[[{categoryName:globalThis.testGestures?.[side] || 'Open_Palm',score:1}]]};
 }};
}};
`;
async function main() {
  await new Promise((resolve, reject) => {
    server.stdout.on('data', data => { if (data.toString().includes('5098')) resolve(); });
    server.once('error', reject); server.once('exit', code => reject(new Error('Server exited ' + code)));
    setTimeout(() => reject(new Error('Server startup timeout')), 10000).unref();
  });
  const browser = await chromium.launch({ headless: true, channel: 'chromium', args: [
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required' ] });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/vision_bundle.mjs', route => route.fulfill({ body: model, contentType: 'text/javascript' }));
    await page.route('**/*.task', route => route.fulfill({ body: 'fixture-model', contentType: 'application/octet-stream' }));
    await page.goto('http://127.0.0.1:5098/web/live/?phone=1');
    assert.equal(await page.locator('#mode').inputValue(), 'instrument');
    assert.equal(await page.locator('#model').inputValue(), 'lite');
    assert.equal(await page.locator('#cam').inputValue(), 'facing:environment');
    assert.equal(await page.locator('#handMode').inputValue(), 'far');
    assert.equal(await page.locator('#gestures').isVisible(), false);
    assert.equal(await page.locator('#hint').isVisible(), true);
    await page.locator('#go').click();
    await page.waitForFunction(() => document.querySelector('#go').textContent === 'Stop');
    await page.waitForFunction(() => document.querySelector('#instrumentState').textContent.includes('READY'));
    await page.waitForFunction(() => (document.querySelector('#handTxt').textContent.match(/confirmed Open_Palm/g) || []).length === 2);
    await page.waitForTimeout(300);
    await page.evaluate(() => { window.testGestures = { L: 'Closed_Fist', R: 'Open_Palm' }; });
    await page.waitForFunction(() => document.querySelector('#instrumentState').textContent.includes('Ball owned by L'));
    await page.screenshot({ path: path.join(output, 'phone-owned-ball.png') });
    await page.evaluate(() => { window.testGestures = { L: 'Open_Palm', R: 'Open_Palm' }; });
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.testGestures = { L: 'Closed_Fist', R: 'Closed_Fist' }; });
    await page.waitForFunction(() => document.querySelector('#instrumentState').textContent.includes('Midpoint ball'));
    await page.evaluate(() => { window.testGestures = { L: 'Open_Palm', R: 'Open_Palm' }; });
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.testGestures = { L: 'Closed_Fist', R: 'Closed_Fist' }; });
    await page.waitForFunction(() => document.querySelector('#instrumentState').textContent.includes('Two balls'));
    await page.screenshot({ path: path.join(output, 'phone-split.png') });
    await page.locator('#mergeBall').click();
    await page.evaluate(() => { window.testGestures = { L: 'Victory', R: 'Victory' }; });
    await page.waitForFunction(() => document.querySelector('#sym').textContent.endsWith('aug'));
    await page.locator('#rootMode').selectOption('midpoint');
    await page.screenshot({ path: path.join(output, 'phone-midpoint.png') });
    await page.locator('#handMode').selectOption('near');
    await page.waitForFunction(() => document.querySelector('#handTxt').textContent.includes('left: —'));
    assert.equal(await page.locator('#sym').textContent(), 'Caug', 'one near-mode hand must hold quality');
    await page.locator('#handMode').selectOption('far');
    await page.evaluate(() => { window.testLoss = true; });
    await page.waitForFunction(() => document.querySelector('#instrumentState').textContent.includes('tracking missing'));
    await page.evaluate(() => { window.testLoss = false; });
    await page.waitForTimeout(250);
    await page.locator('#rec').click();
    await page.waitForFunction(() => document.querySelector('#rec').textContent.includes('Stop recording'));
    await page.waitForTimeout(500);
    await page.locator('#rec').click();
    await page.waitForFunction(() => document.querySelector('#recMsg').textContent.includes('.zip'), null, { timeout: 20000 });
    await page.locator('#go').click();
    await page.waitForFunction(() => document.querySelector('#go').textContent === 'Start');
    assert.equal(await page.locator('#badge').isVisible(), false);
    await page.locator('#mode').selectOption('six');
    assert.equal(await page.locator('#instrumentControls').isVisible(), false);
    assert.equal(await page.locator('#gestures').isVisible(), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile page overflow');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('#mode').selectOption('instrument');
    await page.screenshot({ path: path.join(output, 'desktop-controls.png') });
    const samples = await page.evaluate(async () => {
      const { Engine } = await import('/web/live/audio.js');
      const synth = new Engine(); synth.ctx = new OfflineAudioContext(1, 48000, 48000); synth.timbre = 'native';
      await synth.start();
      synth.setChord({ key: 'C13', bass: 36, voices: [48, 52, 55, 58, 62, 69], instrument: true }, true);
      for (const [name, layer] of Object.entries(synth.layers)) layer.gain.value = name === 'pad' ? 1 : 0;
      synth.pamp.gain.value = 1; synth.inst.gain.value = 0.5;
      synth.dry.gain.value = 1; synth.wet.gain.value = 0;
      const result = await synth.ctx.startRendering(); return Array.from(result.getChannelData(0));
    });
    assert.ok(samples.every(Number.isFinite));
    const peak = Math.max(...samples.map(Math.abs)), rms = Math.sqrt(samples.reduce((s, x) => s + x * x, 0) / samples.length);
    assert.ok(peak <= 1 && rms > 0.02, 'native chord must sound without clipping');
    const wav = Buffer.alloc(44 + samples.length * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples.length * 2, 40);
    samples.forEach((sample, i) => wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + i * 2));
    fs.writeFileSync(path.join(output, 'browser-native-C13.wav'), wav);
    fs.writeFileSync(path.join(output, 'audio-results.json'), JSON.stringify({ peak, rms, sampleRate: 48000, notes: [48, 52, 55, 58, 62, 69] }, null, 2));
    // Existing upstream recording tests exercise ZIP/microphone lifecycle using
    // real browser media APIs, with no physical microphone/camera or downloads.
    await page.goto('http://127.0.0.1:5098/tests/browser.html');
    const recording = await page.evaluate(async () => {
      const tests = await import('/tests/recording.test.js'); return tests.runTests();
    });
    fs.writeFileSync(path.join(output, 'recording-tests.json'), JSON.stringify(recording, null, 2));
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify({ passed: true, errors,
      browser: await browser.version(), synthetic: true,
      checks: ['phone defaults','start/audio','neutral','transfer','merge','split','quality','root mode','near hand uniqueness','loss',
        'recording ZIP','stop','legacy mode','mobile layout','desktop controls'] }, null, 2));
    console.log('Browser smoke passed: phone/desktop controls, gestures, tracking loss, recording ZIP, legacy modes.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.kill());

// Browser/HTTP integration using a synthetic IAC driver and Web MIDI disabled.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output/anthony-instrument/safari-midi');
fs.mkdirSync(output, { recursive: true });
const log = path.join(output, 'browser-midi.json');
// Start tests/web/midi_bridge_server.py separately with PYTHONPATH set to the
// repository root and MIDI_TEST_LOG set to this output file before running.
const read = name => JSON.parse(fs.readFileSync(log, 'utf8'))[name];
async function main() {
  const deadline = Date.now() + 15000;
  let lastError = '';
  while (true) {
    try {
      const ready = await new Promise(resolve => {
        const request = http.get('http://127.0.0.1:5098/api/midi/ports', response => {
          lastError = 'HTTP ' + response.statusCode;
          response.resume(); resolve(response.statusCode === 200);
        });
        request.setTimeout(1000, () => request.destroy());
        request.on('error', error => {lastError = error.message;resolve(false);});
      });
      if (ready) break;
    } catch (error) {lastError = error.stack;}
    if (Date.now() >= deadline) throw new Error('Start tests/web/midi_bridge_server.py before this test. ' + lastError);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => Object.defineProperty(navigator, 'requestMIDIAccess', { value: undefined }));
    await page.route('**/midi.js*', route => {
      const source = fs.readFileSync(path.join(root, 'web/live/midi.js'), 'utf8').replace('export class MidiOutput', 'class BrowserMidiOutput');
      return route.fulfill({ contentType: 'text/javascript', body: source +
        '\nexport class MidiOutput extends BrowserMidiOutput {constructor(options){super(options);globalThis.testMidi=this;}}' });
    });
    await page.route('**/live.js*', route => route.fulfill({ contentType: 'text/javascript',
      body: fs.readFileSync(path.join(root, 'web/live/live.js'), 'utf8') +
        '\nglobalThis.testMidiGain=midiGain;globalThis.testMix=mix;' }));
    await page.goto('http://127.0.0.1:5098/live/');
    assert.equal(await page.locator('#mode').inputValue(), 'instrument');
    assert.equal(await page.evaluate(() => typeof navigator.requestMIDIAccess), 'undefined');
    await page.locator('#midiConnect').click();
    await page.waitForFunction(() => document.querySelector('#midiStatus').textContent.includes('IAC output port'));
    assert.deepEqual(await page.locator('#midiPort option').allTextContents(), ['Select a MIDI port', 'IAC Driver Safari Test A', 'IAC Driver Safari Test B']);
    assert.deepEqual(JSON.parse(fs.readFileSync(log, 'utf8')), {}, 'listing must not open any port');
    const name = 'IAC Driver Safari Test A';
    await page.locator('#midiPort').selectOption(name);
    await page.waitForFunction(() => document.querySelector('#midiStatus').textContent.includes('MIDI connected'));
    await page.locator('#soundRoute').selectOption('midi');
    await page.evaluate(async () => {testMidi.update({notes:[48,52,55],root_midi:48,gain:.5});await testMidi.port.queue;});
    assert.deepEqual(read(name).messages.slice(-4), [[176,11,64],[144,48,64],[144,52,64],[144,55,64]]);
    const count = read(name).messages.length;
    await page.evaluate(async () => {testMidi.update({notes:[48,52,55],root_midi:48,gain:.5});await testMidi.port.queue;});
    assert.equal(read(name).messages.length, count);
    // Exercise actual frame/controller/span modules, then inspect HTTP driver bytes.
    const levels = await page.evaluate(async () => {
      const { InstrumentFrames } = await import('/live/instrument-frame.js?v=linear-span-1');
      const { InstrumentController } = await import('/live/instrument-controller.js');
      const { MidiSpan } = await import('/live/midi.js?v=linear-span-1');
      testMix.master.vol = testMix.pad.vol = 1.5; testMix.pad.mute = false;
      const levels = [];
      for (const fraction of [0,.25,.5,.75,1]) {
        const span = 10+190*fraction, h = Math.sqrt(Math.max(0,1600-((span/2-20)/2)**2));
        const world = Array.from({length:33}, () => ({x:0,y:0,z:0}));
        for (const [i,x,y] of [[11,-20,0],[12,20,0],[13,(-20-span/2)/2,h],
          [14,(20+span/2)/2,h],[15,-span/2,0],[16,span/2,0],[23,-20,100],[24,20,100]]) world[i]={x,y,z:0};
        const image = world.map(p => ({x:(p.x+320)/640,y:(p.y+200)/480,visibility:1,presence:1}));
        const frame = new InstrumentFrames().read(image, {}, 0, 640, 480, world);
        const state = new InstrumentController().update(frame);
        const gain = new MidiSpan().update(frame.midi_landmarks,state.ball_owner,!!frame.torso_px && state.balls.length>0);
        testMidi.update({...state,gain:testMidiGain(gain)}); await testMidi.port.queue;
        levels.push(testMidi.notes.expression);
      }
      testMix.pad.mute = true;
      testMidi.update({notes:[48,52,55],root_midi:48,gain:testMidiGain(1)}); await testMidi.port.queue;
      levels.push(testMidi.notes.expression);
      testMix.pad.mute = false;
      testMidi.update({notes:[48,52,55],root_midi:48,gain:testMidiGain(1)}); await testMidi.port.queue;
      return levels;
    });
    assert.deepEqual(levels,[0,32,64,95,127,0]);
    for (const velocity of [32,64,95,127]) assert.ok(read(name).messages.some(m=>m[0]===144 && m[2]===velocity));
    await page.evaluate(async () => {testMidi.update({notes:[48,52,55],root_midi:48,gain:.25});await testMidi.port.queue;});
    assert.deepEqual(read(name).messages.slice(-7), [[128,48,0],[128,52,0],[128,55,0],[176,11,32],[144,48,32],[144,52,32],[144,55,32]]);
    await page.evaluate(async () => {testMidi.update({notes:[48,51,55],root_midi:48,gain:1});await testMidi.port.queue;});
    assert.deepEqual(read(name).messages.slice(-7), [[128,48,0],[128,52,0],[128,55,0],[176,11,127],[144,48,127],[144,51,127],[144,55,127]]);
    await page.locator('#midiPanic').click();
    await page.evaluate(() => testMidi.port.queue);
    assert.equal(await page.locator('#soundRoute').inputValue(), 'browser');
    assert.deepEqual(read(name).messages.slice(-8), [[128,48,0],[128,51,0],[128,55,0],[176,11,0],[176,64,0],[176,123,0],[176,64,0],[176,123,0]]);
    await page.locator('#midiPort').selectOption('IAC Driver Safari Test B');
    await page.waitForFunction(() => testMidi.port?.name === 'IAC Driver Safari Test B');
    assert.equal(read(name).closed, true);
    await page.locator('#soundRoute').selectOption('midi');
    await page.locator('#midiKind').selectOption('root');
    await page.locator('#midiChannel').selectOption('2');
    await page.evaluate(async () => {testMidi.update({notes:[48,52,55],root_midi:60,gain:1});await testMidi.port.queue;});
    assert.deepEqual(read('IAC Driver Safari Test B').messages.slice(-2), [[177,11,127],[145,60,127]]);
    await page.evaluate(async () => {testMidi.update({notes:[],root_midi:60,gain:0});await testMidi.port.queue;});
    assert.deepEqual(read('IAC Driver Safari Test B').messages.slice(-2), [[129,60,0],[177,11,0]]);
    await page.screenshot({ path: path.join(output, 'browser-midi.png'), fullPage: true });
    await page.evaluate(() => testMidi.port.close());
    assert.equal(read('IAC Driver Safari Test B').closed, true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ engine:'Chromium with Safari-style Web MIDI absence',
      linearSpanVelocities:levels, tests:['linear span via frame/controller and HTTP','audio boost/mute gating','port list','explicit selection','held chords','quality changes','panic','port switch','root/channel','tracking loss','native close'], pageErrors:errors }, null, 2));
  } finally { await browser.close(); }
}
main().catch(error => {console.error(error);process.exitCode=1;});

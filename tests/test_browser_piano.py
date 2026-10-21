"""Floor Piano: prepared samples, real Web Audio/Three.js, offline browser.

Camera/foot fixtures are explicit; this does not certify physical contact.
"""
import base64
import argparse
import functools
import http.server
import json
from pathlib import Path
import threading
import zipfile
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def controls(context, origin):
    page = context.new_page()
    page.route('**/vision_bundle.mjs', lambda r: r.fulfill(body=(ROOT/'tests/vision-fixture.js').read_text(), content_type='text/javascript'))
    page.route('**/*.task', lambda r: r.fulfill(body='fixture-model'))
    page.goto(origin+'/web/live/')
    page.locator('#sceneMode').select_option('floor-piano')
    assert page.locator('#pianoListening').input_value() == 'piano-only'
    assert page.locator('#pianoListening').is_visible()
    assert page.locator('#pianoNearCamera').is_visible()
    assert page.locator('#pianoNearCamera').is_checked(), 'black keys face camera by default'
    assert not page.locator('#sceneTouch').is_visible()
    page.locator('#pianoListening').select_option('piano-body')
    page.locator('#pianoNearCamera').uncheck()
    page.reload()
    page.wait_for_function("document.body.dataset.ready==='true'", timeout=45000)
    assert page.locator('#sceneMode').input_value() == 'floor-piano'
    assert page.locator('#pianoListening').input_value() == 'piano-body'
    assert not page.locator('#pianoNearCamera').is_checked(), 'orientation persists after reload'
    page.locator('#pianoListening').select_option('piano-only')
    page.locator('#pianoNearCamera').check()
    # Cancellation while a sample request is pending must close the source and
    # leave no engine/scene running when that request eventually completes.
    pending = []
    page.route('**/vendor/piano/C4.mp3', lambda route: pending.append(route))
    page.locator('#go').click()
    page.wait_for_function("document.querySelector('#pianoStatus').textContent.includes('Loading piano samples')")
    page.locator('#go').click()
    page.wait_for_function("document.querySelector('#go').textContent==='Start'")
    assert page.evaluate("document.querySelector('#v').srcObject.getTracks().every(t=>t.readyState==='ended')")
    for route in pending:
        route.abort()
    page.unroute('**/vendor/piano/C4.mp3')
    page.evaluate('''async()=>{
      const {SceneController}=await import('/web/live/scene/controller.js');
      const {installDragFixture}=await import('/tests/scene-drag.test.js');
      SceneController.prototype.start=function(video,source,mode){return installDragFixture(this,video,mode);};
      const {Engine}=await import('/web/live/audio.js');const start=Engine.prototype.start;
      Engine.prototype.start=function(...args){window.pianoEngine=this;return start.apply(this,args);};
      const {PianoPlayer}=await import('/web/live/piano.js');const load=PianoPlayer.prototype.load;
      PianoPlayer.prototype.load=function(...args){window.pianoPlayer=this;return load.apply(this,args);};
      window.strike=async()=>{
        const {footFrame}=await import('/tests/piano.test.js');const c=dragScene,t=performance.now();
        for(const time of [t-30,t]){const f=footFrame(time,[[.4375,.06]],c.scan.objects[0]);c.publishTouches(c.interactions.update(c.scan.objects,f.depth,f.pose,f.pose,time));}
      };
      window.jump=async()=>{
        const {footFrame}=await import('/tests/piano.test.js'),c=dragScene,observe=c.observePose;
        const previous=pianoPlayer.held.get('piano-60');c.observePose=()=>{};
        try{
          for(const up of [.014,.014,0,0]){
            const t=performance.now(),f=footFrame(t,[[.4375,.06,up]],c.scan.objects[0]);
            // Takeoff can happen entirely between the slower depth results.
            c.publishTouches(up?c.interactions.observe(c.scan.objects,f.pose,t):c.interactions.update(c.scan.objects,f.depth,f.pose,f.pose,t));
            await new Promise(resolve=>setTimeout(resolve,35));
          }
          return !!previous&&pianoPlayer.held.has('piano-60')&&pianoPlayer.held.get('piano-60')!==previous;
        }finally{c.observePose=observe;}
      };
    }''')
    for iteration in range(2):
        page.locator('#go').click()
        page.wait_for_function("document.querySelector('#go').textContent==='Stop'")
        assert page.locator('#sceneMode').is_disabled()
        assert page.locator('#pianoListening').is_enabled()
        assert page.locator('#pianoNearCamera').is_enabled()
        assert page.evaluate('dragScene.scan.objects[0].black_keys_near_camera')
        assert page.locator('#pianoStatus').inner_text() == 'Piano samples ready'
        page.locator('#rec').click()
        page.wait_for_function("document.querySelector('#rec').textContent==='■ Stop recording'")
        page.evaluate('strike()')
        page.wait_for_function('pianoPlayer.held.size===1')
        assert page.evaluate('jump()'), 'landing restarts the actual sample on the same key'
        page.evaluate('window.beforeFlip=dragScene.scan.objects[0]')
        page.locator('#pianoNearCamera').uncheck()
        assert page.evaluate('pianoPlayer.held.size===0'), 'live orientation switch releases audio'
        assert page.evaluate('''()=>{const o=dragScene.scan.objects[0];return !o.black_keys_near_camera&&
          o.keys.filter(k=>k.black).every(k=>k.z<0)&&o.size===beforeFlip.size&&o.support===beforeFlip.support;}''')
        page.evaluate('strike()')
        page.wait_for_function('pianoPlayer.held.size===1')
        page.locator('#pianoListening').select_option('piano-body')
        if iteration == 0:
            previous_generation = page.evaluate('dragScene.generation')
            page.evaluate("window.previousPianoStrike={...pianoPlayer.events.find(e=>e.type==='piano-note-on')}")
            page.locator('#res').select_option('1280x720')
            page.wait_for_function('(generation)=>dragScene.generation>generation&&dragScene.state===\'active\'', arg=previous_generation)
            assert page.evaluate('pianoPlayer.held.size===0'), 'source change releases held keys'
            assert page.evaluate('!dragScene.scan.objects[0].black_keys_near_camera'), 'source change keeps orientation'
            assert page.evaluate('pianoPlayer.event(previousPianoStrike,dragScene)===null'), 'source change rejects old note events'
            page.evaluate('strike()')
            page.wait_for_function('pianoPlayer.held.size===1')
        try:
            with page.expect_download(timeout=120000) as download:
                page.locator('#go').click()
        except Exception:
            print('PIANO RECORDING STATUS', page.locator('#recMsg').inner_text(), flush=True)
            raise
        page.wait_for_function("document.querySelector('#go').textContent==='Start'")
        with zipfile.ZipFile(download.value.path()) as archive:
            manifest = json.loads(archive.read('manifest.json'))
            rows = [json.loads(row) for row in archive.read('observations.jsonl').splitlines()]
        events = [e for row in rows for e in (row.get('analysis') or {}).get('piano_events', [])]
        events += manifest.get('final_analysis', {}).get('piano_events', [])
        assert any(e['type'] == 'piano-note-on' for e in events), events
        assert any(e['type'] == 'piano-note-off' for e in events), events
        assert any(e['type'] == 'piano-note-off' and e['reason'] == 'lift-off' for e in events), events
        assert any(e['type'] == 'piano-note-on' and e['reason'] == 'landing' for e in events), events
        assert any(e['type'] == 'piano-note-off' and e['reason'] == 'piano-orientation' for e in events), events
        assert any(e['type'] == 'piano-listening' for e in events), events
        assert manifest['schema_version'] == 1
        config = manifest['configurations'][0]['settings']['scene']
        assert config['scan']['objects'][0]['keys'][0]['midi'] == 60
        assert config['piano']['samples']['license'] == 'CC BY 3.0'
        orientations = {c['settings']['scene']['black_keys_near_camera'] for c in manifest['configurations']}
        assert orientations == {True, False}, 'recording retains both orientations'
        for c in manifest['configurations']:
            scene = c['settings']['scene']
            if scene.get('scan'):
                obj = scene['scan']['objects'][0]
                assert obj['black_keys_near_camera'] == scene['black_keys_near_camera']
                assert all((key['z'] > 0) == scene['black_keys_near_camera'] for key in obj['keys'] if key['black'])
        assert page.evaluate('pianoPlayer.held.size===0&&pianoPlayer.voices.size===0')
        assert not page.locator('#pianoNearCamera').is_checked(), 'Stop keeps orientation'
        page.locator('#pianoNearCamera').check()
    page.close()
    print('PASS persisted controls, live orientation/audio release, sample startup cancellation, source changes while held, repeated Start/Stop, live Listening, recorded orientation/layout/provenance and shutdown releases', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--camera', action='store_true', help='Open an interactive real-camera check instead of fixtures')
    parser.add_argument('--seconds', type=int, default=300)
    args = parser.parse_args()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=ROOT))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    output = Path('/private/tmp/d2m-piano-validation'); output.mkdir(exist_ok=True)
    try:
        with sync_playwright() as p:
            options = ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-webgpu']
            if not args.camera: options += ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
            browser = p.chromium.launch(channel='chrome', headless=not args.camera, args=options)
            context = browser.new_context(permissions=['camera'], accept_downloads=True)
            external = []
            def route(r):
                if r.request.url.startswith('http://127.0.0.1:'): r.continue_()
                else: external.append(r.request.url); r.abort()
            context.route('**/*', route)
            errors = []
            context.on('page', lambda page: page.on('pageerror', lambda e: errors.append(str(e))))
            page = context.new_page()
            origin = f'http://127.0.0.1:{server.server_port}'
            if args.camera:
                page.goto(origin+'/web/live/')
                page.evaluate('''async()=>{
                  const {SceneController}=await import('/web/live/scene/controller.js');
                  const start=SceneController.prototype.start;
                  SceneController.prototype.start=function(...args){window.pianoScene=this;return start.apply(this,args);};
                  const visible=SceneController.prototype.visible;window.pianoVisibility={};
                  SceneController.prototype.visible=function(now){
                    const result=visible.call(this,now);
                    if(this.state==='active'){
                      const reason=result.some(Boolean)?'visible':this.changedSince?'scene-change':this.unreliableSince?'alignment':this.latest?'stale-depth':'waiting-depth';
                      pianoVisibility[reason]=(pianoVisibility[reason]||0)+1;
                    }
                    return result;
                  };
                  const {PianoPlayer}=await import('/web/live/piano.js');const log=PianoPlayer.prototype.log;
                  window.physicalPianoEvents=[];
                  PianoPlayer.prototype.log=function(e){window.physicalPianoEvents.push(e);return log.call(this,e);};
                  const {PianoInteractions}=await import('/web/live/scene/piano-touch.js');
                  const {pianoLocal}=await import('/web/live/scene/piano-layout.js');
                  const observe=PianoInteractions.prototype.observe;window.pianoContactTrace=[];
                  PianoInteractions.prototype.observe=function(objects,pose,now){
                    const events=observe.call(this,objects,pose,now),o=objects.find(o=>o.shape==='keyboard');
                    if(o&&this.depth){
                      pianoContactTrace.push({timestamp:now,pose_timestamp:pose?.timestamp,depth_age:now-this.depth.timestamp,
                        generation:pianoScene.generation,keyboard:{size:o.size,normal:o.normal,support:o.support,black_keys_near_camera:o.black_keys_near_camera},
                        feet:(pose?.points||[]).map(p=>{const s=this.states.get(p.foot),point=this.points.find(q=>q.foot===p.foot);
                          return {foot:p.foot,joint:p.joint,x:p.x,y:p.y,ankle_y:p.anchor?.y,landmark_y:p.landmarkY,key:s?.key,airborne:s?.airborne,
                            lift_since:s?.liftSince,peak_rise:s?.peakRise,peak_ankle_rise:s?.peakAnkleRise,
                            ground:s?.ground,local:point?pianoLocal(o,point.position):null};})});
                      if(pianoContactTrace.length>600)pianoContactTrace.splice(0,pianoContactTrace.length-600);
                    }
                    return events;
                  };
                }''')
                page.locator('#res').select_option('640x480')
                page.locator('#sceneMode').select_option('floor-piano')
                page.locator('#go').click()
                page.wait_for_function("document.querySelector('#go').textContent==='Stop'", timeout=240000)
                print('PHYSICAL PIANO READY', page.locator('#sceneStatus').inner_text(), flush=True)
                page.on('download', lambda download: download.save_as(output/download.suggested_filename))
                trace_path = output/f'physical-contact-{server.server_port}.jsonl'
                trace_timestamp = -1
                for second in range(args.seconds):
                    if page.is_closed(): break
                    page.wait_for_timeout(1000)
                    if second % 5 == 0:
                        result = page.evaluate('''()=>({state:pianoScene.state,message:pianoScene.message,
                          depth_age_ms:pianoScene.latest?performance.now()-pianoScene.latest.timestamp:null,
                          reason:pianoScene.interactions.reason,feet:pianoScene.currentTouchPose?.points,
                          keys:pianoScene.scan.objects.length,events:physicalPianoEvents,
                          contact_trace:pianoContactTrace,
                          visibility:pianoVisibility,
                          configuration:pianoScene.configuration()})''')
                        result['browser_errors'] = errors
                        (output/'physical-results.json').write_text(json.dumps(result, indent=2))
                        # Keep the complete numerical trace for a reported miss;
                        # the browser retains only a bounded rolling window.
                        with trace_path.open('a') as trace:
                            trace.write(json.dumps({'configuration': result['configuration']})+'\n')
                            for row in result['contact_trace']:
                                if row['timestamp'] > trace_timestamp:
                                    trace.write(json.dumps(row)+'\n')
                                    trace_timestamp = row['timestamp']
                        # Capturing GPU canvases repeatedly can itself interrupt
                        # depth inference and make an interactive test flicker.
                        if second == 0: page.screenshot(path=str(output/'physical-preview.png'))
                        print('PHYSICAL', json.dumps({k:v for k,v in result.items() if k not in ['configuration','feet','events','contact_trace']}), 'events', len(result['events']), flush=True)
                if not page.is_closed() and page.locator('#go').inner_text() == 'Stop': page.locator('#go').click()
                browser.close()
                return
            page.goto(origin+'/tests/browser.html')
            for test in ['runPianoGeometry', 'runPianoOrientation', 'runPianoContact', 'runPianoJump', 'runPianoSmallJumps', 'runPianoShiftedLandings', 'runPianoAnkleBounces', 'runPianoJumpReplay', 'runPianoBounceReplay', 'runPianoVisibility', 'runPianoAudio', 'runPianoLifecycle']:
                for result in page.evaluate('async name=>(await import("/tests/piano.test.js"))[name]()', test):
                    print('PASS', result, flush=True)
                if test == 'runPianoGeometry':
                    (output/'piano-preview.png').write_bytes(base64.b64decode(page.evaluate('pianoPreview').split(',')[1]))
            (output/'piano-preview.png').write_bytes(base64.b64decode(page.evaluate('pianoPreview').split(',')[1]))
            controls(context, origin)
            assert not external, external
            assert not errors, errors
            print('PASS fresh browser profile; zero external asset requests or uncaught errors', flush=True)
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()

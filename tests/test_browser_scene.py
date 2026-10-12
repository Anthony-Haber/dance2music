"""Chrome scene tests. Requires scene_assets.prepare() and Playwright.

--real-models exercises prepared assets with all external requests blocked.
--camera additionally uses the physical camera for placement and throughput.
"""
import argparse
import base64
import functools
import http.server
import io
import json
from pathlib import Path
import statistics
import threading
import zipfile
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_args): pass

def real_models(page, origin, camera, output, resolution):
    page.goto(origin+'/web/live/')
    page.evaluate('''async()=>{
      const {SceneController}=await import('/web/live/scene/controller.js');
      const pose=SceneController.prototype.pose;
      SceneController.prototype.pose=function(now){window.sceneUnderTest=this;(window.poseSamples||=[]).push(now);return pose.call(this,now);};
      const {Engine}=await import('/web/live/audio.js');const start=Engine.prototype.start;
      Engine.prototype.start=function(...args){window.engineUnderTest=this;return start.apply(this,args);};
      const update=Engine.prototype.update;
      Engine.prototype.update=function(...args){window.engineUnderTest=this;return update.apply(this,args);};
    }''')
    page.locator('#res').select_option(resolution)
    page.locator('#model').select_option('full')
    page.locator('#go').click()
    page.wait_for_function("document.querySelector('#go').textContent==='Stop'",timeout=120000)
    page.wait_for_timeout(3000)
    page.evaluate('window.poseSamples=[]')
    page.wait_for_timeout(6000)
    baseline=page.evaluate('poseSamples.length/6')
    page.locator('#go').click()
    page.wait_for_function("document.querySelector('#go').textContent==='Start'")
    page.locator('#sceneObjects').check()
    page.locator('#go').click()
    page.wait_for_function("document.querySelector('#go').textContent==='Stop'",timeout=240000)
    assert page.locator('#sceneObjects').is_disabled()
    assert page.evaluate("['active','empty'].includes(sceneUnderTest.state)"),page.locator('#sceneStatus').inner_text()
    if not camera:
        assert page.evaluate("sceneUnderTest.state==='empty' && sceneUnderTest.scan.objects.length===0"),'test-pattern camera must reject placements'
    print('REAL SCAN',page.evaluate('({state:sceneUnderTest.state,objects:sceneUnderTest.scan.objects.length,surfaces:sceneUnderTest.scan.surfaces.map(s=>s.kind),scan_ms:sceneUnderTest.scanMs})'),flush=True)
    page.wait_for_timeout(3000)
    page.evaluate('window.poseSamples=[]')
    samples=[]
    for _ in range(10):
        page.wait_for_timeout(1000)
        samples.append(page.evaluate('({latency:sceneUnderTest.depthLatency,suppressed:sceneUnderTest.suppressed,objects:sceneUnderTest.scan.objects.length,state:sceneUnderTest.state,audio:window.engineUnderTest?.ctx?.state,mask_foreground:sceneUnderTest.person?.data.reduce((n,p)=>n+(p>.5),0)||0})'))
    enabled=page.evaluate('poseSamples.length/10')
    page.screenshot(path=str(output/'scene-preview.png'))
    # Exercise the added GPU load even when nobody is touching a placement.
    # These injected visual bursts are explicitly separate from detected contact.
    stress=None
    if page.evaluate('sceneUnderTest.scan.objects.length>0'):
        page.evaluate('''()=>{
          window.poseSamples=[];window.effectStressStart=performance.now();window.effectStressVisible=0;
          window.effectStressTimer=setInterval(()=>{
            const c=sceneUnderTest,now=performance.now();
            for(const object of c.scan.objects)c.renderer.touch({object_id:object.id,position:object.position,effect_timestamp_ms:now});
            if(c.visible(now).some(Boolean))window.effectStressVisible++;
          },350);
        }''')
        page.wait_for_timeout(5000)
        stress=page.evaluate('''()=>({pose_fps:poseSamples.length*1000/(performance.now()-effectStressStart),
          visible_samples:effectStressVisible,objects:sceneUnderTest.scan.objects.length,injected_visual_bursts:true})''')
        page.screenshot(path=str(output/'scene-burst-stress.png'))
        page.evaluate('clearInterval(effectStressTimer)')
        print('EFFECT STRESS',stress,flush=True)
    page.locator('#sceneDebug').check()
    page.locator('#rec').click()
    page.wait_for_function("document.querySelector('#rec').textContent==='■ Stop recording'")
    page.wait_for_timeout(1200)
    with page.expect_download() as download: page.locator('#rec').click()
    download.value.save_as(output/'scene-recording.zip')
    page.locator('#sceneRescan').click()
    page.wait_for_function("['active','empty'].includes(sceneUnderTest.state)",timeout=60000)
    result={'resolution':resolution,'baseline_pose_fps':baseline,'enabled_pose_fps':enabled,'ratio':enabled/baseline,'effect_stress':stress,'median_depth_ms':statistics.median(s['latency'] for s in samples),'samples':samples,
            'configuration':page.evaluate('sceneUnderTest.configuration()'),'browser':page.context.browser.version}
    (output/'scene-results.json').write_text(json.dumps(result,indent=2))
    print('REAL PERFORMANCE',json.dumps({k:v for k,v in result.items() if k not in ['samples','configuration']}),flush=True)
    page.locator('#go').click()
    page.wait_for_function("document.querySelector('#go').textContent==='Start'")
    assert enabled>=baseline*.85,'pose throughput fell below 85% of baseline'
    if stress:
        assert stress['visible_samples']>0,'effect stress must exercise visible objects'
        assert stress['pose_fps']>=baseline*.85,'particle bursts fell below 85% of baseline pose throughput'
    assert all(s['audio'] in [None,'running'] for s in samples),'audio context interrupted'
    if camera: assert any(s['mask_foreground']>0 for s in samples),'camera acceptance requires an actual nonzero person mask, not just pose FPS'
    print('PASS real models, scan, recording, rescan, performance; external networking blocked',flush=True)

def live_controls(context, origin):
    page=context.new_page()
    page.route('**/vision_bundle.mjs',lambda r:r.fulfill(body=(ROOT/'tests/vision-fixture.js').read_text(),content_type='text/javascript'))
    page.route('**/*.task',lambda r:r.fulfill(body='fixture-model'))
    page.route('**/scene/worker.js',lambda r:r.fulfill(body="self.onmessage=({data})=>postMessage({...data,type:'status',message:'Loading test scene…'});",content_type='text/javascript'))
    page.goto(origin+'/web/live/')
    assert not page.locator('#sceneObjects').is_checked()
    page.locator('#sceneObjects').check()
    assert page.locator('#sceneTouch').is_checked()
    page.locator('#sceneTouch').uncheck()
    page.reload()
    assert page.locator('#sceneObjects').is_checked()
    assert not page.locator('#sceneTouch').is_checked()
    page.locator('#sceneTouch').check()
    page.locator('#source').select_option('file')
    assert page.locator('#sceneObjects').is_disabled()
    page.locator('#source').select_option('camera')
    assert not page.locator('#sceneObjects').is_disabled()
    page.locator('#go').click()
    page.wait_for_function("document.querySelector('#sceneStatus').textContent.includes('Loading test scene')")
    assert page.locator('#go').inner_text()=='Cancel'
    assert page.locator('#sceneObjects').is_disabled()
    page.locator('#go').click()
    page.wait_for_function("document.querySelector('#go').textContent==='Start'")
    assert page.evaluate("document.querySelector('#v').srcObject.getTracks().every(t=>t.readyState==='ended')")
    page.evaluate("Object.defineProperty(navigator,'gpu',{configurable:true,value:undefined})")
    page.locator('#go').click()
    page.wait_for_function("document.querySelector('#go').textContent==='Stop'")
    assert 'WebGPU' in page.locator('#sceneStatus').inner_text()
    assert not page.locator('#rec').is_disabled()
    page.locator('#rec').click()
    page.wait_for_function("document.querySelector('#rec').textContent==='■ Stop recording'")
    page.evaluate('''async()=>{
      const {SceneController}=await import('/web/live/scene/controller.js');
      const original=SceneController.prototype.takeTouchEvents;
      SceneController.prototype.takeTouchEvents=function(){
        SceneController.prototype.takeTouchEvents=original;
        const now=performance.now();return [{object_id:0,shape:'cube',part:'left foot',x:.5,position:[0,0,-2],generation:1,
          timestamp_ms:now,effect_timestamp_ms:now,approximate:true}];
      };
    }''')
    page.wait_for_timeout(350)
    with page.expect_download() as download: page.locator('#rec').click()
    with zipfile.ZipFile(io.BytesIO(Path(download.value.path()).read_bytes())) as archive:
        rows=[json.loads(line) for line in archive.read('observations.jsonl').splitlines()]
    notes=[(event,row) for row in rows for event in (row.get('analysis') or {}).get('scene_touch_events',[])]
    assert len(notes)==1,'live callback plays/records a contact once'
    event,row=notes[0]
    assert event['sound']['chord']==row['analysis']['chord']['key']
    assert event['sound']['midi']==row['analysis']['chord']['bass']+36
    page.locator('#go').click()
    page.wait_for_function("document.querySelector('#go').textContent==='Start'")
    page.evaluate("localStorage.removeItem('d2m:sceneObjects')")
    page.close()
    print('PASS live scene controls, cancellation/fallback, and live contact-to-chord audio metadata in recording',flush=True)

def drag_controls(context, origin):
    page=context.new_page()
    page.route('**/vision_bundle.mjs',lambda r:r.fulfill(body=(ROOT/'tests/vision-fixture.js').read_text(),content_type='text/javascript'))
    page.route('**/*.task',lambda r:r.fulfill(body='fixture-model'))
    page.goto(origin+'/web/live/')
    page.evaluate('''async()=>{
      const {SceneController}=await import('/web/live/scene/controller.js');
      const {installDragFixture}=await import('/tests/scene-drag.test.js');
      SceneController.prototype.start=function(video){return installDragFixture(this,video);};
    }''')
    page.locator('#res').select_option('640x480');page.locator('#sceneObjects').check();page.locator('#go').click()
    page.wait_for_function("document.querySelector('#go').textContent==='Stop'")
    page.wait_for_timeout(150)
    def position(): return page.evaluate('dragScene.scan.objects[0].support')
    def centre():
        return page.evaluate('''async()=>{
          const {project}=await import('/web/live/scene/geometry.js'),o=dragScene.scan.objects[0],r=document.querySelector('#c').getBoundingClientRect();
          const p=project(o.position,160,120,document.querySelector('#mirror').value==='1');
          return [r.left+(p[0]+.5)/160*r.width,r.top+(p[1]+.5)/120*r.height];
        }''')
    def begin():
        x,y=centre();page.mouse.move(x,y);assert page.locator('#c').evaluate("e=>e.style.cursor")=='grab'
        page.mouse.down();assert page.evaluate('!!dragScene.drag');return x,y
    original=position()
    page.locator('#rec').click();page.wait_for_function("document.querySelector('#rec').textContent==='■ Stop recording'")
    x,y=begin();page.mouse.move(x-60,y,steps=8);page.mouse.up()
    moved=position();assert moved[0]>original[0]+.2,'mirrored mouse drag moves toward matching image location'
    assert page.evaluate("dragScene.scan.objects[0].placement==='manual' && dragScene.touchObjects().length===1")
    # Mouse placement never fires a musical contact by itself.
    assert page.evaluate('dragScene.interactions.count===0 && !dragScene.takeTouchEvents().length')
    x,y=begin();page.mouse.move(x+30,y,steps=3);page.keyboard.press('Escape');page.mouse.up()
    assert position()==moved,'Escape restores previous transform'
    x,y=begin();box=page.locator('#c').bounding_box();page.mouse.move(box['x']+box['width']+30,y,steps=3)
    assert 'Nearest fitting position' in page.locator('#sceneDragStatus').inner_text()
    page.mouse.up();snapped=position();assert snapped[0]<original[0]-.2,'invalid drop moves to the closest fitting position by the dragged image edge'
    page.locator('#mirror').select_option('0');page.wait_for_timeout(60)
    x,y=begin();page.mouse.move(x+25,y,steps=3);page.mouse.up();assert position()[0]>snapped[0],'unmirrored dragging follows cursor'
    before_cancel=position();x,y=begin();page.mouse.move(x-25,y,steps=3)
    page.locator('#c').dispatch_event('pointercancel',{'pointerId':1});page.mouse.up();assert position()==before_cancel,'pointer cancellation restores transform'
    x,y=begin();page.mouse.move(x-25,y,steps=3);page.set_viewport_size({'width':1100,'height':760});page.wait_for_timeout(100);page.mouse.up()
    assert position()==before_cancel and not page.evaluate('!!dragScene.drag'),'resize cancels safely'
    page.wait_for_timeout(150)
    with page.expect_download() as download: page.locator('#rec').click()
    with zipfile.ZipFile(io.BytesIO(Path(download.value.path()).read_bytes())) as archive:
        manifest=json.loads(archive.read('manifest.json'))
    configs=[c['settings']['scene']['scan']['objects'][0] for c in manifest['configurations'] if c['settings'].get('scene',{}).get('scan')]
    assert any(o.get('placement')=='manual' and o['support']==before_cancel for o in configs),'recording saves changed placements'
    assert configs[0]['support']==original,'earlier recording snapshot stays immutable'
    x,y=begin();page.mouse.move(x-15,y,steps=3);page.keyboard.press('Space');page.mouse.up()
    assert page.locator('#go').inner_text()=='Start' and not page.evaluate('!!dragScene.drag') and page.locator('#c').evaluate("e=>e.style.cursor")==''
    page.locator('#go').click();page.wait_for_function("document.querySelector('#go').textContent==='Stop'");page.wait_for_timeout(100)
    x,y=begin();page.mouse.move(x-15,y,steps=3);page.evaluate("document.querySelector('#sceneRescan').click()");page.mouse.up()
    assert not page.evaluate('!!dragScene.drag') and not page.evaluate('dragScene.scan.objects.length'),'rescan invalidates the drag and placements'
    page.locator('#go').click();page.wait_for_function("document.querySelector('#go').textContent==='Start'")
    page.evaluate("localStorage.removeItem('d2m:sceneObjects')");page.close()
    print('PASS actual app mouse dragging, mirror modes, nearest-position drop beyond image edge, Escape/cancel/resize/stop, no mouse-triggered notes, and recording placement snapshots',flush=True)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--real-models',action='store_true');parser.add_argument('--camera',action='store_true');parser.add_argument('--resolution',default='640x480',choices=['640x480','1280x720']);parser.add_argument('--output',type=Path,default=Path('/private/tmp/d2m-scene-validation'));args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=ROOT));threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            options=['--autoplay-policy=no-user-gesture-required']
            if not args.camera: options+=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']
            browser=p.chromium.launch(channel='chrome',headless=True,args=options)
            context=browser.new_context(permissions=['camera'],accept_downloads=True)
            external=[]
            def route(request):
                if request.request.url.startswith('http://127.0.0.1:'): request.continue_()
                else: external.append(request.request.url);request.abort()
            context.route('**/*',route)
            page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('console',lambda m:errors.append(m.text) if 'GL_INVALID_OPERATION' in m.text and 'readpixels' in m.text.lower() else None)
            origin=f'http://127.0.0.1:{server.server_port}'
            page.goto(origin+'/tests/browser.html')
            for test in ['runGeometryTests','runRendererTests','runPersonMaskTests','runTouchTests','runTouchEffectsTests','runMotionOcclusionTests','runTouchControllerTests','runTouchAudioTests','runLifecycleTests','runSceneRecordingTests']:
                for name in page.evaluate('(async name=>{const m=await import("/tests/scene.test.js");return await m[name]();})',test): print('PASS',name,flush=True)
            (args.output/'touch-effects.png').write_bytes(base64.b64decode(page.evaluate('touchEffectPreview').split(',',1)[1]))
            for name in page.evaluate('(async()=>{const m=await import("/tests/scene-drag.test.js");return m.runDragTests();})'): print('PASS',name,flush=True)
            if not args.camera:
                live_controls(context,origin)
                drag_controls(context,origin)
            if args.real_models: real_models(page,origin,args.camera,args.output,args.resolution)
            # MediaPipe 1.0.1 attempts telemetry; it is blocked too and is not
            # an asset dependency. Any other external request is a failure.
            assert all(url == 'https://odml.pa.googleapis.com/v1/log' for url in external),external
            if external: print('PASS MediaPipe telemetry blocked:', len(external), flush=True)
            assert not errors,errors
            print('PASS no external asset requests or uncaught browser errors',flush=True)
            browser.close()
    finally: server.shutdown()
if __name__=='__main__':main()

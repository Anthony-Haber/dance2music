"""Magenta browser integration with genuine local MRT2 and blocked external networking.

Default mode uses explicit pose/surface fixtures for repeatable interaction tests.
--live-seconds runs real camera/depth inference and measures throughput; fake
camera video is used unless --camera is supplied. Neither replaces listening
acceptance by a person in front of the camera.
"""
import argparse
import json
from pathlib import Path
import socket
import subprocess
import sys
import time
import zipfile
from live_ui_helpers import open_live_sections
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]


def install_hooks(page, fixtures):
    page.evaluate('''async fixtures=>{
      const {MagentaScene}=await import('/live/magenta.js');
      const start=MagentaScene.prototype.start,observe=MagentaScene.prototype.observe;
      MagentaScene.prototype.start=function(...args){window.magentaUnderTest=this;return start.apply(this,args);};
      MagentaScene.prototype.observe=function(lms,now){return observe.call(this,window.magentaTrackingLoss?null:lms,now);};
      const {Engine}=await import('/live/audio.js');const engineStart=Engine.prototype.start,update=Engine.prototype.update;
      Engine.prototype.start=function(...args){window.engineUnderTest=this;return engineStart.apply(this,args);};
      if(fixtures)Engine.prototype.update=function(f,values,...rest){return update.call(this,f,{...values,'inst.level':1,'pad.level':.3,'bass.level':.2},...rest);};
      const {SceneController}=await import('/live/scene/controller.js');
      const pose=SceneController.prototype.pose;
      SceneController.prototype.pose=function(now){window.sceneUnderTest=this;(window.poseTimes||=[]).push(now);return pose.call(this,now);};
      if(fixtures){
        const {installDragFixture}=await import('/test-fixtures/scene-drag.test.js');
        SceneController.prototype.start=function(video,source,mode){return installDragFixture(this,video,mode);};
      }
    }''', fixtures)


def integration(page, output):
    page.locator('#sceneMode').select_option('magenta')
    page.locator('#magenta-model').select_option('small')
    assert page.locator('#magenta-input').input_value()=='audio-notes'
    assert page.locator('#magenta-blend').input_value()=='0'
    field=page.locator('#magentaPrompt0');field.fill('soft warm piano');field.press('Space');field.press('r')
    assert page.locator('#go').inner_text()=='Start','typing must not start session or recording'
    field.fill('soft warm piano');page.locator('.magenta-prompt button').nth(0).click()
    page.reload()
    open_live_sections(page)
    page.wait_for_function("document.body.dataset.ready==='true'",timeout=45000)
    assert page.locator('#magentaPrompt0').input_value()=='soft warm piano'
    install_hooks(page, True)
    page.locator('#go').click()
    page.wait_for_function('window.magentaUnderTest?.ready',timeout=150000)
    page.wait_for_timeout(500)
    assert page.locator('#sceneMode').is_disabled()
    # Hold delivery acknowledgments while the native engine keeps generating.
    # The server must bound the entire TCP/browser/Worklet transport, not only
    # its Python queue, and resume with current audio when credits return.
    page.evaluate('''()=>{
      const m=magentaUnderTest,receive=m.playbackNode.port.onmessage;
      window.heldOutputAcks=[];window.stalledOutputBlocks=0;
      window.countStalledOutput=e=>{if(e.data instanceof ArrayBuffer)stalledOutputBlocks++;};
      m.ws.addEventListener('message',countStalledOutput);
      m.playbackNode.port.onmessage=e=>{if(e.data.type==='ack')heldOutputAcks.push(e.data);else receive(e);};
      window.resumeOutput=()=>{m.ws.removeEventListener('message',countStalledOutput);m.playbackNode.port.onmessage=receive;heldOutputAcks.forEach(data=>receive({data}));};
    }''')
    page.wait_for_timeout(1000)
    assert 0<page.evaluate('stalledOutputBlocks')<=5,'stalled output must retain at most five transport blocks'
    page.evaluate('resumeOutput()')
    page.wait_for_timeout(400)
    assert page.evaluate('magentaUnderTest.ready&&magentaUnderTest.playbackPending<5'),'credit release resumes current native output'
    # Label hit testing shares the actual mirrored preview coordinates.
    for mirror in ('0','1'):
        page.locator('#mirror').select_option(mirror)
        page.wait_for_function('dragScene.labelRects?.some(r=>r.id===0)')
        point=page.evaluate('''()=>{const r=dragScene.labelRects.find(r=>r.id===0),c=document.querySelector('#c'),b=c.getBoundingClientRect(),v=document.querySelector('#v'),scale=Math.min(b.width/v.videoWidth,b.height/v.videoHeight),w=v.videoWidth*scale,h=v.videoHeight*scale;
          let x=r.x+r.width/2;if(document.querySelector('#mirror').value==='1')x=1-x;
          return [b.left+(b.width-w)/2+x*w,b.top+(b.height-h)/2+(r.y+r.height/2)*h];}''')
        page.mouse.click(*point)
        assert page.locator('#magentaEditor').evaluate('e=>e.open'),'visible prompt label opens editor'
        assert not page.evaluate('!!dragScene.drag'),'label editing never starts dragging'
        page.locator('#magentaEditorText').fill('canceled text')
        page.locator('#magentaEditorCancel').click()
        assert page.locator('#magentaPrompt0').input_value()=='soft warm piano'
    page.evaluate('''()=>{
      const m=magentaUnderTest,receive=m.captureNode.port.onmessage;window.captureEnergy=0;
      m.captureNode.port.onmessage=e=>{for(const v of e.data.samples)window.captureEnergy+=v*v;receive(e);};
      m.ws.send(JSON.stringify({type:'stop',session:m.session,generation:m.generation-1}));
      m.ws.send(JSON.stringify({type:'stop',session:0,generation:m.generation}));
    }''')
    page.wait_for_timeout(1200)
    assert page.evaluate('engineUnderTest.originalMonitor.gain.value')<.001
    assert page.evaluate('captureEnergy')>1,'original audio must reach conditioning while its monitor is zero'
    assert page.evaluate('magentaUnderTest.ready&&magentaUnderTest.ws.readyState===WebSocket.OPEN'),'late session/generation commands cannot stop the current helper'
    releases=page.evaluate("magentaUnderTest.events.filter(e=>e.type==='notes-released').length")
    page.locator('#magenta-influence').evaluate("e=>{e.value='70';e.dispatchEvent(new Event('input'));}")
    page.wait_for_timeout(100)
    assert page.evaluate("magentaUnderTest.events.filter(e=>e.type==='notes-released').length")==releases,'audio influence must not release or retrigger pitched notes'
    page.locator('#magenta-influence').evaluate("e=>{e.value='35';e.dispatchEvent(new Event('input'));}")
    page.locator('#magentaPrompt1').fill('gentle acoustic bass')
    page.locator('.magenta-prompt button').nth(1).click()
    page.wait_for_function("magentaUnderTest.states[1]==='ready'&&magentaUnderTest.appliedTexts[1]==='gentle acoustic bass'",timeout=90000)
    page.locator('#magenta-input').select_option('audio')
    page.wait_for_function('magentaUnderTest.referenceLatency>0',timeout=90000)
    assert page.evaluate('magentaUnderTest.owners.size')==0,'reference-only mode releases notes'
    page.locator('#magenta-listening').select_option('both')
    page.wait_for_timeout(400)
    assert abs(page.evaluate('engineUnderTest.originalMonitor.gain.value')-.501187)<.01
    assert abs(page.evaluate('engineUnderTest.magentaMonitor.gain.value')-.501187)<.01
    page.locator('#magenta-listening').select_option('blend')
    page.locator('#magenta-tracking').select_option('fade')
    page.evaluate('window.magentaTrackingLoss=true')
    page.wait_for_timeout(1800)
    assert page.evaluate('engineUnderTest.magentaTracking.gain.value')<.001
    assert page.evaluate('magentaUnderTest.owners.size')==0
    page.evaluate('window.magentaTrackingLoss=false')
    page.wait_for_timeout(500)
    assert page.evaluate('engineUnderTest.magentaTracking.gain.value')>.99
    page.locator('#magenta-tracking').select_option('keep')
    page.evaluate('window.magentaTrackingLoss=true')
    page.wait_for_timeout(800)
    assert page.evaluate('engineUnderTest.magentaTracking.gain.value')>.99
    page.evaluate('window.magentaTrackingLoss=false')
    page.locator('#magenta-input').select_option('continue')
    page.wait_for_function('!document.querySelector("#magentaCapture").disabled',timeout=10000)
    page.locator('#rec').click()
    page.wait_for_function("document.querySelector('#rec').textContent==='Stop recording'")
    page.locator('#magentaCapture').click()
    page.wait_for_function('magentaUnderTest.preparing',timeout=5000)
    page.wait_for_timeout(400)
    assert page.evaluate('engineUnderTest.originalMonitor.gain.value')>.99,'phrase preparation monitors original body music'
    page.evaluate('engineUnderTest.masterLevel(0)')
    page.wait_for_function('!magentaUnderTest.preparing',timeout=30000)
    page.wait_for_timeout(500)
    assert page.evaluate('engineUnderTest.master.gain.value')<.001,'phrase crossfade preserves master mute'
    assert page.evaluate('engineUnderTest.originalMonitor.gain.value')<.001
    page.evaluate('engineUnderTest.masterLevel(.5)')
    # A confirmed hip contact exercises the same action path as real body depth.
    page.wait_for_function('dragScene.scan.objects.some(o=>o.capture)')
    page.evaluate('''async()=>{
      const {frame}=await import('/test-fixtures/magenta.test.js'),m=magentaUnderTest,tick=m.tick.bind(m);
      window.bodyContact=false;window.bodyCaptures=0;window.originalMagentaTick=tick;
      const capture=m.capture.bind(m);m.capture=source=>{const accepted=capture(source);if(accepted&&source==='body-touch')bodyCaptures++;return accepted;};
      m.tick=()=>{const o=dragScene.scan.objects.find(o=>o.capture),point=bodyContact?o.position:dragScene.scan.objects[0].position;Object.assign(dragScene,frame(point,performance.now()));tick();};
    }''')
    page.wait_for_timeout(250)
    page.evaluate('window.bodyContact=true')
    page.wait_for_function('bodyCaptures===1',timeout=5000)
    page.wait_for_function('!magentaUnderTest.preparing',timeout=30000)
    page.wait_for_timeout(800)
    assert page.evaluate('bodyCaptures')==1,'holding contact after completion must not repeat capture'
    page.evaluate('window.bodyContact=false')
    page.wait_for_timeout(250)
    page.evaluate('window.bodyContact=true')
    page.wait_for_function('bodyCaptures===2',timeout=5000)
    page.wait_for_function('!magentaUnderTest.preparing',timeout=30000)
    page.evaluate('magentaUnderTest.tick=originalMagentaTick')
    page.wait_for_timeout(1500)
    page.screenshot(path=str(output/'magenta-preview.png'))
    with page.expect_download() as download:
        page.locator('#rec').click()
    download.value.save_as(output/'magenta-recording.zip')
    with zipfile.ZipFile(output/'magenta-recording.zip') as archive:
        manifest=json.loads(archive.read('manifest.json'))
        rows=[json.loads(line) for line in archive.read('observations.jsonl').splitlines()]
        assert manifest['schema_version']==1
        assert isinstance(manifest['final_analysis']['magenta_events'],list),'recording retains events pending after its final pose'
        assert any(c['settings']['scene'].get('magenta',{}).get('effective_model')=='small' for c in manifest['configurations'])
        assert any(e['type']=='capture-request' and e['source']=='button' for row in rows for e in (row.get('analysis') or {}).get('magenta_events',[]))
        assert any(e['type']=='capture-request' and e['source']=='body-touch' for row in rows for e in (row.get('analysis') or {}).get('magenta_events',[]))
        media=manifest['artifacts']['media']['path'];(output/Path(media).name).write_bytes(archive.read(media))
    previous_session=page.evaluate('magentaUnderTest.session')
    page.locator('#res').select_option('640x480')
    page.wait_for_function('(previous)=>magentaUnderTest.ready&&magentaUnderTest.session!==previous',arg=previous_session,timeout=150000)
    assert page.locator('#magentaPrompt0').input_value()=='soft warm piano','source restart preserves edited prompts'
    # Reject a deliberately invalid native command to exercise actual process
    # failure, Auto's Base -> Small transition, and the final original-only mix.
    page.locator('#magenta-model').select_option('auto')
    page.wait_for_function("magentaUnderTest.ready&&magentaUnderTest.effective==='base'",timeout=150000)
    page.evaluate("magentaUnderTest.send({type:'note',note:200,on:true})")
    page.wait_for_function("magentaUnderTest.ready&&magentaUnderTest.effective==='small'",timeout=150000)
    assert page.evaluate('magentaUnderTest.switched')
    page.evaluate("magentaUnderTest.send({type:'note',note:200,on:true})")
    page.wait_for_function("!magentaUnderTest.ready&&document.querySelector('#magentaStatus').textContent.includes('continuing original')",timeout=10000)
    page.wait_for_timeout(400)
    assert page.evaluate('engineUnderTest.originalMonitor.gain.value')>.99
    assert page.evaluate('engineUnderTest.magentaMonitor.gain.value')<.001
    page.locator('#go').click()
    page.wait_for_function("document.querySelector('#go').textContent==='Start'",timeout=15000)
    assert page.evaluate('!magentaUnderTest.active&&magentaUnderTest.ws===null')
    page.locator('#go').click()
    page.wait_for_function('window.magentaUnderTest?.active',timeout=10000)
    page.locator('#go').click()
    page.wait_for_function("document.querySelector('#go').textContent==='Start'",timeout=15000)
    print('PASS genuine native browser conditioning, mirrored label editing/persistence, bounded stalled-consumer recovery, no-feedback tap, all input/listening modes, tracking loss, button/body phrase capture with hold/release, crossfade/master mute, recording, source restart, actual helper failure/Auto fallback and repeated stop/cancel',flush=True)


def live_run(page, seconds, output, camera=False):
    install_hooks(page, False)
    page.locator('#sceneMode').select_option('magenta');page.locator('#magenta-model').select_option('auto')
    page.locator('#res').select_option('640x480');page.locator('#go').click()
    page.wait_for_function('window.magentaUnderTest?.ready',timeout=240000)
    page.evaluate('''()=>{
      const m=magentaUnderTest,receive=m.receive.bind(m);window.controlLatencies=[];window.nativeUnderruns=0;
      m.receive=e=>{if(m.ready&&performance.now()-m.readyAt>2000){
        if(e.type==='weights-applied')controlLatencies.push(performance.now()-e.timestamp);
        if(e.type==='underrun')nativeUnderruns++;
      }receive(e);};
    }''')
    page.evaluate('window.liveEvidence=[];window.liveEvidenceTimer=setInterval(()=>{const m=magentaUnderTest,c=sceneUnderTest;liveEvidence.push({t:performance.now(),baseline:m.baseline,fps:m.poses.length/2,model:m.effective,ready:m.ready,depth:c.depthLatency,depthFresh:!!c.latest&&performance.now()-c.latest.timestamp<200,placements:c.scan.objects.length,tracking:!m.lost,maskForeground:c.person?.data.reduce((n,p)=>n+(p>.5),0)||0,playbackUnderruns:m.playbackUnderruns,referenceLatency:m.referenceLatency});},1000)')
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        page.wait_for_timeout(min(10000,max(1,int((end-time.monotonic())*1000))))
        print('LIVE',page.evaluate('liveEvidence.at(-1)'),flush=True)
    samples=page.evaluate('clearInterval(liveEvidenceTimer);liveEvidence')
    result={'seconds':seconds,'physical_camera':camera,'samples':samples,'configuration':page.evaluate('magentaUnderTest.configuration()'),
            'control_latencies_ms':page.evaluate('controlLatencies'),'native_underruns':page.evaluate('nativeUnderruns')}
    (output/'live-results.json').write_text(json.dumps(result,indent=2))
    page.screenshot(path=str(output/'magenta-live.png'))
    page.locator('#go').click();page.wait_for_function("document.querySelector('#go').textContent==='Start'",timeout=15000)
    assert all(s['ready'] for s in samples[-10:]),'Magenta did not remain available'
    stable=[s for s in samples if s['ready'] and s['baseline']>0]
    assert sum(s['fps'] for s in stable)/len(stable)>=.85*stable[-1]['baseline'],'Pose throughput under 85%'
    assert stable[-1]['playbackUnderruns']-stable[min(10,len(stable)-1)]['playbackUnderruns']<=2,'Sustained audio underruns'
    assert result['native_underruns']<=2,'Sustained native audio underruns'
    if camera:
        assert any(s['maskForeground']>0 and s['tracking'] for s in samples),'No actual person detected'
        assert any(s['referenceLatency'] for s in samples),'No body-audio reference completed'
        assert result['control_latencies_ms'] and max(result['control_latencies_ms'])<500,'Weight application exceeded 500 ms'
    print('PASS sustained native generation and pose throughput',flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--live-seconds',type=int,default=0);parser.add_argument('--camera',action='store_true')
    parser.add_argument('--origin', help='Test an already-running packaged app, e.g. http://127.0.0.1:5092')
    args=parser.parse_args()
    output=ROOT/'output/magenta-browser';output.mkdir(parents=True,exist_ok=True)
    server=None
    if args.origin:origin=args.origin.rstrip('/')
    else:
        with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
        with (output/'server.log').open('w') as log:server=subprocess.Popen([sys.executable,str(ROOT/'live.py'),'--no-browser','--port',str(port)],cwd=ROOT,stdout=log,stderr=log)
        origin=f'http://127.0.0.1:{port}'
    try:
        with sync_playwright() as p:
            options=['--autoplay-policy=no-user-gesture-required','--enable-unsafe-webgpu']
            if not args.camera:options+=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']
            browser=p.chromium.launch(channel='chrome',headless=True,args=options)
            context=browser.new_context(permissions=['camera'],accept_downloads=True,viewport={'width':1280,'height':900})
            page=context.new_page();errors=[]
            def page_error(error):
                errors.append(str(error));print('BROWSER ERROR',str(error),flush=True)
            page.on('pageerror',page_error)
            page.on('console',lambda message: print('BROWSER CONSOLE',message.text,flush=True) if message.type=='error' else None)
            def route(r):
                url=r.request.url
                if not url.startswith(origin+'/'):return r.abort()
                if '/test-fixtures/' in url:
                    name=url.rsplit('/',1)[-1];text=(ROOT/'tests'/name).read_text().replace("'../web/live/","'/live/").replace("'./scene-drag.test.js'","'/test-fixtures/scene-drag.test.js'")
                    return r.fulfill(body=text,content_type='text/javascript')
                if not args.live_seconds and url.endswith('vision_bundle.mjs'):return r.fulfill(body=(ROOT/'tests/vision-fixture.js').read_text(),content_type='text/javascript')
                return r.continue_()
            page.route('**/*',route)
            for attempt in range(100):
                try:page.goto(origin+'/live/');break
                except Exception:
                    if attempt==99:raise
                    time.sleep(.1)
            passed=page.evaluate("async()=>{const m=await import('/test-fixtures/magenta.test.js');return m.runMagentaTests();}")
            assert not errors,errors
            page.wait_for_function("document.body.dataset.ready==='true'",timeout=45000)
            print('PASS',*passed,flush=True)
            print('PASS',page.evaluate("async()=>{const m=await import('/test-fixtures/magenta-worklet.test.js');return m.runWorkletTests();}"),flush=True)
            open_live_sections(page)
            if args.live_seconds:live_run(page,args.live_seconds,output,args.camera)
            else:integration(page,output)
            assert not errors,errors
            browser.close()
    finally:
        if server:
            server.terminate()
            try:server.wait(timeout=5)
            except subprocess.TimeoutExpired:server.kill();server.wait()


if __name__=='__main__':main()

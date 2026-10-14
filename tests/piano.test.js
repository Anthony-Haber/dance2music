import {pianoScan,orientPiano,pianoFits,pianoKeyPixels,pianoPoint,pianoKeyAt,pianoFloorDepth,PIANO_KEYS} from '../web/live/scene/piano-layout.js';
import {PianoInteractions,pianoPose} from '../web/live/scene/piano-touch.js';
import {project,reconstruct,exclusion,alignDepth} from '../web/live/scene/geometry.js';
import {compositingDepth} from '../web/live/scene/occlusion.js';
import {fixture as floorFixture} from './scene.test.js';
import {SurfaceDrag,pointerInView} from '../web/live/scene/drag.js';
import {SceneRenderer} from '../web/live/scene/renderer.js';
import {SceneController} from '../web/live/scene/controller.js';
import {dragFixture} from './scene-drag.test.js';
import {Engine} from '../web/live/audio.js';
import {PianoPlayer,loadPiano,samplePitch} from '../web/live/piano.js';
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function audioWait(ctx,ms){
  const target=ctx.currentTime+ms/1000,deadline=performance.now()+15000;
  while(ctx.currentTime<target){if(performance.now()>deadline)throw new Error('Audio clock did not advance');await wait(20);}
}
export const keyboard=()=>({id:'floor-piano',shape:'keyboard',size:2,surface:0,normal:[0,1,0],support:[0,-1,-3],position:[0,-1,-3],keys:PIANO_KEYS,black_keys_near_camera:true});
export function footFrame(t,feet,object=keyboard()) {
  const width=160,height=120,mask=new Float32Array(width*height),inverse=new Float32Array(width*height).fill(.1),points=[];
  feet.forEach(([x,z,up=0],i)=>{
    const p=pianoPoint(object,x,z,up),[px,py]=project(p,width,height);
    points.push({foot:i?'right':'left',joint:i?32:31,part:i?'right foot':'left foot',x:(px+.5)/width,y:(py+.5)/height});
    for(let y=Math.max(0,Math.round(py)-3);y<=Math.min(height-1,Math.round(py)+3);y++)for(let x=Math.max(0,Math.round(px)-3);x<=Math.min(width-1,Math.round(px)+3);x++){
      mask[y*width+x]=1;inverse[y*width+x]=1/-p[2];
    }
  });
  return {pose:{timestamp:t,points},depth:{width,height,timestamp:t,aligned:true,inverse,person:{width,height,data:mask}}};
}
export async function runPianoGeometry() {
  const frame=floorFixture({person:true}),old=reconstruct([frame,frame,frame]),expanded=reconstruct([frame,frame,frame],{floorPiano:true}),excluded=exclusion(frame);
  const area=s=>s.surfaces.filter(s=>s.kind==='floor').reduce((sum,s)=>sum+s.runs.reduce((a,[,n])=>a+n,0),0);
  assert(area(expanded)>area(old),'floor scan preserves more usable interior for a large keyboard');
  for(const surface of expanded.surfaces.filter(s=>s.kind==='floor'))for(const [start,n] of surface.runs)for(let i=start;i<start+n;i++)assert(frame.labels[i]===3&&!excluded[i],'larger floor interiors still exclude tables, holes and people');
  const fixture=dragFixture(),start=performance.now(),scan=pianoScan(fixture),o=scan.objects[0];
  assert(o&&o.shape==='keyboard'&&o.id==='floor-piano','one complete assembly on floor, independent of generic placements');
  assert(pianoKeyPixels(o,160,120)>=12,'every white key is at least 12 preview pixels');
  assert(JSON.stringify(pianoScan({...fixture,objects:[]}).objects)===JSON.stringify(scan.objects),'placement does not use generic objects');
  assert(!pianoScan({...fixture,surfaces:fixture.surfaces.filter(s=>s.kind==='table')}).objects.length,'tabletops never receive keyboard');
  const narrow={...fixture,surfaces:[{...fixture.surfaces[0],runs:Array.from({length:30},(_,y)=>[(y+80)*160+75,8])}]};
  assert(!pianoScan(narrow).objects.length,'narrow floor rejected');
  const fragmented={...fixture,surfaces:[{...fixture.surfaces[0],runs:Array.from({length:45},(_,y)=>Array.from({length:12},(_,x)=>[(y+70)*160+8+x*12,5])).flat()}]};
  assert(!pianoScan(fragmented).objects.length,'fragmented stripes cannot fit rectangle');
  const mask=new Uint8Array(160*120);for(const [s,n] of fixture.surfaces[0].runs)mask.fill(1,s,s+n);
  assert(pianoFits(o,mask,160,120),'complete rectangle fits exact interior');
  const p=project(pianoPoint(o,.15,.03),160,120).map(Math.round);mask[p[1]*160+p[0]]=0;
  assert(!pianoFits(o,mask,160,120),'interior hole/person exclusion rejects footprint');
  assert(PIANO_KEYS.filter(k=>k.black).map(k=>k.midi).join()==='61,63,66,68,70'&&PIANO_KEYS.filter(k=>!k.black).length===8,'standard black/white layout');
  const whiteDepth=PIANO_KEYS.find(k=>!k.black).depth;
  for(const key of PIANO_KEYS.filter(k=>k.black)){
    assert(key.z-key.depth/2>=whiteDepth*.15,'at least 65% of white-key length is clear of black keys');
    for(let z=-whiteDepth/2;z<=whiteDepth*.1;z+=.01)assert(!pianoKeyAt(key.x,z)?.black,'long white fronts never resolve to an overlapping black key');
  }
  for(const key of PIANO_KEYS){const z=key.black?key.z:.06;assert(pianoKeyAt(key.x,z)?.midi===key.midi,'all 13 key regions select fixed MIDI');}
  const whiteKeys=PIANO_KEYS.filter(k=>!k.black);
  for(const mirrored of [false,true]){
    const order=[...whiteKeys].sort((a,b)=>project(pianoPoint(o,a.x,.06),640,480,mirrored)[0]-project(pianoPoint(o,b.x,.06),640,480,mirrored)[0]).map(k=>k.midi);
    assert(order.join()===(mirrored?'60,62,64,65,67,69,71,72':'72,71,69,67,65,64,62,60'),'low notes appear on the left in the mirrored player view, with fixed physical identities');
  }
  const drag=new SurfaceDrag(scan,o,pianoPoint(o,0,.04,.01)),target=drag.target(.99,.8);
  assert(target&&target.surface===0&&target.size===o.size&&target.keys===o.keys,'nearest valid rectangular drag preserves layout and size on floor');
  assert(pianoKeyPixels(target,160,120)>=12,'drag cannot make keys too narrow');
  const pt=project(pianoPoint(o,-.4,.06),640,480,true),input=pointerInView(pt[0]+.5,pt[1]+.5,{left:0,top:0,width:640,height:480},true);
  const orig=project(pianoPoint(o,-.4,.06),640,480);assert(Math.abs(input.x-(orig[0]+.5)/640)<1e-8,'mirror changes presentation coordinates only');
  const T=await import('../web/live/vendor/scene/three/three.module.js'),r=new SceneRenderer(T);
  try{
    r.setScan(scan);r.setDepth(new Float32Array(160*120).fill(.1),160,120);r.setMirror(true);
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const g=canvas.getContext('2d');
    g.drawImage(r.render(640,480,[true],1000,[{key_id:'piano-60',active:true}]),0,0);
    assert(g.getImageData(0,0,640,480).data.some((v,i)=>i%4===3&&v),'keyboard actually renders');
    assert(r.meshes.filter(m=>m.userData.pianoKey).length===13,'individual key meshes');
    assert(r.meshes.find(m=>m.userData.pianoKey?.midi===60).material.emissiveIntensity>.5,'pressed highlight');
    assert(r.meshes.filter(m=>m.userData.pianoLabel).every(m=>m.material.map.repeat.x===-1),'labels counter-mirror');
    for(const mesh of r.meshes.filter(m=>m.userData.pianoKey)){
      const key=mesh.userData.pianoKey,label=r.meshes.find(m=>m.userData.pianoLabel?.id===key.id);
      assert(mesh.position.x===key.x*o.size&&label.position.x===mesh.position.x,'reflected key meshes, readable labels and contact regions share note positions');
    }
    // Save a normal presentation (labels counter-mirrored, then whole preview mirrored).
    const preview=document.createElement('canvas');preview.width=640;preview.height=480;const pg=preview.getContext('2d');pg.fillStyle='#24313b';pg.fillRect(0,0,640,480);pg.translate(640,0);pg.scale(-1,1);pg.drawImage(canvas,0,0);window.pianoPreview=preview.toDataURL();
    r.setDepth(new Float32Array(160*120).fill(10),160,120);g.clearRect(0,0,640,480);g.drawImage(r.render(640,480,[true]),0,0);
    assert(!g.getImageData(0,0,640,480).data.some((v,i)=>i%4===3&&v),'person occlusion includes keys and labels');
  }finally{r.dispose();}
  return [`floor-only full keyboard, holes, fragmented/narrow floor, 13 regions, rectangular dragging, mirror/labels and GPU occlusion (${Math.round(performance.now()-start)} ms)`];
}
export async function runPianoOrientation() {
  const fixture=dragFixture(),scan=pianoScan(fixture),original=scan.objects[0];
  const T=await import('../web/live/vendor/scene/three/three.module.js'),r=new SceneRenderer(T);
  try{
    for(const near of [true,false]){
      const layout=orientPiano(scan,near),o=layout.objects[0],direction=near?1:-1;
      assert(o.size===original.size&&o.support===original.support&&o.surface===original.surface,'flipping preserves complete floor placement');
      r.setScan(layout);r.setMirror(true);
      const contact=new PianoInteractions();
      for(const key of o.keys){
        const old=original.keys.find(k=>k.id===key.id),z=key.black?key.z:-direction*.08;
        assert(key.x===old.x&&key.midi===old.midi&&key.width===old.width&&key.depth===old.depth,'flip preserves pitch, horizontal order and key size');
        if(key.black){
          assert(direction*(pianoPoint(o,key.x,key.z)[2]-o.support[2])>0,'black keys face the chosen camera edge');
          assert(!pianoKeyAt(key.x,-direction*.08,null,o.keys)?.black,'opposite white-key end stays clear at every black-key position');
        }
        const mesh=r.meshes.find(m=>m.userData.pianoKey?.id===key.id),label=r.meshes.find(m=>m.userData.pianoLabel?.id===key.id);
        assert(mesh.position.z===key.z*o.size&&label.material.map.repeat.x===-1,'rendered key and readable label follow the oriented layout');
        assert(key.black?label.position.z===key.z*o.size:direction*label.position.z<0,'white labels move to the clear end');
        contact.reset();
        for(const t of [1000,1025]){
          const f=footFrame(t,[[key.x,z]],o),events=contact.update([o],f.depth,f.pose,f.pose,t);
          assert(t===1000?!events.length:events[0]?.midi===key.midi,`${near?'near':'far'} edge plays ${key.label} at its displayed location`);
        }
      }
      const drag=new SurfaceDrag(layout,o,pianoPoint(o,0,0)),target=drag.target(.99,.8);
      assert(target.keys===o.keys&&target.black_keys_near_camera===near,'drag retains selected orientation');
    }
  }finally{r.dispose();}
  const events=[],c=new SceneController({onPianoEvent:e=>events.push(e)});
  try{
    c.setMode('floor-piano');c.scan=scan;c.snapshot={...scan};c.state='active';c.source='orientation';c.rateTimes=[];
    c.renderer={setScan(){},clearTouch(){},moveObject(){},dispose(){}};c.worker={terminate(){}};
    const saved=c.configuration(),t=performance.now();
    for(const time of [t-30,t]){const f=footFrame(time,[[.4375,-.08]],original);c.publishTouches(c.interactions.update([original],f.depth,f.pose,f.pose,time));c.currentTouchPose=f.pose;}
    assert(c.interactions.owners.size===1,'orientation fixture holds a note');
    c.setPianoNearCamera(false);
    assert(events.at(-1)?.type==='piano-note-off'&&events.at(-1).reason==='piano-orientation','live flip releases held notes');
    assert(!c.currentTouchPose&&!c.interactions.depth&&!c.interactions.owners.size,'live flip clears old pose, depth and foot ownership');
    assert(saved.scan.objects[0].black_keys_near_camera&&saved.black_keys_near_camera,'previous recording snapshots remain unchanged');
    assert(!c.configuration().black_keys_near_camera&&!c.snapshot.piano.black_keys_near_camera,'current recording snapshot describes flipped keys');
    const fresh=footFrame(performance.now(),[[.4375,.08]],c.scan.objects[0]);
    assert(!c.interactions.observe(c.scan.objects,fresh.pose,fresh.pose.timestamp).length,'old depth cannot attack after a flip');
    assert(!c.interactions.update(c.scan.objects,fresh.depth,fresh.pose,fresh.pose,fresh.pose.timestamp).length,'new contact requires confirmation after flip');
    c.pick=()=>({id:'floor-piano',point:pianoPoint(original,0,0)});c.beginDrag(.5,.7);c.setPianoNearCamera(true);
    assert(!c.drag&&c.scan.objects[0].black_keys_near_camera,'flipping during a drag cancels it and retains the new orientation');
    c.setPianoNearCamera(false);c.rescan();
    for(let n=0;n<3;n++)await c.receive({type:'result',source:c.source,generation:c.generation,timestamp:performance.now(),scanResult:fixture});
    assert(c.state==='active'&&!c.scan.objects[0].black_keys_near_camera&&c.scan.objects[0].keys.filter(k=>k.black).every(k=>k.z<0),'rescan rebuilds the selected orientation');
  }finally{c.dispose();}
  return ['near-camera default and far-edge option: all 13 rendered/contact regions, white labels, fixed placement/order, dragging, held-note release, fresh contact, immutable recording snapshots and rescan'];
}
export async function runPianoContact() {
  const c=new PianoInteractions(),o=keyboard();
  const step=(t,feet)=>{const f=footFrame(t,feet,o);return c.update([o],f.depth,f.pose,f.pose,t);};
  for(const key of PIANO_KEYS){
    c.reset();const feet=[[key.x,key.black?key.z:.06]];
    assert(!step(1000,feet).length,'confirmation requires 25 ms');
    assert(step(1025,feet)[0]?.midi===key.midi,`foot selects ${key.label}`);
    for(let t=1050;t<1600;t+=50)assert(!step(t,feet).length,'held contact never repeats');
    assert(!step(1610,[]).length,'release debounced');assert(step(1720,[])[0]?.type==='piano-note-off','step off releases');
    step(1750,feet);assert(step(1780,feet)[0]?.type==='piano-note-on','release/re-entry replays');
  }
  c.reset();step(2000,[[-.4375,.06],[.4375,.06]]);assert(step(2025,[[-.4375,.06],[.4375,.06]]).length===2,'two-foot chord');
  c.reset();step(2100,[[-.4375,.06],[-.4375,.06]]);let ev=step(2125,[[-.4375,.06],[-.4375,.06]]);
  assert(ev.length===1&&ev[0].foot_ids.length===2,'shared key strikes only once');
  step(2200,[[-.4375,.06]]);ev=step(2300,[[-.4375,.06]]);assert(ev.length===1&&ev[0].type==='piano-ownership'&&ev[0].foot_ids.length===1,'one foot leaving keeps shared note held');
  step(2320,[]);assert(step(2430,[])[0]?.type==='piano-note-off','last owner releases');
  c.reset();step(3000,[[-.4375,.06]]);step(3025,[[-.4375,.06]]);step(3050,[[-.3125,.06]]);ev=step(3075,[[-.3125,.06]]);
  assert(ev.some(e=>e.type==='piano-note-off'&&e.midi===72)&&ev.some(e=>e.type==='piano-note-on'&&e.midi===71),'moving feet release old key and strike new');
  c.reset();step(4000,[[-.376,.06]]);step(4025,[[-.376,.06]]);
  for(let i=0;i<12;i++)assert(!step(4050+i*30,[[-.375+(i%2?.003:-.003),.06]]).length,'boundary hysteresis prevents chatter');
  c.reset();assert(!step(5000,[[-.4375,.06,.2]]).length&&!step(5050,[[-.4375,.06,.2]]).length,'lifted feet rejected');
  const lms=Array.from({length:33},()=>({x:.5,y:.7,visibility:0,presence:1}));lms[15].visibility=1;lms[25].visibility=1;
  assert(!pianoPose(lms,0).points.length,'hands/knees ignored');lms[29].visibility=1;assert(pianoPose(lms,0).points[0].joint===29,'heel fallback');lms[31].visibility=1;assert(pianoPose(lms,0).points[0].joint===31,'confident toe preferred');
  c.reset();step(6000,[[-.4375,.06]]);step(6025,[[-.4375,.06]]);
  assert(c.watchdog({timestamp:6025,points:[]},6146)[0]?.type==='piano-note-off','watchdog releases with no pose callbacks');
  c.reset();step(7000,[[-.4375,.06]]);step(7025,[[-.4375,.06]]);
  assert(c.watchdog({timestamp:7226,points:[]},7226)[0]?.type==='piano-note-off','depth expiry releases despite fresh pose');
  c.reset();const f=footFrame(8000,[[-.4375,.06]]);f.depth.person.data.fill(0);c.update([o],f.depth,f.pose,f.pose,8000);assert(!c.observe([o],{...f.pose,timestamp:8050},8050).length,'foreground depth required');
  return ['all 13 foot notes, toe/heel confidence, two feet/shared ownership, hold/re-entry/transfer, boundary hysteresis, lifted feet/hands, foreground and stale cleanup'];
}
export async function runPianoJump() {
  const c=new PianoInteractions(),o=keyboard();
  const step=(t,feet)=>{const f=footFrame(t,feet,o);return c.update([o],f.depth,f.pose,f.pose,t);};
  for(const key of PIANO_KEYS){
    c.reset();const z=key.black?key.z:.06,ground=[[key.x,z]],air=[[key.x,z,.03]];
    step(1000,ground);step(1025,ground);
    assert(!step(1050,air).length,'one raised frame cannot retrigger');
    const off=step(1080,air);
    assert(off.length===1&&off[0].type==='piano-note-off'&&off[0].reason==='lift-off',`${key.label} lifts inside the normal floor tolerance and before 120 ms`);
    assert(!step(1100,air).length,'hovering inside the broad floor tolerance cannot replay');
    step(1120,ground);const on=step(1150,ground);
    assert(on.length===1&&on[0].type==='piano-note-on'&&on[0].reason==='landing'&&on[0].midi===key.midi,`${key.label} replays on landing at the same position`);
    assert(!step(1180,ground).length,'landing attacks only once');
  }
  c.reset();const ground=[[-.4375,.06]],air=[[-.4375,.06,.03]];
  step(2000,ground);step(2025,ground);
  for(let i=0;i<12;i++)assert(!step(2050+i*30,[[-.4375,.06,i%2?.018:.005]]).length,'small height jitter does not lift');
  assert(!step(2420,[[-.4375,.06,.04]]).length&&!step(2450,ground).length,'a single high outlier does not lift');
  assert(!step(2480,[]).length&&!step(2510,ground).length,'a brief missing foot keeps ordinary release debounce');
  const fallback=footFrame(2540,[[-.4375,.06,.035]]);fallback.pose.points[0].joint=29;
  assert(!c.update([o],fallback.depth,fallback.pose,fallback.pose,2540).length&&!step(2570,ground).length,'toe/heel baseline changes do not create a jump');
  // Depth can wobble while the image-space foot is planted. Both signals are
  // required for lift confirmation, including when height remains admissible.
  c.reset();step(3000,[[-.4375,-.1]]);step(3025,[[-.4375,-.1]]);
  for(const t of [3050,3080,3110]){
    const f=footFrame(t,[[-.4375,-.1]]);f.depth.inverse=f.depth.inverse.map(v=>v/.93);
    assert(!c.update([o],f.depth,f.pose,f.pose,t).length&&!c.states.get('left').airborne,'depth drift alone cannot lift a still foot');
  }
  c.reset();step(4000,ground);step(4025,ground);step(4050,air);step(4080,air);
  for(const t of [4100,4130])assert(!c.observe([o],footFrame(t,ground).pose,t).length,'landing pose cannot reuse airborne depth');
  step(4150,ground);assert(step(4180,ground)[0]?.reason==='landing','fresh post-takeoff depth enables landing');
  c.reset();const chord=[[-.4375,.06],[.4375,.06]],jump=chord.map(([x,z])=>[x,z,.03]);
  step(5000,chord);step(5025,chord);
  for(let n=0;n<3;n++){
    const t=5050+n*120;step(t,jump);const off=step(t+30,jump);step(t+60,chord);const on=step(t+90,chord);
    assert(off.length===2&&off.every(e=>e.type==='piano-note-off')&&on.length===2&&on.every(e=>e.type==='piano-note-on'&&e.reason==='landing'),'repeated two-foot jumps replay both notes once per landing');
  }
  c.reset();const shared=[[-.4375,.06],[-.4375,.06]],oneRaised=[[-.4375,.06,.03],[-.4375,.06]];
  step(6000,shared);step(6025,shared);step(6050,oneRaised);
  assert(step(6080,oneRaised)[0]?.type==='piano-ownership','one jumping foot cannot release a shared key held by the other');
  step(6110,shared);assert(step(6140,shared)[0]?.type==='piano-ownership','shared-key landing does not duplicate its attack');
  step(6170,shared.map(([x,z])=>[x,z,.03]));assert(step(6200,shared.map(([x,z])=>[x,z,.03]))[0]?.type==='piano-note-off','both feet lifting release the shared note');
  step(6230,shared);const together=step(6260,shared);assert(together.length===1&&together[0].type==='piano-note-on','both feet landing together attack a shared key once');
  c.reset();step(7000,ground);step(7025,ground);step(7050,air);step(7080,air);
  assert(!c.watchdog({timestamp:7281,points:[]},7281).length&&!c.owners.size&&!c.states.size,'stale input clears airborne state without a phantom landing');
  return ['all 13 same-key hops, fast lift/landing confirmation, no airborne repeat, height jitter/outlier/fallback guards, fresh landing depth, repeated two-foot chords and shared-key ownership'];
}
export async function runPianoVisibility() {
  const reference=floorFixture(),brighter={...reference,rgb:Uint8Array.from(reference.rgb,x=>Math.min(255,x+45))};
  const aligned=alignDepth(brighter,reference,true);
  assert(aligned&&aligned.changed_fraction<.01&&Math.abs(aligned.scale-1)<1e-5,'camera exposure changes do not invalidate unchanged floor depth');
  const moved={...reference,rgb:Uint8Array.from(reference.rgb,(_,i)=>i%4<2?0:255)};
  const invalid=alignDepth(moved,reference,true);assert(!invalid||invalid.changed_fraction>.16,'real background changes remain invalid');
  const width=160,height=120,floor=pianoFloorDepth(keyboard(),width,height),inverse=Float32Array.from(floor,x=>x?x*1.06:.1);
  const latest={width,height,timestamp:1000,aligned:true,inverse,rgb:new Uint8Array(width*height).fill(80)},pixels=new Uint8ClampedArray(width*height*4).fill(130);
  const before=inverse.slice(),out=compositingDepth(latest,null,pixels,1050,undefined,floor);
  const inside=[...floor.keys()].filter(i=>floor[i]);assert(inside.length>10,'floor plane covers the projected keyboard');
  assert(inside.every(i=>out[i]===floor[i]),'floor noise and exposure do not clip the keyboard');
  assert(before.every((v,i)=>v===inverse[i]),'display stabilization never alters raw foot depth');
  const person={timestamp:1050,width,height,data:new Float32Array(width*height)};
  const centre=inside[Math.floor(inside.length/2)];person.data[centre]=1;latest.person=person;inverse[centre]=floor[centre]*2;
  const foreground=compositingDepth(latest,person,pixels,1050,undefined,floor);
  assert(foreground[centre]===inverse[centre],'confident foreground person still occludes the keyboard');
  person.data.fill(0);const obstacle=compositingDepth(latest,person,pixels,1050,undefined,floor);
  assert(obstacle[centre]===inverse[centre],'closer objects are not flattened into the floor');
  const c=new SceneController();try{c.setMode('floor-piano');c.scan={objects:[keyboard()]};c.latest=latest;
    assert(c.visible(1200)[0]&&!c.visible(1201)[0],'200 ms stale-depth suppression remains intact');
  }finally{c.dispose();}
  return ['floor-plane display stabilization, exposure compensation, person/obstacle occlusion, unchanged raw contact depth and 200 ms stale suppression'];
}
export async function runPianoAudio() {
  const e=new Engine();e.ctx=new AudioContext();await e.ctx.resume();await e.start();e.limiter.disconnect(e.ctx.destination);
  const p=new PianoPlayer(e),epoch={session:1,generation:2,source:'test'};
  const event=(midi,on=true)=>({type:on?'piano-note-on':'piano-note-off',key_id:`piano-${midi}`,midi,foot_ids:on?['left']:[],previous_foot_ids:on?[]:['left'],timestamp_ms:performance.now(),...epoch});
  try{
    await p.load();assert(p.buffers.size===5&&p.provenance.revision.length===40,'five verified real sample roots decoded with provenance');
    const before=Object.fromEntries(Object.entries(e.layers).map(([k,v])=>[k,v.gain.value]));
    p.setListening('piano-only');await audioWait(e.ctx,130);assert(e.movement.gain.value===0,'piano-only silences body gate');
    p.setListening('piano-body');await audioWait(e.ctx,130);assert(e.movement.gain.value===1,'body music restored');
    assert(Object.entries(before).every(([k,v])=>e.layers[k].gain.value===v),'Listening preserves mixer faders');
    p.setListening('piano-only');
    const chunks=[],rec=new MediaRecorder(e.recordStream());rec.ondataavailable=ev=>{if(ev.data.size)chunks.push(ev.data);};const done=new Promise(resolve=>rec.onstop=resolve);rec.start();
    for(let midi=60;midi<=72;midi++){
      const result=p.event(event(midi),epoch),voice=p.held.get(`piano-${midi}`),pitch=samplePitch(midi);
      assert(result.sound.root_midi===pitch.root&&Math.abs(voice.source.playbackRate.value-pitch.rate)<1e-6&&!voice.source.loop,`sample pitch ${midi}`);
      assert(!p.event(event(midi),epoch),'held duplicate ignored');await audioWait(e.ctx,60);p.event(event(midi,false),epoch);
    }
    await audioWait(e.ctx,200);assert(!p.held.size&&!p.voices.size,'150 ms damping disposes released sources');
    rec.stop();await done;const audio=await e.ctx.decodeAudioData(await new Blob(chunks,{type:rec.mimeType}).arrayBuffer());
    assert(audio.getChannelData(0).some(x=>Math.abs(x)>.01),'sampled piano reaches actual encoded recording mix');
    assert(!p.event({...event(60),generation:1},epoch)&&!p.event({...event(60),session:0},epoch),'old scans/sessions rejected');
    p.event(event(60),epoch);p.held.get('piano-60').finish();assert(p.held.has('piano-60')&&!p.event(event(60),epoch),'naturally finished held sample never restarts');p.event(event(60,false),epoch);
    for(let i=0;i<100;i++){p.event(event(60),epoch);p.event(event(60,false),epoch);}assert(p.voices.size<=8,'rapid steps bound release tails');
    // Give the 30 ms target fade ten time constants with an active source;
    // Chrome may defer processing a gain node while it has no live inputs.
    await audioWait(e.ctx,200);e.wet.gain.value=0;e.level('objects',0);await audioWait(e.ctx,150);p.event(event(72),epoch);await audioWait(e.ctx,300);assert(e.peak()<.001,`Objects fader mutes piano (peak ${e.peak()}, gain ${e.layers.objects.gain.value}, voices ${p.voices.size})`);p.event(event(72,false),epoch);
    e.level('objects',.8);e.masterLevel(0);await audioWait(e.ctx,200);p.event(event(69),epoch);await audioWait(e.ctx,120);assert(e.peak()<.001,'master mute includes piano');p.event(event(69,false),epoch);
    // Same-origin errors never fall through to synthesized or remote audio.
    const original=globalThis.fetch;
    try{
      for(const kind of ['missing','corrupt','decode']){
        globalThis.fetch=async (url,opts)=>String(url).endsWith('C4.mp3')?(kind==='missing'?new Response('',{status:404}):kind==='corrupt'?new Response('bad'):original(url,opts)):original(url,opts);
        let error;try{await loadPiano(kind==='decode'?{decodeAudioData:()=>Promise.reject(new Error('decode failed'))}:e.ctx);}catch(e){error=e;}
        assert(error?.message.includes('--offline --without-magenta'),`${kind} samples produce preparation error`);
      }
    }finally{globalThis.fetch=original;}
  }finally{p.dispose();await e.stop();}
  return ['real local sample decode/playback at 13 pitches, damping, natural completion, bounded voices, both Listening modes, unchanged faders, stale epochs, master/Objects mute and encoded audio; missing/corrupt/undecodable errors'];
}
export async function runPianoLifecycle() {
  const events=[],c=new SceneController({onPianoEvent:e=>events.push(e)});c.setMode('floor-piano');
  const prepare=()=>{
    c.scan={...dragFixture(),objects:[keyboard()]};c.worker={terminate(){}};c.renderer={setScan(){},setTouchEnabled(){},dispose(){},clearTouch(){},moveObject(){}};c.source='lifecycle';c.state='active';
    const t=performance.now(),f=footFrame(t-30,[[-.4375,.06]]),f2=footFrame(t,[[-.4375,.06]]);
    c.publishTouches(c.interactions.update(c.scan.objects,f.depth,f.pose,f.pose,t-30));c.publishTouches(c.interactions.update(c.scan.objects,f2.depth,f2.pose,f2.pose,t));
    c.currentTouchPose=f2.pose;assert(c.interactions.owners.size===1,'lifecycle fixture holds a note');events.length=0;
  };
  try{
    for(const action of ['stop','rescan','visibility','failure','drag']){
      prepare();
      if(action==='stop')c.stop();else if(action==='rescan')c.rescan();else if(action==='visibility')c.visibility();else if(action==='failure')c.fail('fixture');
      else{
        c.pick=()=>({id:'floor-piano',point:pianoPoint(keyboard(),0,.04)});c.beginDrag(.5,.7);assert(!c.currentTouchPose,'drag clears contact pose');
        const staleFrame=footFrame(performance.now()-1,[[-.4375,.06]]);
        c.publishTouches(c.interactions.update(c.touchObjects(),staleFrame.depth,staleFrame.pose,staleFrame.pose,performance.now()));
        assert(!c.interactions.owners.size,'dragged keyboard cannot play');c.endDrag();
        assert(!c.currentTouchPose&&!c.interactions.depth&&c.contactAfter>staleFrame.depth.timestamp,'drop discards pre-drag contact and depth');
        const freshFrame=footFrame(performance.now(),[[-.4375,.06]]);
        assert(!c.interactions.update(c.touchObjects(),freshFrame.depth,freshFrame.pose,freshFrame.pose,performance.now()).length,'fresh contact must confirm again after drop');
      }
      assert(events.some(e=>e.type==='piano-note-off'),action+' releases held notes immediately');c.stop();
    }
    // Exercise the controller's actual timer installed by start, while the mock
    // worker never sends poses or results. No animation-frame callback needed.
    c.workerFactory=()=>({postMessage(){},terminate(){}});c.tick=()=>{};c.render=()=>{};
    const pending=c.start({readyState:0},'timer','floor-piano');prepare();const now=performance.now();
    c.currentTouchPose.timestamp=now-121;await wait(60);assert(events.some(e=>e.type==='piano-note-off'&&e.reason==='stale-input'),'independent watchdog timer releases');c.stop();await pending;
  }finally{c.dispose();}
  return ['Stop, rescan, visibility, failure, dragging and independent watchdog release notes before reset'];
}

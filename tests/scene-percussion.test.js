import {SCENE_MODES,INSTRUMENTS,sceneMode,instrumentScan,buildInstrument} from '../web/live/scene/instruments.js';
import {BodyInteractions,touchPose,instrumentDistance} from '../web/live/scene/touch.js';
import {SceneRenderer} from '../web/live/scene/renderer.js';
import {SceneController} from '../web/live/scene/controller.js';
import {project,basis} from '../web/live/scene/geometry.js';
import {SurfaceDrag} from '../web/live/scene/drag.js';
import {dragFixture} from './scene-drag.test.js';
import {Engine} from '../web/live/audio.js';
import {percussionVoice} from '../web/live/percussion.js';
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const object=(instrument='snare')=>({id:0,shape:'cube',size:1,support:[0,-.5,-3],position:[0,0,-3],normal:[0,1,0],instrument});
function frame(t,point=[0,.16,-3],part='body',z=-point[2]) {
  const w=160,h=120,[x,y]=project(point,w,h),mask=new Float32Array(w*h),inverse=new Float32Array(w*h).fill(.1);
  for(let yy=Math.max(0,Math.round(y)-2);yy<=Math.min(h-1,Math.round(y)+2);yy++)for(let xx=Math.max(0,Math.round(x)-2);xx<=Math.min(w-1,Math.round(x)+2);xx++){
    mask[yy*w+xx]=1;inverse[yy*w+xx]=1/z;
  }
  return {depth:{width:w,height:h,timestamp:t,aligned:true,inverse,person:{width:w,height:h,data:mask}},
    pose:{timestamp:t,points:part==='body'?[]:[{joint:part,part,x:(x+.5)/w,y:(y+.5)/h}]}};
}
function multiFrame(t,limbs) {
  const f=frame(t);f.depth.person.data.fill(0);f.pose.points=[];
  for(const [part,point,joint=part] of limbs){
    const limb=frame(t,point,part);f.pose.points.push(...limb.pose.points.map(p=>({...p,joint})));
    for(let i=0;i<f.depth.inverse.length;i++)if(limb.depth.person.data[i]){f.depth.person.data[i]=1;f.depth.inverse[i]=limb.depth.inverse[i];}
  }
  return f;
}
export function percussionTapFrame(t,o,lift=0,part='left hand') {
  const anchors={kick:[0,.46,.3],snare:[0,.82,0],hat:[0,.87,0],conga:[0,.89,0],bongo:[-.235,.83,0],
    djembe:[0,.96,0],cowbell:[0,.64,0],triangle:[-.175,.555,0],cymbal:[0,.86,0]};
  const [x,y,z]=anchors[o.instrument],[u,v]=basis(o.normal);
  return frame(t,o.support.map((p,i)=>p+o.size*(x*u[i]+(y+lift)*o.normal[i]-z*v[i])),part);
}
export async function runPercussionRetriggerTests() {
  const c=new BodyInteractions(),o=object(),ground=[0,.16,-3];
  const step=(t,point=ground,part='left hand')=>{const f=frame(t,point,part);return c.update([o],f.depth,f.pose,f.pose,t);};
  for(const part of ['left hand','right hand','left foot','right foot','left elbow']){
    for(const direction of [[0,.14,0],[.14,0,0]]){
      c.reset();assert(step(1000,ground,part).length===1,'first strike immediate');
      const retreat=ground.map((v,i)=>v+direction[i]);
      assert(instrumentDistance(retreat,o)===0,'repeated taps can stay inside the solid drum');
      for(let n=0;n<4;n++){
        const t=1050+n*160;
        assert(!step(t,retreat,part).length&&!step(t+30,retreat,part).length,'withdrawal does not attack');
        const hits=step(t+80,ground,part);
        assert(hits.length===1&&hits[0].reason==='repeated-strike'&&hits[0].part===part,`${part} top/side tap repeats without exiting the contact volume`);
        assert(!step(t+110,ground,part).length,'returned hold never repeats');
      }
    }
  }
  // Every scene uses component geometry for both the initial and repeated hit.
  for(const id of Object.keys(INSTRUMENTS)){
    const drum=object(id);c.reset();
    for(const [t,lift] of [[1000,0],[1050,.14],[1080,.14],[1130,0]]){
      const f=percussionTapFrame(t,drum,lift),events=c.update([drum],f.depth,f.pose,f.pose,t);
      assert(t===1000||t===1130?events.length===1&&events[0].instrument===id:!events.length,`${id} contact and repeated strike`);
    }
  }
  c.reset();step(1000);
  for(let n=0;n<20;n++)assert(!step(1030+n*30,[n%2?.015:-.015,.16+(n%2?.015:-.015),-3]).length,'small positional jitter does not rearm');
  assert(!step(1700,[0,.3,-3]).length&&!step(1730).length,'one high outlier does not rearm');
  for(let t=1760;t<=1820;t+=30){const f=frame(t,ground,'left hand',3.25);assert(!c.update([o],f.depth,f.pose,f.pose,t).length,'depth-only drift cannot rearm');}
  assert(!step(1850).length,'depth drift returning does not strike');
  step(1880,[0,.3,-3]);step(1910,[0,.3,-3]);
  for(let t=1940;t<2200;t+=30)assert(!step(t,[0,.3,-3]).length,'holding a withdrawn hand does not auto-repeat');
  assert(step(2230)[0]?.reason==='repeated-strike','return after a held withdrawal strikes once');
  c.reset();step(3000);step(3050,[0,.3,-3]);
  const duplicate=frame(3050,[0,.3,-3],'left hand');
  assert(!c.observe([o],duplicate.pose,3090).length&&!step(3100).length,'duplicate pose callback cannot confirm a retreat');
  step(3130,[0,.3,-3]);step(3160,[0,.3,-3]);
  const stale=frame(3290,ground,'left hand');c.observe([o],stale.pose,3361);
  assert(!step(3390).length,'stale depth clears pending stroke');
  step(3420,[0,.3,-3]);step(3450,[0,.3,-3]);assert(!step(3600).length,'long pose gaps clear pending stroke');
  c.reset();step(4000);step(4050,[0,.3,-3]);step(4080,[0,.3,-3]);
  const changed=frame(4130,ground,'left hand');changed.pose.points[0].joint='finger';
  assert(!c.update([o],changed.depth,changed.pose,changed.pose,4130).length,'landmark fallback cannot finish another joint\'s stroke');
  // A short cooldown caps noise; a suppressed stroke is consumed immediately,
  // rather than queued to sound later while the player is resting.
  c.reset();step(5000);step(5030,[0,.3,-3]);step(5060,[0,.3,-3]);assert(!step(5090).length&&!step(5130).length,'fast suppressed stroke never produces a delayed attack');
  c.reset();
  const play=(t,left,right,other=true)=>{
    const limbs=[['left hand',left,15],['left hand',left,19],['right hand',right,16]];
    if(other)limbs.push(['body',ground]);
    const f=multiFrame(t,limbs);return c.update([o],f.depth,f.pose,f.pose,t);
  };
  const l=[-.2,.16,-3],r=[.2,.16,-3],lu=[-.2,.3,-3],ru=[.2,.3,-3];
  assert(play(6000,l,r).length===1,'multiple landmarks and two resting hands produce one initial hit');
  play(6050,lu,r);play(6080,lu,r);
  assert(play(6130,l,r)[0]?.part==='left hand','left hand repeats with torso and right hand still touching');
  play(6180,l,ru);play(6210,l,ru);
  assert(play(6260,l,r)[0]?.part==='right hand','alternating right hand repeats without full body release');
  play(6310,lu,ru);play(6340,lu,ru);assert(play(6390,l,r).length===1,'two simultaneous returning limbs coalesce into one instrument hit');
  assert(!play(6550,l,r).length,'multiple hand landmarks cannot duplicate a stroke');
  c.reset();const stationary=[['right foot',[.2,.16,-3]]];
  for(const [t,x] of [[7000,-.8],[7030,-.8],[7140,-.2]]){
    const f=multiFrame(t,[...stationary,['left hand',[x,.16,-3]]]),events=c.update([o],f.depth,f.pose,f.pose,t);
    assert(t===7030?!events.length:events.length===1,'a visibly approaching hand can strike a drum held by a stationary foot');
  }
  // Clear stroke motion through controller lifecycle paths, including drag.
  const controller=new SceneController();
  try{
    for(const action of ['stop','rescan','visibility','drag']){
      controller.setMode('percussion-kit');controller.scan={...dragFixture(),objects:[o]};controller.state='active';
      controller.renderer={setScan(){},setTouchEnabled(){},dispose(){},clearTouch(){},moveObject(){}};controller.worker={terminate(){}};
      for(const [t,y] of [[1000,.16],[1050,.3],[1080,.3]]){const f=frame(t,[0,y,-3],'left hand');controller.interactions.update([o],f.depth,f.pose,f.pose,t);}
      if(action==='drag'){controller.pick=()=>({id:o.id,point:o.position});controller.beginDrag(.5,.5);controller.endDrag();}
      else controller[action]();
      assert(!controller.interactions.states.size,action+' clears pending percussion strokes');controller.stop();
    }
  }finally{controller.dispose();}
  return ['repeated hand/foot top and side taps inside drum volumes, all nine instruments, resting-body overlap, alternating limbs, landmark grouping, jitter/outlier/depth/freshness guards, cooldown and lifecycle cleanup'];
}
export async function runPercussionTests() {
  const passed=[];
  assert(sceneMode(null,true)==='models'&&sceneMode(null,false)==='none'&&sceneMode('percussion-hand',true)==='percussion-hand','preference migration and explicit mode precedence');
  assert(sceneMode('invalid')==='none'&&Object.keys(SCENE_MODES).length===7&&sceneMode('magenta')==='magenta'&&sceneMode('floor-piano')==='floor-piano','invalid preferences safe and added scene choices preserved');
  const original=dragFixture();
  for(const mode of Object.keys(SCENE_MODES).filter(k=>k.startsWith('percussion-'))){
    const scan=instrumentScan(original,mode);assert(scan.objects.length===1&&scan.objects[0].instrument===SCENE_MODES[mode].instruments[0],'limited surface count decorates available placement');
    const o=scan.objects[0],drag=new SurfaceDrag(scan,o,o.position),target=drag.target(.7,.8);
    assert(target?.instrument===o.instrument&&target.placement==='manual','nearest fitting drag retains instrument identity');
  }
  const controller=new SceneController();controller.setTouchEnabled(false);controller.setMode('percussion-kit');
  assert(controller.interactions.enabled&&controller.configuration().touch.parts[0]==='whole body','percussion always enables body contact');
  controller.setMode('models');assert(!controller.interactions.enabled,'original touch preference survives mode changes');controller.dispose();
  const landmarks=Array.from({length:33},()=>({x:.5,y:.5,visibility:1,presence:1}));
  assert(touchPose(landmarks,0,true).points.some(p=>p.part==='torso')&&!touchPose(landmarks,0).points.some(p=>p.part==='torso'),'whole-body segments only in percussion');
  landmarks[11].visibility=0;assert(!touchPose(landmarks,0,true).points.some(p=>p.joint==='segment-0-1'),'uncertain segment excluded');
  passed.push('scene modes, preference migration, placement count, instrument-preserving drag, and separate interaction settings');
  const c=new BodyInteractions(),o=object();
  const step=(t,part='body',z=3,point=[0,.16,-3])=>{const f=frame(t,point,part,z);return c.update([o],f.depth,f.pose,f.pose,t);};
  for(const part of ['left hand','left foot','left elbow','left knee','head','torso','body']){
    c.reset();const hit=step(1000,part);assert(hit.length===1&&hit[0].instrument==='snare',`${part} contact fires immediately`);
    for(let t=1100;t<1500;t+=100)assert(!step(t,part).length,`${part} held contact fires once`);
  }
  c.reset();step(1000,'left hand');assert(!step(1100,'right foot').length,'another body part cannot retrigger held instrument');
  step(1200,'body',6);step(1330,'body',6);assert(step(1400,'left knee').length===1,'release then re-entry strikes again');
  for(const z of [1,6]){c.reset();assert(!step(1000,'torso',z).length,'body passing in front/behind cannot trigger');}
  for(const mutate of [f=>f.depth.person=null,f=>f.depth.person.data.fill(.4),f=>f.depth.inverse.fill(NaN),f=>f.depth.aligned=false]){
    c.reset();const f=frame(1000);mutate(f);assert(!c.update([o],f.depth,f.pose,f.pose,1000).length,'uncertain mask/depth/alignment rejected');
  }
  c.reset();let f=frame(1000);assert(!c.update([o],f.depth,f.pose,f.pose,1201).length,'stale depth rejected');
  c.reset();f=frame(1000);f.depth.person.data.fill(0);f.depth.person.data[54*160+80]=1;
  assert(!c.update([o],f.depth,f.pose,f.pose,1000).length,'isolated foreground pixel rejected');
  c.reset();f=frame(1000);assert(c.update([o,{...o,id:1}],f.depth,f.pose,f.pose,1000).length===2,'simultaneous instruments can trigger');
  c.reset();f=frame(1000,[-.9,.16,-3],'left elbow');assert(!c.update([o],f.depth,f.pose,f.pose,1000).length,'elbow starts outside');
  f=frame(1100,[.9,.16,-3],'left elbow');assert(c.update([o],f.depth,f.pose,f.pose,1100)[0]?.part==='left elbow','swept elbow crossing strikes between pose samples');
  assert(instrumentDistance([.15,.05,-2.8],object('triangle'))>.15,'empty space inside triangle does not become a solid contact box');
  passed.push('whole-body mask and joints, immediate/sustained/repeated/simultaneous hits, depth ordering, stale and uncertain rejection');

  const T=await import('../web/live/vendor/scene/three/three.module.js'),r=new SceneRenderer(T);
  const preview=document.createElement('canvas');preview.width=960;preview.height=780;const g=preview.getContext('2d');g.fillStyle='#15222d';g.fillRect(0,0,960,780);
  try {
    for(const [i,id] of Object.keys(INSTRUMENTS).entries()){
      const meshes=buildInstrument(T,id,1),bounds=new T.Box3();
      for(const mesh of meshes){mesh.updateMatrixWorld();bounds.expandByObject(mesh);mesh.geometry.dispose();mesh.material.dispose();}
      assert(bounds.min.x>=-.5&&bounds.max.x<=.5&&bounds.min.z>=-.5&&bounds.max.z<=.5&&bounds.min.y>=-.001&&bounds.max.y<=1,`${id} stays inside placement envelope`);
      const o=object(id);r.setScan({objects:[o]});r.setDepth(new Float32Array(160*120).fill(.1),160,120);
      const image=r.render(320,240,[true],1000);g.drawImage(image,(i%3)*320,Math.floor(i/3)*260);
      g.fillStyle='#ffffff';g.font='17px sans-serif';g.fillText(INSTRUMENTS[id].label,(i%3)*320+110,Math.floor(i/3)*260+248);
      assert(r.meshes.length>=3&&r.meshes.every(m=>m.userData.objectId===0),'all composite meshes selectable');
      const mesh=r.meshes.reduce((a,b)=>a.position.y>b.position.y?a:b),p=mesh.getWorldPosition(new T.Vector3()),uv=project(p.toArray(),160,120);
      assert(r.pick((uv[0]+.5)/160,(uv[1]+.5)/120,[true])?.id===0,`${id} real raycast selects component`);
      r.touch({object_id:0,position:[0,0,-3],effect_timestamp_ms:1000});r.render(320,240,[true],1100);
      assert(r.meshes.every(m=>m.material.emissiveIntensity>1)&&r.effects[0].particles.geometry.drawRange.count===56,'complete model glows and emits bounded sparks');
      r.setDepth(new Float32Array(160*120).fill(1),160,120);
      const hidden=document.createElement('canvas');hidden.width=320;hidden.height=240;const hg=hidden.getContext('2d');hg.drawImage(r.render(320,240,[true],1100),0,0);
      assert(!hg.getImageData(0,0,320,240).data.some((v,i)=>i%4===3&&v),'foreground occludes model and effects');
      assert(!r.pick(.5,.5,[true]),'cannot pick through foreground');
    }
    window.percussionPreview=preview.toDataURL();
  }finally{r.dispose();}
  passed.push('all nine procedural models fit placement footprints, composite ray picking, complete-model glow/sparks and GPU occlusion');

  // Inspect actual rendered audio, not just returned metadata. Frequency/decay
  // signatures distinguish the nine voices, with no network or samples.
  const signatures=[];
  for(const id of Object.keys(INSTRUMENTS)){
    const ctx=new OfflineAudioContext(2,96000,48000),noise=ctx.createBuffer(1,96000,48000),data=noise.getChannelData(0);
    let seed=1;for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=seed/2147483648-1;}
    percussionVoice(ctx,noise,ctx.destination,id,0,1,0);const result=await ctx.startRendering(),a=result.getChannelData(0);
    let energy=0,late=0,crossings=0;for(let i=1;i<a.length;i++){energy+=a[i]*a[i];if(i>24000)late+=a[i]*a[i];if(a[i]*a[i-1]<0)crossings++;}
    assert(energy>1&&Number.isFinite(energy),`${id} is audible and finite`);signatures.push([id,energy,late,crossings]);
  }
  for(let i=0;i<signatures.length;i++)for(let j=i+1;j<signatures.length;j++)assert(Math.abs(signatures[i][1]-signatures[j][1])>1||Math.abs(signatures[i][3]-signatures[j][3])>50,'voices have distinct acoustic signatures');
  const e=new Engine();e.ctx=new AudioContext();await e.ctx.resume();await e.start();e.limiter.disconnect(e.ctx.destination);e.inst.gain.value=0;
  const chunks=[],rec=new MediaRecorder(e.recordStream());rec.ondataavailable=ev=>{if(ev.data.size)chunks.push(ev.data);};const stopped=new Promise(resolve=>rec.onstop=resolve);rec.start();
  try {
    let serial=0;const strike=id=>e.touchObject({instrument:id,object_id:serial++%3,generation:1,x:.2,timestamp_ms:performance.now()+serial,effect_timestamp_ms:performance.now()},true);
    for(const id of Object.keys(INSTRUMENTS)){const sound=strike(id);assert(sound.instrument===id&&Math.abs(sound.pan-.6)<1e-6&&!sound.midi,'instrument identity, mirror pan, and no chord requirement');await wait(65);}
    assert(e.objectVoices.size<=6&&e.peak()>.001,'bounded voices audible with movement gate off');
    rec.stop();await stopped;const audio=await e.ctx.decodeAudioData(await new Blob(chunks,{type:rec.mimeType}).arrayBuffer());
    assert(audio.getChannelData(0).some(x=>Math.abs(x)>.01),'instrument sound survives recorded audio encoding');
    e.level('objects',0);e.wet.gain.value=0;await wait(80);strike('snare');await wait(100);assert(e.peak()<.002,'objects fader mutes percussion');
    await e.stop();assert(!e.objectVoices.size,'stop disposes percussion voices');
  }finally{if(rec.state!=='inactive'){rec.stop();await stopped;}await e.stop();}
  passed.push('nine distinct synthesized voices, mirrored stereo, independent mixer, bounded disposal and actual encoded recording audio');
  return passed;
}

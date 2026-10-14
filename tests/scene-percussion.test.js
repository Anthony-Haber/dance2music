import {SCENE_MODES,INSTRUMENTS,sceneMode,instrumentScan,buildInstrument} from '../web/live/scene/instruments.js';
import {BodyInteractions,touchPose,instrumentDistance} from '../web/live/scene/touch.js';
import {SceneRenderer} from '../web/live/scene/renderer.js';
import {SceneController} from '../web/live/scene/controller.js';
import {project} from '../web/live/scene/geometry.js';
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
export async function runPercussionTests() {
  const passed=[];
  assert(sceneMode(null,true)==='models'&&sceneMode(null,false)==='none'&&sceneMode('percussion-hand',true)==='percussion-hand','preference migration and explicit mode precedence');
  assert(sceneMode('invalid')==='none'&&Object.keys(SCENE_MODES).length===6&&sceneMode('magenta')==='magenta','invalid preferences safe and Magenta adds a sixth choice');
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

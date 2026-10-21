import {ray,project,normalization,normalize,alignDepth,reconstruct,footprintFits,depthVisible} from '../web/live/scene/geometry.js';
import {SceneRenderer} from '../web/live/scene/renderer.js';
import {SceneController} from '../web/live/scene/controller.js';
import {compositingDepth} from '../web/live/scene/occlusion.js';
import {PersonMaskReader} from '../web/live/scene/person-mask.js';
import {TouchInteractions,touchPose,touchDepth,distanceToObject,TOUCH_SETTINGS} from '../web/live/scene/touch.js';
import {SurfaceDrag} from '../web/live/scene/drag.js';
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
export function fixture({scale=1,offset=0,table=true,person=false}={}) {
  const width=96,height=72,n=width*height,depth=new Float32Array(n),labels=new Uint8Array(n),confidence=new Float32Array(n).fill(.99),rgb=new Uint8Array(n).fill(128);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const i=y*width+x,r=ray(x,y,width,height);
    let d=.12+.04*r[0];
    if(y>37){d=-r[1]/1.5;labels[i]=3;}
    if(table&&y>29&&y<45&&x>12&&x<60){d=-r[1]/.32+.55;labels[i]=15;}
    // Table legs retain the table semantic label but are vertical planes.
    if(table&&y>=45&&y<62&&((x>13&&x<18)||(x>54&&x<59))){d=.62;labels[i]=15;}
    if(person&&x>66&&x<75){d=.8;labels[i]=12;}
    depth[i]=d*scale+offset;
  }
  return {width,height,depth,labels,confidence,rgb,timestamp:performance.now()};
}
export async function runGeometryTests() {
  const passed=[],f=fixture(),scan=reconstruct([f,fixture({scale:2,offset:3}),fixture({scale:.7,offset:-.2})]);
  assert(scan.objects.length>0,'synthetic floor/table must produce placements');
  assert(scan.surfaces.some(s=>s.kind==='floor'),'floor accepted');
  assert(scan.surfaces.some(s=>s.kind==='table'),'tabletop accepted');
  assert(scan.objects[0].shape==='cube'&&scan.objects.length<=3,'bounded deterministic objects');
  assert(scan.surfaces[scan.objects[0].surface].kind==='table','tabletop placement is preferred');
  assert(JSON.stringify(scan.objects)===JSON.stringify(reconstruct([f,f,f]).objects),'scale invariant placement');
  for(const object of scan.objects){
    const p=project(object.position,f.width,f.height),drag=new SurfaceDrag(scan,object,object.position);
    assert(drag.target((p[0]+.5)/f.width,(p[1]+.5)/f.height),'reconstructed interior runs support actual initial placements');
  }
  assert(scan.surfaces.every(s=>s.normal[1]>.72),'table legs rejected');
  const p=ray(17,42,96,72).map(v=>v*3),uv=project(p,96,72),mirrored=project(p,96,72,true);
  assert(Math.abs(uv[0]-17)<1e-6&&Math.abs(uv[1]-42)<1e-6&&Math.abs(mirrored[0]-78)<1e-6,'projection and mirror');
  const invalid=fixture();invalid.depth.fill(NaN);assert(!normalization(invalid.depth),'invalid depth rejected');
  invalid.depth.fill(1);assert(!normalization(invalid.depth)&&!reconstruct([invalid,invalid,invalid]).objects.length,'constant depth rejected');
  const a=alignDepth(fixture({scale:2,offset:3}),f);assert(Math.abs(a.scale-.5)<1e-5&&Math.abs(a.offset+1.5)<1e-5,'affine alignment');
  assert(alignDepth(invalid,f)===null,'constant alignment rejected');
  const no=fixture();no.confidence.fill(.3);assert(!reconstruct([no,no,no]).objects.length,'uncertain regions rejected');
  const hidden=fixture({person:true}),placed=reconstruct([hidden,hidden,hidden]);assert(placed.objects.every(o=>o.point[0]<65||o.point[0]>77),'person exclusion');
  const mask=new Uint8Array(96*72).fill(1);mask[36*96+48]=0;
  assert(!footprintFits([0,0,-2],.5,[0,0,1],mask,96,72),'footprint interior holes rejected');
  assert(depthVisible(2,.2,50)&&!depthVisible(2,1,50),'person behind and in front ordering');
  assert(!depthVisible(2,.2,201)&&!depthVisible(2,.2,10,false)&&!depthVisible(2,.2,10,true,true),'stale/failed alignment/motion suppress');
  passed.push('synthetic floor/table, legs, uncertainty/person exclusion, affine depth, invalid depth, footprint holes, projection/mirroring, stale and ordering');
  return passed;
}
export async function runRendererTests() {
  const T=await import('../web/live/vendor/scene/three/three.module.js'),r=new SceneRenderer(T),width=160,height=120;
  r.setScan({objects:[{id:0,shape:'cube',size:1,support:[0,-.5,-3],normal:[0,1,0]}]});
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');
  const pixel=()=>{ctx.clearRect(0,0,width,height);ctx.drawImage(r.render(width,height,[true]),0,0);return ctx.getImageData(80,60,1,1).data;};
  r.setDepth(new Float32Array(width*height).fill(.2),width,height);const behind=pixel();assert(behind[3]>240,'object visible in front of real background/person');
  r.setDepth(new Float32Array(width*height).fill(1),width,height);assert(pixel()[3]===0,'foreground person/furniture occludes object');
  r.setDepth(new Float32Array(width*height).fill(NaN),width,height);assert(pixel()[3]===0,'invalid depth never reveals objects');
  const split=new Float32Array(width*height).fill(.2);for(let y=0;y<height/2;y++)for(let x=0;x<width;x++)split[y*width+x]=1;
  r.setDepth(split,width,height);ctx.clearRect(0,0,width,height);ctx.drawImage(r.render(width,height,[true]),0,0);
  assert(ctx.getImageData(80,50,1,1).data[3]===0&&ctx.getImageData(80,70,1,1).data[3]>240,'real depth texture uses source top/bottom coordinates');
  ctx.clearRect(0,0,width,height);ctx.drawImage(r.render(width,height,[false]),0,0);assert(ctx.getImageData(80,70,1,1).data[3]===0,'suppression clears previous render');
  r.dispose();return ['real Three.js depth compositor: foreground, background, split ordering, coordinates and suppression'];
}
export async function runTouchTests() {
  const object={id:0,shape:'cube',size:1,position:[0,0,-3],support:[0,-.5,-3],normal:[0,1,0]},objects=[object];
  const pose=(timestamp,x=.5,y=.5,joint=19)=>({timestamp,points:[{joint,part:joint===31?'left foot':'left hand',x,y}]});
  const depth=(timestamp,z=3)=>({timestamp,width:160,height:120,aligned:true,inverse:new Float32Array(160*120).fill(1/z),person:{width:160,height:120,data:new Float32Array(160*120).fill(1)}});
  const c=new TouchInteractions();
  const step=(t,z=3,x=.5,joint=19)=>c.update(objects,depth(t,z),pose(t,x,.5,joint),pose(t+25,x,.5,joint),t+30);
  assert(!step(1000).length,'first proximity sample waits for confirmation');
  assert(!step(1010).length,'brief overlap is insufficient');
  let events=step(1100);assert(events.length===1&&events[0].part==='left hand'&&events[0].approximate,'confirmed hand contact emits one event');
  assert(!step(1100).length,'same inference cannot trigger twice');
  for(let t=1200;t<=2100;t+=100)assert(!step(t).length,'held contact never repeats bursts');
  assert(c.visual(2130)[0].active&&c.count===1,'held contact keeps glow active');
  step(2200,6);step(2300,6);assert(!c.visual(2330)[0].active,'release exits contact');
  step(2400,3,.5,31);events=step(2500,3,.5,31);
  assert(events.length===1&&events[0].part==='left foot','foot re-entry produces a new burst');
  assert(!c.visual(2801)[0].active&&c.visual(2801)[0].proximity===0,'stale contact cannot hold glow');
  c.reset();step(1000);step(1100);step(1200,6);step(1230,6);step(1240);
  assert(!step(1270).length,'quick re-entry cannot bypass cooldown');
  step(1400);assert(step(1450).length===1,'stable re-entry may trigger after cooldown');
  for(const z of [1,6]){c.reset();step(1000,z);assert(!step(1100,z).length,'projected overlap in front/behind is not contact');}
  const reject=(name,change)=>{
    c.reset();for(const t of [1000,1100,1200]){
      const d=depth(t),captured=pose(t),current=pose(t+25),input={now:t+30,d,captured,current};change(input);
      assert(!c.update(objects,input.d,input.captured,input.current,input.now).length,name);
    }
  };
  reject('missing mask rejects background masquerading as hand',i=>i.d.person=null);
  reject('uncertain person pixels rejected',i=>i.d.person.data.fill(.4));
  reject('invalid depth rejected',i=>i.d.inverse.fill(NaN));
  reject('unaligned depth rejected',i=>i.d.aligned=false);
  reject('stale depth rejected',i=>i.now+=201);
  reject('stale pose rejected',i=>i.captured.timestamp-=200);
  reject('invalid timestamp rejected',i=>i.d.timestamp=NaN);
  reject('future pose rejected',i=>i.current.timestamp+=1000);
  reject('missing joint rejected',i=>i.current.points=[]);
  reject('fast swipe rejects delayed contact',i=>i.current.points[0].x+=.1);
  reject('bimodal depth rejected',i=>{for(let k=0;k<i.d.inverse.length;k++)i.d.inverse[k]=k%2?1:1/6;});
  const noisy=depth(1000);noisy.inverse[60*160+80]=1;assert(Math.abs(touchDepth(pose(1000).points[0],noisy)-3)<1e-5,'isolated boundary outlier does not discard a limb');
  c.reset();c.enabled=false;step(1000);assert(!step(1100).length&&!c.visual(1130).length,'disabled effects ignore contacts');c.enabled=true;
  const landmarks=Array(33).fill(null);landmarks[19]={x:.5,y:.5,visibility:.9,presence:.9};landmarks[31]={x:.5,y:.5,visibility:.3};
  const copied=touchPose(landmarks,10);landmarks[19].x=.1;
  assert(copied.points.length===1&&copied.points[0].x===.5,'only confident landmarks are copied');
  assert(distanceToObject([.49,.49,-3.49],object)===0,'cube volume accepted');
  assert(distanceToObject([.49,.49,-3.49],{...object,shape:'sphere'})>.3,'sphere excludes cube corners');
  assert(distanceToObject([.49,0,-3.49],{...object,shape:'cylinder'})>.19,'cylinder excludes radial corners');
  const tilted={...object,size:2,normal:[0,Math.SQRT1_2,Math.SQRT1_2]};
  assert(distanceToObject([0,1.3,-3],tilted)===0&&distanceToObject([0,1.5,-3],tilted)>0,'collision volume follows support orientation');
  // Regression: a real fingertip lies on a soft segmentation boundary. Its
  // nearby foreground depth stays usable even though display pixels are hidden.
  c.reset();const edge=depth(1000);edge.person.data.fill(0);
  for(let y=59;y<63;y++)for(let x=77;x<80;x++)edge.person.data[y*160+x]=.7;
  edge.person.data[60*160+80]=.3;
  assert(touchDepth(pose(1000).points[0],edge)>0,'soft fingertip boundary samples nearby foreground');
  c.update(objects,edge,pose(1000),pose(1010),1010);
  assert(c.observe(objects,pose(1043),1043).length===1,'one depth result plus two pose frames recognizes a tap');
  assert(!c.observe(objects,pose(1076),1076).length,'pose-rate held contact stays single');
  c.reset();const small={...object,size:.15};
  c.update([small],depth(1000),pose(1000,.45),pose(1010,.45),1010);
  assert(c.observe([small],pose(1043,.53),1043).length===1,'swept tap crossing between depth frames is detected');
  assert(!c.observe([small],pose(1250,.5),1250).length,'pose extrapolation never outlives fresh depth');
  return ['pose-rate taps and swept crossing, soft person boundaries, robust depth, hold/release/cooldown, front/behind rejection and stale guards'];
}
export async function runTouchEffectsTests() {
  const T=await import('../web/live/vendor/scene/three/three.module.js'),r=new SceneRenderer(T),width=320,height=240;
  r.setScan({objects:[{id:0,shape:'cube',size:1,support:[0,-.5,-3],normal:[0,1,0]}]});
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const g=canvas.getContext('2d');
  const pixels=(time,visible=true)=>{g.clearRect(0,0,width,height);g.drawImage(r.render(width,height,[visible],time),0,0);return g.getImageData(0,0,width,height).data;};
  const count=data=>{let n=0;for(let i=3;i<data.length;i+=4)if(data[i]>10)n++;return n;};
  try {
    r.setDepth(new Float32Array(width*height).fill(.15),width,height);
    const idle=pixels(1300),idleArea=count(idle);
    r.touch({object_id:0,position:[0,0,-2.5],effect_timestamp_ms:1000});
    const burst=pixels(1300),burstArea=count(burst),effect=r.effects[0];
    // Save a real-renderer comparison, useful for reviewing the visual effect.
    const preview=document.createElement('canvas');preview.width=640;preview.height=280;
    const pg=preview.getContext('2d');pg.fillStyle='#10131e';pg.fillRect(0,0,640,280);
    const tile=document.createElement('canvas');tile.width=width;tile.height=height;const tg=tile.getContext('2d');
    for(const [i,data] of [idle,burst].entries()){tg.putImageData(new ImageData(data,width,height),0,0);pg.drawImage(tile,i*320,30);}
    pg.fillStyle='#ddd';pg.font='16px sans-serif';pg.fillText('Idle',20,25);pg.fillText('Contact: glow, sparks and ripple',340,25);
    window.touchEffectPreview=preview.toDataURL('image/png');
    assert(burstArea>idleArea+250,'burst and ripple extend visibly beyond object');
    assert(burst[(120*width+160)*4]>idle[(120*width+160)*4]+10,'touch brightens the core');
    assert(effect.particles.geometry.drawRange.count===TOUCH_SETTINGS.particles_per_object,'particle pool is bounded');
    const repeat=pixels(1300);assert(repeat.every((value,i)=>value===burst[i]),'preview/recorder render at same timestamp is deterministic');
    // Split foreground occludes all effects, while the other half remains visible.
    const split=new Float32Array(width*height).fill(.15);for(let y=0;y<height;y++)for(let x=0;x<width/2;x++)split[y*width+x]=2;
    r.setDepth(split,width,height);const clipped=pixels(1300);let left=0,right=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){if(clipped[(y*width+x)*4+3]>10){if(x<width/2)left++;else right++;}}
    assert(left===0&&right>idleArea/3,'foreground occludes glow, particles and ripple with correct ordering');
    assert(count(pixels(1300,false))===0,'motion/stale suppression hides effects with object');
    // A translucent spark in front of real furniture cannot expose a cube
    // behind that furniture through its accumulated color buffer.
    r.setDepth(new Float32Array(width*height).fill(1/2.3),width,height);
    effect.count=1;effect.velocities.fill(0);effect.starts.fill(0);effect.origin.set(0,.5+1.5*.3*.3,1);
    const withCore=pixels(1300);effect.mesh.visible=false;const withoutCore=pixels(1300);effect.mesh.visible=true;
    assert(count(withCore)>0&&withCore.every((value,i)=>value===withoutCore[i]),'foreground transparent spark cannot reveal hidden core');
    effect.count=TOUCH_SETTINGS.particles_per_object;
    r.setDepth(new Float32Array(width*height).fill(.15),width,height);
    assert(count(pixels(2300))>idleArea+50,'burst remains visible long enough to see across the room');
    pixels(2900);assert(effect.particles.geometry.drawRange.count===0&&!effect.ring.visible,'burst expires without retained particles');
    r.touch({object_id:0,position:[0,0,-2.5],effect_timestamp_ms:3000});r.setTouchEnabled(false);pixels(3100);
    assert(!effect.glow.visible&&effect.mesh.material.emissiveIntensity===0&&effect.particles.geometry.drawRange.count===0,'toggle immediately clears all effects');
    // Regression for a small floor object seen from across the room. Even when
    // its centre is hidden by a shoe, sparks must escape above/around it.
    r.setTouchEnabled(true);
    r.setScan({objects:[{id:0,shape:'sphere',size:.12,position:[0,-.34,-3],support:[0,-.4,-3],normal:[0,1,0]}]});
    const shoe=new Float32Array(width*height).fill(.15);
    for(let y=140;y<height;y++)for(let x=150;x<170;x++)shoe[y*width+x]=1;
    r.setDepth(shoe,width,height);const smallIdle=pixels(3300);
    r.touch({object_id:0,position:[0,-.4,-3],effect_timestamp_ms:3000});
    const smallBurst=pixels(3600);let escaped=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if((y<140||x<150||x>=170)&&smallBurst[(y*width+x)*4+3]>80&&smallIdle[(y*width+x)*4+3]<10)escaped++;
    assert(escaped>250,'distant object emits a clearly visible burst outside the occluding shoe');
    return ['GPU touch glow/burst/ripple visibility, bounded particles, deterministic recording composition, foreground occlusion, suppression, expiration and toggle'];
  }finally{r.dispose();}
}
export async function runMotionOcclusionTests() {
  const width=160,height=120,n=width*height,pixels=new Uint8ClampedArray(n*4).fill(128);
  const latest={width,height,inverse:new Float32Array(n).fill(.2),rgb:new Uint8Array(n).fill(128),person:{width,height,data:new Float32Array(n)}};
  const person={width,height,timestamp:1000,data:new Float32Array(n)};
  for(let y=45;y<75;y++)for(let x=80;x<87;x++){person.data[y*width+x]=1;pixels[(y*width+x)*4]=pixels[(y*width+x)*4+1]=pixels[(y*width+x)*4+2]=0;}
  const out=compositingDepth(latest,person,pixels,1030);
  assert(out[60*width+83]===0&&out[60*width+70]>.19,'moving limb suppresses only its pixels, not the entire object');
  assert(latest.inverse[60*width+83]>.19,'display mask never destroys touch depth');
  const T=await import('../web/live/vendor/scene/three/three.module.js'),r=new SceneRenderer(T);
  r.setScan({objects:[{id:0,shape:'cube',size:1,support:[0,-.5,-3],normal:[0,1,0]}]});r.setDepth(out,width,height);
  const c=document.createElement('canvas');c.width=width;c.height=height;const g=c.getContext('2d');g.drawImage(r.render(width,height,[true]),0,0);
  assert(g.getImageData(83,60,1,1).data[3]===0&&g.getImageData(70,60,1,1).data[3]>240,'GPU preserves unaffected part of touched object');r.dispose();
  latest.person=person;latest.inverse.fill(.15);latest.rgb.fill(0);pixels.fill(0);
  assert(compositingDepth(latest,person,pixels,1030)[60*width+83]>.14,'confident person behind object retains real depth');
  return ['moving silhouette invalidates pixels without whole-object flicker; raw contact depth preserved; confident person ordering retained'];
}
export async function runPersonMaskTests() {
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2'),reader=new PersonMaskReader();
  const width=64,height=32,texture=gl.createTexture(),source=new Float32Array(width*height);
  gl.getExtension('EXT_color_buffer_float');gl.bindTexture(gl.TEXTURE_2D,texture);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)source[y*width+x]=y<16&&x<32?.9:.1;
  gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,width,height,0,gl.RED,gl.FLOAT,source);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  const mask={width,height,canvas,hasWebGLTexture:()=>true,getAsWebGLTexture:()=>texture,
    getAsFloat32Array:()=>{throw new Error('unsupported RED/FLOAT readback must not be called');}};
  // Preserve host state, including PBO/packing and a non-default texture unit.
  const framebuffer=gl.createFramebuffer(),vao=gl.createVertexArray(),pack=gl.createBuffer(),sampler=gl.createSampler();
  gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.bindVertexArray(vao);gl.viewport(3,4,17,19);gl.enable(gl.SCISSOR_TEST);gl.enable(gl.BLEND);
  gl.colorMask(false,true,false,true);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,pack);gl.bufferData(gl.PIXEL_PACK_BUFFER,4096,gl.STREAM_READ);
  gl.pixelStorei(gl.PACK_ROW_LENGTH,7);gl.pixelStorei(gl.PACK_SKIP_ROWS,2);gl.bindSampler(0,sampler);gl.activeTexture(gl.TEXTURE3);
  try {
    const result=reader.read(mask,64);
    assert(result.data[8*64+8]>.89&&result.data[24*64+8]<.11&&result.data[8*64+48]<.11,'real GPU mask readback preserves probability and source orientation');
    assert(gl.getError()===gl.NO_ERROR,'GPU conversion uses a supported readback format');
    assert(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING)===framebuffer&&gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)===framebuffer&&
      gl.getParameter(gl.VERTEX_ARRAY_BINDING)===vao&&gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)===pack&&gl.getParameter(gl.ACTIVE_TEXTURE)===gl.TEXTURE3,'shared GL bindings restored');
    assert(gl.getParameter(gl.VIEWPORT).join()==='3,4,17,19'&&gl.getParameter(gl.COLOR_WRITEMASK).join()==='false,true,false,true'&&
      gl.isEnabled(gl.SCISSOR_TEST)&&gl.isEnabled(gl.BLEND)&&gl.getParameter(gl.PACK_ROW_LENGTH)===7&&gl.getParameter(gl.PACK_SKIP_ROWS)===2,'shared GL render/packing state restored');
    const again=reader.read(mask,32);assert(again.width===32&&again.data[0]>.89&&result.data[0]>.89,'resize and callback-owned copies');
    return ['real float GPU person mask converts via RGBA8 without RED/FLOAT readback, preserving orientation, probability, host GL state and ownership'];
  }finally{reader.dispose();gl.deleteTexture(texture);gl.deleteFramebuffer(framebuffer);gl.deleteVertexArray(vao);gl.deleteBuffer(pack);gl.deleteSampler(sampler);gl.getExtension('WEBGL_lose_context')?.loseContext();}
}
export async function runTouchAudioTests() {
  const {Engine}=await import('../web/live/audio.js'),e=new Engine();e.ctx=new AudioContext();await e.ctx.resume();await e.start();
  e.limiter.disconnect(e.ctx.destination); // Measure/record the real graph without test tones on the speakers.
  e.inst.gain.value=0;e.setChord('I',true);
  const stream=e.recordStream(),chunks=[],rec=new MediaRecorder(stream);
  rec.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
  const stopped=new Promise(resolve=>rec.onstop=resolve);rec.start();
  try {
    const event={object_id:0,shape:'cube',generation:1,timestamp_ms:performance.now(),effect_timestamp_ms:performance.now(),x:.2};
    const note=e.touchObject(event,true);
    assert(note.midi===72&&note.chord==='I'&&Math.abs(note.pan-.6)<1e-6,'object pitch follows current chord root and mirrored pan');
    assert(e.touchObject(event,true)===null,'one contact cannot play twice');
    await wait(100);assert(e.peak()>.001,'object is audible through master while movement instrument gate is zero');
    e.setChord('ii',true);const changed=e.touchObject({...event,timestamp_ms:performance.now(),effect_timestamp_ms:performance.now()});
    assert(changed.midi===74&&changed.chord==='ii','next contact follows changed harmony');
    assert(e.touchObject({...event,timestamp_ms:1,effect_timestamp_ms:performance.now()-300})===null,'late sound never plays');
    await wait(500);rec.stop();await stopped;
    const decoded=await e.ctx.decodeAudioData(await new Blob(chunks,{type:rec.mimeType}).arrayBuffer());
    let energy=0;for(const x of decoded.getChannelData(0))energy+=x*x;
    assert(energy>1,'contact notes survive the actual recorder audio stream and encoding');
    // The signal contains the requested C5 and D5 fundamentals.
    const data=decoded.getChannelData(0),power=hz=>{let re=0,im=0;for(let i=0;i<data.length;i++){const a=i*2*Math.PI*hz/decoded.sampleRate;re+=data[i]*Math.cos(a);im+=data[i]*Math.sin(a);}return re*re+im*im;};
    assert(power(note.frequency_hz)>power(400)*3&&power(changed.frequency_hz)>power(450)*3,'recorded sound contains both chord pitches');
    for(let i=0;i<12;i++)e.touchObject({...event,object_id:i%3,timestamp_ms:performance.now()+i,effect_timestamp_ms:performance.now()});
    assert(e.objectVoices.size<=6,'contact synth polyphony is bounded');
    await e.stop();assert(!e.objectVoices.size,'stop releases contact voices');
    return ['current-chord object notes, mirror pan, duplicate/late rejection, independent volume, actual recorded audio/pitches and bounded voices'];
  }finally{if(rec.state!=='inactive'){rec.stop();await stopped;}await e.stop();}
}
export async function runTouchControllerTests() {
  const T=await import('../web/live/vendor/scene/three/three.module.js'),c=new SceneController(),f=fixture({table:false});
  c.worker={terminate(){}};c.source='contact-test';c.scan=reconstruct([f,f,f]);c.reference=f;c.state='active';c.rateTimes=[];
  c.renderer=new SceneRenderer(T);c.renderer.setScan(c.scan);
  const object=c.scan.objects[0],[x,y]=project(object.position,f.width,f.height),norm=c.scan.normalization;
  const frame=async()=>{
    const now=performance.now(),landmarks=Array(33).fill(null);
    landmarks[19]={x:(x+.5)/f.width,y:(y+.5)/f.height,visibility:1};c.observePose(landmarks,now);
    const result={...fixture({table:false}),source:c.source,generation:c.generation,type:'result',timestamp:now,touchPose:c.currentTouchPose,
      person:{width:f.width,height:f.height,data:new Float32Array(f.width*f.height)}};
    for(let yy=Math.floor(y)-3;yy<=Math.floor(y)+3;yy++)for(let xx=Math.floor(x)-3;xx<=Math.floor(x)+3;xx++){
      const i=yy*f.width+xx;result.person.data[i]=1;result.depth[i]=norm.scale/-object.position[2]-norm.offset;
    }
    await c.receive(result);return result;
  };
  try {
    await frame();await wait(90);const result=await frame();
    const events=c.takeTouchEvents();assert(events.length===1&&events[0].generation===c.generation,'aligned worker result triggers contact with scan generation');
    assert(c.renderer.effects[0].started===events[0].effect_timestamp_ms,'contact drives the live renderer');
    assert(!c.takeTouchEvents().length,'recording event queue drains once');
    assert(c.configuration().touch.enabled&&c.configuration().touch.parts.includes('feet'),'recording includes interaction settings');
    c.touchEvents.push(events[0]);c.setTouchEnabled(false);assert(!c.touchEvents.length&&!c.interactions.count&&!c.renderer.effects[0].enabled,'live toggle resets state and visuals');
    c.setTouchEnabled(true);c.touchEvents.push(events[0]);c.rescan();
    assert(!c.touchEvents.length&&!c.interactions.states.size&&!c.renderer.effects.length,'rescan drops interactions with old objects');
    await c.receive(result);assert(!c.touchEvents.length&&!c.latest,'late contact from previous scan is discarded');
    c.stop();assert(!c.currentTouchPose&&!c.touchEvents.length,'stop releases pose and contact data');
    return ['worker-result contact reaches renderer and recording once; toggle, rescan, generation and stop reset interactions'];
  }finally{c.dispose();}
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(test,message,ms=5000){const start=performance.now();while(!test()){if(performance.now()-start>ms)throw new Error(message);await wait(10);}}
export async function runLifecycleTests() {
  const source=document.createElement('canvas');source.width=96;source.height=72;
  const g=source.getContext('2d');g.fillStyle='#808080';g.fillRect(0,0,96,72);
  const video=document.createElement('video');video.muted=true;video.srcObject=source.captureStream(30);await video.play();
  const paint=setInterval(()=>g.fillRect(0,0,1,1),30),workers=[];
  let delay=5, auto=false, invalid=false, maxPending=0, pending=0;
  class Worker {
    constructor(){workers.push(this);this.dead=false;}
    postMessage(request){this.last=request;
      if(request.type==='init'){this.init=request;if(auto)setTimeout(()=>this.ready(),5);return;}
      pending++;maxPending=Math.max(maxPending,pending);
      setTimeout(()=>{pending--;request.image.close();if(this.dead)return;
        const f=fixture({table:false});if(invalid)f.depth.fill(1);
        this.onmessage?.({data:{...request,image:undefined,...f,timestamp:request.timestamp,type:'result',scanResult:request.scan?reconstruct([f,f,f]):undefined}});
      },delay);
    }
    ready(){this.onmessage?.({data:{...this.init,type:'ready',provenance:{test:true},three:new URL('../web/live/vendor/scene/three/three.module.js',import.meta.url).href}});}
    terminate(){this.dead=true;}
  }
  const statuses=[],c=new SceneController({workerFactory:()=>new Worker(),onStatus:s=>statuses.push(s.state)});
  try {
    let starting=c.start(video,'first');c.stop();assert(await starting===false,'stop during loading settles start');
    workers[0].ready();await wait(20);assert(!c.renderer&&c.state==='off','late init ignored');
    auto=true;starting=c.start(video,'second');await until(()=>c.state==='scanning','scan started');c.stop();assert(await starting===false,'stop during scanning settles');
    starting=c.start(video,'third');assert(await starting,'start after cancellation succeeds');
    assert(c.scan.objects.length&&maxPending===1,'placements and only one request in flight');
    c.baselineUntil=0;await until(()=>c.latest,'fresh depth');
    const count=c.scan.objects.length;
    assert(c.visible(performance.now()).length===count,'visibility corresponds to objects');
    assert(c.visible(c.latest.timestamp+201).every(v=>!v),'stale inference hides all');
    c.latest.aligned=false;assert(c.visible(performance.now()).every(v=>!v),'failed alignment hides all');
    const generation=c.generation;c.rescan();assert(c.generation>generation&&!c.latest&&!c.scan.objects.length,'rescan clears placements immediately');
    await c.receive({...fixture(),source:'third',generation,type:'result'});assert(!c.latest,'old scan result discarded');
    await until(()=>c.state==='active','rescan completes');
    // Callback-owned person masks are copied, never retained.
    const values=new Float32Array(16).fill(1);c.copyPerson({width:4,height:4,getAsFloat32Array:()=>values},performance.now());values.fill(0);
    assert(c.person.data[0]===1,'person mask owns callback data');
    c.copyPerson(null,performance.now());assert(c.person===null,'absent person mask clears');
    const changed={...fixture({table:false}),source:'third',generation:c.generation,type:'result'};
    changed.rgb.fill(0);await c.receive(changed);
    assert(!c.latest,'camera/background change immediately suppresses placements');
    c.unreliableSince=performance.now()-2100;await c.receive(changed);
    assert(c.state==='scanning'&&!c.scan.objects.length,'persistent camera movement triggers automatic rescan');
    await until(()=>c.state==='active','automatic rescan completes');
    const furniture={...fixture({table:false}),source:'third',generation:c.generation,type:'result'};
    for(const [x,y] of c.scan.surfaces[0].boundary){const i=y*furniture.width+x;furniture.depth[i]+=1;furniture.rgb[i]=0;}
    await c.receive(furniture);assert(!c.latest&&c.changedSince,'local furniture change invalidates support');
    c.changedSince=performance.now()-2600;await c.receive(furniture);
    assert(c.state==='scanning','persistent furniture change rescans');
    await until(()=>c.state==='active','furniture rescan completes');
    c.render();assert(c.canvas.width===video.videoWidth&&c.canvas.height===video.videoHeight,'renderer follows source dimensions');
    // A resumed tab needs fresh depth, but retains anchored placements while
    // unchanged-background alignment validates the room again.
    const visibility=Object.getOwnPropertyDescriptor(document,'hidden');
    const placed=JSON.stringify(c.scan.objects),priorGeneration=c.generation;
    Object.defineProperty(document,'hidden',{configurable:true,value:true});c.visibility();assert(!c.latest,'hidden tab clears depth');
    await c.receive({...fixture(),source:'third',generation:c.generation,type:'result'});
    assert(!c.latest&&!c.touchEvents.length,'hidden tab ignores late depth and contacts');
    Object.defineProperty(document,'hidden',{configurable:true,value:false});c.visibility();
    assert(c.state==='active'&&c.generation===priorGeneration&&JSON.stringify(c.scan.objects)===placed&&!c.latest,'window switch preserves anchors and waits for fresh validation');
    if(visibility)Object.defineProperty(document,'hidden',visibility);else delete document.hidden;
    await until(()=>c.latest,'fresh validation after window switch');
    c.onStatus=()=>{};c.worker.onerror({message:'injected worker loss'});assert(c.state==='failed'&&!c.worker&&!c.renderer,'worker failure releases resources');
    invalid=true;starting=c.start(video,'empty');await starting;assert(c.state==='empty'&&!c.scan.objects.length&&c.message==='No suitable surface found.','no surfaces starts without placements');
    const gen=c.generation;c.nextRetry=performance.now()-1;c.baselineUntil=0;c.tick();assert(c.generation>gen&&c.state==='scanning','bounded retry');
    c.stop();invalid=false;starting=c.start(video,'context-loss');await starting;
    c.renderer.canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));assert(c.state==='failed'&&!c.worker,'GPU/context loss falls back');
    starting=c.start(video,'mask-loss');await starting;
    c.copyPerson({width:4,height:4,getAsFloat32Array(){throw new Error('Mask unavailable');}},performance.now());
    assert(c.state==='failed'&&!c.worker&&c.message.includes('Mask unavailable'),'mask failure stays within scene fallback');
    assert(maxPending===1,'queue stays bounded across lifecycle');
    return ['loading/scanning cancellation, restart, generations, bounded inference, stale/alignment suppression, mask ownership, camera-movement rescan, visibility return, no-surface retry, worker/context loss'];
  } finally {c.dispose();clearInterval(paint);video.srcObject.getTracks().forEach(t=>t.stop());video.pause();}
}
export async function runSceneRecordingTests() {
  const {Recorder}=await import('../web/live/recorder.js'),T=await import('../web/live/vendor/scene/three/three.module.js');
  const r=new SceneRenderer(T),canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
  const g=canvas.getContext('2d');g.fillStyle='#16325c';g.fillRect(0,0,320,240);
  const video=document.createElement('video');video.muted=true;video.srcObject=canvas.captureStream(30);await video.play();
  const paint=setInterval(()=>g.fillRect(0,0,1,1),30),overlay=document.createElement('canvas');overlay.width=320;overlay.height=240;
  r.setScan({objects:[{id:0,shape:'cube',size:1,support:[-.7,-.5,-3],normal:[0,1,0]}]});
  const depth=new Float32Array(160*120).fill(.2);
  for(let y=0;y<60;y++)for(let x=0;x<160;x++)depth[y*160+x]=1;
  r.setDepth(depth,160,120);
  const ctx=new AudioContext(),dest=ctx.createMediaStreamDestination(),osc=ctx.createOscillator();osc.connect(dest);osc.start();await ctx.resume();
  const recorder=new Recorder();let draws=0;
  try {
    const scratch=document.createElement('canvas');scratch.width=320;scratch.height=240;const sg=scratch.getContext('2d');
    sg.drawImage(r.render(320,240,[true],1100),0,0);const idle=sg.getImageData(0,0,320,240).data;
    r.touch({object_id:0,position:[-.7,-.45,-2.6],effect_timestamp_ms:1000});
    sg.clearRect(0,0,320,240);sg.drawImage(r.render(320,240,[true],1100),0,0);const burst=sg.getImageData(0,0,320,240).data;
    const sparks=[];for(let y=125;y<235;y++)for(let x=0;x<320;x++){
      const i=(y*320+x)*4;if(idle[i+3]<10&&burst[i+3]>60&&burst[i]>100)sparks.push([319-x,y]);
    }
    assert(sparks.length>10,'recording fixture has visible effects outside core');
    const configuration={source:{id:'test'},scene:{enabled:true,touch:{enabled:true,...TOUCH_SETTINGS},scan:{objects:[{shape:'cube'}]}}};
    await recorder.start({engine:{recordStream:()=>dest.stream},video,overlay,mirror:()=>true,label:()=>['','','white'],configuration,
      sceneLayer:()=>{draws++;return r.render(320,240,[true],1100);}});
    recorder.observe({nowMs:performance.now(),configuration,pose:null,analysis:{scene_touch_events:[{object_id:0,part:'left foot',timestamp_s:0,approximate:true}]}});
    await wait(550);
    const saved=await recorder.stop(),files=window.fflate.unzipSync(new Uint8Array(await(await fetch(saved.url)).arrayBuffer()));
    const manifest=JSON.parse(new TextDecoder().decode(files['manifest.json']));
    assert(manifest.configurations[0].settings.scene.scan.objects[0].shape==='cube','additive scene metadata');
    assert(manifest.configurations[0].settings.scene.touch.enabled,'touch settings saved');
    const observation=JSON.parse(new TextDecoder().decode(files['observations.jsonl']).trim());
    assert(observation.analysis.scene_touch_events[0].part==='left foot','touch event metadata survives packaging');
    const playback=document.createElement('video');playback.muted=true;const url=URL.createObjectURL(new Blob([files[manifest.artifacts.media.path]],{type:manifest.media.mime_type}));playback.src=url;await playback.play();await wait(120);
    const out=document.createElement('canvas');out.width=320;out.height=240;const og=out.getContext('2d');og.drawImage(playback,0,0);
    // The cube left of centre is mirrored right. Its top half is behind real
    // foreground depth; only its lower half should survive encoded playback.
    const top=og.getImageData(205,100,1,1).data,bottom=og.getImageData(205,140,1,1).data,left=og.getImageData(115,140,1,1).data;
    assert(bottom[0]>100&&bottom[0]>top[0]+50&&bottom[0]>left[0]+50,'recorded pixels preserve mirroring and split depth ordering');
    const visibleSparks=sparks.filter(([x,y])=>og.getImageData(x,y,1,1).data[0]>55).length;
    assert(visibleSparks>sparks.length*.5,'mirrored particle/ripple pixels survive video encoding');
    assert(draws>3,'scene rendered fresh at each recorder composition');
    playback.pause();URL.revokeObjectURL(url);recorder.releaseDownloads();
    return ['decoded recording preserves mirrored objects, touch particles/ripple and depth ordering; additive touch settings/events; fresh scene layer per composition'];
  } finally {r.dispose();clearInterval(paint);video.srcObject.getTracks().forEach(t=>t.stop());video.pause();osc.stop();await ctx.close();}
}

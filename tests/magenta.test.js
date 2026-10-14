import {MagentaSpatial,inverseWeights,capturePlacement} from '../web/live/magenta-spatial.js';
import {MagentaScene,listeningGains,settings} from '../web/live/magenta.js';
import {project} from '../web/live/scene/geometry.js';
import {dragFixture} from './scene-drag.test.js';
const assert=(value,message)=>{if(!value)throw new Error(message);};
const near=(a,b)=>Math.abs(a-b)<1e-6;
export function frame(point,timestamp){
  const width=160,height=120,[x,y]=project(point,width,height),mask=new Float32Array(width*height),inverse=new Float32Array(width*height).fill(.1);
  for(let yy=Math.round(y)-3;yy<=Math.round(y)+3;yy++)for(let xx=Math.round(x)-3;xx<=Math.round(x)+3;xx++)if(xx>=0&&xx<width&&yy>=0&&yy<height){mask[yy*width+xx]=1;inverse[yy*width+xx]=-1/point[2];}
  const pose={timestamp,points:[{joint:23,part:'hip',x:(x+.5)/width,y:(y+.5)/height}]};
  return {latest:{timestamp,width,height,inverse,person:{width,height,data:mask},aligned:true,touchPose:pose},currentTouchPose:pose};
}
export async function runMagentaTests(){
  let weights=inverseWeights([.1,1,2],[1,1,1]);
  assert(weights[0]>weights[1]&&weights[1]>weights[2]&&near(weights.reduce((a,b)=>a+b,0),1),'inverse-square weights decrease with distance and normalize');
  assert(near(inverseWeights([0,.1],[1,1])[0],.5),'distance floor is 30% of median size');
  const a={id:0,shape:'sphere',normal:[0,1,0],size:.4,position:[-.6,0,-3]},b={...a,id:1,position:[.6,0,-3]};
  const scene={state:'active',scan:{objects:[a,b]},...frame(a.position,100)};
  const spatial=new MagentaSpatial();spatial.update(scene,100);
  assert(spatial.weights[0]>spatial.weights[1]&&spatial.weights[2]===0,'nearest hip and foreground points steer only placed prompts');
  const before=[...spatial.weights];spatial.update(scene,500);
  assert(before.every((v,i)=>v===spatial.weights[i]),'stale depth freezes weights');
  Object.assign(scene,frame(b.position,550));spatial.update(scene,550);
  assert(spatial.weights[0]>0&&spatial.weights[1]>0&&near(spatial.weights[0]+spatial.weights[1],1),'smoothing preserves normalization');
  scene.state='scanning';scene.scan.objects=[];const scanning=[...spatial.weights];spatial.update(scene,600);
  assert(scanning.every((v,i)=>v===spatial.weights[i]),'rescan retains last blend');
  scene.state='empty';spatial.update(scene,650);assert(spatial.weights.every(v=>near(v,1/3)),'no placements gives an equal sidebar blend');
  scene.state='active';scene.scan.objects=[b];scene.latest=null;spatial.update(scene,700);
  assert(spatial.weights[1]===1,'after scanning, unplaced prompts leave the blend even before fresh depth');
  const capture={...a,id:3,capture:true};scene.scan.objects=[b,capture];
  const contact=new MagentaSpatial();
  Object.assign(scene,frame(a.position,800));assert(!contact.update(scene,800),'capture waits for confirmed contact');
  Object.assign(scene,frame(a.position,850));assert(contact.update(scene,850),'confirmed whole-body contact captures');
  contact.busy=true;Object.assign(scene,frame(a.position,1000));assert(!contact.update(scene,1000),'holding contact does not repeat');
  contact.captured();Object.assign(scene,frame(a.position,1100));assert(!contact.update(scene,1100),'completion still requires release');
  for(const now of [1200,1350]){Object.assign(scene,frame(b.position,now));contact.update(scene,now);}
  Object.assign(scene,frame(a.position,1400));contact.update(scene,1400);Object.assign(scene,frame(a.position,1450));assert(contact.update(scene,1450),'release and re-entry allow the next capture');
  scene.drag={original:{id:3}};Object.assign(scene,frame(a.position,1500));assert(!contact.update(scene,1500),'drag never captures');
  const scan=dragFixture(),original=JSON.stringify(scan.objects),fourth=capturePlacement(scan,null);
  assert(fourth?.capture&&Math.abs(fourth.position[2]-scan.objects[0].position[2])<1,'fourth object fits a safe footprint near the prompt depth');
  assert(!capturePlacement(scan,{person:{width:160,height:120,data:new Float32Array(160*120).fill(1)}}),'person-covered placements leave the sidebar action available');
  assert(JSON.stringify(scan.objects)===original,'fourth placement search preserves the three prompt placements');
  assert(capturePlacement({objects:[],surfaces:[]},null)===null,'no surfaces leaves the capture button available');
  const s=settings({input:'invalid',model:'invalid',influence:999,blend:-4});assert(s.input==='audio-notes'&&s.model==='auto'&&s.influence===100&&s.blend===0,'invalid saved preferences are bounded');
  for(let blend=0;blend<=100;blend+=10){const [x,y]=listeningGains({...s,blend});assert(near(x*x+y*y,1),'blend is equal power');}
  const calls=[],notes=Object.assign(Object.create(MagentaScene.prototype),{active:true,settings:{input:'audio-notes'},owners:new Map(),send:e=>calls.push(e),record:()=>{}});
  notes.note({owner:'pad',note:60,on:true});notes.note({owner:'pluck',note:60,on:true});notes.note({owner:'pad',note:60,on:false});
  assert(calls.length===1&&calls[0].on,'overlapping owners retain a held MIDI note');
  notes.note({owner:'pluck',note:60,on:false});assert(calls.length===2&&!calls[1].on,'last owner releases MIDI note');
  notes.note({owner:'pad',note:60,on:true});notes.note({owner:'pluck',note:60,on:true,attack:true});
  assert(calls.at(-1).on&&calls.at(-1).attack,'an explicit attack retriggers a pitch already held by another owner');
  notes.note({owner:'pluck',note:60,on:false});assert(calls.at(-1).on,'attack release does not turn off the other owner');
  const modelChanges=[],failures=[];
  const fallback=Object.assign(Object.create(MagentaScene.prototype),{active:true,effective:'base',settings:{model:'auto'},record:()=>{},mix:()=>{},release:()=>{},status:()=>{},
    connect:model=>{modelChanges.push(model);fallback.effective=model;return Promise.resolve();},fail:message=>failures.push(message)});
  fallback.fallback('slow pose');await Promise.resolve();await Promise.resolve();
  fallback.fallback('Small also slow');
  assert(modelChanges.join()==='small'&&failures.length===1&&failures[0].includes('original'),'Auto switches once to Small, then keeps original music available');
  return ['distance floor, monotonicity, normalization, smoothing, hip/foreground distance, stale depth, rescan/empty placements, confirmed capture and hold/release, drag suppression, placement preservation, settings, equal-power mix and overlapping MIDI ownership'];
}

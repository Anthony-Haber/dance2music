// Camera depth supplies room Z; pose supplies responsive image-space motion.
// Body-relative MediaPipe Z is never compared with room geometry.
import {basis,dot,ray,project} from './geometry.js';
import {contactParts} from './instruments.js';
import {pianoCorners} from './piano-layout.js';
export const TOUCH_SETTINGS=Object.freeze({version:3,parts:['hands','feet'],max_depth_age_ms:200,
  pose_age_ms:120,confirm_ms:25,release_ms:120,cooldown_ms:320,particles_per_object:56,
  burst_duration_ms:1800,min_particle_pixels:7,
  depth_tolerance_fraction:.15,sound:'current-chord',sound_layer:'objects'});
const JOINTS=[[15,'left hand',13],[19,'left hand',15],[16,'right hand',14],[20,'right hand',16],
  [27,'left foot',25],[29,'left foot',27],[31,'left foot',27],
  [28,'right foot',26],[30,'right foot',28],[32,'right foot',28]];
const BODY_JOINTS=[[0,'head',11],[7,'head',0],[8,'head',0],[11,'left shoulder',12],[12,'right shoulder',11],
  [13,'left elbow',11],[14,'right elbow',12],[23,'left hip',24],[24,'right hip',23],[25,'left knee',23],[26,'right knee',24]];
const SEGMENTS=[[11,13,'left arm'],[13,15,'left arm'],[12,14,'right arm'],[14,16,'right arm'],
  [23,25,'left leg'],[25,27,'left leg'],[24,26,'right leg'],[26,28,'right leg'],
  [11,23,'torso'],[12,24,'torso'],[11,24,'torso'],[12,23,'torso'],[11,12,'torso'],[23,24,'torso']];
export function touchPose(landmarks,timestamp,wholeBody=false) {
  const valid=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1&&
    (p.visibility??0)>=.5&&(p.presence??1)>=.5;
  const points=(wholeBody?[...JOINTS,...BODY_JOINTS]:JOINTS).flatMap(([joint,part,parent])=>{
    const p=landmarks?.[joint],anchor=landmarks?.[parent];
    return valid(p)?[{joint,part,x:p.x,y:p.y,anchor:valid(anchor)?{x:anchor.x,y:anchor.y}:null}]:[];
  });
  if(wholeBody)SEGMENTS.forEach(([a,b,part],i)=>{
    if(!valid(landmarks?.[a])||!valid(landmarks?.[b]))return;
    for(let step=1;step<=3;step++){
      const t=step/4,x=landmarks[a].x*(1-t)+landmarks[b].x*t,y=landmarks[a].y*(1-t)+landmarks[b].y*t;
      points.push({joint:`segment-${i}-${step}`,part,x,y});
    }
  });
  return {timestamp,points};
}
export function distanceToObject(point,object) {
  const [u,v]=basis(object.normal),d=point.map((x,i)=>x-object.position[i]);
  const local=[dot(d,u),dot(d,object.normal),dot(d,v)],r=object.size/2;
  if(object.shape==='sphere')return Math.max(0,Math.hypot(...local)-r);
  if(object.shape==='cylinder')return Math.hypot(Math.max(0,Math.hypot(local[0],local[2])-r),Math.max(0,Math.abs(local[1])-r));
  return Math.hypot(...local.map(x=>Math.max(0,Math.abs(x)-r)));
}
export function touchDepth(p,depth) {
  const {width:w,height:h,inverse,person}=depth;
  if(!person)return null;
  // Sample just inside a fingertip/shoe silhouette, toward its wrist/ankle.
  // Foreground-only medians tolerate isolated boundary depth outliers.
  const x=p.x*w-.5,y=p.y*h-.5,samples=[];
  const ax=p.anchor?(p.anchor.x-p.x)*w:0,ay=p.anchor?(p.anchor.y-p.y)*h:0,n=Math.hypot(ax,ay)||1;
  const cx=x+ax/n*Math.min(2,n*.2),cy=y+ay/n*Math.min(2,n*.2);
  for(let yy=Math.max(0,Math.floor(cy)-3);yy<=Math.min(h-1,Math.ceil(cy)+3);yy++)
    for(let xx=Math.max(0,Math.floor(cx)-3);xx<=Math.min(w-1,Math.ceil(cx)+3);xx++) {
      const distance=Math.hypot(xx-x,yy-y);if(distance>4)continue;
      const mask=person.data[Math.min(person.height-1,Math.floor((yy+.5)*person.height/h))*person.width+
        Math.min(person.width-1,Math.floor((xx+.5)*person.width/w))],inv=inverse[yy*w+xx];
      if(mask>=.55&&Number.isFinite(inv)&&inv>.01)samples.push({z:1/inv,distance});
    }
  samples.sort((a,b)=>a.distance-b.distance);
  const values=samples.slice(0,9).map(s=>s.z).sort((a,b)=>a-b);
  if(values.length<2)return null;
  const z=values[Math.floor(values.length/2)],consistent=values.filter(v=>Math.abs(v-z)<=z*.12);
  if(consistent.length<2||consistent.length<values.length*.65)return null;
  return consistent[Math.floor(consistent.length/2)];
}
export function touchBounds(object,w,h) {
  if(object.shape==='keyboard'){
    const points=pianoCorners(object).map(p=>project(p,w,h));
    return {left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1]))};
  }
  const [u,v]=basis(object.normal),points=[];
  for(const a of [-.5,.5])for(const b of [-.5,.5])for(const c of [-.5,.5])
    points.push(project(object.position.map((p,i)=>p+object.size*(a*u[i]+b*object.normal[i]+c*v[i])),w,h));
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  return {left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)};
}
function overlap(p,box,w,h,padding=0) {
  const x=p.x*w-.5,y=p.y*h-.5;
  return x>=box.left-padding&&x<=box.right+padding&&y>=box.top-padding&&y<=box.bottom+padding;
}
function crosses(a,b,box,w,h,padding) {
  const length=Math.hypot((a.x-b.x)*w,(a.y-b.y)*h),steps=Math.min(24,Math.ceil(length)+1);
  for(let i=0;i<=steps;i++)if(overlap({x:a.x+(b.x-a.x)*i/steps,y:a.y+(b.y-a.y)*i/steps},box,w,h,padding))return true;
  return false;
}
export class TouchInteractions {
  constructor(){this.enabled=true;this.reset();}
  reset(){this.states=new Map();this.anchors=new Map();this.previous=null;this.depth=null;this.lastTimestamp=-Infinity;this.count=0;this.reason='Waiting for hands or feet';this.points=[];}
  update(objects,depth,captured,current,now) {
    if(!depth?.aligned||!Number.isFinite(depth.timestamp)||now-depth.timestamp<0||now-depth.timestamp>TOUCH_SETTINGS.max_depth_age_ms||
      !captured||!Number.isFinite(captured.timestamp)||Math.abs(depth.timestamp-captured.timestamp)>TOUCH_SETTINGS.pose_age_ms||
      depth.timestamp<=this.lastTimestamp)return [];
    this.lastTimestamp=depth.timestamp;this.depth={timestamp:depth.timestamp,width:depth.width,height:depth.height};this.anchors.clear();
    for(const p of captured.points){const z=touchDepth(p,depth);if(z)this.anchors.set(p.joint,{...p,z,timestamp:depth.timestamp});}
    return this.observe(objects,current,now);
  }
  observe(objects,current,now) {
    if(!this.enabled)return [];
    const d=this.depth;
    if(!d||now-d.timestamp>TOUCH_SETTINGS.max_depth_age_ms){this.reason='Waiting for fresh depth';this.points=[];return [];}
    if(!current||!Number.isFinite(current.timestamp)||now-current.timestamp<0||now-current.timestamp>TOUCH_SETTINGS.pose_age_ms||!current.points.length){
      this.reason='No visible hands or feet';this.points=[];this.previous=null;return [];
    }
    const {width:w,height:h}=d,points=[];
    for(const p of current.points){
      const a=this.anchors.get(p.joint);if(!a)continue;
      // Reuse fresh foreground depth over a small motion between depth frames.
      if(Math.hypot((p.x-a.x)*w,(p.y-a.y)*h)>Math.max(12,w*.09))continue;
      points.push({...p,z:a.z,position:ray(p.x*w-.5,p.y*h-.5,w,h).map(v=>v*a.z)});
    }
    this.points=points;this.reason=points.length?'Move a hand or foot into a shape':'Hand/foot depth uncertain';
    const events=[],previous=this.previous&&current.timestamp-this.previous.timestamp<=120?this.previous:null;
    for(const object of objects) {
      let s=this.states.get(object.id);
      if(!s){s={active:false,since:null,lastHit:-Infinity,lastNear:-Infinity,lastSample:-Infinity,proximity:0};this.states.set(object.id,s);}
      if(current.timestamp-s.lastSample>250){s.since=null;s.active=false;}
      s.lastSample=current.timestamp;s.proximity=0;
      const box=touchBounds(object,w,h),padding=Math.max(2,w*.012),z=-object.position[2];
      const band=object.size*.65+z*TOUCH_SETTINGS.depth_tolerance_fraction;
      let contact=null,swept=false;
      for(const p of points) {
        if(Math.abs(p.z-z)>band){if(overlap(p,box,w,h,padding))this.reason='Hand/foot is in front of or behind the shape';continue;}
        const old=previous?.points.find(q=>q.joint===p.joint);
        const inside=overlap(p,box,w,h,padding*(s.active?1.4:1));
        const crossed=old&&!overlap(old,box,w,h,padding)&&crosses(old,p,box,w,h,padding);
        s.proximity=Math.max(s.proximity,Math.max(0,1-distanceToObject(p.position,object)/(object.size*2+z*.15)));
        if(inside||crossed){contact=p;swept=!!crossed;break;}
      }
      if(contact) {
        this.reason='Contact detected';s.lastNear=current.timestamp;
        if(s.since===null)s.since=current.timestamp;
        if(!s.active&&(swept||current.timestamp-s.since>=TOUCH_SETTINGS.confirm_ms)&&now-s.lastHit>=TOUCH_SETTINGS.cooldown_ms) {
          s.active=true;s.lastHit=now;this.count++;
          events.push({type:'touch',object_id:object.id,shape:object.shape,part:contact.part,position:contact.position,x:contact.x,
            timestamp_ms:current.timestamp,depth_timestamp_ms:d.timestamp,effect_timestamp_ms:now,approximate:true});
        }
      }else {s.since=null;if(current.timestamp-s.lastNear>=TOUCH_SETTINGS.release_ms)s.active=false;}
    }
    this.previous={timestamp:current.timestamp,points:points.map(({joint,x,y})=>({joint,x,y}))};
    return events;
  }
  visual(now) {
    if(!this.enabled)return [];
    return Array.from(this.states,([id,s])=>({id,active:s.active&&now-s.lastNear<=TOUCH_SETTINGS.max_depth_age_ms,
      proximity:now-s.lastSample<=TOUCH_SETTINGS.max_depth_age_ms?s.proximity:0}));
  }
}

export const PERCUSSION_TOUCH_SETTINGS=Object.freeze({...TOUCH_SETTINGS,version:2,parts:['whole body'],
  confirm_ms:0,cooldown_ms:120,retrigger_confirm_ms:25,retrigger_travel_fraction:.08,
  retrigger_pixels:6,retrigger_return_fraction:.4,preview_width:640,
  sound:'synthesized-percussion',contact:'component-volumes',retrigger:'limb-pullback-and-return'});

export function instrumentDistance(point,object) {
  const [u,v]=basis(object.normal),d=point.map((p,i)=>(p-object.support[i])/object.size);
  const local=[dot(d,u),dot(d,object.normal),-dot(d,v)];
  let distance=Infinity;
  for(const p of contactParts(object.instrument)) {
    let q=local.map((x,i)=>x-p.position[i]),value;const dims=p.dimensions;
    const angle=p.rotation[0],c=Math.cos(angle),s=Math.sin(angle);
    q=[q[0],c*q[1]+s*q[2],-s*q[1]+c*q[2]];
    if(p.type==='rod') {
      const [a,b,r]=dims,ab=b.map((x,i)=>x-a[i]),aq=local.map((x,i)=>x-a[i]);
      const t=Math.max(0,Math.min(1,dot(aq,ab)/dot(ab,ab)));
      value=Math.max(0,Math.hypot(...aq.map((x,i)=>x-ab[i]*t))-r);
    }else if(p.type==='cylinder') {
      // Current drums only rotate about X (upright shells or forward kick).
      const t=Math.max(0,Math.min(1,q[1]/dims[2]+.5)),radius=dims[1]*(1-t)+dims[0]*t;
      value=Math.hypot(Math.max(0,Math.hypot(q[0],q[2])-radius),Math.max(0,Math.abs(q[1])-dims[2]/2));
    }else {
      const half=p.type==='bell'?[.22,.19,.29]:dims.map(x=>x/2);
      value=Math.hypot(...q.map((x,i)=>Math.max(0,Math.abs(x)-half[i])));
    }
    distance=Math.min(distance,value*object.size);
  }
  return distance;
}
const bodyTolerance=o=>Math.min(o.size*.3,o.size*.08+(-o.position[2])*.025);

// Follow one stable landmark per limb: a wrist and fingertip (or ankle and toe)
// belong to the same stroke. Other body overlap must not hold a tapping limb off.
function strokeLimb(part) {
  const side=part.startsWith('left ')?'left':part.startsWith('right ')?'right':null;
  if(side&&/hand|arm|elbow|shoulder/.test(part))return side+' arm';
  if(side&&/foot|leg|knee|hip/.test(part))return side+' leg';
  return part;
}
function strokePoints(points,strokes) {
  const groups=new Map(),rank=p=>/hand|foot/.test(p.part)?0:/elbow|knee/.test(p.part)?1:2;
  for(const p of points){const limb=strokeLimb(p.part),old=groups.get(limb),joint=strokes.get(limb)?.joint;
    if(!old||p.joint===joint||(old.joint!==joint&&rank(p)<rank(old)))groups.set(limb,p);
  }
  return groups;
}
function percussionStroke(strokes,limb,p,inside,object,depth,timestamp) {
  const settings=PERCUSSION_TOUCH_SETTINGS;
  const pixels=(a,b)=>Math.hypot((a.x-b.x)*depth.width,(a.y-b.y)*depth.height)*settings.preview_width/depth.width;
  const distance=(a,b)=>Math.hypot(...a.position.map((v,i)=>v-b.position[i]));
  const travel=object.size*settings.retrigger_travel_fraction;
  const moved=(a,b)=>distance(a,b)>=travel&&pixels(a,b)>=settings.retrigger_pixels;
  let s=strokes.get(limb);
  if(!s||s.joint!==p.joint||timestamp-s.timestamp>settings.pose_age_ms){
    strokes.set(limb,{joint:p.joint,origin:p,contacted:inside,timestamp,start:timestamp,retreat:null,peak:null});return false;
  }
  if(timestamp<=s.timestamp)return false;
  s.timestamp=timestamp;
  if(!s.contacted){
    // A second limb may approach while the first remains resting on the drum.
    const hit=inside&&timestamp-s.start>=settings.retrigger_confirm_ms&&moved(p,s.origin);
    if(inside){s.origin=p;s.contacted=true;s.retreat=null;s.peak=null;}
    return hit;
  }
  if(!s.peak){
    if(moved(p,s.origin)){
      s.retreat??=timestamp;
      if(timestamp-s.retreat>=settings.retrigger_confirm_ms)s.peak=p;
    }else s.retreat=null;
    return false;
  }
  if(distance(p,s.origin)>distance(s.peak,s.origin))s.peak=p;
  // The visible limb must return near its previous contact, inside an actual
  // component. Depth wobble alone, a single outlier, or resting at the lifted
  // position cannot strike. No full-volume exit or 120 ms absence is required.
  if(inside&&distance(p,s.origin)<=distance(s.peak,s.origin)*settings.retrigger_return_fraction&&moved(p,s.peak)){
    s.origin=p;s.retreat=null;s.peak=null;return true;
  }
  return false;
}

// Whole-person foreground samples complement the pose skeleton. Work is bounded
// to roughly 300 candidates per instrument, only when a new depth result arrives.
export function bodyContact(object,depth,pose) {
  if(!depth.person)return null;
  const {width:w,height:h,inverse}=depth,b=touchBounds(object,w,h),tolerance=bodyTolerance(object);
  const left=Math.max(0,Math.floor(b.left)),right=Math.min(w-1,Math.ceil(b.right));
  const top=Math.max(0,Math.floor(b.top)),bottom=Math.min(h-1,Math.ceil(b.bottom));
  const stride=Math.max(1,Math.ceil(Math.sqrt((right-left+1)*(bottom-top+1)/256)));
  for(let y=top;y<=bottom;y+=stride)for(let x=left;x<=right;x+=stride) {
    const inv=inverse[y*w+x];if(!(inv>.01))continue;
    const pixel={x:(x+.5)/w,y:(y+.5)/h};
    const raw=ray(x,y,w,h).map(n=>n/inv);
    if(instrumentDistance(raw,object)>tolerance)continue;
    const z=touchDepth(pixel,depth);if(!z)continue;
    const position=ray(x,y,w,h).map(n=>n*z);
    if(instrumentDistance(position,object)>tolerance)continue;
    let part='body',nearest=Infinity;
    for(const p of pose?.points||[]){const d=Math.hypot((p.x-pixel.x)*w,(p.y-pixel.y)*h);if(d<nearest){nearest=d;part=p.part;}}
    return {...pixel,position,z,part:nearest<Math.max(6,w*.06)?part:'body'};
  }
  return null;
}
export class BodyInteractions extends TouchInteractions {
  reset(){super.reset();this.body=new Map();this.reason='Waiting for body contact';}
  update(objects,depth,captured,current,now) {
    if(!depth?.aligned||!Number.isFinite(depth.timestamp)||now-depth.timestamp<0||now-depth.timestamp>200||depth.timestamp<=this.lastTimestamp)return [];
    this.lastTimestamp=depth.timestamp;this.depth={timestamp:depth.timestamp,width:depth.width,height:depth.height};this.anchors.clear();this.body.clear();
    const pose=captured&&Math.abs(depth.timestamp-captured.timestamp)<=120?captured:null;
    for(const p of pose?.points||[]){const z=touchDepth(p,depth);if(z)this.anchors.set(p.joint,{...p,z});}
    for(const o of objects){const p=bodyContact(o,depth,pose);if(p)this.body.set(o.id,p);}
    return this.observe(objects,current,now);
  }
  observe(objects,current,now) {
    if(!this.enabled)return [];
    const d=this.depth;
    if(!d||now<d.timestamp||now-d.timestamp>200){
      for(const s of this.states.values())s.strokes?.clear();
      this.points=[];this.previous=null;this.reason='Waiting for fresh depth';return [];
    }
    const fresh=current&&Number.isFinite(current.timestamp)&&now>=current.timestamp&&now-current.timestamp<=120;
    const points=[],w=d.width,h=d.height;
    for(const p of fresh?current.points:[]){
      const a=this.anchors.get(p.joint);if(!a||Math.hypot((p.x-a.x)*w,(p.y-a.y)*h)>Math.max(12,w*.09))continue;
      points.push({...p,z:a.z,position:ray(p.x*w-.5,p.y*h-.5,w,h).map(n=>n*a.z)});
    }
    this.points=points;this.reason='Move into an instrument';const events=[];
    const previous=this.previous&&fresh&&current.timestamp>this.previous.timestamp&&current.timestamp-this.previous.timestamp<=120?this.previous:null;
    for(const object of objects){
      let s=this.states.get(object.id);
      if(!s){s={active:false,lastHit:-Infinity,lastNear:-Infinity,lastSample:-Infinity,proximity:0,strokes:new Map()};this.states.set(object.id,s);}
      s.lastSample=now;s.proximity=0;
      const tolerance=bodyTolerance(object),box=touchBounds(object,w,h),padding=3;
      let contact=now-d.timestamp<=120?this.body.get(object.id):null,repeat=null;
      for(const [limb,stroke] of s.strokes)if(now-stroke.timestamp>120)s.strokes.delete(limb);
      for(const [limb,p] of strokePoints(points,s.strokes)){
        const inside=instrumentDistance(p.position,object)<=tolerance;
        if(percussionStroke(s.strokes,limb,p,inside,object,d,current.timestamp))repeat=p;
      }
      for(const p of points){
        const old=previous?.points.find(q=>q.joint===p.joint);
        if(!overlap(p,box,w,h,padding)&&(!old||!crosses(old,p,box,w,h,padding)))continue;
        if(Math.abs(p.z+object.position[2])>object.size+tolerance&&(!old||Math.abs(old.z+object.position[2])>object.size+tolerance))continue;
        const distance=instrumentDistance(p.position,object);
        s.proximity=Math.max(s.proximity,Math.max(0,1-distance/(object.size*.5)));
        if(distance<=tolerance){contact=p;break;}
        if(old)for(let i=1;i<12;i++){
          const position=old.position.map((x,j)=>x+(p.position[j]-x)*i/12);
          if(instrumentDistance(position,object)<=tolerance){contact={...p,position};break;}
        }
        if(contact)break;
      }
      if(repeat)contact=repeat;
      if(contact){
        this.reason=`Contact: ${contact.part}`;s.lastNear=now;
        if((!s.active||repeat)&&now-s.lastHit>=PERCUSSION_TOUCH_SETTINGS.cooldown_ms){
          s.active=true;s.lastHit=now;this.count++;
          events.push({type:'touch',object_id:object.id,shape:object.shape,instrument:object.instrument,part:contact.part,
            position:contact.position,x:contact.x,timestamp_ms:fresh?current.timestamp:d.timestamp,
            depth_timestamp_ms:d.timestamp,effect_timestamp_ms:now,approximate:true,reason:repeat?'repeated-strike':'contact'});
        }
      }else if(now-s.lastNear>=120)s.active=false;
    }
    this.previous=fresh?{timestamp:current.timestamp,points}:null;
    return events;
  }
}

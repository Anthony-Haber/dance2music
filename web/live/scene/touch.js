// Camera depth supplies room Z; pose supplies responsive image-space motion.
// Body-relative MediaPipe Z is never compared with room geometry.
import {basis,dot,ray,project} from './geometry.js';
export const TOUCH_SETTINGS=Object.freeze({version:3,parts:['hands','feet'],max_depth_age_ms:200,
  pose_age_ms:120,confirm_ms:25,release_ms:120,cooldown_ms:320,particles_per_object:56,
  burst_duration_ms:1800,min_particle_pixels:7,
  depth_tolerance_fraction:.15,sound:'current-chord',sound_layer:'objects'});
const JOINTS=[[15,'left hand',13],[19,'left hand',15],[16,'right hand',14],[20,'right hand',16],
  [27,'left foot',25],[29,'left foot',27],[31,'left foot',27],
  [28,'right foot',26],[30,'right foot',28],[32,'right foot',28]];
export function touchPose(landmarks,timestamp) {
  const valid=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1&&
    (p.visibility??0)>=.5&&(p.presence??1)>=.5;
  return {timestamp,points:JOINTS.flatMap(([joint,part,parent])=>{
    const p=landmarks?.[joint],anchor=landmarks?.[parent];
    return valid(p)?[{joint,part,x:p.x,y:p.y,anchor:valid(anchor)?{x:anchor.x,y:anchor.y}:null}]:[];
  })};
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

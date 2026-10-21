import {touchPose,touchDepth,distanceToObject,touchBounds} from './scene/touch.js';
import {ray,project,supportPoint,footprintFits} from './scene/geometry.js';

export const PROMPT_COLORS=['#ee9e52','#65bde3','#c195e7'];
export const PROMPT_TRIOS=[
  ['warm electric piano','rounded funk bass','brushed percussion'],
  ['mellow jazz guitar','warm upright bass','soft brushed drums'],
  ['dreamy electric piano','deep mellow bass','gentle downtempo percussion'],
  ['soft marimba melody','rounded acoustic bass','light hand percussion'],
];
export const randomPrompts=()=>[...PROMPT_TRIOS[Math.floor(Math.random()*PROMPT_TRIOS.length)]];
export function inverseWeights(distances,sizes){
  if(!distances.length)return [1/3,1/3,1/3];
  const sorted=[...sizes].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);
  const median=sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
  const floor=Math.max(1e-4,median*.3),raw=distances.map(d=>1/Math.max(floor,d)**2),sum=raw.reduce((a,b)=>a+b,0);
  return raw.map(v=>v/sum);
}

// Add one action object using existing safe interiors without moving prompts.
export function capturePlacement(scan,depth){
  if(!scan.projection||!scan.objects.length)return null;
  const {width:w,height:h}=scan.projection;
  const size=[...scan.objects].sort((a,b)=>a.size-b.size)[Math.floor(scan.objects.length/2)].size;
  const z=[...scan.objects].sort((a,b)=>a.position[2]-b.position[2])[Math.floor(scan.objects.length/2)].position[2],focal=h/(2*Math.tan(Math.PI/6));
  for(const surface of scan.surfaces){
    const mask=new Uint8Array(w*h);
    for(const [start,length] of surface.runs||[])mask.fill(1,start,start+length);
    const candidates=[];
    for(const [start,length] of surface.runs||[])for(let i=start;i<start+length;i+=3){
      const support=supportPoint(i%w,Math.floor(i/w),surface.plane,w,h);
      if(support)candidates.push({i,support});
    }
    candidates.sort((a,b)=>Math.abs(a.support[2]-z)-Math.abs(b.support[2]-z));
    for(const {i,support} of candidates){
      if(size*focal/-support[2]<2.5||!footprintFits(support,size,surface.normal,mask,w,h))continue;
      if(scan.objects.some(o=>Math.hypot(...o.support.map((v,j)=>v-support[j]))<1.6*(o.size+size)))continue;
      const object={id:3,shape:'sphere',capture:true,color:'#79e4ad',surface:surface.id,support,
        position:support.map((p,j)=>p+surface.normal[j]*size/2),normal:surface.normal,size,point:[i%w,Math.floor(i/w)]};
      const center=project(object.position,w,h);
      if(scan.objects.some(o=>{const other=project(o.position,w,h);return Math.hypot(center[0]-other[0],center[1]-other[1])<focal*(size/-object.position[2]+o.size/-o.position[2]);}))continue;
      const box=touchBounds(object,w,h);
      if(box.left<0||box.right>=w||box.top<0||box.bottom>=h)continue;
      let blocked=false;
      if(depth?.person)for(let y=Math.floor(box.top);y<=box.bottom&&!blocked;y+=2)for(let x=Math.floor(box.left);x<=box.right;x+=2){
        const p=depth.person;
        if(p.data[Math.min(p.height-1,Math.floor(y*p.height/h))*p.width+Math.min(p.width-1,Math.floor(x*p.width/w))]>.3){blocked=true;break;}
      }
      if(!blocked)return object;
    }
  }
  return null;
}

export class MagentaSpatial {
  constructor(){this.weights=[1/3,1/3,1/3];this.last=0;this.depthTimestamp=-Infinity;this.points=[];this.contactSince=null;this.releaseSince=null;this.latched=false;this.busy=false;}
  captured(){this.busy=false;this.latched=true;this.releaseSince=null;}
  update(scene,now){
    if(scene.state==='scanning'||scene.state==='loading'){this.last=now;this.contactSince=this.releaseSince=null;return false;}
    const objects=scene.scan.objects.filter(o=>!o.capture);
    if(!objects.length){this.weights=[1/3,1/3,1/3];this.last=now;this.available=false;return false;}
    this.available=true;
    const active=new Set(objects.map(o=>o.id));
    this.weights=this.weights.map((v,i)=>active.has(i)?v:0);
    let retained=this.weights.reduce((a,b)=>a+b,0);
    this.weights=this.weights.map((v,i)=>retained?v/retained:active.has(i)?1/objects.length:0);
    const depth=scene.latest,pose=scene.currentTouchPose;
    if(!depth?.aligned||now<depth.timestamp||now-depth.timestamp>200||!pose||now-pose.timestamp>120||!pose.points.length){this.last=now;this.contactSince=this.releaseSince=null;return false;}
    if(this.depthTimestamp!==depth.timestamp){
      this.depthTimestamp=depth.timestamp;this.points=[];
      const source=depth.touchPose&&Math.abs(depth.touchPose.timestamp-depth.timestamp)<=120?depth.touchPose:pose;
      if(Math.abs(source.timestamp-depth.timestamp)<=120)for(const p of source.points){
        const z=touchDepth(p,depth);if(z)this.points.push(ray(p.x*depth.width-.5,p.y*depth.height-.5,depth.width,depth.height).map(v=>v*z));
      }
      // Foreground samples include visible body areas between landmarks. The
      // same robust foreground-only depth check rejects uncertain boundaries.
      const stride=Math.max(2,Math.ceil(Math.sqrt(depth.width*depth.height/256)));
      for(let y=0;y<depth.height;y+=stride)for(let x=0;x<depth.width;x+=stride){
        const z=touchDepth({x:(x+.5)/depth.width,y:(y+.5)/depth.height},depth);
        if(z)this.points.push(ray(x,y,depth.width,depth.height).map(v=>v*z));
      }
    }
    if(!this.points.length){this.last=now;return false;}
    const nearest=o=>Math.min(...this.points.map(p=>distanceToObject(p,o)));
    const normalized=inverseWeights(objects.map(nearest),objects.map(o=>o.size)),target=[0,0,0];
    objects.forEach((o,i)=>target[o.id]=normalized[i]);
    // Unplaced slots leave the blend immediately after a scan; smoothing is
    // confined to the successfully placed prompts and always normalized.
    this.weights=this.weights.map((v,i)=>active.has(i)?v:0);
    let sum=this.weights.reduce((a,b)=>a+b,0);
    if(!sum)this.weights=[...target];else this.weights=this.weights.map(v=>v/sum);
    const alpha=1-Math.exp(-Math.max(0,Math.min(100,now-this.last))/250);
    this.weights=this.weights.map((v,i)=>v+(target[i]-v)*alpha);this.last=now;
    const capture=scene.scan.objects.find(o=>o.capture);
    if(!capture){this.contactSince=null;return false;}
    if(scene.drag?.original.id===3){this.latched=true;this.contactSince=null;this.releaseSince=null;return false;}
    const touching=nearest(capture)<=Math.min(capture.size*.3,capture.size*.08+(-capture.position[2])*.025);
    if(touching){
      this.releaseSince=null;this.contactSince??=now;
      if(!this.busy&&!this.latched&&now-this.contactSince>=40){this.latched=true;return true;}
    }else{
      this.contactSince=null;
      if(!this.busy){this.releaseSince??=now;if(now-this.releaseSince>=120)this.latched=false;}
    }
    return false;
  }
}

export const wholeBodyPose=(landmarks,now)=>touchPose(landmarks,now,true);

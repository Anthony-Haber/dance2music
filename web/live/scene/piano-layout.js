import {basis,dot,project,ray,supportPoint} from './geometry.js';

// Keep black keys short so the long white fronts give feet a generous playing
// area. By default the black-key edge faces the camera, ahead of the player.
export const PIANO_DEPTH=.28;
const BLACK_DEPTH=.096;
const white=[60,62,64,65,67,69,71,72], black=[[61,1],[63,2],[66,4],[68,5],[70,6]];
const names=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
export const PIANO_KEYS=Object.freeze([
  // Source-camera coordinates: the player faces the camera, so low notes are
  // on camera-right. The mirrored preview presents C4 on the player's left.
  ...white.map((midi,i)=>({id:`piano-${midi}`,midi,label:names[midi%12]+Math.floor(midi/12-1),black:false,x:.5-(i+.5)/8,width:1/8,z:0,depth:PIANO_DEPTH})),
  ...black.map(([midi,i])=>({id:`piano-${midi}`,midi,label:names[midi%12]+'4',black:true,x:.5-i/8,width:.075,z:(PIANO_DEPTH-BLACK_DEPTH)/2,depth:BLACK_DEPTH})),
]);
const AWAY_KEYS=Object.freeze(PIANO_KEYS.map(key=>({...key,z:-key.z})));
export function orientPiano(scan,blackKeysNearCamera=true) {
  const keys=blackKeysNearCamera?PIANO_KEYS:AWAY_KEYS;
  return {...scan,objects:scan.objects.map(object=>object.shape==='keyboard'?{...object,keys,black_keys_near_camera:blackKeysNearCamera}:object),
    piano:{...scan.piano,keys,black_keys_near_camera:blackKeysNearCamera}};
}
export function pianoPoint(object,x,z,height=0) {
  const [u,v]=basis(object.normal);
  return object.support.map((p,i)=>p+object.size*(x*u[i]-z*v[i]+height*object.normal[i]));
}
export function pianoLocal(object,point) {
  const [u,v]=basis(object.normal),d=point.map((p,i)=>(p-object.support[i])/object.size);
  return [dot(d,u),dot(d,object.normal),-dot(d,v)];
}
export function pianoCorners(object) {return [[-.5,-PIANO_DEPTH/2],[.5,-PIANO_DEPTH/2],[.5,PIANO_DEPTH/2],[-.5,PIANO_DEPTH/2]].map(([x,z])=>pianoPoint(object,x,z));}
export function pianoFloorDepth(object,w,h) {
  const out=new Float32Array(w*h),[u,v]=basis(object.normal),plane=dot(object.normal,object.support);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const r=ray(x,y,w,h),distance=plane/dot(object.normal,r);
    if(!(distance>0))continue;
    const d=r.map((p,i)=>(p*distance-object.support[i])/object.size);
    if(Math.abs(dot(d,u))<=.5&&Math.abs(dot(d,v))<=PIANO_DEPTH/2)out[y*w+x]=1/distance;
  }
  return out;
}
export function pianoKeyAt(x,z,previous=null,keys=PIANO_KEYS) {
  const inside=(k,pad=0)=>Math.abs(x-k.x)<=k.width/2+pad&&Math.abs(z-k.z)<=k.depth/2+pad;
  const black=keys.find(k=>k.black&&inside(k));
  const old=keys.find(k=>k.id===previous);
  // A small band retains ownership across seams. Black keys win genuine overlap.
  if(old&&inside(old,.008)&&(!black||old.black||!inside(black,-.008)))return old;
  return black||keys.find(k=>!k.black&&inside(k))||null;
}
export function pianoKeyPixels(object,w,h) {
  return Math.min(...PIANO_KEYS.filter(k=>!k.black).flatMap(k=>[-PIANO_DEPTH/2,PIANO_DEPTH/2].map(z=>{
    const a=project(pianoPoint(object,k.x-k.width/2,z),w,h),b=project(pianoPoint(object,k.x+k.width/2,z),w,h);
    return Math.abs(a[0]-b[0])*640/w;
  })));
}
export function pianoDepthPixels(object,w,h) {
  return Math.min(...[-.5,.5].map(x=>{
    const a=project(pianoPoint(object,x,-PIANO_DEPTH/2),w,h),b=project(pianoPoint(object,x,PIANO_DEPTH/2),w,h);
    return Math.hypot(a[0]-b[0],a[1]-b[1])*640/w;
  }));
}
export function indexPianoMask(mask,w,h) {
  const sums=new Uint32Array((w+1)*(h+1));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y+1)*(w+1)+x+1;sums[i]=(!mask[y*w+x]?1:0)+sums[i-1]+sums[i-w-1]-sums[i-w-2];}
  mask.pianoEmptySums=sums;return mask;
}
// Test every image cell touched by the projected rectangle, including interior
// holes/person exclusions. Dense point samples alone can step over small holes.
export function pianoFits(object,mask,w,h) {
  const corners=pianoCorners(object);if(corners.some(p=>p[2]>=-.01))return false;
  const q=corners.map(p=>project(p,w,h)),xs=q.map(p=>p[0]),ys=q.map(p=>p[1]);
  const left=Math.floor(Math.min(...xs)),right=Math.ceil(Math.max(...xs)),top=Math.floor(Math.min(...ys)),bottom=Math.ceil(Math.max(...ys));
  if(left<0||right>=w||top<0||bottom>=h)return false;
  if(q.some(([x,y])=>!mask[Math.round(y)*w+Math.round(x)]))return false;
  const sums=mask.pianoEmptySums,stride=w+1;
  if(sums&&sums[(bottom+1)*stride+right+1]-sums[top*stride+right+1]-sums[(bottom+1)*stride+left]+sums[top*stride+left]===0)return true;
  const sign=Math.sign((q[1][0]-q[0][0])*(q[2][1]-q[1][1])-(q[1][1]-q[0][1])*(q[2][0]-q[1][0]));
  for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++) {
    if(mask[y*w+x])continue;
    const overlaps=q.every((a,i)=>{const b=q[(i+1)%4],dx=b[0]-a[0],dy=b[1]-a[1];
      return sign*(dx*(y-a[1])-dy*(x-a[0]))>=-(Math.abs(dx)+Math.abs(dy))*.5;
    });
    if(overlaps)return false;
  }
  return true;
}
export function pianoScan(scan,blackKeysNearCamera=true) {
  const {width:w,height:h}=scan.projection||{};let best=null,score=0;
  for(const surface of scan.surfaces) {
    if(surface.kind!=='floor'||!surface.runs?.length)continue;
    const mask=new Uint8Array(w*h);for(const [start,length] of surface.runs)mask.fill(1,start,start+length);indexPianoMask(mask,w,h);
    for(const [start,length] of surface.runs)for(let i=start;i<start+length;i++) {
      const support=supportPoint(i%w,Math.floor(i/w),surface.plane,w,h);if(!support)continue;
      const object={id:'floor-piano',shape:'keyboard',surface:surface.id,normal:surface.normal,support,position:support,point:[i%w,Math.floor(i/w)],size:0,keys:PIANO_KEYS};
      // Maximize projected playing area over all floor interiors. Area avoids
      // choosing a wide but edge-on sliver near the horizon.
      let lo=0,hi=-support[2]*3;
      for(let n=0;n<12;n++){object.size=(lo+hi)/2;if(pianoFits(object,mask,w,h))lo=object.size;else hi=object.size;}
      object.size=lo;if(!lo)continue;
      const pixels=pianoKeyPixels(object,w,h),area=pixels*pianoDepthPixels(object,w,h);
      if(pixels>=12&&area>score){score=area;best=object;}
    }
  }
  return orientPiano({...scan,objects:best?[best]:[],piano:{layout:'C4-C5',min_white_key_pixels:12,preview_width:640,
    placement_search:'largest projected playing area',white_key_pixels:best?pianoKeyPixels(best,w,h):0}},blackKeysNearCamera);
}
export function buildPiano(T,object) {
  const whiteLabelZ=PIANO_DEPTH*.3*(object.black_keys_near_camera===false?1:-1);
  return (object.keys||PIANO_KEYS).flatMap(key=>{
    const height=key.black?.035:.018,s=object.size;
    const mesh=new T.Mesh(new T.BoxGeometry((key.width-.002)*s,height*s,key.depth*s),new T.MeshStandardMaterial({color:key.black?0x151820:0xf4efe4,roughness:.6}));
    mesh.position.set(key.x*s,height*s/2,key.z*s);mesh.userData.pianoKey=key;
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;
    const ctx=canvas.getContext('2d');ctx.fillStyle=key.black?'#ffffff':'#171b24';ctx.font='bold 46px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(key.label,64,32);
    // Camera-facing glyphs stay readable at shallow floor angles. Their world
    // anchor and the shared depth shader still put people in front of labels.
    const texture=new T.CanvasTexture(canvas),label=new T.Sprite(new T.SpriteMaterial({map:texture,transparent:true,depthWrite:false}));
    label.scale.set(key.width*s*.85,key.width*s*.425,1);
    label.position.set(key.x*s,(height+.012)*s,(key.black?key.z:whiteLabelZ)*s);
    label.userData.pianoLabel=key;return [mesh,label];
  });
}

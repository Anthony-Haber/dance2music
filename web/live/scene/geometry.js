// All arrays use the unmirrored source image. Camera coordinates are Three.js
// coordinates: right, up, backwards. Depth is positive distance along -Z.
export const FOV = 60;
export const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
export const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export const unit = a => { const n = Math.hypot(...a); return a.map(x => x / (n || 1)); };
const quantile = (values, p) => values.slice().sort((a,b) => a-b)[Math.floor((values.length-1)*p)];
export function ray(x, y, width, height) {
  const f = height / (2 * Math.tan(FOV * Math.PI / 360));
  return [(x + .5 - width/2)/f, (height/2 - y - .5)/f, -1];
}
export function project(point, width, height, mirror = false) {
  const f = height / (2 * Math.tan(FOV * Math.PI / 360)), z = -point[2];
  const x = width/2 + point[0]*f/z - .5;
  return [mirror ? width-1-x : x, height/2 - point[1]*f/z - .5];
}
export function normalization(depth) {
  const values = Array.from(depth).filter(Number.isFinite);
  if (values.length < depth.length*.9) return null;
  const low = quantile(values,.01), high = quantile(values,.99), range = high-low;
  if (!(range > 1e-5)) return null;
  const offset = Math.max(0, .05*range-low), scale = quantile(values,.5)+offset;
  return scale > 0 ? {offset, scale, units:'arbitrary', frozen:true} : null;
}
export function normalize(depth, norm, alignment = {scale:1, offset:0}) {
  return Float32Array.from(depth, d => { const v = (d*alignment.scale+alignment.offset+norm.offset)/norm.scale;
    return Number.isFinite(v) && v > .01 ? v : NaN; });
}
export function personAt(mask, x, y, width, height) {
  if (!mask) return false;
  return mask.data[Math.min(mask.height-1, Math.floor(y*mask.height/height))*mask.width +
    Math.min(mask.width-1, Math.floor(x*mask.width/width))] > .2;
}
export function exclusion(frame) {
  const {width:w,height:h} = frame, mask = new Uint8Array(w*h);
  for (let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const i=y*w+x;
    if (frame.labels?.[i] === 12 || personAt(frame.person,x,y,w,h)) {
      for(let dy=-3;dy<=3;dy++) for(let dx=-3;dx<=3;dx++)
        if(x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h) mask[(y+dy)*w+x+dx]=1;
    }
  }
  return mask;
}
// Robust affine inverse-depth alignment. RGB agreement prevents changed furniture
// from pulling the fit; spatial coverage prevents alignment to one tiny wall.
export function alignDepth(current, reference) {
  if(current.width!==reference.width || current.height!==reference.height) return null;
  const a=exclusion(current), b=exclusion(reference), pairs=[], w=current.width, h=current.height;
  let eligible=0, changed=0;
  for(let i=0;i<current.depth.length;i+=2) {
    if(a[i]||b[i]) continue;
    eligible++;
    if(current.rgb && reference.rgb && Math.abs(current.rgb[i]-reference.rgb[i])>28) {changed++;continue;}
    const x=current.depth[i], y=reference.depth[i];
    if(Number.isFinite(x)&&Number.isFinite(y)) pairs.push([x,y,i]);
  }
  if(pairs.length<120) return null;
  const ys=pairs.map(p=>p[1]), xs=pairs.map(p=>p[0]);
  const range=quantile(ys,.95)-quantile(ys,.05), xrange=quantile(xs,.95)-quantile(xs,.05);
  if(range<1e-5 || xrange<1e-5) return null;
  const tolerance=.045*range; let best=[];
  for(let k=0;k<80;k++) {
    const p=pairs[(k*313+17)%pairs.length], q=pairs[(k*997+59)%pairs.length];
    if(Math.abs(q[0]-p[0])<xrange*.15) continue;
    const scale=(q[1]-p[1])/(q[0]-p[0]), offset=p[1]-scale*p[0];
    if(!(scale>.05&&scale<20)) continue;
    const inliers=pairs.filter(([x,y])=>Math.abs(x*scale+offset-y)<tolerance);
    if(inliers.length>best.length) best=inliers;
  }
  if(best.length < Math.max(120,pairs.length*.65)) return null;
  const tiles=new Set(best.map(p=>Math.floor((p[2]%w)*3/w)+3*Math.floor(Math.floor(p[2]/w)*3/h)));
  if(tiles.size<6) return null;
  const mx=best.reduce((s,p)=>s+p[0],0)/best.length, my=best.reduce((s,p)=>s+p[1],0)/best.length;
  let cov=0, variance=0;
  for(const [x,y] of best){cov+=(x-mx)*(y-my);variance+=(x-mx)**2;}
  if(variance/best.length < xrange*xrange*.005) return null;
  const scale=cov/variance, offset=my-scale*mx;
  return {scale,offset,inlier_fraction:best.length/pairs.length,changed_fraction:changed/Math.max(1,eligible)};
}
function plane3(p,q,r) {
  const normal=cross(q.map((x,i)=>x-p[i]),r.map((x,i)=>x-p[i]));
  if(Math.abs(normal[2])<1e-9)return null;
  return [-normal[0]/normal[2],-normal[1]/normal[2],dot(normal,p)/normal[2]];
}
function components(mask,w,h) {
  const seen=new Uint8Array(mask.length), result=[];
  for(let i=0;i<mask.length;i++) if(mask[i]&&!seen[i]) {
    const queue=[i]; seen[i]=1;
    for(let j=0;j<queue.length;j++) {
      const p=queue[j], x=p%w, y=Math.floor(p/w);
      for(const n of [x>0?p-1:-1,x<w-1?p+1:-1,y>0?p-w:-1,y<h-1?p+w:-1])
        if(n>=0&&mask[n]&&!seen[n]) {seen[n]=1;queue.push(n);}
    }
    if(queue.length>=50) result.push(queue);
  }
  return result.sort((a,b)=>b.length-a.length);
}
function erode(mask,w,h) {
  const out=new Uint8Array(mask.length);
  for(let y=2;y<h-2;y++) for(let x=2;x<w-2;x++) {
    let valid=true;
    for(let dy=-2;dy<=2&&valid;dy++) for(let dx=-2;dx<=2;dx++) if(!mask[(y+dy)*w+x+dx]) {valid=false;break;}
    out[y*w+x]=valid?1:0;
  }
  return out;
}
const kind = label => [3,28].includes(label)?'floor':[15,33,64].includes(label)?'table':null;
function fitPatch(indices, depth,w,h) {
  const points=indices.map(i=>{const r=ray(i%w,Math.floor(i/w),w,h);return [r[0],r[1],depth[i],i];});
  let best=null;
  for(let k=0;k<120;k++) {
    const plane=plane3(points[(k*13+3)%points.length],points[(k*47+21)%points.length],points[(k*97+49)%points.length]);
    if(!plane)continue;
    const n=unit([plane[0],plane[1],-plane[2]]).map(v=>v*(plane[1]<0?-1:1));
    if(n[1]<.72)continue; // reject sides and legs, and ambiguous horizontal-camera walls
    const inliers=points.filter(p=>Math.abs(p[2]-plane[0]*p[0]-plane[1]*p[1]-plane[2])<.035*Math.max(.2,p[2]));
    if(inliers.length>=50&&(!best||inliers.length>best.indices.length)) best={plane,normal:n,indices:inliers.map(p=>p[3])};
  }
  return best;
}
export function supportPoint(x,y,plane,w,h) {
  const r=ray(x,y,w,h), inv=plane[0]*r[0]+plane[1]*r[1]+plane[2];
  return inv>.01?r.map(v=>v/inv):null;
}
export function basis(normal) {
  const u=unit(cross(normal,Math.abs(normal[2])<.9?[0,0,1]:[1,0,0]));
  return [u,unit(cross(normal,u))];
}
export function footprintFits(center,size,normal,mask,w,h) {
  const [u,v]=basis(normal);
  // Sample the entire support footprint, including the interior and its boundary.
  const steps=Math.max(8,Math.ceil(size*h/Math.max(.1,-center[2])));
  for(let y=0;y<=steps;y++) for(let x=0;x<=steps;x++) {
    const p=center.map((c,i)=>c+size*((x/steps-.5)*u[i]+(y/steps-.5)*v[i]));
    if(p[2]>=-.01)return false;
    const [px,py]=project(p,w,h).map(Math.round);
    if(px<0||px>=w||py<0||py>=h||!mask[py*w+px])return false;
  }
  return true;
}
export function reconstruct(frames) {
  if(frames.length!==3)throw new Error('A scan requires three sequential frames');
  const first=frames[0], {width:w,height:h}=first, norm=normalization(first.depth);
  const empty={surfaces:[],objects:[],normalization:norm,projection:{vertical_fov_degrees:FOV,width:w,height:h,approximate:true,units:'arbitrary'}};
  if(!norm)return empty;
  const maps=[normalize(first.depth,norm)];
  for(const f of frames.slice(1)) {const a=alignDepth(f,first);if(!a||a.changed_fraction>.25)return empty;maps.push(normalize(f.depth,norm,a));}
  const excluded=frames.map(exclusion), masks={floor:new Uint8Array(w*h),table:new Uint8Array(w*h)};
  for(let i=0;i<w*h;i++) {
    const k=kind(first.labels[i]);
    if(k&&frames.every((f,j)=>!excluded[j][i]&&kind(f.labels[i])===k&&f.confidence[i]>.6&&Number.isFinite(maps[j][i])&&Math.abs(maps[j][i]-maps[0][i])<.08*Math.max(.2,maps[0][i])))masks[k][i]=1;
  }
  const patches=[];
  for(const k of ['floor','table']) for(const component of components(erode(masks[k],w,h),w,h).slice(0,8)) {
    let remaining=component;
    for(let n=0;n<3&&remaining.length>=80;n++) {
      const fit=fitPatch(remaining,maps[0],w,h);if(!fit)break;
      const mask=new Uint8Array(w*h);for(const i of fit.indices)mask[i]=1;
      for(const region of components(erode(mask,w,h),w,h)) {
        const interior=new Uint8Array(w*h);region.forEach(i=>interior[i]=1);
        patches.push({...fit,kind:k,mask:interior,indices:region});
      }
      const used=new Set(fit.indices);remaining=remaining.filter(i=>!used.has(i));
    }
  }
  const floor=patches.filter(p=>p.kind==='floor').sort((a,b)=>b.indices.length-a.indices.length)[0];
  const up=floor?.normal||[0,1,0];
  const accepted=patches.filter(p=>dot(p.normal,up)>.92).sort((a,b)=>(a.kind==='table'?0:1)-(b.kind==='table'?0:1)||b.indices.length-a.indices.length);
  const objects=[], surfaces=[];
  for(const patch of accepted.slice(0,12)) {
    const id=surfaces.length, boundary=[];
    for(const i of patch.indices) if(!patch.mask[i-1]||!patch.mask[i+1]||!patch.mask[i-w]||!patch.mask[i+w])boundary.push([i%w,Math.floor(i/w)]);
    surfaces.push({id,kind:patch.kind,normal:patch.normal,plane:patch.plane,boundary});
    const distances=new Float32Array(w*h);
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;if(patch.mask[i])distances[i]=1+Math.min(distances[i-1],distances[i-w]);}
    for(let y=h-2;y>0;y--)for(let x=w-2;x>0;x--){const i=y*w+x;if(patch.mask[i])distances[i]=Math.min(distances[i],1+distances[i+1],1+distances[i+w]);}
    const candidates=patch.indices.slice().sort((a,b)=>distances[b]-distances[a]||a-b);
    const max=patch.kind==='table'?1:3;
    let placed=0;
    for(const i of candidates) {
      if(objects.length>=3||placed>=max)break;
      if(distances[i]<3)break;
      const center=supportPoint(i%w,Math.floor(i/w),patch.plane,w,h);if(!center)continue;
      // Minimum size is projected pixels, not arbitrary scene units: nearby
      // tabletops otherwise fail solely because their inferred depth is small.
      const minSize=2.5*(-center[2])/(h/(2*Math.tan(FOV*Math.PI/360)));
      let size=Math.min(.65,3*distances[i]*(-center[2])/h);
      while(size>=minSize&&!footprintFits(center,size,patch.normal,patch.mask,w,h))size*=.8;
      if(size<minSize||objects.some(o=>Math.hypot(...o.support.map((v,j)=>v-center[j]))<1.6*(o.size+size)))continue;
      const position=center.map((c,j)=>c+patch.normal[j]*size/2);
      const projected=project(position,w,h), focal=h/(2*Math.tan(FOV*Math.PI/360));
      if(objects.some(o=>{
        const other=project(o.position,w,h);
        return Math.hypot(projected[0]-other[0],projected[1]-other[1]) <
          focal*(size/-position[2]+o.size/-o.position[2]);
      }))continue;
      // No placement whose projected body intersects a person in any scan frame.
      let person=false; const corners=[], [u,v]=basis(patch.normal);
      for(const z of [0,1])for(const dx of [-.5,.5])for(const dy of [-.5,.5])
        corners.push(project(center.map((c,j)=>c+size*(patch.normal[j]*z+u[j]*dx+v[j]*dy)),w,h));
      const left=Math.floor(Math.min(...corners.map(p=>p[0]))), right=Math.ceil(Math.max(...corners.map(p=>p[0])));
      const top=Math.floor(Math.min(...corners.map(p=>p[1]))), bottom=Math.ceil(Math.max(...corners.map(p=>p[1])));
      if(left<0||right>=w||top<0||bottom>=h)person=true;
      else for(let py=top;py<=bottom&&!person;py++)for(let px=left;px<=right;px++)
        if(excluded.some(m=>m[py*w+px])){person=true;break;}
      if(person)continue;
      objects.push({id:objects.length,shape:['cube','sphere','cylinder'][objects.length],surface:id,support:center,position,normal:patch.normal,size,point:[i%w,Math.floor(i/w)]});placed++;
    }
  }
  return {...empty,up,surfaces,objects};
}
// Both behind-person and in-front-of-person ordering use measured scene depth.
export function depthVisible(objectDepth,inverseDepth,ageMs,aligned=true,moving=false) {
  return aligned&&!moving&&ageMs>=0&&ageMs<=200&&Number.isFinite(inverseDepth)&&inverseDepth>0&&objectDepth<=1/inverseDepth+.015;
}

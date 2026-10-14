import {basis,dot,ray,project,supportPoint,footprintFits} from './geometry.js';

// The camera view is letterboxed by the page; use the actual overlay rectangle,
// not the stage or device pixels. Geometry always stays unmirrored.
export function pointerInView(clientX,clientY,rect,mirror=false,clampToView=false) {
  if(!rect.width||!rect.height)return null;
  let x=(clientX-rect.left)/rect.width,y=(clientY-rect.top)/rect.height;
  if(clampToView){x=Math.max(0,Math.min(1,x));y=Math.max(0,Math.min(1,y));}
  return x>=0&&x<=1&&y>=0&&y<=1?{x:mirror?1-x:x,y}:null;
}

export class SurfaceDrag {
  constructor(scan,object,hit) {
    this.original=object;this.valid=true;this.snapped=false;this.samples=null;
    const [u,v]=basis(object.normal),offset=hit.map((p,i)=>p-object.support[i]);
    this.grabHeight=dot(offset,object.normal);this.offset=[dot(offset,u),dot(offset,v)];
    const {width:w,height:h}=scan.projection;this.width=w;this.height=h;
    this.surfaces=scan.surfaces.map(surface=>{
      const mask=new Uint8Array(w*h);
      for(const [start,length] of surface.runs||[])mask.fill(1,start,start+length);
      return {surface,mask};
    });
  }
  at(x,y) {
    const {width:w,height:h,original:object}=this,dir=ray(x*w-.5,y*h-.5,w,h),candidates=[];
    for(const {surface,mask} of this.surfaces) {
      const n=surface.normal,[a,b,c]=surface.plane,q=[a,b,-c],denominator=dot(q,dir);
      if(Math.abs(denominator)<1e-7)continue;
      // Intersect the plane at the height where the shape was grabbed. Preserve
      // the tangential grab offset, including when crossing onto another table.
      const z=(1+this.grabHeight*dot(q,n))/denominator;
      if(!(z>.01&&z<100))continue;
      const [u,v]=basis(n),support=dir.map((d,i)=>d*z-n[i]*this.grabHeight-u[i]*this.offset[0]-v[i]*this.offset[1]);
      const [px,py]=project(support,w,h).map(Math.round);
      if(px<0||px>=w||py<0||py>=h||!mask[py*w+px])continue;
      const position=support.map((p,i)=>p+n[i]*object.size/2);
      candidates.push({target:{...object,surface:surface.id,support,position,normal:n,point:project(support,w,h),placement:'manual'},mask,z});
    }
    candidates.sort((a,b)=>a.z-b.z);
    const candidate=candidates[0],target=candidate?.target;
    // A table too small for the shape is an invalid target, not permission to
    // drop it onto the floor hidden underneath that table.
    return target&&footprintFits(target.support,object.size,target.normal,candidate.mask,w,h)?target:null;
  }
  grabPixel(object) {
    const [u,v]=basis(object.normal);
    return project(object.support.map((p,i)=>p+object.normal[i]*this.grabHeight+u[i]*this.offset[0]+v[i]*this.offset[1]),this.width,this.height);
  }
  nearest(x,y) {
    const w=this.width,h=this.height,px=x*w-.5,py=y*h-.5;
    // Cache candidate grab positions once per drag, and footprint checks lazily.
    // Search in image pixels: the closest place on screen is what the mouse asks
    // for, even when two surfaces have different depths or orientations.
    if(!this.samples) {
      this.samples=[{pixel:this.grabPixel(this.original)}];
      for(const {surface} of this.surfaces)for(const [start,length] of surface.runs||[])for(let i=start;i<start+length;i++) {
        const support=supportPoint(i%w,Math.floor(i/w),surface.plane,w,h);
        if(support)this.samples.push({pixel:this.grabPixel({support,normal:surface.normal})});
      }
    }
    for(const sample of this.samples)sample.distance=(sample.pixel[0]-px)**2+(sample.pixel[1]-py)**2;
    this.samples.sort((a,b)=>a.distance-b.distance||a.pixel[1]-b.pixel[1]||a.pixel[0]-b.pixel[0]);
    let best;
    for(const sample of this.samples) {
      sample.target ??= this.at((sample.pixel[0]+.5)/w,(sample.pixel[1]+.5)/h)||false;
      if(sample.target){best={pixel:sample.pixel,target:sample.target,distance:sample.distance};break;}
    }
    if(!best)return null;
    // Refine toward the cursor so a one-pixel scan grid does not make dragging
    // along an edge jump between cell centres. Check full footprints each time.
    const improve=(qx,qy)=>{
      const distance=(qx-px)**2+(qy-py)**2;if(distance>=best.distance)return false;
      const target=this.at((qx+.5)/w,(qy+.5)/h);if(!target)return false;
      best={pixel:[qx,qy],target,distance};return true;
    };
    let lo=0,hi=1;const origin=best.pixel;
    for(let i=0;i<12;i++){const t=(lo+hi)/2;if(improve(origin[0]+(px-origin[0])*t,origin[1]+(py-origin[1])*t))lo=t;else hi=t;}
    for(const step of [.5,.25,.125,.0625]) {
      const [cx,cy]=best.pixel;
      for(const dx of [-step,0,step])for(const dy of [-step,0,step])if(dx||dy)improve(cx+dx,cy+dy);
    }
    return best.target;
  }
  target(x,y) {
    const direct=this.at(x,y);this.snapped=!direct;
    const target=direct||this.nearest(x,y);this.valid=!!target;
    return target;
  }
}

export class ScenePointerControls {
  constructor(element,scene,{mirror=()=>false,onHint=()=>{}}={}) {
    Object.assign(this,{element,scene,mirror,onHint});this.pointer=null;
    this.point=e=>pointerInView(e.clientX,e.clientY,element.getBoundingClientRect(),mirror(),this.pointer!==null);
    this.down=e=>{
      if(e.button!==0||this.pointer!==null)return;
      const p=this.point(e);if(!p)return;
      const label=scene.pickLabel?.(p.x,p.y);
      if(label){e.preventDefault();scene.onLabelClick?.(label.id);return;}
      if(!scene.beginDrag(p.x,p.y))return;
      e.preventDefault();this.pointer=e.pointerId;element.setPointerCapture(e.pointerId);
      element.style.cursor='grabbing';onHint('Drag onto a detected surface. Esc cancels.');
    };
    this.move=e=>{
      const p=this.point(e);
      if(this.pointer!==null){
        if(e.pointerId!==this.pointer)return;
        if(!scene.drag){this.release();return;}
        e.preventDefault();const valid=p&&scene.moveDrag(p.x,p.y);
        element.style.cursor=valid?'grabbing':'not-allowed';
        onHint(valid?(scene.drag.snapped?'Nearest fitting position. Release to place; Esc cancels.':'Release to place. Esc cancels.'):'No fitting surface available. Esc cancels.');
      }else element.style.cursor=p&&scene.pick(p.x,p.y)?'grab':'';
    };
    this.up=e=>{if(e.pointerId!==this.pointer)return;scene.endDrag(false);this.release();};
    this.cancelEvent=e=>{if(e.pointerId===this.pointer)this.cancel();};
    this.leave=()=>{if(this.pointer===null)element.style.cursor='';};
    this.key=e=>{if(e.key==='Escape'&&this.pointer!==null){e.preventDefault();this.cancel();}};
    this.blur=()=>this.cancel();this.resize=new ResizeObserver(()=>this.cancel());this.resize.observe(element);
    this.handlers={pointerdown:this.down,pointermove:this.move,pointerup:this.up,pointercancel:this.cancelEvent,lostpointercapture:this.cancelEvent,pointerleave:this.leave};
    for(const [type,handler] of Object.entries(this.handlers))element.addEventListener(type,handler);
    window.addEventListener('blur',this.blur);document.addEventListener('keydown',this.key);
    scene.onDragEnd=()=>this.release();
  }
  release(){const pointer=this.pointer;this.pointer=null;this.element.style.cursor='';this.onHint('');
    if(pointer!==null&&this.element.hasPointerCapture(pointer))this.element.releasePointerCapture(pointer);}
  cancel(){this.scene.endDrag(true);this.release();}
  dispose(){this.cancel();this.resize.disconnect();for(const [type,handler] of Object.entries(this.handlers))this.element.removeEventListener(type,handler);
    window.removeEventListener('blur',this.blur);document.removeEventListener('keydown',this.key);this.scene.onDragEnd=null;}
}

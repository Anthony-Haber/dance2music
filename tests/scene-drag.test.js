import {SurfaceDrag,pointerInView} from '../web/live/scene/drag.js';
import {SceneRenderer} from '../web/live/scene/renderer.js';
import {project,dot,footprintFits} from '../web/live/scene/geometry.js';
import {TouchInteractions} from '../web/live/scene/touch.js';
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
export function dragFixture() {
  const width=160,height=120,runs=[];
  for(let y=62;y<116;y++)runs.push([y*width+8,144]);
  const normal=[0,1,0],support=[0,-1,-3],position=[0,-.85,-3];
  return {projection:{width,height,vertical_fov_degrees:60},normalization:{offset:0,scale:1},
    surfaces:[{id:0,kind:'floor',normal,plane:[0,-1,0],runs,boundary:[]},
      {id:1,kind:'table',normal,plane:[0,-2.5,0],runs:Array.from({length:26},(_,y)=>[(y+66)*width+110,40]),boundary:[]}],
    objects:[{id:0,shape:'cube',size:.3,surface:0,normal,support,position,point:project(support,width,height)}]};
}
// A controlled scene in the actual app, using the real renderer and controls.
// Real-model depth/occlusion is covered separately in scene.test.js.
export async function installDragFixture(c,video) {
  c.stop();c.video=video;c.source='drag-fixture';c.scan=dragFixture();c.snapshot={...c.scan};
  const T=await import('../web/live/vendor/scene/three/three.module.js');
  c.renderer=new SceneRenderer(T);c.renderer.setScan(c.scan);
  const inverse=new Float32Array(160*120).fill(.1);
  c.updateOcclusion=()=>c.renderer.setDepth(inverse,160,120);
  c.tick=()=>{};c.poseTimes=[];c.rateTimes=[];
  const update=()=>{c.latest={width:160,height:120,timestamp:performance.now(),aligned:true,inverse};c.render();};
  const timer=setInterval(update,16);c.worker={terminate:()=>clearInterval(timer)};update();
  c.status('active','1 object placed');window.dragScene=c;return true;
}
export async function runDragTests() {
  const scan=dragFixture(),object=scan.objects[0],hit=[0,-.85,-2.85];
  const normalized=p=>{const [x,y]=project(p,160,120);return [(x+.5)/160,(y+.5)/120];};
  const drag=new SurfaceDrag(scan,object,hit),same=drag.target(...normalized(hit));
  assert(Math.hypot(...same.support.map((p,i)=>p-object.support[i]))<1e-8,'grabbing a face does not jump the object');
  const moved=drag.target(.65,normalized(hit)[1]);
  assert(moved&&moved.support[0]>.5&&moved.surface===0&&moved.size===object.size,'drag follows floor in scene units without resizing');
  assert(Math.abs(moved.support[1]+1)<1e-8&&moved.placement==='manual','support stays on the plane and metadata marks manual placement');
  const distance=(d,target,x,y)=>{const p=d.grabPixel(target);return Math.hypot(p[0]-(x*160-.5),p[1]-(y*120-.5));};
  const fits=(d,target)=>{const s=d.surfaces.find(s=>s.surface.id===target.surface);return footprintFits(target.support,target.size,target.normal,s.mask,160,120);};
  const edgeXY=[.99,normalized(hit)[1]],edge=drag.target(...edgeXY);
  assert(edge&&drag.snapped&&fits(drag,edge),'invalid edge target snaps to a fitting footprint');
  assert(distance(drag,edge,...edgeXY)<distance(drag,moved,...edgeXY)-10,'edge target approaches the cursor instead of staying at the previous valid position');
  const along=drag.target(edgeXY[0],edgeXY[1]+.04);
  assert(fits(drag,along)&&drag.grabPixel(along)[1]>drag.grabPixel(edge)[1]+2,'dragging along an invalid boundary slides along its edge');
  const otherPath=new SurfaceDrag(scan,object,hit);otherPath.target(.55,edgeXY[1]);
  assert(JSON.stringify(otherPath.target(...edgeXY))===JSON.stringify(edge),'nearest position does not depend on the previous valid drag path');
  const sky=drag.target(.5,.1);assert(sky&&fits(drag,sky),'unsupported image area chooses a supported location');
  let table,tableXY;
  for(let y=.5;y<.8&&!table;y+=.005)for(let x=.7;x<.9;x+=.005){const t=drag.at(x,y);if(t?.surface===1){table=t;tableXY=[x,y];break;}}
  assert(table&&Math.abs(table.support[1]+.4)<1e-8,'shape can transfer onto a detected tabletop');
  const [tx,ty]=project(table.support,160,120).map(Math.round),smallTable=structuredClone(scan);
  smallTable.surfaces[1].runs=[[ty*160+tx,1]];
  const smallDrag=new SurfaceDrag(smallTable,object,hit);
  assert(!smallDrag.at(...tableXY),'undersized tabletop still prevents placing directly on hidden floor');
  const nearby=smallDrag.target(...tableXY);assert(nearby&&fits(smallDrag,nearby),'undersized tabletop finds a nearby fitting location');
  // A hole inside the footprint must reject even if its centre is accepted.
  const holeDrag=new SurfaceDrag(scan,object,hit);holeDrag.surfaces[0].mask[94*160+82]=0;
  assert(!holeDrag.at(...normalized(hit)),'exact interior mask rejects footprint holes');
  const besideHole=holeDrag.target(...normalized(hit));assert(besideHole&&fits(holeDrag,besideHole),'nearest placement avoids holes inside the footprint');
  const empty=new SurfaceDrag({...scan,surfaces:[]},object,hit);assert(!empty.target(.5,.5),'no fitting surface does not invent a placement');
  const contacts=new TouchInteractions(),depth=t=>({width:160,height:120,timestamp:t,aligned:true,inverse:new Float32Array(160*120).fill(1/3),person:{width:160,height:120,data:new Float32Array(160*120).fill(1)}});
  const pose=(t,where)=>{const [x,y]=normalized(where);return {timestamp:t,points:[{joint:19,part:'left hand',x,y}]};};
  contacts.update([moved],depth(1000),pose(1000,object.position),pose(1025,object.position),1030);
  assert(!contacts.observe([moved],pose(1060,object.position),1060).length,'old object position no longer triggers touches');
  contacts.reset();contacts.update([moved],depth(2000),pose(2000,moved.position),pose(2025,moved.position),2030);
  assert(contacts.observe([moved],pose(2060,moved.position),2060)[0]?.object_id===object.id,'touch interaction follows the new object position');
  const rect={left:50,top:80,width:800,height:600};
  const p=pointerInView(250,230,rect,true);
  assert(p.x===.75&&p.y===.25&&!pointerInView(250,70,rect),'mirrored CSS coordinates exclude letterboxing');
  const outside=pointerInView(900,70,rect,true,true);assert(outside.x===0&&outside.y===0,'captured dragging clamps outside the image to its nearest edge');
  const T=await import('../web/live/vendor/scene/three/three.module.js'),r=new SceneRenderer(T);
  try {
    r.setScan(scan);r.setDepth(new Float32Array(160*120).fill(.1),160,120);r.render(320,240,[true]);
    const picked=r.pick(...normalized(hit),[true]);assert(picked?.id===0,'visible core is picked with the real raycaster');
    assert(!r.pick(.1,.1,[true])&&!r.pick(...normalized(hit),[false]),'background and hidden objects cannot be selected');
    r.setDepth(new Float32Array(160*120).fill(1),160,120);
    assert(!r.pick(...normalized(hit),[true]),'foreground furniture/person prevents picking through it');
    r.setDepth(new Float32Array(160*120).fill(.1),160,120);r.moveObject(moved);r.render(320,240,[true]);
    assert(!r.pick(...normalized(hit),[true])&&r.pick(...normalized(moved.position),[true])?.id===0,'rendered object and picking move together');
    assert(dot(r.groups[0].position.toArray().map((p,i)=>p-moved.support[i]),[1,1,1])===0,'renderer uses updated support');
    return ['nearest fitting drag position, edge sliding, path independence, holes and undersized tables, grab offset, mirror/letterbox coordinates, real raycast picking and foreground rejection'];
  }finally{r.dispose();}
}

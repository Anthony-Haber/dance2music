import {alignDepth,normalize,exclusion} from './geometry.js';
import {SceneRenderer} from './renderer.js';
import {TouchInteractions,touchPose,touchBounds,TOUCH_SETTINGS} from './touch.js';
import {compositingDepth} from './occlusion.js';
import {PersonMaskReader} from './person-mask.js';
import {SurfaceDrag} from './drag.js';
const empty=()=>({objects:[],surfaces:[]});
export class SceneController {
  constructor({canvas=document.createElement('canvas'),onStatus=()=>{},onChange=()=>{},workerFactory=()=>new Worker(new URL('./worker.js',import.meta.url),{type:'module'}),rendererFactory=(T,loss)=>new SceneRenderer(T,loss)}={}) {
    Object.assign(this,{canvas,onStatus,onChange,workerFactory,rendererFactory});
    this.ctx=canvas.getContext('2d');this.generation=0;this.id=0;this.state='off';this.scan=empty();this.debug=false;this.snapshot=null;
    this.interactions=new TouchInteractions();this.touchEvents=[];this.currentTouchPose=null;
    this.maskReader=new PersonMaskReader();
    this.thumb=document.createElement('canvas');this.thumb.width=160;this.thumb.height=120;this.tg=this.thumb.getContext('2d',{willReadFrequently:true});
    this.visibility=()=>{
      this.endDrag(true);
      this.latest=null;this.interactions.reset();this.touchEvents=[];this.clear();
      if(!document.hidden&&this.worker){
        if(this.state==='scanning')this.rescan('Scanning after returning to this tab…');
        else {
          // Keep anchored geometry across window switches. Fresh alignment and
          // background-change checks will rescan only if the room actually moved.
          this.nextInference=0;this.lastVideoTime=-1;this.unreliableSince=0;this.changedSince=0;
        }
      }
    };
    document.addEventListener('visibilitychange',this.visibility);
  }
  status(state,message){this.state=state;this.message=message;this.onStatus({state,message});}
  async start(video,source) {
    this.stop();this.video=video;this.source=source;this.scan=empty();this.snapshot=null;this.provenance=null;
    this.interval=100;this.poseTimes=[];this.baseline=0;this.baselineUntil=0;this.rateTimes=[];this.suppressed=0;this.depthLatency=0;
    this.status('loading','Loading 3D models…');
    if(!navigator.gpu){this.fail('3D objects need Chrome with WebGPU');return false;}
    const generation=this.generation;
    this.readyPromise=new Promise(resolve=>this.resolveStart=resolve);
    try {
      const worker=this.worker=this.workerFactory();
      worker.onmessage=e=>{if(this.worker===worker)this.receive(e.data).catch(error=>this.fail(error.message));};
      worker.onerror=e=>{if(this.worker===worker)this.fail(e.message||'Scene worker failed');};
      worker.onmessageerror=()=>{if(this.worker===worker)this.fail('Scene worker message failed');};
      worker.postMessage({type:'init',generation,source,id:++this.id,timestamp:performance.now()});
      this.timeout=setTimeout(()=>this.fail('3D model loading timed out'),240000);
      const animate=()=>{if(!this.worker)return;try{this.tick();this.render();this.raf=requestAnimationFrame(animate);}catch(error){this.fail(error.message);}};
      this.raf=requestAnimationFrame(animate);
    }catch(error){this.fail(error.message);}
    return this.readyPromise;
  }
  async receive(result) {
    if(result.source!==this.source)return;
    if(result.type==='fatal'){this.fail(result.message);return;}
    if(result.id===this.pending){this.pending=null;this.busy=false;clearTimeout(this.inferTimeout);}
    if(result.generation!==this.generation)return;
    if(result.type==='status'){this.status('loading',result.message);return;}
    if(result.type==='ready') {
      const generation=this.generation;
      this.provenance=result.provenance;
      const THREE=await import(result.three);
      if(generation!==this.generation||!this.worker)return;
      this.renderer=this.rendererFactory(THREE,message=>this.fail(message));
      this.renderer.setTouchEnabled(this.interactions.enabled);
      clearTimeout(this.timeout);this.rescan('Scanning surfaces (0/3)…');return;
    }
    if(result.type!=='result'||document.hidden)return;
    this.depthLatency=performance.now()-result.timestamp;
    this.rateTimes.push(performance.now());this.rateTimes=this.rateTimes.filter(t=>t>performance.now()-2000);
    if(this.state==='scanning') {
      this.frames.push(result);this.status('scanning',`Scanning surfaces (${this.frames.length}/3)…`);
      if(this.frames.length===3) {
        if(!result.scanResult)throw new Error('Scene worker omitted surface results');
        this.scan=result.scanResult;this.reference=this.frames[0];this.scanMs=performance.now()-this.scanStart;
        this.snapshot={generation:this.generation,scanned_at_ms:performance.now(),duration_ms:this.scanMs,...this.scan,transforms:result.transforms};
        this.frames=[];this.renderer.setScan(this.scan);clearTimeout(this.timeout);
        this.status(this.scan.objects.length?'active':'empty',this.scan.objects.length?`${this.scan.objects.length} objects placed`:'No suitable surface found.');
        this.nextRetry=performance.now()+15000;this.nextInference=0;this.latest=null;
        if(!this.baseline){this.baselineUntil=performance.now()+2000;this.poseTimes=[];}
        this.resolveStart?.(true);this.resolveStart=null;this.onChange();
      }
      return;
    }
    const alignment=alignDepth(result,this.reference);
    if(!alignment){this.latest=null;this.unreliableSince ||= performance.now();}
    else {
      this.unreliableSince=0;
      const currentPerson=exclusion(result), referencePerson=exclusion(this.reference);
      let changed=0, samples=0;
      for(const surface of this.scan.surfaces) for(const [x,y] of surface.boundary) {
        const i=y*result.width+x;
        if(currentPerson[i]||referencePerson[i])continue;
        samples++;
        const aligned=result.depth[i]*alignment.scale+alignment.offset, old=this.reference.depth[i];
        if(Math.abs(aligned-old)>.1*Math.max(.1,Math.abs(old))&&Math.abs(result.rgb[i]-this.reference.rgb[i])>20)changed++;
      }
      const sceneChanged=alignment.changed_fraction>.16||(samples>20&&changed/samples>.2);
      if(sceneChanged)this.changedSince ||= performance.now();else this.changedSince=0;
      if(sceneChanged)this.latest=null;
      if(this.scan.normalization && !sceneChanged) {
        this.latest={...result,aligned:true,inverse:normalize(result.depth,this.scan.normalization,alignment)};
        // Keep raw aligned depth for robust limb sampling. Display suppression
        // is applied separately, never fed back into contact detection.
        this.publishTouches(this.interactions.update(this.touchObjects(),this.latest,result.touchPose,this.currentTouchPose,performance.now()));
      }
    }
    if((this.unreliableSince&&performance.now()-this.unreliableSince>2000)||(this.changedSince&&performance.now()-this.changedSince>2500))this.rescan('Scene changed — rescanning…');
  }
  rescan(message='Scanning surfaces (0/3)…') {
    if(!this.renderer||!this.worker)return;
    this.endDrag(true);
    this.generation++;this.frames=[];this.latest=null;this.reference=null;this.scan=empty();this.snapshot=null;this.renderer.setScan(this.scan);this.clear();
    this.interactions.reset();this.touchEvents=[];
    this.unreliableSince=0;this.changedSince=0;this.scanStart=performance.now();this.nextInference=0;this.lastVideoTime=-1;
    clearTimeout(this.timeout);this.timeout=setTimeout(()=>this.fail('Surface scan timed out'),45000);
    this.status('scanning',message);this.onChange();
  }
  // Called INSIDE MediaPipe's callback; mask data is callback-owned.
  observePose(landmarks,now){
    this.currentTouchPose=this.worker?touchPose(landmarks,now):null;
    if(this.latest?.aligned)this.publishTouches(this.interactions.observe(this.touchObjects(),this.currentTouchPose,now));
  }
  touchObjects(){return this.scan.objects.filter(o=>o.id!==this.drag?.original.id);}
  pick(x,y,now=performance.now()) {
    if(this.state!=='active'||x<0||x>1||y<0||y>1||!this.visible(now).some(Boolean))return null;
    return this.renderer?.pick(x,y,this.visible(now))||null;
  }
  beginDrag(x,y) {
    if(this.drag)return false;
    const hit=this.pick(x,y);if(!hit)return false;
    const object=this.scan.objects.find(o=>o.id===hit.id);
    if(!this.scan.surfaces.some(s=>s.runs?.length))return false;
    this.drag=new SurfaceDrag(this.scan,object,hit.point);
    this.interactions.states.delete(object.id);this.touchEvents=this.touchEvents.filter(e=>e.object_id!==object.id);
    this.renderer.clearTouch(object.id);return true;
  }
  moveDrag(x,y) {
    if(!this.drag||!this.visible(performance.now()).some(Boolean))return false;
    const target=this.drag.target(x,y);if(!target)return false;
    this.placeObject(target);return true;
  }
  placeObject(object) {
    this.scan={...this.scan,objects:this.scan.objects.map(o=>o.id===object.id?object:o)};
    if(this.snapshot)this.snapshot={...this.snapshot,objects:this.scan.objects};
    this.renderer?.moveObject(object);this.onChange();
  }
  endDrag(cancel=false) {
    if(!this.drag)return;
    const original=this.drag.original;this.drag=null;
    if(cancel)this.placeObject(original);
    this.interactions.states.delete(original.id);this.onDragEnd?.();
  }
  publishTouches(events){
    for(const event of events){this.renderer?.touch(event);this.touchEvents.push({...event,generation:this.generation});}
    this.touchEvents=this.touchEvents.slice(-16);
  }
  setTouchEnabled(enabled){this.interactions.enabled=enabled;this.interactions.reset();this.touchEvents=[];this.renderer?.setTouchEnabled(enabled);}
  takeTouchEvents(){return this.touchEvents.splice(0);}
  copyPerson(mask,now) {
    if(!this.worker)return;
    if(!mask){this.person=null;return;}
    try{this.person={...this.maskReader.read(mask),timestamp:now};}
    catch(error){this.fail(error.message);}
  }
  pose(now) {
    if(!this.worker)return;
    this.poseTimes.push(now);this.poseTimes=this.poseTimes.filter(t=>t>now-1500);
    if(this.baselineUntil && now>=this.baselineUntil){this.baseline=this.poseTimes.length/1.5;this.baselineUntil=0;}
    if(this.baseline&&this.poseTimes.length>8&&now-(this.lastThrottle||0)>2000) {
      const rate=this.poseTimes.length/1.5;
      this.interval=rate<this.baseline*.85?Math.min(1000,this.interval*1.5):Math.max(100,this.interval*.95);
      this.lastThrottle=now;
    }
  }
  tick() {
    const now=performance.now();
    if(!this.renderer||document.hidden||this.busy||this.capturing||now<(this.nextInference||0)||now<this.baselineUntil||this.video.readyState<2)return;
    if(this.state==='empty'){if(now>=this.nextRetry)this.rescan();return;}
    if(this.state==='loading'||this.state==='off'||this.state==='failed')return;
    if(this.video.currentTime===this.lastVideoTime)return;
    this.lastVideoTime=this.video.currentTime;
    const generation=this.generation,source=this.source,worker=this.worker,timestamp=now,id=++this.id;
    const person=this.person&&now-this.person.timestamp<100?{...this.person,data:this.person.data.slice()}:null;
    const pose=this.interactions.enabled&&this.currentTouchPose&&now-this.currentTouchPose.timestamp<100?this.currentTouchPose:null;
    this.capturing=true;
    createImageBitmap(this.video).then(image=>{
      this.capturing=false;
      if(this.worker!==worker||generation!==this.generation){image.close();return;}
      this.busy=true;this.pending=id;this.nextInference=timestamp+this.interval;
      worker.postMessage({type:'infer',id,source,generation,timestamp,image,person,touchPose:pose,scan:this.state==='scanning'},[image,...(person?[person.data.buffer]:[])]);
      this.inferTimeout=setTimeout(()=>this.fail('Scene inference timed out'),15000);
    }).catch(error=>{this.capturing=false;if(this.worker===worker)this.fail(error.message);});
  }
  visible(now) {
    if(!this.latest||!this.latest.aligned||document.hidden||now-this.latest.timestamp>200||now<this.latest.timestamp)return this.scan.objects.map(()=>false);
    return this.scan.objects.map(()=>true);
  }
  updateOcclusion(now) {
    const {width:w,height:h}=this.latest;
    this.thumb.width=w;this.thumb.height=h;this.tg.drawImage(this.video,0,0,w,h);
    const pixels=this.tg.getImageData(0,0,w,h).data;
    if(this.displayDepth?.length!==this.latest.inverse.length)this.displayDepth=new Float32Array(w*h);
    compositingDepth(this.latest,this.person,pixels,now,this.displayDepth);
    this.renderer.setDepth(this.displayDepth,w,h);
  }
  render(now=performance.now()) {
    if(!this.renderer||!this.video?.videoWidth){this.clear();return this.canvas;}
    const w=Math.min(960,this.video.videoWidth),h=Math.round(w*this.video.videoHeight/this.video.videoWidth);
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    const visible=this.visible(now);this.suppressed=this.scan.objects.length-visible.filter(Boolean).length;
    this.ctx.clearRect(0,0,w,h);
    if(visible.some(Boolean)){this.updateOcclusion(now);this.ctx.drawImage(this.renderer.render(w,h,visible,now,this.interactions.visual(now)),0,0);}
    if(this.debug&&this.scan.projection) {
      const sx=w/this.scan.projection.width,sy=h/this.scan.projection.height;
      this.ctx.fillStyle='#58d6a1aa';for(const surface of this.scan.surfaces)for(const [x,y] of surface.boundary)this.ctx.fillRect(x*sx,y*sy,2,2);
      this.ctx.fillStyle='#ffffff';for(const object of this.scan.objects){this.ctx.beginPath();this.ctx.arc(object.point[0]*sx,object.point[1]*sy,4,0,Math.PI*2);this.ctx.fill();}
      this.ctx.strokeStyle='#ffd76a';this.ctx.lineWidth=1;
      for(const object of this.scan.objects){const b=touchBounds(object,w,h);this.ctx.strokeRect(b.left,b.top,b.right-b.left,b.bottom-b.top);}
      for(const p of this.currentTouchPose?.points||[]){this.ctx.fillStyle=this.interactions.points.some(q=>q.joint===p.joint)?'#70edff':'#ffd76a';this.ctx.beginPath();this.ctx.arc(p.x*w,p.y*h,4,0,Math.PI*2);this.ctx.fill();}
    }
    if(this.drag&&visible.some(Boolean)) {
      const object=this.scan.objects.find(o=>o.id===this.drag.original.id),b=touchBounds(object,w,h);
      this.ctx.strokeStyle=this.drag.valid?'#70edff':'#ffb369';this.ctx.lineWidth=2;
      this.ctx.strokeRect(b.left-3,b.top-3,b.right-b.left+6,b.bottom-b.top+6);
    }
    return this.canvas;
  }
  clear(){this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);}
  configuration(){return {enabled:this.state!=='off',state:this.state,provenance:this.provenance||null,scan:this.snapshot,show_surfaces:this.debug,max_depth_age_ms:200,
    touch:{enabled:this.interactions.enabled,...TOUCH_SETTINGS}};}
  metrics(){return `scan ${((this.scanMs||0)/1000).toFixed(1)} s · depth ${Math.round(this.depthLatency||0)} ms · ${((this.rateTimes||[]).filter(t=>t>performance.now()-2000).length/2).toFixed(1)} Hz · ${this.suppressed||0} stale hidden · ${this.interactions.count} touches · ${this.interactions.reason} · pose budget ${Math.round(this.baseline||0)} fps`;}
  fail(message){this.stop();this.status('failed','3D unavailable: '+message+'. Music can continue.');this.onChange();}
  stop() {
    this.endDrag(true);
    this.generation++;this.worker?.terminate();this.worker=null;
    clearTimeout(this.timeout);clearTimeout(this.inferTimeout);cancelAnimationFrame(this.raf);
    this.renderer?.dispose();this.renderer=null;this.latest=null;this.reference=null;this.frames=[];this.person=null;this.displayDepth=null;
    this.maskReader.dispose();
    this.busy=false;this.pending=null;this.capturing=false;this.scan=empty();this.snapshot=null;this.clear();
    this.interactions.reset();this.touchEvents=[];this.currentTouchPose=null;
    this.resolveStart?.(false);this.resolveStart=null;this.status('off','3D objects off');
  }
  dispose(){this.stop();document.removeEventListener('visibilitychange',this.visibility);}
}

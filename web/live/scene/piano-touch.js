import {ray} from './geometry.js';
import {touchDepth} from './touch.js';
import {pianoLocal,pianoKeyAt,PIANO_KEYS} from './piano-layout.js';

export const PIANO_TOUCH_SETTINGS=Object.freeze({version:5,parts:['feet'],pose_age_ms:120,max_depth_age_ms:200,
  confirm_ms:25,release_ms:120,boundary_hysteresis:.008,floor_tolerance:.045,
  lift_confirm_ms:25,landing_margin:.02,lift_pixels:4,ankle_lift_pixels:2,landing_pixels:2,preview_width:640,
  bounce_toe_slop_pixels:1,bounce_ankle_pixels:3,landing_descent_fraction:.5,ankle_descent_fraction:.35,
  settle_pixels:.5,settle_confirm_ms:25,
  lift_detection:'pose-rise-from-confirmed-contact',
  sound:'sampled-piano',sound_layer:'objects'});
export function pianoPose(landmarks,timestamp) {
  const valid=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1&&(p.visibility??0)>=.65&&(p.presence??1)>=.65;
  const points=[];
  for(const [foot,toe,heel,ankle] of [['left',31,29,27],['right',32,30,28]]) {
    const joint=valid(landmarks?.[toe])?toe:heel,p=landmarks?.[joint],anchor=landmarks?.[ankle];
    if(valid(p))points.push({foot,joint,part:foot+' foot',x:p.x,y:p.y,anchor:valid(anchor)?{x:anchor.x,y:anchor.y}:null,
      landmarkY:Object.fromEntries([toe,heel].filter(i=>valid(landmarks[i])).map(i=>[i,landmarks[i].y]))});
  }
  return {timestamp,points};
}
const fresh=(t,now,age)=>Number.isFinite(t)&&now>=t&&now-t<=age;
const landing=(p,height,key)=>({height,y:p.y,joint:p.joint,ankleY:p.anchor?.y??null,landmarkY:p.landmarkY,key});
export class PianoInteractions {
  constructor(){this.enabled=true;this.reset();}
  reset(){this.states=new Map();this.owners=new Map();this.anchors=new Map();this.depth=null;this.lastTimestamp=-Infinity;this.points=[];this.count=0;this.reason='Waiting for feet on the floor';}
  release(now=performance.now(),reason='reset') {
    const events=this.events(new Map(),now,reason);this.reset();return events;
  }
  events(next,now,reason='contact') {
    const events=[];
    for(const id of new Set([...this.owners.keys(),...next.keys()])) {
      const before=this.owners.get(id)||[],after=next.get(id)||[];
      if(before.join()===after.join())continue;
      const type=!before.length?'piano-note-on':!after.length?'piano-note-off':'piano-ownership';
      if(type==='piano-note-on')this.count++;
      events.push({type,key_id:id,midi:PIANO_KEYS.find(k=>k.id===id).midi,foot_ids:after,previous_foot_ids:before,
        timestamp_ms:now,pose_timestamp_ms:this.poseTimestamp??null,depth_timestamp_ms:this.depth?.timestamp??null,reason});
    }
    this.owners=next;return events;
  }
  update(objects,depth,captured,current,now) {
    if(depth?.aligned&&fresh(depth.timestamp,now,200)&&depth.timestamp>this.lastTimestamp&&captured&&fresh(captured.timestamp,depth.timestamp,120)) {
      this.lastTimestamp=depth.timestamp;this.depth={timestamp:depth.timestamp,width:depth.width,height:depth.height};this.anchors.clear();
      for(const p of captured.points){if(!['left','right'].includes(p.foot))continue;const z=touchDepth(p,depth);if(z)this.anchors.set(p.foot,{...p,z});}
    }
    return this.observe(objects,current,now);
  }
  watchdog(current,now) {
    if(!fresh(current?.timestamp,now,120)||!fresh(this.depth?.timestamp,now,200)) {
      const events=this.release(now,'stale-input');this.reason='Waiting for fresh foot pose and floor depth';return events;
    }
    return [];
  }
  observe(objects,current,now) {
    const stale=this.watchdog(current,now);if(!this.depth)return stale;
    const object=objects.find(o=>o.shape==='keyboard');
    if(!this.enabled||!object)return this.release(now,'unavailable');
    this.poseTimestamp=current.timestamp;this.points=[];
    const next=new Map(),lifted=new Set(),landed=new Set(),{width:w,height:h}=this.depth,settings=PIANO_TOUCH_SETTINGS;
    for(const foot of ['left','right']) {
      let state=this.states.get(foot);if(!state){state={key:null,candidate:null,since:0,lastNear:-Infinity,ground:null,liftSince:null,airborne:false};this.states.set(foot,state);}
      const p=current.points.find(p=>p.foot===foot),a=this.anchors.get(foot);let key=null,height=null;
      if(p&&a&&p.joint===a.joint&&Math.hypot((p.x-a.x)*w,(p.y-a.y)*h)<=Math.max(3,w*.025)) {
        const position=ray(p.x*w-.5,p.y*h-.5,w,h).map(v=>v*a.z),local=pianoLocal(object,position),[x,,z]=local;
        height=local[1];
        this.points.push({...p,position});
        if(Math.abs(height)<=settings.floor_tolerance)key=pianoKeyAt(x,z,state.key,object.keys)?.id||null;
      }
      // Once depth has established foot contact, follow takeoff at pose speed.
      // A jump can leave the small depth-anchor neighborhood between 10 Hz depth
      // frames. Its minimum lift must not grow with the full keyboard's width.
      // A visible ankle corroborates the toe/heel rise, rejecting foot flexes.
      if(state.key&&height!==null&&state.ground?.joint!==p.joint){state.ground=landing(p,height,state.key);state.liftSince=null;}
      const groundY=p&&(state.ground?.joint===p.joint?state.ground.y:state.ground?.landmarkY?.[p.joint]),scale=h*settings.preview_width/w;
      const comparable=Number.isFinite(groundY),rise=comparable?(groundY-p.y)*scale:null;
      const ankleRise=p?.anchor&&state.ground?.ankleY!=null?(state.ground.ankleY-p.anchor.y)*scale:null;
      // During a short bounce the pose model can pin the toe near the floor
      // while the ankle clearly moves. Corroborated ankle motion can therefore
      // arm a replay even with a stationary toe. The toe must remain confident
      // and must not be moving down beyond the small tracking-noise allowance.
      const rising=state.key&&comparable&&((rise>=settings.lift_pixels&&
        (ankleRise===null||ankleRise>=settings.ankle_lift_pixels))||
        (rise>=-settings.bounce_toe_slop_pixels&&ankleRise!==null&&ankleRise>=settings.bounce_ankle_pixels));
      if(rising){
        state.liftSince??=current.timestamp;
        if(current.timestamp-state.liftSince>=settings.lift_confirm_ms){
          state.airborne=true;state.takeoff=current.timestamp;state.key=null;state.candidate=null;state.liftSince=null;lifted.add(foot);
          state.peakRise=Number.isFinite(state.motion?.rise)?Math.min(rise,state.motion.rise):rise;
          state.peakAnkleRise=ankleRise===null?null:state.motion?.ankleRise==null?ankleRise:Math.min(ankleRise,state.motion.ankleRise);
        }
      }else state.liftSince=null;
      if(state.airborne&&state.motion?.timestamp<current.timestamp){
        // Require two distinct poses at a height before accepting a higher peak.
        // A single raised-landmark outlier while hovering must not look like a
        // new peak followed by a landing on the next frame.
        if(comparable&&Number.isFinite(state.motion.rise))state.peakRise=Math.max(state.peakRise,Math.min(rise,state.motion.rise));
        if(ankleRise!==null&&state.motion.ankleRise!==null)state.peakAnkleRise=Math.max(state.peakAnkleRise??0,Math.min(ankleRise,state.motion.ankleRise));
      }
      // Small hops may stay inside the floor-depth tolerance. Require the pose
      // to come back down too, so an airborne depth estimate cannot replay a key.
      // If a newly visible heel has neither a saved baseline nor an ankle,
      // reacquire it only in a tighter floor band instead of latching airborne.
      const fallbackFloor=!comparable&&ankleRise===null&&height!==null&&Math.abs(height)<=settings.landing_margin/2;
      // A landing can settle a few pixels above the original pose. Recognize
      // the downward half of the jump instead of requiring that exact position.
      const footReturned=comparable&&(rise<=settings.landing_pixels||
        state.peakRise-rise>=Math.max(settings.landing_pixels,state.peakRise*settings.landing_descent_fraction));
      const ankleReturned=ankleRise===null||ankleRise<=settings.landing_pixels||
        (state.peakAnkleRise!==null&&state.peakAnkleRise-ankleRise>=Math.max(1,state.peakAnkleRise*settings.landing_descent_fraction));
      // Ankle descent also resolves bounces whose toe stays pinned at its new
      // image height. Require a confirmed peak, appreciable downward travel and
      // no continuing toe ascent, in addition to fresh floor contact below.
      const ankleLanded=ankleRise!==null&&state.peakAnkleRise!==null&&
        state.peakAnkleRise-ankleRise>=Math.max(settings.landing_pixels,state.peakAnkleRise*settings.ankle_descent_fraction)&&
        (!comparable||state.motion?.rise!=null&&rise<=state.motion.rise+settings.settle_pixels);
      const returned=fallbackFloor||((comparable?footReturned:ankleRise!==null)&&ankleReturned)||ankleLanded;
      if(state.airborne&&!(height!==null&&this.depth.timestamp>state.takeoff&&
        returned&&height<=Math.max(settings.landing_margin,state.ground.height+settings.landing_margin)))key=null;
      if(key===state.key&&key){state.lastNear=current.timestamp;state.candidate=null;}
      else if(key) {
        if(state.candidate!==key){state.candidate=key;state.since=current.timestamp;}
        if(current.timestamp-state.since>=settings.confirm_ms){
          if(state.airborne)landed.add(foot);
          state.key=key;state.lastNear=current.timestamp;state.candidate=null;state.airborne=false;
          state.ground=landing(p,height,key);
        }
        else if(current.timestamp-state.lastNear>=settings.release_ms)state.key=null;
      }else {state.candidate=null;if(current.timestamp-state.lastNear>=settings.release_ms)state.key=null;}
      // Contact is often first confirmed on the way down. Learn the settled
      // pose, so the next short jump is measured from the actual resting foot.
      if(state.key===key&&key&&!state.airborne&&rise<=settings.settle_pixels&&
        (ankleRise===null||ankleRise<=settings.settle_pixels)&&
        (rise<-settings.settle_pixels||ankleRise!==null&&ankleRise<-settings.settle_pixels)){
        state.settleSince??=current.timestamp;
        if(current.timestamp-state.settleSince>=settings.settle_confirm_ms){state.ground=landing(p,height,key);state.settleSince=null;}
      }else state.settleSince=null;
      state.motion={timestamp:current.timestamp,rise,ankleRise};
      if(!state.key&&!state.airborne)state.ground=null;
      if(state.key){const owners=next.get(state.key)||[];owners.push(foot);next.set(state.key,owners);}
    }
    this.reason=next.size?'Foot contact — lift and land to replay':'Step onto a key near the floor';
    const events=this.events(next,now);
    for(const event of events){
      if(event.type==='piano-note-off'&&event.previous_foot_ids.some(foot=>lifted.has(foot)))event.reason='lift-off';
      if(event.type==='piano-note-on'&&event.foot_ids.some(foot=>landed.has(foot)))event.reason='landing';
    }
    return [...stale,...events];
  }
  visual(){return [...this.owners].map(([key_id,feet])=>({id:'floor-piano',key_id,feet,active:true}));}
}

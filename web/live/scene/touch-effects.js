import {TOUCH_SETTINGS} from './touch.js';
// Fixed-size pools, no post-processing pipeline or external textures. Every
// particle uses the scene's normal depth compositor, including in recordings.
export class TouchEffects {
  constructor(T,group,mesh,object,sprite) {
    this.meshes=Array.isArray(mesh)?mesh:[mesh];mesh=this.meshes[0];
    Object.assign(this,{T,group,mesh,object});this.enabled=true;this.started=-Infinity;this.sequence=0;
    const s=object.size,color=mesh.material.color;
    // Distant shapes still need a burst that can be seen across the room.
    this.spread=Math.max(s,-(object.position?.[2]??object.support[2])*.12);
    this.ringSpread=this.spread;
    this.glows=this.meshes.map(m=>{
      m.material.emissive.copy(m.material.color);
      if(!object.instrument){m.material.roughness=.4;m.material.metalness=.12;}
      const glow=new T.Mesh(m.geometry.clone(),new T.MeshBasicMaterial({color:m.material.color,side:T.BackSide,transparent:true,opacity:.07,depthWrite:true}));
      glow.position.copy(m.position);glow.quaternion.copy(m.quaternion);glow.scale.setScalar(1.12);group.add(glow);return glow;
    });
    this.glow=this.glows[0];
    this.ring=new T.Mesh(new T.RingGeometry(this.spread*.48,this.spread*.58,48),new T.MeshBasicMaterial({color:color.clone().lerp(new T.Color(0xffffff),.4),side:T.DoubleSide,transparent:true,opacity:0,depthWrite:true}));
    this.ring.rotation.x=-Math.PI/2;this.ring.position.y=s*.015;this.ring.visible=false;group.add(this.ring);
    this.count=TOUCH_SETTINGS.particles_per_object;
    this.positions=new Float32Array(this.count*3);this.velocities=new Float32Array(this.count*3);this.starts=new Float32Array(this.count*3);
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(this.positions,3).setUsage(T.DynamicDrawUsage));geometry.setDrawRange(0,0);
    this.particles=new T.Points(geometry,new T.PointsMaterial({color:color.clone().lerp(new T.Color(0xffffff),.45),
      map:sprite,size:TOUCH_SETTINGS.min_particle_pixels,sizeAttenuation:false,transparent:true,opacity:1,alphaTest:.025,depthWrite:true}));
    this.particles.frustumCulled=false;group.add(this.particles);
    this.origin=new T.Vector3();
  }
  trigger(event) {
    if(!this.enabled)return;
    this.started=event.effect_timestamp_ms;this.sequence++;
    this.group.updateWorldMatrix(true,false);
    this.origin.fromArray(event.position);this.group.worldToLocal(this.origin);
    const s=this.object.size;
    this.spread=Math.max(s,-(this.object.position?.[2]??this.object.support[2])*.12);
    // Launch above and around the shape, so a shoe covering the contact point
    // cannot hide the entire burst. Real foreground depth still occludes sparks.
    this.origin.clamp(new this.T.Vector3(-s*.2,s*.65,-s*.2),new this.T.Vector3(s*.2,s*1.15,s*.2));
    for(let i=0;i<this.count;i++) {
      const seed=i+this.sequence*61+this.object.id*137, angle=seed*2.39996323;
      const spread=.7+(Math.sin(seed*13.17)+1)*.65;
      this.starts[i*3]=Math.cos(angle)*s*.45;this.starts[i*3+1]=0;this.starts[i*3+2]=Math.sin(angle)*s*.45;
      this.velocities[i*3]=Math.cos(angle)*this.spread*spread;
      this.velocities[i*3+1]=this.spread*(2+(Math.sin(seed*7.31)+1)*1.1);
      this.velocities[i*3+2]=Math.sin(angle)*this.spread*spread;
    }
  }
  setEnabled(enabled){this.enabled=enabled;if(!enabled)this.started=-Infinity;}
  update(now,contact={},height=540) {
    const age=(now-this.started)/1000,duration=TOUCH_SETTINGS.burst_duration_ms/1000;
    const burst=age>=0&&age<duration?Math.exp(-age*1.8):0;
    const held=contact.active ? .75 : 0,near=(contact.proximity||0)*.4;
    const energy=this.enabled?Math.max(burst,held,near):0;
    const breathe=this.enabled ? .5+.5*Math.sin(now*.0025+this.object.id*2) : 0;
    this.meshes.forEach(m=>m.material.emissiveIntensity=this.enabled ? .06+.06*breathe+energy*3 : 0);
    this.glows.forEach(g=>{g.visible=this.enabled;g.material.opacity=.035+.025*breathe+energy*.45;g.scale.setScalar(1.06+energy*.12);});
    const alive=this.enabled&&age>=0&&age<duration;
    this.ring.visible=alive;
    if(alive) {
      this.ring.scale.setScalar((1+age*3)*this.spread/this.ringSpread);this.ring.material.opacity=(1-age/duration)*.9;
      for(let i=0;i<this.count;i++) {
        const k=i*3;
        this.positions[k]=this.origin.x+this.starts[k]+this.velocities[k]*age;
        this.positions[k+1]=this.origin.y+this.starts[k+1]+this.velocities[k+1]*age-this.spread*1.5*age*age;
        this.positions[k+2]=this.origin.z+this.starts[k+2]+this.velocities[k+2]*age;
      }
      this.particles.geometry.attributes.position.needsUpdate=true;
      this.particles.material.opacity=Math.min(1,(duration-age)/(duration-.3));
      this.particles.material.size=Math.max(TOUCH_SETTINGS.min_particle_pixels,Math.min(14,height*.015));
    }
    this.particles.geometry.setDrawRange(0,alive?this.count:0);
  }
}
export function particleSprite(T) {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=32;
  const ctx=canvas.getContext('2d'),gradient=ctx.createRadialGradient(16,16,0,16,16,16);
  gradient.addColorStop(0,'#fff');gradient.addColorStop(.25,'#fffffff0');gradient.addColorStop(1,'#ffffff00');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,32,32);return new T.CanvasTexture(canvas);
}

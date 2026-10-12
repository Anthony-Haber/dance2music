// A fresh transparent, unmirrored layer. Both preview and Recorder call render
// at composition time, so neither can retain objects after depth expires.
import {basis} from './geometry.js';
import {TouchEffects,particleSprite} from './touch-effects.js';

export class SceneRenderer {
  constructor(THREE,onLoss=()=>{}) {
    this.T=THREE;
    this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:false,premultipliedAlpha:false});
    this.canvas=this.renderer.domElement;
    this.onLost=event=>{event.preventDefault();onLoss('3D renderer context lost');};
    this.canvas.addEventListener('webglcontextlost',this.onLost);
    this.renderer.setClearColor(0,0);
    this.scene=new THREE.Scene();
    this.camera=new THREE.PerspectiveCamera(60,4/3,.01,100);
    this.scene.add(new THREE.HemisphereLight(0xffffff,0x554466,2));
    const light=new THREE.DirectionalLight(0xffffff,2.3);light.position.set(-2,4,2);this.scene.add(light);
    this.groups=[];this.effects=[];this.meshes=[];this.raycaster=new THREE.Raycaster();this.touchEnabled=true;this.sprite=particleSprite(THREE);
    this.target=new THREE.WebGLRenderTarget(1,1,{depthBuffer:true});
    this.target.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
    this.depth=new THREE.DataTexture(new Float32Array([1]),1,1,THREE.RedFormat,THREE.FloatType);this.depth.needsUpdate=true;
    this.sceneViewport={value:new THREE.Vector2(1,1)};
    this.material=new THREE.ShaderMaterial({transparent:true,blending:THREE.NoBlending,depthTest:false,depthWrite:false,
      uniforms:{colorMap:{value:this.target.texture},virtualDepth:{value:this.target.depthTexture},realInverseDepth:{value:this.depth},near:{value:.01},far:{value:100}},
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:`varying vec2 vUv;
        uniform sampler2D colorMap, virtualDepth, realInverseDepth; uniform float near, far;
        void main(){
          vec4 color=texture2D(colorMap,vUv); if(color.a<.001)discard;
          float inverse=texture2D(realInverseDepth,vec2(vUv.x,1.-vUv.y)).r;
          if(!(inverse>.01))discard;
          float d=texture2D(virtualDepth,vUv).r;
          float objectZ=near*far/(far-d*(far-near));
          if(objectZ>1./inverse+.015)discard;
          // The offscreen layers have already blended into premultiplied RGB.
          // Write straight alpha once for this non-premultiplied canvas, and
          // convert linear lighting to display color so sparks stay luminous.
          gl_FragColor=vec4(color.rgb/color.a,color.a);
          #include <colorspace_fragment>
        }`});
    this.composite=new THREE.Scene();this.quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.material);this.composite.add(this.quad);
    this.screenCamera=new THREE.Camera();
  }
  occludeMaterial(material) {
    // Reject hidden fragments before transparent layers blend. A foreground
    // spark must never reveal an occluded object underneath by writing its depth.
    material.onBeforeCompile=shader=>{
      shader.uniforms.sceneInverse={value:this.depth};shader.uniforms.sceneViewport=this.sceneViewport;
      shader.fragmentShader='uniform sampler2D sceneInverse; uniform vec2 sceneViewport;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
        float sceneInv=texture2D(sceneInverse,vec2(gl_FragCoord.x/sceneViewport.x,1.-gl_FragCoord.y/sceneViewport.y)).r;
        float sceneZ=.01*100./(100.-gl_FragCoord.z*(100.-.01));
        if(!(sceneInv>.01)||sceneZ>1./sceneInv+.015)discard;`);
    };
    material.customProgramCacheKey=()=> 'scene-occlusion-v1';
  }
  setScan(scan) {
    const T=this.T;
    for(const group of this.groups){this.scene.remove(group);group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}
    this.groups=[];this.effects=[];this.meshes=[];
    for(const object of scan.objects) {
      const group=new T.Group(), s=object.size;
      const geometry=object.shape==='cube'?new T.BoxGeometry(s,s,s):object.shape==='sphere'?new T.SphereGeometry(s/2,20,12):new T.CylinderGeometry(s/2,s/2,s,20);
      const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({color:[0xee9e52,0x65bde3,0xc195e7][object.id],roughness:.65}));
      mesh.position.set(0,s/2,0);group.add(mesh);
      // Cheap contact shadow lies on the support plane, with its own depth.
      const shadow=new T.Mesh(new T.CircleGeometry(s*.48,24),new T.MeshBasicMaterial({color:0x161020,transparent:true,opacity:.22,depthWrite:true}));
      shadow.rotation.x=-Math.PI/2;shadow.position.y=.002;group.add(shadow);
      this.placeGroup(group,object);
      const effect=new TouchEffects(T,group,mesh,object,this.sprite);effect.setEnabled(this.touchEnabled);this.effects.push(effect);
      group.traverse(child=>{if(child.material)this.occludeMaterial(child.material);});
      this.scene.add(group);this.groups.push(group);this.meshes.push(mesh);
    }
  }
  placeGroup(group,object) {
    const T=this.T,[u,v]=basis(object.normal);
    const orientation=new T.Matrix4().makeBasis(new T.Vector3(...u),new T.Vector3(...object.normal),new T.Vector3(...v).negate());
    group.position.fromArray(object.support);group.quaternion.setFromRotationMatrix(orientation);
  }
  moveObject(object) {
    const i=this.effects.findIndex(e=>e.object.id===object.id);if(i<0)return;
    this.placeGroup(this.groups[i],object);this.effects[i].object=object;
  }
  clearTouch(id){const e=this.effects.find(e=>e.object.id===id);if(e)e.started=-Infinity;}
  pick(x,y,visible) {
    this.scene.updateMatrixWorld(true);this.camera.updateMatrixWorld(true);
    this.raycaster.setFromCamera(new this.T.Vector2(x*2-1,1-y*2),this.camera);
    const {data,width,height}=this.depth.image;
    const inv=data[Math.min(height-1,Math.floor(y*height))*width+Math.min(width-1,Math.floor(x*width))];
    if(!(inv>.01))return null;
    const hits=this.raycaster.intersectObjects(this.meshes.filter((_,i)=>visible[i]),false);
    const hit=hits.find(h=>-h.point.z<=1/inv+.015);
    return hit?{id:this.effects[this.meshes.indexOf(hit.object)].object.id,point:hit.point.toArray()}:null;
  }
  setDepth(data,width,height) {
    this.depth.image={data,width,height};this.depth.needsUpdate=true;
  }
  setTouchEnabled(enabled){this.touchEnabled=enabled;this.effects.forEach(effect=>effect.setEnabled(enabled));}
  touch(event){this.effects.find(effect=>effect.object.id===event.object_id)?.trigger(event);}
  render(width,height,visible=[],now=performance.now(),contacts=[]) {
    this.sceneViewport.value.set(width,height);
    if(this.canvas.width!==width||this.canvas.height!==height){this.renderer.setSize(width,height,false);this.target.setSize(width,height);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();}
    this.groups.forEach((g,i)=>g.visible=!!visible[i]);
    this.effects.forEach(effect=>effect.update(now,contacts.find(c=>c.id===effect.object.id),height));
    this.renderer.setRenderTarget(this.target);this.renderer.clear();this.renderer.render(this.scene,this.camera);
    this.renderer.setRenderTarget(null);this.renderer.clear();this.renderer.render(this.composite,this.screenCamera);
    return this.canvas;
  }
  dispose(){this.canvas.removeEventListener('webglcontextlost',this.onLost);this.setScan({objects:[]});this.sprite.dispose();this.target.dispose();this.depth.dispose();this.quad.geometry.dispose();this.material.dispose();this.renderer.dispose();this.renderer.forceContextLoss();}
}

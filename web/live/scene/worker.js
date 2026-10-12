import {prepareAssets} from './assets.js';
import {reconstruct} from './geometry.js';
let models, assets, api, busy=false;
let scanFrames=[], scanGeneration, scanSource;
const send=(request,payload,transfer=[])=>postMessage({source:request.source,generation:request.generation,id:request.id,timestamp:request.timestamp,...payload},transfer);
function dispose(value) { for(const v of Object.values(value||{}))if(v?.dispose)v.dispose(); }
async function initialize(request) {
  if(!navigator.gpu)throw new Error('3D objects need Chrome with WebGPU');
  const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw new Error('WebGPU adapter unavailable');
  assets=await prepareAssets(p=>send(request,{type:'status',...p}));
  api=await import(assets.url('runtime/transformers.min.js'));
  const {env}=api;
  env.allowRemoteModels=false;env.allowLocalModels=true;env.localModelPath=assets.modelRoot;
  env.useBrowserCache=false;env.useCustomCache=true;
  env.customCache={match:async url=> {
    const path=String(url);
    if(!path.startsWith(assets.modelRoot))return undefined;
    try{return await assets.get('models/'+path.slice(assets.modelRoot.length));}catch{return undefined;}
  },put:async()=>{}};
  env.backends.onnx.wasm.wasmPaths={mjs:assets.url('runtime/ort-wasm-simd-threaded.jsep.mjs'),wasm:assets.url('runtime/ort-wasm-simd-threaded.jsep.wasm')};
  env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
  models={};
  // Sequential model creation bounds peak allocation and avoids GPU contention.
  for(const [name,Class] of [['depth',api.AutoModelForDepthEstimation],['segmentation',api.AutoModelForSemanticSegmentation]]) {
    send(request,{type:'status',phase:'loading',message:`Loading ${name} model…`});
    models[name]=await Class.from_pretrained(assets.lock.models[name].id,{device:'webgpu',dtype:'fp32',local_files_only:true,
      session_options:{executionProviders:['webgpu']}});
  }
  // ORT exposes the actual device after creating a WebGPU session.
  const device=env.backends.onnx.webgpu.device;
  device?.lost.then(info=>send(request,{type:'fatal',message:'WebGPU device lost: '+info.message}));
  send(request,{type:'ready',provenance:{...assets.lock,files:assets.lock.files.map(({path,sha256})=>({path,sha256})),lock_sha256:assets.hash,local:assets.local},three:assets.url('three/three.module.js')});
}
function inputTensor(bitmap,size,config) {
  // Explicit stretch with no crop/pad. The same normalized source coordinates
  // invert both model transforms, including non-square cameras.
  const c=new OffscreenCanvas(size.width,size.height),ctx=c.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(bitmap,0,0,c.width,c.height);
  const pixels=ctx.getImageData(0,0,c.width,c.height).data, n=c.width*c.height, data=new Float32Array(3*n);
  for(let i=0;i<n;i++)for(let k=0;k<3;k++)data[k*n+i]=(pixels[i*4+k]/255-config.image_mean[k])/config.image_std[k];
  return {pixel_values:new api.Tensor('float32',data,[1,3,c.height,c.width])};
}
function sample(data,w,h,x,y,channel=0) {
  const px=Math.max(0,Math.min(w-1,x*w-.5)),py=Math.max(0,Math.min(h-1,y*h-.5));
  const ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy,base=channel*w*h;
  const a=base+iy*w+ix,b=base+Math.min(h-1,iy+1)*w+ix;
  return (data[a]*(1-fx)+data[base+iy*w+Math.min(w-1,ix+1)]*fx)*(1-fy)+(data[b]*(1-fx)+data[base+Math.min(h-1,iy+1)*w+Math.min(w-1,ix+1)]*fx)*fy;
}
let configs;
async function infer(request) {
  const started=performance.now(), bitmap=request.image;
  let inputs,output;
  try {
    if(!configs) {
      configs={};for(const name of ['depth','segmentation'])configs[name]=await (await assets.get('models/'+assets.lock.models[name].id+'/preprocessor_config.json')).json();
    }
    const settings=assets.lock.processing,w=settings.grid_width,h=Math.max(32,Math.round(w*bitmap.height/bitmap.width));
    inputs=inputTensor(bitmap,settings.depth_size,configs.depth); output=await models.depth(inputs);
    const t=output.predicted_depth,dims=t.dims,dh=dims.at(-2),dw=dims.at(-1),depth=new Float32Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)depth[y*w+x]=sample(t.data,dw,dh,(x+.5)/w,(y+.5)/h);
    dispose(output);output=null;dispose(inputs);inputs=null;
    const depthMs=performance.now()-started;
    let labels,confidence;
    if(request.scan) {
      inputs=inputTensor(bitmap,settings.segmentation_size,configs.segmentation);output=await models.segmentation(inputs);
      const logits=output.logits,[,channels,sh,sw]=logits.dims, values=new Float32Array(channels);
      labels=new Uint8Array(w*h);confidence=new Float32Array(w*h);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
        let max=-Infinity,label=0,total=0;
        for(let k=0;k<channels;k++){const v=sample(logits.data,sw,sh,(x+.5)/w,(y+.5)/h,k);values[k]=v;if(v>max){max=v;label=k;}}
        for(const v of values)total+=Math.exp(v-max);
        labels[y*w+x]=label;confidence[y*w+x]=1/total;
      }
    }
    const c=new OffscreenCanvas(w,h),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,w,h);
    const pixels=ctx.getImageData(0,0,w,h).data,rgb=new Uint8Array(w*h);
    for(let i=0;i<rgb.length;i++)rgb[i]=Math.round(.299*pixels[i*4]+.587*pixels[i*4+1]+.114*pixels[i*4+2]);
    const transforms={source:[bitmap.width,bitmap.height],depth:{size:settings.depth_size,padding:0,resize:'stretch'},segmentation:{size:settings.segmentation_size,padding:0,resize:'stretch'}};
    let scanResult;
    if(request.scan) {
      if(scanGeneration!==request.generation||scanSource!==request.source){scanFrames=[];scanGeneration=request.generation;scanSource=request.source;}
      // Own these small grid arrays: the returned buffers transfer to the UI.
      scanFrames.push({width:w,height:h,depth:depth.slice(),labels:labels.slice(),confidence:confidence.slice(),rgb:rgb.slice(),
        person:request.person?{...request.person,data:request.person.data.slice()}:null});
      if(scanFrames.length===3){scanResult=reconstruct(scanFrames);scanFrames=[];}
    }
    send(request,{type:'result',width:w,height:h,depth,labels,confidence,rgb,person:request.person,touchPose:request.touchPose,transforms,scanResult,timings:{depth_ms:depthMs,total_ms:performance.now()-started}},
      [depth.buffer,rgb.buffer,...(labels?[labels.buffer,confidence.buffer]:[]),...(request.person?[request.person.data.buffer]:[])]);
  } finally {dispose(output);dispose(inputs);bitmap.close();}
}
self.onmessage=async ({data:request})=> {
  if(busy){request.image?.close();send(request,{type:'fatal',message:'Scene inference queue overflow'});return;}
  busy=true;
  try {if(request.type==='init')await initialize(request);else if(request.type==='infer')await infer(request);}
  catch(error){send(request,{type:'fatal',message:error.message||String(error)});}
  finally{busy=false;}
};

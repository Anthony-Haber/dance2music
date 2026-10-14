// Deterministic movement fixtures rendered by the application's actual synth.
// These are test inputs, never substitutes for MRT2's generated output.
import {Engine} from '../web/live/audio.js';
import {defaults, evaluate, DESTS} from '../web/live/mapping.js';

export async function magentaInput(variant) {
  const engine=new Engine(),ctx=new OfflineAudioContext(2,480000,48000);
  engine.ctx=ctx;
  await engine.start();
  engine.setTimbre(variant?'glass':'organ');
  const values=defaults();
  const steps=[];
  for(let i=0;i<100;i++)steps.push(ctx.suspend(i*.1).then(()=>{
    const t=i*.1,pulse=.3+.25*Math.sin(t*(variant?3:1));
    if(i%20===0)engine.setChord((variant?['ii','V','ii','I']:['I','ii','V','I'])[Math.floor(i/20)%4]);
    const f={hands:pulse,body:pulse,weight:pulse,flow:variant?.7:.1,space:.8,travel:.5,
      energy:pulse,height:.6,spread:.5,lateral:.5,rhythm:0,tempoN:.5,bounce:0,
      events:i%(variant?4:10)===0?[{part:variant?'rhand':'lfoot',strength:.7,x:.5}]:[]};
    engine.update(f,evaluate(values,f),DESTS,false,{hits:!!variant,groove:false,bounce:false});
    ctx.resume();
  }));
  const [audio]=await Promise.all([ctx.startRendering(),...steps]);
  const pcm=new Float32Array(audio.length*2),l=audio.getChannelData(0),r=audio.getChannelData(1);
  for(let i=0;i<audio.length;i++){pcm[i*2]=l[i];pcm[i*2+1]=r[i];}
  const bytes=new Uint8Array(pcm.buffer);
  let binary='';
  for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return btoa(binary);
}

// Exercise the shipped processor code at different device rates, without
// depending on the audio hardware's current sample rate.
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
export async function runWorkletTests(){
  const source=await(await fetch('/live/magenta-worklet.js')).text();
  for(const rate of [44100,48000,96000]){
    const processors={};
    class Processor {constructor(){this.sent=[];this.port={postMessage:data=>this.sent.push(data)};}}
    new Function('AudioWorkletProcessor','registerProcessor','sampleRate','currentTime',source)(Processor,(name,p)=>processors[name]=p,rate,0);
    const Capture=processors['d2m-body-capture'],Playback=processors['d2m-magenta-playback'];
    const capture=new Capture();let captured=0,zeros=0;
    for(let n=0;n<rate*2;n+=128){
      const size=Math.min(128,rate*2-n),left=Float32Array.from({length:size},(_,i)=>.2*Math.sin(2*Math.PI*997*(n+i)/rate)),right=left.map(v=>-v),out=[new Float32Array(size).fill(1),new Float32Array(size).fill(1)];
      capture.process([[left,right]],[out]);assert(out.every(a=>a.every(v=>v===0)),'capture never monitors or feeds back input');
      for(const data of capture.sent.splice(0)){
        captured+=data.samples.length/2;
        for(let i=2;i<data.samples.length;i+=2){if(data.samples[i-2]<0&&data.samples[i]>=0)zeros++;assert(Math.abs(data.samples[i]+data.samples[i+1])<1e-6,'stereo capture preserved');}
        capture.port.onmessage({data:{type:'ack'}});
      }
    }
    assert(captured>=95000&&captured<=96000&&Math.abs(zeros-997*captured/48000)<6,`capture resamples ${rate} to 48 kHz without pitch drift (${captured} frames, ${zeros} cycles)`);
    const stalled=new Capture();
    for(let i=0;i<1000;i++)stalled.process([[new Float32Array(128)]],[[new Float32Array(128)]]);
    assert(stalled.sent.length===5,'capture MessagePort is bounded during a stalled main thread');
    const player=new Playback();let sourceFrame=0,outputFrame=0,positive=0,previous=0;
    const push=()=>{const samples=Float32Array.from({length:1920},(_,i)=>(i%2?-1:1)*.2*Math.sin(2*Math.PI*997*(sourceFrame+Math.floor(i/2))/48000));sourceFrame+=960;player.port.onmessage({data:{type:'pcm',samples}});};
    for(let i=0;i<8;i++)push();
    while(outputFrame<rate*2){
      if(player.count<7000)push();
      const left=new Float32Array(128),right=new Float32Array(128);player.process([],[ [left,right] ]);
      for(let i=0;i<128;i++){assert(Number.isFinite(left[i])&&Math.abs(left[i]+right[i])<1e-6,'stereo output is finite and preserved');if(previous<0&&left[i]>=0)positive++;previous=left[i];}
      outputFrame+=128;
    }
    assert(Math.abs(positive-1994)<5&&player.underruns===0,`48 kHz playback resamples to ${rate} without pitch drift`);
    for(let i=0;i<100;i++){push();assert(player.count<=8640,'playback ring leaves space within the 500 ms total budget for native/transport buffers');}
    assert(player.dropped>0,'overflow drops old audio instead of accumulating delay');
    player.port.onmessage({data:{type:'flush'}});assert(player.count===0&&player.buffering,'stop/capture flushes playback');
    const silent=[new Float32Array(128),new Float32Array(128)];player.process([],[silent]);assert(silent.every(c=>c.every(v=>v===0)),'flushed output is silent');
  }
  return '44.1/48/96 kHz capture and playback, stereo/pitch preservation, no capture monitor, bounded transport/ring and flush';
}

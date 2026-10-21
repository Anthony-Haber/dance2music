// The capture node receives only the original synth mix, before monitor/master.
// It never receives this module's playback output or microphone audio.
class BodyCapture extends AudioWorkletProcessor {
  constructor(){super();this.n=0;this.next=0;this.last=[0,0];this.block=new Float32Array(1920);this.used=0;this.enabled=true;this.pending=0;this.sequence=0;
    this.port.onmessage=e=>{if(e.data.type==='stop')this.enabled=false;if(e.data.type==='ack')this.pending=Math.max(0,this.pending-1);};}
  process(inputs,outputs){
    for(const channel of outputs[0]||[])channel.fill(0);
    const channels=inputs[0];if(!this.enabled||!channels?.length)return this.enabled;
    const l=channels[0],r=channels[1]||l;
    for(let i=0;i<l.length;i++,this.n++){
      while(this.n>0&&this.next<=this.n){
        const t=this.next-(this.n-1);
        this.block[this.used++]=this.last[0]+(l[i]-this.last[0])*t;
        this.block[this.used++]=this.last[1]+(r[i]-this.last[1])*t;
        this.next+=sampleRate/48000;
        if(this.used===1920){
          this.sequence++;
          if(this.pending<5){this.pending++;this.port.postMessage({samples:this.block,time:currentTime*1000,sequence:this.sequence},[this.block.buffer]);this.block=new Float32Array(1920);}
          this.used=0;
        }
      }
      this.last[0]=l[i];this.last[1]=r[i];
    }
    return true;
  }
}
class MagentaPlayback extends AudioWorkletProcessor {
  constructor(){super();this.capacity=8640;this.ring=new Float32Array(this.capacity*2);this.head=0;this.count=0;this.phase=0;this.buffering=true;this.fade=0;this.last=[0,0];this.underruns=0;this.dropped=0;this.ticks=0;
    this.port.onmessage=({data})=>{
      if(data.type==='flush'){this.head=this.count=0;this.phase=0;this.buffering=true;this.fade=0;this.last=[0,0];if(data.resetMetrics){this.underruns=this.dropped=this.ticks=0;}return;}
      if(data.type!=='pcm')return;
      this.port.postMessage({type:'ack',sequence:data.sequence,generation:data.generation});
      const pcm=data.samples,frames=pcm.length/2;if(frames>this.capacity)return;
      if(this.count+frames>this.capacity){this.count=Math.min(this.count,5760);this.dropped++;this.fade=0;}
      for(let i=0;i<frames;i++){this.ring[this.head*2]=pcm[i*2];this.ring[this.head*2+1]=pcm[i*2+1];this.head=(this.head+1)%this.capacity;}
      this.count+=frames;
    };}
  process(_,outputs){
    const [l,r]=outputs[0];
    if(this.buffering&&this.count>=5760){this.buffering=false;this.fade=0;this.phase=0;}
    for(let i=0;i<l.length;i++){
      if(!this.buffering&&this.count<2){this.buffering=true;this.underruns++;}
      if(this.buffering){this.fade=Math.max(0,this.fade-1/(sampleRate*.005));l[i]=this.last[0]*this.fade;r[i]=this.last[1]*this.fade;continue;}
      const a=(this.head+this.capacity-this.count)%this.capacity,b=(a+1)%this.capacity;
      this.fade=Math.min(1,this.fade+1/(sampleRate*.005));
      for(let c=0;c<2;c++)this.last[c]=this.ring[a*2+c]+(this.ring[b*2+c]-this.ring[a*2+c])*this.phase;
      l[i]=this.last[0]*this.fade;r[i]=this.last[1]*this.fade;
      this.phase+=48000/sampleRate;const consumed=Math.floor(this.phase);this.phase-=consumed;this.count=Math.max(0,this.count-consumed);
    }
    this.ticks+=l.length;
    if(this.ticks>=sampleRate){this.ticks=0;this.port.postMessage({type:'playback-metrics',underruns:this.underruns,dropped:this.dropped,buffer_ms:this.count/48});}
    return true;
  }
}
registerProcessor('d2m-body-capture',BodyCapture);
registerProcessor('d2m-magenta-playback',MagentaPlayback);

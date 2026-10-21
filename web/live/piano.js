const LOCK=new URL('./piano-assets.lock.json',import.meta.url),ROOT=new URL('./vendor/piano/',import.meta.url);
const hash=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
const preparation='Run python live.py --offline --without-magenta, then retry Floor Piano.';
export async function loadPiano(ctx,{signal,progress=()=>{}}={}) {
  try {
    const response=await fetch(LOCK,{signal,cache:'no-cache'});if(!response.ok)throw new Error('manifest missing');
    const bytes=await response.arrayBuffer(),lock=JSON.parse(new TextDecoder().decode(bytes)),buffers=new Map();
    for(const [i,asset] of lock.files.entries()) {
      progress(`Loading piano samples ${Math.min(i+1,5)}/5…`);
      const res=await fetch(new URL(asset.path,ROOT),{signal,cache:'no-cache'});if(!res.ok)throw new Error(asset.path+' missing');
      const data=await res.arrayBuffer();if(data.byteLength!==asset.size||await hash(data)!==asset.sha256)throw new Error(asset.path+' checksum mismatch');
      if(asset.midi){
        const buffer=await ctx.decodeAudioData(data);signal?.throwIfAborted();
        if(!buffer.length||!buffer.duration)throw new Error(asset.path+' could not be decoded');
        buffers.set(asset.midi,buffer);
      }
    }
    return {buffers,provenance:{...lock,manifest_sha256:await hash(bytes)}};
  }catch(error){if(error.name==='AbortError')throw error;throw new Error(`Piano samples unavailable (${error.message}). ${preparation}`);}
}
export function samplePitch(midi,roots=[60,63,66,69,72]) {
  const root=roots.reduce((a,b)=>Math.abs(midi-a)<=Math.abs(midi-b)?a:b);
  return {root,rate:2**((midi-root)/12)};
}
export class PianoPlayer {
  constructor(engine){this.engine=engine;this.held=new Map();this.voices=new Set();this.events=[];this.listening='piano-only';this.loadGeneration=0;}
  async load(progress){
    this.cancelLoad();const generation=this.loadGeneration;this.abort=new AbortController();
    const result=await loadPiano(this.engine.ctx,{signal:this.abort.signal,progress});
    if(generation!==this.loadGeneration)return false;
    Object.assign(this,result);return true;
  }
  cancelLoad(){this.loadGeneration++;this.abort?.abort();this.abort=null;}
  log(event){this.events.push(event);if(this.events.length>4096)this.events.splice(0,this.events.length-4096);}
  takeEvents(since=0){return this.events.splice(0).filter(e=>e.timestamp_ms>=since).map(e=>({...e,timestamp_s:(e.timestamp_ms-since)/1000}));}
  setListening(choice,active=true){
    this.listening=choice==='piano-body'?'piano-body':'piano-only';
    this.engine.movementLevel(active&&this.listening==='piano-only'?0:1);
    if(active)this.log({type:'piano-listening',listening:this.listening,timestamp_ms:performance.now()});
  }
  event(event,epoch) {
    if(event.session!==epoch.session||event.generation!==epoch.generation||event.source!==epoch.source)return null;
    const ctx=this.engine.ctx,key=event.key_id;
    if(event.type==='piano-note-off'){this.release(key);this.log(event);return event;}
    if(event.type==='piano-ownership'){this.log(event);return event;}
    if(event.type!=='piano-note-on'||!ctx||!this.buffers||!this.engine.layers.objects||this.held.has(key)||event.midi<60||event.midi>72)return null;
    const {root,rate}=samplePitch(event.midi,[...this.buffers.keys()]);
    const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=this.buffers.get(root);source.playbackRate.value=rate;source.loop=false;
    gain.gain.value=.7;source.connect(gain).connect(this.engine.layers.objects);
    const voice={source,gain,ended:false,released:false,finish:()=>{if(voice.ended)return;voice.ended=true;try{source.stop();}catch{}source.disconnect();gain.disconnect();this.voices.delete(voice);}};
    // Two held notes plus short release tails, with a hard cap for rapid steps.
    if(this.voices.size>=8)[...this.voices].find(v=>v.released)?.finish();
    if(this.voices.size>=8)[...this.voices][0].finish();
    this.voices.add(voice);this.held.set(key,voice);source.onended=voice.finish;source.start();
    const result={...event,sound:{root_midi:root,playback_rate:rate,attack_gain:.7,audio_time_s:ctx.currentTime}};this.log(result);return result;
  }
  release(key){
    const voice=this.held.get(key);this.held.delete(key);if(!voice||voice.ended)return;
    voice.released=true;const t=this.engine.ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(t);voice.gain.gain.setValueAtTime(voice.gain.gain.value,t);voice.gain.gain.linearRampToValueAtTime(0,t+.15);voice.source.stop(t+.15);
  }
  stop(){this.cancelLoad();for(const key of this.held.keys())this.release(key);}
  dispose(){this.stop();for(const voice of [...this.voices])voice.finish();this.buffers=null;}
  configuration(){return {listening:this.listening,samples:this.provenance||null,held_keys:[...this.held.keys()],attack_gain:.7,damping_ms:150};}
}

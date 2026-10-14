// Bounded, self-disposing Web Audio percussion; no samples or downloads.
// Membranes use falling pitches and partials, metal uses inharmonic resonances.
export function percussionVoice(ctx,noiseBuffer,destination,kind,t,velocity=1,pan=0,onEnd=()=>{}) {
  const out=ctx.createStereoPanner();out.pan.value=Math.max(-1,Math.min(1,pan));out.connect(destination);
  const nodes=[out],sources=[];let remaining=0,done=false;
  const finish=()=>{if(done)return;done=true;for(const s of sources){s.onended=null;try{s.stop();}catch{}}for(const n of nodes)n.disconnect();onEnd(finish);};
  const peak=.35+.65*Math.max(0,Math.min(1,velocity));
  const envelope=(gain,duration)=>{
    const g=ctx.createGain();g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(gain*peak,t+.003);
    g.gain.exponentialRampToValueAtTime(.0001,t+duration);g.connect(out);nodes.push(g);return g;
  };
  const run=(s,duration)=>{sources.push(s);nodes.push(s);remaining++;s.onended=()=>{if(--remaining===0)finish();};s.start(t);s.stop(t+duration+.02);};
  const tone=(hz,end,gain,duration,type='sine')=>{
    const o=ctx.createOscillator();o.type=type;o.frequency.setValueAtTime(hz,t);
    if(end!==hz)o.frequency.exponentialRampToValueAtTime(end,t+Math.min(.12,duration*.6));
    o.connect(envelope(gain,duration));run(o,duration);
  };
  const noise=(hz,gain,duration,type='bandpass')=>{
    const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter();source.buffer=noiseBuffer;
    filter.type=type;filter.frequency.value=hz;filter.Q.value=.8;nodes.push(filter);
    source.connect(filter).connect(envelope(gain,duration));run(source,duration);
  };
  if(kind==='kick')tone(150,45,.9,.4);
  else if(kind==='snare'){noise(1800,.5,.18);tone(185,185,.35,.1,'triangle');}
  else if(kind==='hat')noise(7000,.25,.05,'highpass');
  else if(kind==='conga'){tone(260,170,.55,.38);tone(430,390,.16,.16);noise(1600,.12,.025);}
  else if(kind==='bongo'){tone(520,330,.48,.22);tone(810,710,.13,.09);noise(2200,.15,.018);}
  else if(kind==='djembe'){tone(180,85,.65,.5);tone(350,240,.18,.2);noise(1200,.2,.05);}
  else if(kind==='cowbell'){tone(540,540,.17,.3,'square');tone(800,800,.12,.23,'square');}
  else if(kind==='triangle')for(const [hz,gain,decay] of [[1800,.23,1.8],[2630,.13,1.3],[4270,.09,.9],[6310,.045,.5]])tone(hz,hz,gain,decay);
  else if(kind==='cymbal'){
    noise(4800,.35,1.3,'highpass');
    for(const hz of [740,1130,1690,2380,3310,4570])tone(hz,hz,.025,.9,'square');
  }else {finish();return finish;}
  return finish;
}

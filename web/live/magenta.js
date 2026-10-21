import {MagentaSpatial,capturePlacement,randomPrompts,PROMPT_COLORS} from './magenta-spatial.js';
import {localDesktop} from './app-availability.js';
const $=id=>document.getElementById(id);
const defaults=()=>({prompts:randomPrompts(),input:'audio-notes',listening:'blend',tracking:'keep',model:'auto',influence:35,blend:0,original:-6,generated:-6});
const options={input:['audio-notes','audio','continue'],listening:['blend','both'],tracking:['keep','fade'],model:['auto','base','small']};
export function settings(saved){
  const result=defaults();
  for(const [key,choices] of Object.entries(options))if(choices.includes(saved?.[key]))result[key]=saved[key];
  for(const key of ['influence','blend','original','generated'])if(Number.isFinite(saved?.[key]))result[key]=Math.max(key==='original'||key==='generated'?-60:0,Math.min(key==='original'||key==='generated'?6:100,saved[key]));
  if(Array.isArray(saved?.prompts)&&saved.prompts.length===3&&saved.prompts.every(p=>typeof p==='string'&&p.trim()&&p.length<=250))result.prompts=[...saved.prompts];
  return result;
}
export function listeningGains(s){return s.listening==='both'?[10**(s.original/20),10**(s.generated/20)]:[Math.sin(s.blend/100*Math.PI/2),Math.cos(s.blend/100*Math.PI/2)];}

export class MagentaScene {
  constructor(engine,scene,{store,mirror=()=>false,onChange=()=>{}}){
    Object.assign(this,{engine,scene,store,mirror,onChange});this.settings=settings(store.get('magenta',null));this.store.set('magenta',this.settings);
    this.spatial=new MagentaSpatial();this.states=['ready','ready','ready'];this.revisions=[0,0,0];this.appliedTexts=[...this.settings.prompts];this.events=[];this.owners=new Map();this.generation=0;this.poses=[];
    this.scene.onLabelClick=id=>id===3?this.capture('label'):this.edit(id);
    this.ui();
  }
  ui(){
    const panel=$('magentaControls');
    this.fields=this.settings.prompts.map((text,i)=>{
      const row=document.createElement('div');row.className='magenta-prompt';row.style.borderColor=PROMPT_COLORS[i];
      const label=document.createElement('label');label.textContent='Prompt '+(i+1);
      const input=document.createElement('textarea');input.value=text;input.maxLength=250;input.rows=2;input.id='magentaPrompt'+i;input.setAttribute('aria-label','Magenta prompt '+(i+1));label.append(input);
      const button=document.createElement('button');button.type='button';button.textContent='Apply';button.onclick=()=>this.prompt(i,input.value);
      const state=document.createElement('span');state.className='status';state.setAttribute('role','status');
      const meter=document.createElement('meter');meter.min=0;meter.max=1;meter.value=1/3;meter.setAttribute('aria-label','Prompt '+(i+1)+' influence');
      row.append(label,button,state,meter);$('magentaPrompts').append(row);return {input,state,meter};
    });
    for(const key of Object.keys(options)){
      const el=$('magenta-'+key);el.value=this.settings[key];el.onchange=()=>this.change(key,el.value);
    }
    for(const key of ['influence','blend','original','generated']){
      const el=$('magenta-'+key);el.value=this.settings[key];el.oninput=()=>this.change(key,+el.value);
    }
    $('magentaRandomize').onclick=()=>randomPrompts().forEach((text,i)=>this.prompt(i,text));
    $('magentaCapture').onclick=()=>this.capture('button');
    $('magentaEditorApply').onclick=()=>{if(this.prompt(this.editing,$('magentaEditorText').value))$('magentaEditor').close();};
    $('magentaEditorCancel').onclick=()=>$('magentaEditor').close();
    panel.addEventListener('keydown',e=>e.stopPropagation());
    $('magentaEditor').addEventListener('keydown',e=>e.stopPropagation());
    this.refresh();
  }
  edit(index){if(index<0||index>2)return;this.editing=index;$('magentaEditorText').value=this.settings.prompts[index];$('magentaEditor').showModal();$('magentaEditorText').focus();}
  prompt(index,text){
    text=text.trim();if(!text||text.length>250)return false;
    this.settings.prompts[index]=text;this.fields[index].input.value=text;this.revisions[index]++;
    this.states[index]=this.active?'encoding':'ready';
    this.send({type:'prompt',index,text,revision:this.revisions[index]});
    this.record('prompt-edit',{index,text,revision:this.revisions[index]});this.save();this.refresh();return true;
  }
  change(key,value){
    this.settings[key]=value;this.save();
    if(key==='input'){
      this.release();this.send({type:'input',mode:this.settings.input,influence:this.settings.influence/100});this.syncNotes();this.placementKey=null;
    }
    if(key==='influence')this.send({type:'influence',value:this.settings.influence/100});
    if(key==='model'&&this.active&&this.canConnect)this.connect(value==='auto'?'base':value,'requested model change').catch(error=>this.fail(error.message));
    if(key==='tracking')this.engine.magentaTrackingLost(this.lost&&value==='fade');
    this.mix();this.refresh();
  }
  save(){this.store.set('magenta',this.settings);this.onChange();}
  refresh(){
    $('magentaBlendRow').hidden=this.settings.listening!=='blend';$('magentaBoth').hidden=this.settings.listening!=='both';
    $('magentaInfluenceRow').hidden=this.settings.input==='continue';$('magentaCaptureRow').hidden=this.settings.input!=='continue';
    $('magentaCapture').disabled=!this.ready||!this.captureReady||this.preparing;
    $('magentaCaptureStatus').textContent=this.preparing?'Preparing continuation…':this.captureState||'Needs four seconds of audible body music.';
    for(const key of ['influence','blend','original','generated'])$('magenta-'+key+'-value').textContent=this.settings[key]+(['original','generated'].includes(key)?' dB':'%');
    this.fields.forEach((f,i)=>{f.state.textContent=this.states[i]==='ready'?'':this.states[i];f.meter.value=this.spatial.weights[i];});
    this.scene.magentaDisplay={prompts:this.settings.prompts,states:this.states,weights:this.spatial.weights,mirror:this.mirror(),capture:this.preparing?'processing':this.captureReady?'ready':'listening'};
  }
  status(message){$('magentaStatus').textContent=message;}
  record(type,data={}){this.events.push({...data,type,timestamp_ms:performance.now()});if(this.events.length>512)this.events.shift();}
  takeEvents(since=0){return this.events.splice(0).filter(e=>e.timestamp_ms>=since).map(e=>({...e,timestamp_s:(e.timestamp_ms-since)/1000}));}
  configuration(){return {...this.settings,prompts:[...this.settings.prompts],applied_prompts:[...this.appliedTexts],requested_model:this.settings.model,effective_model:this.effective||null,
    spatial_available:!!this.spatial.available,provenance:this.provenance||null,reference_latency_ms:this.referenceLatency??null,phrase_latency_ms:this.phraseLatency??null};}
  send(value){if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify({...value,session:this.session,generation:this.generation}));}
  mix(){if(!this.active||!this.ready||this.preparing){this.engine.magentaMix(1,0);return;}this.engine.magentaMix(...listeningGains(this.settings));}
  note(event){
    if(!this.active||this.settings.input!=='audio-notes'||this.lost)return;
    if(event.on){
      if(this.owners.get(event.owner)===event.note&&!event.attack)return;
      const previous=this.owners.get(event.owner);if(previous!==undefined)this.note({...event,note:previous,on:false});
      const held=[...this.owners.values()].includes(event.note);this.owners.set(event.owner,event.note);
      if(!held||event.attack){this.send({type:'note',note:event.note,on:true,attack:!!event.attack});this.record('note',{...event});}
    }else{
      if(this.owners.get(event.owner)!==event.note)return;
      this.owners.delete(event.owner);
      if(![...this.owners.values()].includes(event.note)){this.send({type:'note',note:event.note,on:false});this.record('note',{...event});}
    }
  }
  release(){this.send({type:'release'});if(this.owners.size)this.record('notes-released');this.owners.clear();}
  syncNotes(){for(const [owner,note] of this.engine.activeNotes)this.note({owner,note,on:true,time:this.engine.ctx?.currentTime||0});}
  observe(landmarks,now){
    if(!this.active)return;
    this.poses.push(now);this.poses=this.poses.filter(t=>now-t<2000);
    if(landmarks?.some(p=>(p.visibility??0)>=.5&&(p.presence??1)>=.5))this.lastSeen=now;
  }
  async start(){
    if(!localDesktop()){this.status('Google Magenta requires the Dance2Music Mac app.');return;}
    await this.stop();this.active=true;this.ready=false;this.preparing=false;this.switched=false;this.fallbackNotice='';this.lastSeen=performance.now();this.lost=false;
    this.poses=[];this.baseline=0;this.started=performance.now();this.spatial=new MagentaSpatial();this.events=[];this.placementKey=null;
    this.session=crypto.getRandomValues(new Uint32Array(1))[0]||1;const run=this.session;
    this.abort=new AbortController();this.status('Measuring camera throughput before loading MRT2…');
    this.timer=setInterval(()=>this.tick(),50);
    try{
      const response=await fetch('/magenta/status',{headers:{'X-D2M-Local':'1'},signal:this.abort.signal});
      if(!response.ok)throw new Error('Open Dance2Music and complete setup, then reload this page.');
      const status=await response.json();if(!status.ready)throw new Error(status.message);
      if(!this.active||run!==this.session)return;this.token=status.token;this.provenance=status.provenance;
      const ctx=this.engine.ctx;await ctx.audioWorklet.addModule(new URL('./magenta-worklet.js',import.meta.url));
      if(!this.active||run!==this.session)return;
      this.captureNode=new AudioWorkletNode(ctx,'d2m-body-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
      this.playbackNode=new AudioWorkletNode(ctx,'d2m-magenta-playback',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});
      this.engine.originalMix.connect(this.captureNode);this.captureNode.connect(ctx.destination);this.playbackNode.connect(this.engine.magentaTracking);
      this.captureNode.port.onmessage=({data})=>{
        if(run!==this.session)return;
        this.captureNode?.port.postMessage({type:'ack'});
        if(!this.active||run!==this.session||this.ws?.readyState!==WebSocket.OPEN)return;
        const sequence=data.sequence;
        if(this.ws.bufferedAmount>192000)return; // at most 500 ms of capture in transport
        const packet=new ArrayBuffer(32+data.samples.byteLength),view=new DataView(packet);
        new Uint8Array(packet,0,4).set([68,50,77,50]);
        view.setUint32(4,this.session,true);view.setUint32(8,this.generation,true);view.setUint32(12,sequence,true);view.setFloat64(16,data.time,true);view.setUint32(24,48000,true);view.setUint32(28,data.samples.length/2,true);
        new Float32Array(packet,32).set(data.samples);this.ws.send(packet);
      };
      this.playbackNode.port.onmessage=({data})=>{
        if(run!==this.session)return;
        if(data.type==='ack'){if(data.generation!==this.generation)return;this.playbackPending=Math.max(0,this.playbackPending-1);this.send({type:'output-ack',sequence:data.sequence});return;}
        const delta=data.underruns-(this.playbackUnderruns||0);this.playbackUnderruns=data.underruns;
        if(delta>0&&this.ready&&!this.preparing)this.underrunTimes.push(...Array(Math.min(delta,10)).fill(performance.now()));
      };
      this.noteCallback=e=>this.note(e);this.engine.noteListeners.add(this.noteCallback);
      // Allow depth's own initial baseline window to finish first.
      const remaining=Math.max(0,4500-(performance.now()-this.started));
      if(remaining)await new Promise(resolve=>setTimeout(resolve,remaining));
      if(!this.active||run!==this.session)return;
      this.baseline=this.poses.length/2;
      this.canConnect=true;
      await this.connect(this.settings.model==='auto'?'base':this.settings.model);
    }catch(error){if(this.active&&run===this.session&&error.name!=='AbortError')this.fail(error.message);}
  }
  async closeSocket(){const ws=this.ws;this.ws=null;if(!ws)return;await new Promise(resolve=>{if(ws.readyState===WebSocket.CLOSED)return resolve();ws.addEventListener('close',resolve,{once:true});ws.close();setTimeout(resolve,2500);});}
  async connect(model,reason){
    const run=this.session;this.ready=false;this.preparing=false;this.release();this.mix();this.playbackNode?.port.postMessage({type:'flush',resetMetrics:true});
    const generation=++this.generation;
    await this.closeSocket();if(!this.active||run!==this.session||generation!==this.generation)return;
    this.effective=model;this.states=['encoding','encoding','encoding'];this.playbackPending=0;this.outputSequence=0;this.outputClockOffset=null;this.lastWeights=null;this.underrunTimes=[];this.playbackUnderruns=0;this.slowSince=null;
    if(reason)this.record('model-change',{requested:this.settings.model,effective:model,reason});
    this.status('Loading MRT2 '+model+'…');
    const query=new URLSearchParams({token:this.token,session:this.session,generation,model});
    const ws=this.ws=new WebSocket('ws://'+location.host+'/magenta/ws?'+query);ws.binaryType='arraybuffer';
    ws.onopen=()=>{if(ws!==this.ws)return;this.settings.prompts.forEach((text,index)=>this.send({type:'prompt',index,text,revision:++this.revisions[index]}));this.send({type:'input',mode:this.settings.input,influence:this.settings.influence/100});this.syncNotes();};
    ws.onmessage=({data})=>{
      if(ws!==this.ws||generation!==this.generation||!this.active)return;
      if(data instanceof ArrayBuffer){
        if(data.byteLength<32)return;const header=new DataView(data),frames=header.getUint32(28,true),sequence=header.getUint32(12,true);
        if(header.getUint32(0,true)!==0x324d3244||header.getUint32(4,true)!==this.session||header.getUint32(8,true)!==generation||header.getUint32(24,true)!==48000||frames>4800||data.byteLength!==32+frames*8||sequence<=this.outputSequence)return;
        this.outputSequence=sequence;
        this.outputClockOffset??=performance.now()-header.getFloat64(16,true);
        const stale=performance.now()-(header.getFloat64(16,true)+this.outputClockOffset)>300;
        if(!stale&&!this.preparing&&this.engine.ctx?.state==='running'&&this.playbackPending<5){this.playbackPending++;this.playbackNode?.port.postMessage({type:'pcm',sequence,generation,samples:new Float32Array(data,32)},[data]);}
        else this.send({type:'output-ack',sequence});return;
      }
      let event;try{event=JSON.parse(data);}catch{return;}
      if(event.session!==this.session||event.generation!==generation)return;
      this.receive(event);
    };
    ws.onclose=()=>{if(ws===this.ws&&this.active){this.ws=null;this.fallback('Local MRT2 helper disconnected');}};
    ws.onerror=()=>{this.status('Local MRT2 connection failed; returning to original music.');};
    this.refresh();this.onChange();
  }
  receive(event){
    const now=performance.now();
    if(event.type==='status'){
      this.status([this.fallbackNotice,event.message].filter(Boolean).join(' · '));
      if(event.state==='ready'){this.ready=true;this.readyAt=now;this.mix();this.syncNotes();}
    }else if(event.type==='prompt'&&event.index<3&&event.revision===this.revisions[event.index]){
      this.states[event.index]=event.state;if(event.state==='ready')this.appliedTexts[event.index]=this.settings.prompts[event.index];
      this.record('prompt-state',event);this.onChange();
    }else if(event.type==='weights-applied')this.record('weights-applied',{weights:event.weights,control_latency_ms:now-event.timestamp});
    else if(event.type==='audio-reference'){
      this.referenceState=event.state;if(event.latency_ms)this.referenceLatency=event.latency_ms;
      $('magentaReferenceStatus').textContent=event.state==='encoding'?'Encoding body audio; previous reference remains active.':event.state==='ready'?`Body audio reference ready (${(event.latency_ms/1000).toFixed(1)} s).`:'Body audio encoding failed; previous reference retained.';
      this.record('audio-reference',event);
    }else if(event.type==='capture'){
      this.captureState=event.state==='complete'?'Continuation ready. Release and touch again to recapture.':event.message||'Preparing continuation…';
      if(event.state==='complete'||event.state==='error'){this.preparing=false;this.phraseLatency=event.latency_ms;this.spatial.captured();this.mix();}
      this.record('capture-state',event);
    }else if(event.type==='flush')this.playbackNode?.port.postMessage({type:'flush'});
    else if(event.type==='metrics'){
      this.captureReady=event.capture_ready;
      if(!this.preparing&&this.captureReady&&!this.captureState)this.captureState='Recent phrase ready.';
    }else if(event.type==='underrun'&&this.ready&&!this.preparing)this.underrunTimes.push(now);
    else if(event.type==='error')this.fallback(event.message);
    this.refresh();
  }
  capture(source){
    if(!this.ready||this.preparing||!this.captureReady||this.settings.input!=='continue')return false;
    this.preparing=true;this.spatial.busy=true;this.captureState='Preparing continuation…';this.release();this.mix();this.playbackNode?.port.postMessage({type:'flush'});
    this.send({type:'capture'});this.record('capture-request',{source});this.refresh();return true;
  }
  tick(){
    if(!this.active)return;const now=performance.now();
    this.poses=this.poses.filter(t=>now-t<2000);
    const lost=now-this.lastSeen>500;
    if(lost!==this.lost){this.lost=lost;if(lost)this.release();else this.syncNotes();this.engine.magentaTrackingLost(lost&&this.settings.tracking==='fade');this.record('tracking',{lost});}
    const key=this.scene.generation+':'+this.settings.input;
    if(this.placementKey!==key&&['active','empty'].includes(this.scene.state)){
      this.placementKey=key;this.scene.endDrag(true);
      this.scene.scan={...this.scene.scan,objects:this.scene.scan.objects.filter(o=>!o.capture)};
      if(this.settings.input==='continue'){
        const extra=capturePlacement(this.scene.scan,this.scene.latest||this.scene.reference);if(extra)this.scene.scan.objects.push(extra);
        $('magentaPlacementStatus').textContent=extra?'Touch the green object, or use the button.':'No capture-object placement available. Use the button.';
      }
      if(this.scene.snapshot)this.scene.snapshot={...this.scene.snapshot,objects:this.scene.scan.objects};
      this.scene.renderer?.setScan(this.scene.scan);this.onChange();
    }
    const touched=this.spatial.update(this.scene,now);if(!lost&&touched)this.capture('body-touch');
    const weights=this.spatial.weights;
    if(this.ws?.readyState===WebSocket.OPEN&&(!this.lastWeights||weights.some((w,i)=>Math.abs(w-this.lastWeights[i])>1e-5))){this.send({type:'weights',weights,timestamp:now});this.lastWeights=[...weights];}
    $('magentaSpatialStatus').textContent=!this.spatial.available?'Spatial control unavailable; using an equal blend of the three prompts.':this.scene.state==='scanning'?'Rescanning; holding the last prompt blend.':!this.scene.latest||now-this.scene.latest.timestamp>200?'Waiting for fresh depth; holding the last prompt blend.':'';
    if(this.ready&&!this.preparing&&!document.hidden&&now-this.readyAt>7000){
      this.underrunTimes=this.underrunTimes.filter(t=>now-t<5000);
      const slow=this.baseline>0&&this.poses.length/2<this.baseline*.85;
      if(slow)this.slowSince??=now;else this.slowSince=null;
      if((this.slowSince&&now-this.slowSince>5000)||this.underrunTimes.length>=6)this.fallback(slow?'Pose throughput fell below 85% of its baseline':'Sustained audio underruns');
    }
    this.refresh();
  }
  fallback(reason){
    if(!this.active||this.switching)return;
    this.record('fallback',{reason,from:this.effective});this.ready=false;this.mix();this.release();this.playbackNode?.port.postMessage({type:'flush'});
    if(this.settings.model==='auto'&&this.effective==='base'&&!this.switched){
      this.fallbackNotice=reason+'; Auto selected Small';
      this.switched=true;this.switching=true;this.status(reason+'; switching to Small…');
      this.connect('small',reason).catch(error=>this.fail(error.message)).finally(()=>this.switching=false);
    }else this.fail(reason+'; continuing original body music.');
  }
  fail(message){this.ready=false;this.release();this.mix();this.closeSocket();this.status('Magenta unavailable: '+message);this.record('failure',{message});this.refresh();}
  async stop(){
    this.release();this.active=false;this.ready=false;this.preparing=false;this.canConnect=false;this.generation++;clearInterval(this.timer);this.abort?.abort();
    this.engine.noteListeners.delete(this.noteCallback);this.noteCallback=null;
    if(this.captureNode){try{this.engine.originalMix?.disconnect(this.captureNode);}catch{}this.captureNode.port.postMessage({type:'stop'});this.captureNode.disconnect();this.captureNode.port.close();this.captureNode=null;}
    if(this.playbackNode){this.playbackNode.port.postMessage({type:'flush'});this.playbackNode.disconnect();this.playbackNode.port.close();this.playbackNode=null;}
    this.engine.magentaMix(1,0);this.engine.magentaTrackingLost(false);this.scene.magentaDisplay=null;
    await this.closeSocket();
  }
}

// Procedural, offline instruments. Coordinates are fractions of the placement
// size: x/z stay inside its footprint, y runs from the support to one size up.
import {pianoScan} from './piano-layout.js';
export const SCENE_MODES=Object.freeze({
  none:{label:'None',instruments:[]}, models:{label:'3D Models',instruments:[]},
  magenta:{label:'Google Magenta',instruments:[]},
  'floor-piano':{label:'Floor Piano',instruments:[]},
  'percussion-kit':{label:'Percussions — Drum kit',instruments:['kick','snare','hat']},
  'percussion-hand':{label:'Percussions — Hand drums',instruments:['conga','bongo','djembe']},
  'percussion-metal':{label:'Percussions — Metallic',instruments:['cowbell','triangle','cymbal']},
});
export const sceneMode=(saved,legacy=false)=>Object.hasOwn(SCENE_MODES,saved)?saved:legacy?'models':'none';
export const isPercussion=mode=>!!SCENE_MODES[mode]?.instruments.length;
export function instrumentScan(scan,mode,{pianoNearCamera=true}={}) {
  if(mode==='floor-piano')return pianoScan(scan,pianoNearCamera);
  const ids=SCENE_MODES[mode]?.instruments||[];
  return {...scan,objects:scan.objects.map((o,i)=>ids[i]?{...o,instrument:ids[i]}:o)};
}
const metal=0xc3ccd6,skin=0xffe6b2,gold=0xe6b648,wood=0xb24d29;
const part=(type,dimensions,position,color,rotation=[0,0,0],contact=true)=>({type,dimensions,position,color,rotation,contact});
const cyl=(rt,rb,h,x,y,z,color,rotation)=>part('cylinder',[rt,rb,h],[x,y,z],color,rotation);
const box=(w,h,d,x,y,z,color)=>part('box',[w,h,d],[x,y,z],color);
const stand=(height=.65)=>[
  cyl(.025,.025,height,0,height/2,0,metal),
  ...[0,Math.PI*2/3,Math.PI*4/3].map(a=>part('rod',[[0,.15,0],[Math.cos(a)*.38,.025,Math.sin(a)*.38],.018],[0,0,0],metal)),
];
const drum=(rt,rb,h,x,y,color)=>[
  cyl(rt,rb,h,x,y,0,color),cyl(rt*1.04,rt*1.04,.035,x,y+h/2,0,metal),
  cyl(rt*.94,rt*.94,.015,x,y+h/2+.02,0,skin),
  cyl(rb*1.04,rb*1.04,.03,x,y-h/2+.02,0,metal),
  ...[-1,1].map(sign=>box(.018,h*.7,.025,x+sign*rt*.9,y,rt*.38,metal)),
];
export const INSTRUMENTS=Object.freeze({
  kick:{label:'Kick drum',parts:[
    cyl(.43,.43,.52,0,.46,0,0xa34030,[Math.PI/2,0,0]),
    cyl(.445,.445,.03,0,.46,.275,metal,[Math.PI/2,0,0]),
    cyl(.41,.41,.02,0,.46,.3,skin,[Math.PI/2,0,0]),
    cyl(.065,.065,.025,.18,.32,.315,0x252933,[Math.PI/2,0,0]),
    ...[-1,1].map(s=>box(.035,.2,.1,s*.38,.1,.17,metal)),
    box(.12,.04,.22,0,.02,.35,metal),
  ]},
  snare:{label:'Snare drum',parts:[...stand(.5),...drum(.39,.39,.28,0,.66,0x5686bb)]},
  hat:{label:'Hi-hat',parts:[...stand(.88),cyl(.045,.045,.12,0,.88,0,metal),
    cyl(.12,.44,.065,0,.76,0,gold),cyl(.1,.44,.065,0,.84,0,gold)]},
  conga:{label:'Conga',parts:drum(.31,.22,.85,0,.445,wood)},
  bongo:{label:'Bongo',parts:[...stand(.48),...drum(.23,.19,.32,-.235,.65,wood),
    ...drum(.19,.16,.28,.235,.65,0xd6933b),box(.1,.1,.1,0,.6,0,metal)]},
  djembe:{label:'Djembe',parts:[...drum(.36,.16,.5,0,.69,0x855333),
    cyl(.15,.27,.43,0,.225,0,wood),
    ...[-1,1].map(s=>part('rod',[[s*.3,.92,.16],[s*.13,.44,.1],.012],[0,0,0],skin))]},
  cowbell:{label:'Cowbell',parts:[...stand(.48),
    part('bell',[],[0,.64,0],0xd39d37,[-Math.PI/2,0,0]),box(.23,.3,.018,0,.64,-.2,0x302828)]},
  triangle:{label:'Triangle',parts:[cyl(.018,.018,.92,.41,.46,0,metal),box(.44,.025,.025,.2,.92,0,metal),
    part('rod',[[.41,.15,0],[.14,.04,.27],.018],[0,0,0],metal),
    part('rod',[[.41,.15,0],[.44,.04,-.3],.018],[0,0,0],metal),
    part('rod',[[0,.92,0],[0,.86,0],.008],[0,0,0],skin),
    part('rod',[[0,.86,0],[-.35,.25,0],.023],[0,0,0],metal),
    part('rod',[[-.35,.25,0],[.35,.25,0],.023],[0,0,0],metal),
    part('rod',[[.35,.25,0],[.06,.76,0],.023],[0,0,0],metal)]},
  cymbal:{label:'Cymbal',parts:[...stand(.79),
    cyl(.08,.47,.065,0,.79,0,gold),cyl(.055,.055,.08,0,.865,0,metal)]},
});

// Contact proxies match actual components, including gaps in a triangle or
// around a stand. Rods use capsules; shells use local boxes/cylinders.
export function contactParts(id) {return INSTRUMENTS[id]?.parts||[];}
export function buildInstrument(T,id,size) {
  return INSTRUMENTS[id].parts.map(p=>{
    const d=p.dimensions;let geometry;
    if(p.type==='cylinder')geometry=new T.CylinderGeometry(d[0]*size,d[1]*size,d[2]*size,24);
    else if(p.type==='box')geometry=new T.BoxGeometry(...d.map(v=>v*size));
    else if(p.type==='bell') {
      // Open tapered rectangular shell, visibly hollow from below.
      geometry=new T.CylinderGeometry(.16*size,.3*size,.38*size,4,1,true);
      geometry.rotateY(Math.PI/4);geometry.scale(1,1,1.35);
    }else geometry=new T.CylinderGeometry(d[2]*size,d[2]*size,new T.Vector3(...d[0]).distanceTo(new T.Vector3(...d[1]))*size,8);
    const material=new T.MeshStandardMaterial({color:p.color,roughness:p.color===skin?.8:.35,metalness:[metal,gold,0xd39d37].includes(p.color)?.65:.12,side:T.DoubleSide});
    const mesh=new T.Mesh(geometry,material);mesh.position.fromArray(p.position.map(v=>v*size));mesh.rotation.set(...p.rotation);
    if(p.type==='rod'){
      const a=new T.Vector3(...d[0]),b=new T.Vector3(...d[1]);mesh.position.copy(a).add(b).multiplyScalar(size/2);
      mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),b.sub(a).normalize());
    }
    return mesh;
  });
}

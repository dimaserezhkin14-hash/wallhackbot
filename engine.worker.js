let wasm = null;
let memory = null;
let malloc = null;
let engine_best_move = null;

async function loadWasm(){
  if(wasm) return;
  const res = await fetch('quoridor.wasm', {cache:'no-store'});
  const bytes = await res.arrayBuffer();
  const imports = {env:{js_now_ms:()=>BigInt(Date.now())}};
  const mod = await WebAssembly.instantiate(bytes, imports);
  wasm = mod.instance.exports;
  memory = wasm.memory;
  malloc = wasm.malloc;
  engine_best_move = wasm.engine_best_move;
}

function wallBits(walls){
  let h0=0n,h1=0n,v0=0n,v1=0n;
  for(const key of walls||[]){
    const [rs,cs,o] = String(key).split(',');
    const r=Number(rs), c=Number(cs), i=r*8+c;
    if(i<0) continue;
    const bit=1n<<BigInt(i%64);
    if(o==='h'){ if(i<64) h0|=bit; else h1|=bit; }
    else { if(i<64) v0|=bit; else v1|=bit; }
  }
  return [h0,h1,v0,v1];
}

function search(state, gameMode, timeMs){
  const rows = gameMode === 'race' ? 13 : 9;
  const ip = malloc(80);
  const op = malloc(32);
  const dv = new DataView(memory.buffer);
  dv.setInt32(ip+0, rows, true);
  dv.setInt32(ip+4, state.me.r, true);
  dv.setInt32(ip+8, state.me.c, true);
  dv.setInt32(ip+12, state.opp.r, true);
  dv.setInt32(ip+16, state.opp.c, true);
  dv.setInt32(ip+20, state.me.walls, true);
  dv.setInt32(ip+24, state.opp.walls, true);
  const [h0,h1,v0,v1]=wallBits(state.walls);
  dv.setBigUint64(ip+32,h0,true);
  dv.setBigUint64(ip+40,h1,true);
  dv.setBigUint64(ip+48,v0,true);
  dv.setBigUint64(ip+56,v1,true);
  dv.setInt32(ip+64, Math.min(1500, Math.max(700, timeMs|0)), true);
  engine_best_move(ip,op);
  const type=dv.getInt32(op+0,true);
  if(type<0) return null;
  return {
    type: type===0?'step':'wall',
    r: dv.getInt32(op+4,true),
    c: dv.getInt32(op+8,true),
    o: type===1 ? (dv.getInt32(op+12,true)===0?'h':'v') : undefined,
    score: dv.getInt32(op+16,true),
    depth: dv.getInt32(op+20,true),
    nodes: dv.getUint32(op+24,true)
  };
}

self.onmessage = async (e)=>{
  const d=e.data||{};
  if(d.type!=='search') return;
  try{
    await loadWasm();
    self.postMessage({type:'started'});
    const t=performance.now();
    const move=search(d.state,d.gameMode,d.timeMs||1200);
    const elapsed=Math.round(performance.now()-t);
    self.postMessage({type:'done',move,elapsed});
  }catch(err){
    self.postMessage({type:'error',error:String(err&&err.stack||err)});
  }
};

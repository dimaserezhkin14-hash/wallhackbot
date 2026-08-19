let wasm = null;
let wasmReady = null;

async function loadEngine(){
  if(wasmReady) return wasmReady;
  wasmReady = (async()=>{
    const response = await fetch(new URL("quoridor.wasm", self.location.href));
    const bytes = await response.arrayBuffer();
    const memory = new WebAssembly.Memory({initial:512, maximum:512});
    const result = await WebAssembly.instantiate(bytes, {
      env: {
        memory,
        now_ms: () => BigInt(Date.now())
      }
    });
    wasm = result.instance.exports;
    return wasm;
  })();
  return wasmReady;
}

function u32(x){ return (x>>>0); }

self.onmessage = async (ev)=>{
  const d=ev.data||{};
  if(d.type!=="search") return;
  try{
    const e=await loadEngine();
    const t0=performance.now();
    const w=d.walls||{};
    e.engine_set_state(
      d.my.r|0,d.my.c|0,d.opp.r|0,d.opp.c|0,
      d.my.walls|0,d.opp.walls|0,d.rows|0,
      u32(w.h0),u32(w.h1),u32(w.h2),u32(w.h3)
    );
    e.engine_set_vwalls(u32(w.v0),u32(w.v1),u32(w.v2),u32(w.v3));
    e.engine_search(d.timeMs|0,d.maxDepth|0);
    const elapsed=Math.round(performance.now()-t0);
    const type=e.engine_best_type();
    self.postMessage({
      type:"result",id:d.id,
      move:{type,r:e.engine_best_r(),c:e.engine_best_c(),o:e.engine_best_o()},
      depth:e.engine_depth(),
      nodes:e.engine_nodes_lo(),
      ttHits:e.engine_tt_hits(),
      cutoffs:e.engine_cutoffs(),
      elapsed
    });
  }catch(err){
    self.postMessage({type:"error",id:d.id,message:String(err&&err.stack||err)});
  }
};

loadEngine().then(()=>self.postMessage({type:"ready"})).catch(err=>self.postMessage({type:"error",message:String(err&&err.stack||err)}));

let wasmPromise=null;
async function loadEngine(){
  if(!wasmPromise){
    wasmPromise=fetch(new URL('quoridor.wasm',self.location.href))
      .then(r=>{if(!r.ok)throw new Error('WASM HTTP '+r.status);return r.arrayBuffer();})
      .then(bytes=>WebAssembly.instantiate(bytes,{}))
      .then(x=>x.instance.exports);
  }
  return wasmPromise;
}
self.onmessage=async(ev)=>{
  try{
    const e=await loadEngine();
    const m=ev.data||{}, w=m.walls||[0,0,0,0];
    const move=e.best_move(
      m.mr|0,m.mc|0,m.orr|0,m.oc|0,
      m.myWalls|0,m.oppWalls|0,
      w[0]>>>0,w[1]>>>0,w[2]>>>0,w[3]>>>0,
      m.budget|0,m.maxDepth|0
    );
    self.postMessage({ok:true,move,nodes:e.nodes_used(),depth:e.depth_reached()});
  }catch(err){
    self.postMessage({ok:false,error:String(err)});
  }
};

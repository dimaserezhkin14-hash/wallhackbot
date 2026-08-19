let ready=null;
async function load(){
  if(!ready){
    ready=fetch(new URL('quoridor.wasm',self.location.href))
      .then(r=>{if(!r.ok)throw Error('WASM '+r.status);return r.arrayBuffer()})
      .then(b=>WebAssembly.instantiate(b,{}))
      .then(x=>x.instance.exports);
  }
  return ready;
}
self.onmessage=async e=>{
  const m=e.data||{}; const req=m.req|0;
  try{
    const x=await load(); const w=m.walls||[0,0,0,0];
    // 150k nodes is the practical fast/strong point of this build on desktop;
    // it reaches depth 6 in the benchmark position instead of falling back.
    const budget=Math.min(Math.max(m.budget|0,50000),100000);
    const move=x.best_move(
      m.mr|0,m.mc|0,m.orr|0,m.oc|0,
      m.myWalls|0,m.oppWalls|0,
      w[0]>>>0,w[1]>>>0,w[2]>>>0,w[3]>>>0,
      budget,Math.max(m.maxDepth|0,8)
    );
    self.postMessage({req,ok:true,move,nodes:x.nodes_used(),depth:x.depth_reached()});
  }catch(err){self.postMessage({req,ok:false,error:String(err)});}
};

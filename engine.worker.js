let ready=null;
async function load(){
  if(!ready){
    const memory=new WebAssembly.Memory({initial:64});
    ready=fetch(new URL('quoridor.wasm',self.location.href))
      .then(r=>{if(!r.ok)throw Error('WASM '+r.status);return r.arrayBuffer()})
      .then(b=>WebAssembly.instantiate(b,{env:{memory,now_ms:()=>BigInt(Date.now())}}))
      .then(x=>x.instance.exports);
  }
  return ready;
}
self.onmessage=async e=>{
  const m=e.data||{}; const req=m.req|0;
  try{
    const x=await load(); const w=m.walls||[0,0,0,0];
    const move=x.best_move(
      m.mr|0,m.mc|0,m.orr|0,m.oc|0,
      m.myWalls|0,m.oppWalls|0,
      w[0]>>>0,w[1]>>>0,w[2]>>>0,w[3]>>>0,
      m.budget|0,m.maxDepth|0
    );
    self.postMessage({req,ok:true,move,nodes:x.nodes_used(),depth:x.depth_reached()});
  }catch(err){
    self.postMessage({req,ok:false,error:String(err)});
  }
};

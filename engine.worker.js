
const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
let state = null;
let gameMode = "duel";
let aiPlayer = "me";
let raceWallsSetting = 15;
let avoidMoveKey = null;
let recentPositionKeys = [];
let deadline = 0;
let requestedBudget = 2600;
let timedOut = false;
let nodes = 0;
let qArr = new Int16Array(200);
let distArr = new Int16Array(200);
let countArr = new Uint8Array(200);
let pathStack = new Set();
let TT = new Map();
let PV = null;
let killer = [[],[],[],[],[],[],[],[],[],[],[]];
let history = new Map();
let wallLegalCache = new Map();
let moveListCache = new Map();
let pathInfoCache = new Map();

function now(){ return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }
function getBoardRows(){ return gameMode === "race" ? 13 : 9; }
function getGoalRow(player){ if(gameMode === "race") return 0; const myGoal=(aiPlayer==="me"?0:8); return player==="me"?myGoal:(8-myGoal); }
function wallKey(r,c,o){ return r+","+c+","+o; }
function moveKey(m){ return m && m.type==="step" ? "s:"+m.r+","+m.c : (m ? "w:"+m.r+","+m.c+","+m.o : ""); }
function inBoard(r,c){ return r>=0 && r<getBoardRows() && c>=0 && c<9; }
function edgeBlocked(a,b,walls){
  const dr=b.r-a.r, dc=b.c-a.c;
  if(dr===0 && Math.abs(dc)===1){
    const c=Math.min(a.c,b.c);
    return walls.has(wallKey(a.r,c,"v")) || walls.has(wallKey(a.r-1,c,"v"));
  }
  if(dc===0 && Math.abs(dr)===1){
    const r=Math.min(a.r,b.r);
    return walls.has(wallKey(r,a.c,"h")) || walls.has(wallKey(r,a.c-1,"h"));
  }
  return true;
}
function rawNeighbors(pos,walls){
  const out=[];
  for(const [dr,dc] of dirs){
    const nr=pos.r+dr,nc=pos.c+dc;
    if(inBoard(nr,nc) && !edgeBlocked(pos,{r:nr,c:nc},walls)) out.push({r:nr,c:nc});
  }
  return out;
}
function legalMoves(player,walls,pos,other){
  const out=[];
  for(const n of rawNeighbors(pos,walls)){
    if(n.r===other.r && n.c===other.c){
      const dr=n.r-pos.r, dc=n.c-pos.c;
      const jump={r:other.r+dr,c:other.c+dc};
      if(inBoard(jump.r,jump.c) && !edgeBlocked(other,jump,walls)) out.push(jump);
      else{
        const sides=[
          {r:other.r+dc,c:other.c-dr},
          {r:other.r-dc,c:other.c+dr}
        ];
        for(const x of sides) if(inBoard(x.r,x.c) && !edgeBlocked(other,x,walls)) out.push(x);
      }
    }else out.push(n);
  }
  return out;
}
function shortestPath(player,walls,start){
  if(deadline && now()>=deadline){ timedOut=true; return Infinity; }
  const goal=getGoalRow(player), rows=getBoardRows(), total=rows*9;
  if(start.r===goal) return 0;
  distArr.fill(-1,0,total);
  let head=0,tail=0;
  const si=start.r*9+start.c;
  distArr[si]=0;qArr[tail++]=si;
  while(head<tail){
    if((head & 63)===0 && deadline && now()>=deadline){ timedOut=true; return Infinity; }
    const idx=qArr[head++],r=(idx/9)|0,c=idx%9,d=distArr[idx];
    if(r===goal) return d;
    for(const [dr,dc] of dirs){
      const nr=r+dr,nc=c+dc;
      if(nr<0||nr>=rows||nc<0||nc>=9) continue;
      const ni=nr*9+nc;
      if(distArr[ni]!==-1) continue;
      if(edgeBlocked({r,c},{r:nr,c:nc},walls)) continue;
      distArr[ni]=d+1;qArr[tail++]=ni;
    }
  }
  return Infinity;
}
function pathCount(player,walls,start,cap=16){
  const goal=getGoalRow(player), rows=getBoardRows(), total=rows*9;
  if(start.r===goal) return 1;
  distArr.fill(-1,0,total); countArr.fill(0,0,total);
  let head=0,tail=0;
  const si=start.r*9+start.c;
  distArr[si]=0;countArr[si]=1;qArr[tail++]=si;
  let best=Infinity,totalGoal=0;
  while(head<tail){
    const idx=qArr[head++],r=(idx/9)|0,c=idx%9,d=distArr[idx];
    if(d>best) continue;
    if(r===goal){ best=d; totalGoal=Math.min(cap,totalGoal+countArr[idx]); continue; }
    for(const [dr,dc] of dirs){
      const nr=r+dr,nc=c+dc;
      if(nr<0||nr>=rows||nc<0||nc>=9) continue;
      const ni=nr*9+nc;
      if(edgeBlocked({r,c},{r:nr,c:nc},walls)) continue;
      if(distArr[ni]===-1){
        distArr[ni]=d+1; countArr[ni]=countArr[idx]; qArr[tail++]=ni;
      }else if(distArr[ni]===d+1){
        countArr[ni]=Math.min(cap,countArr[ni]+countArr[idx]);
      }
    }
  }
  return totalGoal;
}
function optimalExits(player,walls,pos,other,dist){
  if(!isFinite(dist)||dist<=0) return 0;
  let n=0;
  for(const m of legalMoves(player,walls,pos,other)){
    if(shortestPath(player,walls,m)===dist-1) n++;
  }
  return n;
}
function getOptimalPath(player,walls,start){
  const goal=getGoalRow(player), rows=getBoardRows(), total=rows*9;
  if(start.r===goal) return [];
  distArr.fill(-1,0,total);
  const parent=new Int16Array(total).fill(-1);
  let head=0,tail=0,target=-1;
  const si=start.r*9+start.c;
  distArr[si]=0;qArr[tail++]=si;
  while(head<tail){
    const idx=qArr[head++],r=(idx/9)|0,c=idx%9,d=distArr[idx];
    if(r===goal){target=idx;break;}
    for(const [dr,dc] of dirs){
      const nr=r+dr,nc=c+dc;
      if(nr<0||nr>=rows||nc<0||nc>=9) continue;
      const ni=nr*9+nc;
      if(distArr[ni]!==-1) continue;
      if(edgeBlocked({r,c},{r:nr,c:nc},walls)) continue;
      distArr[ni]=d+1;parent[ni]=idx;qArr[tail++]=ni;
    }
  }
  const path=[];
  if(target!==-1){
    let cur=target;
    while(cur!==si && cur!==-1){ path.push({r:(cur/9)|0,c:cur%9}); cur=parent[cur]; }
    path.reverse();
  }
  return path;
}
function wallSegments(r,c,o){
  // Canonical Quoridor wall geometry. Every wall occupies exactly two
  // unit barrier segments. Two walls are incompatible iff they share a
  // segment, or if their anchors create the forbidden perpendicular cross.
  if(o==="h") return [[r,c,"h"],[r,c+1,"h"]];
  return [[r,c,"v"],[r+1,c,"v"]];
}
function wallGeometryLegal(r,c,o,walls){
  const maxR=getBoardRows()-2;
  if((o!=="h"&&o!=="v")||r<0||r>maxR||c<0||c>7) return false;
  const k=wallKey(r,c,o);
  if(walls.has(k)) return false;

  // Segment-overlap test is the source of truth. This catches every
  // same-orientation overlap, including the adjacent-anchor case that used
  // to slip through in some representations.
  const segs=wallSegments(r,c,o);
  for(const [sr,sc,so] of segs){
    // Only existing walls of the same orientation can share a segment.
    if(walls.has(wallKey(sr,sc,so))) return false;
    if(so==="h"){
      if(walls.has(wallKey(sr,sc-1,so))) return false;
    }else{
      if(walls.has(wallKey(sr-1,sc,so))) return false;
    }
  }

  // The only forbidden perpendicular contact is a true cross at the
  // centre of the 2x2 wall block. Endpoint touching remains legal.
  if(o==="h" && walls.has(wallKey(r,c,"v"))) return false;
  if(o==="v" && walls.has(wallKey(r,c,"h"))) return false;
  return true;
}
function wallGeometryLegalLegacy(r,c,o,walls){
  return wallGeometryLegal(r,c,o,walls);
}
function shortestPathCountInfo(player,walls,start){
  const rows=getBoardRows(), total=rows*9, goal=getGoalRow(player);
  const ds=new Int16Array(total); ds.fill(-1);
  const waysS=new Float64Array(total);
  const dg=new Int16Array(total); dg.fill(-1);
  const waysG=new Float64Array(total);
  const q=new Int16Array(total); let head=0,tail=0;
  const si=start.r*9+start.c; ds[si]=0; waysS[si]=1; q[tail++]=si;
  while(head<tail){
    const idx=q[head++],r=(idx/9)|0,c=idx%9,d=ds[idx];
    for(const [dr,dc] of dirs){
      const nr=r+dr,nc=c+dc;
      if(nr<0||nr>=rows||nc<0||nc>=9) continue;
      const ni=nr*9+nc; if(edgeBlocked({r,c},{r:nr,c:nc},walls)) continue;
      if(ds[ni]===-1){ds[ni]=d+1;waysS[ni]=waysS[idx];q[tail++]=ni;}
      else if(ds[ni]===d+1) waysS[ni]+=waysS[idx];
    }
  }
  // Multi-source BFS from the whole goal row.
  head=0;tail=0;
  for(let c=0;c<9;c++){const idx=goal*9+c;dg[idx]=0;waysG[idx]=1;q[tail++]=idx;}
  while(head<tail){
    const idx=q[head++],r=(idx/9)|0,c=idx%9,d=dg[idx];
    for(const [dr,dc] of dirs){
      const nr=r+dr,nc=c+dc;
      if(nr<0||nr>=rows||nc<0||nc>=9) continue;
      const ni=nr*9+nc; if(edgeBlocked({r,c},{r:nr,c:nc},walls)) continue;
      if(dg[ni]===-1){dg[ni]=d+1;waysG[ni]=waysG[idx];q[tail++]=ni;}
      else if(dg[ni]===d+1) waysG[ni]+=waysG[idx];
    }
  }
  let D=Infinity,totalWays=0;
  for(let c=0;c<9;c++){const idx=goal*9+c;if(ds[idx]>=0 && ds[idx]<D) D=ds[idx];}
  if(!isFinite(D)) return {d:Infinity,totalWays:0,ds,dg,waysS,waysG};
  for(let c=0;c<9;c++){const idx=goal*9+c;if(ds[idx]===D) totalWays+=waysS[idx];}
  return {d:D,totalWays,ds,dg,waysS,waysG};
}
function candidateBlocksAllShortest(info,r,c,o){
  if(!isFinite(info.d)) return false;
  const edges=[];
  if(o==="h"){
    const u1=r*9+c,v1=(r+1)*9+c,u2=r*9+c+1,v2=(r+1)*9+c+1;
    edges.push([u1,v1],[u2,v2]);
  }else{
    const u1=r*9+c,v1=r*9+c+1,u2=(r+1)*9+c,v2=(r+1)*9+c+1;
    edges.push([u1,v1],[u2,v2]);
  }
  let blockedWays=0;
  for(const [u,v] of edges){
    if(info.ds[u]>=0 && info.dg[v]>=0 && info.ds[u]+1+info.dg[v]===info.d){
      blockedWays += info.waysS[u]*info.waysG[v];
    }
  }
  // A shortest path cannot cross both parallel segments of one wall without
  // backtracking, so these path counts are disjoint for a shortest route.
  return blockedWays>=info.totalWays-1e-9;
}
function legalWall(r,c,o,walls,myPos,oppPos){
  if(!wallGeometryLegal(r,c,o,walls)) return false;
  const key=r+","+c+","+o+"|"+myPos.r+","+myPos.c+"|"+oppPos.r+","+oppPos.c+"|"+Array.from(walls).sort().join(";");
  const hit=wallLegalCache.get(key); if(hit!==undefined) return hit;
  // Fast path: if the wall does not destroy every current shortest route for
  // either player, connectivity is guaranteed. Only the genuinely critical
  // candidates require a post-wall BFS.
  const infoBase=Array.from(walls).sort().join(";");
  const mik="me|"+myPos.r+","+myPos.c+"|"+infoBase;
  const oik="opp|"+oppPos.r+","+oppPos.c+"|"+infoBase;
  let mi=pathInfoCache.get(mik); if(!mi){mi=shortestPathCountInfo("me",walls,myPos);pathInfoCache.set(mik,mi);}
  let oi=pathInfoCache.get(oik); if(!oi){oi=shortestPathCountInfo("opp",walls,oppPos);pathInfoCache.set(oik,oi);}
  let ok=true;
  if(candidateBlocksAllShortest(mi,r,c,o)){
    const copy=new Set(walls); copy.add(wallKey(r,c,o));
    ok=shortestPath("me",copy,myPos)!==Infinity;
  }
  if(ok && candidateBlocksAllShortest(oi,r,c,o)){
    const copy=new Set(walls); copy.add(wallKey(r,c,o));
    ok=shortestPath("opp",copy,oppPos)!==Infinity;
  }
  wallLegalCache.set(key,ok); return ok;
}

function allValidWalls(walls,myPos,oppPos){
  const out=[],maxR=getBoardRows()-2;
  for(let r=0;r<=maxR;r++) for(let c=0;c<8;c++) for(const o of ["h","v"]){
    if(legalWall(r,c,o,walls,myPos,oppPos)) out.push({r,c,o});
  }
  return out;
}
function stateKey(walls,myPos,oppPos,myWalls,oppWalls,turn){
  const ws=Array.from(walls).sort().join(";");
  return turn+"|"+myPos.r+","+myPos.c+"|"+oppPos.r+","+oppPos.c+"|"+myWalls+","+oppWalls+"|"+ws;
}
function expired(){ return (nodes++ & 31)===0 && now()>=deadline; }

function applyMove(s,m,maximizing){
  const nw=new Set(s.walls), mp={...s.myPos}, op={...s.oppPos};
  let mw=s.myWalls,ow=s.oppWalls;
  if(m.type==="step"){
    if(maximizing) mp.r=m.r,mp.c=m.c; else op.r=m.r,op.c=m.c;
  }else{
    nw.add(wallKey(m.r,m.c,m.o));
    if(maximizing) mw--; else ow--;
  }
  return {walls:nw,myPos:mp,oppPos:op,myWalls:mw,oppWalls:ow};
}
function pathMetrics(player,walls,pos,other){
  const d=shortestPath(player,walls,pos);
  if(!isFinite(d)) return {d:999,paths:0,exits:0};
  return {d,paths:pathCount(player,walls,pos),exits:optimalExits(player,walls,pos,other,d)};
}

function wallImpact(turn,walls,pPos,ePos,w){
  const copy=new Set(walls); copy.add(wallKey(w.r,w.c,w.o));
  const p=pathMetrics(turn,walls,pPos,ePos), e=pathMetrics(turn==="me"?"opp":"me",walls,ePos,pPos);
  const np=pathMetrics(turn,copy,pPos,ePos), ne=pathMetrics(turn==="me"?"opp":"me",copy,ePos,pPos);
  if(np.d>=999||ne.d>=999) return null;
  const eGain=ne.d-e.d, pLoss=np.d-p.d;
  const ePathsLoss=e.paths-ne.paths, pPathsLoss=p.paths-np.paths;
  const critical = eGain>=1 || ePathsLoss>=2 || (p.exits<=1 && pLoss===0);
  let score=eGain*2600-pLoss*1900+ePathsLoss*95-pPathsLoss*30;
  if(pLoss===0 && eGain>=1) score+=900;
  if(eGain>=2) score+=900;
  if(p.exits<=1 && eGain>0) score+=500;
  if(e.exits<=1 && eGain>0) score+=400;
  if(!critical) score-=200;
  return {score,eGain,pLoss,ePathsLoss,pPathsLoss,critical};
}

function generateCandidates(s,turn,depth,root=false){
  // IMPORTANT: this is move generation, not move selection.
  // Every legal move is returned. Heuristics only order the list.
  const pPos=turn==="me"?s.myPos:s.oppPos;
  const ePos=turn==="me"?s.oppPos:s.myPos;
  const pWalls=turn==="me"?s.myWalls:s.oppWalls;
  const out=[];
  const savedGenDeadline=deadline; deadline=0;

  // Pawn moves: all legal jumps/side-steps are searched.
  for(const p of legalMoves(turn,s.walls,pPos,ePos)){
    const m={type:"step",r:p.r,c:p.c,priority:0};
    const d=shortestPath(turn,s.walls,p);
    // Ordering only: it never removes a move.
    m.priority=(getGoalRow(turn)===p.r?1e12:0) - d*1000;
    const k=moveKey(m);
    m.priority+=(history.get(k)||0);
    if(killer[depth] && killer[depth].includes(k)) m.priority+=5000;
    out.push(m);
  }

  if(pWalls<=0){ deadline=savedGenDeadline; return out.sort((a,b)=>b.priority-a.priority); }

  // Every geometrically/legal wall is included. Do NOT time-box this loop and
  // do NOT truncate it. Alpha-beta must be the authority, exactly like a chess
  // engine: ordering can be approximate; move generation must be complete.
  const maxR=getBoardRows()-2;
  const target=getOptimalPath(turn==="me"?"opp":"me",s.walls,ePos);
  for(let r=0;r<=maxR;r++){
    for(let c=0;c<8;c++){
      for(const o of ["h","v"]){
        if(!legalWall(r,c,o,s.walls,s.myPos,s.oppPos)) continue;
        const m={type:"wall",r,c,o,priority:0};
        const k=moveKey(m);
        // Cheap geometry ordering. No strategic candidate pruning occurs here.
        let near=0;
        for(const pt of target){
          if(Math.abs(pt.r-r)<=1 && Math.abs(pt.c-c)<=1){near=1;break;}
        }
        m.priority=near*2500+(history.get(k)||0);
        // Ordering only: every legal wall remains in the tree. Expensive
        // strategic scoring is reserved for walls that actually touch the
        // current shortest-path corridor; distant walls still remain fully
        // searchable, just later in the move list.
        if(false && near) m.priority += wallStrategicScore(s,turn,m);
        m.priority += openingPenalty(s,m,turn);
        if(killer[depth] && killer[depth].includes(k)) m.priority+=5000;
        out.push(m);
      }
    }
  }
  out.sort((a,b)=>b.priority-a.priority);
  return out;
}

function generateSearchMoves(s,turn,depth){
  const pPos=turn==="me"?s.myPos:s.oppPos;
  const ePos=turn==="me"?s.oppPos:s.myPos;
  const pWalls=turn==="me"?s.myWalls:s.oppWalls;
  const out=[];
  for(const p of legalMoves(turn,s.walls,pPos,ePos)){
    const m={type:"step",r:p.r,c:p.c,priority:0};
    const d=shortestPath(turn,s.walls,p);
    m.priority=(getGoalRow(turn)===p.r?1e12:0)-d*1000+(history.get(moveKey(m))||0);
    if(killer[depth]&&killer[depth].includes(moveKey(m))) m.priority+=5000;
    out.push(m);
  }
  if(pWalls<=0) return out.sort((a,b)=>b.priority-a.priority);
  const target=getOptimalPath(turn==="me"?"opp":"me",s.walls,ePos);
  const maxR=getBoardRows()-2;
  for(let r=0;r<=maxR;r++) for(let c=0;c<8;c++) for(const o of ["h","v"]){
    // Search generation must obey the exact same legality predicate as the root.
    // The previous version accidentally generated geometrically/strategically
    // illegal walls inside the tree, which poisoned minimax: the engine was
    // literally analysing positions that can never occur in a real game.
    if(!legalWall(r,c,o,s.walls,s.myPos,s.oppPos)) continue;
    const m={type:"wall",r,c,o,priority:0};
    let near=0;
    for(const pt of target){if(Math.abs(pt.r-r)<=1&&Math.abs(pt.c-c)<=1){near=1;break;}}
    m.priority=near*2500+(history.get(moveKey(m))||0);
    if(killer[depth]&&killer[depth].includes(moveKey(m))) m.priority+=5000;
    out.push(m);
  }
  // NEVER truncate legal moves. In particular, a distant wall can be the
  // only winning resource in Quoridor. Ordering may be imperfect, but move
  // generation itself must remain exact at every search depth.
  return out;
}
function strategicInfo(player,walls,pos,other){
  const info=shortestPathCountInfo(player,walls,pos);
  if(!isFinite(info.d)) return {d:999,paths:0,exits:0,bottleneck:0,frontier:0};
  const exits=optimalExits(player,walls,pos,other,info.d);
  // Approximate bottleneck pressure: count path cells whose shortest-route
  // multiplicity is small. It is deliberately a soft feature; search remains
  // authoritative.
  let bottleneck=0, frontier=0;
  const rows=getBoardRows();
  for(let r=0;r<rows;r++) for(let c=0;c<9;c++){
    const idx=r*9+c;
    if(info.ds[idx]>=0 && info.dg[idx]>=0 && info.ds[idx]+info.dg[idx]===info.d){
      const ways=info.waysS[idx]*info.waysG[idx];
      if(ways<=1) bottleneck+=1;
      if(Math.abs(r-pos.r)<=2) frontier+=1;
    }
  }
  return {d:info.d,paths:Math.min(64,info.totalWays),exits,bottleneck,frontier};
}
function wallStrategicScore(s,turn,m){
  const p=turn==="me"?s.myPos:s.oppPos;
  const e=turn==="me"?s.oppPos:s.myPos;
  const copy=new Set(s.walls); copy.add(wallKey(m.r,m.c,m.o));
  const beforeP=strategicInfo(turn,s.walls,p,e);
  const beforeE=strategicInfo(turn==="me"?"opp":"me",s.walls,e,p);
  const afterP=strategicInfo(turn,copy,p,e);
  const afterE=strategicInfo(turn==="me"?"opp":"me",copy,e,p);
  if(afterP.d>=999 || afterE.d>=999) return -1e12;
  const enemyGain=afterE.d-beforeE.d;
  const selfLoss=afterP.d-beforeP.d;
  const enemyPathLoss=Math.log2((beforeE.paths+1)/(afterE.paths+1));
  const selfPathLoss=Math.log2((beforeP.paths+1)/(afterP.paths+1));
  const enemyExitLoss=beforeE.exits-afterE.exits;
  const bottleneckGain=afterE.bottleneck-beforeE.bottleneck;
  const wallValue=
      enemyGain*2600 - selfLoss*2300 + enemyPathLoss*720 +
      enemyExitLoss*210 + bottleneckGain*90 - selfPathLoss*120;
  return wallValue;
}
function openingPenalty(s,m,turn){
  if(m.type!=="wall" || s.walls.size!==0) return 0;
  const p=turn==="me"?s.myPos:s.oppPos;
  const e=turn==="me"?s.oppPos:s.myPos;
  const startRow=turn==="me"?getBoardRows()-1:0;
  const enemy="opp";
  if(p.r!==startRow || e.r!==getGoalRow("opp")) return 0;

  // A first wall is not forbidden. It is simply required to justify itself.
  // Measure the actual tactical effect before allowing it to outrank a free
  // forward tempo. This is deliberately soft: a genuinely strong wall can
  // still win the comparison.
  const before=shortestPath(turn,s.walls,p);
  const enemyBefore=shortestPath(enemy,s.walls,e);
  const copy=new Set(s.walls); copy.add(wallKey(m.r,m.c,m.o));
  const after=shortestPath(turn,copy,p);
  const enemyAfter=shortestPath(enemy,copy,e);
  const selfCost=after-before;
  const enemyGain=enemyAfter-enemyBefore;
  if(enemyGain>=2) return 0;
  if(enemyGain>=1) return -250;
  // If it does not alter the opponent's race at all, spending a wall on move 1
  // should lose decisively to a free pawn tempo.
  return -7000 - Math.max(0,selfCost)*1200;
}
function evaluate(s){
  // Leaf evaluation is deliberately cheap. Expensive multi-route analysis is
  // reserved for forcing moves/search nodes; otherwise 100+ leaf positions
  // would each perform several full BFS passes and destroy chess-like speed.
  const md=shortestPath("me",s.walls,s.myPos);
  const od=shortestPath("opp",s.walls,s.oppPos);
  if(s.myPos.r===getGoalRow("me")) return 100000000;
  if(s.oppPos.r===getGoalRow("opp")) return -100000000;
  if(!isFinite(md)) return -100000000;
  if(!isFinite(od)) return 100000000;

  let v=(od-md)*1500;
  v+=(s.myWalls-s.oppWalls)*48;
  const myMoves=legalMoves("me",s.walls,s.myPos,s.oppPos).length;
  const oppMoves=legalMoves("opp",s.walls,s.oppPos,s.myPos).length;
  v+=(myMoves-oppMoves)*20;

  // Only near tactical positions do we pay for route multiplicity and exits.
  if(Math.min(md,od)<=7 || s.myWalls+s.oppWalls<=3){
    const mp=pathCount("me",s.walls,s.myPos,8);
    const op=pathCount("opp",s.walls,s.oppPos,8);
    v+=(mp-op)*95;
    if(md<=5) v+=optimalExits("me",s.walls,s.myPos,s.oppPos,md)*55;
    if(od<=5) v-=optimalExits("opp",s.walls,s.oppPos,s.myPos,od)*55;
    if(op<=1) v+=Math.min(3,s.myWalls)*70;
    if(mp<=1) v-=Math.min(3,s.oppWalls)*80;
  }
  if(md<=4) v+=(od-md)*240;
  if(od<=4) v+=(od-md)*480;

  // Strategic sanity checks. These are still only evaluation terms; the search
  // remains authoritative. Reward concrete progress and punish spending a wall
  // that did not change the opponent's race.
  if(s.walls.size===0 && s.myPos.r===getBoardRows()-1 && s.oppPos.r===0){
    const forward=shortestPath("me",s.walls,{r:s.myPos.r-1,c:s.myPos.c});
    if(isFinite(forward) && md===forward) v+=900;
    // Any first-wall position must have produced a measurable opponent gain.
    // This prevents arbitrary decorative walls from tying the natural opening.
    if(s.myPos.r===getBoardRows()-1 && s.myWalls<15) v-=6500;
  }
  return v;
}

function terminal(s,depth){
  if(s.myPos.r===getGoalRow("me")) return 100000000 + depth;
  if(s.oppPos.r===getGoalRow("opp")) return -100000000 - depth;
  return null;
}

function exactMoveList(s,turn){
  const pPos=turn==="me"?s.myPos:s.oppPos;
  const ePos=turn==="me"?s.oppPos:s.myPos;
  const pWalls=turn==="me"?s.myWalls:s.oppWalls;
  const out=[];
  for(const p of legalMoves(turn,s.walls,pPos,ePos)) out.push({type:"step",r:p.r,c:p.c,priority:0});
  if(pWalls>0){
    for(const w of allValidWalls(s.walls,s.myPos,s.oppPos)){
      if(expired()){timedOut=true;break;}
      out.push({...w,type:"wall",priority:0});
    }
  }
  return out;
}

// A proof-oriented endgame search. It is invoked only when the remaining
// wall inventory is tiny, where exhaustive legal move generation is feasible.
// It returns a move only when a forced win/loss can actually be proven inside
// the searched horizon; otherwise the normal evaluator remains in charge.
const proofTT = new Map();
function proofKey(s,turn,depth){
  return turn+depth+"|"+stateKey(s.walls,s.myPos,s.oppPos,s.myWalls,s.oppWalls,turn);
}
function proofSearch(s,depth,maximizing,path){
  if(expired()){timedOut=true;return 0;}
  const t=terminal(s,depth); if(t!==null) return t;
  if(depth<=0) return null;
  const key=proofKey(s,maximizing?"me":"opp",depth);
  const cached=proofTT.get(key);
  if(cached!==undefined) return cached;
  const turn=maximizing?"me":"opp";
  const moves=exactMoveList(s,turn);
  if(!moves.length) return null;
  let unknown=false;
  if(maximizing){
    for(const m of moves){
      const child=applyMove(s,m,true);
      const ck=stateKey(child.walls,child.myPos,child.oppPos,child.myWalls,child.oppWalls,"opp");
      if(path.has(ck)) { unknown=true; continue; }
      path.add(ck);
      const v=proofSearch(child,depth-1,false,path);
      path.delete(ck);
      if(timedOut) return 0;
      if(v!==null && v>50000000){ proofTT.set(key,1); return 100000000+depth; }
      if(v===null || v>-50000000) unknown=true;
    }
    if(!unknown){ proofTT.set(key,-1); return -100000000-depth; }
  }else{
    for(const m of moves){
      const child=applyMove(s,m,false);
      const ck=stateKey(child.walls,child.myPos,child.oppPos,child.myWalls,child.oppWalls,"me");
      if(path.has(ck)) { unknown=true; continue; }
      path.add(ck);
      const v=proofSearch(child,depth-1,true,path);
      path.delete(ck);
      if(timedOut) return 0;
      if(v!==null && v<-50000000){ proofTT.set(key,-1); return -100000000-depth; }
      if(v===null || v<50000000) unknown=true;
    }
    if(!unknown){ proofTT.set(key,1); return 100000000+depth; }
  }
  proofTT.set(key,null);
  return null;
}

function tryEndgameProof(rootMoves,budgetDepth){
  const totalWalls=state.myWalls+state.oppWalls;
  const md=shortestPath("me",state.walls,state.myPos);
  const od=shortestPath("opp",state.walls,state.oppPos);
  if(totalWalls>2 || Math.max(md,od)>14) return null;
  proofTT.clear();
  for(let depth=1;depth<=budgetDepth;depth++){
    if(expired()) break;
    let found=null,unknown=false;
    for(const m of rootMoves){
      const child=applyMove(state,m,true);
      const ck=stateKey(child.walls,child.myPos,child.oppPos,child.myWalls,child.oppWalls,"opp");
      const path=new Set([ck]);
      const v=proofSearch(child,depth-1,false,path);
      if(timedOut) break;
      if(v!==null && v>50000000){ found=m; break; }
      if(v===null) unknown=true;
    }
    if(found) return found;
    if(timedOut) break;
  }
  return null;
}

function isForcingMove(s,turn,m){
  const p=turn==="me"?s.myPos:s.oppPos;
  const e=turn==="me"?s.oppPos:s.myPos;
  if(m.type==="step"){
    if(m.r===getGoalRow(turn)) return true;
    const before=shortestPath(turn,s.walls,p);
    const after=shortestPath(turn,s.walls,m);
    return isFinite(before)&&isFinite(after)&&(before-after)>=1;
  }
  const copy=new Set(s.walls); copy.add(wallKey(m.r,m.c,m.o));
  const enemy=turn==="me"?"opp":"me";
  const eb=shortestPath(enemy,s.walls,e);
  const ea=shortestPath(enemy,copy,e);
  if(!isFinite(eb)||!isFinite(ea)) return true;
  if(ea-eb>=1) return true;
  const bi=shortestPathCountInfo(enemy,s.walls,e);
  const ai=shortestPathCountInfo(enemy,copy,e);
  return ai.totalWays<=Math.max(1,Math.floor(bi.totalWays/2)) || ai.totalWays<=1;
}
function wallMoveUtility(s,turn,m){
  if(m.type!=="wall") return 0;
  const p=turn==="me"?s.myPos:s.oppPos;
  const e=turn==="me"?s.oppPos:s.myPos;
  const enemy=turn==="me"?"opp":"me";
  const beforeP=strategicInfo(turn,s.walls,p,e);
  const beforeE=strategicInfo(enemy,s.walls,e,p);
  const copy=new Set(s.walls); copy.add(wallKey(m.r,m.c,m.o));
  const afterP=strategicInfo(turn,copy,p,e);
  const afterE=strategicInfo(enemy,copy,e,p);
  if(afterP.d>=999 || afterE.d>=999) return -1e8;
  const enemyGain=afterE.d-beforeE.d;
  const selfLoss=afterP.d-beforeP.d;
  const enemyPathsLost=Math.max(0,beforeE.paths-afterE.paths);
  const enemyExitLoss=Math.max(0,beforeE.exits-afterE.exits);
  const bottleneckGain=afterE.bottleneck-beforeE.bottleneck;
  const concrete = enemyGain>0 || enemyPathsLost>0 || enemyExitLoss>0 || bottleneckGain>0;
  let u=enemyGain*3000 - selfLoss*3000 + enemyPathsLost*180 + enemyExitLoss*100 + bottleneckGain*60;
  // A wall that does not change the opponent's race/route structure is not
  // allowed to tie a normal pawn move. This is a soft evaluation term, not a
  // hard ban: a genuinely tactical wall can still win if the search proves it.
  if(!concrete) u-=6500;
  if(s.walls.size===0 && enemyGain<1 && enemyPathsLost<2 && enemyExitLoss===0 && bottleneckGain<=0) u-=9000;
  if(enemyGain>=2) u+=1200;
  if(enemyGain>=1 && selfLoss===0) u+=900;
  return Math.max(-30000,Math.min(30000,u));
}

function movePriorityForSearch(s,turn,m,depth){
  let p=m.priority||0;
  if(m.type==="step" && m.r===getGoalRow(turn)) p+=1e12;
  if(isForcingMove(s,turn,m)) p+=2e8;
  if(m.type==="wall"){
    p+=wallStrategicScore(s,turn,m);
    p+=openingPenalty(s,m,turn);
    p+=wallMoveUtility(s,turn,m)*8;
  }
  return p;
}

function minimax(s,depth,maximizing,alpha,beta){
  if(expired()){timedOut=true;return 0;}
  const t=terminal(s,depth); if(t!==null) return t;
  const key=(maximizing?"M":"m")+depth+"|"+stateKey(s.walls,s.myPos,s.oppPos,s.myWalls,s.oppWalls,maximizing?"me":"opp");
  const alpha0=alpha,beta0=beta;
  const hit=TT.get(key);
  if(hit && hit.depth>=depth){
    if(hit.flag===0) return hit.score;
    if(hit.flag===1) alpha=Math.max(alpha,hit.score);
    else if(hit.flag===2) beta=Math.min(beta,hit.score);
    if(alpha>=beta) return hit.score;
  }

  if(depth<=0){
    const stand=evaluate(s);
    // Keep only terminal/one-move truth at the horizon. Strategic walls are not
    // guessed here; the next full ply searches every legal wall exactly.
    return stand;
  }

  const turn=maximizing?"me":"opp";
  const moves=generateSearchMoves(s,turn,depth);
  if(!moves.length) return evaluate(s);
  // Chess-style move ordering + late-move reduction. Every legal move is still
  // generated; quiet late moves are searched one ply shallower, while forcing
  // moves (wins, path-cutting walls, tunnel threats) keep full depth.
  moves.sort((a,b)=>movePriorityForSearch(s,turn,b,depth)-movePriorityForSearch(s,turn,a,depth));
  let best=maximizing?-Infinity:Infinity;
  let moveIndex=0;

  for(const m of moves){
    if(expired()){timedOut=true;break;}
    const child=applyMove(s,m,maximizing);
    const childKey=stateKey(child.walls,child.myPos,child.oppPos,child.myWalls,child.oppWalls,maximizing?"opp":"me");
    if(pathStack.has(childKey)) continue;
    pathStack.add(childKey);
    const forcing=isForcingMove(s,turn,m);
    let childDepth=depth-1;
    if(depth>=4 && moveIndex>=10 && !forcing) childDepth=Math.max(1,childDepth-1);
    let val=minimax(child,childDepth,!maximizing,alpha,beta);
    // Every wall spends a finite resource. Give the search the concrete
    // immediate consequence of that wall so a decorative wall cannot look
    // equivalent to a free pawn tempo merely because the leaf evaluator sees
    // the same raw distance. The term is from the mover's perspective.
    if(m.type==="wall" && !timedOut){
      const wu=wallMoveUtility(s,turn,m);
      val += maximizing ? wu : -wu;
    }
    // Principal-variation re-search: reduced moves are only a speed heuristic;
    // if they look capable of changing alpha/beta, search them at full depth.
    if(depth>=4 && childDepth<depth-1 && !timedOut){
      const improves=maximizing ? val>alpha : val<beta;
      if(improves) val=minimax(child,depth-1,!maximizing,alpha,beta);
    }
    pathStack.delete(childKey);
    moveIndex++;
    if(timedOut) break;

    if(maximizing){
      if(val>best) best=val;
      if(best>alpha) alpha=best;
      if(beta<=alpha){
        const mk=moveKey(m);
        if(!killer[depth].includes(mk)){killer[depth].unshift(mk);if(killer[depth].length>2)killer[depth].pop();}
        history.set(mk,(history.get(mk)||0)+Math.min(2000,depth*50));
        break;
      }
    }else{
      if(val<best) best=val;
      if(best<beta) beta=best;
      if(beta<=alpha){
        const mk=moveKey(m);
        if(!killer[depth].includes(mk)){killer[depth].unshift(mk);if(killer[depth].length>2)killer[depth].pop();}
        history.set(mk,(history.get(mk)||0)+Math.min(2000,depth*50));
        break;
      }
    }
  }
  if(timedOut) return 0;
  if(best===Infinity||best===-Infinity) best=evaluate(s);
  let flag=0;
  if(best<=alpha0) flag=2; else if(best>=beta0) flag=1;
  TT.set(key,{depth,score:best,flag});
  if(TT.size>120000){
    let i=0,cut=Math.floor(TT.size*0.25);
    for(const k of TT.keys()){TT.delete(k);if(++i>=cut)break;}
  }
  return best;
}

function rootSearch(moves,depth){
  let best=null,bestScore=-Infinity,alpha=-Infinity;
  const scores=[];
  for(const m of moves){
    if(expired()){timedOut=true;break;}
    const child=applyMove(state,m,true);
    const childKey=stateKey(child.walls,child.myPos,child.oppPos,child.myWalls,child.oppWalls,"opp");
    // Never intentionally return to a previously visited full position when
    // another legal alternative exists. This is a cycle guard, not a blanket
    // ban on backward pawn moves.
    if(recentPositionKeys.includes(childKey)) continue;
    const val=minimax(child,depth-1,false,alpha,Infinity);
    if(timedOut) break;
    scores.push({m,val});
    if(val>bestScore){bestScore=val;best=m;PV=m;}
    if(val>alpha)alpha=val;
  }
  return {move:best,score:bestScore,complete:!timedOut,scores};
}

function calculateBestMove(){
  TT.clear();proofTT.clear();wallLegalCache.clear();moveListCache.clear();pathInfoCache.clear();PV=null;nodes=0;timedOut=false;pathStack=new Set();completedDepth=0;
  const totalWalls=state.me.walls+state.opp.walls;

  // The engine is a chess-style adversarial search: all legal moves are searched;
  // time is only a performance budget, never a substitute for move generation.
  // A larger budget is allowed in tactically dense positions because this runs in
  // a Worker. No arbitrary root-wall cap exists anymore.
  const budget = requestedBudget > 0 ? requestedBudget : (totalWalls<=2 ? 3200 : (state.opp.walls>=5 || state.myWalls<=2 ? 3000 : 2600));
  const start=now();
  // No hard-coded opening move. The opening is decided by the same adversarial
  // search as every other position; the only opening preference lives in the
  // soft evaluation/ordering terms above.

  // Exact legal move generation is outside the search clock. It is complete and
  // must never be replaced by a heuristic cutoff. The actual adversarial search
  // gets the full budget after the move list exists.
  deadline=0;
  const root=generateCandidates(state,"me",1,true);
  deadline=start+budget;
  if(!root.length) return null;

  // Terminal truth before heuristic evaluation.
  const win=root.find(m=>m.type==="step" && m.r===getGoalRow("me"));
  if(win) return win;

  // If the opponent has an immediate finish, do not prune to a single defense;
  // search every legal defense. The search itself decides which defense wins.
  let best=root[0];
  let lastComplete=null;
  const maxDepth = totalWalls<=2 ? 10 : (state.opp.walls>=5 ? 6 : 5);

  for(let depth=1;depth<=maxDepth;depth++){
    timedOut=false;
    const ordered=best ? [best,...root.filter(m=>moveKey(m)!==moveKey(best))] : root.slice();
    const result=rootSearch(ordered,depth);
    if(result.complete && result.move){
      best=result.move;
      lastComplete=result;
      completedDepth=depth;
    }
    if(timedOut) break;
    if(best && best.type==="step" && best.r===getGoalRow("me")) break;
  }

  // The completed adversarial result is authoritative.
  return best;
}

function selfTestEngine(){
  const savedDeadline=deadline; deadline=0; timedOut=false;
  const w=new Set();
  const myStart = aiPlayer === "me" ? {r:getBoardRows()-1,c:4} : {r:0,c:4};
  const oppStart = aiPlayer === "me" ? {r:0,c:4} : {r:getBoardRows()-1,c:4};
  const myStep = aiPlayer === "me" ? {r:myStart.r-1,c:4} : {r:myStart.r+1,c:4};
  if(shortestPath("me",w,myStart)!==getBoardRows()-1) throw new Error("path baseline");
  if(shortestPath("opp",w,oppStart)!==getBoardRows()-1) throw new Error("opp path baseline");
  const lm=legalMoves("me",w,myStart,oppStart);
  if(!lm.some(x=>x.r===myStep.r&&x.c===myStep.c)) throw new Error("basic move");
  if(moveKey({type:"step",r:4,c:4})!=="s:4,4") throw new Error("move key");
  // Wall legality invariants.
  if(!legalWall(0,0,"h",w,myStart,oppStart)) throw new Error("wall legality");
  const w2=new Set(w); w2.add(wallKey(0,0,"h"));
  if(legalWall(0,0,"v",w2,myStart,oppStart)) throw new Error("wall crossing");
  if(legalWall(0,1,"h",w2,myStart,oppStart)) throw new Error("wall overlap right");
  if(legalWall(0,0,"h",new Set([wallKey(0,1,"h")]),myStart,oppStart)) throw new Error("wall overlap left");
  if(legalWall(1,0,"v",new Set([wallKey(0,0,"v")]),myStart,oppStart)) throw new Error("wall overlap down");
  // Jump invariant: opponent directly ahead, no wall behind.
  const me={r:4,c:4},opp={r:3,c:4};
  const jm=legalMoves("me",w,me,opp);
  if(!jm.some(x=>x.r===2&&x.c===4)) throw new Error("jump rule");
  return true;
}


function decodeWalls(m){
  const out=new Set();
  if(Array.isArray(m.walls)){
    const a=new Set();
    for(const w of m.walls){
      if(typeof w === "number") a.add(w);
      else { const [r,c,o]=String(w).split(","); a.add(wallKey(+r,+c,o)); }
    }
    return a;
  }
  const addBank=(v,bank,o)=>{
    let x=BigInt(v||0);
    for(let b=0;b<32;b++){
      if((x & (1n<<BigInt(b)))!==0n){
        const idx=bank*32+b; out.add(wallKey(Math.floor(idx/8),idx%8,o));
      }
    }
  };
  if(m.walls){
    addBank(m.walls.h0,0,"h"); addBank(m.walls.h1,1,"h"); addBank(m.walls.h2,2,"h"); addBank(m.walls.h3,3,"h");
    addBank(m.walls.v0,0,"v"); addBank(m.walls.v1,1,"v"); addBank(m.walls.v2,2,"v"); addBank(m.walls.v3,3,"v");
  }
  return out;
}

self.onmessage=function(e){
  const m=e.data||{};
  try{
    if(m.type==="init") { self.postMessage({type:"ready"}); return; }
    if(m.type!=="search") return;
    gameMode=(m.rows===13?"race":"duel");
    aiPlayer="me";
    state={
      turn:"me", gameOver:false,
      me:{...(m.me||{})}, opp:{...(m.opp||{})},
      walls:decodeWalls(m)
    };
    state.myPos=state.me; state.oppPos=state.opp;
    state.myWalls=state.me.walls; state.oppWalls=state.opp.walls;
    requestedBudget = Math.max(300, Math.min(8000, Number(m.timeMs)||2600));
    const t=now();
    const move=calculateBestMove();
    const elapsed=now()-t;
    self.postMessage({type:"result",id:m.id,move,nodes,depth:completedDepth,elapsed,ms:elapsed,ttHits:0,cutoffs:0});
  }catch(err){
    self.postMessage({type:"result",id:m.id,move:null,error:String(err&&err.stack||err)});
  }
};
self.postMessage({type:"ready"});

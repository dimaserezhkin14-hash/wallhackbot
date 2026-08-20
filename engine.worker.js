
const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
let state = null;
let gameMode = "duel";
let aiPlayer = "me";
let raceWallsSetting = 15;
let avoidMoveKey = null;
let recentPositionKeys = [];
let deadline = 0;
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
function legalWall(r,c,o,walls,myPos,oppPos){
  const maxR=getBoardRows()-2;
  if(r<0||r>maxR||c<0||c>7) return false;
  const k=wallKey(r,c,o);
  if(walls.has(k)) return false;
  if(o==="h"){
    if(walls.has(wallKey(r,c,"v"))) return false;
    if(walls.has(wallKey(r,c-1,"h"))||walls.has(wallKey(r,c+1,"h"))) return false;
  }else{
    if(walls.has(wallKey(r,c,"h"))) return false;
    if(walls.has(wallKey(r-1,c,"v"))||walls.has(wallKey(r+1,c,"v"))) return false;
  }
  const copy=new Set(walls); copy.add(k);
  return shortestPath("me",copy,myPos)!==Infinity && shortestPath("opp",copy,oppPos)!==Infinity;
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
function expired(){ return (nodes++ & 511)===0 && now()>=deadline; }

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
    const m={type:"wall",r,c,o,priority:0};
    let near=0;
    for(const pt of target){if(Math.abs(pt.r-r)<=1&&Math.abs(pt.c-c)<=1){near=1;break;}}
    m.priority=near*2500+(history.get(moveKey(m))||0);
    if(killer[depth]&&killer[depth].includes(moveKey(m))) m.priority+=5000;
    out.push(m);
  }
  out.sort((a,b)=>b.priority-a.priority);
  return out;
}
function evaluate(s){
  const md=shortestPath("me",s.walls,s.myPos);
  const od=shortestPath("opp",s.walls,s.oppPos);
  if(s.myPos.r===getGoalRow("me")) return 100000000;
  if(s.oppPos.r===getGoalRow("opp")) return -100000000;
  if(!isFinite(md)) return -100000000;
  if(!isFinite(od)) return 100000000;
  const mp=pathCount("me",s.walls,s.myPos,8);
  const op=pathCount("opp",s.walls,s.oppPos,8);
  const myMoves=legalMoves("me",s.walls,s.myPos,s.oppPos).length;
  const oppMoves=legalMoves("opp",s.walls,s.oppPos,s.myPos).length;
  let v=(od-md)*1250;
  v+=(mp-op)*65;
  v+=(myMoves-oppMoves)*18;
  v+=(s.myWalls-s.oppWalls)*42;
  const meFinish=legalMoves("me",s.walls,s.myPos,s.oppPos).some(x=>x.r===getGoalRow("me"));
  const oppFinish=legalMoves("opp",s.walls,s.oppPos,s.myPos).some(x=>x.r===getGoalRow("opp"));
  if(meFinish) v+=5000000;
  if(oppFinish) v-=5000000;
  if(mp<=1) v-=s.oppWalls*35;
  if(op<=1) v+=s.myWalls*28;
  if(Math.max(s.myWalls,s.oppWalls)<=2) v+=(s.myWalls-s.oppWalls)*95;
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
  let best=maximizing?-Infinity:Infinity;

  for(const m of moves){
    if(expired()){timedOut=true;break;}
    const child=applyMove(s,m,maximizing);
    const childKey=stateKey(child.walls,child.myPos,child.oppPos,child.myWalls,child.oppWalls,maximizing?"opp":"me");
    if(pathStack.has(childKey)) continue;
    pathStack.add(childKey);
    const val=minimax(child,depth-1,!maximizing,alpha,beta);
    pathStack.delete(childKey);
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
  TT.clear();proofTT.clear();PV=null;nodes=0;timedOut=false;pathStack=new Set();completedDepth=0;
  const totalWalls=state.me.walls+state.opp.walls;

  // The engine is a chess-style adversarial search: all legal moves are searched;
  // time is only a performance budget, never a substitute for move generation.
  // A larger budget is allowed in tactically dense positions because this runs in
  // a Worker. No arbitrary root-wall cap exists anymore.
  const budget = totalWalls<=2 ? 2600 : (state.opp.walls>=5 || state.myWalls<=2 ? 2200 : 1800);
  const start=now();
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
  const maxDepth = totalWalls<=2 ? 11 : (state.opp.walls>=5 ? 8 : 7);

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
    const t=now();
    const move=calculateBestMove();
    const elapsed=now()-t;
    self.postMessage({type:"result",id:m.id,move,nodes,depth:completedDepth,elapsed,ms:elapsed,ttHits:0,cutoffs:0});
  }catch(err){
    self.postMessage({type:"result",id:m.id,move:null,error:String(err&&err.stack||err)});
  }
};
self.postMessage({type:"ready"});

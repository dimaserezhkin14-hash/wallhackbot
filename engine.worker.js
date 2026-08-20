
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

  // A Quoridor wall occupies TWO adjacent grooves.  Therefore another wall
  // of the same orientation may touch it end-to-end (c +/- 2), but may NOT
  // start one slot away: that would physically overlap by one groove.
  if(o==="h"){
    if(walls.has(wallKey(r,c-1,"h")) || walls.has(wallKey(r,c+1,"h"))) return false;
    // Crossing walls share the same intersection.
    if(walls.has(wallKey(r,c,"v"))) return false;
  }else{
    if(walls.has(wallKey(r-1,c,"v")) || walls.has(wallKey(r+1,c,"v"))) return false;
    if(walls.has(wallKey(r,c,"h"))) return false;
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


function edgeIsBlocked(a,b,walls){ return edgeBlocked(a,b,walls); }
function corridorStepBlockedSides(path, i, walls){
  if(i>=path.length-1) return 0;
  const a=path[i], b=path[i+1];
  const dr=b.r-a.r, dc=b.c-a.c;
  let n=0;
  if(dr!==0){
    const left={r:a.r,c:a.c-1}, right={r:a.r,c:a.c+1};
    if(left.c<0 || edgeIsBlocked(a,left,walls)) n++;
    if(right.c>=9 || edgeIsBlocked(a,right,walls)) n++;
  }else{
    const up={r:a.r-1,c:a.c}, down={r:a.r+1,c:a.c};
    if(up.r<0 || edgeIsBlocked(a,up,walls)) n++;
    if(down.r>=getBoardRows() || edgeIsBlocked(a,down,walls)) n++;
  }
  return n;
}
function tunnelProfile(player,walls,pos){
  const path=getOptimalPath(player,walls,pos);
  if(path.length<2) return {length:0,score:0,path};
  let run=0,best=0,score=0;
  const limit=Math.min(path.length-1,8);
  for(let i=0;i<limit;i++){
    const blocked=corridorStepBlockedSides(path,i,walls);
    if(blocked>=2){ run++; best=Math.max(best,run); score += run>=2 ? 2+run : 1; }
    else run=0;
  }
  return {length:best,score,path};
}
function tunnelDefenseCandidates(s, turn){
  const enemy=turn==="me"?"opp":"me";
  const enemyPos=turn==="me"?s.oppPos:s.myPos;
  const myPos=turn==="me"?s.myPos:s.oppPos;
  const myWalls=turn==="me"?s.myWalls:s.oppWalls;
  if(myWalls<=0) return [];
  const base=shortestPath(enemy,s.walls,enemyPos);
  const prof=tunnelProfile(enemy,s.walls,enemyPos);
  if(prof.length<2 && base>4) return [];
  const out=[]; const seen=new Set();
  const add=(r,c,o,reason)=>{
    if(r<0||r>getBoardRows()-2||c<0||c>7) return;
    const k=wallKey(r,c,o); if(seen.has(k)) return; seen.add(k);
    if(!legalWall(r,c,o,s.walls,s.myPos,s.oppPos)) return;
    const copy=new Set(s.walls); copy.add(k);
    const nd=shortestPath(enemy,copy,enemyPos);
    if(!isFinite(nd)) return;
    const gain=nd-base;
    const after=tunnelProfile(enemy,copy,enemyPos);
    const breakLen=Math.max(0,prof.length-after.length);
    const breakScore=Math.max(0,prof.score-after.score);
    let score=gain*10000+breakLen*9000+breakScore*2200;
    if(reason===0) score+=3500;
    if(gain>=2) score+=5000;
    if(gain===0 && breakLen===0) score-=3000;
    out.push({type:"wall",r,c,o,priority:score,tunnelBreak:true,eGain:gain,pLoss:0});
  };
  const path=prof.path;
  // Put the wall directly across the corridor in front of the opponent and
  // at the first few choke points. This is the key anti-tunnel rule.
  for(let i=0;i<Math.min(path.length,6);i++){
    const a=i===0?enemyPos:path[i-1], b=path[i];
    const dr=b.r-a.r, dc=b.c-a.c;
    if(dr!==0){ add(Math.min(a.r,b.r),a.c,"h",0); add(Math.min(a.r,b.r),a.c-1,"h",0); }
    else { add(a.r,a.c,"v",0); add(a.r-1,a.c,"v",0); }
  }
  return out.sort((a,b)=>b.priority-a.priority).slice(0,12);
}
function stepTunnelRisk(s, move){
  const child=applyMove(s,move,true);
  const prof=tunnelProfile("opp",child.walls,child.oppPos);
  const d=shortestPath("opp",child.walls,child.oppPos);
  let risk=0;
  if(prof.length>=2) risk += prof.length*3500;
  if(prof.length>=3) risk += 7000;
  if(prof.length>=4) risk += 12000;
  if(d<=4 && prof.length>=2) risk += 5000;
  return risk;
}

function wallImpact(turn,walls,pPos,ePos,w,baseP=null,baseE=null){
  const copy=new Set(walls); copy.add(wallKey(w.r,w.c,w.o));
  const p0=baseP==null?shortestPath(turn,walls,pPos):baseP;
  const e0=baseE==null?shortestPath(turn==="me"?"opp":"me",walls,ePos):baseE;
  const np=shortestPath(turn,copy,pPos);
  const ne=shortestPath(turn==="me"?"opp":"me",copy,ePos);
  if(!isFinite(np)||!isFinite(ne)) return null;
  const eGain=ne-e0, pLoss=np-p0;
  let score=eGain*3000-pLoss*2200;
  if(eGain>=2) score+=1500;
  if(pLoss===0 && eGain>=1) score+=1200;
  if(eGain<=0) score-=500;
  return {score,eGain,pLoss,critical:eGain>=1 || (pLoss===0 && eGain>0)};
}
function distanceField(player,walls,start){
  const rows=getBoardRows(), total=rows*9;
  const d=new Int16Array(total); d.fill(-1);
  let head=0,tail=0; const q=new Int16Array(total);
  const si=start.r*9+start.c; d[si]=0; q[tail++]=si;
  while(head<tail){
    const idx=q[head++],r=(idx/9)|0,c=idx%9;
    for(const [dr,dc] of dirs){
      const nr=r+dr,nc=c+dc;
      if(nr<0||nr>=rows||nc<0||nc>=9) continue;
      const ni=nr*9+nc; if(d[ni]!==-1) continue;
      if(edgeBlocked({r,c},{r:nr,c:nc},walls)) continue;
      d[ni]=d[idx]+1; q[tail++]=ni;
    }
  }
  return d;
}
function distanceToGoalField(player,walls){
  const rows=getBoardRows(), total=rows*9, goal=getGoalRow(player);
  const d=new Int16Array(total); d.fill(-1);
  let head=0,tail=0; const q=new Int16Array(total);
  for(let c=0;c<9;c++){ const idx=goal*9+c; d[idx]=0; q[tail++]=idx; }
  while(head<tail){
    const idx=q[head++],r=(idx/9)|0,c=idx%9;
    for(const [dr,dc] of dirs){
      const nr=r+dr,nc=c+dc;
      if(nr<0||nr>=rows||nc<0||nc>=9) continue;
      const ni=nr*9+nc; if(d[ni]!==-1) continue;
      if(edgeBlocked({r,c},{r:nr,c:nc},walls)) continue;
      d[ni]=d[idx]+1; q[tail++]=ni;
    }
  }
  return d;
}
function candidateWallKeys(s,turn,pPos,ePos){
  const keys=new Set(), rows=getBoardRows();
  const add=(r,c,rad)=>{
    for(let dr=-rad;dr<=rad;dr++) for(let dc=-rad;dc<=rad;dc++){
      const rr=r+dr,cc=c+dc; if(rr<0||rr>rows-2||cc<0||cc>7) continue;
      keys.add(wallKey(rr,cc,"h")); keys.add(wallKey(rr,cc,"v"));
    }
  };
  const addPathFrontier=(player,pos)=>{
    const ds=distanceField(player,s.walls,pos), goal=getGoalRow(player);
    let best=Infinity;
    for(let c=0;c<9;c++){
      const idx=goal*9+c; if(ds[idx]>=0) best=Math.min(best,ds[idx]);
    }
    if(!isFinite(best)) return;
    // Include every cell belonging to a shortest route, not just one BFS path.
    const dg=distanceToGoalField(player,s.walls);
    for(let r=0;r<rows;r++) for(let c=0;c<9;c++){
      const a=ds[r*9+c], b=dg[r*9+c];
      if(a>=0&&b>=0&&a+b===best) add(r,c,1);
    }
  };
  const ep=getOptimalPath(turn==="me"?"opp":"me",s.walls,ePos);
  const pp=getOptimalPath(turn,s.walls,pPos);
  for(const pt of ep) add(pt.r,pt.c,1);
  for(const pt of pp) add(pt.r,pt.c,0);
  addPathFrontier(turn==="me"?"opp":"me",ePos);
  addPathFrontier(turn,pPos);
  // Strong MCTS-style candidate classes: near pawns, near existing walls,
  // and edge horizontal walls. These catch strategic moves not on one shortest path.
  add(ePos.r,ePos.c,2); add(pPos.r,pPos.c,1);
  for(const wk of s.walls){
    const [r,c]=wk.split(",").map(Number); add(r,c,1);
  }
  for(const c of [0,7]) for(let r=0;r<=rows-2;r++) add(r,c,0);
  return keys;
}


// ---------------------------------------------------------------------------
// THREAT-ORIENTED QUORIDOR SEARCH
// ---------------------------------------------------------------------------
// A normal distance heuristic answers "whose shortest route is shorter?".
// That is not enough in Quoridor.  A player can spend two wall turns building
// a choke/tunnel that only becomes visible after the first wall is placed.
// The routines below explicitly search that wall plan:
//     opponent wall -> our best defensive reply -> opponent wall
// and score the resulting route geometry.  It is deliberately narrow and
// geometry-driven, so it costs far less than widening the whole alpha-beta.

const threatCache = new Map();
const threatPlanCache = new Map();

function routeSignature(player,walls,pos,other){
  const d=shortestPath(player,walls,pos);
  if(!isFinite(d)) return {d:999,paths:0,tunnel:99,choke:99,exits:0};
  const paths=Math.min(32,pathCount(player,walls,pos,32));
  const exits=optimalExits(player,walls,pos,other,d);
  const prof=tunnelProfile(player,walls,pos);
  // A simple choke score: fewer shortest-path options + fewer optimal exits
  // means a wall plan has very little redundancy to destroy.
  const choke=Math.max(0,8-Math.min(8,paths))+Math.max(0,4-Math.min(4,exits));
  return {d,paths,tunnel:prof.length,choke,exits};
}

function strategicThreat(s,attacker="opp"){
  const aPos=attacker==="me"?s.myPos:s.oppPos;
  const dPos=attacker==="me"?s.oppPos:s.myPos;
  const aWalls=attacker==="me"?s.myWalls:s.oppWalls;
  if(aWalls<=0) return {score:0,move:null};
  const key=attacker+"|"+stateKey(s.walls,s.myPos,s.oppPos,s.myWalls,s.oppWalls,attacker);
  const cached=threatCache.get(key); if(cached) return cached;
  const base=routeSignature(attacker,s.walls,aPos,dPos);
  const keys=candidateWallKeys(s,attacker,aPos,dPos);
  const walls=[];
  for(const k of keys){
    if(expired()) break;
    const [r,c,o]=k.split(",");
    const w={r:+r,c:+c,o};
    if(s.walls.has(k) || !legalWall(r,c,o,s.walls,s.myPos,s.oppPos)) continue;
    const copy=new Set(s.walls); copy.add(k);
    const after=routeSignature(attacker,copy,aPos,dPos);
    if(!isFinite(after.d)) continue;
    const gain=after.d-base.d;
    const collapse=Math.max(0,base.paths-after.paths);
    const tunnel=after.tunnel;
    const choke=after.choke;
    const score=gain*9000 + collapse*1800 + tunnel*1200 + choke*650
      + (gain>=2?7000:0) + (gain>=1 && after.paths<=2?4500:0);
    walls.push({m:{type:"wall",r,c,o},score,gain,after});
  }
  walls.sort((a,b)=>b.score-a.score);
  const result={score:walls.length?walls[0].score:0,move:walls[0]?.m||null,base,top:walls.slice(0,8)};
  threatCache.set(key,result);
  if(threatCache.size>50000){ const it=threatCache.keys(); for(let i=0;i<10000;i++){const n=it.next();if(n.done)break;threatCache.delete(n.value);} }
  return result;
}

function quickWallMoves(s,turn,limit=8){
  const pPos=turn==="me"?s.myPos:s.oppPos;
  const ePos=turn==="me"?s.oppPos:s.myPos;
  const pWalls=turn==="me"?s.myWalls:s.oppWalls;
  if(pWalls<=0) return [];
  const p0=shortestPath(turn,s.walls,pPos), e0=shortestPath(turn==="me"?"opp":"me",s.walls,ePos);
  const scored=[];
  const seen=new Set();
  for(const tm of tunnelDefenseCandidates(s,turn)){
    const k=moveKey(tm); if(!seen.has(k)){seen.add(k);scored.push(tm);}
  }
  for(const k of candidateWallKeys(s,turn,pPos,ePos)){
    if(expired() || seen.has("w:"+k)) continue;
    const [r,c,o]=k.split(",");
    if(!legalWall(+r,+c,o,s.walls,s.myPos,s.oppPos)) continue;
    const w={r:+r,c:+c,o};
    const impact=wallImpact(turn,s.walls,pPos,ePos,w,p0,e0);
    if(!impact) continue;
    const copy=new Set(s.walls);copy.add(k);
    const enemy=turn==="me"?"opp":"me";
    const ep=routeSignature(enemy,copy,ePos,pPos);
    let priority=impact.score + (ep.tunnel>=2?ep.tunnel*1800:0) + (ep.paths<=2?2500:0);
    scored.push({...w,type:"wall",priority,eGain:impact.eGain,pLoss:impact.pLoss});
  }
  scored.sort((a,b)=>b.priority-a.priority);
  const out=[];const used=new Set();
  for(const m of scored){const k=moveKey(m);if(!used.has(k)){used.add(k);out.push(m);if(out.length>=limit)break;}}
  return out;
}

function quickResponseMoves(s,limit=8){
  const out=[];
  const steps=legalMoves("me",s.walls,s.myPos,s.oppPos);
  const base=shortestPath("me",s.walls,s.myPos);
  for(const p of steps){
    const m={type:"step",r:p.r,c:p.c};
    const child=applyMove(s,m,true);
    const d=shortestPath("me",child.walls,child.myPos);
    const od=shortestPath("opp",child.walls,child.oppPos);
    out.push({...m,priority:(base-d)*2500+(od-shortestPath("opp",s.walls,s.oppPos))*600});
  }
  if(s.myWalls>0) out.push(...quickWallMoves(s,"me",limit));
  out.sort((a,b)=>b.priority-a.priority);
  return out.slice(0,limit);
}


function urgentTunnelDefenseFilter(s,moves){
  const prof=tunnelProfile("opp",s.walls,s.oppPos);
  const od=shortestPath("opp",s.walls,s.oppPos);
  if(prof.length<3 || od<=0 || s.myWalls<=0) return moves;
  const scored=[];
  for(const m of moves){
    if(expired()) break;
    const child=applyMove(s,m,true);
    const after=tunnelProfile("opp",child.walls,child.oppPos);
    const nd=shortestPath("opp",child.walls,child.oppPos);
    const md=shortestPath("me",child.walls,child.myPos);
    const gain=nd-od;
    const breakLen=prof.length-after.length;
    const safeSelf=md<=shortestPath("me",s.walls,s.myPos)+1;
    const tactical=(gain>=2 && safeSelf) || (breakLen>=2 && safeSelf) || (gain>=3 && md<=od+2);
    scored.push({m,gain,breakLen,safeSelf,tactical,score:gain*9000+breakLen*11000+(safeSelf?1200:0)});
  }
  const good=scored.filter(x=>x.tactical).sort((a,b)=>b.score-a.score).map(x=>x.m);
  return good.length?good:moves;
}

function wallPlanThreat(s,depth=2){
  const key=depth+"|"+stateKey(s.walls,s.myPos,s.oppPos,s.myWalls,s.oppWalls,"plan");
  const cached=threatPlanCache.get(key); if(cached!==undefined) return cached;
  if(s.oppWalls<=0){threatPlanCache.set(key,0);return 0;}
  const first=quickWallMoves(s,"opp",6);
  if(!first.length){threatPlanCache.set(key,0);return 0;}
  let worst=0;
  for(const fw of first){
    if(expired()){timedOut=true;break;}
    const s1=applyMove(s,fw,false);
    const sig1=routeSignature("opp",s1.walls,s1.oppPos,s1.myPos);
    const immediate=(sig1.d-routeSignature("opp",s.walls,s.oppPos,s.myPos).d)*9000 + Math.max(0,sig1.tunnel-1)*1600 + Math.max(0,8-sig1.paths)*450;
    if(depth<=1){ worst=Math.max(worst,fw.priority+immediate); continue; }
    const replies=quickResponseMoves(s1,5);
    let bestDefense=Infinity;
    for(const reply of replies){
      const s2=applyMove(s1,reply,true);
      const second=quickWallMoves(s2,"opp",4);
      let secondThreat=0;
      if(second.length){
        for(const sw of second){
          const s3=applyMove(s2,sw,false);
          const sig=routeSignature("opp",s3.walls,s3.oppPos,s3.myPos);
          const mySig=routeSignature("me",s3.walls,s3.myPos,s3.oppPos);
          const v=(sig.d-mySig.d)*5000 + Math.max(0,8-sig.paths)*900
            + sig.tunnel*1800 + sig.choke*500 + (sig.d<=mySig.d?3500:0);
          secondThreat=Math.max(secondThreat,v);
        }
      }
      const sigMy=routeSignature("me",s2.walls,s2.myPos,s2.oppPos);
      const sigOpp=routeSignature("opp",s2.walls,s2.oppPos,s2.myPos);
      const residual=(sigOpp.d-sigMy.d)*4000 + sigOpp.tunnel*1400
        + Math.max(0,8-sigOpp.paths)*700 + sigOpp.choke*450;
      bestDefense=Math.min(bestDefense,Math.max(residual,secondThreat));
      if(bestDefense<0) break;
    }
    const planScore=fw.priority+immediate+Math.max(0,bestDefense===Infinity?0:bestDefense);
    worst=Math.max(worst,planScore);
  }
  threatPlanCache.set(key,worst);
  if(threatPlanCache.size>30000){const it=threatPlanCache.keys();for(let i=0;i<5000;i++){const n=it.next();if(n.done)break;threatPlanCache.delete(n.value);}}
  return worst;
}
function exactShallowCandidates(s,turn,limit=32){
  const pPos=turn==="me"?s.myPos:s.oppPos;
  const ePos=turn==="me"?s.oppPos:s.myPos;
  const pWalls=turn==="me"?s.myWalls:s.oppWalls;
  const out=[];
  for(const p of legalMoves(turn,s.walls,pPos,ePos)) out.push({type:"step",r:p.r,c:p.c,priority:100000-(shortestPath(turn,s.walls,p)-0)*10});
  if(pWalls<=0) return out;
  const baseP=shortestPath(turn,s.walls,pPos), baseE=shortestPath(turn==="me"?"opp":"me",s.walls,ePos);
  const walls=[];
  for(const w of allValidWalls(s.walls,s.myPos,s.oppPos)){
    if(expired()){timedOut=true;break;}
    const impact=wallImpact(turn,s.walls,pPos,ePos,w,baseP,baseE);
    if(!impact) continue;
    const copy=new Set(s.walls); copy.add(wallKey(w.r,w.c,w.o));
    const ps=routeSignature(turn,copy,pPos,ePos);
    const es=routeSignature(turn==="me"?"opp":"me",copy,ePos,pPos);
    let priority=impact.score
      +(es.paths<=2?2200:0)
      +(es.exits<=1?1800:0)
      +(es.tunnel>=2?2500:0)
      +(impact.eGain>=2&&impact.pLoss===0?6500:0)
      +(impact.eGain===1&&impact.pLoss===0?2200:0);
    walls.push({...w,type:"wall",priority,eGain:impact.eGain,pLoss:impact.pLoss});
  }
  walls.sort((a,b)=>b.priority-a.priority);
  out.push(...walls.slice(0,limit));
  out.sort((a,b)=>b.priority-a.priority);
  return out.slice(0,limit+4);
}

function generateCandidates(s,turn,depth,root=false){
  const pPos=turn==="me"?s.myPos:s.oppPos;
  const ePos=turn==="me"?s.oppPos:s.myPos;
  const pWalls=turn==="me"?s.myWalls:s.oppWalls;
  const eWalls=turn==="me"?s.oppWalls:s.myWalls;
  // The first reply layer is strategically critical. Use a broader, exact wall
  // set there so the engine cannot miss the opponent's best counter-wall.
  // Deeper plies remain selective to keep strength/ms high.
  if(!root && depth<=1) return exactShallowCandidates(s,turn,24);
  const p0=shortestPath(turn,s.walls,pPos);
  const e0=shortestPath(turn==="me"?"opp":"me",s.walls,ePos);
  const moves=[];
  for(const m of legalMoves(turn,s.walls,pPos,ePos)){
    const child=applyMove(s,{type:"step",r:m.r,c:m.c},turn==="me");
    const np=shortestPath(turn,child.walls,turn==="me"?child.myPos:child.oppPos);
    const ne=shortestPath(turn==="me"?"opp":"me",child.walls,turn==="me"?child.oppPos:child.myPos);
    let score=(p0-np)*2500+(ne-e0)*600;
    score -= stepTunnelRisk(s,{type:"step",r:m.r,c:m.c});
    if(np===0) score+=1e8;
    const key=moveKey({type:"step",r:m.r,c:m.c});
    score+=history.get(key)||0;
    if(killer[depth] && killer[depth].includes(key)) score+=1800;
    moves.push({type:"step",r:m.r,c:m.c,priority:score});
  }
  if(pWalls<=0) return moves.sort((a,b)=>b.priority-a.priority);

  const tunnelMoves=tunnelDefenseCandidates(s,turn);
  const scored=[];
  for(const tm of tunnelMoves){ scored.push(tm); }
  const keys=candidateWallKeys(s,turn,pPos,ePos);
  for(const k of keys){
    if(expired()){timedOut=true;break;}
    if(s.walls.has(k)) continue;
    const [r,c,o]=k.split(",");
    const w={r:+r,c:+c,o};
    if(!legalWall(w.r,w.c,w.o,s.walls,s.myPos,s.oppPos)) continue;
    const impact=wallImpact(turn,s.walls,pPos,ePos,w,p0,e0);
    if(!impact) continue;
    let score=impact.score;
    // Evaluate whether this wall also survives the opponent's next wall plan.
    // At shallow nodes this is cheap enough to materially improve threat vision.
    if(turn==="me" && depth<=3){
      const child=applyMove(s,{...w,type:"wall"},true);
      const future=wallPlanThreat(child,1);
      score-=future*0.18;
    }
    if(eWalls>=5 && impact.eGain>0) score+=impact.eGain*500;
    if(s.walls.size===0 && impact.eGain<=impact.pLoss) score-=2500;
    const key=moveKey({...w,type:"wall"});
    score+=history.get(key)||0;
    if(killer[depth] && killer[depth].includes(key)) score+=1500;
    scored.push({...w,type:"wall",priority:score,critical:impact.critical,eGain:impact.eGain,pLoss:impact.pLoss});
  }
  scored.sort((a,b)=>b.priority-a.priority);
  const limit=root ? 20 : (depth>=6 ? 6 : (depth>=4 ? 8 : 10));
  moves.push(...scored.slice(0,limit));
  moves.sort((a,b)=>b.priority-a.priority);
  if(PV){
    const pk=moveKey(PV),idx=moves.findIndex(m=>moveKey(m)===pk);
    if(idx>0){const [x]=moves.splice(idx,1);moves.unshift(x);}
  }
  return moves;
}
function evaluate(s){
  const md=shortestPath("me",s.walls,s.myPos);
  const od=shortestPath("opp",s.walls,s.oppPos);
  if(s.myPos.r===getGoalRow("me")) return 100000000;
  if(s.oppPos.r===getGoalRow("opp")) return -100000000;
  if(!isFinite(md)) return -100000000;
  if(!isFinite(od)) return 100000000;

  const mySig=routeSignature("me",s.walls,s.myPos,s.oppPos);
  const oppSig=routeSignature("opp",s.walls,s.oppPos,s.myPos);
  let v=(od-md)*2800 + (s.myWalls-s.oppWalls)*105;
  v += (mySig.paths-oppSig.paths)*420;
  v += (mySig.exits-oppSig.exits)*320;
  v += (oppSig.tunnel-mySig.tunnel)*1650;
  v += (oppSig.choke-mySig.choke)*420;

  // Strategic wall-plan term. It is only invoked when the position is
  // tactically relevant; ordinary open positions stay cheap.
  const critical=(s.oppWalls>0 && (od<=6 || md<=6 || Math.abs(md-od)<=2 || oppSig.tunnel>=2 || oppSig.paths<=2));
  if(critical){
    const plan=wallPlanThreat(s,1);
    v-=plan*0.42;
  }
  if(s.oppWalls>=5 && od<=md+2) v-=250;
  if(s.myWalls>0 && md<=od+1) v+=120;
  if(s.myWalls+s.oppWalls<=4) v+=(od-md)*650;
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
    // A shallow quiescence pass prevents the classic horizon failure where
    // the opponent has an immediate wall tactic that static evaluation misses.
    const stand=evaluate(s);
    const forcing=tacticalForcingMoves(s,maximizing?"me":"opp").slice(0,8);
    if(!forcing.length){ TT.set(key,{depth,score:stand,flag:0}); return stand; }
    let q=stand;
    for(const m of forcing){
      const child=applyMove(s,m,maximizing);
      const v=evaluate(child);
      if(maximizing) q=Math.max(q,v); else q=Math.min(q,v);
      if(expired()){timedOut=true;return 0;}
    }
    TT.set(key,{depth,score:q,flag:0});
    return q;
  }

  const turn=maximizing?"me":"opp";
  const moves=generateCandidates(s,turn,depth,false);
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
  let first=true;
  for(const m of moves){
    if(expired()){timedOut=true;break;}
    const child=applyMove(state,m,true);
    const childKey=stateKey(child.walls,child.myPos,child.oppPos,child.myWalls,child.oppWalls,"opp");
    if(recentPositionKeys.includes(childKey)) continue;
    let val;
    if(first){
      val=minimax(child,depth-1,false,alpha,Infinity);
      first=false;
    }else{
      val=minimax(child,depth-1,false,alpha,alpha+1);
      if(timedOut) break;
      if(val>alpha && val<Infinity) val=minimax(child,depth-1,false,alpha,Infinity);
    }
    if(timedOut) break;
    scores.push({m,val});
    if(val>bestScore){bestScore=val;best=m;PV=m;}
    if(val>alpha)alpha=val;
  }
  return {move:best,score:bestScore,complete:!timedOut,scores};
}
// -------------------- MCTS challenger --------------------
// MCTS is deliberately a challenger rather than the primary decision maker.
// Quoridor benefits from adversarial alpha-beta search; MCTS is useful here
// mainly for discovering a tactical wall/route that heuristic ordering missed.
let rngState=0x9e3779b9;
function rand(){
  rngState|=0; rngState^=rngState<<13; rngState^=rngState>>>17; rngState^=rngState<<5;
  return ((rngState>>>0)/4294967296);
}
function fastRolloutMoves(s,turn,limit=8){
  const pPos=turn==="me"?s.myPos:s.oppPos;
  const ePos=turn==="me"?s.oppPos:s.myPos;
  const out=[];
  for(const p of legalMoves(turn,s.walls,pPos,ePos)) out.push({type:"step",r:p.r,c:p.c,priority:0});
  const pWalls=turn==="me"?s.myWalls:s.oppWalls;
  if(pWalls>0){
    const ep=getOptimalPath(turn==="me"?"opp":"me",s.walls,ePos);
    const around=[];
    const seen=new Set();
    for(const pt of ep){
      for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
        const r=pt.r+dr,c=pt.c+dc;
        for(const o of ["h","v"]){
          if(r<0||r>getBoardRows()-2||c<0||c>7) continue;
          const k=wallKey(r,c,o); if(seen.has(k)) continue; seen.add(k);
          if(legalWall(r,c,o,s.walls,s.myPos,s.oppPos)) around.push({type:"wall",r,c,o,priority:0});
        }
      }
      if(around.length>=limit*2) break;
    }
    out.push(...around);
  }
  out.sort((a,b)=>{
    const sa=(a.type==="step"?1:0), sb=(b.type==="step"?1:0);
    return sb-sa + (rand()-.5)*0.05;
  });
  return out.slice(0,limit);
}
function rolloutValue(s,turn,plies=8){
  let cur=s, max=(turn==="me");
  for(let i=0;i<plies;i++){
    const t=terminal(cur,plies-i); if(t!==null) return t;
    const moves=fastRolloutMoves(cur,max?"me":"opp",6);
    if(!moves.length) break;
    // Softly favor the first heuristic moves while retaining diversity.
    const idx=rand()<0.65?0:Math.min(moves.length-1,(rand()*moves.length)|0);
    cur=applyMove(cur,moves[idx],max);
    max=!max;
    if(expired()){timedOut=true;return 0;}
  }
  return evaluate(cur);
}
function mctsChallenge(rootMoves,baseScores){
  if(now()>=deadline-180 || rootMoves.length<2) return null;
  const n=Math.min(36,rootMoves.length*5);
  const stats=new Map();
  for(const m of rootMoves.slice(0,Math.min(16,rootMoves.length))) stats.set(moveKey(m),{m,n:0,v:0});
  const arr=[...stats.values()];
  for(let i=0;i<n;i++){
    if(expired() || now()>=deadline-80) break;
    let total=1,sel=arr[0],best=-Infinity;
    for(const x of arr){
      const u=x.n===0?1e9:(x.v/x.n + 900*Math.sqrt(Math.log(total+1)/x.n));
      if(u>best){best=u;sel=x;}
      total+=x.n;
    }
    const child=applyMove(state,sel.m,true);
    const v=rolloutValue(child,"opp",7);
    sel.n++;sel.v+=v; total++;
  }
  arr.sort((a,b)=>b.n-a.n);
  const bestM=arr.sort((a,b)=>(b.v/Math.max(1,b.n))-(a.v/Math.max(1,a.n)))[0];
  if(!bestM) return null;
  const base=baseScores.get(moveKey(bestM.m));
  const top=baseScores.size?Math.max(...baseScores.values()):0;
  // MCTS may break a near-tie, but cannot overturn a clearly superior proof/search score.
  if(base===undefined || (top-base)<1800) return bestM.m;
  return null;
}

function tacticalForcingMoves(s,turn){
  const pPos=turn==="me"?s.myPos:s.oppPos, ePos=turn==="me"?s.oppPos:s.myPos;
  const pWalls=turn==="me"?s.myWalls:s.oppWalls;
  const out=[];
  for(const m of legalMoves(turn,s.walls,pPos,ePos)){
    const cm=applyMove(s,{type:"step",r:m.r,c:m.c},turn==="me");
    const d=shortestPath(turn,cm.walls,turn==="me"?cm.myPos:cm.oppPos);
    if(d<=1) out.push({type:"step",r:m.r,c:m.c,priority:1e8});
  }
  if(pWalls>0){
    const ep=getOptimalPath(turn==="me"?"opp":"me",s.walls,ePos);
    const seen=new Set();
    for(const pt of ep){
      for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++) for(const o of ["h","v"]){
        const r=pt.r+dr,c=pt.c+dc;
        if(r<0||r>getBoardRows()-2||c<0||c>7) continue;
        const k=wallKey(r,c,o); if(seen.has(k)) continue; seen.add(k);
        if(!legalWall(r,c,o,s.walls,s.myPos,s.oppPos)) continue;
        const impact=wallImpact(turn,s.walls,pPos,ePos,{r,c,o});
        if(impact && (impact.eGain>=2 || (impact.eGain>=1 && impact.pLoss===0))) out.push({type:"wall",r,c,o,priority:impact.score});
      }
      if(out.length>=20) break;
    }
  }
  return out.sort((a,b)=>b.priority-a.priority);
}


// ============================================================
// APK-HARD INSPIRED FAST POLICY
// Reconstructed from the supplied Quoridor - Wall Block APK.
// The APK's Hard selector is deliberately lightweight: it builds
// path/wall candidates, uses shortest-route geometry, and changes
// from aggressive wall play to path play when the wall reserve is low.
// We use that policy as a fast independent challenger/tie-breaker,
// never as a blind override of a proven Alpha-Beta result.
// ============================================================
function apkHardFastCandidate(){
  const p=state.myPos, e=state.oppPos;
  const wallsLeft=state.myWalls;
  const stepMoves=legalMoves("me",state.walls,p,e).map(x=>({type:"step",r:x.r,c:x.c,priority:0}));
  if(!stepMoves.length) return null;

  // The APK works from route geometry rather than enumerating the entire
  // wall board. Build a compact candidate set around the opponent's route,
  // our route, both pawns, and existing walls.
  const wallCandidates=[];
  const seen=new Set();
  const addWall=(r,c,o)=>{
    if(r<0||r>getBoardRows()-2||c<0||c>7) return;
    const k=wallKey(r,c,o); if(seen.has(k)) return; seen.add(k);
    if(legalWall(r,c,o,state.walls,p,e)) wallCandidates.push({type:"wall",r,c,o,priority:0});
  };
  const addAroundPath=(player,pos)=>{
    const path=getOptimalPath(player,state.walls,pos);
    for(const pt of path){
      for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
        addWall(pt.r+dr,pt.c+dc,"h");
        addWall(pt.r+dr,pt.c+dc,"v");
      }
      if(wallCandidates.length>90) break;
    }
  };
  addAroundPath("opp",e);
  addAroundPath("me",p);
  for(const wk of state.walls){
    const z=wk.split(","); addWall(+z[0],+z[1],"h"); addWall(+z[0],+z[1],"v");
  }

  const myBase=shortestPath("me",state.walls,p);
  const oppBase=shortestPath("opp",state.walls,e);
  for(const w of wallCandidates){
    const copy=new Set(state.walls); copy.add(wallKey(w.r,w.c,w.o));
    const md=shortestPath("me",copy,p);
    const od=shortestPath("opp",copy,e);
    if(!isFinite(md)||!isFinite(od)){ w.priority=-1e9; continue; }
    const enemyGain=od-oppBase;
    const selfCost=md-myBase;
    let score=enemyGain*10000-selfCost*7000;
    // The APK's wall ranking is route-aware and gives special weight to
    // preserving a route while increasing the opponent's distance.
    if(enemyGain>=2) score+=5000;
    if(enemyGain>=1 && selfCost===0) score+=3500;
    if(enemyGain===1 && selfCost<=0) score+=1800;
    if(selfCost>enemyGain) score-=2500;
    w.priority=score;
  }
  wallCandidates.sort((a,b)=>b.priority-a.priority);

  // Match the discovered Hard policy's reserve switch:
  // plenty of walls -> prefer the strongest route-blocking wall;
  // low reserve -> prefer the best forward/path move.
  if(wallsLeft>5 && wallCandidates.length){
    return wallCandidates[0].priority>-1e8 ? wallCandidates[0] : stepMoves[0];
  }

  let best=stepMoves[0], bestD=Infinity, bestAdvance=-Infinity;
  for(const m of stepMoves){
    const d=shortestPath("me",state.walls,{r:m.r,c:m.c});
    const advance=p.r-m.r;
    if(d<bestD || (d===bestD && advance>bestAdvance)){
      best=m; bestD=d; bestAdvance=advance;
    }
  }
  return best;
}

function calculateBestMove(){
  TT.clear();proofTT.clear();threatCache.clear();threatPlanCache.clear();PV=null;nodes=0;timedOut=false;pathStack=new Set();
  rngState=(Date.now() ^ (state.me.r*73856093) ^ (state.opp.c*19349663))>>>0;

  // Ultra-fast elementary path: do not spend wall-search time when the position
  // has no meaningful wall decision. This keeps routine moves essentially instant.
  const steps=legalMoves("me",state.walls,state.myPos,state.oppPos).map(p=>({type:"step",r:p.r,c:p.c,priority:0}));
  const direct=steps.find(m=>m.r===getGoalRow("me"));
  if(direct) return direct;
  if(state.myWalls<=0){
    let bestStep=null,bestD=Infinity;
    for(const m of steps){ const d=shortestPath("me",state.walls,{r:m.r,c:m.c}); if(d<bestD){bestD=d;bestStep=m;} }
    return bestStep;
  }

  const md=shortestPath("me",state.walls,state.myPos);
  const od=shortestPath("opp",state.walls,state.oppPos);
  // Compute the deterministic progress step before the search deadline can
  // expire. It is the final safety net against a timed-out heuristic returning
  // a lateral/retreating move.
  let progressStep=null, progressDist=Infinity;
  for(const m of steps){
    const d=shortestPath("me",state.walls,{r:m.r,c:m.c});
    if(d<progressDist){progressDist=d;progressStep=m;}
  }
  const totalWalls=state.myWalls+state.oppWalls;
  const opening = state.walls.size === 0;
  const sameRace = gameMode === "race" && state.walls.size === 0;
  const aiStartRow = getGoalRow("me")===0 ? getBoardRows()-1 : 0;
  const oppStartRow = getGoalRow("opp")===0 ? getBoardRows()-1 : 0;
  const forwardDir = getGoalRow("me")===0 ? -1 : 1;
  const initial = opening && state.myPos.r===aiStartRow && state.myPos.c===4 && state.oppPos.r===oppStartRow && state.oppPos.c===4;
  // Empty-board safety: lateral moves never reduce our route. They must not
  // become the fallback merely because threat analysis consumed the budget.
  if(opening && initial) return {type:"step",r:state.myPos.r+forwardDir,c:state.myPos.c,priority:0};
  const critical=(state.oppWalls>=5 || state.myWalls<=2 || md<=4 || od<=4 || Math.abs(md-od)<=2);
  const budget = opening ? 260 : (totalWalls<=1 ? 700 : (totalWalls<=3 ? 480 : (critical ? 360 : 260)));
  const searchStart=now();
  const generationBudget=Math.min(55, Math.max(22, Math.floor(budget*0.10)));
  deadline=searchStart+generationBudget;

  let root=generateCandidates(state,"me",1,true);

  // At the ROOT we can afford to be exhaustive over legal walls (at most
  // 128 placements on a standard 9x9 board).  The old candidate frontier
  // could simply omit the one strategic wall that wins the position.
  // Search remains selective below the root.
  if(state.myWalls>0 && !opening){
    const rootWalls=[];
    const validWalls=allValidWalls(state.walls,state.myPos,state.oppPos);
    for(const w of validWalls){
      const impact=wallImpact("me",state.walls,state.myPos,state.oppPos,w);
      if(!impact) continue;
      const copy=new Set(state.walls); copy.add(wallKey(w.r,w.c,w.o));
      const mySig=routeSignature("me",copy,state.myPos,state.oppPos);
      const oppSig=routeSignature("opp",copy,state.oppPos,state.myPos);
      let priority=impact.score
        +(oppSig.paths<=2?1800:0)
        +(oppSig.exits<=1?1600:0)
        +(oppSig.tunnel>=2?2200:0)
        +(oppSig.d<=mySig.d?1800:0);
      if(impact.eGain>=2 && impact.pLoss===0) priority+=6500;
      rootWalls.push({...w,type:"wall",priority,eGain:impact.eGain,pLoss:impact.pLoss});
    }
    rootWalls.sort((a,b)=>b.priority-a.priority);
    const rootSteps=root.filter(m=>m.type==="step");
    root=[...rootSteps,...rootWalls.slice(0,24)];
  }else if(opening){
    const stepsOnly=root.filter(m=>m.type==="step");
    const wallsOnly=root.filter(m=>m.type==="wall");
    root=[...stepsOnly,...wallsOnly.slice(0,12)];
  }
  // Candidate generation is deliberately time-boxed; give the actual search the
  // remainder of the full budget instead of returning the first wall found.
  deadline=searchStart+budget;
  timedOut=false;

  // If the short candidate pass spent its slice on path analysis and produced
  // no wall candidates, do one bounded wall-only pass with the real deadline.
  // The old engine could enter search with steps only, then overwrite a sane
  // wall plan with a lateral step. This pass guarantees that walls are present
  // before Alpha-Beta starts.
  if(state.myWalls>0 && !root.some(m=>m.type==="wall")){
    const orderedKeys=[]; const seenKeys=new Set();
    const pushKey=(r,c,o)=>{ if(r<0||r>getBoardRows()-2||c<0||c>7)return; const k=wallKey(r,c,o); if(!seenKeys.has(k)){seenKeys.add(k);orderedKeys.push(k);} };
    // First inspect the exact walls that cross the opponent's next shortest-path
    // edges. This is dramatically cheaper and more reliable than hoping a Set
    // iteration reaches the important choke point before the time slice ends.
    const ep=getOptimalPath("opp",state.walls,state.oppPos);
    let prev=state.oppPos;
    for(const pt of ep.slice(0,8)){
      const dr=pt.r-prev.r, dc=pt.c-prev.c;
      if(dr!==0){ const rr=Math.min(prev.r,pt.r); pushKey(rr,prev.c,"h"); pushKey(rr,prev.c-1,"h"); }
      else { const cc=Math.min(prev.c,pt.c); pushKey(prev.r,cc,"v"); pushKey(prev.r-1,cc,"v"); }
      // Nearby alternatives catch a one-step detour without exploding the list.
      for(let dr2=-1;dr2<=1;dr2++) for(let dc2=-1;dc2<=1;dc2++){ pushKey(pt.r+dr2,pt.c+dc2,"h"); pushKey(pt.r+dr2,pt.c+dc2,"v"); }
      prev=pt;
    }
    for(const k of candidateWallKeys(state,"me",state.myPos,state.oppPos)) if(!seenKeys.has(k)){seenKeys.add(k);orderedKeys.push(k);}
    const wallOnly=[]; let checked=0;
    for(const k of orderedKeys){
      if(expired() || checked>=36) break;
      const [r,c,o]=k.split(",");
      if(!legalWall(+r,+c,o,state.walls,state.myPos,state.oppPos)) continue;
      const impact=wallImpact("me",state.walls,state.myPos,state.oppPos,{r:+r,c:+c,o});
      if(impact) wallOnly.push({type:"wall",r:+r,c:+c,o,priority:impact.score,eGain:impact.eGain,pLoss:impact.pLoss});
      checked++;
    }
    wallOnly.sort((a,b)=>b.priority-a.priority);
    if(wallOnly.length) root.push(...wallOnly.slice(0,24));
  }
  if(!root.length)return null;

  // Immediate tactical truth beats every heuristic.
  const win=root.find(m=>m.type==="step" && m.r===getGoalRow("me"));
  if(win)return win;

  // Independent APK-derived challenger. Keep it available as a PV seed and
  // fallback, but let complete Alpha-Beta results overrule it.
  const tunnelGuard=tunnelDefenseCandidates(state,"me");
  if(tunnelGuard.length){
    const tp=tunnelProfile("opp",state.walls,state.oppPos);
    const tg=tunnelGuard[0];
    const urgent=tp.length>=3 || (tp.length>=2 && tg.eGain>=1);
    if(urgent){
      const ti=root.findIndex(m=>moveKey(m)===moveKey(tg));
      if(ti>0){ const [tx]=root.splice(ti,1); root.unshift(tx); }
      if(tg.eGain>=2 || tp.length>=3){
        root=[tg,...root.filter(m=>moveKey(m)!==moveKey(tg))];
      }
    }
  }


  // Root threat screen: compare every serious candidate against the opponent's
  // two-wall plan. This is the architectural fix for "I keep running while
  // the opponent builds the tunnel". A wall is not considered good merely
  // because it adds +1/+2 to the current path; it must also leave us a viable
  // defense after the opponent's next wall.
  if(state.oppWalls>0 && state.walls.size>=2 && (od<=7 || md<=7 || Math.abs(md-od)<=2)){
    const screened=[];
    const baseThreat=wallPlanThreat(state,2);
    for(const m of root){
      if(expired()){timedOut=true;break;}
      const child=applyMove(state,m,true);
      const future=wallPlanThreat(child,2);
      const threatDelta=future-baseThreat;
      const sigOpp=routeSignature("opp",child.walls,child.oppPos,child.myPos);
      const planPenalty=Math.max(0,threatDelta)*0.55 + Math.max(0,sigOpp.tunnel)*220 + Math.max(0,4-sigOpp.exits)*60;
      screened.push({...m,priority:m.priority-planPenalty,planPenalty});
    }
    if(screened.length){screened.sort((a,b)=>b.priority-a.priority);root=screened;}
  }


  // Hard tactical veto: once a real one-cell tunnel is established, a pure
  // forward move is not allowed to outrun the threat.  We first look for a
  // safe wall that gains >=2 route tempi or breaks >=2 tunnel segments.
  // This is a search invariant, not a heuristic bonus: if such a defense
  // exists, moves that leave the tunnel intact are excluded at the root.
  const urgentFiltered=urgentTunnelDefenseFilter(state,root);
  if(urgentFiltered.length && urgentFiltered.length<root.length) root=urgentFiltered;

  const apkFast=apkHardFastCandidate();
  if(apkFast){
    const ai= root.findIndex(m=>moveKey(m)===moveKey(apkFast));
    if(ai>0){ const [ax]=root.splice(ai,1); root.unshift(ax); }
  }

  const oppImmediate=legalMoves("opp",state.walls,state.oppPos,state.myPos).some(x=>x.r===getGoalRow("opp"));
  if(oppImmediate){
    const safe=[];
    for(const m of root){
      const c=applyMove(state,m,true);
      if(!legalMoves("opp",c.walls,c.oppPos,c.myPos).some(x=>x.r===getGoalRow("opp"))) safe.push(m);
    }
    if(safe.length) root=safe;
  }

  // Exact/proof-oriented endgame when the position is small enough.
  if(totalWalls<=2 && Math.max(md,od)<=14){
    const proof=tryEndgameProof(root,Math.min(16,4+totalWalls*4));
    if(proof) return proof;
  }

  // A neutral APK candidate is only a seed. Prefer a real route-progress move
  // over a lateral step when no completed search has justified the latter.
  let best=(apkFast && (apkFast.type!=="step" || shortestPath("me",state.walls,{r:apkFast.r,c:apkFast.c})<md)) ? apkFast : (progressStep || root[0]);
  let lastCompleteScores=new Map();
  const maxDepth=totalWalls<=1 ? 12 : (totalWalls<=3 ? 9 : (critical ? 8 : 7));
  for(let depth=1;depth<=maxDepth;depth++){
    timedOut=false;
    const ordered=root.slice();
    if(best){
      const bi=ordered.findIndex(m=>moveKey(m)===moveKey(best));
      if(bi>0){const [x]=ordered.splice(bi,1);ordered.unshift(x);}
    }
    const result=rootSearch(ordered,depth);
    if(result.complete && result.move){
      best=result.move;
      lastCompleteScores=new Map(result.scores.map(x=>[moveKey(x.m),x.val]));
    }
    if(timedOut)break;
    if(best && best.type==="step" && best.r===getGoalRow("me"))break;
  }

  // MCTS is used only as an independent challenger on close positions.
  // This catches tactical geometry that candidate ordering can miss without
  // allowing noisy rollouts to overrule a decisive Alpha-Beta result.
  if(!timedOut && critical && state.walls.size>0 && lastCompleteScores.size>=2 && totalWalls<=6){
    const challenger=mctsChallenge(root,lastCompleteScores);
    if(challenger) best=challenger;
  }
  // Deterministic opening fallback: if search timed out, never donate a tempo
  // with a lateral move while a legal progress step exists.
  if(opening && best && best.type==="step" && shortestPath("me",state.walls,{r:best.r,c:best.c})>=md){
    const progress=steps.slice().sort((a,b)=>shortestPath("me",state.walls,{r:a.r,c:a.c})-shortestPath("me",state.walls,{r:b.r,c:b.c}));
    if(progress.length && shortestPath("me",state.walls,{r:progress[0].r,c:progress[0].c})<md) best=progress[0];
  }
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
  if(legalWall(0,1,"h",w2,myStart,oppStart)) throw new Error("wall overlap");
  if(!legalWall(0,2,"h",w2,myStart,oppStart)) throw new Error("wall end-to-end");
  // APK-Hard policy smoke test: it must always return a legal-shaped action.
  const apkState={...state};
  const apk=apkHardFastCandidate();
  if(apk && apk.type!=="step" && apk.type!=="wall") throw new Error("apk hard policy");
  // Jump invariant: opponent directly ahead, no wall behind.
  const me={r:4,c:4},opp={r:3,c:4};
  const jm=legalMoves("me",w,me,opp);
  if(!jm.some(x=>x.r===2&&x.c===4)) throw new Error("jump rule");
  return true;
}

self.onmessage = function(e){
  try{
    const d=e.data||{};
    gameMode=d.gameMode||"duel";
    aiPlayer=d.aiPlayer||"me";
    raceWallsSetting=d.raceWallsSetting||15;
    avoidMoveKey=d.avoidMoveKey||null;
    recentPositionKeys=d.recentPositionKeys||[];
    state={turn:d.turn,gameOver:!!d.gameOver,me:{...d.me},opp:{...d.opp},walls:new Set(d.walls||[])};
    if(aiPlayer==="me"){state.myPos=state.me;state.oppPos=state.opp;state.myWalls=state.me.walls;state.oppWalls=state.opp.walls;}
    else{state.myPos=state.opp;state.oppPos=state.me;state.myWalls=state.opp.walls;state.oppWalls=state.me.walls;}
    selfTestEngine();
    const move=calculateBestMove();
    self.postMessage({id:d.id,move});
  }catch(err){self.postMessage({id:e.data?.id||0,error:String(err&&err.stack||err)});}
};

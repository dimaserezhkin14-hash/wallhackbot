"use strict";
const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
let state, history = [], engineMove = null, selectedWall = null, soundOn = true, theme = "dark";
let gameMode = "duel";
let firstTurnSetting = "me";
let myColorSetting = "blue";
let raceSideSetting = "right";
let raceWallsSetting = 15;
let audio = null, dragging = false, dragOrient = null, ghostEl = null, ghostAnchor = null;

/* =======================
   QUORIDOR ENGINE CORE
   - exact legal-move/wall rules
   - iterative deepening
   - alpha-beta + TT
   - strong move ordering
   - time budget + graceful fallback
   ======================= */
const ENGINE = {
  // Browser/mobile budget: deep iterative search without blocking the UI.
  timeMs: 1350,
  maxDepth: 12,
  rootWallLimit: 64,
  nodeWallLimit: 24,
  ttMax: 400000,
  tacticalReplies: 24
};
let engineStats = {nodes:0, depth:0, elapsed:0, ttHits:0, cutoffs:0};
let engineDeadline = 0;
let engineAborted = false;
const TT = new Map();

function getBoardRows(){ return gameMode === "race" ? 13 : 9; }
function getBoardCols(){ return 9; }

function getGoalRow(player){
  if(gameMode === "race") return 0;
  return player === "me" ? 0 : 8;
}

function getDefaultWalls(){
  return gameMode === "duel" ? 10 : raceWallsSetting;
}

function initialState(){
  const rows = getBoardRows();
  const initWalls = getDefaultWalls();
  let mePos, oppPos;
  if(gameMode === "race"){
    const myCol = raceSideSetting === "right" ? 6 : 2;
    const oppCol = raceSideSetting === "right" ? 2 : 6;
    mePos = {r:rows-1, c:myCol, walls:initWalls};
    oppPos = {r:rows-1, c:oppCol, walls:initWalls};
  } else {
    mePos = {r:8, c:4, walls:initWalls};
    oppPos = {r:0, c:4, walls:initWalls};
  }
  return {turn:firstTurnSetting, gameOver:false, me:mePos, opp:oppPos, walls:new Set()};
}

function wallKey(r,c,o){ return r+","+c+","+o; }

function cloneState(){
  return {
    turn:state.turn, gameOver:state.gameOver,
    me:{...state.me}, opp:{...state.opp}, walls:new Set(state.walls)
  };
}

function save(){
  history.push(cloneState());
  if(history.length > 100) history.shift();
}

function restore(s){
  state = {turn:s.turn, gameOver:s.gameOver, me:{...s.me}, opp:{...s.opp}, walls:new Set(s.walls)};
  engineMove = null; selectedWall = null;
  render(true); computeEngine();
}

function inBoard(r,c){
  return r >= 0 && r < getBoardRows() && c >= 0 && c < 9;
}

/* A wall at (r,c,h) blocks the horizontal edge between rows r/r+1
   across columns c/c+1. A vertical wall blocks the vertical edge
   between columns c/c+1 across rows r/r+1. */
function edgeBlocked(a,b,walls=state.walls){
  const dr=b.r-a.r, dc=b.c-a.c;
  if(dr === 0 && Math.abs(dc) === 1){
    const c=Math.min(a.c,b.c);
    return walls.has(wallKey(a.r,c,"v")) ||
           walls.has(wallKey(a.r-1,c,"v"));
  }
  if(dc === 0 && Math.abs(dr) === 1){
    const r=Math.min(a.r,b.r);
    return walls.has(wallKey(r,a.c,"h")) ||
           walls.has(wallKey(r,a.c-1,"h"));
  }
  return true;
}

function rawNeighbors(pos,walls=state.walls){
  const out=[];
  for(const [dr,dc] of dirs){
    const nr=pos.r+dr,nc=pos.c+dc;
    if(inBoard(nr,nc)){
      const n={r:nr,c:nc};
      if(!edgeBlocked(pos,n,walls)) out.push(n);
    }
  }
  return out;
}

/* Quoridor pawn movement including straight jump and diagonal
   side-steps when a jump is blocked. */
function legalMoves(player,walls=state.walls,pos=null,otherPos=null){
  const me=pos || state[player];
  const other=otherPos || state[player==="me"?"opp":"me"];
  const out=[];
  for(const n of rawNeighbors(me,walls)){
    if(n.r===other.r && n.c===other.c){
      const dr=n.r-me.r, dc=n.c-me.c;
      const jump={r:other.r+dr,c:other.c+dc};
      if(inBoard(jump.r,jump.c) && !edgeBlocked(other,jump,walls)){
        out.push(jump);
      }else{
        const sides=[
          {r:other.r+dc,c:other.c-dr},
          {r:other.r-dc,c:other.c+dr}
        ];
        for(const x of sides){
          if(inBoard(x.r,x.c) && !edgeBlocked(other,x,walls)) out.push(x);
        }
      }
    }else{
      out.push(n);
    }
  }
  return out;
}

/* Reusable BFS scratch. Board max is 13*9=117 cells. */
const qArr=new Int16Array(128);
const distArr=new Int8Array(128);

function shortestPath(player,walls=state.walls,start=null){
  const s=start || state[player], goalRow=getGoalRow(player);
  const rows=getBoardRows(), total=rows*9;
  if(s.r===goalRow) return 0;
  distArr.fill(-1,0,total);
  let head=0,tail=0;
  const startIdx=s.r*9+s.c;
  distArr[startIdx]=0;
  qArr[tail++]=startIdx;
  while(head<tail){
    const idx=qArr[head++];
    const r=(idx/9)|0,c=idx%9,d=distArr[idx];
    if(r===goalRow) return d;
    for(const [dr,dc] of dirs){
      const nr=r+dr,nc=c+dc;
      if(nr<0||nr>=rows||nc<0||nc>=9) continue;
      const ni=nr*9+nc;
      if(distArr[ni]!==-1) continue;
      let blocked=false;
      if(dr===0){
        const mc=Math.min(c,nc);
        blocked=walls.has(wallKey(r,mc,"v"))||walls.has(wallKey(r-1,mc,"v"));
      }else{
        const mr=Math.min(r,nr);
        blocked=walls.has(wallKey(mr,c,"h"))||walls.has(wallKey(mr,c-1,"h"));
      }
      if(!blocked){
        distArr[ni]=d+1;
        qArr[tail++]=ni;
      }
    }
  }
  return Infinity;
}

function getOptimalPath(player,walls=state.walls,start=null){
  const s=start || state[player], goalRow=getGoalRow(player);
  const rows=getBoardRows(), total=rows*9;
  if(s.r===goalRow) return [];
  distArr.fill(-1,0,total);
  const parent=new Int16Array(total).fill(-1);
  let head=0,tail=0,target=-1;
  const startIdx=s.r*9+s.c;
  distArr[startIdx]=0;qArr[tail++]=startIdx;
  while(head<tail){
    const idx=qArr[head++],r=(idx/9)|0,c=idx%9,d=distArr[idx];
    if(r===goalRow){target=idx;break;}
    for(const [dr,dc] of dirs){
      const nr=r+dr,nc=c+dc;
      if(nr<0||nr>=rows||nc<0||nc>=9) continue;
      const ni=nr*9+nc;
      if(distArr[ni]!==-1) continue;
      let blocked=false;
      if(dr===0){
        const mc=Math.min(c,nc);
        blocked=walls.has(wallKey(r,mc,"v"))||walls.has(wallKey(r-1,mc,"v"));
      }else{
        const mr=Math.min(r,nr);
        blocked=walls.has(wallKey(mr,c,"h"))||walls.has(wallKey(mr,c-1,"h"));
      }
      if(!blocked){distArr[ni]=d+1;parent[ni]=idx;qArr[tail++]=ni;}
    }
  }
  const path=[];
  if(target!==-1){
    let cur=target;
    while(cur!==startIdx&&cur!==-1){
      path.push({r:(cur/9)|0,c:cur%9});cur=parent[cur];
    }
    path.reverse();
  }
  return path;
}

/* Exact wall legality, including overlap/crossing and the
   mandatory path-existence rule for both players. */
function legalWall(r,c,o,walls=state.walls){
  const maxR=getBoardRows()-2;
  if((o!=="h"&&o!=="v")||r<0||r>maxR||c<0||c>7) return false;
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
  return shortestPath("me",copy)!==Infinity &&
         shortestPath("opp",copy)!==Infinity;
}

function wallGeometryLegal(r,c,o,walls=state.walls){
  const maxR=getBoardRows()-2;
  if((o!=="h"&&o!=="v")||r<0||r>maxR||c<0||c>7) return false;
  const k=wallKey(r,c,o);
  if(walls.has(k)) return false;
  if(o==="h"){
    return !walls.has(wallKey(r,c,"v")) &&
           !walls.has(wallKey(r,c-1,"h")) &&
           !walls.has(wallKey(r,c+1,"h"));
  }
  return !walls.has(wallKey(r,c,"h")) &&
         !walls.has(wallKey(r-1,c,"v")) &&
         !walls.has(wallKey(r+1,c,"v"));
}

function allValidWalls(walls=state.walls){
  const out=[],maxR=getBoardRows()-2;
  for(let r=0;r<=maxR;r++) for(let c=0;c<8;c++){
    if(wallGeometryLegal(r,c,"h",walls) && legalWall(r,c,"h",walls)) out.push({r,c,o:"h"});
    if(wallGeometryLegal(r,c,"v",walls) && legalWall(r,c,"v",walls)) out.push({r,c,o:"v"});
  }
  return out;
}

/* Cheap deterministic two-lane Zobrist-style hash. It is only a
   transposition-table accelerator; evaluation remains exact. */
function mix32(x){
  x|=0;x=Math.imul(x^(x>>>16),0x7feb352d);
  x=Math.imul(x^(x>>>15),0x846ca68b);
  return (x^(x>>>16))>>>0;
}
function wallHashPair(r,c,o){
  const code=((r+1)*31+(c+1)*7+(o==="h"?1:2))|0;
  return [mix32(code^0x9e3779b9),mix32(code^0x85ebca6b)];
}
function initialWallHash(walls){
  let h1=0,h2=0;
  for(const k of walls){
    const [r,c,o]=k.split(",");
    const [a,b]=wallHashPair(+r,+c,o);
    h1^=a;h2^=b;
  }
  return [h1>>>0,h2>>>0];
}
function stateTTKey(h1,h2,myPos,oppPos,myWalls,oppWalls,isMax){
  return h1+"|"+h2+"|"+myPos.r+","+myPos.c+"|"+oppPos.r+","+oppPos.c+
         "|"+myWalls+"|"+oppWalls+"|"+(isMax?1:0)+"|"+(gameMode==="race"?1:0);
}
function ttTrim(){
  if(TT.size<=ENGINE.ttMax) return;
  const drop=Math.floor(ENGINE.ttMax*0.2);
  let i=0;
  for(const k of TT.keys()){TT.delete(k);if(++i>=drop)break;}
}

/* Multi-factor evaluation. Distance remains dominant, but the engine
   also understands wall economy, tempo, path flexibility and traps. */
function evaluateStateFull(player,walls,myPos,oppPos,myWalls,oppWalls){
  const myGoal=getGoalRow(player);
  const oppPlayer=player==="me"?"opp":"me";
  const oppGoal=getGoalRow(oppPlayer);
  if(myPos.r===myGoal) return 100000000;
  if(oppPos.r===oppGoal) return -100000000;

  const myDist=shortestPath(player,walls,myPos);
  const oppDist=shortestPath(oppPlayer,walls,oppPos);
  if(!isFinite(myDist)) return -100000000;
  if(!isFinite(oppDist)) return 100000000;

  let score=(oppDist-myDist)*1200;
  score+=(myWalls-oppWalls)*55;

  const myMoves=legalMoves(player,walls,myPos,oppPos).length;
  const oppMoves=legalMoves(oppPlayer,walls,oppPos,myPos).length;
  score+=(myMoves-oppMoves)*18;

  const myPath=getOptimalPath(player,walls,myPos);
  const oppPath=getOptimalPath(oppPlayer,walls,oppPos);
  const myNext=myPath.length?myPath[0]:myPos;
  const oppNext=oppPath.length?oppPath[0]:oppPos;
  score+=(4-Math.abs(myNext.c-4))*5;
  score-=(4-Math.abs(oppNext.c-4))*5;

  /* In a race, wall economy matters more near the finish; in duel,
     keeping a central route is mildly useful but never dominates. */
  if(gameMode==="race"){
    score+=(myDist<=4?myWalls-oppWalls:0)*8;
  }else{
    const myCenter=4-Math.abs(myPos.c-4);
    const oppCenter=4-Math.abs(oppPos.c-4);
    score+=(myCenter-oppCenter)*6;
  }
  return score;
}

function moveKey(m){return m.type==="step"?"s:"+m.r+","+m.c:"w:"+m.r+","+m.c+","+m.o;}

function generateCandidates(turnPlayer,walls,myPos,oppPos,myWalls,oppWalls,limit=ENGINE.nodeWallLimit){
  const enemy=turnPlayer==="me"?"opp":"me";
  const pPos=turnPlayer==="me"?myPos:oppPos;
  const ePos=turnPlayer==="me"?oppPos:myPos;
  const pWalls=turnPlayer==="me"?myWalls:oppWalls;
  const curP=shortestPath(turnPlayer,walls,pPos);
  const curE=shortestPath(enemy,walls,ePos);
  const goal=getGoalRow(turnPlayer);
  const moves=[];

  for(const step of legalMoves(turnPlayer,walls,pPos,ePos)){
    const d=shortestPath(turnPlayer,walls,step);
    const priority=step.r===goal?1e9:(curP-d)*10000;
    moves.push({type:"step",r:step.r,c:step.c,priority});
  }
  if(moves.some(m=>m.priority>=1e9)) return moves.filter(m=>m.priority>=1e9);

  if(pWalls<=0) return moves.sort((a,b)=>b.priority-a.priority);

  const path=getOptimalPath(enemy,walls,ePos);
  const ownPath=getOptimalPath(turnPlayer,walls,pPos);
  const pathSet=new Set(path.slice(0,Math.min(path.length,12)).map(p=>p.r+","+p.c));
  const ownSet=new Set(ownPath.slice(0,Math.min(ownPath.length,12)).map(p=>p.r+","+p.c));

  /* First rank walls with cheap geometry/path proximity. Only the most
     promising candidates pay the expensive two-BFS legality test. */
  const geometric=[];
  const maxR=getBoardRows()-2;
  for(let r=0;r<=maxR;r++) for(let c=0;c<8;c++) for(const o of ["h","v"]){
    if(!wallGeometryLegal(r,c,o,walls)) continue;
    let quick=0;
    const nearEnemy=pathSet.has(r+","+c) ||
      pathSet.has((r+1)+","+c) || pathSet.has(r+","+(c+1));
    const nearOwn=ownSet.has(r+","+c) ||
      ownSet.has((r+1)+","+c) || ownSet.has(r+","+(c+1));
    if(nearEnemy) quick+=260;
    if(nearOwn) quick-=220;
    quick-=Math.abs(c-3.5)*2;
    geometric.push({r,c,o,quick});
  }
  geometric.sort((a,b)=>b.quick-a.quick);

  const scan=Math.min(geometric.length,Math.max(limit,20));
  const scored=[];
  for(let gi=0;gi<scan;gi++){
    const w=geometric[gi];
    const copy=new Set(walls);copy.add(wallKey(w.r,w.c,w.o));
    const newE=shortestPath(enemy,copy,ePos);
    const newP=shortestPath(turnPlayer,copy,pPos);
    if(!isFinite(newE)||!isFinite(newP)) continue;
    const eGain=newE-curE,pLoss=newP-curP;

    let priority=eGain*950-pLoss*1050+w.quick;
    if(eGain===0&&pLoss===0) priority-=25;
    if(eGain>=2) priority+=250;
    if(eGain>=3) priority+=350;
    if(newE<=2) priority+=80;
    if(newP===curP) priority+=35;
    scored.push({type:"wall",r:w.r,c:w.c,o:w.o,priority});
  }

  scored.sort((a,b)=>b.priority-a.priority);
  const take=Math.min(limit,scored.length);
  for(let i=0;i<take;i++) moves.push(scored[i]);
  moves.sort((a,b)=>b.priority-a.priority);
  return moves;
}

function applyMoveForSearch(m,walls,myPos,oppPos,myWalls,oppWalls,h1,h2,turnPlayer){
  const nw=new Set(walls);
  let nMy={...myPos},nOpp={...oppPos},nMW=myWalls,nOW=oppWalls,nh1=h1,nh2=h2;
  if(m.type==="step"){
    if(turnPlayer==="me") nMy={r:m.r,c:m.c};
    else nOpp={r:m.r,c:m.c};
  }else{
    nw.add(wallKey(m.r,m.c,m.o));
    const [a,b]=wallHashPair(m.r,m.c,m.o);nh1=(h1^a)>>>0;nh2=(h2^b)>>>0;
    if(turnPlayer==="me") nMW--; else nOW--;
  }
  return {walls:nw,myPos:nMy,oppPos:nOpp,myWalls:nMW,oppWalls:nOW,h1:nh1,h2:nh2};
}

function minimax(depth,isMax,walls,myPos,oppPos,myWalls,oppWalls,h1,h2,alpha,beta){
  if((++engineStats.nodes&1023)===0 && performance.now()>=engineDeadline){
    engineAborted=true;return 0;
  }

  const myGoal=getGoalRow("me"),oppGoal=getGoalRow("opp");
  if(myPos.r===myGoal) return 100000000-depth;
  if(oppPos.r===oppGoal) return -100000000+depth;
  if(depth===0) return evaluateStateFull("me",walls,myPos,oppPos,myWalls,oppWalls);

  const key=stateTTKey(h1,h2,myPos,oppPos,myWalls,oppWalls,isMax);
  const cached=TT.get(key);
  if(cached && cached.depth>=depth){
    engineStats.ttHits++;
    if(cached.flag==="EXACT") return cached.value;
    if(cached.flag==="LOWER") alpha=Math.max(alpha,cached.value);
    else if(cached.flag==="UPPER") beta=Math.min(beta,cached.value);
    if(alpha>=beta) return cached.value;
  }

  const alpha0=alpha,beta0=beta;
  const turn=isMax?"me":"opp";
  const limit=depth>=6?18:depth>=4?22:depth===3?28:32;
  const candidates=generateCandidates(turn,walls,myPos,oppPos,myWalls,oppWalls,limit);
  if(!candidates.length) return evaluateStateFull("me",walls,myPos,oppPos,myWalls,oppWalls);

  let best=isMax?-Infinity:Infinity;
  let bestMove=null;
  for(const m of candidates){
    const n=applyMoveForSearch(m,walls,myPos,oppPos,myWalls,oppWalls,h1,h2,turn);
    const val=minimax(depth-1,!isMax,n.walls,n.myPos,n.oppPos,n.myWalls,n.oppWalls,n.h1,n.h2,alpha,beta);
    if(engineAborted) return 0;
    if(isMax){
      if(val>best){best=val;bestMove=m;}
      alpha=Math.max(alpha,val);
    }else{
      if(val<best){best=val;bestMove=m;}
      beta=Math.min(beta,val);
    }
    if(beta<=alpha){engineStats.cutoffs++;break;}
  }

  let flag="EXACT";
  if(best<=alpha0) flag="UPPER";
  else if(best>=beta0) flag="LOWER";
  TT.set(key,{depth,value:best,flag,bestMove});
  if(TT.size>ENGINE.ttMax) ttTrim();
  return best;
}



/* ============================================================
   RACE-THREAT SAFETY LAYER
   Explicitly checks whether the opponent can win a straight race
   before we allow ordinary path-progress heuristics to choose.
   ============================================================ */
function isCriticalRacePosition(player, walls, myPos, oppPos, myWalls, oppWalls){
  const enemy = player === "me" ? "opp" : "me";
  const pPos = player === "me" ? myPos : oppPos;
  const ePos = player === "me" ? oppPos : myPos;
  const pDist = shortestPath(player, walls, pPos);
  const eDist = shortestPath(enemy, walls, ePos);
  if(!isFinite(pDist) || !isFinite(eDist)) return false;

  // If the enemy is already ahead/tied, inspect its legal next steps.
  const enemySteps = legalMoves(enemy, walls, ePos, pPos);
  const bestEnemyNext = enemySteps.reduce((best,s)=>{
    const d = shortestPath(enemy, walls, s);
    return Math.min(best,d);
  }, eDist);

  // "Critical" means the opponent can keep advancing and is not behind
  // by more than one tempo.
  return eDist <= pDist + 1 && bestEnemyNext < eDist;
}

function defensiveWallCandidates(player, walls, myPos, oppPos, myWalls, oppWalls){
  const out = [];
  if(myWalls <= 0) return out;

  const enemy = player === "me" ? "opp" : "me";
  const pPos = player === "me" ? myPos : oppPos;
  const ePos = player === "me" ? oppPos : myPos;
  const pDist = shortestPath(player, walls, pPos);
  const eDist = shortestPath(enemy, walls, ePos);
  if(!isFinite(pDist) || !isFinite(eDist)) return out;

  const enemyPath = getOptimalPath(enemy, walls, ePos);
  const pathSet = new Set(enemyPath.map(x=>x.r+","+x.c));

  // In a critical race, scan every geometrically legal wall. The board has
  // only 128 wall anchors, so this is bounded and avoids the old 12-wall trap.
  for(const w of allValidWalls(walls)){
    const copy = new Set(walls);
    copy.add(wallKey(w.r,w.c,w.o));
    const ndE = shortestPath(enemy, copy, ePos);
    const ndP = shortestPath(player, copy, pPos);
    if(!isFinite(ndE) || !isFinite(ndP)) continue;

    const block = ndE - eDist;
    const selfCost = ndP - pDist;
    if(block <= 0 || selfCost > 1) continue;

    const nearPath =
      pathSet.has(w.r+","+w.c) ||
      pathSet.has((w.r+1)+","+w.c) ||
      pathSet.has((w.r-1)+","+w.c) ||
      pathSet.has(w.r+","+(w.c+1));

    // Prefer walls that actually slow the opponent, with a strong preference
    // for preserving our own route.
    const priority =
      block * 2000 -
      selfCost * 1200 +
      (nearPath ? 500 : 0) +
      (ndE <= 2 ? 600 : 0);

    out.push({type:"wall",r:w.r,c:w.c,o:w.o,priority});
  }

  out.sort((a,b)=>b.priority-a.priority);
  return out;
}

function criticalRaceOverride(player){
  if(player !== "me") return null;
  // The empty opening is not a tactical emergency: both players have the
  // same race distance and the center tempo is more valuable than a
  // speculative first wall. Defensive walls become eligible after the
  // opening position has changed.
  if(state && state.walls && state.walls.size===0) return null;
  if(!isCriticalRacePosition("me", state.walls, state.me, state.opp, state.me.walls, state.opp.walls)) return null;
  const defs = defensiveWallCandidates("me", state.walls, state.me, state.opp, state.me.walls, state.opp.walls);
  if(!defs.length) return null;
  defs.sort((a,b)=>b.priority-a.priority);
  return defs[0];
}
// CRITICAL_RACE_OVERRIDE: used only when the opponent's race is immediately dangerous.


function moveLeadsToImmediateLoss(m, walls, myPos, oppPos, myWalls, oppWalls){
  const n=applyMoveForSearch(m,walls,myPos,oppPos,myWalls,oppWalls,0,0,"me");
  const enemySteps=legalMoves("opp",n.walls,n.oppPos,n.myPos);
  const enemyGoal=getGoalRow("opp");
  for(const st of enemySteps){
    if(st.r===enemyGoal) return true;
  }
  return false;
}

function rootTacticalScore(m){
  const n=applyMoveForSearch(m,state.walls,state.me,state.opp,state.me.walls,state.opp.walls,0,0,"me");
  const myD=shortestPath("me",n.walls,n.myPos);
  const opD=shortestPath("opp",n.walls,n.oppPos);
  if(n.myPos.r===getGoalRow("me")) return 1e12;
  if(n.oppPos.r===getGoalRow("opp")) return -1e12;
  let score=(opD-myD)*1600;
  if(moveLeadsToImmediateLoss(m,state.walls,state.me,state.opp,state.me.walls,state.opp.walls)) score-=900000;
  // Avoid wasting the opening tempo on a wall unless it creates a real threat.
  if(state.walls.size===0 && m.type==="wall"){
    const baseO=shortestPath("opp",state.walls,state.opp);
    const gain=opD-baseO;
    const ownCost=myD-shortestPath("me",state.walls,state.me);
    if(gain<2 || ownCost>0) score-=25000;
    else score+=gain*500;
  }
  return score;
}

function orderRootMoves(root){
  const scored=root.map(m=>({m,s:rootTacticalScore(m)}));
  scored.sort((a,b)=>b.s-a.s);
  return scored.map(x=>x.m);
}

function calculateBestMoveAlphaBeta(player){
  const forcedDefense = criticalRaceOverride(player);
  if(forcedDefense) return forcedDefense;
  const myPos={...state.me},oppPos={...state.opp};
  const myWalls=state.me.walls,oppWalls=state.opp.walls;
  const [h1,h2]=initialWallHash(state.walls);
  let root=generateCandidates("me",state.walls,myPos,oppPos,myWalls,oppWalls,ENGINE.rootWallLimit);
  if(!root.length) return null;
  // At the empty opening, a wall must earn its tempo; otherwise keep the center/race tempo.
  if(state.walls.size===0){
    const steps=root.filter(m=>m.type==="step");
    const meaningfulWalls=root.filter(m=>m.type==="wall" && rootTacticalScore(m)>1000);
    if(steps.length && meaningfulWalls.length===0) root=steps;
  }
  root=orderRootMoves(root);
  const immediate=root.find(m=>m.type==="step"&&m.r===getGoalRow("me"));
  if(immediate) return immediate;

  const start=performance.now();
  engineDeadline=start+ENGINE.timeMs;
  engineAborted=false;
  engineStats={nodes:0,depth:0,elapsed:0,ttHits:0,cutoffs:0};

  let best=root[0],bestScore=-Infinity;
  for(let depth=1;depth<=ENGINE.maxDepth;depth++){
    if(performance.now()>=engineDeadline) break;
    let iterationBest=null,iterationScore=-Infinity;
    const ordered=best?[best,...root.filter(m=>moveKey(m)!==moveKey(best))]:root;
    for(const m of ordered){
      if(performance.now()>=engineDeadline) break;
      const n=applyMoveForSearch(m,state.walls,myPos,oppPos,myWalls,oppWalls,h1,h2,"me");
      const score=minimax(depth-1,false,n.walls,n.myPos,n.oppPos,n.myWalls,n.oppWalls,n.h1,n.h2,-Infinity,Infinity);
      if(engineAborted) break;
      if(score>iterationScore){iterationScore=score;iterationBest=m;}
    }
    if(engineAborted||!iterationBest) break;
    best=iterationBest;bestScore=iterationScore;engineStats.depth=depth;
  }
  engineStats.elapsed=performance.now()-start;
  return best;
}


/* ============================================================
   MONSTER HYBRID LAYER
   Inspired by the supplied MIT-licensed Quoridor MCTS project.
   It keeps the current app's exact rules as the source of truth and
   combines tactical alpha-beta with deterministic MCTS/UCT and a small
   exact endgame search. No random opening override is used.
   ============================================================ */
const MONSTER = { mctsMs: 100, maxChildren: 40, endgameWalls: 3, exactDepth: 34 };

function monsterMoveList(player, walls, myPos, oppPos, myWalls, oppWalls, limit=28){
  const base=generateCandidates(player,walls,myPos,oppPos,myWalls,oppWalls,Math.max(limit,20));
  // Always include every pawn move: there are at most four and they are cheap.
  const pawn=[];
  for(const p of legalMoves(player,walls,player==='me'?myPos:oppPos,player==='me'?oppPos:myPos))
    pawn.push({type:'step',r:p.r,c:p.c,priority:100000});
  const map=new Map();
  for(const m of pawn.concat(base)){ const k=moveKey(m); if(!map.has(k)||map.get(k).priority<m.priority) map.set(k,m); }
  return [...map.values()].sort((a,b)=>b.priority-a.priority).slice(0,limit);
}

function monsterStateAfter(m, walls, myPos, oppPos, myWalls, oppWalls, turn){
  return applyMoveForSearch(m,walls,myPos,oppPos,myWalls,oppWalls,initialWallHash(walls)[0],initialWallHash(walls)[1],turn);
}

function monsterHeuristic(walls,myPos,oppPos,myWalls,oppWalls){
  return evaluateStateFull('me',walls,myPos,oppPos,myWalls,oppWalls);
}

function monsterMCTS(root, rootMoves, deadline){
  // Deterministic PUCT arbiter.  There is deliberately no random rollout:
  // each leaf is evaluated from the same exact path/race evaluator used by
  // alpha-beta.  This keeps MCTS from selecting tactical nonsense.
  const rawP=rootMoves.map(m=>Math.exp(Math.max(-10,Math.min(10,rootTacticalScore(m)/1200))));
  const ps=rawP.reduce((a,b)=>a+b,0)||1;
  const children=rootMoves.map((m,i)=>({move:m,n:0,w:0,p:rawP[i]/ps}));
  let total=0;
  const cp=1.45;
  while(performance.now()<deadline){
    total++;
    let best=null,bestU=-Infinity;
    for(const ch of children){
      const q=ch.n ? ch.w/ch.n : 0;
      const u=cp*ch.p*Math.sqrt(total)/(1+ch.n);
      const score=q+u;
      if(score>bestU){bestU=score;best=ch;}
    }
    const n1=monsterStateAfter(best.move,root.walls,root.myPos,root.oppPos,root.myWalls,root.oppWalls,'me');
    let value;
    if(!n1){ value=-1; }
    else if(n1.myPos.r===getGoalRow('me')) value=1;
    else if(n1.oppPos.r===getGoalRow('opp')) value=-1;
    else {
      // Adversarial two-ply continuation, followed by a stable leaf value.
      let worst=Infinity;
      const replies=monsterMoveList('opp',n1.walls,n1.myPos,n1.oppPos,n1.myWalls,n1.oppWalls,Math.min(18,ENGINE.tacticalReplies));
      for(const r of replies){
        const n2=monsterStateAfter(r,n1.walls,n1.myPos,n1.oppPos,n1.myWalls,n1.oppWalls,'opp');
        if(!n2) continue;
        if(n2.oppPos.r===getGoalRow('opp')){ worst=-100000000; break; }
        const myReplies=monsterMoveList('me',n2.walls,n2.myPos,n2.oppPos,n2.myWalls,n2.oppWalls,10);
        let bestReply=-Infinity;
        for(const mr of myReplies){
          const n3=monsterStateAfter(mr,n2.walls,n2.myPos,n2.oppPos,n2.myWalls,n2.oppWalls,'me');
          if(!n3) continue;
          const v=monsterHeuristic(n3.walls,n3.myPos,n3.oppPos,n3.myWalls,n3.oppWalls);
          bestReply=Math.max(bestReply,v);
        }
        worst=Math.min(worst,bestReply);
      }
      value=Math.tanh(worst/2600);
    }
    best.n++;
    best.w+=value;
  }
  children.sort((a,b)=>b.n-a.n || (b.w/b.n)-(a.w/a.n));
  return children[0]?.move||null;
}

function monsterExactEndgame(depth, maximizing, walls,myPos,oppPos,myWalls,oppWalls,alpha,beta,turn,rootPlayer,seen){
  if(myPos.r===getGoalRow('me')) return rootPlayer==='me'?1000000-depth:-1000000+depth;
  if(oppPos.r===getGoalRow('opp')) return rootPlayer==='opp'?1000000-depth:-1000000+depth;
  if(depth<=0) return evaluateStateFull('me',walls,myPos,oppPos,myWalls,oppWalls);
  const key=initialWallHash(walls).join(':')+'|'+myPos.r+','+myPos.c+'|'+oppPos.r+','+oppPos.c+'|'+myWalls+','+oppWalls+'|'+turn+'|'+depth;
  if(seen.has(key)) return seen.get(key);
  const moves=monsterMoveList(turn,walls,myPos,oppPos,myWalls,oppWalls,12);
  if(!moves.length) return evaluateStateFull('me',walls,myPos,oppPos,myWalls,oppWalls);
  let best=maximizing?-Infinity:Infinity;
  for(const m of moves){
    const n=monsterStateAfter(m,walls,myPos,oppPos,myWalls,oppWalls,turn); if(!n) continue;
    const v=monsterExactEndgame(depth-1,!maximizing,n.walls,n.myPos,n.oppPos,n.myWalls,n.oppWalls,alpha,beta,turn==='me'?'opp':'me',rootPlayer,seen);
    if(maximizing){best=Math.max(best,v);alpha=Math.max(alpha,v);}else{best=Math.min(best,v);beta=Math.min(beta,v);}
    if(beta<=alpha) break;
  }
  seen.set(key,best); return best;
}

function calculateBestMove(player){
  const start=performance.now();
  engineAborted=false;
  // Never allow a plain path-progress move to ignore an immediate race threat.
  const forcedDefense=criticalRaceOverride(player);
  if(forcedDefense) return forcedDefense;
  engineStats={nodes:0,depth:0,elapsed:0,ttHits:0,cutoffs:0};
  const totalWalls=state.me.walls+state.opp.walls;

  // Exact solver for genuinely small endgames. It is proof-first: if the
  // search is interrupted the result is discarded and normal search remains.
  if(totalWalls<=MONSTER.endgameWalls){
    const deadline=start+Math.min(1500,ENGINE.timeMs+500);
    let best=null,bestVal=-Infinity;
    const moves=monsterMoveList(player,state.walls,state.me,state.opp,state.me.walls,state.opp.walls,32);
    const seen=new Map();
    for(const m of moves){
      if(performance.now()>=deadline) break;
      const n=monsterStateAfter(m,state.walls,state.me,state.opp,state.me.walls,state.opp.walls,'me');
      if(!n) continue;
      const v=monsterExactEndgame(MONSTER.exactDepth,false,n.walls,n.myPos,n.oppPos,n.myWalls,n.oppWalls,-Infinity,Infinity,'opp','me',seen);
      if(v>bestVal){bestVal=v;best=m;}
    }
    if(best && performance.now()<deadline+30){engineStats.elapsed=performance.now()-start;engineStats.depth=MONSTER.exactDepth;return best;}
  }

  // First obtain a completed alpha-beta principal variation.
  const tactical=calculateBestMoveAlphaBeta(player);
  const root=orderRootMoves(monsterMoveList(player,state.walls,state.me,state.opp,state.me.walls,state.opp.walls,MONSTER.maxChildren));
  if(!root.length) return tactical;
  const ranked=root.slice().sort((a,b)=>rootTacticalScore(b)-rootTacticalScore(a));
  const topScore=ranked.length?rootTacticalScore(ranked[0]):-Infinity;
  const secondScore=ranked.length>1?rootTacticalScore(ranked[1]):-Infinity;
  const close=ranked.filter(m=>rootTacticalScore(m)>=topScore-350);
  // PUCT is an arbiter, never the authority: if there is a clear tactical
  // winner, keep alpha-beta's principal variation.
  if(close.length>1 && (topScore-secondScore)<=350){
    const remaining=ENGINE.timeMs-(performance.now()-start);
    const d=Math.min(MONSTER.mctsMs, Math.max(40, remaining-20));
    if(d>25){
      const m=monsterMCTS({walls:state.walls,myPos:state.me,oppPos:state.opp,myWalls:state.me.walls,oppWalls:state.opp.walls},close,performance.now()+d);
      if(m && rootTacticalScore(m)>=topScore-350) return m;
    }
  }
  return tactical || root[0];
}

/* Lightweight invariant tests. They run once in development builds and
   fail closed: a broken rule is reported instead of silently trusting it. */
function engineSelfTest(){
  const oldMode=gameMode,oldRace=raceWallsSetting;
  const failures=[];
  try{
    gameMode="duel";
    const s=initialState();
    state=s;
    const empty=new Set();
    if(shortestPath("me",empty,s.me)!==8) failures.push("duel me path");
    if(shortestPath("opp",empty,s.opp)!==8) failures.push("duel opp path");
    if(allValidWalls(empty).length!==128) failures.push("initial wall count");
    if(!legalWall(0,0,"h",empty)) failures.push("legal h");
    if(!legalWall(0,0,"v",empty)) failures.push("legal v");

    const w=new Set([wallKey(0,0,"h")]);
    if(legalWall(0,0,"v",w)) failures.push("crossing wall accepted");
    if(legalWall(0,1,"h",w)) failures.push("overlapping wall accepted");

    const a={r:4,c:4},b={r:4,c:5};
    if(!legalMoves("me",empty,a,b).some(p=>p.r===4&&p.c===6)) failures.push("jump");
    const block=new Set([wallKey(4,5,"v")]);
    const lm=legalMoves("me",block,a,b);
    if(!lm.some(p=>p.r===3&&p.c===5)&&!lm.some(p=>p.r===5&&p.c===5)) failures.push("side jump");

    gameMode="race";
    const rs=initialState();
    if(shortestPath("me",empty,rs.me)!==12) failures.push("race me path");
    if(shortestPath("opp",empty,rs.opp)!==12) failures.push("race opp path");
  }catch(e){ failures.push("exception:"+e.message); }
  finally{gameMode=oldMode;raceWallsSetting=oldRace;}
  if(failures.length) console.error("ENGINE SELF-TEST FAILED:",failures);
  else console.info("ENGINE SELF-TEST OK");
  return failures.length===0;
}

const ENGINE_SELF_TEST_OK = engineSelfTest();



onmessage = function(event){
  try {
    gameMode = event.data.gameMode || "duel";
    raceWallsSetting = event.data.raceWallsSetting || 15;
    state = event.data.state;
    const move = calculateBestMove("me");
    postMessage({id:event.data.id, move, stats:engineStats, ok:true});
  } catch (e) {
    postMessage({id:event.data.id, ok:false, error:String(e && e.stack || e)});
  }
};

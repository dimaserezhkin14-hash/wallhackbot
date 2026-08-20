importScripts("nn_value.js");
importScripts("nn_policy_value.js");

/* Native core bridge: C++/WASM is used as a fast independent tactical engine.
   The existing JS search remains the final verifier/fallback, so a browser that
   cannot load WASM still behaves normally. */
let WASM_CORE=null, WASM_READY=null;
try{
  WASM_READY=fetch("engine.wasm").then(r=>r.arrayBuffer()).then(b=>WebAssembly.instantiate(b,{})).then(x=>{WASM_CORE=x.instance;return WASM_CORE;}).catch(()=>null);
}catch(e){WASM_READY=Promise.resolve(null);}
function wasmEncodeState(s,mode){
  const ids=[];
  for(const k of s.walls){const a=k.split(","),r=+a[0],c=+a[1],o=a[2]==="h"?0:1; if(r>=0&&c>=0&&r<12&&c<8) ids.push(((r*8+c)<<1)|o);}
  const buf=new Uint8Array(9+ids.length*2);
  buf[0]=mode==="race"?13:9; buf[1]=mode==="race"?1:0;
  buf[2]=s.me.r;buf[3]=s.me.c;buf[4]=s.opp.r;buf[5]=s.opp.c;buf[6]=s.me.walls;buf[7]=s.opp.walls;buf[8]=ids.length;
  for(let i=0;i<ids.length;i++){buf[9+i*2]=ids[i]&255;buf[10+i*2]=ids[i]>>>8;}
  return buf;
}
function wasmMoveFromPacked(x){
  if(x===0xffffffff||x===undefined)return null;
  return (x>>>24)===0?{type:"step",r:(x>>>16)&255,c:(x>>>8)&255}:{type:"wall",r:(x>>>16)&255,c:(x>>>8)&255,o:(x&1)?"v":"h"};
}
async function wasmSearch(s,mode,nodes,depth){
  const core=await WASM_READY; if(!core)return null;
  const mem=core.exports.memory; const ptr=8*1024*1024; const input=wasmEncodeState(s,mode);
  if(ptr+input.length>mem.buffer.byteLength)return null;
  new Uint8Array(mem.buffer,ptr,input.length).set(input);
  try{return wasmMoveFromPacked(core.exports.search_best(ptr,input.length,nodes,depth));}catch(e){return null;}
}
const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
let ARENA_FAST=false;

/* WallHack PRO — search worker.
 * Runs the complete tactical alpha-beta engine off the UI thread so the board
 * updates immediately and the "thinking" animation stays alive on Android,
 * iPhone and desktop.
 */
let state, history = [], engineMove = null, selectedWall = null, soundOn = true, theme = "dark";
let gameMode = "duel";
let firstTurnSetting = "me";
let myColorSetting = "blue";
let raceSideSetting = "right";
let raceWallsSetting = 15;
let audio = null, dragging = false, dragOrient = null, ghostEl = null, ghostAnchor = null;

/*
 * WALLHACK GRANDMASTER CORE
 * -------------------------
 * This replaces the old "shortest-path + shallow alpha-beta" behavior.
 *
 * Design goals:
 *  1) Never throw away a tactically relevant wall before search.
 *  2) Treat a position that is already a forced race loss as a LOSS,
 *     rather than trying to rescue it with a cosmetic path score.
 *  3) Search both pawn moves and wall moves adversarially.
 *  4) Use quiescence/tactical extensions around races, forced blocks,
 *     corridor traps and endgames.
 *  5) Use a bounded exact solver when very few walls remain.
 *  6) Keep the browser responsive with iterative deepening and a hard
 *     deadline; the last completed iteration is always returned.
 *
 * This is still a deterministic browser engine, not a trained neural net.
 * The important upgrade here is correctness of the search/evaluation,
 * not pretending that a heuristic is "AI training".
 */
const ENGINE = {
  timeMs: 4500,
  maxDepth: 18,
  rootWallLimit: 72,
  nodeWallLimit: 30,
  ttMax: 500000,
  exactRemainingWalls: 2,
  tacticalDepth: 10,
  quiescenceDepth: 9,
  repetitionPenalty: 3200,
  oscillationPenalty: 9000,
  stabilityMargin: 1200
};

let engineStats = {nodes:0,depth:0,elapsed:0,ttHits:0,cutoffs:0,exact:0,tactical:0};
let lastNeuralValue = 0;
let engineDeadline = 0;
let engineAborted = false;
const TT = new Map();
const EXACT_TT = new Map();

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

/* Fast BFS scratch. Board max is 13*9 = 117 cells. */
const qArr=new Int16Array(128);
const distArr=new Int8Array(128);
const countArr=new Uint16Array(128);

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
    const idx=qArr[head++];
    const r=(idx/9)|0,c=idx%9,d=distArr[idx];
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

/* Count shortest routes, capped. This is deliberately not a heuristic
   replacement for path legality: it measures whether the pawn has one
   brittle corridor or several independent exits. */
function shortestPathInfo(player,walls,pos=null){
  const s=pos || state[player], goalRow=getGoalRow(player);
  const rows=getBoardRows(), total=rows*9;
  const start=s.r*9+s.c;
  distArr.fill(-1,0,total);
  countArr.fill(0,0,total);
  let head=0,tail=0;
  distArr[start]=0; countArr[start]=1; qArr[tail++]=start;
  let goalDist=Infinity, goalWays=0;
  while(head<tail){
    const idx=qArr[head++];
    const r=(idx/9)|0,c=idx%9,d=distArr[idx];
    if(d>goalDist) continue;
    if(r===goalRow){
      if(d<goalDist){goalDist=d;goalWays=countArr[idx];}
      else if(d===goalDist) goalWays=Math.min(255,goalWays+countArr[idx]);
      continue;
    }
    for(const [dr,dc] of dirs){
      const nr=r+dr,nc=c+dc;
      if(nr<0||nr>=rows||nc<0||nc>=9) continue;
      const ni=nr*9+nc;
      let blocked=false;
      if(dr===0){
        const mc=Math.min(c,nc);
        blocked=walls.has(wallKey(r,mc,"v"))||walls.has(wallKey(r-1,mc,"v"));
      }else{
        const mr=Math.min(r,nr);
        blocked=walls.has(wallKey(mr,c,"h"))||walls.has(wallKey(mr,c-1,"h"));
      }
      if(blocked) continue;
      if(distArr[ni]===-1){
        distArr[ni]=d+1;countArr[ni]=countArr[idx];qArr[tail++]=ni;
      }else if(distArr[ni]===d+1){
        countArr[ni]=Math.min(255,countArr[ni]+countArr[idx]);
      }
    }
  }
  return {dist:goalDist, ways:goalWays};
}

/* Exact wall legality, including overlap/crossing and mandatory path
   existence for both players. */
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

/* Zobrist-like deterministic hash for transposition tables. */
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

/* Candidate ranking is deliberately tactical. We NEVER use "centrality"
   as a reason to delete a wall that actually changes a shortest route. */
function wallImpact(player,walls,pos,otherPos,w){
  const copy=new Set(walls); copy.add(wallKey(w.r,w.c,w.o));
  const selfBefore=shortestPath(player,walls,pos);
  const oppPlayer=player==="me"?"opp":"me";
  const enemyBefore=shortestPath(oppPlayer,walls,otherPos);
  const selfAfter=shortestPath(player,copy,pos);
  const enemyAfter=shortestPath(oppPlayer,copy,otherPos);
  if(!isFinite(selfAfter)||!isFinite(enemyAfter)) return null;
  const selfInfo=shortestPathInfo(player,copy,pos);
  const enemyInfo=shortestPathInfo(oppPlayer,copy,otherPos);
  return {
    selfAfter, enemyAfter,
    selfDelta:selfAfter-selfBefore,
    enemyDelta:enemyAfter-enemyBefore,
    selfWays:selfInfo.ways,
    enemyWays:enemyInfo.ways
  };
}

function moveKey(m){
  return m.type==="step"?"s:"+m.r+","+m.c:"w:"+m.r+","+m.c+","+m.o;
}

function movePriority(m){
  return m.priority ?? 0;
}

/* Root stability: avoid harmless A->B->A->B oscillation. We do NOT ban
   backward moves globally (they can be correct in Quoridor). Instead, a
   return to a square occupied by this same pawn a few plies ago is penalized
   only when the move has no meaningful tactical compensation. */
function rootStabilityScore(m, recentSnapshots, player="me"){
  if(m.type !== "step" || !Array.isArray(recentSnapshots) || !recentSnapshots.length) return 0;
  const trail=[];
  for(const snap of recentSnapshots){
    const p=snap && snap[player];
    if(!p || !Number.isInteger(p.r) || !Number.isInteger(p.c)) continue;
    const last=trail[trail.length-1];
    if(!last || last.r!==p.r || last.c!==p.c) trail.push({r:p.r,c:p.c});
  }
  let penalty=0;
  /* The last trail item is the current square. Compare against older
     DISTINCT squares, so a player's position being unchanged during the
     opponent's turn does not itself look like a repetition. */
  for(let i=trail.length-2, age=2; i>=0; i--,age++){
    if(trail[i].r===m.r && trail[i].c===m.c){
      if(age===2) penalty-=ENGINE.oscillationPenalty;
      else if(age===3 || age===4) penalty-=ENGINE.repetitionPenalty;
      else if(age<=6) penalty-=Math.max(500, ENGINE.repetitionPenalty-(age-4)*250);
      break;
    }
  }
  return penalty;
}

function rootMovePreference(m, recentSnapshots){
  if(!m) return -Infinity;
  let score=rootStabilityScore(m,recentSnapshots,"me");
  /* Prefer a stable forward continuation when evaluations are close. */
  if(m.type === "step"){
    const d=shortestPath("me",state.walls,state.me);
    const nd=shortestPath("me",state.walls,{r:m.r,c:m.c});
    if(Number.isFinite(d) && Number.isFinite(nd) && nd<=d-1) score+=180;
  }
  return score;
}


/* Critical-fork detector: a position is dangerous when the opponent has
   multiple equally-short forward exits and can exploit a wall on the next
   turn.  We explicitly value walls that collapse those exits even when the
   wall does not immediately add path length. */
function criticalWallScore(player,walls,pPos,ePos,w){
  const enemy=player==="me"?"opp":"me";
  const before=shortestPathInfo(enemy,walls,ePos);
  const copy=new Set(walls); copy.add(wallKey(w.r,w.c,w.o));
  const after=shortestPathInfo(enemy,copy,ePos);
  if(!isFinite(after.dist)) return -1e9;
  let score=0;
  if(after.ways < before.ways) score += (before.ways-after.ways)*2600;
  if(after.dist > before.dist) score += (after.dist-before.dist)*4200;
  const beforeMoves=legalMoves(enemy,walls,ePos,pPos);
  const afterMoves=legalMoves(enemy,copy,ePos,pPos);
  const beforeProgress=beforeMoves.filter(m=>shortestPath(enemy,walls,m)===before.dist-1).length;
  const afterProgress=afterMoves.filter(m=>shortestPath(enemy,copy,m)===after.dist-1).length;
  if(afterProgress < beforeProgress) score += (beforeProgress-afterProgress)*1800;
  if(beforeProgress>=2 && afterProgress===1) score += 3000;
  return score;
}

function immediateProgressCount(player,walls,pos,other){
  const info=shortestPathInfo(player,walls,pos);
  if(!isFinite(info.dist)) return 0;
  return legalMoves(player,walls,pos,other).filter(m=>shortestPath(player,walls,m)===info.dist-1).length;
}

/*
 * Full tactical candidate generation:
 * - all legal pawn moves
 * - all legal walls that affect either current shortest route
 * - all walls that increase enemy distance
 * - all walls that preserve own distance
 * - a bounded set of additional strategic walls
 *
 * This is the crucial difference from the previous engine: a wall is not
 * discarded merely because it was not among the first 36 geometric guesses.
 */
function policyPriorForMove(m, walls, myPos, oppPos, myWalls, oppWalls, turnPlayer){
  try{
    const x=spnnFeatures(myPos,oppPos,walls,myWalls,oppWalls,turnPlayer,gameMode);
    const out=spnnForward(x);
    const idx=spnnActionIndex(m);
    return out.policy[idx];
  }catch(e){ return 0; }
}
function generateCandidates(turnPlayer,walls,myPos,oppPos,myWalls,oppWalls,limit=ENGINE.nodeWallLimit,searchDepth=1){
  const enemy=turnPlayer==="me"?"opp":"me";
  const pPos=turnPlayer==="me"?myPos:oppPos;
  const ePos=turnPlayer==="me"?oppPos:myPos;
  const pWalls=turnPlayer==="me"?myWalls:oppWalls;
  const curP=shortestPath(turnPlayer,walls,pPos);
  const curE=shortestPath(enemy,walls,ePos);
  const moves=[];

  for(const step of legalMoves(turnPlayer,walls,pPos,ePos)){
    const d=shortestPath(turnPlayer,walls,step);
    const progress=curP-d;
    moves.push({type:"step",r:step.r,c:step.c,priority:progress*10000});
  }
  if(pWalls<=0) return moves.sort((a,b)=>b.priority-a.priority);

  const ownPath=getOptimalPath(turnPlayer,walls,pPos);
  const enemyPath=getOptimalPath(enemy,walls,ePos);
  const ownCells=ownPath.slice(0,searchDepth<=2?20:12);
  const enemyCells=enemyPath.slice(0,searchDepth<=2?20:12);

  /*
   * A wall can only change the current shortest route if it touches one of
   * its cells. Build that tactical frontier instead of scanning every wall
   * anchor at every node. We still add a small strategic ring around both
   * pawns so a "pre-emptive" wall is not completely ignored.
   */
  const anchors=new Set();
  function addAround(cell){
    const r=cell.r,c=cell.c;
    for(const [rr,cc,o] of [
      [r-1,c,"h"],[r,c,"h"],[r,c-1,"v"],[r,c,"v"],
      [r-1,c-1,"h"],[r,c-1,"h"],[r-1,c-1,"v"],[r-1,c,"v"]
    ]){
      if(rr>=0&&rr<=getBoardRows()-2&&cc>=0&&cc<=7) anchors.add(rr+","+cc+","+o);
    }
  }
  for(const cell of ownCells) addAround(cell);
  for(const cell of enemyCells) addAround(cell);
  addAround(pPos); addAround(ePos);

  /* Add a deterministic central ring. It is small, but prevents the search
     from becoming blind to a setup wall that is not yet on a shortest path. */
  const cr=Math.max(0,Math.min(getBoardRows()-2,Math.floor(getBoardRows()/2)-1));
  for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
    for(const o of ["h","v"]){
      const rr=cr+dr,cc=3+dc;
      if(rr>=0&&rr<=getBoardRows()-2&&cc>=0&&cc<=7) anchors.add(rr+","+cc+","+o);
    }
  }

  const all=[];
  for(const key of anchors){
    const [rs,cs,o]=key.split(",");
    const r=+rs,c=+cs;
    if(!wallGeometryLegal(r,c,o,walls)) continue;
    const copy=new Set(walls); copy.add(key);
    const ndE=shortestPath(enemy,copy,ePos);
    const ndP=shortestPath(turnPlayer,copy,pPos);
    if(!isFinite(ndE)||!isFinite(ndP)) continue;

    const eGain=ndE-curE;
    const pLoss=ndP-curP;
    const nearEnemy=enemyCells.some(x=>Math.abs(x.r-r)<=1&&Math.abs(x.c-c)<=1);
    const nearOwn=ownCells.some(x=>Math.abs(x.r-r)<=1&&Math.abs(x.c-c)<=1);

    let priority=eGain*2600 - pLoss*2200;
    if(nearEnemy) priority+=500;
    if(nearOwn) priority-=120;
    if(eGain>=2) priority+=900;
    if(eGain>=3) priority+=1200;
    if(pLoss<=0) priority+=250;
    if(eGain===0 && pLoss===0) priority-=80;

    all.push({type:"wall",r,c,o,priority,_eGain:eGain,_pLoss:pLoss});
  }

  /* Root tactical frontier above already contains every wall touching either
     shortest route plus the central setup ring. Keep the root lean: complete
     all-wall enumeration is deferred to the low-wall exact solver, because
     spending seconds on BFS bookkeeping here prevents deeper alpha-beta. */

  all.sort((a,b)=>b.priority-a.priority);

  const pathCheck=Math.min(20,all.length);
  const beforeEnemyWays=shortestPathInfo(enemy,walls,ePos).ways;
  for(let i=0;i<pathCheck;i++){
    const w=all[i];
    const copy=new Set(walls); copy.add(wallKey(w.r,w.c,w.o));
    const afterEnemyWays=shortestPathInfo(enemy,copy,ePos).ways;
    if(afterEnemyWays < beforeEnemyWays) w.priority += 450;
    if(afterEnemyWays===1 && w._eGain>=1) w.priority += 500;
  }
  all.sort((a,b)=>b.priority-a.priority);

  const cap=searchDepth<=1 ? Math.min(Math.max(limit,48),64)
           : searchDepth<=3 ? Math.min(Math.max(limit,32),40)
           : Math.min(Math.max(limit,14),18);

  /*
   * Mandatory tactical set first: any wall that changes the opponent's
   * shortest route or preserves our own route is more important than a
   * generic "good looking" wall.
   */
  const chosen=[];
  const seen=new Set();
  for(const w of all){
    if(w._eGain>0 || w._pLoss<=0 || (w._critical||0)>0 || w._eGain===0 && w._pLoss===0){
      const k=moveKey(w);
      if(!seen.has(k)){seen.add(k);chosen.push(w);}
      if(chosen.length>=cap) break;
    }
  }
  for(const w of all){
    if(chosen.length>=cap) break;
    const k=moveKey(w);
    if(!seen.has(k)){seen.add(k);chosen.push(w);}
  }
  for(const w of chosen) moves.push(w);

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
    const [a,b]=wallHashPair(m.r,m.c,m.o);
    nh1=(h1^a)>>>0;nh2=(h2^b)>>>0;
    if(turnPlayer==="me") nMW--; else nOW--;
  }
  return {walls:nw,myPos:nMy,oppPos:nOpp,myWalls:nMW,oppWalls:nOW,h1:nh1,h2:nh2};
}

/* Detect whether a player is walking into a brittle single-route corridor. */
function immediateJumpOptions(player,walls,pos,otherPos){
  const out=[];
  for(const [dr,dc] of dirs){
    const mid={r:pos.r+dr,c:pos.c+dc};
    if(!inBoard(mid.r,mid.c)) continue;
    if(mid.r!==otherPos.r||mid.c!==otherPos.c) continue;
    if(edgeBlocked(pos,mid,walls)) continue;
    const jump={r:otherPos.r+dr,c:otherPos.c+dc};
    if(inBoard(jump.r,jump.c) && !edgeBlocked(otherPos,jump,walls)){
      out.push(jump); continue;
    }
    const sides=[
      {r:otherPos.r+dc,c:otherPos.c-dr},
      {r:otherPos.r-dc,c:otherPos.c+dr}
    ];
    for(const x of sides) if(inBoard(x.r,x.c)&&!edgeBlocked(otherPos,x,walls)) out.push(x);
  }
  return out;
}

function collisionTempoScore(walls,myPos,oppPos){
  const meJ=immediateJumpOptions("me",walls,myPos,oppPos);
  const opJ=immediateJumpOptions("opp",walls,oppPos,myPos);
  let score=0;
  if(opJ.length){
    /* A legal jump is often a full tempo. Penalize it much more when the
       resulting square materially advances the opponent's shortest route. */
    const before=shortestPath("opp",walls,oppPos);
    let bestGain=0;
    for(const j of opJ) bestGain=Math.max(bestGain,before-shortestPath("opp",walls,j));
    score-=5200+Math.max(0,bestGain)*1800;
  }
  if(meJ.length) score+=3200;
  return score;
}

function corridorRisk(player,walls,pos,otherPos){
  const info=shortestPathInfo(player,walls,pos);
  if(!isFinite(info.dist)) return 999;
  const moves=legalMoves(player,walls,pos,otherPos);
  let onBest=0;
  for(const m of moves){
    const d=shortestPath(player,walls,m);
    if(d===info.dist-1) onBest++;
  }
  let risk=0;
  if(info.ways<=1) risk+=3;
  if(onBest<=1) risk+=2;
  if(info.dist<=3 && info.ways<=2) risk+=2;
  return risk;
}

/*
 * This is the anti-self-trap guard. A wall/move is considered dangerous when
 * the opponent has a forced finish sooner than we can answer, OR when our
 * own route becomes a one-lane corridor while the opponent retains a
 * multi-route race. It is used as a search feature, not as a cosmetic rule.
 */
function tacticalPositionScore(walls,myPos,oppPos,myWalls,oppWalls){
  const me=shortestPathInfo("me",walls,myPos);
  const op=shortestPathInfo("opp",walls,oppPos);
  if(!isFinite(me.dist)) return -100000000;
  if(!isFinite(op.dist)) return 100000000;

  let score=0;
  score+=(op.dist-me.dist)*1450;
  score+=(myWalls-oppWalls)*38;

  const meRisk=corridorRisk("me",walls,myPos,oppPos);
  const opRisk=corridorRisk("opp",walls,oppPos,myPos);
  score+=(opRisk-meRisk)*260;

  const meProgress=immediateProgressCount("me",walls,myPos,oppPos);
  const opProgress=immediateProgressCount("opp",walls,oppPos,myPos);
  /* A two-exit fork is not automatically bad, but it is dangerous when the
     opponent can answer with a wall and our own route is already fragile.
     Strongly prefer positions where we collapse the fork ourselves. */
  if(opProgress>=2 && op.dist<=me.dist+1){
    score-=1800 + (opProgress-2)*700;
    if(myWalls>0) score-=900;
  }
  if(opProgress===1 && meProgress>=1) score+=900;
  if(meProgress>=2 && opProgress<=1) score+=650;

  /* If our own shortest route has only one forward continuation while the
     opponent has two, this is exactly the "I can block one exit and win"
     trap reported in testing. */
  if(meProgress<=1 && opProgress>=2) score-=2200;

  /* If a wall would reduce the opponent's number of shortest routes without
     increasing our path, the position is strategically stable. */
  if(op.ways<=2 && me.ways>=2) score+=250;

  /* If the opponent has a strictly shorter route and more than one way to
     execute it, penalize heavily: this is the exact pattern that previously
     produced "he already lost but kept building a path for the opponent". */
  if(op.dist<=me.dist){
    const gap=me.dist-op.dist;
    score-=3600*(gap+1);
    if(op.ways>=2) score-=1400;
    if(op.dist===me.dist) score-=1800;
  }
  if(me.ways<=1 && op.ways>=2) score-=700;

  const myMoves=legalMoves("me",walls,myPos,oppPos).length;
  const opMoves=legalMoves("opp",walls,oppPos,myPos).length;
  score+=(myMoves-opMoves)*22;
  /* Pawn collision/jump tempo is strategically decisive in Quoridor and is
     invisible to a plain shortest-path metric. */
  score+=collisionTempoScore(walls,myPos,oppPos);
  /* Learned value is calculated from the exact path/mobility metrics already
     computed for this leaf, so it adds very little search overhead. */
  try {
    lastNeuralValue=nnValueCompact(myPos,oppPos,walls,myWalls,oppWalls,"me",gameMode,me,op,myMoves,opMoves);
  } catch(e) { lastNeuralValue=0; }
  return score;
}

function evaluateStateFull(player,walls,myPos,oppPos,myWalls,oppWalls){
  if(myPos.r===getGoalRow("me")) return 100000000;
  if(oppPos.r===getGoalRow("opp")) return -100000000;
  const base=tacticalPositionScore(walls,myPos,oppPos,myWalls,oppWalls);
  /* Neural value is a secondary evaluator, never a replacement for tactical
     search. It breaks quiet positional ties while exact tactical terms remain
     dominant. */
  const neuralScale = gameMode === "race" ? 420 : 220;
  let learnedValue=0;
  try{ learnedValue=spnnForward(spnnFeatures(myPos,oppPos,walls,myWalls,oppWalls,player,gameMode)).value; }catch(e){}
  const blended = base + lastNeuralValue*neuralScale + learnedValue*120;
  return player==="me" ? blended : -blended;
}

/* Forced-race test. We only use this as a tactical oracle; it deliberately
   does not claim a global mathematical solution at arbitrary wall counts. */
function raceWindow(player,walls,myPos,oppPos,myWalls,oppWalls,plies){
  const pPos=player==="me"?myPos:oppPos;
  const ePos=player==="me"?oppPos:myPos;
  const pDist=shortestPath(player,walls,pPos);
  const eDist=shortestPath(player==="me"?"opp":"me",walls,ePos);
  if(!isFinite(pDist)) return -1;
  if(!isFinite(eDist)) return 1;
  if(eDist>pDist+plies) return 1;
  if(pDist>eDist+plies) return -1;
  return 0;
}

function shouldExtend(walls,myPos,oppPos,myWalls,oppWalls){
  const me=shortestPathInfo("me",walls,myPos);
  const op=shortestPathInfo("opp",walls,oppPos);
  if(me.dist<=4 || op.dist<=4) return true;
  if(me.ways<=1 || op.ways<=1) return true;
  if(Math.abs(me.dist-op.dist)<=2) return true;
  if(myWalls+oppWalls<=ENGINE.exactRemainingWalls) return true;
  return false;
}

/*
 * Exact solver for low-wall endgames. The state space is much smaller once
 * both players have only a few walls left. It searches legal moves without
 * heuristic pruning until terminal or the safety deadline.
 */
function exactEndgame(depth,walls,myPos,oppPos,myWalls,oppWalls,turn,alpha,beta){
  engineStats.exact++;
  if((++engineStats.nodes&63)===0 && performance.now()>=engineDeadline){
    engineAborted=true; return 0;
  }
  if(myPos.r===getGoalRow("me")) return 100000000-depth;
  if(oppPos.r===getGoalRow("opp")) return -100000000+depth;
  if(depth>40) return evaluateStateFull("me",walls,myPos,oppPos,myWalls,oppWalls);
  if(myWalls+oppWalls>ENGINE.exactRemainingWalls) return null;

  const key=(gameMode==="race"?"R":"D")+"|"+turn+"|"+myPos.r+","+myPos.c+"|"+
            oppPos.r+","+oppPos.c+"|"+myWalls+"|"+oppWalls+"|"+
            Array.from(walls).sort().join(";");
  const cached=EXACT_TT.get(key);
  if(cached && cached.depth>=depth) return cached.value;

  const p=turn==="me"?myPos:oppPos;
  const o=turn==="me"?oppPos:myPos;
  const pw=turn==="me"?myWalls:oppWalls;
  const candidates=[];
  for(const s of legalMoves(turn,walls,p,o)){
    candidates.push({type:"step",r:s.r,c:s.c,priority:0});
  }
  if(pw>0) for(const w of allValidWalls(walls)){
    candidates.push({type:"wall",r:w.r,c:w.c,o:w.o,priority:0});
  }

  let best=turn==="me"?-Infinity:Infinity;
  for(const m of candidates){
    const [h1,h2]=initialWallHash(walls);
    const n=applyMoveForSearch(m,walls,myPos,oppPos,myWalls,oppWalls,h1,h2,turn);
    const val=exactEndgame(depth+1,n.walls,n.myPos,n.oppPos,n.myWalls,n.oppWalls,
                           turn==="me"?"opp":"me",alpha,beta);
    if(engineAborted) return 0;
    if(turn==="me"){
      if(val>best) best=val;
      alpha=Math.max(alpha,val);
    }else{
      if(val<best) best=val;
      beta=Math.min(beta,val);
    }
    if(beta<=alpha){engineStats.cutoffs++;break;}
  }
  if(!isFinite(best)) best=evaluateStateFull("me",walls,myPos,oppPos,myWalls,oppWalls);
  EXACT_TT.set(key,{depth,value:best});
  if(EXACT_TT.size>50000) EXACT_TT.delete(EXACT_TT.keys().next().value);
  return best;
}

function minimax(depth,isMax,walls,myPos,oppPos,myWalls,oppWalls,h1,h2,alpha,beta){
  if((++engineStats.nodes&127)===0 && performance.now()>=engineDeadline){
    engineAborted=true;return 0;
  }
  if(myPos.r===getGoalRow("me")) return 100000000-depth;
  if(oppPos.r===getGoalRow("opp")) return -100000000+depth;

  if(myWalls+oppWalls<=ENGINE.exactRemainingWalls){
    const ex=exactEndgame(depth,walls,myPos,oppPos,myWalls,oppWalls,isMax?"me":"opp",alpha,beta);
    if(ex!==null) return ex;
  }

  if(depth===0){
    return evaluateStateFull("me",walls,myPos,oppPos,myWalls,oppWalls);
  }

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
  const limit=depth<=2?Math.max(ENGINE.nodeWallLimit,48):
              depth<=4?ENGINE.nodeWallLimit:
              Math.max(18,ENGINE.nodeWallLimit-8);
  const candidates=generateCandidates(turn,walls,myPos,oppPos,myWalls,oppWalls,limit,depth);
  if(!candidates.length) return evaluateStateFull("me",walls,myPos,oppPos,myWalls,oppWalls);

  let best=isMax?-Infinity:Infinity;
  let bestMove=null;
  for(const m of candidates){
    const n=applyMoveForSearch(m,walls,myPos,oppPos,myWalls,oppWalls,h1,h2,turn);
    const val=minimax(depth-1,!isMax,n.walls,n.myPos,n.oppPos,n.myWalls,n.oppWalls,
                      n.h1,n.h2,alpha,beta);
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

/*
 * Root safety audit:
 * Before accepting a move, look for an immediate tactical refutation by the
 * opponent. This catches the old failure mode even when the main search is
 * interrupted by the mobile deadline.
 */
function opponentWallRefutation(n){
  /*
   * The old safety audit looked almost exclusively at the opponent's pawn
   * reply.  That is exactly the blind spot that produced the reported
   * "two exits -> I block one -> engine is already lost" games: in Quoridor
   * the opponent's winning reply is very often a WALL, not a pawn step.
   *
   * We therefore run a tactical wall-threat pass before accepting a root
   * move.  It is intentionally conservative and only returns a refutation
   * when the opponent gets a concrete race/route advantage immediately.
   */
  const my=n.myPos, op=n.oppPos, walls=n.walls;
  const me0=shortestPathInfo("me",walls,my);
  const op0=shortestPathInfo("opp",walls,op);
  if(!isFinite(me0.dist)||!isFinite(op0.dist)) return true;

  const myProgress0=immediateProgressCount("me",walls,my,op);
  const opProgress0=immediateProgressCount("opp",walls,op,my);
  const threat = op0.dist <= me0.dist+2 || opProgress0>=2 || me0.ways<=1;
  if(!threat || n.oppWalls<=0) return false;

  const opPath=getOptimalPath("opp",walls,op).slice(0,18);
  const myPath=getOptimalPath("me",walls,my).slice(0,18);
  const anchors=new Set();
  function addCell(x){
    for(const [dr,dc,o] of [[-1,0,"h"],[0,0,"h"],[0,-1,"v"],[0,0,"v"],[-1,-1,"h"],[0,-1,"h"],[-1,-1,"v"],[-1,0,"v"]]){
      const r=x.r+dr,c=x.c+dc;
      if(r>=0&&r<=getBoardRows()-2&&c>=0&&c<=7) anchors.add(r+","+c+","+o);
    }
  }
  for(const x of opPath) addCell(x);
  for(const x of myPath) addCell(x);
  addCell(op); addCell(my);

  /* In a genuine fork, inspect the complete wall set, not just the path
     anchors. This pass is only reached in tactical positions. */
  const wallsToCheck=[];
  for(const k of anchors){const [r,c,o]=k.split(",").map((x,i)=>i<2?+x:x);if(wallGeometryLegal(r,c,o,walls))wallsToCheck.push({r,c,o});}
  /* Do not explode the branch here. Main alpha-beta is responsible for
     complete wall replies; this audit only needs the tactical frontier. */
  if(opProgress0>=2 || op0.dist<=me0.dist+1){
    for(let r=0;r<=getBoardRows()-2 && wallsToCheck.length<80;r++) for(let c=0;c<8 && wallsToCheck.length<80;c++) for(const o of ["h","v"]){
      if(wallGeometryLegal(r,c,o,walls)) wallsToCheck.push({r,c,o});
    }
  }

  const seen=new Set();
  for(const w of wallsToCheck){
    const wk=moveKey({type:"wall",...w});
    if(seen.has(wk)) continue; seen.add(wk);
    const copy=new Set(walls); copy.add(wallKey(w.r,w.c,w.o));
    const mi=shortestPathInfo("me",copy,my), oi=shortestPathInfo("opp",copy,op);
    if(!isFinite(mi.dist)||!isFinite(oi.dist)) continue;
    const mp=immediateProgressCount("me",copy,my,op);
    const opn=immediateProgressCount("opp",copy,op,my);

    /* Immediate terminal/race refutation. */
    if(oi.dist < mi.dist && opn>=1 && (mi.dist-oi.dist)>=2) return true;
    if(mp===0 && opn>=1 && oi.dist<=mi.dist+1 && oi.ways>=1) return true;

    /* The exact failure pattern: our pawn is reduced to one brittle route,
       while the opponent still has two or more forward continuations. */
    if(mi.ways<=1 && oi.ways>=2 && oi.dist<=mi.dist+1) return true;

    /* Look one pawn move deeper after the tactical wall. */
    if(opn>=1 && oi.dist<=mi.dist+2){
      for(const st of legalMoves("opp",copy,op,my)){
        const od=shortestPath("opp",copy,st);
        if(st.r===getGoalRow("opp")) return true;
        if(od+1 < mi.dist && od<=oi.dist-1) return true;
      }
    }
  }
  return false;
}

function rootMoveIsSafe(m){
  const [h1,h2]=initialWallHash(state.walls);
  const n=applyMoveForSearch(m,state.walls,{...state.me},{...state.opp},
                            state.me.walls,state.opp.walls,h1,h2,"me");
  if(n.oppPos.r===getGoalRow("opp")) return false;

  const opDist=shortestPath("opp",n.walls,n.oppPos);
  const meDist=shortestPath("me",n.walls,n.myPos);
  if(!isFinite(meDist) || !isFinite(opDist)) return false;

  /* Cheap race refutation. Inspect every legal pawn response (tiny branch)
     before the expensive deep search. */
  const opSteps=legalMoves("opp",n.walls,n.oppPos,n.myPos);
  for(const s of opSteps){
    const d=shortestPath("opp",n.walls,s);
    if(s.r===getGoalRow("opp")) return false;
    /* It is the opponent's turn after our root move. Equal shortest-path
       lengths therefore already favour the opponent by one tempo. */
    if(d <= meDist) return false;
  }
  /* A wall root move is itself a defensive resource; let the main search
     examine its wall replies instead of spending the whole root budget on a
     second exhaustive wall scan. Pawn roots, however, must pass the tactical
     wall/jump audit because they are the common source of self-traps. */
  if(m.type === "step"){
    const jumps=immediateJumpOptions("opp",n.walls,n.oppPos,n.myPos);
    for(const j of jumps){
      const d=shortestPath("opp",n.walls,j);
      if(d<=meDist) return false;
    }
  }
  return true;
}

function calculateBestMove(player, wasmPreferred=null){
  const myPos={...state.me},oppPos={...state.opp};

  /* Opening discipline: do not burn a wall on move one when the board is
     neutral. The engine should establish/retain a central lane first. */
  /* Opening guidance is ONLY for the actual first engine decision. The old
     condition checked only walls.size===0, which meant the engine bypassed
     search for every early move while nobody had placed a wall yet. That is
     the root cause of the predictable straight-line / jump-into-trap play. */
  const isFirstEngineDecision = myPos.r === getBoardRows()-1;
  if(state.walls.size===0 && isFirstEngineDecision){
    const myD=shortestPath("me",state.walls,myPos);
    const opD=shortestPath("opp",state.walls,oppPos);
    const neutral=Math.abs(myD-opD)<=1 && opD>3;
    if(neutral){
      const steps=legalMoves("me",state.walls,myPos,oppPos);
      const scored=steps.map(s=>{
        const d=shortestPath("me",state.walls,s);
        const center=4-Math.abs(s.c-4);
        return {...s,_score:(myPos.r-s.r)*100+center*20-d*5};
      }).sort((a,b)=>b._score-a._score);
      if(scored.length) return {type:"step",r:scored[0].r,c:scored[0].c,priority:5000};
    }
  }

  const myWalls=state.me.walls,oppWalls=state.opp.walls;
  const [h1,h2]=initialWallHash(state.walls);

  /* If a move immediately wins, never spend time second-guessing it. */
  const legalNow=[
    ...legalMoves("me",state.walls,myPos,oppPos).map(p=>({type:"step",r:p.r,c:p.c,priority:1e9}))
  ];
  const immediate=legalNow.find(m=>m.r===getGoalRow("me"));
  if(immediate) return immediate;

  const engineStart=performance.now();
  engineDeadline=engineStart+ENGINE.timeMs;
  engineAborted=false;
  engineStats={nodes:0,depth:0,elapsed:0,ttHits:0,cutoffs:0,exact:0,tactical:0};

  TT.clear();
  const root=generateCandidates("me",state.walls,myPos,oppPos,myWalls,oppWalls,
                                ENGINE.rootWallLimit,1);
  if(!root.length) return null;
  if(wasmPreferred){
    const pk=moveKey(wasmPreferred); const pi=root.findIndex(m=>moveKey(m)===pk);
    if(pi>0){const z=root[0];root[0]=root[pi];root[pi]=z;}
    else if(pi<0){root.unshift({...wasmPreferred,priority:1e8,_wasm:true});}
  }

  /* Root safety: keep all winning/defensive candidates; discard only moves
     that already hand the opponent a direct terminal win. */
  const safeRoot=[];
  for(const m of root){
    if(performance.now()>=engineDeadline) break;
    if(rootMoveIsSafe(m)) safeRoot.push(m);
  }
  const searchRoot=safeRoot.length?safeRoot:root;
  /* Self-play policy is a move-ordering prior. Alpha-beta remains the final
     authority, so a learned mistake cannot override a tactical refutation. */
  if(searchRoot.length>1){
    const x=spnnFeatures(myPos,oppPos,state.walls,myWalls,oppWalls,"me",gameMode);
    const pol=spnnForward(x).policy;
    for(const m of searchRoot){ m._policy=(pol[spnnActionIndex(m)]||0); m.priority += m._policy*30; }
    searchRoot.sort((a,b)=>b.priority-a.priority);
  }

  let best=searchRoot[0],bestScore=-Infinity;
  for(let depth=1;depth<=ENGINE.maxDepth;depth++){
    if(performance.now()>=engineDeadline) break;
    let iterationBest=null,iterationScore=-Infinity;
    const ordered=best?[best,...searchRoot.filter(m=>moveKey(m)!==moveKey(best))]:searchRoot;
    for(const m of ordered){
      if(performance.now()>=engineDeadline) break;
      const n=applyMoveForSearch(m,state.walls,myPos,oppPos,myWalls,oppWalls,h1,h2,"me");
      const score=minimax(depth-1,false,n.walls,n.myPos,n.oppPos,n.myWalls,n.oppWalls,
                          n.h1,n.h2,-Infinity,Infinity);
      if(engineAborted) break;
      const preference=rootMovePreference(m,state.recentSnapshots||[]);
      const rankedScore=score+preference;
      if(rankedScore>iterationScore ||
         (Math.abs(rankedScore-iterationScore)<=ENGINE.stabilityMargin &&
          preference>rootMovePreference(iterationBest,state.recentSnapshots||[]))){
        iterationScore=rankedScore; iterationBest=m;
      }
    }
    if(engineAborted||!iterationBest) break;
    best=iterationBest;bestScore=iterationScore;engineStats.depth=depth;
  }
  engineStats.elapsed=performance.now()-engineStart;
  return best;
}

/* Strong invariant tests. These run before the UI is used. */

function serializeState(s){
  return {
    turn:s.turn, gameOver:s.gameOver,
    me:{...s.me}, opp:{...s.opp}, walls:[...s.walls]
  };
}

self.onmessage = async function(ev){
  const msg=ev.data||{};
  if(msg.type!=="search") return;
  try{
    gameMode=msg.gameMode||"duel";
    raceWallsSetting=msg.raceWallsSetting||15;
    state={
      turn:msg.state.turn, gameOver:!!msg.state.gameOver,
      me:{...msg.state.me}, opp:{...msg.state.opp},
      walls:new Set(msg.state.walls||[]),
      recentSnapshots:Array.isArray(msg.state.recentSnapshots) ? msg.state.recentSnapshots : []
    };
    ARENA_FAST=!!msg.arenaFast;
    ENGINE.timeMs=ARENA_FAST ? Math.max(1,Math.min(100,msg.timeMs||10)) : Math.max(1800,Math.min(6500,msg.timeMs||4500));
    ENGINE.maxDepth=msg.maxDepth||18;

    /* Fast native pass first. It gives alpha-beta a genuinely independent PV
       and is also the fallback if the JS verifier times out. */
    let nativeMove=null;
    if(!ARENA_FAST){
      nativeMove=await wasmSearch(state,gameMode,Math.max(180000,Math.min(900000,msg.wasmNodes||500000)),Math.max(5,Math.min(12,msg.wasmDepth||9)));
      if(nativeMove){
        const legal = nativeMove.type==="step"
          ? legalMoves("me",state.walls,state.me,state.opp).some(p=>p.r===nativeMove.r&&p.c===nativeMove.c)
          : state.me.walls>0 && legalWall(nativeMove.r,nativeMove.c,nativeMove.o,state.walls);
        if(!legal) nativeMove=null;
      }
    }

    const move=calculateBestMove("me",nativeMove);
    const finalMove=move||nativeMove;
    self.postMessage({type:"result",requestId:msg.requestId,move:finalMove,stats:{...engineStats,wasm:!!nativeMove}});
  }catch(err){
    self.postMessage({type:"error",requestId:msg.requestId,error:String(err&&err.stack||err)});
  }
};

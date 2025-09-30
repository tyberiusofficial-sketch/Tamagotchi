// Mammothagotchi — Full Web Port
// Save/load, aging+scale, polygon bounds, feeding @ mouse with pathing,
// ball side spawn + arc + return, share popup (click+Y), music toggle + persistence,
// elder death after 60s in OLD stage, snow, HUD, restart after death (R key).

const CONFIG = {
  WIDTH: 800, HEIGHT: 450, FPS: 60,
  POLY: [[300,160],[700,160],[740,420],[300,420]],
  HUNGER_RATE: 1/30, FUN_DECAY: -1/45, HYGIENE_DECAY: -1/40,
  ENERGY_DECAY_IDLE: -1/180, ENERGY_DECAY_PLAY: -1/20,
  ENERGY_RECOVERY_IDLE: 1/50,
  FEED_DELTA: 18, FEED_FUN: 2, FEED_ENERGY: 3, CLEAN_DELTA: 16, PLAY_FUN_BOOST: 20,
  MAX_POOPS: 5, HYGIENE_DECAY_PER_POOP: -1/25, POOP_PRESSURE_PER_FEED: 30,
  POOP_PRESSURE_PASSIVE: 0.25, POOP_THRESHOLD: 100,
  OVERPLAY_ENERGY: 6, NEGLECT_HYGIENE: 4, NEGLECT_SECONDS_TO_DEATH: 45,
  SLEEP_ENTER_ENERGY: 10, SLEEP_EXIT_ENERGY: 40,
  SLEEP_RECOVERY_MULT: 100,   // sleep regen multiplier
  AGE_BABY: 0, AGE_TEEN: 120, AGE_ADULT: 240, AGE_OLD: 420,
  SCALE_BABY: 0.7, SCALE_TEEN: 0.85, SCALE_ADULT: 1.0, SCALE_OLD: 0.9,
};

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Helpers
function clamp(v, lo=0, hi=100){ return Math.max(lo, Math.min(hi, v)); }
function len(x,y){ return Math.hypot(x,y); }
function norm(x,y){ const d=len(x,y)||1; return [x/d,y/d]; }
function pointInPoly(x,y,poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const xi=poly[i][0], yi=poly[i][1];
    const xj=poly[j][0], yj=poly[j][1];
    const intersect = ((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi+0.00001)+xi);
    if(intersect) inside=!inside;
  }
  return inside;
}
function loadImage(name){ const i=new Image(); i.src="assets/"+name; return i; }

// Assets
// const bg=loadImage("background.png");   // REMOVE this line
const backgrounds = [
  loadImage("background1.png"),
  loadImage("background2.png"),
  loadImage("background3.png"),
  loadImage("background4.png"),
  loadImage("background5.png"),
];
let bgIndex = 0;
let bgTimer = 0;

// Walking animation frames (auto-scaled on draw)
const walkFrames = [
  loadImage("mammoth1.png"),
  loadImage("mammoth2.png"),
  loadImage("mammoth3.png"),
  loadImage("mammoth4.png"),
];

// Still images
const mammothImg=loadImage("mammoth.png");
const deadImg=loadImage("dead.png");
const sleepImg=loadImage("sleepingmammoth.png");
const ballImg=loadImage("ball.png");
const pooImg=loadImage("poo.png");
const vinesImg=loadImage("vines.png");
const xlogo=loadImage("xlogo.png");
const icons={
  hunger:loadImage("hunger.png"),
  cleanliness:loadImage("cleanliness.png"),
  happiness:loadImage("happiness.png"),
  sleepiness:loadImage("sleepiness.png")
};

// Music (.MP3, user-gesture autoplay, persistence)
let music = new Audio("assets/backgroundmusic.MP3");
music.loop = true;
music.volume = 0.5;
let muted = localStorage.getItem("music_muted") === "true";
function tryPlayMusic(){ if(!muted) music.play().catch(()=>{}); }
window.addEventListener('pointerdown', tryPlayMusic, { once:true });
window.addEventListener('keydown',     tryPlayMusic, { once:true });

// Restart helper
function restartGame(){
  try { localStorage.removeItem("mammoth_save"); } catch(e){}
  location.reload();
}

// Entities
class Ball{
  constructor(startX,startY,targetX,targetY,speed=280,arc=60){
    this.sx=startX; this.sy=startY; this.tx=targetX; this.ty=targetY;
    this.u=0; this.speed=speed; this.arc=arc; this.carried=false;
    const dx=this.tx-this.sx, dy=this.ty-this.sy;
    this.dist=Math.max(1, Math.hypot(dx,dy));
    this.du=this.speed/this.dist;
    this.x=this.sx; this.y=this.sy;
  }
  update(dt,mammoth){
    if(this.carried){ this.x=mammoth.x+10*mammoth.dir; this.y=mammoth.y-20; return; }
    this.u=Math.min(1,this.u+this.du*dt);
    this.x=this.sx+(this.tx-this.sx)*this.u;
    this.y=this.sy+(this.ty-this.sy)*this.u - 4.0*this.arc*this.u*(1-this.u);
  }
  get reached(){ return this.u>=1; }
  draw(){ ctx.drawImage(ballImg,this.x-22,this.y-22,44,44); }
}
class Poo{
  constructor(x,y){ this.x=x; this.y=y; }
  draw(){ ctx.drawImage(pooImg,this.x-13,this.y-11,26,22); }
  isClicked(mx,my){ return mx>this.x-13&&mx<this.x+13&&my>this.y-11&&my<this.y+11; }
}
class Vine{
  constructor(x,y){ this.x=x; this.y=-60; this.ty=y; this.reached=false; }
  update(dt){ if(!this.reached){ this.y+=200*dt; if(this.y>=this.ty){ this.y=this.ty; this.reached=true; } } }
  draw(){ ctx.drawImage(vinesImg,this.x-20,this.y,40,60); }
}
class Mammoth{
  constructor(){
    this.x=CONFIG.WIDTH*0.5; this.y=CONFIG.HEIGHT*0.7; this.homeX=this.x; this.dir=1;
    this.hunger=15; this.fun=15; this.hygiene=60; this.energy=90;
    this.poopPressure=0; this.neglect=0;
    this.age=0; this.stage="BABY"; this.stageEnterOldTime=null;
    this.state="WALK";
    this.scale=CONFIG.SCALE_BABY;

    // Animation
    this.animIndex = 0;
    this.animTimer = 0;
    this.animFps   = 8;  // speed of leg cycle
  }
  setStageFromAge(){
    const t=this.age; let s="BABY";
    if(t>=CONFIG.AGE_OLD) s="OLD"; else if(t>=CONFIG.AGE_ADULT) s="ADULT"; else if(t>=CONFIG.AGE_TEEN) s="TEEN";
    if(s!==this.stage){
      this.stage=s;
      this.scale={BABY:CONFIG.SCALE_BABY,TEEN:CONFIG.SCALE_TEEN,ADULT:CONFIG.SCALE_ADULT,OLD:CONFIG.SCALE_OLD}[s];
      if(s==="OLD") this.stageEnterOldTime = performance.now()/1000;
    }
  }
  feed(){
    if(this.state==="DEAD"||this.state==="SLEEP")return; // no feeding while asleep/dead
    if(this.hunger>=100){ this.energy=clamp(this.energy-20); }
    else{
      this.hunger=clamp(this.hunger+CONFIG.FEED_DELTA);
      this.fun=clamp(this.fun+CONFIG.FEED_FUN);
      this.energy=clamp(this.energy+CONFIG.FEED_ENERGY);
      this.poopPressure+=CONFIG.POOP_PRESSURE_PER_FEED;
    }
  }
  startChase(){
    if(this.state==="DEAD"||this.state==="SLEEP")return false;
    if(this.energy<=CONFIG.OVERPLAY_ENERGY) return false;
    this.state="CHASE"; return true;
  }
  pickupBall(){ this.state="RETURN"; }
  deliveredBall(){
    if(this.state==="DEAD")return;
    this.fun=clamp(this.fun+CONFIG.PLAY_FUN_BOOST);
    this.energy=clamp(this.energy-10);
    this.state="WALK";
  }
  update(dt,numPoops){
    if(this.state==="DEAD")return;

    this.age+=dt; this.setStageFromAge();
    if(this.stage==="OLD" && this.stageEnterOldTime!==null){
      const elapsedOld=performance.now()/1000 - this.stageEnterOldTime;
      if(elapsedOld>=60){ this.state="DEAD"; return; }
    }

    this.hunger=clamp(this.hunger+CONFIG.HUNGER_RATE*dt);
    this.fun=clamp(this.fun+CONFIG.FUN_DECAY*dt);
    this.hygiene=clamp(this.hygiene+(CONFIG.HYGIENE_DECAY+numPoops*CONFIG.HYGIENE_DECAY_PER_POOP)*dt);

    if(this.state==="SLEEP") this.energy=clamp(this.energy+CONFIG.ENERGY_RECOVERY_IDLE*CONFIG.SLEEP_RECOVERY_MULT*dt);
    else if(this.state==="CHASE"||this.state==="RETURN") this.energy=clamp(this.energy+CONFIG.ENERGY_DECAY_PLAY*dt);
    else this.energy=clamp(this.energy+(CONFIG.ENERGY_RECOVERY_IDLE+CONFIG.ENERGY_DECAY_IDLE)*dt);

    if(this.energy<CONFIG.SLEEP_ENTER_ENERGY && this.state!=="SLEEP") this.state="SLEEP";
    if(this.state==="SLEEP" && this.energy>=CONFIG.SLEEP_EXIT_ENERGY) this.state="WALK";

    if(this.hygiene<=CONFIG.NEGLECT_HYGIENE){ this.neglect+=dt; if(this.neglect>=CONFIG.NEGLECT_SECONDS_TO_DEATH) this.state="DEAD"; }
    else this.neglect=0;

    // Horizontal idle walk only when walking/eating (never while asleep)
    if(this.state==="WALK"||this.state==="EAT"){
      const nx=this.x+this.dir*80*dt, ny=this.y;
      if(pointInPoly(nx,ny,CONFIG.POLY)) this.x=nx; else this.dir*=-1;
    }

    // Advance leg animation whenever moving states
    if(this.state==="WALK" || this.state==="CHASE" || this.state==="RETURN"){
      this.animTimer += dt;
      const frameTime = 1 / this.animFps;
      while (this.animTimer >= frameTime) {
        this.animTimer -= frameTime;
        this.animIndex = (this.animIndex + 1) % walkFrames.length;
      }
    }else{
      this.animTimer = 0;
      this.animIndex = 0;
    }

    this.poopPressure+=CONFIG.POOP_PRESSURE_PASSIVE*dt;
  }
  draw(){
    let img;
    if(this.state==="DEAD") img = deadImg;
    else if(this.state==="SLEEP") img = sleepImg;
    else if((this.state==="WALK"||this.state==="CHASE"||this.state==="RETURN") && walkFrames.length) img = walkFrames[this.animIndex];
    else img = mammothImg;

    const w=160*this.scale, h=120*this.scale; // destination size = consistent scaling
    ctx.save();
    if(this.state!=="DEAD" && this.dir<0){ ctx.scale(-1,1); ctx.drawImage(img,-this.x-w/2,this.y-h,w,h); }
    else{ ctx.drawImage(img,this.x-w/2,this.y-h,w,h); }
    ctx.restore();
  }
}

// State
let mammoth=new Mammoth();
let poos=[], vines=[], ball=null, ballTarget=null;
let snow=Array.from({length:80},()=>[Math.random()*CONFIG.WIDTH,Math.random()*CONFIG.HEIGHT,20+Math.random()*40]);
let shareTimer=0, shareOpen=false, shareShown=false;
let clickableRects={};
let lastMouse=null;
let feedTarget=null;

// Save/Load (dead flag persisted)
function saveGame(){
  const state={
    ts: Date.now()/1000,
    hunger:mammoth.hunger, fun:mammoth.fun, hygiene:mammoth.hygiene, energy:mammoth.energy,
    age:mammoth.age, poop_pressure:mammoth.poopPressure, stage:mammoth.stage,
    poos: poos.slice(0,CONFIG.MAX_POOPS).map(p=>({x:p.x,y:p.y})),
    music_muted: muted,
    dead: (mammoth.state==="DEAD")
  };
  localStorage.setItem("mammoth_save", JSON.stringify(state));
}
function loadGame(){
  const raw=localStorage.getItem("mammoth_save"); if(!raw) return;
  try{
    const s=JSON.parse(raw);
    if(s.dead===true){ localStorage.removeItem("mammoth_save"); return; }
    const now=Date.now()/1000, elapsed=Math.max(0, now-(s.ts||now));
    mammoth.hunger = s.hunger ?? mammoth.hunger;
    mammoth.fun    = s.fun    ?? mammoth.fun;
    mammoth.hygiene= s.hygiene?? mammoth.hygiene;
    mammoth.energy = s.energy ?? mammoth.energy;
    mammoth.age    = (s.age||0) + elapsed*0.35;
    mammoth.poopPressure = (s.poop_pressure||0) + elapsed*0.05;
    mammoth.setStageFromAge();
    poos = (s.poos||[]).slice(0,CONFIG.MAX_POOPS).map(p=>new Poo(
      Math.max(20,Math.min(CONFIG.WIDTH-20,p.x)),
      Math.max(20,Math.min(CONFIG.HEIGHT-20,p.y))
    ));
    muted = !!s.music_muted;
    if(muted) music.pause(); else tryPlayMusic();
  }catch(e){}
}
loadGame();
window.addEventListener("beforeunload", saveGame);

// HUD
function drawHud(){
  const stats=[
    ["hunger",mammoth.hunger],
    ["cleanliness",mammoth.hygiene],
    ["happiness",mammoth.fun],
    ["sleepiness",mammoth.energy],
  ];
  const slotW=120, barW=80, barH=8;
  const startX=(CONFIG.WIDTH-(slotW*4-(slotW-barW)))/2;
  const yBase=CONFIG.HEIGHT-10;
  stats.forEach(([n,v],i)=>{
    const x=startX+i*slotW;
    ctx.drawImage(icons[n], x+(barW/2)-20, yBase-40, 40, 40);
    ctx.strokeStyle="#1e1e1e"; ctx.strokeRect(x,yBase-50,barW,barH);
    ctx.fillStyle="#c00000"; ctx.fillRect(x,yBase-50, Math.floor(barW*(Math.max(0,Math.min(100,v))/100)), barH);
  });
}

// Share popup
function drawShare(){
  ctx.fillStyle="rgba(0,0,0,0.62)"; ctx.fillRect(0,0,CONFIG.WIDTH,CONFIG.HEIGHT);
  const w=520,h=300,x=(CONFIG.WIDTH-w)/2,y=(CONFIG.HEIGHT-h)/2;
  ctx.fillStyle="#e6e6e6"; ctx.fillRect(x,y,w,h);
  ctx.strokeStyle="#141414"; ctx.lineWidth=3; ctx.strokeRect(x,y,w,h);
  ctx.fillStyle="#0a0a0a"; ctx.font="28px system-ui"; ctx.textAlign="center";
  ctx.fillText("Nice! You've been playing for a while.", CONFIG.WIDTH/2, y+54);
  ctx.fillText("Share your Mammobit adventure?", CONFIG.WIDTH/2, y+54+34);
  const logoSize=86; const lx=CONFIG.WIDTH/2-logoSize/2, ly=y+h/2-logoSize/2+10;
  ctx.drawImage(xlogo, lx, ly, logoSize, logoSize);
  const textY=ly+logoSize+24;
  ctx.fillStyle="#1e50c8"; ctx.font="20px system-ui"; ctx.fillText("Share on X", CONFIG.WIDTH/2, textY);
  ctx.fillStyle="#444"; ctx.fillText("Press ESC to close", CONFIG.WIDTH/2, y+h-24);
  clickableRects.logo={x:lx,y:ly,w:logoSize,h:logoSize};
  const tw=120, th=26; clickableRects.text={x:CONFIG.WIDTH/2-tw/2,y:textY-20,w:tw,h:th};
}
function rectHit(r,mx,my){ return mx>=r.x&&mx<=r.x+r.w&&my>=r.y&&my<=r.y+r.h; }
function openShare(){
  const text=encodeURIComponent("I've played with my Mammobit today! - Have you taken care of yours? https://mammobits.com 🐘❄️");
  window.open("https://twitter.com/intent/tweet?text="+text, "_blank");
}

// Dead overlay
function drawDeadOverlay(){
  ctx.fillStyle="rgba(0,0,0,0.65)";
  ctx.fillRect(0,0,CONFIG.WIDTH,CONFIG.HEIGHT);
  ctx.fillStyle="#fff";
  ctx.font="24px system-ui";
  ctx.textAlign="center";
  ctx.fillText("Your Mammoth has passed away.", CONFIG.WIDTH/2, CONFIG.HEIGHT/2-10);
  ctx.fillText("Press R to restart", CONFIG.WIDTH/2, CONFIG.HEIGHT/2+24);
}

// Input
window.addEventListener("keydown", e=>{
  // restart when dead
  if (mammoth && mammoth.state === "DEAD") {
    if (e.key.toLowerCase() === "r") { restartGame(); }
    return;
  }

  if(shareOpen){
    if(e.key==="Escape"||e.key==="Esc") shareOpen=false;
    if(e.key.toLowerCase()==="y"){ openShare(); shareOpen=false; }
    return;
  }
  if(e.key.toLowerCase()==="m"){
    muted=!muted; localStorage.setItem("music_muted", String(muted));
    if(muted) music.pause(); else tryPlayMusic();
  }
  if(e.key.toLowerCase()==="f"){
    // Block feeding while asleep
    if(mammoth.state==="SLEEP") return;
    const mp=lastMouse||{x:mammoth.x,y:mammoth.y};
    const tx=pointInPoly(mp.x,mp.y,CONFIG.POLY)?mp.x:mammoth.x;
    const ty=pointInPoly(mp.x,mp.y,CONFIG.POLY)?mp.y:mammoth.y;
    vines=[new Vine(tx,ty)]; feedTarget={x:tx,y:ty};
  }
  if(e.key.toLowerCase()==="p"){
    if(mammoth.startChase()){
      const mp=lastMouse||{x:mammoth.x,y:mammoth.y};
      const sideY=mp.y;
      const startX=(mp.x<CONFIG.WIDTH/2)?CONFIG.WIDTH+40:-40;
      ballTarget={x:pointInPoly(mp.x,mp.y,CONFIG.POLY)?mp.x:mammoth.x, y:mp.y};
      ball=new Ball(startX,sideY,ballTarget.x,ballTarget.y,280,60);
    }
  }
  if(e.key.toLowerCase()==="c"){
    if(poos.length){
      let k=0,best=1e9;
      for(let i=0;i<poos.length;i++){
        const d=len(poos[i].x-mammoth.x, poos[i].y-mammoth.y);
        if(d<best){ best=d; k=i; }
      }
      poos.splice(k,1);
      mammoth.hygiene=clamp(mammoth.hygiene+CONFIG.CLEAN_DELTA);
    }
  }
});
canvas.addEventListener("mousemove", e=>{
  const r=canvas.getBoundingClientRect();
  lastMouse={x:e.clientX-r.left, y:e.clientY-r.top};
});
canvas.addEventListener("click", e=>{
  const r=canvas.getBoundingClientRect();
  const mx=e.clientX-r.left, my=e.clientY-r.top;
  if(shareOpen){
    if(rectHit(clickableRects.logo,mx,my)||rectHit(clickableRects.text,mx,my)){ openShare(); shareOpen=false; }
    else shareOpen=false;
    return;
  }
  poos=poos.filter(p=>{ if(p.isClicked(mx,my)){ mammoth.hygiene=clamp(mammoth.hygiene+CONFIG.CLEAN_DELTA); return false; } return true; });
});

// Loop
let last=performance.now();
function tick(now){
  const dt=(now-last)/1000; last=now;
  ctx.clearRect(0,0,CONFIG.WIDTH,CONFIG.HEIGHT);
  
  // cycle background every 1.1 seconds
  bgTimer += dt;
  if (bgTimer >= 1.1) {
    bgTimer = 0;
    bgIndex = (bgIndex + 1) % backgrounds.length;
  }
  ctx.drawImage(backgrounds[bgIndex], 0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);

  if(!shareOpen){
    mammoth.update(dt,poos.length);

    if(mammoth.poopPressure>=CONFIG.POOP_THRESHOLD){
      mammoth.poopPressure-=CONFIG.POOP_THRESHOLD;
      poos.push(new Poo(Math.max(30,Math.min(CONFIG.WIDTH-30,mammoth.x)),
                        Math.max(30,Math.min(CONFIG.HEIGHT-30,mammoth.y-8))));
      if(poos.length>CONFIG.MAX_POOPS) poos.shift();
    }

    for(const v of vines) v.update(dt);
    if(vines.length && vines[0].reached){
      // Prevent movement toward food while sleeping / chasing / returning / dead
      if(
        feedTarget &&
        ["CHASE","RETURN","DEAD","SLEEP"].indexOf(mammoth.state)===-1
      ){
        const dx=feedTarget.x-mammoth.x, dy=feedTarget.y-mammoth.y, d=len(dx,dy);
        if(d>6){
          const [nx,ny]=norm(dx,dy);
          const nxp=mammoth.x+nx*96*dt, nyp=mammoth.y+ny*96*dt;
          if(pointInPoly(nxp,nyp,CONFIG.POLY)){ mammoth.x=nxp; mammoth.y=nyp; }
          mammoth.dir=dx>=0?1:-1;
        }else{ mammoth.feed(); vines.length=0; feedTarget=null; }
      }else{
        // Try to feed (will be ignored in SLEEP by feed()); then clear vines anyway
        mammoth.feed(); vines.length=0; feedTarget=null;
      }
    }

    if(ball){
      ball.update(dt,mammoth);
      const dx=ball.x-mammoth.x, dy=ball.y-mammoth.y; const d=len(dx,dy);
      if(mammoth.state==="CHASE"){
        if(d>24){
          const [nx,ny]=norm(dx,dy);
          const nxp=mammoth.x+nx*200*dt, nyp=mammoth.y+ny*200*dt;
          if(pointInPoly(nxp,nyp,CONFIG.POLY)){ mammoth.x=nxp; mammoth.y=nyp; }
          mammoth.dir=dx>=0?1:-1;
        }
        if(ball.reached && d<=24){ ball.carried=true; mammoth.pickupBall(); }
      }else if(mammoth.state==="RETURN"){
        const tx={x:mammoth.homeX, y:mammoth.y};
        const dx2=tx.x-mammoth.x, dy2=tx.y-mammoth.y, d2=len(dx2,dy2);
        if(d2>6){
          const [nx,ny]=norm(dx2,dy2);
          const nxp=mammoth.x+nx*200*dt, nyp=mammoth.y+ny*200*dt;
          if(pointInPoly(nxp,nyp,CONFIG.POLY)){ mammoth.x=nxp; mammoth.y=nyp; }
          mammoth.dir=dx2>=0?1:-1;
        }else{ mammoth.x=mammoth.homeX; mammoth.deliveredBall(); ball=null; ballTarget=null; }
      }
    }

    for(const f of snow){ f[1]+=f[2]*dt; if(f[1]>CONFIG.HEIGHT){ f[0]=Math.random()*CONFIG.WIDTH; f[1]=0; f[2]=20+Math.random()*40; } }
  }

  for(const f of snow){ ctx.fillStyle="#fff"; ctx.beginPath(); ctx.arc(f[0],f[1],2,0,Math.PI*2); ctx.fill(); }
  for(const p of poos) p.draw();
  if(ball) ball.draw();
  for(const v of vines) v.draw();
  mammoth.draw();
  drawHud();

  if(mammoth.state==="DEAD") drawDeadOverlay();

  shareTimer+=dt;
  if(!shareOpen && !shareShown && shareTimer>=20){ shareOpen=true; shareShown=true; }
  if(shareOpen) drawShare();

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

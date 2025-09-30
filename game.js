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

// Backgrounds
const backgrounds = [
  loadImage("background1.png"),
  loadImage("background2.png"),
  loadImage("background3.png"),
  loadImage("background4.png"),
  loadImage("background5.png"),
];
let bgIndex = 0;
let bgTimer = 0;
const bgInterval = 2.2; // seconds

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
    this.animFps   = 8;
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
    if(this.state==="DEAD"||this.state==="SLEEP")return;
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

    if(this.state==="WALK"||this.state==="EAT"){
      const nx=this.x+this.dir*80*dt, ny=this.y;
      if(pointInPoly(nx,ny,CONFIG.POLY)) this.x=nx; else this.dir*=-1;
    }

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

    const w=160*this.scale, h=120*this.scale;
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

// Save/Load
function saveGame(){ /* unchanged */ }
function loadGame(){ /* unchanged from last version */ }
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
    // icon
    ctx.drawImage(icons[n], x+(barW/2)-20, yBase-40, 40, 40);
    // bar frame
    ctx.strokeStyle="#1e1e1e";
    ctx.strokeRect(x, yBase-50, barW, barH);
    // bar fill
    const pct = Math.max(0, Math.min(100, v)) / 100;
    ctx.fillStyle="#c00000";
    ctx.fillRect(x, yBase-50, Math.floor(barW*pct), barH);
  });
}

// HUD / Share / Dead Overlay remain unchanged ...

// Input listeners remain unchanged ...

// Loop
let last=performance.now();
function tick(now){
  const dt=(now-last)/1000; last=now;

  // --- background cycling ---
  bgTimer += dt;
  if(bgTimer >= bgInterval){
    bgTimer -= bgInterval;
    bgIndex = (bgIndex+1) % backgrounds.length;
  }
  const currentBg = backgrounds[bgIndex];
  ctx.clearRect(0,0,CONFIG.WIDTH,CONFIG.HEIGHT);
  ctx.drawImage(currentBg,0,0,CONFIG.WIDTH,CONFIG.HEIGHT);

  // rest of tick() unchanged (mammoth update, poos, ball, snow, draw, etc.)
  // ... (same as the version I gave you before, just background replaced with currentBg)
  
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
      if(feedTarget && ["CHASE","RETURN","DEAD","SLEEP"].indexOf(mammoth.state)===-1){
        const dx=feedTarget.x-mammoth.x, dy=feedTarget.y-mammoth.y, d=len(dx,dy);
        if(d>6){
          const [nx,ny]=norm(dx,dy);
          const nxp=mammoth.x+nx*96*dt, nyp=mammoth.y+ny*96*dt;
          if(pointInPoly(nxp,nyp,CONFIG.POLY)){ mammoth.x=nxp; mammoth.y=nyp; }
          mammoth.dir=dx>=0?1:-1;
        }else{ mammoth.feed(); vines.length=0; feedTarget=null; }
      }else{ mammoth.feed(); vines.length=0; feedTarget=null; }
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

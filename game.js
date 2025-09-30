// Mammothagotchi Web Version
// Ported from Python/Pygame to JavaScript/Canvas

const CONFIG = {
  WIDTH: 800,
  HEIGHT: 450,
  FPS: 60,
  // Rates
  HUNGER_RATE: 1/30,
  FUN_DECAY: -1/45,
  HYGIENE_DECAY: -1/40,
  ENERGY_DECAY_IDLE: -1/180,
  ENERGY_DECAY_PLAY: -1/20,
  ENERGY_RECOVERY_IDLE: 1/50,
  FEED_DELTA: 18,
  FEED_FUN: 2,
  FEED_ENERGY: 3,
  CLEAN_DELTA: 16,
  PLAY_FUN_BOOST: 20,
  MAX_POOPS: 5,
  HYGIENE_DECAY_PER_POOP: -1/25,
  POOP_PRESSURE_PER_FEED: 30,
  POOP_PRESSURE_PASSIVE: 0.25,
  POOP_THRESHOLD: 100,
  OVERPLAY_ENERGY: 6,
  NEGLECT_HYGIENE: 4,
  NEGLECT_SECONDS_TO_DEATH: 45,
  SLEEP_ENTER_ENERGY: 10,
  SLEEP_EXIT_ENERGY: 40,
};

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Helpers
function loadImage(name) {
  const img = new Image();
  img.src = "assets/" + name;
  return img;
}
function clamp(v, lo=0, hi=100) { return Math.max(lo, Math.min(hi, v)); }

// Assets
const bg = loadImage("background.png");
const mammothImg = loadImage("mammoth.png");
const deadImg = loadImage("dead.png");
const sleepImg = loadImage("sleepingmammoth.png");
const ballImg = loadImage("ball.png");
const pooImg = loadImage("poo.png");
const vinesImg = loadImage("vines.png");
const icons = {
  hunger: loadImage("hunger.png"),
  cleanliness: loadImage("cleanliness.png"),
  happiness: loadImage("happiness.png"),
  sleepiness: loadImage("sleepiness.png"),
};

// Entities
class Mammoth {
  constructor() {
    this.x = CONFIG.WIDTH/2;
    this.y = CONFIG.HEIGHT*0.7;
    this.dir = 1;
    this.hunger = 15;
    this.fun = 15;
    this.hygiene = 60;
    this.energy = 90;
    this.poopPressure = 0;
    this.neglectTimer = 0;
    this.state = "WALK";
    this.ageSeconds = 0;
  }
  feed() {
    if(this.state==="DEAD"||this.state==="SLEEP") return;
    this.hunger = clamp(this.hunger + CONFIG.FEED_DELTA);
    this.fun = clamp(this.fun + CONFIG.FEED_FUN);
    this.energy = clamp(this.energy + CONFIG.FEED_ENERGY);
    this.poopPressure += CONFIG.POOP_PRESSURE_PER_FEED;
  }
  startChase() {
    if(this.state==="DEAD"||this.state==="SLEEP") return false;
    if(this.energy <= CONFIG.OVERPLAY_ENERGY) return false;
    this.state="CHASE";
    return true;
  }
  deliveredBall() {
    this.fun = clamp(this.fun + CONFIG.PLAY_FUN_BOOST);
    this.energy = clamp(this.energy - 10);
    this.state="WALK";
  }
  update(dt,numPoops) {
    if(this.state==="DEAD") return;
    this.ageSeconds+=dt;
    this.hunger = clamp(this.hunger+CONFIG.HUNGER_RATE*dt);
    this.fun = clamp(this.fun+CONFIG.FUN_DECAY*dt);
    this.hygiene = clamp(this.hygiene+(CONFIG.HYGIENE_DECAY+numPoops*CONFIG.HYGIENE_DECAY_PER_POOP)*dt);
    if(this.state==="SLEEP") {
      this.energy = clamp(this.energy+CONFIG.ENERGY_RECOVERY_IDLE*6*dt);
    } else if(this.state==="CHASE"||this.state==="RETURN") {
      this.energy = clamp(this.energy+CONFIG.ENERGY_DECAY_PLAY*dt);
    } else {
      this.energy = clamp(this.energy+CONFIG.ENERGY_RECOVERY_IDLE*dt+CONFIG.ENERGY_DECAY_IDLE*dt);
    }
    if(this.energy<CONFIG.SLEEP_ENTER_ENERGY && this.state!=="SLEEP") this.state="SLEEP";
    if(this.state==="SLEEP" && this.energy>=CONFIG.SLEEP_EXIT_ENERGY) this.state="WALK";
    if(this.hygiene<=CONFIG.NEGLECT_HYGIENE) {
      this.neglectTimer+=dt;
      if(this.neglectTimer>=CONFIG.NEGLECT_SECONDS_TO_DEATH) this.state="DEAD";
    } else this.neglectTimer=0;
    if(this.state==="WALK") {
      this.x+=this.dir*80*dt;
      if(this.x<300||this.x>700) this.dir*=-1;
    }
    this.poopPressure+=CONFIG.POOP_PRESSURE_PASSIVE*dt;
  }
  draw() {
    let img=mammothImg;
    if(this.state==="DEAD") img=deadImg;
    else if(this.state==="SLEEP") img=sleepImg;
    ctx.drawImage(img,this.x-80,this.y-90,160,120);
  }
}

class Ball {
  constructor(targetX,targetY) {
    this.x = targetX; this.y = targetY; this.reached=false;
  }
  update() { this.reached=true; }
  draw() { ctx.drawImage(ballImg,this.x-22,this.y-22,44,44); }
}

class Poo {
  constructor(x,y) { this.x=x; this.y=y; }
  draw() { ctx.drawImage(pooImg,this.x-13,this.y-11,26,22); }
  isClicked(mx,my) { return mx>this.x-13&&mx<this.x+13&&my>this.y-11&&my<this.y+11; }
}

class Vine {
  constructor(x,y) { this.x=x; this.y=-60; this.targetY=y; this.reached=false; }
  update(dt) { if(!this.reached){ this.y+=200*dt; if(this.y>=this.targetY){this.y=this.targetY;this.reached=true;}} }
  draw() { ctx.drawImage(vinesImg,this.x-20,this.y,40,60); }
}

// Game state
let mammoth=new Mammoth();
let poos=[];
let vines=[];
let ball=null;

// HUD
function drawHud() {
  const stats=[["hunger",mammoth.hunger],["cleanliness",mammoth.hygiene],["happiness",mammoth.fun],["sleepiness",mammoth.energy]];
  let x=200,y=CONFIG.HEIGHT-20;
  stats.forEach(([name,val],i)=>{
    ctx.drawImage(icons[name],x+i*120,y-40,40,40);
    ctx.strokeStyle="black";ctx.strokeRect(x+i*120,y-50,80,8);
    ctx.fillStyle="red";ctx.fillRect(x+i*120,y-50,Math.floor(80*(val/100)),8);
  });
}

// Input
window.addEventListener("keydown",e=>{
  if(e.key==="f"){vines.push(new Vine(mammoth.x,mammoth.y));}
  if(e.key==="p"){ if(mammoth.startChase()){ ball=new Ball(Math.random()*CONFIG.WIDTH,Math.random()*CONFIG.HEIGHT); } }
  if(e.key==="c"){ if(poos.length){poos.shift(); mammoth.hygiene=clamp(mammoth.hygiene+CONFIG.CLEAN_DELTA);} }
});

canvas.addEventListener("click",e=>{
  const rect=canvas.getBoundingClientRect();
  const mx=e.clientX-rect.left, my=e.clientY-rect.top;
  poos=poos.filter(p=>{ if(p.isClicked(mx,my)){mammoth.hygiene=clamp(mammoth.hygiene+CONFIG.CLEAN_DELTA);return false;} return true; });
});

// Loop
let last=performance.now();
function loop(now){
  const dt=(now-last)/1000; last=now;
  ctx.clearRect(0,0,CONFIG.WIDTH,CONFIG.HEIGHT);
  ctx.drawImage(bg,0,0,CONFIG.WIDTH,CONFIG.HEIGHT);
  mammoth.update(dt,poos.length);
  if(mammoth.poopPressure>=CONFIG.POOP_THRESHOLD){mammoth.poopPressure-=CONFIG.POOP_THRESHOLD; poos.push(new Poo(mammoth.x,mammoth.y)); if(poos.length>CONFIG.MAX_POOPS) poos.shift();}
  vines.forEach(v=>v.update(dt)); vines.forEach(v=>{if(v.reached){ mammoth.feed(); vines=[]; }});
  poos.forEach(p=>p.draw()); if(ball){ball.update(); ball.draw(); mammoth.deliveredBall(); ball=null;}
  vines.forEach(v=>v.draw());
  mammoth.draw();
  drawHud();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

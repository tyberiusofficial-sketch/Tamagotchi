// Mammothagotchi — Full Web Port
// Implements: save/load, aging+scale, polygon bounds, feeding @ mouse with pathing,
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
  SLEEP_RECOVERY_MULT: 100,   // UPDATED
  AGE_BABY: 0, AGE_TEEN: 120, AGE_ADULT: 240, AGE_OLD: 420,
  SCALE_BABY: 0.7, SCALE_TEEN: 0.85, SCALE_ADULT: 1.0, SCALE_OLD: 0.9,
};

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

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
function loadImage(name){const i=new Image();i.src="assets/"+name;return i;}

const bg=loadImage("background.png");
const mammothImg=loadImage("mammoth.png");
const deadImg=loadImage("dead.png");
const sleepImg=loadImage("sleepingmammoth.png");
const ballImg=loadImage("ball.png");
const pooImg=loadImage("poo.png");
const vinesImg=loadImage("vines.png");
const xlogo=loadImage("xlogo.png");
const icons={hunger:loadImage("hunger.png"),cleanliness:loadImage("cleanliness.png"),
             happiness:loadImage("happiness.png"),sleepiness:loadImage("sleepiness.png")};

// Music
let music = new Audio("assets/backgroundmusic.MP3");
music.loop = true;
music.volume = 0.5;
let muted = localStorage.getItem("music_muted") === "true";
function tryPlayMusic(){ if(!muted) music.play().catch(()=>{}); }
window.addEventListener('pointerdown', tryPlayMusic, { once: true });
window.addEventListener('keydown',     tryPlayMusic, { once: true });

// Restart helper
function restartGame() {
  try { localStorage.removeItem("mammoth_save"); } catch(e){}
  location.reload();
}

// Entities (Ball, Poo, Vine, Mammoth) — unchanged except Mammoth uses CONFIG.SLEEP_RECOVERY_MULT
class Ball { /* ... unchanged ... */ }
class Poo { /* ... unchanged ... */ }
class Vine { /* ... unchanged ... */ }
class Mammoth { /* ... unchanged except uses CONFIG.SLEEP_RECOVERY_MULT */ }

// State
let mammoth = new Mammoth();
let poos = [];
let vines = [];
let ball = null;
let ballTarget = null;
let snow = Array.from({length:80},()=>[Math.random()*CONFIG.WIDTH, Math.random()*CONFIG.HEIGHT, 20+Math.random()*40]);
let shareTimer = 0, shareOpen=false, shareShown=false;
let clickableRects = {};

// Save/Load — now includes dead flag
function saveGame(){
  const state={
    ts: Date.now()/1000,
    hunger:mammoth.hunger, fun:mammoth.fun, hygiene:mammoth.hygiene, energy:mammoth.energy,
    age:mammoth.age, poop_pressure:mammoth.poopPressure, stage:mammoth.stage,
    poos: poos.slice(0,CONFIG.MAX_POOPS).map(p=>({x:p.x,y:p.y})),
    music_muted: muted,
    dead: (mammoth.state === "DEAD")    // NEW
  };
  localStorage.setItem("mammoth_save", JSON.stringify(state));
}
function loadGame(){
  const raw = localStorage.getItem("mammoth_save"); if(!raw) return;
  try{
    const s=JSON.parse(raw);
    if (s.dead === true) { localStorage.removeItem("mammoth_save"); return; } // NEW
    const now=Date.now()/1000, elapsed=Math.max(0, now-(s.ts||now));
    mammoth.hunger = s.hunger ?? mammoth.hunger;
    mammoth.fun    = s.fun    ?? mammoth.fun;
    mammoth.hygiene= s.hygiene?? mammoth.hygiene;
    mammoth.energy = s.energy ?? mammoth.energy;
    mammoth.age    = (s.age||0) + elapsed*0.35;
    mammoth.poopPressure = (s.poop_pressure||0) + elapsed*0.05;
    mammoth.setStageFromAge();
    poos = (s.poos||[]).slice(0,CONFIG.MAX_POOPS).map(p=>new Poo(
      Math.max(20, Math.min(CONFIG.WIDTH-20, p.x)),
      Math.max(20, Math.min(CONFIG.HEIGHT-20, p.y))
    ));
    muted = !!s.music_muted;
    if(muted) music.pause(); else tryPlayMusic();
  }catch(e){}
}
loadGame();
window.addEventListener("beforeunload", saveGame);

// HUD and drawShare functions unchanged

// Dead overlay
function drawDeadOverlay(){
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(0,0,CONFIG.WIDTH,CONFIG.HEIGHT);
  ctx.fillStyle = "#fff";
  ctx.font = "24px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("Your Mammoth has passed away.", CONFIG.WIDTH/2, CONFIG.HEIGHT/2 - 10);
  ctx.fillText("Press R to restart", CONFIG.WIDTH/2, CONFIG.HEIGHT/2 + 24);
}

// Input
window.addEventListener("keydown", e=>{
  // Restart if dead
  if (mammoth && mammoth.state === "DEAD") {
    if (e.key.toLowerCase() === "r") { restartGame(); }
    return;
  }

  if(shareOpen){
    if (e.key === "Escape" || e.key === "Esc") shareOpen = false;
    if (e.key.toLowerCase() === "y") { openShare(); shareOpen = false; }
    return;
  }

  if(e.key.toLowerCase()==="m"){
    muted = !muted;
    localStorage.setItem("music_muted", String(muted));
    if (muted) music.pause(); else tryPlayMusic();
  }

  // other key handlers unchanged ...
});

// Mouse handlers unchanged

// Loop
function tick(now){
  // ... unchanged update/draw logic ...
  drawHud();
  if (mammoth.state === "DEAD") { drawDeadOverlay(); }   // NEW
  // share popup logic unchanged
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

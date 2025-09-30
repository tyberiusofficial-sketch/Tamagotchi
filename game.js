// Mammothagotchi Web Version
// Ported from Python/Pygame to JavaScript/Canvas

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const CONFIG = {
  WIDTH: 800,
  HEIGHT: 450,
  FPS: 60,
};

// Placeholder assets loader
function loadImage(src) {
  const img = new Image();
  img.src = "assets/" + src;
  return img;
}

// Example assets
const bg = loadImage("background.png");

// Basic game loop
function gameLoop() {
  ctx.clearRect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);
  ctx.drawImage(bg, 0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);

  // TODO: Implement mammoth, needs, poop, ball, vines, hud, sounds, etc.

  requestAnimationFrame(gameLoop);
}

// Start
bg.onload = () => {
  gameLoop();
};

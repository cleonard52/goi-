const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const heightDisplay = document.getElementById('height-display');
const timeDisplay = document.getElementById('time-display');
const resetBtn = document.getElementById('reset-btn');
const winScreen = document.getElementById('win-screen');
const finalTimeDisplay = document.getElementById('final-time');
const playAgainBtn = document.getElementById('play-again-btn');

// Resize canvas to match screen
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// Game constants
const GRAVITY = 0.45;
const FRICTION = 0.92;
const HAMMER_LENGTH = 115;
const HAMMER_HEAD_RADIUS = 12;
const POT_RADIUS = 24;
const GOAL_HEIGHT_METERS = 120;
const PIXELS_PER_METER = 30;

// Game state
let mouse = { x: canvas.width / 2, y: canvas.height / 2 };
let camera = { x: 0, y: 0 };
let startTime = Date.now();
let gameWon = false;

const player = {
  x: 0,
  y: -50,
  vx: 0,
  vy: 0,
  radius: POT_RADIUS,
  hammerAngle: -Math.PI / 4,
  hammerTipX: 0,
  hammerTipY: 0,
  prevTipX: 0,
  prevTipY: 0
};

// Mountain obstacles (x, y, width, height, color, type)
// Note: Negative Y goes UP in canvas coordinates
const platforms = [
  // Starting ground
  { x: -600, y: 0, w: 1200, h: 400, color: '#2d3748' },

  // Stage 1: Easy boulders
  { x: 110, y: -70, w: 140, h: 70, color: '#4a5568' },
  { x: -180, y: -150, w: 150, h: 60, color: '#4a5568' },
  { x: 60, y: -240, w: 130, h: 50, color: '#4a5568' },
  { x: 240, y: -340, w: 160, h: 70, color: '#4a5568' },

  // Stage 2: The Overhang
  { x: 40, y: -460, w: 120, h: 40, color: '#718096' },
  { x: -160, y: -560, w: 140, h: 50, color: '#718096' },
  { x: -340, y: -680, w: 130, h: 60, color: '#718096' },
  { x: -150, y: -810, w: 110, h: 40, color: '#718096' },

  // Stage 3: Narrow Cliffside
  { x: 70, y: -940, w: 90, h: 40, color: '#5a67d8' },
  { x: 230, y: -1080, w: 90, h: 40, color: '#5a67d8' },
  { x: 80, y: -1230, w: 80, h: 40, color: '#5a67d8' },
  { x: -110, y: -1380, w: 100, h: 45, color: '#5a67d8' },

  // Stage 4: The Tower (High stakes!)
  { x: -280, y: -1540, w: 85, h: 35, color: '#d69e2e' },
  { x: -100, y: -1700, w: 75, h: 35, color: '#d69e2e' },
  { x: 90, y: -1870, w: 75, h: 35, color: '#d69e2e' },
  { x: 260, y: -2050, w: 80, h: 35, color: '#d69e2e' },
  { x: 80, y: -2230, w: 70, h: 35, color: '#d69e2e' },

  // Stage 5: Final Ascent
  { x: -90, y: -2420, w: 70, h: 30, color: '#e53e3e' },
  { x: -240, y: -2610, w: 70, h: 30, color: '#e53e3e' },
  { x: -60, y: -2800, w: 65, h: 30, color: '#e53e3e' },
  { x: 110, y: -3000, w: 65, h: 30, color: '#e53e3e' },
  { x: -30, y: -3200, w: 65, h: 30, color: '#e53e3e' },
  { x: -160, y: -3400, w: 70, h: 30, color: '#e53e3e' },

  // Summit Platform (120m = -3600px)
  { x: -150, y: -3600, w: 300, h: 50, color: '#48bb78', isGoal: true }
];

// Track mouse movement
window.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

function resetGame() {
  player.x = 0;
  player.y = -50;
  player.vx = 0;
  player.vy = 0;
  startTime = Date.now();
  gameWon = false;
  winScreen.classList.add('hidden');
}

resetBtn.addEventListener('click', resetGame);
playAgainBtn.addEventListener('click', resetGame);

// Circle vs Rectangle collision helper
function circleRectCollision(cx, cy, cr, rect) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - closestX;
  const dy = cy - closestY;
  const distSq = dx * dx + dy * dy;

  if (distSq < cr * cr) {
    const dist = Math.sqrt(distSq) || 0.001;
    const overlap = cr - dist;
    return {
      collided: true,
      nx: dx / dist,
      ny: dy / dist,
      overlap
    };
  }
  return { collided: false };
}

function update() {
  if (gameWon) return;

  // Save previous hammer tip position
  player.prevTipX = player.hammerTipX;
  player.prevTipY = player.hammerTipY;

  // Calculate angle from player to mouse in world coordinates
  const worldMouseX = mouse.x + camera.x;
  const worldMouseY = mouse.y + camera.y;
  const targetAngle = Math.atan2(worldMouseY - player.y, worldMouseX - player.x);

  // Smoothly rotate hammer toward mouse
  let diff = targetAngle - player.hammerAngle;
  while (diff < -Math.PI) diff += Math.PI * 2;
  while (diff > Math.PI) diff -= Math.PI * 2;
  player.hammerAngle += diff * 0.25;

  // Desired hammer tip position
  const desiredTipX = player.x + Math.cos(player.hammerAngle) * HAMMER_LENGTH;
  const desiredTipY = player.y + Math.sin(player.hammerAngle) * HAMMER_LENGTH;

  player.hammerTipX = desiredTipX;
  player.hammerTipY = desiredTipY;

  // Check hammer collision with platforms (Leverage physics!)
  for (const plat of platforms) {
    const hit = circleRectCollision(
      player.hammerTipX,
      player.hammerTipY,
      HAMMER_HEAD_RADIUS,
      plat
    );

    if (hit.collided) {
      // Push hammer head out of surface
      const pushOutX = hit.nx * hit.overlap;
      const pushOutY = hit.ny * hit.overlap;
      player.hammerTipX += pushOutX;
      player.hammerTipY += pushOutY;

      // Apply reaction force to player body
      player.x += pushOutX * 0.85;
      player.y += pushOutY * 0.85;

      // Convert hammer swing velocity into player launch velocity
      const swingVx = player.hammerTipX - player.prevTipX;
      const swingVy = player.hammerTipY - player.prevTipY;

      player.vx += pushOutX * 0.35 - swingVx * 0.12;
      player.vy += pushOutY * 0.35 - swingVy * 0.12;

      // High surface grip so hammer hooks onto ledges
      player.vx *= 0.82;
      player.vy *= 0.82;
    }
  }

  // Apply gravity & air damping
  player.vy += GRAVITY;
  player.vx *= 0.99;

  // Clamp max speed to prevent tunneling
  const maxSpeed = 22;
  player.vx = Math.max(-maxSpeed, Math.min(maxSpeed, player.vx));
  player.vy = Math.max(-maxSpeed, Math.min(maxSpeed, player.vy));

  // Move player
  player.x += player.vx;
  player.y += player.vy;

  // Player pot collision with platforms
  for (const plat of platforms) {
    const hit = circleRectCollision(player.x, player.y, player.radius, plat);
    if (hit.collided) {
      player.x += hit.nx * hit.overlap;
      player.y += hit.ny * hit.overlap;

      // Cancel velocity into surface
      const dot = player.vx * hit.nx + player.vy * hit.ny;
      if (dot < 0) {
        player.vx -= dot * hit.nx;
        player.vy -= dot * hit.ny;
      }

      // Ground friction
      if (hit.ny < -0.5) {
        player.vx *= FRICTION;
        if (plat.isGoal && !gameWon) {
          triggerWin();
        }
      }
    }
  }

  // Smooth camera follow
  const targetCamX = player.x - canvas.width / 2;
  const targetCamY = player.y - canvas.height * 0.6;
  camera.x += (targetCamX - camera.x) * 0.1;
  camera.y += (targetCamY - camera.y) * 0.1;

  // Update HUD
  const currentMeters = Math.max(0, Math.round(-player.y / PIXELS_PER_METER));
  heightDisplay.textContent = currentMeters;
  timeDisplay.textContent = formatTime(Date.now() - startTime);
}

function triggerWin() {
  gameWon = true;
  finalTimeDisplay.textContent = formatTime(Date.now() - startTime);
  winScreen.classList.remove('hidden');
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const mins = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const secs = String(totalSeconds % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

function draw() {
  // Dynamic sky gradient based on height
  const heightRatio = Math.min(1, Math.max(0, -player.y / 3600));
  ctx.fillStyle = `rgb(${26 - heightRatio * 20}, ${32 - heightRatio * 22}, ${44 + heightRatio * 30})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  // Draw height markers every 20 meters
  ctx.font = '14px sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  for (let m = 20; m <= GOAL_HEIGHT_METERS; m += 20) {
    const yPos = -m * PIXELS_PER_METER;
    ctx.fillRect(-1000, yPos, 2000, 1);
    ctx.fillText(`${m}m`, -350, yPos - 6);
  }

  // Draw platforms
  for (const plat of platforms) {
    ctx.fillStyle = plat.color;
    ctx.beginPath();
    ctx.roundRect(plat.x, plat.y, plat.w, plat.h, 8);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (plat.isGoal) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SUMMIT!', plat.x + plat.w / 2, plat.y - 12);
    }
  }

  // Draw Climber Character (Upper torso inside pot)
  ctx.fillStyle = '#fbd38d';
  ctx.beginPath();
  ctx.arc(player.x, player.y - 20, 13, 0, Math.PI * 2);
  ctx.fill();

  // Draw Cauldron / Pot
  ctx.fillStyle = '#1a202c';
  ctx.strokeStyle = '#a0aec0';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.radius, 0, Math.PI);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Draw Hammer Shaft
  ctx.strokeStyle = '#b7791f';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(player.x, player.y - 14);
  ctx.lineTo(player.hammerTipX, player.hammerTipY);
  ctx.stroke();

  // Draw Hammer Head
  const headAngle = Math.atan2(
    player.hammerTipY - (player.y - 14),
    player.hammerTipX - player.x
  );
  ctx.save();
  ctx.translate(player.hammerTipX, player.hammerTipY);
  ctx.rotate(headAngle);
  ctx.fillStyle = '#cbd5e0';
  ctx.fillRect(-8, -18, 16, 36);
  ctx.restore();

  ctx.restore();
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

loop();

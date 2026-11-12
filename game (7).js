const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const heightDisplay = document.getElementById('height-display');
const timeDisplay = document.getElementById('time-display');
const resetBtn = document.getElementById('reset-btn');
const winScreen = document.getElementById('win-screen');
const finalTimeDisplay = document.getElementById('final-time');
const playAgainBtn = document.getElementById('play-again-btn');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// Physics & Game Constants
const GRAVITY = 0.45;
const GROUND_FRICTION = 0.88;
const MIN_HAMMER_LENGTH = 36;
const MAX_HAMMER_LENGTH = 145;
const HAMMER_HEAD_RADIUS = 13;
const POT_RADIUS = 24;
const GOAL_HEIGHT_METERS = 120;
const PIXELS_PER_METER = 30;
const SUBSTEPS = 6; // High-precision substeps prevent clipping through platforms

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
  hammerLength: 90,
  hammerTipX: 0,
  hammerTipY: 0,
  isGrounded: false,
  hammerContact: false
};

// Mountain platforms
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

  // Stage 4: The Tower
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

  // Summit Platform
  { x: -150, y: -3600, w: 300, h: 50, color: '#48bb78', isGoal: true }
];

window.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

function resetGame() {
  player.x = 0;
  player.y = -50;
  player.vx = 0;
  player.vy = 0;
  player.hammerLength = 90;
  startTime = Date.now();
  gameWon = false;
  winScreen.classList.add('hidden');
}

resetBtn.addEventListener('click', resetGame);
playAgainBtn.addEventListener('click', resetGame);

// Accurate Circle vs AABB (Rectangle) collision detection
function resolveCircleRect(cx, cy, radius, rect) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));

  let dx = cx - closestX;
  let dy = cy - closestY;
  const distSq = dx * dx + dy * dy;

  // Handle center inside rectangle edge case
  if (distSq === 0) {
    const leftPen = Math.abs(cx - rect.x);
    const rightPen = Math.abs(rect.x + rect.w - cx);
    const topPen = Math.abs(cy - rect.y);
    const bottomPen = Math.abs(rect.y + rect.h - cy);
    const minPen = Math.min(leftPen, rightPen, topPen, bottomPen);

    if (minPen === topPen) return { collided: true, nx: 0, ny: -1, overlap: topPen + radius };
    if (minPen === bottomPen) return { collided: true, nx: 0, ny: 1, overlap: bottomPen + radius };
    if (minPen === leftPen) return { collided: true, nx: -1, ny: 0, overlap: leftPen + radius };
    return { collided: true, nx: 1, ny: 0, overlap: rightPen + radius };
  }

  if (distSq < radius * radius) {
    const dist = Math.sqrt(distSq);
    return {
      collided: true,
      nx: dx / dist,
      ny: dy / dist,
      overlap: radius - dist
    };
  }

  return { collided: false };
}

function update() {
  if (gameWon) return;

  // Shoulder pivot point inside the pot
  const pivotX = player.x;
  const pivotY = player.y - 12;

  // Convert mouse to world coordinates
  const worldMouseX = mouse.x + camera.x;
  const worldMouseY = mouse.y + camera.y;

  // Target angle and target length based on cursor distance
  const dxMouse = worldMouseX - pivotX;
  const dyMouse = worldMouseY - pivotY;
  const targetAngle = Math.atan2(dyMouse, dxMouse);
  const rawDist = Math.hypot(dxMouse, dyMouse);
  const targetLength = Math.max(MIN_HAMMER_LENGTH, Math.min(MAX_HAMMER_LENGTH, rawDist));

  // Smoothly interpolate angle
  let angleDiff = targetAngle - player.hammerAngle;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

  const dtSub = 1 / SUBSTEPS;
  player.isGrounded = false;
  player.hammerContact = false;

  // Run physics in substeps for rock-solid collision and leverage
  for (let step = 0; step < SUBSTEPS; step++) {
    // 1. Apply gravity and integrate player velocity
    player.vy += GRAVITY * dtSub;
    player.vx *= Math.pow(0.992, dtSub);

    // Clamp max velocity
    const maxVel = 24;
    player.vx = Math.max(-maxVel, Math.min(maxVel, player.vx));
    player.vy = Math.max(-maxVel, Math.min(maxVel, player.vy));

    player.x += player.vx * dtSub;
    player.y += player.vy * dtSub;

    // 2. Resolve Player Pot vs Platforms
    for (const plat of platforms) {
      const hit = resolveCircleRect(player.x, player.y, player.radius, plat);
      if (hit.collided) {
        player.x += hit.nx * hit.overlap;
        player.y += hit.ny * hit.overlap;

        const vn = player.vx * hit.nx + player.vy * hit.ny;
        if (vn < 0) {
          player.vx -= vn * hit.nx;
          player.vy -= vn * hit.ny;
        }

        if (hit.ny < -0.5) {
          player.isGrounded = true;
          player.vx *= Math.pow(GROUND_FRICTION, dtSub);
          if (plat.isGoal && !gameWon) {
            triggerWin();
          }
        }
      }
    }

    // 3. Advance hammer angle & telescoping length toward target
    const currentPivotX = player.x;
    const currentPivotY = player.y - 12;

    // Recompute angle diff dynamically as player moves
    let stepAngleDiff = targetAngle - player.hammerAngle;
    while (stepAngleDiff < -Math.PI) stepAngleDiff += Math.PI * 2;
    while (stepAngleDiff > Math.PI) stepAngleDiff -= Math.PI * 2;

    player.hammerAngle += stepAngleDiff * 0.28 * dtSub * 4;
    player.hammerLength += (targetLength - player.hammerLength) * 0.32 * dtSub * 4;

    // Desired hammer tip position
    let tipX = currentPivotX + Math.cos(player.hammerAngle) * player.hammerLength;
    let tipY = currentPivotY + Math.sin(player.hammerAngle) * player.hammerLength;

    // 4. Resolve Hammer Head vs Platforms (Action-Reaction Leverage)
    for (const plat of platforms) {
      const hit = resolveCircleRect(tipX, tipY, HAMMER_HEAD_RADIUS, plat);
      if (hit.collided) {
        player.hammerContact = true;

        // Push hammer tip out of the rock
        const corrX = hit.nx * hit.overlap;
        const corrY = hit.ny * hit.overlap;
        tipX += corrX;
        tipY += corrY;

        // Equal & opposite reaction pushes player away from the surface!
        player.x += corrX;
        player.y += corrY;

        // Transfer push impulse into player velocity so you can launch & vault
        const impulseStrength = 0.85;
        player.vx += corrX * impulseStrength;
        player.vy += corrY * impulseStrength;

        // Apply surface grip (tangential friction) so hammer hooks onto edges without sliding
        const tx = -hit.ny;
        const ty = hit.nx;
        const vt = player.vx * tx + player.vy * ty;
        player.vx -= vt * tx * 0.25;
        player.vy -= vt * ty * 0.25;

        // Re-solve player pot collision immediately so player isn't pushed into another wall
        for (const p2 of platforms) {
          const potHit = resolveCircleRect(player.x, player.y, player.radius, p2);
          if (potHit.collided) {
            player.x += potHit.nx * potHit.overlap;
            player.y += potHit.ny * potHit.overlap;
          }
        }

        // Update constrained hammer length and angle to match actual physical tip position
        const newDx = tipX - player.x;
        const newDy = tipY - (player.y - 12);
        player.hammerAngle = Math.atan2(newDy, newDx);
        player.hammerLength = Math.max(
          MIN_HAMMER_LENGTH,
          Math.min(MAX_HAMMER_LENGTH, Math.hypot(newDx, newDy))
        );
      }
    }

    player.hammerTipX = player.x + Math.cos(player.hammerAngle) * player.hammerLength;
    player.hammerTipY = (player.y - 12) + Math.sin(player.hammerAngle) * player.hammerLength;
  }

  // Smooth camera follow
  const targetCamX = player.x - canvas.width / 2;
  const targetCamY = player.y - canvas.height * 0.6;
  camera.x += (targetCamX - camera.x) * 0.12;
  camera.y += (targetCamY - camera.y) * 0.12;

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
  const heightRatio = Math.min(1, Math.max(0, -player.y / 3600));
  ctx.fillStyle = `rgb(${26 - heightRatio * 20}, ${32 - heightRatio * 22}, ${44 + heightRatio * 30})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  // Height markers every 20 meters
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

  // Subtle range ring showing min/max hammer reach around player
  const pivotX = player.x;
  const pivotY = player.y - 12;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(pivotX, pivotY, MAX_HAMMER_LENGTH, 0, Math.PI * 2);
  ctx.stroke();

  // Draw Climber Character
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

  // Draw Telescoping Hammer Shaft (outer sleeve + inner rod)
  const midX = pivotX + Math.cos(player.hammerAngle) * Math.min(player.hammerLength, MIN_HAMMER_LENGTH + 15);
  const midY = pivotY + Math.sin(player.hammerAngle) * Math.min(player.hammerLength, MIN_HAMMER_LENGTH + 15);

  // Inner metal rod
  ctx.strokeStyle = '#a0aec0';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY);
  ctx.lineTo(player.hammerTipX, player.hammerTipY);
  ctx.stroke();

  // Wooden handle sleeve
  ctx.strokeStyle = '#b7791f';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY);
  ctx.lineTo(midX, midY);
  ctx.stroke();

  // Draw Hammer Head (glows slightly when anchored on rock)
  ctx.save();
  ctx.translate(player.hammerTipX, player.hammerTipY);
  ctx.rotate(player.hammerAngle);
  ctx.fillStyle = player.hammerContact ? '#68d391' : '#cbd5e0';
  ctx.fillRect(-8, -18, 16, 36);
  ctx.strokeStyle = '#2d3748';
  ctx.lineWidth = 2;
  ctx.strokeRect(-8, -18, 16, 36);
  ctx.restore();

  ctx.restore();
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

loop();

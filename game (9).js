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

// Physics & Hammer constants
const GRAVITY = 0.45;
const POT_FRICTION = 0.92;
const POT_RADIUS = 24;
const SHOULDER_OFFSET_Y = -14;

const MIN_HAMMER_LEN = 38;
const MAX_HAMMER_LEN = 148;
const HAMMER_HEAD_RADIUS = 13;

// High Coulomb static & kinetic friction coefficients for the hammer head
const STATIC_FRICTION_COEFF = 1.65;
const KINETIC_FRICTION_COEFF = 1.25;

const SUBSTEPS = 8;
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
  hammerLen: 95,
  tipX: 0,
  tipY: 0,
  tipVx: 0,
  tipVy: 0,
  isGrounded: false,
  hammerGripStrength: 0
};

// Mountain obstacles
const platforms = [
  // Starting ground
  { x: -700, y: 0, w: 1400, h: 400, color: '#2d3748' },

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

  // Summit Platform (120m = -3600px)
  { x: -150, y: -3600, w: 300, h: 50, color: '#48bb78', isGoal: true }
];

window.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

function initPlayer() {
  player.x = 0;
  player.y = -50;
  player.vx = 0;
  player.vy = 0;
  player.hammerAngle = -Math.PI / 4;
  player.hammerLen = 95;
  player.tipX = player.x + Math.cos(player.hammerAngle) * player.hammerLen;
  player.tipY = (player.y + SHOULDER_OFFSET_Y) + Math.sin(player.hammerAngle) * player.hammerLen;
  player.tipVx = 0;
  player.tipVy = 0;
  player.hammerGripStrength = 0;
}

function resetGame() {
  initPlayer();
  startTime = Date.now();
  gameWon = false;
  winScreen.classList.add('hidden');
}

resetBtn.addEventListener('click', resetGame);
playAgainBtn.addEventListener('click', resetGame);
initPlayer();

// Circle vs Rectangle collision helper
function circleRectCollision(cx, cy, cr, rect) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - closestX;
  const dy = cy - closestY;
  const distSq = dx * dx + dy * dy;

  if (distSq < cr * cr) {
    const dist = Math.sqrt(distSq) || 0.0001;
    return {
      collided: true,
      nx: dx / dist,
      ny: dy / dist,
      overlap: cr - dist
    };
  }
  return { collided: false };
}

function update() {
  if (gameWon) return;

  const worldMouseX = mouse.x + camera.x;
  const worldMouseY = mouse.y + camera.y;

  const dt = 1 / SUBSTEPS;
  player.isGrounded = false;
  let frameGripAccum = 0;

  for (let step = 0; step < SUBSTEPS; step++) {
    // 1. Apply gravity to pot
    player.vy += GRAVITY * dt;
    player.vx *= Math.pow(0.992, dt);

    // 2. Compute desired target for hammer head from mouse
    const shoulderX = player.x;
    const shoulderY = player.y + SHOULDER_OFFSET_Y;

    const dxMouse = worldMouseX - shoulderX;
    const dyMouse = worldMouseY - shoulderY;
    const targetAngle = Math.atan2(dyMouse, dxMouse);
    const rawDist = Math.hypot(dxMouse, dyMouse);
    const targetLen = Math.max(MIN_HAMMER_LEN, Math.min(MAX_HAMMER_LEN, rawDist));

    const desiredTipX = shoulderX + Math.cos(targetAngle) * targetLen;
    const desiredTipY = shoulderY + Math.sin(targetAngle) * targetLen;

    // 3. Apply arm actuator force to move hammer head toward desired target
    // Using a stiff PD spring so the arm pushes strongly against friction
    const armStiffness = 0.55;
    const armDamping = 0.45;
    const pullFx = (desiredTipX - player.tipX) * armStiffness - player.tipVx * armDamping;
    const pullFy = (desiredTipY - player.tipY) * armStiffness - player.tipVy * armDamping;

    player.tipVx += pullFx;
    player.tipVy += pullFy;

    // Advance positions
    const prevTipX = player.tipX;
    const prevTipY = player.tipY;

    player.x += player.vx * dt;
    player.y += player.vy * dt;
    player.tipX += player.tipVx * dt;
    player.tipY += player.tipVy * dt;

    // 4. Resolve Hammer Head collisions with true surface friction
    for (const plat of platforms) {
      const hit = circleRectCollision(player.tipX, player.tipY, HAMMER_HEAD_RADIUS, plat);
      if (hit.collided) {
        // Push hammer head out of surface along contact normal
        player.tipX += hit.nx * hit.overlap;
        player.tipY += hit.ny * hit.overlap;

        // Calculate normal force (how hard the hammer is pressed into the surface)
        const vn = player.tipVx * hit.nx + player.tipVy * hit.ny;
        const normalImpulse = Math.max(0, -vn) + hit.overlap * 2.5;

        if (vn < 0) {
          player.tipVx -= vn * hit.nx;
          player.tipVy -= vn * hit.ny;
        }

        // Tangent vector along the surface
        const tx = -hit.ny;
        const ty = hit.nx;

        // Tangential velocity of hammer head sliding along surface
        const vt = player.tipVx * tx + player.tipVy * ty;

        // Coulomb friction limit proportional to normal force into surface
        const maxStaticFriction = normalImpulse * STATIC_FRICTION_COEFF;

        if (Math.abs(vt) <= maxStaticFriction) {
          // Static friction holds: lock tangential sliding completely
          player.tipVx -= vt * tx;
          player.tipVy -= vt * ty;
          frameGripAccum = Math.max(frameGripAccum, 1.0);
        } else {
          // Kinetic friction resists sliding strongly
          const frictionImpulse = Math.sign(vt) * normalImpulse * KINETIC_FRICTION_COEFF;
          const clampedImpulse = Math.abs(frictionImpulse) > Math.abs(vt) ? vt : frictionImpulse;
          player.tipVx -= clampedImpulse * tx;
          player.tipVy -= clampedImpulse * ty;
          frameGripAccum = Math.max(frameGripAccum, 0.65);
        }
      }
    }

    // 5. Rigid Telescoping Shaft Constraint between Shoulder and Hammer Head
    // Because surface friction resists the hammer head moving, pulling/pushing the shaft
    // directly transfers force to pull or lift the player's body!
    const curShoulderX = player.x;
    const curShoulderY = player.y + SHOULDER_OFFSET_Y;
    const shaftDx = player.tipX - curShoulderX;
    const shaftDy = player.tipY - curShoulderY;
    const currentDist = Math.hypot(shaftDx, shaftDy) || 0.0001;

    // Desired shaft length stays clamped between MIN and MAX
    const constrainedLen = Math.max(MIN_HAMMER_LEN, Math.min(MAX_HAMMER_LEN, targetLen));
    const lenError = currentDist - constrainedLen;

    const dirX = shaftDx / currentDist;
    const dirY = shaftDy / currentDist;

    // Distribute constraint correction between body and tip based on surface grip
    // When hammer head has high friction on rock, body gets pulled/pushed much more
    const tipMobility = frameGripAccum > 0 ? 0.15 : 0.75;
    const bodyMobility = 1.0 - tipMobility;

    const correctionX = dirX * lenError;
    const correctionY = dirY * lenError;

    player.x += correctionX * bodyMobility;
    player.y += correctionY * bodyMobility;
    player.tipX -= correctionX * tipMobility;
    player.tipY -= correctionY * tipMobility;

    // Transfer shaft reaction impulse to velocities
    player.vx += (correctionX * bodyMobility) / dt * 0.55;
    player.vy += (correctionY * bodyMobility) / dt * 0.55;
    player.tipVx -= (correctionX * tipMobility) / dt * 0.55;
    player.tipVy -= (correctionY * tipMobility) / dt * 0.55;

    // 6. Resolve Pot (Player Body) collisions with platforms
    for (const plat of platforms) {
      const hit = circleRectCollision(player.x, player.y, player.radius, plat);
      if (hit.collided) {
        player.x += hit.nx * hit.overlap;
        player.y += hit.ny * hit.overlap;

        const dot = player.vx * hit.nx + player.vy * hit.ny;
        if (dot < 0) {
          player.vx -= dot * hit.nx;
          player.vy -= dot * hit.ny;
        }

        if (hit.ny < -0.5) {
          player.isGrounded = true;
          player.vx *= Math.pow(POT_FRICTION, dt);
          if (plat.isGoal && !gameWon) {
            triggerWin();
          }
        }
      }
    }

    // Update angle & length readouts
    player.hammerAngle = Math.atan2(player.tipY - (player.y + SHOULDER_OFFSET_Y), player.tipX - player.x);
    player.hammerLen = Math.hypot(player.tipX - player.x, player.tipY - (player.y + SHOULDER_OFFSET_Y));
  }

  player.hammerGripStrength = frameGripAccum;

  // Clamp extreme velocities
  const maxSpeed = 24;
  player.vx = Math.max(-maxSpeed, Math.min(maxSpeed, player.vx));
  player.vy = Math.max(-maxSpeed, Math.min(maxSpeed, player.vy));

  // Smooth camera follow
  const targetCamX = player.x - canvas.width / 2;
  const targetCamY = player.y - canvas.height * 0.58;
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

  // Platforms
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

  // Subtle reach ring around shoulder
  const shoulderX = player.x;
  const shoulderY = player.y + SHOULDER_OFFSET_Y;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(shoulderX, shoulderY, MAX_HAMMER_LEN, 0, Math.PI * 2);
  ctx.stroke();

  // Climber upper torso
  ctx.fillStyle = '#fbd38d';
  ctx.beginPath();
  ctx.arc(player.x, player.y - 20, 13, 0, Math.PI * 2);
  ctx.fill();

  // Cauldron / Pot
  ctx.fillStyle = '#1a202c';
  ctx.strokeStyle = '#a0aec0';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.radius, 0, Math.PI);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Telescoping Hammer Shaft
  ctx.strokeStyle = '#744210';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(shoulderX, shoulderY);
  ctx.lineTo(
    shoulderX + Math.cos(player.hammerAngle) * MIN_HAMMER_LEN,
    shoulderY + Math.sin(player.hammerAngle) * MIN_HAMMER_LEN
  );
  ctx.stroke();

  ctx.strokeStyle = '#d69e2e';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(shoulderX, shoulderY);
  ctx.lineTo(player.tipX, player.tipY);
  ctx.stroke();

  // Hammer Head (glows green under static friction, amber under kinetic friction)
  ctx.save();
  ctx.translate(player.tipX, player.tipY);
  ctx.rotate(player.hammerAngle);
  if (player.hammerGripStrength >= 0.9) {
    ctx.fillStyle = '#68d391';
  } else if (player.hammerGripStrength > 0) {
    ctx.fillStyle = '#f6e05e';
  } else {
    ctx.fillStyle = '#cbd5e0';
  }
  ctx.fillRect(-8, -18, 16, 36);
  ctx.strokeStyle = '#1a202c';
  ctx.lineWidth = 1.5;
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

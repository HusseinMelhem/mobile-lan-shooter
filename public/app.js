const canvas = document.getElementById("gameCanvas");
const context = canvas.getContext("2d");

const hud = document.getElementById("hud");
const hudToggle = document.getElementById("hudToggle");
const hudDrawer = document.getElementById("hudDrawer");
const statusPill = document.getElementById("statusPill");
const networkHint = document.getElementById("networkHint");
const shareBox = document.getElementById("shareBox");
const startOverlay = document.getElementById("startOverlay");
const joinForm = document.getElementById("joinForm");
const joinButton = document.getElementById("joinButton");
const nameInput = document.getElementById("nameInput");
const scoreValue = document.getElementById("scoreValue");
const kdValue = document.getElementById("kdValue");
const weaponValue = document.getElementById("weaponValue");
const leaderboard = document.getElementById("leaderboard");
const killfeed = document.getElementById("killfeed");
const announcement = document.getElementById("announcement");
const respawnOverlay = document.getElementById("respawnOverlay");

const JOYSTICK_RADIUS = 68;
const MOBILE_HINT_ALPHA = 0.16;
const MINIMAP_PADDING = 16;
const MINIMAP_MIN_WIDTH = 116;
const MINIMAP_MAX_WIDTH = 170;
const MINIMAP_INNER_PADDING = 10;

const state = {
  config: {
    world: {
      width: 2400,
      height: 1600,
      walls: [],
    },
    rules: {
      respawnMs: 2600,
    },
    networkUrls: [],
  },
  connected: false,
  joined: false,
  selfId: null,
  displayName: "",
  players: new Map(),
  renderPlayers: new Map(),
  bullets: [],
  pickups: [],
  particles: [],
  camera: {
    x: 1200,
    y: 800,
  },
  controls: {
    keyboard: {
      up: false,
      down: false,
      left: false,
      right: false,
    },
    mouse: {
      active: false,
      x: 0,
      y: 0,
    },
    sticks: {
      left: makeStick(),
      right: makeStick(),
    },
    aim: {
      x: 1,
      y: 0,
    },
  },
  viewport: {
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
  },
  lastFrameAt: performance.now(),
  serverOffset: 0,
  hudOpen: false,
  touchCapable:
    "ontouchstart" in window || navigator.maxTouchPoints > 0 || window.innerWidth < 900,
};

const socket = io({
  transports: ["websocket"],
});

init();

async function init() {
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  try {
    const response = await fetch("/config.json");
    if (response.ok) {
      const config = await response.json();
      state.config = config;
      updateNetworkUi(config.networkUrls);
    }
  } catch (_error) {
    updateNetworkUi([]);
  }

  bindSocket();
  bindInput();
  setHudOpen(false);
  requestAnimationFrame(frame);
}

function bindSocket() {
  socket.on("connect", () => {
    state.connected = true;
    setStatus("Connected", "ok");
    if (state.displayName) {
      socket.emit("join", {
        name: state.displayName,
      });
    }
  });

  socket.on("disconnect", () => {
    state.connected = false;
    setStatus("Reconnecting", "warning");
    showAnnouncement("Connection dropped. Trying to reconnect...");
  });

  socket.on("welcome", (payload) => {
    updateNetworkUi(payload && payload.networkUrls ? payload.networkUrls : []);
  });

  socket.on("init", (payload) => {
    state.selfId = payload.selfId;
    state.joined = true;
    state.config.world = payload.world;
    state.config.rules = payload.rules;
    state.serverOffset = 0;
    updateNetworkUi(payload.networkUrls || []);
    startOverlay.classList.add("overlay--hidden");
    setStatus("Live On LAN", "ok");
    showAnnouncement("Arena synced. Invite nearby players to the same Wi-Fi link.");
  });

  socket.on("snapshot", (snapshot) => {
    state.serverOffset = snapshot.serverTime - Date.now();
    syncPlayers(snapshot.players || []);
    state.bullets = snapshot.bullets || [];
    state.pickups = snapshot.pickups || [];

    for (const event of snapshot.events || []) {
      handleEvent(event);
    }

    updateHud();
  });
}

function bindInput() {
  hudToggle.addEventListener("click", () => {
    setHudOpen(!state.hudOpen);
  });

  joinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const safeName = sanitizeName(nameInput.value) || "Pilot";
    state.displayName = safeName;
    nameInput.value = safeName;
    joinButton.disabled = true;
    joinButton.textContent = "Joining...";
    socket.emit("join", { name: safeName });
    setTimeout(() => {
      joinButton.disabled = false;
      joinButton.textContent = "Enter Arena";
    }, 700);
  });

  window.addEventListener("keydown", (event) => {
    if (event.repeat) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === "w" || key === "arrowup") {
      state.controls.keyboard.up = true;
    }
    if (key === "s" || key === "arrowdown") {
      state.controls.keyboard.down = true;
    }
    if (key === "a" || key === "arrowleft") {
      state.controls.keyboard.left = true;
    }
    if (key === "d" || key === "arrowright") {
      state.controls.keyboard.right = true;
    }
  });

  window.addEventListener("keyup", (event) => {
    const key = event.key.toLowerCase();
    if (key === "w" || key === "arrowup") {
      state.controls.keyboard.up = false;
    }
    if (key === "s" || key === "arrowdown") {
      state.controls.keyboard.down = false;
    }
    if (key === "a" || key === "arrowleft") {
      state.controls.keyboard.left = false;
    }
    if (key === "d" || key === "arrowright") {
      state.controls.keyboard.right = false;
    }
  });

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);

    if (event.pointerType === "touch") {
      handleTouchDown(event);
      return;
    }

    state.controls.mouse.active = true;
    updateMouseAim(event);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") {
      handleTouchMove(event);
      return;
    }

    updateMouseAim(event);
  });

  canvas.addEventListener("pointerup", (event) => {
    if (event.pointerType === "touch") {
      handleTouchUp(event.pointerId);
      return;
    }

    state.controls.mouse.active = false;
  });

  canvas.addEventListener("pointercancel", (event) => {
    handleTouchUp(event.pointerId);
    state.controls.mouse.active = false;
  });

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  setInterval(sendInput, 1000 / 30);
}

function syncPlayers(players) {
  const seenIds = new Set();

  for (const player of players) {
    seenIds.add(player.id);
    state.players.set(player.id, player);

    let renderPlayer = state.renderPlayers.get(player.id);
    if (!renderPlayer) {
      renderPlayer = {
        x: player.x,
        y: player.y,
        targetX: player.x,
        targetY: player.y,
        angle: player.angle,
        targetAngle: player.angle,
        health: player.health,
        targetHealth: player.health,
        shotSeq: player.shotSeq,
        alive: player.alive,
      };
      state.renderPlayers.set(player.id, renderPlayer);
    } else if (player.shotSeq !== renderPlayer.shotSeq) {
      spawnMuzzleFlash(player);
      renderPlayer.shotSeq = player.shotSeq;
    }

    renderPlayer.targetX = player.x;
    renderPlayer.targetY = player.y;
    renderPlayer.targetAngle = player.angle;
    renderPlayer.targetHealth = player.health;
    renderPlayer.alive = player.alive;
  }

  for (const id of Array.from(state.players.keys())) {
    if (!seenIds.has(id)) {
      state.players.delete(id);
      state.renderPlayers.delete(id);
    }
  }
}

function handleEvent(event) {
  if (event.type === "impact") {
    spawnBurst(event.x, event.y, event.color, 8, 180, 0.5);
    return;
  }

  if (event.type === "pickup") {
    if (event.pickupType === "shotgun") {
      spawnBurst(event.x, event.y, "#f4c95d", 18, 260, 0.95);
      addFeedItem(
        `${event.playerName} grabbed a shotgun with 4 shells`,
        "hot"
      );
      return;
    }

    spawnBurst(event.x, event.y, "#7de27a", 12, 220, 0.8);
    addFeedItem(`${event.playerName} picked up health`, "system");
    return;
  }

  if (event.type === "elimination") {
    spawnBurst(event.x, event.y, "#ffd47e", 22, 340, 1.1);
    addFeedItem(`${event.attackerName} tagged ${event.victimName}`, "hot");
    return;
  }

  if (event.type === "system") {
    addFeedItem(event.message, "system");
  }
}

function sendInput() {
  if (!state.joined || !socket.connected) {
    return;
  }

  const movement = getMovementVector();
  const aim = getAimVector();
  const firing = getFiringState();

  socket.emit("input", {
    moveX: movement.x,
    moveY: movement.y,
    aimX: aim.x,
    aimY: aim.y,
    firing,
  });
}

function getMovementVector() {
  const leftStick = state.controls.sticks.left;
  if (leftStick.active) {
    return {
      x: leftStick.valueX,
      y: leftStick.valueY,
    };
  }

  let x = 0;
  let y = 0;

  if (state.controls.keyboard.left) {
    x -= 1;
  }
  if (state.controls.keyboard.right) {
    x += 1;
  }
  if (state.controls.keyboard.up) {
    y -= 1;
  }
  if (state.controls.keyboard.down) {
    y += 1;
  }

  const normalized = normalize(x, y);
  return {
    x: normalized.x,
    y: normalized.y,
  };
}

function getAimVector() {
  const rightStick = state.controls.sticks.right;
  if (rightStick.active && rightStick.strength > 0.14) {
    state.controls.aim.x = rightStick.valueX;
    state.controls.aim.y = rightStick.valueY;
    return state.controls.aim;
  }

  const self = state.renderPlayers.get(state.selfId);
  if (self) {
    const mouseAim = normalize(
      state.controls.mouse.x - state.viewport.width / 2,
      state.controls.mouse.y - state.viewport.height / 2
    );

    if (mouseAim.length > 0.02) {
      state.controls.aim.x = mouseAim.x;
      state.controls.aim.y = mouseAim.y;
    }
  }

  return state.controls.aim;
}

function getFiringState() {
  const rightStick = state.controls.sticks.right;
  if (rightStick.active && rightStick.strength > 0.18) {
    return true;
  }

  return state.controls.mouse.active;
}

function handleTouchDown(event) {
  const x = event.clientX;
  const y = event.clientY;
  const side = x < window.innerWidth / 2 ? "left" : "right";
  const stick = state.controls.sticks[side];

  if (stick.active) {
    return;
  }

  stick.active = true;
  stick.pointerId = event.pointerId;
  stick.baseX = x;
  stick.baseY = y;
  stick.knobX = x;
  stick.knobY = y;
  stick.valueX = 0;
  stick.valueY = 0;
  stick.strength = 0;
}

function handleTouchMove(event) {
  for (const side of ["left", "right"]) {
    const stick = state.controls.sticks[side];
    if (!stick.active || stick.pointerId !== event.pointerId) {
      continue;
    }

    const dx = event.clientX - stick.baseX;
    const dy = event.clientY - stick.baseY;
    const distance = Math.hypot(dx, dy);
    const limited = Math.min(distance, JOYSTICK_RADIUS);
    const direction = normalize(dx, dy);

    stick.knobX = stick.baseX + direction.x * limited;
    stick.knobY = stick.baseY + direction.y * limited;
    stick.valueX = distance ? direction.x * (limited / JOYSTICK_RADIUS) : 0;
    stick.valueY = distance ? direction.y * (limited / JOYSTICK_RADIUS) : 0;
    stick.strength = limited / JOYSTICK_RADIUS;
  }
}

function handleTouchUp(pointerId) {
  for (const side of ["left", "right"]) {
    const stick = state.controls.sticks[side];
    if (stick.pointerId !== pointerId) {
      continue;
    }

    resetStick(stick);
  }
}

function updateMouseAim(event) {
  state.controls.mouse.x = event.clientX;
  state.controls.mouse.y = event.clientY;
}

function frame(now) {
  const deltaSeconds = Math.min((now - state.lastFrameAt) / 1000, 0.033);
  state.lastFrameAt = now;

  updateRenderState(deltaSeconds);
  render();

  requestAnimationFrame(frame);
}

function updateRenderState(dt) {
  for (const [id, renderPlayer] of state.renderPlayers.entries()) {
    renderPlayer.x = lerp(renderPlayer.x, renderPlayer.targetX, id === state.selfId ? 0.36 : 0.2);
    renderPlayer.y = lerp(renderPlayer.y, renderPlayer.targetY, id === state.selfId ? 0.36 : 0.2);
    renderPlayer.angle = lerpAngle(renderPlayer.angle, renderPlayer.targetAngle, 0.24);
    renderPlayer.health = lerp(renderPlayer.health, renderPlayer.targetHealth, 0.2);
  }

  const self = state.renderPlayers.get(state.selfId);
  if (self) {
    state.camera.x = lerp(state.camera.x, self.x, 0.12);
    state.camera.y = lerp(state.camera.y, self.y, 0.12);
  }

  for (let index = state.particles.length - 1; index >= 0; index -= 1) {
    const particle = state.particles[index];
    particle.life -= dt;
    if (particle.life <= 0) {
      state.particles.splice(index, 1);
      continue;
    }

    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= 0.96;
    particle.vy *= 0.96;
  }

  updateRespawnOverlay();
}

function render() {
  const width = state.viewport.width;
  const height = state.viewport.height;

  context.clearRect(0, 0, width, height);
  drawBackground(width, height);

  context.save();
  context.translate(width / 2 - state.camera.x, height / 2 - state.camera.y);

  drawArenaBounds();
  drawGrid();
  drawPickups();
  drawWalls();
  drawBullets();
  drawPlayers();
  drawParticles();

  context.restore();

  drawReticle();
  drawTouchControls();
  drawMinimap();
}

function drawBackground(width, height) {
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#081420");
  gradient.addColorStop(1, "#050c14");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  const glow = context.createRadialGradient(
    width * 0.16,
    height * 0.12,
    10,
    width * 0.16,
    height * 0.12,
    width * 0.55
  );
  glow.addColorStop(0, "rgba(53, 212, 194, 0.18)");
  glow.addColorStop(1, "rgba(53, 212, 194, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  const warmGlow = context.createRadialGradient(
    width * 0.88,
    height * 0.22,
    20,
    width * 0.88,
    height * 0.22,
    width * 0.38
  );
  warmGlow.addColorStop(0, "rgba(255, 122, 89, 0.14)");
  warmGlow.addColorStop(1, "rgba(255, 122, 89, 0)");
  context.fillStyle = warmGlow;
  context.fillRect(0, 0, width, height);
}

function drawArenaBounds() {
  context.fillStyle = "#09111a";
  context.fillRect(0, 0, state.config.world.width, state.config.world.height);
  context.strokeStyle = "rgba(145, 197, 255, 0.18)";
  context.lineWidth = 18;
  context.strokeRect(0, 0, state.config.world.width, state.config.world.height);
}

function drawGrid() {
  const spacing = 120;
  const startX = Math.floor((state.camera.x - state.viewport.width / 2) / spacing) * spacing;
  const endX = Math.ceil((state.camera.x + state.viewport.width / 2) / spacing) * spacing;
  const startY = Math.floor((state.camera.y - state.viewport.height / 2) / spacing) * spacing;
  const endY = Math.ceil((state.camera.y + state.viewport.height / 2) / spacing) * spacing;

  context.strokeStyle = "rgba(255, 255, 255, 0.035)";
  context.lineWidth = 1;

  for (let x = startX; x <= endX; x += spacing) {
    context.beginPath();
    context.moveTo(x, startY);
    context.lineTo(x, endY);
    context.stroke();
  }

  for (let y = startY; y <= endY; y += spacing) {
    context.beginPath();
    context.moveTo(startX, y);
    context.lineTo(endX, y);
    context.stroke();
  }
}

function drawWalls() {
  for (const wall of state.config.world.walls) {
    context.fillStyle = "#12283a";
    roundRect(context, wall.x, wall.y, wall.w, wall.h, 26, true, false);

    context.strokeStyle = "rgba(186, 220, 255, 0.12)";
    context.lineWidth = 3;
    roundRect(context, wall.x, wall.y, wall.w, wall.h, 26, false, true);

    context.fillStyle = "rgba(255, 255, 255, 0.03)";
    roundRect(context, wall.x + 10, wall.y + 10, wall.w - 20, 16, 12, true, false);
  }
}

function drawPickups() {
  const time = performance.now() / 1000;
  for (const pickup of state.pickups) {
    if (!pickup.active) {
      continue;
    }

    const pulse = 1 + Math.sin(time * 4 + pickup.x * 0.01) * 0.08;
    context.save();
    context.translate(pickup.x, pickup.y);
    context.scale(pulse, pulse);

    if (pickup.type === "shotgun") {
      context.fillStyle = "rgba(244, 201, 93, 0.2)";
      context.beginPath();
      context.arc(0, 0, 30, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = "#322812";
      roundRect(context, -22, -16, 44, 32, 12, true, false);
      context.strokeStyle = "rgba(255, 227, 164, 0.58)";
      context.lineWidth = 2;
      roundRect(context, -22, -16, 44, 32, 12, false, true);

      context.save();
      context.rotate(-0.24 + Math.sin(time * 2.1) * 0.06);
      context.strokeStyle = "#f4c95d";
      context.lineWidth = 4;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(-10, -1);
      context.lineTo(10, -1);
      context.lineTo(18, -7);
      context.moveTo(-10, -1);
      context.lineTo(-15, 8);
      context.stroke();
      context.restore();

      context.fillStyle = "#f4c95d";
      context.font = "700 10px Trebuchet MS";
      context.textAlign = "center";
      context.fillText("x4", 0, 22);
    } else {
      context.fillStyle = "rgba(125, 226, 122, 0.18)";
      context.beginPath();
      context.arc(0, 0, 28, 0, Math.PI * 2);
      context.fill();

      context.rotate(time);
      context.fillStyle = "#7de27a";
      context.beginPath();
      context.moveTo(0, -16);
      context.lineTo(16, 0);
      context.lineTo(0, 16);
      context.lineTo(-16, 0);
      context.closePath();
      context.fill();

      context.fillStyle = "#0f3a18";
      context.fillRect(-5, -15, 10, 30);
      context.fillRect(-15, -5, 30, 10);
    }

    context.restore();
  }
}

function drawBullets() {
  for (const bullet of state.bullets) {
    context.save();
    context.shadowBlur = 20;
    context.shadowColor = bullet.color;
    context.fillStyle = bullet.color;
    context.beginPath();
    context.arc(bullet.x, bullet.y, bullet.radius || 6, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}

function drawPlayers() {
  const players = Array.from(state.players.values()).sort((a, b) => {
    if (a.id === state.selfId) {
      return 1;
    }
    if (b.id === state.selfId) {
      return -1;
    }
    return a.score - b.score;
  });

  for (const player of players) {
    const renderPlayer = state.renderPlayers.get(player.id);
    if (!renderPlayer) {
      continue;
    }

    const x = renderPlayer.x;
    const y = renderPlayer.y;
    const isSelf = player.id === state.selfId;

    if (player.alive) {
      context.save();
      context.translate(x, y);
      context.fillStyle = "rgba(4, 8, 14, 0.38)";
      context.beginPath();
      context.ellipse(0, 20, 24, 11, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }

    if (!player.alive) {
      drawDownedStickFigure(x, y, player.color);
      continue;
    }

    drawStickFigure(player, renderPlayer, isSelf);
    drawPlayerLabel(player, renderPlayer, isSelf);
  }
}

function drawPlayerLabel(player, renderPlayer, isSelf) {
  const x = renderPlayer.x;
  const y = renderPlayer.y - 66;
  const healthRatio = Math.max(0, Math.min(1, player.health / player.maxHealth));

  context.fillStyle = "rgba(5, 12, 18, 0.8)";
  roundRect(context, x - 50, y - 14, 100, 10, 8, true, false);

  context.fillStyle = healthRatio > 0.45 ? "#35d4c2" : "#ff7a59";
  roundRect(context, x - 50, y - 14, 100 * healthRatio, 10, 8, true, false);

  context.font = `700 ${isSelf ? 15 : 14}px Trebuchet MS`;
  context.textAlign = "center";
  context.fillStyle = isSelf ? "#fdf0b6" : "#eef7ff";
  context.fillText(player.name, x, y - 22);
}

function drawStickFigure(player, renderPlayer, isSelf) {
  const x = renderPlayer.x;
  const y = renderPlayer.y;
  const direction = {
    x: Math.cos(renderPlayer.angle),
    y: Math.sin(renderPlayer.angle),
  };
  const perpendicular = {
    x: -direction.y,
    y: direction.x,
  };
  const lineColor = player.color;
  const gunLength = player.weapon === "shotgun" ? 28 : 20;
  const gunThickness = player.weapon === "shotgun" ? 6 : 4;
  const gunHand = {
    x: direction.x * 16 + perpendicular.x * 3,
    y: -6 + direction.y * 16 + perpendicular.y * 3,
  };

  context.save();
  context.translate(x, y);

  if (isSelf) {
    context.strokeStyle = "rgba(253, 240, 182, 0.88)";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(0, 2, 24, 0, Math.PI * 2);
    context.stroke();
  }

  context.strokeStyle = lineColor;
  context.lineWidth = 5;
  context.lineCap = "round";
  context.lineJoin = "round";

  context.beginPath();
  context.moveTo(0, -12);
  context.lineTo(0, 14);
  context.moveTo(0, 14);
  context.lineTo(-12, 30);
  context.moveTo(0, 14);
  context.lineTo(12, 30);
  context.moveTo(0, -4);
  context.lineTo(-14, 8);
  context.moveTo(0, -4);
  context.lineTo(gunHand.x, gunHand.y);
  context.stroke();

  context.fillStyle = "#f6f1df";
  context.beginPath();
  context.arc(0, -24, 9, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = lineColor;
  context.beginPath();
  context.arc(0, -9, 4, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = isSelf ? "#fdf0b6" : "#d8e7f3";
  context.lineWidth = gunThickness;
  context.beginPath();
  context.moveTo(gunHand.x, gunHand.y);
  context.lineTo(
    gunHand.x + direction.x * gunLength,
    gunHand.y + direction.y * gunLength
  );
  context.stroke();

  if (player.weapon === "shotgun") {
    context.strokeStyle = "#8a6030";
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(gunHand.x - direction.x * 8, gunHand.y - direction.y * 8);
    context.lineTo(
      gunHand.x - direction.x * 16 + perpendicular.x * 3,
      gunHand.y - direction.y * 16 + perpendicular.y * 3
    );
    context.stroke();
  }

  context.restore();
}

function drawDownedStickFigure(x, y, color) {
  context.save();
  context.translate(x - 6, y + 14);
  context.rotate(0.72);
  context.strokeStyle = shadeColor(color, -10);
  context.lineWidth = 5;
  context.lineCap = "round";

  context.beginPath();
  context.moveTo(0, -12);
  context.lineTo(0, 12);
  context.moveTo(0, 0);
  context.lineTo(-14, 10);
  context.moveTo(0, 0);
  context.lineTo(14, 8);
  context.moveTo(0, 12);
  context.lineTo(-12, 26);
  context.moveTo(0, 12);
  context.lineTo(12, 26);
  context.stroke();

  context.fillStyle = "rgba(246, 241, 223, 0.85)";
  context.beginPath();
  context.arc(0, -22, 9, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawParticles() {
  for (const particle of state.particles) {
    const alpha = Math.max(0, particle.life / particle.maxLife);
    context.save();
    context.globalAlpha = alpha;
    context.fillStyle = particle.color;
    context.beginPath();
    context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}

function drawReticle() {
  const self = state.renderPlayers.get(state.selfId);
  const player = state.players.get(state.selfId);
  if (!self || !player || !player.alive) {
    return;
  }

  const aim = getAimVector();
  const reticleX = state.viewport.width / 2 + aim.x * 84;
  const reticleY = state.viewport.height / 2 + aim.y * 84;

  context.save();
  context.strokeStyle = "rgba(253, 240, 182, 0.9)";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(reticleX, reticleY, 16, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.moveTo(reticleX - 24, reticleY);
  context.lineTo(reticleX - 10, reticleY);
  context.moveTo(reticleX + 10, reticleY);
  context.lineTo(reticleX + 24, reticleY);
  context.moveTo(reticleX, reticleY - 24);
  context.lineTo(reticleX, reticleY - 10);
  context.moveTo(reticleX, reticleY + 10);
  context.lineTo(reticleX, reticleY + 24);
  context.stroke();
  context.restore();
}

function drawTouchControls() {
  if (!state.touchCapable) {
    return;
  }

  const anchors = {
    left: { x: Math.min(120, state.viewport.width * 0.22), y: state.viewport.height - 110 },
    right: { x: state.viewport.width - Math.min(120, state.viewport.width * 0.22), y: state.viewport.height - 110 },
  };

  for (const side of ["left", "right"]) {
    const stick = state.controls.sticks[side];
    const anchor = anchors[side];
    const baseX = stick.active ? stick.baseX : anchor.x;
    const baseY = stick.active ? stick.baseY : anchor.y;
    const knobX = stick.active ? stick.knobX : anchor.x;
    const knobY = stick.active ? stick.knobY : anchor.y;
    const alpha = stick.active ? 0.32 : MOBILE_HINT_ALPHA;

    context.save();
    context.globalAlpha = alpha;
    context.fillStyle = side === "left" ? "#35d4c2" : "#ff7a59";
    context.strokeStyle = "rgba(255, 255, 255, 0.26)";
    context.lineWidth = 2;

    context.beginPath();
    context.arc(baseX, baseY, JOYSTICK_RADIUS, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    context.globalAlpha = stick.active ? 0.9 : 0.2;
    context.fillStyle = "#eef7ff";
    context.beginPath();
    context.arc(knobX, knobY, 26, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}

function drawMinimap() {
  if (!state.joined || !state.players.size) {
    return;
  }

  const world = state.config.world;
  if (!world.width || !world.height) {
    return;
  }

  const width = Math.min(
    MINIMAP_MAX_WIDTH,
    Math.max(MINIMAP_MIN_WIDTH, state.viewport.width * 0.16)
  );
  const height = width * (world.height / world.width);
  const panelX = MINIMAP_PADDING;
  const panelY = MINIMAP_PADDING;
  const panelRadius = 18;
  const innerX = panelX + MINIMAP_INNER_PADDING;
  const innerY = panelY + MINIMAP_INNER_PADDING + 12;
  const innerWidth = width - MINIMAP_INNER_PADDING * 2;
  const innerHeight = height - MINIMAP_INNER_PADDING * 2 - 12;

  context.save();
  context.shadowBlur = 20;
  context.shadowColor = "rgba(0, 0, 0, 0.24)";
  context.fillStyle = "rgba(7, 19, 31, 0.84)";
  roundRect(context, panelX, panelY, width, height, panelRadius, true, false);
  context.restore();

  context.save();
  context.fillStyle = "rgba(238, 247, 255, 0.72)";
  context.font = "700 10px Trebuchet MS";
  context.textAlign = "left";
  context.fillText("MAP", panelX + MINIMAP_INNER_PADDING, panelY + 18);

  roundRect(context, innerX, innerY, innerWidth, innerHeight, 12, false, false);
  context.clip();

  context.fillStyle = "#09111a";
  context.fillRect(innerX, innerY, innerWidth, innerHeight);

  context.strokeStyle = "rgba(145, 197, 255, 0.12)";
  context.lineWidth = 1;
  context.strokeRect(innerX, innerY, innerWidth, innerHeight);

  for (const wall of world.walls) {
    const wallX = innerX + (wall.x / world.width) * innerWidth;
    const wallY = innerY + (wall.y / world.height) * innerHeight;
    const wallWidth = (wall.w / world.width) * innerWidth;
    const wallHeight = (wall.h / world.height) * innerHeight;

    context.fillStyle = "#183247";
    roundRect(
      context,
      wallX,
      wallY,
      wallWidth,
      wallHeight,
      Math.min(6, wallWidth / 2, wallHeight / 2),
      true,
      false
    );
  }

  const cameraWidth = Math.min(innerWidth, (state.viewport.width / world.width) * innerWidth);
  const cameraHeight = Math.min(
    innerHeight,
    (state.viewport.height / world.height) * innerHeight
  );
  const cameraX = innerX + ((state.camera.x - state.viewport.width / 2) / world.width) * innerWidth;
  const cameraY =
    innerY + ((state.camera.y - state.viewport.height / 2) / world.height) * innerHeight;

  context.strokeStyle = "rgba(253, 240, 182, 0.42)";
  context.lineWidth = 1.5;
  roundRect(
    context,
    clamp(cameraX, innerX, innerX + innerWidth - cameraWidth),
    clamp(cameraY, innerY, innerY + innerHeight - cameraHeight),
    cameraWidth,
    cameraHeight,
    6,
    false,
    true
  );

  for (const player of state.players.values()) {
    const renderPlayer = state.renderPlayers.get(player.id) || player;
    const x = innerX + (renderPlayer.x / world.width) * innerWidth;
    const y = innerY + (renderPlayer.y / world.height) * innerHeight;
    const radius = player.id === state.selfId ? 4 : 3;

    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = player.alive ? player.color : "rgba(156, 180, 201, 0.45)";
    context.fill();

    if (player.id === state.selfId) {
      context.strokeStyle = "#fdf0b6";
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(x, y, radius + 2.5, 0, Math.PI * 2);
      context.stroke();
    }
  }

  context.restore();

  context.save();
  context.strokeStyle = "rgba(145, 197, 255, 0.24)";
  context.lineWidth = 1;
  roundRect(context, panelX, panelY, width, height, panelRadius, false, true);
  context.restore();
}

function updateHud() {
  const player = state.players.get(state.selfId);
  if (!player) {
    return;
  }

  scoreValue.textContent = String(player.score);
  kdValue.textContent = `${player.score} K / ${player.deaths} D`;
  weaponValue.textContent =
    player.weapon === "shotgun"
      ? `Shotgun | ${player.ammo || 0} shells`
      : "Pistol | slow fire";

  const standings = Array.from(state.players.values())
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.deaths - b.deaths;
    })
    .slice(0, 6);

  leaderboard.innerHTML = standings
    .map((entry) => {
      const className =
        entry.id === state.selfId
          ? "leaderboard__row leaderboard__row--self"
          : "leaderboard__row";
      return `
        <div class="${className}">
          <div>
            <div>${escapeHtml(entry.name)}</div>
            <div class="leaderboard__meta">${entry.deaths} deaths${entry.streak > 1 ? ` | ${entry.streak} streak` : ""}</div>
          </div>
          <strong>${entry.score}</strong>
        </div>
      `;
    })
    .join("");
}

function updateRespawnOverlay() {
  const player = state.players.get(state.selfId);
  if (!player || player.alive) {
    respawnOverlay.classList.add("hidden");
    return;
  }

  const remaining = Math.max(
    0,
    Math.ceil((player.respawnAt - (Date.now() + state.serverOffset)) / 1000)
  );
  respawnOverlay.classList.remove("hidden");
  respawnOverlay.textContent = `Respawning in ${remaining || 1}...`;
}

function spawnMuzzleFlash(player) {
  const direction = {
    x: Math.cos(player.angle),
    y: Math.sin(player.angle),
  };
  const reach = player.weapon === "shotgun" ? 46 : 38;
  const muzzleX = player.x + direction.x * reach;
  const muzzleY = player.y + direction.y * reach - 6;
  spawnBurst(
    muzzleX,
    muzzleY,
    player.weapon === "shotgun" ? "#ffd47e" : "#fff0ba",
    player.weapon === "shotgun" ? 12 : 6,
    player.weapon === "shotgun" ? 240 : 150,
    player.weapon === "shotgun" ? 0.24 : 0.18
  );
}

function spawnBurst(x, y, color, count, speed, life) {
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const magnitude = speed * (0.35 + Math.random() * 0.65);
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * magnitude,
      vy: Math.sin(angle) * magnitude,
      life,
      maxLife: life,
      size: 2 + Math.random() * 3.4,
      color,
    });
  }
}

function showAnnouncement(text) {
  announcement.textContent = text;
  announcement.classList.remove("hidden");

  clearTimeout(showAnnouncement.timeoutId);
  showAnnouncement.timeoutId = setTimeout(() => {
    announcement.classList.add("hidden");
  }, 2600);
}

function addFeedItem(text, type) {
  const item = document.createElement("div");
  item.className = `killfeed__item ${type ? `killfeed__item--${type}` : ""}`;
  item.textContent = text;
  killfeed.prepend(item);

  while (killfeed.children.length > 5) {
    killfeed.removeChild(killfeed.lastChild);
  }

  setTimeout(() => {
    item.remove();
  }, 3600);
}

function setStatus(label, tone) {
  statusPill.textContent = label;
  statusPill.className = "pill";

  if (tone === "warning") {
    statusPill.classList.add("pill--warning");
  }
  if (tone === "danger") {
    statusPill.classList.add("pill--danger");
  }
}

function setHudOpen(open) {
  state.hudOpen = open;
  hud.classList.toggle("hud--open", open);
  hudDrawer.setAttribute("aria-hidden", String(!open));
  hudToggle.setAttribute("aria-expanded", String(open));
  hudToggle.textContent = open ? "Close" : "HUD";
}

function updateNetworkUi(urls) {
  state.config.networkUrls = Array.isArray(urls) ? urls : [];

  if (!state.config.networkUrls.length) {
    networkHint.textContent = "Open from this computer now. If phones do not see it yet, keep Wi-Fi on and check the server console.";
    shareBox.textContent = "Local network address will appear here once the server detects a Wi-Fi IPv4 address.";
    return;
  }

  const primary = state.config.networkUrls[0];
  networkHint.textContent = `Share this Wi-Fi address: ${primary}`;
  shareBox.innerHTML = state.config.networkUrls
    .map((url) => `<div>${escapeHtml(url)}</div>`)
    .join("");
}

function resizeCanvas() {
  state.viewport.width = window.innerWidth;
  state.viewport.height = window.innerHeight;
  state.viewport.dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = state.viewport.width * state.viewport.dpr;
  canvas.height = state.viewport.height * state.viewport.dpr;
  canvas.style.width = `${state.viewport.width}px`;
  canvas.style.height = `${state.viewport.height}px`;

  context.setTransform(state.viewport.dpr, 0, 0, state.viewport.dpr, 0, 0);
  context.imageSmoothingEnabled = true;
}

function makeStick() {
  return {
    active: false,
    pointerId: null,
    baseX: 0,
    baseY: 0,
    knobX: 0,
    knobY: 0,
    valueX: 0,
    valueY: 0,
    strength: 0,
  };
}

function resetStick(stick) {
  stick.active = false;
  stick.pointerId = null;
  stick.baseX = 0;
  stick.baseY = 0;
  stick.knobX = 0;
  stick.knobY = 0;
  stick.valueX = 0;
  stick.valueY = 0;
  stick.strength = 0;
}

function normalize(x, y) {
  const length = Math.hypot(x, y);
  if (!length) {
    return { x: 0, y: 0, length: 0 };
  }

  return {
    x: x / length,
    y: y / length,
    length,
  };
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
  const corner = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + corner, y);
  ctx.arcTo(x + width, y, x + width, y + height, corner);
  ctx.arcTo(x + width, y + height, x, y + height, corner);
  ctx.arcTo(x, y + height, x, y, corner);
  ctx.arcTo(x, y, x + width, y, corner);
  ctx.closePath();

  if (fill) {
    ctx.fill();
  }
  if (stroke) {
    ctx.stroke();
  }
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function lerpAngle(start, end, amount) {
  let delta = end - start;
  while (delta > Math.PI) {
    delta -= Math.PI * 2;
  }
  while (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return start + delta * amount;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeName(value) {
  return String(value || "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .slice(0, 16);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function shadeColor(hex, amount) {
  const color = hex.replace("#", "");
  const number = parseInt(color, 16);
  const red = Math.max(0, Math.min(255, (number >> 16) + amount));
  const green = Math.max(0, Math.min(255, ((number >> 8) & 0xff) + amount));
  const blue = Math.max(0, Math.min(255, (number & 0xff) + amount));
  return `rgb(${red}, ${green}, ${blue})`;
}

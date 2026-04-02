const express = require("express");
const http = require("http");
const os = require("os");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";

const WORLD = {
  width: 2400,
  height: 1600,
};

const PLAYER_RADIUS = 26;
const PLAYER_SPEED = 330;
const PLAYER_MAX_HEALTH = 100;
const PLAYER_RESPAWN_MS = 2600;

const PISTOL_FIRE_COOLDOWN_MS = 380;
const PISTOL_BULLET_SPEED = 930;
const PISTOL_BULLET_RADIUS = 6;
const PISTOL_BULLET_DAMAGE = 24;
const PISTOL_BULLET_LIFETIME = 1.25;

const SHOTGUN_FIRE_COOLDOWN_MS = 980;
const SHOTGUN_PELLET_COUNT = 6;
const SHOTGUN_SHELL_CAPACITY = 4;
const SHOTGUN_SPREAD = 0.24;
const SHOTGUN_BULLET_SPEED = 860;
const SHOTGUN_BULLET_RADIUS = 5;
const SHOTGUN_BULLET_DAMAGE = 13;
const SHOTGUN_BULLET_LIFETIME = 0.62;

const HEALTH_PICKUP_AMOUNT = 34;
const HEALTH_PICKUP_RESPAWN_MS = 5000;
const SHOTGUN_PICKUP_RESPAWN_MS = 30000;
const PICKUP_RADIUS = 18;

const TICK_RATE = 60;
const SNAPSHOT_RATE = 30;

const WALLS = [
  { x: 280, y: 210, w: 230, h: 130 },
  { x: 1860, y: 220, w: 250, h: 130 },
  { x: 250, y: 1220, w: 260, h: 120 },
  { x: 1890, y: 1230, w: 230, h: 120 },
  { x: 920, y: 220, w: 560, h: 90 },
  { x: 880, y: 1280, w: 640, h: 90 },
  { x: 660, y: 560, w: 170, h: 460 },
  { x: 1570, y: 580, w: 170, h: 450 },
  { x: 1060, y: 640, w: 280, h: 320 },
];

const SPAWN_POINTS = [
  { x: 180, y: 160 },
  { x: 2240, y: 160 },
  { x: 180, y: 1440 },
  { x: 2240, y: 1440 },
  { x: 1220, y: 130 },
  { x: 1220, y: 1470 },
  { x: 160, y: 800 },
  { x: 2240, y: 800 },
];

const HEALTH_PICKUP_SPAWNS = [
  { x: 640, y: 360 },
  { x: 1770, y: 360 },
  { x: 520, y: 1110 },
  { x: 1880, y: 1110 },
  { x: 1210, y: 470 },
  { x: 1210, y: 1130 },
];

const SHOTGUN_PICKUP_SPAWNS = [
  { x: 350, y: 800 },
  { x: 2050, y: 800 },
  { x: 1210, y: 240 },
  { x: 1210, y: 1360 },
];

const PLAYER_COLORS = [
  "#ff7a59",
  "#35d4c2",
  "#f4c95d",
  "#8dc6ff",
  "#ff8fab",
  "#7de27a",
  "#ffad66",
  "#a58dff",
];

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const players = new Map();
let bullets = [];
const pickups = [
  ...HEALTH_PICKUP_SPAWNS.map((spawn, index) => ({
    id: `health-${index + 1}`,
    x: spawn.x,
    y: spawn.y,
    active: true,
    respawnAt: 0,
    respawnDelay: HEALTH_PICKUP_RESPAWN_MS,
    type: "health",
  })),
  ...SHOTGUN_PICKUP_SPAWNS.map((spawn, index) => ({
    id: `shotgun-${index + 1}`,
    x: spawn.x,
    y: spawn.y,
    active: true,
    respawnAt: 0,
    respawnDelay: SHOTGUN_PICKUP_RESPAWN_MS,
    type: "shotgun",
  })),
];

let nextBulletId = 1;
let nextEventId = 1;
const transientEvents = [];

app.use(express.static("public"));

app.get("/health", (_req, res) => {
  res.json({ ok: true, players: players.size });
});

app.get("/config.json", (_req, res) => {
  res.json({
    port: PORT,
    world: {
      ...WORLD,
      walls: WALLS,
    },
    rules: {
      respawnMs: PLAYER_RESPAWN_MS,
      pickupHeal: HEALTH_PICKUP_AMOUNT,
      shotgunShells: SHOTGUN_SHELL_CAPACITY,
      shotgunRespawnMs: SHOTGUN_PICKUP_RESPAWN_MS,
    },
    networkUrls: getNetworkUrls(),
  });
});

io.on("connection", (socket) => {
  socket.emit("welcome", {
    networkUrls: getNetworkUrls(),
  });

  socket.on("join", (payload) => {
    const safeName =
      sanitizeName(payload && payload.name) || `Player ${players.size + 1}`;

    let player = players.get(socket.id);
    if (!player) {
      player = createPlayer(socket.id, safeName);
      players.set(socket.id, player);
      transientEvents.push({
        id: nextEventId++,
        type: "system",
        message: `${safeName} entered the arena`,
      });
    } else {
      player.name = safeName;
    }

    socket.emit("init", {
      selfId: socket.id,
      world: {
        ...WORLD,
        walls: WALLS,
      },
      rules: {
        respawnMs: PLAYER_RESPAWN_MS,
        shotgunShells: SHOTGUN_SHELL_CAPACITY,
        shotgunRespawnMs: SHOTGUN_PICKUP_RESPAWN_MS,
      },
      networkUrls: getNetworkUrls(),
    });
  });

  socket.on("input", (payload) => {
    const player = players.get(socket.id);
    if (!player) {
      return;
    }

    const move = normalizeVector(
      clampNumber(payload && payload.moveX, -1, 1),
      clampNumber(payload && payload.moveY, -1, 1)
    );

    const aim = normalizeVector(
      clampNumber(payload && payload.aimX, -1, 1, player.aimX),
      clampNumber(payload && payload.aimY, -1, 1, player.aimY)
    );

    player.input.moveX = move.x;
    player.input.moveY = move.y;
    player.input.aimX = aim.length > 0 ? aim.x : player.aimX;
    player.input.aimY = aim.length > 0 ? aim.y : player.aimY;
    player.input.firing = Boolean(payload && payload.firing);
  });

  socket.on("disconnect", () => {
    const player = players.get(socket.id);
    if (!player) {
      return;
    }

    transientEvents.push({
      id: nextEventId++,
      type: "system",
      message: `${player.name} left the arena`,
    });

    players.delete(socket.id);
    bullets = bullets.filter((bullet) => bullet.ownerId !== socket.id);
  });
});

let previousTick = Date.now();

setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - previousTick) / 1000, 0.05);
  previousTick = now;
  tickGame(dt, now);
}, 1000 / TICK_RATE);

setInterval(() => {
  const events = transientEvents.splice(0, transientEvents.length);
  io.emit("snapshot", {
    serverTime: Date.now(),
    players: Array.from(players.values()).map(serializePlayer),
    bullets: bullets.map(serializeBullet),
    pickups: pickups.map(serializePickup),
    events,
  });
}, 1000 / SNAPSHOT_RATE);

server.listen(PORT, HOST, () => {
  const urls = getNetworkUrls();
  console.log("LAN shooter server is running.");
  console.log(`Local: http://localhost:${PORT}`);

  if (urls.length) {
    for (const url of urls) {
      console.log(`Network: ${url}`);
    }
  } else {
    console.log("No LAN IPv4 address detected yet.");
  }
});

function tickGame(dt, now) {
  for (const player of players.values()) {
    if (!player.alive) {
      if (now >= player.respawnAt) {
        respawnPlayer(player);
      }
      continue;
    }

    updatePlayer(player, dt, now);
  }

  updateBullets(dt, now);
  updatePickups(now);
}

function updatePlayer(player, dt, now) {
  const moveX = player.input.moveX * PLAYER_SPEED * dt;
  const moveY = player.input.moveY * PLAYER_SPEED * dt;

  if (moveX !== 0) {
    movePlayerAxis(player, moveX, 0);
  }

  if (moveY !== 0) {
    movePlayerAxis(player, 0, moveY);
  }

  const aim = normalizeVector(player.input.aimX, player.input.aimY);
  if (aim.length > 0.01) {
    player.aimX = aim.x;
    player.aimY = aim.y;
    player.angle = Math.atan2(aim.y, aim.x);
  }

  if (
    player.input.firing &&
    aim.length > 0.24 &&
    now - player.lastShotAt >= getFireCooldown(player)
  ) {
    fireWeapon(player, now);
  }
}

function updateBullets(dt, now) {
  for (let index = bullets.length - 1; index >= 0; index -= 1) {
    const bullet = bullets[index];
    bullet.life -= dt;

    if (bullet.life <= 0) {
      bullets.splice(index, 1);
      continue;
    }

    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;

    if (
      bullet.x < -40 ||
      bullet.x > WORLD.width + 40 ||
      bullet.y < -40 ||
      bullet.y > WORLD.height + 40
    ) {
      bullets.splice(index, 1);
      continue;
    }

    if (
      WALLS.some((wall) =>
        circleIntersectsRect(bullet.x, bullet.y, bullet.radius, wall)
      )
    ) {
      transientEvents.push({
        id: nextEventId++,
        type: "impact",
        x: bullet.x,
        y: bullet.y,
        color: bullet.color,
      });
      bullets.splice(index, 1);
      continue;
    }

    let hitPlayer = false;

    for (const player of players.values()) {
      if (!player.alive || player.id === bullet.ownerId) {
        continue;
      }

      const dx = player.x - bullet.x;
      const dy = player.y - bullet.y;
      const hitDistance = PLAYER_RADIUS + bullet.radius;

      if (dx * dx + dy * dy <= hitDistance * hitDistance) {
        player.health = Math.max(0, player.health - bullet.damage);

        transientEvents.push({
          id: nextEventId++,
          type: "impact",
          x: bullet.x,
          y: bullet.y,
          color: player.color,
        });

        if (player.health <= 0) {
          eliminatePlayer(player, bullet.ownerId, now);
        }

        hitPlayer = true;
        break;
      }
    }

    if (hitPlayer) {
      bullets.splice(index, 1);
    }
  }
}

function updatePickups(now) {
  for (const pickup of pickups) {
    if (!pickup.active) {
      if (now >= pickup.respawnAt) {
        pickup.active = true;
      }
      continue;
    }

    for (const player of players.values()) {
      if (!player.alive) {
        continue;
      }

      const dx = player.x - pickup.x;
      const dy = player.y - pickup.y;
      const pickupDistance = PLAYER_RADIUS + PICKUP_RADIUS;

      if (dx * dx + dy * dy <= pickupDistance * pickupDistance) {
        if (pickup.type === "health") {
          if (player.health >= PLAYER_MAX_HEALTH) {
            continue;
          }

          player.health = Math.min(
            PLAYER_MAX_HEALTH,
            player.health + HEALTH_PICKUP_AMOUNT
          );
        } else if (pickup.type === "shotgun") {
          if (
            player.weapon === "shotgun" &&
            player.ammo >= SHOTGUN_SHELL_CAPACITY
          ) {
            continue;
          }

          player.weapon = "shotgun";
          player.ammo = SHOTGUN_SHELL_CAPACITY;
        }

        pickup.active = false;
        pickup.respawnAt = now + pickup.respawnDelay;

        transientEvents.push({
          id: nextEventId++,
          type: "pickup",
          x: pickup.x,
          y: pickup.y,
          color: player.color,
          playerName: player.name,
          pickupType: pickup.type,
        });
        break;
      }
    }
  }
}

function movePlayerAxis(player, dx, dy) {
  player.x = clamp(player.x + dx, PLAYER_RADIUS, WORLD.width - PLAYER_RADIUS);
  player.y = clamp(player.y + dy, PLAYER_RADIUS, WORLD.height - PLAYER_RADIUS);

  for (const wall of WALLS) {
    if (!circleIntersectsRect(player.x, player.y, PLAYER_RADIUS, wall)) {
      continue;
    }

    if (dx > 0) {
      player.x = wall.x - PLAYER_RADIUS;
    } else if (dx < 0) {
      player.x = wall.x + wall.w + PLAYER_RADIUS;
    }

    if (dy > 0) {
      player.y = wall.y - PLAYER_RADIUS;
    } else if (dy < 0) {
      player.y = wall.y + wall.h + PLAYER_RADIUS;
    }
  }

  player.x = clamp(player.x, PLAYER_RADIUS, WORLD.width - PLAYER_RADIUS);
  player.y = clamp(player.y, PLAYER_RADIUS, WORLD.height - PLAYER_RADIUS);
}

function fireWeapon(player, now) {
  if (player.weapon === "shotgun" && player.ammo <= 0) {
    equipPistol(player);
  }

  const aim = normalizeVector(player.aimX, player.aimY);
  const offset = PLAYER_RADIUS + 12;
  const spawnX = player.x + aim.x * offset;
  const spawnY = player.y + aim.y * offset;

  if (player.weapon === "shotgun") {
    const baseAngle = Math.atan2(aim.y, aim.x);

    for (let pellet = 0; pellet < SHOTGUN_PELLET_COUNT; pellet += 1) {
      const spreadOffset =
        (Math.random() - 0.5) * SHOTGUN_SPREAD +
        (pellet - (SHOTGUN_PELLET_COUNT - 1) / 2) * 0.018;
      const pelletAngle = baseAngle + spreadOffset;

      spawnProjectile({
        ownerId: player.id,
        x: spawnX,
        y: spawnY,
        angle: pelletAngle,
        speed: SHOTGUN_BULLET_SPEED,
        radius: SHOTGUN_BULLET_RADIUS,
        damage: SHOTGUN_BULLET_DAMAGE,
        life: SHOTGUN_BULLET_LIFETIME,
        color: player.color,
      });
    }

    player.ammo -= 1;
    if (player.ammo <= 0) {
      equipPistol(player);
    }
  } else {
    spawnProjectile({
      ownerId: player.id,
      x: spawnX,
      y: spawnY,
      angle: Math.atan2(aim.y, aim.x),
      speed: PISTOL_BULLET_SPEED,
      radius: PISTOL_BULLET_RADIUS,
      damage: PISTOL_BULLET_DAMAGE,
      life: PISTOL_BULLET_LIFETIME,
      color: player.color,
    });
  }

  player.lastShotAt = now;
  player.shotSeq += 1;
}

function spawnProjectile(config) {
  bullets.push({
    id: nextBulletId++,
    ownerId: config.ownerId,
    x: config.x,
    y: config.y,
    vx: Math.cos(config.angle) * config.speed,
    vy: Math.sin(config.angle) * config.speed,
    life: config.life,
    color: config.color,
    radius: config.radius,
    damage: config.damage,
  });
}

function eliminatePlayer(victim, attackerId, now) {
  victim.alive = false;
  victim.health = 0;
  victim.deaths += 1;
  victim.streak = 0;
  victim.respawnAt = now + PLAYER_RESPAWN_MS;

  const attacker = players.get(attackerId);
  if (attacker && attacker.id !== victim.id) {
    attacker.score += 1;
    attacker.streak += 1;
  }

  transientEvents.push({
    id: nextEventId++,
    type: "elimination",
    x: victim.x,
    y: victim.y,
    attackerName:
      attacker && attacker.id !== victim.id ? attacker.name : "Arena",
    victimName: victim.name,
  });
}

function respawnPlayer(player) {
  const spawn = pickBestSpawnPoint(player.id);
  player.x = spawn.x;
  player.y = spawn.y;
  player.health = PLAYER_MAX_HEALTH;
  player.alive = true;
  player.respawnAt = 0;
  player.aimX = 1;
  player.aimY = 0;
  player.input.aimX = 1;
  player.input.aimY = 0;
  player.input.firing = false;
  player.angle = 0;
  equipPistol(player);
}

function createPlayer(id, name) {
  const spawn = pickBestSpawnPoint(id);
  return {
    id,
    name,
    x: spawn.x,
    y: spawn.y,
    color: PLAYER_COLORS[players.size % PLAYER_COLORS.length],
    health: PLAYER_MAX_HEALTH,
    maxHealth: PLAYER_MAX_HEALTH,
    alive: true,
    score: 0,
    deaths: 0,
    streak: 0,
    angle: 0,
    aimX: 1,
    aimY: 0,
    respawnAt: 0,
    lastShotAt: 0,
    shotSeq: 0,
    weapon: "pistol",
    ammo: null,
    input: {
      moveX: 0,
      moveY: 0,
      aimX: 1,
      aimY: 0,
      firing: false,
    },
  };
}

function pickBestSpawnPoint(excludedId) {
  const livePlayers = Array.from(players.values()).filter(
    (player) => player.alive && player.id !== excludedId
  );

  if (!livePlayers.length) {
    return { ...SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)] };
  }

  let bestSpawn = SPAWN_POINTS[0];
  let bestScore = -Infinity;

  for (const spawn of SPAWN_POINTS) {
    let minDistanceSq = Infinity;

    for (const player of livePlayers) {
      const dx = spawn.x - player.x;
      const dy = spawn.y - player.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < minDistanceSq) {
        minDistanceSq = distanceSq;
      }
    }

    const score = minDistanceSq + Math.random() * 5000;
    if (score > bestScore) {
      bestScore = score;
      bestSpawn = spawn;
    }
  }

  return { ...bestSpawn };
}

function getFireCooldown(player) {
  return player.weapon === "shotgun"
    ? SHOTGUN_FIRE_COOLDOWN_MS
    : PISTOL_FIRE_COOLDOWN_MS;
}

function equipPistol(player) {
  player.weapon = "pistol";
  player.ammo = null;
}

function serializePlayer(player) {
  return {
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    angle: player.angle,
    color: player.color,
    health: player.health,
    maxHealth: player.maxHealth,
    score: player.score,
    deaths: player.deaths,
    streak: player.streak,
    alive: player.alive,
    respawnAt: player.respawnAt,
    shotSeq: player.shotSeq,
    weapon: player.weapon,
    ammo: player.ammo,
  };
}

function serializeBullet(bullet) {
  return {
    id: bullet.id,
    x: bullet.x,
    y: bullet.y,
    color: bullet.color,
    radius: bullet.radius,
  };
}

function serializePickup(pickup) {
  return {
    id: pickup.id,
    x: pickup.x,
    y: pickup.y,
    active: pickup.active,
    type: pickup.type,
  };
}

function sanitizeName(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/[^\w\s-]/g, "")
    .trim()
    .slice(0, 16);
}

function getNetworkUrls() {
  const urls = [];
  const interfaces = os.networkInterfaces();

  for (const [name, details] of Object.entries(interfaces)) {
    const lowerName = name.toLowerCase();
    if (
      lowerName.includes("wsl") ||
      lowerName.includes("vethernet") ||
      lowerName.includes("virtual") ||
      lowerName.includes("hyper-v") ||
      lowerName.includes("loopback")
    ) {
      continue;
    }

    for (const address of details || []) {
      if (address.family === "IPv4" && !address.internal) {
        urls.push(`http://${address.address}:${PORT}`);
      }
    }
  }

  return Array.from(new Set(urls)).sort();
}

function normalizeVector(x, y) {
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

function circleIntersectsRect(circleX, circleY, radius, rect) {
  const nearestX = clamp(circleX, rect.x, rect.x + rect.w);
  const nearestY = clamp(circleY, rect.y, rect.y + rect.h);
  const dx = circleX - nearestX;
  const dy = circleY - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampNumber(value, min, max, fallback = 0) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : fallback;
  return clamp(numeric, min, max);
}

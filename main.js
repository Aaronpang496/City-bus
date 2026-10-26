import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ================= STATE =================
const state = {
  money: 200, rep: 50, fuel: 100, cond: 100,
  day: 1, maxDays: 20,
  speed: 0, maxSpeed: 80,
  steer: 0,
  paused: true,           // frozen during intro
  gameOver: false,
  passengers: 0,
  cockpit: false,
};

// ================= INTRO / CINEMATIC =================
const intro = {
  active: true,
  startTime: performance.now(),
  duration: 4500,
  transition: 0,
  transitioning: false,
};

// ================= RENDERER =================
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 120, 320);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 600);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

scene.add(new THREE.HemisphereLight(0xffffff, 0x556655, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.3);
sun.position.set(60, 100, 40);
scene.add(sun);

// ================= CITY GRID =================
const GRID = 14;
const TILE = 30;
const HALF = (GRID * TILE) / 2;

const map = [];
for (let r = 0; r < GRID; r++) {
  map[r] = [];
  for (let c = 0; c < GRID; c++) {
    const isRoad = (r % 4 === 0) || (c % 4 === 0) || r === GRID - 1 || c === GRID - 1;
    map[r][c] = isRoad ? 0 : (Math.random() < 0.25 ? 2 : 1);
  }
}

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(GRID * TILE + 200, GRID * TILE + 200),
  new THREE.MeshStandardMaterial({ color: 0x3a7d44 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const roadMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a });
const lineMat = new THREE.MeshStandardMaterial({ color: 0xffff00 });

function tileToWorld(r, c) {
  return { x: -HALF + c * TILE + TILE / 2, z: -HALF + r * TILE + TILE / 2 };
}

// Window texture
const windowTex = (() => {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#222';
  ctx.fillRect(0, 0, 64, 128);
  for (let y = 8; y < 120; y += 16) {
    for (let x = 6; x < 60; x += 14) {
      ctx.fillStyle = Math.random() < 0.5 ? '#ffe9a8' : '#5aa0d8';
      ctx.fillRect(x, y, 8, 10);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();

const buildingMatCache = {};
function getBuildingMat(hue) {
  const key = Math.round(hue * 10);
  if (buildingMatCache[key]) return buildingMatCache[key];
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(hue, 0.35, 0.55),
  });
  buildingMatCache[key] = m;
  return m;
}

const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4423 });
const treeLeafMat = new THREE.MeshStandardMaterial({ color: 0x2f7d32 });

function addTree(x, z) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 3, 6), treeTrunkMat);
  trunk.position.y = 1.5;
  g.add(trunk);
  const leaves = new THREE.Mesh(new THREE.SphereGeometry(2, 8, 6), treeLeafMat);
  leaves.position.y = 4.2;
  g.add(leaves);
  g.position.set(x, 0, z);
  scene.add(g);
}

for (let r = 0; r < GRID; r++) {
  for (let c = 0; c < GRID; c++) {
    const { x, z } = tileToWorld(r, c);
    const type = map[r][c];

    if (type === 0) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(TILE, TILE), roadMat);
      road.rotation.x = -Math.PI / 2;
      road.position.set(x, 0.02, z);
      scene.add(road);

      const horizontal = (r % 4 === 0);
      for (let i = -TILE / 2 + 4; i < TILE / 2; i += 8) {
        const dash = new THREE.Mesh(
          new THREE.PlaneGeometry(horizontal ? 4 : 0.5, horizontal ? 0.5 : 4),
          lineMat
        );
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(x + (horizontal ? i : 0), 0.03, z + (horizontal ? 0 : i));
        scene.add(dash);
      }
    } else if (type === 1) {
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const w = 6 + Math.random() * 8;
        const d = 6 + Math.random() * 8;
        const h = 10 + Math.random() * 45;
        const hue = Math.random() * 0.15 + 0.55;
        const mat = getBuildingMat(hue).clone();
        mat.map = windowTex.clone();
        mat.map.repeat.set(Math.max(1, Math.floor(w / 4)), Math.max(1, Math.floor(h / 6)));
        mat.map.needsUpdate = true;
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        const ox = (Math.random() - 0.5) * (TILE - w - 2);
        const oz = (Math.random() - 0.5) * (TILE - d - 2);
        b.position.set(x + ox, h / 2, z + oz);
        scene.add(b);
      }
    } else {
      for (let i = 0; i < 4; i++) {
        addTree(
          x + (Math.random() - 0.5) * (TILE - 4),
          z + (Math.random() - 0.5) * (TILE - 4)
        );
      }
    }
  }
}

// ================= BUS =================
const bus = new THREE.Group();
// FIX: Spawn on the bottom road instead of center park
bus.position.set(-HALF + 15, 0, -HALF + 15); 
bus.rotation.y = Math.PI / 2;
scene.add(bus);
let busReady = false;

const loader = new GLTFLoader();
loader.load('assets/bus.glb', (gltf) => {
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;
  const targetLength = 12;
  const s = targetLength / Math.max(size.x, size.z);
  model.scale.setScalar(s);
  model.rotation.y = Math.PI;
  bus.add(model);
  busReady = true;
}, undefined, (e) => {
  console.warn('Bus model missing — using fallback box.', e);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 2.2, 6),
    new THREE.MeshStandardMaterial({ color: 0xf2c94c })
  );
  body.position.y = 1.4;
  bus.add(body);
  busReady = true;
});

// ================= BUS STOPS =================
const stops = [];

function makeBusStop(x, z) {
  const g = new THREE.Group();

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0x999999 })
  );
  pole.position.y = 2;
  g.add(pole);

  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 1.2, 0.15),
    new THREE.MeshStandardMaterial({ color: 0x2563eb })
  );
  sign.position.set(0, 4.2, 0);
  g.add(sign);

  const shelterRoof = new THREE.Mesh(
    new THREE.BoxGeometry(6, 0.2, 3),
    new THREE.MeshStandardMaterial({ color: 0x1e40af })
  );
  shelterRoof.position.set(0, 3, -2);
  g.add(shelterRoof);

  const shelterBack = new THREE.Mesh(
    new THREE.BoxGeometry(6, 2.5, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.6 })
  );
  shelterBack.position.set(0, 1.25, -3.4);
  g.add(shelterBack);

  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(4, 0.3, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x7c4a1e })
  );
  bench.position.set(0, 0.8, -2.6);
  g.add(bench);

  const zone = new THREE.Mesh(
    new THREE.BoxGeometry(6, 1, 6),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  g.add(zone);

  g.position.set(x, 0, z);
  scene.add(g);
  return { group: g, zone, used: false, world: new THREE.Vector3(x, 0, z) };
}

function isRoadTile(r, c) {
  return r >= 0 && c >= 0 && r < GRID && c < GRID && map[r][c] === 0;
}

const stopCandidates = [];
for (let r = 0; r < GRID; r++) {
  for (let c = 0; c < GRID; c++) {
    if (isRoadTile(r, c) && Math.random() < 0.15) stopCandidates.push({ r, c });
  }
}
let si = 0;
while (stops.length < 6 && si < stopCandidates.length) {
  const { r, c } = stopCandidates[si++];
  const { x, z } = tileToWorld(r, c);
  stops.push(makeBusStop(x + TILE / 2 - 2, z));
}

// ================= TRAFFIC =================
const traffic = [];
const trafficMats = [];
for (let k = 0; k < 6; k++) {
  trafficMats.push(new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(Math.random(), 0.6, 0.5),
  }));
}

function spawnTraffic() {
  const car = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 1.4, 4),
    trafficMats[Math.floor(Math.random() * trafficMats.length)]
  );
  const r = 4 * (1 + Math.floor(Math.random() * 2));
  const { z } = tileToWorld(r, 0);
  car.position.set(-HALF + 2, 0.7, z);
  car.userData.speed = 15 + Math.random() * 15;
  scene.add(car);
  traffic.push(car);
}
for (let k = 0; k < 10; k++) spawnTraffic();

// ================= INPUT =================
const keys = {};
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (k === 'c') state.cockpit = !state.cockpit;
});
addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

// ================= HUD =================
const $ = id => document.getElementById(id);

function updateHUD() {
  $('money').textContent = Math.round(state.money);
  $('rep').textContent = Math.round(state.rep);
  $('fuel').textContent = Math.round(state.fuel);
  $('cond').textContent = Math.round(state.cond);
  $('day').textContent = state.day;
  $('speedText').textContent = Math.round(state.speed) + ' km/h';
  $('speedBar').style.width = (state.speed / state.maxSpeed * 100) + '%';

  const next = stops.find(s => !s.used);
  if (next) {
    const d = Math.round(next.world.distanceTo(bus.position));
    $('nextStop').textContent = d + 'm';
  } else {
    $('nextStop').textContent = 'Done';
  }
}

// ================= DRIVING =================
function updateBus(dt) {
  const accel = (keys['w'] || keys['arrowup']) ? 28 : 0;
  const brake = (keys['s'] || keys['arrowdown'] || keys[' ']) ? 40 : 0;
  const steerInput =
    ((keys['a'] || keys['arrowleft']) ? 1 : 0) -
    ((keys['d'] || keys['arrowright']) ? 1 : 0);

  state.steer += (steerInput - state.steer) * Math.min(1, dt * 4);
  state.speed += (accel - brake) * dt;
  state.speed = Math.max(0, Math.min(state.maxSpeed, state.speed));
  state.speed *= 0.995;

  const turnFactor = 0.9 * (state.speed / state.maxSpeed);
  bus.rotation.y += state.steer * turnFactor * dt;

  const rad = bus.rotation.y;
  bus.position.x += Math.sin(rad) * state.speed * dt * 0.5;
  bus.position.z += Math.cos(rad) * state.speed * dt * 0.5;

  const lim = HALF - 4;
  bus.position.x = Math.max(-lim, Math.min(lim, bus.position.x));
  bus.position.z = Math.max(-lim, Math.min(lim, bus.position.z));

  state.fuel = Math.max(0, state.fuel - state.speed * dt * 0.02);
  state.cond = Math.max(0, state.cond - state.speed * dt * 0.005);
  if (state.fuel <= 0) state.speed = 0;
}

// ================= CAMERA =================
const birdStart = new THREE.Vector3(-120, 160, 140);
const birdEnd   = new THREE.Vector3(120, 140, -140);
let camInitialised = false;

function updateCamera(dt) {
  if (!busReady) return;

  // --- INTRO: orbital bird view ---
  if (intro.active && !intro.transitioning) {
    const t = Math.min(1, (performance.now() - intro.startTime) / intro.duration);
    const ease = t * t * (3 - 2 * t);
    const ang = -0.6 + ease * 0.9;
    camera.position.set(
      Math.sin(ang) * 220,
      170 - ease * 25,
      Math.cos(ang) * 220
    );
    camera.lookAt(0, 0, 0);
    camera.fov = 55;
    camera.updateProjectionMatrix();
    return;
  }

  // --- INTRO: fly down to chase cam ---
  if (intro.transitioning) {
    intro.transition = Math.min(1, intro.transition + dt * 0.9);
    const e = intro.transition * intro.transition * (3 - 2 * intro.transition);
    const chase = new THREE.Vector3(0, 8, -14)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), bus.rotation.y)
      .add(bus.position);
    const from = new THREE.Vector3(0, 170, 220); // matches end of orbital
    camera.position.lerpVectors(from, chase, e);
    const look = bus.position.clone();
    camera.lookAt(look.x, 3, look.z);
    camera.fov = 60 + 15 * (1 - e);
    camera.updateProjectionMatrix();
    if (intro.transition >= 1) {
      intro.transitioning = false;
      intro.active = false;
      camInitialised = false;
      state.paused = false;
    }
    return;
  }

  // --- Normal cameras ---
  if (state.cockpit) {
    const local = new THREE.Vector3(0, 3.6, 4.5);
    const world = local.clone()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), bus.rotation.y)
      .add(bus.position);
    camera.position.copy(world);
    const look = new THREE.Vector3(0, 3.4, 20)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), bus.rotation.y)
      .add(bus.position);
    camera.lookAt(look);
    camera.fov = 75;
  } else {
    const offset = new THREE.Vector3(0, 8, -14)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), bus.rotation.y);
    const target = bus.position.clone().add(offset);
    if (!camInitialised) {
      camera.position.copy(target);
      camInitialised = true;
    } else {
      camera.position.lerp(target, Math.min(1, dt * 4));
    }
    camera.lookAt(bus.position.x, 3, bus.position.z + Math.cos(bus.rotation.y) * 4);
    camera.fov = 60;
  }
  camera.updateProjectionMatrix();
}

// ================= STOPS =================
function checkStops() {
  stops.forEach(s => {
    if (s.used) return;
    const wp = s.zone.position.clone().add(s.group.position);
    if (wp.distanceTo(bus.position) < 5 && state.speed < 5) {
      s.used = true;
      state.money += 8;
      state.rep += 2;
      state.passengers++;
      updateHUD();
    }
  });
}

// ================= TRAFFIC =================
function updateTraffic(dt) {
  traffic.forEach(car => {
    car.position.x += car.userData.speed * dt;
    if (car.position.x > HALF) car.position.x = -HALF;
    if (car.position.distanceTo(bus.position) < 3.5) {
      state.speed = 0;
      state.cond = Math.max(0, state.cond - 15);
      state.rep = Math.max(0, state.rep - 5);
      updateHUD();
    }
  });
}

// ================= PROMPTS =================
const promptEl = $('prompt');
const promptTextEl = $('promptText');
let pendingPrompt = null;

const prompts = [
  { text: "🚶 A passenger is running for the bus. Wait?", yes: { rep: 3, money: -2 }, no: { rep: -3, money: 1 } },
  { text: "🎫 Someone can't pay the fare. Let them ride free?", yes: { rep: 4, money: -4 }, no: { rep: -4, money: 0 } },
  { text: "🚦 Yellow light ahead — speed up or stop?", yes: { money: 2, cond: -5 }, no: { rep: 1 } },
];

function maybePrompt() {
  if (state.paused || pendingPrompt) return;
  if (Math.random() < 0.0008) {
    pendingPrompt = prompts[Math.floor(Math.random() * prompts.length)];
    state.paused = true;
    promptTextEl.textContent = pendingPrompt.text;
    promptEl.classList.remove('hidden');
  }
}

$('promptYes').onclick = () => resolvePrompt(true);
$('promptNo').onclick = () => resolvePrompt(false);

function resolvePrompt(yes) {
  const e = yes ? pendingPrompt.yes : pendingPrompt.no;
  state.rep = Math.max(0, state.rep + (e.rep || 0));
  state.money += (e.money || 0);
  state.cond = Math.max(0, state.cond + (e.cond || 0));
  pendingPrompt = null;
  promptEl.classList.add('hidden');
  state.paused = false;
  updateHUD();
}

// ================= DAY LOOP =================
let dayTimer = 0;
const DAY_LENGTH = 60;

function updateDay(dt) {
  if (state.paused || state.gameOver) return;
  dayTimer += dt;
  if (dayTimer >= DAY_LENGTH) {
    dayTimer = 0;
    endDay();
  }
}

function endDay() {
  state.paused = true;
  state.day++;
  state.money -= 20;
  state.fuel = Math.min(100, state.fuel + 30);
  state.cond = Math.min(100, state.cond + 10);
  state.rep = Math.max(0, state.rep - 1);
  stops.forEach(s => s.used = false);

  if (state.day > state.maxDays || state.rep <= 0 || state.money < -100) {
    const win = state.money >= 500 && state.rep >= 30;
    showOverlay(
      win ? "🏆 You made it!" : "🚌 Game Over",
      `Final: 💰 $${Math.round(state.money)} · ⭐ ${Math.round(state.rep)} · Passengers: ${state.passengers}`,
      "Play again",
      () => location.reload()
    );
    state.gameOver = true;
    return;
  }

  showOverlay(
    `📅 Day ${state.day}`,
    `Revenue collected. Fuel refilled. Ready for another shift?`,
    "Start shift",
    () => { overlay.classList.add('hidden'); state.paused = false; }
  );
  updateHUD();
}

const overlay = $('overlay');
function showOverlay(title, text, btn, cb) {
  $('overlayTitle').textContent = title;
  $('overlayText').textContent = text;
  const b = $('overlayBtn');
  b.textContent = btn;
  b.onclick = cb;
  overlay.classList.remove('hidden');
}

// ================= MINIMAP =================
const mm = document.getElementById('minimap');
const mctx = mm.getContext('2d');

function drawMinimap() {
  mctx.clearRect(0, 0, 180, 180);
  mctx.fillStyle = 'rgba(0,0,0,0.4)';
  mctx.fillRect(0, 0, 180, 180);

  const scale = 180 / (GRID * TILE);
  const ox = 90;
  const oy = 90;

  mctx.fillStyle = '#555';
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      if (map[r][c] === 0) {
        const wx = -HALF + c * TILE;
        const wz = -HALF + r * TILE;
        mctx.fillRect(ox + wx * scale, oy + wz * scale, TILE * scale, TILE * scale);
      }
    }
  }

  stops.forEach(s => {
    mctx.fillStyle = s.used ? '#22c55e' : '#2563eb';
    mctx.beginPath();
    mctx.arc(ox + s.world.x * scale, oy + s.world.z * scale, 3, 0, Math.PI * 2);
    mctx.fill();
  });

  mctx.save();
  mctx.translate(ox + bus.position.x * scale, oy + bus.position.z * scale);
  mctx.rotate(-bus.rotation.y);
  mctx.fillStyle = '#facc15';
  mctx.beginPath();
  mctx.moveTo(0, -6);
  mctx.lineTo(4, 5);
  mctx.lineTo(-4, 5);
  mctx.closePath();
  mctx.fill();
  mctx.restore();
}

// ================= INTRO BUTTON =================
const introEl = document.getElementById('intro');
document.getElementById('startBtn').onclick = () => {
  introEl.classList.add('fade-out');
  document.body.classList.remove('intro');
  setTimeout(() => { introEl.style.display = 'none'; }, 800);
  intro.transitioning = true;
  intro.transition = 0;
};

// ================= LOOP =================
let last = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (!state.paused && !state.gameOver) {
    updateBus(dt);
    updateTraffic(dt);
    checkStops();
    maybePrompt();
    updateDay(dt);
    updateHUD();
  }
  updateCamera(dt);
  drawMinimap();
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ================= TOUCH CONTROLS =================
function bindTouch(id, key) {
  const btn = document.getElementById(id);
  if (!btn) return;
  
  btn.addEventListener('touchstart', (e) => { 
    e.preventDefault(); 
    keys[key] = true; 
  });
  btn.addEventListener('touchend', (e) => { 
    e.preventDefault(); 
    keys[key] = false; 
  });
  // fallback for mouse testing
  btn.addEventListener('mousedown', () => keys[key] = true);
  btn.addEventListener('mouseup', () => keys[key] = false);
  btn.addEventListener('mouseleave', () => keys[key] = false);
}
bindTouch('btn-left', 'a');
bindTouch('btn-right', 'd');
bindTouch('btn-gas', 'w');
bindTouch('btn-brake', 's');

updateHUD();
animate();

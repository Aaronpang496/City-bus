import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const state = {
  money: 200, rep: 50, fuel: 100, cond: 100,
  day: 1, maxDays: 20,
  speed: 0, maxSpeed: 80,
  steer: 0,
  paused: true,           
  gameOver: false,
  passengers: 0,
  cockpit: false,
};

const camOffset = { x: 0, y: 0 };
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };

const intro = {
  active: true,
  startTime: performance.now(),
  duration: 4500,
  transition: 0,
  transitioning: false,
};

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
const collisionObjects = [];

function tileToWorld(r, c) {
  return { x: -HALF + c * TILE + TILE / 2, z: -HALF + r * TILE + TILE / 2 };
}

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
  collisionObjects.push({ pos: new THREE.Vector3(x, 0, z), radius: 3 });
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
        collisionObjects.push({ pos: new THREE.Vector3(x + ox, 0, z + oz), radius: Math.max(w, d) / 2 });
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
bus.position.set(-HALF + TILE / 2, 0, -HALF + TILE / 2);
bus.rotation.y = Math.PI / 2; 
scene.add(bus);

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
  bus.add(model);
}, undefined, (e) => {
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 2.2, 6),
    new THREE.MeshStandardMaterial({ color: 0xf2c94c })
  );
  body.position.y = 1.4;
  bus.add(body);
});

const stops = [];
function makeBusStop(x, z) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4, 8), new THREE.MeshStandardMaterial({ color: 0x999999 }));
  pole.position.y = 2;
  g.add(pole);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 0.15), new THREE.MeshStandardMaterial({ color: 0x2563eb }));
  sign.position.set(0, 4.2, 0);
  g.add(sign);
  const shelterRoof = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 3), new THREE.MeshStandardMaterial({ color: 0x1e40af }));
  shelterRoof.position.set(0, 3, -2);
  g.add(shelterRoof);
  const shelterBack = new THREE.Mesh(new THREE.BoxGeometry(6, 2.5, 0.2), new THREE.MeshStandardMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.6 }));
  shelterBack.position.set(0, 1.25, -3.4);
  g.add(shelterBack);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 0.8), new THREE.MeshStandardMaterial({ color: 0x7c4a1e }));
  bench.position.set(0, 0.8, -2.6);
  g.add(bench);
  const zone = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 6), new THREE.MeshBasicMaterial({ visible: false }));
  g.add(zone);
  g.position.set(x, 0, z);
  scene.add(g);
  return { group: g, zone, used: false, world: new THREE.Vector3(x, 0, z) };
}

const stopCandidates = [];
for (let r = 0; r < GRID; r++) {
  for (let c = 0; c < GRID; c++) {
    if (map[r][c] === 0 && Math.random() < 0.15) stopCandidates.push({ r, c });
  }
}
let si = 0;
while (stops.length < 6 && si < stopCandidates.length) {
  const { r, c } = stopCandidates[si++];
  const { x, z } = tileToWorld(r, c);
  stops.push(makeBusStop(x + TILE / 2 - 2, z));
}

const traffic = [];
const trafficMats = [];
for (let k = 0; k < 6; k++) {
  trafficMats.push(new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.6, 0.5) }));
}
function spawnTraffic() {
  const car = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 4), trafficMats[Math.floor(Math.random() * trafficMats.length)]);
  const r = 4 * (1 + Math.floor(Math.random() * 2));
  const { z } = tileToWorld(r, 0);
  car.position.set(-HALF + 2, 0.7, z);
  car.userData.speed = 15 + Math.random() * 15;
  scene.add(car);
  traffic.push(car);
}
for (let k = 0; k < 10; k++) spawnTraffic();

const keys = {};
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (k === 'c') state.cockpit = !state.cockpit;
});
addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

canvas.addEventListener('touchstart', (e) => {
  if (state.cockpit) return; 
  isDragging = true;
  previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, {passive: false});
canvas.addEventListener('touchend', () => { isDragging = false; });
canvas.addEventListener('touchmove', (e) => {
  if (!isDragging || state.cockpit) return;
  const deltaX = e.touches[0].clientX - previousMousePosition.x;
  const deltaY = e.touches[0].clientY - previousMousePosition.y;
  camOffset.x -= deltaX * 0.01;
  camOffset.y -= deltaY * 0.01;
  camOffset.y = Math.max(-0.5, Math.min(1.0, camOffset.y));
  previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, {passive: false});

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

function updateBus(dt) {
  const accel = (keys['w'] || keys['arrowup']) ? 28 : 0;
  const brake = (keys['s'] || keys['arrowdown'] || keys[' ']) ? 40 : 0;
  const steerInput = ((keys['a'] || keys['arrowleft']) ? 1 : 0) - ((keys['d'] || keys['arrowright']) ? 1 : 0);

  state.steer += (steerInput - state.steer) * Math.min(1, dt * 4);
  state.speed += (accel - brake) * dt;
  state.speed = Math.max(0, Math.min(state.maxSpeed, state.speed));
  state.speed *= 0.995;

  const turnFactor = 0.9 * (state.speed / state.maxSpeed);
  bus.rotation.y += state.steer * turnFactor * dt;

  const nextX = bus.position.x + Math.sin(bus.rotation.y) * state.speed * dt * 0.5;
  const nextZ = bus.position.z + Math.cos(bus.rotation.y) * state.speed * dt * 0.5;
  
  let hit = false;
  for (let obj of collisionObjects) {
    if (Math.hypot(nextX - obj.pos.x, nextZ - obj.pos.z) < obj.radius + 2.5) {
      hit = true;
      break;
    }
  }

  if (hit) {
    state.speed = -10;
    state.cond = Math.max(0, state.cond - 5);
    updateHUD();
  } else {
    bus.position.x = nextX;
    bus.position.z = nextZ;
  }

  const lim = HALF - 4;
  bus.position.x = Math.max(-lim, Math.min(lim, bus.position.x));
  bus.position.z = Math.max(-lim, Math.min(lim, bus.position.z));

  state.fuel = Math.max(0, state.fuel - state.speed * dt * 0.02);
  state.cond = Math.max(0, state.cond - state.speed * dt * 0.005);
  if (state.fuel <= 0) state.speed = 0;
}

let camInitialised = false;

function updateCamera(dt) {
  if (intro.active && !intro.transitioning) {
    const t = Math.min(1, (performance.now() - intro.startTime) / intro.duration);
    const ease = t * t * (3 - 2 * t);
    const ang = -0.6 + ease * 0.9;
    camera.position.set(Math.sin(ang) * 220, 170 - ease * 25, Math.cos(ang) * 220);
    camera.lookAt(0, 0, 0);
    camera.fov = 55;
    camera.updateProjectionMatrix();
    return;
  }

  if (intro.transitioning) {
    intro.transition = Math.min(1, intro.transition + dt * 0.9);
    const e = intro.transition * intro.transition * (3 - 2 * intro.transition);
    const chase = new THREE.Vector3(0, 8, -14).applyAxisAngle(new THREE.Vector3(0, 1, 0), bus.rotation.y).add(bus.position);
    const from = new THREE.Vector3(0, 170, 220);
    camera.position.lerpVectors(from, chase, e);
    camera.lookAt(bus.position.x, bus.position.y + 2, bus.position.z);
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

  if (state.cockpit) {
    const local = new THREE.Vector3(0, 3.6, -4.5); 
    const world = local.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), bus.rotation.y).add(bus.position);
    camera.position.copy(world);
    const look = new THREE.Vector3(0, 3.4, -20).applyAxisAngle(new THREE.Vector3(0, 1, 0), bus.rotation.y).add(bus.position);
    camera.lookAt(look);
    camera.fov = 75;
  } else {
    const offset = new THREE.Vector3(0, 8, -14);
    const rotationMatrix = new THREE.Matrix4().makeRotationY(camOffset.x);
    offset.applyMatrix4(rotationMatrix);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), bus.rotation.y);
    offset.y += camOffset.y * 10;

    const target = bus.position.clone().add(offset);
    if (!camInitialised) {
      camera.position.copy(target);
      camInitialised = true;
    } else {
      camera.position.lerp(target, Math.min(1, dt * 4));
    }
    camera.lookAt(bus.position.x, bus.position.y + 2, bus.position.z);
    camera.fov = 60;
  }
  camera.updateProjectionMatrix();
}

function checkStops() {
  stops.forEach(s => {
    if (s.used) return;
    const wp = s.zone.position.clone().add(s.group.position);
    
    if (wp.distanceTo(bus.position) < 6 && state.speed < 5) {
      s.used = true;
      state.paused = true; 
      
      promptTextEl.textContent = "🚏 Bus stop reached! Allow passengers to board?";
      $('promptYes').onclick = () => {
        state.money += 8;
        state.rep += 2;
        state.passengers++;
        s.zone.material.color.set(0x22c55e); 
        promptEl.classList.add('hidden');
        state.paused = false;
        updateHUD();
      };
      $('promptNo').onclick = () => {
        state.rep = Math.max(0, state.rep - 1); 
        promptEl.classList.add('hidden');
        state.paused = false;
        updateHUD();
      };
      
      promptEl.classList.remove('hidden');
    }
  });
}

function updateTraffic(dt) {
  traffic.forEach(car => {
    car.position.x += car.userData.speed * dt;
    if (car.position.x > HALF) car.position.x = -HALF;
    if (car.position.distanceTo(bus.position) < 3.5) {
      state.speed = -10; 
      state.cond = Math.max(0, state.cond - 15);
      state.rep = Math.max(0, state.rep - 5);
      updateHUD();
    }
  });
}

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

const promptEl = $('prompt');
const promptTextEl = $('promptText');
const overlay = $('overlay');

function showOverlay(title, text, btn, cb) {
  $('overlayTitle').textContent = title;
  $('overlayText').textContent = text;
  const b = $('overlayBtn');
  b.textContent = btn;
  b.onclick = cb;
  overlay.classList.remove('hidden');
}

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

const introEl = document.getElementById('intro');
const startBtn = document.getElementById('startBtn');

function startGame(e) {
  if (e) e.preventDefault();
  introEl.classList.add('fade-out');
  document.body.classList.remove('intro');
  setTimeout(() => { introEl.style.display = 'none'; }, 800);
  intro.transitioning = true;
  intro.transition = 0;
}

startBtn.addEventListener('click', startGame);
startBtn.addEventListener('touchstart', startGame, {passive: false});

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

function bindTouch(id, key) {
  const btn = document.getElementById(id);
  if (!btn) return;

  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); keys[key] = true; });
  btn.addEventListener('pointerup', (e) => { e.preventDefault(); keys[key] = false; });
  btn.addEventListener('pointerleave', (e) => { e.preventDefault(); keys[key] = false; });
  btn.addEventListener('touchstart', (e) => { e.preventDefault(); keys[key] = true; }, {passive: false});
  btn.addEventListener('touchend', (e) => { e.preventDefault(); keys[key] = false; }, {passive: false});
}
bindTouch('btn-left', 'a');
bindTouch('btn-right', 'd');
bindTouch('btn-gas', 'w');
bindTouch('btn-brake', 's');

const camBtn = document.getElementById('btn-cam');
if (camBtn) {
  function toggleCam(e) {
    if (e) e.preventDefault();
    state.cockpit = !state.cockpit;
  }
  camBtn.addEventListener('click', toggleCam);
  camBtn.addEventListener('touchstart', toggleCam, {passive: false});
}

updateHUD();
animate();

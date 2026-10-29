import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const state = {
  money: 200, rep: 50, fuel: 100, cond: 100,
  day: 1, maxDays: 20,
  speed: 0, baseMaxSpeed: 80, maxSpeed: 80,
  steer: 0, paused: true, gameOver: false,
  passengers: 0, cockpit: false,
  timer: 150, combo: 1, shake: 0,
  shiftActive: false, lightTimer: 0, lightPhase: 'green', lightCooldown: 0,
  lightIntersections: []
};

const camOffset = { x: 0, y: 0 };
let isDragging = false, previousMousePosition = { x: 0, y: 0 };
const intro = { active: true, startTime: performance.now(), duration: 4500, transition: 0, transitioning: false };

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 120, 320);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 600);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x556655, 1.1);
scene.add(hemiLight);
const sun = new THREE.DirectionalLight(0xffffff, 1.3);
sun.position.set(60, 100, 40);
scene.add(sun);

let audioCtx, engineOsc, engineGain;
function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  engineOsc = audioCtx.createOscillator();
  engineGain = audioCtx.createGain();
  engineOsc.type = 'sawtooth';
  engineOsc.frequency.value = 50;
  engineGain.gain.value = 0;
  engineOsc.connect(engineGain);
  engineGain.connect(audioCtx.destination);
  engineOsc.start();
}

const GRID = 14, TILE = 30, HALF = (GRID * TILE) / 2;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(GRID * TILE + 200, GRID * TILE + 200), new THREE.MeshStandardMaterial({ color: 0x3a7d44 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

const roadMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a });
const lineMat = new THREE.MeshStandardMaterial({ color: 0xffff00 });
const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4423 });
const treeLeafMat = new THREE.MeshStandardMaterial({ color: 0x2f7d32 });
const pedMat = new THREE.MeshStandardMaterial({ color: 0xef4444 });

let cityGroup = new THREE.Group(); scene.add(cityGroup);
let map = [], collisionObjects = [], stops = [], traffic = [], peds = [], trafficLights = [];

const windowTex = (() => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#222'; ctx.fillRect(0, 0, 64, 128);
  for (let y = 8; y < 120; y += 16) for (let x = 6; x < 60; x += 14) {
    ctx.fillStyle = Math.random() < 0.5 ? '#ffe9a8' : '#5aa0d8'; ctx.fillRect(x, y, 8, 10);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
})();

const buildingMatCache = {};
function getBuildingMat(hue) {
  const key = Math.round(hue * 10);
  if (buildingMatCache[key]) return buildingMatCache[key];
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue, 0.35, 0.55) });
  buildingMatCache[key] = m; return m;
}

const bus = new THREE.Group(); scene.add(bus);
const loader = new GLTFLoader();
loader.load('assets/bus.glb', (gltf) => {
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  model.position.x -= center.x; model.position.z -= center.z; model.position.y -= box.min.y;
  const s = 12 / Math.max(size.x, size.z);
  model.scale.setScalar(s); model.rotation.y = 0; 
  model.traverse(n => { if(n.isMesh) { n.castShadow = true; n.receiveShadow = true; }});
  bus.add(model);
}, undefined, () => {
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0xf2c94c }));
  body.position.y = 1.4; body.castShadow = true; bus.add(body);
});

function tileToWorld(r, c) { return { x: -HALF + c * TILE + TILE / 2, z: -HALF + r * TILE + TILE / 2 }; }

function addTree(group, x, z) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 3, 6), treeTrunkMat); trunk.position.y = 1.5; g.add(trunk);
  const leaves = new THREE.Mesh(new THREE.SphereGeometry(2, 8, 6), treeLeafMat); leaves.position.y = 4.2; g.add(leaves);
  g.position.set(x, 0, z); group.add(g);
  collisionObjects.push({ pos: new THREE.Vector3(x, 0, z), radius: 3 });
}

function makeBusStop(group, x, z) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4, 8), new THREE.MeshStandardMaterial({ color: 0x999999 })); pole.position.y = 2; g.add(pole);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 0.15), new THREE.MeshStandardMaterial({ color: 0x2563eb })); sign.position.set(0, 4.2, 0); g.add(sign);
  const shelterRoof = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 3), new THREE.MeshStandardMaterial({ color: 0x1e40af })); shelterRoof.position.set(0, 3, -2); g.add(shelterRoof);
  const shelterBack = new THREE.Mesh(new THREE.BoxGeometry(6, 2.5, 0.2), new THREE.MeshStandardMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.6 })); shelterBack.position.set(0, 1.25, -3.4); g.add(shelterBack);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 0.8), new THREE.MeshStandardMaterial({ color: 0x7c4a1e })); bench.position.set(0, 0.8, -2.6); g.add(bench);
  const zone = new THREE.Mesh(new THREE.SphereGeometry(30, 8, 8), new THREE.MeshBasicMaterial({ visible: false })); g.add(zone);
  g.position.set(x, 0, z); group.add(g);
  return { group: g, zone, used: false, world: new THREE.Vector3(x, 0, z) };
}

function makeTrafficLight(group, x, z, isHorizontal) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 6), new THREE.MeshStandardMaterial({ color: 0x333333 })); pole.position.y = 3; g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 0.2), new THREE.MeshStandardMaterial({ color: 0x333333 })); arm.position.set(2, 6, 0); g.add(arm);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(1, 2.4, 1), new THREE.MeshStandardMaterial({ color: 0x111111 })); housing.position.set(3.5, 5, 0); g.add(housing);
  const makeLight = (color, y, emissiveIntensity) => {
    const mat = new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: emissiveIntensity });
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 12), mat);
    light.position.set(3.5, y, 0); return light;
  };
  const red = makeLight(0xff0000, 5.7, 2);
  const yellow = makeLight(0xffff00, 5, 0);
  const green = makeLight(0x00ff00, 4.3, 0);
  g.add(red, yellow, green);
  const glow = new THREE.PointLight(0xff0000, 3, 15); glow.position.set(3.5, 5, 0); g.add(glow);
  if (!isHorizontal) g.rotation.y = Math.PI / 2;
  g.position.set(x, 0, z); group.add(g);
  return { group: g, red, yellow, green, glow, isHorizontal };
}

function spawnTraffic(group) {
  const car = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 4), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.6, 0.5) }));
  const r = 4 * (1 + Math.floor(Math.random() * 2));
  const { z } = tileToWorld(r, 0);
  car.position.set(HALF - 2, 0.7, z); 
  car.userData.speed = 20 + Math.random() * 20; car.userData.direction = -1; car.castShadow = true;
  group.add(car); traffic.push(car);
}

function spawnPedestrian(group, x, z) {
  const ped = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.6), pedMat);
  ped.position.set(x, 0.8, z); ped.userData.speed = 2 + Math.random() * 2;
  ped.userData.dir = Math.random() > 0.5 ? 1 : -1;
  group.add(ped); peds.push(ped);
}

function generateCity() {
  cityGroup.clear(); map = []; collisionObjects = []; stops = []; traffic = []; peds = []; trafficLights = [];
  state.lightTimer = 0; state.lightPhase = 'green'; state.lightCooldown = 0;
  
  for (let r = 0; r < GRID; r++) {
    map[r] = [];
    for (let c = 0; c < GRID; c++) {
      const isRoad = (r % 4 === 0) || (c % 4 === 0) || r === GRID - 1 || c === GRID - 1;
      map[r][c] = isRoad ? 0 : (Math.random() < 0.25 ? 2 : 1);
    }
  }
  
  const lightSpots = [ { r: 4, c: 4 }, { r: 4, c: 8 }, { r: 8, c: 4 }, { r: 8, c: 8 } ];
  state.lightIntersections = lightSpots.map(spot => {
    const w = tileToWorld(spot.r, spot.c);
    return new THREE.Vector3(w.x, 0, w.z);
  });

  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const { x, z } = tileToWorld(r, c); const type = map[r][c];
      if (type === 0) {
        const road = new THREE.Mesh(new THREE.PlaneGeometry(TILE, TILE), roadMat);
        road.rotation.x = -Math.PI / 2; road.position.set(x, 0.02, z); road.receiveShadow = true; cityGroup.add(road);
        const horizontal = (r % 4 === 0);
        for (let i = -TILE / 2 + 4; i < TILE / 2; i += 8) {
          const dash = new THREE.Mesh(new THREE.PlaneGeometry(horizontal ? 4 : 0.5, horizontal ? 0.5 : 4), lineMat);
          dash.rotation.x = -Math.PI / 2; dash.position.set(x + (horizontal ? i : 0), 0.03, z + (horizontal ? 0 : i)); cityGroup.add(dash);
        }
        if (Math.random() < 0.1) spawnPedestrian(cityGroup, x, z);
      } else if (type === 1) {
        const n = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          const w = 6 + Math.random() * 8, d = 6 + Math.random() * 8, h = 10 + Math.random() * 45;
          const mat = getBuildingMat(Math.random() * 0.15 + 0.55).clone();
          mat.map = windowTex.clone(); mat.map.repeat.set(Math.max(1, Math.floor(w / 4)), Math.max(1, Math.floor(h / 6))); mat.map.needsUpdate = true;
          const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
          const ox = (Math.random() - 0.5) * (TILE - w - 2), oz = (Math.random() - 0.5) * (TILE - d - 2);
          b.position.set(x + ox, h / 2, z + oz); b.castShadow = true; b.receiveShadow = true; cityGroup.add(b);
          collisionObjects.push({ pos: new THREE.Vector3(x + ox, 0, z + oz), radius: Math.max(w, d) / 2 });
        }
      } else {
        for (let i = 0; i < 4; i++) addTree(cityGroup, x + (Math.random() - 0.5) * (TILE - 4), z + (Math.random() - 0.5) * (TILE - 4));
      }
    }
  }
  
  lightSpots.forEach(({ r, c }) => {
    const { x, z } = tileToWorld(r, c);
    trafficLights.push(makeTrafficLight(cityGroup, x, z, true));
    trafficLights.push(makeTrafficLight(cityGroup, x, z, false));
  });
  
  const stopCandidates = [];
  for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) if (map[r][c] === 0 && Math.random() < 0.15) stopCandidates.push({ r, c });
  let si = 0;
  while (stops.length < 6 && si < stopCandidates.length) {
    const { r, c } = stopCandidates[si++]; const { x, z } = tileToWorld(r, c);
    stops.push(makeBusStop(cityGroup, x + TILE / 2 - 2, z));
  }
  for (let k = 0; k < 12; k++) spawnTraffic(cityGroup);
  
  // OPTIMIZED NIGHT MODE (No PointLights = No Lag)
  if (Math.random() < 0.2) {
    scene.background = new THREE.Color(0x050510);
    scene.fog = new THREE.Fog(0x050510, 50, 200);
    hemiLight.intensity = 0.35; sun.intensity = 0.2;
    for (let r = 0; r < GRID; r+=4) {
      for (let c = 0; c < GRID; c+=4) {
        const { x, z } = tileToWorld(r, c);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5), new THREE.MeshBasicMaterial({ color: 0xffaa00 }));
        lamp.position.set(x, 8, z); cityGroup.add(lamp);
      }
    }
  } else {
    scene.background = new THREE.Color(0x87ceeb); scene.fog = new THREE.Fog(0x87ceeb, 120, 320);
    hemiLight.intensity = 1.1; sun.intensity = 1.3;
  }
  
  bus.position.set(-HALF + TILE / 2, 0, -HALF + TILE / 2); bus.rotation.y = Math.PI / 2;
  state.speed = 0; state.timer = 150; state.combo = 1;
}

const $ = id => document.getElementById(id);

function startShift() {
  if (intro.active || intro.transitioning) return; 
  if (state.shiftActive) return; 
  state.shiftActive = true;
  state.paused = false;
  $('overlay').classList.add('hidden'); 
  initAudio(); 
}

const keys = {};
addEventListener('keydown', e => {
  const k = e.key.toLowerCase(); keys[k] = true;
  if (k === 'c') state.cockpit = !state.cockpit;
  if ((k === 'w' || k === 'arrowup') && !state.shiftActive && !intro.active) startShift();
});
addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

$('overlay').addEventListener('click', (e) => { if (!state.shiftActive && !intro.active) startShift(); });
$('overlay').addEventListener('touchstart', (e) => { if (!state.shiftActive && !intro.active) startShift(); }, { passive: false });

$('overlayBtn').onclick = (e) => {
  e.preventDefault();
  if (!state.shiftActive && !intro.active) startShift();
  else if (state.shiftActive) { $('overlay').classList.add('hidden'); openShop(); }
};

$('menu-btn').onclick = (e) => {
  e.preventDefault();
  if (state.paused || !state.shiftActive) return;
  state.paused = true;
  $('pause-menu').classList.remove('hidden');
};

$('resume-btn').onclick = (e) => {
  e.preventDefault();
  $('pause-menu').classList.add('hidden');
  state.paused = false;
};

$('pause-shop-btn').onclick = (e) => {
  e.preventDefault();
  $('pause-menu').classList.add('hidden');
  openShop();
};

$('restart-btn').onclick = (e) => {
  e.preventDefault();
  location.reload();
};

canvas.addEventListener('touchstart', (e) => { if (state.cockpit) return; isDragging = true; previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, {passive: false});
canvas.addEventListener('touchend', () => { isDragging = false; });
canvas.addEventListener('touchmove', (e) => {
  if (!isDragging || state.cockpit) return;
  const deltaX = e.touches[0].clientX - previousMousePosition.x;
  const deltaY = e.touches[0].clientY - previousMousePosition.y;
  camOffset.x -= deltaX * 0.01; camOffset.y -= deltaY * 0.01;
  camOffset.y = Math.max(-0.5, Math.min(1.0, camOffset.y));
  previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, {passive: false});

function updateHUD() {
  $('money').textContent = Math.round(state.money);
  $('rep').textContent = Math.round(state.rep);
  $('fuel').textContent = Math.round(state.fuel);
  $('cond').textContent = Math.round(state.cond);
  $('day').textContent = state.day;
  $('timer').textContent = Math.ceil(state.timer);
  $('timer').style.color = state.timer < 30 ? '#ef4444' : '#facc15';
  $('speedText').textContent = Math.round(state.speed) + ' km/h';
  $('speedBar').style.width = Math.abs(state.speed / state.maxSpeed * 100) + '%';
  
  const comboEl = $('combo');
  if (state.combo > 1) { comboEl.textContent = `🔥 COMBO x${state.combo}`; comboEl.style.opacity = 1; }
  else { comboEl.style.opacity = 0; }
  const next = stops.find(s => !s.used);
  $('nextStop').textContent = next ? Math.round(next.world.distanceTo(bus.position)) + 'm' : 'Done!';
}

function updateBus(dt) {
  const isGas = keys['w'] || keys['arrowup'], isBrake = keys['s'] || keys['arrowdown'] || keys[' '];
  const steerInput = ((keys['a'] || keys['arrowleft']) ? 1 : 0) - ((keys['d'] || keys['arrowright']) ? 1 : 0);
  
  // HEAVY BUS PHYSICS - Slower acceleration, lower top speed
  const accelForce = 6.5; 
  const brakeForce = 25; 
  const drag = 1.5; 
  const maxReverse = -8;

  if (state.fuel <= 0) {
    state.speed -= 8 * dt; 
    if (state.speed < 0) state.speed = 0;
  } 
  else if (state.cond <= 0) {
    state.speed = 0;
    endShift(); 
    return;
  } 
  else {
    if (isGas) {
      state.speed += accelForce * dt;
    } else if (isBrake) {
      state.speed -= brakeForce * dt;
    } else {
      if (state.speed > 0) state.speed = Math.max(0, state.speed - drag * dt);
      if (state.speed < 0) state.speed = Math.min(0, state.speed + drag * dt);
    }
  }

  // Cap speed to a lower, more realistic city speed
  const currentMaxSpeed = Math.min(state.maxSpeed, 60); 
  state.speed = Math.max(maxReverse, Math.min(currentMaxSpeed, state.speed));

  if (audioCtx && engineOsc) {
    engineOsc.frequency.setTargetAtTime(50 + Math.abs(state.speed) * 3, audioCtx.currentTime, 0.1);
    engineGain.gain.setTargetAtTime(Math.min(0.1, Math.abs(state.speed) * 0.002), audioCtx.currentTime, 0.1);
  }

  state.steer += (steerInput - state.steer) * Math.min(1, dt * 6);
  // Slower turning at low speeds, but allows turning even when slow
  const turnFactor = (0.5 + 0.8 * (Math.abs(state.speed) / currentMaxSpeed)) * (state.speed >= 0 ? 1 : -1);
  bus.rotation.y += state.steer * turnFactor * dt;

  const nextX = bus.position.x + Math.sin(bus.rotation.y) * state.speed * dt;
  const nextZ = bus.position.z + Math.cos(bus.rotation.y) * state.speed * dt;
  
  let hit = false;
  for (let obj of collisionObjects) {
    if (Math.hypot(nextX - obj.pos.x, nextZ - obj.pos.z) < obj.radius + 2.5) { hit = true; break; }
  }

  if (hit) {
    if (state.speed > 15) state.shake = 0.5; 
    state.speed = 0; state.cond = Math.max(0, state.cond - 5); state.combo = 1; updateHUD();
  } else { bus.position.x = nextX; bus.position.z = nextZ; }

  const lim = HALF - 4;
  bus.position.x = Math.max(-lim, Math.min(lim, bus.position.x));
  bus.position.z = Math.max(-lim, Math.min(lim, bus.position.z));

  state.fuel = Math.max(0, state.fuel - Math.abs(state.speed) * dt * 0.02);
  state.cond = Math.max(0, state.cond - Math.abs(state.speed) * dt * 0.005);
}

function updateTraffic(dt) {
  traffic.forEach(car => {
    car.position.x += car.userData.speed * dt * car.userData.direction;
    if (car.position.x < -HALF) car.position.x = HALF;
    if (car.position.x > HALF) car.position.x = -HALF;
    if (car.position.distanceTo(bus.position) < 4) {
      if (Math.abs(state.speed) > 10) state.shake = 0.6;
      state.speed = 0; state.cond = Math.max(0, state.cond - 15); state.rep = Math.max(0, state.rep - 5); state.combo = 1;
      bus.position.x -= Math.sin(bus.rotation.y) * 2; bus.position.z -= Math.cos(bus.rotation.y) * 2;
      updateHUD();
    }
  });
}

function updateTrafficLights(dt) {
  state.lightTimer += dt;
  const cycle = state.lightTimer % 10;
  let phase = cycle < 4 ? 'green' : (cycle < 5 ? 'yellow' : (cycle < 9 ? 'red' : 'yellow'));
  state.lightPhase = phase;

  trafficLights.forEach(tl => {
    let effectivePhase = phase;
    if (!tl.isHorizontal) {
      if (phase === 'green') effectivePhase = 'red'; else if (phase === 'red') effectivePhase = 'green';
    }
    tl.red.material.emissiveIntensity = effectivePhase === 'red' ? 2.5 : 0;
    tl.yellow.material.emissiveIntensity = effectivePhase === 'yellow' ? 2.5 : 0;
    tl.green.material.emissiveIntensity = effectivePhase === 'green' ? 2.5 : 0;
    if (effectivePhase === 'red') tl.glow.color.set(0xff0000);
    else if (effectivePhase === 'yellow') tl.glow.color.set(0xffff00);
    else tl.glow.color.set(0x00ff00);
  });

  if (state.lightCooldown > 0) state.lightCooldown -= dt;
  
  if (state.lightPhase === 'red' && Math.abs(state.speed) > 10) {
    state.lightIntersections.forEach(intersection => {
      if (bus.position.distanceTo(intersection) < 15) {
        if (state.lightCooldown <= 0) {
          state.money = Math.max(0, state.money - 15);
          state.rep = Math.max(0, state.rep - 5);
          state.combo = 1;
          state.shake = 0.4;
          state.lightCooldown = 3; 
          updateHUD();
        }
      }
    });
  }
}

function updatePeds(dt) {
  peds.forEach(p => {
    p.position.x += p.userData.speed * dt * p.userData.dir;
    if (Math.abs(p.position.x - (-HALF + TILE/2)) > TILE) p.userData.dir *= -1; 
    if (p.position.distanceTo(bus.position) < 3) {
      state.rep = Math.max(0, state.rep - 20); state.speed = 0; state.shake = 0.8; state.combo = 1;
      p.position.set(0, -10, 0); updateHUD();
    }
  });
}

const promptYesBtn = $('promptYes');
promptYesBtn.onclick = (e) => {
  e.preventDefault();
  const earn = 8 * state.combo;
  state.money += earn; state.rep = Math.min(100, state.rep + 2); state.passengers++;
  state.timer += 10; state.combo = Math.min(5, state.combo + 1); 
  $('prompt').classList.add('hidden'); state.paused = false; updateHUD();
};
$('promptNo').onclick = (e) => {
  e.preventDefault(); state.rep = Math.max(0, state.rep - 1); state.combo = 1;
  $('prompt').classList.add('hidden'); state.paused = false; updateHUD();
};

function checkStops() {
  stops.forEach(s => {
    if (s.used) return;
    const wp = s.zone.position.clone().add(s.group.position);
    
    // WIDER RADIUS (30) AND FASTER SPEED ALLOWANCE (35)
    if (bus.position.distanceTo(wp) < 30 && Math.abs(state.speed) < 35) {
      s.used = true; state.paused = true; s.zone.material.color.set(0x22c55e);
      keys['w'] = false; keys['s'] = false;
      $('promptText').textContent = `🚏 Stop reached! Combo x${state.combo} (+$${8 * state.combo})`;
      $('promptYes').textContent = `Yes (+$${8 * state.combo}, +10s)`;
      $('prompt').classList.remove('hidden');
    }
  });
}

let camInitialised = false;
function updateCamera(dt) {
  if (intro.active && !intro.transitioning) {
    const t = Math.min(1, (performance.now() - intro.startTime) / intro.duration);
    const ease = t * t * (3 - 2 * t); const ang = -0.6 + ease * 0.9;
    camera.position.set(Math.sin(ang) * 220, 170 - ease * 25, Math.cos(ang) * 220);
    camera.lookAt(0, 0, 0); camera.fov = 55; camera.updateProjectionMatrix(); return;
  }
  if (intro.transitioning) {
    intro.transition = Math.min(1, intro.transition + dt * 0.9);
    const e = intro.transition * intro.transition * (3 - 2 * intro.transition);
    const chase = new THREE.Vector3(0, 8, -14).applyAxisAngle(new THREE.Vector3(0, 1, 0), bus.rotation.y).add(bus.position);
    const from = new THREE.Vector3(0, 170, 220);
    camera.position.lerpVectors(from, chase, e); camera.lookAt(bus.position.x, bus.position.y + 2, bus.position.z);
    camera.fov = 60 + 15 * (1 - e); camera.updateProjectionMatrix();
    if (intro.transition >= 1) { 
      intro.transitioning = false; intro.active = false; camInitialised = false; state.paused = true; 
      showOverlayPrompt(); 
    }
    return;
  }
  let shakeX = 0, shakeY = 0;
  if (state.shake > 0) {
    shakeX = (Math.random() - 0.5) * state.shake; shakeY = (Math.random() - 0.5) * state.shake;
    state.shake = Math.max(0, state.shake - dt * 2);
  }
  if (state.cockpit) {
    const local = new THREE.Vector3(0, 2.5, 6.5); 
    const world = local.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), bus.rotation.y).add(bus.position);
    camera.position.copy(world); camera.position.x += shakeX; camera.position.y += shakeY;
    const look = new THREE.Vector3(0, 2.0, 20).applyAxisAngle(new THREE.Vector3(0, 1, 0), bus.rotation.y).add(bus.position);
    camera.lookAt(look); camera.fov = 75;
  } else {
    const offset = new THREE.Vector3(0, 8, -14);
    offset.applyMatrix4(new THREE.Matrix4().makeRotationY(camOffset.x));
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), bus.rotation.y);
    offset.y += camOffset.y * 10;
    const target = bus.position.clone().add(offset);
    if (!camInitialised) { camera.position.copy(target); camInitialised = true; } 
    else { camera.position.lerp(target, Math.min(1, dt * 4)); }
    camera.position.x += shakeX; camera.position.y += shakeY;
    camera.lookAt(bus.position.x, bus.position.y + 2, bus.position.z); camera.fov = 60;
  }
  camera.updateProjectionMatrix();
}

function showOverlayPrompt() {
  $('overlay').classList.remove('hidden');
  $('overlayTitle').textContent = `📅 Day ${state.day}`;
  $('overlayText').textContent = "Tap the GAS button (or press W) to start the timer!";
  $('overlayBtn').style.display = 'none';
}

const mm = document.getElementById('minimap'); const mctx = mm.getContext('2d');
function drawMinimap() {
  mctx.clearRect(0, 0, 180, 180);
  mctx.fillStyle = 'rgba(0,0,0,0.4)'; mctx.fillRect(0, 0, 180, 180);
  const scale = 180 / (GRID * TILE); const ox = 90, oy = 90;
  mctx.fillStyle = '#555';
  for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) if (map[r][c] === 0) {
    mctx.fillRect(ox + (-HALF + c * TILE) * scale, oy + (-HALF + r * TILE) * scale, TILE * scale, TILE * scale);
  }
  stops.forEach(s => {
    mctx.fillStyle = s.used ? '#22c55e' : '#2563eb'; mctx.beginPath();
    mctx.arc(ox + s.world.x * scale, oy + s.world.z * scale, 3, 0, Math.PI * 2); mctx.fill();
  });
  mctx.save(); mctx.translate(ox + bus.position.x * scale, oy + bus.position.z * scale);
  mctx.rotate(-bus.rotation.y); mctx.fillStyle = '#facc15'; mctx.beginPath();
  mctx.moveTo(0, -6); mctx.lineTo(4, 5); mctx.lineTo(-4, 5); mctx.closePath(); mctx.fill(); mctx.restore();
}

const shopEl = $('shop');
function openShop() {
  state.paused = true; state.shiftActive = false;
  shopEl.classList.remove('hidden');
  $('buy-repair').disabled = state.money < 50 || state.cond >= 100;
  $('buy-fuel').disabled = state.money < 30 || state.fuel >= 100;
  $('buy-engine').disabled = state.money < 100 || state.maxSpeed >= 140;
}
$('buy-repair').onclick = () => { if(state.money >= 50) { state.money -= 50; state.cond = 100; openShop(); updateHUD(); } };
$('buy-fuel').onclick = () => { if(state.money >= 30) { state.money -= 30; state.fuel = 100; openShop(); updateHUD(); } };
$('buy-engine').onclick = () => { if(state.money >= 100) { state.money -= 100; state.maxSpeed += 20; openShop(); updateHUD(); } };

$('shop-continue').onclick = () => {
  shopEl.classList.add('hidden'); state.day++;
  if (state.day > state.maxDays) {
    shopEl.classList.add('hidden'); $('overlay').classList.remove('hidden');
    $('overlayTitle').textContent = "🏆 You survived 20 shifts!";
    $('overlayText').textContent = `Final: 💰 $${Math.round(state.money)} · ⭐ ${Math.round(state.rep)}`;
    $('overlayBtn').textContent = "Play Again"; $('overlayBtn').style.display = 'block';
    $('overlayBtn').onclick = () => location.reload(); return;
  }
  state.money -= 20; state.rep = Math.max(0, state.rep - 1);
  generateCity(); updateHUD(); showOverlayPrompt();
};

function endShift() {
  state.paused = true; state.shiftActive = false;
  if (state.day >= state.maxDays) {
    state.day++; $('overlay').classList.remove('hidden');
    $('overlayTitle').textContent = "🏆 You survived 20 shifts!";
    $('overlayText').textContent = `Final: 💰 $${Math.round(state.money)} · ⭐ ${Math.round(state.rep)}`;
    $('overlayBtn').textContent = "Play Again"; $('overlayBtn').style.display = 'block';
    $('overlayBtn').onclick = () => location.reload(); return;
  }
  $('overlay').classList.remove('hidden');
  $('overlayTitle').textContent = `📅 Shift ${state.day} Complete!`;
  $('overlayText').textContent = "Great job! Time to upgrade your bus.";
  $('overlayBtn').textContent = "Open Shop 🛒"; $('overlayBtn').style.display = 'block';
  $('overlayBtn').onclick = () => { $('overlay').classList.add('hidden'); openShop(); };
}

let last = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (state.shiftActive && !state.paused && !state.gameOver) {
    updateBus(dt); updateTraffic(dt); updatePeds(dt); checkStops(); updateTrafficLights(dt); updateHUD();
    state.timer -= dt;
    if (state.timer <= 0) { state.timer = 0; updateHUD(); endShift(); }
    if (stops.every(s => s.used)) endShift();
  }
  updateCamera(dt); drawMinimap(); renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function bindTouch(id, key) {
  const btn = document.getElementById(id); if (!btn) return;
  const press = (e) => { 
    e.preventDefault(); 
    if (key === 'w' && !state.shiftActive && !intro.active) startShift();
    if (state.paused) return; 
    keys[key] = true; 
  };
  const release = (e) => { e.preventDefault(); keys[key] = false; };
  btn.addEventListener('pointerdown', press); btn.addEventListener('pointerup', release);
  btn.addEventListener('pointerleave', release);
  btn.addEventListener('touchstart', press, {passive: false}); btn.addEventListener('touchend', release, {passive: false});
}
bindTouch('btn-left', 'a'); bindTouch('btn-right', 'd'); bindTouch('btn-gas', 'w'); bindTouch('btn-brake', 's');
document.getElementById('btn-cam').addEventListener('click', (e) => { e.preventDefault(); state.cockpit = !state.cockpit; });

const startBtn = document.getElementById('startBtn');
startBtn.addEventListener('click', (e) => {
  e.preventDefault(); initAudio(); 
  document.getElementById('intro').classList.add('fade-out');
  document.body.classList.remove('intro');
  setTimeout(() => { document.getElementById('intro').style.display = 'none'; }, 800);
  intro.transitioning = true; intro.transition = 0;
});

generateCity();
updateHUD();
animate();

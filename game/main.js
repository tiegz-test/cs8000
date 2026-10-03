import * as THREE from 'three';
import { makeHeightFn } from './terrain.js';
import { makeSkyDome, makeClouds, sunDirection, HORIZON } from './sky.js';
import { makeCockpit } from './cockpit.js';
import { BUILD } from './version.js';
import { makeGrassTexture, breakUpTiling } from './grass.js';

const SIZE = 600, SEGS = 220, EYE = 1.7;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.prepend(renderer.domElement);
renderer.autoClear = false; // world pass, then cockpit pass on top

const scene = new THREE.Scene();
scene.background = HORIZON.clone();
scene.fog = new THREE.Fog(HORIZON, 80, 420); // matches the sky's horizon color
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 600);
camera.rotation.order = 'YXZ';

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x3a5a2a, 1.1));
const SUN_DIR = sunDirection(40, 35); // azimuth 40deg (NE), 35deg above the horizon
const sun = new THREE.DirectionalLight(0xfff2d0, 1.6);
sun.position.copy(SUN_DIR).multiplyScalar(100);
scene.add(sun);
const skyDome = makeSkyDome(SUN_DIR);
scene.add(skyDome);
const clouds = makeClouds();
scene.add(clouds);
const cockpit = makeCockpit(SUN_DIR);

let terrain, heightAt;
const grass = makeGrassTexture();
grass.repeat.set(64, 64); // ~9m tiles: big enough to read on a phone
renderer.capabilities && (grass.anisotropy = renderer.capabilities.getMaxAnisotropy());
const LOW = new THREE.Color(0x7ccf55), HIGH = new THREE.Color(0x0f4a1c);

function buildTerrain(seed) {
  if (terrain) { scene.remove(terrain); terrain.geometry.dispose(); terrain.material.dispose(); } // shared grass texture is kept
  heightAt = makeHeightFn(seed);
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  let maxH = 1, px = 0, pz = 0;
  for (let i = 0; i < pos.count; i++) {
    const y = heightAt(pos.getX(i), pos.getZ(i));
    pos.setY(i, y);
    if (y > maxH) { maxH = y; px = pos.getX(i); pz = pos.getZ(i); }
  }
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, pos.getY(i) / maxH);
    c.copy(LOW).lerp(HIGH, Math.pow(t, 0.8)); // higher = darker green
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: grass });
  breakUpTiling(mat);
  terrain = new THREE.Mesh(geo, mat);
  scene.add(terrain);
  // spawn ~150m from the tallest peak, facing it
  const d = Math.hypot(px, pz) || 1, back = Math.min(150, d);
  const sx = px - (px / d) * back, sz = pz - (pz / d) * back;
  player.pos.set(sx, heightAt(sx, sz) + EYE, sz);
  player.yaw = Math.atan2(-(px - sx), -(pz - sz));
  player.pitch = 0.12;
}

const player = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
const keys = {};
const stick = { x: 0, y: 0 };

// --- input: keyboard / mouse ---
addEventListener('keydown', (e) => { keys[e.code] = true; });
addEventListener('keyup', (e) => { keys[e.code] = false; });
const canvas = renderer.domElement;
function look(dx, dy, k) {
  player.yaw -= dx * k;
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - dy * k));
}
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) look(e.movementX, e.movementY, 0.0022);
});
canvas.addEventListener('click', () => {
  if (!matchMedia('(pointer: coarse)').matches) canvas.requestPointerLock?.();
});

// --- input: touch (left = virtual stick, right = drag to look) ---
const stickEl = document.getElementById('stick'), knob = document.getElementById('knob');
const R = 60;
let stickId = null, lookId = null, lastX = 0, lastY = 0;
const touchUI = matchMedia('(pointer: coarse)').matches;
if (touchUI) stickEl.style.display = 'block';

function setStick(t) {
  const r = stickEl.getBoundingClientRect();
  let dx = t.clientX - (r.left + R), dy = t.clientY - (r.top + R);
  const len = Math.hypot(dx, dy), m = Math.min(len, R);
  if (len > 0) { dx = (dx / len) * m; dy = (dy / len) * m; }
  stick.x = dx / R; stick.y = dy / R;
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
}
function endStick() { stickId = null; stick.x = stick.y = 0; knob.style.transform = ''; }

stickEl.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (stickId === null) { stickId = e.changedTouches[0].identifier; setStick(e.changedTouches[0]); }
}, { passive: false });
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) if (lookId === null) { lookId = t.identifier; lastX = t.clientX; lastY = t.clientY; }
}, { passive: false });
addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === stickId) setStick(t);
    else if (t.identifier === lookId) { look(t.clientX - lastX, t.clientY - lastY, 0.005); lastX = t.clientX; lastY = t.clientY; }
  }
}, { passive: false });
const touchEnd = (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === stickId) endStick();
    if (t.identifier === lookId) lookId = null;
  }
};
addEventListener('touchend', touchEnd);
addEventListener('touchcancel', touchEnd);

// --- start overlay / new map ---
const startEl = document.getElementById('start');
startEl.addEventListener('click', () => { startEl.style.display = 'none'; });
if (location.hash === '#go') startEl.style.display = 'none';
let seed = Number(new URLSearchParams(location.search).get('seed')) || Math.floor(Math.random() * 1e6);
document.getElementById('new').addEventListener('click', (e) => {
  e.stopPropagation();
  seed = Math.floor(Math.random() * 1e6);
  buildTerrain(seed);
});
buildTerrain(seed);

// --- loop ---
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  cockpit.resize(camera.aspect);
}
addEventListener('resize', resize);
resize();

const hud = document.getElementById('hud');
const clock = new THREE.Clock();
const half = SIZE / 2 - 5;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  let fx = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - stick.y;
  let sx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + stick.x;
  const len = Math.hypot(fx, sx);
  if (len > 1) { fx /= len; sx /= len; }
  const speed = (keys.ShiftLeft || keys.ShiftRight ? 14 : 7) * dt;
  const prevX = player.pos.x, prevZ = player.pos.z;
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  player.pos.x = Math.max(-half, Math.min(half, player.pos.x + (-sin * fx + cos * sx) * speed));
  player.pos.z = Math.max(-half, Math.min(half, player.pos.z + (-cos * fx - sin * sx) * speed));
  // follow the ground smoothly
  const target = heightAt(player.pos.x, player.pos.z) + EYE;
  player.pos.y += (target - player.pos.y) * Math.min(1, dt * 12);

  skyDome.position.copy(player.pos);
  clouds.userData.update(dt, player.pos);
  camera.position.copy(player.pos);
  camera.rotation.set(player.pitch, player.yaw, 0);
  renderer.clear();
  renderer.render(scene, camera);
  cockpit.update(dt, {
    camQuat: camera.quaternion,
    alt: player.pos.y,
    heading: ((-THREE.MathUtils.radToDeg(player.yaw)) % 360 + 360) % 360,
    speed: dt > 0 ? Math.hypot(player.pos.x - prevX, player.pos.z - prevZ) / dt : 0,
  });
  renderer.clearDepth();
  renderer.render(cockpit.scene, cockpit.camera);
  hud.textContent = `build ${BUILD}  seed ${seed}  alt ${player.pos.y.toFixed(0)}m  grass x${grass.repeat.x}`;
  requestAnimationFrame(tick);
}
tick();

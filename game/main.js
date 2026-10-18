import * as THREE from 'three';
import { makeHeightFn } from './terrain.js';
import { makeSkyDome, makeClouds, sunDirection, HORIZON } from './sky.js';
import { stepVertical, THRUST_DELAY } from './physics.js';
import { makeCollisionWorld } from './collision.js';
import { makeRocks } from './rocks.js';
import { makeSmoke } from './smoke.js';
import { makePilot } from './pilot.js';
import { initAudio, beep, setThruster } from './audio.js';
import { makeRivers } from './rivers.js';
import { makePines } from './trees.js';
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

let terrain, heightAt, trees, rivers, pilot, rocks, smoke;
const world = makeCollisionWorld();
const RADAR_RANGE = 150;                    // meters; beyond this the blip sits on the rim
const grass = makeGrassTexture();
grass.repeat.set(64, 64); // ~9m tiles: big enough to read on a phone
renderer.capabilities && (grass.anisotropy = renderer.capabilities.getMaxAnisotropy());
const LOW = new THREE.Color(0x7ccf55), HIGH = new THREE.Color(0x0f4a1c), MUD = new THREE.Color(0x6a5a38);

function buildTerrain(seed) {
  if (terrain) { scene.remove(terrain); terrain.geometry.dispose(); terrain.material.dispose(); } // shared grass texture is kept
  const base = makeHeightFn(seed);
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  // tallest peak (from the uncarved terrain) decides where we spawn
  let maxH = 1, px = 0, pz = 0;
  for (let i = 0; i < pos.count; i++) {
    const y = base(pos.getX(i), pos.getZ(i));
    if (y > maxH) { maxH = y; px = pos.getX(i); pz = pos.getZ(i); }
  }
  const d = Math.hypot(px, pz) || 1, back = Math.min(150, d);
  const sx = px - (px / d) * back, sz = pz - (pz / d) * back;

  if (rivers) { scene.remove(rivers.group); rivers.dispose(); }
  rivers = makeRivers({ base, seed, size: SIZE, maxH, avoid: { x: sx, z: sz } });
  scene.add(rivers.group);
  heightAt = rivers.heightAt;                 // base terrain with riverbeds carved in
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, pos.getY(i) / maxH);
    c.copy(LOW).lerp(HIGH, Math.pow(t, 0.8)); // higher = darker green
    c.lerp(MUD, rivers.mud(pos.getX(i), pos.getZ(i)) * 0.85); // muddy riverbanks
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: grass });
  breakUpTiling(mat);
  terrain = new THREE.Mesh(geo, mat);
  scene.add(terrain);
  // spawn ~150m from the tallest peak, facing it
  player.pos.set(sx, heightAt(sx, sz) + EYE, sz);
  player.yaw = Math.atan2(-(px - sx), -(pz - sz));
  player.pitch = 0.12;
  player.vy = 0; player.vx = 0; player.vz = 0; player.grounded = true; player.thrusting = false; player.hold = 0;

  if (trees) { scene.remove(trees.group); trees.dispose(); }
  trees = makePines({ heightAt, maxH, seed, size: SIZE, avoid: { x: sx, z: sz }, exclude: (x, z) => rivers.distance(x, z) < 11 });
  scene.add(trees.group);

  // the stranded pilot, about halfway across the map from where we start
  if (pilot) { scene.remove(pilot.group); pilot.dispose(); }
  pilot = makePilot({ from: { x: sx, z: sz }, heightAt, riverDistance: rivers.distance, size: SIZE, seed, distance: 300 });
  scene.add(pilot.group);

  // a column of smoke rising from the target so it can be spotted from far away
  if (smoke) { scene.remove(smoke.group); smoke.dispose(); }
  smoke = makeSmoke({ x: pilot.x, y: heightAt(pilot.x, pilot.z), z: pilot.z });
  scene.add(smoke.group);
  player.yaw = Math.atan2(-(pilot.x - sx), -(pilot.z - sz));      // start out facing the smoke

  // rocks: keep clear of the spawn point, the beacon and the riverbeds
  if (rocks) { scene.remove(rocks.group); rocks.dispose(); }
  rocks = makeRocks({ heightAt, maxH, seed, size: SIZE, avoid: [{ x: sx, z: sz, r: 10 }, { x: pilot.x, z: pilot.z, r: 8 }], exclude: (x, z) => rivers.distance(x, z) < 8 });
  scene.add(rocks.group);
  world.set(trees.colliders, rocks.colliders);
}

const player = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, vy: 0, grounded: true, vx: 0, vz: 0, thrusting: false, hold: 0, capY: 0 };
let touchJumpHeld = false;                // JUMP button currently pressed
let jumpBuffer = 0;                       // seconds a jump press stays queued (forgives early presses)
const keys = {};
const stick = { x: 0, y: 0 };

// --- input: keyboard / mouse ---
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) jumpBuffer = 0.12; }
});
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
startEl.addEventListener('click', () => { startEl.style.display = 'none'; initAudio(); });
if (location.hash === '#go') startEl.style.display = 'none';
let seed = Number(new URLSearchParams(location.search).get('seed')) || Math.floor(Math.random() * 1e6);
const jumpBtn = document.getElementById('jump');
if (touchUI) jumpBtn.style.display = 'block';
jumpBtn.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); jumpBuffer = 0.12; touchJumpHeld = true; }, { passive: false });
const releaseJump = (e) => { e.stopPropagation(); touchJumpHeld = false; };
jumpBtn.addEventListener('touchend', releaseJump);
jumpBtn.addEventListener('touchcancel', releaseJump);
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
  const speed = keys.ShiftLeft || keys.ShiftRight ? 14 : 7;
  const prevX = player.pos.x, prevZ = player.pos.z;
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const wantX = (-sin * fx + cos * sx) * speed, wantZ = (-cos * fx - sin * sx) * speed;
  if (player.grounded) { player.vx = wantX; player.vz = wantZ; }
  else {                                   // in the air you keep your momentum, with a little steering
    const k = Math.min(1, dt * 1.2);
    player.vx += (wantX - player.vx) * k; player.vz += (wantZ - player.vz) * k;
  }
  player.pos.x = Math.max(-half, Math.min(half, player.pos.x + player.vx * dt));
  player.pos.z = Math.max(-half, Math.min(half, player.pos.z + player.vz * dt));
  const bump = world.resolve(player.pos, player.pos.y - EYE, prevX, prevZ);   // trees and tall rocks push back
  if (bump) {                                                                    // slide along the obstacle instead of stopping dead
    const into = player.vx * bump.nx + player.vz * bump.nz;
    if (into < 0) { player.vx -= into * bump.nx; player.vz -= into * bump.nz; }
  }

  // vertical motion: glide over the ground, or follow real jump/fall physics
  jumpBuffer = Math.max(0, jumpBuffer - dt);
  const body = { y: player.pos.y, vy: player.vy, grounded: player.grounded, thrusting: player.thrusting, hold: player.hold, capY: player.capY };
  const jumpHeld = !!keys.Space || touchJumpHeld;
  if (stepVertical(body, Math.max(heightAt(player.pos.x, player.pos.z), world.rockTop(player.pos.x, player.pos.z)) + EYE, dt, jumpBuffer > 0 && player.grounded, jumpHeld)) jumpBuffer = 0;
  player.pos.y = body.y; player.vy = body.vy; player.grounded = body.grounded;
  player.thrusting = body.thrusting; player.hold = body.hold; player.capY = body.capY;
  setThruster(player.thrusting);               // booster roar: a puff on a tap, a long burn while held

  trees.update(player.pos);
  rivers.update(dt);
  pilot.update(clock.elapsedTime, player.pos, dt);
  smoke.update(clock.elapsedTime);
  skyDome.position.copy(player.pos);
  clouds.userData.update(dt, player.pos);
  camera.position.copy(player.pos);
  camera.rotation.set(player.pitch, player.yaw, 0);
  renderer.clear();
  renderer.render(scene, camera);
  const odx = pilot.x - player.pos.x, odz = pilot.z - player.pos.z;
  const fwd = odx * -Math.sin(player.yaw) + odz * -Math.cos(player.yaw);
  const rgt = odx * Math.cos(player.yaw) + odz * -Math.sin(player.yaw);
  cockpit.update(dt, {
    radarRange: RADAR_RANGE,
    target: { dist: Math.hypot(odx, odz), bearing: Math.atan2(rgt, fwd) },
    ping: (inRange, dist) => beep(inRange ? 700 + 700 * (1 - dist / RADAR_RANGE) : 480, inRange ? 0.07 : 0.035),
    camQuat: camera.quaternion,
    thrust: player.thrusting && player.hold >= THRUST_DELAY,
    edge: Math.max(Math.abs(player.pos.x), Math.abs(player.pos.z)) > half - 15,
    alt: player.pos.y,
    heading: ((-THREE.MathUtils.radToDeg(player.yaw)) % 360 + 360) % 360,
    speed: dt > 0 ? Math.hypot(player.pos.x - prevX, player.pos.z - prevZ) / dt : 0,
  });
  renderer.clearDepth();
  renderer.render(cockpit.scene, cockpit.camera);
  hud.textContent = `build ${BUILD}  seed ${seed}  alt ${player.pos.y.toFixed(0)}m  grass x${grass.repeat.x}  trees ${trees.count}  rocks ${rocks.count}  rivers ${rivers.count}`;
  requestAnimationFrame(tick);
}
tick();

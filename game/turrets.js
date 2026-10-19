import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

// Enemy turrets: a glowing green orb on every mountain peak. A turret fires only when the player is
// moving, within range and in its line of sight. It shoots visible green laser bolts that travel at a
// finite speed, so a moving player can dodge them.

const RANGE = 340;            // m
const BOLT_SPEED = 85;        // m/s
const BOLT_LENGTH = 12;       // m, visual length of the streak
const HIT_RADIUS = 1.6;       // m, how close a bolt must pass to the player's body to hit
const FIRE_EVERY = 2.4;       // s between shots from one turret (plus a little random)
const CHARGE_TIME = 0.35;     // s the orb flares before each shot (a visible warning)
const LEAD = 0.4;             // fraction of the player's motion the turret aims ahead by (so dodging works)
const MAX_BOLTS = 40;
const LOS_STEP = 5;           // m between terrain samples when checking line of sight

// every distinct local maximum that is high enough to count as a mountain peak
export function findPeaks(heightAt, maxH, size, { minAlt = 0.42, minGap = 70, limit = 8 } = {}) {
  const step = 8, n = Math.floor((size - 20) / step), x0 = -size / 2 + 10;
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = heightAt(x0 + i * step, x0 + j * step);
  const found = [];
  for (let j = 2; j < n - 2; j++) for (let i = 2; i < n - 2; i++) {
    const v = h[j * n + i];
    if (v < minAlt * maxH) continue;
    let top = true;
    for (let dj = -2; dj <= 2 && top; dj++) for (let di = -2; di <= 2; di++) if ((di || dj) && h[(j + dj) * n + i + di] > v) { top = false; break; }
    if (top) found.push({ x: x0 + i * step, z: x0 + j * step, y: v });
  }
  found.sort((a, b) => b.y - a.y);
  const peaks = [];
  for (const f of found) {
    if (peaks.length >= limit) break;
    if (peaks.some((p) => Math.hypot(p.x - f.x, p.z - f.z) < minGap)) continue;
    // refine on a finer grid around the cell
    let best = f;
    for (let dz = -step; dz <= step; dz += 2) for (let dx = -step; dx <= step; dx += 2) {
      const y = heightAt(f.x + dx, f.z + dz);
      if (y > best.y) best = { x: f.x + dx, z: f.z + dz, y };
    }
    peaks.push(best);
  }
  if (!peaks.length) {                                           // always at least the highest point of the map
    let best = { x: 0, z: 0, y: -Infinity };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (h[j * n + i] > best.y) best = { x: x0 + i * step, z: x0 + j * step, y: h[j * n + i] };
    peaks.push(best);
  }
  return peaks;
}

function glowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(210,255,215,1)');
  g.addColorStop(0.22, 'rgba(70,255,100,0.6)');
  g.addColorStop(1, 'rgba(0,255,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}

export function makeTurrets({ heightAt, maxH, size, seed }) {
  const rand = mulberry32(seed * 11 + 5);
  const group = new THREE.Group();
  const glowTex = glowTexture();
  const coreGeo = new THREE.SphereGeometry(1.15, 16, 12);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0x6dff7c });
  const ringGeo = new THREE.TorusGeometry(2.1, 0.12, 6, 28);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x35e866 });
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });

  const peaks = findPeaks(heightAt, maxH, size);
  const turrets = peaks.map((pk, i) => {
    const g = new THREE.Group();
    g.position.set(pk.x, pk.y + 3.2, pk.z);
    g.add(new THREE.Mesh(coreGeo, coreMat));
    const ring = new THREE.Mesh(ringGeo, ringMat);
    g.add(ring);
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(16);
    g.add(glow);
    group.add(g);
    return { g, ring, glow, pos: g.position, cooldown: 1 + rand() * FIRE_EVERY, charge: -1, phase: rand() * 6.28 };
  });

  // laser bolts: a pool of reusable streaks
  const boltGeo = new THREE.CylinderGeometry(0.3, 0.3, BOLT_LENGTH, 6);
  boltGeo.translate(0, -BOLT_LENGTH / 2, 0);                      // tail trails behind the head (origin at the head)
  const boltMat = new THREE.MeshBasicMaterial({ color: 0x7dff8c, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const bolts = [];
  for (let i = 0; i < MAX_BOLTS; i++) {
    const b = new THREE.Group();
    b.add(new THREE.Mesh(boltGeo, boltMat));
    const headGlow = new THREE.Sprite(glowMat);
    headGlow.scale.setScalar(5);
    b.add(headGlow);
    b.visible = false;
    group.add(b);
    bolts.push({ obj: b, active: false, dir: new THREE.Vector3(), travelled: 0, prev: new THREE.Vector3() });
  }
  const up = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3(), aim = new THREE.Vector3(), from = new THREE.Vector3(), seg = new THREE.Vector3();

  function hasLineOfSight(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz), n = Math.floor(len / LOS_STEP);
    for (let i = 2; i < n; i++) {                                 // skip the first samples, right at the peak
      const t = i / n, x = a.x + dx * t, y = a.y + dy * t, z = a.z + dz * t;
      if (heightAt(x, z) > y) return false;
    }
    return true;
  }

  function fire(t, player, onFire) {
    const bolt = bolts.find((b) => !b.active);
    if (!bolt) return;
    from.copy(t.pos);
    const dist = from.distanceTo(player.pos), flight = dist / BOLT_SPEED;
    aim.set(player.pos.x + player.vx * flight * LEAD + (rand() - 0.5) * 4, player.pos.y - 0.5 + player.vy * flight * LEAD * 0.5, player.pos.z + player.vz * flight * LEAD + (rand() - 0.5) * 4);
    bolt.dir.copy(aim).sub(from).normalize();
    bolt.obj.position.copy(from);
    bolt.obj.quaternion.setFromUnitVectors(up, bolt.dir);        // the streak's head points where it is going
    bolt.prev.copy(from);
    bolt.travelled = 0;
    bolt.active = true; bolt.obj.visible = true;
    onFire?.(dist);
  }

  const state = { grace: 5, tick: 0 };
  // player: { pos, vx, vy, vz, moving }; returns the number of bolts that hit this frame
  function update(dt, time, player, { onFire, onHit, enabled = true } = {}) {
    // idle animation
    for (const t of turrets) {
      if (t.dead) continue;
      t.ring.rotation.x = Math.PI / 2 + Math.sin(time * 0.8 + t.phase) * 0.5;
      t.ring.rotation.z = time * 1.4 + t.phase;
      const charging = t.charge >= 0;
      const pulse = 1 + Math.sin(time * 3 + t.phase) * 0.08 + (charging ? 0.8 * (t.charge / CHARGE_TIME) : 0);
      t.glow.scale.setScalar(16 * pulse);
    }

    let hits = 0;
    state.grace = Math.max(0, state.grace - dt);
    const live = enabled && state.grace <= 0;

    // firing logic
    for (const t of turrets) {
      if (t.dead) continue;                                      // a destroyed turret never fires again
      if (!live) { t.charge = -1; continue; }
      if (t.charge >= 0) {                                       // winding up to fire
        t.charge += dt;
        if (t.charge >= CHARGE_TIME) { t.charge = -1; fire(t, player, onFire); t.cooldown = FIRE_EVERY + rand() * 0.8; }
        continue;
      }
      t.cooldown -= dt;
      if (t.cooldown > 0) continue;
      const dist = t.pos.distanceTo(player.pos);
      if (!player.moving || dist > RANGE) { t.cooldown = 0.25; continue; }
      if (!hasLineOfSight(t.pos, tmp.set(player.pos.x, player.pos.y - 0.5, player.pos.z))) { t.cooldown = 0.25; continue; }
      t.charge = 0;                                              // visible and moving: start charging
    }

    // bolt flight and hits
    for (const b of bolts) {
      if (!b.active) continue;
      b.prev.copy(b.obj.position);
      b.obj.position.addScaledVector(b.dir, BOLT_SPEED * dt);
      b.travelled += BOLT_SPEED * dt;
      const p = b.obj.position;
      // closest point on this frame's path to the player's body (so fast bolts can't skip through)
      seg.copy(p).sub(b.prev);
      const segLen2 = seg.lengthSq() || 1e-6;
      tmp.set(player.pos.x - b.prev.x, player.pos.y - 0.6 - b.prev.y, player.pos.z - b.prev.z);
      const u = Math.min(1, Math.max(0, tmp.dot(seg) / segLen2));
      tmp.addScaledVector(seg, -u);
      if (enabled && tmp.length() < HIT_RADIUS) { b.active = false; b.obj.visible = false; hits++; onHit?.(); continue; }
      if (b.travelled > RANGE + 150 || p.y < heightAt(p.x, p.z)) { b.active = false; b.obj.visible = false; }   // flew off or hit the ground
    }
    return hits;
  }

  // destroy every live turret within `radius` of a point (3D); returns where they were
  function damageAt(x, y, z, radius) {
    const killed = [];
    for (const t of turrets) {
      if (t.dead || Math.hypot(t.pos.x - x, t.pos.y - y, t.pos.z - z) > radius) continue;
      t.dead = true; t.charge = -1; t.g.visible = false;
      killed.push({ x: t.pos.x, y: t.pos.y, z: t.pos.z });
    }
    return killed;
  }
  // is a live turret within `radius` of this point? (a missile's proximity fuse)
  const nearTurret = (x, y, z, radius) => turrets.some((t) => !t.dead && Math.hypot(t.pos.x - x, t.pos.y - y, t.pos.z - z) < radius);

  function clearBolts() { for (const b of bolts) { b.active = false; b.obj.visible = false; } }

  return {
    group, update, clearBolts, peaks, damageAt, nearTurret, total: turrets.length, get count() { return turrets.filter((t) => !t.dead).length; },
    resetGrace(s = 5) { state.grace = s; },
    activeBolts: () => bolts.filter((b) => b.active).length,
    dispose() { coreGeo.dispose(); coreMat.dispose(); ringGeo.dispose(); ringMat.dispose(); glowMat.dispose(); glowTex.dispose(); boltGeo.dispose(); boltMat.dispose(); },
  };
}

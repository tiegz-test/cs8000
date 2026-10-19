import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

// The stranded pilot: a low-poly figure in a white spacesuit with the helmet off (held at their side),
// waving at us with one arm. Built from simple primitives, so it costs a few dozen triangles.

// Pick a spot about `distance` meters from the player: on gentle ground, away from water.
function pickSpot({ from, heightAt, riverDistance, size, seed, distance, avoid = [] }) {
  const rand = mulberry32(seed * 17 + 3);
  const lim = size / 2 - 25;
  for (let i = 0; i < 400; i++) {
    const a = rand() * Math.PI * 2, d = distance * (0.9 + rand() * 0.2);
    const x = from.x + Math.cos(a) * d, z = from.z + Math.sin(a) * d;
    if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
    if (riverDistance(x, z) < 16) continue;
    if (avoid.some((a) => Math.hypot(x - a.x, z - a.z) < a.r)) continue;     // keep clear of the spawn and other pilots
    const slope = Math.hypot(heightAt(x + 3, z) - heightAt(x - 3, z), heightAt(x, z + 3) - heightAt(x, z - 3)) / 6;
    if (slope > 0.35) continue;
    return { x, z };
  }
  return { x: Math.max(-lim, Math.min(lim, -from.x)), z: Math.max(-lim, Math.min(lim, -from.z)) };  // fallback: opposite side
}


const SCALE = 1.5;     // a little larger than life so the wave reads from a distance

export function makePilot({ from, heightAt, riverDistance, size, seed, distance = 300, avoid = [] }) {
  const { x, z } = pickSpot({ from, heightAt, riverDistance, size, seed, distance, avoid });
  const group = new THREE.Group();
  group.position.set(x, heightAt(x, z), z);
  const body = new THREE.Group();            // everything that turns to face the player
  body.scale.setScalar(SCALE);
  group.add(body);

  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, flatShading: true, ...extra });
  const suit = mat(0xf1f1ee), suitShade = mat(0xd9d9d6), orange = mat(0xff6a1a), gray = mat(0x8a8d93, { metalness: 0.4 });
  const dark = mat(0x23252a), skin = mat(0xd8a57c, { flatShading: false }), hair = mat(0x3a2a1c);
  const glove = mat(0xe5e5e2), visorMat = mat(0xd2a64a, { metalness: 0.9, roughness: 0.2 });
  const geos = [], add = (parent, geo, material, x = 0, y = 0, z = 0) => { geos.push(geo); const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); parent.add(m); return m; };

  // legs and boots, each on a hip pivot so they can swing when running
  const HIP = 0.975;
  const legs = [-1, 1].map((sx) => {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.1, HIP, 0);
    body.add(hip);
    add(hip, new THREE.CylinderGeometry(0.085, 0.07, 0.85, 8), suit, 0, 0.55 - HIP, 0);
    add(hip, new THREE.CylinderGeometry(0.09, 0.09, 0.05, 8), orange, 0, 0.8 - HIP, 0);            // thigh band
    add(hip, new THREE.BoxGeometry(0.15, 0.1, 0.3), gray, 0, 0.06 - HIP, 0.05);                    // boot
    add(hip, new THREE.BoxGeometry(0.16, 0.03, 0.31), dark, 0, 0.015 - HIP, 0.05);                 // sole
    return hip;
  });
  // hips and belt
  add(body, new THREE.BoxGeometry(0.36, 0.2, 0.22), suitShade, 0, 1.0, 0);
  add(body, new THREE.BoxGeometry(0.38, 0.05, 0.24), orange, 0, 1.1, 0);
  // torso with chest control box
  const torso = add(body, new THREE.CylinderGeometry(0.21, 0.18, 0.5, 8), suit, 0, 1.38, 0);
  torso.scale.z = 0.62;
  add(body, new THREE.BoxGeometry(0.2, 0.12, 0.04), dark, 0, 1.36, 0.13);
  for (const [i, c] of [0xff3b2a, 0x33dd66, 0xffb02e].entries()) add(body, new THREE.BoxGeometry(0.03, 0.03, 0.02), mat(c, { emissive: c, emissiveIntensity: 0.6 }), -0.06 + i * 0.06, 1.36, 0.155);
  add(body, new THREE.BoxGeometry(0.34, 0.04, 0.02), orange, 0, 1.5, 0.125);                       // chest stripe
  // life-support backpack
  add(body, new THREE.BoxGeometry(0.34, 0.46, 0.16), gray, 0, 1.38, -0.17);
  for (const sx of [-1, 1]) add(body, new THREE.CylinderGeometry(0.05, 0.05, 0.38, 8), suitShade, sx * 0.09, 1.38, -0.28);
  // collar and head
  add(body, new THREE.TorusGeometry(0.105, 0.03, 6, 12), gray, 0, 1.64, 0).rotation.x = Math.PI / 2;
  const head = new THREE.Group();
  head.position.set(0, 1.76, 0);
  body.add(head);
  const skull = add(head, new THREE.SphereGeometry(0.115, 12, 10), skin);
  skull.scale.set(0.95, 1.1, 1);
  const cap = add(head, new THREE.SphereGeometry(0.122, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hair, 0, 0.012, -0.012);
  cap.scale.set(0.97, 1.05, 1.02);
  for (const sx of [-1, 1]) {
    add(head, new THREE.SphereGeometry(0.014, 6, 6), dark, sx * 0.042, 0.015, 0.108);              // eyes
    add(head, new THREE.BoxGeometry(0.045, 0.01, 0.01), hair, sx * 0.045, 0.05, 0.11);             // brows
    add(head, new THREE.SphereGeometry(0.022, 6, 6), skin, sx * 0.118, -0.005, 0);                 // ears
  }
  add(head, new THREE.SphereGeometry(0.02, 6, 6), skin, 0, -0.015, 0.118);                          // nose
  const smile = add(head, new THREE.TorusGeometry(0.04, 0.006, 5, 12, Math.PI), mat(0x8a3a30, { flatShading: false }), 0, -0.04, 0.1);
  smile.rotation.z = Math.PI;                                                                       // open side up = a smile

  // arms: shoulder pivot -> upper arm -> elbow pivot -> forearm -> glove
  function arm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.255, 1.52, 0);
    body.add(shoulder);
    add(shoulder, new THREE.SphereGeometry(0.1, 8, 6), suit);
    add(shoulder, new THREE.CylinderGeometry(0.07, 0.062, 0.3, 8), suit, 0, -0.17, 0);
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.32, 0);
    shoulder.add(elbow);
    add(elbow, new THREE.SphereGeometry(0.066, 8, 6), suitShade);
    add(elbow, new THREE.CylinderGeometry(0.062, 0.054, 0.28, 8), suit, 0, -0.15, 0);
    add(elbow, new THREE.CylinderGeometry(0.066, 0.066, 0.04, 8), orange, 0, -0.1, 0);              // cuff stripe
    const hand = new THREE.Group();
    hand.position.set(0, -0.33, 0);
    elbow.add(hand);
    add(hand, new THREE.SphereGeometry(0.06, 8, 6), glove);
    return { shoulder, elbow, hand };
  }
  const right = arm(1);                          // the waving arm
  right.shoulder.rotation.z = 2.55;              // raised up and out
  right.shoulder.rotation.x = -0.15;
  const left = arm(-1);                          // holds the helmet at their side
  left.shoulder.rotation.z = -0.1;
  left.elbow.rotation.x = -0.75;
  const helmet = new THREE.Group();
  helmet.position.set(0, -0.12, 0.02);
  left.hand.add(helmet);
  const shell = add(helmet, new THREE.SphereGeometry(0.15, 12, 10), suit);
  shell.scale.set(1, 1.05, 1.05);
  const visor = add(helmet, new THREE.SphereGeometry(0.152, 12, 8, -0.9, 1.8, 0.9, 1.1), visorMat);
  visor.scale.set(1.01, 1.06, 1.06);
  add(helmet, new THREE.TorusGeometry(0.13, 0.02, 5, 14), gray, 0, -0.1, 0).rotation.x = Math.PI / 2;
  helmet.rotation.y = 0.3;

  // --- behaviour: wave until the player comes close and in view, then run over to them ---
  const SPOT_DIST = 15.24;      // 50 feet
  const STOP_DIST = 3.2;        // stop this far from the player
  const RUN_SPEED = 4.6;        // m/s
  const WALK_SPEED = 1.8;       // m/s, the last steps through the hatch
  const DOOR_SIDE = 2.1;        // m to the right of the mech, where the hatch is
  const LOSE_DIST = 8;          // if the player gets this far away mid-boarding, go back to running after them
  const lerp = (a, b, t) => a + (b - a) * t;
  body.rotation.order = 'YXZ';  // turn first, then lean forward in the facing direction
  // 'waiting' -> 'running' (once they've spotted you) -> 'boarding' (go to the hatch) -> 'entering' (walk in) -> 'done'
  let state = 'waiting';
  let facing = null, runW = 0, phase = 0, speedNow = 0;
  const eye = new THREE.Vector3(), look = new THREE.Vector3();

  // clear sight between two points over the terrain
  function canSee(from, to) {
    const n = Math.max(2, Math.ceil(from.distanceTo(to) / 2));
    for (let i = 1; i < n; i++) {
      const t = i / n, x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t, y = from.y + (to.y - from.y) * t;
      if (heightAt(x, z) > y) return false;
    }
    return true;
  }

  return {
    group,
    get x() { return group.position.x; },        // live, so the radar follows the pilot as they run
    get z() { return group.position.z; },
    get state() { return state; },
    spawn: { x, z },                              // where they crashed (the smoke column stays marked here)
    // opts.resolve(pos, feetY, prevX, prevZ) pushes the pilot out of trees and rocks (optional)
    update(t, playerPos, dt = 0.016, opts = {}) {
      const gp = group.position;
      const dx = playerPos.x - gp.x, dz = playerPos.z - gp.z, dist = Math.hypot(dx, dz);

      if (state === 'waiting' && dist < SPOT_DIST) {
        eye.set(gp.x, gp.y + 2.4, gp.z);
        look.set(playerPos.x, playerPos.y, playerPos.z);
        if (canSee(eye, look)) state = 'running';                    // they've seen you!
      }

      if (state === 'done') return;

      // run toward the player until close...
      speedNow = 0;
      const move = (tx, tz, speed, avoidObstacles) => {
        const ddx = tx - gp.x, ddz = tz - gp.z, dd = Math.hypot(ddx, ddz);
        if (dd < 1e-3) return 0;
        const step = Math.min(speed * dt, dd);
        const px = gp.x, pz = gp.z;
        gp.x += (ddx / dd) * step;
        gp.z += (ddz / dd) * step;
        if (avoidObstacles) opts.resolve?.(gp, gp.y, px, pz);
        gp.y = heightAt(gp.x, gp.z);
        return Math.hypot(gp.x - px, gp.z - pz) / Math.max(dt, 1e-4);
      };
      if (state === 'running') {
        if (dist > STOP_DIST) speedNow = move(playerPos.x, playerPos.z, RUN_SPEED, true);
        else state = 'boarding';                                       // reached the mech: head for the hatch
      }
      // ...then go round to the hatch on the mech's right side and walk in
      if (state === 'boarding' || state === 'entering') {
        const yaw = opts.playerYaw ?? 0;
        const hx = playerPos.x + Math.cos(yaw) * DOOR_SIDE - Math.sin(yaw) * 0.3;
        const hz = playerPos.z - Math.sin(yaw) * DOOR_SIDE - Math.cos(yaw) * 0.3;
        if (dist > LOSE_DIST) state = 'running';                       // the mech moved off: chase it again
        else if (state === 'boarding') {
          speedNow = move(hx, hz, RUN_SPEED, false);
          if (Math.hypot(hx - gp.x, hz - gp.z) < 0.5) state = 'entering';
        } else {
          speedNow = move(playerPos.x, playerPos.z, WALK_SPEED, false);   // step through the open hatch
          if (dist < 0.9) { state = 'done'; group.visible = false; return; }
        }
      }

      // turn to face the player
      const target = Math.atan2(dx, dz);
      if (facing === null) facing = target;
      let d = target - facing; d = Math.atan2(Math.sin(d), Math.cos(d));
      facing += d * Math.min(1, dt * (speedNow > 0 ? 8 : 2.5));
      body.rotation.y = facing;

      // blend from the waving pose to the running pose
      runW += ((speedNow > 0.5 ? 1 : 0) - runW) * Math.min(1, dt * 8);
      phase += dt * (6 + speedNow * 1.4) * (runW > 0.05 ? 1 : 0);
      const swing = Math.sin(phase);
      legs[0].rotation.x = swing * 0.85 * runW;
      legs[1].rotation.x = -swing * 0.85 * runW;
      right.shoulder.rotation.z = lerp(2.55 + Math.sin(t * 6.5 + 1) * 0.06, 0.18, runW);
      right.shoulder.rotation.x = lerp(-0.15, swing * 0.95, runW);
      right.elbow.rotation.z = lerp(0.15 + Math.sin(t * 6.5) * 0.55, 0, runW);   // the wave fades out
      right.elbow.rotation.x = lerp(0, -1.15, runW);
      left.shoulder.rotation.x = lerp(Math.sin(t * 1.4) * 0.04, -swing * 0.8, runW);
      left.elbow.rotation.x = lerp(-0.75, -1.0, runW);
      body.rotation.x = 0.16 * runW;                                              // lean into the run
      body.position.y = Math.abs(Math.sin(phase)) * 0.07 * runW;                  // bounce
      body.rotation.z = Math.sin(t * 1.2) * 0.015 * (1 - runW);                   // tiny weight shift when standing
      head.rotation.z = Math.sin(t * 1.7) * 0.05 * (1 - runW);
      head.rotation.y = Math.sin(t * 0.9) * 0.12 * (1 - runW);
    },
    dispose() { geos.forEach((g) => g.dispose()); [suit, suitShade, orange, gray, dark, skin, hair, glove, visorMat].forEach((m) => m.dispose()); },
  };
}

import * as THREE from 'three';

// The player's missiles. A shot is aimed at whatever is under the crosshair (we trace the view ray to find
// that spot, then fly the missile from the launcher to it). A missile explodes on terrain, rocks, trees or
// near a turret; the blast then takes out trees and turrets around it.
const SPEED = 130;            // m/s
const MAX_RANGE = 700;        // m
const STEP = 3;               // m: collision sampling along the flight path
const TURRET_FUSE = 9;        // m: "the general area of a turret"
const MAX_MISSILES = 8;

export const BLAST_TREES = 5.5;    // m: trees within this of the blast are destroyed
export const BLAST_TURRET = 10;    // m: turrets within this of the blast are destroyed

export function makeMissiles(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const bodyGeo = new THREE.CylinderGeometry(0.22, 0.22, 3, 8);
  const noseGeo = new THREE.ConeGeometry(0.22, 0.9, 8); noseGeo.translate(0, 1.95, 0);
  const finGeo = new THREE.BoxGeometry(1.1, 0.7, 0.05); finGeo.translate(0, -1.1, 0);
  const trailGeo = new THREE.ConeGeometry(0.5, 11, 8); trailGeo.rotateX(Math.PI); trailGeo.translate(0, -1.5 - 5.5, 0);
  const white = new THREE.MeshLambertMaterial({ color: 0xf0f0ee, flatShading: true });
  const red = new THREE.MeshLambertMaterial({ color: 0xd2281c, flatShading: true });
  const trailMat = new THREE.MeshBasicMaterial({ color: 0xffa23a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const missiles = Array.from({ length: MAX_MISSILES }, () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(bodyGeo, white), new THREE.Mesh(noseGeo, red), new THREE.Mesh(finGeo, red), new THREE.Mesh(trailGeo, trailMat));
    const fin2 = new THREE.Mesh(finGeo, red); fin2.rotation.y = Math.PI / 2; g.add(fin2);
    g.visible = false; group.add(g);
    return { g, active: false, dir: new THREE.Vector3(), travelled: 0 };
  });
  const up = new THREE.Vector3(0, 1, 0), pt = new THREE.Vector3();

  // what is the player pointing at? (first terrain/rock/tree/turret along the view ray)
  function aimPoint(origin, dir, c) {
    for (let d = 4; d <= MAX_RANGE; d += STEP) {
      pt.copy(origin).addScaledVector(dir, d);
      if (pt.y <= c.heightAt(pt.x, pt.z) || pt.y <= c.world.rockTop(pt.x, pt.z) || c.trees.hitTest(pt) || c.turrets.nearTurret(pt.x, pt.y, pt.z, TURRET_FUSE)) return pt.clone();
    }
    return origin.clone().addScaledVector(dir, MAX_RANGE);
  }

  // fire from `muzzle`, toward the spot found along the view ray from `eye`
  function fire(eye, viewDir, muzzle, c) {
    const m = missiles.find((x) => !x.active);
    if (!m) return false;
    const target = aimPoint(eye, viewDir, c);
    m.dir.copy(target).sub(muzzle).normalize();
    m.g.position.copy(muzzle);
    m.g.quaternion.setFromUnitVectors(up, m.dir);
    m.travelled = 0; m.active = true; m.g.visible = true;
    return true;
  }

  // c: { heightAt, world, trees, turrets, onExplode(point) }
  function update(dt, c) {
    for (const m of missiles) {
      if (!m.active) continue;
      const dist = SPEED * dt, n = Math.max(1, Math.ceil(dist / STEP)), step = dist / n;
      for (let k = 0; k < n && m.active; k++) {
        m.g.position.addScaledVector(m.dir, step);
        m.travelled += step;
        const p = m.g.position;
        if (p.y <= c.heightAt(p.x, p.z) || p.y <= c.world.rockTop(p.x, p.z) || c.trees.hitTest(p) || c.turrets.nearTurret(p.x, p.y, p.z, TURRET_FUSE)) {
          m.active = false; m.g.visible = false;
          c.onExplode(p.clone());
        } else if (m.travelled > MAX_RANGE) {
          m.active = false; m.g.visible = false;                      // flew off into the distance
        }
      }
    }
  }

  return {
    group, fire, update, aimPoint,
    clear() { for (const m of missiles) { m.active = false; m.g.visible = false; } },
    dispose() { [bodyGeo, noseGeo, finGeo, trailGeo, white, red, trailMat].forEach((x) => x.dispose()); scene.remove(group); },
  };
}

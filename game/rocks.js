import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

// Scattered rocks and boulders. Three faceted rock shapes are drawn with instancing,
// with per-rock size (many small, a few big), squash, rotation and shade. Rocks are
// more common on slopes and higher ground, and sit partly sunk into the terrain.

function rockGeometry(seed, detail = 1) {
  const rand = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const seen = new Map();                       // displace shared vertices consistently
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, 0.72 + rand() * 0.5);
    const k = seen.get(key);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.78, p.getZ(i) * k);   // slightly flattened
  }
  const flat = g.index ? g.toNonIndexed() : g;                          // non-indexed so each face is flat-shaded
  flat.computeVertexNormals();
  return flat;
}

function noiseFn(rand) {
  const N = 64, grid = Float32Array.from({ length: N * N }, () => rand());
  const at = (x, y) => grid[((y % N + N) % N) * N + ((x % N + N) % N)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), u = x - xi, v = y - yi;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
  };
}

export function makeRocks({ heightAt, maxH, seed, size, avoid = [], exclude, candidates = 4200 }) {
  const rand = mulberry32(seed * 5 + 41);
  const cluster = noiseFn(mulberry32(seed * 23 + 9));
  const half = size / 2 - 6;
  const rocks = [];

  for (let i = 0; i < candidates; i++) {
    const x = (rand() * 2 - 1) * half, z = (rand() * 2 - 1) * half;
    if (avoid.some((a) => Math.hypot(x - a.x, z - a.z) < a.r)) continue;
    if (exclude && exclude(x, z)) continue;
    const y = heightAt(x, z);
    const slope = Math.hypot(heightAt(x + 2, z) - heightAt(x - 2, z), heightAt(x, z + 2) - heightAt(x, z - 2)) / 4;
    const alt = y / maxH;
    const groups = cluster(x / 40, z / 40) * 0.6 + cluster(x / 13, z / 13) * 0.4;      // rocks come in loose groups
    const chance = (0.05 + Math.min(1, slope * 2.2) * 0.45 + alt * 0.35) * (0.25 + groups * 1.5);
    if (rand() > chance) continue;
    const big = Math.pow(rand(), 3.2);                                                 // lots of small rocks, few boulders
    const s = 0.35 + big * (2.2 + slope * 3 + alt * 1.5);
    rocks.push({ x, y, z, s, sx: 0.8 + rand() * 0.5, sy: 0.6 + rand() * 0.45, sz: 0.8 + rand() * 0.5,
      ry: rand() * Math.PI * 2, tilt: (rand() - 0.5) * 0.5, variant: Math.floor(rand() * 3), shade: rand() });
  }

  const geos = [rockGeometry(seed * 3 + 1), rockGeometry(seed * 3 + 2), rockGeometry(seed * 3 + 3, 2)];
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const group = new THREE.Group();
  const gray = new THREE.Color(0x8c8c86), warm = new THREE.Color(0x8a7a64), dark = new THREE.Color(0x5e5d58);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  const meshes = [];

  geos.forEach((geo, v) => {
    const list = rocks.filter((r) => r.variant === v);
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((r, i) => {
      e.set(r.tilt, r.ry, -r.tilt * 0.6);
      q.setFromEuler(e);
      sc.set(r.s * r.sx, r.s * r.sy, r.s * r.sz);
      p.set(r.x, r.y + r.s * r.sy * 0.18, r.z);                // sunk partway into the ground
      m.compose(p, q, sc);
      mesh.setMatrixAt(i, m);
      col.copy(gray).lerp(r.shade > 0.55 ? warm : dark, Math.abs(r.shade - 0.5) * 1.1).multiplyScalar(0.85 + (r.shade * 7 % 1) * 0.3);
      mesh.setColorAt(i, col);
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    meshes.push(mesh);
  });

  return {
    group, count: rocks.length,
    // dome colliders matching the visible rock: horizontal radius, dome base height and dome height
    colliders: rocks.map((r) => ({ x: r.x, z: r.z, r: r.s * Math.max(r.sx, r.sz) * 0.95, cy: r.y + r.s * r.sy * 0.18, h: r.s * r.sy * 0.7 })),
    biggest: rocks.reduce((mx, r) => Math.max(mx, r.s), 0),
    dispose() { geos.forEach((g) => g.dispose()); mat.dispose(); meshes.forEach((x) => x.dispose()); },
  };
}

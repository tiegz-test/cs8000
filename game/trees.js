import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

// Pine forest drawn with instancing: one draw call per chunk and detail level.
// Trees near the camera use a 3-tier pine; distant chunks swap to a single cone.

const CHUNKS = 5;            // chunks per side
const NEAR_DIST = 140;       // switch to the cheap model beyond this distance
const CULL_DIST = 440;       // fully hidden by fog beyond this

function merge(parts) {
  const pos = [], nor = [], col = [];
  for (const { geo, color, y } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.translate(0, y, 0);
    const p = g.attributes.position, n = g.attributes.normal;
    const c = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

// ~1 unit = 1 meter at scale 1: about 9m tall.
function pineGeometryNear() {
  return merge([
    { geo: new THREE.CylinderGeometry(0.22, 0.34, 1.8, 6), color: 0x4a3322, y: 0.9 },
    { geo: new THREE.ConeGeometry(2.1, 3.4, 8), color: 0x2a7a38, y: 3.0 },
    { geo: new THREE.ConeGeometry(1.7, 3.0, 8), color: 0x308a40, y: 4.9 },
    { geo: new THREE.ConeGeometry(1.2, 2.8, 8), color: 0x389a4a, y: 6.8 },
    { geo: new THREE.ConeGeometry(0.7, 2.2, 7), color: 0x40ad55, y: 8.3 },
  ]);
}
function pineGeometryFar() {
  return merge([{ geo: new THREE.ConeGeometry(1.8, 8.5, 5), color: 0x308a40, y: 4.6 }]);
}

function noiseFn(rand) {
  const N = 64, grid = Float32Array.from({ length: N * N }, () => rand());
  const g = (x, y) => grid[((y % N + N) % N) * N + ((x % N + N) % N)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), u = x - xi, v = y - yi;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
    return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
  };
}

export function makePines({ heightAt, maxH, seed, size, avoid, candidates = 8500 }) {
  const rand = mulberry32(seed * 7 + 99);
  const forest = noiseFn(mulberry32(seed * 13 + 5));
  const half = size / 2 - 8;
  const buckets = Array.from({ length: CHUNKS * CHUNKS }, () => []);

  for (let i = 0; i < candidates; i++) {
    const x = (rand() * 2 - 1) * half, z = (rand() * 2 - 1) * half;
    if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < 12) continue;
    const y = heightAt(x, z);
    const alt = y / maxH;
    if (alt > 0.5) continue;                                     // thin out toward the peaks
    const slope = Math.hypot(heightAt(x + 2, z) - heightAt(x - 2, z), heightAt(x, z + 2) - heightAt(x, z - 2)) / 4;
    if (slope > 0.55) continue;                                  // no trees on cliffs
    const f = forest(x / 55, z / 55) * 0.65 + forest(x / 17, z / 17) * 0.35;
    const chance = f > 0.52 ? 0.95 : 0.04;                       // dense forests, rare strays
    if (rand() > chance * (1 - alt * 0.9)) continue;
    const cx = Math.min(CHUNKS - 1, Math.floor(((x + size / 2) / size) * CHUNKS));
    const cz = Math.min(CHUNKS - 1, Math.floor(((z + size / 2) / size) * CHUNKS));
    buckets[cz * CHUNKS + cx].push({ x, y, z, s: 0.7 + rand() * 0.8, r: rand() * Math.PI * 2, shade: 0.8 + rand() * 0.4, tilt: (rand() - 0.5) * 0.08 });
  }

  const nearGeo = pineGeometryNear(), farGeo = pineGeometryFar();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const group = new THREE.Group();
  const chunks = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  let total = 0;

  buckets.forEach((trees, idx) => {
    if (!trees.length) return;
    const near = new THREE.InstancedMesh(nearGeo, mat, trees.length);
    const far = new THREE.InstancedMesh(farGeo, mat, trees.length);
    trees.forEach((t, i) => {
      e.set(t.tilt, t.r, -t.tilt);
      q.setFromEuler(e);
      sc.set(t.s * (0.9 + (t.r % 1) * 0.2), t.s, t.s);
      p.set(t.x, t.y - 0.15, t.z);
      m.compose(p, q, sc);
      near.setMatrixAt(i, m); far.setMatrixAt(i, m);
      col.setScalar(t.shade);
      near.setColorAt(i, col); far.setColorAt(i, col);
    });
    for (const mesh of [near, far]) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; mesh.computeBoundingSphere(); group.add(mesh); }
    const cx = ((idx % CHUNKS) + 0.5) / CHUNKS * size - size / 2, cz = (Math.floor(idx / CHUNKS) + 0.5) / CHUNKS * size - size / 2;
    chunks.push({ near, far, cx, cz, n: trees.length });
    total += trees.length;
  });

  const chunkR = size / CHUNKS * 0.71;   // half-diagonal of a chunk
  function update(camPos) {
    for (const c of chunks) {
      const d = Math.hypot(c.cx - camPos.x, c.cz - camPos.z);
      c.near.visible = d - chunkR < NEAR_DIST;
      c.far.visible = d + chunkR >= NEAR_DIST && d - chunkR < CULL_DIST;
    }
  }
  function dispose() {
    nearGeo.dispose(); farGeo.dispose(); mat.dispose();
    for (const c of chunks) { c.near.dispose(); c.far.dispose(); }
  }
  return { group, update, dispose, count: total };
}

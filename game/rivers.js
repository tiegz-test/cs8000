import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

const HALF = 4.5;      // half-width of the flat riverbed
const BANK = 13;       // distance where the banks blend back into the terrain
const STEP = 6;        // path resolution in meters
const DEPTH_CAP = 3.5; // never carve deeper than this below the surrounding ground
const WATER_ABOVE_BED = 0.6;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Walk downhill-ish across the map from a start point, wandering as we go.
function tracePath(base, rand, start, heading, half) {
  const pts = [{ x: start.x, z: start.z }];
  let { x, z } = start, h = heading;
  for (let i = 0; i < 260; i++) {
    let best = null;
    for (let k = -4; k <= 4; k++) {
      const a = h + k * 0.14 + (rand() - 0.5) * 0.25;
      const nx = x + Math.cos(a) * STEP, nz = z + Math.sin(a) * STEP;
      const score = base(nx, nz) + Math.abs(k) * 0.25 + rand() * 0.4;   // prefer low ground and gentle turns
      if (!best || score < best.score) best = { a, nx, nz, score };
    }
    h = best.a; x = best.nx; z = best.nz;
    pts.push({ x, z });
    if (Math.abs(x) > half || Math.abs(z) > half) break;
  }
  return pts;
}

export function makeRivers({ base, seed, size, maxH, avoid, count = 3 }) {
  const rand = mulberry32(seed * 31 + 7);
  const half = size / 2;
  const rivers = [];

  for (let r = 0; r < count; r++) {
    // start on low, gentle ground well away from the player's spawn
    let start = null;
    for (let tries = 0; tries < 200 && !start; tries++) {
      const x = (rand() * 2 - 1) * half * 0.8, z = (rand() * 2 - 1) * half * 0.8;
      if (base(x, z) < maxH * 0.18 && (!avoid || Math.hypot(x - avoid.x, z - avoid.z) > 60)) start = { x, z };
    }
    if (!start) continue;
    // trace in both directions so the river crosses the map
    const heading = rand() * Math.PI * 2;
    const fwd = tracePath(base, rand, start, heading, half);
    const back = tracePath(base, rand, start, heading + Math.PI, half);
    const pts = back.slice(1).reverse().concat(fwd);
    if (pts.length < 12) continue;

    // bed level: follows the ground, never rising downstream, never deeper than the cap
    const ground = pts.map((p) => base(p.x, p.z));
    const level = [];
    let run = Infinity;
    for (let i = 0; i < pts.length; i++) {
      run = Math.min(run, ground[i] - 1.0);
      level.push(Math.max(run, ground[i] - DEPTH_CAP));
    }
    for (let pass = 0; pass < 3; pass++) {           // soften steps
      for (let i = 1; i < level.length - 1; i++) level[i] = (level[i - 1] + level[i] * 2 + level[i + 1]) / 4;
    }
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, la: level[i], lb: level[i + 1],
        minX: Math.min(a.x, b.x) - BANK, maxX: Math.max(a.x, b.x) + BANK,
        minZ: Math.min(a.z, b.z) - BANK, maxZ: Math.max(a.z, b.z) + BANK });
    }
    rivers.push({ pts, level, segs });
  }

  // nearest river centerline: distance and bed level there
  const q = { d: Infinity, level: 0 };
  function nearest(x, z) {
    q.d = Infinity;
    for (const rv of rivers) for (const s of rv.segs) {
      if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const t = Math.min(1, Math.max(0, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz)));
      const d = Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t));
      if (d < q.d) { q.d = d; q.level = s.la + (s.lb - s.la) * t; }
    }
    return q;
  }

  function heightAt(x, z) {
    const h = base(x, z);
    const { d, level } = nearest(x, z);
    if (d >= BANK) return h;
    if (d <= HALF) return level;
    const t = (d - HALF) / (BANK - HALF), s = t * t * (3 - 2 * t);
    const floor = level + 1.2 * smooth(0, 0.3, t) * (1 - smooth(0.6, 1, t));   // keep banks above the water
    return Math.max(level * (1 - s) + h * s, floor);
  }
  const distance = (x, z) => nearest(x, z).d;
  const mud = (x, z) => 1 - smooth(HALF - 1, HALF + 5, nearest(x, z).d);

  // water ribbons just below ground level
  const tex = (() => {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 256;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#3b86b3'; ctx.fillRect(0, 0, 128, 256);
    const rr = mulberry32(3);
    ctx.lineCap = 'round';
    for (let i = 0; i < 90; i++) {
      const x = rr() * 128, y = rr() * 256, len = 10 + rr() * 30;
      ctx.strokeStyle = `rgba(210,235,250,${0.12 + rr() * 0.25})`;
      ctx.lineWidth = 1 + rr() * 2;
      for (const dy of [-256, 0, 256]) { ctx.beginPath(); ctx.moveTo(x, y + dy); ctx.quadraticCurveTo(x + (rr() - 0.5) * 8, y + dy + len / 2, x, y + dy + len); ctx.stroke(); }
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  })();
  const waterMat = new THREE.MeshPhongMaterial({ map: tex, color: 0xcfe8ff, specular: 0xffffff, shininess: 90, transparent: true, opacity: 0.88 });

  const group = new THREE.Group();
  for (const rv of rivers) {
    const pos = [], uv = [], idx = [];
    let dist = 0;
    rv.pts.forEach((p, i) => {
      const n = rv.pts[Math.min(i + 1, rv.pts.length - 1)], m = rv.pts[Math.max(i - 1, 0)];
      let tx = n.x - m.x, tz = n.z - m.z;
      const len = Math.hypot(tx, tz) || 1; tx /= len; tz /= len;
      const w = HALF + 1.4, y = rv.level[i] + WATER_ABOVE_BED;
      pos.push(p.x - tz * w, y, p.z + tx * w, p.x + tz * w, y, p.z - tx * w);
      if (i > 0) dist += Math.hypot(p.x - rv.pts[i - 1].x, p.z - rv.pts[i - 1].z);
      uv.push(0, dist / 10, 1, dist / 10);
      if (i < rv.pts.length - 1) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, waterMat);
    mesh.renderOrder = 1;
    group.add(mesh);
  }

  return {
    heightAt, distance, mud, group, count: rivers.length, paths: rivers.map((r) => r.pts),
    update(dt) { tex.offset.y -= dt * 0.25; },
    dispose() { group.children.forEach((m) => m.geometry.dispose()); waterMat.dispose(); tex.dispose(); },
  };
}

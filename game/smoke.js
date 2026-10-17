import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

// A rising column of low-poly smoke. Each puff is a faceted blob (a small icosphere) that
// climbs, swells, drifts with the wind and fades out; when it reaches the top it starts over
// at the bottom, so the column loops forever with no spawning logic. All puffs share one
// instanced mesh, with a per-puff alpha added to the material.
const PUFFS = 64;

export function makeSmoke({ x, y, z, height = 170, life = 15, wind = new THREE.Vector2(1, 0.35).normalize() }) {
  const rand = mulberry32(Math.floor(x * 7 + z * 13) | 0);
  const geo = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();    // non-indexed so every face is flat shaded
  geo.computeVertexNormals();
  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(PUFFS), 1);
  geo.setAttribute('aAlpha', alpha);

  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, transparent: true, depthWrite: false, fog: false });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vAlpha;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
      .replace('#include <opaque_fragment>', 'diffuseColor.a *= vAlpha;\n#include <opaque_fragment>');
  };

  const mesh = new THREE.InstancedMesh(geo, mat, PUFFS);
  mesh.frustumCulled = false;               // instances move every frame
  mesh.renderOrder = 3;
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.add(mesh);

  const puffs = Array.from({ length: PUFFS }, (_, i) => ({
    phase: i / PUFFS, spin: (rand() - 0.5) * 0.6, a0: rand() * 6.28, wob: 2 + rand() * 5, sz: 0.8 + rand() * 0.5,
    ax: rand() * 6.28, ay: rand() * 6.28,
  }));
  const dark = new THREE.Color(0x3b3b40), light = new THREE.Color(0xb4b4ba), col = new THREE.Color();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

  function update(time) {
    for (let i = 0; i < PUFFS; i++) {
      const f = puffs[i];
      const t = ((time / life) + f.phase) % 1;                         // 0 at the base, 1 at the top
      const rise = t * height;
      const drift = Math.pow(t, 1.4) * 55;                             // the wind bends the column over as it climbs
      p.set(wind.x * drift + Math.sin(time * 0.5 + f.a0) * f.wob * t, rise, wind.y * drift + Math.cos(time * 0.45 + f.a0) * f.wob * t);
      const size = (3.4 + 24 * Math.pow(t, 0.75)) * f.sz;
      sc.set(size, size * 0.85, size);
      e.set(f.ax + time * f.spin * 0.5, f.ay + time * f.spin, 0);
      q.setFromEuler(e);
      m.compose(p, q, sc);
      mesh.setMatrixAt(i, m);
      alpha.setX(i, 0.7 * smooth(0, 0.06, t) * (1 - smooth(0.55, 1, t)));    // fade in at the base, thin out toward the top
      col.copy(dark).lerp(light, smooth(0, 0.55, t));                  // dark and sooty low down, paler higher up
      mesh.setColorAt(i, col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    alpha.needsUpdate = true;
  }
  update(0);

  return { group, update, dispose() { geo.dispose(); mat.dispose(); mesh.dispose(); } };
}

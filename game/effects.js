import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

// Explosions: a bright flash, a few low-poly smoke puffs that rise and fade, and flying debris.
// Everything comes from small pools that are reused, so blasts don't allocate during play.
const FLASHES = 8, PUFFS = 56, DEBRIS = 90;

export function makeEffects(scene) {
  const rand = mulberry32(99);
  const group = new THREE.Group();
  scene.add(group);

  // flash
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,250,210,1)'); g.addColorStop(0.3, 'rgba(255,170,50,0.85)'); g.addColorStop(1, 'rgba(255,90,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const flashTex = new THREE.CanvasTexture(cv);
  const flashes = Array.from({ length: FLASHES }, () => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
    sp.visible = false; group.add(sp);
    return { sp, life: 0, max: 1, size: 1 };
  });

  // smoke puffs
  const puffGeo = new THREE.IcosahedronGeometry(1, 0);
  const puffs = Array.from({ length: PUFFS }, () => {
    const mat = new THREE.MeshLambertMaterial({ color: 0x555559, flatShading: true, transparent: true, depthWrite: false });
    const m = new THREE.Mesh(puffGeo, mat);
    m.visible = false; group.add(m);
    return { m, mat, life: 0, max: 1, vel: new THREE.Vector3(), spin: new THREE.Vector3(), size: 1 };
  });

  // debris chunks
  const debrisGeos = [new THREE.TetrahedronGeometry(0.4), new THREE.BoxGeometry(0.5, 0.25, 0.35), new THREE.IcosahedronGeometry(0.3, 0)];
  const debrisMats = [0x4a3322, 0x2a7a38, 0x1d4d26, 0x2a2a2d, 0xff7a1a].map((c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true }));
  const debris = Array.from({ length: DEBRIS }, (_, i) => {
    const m = new THREE.Mesh(debrisGeos[i % 3], debrisMats[i % 5]);
    m.visible = false; group.add(m);
    return { m, life: 0, max: 1, vel: new THREE.Vector3(), spin: new THREE.Vector3(), scale: 1 };
  });
  let nf = 0, np = 0, nd = 0;

  function explode(x, y, z, scale = 1) {
    const f = flashes[nf++ % FLASHES];
    f.sp.position.set(x, y, z); f.life = f.max = 0.5; f.size = 20 * scale; f.sp.visible = true;
    for (let i = 0; i < 6; i++) {
      const p = puffs[np++ % PUFFS];
      p.m.position.set(x + (rand() - 0.5) * 3 * scale, y + rand() * 2, z + (rand() - 0.5) * 3 * scale);
      p.vel.set((rand() - 0.5) * 4, 3 + rand() * 5, (rand() - 0.5) * 4);
      p.spin.set(rand() - 0.5, rand() - 0.5, rand() - 0.5);
      p.size = (1.6 + rand() * 1.4) * scale; p.life = p.max = 2.2 + rand() * 1.2;
      p.m.scale.setScalar(p.size); p.m.visible = true; p.mat.opacity = 0.75;
    }
    for (let i = 0; i < 12; i++) {
      const d = debris[nd++ % DEBRIS];
      d.m.position.set(x, y, z);
      const a = rand() * 6.28, sp = (3 + rand() * 9) * Math.sqrt(scale);
      d.vel.set(Math.cos(a) * sp, 6 + rand() * 10 * Math.sqrt(scale), Math.sin(a) * sp);
      d.spin.set((rand() - 0.5) * 12, (rand() - 0.5) * 12, (rand() - 0.5) * 12);
      d.scale = (0.7 + rand() * 1.4) * Math.sqrt(scale); d.life = d.max = 1.2 + rand() * 0.8;
      d.m.scale.setScalar(d.scale); d.m.visible = true;
    }
  }

  function update(dt) {
    for (const f of flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const t = 1 - Math.max(0, f.life) / f.max;
      f.sp.scale.setScalar(f.size * (0.35 + t * 0.9));
      f.sp.material.opacity = Math.max(0, 1 - t * t);
      if (f.life <= 0) f.sp.visible = false;
    }
    for (const p of puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.m.position.addScaledVector(p.vel, dt); p.vel.multiplyScalar(1 - dt * 0.6);
      p.m.rotation.x += p.spin.x * dt; p.m.rotation.y += p.spin.y * dt;
      const t = 1 - Math.max(0, p.life) / p.max;
      p.m.scale.setScalar(p.size * (1 + t * 2.6));
      p.mat.opacity = 0.75 * (1 - t);
      if (p.life <= 0) p.m.visible = false;
    }
    for (const d of debris) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.vel.y -= 9.81 * dt;
      d.m.position.addScaledVector(d.vel, dt);
      d.m.rotation.x += d.spin.x * dt; d.m.rotation.y += d.spin.y * dt; d.m.rotation.z += d.spin.z * dt;
      d.m.scale.setScalar(d.scale * Math.min(1, d.life / 0.3));
      if (d.life <= 0) d.m.visible = false;
    }
  }

  return {
    explode, update,
    dispose() { flashTex.dispose(); puffGeo.dispose(); debrisGeos.forEach((x) => x.dispose()); debrisMats.forEach((x) => x.dispose()); puffs.forEach((p) => p.mat.dispose()); flashes.forEach((f) => f.sp.material.dispose()); scene.remove(group); },
  };
}

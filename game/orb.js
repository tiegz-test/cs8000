import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

// The rescue beacon: a glowing yellow orb hovering above the ground.
function glowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,240,150,1)');
  g.addColorStop(0.25, 'rgba(255,205,60,0.55)');
  g.addColorStop(1, 'rgba(255,180,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}

// Pick a spot about `distance` meters from the player: on gentle ground, away from water.
function pickSpot({ from, heightAt, riverDistance, size, seed, distance }) {
  const rand = mulberry32(seed * 17 + 3);
  const lim = size / 2 - 25;
  for (let i = 0; i < 400; i++) {
    const a = rand() * Math.PI * 2, d = distance * (0.9 + rand() * 0.2);
    const x = from.x + Math.cos(a) * d, z = from.z + Math.sin(a) * d;
    if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
    if (riverDistance(x, z) < 16) continue;
    const slope = Math.hypot(heightAt(x + 3, z) - heightAt(x - 3, z), heightAt(x, z + 3) - heightAt(x, z - 3)) / 6;
    if (slope > 0.35) continue;
    return { x, z };
  }
  return { x: Math.max(-lim, Math.min(lim, -from.x)), z: Math.max(-lim, Math.min(lim, -from.z)) };  // fallback: opposite side
}

export function makeOrb({ from, heightAt, riverDistance, size, seed, distance = 300 }) {
  const { x, z } = pickSpot({ from, heightAt, riverDistance, size, seed, distance });
  const baseY = heightAt(x, z) + 2.6;
  const group = new THREE.Group();
  group.position.set(x, baseY, z);

  const core = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
  group.add(core);
  const tex = glowTexture();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  glow.scale.setScalar(12);
  group.add(glow);
  const light = new THREE.PointLight(0xffcc44, 60, 28, 2);
  group.add(light);

  return {
    group, x, z,
    update(t) {
      group.position.y = baseY + Math.sin(t * 1.6) * 0.35;
      const pulse = 1 + Math.sin(t * 3) * 0.08;
      glow.scale.setScalar(12 * pulse);
      light.intensity = 55 + Math.sin(t * 3) * 10;
    },
    dispose() { core.geometry.dispose(); core.material.dispose(); glow.material.dispose(); tex.dispose(); light.dispose?.(); },
  };
}

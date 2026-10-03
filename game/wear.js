import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

function toTexture(cv, repeat = false) {
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Weathered painted metal: base paint with grime, rust streaks, scratches and
// chipped paint showing bare metal (more chips near the edges).
export function wornTexture({ base = '#383d2f', seed = 1, w = 512, h = 512, wear = 1, repeat = false } = {}) {
  const rand = mulberry32(seed);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  // fine paint speckle
  for (let i = 0; i < 5000 * wear; i++) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,235,0.05)' : 'rgba(0,0,0,0.07)';
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
  // large grime blotches
  for (let i = 0; i < 26 * wear; i++) {
    const x = rand() * w, y = rand() * h, r = 30 + rand() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rand() > 0.35 ? 'rgba(20,14,6,0.22)' : 'rgba(150,140,100,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // edge grime
  for (const [x, y, rw, rh] of [[0, 0, w, 14], [0, h - 14, w, 14], [0, 0, 14, h], [w - 14, 0, 14, h]]) {
    ctx.fillStyle = 'rgba(10,8,4,0.25)';
    ctx.fillRect(x, y, rw, rh);
  }
  // rust / oil streaks running downward
  for (let i = 0; i < 16 * wear; i++) {
    const x = rand() * w, y = rand() * h * 0.7, len = 40 + rand() * 160, lw = 1.5 + rand() * 5;
    const g = ctx.createLinearGradient(0, y, 0, y + len);
    const rust = rand() > 0.4;
    g.addColorStop(0, rust ? 'rgba(130,70,25,0.32)' : 'rgba(10,8,5,0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, lw, len);
  }
  // scratches
  ctx.lineCap = 'round';
  for (let i = 0; i < 90 * wear; i++) {
    const x = rand() * w, y = rand() * h, a = rand() * Math.PI, len = 14 + rand() * 80;
    ctx.strokeStyle = rand() > 0.25 ? `rgba(215,215,190,${0.15 + rand() * 0.3})` : 'rgba(10,10,6,0.35)';
    ctx.lineWidth = 0.6 + rand() * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  // paint chips down to bare metal, biased toward the edges
  for (let i = 0; i < 170 * wear; i++) {
    let x = rand() * w, y = rand() * h;
    if (rand() < 0.6) { if (rand() > 0.5) x = rand() < 0.5 ? rand() * 24 : w - rand() * 24; else y = rand() < 0.5 ? rand() * 24 : h - rand() * 24; }
    const s = 1.5 + rand() * 4;
    ctx.fillStyle = rand() > 0.3 ? 'rgba(160,162,150,0.75)' : 'rgba(95,60,30,0.7)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; const rr = s * (0.5 + rand()); ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.fill();
  }
  return toTexture(cv, repeat);
}

// Smudges, dust and fine scratches for the glass (grayscale, read as dirt amount).
export function glassDirtTexture(seed = 5, size = 512) {
  const rand = mulberry32(seed);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) {
    const x = rand() * size, y = rand() * size, r = 20 + rand() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.05 + rand() * 0.1})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // wiper-style arcs
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 6;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.arc(size * rand(), size * 1.4, size * (0.6 + rand() * 0.4), Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  }
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.1 + rand() * 0.3})`;
    ctx.fillRect(rand() * size, rand() * size, 1, 1);
  }
  ctx.lineCap = 'round';
  for (let i = 0; i < 50; i++) {
    const x = rand() * size, y = rand() * size, a = rand() * Math.PI, len = 10 + rand() * 60;
    ctx.strokeStyle = `rgba(255,255,255,${0.15 + rand() * 0.35})`;
    ctx.lineWidth = 0.5 + rand() * 0.6;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
  }
  return toTexture(cv, true);
}

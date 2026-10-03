import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

// Seamless procedural grass: light, near-neutral green so it can be
// multiplied with the height-based vertex colors without darkening them.
export function makeGrassTexture(size = 512) {
  const rand = mulberry32(1234);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#d6e6c4';
  ctx.fillRect(0, 0, size, size);

  // draw wrapped copies so edges tile seamlessly
  const wrapped = (x, y, fn) => {
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
      if (x + dx > -40 && x + dx < size + 40 && y + dy > -40 && y + dy < size + 40) fn(x + dx, y + dy);
    }
  };

  // soft low-frequency patches
  for (let i = 0; i < 90; i++) {
    const x = rand() * size, y = rand() * size, r = 30 + rand() * 60;
    const light = rand() > 0.5;
    wrapped(x, y, (px, py) => {
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, light ? 'rgba(240,250,215,0.35)' : 'rgba(150,185,120,0.3)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }

  // blades
  ctx.lineCap = 'round';
  for (let i = 0; i < 9000; i++) {
    const x = rand() * size, y = rand() * size;
    const len = 5 + rand() * 9, ang = -Math.PI / 2 + (rand() - 0.5) * 1.1;
    const t = rand();
    const l = 55 + t * 40; // lightness 55..95
    ctx.strokeStyle = `hsla(${88 + rand() * 30}, ${35 + rand() * 25}%, ${l}%, ${0.35 + rand() * 0.4})`;
    ctx.lineWidth = 0.8 + rand() * 1.2;
    wrapped(x, y, (px, py) => {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
      ctx.stroke();
    });
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Sample the grass map a second time at a different scale and blend, which
// hides the repeating grid when looking far across the ground.
export function breakUpTiling(material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec4 g1 = texture2D( map, vMapUv );
        vec4 g2 = texture2D( map, vMapUv * 0.37 + vec2( 0.31, 0.53 ) );
        diffuseColor *= mix( g1, g2, 0.45 );
      #endif`
    );
  };
}

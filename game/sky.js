import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

// Sun position: azimuth/elevation in degrees. Azimuth 0 = -Z (north), clockwise.
export function sunDirection(azimuthDeg = 40, elevationDeg = 35) {
  const az = THREE.MathUtils.degToRad(azimuthDeg), el = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

export const HORIZON = new THREE.Color(0xbfe2f5);
const ZENITH = new THREE.Color(0x2f7fd0);

// Gradient dome with a sun disc and soft glow, drawn in one shader.
export function makeSkyDome(sunDir) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uZenith: { value: ZENITH }, uHorizon: { value: HORIZON }, uSun: { value: sunDir },
    },
    vertexShader: `varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 uZenith, uHorizon, uSun;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
        float s = max(dot(d, normalize(uSun)), 0.0);
        col += vec3(1.0, 0.85, 0.55) * pow(s, 8.0) * 0.25;     // wide warm haze
        col += vec3(1.0, 0.92, 0.7) * pow(s, 90.0) * 0.6;      // inner glow
        col = mix(col, vec3(1.0, 0.99, 0.92), smoothstep(0.99955, 0.99985, s)); // disc
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), mat);
  dome.renderOrder = -2;
  dome.frustumCulled = false;
  return dome;
}

// Soft cumulus puff, drawn from many overlapping noisy blobs. White on top, bluish-gray underside.
function makeCloudTexture(seed, size = 256) {
  const rand = mulberry32(seed);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const blobs = [];
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2, d = Math.pow(rand(), 0.7) * size * 0.3;
    blobs.push({ x: size / 2 + Math.cos(a) * d * 1.1, y: size * 0.55 + Math.sin(a) * d * 0.55,
      r: size * (0.08 + rand() * 0.1) });
  }
  blobs.sort((p, q) => p.y - q.y);
  for (const b of blobs) {
    const g = ctx.createRadialGradient(b.x, b.y - b.r * 0.25, b.r * 0.1, b.x, b.y, b.r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.55, 'rgba(246,249,253,0.75)');
    g.addColorStop(1, 'rgba(235,242,250,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
  }
  // shade the underside
  ctx.globalCompositeOperation = 'source-atop';
  const shade = ctx.createLinearGradient(0, size * 0.35, 0, size * 0.8);
  shade.addColorStop(0, 'rgba(160,185,215,0)');
  shade.addColorStop(1, 'rgba(150,175,208,0.55)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Drifting cloud field: each cloud is a few overlapping sprites. Wraps around the camera.
export function makeClouds(seed = 7, count = 26, radius = 420) {
  const rand = mulberry32(seed);
  const textures = [11, 22, 33, 44].map((s) => makeCloudTexture(s));
  const group = new THREE.Group();
  const clouds = [];
  for (let i = 0; i < count; i++) {
    const cloud = new THREE.Group();
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * radius;
    cloud.position.set(Math.cos(a) * d, 110 + rand() * 110, Math.sin(a) * d);
    const scale = 70 + rand() * 80;
    for (let j = 0, n = 2 + Math.floor(rand() * 3); j < n; j++) {
      const mat = new THREE.SpriteMaterial({
        map: textures[Math.floor(rand() * textures.length)], transparent: true,
        depthWrite: false, fog: false, opacity: 0.85 + rand() * 0.15,
      });
      const sp = new THREE.Sprite(mat);
      sp.position.set((j - 1) * scale * 0.45 + (rand() - 0.5) * 20, (rand() - 0.5) * 8, (rand() - 0.5) * 30);
      sp.scale.set(scale * (1.1 + rand() * 0.6), scale * 0.7 * (0.8 + rand() * 0.4), 1);
      cloud.add(sp);
    }
    group.add(cloud);
    clouds.push(cloud);
  }
  // drift along +x, wrapping within the radius around the camera
  group.userData.update = (dt, camPos) => {
    group.position.set(camPos.x, 0, camPos.z);
    for (const c of clouds) {
      c.position.x += dt * 3;
      if (c.position.x > radius) c.position.x -= radius * 2;
    }
  };
  return group;
}

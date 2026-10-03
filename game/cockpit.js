import * as THREE from 'three';
import { wornTexture, glassDirtTexture } from './wear.js';

// Mech cockpit overlay: a curved red glass canopy and a control deck along the
// bottom of the view. It lives in its own scene and camera, rendered after the
// world with a cleared depth buffer, so terrain can never clip into it.

const GLASS_RADIUS = 1.5;
const DECK_DEPTH = 0.6;    // distance from the eye to the deck's front edge
const DECK_WIDTH = 1.0;    // design width; scaled down to fit narrow screens

// Reflective glass: a Fresnel reflection of a procedural sky (same gradient and
// sun as the world sky), plus a sharp sun glint, over a thin red tint.
function glassMaterial(sunDir) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false,
    uniforms: {
      uViewToWorld: { value: new THREE.Matrix3() }, // main camera rotation, set every frame
      uSun: { value: sunDir.clone() },
      uDirt: { value: glassDirtTexture() },
    },
    vertexShader: `varying vec3 vPos; varying vec3 vN; varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vPos = mv.xyz; vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying vec3 vPos; varying vec3 vN; varying vec2 vUv;
      uniform mat3 uViewToWorld; uniform vec3 uSun; uniform sampler2D uDirt;

      vec3 skyColor(vec3 d) {
        float h = clamp(d.y, 0.0, 1.0);
        vec3 sky = mix(vec3(0.75, 0.89, 0.96), vec3(0.18, 0.5, 0.82), pow(h, 0.55));
        vec3 ground = mix(vec3(0.30, 0.45, 0.22), vec3(0.08, 0.2, 0.08), clamp(-d.y * 2.0, 0.0, 1.0));
        vec3 col = mix(ground, sky, smoothstep(-0.05, 0.05, d.y));
        float s = max(dot(d, normalize(uSun)), 0.0);
        col += vec3(1.0, 0.85, 0.55) * pow(s, 8.0) * 0.3;
        col += vec3(1.0, 0.95, 0.8) * pow(s, 200.0) * 3.0;
        return col;
      }

      void main() {
        vec3 I = normalize(vPos);                       // eye -> glass point (view space)
        vec3 n = -normalize(vN);                        // inward-facing normal
        float f = 1.0 - abs(dot(n, -I));                // 0 head-on, 1 grazing
        vec3 r = normalize(uViewToWorld * reflect(I, n));
        float fres = 0.12 + 0.75 * pow(f, 2.5);         // reflectivity
        vec3 refl = skyColor(r);

        vec3 tint = vec3(0.85, 0.06, 0.05);
        float alpha = 0.20 + 0.40 * pow(f, 2.2);        // red glass body
        // soft window-light streaks that stay fixed on the canopy
        float d = vPos.x * 0.8 + vPos.y;
        float streak = smoothstep(0.07, 0.0, abs(d - 0.55)) * 0.14 + smoothstep(0.03, 0.0, abs(d - 0.74)) * 0.10;

        vec3 col = mix(tint, refl, clamp(fres, 0.0, 0.85)) + vec3(1.0, 0.8, 0.75) * streak;
        alpha = clamp(alpha + (fres - 0.12) * 0.7 + streak, 0.0, 0.9);
        gl_FragColor = vec4(col, alpha);
      }`,
  });
}

function strut(points, radius, mat) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 48, radius, 8), mat);
}

// Point on the canopy sphere (centered behind the eye) at yaw/pitch in radians.
function onGlass(center, yaw, pitch, r = GLASS_RADIUS * 0.99) {
  return new THREE.Vector3(
    center.x + Math.sin(yaw) * Math.cos(pitch) * r,
    center.y + Math.sin(pitch) * r,
    center.z - Math.cos(yaw) * Math.cos(pitch) * r,
  );
}

function makeScreenTexture() {
  const cv = document.createElement('canvas');
  cv.width = 352; cv.height = 200;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const ctx = cv.getContext('2d');
  tex.userData.draw = (t, info) => {
    ctx.fillStyle = '#04140a';
    ctx.fillRect(0, 0, 352, 200);
    // radar
    const cx = 100, cy = 100, r = 90;
    ctx.strokeStyle = 'rgba(80,255,140,.5)';
    ctx.lineWidth = 1.5;
    for (const k of [1, 0.66, 0.33]) { ctx.beginPath(); ctx.arc(cx, cy, r * k, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
    const a = t * 2.2;
    const g = ctx.createConicGradient ? ctx.createConicGradient(a - 0.9, cx, cy) : null;
    if (g) {
      g.addColorStop(0, 'rgba(80,255,140,0)');
      g.addColorStop(0.14, 'rgba(80,255,140,.55)');
      g.addColorStop(0.15, 'rgba(80,255,140,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = '#7dffaa';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
    // readouts
    ctx.fillStyle = '#7dffaa';
    ctx.font = 'bold 18px monospace';
    ctx.fillText(`ALT ${String(Math.round(info.alt)).padStart(4, ' ')}m`, 215, 55);
    ctx.fillText(`HDG ${String(Math.round(info.heading)).padStart(3, '0')}`, 215, 90);
    ctx.fillText(`SPD ${info.speed.toFixed(1)}`, 215, 125);
    ctx.fillStyle = Math.floor(t * 2) % 2 ? '#ff5544' : '#662218';
    ctx.fillText('SYS OK', 215, 165);
    tex.needsUpdate = true;
  };
  return tex;
}

// Stenciled panel label lying flat on the deck face.
function labelMesh(text, w, h, color = '#d3cc9a') {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = Math.round(256 * h / w);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = color;
  ctx.font = `bold ${Math.round(cv.height * 0.72)}px "Courier New", monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, cv.width / 2, cv.height / 2 + 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

function hazardTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 32;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#c9a227'; ctx.fillRect(0, 0, 256, 32);
  ctx.fillStyle = '#16140d';
  for (let x = -32; x < 288; x += 32) {
    ctx.beginPath(); ctx.moveTo(x, 32); ctx.lineTo(x + 16, 32); ctx.lineTo(x + 32, 0); ctx.lineTo(x + 16, 0); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Knob face with tick marks around the rim.
function knobTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#1b1d18'; ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#d3cc9a'; ctx.lineWidth = 3;
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI * 0.75 + (i / 10) * Math.PI * 1.5 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(64 + Math.cos(a) * 50, 64 + Math.sin(a) * 50);
    ctx.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeDeck() {
  const deck = new THREE.Group();
  const drab = new THREE.MeshStandardMaterial({ map: wornTexture({ base: '#4a5140', seed: 3, repeat: true }), metalness: 0.45, roughness: 0.7 });   // olive-drab panel
  const plateMat = new THREE.MeshStandardMaterial({ map: wornTexture({ base: '#2f3427', seed: 8, wear: 0.7, repeat: true }), metalness: 0.3, roughness: 0.85 });  // recessed plates
  const rimMat = new THREE.MeshStandardMaterial({ map: wornTexture({ base: '#70755c', seed: 12, w: 256, h: 64, wear: 0.6, repeat: true }), metalness: 0.6, roughness: 0.55 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x15170f, metalness: 0.1, roughness: 0.85 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8c9096, metalness: 0.9, roughness: 0.35 });
  const brass = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 0.8, roughness: 0.35 });
  const guardMat = new THREE.MeshStandardMaterial({ color: 0xa31b14, metalness: 0.2, roughness: 0.5 });

  // Console body; the top face tilts toward the pilot.
  const body = new THREE.Mesh(new THREE.BoxGeometry(DECK_WIDTH, 0.5, 0.36), drab);
  body.position.set(0, -0.25, -0.18);
  deck.add(body);
  const top = new THREE.Group();
  top.rotation.x = 0.55;
  deck.add(top);
  const face = new THREE.Mesh(new THREE.BoxGeometry(DECK_WIDTH, 0.02, 0.36), drab);
  face.position.set(0, 0, -0.18);
  top.add(face);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(DECK_WIDTH, 0.022, 0.016), rimMat);
  lip.position.set(0, 0.01, -0.004);
  top.add(lip);
  const hazard = new THREE.Mesh(new THREE.PlaneGeometry(DECK_WIDTH - 0.04, 0.012),
    new THREE.MeshBasicMaterial({ map: hazardTexture() }));
  hazard.rotation.x = -Math.PI / 2;
  hazard.position.set(0, 0.0215, -0.03);
  top.add(hazard);

  const leds = [];     // { mat, color, set(t, info) -> 0..1 }
  const led = (x, z, color, fn, size = 0.007) => {
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a14, emissive: color, emissiveIntensity: 0, roughness: 0.4 });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(size, size, 0.006, 14), mat);
    m.position.set(x, 0.018, z);
    top.add(m);
    leds.push({ mat, fn });
    return m;
  };
  const screw = (x, z) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.004, 8), steel);
    m.position.set(x, 0.024, z);
    top.add(m);
  };
  const plate = (cx, cz, w, d, title) => {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.01, 0.008, d + 0.01), rimMat);
    rim.position.set(cx, 0.012, cz);
    top.add(rim);
    const pl = new THREE.Mesh(new THREE.BoxGeometry(w, 0.01, d), plateMat);
    pl.position.set(cx, 0.014, cz);
    top.add(pl);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) screw(cx + sx * (w / 2 - 0.007), cz + sz * (d / 2 - 0.007));
    const lab = labelMesh(title, 0.1, 0.02);
    lab.position.set(cx, 0.0195, cz - d / 2 + 0.017);
    top.add(lab);
  };

  // --- center screen ---
  const screenTex = makeScreenTexture();
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.012, 0.24), rubber);
  bezel.position.set(0, 0.016, -0.19);
  top.add(bezel);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.37, 0.21),
    new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  screen.rotation.x = -Math.PI / 2;
  screen.position.set(0, 0.023, -0.19);
  top.add(screen);

  // --- left cluster: WEAPONS (keycaps, guarded switches) ---
  const LX = -0.31, RX = 0.31, CZ = -0.17;
  plate(LX, CZ, 0.17, 0.26, 'WPN SYS');
  for (const [i, kx] of [-0.035, 0.035].entries()) {
    for (const [j, kz] of [-0.065, -0.005].entries()) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.014, 0.036), rubber);
      cap.position.set(LX + kx, 0.025, CZ + kz + 0.02);
      top.add(cap);
      const states = [(t) => 1, (t, info) => (info.edge ? 0.5 + 0.5 * Math.sin(t * 8) : 0), () => 0.0, (t, info) => (info.speed > 10 ? 1 : 0)];
      led(LX + kx, CZ + kz - 0.007, [0x33dd66, 0xff3b2a, 0xffb02e, 0xffb02e][i * 2 + j], states[i * 2 + j], 0.005);
    }
  }
  const guards = [];
  for (const gx of [-0.04, 0.04]) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.012, 0.03), rubber);
    base.position.set(LX + gx, 0.02, CZ + 0.095);
    top.add(base);
    const tog = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.004, 0.028, 8), steel);
    tog.position.set(LX + gx, 0.034, CZ + 0.095);
    top.add(tog);
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.002, 0.026), guardMat);
    cover.geometry.translate(0, 0.001, -0.013);                      // hinge at the far edge
    cover.position.set(LX + gx, 0.041, CZ + 0.108);
    cover.rotation.x = gx < 0 ? 0 : -1.25;                            // one closed, one flipped up
    top.add(cover);
    guards.push(cover);
  }

  // --- right cluster: POWER (rotary knobs, rockers, level bar) ---
  plate(RX, CZ, 0.17, 0.26, 'PWR / DRV');
  const knobTex = knobTexture();
  const knobs = [];
  for (const kx of [-0.04, 0.04]) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.021, 0.018, 24), rubber);
    knob.position.set(RX + kx, 0.027, CZ - 0.05);
    top.add(knob);
    const ticks = new THREE.Mesh(new THREE.CircleGeometry(0.03, 28), new THREE.MeshBasicMaterial({ map: knobTex, transparent: true }));
    ticks.rotation.x = -Math.PI / 2;
    ticks.position.set(RX + kx, 0.0195, CZ - 0.05);
    top.add(ticks);
    const pointer = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.002, 0.016), new THREE.MeshBasicMaterial({ color: 0xe8e2b4 }));
    pointer.geometry.translate(0, 0, -0.008);
    pointer.position.set(RX + kx, 0.037, CZ - 0.05);
    pointer.rotation.y = kx < 0 ? 0.6 : -0.4;
    top.add(pointer);
    knobs.push(pointer);
  }
  for (const rx of [-0.05, 0, 0.05]) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.008, 0.034), rubber);
    base.position.set(RX + rx, 0.02, CZ + 0.025);
    top.add(base);
    const rocker = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.01, 0.022), plateMat);
    rocker.position.set(RX + rx, 0.027, CZ + 0.025);
    rocker.rotation.x = rx === 0 ? 0.35 : -0.35;
    top.add(rocker);
    led(RX + rx, CZ + 0.052, rx === 0.05 ? 0xffb02e : 0x33dd66, () => 1, 0.004);
  }
  // level bar: 8 segments, fills with speed, last two amber then red
  const barCols = [0x33dd66, 0x33dd66, 0x33dd66, 0x33dd66, 0x33dd66, 0xffb02e, 0xffb02e, 0xff3b2a];
  barCols.forEach((c, i) => led(RX - 0.0595 + i * 0.017, CZ + 0.095, c, (t, info) => (info.speed / 14 * 8 > i + 0.2 ? 1 : 0), 0.0055));

  // --- throttle and stick, in black rubber ---
  for (const side of [-1, 1]) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.16), rubber);
    slot.position.set(side * 0.44, 0.014, -0.19);
    top.add(slot);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.09, 10), steel);
    stick.position.set(side * 0.44, 0.06, -0.16);
    stick.rotation.x = -0.35;
    top.add(stick);
    const grip = new THREE.Mesh(new THREE.SphereGeometry(0.02, 16, 12), rubber);
    grip.scale.y = 1.25;
    grip.position.set(side * 0.44, 0.1, -0.145);
    top.add(grip);
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.0195, 0.003, 8, 20), brass);
    stripe.rotation.x = Math.PI / 2;
    stripe.position.set(side * 0.44, 0.094, -0.147);
    top.add(stripe);
  }

  // --- gauges flanking the screen (kept, restyled) ---
  const needles = [];
  for (const side of [-1, 1]) {
    const x = side * 0.245;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.01, 28), steel);
    ring.position.set(x, 0.016, -0.335);
    top.add(ring);
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.031, 28), new THREE.MeshBasicMaterial({ color: 0x14180f }));
    dial.rotation.x = -Math.PI / 2;
    dial.position.set(x, 0.0225, -0.335);
    top.add(dial);
    const tickRing = new THREE.Mesh(new THREE.CircleGeometry(0.031, 28), new THREE.MeshBasicMaterial({ map: knobTex, transparent: true }));
    tickRing.rotation.x = -Math.PI / 2;
    tickRing.position.set(x, 0.023, -0.335);
    top.add(tickRing);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.002, 0.026), new THREE.MeshBasicMaterial({ color: 0xff9a2e }));
    needle.geometry.translate(0, 0, -0.013);
    needle.position.set(x, 0.0245, -0.335);
    top.add(needle);
    needles.push({ needle, side });
  }

  // master caution lights above the screen
  led(-0.07, -0.325, 0xffb02e, (t, info) => (info.speed > 10 ? 1 : 0.0), 0.008);
  led(0.07, -0.325, 0xff3b2a, (t, info) => (info.edge ? 0.5 + 0.5 * Math.sin(t * 8) : 0), 0.008);

  const update = (t, info) => {
    for (const l of leds) l.mat.emissiveIntensity = l.fn(t, info) * 1.4;
    for (const n of needles) n.needle.rotation.y = n.side * 0.6 + Math.sin(t * 1.3 + n.side) * 0.25 + info.speed * 0.05;
    knobs[0].rotation.y = 0.6 + Math.sin(t * 0.4) * 0.05;
    knobs[1].rotation.y = -0.4 + Math.min(info.speed / 14, 1) * 1.6;
  };
  deck.userData = { screenTex, update };
  return deck;
}

// Hatch set into the canopy: a curved steel door on the sphere between two ribs.
function patchGeometry(center, yawA, yawB, p0, p1, radius, flare = 1.12, nx = 8, ny = 24) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= ny; j++) {
    const v = j / ny, p = p0 + (p1 - p0) * v;
    const k = flare - (flare - 1) * ((p - -0.6) / 0.93);      // same flare as the ribs
    for (let i = 0; i <= nx; i++) {
      const u = i / nx, yaw = (yawA + (yawB - yawA) * u) * k;
      const q = onGlass(center, yaw, p, radius);
      pos.push(q.x, q.y, q.z); uv.push(u, v);
    }
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function makeDoor(center, hazardMat) {
  const group = new THREE.Group();
  const Rd = GLASS_RADIUS * 0.975;
  const YA = 0.33, YB = 0.6, P0 = -0.55, P1 = 0.3;           // door extents (yaw, pitch)
  const place = (obj, yaw, pitch, r = Rd - 0.008) => {
    const k = 1.12 - 0.12 * ((pitch + 0.6) / 0.93);
    obj.position.copy(onGlass(center, yaw * k, pitch, r));
    obj.lookAt(center);                                         // +Z faces the pilot
    group.add(obj);
    return obj;
  };

  const steel = new THREE.MeshStandardMaterial({ color: 0xa0a4a8, metalness: 0.9, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15170f, metalness: 0.3, roughness: 0.8 });
  const doorMat = new THREE.MeshStandardMaterial({
    map: wornTexture({ base: '#4e5a3f', seed: 77, w: 512, h: 1024, wear: 1.5 }),
    metalness: 0.5, roughness: 0.65, side: THREE.DoubleSide,
  });

  // door leaf
  const leaf = new THREE.Mesh(patchGeometry(center, YA, YB, P0, P1, Rd), doorMat);
  leaf.renderOrder = 0;
  group.add(leaf);
  // raised frame around the leaf
  const edge = (pts, r) => { const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, r, 6), steel); group.add(m); };
  const pt = (yaw, pitch, r = Rd - 0.004) => { const k = 1.12 - 0.12 * ((pitch + 0.6) / 0.93); return onGlass(center, yaw * k, pitch, r); };
  const line = (ya, pa, yb, pb) => Array.from({ length: 21 }, (_, i) => pt(ya + (yb - ya) * i / 20, pa + (pb - pa) * i / 20));
  edge(line(YA, P0, YA, P1), 0.007); edge(line(YB, P0, YB, P1), 0.007);
  edge(line(YA, P0, YB, P0), 0.007); edge(line(YA, P1, YB, P1), 0.007);
  // inner panel line (pressed recess)
  const inset = 0.03;
  for (const pts of [line(YA + inset, P0 + 0.05, YA + inset, P1 - 0.05), line(YB - inset, P0 + 0.05, YB - inset, P1 - 0.05),
    line(YA + inset, P0 + 0.05, YB - inset, P0 + 0.05), line(YA + inset, P1 - 0.05, YB - inset, P1 - 0.05)]) {
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.0035, 6), dark);
    group.add(m);
  }

  // rivets along the edges
  const rivetGeo = new THREE.SphereGeometry(0.006, 8, 6);
  for (let i = 0; i < 10; i++) {
    const p = P0 + 0.03 + (P1 - P0 - 0.06) * i / 9;
    for (const y of [YA + 0.012, YB - 0.012]) place(new THREE.Mesh(rivetGeo, steel), y, p);
  }
  for (let i = 0; i < 5; i++) {
    const y = YA + 0.04 + (YB - YA - 0.08) * i / 4;
    for (const p of [P0 + 0.012, P1 - 0.012]) place(new THREE.Mesh(rivetGeo, steel), y, p);
  }

  // hinges on the outer edge
  for (const p of [-0.42, -0.1, 0.2]) {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.075, 12), steel);
    place(h, YB + 0.008, p, Rd + 0.002);
    h.lookAt(center);                 // restore facing, then stand the barrel upright
    h.rotateX(Math.PI / 2);
    const plateH = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.07, 0.006), dark);
    place(plateH, YB - 0.02, p, Rd - 0.004);
  }

  // porthole
  const portY = (YA + YB) / 2, portP = 0.1;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.009, 10, 32), steel);
  place(ring, portY, portP);
  const pane = new THREE.Mesh(new THREE.CircleGeometry(0.05, 32),
    new THREE.MeshStandardMaterial({ color: 0x1d2b33, metalness: 0.9, roughness: 0.12, transparent: true, opacity: 0.65 }));
  place(pane, portY, portP, Rd - 0.004);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.006, 8), steel);
    bolt.rotation.x = Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(bolt);
    bolt.position.set(Math.cos(a) * 0.06, Math.sin(a) * 0.06, 0);
    place(holder, portY, portP, Rd - 0.012);
  }

  // handle (lever on a round boss) with a lock lamp
  const handleY = YA + 0.045, handleP = -0.12;
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.014, 20), steel);
  boss.rotation.x = Math.PI / 2;
  const bossG = new THREE.Group(); bossG.add(boss);
  place(bossG, handleY, handleP, Rd - 0.012);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.1, 0.012), dark);
  lever.position.set(0, 0.025, 0.012);
  lever.rotation.z = 0.2;
  bossG.add(lever);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x220a08, emissive: 0xff3b2a, emissiveIntensity: 1, roughness: 0.4 });
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.008, 12), lampMat);
  lamp.rotation.x = Math.PI / 2;
  const lampG = new THREE.Group(); lampG.add(lamp);
  place(lampG, handleY, handleP + 0.075, Rd - 0.011);

  // stencils and hazard stripe
  const stencil = (text, w, h, yaw, pitch, rot = 0) => {
    const l = labelMesh(text, w, h); l.rotation.set(0, 0, 0);
    const g = new THREE.Group(); g.add(l); g.rotation.z = rot;
    place(g, yaw, pitch, Rd - 0.0045);
    g.rotateZ(rot);
  };
  stencil('HATCH 02', 0.17, 0.034, portY, 0.24);
  stencil('PULL', 0.09, 0.026, portY, -0.2);
  stencil('NO STEP', 0.11, 0.026, portY, -0.5);
  const strip = new THREE.Mesh(patchGeometry(center, YA + 0.015, YB - 0.015, -0.4, -0.34, Rd - 0.003), hazardMat);
  group.add(strip);

  return { group, lampMat };
}

export function makeCockpit(sunDir = new THREE.Vector3(0.4, 0.6, -0.6).normalize()) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 10);

  scene.add(new THREE.HemisphereLight(0xdde8ff, 0x332211, 1.2));
  const key = new THREE.DirectionalLight(0xffeedd, 1.4);
  key.position.set(0.4, 1, 0.6);
  scene.add(key);
  const glow = new THREE.PointLight(0x55ff99, 0.6, 1.2);
  glow.position.set(0, -0.2, -0.45);
  scene.add(glow);

  // canopy: sphere centered behind the eye, so the glass curves around the view
  const center = new THREE.Vector3(0, 0, 0.55);
  const glassGeo = new THREE.SphereGeometry(GLASS_RADIUS, 64, 40, 0, Math.PI * 2, 0, Math.PI * 0.62);
  glassGeo.rotateX(-Math.PI / 2);           // open side faces the pilot (+Z)
  const glass = new THREE.Mesh(glassGeo, glassMaterial(sunDir));
  glass.position.copy(center);
  glass.renderOrder = 2;
  scene.add(glass);

  // canopy frame struts
  const frameMat = new THREE.MeshStandardMaterial({ map: wornTexture({ base: '#2a2d26', seed: 21, w: 512, h: 128, wear: 0.45, repeat: true }), metalness: 0.6, roughness: 0.55 });
  const arc = (yaw0, yaw1, p0, p1, n = 24) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push(onGlass(center, yaw0 + (yaw1 - yaw0) * t, p0 + (p1 - p0) * t));
    }
    return pts;
  };
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 0.8, roughness: 0.35 });
  const frame = new THREE.Group();
  // latitude bows across the top (pitch 0.33 is just inside the top edge of the view)
  frame.add(strut(arc(-1.1, 1.1, 0.33, 0.33, 40), 0.022, frameMat));
  frame.add(strut(arc(-1.1, 1.1, 0.215, 0.215, 40), 0.012, trimMat));
  // ribs sweeping up to the top bow, plus corner pillars
  for (const yaw of [-0.62, -0.46, -0.3, 0.3, 0.62]) {   // right side: one wide panel is the door
    const pillar = Math.abs(yaw) > 0.6;
    frame.add(strut(arc(yaw * 1.12, yaw, -0.6, 0.33), pillar ? 0.026 : 0.014, frameMat));
  }
  // brass collars where ribs meet the top bow
  for (const yaw of [-0.62, -0.3, 0.3, 0.62]) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), trimMat);
    c.position.copy(onGlass(center, yaw, 0.33));
    frame.add(c);
  }
  scene.add(frame);

  const hazardMat = new THREE.MeshBasicMaterial({ map: hazardTexture(), side: THREE.DoubleSide });
  const door = makeDoor(center, hazardMat);
  scene.add(door.group);

  const deck = makeDeck();
  scene.add(deck);

  const tmp = { t: 0, lastScreen: 0 };

  function resize(aspect) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    // fit the deck's width to the screen and pin it to the bottom edge
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * DECK_DEPTH;
    const visibleW = halfH * 2 * aspect;
    // full width on phones, ~60% of the view on wide screens
    const s = Math.min(visibleW * 0.94, Math.max(0.72, visibleW * 0.6)) / DECK_WIDTH;
    deck.scale.setScalar(s);
    deck.position.set(0, -halfH + 0.07 * s, -DECK_DEPTH);
  }

  const rot4 = new THREE.Matrix4();
  function update(dt, info) {
    glass.material.uniforms.uViewToWorld.value.setFromMatrix4(rot4.makeRotationFromQuaternion(info.camQuat));
    tmp.t += dt;
    const t = tmp.t;
    deck.userData.update(t, info);
    door.lampMat.emissiveIntensity = 0.5 + 0.5 * Math.sin(t * 2.4) ** 2 * (info.edge ? 3 : 1);
    if (t - tmp.lastScreen > 0.08) {
      tmp.lastScreen = t;
      deck.userData.screenTex.userData.draw(t, info);
    }
  }

  return { scene, camera, resize, update };
}

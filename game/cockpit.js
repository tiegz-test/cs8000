import * as THREE from 'three';

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
    },
    vertexShader: `varying vec3 vPos; varying vec3 vN;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vPos = mv.xyz; vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying vec3 vPos; varying vec3 vN;
      uniform mat3 uViewToWorld; uniform vec3 uSun;

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

function makeDeck() {
  const deck = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2e33, metalness: 0.7, roughness: 0.45 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 0.8, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111316, metalness: 0.4, roughness: 0.7 });

  // Base console: the body drops below the view, the top face tilts toward the pilot.
  const body = new THREE.Mesh(new THREE.BoxGeometry(DECK_WIDTH, 0.5, 0.36), metal);
  body.position.set(0, -0.25, -0.18);
  deck.add(body);

  const top = new THREE.Group();          // everything mounted on the tilted face
  top.position.set(0, 0, 0);
  top.rotation.x = 0.55;
  deck.add(top);
  const face = new THREE.Mesh(new THREE.BoxGeometry(DECK_WIDTH, 0.02, 0.36), metal);
  face.position.set(0, 0, -0.18);
  top.add(face);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(DECK_WIDTH, 0.025, 0.02), trim);
  lip.position.set(0, 0.01, -0.005);
  top.add(lip);

  // center screen in a bezel
  const screenTex = makeScreenTexture();
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.012, 0.24), dark);
  bezel.position.set(0, 0.016, -0.19);
  top.add(bezel);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.37, 0.21),
    new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  screen.rotation.x = -Math.PI / 2;
  screen.position.set(0, 0.023, -0.19);
  top.add(screen);

  // button banks on each side
  const blinkers = [];
  const colors = [0xff3322, 0xffaa22, 0x33ff77, 0x33aaff];
  const btnGeo = new THREE.CylinderGeometry(0.014, 0.016, 0.014, 20);
  for (const side of [-1, 1]) {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        const c = colors[(row + col + (side > 0 ? 1 : 0)) % colors.length];
        const mat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.6, roughness: 0.3 });
        const b = new THREE.Mesh(btnGeo, mat);
        b.position.set(side * (0.27 + col * 0.04), 0.016, -0.1 - row * 0.05);
        top.add(b);
        blinkers.push({ mat, rate: 0.6 + ((row * 7 + col * 3 + (side > 0 ? 5 : 0)) % 9) * 0.35, phase: row + col * 1.7 });
      }
    }
    // toggle switches
    for (let i = 0; i < 4; i++) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.01, 0.03), dark);
      base.position.set(side * (0.275 + i * 0.04), 0.014, -0.27);
      top.add(base);
      const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.005, 0.035, 8), trim);
      lever.position.set(side * (0.275 + i * 0.04), 0.03, -0.27);
      lever.rotation.x = i % 2 ? 0.5 : -0.5;
      top.add(lever);
    }
    // throttle lever
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.16), dark);
    slot.position.set(side * 0.43, 0.014, -0.19);
    top.add(slot);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.09, 10), metal);
    stick.position.set(side * 0.43, 0.06, -0.16);
    stick.rotation.x = -0.35;
    top.add(stick);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.02, 16, 12),
      new THREE.MeshStandardMaterial({ color: side < 0 ? 0xcc2211 : 0x222222, roughness: 0.4 }));
    knob.position.set(side * 0.43, 0.1, -0.145);
    top.add(knob);
  }

  // dial gauges flanking the screen
  for (const side of [-1, 1]) {
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.01, 28), dark);
    dial.position.set(side * 0.2 - side * 0.0, 0.016, -0.335);
    dial.position.x = side * 0.245;
    top.add(dial);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.03, 28),
      new THREE.MeshBasicMaterial({ color: 0x1c2a22 }));
    face.rotation.x = -Math.PI / 2;
    face.position.set(dial.position.x, 0.022, -0.335);
    top.add(face);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.002, 0.026),
      new THREE.MeshBasicMaterial({ color: 0xffaa33 }));
    needle.geometry.translate(0, 0, -0.013);
    needle.position.set(dial.position.x, 0.024, -0.335);
    top.add(needle);
    blinkers.push({ needle, side });
  }

  deck.userData = { blinkers, screenTex };
  return deck;
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
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0.6, roughness: 0.5 });
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
  for (const yaw of [-0.62, -0.46, -0.3, 0.3, 0.46, 0.62]) {
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
    for (const b of deck.userData.blinkers) {
      if (b.mat) b.mat.emissiveIntensity = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * b.rate * 3 + b.phase)) ** 3;
      if (b.needle) b.needle.rotation.y = b.side * 0.6 + Math.sin(t * 1.3 + b.side) * 0.25 + info.speed * 0.05;
    }
    if (t - tmp.lastScreen > 0.08) {
      tmp.lastScreen = t;
      deck.userData.screenTex.userData.draw(t, info);
    }
  }

  return { scene, camera, resize, update };
}

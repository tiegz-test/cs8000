// Tiny WebAudio beeper for the radar. Browsers (iOS especially) only allow
// audio after a user gesture, so call initAudio() from a tap/click handler.
let ctx = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) ctx = new AC();
}

export function beep(freq = 800, volume = 0.06, dur = 0.09) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// --- rocket booster: filtered noise for the roar plus a low rumble, kept faint ---
let thruster = null;

function buildThruster() {
  const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.06 * w) / 1.06; d[i] = last * 14; }   // brown-ish noise
  const noise = ctx.createBufferSource();
  noise.buffer = buf; noise.loop = true;
  const roar = ctx.createBiquadFilter();
  roar.type = 'lowpass'; roar.frequency.value = 500; roar.Q.value = 0.8;
  const hiss = ctx.createBiquadFilter();
  hiss.type = 'highpass'; hiss.frequency.value = 900;
  const hissGain = ctx.createGain(); hissGain.gain.value = 0.18;
  const rumble = ctx.createOscillator();
  rumble.type = 'sawtooth'; rumble.frequency.value = 52;
  const rumbleLp = ctx.createBiquadFilter();
  rumbleLp.type = 'lowpass'; rumbleLp.frequency.value = 130;
  const rumbleGain = ctx.createGain(); rumbleGain.gain.value = 0.35;
  const master = ctx.createGain(); master.gain.value = 0;

  noise.connect(roar).connect(master);
  noise.connect(hiss).connect(hissGain).connect(master);
  rumble.connect(rumbleLp).connect(rumbleGain).connect(master);
  master.connect(ctx.destination);
  noise.start(); rumble.start();
  return { master, roar, rumble, on: false };
}

// Call every frame (cheap): fades the booster in while thrusting and out when it stops.
export function setThruster(on) {
  if (!ctx || ctx.state !== 'running') return;
  if (!thruster) thruster = buildThruster();
  if (thruster.on === on) return;
  thruster.on = on;
  const t = ctx.currentTime;
  thruster.master.gain.cancelScheduledValues(t);
  thruster.master.gain.setTargetAtTime(on ? 0.026 : 0, t, on ? 0.03 : 0.1);      // faint
  thruster.roar.frequency.cancelScheduledValues(t);
  thruster.roar.frequency.setTargetAtTime(on ? 1100 : 450, t, on ? 0.35 : 0.2);   // roar opens up as it burns
  thruster.rumble.frequency.cancelScheduledValues(t);
  thruster.rumble.frequency.setTargetAtTime(on ? 68 : 48, t, 0.3);
}

// A louder, sharper whoosh for the double-tap boost: the booster flares, then settles back.
export function boostBurst() {
  if (!ctx || ctx.state !== 'running') return;
  if (!thruster) thruster = buildThruster();
  const t = ctx.currentTime, g = thruster.master.gain, resting = thruster.on ? 0.026 : 0;
  g.cancelScheduledValues(t);
  g.setValueAtTime(0.07, t);
  g.setTargetAtTime(resting, t + 0.1, 0.14);
  thruster.roar.frequency.cancelScheduledValues(t);
  thruster.roar.frequency.setValueAtTime(2400, t);
  thruster.roar.frequency.setTargetAtTime(thruster.on ? 1100 : 450, t + 0.05, 0.22);
  thruster.rumble.frequency.cancelScheduledValues(t);
  thruster.rumble.frequency.setValueAtTime(95, t);
  thruster.rumble.frequency.setTargetAtTime(thruster.on ? 68 : 48, t + 0.05, 0.25);
}

// --- combat sounds ---
// A turret's laser: a quick falling zap, quieter the farther away the turret is.
export function laserSound(dist = 100) {
  if (!ctx || ctx.state !== 'running') return;
  const vol = 0.05 * Math.max(0.12, 1 - dist / 380), t = ctx.currentTime;
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(1500, t);
  osc.frequency.exponentialRampToValueAtTime(260, t + 0.2);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t); osc.stop(t + 0.25);
}

// Taking a hit: a low thump with a crackle on top.
export function hitSound() {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const thump = ctx.createOscillator(), tg = ctx.createGain();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(150, t);
  thump.frequency.exponentialRampToValueAtTime(45, t + 0.25);
  tg.gain.setValueAtTime(0.22, t);
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  thump.connect(tg).connect(ctx.destination);
  thump.start(t); thump.stop(t + 0.32);
  const len = Math.floor(ctx.sampleRate * 0.25), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const noise = ctx.createBufferSource(), ng = ctx.createGain();
  noise.buffer = buf;
  ng.gain.value = 0.16;
  noise.connect(ng).connect(ctx.destination);
  noise.start(t);
}

// Hull gone: a long falling alarm tone.
export function deathSound() {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime, osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(520, t);
  osc.frequency.exponentialRampToValueAtTime(38, t + 1.6);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.09, t + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t); osc.stop(t + 1.75);
}

// --- missiles ---
// Launch: a rising rocket whoosh.
export function missileLaunch() {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime, len = Math.floor(ctx.sampleRate * 0.5), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.45);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  src.connect(bp).connect(g).connect(ctx.destination); src.start(t);
}

// Explosion: a low boom plus a rumbling noise tail, quieter with distance.
export function explosionSound(dist = 50) {
  if (!ctx || ctx.state !== 'running') return;
  const vol = Math.max(0.05, 1 - dist / 500), t = ctx.currentTime;
  const boom = ctx.createOscillator(), bg = ctx.createGain();
  boom.type = 'sine'; boom.frequency.setValueAtTime(110, t); boom.frequency.exponentialRampToValueAtTime(28, t + 0.6);
  bg.gain.setValueAtTime(0.5 * vol, t); bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
  boom.connect(bg).connect(ctx.destination); boom.start(t); boom.stop(t + 0.75);
  const len = Math.floor(ctx.sampleRate * 1.0), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const noise = ctx.createBufferSource(); noise.buffer = buf;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2200, t); lp.frequency.exponentialRampToValueAtTime(260, t + 0.9);
  const ng = ctx.createGain(); ng.gain.value = 0.35 * vol;
  noise.connect(lp).connect(ng).connect(ctx.destination); noise.start(t);
}

// --- rescue ---
// The hatch opening: a pneumatic hiss and a heavy clunk.
export function doorSound() {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime, len = Math.floor(ctx.sampleRate * 0.55), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
  const g = ctx.createGain(); g.gain.value = 0.09;
  src.connect(hp).connect(g).connect(ctx.destination); src.start(t);
  const clunk = ctx.createOscillator(), cg = ctx.createGain();
  clunk.type = 'square'; clunk.frequency.setValueAtTime(95, t + 0.45); clunk.frequency.exponentialRampToValueAtTime(45, t + 0.7);
  cg.gain.setValueAtTime(0.0001, t + 0.44); cg.gain.exponentialRampToValueAtTime(0.1, t + 0.46); cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
  clunk.connect(cg).connect(ctx.destination); clunk.start(t + 0.44); clunk.stop(t + 0.8);
}

// A pilot is aboard: a bright two-note chime (a longer rising run when the last one is saved).
export function rescueChime(all = false) {
  if (!ctx || ctx.state !== 'running') return;
  const notes = all ? [523, 659, 784, 1047] : [660, 880];
  notes.forEach((f, i) => {
    const t = ctx.currentTime + i * 0.14, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'triangle'; osc.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(g).connect(ctx.destination); osc.start(t); osc.stop(t + 0.45);
  });
}

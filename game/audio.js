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

// Seeded value-noise terrain: rolling hills plus ridged mountains.
export function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeHeightFn(seed) {
  const rand = mulberry32(seed);
  const N = 256;
  const grid = new Float32Array(N * N).map(() => rand());
  const g = (x, y) => grid[(y & (N - 1)) * N + (x & (N - 1))];
  const smooth = (t) => t * t * (3 - 2 * t);

  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const u = smooth(x - xi), v = smooth(y - yi);
    const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; // 0..1
  }
  function fbm(x, y, oct) {
    let sum = 0, amp = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { sum += amp * noise(x * f, y * f); f *= 2; amp *= 0.5; }
    return sum; // ~0..1
  }
  const ox = rand() * 100, oy = rand() * 100;

  return function height(x, z) {
    const hills = fbm(x * 0.008 + ox, z * 0.008 + oy, 4) * 14;
    // mask decides where mountains rise; ridged noise gives sharp peaks
    const mask = Math.max(0, fbm(x * 0.004 + oy, z * 0.004 + ox, 2) - 0.42) * 2.6;
    const ridge = 1 - Math.abs(fbm(x * 0.012 + ox, z * 0.012 + oy, 5) * 2 - 1);
    return hills + mask * ridge * ridge * 120;
  };
}

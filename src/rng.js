// Deterministic pseudo-random helpers. Same seed => same skyline, always.

export function mulberry32(a) {
  a = a >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function seedToInt(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function intToSeed(n) {
  const glyphs = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let v = n >>> 0;
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += glyphs[v % glyphs.length];
    v = Math.floor(v / glyphs.length);
  }
  return out;
}

export function randomSeed() {
  return intToSeed((Math.random() * 0xffffffff) >>> 0);
}

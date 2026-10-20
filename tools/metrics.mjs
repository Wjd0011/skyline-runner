// Prints the generator statistics quoted in docs/TEST-REPORT-v2.0.md.
// Usage: node tools/metrics.mjs [seeds]
import { World, EMPTY, SOLID, HAZARD, LEDGE, PAD } from '../src/world.js';
import { CHUNK_W, CHUNK_H, TILE, DIFFICULTIES } from '../src/config.js';
import { seedToInt } from '../src/rng.js';

const SEED_COUNT = Number(process.argv[2] || 24);
const CHUNKS = 40;
const CHUNK_M = (CHUNK_W * TILE) / 16;

const labels = Array.from({ length: SEED_COUNT }, (_, i) => `METRIC${i}`);

let buildings = 0;
let tall = 0;
let balconies = 0;
let orbs = 0;
let orbsIllegal = 0;
let walkers = 0;
let walkersIllegal = 0;
let flyers = 0;
let flyersIllegal = 0;
let gaps = 0;
let gapsOutOfRange = 0;
let calmViolations = 0;

const bands = [[96, 250], [250, 450], [450, 700], [700, 1200]];
const bandEnemies = bands.map(() => 0);

function hits(map, x, y, w, h) {
  const x0 = Math.floor(x / TILE);
  const x1 = Math.floor((x + w - 0.001) / TILE);
  const y0 = Math.floor(y / TILE);
  const y1 = Math.floor((y + h - 0.001) / TILE);
  for (let gy = y0; gy <= y1; gy++) {
    if (gy < 0 || gy >= CHUNK_H) continue;
    for (let gx = x0; gx <= x1; gx++) {
      if (gx < 0 || gx >= CHUNK_W) continue;
      if (map[gy * CHUNK_W + gx] !== EMPTY) return true;
    }
  }
  return false;
}

for (const label of labels) {
  const w = new World(seedToInt(label), DIFFICULTIES.normal);
  for (let i = 0; i < CHUNKS; i++) {
    const c = w.generate(i);
    for (const b of c.decor) {
      if (b.ledge) { balconies += 1; continue; }
      buildings += 1;
      if (b.h >= 4) tall += 1;
    }
    for (const s of c.spawns) {
      if (s.type === 'orb') {
        orbs += 1;
        if (hits(c.map, s.x - 9, s.y - 9, 18, 18)) orbsIllegal += 1;
      } else if (s.type === 'walker') {
        walkers += 1;
        const foot = Math.floor(s.y / TILE);
        const col = Math.floor(s.x / TILE);
        if (c.map[foot * CHUNK_W + col] !== SOLID) walkersIllegal += 1;
      } else if (s.type === 'flyer') {
        flyers += 1;
        if (hits(c.map, s.x - 16, s.y - 10, 32, 20)) flyersIllegal += 1;
      }
      if (i <= 1 && (s.type === 'walker' || s.type === 'flyer')) calmViolations += 1;
      if (i <= 1) continue;
      const metres = (i * CHUNK_W * TILE) / 16;
      bands.forEach(([a, b], k) => {
        if (metres >= a && metres < b && (s.type === 'walker' || s.type === 'flyer')) bandEnemies[k] += 1;
      });
    }
    for (const g of c.gaps) {
      gaps += 1;
      if (g.width < 2 || g.width > 3) gapsOutOfRange += 1;
    }
    if (i <= 1) {
      for (let k = 0; k < c.map.length; k++) if (c.map[k] === HAZARD) calmViolations += 1;
    }
  }
}

const genStart = performance.now();
{
  const w = new World(seedToInt('BENCH'), DIFFICULTIES.normal);
  for (let i = 0; i < 500; i++) w.generate(i);
}
const genMs = (performance.now() - genStart) / 500;

const pct = (a, b) => `${((a / b) * 100).toFixed(2)}%`;

console.log(`seeds                 ${SEED_COUNT} x ${CHUNKS} chunks`);
console.log(`buildings             ${buildings}`);
console.log(`  of which 4+ tiles   ${tall}`);
console.log(`balconies             ${balconies}  coverage ${pct(balconies, tall)}`);
console.log(`orbs                  ${orbs}  embedded ${orbsIllegal}`);
console.log(`walkers               ${walkers}  floating ${walkersIllegal}`);
console.log(`drones                ${flyers}  clipped ${flyersIllegal}`);
console.log(`canyons               ${gaps}  outside 2-3 ${gapsOutOfRange}`);
console.log(`calm-zone violations  ${calmViolations}`);
console.log(`chunk generation      ${genMs.toFixed(3)} ms  (budget 2 ms)`);
console.log('enemy density by distance band:');
bands.forEach(([a, b], k) => {
  const perMeter = bandEnemies[k] / (b - a) / SEED_COUNT;
  console.log(`  ${String(a).padStart(4)}-${String(b).padEnd(4)} m  ${perMeter.toFixed(4)} enemies/m`);
});

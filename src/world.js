import { TILE, CHUNK_W, CHUNK_H } from './config.js';
import { mulberry32, clamp, lerp } from './rng.js';
import { DIFFICULTIES } from './config.js';

export const EMPTY = 0;
export const SOLID = 1;
export const HAZARD = 2;
export const LEDGE = 3;
export const PAD = 4;

const CHUNK_PX = CHUNK_W * TILE;

export class World {
  constructor(seed, diff = DIFFICULTIES.normal) {
    this.seed = seed >>> 0;
    this.diff = diff || DIFFICULTIES.normal;
    this.chunks = new Map();
    this.newChunks = [];
    this.removedChunks = [];
  }

  chunkIndex(px) {
    return Math.floor(px / CHUNK_PX);
  }

  ensure(px) {
    const ci = this.chunkIndex(px);
    for (let i = ci - 2; i <= ci + 2; i++) {
      if (!this.chunks.has(i)) {
        const c = this.generate(i);
        this.chunks.set(i, c);
        this.newChunks.push(c);
      }
    }
    for (const [i, c] of this.chunks) {
      if (i < ci - 3 || i > ci + 3) {
        this.chunks.delete(i);
        this.removedChunks.push(c);
      }
    }
  }

  generate(i) {
    const rng = mulberry32((this.seed ^ Math.imul(i + 1013, 2654435761)) >>> 0);
    const map = new Uint8Array(CHUNK_W * CHUNK_H);
    const phase = ((this.seed % 997) / 997) * Math.PI * 2;
    const groundY = clamp(15 + Math.round(Math.sin(i * 0.53 + phase) * 1.6), 12, 17);

    for (let y = groundY; y < CHUNK_H; y++) {
      for (let x = 0; x < CHUNK_W; x++) map[y * CHUNK_W + x] = SOLID;
    }

    // spawn pressure is a function of distance, not of the chunk alone:
    // the first two chunks stay empty, then pressure ramps with the run.
    const meters = (i * CHUNK_PX) / 16;
    const [rampA, rampB] = this.diff.ramp;
    const t = clamp((meters - rampA) / Math.max(1, rampB - rampA), 0, 1);
    const walkerChance = lerp(this.diff.walker[0], this.diff.walker[1], t);
    const flyerChance = lerp(this.diff.flyer[0], this.diff.flyer[1], t);
    const speedMul = lerp(this.diff.speed[0], this.diff.speed[1], t);
    const calm = i <= 1;

    const decor = [];
    const spawns = [];
    const gaps = [];
    const startPad = i === 0 ? 7 : 2;
    let x = startPad;

    while (x < CHUNK_W - 4) {
      const gapStart = x;
      const gap = 2 + Math.floor(rng() * 2); // never narrower than two tiles
      x += gap;
      if (x >= CHUNK_W - 4) break;

      const w = 3 + Math.floor(rng() * 6);
      if (x + w > CHUNK_W - 1) break;

      // Buildings are terraced: tall blocks get stepped shoulders on both
      // sides so every rooftop is reachable without a perfect jump.
      // The opening chunk is kept low on purpose.
      const maxH = i === 0 ? 3 : w >= 6 ? 5 : 4;
      const h = 2 + Math.floor(rng() * (maxH - 1));
      const steps = h >= 4 ? Math.min(2, Math.floor((w - 1) / 2)) : 0;

      const heights = [];
      for (let c = 0; c < w; c++) {
        const edge = Math.min(c, w - 1 - c);
        const colH = h - Math.max(0, steps - edge);
        heights.push(colH);
        for (let yy = groundY - colH; yy < groundY; yy++) {
          map[yy * CHUNK_W + x + c] = SOLID;
        }
      }

      const top = groundY - h;
      const bseed = rng();
      decor.push({ x0: x, x1: x + w - 1, top, h, w, heights, steps, seed: bseed });

      // A two-tile balcony two blocks above the street is the guaranteed
      // first foothold for any building taller than a single jump.
      let hasBalcony = false;
      let balconyX = -1;
      if (h >= 4 && gap >= 2) {
        const bx = x - 2;
        const by = groundY - 3;
        if (bx >= 0 && map[by * CHUNK_W + bx] === EMPTY && map[by * CHUNK_W + bx + 1] === EMPTY) {
          map[by * CHUNK_W + bx] = LEDGE;
          map[by * CHUNK_W + bx + 1] = LEDGE;
          decor.push({
            x0: bx, x1: bx + 1, top: by, h: 1, w: 2,
            heights: [1, 1], steps: 0, seed: rng(), ledge: true,
          });
          hasBalcony = true;
          balconyX = bx;
        }
      }

      // launch pads only where the sky above the pad stays clear
      if (!hasBalcony && h >= 4 && rng() < 0.5) {
        const px = gapStart + Math.floor(gap / 2);
        if (map[(groundY - 1) * CHUNK_W + px] === EMPTY && map[(groundY - 2) * CHUNK_W + px] === EMPTY) {
          map[(groundY - 1) * CHUNK_W + px] = PAD;
        }
      }

      // street hazard in gaps that are actually walkable
      if (!hasBalcony && !calm && rng() < 0.5) {
        const hx = gapStart + Math.floor(gap / 2);
        if (map[(groundY - 1) * CHUNK_W + hx] === EMPTY && map[(groundY - 2) * CHUNK_W + hx] === EMPTY) {
          map[(groundY - 1) * CHUNK_W + hx] = HAZARD;
        }
      }

      // rooftop enemies stay on the flat crown, never on the terraces
      if (!calm && w >= 3 && rng() < walkerChance) {
        spawns.push({
          type: 'walker',
          x: (x + w / 2) * TILE,
          y: top * TILE,
          minX: (x + steps) * TILE + 8,
          maxX: (x + w - steps) * TILE - 8,
          speedMul,
        });
      }

      // rooftop orbs sit above the crown, never inside the block
      if (rng() < 0.4) {
        spawns.push({ type: 'orb', x: (x + steps + 0.6) * TILE, y: (top - 1.15) * TILE });
        spawns.push({ type: 'orb', x: (x + w - steps - 0.6) * TILE, y: (top - 1.15) * TILE });
      }

      gaps.push({ start: gapStart, width: gap, balconyX });
      x += w;
    }

    // canyon orbs float in open air above wide gaps, clear of every wall.
    // Narrow slots and tiles occupied by balconies are skipped entirely.
    for (const g of gaps) {
      if (g.width < 2) continue;
      if (rng() >= 0.6) continue;
      const cy = (groundY - 3.6) * TILE;
      const cx = (g.start + g.width / 2) * TILE;
      const tx = Math.floor(cx / TILE);
      const ty = Math.floor(cy / TILE);
      if (map[ty * CHUNK_W + tx] !== EMPTY) continue;
      if (g.balconyX >= 0 && tx >= g.balconyX && tx <= g.balconyX + 1) continue;
      spawns.push({ type: 'orb', x: cx, y: cy });
    }

    // drones patrolling the air
    if (!calm && rng() < flyerChance) {
      const fx = (2 + Math.floor(rng() * (CHUNK_W - 4))) * TILE;
      spawns.push({
        type: 'flyer',
        x: fx,
        y: (groundY - 3.4 - rng() * 1.8) * TILE,
        amp: 30 + rng() * 34,
        speed: 0.8 + rng() * 0.7,
        speedMul,
      });
    }

    return {
      index: i,
      baseX: i * CHUNK_PX,
      groundY,
      map,
      decor,
      spawns,
    };
  }

  tile(gx, gy) {
    if (gy < 0) return EMPTY;
    if (gy >= CHUNK_H) return SOLID;
    const ci = Math.floor(gx / CHUNK_W);
    const c = this.chunks.get(ci);
    if (!c) return EMPTY;
    const tx = gx - ci * CHUNK_W;
    return c.map[gy * CHUNK_W + tx];
  }

  solid(gx, gy) {
    const t = this.tile(gx, gy);
    return t === SOLID || t === LEDGE || t === PAD;
  }

  hazard(gx, gy) {
    return this.tile(gx, gy) === HAZARD;
  }

  pad(gx, gy) {
    return this.tile(gx, gy) === PAD;
  }

  groundAt(px) {
    const c = this.chunks.get(this.chunkIndex(px));
    return c ? c.groundY * TILE : 15 * TILE;
  }
}

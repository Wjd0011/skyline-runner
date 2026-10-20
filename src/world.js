import { TILE, CHUNK_W, CHUNK_H } from './config.js';
import { mulberry32, clamp, lerp } from './rng.js';
import { DIFFICULTIES } from './config.js';

export const EMPTY = 0;
export const SOLID = 1;
export const HAZARD = 2;
export const LEDGE = 3;
export const PAD = 4;

const CHUNK_PX = CHUNK_W * TILE;

/**
 * Spawn pressure for a distance in metres. Pure and monotone by
 * construction: chances only ever rise until the ramp saturates.
 */
export function spawnPressure(diff, meters) {
  const [rampA, rampB] = diff.ramp;
  const t = clamp((meters - rampA) / Math.max(1, rampB - rampA), 0, 1);
  return {
    t,
    walkerChance: lerp(diff.walker[0], diff.walker[1], t),
    flyerChance: lerp(diff.flyer[0], diff.flyer[1], t),
    speedMul: lerp(diff.speed[0], diff.speed[1], t),
  };
}

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
    const { walkerChance, flyerChance, speedMul } = spawnPressure(this.diff, meters);
    const calm = i <= 1;

    const decor = [];
    const spawns = [];
    const gaps = [];
    const startPad = i === 0 ? 7 : 2;
    let x = startPad;

    while (x < CHUNK_W - 4) {
      const gapStart = x;
      let gap = 2 + Math.floor(rng() * 2); // never narrower than two tiles
      x += gap;
      if (x >= CHUNK_W - 4) break;

      const w = 3 + Math.floor(rng() * 6);
      if (x + w > CHUNK_W - 1) break;

      // Buildings are terraced: tall blocks get stepped shoulders on both
      // sides so every rooftop is reachable without a perfect jump.
      // The opening chunk is kept low on purpose.
      const maxH = i === 0 ? 3 : w >= 6 ? 5 : 4;
      const h = 2 + Math.floor(rng() * (maxH - 1));

      // A tall block needs a balcony, and a balcony needs somewhere to jump
      // from. Widen the canyon to three tiles so the two-tile balcony still
      // leaves one street tile free directly in front of it.
      if (h >= 4 && gap < 3) {
        gap = 3;
        x = gapStart + gap;
        if (x + w > CHUNK_W - 1) break;
      }

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

      // rooftop enemies walk the whole roof, terraces included. Patrol
      // bounds are body-centre bounds, so the body never hangs past a wall.
      if (!calm && w >= 3 && rng() < walkerChance) {
        const wx = (x + w / 2) * TILE;
        if (rectFree(map, wx - 15, top * TILE - 26, 30, 26)) {
          spawns.push({
            type: 'walker',
            x: wx,
            y: top * TILE,
            minX: x * TILE + 16,
            maxX: (x + w) * TILE - 16,
            speedMul,
          });
        }
      }

      // rooftop orbs sit above the crown, never inside the block
      if (rng() < 0.4) {
        for (const ox of [x + steps + 0.6, x + w - steps - 0.6]) {
          const px = ox * TILE;
          const py = (top - 1.15) * TILE;
          if (rectFree(map, px - 9, py - 9, 18, 18)) spawns.push({ type: 'orb', x: px, y: py });
        }
      }

      gaps.push({ start: gapStart, width: gap, balconyX });
      x += w;
    }

    // canyon orbs float in open air above the gaps, clear of every wall.
    for (const g of gaps) {
      if (g.width < 2) continue;
      if (rng() >= 0.6) continue;
      const cy = (groundY - 3.6) * TILE;
      const cx = (g.start + g.width / 2) * TILE;
      if (!rectFree(map, cx - 9, cy - 9, 18, 18)) continue;
      spawns.push({ type: 'orb', x: cx, y: cy });
    }

    // drones patrol open air: never spawn inside a tower or a balcony
    if (!calm && rng() < flyerChance) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const fx = (2 + rng() * (CHUNK_W - 4)) * TILE;
        const fy = (groundY - 3.4 - rng() * 1.8) * TILE;
        if (!rectFree(map, fx - 16, fy - 10, 32, 20)) continue;
        spawns.push({
          type: 'flyer',
          x: fx,
          y: fy,
          amp: 30 + rng() * 34,
          speed: 0.8 + rng() * 0.7,
          speedMul,
        });
        break;
      }
    }

    return {
      index: i,
      baseX: i * CHUNK_PX,
      groundY,
      map,
      decor,
      gaps,
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

/** True when no non-empty tile touches the given pixel rectangle. */
export function rectFree(map, x, y, w, h) {
  const x0 = Math.floor(x / TILE);
  const x1 = Math.floor((x + w - 0.001) / TILE);
  const y0 = Math.floor(y / TILE);
  const y1 = Math.floor((y + h - 0.001) / TILE);
  for (let gy = y0; gy <= y1; gy++) {
    if (gy < 0) continue;
    if (gy >= CHUNK_H) return false;
    for (let gx = x0; gx <= x1; gx++) {
      if (gx < 0 || gx >= CHUNK_W) continue;
      if (map[gy * CHUNK_W + gx] !== EMPTY) return false;
    }
  }
  return true;
}

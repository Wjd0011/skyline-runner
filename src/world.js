import { TILE, CHUNK_W, CHUNK_H } from './config.js';
import { mulberry32, clamp, lerp } from './rng.js';
import { DIFFICULTIES } from './config.js';

export const EMPTY = 0;
export const SOLID = 1;
export const HAZARD = 2;
export const LEDGE = 3;

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

    // spawn pressure is a function of distance, not of the chunk alone:
    // the first two chunks stay empty, then pressure ramps with the run.
    const meters = (i * CHUNK_PX) / 16;
    const [rampA, rampB] = this.diff.ramp;
    const t = clamp((meters - rampA) / Math.max(1, rampB - rampA), 0, 1);
    const walkerChance = lerp(this.diff.walker[0], this.diff.walker[1], t);
    const flyerChance = lerp(this.diff.flyer[0], this.diff.flyer[1], t);
    const speedMul = lerp(this.diff.speed[0], this.diff.speed[1], t);
    const calm = i <= 1;
    const map = new Uint8Array(CHUNK_W * CHUNK_H);
    const phase = ((this.seed % 997) / 997) * Math.PI * 2;
    const groundY = clamp(15 + Math.round(Math.sin(i * 0.53 + phase) * 1.6), 12, 17);

    for (let y = groundY; y < CHUNK_H; y++) {
      for (let x = 0; x < CHUNK_W; x++) map[y * CHUNK_W + x] = SOLID;
    }

    const decor = [];
    const spawns = [];
    const startPad = i === 0 ? 7 : 1;
    let x = startPad;

    while (x < CHUNK_W - 4) {
      const gapStart = x;
      const gap = 1 + Math.floor(rng() * 3);
      x += gap;
      if (x >= CHUNK_W - 4) break;

      const w = 3 + Math.floor(rng() * 6);
      if (x + w > CHUNK_W - 1) break;

      const h = 2 + Math.floor(rng() * 4);
      const top = groundY - h;

      for (let yy = top; yy < groundY; yy++) {
        for (let xx = x; xx < x + w; xx++) map[yy * CHUNK_W + xx] = SOLID;
      }

      const bseed = rng();
      decor.push({ x0: x, x1: x + w - 1, top, h, w, seed: bseed });

      // stepping platform above the canyon keeps tall rooftops reachable
      if (gap >= 2 && rng() < 0.45) {
        const lx = gapStart;
        const ly = groundY - 3;
        const lw = Math.min(2, gap);
        let ok = true;
        for (let i = 0; i < lw; i++) {
          if (map[ly * CHUNK_W + lx + i] !== EMPTY) ok = false;
        }
        if (ok) {
          for (let i = 0; i < lw; i++) map[ly * CHUNK_W + lx + i] = LEDGE;
          decor.push({ x0: lx, x1: lx + lw - 1, top: ly, h: 1, w: lw, seed: rng(), ledge: true });
        }
      }

      // street hazard in the gap before this building
      if (!calm && gap >= 2 && rng() < 0.5) {
        const hx = gapStart + Math.floor(gap / 2);
        if (map[(groundY - 1) * CHUNK_W + hx] === EMPTY) {
          map[(groundY - 1) * CHUNK_W + hx] = HAZARD;
        }
      }

      // rooftop enemies
      if (!calm && w >= 3 && rng() < walkerChance) {
        spawns.push({
          type: 'walker',
          x: (x + w / 2) * TILE,
          y: top * TILE,
          minX: x * TILE + 8,
          maxX: (x + w) * TILE - 8,
          speedMul,
        });
      }

      // rooftop orbs
      if (rng() < 0.4) {
        spawns.push({ type: 'orb', x: (x + w * 0.32) * TILE, y: (top - 1.15) * TILE });
        spawns.push({ type: 'orb', x: (x + w * 0.68) * TILE, y: (top - 1.15) * TILE });
      }

      x += w;
    }

    // canyon orbs above street gaps
    for (let tx = 1; tx < CHUNK_W - 2; tx += 1) {
      if (map[(groundY - 1) * CHUNK_W + tx] !== EMPTY) continue;
      if (map[(groundY - 3) * CHUNK_W + tx] === SOLID) continue;
      if (rng() < 0.05) {
        spawns.push({ type: 'orb', x: (tx + 0.5) * TILE, y: (groundY - 2.2) * TILE });
      }
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
    return t === SOLID || t === LEDGE;
  }

  hazard(gx, gy) {
    return this.tile(gx, gy) === HAZARD;
  }

  groundAt(px) {
    const c = this.chunks.get(this.chunkIndex(px));
    return c ? c.groundY * TILE : 15 * TILE;
  }
}

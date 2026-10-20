// Shared helpers for the zero-dependency test suite.
import { PHYS, TILE } from '../../src/config.js';
import { seedToInt } from '../../src/rng.js';
import { Player } from '../../src/player.js';

export { PHYS, TILE, Player };

export const SEEDS = [
  'NEON42', 'SKYLINE', 'MIDNIGHT', 'A1B2C3', 'Z9Y8X7', 'RUNNER',
  'DEEPBLUE', 'HORIZON', 'ULTRAVIOLET', 'CITYLIGHTS', 'AFTERGLOW', 'STARDUST',
];

export function seedInt(label) {
  return seedToInt(label);
}

export class StubRenderer {
  constructor(viewW = 1000, viewH = 820) {
    this.viewW = viewW;
    this.viewH = viewH;
  }
}

export function stubAudio() {
  const noop = () => {};
  return {
    enabled: true,
    init: noop, jump: noop, land: noop, pad: noop, pickup: noop,
    stomp: noop, hurt: noop, over: noop, start: noop,
  };
}

export const IDLE = { axis: 0, jumpHeld: false, jumpPressed: false };

/**
 * Infinite ground at row `top`, plus optional solid rectangles.
 * Stand-in for World in physics tests — same solid() contract.
 */
export function flatWorld({ top = 12, extras = [], pitAfter = Infinity } = {}) {
  const solid = (gx, gy) => {
    if (gy < top) {
      return extras.some((r) => gx >= r.x0 && gx <= r.x1 && gy >= r.y0 && gy <= r.y1);
    }
    if (gx > pitAfter) return false;
    return true;
  };
  return { solid, hazard: () => false, pad: () => false };
}

export function stepPlayer(player, world, input, seconds, dt = 1 / 120) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) player.update(dt, input, world);
}

export function spawnPlayer(tileX = 5, top = 12, hp = 3) {
  return new Player(tileX * TILE, top * TILE - PHYS.h, hp);
}

/** AABB overlap in tile space for a pixel rect, ignoring empty tiles. */
export function rectHits(map, CHUNK_W, CHUNK_H, x, y, w, h) {
  const x0 = Math.floor(x / TILE);
  const x1 = Math.floor((x + w - 0.001) / TILE);
  const y0 = Math.floor(y / TILE);
  const y1 = Math.floor((y + h - 0.001) / TILE);
  for (let gy = y0; gy <= y1; gy++) {
    if (gy < 0 || gy >= CHUNK_H) continue;
    for (let gx = x0; gx <= x1; gx++) {
      if (gx < 0 || gx >= CHUNK_W) continue;
      if (map[gy * CHUNK_W + gx] !== 0) return true;
    }
  }
  return false;
}

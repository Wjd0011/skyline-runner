import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../../src/world.js';
import { Walker, Flyer, Orb } from '../../src/entities.js';
import { TILE, DIFFICULTIES } from '../../src/config.js';
import { seedInt } from './helpers.mjs';

const DT = 1 / 60;

function chunkZero(label = 'SKYLINE') {
  const w = new World(seedInt(label), DIFFICULTIES.normal);
  const c = w.generate(0);
  w.chunks.set(0, c);
  return { w, c };
}

function walkerOn(b, chunkIndex = 0) {
  return new Walker({
    chunkIndex,
    x: (b.x0 + b.w / 2) * TILE,
    y: b.top * TILE,
    minX: b.x0 * TILE + 16,
    maxX: (b.x1 + 1) * TILE - 16,
    speedMul: 1,
  });
}

const idlePlayer = { x: -1e6, y: 0, w: 26, h: 40, alive: true };

test('a patrolling walker reverses at both ends and never leaves the roof (AC-F3-01)', () => {
  const { w, c } = chunkZero();
  const b = c.decor.find((d) => !d.ledge && d.w >= 4);
  assert.ok(b, 'chunk 0 has no building wide enough for a walker');

  const e = walkerOn(b);
  const game = { world: w, player: idlePlayer };
  let turns = 0;
  let lastDir = e.dir;

  for (let t = 0; t < 60; t += DT) {
    e.update(DT, game);
    const col = Math.floor(e.x / TILE);
    const row = Math.round(e.y / TILE);
    assert.ok(w.solid(col, row), `walker lost its footing at t=${t.toFixed(2)}`);
    assert.ok(e.x >= e.minX - 0.5 && e.x <= e.maxX + 0.5, 'walker escaped its patrol span');
    if (e.dir !== lastDir) { turns += 1; lastDir = e.dir; }
  }
  assert.ok(turns >= 4, `expected several reversals in 60 s, saw ${turns}`);
});

test('a walker turns toward the player within 0.3 s (AC-F3-02)', () => {
  const { w, c } = chunkZero();
  const b = c.decor.find((d) => !d.ledge && d.w >= 4);
  const e = walkerOn(b);
  e.dir = -1; // start facing away

  const player = { x: e.x + 200, y: e.y - 40, w: 26, h: 40, alive: true };
  e.update(DT, { world: w, player }); // one frame

  assert.equal(e.chasing, true);
  assert.equal(e.dir, 1, 'walker did not turn toward the player');
});

test('a drone within 300 px closes in within 1 s (AC-F3-05)', () => {
  const { w } = chunkZero();
  const player = { x: 0, y: 0, w: 26, h: 40, alive: true };
  const e = new Flyer({ chunkIndex: 0, x: 250, y: 0, amp: 20, speed: 1, speedMul: 1 });
  const game = { world: w, player };

  const start = Math.hypot(e.x - player.x, e.y - player.y);
  for (let t = 0; t < 1; t += DT) e.update(DT, game);
  const end = Math.hypot(e.x - player.x, e.y - player.y - 30);

  assert.ok(e.attack > 0.5, 'drone never entered attack mode');
  assert.ok(end < start - 40, `drone barely moved: ${start.toFixed(1)} -> ${end.toFixed(1)}`);
});

test('a drone ignores a player outside 300 px', () => {
  const { w } = chunkZero();
  const player = { x: 900, y: 0, w: 26, h: 40, alive: true };
  const e = new Flyer({ chunkIndex: 0, x: 0, y: 0, amp: 20, speed: 1, speedMul: 1 });
  for (let t = 0; t < 1; t += DT) e.update(DT, { world: w, player });
  assert.ok(e.attack < 0.05);
});

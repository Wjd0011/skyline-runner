import test from 'node:test';
import assert from 'node:assert/strict';
import { World, EMPTY, SOLID, HAZARD, LEDGE, PAD, spawnPressure } from '../../src/world.js';
import { CHUNK_W, CHUNK_H, TILE, DIFFICULTIES } from '../../src/config.js';
import { SEEDS, seedInt, rectHits } from './helpers.mjs';

const CHUNK_M = (CHUNK_W * TILE) / 16; // 48 m per chunk

function chunks(label, upTo = 30, diff = DIFFICULTIES.normal) {
  const w = new World(seedInt(label), diff);
  const out = [];
  for (let i = 0; i <= upTo; i++) out.push(w.generate(i));
  return out;
}

test('deterministic generation: same seed, same bytes (AC-F2-01)', () => {
  for (const label of SEEDS) {
    const a = new World(seedInt(label), DIFFICULTIES.normal);
    const b = new World(seedInt(label), DIFFICULTIES.normal);
    for (let i = 0; i < 20; i++) {
      const ca = a.generate(i);
      const cb = b.generate(i);
      assert.deepEqual(ca.map, cb.map, `${label} chunk ${i} tiles differ`);
      assert.equal(ca.groundY, cb.groundY);
      assert.equal(JSON.stringify(ca.spawns), JSON.stringify(cb.spawns), `${label} chunk ${i} spawns differ`);
    }
  }
});

test('buildings are solid, grounded columns (TC-06 structure)', () => {
  for (const label of SEEDS.slice(0, 6)) {
    for (const c of chunks(label, 20)) {
      for (const b of c.decor) {
        if (b.ledge) continue;
        assert.equal(b.heights.length, b.w);
        for (let col = 0; col < b.w; col++) {
          const hh = b.heights[col];
          const start = c.groundY - hh;
          for (let y = start; y < c.groundY; y++) {
            assert.equal(c.map[y * CHUNK_W + (b.x0 + col)], SOLID, `${label} chunk ${c.index} hole at ${b.x0 + col},${y}`);
          }
          // nothing floats above the column
          for (let y = start - 1; y >= 0; y--) {
            assert.notEqual(c.map[y * CHUNK_W + (b.x0 + col)], SOLID, `${label} floating tile at ${b.x0 + col},${y}`);
          }
        }
      }
    }
  }
});

test('every 4+ tile building has a reachable 2-wide balcony at <=96 px (AC-F2-02)', () => {
  let balconies = 0;
  for (const label of SEEDS) {
    for (const c of chunks(label, 30)) {
      for (const b of c.decor) {
        if (b.ledge || b.h < 4) continue;
        balconies += 1;
        const bx = b.x0 - 2;
        const by = c.groundY - 3;
        assert.equal(c.map[by * CHUNK_W + bx], LEDGE, `${label} chunk ${c.index}: balcony missing at ${bx}`);
        assert.equal(c.map[by * CHUNK_W + bx + 1], LEDGE, `${label} chunk ${c.index}: balcony is not 2 wide`);
        assert.ok((c.groundY - by) * TILE <= 96, 'balcony higher than 96 px');
        // the tile in front of the balcony must be open street, otherwise
        // the balcony cannot be reached from the ground at all
        assert.equal(
          c.map[(c.groundY - 1) * CHUNK_W + (bx - 1)],
          EMPTY,
          `${label} chunk ${c.index}: no launch tile in front of the balcony`,
        );
      }
    }
  }
  assert.ok(balconies > 40, `expected many tall buildings, saw ${balconies}`);
});

test('no orb is embedded in a wall or a balcony (AC-F2-03)', () => {
  let orbs = 0;
  for (const label of SEEDS) {
    for (const c of chunks(label, 30)) {
      for (const s of c.spawns) {
        if (s.type !== 'orb') continue;
        orbs += 1;
        assert.equal(
          rectHits(c.map, CHUNK_W, CHUNK_H, s.x - 9, s.y - 9, 18, 18),
          false,
          `${label} chunk ${c.index}: orb at ${s.x.toFixed(1)},${s.y.toFixed(1)} is inside geometry`,
        );
      }
    }
  }
  assert.ok(orbs > 100, `expected many orbs, saw ${orbs}`);
});

test('walkers stand on solid roof and stay inside their patrol span (AC-F3-06)', () => {
  let walkers = 0;
  for (const label of SEEDS) {
    for (const c of chunks(label, 30)) {
      for (const s of c.spawns) {
        if (s.type !== 'walker') continue;
        walkers += 1;
        const footTile = Math.floor(s.y / TILE);
        const col = Math.floor(s.x / TILE);
        assert.equal(c.map[footTile * CHUNK_W + col], SOLID, `${label} chunk ${c.index}: walker is floating`);
        assert.equal(
          rectHits(c.map, CHUNK_W, CHUNK_H, s.x - 15, s.y - 26, 30, 26),
          false,
          `${label} chunk ${c.index}: walker overlaps geometry`,
        );
        assert.ok(s.maxX > s.minX, 'walker patrol span is inverted');
        assert.ok(s.maxX - s.minX >= 32, 'walker patrol span is too small to walk');
      }
    }
  }
  assert.ok(walkers > 100, `expected many walkers, saw ${walkers}`);
});

test('drones never spawn inside a tower (AC-F3-06)', () => {
  let flyers = 0;
  for (const label of SEEDS) {
    for (const c of chunks(label, 30)) {
      for (const s of c.spawns) {
        if (s.type !== 'flyer') continue;
        flyers += 1;
        assert.equal(
          rectHits(c.map, CHUNK_W, CHUNK_H, s.x - 16, s.y - 10, 32, 20),
          false,
          `${label} chunk ${c.index}: drone clipped into geometry`,
        );
      }
    }
  }
  assert.ok(flyers > 50, `expected many drones, saw ${flyers}`);
});

test('canyon width is always 2-3 tiles (AC-F2-04)', () => {
  for (const label of SEEDS) {
    for (const c of chunks(label, 40)) {
      for (const g of c.gaps) {
        assert.ok(g.width >= 2 && g.width <= 3, `${label} chunk ${c.index}: canyon width ${g.width}`);
      }
    }
  }
});

test('first 96 m are enemy-free and spike-free on all difficulties (AC-F4-02)', () => {
  for (const diff of Object.values(DIFFICULTIES)) {
    for (const label of SEEDS) {
      const w = new World(seedInt(label), diff);
      for (let i = 0; i < 2; i++) {
        const c = w.generate(i);
        for (const s of c.spawns) {
          assert.ok(s.type === 'orb' || s.type === 'pad', `${diff.id} ${label} chunk ${i}: ${s.type} inside calm zone`);
        }
        for (let k = 0; k < c.map.length; k++) {
          assert.notEqual(c.map[k], HAZARD, `${diff.id} ${label} chunk ${i}: spike inside calm zone`);
        }
      }
    }
  }
});

test('spawn pressure never falls with distance, on every difficulty (AC-F4-03)', () => {
  for (const diff of Object.values(DIFFICULTIES)) {
    let prevWalk = -1;
    let prevFly = -1;
    let prevSpeed = -1;
    for (let m = 0; m <= 4000; m += 5) {
      const p = spawnPressure(diff, m);
      assert.ok(p.walkerChance >= prevWalk - 1e-12, `${diff.id}: walker chance fell at ${m} m`);
      assert.ok(p.flyerChance >= prevFly - 1e-12, `${diff.id}: drone chance fell at ${m} m`);
      assert.ok(p.speedMul >= prevSpeed - 1e-12, `${diff.id}: enemy speed fell at ${m} m`);
      prevWalk = p.walkerChance;
      prevFly = p.flyerChance;
      prevSpeed = p.speedMul;
    }
    assert.ok(prevWalk > diff.walker[0], `${diff.id}: walker chance never ramped`);
  }
});

test('sampled enemy density tracks the ramp across four distance bands (AC-F4-03)', () => {
  const bands = [
    [96, 250],
    [250, 450],
    [450, 700],
    [700, 1200],
  ];
  const counts = bands.map(() => 0);
  const meters = bands.map(([a, b]) => b - a);
  const labels = Array.from({ length: 24 }, (_, i) => `BAND${i}`);

  for (const label of labels) {
    const w = new World(seedInt(label), DIFFICULTIES.normal);
    for (let i = 0; i < 26; i++) {
      const c = w.generate(i);
      const startM = i * CHUNK_M;
      for (const s of c.spawns) {
        if (s.type !== 'walker' && s.type !== 'flyer') continue;
        bands.forEach(([a, b], k) => {
          if (startM >= a && startM < b) counts[k] += 1;
        });
      }
    }
  }

  const rates = counts.map((n, k) => n / meters[k] / labels.length);
  // The pressure ramp saturates at 600 m, so bands 3 and 4 share the same
  // expected density. A 24-seed sample is Poisson-noisy (~5% sd) and may
  // dip a few percent; the exact invariant above pins the curve, and this
  // check only has to rule out a real regression.
  for (let k = 1; k < rates.length; k++) {
    assert.ok(
      rates[k] >= rates[k - 1] * 0.9,
      `density dropped: band ${k - 1}=${rates[k - 1].toFixed(4)} band ${k}=${rates[k].toFixed(4)}`,
    );
  }
  assert.ok(rates[3] > rates[0] * 1.5, `density barely ramps: ${rates.map((r) => r.toFixed(3)).join(' -> ')}`);
});

test('ten different seeds produce ten different skylines (AC-F2-06)', () => {
  const signatures = new Set();
  for (let i = 0; i < 10; i++) {
    const w = new World(seedInt(`RANDOM${i}`), DIFFICULTIES.normal);
    const sig = [0, 1, 2, 3, 4, 5]
      .map((k) => Buffer.from(w.generate(k).map).toString('base64'))
      .join('|');
    signatures.add(sig);
  }
  assert.equal(signatures.size, 10, 'two random seeds produced the same layout');
});

test('chunk generation stays under the 2 ms budget (AC-F2-05)', () => {
  const w = new World(seedInt('BENCH'), DIFFICULTIES.normal);
  const N = 400;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) w.generate(i);
  const perChunk = (performance.now() - t0) / N;
  assert.ok(perChunk < 2, `generation took ${perChunk.toFixed(3)} ms/chunk`);
});

test('streaming a 3000 m run keeps memory bounded (TC-10)', () => {
  const w = new World(seedInt('LONGHAUL'), DIFFICULTIES.normal);
  let maxChunks = 0;
  for (let px = 0; px <= 3000 * 16; px += 64) {
    w.ensure(px);
    maxChunks = Math.max(maxChunks, w.chunks.size);
    if (w.newChunks.length) w.newChunks.length = 0;
  }
  assert.ok(maxChunks <= 7, `window grew to ${maxChunks} chunks`);
});

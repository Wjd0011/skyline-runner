import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../src/game.js';
import { Orb, Walker } from '../../src/entities.js';
import { TILE, DIFFICULTIES } from '../../src/config.js';
import { StubRenderer, stubAudio, seedInt } from './helpers.mjs';

const DT = 1 / 120;
const IDLE = { axis: 0, jumpHeld: false, jumpPressed: false };

function makeGame(diff = DIFFICULTIES.normal) {
  const g = new Game(new StubRenderer(), stubAudio(), seedInt('TESTSEED'), 'TESTSEED', diff);
  g.start();
  g.enemies = [];
  g.orbs = [];
  return g;
}

function orbAt(g, x, y) {
  const o = new Orb({ chunkIndex: 0, x, y });
  g.orbs.push(o);
  return o;
}

test('three consecutive orbs on normal score 60 (AC-F5-01)', () => {
  const g = makeGame();
  const p = g.player;
  for (let i = 0; i < 3; i++) {
    orbAt(g, p.x + p.w / 2, p.y + p.h / 2);
    g.update(DT, IDLE);
  }
  assert.equal(g.score, 60);
});

test('the combo resets after 2.4 s without a pickup (AC-F5-02)', () => {
  const g = makeGame();
  const p = g.player;
  orbAt(g, p.x + p.w / 2, p.y + p.h / 2);
  g.update(DT, IDLE);
  assert.equal(g.score, 10);

  for (let i = 0; i < Math.ceil(2.5 / DT); i++) g.update(DT, IDLE);
  assert.equal(g.combo, 0, 'combo did not decay');

  orbAt(g, p.x + p.w / 2, p.y + p.h / 2);
  g.update(DT, IDLE);
  assert.equal(g.score, 20, 'the next orb should score as a fresh x1 pickup');
});

test('stomping an enemy kills it, bounces the player and scores 50 x multiplier (AC-F3-03)', () => {
  const g = makeGame(DIFFICULTIES.hard);
  const p = g.player;

  const ground = Math.round(p.y + p.h);
  const w = new Walker({
    chunkIndex: 0,
    x: p.x + p.w / 2,
    y: ground,
    minX: p.x - 100,
    maxX: p.x + 100,
    speedMul: 1,
  });
  g.enemies.push(w);

  p.y = w.bounds.y - p.h + 5; // feet just past the walker's head
  p.vy = 300;

  g.update(DT, IDLE);

  assert.equal(w.alive, false, 'enemy survived the stomp');
  assert.ok(p.vy < 0, 'player did not bounce');
  assert.equal(g.score, Math.round(50 * 1.3));
});

test('touching an enemy from the side costs one heart and grants invulnerability (AC-F3-04)', () => {
  const g = makeGame();
  const p = g.player;
  const hp0 = p.hp;

  const w = new Walker({
    chunkIndex: 0,
    x: p.x + p.w / 2 + 10,
    y: Math.round(p.y + p.h),
    minX: p.x - 100,
    maxX: p.x + 200,
    speedMul: 1,
  });
  g.enemies.push(w);

  g.update(DT, IDLE);
  assert.equal(p.hp, hp0 - 1, 'side contact did not damage the player');
  assert.ok(p.iframes > 0);

  g.update(DT, IDLE);
  assert.equal(p.hp, hp0 - 1, 'second contact during i-frames cost another heart');
});

test('a hazard costs a heart and respects i-frames (AC-F3-04)', () => {
  const g = makeGame();
  const p = g.player;
  const hp0 = p.hp;

  g.world = { hazard: () => true, solid: () => false, ensure: () => {}, newChunks: [], removedChunks: [] };

  g.updateHazards();
  assert.equal(p.hp, hp0 - 1);

  g.updateHazards();
  assert.equal(p.hp, hp0 - 1, 'i-frames did not block the second hit');
});

test('losing the last heart ends the run with the current score and distance (AC-F5-03)', () => {
  const g = makeGame();
  let reported = null;
  g.onOver = (score, distance) => { reported = { score, distance }; };

  g.score = 1234;
  g.distance = 456;
  g.player.hp = 1;
  g.player.alive = false;

  g.update(DT, IDLE);

  assert.equal(g.state, 'over');
  assert.deepEqual(reported, { score: 1234, distance: 456 });
});

test('the run ends exactly once', () => {
  const g = makeGame();
  let count = 0;
  g.onOver = () => { count += 1; };
  g.player.hp = 1;
  g.player.alive = false;
  for (let i = 0; i < 10; i++) g.update(DT, IDLE);
  assert.equal(count, 1);
});

test('distance advances with forward travel and never rewinds', () => {
  const g = makeGame();
  const p = g.player;
  for (let i = 0; i < 240; i++) g.update(DT, { axis: 1, jumpHeld: false, jumpPressed: false });
  const d1 = g.distance;
  assert.ok(d1 > 5, `only reached ${d1} m`);
  for (let i = 0; i < 120; i++) g.update(DT, { axis: -1, jumpHeld: false, jumpPressed: false });
  assert.ok(g.distance >= d1, 'distance went backwards');
});

test('spawned entities are shifted into world space (regression: orbs pooled at origin)', () => {
  const g = makeGame();
  g.reset();
  for (const o of g.orbs) {
    const chunk = Math.floor(o.x / (24 * TILE));
    assert.ok(o.x >= chunk * 24 * TILE - 1, `orb at ${o.x} is outside its chunk ${chunk}`);
  }
  for (const e of g.enemies) {
    assert.ok(e.x > 0, 'enemy spawned at the origin');
  }
});

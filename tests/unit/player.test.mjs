import test from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../../src/player.js';
import { PHYS, TILE } from '../../src/config.js';
import { IDLE, flatWorld, stepPlayer, spawnPlayer } from './helpers.mjs';

const DT = 1 / 120;

test('standing jump apex clears 144 px (AC-F1-01)', () => {
  const top = 12;
  const world = flatWorld({ top });
  const p = spawnPlayer(5, top);
  stepPlayer(p, world, IDLE, 0.2);
  const y0 = p.y;

  let apex = p.y;
  p.update(DT, { axis: 0, jumpHeld: true, jumpPressed: true }, world);
  for (let i = 0; i < 240; i++) {
    p.update(DT, { axis: 0, jumpHeld: true, jumpPressed: false }, world);
    apex = Math.min(apex, p.y);
  }
  const height = y0 - apex;
  assert.ok(height >= 144, `apex was ${height.toFixed(1)} px, need >= 144`);
  assert.ok(height < 170, `apex was ${height.toFixed(1)} px, unexpectedly high`);
});

test('running jump lands on a 3-tile roof (AC-F1-01)', () => {
  const top = 12;
  // platform top at row 9 (96 px above street), columns 10..14
  const world = flatWorld({ top, extras: [{ x0: 10, x1: 14, y0: 9, y1: 11 }] });
  const p = spawnPlayer(4, top);
  p.vx = 0;

  // Jump just before the wall: the runner slides up the face and drifts
  // onto the roof, the way a real runner clears a 3-tile block.
  const jumpAt = 10 * TILE - p.w - 24;
  let jumped = false;
  for (let i = 0; i < 600; i++) {
    const wantJump = !jumped && p.x >= jumpAt;
    p.update(DT, { axis: 1, jumpHeld: true, jumpPressed: wantJump }, world);
    if (wantJump) jumped = true;
    if (p.onGround && Math.abs(p.y + p.h - 9 * TILE) < 0.02 && p.x > 10 * TILE) break;
  }

  assert.ok(jumped, 'never reached the jump point');
  assert.ok(p.onGround, 'player never landed');
  assert.ok(Math.abs(p.y + p.h - 9 * TILE) < 0.02, `landed at ${p.y + p.h}, expected ${9 * TILE}`);
  assert.ok(p.x > 9 * TILE, 'landed short of the roof');
});

test('coyote time: jumping 80 ms after leaving the ledge still works (AC-F1-02)', () => {
  const top = 12;
  const world = flatWorld({ top, pitAfter: 12 });
  const p = spawnPlayer(11, top);
  p.vx = PHYS.maxSpeed;

  // run off the edge
  let leftAt = -1;
  for (let i = 0; i < 600; i++) {
    p.update(DT, { axis: 1, jumpHeld: false, jumpPressed: false }, world);
    if (!p.onGround && leftAt < 0) leftAt = i;
    if (leftAt >= 0 && (i - leftAt) * DT >= 0.08) break;
  }
  assert.ok(leftAt >= 0, 'player never left the ledge');

  p.update(DT, { axis: 1, jumpHeld: true, jumpPressed: true }, world);
  assert.ok(p.vy < 0, 'coyote jump did not fire');
});

test('coyote time expires after 100 ms (AC-F1-02 boundary)', () => {
  const top = 12;
  const world = flatWorld({ top, pitAfter: 12 });
  const p = spawnPlayer(11, top);
  p.vx = PHYS.maxSpeed;

  let leftAt = -1;
  for (let i = 0; i < 600; i++) {
    p.update(DT, { axis: 1, jumpHeld: false, jumpPressed: false }, world);
    if (!p.onGround && leftAt < 0) leftAt = i;
    if (leftAt >= 0 && (i - leftAt) * DT >= 0.16) break;
  }
  p.update(DT, { axis: 1, jumpHeld: true, jumpPressed: true }, world);
  assert.ok(p.vy >= 0, 'coyote jump fired after it should have expired');
});

test('jump buffer: pressed 100 ms before landing, jumps on touchdown (AC-F1-03)', () => {
  const top = 12;
  const world = flatWorld({ top });
  const p = new Player(5 * TILE, (top - 6) * TILE, 3); // fall from 6 tiles up
  let pressed = false;

  for (let i = 0; i < 600; i++) {
    const feet = p.y + p.h;
    const ground = top * TILE;
    const timeToLand = p.vy > 0 ? (ground - feet) / p.vy : Infinity;
    const wantJump = !pressed && timeToLand <= 0.1 && timeToLand > 0;
    if (wantJump) pressed = true;
    p.update(DT, { axis: 0, jumpHeld: true, jumpPressed: wantJump }, world);
    if (pressed && p.vy < 0) break;
  }
  assert.ok(pressed, 'never got close enough to the ground');
  assert.ok(p.vy < 0, 'buffered jump did not fire on landing');
});

test('releasing jump mid-rise cuts the apex by at least 30% (AC-F1-04)', () => {
  const top = 12;
  const world = flatWorld({ top });

  const held = spawnPlayer(5, top);
  stepPlayer(held, world, IDLE, 0.2);
  const y0 = held.y;
  let apexHeld = y0;
  held.update(DT, { axis: 0, jumpHeld: true, jumpPressed: true }, world);
  for (let i = 0; i < 200; i++) {
    held.update(DT, { axis: 0, jumpHeld: true, jumpPressed: false }, world);
    apexHeld = Math.min(apexHeld, held.y);
  }

  const cut = spawnPlayer(5, top);
  stepPlayer(cut, world, IDLE, 0.2);
  let apexCut = cut.y;
  cut.update(DT, { axis: 0, jumpHeld: true, jumpPressed: true }, world);
  for (let i = 0; i < 200; i++) {
    cut.update(DT, { axis: 0, jumpHeld: false, jumpPressed: false }, world);
    apexCut = Math.min(apexCut, cut.y);
  }

  const heldH = y0 - apexHeld;
  const cutH = y0 - apexCut;
  assert.ok(cutH <= heldH * 0.7, `cut height ${cutH.toFixed(1)} vs held ${heldH.toFixed(1)}`);
});

test('air control cannot exceed the horizontal speed cap', () => {
  const world = flatWorld({ top: 12 });
  const p = spawnPlayer(5, 12);
  for (let i = 0; i < 600; i++) p.update(DT, { axis: 1, jumpHeld: false, jumpPressed: false }, world);
  assert.ok(Math.abs(p.vx) <= PHYS.maxSpeed + 1e-6, `vx=${p.vx}`);
});

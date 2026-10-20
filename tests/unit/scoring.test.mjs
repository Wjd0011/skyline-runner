import test from 'node:test';
import assert from 'node:assert/strict';
import { orbGain, stompGain, ORB_BASE, STOMP_BASE, COMBO_CAP, COMBO_WINDOW } from '../../src/scoring.js';

test('three consecutive orbs on normal score 10+20+30 = 60 (AC-F5-01)', () => {
  let total = 0;
  for (let combo = 1; combo <= 3; combo++) total += orbGain(combo, 1);
  assert.equal(total, 60);
});

test('orb value rises with the chain and stops at the cap', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((c) => orbGain(c, 1)), [10, 20, 30, 40, 50]);
  assert.equal(orbGain(9, 1), ORB_BASE * COMBO_CAP);
  assert.equal(orbGain(0, 1), ORB_BASE);
});

test('difficulty multipliers scale both pickups and stomps', () => {
  assert.equal(orbGain(1, 0.8), 8);
  assert.equal(orbGain(1, 1.3), 13);
  assert.equal(stompGain(1), 50);
  assert.equal(stompGain(0.8), 40);
  assert.equal(stompGain(1.3), 65);
  assert.equal(STOMP_BASE, 50);
});

test('the combo window is the documented 2.4 s (AC-F5-02)', () => {
  assert.equal(COMBO_WINDOW, 2.4);
});

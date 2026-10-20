import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedStep, STEP } from '../../src/loop.js';

test('a jump pressed during a zero-step frame is not dropped (144 Hz bug)', () => {
  const loop = new FixedStep();
  loop.pressJump();
  // 5 ms at 120 Hz is less than one step: nothing runs
  assert.equal(loop.advance(0.005, () => {}), 0);
  assert.equal(loop.pendingJump, true, 'press was discarded by a zero-step frame');

  const seen = [];
  loop.advance(0.005, (step, jumpPressed) => seen.push(jumpPressed));
  assert.deepEqual(seen, [true], 'latch never reached the simulation');
  assert.equal(loop.pendingJump, false);
});

test('the press is consumed exactly once', () => {
  const loop = new FixedStep();
  loop.pressJump();
  const seen = [];
  loop.advance(1 / 30, (step, jumpPressed) => seen.push(jumpPressed));
  assert.deepEqual(seen, [true, false, false, false]);
});

test('60 Hz and 144 Hz produce the same jump timing within one step (AC-F1-05)', () => {
  function run(hz) {
    const loop = new FixedStep();
    const frame = 1 / hz;
    let simTime = 0;
    let jumpAt = null;
    let steps = 0;

    for (let i = 0; i < Math.round(3 * hz); i++) {
      if (i === Math.round(0.5 * hz)) loop.pressJump();
      steps += loop.advance(frame, (step, jumpPressed) => {
        if (jumpPressed) jumpAt = simTime;
        simTime += step;
      });
    }
    return { jumpAt, simTime, steps };
  }

  const a = run(60);
  const b = run(144);
  assert.ok(a.jumpAt !== null && b.jumpAt !== null);
  assert.ok(Math.abs(a.jumpAt - b.jumpAt) <= STEP + 1e-9, `jump times differ: ${a.jumpAt} vs ${b.jumpAt}`);
  // 0.5 s of simulation at 120 Hz = 60 steps; frame quantisation costs at most one
  assert.ok(Math.abs(a.steps - b.steps) <= 1, `step counts drift: ${a.steps} vs ${b.steps}`);
});

test('a long stall cannot spiral the simulation', () => {
  const loop = new FixedStep(STEP, 8);
  const steps = loop.advance(5, () => {});
  assert.equal(steps, 8);
  assert.ok(loop.acc < STEP, 'accumulator kept the backlog');
});

// Fixed-step scheduler.
//
// The simulation always advances in whole 1/120 s steps, no matter the
// display refresh rate. A jump press is latched until a step actually
// consumes it: at 144 Hz many animation frames run zero simulation steps,
// and dropping the press there is exactly how high-refresh players lose
// jumps. Keeping the latch makes 60 Hz and 144 Hz behave the same.

export const STEP = 1 / 120;

export class FixedStep {
  constructor(step = STEP, maxSteps = 8) {
    this.step = step;
    this.maxSteps = maxSteps;
    this.acc = 0;
    this.pendingJump = false;
  }

  pressJump() {
    this.pendingJump = true;
  }

  /** Discard accumulated time and any unconsumed press (pause, blur, menu). */
  clear() {
    this.acc = 0;
    this.pendingJump = false;
  }

  /**
   * Advance by `dt` seconds, calling `update(step, jumpPressed)` for each
   * fixed step that fits. Returns how many steps ran.
   */
  advance(dt, update) {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= this.step && steps < this.maxSteps) {
      const jumpPressed = this.pendingJump;
      this.pendingJump = false;
      update(this.step, jumpPressed);
      this.acc -= this.step;
      steps += 1;
    }
    if (steps === this.maxSteps) this.acc = 0;
    return steps;
  }
}

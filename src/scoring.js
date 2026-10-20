// Scoring rules live here so they can be tested without a DOM.
// The multipliers and windows are product rules (PRD F5 / appendix A),
// not physics tuning — changing them changes the score players see.

export const ORB_BASE = 10;
export const STOMP_BASE = 50;
export const COMBO_CAP = 5;
export const COMBO_WINDOW = 2.4; // seconds without a pickup before the chain resets

/** Points for the Nth consecutive orb, N starting at 1. */
export function orbGain(combo, difficultyMul = 1) {
  const step = Math.min(Math.max(combo | 0, 1), COMBO_CAP);
  return Math.round(ORB_BASE * step * difficultyMul);
}

/** Points for stomping an enemy. */
export function stompGain(difficultyMul = 1) {
  return Math.round(STOMP_BASE * difficultyMul);
}

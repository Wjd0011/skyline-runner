export const TILE = 32;
export const VERSION = '2.0.0';
export const CHUNK_W = 24;
export const CHUNK_H = 22;
export const WORLD_H = CHUNK_H * TILE;

export const PHYS = {
  gravity: 2650,
  jumpV: 905,
  maxFall: 1250,
  moveAcc: 3000,
  airAcc: 2000,
  maxSpeed: 430,
  friction: 2600,
  airDrag: 260,
  coyote: 0.1,
  buffer: 0.12,
  jumpCut: 2.2,
  w: 26,
  h: 40,
};

export const C = {
  bgTop: '#04060E',
  bgMid: '#080C1A',
  bgBot: '#170C2A',
  cyan: '#22D3EE',
  cyanSoft: '#8FE3FF',
  blue: '#38BDF8',
  violet: '#A78BFA',
  magenta: '#F472B6',
  amber: '#FBBF24',
  green: '#34D399',
  ink: '#E6EDF3',
  muted: '#7C8CA3',
  dim: '#46566D',
  building: '#0A0F1E',
  buildingDark: '#070B15',
  edge: '#1B2740',
  ground: '#060A12',
};

export const UI = {
  maxHp: 3,
};

// Difficulty presets.
// walker / flyer: [chance at ramp start, chance at ramp end]
// speed: [enemy speed multiplier at start, at the end]
// ramp: [start metres, end metres] — spawn pressure grows along the run
export const DIFFICULTIES = {
  easy: {
    id: 'easy',
    hp: 4,
    walker: [0.08, 0.40],
    flyer: [0.08, 0.48],
    speed: [0.82, 0.98],
    ramp: [90, 720],
    scoreMul: 0.8,
  },
  normal: {
    id: 'normal',
    hp: 3,
    walker: [0.16, 0.60],
    flyer: [0.16, 0.78],
    speed: [0.95, 1.10],
    ramp: [70, 600],
    scoreMul: 1,
  },
  hard: {
    id: 'hard',
    hp: 2,
    walker: [0.26, 0.78],
    flyer: [0.26, 0.95],
    speed: [1.06, 1.26],
    ramp: [40, 500],
    scoreMul: 1.3,
  },
};

export const DEFAULT_DIFFICULTY = 'normal';

export const SEED_GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

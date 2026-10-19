export const TILE = 32;
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

export const SEED_GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

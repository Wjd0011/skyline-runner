import { TILE, PHYS, UI } from './config.js';
import { clamp } from './rng.js';

export class Player {
  constructor(x, y, hp = UI.maxHp) {
    this.x = x;
    this.y = y;
    this.w = PHYS.w;
    this.h = PHYS.h;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.facing = 1;
    this.maxHp = hp;
    this.hp = hp;
    this.iframes = 0;
    this.alive = true;
    this.animT = 0;
    this.runPhase = 0;
    this.events = { jump: false, land: false };
  }

  collides(world, x = this.x, y = this.y) {
    const x0 = Math.floor(x / TILE);
    const x1 = Math.floor((x + this.w - 0.001) / TILE);
    const y0 = Math.floor(y / TILE);
    const y1 = Math.floor((y + this.h - 0.001) / TILE);
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        if (world.solid(gx, gy)) return true;
      }
    }
    return false;
  }

  hazardOverlap(world) {
    const x0 = Math.floor(this.x / TILE);
    const x1 = Math.floor((this.x + this.w - 0.001) / TILE);
    const y0 = Math.floor(this.y / TILE);
    const y1 = Math.floor((this.y + this.h - 0.001) / TILE);
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        if (world.hazard(gx, gy)) return true;
      }
    }
    return false;
  }

  hurt(direction) {
    if (this.iframes > 0 || !this.alive) return false;
    this.hp -= 1;
    this.iframes = 1.15;
    this.vx = -direction * 260;
    this.vy = -330;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
    return true;
  }

  update(dt, input, world) {
    this.events.jump = false;
    this.events.land = false;
    const wasGround = this.onGround;

    const axis = input.axis;
    if (axis !== 0 && this.alive) {
      const acc = this.onGround ? PHYS.moveAcc : PHYS.airAcc;
      this.vx += axis * acc * dt;
      this.facing = axis > 0 ? 1 : -1;
    } else if (this.onGround) {
      const f = PHYS.friction * dt;
      if (Math.abs(this.vx) <= f) this.vx = 0;
      else this.vx -= Math.sign(this.vx) * f;
    } else {
      const f = PHYS.airDrag * dt;
      if (Math.abs(this.vx) > f) this.vx -= Math.sign(this.vx) * f;
      else this.vx = 0;
    }
    this.vx = clamp(this.vx, -PHYS.maxSpeed, PHYS.maxSpeed);

    this.coyote = this.onGround ? PHYS.coyote : Math.max(0, this.coyote - dt);
    this.jumpBuf = input.jumpPressed ? PHYS.buffer : Math.max(0, this.jumpBuf - dt);

    if (this.jumpBuf > 0 && this.coyote > 0 && this.alive) {
      this.vy = -PHYS.jumpV;
      this.jumpBuf = 0;
      this.coyote = 0;
      this.onGround = false;
      this.events.jump = true;
    }

    const cut = this.vy < 0 && !input.jumpHeld ? PHYS.jumpCut : 1;
    this.vy += PHYS.gravity * cut * dt;
    this.vy = Math.min(this.vy, PHYS.maxFall);

    // horizontal move + resolve
    const nx = this.x + this.vx * dt;
    if (!this.collides(world, nx, this.y)) {
      this.x = nx;
    } else {
      if (this.vx > 0) this.x = Math.floor((nx + this.w) / TILE) * TILE - this.w - 0.01;
      else this.x = Math.floor(nx / TILE) * TILE + TILE + 0.01;
      this.vx = 0;
    }

    // vertical move + resolve
    const ny = this.y + this.vy * dt;
    this.onGround = false;
    if (!this.collides(world, this.x, ny)) {
      this.y = ny;
    } else {
      if (this.vy > 0) {
        this.y = Math.floor((ny + this.h) / TILE) * TILE - this.h - 0.01;
        this.onGround = true;
      } else {
        this.y = Math.floor(ny / TILE) * TILE + TILE + 0.01;
      }
      this.vy = 0;
    }

    if (!wasGround && this.onGround) this.events.land = true;

    this.iframes = Math.max(0, this.iframes - dt);
    this.animT += dt;
    if (this.onGround && Math.abs(this.vx) > 20) this.runPhase += dt * Math.abs(this.vx) * 0.045;
    else this.runPhase *= 0.9;
  }
}

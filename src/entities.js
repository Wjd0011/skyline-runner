import { TILE } from './config.js';

export class Walker {
  constructor(spec) {
    this.chunkIndex = spec.chunkIndex;
    this.type = 'walker';
    this.w = 30;
    this.h = 26;
    this.x = spec.x;
    this.y = spec.y; // feet
    this.minX = spec.minX;
    this.maxX = spec.maxX;
    this.dir = -1;
    this.speedMul = spec.speedMul || 1;
    this.speed = 54 * this.speedMul;
    this.chaseSpeed = 112 * this.speedMul;
    this.t = Math.random() * 6;
    this.chasing = false;
    this.alive = true;
    this.deadT = 0;
  }

  get bounds() {
    return { x: this.x - this.w / 2, y: this.y - this.h, w: this.w, h: this.h };
  }

  update(dt, game) {
    if (!this.alive) {
      this.deadT += dt;
      return;
    }
    this.t += dt;
    const p = game.player;
    const pcx = p.x + p.w / 2;
    const dx = pcx - this.x;
    const dy = Math.abs(p.y + p.h - this.y);

    this.chasing = p.alive && Math.abs(dx) < 300 && dy < 78;

    if (this.chasing) {
      this.dir = dx < 0 ? -1 : 1;
      this.x += this.dir * this.chaseSpeed * dt;
    } else {
      this.x += this.dir * this.speed * dt;
    }

    if (this.x < this.minX) {
      this.x = this.minX;
      this.dir = 1;
    } else if (this.x > this.maxX) {
      this.x = this.maxX;
      this.dir = -1;
    }

    // never walk off the ledge
    const probeX = this.x + this.dir * (this.w / 2 + 3);
    const footTileX = Math.floor(probeX / TILE);
    const footTileY = Math.floor((this.y + 3) / TILE);
    if (!game.world.solid(footTileX, footTileY)) {
      this.dir *= -1;
      this.x += this.dir * 6;
    }
  }
}

export class Flyer {
  constructor(spec) {
    this.chunkIndex = spec.chunkIndex;
    this.type = 'flyer';
    this.w = 32;
    this.h = 20;
    this.baseX = spec.x;
    this.baseY = spec.y;
    this.x = spec.x;
    this.y = spec.y;
    this.amp = spec.amp || 40;
    this.speed = spec.speed || 1;
    this.t = Math.random() * 8;
    this.speedMul = spec.speedMul || 1;
    this.alive = true;
    this.deadT = 0;
    this.attack = 0;
  }

  get bounds() {
    return { x: this.x - this.w / 2, y: this.y - this.h / 2, w: this.w, h: this.h };
  }

  update(dt, game) {
    if (!this.alive) {
      this.deadT += dt;
      return;
    }
    this.t += dt;
    const p = game.player;
    const pcx = p.x + p.w / 2;
    const pcy = p.y + p.h / 2;
    const dist = Math.hypot(pcx - this.x, pcy - this.y);
    const wantsAttack = p.alive && dist < 300;

    this.attack += ((wantsAttack ? 1 : 0) - this.attack) * Math.min(1, dt * 3);

    const idleX = this.baseX + Math.sin(this.t * 0.7) * 46;
    const idleY = this.baseY + Math.sin(this.t * this.speed * 1.9) * this.amp;

    if (this.attack > 0.02) {
      const k = Math.min(1, dt * 1.9 * this.attack * this.speedMul);
      this.x += (pcx - this.x) * k;
      this.y += (pcy - 10 - this.y) * k;
    } else {
      const k = Math.min(1, dt * 1.6);
      this.x += (idleX - this.x) * k;
      this.y += (idleY - this.y) * k;
    }
  }
}

export class Orb {
  constructor(spec) {
    this.chunkIndex = spec.chunkIndex;
    this.type = 'orb';
    this.x = spec.x;
    this.y = spec.y;
    this.t = Math.random() * Math.PI * 2;
    this.r = 9;
    this.alive = true;
  }
}

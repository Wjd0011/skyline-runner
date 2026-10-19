import { TILE, PHYS, UI, WORLD_H } from './config.js';
import { clamp } from './rng.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Walker, Flyer, Orb } from './entities.js';

export class Game {
  constructor(renderer, audio, seedInt, seedLabel) {
    this.renderer = renderer;
    this.audio = audio;
    this.seedInt = seedInt >>> 0;
    this.seedLabel = seedLabel;
    this.onOver = null;
    this.reset();
  }

  reset() {
    this.world = new World(this.seedInt);
    this.world.ensure(0);
    const c0 = this.world.chunks.get(0);
    const gy = c0 ? c0.groundY : 15;
    this.startX = 3 * TILE;
    this.player = new Player(this.startX, gy * TILE - PHYS.h - 2);
    this.enemies = [];
    this.orbs = [];
    this.particles = [];
    this.cam = { x: 0, y: 0 };
    this.time = 0;
    this.shake = 0;
    this.score = 0;
    this.distance = 0;
    this.combo = 0;
    this.comboT = 0;
    this.state = 'title';
    this.spawnChunkEntities(c0);
    this.syncCamera(true);
  }

  spawnChunkEntities(chunk) {
    if (!chunk) return;
    for (const s of chunk.spawns) {
      const spec = { ...s, chunkIndex: chunk.index };
      if (s.type === 'walker') this.enemies.push(new Walker(spec));
      else if (s.type === 'flyer') this.enemies.push(new Flyer(spec));
      else if (s.type === 'orb') this.orbs.push(new Orb(spec));
    }
  }

  syncCamera(snap = false) {
    const viewW = this.renderer.viewW;
    const viewH = this.renderer.viewH;
    const tx = this.player.x + this.player.w / 2 - viewW * 0.38;
    const ty = this.player.y + this.player.h / 2 - viewH * 0.60;
    if (snap) {
      this.cam.x = tx;
      this.cam.y = clamp(ty, -2, Math.max(-2, WORLD_H - viewH));
    }
  }

  update(dt, input) {
    if (this.state !== 'playing') return;
    this.time += dt;
    const p = this.player;

    p.update(dt, input, this.world);
    if (p.events.jump) this.audio.jump();
    if (p.events.land) {
      this.audio.land();
      this.dust(p.x + p.w / 2, p.y + p.h, 6);
    }

    // world streaming
    this.world.ensure(p.x);
    for (const c of this.world.newChunks) this.spawnChunkEntities(c);
    this.world.newChunks.length = 0;
    if (this.world.removedChunks.length) {
      const gone = new Set(this.world.removedChunks.map((c) => c.index));
      this.enemies = this.enemies.filter((e) => !gone.has(e.chunkIndex));
      this.orbs = this.orbs.filter((o) => !gone.has(o.chunkIndex));
      this.world.removedChunks.length = 0;
    }

    for (const e of this.enemies) e.update(dt, this);

    this.updateOrbs(dt);
    this.updateEnemiesCollision();
    this.updateHazards();
    this.updateParticles(dt);
    this.updateCamera(dt);

    this.distance = Math.max(this.distance, Math.floor((p.x - this.startX) / 16));
    this.comboT = Math.max(0, this.comboT - dt);
    if (this.comboT === 0) this.combo = 0;
    this.shake = Math.max(0, this.shake - dt * 2.4);

    if (!p.alive && this.state === 'playing') this.finish();

    this.enemies = this.enemies.filter((e) => e.alive || e.deadT < 0.45);
    this.orbs = this.orbs.filter((o) => o.alive);
  }

  updateOrbs(dt) {
    const p = this.player;
    const px = p.x + p.w / 2;
    const py = p.y + p.h / 2;
    for (const o of this.orbs) {
      if (!o.alive) continue;
      o.t += dt;
      const dx = px - o.x;
      const dy = py - o.y;
      if (dx * dx + dy * dy < 30 * 30) {
        o.alive = false;
        this.combo += 1;
        this.comboT = 2.4;
        const gain = 10 * Math.min(this.combo, 5);
        this.score += gain;
        this.burst(o.x, o.y, 12, 'rgba(143,227,255,0.95)', 180);
        this.audio.pickup();
        this.shake = Math.max(this.shake, 0.18);
      }
    }
  }

  updateEnemiesCollision() {
    const p = this.player;
    if (!p.alive) return;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const b = e.bounds;
      if (!aabb(p.x, p.y, p.w, p.h, b.x, b.y, b.w, b.h)) continue;

      const stomping = p.vy > 100 && p.y + p.h < b.y + b.h * 0.7;
      if (stomping) {
        e.alive = false;
        e.deadT = 0;
        p.vy = -640;
        this.score += 50;
        this.combo += 1;
        this.comboT = 2.4;
        this.burst(b.x + b.w / 2, b.y + b.h / 2, 20, 'rgba(244,114,182,0.95)', 260);
        this.audio.stomp();
        this.shake = Math.max(this.shake, 0.55);
      } else {
        const dir = (p.x + p.w / 2) < (b.x + b.w / 2) ? 1 : -1;
        if (p.hurt(dir)) {
          this.burst(p.x + p.w / 2, p.y + p.h / 2, 18, 'rgba(244,114,182,0.9)', 230);
          this.audio.hurt();
          this.shake = Math.max(this.shake, 0.8);
        }
      }
    }
  }

  updateHazards() {
    const p = this.player;
    if (!p.alive) return;
    if (p.iframes > 0) return;
    if (p.hazardOverlap(this.world)) {
      if (p.hurt(p.facing)) {
        this.burst(p.x + p.w / 2, p.y + p.h, 16, 'rgba(244,114,182,0.9)', 220);
        this.audio.hurt();
        this.shake = Math.max(this.shake, 0.8);
      }
    }
  }

  updateParticles(dt) {
    for (const pt of this.particles) {
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.96;
      pt.vy = pt.vy * 0.96 + 220 * dt;
    }
    this.particles = this.particles.filter((pt) => pt.life > 0);
  }

  updateCamera(dt) {
    const p = this.player;
    const targetX = p.x + p.w / 2 - this.renderer.viewW * 0.38;
    const targetY = p.y + p.h / 2 - this.renderer.viewH * 0.60;
    const kx = 1 - Math.exp(-7 * dt);
    const ky = 1 - Math.exp(-4.5 * dt);
    this.cam.x += (targetX - this.cam.x) * kx;
    this.cam.y += (targetY - this.cam.y) * ky;
    const maxY = Math.max(-2, WORLD_H - this.renderer.viewH);
    this.cam.y = clamp(this.cam.y, -2, maxY);
    this.cam.x = Math.max(-30, this.cam.x);
  }

  burst(x, y, n, color, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.25 + Math.random() * 0.75);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40,
        life: 0.35 + Math.random() * 0.5,
        maxLife: 0.85,
        size: 1.4 + Math.random() * 2.4,
        color,
      });
    }
  }

  dust(x, y, n) {
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 18,
        y: y - 2,
        vx: (Math.random() - 0.5) * 90,
        vy: -30 - Math.random() * 60,
        life: 0.25 + Math.random() * 0.25,
        maxLife: 0.5,
        size: 1.2 + Math.random() * 1.8,
        color: 'rgba(143,227,255,0.55)',
      });
    }
  }

  start() {
    this.state = 'playing';
    this.syncCamera(true);
  }

  pause() {
    if (this.state === 'playing') this.state = 'paused';
  }

  resume() {
    if (this.state === 'paused') this.state = 'playing';
  }

  finish() {
    this.state = 'over';
    this.audio.over();
    this.shake = 1.2;
    this.burst(this.player.x + this.player.w / 2, this.player.y + this.player.h / 2, 40, 'rgba(244,114,182,0.95)', 320);
    if (this.onOver) this.onOver(this.score, this.distance);
  }
}

function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

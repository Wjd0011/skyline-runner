import { TILE, CHUNK_W, CHUNK_H, WORLD_H, C } from './config.js';
import { hash2, clamp } from './rng.js';

const CHUNK_PX = CHUNK_W * TILE;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.scale = 1;
    this.stars = [];
    this.rain = [];
    // Gradients are immutable per size/ground level; building them once keeps
    // thousands of per-frame allocations out of the draw loop.
    this._grads = { sky: null, skyGlow: null, haze: null, sun: null, street: new Map(), glow: new Map() };
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', (e) => {
      this.reducedMotion = e.matches;
    });
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.seedStars();
  }

  resize() {
    // Low-power / touch devices cap at 1.5 so the fill rate stays inside
    // the 55 fps mobile budget (PRD risk R3).
    const coarse = matchMedia('(pointer: coarse)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
    this.dpr = dpr;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * dpr);
    this.canvas.height = Math.floor(this.h * dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.scale = clamp(Math.min(this.w / 1000, this.h / 820), 0.55, 1.5);
    this._grads = { sky: null, skyGlow: null, haze: null, sun: null, street: new Map(), glow: new Map() };
  }

  seedStars() {
    this.stars = [];
    for (let i = 0; i < 130; i++) {
      this.stars.push({
        x: Math.random(),
        y: Math.random() * 0.55,
        r: Math.random() * 1.3 + 0.3,
        a: Math.random() * 0.5 + 0.15,
        tw: Math.random() * 6.28,
      });
    }
    this.rain = [];
    for (let i = 0; i < 70; i++) {
      this.rain.push({ x: Math.random(), y: Math.random(), len: 10 + Math.random() * 22, sp: 0.35 + Math.random() * 0.9, a: 0.05 + Math.random() * 0.12 });
    }
  }

  get viewW() { return this.w / this.scale; }
  get viewH() { return this.h / this.scale; }

  draw(game) {
    const t0 = performance.now();
    const ctx = this.ctx;
    const { cam } = game;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // No clearRect: the sky gradient repaints every pixel (alpha:false).

    this.drawSky(ctx, cam);
    this.drawStars(ctx, cam);
    this.drawSun(ctx, cam);
    this.drawSkyline(ctx, cam, 0.10, this.h * 0.72, '#070B16', 0.0, 26, 150, 58, 0.55);
    this.drawSkyline(ctx, cam, 0.24, this.h * 0.80, '#0A1020', 1.7, 40, 190, 74, 0.4);
    this.drawHaze(ctx);
    if (!this.reducedMotion) this.drawRain(ctx, game.time);

    // ---- world space ----
    // prefers-reduced-motion: no camera shake, no particle burst.
    const shake = this.reducedMotion ? 0 : game.shake || 0;
    const sx = shake > 0 ? (Math.random() - 0.5) * shake * 18 : 0;
    const sy = shake > 0 ? (Math.random() - 0.5) * shake * 18 : 0;

    ctx.save();
    ctx.scale(this.scale, this.scale);
    ctx.translate(-cam.x + sx, -cam.y + sy);

    this.drawWorld(ctx, game);
    this.drawOrbs(ctx, game);
    this.drawEnemies(ctx, game);
    this.drawPlayer(ctx, game);
    if (!this.reducedMotion) this.drawParticles(ctx, game);

    ctx.restore();

    this.drawForeground(ctx, cam);
    this.drawVignette(ctx);
    this.drawDamage(ctx, game);
    this.lastDrawMs = performance.now() - t0;
  }

  // ---------------------------------------------------------------- sky

  drawSky(ctx, cam) {
    if (!this._grads.sky) {
      const g = ctx.createLinearGradient(0, 0, 0, this.h);
      g.addColorStop(0, C.bgTop);
      g.addColorStop(0.55, C.bgMid);
      g.addColorStop(1, C.bgBot);
      this._grads.sky = g;

      const hg = ctx.createRadialGradient(this.w * 0.68, this.h * 0.38, 10, this.w * 0.68, this.h * 0.38, this.h * 1.1);
      hg.addColorStop(0, 'rgba(167,139,250,0.16)');
      hg.addColorStop(0.4, 'rgba(56,189,248,0.05)');
      hg.addColorStop(1, 'rgba(0,0,0,0)');
      this._grads.skyGlow = hg;
    }
    ctx.fillStyle = this._grads.sky;
    ctx.fillRect(0, 0, this.w, this.h);

    // horizon glow
    ctx.fillStyle = this._grads.skyGlow;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  drawStars(ctx, cam) {
    const t = performance.now() * 0.001;
    for (const s of this.stars) {
      const x = ((s.x * this.w - cam.x * 0.02) % this.w + this.w) % this.w;
      const y = s.y * this.h;
      const a = s.a * (0.6 + 0.4 * Math.sin(t * 1.4 + s.tw));
      ctx.fillStyle = `rgba(200,230,255,${a})`;
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, 6.2832);
      ctx.fill();
    }
  }

  drawSun(ctx, cam) {
    const cx = this.w * 0.7 - cam.x * 0.03;
    const cy = this.h * 0.34;
    const r = Math.min(this.w, this.h) * 0.15;
    if (!this._grads.sun) {
      const g = ctx.createLinearGradient(0, cy - r, 0, cy + r);
      g.addColorStop(0, 'rgba(255,180,120,0.95)');
      g.addColorStop(0.5, 'rgba(244,114,182,0.85)');
      g.addColorStop(1, 'rgba(139,92,246,0.55)');
      this._grads.sun = g;
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 6.2832);
    ctx.fillStyle = this._grads.sun;
    ctx.shadowColor = 'rgba(244,114,182,0.55)';
    ctx.shadowBlur = 70;
    ctx.fill();
    ctx.restore();

    // scanline cuts
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 6.2832);
    ctx.clip();
    for (let i = 0; i < 9; i++) {
      const yy = cy + r * 0.08 + i * (r * 0.11);
      ctx.fillStyle = i % 2 ? 'rgba(8,12,26,0.55)' : 'rgba(8,12,26,0.28)';
      ctx.fillRect(cx - r, yy, r * 2, r * 0.045);
    }
    ctx.restore();
  }

  drawSkyline(ctx, cam, factor, baseY, color, seedOff, minH, maxH, step, winAlpha) {
    const off = cam.x * factor;
    const start = Math.floor((off - step) / step) * step;
    const end = off + this.w + step;
    ctx.fillStyle = color;
    for (let wx = start; wx < end; wx += step) {
      const idx = Math.floor(wx / step);
      const h = minH + hash2(idx, 3, seedOff) * (maxH - minH);
      const w = step * (0.62 + hash2(idx, 9, seedOff) * 0.3);
      const x = wx - off;
      ctx.fillRect(x, baseY - h, w, h + 4);

      if (winAlpha > 0.05) {
        const cols = Math.max(1, Math.floor(w / 9));
        const rows = Math.floor(h / 12);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (hash2(idx * 31 + c, r + 7, seedOff) > 0.62) {
              ctx.fillStyle = `rgba(140,220,255,${winAlpha * 0.5})`;
              ctx.fillRect(x + 4 + c * 9, baseY - h + 6 + r * 12, 3, 4);
              ctx.fillStyle = color;
            }
          }
        }
      }
    }
  }

  drawHaze(ctx) {
    if (!this._grads.haze) {
      const g = ctx.createLinearGradient(0, this.h * 0.55, 0, this.h);
      g.addColorStop(0, 'rgba(28,18,52,0)');
      g.addColorStop(1, 'rgba(60,24,90,0.30)');
      this._grads.haze = g;
    }
    ctx.fillStyle = this._grads.haze;
    ctx.fillRect(0, this.h * 0.55, this.w, this.h * 0.45);
  }

  drawRain(ctx, time) {
    ctx.save();
    ctx.strokeStyle = 'rgba(150,200,255,0.5)';
    ctx.lineWidth = 1;
    for (const d of this.rain) {
      const y = ((d.y + time * d.sp * 0.12) % 1) * this.h;
      const x = (d.x + Math.sin(time * 0.2 + d.y * 6) * 0.01) * this.w;
      ctx.globalAlpha = d.a;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 2, y + d.len);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- world

  drawWorld(ctx, game) {
    const cam = game.cam;
    const vw = this.viewW;
    const vh = this.viewH;

    for (const chunk of game.world.chunks.values()) {
      if (chunk.baseX + CHUNK_PX < cam.x - 80 || chunk.baseX > cam.x + vw + 80) continue;

      const gy = chunk.groundY;
      const groundTop = gy * TILE;

      // street band
      let bg = this._grads.street.get(gy);
      if (!bg) {
        bg = ctx.createLinearGradient(0, groundTop, 0, groundTop + 600);
        bg.addColorStop(0, '#0A101C');
        bg.addColorStop(1, '#05080F');
        this._grads.street.set(gy, bg);
      }
      ctx.fillStyle = bg;
      const bottom = Math.max(WORLD_H, cam.y + vh + 60);
      ctx.fillRect(chunk.baseX, groundTop, CHUNK_PX, bottom - groundTop);

      // street guide lines
      ctx.strokeStyle = 'rgba(34,211,238,0.10)';
      ctx.lineWidth = 1;
      for (let x = chunk.baseX; x < chunk.baseX + CHUNK_PX; x += TILE * 2) {
        ctx.beginPath();
        ctx.moveTo(x, groundTop + 6);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      }

      // street glow strip
      let sg = this._grads.glow.get(gy);
      if (!sg) {
        sg = ctx.createLinearGradient(0, groundTop, 0, groundTop + 120);
        sg.addColorStop(0, 'rgba(34,211,238,0.07)');
        sg.addColorStop(1, 'rgba(34,211,238,0)');
        this._grads.glow.set(gy, sg);
      }
      ctx.fillStyle = sg;
      ctx.fillRect(chunk.baseX, groundTop, CHUNK_PX, 120);

      // tiles above ground
      const tx0 = Math.max(0, Math.floor((cam.x - chunk.baseX) / TILE));
      const tx1 = Math.min(CHUNK_W - 1, Math.ceil((cam.x + vw - chunk.baseX) / TILE));
      const ty0 = Math.max(0, Math.floor(cam.y / TILE));
      const ty1 = Math.min(gy - 1, Math.ceil((cam.y + vh) / TILE));

      ctx.fillStyle = C.building;
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const tv = chunk.map[ty * CHUNK_W + tx];
          if (tv === 1 || tv === 4) {
            ctx.fillStyle = tv === 4 ? '#0B1A22' : C.building;
            ctx.fillRect(chunk.baseX + tx * TILE, ty * TILE, TILE, TILE);
            ctx.fillStyle = C.building;
          }
        }
      }

      this.drawBuildings(ctx, chunk, cam, vw, vh, groundTop);
      this.drawStreetEdge(ctx, chunk, groundTop);
      this.drawHazards(ctx, chunk, tx0, tx1, ty0, ty1);
      this.drawPads(ctx, chunk, tx0, tx1, ty0, ty1);
    }

    this.drawTraffic(ctx, game);
  }

  drawTraffic(ctx, game) {
    const cam = game.cam;
    const gy = game.world.groundAt(cam.x + this.viewW * 0.5);
    const y = gy + 46;
    const t = game.time;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      const speed = 90 + (i % 4) * 55;
      const dir = i % 2 === 0 ? 1 : -1;
      const span = this.viewW + 400;
      let x = ((t * speed * dir + i * 173) % span + span) % span - 200 + cam.x;
      const yy = y + (i % 3) * 13;
      const len = 46 + (i % 4) * 18;
      const col = i % 3 === 0 ? '251,191,36' : i % 3 === 1 ? '34,211,238' : '167,139,250';
      const g = ctx.createLinearGradient(x - len, yy, x + len, yy);
      g.addColorStop(0, `rgba(${col},0)`);
      g.addColorStop(0.5, `rgba(${col},0.55)`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - len, yy, len * 2, 2);
    }
    ctx.restore();
  }

  drawBuildings(ctx, chunk, cam, vw, vh, groundTop) {
    for (const b of chunk.decor) {
      const bx = chunk.baseX + b.x0 * TILE;
      const bw = b.w * TILE;
      const roof = b.top * TILE;
      if (bx + bw < cam.x - 40 || bx > cam.x + vw + 40) continue;

      if (b.ledge) {
        ctx.fillStyle = 'rgba(9,14,26,0.74)';
        ctx.fillRect(bx, roof, bw, TILE);
        ctx.strokeStyle = 'rgba(167,139,250,0.30)';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, roof + 0.5, bw - 1, TILE - 1);
        this.neonLine(ctx, bx + 2, roof + 0.5, bx + bw - 2, roof + 0.5, C.violet, 1.4, 0.85);
        ctx.strokeStyle = 'rgba(80,110,150,0.30)';
        ctx.beginPath();
        ctx.moveTo(bx + 5, roof + TILE); ctx.lineTo(bx + 13, roof + TILE + 18);
        ctx.moveTo(bx + bw - 5, roof + TILE); ctx.lineTo(bx + bw - 13, roof + TILE + 18);
        ctx.stroke();
        continue;
      }

      const heights = b.heights || new Array(b.w).fill(b.h);
      const steps = b.steps || 0;
      const seed = Math.floor(b.seed * 1000);
      const colTop = (c) => (b.top + (b.h - heights[c])) * TILE;

      // terraced silhouette
      ctx.strokeStyle = 'rgba(60,90,130,0.30)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx + 0.5, colTop(0));
      for (let c = 1; c < b.w; c++) {
        ctx.lineTo(bx + c * TILE + 0.5, colTop(c - 1));
        ctx.lineTo(bx + c * TILE + 0.5, colTop(c));
      }
      ctx.lineTo(bx + bw - 0.5, colTop(b.w - 1));
      ctx.lineTo(bx + bw - 0.5, groundTop);
      ctx.moveTo(bx + 0.5, colTop(0));
      ctx.lineTo(bx + 0.5, groundTop);
      ctx.stroke();

      // neon crown on every column, windows underneath
      for (let c = 0; c < b.w; c++) {
        const cx = bx + c * TILE;
        const ty = colTop(c);
        this.neonLine(ctx, cx + 1, ty + 0.5, cx + TILE - 1, ty + 0.5, C.cyan, 1.5, 0.82);

        const rows = Math.max(0, Math.floor((groundTop - ty) / 22) - 1);
        for (let r = 0; r < rows; r++) {
          const lit = hash2(b.x0 + c, b.top + r, seed);
          if (lit < 0.58) continue;
          const wy = ty + 16 + r * 22;
          if (wy > groundTop - 8) continue;
          const hue = hash2(c, r, seed + 4);
          const col = hue > 0.72 ? '251,191,36' : hue > 0.4 ? '125,211,252' : '167,139,250';
          const flick = 0.55 + 0.45 * Math.sin(performance.now() * 0.0012 + lit * 12);
          ctx.fillStyle = `rgba(${col},${0.30 + 0.35 * flick})`;
          ctx.fillRect(cx + 13, wy, 5, 8);
        }
      }

      // antenna + beacon above the crown
      if (b.h >= 4) {
        const ax = bx + bw * 0.5;
        ctx.strokeStyle = 'rgba(120,160,200,0.45)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(ax, roof);
        ctx.lineTo(ax, roof - 26);
        ctx.stroke();
        const blink = 0.4 + 0.6 * Math.abs(Math.sin(performance.now() * 0.0018 + b.x0));
        ctx.fillStyle = `rgba(244,114,182,${blink})`;
        ctx.beginPath();
        ctx.arc(ax, roof - 28, 2.4, 0, 6.2832);
        ctx.fill();
      }

      // rooftop service box on the flat crown
      const crownW = b.w - steps * 2;
      if (crownW >= 2) {
        const boxX = bx + steps * TILE + 8;
        ctx.fillStyle = '#0D1424';
        ctx.fillRect(boxX, roof - 14, 20, 14);
        ctx.strokeStyle = 'rgba(80,120,160,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(boxX + 0.5, roof - 13.5, 20, 14);
      }
    }
  }

  drawPads(ctx, chunk, tx0, tx1, ty0, ty1) {
    const t = performance.now() * 0.004;
    for (let ty = Math.max(ty0, 0); ty <= Math.min(ty1, CHUNK_H - 1); ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (chunk.map[ty * CHUNK_W + tx] !== 4) continue;
        const x = chunk.baseX + tx * TILE;
        const top = ty * TILE;
        const pulse = 0.55 + 0.45 * Math.sin(t + tx * 0.9);

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        // beacon so a launch pad reads from across the screen
        const beam = ctx.createLinearGradient(0, top, 0, top - 84);
        beam.addColorStop(0, `rgba(34,211,238,${0.20 + 0.12 * pulse})`);
        beam.addColorStop(0.6, `rgba(34,211,238,${0.06 + 0.05 * pulse})`);
        beam.addColorStop(1, 'rgba(34,211,238,0)');
        ctx.fillStyle = beam;
        ctx.fillRect(x + 5, top - 84, TILE - 10, 84);

        ctx.fillStyle = `rgba(34,211,238,${0.10 + 0.10 * pulse})`;
        ctx.fillRect(x + 2, top + 2, TILE - 4, TILE - 6);

        ctx.fillStyle = `rgba(20,40,52,${0.85})`;
        ctx.fillRect(x + 4, top + 12, TILE - 8, 12);

        ctx.strokeStyle = `rgba(143,227,255,${0.55 + 0.35 * pulse})`;
        ctx.lineWidth = 2;
        for (let i = 0; i < 2; i++) {
          const cy = top + 16 + i * 5;
          ctx.beginPath();
          ctx.moveTo(x + 8, cy + 4);
          ctx.lineTo(x + TILE / 2, cy);
          ctx.lineTo(x + TILE - 8, cy + 4);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  drawStreetEdge(ctx, chunk, groundTop) {
    this.neonLine(ctx, chunk.baseX, groundTop + 0.5, chunk.baseX + CHUNK_PX, groundTop + 0.5, C.cyan, 1.4, 0.4);
  }

  drawHazards(ctx, chunk, tx0, tx1, ty0, ty1) {
    for (let ty = Math.max(ty0, 0); ty <= Math.min(ty1, CHUNK_H - 1); ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (chunk.map[ty * CHUNK_W + tx] !== 2) continue;
        const x = chunk.baseX + tx * TILE;
        const y = ty * TILE + TILE;
        ctx.fillStyle = 'rgba(244,114,182,0.20)';
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          ctx.moveTo(x + i * 8, y);
          ctx.lineTo(x + i * 8 + 4, y - 13);
          ctx.lineTo(x + i * 8 + 8, y);
        }
        ctx.fill();
        ctx.strokeStyle = 'rgba(244,114,182,0.85)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }
  }

  neonLine(ctx, x1, y1, x2, y2, color, width, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.globalAlpha = alpha * 0.10;
    ctx.lineWidth = width * 5;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.globalAlpha = alpha * 0.25;
    ctx.lineWidth = width * 2.4;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- entities

  drawOrbs(ctx, game) {
    const t = game.time;
    for (const o of game.orbs) {
      if (!o.alive) continue;
      const pulse = 1 + Math.sin(t * 3 + o.t) * 0.12;
      const r = o.r * pulse;
      ctx.save();
      ctx.translate(o.x, o.y + Math.sin(t * 2.2 + o.t) * 3);
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 3.4);
      g.addColorStop(0, 'rgba(34,211,238,0.55)');
      g.addColorStop(0.4, 'rgba(34,211,238,0.15)');
      g.addColorStop(1, 'rgba(34,211,238,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r * 3.4, 0, 6.2832); ctx.fill();
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#EAFFFF';
      ctx.fillRect(-r * 0.55, -r * 0.55, r * 1.1, r * 1.1);
      ctx.strokeStyle = 'rgba(34,211,238,0.9)';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(-r * 0.9, -r * 0.9, r * 1.8, r * 1.8);
      ctx.restore();
    }
  }

  drawEnemies(ctx, game) {
    for (const e of game.enemies) {
      if (e.type === 'walker') this.drawWalker(ctx, e);
      else if (e.type === 'flyer') this.drawFlyer(ctx, e);
    }
  }

  drawWalker(ctx, e) {
    const { x, y } = e;
    const squash = e.alive ? 1 : Math.max(0, 1 - e.deadT * 4);
    if (!e.alive && squash <= 0) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, squash);

    // legs
    const step = Math.sin(e.t * 10) * 3;
    ctx.strokeStyle = 'rgba(244,114,182,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-7, -8); ctx.lineTo(-9 + step, 0);
    ctx.moveTo(7, -8); ctx.lineTo(9 - step, 0);
    ctx.stroke();

    // body
    ctx.fillStyle = '#160A1E';
    ctx.strokeStyle = 'rgba(244,114,182,0.9)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-14, -8);
    ctx.lineTo(-10, -25);
    ctx.lineTo(10, -25);
    ctx.lineTo(14, -8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // eye
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = e.chasing ? '#FF6BD6' : '#F472B6';
    ctx.beginPath();
    ctx.arc(0, -17, 3.2, 0, 6.2832);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // antenna
    ctx.strokeStyle = 'rgba(244,114,182,0.55)';
    ctx.beginPath();
    ctx.moveTo(0, -25); ctx.lineTo(0, -31);
    ctx.stroke();
    ctx.fillStyle = e.chasing ? '#FBBF24' : 'rgba(251,191,36,0.6)';
    ctx.beginPath(); ctx.arc(0, -32, 2, 0, 6.2832); ctx.fill();

    ctx.restore();
  }

  drawFlyer(ctx, e) {
    const bob = Math.sin(e.t * 6) * 1.5;
    const squash = e.alive ? 1 : Math.max(0, 1 - e.deadT * 5);
    if (!e.alive && squash <= 0) return;
    ctx.save();
    ctx.translate(e.x, e.y + bob);
    ctx.scale(1, squash);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 28);
    g.addColorStop(0, 'rgba(251,191,36,0.26)');
    g.addColorStop(1, 'rgba(251,191,36,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 28, 0, 6.2832); ctx.fill();
    ctx.restore();

    const spin = Math.abs(Math.sin(e.t * 22));
    ctx.strokeStyle = 'rgba(251,191,36,0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-13, -4); ctx.lineTo(-13, -10);
    ctx.moveTo(13, -4); ctx.lineTo(13, -10);
    ctx.stroke();

    ctx.fillStyle = `rgba(251,191,36,${0.22 + 0.42 * spin})`;
    ctx.beginPath(); ctx.ellipse(-13, -11, 7 * (0.45 + spin * 0.55), 1.8, 0, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.ellipse(13, -11, 7 * (0.45 + spin * 0.55), 1.8, 0, 0, 6.2832); ctx.fill();

    ctx.fillStyle = '#140F06';
    ctx.strokeStyle = 'rgba(251,191,36,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-14, 0); ctx.lineTo(-8, -7); ctx.lineTo(8, -7);
    ctx.lineTo(14, 0); ctx.lineTo(8, 8); ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const eyeColor = e.attack > 0.4 ? '#FF7A45' : '#FBBF24';
    ctx.fillStyle = eyeColor;
    ctx.beginPath(); ctx.arc(0, 0.5, 3.2, 0, 6.2832); ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = eyeColor;
    ctx.beginPath(); ctx.arc(0, 0.5, 6.5, 0, 6.2832); ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  drawPlayer(ctx, game) {
    const p = game.player;
    if (!p.alive) return;
    const blink = p.iframes > 0 ? 0.35 + 0.65 * Math.abs(Math.sin(p.iframes * 30)) : 1;
    const bob = p.onGround && Math.abs(p.vx) > 30 ? Math.abs(Math.sin(p.runPhase)) * -1.6 : 0;

    ctx.save();
    ctx.globalAlpha = blink;
    ctx.translate(p.x + p.w / 2, p.y + p.h + bob);

    // halo so the runner reads against busy rooftops
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(0, -p.h * 0.5, 2, 0, -p.h * 0.5, 38);
    halo.addColorStop(0, 'rgba(34,211,238,0.20)');
    halo.addColorStop(0.5, 'rgba(34,211,238,0.07)');
    halo.addColorStop(1, 'rgba(34,211,238,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, -p.h * 0.5, 38, 0, 6.2832);
    ctx.fill();
    ctx.restore();

    // shadow
    if (p.onGround) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.ellipse(0, 2, 16, 4, 0, 0, 6.2832);
      ctx.fill();
      ctx.restore();
    }

    // jet flame
    if (!p.onGround && p.vy < 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(0, 0, 0, 18);
      g.addColorStop(0, 'rgba(34,211,238,0.75)');
      g.addColorStop(1, 'rgba(167,139,250,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.lineTo(0, 18);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // legs
    const swing = p.onGround ? Math.sin(p.runPhase) * 4 : 2;
    ctx.strokeStyle = 'rgba(143,227,255,0.85)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-6, -10); ctx.lineTo(-6 + swing, 0);
    ctx.moveTo(6, -10); ctx.lineTo(6 - swing, 0);
    ctx.stroke();

    // body
    const bodyH = p.h - 8;
    const g = ctx.createLinearGradient(0, -bodyH, 0, 0);
    g.addColorStop(0, '#EAFBFF');
    g.addColorStop(0.35, '#8FE3FF');
    g.addColorStop(1, '#2AA7D8');
    ctx.fillStyle = g;
    roundRect(ctx, -p.w / 2, -bodyH, p.w, bodyH, 9);
    ctx.fill();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(34,211,238,0.55)';
    ctx.lineWidth = 1.2;
    roundRect(ctx, -p.w / 2, -bodyH, p.w, bodyH, 9);
    ctx.stroke();
    ctx.restore();

    // visor
    ctx.fillStyle = 'rgba(6,16,26,0.92)';
    roundRect(ctx, -p.w / 2 + 5, -bodyH + 8, p.w - 10, 11, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(143,227,255,0.95)';
    const eyeShift = p.facing * 1.5;
    roundRect(ctx, -5 + eyeShift, -bodyH + 11, 10, 4, 2);
    ctx.fill();

    ctx.restore();
  }

  drawParticles(ctx, game) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const pt of game.particles) {
      const a = Math.max(0, pt.life / pt.maxLife);
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = pt.color;
      const r = pt.size * (0.4 + a * 0.6);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, 6.2832);
      ctx.fill();
    }
    ctx.restore();
  }

  drawForeground(ctx, cam) {
    const off = cam.x * 1.12;
    const step = 88;
    const start = Math.floor((off - step) / step) * step;
    const end = off + this.w + step;
    for (let wx = start; wx < end; wx += step) {
      const idx = Math.floor(wx / step);
      const h = 64 + hash2(idx, 11, 4.2) * 96;
      const bwid = step * (0.66 + hash2(idx, 5, 2.1) * 0.3);
      const x = wx - off;
      ctx.fillStyle = '#04060C';
      ctx.fillRect(x, this.h - h, bwid, h + 2);
      ctx.fillStyle = 'rgba(120,200,255,0.10)';
      for (let r = 0; r < Math.floor(h / 16); r++) {
        if (hash2(idx, r, 8.4) > 0.72) ctx.fillRect(x + 6, this.h - h + 8 + r * 16, 3, 3);
      }
    }
    const fg = ctx.createLinearGradient(0, this.h - 150, 0, this.h);
    fg.addColorStop(0, 'rgba(4,6,12,0)');
    fg.addColorStop(1, 'rgba(4,6,12,0.85)');
    ctx.fillStyle = fg;
    ctx.fillRect(0, this.h - 150, this.w, 150);
  }

  drawVignette(ctx) {
    const g = ctx.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.35, this.w / 2, this.h / 2, this.h * 0.95);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  drawDamage(ctx, game) {
    if (game.player.iframes > 0.9) {
      const a = (game.player.iframes - 0.9) / 0.25;
      ctx.fillStyle = `rgba(244,114,182,${0.16 * a})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

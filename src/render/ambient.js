/**
 * ambient.js
 * ----------------------------------------------------------------------------
 * Purely decorative life over the city, drawn on top of everything:
 *
 *   - cloud shadows: soft dark blobs that drift with the wind across the
 *     whole map (they darken roofs and roads alike, like real cloud shade)
 *   - birds: now and then a small flock flaps across the sky
 *
 * Nothing here touches the simulation, so it uses Math.random() freely.
 * The renderer skips this layer when ambient effects are switched off
 * (Settings) or the player's system asks for reduced motion. It also sets
 * `shade` (cloud shadows need sunshine: none at night or under overcast)
 * and `birdsOk` (no new flocks at night or in rain and snow).
 * ----------------------------------------------------------------------------
 */

import { HALF_W, HALF_H } from '../config.js';

const WIND = { x: 7, y: 2.2 }; // world px per second (same direction for clouds and birds)

export class Ambient {
  constructor() {
    this.clouds = [];
    this.flocks = [];
    this.nextFlock = 6 + Math.random() * 10; // seconds until the first flock
    this.bounds = null;
    this.shade = 1; // 0..1 strength of cloud shadows
    this.birdsOk = true; // may new flocks start?
  }

  /** Scatter clouds over a map of w x h tiles (call when a game is attached). */
  reset(mapW, mapH) {
    // World-space extent of the map diamond.
    this.bounds = { x0: -mapH * HALF_W, x1: mapW * HALF_W, y0: 0, y1: (mapW + mapH) * HALF_H };
    const b = this.bounds;
    const area = (b.x1 - b.x0) * (b.y1 - b.y0);
    const count = Math.max(4, Math.min(14, Math.round(area / 450000)));
    this.clouds = [];
    for (let k = 0; k < count; k++) this.clouds.push(this.makeCloud(b.x0 + Math.random() * (b.x1 - b.x0), b.y0 + Math.random() * (b.y1 - b.y0)));
    this.flocks = [];
  }

  makeCloud(x, y) {
    const size = 90 + Math.random() * 140;
    const puffs = [];
    const n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      puffs.push({ dx: (Math.random() - 0.5) * size * 1.4, dy: (Math.random() - 0.5) * size * 0.45, r: size * (0.45 + Math.random() * 0.35) });
    }
    return { x, y, puffs, alpha: 0.09 + Math.random() * 0.06, speed: 0.7 + Math.random() * 0.6 };
  }

  update(dt) {
    const b = this.bounds;
    if (!b) return;
    const w = b.x1 - b.x0;
    for (const c of this.clouds) {
      c.x += WIND.x * c.speed * dt;
      c.y += WIND.y * c.speed * dt;
      // Wrap around the map so the sky never empties.
      if (c.x > b.x1 + 300) c.x -= w + 600;
      if (c.y > b.y1 + 200) c.y -= b.y1 - b.y0 + 400;
    }
    this.nextFlock -= dt;
    if (this.nextFlock <= 0) {
      this.nextFlock = 25 + Math.random() * 35;
      if (this.birdsOk) this.spawnFlock();
    }
    for (const f of this.flocks) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.t += dt;
    }
    this.flocks = this.flocks.filter((f) => f.t < f.life);
  }

  /** A V of 4-9 birds entering from the left edge of the current view. */
  spawnFlock(view) {
    const v = view || this.lastView;
    if (!v) return;
    const n = 4 + Math.floor(Math.random() * 6);
    const birds = [];
    for (let k = 0; k < n; k++) {
      const side = k % 2 ? 1 : -1;
      const rank = Math.ceil(k / 2);
      birds.push({ dx: -rank * 16, dy: side * rank * 9 + (Math.random() - 0.5) * 4, phase: Math.random() * 6 });
    }
    const speed = 55 + Math.random() * 25;
    const y = v.y + v.h * (0.15 + Math.random() * 0.55);
    this.flocks.push({ x: v.x - 60, y, vx: speed, vy: speed * (Math.random() - 0.5) * 0.25, t: 0, life: (v.w + 200) / speed, birds });
  }

  /**
   * Draw clouds and birds. `cam` gives world->device transform, `view` is the
   * visible world rectangle (used to skip off-screen clouds and aim flocks).
   */
  draw(ctx, cam, view, time) {
    this.lastView = view;
    const k = cam.scale;
    // Cloud shadows
    if (this.shade > 0.03) for (const c of this.clouds) {
      for (const p of c.puffs) {
        const wx = c.x + p.dx;
        const wy = c.y + p.dy;
        if (wx + p.r < view.x || wx - p.r > view.x + view.w || wy + p.r < view.y || wy - p.r > view.y + view.h) continue;
        const sx = (wx - cam.x) * k;
        const sy = (wy - cam.y) * k;
        const r = p.r * k;
        const g = ctx.createRadialGradient(sx, sy, r * 0.15, sx, sy, r);
        g.addColorStop(0, `rgba(18,28,48,${(c.alpha * this.shade).toFixed(3)})`);
        g.addColorStop(1, 'rgba(18,28,48,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(sx, sy, r, r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Birds: little flapping V shapes with a faint shadow far below them
    for (const f of this.flocks) {
      for (const bd of f.birds) {
        const sx = (f.x + bd.dx - cam.x) * k;
        const sy = (f.y + bd.dy - cam.y) * k;
        const flap = Math.sin(time * 11 + bd.phase);
        const wing = 4.5 * k;
        ctx.strokeStyle = 'rgba(0,0,0,0.12)';
        ctx.lineWidth = 1.2 * k;
        ctx.beginPath();
        ctx.moveTo(sx - wing + 30 * k, sy + 60 * k);
        ctx.lineTo(sx + 30 * k, sy + 60 * k + flap * 1.5 * k);
        ctx.lineTo(sx + wing + 30 * k, sy + 60 * k);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(40,34,30,0.85)';
        ctx.lineWidth = 1.3 * k;
        ctx.beginPath();
        ctx.moveTo(sx - wing, sy - flap * 2.5 * k);
        ctx.quadraticCurveTo(sx - wing * 0.4, sy - 1.5 * k, sx, sy);
        ctx.quadraticCurveTo(sx + wing * 0.4, sy - 1.5 * k, sx + wing, sy - flap * 2.5 * k);
        ctx.stroke();
      }
    }
  }
}

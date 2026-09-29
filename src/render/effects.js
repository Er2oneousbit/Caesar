/**
 * effects.js
 * ----------------------------------------------------------------------------
 * Visual-only effects: flames on burning ruins, smoke from busy workshops,
 * dust clouds when something collapses. Uses Math.random() freely because
 * nothing here affects the simulation.
 * ----------------------------------------------------------------------------
 */

export class Effects {
  constructor() {
    /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number,max:number,size:number,color:string}>} */
    this.particles = [];
  }

  /** Spawn a dust cloud at a world position (collapses). */
  dust(wx, wy, size = 1) {
    for (let k = 0; k < 18 * size; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 6 + Math.random() * 14;
      this.particles.push({
        x: wx + (Math.random() - 0.5) * 30 * size,
        y: wy + (Math.random() - 0.5) * 14 * size,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.5 - 8,
        life: 0,
        max: 1.2 + Math.random() * 1.2,
        size: 4 + Math.random() * 6,
        color: '150,135,110',
      });
    }
  }

  /** Occasional smoke puff (workshops, fires). */
  smoke(wx, wy, dark = false) {
    this.particles.push({
      x: wx + (Math.random() - 0.5) * 4,
      y: wy,
      vx: 3 + Math.random() * 4,
      vy: -10 - Math.random() * 6,
      life: 0,
      max: 1.6 + Math.random(),
      size: 2.5 + Math.random() * 2,
      color: dark ? '60,55,50' : '170,165,160',
    });
  }

  /** Advance particles by dt seconds. */
  update(dt) {
    const out = [];
    for (const p of this.particles) {
      p.life += dt;
      if (p.life >= p.max) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.98;
      p.size += dt * 3;
      out.push(p);
    }
    this.particles = out.length > 600 ? out.slice(-600) : out;
  }

  /** Draw particles; toScreen maps world px -> device px, k = scale. */
  draw(ctx, cam) {
    const k = cam.scale;
    for (const p of this.particles) {
      const a = 0.5 * (1 - p.life / p.max);
      const sx = (p.x - cam.x) * k;
      const sy = (p.y - cam.y) * k;
      ctx.fillStyle = `rgba(${p.color},${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, p.size * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Flickering flames on a burning tile. (sx, sy) is the tile center in device
 * pixels; t is time in seconds; seed varies the flicker per tile.
 */
export function drawFlames(ctx, sx, sy, k, t, seed) {
  // warm flickering glow on the ground and nearby walls
  const glow = (26 + Math.sin(t * 9 + seed) * 3) * k;
  const g = ctx.createRadialGradient(sx, sy - 6 * k, 0, sx, sy - 6 * k, glow);
  g.addColorStop(0, 'rgba(255,170,60,0.38)');
  g.addColorStop(1, 'rgba(255,120,30,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(sx, sy - 6 * k, glow, glow * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  // rising embers
  ctx.fillStyle = 'rgba(255,200,90,0.9)';
  for (let e = 0; e < 3; e++) {
    const p = (t * 0.8 + seed * 0.37 + e / 3) % 1;
    const ex = sx + Math.sin(p * 9 + seed + e) * 6 * k;
    const ey = sy - (8 + p * 30) * k;
    ctx.globalAlpha = 1 - p;
    ctx.fillRect(ex, ey, 1.4 * k, 1.4 * k);
  }
  ctx.globalAlpha = 1;
  for (let f = 0; f < 4; f++) {
    const ph = t * 7 + seed * 1.7 + f * 2.1;
    const h = (10 + Math.sin(ph) * 4 + f * 2) * k;
    const x = sx + (f - 1.5) * 5 * k + Math.sin(ph * 0.7) * 1.5 * k;
    const y = sy + (f % 2) * 2 * k;
    ctx.fillStyle = f % 2 ? 'rgba(255,140,30,0.85)' : 'rgba(255,90,20,0.85)';
    ctx.beginPath();
    ctx.moveTo(x - 3.5 * k, y);
    ctx.quadraticCurveTo(x - 3 * k, y - h * 0.6, x, y - h);
    ctx.quadraticCurveTo(x + 3 * k, y - h * 0.6, x + 3.5 * k, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,230,120,0.8)';
    ctx.beginPath();
    ctx.moveTo(x - 1.5 * k, y);
    ctx.quadraticCurveTo(x - 1.2 * k, y - h * 0.35, x, y - h * 0.55);
    ctx.quadraticCurveTo(x + 1.2 * k, y - h * 0.35, x + 1.5 * k, y);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Water droplets arcing out of a working fountain's spout. (sx, sy) is the
 * top of the spout in device pixels.
 */
export function drawSpray(ctx, sx, sy, k, t, seed) {
  ctx.fillStyle = 'rgba(210,236,255,0.9)';
  for (let j = 0; j < 10; j++) {
    const p = (t * 1.3 + j / 10 + seed * 0.13) % 1;
    const side = j % 2 ? 1 : -1;
    const x = sx + side * p * 8 * k;
    const y = sy - p * 7 * k + p * p * 16 * k; // up, then down into the basin
    ctx.globalAlpha = 0.95 - p * 0.6;
    ctx.fillRect(x - 0.6 * k, y - 0.6 * k, 1.2 * k, 1.2 * k);
  }
  ctx.globalAlpha = 1;
}

/** A brief four-point sun glint on water (alpha 0..1). */
export function drawGlint(ctx, sx, sy, k, alpha) {
  ctx.fillStyle = `rgba(255,255,245,${alpha.toFixed(3)})`;
  const r = 2.4 * k;
  ctx.fillRect(sx - r, sy - 0.35 * k, r * 2, 0.7 * k);
  ctx.fillRect(sx - 0.35 * k, sy - r * 0.6, 0.7 * k, r * 1.2);
}

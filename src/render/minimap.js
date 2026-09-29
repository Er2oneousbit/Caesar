/**
 * minimap.js
 * ----------------------------------------------------------------------------
 * A small diamond-shaped overview of the whole map. Each tile becomes 2x1
 * pixels in the same isometric projection as the main view, so one minimap
 * pixel equals 32 world pixels on both axes. Clicking/dragging on it moves
 * the camera.
 * ----------------------------------------------------------------------------
 */

import { HALF_W } from '../config.js';
import { MINIMAP_TERRAIN } from './terrainArt.js';

const CATEGORY_COLORS = {
  housing: [214, 190, 140],
  water: [80, 150, 220],
  health: [120, 200, 150],
  religion: [230, 230, 240],
  education: [150, 170, 230],
  entertainment: [230, 150, 90],
  government: [240, 220, 150],
  engineering: [180, 140, 90],
  security: [220, 70, 60],
  farms: [210, 190, 90],
  industry: [150, 110, 80],
  commerce: [200, 120, 60],
};

export class Minimap {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.base = null; // offscreen ImageData canvas of the map
    this.lastRevision = -1;
    this.lastBuild = 0;
    this.layout = { scale: 1, ox: 0, oy: 0 };
  }

  /** Rebuild the map image (throttled). */
  rebuild(game, now) {
    const { map } = game;
    if (map.revision === this.lastRevision && now - this.lastBuild < 1500) return;
    this.lastRevision = map.revision;
    this.lastBuild = now;
    const W = map.w + map.h;
    const H = Math.ceil((map.w + map.h) / 2);
    if (!this.base || this.base.width !== W || this.base.height !== H) {
      this.base = document.createElement('canvas');
      this.base.width = W;
      this.base.height = H;
    }
    const bctx = this.base.getContext('2d');
    const img = bctx.createImageData(W, H);
    const data = img.data;
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const i = y * map.w + x;
        let c = MINIMAP_TERRAIN[map.terrain[i]];
        if (map.road[i]) c = [196, 176, 140];
        const bid = map.building[i];
        if (bid) {
          const b = game.buildings.get(bid);
          if (b) {
            if (b.house) {
              const t = b.house.tier / 12;
              c = [Math.round(200 - 60 * t), Math.round(170 - 40 * t), Math.round(120 + 60 * t)];
            } else {
              c = CATEGORY_COLORS[b.def.category] || [200, 200, 200];
            }
          }
        }
        if (game.fires.has(i)) c = [255, 80, 20];
        else if (map.rubble[i] && !bid) c = [110, 100, 90];
        const px = x - y + map.h - 1;
        const py = (x + y) >> 1;
        for (let dx = 0; dx < 2; dx++) {
          const o = (py * W + px + dx) * 4;
          if (px + dx < 0 || px + dx >= W || py >= H) continue;
          data[o] = c[0];
          data[o + 1] = c[1];
          data[o + 2] = c[2];
          data[o + 3] = 255;
        }
      }
    }
    bctx.putImageData(img, 0, 0);
  }

  /** Draw the minimap and the camera frame. */
  draw(game, camera, now) {
    if (!game) return;
    this.rebuild(game, now);
    const { ctx, canvas } = this;
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.fillStyle = '#1d1a16';
    ctx.fillRect(0, 0, cw, ch);
    if (!this.base) return;
    const scale = Math.min(cw / this.base.width, ch / this.base.height);
    const ox = (cw - this.base.width * scale) / 2;
    const oy = (ch - this.base.height * scale) / 2;
    this.layout = { scale, ox, oy, h: game.map.h };
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, ox, oy, this.base.width * scale, this.base.height * scale);
    // camera frame: 1 minimap px = HALF_W world px
    const v = camera.viewRect();
    const unit = HALF_W; // world px per minimap px
    const fx = ox + (v.x / unit + game.map.h - 1) * scale;
    const fy = oy + (v.y / unit) * scale;
    ctx.strokeStyle = '#fff5d6';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(fx) + 0.5, Math.round(fy) + 0.5, Math.round((v.w / unit) * scale), Math.round((v.h / unit) * scale));
    // entry/exit markers
    for (const [pt, col] of [[game.map.entry, '#6cf06c'], [game.map.exit, '#f06c6c']]) {
      const px = ox + (pt.x - pt.y + game.map.h - 1) * scale;
      const py = oy + ((pt.x + pt.y) / 2) * scale;
      ctx.fillStyle = col;
      ctx.fillRect(px - 2, py - 2, 4, 4);
    }
  }

  /** Canvas pixel -> world pixel (for click-to-move). */
  toWorld(px, py) {
    const { scale, ox, oy, h } = this.layout;
    const mx = (px - ox) / scale;
    const my = (py - oy) / scale;
    return { x: (mx - h + 1) * HALF_W, y: my * HALF_W };
  }
}

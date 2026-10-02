/**
 * minimap.js
 * ----------------------------------------------------------------------------
 * A small diamond-shaped overview of the whole map. Each tile becomes 2x1
 * pixels in the same isometric projection as the main view, so one minimap
 * pixel equals 32 world pixels on both axes. Clicking/dragging on it moves
 * the camera.
 *
 * It turns with the view (view.js), as the original's did: it is the main
 * view's world shrunk, so the camera frame stays a plain rectangle and a
 * click maps straight to world px. A small "N" by the diamond's corner shows
 * where north lies.
 * ----------------------------------------------------------------------------
 */

import { HALF_W } from '../config.js';
import { viewSize, toView, tileAxes } from './view.js';
import { MINIMAP_TERRAIN } from './terrainArt.js';
import { MAX_TIER } from '../data/housing.js';
import { mainOf } from '../sim/entities.js';

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
  military: [170, 60, 50],
};

export class Minimap {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.base = null; // offscreen ImageData canvas of the map
    this.lastRevision = -1;
    this.lastBuild = 0;
    this.lastTurn = 0;
    this.layout = { scale: 1, ox: 0, oy: 0 };
  }

  /** Rebuild the map image (throttled; at once when the view turns). */
  rebuild(game, now, turn = 0) {
    const { map } = game;
    if (map.revision === this.lastRevision && turn === this.lastTurn && now - this.lastBuild < 1500) return;
    this.lastRevision = map.revision;
    this.lastTurn = turn;
    this.lastBuild = now;
    const W = map.w + map.h;
    const H = Math.ceil((map.w + map.h) / 2);
    const [VW, VH] = viewSize(map.w, map.h, turn);
    if (!this.base || this.base.width !== W || this.base.height !== H) {
      this.base = document.createElement('canvas');
      this.base.width = W;
      this.base.height = H;
    }
    const bctx = this.base.getContext('2d');
    const img = bctx.createImageData(W, H);
    const data = img.data;
    // Row by row of the view (two tiles share each pixel row, and the one
    // drawn last shows), so a turned minimap is the unturned one of the
    // turned map, pixel for pixel.
    const ax = tileAxes(turn, map.w, map.h);
    for (let vy = 0; vy < VH; vy++) {
      for (let vx = 0; vx < VW; vx++) {
        const x = ax.ox + ax.xx * vx + ax.xy * vy;
        const y = ax.oy + ax.yx * vx + ax.yy * vy;
        const i = y * map.w + x;
        let c = MINIMAP_TERRAIN[map.terrain[i]];
        if (map.road[i]) c = [196, 176, 140];
        if (map.wall[i]) c = [120, 112, 98];
        const bid = map.building[i];
        if (bid) {
          const b = game.buildings.get(bid);
          if (b) {
            if (b.house) {
              const t = b.house.tier / MAX_TIER;
              c = [Math.round(200 - 60 * t), Math.round(170 - 40 * t), Math.round(120 + 60 * t)];
            } else {
              c = CATEGORY_COLORS[mainOf(game, b).def.category] || [200, 200, 200]; // (a hippodrome's sections as the hippodrome)
            }
          }
        }
        if (game.fires.has(i)) c = [255, 80, 20];
        else if (map.rubble[i] && !bid) c = [110, 100, 90];
        const px = vx - vy + VH - 1;
        const py = (vx + vy) >> 1;
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
    const turn = camera.turn & 3;
    this.rebuild(game, now, turn);
    const { ctx, canvas } = this;
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.fillStyle = '#1d1a16';
    ctx.fillRect(0, 0, cw, ch);
    if (!this.base) return;
    const scale = Math.min(cw / this.base.width, ch / this.base.height);
    const ox = (cw - this.base.width * scale) / 2;
    const oy = (ch - this.base.height * scale) / 2;
    const { w: mapW, h: mapH } = game.map;
    const VH = viewSize(mapW, mapH, turn)[1];
    this.layout = { scale, ox, oy, h: VH };
    // A map point (continuous tiles) on the minimap, as the view sees it.
    const at = (x, y) => {
      const [vx, vy] = toView(x, y, turn, mapW, mapH);
      return [ox + (vx - vy + VH - 1) * scale, oy + ((vx + vy) / 2) * scale];
    };
    // Crisp pixels when enlarged; smoothed when shrunk (Uber maps), or 1-tile roads drop out.
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.drawImage(this.base, ox, oy, this.base.width * scale, this.base.height * scale);
    // camera frame: 1 minimap px = HALF_W world px
    const v = camera.viewRect();
    const unit = HALF_W; // world px per minimap px
    const fx = ox + (v.x / unit + VH - 1) * scale;
    const fy = oy + (v.y / unit) * scale;
    ctx.strokeStyle = '#fff5d6';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(fx) + 0.5, Math.round(fy) + 0.5, Math.round((v.w / unit) * scale), Math.round((v.h / unit) * scale));
    // soldiers (white) and raiders (red), drawn live every frame
    for (const u of game.units.values()) {
      const [px, py] = at(u.x, u.y);
      ctx.fillStyle = u.side === 'enemy' ? '#ff3b2f' : '#f4f0e6';
      ctx.fillRect(px - 1, py - 1, 2.5, 2.5);
    }
    // entry/exit markers (tile centers)
    for (const [pt, col] of [[game.map.entry, '#6cf06c'], [game.map.exit, '#f06c6c']]) {
      const [px, py] = at(pt.x + 0.5, pt.y + 0.5);
      ctx.fillStyle = col;
      ctx.fillRect(px - 2, py - 2, 4, 4);
    }
    this.drawNorth(ctx, at(mapW / 2, mapH / 2), at(0, 0), cw, ch);
  }

  /**
   * "N" just beyond the map's north corner, kept inside the canvas: the
   * minimap turns with the view, so this tells the player which side they
   * are looking from. North is the game's compass (the scouts' "from the
   * north", sim/military.js screenDirection): straight up on the unturned
   * view, the map's (0, 0) corner.
   */
  drawNorth(ctx, mid, edge, cw, ch) {
    const dx = edge[0] - mid[0];
    const dy = edge[1] - mid[1];
    const len = Math.hypot(dx, dy) || 1;
    const x = Math.max(8, Math.min(cw - 8, edge[0] + (dx / len) * 9));
    const y = Math.max(8, Math.min(ch - 8, edge[1] + (dy / len) * 9));
    ctx.save();
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(20,16,12,0.85)';
    ctx.strokeText('N', x, y);
    ctx.fillStyle = '#fff5d6';
    ctx.fillText('N', x, y);
    ctx.restore();
    this.north = { x, y }; // (for the browser smoke test)
  }

  /** Canvas pixel -> world pixel (for click-to-move). */
  toWorld(px, py) {
    const { scale, ox, oy, h } = this.layout;
    const mx = (px - ox) / scale;
    const my = (py - oy) / scale;
    return { x: (mx - h + 1) * HALF_W, y: my * HALF_W };
  }
}

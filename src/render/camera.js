/**
 * camera.js
 * ----------------------------------------------------------------------------
 * Isometric projection + camera (pan/zoom).
 *
 * World pixel space (zoom 1): tile (x, y)'s TOP corner is at
 *     wx = (x - y) * HALF_W
 *     wy = (x + y) * HALF_H
 * so the tile's center is at (wx, wy + HALF_H).
 *
 * Screen (device pixels) = (world - camera.pos) * camera.scale,
 * where scale = zoom * devicePixelRatio. All rendering works in device pixels
 * so sprites stay crisp on high-DPI screens.
 * ----------------------------------------------------------------------------
 */

import { CONFIG, HALF_W, HALF_H } from '../config.js';

/** World pixel position of a tile's top corner. */
export function tileTop(x, y) {
  return { x: (x - y) * HALF_W, y: (x + y) * HALF_H };
}

/** Continuous tile coordinates (tx, ty) -> world pixels. (tx+0.5, ty+0.5) is a tile center. */
export function worldOf(tx, ty) {
  return { x: (tx - ty) * HALF_W, y: (tx + ty) * HALF_H };
}

/** World pixels -> continuous tile coordinates. */
export function tileOfWorld(wx, wy) {
  const u = wx / HALF_W;
  const v = wy / HALF_H;
  return { x: (u + v) / 2, y: (v - u) / 2 };
}

export class Camera {
  constructor() {
    this.x = 0; // world px at the screen's left edge
    this.y = 0; // world px at the screen's top edge
    this.zoomIndex = CONFIG.DEFAULT_ZOOM_INDEX;
    this.dpr = 1;
    this.viewW = 800; // device pixels
    this.viewH = 600;
    this.bounds = null; // world rect the camera center may move inside
  }

  get zoom() { return CONFIG.ZOOM_LEVELS[this.zoomIndex]; }
  get scale() { return this.zoom * this.dpr; }

  /** Update viewport size (CSS pixels) and device pixel ratio. */
  resize(cssW, cssH, dpr) {
    const cx = this.x + this.viewW / this.scale / 2;
    const cy = this.y + this.viewH / this.scale / 2;
    this.dpr = Math.min(CONFIG.MAX_DPR, Math.max(1, dpr || 1));
    this.viewW = Math.max(1, Math.round(cssW * this.dpr));
    this.viewH = Math.max(1, Math.round(cssH * this.dpr));
    this.centerOnWorld(cx, cy);
  }

  /** Limit the camera to the map area (plus a margin). */
  setMapBounds(mapW, mapH) {
    const left = -mapH * HALF_W;
    const right = mapW * HALF_W;
    const top = 0;
    const bottom = (mapW + mapH) * HALF_H;
    this.bounds = { left, right, top, bottom };
  }

  clamp() {
    if (!this.bounds) return;
    const vw = this.viewW / this.scale;
    const vh = this.viewH / this.scale;
    const b = this.bounds;
    const margin = 200;
    const cx = Math.max(b.left - margin, Math.min(b.right + margin, this.x + vw / 2));
    const cy = Math.max(b.top - margin, Math.min(b.bottom + margin, this.y + vh / 2));
    this.x = cx - vw / 2;
    this.y = cy - vh / 2;
  }

  centerOnWorld(wx, wy) {
    this.x = wx - this.viewW / this.scale / 2;
    this.y = wy - this.viewH / this.scale / 2;
    this.clamp();
  }

  /** Center the view on a tile. */
  centerOnTile(tx, ty) {
    const w = worldOf(tx + 0.5, ty + 0.5);
    this.centerOnWorld(w.x, w.y);
  }

  /** Pan by a screen-space delta in CSS pixels. */
  panScreen(dxCss, dyCss) {
    this.x -= (dxCss * this.dpr) / this.scale;
    this.y -= (dyCss * this.dpr) / this.scale;
    this.clamp();
  }

  /**
   * Zoom one step in/out keeping the world point under the cursor fixed.
   * @param {number} dir +1 zoom in, -1 zoom out
   * @param {number} [sx] cursor x in CSS px
   * @param {number} [sy] cursor y in CSS px
   */
  zoomStep(dir, sx, sy) {
    const next = Math.max(0, Math.min(CONFIG.ZOOM_LEVELS.length - 1, this.zoomIndex + dir));
    if (next === this.zoomIndex) return false;
    const px = (sx ?? this.viewW / this.dpr / 2) * this.dpr;
    const py = (sy ?? this.viewH / this.dpr / 2) * this.dpr;
    const wx = this.x + px / this.scale;
    const wy = this.y + py / this.scale;
    this.zoomIndex = next;
    this.x = wx - px / this.scale;
    this.y = wy - py / this.scale;
    this.clamp();
    return true;
  }

  /** World px -> screen device px */
  toScreen(wx, wy) {
    return { x: (wx - this.x) * this.scale, y: (wy - this.y) * this.scale };
  }

  /** Screen CSS px -> world px */
  screenToWorld(sxCss, syCss) {
    return { x: this.x + (sxCss * this.dpr) / this.scale, y: this.y + (syCss * this.dpr) / this.scale };
  }

  /** Screen CSS px -> integer tile under the cursor. */
  screenToTile(sxCss, syCss) {
    const w = this.screenToWorld(sxCss, syCss);
    const t = tileOfWorld(w.x, w.y);
    return { x: Math.floor(t.x), y: Math.floor(t.y) };
  }

  /** Visible world rectangle. */
  viewRect() {
    return { x: this.x, y: this.y, w: this.viewW / this.scale, h: this.viewH / this.scale };
  }

  serialize() { return { x: this.x, y: this.y, zoomIndex: this.zoomIndex }; }

  restore(s) {
    if (!s) return;
    this.zoomIndex = Math.max(0, Math.min(CONFIG.ZOOM_LEVELS.length - 1, s.zoomIndex ?? this.zoomIndex));
    this.x = s.x ?? this.x;
    this.y = s.y ?? this.y;
    this.clamp();
  }
}

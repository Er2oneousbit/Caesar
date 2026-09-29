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
 *
 * Motion (all optional, `smooth = false` makes every move instant):
 *   - zoom: `zoomIndex` is the zoom LEVEL the player picked; `zoomF` is the
 *     zoom actually shown, which eases toward the level in about a fifth of
 *     a second while the point under the cursor stays put. Sprites are drawn
 *     for the level (see `spriteScale`) and scaled a little while it eases.
 *   - fling: after a drag the map keeps sliding and slows down (`fling`).
 *   - glide: `glideToTile` travels to a spot instead of jumping there.
 * `update(dt)` advances all three once per frame (the renderer calls it).
 * ----------------------------------------------------------------------------
 */

import { CONFIG, HALF_W, HALF_H } from '../config.js';

/** Seconds a zoom step takes to ease in (ease-out, so it responds at once). */
const ZOOM_TIME = 0.22;
/** Fling friction (per second, exponential) and speed limits in CSS px/s. */
const FLING_FRICTION = 4;
const FLING_MIN = 60;
const FLING_MAX = 3200;

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

const clampIndex = (i) => Math.max(0, Math.min(CONFIG.ZOOM_LEVELS.length - 1, Math.round(i) || 0));

export class Camera {
  constructor() {
    this.x = 0; // world px at the screen's left edge
    this.y = 0; // world px at the screen's top edge
    this._zoomIndex = CONFIG.DEFAULT_ZOOM_INDEX;
    this.zoomF = CONFIG.ZOOM_LEVELS[this._zoomIndex]; // zoom shown right now
    this.dpr = 1;
    this.viewW = 800; // device pixels
    this.viewH = 600;
    this.bounds = null; // world rect the camera center may move inside
    this.smooth = true; // animate zoom, flings and glides (off with reduced motion)
    this.zoomAnchor = null; // { px, py, wx, wy }: screen point (device px) pinned to a world point while zooming
    this.zoomAnim = null; // { from, t }: zoom easing from `from` to the level, t = 0..1
    this.vel = null; // fling velocity { x, y } in CSS px per second
    this.glide = null; // { x0, y0, x1, y1, t, dur } view-center travel in world px
  }

  /**
   * The zoom level index. Setting it directly jumps there (used when loading
   * a save or a test view); `zoomStep` is the animated way.
   */
  get zoomIndex() { return this._zoomIndex; }
  set zoomIndex(i) {
    this._zoomIndex = clampIndex(i);
    this.zoomF = CONFIG.ZOOM_LEVELS[this._zoomIndex];
    this.zoomAnchor = null;
    this.zoomAnim = null;
  }

  /** Zoom shown on screen right now (between levels while zooming). */
  get zoom() { return this.zoomF; }
  /** The zoom level being shown or eased toward. */
  get targetZoom() { return CONFIG.ZOOM_LEVELS[this._zoomIndex]; }
  /** Device px per world px right now. */
  get scale() { return this.zoomF * this.dpr; }
  /** Scale sprites are drawn at: the zoom level's, so a zoom animation reuses them. */
  get spriteScale() { return this.targetZoom * this.dpr; }
  /** True while anything is still moving by itself. */
  get moving() { return this.zoomF !== this.targetZoom || !!this.vel || !!this.glide; }

  /** Update viewport size (CSS pixels) and device pixel ratio. */
  resize(cssW, cssH, dpr) {
    const c = this.center();
    this.dpr = Math.min(CONFIG.MAX_DPR, Math.max(1, dpr || 1));
    this.viewW = Math.max(1, Math.round(cssW * this.dpr));
    this.viewH = Math.max(1, Math.round(cssH * this.dpr));
    this.zoomAnchor = null;
    this.centerOnWorld(c.x, c.y);
  }

  /** Limit the camera to the map area (plus a margin). */
  setMapBounds(mapW, mapH) {
    const left = -mapH * HALF_W;
    const right = mapW * HALF_W;
    const top = 0;
    const bottom = (mapW + mapH) * HALF_H;
    this.bounds = { left, right, top, bottom };
  }

  /** World point at the middle of the screen. */
  center() {
    return { x: this.x + this.viewW / this.scale / 2, y: this.y + this.viewH / this.scale / 2 };
  }

  /** A view center moved inside the allowed area. */
  clampCenter(cx, cy) {
    const b = this.bounds;
    if (!b) return { x: cx, y: cy };
    const margin = 200;
    return {
      x: Math.max(b.left - margin, Math.min(b.right + margin, cx)),
      y: Math.max(b.top - margin, Math.min(b.bottom + margin, cy)),
    };
  }

  clamp() {
    if (!this.bounds) return;
    const c = this.center();
    const k = this.clampCenter(c.x, c.y);
    this.x += k.x - c.x;
    this.y += k.y - c.y;
  }

  /** Jump so the world point (wx, wy) is in the middle of the screen. */
  centerOnWorld(wx, wy) {
    this.glide = null;
    this.vel = null;
    this.setCenter(wx, wy);
  }

  /** Move the view center (no side effects on glides/flings). */
  setCenter(wx, wy) {
    this.x = wx - this.viewW / this.scale / 2;
    this.y = wy - this.viewH / this.scale / 2;
    this.clamp();
  }

  /** Center the view on a tile, instantly. */
  centerOnTile(tx, ty) {
    const w = worldOf(tx + 0.5, ty + 0.5);
    this.zoomAnchor = null;
    this.centerOnWorld(w.x, w.y);
  }

  /** Travel to a tile (a short eased glide; instant when motion is off). */
  glideToTile(tx, ty) {
    const w = worldOf(tx + 0.5, ty + 0.5);
    this.glideToWorld(w.x, w.y);
  }

  glideToWorld(wx, wy) {
    if (!this.smooth) { this.centerOnWorld(wx, wy); return; }
    const c = this.center();
    const end = this.clampCenter(wx, wy);
    const distPx = Math.hypot(end.x - c.x, end.y - c.y) * this.zoomF; // CSS px on screen
    if (distPx < 1) return;
    this.vel = null;
    this.zoomAnchor = null; // a zoom still easing now keeps the screen center fixed
    this.glide = { x0: c.x, y0: c.y, x1: end.x, y1: end.y, t: 0, dur: Math.min(0.9, 0.3 + distPx / 4000) };
  }

  /** Pan by a screen-space delta in CSS pixels (a player action: ends any glide). */
  panScreen(dxCss, dyCss) {
    this.glide = null;
    this.shift(dxCss, dyCss);
  }

  /** Move the view by CSS px and keep a zoom in progress pinned to the same spot. */
  shift(dxCss, dyCss) {
    const dx = (dxCss * this.dpr) / this.scale;
    const dy = (dyCss * this.dpr) / this.scale;
    this.x -= dx;
    this.y -= dy;
    if (this.zoomAnchor) {
      this.zoomAnchor.wx -= dx;
      this.zoomAnchor.wy -= dy;
    }
    this.clamp();
  }

  /** Let the map keep sliding after a drag (velocity in CSS px per second). */
  fling(vx, vy) {
    const speed = Math.hypot(vx, vy);
    if (!this.smooth || !Number.isFinite(speed) || speed < FLING_MIN) { this.vel = null; return; }
    const f = Math.min(1, FLING_MAX / speed);
    this.vel = { x: vx * f, y: vy * f };
  }

  /** Stop sliding and gliding (the player grabbed the map). */
  stopMotion() {
    this.vel = null;
    this.glide = null;
  }

  /**
   * Zoom one level in/out keeping the world point under the cursor fixed.
   * @param {number} dir +1 zoom in, -1 zoom out
   * @param {number} [sx] cursor x in CSS px
   * @param {number} [sy] cursor y in CSS px
   */
  zoomStep(dir, sx, sy) {
    const next = clampIndex(this._zoomIndex + dir);
    if (next === this._zoomIndex) return false;
    const px = (sx ?? this.viewW / this.dpr / 2) * this.dpr;
    const py = (sy ?? this.viewH / this.dpr / 2) * this.dpr;
    const wx = this.x + px / this.scale;
    const wy = this.y + py / this.scale;
    this._zoomIndex = next;
    this.glide = null;
    if (!this.smooth) {
      this.zoomF = this.targetZoom;
      this.zoomAnchor = null;
      this.zoomAnim = null;
      this.x = wx - px / this.scale;
      this.y = wy - py / this.scale;
      this.clamp();
    } else {
      // (Re)start the ease from wherever the zoom is now, so quick wheel
      // notches chain smoothly.
      this.zoomAnchor = { px, py, wx, wy };
      this.zoomAnim = { from: this.zoomF, t: 0 };
    }
    return true;
  }

  /** Advance zoom easing, flings and glides. Call once per frame. */
  update(dt) {
    if (!(dt > 0)) return;
    if (this.zoomF !== this.targetZoom) {
      // Without a cursor anchor (keyboard zoom, or a glide took over) the
      // middle of the screen stays put.
      const c = this.zoomAnchor ? null : this.center();
      const za = this.zoomAnim;
      if (!this.smooth || !za) {
        this.zoomF = this.targetZoom;
      } else {
        // Ease out, in log space so zooming in and out feel the same speed.
        za.t = Math.min(1, za.t + dt / ZOOM_TIME);
        const e = 1 - (1 - za.t) ** 3;
        const l0 = Math.log(za.from);
        this.zoomF = za.t >= 1 ? this.targetZoom : Math.exp(l0 + (Math.log(this.targetZoom) - l0) * e);
      }
      const a = this.zoomAnchor;
      if (a) {
        this.x = a.wx - a.px / this.scale;
        this.y = a.wy - a.py / this.scale;
        this.clamp();
      } else if (!this.glide) {
        this.setCenter(c.x, c.y);
      }
      if (this.zoomF === this.targetZoom) {
        this.zoomAnchor = null;
        this.zoomAnim = null;
      }
    }
    if (this.vel) {
      this.shift(this.vel.x * dt, this.vel.y * dt);
      const decay = Math.exp(-dt * FLING_FRICTION);
      this.vel.x *= decay;
      this.vel.y *= decay;
      if (Math.hypot(this.vel.x, this.vel.y) < FLING_MIN / 2) this.vel = null;
    }
    if (this.glide) {
      const g = this.glide;
      g.t = Math.min(1, g.t + dt / g.dur);
      const t = g.t;
      const e = t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2; // ease in-out
      this.setCenter(g.x0 + (g.x1 - g.x0) * e, g.y0 + (g.y1 - g.y0) * e);
      if (t >= 1) this.glide = null;
    }
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

  serialize() { return { x: this.x, y: this.y, zoomIndex: this._zoomIndex }; }

  restore(s) {
    if (!s) return;
    this.zoomIndex = s.zoomIndex ?? this._zoomIndex;
    this.stopMotion();
    this.x = s.x ?? this.x;
    this.y = s.y ?? this.y;
    this.clamp();
  }
}

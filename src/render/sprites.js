/**
 * sprites.js
 * ----------------------------------------------------------------------------
 * Sprite cache. Every piece of art is drawn ONCE per zoom level into an
 * offscreen canvas and reused every frame with drawImage (fast).
 *
 * A sprite spec describes the art in world pixels:
 *   w, h    size of the art box (zoom 1)
 *   ax, ay  where the anchor (footprint top corner) sits inside that box
 *   draw    function(ctx) drawing with the origin AT the anchor
 *
 * Caches are kept for the current and previous scale so zooming back and
 * forth is instant, while memory stays bounded.
 * ----------------------------------------------------------------------------
 */

export class SpriteCache {
  constructor() {
    this.scale = 1;
    this.byScale = new Map(); // scale -> Map(key -> sprite)
    this.current = new Map();
    this.byScale.set(1, this.current);
    this.created = 0;
  }

  setScale(s) {
    if (s === this.scale) return;
    this.scale = s;
    if (!this.byScale.has(s)) this.byScale.set(s, new Map());
    this.current = this.byScale.get(s);
    // Keep at most 2 scales worth of sprites.
    if (this.byScale.size > 2) {
      for (const k of this.byScale.keys()) {
        if (k !== s && this.byScale.size > 2) this.byScale.delete(k);
      }
    }
  }

  /** Drop everything (e.g. after a device pixel ratio change). */
  clear() {
    this.byScale.clear();
    this.current = new Map();
    this.byScale.set(this.scale, this.current);
  }

  /** Remove sprites whose key starts with a prefix (dynamic art refresh). */
  invalidate(prefix) {
    for (const m of this.byScale.values()) {
      for (const k of [...m.keys()]) if (k.startsWith(prefix)) m.delete(k);
    }
  }

  /**
   * Get (or render) a sprite.
   * @param {string} key unique id for this art at any scale
   * @param {() => {w:number,h:number,ax:number,ay:number,draw:(ctx:CanvasRenderingContext2D)=>void}} specFn
   * @returns {{canvas:HTMLCanvasElement, ax:number, ay:number, w:number, h:number}}
   */
  get(key, specFn) {
    let spr = this.current.get(key);
    if (spr) return spr;
    const spec = specFn();
    const s = this.scale;
    const cw = Math.max(1, Math.round(spec.w * s));
    const ch = Math.max(1, Math.ceil(spec.h * s));
    const canvas = makeCanvas(cw, ch);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(s, 0, 0, s, spec.ax * s, spec.ay * s);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    try {
      spec.draw(ctx);
    } catch (err) {
      // Broken art should not crash the game: draw a magenta placeholder.
      console.error(`[sprites] failed to draw "${key}":`, err);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(0, 0, cw, ch);
    }
    spr = { canvas, ax: Math.round(spec.ax * s), ay: Math.round(spec.ay * s), w: cw, h: ch };
    this.current.set(key, spr);
    this.created++;
    return spr;
  }
}

/** Create an offscreen canvas (DOM canvas so it works everywhere). */
export function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  throw new Error('No canvas implementation available');
}

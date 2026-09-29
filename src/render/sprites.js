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
 * Each cached sprite remembers the scale `s` it was drawn at, so the renderer
 * can draw it at a slightly different scale while a zoom animates
 * (factor = display scale / s).
 *
 * Caches are kept for the current and one previous scale so zooming back and
 * forth is instant, while memory stays bounded. Drawing a whole new zoom
 * level of art at once takes a while, so new sprites get a time budget per
 * frame (`beginFrame`): past it, the same art from the other kept zoom level
 * is borrowed (drawn scaled) and the sharp one is made on a later frame.
 *
 * A change of look (a new month, snow settling) is prepared, then swapped:
 * get() with a `fallback` key keeps returning the OLD art while the new
 * sprites are drawn within the budget in the background, counting what is
 * still missing in `pending`. Once a frame ends with nothing pending, the
 * renderer drops the old look and the next frame shows the new one whole
 * (no patchwork of old and new tiles, no one-frame hitch).
 * ----------------------------------------------------------------------------
 */

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class SpriteCache {
  constructor() {
    this.scale = 1;
    this.byScale = new Map(); // scale -> Map(key -> sprite)
    this.current = new Map();
    this.byScale.set(1, this.current);
    this.created = 0;
    this.budgetMs = Infinity; // time allowed for drawing new sprites this frame
    this.spentMs = 0;
    this.borrowed = 0; // sprites borrowed from another zoom level this frame
    this.pending = 0; // new-look sprites still missing this frame (their old look was drawn)
  }

  /** Start a frame: pick the scale and reset the new-sprite time budget. */
  beginFrame(scale, budgetMs = Infinity) {
    this.setScale(scale);
    this.budgetMs = budgetMs;
    this.spentMs = 0;
    this.borrowed = 0;
    this.pending = 0;
  }

  setScale(s) {
    if (s === this.scale) return;
    this.scale = s;
    if (!this.byScale.has(s)) this.byScale.set(s, new Map());
    this.current = this.byScale.get(s);
    // Keep at most 2 scales worth of sprites. Drop the emptier one (a level
    // zoomed through quickly) so the fuller one stays around to borrow from.
    while (this.byScale.size > 2) {
      let victim = null;
      for (const [k, m] of this.byScale) {
        if (m === this.current) continue;
        if (victim === null || m.size < this.byScale.get(victim).size) victim = k;
      }
      this.byScale.delete(victim);
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

  /** Remove sprites whose key matches a test (e.g. last season's ground). */
  invalidateWhere(test) {
    for (const m of this.byScale.values()) {
      for (const k of [...m.keys()]) if (test(k)) m.delete(k);
    }
  }

  /** The same art from the other kept zoom level, or null. */
  borrow(key) {
    let best = null;
    for (const m of this.byScale.values()) {
      if (m === this.current) continue;
      const spr = m.get(key);
      if (spr && (!best || spr.s > best.s)) best = spr; // prefer the sharper copy
    }
    return best;
  }

  /**
   * Get (or render) a sprite.
   * @param {string} key unique id for this art at any scale
   * @param {() => {w:number,h:number,ax:number,ay:number,draw:(ctx:CanvasRenderingContext2D)=>void}} specFn
   * @returns {{canvas:HTMLCanvasElement, ax:number, ay:number, w:number, h:number, s:number}}
   */
  get(key, specFn, fallback = null) {
    let spr = this.current.get(key);
    if (fallback !== null) {
      // A look change in progress: draw the old look wherever it exists and
      // only prepare the new sprite, within the budget (see the header).
      const old = this.current.get(fallback) || this.borrow(fallback);
      if (old) {
        if (!spr && this.spentMs <= this.budgetMs) spr = this.make(key, specFn);
        if (!spr) this.pending++;
        return old;
      }
    }
    if (spr) return spr;
    if (this.spentMs > this.budgetMs) {
      const alt = this.borrow(key);
      if (alt) {
        this.borrowed++;
        return alt;
      }
    }
    return this.make(key, specFn);
  }

  /** Render a sprite now and cache it (the time counts toward the budget). */
  make(key, specFn) {
    const t0 = now();
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
    const spr = { canvas, ax: Math.round(spec.ax * s), ay: Math.round(spec.ay * s), w: cw, h: ch, s };
    this.current.set(key, spr);
    this.created++;
    this.spentMs += now() - t0;
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

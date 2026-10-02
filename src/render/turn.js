/**
 * turn.js
 * ----------------------------------------------------------------------------
 * Turned art: any building drawn turned by 0, 90, 180 or 270 degrees, as a
 * pure function of its art and a turn 0..3 (a building's `b.turn`, and later
 * the view's own turn added to it).
 *
 * Every piece of building art is written for one facing (turn 0): it draws in
 * footprint coordinates (u, v) through draw.js P(), back (small u + v) first.
 * Turning it takes two steps:
 *
 *  1. Coordinates. While a turned sprite is drawn, P() and the primitives
 *     built on it (box, roofs, windows, doors, columns, trees) turn (u, v)
 *     inside the S x S footprint. Turn 1 is a quarter turn clockwise on the
 *     screen (and on the map, x right and y down): the art's +u edge ends up
 *     on +v. Boxes and roofs stay axis-aligned and draw the faces that face
 *     the viewer after the turn; windows always show on the visible face of
 *     their axis (a wall's windows run all round it), doors stay where they
 *     are and may end up at the back.
 *
 *  2. Painter's order. What was in front may now be behind, so the drawing is
 *     recorded, not painted: every paint call is kept with its state and
 *     path, grouped into units (one primitive, or the direct canvas calls
 *     that follow the P() points they were placed by), each with its box in
 *     turned (u, v, z). The units are then sorted back to front (the usual
 *     isometric rule for boxes that do not overlap: whichever is entirely on
 *     the far side along u, v or below along z goes first; units whose
 *     screen areas do not meet are left alone) and replayed onto the real
 *     canvas. Ties keep the order the art drew them in, so turn 0 replays
 *     exactly as drawn.
 *
 * Direct canvas calls whose height is unknown (a post drawn up from its foot
 * point) count as reaching up indefinitely, so they are never taken to be
 * under anything; raw pixel drawing with no P() point (round buildings drawn
 * about their middle) joins the unit before it.
 * ----------------------------------------------------------------------------
 */

/**
 * The turn being drawn: footprint size S, turn t (0..3), a tile offset
 * (ou, ov) for art drawn in a sub-square of the footprint (a block of four
 * small homes), and the recorder collecting the drawing (null when drawing
 * straight onto a canvas).
 */
export const TS = { S: 1, t: 0, ou: 0, ov: 0, rec: null };

/** (u, v) in an S x S footprint turned t quarter turns clockwise. */
export function turnUV(u, v, S, t) {
  switch (t & 3) {
    case 1: return [S - v, u];
    case 2: return [S - u, S - v];
    case 3: return [v, S - u];
    default: return [u, v];
  }
}

/** Where a direction (du, dv) points after t quarter turns. */
export function turnDir(du, dv, t) {
  switch (t & 3) {
    case 1: return [-dv, du];
    case 2: return [-du, -dv];
    case 3: return [dv, -du];
    default: return [du, dv];
  }
}

/** A rectangle u0..u0+du, v0..v0+dv of an S x S footprint turned t times: [u0, v0, du, dv]. */
export function turnedRect(u0, v0, du, dv, S, t) {
  const a = turnUV(u0, v0, S, t);
  const b = turnUV(u0 + du, v0 + dv, S, t);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])];
}

/** A rectangle of the current drawing, turned (with the sub-square offset). */
export function turnRectNow(u0, v0, du, dv) {
  return turnedRect(u0 + TS.ou, v0 + TS.ov, du, dv, TS.S, TS.t);
}

/** A point of the current drawing, turned (with the sub-square offset). */
export function turnPointNow(u, v) {
  return turnUV(u + TS.ou, v + TS.ov, TS.S, TS.t);
}

/** Is the current drawing turned or offset (so coordinates must be mapped)? */
export function mapping() {
  return TS.t !== 0 || TS.ou !== 0 || TS.ov !== 0;
}

/**
 * Draw `fn(ctx)` turned `t` quarter turns in an S x S footprint. With t = 0
 * and no recorder wanted it simply draws. `opts.record` forces the recorded
 * path even at turn 0 (tests count units that way). Returns the recorder's
 * stats when it recorded.
 */
export function drawTurned(ctx, S, t, fn, opts = {}) {
  t &= 3;
  const prev = { ...TS };
  if (!t && !opts.record && !turnCheck.record) {
    TS.S = S; TS.t = 0; TS.ou = 0; TS.ov = 0; TS.rec = null;
    try { fn(ctx); } finally { Object.assign(TS, prev); }
    return null;
  }
  const rec = new TurnRecorder(ctx);
  TS.S = S; TS.t = t; TS.ou = 0; TS.ov = 0; TS.rec = rec;
  try {
    fn(rec.proxy);
  } finally {
    Object.assign(TS, prev);
  }
  const stats = rec.replay(ctx);
  turnCheck.last = stats;
  return stats;
}

/**
 * Live details drawn over a building's sprite every frame (a warehouse's
 * crates, a granary's sacks), turned with it. `base(ctx)` draws again the
 * parts of the building that could stand in front of them (an office, the
 * granary itself) and `items(ctx)` the details; all are sorted together and
 * painted from the first detail on, so a part of the building in front of a
 * detail covers it again while the parts behind (already in the sprite) are
 * not drawn twice. At turn 0 the details are simply drawn.
 */
export function drawTurnedOver(ctx, S, t, base, items) {
  t &= 3;
  if (!t) return drawTurned(ctx, S, 0, items);
  const rec = new TurnRecorder(ctx);
  const prev = { ...TS };
  TS.S = S; TS.t = t; TS.ou = 0; TS.ov = 0; TS.rec = rec;
  try {
    base(rec.proxy);
    rec.baseUnits = rec.units.length;
    items(rec.proxy);
  } finally {
    Object.assign(TS, prev);
  }
  return rec.replay(ctx, true);
}

/**
 * Points of the current drawing turned the way `t` turns an S x S footprint,
 * with no recorder: for live details placed by footprint points (a fire on
 * an altar, sparks from a door), which have nothing to sort against.
 */
export function asTurned(S, t, fn) {
  const prev = { ...TS };
  TS.S = S; TS.t = t & 3; TS.ou = 0; TS.ov = 0; TS.rec = null;
  try { return fn(); } finally { Object.assign(TS, prev); }
}

/**
 * For tests and the art sheet: `record` true sends turn 0 through the
 * recorder as well, and `last` keeps the stats of the last recorded drawing.
 */
export const turnCheck = { record: false, last: null };

/**
 * Draw `fn()` with the art's (u, v) offset by (ou, ov) tiles inside the
 * footprint (a home of a 2x2 block drawn as if it were a 1x1 home).
 */
export function withOrigin(ou, ov, fn) {
  const a = TS.ou;
  const b = TS.ov;
  TS.ou = a + ou;
  TS.ov = b + ov;
  try { fn(); } finally { TS.ou = a; TS.ov = b; }
}

/**
 * Run `fn` as one unit of the recording, with its box [u0, u1, v0, v1, z0, z1]
 * in turned coordinates (no-op wrapper when nothing is recorded). Its
 * paint calls stay together in the order drawn.
 */
export function unit(bounds, fn, n = null) {
  const rec = TS.rec;
  if (!rec) return fn();
  rec.begin(bounds, n);
  try { return fn(); } finally { rec.end(); }
}

/**
 * Run `fn` as one unit drawn on a face whose outward side is (nu, nv) as
 * the art is written (a pediment on a gable, a sign on a wall): its bounds
 * are the P() points it draws through. Turned to face away, it goes behind
 * whatever it touches (the roof, the wall), so it is hidden as it should be.
 */
export function decal(nu, nv, fn) {
  const rec = TS.rec;
  if (!rec) return fn();
  return unit('auto', fn, turnDir(nu, nv, TS.t));
}

/** Run `fn` with turning switched off (the caller has already turned its coordinates). */
export function straight(fn) {
  const t = TS.t;
  const ou = TS.ou;
  const ov = TS.ov;
  TS.t = 0; TS.ou = 0; TS.ov = 0;
  try { return fn(); } finally { TS.t = t; TS.ou = ou; TS.ov = ov; }
}

/** Bounds [u0, u1, v0, v1, z0, z1] of points tagged by P() (null if any is untagged). */
export function boundsOfPoints(pts) {
  let u0 = Infinity; let u1 = -Infinity; let v0 = Infinity; let v1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
  for (const p of pts) {
    if (p.tu === undefined) return null;
    if (p.tu < u0) u0 = p.tu;
    if (p.tu > u1) u1 = p.tu;
    if (p.tv < v0) v0 = p.tv;
    if (p.tv > v1) v1 = p.tv;
    if (p.tz < z0) z0 = p.tz;
    if (p.tz > z1) z1 = p.tz;
  }
  return pts.length ? [u0, u1, v0, v1, z0, z1] : null;
}

/**
 * The outward side (turned du, dv) of a flat vertical face (one u or one v,
 * rising in z: bounds `b` in turned coordinates), or null. Art written for
 * turn 0 only paints what looks at the viewer, so as written such a face
 * looks along +u or +v; after the turn it may look away.
 */
export function faceNormal(b) {
  if (!b || !(b[5] - b[4] > 0.5) || b[5] === Infinity) return null;
  const flatU = b[1] - b[0] < 1e-6;
  const flatV = b[3] - b[2] < 1e-6;
  if (flatU === flatV) return null;
  // (Flat along the turned u axis: as written it was flat along u, or along
  // v for an odd turn; its outward side as written is + along that axis.)
  const alongU = flatU !== (TS.t % 2 === 1);
  return alongU ? turnDir(1, 0, TS.t) : turnDir(0, 1, TS.t);
}

/**
 * Two units neither clear of the other: if one is a face (it knows which
 * way it looks), whatever is on its outer side is in front of it when it
 * looks at the viewer and behind it when it looks away (a pediment turned
 * to the back goes under its roof; rails beyond a hillside turned away go
 * behind the hill). Otherwise they keep the order they were drawn in (a
 * chimney through its roof). @returns the index to draw first
 */
function byFace(A, B, i, j) {
  const face = A.n ? A : B.n ? B : null;
  if (!face) return i;
  const other = face === A ? B : A;
  const mid = (b) => [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2];
  const [fu, fv] = mid(face.b);
  const [ou, ov] = mid(other.b);
  const side = (ou - fu) * face.n[0] + (ov - fv) * face.n[1];
  if (Math.abs(side) < 1e-6) return i;
  const toward = face.n[0] + face.n[1] > 0;
  const faceFirst = (side > 0) === toward;
  return faceFirst === (face === A) ? i : j;
}

// ---------------------------------------------------------------------------
// The recorder
// ---------------------------------------------------------------------------

/** Canvas state kept with every recorded paint call. */
const STATE_KEYS = ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'miterLimit', 'globalAlpha',
  'globalCompositeOperation', 'font', 'textAlign', 'textBaseline', 'lineDashOffset'];
const STATE_DEFAULTS = {
  fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, globalAlpha: 1,
  globalCompositeOperation: 'source-over', font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', lineDashOffset: 0,
};
/** Path building calls, with which of their arguments are x and y (translated as recorded). */
const PATH_XY = {
  moveTo: [0, 1], lineTo: [0, 1], arc: [0, 1], ellipse: [0, 1], rect: [0, 1],
  quadraticCurveTo: [0, 1, 2, 3], bezierCurveTo: [0, 1, 2, 3, 4, 5], arcTo: [0, 1, 2, 3],
};
/** Paint calls that use the current path. */
const PATH_PAINT = new Set(['fill', 'stroke']);
/** Paint calls with their own rectangle or position (x, y first, or after the text/image). */
const RECT_PAINT = { fillRect: 0, strokeRect: 0, clearRect: 0, fillText: 1, strokeText: 1 };

/** Allowed nudge (tiles, px of height) when boxes only touch. */
const EPS = 1e-6;

export class TurnRecorder {
  constructor(target) {
    this.target = target;
    this.units = [];
    this.pending = []; // points from P() since the last paint call (fallback bounds)
    this.saved = [];
    this.depth = 0;
    this.open = null;
    this.last = null;
    this.paints = 0;
    this.st = {};
    for (const k of STATE_KEYS) {
      const v = target ? target[k] : undefined;
      this.st[k] = typeof v === 'string' || typeof v === 'number' ? v : STATE_DEFAULTS[k];
    }
    this.dash = [];
    this.stack = [];
    this.tx = 0;
    this.ty = 0;
    this.path = [];
    this.proxy = this.makeProxy();
  }

  /** A point placed by P(): it bounds the next direct paint call. */
  point(p) {
    if (!this.depth) this.pending.push(p);
    else if (this.open.auto) this.open.auto.push(p);
  }

  /** Points that belong to a primitive's own unit no longer bound direct calls. */
  forget(pts) {
    if (!this.pending.length) return;
    const own = new Set(pts);
    this.pending = this.pending.filter((p) => !own.has(p));
  }

  begin(bounds, n = null) {
    if (this.depth++ > 0) return;
    this.saved = this.pending;
    this.pending = [];
    const auto = bounds === 'auto' ? [] : null;
    this.open = { b: auto ? null : bounds, auto, n, ops: [], idx: this.units.length };
    this.units.push(this.open);
  }

  end() {
    if (--this.depth > 0) return;
    if (this.open.auto) {
      this.open.b = boundsOfPoints(this.open.auto);
      this.open.auto = null;
    }
    this.pending = this.saved;
    this.saved = [];
    if (this.open.ops.length) this.last = this.open;
    this.open = null;
  }

  /** The unit a paint call joins. */
  unitFor() {
    if (this.depth) return this.open;
    if (this.pending.length) {
      const b = boundsOfPoints(this.pending);
      // Lines and marks drawn through points on one wall (an inscription)
      // are on that wall; otherwise the height is unknown (a post drawn up
      // from its foot), so it is never taken to be under anything.
      const n = faceNormal(b);
      if (b && !n) b[5] = Math.max(b[5], b[4] + 12);
      const u = { b, n, ops: [], idx: this.units.length };
      this.units.push(u);
      this.pending = [];
      return u;
    }
    if (this.last) return this.last;
    const u = { b: null, ops: [], idx: this.units.length };
    this.units.push(u);
    return u;
  }

  paint(kind, args) {
    const op = { kind, args, st: { ...this.st }, dash: this.dash, path: PATH_PAINT.has(kind) ? this.path.slice() : null };
    const u = this.unitFor();
    u.ops.push(op);
    this.last = u;
    this.paints++;
  }

  makeProxy() {
    const rec = this;
    const methods = {
      beginPath() { rec.path = []; },
      closePath() { rec.path.push(['closePath']); },
      save() { rec.stack.push([{ ...rec.st }, rec.dash, rec.tx, rec.ty]); },
      restore() {
        const s = rec.stack.pop();
        if (s) [rec.st, rec.dash, rec.tx, rec.ty] = s;
      },
      translate(x, y) { rec.tx += x; rec.ty += y; },
      setLineDash(d) { rec.dash = [...d]; },
      getLineDash() { return [...rec.dash]; },
      measureText(text) {
        const t = rec.target;
        if (t && typeof t.measureText === 'function') {
          t.save?.();
          t.font = rec.st.font;
          const m = t.measureText(text);
          t.restore?.();
          return m;
        }
        return { width: String(text).length * 5 };
      },
      createLinearGradient(...a) { return rec.target.createLinearGradient(...a); },
      createRadialGradient(...a) { return rec.target.createRadialGradient(...a); },
      createPattern(...a) { return rec.target.createPattern(...a); },
    };
    for (const k of Object.keys(PATH_XY)) {
      const xy = PATH_XY[k];
      methods[k] = (...a) => {
        for (let i = 0; i < xy.length; i++) a[xy[i]] += i % 2 ? rec.ty : rec.tx;
        rec.path.push([k, ...a]);
      };
    }
    for (const k of PATH_PAINT) methods[k] = (...a) => rec.paint(k, a);
    for (const [k, at] of Object.entries(RECT_PAINT)) {
      methods[k] = (...a) => {
        a[at] += rec.tx;
        a[at + 1] += rec.ty;
        rec.paint(k, a);
      };
    }
    for (const k of ['scale', 'rotate', 'transform', 'setTransform', 'resetTransform', 'clip', 'drawImage', 'putImageData', 'getImageData']) {
      methods[k] = () => { throw new Error(`turned art: ctx.${k}() is not supported while recording`); };
    }
    return new Proxy(rec, {
      get(r, k) {
        if (k in methods) return methods[k];
        if (k in r.st) return r.st[k];
        const t = r.target;
        if (t == null) return undefined;
        const v = t[k];
        return typeof v === 'function' ? v.bind(t) : v; // __lights, canvas...
      },
      set(r, k, v) {
        if (k in r.st) r.st[k] = v;
        else if (r.target) r.target[k] = v;
        return true;
      },
    });
  }

  /** Paint the recording onto `ctx`, back to front. @returns stats for tests */
  replay(ctx, overOnly = false) {
    const units = this.units.filter((u) => u.ops.length);
    const boxes = units.map(screenBox);
    let order = sortUnits(units, boxes);
    if (overOnly) {
      // drawTurnedOver: from the first detail on (see there).
      const first = order.findIndex((u) => u.idx >= this.baseUnits);
      order = first < 0 ? [] : order.slice(first);
    }
    ctx.save?.();
    try {
      const applied = {};
      for (const u of order) {
        for (const op of u.ops) {
          for (const k of STATE_KEYS) {
            const v = op.st[k];
            if (applied[k] !== v) { ctx[k] = v; applied[k] = v; }
          }
          if (ctx.setLineDash && (op.dash.length || applied.dash)) { ctx.setLineDash(op.dash); applied.dash = op.dash.length > 0; }
          if (op.path) {
            ctx.beginPath();
            for (const [m, ...a] of op.path) ctx[m](...a);
          }
          ctx[op.kind](...op.args);
        }
      }
    } finally {
      ctx.restore?.();
    }
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const b of boxes) {
      if (!b) continue;
      x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
    }
    return { units: this.units.length, paints: this.paints, bbox: [x0, y0, x1, y1], order: order.map((u) => u.idx) };
  }
}

/** Screen box [x0, y0, x1, y1] of everything a unit paints (strokes padded by their width). */
function screenBox(u) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  const add = (x, y, r = 0) => {
    if (x - r < x0) x0 = x - r;
    if (y - r < y0) y0 = y - r;
    if (x + r > x1) x1 = x + r;
    if (y + r > y1) y1 = y + r;
  };
  for (const op of u.ops) {
    const pad = op.kind === 'stroke' || op.kind === 'strokeRect' ? (op.st.lineWidth || 1) / 2 : 0;
    if (op.path) {
      for (const [m, ...a] of op.path) {
        if (m === 'closePath') continue;
        if (m === 'arc') add(a[0], a[1], a[2] + pad);
        else if (m === 'ellipse') add(a[0], a[1], Math.max(a[2], a[3]) + pad);
        else if (m === 'rect') { add(a[0], a[1], pad); add(a[0] + a[2], a[1] + a[3], pad); } else {
          for (let i = 0; i + 1 < a.length; i += 2) add(a[i], a[i + 1], pad);
        }
      }
    } else if (op.kind === 'fillText' || op.kind === 'strokeText') {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(op.st.font)?.[1] || 10);
      const w = String(op.args[0]).length * size * 0.6;
      const left = op.st.textAlign === 'center' ? w / 2 : op.st.textAlign === 'right' || op.st.textAlign === 'end' ? w : 0;
      add(op.args[1] - left, op.args[2] - size);
      add(op.args[1] - left + w, op.args[2] + size * 0.3);
    } else {
      const [x, y, w, h] = op.args;
      add(Math.min(x, x + w), Math.min(y, y + h), pad);
      add(Math.max(x, x + w), Math.max(y, y + h), pad);
    }
  }
  return x0 <= x1 ? [x0, y0, x1, y1] : null;
}

/** Is A entirely on the far side of B (or below it), so A is painted first? */
function behind(A, B) {
  return (A[1] <= B[0] + EPS && B[1] > A[0] + EPS)
    || (A[3] <= B[2] + EPS && B[3] > A[2] + EPS)
    || (A[5] <= B[4] + EPS && B[5] > A[4] + EPS);
}

/**
 * Back-to-front order of the units: a topological sort of "A goes before
 * B" for every pair whose screen boxes meet and whose boxes say so one way
 * only, taking the earliest-drawn unit whenever there is a choice (so art
 * already in order keeps its order) and breaking any cycle the same way.
 */
export function sortUnits(units, boxes) {
  const n = units.length;
  const succ = Array.from({ length: n }, () => []);
  const indeg = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const A = units[i].b;
    const sa = boxes[i];
    if (!A || !sa) continue;
    for (let j = i + 1; j < n; j++) {
      const B = units[j].b;
      const sb = boxes[j];
      if (!B || !sb) continue;
      if (sa[2] <= sb[0] || sb[2] <= sa[0] || sa[3] <= sb[1] || sb[3] <= sa[1]) continue; // apart on screen
      const ab = behind(A, B);
      const ba = behind(B, A);
      // Neither side clear of the other (a chimney through its roof, a sign
      // on its wall): they keep the order they were drawn in.
      const first = ab && !ba ? i : ba && !ab ? j : ab && ba ? -1 : byFace(units[i], units[j], i, j);
      if (first === i) { succ[i].push(j); indeg[j]++; } else if (first === j) { succ[j].push(i); indeg[i]++; }
    }
  }
  const out = [];
  const done = new Uint8Array(n);
  const heap = [];
  const push = (x) => {
    heap.push(x);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p] <= heap[k]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l] < heap[m]) m = l;
        if (r < heap.length && heap[r] < heap[m]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  for (let i = 0; i < n; i++) if (!indeg[i]) push(i);
  let next = 0; // lowest index not yet emitted (to break cycles)
  while (out.length < n) {
    let i;
    if (heap.length) i = pop();
    else {
      while (done[next]) next++;
      i = next; // a cycle: take the earliest drawn
    }
    if (done[i]) continue;
    done[i] = 1;
    out.push(units[i]);
    for (const j of succ[i]) if (--indeg[j] === 0 && !done[j]) push(j);
  }
  return out;
}

/**
 * draw.js
 * ----------------------------------------------------------------------------
 * A small isometric drawing kit used by all procedural art.
 *
 * All art functions draw in LOCAL world pixels with the origin at the TOP
 * corner of the footprint diamond (sprites.js sets up the transform).
 * Local footprint coordinates (u, v) go from 0..S tiles; z is height in px.
 *
 *     P(u, v, z) -> [(u - v) * 32, (u + v) * 16 - z]
 *
 * Visible faces of a box: the "left" face runs along +v (lower-left on
 * screen), the "right" face along +u (lower-right). Light comes from the
 * upper-left, so tops are brightest, left faces medium, right faces darkest.
 * ----------------------------------------------------------------------------
 */

import { HALF_W, HALF_H } from '../config.js';

/** Lit snow and the blue-grey of snow in shade. */
export const SNOW = '#eef2f5';
export const SNOW_SHADE = '#c6d1db';

/**
 * Snow on roofs (0..1) for everything drawn until it is reset: buildingArt
 * sets it while it draws a building sprite, so every gable and hip roof
 * gets a white cap without each building's art knowing about snow.
 */
let roofSnow = 0;
export function setRoofSnow(s) { roofSnow = s || 0; }
/** Snow on the building being drawn (0 outside buildingArt): flat roofs, lawns and fields read it. */
export function roofSnowAmount() { return roofSnow; }

/** Point part way from p to q. */
const lerp2 = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

/**
 * White cap on a roof slope: the band from the ridge edge (r0-r1) down
 * toward the eave edge (e0-e1); deeper snow reaches further down.
 */
function slopeSnow(ctx, r0, r1, e1, e0, color) {
  const f = Math.min(1, 0.2 + roofSnow * 0.95);
  poly(ctx, [r0, r1, lerp2(r1, e1, f), lerp2(r0, e0, f)], color);
}

/** Local iso point. */
export function P(u, v, z = 0) {
  return [(u - v) * HALF_W, (u + v) * HALF_H - z];
}

/** Parse "#rrggbb" into [r, g, b]. */
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Lighten (amt > 0) or darken (amt < 0) a hex color. amt in -1..1 */
export function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const f = (c) => {
    const v = amt >= 0 ? c + (255 - c) * amt : c * (1 + amt);
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  return `#${((1 << 24) | (f(r) << 16) | (f(g) << 8) | f(b)).toString(16).slice(1)}`;
}

/** Blend two hex colors, t = 0 -> a, 1 -> b */
export function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `#${((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1)}`;
}

/** Fill (and optionally stroke) a polygon given as [x, y] pairs. */
export function poly(ctx, pts, fill, stroke = null, lw = 1) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

/** Diamond covering footprint area (u0,v0)-(u1,v1) at height z. */
export function quad(ctx, u0, v0, u1, v1, z, fill, stroke = null) {
  poly(ctx, [P(u0, v0, z), P(u1, v0, z), P(u1, v1, z), P(u0, v1, z)], fill, stroke);
}

/** Footprint ground plate (paving, soil...). */
export function ground(ctx, S, fill, inset = 0.04, stroke = null) {
  quad(ctx, inset, inset, S - inset, S - inset, 0, fill, stroke);
}

/**
 * Axis-aligned box.
 * @param {number} u0,v0 footprint corner (tiles)
 * @param {number} du,dv footprint size (tiles)
 * @param {number} z0    base height (px)
 * @param {number} h     box height (px)
 * @param {string} color base wall color; faces are shaded from it
 * @param {object} [o]   { top, left, right, stroke, plain }
 *
 * Walls get a little surface detail for free (sprites are drawn once and
 * cached): faint flecks in the plaster or stone, and a soft contact shadow
 * where a wall meets the ground. `plain: true` skips both.
 */
export function box(ctx, u0, v0, du, dv, z0, h, color, o = {}) {
  const u1 = u0 + du;
  const v1 = v0 + dv;
  const top = o.top ?? shade(color, 0.18);
  const left = o.left ?? color;
  const right = o.right ?? shade(color, -0.2);
  const st = o.stroke === undefined ? shade(color, -0.45) : o.stroke;
  // left face (+v side)
  poly(ctx, [P(u0, v1, z0), P(u1, v1, z0), P(u1, v1, z0 + h), P(u0, v1, z0 + h)], left, st, 0.6);
  // right face (+u side)
  poly(ctx, [P(u1, v0, z0), P(u1, v1, z0), P(u1, v1, z0 + h), P(u1, v0, z0 + h)], right, st, 0.6);
  if (!o.plain && h >= 4) wallDetail(ctx, u0, v0, u1, v1, z0, h, left, right);
  // top
  if (o.noTop) return;
  poly(ctx, [P(u0, v0, z0 + h), P(u1, v0, z0 + h), P(u1, v1, z0 + h), P(u0, v1, z0 + h)], top, st, 0.6);
}

/** Flecks on both visible wall faces, and ambient-occlusion bands at ground level. */
function wallDetail(ctx, u0, v0, u1, v1, z0, h, left, right) {
  const seed = Math.round(u0 * 97 + v0 * 61 + z0 * 7 + h * 13);
  const faces = [
    [(t, z) => P(u0 + (u1 - u0) * t, v1, z), left, u1 - u0],
    [(t, z) => P(u1, v0 + (v1 - v0) * t, z), right, v1 - v0],
  ];
  for (let f = 0; f < 2; f++) {
    const [at, col, len] = faces[f];
    if (h >= 6) {
      const n = Math.min(26, Math.round(len * h * 0.4));
      for (let k = 0; k < n; k++) {
        const [x, y] = at(0.05 + hash01(seed, k, f * 2 + 1) * 0.9, z0 + 1.5 + hash01(seed, k, f * 2 + 2) * (h - 3));
        ctx.fillStyle = shade(col, k % 2 ? 0.07 : -0.08);
        ctx.fillRect(x - 0.8, y - 0.4, 1.6, 0.8);
      }
    }
    if (z0 === 0) {
      // Darker toward the ground: three overlapping bands make a soft gradient.
      for (const [zz, a] of [[1.2, 0.15], [2.6, 0.08], [4.2, 0.04]]) {
        poly(ctx, [at(0, 0), at(1, 0), at(1, Math.min(zz, h)), at(0, Math.min(zz, h))], `rgba(0,0,0,${a})`);
      }
    }
  }
}

/**
 * The shadow a roof's overhang casts on the walls just below it (u0..u1,
 * v0..v1 are the wall box under the roof). Skipped for roofs on the ground.
 */
function eaveShadow(ctx, u0, v0, u1, v1, z) {
  if (z < 4) return;
  const band = Math.min(3, z * 0.3);
  const c = 'rgba(0,0,0,0.14)';
  poly(ctx, [P(u0, v1, z), P(u1, v1, z), P(u1, v1, z - band), P(u0, v1, z - band)], c);
  poly(ctx, [P(u1, v0, z), P(u1, v1, z), P(u1, v1, z - band), P(u1, v0, z - band)], c);
}

/**
 * Gable roof on top of a box footprint.
 * axis 'u': ridge runs along u (gable ends face +u / -u)
 * axis 'v': ridge runs along v
 */
export function gableRoof(ctx, u0, v0, du, dv, z, rh, color, axis = 'u', overhang = 0.06) {
  const a = u0 - overhang;
  const b = v0 - overhang;
  const c = u0 + du + overhang;
  const d = v0 + dv + overhang;
  const st = shade(color, -0.5);
  eaveShadow(ctx, u0, v0, u0 + du, v0 + dv, z);
  if (axis === 'u') {
    const vm = (b + d) / 2;
    // back slope (partly visible from the ridge)
    poly(ctx, [P(a, b, z), P(c, b, z), P(c, vm, z + rh), P(a, vm, z + rh)], shade(color, 0.15), st, 0.6);
    // front slope (faces +v, the viewer's lower-left)
    poly(ctx, [P(a, vm, z + rh), P(c, vm, z + rh), P(c, d, z), P(a, d, z)], color, st, 0.6);
    // gable triangle on the +u end
    poly(ctx, [P(c, b, z), P(c, d, z), P(c, vm, z + rh)], shade(color, -0.25), st, 0.6);
    tileLines(ctx, a, vm, c, d, z, rh, 'u', shade(color, -0.18));
    ridge(ctx, P(a, vm, z + rh), P(c, vm, z + rh), color);
    if (roofSnow > 0) {
      // (The back slope only when it faces the viewer; steeper, it hides behind the ridge.)
      if (rh < 32 * (vm - b)) slopeSnow(ctx, P(a, vm, z + rh), P(c, vm, z + rh), P(c, b, z), P(a, b, z), SNOW);
      slopeSnow(ctx, P(a, vm, z + rh), P(c, vm, z + rh), P(c, d, z), P(a, d, z), '#e2e9ef');
    }
  } else {
    const um = (a + c) / 2;
    poly(ctx, [P(a, b, z), P(um, b, z + rh), P(um, d, z + rh), P(a, d, z)], shade(color, 0.12), st, 0.6);
    poly(ctx, [P(um, b, z + rh), P(c, b, z), P(c, d, z), P(um, d, z + rh)], shade(color, -0.2), st, 0.6);
    poly(ctx, [P(a, d, z), P(c, d, z), P(um, d, z + rh)], shade(color, -0.05), st, 0.6);
    tileLines(ctx, um, b, c, d, z, rh, 'v', shade(color, -0.35));
    tileLines(ctx, a, b, um, d, z, rh, 'v-', shade(color, -0.12));
    ridge(ctx, P(um, b, z + rh), P(um, d, z + rh), color);
    if (roofSnow > 0) {
      if (rh < 32 * (um - a)) slopeSnow(ctx, P(um, b, z + rh), P(um, d, z + rh), P(a, d, z), P(a, b, z), SNOW);
      slopeSnow(ctx, P(um, b, z + rh), P(um, d, z + rh), P(c, d, z), P(c, b, z), SNOW_SHADE);
    }
  }
}

/** A light line along a roof ridge (catches the sun). */
function ridge(ctx, p, q, color) {
  ctx.strokeStyle = shade(color, 0.3);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  ctx.lineTo(q[0], q[1]);
  ctx.stroke();
}

/**
 * Roof tile texture on one slope: rows of tiles across the slope, and the
 * ribs of curved tiles running down it. The slope spans u0..u1 x v0..v1 and
 * falls from z + rh at the ridge side to z at the eave:
 *   'u'  ridge at v0, eave at v1     'v'  ridge at u0, eave at u1
 *   'v-' ridge at u1, eave at u0 (the back-left slope of a v-axis roof)
 */
function tileLines(ctx, u0, v0, u1, v1, z, rh, axis, color) {
  const rows = Math.max(3, Math.round(rh / 2.2));
  // point on the slope: s = across (0..1), t = down from the ridge (0..1)
  const at = (s, t) => {
    const zz = z + rh * (1 - t);
    if (axis === 'u') return P(u0 + (u1 - u0) * s, v0 + (v1 - v0) * t, zz);
    if (axis === 'v') return P(u0 + (u1 - u0) * t, v0 + (v1 - v0) * s, zz);
    return P(u1 - (u1 - u0) * t, v0 + (v1 - v0) * s, zz);
  };
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let k = 1; k < rows; k++) {
    const p = at(0, k / rows);
    const q = at(1, k / rows);
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
  }
  ctx.stroke();
  // ribs, fainter
  const across = axis === 'u' ? u1 - u0 : v1 - v0;
  const ribs = Math.max(2, Math.round(across / 0.13));
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  for (let k = 1; k < ribs; k++) {
    const p = at(k / ribs, 0.04);
    const q = at(k / ribs, 1);
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Four-sided pyramid (hip) roof. */
export function hipRoof(ctx, u0, v0, du, dv, z, rh, color, overhang = 0.06) {
  const a = u0 - overhang;
  const b = v0 - overhang;
  const c = u0 + du + overhang;
  const d = v0 + dv + overhang;
  const inset = Math.min(du, dv) * 0.5 + overhang;
  const st = shade(color, -0.5);
  eaveShadow(ctx, u0, v0, u0 + du, v0 + dv, z);
  const r1 = [a + inset, b + inset];
  const r2 = [c - inset, d - inset];
  const top1 = P(r1[0], r1[1], z + rh);
  const top2 = P(Math.max(r1[0], r2[0]), Math.max(r1[1], r2[1]), z + rh);
  poly(ctx, [P(a, b, z), P(c, b, z), top2, top1], shade(color, 0.15), st, 0.6);
  poly(ctx, [P(a, b, z), top1, P(a, d, z)], shade(color, 0.08), st, 0.6);
  poly(ctx, [P(c, b, z), P(c, d, z), top2], shade(color, -0.22), st, 0.6);
  poly(ctx, [P(a, d, z), top1, top2, P(c, d, z)], color, st, 0.6);
  // tile rows on the front slope, parallel to its eave
  const rows = Math.max(2, Math.round(rh / 2.4));
  ctx.strokeStyle = shade(color, -0.18);
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let k = 1; k < rows; k++) {
    const t = k / rows;
    const lerp = (p, q) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const p = lerp(P(a, d, z), top1);
    const q = lerp(P(c, d, z), top2);
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
  }
  ctx.stroke();
  if (roofSnow > 0) {
    if (rh < 32 * inset) {
      slopeSnow(ctx, top1, top2, P(c, b, z), P(a, b, z), SNOW);
      slopeSnow(ctx, top1, top1, P(a, d, z), P(a, b, z), SNOW);
    }
    slopeSnow(ctx, top2, top2, P(c, d, z), P(c, b, z), SNOW_SHADE);
    slopeSnow(ctx, top1, top2, P(c, d, z), P(a, d, z), '#e2e9ef');
  }
}

/** A column (cylinder-ish) standing at local (u, v). */
export function column(ctx, u, v, z0, h, color = '#f1ede3', r = 2.2) {
  const [x, y] = P(u, v, z0);
  ctx.fillStyle = shade(color, -0.12);
  ctx.fillRect(x - r, y - h, r * 2, h);
  ctx.fillStyle = shade(color, 0.12);
  ctx.fillRect(x - r, y - h, r * 0.9, h);
  // capital + base
  ctx.fillStyle = color;
  ctx.fillRect(x - r - 1, y - h - 1.5, r * 2 + 2, 2);
  ctx.fillRect(x - r - 0.8, y - 1.5, r * 2 + 1.6, 1.5);
}

/**
 * Light recording (used by lighting.js): when art is drawn into a
 * `recordingContext()`, windows() and door() also note where each opening is,
 * so night lights line up with the painted windows without a second list of
 * positions to keep in sync. Normal sprite drawing ignores all of this.
 */
function record(ctx, kind, pts) {
  const rec = ctx.__lights;
  if (!rec) return;
  let x = 0;
  let y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  const n = pts.length;
  rec.push({ kind, x: x / n + ctx.__ox, y: y / n + ctx.__oy, w: Math.abs(pts[1][0] - pts[0][0]) || 2, h: Math.abs(pts[2][1] - pts[1][1]) || 3 });
}

/**
 * A stand-in 2D context that draws nothing but records windows/doors (and
 * follows translate/save/restore so art drawn at an offset lands right).
 * @returns {{ctx: object, lights: Array<{kind:string,x:number,y:number,w:number,h:number}>}}
 */
export function recordingContext() {
  const lights = [];
  const stack = [];
  const noop = () => rec; // every other method: do nothing, allow chaining
  const target = {
    __lights: lights,
    __ox: 0,
    __oy: 0,
    save() { stack.push([target.__ox, target.__oy]); },
    restore() { const p = stack.pop(); if (p) [target.__ox, target.__oy] = p; },
    translate(x, y) { target.__ox += x; target.__oy += y; },
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 0 }),
  };
  const rec = new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : noop),
    set: (t, k, v) => { if (k in t) t[k] = v; return true; },
  });
  return { ctx: rec, lights };
}

/** A row of evenly spaced columns between two footprint points. */
export function colonnade(ctx, u0, v0, u1, v1, count, z0, h, color, r) {
  for (let k = 0; k < count; k++) {
    const t = count === 1 ? 0.5 : k / (count - 1);
    column(ctx, u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, z0, h, color, r);
  }
}

/**
 * Rectangular openings (windows/doors) on a box face.
 * face 'left' is the +v face at v = v1, spanning u0..u1
 * face 'right' is the +u face at u = u1, spanning v0..v1
 * Options: w (tiles), h (px), gap (px between rows), z (first row height),
 * shutters (color: a painted shutter each side), flowers (a flower box below).
 */
export function windows(ctx, face, u0, v0, u1, v1, z0, rows, cols, color = '#3a2f28', o = {}) {
  const ww = o.w ?? 0.12; // width in tiles
  const wh = o.h ?? 5; // height px
  const gap = o.gap ?? 9; // vertical spacing px
  const zStart = o.z ?? z0 + 4;
  // A rectangle on the face: along-face position a..b (tiles), height z..z+hh.
  const rect = (a, b, z, hh) => (face === 'left'
    ? [P(a, v1, z), P(b, v1, z), P(b, v1, z + hh), P(a, v1, z + hh)]
    : [P(u1, a, z), P(u1, b, z), P(u1, b, z + hh), P(u1, a, z + hh)]);
  for (let r = 0; r < rows; r++) {
    const z = zStart + r * gap;
    for (let c = 0; c < cols; c++) {
      const t = (c + 0.5) / cols;
      const m = face === 'left' ? u0 + (u1 - u0) * t : v0 + (v1 - v0) * t;
      const pts = rect(m - ww / 2, m + ww / 2, z, wh);
      poly(ctx, pts, color);
      record(ctx, 'window', pts);
      if (o.shutters) {
        const sw = ww * 0.45;
        poly(ctx, rect(m - ww / 2 - sw, m - ww / 2, z - 0.3, wh + 0.6), o.shutters);
        poly(ctx, rect(m + ww / 2, m + ww / 2 + sw, z - 0.3, wh + 0.6), shade(o.shutters, -0.12));
      }
      if (o.flowers) {
        poly(ctx, rect(m - ww * 0.65, m + ww * 0.65, z - 1.6, 1.4), '#6b4a2a');
        const [fx, fy] = face === 'left' ? P(m, v1, z - 0.2) : P(u1, m, z - 0.2);
        ctx.fillStyle = '#5a8a3a';
        ctx.fillRect(fx - 2, fy - 1.2, 4, 1.2);
        ctx.fillStyle = (c + r) % 2 ? '#d9534f' : '#f0c24a';
        ctx.fillRect(fx - 1.4, fy - 1.8, 1, 1);
        ctx.fillRect(fx + 0.6, fy - 1.6, 1, 1);
      }
    }
  }
}

/** A door on a face, centered at parameter t (0..1). */
export function door(ctx, face, u0, v0, u1, v1, z0, t = 0.5, color = '#4a3222', w = 0.18, h = 8) {
  let pts;
  if (face === 'left') {
    const u = u0 + (u1 - u0) * t;
    pts = [P(u - w / 2, v1, z0), P(u + w / 2, v1, z0), P(u + w / 2, v1, z0 + h), P(u - w / 2, v1, z0 + h)];
  } else {
    const v = v0 + (v1 - v0) * t;
    pts = [P(u1, v - w / 2, z0), P(u1, v + w / 2, z0), P(u1, v + w / 2, z0 + h), P(u1, v - w / 2, z0 + h)];
  }
  poly(ctx, pts, color);
  record(ctx, 'door', pts);
}

/** Soft elliptical shadow on the ground. */
export function shadowEllipse(ctx, u, v, rx, ry, alpha = 0.25) {
  const [x, y] = P(u, v, 0);
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * A round bush/tree crown made of overlapping circles.
 * `sway` (px, about -2..2) leans the crown in the wind: higher leaves move
 * more, the base of the trunk stays put. `blossom` 1 dots the crown with
 * spring flowers. `snow` (0..1) caps each clump with snow; it defaults to
 * the snow of the building being drawn (garden trees), 0 elsewhere.
 */
export function tree(ctx, u, v, size = 1, color = '#3e7a34', trunk = '#6b4a2a', seed = 0, sway = 0, blossom = 0, snow = roofSnow) {
  const [x, y] = P(u, v, 0);
  const s = size;
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(x + 2 * s, y, 7 * s, 3 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = trunk;
  ctx.beginPath();
  ctx.moveTo(x - 1.2 * s, y);
  ctx.lineTo(x + 1.2 * s, y);
  ctx.lineTo(x + 1.2 * s + sway * 0.35, y - 8 * s);
  ctx.lineTo(x - 1.2 * s + sway * 0.35, y - 8 * s);
  ctx.closePath();
  ctx.fill();
  const blobs = [
    [0, -14, 7],
    [-4, -11, 5],
    [4, -11, 5],
    [0, -18, 5],
  ];
  for (let k = 0; k < blobs.length; k++) {
    const [bx, by, br] = blobs[k];
    const jitter = ((seed * 31 + k * 17) % 5) - 2;
    const lean = sway * (-by / 18); // top of the crown moves the most
    ctx.fillStyle = k === 3 ? shade(color, 0.12) : k % 2 ? shade(color, -0.12) : color;
    ctx.beginPath();
    ctx.arc(x + (bx + jitter * 0.4) * s + lean, y + by * s, br * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = shade(color, 0.3);
  ctx.beginPath();
  ctx.arc(x - 2 * s + sway * 0.95, y - 17 * s, 2.2 * s, 0, Math.PI * 2);
  ctx.fill();
  if (snow > 0) {
    // Snow lying on top of each clump of leaves.
    ctx.fillStyle = SNOW;
    ctx.beginPath();
    for (let k = 0; k < blobs.length; k++) {
      const [bx, by, br] = blobs[k];
      const jitter = ((seed * 31 + k * 17) % 5) - 2;
      const lean = sway * (-by / 18);
      const cx = x + (bx + jitter * 0.4) * s + lean;
      const cy = y + (by - br * (0.62 - snow * 0.22)) * s;
      const rx = br * (0.45 + snow * 0.4) * s;
      ctx.moveTo(cx + rx, cy);
      ctx.ellipse(cx, cy, rx, rx * (0.35 + snow * 0.25), 0, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  if (blossom) {
    ctx.fillStyle = seed % 2 ? '#f6dbe4' : '#fbf6ee';
    for (let k = 0; k < 9; k++) {
      const a = hash01(seed, k, 3) * Math.PI * 2;
      const r = hash01(seed, k, 4) * 6.5;
      const by = -14 - Math.sin(a) * r * 0.8;
      ctx.fillRect(x + (Math.cos(a) * r) * s + sway * (-by / 18) - 0.8, y + by * s - 0.8, 1.6, 1.6);
    }
  }
}

/**
 * A leafless (winter) or thinning tree: trunk, a few forked branches and a
 * scatter of the last leaves in `leaves` color. Same footprint as tree().
 * With `snow` the branches carry snow instead of leaves.
 */
export function bareTree(ctx, u, v, size = 1, seed = 0, sway = 0, leaves = '#7b7452', snow = roofSnow) {
  const [x, y] = P(u, v, 0);
  const s = size;
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.beginPath();
  ctx.ellipse(x + 2 * s, y, 6 * s, 2.5 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // A haze of fine twigs gives the bare crown some volume.
  ctx.fillStyle = 'rgba(112,94,72,0.3)';
  ctx.beginPath();
  ctx.ellipse(x + sway * 0.7, y - 16 * s, 7.5 * s, 7 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(112,94,72,0.22)';
  ctx.beginPath();
  ctx.ellipse(x + sway * 0.8 - 1.5 * s, y - 19 * s, 5 * s, 4.5 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6e5842';
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.2 * s;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + sway * 0.3, y - 10 * s);
  ctx.stroke();
  ctx.lineWidth = 1.1 * s;
  ctx.beginPath();
  const tips = [];
  for (let k = 0; k < 5; k++) {
    const side = k % 2 ? 1 : -1;
    const h = 8 + k * 2.2;
    const len = 4 + hash01(seed, k, 5) * 4;
    const bx = x + sway * (h / 22);
    const tx = bx + side * len * s + sway * 0.6;
    const ty = y - (h + len * 0.8) * s;
    ctx.moveTo(bx, y - h * s);
    ctx.lineTo(tx, ty);
    tips.push([tx, ty]);
  }
  ctx.moveTo(x + sway * 0.3, y - 10 * s);
  ctx.lineTo(x + sway * 0.9, y - 22 * s);
  ctx.stroke();
  tips.push([x + sway * 0.9, y - 22 * s]);
  if (snow > 0) {
    // Snow along the upper side of each branch, and clumps at the tips.
    ctx.strokeStyle = SNOW;
    ctx.lineWidth = (0.5 + snow * 0.7) * s;
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const side = k % 2 ? 1 : -1;
      const h = 8 + k * 2.2;
      const len = 4 + hash01(seed, k, 5) * 4;
      const bx = x + sway * (h / 22);
      ctx.moveTo(bx, y - h * s - 0.7 * s);
      ctx.lineTo(bx + side * len * s + sway * 0.6, y - (h + len * 0.8) * s - 0.7 * s);
    }
    ctx.stroke();
    ctx.fillStyle = SNOW;
    ctx.beginPath();
    for (const [tx, ty] of tips) {
      ctx.moveTo(tx + 1.4 * s, ty);
      ctx.ellipse(tx, ty, (1 + snow) * s, (0.7 + snow * 0.5) * s, 0, 0, Math.PI * 2);
    }
    ctx.fill();
    return;
  }
  ctx.fillStyle = leaves;
  for (const [tx, ty] of tips) {
    if (hash01(seed, Math.round(tx * 7), 6) < 0.45) continue;
    ctx.beginPath();
    ctx.arc(tx, ty, 1.6 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Tall narrow cypress tree; `sway` bends its tip (px), `snow` streaks its lit side. */
export function cypress(ctx, u, v, size = 1, color = '#2f5a2a', sway = 0, snow = roofSnow) {
  const [x, y] = P(u, v, 0);
  const s = size;
  const t = sway * 1.2; // the tall tip moves further than a round crown
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(x + 2 * s, y, 4 * s, 2 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + t, y - 24 * s);
  ctx.quadraticCurveTo(x + 5 * s + t * 0.5, y - 10 * s, x + 2.5 * s, y - 1 * s);
  ctx.lineTo(x - 2.5 * s, y - 1 * s);
  ctx.quadraticCurveTo(x - 5 * s + t * 0.5, y - 10 * s, x + t, y - 24 * s);
  ctx.fill();
  ctx.fillStyle = shade(color, 0.18);
  ctx.beginPath();
  ctx.moveTo(x + t * 0.95, y - 23 * s);
  ctx.quadraticCurveTo(x - 4 * s + t * 0.5, y - 10 * s, x - 1.5 * s, y - 2 * s);
  ctx.lineTo(x, y - 2 * s);
  ctx.closePath();
  ctx.fill();
  if (snow > 0) {
    // Snow caught on the lit side of the tall crown.
    ctx.fillStyle = SNOW;
    ctx.beginPath();
    const n = 2 + Math.round(snow * 3);
    for (let k = 0; k < n; k++) {
      const h = 21 - k * (17 / n);
      const w = 1.6 + (21 - h) * 0.08;
      const cx = x - 0.8 * s + t * (h / 24);
      const cy = y - h * s;
      ctx.moveTo(cx + w * s, cy);
      ctx.ellipse(cx, cy, w * s, (0.7 + snow * 0.4) * s, -0.35, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

/** Deterministic pseudo-random in [0,1) from integers (for stable art details). */
export function hash01(a, b = 0, c = 0) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * A horse in profile, feet at (x, y), facing right (face 1) or left (-1).
 * `s` is a pixel scale (1 inside sprites, zoom*dpr for live units) and
 * `phase` (-1..1) swings the legs for a walking/galloping animation.
 */
export function horse(ctx, x, y, s, color = '#8a5a3c', face = 1, phase = 0, mane = '#3a2618') {
  const f = face;
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(x, y, 7 * s, 2 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // legs
  ctx.strokeStyle = shade(color, -0.35);
  ctx.lineWidth = 1.2 * s;
  ctx.beginPath();
  for (const [lx, sw] of [[-4.2, 1], [-2.6, -1], [2.8, -1], [4.3, 1]]) {
    ctx.moveTo(x + f * lx * s, y - 5 * s);
    ctx.lineTo(x + f * (lx + phase * sw * 1.2) * s, y);
  }
  ctx.stroke();
  // body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y - 7 * s, 6 * s, 3 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // neck + head
  ctx.beginPath();
  ctx.moveTo(x + f * 3.5 * s, y - 8.5 * s);
  ctx.lineTo(x + f * 6.5 * s, y - 13.5 * s);
  ctx.lineTo(x + f * 8.5 * s, y - 12.5 * s);
  ctx.lineTo(x + f * 5.5 * s, y - 6.5 * s);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + f * 8.3 * s, y - 12.3 * s, 2.4 * s, 1.3 * s, f * 0.5, 0, Math.PI * 2);
  ctx.fill();
  // mane + tail
  ctx.strokeStyle = mane;
  ctx.lineWidth = 1.1 * s;
  ctx.beginPath();
  ctx.moveTo(x + f * 3.8 * s, y - 9.5 * s);
  ctx.lineTo(x + f * 6.4 * s, y - 14 * s);
  ctx.moveTo(x - f * 5.8 * s, y - 8 * s);
  ctx.quadraticCurveTo(x - f * 8 * s, y - 6 * s, x - f * 7.4 * s, y - 3 * s);
  ctx.stroke();
  // highlight
  ctx.fillStyle = shade(color, 0.18);
  ctx.beginPath();
  ctx.ellipse(x - f * 1 * s, y - 8.4 * s, 3.4 * s, 1.1 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

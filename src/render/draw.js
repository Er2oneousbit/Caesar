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
 * @param {object} [o]   { top, left, right, stroke }
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
  // top
  if (o.noTop) return;
  poly(ctx, [P(u0, v0, z0 + h), P(u1, v0, z0 + h), P(u1, v1, z0 + h), P(u0, v1, z0 + h)], top, st, 0.6);
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
  if (axis === 'u') {
    const vm = (b + d) / 2;
    // back slope (partly visible from the ridge)
    poly(ctx, [P(a, b, z), P(c, b, z), P(c, vm, z + rh), P(a, vm, z + rh)], shade(color, 0.15), st, 0.6);
    // front slope (faces +v, the viewer's lower-left)
    poly(ctx, [P(a, vm, z + rh), P(c, vm, z + rh), P(c, d, z), P(a, d, z)], color, st, 0.6);
    // gable triangle on the +u end
    poly(ctx, [P(c, b, z), P(c, d, z), P(c, vm, z + rh)], shade(color, -0.25), st, 0.6);
    tileLines(ctx, a, vm, c, d, z, rh, 'u', shade(color, -0.18));
  } else {
    const um = (a + c) / 2;
    poly(ctx, [P(a, b, z), P(um, b, z + rh), P(um, d, z + rh), P(a, d, z)], shade(color, 0.12), st, 0.6);
    poly(ctx, [P(um, b, z + rh), P(c, b, z), P(c, d, z), P(um, d, z + rh)], shade(color, -0.2), st, 0.6);
    poly(ctx, [P(a, d, z), P(c, d, z), P(um, d, z + rh)], shade(color, -0.05), st, 0.6);
    tileLines(ctx, um, b, c, d, z, rh, 'v', shade(color, -0.35));
  }
}

/** Faint rows of roof tiles on a slope, for texture. */
function tileLines(ctx, u0, v0, u1, v1, z, rh, axis, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  const n = 3;
  for (let k = 1; k < n; k++) {
    const t = k / n;
    if (axis === 'u') {
      const v = v0 + (v1 - v0) * t;
      const zz = z + rh * (1 - t);
      const p = P(u0, v, zz);
      const q = P(u1, v, zz);
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
    } else {
      const u = u0 + (u1 - u0) * t;
      const zz = z + rh * (1 - t);
      const p = P(u, v0, zz);
      const q = P(u, v1, zz);
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
    }
  }
  ctx.stroke();
}

/** Four-sided pyramid (hip) roof. */
export function hipRoof(ctx, u0, v0, du, dv, z, rh, color, overhang = 0.06) {
  const a = u0 - overhang;
  const b = v0 - overhang;
  const c = u0 + du + overhang;
  const d = v0 + dv + overhang;
  const inset = Math.min(du, dv) * 0.5 + overhang;
  const st = shade(color, -0.5);
  const r1 = [a + inset, b + inset];
  const r2 = [c - inset, d - inset];
  const top1 = P(r1[0], r1[1], z + rh);
  const top2 = P(Math.max(r1[0], r2[0]), Math.max(r1[1], r2[1]), z + rh);
  poly(ctx, [P(a, b, z), P(c, b, z), top2, top1], shade(color, 0.15), st, 0.6);
  poly(ctx, [P(a, b, z), top1, P(a, d, z)], shade(color, 0.08), st, 0.6);
  poly(ctx, [P(c, b, z), P(c, d, z), top2], shade(color, -0.22), st, 0.6);
  poly(ctx, [P(a, d, z), top1, top2, P(c, d, z)], color, st, 0.6);
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
 */
export function windows(ctx, face, u0, v0, u1, v1, z0, rows, cols, color = '#3a2f28', o = {}) {
  const ww = o.w ?? 0.12; // width in tiles
  const wh = o.h ?? 5; // height px
  const gap = o.gap ?? 9; // vertical spacing px
  const zStart = o.z ?? z0 + 4;
  for (let r = 0; r < rows; r++) {
    const z = zStart + r * gap;
    for (let c = 0; c < cols; c++) {
      const t = (c + 0.5) / cols;
      if (face === 'left') {
        const u = u0 + (u1 - u0) * t;
        poly(ctx, [P(u - ww / 2, v1, z), P(u + ww / 2, v1, z), P(u + ww / 2, v1, z + wh), P(u - ww / 2, v1, z + wh)], color);
      } else {
        const v = v0 + (v1 - v0) * t;
        poly(ctx, [P(u1, v - ww / 2, z), P(u1, v + ww / 2, z), P(u1, v + ww / 2, z + wh), P(u1, v - ww / 2, z + wh)], color);
      }
    }
  }
}

/** A door on a face, centered at parameter t (0..1). */
export function door(ctx, face, u0, v0, u1, v1, z0, t = 0.5, color = '#4a3222', w = 0.18, h = 8) {
  if (face === 'left') {
    const u = u0 + (u1 - u0) * t;
    poly(ctx, [P(u - w / 2, v1, z0), P(u + w / 2, v1, z0), P(u + w / 2, v1, z0 + h), P(u - w / 2, v1, z0 + h)], color);
  } else {
    const v = v0 + (v1 - v0) * t;
    poly(ctx, [P(u1, v - w / 2, z0), P(u1, v + w / 2, z0), P(u1, v + w / 2, z0 + h), P(u1, v - w / 2, z0 + h)], color);
  }
}

/** Soft elliptical shadow on the ground. */
export function shadowEllipse(ctx, u, v, rx, ry, alpha = 0.25) {
  const [x, y] = P(u, v, 0);
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** A round bush/tree crown made of overlapping circles. */
export function tree(ctx, u, v, size = 1, color = '#3e7a34', trunk = '#6b4a2a', seed = 0) {
  const [x, y] = P(u, v, 0);
  const s = size;
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(x + 2 * s, y, 7 * s, 3 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = trunk;
  ctx.fillRect(x - 1.2 * s, y - 8 * s, 2.4 * s, 8 * s);
  const blobs = [
    [0, -14, 7],
    [-4, -11, 5],
    [4, -11, 5],
    [0, -18, 5],
  ];
  for (let k = 0; k < blobs.length; k++) {
    const [bx, by, br] = blobs[k];
    const jitter = ((seed * 31 + k * 17) % 5) - 2;
    ctx.fillStyle = k === 3 ? shade(color, 0.12) : k % 2 ? shade(color, -0.12) : color;
    ctx.beginPath();
    ctx.arc(x + (bx + jitter * 0.4) * s, y + by * s, br * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = shade(color, 0.3);
  ctx.beginPath();
  ctx.arc(x - 2 * s, y - 17 * s, 2.2 * s, 0, Math.PI * 2);
  ctx.fill();
}

/** Tall narrow cypress tree. */
export function cypress(ctx, u, v, size = 1, color = '#2f5a2a') {
  const [x, y] = P(u, v, 0);
  const s = size;
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(x + 2 * s, y, 4 * s, 2 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - 24 * s);
  ctx.quadraticCurveTo(x + 5 * s, y - 10 * s, x + 2.5 * s, y - 1 * s);
  ctx.lineTo(x - 2.5 * s, y - 1 * s);
  ctx.quadraticCurveTo(x - 5 * s, y - 10 * s, x, y - 24 * s);
  ctx.fill();
  ctx.fillStyle = shade(color, 0.18);
  ctx.beginPath();
  ctx.moveTo(x, y - 23 * s);
  ctx.quadraticCurveTo(x - 4 * s, y - 10 * s, x - 1.5 * s, y - 2 * s);
  ctx.lineTo(x, y - 2 * s);
  ctx.closePath();
  ctx.fill();
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

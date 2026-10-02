/**
 * nativeArt.js
 * ----------------------------------------------------------------------------
 * Procedural art for the native villages and the mission post (all
 * original): the round wattle hut under its thatch cone, the meeting place
 * with its ring of carved posts round a fire and a long shelter, the
 * village's small field, and the Sacellum Pacis, a small shrine of peace with
 * lodgings for envoys and an olive tree.
 *
 * All drawn in footprint coordinates through draw.js P() and its primitives,
 * so the turned-art path (render/turn.js) draws them from every side. The
 * hut is round and looks the same every way (buildingArt.js SAME_EVERY_WAY).
 * Painter's order: back (small u + v) first.
 * ----------------------------------------------------------------------------
 */

import { P, poly, quad, box, gableRoof, shade, tree, roofSnowAmount, SNOW } from './draw.js';

const WATTLE = '#9b7a52';
const THATCH = '#b99a55';
const EARTH = '#a48a62';
const WOOD = '#6e4a2a';

/** A ring of points round (cu, cv), radius r, at height z: n of them, as [u, v, angle]. */
function ring(cu, cv, r, n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    out.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r, a]);
  }
  return out;
}

/** A round hut of wattle and daub under a cone of thatch, centred at (cu, cv). */
function roundHut(ctx, cu, cv, r, wall, roof, variant) {
  const n = 12;
  const pts = ring(cu, cv, r, n);
  // Walls: only the half facing the viewer shows; back to front.
  const faces = [];
  for (let k = 0; k < n; k++) {
    const p = pts[k];
    const q = pts[(k + 1) % n];
    const mid = (p[2] + q[2]) / 2 + (k === n - 1 ? Math.PI : 0);
    if (Math.cos(mid) + Math.sin(mid) <= 0) continue;
    faces.push({ p, q, d: (p[0] + q[0] + p[1] + q[1]) / 2, lit: Math.cos(mid) - Math.sin(mid) });
  }
  faces.sort((a, b) => a.d - b.d);
  for (const f of faces) {
    poly(ctx, [P(f.p[0], f.p[1], 0), P(f.q[0], f.q[1], 0), P(f.q[0], f.q[1], 7), P(f.p[0], f.p[1], 7)], shade(wall, f.lit > 0 ? 0.04 : -0.18));
  }
  // The doorway, on the front.
  const door = [cu + r * 0.72, cv + r * 0.72];
  poly(ctx, [P(door[0] - 0.08, door[1] + 0.08, 0), P(door[0] + 0.08, door[1] - 0.08, 0), P(door[0] + 0.08, door[1] - 0.08, 5), P(door[0] - 0.08, door[1] + 0.08, 5)], '#3b2a1c');
  // The thatch cone, overhanging the wall a little.
  const eave = ring(cu, cv, r * 1.18, n);
  const apex = [cu, cv, 7 + 13 + (variant % 2) * 2];
  const tris = eave.map((p, k) => ({ p, q: eave[(k + 1) % n], d: (p[0] + eave[(k + 1) % n][0] + p[1] + eave[(k + 1) % n][1]) / 2, a: (p[2] + Math.PI / n) }));
  tris.sort((a, b) => a.d - b.d);
  const sn = roofSnowAmount();
  for (const t of tris) {
    const lit = Math.cos(t.a) - Math.sin(t.a);
    poly(ctx, [P(t.p[0], t.p[1], 6), P(t.q[0], t.q[1], 6), P(apex[0], apex[1], apex[2])], shade(sn > 0.3 ? SNOW : roof, lit > 0 ? 0.06 : -0.16), shade(roof, -0.35), 0.4);
  }
  // A smoke hole's dark tip.
  const [x, y] = P(apex[0], apex[1], apex[2]);
  ctx.fillStyle = '#4a3a26';
  ctx.fillRect(x - 1, y - 1, 2, 2);
}

/** Native hut (1x1): a round hut in its yard, a woodpile or a pot by it. */
export function nativeHutArt(ctx, S, variant) {
  quad(ctx, 0.06, 0.06, 0.94, 0.94, 0, shade(EARTH, (variant % 3) * 0.04));
  roundHut(ctx, 0.48, 0.46, 0.3, shade(WATTLE, ((variant >> 1) % 3) * 0.05 - 0.05), THATCH, variant);
  const [x, y] = P(0.86, 0.2);
  if (variant % 2) {
    ctx.fillStyle = WOOD; // woodpile
    ctx.fillRect(x - 3, y - 2.5, 6, 2.5);
    ctx.fillStyle = shade(WOOD, 0.25);
    ctx.fillRect(x - 3, y - 2.5, 6, 0.8);
  } else {
    ctx.fillStyle = '#8a5a3a'; // a clay pot
    ctx.beginPath(); ctx.ellipse(x, y - 2, 2, 2.4, 0, 0, Math.PI * 2); ctx.fill();
  }
}

/**
 * Meeting place (2x2): trampled earth, a long thatched shelter at the back,
 * a ring of carved posts round the council fire.
 */
export function nativeMeetingArt(ctx, S) {
  quad(ctx, 0.05, 0.05, S - 0.05, S - 0.05, 0, EARTH);
  quad(ctx, 0.5, 0.5, S - 0.3, S - 0.3, 0, shade(EARTH, -0.08));
  box(ctx, 0.12, 0.12, S - 0.3, 0.55, 0, 8, WATTLE);
  gableRoof(ctx, 0.08, 0.08, S - 0.22, 0.63, 8, 9, THATCH, 'u', 0.04);
  // The fire: a ring of stones, embers and a small flame.
  const c = P(1.15, 1.2);
  ctx.fillStyle = '#6b6158';
  ctx.beginPath(); ctx.ellipse(c[0], c[1], 6, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c4562a';
  ctx.beginPath(); ctx.ellipse(c[0], c[1] - 0.5, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f0b040';
  ctx.beginPath(); ctx.moveTo(c[0] - 2, c[1] - 1); ctx.lineTo(c[0], c[1] - 7); ctx.lineTo(c[0] + 2, c[1] - 1); ctx.closePath(); ctx.fill();
  // Carved posts round it, back ones first: thin boxes, so a turned
  // drawing sorts them against the shelter (render/turn.js).
  const posts = ring(1.15, 1.2, 0.62, 8).sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  for (const [u, v] of posts) {
    box(ctx, u - 0.025, v - 0.025, 0.05, 0.05, 0, 10, WOOD, { plain: true });
    box(ctx, u - 0.035, v - 0.035, 0.07, 0.07, 10, 1.5, '#c9b27a', { plain: true });
  }
}

/** Native crops (1x1): a small field in rows, two looks. */
export function nativeCropsArt(ctx, S, variant) {
  quad(ctx, 0.06, 0.06, 0.94, 0.94, 0, '#7d6040');
  const green = variant % 2 ? '#8faa48' : '#b9a24a';
  // Ridges of crop (low boxes, so they read the same from every side).
  for (let k = 0; k < 5; k++) box(ctx, 0.12, 0.14 + k * 0.155, 0.76, 0.08, 0, 2.5, shade(green, (k % 2) * 0.08), { plain: true });
  // A scarecrow post on one look.
  if (variant % 3 === 0) {
    const [x, y] = P(0.8, 0.8);
    ctx.fillStyle = WOOD;
    ctx.fillRect(x - 0.6, y - 10, 1.2, 10);
    ctx.fillRect(x - 3, y - 8, 6, 1);
  }
}

/**
 * Sacellum Pacis (2x2): a paved court, a small tiled shrine of peace with an
 * altar before it, the envoys' lodging along one side, an olive tree, and a
 * pole with a white cloth (the sign of an envoy).
 */
export function missionPostArt(ctx, S, variant) {
  quad(ctx, 0.04, 0.04, S - 0.04, S - 0.04, 0, '#cbbd98');
  // The lodging along the back.
  box(ctx, 0.1, 0.1, 1.05, 0.62, 0, 12, '#d9cba8');
  gableRoof(ctx, 0.06, 0.06, 1.13, 0.7, 12, 7, '#b5603e', 'u', 0.04);
  // The shrine on the right.
  box(ctx, 1.22, 0.14, 0.62, 0.8, 0, 16, '#efe8d6');
  gableRoof(ctx, 1.18, 0.1, 0.7, 0.88, 16, 8, '#b8573a', 'v', 0.04);
  // Its altar, in front of it.
  box(ctx, 1.4, 1.12, 0.26, 0.22, 0, 5, '#e6dcc4');
  // The olive tree.
  tree(ctx, 0.5, 1.35, 0.7, '#7d8f4e', '#5e4632', variant + 3);
  // The envoy's white cloth.
  const [x, y] = P(1.82, 1.82);
  ctx.fillStyle = WOOD;
  ctx.fillRect(x - 0.6, y - 18, 1.2, 18);
  ctx.fillStyle = '#f4f1e8';
  ctx.beginPath();
  ctx.moveTo(x + 0.6, y - 18); ctx.lineTo(x + 7, y - 17); ctx.lineTo(x + 6, y - 13); ctx.lineTo(x + 0.6, y - 12.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#7d8f4e'; // an olive sprig on it
  ctx.fillRect(x + 2.5, y - 16, 2.5, 1);
}

/**
 * waterArt.js
 * ----------------------------------------------------------------------------
 * Procedural art for the fishing industry (all original): the shipyard with a
 * hull on its slip while a boat is being built, the fishing wharf with its
 * hut, drying racks and the day's catch in baskets, and the gulls that circle
 * over the fishing grounds (drawn live by the renderer).
 *
 * Both buildings stand on the bank with one edge facing the water, like the
 * dock: each is designed with the water on its +u edge and turned into place
 * by `side` (0 = -v, 1 = +u, 2 = +v, 3 = -u; sim/fishing.js waterBeside).
 * One out over the water (art state + OVER_WATER_ART, as every building
 * placed since that rule) has its own drawing, its row on the water raised
 * on piles (pierDeck, shared with the dock and the fleet's buildings); one
 * wholly on land, from an older save, keeps the first drawing.
 * Painter's order: back (small u+v after turning) first, front last.
 * ----------------------------------------------------------------------------
 */

import { P, poly, quad, box, gableRoof, shade } from './draw.js';
import { OVER_WATER_ART as OVER_WATER } from '../sim/entities.js';

const WOOD = '#8a5a33';
const WOOD_DARK = '#5e3b20';
const WOOD_PALE = '#b88a58';
const THATCH = '#c9a75b';
const NET = 'rgba(70,60,45,0.75)';
const FISH = '#a9bec7';

/** (u, v) as designed (water on +u) to (u, v) on the footprint, for the edge facing the water. */
export function turner(S, side) {
  return (u, v) => (side === 1 ? [u, v] : side === 3 ? [S - u, v] : side === 2 ? [v, u] : [v, S - u]);
}

/** A box given in designed coordinates, turned into place (its corners re-sorted). */
export function turnedRect(T, u0, v0, du, dv) {
  const a = T(u0, v0);
  const b = T(u0 + du, v0 + dv);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])];
}

/** Draw the queued pieces back to front by where they stand on screen. */
export function paint(items) {
  items.sort((a, b) => a.d - b.d);
  for (const it of items) it.draw();
}

/** A short wooden post standing at (x, y), `h` px tall. */
export function post(ctx, x, y, h, w = 1.4, color = WOOD_DARK) {
  ctx.fillStyle = color;
  ctx.fillRect(x - w / 2, y - h, w, h);
}

// ---------------------------------------------------------------------------
// Out over the water (OVER_WATER_ART, sim/entities.js waterRowsFor)
// ---------------------------------------------------------------------------

/**
 * A waterside building out over the water: its rows on the water are the
 * designed +u edge, u from S - rows to S; the rest is the shore. The water
 * tiles under it are drawn by the renderer as water, so what stands on them
 * is drawn raised on piles or stone piers, the water showing between them.
 */
export function overWater(S) {
  const rows = S <= 2 ? 1 : 2;
  return { rows, shore: S - rows };
}

/** The shore part of the footprint (designed u 0 to `shore`) as ground of `color`, turned into place. */
export function shoreGround(ctx, T, S, shore, color) {
  const r = turnedRect(T, 0.03, 0.03, shore - 0.03, S - 0.06);
  quad(ctx, r[0], r[1], r[0] + r[2], r[1] + r[3], 0, color);
}

/**
 * A deck out over the water on piles: designed u0..u1 by v0..v1, its top at
 * `z` px over the water, `thick` px deep, on square piles (`pile` tiles
 * across) every `step` tiles each way, standing in the water. Timber by
 * default; stone piers for a quay. Drawn as boxes, so every view turn shows
 * the faces it should (render/turn.js), and the piles stand under the deck.
 */
export function pierDeck(ctx, T, u0, u1, v0, v1, { z = 4, thick = 1.5, step = 0.45, pile = 0.08, pileColor = WOOD_DARK, deck = '#a07e55', seams = 'rgba(70,45,25,0.45)', seamStep = 0.17 } = {}) {
  const nu = Math.max(1, Math.round((u1 - u0) / step));
  const nv = Math.max(1, Math.round((v1 - v0) / step));
  for (let a = 0; a <= nu; a++) {
    for (let b = 0; b <= nv; b++) {
      const u = Math.min(u1 - pile, Math.max(u0, u0 + ((u1 - u0) * a) / nu - pile / 2));
      const v = Math.min(v1 - pile, Math.max(v0, v0 + ((v1 - v0) * b) / nv - pile / 2));
      const p = turnedRect(T, u, v, pile, pile);
      box(ctx, p[0], p[1], p[2], p[3], 0, z - thick, pileColor, { plain: true });
    }
  }
  const d = turnedRect(T, u0, v0, u1 - u0, v1 - v0);
  box(ctx, d[0], d[1], d[2], d[3], z - thick, thick, deck, { plain: true });
  if (!seams) return;
  // planks (or paving joints) across the deck, parallel to the water's edge
  ctx.strokeStyle = seams;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let u = u0 + seamStep; u < u1 - 0.02; u += seamStep) {
    const p = P(...T(u, v0 + 0.03), z);
    const q = P(...T(u, v1 - 0.03), z);
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
  }
  ctx.stroke();
}

/** A mooring post standing in the water at designed (u, v), its top `h` px up. */
function pile(ctx, Q, u, v, h) {
  const [x, y] = Q(u, v);
  post(ctx, x, y + 1, h + 1, 2.2, '#4a3a2a');
  ctx.fillStyle = '#6b5640';
  ctx.fillRect(x - 1.5, y - h - 0.5, 3, 1.2);
}

// ---------------------------------------------------------------------------
// Shipyard
// ---------------------------------------------------------------------------

/**
 * Shipyard: a gravel yard with a timber shed and a stack of planks at the
 * back, a slipway running down into the water, a sheerlegs crane at the
 * water's edge and, while a boat is being built, its hull on the slip:
 * `stage` 1 the keel and bare ribs, 2 planked up to the gunwale.
 * state = side + 4 * stage.
 */
export function shipyardArt(ctx, S, variant, state = 1) {
  if (state >= OVER_WATER) { shipyardPierArt(ctx, S, state - OVER_WATER); return; }
  const side = state % 4;
  const stage = Math.floor(state / 4);
  const T = turner(S, side);
  const Q = (u, v, z = 0) => P(...T(u, v), z);
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, '#b6a27a');
  // the slipway: two rails on sleepers, running down to the water's edge
  const rail = (v) => { const a = Q(0.45, v, 3); const b = Q(S + 0.05, v, 0); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
  ctx.strokeStyle = shade(WOOD, -0.1);
  ctx.lineWidth = 1.2;
  for (let u = 0.55; u < S; u += 0.22) {
    const z = 3 * (1 - (u - 0.45) / (S - 0.4));
    const a = Q(u, 0.62, z);
    const b = Q(u, 1.38, z);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 1.1;
  rail(0.78);
  rail(1.22);
  const items = [];
  const at = (u, v) => { const [a, b] = T(u, v); return a + b; };
  // the shed and the plank stack at the back of the yard
  const shed = turnedRect(T, 0.06, 0.06, 0.42, 0.58);
  items.push({ d: shed[0] + shed[1], draw: () => {
    box(ctx, shed[0], shed[1], shed[2], shed[3], 0, 12, '#c8b48e');
    gableRoof(ctx, shed[0], shed[1], shed[2], shed[3], 12, 6, '#8a5a3a', shed[2] >= shed[3] ? 'u' : 'v');
  } });
  const stack = turnedRect(T, 0.08, 1.48, 0.62, 0.36);
  items.push({ d: stack[0] + stack[1] + 0.2, draw: () => {
    for (let k = 0; k < 3; k++) box(ctx, stack[0], stack[1], stack[2], stack[3], k * 2, 2, k % 2 ? WOOD_PALE : '#a57a4a', { plain: true });
  } });
  // the sheerlegs crane at the water's edge, with a block and rope
  items.push({ d: at(S - 0.15, 0.3), draw: () => {
    const [x, y] = Q(S - 0.15, 0.3);
    ctx.strokeStyle = WOOD_DARK;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x - 3.5, y); ctx.lineTo(x, y - 24); ctx.lineTo(x + 3.5, y);
    ctx.stroke();
    const tip = Q(S - 0.45, 0.85, 24);
    ctx.beginPath(); ctx.moveTo(x, y - 24); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
    ctx.strokeStyle = '#3a3026';
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(tip[0], tip[1]); ctx.lineTo(tip[0], tip[1] + 9); ctx.stroke();
    ctx.fillStyle = '#6b4a2a';
    ctx.fillRect(tip[0] - 1.5, tip[1] + 9, 3, 2.5);
  } });
  if (stage > 0) items.push({ d: at(1.2, 1.0) + 0.1, draw: () => hull(ctx, Q, at, stage) });
  paint(items);
}

/**
 * The shipyard out over the water: the yard on the shore with its shed and
 * planks; the slipway running out on piles over its row on the water and
 * down to the water's surface at the far end, the water open on either side
 * of it; a narrow staging beside the slip carries the sheerlegs crane.
 */
function shipyardPierArt(ctx, S, state) {
  const side = state % 4;
  const stage = Math.floor(state / 4);
  const T = turner(S, side);
  const Q = (u, v, z = 0) => P(...T(u, v), z);
  const at = (u, v) => { const [a, b] = T(u, v); return a + b; };
  const { shore } = overWater(S);
  shoreGround(ctx, T, S, shore, '#b6a27a');
  // the staging for the crane, on piles beside the slip
  pierDeck(ctx, T, shore - 0.05, S - 0.05, 0.06, 0.46, { z: 4, step: 0.5 });
  // the slipway: from the yard down to the water, piles under its sleepers
  const slipZ = (u) => 3.5 * Math.max(0, 1 - (u - 0.45) / (S - 0.45));
  for (const u of [1.1, 1.45, 1.8]) {
    for (const v of [0.66, 1.28]) {
      const p = turnedRect(T, u - 0.04, v, 0.08, 0.08);
      box(ctx, p[0], p[1], p[2], p[3], 0, Math.max(0.5, slipZ(u) - 0.6), WOOD_DARK, { plain: true });
    }
  }
  ctx.strokeStyle = shade(WOOD, -0.1);
  ctx.lineWidth = 1.2;
  for (let u = 0.55; u < S; u += 0.2) {
    const a = Q(u, 0.62, slipZ(u));
    const b = Q(u, 1.38, slipZ(u));
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 1.1;
  for (const v of [0.78, 1.22]) {
    const a = Q(0.45, v, slipZ(0.45));
    const b = Q(S - 0.02, v, slipZ(S - 0.02));
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  const items = [];
  const shed = turnedRect(T, 0.06, 0.06, 0.42, 0.5);
  items.push({ d: shed[0] + shed[1], draw: () => {
    box(ctx, shed[0], shed[1], shed[2], shed[3], 0, 12, '#c8b48e');
    gableRoof(ctx, shed[0], shed[1], shed[2], shed[3], 12, 6, '#8a5a3a', shed[2] >= shed[3] ? 'u' : 'v');
  } });
  const stack = turnedRect(T, 0.08, 1.5, 0.6, 0.34);
  items.push({ d: stack[0] + stack[1] + 0.2, draw: () => {
    for (let k = 0; k < 3; k++) box(ctx, stack[0], stack[1], stack[2], stack[3], k * 2, 2, k % 2 ? WOOD_PALE : '#a57a4a', { plain: true });
  } });
  // the sheerlegs crane on the staging, its block over the slip's end
  items.push({ d: at(S - 0.2, 0.25), draw: () => {
    const [x, y] = Q(S - 0.2, 0.25, 4);
    ctx.strokeStyle = WOOD_DARK;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x - 3.5, y); ctx.lineTo(x, y - 24); ctx.lineTo(x + 3.5, y);
    ctx.stroke();
    const tip = Q(S - 0.45, 0.85, 28);
    ctx.beginPath(); ctx.moveTo(x, y - 24); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
    ctx.strokeStyle = '#3a3026';
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(tip[0], tip[1]); ctx.lineTo(tip[0], tip[1] + 9); ctx.stroke();
    ctx.fillStyle = '#6b4a2a';
    ctx.fillRect(tip[0] - 1.5, tip[1] + 9, 3, 2.5);
  } });
  // a mooring post at the slip's far corner
  items.push({ d: at(S - 0.08, S - 0.2), draw: () => pile(ctx, Q, S - 0.08, S - 0.2, 7) });
  if (stage > 0) items.push({ d: at(1.2, 1.0) + 0.1, draw: () => hull(ctx, Q, at, stage) });
  paint(items);
}

/**
 * A boat on the slip, bow toward the water: the keel and stem, then bare
 * ribs (stage 1) or planked sides (stage 2), the far side drawn first.
 */
function hull(ctx, Q, at, stage) {
  const U0 = 0.55;
  const U1 = 1.9;
  const half = (u) => 0.3 * Math.sin(Math.PI * Math.min(1, (u - U0 + 0.15) / (U1 - U0 + 0.15))); // tapers to the bow
  const z = (u) => 3.6 * (1 - (u - 0.45) / 1.6); // on the sloping slip
  const us = [];
  for (let u = U0; u <= U1 + 1e-9; u += (U1 - U0) / 8) us.push(u);
  // keel and stem
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 1.6;
  const k0 = Q(U0, 1, z(U0) + 1);
  const k1 = Q(U1, 1, z(U1) + 1);
  const stem = Q(U1 + 0.08, 1, z(U1) + 10);
  ctx.beginPath(); ctx.moveTo(k0[0], k0[1]); ctx.lineTo(k1[0], k1[1]); ctx.lineTo(stem[0], stem[1]); ctx.stroke();
  const sternPost = Q(U0 - 0.05, 1, z(U0) + 9);
  ctx.beginPath(); ctx.moveTo(k0[0], k0[1]); ctx.lineTo(sternPost[0], sternPost[1]); ctx.stroke();
  // which side is nearer the viewer after turning (drawn last)
  const sides = at(1.2, 0.7) < at(1.2, 1.3) ? [-1, 1] : [1, -1];
  if (stage === 1) {
    ctx.strokeStyle = '#c79a5e';
    ctx.lineWidth = 1;
    for (const u of us.slice(1, -1)) {
      const w = half(u);
      const a = Q(u, 1 - w, z(u) + 8);
      const c = Q(u, 1, z(u) - 2);
      const b = Q(u, 1 + w, z(u) + 8);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(c[0], c[1], b[0], b[1]); ctx.stroke();
    }
    return;
  }
  for (const s of sides) {
    const top = us.map((u) => Q(u, 1 + s * half(u), z(u) + 8));
    const keel = us.map((u) => Q(u, 1, z(u) + 1)).reverse();
    poly(ctx, [...top, ...keel], s === sides[1] ? '#9a6a3c' : '#7d5430', shade(WOOD_DARK, -0.2), 0.6);
    // plank seams
    ctx.strokeStyle = 'rgba(50,30,15,0.45)';
    ctx.lineWidth = 0.5;
    for (const f of [0.35, 0.68]) {
      ctx.beginPath();
      us.forEach((u, i) => { const p = Q(u, 1 + s * half(u) * (1 - f * 0.4), z(u) + 8 - f * 6); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
      ctx.stroke();
    }
  }
  // the gunwale's rim
  ctx.strokeStyle = '#c79a5e';
  ctx.lineWidth = 0.9;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    us.forEach((u, i) => { const p = Q(u, 1 + s * half(u), z(u) + 8); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Fishing wharf
// ---------------------------------------------------------------------------

/**
 * Fishing wharf: a plank deck out over the water's edge with mooring posts,
 * a thatched hut, a rack of fish drying in the sun and a net hung out on
 * poles; while the wharf holds fish, baskets of the catch wait on the deck.
 * state = side + 4 * (fish waiting ? 1 : 0).
 */
export function wharfArt(ctx, S, variant, state = 1) {
  if (state >= OVER_WATER) { wharfPierArt(ctx, S, state - OVER_WATER); return; }
  const side = state % 4;
  const catchIn = state >= 4;
  const T = turner(S, side);
  const Q = (u, v, z = 0) => P(...T(u, v), z);
  const at = (u, v) => { const [a, b] = T(u, v); return a + b; };
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, '#a99a74');
  // the deck: planks across the water edge half
  const deck = turnedRect(T, 0.95, 0.04, S - 0.95 + 0.06, S - 0.08);
  quad(ctx, deck[0], deck[1], deck[0] + deck[2], deck[1] + deck[3], 1, '#a07e55');
  ctx.strokeStyle = 'rgba(70,45,25,0.45)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let u = 1.1; u < S + 0.05; u += 0.17) {
    const p = Q(u, 0.06, 1);
    const q = Q(u, S - 0.06, 1);
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
  }
  ctx.stroke();
  const items = [];
  // the hut
  const hut = turnedRect(T, 0.08, 0.08, 0.72, 0.66);
  items.push({ d: hut[0] + hut[1], draw: () => {
    box(ctx, hut[0], hut[1], hut[2], hut[3], 0, 11, '#cdb68c');
    gableRoof(ctx, hut[0], hut[1], hut[2], hut[3], 11, 7, THATCH, hut[2] >= hut[3] ? 'u' : 'v');
  } });
  // the drying rack: two posts, a pole, fish hanging from it
  items.push({ d: at(0.45, 1.45), draw: () => {
    const a = Q(0.2, 1.45);
    const b = Q(0.75, 1.45);
    post(ctx, a[0], a[1], 11);
    post(ctx, b[0], b[1], 11);
    ctx.strokeStyle = WOOD;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a[0], a[1] - 10.5); ctx.lineTo(b[0], b[1] - 10.5); ctx.stroke();
    for (let k = 1; k < 6; k++) {
      const x = a[0] + (b[0] - a[0]) * (k / 6);
      const y = a[1] + (b[1] - a[1]) * (k / 6) - 10;
      ctx.fillStyle = k % 2 ? FISH : '#c2a77a'; // fresh and dried
      ctx.beginPath(); ctx.ellipse(x, y + 3, 0.9, 2.6, 0, 0, Math.PI * 2); ctx.fill();
    }
  } });
  // the net hung out on two poles on the deck
  items.push({ d: at(1.55, 0.6), draw: () => {
    const a = Q(1.35, 0.25, 1);
    const b = Q(1.75, 0.95, 1);
    post(ctx, a[0], a[1], 13, 1.2);
    post(ctx, b[0], b[1], 13, 1.2);
    ctx.strokeStyle = NET;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let k = 0; k <= 6; k++) {
      const x = a[0] + (b[0] - a[0]) * (k / 6);
      const y = a[1] + (b[1] - a[1]) * (k / 6) - 12.5;
      ctx.moveTo(x, y);
      ctx.lineTo(x + (k % 2 ? 0.8 : -0.8), y + 8 + Math.sin(k) * 1.5);
    }
    for (let r = 0; r < 4; r++) {
      ctx.moveTo(a[0], a[1] - 12.5 + r * 2.4);
      ctx.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 10 + r * 2.4 + 2, b[0], b[1] - 12.5 + r * 2.4);
    }
    ctx.stroke();
    ctx.fillStyle = '#e0c060'; // cork floats along the head rope
    for (let k = 1; k < 4; k++) ctx.fillRect(a[0] + (b[0] - a[0]) * (k / 4) - 0.8, a[1] + (b[1] - a[1]) * (k / 4) - 13.2, 1.6, 1.4);
  } });
  // mooring posts at the water's edge
  for (const v of [0.25, S - 0.25]) {
    items.push({ d: at(S - 0.1, v), draw: () => {
      const [x, y] = Q(S - 0.1, v, 1);
      post(ctx, x, y + 3, 7, 2.2, '#4a3a2a');
      ctx.fillStyle = '#6b5640';
      ctx.fillRect(x - 1.5, y - 4.5, 3, 1.2);
    } });
  }
  // baskets of the catch, waiting for a cart
  if (catchIn) {
    for (const [u, v] of [[1.3, 1.25], [1.6, 1.5], [1.25, 1.65]]) {
      items.push({ d: at(u, v) + 0.05, draw: () => fishBasket(ctx, ...Q(u, v, 1)) });
    }
  }
  paint(items);
}

/**
 * The fishing wharf out over the water: the hut and the drying rack on the
 * shore, a plank jetty on piles running out over its row on the water, the
 * water open on both sides of it, with the net hung out on its deck, the
 * day's catch in baskets and mooring posts at its end.
 */
function wharfPierArt(ctx, S, state) {
  const side = state % 4;
  const catchIn = state >= 4;
  const T = turner(S, side);
  const Q = (u, v, z = 0) => P(...T(u, v), z);
  const at = (u, v) => { const [a, b] = T(u, v); return a + b; };
  const { shore } = overWater(S);
  const Z = 4; // the jetty's deck over the water
  shoreGround(ctx, T, S, shore, '#a99a74');
  pierDeck(ctx, T, shore - 0.08, S - 0.04, 0.32, S - 0.32, { z: Z, step: 0.45 });
  const items = [];
  const hut = turnedRect(T, 0.08, 0.08, 0.72, 0.66);
  items.push({ d: hut[0] + hut[1], draw: () => {
    box(ctx, hut[0], hut[1], hut[2], hut[3], 0, 11, '#cdb68c');
    gableRoof(ctx, hut[0], hut[1], hut[2], hut[3], 11, 7, THATCH, hut[2] >= hut[3] ? 'u' : 'v');
  } });
  items.push({ d: at(0.45, 1.45), draw: () => {
    const a = Q(0.2, 1.45);
    const b = Q(0.75, 1.45);
    post(ctx, a[0], a[1], 11);
    post(ctx, b[0], b[1], 11);
    ctx.strokeStyle = WOOD;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a[0], a[1] - 10.5); ctx.lineTo(b[0], b[1] - 10.5); ctx.stroke();
    for (let k = 1; k < 6; k++) {
      const x = a[0] + (b[0] - a[0]) * (k / 6);
      const y = a[1] + (b[1] - a[1]) * (k / 6) - 10;
      ctx.fillStyle = k % 2 ? FISH : '#c2a77a';
      ctx.beginPath(); ctx.ellipse(x, y + 3, 0.9, 2.6, 0, 0, Math.PI * 2); ctx.fill();
    }
  } });
  // the net hung out on two poles along the jetty
  items.push({ d: at(1.45, 0.75), draw: () => {
    const a = Q(1.15, 0.45, Z);
    const b = Q(1.75, 0.45, Z);
    post(ctx, a[0], a[1], 12, 1.2);
    post(ctx, b[0], b[1], 12, 1.2);
    ctx.strokeStyle = NET;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let k = 0; k <= 6; k++) {
      const x = a[0] + (b[0] - a[0]) * (k / 6);
      const y = a[1] + (b[1] - a[1]) * (k / 6) - 11.5;
      ctx.moveTo(x, y);
      ctx.lineTo(x + (k % 2 ? 0.8 : -0.8), y + 7.5 + Math.sin(k) * 1.5);
    }
    for (let r = 0; r < 4; r++) {
      ctx.moveTo(a[0], a[1] - 11.5 + r * 2.2);
      ctx.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 9 + r * 2.2 + 2, b[0], b[1] - 11.5 + r * 2.2);
    }
    ctx.stroke();
    ctx.fillStyle = '#e0c060'; // cork floats along the head rope
    for (let k = 1; k < 4; k++) ctx.fillRect(a[0] + (b[0] - a[0]) * (k / 4) - 0.8, a[1] + (b[1] - a[1]) * (k / 4) - 12.2, 1.6, 1.4);
  } });
  // mooring posts in the water at the jetty's end
  for (const v of [0.22, S - 0.22]) items.push({ d: at(S - 0.1, v), draw: () => pile(ctx, Q, S - 0.1, v, 8) });
  if (catchIn) {
    for (const [u, v] of [[1.3, 1.2], [1.6, 1.4], [1.3, 1.55]]) {
      items.push({ d: at(u, v) + 0.05, draw: () => fishBasket(ctx, ...Q(u, v, Z)) });
    }
  }
  paint(items);
}

/** A round basket of fish standing at (x, y). */
function fishBasket(ctx, x, y) {
  ctx.fillStyle = '#b08850';
  ctx.beginPath(); ctx.ellipse(x, y - 1.5, 3.4, 1.7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(x - 3.4, y - 4, 6.8, 2.5);
  ctx.fillStyle = '#8f6a3a';
  ctx.beginPath(); ctx.ellipse(x, y - 4, 3.4, 1.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = FISH;
  for (const [dx, r] of [[-1.3, 0.4], [0.9, -0.3], [0, 0.1]]) {
    ctx.beginPath(); ctx.ellipse(x + dx, y - 4.4, 1.8, 0.6, r, 0, Math.PI * 2); ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Gulls over a fishing ground (drawn live by the renderer, not cached)
// ---------------------------------------------------------------------------

/**
 * A few gulls wheeling over the fishing ground at screen point (x, y) (the
 * water's surface, device px), and now and then a fish rising. `t` is the
 * time in seconds (0 for a still picture), `seed` keeps grounds out of step.
 */
export function drawGulls(ctx, x, y, k, t, seed) {
  // rings where fish rise
  for (let n = 0; n < 2; n++) {
    const p = (t * 0.35 + n * 0.5 + seed * 0.13) % 1;
    ctx.strokeStyle = `rgba(235,245,250,${0.45 * (1 - p)})`;
    ctx.lineWidth = 0.8 * k;
    ctx.beginPath();
    ctx.ellipse(x + (n ? 9 : -7) * k, y + (n ? -2 : 3) * k, (2 + p * 9) * k, (1 + p * 4.5) * k, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let g = 0; g < 4; g++) {
    const a = t * (0.55 + g * 0.08) + g * 1.7 + seed;
    const r = (12 + g * 4) * k;
    const gx = x + Math.cos(a) * r;
    const gy = y - (26 + g * 5 + Math.sin(a * 1.3) * 3) * k + Math.sin(a) * r * 0.45;
    const flap = Math.sin(t * 9 + g * 2.1) * 1.8 * k;
    const s = (4.8 + (g % 2) * 0.8) * k;
    // shadow on the water
    ctx.fillStyle = 'rgba(0,30,50,0.18)';
    ctx.beginPath(); ctx.ellipse(gx, y + Math.sin(a) * r * 0.45 + 2 * k, s * 0.7, s * 0.25, 0, 0, Math.PI * 2); ctx.fill();
    // the bird: a white body and two wings in a shallow V
    ctx.strokeStyle = '#f4f6f6';
    ctx.lineWidth = 1.5 * k;
    ctx.beginPath();
    ctx.moveTo(gx - s, gy - flap);
    ctx.quadraticCurveTo(gx - s * 0.4, gy - flap * 0.2 - 0.8 * k, gx, gy);
    ctx.quadraticCurveTo(gx + s * 0.4, gy - flap * 0.2 - 0.8 * k, gx + s, gy - flap);
    ctx.stroke();
    ctx.strokeStyle = '#5a6066'; // dark wing tips
    ctx.lineWidth = 1.2 * k;
    ctx.beginPath();
    ctx.moveTo(gx - s, gy - flap); ctx.lineTo(gx - s * 0.75, gy - flap * 0.8);
    ctx.moveTo(gx + s, gy - flap); ctx.lineTo(gx + s * 0.75, gy - flap * 0.8);
    ctx.stroke();
  }
}

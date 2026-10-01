/**
 * navyArt.js
 * ----------------------------------------------------------------------------
 * Procedural art for the fleet's two buildings (all original):
 *
 *   Navalia        the naval dockyard: an open slipway running down into the
 *                  water, with a liburnian's hull on it while one is built (the
 *                  keel and bare frames, then planked, its ram fitted); a long
 *                  roofed ship shed beside it, open to the water; stacks of
 *                  timber, a bolt of sail linen and the shipwrights' hut at the
 *                  back; a sheerlegs crane at the water's edge.
 *   Naval Station  a stone quay with two short moles for the berths, stone
 *                  bollards along its edge, the crews' hall, racks of spare
 *                  oars and a stone watch post flying Rome's red.
 *
 * Both stand on the bank with one edge facing the water, like the dock and
 * the fishing buildings: designed with the water on the +u edge and turned
 * into place by `side` (0 = -v, 1 = +u, 2 = +v, 3 = -u; sim/trade.js
 * dockBerth). Painter's order: back (small u+v after turning) first.
 * ----------------------------------------------------------------------------
 */

import { P, poly, quad, box, gableRoof, hipRoof, shade } from './draw.js';
import { turner, turnedRect, paint, post } from './waterArt.js';

const WOOD = '#8a5a33';
const WOOD_DARK = '#5e3b20';
const WOOD_PALE = '#b88a58';
const STONE = '#c4b89c';
const STONE_DARK = '#968b72';
const TERRA = '#b8573a';
const ROME_RED = '#a8322b';
const BRONZE = '#b8862e';

// ---------------------------------------------------------------------------
// Navalia
// ---------------------------------------------------------------------------

/** state = side + 4 * stage (stage 0: empty slip, 1: keel and frames, 2: planked, ram fitted). */
export function navaliaArt(ctx, S, variant, state = 1) {
  const side = state % 4;
  const stage = Math.floor(state / 4);
  const T = turner(S, side);
  const Q = (u, v, z = 0) => P(...T(u, v), z);
  const at = (u, v) => { const [a, b] = T(u, v); return a + b; };
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, '#b3a17c');
  // the slipway: sleepers and two rails sloping down into the water
  const slipZ = (u) => 4 * Math.max(0, 1 - (u - 0.9) / (S - 0.9));
  ctx.strokeStyle = shade(WOOD, -0.1);
  ctx.lineWidth = 1.2;
  for (let u = 1.0; u < S; u += 0.2) {
    const a = Q(u, 0.45, slipZ(u));
    const b = Q(u, 1.25, slipZ(u));
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 1.1;
  for (const v of [0.62, 1.08]) {
    const a = Q(0.9, v, 4);
    const b = Q(S + 0.05, v, 0);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  const items = [];
  // timber stacks at the back of the yard: sawn planks and a pile of logs
  const planks = turnedRect(T, 0.1, 0.1, 0.6, 0.5);
  items.push({ d: planks[0] + planks[1], draw: () => {
    for (let k = 0; k < 4; k++) box(ctx, planks[0], planks[1], planks[2], planks[3], k * 2, 2, k % 2 ? WOOD_PALE : '#a57a4a', { plain: true });
  } });
  items.push({ d: at(0.4, 0.95), draw: () => {
    for (const [u, v, z] of [[0.18, 0.8, 0], [0.18, 1.0, 0], [0.18, 1.2, 0], [0.18, 0.9, 2.6], [0.18, 1.1, 2.6]]) {
      const a = Q(u, v, z + 1.3);
      const b = Q(u + 0.55, v, z + 1.3);
      ctx.strokeStyle = '#7a5230';
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      ctx.fillStyle = '#c9a06a'; // the sawn ends
      ctx.beginPath(); ctx.arc(b[0], b[1], 1.3, 0, Math.PI * 2); ctx.fill();
    }
  } });
  // the shipwrights' hut, and a bolt of sail linen on trestles by it
  const hut = turnedRect(T, 0.1, 1.75, 0.68, 1.05);
  items.push({ d: hut[0] + hut[1], draw: () => {
    box(ctx, hut[0], hut[1], hut[2], hut[3], 0, 12, '#d6c6a0');
    gableRoof(ctx, hut[0], hut[1], hut[2], hut[3], 12, 7, TERRA, hut[2] >= hut[3] ? 'u' : 'v');
  } });
  const linen = turnedRect(T, 0.95, 2.95 - 0.32, 0.36, 0.22);
  items.push({ d: linen[0] + linen[1] + 0.3, draw: () => box(ctx, linen[0], linen[1], linen[2], linen[3], 3, 2.5, '#ece6d2', { plain: true }) });
  // the ship shed: a long tiled roof on pillars, open to the water
  const shed = turnedRect(T, 1.0, 1.62, S - 1.05, 1.18);
  items.push({ d: shed[0] + shed[1] + 0.4, draw: () => {
    quad(ctx, shed[0], shed[1], shed[0] + shed[2], shed[1] + shed[3], 0.5, 'rgba(60,45,30,0.45)');
    for (const u of [1.05, 1.6, 2.15, S - 0.12]) {
      for (const v of [1.66, 2.74]) {
        const [x, y] = Q(u, v);
        ctx.fillStyle = shade(STONE, -0.08);
        ctx.fillRect(x - 1.3, y - 15, 2.6, 15);
      }
    }
    gableRoof(ctx, shed[0], shed[1], shed[2], shed[3], 15, 8, TERRA, shed[2] >= shed[3] ? 'u' : 'v', 0.04);
  } });
  // the sheerlegs crane at the water's edge, between slip and shed
  items.push({ d: at(S - 0.15, 1.45), draw: () => {
    const [x, y] = Q(S - 0.15, 1.45);
    ctx.strokeStyle = WOOD_DARK;
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(x - 3.5, y); ctx.lineTo(x, y - 26); ctx.lineTo(x + 3.5, y); ctx.stroke();
    const tip = Q(S - 0.55, 0.95, 26);
    ctx.beginPath(); ctx.moveTo(x, y - 26); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
    ctx.strokeStyle = '#3a3026';
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(tip[0], tip[1]); ctx.lineTo(tip[0], tip[1] + 10); ctx.stroke();
    ctx.fillStyle = '#6b4a2a';
    ctx.fillRect(tip[0] - 1.5, tip[1] + 10, 3, 2.5);
  } });
  if (stage > 0) items.push({ d: at(1.9, 0.85) + 0.1, draw: () => hullOnSlip(ctx, Q, at, stage, slipZ) });
  paint(items);
}

/**
 * A liburnian on the slip, its bow (and ram) toward the water: the keel and
 * stem, then bare frames (stage 1) or planked sides with the oar box, the
 * red band and the bronze ram (stage 2); the far side first.
 */
function hullOnSlip(ctx, Q, at, stage, slipZ) {
  const U0 = 1.0;
  const U1 = 2.7;
  const V = 0.85;
  const half = (u) => 0.34 * Math.sin(Math.PI * Math.min(1, (u - U0 + 0.2) / (U1 - U0 + 0.2)));
  const z = (u) => slipZ(u) + 1;
  const us = [];
  for (let u = U0; u <= U1 + 1e-9; u += (U1 - U0) / 10) us.push(u);
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 1.8;
  const k0 = Q(U0, V, z(U0));
  const k1 = Q(U1, V, z(U1));
  const stem = Q(U1 + 0.1, V, z(U1) + 13);
  ctx.beginPath(); ctx.moveTo(k0[0], k0[1]); ctx.lineTo(k1[0], k1[1]); ctx.lineTo(stem[0], stem[1]); ctx.stroke();
  const stern = Q(U0 - 0.12, V, z(U0) + 14);
  ctx.beginPath(); ctx.moveTo(k0[0], k0[1]); ctx.quadraticCurveTo(...Q(U0 - 0.2, V, z(U0) + 6), stern[0], stern[1]); ctx.stroke();
  const sides = at(1.8, V - 0.3) < at(1.8, V + 0.3) ? [-1, 1] : [1, -1];
  if (stage === 1) {
    ctx.strokeStyle = '#c79a5e';
    ctx.lineWidth = 1;
    for (const u of us.slice(1, -1)) {
      const w = half(u);
      const a = Q(u, V - w, z(u) + 9);
      const c = Q(u, V, z(u) - 1);
      const b = Q(u, V + w, z(u) + 9);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(c[0], c[1], b[0], b[1]); ctx.stroke();
    }
    return;
  }
  for (const s of sides) {
    const top = us.map((u) => Q(u, V + s * half(u), z(u) + 9));
    const keel = us.map((u) => Q(u, V, z(u) + 1)).reverse();
    const near = s === sides[1];
    poly(ctx, [...top, ...keel], near ? '#6e4a2c' : '#5a3a22', shade(WOOD_DARK, -0.2), 0.6);
    if (!near) continue;
    // the red band under the rail, and the oar ports along the side
    ctx.strokeStyle = ROME_RED;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    us.forEach((u, i) => { const p = Q(u, V + s * half(u) * 0.97, z(u) + 7.6); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
    ctx.stroke();
    ctx.fillStyle = '#2e1e12';
    for (const u of us.slice(2, -2)) {
      const p = Q(u, V + s * half(u) * 0.95, z(u) + 5);
      ctx.fillRect(p[0] - 0.6, p[1] - 0.5, 1.2, 1);
    }
  }
  // the bronze ram at the bow's foot
  const r0 = Q(U1 - 0.05, V, z(U1) + 3.5);
  const r1 = Q(U1 + 0.35, V, z(U1) + 2);
  const r2 = Q(U1 - 0.05, V, z(U1) + 0.5);
  poly(ctx, [r0, r1, r2], BRONZE, shade(BRONZE, -0.3), 0.6);
}

// ---------------------------------------------------------------------------
// Naval Station
// ---------------------------------------------------------------------------

/** state = side (the edge facing the water). */
export function stationArt(ctx, S, variant, state = 1) {
  const side = state % 4;
  const T = turner(S, side);
  const Q = (u, v, z = 0) => P(...T(u, v), z);
  const at = (u, v) => { const [a, b] = T(u, v); return a + b; };
  // the paved quay with its joints
  quad(ctx, 0.02, 0.02, S - 0.02, S - 0.02, 0, STONE);
  ctx.strokeStyle = 'rgba(90,80,62,0.35)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let u = 0.5; u < S; u += 0.5) { const a = Q(u, 0.04); const b = Q(u, S - 0.04); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
  for (let v = 0.5; v < S; v += 0.5) { const a = Q(0.04, v); const b = Q(S - 0.04, v); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
  ctx.stroke();
  const items = [];
  // the quay's edge and two short moles out into the water: the berths
  const edge = turnedRect(T, S - 0.24, 0.02, 0.26, S - 0.04);
  items.push({ d: edge[0] + edge[1] + 0.5, draw: () => box(ctx, edge[0], edge[1], edge[2], edge[3], 0, 3, STONE_DARK, { plain: true }) });
  for (const v of [0.55, 2.2]) {
    const mole = turnedRect(T, S - 0.1, v, 0.5, 0.26);
    items.push({ d: mole[0] + mole[1] + 0.6, draw: () => box(ctx, mole[0], mole[1], mole[2], mole[3], 0, 3, shade(STONE_DARK, -0.05), { plain: true }) });
  }
  // stone bollards along the edge
  for (const v of [0.3, 1.25, 1.95, 2.75]) {
    items.push({ d: at(S - 0.12, v) + 0.7, draw: () => {
      const [x, y] = Q(S - 0.12, v, 3);
      ctx.fillStyle = '#7d7462';
      ctx.fillRect(x - 1.4, y - 3.5, 2.8, 3.5);
      ctx.fillStyle = '#a49a84';
      ctx.fillRect(x - 1.8, y - 4.4, 3.6, 1.2);
    } });
  }
  // the watch post: a stone tower with a tiled roof and Rome's red pennant
  const tower = turnedRect(T, 0.12, 0.12, 0.72, 0.72);
  items.push({ d: tower[0] + tower[1], draw: () => {
    box(ctx, tower[0], tower[1], tower[2], tower[3], 0, 30, '#d2c6aa');
    hipRoof(ctx, tower[0], tower[1], tower[2], tower[3], 30, 8, TERRA);
    const [wx, wy] = P(tower[0] + tower[2], tower[1] + tower[3] * 0.5, 22);
    ctx.fillStyle = '#3a3026';
    ctx.fillRect(wx - 1, wy - 3, 2, 4);
    const [px, py] = P(tower[0] + tower[2] / 2, tower[1] + tower[3] / 2, 38);
    post(ctx, px, py, 11, 1.1);
    ctx.fillStyle = ROME_RED;
    ctx.beginPath();
    ctx.moveTo(px + 0.5, py - 11);
    ctx.lineTo(px + 8, py - 10);
    ctx.lineTo(px + 6.5, py - 8);
    ctx.lineTo(px + 8, py - 6);
    ctx.lineTo(px + 0.5, py - 6.5);
    ctx.closePath();
    ctx.fill();
  } });
  // the crews' hall
  const hall = turnedRect(T, 0.12, 1.15, 1.05, 1.72);
  items.push({ d: hall[0] + hall[1] + 0.2, draw: () => {
    box(ctx, hall[0], hall[1], hall[2], hall[3], 0, 13, '#e2d6b8');
    gableRoof(ctx, hall[0], hall[1], hall[2], hall[3], 13, 7, TERRA, hall[2] >= hall[3] ? 'u' : 'v');
  } });
  // spare oars racked upright, and coils of rope
  // (laid out across the screen, so the rack reads as a row whichever way the quay faces)
  items.push({ d: at(1.7, 1.0), draw: () => {
    const [cx, cy] = Q(1.7, 1.0);
    ctx.fillStyle = WOOD_DARK; // the rack's rail
    ctx.fillRect(cx - 8, cy - 12, 16, 1.2);
    ctx.strokeStyle = '#8a6a44';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (let k = 0; k < 7; k++) {
      const x = cx - 7 + k * 2.3;
      ctx.moveTo(x, cy);
      ctx.lineTo(x + 1.2, cy - 17);
    }
    ctx.stroke();
    ctx.fillStyle = WOOD_PALE; // the blades at the top
    for (let k = 0; k < 7; k++) ctx.fillRect(cx - 7 + k * 2.3 + 0.5, cy - 19.5, 1.6, 3.8);
  } });
  for (const [u, v] of [[1.75, 2.1], [2.05, 2.4]]) {
    items.push({ d: at(u, v), draw: () => {
      const [x, y] = Q(u, v);
      ctx.strokeStyle = '#a58a5a';
      ctx.lineWidth = 1.2;
      for (let r = 3.2; r > 0.8; r -= 1) { ctx.beginPath(); ctx.ellipse(x, y - 1, r, r * 0.5, 0, 0, Math.PI * 2); ctx.stroke(); }
    } });
  }
  paint(items);
}

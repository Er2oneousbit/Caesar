/**
 * hippodromeArt.js
 * ----------------------------------------------------------------------------
 * Procedural art for the hippodrome and the chariot maker (all original).
 *
 * The hippodrome is 15 x 5 tiles: three 5 x 5 sections along u (the map's x
 * axis), each its own building and sprite (sim/entities.js linkedGroup).
 * Every section draws its stretch of one long design, in track coordinates
 * U = u + 5 x section:
 *   - a sand track between stands on both long sides: the back stand shows
 *     its tiers of seats, the front stand its arcaded outer wall
 *   - section 0: the rounded end, the stands curving around it
 *   - the spina down the middle: a low marble wall with a water channel,
 *     the turning posts at each end, an obelisk at the middle, the lap
 *     counters (eggs and dolphins) and statues
 *   - section 2: the starting gates, a row of arched stalls between towers
 * The sections meet without a seam because they share the design.
 * ----------------------------------------------------------------------------
 */

import { P, poly, quad, box, gableRoof, shade, horse } from './draw.js';

const SECTION = 5;
const SAND = '#d9c48f';
const SEATS = '#cdbf9e';
const STONE = '#b9ad95';
const MARBLE = '#ece6da';
const GOLD = '#d6ab3c';
const WATER = '#5d9ac4';
const V_IN0 = 0.95; // the track's back edge
const V_IN1 = 4.05; // its front edge
const V_OUT0 = 0.08; // the back stand's outer wall
const V_OUT1 = 4.92; // the front stand's outer wall
const H_BACK = 16; // the back stand's height (px)
const H_FRONT = 10; // the front stand's, lower so the track shows over it
const CURVE_U = 2.5; // centre of the rounded end
const GATES_U = 13.55; // where the starting gates begin
const SPINA = [2.9, 12.1]; // the spina's ends (the turning posts)

/** Section `section`'s stretch (state = section 0..2). */
export function hippodromeArt(ctx, S, variant, section = 0) {
  const u0 = section * SECTION;
  const Q = (U, v, z = 0) => P(U - u0, v, z);
  const lo = Math.max(u0, section === 0 ? CURVE_U : u0); // straight stands from here...
  const hi = Math.min(u0 + SECTION, GATES_U); // ...to here
  // the ground and the sand of the track
  quad(ctx, 0.02, 0.02, S - 0.02, S - 0.02, 0, '#bfae84');
  if (section === 0) {
    poly(ctx, curve(Q, 1.55, 0, Math.PI / 2, Math.PI * 1.5).concat([Q(u0 + S, V_IN0), Q(u0 + S, V_IN1)]), SAND);
  } else {
    quad(ctx, 0, V_IN0, S, V_IN1, 0, SAND);
  }
  ruts(ctx, Q, u0, section);
  // the back stand (its seats face the viewer)
  if (section === 0) curvedBank(ctx, Q, Math.PI, Math.PI * 1.5, true);
  if (hi > lo) straightBank(ctx, Q, lo, hi, true);
  // the spina and what stands on it
  spina(ctx, Q, u0);
  // the starting gates, then the front stand (its outer wall faces the viewer)
  if (section === 2) gates(ctx);
  if (hi > lo) straightBank(ctx, Q, lo, hi, false);
  if (section === 0) curvedBank(ctx, Q, Math.PI / 2, Math.PI, false);
}

/** Points on an arc around the rounded end's centre: radius r (in tiles), at height z. */
function curve(Q, r, z, a0, a1, n = 14) {
  const out = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n;
    out.push(Q(CURVE_U + Math.cos(a) * r, 2.5 + Math.sin(a) * r, z));
  }
  return out;
}

/** Faint wheel ruts worn around the spina. */
function ruts(ctx, Q, u0, section) {
  ctx.strokeStyle = 'rgba(120,95,55,0.28)';
  ctx.lineWidth = 1.2;
  const lo = Math.max(u0, SPINA[0]);
  const hi = Math.min(u0 + SECTION, GATES_U);
  for (const v of [1.55, 1.85, 3.15, 3.45]) {
    if (hi <= lo) break;
    const a = Q(lo, v);
    const b = Q(hi, v);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  if (section !== 0) return;
  for (const r of [0.65, 0.95]) {
    ctx.beginPath();
    for (let k = 0; k <= 16; k++) {
      const a = Math.PI / 2 + (Math.PI * k) / 16;
      const [x, y] = Q(SPINA[0] + Math.cos(a) * r * 1.2, 2.5 + Math.sin(a) * r);
      if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
}

/**
 * A straight stand from U = a to b: the back one (`back`) rises away from the
 * viewer, so its rows of seats show; the front one rises toward him, so its
 * arcaded outer wall shows.
 */
function straightBank(ctx, Q, a, b, back) {
  const vIn = back ? V_IN0 : V_IN1;
  const vOut = back ? V_OUT0 : V_OUT1;
  const H = back ? H_BACK : H_FRONT;
  // the sloping seats, row by row
  const rows = 5;
  for (let r = 0; r < rows; r++) {
    const v0 = vIn + ((vOut - vIn) * r) / rows;
    const v1 = vIn + ((vOut - vIn) * (r + 1)) / rows;
    const z0 = 3 + ((H - 3) * r) / rows;
    const z1 = 3 + ((H - 3) * (r + 1)) / rows;
    poly(ctx, [Q(a, v0, z0), Q(b, v0, z0), Q(b, v1, z1), Q(a, v1, z1)], r % 2 ? SEATS : shade(SEATS, -0.06));
  }
  // the low podium wall along the track
  poly(ctx, [Q(a, vIn, 0), Q(b, vIn, 0), Q(b, vIn, 3), Q(a, vIn, 3)], shade(STONE, back ? -0.05 : -0.25));
  if (back) {
    // a parapet along the top, and spectators dotted on the seats
    poly(ctx, [Q(a, vOut, H), Q(b, vOut, H), Q(b, vOut, H + 3), Q(a, vOut, H + 3)], shade(STONE, 0.05), shade(STONE, -0.4), 0.5);
    crowd(ctx, Q, a, b, vIn, vOut, H);
    return;
  }
  // the front stand's outer wall with its arches
  poly(ctx, [Q(a, vOut, 0), Q(b, vOut, 0), Q(b, vOut, H), Q(a, vOut, H)], STONE, shade(STONE, -0.45), 0.6);
  ctx.fillStyle = 'rgba(50,40,30,0.55)';
  for (let U = Math.ceil(a * 2.5) / 2.5 + 0.2; U < b - 0.1; U += 0.4) {
    const [x, y] = Q(U, vOut, 1);
    ctx.beginPath();
    ctx.moveTo(x - 2, y + 1); ctx.lineTo(x - 2, y - 4); ctx.arc(x, y - 4, 2, Math.PI, 0); ctx.lineTo(x + 2, y + 1);
    ctx.fill();
  }
  crowd(ctx, Q, a, b, vIn, vOut, H);
}

/** Spectators: dots of colour on the seats, the same every time (no randomness). */
function crowd(ctx, Q, a, b, vIn, vOut, H) {
  const colors = ['#b8573a', '#efe6d0', '#5d7fa3', '#d9a13a', '#7a9c5a', '#efe6d0'];
  let k = 0;
  for (let U = a + 0.12; U < b - 0.05; U += 0.23) {
    for (let r = 1; r < 5; r += 1.3) {
      const t = r / 5;
      const [x, y] = Q(U + (r % 2) * 0.1, vIn + (vOut - vIn) * t, 3 + (H - 3) * t + 1);
      if ((Math.floor(U * 13) + Math.floor(r * 3)) % 3 === 0) continue;
      ctx.fillStyle = colors[k++ % colors.length];
      ctx.fillRect(x - 0.8, y - 1.6, 1.6, 1.8);
    }
  }
}

/** The rounded end's stand, between angles a0 and a1 (back half or front half). */
function curvedBank(ctx, Q, a0, a1, back) {
  const H = back ? H_BACK : H_FRONT;
  const rIn = 1.55;
  const rOut = 2.42;
  const rows = 5;
  for (let r = 0; r < rows; r++) {
    const ra = rIn + ((rOut - rIn) * r) / rows;
    const rb = rIn + ((rOut - rIn) * (r + 1)) / rows;
    const z0 = 3 + ((H - 3) * r) / rows;
    const z1 = 3 + ((H - 3) * (r + 1)) / rows;
    poly(ctx, [...curve(Q, ra, z0, a0, a1), ...curve(Q, rb, z1, a0, a1).reverse()], r % 2 ? SEATS : shade(SEATS, -0.06));
  }
  poly(ctx, [...curve(Q, rIn, 0, a0, a1), ...curve(Q, rIn, 3, a0, a1).reverse()], shade(STONE, -0.15));
  if (back) {
    poly(ctx, [...curve(Q, rOut, H, a0, a1), ...curve(Q, rOut, H + 3, a0, a1).reverse()], shade(STONE, 0.05), shade(STONE, -0.4), 0.5);
    return;
  }
  // the outer wall of the front half, with arches
  const outer = curve(Q, rOut, 0, a0, a1);
  const top = curve(Q, rOut, H, a0, a1);
  poly(ctx, [...outer, ...top.reverse()], STONE, shade(STONE, -0.45), 0.6);
  ctx.fillStyle = 'rgba(50,40,30,0.55)';
  for (const [x, y] of curve(Q, rOut, 1, a0, a1, 7).slice(1, -1)) {
    ctx.beginPath();
    ctx.moveTo(x - 2, y + 1); ctx.lineTo(x - 2, y - 4); ctx.arc(x, y - 4, 2, Math.PI, 0); ctx.lineTo(x + 2, y + 1);
    ctx.fill();
  }
}

/** The spina's stretch in this section, and what stands on it. */
function spina(ctx, Q, u0) {
  const a = Math.max(u0, SPINA[0]);
  const b = Math.min(u0 + SECTION, SPINA[1]);
  if (b > a) {
    box(ctx, a - u0, 2.32, b - a, 0.36, 0, 4, MARBLE, { plain: true });
    quad(ctx, a - u0 + 0.05, 2.42, b - u0 - 0.05, 2.58, 4.2, WATER); // the water channel
  }
  const inHere = (U) => U >= u0 && U < u0 + SECTION;
  for (const U of SPINA) if (inHere(U)) meta(ctx, Q, U);
  if (inHere(7.5)) obelisk(ctx, Q, 7.5);
  if (inHere(5.8)) counter(ctx, Q, 5.8, 'eggs');
  if (inHere(9.2)) counter(ctx, Q, 9.2, 'dolphins');
  for (const U of [4.1, 10.9]) if (inHere(U)) statue(ctx, Q, U);
}

/** A turning post: three gilded cones on a half-round base. */
function meta(ctx, Q, U) {
  const [x, y] = Q(U, 2.5, 4);
  ctx.fillStyle = shade(MARBLE, -0.1);
  ctx.beginPath(); ctx.ellipse(x, y, 7, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  for (const dx of [-3.5, 0, 3.5]) {
    ctx.fillStyle = '#a99a7e';
    ctx.beginPath(); ctx.moveTo(x + dx - 1.8, y); ctx.lineTo(x + dx, y - 12); ctx.lineTo(x + dx + 1.8, y); ctx.fill();
    ctx.fillStyle = GOLD;
    ctx.beginPath(); ctx.arc(x + dx, y - 12, 1.1, 0, Math.PI * 2); ctx.fill();
  }
}

/** The obelisk at the middle of the spina, on its pedestal. */
function obelisk(ctx, Q, U) {
  const [x, y] = Q(U, 2.5, 4);
  ctx.fillStyle = shade(MARBLE, -0.08);
  ctx.fillRect(x - 4, y - 8, 8, 6);
  ctx.fillStyle = MARBLE;
  ctx.fillRect(x - 4.5, y - 9, 9, 1.6);
  const base = y - 9;
  ctx.fillStyle = '#c9a77a';
  ctx.beginPath(); ctx.moveTo(x - 2.6, base); ctx.lineTo(x - 1.6, base - 28); ctx.lineTo(x, base - 31); ctx.lineTo(x, base); ctx.fill();
  ctx.fillStyle = '#a8865c';
  ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, base - 31); ctx.lineTo(x + 1.6, base - 28); ctx.lineTo(x + 2.6, base); ctx.fill();
  ctx.fillStyle = GOLD;
  ctx.beginPath(); ctx.moveTo(x - 1.6, base - 28); ctx.lineTo(x, base - 31); ctx.lineTo(x + 1.6, base - 28); ctx.fill();
}

/** A lap counter: two posts and a beam with seven eggs or seven dolphins. */
function counter(ctx, Q, U, kind) {
  const a = Q(U - 0.3, 2.5, 4);
  const b = Q(U + 0.3, 2.5, 4);
  ctx.fillStyle = MARBLE;
  ctx.fillRect(a[0] - 1, a[1] - 11, 2, 11);
  ctx.fillRect(b[0] - 1, b[1] - 11, 2, 11);
  ctx.strokeStyle = shade(MARBLE, -0.2);
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(a[0], a[1] - 11); ctx.lineTo(b[0], b[1] - 11); ctx.stroke();
  for (let k = 0; k < 7; k++) {
    const x = a[0] + ((b[0] - a[0]) * (k + 0.5)) / 7;
    const y = a[1] + ((b[1] - a[1]) * (k + 0.5)) / 7 - 12.5;
    ctx.fillStyle = kind === 'eggs' ? '#f3ecd8' : '#7fa0b4';
    ctx.beginPath();
    if (kind === 'eggs') ctx.ellipse(x, y, 0.8, 1.1, 0, 0, Math.PI * 2);
    else ctx.ellipse(x, y, 1.2, 0.6, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A statue on a little pedestal on the spina. */
function statue(ctx, Q, U) {
  const [x, y] = Q(U, 2.5, 4);
  ctx.fillStyle = MARBLE;
  ctx.fillRect(x - 2, y - 4, 4, 4);
  ctx.fillStyle = '#6f8f7c'; // bronze, green with age
  ctx.fillRect(x - 1, y - 11, 2, 7);
  ctx.beginPath(); ctx.arc(x, y - 12, 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(x + 0.5, y - 10, 2.5, 0.8); // an arm raised to the riders
}

/**
 * The starting gates: the stalls' building across the open end, a tower at
 * each end. Its arches show on the face toward the viewer (the stalls open
 * on the far side, onto the track).
 */
function gates(ctx) {
  const u0 = 2 * SECTION;
  const uA = GATES_U - u0;
  const du = SECTION - 0.08 - uA;
  // the stalls' building
  box(ctx, uA, V_IN0, du, V_IN1 - V_IN0, 0, 12, '#d8ccb2');
  quad(ctx, uA, V_IN0, uA + du, V_IN1, 12, shade('#d8ccb2', 0.12));
  ctx.fillStyle = 'rgba(60,45,30,0.55)';
  const stalls = 8;
  for (let k = 0; k < stalls; k++) {
    const v = V_IN0 + ((V_IN1 - V_IN0) * (k + 0.5)) / stalls;
    const [x, y] = P(uA + du, v, 1);
    ctx.beginPath();
    ctx.moveTo(x - 2.2, y + 1); ctx.lineTo(x - 2.2, y - 6); ctx.arc(x, y - 6, 2.2, Math.PI, 0); ctx.lineTo(x + 2.2, y + 1);
    ctx.fill();
  }
  // a tower at each end, with a pennant
  for (const v of [V_IN0 - 0.05, V_IN1 - 0.6]) {
    box(ctx, uA - 0.05, v, du + 0.05, 0.65, 0, 20, '#e2d6bc');
    gableRoof(ctx, uA - 0.05, v, du + 0.05, 0.65, 20, 6, '#b8573a', 'u');
    const [x, y] = P(uA + du / 2, v + 0.32, 26);
    ctx.fillStyle = '#4a3222';
    ctx.fillRect(x - 0.5, y - 9, 1, 9);
    ctx.fillStyle = v < 2 ? '#2f6db5' : '#b8573a'; // the factions' colours
    ctx.beginPath(); ctx.moveTo(x + 0.5, y - 9); ctx.lineTo(x + 6, y - 7.5); ctx.lineTo(x + 0.5, y - 6); ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Chariot maker
// ---------------------------------------------------------------------------

/**
 * Chariot maker: a workshop with an open front, a finished racing chariot in
 * the yard, wheels waiting to be fitted, and a stable with a horse looking out.
 */
export function chariotMakerArt(ctx, S) {
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, '#c2b08a');
  // the workshop along the back
  box(ctx, 0.1, 0.1, S - 0.2, 0.9, 0, 16, '#d9c6a0');
  gableRoof(ctx, 0.1, 0.1, S - 0.2, 0.9, 16, 8, '#a45b44', 'u');
  // its open front: a dark doorway with a workbench inside
  poly(ctx, [P(0.6, 1.0, 0), P(1.9, 1.0, 0), P(1.9, 1.0, 11), P(0.6, 1.0, 11)], 'rgba(40,30,20,0.6)');
  // the stable along the side, a horse at its door
  box(ctx, 0.1, 1.05, 0.8, S - 1.15, 0, 13, '#c8b48c');
  gableRoof(ctx, 0.1, 1.05, 0.8, S - 1.15, 13, 6, '#93432c', 'v');
  const [hx, hy] = P(1.2, 2.2);
  horse(ctx, hx, hy, 0.75, '#7a4a2c', 1, 0.3);
  // spare wheels leaning on the workshop wall
  for (const [u, r] of [[2.2, 4], [2.55, 3.6]]) {
    const [x, y] = P(u, 1.05, 4);
    wheel(ctx, x, y, r);
  }
  // the finished chariot in the yard, its pole toward the gate
  const [cx, cy] = P(2.15, 2.15);
  chariotBody(ctx, cx, cy, 1, '#b8573a');
}

/** A spoked wheel of radius r at (x, y). */
function wheel(ctx, x, y, r) {
  ctx.strokeStyle = '#4a3222';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(x, y, r * 0.6, r, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let k = 0; k < 4; k++) {
    const a = (Math.PI * k) / 4;
    ctx.moveTo(x - Math.cos(a) * r * 0.6, y - Math.sin(a) * r);
    ctx.lineTo(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r);
  }
  ctx.stroke();
}

/** A two-wheeled racing chariot standing at (x, y), painted `color`, scale s. */
export function chariotBody(ctx, x, y, s, color) {
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); ctx.ellipse(x, y, 6 * s, 2 * s, 0, 0, Math.PI * 2); ctx.fill();
  // the pole, forward to where the horses are yoked
  ctx.strokeStyle = '#5e3b20';
  ctx.lineWidth = 1 * s;
  ctx.beginPath(); ctx.moveTo(x + 2 * s, y - 3.5 * s); ctx.lineTo(x + 11 * s, y - 6 * s); ctx.stroke();
  wheel(ctx, x - 0.5 * s, y - 3.5 * s, 3.6 * s);
  // the car: a curved front breastwork
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - 3 * s, y - 4 * s);
  ctx.lineTo(x + 2.5 * s, y - 4 * s);
  ctx.quadraticCurveTo(x + 3.5 * s, y - 8 * s, x + 2 * s, y - 10 * s);
  ctx.lineTo(x - 1 * s, y - 9 * s);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = GOLD;
  ctx.fillRect(x - 2.5 * s, y - 5 * s, 5 * s, 0.9 * s);
}

/**
 * liveArt.js
 * ----------------------------------------------------------------------------
 * Small animated details drawn on top of building sprites every frame:
 *
 *   drawFlag()       flag and banner cloth fluttering in the wind (the poles
 *                    are in the sprite; see buildingArt.js FLAG_SPECS)
 *   drawShoppers()   people browsing along the front of a stocked market
 *   drawCrowd()      spectators in a theater or arena while a show is on
 *   drawAltarFlame() the small fire on a temple's altar
 *   drawMapGate()    the gateway over the Imperial road at the map entrance
 *                    (green pennants) and exit (red pennants)
 *
 * Like walkerArt.js, these work in device pixels: (ox, oy) is a building's
 * footprint top corner on screen and k the pixel scale (zoom * dpr). Local
 * art coordinates (from the building's sprite) are multiplied by k.
 * Everything here is visual only.
 * ----------------------------------------------------------------------------
 */

import { HALF_W, HALF_H } from '../config.js';
import { hash01, shade, SNOW } from './draw.js';

/** Tunic colors for crowds and shoppers. */
const CLOTHES = ['#b8573a', '#5d7fa3', '#d9a13a', '#7a9c5a', '#e8dcc0', '#8a5a8a', '#c9c2b0', '#a8322b'];
const SKIN = ['#e0b48f', '#c99a74', '#a8764f', '#eac3a0'];

/**
 * Flag cloth waving from a pole top at (sx, sy) (device px).
 * @param {{w:number,ch:number,color:string,swallow:boolean}} f  from flagsFor()
 */
export function drawFlag(ctx, sx, sy, k, f, t, seed = 0) {
  const N = 6;
  const w = f.w * k;
  const ch = f.ch * k;
  const top = new Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const ph = t * 6.5 - s * 3.4 + seed;
    // The free end moves most; the cloth bunches up a little as it waves.
    const wave = Math.sin(ph) * (0.25 + s) * 1.1 * k;
    top[i] = [sx + 0.6 * k + s * (w - 0.6 * k) * (0.93 + 0.07 * Math.cos(ph)), sy + wave];
  }
  ctx.fillStyle = f.color;
  ctx.beginPath();
  ctx.moveTo(top[0][0], top[0][1]);
  for (let i = 1; i <= N; i++) ctx.lineTo(top[i][0], top[i][1]);
  if (f.swallow) {
    const e = top[N];
    ctx.lineTo(e[0] - w * 0.2, e[1] + ch / 2);
  }
  for (let i = N; i >= 0; i--) ctx.lineTo(top[i][0], top[i][1] + ch);
  ctx.closePath();
  ctx.fill();
  // Folds: darken the parts of the cloth turned away from the light.
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let i = 0; i < N; i++) {
    if (top[i + 1][1] <= top[i][1]) continue;
    ctx.beginPath();
    ctx.moveTo(top[i][0], top[i][1]);
    ctx.lineTo(top[i + 1][0], top[i + 1][1]);
    ctx.lineTo(top[i + 1][0], top[i + 1][1] + ch);
    ctx.lineTo(top[i][0], top[i][1] + ch);
    ctx.closePath();
    ctx.fill();
  }
}

/** A tiny person: feet at (x, y), device px. */
function person(ctx, x, y, k, cloth, skin) {
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(x - 1.6 * k, y - 0.4 * k, 3.2 * k, 0.8 * k);
  ctx.fillStyle = shade(cloth, -0.25);
  ctx.fillRect(x - 1 * k, y - 2.2 * k, 2 * k, 2.2 * k); // legs/hem
  ctx.fillStyle = cloth;
  ctx.fillRect(x - 1.3 * k, y - 5.4 * k, 2.6 * k, 3.4 * k); // tunic
  ctx.fillStyle = skin;
  ctx.fillRect(x - 0.9 * k, y - 7.2 * k, 1.8 * k, 1.8 * k); // head
}

/**
 * Shoppers strolling along the two front edges of a market (in front of the
 * stalls, so they never need to hide behind an awning).
 */
export function drawShoppers(ctx, ox, oy, k, S, t, seed, count = 5) {
  for (let i = 0; i < count; i++) {
    // Ping-pong along the edge, lingering a little at each end.
    const raw = Math.sin(t * (0.28 + hash01(seed, i, 1) * 0.12) + hash01(seed, i, 2) * 6.28);
    const p = 0.5 + 0.5 * Math.max(-1, Math.min(1, raw * 1.25));
    const pos = 0.3 + p * (S - 0.6);
    const [u, v] = i % 2 ? [S - 0.1, pos] : [pos, S - 0.12];
    const x = ox + (u - v) * HALF_W * k;
    const moving = Math.abs(Math.cos(t * 0.3 + i)) > 0.2;
    const y = oy + (u + v) * HALF_H * k - (moving ? Math.abs(Math.sin(t * 8 + i * 1.7)) * 0.6 * k : 0);
    person(ctx, x, y, k, CLOTHES[(seed + i * 3) % CLOTHES.length], SKIN[(seed + i) % SKIN.length]);
  }
}

const crowdCache = new Map();

/** Local P(u, v, z) (same projection as draw.js). */
const lp = (u, v, z = 0) => [(u - v) * HALF_W, (u + v) * HALF_H - z];

/** Screen outline (hexagon) of an iso box, for hiding things behind it. */
function boxOutline(u0, v0, du, dv, h) {
  const u1 = u0 + du;
  const v1 = v0 + dv;
  return [lp(u0, v0, h), lp(u1, v0, h), lp(u1, v0, 0), lp(u1, v1, 0), lp(u0, v1, 0), lp(u0, v1, h)];
}

/** Point-in-polygon (even-odd rule). */
function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * Seats for spectators in local px (matching theaterArt / arenaArt), sorted
 * back to front. Cached per venue type and size.
 */
function crowdSeats(type, S) {
  const key = `${type}:${S}`;
  let seats = crowdCache.get(key);
  if (seats) return seats;
  seats = [];
  if (type === 'theater') {
    const cx = (S * 0.45 - S * 0.45) * HALF_W;
    const cy = (S * 0.45 + S * 0.45) * HALF_H;
    // The stage building (theaterArt: box u 0.35..S-0.35, v S-0.55..S-0.25,
    // 14 px tall) stands in front of part of the seating: skip seats behind it.
    const stage = boxOutline(0.35, S - 0.55, S - 0.7, 0.3, 14);
    for (let row = 0; row < 5; row++) {
      const rx = (28 - row * 4) * 0.88;
      const ry = (14 - row * 2) * 0.88;
      const n = 12 - row * 2;
      for (let j = 0; j < n; j++) {
        const a = Math.PI * (1.1 + (0.8 * (j + 0.5)) / n);
        const seat = [cx + Math.cos(a) * rx, cy + 4 - row * 2.5 + Math.sin(a) * ry - 0.5];
        if (!inside(stage, seat[0], seat[1] - 3)) seats.push(seat);
      }
    }
  } else {
    // Arena seating ring (see arenaArt): top at cy - h + 1, steps inward.
    const levels = type === 'colosseum' ? 3 : 2;
    const f = type === 'colosseum' ? 0.92 : 0.9;
    const cx = 0;
    const cy = S * HALF_H;
    const h = levels * 11;
    const rx0 = S * 28 * f;
    const ry0 = S * 14 * f;
    for (let step = 0; step < 5; step++) {
      const r = 0.87 - step * 0.065;
      const n = Math.round((type === 'colosseum' ? 64 : 40) * r);
      for (let j = 0; j < n; j++) {
        const a = ((j + step * 0.5) / n) * Math.PI * 2;
        const x = cx + Math.cos(a) * rx0 * r;
        const y = cy - h + 1 + step * 2 + Math.sin(a) * ry0 * r;
        // The sand floor (drawn over the ring in arenaArt) hides the inner front seats.
        const fx = x / (rx0 * 0.5);
        const fy = (y - 3 - (cy - 2)) / (ry0 * 0.5);
        if (fx * fx + fy * fy >= 1) seats.push([x, y]);
      }
    }
  }
  seats.sort((a, b) => a[1] - b[1]);
  crowdCache.set(key, seats);
  return seats;
}

/**
 * Spectators filling a venue during a show; some jump up and cheer.
 * `excitement` 0..1 (gladiator fights get the crowd going more).
 */
export function drawCrowd(ctx, ox, oy, k, type, S, t, seed, excitement = 0.4) {
  const seats = crowdSeats(type, S);
  for (let i = 0; i < seats.length; i++) {
    if (hash01(seed, i, 3) < 0.12) continue; // a few empty seats
    const [lx, ly] = seats[i];
    const cheer = hash01(seed, i, 4) < excitement ? Math.max(0, Math.sin(t * 7 + i * 1.3)) * 1.4 * k : 0;
    const x = ox + lx * k;
    const y = oy + ly * k - cheer;
    ctx.fillStyle = CLOTHES[(i * 7 + seed) % CLOTHES.length];
    ctx.fillRect(x - 1.1 * k, y - 2.2 * k, 2.2 * k, 1.8 * k); // shoulders
    ctx.fillStyle = SKIN[(i + seed) % SKIN.length];
    ctx.fillRect(x - 0.75 * k, y - 3.6 * k, 1.5 * k, 1.4 * k); // head
  }
}

/** A small flickering fire (temple altar), base at (sx, sy) in device px. */
export function drawAltarFlame(ctx, sx, sy, k, t, seed) {
  for (let f = 0; f < 2; f++) {
    const ph = t * 8 + seed + f * 2.4;
    const h = (4.5 + Math.sin(ph) * 1.2 - f * 1.4) * k;
    const x = sx + Math.sin(ph * 0.7) * 0.5 * k;
    ctx.fillStyle = f ? 'rgba(255,225,120,0.95)' : 'rgba(255,120,30,0.9)';
    const w = (f ? 1.1 : 1.9) * k;
    ctx.beginPath();
    ctx.moveTo(x - w, sy);
    ctx.quadraticCurveTo(x - w * 0.8, sy - h * 0.6, x, sy - h);
    ctx.quadraticCurveTo(x + w * 0.8, sy - h * 0.6, x + w, sy);
    ctx.closePath();
    ctx.fill();
  }
}

/** Height of a map gate's pillars (art px, before scaling). */
export const GATE_H = 34;

/**
 * The gateway over the Imperial road where it meets the map edge: two stone
 * pillars on either side of the road, a timber lintel with a colored plaque
 * between them and a pennant on each pillar (green at the entrance, where
 * settlers and caravans arrive; red at the exit, where people leave). Big
 * enough to spot at a glance: it is how the player finds the two ends.
 *
 * Drawn in two parts so people on the road pass between the pillars:
 * `part` 'back' is the pillar further from the viewer (drawn before the
 * walkers on the tile), 'front' the lintel and the nearer pillar (after).
 * (sx, sy) is the road tile's center on screen, (px, py) the offset from it
 * to one pillar (device px), `snow` 0..1 caps the stone with snow.
 */
export function drawMapGate(ctx, sx, sy, k, px, py, color, t, seed, part, snow = 0) {
  // The back pillar is the one higher on screen.
  const a = py <= 0 ? { x: sx + px, y: sy + py } : { x: sx - px, y: sy - py };
  const b = py <= 0 ? { x: sx - px, y: sy - py } : { x: sx + px, y: sy + py };
  const H = GATE_H * k;
  const pillar = (p, n) => {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(p.x + 2 * k, p.y, 5 * k, 2.2 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d6cbb0'; // plinth
    ctx.fillRect(p.x - 3.4 * k, p.y - 3 * k, 6.8 * k, 3 * k);
    ctx.fillStyle = '#cfc4a8'; // shaft
    ctx.fillRect(p.x - 2.6 * k, p.y - H, 5.2 * k, H - 3 * k);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(p.x + 0.6 * k, p.y - H, 2 * k, H); // shaded side
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let r = 1; r < 4; r++) ctx.fillRect(p.x - 2.6 * k, p.y - H + r * (H / 4), 5.2 * k, 0.6 * k); // stone courses
    ctx.fillStyle = '#e8e0c8';
    ctx.fillRect(p.x - 3.6 * k, p.y - H - 2.4 * k, 7.2 * k, 2.6 * k); // cap
    if (snow > 0) {
      ctx.fillStyle = SNOW;
      ctx.fillRect(p.x - 3.6 * k, p.y - H - (2.4 + snow * 1.6) * k, 7.2 * k, (0.8 + snow * 1.6) * k);
    }
    // pennant pole and cloth
    ctx.fillStyle = '#5e3b20';
    ctx.fillRect(p.x - 0.6 * k, p.y - H - 14 * k, 1.2 * k, 12 * k);
    ctx.fillStyle = '#d9b44a';
    ctx.fillRect(p.x - 1 * k, p.y - H - 15 * k, 2 * k, 1.4 * k); // gilded finial
    drawFlag(ctx, p.x, p.y - H - 13.5 * k, k, { w: 12, ch: 7, color, swallow: true }, t, seed + n * 1.7);
  };
  if (part === 'back') {
    pillar(a, 0);
    return;
  }
  // Lintel between the pillar tops, with the colored plaque in the middle.
  const ly = 3 * k;
  ctx.strokeStyle = '#5a3c22';
  ctx.lineWidth = 3.6 * k;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y - H + ly);
  ctx.lineTo(b.x, b.y - H + ly);
  ctx.stroke();
  ctx.strokeStyle = '#7d5634';
  ctx.lineWidth = 1.4 * k;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y - H + ly - 0.9 * k);
  ctx.lineTo(b.x, b.y - H + ly - 0.9 * k);
  ctx.stroke();
  if (snow > 0) {
    ctx.strokeStyle = SNOW;
    ctx.lineWidth = (0.8 + snow * 1.2) * k;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - H + ly - 2 * k);
    ctx.lineTo(b.x, b.y - H + ly - 2 * k);
    ctx.stroke();
  }
  // Plaque: the gate's color with a pale band, hanging under the lintel.
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 - H + ly + 1.5 * k;
  ctx.fillStyle = '#3b2716';
  ctx.fillRect(mx - 5 * k, my - 0.5 * k, 10 * k, 7 * k);
  ctx.fillStyle = color;
  ctx.fillRect(mx - 4.3 * k, my, 8.6 * k, 6 * k);
  ctx.fillStyle = 'rgba(255,245,214,0.9)';
  ctx.fillRect(mx - 3 * k, my + 2.5 * k, 6 * k, 1 * k);
  pillar(b, 1);
}

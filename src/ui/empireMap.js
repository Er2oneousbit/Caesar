/**
 * empireMap.js
 * ----------------------------------------------------------------------------
 * The empire map: a stylized inland sea with your province, Rome, every trade
 * partner of the scenario, and who is on the way. One renderer serves both
 * the small map at the top of the Trade advisor and the full Empire screen
 * (ui/empire.js).
 *
 *   land route  dashed brown line curving over land (caravans on the road)
 *   sea route   dotted blue line arcing across the water (merchant ships)
 *   open routes are drawn solid and bold, closed ones faint
 *   travelers   a caravan or ship in the partner's color, partway along its
 *               route; a scouted warband as a banner with its size
 *
 * Travelers are drawn from timers the sim already keeps, never simulated:
 * a route's `nextVisit` day (sim/trade.js) and the raid schedule
 * `nextRaidMonth` with the scouts' `warned` report (sim/military.js). Nothing
 * here changes game state, so the map is safe to draw paused or not.
 *
 * All shapes are drawn in a 100 x 60 "map unit" space and scaled to the
 * canvas. Original, hand-placed shapes (not a real map trace).
 * ----------------------------------------------------------------------------
 */

import { h } from './dom.js';
import { CONFIG } from '../config.js';
import { TRADE_PARTNERS, HOME_POS } from '../data/scenarios.js';
import { routeKind } from '../sim/trade.js';
import { enemyCount } from '../sim/military.js';

export const MAP_W = 100;
export const MAP_H = 60;
const W = MAP_W;
const H = MAP_H;

/** Rome on the map: on the coast south of the province, the Emperor's seat. */
export const ROME_POS = Object.freeze([51, 27]);

/** Scouts report a warband this many months before it strikes (sim/military.js). */
export const SCOUT_MONTHS = 3;

/**
 * The longest a caravan or ship is shown on the way. A route's next visit is
 * at least this many days after the last one (CARAVAN_INTERVAL_DAYS), so at
 * most one traveler per route is ever on the map.
 */
const MAX_TRIP_DAYS = CONFIG.CARAVAN_INTERVAL_DAYS[0];
const MIN_TRIP_DAYS = 10;
/** Days on the way per map unit of distance: far partners take longer. */
const DAYS_PER_UNIT = 0.6;

/** Where a scouted warband is first drawn, and where it stops (map units from the province). */
const WARBAND_FAR = 9;
const WARBAND_NEAR = 3;

/** Compass direction (sim/military.js screenDirection) to a unit step on the map (y grows south). */
const DIR_STEP = {
  east: [1, 0], 'north-east': [Math.SQRT1_2, -Math.SQRT1_2], north: [0, -1], 'north-west': [-Math.SQRT1_2, -Math.SQRT1_2],
  west: [-1, 0], 'south-west': [-Math.SQRT1_2, Math.SQRT1_2], south: [0, 1], 'south-east': [Math.SQRT1_2, Math.SQRT1_2],
};

/** Coastline of the stylized sea, clockwise from the western strait. */
const SEA = [
  [0, 33], [6, 31], [12, 30], [18, 27], [24, 23], [30, 21], [36, 22], [41, 24], [45, 27], [49, 31], [53, 36],
  [57, 33], [60, 28], [58, 20], [56, 12], [60, 12], [64, 20], [68, 26], [72, 28], [74, 34], [78, 32], [82, 28],
  [86, 32], [90, 30], [96, 34], [100, 38], [100, 46], [94, 48], [84, 48], [76, 47], [68, 46], [60, 48], [54, 44],
  [50, 40], [46, 40], [42, 43], [34, 45], [24, 44], [14, 42], [6, 38], [0, 38],
];

/** Some islands so the sea does not look empty. */
const ISLANDS = [
  [[44, 33], [46, 32], [47, 35], [45, 36]], // big island west of the toe
  [[40, 30], [41.5, 29.5], [42, 32], [40.5, 32.5]],
  [[82, 40], [86, 39.5], [85, 41], [81.5, 41]],
  [[66, 38], [67, 37.5], [67.5, 38.6], [66.4, 39]],
];

// ---------------------------------------------------------------------------
// Travelers: game state in, positions out (pure, no canvas; tested headless)
// ---------------------------------------------------------------------------

/** Game day with the fraction of the current day, so travelers glide between days. */
export function nowDays(game) {
  return game.time.totalDays + game.time.tick / CONFIG.TICKS_PER_DAY;
}

/** Game month with the fraction of the current month. */
export function nowMonths(game) {
  const t = game.time;
  return t.totalMonths + (t.day + t.tick / CONFIG.TICKS_PER_DAY) / CONFIG.DAYS_PER_MONTH;
}

/** Days a caravan or ship from this partner is shown on the way (by distance on the map). */
export function tripDays(partnerId) {
  const p = TRADE_PARTNERS[partnerId];
  if (!p) return MAX_TRIP_DAYS;
  const d = Math.hypot(p.pos[0] - HOME_POS[0], p.pos[1] - HOME_POS[1]);
  return Math.max(MIN_TRIP_DAYS, Math.min(MAX_TRIP_DAYS, Math.round(d * DAYS_PER_UNIT)));
}

/** Control point of a route's curve: sea routes bow out over the water (south), land routes over the land (north). */
function routeControl(a, b, sea) {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  return [mx, sea ? Math.max(my + 6, 37) : Math.max(2, my - 7)];
}

/**
 * Point on a partner's route, `frac` of the way from the partner (0) to your
 * province (1). Follows the same curve the route is drawn with.
 */
export function routePoint(partnerId, frac) {
  const p = TRADE_PARTNERS[partnerId];
  const a = HOME_POS;
  const b = p.pos;
  const c = routeControl(a, b, routeKind(partnerId) === 'sea');
  const t = 1 - frac; // the curve runs from home (t = 0) to the partner (t = 1)
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
}

/** Where a warband from `dir` stands on the map, `frac` of the way in. */
export function warbandPoint(dir, frac) {
  const [dx, dy] = DIR_STEP[dir] || DIR_STEP.north;
  const r = WARBAND_FAR + (WARBAND_NEAR - WARBAND_FAR) * frac;
  return [HOME_POS[0] + dx * r, HOME_POS[1] + dy * r];
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Everyone on the way to the city, from the sim's own timers:
 *
 *   { kind: 'caravan' | 'ship', id, name, color, days, trip, onWay, frac, pos }
 *       one per open route that ships can reach. `days` = whole days until it
 *       arrives; `onWay` = it has set out (the last `trip` days before its
 *       visit); `frac` = share of the trip done (0 while it has not set out).
 *   { kind: 'warband', size, dir, origin, months, frac, pos }
 *       the warband the scouts reported: `months` until it strikes (as the
 *       Military advisor counts them), `origin` = the map-edge tile it enters by.
 *   { kind: 'raid', size, pos }
 *       raiders in the province now (size = how many are left).
 *
 * Sorted by arrival: trade by days, then the warband and the raid.
 */
export function empireTravelers(game) {
  const out = [];
  const now = nowDays(game);
  const seaOk = !!game.map.seaEntry;
  for (const [id, r] of Object.entries(game.city.trade.routes)) {
    const p = TRADE_PARTNERS[id];
    if (!p || !r.open) continue;
    const sea = routeKind(id) === 'sea';
    if (sea && !seaOk) continue; // no ship ever comes (cannot be opened there anyway)
    const left = Math.max(0, r.nextVisit - now);
    const trip = tripDays(id);
    const onWay = left <= trip;
    const frac = onWay ? clamp01(1 - left / trip) : 0;
    out.push({ kind: sea ? 'ship' : 'caravan', id, name: p.name, color: p.color, days: Math.ceil(left), trip, onWay, frac, pos: routePoint(id, frac) });
  }
  out.sort((a, b) => a.days - b.days || a.name.localeCompare(b.name));
  const m = game.military;
  if (m && m.warned && m.nextRaidMonth !== null && !m.active) {
    const w = m.warned;
    const frac = clamp01(1 - (m.nextRaidMonth - nowMonths(game)) / SCOUT_MONTHS);
    const months = Math.max(0, m.nextRaidMonth - game.time.totalMonths);
    out.push({ kind: 'warband', size: w.size, dir: w.dir, origin: w.origin, months, frac, pos: warbandPoint(w.dir, frac) });
  }
  if (m && m.active) {
    const n = enemyCount(game);
    if (n > 0) out.push({ kind: 'raid', size: n, pos: [HOME_POS[0] + 2.6, HOME_POS[1] - 2.4] });
  }
  return out;
}

/** Is this traveler on the map? Caravans and ships only once they have set out. */
export function isDrawn(t) {
  return t.kind === 'caravan' || t.kind === 'ship' ? t.onWay : true;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One line about a traveler: "Massilia ship: 6 days", "Warband of 14 from the north, in 3 months". */
export function travelerLabel(t) {
  if (t.kind === 'warband') return `Warband of ${t.size} from the ${t.dir}, ${t.months > 0 ? `in ${plural(t.months, 'month')}` : 'any day now'}`;
  if (t.kind === 'raid') return `Raiders in the province: ${t.size} left`;
  const what = `${t.name} ${t.kind}`;
  const when = t.days > 0 ? plural(t.days, 'day') : 'arriving';
  return t.onWay ? `${what}: ${when}` : `${what}: ${when} (sets out in ${plural(t.days - t.trip, 'day')})`;
}

/**
 * Middle of a traveler's figure as drawn (map units): a banner flies above
 * its foot, a sail above its hull. `k` = figure scale (see drawEmpire).
 */
export function figureCenter(t, k = 1) {
  const [x, y] = t.pos;
  if (t.kind === 'warband' || t.kind === 'raid') return [x + 0.15 * k, y - 2.1 * k];
  if (t.kind === 'ship') return [x, y - 0.8 * k];
  return [x, y - 0.4 * k];
}

/** Figure scale for a map drawn at `pxPerUnit` screen px per map unit: labels at least 10 px tall. */
export function figureScale(pxPerUnit) {
  return Math.max(1, 10 / (2.3 * pxPerUnit));
}

/**
 * What is under a point of the map (map units), within `radius`:
 * { kind: 'traveler', t } | { kind: 'city', id } | { kind: 'home' } |
 * { kind: 'rome' } | null. Travelers are on top, so they win close calls.
 * `k` = figure scale, so a figure is found where it is drawn.
 */
export function empireHitAt(game, travelers, mx, my, radius, k = 1) {
  let best = null;
  let bestD = radius;
  const consider = (pos, hit, bias = 0) => {
    const d = Math.hypot(pos[0] - mx, pos[1] - my) - bias;
    if (d <= bestD) { bestD = d; best = hit; }
  };
  for (const id of Object.keys(game.city.trade.routes)) if (TRADE_PARTNERS[id]) consider(TRADE_PARTNERS[id].pos, { kind: 'city', id });
  consider(ROME_POS, { kind: 'rome' });
  consider(HOME_POS, { kind: 'home' });
  for (const t of travelers) if (isDrawn(t)) consider(figureCenter(t, k), { kind: 'traveler', t }, radius * 0.25);
  return best;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/**
 * Canvas element with the empire map for the current game (the Trade
 * advisor's small map: a snapshot, redrawn when the advisor refreshes).
 * @param {object} game
 * @param {number} [cssWidth] display width in CSS px (height follows 100:60)
 */
export function empireMapCanvas(game, cssWidth = 640) {
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const cssHeight = Math.round((cssWidth * H) / W);
  const canvas = h('canvas', {
    class: 'empire-map',
    width: Math.round(cssWidth * dpr),
    height: Math.round(cssHeight * dpr),
    role: 'img',
    'aria-label': 'Map of trade routes: your province and its trading partners by land and sea',
  });
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const s = (cssWidth * dpr) / W; // px per map unit
  ctx.scale(s, s);
  drawEmpire(ctx, game, { travelers: empireTravelers(game) });
  return canvas;
}

/**
 * Draw the whole map. `ctx` is already scaled to map units.
 * @param {object} opts
 * @param {object[]} [opts.travelers]  from empireTravelers(); none drawn if missing
 * @param {number} [opts.pxPerUnit]    screen px per map unit: on small screens
 *                                     labels and figures grow so they stay legible
 * @param {string} [opts.selected]     partner id to ring
 * @param {object} [opts.hover]        empireHitAt() result to highlight
 * @param {number} [opts.time]         seconds, for the ships' gentle bob (drawing only)
 */
export function drawEmpire(ctx, game, opts = {}) {
  const { travelers = [], pxPerUnit = 6.4, selected = null, hover = null, time = 0 } = opts;
  const k = figureScale(pxPerUnit);
  drawBase(ctx);
  const routes = game.city.trade.routes;
  const seaOk = !!game.map.seaEntry;
  // routes first, cities on top
  for (const [id, r] of Object.entries(routes)) {
    const p = TRADE_PARTNERS[id];
    if (!p) continue;
    const sea = routeKind(id) === 'sea';
    drawRoute(ctx, HOME_POS, p.pos, sea, r.open, sea && !seaOk);
  }
  drawRome(ctx, ROME_POS, k);
  for (const [id, r] of Object.entries(routes)) {
    const p = TRADE_PARTNERS[id];
    if (!p) continue;
    if (id === selected) ring(ctx, p.pos, 2.2 * k, '#2a241c');
    drawCity(ctx, p.pos, p.name, p.color, r.open, false, k);
  }
  drawCity(ctx, HOME_POS, game.city.name || 'Your province', '#a8322b', true, true, k);
  for (const t of travelers) {
    if (!isDrawn(t)) continue;
    const [x, y] = t.pos;
    if (t.kind === 'caravan') drawCaravan(ctx, x, y, t.color, k);
    else if (t.kind === 'ship') drawShip(ctx, x, y + Math.sin(time * 2 + x) * 0.15, t.color, k);
    else if (t.kind === 'warband') drawBanner(ctx, x, y, t.size, k, false);
    else if (t.kind === 'raid') drawBanner(ctx, x, y, t.size, k, true);
  }
  if (hover) {
    const pos = hover.kind === 'traveler' ? figureCenter(hover.t, k) : hover.kind === 'city' ? TRADE_PARTNERS[hover.id].pos : hover.kind === 'rome' ? ROME_POS : HOME_POS;
    ring(ctx, pos, 2.6 * k, 'rgba(42,36,28,0.55)', true);
  }
}

function drawBase(ctx) {
  // parchment land
  ctx.fillStyle = '#e3d3ac';
  ctx.fillRect(0, 0, W, H);
  // a few faint hills
  ctx.fillStyle = 'rgba(150,120,70,0.18)';
  for (const [x, y] of [[20, 10], [40, 12], [70, 10], [88, 18], [30, 54], [70, 56], [12, 50]]) {
    ctx.beginPath();
    ctx.moveTo(x - 3, y + 1.5);
    ctx.lineTo(x, y - 1.5);
    ctx.lineTo(x + 3, y + 1.5);
    ctx.fill();
  }
  // sea with a soft shore line
  smoothPath(ctx, SEA);
  ctx.fillStyle = '#8fb8d6';
  ctx.fill();
  ctx.lineWidth = 0.45;
  ctx.strokeStyle = '#5f86a6';
  ctx.stroke();
  for (const isl of ISLANDS) {
    smoothPath(ctx, isl);
    ctx.fillStyle = '#e3d3ac';
    ctx.fill();
    ctx.lineWidth = 0.3;
    ctx.strokeStyle = '#5f86a6';
    ctx.stroke();
  }
  // compass
  ctx.fillStyle = '#6b5a3a';
  ctx.font = '2.4px serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', 96, 4.5);
  ctx.beginPath();
  ctx.moveTo(96, 5.5); ctx.lineTo(95, 9); ctx.lineTo(97, 9);
  ctx.fill();
  // frame
  ctx.strokeStyle = '#8a6a44';
  ctx.lineWidth = 0.6;
  ctx.strokeRect(0.3, 0.3, W - 0.6, H - 0.6);
}

/** Closed curve through the midpoints of a polygon's edges (rounded coast). */
function smoothPath(ctx, pts) {
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  ctx.beginPath();
  const m0 = mid(pts[n - 1], pts[0]);
  ctx.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const m = mid(p, pts[(i + 1) % n]);
    ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  ctx.closePath();
}

/**
 * A route's line, in the style of its kind (see the header). The legend
 * passes its own `control` point to draw a short straight sample.
 */
export function drawRoute(ctx, a, b, sea, open, blocked, control = null) {
  const [cx, cy] = control || routeControl(a, b, sea);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.quadraticCurveTo(cx, cy, b[0], b[1]);
  ctx.lineCap = 'round';
  if (sea) {
    ctx.setLineDash(open ? [] : [0.3, 1.2]);
    ctx.strokeStyle = blocked ? 'rgba(120,120,120,0.6)' : open ? '#1f5f99' : 'rgba(31,95,153,0.75)';
  } else {
    ctx.setLineDash(open ? [] : [1.6, 1.1]);
    ctx.strokeStyle = open ? '#7a4a1e' : 'rgba(122,74,30,0.7)';
  }
  ctx.lineWidth = open ? 0.75 : 0.45;
  ctx.stroke();
  ctx.setLineDash([]);
}

/** A partner city (a dot in its color, grey while closed) or your province (a star). */
export function drawCity(ctx, pos, name, color, open, home, k = 1) {
  const [x, y] = pos;
  ctx.fillStyle = home ? '#a8322b' : open ? color : '#8f8676';
  ctx.strokeStyle = '#2a241c';
  ctx.lineWidth = 0.25;
  ctx.beginPath();
  if (home) {
    // a little star for your province
    for (let i = 0; i < 10; i++) {
      const r = (i % 2 ? 0.9 : 2) * k;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  } else {
    ctx.arc(x, y, 1.1 * k, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  if (name) label(ctx, name, x, y - 2.2 * k, k, home);
}

/** Rome: a purple square with a gold rim. */
export function drawRome(ctx, pos, k = 1, named = true) {
  const [x, y] = pos;
  const s = 1.2 * k;
  ctx.fillStyle = '#6d2a6b';
  ctx.strokeStyle = '#d6ab3c';
  ctx.lineWidth = 0.45;
  ctx.fillRect(x - s, y - s, s * 2, s * 2);
  ctx.strokeRect(x - s, y - s, s * 2, s * 2);
  if (named) label(ctx, 'Rome', x, y + 4.3 * k, k, true);
}

function label(ctx, text, x, y, k, bold) {
  ctx.font = `${bold ? 'bold ' : ''}${(2.3 * k).toFixed(2)}px serif`;
  ctx.textAlign = 'center';
  ctx.lineWidth = 0.5 * k;
  ctx.strokeStyle = 'rgba(243,234,210,0.9)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#2a241c';
  ctx.fillText(text, x, y);
}

function ring(ctx, pos, r, color, dashed = false) {
  ctx.beginPath();
  ctx.arc(pos[0], pos[1], r, 0, Math.PI * 2);
  ctx.setLineDash(dashed ? [0.6, 0.5] : []);
  ctx.lineWidth = 0.35;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.setLineDash([]);
}

/** A caravan: a pack mule under a cloth in the partner's color. */
export function drawCaravan(ctx, x, y, color, k = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.fillStyle = '#5e3b20';
  for (const lx of [-0.9, -0.4, 0.5, 1]) ctx.fillRect(lx - 0.12, 0.2, 0.24, 0.9); // legs
  ctx.fillRect(1.1, -0.9, 0.55, 0.9); // neck and head
  ctx.fillStyle = '#7a5332';
  ctx.fillRect(-1.2, -0.4, 2.5, 0.8); // body
  ctx.fillStyle = color;
  ctx.strokeStyle = '#2a241c';
  ctx.lineWidth = 0.18;
  ctx.fillRect(-0.9, -1.2, 1.7, 1); // the load
  ctx.strokeRect(-0.9, -1.2, 1.7, 1);
  ctx.restore();
}

/** A merchant ship: a brown hull under a sail in the partner's color. */
export function drawShip(ctx, x, y, color, k = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.fillStyle = '#5e3b20';
  ctx.beginPath();
  ctx.moveTo(-1.6, 0); ctx.lineTo(1.6, 0); ctx.lineTo(1.1, 0.8); ctx.lineTo(-1.1, 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(-0.08, -2.1, 0.16, 2.1); // mast
  ctx.fillStyle = color;
  ctx.strokeStyle = '#2a241c';
  ctx.lineWidth = 0.15;
  ctx.beginPath();
  ctx.moveTo(-1.1, -1.9); ctx.lineTo(1.1, -1.9); ctx.lineTo(1.2, -0.35); ctx.lineTo(-1.2, -0.35);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * A warband's banner: a pole with a pennant and the number of warriors on it.
 * Red and bold for raiders already in the province.
 */
export function drawBanner(ctx, x, y, size, k = 1, attacking = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.fillStyle = '#3a2a1a';
  ctx.fillRect(-1.6, -3.4, 0.25, 3.8); // pole
  ctx.fillStyle = attacking ? '#b3261e' : '#7a1f1a';
  ctx.strokeStyle = '#1c140c';
  ctx.lineWidth = 0.2;
  ctx.beginPath();
  ctx.moveTo(-1.35, -3.4); ctx.lineTo(1.9, -3.4); ctx.lineTo(1.4, -2.15); ctx.lineTo(1.9, -0.9); ctx.lineTo(-1.35, -0.9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (size !== undefined && size !== null) {
    ctx.font = 'bold 1.75px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff4dc';
    ctx.fillText(String(size), 0.15, -1.5);
  }
  ctx.restore();
}

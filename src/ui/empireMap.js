/**
 * empireMap.js
 * ----------------------------------------------------------------------------
 * The empire map: the Mediterranean world with your province, Rome, every
 * trade partner of the scenario, and who is on the way. One renderer serves
 * both the small map at the top of the Trade advisor and the full Empire
 * screen (ui/empire.js).
 *
 *   land route  brown line along the roads (caravans on the road)
 *   sea route   blue line along the sea lanes (merchant ships)
 *   open routes are drawn solid and bold, closed ones faint and broken
 *   travelers   a caravan or ship in the partner's color, partway along its
 *               route; a warband as a banner, at the frontier with no number
 *               while only rumoured, then from its side with its size (in a
 *               boat when it comes by sea, sim/navy.js, out on the sea)
 *   armies      Caesar's legions as a purple standard on the road from Rome;
 *               a city Caesar asked troops for (a small walled square), the
 *               enemy's line of march to it with its banner, and the
 *               province's troops (a red standard) on their way there or home
 *
 * Travelers are drawn from timers the sim already keeps, never simulated:
 * a route's `nextVisit` day (sim/trade.js), the raid schedule
 * `nextRaidMonth` with its `warnStage` and the scouts' `warned` report
 * (sim/military.js), the legions' countdown (sim/legion.js) and the battle's
 * months (sim/battle.js).
 * Nothing here changes game state, so the map is safe to draw paused or not.
 *
 * All shapes are drawn in a 100 x 60 "map unit" space and scaled to the
 * canvas. The coasts, rivers, mountains and route lanes are real geography
 * written down in data/empireGeo.js (drawn for this game, not traced).
 * ----------------------------------------------------------------------------
 */

import { h } from './dom.js';
import { CONFIG } from '../config.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';
import {
  MAP_W, MAP_H, SEA, ISLANDS, WATERS, RIVERS, NILE, DELTA, MOUNTAINS, REGIONS, at, isLand,
} from '../data/empireGeo.js';
import { SITES, homeSiteId } from '../data/sites.js';
import { smoothLine, routePath, tripDays, legionWay, lineLength, ROME_LL } from '../data/empireRoutes.js';
import { routeKind, firstVisitDays } from '../sim/trade.js';
import { routeInterval } from '../sim/tradeDemand.js';
import { enemyCount, SCOUT_MONTHS, RUMOUR_MONTHS } from '../sim/military.js';
import { legionSummary, legionCount } from '../sim/legion.js';
import { battleSummary, recallSummary } from '../sim/battle.js';
import { THREATENED_CITIES, marchLine, enemyLine } from '../data/battles.js';

export { MAP_W, MAP_H, routePath, tripDays };
const W = MAP_W;
const H = MAP_H;

/** Rome on the map, the Emperor's seat on the Tiber. */
export const ROME_POS = at(...ROME_LL);

// Word of a warband comes RUMOUR_MONTHS before it strikes, the scouts' report
// of its side SCOUT_MONTHS before (sim/military.js). Its banner closes in over
// the whole RUMOUR_MONTHS: at a frontier point while its side is unknown,
// then on its side's line, half way in.
export { SCOUT_MONTHS, RUMOUR_MONTHS };

/**
 * The fewest days a caravan or ship is shown on the way, so a partner next
 * door (Capua seen from Puteoli, a day off) is seen at all.
 */
const MIN_SHOWN_TRIP_DAYS = 2;

/** Where a scouted warband is first drawn, and where it stops (map units from the province). */
const WARBAND_FAR = 9;
const WARBAND_NEAR = 3;

/** Compass direction (sim/military.js screenDirection) to a unit step on the map (y grows south). */
const DIR_STEP = {
  east: [1, 0], 'north-east': [Math.SQRT1_2, -Math.SQRT1_2], north: [0, -1], 'north-west': [-Math.SQRT1_2, -Math.SQRT1_2],
  west: [-1, 0], 'south-west': [-Math.SQRT1_2, Math.SQRT1_2], south: [0, 1], 'south-east': [Math.SQRT1_2, Math.SQRT1_2],
};

// Map colors. The canvas keeps its own palette in both UI themes: parchment
// and a light sea, so routes, labels and figures read the same everywhere.
const LAND = '#e3d3ac';
const SEA_FILL = '#9cc2dc';
const SHORE = '#5f86a6';

// Routes are smooth curves from each partner to the province's site, found
// on the network of roads and sea lanes (data/empireRoutes.js routePath).

/** The site of the province on the map, and where it is drawn. */
const siteOf = (game) => homeSiteId(game);
const homeAt = (game) => SITES[siteOf(game)].pos;

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

/**
 * Days a route's next caravan or ship is shown on the way: its trip from its
 * city (data/empireRoutes.js tripDays), at least MIN_SHOWN_TRIP_DAYS, and
 * never longer than the route's shortest interval, so it always sets out from
 * its city and never two are out at once (a quiet route's interval is at
 * least the round trip; a busy one's comes sooner, sim/tradeDemand.js).
 * The first trader of a route sets out the day the route opens: it is shown
 * over the days to its visit (sim/trade.js firstVisitDays, at least a week
 * even from next door), and so is never seen appearing halfway along.
 */
export function shownTripDays(game, partnerId, first = false) {
  const trip = first ? firstVisitDays(game, partnerId) : Math.max(MIN_SHOWN_TRIP_DAYS, tripDays(siteOf(game), partnerId));
  return Math.min(trip, routeInterval(game, partnerId)[0]);
}

/**
 * Point on a partner's route from a site, `frac` of the way from the partner
 * (0) to the province (1), measured along the route as drawn so travelers
 * keep an even pace.
 */
export function routePoint(siteId, partnerId, frac) {
  const { pts, cum, len } = routePath(siteId, partnerId);
  const want = Math.max(0, Math.min(1, frac)) * len;
  let i = 1;
  while (i < pts.length - 1 && cum[i] < want) i++;
  const seg = cum[i] - cum[i - 1];
  const u = seg > 0 ? (want - cum[i - 1]) / seg : 0;
  const a = pts[i - 1];
  const b = pts[i];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}

/** The side a warband only rumoured is drawn on: the site's frontier (data/sites.js), over land toward its likely enemies. */
export function frontierDir(siteId) {
  return (SITES[siteId] || SITES.etruria).frontier;
}

/** Is the way in from `d` over land, from `far` map units out to WARBAND_NEAR? (Sampled every half unit.) */
function landWayIn(home, d, far) {
  const [dx, dy] = DIR_STEP[d];
  for (let r = far; r >= WARBAND_NEAR - 1e-9; r -= 0.5) if (!isLand([home[0] + dx * r, home[1] + dy * r])) return false;
  return true;
}

/**
 * Where a warband from `dir` stands on the map from a site, `frac` of the
 * way in. One that comes by sea (`sea`) sails on the sea: from `dir`, or the
 * nearest direction round from it whose way in is sea at both ends. One that
 * comes by land walks over land: from `dir`, or the nearest direction round
 * from it whose whole way in is land; on a narrow coast where none is (Firmum
 * between the Apennines and the Adriatic), from a little nearer. The label
 * keeps the side of the city's map it comes from.
 */
export function warbandPoint(siteId, dir, frac, sea = false) {
  const home = (SITES[siteId] || SITES.etruria).pos;
  const point = (d, far = WARBAND_FAR) => {
    const [dx, dy] = DIR_STEP[d] || DIR_STEP.north;
    const r = far + (WARBAND_NEAR - far) * frac;
    return [home[0] + dx * r, home[1] + dy * r];
  };
  const order = Object.keys(DIR_STEP);
  const k = Math.max(0, order.indexOf(dir));
  const round = [0, 1, -1, 2, -2, 3, -3, 4].map((step) => order[(k + step + 8) % 8]);
  if (sea) {
    for (const d of round) {
      const [dx, dy] = DIR_STEP[d];
      const far = [home[0] + dx * WARBAND_FAR, home[1] + dy * WARBAND_FAR];
      const near = [home[0] + dx * WARBAND_NEAR, home[1] + dy * WARBAND_NEAR];
      if (!isLand(far) && !isLand(near)) return point(d);
    }
    return point(dir);
  }
  for (let far = WARBAND_FAR; far >= WARBAND_NEAR + 1; far -= 2) {
    const d = round.find((side) => landWayIn(home, side, far));
    if (d) return point(d, far);
  }
  return point(dir);
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Everyone on the way to the city, from the sim's own timers:
 *
 *   { kind: 'caravan' | 'ship', id, name, color, days, trip, onWay, frac, pos }
 *       one per open route that ships can reach. `days` = whole days until it
 *       arrives; `onWay` = it has set out (the last `trip` days before its
 *       visit); `frac` = share of the trip done (0 while it has not set out).
 *       `trip` = shownTripDays: the first trader of a route sets out from its
 *       city the day the route opens, so it is never seen appearing halfway
 *       along.
 *   { kind: 'warband', size, dir, origin, months, frac, pos, sea, noShore }
 *       the warband the scouts reported: `months` until it strikes (as the
 *       Military advisor counts them), `origin` = the map-edge tile it enters
 *       by (by sea: the sea entry), `sea` = it comes by ship, `noShore` = its
 *       ships found no landing a month out (it will come over land).
 *       `frac` runs over the last RUMOUR_MONTHS.
 *   { kind: 'warband', rumour: true, months, frac, pos }
 *       a warband only rumoured so far (size, dir and origin null), at the
 *       site's frontier (frontierDir) until the scouts find its side.
 *   { kind: 'raid', size, pos }
 *       raiders in the province now (size = how many are left).
 *
 * Sorted by arrival: trade by days, then the warband and the raid.
 */
export function empireTravelers(game) {
  const out = [];
  const now = nowDays(game);
  const seaOk = !!game.map.seaEntry;
  const site = siteOf(game);
  const home = homeAt(game);
  for (const [id, r] of Object.entries(game.city.trade.routes)) {
    const p = TRADE_PARTNERS[id];
    if (!p || !r.open) continue;
    const sea = routeKind(id) === 'sea';
    if (sea && !seaOk) continue; // no ship ever comes (cannot be opened there anyway)
    const left = Math.max(0, r.nextVisit - now);
    // (No trader has reached the city yet: the one on the way set out when the route opened.)
    const trip = shownTripDays(game, id, !r.visits);
    const onWay = left <= trip;
    const frac = onWay ? clamp01(1 - left / trip) : 0;
    out.push({ kind: sea ? 'ship' : 'caravan', id, name: p.name, color: p.color, days: Math.ceil(left), trip, onWay, frac, pos: routePoint(site, id, frac) });
  }
  out.sort((a, b) => a.days - b.days || a.name.localeCompare(b.name));
  const m = game.military;
  if (m && (m.warned || m.warnStage > 0) && m.nextRaidMonth !== null && !m.active) {
    const w = m.warned;
    const frac = clamp01(1 - (m.nextRaidMonth - nowMonths(game)) / RUMOUR_MONTHS);
    const months = Math.max(0, m.nextRaidMonth - game.time.totalMonths);
    if (w) out.push({ kind: 'warband', size: w.size, dir: w.dir, origin: w.origin, months, frac, sea: !!w.sea, noShore: !!w.noShore, pos: warbandPoint(site, w.dir, frac, !!w.sea) });
    else out.push({ kind: 'warband', rumour: true, size: null, dir: null, origin: null, months, frac, sea: false, pos: warbandPoint(site, frontierDir(site), frac) });
  }
  if (m && m.active) {
    const n = enemyCount(game) - legionCount(game); // (Caesar's men are shown apart, below)
    if (n > 0) out.push({ kind: 'raid', size: n, pos: [home[0] + 2.6, home[1] - 2.4] });
  }
  out.push(...empireArmies(game));
  return out;
}

/** Where Caesar's legions stop on their way from Rome: this far (map units) short of the province. */
const LEGION_NEAR = 2.5;

/** A point `frac` of the way along a polyline (by length). */
export function linePoint(pts, frac) {
  let len = 0;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const want = clamp01(frac) * len;
  let i = 1;
  while (i < pts.length - 1 && cum[i] < want) i++;
  const seg = cum[i] - cum[i - 1];
  const u = seg > 0 ? (want - cum[i - 1]) / seg : 0;
  return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u];
}

/**
 * The way from Rome to just short of the province, for Caesar's legions:
 * along the roads (data/empireRoutes.js legionWay), drawn as a curve. Their
 * march is LEGION_MARCH_DAYS from anywhere (the time the governor has to
 * win back favor, a rule rather than a journey), so a far province's
 * legions simply move faster on the map.
 */
const legionRoads = new Map();
export function legionRoad(siteId) {
  if (!legionRoads.has(siteId)) legionRoads.set(siteId, cutShort(smoothLine(legionWay(siteId)), LEGION_NEAR));
  return legionRoads.get(siteId);
}

/** A polyline less its last `cut` map units. */
function cutShort(pts, cut) {
  const want = Math.max(0, lineLength(pts) - cut);
  const out = [pts[0]];
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (run + seg >= want) {
      const u = seg > 0 ? (want - run) / seg : 0;
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u]);
      return out;
    }
    run += seg;
    out.push(pts[i]);
  }
  return out;
}

/**
 * Armies on the empire map, from the sim's own counters (sim/legion.js,
 * sim/battle.js), never simulated here:
 *   { kind: 'legion', size, months, frac, pos }   Caesar's legions marching
 *       from Rome (`here`: on the map now, `state` attack | halted | leaving)
 *   { kind: 'enemy', city, name, enemyName, months, pos }   the enemy closing on
 *       a threatened city (`months` until the battle)
 *   { kind: 'troops', city, name, strength, months, home, pos }   the
 *       province's troops on their way there (or `home`, coming back;
 *       `post`: the fort or station of recalled troops turned back early)
 *   { kind: 'rider', city, name, post, months, pos }   a rider carrying a
 *       recall to them, riding from the province toward the troops
 */
export function empireArmies(game) {
  const out = [];
  const site = siteOf(game);
  const home = homeAt(game);
  const ls = legionSummary(game);
  if (ls.state === 'marching') {
    const days = ls.days - game.time.tick / CONFIG.TICKS_PER_DAY;
    const frac = clamp01(1 - days / (game.military.caesar.marchDays || CONFIG.LEGION_MARCH_DAYS));
    out.push({ kind: 'legion', size: ls.size, months: ls.months, frac, pos: linePoint(legionRoad(site), frac) });
  } else if (ls.state !== 'none') {
    out.push({ kind: 'legion', here: true, state: ls.state, size: ls.men, pos: [home[0] - 2.6, home[1] + 3.6] }); // (below and left of the province: its name is above it, raiders to its right)
  }
  const bs = battleSummary(game);
  const part = nowMonths(game) - game.time.totalMonths; // how far into this month
  // Recalled troops turned back on the road, coming home from where the
  // rider reached them (they outlive the battle: sim/battle.js recalls).
  for (const r of recallSummary(game)) {
    if (r.rider > 0 || !THREATENED_CITIES[r.city]) continue;
    const frac = clamp01(r.homeTotal / Math.max(1, r.march)) * clamp01((r.homeIn - part) / Math.max(1, r.homeTotal));
    out.push({ kind: 'troops', city: r.city, name: r.cityName, home: true, post: r.name, months: r.homeIn, pos: linePoint(smoothLine(marchLine(site, r.city)), frac) });
  }
  if (!bs) return out;
  if (bs.phase === 'pending') {
    const left = Math.max(0, bs.monthsLeft - part);
    const toGo = Math.max(0, Math.min(bs.enemyMonths, left - 1));
    out.push({ kind: 'enemy', city: bs.city, name: bs.name, enemyName: bs.enemyName, months: bs.monthsLeft, pos: linePoint(enemyLine(bs.city), 1 - toGo / bs.enemyMonths) });
    if (bs.sent) {
      // Glide toward next month's place: two months a month while farther off than the enemy.
      const s = bs.sent;
      const nextEnemy = Math.max(0, Math.min(bs.enemyMonths, bs.monthsLeft - 2));
      const step = s.toGo <= 1 ? 0 : s.toGo - 1 > nextEnemy ? 2 : 1;
      const toGoF = Math.max(1, s.toGo - part * step);
      const at = 1 - toGoF / s.march;
      if (s.men + s.ships > 0) out.push({ kind: 'troops', city: bs.city, name: bs.name, strength: s.strength, months: s.toGo, pos: linePoint(smoothLine(marchLine(site, bs.city)), at) });
      // A rider rides out after them, reaching them as they get there.
      for (const r of bs.recalls) {
        if (r.rider <= 0) continue;
        const ridden = clamp01((r.riderTotal - r.rider + part) / Math.max(1, r.riderTotal));
        out.push({ kind: 'rider', city: bs.city, name: bs.name, post: r.name, months: r.rider, pos: linePoint(smoothLine(marchLine(site, bs.city)), at * ridden) });
      }
    }
  } else if (bs.phase === 'returning') {
    const total = game.military.battle.homeTotal || bs.homeIn || 1;
    const frac = clamp01(1 - (bs.homeIn - part) / total);
    out.push({ kind: 'troops', city: bs.city, name: bs.name, home: true, months: bs.homeIn, pos: linePoint(smoothLine(marchLine(site, bs.city)).reverse(), frac) });
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
  if (t.kind === 'warband' && t.rumour) return `Warband gathering beyond the frontier, ${t.months > 0 ? `in about ${plural(t.months, 'month')}` : 'any day now'}`;
  if (t.kind === 'warband') return `Warband of ${t.size} ${t.sea ? 'by sea ' : ''}from the ${t.dir}${t.noShore ? ', no landing found' : ''}, ${t.months > 0 ? `in ${plural(t.months, 'month')}` : 'any day now'}`;
  if (t.kind === 'raid') return `Raiders in the province: ${t.size} left`;
  if (t.kind === 'legion') {
    if (!t.here) return `Caesar's legions (${t.size} men) marching from Rome, ${t.months > 0 ? `in ${plural(t.months, 'month')}` : 'any day now'}`;
    return `Caesar's legions in the province: ${t.size} left${t.state === 'halted' ? ', halted' : t.state === 'leaving' ? ', marching home' : ''}`;
  }
  if (t.kind === 'enemy') return `The army of ${t.enemyName} marching on ${t.name}: the battle ${t.months > 0 ? `in ${plural(t.months, 'month')}` : 'this month'}`;
  if (t.kind === 'rider') return `A rider carrying your recall to the troops of the ${t.post}: he reaches them in ${plural(Math.max(1, t.months), 'month')}`;
  if (t.kind === 'troops' && t.post) return `Recalled troops of the ${t.post} coming home: ${plural(Math.max(1, t.months), 'month')}`;
  if (t.kind === 'troops') return t.home ? `Your troops coming home from ${t.name}: ${plural(Math.max(1, t.months), 'month')}` : `Your troops (strength ${t.strength}) on the way to ${t.name}: ${t.months <= 1 ? 'there' : `${plural(t.months, 'month')} away`}`;
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
  if (t.kind === 'warband' || t.kind === 'raid' || t.kind === 'legion' || t.kind === 'enemy' || t.kind === 'troops') return [x + 0.15 * k, y - 2.1 * k];
  if (t.kind === 'ship') return [x, y - 0.8 * k];
  if (t.kind === 'rider') return [x, y - 1.1 * k];
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
  const b = game.military?.battle;
  if (b && THREATENED_CITIES[b.city]) consider(THREATENED_CITIES[b.city].pos, { kind: 'battle', id: b.city });
  consider(ROME_POS, { kind: 'rome' });
  consider(homeAt(game), { kind: 'home' });
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
  drawEmpire(ctx, game, { travelers: empireTravelers(game), pxPerUnit: cssWidth / W });
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
  const site = siteOf(game);
  const home = homeAt(game);
  drawBase(ctx, pxPerUnit);
  const routes = game.city.trade.routes;
  const seaOk = !!game.map.seaEntry;
  // routes first, cities on top
  for (const [id, r] of Object.entries(routes)) {
    if (!TRADE_PARTNERS[id]) continue;
    const sea = routeKind(id) === 'sea';
    drawRoute(ctx, routePath(site, id).pts, sea, r.open, sea && !seaOk, pxPerUnit);
  }
  drawRome(ctx, ROME_POS, k, false);
  for (const [id, r] of Object.entries(routes)) {
    const p = TRADE_PARTNERS[id];
    if (!p) continue;
    if (id === selected) ring(ctx, p.pos, 2.2 * k, '#2a241c');
    drawCity(ctx, p.pos, null, p.color, r.open, false, k);
  }
  drawCity(ctx, home, null, '#a8322b', true, true, k); // the star where the province is (data/sites.js)
  // A distant battle (sim/battle.js): the threatened city, the enemy's line
  // of march and the province's road to it.
  const bs = battleSummary(game);
  if (bs) {
    const pp = pxPerUnit ? Math.max(0.22, Math.min(0.45, 1.6 / pxPerUnit)) : 0.4;
    dashed(ctx, enemyLine(bs.city), 'rgba(122,31,26,0.75)', pp, [0.9, 0.7]);
    if (bs.phase !== 'foreign') dashed(ctx, smoothLine(marchLine(site, bs.city)), bs.sea ? 'rgba(31,95,153,0.8)' : 'rgba(168,50,43,0.8)', pp, [0.4, 0.5]);
    drawBattleCity(ctx, THREATENED_CITIES[bs.city].pos, bs.phase === 'foreign', k);
  }
  // Names last, each where it clashes with no other name or marker (Italy
  // is crowded: Rome, Capua and the province sit close together).
  const names = [
    { text: game.city.name || 'Your province', pos: home, r: 2 * k, bold: true, sides: ['above', 'right', 'left', 'below'] },
    { text: 'Rome', pos: ROME_POS, r: 1.2 * k, bold: true, sides: ['left', 'below', 'right', 'above'] },
    ...Object.keys(routes).filter((id) => TRADE_PARTNERS[id]).map((id) => ({ text: TRADE_PARTNERS[id].name, pos: TRADE_PARTNERS[id].pos, r: 1.1 * k, bold: false, sides: TRADE_PARTNERS[id].labelSides || ['above', 'below', 'right', 'left'] })),
    // (The threatened city's name on the side away from the enemy coming at it.)
    ...(bs ? [{ text: bs.name, pos: THREATENED_CITIES[bs.city].pos, r: 1.2 * k, bold: false, sides: enemyLine(bs.city)[0][1] > THREATENED_CITIES[bs.city].pos[1] ? ['above', 'right', 'left', 'below'] : ['below', 'right', 'left', 'above'] }] : []),
  ];
  placeLabels(ctx, names, k);
  for (const t of travelers) {
    if (!isDrawn(t)) continue;
    const [x, y] = t.pos;
    if (t.kind === 'caravan') drawCaravan(ctx, x, y, t.color, k);
    else if (t.kind === 'ship') drawShip(ctx, x, y + Math.sin(time * 2 + x) * 0.15, t.color, k);
    else if (t.kind === 'warband') drawBanner(ctx, x, y, t.size, k, false, !!t.sea);
    else if (t.kind === 'raid') drawBanner(ctx, x, y, t.size, k, true);
    else if (t.kind === 'enemy') drawBanner(ctx, x, y, null, k, false);
    else if (t.kind === 'legion') drawStandard(ctx, x, y, t.size, k, LEGION_COLOR, !!t.here);
    else if (t.kind === 'troops') drawStandard(ctx, x, y, t.home ? null : t.strength, k, '#a8322b', false);
    else if (t.kind === 'rider') drawRider(ctx, x, y, k);
  }
  if (hover) {
    const pos = hover.kind === 'traveler' ? figureCenter(hover.t, k) : hover.kind === 'city' ? TRADE_PARTNERS[hover.id].pos : hover.kind === 'battle' ? THREATENED_CITIES[hover.id].pos : hover.kind === 'rome' ? ROME_POS : home;
    ring(ctx, pos, 2.6 * k, 'rgba(42,36,28,0.55)', true);
  }
}

/**
 * A rider carrying a recall: a small horseman (a dark horse, a red cloak),
 * standing on (x, y). `k` = figure scale.
 */
export function drawRider(ctx, x, y, k = 1) {
  const s = 0.75 * k;
  ctx.fillStyle = '#3b2a1c';
  // the horse: a body, a neck and head, four legs
  ctx.fillRect(x - 1.1 * s, y - 1.4 * s, 2.0 * s, 0.75 * s);
  ctx.fillRect(x + 0.7 * s, y - 2.1 * s, 0.45 * s, 0.9 * s);
  ctx.fillRect(x + 0.7 * s, y - 2.2 * s, 0.8 * s, 0.35 * s);
  for (const dx of [-1.0, -0.6, 0.35, 0.7]) ctx.fillRect(x + dx * s, y - 0.7 * s, 0.22 * s, 0.7 * s);
  // the rider: a red cloak and a head
  ctx.fillStyle = '#a8322b';
  ctx.fillRect(x - 0.45 * s, y - 2.5 * s, 0.6 * s, 1.15 * s);
  ctx.fillStyle = '#e2c49a';
  ctx.beginPath();
  ctx.arc(x - 0.15 * s, y - 2.8 * s, 0.28 * s, 0, Math.PI * 2);
  ctx.fill();
}

/** Caesar's color on the map: the purple of Rome's marker. */
const LEGION_COLOR = '#6d2a6b';

/** A dashed line through `pts`, about `w` map units wide. */
function dashed(ctx, pts, color, w, dash) {
  linePath(ctx, pts);
  ctx.setLineDash(dash);
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * A city Caesar asked troops for: a small walled square, white with a red
 * rim while it holds, dark in the enemy's hands.
 */
export function drawBattleCity(ctx, pos, lost, k = 1) {
  const [x, y] = pos;
  const s = 1 * k;
  ctx.fillStyle = lost ? '#3a2a22' : '#f1ece2';
  ctx.strokeStyle = lost ? '#1c140c' : '#a8322b';
  ctx.lineWidth = 0.4;
  ctx.fillRect(x - s, y - s, s * 2, s * 2);
  ctx.strokeRect(x - s, y - s, s * 2, s * 2);
  // battlements
  ctx.fillStyle = ctx.strokeStyle;
  for (const dx of [-0.75, 0, 0.75]) ctx.fillRect(x + dx * s - 0.22 * s, y - s - 0.45 * s, 0.44 * s, 0.45 * s);
}

/**
 * A Roman standard: a pole crowned with a gilded eagle, and a square cloth
 * in `color` with a number on it (Caesar's legions: their men; your troops:
 * their strength). `here`: in the province now (drawn a little larger).
 */
export function drawStandard(ctx, x, y, n, k = 1, color = LEGION_COLOR, here = false) {
  ctx.save();
  ctx.translate(x, y);
  const s = k * (here ? 1.15 : 1);
  ctx.scale(s, s);
  ctx.fillStyle = '#3a2a1a';
  ctx.fillRect(-0.12, -4.2, 0.25, 4.6); // pole
  ctx.fillStyle = '#d6ab3c'; // the eagle: wings spread over the pole
  ctx.beginPath();
  ctx.moveTo(-1.3, -4.4); ctx.lineTo(0, -4.0); ctx.lineTo(1.3, -4.4); ctx.lineTo(0.5, -3.7); ctx.lineTo(-0.5, -3.7);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath(); ctx.arc(0, -4.55, 0.35, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color;
  ctx.strokeStyle = '#1c140c';
  ctx.lineWidth = 0.18;
  ctx.fillRect(-1.6, -3.4, 3.2, 2.5);
  ctx.strokeRect(-1.6, -3.4, 3.2, 2.5);
  ctx.fillStyle = '#d6ab3c';
  ctx.fillRect(-1.6, -1.05, 3.2, 0.25); // fringe
  if (n !== undefined && n !== null) {
    ctx.font = 'bold 1.6px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff4dc';
    ctx.fillText(String(n), 0, -1.6);
  }
  ctx.restore();
}

/** A closed polygon as a path (appended to the current path). */
function polyPath(ctx, pts) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** An open line as a new path. */
function linePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
}

/** The land, the sea and what is on them, under the routes and cities. */
function drawBase(ctx, pxPerUnit) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // parchment land
  ctx.fillStyle = LAND;
  ctx.fillRect(0, 0, W, H);
  // the green of the Nile: its valley along the river and the delta's fan
  ctx.fillStyle = 'rgba(128,156,84,0.38)';
  ctx.beginPath();
  polyPath(ctx, DELTA);
  ctx.fill();
  ctx.strokeStyle = 'rgba(128,156,84,0.38)';
  ctx.lineWidth = 1.1;
  linePath(ctx, NILE);
  ctx.stroke();
  // mountains: a row of small peaks along each range
  ctx.fillStyle = 'rgba(140,108,62,0.22)';
  ctx.strokeStyle = 'rgba(120,92,52,0.35)';
  ctx.lineWidth = 0.18;
  for (const [x, y] of MOUNTAINS) {
    ctx.beginPath();
    ctx.moveTo(x - 0.9, y + 0.5);
    ctx.lineTo(x, y - 0.6);
    ctx.lineTo(x + 0.9, y + 0.5);
    ctx.fill();
    ctx.stroke();
  }
  // the sea, the islands on it, and the gulfs and lakes on the land
  ctx.beginPath();
  polyPath(ctx, SEA);
  ctx.fillStyle = SEA_FILL;
  ctx.fill();
  ctx.beginPath();
  for (const w of WATERS) polyPath(ctx, w);
  ctx.fill();
  ctx.beginPath();
  for (const isl of ISLANDS) polyPath(ctx, isl);
  ctx.fillStyle = LAND;
  ctx.fill();
  // shallows: a pale band just off every shore (clipped to the water)
  ctx.save();
  ctx.beginPath();
  polyPath(ctx, SEA);
  for (const isl of ISLANDS) polyPath(ctx, isl);
  ctx.clip('evenodd');
  ctx.beginPath();
  polyPath(ctx, SEA);
  for (const isl of ISLANDS) polyPath(ctx, isl);
  ctx.strokeStyle = 'rgba(232,242,248,0.45)';
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.restore();
  // shore lines
  ctx.beginPath();
  polyPath(ctx, SEA);
  for (const isl of ISLANDS) polyPath(ctx, isl);
  for (const w of WATERS) polyPath(ctx, w);
  ctx.strokeStyle = SHORE;
  // about a pixel wide whatever the canvas size
  ctx.lineWidth = Math.max(0.16, Math.min(0.3, 1.1 / pxPerUnit));
  ctx.stroke();
  // rivers
  ctx.strokeStyle = 'rgba(80,128,170,0.75)';
  ctx.lineWidth = Math.max(0.14, Math.min(0.25, 1 / pxPerUnit));
  for (const r of RIVERS) {
    linePath(ctx, r);
    ctx.stroke();
  }
  drawRegions(ctx, pxPerUnit);
  ctx.restore();
  drawCompass(ctx);
  // frame
  ctx.strokeStyle = '#8a6a44';
  ctx.lineWidth = 0.6;
  ctx.strokeRect(0.3, 0.3, W - 0.6, H - 0.6);
}

/**
 * Faint names of the lands and seas, under everything else. Never smaller
 * than 8 px (on a phone they grow a little with the map's figures).
 */
function drawRegions(ctx, pxPerUnit) {
  const size = Math.max(1.9, 8 / pxPerUnit); // under the cities' 2.3
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const r of REGIONS) {
    ctx.save();
    if (r.kind === 'sea') {
      ctx.font = `italic ${(size * 0.95).toFixed(2)}px serif`;
      ctx.fillStyle = 'rgba(38,78,112,0.5)';
    } else {
      ctx.font = `${size.toFixed(2)}px serif`;
      ctx.fillStyle = 'rgba(105,82,48,0.5)';
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${(size * 0.24).toFixed(2)}px`; // spaced capitals, as old maps letter a land
    }
    ctx.fillText(r.text, r.pos[0], r.pos[1]);
    ctx.restore();
  }
  ctx.textBaseline = 'alphabetic';
}

/** North arrow in the Atlantic, the map's one empty corner. */
function drawCompass(ctx) {
  ctx.fillStyle = '#4f5f6b';
  ctx.font = '2.4px serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', 3.6, 4.4);
  ctx.beginPath();
  ctx.moveTo(3.6, 5.3); ctx.lineTo(2.6, 8.8); ctx.lineTo(4.6, 8.8);
  ctx.fill();
}

/**
 * A route's line, in the style of its kind (see the header), through `pts`
 * (map units). The legend passes two points for a short straight sample.
 * With `pxPerUnit` the line keeps about the same width on screen at any
 * map size (else it is drawn in map units, as in the legend).
 */
export function drawRoute(ctx, pts, sea, open, blocked, pxPerUnit = 0) {
  linePath(ctx, pts);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (sea) {
    ctx.setLineDash(open ? [] : [0.3, 1.2]);
    ctx.strokeStyle = blocked ? 'rgba(120,120,120,0.6)' : open ? '#1f5f99' : 'rgba(31,95,153,0.75)';
  } else {
    ctx.setLineDash(open ? [] : [1.6, 1.1]);
    ctx.strokeStyle = open ? '#7a4a1e' : 'rgba(122,74,30,0.7)';
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  ctx.lineWidth = !pxPerUnit ? (open ? 0.75 : 0.45) : open ? clamp(2.8 / pxPerUnit, 0.35, 0.75) : clamp(1.8 / pxPerUnit, 0.24, 0.45);
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

/** Rome: a purple square with a gold rim, named to its left over the sea (Capua's name is above and to the right). */
export function drawRome(ctx, pos, k = 1, named = true) {
  const [x, y] = pos;
  const s = 1.2 * k;
  ctx.fillStyle = '#6d2a6b';
  ctx.strokeStyle = '#d6ab3c';
  ctx.lineWidth = 0.45;
  ctx.fillRect(x - s, y - s, s * 2, s * 2);
  ctx.strokeRect(x - s, y - s, s * 2, s * 2);
  if (named) label(ctx, 'Rome', x - s - 0.6 * k, y + 0.8 * k, k, true, 'right');
}

/**
 * Draw city names, each on the first side of its marker (in its `sides`
 * order) where it overlaps no marker, no name already placed and stays on
 * the map; if every side clashes, the one that covers the least of the
 * others. Earlier names win.
 * @param {{text:string, pos:number[], r:number, bold:boolean, sides:string[]}[]} names
 */
export function placeLabels(ctx, names, k) {
  const taken = names.map(({ pos: [x, y], r }) => [x - r, y - r, x + r, y + r]); // the markers
  const hits = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  const size = 2.3 * k;
  names.forEach((n, i) => {
    ctx.font = `${n.bold ? 'bold ' : ''}${size.toFixed(2)}px serif`;
    const w = ctx.measureText(n.text).width;
    const [x, y] = n.pos;
    const gap = 0.45 * k;
    // [text x, baseline y, align] for each side, and the box the text fills
    const spots = {
      above: [x, y - n.r - gap - 0.25 * size, 'center'],
      below: [x, y + n.r + gap + 0.8 * size, 'center'],
      right: [x + n.r + gap, y + 0.35 * size, 'left'],
      left: [x - n.r - gap, y + 0.35 * size, 'right'],
    };
    const box = ([tx, by, align]) => {
      const x0 = align === 'center' ? tx - w / 2 : align === 'left' ? tx : tx - w;
      return [x0, by - 0.8 * size, x0 + w, by + 0.22 * size];
    };
    const fits = (b) => b[0] >= 0.5 && b[2] <= W - 0.5 && b[1] >= 0.5 && b[3] <= H - 0.5 && !taken.some((t, j) => j !== i && hits(b, t));
    // Where every side clashes (Vercellae among Lugdunum, Massilia, Aquileia
    // and the province), the side that covers the least of the others, so
    // two names never print over each other whole.
    const overlap = (b) => taken.reduce((a, t, j) => a + (j !== i && hits(b, t) ? (Math.min(b[2], t[2]) - Math.max(b[0], t[0])) * (Math.min(b[3], t[3]) - Math.max(b[1], t[1])) : 0), 0);
    const side = n.sides.find((s) => fits(box(spots[s])))
      || n.sides.reduce((best, s) => (overlap(box(spots[s])) < overlap(box(spots[best])) ? s : best), n.sides[0]);
    const [tx, by, align] = spots[side];
    taken.push(box(spots[side]));
    label(ctx, n.text, tx, by, k, n.bold, align);
  });
}

function label(ctx, text, x, y, k, bold, align = 'center') {
  ctx.font = `${bold ? 'bold ' : ''}${(2.3 * k).toFixed(2)}px serif`;
  ctx.textAlign = align;
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
 * Red and bold for raiders already in the province. `afloat`: it comes by
 * sea (sim/navy.js), so it sails in a dark longship under the pole.
 */
export function drawBanner(ctx, x, y, size, k = 1, attacking = false, afloat = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  if (afloat) {
    ctx.fillStyle = '#2e2218';
    ctx.beginPath();
    ctx.moveTo(-3.1, 0.2); ctx.lineTo(2.3, 0.2); ctx.lineTo(1.6, 1.1); ctx.lineTo(-2.5, 1.1);
    ctx.closePath();
    ctx.fill();
  }
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

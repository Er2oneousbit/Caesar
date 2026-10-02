/**
 * fishing.js
 * ----------------------------------------------------------------------------
 * Shipyards, fishing wharves and their boats. Fish is a food of its own.
 *
 *   Fishing water: a river, the sea or a big lake (FISH_BODY_MIN tiles or
 *   more), with fishing grounds where gulls circle (world/map.js
 *   computeFishing: derived from the terrain, never saved). Shipyards and
 *   wharves stand on its bank, on land, like a dock.
 *
 *   Shipyard: builds one fishing boat at a time from SHIPYARD_BOAT_TIMBER
 *   (100) timber: progress grows by staffing x 100 / SHIPYARD_BOAT_DAYS a day
 *   (x the difficulty's production), so a boat takes 16 days at full staff,
 *   but only while the yard holds the 100 timber; without it progress waits
 *   where it is. The timber is used when the boat is launched. Carts bring
 *   timber like a workshop's raw material (sim/storage.js rawRoomCap: a
 *   timber yard's carts, warehouses, dock wagons, nearest first) and the yard
 *   holds up to its inputCap (200, two boats). The boat is launched on the
 *   water beside the yard and waits there as the yard's spare: each day the
 *   yard sends it to the nearest staffed wharf on the same water (by water
 *   route) that has no boat. While its spare waits the yard builds nothing,
 *   so it keeps at most one boat in hand.
 *
 *   Wharf: its boat waits at the mooring (the water beside the wharf) for
 *   (1.02 - staffing) x BOAT_WAIT_DAYS days (0.2 at full staff, never with
 *   nobody at work, and not while the wharf holds WHARF_FULL fish), sails to
 *   the nearest fishing ground by water route, fishes FISH_DAYS (longer
 *   where the difficulty's production is lower), sails home and lands
 *   FISH_CATCH fish. Carts take the catch to a granary like a farm's
 *   harvest. Fishing goes on in every season: the sea does not freeze.
 *
 *   Boats are walkers (type 'fishing_boat', kind 'ship') that sail only on
 *   the water they were launched on, at walking pace, under bridges. A
 *   wharf's boat belongs to the wharf, a spare to its shipyard: when either
 *   building goes, its boat goes with it (sinks). Neptune's wrath sinks every
 *   boat (sinkFishingBoats); the yards build new ones.
 *
 * Unlike the original: a boat takes timber (the original's boats cost
 * nothing: Colonia's own rule, so a fishing fleet, and replacing one sunk by
 * Neptune or raiders, has a price in wood); the boat goes to the nearest
 * staffed wharf on its own water, not the first one built anywhere, staffed
 * or not; a yard never loses a finished boat (the original threw a boat
 * away when no water tile beside the yard was open on all sides); the
 * nearest ground is the nearest by water, not as the crow flies; a boat that
 * cannot get home vanishes with a message (at most one a month) instead of
 * being stranded; and the boat waits for the catch to be carted only when
 * two catches are waiting.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { spawnWalker, killWalker } from './entities.js';
import { followPath } from './movement.js';
import { shipOutput } from './production.js';
import { logGoods } from './goodsLedger.js';

const TPD = CONFIG.TICKS_PER_DAY;

/**
 * The water tile beside a shipyard or wharf (its slip or mooring), cached,
 * or -1. Also records which edge faces the water (b.waterSide: 0 = -y,
 * 1 = +x, 2 = +y, 3 = -x) for the art, as a dock does.
 */
export function waterBeside(game, b) {
  const map = game.map;
  if (b.mooring === undefined || b.mooring < 0 || !map.fishBody[b.mooring]) {
    b.mooring = map.fishWaterBeside(b.x, b.y, b.size);
    if (b.mooring >= 0) {
      const mx = map.xOf(b.mooring);
      const my = map.yOf(b.mooring);
      b.waterSide = my < b.y ? 0 : mx >= b.x + b.size ? 1 : my >= b.y + b.size ? 2 : 3;
    }
  }
  return b.mooring;
}

/** The water body (map.fishBody id) a shipyard or wharf works on, 0 for none. */
export function bodyOf(game, b) {
  const i = waterBeside(game, b);
  return i >= 0 ? game.map.fishBody[i] : 0;
}

/** Water route between two tiles of the same body (boats pass under bridges). */
function boatPath(game, from, to, body) {
  const fb = game.map.fishBody;
  if (fb[from] !== body || fb[to] !== body) return null;
  return game.pf.astar(from, to, (i) => (fb[i] === body ? 1 : Infinity), { maxNodes: game.map.size * 4 });
}

/** The boat that works for this wharf (or null), forgetting one that is gone. */
export function wharfBoat(game, b) {
  if (!b.boatId) return null;
  const w = game.walkers.get(b.boatId);
  if (w && !w.dead && w.origin === b.id) return w;
  b.boatId = 0;
  return null;
}

/** A shipyard's spare boat waiting for a wharf (or null). */
export function spareBoat(game, b) {
  if (!b.spareId) return null;
  const w = game.walkers.get(b.spareId);
  if (w && !w.dead && w.origin === b.id) return w;
  b.spareId = 0;
  return null;
}

// ---------------------------------------------------------------------------
// Shipyard
// ---------------------------------------------------------------------------

/** Daily: send the spare boat to a wharf, or work on the next one. */
export function updateShipyard(game, b) {
  const slip = waterBeside(game, b);
  const spare = spareBoat(game, b);
  if (spare) {
    sendSpare(game, b, spare);
    return; // the yard starts the next boat tomorrow
  }
  if (b.efficiency <= 0 || b.accessRoad < 0 || slip < 0) return;
  // No timber for the boat on the slip: the work waits, nothing is lost.
  if (!hasBoatTimber(b)) return;
  if (b.progress < 100) b.progress += (b.efficiency * 100 * game.difficulty.production) / CONFIG.SHIPYARD_BOAT_DAYS;
  if (b.progress < 100) return;
  const w = spawnWalker(game, 'fishing_boat', slip, b, { state: 'spare', body: game.map.fishBody[slip] });
  if (!w) return; // walker cap: the finished boat waits on the slip (progress and timber kept)
  b.progress = 0;
  b.stock.timber -= CONFIG.SHIPYARD_BOAT_TIMBER;
  logGoods(game, 'timber', 'used', CONFIG.SHIPYARD_BOAT_TIMBER);
  b.spareId = w.id;
  b.boatsBuilt = (b.boatsBuilt || 0) + 1;
}

/** Does the yard hold the timber for the boat on its slip? */
export function hasBoatTimber(b) {
  return (b.stock?.timber || 0) >= CONFIG.SHIPYARD_BOAT_TIMBER;
}

/**
 * The staffed wharves on the boat's water with no boat of their own, nearest
 * (by water route) first: [{ wharf, path }].
 */
function wharvesWanting(game, boat) {
  const here = game.map.idx(boat.x, boat.y);
  const out = [];
  for (const x of game.buildings.values()) {
    if (x.def.kind !== 'wharf' || x.efficiency <= 0 || wharfBoat(game, x)) continue;
    if (bodyOf(game, x) !== boat.body) continue;
    const path = boatPath(game, here, waterBeside(game, x), boat.body);
    if (path) out.push({ wharf: x, path });
  }
  out.sort((a, b) => a.path.length - b.path.length || a.wharf.id - b.wharf.id);
  return out;
}

/** How many wharves on this shipyard's water have no boat? (info panel) */
export function wharvesWithoutBoat(game, yard) {
  const body = bodyOf(game, yard);
  let n = 0;
  for (const x of game.buildings.values()) if (x.def.kind === 'wharf' && bodyOf(game, x) === body && body && !wharfBoat(game, x)) n++;
  return n;
}

/** The spare boat leaves the yard for the nearest wharf that wants one. */
function sendSpare(game, yard, boat) {
  const [best] = wharvesWanting(game, boat);
  if (!best) return;
  const { wharf, path } = best;
  // The boat now belongs to the wharf: it sinks with the wharf, not the yard.
  const k = yard.walkers.indexOf(boat.id);
  if (k >= 0) yard.walkers.splice(k, 1);
  boat.origin = wharf.id;
  wharf.walkers.push(boat.id);
  wharf.boatId = boat.id;
  yard.spareId = 0;
  boat.state = 'toWharf';
  followPath(game, boat, path);
}

// ---------------------------------------------------------------------------
// Wharf
// ---------------------------------------------------------------------------

/** Daily: forget a lost boat, and cart the catch to a granary. */
export function updateWharf(game, b) {
  waterBeside(game, b);
  wharfBoat(game, b);
  shipOutput(game, b, 'fish', CONFIG.CART_LOAD);
}

/** What the wharf's boat is doing, in words (info panel). */
export function boatStatus(game, b) {
  const w = wharfBoat(game, b);
  if (!w) return null;
  switch (w.state) {
    case 'toWharf': return 'On its way from the shipyard';
    case 'moored': return b.efficiency <= 0 ? 'At the wharf: nobody to sail her' : (b.stock.fish || 0) >= CONFIG.WHARF_FULL ? 'At the wharf, waiting for the catch to be carted away' : 'At the wharf, getting ready to sail';
    case 'toGround': return 'Sailing out to the fishing ground';
    case 'fishing': return 'Fishing';
    case 'homeWithCatch': return 'Coming back with the catch';
    default: return 'At the wharf';
  }
}

// ---------------------------------------------------------------------------
// The boat's trip
// ---------------------------------------------------------------------------

/** A boat reached the end of its route (walkers.js onPathEnd). */
export function boatArrive(game, w) {
  const wharf = game.buildings.get(w.origin);
  if (!wharf || wharf.def.kind !== 'wharf') { killWalker(game, w); return; }
  if (w.state === 'toGround') {
    w.state = 'fishing';
    w.waitTicks = Math.max(1, Math.round((CONFIG.FISH_DAYS / game.difficulty.production) * TPD));
    w.afterWait = 'boatHome';
    return;
  }
  if (w.state === 'homeWithCatch') landCatch(game, wharf);
  moor(game, w, wharf);
}

/** The catch goes into the wharf's store. */
function landCatch(game, wharf) {
  const n = CONFIG.FISH_CATCH;
  wharf.stock.fish = (wharf.stock.fish || 0) + n;
  wharf.catches = (wharf.catches || 0) + 1;
  game.city.produced.fish = (game.city.produced.fish || 0) + n;
  logGoods(game, 'fish', 'made', n);
  game.city.foodFlow.harvested += n;
}

/** Tied up at the wharf: wait, then sail (re-checked when the wait ends). */
function moor(game, w, wharf) {
  w.state = 'moored';
  w.path = null;
  w.moving = false;
  if (wharf.efficiency <= 0 || (wharf.stock.fish || 0) >= CONFIG.WHARF_FULL) {
    // Nobody to sail her, or no room on the quay: look again tomorrow.
    w.waitTicks = TPD;
    w.afterWait = 'boatCheck';
    return;
  }
  w.waitTicks = Math.max(1, Math.round((1.02 - wharf.efficiency) * CONFIG.BOAT_WAIT_DAYS * TPD));
  w.afterWait = 'boatSail';
}

/** A boat's wait ended (walkers.js). */
export function boatAfterWait(game, w, what) {
  const wharf = game.buildings.get(w.origin);
  if (w.state === 'spare') return; // the yard sends it (updateShipyard)
  if (!wharf || wharf.def.kind !== 'wharf') { killWalker(game, w); return; }
  if (what === 'boatHome') { sailHome(game, w, wharf); return; }
  if (what === 'boatSail' && wharf.efficiency > 0 && (wharf.stock.fish || 0) < CONFIG.WHARF_FULL) { sailOut(game, w, wharf); return; }
  moor(game, w, wharf);
}

/**
 * Where on a ground a boat fishes: the ground's tile or one beside it, by
 * the boat's id, so several boats at one ground spread out (looks only).
 */
function fishingSpot(game, g, w) {
  const { map } = game;
  const spots = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]
    .map(([dx, dy]) => [g.x + dx, g.y + dy])
    .filter(([x, y]) => map.inBounds(x, y) && map.fishBody[map.idx(x, y)] === g.body)
    .map(([x, y]) => map.idx(x, y));
  return spots[w.id % spots.length];
}

/** Off to the nearest fishing ground by water. */
function sailOut(game, w, wharf) {
  const here = game.map.idx(w.x, w.y);
  let best = null;
  for (const g of game.map.groundsOf(w.body)) {
    const path = boatPath(game, here, fishingSpot(game, g, w), w.body);
    if (path && (!best || path.length < best.path.length)) best = { g, path };
  }
  if (!best) {
    blocked(game, wharf, 'cannot reach any fishing ground');
    moor(game, w, wharf);
    return;
  }
  w.state = 'toGround';
  w.ground = { x: best.g.x, y: best.g.y };
  followPath(game, w, best.path);
}

/** Home with the catch; a boat that cannot get back is lost. */
function sailHome(game, w, wharf) {
  const path = boatPath(game, game.map.idx(w.x, w.y), waterBeside(game, wharf), w.body);
  if (!path) {
    blocked(game, wharf, 'could not find its way home and was lost with its catch');
    wharf.boatId = 0;
    killWalker(game, w);
    return;
  }
  w.state = 'homeWithCatch';
  followPath(game, w, path);
}

/** Tell the player a boat is stuck: kept on the wharf for its panel, a message at most once a month. */
function blocked(game, wharf, what) {
  wharf.boatTrouble = { what, day: game.time.totalDays };
  const flags = game.city.flags;
  if (flags.boatBlockedMonth === game.time.totalMonths) return;
  flags.boatBlockedMonth = game.time.totalMonths;
  game.message(`A fishing boat ${what}.`, 'warn', wharf.x, wharf.y);
}

/** Neptune's wrath: every fishing boat on the map sinks. @returns {number} boats sunk */
export function sinkFishingBoats(game) {
  let n = 0;
  for (const w of [...game.walkers.values()]) {
    if (w.type !== 'fishing_boat') continue;
    killWalker(game, w);
    n++;
  }
  for (const b of game.buildings.values()) {
    if (b.def.kind === 'wharf') b.boatId = 0;
    if (b.def.kind === 'shipyard') b.spareId = 0;
  }
  return n;
}

/** Is a wharf at work (staffed)? The Emperor asks for fish only then. */
export function hasWorkingWharf(game) {
  for (const b of game.buildings.values()) if (b.def.kind === 'wharf' && b.efficiency > 0) return true;
  return false;
}

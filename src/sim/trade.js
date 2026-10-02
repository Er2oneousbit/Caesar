/**
 * trade.js
 * ----------------------------------------------------------------------------
 * Trade with other cities, overland and by sea.
 *
 *   - The player opens a route (one-time cost) in the Trade advisor.
 *   - Land routes: every 1-2 months a caravan walks in along the Imperial road
 *     to the nearest staffed warehouse, sells the city its imports, buys its
 *     exports, then leaves by the exit. A partner whose round trip on the
 *     empire map is longer than that sends them less often, and a route
 *     busier than its traders can carry at that pace more often
 *     (sim/tradeDemand.js).
 *   - Sea routes: a merchant ship sails in from the map edge (map.seaEntry)
 *     to a free, staffed Dock and moors there while goods move both ways:
 *       - on mooring it fixes its manifest: what it will sell (imports) and
 *         what it wants to buy (exports), with the same rules as a caravan;
 *       - the dock's crane lands its imports on the quay, DOCK_LOAD every
 *         DOCK_UNLOAD_DAYS, and the city pays as each lot lands;
 *       - the dock's workers (1 to 3, by staffing) cart quay goods to where
 *         any cart would take them, and fetch exports, DOCK_LOAD a trip, from
 *         staffed warehouses within DOCK_REACH road tiles; the city is paid
 *         when a lot is handed over to the ship;
 *       - the ship casts off when both sides are done, after
 *         SHIP_MAX_STAY_DAYS, or when its Dock is lost.
 *     Ships need navigable water: a river, the coast or a big lake that
 *     reaches the map edge.
 *   - Per good, the player chooses: none / import / export, plus a stock level:
 *       export: sell only while city stock is ABOVE the level
 *       import: buy only while city stock is BELOW the level
 *   - Each partner buys/sells at most a fixed amount per good per year. What
 *     it buys may be set by the mission and change during it (demand in
 *     force, sim/tradeDemand.js); tradeMonthly tells the player when.
 *   - Horses are kept at the Horse Ranch, never in a warehouse (data/goods.js
 *     keptAt), so for horses the ranches stand in for the warehouses: a
 *     caravan sells into and buys from the ranches on its warehouse's roads,
 *     dock workers fetch exports from staffed ranches within DOCK_REACH and
 *     cart imports to a barracks that needs them or a ranch with room. With
 *     no ranch, no horses are imported (importBlockedText says so).
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { GOODS, GOOD_KEYS } from '../data/goods.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';
import { BUILDINGS } from '../data/buildings.js';
import { spawnWalker, killWalker } from './entities.js';
import { followPath, walkTo, goHome } from './movement.js';
import { cityStock, storageSpaceFor, storageAccepts, takeGoods, isStorage, receiveGoods, storageByRoad, isStable, stableRoom, stablesOf } from './storage.js';
import { militaryNeed } from './military.js';
import { dispatchCart, cartsOut } from './production.js';
import { transact } from './economy.js';
import { logGoods } from './goodsLedger.js';
import { partnerBuys, routeInterval, buysInForce, demandChangeAt } from './tradeDemand.js';
import { homeSiteId } from '../data/sites.js';
import { tripDays } from '../data/empireRoutes.js';

/** 'land' or 'sea' */
export function routeKind(partnerId) {
  return TRADE_PARTNERS[partnerId]?.route === 'sea' ? 'sea' : 'land';
}

/** Can ships reach this province at all? */
export function hasSeaAccess(game) {
  return !!game.map.seaEntry;
}

/** Initial trade state for a scenario. */
export function newTradeState(partnerIds) {
  const routes = {};
  for (const id of partnerIds) {
    if (!TRADE_PARTNERS[id]) continue;
    routes[id] = { open: false, sold: {}, bought: {}, nextVisit: 0, visits: 0 };
  }
  const settings = {};
  for (const g of GOOD_KEYS) settings[g] = { mode: 'none', level: 400 };
  return { routes, settings, log: [] };
}

/** The fewest days from opening a route to its first caravan or ship. */
export const FIRST_VISIT_DAYS = 8;

/**
 * Days from opening a route to its first caravan or ship: FIRST_VISIT_DAYS,
 * or the whole trip from a partner farther away (data/empireRoutes.js
 * tripDays): the first trader sets out from its city the day the route
 * opens, and the empire map shows it all the way.
 */
export function firstVisitDays(game, partnerId) {
  return Math.max(FIRST_VISIT_DAYS, tripDays(homeSiteId(game), partnerId));
}

/** Open a trade route. @returns {{ok:boolean, reason?:string}} */
export function openRoute(game, id) {
  const route = game.city.trade.routes[id];
  const p = TRADE_PARTNERS[id];
  if (!route || !p) return { ok: false, reason: 'Unknown trade partner.' };
  if (route.open) return { ok: false, reason: 'Route already open.' };
  if (routeKind(id) === 'sea' && !hasSeaAccess(game)) return { ok: false, reason: `${p.name} trades by sea, and no river or coast connects this province to the sea.` };
  if (game.city.treasury < p.openCost && !game.cheats.freeBuild) return { ok: false, reason: 'Not enough money.' };
  transact(game, 'other', -p.openCost);
  route.open = true;
  route.nextVisit = game.time.totalDays + firstVisitDays(game, id);
  const how = routeKind(id) === 'sea' ? 'Their ships will call at your Emporium soon.' : 'Their caravans will arrive along the Imperial road soon.';
  game.message(`Trade route to ${p.name} is open. ${how}`, 'good');
  return { ok: true };
}

/** Change how a good is traded. */
export function setTradeMode(game, good, mode, level) {
  const s = game.city.trade.settings[good];
  if (!s) return;
  if (mode) s.mode = mode;
  if (Number.isFinite(level)) s.level = Math.max(0, Math.min(3200, Math.round(level / 100) * 100));
}

/** Sea partners whose ship is waiting offshore for a free Emporium (see updateTrade). */
export function shipsWaiting(game) {
  return Object.entries(game.city.trade.routes).filter(([, r]) => r.open && r.waiting).map(([id]) => TRADE_PARTNERS[id].name);
}

/** The notice for ships waiting offshore, or null when none is. */
export function shipsWaitingText(game) {
  const names = shipsWaiting(game);
  if (!names.length) return null;
  const one = names.length === 1;
  return `${one ? 'A ship' : `${names.length} ships`} from ${names.join(', ')} ${one ? 'is' : 'are'} waiting offshore for a free Emporium. Another Emporium would take ${one ? 'it' : 'them'} in.`;
}

/** Daily: send caravans and ships for open routes when due. */
export function updateTrade(game) {
  const { routes } = game.city.trade;
  // Insane's winter (winterTrade 2): the wait for the next trader runs at half
  // speed, so half as many come from December to Februarius.
  const slow = game.difficulty.winterTrade ?? 1;
  const holdDay = slow > 1 && game.time.season() === 'winter' && game.time.totalDays % slow !== 0;
  for (const [id, r] of Object.entries(routes)) {
    if (!r.open) continue;
    if (holdDay && game.time.totalDays < r.nextVisit) r.nextVisit++;
    if (game.time.totalDays < r.nextVisit) continue;
    const sea = routeKind(id) === 'sea';
    // The usual range, or shorter for a route busier than its traders carry (sim/tradeDemand.js).
    const [a, b] = routeInterval(game, id);
    if (sea) {
      // A ship with nowhere to tie up tries again a few days later. One
      // turned away only because every staffed Emporium is taken waits
      // offshore (`waiting`): the dock panel and the Trade advisor say so,
      // since a city with many sea partners needs more than one Emporium.
      const res = spawnShip(game, id);
      r.nextVisit = game.time.totalDays + (res === true ? game.rng.range(a, b) : 6);
      if (res === 'busy') r.waiting = true;
      else delete r.waiting;
    } else {
      r.nextVisit = game.time.totalDays + game.rng.range(a, b);
      spawnCaravan(game, id);
    }
  }
}

/** Warn once per game about a trade problem (keyed so it is not repeated). */
function warnOnce(game, key, text) {
  const flags = game.city.flags;
  if (flags[key]) return;
  flags[key] = true;
  game.message(text, 'warn');
}

// ---------------------------------------------------------------------------
// Land: caravans
// ---------------------------------------------------------------------------

export function spawnCaravan(game, partnerId) {
  const { map, pf, buildings } = game;
  const entry = map.idx(map.entry.x, map.entry.y);
  if (!map.road[entry]) return;
  const found = pf.findNearest(entry, (id) => {
    const b = buildings.get(id);
    // An emptying warehouse takes no imports: the caravan goes on to the next.
    return b && b.def.kind === 'warehouse' && b.efficiency > 0 && !b.emptying;
  });
  if (!found) {
    const emptying = [...buildings.values()].some((b) => b.def.kind === 'warehouse' && b.efficiency > 0 && b.emptying);
    warnOnce(game, 'noWarehouseWarned', emptying
      ? `A caravan from ${TRADE_PARTNERS[partnerId].name} found no staffed warehouse on the road taking goods (an emptying warehouse takes none) and turned back.`
      : `A caravan from ${TRADE_PARTNERS[partnerId].name} found no staffed warehouse connected to the road and turned back.`);
    return;
  }
  const w = spawnWalker(game, 'caravan', entry, null, {
    partner: partnerId,
    target: found.id,
    state: 'toWarehouse',
    speed: CONFIG.WALKER_SPEED * 0.75,
  });
  if (w) followPath(game, w, found.path);
}

/** Caravan reached its warehouse: trade, then leave by the exit. */
export function caravanArrive(game, w) {
  const wh = game.buildings.get(w.target);
  if (wh && isStorage(wh)) {
    const out = tradeAt(game, w.partner, wh);
    logTrade(game, w.partner, out, 'land');
    // For the art only: the mules leave loaded with what the city sold them,
    // the biggest lots first (an empty list: they bought nothing).
    w.packs = caravanPacks(out.sold);
    w.deal = dealOf(out);
  }
  const { map } = game;
  w.state = 'leaving';
  if (!walkTo(game, w, map.idx(map.exit.x, map.exit.y))) killWalker(game, w);
}

/**
 * What a trader did here, kept on the walker for its info panel: the goods
 * the city sold it and bought from it, and the money each way.
 */
export function dealOf(out) {
  const only = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, n]) => n > 0));
  return { sold: only(out.sold), bought: only(out.bought), earned: out.earned || 0, spent: out.spent || 0 };
}

/** The (at most two) goods a leaving caravan shows on its mules, biggest lot first. */
export function caravanPacks(sold) {
  return Object.keys(sold || {}).filter((g) => sold[g] > 0).sort((a, b) => sold[b] - sold[a]).slice(0, 2);
}

/** Exchange goods between a caravan and one warehouse. */
export function tradeAt(game, partnerId, wh) {
  const out = { earned: 0, spent: 0, sold: {}, bought: {} };
  const route = game.city.trade.routes[partnerId];
  if (!TRADE_PARTNERS[partnerId] || !route) return out;
  // Horses are not the warehouse's to sell or take in: the caravan's drovers
  // deal with the ranches on its roads instead (looked up only if needed).
  let stables = null;
  const near = () => (stables = stables || ranchesNear(game, wh));
  const sources = (good) => (GOODS[good].keptAt ? near().filter((b) => isStable(b, good)) : [wh]);
  sellExports(game, partnerId, sources, CONFIG.CARAVAN_MAX_TRADE, out);
  // The caravan unloads into the warehouse itself, so staffing does not matter
  // here; its orders do (Refuse or Empty: no imports of that good here).
  const spaceFor = (good) => {
    if (GOODS[good].keptAt) return sources(good).reduce((n, b) => n + stableRoom(b), 0);
    return storageAccepts(wh, good) ? Math.max(0, storageCapacityLeft(wh)) : 0;
  };
  const put = (good, n) => {
    if (!GOODS[good].keptAt) { wh.stock[good] += n; return; }
    for (const b of sources(good)) { // nearest ranch first
      const k = Math.min(n, stableRoom(b));
      b.stock[good] += k;
      n -= k;
    }
  };
  buyImports(game, partnerId, CONFIG.CARAVAN_MAX_TRADE, out, spaceFor, put);
  route.visits++;
  return out;
}

/** The Horse Ranches on a warehouse's road network, nearest first (a caravan's horse trade). */
function ranchesNear(game, wh) {
  if (wh.accessRoad < 0) return [];
  return storageByRoad(game, wh.accessRoad, (b) => isStable(b, b.def.produces)).map((s) => s.b);
}

// ---------------------------------------------------------------------------
// Sea: ships and docks
// ---------------------------------------------------------------------------

/**
 * The navigable water tile where ships tie up beside a dock (cached), or -1.
 * Also records which edge of the dock faces the water (dock.waterSide:
 * 0 = -y, 1 = +x, 2 = +y, 3 = -x) for the art.
 */
export function dockBerth(game, dock) {
  const map = game.map;
  if (dock.berth === undefined || dock.berth < 0 || !map.navigable[dock.berth]) {
    dock.berth = map.navigableBeside(dock.x, dock.y, dock.size);
    if (dock.berth >= 0) {
      const bx = map.xOf(dock.berth);
      const by = map.yOf(dock.berth);
      dock.waterSide = by < dock.y ? 0 : bx >= dock.x + dock.size ? 1 : by >= dock.y + dock.size ? 2 : 3;
    }
  }
  return dock.berth;
}

/** Water route between two navigable tiles (ships sail under bridges). */
function shipPath(game, from, to) {
  const nav = game.map.navigable;
  return game.pf.astar(from, to, (i) => (nav[i] ? 1 : Infinity), { maxNodes: game.map.size * 4 });
}

/**
 * Send a ship to the nearest free, staffed dock.
 * @returns {boolean} false when no dock could take it (try again soon)
 */
function spawnShip(game, partnerId) {
  const { map } = game;
  const p = TRADE_PARTNERS[partnerId];
  if (!map.seaEntry) {
    warnOnce(game, `noSea:${partnerId}`, `Ships from ${p.name} cannot reach this province: no river or coast connects it to the sea.`);
    return true;
  }
  const entry = map.idx(map.seaEntry.x, map.seaEntry.y);
  let best = null;
  let busy = false;
  for (const b of game.buildings.values()) {
    if (b.def.kind !== 'dock' || b.efficiency <= 0) continue;
    const berth = dockBerth(game, b);
    if (berth < 0) continue;
    if (b.shipId && game.walkers.has(b.shipId)) { busy = true; continue; } // a ship is already there or on its way
    const path = shipPath(game, entry, berth);
    if (path && (!best || path.length < best.path.length)) best = { dock: b, path };
  }
  if (!best) {
    const anyDock = [...game.buildings.values()].some((b) => b.def.kind === 'dock');
    if (!anyDock) warnOnce(game, 'noDockWarned', `A ship from ${p.name} found no Emporium and sailed on. Build an Emporium (Trade Dock) on the shore to trade by sea.`);
    return busy ? 'busy' : false;
  }
  const w = spawnWalker(game, 'ship', entry, null, {
    partner: partnerId,
    target: best.dock.id,
    state: 'toDock',
    speed: CONFIG.SHIP_SPEED,
  });
  if (!w) return false;
  best.dock.shipId = w.id;
  followPath(game, w, best.path);
  return true;
}

// ---------------------------------------------------------------------------
// Sea: a ship at the dock
// ---------------------------------------------------------------------------
//
// A moored ship keeps on its walker:
//   unload     { good: units } still aboard to sell to the city (imports)
//   wants      { good: units } it still wants to buy (exports)
//   deal       what has changed hands so far (dealOf: sold, bought, earned, spent)
//   mooredTick game.time.totalTicks when it tied up
//   crane      ticks of crane work toward the next lot; craneIdle: ticks in a
//              row its cargo could not land; craneTurn, wantTurn: whose turn
//              among the goods (one good per lot, in turn); levelHeld: { good:
//              day } goods the import level held back today
//   wantsStuck nothing more can be fetched for it and no worker is out for
//              it (worked out at the dock's daily tick and when a worker
//              gets home)
// A dock worker out on an export carries `claim` { ship, good, amount, wh,
// picked }: the lot it is fetching, held against the ship's wants and, until
// picked up, against the city's surplus (so several workers, of any dock,
// never take a good below its export level) and the warehouse's stock.
// Claims are read off the walkers (exportClaims), never kept as totals, so
// a worker that vanishes takes its claim with it.

/** Units in whole trade lots (100s), never below 0. */
function lots(n) {
  return n > 0 ? Math.floor(n / CONFIG.CART_CAPACITY) * CONFIG.CART_CAPACITY : 0; // (NaN: 0)
}

function isEmpty(o) {
  if (!o) return true;
  for (const k in o) if (o[k] > 0) return false;
  return true;
}

/**
 * Dock workers a Dock fields at its staffing, as in the original: 3 at 75%
 * or more, 2 at 50% or more, 1 with any staff (of its 10 jobs: 8 or more,
 * 5 to 7, 1 to 4).
 */
export function dockWorkers(dock) {
  const e = dock.efficiency;
  return e >= 0.75 ? 3 : e >= 0.5 ? 2 : e > 0 ? 1 : 0;
}

/** Units currently held on a dock's quay. */
export function dockUsed(dock) {
  let n = 0;
  for (const k in dock.stock) n += dock.stock[k];
  return n;
}

/** The ship moored at this dock now (not one on its way in or leaving), or null. */
export function mooredShip(game, dock) {
  const s = dock && dock.shipId ? game.walkers.get(dock.shipId) : null;
  return s && s.state === 'docked' && s.target === dock.id ? s : null;
}

/** Ticks before a moored ship's stay limit. */
export function stayTicksLeft(game, ship) {
  return CONFIG.SHIP_MAX_STAY_DAYS * CONFIG.TICKS_PER_DAY - (game.time.totalTicks - (ship.mooredTick || 0));
}

/** Whole days a moored ship has been at the dock. */
export function daysMoored(game, ship) {
  return Math.floor((game.time.totalTicks - (ship.mooredTick || 0)) / CONFIG.TICKS_PER_DAY);
}

/** Ticks the crane takes to land `n` units. */
function craneTicks(n) {
  return Math.max(1, Math.round((n * CONFIG.DOCK_UNLOAD_DAYS * CONFIG.TICKS_PER_DAY) / CONFIG.DOCK_LOAD));
}

/**
 * Ticks a cart needs to walk `tiles` road tiles, plus a few for the stops (a
 * walker steps a tile in 1 / CART_SPEED ticks, arrives on the tick it gets
 * there, and a path that ends where it stands takes one tick).
 */
function tripTicks(tiles) {
  return Math.ceil(tiles / CONFIG.CART_SPEED) + 4;
}

/**
 * Every dock worker's export claim, read off the walkers:
 *   open    { good: units } claimed but not yet picked up (all ships)
 *   byShip  Map(ship id -> { good: units }) on the way to that ship, picked up or not
 *   atWh    Map(warehouse id -> { good: units }) still to be picked up there
 *   byPartner Map(partner id -> { good: units }) on the way to its ships: what
 *           its yearly quota will count when handed over
 */
export function exportClaims(game) {
  const open = {};
  const byShip = new Map();
  const atWh = new Map();
  const byPartner = new Map();
  const add = (map, key, good, n) => {
    let o = map.get(key);
    if (!o) map.set(key, (o = {}));
    o[good] = (o[good] || 0) + n;
  };
  for (const w of game.walkers.values()) {
    const c = w.claim;
    if (!c || w.dead) continue;
    add(byShip, c.ship, c.good, c.amount);
    if (c.partner) add(byPartner, c.partner, c.good, c.amount);
    if (!c.picked) {
      open[c.good] = (open[c.good] || 0) + c.amount;
      add(atWh, c.wh, c.good, c.amount);
    }
  }
  return { open, byShip, atWh, byPartner };
}

/** A partner's yearly quota left for a good it buys, less lots its ships' workers are bringing. */
function exportQuotaLeft(game, partnerId, good, claims) {
  const p = TRADE_PARTNERS[partnerId];
  const route = game.city.trade.routes[partnerId];
  if (!p || !route) return 0;
  return (partnerBuys(game, partnerId)[good] || 0) - (route.sold[good] || 0) - (claims.byPartner.get(partnerId)?.[good] || 0);
}

/**
 * Imports of a good already on their way into the city: what other moored
 * ships still have aboard for it (but `exceptShip`), and what dock workers
 * are carting from a quay to storage (off the quay, not yet in storage).
 * Import levels count them, so ships at two docks, or a ship and a caravan,
 * do not both fill the same shortfall.
 */
export function importsComing(game, good, exceptShip = 0, ships = true) {
  let n = 0;
  for (const w of game.walkers.values()) {
    if (w.dead) continue;
    if (ships && w.type === 'ship' && w.state === 'docked' && w.id !== exceptShip) n += w.unload?.[good] || 0;
    // A dock worker's load of imports, to storage or back to the quay (not an export: that has a claim).
    else if (w.type === 'cart' && !w.claim && (w.state === 'deliver' || w.state === 'return') && w.cargo?.good === good && game.buildings.get(w.origin)?.def.kind === 'dock') n += w.cargo.amount;
  }
  return n;
}

/**
 * How much more of a good kept at its own building (horses) can come in by
 * sea: room in the staffed ranches' stables plus what the barracks still
 * need, less what already waits on a quay, a dock worker's load with no place
 * held for it (one carrying it back to the quay), and other moored ships'
 * cargo (unless `ships` is false). A dock worker delivering horses is not
 * taken off again: the room he goes to is already held for him (the ranch's
 * `incoming`, or the barracks' in militaryNeed). 0 with no ranch at all.
 */
export function keptImportRoom(game, good, exceptShip = 0, ships = true) {
  const stables = stablesOf(game, good);
  if (!stables.length) return 0;
  let room = BUILDINGS.barracks.inputs.includes(good) ? militaryNeed(game, good) : 0;
  for (const b of stables) if (b.efficiency > 0) room += stableRoom(b);
  for (const b of game.buildings.values()) if (b.def.kind === 'dock') room -= b.stock[good] || 0;
  for (const w of game.walkers.values()) {
    if (w.dead) continue;
    if (ships && w.type === 'ship' && w.state === 'docked' && w.id !== exceptShip) room -= w.unload?.[good] || 0;
    else if (w.type === 'cart' && !w.claim && !w.reserve && w.cargo?.good === good && game.buildings.get(w.origin)?.def.kind === 'dock') room -= w.cargo.amount;
  }
  return Math.max(0, room);
}

/**
 * The Trade advisor's warnings: for each good set to Import that an open
 * route sells but that cannot come in now (importBlockedText), its reason.
 * Nothing for a good not on Import: a player who does not buy horses need
 * not be told to build a ranch for them.
 */
export function importWarnings(game) {
  const { routes, settings } = game.city.trade;
  const open = Object.keys(routes).filter((id) => routes[id].open && TRADE_PARTNERS[id]);
  return GOOD_KEYS
    .filter((g) => settings[g]?.mode === 'import' && open.some((id) => TRADE_PARTNERS[id].sells[g]))
    .map((g) => importBlockedText(game, g))
    .filter(Boolean);
}

/**
 * Why a good cannot be imported now, for the Trade advisor, or null:
 * horses with no Horse Ranch to keep them, or every ranch's stables full.
 */
export function importBlockedText(game, good) {
  const home = GOODS[good]?.keptAt;
  if (!home) return null;
  const ranch = BUILDINGS[home];
  const what = GOODS[good].name.toLowerCase();
  if (!stablesOf(game, good).length) return `No ${ranch.name} (${ranch.en}): ${what} cannot be imported. They live at a ranch, never in a warehouse.`;
  if (keptImportRoom(game, good) <= 0) return `Every ${ranch.name}'s stables are full (or unstaffed): no more ${what} can come in until some leave for a Tirocinium.`;
  return null;
}

/**
 * Staffed warehouses (and Horse Ranches, for horses) within DOCK_REACH road
 * tiles of a dock, as Map(id -> road tiles from the dock): where its workers
 * fetch exports.
 */
function exportSources(game, dock) {
  const out = new Map();
  if (dock.accessRoad < 0) return out;
  const store = (b) => b.def.kind === 'warehouse' || isStable(b, b.def.produces);
  for (const s of storageByRoad(game, dock.accessRoad, store)) {
    if (s.dist <= CONFIG.DOCK_REACH && s.b.efficiency > 0) out.set(s.b.id, s.dist);
  }
  return out;
}

/**
 * What a ship will trade, fixed when it ties up (amounts are not worked out
 * again, so goods on the way never count twice; the rules that can change
 * meanwhile are checked again lot by lot):
 *   unload: per good the partner sells and you import, the least of its
 *           quota left, the shortfall below your import level (less imports
 *           already on their way: importsComing) and what is left of
 *           SHIP_MAX_TRADE;
 *   wants:  per good the partner buys and you export, the least of its quota
 *           left (less lots its ships' workers are bringing), the surplus
 *           above your export level (less lots other workers have claimed),
 *           what is left of SHIP_MAX_TRADE, and what the quay and the
 *           warehouses the dock's workers could fetch from in time hold.
 * In whole lots of 100.
 */
export function shipManifest(game, partnerId, dock, exceptShip = 0) {
  const p = TRADE_PARTNERS[partnerId];
  const route = game.city.trade.routes[partnerId];
  const settings = game.city.trade.settings;
  const unload = {};
  const wants = {};
  if (!p || !route) return { unload, wants };
  let budget = CONFIG.SHIP_MAX_TRADE;
  for (const [good, cap] of Object.entries(p.sells)) {
    const s = settings[good];
    if (!s || s.mode !== 'import') continue;
    // Horses only as many as the ranches (and barracks) can take in.
    const room = GOODS[good].keptAt ? keptImportRoom(game, good, exceptShip) : Infinity;
    const n = lots(Math.min(cap - (route.bought[good] || 0), s.level - cityStock(game, good) - importsComing(game, good, exceptShip), budget, room));
    if (n > 0) { unload[good] = n; budget -= n; }
  }
  const claims = exportClaims(game);
  // A fresh fetch from the dock must be back before the stay limit.
  const far = CONFIG.SHIP_MAX_STAY_DAYS * CONFIG.TICKS_PER_DAY;
  const sources = [...exportSources(game, dock)].filter(([, d]) => tripTicks(2 * d) < far).map(([id]) => game.buildings.get(id));
  budget = CONFIG.SHIP_MAX_TRADE;
  for (const [good, cap] of Object.entries(partnerBuys(game, partnerId))) {
    const s = settings[good];
    if (!s || s.mode !== 'export') continue;
    let held = dock.stock[good] || 0;
    for (const b of sources) held += b.stock[good] || 0;
    const surplus = cityStock(game, good) - s.level - (claims.open[good] || 0);
    const n = lots(Math.min(exportQuotaLeft(game, partnerId, good, claims), surplus, budget, held));
    if (n > 0) { wants[good] = n; budget -= n; }
  }
  return { unload, wants };
}

/** A ship reached its berth: fix its manifest and set the dock's workers going. */
export function shipArrive(game, w) {
  const dock = game.buildings.get(w.target);
  const route = game.city.trade.routes[w.partner];
  w.state = 'docked';
  w.mooredTick = game.time.totalTicks;
  w.deal = dealOf({});
  w.unload = {};
  w.wants = {};
  w.crane = 0;
  w.craneIdle = 0;
  w.craneTurn = 0;
  w.wantTurn = 0;
  w.wantsStuck = false;
  // The Dock was lost while the ship sailed in: it turns round.
  if (!dock || dock.def.kind !== 'dock' || dock.shipId !== w.id || dock.efficiency <= 0 || !route) {
    shipLeave(game, w);
    return;
  }
  route.visits++;
  Object.assign(w, shipManifest(game, w.partner, dock));
  // Nothing to trade: it sails at once.
  if (isEmpty(w.unload) && isEmpty(w.wants)) {
    shipLeave(game, w);
    return;
  }
  handOverFromQuay(game, w, dock);
  dockDispatch(game, dock);
  reviewStay(game, w, dock);
}

/**
 * Every tick while moored: the crane lands the next lot when it is ready,
 * and the ship casts off when its stay is over (sim/walkers.js calls this).
 */
export function shipMoored(game, w) {
  const dock = game.buildings.get(w.target);
  if (!dock || dock.def.kind !== 'dock' || dock.shipId !== w.id || stayTicksLeft(game, w) <= 0) {
    shipLeave(game, w);
    return;
  }
  if (dock.efficiency > 0) runCrane(game, w, dock);
  if (stayDone(game, w)) shipLeave(game, w);
}

/**
 * Both sides done? Cargo: nothing aboard, or nothing could land for a whole
 * day (no room on the quay, no money, no partner quota). Wants: all met, or
 * nothing more can be fetched and no worker is out for this ship.
 */
function stayDone(game, w) {
  const cargoDone = isEmpty(w.unload) || w.craneIdle >= CONFIG.TICKS_PER_DAY;
  return cargoDone && (isEmpty(w.wants) || w.wantsStuck);
}

/**
 * The most of `good` the crane can land now (0: none, -1: drop the good, it
 * is no longer on Import or the partner's quota is used up): a lot of up
 * to DOCK_LOAD, as much as the quay has room for and the city can pay.
 * `level`: also no more than the city is still short of its import level
 * (a caravan or another ship may have filled it meanwhile), counting dock
 * workers' loads on their way to storage, and for horses no more than the
 * ranches and barracks can take in (keptImportRoom). That looks at every
 * building, so the crane asks only when a lot is due. Horses are dropped
 * when the city has no ranch left.
 */
function landable(game, w, dock, good, level = false) {
  const s = game.city.trade.settings[good];
  const p = TRADE_PARTNERS[w.partner];
  const route = game.city.trade.routes[w.partner];
  if (!s || s.mode !== 'import' || !p || !route) return -1;
  const quota = (p.sells[good] || 0) - (route.bought[good] || 0);
  if (quota < CONFIG.CART_CAPACITY) return -1;
  const kept = !!GOODS[good].keptAt;
  if (kept && !stablesOf(game, good).length) return -1; // the last ranch is gone: no horses can come in
  const afford = game.cheats.freeBuild ? Infinity : Math.floor(Math.max(0, game.city.treasury) / GOODS[good].buy) * 100;
  const short = level ? s.level - cityStock(game, good) - importsComing(game, good, 0, false) : Infinity;
  const room = level && kept ? keptImportRoom(game, good, 0, false) : Infinity;
  return lots(Math.min(CONFIG.DOCK_LOAD, w.unload[good], CONFIG.DOCK_CAPACITY - dockUsed(dock), quota, afford, short, room));
}

/** One tick of the crane: the next lot in turn lands once its time is up. */
function runCrane(game, w, dock) {
  if (isEmpty(w.unload)) return;
  for (const good of Object.keys(w.unload)) {
    if (!(w.unload[good] > 0) || landable(game, w, dock, good) < 0) delete w.unload[good];
  }
  const goods = Object.keys(w.unload);
  if (!goods.length) return;
  // Work done waits for the next lot, a full lot's worth at most.
  w.crane = Math.min((w.crane || 0) + 1, craneTicks(CONFIG.DOCK_LOAD));
  for (let k = 0; k < goods.length; k++) {
    const i = ((w.craneTurn || 0) + k) % goods.length;
    // A good held back by the import level today waits until tomorrow (that check looks at the whole city).
    if (w.levelHeld?.[goods[i]] === game.time.totalDays) continue;
    const lot = landable(game, w, dock, goods[i]);
    if (lot <= 0) continue;
    if (w.crane < craneTicks(lot)) { w.craneIdle = 0; return; }
    // Due: now the import level too (the lot may come out smaller, never larger).
    const n = landable(game, w, dock, goods[i], true);
    if (n <= 0) {
      w.levelHeld = { ...w.levelHeld, [goods[i]]: game.time.totalDays };
      continue;
    }
    w.craneIdle = 0;
    w.crane -= craneTicks(n);
    w.craneTurn = i + 1;
    land(game, w, dock, goods[i], n);
    return;
  }
  w.craneIdle = (w.craneIdle || 0) + 1;
}

/** A lot lands on the quay: the city pays for it now, and the partner's quota counts it. */
function land(game, w, dock, good, n) {
  const route = game.city.trade.routes[w.partner];
  const money = Math.round((GOODS[good].buy * n) / 100);
  dock.stock[good] += n;
  w.unload[good] -= n;
  if (w.unload[good] <= 0) delete w.unload[good];
  transact(game, 'imports', -money);
  route.bought[good] = (route.bought[good] || 0) + n;
  w.deal.bought[good] = (w.deal.bought[good] || 0) + n;
  w.deal.spent += money;
  logGoods(game, good, 'imported', n);
  game.events.emit('sound', { name: 'coin' });
  dockDispatch(game, dock); // a free dock worker can take it on now
}

/**
 * Hand up to `n` units of `good` to the ship: the city is paid and the
 * partner's quota counts them now. Only while the ship still wants the good,
 * it is still on Export and the quota has room. @returns units handed over
 */
function handOver(game, w, good, n) {
  const s = game.city.trade.settings[good];
  const p = TRADE_PARTNERS[w.partner];
  const route = game.city.trade.routes[w.partner];
  if (!s || s.mode !== 'export' || !p || !route) return 0;
  const quota = (partnerBuys(game, w.partner)[good] || 0) - (route.sold[good] || 0);
  // The partner bought its year's worth meanwhile (another of its ships): it wants no more.
  if (quota < CONFIG.CART_CAPACITY) delete w.wants[good];
  const take = lots(Math.min(n, w.wants[good] || 0, quota));
  if (take <= 0) return 0;
  const money = Math.round((GOODS[good].sell * take) / 100);
  w.wants[good] -= take;
  if (w.wants[good] <= 0) delete w.wants[good];
  transact(game, 'exports', money);
  route.sold[good] = (route.sold[good] || 0) + take;
  w.deal.sold[good] = (w.deal.sold[good] || 0) + take;
  w.deal.earned += money;
  logGoods(game, good, 'exported', take);
  game.events.emit('sound', { name: 'coin' });
  return take;
}

/**
 * Goods of a kind the ship wants that already sit on the quay go aboard
 * without a walk: up to its wants not yet claimed by a worker, and never
 * below the export level.
 */
function handOverFromQuay(game, w, dock) {
  const settings = game.city.trade.settings;
  const claims = exportClaims(game);
  const mine = claims.byShip.get(w.id) || {};
  for (const good of Object.keys(w.wants)) {
    const s = settings[good];
    if (!s || s.mode !== 'export') continue;
    const n = lots(Math.min(dock.stock[good] || 0, w.wants[good] - (mine[good] || 0), cityStock(game, good) - s.level - (claims.open[good] || 0)));
    if (n <= 0) continue;
    dock.stock[good] -= n;
    dock.stock[good] += n - handOver(game, w, good, n);
  }
}

/**
 * Is the ship done? Worked out at the dock's daily tick and whenever a
 * worker gets home: whether anything more can be fetched for it (and no
 * worker is still out for it), then the cast-off rule.
 */
function reviewStay(game, w, dock) {
  if (w.state !== 'docked') return;
  const claims = exportClaims(game);
  const out = !isEmpty(claims.byShip.get(w.id));
  w.wantsStuck = !out && (isEmpty(w.wants) || !(dock.efficiency > 0 && planFetch(game, dock, w, dock.accessRoad, claims)));
  if (stayDone(game, w)) shipLeave(game, w);
}

/**
 * A dock worker's next export fetch for the moored ship, from road tile
 * `from`, or null: the good (in turn through the ship's wants), the nearest
 * staffed warehouse by road within DOCK_REACH of the dock with a lot to
 * spare, and the amount: up to DOCK_LOAD, never more than the ship's wants
 * not yet claimed or the city's surplus above the export level (less open
 * claims). A trip that would not be back before the ship's stay limit is not
 * made.
 */
function planFetch(game, dock, w, from, claims = exportClaims(game), sources = exportSources(game, dock)) {
  if (from < 0 || !sources.size) return null;
  const settings = game.city.trade.settings;
  const goods = Object.keys(w.wants).filter((g) => w.wants[g] > 0);
  const mine = claims.byShip.get(w.id) || {};
  const left = stayTicksLeft(game, w);
  const walk = Math.floor(left * CONFIG.CART_SPEED); // no farther than a cart can walk in the time left
  for (let k = 0; k < goods.length; k++) {
    const turn = ((w.wantTurn || 0) + k) % goods.length;
    const good = goods[turn];
    const s = settings[good];
    if (!s || s.mode !== 'export') continue;
    const most = lots(Math.min(CONFIG.DOCK_LOAD, w.wants[good] - (mine[good] || 0), exportQuotaLeft(game, w.partner, good, claims),
      cityStock(game, good) - s.level - (claims.open[good] || 0)));
    if (most <= 0) continue;
    const spare = (b) => (b.stock[good] || 0) - (claims.atWh.get(b.id)?.[good] || 0);
    const found = game.pf.findNearest(from, (id) => {
      const b = sources.has(id) ? game.buildings.get(id) : null;
      return !!b && spare(b) >= CONFIG.CART_CAPACITY;
    }, walk);
    if (!found || found.path.length - 1 >= walk) continue;
    // Time the way back from where it will stand (a far side of the
    // warehouse may be farther from the dock than its near side).
    const back = game.pf.roadPath(found.goal, dock.accessRoad);
    if (!back || tripTicks(found.path.length + back.length - 2) >= left) continue;
    const wh = game.buildings.get(found.id);
    return { good, wh, amount: lots(Math.min(most, spare(wh))), path: found.path, turn: turn + 1 };
  }
  return null;
}

/** Send dock worker `cart` (out already, or new) on a planned fetch. */
function startFetch(game, cart, ship, plan) {
  cart.state = 'dockFetch';
  cart.target = plan.wh.id;
  cart.want = plan.good;
  cart.claim = { ship: ship.id, partner: ship.partner, good: plan.good, amount: plan.amount, wh: plan.wh.id, picked: false };
  ship.wantTurn = plan.turn;
  ship.wantsStuck = false;
  followPath(game, cart, plan.path);
}

/**
 * Free dock workers take their next jobs, in this order, until the dock's
 * number by staffing (dockWorkers) are out:
 *   1. a lot from the quay (up to DOCK_LOAD of one good) to wherever any
 *      cart would take it (findDeliveryTarget: a barracks, a workshop, a
 *      granary for food, storage that accepts it), unless the moored ship
 *      wants that good;
 *   2. an export fetch for the moored ship (planFetch).
 * Run at the dock's daily tick, when a worker gets home and when a lot lands.
 */
export function dockDispatch(game, dock) {
  if (dock.efficiency <= 0 || dock.accessRoad < 0) return;
  const ship = mooredShip(game, dock);
  const most = dockWorkers(dock);
  const stuck = new Set();
  let triedQuay = false;
  let sources = null;
  while (cartsOut(game, dock) < most) {
    triedQuay = true;
    if (sendQuayLot(game, dock, ship, stuck)) continue;
    if (!ship) break;
    sources = sources || exportSources(game, dock);
    const plan = planFetch(game, dock, ship, dock.accessRoad, exportClaims(game), sources);
    if (!plan) break;
    const cart = spawnWalker(game, 'cart', dock.accessRoad, dock, { speed: CONFIG.CART_SPEED });
    if (!cart) break; // the city is at its walker limit
    startFetch(game, cart, ship, plan);
  }
  // For the panel: imports piling up with nowhere to go.
  if (triedQuay) dock.noStorage = stuck.size > 0;
}

/** One lot off the quay to storage. @returns {boolean} a cart went */
function sendQuayLot(game, dock, ship, stuck) {
  for (const good of Object.keys(dock.stock)) {
    const have = dock.stock[good];
    if (have < CONFIG.CART_CAPACITY || stuck.has(good)) continue;
    if (ship && (ship.wants[good] || 0) > 0) continue; // the ship takes it (handOverFromQuay)
    // Up to a wagon, as much as the best place can take: a workshop that uses
    // it holds only WORKSHOP_RAW_CAP (a shipyard its 200 timber), and still
    // comes before a warehouse.
    if (dispatchCart(game, dock, good, Math.min(CONFIG.DOCK_LOAD, lots(have)), true)) return true;
    stuck.add(good);
  }
  return false;
}

/**
 * A dock worker unloaded imports at storage: if the moored ship still wants
 * something it goes straight on from there to fetch it, without coming home
 * first (the original's "import out, export back"). @returns {boolean}
 */
export function dockWorkerOnward(game, w) {
  const dock = game.buildings.get(w.origin);
  const ship = mooredShip(game, dock);
  const here = game.map.idx(w.x, w.y);
  if (!ship || dock.efficiency <= 0 || !game.map.road[here]) return false;
  const plan = planFetch(game, dock, ship, here);
  if (!plan) return false;
  startFetch(game, w, ship, plan);
  return true;
}

/**
 * A dock worker reached the warehouse it is fetching from: it loads its lot,
 * checking again that the ship is still moored, the good still on Export,
 * and that the city keeps its export level (other open claims counted).
 * Nothing to take: the claim is released and it tries another fetch from
 * here (twice at most), else it heads home empty.
 */
export function dockFetchArrive(game, w) {
  const c = w.claim;
  const wh = game.buildings.get(w.target);
  const dock = game.buildings.get(w.origin);
  const ship = mooredShip(game, dock);
  const s = c ? game.city.trade.settings[c.good] : null;
  let got = 0;
  if (c && wh && (wh.def.kind === 'warehouse' || isStable(wh, c.good)) && ship && ship.id === c.ship && s && s.mode === 'export') {
    const others = (exportClaims(game).open[c.good] || 0) - c.amount;
    got = takeGoods(wh, c.good, lots(Math.min(c.amount, wh.stock[c.good] || 0, cityStock(game, c.good) - s.level - others)));
  }
  if (got > 0) {
    c.amount = got;
    c.picked = true;
    w.cargo = { good: c.good, amount: got };
    if (!goHome(game, w)) wh.stock[c.good] += got; // no way home: the lot stays where it was
    return;
  }
  w.claim = null;
  w.tries = (w.tries || 0) + 1;
  if (w.tries < 3 && dockWorkerOnward(game, w)) return;
  goHome(game, w);
}

/**
 * A dock worker is home. A lot it fetched goes aboard if its ship is still
 * moored and still wants it; what is left (the ship sailed, or the good went
 * off Export) stays on the quay as city goods, and dock workers take it to
 * storage like any other. Then the dock sends out its free workers again.
 */
export function dockWorkerHome(game, w, dock) {
  const ship = mooredShip(game, dock);
  if (w.cargo && w.cargo.amount > 0) {
    if (ship && w.claim && w.claim.ship === ship.id) w.cargo.amount -= handOver(game, ship, w.cargo.good, w.cargo.amount);
    if (w.cargo.amount > 0) receiveGoods(dock, w.cargo.good, w.cargo.amount, true);
  }
  w.cargo = null;
  w.claim = null;
  killWalker(game, w);
  dockDispatch(game, dock);
  if (ship) reviewStay(game, ship, dock);
}

/** Leaving: sail back to open water and leave the map. The visit goes in the trade log now. */
export function shipLeave(game, w) {
  const { map } = game;
  const dock = game.buildings.get(w.target);
  if (dock && dock.shipId === w.id) dock.shipId = 0;
  if (w.deal && !w.dealLogged) {
    // The goods book counted each lot as it moved (land, handOver).
    logTrade(game, w.partner, dealOf(w.deal), 'sea', false);
    w.dealLogged = true;
  }
  w.state = 'leaving';
  if (!map.seaEntry) { killWalker(game, w); return; }
  const here = map.idx(w.x, w.y);
  const path = shipPath(game, here, map.idx(map.seaEntry.x, map.seaEntry.y));
  if (path) followPath(game, w, path);
  else killWalker(game, w);
}

/**
 * Daily: a Dock that lost its staff sends its ship away; goods the ship
 * wants that are on the quay go aboard; free dock workers take their next
 * jobs (dockDispatch); then the ship's stay is reviewed.
 */
export function updateDock(game, b) {
  dockBerth(game, b);
  const ship = mooredShip(game, b);
  if (ship && b.efficiency <= 0) shipLeave(game, ship);
  if (b.efficiency <= 0) return;
  if (ship) handOverFromQuay(game, ship, b);
  dockDispatch(game, b);
  if (ship) reviewStay(game, ship, b);
}

// ---------------------------------------------------------------------------
// Shared trading rules
// ---------------------------------------------------------------------------

/** The partner buys goods marked for export, taking them from `sources(good)` in order. */
function sellExports(game, partnerId, sourcesFor, budget, out) {
  const route = game.city.trade.routes[partnerId];
  const settings = game.city.trade.settings;
  for (const [good, cap] of Object.entries(partnerBuys(game, partnerId))) {
    const s = settings[good];
    if (!s || s.mode !== 'export' || budget <= 0) continue;
    const quota = cap - (route.sold[good] || 0);
    const surplus = cityStock(game, good) - s.level;
    let want = Math.floor(Math.min(quota, surplus, budget) / 100) * 100;
    let n = 0;
    for (const wh of want > 0 ? sourcesFor(good) : []) {
      if (want <= 0) break;
      const take = Math.floor(Math.min(wh.stock[good] || 0, want) / 100) * 100;
      if (take <= 0) continue;
      takeGoods(wh, good, take);
      want -= take;
      n += take;
    }
    if (n <= 0) continue;
    const money = Math.round((GOODS[good].sell * n) / 100);
    transact(game, 'exports', money);
    route.sold[good] = (route.sold[good] || 0) + n;
    budget -= n;
    out.earned += money;
    out.sold[good] = n;
  }
}

/**
 * The partner sells goods marked for import.
 * @param {(good:string)=>number} spaceFor   room for this good at the destination
 * @param {(good:string, n:number)=>void} put  unload n units there
 */
function buyImports(game, partnerId, budget, out, spaceFor, put) {
  const p = TRADE_PARTNERS[partnerId];
  const route = game.city.trade.routes[partnerId];
  const settings = game.city.trade.settings;
  for (const [good, cap] of Object.entries(p.sells)) {
    const s = settings[good];
    if (!s || s.mode !== 'import' || budget <= 0) continue;
    const quota = cap - (route.bought[good] || 0);
    // Imports a moored ship still has aboard, or dock workers are carting, count as on their way.
    const shortfall = s.level - cityStock(game, good) - importsComing(game, good);
    const price = GOODS[good].buy;
    const affordable = game.cheats.freeBuild ? 1e9 : Math.floor(Math.max(0, game.city.treasury) / price) * 100;
    let n = Math.min(quota, shortfall, budget, affordable, spaceFor(good));
    n = Math.floor(n / 100) * 100;
    if (n <= 0) continue;
    put(good, n);
    const money = Math.round((price * n) / 100);
    transact(game, 'imports', -money);
    route.bought[good] = (route.bought[good] || 0) + n;
    budget -= n;
    out.spent += money;
    out.bought[good] = n;
  }
}

/**
 * Remember a visit in the trade log (Trade advisor), one entry a visit.
 * `goods`: also count the goods in this month's goods book (a ship's lots
 * were counted one by one as they moved, so it passes false).
 */
function logTrade(game, partnerId, summary, kind, goods = true) {
  if (!summary.earned && !summary.spent) return;
  if (goods) {
    for (const [good, n] of Object.entries(summary.sold || {})) logGoods(game, good, 'exported', n);
    for (const [good, n] of Object.entries(summary.bought || {})) logGoods(game, good, 'imported', n);
  }
  const log = game.city.trade.log;
  log.unshift({ date: game.time.shortLabel(), partner: TRADE_PARTNERS[partnerId].name, kind, ...summary });
  if (log.length > 20) log.pop();
}

function storageCapacityLeft(wh) {
  let used = 0;
  let inc = 0;
  for (const k in wh.stock) used += wh.stock[k];
  for (const k in wh.incoming) inc += wh.incoming[k];
  return CONFIG.WAREHOUSE_CAPACITY - used - inc;
}

/**
 * Monthly: a demand change that takes effect this month (scenario
 * `demandChanges`, sim/tradeDemand.js) is told, naming the city and the good,
 * as the original's "trade increased" and "decreased" news did. Nothing is
 * changed here: the amounts in force are worked out from the date.
 */
export function tradeMonthly(game) {
  const changes = game.scenario.demandChanges;
  if (!Array.isArray(changes)) return;
  const now = game.time.totalMonths;
  changes.forEach((c, k) => {
    const p = TRADE_PARTNERS[c.partner];
    if (!p || !game.city.trade.routes[c.partner] || demandChangeAt(game.seed, c, k) !== now) return;
    // What it bought just before this change: every change that takes effect
    // before it (another of the same month included), not last month's.
    const was = buysInForce(game.scenario, game.seed, c.partner, now, k)[c.good] || 0;
    const good = (GOODS[c.good]?.name || c.good).toLowerCase();
    const units = (n) => Math.round(n).toLocaleString('en-US');
    if (!(c.to > 0)) game.message(`Trade stopped: ${p.name} no longer buys ${good}.`, 'warn');
    else if (c.to > was) game.message(`Trade increased: ${p.name} now buys ${units(c.to)} ${good} a year (was ${units(was)}).`, 'good');
    else if (c.to < was) game.message(`Trade decreased: ${p.name} now buys only ${units(c.to)} ${good} a year (was ${units(was)}).`, 'warn');
  });
}

/** Yearly: partners' quotas reset. */
export function resetTradeYear(game) {
  for (const r of Object.values(game.city.trade.routes)) {
    r.sold = {};
    r.bought = {};
  }
}

// Re-export for UI convenience
export { storageSpaceFor };

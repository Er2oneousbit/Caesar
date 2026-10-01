/**
 * trade.js
 * ----------------------------------------------------------------------------
 * Trade with other cities, overland and by sea.
 *
 *   - The player opens a route (one-time cost) in the Trade advisor.
 *   - Land routes: every 1-2 months a caravan walks in along the Imperial road
 *     to the nearest staffed warehouse, sells the city its imports, buys its
 *     exports, then leaves by the exit.
 *   - Sea routes: a merchant ship sails in from the map edge (map.seaEntry)
 *     to a free, staffed Dock. It unloads imports INTO THE DOCK (dock workers
 *     then cart them to warehouses, workshops or granaries), buys exports from
 *     warehouses within DOCK_REACH road tiles of the dock, waits while it is
 *     loaded, then sails away. Ships need navigable water: a river, the coast
 *     or a big lake that reaches the map edge.
 *   - Per good, the player chooses: none / import / export, plus a stock level:
 *       export: sell only while city stock is ABOVE the level
 *       import: buy only while city stock is BELOW the level
 *   - Each partner buys/sells at most a fixed amount per good per year.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { GOODS, GOOD_KEYS } from '../data/goods.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';
import { spawnWalker, killWalker } from './entities.js';
import { followPath, walkTo } from './movement.js';
import { cityStock, storageSpaceFor, storageAccepts, takeGoods, isStorage } from './storage.js';
import { dispatchCart, cartsOut } from './production.js';
import { transact } from './economy.js';
import { logGoods } from './goodsLedger.js';

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

/** Days from opening a route to its first caravan or ship (the empire map sends that one out from its city on the day). */
export const FIRST_VISIT_DAYS = 8;

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
  route.nextVisit = game.time.totalDays + FIRST_VISIT_DAYS;
  const how = routeKind(id) === 'sea' ? 'Their ships will call at your Dock soon.' : 'Their caravans will arrive along the Imperial road soon.';
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
    const [a, b] = sea ? CONFIG.SHIP_INTERVAL_DAYS : CONFIG.CARAVAN_INTERVAL_DAYS;
    if (sea) {
      // A ship with nowhere to tie up tries again a few days later.
      r.nextVisit = game.time.totalDays + (spawnShip(game, id) ? game.rng.range(a, b) : 6);
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
  sellExports(game, partnerId, [wh], CONFIG.CARAVAN_MAX_TRADE, out);
  // The caravan unloads into the warehouse itself, so staffing does not matter
  // here; its orders do (Refuse or Empty: no imports of that good here).
  buyImports(game, partnerId, CONFIG.CARAVAN_MAX_TRADE, out, (good) => (storageAccepts(wh, good) ? Math.max(0, storageCapacityLeft(wh)) : 0), (good, n) => { wh.stock[good] += n; });
  route.visits++;
  return out;
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
  for (const b of game.buildings.values()) {
    if (b.def.kind !== 'dock' || b.efficiency <= 0) continue;
    if (b.shipId && game.walkers.has(b.shipId)) continue; // a ship is already there or on its way
    const berth = dockBerth(game, b);
    if (berth < 0) continue;
    const path = shipPath(game, entry, berth);
    if (path && (!best || path.length < best.path.length)) best = { dock: b, path };
  }
  if (!best) {
    const anyDock = [...game.buildings.values()].some((b) => b.def.kind === 'dock');
    if (!anyDock) warnOnce(game, 'noDockWarned', `A ship from ${p.name} found no Dock and sailed on. Build a Dock on the shore to trade by sea.`);
    return false;
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

/** A ship reached its berth: trade, then wait while it is loaded. */
export function shipArrive(game, w) {
  const dock = game.buildings.get(w.target);
  if (dock && dock.def.kind === 'dock') {
    const out = tradeAtDock(game, w.partner, dock);
    logTrade(game, w.partner, out, 'sea');
    w.deal = dealOf(out);
    game.events.emit('sound', { name: 'coin' });
  }
  w.state = 'docked';
  w.waitTicks = CONFIG.SHIP_DOCK_TICKS;
  w.afterWait = 'shipLeave';
}

/** Loaded: sail back to open water and leave the map. */
export function shipLeave(game, w) {
  const { map } = game;
  const dock = game.buildings.get(w.target);
  if (dock && dock.shipId === w.id) dock.shipId = 0;
  if (!map.seaEntry) { killWalker(game, w); return; }
  const here = map.idx(w.x, w.y);
  const path = shipPath(game, here, map.idx(map.seaEntry.x, map.seaEntry.y));
  w.state = 'leaving';
  if (path) followPath(game, w, path);
  else killWalker(game, w);
}

/**
 * Warehouses a dock can reach by road (within DOCK_REACH tiles), nearest
 * first. Ships buy exports from these.
 */
function warehousesNear(game, dock) {
  const { map, pf, buildings } = game;
  if (dock.accessRoad < 0) return [];
  const found = [];
  const seen = new Set();
  const w = map.w;
  pf.bfsRoad(dock.accessRoad, (i) => {
    const x = i % w;
    const y = (i / w) | 0;
    for (const [nx, ny] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]) {
      if (!map.inBounds(nx, ny)) continue;
      const id = map.building[map.idx(nx, ny)];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const b = buildings.get(id);
      if (b && b.def.kind === 'warehouse' && b.efficiency > 0) found.push(b);
    }
    return false; // keep searching: we want all of them
  }, CONFIG.DOCK_REACH);
  return found;
}

/** Units currently held on a dock's quay. */
export function dockUsed(dock) {
  let n = 0;
  for (const k in dock.stock) n += dock.stock[k];
  return n;
}

/** A ship trades at a dock: exports from nearby warehouses, imports onto the quay. */
export function tradeAtDock(game, partnerId, dock) {
  const out = { earned: 0, spent: 0, sold: {}, bought: {} };
  const route = game.city.trade.routes[partnerId];
  if (!TRADE_PARTNERS[partnerId] || !route) return out;
  sellExports(game, partnerId, warehousesNear(game, dock), CONFIG.SHIP_MAX_TRADE, out);
  buyImports(game, partnerId, CONFIG.SHIP_MAX_TRADE, out, () => Math.max(0, CONFIG.DOCK_CAPACITY - dockUsed(dock)), (good, n) => { dock.stock[good] += n; });
  route.visits++;
  return out;
}

/** Daily: dock workers cart unloaded imports to where they are needed. */
export function updateDock(game, b) {
  dockBerth(game, b);
  if (b.efficiency <= 0 || b.accessRoad < 0) return;
  for (const good of Object.keys(b.stock)) {
    if (cartsOut(game, b) >= 2) return;
    const lots = Math.floor(b.stock[good] / CONFIG.CART_CAPACITY);
    if (lots <= 0) continue;
    const amount = Math.min(CONFIG.CART_LOAD, lots * CONFIG.CART_CAPACITY);
    dispatchCart(game, b, good, amount);
  }
}

// ---------------------------------------------------------------------------
// Shared trading rules
// ---------------------------------------------------------------------------

/** The partner buys goods marked for export, taking them from `sources` in order. */
function sellExports(game, partnerId, sources, budget, out) {
  const p = TRADE_PARTNERS[partnerId];
  const route = game.city.trade.routes[partnerId];
  const settings = game.city.trade.settings;
  for (const [good, cap] of Object.entries(p.buys)) {
    const s = settings[good];
    if (!s || s.mode !== 'export' || budget <= 0) continue;
    const quota = cap - (route.sold[good] || 0);
    const surplus = cityStock(game, good) - s.level;
    let want = Math.floor(Math.min(quota, surplus, budget) / 100) * 100;
    let n = 0;
    for (const wh of sources) {
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
    const shortfall = s.level - cityStock(game, good);
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

/** Remember a visit in the trade log (Trade advisor). */
function logTrade(game, partnerId, summary, kind) {
  if (!summary.earned && !summary.spent) return;
  for (const [good, n] of Object.entries(summary.sold || {})) logGoods(game, good, 'exported', n);
  for (const [good, n] of Object.entries(summary.bought || {})) logGoods(game, good, 'imported', n);
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

/** Yearly: partners' quotas reset. */
export function resetTradeYear(game) {
  for (const r of Object.values(game.city.trade.routes)) {
    r.sold = {};
    r.bought = {};
  }
}

// Re-export for UI convenience
export { storageSpaceFor };

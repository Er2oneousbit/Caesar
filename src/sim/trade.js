/**
 * trade.js
 * ----------------------------------------------------------------------------
 * Overland trade with other cities.
 *
 *   - The player opens a route (one-time cost) in the Trade advisor.
 *   - Every 1-2 months a caravan walks in from the map entry to the nearest
 *     warehouse, buys the city's exports and sells it imports, then leaves.
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
import { cityStock, storageSpaceFor, takeGoods, isStorage } from './storage.js';
import { transact } from './economy.js';

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

/** Open a trade route. @returns {{ok:boolean, reason?:string}} */
export function openRoute(game, id) {
  const route = game.city.trade.routes[id];
  const p = TRADE_PARTNERS[id];
  if (!route || !p) return { ok: false, reason: 'Unknown trade partner.' };
  if (route.open) return { ok: false, reason: 'Route already open.' };
  if (game.city.treasury < p.openCost && !game.cheats.freeBuild) return { ok: false, reason: 'Not enough money.' };
  transact(game, 'other', -p.openCost);
  route.open = true;
  route.nextVisit = game.time.totalDays + 8;
  game.message(`Trade route to ${p.name} is open. Their caravans will arrive soon.`, 'good');
  return { ok: true };
}

/** Change how a good is traded. */
export function setTradeMode(game, good, mode, level) {
  const s = game.city.trade.settings[good];
  if (!s) return;
  if (mode) s.mode = mode;
  if (Number.isFinite(level)) s.level = Math.max(0, Math.min(3200, Math.round(level / 100) * 100));
}

/** Daily: spawn caravans for open routes when due. */
export function updateTrade(game) {
  const { routes } = game.city.trade;
  for (const [id, r] of Object.entries(routes)) {
    if (!r.open || game.time.totalDays < r.nextVisit) continue;
    const [a, b] = CONFIG.CARAVAN_INTERVAL_DAYS;
    r.nextVisit = game.time.totalDays + game.rng.range(a, b);
    spawnCaravan(game, id);
  }
}

function spawnCaravan(game, partnerId) {
  const { map, pf, buildings } = game;
  const entry = map.idx(map.entry.x, map.entry.y);
  if (!map.road[entry]) return;
  const found = pf.findNearest(entry, (id) => {
    const b = buildings.get(id);
    return b && b.def.kind === 'warehouse' && b.efficiency > 0;
  });
  if (!found) {
    if (!game.city.flags.noWarehouseWarned) {
      game.city.flags.noWarehouseWarned = true;
      game.message(`A caravan from ${TRADE_PARTNERS[partnerId].name} found no staffed warehouse connected to the road and turned back.`, 'warn');
    }
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
    const summary = tradeAt(game, w.partner, wh);
    if (summary.earned || summary.spent) {
      const log = game.city.trade.log;
      log.unshift({ date: game.time.shortLabel(), partner: TRADE_PARTNERS[w.partner].name, ...summary });
      if (log.length > 20) log.pop();
    }
  }
  const { map } = game;
  w.state = 'leaving';
  if (!walkTo(game, w, map.idx(map.exit.x, map.exit.y))) killWalker(game, w);
}

/** Exchange goods between a caravan's city and a warehouse. */
export function tradeAt(game, partnerId, wh) {
  const p = TRADE_PARTNERS[partnerId];
  const route = game.city.trade.routes[partnerId];
  const settings = game.city.trade.settings;
  const out = { earned: 0, spent: 0, sold: {}, bought: {} };
  if (!p || !route) return out;
  // Exports: the partner buys from us.
  let budget = CONFIG.CARAVAN_MAX_TRADE;
  for (const [good, cap] of Object.entries(p.buys)) {
    const s = settings[good];
    if (!s || s.mode !== 'export' || budget <= 0) continue;
    const quota = cap - (route.sold[good] || 0);
    const surplus = cityStock(game, good) - s.level;
    let n = Math.min(wh.stock[good] || 0, quota, surplus, budget);
    n = Math.floor(n / 100) * 100;
    if (n <= 0) continue;
    takeGoods(wh, good, n);
    const money = Math.round((GOODS[good].sell * n) / 100);
    transact(game, 'exports', money);
    route.sold[good] = (route.sold[good] || 0) + n;
    budget -= n;
    out.earned += money;
    out.sold[good] = n;
  }
  // Imports: the partner sells to us.
  budget = CONFIG.CARAVAN_MAX_TRADE;
  for (const [good, cap] of Object.entries(p.sells)) {
    const s = settings[good];
    if (!s || s.mode !== 'import' || budget <= 0) continue;
    const quota = cap - (route.bought[good] || 0);
    const shortfall = s.level - cityStock(game, good);
    const price = GOODS[good].buy;
    const affordable = game.cheats.freeBuild ? 1e9 : Math.floor(Math.max(0, game.city.treasury) / price) * 100;
    // storageSpaceFor ignores efficiency here because the caravan unloads itself
    const space = wh.accept[good] ? Math.max(0, storageCapacityLeft(wh)) : 0;
    let n = Math.min(quota, shortfall, budget, affordable, space);
    n = Math.floor(n / 100) * 100;
    if (n <= 0) continue;
    wh.stock[good] += n;
    const money = Math.round((price * n) / 100);
    transact(game, 'imports', -money);
    route.bought[good] = (route.bought[good] || 0) + n;
    budget -= n;
    out.spent += money;
    out.bought[good] = n;
  }
  route.visits++;
  return out;
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

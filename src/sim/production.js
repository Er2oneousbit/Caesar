/**
 * production.js
 * ----------------------------------------------------------------------------
 * Farms, raw material producers and workshops, plus warehouses shipping raw
 * materials to workshops.
 *
 *   Farm/raw producer: progress grows daily with staffing (and fertility for
 *   farms). At 100 a batch of CART_CAPACITY units is ready and a cart pusher
 *   carries it to a workshop, granary or warehouse (see storage.js).
 *
 *   Workshop: uses one batch of its recipe (usually 100 units of one raw
 *   material; the Fletcher needs timber AND iron) to make one batch of goods.
 *   Workshops receive raw material from producers directly, or from
 *   warehouses that notice a workshop running low.
 *
 *   Horse Ranch: a farm whose output also scales with its breeding herd
 *   (2 mares at first, up to 8 as the ranch matures).
 *
 *   Winter (December to Februarius) multiplies farm growth by the
 *   difficulty's `winterGrowth`: 0 on Insane, so every farm (crops, pigs,
 *   the ranch's foals and herd) keeps its progress but adds none until
 *   Martius. Workers stay on (and are paid) and carts still haul the harvest
 *   already in store. farmSeasonNotice() tells the player.
 *
 *   Warehouses also forward weapons, arrows and horses to barracks when the
 *   forts need recruits.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { MONTH_NAMES, seasonOf } from './time.js';
import { RAW_TYPES, FOOD_TYPES } from '../data/goods.js';
import { BUILDINGS } from '../data/buildings.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';
import { HERD_MAX, HERD_GROWTH_DAYS } from '../data/units.js';
import { Terrain } from '../world/map.js';
import { spawnWalker } from './entities.js';
import { followPath } from './movement.js';
import { findDeliveryTarget, takeGoods } from './storage.js';
import { militaryNeed, barracksHasRoom } from './military.js';

/** Number of cart pushers this building has out. */
export function cartsOut(game, b) {
  let n = 0;
  for (const id of b.walkers) {
    const w = game.walkers.get(id);
    if (w && w.type === 'cart') n++;
  }
  return n;
}

/**
 * Send a cart with `amount` of `good` from building `b` to the best target.
 * Stock is removed only if a target exists.
 * @returns {boolean}
 */
export function dispatchCart(game, b, good, amount) {
  if (b.accessRoad < 0) return false;
  const t = findDeliveryTarget(game, b.accessRoad, good, amount, b.id);
  if (!t) {
    b.noStorage = true;
    return false;
  }
  b.noStorage = false;
  const target = game.buildings.get(t.id);
  if (target.incoming && target.incoming[good] !== undefined) target.incoming[good] += amount;
  b.stock[good] -= amount;
  const w = spawnWalker(game, 'cart', b.accessRoad, b, {
    cargo: { good, amount },
    target: t.id,
    reserve: { id: t.id, good, amount },
    state: 'deliver',
    speed: CONFIG.CART_SPEED,
  });
  if (!w) {
    // Walker cap reached: undo the reservation and keep the goods.
    if (target.incoming && target.incoming[good] !== undefined) target.incoming[good] -= amount;
    b.stock[good] += amount;
    return false;
  }
  followPath(game, w, t.path);
  return true;
}

/** Does a raw producer still have its natural resource nearby? */
export function resourceAvailable(game, b) {
  const p = b.def.placement;
  const { map } = game;
  if (p === 'nearTrees') return map.isNearTerrain(b.x, b.y, b.size, Terrain.TREES, 2);
  if (p === 'nearRock') return map.isNearTerrain(b.x, b.y, b.size, Terrain.ROCK, 1);
  if (p === 'nearWater') return map.isNearTerrain(b.x, b.y, b.size, Terrain.WATER, 2);
  return true;
}

/** Farm growth multiplier for this month: the difficulty's winterGrowth in winter, else 1. */
export function farmSeasonRate(game) {
  return seasonOf(game.time.month) === 'winter' ? (game.difficulty.winterGrowth ?? 1) : 1;
}

/** Is this farm resting for the winter (Insane)? For the info panel and the art. */
export function farmDormant(game, b) {
  return b.def.kind === 'farm' && farmSeasonRate(game) <= 0;
}

/** Daily update for farms and raw material producers. */
export function updateProducer(game, b) {
  const def = b.def;
  const good = def.produces;
  const ok = def.kind === 'farm' ? b.fertility > 0 : resourceAvailable(game, b);
  b.resourceOk = ok;
  const season = def.kind === 'farm' ? farmSeasonRate(game) : 1;
  if (b.herd !== undefined) growHerd(b, season);
  if (ok && b.efficiency > 0 && b.stock[good] < CONFIG.PRODUCER_MAX_STOCK) {
    // season 0 (an Insane winter): no growth, but a field Ceres ripened still harvests.
    let rate = (b.efficiency * 100 * season) / def.productionDays;
    if (def.kind === 'farm') rate *= 0.25 + 0.75 * b.fertility;
    if (b.herd !== undefined) rate *= b.herd / HERD_MAX; // young ranches foal slowly
    b.progress += rate * game.difficulty.production;
    if (b.progress >= 100) {
      b.progress -= 100;
      b.stock[good] += CONFIG.CART_CAPACITY;
      game.city.produced[good] = (game.city.produced[good] || 0) + CONFIG.CART_CAPACITY;
      if (FOOD_TYPES.includes(good)) game.city.foodFlow.harvested += CONFIG.CART_CAPACITY;
    }
  }
  shipOutput(game, b, good, def.kind === 'farm' ? CONFIG.FARM_CART_LOAD : CONFIG.CART_LOAD);
}

/** Horse Ranch: a staffed ranch gains a breeding mare every HERD_GROWTH_DAYS (of growing season). */
function growHerd(b, season = 1) {
  if (b.herd >= HERD_MAX || b.efficiency <= 0 || b.fertility <= 0 || season <= 0) return;
  b.herdDays = (b.herdDays || 0) + b.efficiency * season;
  if (b.herdDays >= HERD_GROWTH_DAYS) {
    b.herdDays -= HERD_GROWTH_DAYS;
    b.herd++;
  }
}

/**
 * Tell the player when the farms stop and start again, on levels where
 * nothing grows in winter (Insane). Called at every new month, and with
 * `starting` once when a new game begins (games start in Ianuarius).
 */
export function farmSeasonNotice(game, starting = false) {
  if ((game.difficulty.winterGrowth ?? 1) > 0) return;
  const m = game.time.month;
  const spring = MONTH_NAMES[2];
  if (starting) {
    if (seasonOf(m) === 'winter') game.message(`It is winter: nothing grows on the farms until ${spring}. Farms built now start growing in spring.`, 'warn');
  } else if (m === 9) {
    // Only suggest imports where some trade partner of this map sells food.
    const canImport = (game.scenario?.partners || []).some((p) => Object.keys(TRADE_PARTNERS[p]?.sells || {}).some((g) => FOOD_TYPES.includes(g)));
    game.message(`Winter comes in ${MONTH_NAMES[11]}: then nothing grows on the farms until ${spring}. Fill the granaries now${canImport ? ', or plan to import food' : ''}.`, 'warn');
  } else if (m === 11) {
    game.message(`Winter: the fields rest until ${spring}. The city lives on what its granaries hold.`, 'warn');
  } else if (m === 2) {
    game.message('Spring: the farms grow again.', 'good');
  }
}

/**
 * Send finished goods off in full batches: one cart per full load, at most
 * two carts on the road at once.
 */
function shipOutput(game, b, good, maxLoad) {
  const out = cartsOut(game, b);
  if (out >= 2 || b.stock[good] < CONFIG.CART_CAPACITY) return;
  if (out === 1 && b.stock[good] < maxLoad / 2) return; // a second cart only for a big backlog
  const amount = Math.min(maxLoad, Math.floor(b.stock[good] / CONFIG.CART_CAPACITY) * CONFIG.CART_CAPACITY);
  dispatchCart(game, b, good, amount);
}

/** Daily update for workshops. */
export function updateWorkshop(game, b) {
  const def = b.def;
  const recipe = Object.entries(def.recipe);
  const out = def.produces;
  const hasInputs = recipe.every(([good, n]) => b.stock[good] >= n);
  const working = b.efficiency > 0 && hasInputs && b.stock[out] < CONFIG.CART_CAPACITY * 2;
  if (working) {
    b.progress += ((b.efficiency * 100) / def.productionDays) * game.difficulty.production;
    if (b.progress >= 100) {
      b.progress = 0;
      for (const [good, n] of recipe) b.stock[good] -= n;
      b.stock[out] += CONFIG.CART_CAPACITY;
      game.city.produced[out] = (game.city.produced[out] || 0) + CONFIG.CART_CAPACITY;
    }
  }
  shipOutput(game, b, out, CONFIG.CART_LOAD);
}

/**
 * Daily: a warehouse sends one cart per day where it is needed most:
 *   1. weapons / arrows / horses to a barracks equipping recruits
 *   2. raw materials to the nearest workshop running low on them
 */
export function updateWarehouseSupply(game, b) {
  if (b.efficiency <= 0 || b.accessRoad < 0) return;
  if (cartsOut(game, b) >= 1) return;
  const { buildings, pf } = game;
  const lot = CONFIG.CART_CAPACITY;
  for (const good of BUILDINGS.barracks.inputs) {
    if ((b.stock[good] || 0) < lot || militaryNeed(game, good) <= 0) continue;
    const found = pf.findNearest(b.accessRoad, (id) => {
      const x = buildings.get(id);
      return !!x && barracksHasRoom(x, good, lot);
    }, 100, b.id);
    if (found && sendSupplyCart(game, b, buildings.get(found.id), good, found.path)) return;
  }
  for (const raw of RAW_TYPES) {
    if ((b.stock[raw] || 0) < lot) continue;
    const found = pf.findNearest(b.accessRoad, (id) => {
      const ws = buildings.get(id);
      return ws && ws.def.kind === 'workshop' && ws.def.recipe[raw] !== undefined
        && ws.stock[raw] + ws.incoming[raw] + lot <= CONFIG.WORKSHOP_RAW_CAP;
    }, 100, b.id);
    if (found && sendSupplyCart(game, b, buildings.get(found.id), raw, found.path)) return;
  }
}

/** Load one cart (CART_CAPACITY units) from a warehouse and send it to `dest`. */
function sendSupplyCart(game, b, dest, good, path) {
  const amount = takeGoods(b, good, CONFIG.CART_CAPACITY);
  if (amount <= 0) return false;
  dest.incoming[good] += amount;
  const w = spawnWalker(game, 'cart', b.accessRoad, b, {
    cargo: { good, amount },
    target: dest.id,
    reserve: { id: dest.id, good, amount },
    state: 'deliver',
    speed: CONFIG.CART_SPEED,
  });
  if (!w) {
    // Walker cap reached: undo the reservation and keep the goods.
    dest.incoming[good] -= amount;
    b.stock[good] += amount;
    return false;
  }
  followPath(game, w, path);
  return true;
}

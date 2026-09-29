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
 *   Workshop: consumes one batch of raw material to make one batch of goods.
 *   Workshops receive raw material from producers directly, or from
 *   warehouses that notice a workshop running low.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { RAW_TYPES, FOOD_TYPES } from '../data/goods.js';
import { Terrain } from '../world/map.js';
import { spawnWalker } from './entities.js';
import { followPath } from './movement.js';
import { findDeliveryTarget, takeGoods } from './storage.js';

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

/** Daily update for farms and raw material producers. */
export function updateProducer(game, b) {
  const def = b.def;
  const good = def.produces;
  const ok = def.kind === 'farm' ? b.fertility > 0 : resourceAvailable(game, b);
  b.resourceOk = ok;
  if (ok && b.efficiency > 0 && b.stock[good] < CONFIG.PRODUCER_MAX_STOCK) {
    let rate = (b.efficiency * 100) / def.productionDays;
    if (def.kind === 'farm') rate *= 0.25 + 0.75 * b.fertility;
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
  const raw = def.consumes;
  const out = def.produces;
  const working = b.efficiency > 0 && b.stock[raw] >= CONFIG.CART_CAPACITY && b.stock[out] < CONFIG.CART_CAPACITY * 2;
  if (working) {
    b.progress += ((b.efficiency * 100) / def.productionDays) * game.difficulty.production;
    if (b.progress >= 100) {
      b.progress = 0;
      b.stock[raw] -= CONFIG.CART_CAPACITY;
      b.stock[out] += CONFIG.CART_CAPACITY;
      game.city.produced[out] = (game.city.produced[out] || 0) + CONFIG.CART_CAPACITY;
    }
  }
  shipOutput(game, b, out, CONFIG.CART_LOAD);
}

/**
 * Daily: a warehouse holding raw materials sends a cart to the nearest
 * workshop that is running low on that material.
 */
export function updateWarehouseSupply(game, b) {
  if (b.efficiency <= 0 || b.accessRoad < 0) return;
  if (cartsOut(game, b) >= 1) return;
  const { buildings, pf } = game;
  for (const raw of RAW_TYPES) {
    if ((b.stock[raw] || 0) < CONFIG.CART_CAPACITY) continue;
    const found = pf.findNearest(b.accessRoad, (id) => {
      const ws = buildings.get(id);
      return ws && ws.def.kind === 'workshop' && ws.def.consumes === raw
        && ws.stock[raw] + ws.incoming[raw] + CONFIG.CART_CAPACITY <= CONFIG.WORKSHOP_RAW_CAP;
    }, 100, b.id);
    if (!found) continue;
    const ws = buildings.get(found.id);
    const amount = takeGoods(b, raw, CONFIG.CART_CAPACITY);
    ws.incoming[raw] += amount;
    const w = spawnWalker(game, 'cart', b.accessRoad, b, {
      cargo: { good: raw, amount },
      target: ws.id,
      reserve: { id: ws.id, good: raw, amount },
      state: 'deliver',
      speed: CONFIG.CART_SPEED,
    });
    if (!w) {
      ws.incoming[raw] -= amount;
      b.stock[raw] += amount;
      return;
    }
    followPath(game, w, found.path);
    return;
  }
}

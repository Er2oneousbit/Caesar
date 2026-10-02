/**
 * storageOrders.js
 * ----------------------------------------------------------------------------
 * The player's orders for granaries and warehouses, and the carts they send.
 *
 * Per good (per food in a granary) a building is set to:
 *   accept  take deliveries (the default; warehouses refuse food by default)
 *   refuse  take no deliveries of it
 *   get     take deliveries AND fetch it from other storage
 * plus one Empty switch: take nothing in, and send everything out.
 *
 * Refuse and Empty only stop deliveries in (sim/storage.js storageAccepts).
 * Whoever takes goods out ignores them: market buyers, ships buying exports,
 * the Emperor, and other storage's Get carts. (Caravans unload as well as
 * buy, so they pass an emptying warehouse by: sim/trade.js spawnCaravan.)
 *
 * Each storage building sends one cart at a time, decided on its daily tick
 * when it is at least half staffed (ORDER_MIN_STAFF):
 *   1. Empty on: one load (CONFIG.CART_LOAD) of the first good, in the goods
 *      order, that has somewhere to go (a barracks, workshop, granary or
 *      another warehouse, as for any cart: findDeliveryTarget). A good with
 *      nowhere to go is skipped, not waited on. Get is suspended meanwhile.
 *   2. Get (warehouse): for the first good on Get that this warehouse holds
 *      WAREHOUSE_GET_BELOW or less of, with WAREHOUSE_GET_ROOM free, while
 *      the other warehouses on its roads hold more than WAREHOUSE_GET_SPARE
 *      between them: fetch up to WAREHOUSE_GET_LOAD from the warehouse with
 *      the best road distance minus GET_STOCK_BONUS tiles per 100 units it
 *      holds. So Get keeps 5 to 8 loads, it does not fill the warehouse.
 *   2. Get (granary): while it has room for a load, fetch up to
 *      GRANARY_GET_LOAD of one food on Get from the granary on its roads
 *      with the best road distance (doubled for a source with
 *      GRANARY_SMALL_SOURCE or less to give), taking the food that granary
 *      holds most of, and never the last GRANARY_GET_FLOOR of a food on its
 *      roads.
 *   3. Warehouses then run their routine supply carts (sim/production.js:
 *      weapons to barracks, raw materials to workshops).
 * A Get cart never takes from storage that is itself set to Get that good,
 * so two Get buildings never pass a good back and forth. It walks the roads
 * to its source empty, and the room for its load is held at home
 * (`incoming`) from the moment it sets off, so nothing is lost on return.
 *
 * Measured against the original (research spec, not in the repo): the same
 * thresholds in loads of 100, but true road distance and the same road
 * network for both kinds, and none of its slips (lost loads, Get while
 * emptying, one stuck good blocking the rest).
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { WAREHOUSE_GOODS, FOOD_TYPES } from '../data/goods.js';
import { spawnWalker, releaseReservation } from './entities.js';
import { followPath, goHome } from './movement.js';
import { isStorage, storageRoom, storageByRoad, findDeliveryTarget, takeGoods } from './storage.js';
import { cartsOut, updateWarehouseSupply } from './production.js';

export const ORDER_STATES = Object.freeze(['accept', 'refuse', 'get']);
/** Share of its workers a storage building needs to send its cart on orders. */
export const ORDER_MIN_STAFF = 0.5;
/** A warehouse fetches a good on Get while it holds this much or less... */
export const WAREHOUSE_GET_BELOW = 400;
/** ...and has at least this much room... */
export const WAREHOUSE_GET_ROOM = 800;
/** ...and the other warehouses on its roads hold more than this between them. */
export const WAREHOUSE_GET_SPARE = 400;
/** Units a warehouse's Get cart brings per trip (at most). */
export const WAREHOUSE_GET_LOAD = 400;
/** A warehouse prefers fuller sources: this many tiles of road count as 100 units held. */
export const GET_STOCK_BONUS = 4;
/** Units a granary's Get cart brings per trip (at most). */
export const GRANARY_GET_LOAD = 800;
/** A granary's Get never takes a food below this, counted over the granaries on its roads. */
export const GRANARY_GET_FLOOR = 100;
/** A granary with this much or less to give counts as twice as far away. */
export const GRANARY_SMALL_SOURCE = 400;

/** The goods a storage building has orders for, in the order its cart looks at them. */
export function orderGoods(b) {
  return b.def.kind === 'granary' ? FOOD_TYPES : WAREHOUSE_GOODS;
}

/**
 * The goods Empty sends out, in order: those it has orders for, then any it
 * holds without orders (horses an older save left in a warehouse: they go
 * to a barracks or a ranch).
 */
function emptyGoods(b) {
  const goods = orderGoods(b);
  const extra = Object.keys(b.stock).filter((g) => b.stock[g] > 0 && !goods.includes(g));
  return extra.length ? [...goods, ...extra] : goods;
}

/** Set one good's order. */
export function setOrder(b, good, state) {
  if (!isStorage(b) || !b.orders || !(good in b.orders) || !ORDER_STATES.includes(state)) return;
  b.orders[good] = state;
}

/** Click on a good's order: Accept, Refuse, Get, back to Accept. @returns the new state */
export function cycleOrder(b, good) {
  if (!isStorage(b) || !b.orders || !(good in b.orders)) return null;
  const k = ORDER_STATES.indexOf(b.orders[good]);
  setOrder(b, good, ORDER_STATES[(k + 1) % ORDER_STATES.length]);
  return b.orders[good];
}

/** Turn the Empty switch on or off. */
export function setEmptying(b, on) {
  if (!isStorage(b)) return;
  b.emptying = !!on;
  b.orderNote = null;
}

/** Goods this building has on Get. */
export function getGoods(b) {
  return b.orders ? orderGoods(b).filter((g) => b.orders[g] === 'get') : [];
}

/**
 * Daily, on the building's tick: a granary or warehouse sends its cart on
 * the player's orders, and a warehouse otherwise runs its routine supply.
 */
export function updateStorage(game, b) {
  if (!runOrders(game, b) && b.def.kind === 'warehouse') updateWarehouseSupply(game, b);
}

/** Empty, then Get. @returns {boolean} true if the building's cart is now busy (or must not go) */
function runOrders(game, b) {
  if (!b.orders || b.accessRoad < 0) return false;
  const wantsGet = !b.emptying && getGoods(b).length > 0;
  if (!b.emptying && !wantsGet) {
    b.orderNote = null;
    return false;
  }
  if (cartsOut(game, b) >= 1) return true; // one cart at a time
  if (b.efficiency < ORDER_MIN_STAFF) {
    b.orderNote = { kind: b.emptying ? 'empty' : 'get', why: 'staff', goods: [] };
    return false;
  }
  if (b.emptying) return emptyStep(game, b);
  return b.def.kind === 'granary' ? granaryGet(game, b) : warehouseGet(game, b);
}

// ---------------------------------------------------------------------------
// Empty
// ---------------------------------------------------------------------------

/** Send one load of the first good that has somewhere to go. */
function emptyStep(game, b) {
  const stuck = [];
  for (const good of emptyGoods(b)) {
    const have = b.stock[good] || 0;
    if (have < 1) continue;
    const amount = Math.min(CONFIG.CART_LOAD, have);
    const t = findDeliveryTarget(game, b.accessRoad, good, amount, b.id);
    if (!t) { stuck.push(good); continue; }
    if (!sendDeliveryCart(game, b, game.buildings.get(t.id), good, amount, t.path)) return false; // walker cap
    b.orderNote = { kind: 'empty', why: 'out', goods: [good], stuck };
    return true;
  }
  b.orderNote = { kind: 'empty', why: stuck.length ? 'nowhere' : 'done', goods: stuck };
  // Nothing went: a warehouse may still send a smaller lot to a workshop or barracks.
  return false;
}

/** A cart from storage carrying `amount` of `good` to `dest` (room reserved there). */
function sendDeliveryCart(game, b, dest, good, amount, path) {
  if (dest.incoming && dest.incoming[good] !== undefined) dest.incoming[good] += amount;
  b.stock[good] -= amount;
  const w = spawnWalker(game, 'cart', b.accessRoad, b, {
    cargo: { good, amount },
    target: dest.id,
    reserve: { id: dest.id, good, amount },
    state: 'deliver',
    speed: CONFIG.CART_SPEED,
  });
  if (!w) {
    // Walker cap reached: undo the reservation and keep the goods.
    if (dest.incoming && dest.incoming[good] !== undefined) dest.incoming[good] -= amount;
    b.stock[good] += amount;
    return false;
  }
  followPath(game, w, path);
  return true;
}

// ---------------------------------------------------------------------------
// Get
// ---------------------------------------------------------------------------

/** Warehouse Get: top up one good from the best other warehouse. */
function warehouseGet(game, b) {
  const room = storageRoom(b);
  let fail = null;
  let sources = null;
  for (const good of getGoods(b)) {
    if ((b.stock[good] || 0) > WAREHOUSE_GET_BELOW) continue; // stocked: Get keeps 5 to 8 loads
    if (room < WAREHOUSE_GET_ROOM) { fail = fail || { why: 'room', goods: [good] }; continue; }
    sources = sources || storageByRoad(game, b.accessRoad, 'warehouse', b.id);
    let spare = 0;
    let best = null;
    let bestScore = Infinity;
    for (const s of sources) {
      const have = s.b.stock[good] || 0;
      // Another warehouse on Get for this good is never a source: no ping-pong.
      if (s.b.orders?.[good] === 'get' || have < CONFIG.CART_CAPACITY) continue;
      spare += have;
      const score = s.dist - GET_STOCK_BONUS * Math.floor(have / CONFIG.CART_CAPACITY);
      if (score < bestScore) { bestScore = score; best = s; }
    }
    if (!best || spare <= WAREHOUSE_GET_SPARE) {
      if (!fail || fail.why !== 'nothing') fail = { why: 'nothing', goods: [] };
      fail.goods.push(good);
      continue;
    }
    const amount = Math.min(WAREHOUSE_GET_LOAD, room);
    if (sendFetchCart(game, b, best, good, amount)) {
      b.orderNote = { kind: 'get', why: 'out', goods: [good] };
      return true;
    }
  }
  b.orderNote = fail ? { kind: 'get', ...fail } : null;
  return false;
}

/** Granary Get: one food from the best other granary on its roads. */
function granaryGet(game, b) {
  const room = storageRoom(b);
  const wanted = getGoods(b);
  if (room < CONFIG.CART_CAPACITY) {
    b.orderNote = { kind: 'get', why: 'full', goods: wanted };
    return false;
  }
  const sources = storageByRoad(game, b.accessRoad, 'granary', b.id);
  // How much of each food the granaries on its roads have to give (those
  // not on Get for it); a food is fetched only while that is above the floor.
  const total = {};
  for (const f of wanted) total[f] = 0;
  for (const s of sources) for (const f of wanted) if (s.b.orders?.[f] !== 'get') total[f] += s.b.stock[f] || 0;
  const foods = wanted.filter((f) => total[f] > GRANARY_GET_FLOOR);
  if (!foods.length) {
    b.orderNote = { kind: 'get', why: 'nothing', goods: wanted };
    return false;
  }
  let best = null;
  let bestScore = Infinity;
  let bestFood = null;
  for (const s of sources) {
    let gettable = 0;
    let most = null;
    for (const f of foods) {
      const have = s.b.orders?.[f] === 'get' ? 0 : (s.b.stock[f] || 0);
      gettable += have;
      if (have > 0 && (!most || have > (s.b.stock[most] || 0))) most = f;
    }
    if (gettable <= 0) continue;
    const score = s.dist * (gettable <= GRANARY_SMALL_SOURCE ? 2 : 1);
    if (score < bestScore) { bestScore = score; best = s; bestFood = most; }
  }
  if (!best) {
    b.orderNote = { kind: 'get', why: 'nothing', goods: wanted };
    return false;
  }
  const amount = Math.min(GRANARY_GET_LOAD, room, best.b.stock[bestFood], total[bestFood] - GRANARY_GET_FLOOR);
  if (amount > 0 && sendFetchCart(game, b, best, bestFood, amount)) {
    b.orderNote = { kind: 'get', why: 'out', goods: [bestFood] };
    return true;
  }
  b.orderNote = null; // no cart went today (the city is at its walker limit): no stale words
  return false;
}

/**
 * Send this building's cart, empty, to fetch `amount` of `good` from
 * `src` ({b, goal} from storageByRoad). The room is held at home now.
 */
function sendFetchCart(game, b, src, good, amount) {
  const path = game.pf.roadPath(b.accessRoad, src.goal);
  if (!path) return false;
  b.incoming[good] += amount;
  const w = spawnWalker(game, 'cart', b.accessRoad, b, {
    target: src.b.id,
    want: good,
    state: 'collect',
    reserve: { id: b.id, good, amount },
    speed: CONFIG.CART_SPEED,
  });
  if (!w) {
    b.incoming[good] -= amount; // walker cap reached
    return false;
  }
  followPath(game, w, path);
  return true;
}

/**
 * A Get cart reached its source: load what is there (up to the room held at
 * home) and head back. A source that went over to Get this good meanwhile
 * gives nothing. The hold at home shrinks to what is on board.
 */
export function collectArrive(game, w) {
  const src = game.buildings.get(w.target);
  const home = game.buildings.get(w.origin);
  const good = w.want;
  let got = 0;
  if (w.reserve && src && isStorage(src) && src.orders?.[good] !== 'get') {
    let want = w.reserve.amount;
    // A granary's floor holds on arrival too: markets may have drawn the
    // food down since the cart set off.
    if (home && home.def.kind === 'granary') want = Math.min(want, granaryFoodToSpare(game, w, good));
    got = want > 0 ? takeGoods(src, good, want) : 0;
  }
  if (got > 0) {
    // (A good its home holds no room for, such as horses on a cart from an older save, has nothing to shrink.)
    if (home && home.incoming && home.incoming[good] !== undefined) home.incoming[good] = Math.max(0, home.incoming[good] - (w.reserve.amount - got));
    w.reserve.amount = got;
    w.cargo = { good, amount: got };
  } else {
    releaseReservation(game, w);
  }
  // No way home (the road was cut while it was out): the load stays where it was.
  if (!goHome(game, w) && got > 0 && src) src.stock[good] += got;
}

/**
 * How much of a food the granaries on the cart's roads (not its own, not
 * those on Get for it) can give before only GRANARY_GET_FLOOR is left.
 */
function granaryFoodToSpare(game, w, food) {
  const here = game.map.idx(w.x, w.y);
  if (!game.map.road[here]) return 0;
  let total = 0;
  for (const s of storageByRoad(game, here, 'granary', w.origin)) {
    if (s.b.orders?.[food] !== 'get') total += s.b.stock[food] || 0;
  }
  return Math.max(0, total - GRANARY_GET_FLOOR);
}

/** The Get or Empty cart this building has out, if any (for the info panel). */
export function orderCart(game, b) {
  for (const id of b.walkers) {
    const w = game.walkers.get(id);
    if (w && w.type === 'cart') return w;
  }
  return null;
}

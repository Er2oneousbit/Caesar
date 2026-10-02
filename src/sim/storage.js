/**
 * storage.js
 * ----------------------------------------------------------------------------
 * Granaries and warehouses: capacity math, adding/taking goods, and finding
 * where a cart should deliver its load.
 *
 * Delivery priority for a cart carrying good G:
 *   1. a barracks that needs G to equip recruits (weapons, arrows, horses),
 *      or a navalia that needs G for the fleet's next ship (timber, iron, linen)
 *   2. a workshop whose recipe uses G and has room (raw materials go straight in),
 *      or a shipyard (timber for its boats: rawRoomCap), nearest first
 *   3. a granary that accepts G (food only)
 *   4. a warehouse that accepts G
 * "Room" includes loads already on their way (reservations in b.incoming),
 * so two carts never race to fill the same last slot.
 *
 * Storage orders (the player's, per building; sim/storageOrders.js runs the
 * carts they send): each good is 'accept', 'refuse' or 'get', and the
 * building has an Empty switch. Refuse and Empty only stop deliveries IN
 * (producer, dock and storage carts, caravan imports). Nobody taking goods
 * OUT looks at them: market buyers, exports, the Emperor and other storage's
 * Get carts. Get counts as accepting.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { GOODS } from '../data/goods.js';
import { BUILDINGS } from '../data/buildings.js';
import { militaryNeed, barracksHasRoom } from './military.js';
import { navalNeed, navaliaHasRoom } from './navy.js';

/** Goods a barracks takes by cart (weapons, arrows, horses). */
const BARRACKS_INPUTS = BUILDINGS.barracks.inputs;
/** Goods a navalia takes by cart (timber, iron, linen: sim/navy.js). */
const NAVALIA_INPUTS = BUILDINGS.navalia.inputs;

/**
 * How much of a raw material a building takes like a workshop's raw
 * material (0: none): a workshop whose recipe uses it holds WORKSHOP_RAW_CAP,
 * a shipyard its timber up to its inputCap (sim/fishing.js). The two share
 * one delivery tier, nearest first, so a yard and a carpenter compete for
 * wood on equal terms and neither waits behind the other.
 */
export function rawRoomCap(b, good) {
  if (!b || !b.stock || b.stock[good] === undefined) return 0;
  if (b.def.kind === 'workshop') return b.def.recipe[good] !== undefined ? CONFIG.WORKSHOP_RAW_CAP : 0;
  if (b.def.kind === 'shipyard') return b.def.inputs.includes(good) ? b.def.inputCap : 0;
  return 0;
}

/** Can a workshop or shipyard take `amount` more of a raw material (loads on their way counted)? */
export function rawHasRoom(b, good, amount) {
  const cap = rawRoomCap(b, good);
  return cap > 0 && b.stock[good] + (b.incoming?.[good] || 0) + amount <= cap;
}

export function isStorage(b) {
  const k = b.def.kind;
  return k === 'granary' || k === 'warehouse';
}

export function storageCapacity(b) {
  return b.def.kind === 'granary' ? CONFIG.GRANARY_CAPACITY : CONFIG.WAREHOUSE_CAPACITY;
}

function sumValues(obj) {
  let s = 0;
  for (const k in obj) s += obj[k];
  return s;
}

/** Units currently stored. */
export function storageUsed(b) { return sumValues(b.stock); }

/** Units reserved by carts on their way here (deliveries and the building's own Get cart). */
export function storageIncoming(b) { return sumValues(b.incoming); }

/** Free room in a storage building, counting loads already on their way. */
export function storageRoom(b) {
  return Math.max(0, storageCapacity(b) - storageUsed(b) - storageIncoming(b));
}

/**
 * Does this storage building take deliveries of a good? Only its orders
 * decide (Refuse or Empty say no; Accept and Get say yes), not its room or
 * staff. Goods it has no place for (wine in a granary) are never accepted.
 */
export function storageAccepts(b, good) {
  if (!isStorage(b) || !b.orders || b.stock[good] === undefined) return false;
  return !b.emptying && b.orders[good] !== 'refuse';
}

/** Free space for a good, counting loads already on their way. */
export function storageSpaceFor(b, good) {
  if (!storageAccepts(b, good)) return 0;
  if (b.efficiency <= 0) return 0; // unstaffed storage cannot receive
  return storageRoom(b);
}

/**
 * Put goods into a building (storage, workshop or market).
 * `home`: the building's own cart is bringing back what it carried (a Get
 * cart's load, or a delivery nobody would take). Its orders do not turn it
 * away: Refuse and Empty stop other people's deliveries, not its own goods.
 * @returns {number} how many units were accepted
 */
export function receiveGoods(b, good, amount, home = false) {
  const kind = b.def.kind;
  if (kind === 'granary' || kind === 'warehouse') {
    if (b.stock[good] === undefined || (!home && !storageAccepts(b, good))) return 0;
    const room = Math.max(0, storageCapacity(b) - storageUsed(b));
    const n = Math.min(room, amount);
    b.stock[good] += n;
    return n;
  }
  if (rawRoomCap(b, good) > 0) {
    const room = Math.max(0, rawRoomCap(b, good) - b.stock[good]);
    const n = Math.min(room, amount);
    b.stock[good] += n;
    return n;
  }
  if (kind === 'dock' && b.stock[good] !== undefined) {
    b.stock[good] += amount; // a dock cart came back with undeliverable cargo
    return amount;
  }
  if ((kind === 'barracks' || kind === 'navalia') && b.stock[good] !== undefined) {
    const room = Math.max(0, b.def.inputCap - b.stock[good]);
    const n = Math.min(room, amount);
    b.stock[good] += n;
    return n;
  }
  if (kind === 'market' && b.stock[good] !== undefined) {
    b.stock[good] += amount; // markets never refuse what their own buyer brings
    return amount;
  }
  if ((kind === 'farm' || kind === 'raw' || kind === 'wharf') && b.def.produces === good) {
    b.stock[good] += amount; // returned undeliverable cargo
    return amount;
  }
  return 0;
}

/** Take up to `amount` of a good from a building. Returns units taken. */
export function takeGoods(b, good, amount) {
  if (!b.stock || !b.stock[good]) return 0;
  const n = Math.min(b.stock[good], amount);
  b.stock[good] -= n;
  return n;
}

/** Does this building count as city storage (granaries, warehouses, dock quays)? */
function holdsCityGoods(b) {
  return isStorage(b) || b.def.kind === 'dock';
}

/** Units of a good stored across all granaries/warehouses (and goods waiting on dock quays). */
export function cityStock(game, good) {
  let n = 0;
  for (const b of game.buildings.values()) if (holdsCityGoods(b) && b.stock[good]) n += b.stock[good];
  return n;
}

/**
 * Remove goods from city storage (e.g. an Emperor request). Returns units
 * removed. Storage set to Get that good is drawn on last: the player wants
 * it kept there (as in the original). Refuse and Empty make no difference.
 */
export function takeFromCity(game, good, amount) {
  let left = amount;
  for (const getting of [false, true]) {
    for (const b of game.buildings.values()) {
      if (left <= 0) break;
      if (!holdsCityGoods(b) || !b.stock[good]) continue;
      if ((b.orders?.[good] === 'get') !== getting) continue;
      left -= takeGoods(b, good, left);
    }
  }
  return amount - left;
}

/**
 * Every storage building of `kind` ('warehouse' or 'granary') on the road
 * network of tile `fromIdx`, in order of road distance (nearest first), with
 * that distance and the road tile it was reached from. One search, so a
 * caller can weigh distance against what each one holds.
 * @returns {{b:object, dist:number, goal:number}[]}
 */
export function storageByRoad(game, fromIdx, kind, excludeId = 0) {
  const { map, pf, buildings } = game;
  const { w, h, building } = map;
  const out = [];
  const seen = new Set();
  pf.bfsRoad(fromIdx, (i) => {
    const x = i % w;
    const y = (i / w) | 0;
    for (const n of [y > 0 ? i - w : -1, x < w - 1 ? i + 1 : -1, y < h - 1 ? i + w : -1, x > 0 ? i - 1 : -1]) {
      if (n < 0) continue;
      const id = building[n];
      if (!id || id === excludeId || seen.has(id)) continue;
      seen.add(id);
      const b = buildings.get(id);
      if (b && b.def.kind === kind) out.push({ b, dist: pf.reachedDist(i), goal: i });
    }
    return false; // keep going: we want all of them
  });
  return out;
}

/**
 * Find the best place for a cart to deliver `amount` units of `good`.
 * @returns {{id:number, goal:number, path:number[]}|null}
 */
export function findDeliveryTarget(game, fromIdx, good, amount, excludeId = 0) {
  const { pf, buildings } = game;
  const kind = GOODS[good]?.kind;
  const attempts = [];
  if (BARRACKS_INPUTS.includes(good) && militaryNeed(game, good) > 0) {
    attempts.push((id) => {
      const b = buildings.get(id);
      return b && barracksHasRoom(b, good, amount);
    });
  }
  // The fleet comes before the workshops too, but only while a staffed
  // station has an empty berth (so the Navalia never hoards the city's timber).
  if (NAVALIA_INPUTS.includes(good) && navalNeed(game, good) > 0) {
    attempts.push((id) => {
      const b = buildings.get(id);
      return b && navaliaHasRoom(b, good, amount);
    });
  }
  if (kind === 'raw') {
    attempts.push((id) => {
      const b = buildings.get(id);
      return rawHasRoom(b, good, amount);
    });
  }
  if (kind === 'food') {
    attempts.push((id) => {
      const b = buildings.get(id);
      return b && b.def.kind === 'granary' && storageSpaceFor(b, good) >= amount;
    });
  }
  attempts.push((id) => {
    const b = buildings.get(id);
    return b && b.def.kind === 'warehouse' && storageSpaceFor(b, good) >= amount;
  });
  for (const pred of attempts) {
    const found = pf.findNearest(fromIdx, pred, 120, excludeId);
    if (found) return found;
  }
  return null;
}

/**
 * How much of a good a delivery target found by findDeliveryTarget can still
 * take, counting loads on their way: a barracks or navalia up to its input cap, a
 * workshop up to WORKSHOP_RAW_CAP, a shipyard up to its input cap, storage its
 * free room.
 */
export function deliveryRoom(b, good) {
  const kind = b.def.kind;
  if (kind === 'barracks' || kind === 'navalia') return Math.max(0, b.def.inputCap - (b.stock[good] || 0) - (b.incoming[good] || 0));
  if (kind === 'workshop' || kind === 'shipyard') return Math.max(0, rawRoomCap(b, good) - (b.stock[good] || 0) - (b.incoming[good] || 0));
  return storageSpaceFor(b, good);
}

/**
 * The best place for up to `amount` units of a good when a smaller lot will
 * do (a dock worker's wagon of DOCK_LOAD): the target is chosen for one
 * CART_CAPACITY, so a workshop or barracks with room for less than the whole
 * load still comes first, and the amount is what it can take.
 * @returns {{id:number, goal:number, path:number[], amount:number}|null}
 */
export function findDeliveryFit(game, fromIdx, good, amount, excludeId = 0) {
  const t = findDeliveryTarget(game, fromIdx, good, CONFIG.CART_CAPACITY, excludeId);
  if (!t) return null;
  const room = deliveryRoom(game.buildings.get(t.id), good);
  const n = Math.floor(Math.min(amount, room) / CONFIG.CART_CAPACITY) * CONFIG.CART_CAPACITY;
  return n > 0 ? { ...t, amount: n } : null;
}

/**
 * Find the nearest storage holding at least `min` units of a good.
 * Food prefers granaries; anything else comes from warehouses.
 */
export function findSupplier(game, fromIdx, good, min = 1, maxDist = 80) {
  const { pf, buildings } = game;
  const kind = GOODS[good]?.kind;
  const pred = (id) => {
    const b = buildings.get(id);
    if (!b || !isStorage(b) || b.efficiency <= 0) return false;
    if (kind !== 'food' && b.def.kind === 'granary') return false;
    return (b.stock[good] || 0) >= min;
  };
  return pf.findNearest(fromIdx, pred, maxDist);
}

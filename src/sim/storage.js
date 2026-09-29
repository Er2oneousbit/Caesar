/**
 * storage.js
 * ----------------------------------------------------------------------------
 * Granaries and warehouses: capacity math, adding/taking goods, and finding
 * where a cart should deliver its load.
 *
 * Delivery priority for a cart carrying good G:
 *   1. a barracks that needs G to equip recruits (weapons, arrows, horses)
 *   2. a workshop whose recipe uses G and has room (raw materials go straight in)
 *   3. a granary that accepts G (food only)
 *   4. a warehouse that accepts G
 * "Room" includes loads already on their way (reservations in b.incoming),
 * so two carts never race to fill the same last slot.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { GOODS } from '../data/goods.js';
import { BUILDINGS } from '../data/buildings.js';
import { militaryNeed, barracksHasRoom } from './military.js';

/** Goods a barracks takes by cart (weapons, arrows, horses). */
const BARRACKS_INPUTS = BUILDINGS.barracks.inputs;

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

/** Free space for a good, counting loads already on their way. */
export function storageSpaceFor(b, good) {
  if (!isStorage(b)) return 0;
  if (!b.accept || !b.accept[good]) return 0;
  if (b.stock[good] === undefined) return 0;
  if (b.efficiency <= 0) return 0; // unstaffed storage cannot receive
  return Math.max(0, storageCapacity(b) - storageUsed(b) - sumValues(b.incoming));
}

/**
 * Put goods into a building (storage, workshop or market).
 * @returns {number} how many units were accepted
 */
export function receiveGoods(b, good, amount) {
  const kind = b.def.kind;
  if (kind === 'granary' || kind === 'warehouse') {
    if (!b.accept[good] || b.stock[good] === undefined) return 0;
    const room = Math.max(0, storageCapacity(b) - storageUsed(b));
    const n = Math.min(room, amount);
    b.stock[good] += n;
    return n;
  }
  if (kind === 'workshop' && b.def.recipe[good] !== undefined) {
    const room = Math.max(0, CONFIG.WORKSHOP_RAW_CAP - b.stock[good]);
    const n = Math.min(room, amount);
    b.stock[good] += n;
    return n;
  }
  if (kind === 'dock' && b.stock[good] !== undefined) {
    b.stock[good] += amount; // a dock cart came back with undeliverable cargo
    return amount;
  }
  if (kind === 'barracks' && b.stock[good] !== undefined) {
    const room = Math.max(0, b.def.inputCap - b.stock[good]);
    const n = Math.min(room, amount);
    b.stock[good] += n;
    return n;
  }
  if (kind === 'market' && b.stock[good] !== undefined) {
    b.stock[good] += amount; // markets never refuse what their own buyer brings
    return amount;
  }
  if ((kind === 'farm' || kind === 'raw') && b.def.produces === good) {
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

/** Remove goods from city storage (e.g. an Emperor request). Returns units removed. */
export function takeFromCity(game, good, amount) {
  let left = amount;
  for (const b of game.buildings.values()) {
    if (left <= 0) break;
    if (!holdsCityGoods(b) || !b.stock[good]) continue;
    left -= takeGoods(b, good, left);
  }
  return amount - left;
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
  if (kind === 'raw') {
    attempts.push((id) => {
      const b = buildings.get(id);
      return b && b.def.kind === 'workshop' && b.def.recipe[good] !== undefined && b.stock[good] + b.incoming[good] + amount <= CONFIG.WORKSHOP_RAW_CAP;
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

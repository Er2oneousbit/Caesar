/**
 * entities.js
 * ----------------------------------------------------------------------------
 * Building and Walker records, plus the functions that add/remove them from
 * the world. Everything else in the simulation goes through these helpers so
 * map layers, reservations and walker bookkeeping never get out of sync.
 *
 * Both classes are plain data holders (no methods with side effects) so they
 * serialize straight to JSON for save games.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { BUILDINGS } from '../data/buildings.js';
import { GOD_KEYS } from '../data/gods.js';
import { FOOD_TYPES, HOUSE_GOODS, GOOD_KEYS, emptyStock } from '../data/goods.js';
import { WALKER_TYPES } from '../data/walkers.js';

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

/** Fresh per-house data (residents, pantry, service access timers). */
export function newHouseData(variant = 0) {
  return {
    tier: 0,
    pop: 0,
    incoming: 0, // immigrants walking here right now
    food: emptyStock(FOOD_TYPES),
    goods: emptyStock(HOUSE_GOODS),
    // Service access timers (days remaining). >0 means the house has access.
    religion: Object.fromEntries(GOD_KEYS.map((k) => [k, 0])),
    ent: { theater: 0, amphitheater: 0, colosseum: 0 },
    school: 0,
    library: 0,
    academy: 0,
    barber: 0,
    clinic: 0,
    baths: 0,
    tax: 0,
    evolveDays: 0,
    devolveDays: 0,
    des: 0, // cached desirability
    water: 0, // cached water level 0/1/2
    blocked: null, // why the house cannot evolve (for the info panel)
    variant,
  };
}

export class Building {
  /**
   * @param {number} id
   * @param {string} type key into BUILDINGS
   * @param {number} x top-left (min x) tile
   * @param {number} y top-left (min y) tile
   * @param {number} [size] footprint override (houses grow)
   */
  constructor(id, type, x, y, size) {
    const def = BUILDINGS[type];
    if (!def) throw new Error(`Unknown building type "${type}"`);
    this.id = id;
    this.type = type;
    this.x = x;
    this.y = y;
    this.size = size ?? def.size;
    this.workers = 0;
    this.efficiency = 0; // workers / needed, 0..1
    this.laborAccess = 0; // days of labor access remaining (recruiters refresh it)
    this.fireRisk = 0;
    this.damageRisk = 0;
    this.spawnTimer = 1; // days until the next walker spawn
    this.walkers = []; // ids of walkers that belong to this building and are out
    this.accessRoad = -1; // tile index of the road used to enter/leave, -1 = none
    this.progress = 0; // production / growth progress 0..100
    this.phase = id % CONFIG.TICKS_PER_DAY; // which tick of the day this building updates on
    this.stock = null; // goods held (storage, markets, producers)
    this.incoming = null; // goods reserved by carts on their way here
    this.accept = null; // storage accept flags
    this.house = null;
    this.hasWater = false; // reservoirs, fountains, baths
    this.shows = null; // venues: days of performances booked by type
    this.fertility = 0; // farms: share of meadow tiles (0..1)
    this.variant = id % 4; // art variety
    this.recruiterCooldown = 0;
    this.buyerCooldown = 0;
    initKind(this, def);
  }

  get def() { return BUILDINGS[this.type]; }
}

/** Set up the fields a building needs based on its behavior family. */
function initKind(b, def) {
  switch (def.kind) {
    case 'house':
      b.house = newHouseData(b.id % 4);
      break;
    case 'granary':
      b.stock = emptyStock(FOOD_TYPES);
      b.incoming = emptyStock(FOOD_TYPES);
      b.accept = Object.fromEntries(FOOD_TYPES.map((k) => [k, true]));
      break;
    case 'warehouse':
      b.stock = emptyStock(GOOD_KEYS);
      b.incoming = emptyStock(GOOD_KEYS);
      // Warehouses accept everything except food by default (food goes to granaries).
      b.accept = Object.fromEntries(GOOD_KEYS.map((k) => [k, !FOOD_TYPES.includes(k)]));
      break;
    case 'market':
      b.stock = emptyStock([...FOOD_TYPES, ...HOUSE_GOODS]);
      b.incoming = emptyStock([...FOOD_TYPES, ...HOUSE_GOODS]);
      break;
    case 'farm':
    case 'raw':
      b.stock = { [def.produces]: 0 };
      break;
    case 'workshop':
      b.stock = { [def.consumes]: 0, [def.produces]: 0 };
      b.incoming = { [def.consumes]: 0 };
      break;
    case 'venue':
      b.shows = { theater: 0, amphitheater: 0, colosseum: 0 };
      break;
    default:
      break;
  }
}

/** Iterate the tile indices of a footprint. */
export function footprintTiles(map, x, y, size) {
  const out = [];
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      if (map.inBounds(x + dx, y + dy)) out.push(map.idx(x + dx, y + dy));
    }
  }
  return out;
}

/** Tiles orthogonally adjacent to a footprint (its perimeter ring, no corners). */
export function perimeterTiles(map, x, y, size) {
  const out = [];
  for (let d = 0; d < size; d++) {
    const cand = [
      [x + d, y - 1],
      [x + size, y + d],
      [x + d, y + size],
      [x - 1, y + d],
    ];
    for (const [tx, ty] of cand) if (map.inBounds(tx, ty)) out.push(map.idx(tx, ty));
  }
  return out;
}

/**
 * Find the road tile a building uses. Houses accept a road within 2 tiles;
 * everything else needs a road touching its footprint.
 */
export function computeAccessRoad(game, b) {
  const { map } = game;
  b.accessRoad = -1;
  if (b.house) {
    let best = -1;
    let bestD = 99;
    for (let ty = b.y - 2; ty < b.y + b.size + 2; ty++) {
      for (let tx = b.x - 2; tx < b.x + b.size + 2; tx++) {
        if (!map.inBounds(tx, ty)) continue;
        const i = map.idx(tx, ty);
        if (!map.road[i]) continue;
        const dx = tx < b.x ? b.x - tx : tx >= b.x + b.size ? tx - (b.x + b.size - 1) : 0;
        const dy = ty < b.y ? b.y - ty : ty >= b.y + b.size ? ty - (b.y + b.size - 1) : 0;
        const d = Math.max(dx, dy) + (dx && dy ? 0.5 : 0); // prefer orthogonal roads
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    b.accessRoad = best;
    return best;
  }
  for (const i of perimeterTiles(map, b.x, b.y, b.size)) {
    if (map.road[i]) { b.accessRoad = i; break; }
  }
  return b.accessRoad;
}

/**
 * Register a new building on the map.
 * The caller (construction.js) is responsible for validation and payment.
 */
export function addBuilding(game, type, x, y, size) {
  const id = game.nextBuildingId++;
  const b = new Building(id, type, x, y, size);
  const { map } = game;
  for (const i of footprintTiles(map, x, y, b.size)) {
    map.building[i] = id;
    map.rubble[i] = 0;
  }
  // Farms: fertility is the share of meadow under the field.
  if (b.def.kind === 'farm') {
    b.fertility = map.countTerrain(x, y, b.size, 1 /* MEADOW */) / (b.size * b.size);
  }
  game.buildings.set(id, b);
  computeAccessRoad(game, b);
  b.createdDay = game.time.totalDays;
  game.markDirty('des', 'water');
  map.touch();
  game.events.emit('buildingAdded', b);
  return b;
}

/**
 * Remove a building from the world.
 * @param {'demolish'|'fire'|'collapse'|'merge'|'undo'} reason
 */
export function removeBuilding(game, b, reason = 'demolish') {
  if (!game.buildings.has(b.id)) return;
  const { map } = game;
  for (const i of footprintTiles(map, b.x, b.y, b.size)) {
    if (map.building[i] === b.id) map.building[i] = 0;
  }
  game.buildings.delete(b.id);
  // Walkers that belong to this building vanish with it (their cargo is lost).
  for (const wid of [...b.walkers]) {
    const w = game.walkers.get(wid);
    if (w && w.kind !== 'traveler') killWalker(game, w);
  }
  // Residents of a destroyed home become homeless and look for a new one.
  if (b.house && b.house.pop > 0 && reason !== 'merge') {
    evictResidents(game, b);
  }
  game.markDirty('des', 'water');
  map.touch();
  game.events.emit('buildingRemoved', { building: b, reason });
}

/** Turn a house's residents into homeless walkers. */
function evictResidents(game, b) {
  let people = b.house.pop;
  b.house.pop = 0;
  const start = b.accessRoad >= 0 && game.map.road[b.accessRoad] ? b.accessRoad : -1;
  if (start < 0) {
    game.city.lostCitizens += people;
    return;
  }
  while (people > 0) {
    const n = Math.min(people, CONFIG.IMMIGRANT_GROUP_MAX);
    people -= n;
    // pendingArrive makes the walker run its 'seeking' logic on its first tick.
    const w = spawnWalker(game, 'homeless', start, null, { people: n, state: 'seeking', pendingArrive: true });
    if (!w) { game.city.lostCitizens += n + people; break; }
  }
}

// ---------------------------------------------------------------------------
// Walkers
// ---------------------------------------------------------------------------

export class Walker {
  constructor(id, type, x, y) {
    const def = WALKER_TYPES[type];
    if (!def) throw new Error(`Unknown walker type "${type}"`);
    this.id = id;
    this.type = type;
    this.kind = def.kind;
    this.x = x; // current tile
    this.y = y;
    this.tx = x; // tile being walked toward
    this.ty = y;
    this.progress = 0; // 0..1 between (x,y) and (tx,ty)
    this.moving = false;
    this.speed = CONFIG.WALKER_SPEED;
    this.state = 'idle';
    this.path = null; // array of tile indices
    this.pathIndex = 0;
    this.origin = 0; // building id that spawned the walker
    this.target = 0; // building id the walker is heading to
    this.cargo = null; // { good, amount }
    this.reserve = null; // { id, good, amount } reservation held at the target
    this.people = 0; // immigrants/emigrants group size
    this.roamLeft = 0;
    this.lastDir = -1;
    this.god = null; // priests
    this.venue = null; // entertainers & performers
    this.partner = null; // caravans
    this.waitTicks = 0;
    this.dead = false;
    this.anim = (id * 7919) % 100; // walk cycle offset so crowds do not march in sync
  }
}

/**
 * Create a walker on a road tile.
 * @param {object} game
 * @param {string} type        WALKER_TYPES key
 * @param {number} startIdx    tile index to spawn on
 * @param {Building|null} origin building that owns the walker
 * @param {object} [init]      extra fields to copy onto the walker
 */
export function spawnWalker(game, type, startIdx, origin, init = {}) {
  if (game.walkers.size >= CONFIG.MAX_WALKERS) return null;
  const { map } = game;
  const w = new Walker(game.nextWalkerId++, type, map.xOf(startIdx), map.yOf(startIdx));
  Object.assign(w, init);
  if (origin) {
    w.origin = origin.id;
    origin.walkers.push(w.id);
  }
  game.walkers.set(w.id, w);
  return w;
}

/** Remove a walker and release anything it had reserved. */
export function killWalker(game, w) {
  if (w.dead) return;
  w.dead = true;
  releaseReservation(game, w);
  if (w.origin) {
    const o = game.buildings.get(w.origin);
    if (o) {
      const k = o.walkers.indexOf(w.id);
      if (k >= 0) o.walkers.splice(k, 1);
    }
  }
  game.walkers.delete(w.id);
}

/** Undo whatever the walker reserved at its target (storage space, house beds). */
export function releaseReservation(game, w) {
  if (!w.reserve) return;
  const b = game.buildings.get(w.reserve.id);
  if (b) {
    if (w.reserve.good && b.incoming && b.incoming[w.reserve.good] !== undefined) {
      b.incoming[w.reserve.good] = Math.max(0, b.incoming[w.reserve.good] - w.reserve.amount);
    } else if (w.reserve.people && b.house) {
      b.house.incoming = Math.max(0, b.house.incoming - w.reserve.people);
    } else if (w.reserve.perf && b.pendingPerf) {
      b.pendingPerf[w.reserve.perf] = Math.max(0, (b.pendingPerf[w.reserve.perf] || 0) - 1);
    }
  }
  w.reserve = null;
}

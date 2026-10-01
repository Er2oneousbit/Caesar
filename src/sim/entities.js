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
import { HERD_START } from '../data/units.js';
import { clearRuin } from './ruins.js';

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
    // Days left of a visit from a venue that had both of its kinds of show
    // booked (worth extra entertainment, see VENUE_BOTH_BONUS).
    entBoth: { amphitheater: 0, colosseum: 0 },
    school: 0,
    library: 0,
    academy: 0,
    barber: 0,
    clinic: 0,
    baths: 0,
    tax: 0,
    police: 0, // days of police cover left from a prefect's visit (halves the crime chance)
    // Home mood, for crime only (sim/mood.js): null while nobody lives here.
    mood: null,
    moodReason: null, // what upsets it most (a key of MOOD_REASONS), or null
    hungerStreak: 0, // mood updates in a row with no food at all
    criminal: 0, // 0, or 1 once it sent out a protester, 2 a thief (cleared at mood 50+)
    // Disease (sim/disease.js): risk builds like fire risk; a physician resets it.
    diseaseRisk: 0,
    sick: 0, // days left sick (0 = well): no moving up, no newcomers, it can spread next door
    devolveDays: 0, // consecutive bad days (the home falls a level after game.difficulty.devolveDays)
    merged: false, // true = a 2x2 block of four single-tile homes (levels 1-10)
    bornDay: -1, // day a split or break-up created this home: first checked the day after
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
    this.noRoadDays = 0; // days in a row without a road it can use (sim/roadAccess.js)
    this.noRoadWarned = false; // the "no road touching it" message was shown (once per building)
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
      if (def.produces === 'horses') {
        b.herd = HERD_START; // breeding mares (see data/units.js)
        b.herdDays = 0;
      }
      break;
    case 'workshop': {
      const inputs = Object.keys(def.recipe);
      b.stock = { ...emptyStock(inputs), [def.produces]: 0 };
      b.incoming = emptyStock(inputs);
      break;
    }
    case 'barracks':
      b.stock = emptyStock(def.inputs); // weapons, arrows, horses waiting for recruits
      b.incoming = emptyStock(def.inputs);
      b.trainProgress = 0;
      break;
    case 'fort':
      b.recruiting = 0; // recruits walking here right now
      b.rally = null; // deploy point {x, y} or null = stand at the fort
      break;
    case 'tower':
      b.shotTimer = 0;
      break;
    case 'dock':
      b.stock = emptyStock(GOOD_KEYS); // imports unloaded from ships, waiting for carts
      b.shipId = 0; // walker id of the ship tied up here (or on its way)
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
 * everything else needs a road touching its footprint. A road on the network
 * that reaches the map entry (the city's own, where settlers, workers and
 * carts come from) always wins over one that does not: a stub of road laid
 * against a building must not cut it off from its workers. Only when no such
 * road is in reach is another road used.
 */
export function computeAccessRoad(game, b) {
  const { map } = game;
  b.accessRoad = -1;
  const main = map.roadNet[map.idx(map.entry.x, map.entry.y)]; // 0 until networks are computed
  const off = (i) => (main && map.roadNet[i] !== main ? 10 : 0); // any main-network road in reach is nearer
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
        const d = Math.max(dx, dy) + (dx && dy ? 0.5 : 0) + off(i); // prefer orthogonal roads
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    b.accessRoad = best;
    return best;
  }
  for (const i of perimeterTiles(map, b.x, b.y, b.size)) {
    if (!map.road[i]) continue;
    if (!off(i)) { b.accessRoad = i; break; } // on the city's network: done
    if (b.accessRoad < 0) b.accessRoad = i; // else remember the first road, as a fallback
  }
  return b.accessRoad;
}

/**
 * Register a new building on the map.
 * The caller (construction.js) is responsible for validation and payment.
 * `quiet`: no 'buildingAdded' event, so the renderer does not raise it out of
 * the ground (homes split off a bigger home were there all along).
 */
export function addBuilding(game, type, x, y, size, { quiet = false } = {}) {
  const id = game.nextBuildingId++;
  const b = new Building(id, type, x, y, size);
  const { map } = game;
  for (const i of footprintTiles(map, x, y, b.size)) {
    map.building[i] = id;
    map.rubble[i] = 0;
    clearRuin(game, i);
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
  if (!quiet) game.events.emit('buildingAdded', b);
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
  const people = b.house.pop;
  b.house.pop = 0;
  sendHomeless(game, b, people);
}

/**
 * `people` who no longer have room (already taken off the house's count)
 * leave it as homeless walkers and look for another home, or leave the city
 * if there is none.
 */
export function sendHomeless(game, b, people) {
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

/**
 * Walkers and soldiers count the tiles they have walked, modulo this, to drive
 * the leg animation (the art steps a whole number of times per STRIDE_WRAP
 * tiles, so the wrap never shows).
 */
export const STRIDE_WRAP = 100;

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
    this.walked = 0; // tiles walked, modulo STRIDE_WRAP: legs step with distance, not the clock
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
    } else if (w.reserve.recruit) {
      b.recruiting = Math.max(0, (b.recruiting || 0) - 1); // fort's place held for a recruit
    }
  }
  w.reserve = null;
}

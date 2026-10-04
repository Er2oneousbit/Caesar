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
import { BUILDINGS, SHOW_KINDS } from '../data/buildings.js';
import { GOD_KEYS } from '../data/gods.js';
import { FOOD_TYPES, HOUSE_GOODS, GOOD_KEYS, WAREHOUSE_GOODS, emptyStock } from '../data/goods.js';
import { WALKER_TYPES } from '../data/walkers.js';
import { HERD_START } from '../data/units.js';
import { clearRuin } from './ruins.js';
import { freeFortNumber } from './fortNumbers.js';
import { Terrain } from '../world/map.js';

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
    ent: { theater: 0, amphitheater: 0, colosseum: 0, hippodrome: 0 },
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
    this.orders = null; // storage: per good 'accept' | 'refuse' | 'get' (sim/storageOrders.js)
    this.house = null;
    this.hasWater = false; // reservoirs, fountains, baths
    this.shows = null; // venues: days of performances booked by type
    this.fertility = 0; // farms: share of meadow tiles (0..1)
    this.variant = id % 4; // art variety
    // Quarter turns clockwise of its art, 0..3 (render/turn.js), chosen as it
    // is placed (R). Looks only, except a hippodrome's: it lays its sections
    // along x (0, 2) or y (1, 3) (sim/construction.js).
    this.turn = 0;
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
      b.orders = Object.fromEntries(FOOD_TYPES.map((k) => [k, 'accept']));
      b.emptying = false; // the Empty switch: send everything elsewhere, take nothing in
      b.orderNote = null; // what the last Get or Empty check found, for the info panel
      break;
    case 'warehouse':
      // Every good but horses, which stay at the Horse Ranch (data/goods.js keptAt).
      b.stock = emptyStock(WAREHOUSE_GOODS);
      b.incoming = emptyStock(WAREHOUSE_GOODS);
      // Warehouses accept everything except food by default (food goes to granaries).
      b.orders = Object.fromEntries(WAREHOUSE_GOODS.map((k) => [k, FOOD_TYPES.includes(k) ? 'refuse' : 'accept']));
      b.emptying = false;
      b.orderNote = null;
      break;
    case 'market':
      b.stock = emptyStock([...FOOD_TYPES, ...HOUSE_GOODS]);
      b.incoming = emptyStock([...FOOD_TYPES, ...HOUSE_GOODS]);
      break;
    case 'farm':
    case 'raw':
    case 'wharf':
      b.stock = { [def.produces]: 0 };
      if (def.produces === 'horses') {
        b.herd = HERD_START; // breeding mares (see data/units.js)
        b.herdDays = 0;
        b.incoming = { horses: 0 }; // imported horses on their way to its stables (sim/storage.js)
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
      b.number = 0; // its number among the forts (Castra III, Shift+3), given as it is placed (addBuilding)
      break;
    case 'navalia': // sim/navy.js
      b.stock = emptyStock(def.inputs); // timber, iron, linen for the next liburnian
      b.incoming = emptyStock(def.inputs);
      b.built = 0; // liburnians launched here
      b.blocked = ''; // what is holding it up (info panel)
      break;
    case 'shipyard': // sim/fishing.js
      b.stock = emptyStock(def.inputs); // timber for the boat on the slip and the next
      b.incoming = emptyStock(def.inputs);
      break;
    case 'station': // sim/navy.js
      b.rally = null; // where its squadron is deployed {x, y} (on the water), or null = at its berths
      break;
    case 'tower':
      b.shotTimer = 0;
      break;
    case 'dock':
      b.stock = emptyStock(GOOD_KEYS); // imports unloaded from ships, waiting for carts
      b.shipId = 0; // walker id of the ship tied up here (or on its way)
      break;
    case 'venue':
      b.shows = Object.fromEntries(SHOW_KINDS.map((k) => [k, 0]));
      break;
    default:
      break;
  }
}

/**
 * The ground a building of `def` covers with its top-left tile at (x, y),
 * turned `turn` (0..3): a square, or for one in sections (the hippodrome,
 * `span` 3) the row of them, along x at turns 0 and 2 and along y at 1 and
 * 3, with where each section's top-left tile stands. The sections follow
 * the way the turn takes the art's +u edge (render/turn.js): section 0, the
 * rounded end, is at the left (x) or top (y) end at turns 0 and 1 and at
 * the other end at turns 2 and 3, so the stretches of track still meet.
 * @returns {{x:number, y:number, w:number, h:number, sections:Array<{x:number,y:number}>}}
 */
export function spanLayout(def, x, y, turn = 0) {
  const S = def.size;
  const n = def.span || 1;
  const t = turn & 3;
  const alongY = t % 2 === 1;
  const sections = [];
  for (let k = 0; k < n; k++) {
    const at = (t >= 2 ? n - 1 - k : k) * S; // section k's distance along the row
    sections.push(alongY ? { x, y: y + at } : { x: x + at, y });
  }
  return { x, y, w: alongY ? S : S * n, h: alongY ? S * n : S, sections };
}

/** The top-left tile of a building in sections whose main (section 0) stands at (x, y). */
export function spanOrigin(def, x, y, turn = 0) {
  const s0 = spanLayout(def, 0, 0, turn).sections[0];
  return { x: x - s0.x, y: y - s0.y };
}

/**
 * The ground a building covers: a square of `size`, or for a building in
 * sections (the hippodrome, `span` 3) the whole row of them (spanLayout).
 */
export function footprintRect(b) {
  const def = b.def;
  if (!(def.span > 1) || b.main) return { x: b.x, y: b.y, w: b.size, h: b.size };
  const o = spanOrigin(def, b.x, b.y, b.turn || 0);
  const r = spanLayout(def, o.x, o.y, b.turn || 0);
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

/**
 * Every building of a linked group (a hippodrome and its two parts, main
 * first), or just [b]. A part points at its main by `main`; the main lists
 * its parts in `parts`.
 */
export function linkedGroup(game, b) {
  const main = b.main ? game.buildings.get(b.main) : b;
  if (!main) return [b];
  if (!main.parts || !main.parts.length) return [main];
  return [main, ...main.parts.map((id) => game.buildings.get(id)).filter(Boolean)];
}

/** The building that does the work for this one: a hippodrome part's main section, or itself. */
export function mainOf(game, b) {
  if (!b || !b.main) return b;
  return game.buildings.get(b.main) || b;
}

/**
 * Is a soldier inside his own fort's walls, in its yard (sim/military.js
 * yardSpot)? A fort's footprint is no ground for anyone else, so nothing
 * outside reaches him there: raiders, Caesar's men, villagers and wolves do
 * not pick him, and he catches no thief in the street.
 */
export function inOwnFort(game, u) {
  const f = u.fort ? game.buildings.get(u.fort) : null;
  return !!f && u.x >= f.x && u.y >= f.y && u.x < f.x + f.size && u.y < f.y + f.size;
}

/** Tile indices of every building in b's linked group. */
export function groupTiles(game, b) {
  const out = [];
  for (const x of linkedGroup(game, b)) out.push(...footprintTiles(game.map, x.x, x.y, x.size));
  return out;
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

/**
 * Tiles orthogonally adjacent to a footprint (its perimeter ring, no corners).
 * `h`: the footprint's height when it is not square (w = size along x).
 */
export function perimeterTiles(map, x, y, size, h = size) {
  const out = [];
  const w = size;
  for (let d = 0; d < Math.max(w, h); d++) {
    const cand = [];
    if (d < w) cand.push([x + d, y - 1]);
    if (d < h) cand.push([x + w, y + d]);
    if (d < w) cand.push([x + d, y + h]);
    if (d < h) cand.push([x - 1, y + d]);
    for (const [tx, ty] of cand) if (map.inBounds(tx, ty)) out.push(map.idx(tx, ty));
  }
  return out;
}

/**
 * The tiles of a footprint's perimeter ring (perimeterTiles) beside its
 * land: a building that stands out over the water (a waterside building's
 * front rows, waterRowsFor) takes its road on the shore, never from a
 * bridge passing its pier. For a building wholly on land, the whole ring.
 */
export function accessTiles(map, x, y, w, h = w) {
  return perimeterTiles(map, x, y, w, h).filter((i) => {
    // The footprint tile it touches: the nearest one (a ring tile is beside exactly one).
    const fx = Math.max(x, Math.min(x + w - 1, map.xOf(i)));
    const fy = Math.max(y, Math.min(y + h - 1, map.yOf(i)));
    return map.terrain[map.idx(fx, fy)] !== Terrain.WATER;
  });
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
  // A building in sections (the hippodrome) takes a road beside any of them;
  // one out over the water, beside its rows on land (accessTiles).
  const r = footprintRect(b);
  for (const i of accessTiles(map, r.x, r.y, r.w, r.h)) {
    if (!map.road[i]) continue;
    if (!off(i)) { b.accessRoad = i; break; } // on the city's network: done
    if (b.accessRoad < 0) b.accessRoad = i; // else remember the first road, as a fallback
  }
  return b.accessRoad;
}

// ---------------------------------------------------------------------------
// Waterside buildings
// ---------------------------------------------------------------------------

/** Is this a waterside building: the Emporium, the fleet's three, a shipyard or a wharf? */
export function isWaterside(def) {
  return def.placement === 'shore' || def.placement === 'fishingShore';
}

/**
 * How many rows of a waterside building stand out over the water, as the
 * original's docks did: one for a 2x2 (the wharf, the shipyard), two for a
 * 3x3 or larger. Its other rows stand on the shore. The rows on the water
 * are its front, the side it faces (b.waterSide).
 */
export function waterRowsFor(size) {
  return size <= 2 ? 1 : 2;
}

/**
 * Added to a waterside building's art state (render/buildingArt.js
 * artState, and the placement preview) when it stands out over the water:
 * its rows on the water are drawn as a quay or pier on piles, its others on
 * the shore. One wholly on land from an older save keeps its old look.
 */
export const OVER_WATER_ART = 16;

/** Tile (dx, dy) of an S x S footprint, counted in rows from its `side` (0 = -y, 1 = +x, 2 = +y, 3 = -x). */
function rowFrom(side, dx, dy, S) {
  return side === 0 ? dy : side === 1 ? S - 1 - dx : side === 2 ? S - 1 - dy : dx;
}

/**
 * The side of an S x S footprint whose front rows (waterRowsFor) are all
 * water while all its other tiles are land, or -1. The terrain alone decides
 * it, and at most one side can fit, so a waterside building turns itself and
 * the player never turns it (sim/construction.js turnRule). A building wholly
 * on land (placed before the rule, in an older save) has none.
 */
export function waterRowsSide(map, x, y, S) {
  if (!map.inBounds(x, y) || !map.inBounds(x + S - 1, y + S - 1)) return -1;
  const rows = waterRowsFor(S);
  for (let side = 0; side < 4; side++) {
    let fits = true;
    for (let dy = 0; dy < S && fits; dy++) {
      for (let dx = 0; dx < S; dx++) {
        const water = map.terrain[map.idx(x + dx, y + dy)] === Terrain.WATER;
        if (water !== rowFrom(side, dx, dy, S) < rows) { fits = false; break; }
      }
    }
    if (fits) return side;
  }
  return -1;
}

/** How many of a building's rows stand on the water (0: wholly on land, as every building but the waterside ones). */
export function waterRowsOf(map, b) {
  return isWaterside(b.def) && waterRowsSide(map, b.x, b.y, b.size) >= 0 ? waterRowsFor(b.size) : 0;
}

/** Tile `d` (0..S-1) of the line just past a footprint's `side` edge, as [x, y]. */
function pastSide(side, d, x, y, S) {
  return [side === 1 ? x + S : side === 3 ? x - 1 : x + d, side === 0 ? y - 1 : side === 2 ? y + S : y + d];
}

/**
 * Where ships or boats tie up at a building out over the water: on the water
 * just past its front row, alongside the quay, the tile nearest the middle
 * first (a ship comes alongside, not off a corner), or -1. `beside`: failing
 * that, the water beside its rows on the water, front row first, as for one
 * whose front a low bridge has closed since (placement asks for the front).
 */
function berthInFront(map, def, x, y, S, side, beside, closed) {
  const mid = (S - 1) / 2;
  const order = [...Array(S).keys()].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
  for (const d of order) {
    const [tx, ty] = pastSide(side, d, x, y, S);
    if (map.inBounds(tx, ty) && berthWater(map, def, map.idx(tx, ty), closed)) return map.idx(tx, ty);
  }
  if (!beside) return -1;
  for (let r = 0; r < waterRowsFor(S); r++) {
    const d = side === 0 || side === 3 ? r : S - 1 - r; // row r, along its flanks' edges
    for (const flank of [(side + 3) & 3, (side + 1) & 3]) {
      const [tx, ty] = pastSide(flank, d, x, y, S);
      if (map.inBounds(tx, ty) && berthWater(map, def, map.idx(tx, ty), closed)) return map.idx(tx, ty);
    }
  }
  return -1;
}

/**
 * A waterside building of `def` with its top-left tile at (x, y) as it
 * stands out over the water: the side its rows on the water face (`side`),
 * how many (`rows`), and its berth in front (`water`, -1 when there is no
 * water there that ships or boats could use; `beside` as berthInFront).
 * Null when its rows do not lie so. Terrain and the water layers only:
 * placement checks the rest (sim/construction.js checkWaterRows).
 * @returns {{side:number, rows:number, water:number}|null}
 */
export function overWaterFit(map, def, x, y, S = def.size, beside = false, closed = null) {
  const side = waterRowsSide(map, x, y, S);
  if (side < 0) return null;
  return { side, rows: waterRowsFor(S), water: berthInFront(map, def, x, y, S, side, beside, closed) };
}

/**
 * Which edge of a footprint at (x, y) touches the water tile `water`
 * (0 = -y, 1 = +x, 2 = +y, 3 = -x), as the waterside art is turned.
 */
export function sideToward(map, water, x, y, size) {
  const wx = map.xOf(water);
  const wy = map.yOf(water);
  return wy < y ? 0 : wx >= x + size ? 1 : wy >= y + size ? 2 : 3;
}

/**
 * The side a waterside building faces, given its berth `i`: for one out
 * over the water, the side of its rows on the water (even when its berth
 * lies beside them), else the edge the berth touches.
 */
export function waterSideOf(map, b, i) {
  const side = isWaterside(b.def) ? waterRowsSide(map, b.x, b.y, b.size) : -1;
  return side >= 0 ? side : sideToward(map, i, b.x, b.y, b.size);
}

/**
 * The first water tile beside a footprint that a waterside building of
 * `def` can use, anywhere round it, or -1: navigable water for those ships
 * tie up at (the Emporium, the Navalia, a Naval Station, the Portus),
 * fishing water for a shipyard or wharf.
 */
function berthBeside(map, def, x, y, size) {
  if (def.placement === 'shore') return map.navigableBeside(x, y, size);
  if (def.placement === 'fishingShore') return map.fishWaterBeside(x, y, size);
  return -1;
}

/**
 * Can a waterside building of `def` use water tile `i` (ships reach it, or
 * it has fish)? Never water under a building: the map closes it to boats
 * (world/map.js closeBuiltWater), nor tile in `closed` (a set of tiles a
 * plan would close: a low bridge being placed, sim/bridges.js lowBridgeCuts).
 */
function berthWater(map, def, i, closed = null) {
  if (closed && closed.has(i)) return false;
  if (def.placement === 'shore') return !!map.navigable[i] && !map.bridgeLow[i];
  return map.fishBody[i] > 0;
}

/**
 * The rule before buildings stood out over the water (v0.18.6 to v0.18.12),
 * for those placed under it, wholly on land: the side of a footprint at
 * (x, y) that stands right at the water's edge, every tile just past it
 * water and at least one the building can use.
 * @returns {{side:number, water:number}|null} `side` as sideToward, `water`
 * the first usable tile along it (the berth). The side of the first usable
 * tile found round the footprint the oldest way (berthBeside) wins when it
 * qualifies, then the sides in order.
 */
export function waterEdge(map, def, x, y, size = def.size) {
  const first = berthBeside(map, def, x, y, size);
  if (first < 0) return null;
  const firstSide = sideToward(map, first, x, y, size);
  for (const side of [firstSide, 0, 1, 2, 3]) {
    let water = -1;
    let whole = true;
    for (let d = 0; d < size && whole; d++) {
      const [tx, ty] = pastSide(side, d, x, y, size);
      if (!map.inBounds(tx, ty)) { whole = false; break; }
      const i = map.idx(tx, ty);
      if (map.terrain[i] !== Terrain.WATER) whole = false;
      else if (water < 0 && berthWater(map, def, i)) water = i;
    }
    if (whole && water >= 0) return { side, water };
  }
  return null;
}

/**
 * The water a waterside building at (x, y) uses (its berth, slip or
 * mooring), or -1: for one out over the water, the water in front of it
 * (overWaterFit). One placed before that rule stands wholly on land and
 * keeps the water it always had: its side right at the water's edge
 * (waterEdge), or, standing back from the water, the first usable water
 * beside it. `closed`: tiles to count as closed to boats already (berthWater).
 */
export function shoreWaterAt(map, def, x, y, size = def.size, closed = null) {
  const fit = overWaterFit(map, def, x, y, size, true, closed);
  if (fit) return fit.water;
  const edge = waterEdge(map, def, x, y, size);
  return edge ? edge.water : berthBeside(map, def, x, y, size);
}

/**
 * Turn a waterside building to face its water, and note how many of its
 * rows stand on it (`waterRows`, derived from the terrain: 0 for one wholly
 * on land). Done as it is placed (and for an older save, as it loads):
 * before, the side was worked out only when a ship or boat first used the
 * building, and a Portus or Naval Station stood turned the wrong way until
 * then (playtest).
 */
export function faceWater(game, b) {
  if (!isWaterside(b.def)) return;
  const map = game.map;
  b.waterRows = waterRowsOf(map, b);
  if (b.waterRows) { b.waterSide = waterRowsSide(map, b.x, b.y, b.size); return; }
  const i = shoreWaterAt(map, b.def, b.x, b.y, b.size);
  if (i >= 0) b.waterSide = sideToward(map, i, b.x, b.y, b.size);
}

/**
 * Register a new building on the map.
 * The caller (construction.js) is responsible for validation and payment.
 * `quiet`: no 'buildingAdded' event, so the renderer does not raise it out of
 * the ground (homes split off a bigger home were there all along). One out
 * over the water closes the water under it to boats (Game.waterwaysChanged).
 */
export function addBuilding(game, type, x, y, size, { quiet = false, turn = 0 } = {}) {
  const id = game.nextBuildingId++;
  const b = new Building(id, type, x, y, size);
  b.turn = turn & 3; // (before its road: a hippodrome's row of sections depends on it)
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
  // The lowest number no standing fort holds (sim/fortNumbers.js), before
  // the fort joins the list so it does not count itself.
  if (b.def.kind === 'fort') b.number = freeFortNumber(game);
  game.buildings.set(id, b);
  computeAccessRoad(game, b);
  faceWater(game, b);
  if (b.waterRows) game.waterwaysChanged?.(); // (no boat sails through it now)
  b.createdDay = game.time.totalDays;
  // A new garden or statue starts fully tended (sim/gardens.js).
  if (b.def.tended) { b.tendedDay = game.time.totalDays; b.careStep = 0; }
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
  // A hippodrome comes down whole: any of its sections takes the others with it.
  const linked = b.main || (b.parts && b.parts.length) ? linkedGroup(game, b).filter((x) => x !== b) : [];
  for (const i of footprintTiles(map, b.x, b.y, b.size)) {
    if (map.building[i] === b.id) map.building[i] = 0;
  }
  game.buildings.delete(b.id);
  // Walkers that belong to this building vanish with it (their cargo is
  // lost), except a dock worker with a load: imports the city paid for, or an
  // export fetched for a ship. It takes its load to storage instead
  // (sim/walkers.js deliverElsewhere).
  for (const wid of [...b.walkers]) {
    const w = game.walkers.get(wid);
    if (!w || w.kind === 'traveler') continue;
    if (b.def.kind === 'dock' && w.type === 'cart' && w.cargo && w.cargo.amount > 0) {
      w.claim = null;
      continue;
    }
    killWalker(game, w);
  }
  // Residents of a destroyed home become homeless and look for a new one.
  if (b.house && b.house.pop > 0 && reason !== 'merge') {
    evictResidents(game, b);
  }
  // Its rows on the water are open water again, whatever brought it down
  // (no rubble or flames are left on water: sim/risk.js fallingGround).
  if (b.waterRows) game.waterwaysChanged?.();
  game.markDirty('des', 'water');
  map.touch();
  game.events.emit('buildingRemoved', { building: b, reason });
  for (const x of linked) removeBuilding(game, x, reason);
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

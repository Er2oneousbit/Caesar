/**
 * housing.js
 * ----------------------------------------------------------------------------
 * The housing ladder in motion: homes moving up and down the 20 levels of
 * data/housing.js, joining, growing and splitting, and using up food and goods.
 *
 * Daily, each occupied home:
 *   1. counts down its service access timers
 *   2. a single-tile home (levels 1-10) tries to join its three neighbors
 *      to the right and below into a 2x2 block, if they are single-tile homes
 *      of the same level (vacant lots count as tents) and the tile allows it
 *      (a fixed roll per tile, from the map seed: about 1 tile in 3 never
 *      starts a block, which keeps streets from turning into one pattern)
 *   3. measures what it has (water, food variety, gods, entertainment...)
 *   4. a BAD day is desirability at or below its level's `down`, or any need
 *      of its own level missing. After game.difficulty.devolveDays bad days in
 *      a row it drops one level. Any other day resets the count.
 *   5. otherwise, with desirability at least its level's `up` and every need
 *      of the next level met, it moves up one level at once (never more than
 *      one a day). Reaching 11, 15 or 19 it first grows into a 2x2, 3x3 or
 *      4x4 footprint, taking over homes of its own level or lower (so four
 *      Apartment Houses can become one Tenement), then clear land, then
 *      gardens.
 *
 * A home that falls back below 11, 15 or 19 splits: it keeps a corner at the
 * smaller size (the top-left one, unless only another corner still has a
 * road within reach), and the rest become single-tile Apartment Houses.
 * People and goods are shared by the tiles each part covers. Parts start
 * without service visits and are first checked the day after; a part with
 * no road within reach stays a vacant lot and its people look for another
 * home. Residents over a home's capacity become homeless and look for room
 * elsewhere (a Villa holds far fewer people than the Insula it grew from).
 *
 * The list of unmet needs is stored on the house (h.blocked) so the info
 * panel can tell the player exactly what is missing.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { VENUE_POINTS, VENUE_BOTH_BONUS } from '../data/buildings.js';
import { FOOD_TYPES, HOUSE_GOODS } from '../data/goods.js';
import { GOD_KEYS } from '../data/gods.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';
import { HOUSE_TIERS, MAX_TIER, MAX_SMALL_TIER, houseCapacity } from '../data/housing.js';
import { hashSeed } from '../core/rng.js';
import { Terrain, WaterBits } from '../world/map.js';
import { addBuilding, computeAccessRoad, killWalker, removeBuilding, sendHomeless, spawnWalker } from './entities.js';
import { walkTo } from './movement.js';
import { logGoods } from './goodsLedger.js';

// ---------------------------------------------------------------------------
// Measuring a home
// ---------------------------------------------------------------------------

/**
 * Entertainment score of a home: the city-wide base (how well venue seats
 * cover the population, see updateEntertainmentBase) plus the points of every
 * venue whose entertainer passed by recently, with a bonus for venues that had
 * both kinds of show booked at the time.
 */
export function entertainmentScore(game, h) {
  let score = game.city.entBase || 0;
  for (const v in VENUE_POINTS) {
    if (!(h.ent[v] > 0)) continue;
    score += VENUE_POINTS[v];
    if (h.entBoth && h.entBoth[v] > 0) score += VENUE_BOTH_BONUS[v] || 0;
  }
  return score;
}

/** Education tier: 1 = school or library, 2 = both, 3 = both plus an academy. */
export function educationTier(h) {
  const school = h.school > 0;
  const library = h.library > 0;
  if (school && library) return h.academy > 0 ? 3 : 2;
  return school || library ? 1 : 0;
}

/** Measure what a house currently has access to. */
export function evaluateHouse(game, b) {
  const { map } = game;
  const h = b.house;
  let des = -1000;
  let water = 0;
  let hospital = 0;
  for (let dy = 0; dy < b.size; dy++) {
    for (let dx = 0; dx < b.size; dx++) {
      const i = map.idx(b.x + dx, b.y + dy);
      if (map.desirability[i] > des) des = map.desirability[i];
      const bits = map.water[i];
      if (bits & WaterBits.FOUNTAIN) water = 2;
      else if (bits & WaterBits.WELL && water < 1) water = 1;
      if (bits & WaterBits.HOSPITAL) hospital = 1;
    }
  }
  let food = 0;
  for (const f of FOOD_TYPES) if (h.food[f] > 0.01) food++;
  let religion = 0;
  for (const g of GOD_KEYS) if (h.religion[g] > 0) religion++;
  const goods = [];
  for (const g of HOUSE_GOODS) if (h.goods[g] > 0.01) goods.push(g);
  return {
    des,
    water,
    food,
    religion,
    ent: entertainmentScore(game, h),
    edu: educationTier(h),
    barber: h.barber > 0 ? 1 : 0,
    baths: h.baths > 0 ? 1 : 0,
    health: (h.clinic > 0 ? 1 : 0) + hospital,
    hospital,
    goods,
    wine: game.city.wineSources || 0,
  };
}

/** Every need of a level except desirability. */
function checkNeeds(t, lv, missing) {
  if (lv.water < t.water) missing.push({ key: 'water', have: lv.water, need: t.water });
  if (lv.food < t.food) missing.push({ key: 'food', have: lv.food, need: t.food });
  if (lv.religion < t.religion) missing.push({ key: 'religion', have: lv.religion, need: t.religion });
  if (lv.ent < t.ent) missing.push({ key: 'ent', have: lv.ent, need: t.ent });
  if (lv.edu < t.edu) missing.push({ key: 'edu', have: lv.edu, need: t.edu });
  if (lv.barber < t.barber) missing.push({ key: 'barber', have: 0, need: 1 });
  if (lv.baths < t.baths) missing.push({ key: 'baths', have: 0, need: 1 });
  if (lv.health < t.health) missing.push({ key: 'health', have: lv.health, need: t.health, hospital: lv.hospital });
  for (const g of t.goods) if (!lv.goods.includes(g)) missing.push({ key: 'goods', good: g, have: 0, need: 1 });
  if (lv.wine < t.wine) missing.push({ key: 'wine', have: lv.wine, need: t.wine });
}

/**
 * Does a set of levels satisfy a level?
 *   mode 'enter': can a home one level below move up into it (desirability
 *                 at least the level below's `up`)
 *   mode 'stay':  can a home at this level keep it (desirability above `down`)
 * @returns {{ok:boolean, missing:Array<{key:string, have:any, need:any}>}}
 */
export function checkTier(tier, lv, mode = 'enter') {
  const t = HOUSE_TIERS[tier];
  const missing = [];
  if (mode === 'stay') {
    if (lv.des <= t.down) missing.push({ key: 'des', have: lv.des, need: t.down + 1 });
  } else {
    const need = tier > 0 ? HOUSE_TIERS[tier - 1].up : -999;
    if (lv.des < need) missing.push({ key: 'des', have: lv.des, need });
  }
  checkNeeds(t, lv, missing);
  return { ok: missing.length === 0, missing };
}

/** Count down all service access timers by one day. */
function decayAccess(h) {
  for (const g of GOD_KEYS) if (h.religion[g] > 0) h.religion[g]--;
  for (const v in h.ent) if (h.ent[v] > 0) h.ent[v]--;
  if (h.entBoth) for (const v in h.entBoth) if (h.entBoth[v] > 0) h.entBoth[v]--;
  if (h.school > 0) h.school--;
  if (h.library > 0) h.library--;
  if (h.academy > 0) h.academy--;
  if (h.barber > 0) h.barber--;
  if (h.clinic > 0) h.clinic--;
  if (h.baths > 0) h.baths--;
  if (h.tax > 0) h.tax--;
  if (h.police > 0) h.police--;
}

// ---------------------------------------------------------------------------
// The daily check
// ---------------------------------------------------------------------------

/** Daily house update. */
export function updateHouse(game, b) {
  const h = b.house;
  decayAccess(h);
  if (h.pop <= 0) {
    // Everyone left: back to vacant lots (unless settlers are on the way).
    if (h.tier > 0 && h.incoming <= 0) makeVacant(game, b);
    h.blocked = null;
    return;
  }
  if (h.tier === 0) h.tier = 1; // settlers arrived
  if (h.bornDay === game.time.totalDays) return; // split off today: judged tomorrow
  tryJoinBlock(game, b);
  const lv = evaluateHouse(game, b);
  h.des = lv.des;
  h.water = lv.water;
  h.levels = lv;

  // Tents never fall back, so they never have a bad day.
  const cur = h.tier > 1 ? checkTier(h.tier, lv, 'stay') : { ok: true };
  if (!cur.ok) {
    h.devolveDays++;
    h.blocked = cur.missing;
    h.devolving = true;
    if (h.devolveDays >= game.difficulty.devolveDays) {
      devolve(game, b);
      refreshStatus(game, b);
    }
    return;
  }
  h.devolveDays = 0;
  h.devolving = false;
  if (h.tier >= MAX_TIER) {
    h.blocked = null;
    return;
  }
  const next = checkTier(h.tier + 1, lv, 'enter');
  if (!next.ok) {
    h.blocked = next.missing;
    return;
  }
  const needSize = HOUSE_TIERS[h.tier + 1].size;
  if (needSize > b.size && !growHouse(game, b, needSize)) {
    h.blocked = [{ key: 'space', have: b.size, need: needSize }];
    return;
  }
  evolve(game, b);
  refreshStatus(game, b);
}

/**
 * After a home changes level (or is split off), work out what the info panel
 * should say about its new level: what it lacks to keep it, or else what it
 * lacks for the next one. The daily check will confirm it tomorrow.
 */
function refreshStatus(game, b) {
  const h = b.house;
  const lv = evaluateHouse(game, b);
  h.levels = lv;
  h.des = lv.des;
  h.water = lv.water;
  const cur = h.tier > 1 ? checkTier(h.tier, lv, 'stay') : { ok: true };
  h.devolving = !cur.ok;
  if (!cur.ok) { h.blocked = cur.missing; return; }
  const next = h.tier < MAX_TIER ? checkTier(h.tier + 1, lv, 'enter') : null;
  h.blocked = next && !next.ok ? next.missing : null;
}

function evolve(game, b) {
  const h = b.house;
  h.tier++;
  h.devolveDays = 0;
  if (h.tier > MAX_SMALL_TIER) h.merged = false; // a block of level-10 homes becomes one Tenement
  game.city.stats.evolutions++;
  evictOverflow(game, b); // villas hold fewer people than the insulae they grow from
  game.markDirty('des');
  game.events.emit('houseChanged', b);
  if (HOUSE_TIERS[h.tier].patrician && !game.city.flags.firstVilla) {
    game.city.flags.firstVilla = true;
    game.message('A family of patricians has built the city\'s first villa!', 'good', b.x, b.y);
  }
}

function devolve(game, b) {
  const h = b.house;
  if (h.tier <= 1) return;
  h.tier--;
  h.devolveDays = 0;
  game.city.stats.devolutions++;
  const size = HOUSE_TIERS[h.tier].size;
  // A 2x2 block of single-tile homes stays a block; a real 2x2, 3x3 or 4x4
  // home that falls below its footprint's levels splits.
  if (size < b.size && !h.merged) splitHouse(game, b, size);
  evictOverflow(game, b);
  game.markDirty('des');
  game.events.emit('houseChanged', b);
}

/** Residents over the home's capacity leave as homeless and look for room elsewhere. */
export function evictOverflow(game, b) {
  const h = b.house;
  const cap = houseCapacity(h.tier, b.size);
  if (h.pop <= cap) return;
  const extra = h.pop - cap;
  h.pop = cap;
  sendHomeless(game, b, extra);
}

/** Residents leave the city from this house's road. */
export function sendEmigrants(game, b, people) {
  const start = b.accessRoad;
  game.city.stats.emigrated += people;
  if (start < 0 || !game.map.road[start]) return;
  const { map } = game;
  const exitIdx = map.idx(map.exit.x, map.exit.y);
  while (people > 0) {
    const n = Math.min(people, CONFIG.IMMIGRANT_GROUP_MAX);
    people -= n;
    const w = spawnWalker(game, 'emigrant', start, null, { people: n, state: 'leaving' });
    if (!w) return;
    // No road to the exit: they leave the map by other means.
    if (!walkTo(game, w, exitIdx)) killWalker(game, w);
  }
}

// ---------------------------------------------------------------------------
// Footprints: blocks, growing, splitting
// ---------------------------------------------------------------------------

const seedHashes = new WeakMap();

/** A 32-bit mix of an integer (fast, well spread). */
function mix(a) {
  a ^= a >>> 16;
  a = Math.imul(a, 0x7feb352d);
  a ^= a >>> 15;
  a = Math.imul(a, 0x846ca68b);
  a ^= a >>> 16;
  return a >>> 0;
}

/**
 * Can a single-tile home on this tile start a 2x2 block? Fixed for the whole
 * game (derived from the map seed, so it needs no saving): 2 tiles in 3 can.
 */
export function blockTile(game, x, y) {
  let s = seedHashes.get(game);
  if (s === undefined) {
    s = hashSeed(`${game.seed}:blocks`);
    seedHashes.set(game, s);
  }
  return mix(s ^ mix(x * 73856093 ^ y * 19349663)) % 3 !== 0;
}

/**
 * A single-tile home joins its neighbors to the right, below and diagonally
 * into a 2x2 block when all three are single-tile homes of its level (vacant
 * lots count as tents) and its tile allows blocks.
 */
function tryJoinBlock(game, b) {
  const h = b.house;
  if (b.size !== 1 || h.merged || h.tier < 1 || h.tier > MAX_SMALL_TIER) return false;
  if (!blockTile(game, b.x, b.y)) return false;
  const { map, buildings } = game;
  const others = [];
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]]) {
    const o = buildings.get(map.buildingAt(b.x + dx, b.y + dy));
    if (!o || !o.house || o.size !== 1 || o.house.merged) return false;
    if ((o.house.tier || 1) !== h.tier) return false;
    others.push(o);
  }
  const moved = new Map();
  for (const o of others) absorbHouse(game, b, o, moved);
  retarget(game, moved);
  setFootprint(game, b, b.x, b.y, 2);
  h.merged = true;
  game.markDirty('des');
  game.events.emit('houseChanged', b);
  return true;
}

/**
 * Add another house's residents, stock and best service visits to `b`, then
 * remove it. `moved` collects old id -> new id for retarget().
 */
function absorbHouse(game, b, o, moved) {
  const h = b.house;
  const oh = o.house;
  h.pop += oh.pop;
  h.incoming += oh.incoming;
  addStock(h, oh, 1);
  takeBestAccess(h, oh);
  mergeTemper(h, oh);
  b.fireRisk = Math.max(b.fireRisk, o.fireRisk);
  b.damageRisk = Math.max(b.damageRisk, o.damageRisk);
  moved.set(o.id, b.id);
  oh.pop = 0;
  oh.incoming = 0;
  removeBuilding(game, o, 'merge');
}

/** Add `share` of each food and good in `from` to `to`. */
function addStock(to, from, share) {
  for (const f of FOOD_TYPES) to.food[f] += from.food[f] * share;
  for (const g of HOUSE_GOODS) to.goods[g] += from.goods[g] * share;
}

/**
 * Families moving in together (sim/mood.js, sim/crime.js): the home keeps the
 * worst criminal flag of the two, so joining a block never wipes out a home's
 * record of trouble, and takes the other's mood if it had none of its own.
 */
function mergeTemper(h, oh) {
  if (!(oh.pop > 0)) return; // an empty lot brings no one
  h.criminal = Math.max(h.criminal || 0, oh.criminal || 0);
  if (h.mood === null || h.mood === undefined) {
    h.mood = oh.mood ?? null;
    h.moodReason = oh.moodReason ?? null;
    h.hungerStreak = oh.hungerStreak || 0;
  }
}

/** A split-off piece is the same families: it keeps their mood, trouble and hunger. */
function copyTemper(h, from) {
  h.mood = from.mood ?? null;
  h.moodReason = from.moodReason ?? null;
  h.hungerStreak = from.hungerStreak || 0;
  h.criminal = from.criminal || 0;
}

/** Keep the longer of each service visit timer (a block has what its parts had). */
function takeBestAccess(h, oh) {
  for (const g of GOD_KEYS) h.religion[g] = Math.max(h.religion[g], oh.religion[g]);
  for (const v in h.ent) h.ent[v] = Math.max(h.ent[v], oh.ent[v] || 0);
  if (h.entBoth && oh.entBoth) for (const v in h.entBoth) h.entBoth[v] = Math.max(h.entBoth[v], oh.entBoth[v] || 0);
  for (const k of ['school', 'library', 'academy', 'barber', 'clinic', 'baths', 'tax']) h[k] = Math.max(h[k], oh[k]);
  h.police = Math.max(h.police || 0, oh.police || 0); // `|| 0`: homes from v4 saves have no police timer
}

/**
 * Immigrants and homeless heading for a house that was taken over head for
 * the home that took it over instead. `moved`: old house id -> new id (one
 * pass over the walkers, however many homes moved).
 */
function retarget(game, moved) {
  if (moved.size === 0) return;
  for (const w of game.walkers.values()) {
    const to = moved.get(w.target);
    if (to) w.target = to;
    if (w.reserve && moved.has(w.reserve.id)) w.reserve.id = moved.get(w.reserve.id);
  }
}

/** Move house `b` onto a new square footprint, keeping its id. */
function setFootprint(game, b, x, y, size) {
  const { map } = game;
  for (let dy = 0; dy < b.size; dy++) {
    for (let dx = 0; dx < b.size; dx++) {
      const i = map.idx(b.x + dx, b.y + dy);
      if (map.building[i] === b.id) map.building[i] = 0;
    }
  }
  b.x = x;
  b.y = y;
  b.size = size;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const i = map.idx(x + dx, y + dy);
      map.building[i] = b.id;
      map.rubble[i] = 0;
    }
  }
  b.rev = (b.rev || 0) + 1;
  computeAccessRoad(game, b);
  game.markDirty('des');
  map.touch();
}

/** Open land a growing home may build on: no building, road, wall, rubble, trees, rock or water. */
function isClearLand(game, i) {
  const { map } = game;
  if (map.building[i] || map.road[i] || map.aqueduct[i] || map.wall[i] || map.rubble[i]) return false;
  if (game.fires.has(i)) return false;
  const t = map.terrain[i];
  return t === Terrain.GRASS || t === Terrain.MEADOW || t === Terrain.SAND;
}

/**
 * The square a home growing to size S takes over, or null. Four squares are
 * tried (the one anchored at the home, then shifted up-left, left and up),
 * in three passes: only this home and homes of its level or lower (vacant
 * lots included); then also clear land; then also gardens.
 * @returns {{x:number,y:number}|null}
 */
export function findGrowth(game, b, S) {
  const { map, buildings } = game;
  const shifts = [[0, 0], [-1, -1], [-1, 0], [0, -1]];
  for (let pass = 0; pass < 3; pass++) {
    for (const [ox, oy] of shifts) {
      const sx = b.x + ox;
      const sy = b.y + oy;
      let ok = true;
      for (let dy = 0; dy < S && ok; dy++) {
        for (let dx = 0; dx < S; dx++) {
          if (!tileTakeable(game, b, sx + dx, sy + dy, pass, map, buildings)) { ok = false; break; }
        }
      }
      if (ok) return { x: sx, y: sy };
    }
  }
  return null;
}

function tileTakeable(game, b, x, y, pass, map, buildings) {
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  const id = map.building[i];
  if (id === b.id) return true;
  if (id) {
    const o = buildings.get(id);
    if (!o) return false;
    if (o.house) return o.house.tier <= b.house.tier;
    return pass >= 2 && o.type === 'garden';
  }
  return pass >= 1 && isClearLand(game, i);
}

/**
 * Grow house `b` into an S x S footprint (it keeps its id). Homes fully inside
 * the square move in; homes only partly inside break up into single-tile
 * homes and their pieces inside move in; gardens inside are built over.
 * @returns {boolean} false when there is no room
 */
export function growHouse(game, b, S) {
  const sq = findGrowth(game, b, S);
  if (!sq) return false;
  const { map, buildings } = game;
  const inside = (x, y) => x >= sq.x && x < sq.x + S && y >= sq.y && y < sq.y + S;
  const seen = new Set([b.id]);
  const moved = new Map();
  for (let dy = 0; dy < S; dy++) {
    for (let dx = 0; dx < S; dx++) {
      const id = map.building[map.idx(sq.x + dx, sq.y + dy)];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const o = buildings.get(id);
      if (!o) continue;
      if (!o.house) {
        removeBuilding(game, o, 'merge'); // a garden
        continue;
      }
      const whole = inside(o.x, o.y) && inside(o.x + o.size - 1, o.y + o.size - 1);
      if (whole) absorbHouse(game, b, o, moved);
      else breakUp(game, b, o, inside, moved);
    }
  }
  retarget(game, moved);
  setFootprint(game, b, sq.x, sq.y, S);
  return true;
}

/**
 * A home partly inside a growing home's square breaks into single tiles:
 * a block into four homes of its level, a bigger home into Apartment Houses.
 * People and goods are shared out per tile; the tiles inside move into the
 * grower, the others become new homes (with no service visits yet).
 */
function breakUp(game, grower, o, inside, moved) {
  const oh = o.house;
  const level = oh.merged ? oh.tier : Math.min(oh.tier, MAX_SMALL_TIER);
  const n = o.size * o.size;
  const each = Math.floor(oh.pop / n);
  const rest = oh.pop - each * n;
  const pieces = [];
  for (let dy = 0; dy < o.size; dy++) {
    for (let dx = 0; dx < o.size; dx++) pieces.push({ x: o.x + dx, y: o.y + dy, pop: each + (dx === 0 && dy === 0 ? rest : 0) });
  }
  const snapshot = { food: { ...oh.food }, goods: { ...oh.goods } };
  if (oh.pop > 0) mergeTemper(grower.house, oh); // some of its families move in with the grower
  grower.house.incoming += oh.incoming;
  moved.set(o.id, grower.id);
  oh.pop = 0;
  oh.incoming = 0;
  removeBuilding(game, o, 'merge');
  for (const p of pieces) {
    if (inside(p.x, p.y)) {
      grower.house.pop += p.pop;
      addStock(grower.house, snapshot, 1 / n);
    } else {
      newPiece(game, p.x, p.y, level, p.pop, snapshot, 1 / n, grower, oh);
    }
  }
}

/**
 * A single-tile home split off a bigger one (`source`: the home it came from,
 * or the one that took over its neighbor). A piece with no road within reach
 * would be a home nobody can serve: it stays a vacant lot, its people look
 * for another home (setting out from the source's road) and its share of the
 * stock stays with the source. `families`: the house data its people come
 * from (the source's own, unless it is a neighbor the source broke up).
 */
function newPiece(game, x, y, level, pop, stock, share, source, families = source.house) {
  const b = addBuilding(game, 'house', x, y, 1, { quiet: true });
  const h = b.house;
  if (b.accessRoad < 0) {
    addStock(source.house, stock, share);
    if (pop > 0) sendHomeless(game, source, pop);
    return b;
  }
  h.tier = pop > 0 ? level : 0;
  h.pop = pop;
  h.bornDay = game.time.totalDays;
  if (pop > 0) copyTemper(h, families);
  addStock(h, stock, share);
  evictOverflow(game, b);
  if (h.pop > 0) refreshStatus(game, b);
  game.events.emit('houseChanged', b);
  return b;
}

/**
 * A 2x2, 3x3 or 4x4 home falls below its footprint's levels: it keeps its
 * anchor corner at `keep` x `keep`, and every other tile becomes a
 * single-tile Apartment House. People and goods are shared by tiles covered.
 */
function splitHouse(game, b, keep) {
  const h = b.house;
  const S = b.size;
  const n = S * S;
  const each = Math.floor(h.pop / n);
  const stock = { food: { ...h.food }, goods: { ...h.goods } };
  // The top-left corner, unless only another corner keeps a road within reach.
  const off = S - keep;
  const corners = [[0, 0], [off, 0], [0, off], [off, off]];
  const [kx, ky] = corners.find(([cx, cy]) => roadWithinReach(game, b.x + cx, b.y + cy, keep)) || corners[0];
  const x0 = b.x;
  const y0 = b.y;
  const pieces = [];
  for (let dy = 0; dy < S; dy++) {
    for (let dx = 0; dx < S; dx++) {
      if (dx >= kx && dx < kx + keep && dy >= ky && dy < ky + keep) continue;
      pieces.push({ x: x0 + dx, y: y0 + dy });
    }
  }
  setFootprint(game, b, x0 + kx, y0 + ky, keep);
  h.pop -= each * pieces.length;
  for (const f of FOOD_TYPES) h.food[f] = stock.food[f] * (keep * keep) / n;
  for (const g of HOUSE_GOODS) h.goods[g] = stock.goods[g] * (keep * keep) / n;
  for (const p of pieces) newPiece(game, p.x, p.y, MAX_SMALL_TIER, each, stock, 1 / n, b);
}

/** Is there a road within 2 tiles of this square (the reach of a home)? */
function roadWithinReach(game, x, y, size) {
  const { map } = game;
  for (let ty = y - 2; ty < y + size + 2; ty++) {
    for (let tx = x - 2; tx < x + size + 2; tx++) if (map.inBounds(tx, ty) && map.road[map.idx(tx, ty)]) return true;
  }
  return false;
}

/**
 * An empty home goes back to vacant lots: a block or a bigger home becomes
 * one lot per tile (the anchor keeps its id).
 */
function makeVacant(game, b) {
  const h = b.house;
  const size = b.size;
  h.tier = 0;
  h.merged = false;
  h.devolveDays = 0;
  // The next family starts afresh (sim/mood.js).
  h.mood = null;
  h.moodReason = null;
  h.hungerStreak = 0;
  h.criminal = 0;
  if (size > 1) {
    const { x, y } = b;
    setFootprint(game, b, x, y, 1);
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) if (dx || dy) addBuilding(game, 'house', x + dx, y + dy, 1, { quiet: true });
    }
  }
  game.markDirty('des');
  game.events.emit('houseChanged', b);
}

// ---------------------------------------------------------------------------
// City-wide inputs to the ladder
// ---------------------------------------------------------------------------

/**
 * Daily: wine sources the city has, for the top levels' "two kinds of wine":
 * one for a working (staffed) winery, plus one for each open trade route whose
 * partner sells wine, while wine is set to import.
 */
export function updateWineSources(game) {
  const c = game.city;
  let n = 0;
  for (const b of game.buildings.values()) {
    if (b.def.kind === 'workshop' && b.def.produces === 'wine' && b.efficiency > 0) { n = 1; break; }
  }
  const trade = c.trade;
  if (trade && trade.settings.wine && trade.settings.wine.mode === 'import') {
    for (const [id, route] of Object.entries(trade.routes)) {
      const p = TRADE_PARTNERS[id];
      if (route.open && p && p.sells && p.sells.wine) n++;
    }
  }
  c.wineSources = n;
}

// ---------------------------------------------------------------------------
// Consumption
// ---------------------------------------------------------------------------

/**
 * Monthly: households eat, then use up goods. A home eats only as many kinds
 * of food as its level needs (the first it has, in the order of FOOD_TYPES),
 * a share of the monthly ration from each; when one runs short, the rest of
 * the ration comes from the other food it has. Tents forage and eat nothing.
 */
export function consumeHouse(game, b) {
  const h = b.house;
  if (h.pop <= 0) return;
  const t = HOUSE_TIERS[h.tier];
  const flow = game.city.foodFlow;
  if (!t.eats || t.food <= 0) {
    h.hungry = false;
  } else {
    const ration = h.pop * CONFIG.FOOD_PER_PERSON_MONTH;
    const portion = ration / t.food;
    let eaten = 0;
    let kinds = 0;
    for (const f of FOOD_TYPES) {
      if (kinds >= t.food) break;
      if (!(h.food[f] > 0.01)) continue;
      const n = Math.min(h.food[f], portion);
      h.food[f] -= n;
      eaten += n;
      logGoods(game, f, 'used', n);
      kinds++;
    }
    for (const f of FOOD_TYPES) {
      if (ration - eaten <= 0.0001) break;
      const n = Math.min(h.food[f], ration - eaten);
      h.food[f] -= n;
      eaten += n;
      logGoods(game, f, 'used', n);
    }
    h.hungry = kinds === 0;
    flow.eaten += eaten;
    flow.shortfall += Math.max(0, ration - eaten);
  }
  useGoods(game, b);
}

/**
 * Goods are used up twice a month (with the monthly meal, and on day
 * GOODS_MIDMONTH_DAY): half a month's share each time, and only the goods the
 * home's level needs.
 */
export function useGoods(game, b) {
  const h = b.house;
  if (h.pop <= 0) return;
  const tier = HOUSE_TIERS[h.tier];
  const perGood = Math.max(0.25, h.pop / CONFIG.GOODS_PER_HOUSE_PEOPLE) / 2;
  for (const g of tier.goods) {
    logGoods(game, g, 'used', Math.min(h.goods[g], perGood));
    h.goods[g] = Math.max(0, h.goods[g] - perGood);
  }
}

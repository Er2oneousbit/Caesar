/**
 * housing.js
 * ----------------------------------------------------------------------------
 * House evolution, devolution, merging and monthly consumption.
 *
 * Daily, each occupied house:
 *   1. counts down its service access timers
 *   2. measures what it has (water, food variety, gods, entertainment...)
 *   3. if its CURRENT tier is no longer satisfied for DEVOLVE_DELAY_DAYS, it
 *      drops a tier (and residents over capacity leave)
 *   4. else if the NEXT tier is satisfied for EVOLVE_DELAY_DAYS, it climbs
 *      a tier. Tiers that need a bigger footprint first merge the house with
 *      neighboring small houses or empty land.
 *
 * The list of unmet needs is stored on the house (h.blocked) so the info
 * panel can tell the player exactly what is missing.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { VENUE_POINTS } from '../data/buildings.js';
import { FOOD_TYPES, HOUSE_GOODS } from '../data/goods.js';
import { GOD_KEYS } from '../data/gods.js';
import { HOUSE_TIERS, MAX_TIER, houseCapacity } from '../data/housing.js';
import { Terrain, WaterBits } from '../world/map.js';
import { computeAccessRoad, killWalker, removeBuilding, spawnWalker } from './entities.js';
import { walkTo } from './movement.js';

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
  let ent = 0;
  for (const v in VENUE_POINTS) if (h.ent[v] > 0) ent += VENUE_POINTS[v];
  const edu = (h.school > 0 ? 1 : 0) + (h.library > 0 ? 1 : 0) + (h.academy > 0 ? 1 : 0);
  const health = (h.barber > 0 ? 1 : 0) + (h.clinic > 0 ? 1 : 0) + (h.baths > 0 ? 1 : 0) + hospital;
  const goods = [];
  for (const g of HOUSE_GOODS) if (h.goods[g] > 0.01) goods.push(g);
  return { des, water, food, religion, ent, edu, health, goods };
}

/**
 * Does a set of levels satisfy a tier?
 * @returns {{ok:boolean, missing:Array<{key:string, have:any, need:any}>}}
 */
export function checkTier(tier, lv, desTolerance = 0) {
  const t = HOUSE_TIERS[tier];
  const missing = [];
  if (lv.water < t.water) missing.push({ key: 'water', have: lv.water, need: t.water });
  if (lv.food < t.food) missing.push({ key: 'food', have: lv.food, need: t.food });
  if (lv.religion < t.religion) missing.push({ key: 'religion', have: lv.religion, need: t.religion });
  if (lv.ent < t.ent) missing.push({ key: 'ent', have: lv.ent, need: t.ent });
  if (lv.edu < t.edu) missing.push({ key: 'edu', have: lv.edu, need: t.edu });
  if (lv.health < t.health) missing.push({ key: 'health', have: lv.health, need: t.health });
  for (const g of t.goods) if (!lv.goods.includes(g)) missing.push({ key: 'goods', good: g, have: 0, need: 1 });
  if (lv.des < t.des - desTolerance) missing.push({ key: 'des', have: lv.des, need: t.des });
  return { ok: missing.length === 0, missing };
}

/** Count down all service access timers by one day. */
function decayAccess(h) {
  for (const g of GOD_KEYS) if (h.religion[g] > 0) h.religion[g]--;
  for (const v in h.ent) if (h.ent[v] > 0) h.ent[v]--;
  if (h.school > 0) h.school--;
  if (h.library > 0) h.library--;
  if (h.academy > 0) h.academy--;
  if (h.barber > 0) h.barber--;
  if (h.clinic > 0) h.clinic--;
  if (h.baths > 0) h.baths--;
  if (h.tax > 0) h.tax--;
}

/** Daily house update. */
export function updateHouse(game, b) {
  const h = b.house;
  decayAccess(h);
  if (h.pop <= 0) {
    // Everyone left: revert to a vacant lot (unless settlers are on the way).
    if (h.tier > 0 && h.incoming <= 0) {
      h.tier = 0;
      game.markDirty('des');
      game.events.emit('houseChanged', b);
    }
    h.blocked = null;
    return;
  }
  if (h.tier === 0) h.tier = 1; // settlers arrived
  const lv = evaluateHouse(game, b);
  h.des = lv.des;
  h.water = lv.water;
  h.levels = lv;

  const cur = checkTier(h.tier, lv, CONFIG.DEVOLVE_DES_TOLERANCE);
  if (!cur.ok) {
    h.evolveDays = 0;
    h.devolveDays++;
    h.blocked = cur.missing;
    h.devolving = true;
    if (h.devolveDays >= CONFIG.DEVOLVE_DELAY_DAYS) devolve(game, b);
    return;
  }
  h.devolveDays = 0;
  h.devolving = false;
  if (h.tier >= MAX_TIER) {
    h.blocked = null;
    return;
  }
  const next = checkTier(h.tier + 1, lv, 0);
  if (!next.ok) {
    h.evolveDays = 0;
    h.blocked = next.missing;
    return;
  }
  const needSize = HOUSE_TIERS[h.tier + 1].size;
  if (needSize > b.size && !findExpansion(game, b, needSize)) {
    h.evolveDays = 0;
    h.blocked = [{ key: 'space', have: b.size, need: needSize }];
    return;
  }
  h.blocked = null;
  h.evolveDays++;
  if (h.evolveDays >= CONFIG.EVOLVE_DELAY_DAYS) evolve(game, b);
}

function evolve(game, b) {
  const h = b.house;
  const needSize = HOUSE_TIERS[h.tier + 1].size;
  if (needSize > b.size && !expandHouse(game, b, needSize)) return;
  h.tier++;
  h.evolveDays = 0;
  game.city.stats.evolutions++;
  game.markDirty('des');
  game.events.emit('houseChanged', b);
  if (h.tier >= 10 && !game.city.flags.firstVilla) {
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
  const cap = houseCapacity(h.tier, b.size);
  if (h.pop > cap) {
    const leaving = h.pop - cap;
    h.pop = cap;
    sendEmigrants(game, b, leaving);
  }
  game.markDirty('des');
  game.events.emit('houseChanged', b);
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

/** Can this tile be absorbed into a growing house? */
function tileAbsorbable(game, x, y, selfId, maxHouseSize) {
  const { map, buildings } = game;
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  const t = map.terrain[i];
  if (t === Terrain.WATER || t === Terrain.ROCK) return false;
  if (map.road[i] || map.aqueduct[i]) return false;
  const id = map.building[i];
  if (!id || id === selfId) return true;
  const other = buildings.get(id);
  return !!(other && other.house && other.size <= maxHouseSize);
}

/**
 * Find the best square block of size `S` containing house `b` where every
 * other tile is empty land or a smaller house fully inside the block.
 * @returns {{x:number,y:number,score:number}|null}
 */
export function findExpansion(game, b, S) {
  const { map, buildings } = game;
  let best = null;
  for (let by = b.y + b.size - S; by <= b.y; by++) {
    for (let bx = b.x + b.size - S; bx <= b.x; bx++) {
      let ok = true;
      let score = 0;
      const absorbed = new Set();
      for (let dy = 0; dy < S && ok; dy++) {
        for (let dx = 0; dx < S && ok; dx++) {
          const x = bx + dx;
          const y = by + dy;
          if (!tileAbsorbable(game, x, y, b.id, S - 1)) { ok = false; break; }
          const id = map.building[map.idx(x, y)];
          if (id && id !== b.id) {
            const o = buildings.get(id);
            // The other house must be completely inside the block.
            if (o.x < bx || o.y < by || o.x + o.size > bx + S || o.y + o.size > by + S) { ok = false; break; }
            if (!absorbed.has(id)) { absorbed.add(id); score += 2 + o.house.tier * 0.1; }
          }
        }
      }
      if (ok && (!best || score > best.score)) best = { x: bx, y: by, score, absorbed };
    }
  }
  return best;
}

/**
 * Grow house `b` in place into an S x S footprint, absorbing neighbors.
 * The house keeps its id so selections and walker targets stay valid.
 */
export function expandHouse(game, b, S) {
  const block = findExpansion(game, b, S);
  if (!block) return false;
  const { map, buildings } = game;
  const h = b.house;
  for (const id of block.absorbed) {
    const o = buildings.get(id);
    if (!o) continue;
    const oh = o.house;
    h.pop += oh.pop;
    h.incoming += oh.incoming;
    for (const f of FOOD_TYPES) h.food[f] += oh.food[f];
    for (const g of HOUSE_GOODS) h.goods[g] += oh.goods[g];
    for (const g of GOD_KEYS) h.religion[g] = Math.max(h.religion[g], oh.religion[g]);
    for (const v in h.ent) h.ent[v] = Math.max(h.ent[v], oh.ent[v]);
    for (const k of ['school', 'library', 'academy', 'barber', 'clinic', 'baths', 'tax']) h[k] = Math.max(h[k], oh[k]);
    b.fireRisk = Math.max(b.fireRisk, o.fireRisk);
    b.damageRisk = Math.max(b.damageRisk, o.damageRisk);
    // Immigrants heading to the absorbed house re-target this one.
    for (const w of game.walkers.values()) {
      if (w.target === id) w.target = b.id;
      if (w.reserve && w.reserve.id === id) w.reserve.id = b.id;
    }
    oh.pop = 0;
    removeBuilding(game, o, 'merge');
  }
  // Re-stamp the footprint.
  for (let dy = 0; dy < b.size; dy++) {
    for (let dx = 0; dx < b.size; dx++) {
      const i = map.idx(b.x + dx, b.y + dy);
      if (map.building[i] === b.id) map.building[i] = 0;
    }
  }
  b.x = block.x;
  b.y = block.y;
  b.size = S;
  for (let dy = 0; dy < S; dy++) {
    for (let dx = 0; dx < S; dx++) {
      const i = map.idx(b.x + dx, b.y + dy);
      map.building[i] = b.id;
      map.rubble[i] = 0;
      if (map.terrain[i] === Terrain.TREES) map.terrain[i] = Terrain.GRASS;
    }
  }
  b.rev = (b.rev || 0) + 1;
  computeAccessRoad(game, b);
  const cap = houseCapacity(h.tier + 1, S);
  if (h.pop > cap) {
    const extra = h.pop - cap;
    h.pop = cap;
    sendEmigrants(game, b, extra);
  }
  map.touch();
  return true;
}

/** Monthly: households eat food and use up goods. */
export function consumeHouse(game, b) {
  const h = b.house;
  if (h.pop <= 0) return;
  let need = h.pop * CONFIG.FOOD_PER_PERSON_MONTH;
  const have = FOOD_TYPES.filter((f) => h.food[f] > 0);
  if (have.length > 0) {
    const share = need / have.length;
    for (const f of have) {
      const n = Math.min(h.food[f], share);
      h.food[f] -= n;
      need -= n;
    }
    for (const f of FOOD_TYPES) {
      if (need <= 0.0001) break;
      const n = Math.min(h.food[f], need);
      h.food[f] -= n;
      need -= n;
    }
  }
  h.hungry = need > 0.01;
  const flow = game.city.foodFlow;
  flow.eaten += h.pop * CONFIG.FOOD_PER_PERSON_MONTH - Math.max(0, need);
  flow.shortfall += Math.max(0, need);
  const tier = HOUSE_TIERS[h.tier];
  const perGood = Math.max(0.25, h.pop / CONFIG.GOODS_PER_HOUSE_PEOPLE);
  for (const g of tier.goods) h.goods[g] = Math.max(0, h.goods[g] - perGood);
}

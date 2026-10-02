/**
 * market.js
 * ----------------------------------------------------------------------------
 * Markets have two walkers:
 *   - the Buyer walks to a granary/warehouse, fills a basket and comes back
 *   - the Vendor roams the streets handing food and goods to homes
 *
 * Homes keep a pantry. Each food type is topped up to ~1.5 months of eating;
 * goods are only handed to homes that need them for their current or next
 * tier (no point selling wine to a tent).
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { FOOD_TYPES, HOUSE_GOODS } from '../data/goods.js';
import { HOUSE_TIERS, MAX_TIER } from '../data/housing.js';
import { spawnWalker } from './entities.js';
import { followPath, goHome } from './movement.js';
import { findSupplier, takeGoods, isStorage } from './storage.js';

/** Does a house want this good (needed now or for its next tier)? */
export function houseWantsGood(h, good) {
  if (h.pop <= 0) return false;
  const cur = HOUSE_TIERS[h.tier];
  const next = HOUSE_TIERS[Math.min(MAX_TIER, h.tier + 1)];
  return cur.goods.includes(good) || next.goods.includes(good);
}

/**
 * Food types a home wants in its pantry: as many as its level, or the next
 * one, needs (tents need none, but a Family Tent stocks up for a Lean-to).
 */
export function foodKindsWanted(h) {
  if (h.pop <= 0) return 0;
  return Math.max(HOUSE_TIERS[h.tier].food, HOUSE_TIERS[Math.min(MAX_TIER, h.tier + 1)].food);
}

/**
 * The food a vendor's visit tops up (vendorSupply): the kinds of food (`pick`,
 * at most `kinds` of them), each up to `target`; null for a home that
 * wants no food. Kinds the home already has come first, as long as the
 * market can top them up or the home still has a month of them; then new
 * kinds the market has, in the order of FOOD_TYPES.
 */
function pantryPlan(market, h) {
  const kinds = foodKindsWanted(h);
  if (kinds <= 0) return null;
  const monthly = (h.pop * CONFIG.FOOD_PER_PERSON_MONTH) / kinds;
  const target = Math.max(1, monthly * 3);
  const held = FOOD_TYPES.filter((f) => keepsKind(market, h, f, monthly));
  const fresh = FOOD_TYPES.filter((f) => !held.includes(f) && market.stock[f] > 0);
  return { kinds, target, pick: [...held, ...fresh].slice(0, kinds) };
}

/** Does a home keep this kind of food (pantryPlan): it has some, and the market can top it up or it still has a month of it? */
function keepsKind(market, h, f, monthly) {
  return h.food[f] > 0.01 && (market.stock[f] > 0 || h.food[f] >= monthly);
}

/** How much of each good a vendor's visit tops a home up to: three months of it. */
function goodsTargetOf(h) {
  return Math.max(2, (h.pop / CONFIG.GOODS_PER_HOUSE_PEOPLE) * 3);
}

/**
 * How badly a home needs this market's vendor (0..1), for his pull at a
 * junction (sim/movement.js): the larger of the share of its food his visit
 * would top up and the shortfall of its worst-stocked good he would bring.
 * Only what the market has counts: a home short of a food the market is out
 * of gains nothing from a visit, so it should not draw the vendor.
 */
export function vendorNeed(market, h) {
  if (!h || h.pop <= 0) return 0;
  let need = 0;
  // pantryPlan's pick without its arrays: a walker weighs every home within
  // reach of the roads ahead at each junction.
  const kinds = foodKindsWanted(h);
  if (kinds > 0) {
    const monthly = (h.pop * CONFIG.FOOD_PER_PERSON_MONTH) / kinds;
    const target = Math.max(1, monthly * 3);
    let picked = 0;
    let short = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const f of FOOD_TYPES) {
        if (picked >= kinds) break;
        const keeps = keepsKind(market, h, f, monthly);
        if (pass === 0 ? !keeps : keeps || market.stock[f] <= 0) continue;
        picked++;
        if (market.stock[f] > 0) short += Math.max(0, target - h.food[f]) / target;
      }
    }
    need = short / kinds;
  }
  const goodsTarget = goodsTargetOf(h);
  for (const g of HOUSE_GOODS) {
    if (market.stock[g] <= 0 || !houseWantsGood(h, g)) continue;
    need = Math.max(need, Math.max(0, goodsTarget - h.goods[g]) / goodsTarget);
  }
  return need;
}

/** Vendor visit: hand food and goods from the market to one house. */
export function vendorSupply(game, market, house) {
  const h = house.house;
  if (!h || h.pop <= 0) return;
  h.lastMarket = game.time.totalDays;
  // A home keeps only the kinds of food its level (or the next) needs, each
  // topped up to three months of its share of the ration, so it rides out
  // gaps between vendor visits (pantryPlan).
  const pantry = pantryPlan(market, h);
  if (pantry) {
    const { pick, target } = pantry;
    for (const f of pick) {
      const have = h.food[f];
      if (have >= target || market.stock[f] <= 0) continue;
      const give = Math.min(market.stock[f], target - have);
      market.stock[f] -= give;
      h.food[f] += give;
      game.city.foodFlow.sold += give;
    }
  }
  const goodsTarget = goodsTargetOf(h);
  for (const g of HOUSE_GOODS) {
    if (market.stock[g] <= 0 || !houseWantsGood(h, g)) continue;
    const have = h.goods[g];
    if (have >= goodsTarget) continue;
    const give = Math.min(market.stock[g], goodsTarget - have);
    market.stock[g] -= give;
    h.goods[g] += give;
  }
}

/**
 * Daily: send the market buyer out when stocks run low.
 * Picks the most depleted item that some storage actually has.
 */
export function updateMarketBuyer(game, market) {
  if (market.accessRoad < 0 || market.efficiency <= 0) return;
  if (market.buyerCooldown > 0) { market.buyerCooldown--; return; }
  for (const id of market.walkers) {
    const w = game.walkers.get(id);
    if (w && w.type === 'buyer') return; // one buyer at a time
  }
  const demand = game.city.goodsDemand || {};
  const wants = [];
  for (const f of FOOD_TYPES) {
    // Fish only when some granary or warehouse holds it: a want nobody can
    // fill would take one of the day's four tries from pottery or furniture.
    if (f === 'fish' && !inStore(game, 'fish')) continue;
    const ratio = market.stock[f] / CONFIG.MARKET_FOOD_CAP;
    if (ratio < 0.6) wants.push({ good: f, ratio });
  }
  for (const g of HOUSE_GOODS) {
    if (!demand[g]) continue;
    // Clothing, likewise: Tenements want it from the day they stand, long
    // before a city may make any, and no partner sells it.
    if (g === 'clothing' && !inStore(game, 'clothing')) continue;
    const ratio = market.stock[g] / CONFIG.MARKET_GOODS_CAP;
    if (ratio < 0.5) wants.push({ good: g, ratio });
  }
  wants.sort((a, b) => a.ratio - b.ratio);
  for (const want of wants.slice(0, 4)) {
    const found = findSupplier(game, market.accessRoad, want.good, 1, 70);
    if (!found) continue;
    const w = spawnWalker(game, 'buyer', market.accessRoad, market, { target: found.id, state: 'fetch', want: want.good, load: {} });
    if (w) followPath(game, w, found.path);
    return;
  }
  market.buyerCooldown = 3; // nothing available, check again later
}

/** Does any granary or warehouse hold some of `good`? */
function inStore(game, good) {
  for (const b of game.buildings.values()) if (isStorage(b) && b.stock[good] > 0) return true;
  return false;
}

/** Buyer reached the storage: fill the basket, then head home. */
export function buyerArrive(game, w) {
  const src = game.buildings.get(w.target);
  const market = game.buildings.get(w.origin);
  if (src && market && isStorage(src)) {
    const isFood = FOOD_TYPES.includes(w.want);
    const cap = isFood ? CONFIG.MARKET_FOOD_CAP : CONFIG.MARKET_GOODS_CAP;
    const load = isFood ? CONFIG.MARKET_BUYER_LOAD : CONFIG.CART_CAPACITY;
    const wanted = Math.min(load, Math.max(0, cap - market.stock[w.want]));
    const got = takeGoods(src, w.want, wanted);
    if (got > 0) w.load[w.want] = got;
    // Grab some of every other food the market is short on while we're here.
    if (src.def.kind === 'granary') {
      for (const f of FOOD_TYPES) {
        if (f === w.want) continue;
        const room = CONFIG.MARKET_FOOD_CAP * 0.6 - market.stock[f];
        if (room <= 0) continue;
        const n = takeGoods(src, f, Math.min(100, room));
        if (n > 0) w.load[f] = (w.load[f] || 0) + n;
      }
    }
  }
  goHome(game, w);
}

/** Buyer is home: unload the basket into market stock. */
export function buyerUnload(game, w) {
  const market = game.buildings.get(w.origin);
  if (!market || !w.load) return;
  for (const [g, n] of Object.entries(w.load)) {
    if (market.stock[g] !== undefined) market.stock[g] += n;
    if (FOOD_TYPES.includes(g)) game.city.foodFlow.toMarket += n;
  }
  w.load = null;
}

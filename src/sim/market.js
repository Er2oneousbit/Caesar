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

/** Vendor visit: hand food and goods from the market to one house. */
export function vendorSupply(game, market, house) {
  const h = house.house;
  if (!h || h.pop <= 0) return;
  h.lastMarket = game.time.totalDays;
  // Each food type is topped up to three months of eating, so houses ride
  // out gaps between vendor visits.
  const monthly = h.pop * CONFIG.FOOD_PER_PERSON_MONTH;
  const target = Math.max(1, monthly * 3);
  for (const f of FOOD_TYPES) {
    const have = h.food[f];
    if (have >= target || market.stock[f] <= 0) continue;
    const give = Math.min(market.stock[f], target - have);
    market.stock[f] -= give;
    h.food[f] += give;
    game.city.foodFlow.sold += give;
  }
  const goodsTarget = Math.max(2, (h.pop / CONFIG.GOODS_PER_HOUSE_PEOPLE) * 3);
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
    const ratio = market.stock[f] / CONFIG.MARKET_FOOD_CAP;
    if (ratio < 0.6) wants.push({ good: f, ratio });
  }
  for (const g of HOUSE_GOODS) {
    if (!demand[g]) continue;
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

/**
 * emperor.js
 * ----------------------------------------------------------------------------
 * The Emperor's demands and gifts.
 *
 * Every so often (REQUEST_INTERVAL_MONTHS) the Emperor asks for a shipment of
 * goods or a sum of money with a deadline. Fulfilling it from the Imperial
 * advisor raises favor; missing the deadline lowers it. The governor can
 * also send gifts from his own savings to buy a little favor (each one
 * within a year buys less). Difficulty (data/difficulty.js)
 * scales how often he asks, how much, and how long the city gets.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { GOODS, formatAmount } from '../data/goods.js';
import { BUILDINGS } from '../data/buildings.js';
import { STABLE_CAPACITY } from '../data/units.js';
import { cityStock, takeFromCity, stablesOf } from './storage.js';
import { transact } from './economy.js';
import { logGoods } from './goodsLedger.js';
import { hasWorkingWharf } from './fishing.js';

/**
 * Cloth goods (not in the original) are asked for only while the city has a
 * building that makes them, as fish only while a wharf works.
 */
const CLOTH_GOODS = new Set(['flax', 'linen', 'clothing']);

/**
 * Goods the city could plausibly supply (it can build the producer). Fish
 * only while a wharf is at work, flax, linen and clothing only while a
 * building that makes them stands: a city without them is never asked for
 * them, and its requests are drawn exactly as before they existed.
 */
function requestableGoods(game) {
  const out = new Set();
  for (const [key, def] of Object.entries(BUILDINGS)) {
    if (!def.produces || !game.isUnlocked(key)) continue;
    if (def.kind === 'wharf' && !hasWorkingWharf(game)) continue;
    if (CLOTH_GOODS.has(def.produces) && !hasBuilding(game, key)) continue;
    // Horses live only at a ranch (data/goods.js keptAt): asked for only while one stands.
    if (GOODS[def.produces]?.keptAt === key && !hasBuilding(game, key)) continue;
    out.add(def.produces);
  }
  // Import-able goods also count if a route could be opened.
  return [...out];
}

/** Does the city have a building of this type (staffed or not)? */
function hasBuilding(game, type) {
  for (const b of game.buildings.values()) if (b.type === type) return true;
  return false;
}

export function scheduleNextRequest(game, first = false) {
  const k = game.difficulty.requestInterval;
  // A new city's first request comes in its third year (FIRST_REQUEST_MONTHS):
  // from month 14, as the later ones come, it caught a town still finding its feet.
  const [a, b] = first ? CONFIG.FIRST_REQUEST_MONTHS : CONFIG.REQUEST_INTERVAL_MONTHS;
  game.city.nextRequestMonth = game.time.totalMonths + game.rng.range(Math.round(a * k), Math.round(b * k));
}

/** Monthly: create new requests and expire old ones. */
export function updateEmperor(game) {
  const c = game.city;
  if (!game.scenario.requests) return;
  const now = game.time.totalMonths;
  if (c.request && now >= c.request.deadline) {
    c.ratings.favor = Math.max(0, c.ratings.favor - 12);
    game.message(`You failed to deliver the Emperor's request for ${describeRequest(c.request)}. Favor has fallen.`, 'bad');
    c.stats.requestsFailed++;
    c.request = null;
    scheduleNextRequest(game);
    return;
  }
  if (c.request || now < c.nextRequestMonth || c.population < CONFIG.REQUEST_MIN_POP) return;
  const goods = requestableGoods(game);
  const useMoney = goods.length === 0 || game.rng.chance(0.3);
  const scale = Math.max(1, Math.round(c.population / 400));
  const { requestSize, requestTime } = game.difficulty;
  const months = Math.round(CONFIG.REQUEST_DEADLINE_MONTHS * requestTime);
  const round50 = (v) => Math.max(50, Math.round(v / 50) * 50);
  if (useMoney) {
    c.request = { kind: 'money', amount: round50((300 + 150 * scale) * requestSize), deadline: now + months };
  } else {
    const good = game.rng.pick(goods);
    const amount = keptCap(game, good, round50(Math.min(2400, 200 + 100 * game.rng.range(1, 2 + scale)) * requestSize));
    c.request = { kind: 'goods', good, amount, deadline: now + months };
  }
  game.message(`The Emperor requests ${describeRequest(c.request)} within ${months} months. Open the Imperial advisor to send it.`, 'imperial');
  game.events.emit('sound', { name: 'fanfare' });
}

/**
 * A request for a good counted by the head (horses: unitSize) is in whole
 * horses, and one for a good kept only at its own building no more than
 * those buildings can hold between them (ranches x STABLE_CAPACITY), so it
 * can always be met. Applied after the draw, so the random sequence is the
 * same as before; other goods pass unchanged.
 */
export function keptCap(game, good, amount) {
  const g = GOODS[good];
  if (g.unitSize) amount = Math.max(g.unitSize, Math.round(amount / g.unitSize) * g.unitSize);
  if (g.keptAt) amount = Math.min(amount, stablesOf(game, good).length * STABLE_CAPACITY);
  return amount;
}

export function describeRequest(r) {
  if (!r) return '';
  if (r.kind === 'money') return `${r.amount} Dn`;
  return GOODS[r.good].unitSize ? formatAmount(r.good, r.amount) : `${r.amount} ${GOODS[r.good].name.toLowerCase()}`;
}

/** Can the current request be sent right now? */
export function canFulfill(game) {
  const r = game.city.request;
  if (!r) return false;
  if (r.kind === 'money') return game.city.treasury >= r.amount;
  return cityStock(game, r.good) >= r.amount;
}

/** Send the requested goods/money. @returns {{ok:boolean, reason?:string}} */
export function fulfillRequest(game) {
  const c = game.city;
  const r = c.request;
  if (!r) return { ok: false, reason: 'There is no request.' };
  if (!canFulfill(game)) return { ok: false, reason: 'You do not have enough in storage yet.' };
  if (r.kind === 'money') transact(game, 'gifts', -r.amount);
  else logGoods(game, r.good, 'used', takeFromCity(game, r.good, r.amount)); // sent to Rome
  c.ratings.favor = Math.min(100, c.ratings.favor + 10);
  c.stats.requestsMet++;
  game.message(`The Emperor thanks you for the ${describeRequest(r)}. Favor has risen.`, 'good');
  c.request = null;
  scheduleNextRequest(game);
  return { ok: true };
}

/**
 * Gifts to the Emperor, paid from the governor's own savings (sim/governor.js),
 * never the treasury. The price grows with what he has saved (`share` of the
 * savings plus `base`), so a rich governor cannot buy favor cheaply, and
 * each gift within a year of the last one pleases the Emperor less:
 * `favor[k]` for the (k+1)th gift since the count last went back to 0, which
 * it does 12 months after the latest gift (counted at each month's end).
 * The original's costs and returns. A gift that would please him no more is
 * refused with the reason, where the original took the money for nothing.
 * Each size has four gifts it rotates through (words only).
 */
export const GIFT_SIZES = Object.freeze([
  { name: 'Modest gift', share: 8, base: 20, favor: [3, 1, 0, 0, 0], items: ['a cask of old wine', 'a pair of hunting hounds', 'a silver drinking cup', 'a basket of figs from the province'] },
  { name: 'Generous gift', share: 4, base: 50, favor: [5, 3, 1, 0, 0], items: ['a bronze statuette of Victory', 'a purple-dyed cloak', 'an ivory writing set', 'a pair of white horses'] },
  { name: 'Lavish gift', share: 2, base: 100, favor: [10, 5, 3, 1, 0], items: ['a gilded chariot', 'a marble bust of the Emperor', 'a golden laurel wreath', 'a chest of pearls'] },
].map((g) => Object.freeze(g)));

/** Months after the latest gift when the Emperor's count of recent gifts goes back to 0. */
export const GIFT_MEMORY_MONTHS = 12;

/**
 * Fresh gift record (city.gifts): gifts since the count was last reset
 * (`recent`), months since the latest, and how many of each size were ever
 * sent (which gift of the four comes next).
 */
export function newGiftState() {
  return { recent: 0, monthsSince: 0, sent: [0, 0, 0] };
}

/** What a gift of this size costs now (Dn from savings). */
export function giftCost(game, size) {
  const g = GIFT_SIZES[size];
  return Math.floor(game.city.governor.savings / g.share) + g.base;
}

/** The favor a gift of this size would bring now. */
export function giftFavor(game, size) {
  const g = GIFT_SIZES[size];
  return g.favor[Math.min(game.city.gifts.recent, g.favor.length - 1)];
}

/** Send a personal gift to the Emperor, from savings. @returns {{ok:boolean, reason?:string, cost?:number, favor?:number}} */
export function sendGift(game, size) {
  const c = game.city;
  const g = GIFT_SIZES[size];
  if (!g) return { ok: false, reason: 'Unknown gift.' };
  const cost = giftCost(game, size);
  const favor = giftFavor(game, size);
  if (favor <= 0) {
    const wait = GIFT_MEMORY_MONTHS - c.gifts.monthsSince;
    return { ok: false, reason: `The Emperor has had ${c.gifts.recent} gifts from you within a year: another ${g.name.toLowerCase()} would please him no more. Gifts count in full again ${wait} month${wait === 1 ? '' : 's'} after your last one.` };
  }
  if (cost > c.governor.savings) return { ok: false, reason: `A ${g.name.toLowerCase()} costs ${cost} Dn and your savings hold ${c.governor.savings} Dn.` };
  c.governor.savings -= cost;
  const item = g.items[c.gifts.sent[size] % g.items.length];
  c.gifts.sent[size]++;
  c.gifts.recent++;
  c.gifts.monthsSince = 0;
  c.ratings.favor = Math.min(100, c.ratings.favor + favor);
  game.message(`Your gift of ${item} (${cost} Dn from your savings) delights the Emperor (+${favor} favor).`, 'good');
  return { ok: true, cost, favor };
}

/** Monthly: a year after the latest gift, the Emperor's count of recent gifts starts again. */
export function giftsMonth(game) {
  const gf = game.city.gifts;
  if (gf.recent <= 0) return;
  gf.monthsSince++;
  if (gf.monthsSince >= GIFT_MEMORY_MONTHS) {
    gf.recent = 0;
    gf.monthsSince = 0;
  }
}

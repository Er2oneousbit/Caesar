/**
 * emperor.js
 * ----------------------------------------------------------------------------
 * The Emperor's demands and gifts.
 *
 * Every so often (REQUEST_INTERVAL_MONTHS) the Emperor asks for a shipment of
 * goods or a sum of money with a deadline. Fulfilling it from the Imperial
 * advisor raises favor; missing the deadline lowers it. The player can also
 * send personal gifts to buy a little favor. Difficulty (data/difficulty.js)
 * scales how often he asks, how much, and how long the city gets.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { GOODS } from '../data/goods.js';
import { BUILDINGS } from '../data/buildings.js';
import { cityStock, takeFromCity } from './storage.js';
import { transact } from './economy.js';
import { logGoods } from './goodsLedger.js';

/** Goods the city could plausibly supply (it can build the producer). */
function requestableGoods(game) {
  const out = new Set();
  for (const [key, def] of Object.entries(BUILDINGS)) {
    if (!def.produces || !game.isUnlocked(key)) continue;
    out.add(def.produces);
  }
  // Import-able goods also count if a route could be opened.
  return [...out];
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
    const amount = round50(Math.min(2400, 200 + 100 * game.rng.range(1, 2 + scale)) * requestSize);
    c.request = { kind: 'goods', good, amount, deadline: now + months };
  }
  game.message(`The Emperor requests ${describeRequest(c.request)} within ${months} months. Open the Imperial advisor to send it.`, 'imperial');
  game.events.emit('sound', { name: 'fanfare' });
}

export function describeRequest(r) {
  if (!r) return '';
  return r.kind === 'money' ? `${r.amount} Dn` : `${r.amount} ${GOODS[r.good].name.toLowerCase()}`;
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

export const GIFT_SIZES = [
  { name: 'Modest gift', cost: 150, favor: 2 },
  { name: 'Generous gift', cost: 500, favor: 5 },
  { name: 'Lavish gift', cost: 1500, favor: 12 },
];

/** Send a personal gift to the Emperor. */
export function sendGift(game, size) {
  const c = game.city;
  const g = GIFT_SIZES[size];
  if (!g) return { ok: false, reason: 'Unknown gift.' };
  if (c.giftCooldown > 0) return { ok: false, reason: `The Emperor received a gift recently. Wait ${c.giftCooldown} more months.` };
  if (c.treasury < g.cost && !game.cheats.freeBuild) return { ok: false, reason: 'Not enough money.' };
  transact(game, 'gifts', -g.cost);
  c.ratings.favor = Math.min(100, c.ratings.favor + g.favor);
  c.giftCooldown = 6;
  game.message(`Your ${g.name.toLowerCase()} delights the Emperor (+${g.favor} favor).`, 'good');
  return { ok: true };
}

/**
 * prices.js
 * ----------------------------------------------------------------------------
 * What a good costs with one trade partner this year (Colonia's own rules: in
 * the original every partner paid one price table, changed only by scripted
 * events). Pure: it reads the scenario, the map's seed and the date, never
 * game state, so nothing here is saved and a loaded game has the same prices.
 *
 *   price = base (data/goods.js buy or sell) x province market x year drift
 *           x distance factor x scheduled changes, rounded to whole denarii
 *           (per 100 units)
 *
 * Scheduled changes
 *   A mission may schedule price changes (data/events.js priceChanges: the
 *   original's scripted price events): from a month of a given year, drawn
 *   from the seed, a good costs a share more or less with every partner,
 *   both ways, for good. Pure like the rest; sim/events.js tells the player
 *   in that month.
 *
 * Distance
 *   The province's partners are ranked by the length of their route from its
 *   site (data/empireRoutes.js routePath: the same length the traders' trip
 *   uses). The nearest trades at base prices, the farthest at
 *   TRADE_DISTANCE_PREMIUM more, the others in proportion to their length
 *   between the two; a province with one partner (or all at one length) has
 *   only base prices. It works both ways: a far partner's goods cost more to
 *   bring in, and a far market pays more for goods that are rare there.
 *
 * Province market
 *   A mission may set its own market: scenario `market: { good: factor }`,
 *   what its land and history make cheap (below 1) or dear (above 1) there,
 *   with every partner and both ways. The sandbox has none.
 *
 * Year drift
 *   Each good's price moves at each New Year: last year's drift pulled back
 *   toward 1 (PRICE_DRIFT_PULL), plus a step of up to PRICE_DRIFT_STEP either
 *   way, never beyond PRICE_DRIFT_MAX. The first year is at 1. Each step is
 *   drawn from the map's seed, the year and the good on a stream of its own
 *   (as sim/tradeDemand.js draws its months): the game's random stream is
 *   never touched, so a city that trades nothing plays exactly as before.
 *   Years count from the mission's start (game.time.totalMonths), so a load
 *   gives the same drift.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { RNG } from '../core/rng.js';
import { GOODS } from '../data/goods.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';
import { siteIdOf } from '../data/sites.js';
import { routePath } from '../data/empireRoutes.js';
import { partnerBuys } from './tradeDemand.js';
import { missionEvents, eventMonth } from '../data/events.js';

/** The base price a side reads: 'buy' (the city imports and pays) or 'sell' (it exports and earns). */
const BASE_FIELD = Object.freeze({ buy: 'buy', sell: 'sell' });

/** The scenario's partners that exist, in its order. */
function partnersOf(scenario) {
  return (scenario?.partners || []).filter((id) => Object.hasOwn(TRADE_PARTNERS, id));
}

const distCache = new Map();

/**
 * Every partner's distance factor in a scenario: { id: factor }, 1 for the
 * nearest (by route length from the province's site), 1 + the premium for the
 * farthest, in proportion between. All 1 with one partner.
 */
export function distanceFactors(scenario) {
  const site = siteIdOf(scenario);
  const ids = partnersOf(scenario);
  const key = `${site}|${ids.join(',')}`;
  let out = distCache.get(key);
  if (out) return out;
  const lens = ids.map((id) => routePath(site, id).len);
  const lo = Math.min(...lens);
  const hi = Math.max(...lens);
  out = {};
  ids.forEach((id, i) => { out[id] = hi > lo ? 1 + (CONFIG.TRADE_DISTANCE_PREMIUM * (lens[i] - lo)) / (hi - lo) : 1; });
  distCache.set(key, Object.freeze(out));
  return out;
}

/** One partner's distance factor (1 for a partner the scenario does not list). */
export function distanceFactor(scenario, partnerId) {
  return distanceFactors(scenario)[partnerId] ?? 1;
}

/** The province's market factor for a good (1 where it sets none). */
export function marketFactor(scenario, good) {
  const f = scenario?.market?.[good];
  return Number.isFinite(f) && f > 0 ? f : 1;
}

const driftCache = new Map();

/** One New Year's step for a good: up to PRICE_DRIFT_STEP either way, from the seed, year and good alone. */
function driftStep(seed, good, year) {
  return CONFIG.PRICE_DRIFT_STEP * (2 * new RNG(`${seed}:price:${good}:${year}`).next() - 1);
}

/**
 * A good's year drift in mission year `year` (0 = the first, at 1): each
 * year's is the last pulled back toward 1 plus a seeded step, held within
 * PRICE_DRIFT_MAX of 1.
 */
export function yearDrift(seed, good, year) {
  const y = Math.max(0, Math.floor(year) || 0);
  const key = `${seed}|${good}`;
  let walk = driftCache.get(key);
  if (!walk) driftCache.set(key, (walk = [1]));
  const max = CONFIG.PRICE_DRIFT_MAX;
  while (walk.length <= y) {
    const prev = walk[walk.length - 1];
    const d = 1 + CONFIG.PRICE_DRIFT_PULL * (prev - 1) + driftStep(seed, good, walk.length);
    walk.push(Math.min(1 + max, Math.max(1 - max, d)));
  }
  return walk[y];
}

/** The mission year a game is in (0 = its first). */
export function missionYear(game) {
  return Math.floor(game.time.totalMonths / CONFIG.MONTHS_PER_YEAR);
}

/**
 * A mission's scheduled price changes for a good in force by mission month
 * `month` (data/events.js priceChanges: each from a month of its year drawn
 * from the seed, for good), multiplied: 1.2 after "+20%". 1 where none is
 * due (the sandbox has none).
 */
export function scheduledFactor(scenario, seed, month, good) {
  let f = 1;
  missionEvents(scenario).priceChanges.forEach((c, k) => {
    if (c.good === good && Number.isFinite(c.change) && eventMonth(seed, 'price', k, c.year) <= month) f *= Math.max(0.1, 1 + c.change);
  });
  return f;
}

/**
 * A good's price with a partner: base x market x drift x distance x the
 * mission's scheduled changes, whole Dn per 100 units (at least 1). `side`:
 * 'buy' (an import: what the city pays) or 'sell' (an export: what it
 * earns). `month` (game.time.totalMonths) says which scheduled changes are
 * in force; by default those of the year's first month.
 */
export function priceWith(scenario, seed, year, partnerId, good, side, month = year * CONFIG.MONTHS_PER_YEAR) {
  const g = GOODS[good];
  if (!g) return 0;
  const base = g[BASE_FIELD[side] || 'buy'];
  return Math.max(1, Math.round(base * marketFactor(scenario, good) * yearDrift(seed, good, year) * distanceFactor(scenario, partnerId) * scheduledFactor(scenario, seed, month, good)));
}

/**
 * A good's price with a partner in this game now (priceWith). With the
 * `events=off` flag (no events of any kind, sim/events.js) no scheduled
 * change is in force: month -1 comes before them all.
 */
export function tradePrice(game, partnerId, good, side) {
  const month = game.flags?.events === 'off' ? -1 : game.time.totalMonths;
  return priceWith(game.scenario, game.seed, missionYear(game), partnerId, good, side, month);
}

/**
 * The partners that deal in a good one way now: those that sell it (for
 * 'buy', an import) or buy it this year (for 'sell', an export).
 */
function dealers(game, good, side) {
  return partnersOf(game.scenario).filter((id) => (side === 'buy' ? TRADE_PARTNERS[id].sells[good] > 0 : partnerBuys(game, id)[good] > 0));
}

/** { lo, hi } of a good's price one way across the partners dealing in it, or null when none does. */
export function priceRange(game, good, side) {
  const prices = dealers(game, good, side).map((id) => tradePrice(game, id, good, side));
  if (!prices.length) return null;
  return { lo: Math.min(...prices), hi: Math.max(...prices) };
}

/** "210" or "210 to 240" (a range's text). */
export function rangeText(r) {
  if (!r) return '';
  return r.lo === r.hi ? `${r.lo}` : `${r.lo} to ${r.hi}`;
}

/** A factor as a signed percent: 1.12 -> "+12%", 0.9 -> "-10%". */
export function percentText(f) {
  const p = Math.round((f - 1) * 100);
  return `${p >= 0 ? '+' : '-'}${Math.abs(p)}%`;
}

/** Is a list of goods (by key) one thing or many: "wine is", but "olives are" and "wine and oil are". */
function plural(goods) {
  return goods.length > 1 || /s$/.test(GOODS[goods[0]].name);
}

/**
 * The province market in words, or '' for none: "Wine (-10%) and pottery
 * (-10%) are cheap here; iron (+10%) is dear, to buy and to sell." Cheap
 * goods first, the biggest difference first.
 */
export function marketLine(scenario) {
  const entries = Object.entries(scenario?.market || {}).filter(([g, f]) => GOODS[g] && Number.isFinite(f) && f !== 1);
  if (!entries.length) return '';
  const name = (g) => GOODS[g].name.toLowerCase();
  const words = (list) => {
    const each = list.map(([g, f]) => `${name(g)} (${percentText(f)})`);
    return each.length > 1 ? `${each.slice(0, -1).join(', ')} and ${each.at(-1)}` : each[0];
  };
  const part = (list, word) => (list.length ? `${words(list)} ${plural(list.map(([g]) => g)) ? 'are' : 'is'} ${word}` : '');
  const cheap = entries.filter(([, f]) => f < 1).sort((a, b) => a[1] - b[1]);
  const dear = entries.filter(([, f]) => f > 1).sort((a, b) => b[1] - a[1]);
  const [first, second] = [part(cheap, 'cheap'), part(dear, 'dear')].filter(Boolean);
  const text = `${first} here${second ? `; ${second}` : ''}`;
  return `${text[0].toUpperCase()}${text.slice(1)}, to buy and to sell.`;
}

/**
 * A partner's prices for some goods, in a line for the panels: "you pay wine
 * 230, fruit 52; you earn pottery 160" (per 100 units). `imports`: goods it
 * sells the city; `exports`: goods it buys from it. '' when both are empty.
 */
export function dealPricesText(game, partnerId, imports, exports) {
  const list = (goods, side) => goods.map((g) => `${GOODS[g].name.toLowerCase()} ${tradePrice(game, partnerId, g, side)}`).join(', ');
  const parts = [];
  if (imports.length) parts.push(`you pay ${list(imports, 'buy')}`);
  if (exports.length) parts.push(`you earn ${list(exports, 'sell')}`);
  return parts.join('; ');
}

/**
 * A partner's distance in prices, for its route card: "Prices +12% for the
 * distance, to buy and to sell." or, for the nearest, "Base prices: your
 * nearest partner."
 */
export function distanceNote(scenario, partnerId) {
  const f = distanceFactor(scenario, partnerId);
  if (f <= 1) return partnersOf(scenario).length > 1 ? 'Base prices: your nearest partner.' : 'Base prices: your only partner.';
  if (Math.round((f - 1) * 100) <= 0) return 'Prices barely above base: nearly as near as your nearest partner.';
  return `Prices ${percentText(f)} for the distance, to buy and to sell.`;
}

/** The goods the province's partners deal in either way now. */
function tradedGoods(game) {
  const out = new Set();
  for (const id of partnersOf(game.scenario)) {
    for (const g of Object.keys(TRADE_PARTNERS[id].sells)) out.add(g);
    for (const g of Object.keys(partnerBuys(game, id))) out.add(g);
  }
  return [...out];
}

/** A change this small is not news (the drift moves every good a little each year). */
const NEWS_MIN = 0.04;

/**
 * This New Year's biggest moves among the goods the province trades: up to
 * two rises and two falls of at least NEWS_MIN, each { good, change } (0.08:
 * 8% dearer than last year), the largest first.
 */
export function priceMoves(game, year = missionYear(game)) {
  if (year < 1) return { rises: [], falls: [] };
  const moves = tradedGoods(game).map((good) => ({ good, change: yearDrift(game.seed, good, year) / yearDrift(game.seed, good, year - 1) - 1 }));
  return {
    rises: moves.filter((m) => m.change >= NEWS_MIN).sort((a, b) => b.change - a.change).slice(0, 2),
    falls: moves.filter((m) => m.change <= -NEWS_MIN).sort((a, b) => a.change - b.change).slice(0, 2),
  };
}

/** "Oil (+9%) fetches more this year; timber (-7%) is cheaper.", or null when nothing moved much. */
export function priceNewsText(game, year = missionYear(game)) {
  const { rises, falls } = priceMoves(game, year);
  if (!rises.length && !falls.length) return null;
  const list = (ms) => ms.map((m) => `${GOODS[m.good].name.toLowerCase()} (${percentText(1 + m.change)})`).join(' and ');
  const parts = [];
  const many = (ms) => plural(ms.map((m) => m.good));
  if (rises.length) parts.push(`${list(rises)} ${many(rises) ? 'fetch' : 'fetches'} more this year`);
  if (falls.length) parts.push(`${list(falls)} ${many(falls) ? 'are' : 'is'} cheaper`);
  const text = parts.join('; ');
  return `New Year's prices: ${text}.`;
}

/** New Year: tell the player the biggest price moves (nothing changes here: prices follow the date). */
export function pricesNewYear(game) {
  if (!partnersOf(game.scenario).length) return;
  const text = priceNewsText(game);
  if (text) game.message(text, 'info');
}

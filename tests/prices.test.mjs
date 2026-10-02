/**
 * prices.test.mjs - headless tests for trade prices (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Covers sim/prices.js: the distance factor (nearest partner at base, the
 * farthest at the premium, the others by route length; one partner: 1), the
 * province markets of the campaign, the year drift (bounded, seeded, on a
 * stream of its own, the same after a save and load), the New Year news,
 * what a caravan pays and is paid at a far partner both ways (a ship's are in
 * dock.test.mjs), and the words the panels show.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { GOODS, GOOD_KEYS } from '../src/data/goods.js';
import { SCENARIOS, TRADE_PARTNERS, sandboxScenario } from '../src/data/scenarios.js';
import { routePath } from '../src/data/empireRoutes.js';
import { siteIdOf } from '../src/data/sites.js';
import {
  distanceFactors, distanceFactor, marketFactor, yearDrift, priceWith, tradePrice, missionYear, priceRange, rangeText,
  marketLine, priceMoves, priceNewsText, dealPricesText, distanceNote, percentText,
} from '../src/sim/prices.js';
import { setTradeMode, tradeAt, routeKind } from '../src/sim/trade.js';
import { spawnWalker } from '../src/sim/entities.js';
import { buildDemoCity, buildDemoHarbor } from '../src/dev/demoCity.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { newGame } from './helpers.mjs';

log.setLevel('error');

const DAYS_PER_YEAR = CONFIG.DAYS_PER_MONTH * CONFIG.MONTHS_PER_YEAR;
const scenarioOf = (id) => SCENARIOS.find((s) => s.id === id);

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

test('distance: the nearest partner trades at base, the farthest at the premium, the others by route length', () => {
  for (const s of [...SCENARIOS.filter((m) => m.partners.length > 1), sandboxScenario({ site: 'puteoli' })]) {
    const site = siteIdOf(s);
    const f = distanceFactors(s);
    const lens = Object.fromEntries(s.partners.map((id) => [id, routePath(site, id).len]));
    const lo = Math.min(...Object.values(lens));
    const hi = Math.max(...Object.values(lens));
    const nearest = s.partners.find((id) => lens[id] === lo);
    const farthest = s.partners.find((id) => lens[id] === hi);
    assert.equal(f[nearest], 1, `${s.id}: ${nearest}, the nearest, at base`);
    assert.equal(f[farthest], 1 + CONFIG.TRADE_DISTANCE_PREMIUM, `${s.id}: ${farthest}, the farthest, at +25%`);
    for (const id of s.partners) {
      assert.ok(Math.abs(f[id] - (1 + (CONFIG.TRADE_DISTANCE_PREMIUM * (lens[id] - lo)) / (hi - lo))) < 1e-12, `${s.id}: ${id} in proportion`);
    }
  }
  // A middle partner, worked: from the Etruscan coast Aquileia is the
  // nearest, Alexandria the farthest, and Corinthus about 60% of the way.
  const sb = sandboxScenario({});
  assert.equal(distanceFactor(sb, 'aquileia'), 1);
  assert.equal(distanceFactor(sb, 'alexandria'), 1.25);
  const mid = distanceFactor(sb, 'corinthus');
  assert.ok(mid > 1.14 && mid < 1.16, `Corinthus ${mid}`);
  assert.equal(CONFIG.TRADE_DISTANCE_PREMIUM, 0.25);
});

test('distance: one partner (or none listed) trades at base prices', () => {
  const one = { ...scenarioOf('c3'), partners: ['tarraco'] };
  assert.deepEqual(distanceFactors(one), { tarraco: 1 });
  assert.equal(distanceFactor(one, 'tarraco'), 1);
  assert.equal(distanceFactor(scenarioOf('c1'), 'tarraco'), 1, 'not a partner of the province: base');
  assert.equal(distanceNote(one, 'tarraco'), 'Base prices: your only partner.');
});

test('distance raises both ways: a far partner charges more for its goods and pays more for yours', () => {
  const s = scenarioOf('c6p'); // Cosa: Capua the nearest, Alexandria the farthest
  const near = (g, side) => priceWith(s, 'x', 0, 'capua', g, side);
  const far = (g, side) => priceWith(s, 'x', 0, 'alexandria', g, side);
  assert.equal(near('oil', 'buy'), GOODS.oil.buy, 'Capua, the nearest: base');
  assert.equal(far('oil', 'buy'), Math.round(GOODS.oil.buy * 1.25), 'Alexandria charges a quarter more');
  assert.equal(far('oil', 'sell'), Math.round(GOODS.oil.sell * 1.25), 'and pays a quarter more');
  assert.equal(distanceNote(s, 'alexandria'), 'Prices +25% for the distance, to buy and to sell.');
  assert.equal(distanceNote(s, 'capua'), 'Base prices: your nearest partner.');
});

test('no partner pays more for a good than another charges for it the same year (no round trip for profit)', () => {
  for (const s of [...SCENARIOS, sandboxScenario({})]) {
    for (const g of GOOD_KEYS) {
      for (const y of [0, 3]) {
        const buys = s.partners.map((id) => priceWith(s, 'seed', y, id, g, 'buy'));
        const sells = s.partners.map((id) => priceWith(s, 'seed', y, id, g, 'sell'));
        if (buys.length) assert.ok(Math.max(...sells) < Math.min(...buys), `${s.id} ${g} year ${y}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Province markets
// ---------------------------------------------------------------------------

test('every campaign mission that trades has a market of 2 to 4 goods; the sandbox has none', () => {
  for (const s of SCENARIOS) {
    if (!s.partners.length) { assert.equal(s.market, undefined, `${s.id}: no partners, no market`); continue; }
    const entries = Object.entries(s.market || {});
    assert.ok(entries.length >= 2 && entries.length <= 4, `${s.id}: ${entries.length} goods`);
    for (const [g, f] of entries) {
      assert.ok(GOODS[g], `${s.id}: ${g} is a good`);
      assert.ok(f >= 0.8 && f <= 1.3 && f !== 1, `${s.id}: ${g} at ${f}`);
      // Something the province's partners deal in, or the market would never show.
      assert.ok(s.partners.some((id) => TRADE_PARTNERS[id].sells[g] || TRADE_PARTNERS[id].buys[g] || s.demand?.[id]?.[g]), `${s.id}: ${g} is traded there`);
    }
  }
  assert.equal(sandboxScenario({}).market, undefined);
  assert.equal(marketFactor(sandboxScenario({}), 'wine'), 1);
});

test('a province market: wine cheap at Cosa, timber dear in the desert, both ways and with every partner', () => {
  const cosa = scenarioOf('c6p');
  assert.equal(marketFactor(cosa, 'wine'), 0.9);
  assert.equal(priceWith(cosa, 'x', 0, 'capua', 'wine', 'buy'), Math.round(GOODS.wine.buy * 0.9));
  assert.equal(priceWith(cosa, 'x', 0, 'capua', 'wine', 'sell'), Math.round(GOODS.wine.sell * 0.9));
  assert.equal(priceWith(cosa, 'x', 0, 'capua', 'fruit', 'sell'), GOODS.fruit.sell, 'a good the market leaves alone');
  const desert = scenarioOf('c6');
  assert.equal(marketFactor(desert, 'timber'), 1.25);
  assert.equal(priceWith(desert, 'x', 0, 'tarraco', 'timber', 'buy'), Math.round(GOODS.timber.buy * 1.25 * 1.25), 'dear, and Tarraco the farthest');
  assert.equal(marketLine(cosa), 'Wine (-10%) and pottery (-10%) are cheap here; iron (+10%) is dear, to buy and to sell.');
  assert.equal(marketLine(desert), 'Olives (-10%) are cheap here; timber (+25%), wheat (+15%) and vegetables (+15%) are dear, to buy and to sell.');
  assert.equal(marketLine({ market: { timber: 1.25 } }), 'Timber (+25%) is dear here, to buy and to sell.');
  assert.equal(marketLine(sandboxScenario({})), '');
});

// ---------------------------------------------------------------------------
// Year drift
// ---------------------------------------------------------------------------

test('the year drift starts at 1, stays within 15%, is seeded, and pulls back toward 1', () => {
  let lo = Infinity;
  let hi = -Infinity;
  let sum = 0;
  let n = 0;
  for (const seed of ['demo', 'cosa-portus', 'figlina', 42]) {
    for (const g of GOOD_KEYS) {
      assert.equal(yearDrift(seed, g, 0), 1, 'the first year is at base');
      for (let y = 1; y < 200; y++) {
        const d = yearDrift(seed, g, y);
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
        sum += d;
        n++;
        const step = Math.abs(d - yearDrift(seed, g, y - 1));
        assert.ok(step <= CONFIG.PRICE_DRIFT_MAX * CONFIG.PRICE_DRIFT_PULL + CONFIG.PRICE_DRIFT_STEP + 1e-12, `a year's move is bounded (${step})`);
      }
    }
  }
  assert.ok(lo >= 1 - CONFIG.PRICE_DRIFT_MAX && hi <= 1 + CONFIG.PRICE_DRIFT_MAX, `${lo} to ${hi}`);
  assert.ok(lo < 0.9 && hi > 1.1, 'it does move');
  assert.ok(Math.abs(sum / n - 1) < 0.01, `it centres on 1 (mean ${sum / n})`);
  // Seeded: the same seed, year and good give the same drift; another seed another.
  assert.equal(yearDrift('demo', 'oil', 7), yearDrift('demo', 'oil', 7));
  const a = GOOD_KEYS.map((g) => yearDrift('demo', g, 3));
  const b = GOOD_KEYS.map((g) => yearDrift('other', g, 3));
  assert.notDeepEqual(a, b);
});

test("the year drift never touches the game's random stream", () => {
  const game = newGame({ seed: 'drift-rng' });
  const before = JSON.stringify(game.rng.getState());
  for (let y = 0; y < 30; y++) for (const g of GOOD_KEYS) for (const id of game.scenario.partners) priceWith(game.scenario, game.seed, y, id, g, 'buy');
  for (let y = 1; y < 30; y++) priceNewsText(game, y);
  assert.equal(JSON.stringify(game.rng.getState()), before);
});

test('prices follow the date: a New Year moves them, a save and load keeps them, and the news names the biggest moves', () => {
  const game = newGame({ seed: 'drift-save' });
  const news = [];
  game.events.on('message', (m) => { if (m.text.startsWith("New Year's prices")) news.push(m.text); });
  const all = (g) => game.scenario.partners.flatMap((id) => GOOD_KEYS.map((k) => [tradePrice(g, id, k, 'buy'), tradePrice(g, id, k, 'sell')]));
  const year0 = all(game);
  game.runDays(DAYS_PER_YEAR);
  assert.equal(missionYear(game), 1);
  const year1 = all(game);
  assert.notDeepEqual(year1, year0, 'the New Year moved prices');
  assert.equal(news.length, 1, 'one message at New Year');
  assert.equal(news[0], priceNewsText(game, 1));
  const { rises, falls } = priceMoves(game, 1);
  for (const m of [...rises, ...falls]) assert.ok(news[0].includes(GOODS[m.good].name.toLowerCase()), `${m.good} named`);
  // Worked: the drift is the same as from the seed alone.
  assert.equal(tradePrice(game, 'capua', 'oil', 'buy'), priceWith(game.scenario, game.seed, 1, 'capua', 'oil', 'buy'));
  // A save and load: the same prices, the same drift next year.
  const copy = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  assert.deepEqual(all(copy), year1);
  game.runDays(DAYS_PER_YEAR);
  copy.runDays(DAYS_PER_YEAR);
  assert.deepEqual(all(copy), all(game));
});

test('the New Year news: rises and falls of at least 4%, two each at most, in words', () => {
  const game = newGame({ seed: 'drift-news' });
  for (let y = 1; y < 20; y++) {
    const { rises, falls } = priceMoves(game, y);
    assert.ok(rises.length <= 2 && falls.length <= 2);
    for (const m of rises) assert.ok(m.change >= 0.04);
    for (const m of falls) assert.ok(m.change <= -0.04);
    const text = priceNewsText(game, y);
    if (!rises.length && !falls.length) assert.equal(text, null);
    else assert.match(text, /^New Year's prices: .*(fetch|cheaper).*\.$/);
  }
  assert.deepEqual(priceMoves(game, 0), { rises: [], falls: [] }, 'no news in the first year');
  assert.equal(percentText(1.087), '+9%');
  assert.equal(percentText(0.93), '-7%');
});

// ---------------------------------------------------------------------------
// Money at a far partner
// ---------------------------------------------------------------------------

test("a caravan from a far partner pays more for the city's exports and charges more for its imports", () => {
  const game = newGame({ type: 'coast', seed: 'beach' });
  const res = buildDemoCity(game, { level: 1 });
  assert.ok(res.ok, res.reason);
  const { warehouse: wh } = buildDemoHarbor(game, res.center);
  wh.efficiency = 1;
  // From the Etruscan coast Tarraco is the farthest land partner.
  const land = game.scenario.partners.filter((id) => routeKind(id) === 'land');
  const partner = land.reduce((a, b) => (distanceFactor(game.scenario, b) > distanceFactor(game.scenario, a) ? b : a));
  assert.equal(partner, 'tarraco');
  assert.ok(distanceFactor(game.scenario, partner) > 1.08);
  for (const k of Object.keys(wh.stock)) wh.stock[k] = 0;
  wh.stock.pottery = 400;
  for (const g of Object.keys(game.city.trade.settings)) setTradeMode(game, g, 'none');
  setTradeMode(game, 'pottery', 'export', 0);
  setTradeMode(game, 'timber', 'import', 300);
  wh.orders.timber = 'accept';
  game.city.treasury = 10000;
  const sell = tradePrice(game, partner, 'pottery', 'sell');
  const buy = tradePrice(game, partner, 'timber', 'buy');
  assert.ok(sell > GOODS.pottery.sell, `pottery sells for ${sell}, more than base ${GOODS.pottery.sell}`);
  assert.ok(buy > GOODS.timber.buy, `timber costs ${buy}, more than base ${GOODS.timber.buy}`);
  const out = tradeAt(game, partner, wh);
  assert.equal(out.sold.pottery, 400);
  assert.equal(out.bought.timber, 300);
  assert.equal(out.earned, Math.round((sell * 400) / 100));
  assert.equal(out.spent, Math.round((buy * 300) / 100));
  assert.equal(game.city.treasury, 10000 + out.earned - out.spent);
});

test("a far caravan sells only what the city can pay for at its own price, not the base price", () => {
  const game = newGame({ type: 'coast', seed: 'beach' });
  const res = buildDemoCity(game, { level: 1 });
  assert.ok(res.ok, res.reason);
  const { warehouse: wh } = buildDemoHarbor(game, res.center);
  wh.efficiency = 1;
  for (const k of Object.keys(wh.stock)) wh.stock[k] = 0;
  for (const g of Object.keys(game.city.trade.settings)) setTradeMode(game, g, 'none');
  setTradeMode(game, 'timber', 'import', 300);
  wh.orders.timber = 'accept';
  const price = tradePrice(game, 'tarraco', 'timber', 'buy');
  assert.ok(price > GOODS.timber.buy);
  game.city.treasury = price - 1; // a lot of 100 at the base price, not at Tarraco's
  assert.deepEqual(tradeAt(game, 'tarraco', wh).bought, {});
  assert.equal(game.city.treasury, price - 1);
  game.city.treasury = price;
  assert.deepEqual(tradeAt(game, 'tarraco', wh).bought, { timber: 100 });
  assert.equal(game.city.treasury, 0);
});

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

test('the panels name each partner\'s prices, and the Trade advisor the range across partners', async () => {
  const { walkerInfo } = await import('../src/ui/walkerTalk.js');
  const game = newGame({ type: 'coast', seed: 'beach' });
  const s = game.scenario;
  // Wine: Massilia, Capua and Rhodus sell it, at their own prices.
  const sellers = s.partners.filter((id) => TRADE_PARTNERS[id].sells.wine);
  const prices = sellers.map((id) => tradePrice(game, id, 'wine', 'buy'));
  assert.deepEqual(priceRange(game, 'wine', 'buy'), { lo: Math.min(...prices), hi: Math.max(...prices) });
  assert.ok(Math.max(...prices) > Math.min(...prices), 'partners differ');
  assert.equal(rangeText(priceRange(game, 'wine', 'buy')), `${Math.min(...prices)} to ${Math.max(...prices)}`);
  assert.equal(rangeText({ lo: 5, hi: 5 }), '5');
  assert.equal(priceRange(game, 'fish', 'buy'), null, 'nobody sells fish');
  assert.equal(dealPricesText(game, 'alexandria', ['wheat'], ['wine']), `you pay wheat ${tradePrice(game, 'alexandria', 'wheat', 'buy')}; you earn wine ${tradePrice(game, 'alexandria', 'wine', 'sell')}`);
  assert.equal(dealPricesText(game, 'alexandria', [], []), '');
  // A caravan on its way says its prices for what it comes to buy and sell.
  for (const g of Object.keys(game.city.trade.settings)) setTradeMode(game, g, 'none');
  setTradeMode(game, 'pottery', 'export', 0);
  setTradeMode(game, 'timber', 'import', 400);
  const road = [...game.map.road.keys()].find((i) => game.map.road[i]) ?? 0;
  const w = spawnWalker(game, 'caravan', road, null, { partner: 'tarraco', target: 0, state: 'toWarehouse' });
  const row = Object.fromEntries(walkerInfo(game, w).rows)['Prices this year (per 100)'];
  assert.equal(row, `you pay timber ${tradePrice(game, 'tarraco', 'timber', 'buy')}; you earn pottery ${tradePrice(game, 'tarraco', 'pottery', 'sell')}`);
});

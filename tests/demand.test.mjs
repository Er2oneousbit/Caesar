/**
 * demand.test.mjs - headless tests for what trade partners buy (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * A mission may set what a partner buys a year on the original's tiers
 * (scenario `demand`) and schedule changes to it (`demandChanges`); a route
 * busier than its traders carry at the usual pace sends them more often
 * (sim/tradeDemand.js). None of it is saved: it is worked out from the
 * scenario and the date. The first seven missions set none of it, so their
 * trade is what it always was.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { Game } from '../src/core/game.js';
import { SCENARIOS, TRADE_PARTNERS, sandboxScenario } from '../src/data/scenarios.js';
import { spawnWalker } from '../src/sim/entities.js';
import { openRoute, setTradeMode, caravanArrive, tradeAt, routeKind } from '../src/sim/trade.js';
import {
  DEMAND_TIERS, buysInForce, partnerBuys, demandChangeMonth, demandChangeAt, visitInterval, visitFactor, carryPerYear, routeInterval, routeVolume,
} from '../src/sim/tradeDemand.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { empireTravelers, tripDays } from '../src/ui/empireMap.js';
import { walkerInfo } from '../src/ui/walkerTalk.js';
import { buildDemoCity, buildDemoHarbor } from '../src/dev/demoCity.js';

log.setLevel('error');

/** A game at month `month` of a mission (a stand-in: buysInForce reads only these). */
const at = (scenario, month, seed = scenario.map.seed) => ({ scenario, seed, time: { totalMonths: month } });

/** A sandbox with a mission's demand fields (a sandbox save carries its scenario in full). */
function demandGame({ demand, demandChanges, seed = 'demand-test', type = 'coast', mapSeed = 'beach' } = {}) {
  const scenario = { ...sandboxScenario({ size: 64, type, seed: mapSeed, invasions: 'none' }), demand, demandChanges };
  return new Game({ scenario, flags: { unlockall: true, money: 50000, seed } });
}

test('demand: the first seven missions buy what the partners\' tables say, all mission long, at the usual pace', () => {
  for (const s of SCENARIOS) {
    assert.equal(s.demand, undefined, `${s.id}: no demand of its own`);
    assert.equal(s.demandChanges, undefined, `${s.id}: no demand changes`);
    for (const id of s.partners) {
      for (let month = 0; month <= (s.paceYears + 3) * 12; month += 5) {
        assert.deepEqual(partnerBuys(at(s, month), id), TRADE_PARTNERS[id].buys, `${s.id} ${id} month ${month}`);
      }
      // The busy-route rule leaves every one of their routes at its pace:
      // the busiest, Aquileia's caravans (3,200 a year) and Corinthus's ships
      // (5,200), are at 92% and 90% of what their traders carry.
      const usual = routeKind(id) === 'sea' ? CONFIG.SHIP_INTERVAL_DAYS : CONFIG.CARAVAN_INTERVAL_DAYS;
      assert.deepEqual(routeInterval(at(s, 0), id), [...usual], `${s.id} ${id}: its usual interval`);
    }
  }
  assert.ok(routeVolume(TRADE_PARTNERS.aquileia.buys, TRADE_PARTNERS.aquileia.sells) / carryPerYear('land') < 0.93);
  assert.ok(routeVolume(TRADE_PARTNERS.corinthus.buys, TRADE_PARTNERS.corinthus.sells) / carryPerYear('sea') < 0.91);
  // Urbs Magna keeps the nine partners it always had; the sandbox has all twelve.
  assert.equal(SCENARIOS.find((s) => s.id === 'c7').partners.length, 9);
  assert.ok(!SCENARIOS.some((s) => s.partners.some((id) => ['gades', 'rhodus', 'delos'].includes(id))));
  assert.equal(sandboxScenario().partners.length, 12);
});

test('demand: a mission\'s own tiers replace the table, and a change comes in its year, in a month from Martius to October drawn from the seed', () => {
  assert.deepEqual(DEMAND_TIERS, [0, 1500, 2500, 4000]);
  const s = { map: { seed: 'cosa' }, demand: { corinthus: { wine: 2500 } }, demandChanges: [{ year: 3, partner: 'corinthus', good: 'wine', to: 4000 }] };
  const when = demandChangeAt('cosa', s.demandChanges[0], 0);
  assert.equal(when, 24 + demandChangeMonth('cosa', 0));
  assert.equal(demandChangeMonth('cosa', 0), demandChangeMonth('cosa', 0), 'the same month every run');
  assert.equal(when, 33, 'October of year 3 for this seed');
  assert.equal(buysInForce(s, 'cosa', 'corinthus', 0).wine, 2500, 'the mission\'s tier from the start');
  assert.equal(buysInForce(s, 'cosa', 'corinthus', when - 1).wine, 2500);
  assert.equal(buysInForce(s, 'cosa', 'corinthus', when).wine, 4000, 'from the month of the change');
  assert.equal(buysInForce(s, 'cosa', 'corinthus', when).wheat, TRADE_PARTNERS.corinthus.buys.wheat, 'the rest from its table');
  assert.deepEqual(buysInForce(s, 'cosa', 'alexandria', when), TRADE_PARTNERS.alexandria.buys, 'other partners untouched');
  // Over many maps the month is always Martius to October, and every one of them comes up.
  const months = new Set();
  for (let k = 0; k < 300; k++) {
    const m = demandChangeMonth(`seed-${k}`, k % 3);
    assert.ok(m >= 2 && m <= 9, `month ${m}`);
    months.add(m);
  }
  assert.equal(months.size, 8);
});

test('demand: a stopped good is no longer bought, and a demanded one is, by caravans', () => {
  const game = demandGame({
    demand: { capua: { wine: 1500 } },
    demandChanges: [{ year: 1, partner: 'capua', good: 'pottery', to: 0 }],
  });
  const res = buildDemoCity(game, { level: 1 });
  assert.ok(res.ok, res.reason);
  const { warehouse: wh } = buildDemoHarbor(game, res.center);
  assert.ok(wh && wh.accessRoad >= 0);
  wh.efficiency = 1;
  const stop = demandChangeAt(game.seed, game.scenario.demandChanges[0], 0);
  const trade = (month) => {
    game.time.totalMonths = month;
    game.city.trade.routes.capua.sold = {};
    for (const k of Object.keys(wh.stock)) wh.stock[k] = 0;
    wh.stock.pottery = 400;
    wh.stock.wine = 400;
    for (const g of Object.keys(game.city.trade.settings)) setTradeMode(game, g, 'none');
    setTradeMode(game, 'pottery', 'export', 0);
    setTradeMode(game, 'wine', 'export', 0);
    return tradeAt(game, 'capua', wh).sold;
  };
  // Capua's own table buys pottery, never wine: this mission adds the wine.
  assert.ok(!TRADE_PARTNERS.capua.buys.wine && TRADE_PARTNERS.capua.buys.pottery > 0);
  assert.deepEqual(trade(stop - 1), { pottery: 400, wine: 400 });
  assert.deepEqual(trade(stop), { wine: 400 }, 'no pottery once Capua stops buying it');
  assert.equal(partnerBuys(game, 'capua').pottery, undefined);
  // A caravan says what it comes for: the demand in force.
  const w = spawnWalker(game, 'caravan', wh.accessRoad, null, { partner: 'capua', target: wh.id, state: 'toWarehouse' });
  const comes = walkerInfo(game, w).rows.find(([k]) => k === 'Comes to buy')?.[1];
  assert.match(comes, /wine/i);
  assert.doesNotMatch(comes, /pottery/i);
  caravanArrive(game, w);
});

test('demand: two changes of one good take effect in the order of their months, not of the list', () => {
  // For seed s0 the first entry falls in month 21 and the second in month
  // 14: the wine stops in month 14 and rises to 4,000 in month 21, for good.
  // (Applied in list order, the stop undid the rise, which was still told.)
  const s = { demandChanges: [{ year: 2, partner: 'corinthus', good: 'wine', to: 4000 }, { year: 2, partner: 'corinthus', good: 'wine', to: 0 }] };
  assert.deepEqual(s.demandChanges.map((c, k) => demandChangeAt('s0', c, k)), [21, 14]);
  assert.equal(buysInForce(s, 's0', 'corinthus', 13).wine, TRADE_PARTNERS.corinthus.buys.wine);
  assert.equal(buysInForce(s, 's0', 'corinthus', 14).wine, undefined, 'stopped');
  assert.equal(buysInForce(s, 's0', 'corinthus', 21).wine, 4000);
  assert.equal(buysInForce(s, 's0', 'corinthus', 40).wine, 4000);
  // And the news says so, in that order.
  const game = demandGame({ demandChanges: s.demandChanges, seed: 's0' });
  const news = [];
  game.events.on('message', (m) => { if (/^Trade /.test(m.text)) news.push([game.time.totalMonths, m.text]); });
  game.runDays(CONFIG.DAYS_PER_MONTH * 23);
  assert.deepEqual(news, [
    [14, 'Trade stopped: Corinthus no longer buys wine.'],
    [21, 'Trade increased: Corinthus now buys 4,000 wine a year (was 0).'],
  ]);
  assert.equal(partnerBuys(game, 'corinthus').wine, 4000);
});

test('demand: the news comes in the month of the change, once, naming the city and the good', () => {
  const game = demandGame({
    demand: { corinthus: { wine: 2500 } },
    demandChanges: [
      { year: 1, partner: 'corinthus', good: 'wine', to: 4000 },
      { year: 1, partner: 'corinthus', good: 'iron', to: 0 },
      { year: 2, partner: 'corinthus', good: 'wine', to: 1500 },
    ],
  });
  const news = [];
  game.events.on('message', (m) => { if (/^Trade /.test(m.text)) news.push({ month: game.time.totalMonths, text: m.text, level: m.level }); });
  game.runDays(CONFIG.DAYS_PER_MONTH * 26);
  const when = game.scenario.demandChanges.map((c, k) => demandChangeAt(game.seed, c, k));
  assert.deepEqual(news, [
    { month: when[0], text: 'Trade increased: Corinthus now buys 4,000 wine a year (was 2,500).', level: 'good' },
    { month: when[1], text: 'Trade stopped: Corinthus no longer buys iron.', level: 'warn' },
    { month: when[2], text: 'Trade decreased: Corinthus now buys only 1,500 wine a year (was 4,000).', level: 'warn' },
  ].sort((a, b) => a.month - b.month));
});

test('demand: nothing is saved, so a game saved before a change gets it on time', () => {
  const game = demandGame({ demand: { corinthus: { wine: 2500 } }, demandChanges: [{ year: 2, partner: 'corinthus', good: 'wine', to: 4000 }] });
  const when = demandChangeAt(game.seed, game.scenario.demandChanges[0], 0);
  game.runDays(CONFIG.DAYS_PER_MONTH * 3);
  const loaded = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  assert.equal(partnerBuys(loaded, 'corinthus').wine, 2500);
  loaded.time.totalMonths = when;
  assert.equal(partnerBuys(loaded, 'corinthus').wine, 4000);
});

test('busy routes: a route busier than its traders carry comes more often, in proportion', () => {
  // A caravan carries 800 every 32 to 56 days (3,491 a year), a ship 2,400 every 64 to 96 (5,760).
  assert.equal(Math.round(carryPerYear('land')), 3491);
  assert.equal(Math.round(carryPerYear('sea')), 5760);
  assert.equal(visitFactor('land', 3000), 1);
  assert.deepEqual(visitInterval('land', 3491), [32, 56]);
  // 4,000 a year by land: 0.87 of the interval, 28 to 49 days, five caravans
  // a year; 8,000 by sea (Delos's table): 46 to 69 days.
  assert.ok(Math.abs(visitFactor('land', 4000) - 3491 / 4000) < 1e-3);
  assert.deepEqual(visitInterval('land', 4000), [28, 49]);
  assert.deepEqual(visitInterval('sea', 8000), [46, 69]);
  const game = demandGame({ demand: { tarraco: { wheat: 4000 } } });
  assert.deepEqual(routeInterval(game, 'tarraco'), visitInterval('land', 4800), 'the larger direction: 4,800 of buys (wheat 4,000 and its pottery 800)');
  assert.deepEqual(visitInterval('land', 4800), [23, 41]);
  assert.deepEqual(routeInterval(game, 'capua'), [32, 56]);
});

test('busy routes: a land route raised to 6,000 a year carries far more than the usual pace could (full simulation)', () => {
  // At the usual pace a caravan comes every 32 to 56 days and carries 800:
  // at most 4,800 a year, about 3,500 on average. Raised to 6,000, Capua's
  // caravans come every 19 to 33 days.
  const game = demandGame({ demand: { capua: { pottery: 6000 } } });
  const res = buildDemoCity(game, { level: 2 });
  assert.ok(res.ok, res.reason);
  game.runDays(CONFIG.DAYS_PER_MONTH * 6);
  const { warehouse: wh } = buildDemoHarbor(game, res.center);
  assert.ok(wh, 'a warehouse');
  for (const g of Object.keys(game.city.trade.settings)) setTradeMode(game, g, 'none');
  setTradeMode(game, 'pottery', 'export', 0);
  game.cheats.freeBuild = true;
  assert.ok(openRoute(game, 'capua').ok);
  game.cheats.freeBuild = false;
  const route = game.city.trade.routes.capua;
  let sold = 0;
  let last = 0;
  const days = CONFIG.DAYS_PER_MONTH * CONFIG.MONTHS_PER_YEAR * 2;
  for (let d = 0; d < days; d++) {
    wh.stock.pottery = Math.max(wh.stock.pottery, 1600); // plenty to sell
    game.runDays(1);
    const now = route.sold.pottery || 0;
    sold += now >= last ? now - last : now; // (the yearly reset)
    last = now;
  }
  assert.ok(route.visits >= 12, `${route.visits} caravans in two years`);
  assert.ok(sold > 9600, `${sold} pottery sold in two years (the usual pace carries at most 9,600)`);
});

test('busy routes: the empire map shows a busy route\'s trader over no more than its shortest interval', () => {
  // 10,800 a year by caravan: every 10 to 18 days, shorter than Tarraco's
  // 14-day trip, so the trip shown is cut to 10 days. Shown over 14, the
  // next caravan would appear 4 days along its road, beside the one arriving.
  const game = demandGame({ demand: { tarraco: { wheat: 10000 } } });
  game.cheats.freeBuild = true;
  assert.ok(openRoute(game, 'tarraco').ok);
  const r = game.city.trade.routes.tarraco;
  const [shortest] = routeInterval(game, 'tarraco');
  assert.equal(shortest, 10);
  assert.ok(tripDays('tarraco') > shortest, 'the clamp matters here');
  r.visits = 1;
  r.nextVisit = game.time.totalDays + shortest;
  const [c] = empireTravelers(game);
  assert.equal(c.trip, shortest);
  assert.equal(c.frac, 0, 'it sets out from Tarraco, never halfway along');
});

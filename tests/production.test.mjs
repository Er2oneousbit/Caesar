/**
 * production.test.mjs - headless tests for the goods book, the Problems
 * overlay and the Production advisor (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * The goods book (sim/goodsLedger.js) counts what is made, used, imported
 * and exported each month; the Problems overlay names the one thing wrong
 * with each building (ui/problems.js); the Production advisor turns both
 * into tables and plain-words bottlenecks (ui/production.js).
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { HOUSE_TIERS } from '../src/data/housing.js';
import { spawnWalker } from '../src/sim/entities.js';
import { openRoute, setTradeMode, caravanArrive } from '../src/sim/trade.js';
import { problemOf, NEED_KINDS, needReachable } from '../src/ui/problems.js';
import { Game } from '../src/core/game.js';
import { findScenario } from '../src/data/scenarios.js';
import { productionReport } from '../src/ui/production.js';
import { overlayByKey } from '../src/render/overlays.js';
import { buildDemoCity } from '../src/dev/demoCity.js';
import { checkBuilding } from '../src/sim/construction.js';
import { addBuilding } from '../src/sim/entities.js';
import { homesWithFood } from '../src/sim/population.js';
import { buildingStatus, taxLine } from '../src/ui/infoPanel.js';
import { newGame, build, findFree } from './helpers.mjs';

log.setLevel('error');

/** Run whole months; returns the book of the last one. */
function months(game, n) {
  game.runDays(n * CONFIG.DAYS_PER_MONTH);
  return game.city.goodsFlowLast;
}

test('the goods book counts what is made and used each month', () => {
  const game = newGame({ seed: 'bottleneck' });
  assert.ok(buildDemoCity(game, { level: 2 }).ok);
  months(game, 6); // the farms are staffed and homes eat by then
  const before = { ...game.city.produced };
  const book = months(game, 1);
  // Made: the same units the producers' running total grew by that month.
  for (const [good, total] of Object.entries(game.city.produced)) {
    const made = total - (before[good] || 0);
    assert.equal(book[good]?.made || 0, made, `${good} made`);
  }
  assert.ok(book.wheat.made > 0, 'wheat was harvested');
  assert.ok(book.wheat.used > 0, 'and eaten');
  // This month's book starts empty and fills again.
  assert.ok(Object.keys(game.city.goodsFlow).length <= Object.keys(book).length + 4);
});

test('the goods book counts imports and exports', () => {
  const game = newGame({ seed: 'ledger-trade', money: 90000 });
  const spot = findFree(game, 4, 4);
  assert.ok(build(game, 'road', spot.x, spot.y, spot.x + 3, spot.y).ok);
  assert.ok(build(game, 'warehouse', spot.x + 1, spot.y + 2).ok);
  const wh = [...game.buildings.values()].find((b) => b.type === 'warehouse');
  assert.ok(openRoute(game, 'tarraco').ok);
  wh.stock.wheat = 600;
  setTradeMode(game, 'wheat', 'export', 0);
  setTradeMode(game, 'timber', 'import', 400);
  const w = spawnWalker(game, 'caravan', wh.accessRoad, null, { partner: 'tarraco', target: wh.id, state: 'toWarehouse' });
  caravanArrive(game, w);
  const book = game.city.goodsFlow;
  assert.ok(book.wheat.exported > 0, `exported wheat ${JSON.stringify(book.wheat)}`);
  assert.equal(book.wheat.exported, 600 - wh.stock.wheat);
  assert.ok(book.timber.imported > 0, 'imported timber');
  assert.equal(book.timber.imported, wh.stock.timber);
});

test('the Problems overlay names what keeps each home and building back', () => {
  const game = newGame({ seed: 'problems' });
  assert.ok(buildDemoCity(game, { level: 2 }).ok);
  months(game, 4);
  const homes = [...game.buildings.values()].filter((b) => b.house && b.house.pop > 0);
  const stuck = homes.find((b) => b.house.blocked && b.house.blocked.length && b.house.tier < 20);
  assert.ok(stuck, 'some home cannot grow');
  const p = problemOf(game, stuck);
  const need = stuck.house.blocked[0].key;
  assert.equal(p.color, NEED_KINDS[need][0], `colored as a ${need} need`);
  assert.match(p.text, new RegExp(`To become a ${HOUSE_TIERS[stuck.house.tier + 1].name}`));
  // Falling back is worse than not growing.
  stuck.house.devolving = true;
  assert.ok(problemOf(game, stuck).v > p.v);
  assert.match(problemOf(game, stuck).text, /falling back/);
  stuck.house.devolving = false;
  // A home with everything it needs, and a working building: no problem.
  stuck.house.blocked = [];
  assert.equal(problemOf(game, stuck), null);
  // A building off the road: red.
  const spot = findFree(game, 3, 3);
  assert.ok(build(game, 'prefecture', spot.x + 1, spot.y + 1).ok);
  const pre = [...game.buildings.values()].find((b) => b.type === 'prefecture' && b.x === spot.x + 1 && b.y === spot.y + 1);
  assert.match(problemOf(game, pre).text, /No road touches this building/);
  // The overlay draws the problem as its column, and the tooltip says it.
  const ov = overlayByKey('problems');
  assert.deepEqual(ov.column(pre, game), problemOf(game, pre));
  assert.equal(ov.tip(game, pre), problemOf(game, pre).text);
  assert.ok(ov.legend.length >= 8);
});

test('a home as good as its province allows is no problem', () => {
  // Mission 1 has no fountains: a Hut there cannot become a Cottage, and is fine.
  const c1 = new Game({ scenario: findScenario('c1'), flags: {} });
  const sandbox = newGame({ seed: 'reach' });
  const hut = (game) => {
    const spot = findFree(game, 3, 3);
    assert.ok(build(game, 'road', spot.x, spot.y, spot.x + 2, spot.y).ok);
    assert.ok(build(game, 'house', spot.x + 1, spot.y + 1).ok);
    const b = [...game.buildings.values()].find((x) => x.house && x.x === spot.x + 1 && x.y === spot.y + 1);
    Object.assign(b.house, { tier: 4, pop: 11, devolving: false, blocked: [{ key: 'water', have: 1, need: 2 }] });
    return b;
  };
  assert.equal(needReachable(c1, { key: 'water', need: 2 }), false);
  assert.equal(problemOf(c1, hut(c1)), null, 'no fountains in mission 1');
  assert.match(problemOf(sandbox, hut(sandbox)).text, /fountain/, 'in the sandbox it could have one');
  // A home falling back is always a problem.
  const falling = hut(c1);
  falling.house.devolving = true;
  assert.ok(problemOf(c1, falling));
  // What the first mission can and cannot give.
  assert.equal(needReachable(c1, { key: 'religion', need: 2 }), true);
  assert.equal(needReachable(c1, { key: 'religion', need: 3 }), false);
  assert.equal(needReachable(c1, { key: 'goods', need: 1, good: 'pottery' }), false);
  assert.equal(needReachable(findGame('c3'), { key: 'goods', need: 1, good: 'pottery' }), true);
  assert.equal(needReachable(findGame('c3'), { key: 'goods', need: 1, good: 'furniture' }), false);
  assert.equal(needReachable(findGame('c4'), { key: 'goods', need: 1, good: 'wine' }), true, 'wine by sea from Massilia');
});

/** A fresh game of a campaign mission. */
function findGame(id) {
  return new Game({ scenario: findScenario(id), flags: {} });
}

test('the Production advisor finds the bottleneck', () => {
  const game = newGame({ seed: 'bottleneck', money: 90000 });
  assert.ok(buildDemoCity(game, { level: 2 }).ok);
  months(game, 5);
  // A potter with workers but no clay: waiting for it.
  const spot = findFree(game, 5, 4);
  assert.ok(build(game, 'road', spot.x, spot.y, spot.x + 4, spot.y).ok);
  assert.ok(build(game, 'pottery_ws', spot.x + 1, spot.y + 1).ok); // beside the road
  const potter = [...game.buildings.values()].find((b) => b.type === 'pottery_ws' && b.x === spot.x + 1 && b.y === spot.y + 1);
  potter.efficiency = 1;
  potter.laborAccess = 10;
  const rep = productionReport(game);
  assert.ok(rep.hasMonth);
  assert.ok(rep.goods.some((r) => r.good === 'wheat' && r.made > 0), 'wheat in the goods table');
  const hint = rep.hints.find((t) => /Figlina/.test(t));
  assert.ok(hint, `a hint about the potter: ${rep.hints.join(' | ')}`);
  assert.match(hint, /waiting for clay/);
  assert.match(hint, /^2 Figlinae are waiting for clay: build more Cretifodinae/, 'the Latin plurals');
  const grp = rep.troubles.find((t) => t.ids.includes(potter.id));
  assert.ok(grp && grp.name === 'Figlina' && /Waiting for clay/.test(grp.text), `the potter is listed with what is wrong: ${JSON.stringify(grp)}`);
});

// ---------------------------------------------------------------------------
// Saying what is true (found playing mission 3 on Insane)
// ---------------------------------------------------------------------------

test('homes with food counts the homes whose people eat and hold food, not the ones not going hungry', () => {
  const game = newGame({ seed: 'larder' });
  const spot = findFree(game, 6, 3);
  const homes = [0, 2, 4].map((dx) => {
    const b = addBuilding(game, 'house', spot.x + dx, spot.y + 1, 1);
    Object.assign(b.house, { tier: 2, pop: 7 }); // family tents: they forage, never hungry
    return b;
  });
  const tent = addBuilding(game, 'house', spot.x + 5, spot.y + 1, 1);
  Object.assign(tent.house, { tier: 1, pop: 5 }); // a Tent: forages, no vendor feeds it
  game.runTicks(1);
  assert.deepEqual(homesWithFood(game), { homes: 3, withFood: 0 }, 'a tent city with no food anywhere; the Tent is not counted at all');
  assert.equal(game.city.fedShare, 1, 'the mood still counts them as fed: tents never go hungry');
  homes[1].house.food.wheat = 20;
  assert.deepEqual(homesWithFood(game), { homes: 3, withFood: 1 });
});

test('a well far from every road is fine: water works never wear out, and nothing shows odds they cannot have', () => {
  // v0.11.0 warned about wells and reservoirs out of an engineer's reach,
  // because they collapsed. Now they never burn or collapse (as in the
  // original), so no warning, no panel flag, no Problems entry, and the
  // Fire risk and Collapse risk overlays raise no column over them.
  const game = newGame({ seed: 'well-reach', money: 50000 });
  const spot = findFree(game, 12, 9);
  const y = spot.y + 1;
  assert.ok(build(game, 'road', spot.x, y, spot.x + 11, y).ok);
  assert.deepEqual(checkBuilding(game, 'well', spot.x + 2, y + 5).warnings, [], 'five tiles off the road: no warning');
  const far = addBuilding(game, 'well', spot.x + 6, y + 6, 1);
  assert.equal(buildingStatus(game, far).level, 'good');
  assert.equal(problemOf(game, far), null, 'nothing on the Problems overlay');
  const fire = overlayByKey('fire');
  const damage = overlayByKey('damage');
  far.damageRisk = 60; // as Neptune's wrath once left one
  for (const type of ['well', 'warehouse', 'engineer_post']) {
    const b = type === 'well' ? far : addBuilding(game, type, spot.x + (type === 'warehouse' ? 1 : 9), y + 2, type === 'warehouse' ? 3 : 1);
    assert.equal(fire.value(b), null, `${type}: no fire column`);
    assert.equal(damage.value(b), null, `${type}: no collapse column`);
  }
  const potter = addBuilding(game, 'pottery_ws', spot.x + 6, y + 2, 2);
  potter.fireRisk = 50;
  potter.damageRisk = 25;
  assert.equal(fire.value(potter), 0.5, 'a workshop still shows its fire risk');
  assert.equal(damage.value(potter), 0.25, 'and its collapse risk');
});

test("a home's tax line says why it pays nothing: no Forum, a Forum without workers, or no collector lately", () => {
  const game = newGame({ seed: 'tax-line' });
  const spot = findFree(game, 8, 4);
  const y = spot.y + 1;
  assert.ok(build(game, 'road', spot.x, y, spot.x + 7, y).ok);
  const home = addBuilding(game, 'house', spot.x + 1, y + 1, 1);
  Object.assign(home.house, { tier: 4, pop: 11, tax: 0 });
  assert.match(taxLine(game, home.house), /no Forum/);
  const forum = addBuilding(game, 'forum', spot.x + 4, y + 1, 2);
  forum.efficiency = 0;
  assert.match(taxLine(game, home.house), /no Forum has the workers/);
  forum.efficiency = 1;
  assert.match(taxLine(game, home.house), new RegExp(`no tax collector has passed in the last ${CONFIG.TAX_ACCESS_DAYS} days`));
  home.house.tax = 30;
  assert.match(taxLine(game, home.house), /^Registered: .* for 30 more days unless a tax collector passes again$/);
});

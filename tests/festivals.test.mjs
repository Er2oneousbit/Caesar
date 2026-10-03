/**
 * festivals.test.mjs
 * ----------------------------------------------------------------------------
 * Festivals and neglect (sim/religion.js): a god's mood target falls once a
 * year has passed without a festival in its honor (a point a month, 28 at
 * most; not where it cannot be worshipped, not in towns under 800), a
 * festival of any size starts its year again; festivals cost food from the
 * granaries and, large or grand, wine from the warehouses, taken in a fixed
 * order and only when all of it is there; the shorter city-wide cooldown
 * lets small festivals in turn keep all five gods inside their year; the
 * demo city's habit; and saves before version 25 loading as a fresh year.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { Game } from '../src/core/game.js';
import { GOD_KEYS } from '../src/data/gods.js';
import { findScenario } from '../src/data/scenarios.js';
import { addBuilding } from '../src/sim/entities.js';
import {
  updateReligion, festivalNeglect, neglectPenalty, festivalCost, festivalFood, festivalWine, festivalNeeds,
  festivalMeans, festivalBlocked, holdFestival, levelTakes, monthsSinceAnyFestival, FESTIVAL_SIZES,
} from '../src/sim/religion.js';
import { holdDemoFestival } from '../src/dev/demoCity.js';
import { serializeGame, deserializeGame, upgradeFestivalsV26 } from '../src/core/save.js';
import { newGame, findFree } from './helpers.mjs';

log.level = 'error';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A granary or warehouse placed directly on free land, with this stock. */
function store(game, type, stock = {}) {
  const spot = findFree(game, 4, 4);
  assert.ok(spot, 'room for a storehouse');
  const b = addBuilding(game, type, spot.x, spot.y, 3);
  Object.assign(b.stock, stock);
  b.efficiency = 1;
  return b;
}

/** A staffed temple of `god`, placed directly. */
function temple(game, god) {
  const spot = findFree(game, 3, 3);
  const b = addBuilding(game, `temple_${god}`, spot.x, spot.y, 2);
  b.efficiency = 1;
  return b;
}

/** Every god waits out a long cooldown, so no blessing or wrath upsets a mood. */
function quiet(game) {
  for (const g of GOD_KEYS) game.city.gods[g].cooldown = 99;
}

const granaryFood = (game) => festivalMeans(game).food;

// ---------------------------------------------------------------------------
// Neglect
// ---------------------------------------------------------------------------

test('neglect: nothing for a year after a festival, then a point a month, 28 at most', () => {
  for (const m of [0, 1, 6, 11, 12]) assert.equal(festivalNeglect(m), 0, `${m} months`);
  assert.equal(festivalNeglect(13), 1);
  assert.equal(festivalNeglect(17), 5);
  assert.equal(festivalNeglect(39), 27);
  assert.equal(festivalNeglect(40), 28, 'the original\'s -28, 40 months on');
  assert.equal(festivalNeglect(120), 28);
  assert.equal(CONFIG.FESTIVAL_FREE_MONTHS + CONFIG.FESTIVAL_NEGLECT_MAX, 40);
});

/**
 * A city of 1,000 with one staffed temple of Ceres: her target is 80 (full
 * coverage, no festival boost, no oracle). Her mood is set to `mood` and her
 * months to `months` before the month turns; returns her mood after it
 * (moods move at most +6/-4 a month, so a mood set on the expected target
 * stays put only when the target is exactly that).
 */
function ceresAfterMonth(game, { months, mood, pop = 1000 }) {
  game.city.population = pop;
  quiet(game);
  const s = game.city.gods.ceres;
  Object.assign(s, { monthsSinceFestival: months, mood, festival: 0 });
  updateReligion(game);
  return s.mood;
}

test('neglect: the monthly mood target loses it, counted at the turn of the month', () => {
  const game = newGame({ seed: 'neglect' });
  temple(game, 'ceres');
  assert.equal(ceresAfterMonth(game, { months: 0, mood: 80 }), 80, 'a new game: no neglect');
  assert.equal(game.city.gods.ceres.monthsSinceFestival, 1, '+1 at the turn of the month');
  assert.equal(ceresAfterMonth(game, { months: 11, mood: 80 }), 80, 'a year exactly: still free');
  assert.equal(ceresAfterMonth(game, { months: 12, mood: 79 }), 79, 'the 13th month: -1');
  assert.equal(neglectPenalty(game, 'ceres'), 1);
  assert.equal(ceresAfterMonth(game, { months: 14, mood: 77 }), 77, '15 months: -3');
  assert.equal(ceresAfterMonth(game, { months: 99, mood: 52 }), 52, 'at most -28');
  // Neglect moves the mood down at the usual pace (-4 a month at most).
  assert.equal(ceresAfterMonth(game, { months: 99, mood: 80 }), 76);
});

test('neglect: not in a town under 800 people, and not for a god that cannot be worshipped there', () => {
  const game = newGame({ seed: 'neglect-small' });
  temple(game, 'ceres');
  assert.equal(ceresAfterMonth(game, { months: 30, mood: 70, pop: 799 }), 70, 'a small town\'s flat target (70 with a temple)');
  assert.equal(neglectPenalty(game, 'ceres'), 0);
  assert.equal(ceresAfterMonth(game, { months: 30, mood: 61, pop: 800 }), 61, 'from 800 people: 80 - 19 (31 months)');

  // Mission 1 unlocks Ceres's and Mercury's temples only: Neptune stays neutral at 50.
  const m1 = new Game({ scenario: findScenario('c1'), flags: {} });
  assert.equal(m1.isUnlocked('temple_neptune'), false);
  m1.city.population = 1500;
  quiet(m1);
  Object.assign(m1.city.gods.neptune, { mood: 50, monthsSinceFestival: 39 });
  updateReligion(m1);
  assert.equal(m1.city.gods.neptune.mood, 50);
  assert.equal(neglectPenalty(m1, 'neptune'), 0);
});

test('a festival of any size starts its god\'s year again; the others keep counting', () => {
  for (let size = 0; size < 3; size++) {
    const game = newGame({ seed: `reset-${size}` });
    game.city.population = 1000;
    store(game, 'granary', { wheat: 1000 });
    store(game, 'warehouse', { wine: 2000 });
    for (const g of GOD_KEYS) game.city.gods[g].monthsSinceFestival = 20;
    assert.equal(game.city.gods.mars.festivalsHeld, 0);
    assert.deepEqual(holdFestival(game, 'mars', size), { ok: true });
    assert.equal(game.city.gods.mars.monthsSinceFestival, 0, FESTIVAL_SIZES[size]);
    assert.equal(game.city.gods.mars.festivalsHeld, 1);
    assert.equal(game.city.gods.venus.monthsSinceFestival, 20);
    quiet(game);
    updateReligion(game);
    assert.equal(game.city.gods.mars.monthsSinceFestival, 1);
    assert.equal(neglectPenalty(game, 'mars'), 0);
    assert.equal(neglectPenalty(game, 'venus'), 9);
  }
});

test('a new game starts every god at 0 months, none held', () => {
  const game = newGame({ seed: 'fresh' });
  for (const g of GOD_KEYS) assert.deepEqual([game.city.gods[g].monthsSinceFestival, game.city.gods[g].festivalsHeld], [0, 0], g);
});

// ---------------------------------------------------------------------------
// What a festival costs
// ---------------------------------------------------------------------------

test('festival costs: money as before, food a share of a month (a load at least), wine for large and grand', () => {
  const game = newGame({ seed: 'costs' });
  const at = (pop) => {
    game.city.population = pop;
    return [0, 1, 2].map((size) => festivalNeeds(game, size));
  };
  // A load is 100 units; a month of food is 0.25 a person.
  assert.equal(CONFIG.CART_CAPACITY, 100);
  assert.equal(CONFIG.FOOD_PER_PERSON_MONTH, 0.25);
  assert.deepEqual(at(0), [{ money: 60, food: 100, wine: 0 }, { money: 150, food: 100, wine: 100 }, { money: 400, food: 100, wine: 100 }]);
  // 1,000 people eat 250 a month: 5%, 10% and 20% are under a load. Wine: 1000/500 + 1 = 3 loads, half of it 2.
  assert.deepEqual(at(1000), [{ money: 210, food: 100, wine: 0 }, { money: 550, food: 100, wine: 200 }, { money: 1400, food: 100, wine: 300 }]);
  // 4,999: 9 + 1 = 10 loads for a grand festival, 5 for a large.
  assert.deepEqual(at(4999).map((n) => n.wine), [0, 500, 1000]);
  // 10,000 eat 2,500 a month: 125, 250, 500. Wine 21 loads, and 11.
  assert.deepEqual(at(10000), [{ money: 1560, food: 125, wine: 0 }, { money: 4150, food: 250, wine: 1100 }, { money: 10400, food: 500, wine: 2100 }]);
  // 2,100 people: 26.25 units for a small festival's 5% rounds up, still under a load.
  game.city.population = 2100;
  assert.equal(festivalFood(game, 0), 100);
  assert.equal(festivalFood(game, 2), 105);
  assert.equal(festivalWine(game, 1), 300);
  assert.equal(festivalCost(game, 0), 375);
});

// ---------------------------------------------------------------------------
// Taking the goods
// ---------------------------------------------------------------------------

test('levelTakes: the largest stocks give first and end level; ties in the given order', () => {
  const take = (stocks, n) => Object.fromEntries(levelTakes(stocks.map(([key, v]) => ({ key, n: v })), n));
  assert.deepEqual(take([['a', 300], ['b', 150], ['c', 300], ['d', 10]], 125), { a: 63, c: 62 });
  assert.deepEqual(take([['a', 300], ['b', 150], ['c', 300], ['d', 10]], 400), { a: 184, b: 33, c: 183 }, 'a and c down to 150, then all three to about 117');
  assert.deepEqual(take([['a', 5], ['b', 5], ['c', 5]], 2), { a: 1, b: 1 });
  assert.deepEqual(take([['a', 40], ['b', 0]], 40), { a: 40 });
  // A market buyer can leave a fraction: then the last step is shared exactly.
  assert.deepEqual(take([['a', 10.5], ['b', 3]], 9), { a: 8.25, b: 0.75 });
});

test('a festival\'s food comes from the largest food stocks first, each from the granary holding most of it (lowest id on a tie)', () => {
  const game = newGame({ seed: 'take-food' });
  game.city.population = 10000; // a small festival: 125 food
  const a = store(game, 'granary', { wheat: 200, vegetables: 150 });
  const b = store(game, 'granary', { wheat: 100, fruit: 300, meat: 10 });
  const w = store(game, 'warehouse', { wheat: 500 }); // a warehouse's food is not a festival's
  assert.ok(a.id < b.id);
  const treasury = game.city.treasury;
  assert.deepEqual(holdFestival(game, 'ceres', 0), { ok: true });
  // City totals: wheat 300, fruit 300, vegetables 150, meat 10. Wheat and
  // fruit tie on top and give 63 and 62 (the odd unit to wheat, first of the foods).
  assert.equal(a.stock.wheat, 137);
  assert.equal(a.stock.vegetables, 150);
  assert.equal(b.stock.wheat, 100, 'granary A held more wheat: it gave it all');
  assert.equal(b.stock.fruit, 238);
  assert.equal(b.stock.meat, 10);
  assert.equal(w.stock.wheat, 500);
  assert.equal(game.city.treasury, treasury - festivalCost(game, 0));
  assert.equal(game.city.goodsFlow.wheat.used, 63, 'the goods book counts it as used');
  assert.equal(game.city.goodsFlow.fruit.used, 62);
  assert.equal(game.city.festivalCooldown, 2);
});

test('a festival\'s wine comes from the warehouse holding most first, the lowest id on a tie, as far as each goes', () => {
  const game = newGame({ seed: 'take-wine' });
  game.city.population = 1000; // grand: 300 wine and 100 food
  store(game, 'granary', { meat: 400 });
  const w1 = store(game, 'warehouse', { wine: 100 });
  const w2 = store(game, 'warehouse', { wine: 250 });
  const w3 = store(game, 'warehouse', { wine: 200 });
  assert.deepEqual(holdFestival(game, 'venus', 2), { ok: true });
  assert.deepEqual([w1.stock.wine, w2.stock.wine, w3.stock.wine], [100, 0, 150]);
  assert.equal(granaryFood(game), 300);
  assert.equal(game.city.goodsFlow.wine.used, 300);
  assert.equal(game.city.festivalCooldown, 8);

  // Two warehouses that tie: the lower id gives.
  const g2 = newGame({ seed: 'take-wine-tie' });
  g2.city.population = 1000; // large: 200 wine
  store(g2, 'granary', { wheat: 400 });
  const x = store(g2, 'warehouse', { wine: 300 });
  const y = store(g2, 'warehouse', { wine: 300 });
  assert.deepEqual(holdFestival(g2, 'mars', 1), { ok: true });
  assert.deepEqual([x.stock.wine, y.stock.wine], [100, 300]);
  assert.equal(g2.city.festivalCooldown, 4);
});

test('a festival the city cannot pay in full is not held, nothing is taken, and the reason says what is short', () => {
  const game = newGame({ seed: 'short' });
  game.city.population = 1000;
  const gran = store(game, 'granary', { wheat: 25, fruit: 15 });
  const wh = store(game, 'warehouse', { wine: 100 });
  const before = () => JSON.stringify([gran.stock, wh.stock, game.city.treasury, game.city.gods, game.city.festivalCooldown, game.city.festivalBoost]);
  const was = before();
  const r = holdFestival(game, 'neptune', 2);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'Needs 100 food in the granaries, 40 stored. Needs 300 wine in the warehouses, 100 stored.');
  assert.equal(before(), was, 'nothing taken, nothing paid, no god moved');

  gran.stock.wheat = 500;
  assert.equal(holdFestival(game, 'neptune', 2).reason, 'Needs 300 wine in the warehouses, 100 stored.');
  assert.equal(festivalBlocked(game, 1), 'Needs 200 wine in the warehouses, 100 stored.');
  assert.equal(festivalBlocked(game, 0), null, 'a small festival needs no wine');
  game.city.treasury = 50;
  assert.equal(festivalBlocked(game, 0), 'Needs 210 Dn, 50 in the treasury.');
  const stock = JSON.stringify(gran.stock);
  assert.equal(holdFestival(game, 'neptune', 0).ok, false);
  assert.equal(JSON.stringify(gran.stock), stock);
  // The free-build cheat waives the money, not the goods.
  game.cheats.freeBuild = true;
  assert.equal(festivalBlocked(game, 0), null);
  assert.equal(festivalBlocked(game, 2), 'Needs 300 wine in the warehouses, 100 stored.');
  assert.equal(holdFestival(game, 'neptune', 7).ok, false, 'no such size');
});

test('the cooldown: 2, 4 and 8 months, and its reason', () => {
  assert.deepEqual(CONFIG.FESTIVAL_COOLDOWN, [2, 4, 8]);
  const game = newGame({ seed: 'cooldown' });
  game.city.population = 600;
  store(game, 'granary', { wheat: 2000 });
  assert.equal(holdFestival(game, 'ceres', 0).ok, true);
  assert.equal(game.city.festivalCooldown, 2);
  const r = holdFestival(game, 'mars', 0);
  assert.equal(r.reason, 'Citizens are still recovering from the last festival (2 months).');
  game.city.festivalCooldown = 1;
  assert.equal(festivalBlocked(game, 0), 'Citizens are still recovering from the last festival (1 month).');
});

test('the people tire of festivals: one held sooner than 3 months after the last lifts the city mood in proportion; the god always gets its full share', () => {
  const game = newGame({ seed: 'city-share' });
  game.city.population = 1000;
  store(game, 'granary', { wheat: 2000 });
  store(game, 'warehouse', { wine: 2000 });
  const c = game.city;
  const month = () => { quiet(game); updateReligion(game); if (c.festivalCooldown > 0) c.festivalCooldown--; };
  assert.equal(monthsSinceAnyFestival(game), Infinity, 'none held yet');
  holdFestival(game, 'ceres', 0);
  assert.equal(c.festivalBoost, 4, 'the first: in full');
  c.festivalBoost = 0;
  month(); month();
  assert.equal(monthsSinceAnyFestival(game), 2);
  const neptune = c.gods.neptune.festival;
  holdFestival(game, 'neptune', 0);
  assert.ok(Math.abs(c.festivalBoost - 4 * 2 / 3) < 1e-9, `2 months on: two thirds (${c.festivalBoost})`);
  assert.equal(c.gods.neptune.festival, neptune + 15, 'the god\'s own boost in full');
  c.festivalBoost = 0;
  month(); month(); month(); month();
  holdFestival(game, 'mars', 1);
  assert.equal(c.festivalBoost, 8, '4 months on: in full');
  // A rotation every 2 months keeps the city mood where one every 3 months kept it before.
  assert.equal(CONFIG.FESTIVAL_CITY_FULL_MONTHS, 3);
});

test('a store set to Get the good gives last, as for the Emperor', () => {
  const game = newGame({ seed: 'take-get' });
  game.city.population = 1000; // large: 200 wine, 100 food
  const keep = store(game, 'warehouse', { wine: 900 });
  keep.orders.wine = 'get';
  const other = store(game, 'warehouse', { wine: 150 });
  const g1 = store(game, 'granary', { wheat: 500 });
  g1.orders.wheat = 'get';
  const g2 = store(game, 'granary', { wheat: 60 });
  assert.deepEqual(holdFestival(game, 'mars', 1), { ok: true });
  assert.deepEqual([other.stock.wine, keep.stock.wine], [0, 850]);
  assert.deepEqual([g2.stock.wheat, g1.stock.wheat], [0, 460]);
});

test('small festivals in turn keep all five gods inside their year, five years on', () => {
  const game = newGame({ seed: 'rotation' });
  game.city.population = 2000;
  const gran = store(game, 'granary', {});
  quiet(game);
  let worst = 0;
  for (let m = 0; m < 60; m++) {
    gran.stock.wheat = 1000; // a city that keeps its granaries stocked
    if (game.city.festivalCooldown <= 0) {
      const next = [...GOD_KEYS].sort((a, b) => game.city.gods[b].monthsSinceFestival - game.city.gods[a].monthsSinceFestival)[0];
      assert.equal(holdFestival(game, next, 0).ok, true);
    }
    for (const g of GOD_KEYS) game.city.gods[g].cooldown = 99;
    updateReligion(game);
    if (game.city.festivalCooldown > 0) game.city.festivalCooldown--; // as the month's turn does (core/game.js)
    if (m >= 12) for (const g of GOD_KEYS) worst = Math.max(worst, game.city.gods[g].monthsSinceFestival);
  }
  assert.ok(worst <= CONFIG.FESTIVAL_FREE_MONTHS, `a god waited ${worst} months`);
  for (const g of GOD_KEYS) assert.equal(neglectPenalty(game, g), 0, g);
});

// ---------------------------------------------------------------------------
// The demo city's habit
// ---------------------------------------------------------------------------

test('the demo city holds a small festival for the god longest without one, once it can spare the food', () => {
  const game = newGame({ seed: 'demo-fest' });
  game.city.population = 1000; // a month of food is 250
  const gran = store(game, 'granary', { wheat: 300 });
  for (const g of GOD_KEYS) game.city.gods[g].monthsSinceFestival = 5;
  game.city.gods.mars.monthsSinceFestival = 9;
  game.city.gods.venus.monthsSinceFestival = 9;
  assert.equal(holdDemoFestival(game), null, '300 - 100 leaves less than a month of food');
  game.city.population = 799;
  gran.stock.wheat = 1000;
  assert.equal(holdDemoFestival(game), null, 'a town under 800, whose gods do not mind');
  game.city.population = 1000;
  gran.stock.wheat = 350;
  assert.equal(holdDemoFestival(game), 'mars', 'the first of the two longest waiting');
  assert.equal(game.city.festivalCooldown, 2);
  assert.equal(gran.stock.wheat, 250);
  assert.equal(holdDemoFestival(game), null, 'not while the city recovers');
  game.city.festivalCooldown = 0;
  gran.stock.wheat = 1000;
  assert.equal(holdDemoFestival(game), 'venus');
  assert.equal(game.city.gods.venus.festivalsHeld, 1);
  assert.equal(game.city.festivalCooldown, 2, 'a small one: never wine');
});

// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

test('save: the months since each festival are kept; a save before version 25 loads as a fresh year', () => {
  const game = newGame({ seed: 'fest-save' });
  game.city.gods.ceres.monthsSinceFestival = 17;
  game.city.gods.ceres.festivalsHeld = 3;
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  assert.equal(data.version, CONFIG.SAVE_VERSION);
  const same = deserializeGame(JSON.parse(JSON.stringify(data)));
  assert.deepEqual([same.city.gods.ceres.monthsSinceFestival, same.city.gods.ceres.festivalsHeld], [17, 3]);

  // Version 24: no such fields.
  const old = JSON.parse(JSON.stringify(data));
  old.version = 24;
  for (const g of GOD_KEYS) { delete old.city.gods[g].monthsSinceFestival; delete old.city.gods[g].festivalsHeld; }
  old.city.gods.mars.monthsSinceFestival = 'junk'; // whatever an old file holds there
  const up = deserializeGame(old);
  for (const g of GOD_KEYS) assert.deepEqual([up.city.gods[g].monthsSinceFestival, up.city.gods[g].festivalsHeld], [0, 0], g);
  up.city.population = 1000;
  quiet(up);
  updateReligion(up);
  for (const g of GOD_KEYS) assert.equal(up.city.gods[g].monthsSinceFestival, 1, g);

  // The step on its own.
  const g2 = newGame({ seed: 'fest-save-2' });
  g2.city.gods.venus.monthsSinceFestival = 30;
  upgradeFestivalsV26(g2);
  assert.equal(g2.city.gods.venus.monthsSinceFestival, 0);
});

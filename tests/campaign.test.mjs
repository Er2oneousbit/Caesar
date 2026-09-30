/**
 * campaign.test.mjs - headless tests for the campaign's length (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * The missions' goals set how long each one takes (sim/pace.js): each keeps
 * to its planned pace, missions get longer as the campaign goes on, the pace
 * model counts settlers at the game's own rate, and the first mission is no
 * longer won in a few months. The goals also have to be within reach of each
 * mission's buildings: the housing level its unlocks allow and the culture
 * and prosperity it can earn.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { Game } from '../src/core/game.js';
import { SCENARIOS, TRADE_PARTNERS, findScenario } from '../src/data/scenarios.js';
import { BUILDINGS, VENUE_POINTS, VENUE_BOTH_BONUS, VENUE_BOTH_SHOWS, ENT_BASE_MAX } from '../src/data/buildings.js';
import { HOUSE_TIERS } from '../src/data/housing.js';
import { FOOD_TYPES } from '../src/data/goods.js';
import { goalMonths, populationMonths, monthsToMinutes } from '../src/sim/pace.js';
import { updateImmigration, immigrationPerDay } from '../src/sim/population.js';
import { buildDemoCity } from '../src/dev/demoCity.js';
import { newGame } from './helpers.mjs';
import { Terrain } from '../src/world/map.js';

log.setLevel('error');

// ---------------------------------------------------------------------------
// What a mission's buildings allow (a rough model of the needs in data/housing.js)
// ---------------------------------------------------------------------------

/** Building keys a mission unlocks (its tools, such as roads, left out). */
function unlocked(s) {
  return new Set(s.unlocks === 'all' ? Object.keys(BUILDINGS) : s.unlocks.filter((k) => BUILDINGS[k]));
}

/** Goods the city can make (a workshop and its raw material) or import. */
function goodsFor(s) {
  const keys = unlocked(s);
  const out = new Set();
  for (const k of keys) {
    const d = BUILDINGS[k];
    if (!d.produces) continue;
    if (d.consumes && ![...keys].some((r) => BUILDINGS[r].produces === d.consumes)) continue;
    out.add(d.produces);
  }
  for (const id of s.partners) for (const g of Object.keys(TRADE_PARTNERS[id].sells)) out.add(g);
  return out;
}

/** The best entertainment score a home can get with the mission's venues. */
function bestEntertainment(keys) {
  const venues = Object.keys(VENUE_POINTS).filter((v) => keys.has(v) && [...keys].some((k) => BUILDINGS[k].kind === 'training' && BUILDINGS[k].venue === v));
  if (!venues.length) return 0;
  let score = ENT_BASE_MAX;
  for (const v of venues) {
    score += VENUE_POINTS[v];
    if (VENUE_BOTH_SHOWS[v] && VENUE_BOTH_SHOWS[v].every((w) => venues.includes(w))) score += VENUE_BOTH_BONUS[v] || 0;
  }
  return score;
}

/** The highest housing level a mission's buildings and partners allow. */
function topLevel(s) {
  const keys = unlocked(s);
  const goods = goodsFor(s);
  const gods = [...keys].filter((k) => k.startsWith('temple_')).length;
  const foods = FOOD_TYPES.filter((f) => goods.has(f)).length;
  const water = keys.has('fountain') ? 2 : keys.has('well') ? 1 : 0;
  const edu = keys.has('school') && keys.has('library') ? (keys.has('academy') ? 3 : 2) : keys.has('school') || keys.has('library') ? 1 : 0;
  const health = (keys.has('clinic') ? 1 : 0) + (keys.has('hospital') ? 1 : 0);
  const wine = (keys.has('wine_ws') && goods.has('grapes') ? 1 : 0) + s.partners.filter((id) => TRADE_PARTNERS[id].sells.wine).length;
  const ent = bestEntertainment(keys);
  let top = 0;
  for (let t = 1; t < HOUSE_TIERS.length; t++) {
    const n = HOUSE_TIERS[t];
    const ok = n.water <= water && n.food <= foods && n.religion <= gods && n.ent <= ent && n.edu <= edu
      && (!n.barber || keys.has('barber')) && (!n.baths || keys.has('baths')) && n.health <= health
      && n.goods.every((g) => goods.has(g)) && n.wine <= wine;
    if (!ok) break;
    top = t;
  }
  return top;
}

/** The most culture a mission's buildings can earn (sim/ratings.js). */
function bestCulture(s) {
  const keys = unlocked(s);
  return ([...keys].some((k) => k.startsWith('temple_')) ? 25 : 0)
    + Math.min(1, bestEntertainment(keys) / 40) * 25
    + (keys.has('school') ? 15 : 0) + (keys.has('library') ? 15 : 0) + (keys.has('academy') ? 12 : 0) + (keys.has('senate') ? 8 : 0);
}

/** The most prosperity (sim/ratings.js): every home at the top level, a profit, full work, fair wages. */
function bestProsperity(s) {
  const keys = unlocked(s);
  const top = topLevel(s);
  const patricians = HOUSE_TIERS.slice(1, top + 1).some((t) => t.patrician);
  return Math.min(1, top / 12) * 40 + (patricians ? 15 : 0) + (keys.has('forum') ? 15 : 5) + 10 + 8 + (keys.has('senate') ? 10 : 0);
}

// ---------------------------------------------------------------------------

test('each mission keeps to its planned pace, and the missions get longer', () => {
  let prev = 0;
  const rows = [];
  for (const s of SCENARIOS) {
    assert.ok(s.paceYears > 0, `${s.id} has a planned pace`);
    const floor = goalMonths(s.goals).fastest / 12;
    rows.push(`${s.id} ${floor.toFixed(2)} years (${Math.round(monthsToMinutes(floor * 12))} min at 1x)`);
    assert.ok(Math.abs(floor - s.paceYears) <= s.paceYears * 0.05, `${s.id}: the goals take ${floor.toFixed(2)} years at the fastest, planned ${s.paceYears}`);
    assert.ok(s.paceYears >= prev, `${s.id} is no shorter than the mission before it`);
    prev = s.paceYears;
  }
  // The first mission a year or more (it took months), the last well over ten.
  assert.ok(SCENARIOS[0].paceYears >= 1, rows.join('; '));
  assert.ok(SCENARIOS[SCENARIOS.length - 1].paceYears >= 12, rows.join('; '));
});

test('each mission\'s goals are within reach of its buildings', () => {
  // The housing ladder through the campaign: Huts, Townhouses, Domus, Villas, then every level.
  assert.deepEqual(SCENARIOS.map(topLevel), [4, 7, 9, 13, 20, 20, 20]);
  for (const s of SCENARIOS) {
    const g = s.goals;
    const keys = unlocked(s);
    assert.ok(keys.has('forum'), `${s.id}: a forum, so the city has an income`);
    assert.ok(g.culture <= bestCulture(s) * 0.8, `${s.id}: culture ${g.culture} of at most ${bestCulture(s)}`);
    assert.ok(g.prosperity <= bestProsperity(s) * 0.8, `${s.id}: prosperity ${g.prosperity} of at most ${bestProsperity(s)}`);
    // The map has the farmland to feed half as many again as the goal, from
    // wheat farms fully on meadow (what one feeds: data/buildings.js, config.js).
    const map = new Game({ scenario: s, flags: {} }).map;
    let meadow = 0;
    for (let i = 0; i < map.size; i++) if (map.terrain[i] === Terrain.MEADOW) meadow++;
    const farm = BUILDINGS.farm_wheat;
    const feeds = (CONFIG.DAYS_PER_MONTH / farm.productionDays) * CONFIG.CART_CAPACITY / CONFIG.FOOD_PER_PERSON_MONTH;
    const fed = Math.floor(meadow / (farm.size * farm.size)) * feeds;
    assert.ok(fed >= g.population * 1.5, `${s.id}: farmland for ${Math.round(fed)} people, goal ${g.population}`);
  }
});

test('the pace model counts settlers at the game\'s own rate', () => {
  const game = newGame({ seed: 'pace-rate' });
  assert.ok(buildDemoCity(game, { level: 1 }).ok);
  game.runDays(1);
  const c = game.city;
  const people = () => [...game.buildings.values()].reduce((n, b) => n + (b.house ? b.house.pop + b.house.incoming : 0), 0);
  const before = people();
  c.immigrationAcc = 0;
  const days = 10;
  for (let d = 0; d < days; d++) {
    c.sentiment = 70; // fixed for the test (it is recomputed monthly)
    updateImmigration(game);
  }
  const came = people() - before;
  const rate = immigrationPerDay(70, true, game.difficulty.immigration);
  assert.ok(Math.abs(came - rate * days) <= 1, `${came} settlers in ${days} days at ${rate}/day`);
  // The model at the same mood (it adds the new city's extra mood itself).
  const model = populationMonths(came, { mood: 70 - CONFIG.NEW_CITY_MOOD }) * CONFIG.DAYS_PER_MONTH;
  assert.ok(Math.abs(model - days) <= 0.5, `the model's ${model.toFixed(2)} days for ${came} settlers`);
});

test('the first mission is not won in its first year', () => {
  // It used to be: a town of 250 people was enough, and the demo city had it in 5 months.
  const game = new Game({ scenario: findScenario('c1'), flags: {} });
  let won = null;
  game.events.on('victory', () => { won ??= game.time.totalMonths; });
  assert.ok(buildDemoCity(game, { level: 1 }).ok);
  game.runDays(12 * CONFIG.DAYS_PER_MONTH);
  assert.ok(game.city.population > 400, `the town grew (${game.city.population} people)`);
  assert.equal(won, null, 'no victory in the first year');
});

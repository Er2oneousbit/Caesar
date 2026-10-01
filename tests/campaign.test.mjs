/**
 * campaign.test.mjs - headless tests for the campaign's length (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * The missions' goals set how long each one takes (sim/pace.js): each keeps
 * to its planned pace, missions get longer as the campaign goes on, the pace
 * model counts settlers at the game's own rate, and the first mission is no
 * longer won in a few months. The goals also have to be within reach of each
 * mission's buildings: the housing level its unlocks allow, the culture and
 * prosperity it can earn, and the people its buildings can employ and its
 * map can house and feed (sim/capacity.js).
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { Game } from '../src/core/game.js';
import { SCENARIOS, findScenario } from '../src/data/scenarios.js';
import { HOUSE_TIERS } from '../src/data/housing.js';
import { goalMonths, populationMonths, monthsToMinutes } from '../src/sim/pace.js';
import { unlockedBuildings, topLevels, bestEntertainment, planCity, jobsFor, employmentCeiling, employsEnough, landCeiling, landOf, peoplePerTile, GOAL_SHARE } from '../src/sim/capacity.js';
import { generateMap } from '../src/world/mapgen.js';
import { updateImmigration, immigrationPerDay } from '../src/sim/population.js';
import { buildDemoCity } from '../src/dev/demoCity.js';
import { newGame } from './helpers.mjs';

log.setLevel('error');

// ---------------------------------------------------------------------------
// What a mission's buildings allow (sim/capacity.js reads the needs in data/housing.js)
// ---------------------------------------------------------------------------

const topLevel = (s) => topLevels(s).top;

/** The most culture a mission's buildings can earn (sim/ratings.js). */
function bestCulture(s) {
  const keys = unlockedBuildings(s);
  return ([...keys].some((k) => k.startsWith('temple_')) ? 25 : 0)
    + Math.min(1, bestEntertainment(keys) / 40) * 25
    + (keys.has('school') ? 15 : 0) + (keys.has('library') ? 15 : 0) + (keys.has('academy') ? 12 : 0) + (keys.has('senate') ? 8 : 0);
}

/** The most prosperity (sim/ratings.js): every home at the top level, a profit, full work, fair wages. */
function bestProsperity(s) {
  const keys = unlockedBuildings(s);
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
  // The first mission a year or more (it took months). Since the population
  // goals fit the jobs (sim/capacity.js), peace sets the length: the last
  // mission takes a few years, several times the first.
  assert.ok(SCENARIOS[0].paceYears >= 1, rows.join('; '));
  const last = SCENARIOS[SCENARIOS.length - 1].paceYears;
  assert.ok(last >= 4 && last >= 3 * SCENARIOS[0].paceYears, rows.join('; '));
});

test('each mission\'s goals are within reach of its buildings', () => {
  // The housing ladder through the campaign: Huts, Townhouses, Merchant Houses
  // (a theater alone gives at most 16 entertainment, a Domus needs 20),
  // Villas, then every level.
  assert.deepEqual(SCENARIOS.map(topLevel), [4, 7, 8, 13, 20, 20, 20]);
  for (const s of SCENARIOS) {
    const g = s.goals;
    const keys = unlockedBuildings(s);
    assert.ok(keys.has('forum'), `${s.id}: a forum, so the city has an income`);
    assert.ok(g.culture <= bestCulture(s) * 0.8, `${s.id}: culture ${g.culture} of at most ${bestCulture(s)}`);
    assert.ok(g.prosperity <= bestProsperity(s) * 0.8, `${s.id}: prosperity ${g.prosperity} of at most ${bestProsperity(s)}`);
  }
});

// ---------------------------------------------------------------------------
// Population goals that fit the jobs (sim/capacity.js)
// ---------------------------------------------------------------------------

test('each mission\'s population goal fits the jobs its buildings give, and its map', () => {
  // Mission 1 asked for 1,200 people when a sensible town of Huts employs
  // about 60 to 100: played well it stalled near 700 with half its workers
  // idle, a mood under 45 and peace stuck short of its goal.
  let prev = 0;
  for (const s of SCENARIOS) {
    const goal = s.goals.population;
    const ceiling = employmentCeiling(s);
    const { map } = generateMap({ width: s.map.size, height: s.map.size, seed: s.map.seed, type: s.map.type });
    const land = landCeiling(s, landOf(map));
    assert.ok(goal <= GOAL_SHARE * ceiling, `${s.id}: population goal ${goal}, but its buildings employ at most ${ceiling} people (goal at most ${Math.floor(GOAL_SHARE * ceiling)})`);
    assert.ok(goal <= GOAL_SHARE * land, `${s.id}: population goal ${goal}, but the map houses and feeds at most ${land}`);
    assert.ok(employsEnough(s, goal), `${s.id}: a city of ${goal} has the jobs`);
    assert.ok(goal > prev, `${s.id}: the goals rise mission to mission (${prev} before, ${goal} now)`);
    prev = goal;
  }
});

test('capacity model: a mission 1 town of Huts, worked through', () => {
  const c1 = findScenario('c1');
  assert.deepEqual(topLevels(c1), { top: 4, working: 4 });
  assert.equal(peoplePerTile(4), 11);
  // 200 people: 18 home tiles, eating 50 food a month (a wheat farm makes 80 to 92).
  const plan = planCity(c1, 200);
  const count = Object.fromEntries(plan.items.map((it) => [it.key, it.count]));
  assert.deepEqual(count, { prefecture: 2, engineer_post: 2, market: 1, forum: 1, farm_wheat: 1, granary: 1, temple_jupiter: 1, temple_ceres: 1 });
  // 2 x 6 + 2 x 5 + 5 + 6 + 10 + 12 + 2 + 2 = 59 jobs for a workforce of 64: 8% idle, fine.
  assert.equal(plan.jobs, 59);
  assert.ok(employsEnough(c1, 200));
  // 300 people still have those 59 jobs, for 96 workers: 39% idle.
  assert.equal(jobsFor(c1, 300), 59);
  assert.ok(!employsEnough(c1, 300));
  assert.equal(employmentCeiling(c1), 200);
});

test('capacity model: shows, patricians and trade', () => {
  // A theater alone: 10 for a visit and a seat base of 6 (full seats for one
  // of the three venue kinds); with an amphitheater and both kinds of show,
  // 10 + 15 + 5 and a base of 13.
  assert.equal(bestEntertainment(unlockedBuildings(findScenario('c3'))), 16);
  assert.equal(bestEntertainment(unlockedBuildings(findScenario('c4'))), 43);
  // Patricians do not work: with every level open the model's homes are
  // Insulae (level 12), the best whose residents look for work.
  assert.deepEqual(topLevels(findScenario('c7')), { top: 20, working: 12 });
  // What partners buy is work: mission 3 without its trade routes employs fewer.
  const c3 = findScenario('c3');
  assert.ok(employmentCeiling({ ...c3, partners: [] }) < employmentCeiling(c3));
});

test('mission 1, built only with its own buildings and sized to its jobs, is won', () => {
  // A town of 24 plots holds about the goal's people (some stay tents, with
  // no well in reach). Its jobs keep everyone at work, so the mood stays at
  // PEACE_MOOD or more after the new city's first year and peace reaches its goal.
  const s = findScenario('c1');
  const game = new Game({ scenario: s, flags: {} });
  let won = null;
  game.events.on('victory', () => { won ??= game.time.totalMonths; });
  assert.ok(buildDemoCity(game, { level: 2, homes: 24 }).ok);
  const locked = [...game.buildings.values()].filter((b) => !game.isUnlocked(b.type) && !b.house);
  assert.deepEqual(locked.map((b) => b.type), [], 'only what the mission unlocks');
  game.runDays(24 * CONFIG.DAYS_PER_MONTH);
  const c = game.city;
  assert.ok(c.population >= s.goals.population, `${c.population} people, goal ${s.goals.population}`);
  assert.ok(c.unemploymentRate <= CONFIG.UNEMPLOYMENT_GRACE, `unemployment ${Math.round(c.unemploymentRate * 100)}%`);
  assert.ok(c.sentiment >= CONFIG.PEACE_MOOD, `mood ${c.sentiment}`);
  assert.ok(won !== null, `won (peace ${c.ratings.peace}, culture ${c.ratings.culture})`);
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

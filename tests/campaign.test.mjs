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
 * prosperity it can earn, and the people a sensibly built city of its
 * buildings can employ and its map can house and feed (sim/capacity.js).
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { Game } from '../src/core/game.js';
import { SCENARIOS, findScenario, LAST_STEP, missionsAtStep, TRADE_PARTNERS } from '../src/data/scenarios.js';
import { HOUSE_TIERS } from '../src/data/housing.js';
import { goalMonths, populationMonths, monthsToMinutes } from '../src/sim/pace.js';
import { unlockedBuildings, topLevels, bestEntertainment, planCity, jobsFor, employmentCeiling, employsEnough, landCeiling, landOf, peoplePerTile, lowProduction, topProduction, docksFor, demandAt, LEAN, SENSIBLE, PATRICIAN_SHARE, VILLA_LEVEL } from '../src/sim/capacity.js';
import { demandChangeAt } from '../src/sim/tradeDemand.js';
import { generateMap } from '../src/world/mapgen.js';
import { updateImmigration, immigrationPerDay } from '../src/sim/population.js';
import { buildDemoCity } from '../src/dev/demoCity.js';
import { checkBuilding } from '../src/sim/construction.js';
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

test('each mission keeps to its planned pace, and the missions get longer step by step', () => {
  const rows = [];
  for (const s of SCENARIOS) {
    assert.ok(s.paceYears > 0, `${s.id} has a planned pace`);
    const floor = goalMonths(s.goals).fastest / 12;
    rows.push(`${s.id} ${floor.toFixed(2)} years (${Math.round(monthsToMinutes(floor * 12))} min at 1x)`);
    assert.ok(Math.abs(floor - s.paceYears) <= s.paceYears * 0.05, `${s.id}: the goals take ${floor.toFixed(2)} years at the fastest, planned ${s.paceYears}`);
  }
  // By step: a mission is no shorter than the SHORTEST mission of the step
  // before. Not the longest: siblings differ (a peaceful province asks for
  // more culture and peace, which take longer, a military one for fewer
  // people).
  for (let n = 2; n <= LAST_STEP; n++) {
    const before = Math.min(...missionsAtStep(n - 1).map((s) => s.paceYears));
    for (const s of missionsAtStep(n)) assert.ok(s.paceYears >= before, `${s.id} (${s.paceYears} years) is no shorter than the shortest mission of step ${n - 1} (${before})`);
  }
  // The first mission a year or more (it took months), and every mission of
  // the last step longer than every mission before it: the career ends on
  // its longest provinces.
  assert.ok(SCENARIOS[0].paceYears >= 1, rows.join('; '));
  for (const last of missionsAtStep(LAST_STEP)) {
    for (const s of SCENARIOS) if (s.step < LAST_STEP) assert.ok(last.paceYears > s.paceYears, `${last.id} is longer than ${s.id} (${s.paceYears}); ${rows.join('; ')}`);
  }
});

test('each mission\'s goals are within reach of its buildings', () => {
  // The housing ladder through the campaign: Huts, Townhouses, Domus (the
  // amphitheater: a theater alone gives at most 16 entertainment, a Domus
  // needs 20), Villas, then Grand Palatia at steps 5 and 6 and every level
  // from step 7, whose hippodrome the Imperial Palatium (95) needs. Siblings
  // reach the same level as the mission beside them.
  assert.deepEqual(Object.fromEntries(SCENARIOS.map((s) => [s.id, topLevel(s)])),
    { c1: 4, c2: 7, c3: 9, c3m: 9, c4: 13, c4p: 13, c5: 19, c5p: 19, c6: 19, c6p: 19, c7: 20, c7p: 20 });
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

/**
 * Missions whose population goal is known to be more than their buildings can
 * employ, until the economy has the jobs for it: partners' yearly purchases
 * cap exports, and villa residents do not work. See the ROADMAP note "The
 * late missions need more jobs". Take a mission off this list once its goal
 * fits; a new mission must never be added to it (LEGACY_OVER holds the list
 * to the missions that were over when the rule came in).
 */
const KNOWN_OVER = [];
const LEGACY_OVER = Object.freeze(['c3', 'c4', 'c5', 'c6', 'c7']);

test('each mission\'s population goal fits the jobs its buildings give, and its map', () => {
  // Mission 1 asked for 1,200 people when a sensibly built town of Huts has
  // about 100 jobs: played well it stalled near 600 with half its workers
  // idle, a mood under 45 and peace stuck short of its goal.
  for (const s of SCENARIOS) {
    const goal = s.goals.population;
    const ceiling = employmentCeiling(s, SENSIBLE);
    const { map } = generateMap({ width: s.map.size, height: s.map.size, seed: s.map.seed, type: s.map.type });
    const land = landCeiling(s, landOf(map));
    assert.ok(goal <= land, `${s.id}: population goal ${goal}, but the map houses and feeds at most ${land}`);
    if (KNOWN_OVER.includes(s.id)) {
      // Still over: when it fits, take it off the list (and the ROADMAP note).
      assert.ok(goal > ceiling, `${s.id}: its goal ${goal} now fits (ceiling ${ceiling}): take it off KNOWN_OVER`);
      continue;
    }
    assert.ok(goal <= ceiling, `${s.id}: population goal ${goal}, but a sensibly built city of its buildings employs at most ${ceiling} people`);
    assert.ok(employsEnough(s, goal, SENSIBLE), `${s.id}: a city of ${goal} has the jobs`);
  }
  // Only the late missions: the rule holds for the first two and every new one.
  assert.ok(KNOWN_OVER.every((id) => LEGACY_OVER.includes(id)), `KNOWN_OVER ${KNOWN_OVER} may only shrink`);
});

test('capacity model: a mission 1 town of Huts, worked through', () => {
  const c1 = findScenario('c1');
  assert.deepEqual(topLevels(c1), { top: 4, working: 4 });
  assert.equal(peoplePerTile(4), 11);
  // Lean, 200 people: 18 home tiles, eating 50 food a month (a wheat farm makes 80 to 92).
  const plan = planCity(c1, 200, LEAN);
  const count = Object.fromEntries(plan.items.map((it) => [it.key, it.count]));
  assert.deepEqual(count, { prefecture: 2, engineer_post: 2, market: 1, forum: 1, farm_wheat: 1, granary: 1, temple_mercury: 1, temple_ceres: 1 });
  // 2 x 6 + 2 x 5 + 5 + 6 + 10 + 12 + 2 + 2 = 59 jobs for a workforce of 64: 8% idle, fine.
  assert.equal(plan.jobs, 59);
  assert.ok(employsEnough(c1, 200, LEAN));
  // 300 people still have those 59 jobs, for 96 workers: 39% idle.
  assert.equal(jobsFor(c1, 300, LEAN), 59);
  assert.ok(!employsEnough(c1, 300, LEAN));
  assert.equal(employmentCeiling(c1, LEAN), 200);
  // Sensible (the demo city's way): 3 spare farms, 30 more jobs. 300 people
  // have 89 jobs for 96 workers, 7% idle; the demo town of 312 had 95 to 100.
  assert.equal(jobsFor(c1, 300, SENSIBLE), 89);
  assert.equal(employmentCeiling(c1, SENSIBLE), 300);
});

test('capacity model: shows, patricians, trade and winter fields', () => {
  // A theater alone (mission 2): 10 for a visit and a seat base of 6 (full
  // seats for one of the three venue kinds); with an amphitheater and both
  // kinds of show (mission 3 on), 10 + 15 + 5 and a base of 13.
  assert.equal(bestEntertainment(unlockedBuildings(findScenario('c2'))), 16);
  assert.equal(bestEntertainment(unlockedBuildings(findScenario('c3'))), 43);
  // Patricians do not work: with every level open the model's homes are
  // Insulae (level 12), the best whose residents look for work.
  assert.deepEqual(topLevels(findScenario('c7')), { top: 20, working: 12 });
  // What partners buy is work: mission 3 without its trade routes employs fewer.
  const c3 = findScenario('c3');
  assert.ok(employmentCeiling({ ...c3, partners: [] }) < employmentCeiling(c3));
  // The land's food at Insane: production 0.8, and no growth for 3 months in 12.
  assert.ok(Math.abs(lowProduction() - 0.8 * 0.75) < 1e-9);
});

test('capacity model: a villa quarter where the Villa can be reached, its people using services but not working', () => {
  // Urbs Magna at 8,000 people: 5% in Villas (400 people on 36 tiles), the
  // rest Insulae. Its 7,600 plebeians put 2,432 to work, so 2,189 jobs keep
  // unemployment at 10%; the city plans 2,167, just short (the ceiling is
  // 7,900). With every home a working one the same city has 2,106 jobs for
  // 2,560 workers (its ceiling 6,450).
  const c7 = findScenario('c7');
  const plan = planCity(c7, 8000, SENSIBLE);
  assert.equal(PATRICIAN_SHARE, 0.05);
  assert.equal(plan.villaLevel, VILLA_LEVEL);
  assert.equal(HOUSE_TIERS[VILLA_LEVEL].name, 'Villa');
  assert.deepEqual([plan.plebs, plan.villas], [7600, 400]);
  assert.ok(Math.abs(plan.villaTiles - 400 / 11) < 1e-9, 'Villas hold 11 a tile');
  assert.equal(plan.jobs, 2167);
  assert.ok(!employsEnough(c7, 8000, SENSIBLE), 'short of 2,189');
  assert.ok(employsEnough(c7, 7900, SENSIBLE));
  assert.equal(employmentCeiling(c7, SENSIBLE), 7900);
  const working = planCity(c7, 8000, { ...SENSIBLE, villas: 0 });
  assert.deepEqual([working.plebs, working.villas, working.jobs], [8000, 0, 2106]);
  assert.equal(employmentCeiling(c7, { ...SENSIBLE, villas: 0 }), 6450);
  // The villas' walkers are the city's: no service doubled for them, only
  // more of it for their tiles, and their wine.
  const count = (p, key) => p.items.find((it) => it.key === key)?.count || 0;
  for (const key of ['prefecture', 'engineer_post', 'market', 'forum', 'senate', 'barber', 'baths']) assert.ok(count(plan, key) <= count(working, key) + 1, `${key}: ${count(working, key)} -> ${count(plan, key)}`);
  assert.ok(count(plan, 'farm_vine') > count(working, 'farm_vine'), 'the villas drink wine');
  // Missions 1 to 3 cannot reach the Villa: no quarter, and their ceilings stay.
  for (const [id, ceiling] of [['c1', 300], ['c2', 450], ['c3', 980], ['c3m', 1160]]) {
    const s = findScenario(id);
    assert.equal(planCity(s, 500, SENSIBLE).villas, 0, `${id}: no villas`);
    assert.equal(employmentCeiling(s, SENSIBLE), ceiling, id);
  }
});

test('capacity model: only the plebeians look for work', () => {
  // Urbs Magna at 7,900: its 7,505 plebeians put 2,402 to work, and its 2,163
  // jobs employ 90% of them. Counting all 7,900 it would need 2,275.
  const c7 = findScenario('c7');
  const plan = planCity(c7, 7900, SENSIBLE);
  const enough = (n) => plan.jobs >= n * CONFIG.WORKFORCE_RATIO * (1 - CONFIG.UNEMPLOYMENT_MOOD_FREE);
  assert.equal(plan.jobs, 2163);
  assert.ok(enough(plan.plebs) && !enough(7900));
  assert.ok(employsEnough(c7, 7900, SENSIBLE));
  // A city all of villas has no workforce: it never lacks jobs.
  assert.equal(planCity(c7, 1000, { ...SENSIBLE, villas: 1 }).plebs, 0);
  assert.ok(employsEnough(c7, 1000, { ...SENSIBLE, villas: 1 }));
  // And the room they take: Villas hold half an Insula's people a tile.
  const land = { buildable: 10000, meadow: 1e6 };
  assert.equal(landCeiling(c7, land, { villas: 0 }), 73333);
  assert.equal(landCeiling(c7, land), 69841);
});

test('capacity model: food by the kinds the homes eat, docks by the ships, the demand in force', () => {
  // Insulae eat two kinds, half the ration each (sim/housing.js): 4,000 people
  // eat 1,000 a month, 500 of wheat (a farm fills a load in 20 days: 5 farms
  // at Easy's pace) and 500 of vegetables (22 days: 6), and 3 spare farms on
  // the wheat. One kind (Domus, mission 3): all of it on the wheat.
  const c5 = { ...findScenario('c5'), partners: [] };
  const count = (p, key) => p.items.find((it) => it.key === key)?.count || 0;
  const farms = planCity(c5, 4000, SENSIBLE);
  const perFarm = (days) => (CONFIG.CART_CAPACITY * CONFIG.DAYS_PER_MONTH * topProduction()) / days;
  assert.equal(count(farms, 'farm_wheat'), Math.ceil(500 / perFarm(20)) + SENSIBLE.spareFarms);
  assert.equal(count(farms, 'farm_veg'), Math.ceil(500 / perFarm(22)));
  assert.ok(count(farms, 'farm_veg') >= 1 && count(farms, 'farm_fruit') === 0);
  const c3 = { ...findScenario('c3'), partners: [] };
  assert.equal(count(planCity(c3, 900, SENSIBLE), 'farm_veg'), 0, 'a Domus eats one kind');
  // Docks: each sea route's ships a year staying 25 days. Portus Mercatorum's
  // five sea partners send 12 ships a year (2 docks); buying 4,000 a year of
  // several goods, Corinthus and Alexandria send theirs more often (3).
  const portus = findScenario('c5');
  assert.equal(docksFor(portus), 2);
  assert.equal(docksFor(findScenario('c4p')), 1);
  assert.equal(docksFor({ ...portus, demand: { corinthus: { wine: 4000, wheat: 4000, iron: 2500 }, alexandria: { wine: 4000, oil: 4000 } } }), 3);
  assert.equal(docksFor(findScenario('c5p')), 0, 'Beneventum trades by land');
  // The demand the model plans for: a mission's own tiers, and its changes
  // only if they come before its goals can be met (its paceYears). Here the
  // year-3 rise comes in October of year 3 (month 33 of the mission).
  const cosa = { ...portus, map: { ...portus.map, seed: 'cosa' }, paceYears: 3, demand: { corinthus: { wine: 2500 } }, demandChanges: [{ year: 3, partner: 'corinthus', good: 'wine', to: 4000 }] };
  assert.equal(demandChangeAt('cosa', cosa.demandChanges[0], 0), 33);
  assert.equal(demandAt(cosa, 'corinthus').wine, 4000, 'before month 36');
  assert.equal(demandAt({ ...cosa, paceYears: 2.75 }, 'corinthus').wine, 2500, 'after the goals: not counted');
  assert.equal(demandAt({ ...cosa, paceYears: 2.75 }, 'corinthus').wheat, TRADE_PARTNERS.corinthus.buys.wheat, 'the rest from its table');
  assert.ok(employmentCeiling(cosa, SENSIBLE) > employmentCeiling({ ...cosa, paceYears: 2.75 }, SENSIBLE), 'more demand, more jobs');
});

test('mission 1, built only with its own buildings and sized to its jobs, is won', () => {
  // A town of 40 plots holds a little over the goal's people (some stay
  // tents, with no well in reach). The plot count is tuned: the goal is the
  // sensible ceiling, so a few more plots push unemployment past 10% (44
  // plots: 348 people, 14%). Its jobs keep everyone at work, so the mood
  // stays at PEACE_MOOD or more after the new city's first year and peace
  // reaches its goal. The whole demo site (about 600 people for the same
  // 100 jobs) stalls with half its workers idle.
  const s = findScenario('c1');
  const game = new Game({ scenario: s, flags: {} });
  let won = null;
  game.events.on('victory', () => {
    const c = game.city;
    won ??= { month: game.time.totalMonths, population: c.population, unemployment: c.unemploymentRate, mood: c.sentiment };
  });
  assert.ok(buildDemoCity(game, { level: 2, homes: 40 }).ok);
  game.runDays(24 * CONFIG.DAYS_PER_MONTH);
  const c = game.city;
  assert.ok(won !== null, `won (${c.population} people, peace ${c.ratings.peace}, culture ${c.ratings.culture})`);
  assert.ok(won.population >= s.goals.population, `${won.population} people when won, goal ${s.goals.population}`);
  assert.ok(won.unemployment <= CONFIG.UNEMPLOYMENT_MOOD_FREE, `unemployment ${Math.round(won.unemployment * 100)}% when won`);
  assert.ok(won.mood >= CONFIG.PEACE_MOOD, `mood ${won.mood} when won`);
  // And it stays so: a year on, still at work and content.
  assert.ok(c.unemploymentRate <= CONFIG.UNEMPLOYMENT_MOOD_FREE && c.sentiment >= CONFIG.PEACE_MOOD, `month 24: unemployment ${Math.round(c.unemploymentRate * 100)}%, mood ${c.sentiment}`);
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

test('every mission with a shipyard can get timber for its boats: woods for a timber yard, and shore for the yard', () => {
  // Fishing boats take timber (Colonia's own rule, sim/fishing.js), so a
  // mission that unlocks the shipyard must let the player fell it. Paestum
  // (c4p) and Portus Mercatorum (c5) have no partner selling timber: there it
  // must be felled, so every such map needs woods for a timber yard.
  const missions = SCENARIOS.filter((s) => unlockedBuildings(s).has('shipyard'));
  assert.ok(missions.length >= 5, missions.map((s) => s.id).join(' '));
  for (const s of missions) {
    assert.ok(unlockedBuildings(s).has('timber_yard'), `${s.id}: the timber yard comes with the shipyard`);
    const game = new Game({ scenario: s, flags: {} });
    const anySite = (type) => {
      for (let y = 0; y < game.map.h - 1; y++) for (let x = 0; x < game.map.w - 1; x++) if (checkBuilding(game, type, x, y).ok) return true;
      return false;
    };
    assert.ok(anySite('shipyard'), `${s.id}: shore for a shipyard`);
    assert.ok(anySite('timber_yard'), `${s.id}: woods for a timber yard`);
  }
});

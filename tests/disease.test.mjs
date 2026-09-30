/**
 * disease.test.mjs - headless tests for health and disease (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * From the worked examples of the disease design: the house health score
 * (the level's points, health care, baths, barber, fountain water, food, the
 * hunger cap), disease risk growing like fire risk (crowding, the lever, a
 * hospital's reach) and a physician's visit resetting it, outbreaks with and
 * without a hospital, a sick home spreading once a day per neighbor, a
 * medicus sending a physician (and a physician on his rounds called over
 * first), no disease below 200 people nor in the first two missions, city
 * health, grouped messages, what the player sees (the Health and Problems
 * overlays, the sprite key, walker talk) and saves (round trip, version 5
 * and version 4).
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { SCENARIOS, withDifficulty } from '../src/data/scenarios.js';
import { Game } from '../src/core/game.js';
import { addBuilding, spawnWalker } from '../src/sim/entities.js';
import { startRoaming } from '../src/sim/movement.js';
import { roamerVisit } from '../src/sim/services.js';
import { settlerArrive, indexHomesByRoad } from '../src/sim/population.js';
import { updateHouse } from '../src/sim/housing.js';
import { updateWalkers } from '../src/sim/walkers.js';
import { WaterBits } from '../src/world/map.js';
import {
  healthScore, healthLacks, crowding, dailyRisk, outbreakDeaths, updateDiseaseRisk, outbreak,
  updateSickHomes, updateCityHealth, houseHealth, diseaseEnabled, dispatchPhysician, refreshDiseaseGate, cureHome,
} from '../src/sim/disease.js';
import { healthTip, healthColumn, riskWords } from '../src/ui/healthInfo.js';
import { problemOf, PROBLEM_LEGEND, UNREST_COLOR } from '../src/ui/problems.js';
import { SICK_COLOR } from '../src/data/disease.js';
import { overlayByKey } from '../src/render/overlays.js';
import { buildingKey } from '../src/render/renderer.js';
import { buildingSpec } from '../src/render/buildingArt.js';
import { recordingContext } from '../src/render/draw.js';
import { cityTrouble, walkerSays, walkerDoing } from '../src/ui/walkerTalk.js';
import { newGame, build, findFree } from './helpers.mjs';

log.setLevel('error');

/** What a home has, for healthScore: nothing, unless given. */
const has = (o = {}) => ({ tier: 5, medicus: false, hospital: false, baths: false, barber: false, fountain: false, well: false, foods: 0, eats: true, ...o });

/** An occupied home at (x, y) (placed directly, like a save would). */
function home(game, x, y, { tier = 3, pop = 9, size = 1 } = {}) {
  const b = addBuilding(game, 'house', x, y, size);
  Object.assign(b.house, { tier, pop, mood: 60 });
  return b;
}

/** A straight east-west road on open land: { x0, x1, y }. */
function road(game, len, h = 7) {
  const spot = findFree(game, len + 2, h);
  assert.ok(spot, 'room for a road');
  const y = spot.y + 3;
  const x0 = spot.x + 1;
  const x1 = x0 + len - 1;
  assert.ok(build(game, 'road', x0, y, x1, y).ok, 'road built');
  return { x0, x1, y };
}

/** Walkers only (no daily jobs: labor would unstaff a test medicus). */
function stepWalkers(game, ticks, until = () => false) {
  for (let t = 0; t < ticks && !until(); t++) {
    game.time.totalTicks++;
    updateWalkers(game);
  }
}

/** Set the population as the day's count would, gate included (disease reads the gate: diseaseActive). */
function setPop(game, n) {
  game.city.population = n;
  refreshDiseaseGate(game);
}

/** A game big enough for disease, with a street to build on. */
function street(seed, opts = {}) {
  const game = newGame({ size: 128, type: 'plains', seed, ...opts });
  const r = road(game, 24);
  setPop(game, 500);
  return { game, ...r };
}

// ---------------------------------------------------------------------------
// The health score
// ---------------------------------------------------------------------------

test('health score: the level, health care, baths, barber, fountain water and food', () => {
  // The design's example: level 9 with a medicus only, baths, barber, fountain, 2 foods.
  assert.equal(healthScore(has({ tier: 9, medicus: true, baths: true, barber: true, fountain: true, foods: 2 })), 9 + 30 + 15 + 10 + 10 + 20);
  // Health care: both 50, a hospital alone 40, a medicus alone 30.
  assert.equal(healthScore(has({ tier: 0, eats: false, medicus: true, hospital: true })), 50);
  assert.equal(healthScore(has({ tier: 0, eats: false, hospital: true })), 40);
  assert.equal(healthScore(has({ tier: 0, eats: false, medicus: true })), 30);
  // The level counts up to 10; a well is not fountain water.
  assert.equal(healthScore(has({ tier: 16, foods: 1 })), 10 + 10);
  assert.equal(healthScore(has({ tier: 4, well: true, foods: 1 })), 4 + 10);
  // At most 100, and at most 40 for a home that eats and has no food at all.
  assert.equal(healthScore(has({ tier: 14, medicus: true, hospital: true, baths: true, barber: true, fountain: true, foods: 3 })), 100);
  assert.equal(healthScore(has({ tier: 8, medicus: true, hospital: true, baths: true, barber: true, fountain: true, foods: 0 })), 40);
  assert.equal(healthScore(has({ tier: 1, eats: false, medicus: true })), 31, 'tents forage: no hunger cap');
  // What lowers it, most points first.
  assert.deepEqual(healthLacks(has({ well: true, foods: 1 })), ['care', 'baths', 'barber', 'well', 'food']);
  assert.deepEqual(healthLacks(has({ medicus: true, baths: true, barber: true, fountain: true, foods: 0 })), ['hunger', 'hospital']);
  assert.deepEqual(healthLacks(has({ hospital: true, medicus: true, baths: true, barber: true, fountain: true, foods: 3 })), ['food'], 'a fourth kind of food would add 10');
  assert.deepEqual(healthLacks(has({ hospital: true, medicus: true, baths: true, barber: true, fountain: true, foods: 4 })), []);
});

test('disease risk: a crowded, unvisited, unhealthy home falls sick in about 8-12 months on Normal; a healthy one practically never', () => {
  assert.equal(crowding(0), CONFIG.DISEASE_CROWD_BASE);
  assert.equal(crowding(40), 1.5);
  assert.equal(crowding(400), CONFIG.DISEASE_CROWD_BASE + CONFIG.DISEASE_CROWD_MAX, 'crowding tops out');
  const months = (score, pop, lever = 1) => CONFIG.DISEASE_THRESHOLD / dailyRisk(score, pop, lever) / CONFIG.DAYS_PER_MONTH;
  const poor = months(20, 40);
  assert.ok(poor >= 8 && poor <= 12, `a poor, crowded home: ${poor.toFixed(1)} months`);
  assert.ok(months(80, 40) > 36, `a healthy one: ${months(80, 40).toFixed(1)} months, with no physician ever calling`);
  assert.ok(Math.abs(months(20, 40, 0.5) - 2 * poor) < 1e-9, 'Easy: half as fast');
  assert.ok(months(20, 10) > poor, 'an emptier home is slower');
});

test('disease risk grows daily like fire risk, x the lever, halved by a hospital; a physician resets it', () => {
  const { game, x0, y } = street('risk', { difficulty: 'hard' });
  const b = home(game, x0 + 3, y + 1, { tier: 3, pop: 20 });
  game.rng.next = () => 0.5; // the day's roll: x1.0 exactly, and no outbreak (0.5 is not under 0.25)
  const want = dailyRisk(houseHealth(game, b), 20, 1.3);
  updateDiseaseRisk(game, b);
  assert.ok(Math.abs(b.house.diseaseRisk - want) < 1e-9, `${b.house.diseaseRisk} vs ${want}`);
  game.map.water[game.map.idx(b.x, b.y)] |= WaterBits.HOSPITAL;
  const before = b.house.diseaseRisk;
  updateDiseaseRisk(game, b);
  const hospitalScore = houseHealth(game, b); // a hospital also raises its score
  assert.ok(Math.abs(b.house.diseaseRisk - before - dailyRisk(hospitalScore, 20, 1.3) / 2) < 1e-9, 'halved within a hospital\'s reach');
  // A physician walking by clears it, as a prefect clears fire risk.
  const doc = spawnWalker(game, 'physician', game.map.idx(x0 + 3, y), null, {});
  roamerVisit(game, doc);
  assert.equal(b.house.diseaseRisk, 0);
  assert.ok(b.house.clinic > 0, 'and gives the home a medicus visit');
});

test('at the threshold a home has a 25% chance a day to fall sick', () => {
  const { game, x0, y } = street('threshold');
  const b = home(game, x0 + 3, y + 1, { pop: 10 });
  b.house.diseaseRisk = CONFIG.DISEASE_THRESHOLD - 0.001;
  const asked = [];
  game.rng.chance = (p) => { asked.push(p); return true; };
  game.rng.next = () => 0.5;
  updateDiseaseRisk(game, b);
  assert.deepEqual(asked, [CONFIG.DISEASE_OUTBREAK_CHANCE]);
  assert.equal(b.house.sick, CONFIG.SICK_DAYS);
  assert.equal(b.house.diseaseRisk, 0, 'the risk is spent');
});

test('no disease below 200 people, nor in the first two missions; the lever by difficulty', () => {
  const { game, x0, y } = street('small');
  const b = home(game, x0 + 3, y + 1, { pop: 10 });
  let draws = 0;
  const next = game.rng.next.bind(game.rng);
  game.rng.next = () => { draws++; return next(); };
  setPop(game, CONFIG.DISEASE_MIN_POP - 1);
  updateDiseaseRisk(game, b);
  assert.equal(b.house.diseaseRisk, 0);
  assert.equal(draws, 0, 'a small town draws no random number');
  setPop(game, CONFIG.DISEASE_MIN_POP);
  updateDiseaseRisk(game, b);
  assert.ok(b.house.diseaseRisk > 0);
  // The first two missions have none at all.
  for (const s of SCENARIOS) assert.equal(diseaseEnabled({ scenario: withDifficulty(s, 'insane') }), !['c1', 'c2'].includes(s.id), s.id);
  const c1 = new Game({ scenario: SCENARIOS[0], flags: { money: 50000 } });
  const r = road(c1, 12);
  const h1 = home(c1, r.x0 + 2, r.y + 1, { pop: 10 });
  setPop(c1, 5000);
  h1.house.diseaseRisk = 500;
  c1.rng.chance = () => true;
  updateDiseaseRisk(c1, h1);
  assert.equal(h1.house.sick, 0, 'never sick in mission 1');
  const lever = (d) => new Game({ scenario: withDifficulty(SCENARIOS[2], d) }).difficulty.disease;
  assert.deepEqual(['easy', 'normal', 'hard', 'insane'].map(lever), [0.5, 1, 1.3, 1.5]);
});

// ---------------------------------------------------------------------------
// Outbreaks
// ---------------------------------------------------------------------------

test('an outbreak kills a fifth of the home (a tenth within a hospital\'s reach), at least one', () => {
  assert.equal(outbreakDeaths(20), 4);
  assert.equal(outbreakDeaths(20, true), 2);
  assert.equal(outbreakDeaths(9), 2);
  assert.equal(outbreakDeaths(3), 1, 'at least one');
  assert.equal(outbreakDeaths(3, true), 1);
  assert.equal(outbreakDeaths(1), 1);
  assert.equal(outbreakDeaths(0), 0);
  const { game, x0, y } = street('outbreak');
  const a = home(game, x0 + 3, y + 1, { pop: 20 });
  const b = home(game, x0 + 8, y + 1, { pop: 20 });
  game.map.water[game.map.idx(b.x, b.y)] |= WaterBits.HOSPITAL;
  assert.equal(outbreak(game, a), 4);
  assert.equal(outbreak(game, b), 2);
  assert.deepEqual([a.house.pop, a.house.sick, b.house.pop, b.house.sick], [16, CONFIG.SICK_DAYS, 18, CONFIG.SICK_DAYS]);
  assert.equal(outbreak(game, a), 0, 'a sick home cannot fall sick again');
  const hc = game.city.health;
  assert.deepEqual([hc.year.outbreaks, hc.year.deaths, hc.total.deaths], [2, 6, 6]);
  // A home left empty becomes a vacant lot.
  const lone = home(game, x0 + 14, y + 1, { pop: 1 });
  assert.equal(outbreak(game, lone), 1);
  assert.equal(lone.house.sick, 0, 'nobody left to be sick');
  updateHouse(game, lone);
  assert.equal(lone.house.tier, 0);
});

test('a sick home spreads the disease to each home touching it once a day, however many sick homes it touches', () => {
  const { game, x0, y } = street('spread');
  const a = home(game, x0 + 3, y + 1);
  const mid = home(game, x0 + 4, y + 1);
  const c = home(game, x0 + 5, y + 1);
  a.house.sick = 10;
  c.house.sick = 10;
  const asked = [];
  game.rng.chance = (p) => { asked.push(p); return false; };
  updateSickHomes(game);
  assert.deepEqual(asked, [CONFIG.DISEASE_SPREAD_CHANCE], 'one roll for the home between two sick ones');
  assert.equal(mid.house.diseaseRisk, CONFIG.DISEASE_HEAT, 'heated once');
  assert.deepEqual([a.house.sick, c.house.sick], [9, 9], 'the days count down');
  // Within a hospital's reach the chance is halved; when it comes, the home falls sick.
  game.map.water[game.map.idx(mid.x, mid.y)] |= WaterBits.HOSPITAL;
  game.rng.chance = (p) => { asked.push(p); return true; };
  updateSickHomes(game);
  assert.equal(asked[1], CONFIG.DISEASE_SPREAD_CHANCE / 2);
  assert.ok(mid.house.sick > 0);
  assert.equal(game.city.health.year.spread, 1);
  // Left alone, a sick home recovers when its days run out.
  a.house.sick = 1;
  game.rng.chance = () => false;
  updateSickHomes(game);
  assert.equal(a.house.sick, 0);
  assert.ok(game.city.health.year.recovered >= 1);
});

test('a sick home does not move up and takes in no settlers', () => {
  const { game, x0, y } = street('no-growth');
  assert.ok(build(game, 'well', x0 + 3, y + 2).ok);
  const b = home(game, x0 + 3, y + 1, { tier: 1, pop: 3 });
  b.house.sick = 5;
  updateHouse(game, b);
  assert.equal(b.house.tier, 1, 'sick: stays a Tent');
  assert.equal(b.house.blocked[0].key, 'sick');
  b.house.sick = 0;
  updateHouse(game, b);
  assert.equal(b.house.tier, 2, 'well again: it moves up');
  // Settlers who arrive at a home that fell sick on their way look elsewhere.
  b.house.sick = 5;
  b.house.incoming = 3;
  const w = spawnWalker(game, 'immigrant', b.accessRoad, null, { people: 3, target: b.id, state: 'toHouse', reserve: { id: b.id, people: 3 } });
  const pop = b.house.pop;
  settlerArrive(game, w);
  assert.equal(b.house.pop, pop, 'nobody moved in');
  assert.equal(b.house.incoming, 0);
});

// ---------------------------------------------------------------------------
// Physicians
// ---------------------------------------------------------------------------

/** A street with a staffed medicus at its east end. */
function medicusStreet(seed) {
  const s = street(seed);
  const med = addBuilding(s.game, 'clinic', s.x1 - 1, s.y + 1);
  med.efficiency = 1;
  med.workers = med.def.workers;
  return { ...s, med };
}

test('a staffed medicus sends a physician to an outbreak; he cures the home and goes back', () => {
  const { game, x0, y, med } = medicusStreet('dispatch');
  const b = home(game, x0 + 2, y + 1, { pop: 15 });
  outbreak(game, b);
  const docs = [...game.walkers.values()].filter((w) => w.type === 'physician');
  assert.equal(docs.length, 1);
  const doc = docs[0];
  assert.deepEqual([doc.state, doc.target, doc.origin], ['toSick', b.id, med.id]);
  assert.ok(game.messages.some((m) => /Disease has broken out in .*A physician is on the way/.test(m.text)));
  assert.equal(dispatchPhysician(game, b), true, 'one on the way is enough');
  assert.equal([...game.walkers.values()].filter((w) => w.type === 'physician').length, 1);
  stepWalkers(game, 2000, () => b.house.sick === 0);
  assert.equal(b.house.sick, 0, 'cured');
  assert.equal(game.city.health.year.cured, 1);
  let treated = false;
  stepWalkers(game, 500, () => { treated ||= doc.state === 'treat'; return doc.state === 'return'; });
  assert.ok(treated, 'he stayed with the sick a while');
  assert.equal(doc.state, 'return', 'then he heads back to the medicus');
});

test('a physician on his rounds nearby is called over before the medicus sends another', () => {
  const { game, x0, y, med } = medicusStreet('rounds');
  const b = home(game, x0 + 2, y + 1, { pop: 15 });
  const doc = spawnWalker(game, 'physician', game.map.idx(x0 + 9, y), med, {});
  startRoaming(game, doc, 3);
  outbreak(game, b);
  assert.deepEqual([doc.state, doc.target], ['toSick', b.id]);
  assert.equal([...game.walkers.values()].filter((w) => w.type === 'physician').length, 1);
  // With no medicus in reach, the message says so.
  const far = street('no-medicus');
  const lone = home(far.game, far.x0 + 2, far.y + 1, { pop: 15 });
  outbreak(far.game, lone);
  assert.ok(far.game.messages.some((m) => /No physician is near enough/.test(m.text)));
});

test('after treating, a physician goes on to the next sick home nobody is seeing to', () => {
  const { game, x0, x1, y } = medicusStreet('next');
  const a = home(game, x1 - 5, y + 1, { pop: 15 }); // near the medicus at the east end
  const b = home(game, x0 + 1, y - 1, { pop: 15 }); // far west: not on the way to a
  b.house.sick = 20;
  outbreak(game, a);
  const doc = [...game.walkers.values()].find((w) => w.type === 'physician');
  assert.equal(doc.target, a.id);
  stepWalkers(game, 3000, () => doc.state === 'toSick' && doc.target === b.id);
  assert.equal(a.house.sick, 0, 'a treated');
  assert.ok(b.house.sick > 0, 'b not yet: it is off his way');
  assert.deepEqual([doc.state, doc.target], ['toSick', b.id], 'from a he goes on to b');
  stepWalkers(game, 3000, () => b.house.sick === 0);
  assert.equal(b.house.sick, 0);
});

// ---------------------------------------------------------------------------
// City health and messages
// ---------------------------------------------------------------------------

test('city health moves 2 a month toward the residents\' average score, and stays at 50 in a small town', () => {
  const { game, x0, y } = street('city-health');
  const a = home(game, x0 + 3, y + 1, { tier: 3, pop: 100 });
  const b = home(game, x0 + 8, y + 1, { tier: 6, pop: 300 });
  a.house.food.wheat = 5;
  b.house.clinic = 10;
  const want = Math.round((houseHealth(game, a) * 100 + houseHealth(game, b) * 300) / 400);
  const hc = game.city.health;
  assert.equal(hc.value, CONFIG.HEALTH_START);
  updateCityHealth(game);
  assert.equal(hc.target, want);
  assert.equal(hc.value, CONFIG.HEALTH_START + Math.sign(want - CONFIG.HEALTH_START) * CONFIG.HEALTH_STEP);
  setPop(game, CONFIG.DISEASE_MIN_POP - 1);
  updateCityHealth(game);
  assert.deepEqual([hc.value, hc.target], [CONFIG.HEALTH_START, CONFIG.HEALTH_START], 'too small to judge');
});

test('one outbreak pop-up a month; the rest are summed up once the month has turned', () => {
  const { game, x0, y } = street('messages');
  const homes = [0, 3, 6].map((k) => home(game, x0 + 3 + k, y + 1, { pop: 10 }));
  for (const b of homes) outbreak(game, b);
  const said = game.messages.filter((m) => /^Disease has/.test(m.text));
  assert.equal(said.length, 1);
  // Not within the month they happened in (on the 1st, homes tick before the
  // month's report, and theirs belong to the new month)...
  updateCityHealth(game);
  assert.equal(game.city.health.quiet, 2, 'not summed up in their own month');
  // ...but once the month has turned.
  game.runDays(CONFIG.DAYS_PER_MONTH);
  assert.ok(game.messages.some((m) => /^Disease struck 2 more homes last month; 4 residents died\./.test(m.text)));
  assert.equal(game.city.health.quiet, 0);
});

// ---------------------------------------------------------------------------
// What the player sees
// ---------------------------------------------------------------------------

test('Disease overlay: columns by disease risk, sick homes in their own color, words in the tooltip', () => {
  const { game, x0, y } = street('overlay');
  const b = home(game, x0 + 3, y + 1, { tier: 4, pop: 11 });
  b.house.food.wheat = 5;
  game.map.water[game.map.idx(b.x, b.y)] |= WaterBits.WELL;
  b.house.diseaseRisk = 45;
  // The Health overlay still shows who a barber, medicus and baths reach.
  const care = overlayByKey('health');
  b.house.barber = 10;
  assert.ok(Math.abs(care.house(b) - 1 / 3) < 1e-9, 'Health: barber, medicus, baths reach');
  b.house.barber = 0;
  const ov = overlayByKey('disease');
  assert.ok(Math.abs(ov.column(b, game).v - 0.45) < 1e-9);
  assert.equal(riskWords(45), 'Some risk of disease');
  assert.equal(healthTip(game, b), 'Health 14 (wretched): no medicus or hospital, no baths, no barber, well water only, not every kind of food. Some risk of disease.');
  b.house.sick = 12;
  assert.deepEqual(ov.column(b, game), { v: 1, color: SICK_COLOR });
  assert.match(healthTip(game, b), /^Sick: 12 days left, unless a physician cures it sooner\./);
  assert.ok(ov.legend.some(([c, l]) => c === SICK_COLOR && /Sick/.test(l)));
  b.house.pop = 0;
  assert.equal(healthColumn(b), null, 'empty homes get no column');
  // In the first two missions the tooltip says there is no disease.
  const c1 = new Game({ scenario: SCENARIOS[0], flags: {} });
  const r = road(c1, 8);
  const h1 = home(c1, r.x0 + 2, r.y + 1, { pop: 5 });
  assert.match(healthTip(c1, h1), /\(There is no disease in this province\.\)$/);
});

test('Problems overlay: sick homes, then homes falling back, then homes in unrest, before what a home lacks', () => {
  const { game, x0, y } = street('problems');
  const b = home(game, x0 + 3, y + 1, { tier: 4, pop: 11 });
  b.house.blocked = [{ key: 'water', have: 1, need: 2 }];
  assert.match(problemOf(game, b).text, /fountain/);
  b.house.mood = 20;
  b.house.moodReason = 'taxes';
  const unrest = problemOf(game, b);
  assert.equal(unrest.color, UNREST_COLOR);
  assert.equal(unrest.text, 'Hut, in unrest: mood 20 (resentful). Taxes are too high.');
  // Falling back a level is more urgent than unrest: it has days to act.
  b.house.devolving = true;
  b.house.devolveDays = 1;
  assert.match(problemOf(game, b).text, /^Hut, falling back to Lean-to in \d+ days?\. Needs: /);
  b.house.devolving = false;
  b.house.mood = 45;
  b.house.criminal = 1;
  assert.match(problemOf(game, b).text, /sent a protester out/, 'a home that sent a criminal is in unrest whatever its mood');
  b.house.sick = 3;
  const sick = problemOf(game, b);
  assert.deepEqual([sick.color, sick.v], [SICK_COLOR, 1]);
  assert.match(sick.text, /^Hut\. Sick: 3 days left/);
  assert.ok(PROBLEM_LEGEND.findIndex(([c]) => c === SICK_COLOR) === 0 && PROBLEM_LEGEND.some(([c]) => c === UNREST_COLOR));
  // No unrest where there is no crime (the first two missions).
  const c1 = new Game({ scenario: SCENARIOS[0], flags: {} });
  const r = road(c1, 8);
  const h1 = home(c1, r.x0 + 2, r.y + 1, { pop: 5 });
  h1.house.mood = 5;
  h1.house.blocked = [];
  assert.equal(problemOf(c1, h1), null);
});

test('a sick home has a sprite of its own (before the snow suffix), drawn with its sign', () => {
  const { game, x0, y } = street('sprite');
  const b = home(game, x0 + 3, y + 1, { tier: 5, pop: 10 });
  assert.equal(buildingKey(b, 2, 5), `b:house:1:2:5`);
  b.house.sick = 4;
  const key = buildingKey(b, 2, 5);
  assert.equal(key, 'b:house:1:2:5:sick');
  assert.ok(`${key}~n2`.endsWith('~n2'), 'the snow suffix still comes last');
  b.house.pop = 0;
  assert.equal(buildingKey(b, 2, 5), 'b:house:1:2:5', 'an empty home is not sick');
  for (const [S, tier] of [[1, 5], [2, 11], [3, 16], [4, 20]]) {
    const { ctx } = recordingContext();
    buildingSpec('house', S, 1, tier, true, 0, true).draw(ctx);
  }
});

test('citizens talk about disease; a physician sent to the sick says so', () => {
  const { game, x0, y, med } = medicusStreet('talk');
  const b = home(game, x0 + 2, y + 1, { pop: 15 });
  assert.notEqual(cityTrouble(game), 'sick');
  outbreak(game, b);
  assert.equal(cityTrouble(game), 'sick');
  const doc = [...game.walkers.values()].find((w) => w.type === 'physician');
  assert.match(walkerDoing(game, doc), /^Hurrying to a sick /);
  assert.match(walkerSays(game, doc), /fever|linen/);
  assert.ok(med);
});

// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

test('save: disease risk, sick days, city health and a physician on his way come back', () => {
  const { game, x0, y } = medicusStreet('save-disease');
  const b = home(game, x0 + 2, y + 1, { pop: 15 });
  const other = home(game, x0 + 6, y + 1, { pop: 12 });
  other.house.diseaseRisk = 37.5;
  outbreak(game, b);
  game.city.health.value = 44;
  const copy = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  assert.deepEqual([copy.buildings.get(b.id).house.sick, copy.buildings.get(other.id).house.diseaseRisk], [CONFIG.SICK_DAYS, 37.5]);
  assert.deepEqual(copy.city.health, game.city.health);
  const doc = [...copy.walkers.values()].find((w) => w.type === 'physician');
  assert.ok(doc && doc.state === 'toSick' && doc.target === b.id);
});

test('save: version 5 (before disease) and version 4 saves load with nobody sick and play on; version 3 is refused', () => {
  const game = newGame({ size: 96, type: 'plains', seed: 'v5-save' });
  const { x0, y } = road(game, 12);
  const b = home(game, x0 + 2, y + 1, { pop: 12 });
  game.runDays(3);
  const v5 = JSON.parse(JSON.stringify(serializeGame(game)));
  // What version 5 wrote: no disease fields, no city health.
  v5.version = 5;
  delete v5.city.health;
  for (const raw of v5.buildings) if (raw.house) { delete raw.house.diseaseRisk; delete raw.house.sick; }
  const copy = deserializeGame(v5);
  const h = copy.buildings.get(b.id).house;
  assert.deepEqual([h.diseaseRisk, h.sick], [0, 0]);
  assert.equal(copy.city.health.value, CONFIG.HEALTH_START);
  assert.equal(copy.city.health.total.outbreaks, 0);
  copy.runDays(20);
  assert.ok(Number.isFinite(copy.buildings.get(b.id)?.house.diseaseRisk ?? 0));
  const cb = copy.buildings.get(b.id);
  if (cb && cb.house.pop > 0) {
    setPop(copy, 500);
    updateDiseaseRisk(copy, cb);
    assert.ok(cb.house.diseaseRisk > 0, 'and disease runs on it once the city is big enough');
  }
  // Version 4 (before crime too) still upgrades through both steps.
  const v4 = JSON.parse(JSON.stringify(v5));
  v4.version = 4;
  delete v4.city.crime;
  for (const raw of v4.buildings) if (raw.house) for (const k of ['mood', 'moodReason', 'moodTarget', 'hungerStreak', 'criminal', 'police']) delete raw.house[k];
  const old = deserializeGame(v4);
  const oh = old.buildings.get(b.id).house;
  assert.deepEqual([oh.diseaseRisk, oh.sick, oh.criminal], [0, 0, 0]);
  assert.equal(oh.mood, old.city.sentiment);
  old.runDays(20);
  v4.version = 3;
  assert.throws(() => deserializeGame(v4), /older version of Colonia/);
});

// ---------------------------------------------------------------------------
// From the reviews
// ---------------------------------------------------------------------------

test('disease goes by the day\'s count of people, so a save made the day a city passes 200 plays out the same', () => {
  // Homes tick before the day's count: reading city.population they saw
  // yesterday's number, while a loaded game counts afresh, and the two drew
  // different random numbers from then on.
  const { game, x0, y } = street('gate');
  const b = home(game, x0 + 3, y + 1, { pop: 10 });
  setPop(game, CONFIG.DISEASE_MIN_POP - 1);
  game.city.population = CONFIG.DISEASE_MIN_POP + 50; // settlers came in during the day
  let draws = 0;
  const next = game.rng.next.bind(game.rng);
  game.rng.next = () => { draws++; return next(); };
  updateDiseaseRisk(game, b);
  assert.equal(draws, 0, 'not until the day\'s count says so');
  const copy = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  assert.equal(copy.city.health.bigEnough, false, 'a loaded game agrees, whatever it counts on loading');
  refreshDiseaseGate(game);
  updateDiseaseRisk(game, b);
  assert.ok(draws > 0 && b.house.diseaseRisk > 0, 'from the next count on');
});

test('one physician for a cluster: none is sent to a sick home near one another is heading to', () => {
  const { game, x0, y } = medicusStreet('cluster');
  const a = home(game, x0 + 2, y + 1, { pop: 15 });
  const b = home(game, x0 + 3, y + 1, { pop: 15 });
  const c = home(game, x0 + 2 + CONFIG.PHYSICIAN_NEAR + 3, y + 1, { pop: 15 });
  outbreak(game, a);
  outbreak(game, b);
  const docs = () => [...game.walkers.values()].filter((w) => w.type === 'physician').length;
  assert.equal(docs(), 1, 'the neighbour waits for the one already coming');
  outbreak(game, c);
  assert.equal(docs(), 2, 'a home further off gets its own');
});

test('a cured home is well at once: nothing about sickness is left among its needs', () => {
  const { game, x0, y } = street('cured');
  const b = home(game, x0 + 3, y + 1, { tier: 4, pop: 11 });
  b.house.sick = 6;
  b.house.blocked = [{ key: 'sick', have: 6, need: 0 }, { key: 'water', have: 1, need: 2 }];
  cureHome(game, b);
  assert.equal(b.house.sick, 0);
  assert.deepEqual(b.house.blocked.map((m) => m.key), ['water']);
  assert.doesNotMatch(problemOf(game, b).text, /sick|well again/i);
});

test('no spread in a town under 200 people', () => {
  const { game, x0, y } = street('small-spread');
  const a = home(game, x0 + 3, y + 1, { pop: 10 });
  const b = home(game, x0 + 4, y + 1, { pop: 10 });
  a.house.sick = 10;
  setPop(game, CONFIG.DISEASE_MIN_POP - 1);
  game.rng.chance = () => true;
  updateSickHomes(game);
  assert.deepEqual([b.house.diseaseRisk, b.house.sick], [0, 0]);
  setPop(game, CONFIG.DISEASE_MIN_POP);
  updateSickHomes(game);
  assert.ok(b.house.sick > 0, 'and it spreads once the city is big enough');
});

/**
 * crime.test.mjs - headless tests for home mood and crime (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * From the worked examples of the crime design: home mood (a target plus
 * smoothing, hunger, envy, untaxed homes, a new household), the daily chance
 * (one smooth line, halved by police cover, times the difficulty), which home
 * a crime comes from (a home that has used up its criminals no longer blocks
 * the rest), what it produces, theft amounts and the cap, a prefect catching
 * a thief before he steals (and hunting one down), riot mob sizes, the mob's
 * target, what rioters burn, peace, no crime in small towns or the first two
 * missions, the crime overlay's words, and saves (round trip and version 4).
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { DIFFICULTY, difficultyOf } from '../src/data/difficulty.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { SCENARIOS, withDifficulty } from '../src/data/scenarios.js';
import { Game } from '../src/core/game.js';
import { addBuilding, spawnWalker } from '../src/sim/entities.js';
import { startRoaming, followPath } from '../src/sim/movement.js';
import { roamerVisit } from '../src/sim/services.js';
import { settlerArrive } from '../src/sim/population.js';
import { growHouse } from '../src/sim/housing.js';
import { Terrain } from '../src/world/map.js';
import { updateWalkers } from '../src/sim/walkers.js';
import { igniteBuilding } from '../src/sim/risk.js';
import { updateRatings } from '../src/sim/ratings.js';
import { updateHomeMoods, envyPenalty } from '../src/sim/mood.js';
import {
  crimeChance, crimeOutcome, theftAmount, mobSize, pickCrimeHouse, pickRiotTarget, riotEligible,
  updateCrime, updateCriminals, commitCrime, startRiot, rioterStep, crimeEnabled,
} from '../src/sim/crime.js';
import { crimeBand, crimeTip, moodWord } from '../src/ui/crimeInfo.js';
import { newGame, build, findFree } from './helpers.mjs';

log.setLevel('error');

/** An occupied home at (x, y) (placed directly, like a save would). */
function home(game, x, y, { tier = 3, pop = 9, mood = 40, criminal = 0 } = {}) {
  const b = addBuilding(game, 'house', x, y, 1);
  Object.assign(b.house, { tier, pop, mood, criminal });
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

/** Walkers and criminals only (no daily jobs: labor would unstaff a test forum). */
function stepCriminals(game, ticks, until = () => false) {
  for (let t = 0; t < ticks && !until(); t++) {
    game.time.totalTicks++;
    updateWalkers(game);
    updateCriminals(game);
  }
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

test('crime chance: one smooth line from 61% at mood 0 to nothing at 108', () => {
  const close = (a, b) => Math.abs(a - b) < 0.005;
  for (const [s, p] of [[0, 0.61], [30, 0.44], [45, 0.36], [60, 0.27], [80, 0.16], [100, 0.05], [108, 0], [120, 0]]) {
    assert.ok(close(crimeChance(s), p), `mood ${s}: ${crimeChance(s).toFixed(3)} (want ~${p})`);
  }
  // No jumps at the original's band edges (29 to 30, 59 to 60): never rising.
  for (let s = 1; s <= 110; s++) assert.ok(crimeChance(s) <= crimeChance(s - 1), `mood ${s}`);
});

test('crime outcome: the worst the home can produce, flags and city mood permitting', () => {
  const T = CONFIG.THIEF_MOOD;
  const R = CONFIG.RIOT_MOOD;
  const angry = CONFIG.RIOT_CITY_MOOD - 1;
  assert.equal(crimeOutcome(CONFIG.CRIME_MOOD, 0, 20), null, 'content homes do nothing');
  assert.equal(crimeOutcome(45, 0, 40), 'protester');
  assert.equal(crimeOutcome(45, 1, 40), null, 'one protester per unhappy spell');
  assert.equal(crimeOutcome(T - 1, 0, 40), 'thief');
  assert.equal(crimeOutcome(T, 0, 40), 'protester', `a thief needs a mood under ${T}`);
  assert.equal(crimeOutcome(T - 1, 1, 40), 'thief', 'a home that protested can still send a thief');
  assert.equal(crimeOutcome(T - 1, 2, 40), null, 'but only one');
  assert.equal(crimeOutcome(R, 0, angry), 'riot');
  assert.equal(crimeOutcome(R, 2, angry), 'riot', 'a riot ignores the flag');
  assert.equal(crimeOutcome(R, 0, CONFIG.RIOT_CITY_MOOD), 'thief', 'no riot unless the whole city is angry');
  assert.equal(crimeOutcome(R + 1, 0, angry), 'thief');
  assert.equal(crimeOutcome(R, 0, angry, false), 'thief', 'no road close enough for a riot');
  assert.equal(crimeOutcome(R, 2, 40), null);
});

test('theft: a quarter of this year\'s taxes, at most 400, nothing under 5, never less for more taxes', () => {
  assert.equal(theftAmount(1000), 250);
  assert.equal(theftAmount(1596), 399);
  assert.equal(theftAmount(1600), 400);
  assert.equal(theftAmount(2000), 400, 'capped (the original dropped to 337-400 here)');
  assert.equal(theftAmount(21), 5);
  assert.equal(theftAmount(20), 5);
  assert.equal(theftAmount(19), 0, 'under 5: nothing');
  assert.equal(theftAmount(0), 0);
  for (let t = 1; t <= 3000; t++) assert.ok(theftAmount(t) >= theftAmount(t - 1), `monotonic at ${t}`);
});

test('riot mob size by population', () => {
  for (const [pop, n] of [[100, 1], [150, 1], [151, 2], [300, 2], [301, 3], [800, 3], [801, 4], [1200, 4], [1201, 5], [2000, 5], [2001, 6], [20000, 6]]) {
    assert.equal(mobSize(pop), n, `population ${pop}`);
  }
});

// ---------------------------------------------------------------------------
// Home mood
// ---------------------------------------------------------------------------

test('home mood: starts at city mood, moves at most 3 an update toward city mood plus its own terms', () => {
  const game = newGame({ size: 96, type: 'plains', seed: 'mood' });
  const { x0, y } = road(game, 12);
  const c = game.city;
  c.sentiment = 60;
  const b = home(game, x0 + 2, y + 1, { tier: 3, pop: 9, mood: null });
  b.house.food.wheat = 10; // one kind: what a Lean-to needs, no variety bonus
  b.house.tax = 10; // registered: no untaxed bonus
  b.house.des = 0;
  updateHomeMoods(game);
  assert.equal(b.house.mood, 60, 'a new household starts at the city mood');
  c.sentiment = 40;
  updateHomeMoods(game);
  assert.equal(b.house.mood, 57, 'smoothing: 3 a step');
  for (let k = 0; k < 10; k++) updateHomeMoods(game);
  assert.equal(b.house.mood, 40, 'settles on its target');
  assert.equal(b.house.moodReason, null, 'no complaint of its own (and a city with no bad factor)');
  // Unregistered by the tax collector: a little happier.
  b.house.tax = 0;
  for (let k = 0; k < 3; k++) updateHomeMoods(game);
  assert.equal(b.house.mood, 40 + CONFIG.MOOD_UNTAXED);
  // A squalid street, and the city's worst factor as the reason when the home has none.
  b.house.tax = 10;
  b.house.des = -40;
  c.sentimentFactors = { base: 50, unemployment: -12, taxes: -3 };
  for (let k = 0; k < 5; k++) updateHomeMoods(game);
  assert.equal(b.house.mood, 40 - CONFIG.MOOD_DES_MAX, 'desirability counts, within +-5');
  assert.equal(b.house.moodReason, 'squalor');
  b.house.des = 0;
  updateHomeMoods(game);
  assert.equal(b.house.moodReason, 'unemployment', 'the city\'s worst factor');
  // An empty home has no mood and a clean slate.
  b.house.pop = 0;
  b.house.criminal = 2;
  updateHomeMoods(game);
  assert.equal(b.house.mood, null);
  assert.equal(b.house.criminal, 0);
});

test('home mood: hunger builds a streak (-5, -10, -15), food resets it; tents never go hungry; extra food cheers', () => {
  const game = newGame({ size: 96, type: 'plains', seed: 'hunger' });
  const { x0, y } = road(game, 12);
  game.city.sentiment = 50;
  const b = home(game, x0 + 2, y + 1, { tier: 3, mood: 50 });
  const tent = home(game, x0 + 4, y + 1, { tier: 1, mood: 50 });
  for (const x of [b, tent]) { x.house.tax = 10; x.house.des = 0; x.house.hungry = true; }
  const streaks = [];
  for (let k = 0; k < 4; k++) { updateHomeMoods(game); streaks.push(b.house.hungerStreak); }
  assert.deepEqual(streaks, [1, 2, 3, 3], 'at most 3');
  assert.equal(b.house.moodTarget, 50 - 3 * CONFIG.MOOD_HUNGER);
  assert.equal(b.house.moodReason, 'hunger');
  assert.equal(tent.house.hungerStreak, 0, 'tents forage');
  assert.equal(tent.house.mood, 50);
  // Food again: the streak is gone, and three kinds for a one-kind level cheer it up (+6 at most).
  Object.assign(b.house.food, { wheat: 5, vegetables: 5, fruit: 5 });
  b.house.hungry = false;
  updateHomeMoods(game);
  assert.equal(b.house.hungerStreak, 0);
  assert.equal(b.house.moodTarget, 50 + CONFIG.MOOD_FOOD_EXTRA_MAX);
  // A home that ate its last loaf at the month's meal is not hungry.
  for (const f in b.house.food) b.house.food[f] = 0;
  b.house.hungry = false;
  updateHomeMoods(game);
  assert.equal(b.house.hungerStreak, 0);
});

test('home mood: the poorest envy the rich (villas -8, insulae -5)', () => {
  const game = newGame({ size: 96, type: 'plains', seed: 'envy' });
  const c = game.city;
  c.tierCounts = new Array(21).fill(0);
  c.tierCounts[3] = 10;
  assert.equal(envyPenalty(game), 0);
  c.tierCounts[11] = 1;
  assert.equal(envyPenalty(game), CONFIG.MOOD_ENVY_INSULAE);
  c.tierCounts[13] = 1;
  assert.equal(envyPenalty(game), CONFIG.MOOD_ENVY_VILLAS);
  const { x0, y } = road(game, 12);
  c.sentiment = 50;
  const hut = home(game, x0 + 2, y + 1, { tier: CONFIG.MOOD_ENVY_TIER, mood: 50 });
  const cottage = home(game, x0 + 4, y + 1, { tier: CONFIG.MOOD_ENVY_TIER + 1, mood: 50 });
  for (const x of [hut, cottage]) { x.house.tax = 10; x.house.des = 0; x.house.food.wheat = 5; }
  updateHomeMoods(game);
  assert.equal(hut.house.moodTarget, 50 + CONFIG.MOOD_ENVY_VILLAS);
  assert.equal(hut.house.moodReason, 'envy');
  assert.equal(cottage.house.moodTarget, 50, 'only the poorest levels');
});

// ---------------------------------------------------------------------------
// The daily roll
// ---------------------------------------------------------------------------

test('the crime comes from the unhappiest home that can still produce something (not a spent one)', () => {
  const game = newGame({ size: 96, type: 'plains', seed: 'pick' });
  const { x0, y } = road(game, 16);
  game.city.sentiment = 40; // no riots
  const spent = home(game, x0 + 1, y + 1, { mood: 20, criminal: 2 });
  const next = home(game, x0 + 3, y + 1, { mood: 30 });
  const twin = home(game, x0 + 5, y + 1, { mood: 30 });
  const content = home(game, x0 + 7, y + 1, { mood: 60, criminal: 1 });
  const pick = pickCrimeHouse(game);
  // The original looked only at the unhappiest home, which had nothing left to give.
  assert.equal(pick.b.id, next.id, 'the spent home no longer blocks; the older of two equals goes first');
  assert.ok(next.id < twin.id);
  assert.equal(pick.outcome, 'thief');
  assert.equal(content.house.criminal, 0, 'a content home settles down');
  assert.equal(spent.house.criminal, 2, 'an unhappy one does not');
  // Once the thief is spent, the protester band: the other 30 is a thief too, then protests.
  next.house.criminal = 2;
  twin.house.criminal = 2;
  assert.equal(pickCrimeHouse(game), null, 'everyone has used up what they can do');
});

test('the daily roll: the chance is the curve x difficulty, halved by police cover; nothing below 300 people', () => {
  const game = newGame({ size: 96, type: 'plains', seed: 'roll', difficulty: 'hard' });
  const { x0, y } = road(game, 12);
  const c = game.city;
  const b = home(game, x0 + 2, y + 1, { mood: 45 });
  c.sentiment = 45;
  const seen = [];
  game.rng.chance = (p) => { seen.push(p); return false; };
  c.population = CONFIG.CRIME_MIN_POP - 1;
  updateCrime(game);
  assert.equal(seen.length, 0, 'a small town has no crime (and draws no random number)');
  c.population = CONFIG.CRIME_MIN_POP;
  updateCrime(game);
  b.house.police = 5;
  updateCrime(game);
  const want = crimeChance(45) * game.difficulty.crime;
  assert.ok(Math.abs(seen[0] - want) < 1e-9, `${seen[0]} vs ${want}`);
  assert.ok(Math.abs(seen[1] - want / 2) < 1e-9, 'police cover halves it');
  assert.equal(game.difficulty.crime, 1.2);
});

test('difficulty and missions: crime is gentler on Easy, harsher on Insane, and off in the first two missions', () => {
  const lever = (d) => withDifficulty(SCENARIOS[2], d);
  assert.deepEqual(['easy', 'normal', 'hard', 'insane'].map((d) => new Game({ scenario: lever(d) }).difficulty.crime), [0.5, 1, 1.2, 1.4]);
  for (const s of SCENARIOS) {
    const g = { scenario: withDifficulty(s, 'insane') };
    assert.equal(crimeEnabled(g), !['c1', 'c2'].includes(s.id), s.id);
    if (['c1', 'c2'].includes(s.id)) assert.equal(s.disease, false, `${s.id}: disease off too`);
  }
  // In a mission without crime the roll never runs, however angry the homes.
  const game = new Game({ scenario: SCENARIOS[0], flags: { money: 50000 } });
  const { x0, y } = road(game, 12);
  const b = home(game, x0 + 2, y + 1, { mood: 0 });
  game.city.population = 5000;
  game.city.sentiment = 0;
  game.rng.chance = () => true;
  updateCrime(game);
  assert.equal(game.city.crime.total.riots + game.city.crime.total.protesters + game.city.crime.total.thieves, 0);
  assert.ok(game.buildings.has(b.id));
});

test('a protester stands by their home a few days and costs no peace', () => {
  const game = newGame({ size: 96, type: 'plains', seed: 'protest' });
  const { x0, y } = road(game, 12);
  const b = home(game, x0 + 2, y + 1, { mood: 45 });
  const w = commitCrime(game, b, 'protester');
  assert.ok(w && w.type === 'protester' && w.state === 'protest');
  assert.equal(b.house.criminal, 1);
  assert.ok(game.map.road[game.map.idx(w.x, w.y)], 'on a road');
  assert.ok(w.waitTicks >= CONFIG.PROTEST_TICKS[0] && w.waitTicks <= CONFIG.PROTEST_TICKS[1]);
  const x = w.x;
  stepCriminals(game, CONFIG.PROTEST_TICKS[0] - 1);
  assert.ok(game.walkers.has(w.id) && w.x === x, 'still standing there');
  stepCriminals(game, 10);
  assert.ok(!game.walkers.has(w.id), 'gone home');
  // Peace: a protest costs nothing, so a content city still gains this month
  // (homes protest below 50 while peace grows from 45).
  const c = game.city;
  c.sentiment = 60;
  c.ratings.peace = 40;
  assert.equal(c.crime.month, false);
  updateRatings(game);
  assert.equal(c.ratings.peace, 40 + CONFIG.PEACE_PER_MONTH);
});

// ---------------------------------------------------------------------------
// Thieves
// ---------------------------------------------------------------------------

/** A road with a staffed Forum at its east end and a home near its west end. */
function thiefStreet(seed) {
  const game = newGame({ size: 128, type: 'plains', seed });
  const { x0, x1, y } = road(game, 30);
  const forum = addBuilding(game, 'forum', x1 - 1, y + 1);
  forum.efficiency = 1;
  forum.workers = forum.def.workers;
  const b = home(game, x0 + 4, y - 1, { mood: 20 });
  game.city.finance.thisYear.taxes = 1000;
  game.city.sentiment = 40;
  return { game, forum, b, x0, x1, y };
}

test('a thief walks to the Forum and steals a quarter of this year\'s taxes there', () => {
  const { game, forum, b } = thiefStreet('thief-steals');
  const money = game.city.treasury;
  const w = commitCrime(game, b, 'thief');
  assert.ok(w && w.type === 'thief');
  assert.equal(w.target, forum.id);
  assert.equal(game.city.treasury, money, 'nothing is taken when it appears');
  stepCriminals(game, 2000, () => !game.walkers.has(w.id));
  assert.ok(!game.walkers.has(w.id), 'gone after the theft');
  assert.equal(game.city.treasury, money - 250);
  assert.equal(game.city.finance.thisYear.stolen, 250, 'its own ledger line');
  assert.deepEqual([game.city.crime.year.thefts, game.city.crime.year.stolen, game.city.crime.total.stolen], [1, 250, 250]);
  assert.ok(game.messages.some((m) => /stole 250 Dn/.test(m.text)));
  // A thief about costs the month's peace gain, even in a content city.
  const c = game.city;
  c.sentiment = 60;
  c.ratings.peace = 40;
  assert.equal(c.crime.month, true);
  updateRatings(game);
  assert.equal(c.ratings.peace, 40);
});

test('a prefect who catches the thief first saves the money', () => {
  const { game, b, x0, y } = thiefStreet('thief-caught');
  const money = game.city.treasury;
  // A prefect standing in the street between the home and the Forum.
  const p = spawnWalker(game, 'prefect', game.map.idx(x0 + 14, y), null, { state: 'idle' });
  const w = commitCrime(game, b, 'thief');
  stepCriminals(game, 2000, () => !game.walkers.has(w.id));
  assert.ok(!game.walkers.has(w.id));
  assert.equal(game.city.treasury, money, 'nothing stolen');
  assert.equal(game.city.crime.year.caught, 1);
  assert.ok(game.messages.some((m) => /caught a thief/.test(m.text)));
  assert.ok(game.walkers.has(p.id), 'the prefect is still about');
});

test('a roaming prefect hunts a thief down', () => {
  const { game, b, x0, y } = thiefStreet('thief-chase');
  const money = game.city.treasury;
  const w = commitCrime(game, b, 'thief');
  // A prefect on patrol a few tiles behind him; the thief never passes him.
  const p = spawnWalker(game, 'prefect', game.map.idx(x0, y), null, {});
  startRoaming(game, p, 1);
  let hunted = false;
  stepCriminals(game, 2000, () => { hunted ||= p.state === 'hunt'; return !game.walkers.has(w.id); });
  assert.ok(hunted, 'the prefect gave chase');
  assert.equal(game.city.treasury, money, 'caught before the Forum');
  assert.equal(game.city.crime.year.caught, 1);
});

test('with no Forum a thief robs the nearest stocked market: half its biggest stock, one load at most', () => {
  const game = newGame({ size: 96, type: 'plains', seed: 'thief-market' });
  const { x0, x1, y } = road(game, 20);
  const market = addBuilding(game, 'market', x1 - 1, y + 1);
  market.stock.wheat = 500;
  market.stock.fruit = 60;
  const b = home(game, x0 + 2, y - 1, { mood: 20 });
  const w = commitCrime(game, b, 'thief');
  assert.equal(w.target, market.id);
  stepCriminals(game, 2000, () => !game.walkers.has(w.id));
  assert.equal(market.stock.wheat, 500 - CONFIG.MARKET_THEFT_MAX);
  assert.equal(market.stock.fruit, 60);
  assert.equal(game.city.crime.year.looted, CONFIG.MARKET_THEFT_MAX);
});

// ---------------------------------------------------------------------------
// Riots
// ---------------------------------------------------------------------------

test('riot target: the most prized building within 40 tiles, nearest of equals, else the nearest anywhere', () => {
  // Placed directly (addBuilding ignores the ground): only distances matter here.
  const game = newGame({ size: 128, type: 'plains', seed: 'riot-target' });
  const x = 10;
  const y = 20;
  const school = addBuilding(game, 'school', x + 4, y);
  const theaterFar = addBuilding(game, 'theater', x + 30, y);
  const theaterNear = addBuilding(game, 'theater', x + 20, y);
  const senate = addBuilding(game, 'senate', x + 60, y); // the top prize, but too far
  addBuilding(game, 'warehouse', x + 2, y + 4); // never a target
  const hut = home(game, x + 8, y + 5, { tier: 4 }); // too poor to bother with
  assert.equal(pickRiotTarget(game, x, y).id, theaterNear.id, 'theaters before schools; the nearer one');
  assert.equal(pickRiotTarget(game, x + 50, y).id, senate.id);
  assert.ok(!riotEligible(hut.house ? hut : null));
  assert.ok(school.id < theaterFar.id);
  // Nothing listed within reach: the nearest listed building anywhere.
  for (const b of [theaterNear, theaterFar, senate]) game.buildings.delete(b.id);
  assert.equal(pickRiotTarget(game, x + 69, y).id, school.id);
  game.buildings.delete(school.id);
  assert.equal(pickRiotTarget(game, x, y), null, 'nothing worth burning');
});

test('a riot burns the rioters\' home, sends a mob, lifts every mood by 20 and costs 5 peace', () => {
  const game = newGame({ size: 96, type: 'plains', seed: 'riot' });
  const { x0, y } = road(game, 20);
  const c = game.city;
  c.population = 1000;
  c.sentiment = 20;
  c.ratings.peace = 30;
  const b = home(game, x0 + 3, y + 1, { mood: 5, pop: 9 });
  const other = home(game, x0 + 6, y + 1, { mood: 22 });
  const theater = addBuilding(game, 'theater', x0 + 12, y + 1);
  const first = startRiot(game, b);
  assert.ok(first && first.type === 'rioter');
  assert.ok(!game.buildings.has(b.id), 'their home is gone');
  assert.ok(game.fires.has(game.map.idx(b.x, b.y)), 'burning');
  const mob = [...game.walkers.values()].filter((w) => w.type === 'rioter');
  assert.equal(mob.length, mobSize(1000));
  assert.ok(mob.every((w) => w.target === theater.id), 'all after the theater');
  const waits = mob.map((w) => w.waitTicks);
  assert.ok(waits.every((t, i) => i === 0 || t > waits[i - 1]), `staggered: ${waits}`);
  assert.equal(other.house.mood, 22 + CONFIG.RIOT_MOOD_BOOST);
  assert.equal(c.ratings.peace, 30 - CONFIG.RIOT_PEACE);
  assert.equal(c.crime.year.riots, 1);
  assert.ok(game.messages.some((m) => /^Riot!/.test(m.text)));
  // Left alone, the mob reaches the theater and burns it.
  stepCriminals(game, 1500, () => !game.buildings.has(theater.id));
  assert.ok(!game.buildings.has(theater.id), 'the theater burned');
  assert.ok(c.crime.year.riotBurned >= 1);
});

test('a rioter burns the first building beside it that a mob burns (not warehouses, nor poor homes)', () => {
  const game = newGame({ size: 96, type: 'plains', seed: 'riot-step' });
  const at = findFree(game, 8, 8);
  const { x, y } = at;
  const cx = x + 3;
  const cy = y + 3;
  const shack = home(game, cx, cy - 1, { tier: 4 }); // north: too poor
  const store = addBuilding(game, 'warehouse', cx + 1, cy - 1); // east: spared (3x3 reaches the tile to his east)
  const w = spawnWalker(game, 'rioter', game.map.idx(cx, cy), null, { state: 'riot', offRoad: true, hp: CONFIG.CRIMINAL_HP });
  assert.equal(rioterStep(game, w), false, 'nothing here he would burn');
  const clinic = addBuilding(game, 'clinic', cx, cy + 1); // south
  assert.equal(rioterStep(game, w), true);
  assert.ok(!game.buildings.has(clinic.id), 'the medicus burns');
  assert.ok(game.buildings.has(shack.id) && game.buildings.has(store.id));
  assert.equal(w.waitTicks, CONFIG.RIOTER_BURN_TICKS, 'he stays by the flames');
  assert.ok(game.messages.some((m) => /Rioters have set a Medicus on fire/.test(m.text)));
});

test('quiet fires stay quiet (raiders and rioters wrecking a street do not flood the log)', () => {
  const game = newGame({ size: 96, type: 'plains', seed: 'quiet' });
  const at = findFree(game, 6, 3);
  for (const [k, cause] of [[0, 'raidQuiet'], [2, 'riotQuiet']]) {
    const b = addBuilding(game, 'clinic', at.x + k, at.y);
    const before = game.messages.length;
    igniteBuilding(game, b, cause);
    assert.equal(game.messages.length, before, `${cause}: no message`);
  }
  const b = addBuilding(game, 'clinic', at.x + 4, at.y);
  igniteBuilding(game, b, 'fire');
  assert.match(game.messages[0].text, /^Fire!/);
});

// ---------------------------------------------------------------------------
// What the player sees
// ---------------------------------------------------------------------------

test('crime overlay: column by mood band, a home that already sent a criminal stands tall', () => {
  const h = (mood, criminal = 0) => ({ pop: 5, mood, criminal });
  const heights = [0, 5, 10, 15, 25, 35, 45, 50, 80].map((m) => crimeBand(h(m)).height);
  assert.deepEqual(heights, [10, 8, 8, 6, 4, 2, 1, 0, 0]);
  assert.equal(crimeBand(h(45, 1)).height, 8);
  assert.equal(crimeBand(h(80, 1)).height, 8);
  assert.equal(crimeBand({ pop: 0, mood: null }), null, 'empty homes get no column');
  assert.equal(moodWord(55), 'Content');
  assert.equal(moodWord(0), 'Ready to riot');
  const game = newGame({ size: 96, type: 'plains', seed: 'tip' });
  const { x0, y } = road(game, 8);
  const b = home(game, x0 + 2, y + 1, { mood: 25 });
  b.house.moodReason = 'taxes';
  b.house.police = 10;
  assert.equal(crimeTip(game, b), 'Some crime. Mood 25 (resentful). Taxes are too high. A prefect patrols this street.');
});

// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

test('save: home moods, flags, police, the year\'s counts and criminals on the street come back', () => {
  const { game, b } = thiefStreet('save-crime');
  b.house.hungerStreak = 2;
  b.house.police = 7;
  b.house.moodReason = 'taxes';
  const thief = commitCrime(game, b, 'thief');
  stepCriminals(game, 30);
  game.city.crime.year.protesters = 4;
  const copy = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  const h = copy.buildings.get(b.id).house;
  assert.deepEqual([h.mood, h.hungerStreak, h.police, h.criminal, h.moodReason], [20, 2, 7, 2, 'taxes']);
  assert.deepEqual(copy.city.crime, game.city.crime);
  const w = copy.walkers.get(thief.id);
  assert.ok(w && w.type === 'thief' && w.state === 'steal' && w.hp === CONFIG.CRIMINAL_HP);
  assert.deepEqual(w.path, thief.path);
});

test('save: a version 4 save (before crime) loads with safe defaults and plays on', () => {
  const game = newGame({ size: 96, type: 'plains', seed: 'v4-save' });
  const { x0, y } = road(game, 12);
  const b = home(game, x0 + 2, y + 1, { mood: 33 });
  game.city.sentiment = 47;
  game.runDays(3);
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  // Make it what version 4 wrote: no crime state, no mood fields, no stolen line.
  data.version = 4;
  delete data.city.crime;
  delete data.city.finance.thisYear.stolen;
  for (const raw of data.buildings) {
    if (!raw.house) continue;
    for (const k of ['mood', 'moodReason', 'moodTarget', 'hungerStreak', 'criminal', 'police']) delete raw.house[k];
  }
  const copy = deserializeGame(data);
  const h = copy.buildings.get(b.id).house;
  assert.equal(h.mood, copy.city.sentiment, 'an occupied home starts at the city\'s mood');
  assert.deepEqual([h.hungerStreak, h.criminal, h.police], [0, 0, 0]);
  assert.equal(copy.city.crime.total.riots, 0);
  assert.equal(copy.city.crime.month, false);
  copy.runDays(20);
  // And a version 3 save is still refused with a readable message.
  data.version = 3;
  assert.throws(() => deserializeGame(data), /older version of Colonia/);
});

// ---------------------------------------------------------------------------
// Review fixes: unreachable criminals, theft and the treasury, families
// moving, thieves who never set out, far riots, rioters' time, police, fires
// ---------------------------------------------------------------------------

/** Open grass over a rectangle, so a test's layout does not depend on the map's rocks and water. */
function grass(game, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) game.map.terrain[game.map.idx(x, y)] = Terrain.GRASS;
}

test('a prefect who cannot reach a thief (across water) keeps to his patrol and does not search again every look', () => {
  const game = newGame({ size: 128, type: 'plains', seed: 'hunt-moat' });
  grass(game, 18, 18, 52, 42);
  const x0 = 21;
  const yA = 22;
  const yB = 32;
  const pre = addBuilding(game, 'prefecture', x0 + 10, yA - 1);
  pre.efficiency = 1;
  assert.ok(build(game, 'road', x0, yA, x0 + 25, yA).ok);
  assert.ok(build(game, 'road', x0, yB, x0 + 25, yB).ok);
  // A moat across the whole map between the two roads.
  for (const yy of [yA + 5, yA + 6]) for (let x = 0; x < game.map.w; x++) game.map.terrain[game.map.idx(x, yy)] = Terrain.WATER;
  const p = spawnWalker(game, 'prefect', game.map.idx(x0 + 10, yA), pre, {});
  startRoaming(game, p, 1);
  const b = home(game, x0 + 12, yB + 1, { mood: 20 });
  const thief = commitCrime(game, b, 'thief');
  assert.ok(thief, 'a thief on the far side');
  let searches = 0;
  const astar = game.pf.astar.bind(game.pf);
  game.pf.astar = (...a) => { searches++; return astar(...a); };
  const states = new Set();
  stepCriminals(game, 100, () => { states.add(p.state); return false; });
  assert.deepEqual([...states], ['roam'], 'on patrol all along (it used to walk home at once)');
  assert.ok(game.walkers.has(thief.id));
  assert.equal(searches, 1, 'one search, then the thief is left alone for a while');
  assert.ok(p.noChase && p.noChase[thief.id] > game.time.totalTicks);
});

test('a thief cannot take coins that are not in the chest', () => {
  assert.equal(theftAmount(1600, 10), 10);
  assert.equal(theftAmount(1600, -50), 0, 'a city in debt has nothing to steal');
  assert.equal(theftAmount(1000, 5000), 250);
  const { game, b } = thiefStreet('thief-poor');
  game.city.treasury = 10;
  game.city.finance.thisYear.taxes = 1600;
  const w = commitCrime(game, b, 'thief');
  stepCriminals(game, 2000, () => !game.walkers.has(w.id));
  assert.equal(game.city.treasury, 0, 'emptied, not in debt');
  assert.equal(game.city.finance.thisYear.stolen, 10);
});

test('families keep their mood and record when homes split off or join (growing past a neighbor)', () => {
  const game = newGame({ size: 96, type: 'plains', seed: 'temper' });
  const { x0, y } = road(game, 12);
  const x = x0 + 2;
  const top = y + 1;
  const g = home(game, x, top, { tier: 10, pop: 20, mood: 40, criminal: 0 });
  const a = home(game, x, top + 1, { tier: 5, pop: 10, mood: 30, criminal: 2 });
  const block = addBuilding(game, 'house', x + 1, top, 2);
  Object.assign(block.house, { tier: 5, pop: 40, merged: true, mood: 22, criminal: 1, hungerStreak: 2, moodReason: 'taxes' });
  assert.ok(growHouse(game, g, 2), 'grew into a 2x2');
  assert.ok(!game.buildings.has(a.id));
  assert.equal(g.house.criminal, 2, 'the worst record of the families that moved in');
  const piece = game.buildings.get(game.map.buildingAt(x + 2, top));
  assert.ok(piece && piece.house && piece.house.pop > 0, 'a piece of the block split off');
  const ph = piece.house;
  assert.deepEqual([ph.mood, ph.criminal, ph.hungerStreak, ph.moodReason], [22, 1, 2, 'taxes'], "the block's families, not the grower's");
});

test('a family moving into an empty home starts afresh at the city\'s mood', () => {
  const game = newGame({ size: 96, type: 'plains', seed: 'fresh-home' });
  const { x0, y } = road(game, 12);
  const b = home(game, x0 + 3, y + 1, { tier: 1, pop: 0, mood: 12, criminal: 2 });
  b.house.hungerStreak = 3;
  b.house.moodReason = 'hunger';
  game.city.sentiment = 55;
  const w = spawnWalker(game, 'immigrant', game.map.idx(x0 + 3, y), null, { people: 3, target: b.id, state: 'toHouse' });
  settlerArrive(game, w);
  assert.equal(b.house.pop, 3);
  assert.deepEqual([b.house.mood, b.house.criminal, b.house.hungerStreak, b.house.moodReason], [55, 0, 0, null]);
});

test('a thief who vanishes at once (a stub of road, nowhere to go) is not counted and costs no peace', () => {
  const game = newGame({ size: 96, type: 'plains', seed: 'stub-thief' });
  const at = findFree(game, 6, 6);
  assert.ok(build(game, 'road', at.x + 2, at.y + 2).ok, 'a lone road tile');
  const b = home(game, at.x + 3, at.y + 3, { mood: 20 });
  assert.equal(commitCrime(game, b, 'thief'), null);
  assert.equal(game.city.crime.year.thieves, 0);
  assert.equal(game.city.crime.month, false);
  assert.equal(b.house.criminal, 2, 'the home has still spent its thief');
});

test('with nothing to burn within 40 tiles, a mob marches on the nearest listed building it can reach', () => {
  const game = newGame({ size: 128, type: 'plains', seed: 'far-riot' });
  grass(game, 0, 40, 80, 120);
  for (let yy = 0; yy < game.map.h; yy++) for (const xx of [30, 31]) game.map.terrain[game.map.idx(xx, yy)] = Terrain.WATER;
  assert.ok(build(game, 'road', 8, 58, 14, 58).ok);
  const c = game.city;
  c.population = 1000;
  c.sentiment = 20;
  const b = home(game, 10, 60, { mood: 5 });
  const across = addBuilding(game, 'theater', 55, 60); // 45 tiles: nearer, but across the water
  const reachable = addBuilding(game, 'school', 10, 110); // 50 tiles, same bank
  assert.equal(pickRiotTarget(game, 10, 60, b.id).id, across.id, 'the nearest as the crow flies');
  const first = startRiot(game, b);
  assert.ok(first);
  const mob = [...game.walkers.values()].filter((w) => w.type === 'rioter');
  assert.ok(mob.length > 0 && mob.every((w) => w.target === reachable.id), 'all after the school');
  assert.ok(game.messages.some((m) => /heading for a School/.test(m.text)));
  stepCriminals(game, 60);
  assert.ok(mob.some((w) => game.walkers.has(w.id) && w.path), 'on the march, not gone at once');
});

test('rioters go home after RIOTER_MAX_DAYS, even in the middle of a march', () => {
  const game = newGame({ size: 96, type: 'plains', seed: 'riot-days' });
  const { x0, x1, y } = road(game, 30);
  const w = spawnWalker(game, 'rioter', game.map.idx(x0, y), null, { state: 'riot', offRoad: true, hp: CONFIG.CRIMINAL_HP, startDay: game.time.totalDays });
  followPath(game, w, game.pf.roadPath(game.map.idx(x0, y), game.map.idx(x1, y)));
  stepCriminals(game, 5);
  assert.ok(game.walkers.has(w.id) && w.moving, 'marching');
  game.time.totalDays += CONFIG.RIOTER_MAX_DAYS;
  stepCriminals(game, 1);
  assert.ok(!game.walkers.has(w.id), 'gone, though his march was not over');
});

test('a prefect passing a home gives it police cover', () => {
  const game = newGame({ size: 96, type: 'plains', seed: 'police' });
  const { x0, y } = road(game, 12);
  const b = home(game, x0 + 3, y + 1, { mood: 40 });
  assert.equal(b.house.police, 0);
  const p = spawnWalker(game, 'prefect', game.map.idx(x0 + 4, y), null, { state: 'roam' });
  roamerVisit(game, p);
  assert.equal(b.house.police, CONFIG.POLICE_DAYS);
});

test('a fire pulls a prefect off a chase', () => {
  const game = newGame({ size: 96, type: 'plains', seed: 'hunt-fire' });
  const { x0, y } = road(game, 20);
  const b = home(game, x0 + 12, y + 1, { mood: 40 });
  const thief = spawnWalker(game, 'thief', game.map.idx(x0 + 18, y), null, { state: 'steal', hp: CONFIG.CRIMINAL_HP });
  const p = spawnWalker(game, 'prefect', game.map.idx(x0 + 4, y), null, { state: 'hunt', huntTarget: thief.id, offRoad: true });
  igniteBuilding(game, b, 'fire');
  assert.equal(p.state, 'toFire');
  assert.equal(p.huntTarget, 0);
  assert.equal(p.offRoad, false);
});

// ---------------------------------------------------------------------------
// Crime's cost in peace, by difficulty (the owner's call: none on Easy, a
// little on Normal, some on Hard, a lot on Insane)
// ---------------------------------------------------------------------------

test('crime costs peace by difficulty: none on Easy, a little on Normal, more on Hard, most on Insane', () => {
  // [riot, thief at once, does a thief cost the month's gain]
  const want = { easy: [0, 0, false], normal: [5, 1, true], hard: [10, 2, true], insane: [15, 3, true] };
  for (const [key, [riot, thief, blocks]] of Object.entries(want)) {
    const t = thiefStreet('thief-steals');
    t.game.difficulty = difficultyOf(key);
    const c = t.game.city;
    c.ratings.peace = 40;
    assert.ok(commitCrime(t.game, t.b, 'thief'), `${key}: a thief`);
    assert.equal(c.ratings.peace, 40 - thief, `${key}: a thief's cost`);
    assert.equal(c.crime.month, blocks, `${key}: the month's gain`);

    const game = newGame({ size: 96, type: 'plains', seed: 'riot' });
    game.difficulty = difficultyOf(key);
    const { x0, y } = road(game, 20);
    Object.assign(game.city, { population: 1000, sentiment: 20 });
    game.city.ratings.peace = 30;
    const b = home(game, x0 + 3, y + 1, { mood: 5 });
    addBuilding(game, 'theater', x0 + 12, y + 1);
    assert.ok(startRiot(game, b), `${key}: a riot`);
    assert.equal(game.city.ratings.peace, 30 - riot, `${key}: a riot's cost`);
  }
});

test('protests cost peace only on Insane: every fifth costs 1, then the count starts again', () => {
  assert.equal(DIFFICULTY.insane.protestPeaceEvery, 5);
  for (const key of ['easy', 'normal', 'hard', 'insane']) {
    const game = newGame({ size: 128, type: 'plains', seed: 'thief-steals' });
    game.difficulty = difficultyOf(key);
    const { x0, y } = road(game, 30);
    game.city.ratings.peace = 40;
    for (let i = 0; i < 11; i++) {
      const b = home(game, x0 + 2 + i * 2, y + 1, { mood: 45 });
      assert.ok(commitCrime(game, b, 'protester'), `${key}: protest ${i + 1}`);
    }
    const every = game.difficulty.protestPeaceEvery;
    assert.equal(game.city.ratings.peace, 40 - (every ? Math.floor(11 / every) : 0), `${key}: peace after 11 protests`);
    assert.equal(game.city.crime.protestTally || 0, every ? 11 % every : 0, `${key}: the count starts again`);
  }
});

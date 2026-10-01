/**
 * gods.test.mjs
 * ----------------------------------------------------------------------------
 * The original's five gods (sim/religion.js): Mercury's blessing (food for the
 * emptiest working granary) and wrath (goods lost from the fullest storehouse,
 * then fire if he is angered again before he calms), Venus's blessing (every
 * home's mood and a decaying city mood factor) and wrath (home moods capped,
 * a negative factor, then disease risk for badly served homes), the early
 * missions sparing the harder wraths, the temples and their unlocks, the
 * version 6 save (Jupiter and Vesta) loading under the new names, and no
 * source file naming the old gods outside that migration.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { log } from '../src/core/debug.js';
import { CONFIG, TICKS_PER_MONTH } from '../src/config.js';
import { Game } from '../src/core/game.js';
import { GODS, GOD_KEYS } from '../src/data/gods.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { SCENARIOS, findScenario } from '../src/data/scenarios.js';
import { MOOD_REASONS } from '../src/data/crime.js';
import { addBuilding } from '../src/sim/entities.js';
import { updateReligion, emptiestGranary, fullestStorehouse, loseStock } from '../src/sim/religion.js';
import { computeSentiment } from '../src/sim/population.js';
import { cityMoodCause } from '../src/sim/mood.js';
import { refreshDiseaseGate, houseHealth } from '../src/sim/disease.js';
import { serializeGame, deserializeGame, upgradeGodsV6 } from '../src/core/save.js';
import { newGame, findFree } from './helpers.mjs';

log.level = 'error';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A granary or warehouse placed directly on free land, staffed or not, with this stock. */
function store(game, type, stock = {}, efficiency = 1) {
  const spot = findFree(game, 4, 4);
  assert.ok(spot, 'room for a storehouse');
  const b = addBuilding(game, type, spot.x, spot.y, 3);
  Object.assign(b.stock, stock);
  b.efficiency = efficiency;
  return b;
}

/** An occupied home placed directly, at a mood. */
function home(game, { tier = 3, pop = 9, mood = 60 } = {}) {
  const spot = findFree(game, 2, 2);
  const b = addBuilding(game, 'house', spot.x, spot.y, 1);
  Object.assign(b.house, { tier, pop, mood });
  return b;
}

/** Set the population as the day's count would (disease reads the gate). */
function setPop(game, n) {
  game.city.population = n;
  refreshDiseaseGate(game);
}

/**
 * Run the monthly religion update so that `god`, and only `god`, acts:
 * 'wrath' (mood at the bottom, a city of 1000 people) or 'bless' (mood 100).
 * Every other god waits out a long cooldown.
 */
function act(game, god, what) {
  if (game.city.population < 800) setPop(game, 1000);
  for (const g of GOD_KEYS) game.city.gods[g].cooldown = 99;
  const s = game.city.gods[god];
  s.cooldown = 0;
  s.mood = what === 'bless' ? 100 : 0;
  updateReligion(game);
  assert.equal(s.cooldown, what === 'bless' ? 14 : 8, `${god} acted (${what})`);
}

const sumStock = (b) => Object.values(b.stock).reduce((a, n) => a + n, 0);

// ---------------------------------------------------------------------------
// The gods, their temples and where they are unlocked
// ---------------------------------------------------------------------------

test('the five gods: the original\'s order, a temple each, all at the same cost', () => {
  assert.deepEqual([...GOD_KEYS], ['ceres', 'neptune', 'mercury', 'mars', 'venus']);
  const temples = Object.keys(BUILDINGS).filter((k) => BUILDINGS[k].god);
  assert.deepEqual(temples, GOD_KEYS.map((g) => `temple_${g}`), 'one temple per god, in the build menu in the gods\' order');
  for (const k of temples) {
    const d = BUILDINGS[k];
    assert.equal(d.cost, 50, `${k} costs 50`);
    assert.deepEqual([d.size, d.workers, d.spawnDays, d.walker], [2, 2, 4, 'priest'], `${k}: the same temple as the others`);
    assert.deepEqual(d.des, [4, 2, -1, 6]);
  }
  // Priests wear their god's color: five colors, none alike.
  assert.equal(new Set(GOD_KEYS.map((g) => GODS[g].color)).size, 5);
  assert.deepEqual(GOD_KEYS.filter((g) => GODS[g].harderWrath), ['mercury', 'venus'], 'only Mercury and Venus strike harder when angered again');
});

test('unlocks: Mercury in the first mission (in Jupiter\'s place), Venus from the second (in Vesta\'s)', () => {
  const c1 = findScenario('c1').unlocks;
  const c2 = findScenario('c2').unlocks;
  assert.deepEqual(c1.filter((k) => k.startsWith('temple_')), ['temple_ceres', 'temple_mercury']);
  assert.deepEqual(c2.filter((k) => k.startsWith('temple_')), ['temple_ceres', 'temple_mercury', 'temple_neptune', 'temple_mars', 'temple_venus']);
  for (const s of SCENARIOS) {
    if (!Array.isArray(s.unlocks)) continue;
    for (const k of s.unlocks) if (k.startsWith('temple_')) assert.ok(BUILDINGS[k], `${s.id}: ${k} exists`);
    if (s.id !== 'c1') assert.ok(s.unlocks.includes('temple_venus'), `${s.id} has Venus`);
  }
  // The first two missions spare the harder wraths, as the original's early missions did.
  assert.deepEqual(SCENARIOS.filter((s) => s.majorWrath === false).map((s) => s.id), ['c1', 'c2']);
});

// ---------------------------------------------------------------------------
// Mercury
// ---------------------------------------------------------------------------

test('Mercury blesses the emptiest working granary with 600 of each food, as far as it has room', () => {
  const game = newGame({ seed: 'mercury-bless', size: 96, type: 'plains' });
  const A = store(game, 'granary', { wheat: 1200 });
  const B = store(game, 'granary', { wheat: 300, meat: 200 });
  const C = store(game, 'granary', {}, 0); // unstaffed and empty: no cart or market would use it
  assert.equal(emptiestGranary(game), B, 'the working granary with the least food, not the empty unstaffed one');
  act(game, 'mercury', 'bless');
  // 1900 free: wheat +600, vegetables +600, fruit +600, meat the last 100.
  assert.deepEqual({ ...B.stock }, { wheat: 900, vegetables: 600, fruit: 600, meat: 300 });
  assert.equal(sumStock(A), 1200, 'the others are left alone');
  assert.equal(sumStock(C), 0);
  const m = game.messages[0];
  assert.match(m.text, /^Mercury is pleased! .*1900 units of food.*Granary at/);
  assert.deepEqual([m.x, m.y], [B.x, B.y], 'the message points at the granary');
  assert.equal(game.city.goodsFlow.meat.imported, 100, 'brought from afar: logged as imported');
});

test('Mercury\'s blessing: refused foods are skipped, an unstaffed granary only when none works, none at all says so', () => {
  const game = newGame({ seed: 'mercury-bless2', size: 96, type: 'plains' });
  act(game, 'mercury', 'bless');
  assert.match(game.messages[0].text, /found no granary/);
  const G = store(game, 'granary', { wheat: 100 }, 0);
  G.orders.fruit = 'refuse';
  act(game, 'mercury', 'bless');
  assert.deepEqual({ ...G.stock }, { wheat: 700, vegetables: 600, fruit: 0, meat: 600 }, 'no fruit for a granary that refuses it');
});

test('Mercury\'s blessing passes over a granary set to refuse every food (its emptiness is no need)', () => {
  const game = newGame({ seed: 'mercury-bless3', size: 96, type: 'plains' });
  const shut = store(game, 'granary', {});
  for (const f in shut.orders) shut.orders[f] = 'refuse';
  const open = store(game, 'granary', { wheat: 500 });
  assert.equal(emptiestGranary(game), open);
  act(game, 'mercury', 'bless');
  assert.equal(sumStock(open), 2400, 'the gift went where it could be stored');
  assert.equal(sumStock(shut), 0);
  // Every granary refusing food: nothing to fill, and the message says why.
  for (const f in open.orders) open.orders[f] = 'refuse';
  act(game, 'mercury', 'bless');
  assert.match(game.messages[0].text, /found no granary that would take food/);
});

test('Mercury\'s wrath: the fullest storehouse loses 1600 units; angered again, it burns', () => {
  const game = newGame({ seed: 'mercury-wrath', size: 96, type: 'plains' });
  const W = store(game, 'warehouse', { pottery: 1000, oil: 1000 });
  const G = store(game, 'granary', { wheat: 1000, vegetables: 800, fruit: 400 });
  assert.equal(fullestStorehouse(game), G, '2200 units beat 2000');
  act(game, 'mercury', 'wrath');
  assert.deepEqual({ ...G.stock }, { wheat: 0, vegetables: 200, fruit: 400, meat: 0 }, 'wheat first, then vegetables');
  assert.equal(sumStock(W), 2000, 'the warehouse is spared');
  assert.match(game.messages[0].text, /^Mercury is angry! 1600 units of goods vanish from the Granary at/);
  assert.equal(game.city.gods.mercury.angered, true);
  assert.ok(game.city.gods.mercury.mood > CONFIG.GOD_WRATH_MOOD, 'the wrath spends some anger (+12)');

  // Again before his mood is back above 50: the fullest storehouse (now the
  // warehouse, 2000 units) burns with everything in it.
  const fires = game.city.stats.fires;
  act(game, 'mercury', 'wrath');
  assert.ok(!game.buildings.has(W.id), 'the warehouse burned down');
  assert.equal(game.city.stats.fires, fires + 1);
  assert.ok(game.fires.has(game.map.idx(W.x, W.y)), 'a burning ruin, which can spread');
  assert.ok(game.buildings.has(G.id));
  const m = game.messages[0];
  assert.match(m.text, /^Mercury is angry! Angered again, he sets the Warehouse at .* on fire/);
  assert.deepEqual([m.x, m.y], [W.x, W.y]);
  assert.equal(game.messages.filter((x) => /burned down|Fire!/.test(x.text)).length, 0, 'one message, not a second "Fire!" one');
});

test('Mercury: the anger passes once his mood is back above 50, and the next wrath is the lighter one again', () => {
  const game = newGame({ seed: 'mercury-calm', size: 96, type: 'plains' });
  const G = store(game, 'granary', { wheat: 2400 });
  act(game, 'mercury', 'wrath');
  assert.equal(game.city.gods.mercury.angered, true);
  // A month at 51: calm again.
  setPop(game, 100); // a small town: targets 55, no wrath
  game.city.gods.mercury.mood = CONFIG.GOD_CALM_MOOD + 1;
  game.city.gods.mercury.cooldown = 99;
  updateReligion(game);
  assert.equal(game.city.gods.mercury.angered, false);
  act(game, 'mercury', 'wrath');
  assert.ok(game.buildings.has(G.id), 'goods lost, nothing burned');
  assert.equal(G.stock.wheat, 0, '1600, then the last 800');
  // At exactly 50 the god is not calm yet (no temple in a city of 1000: the
  // mood falls 4 a month, from 54 to 50).
  game.city.gods.mercury.mood = CONFIG.GOD_CALM_MOOD + 4;
  game.city.gods.mercury.cooldown = 99;
  updateReligion(game);
  assert.equal(game.city.gods.mercury.mood, CONFIG.GOD_CALM_MOOD);
  assert.equal(game.city.gods.mercury.angered, true);
});

test('Mercury in the first two missions: angered again, he takes goods again but burns nothing', () => {
  const game = new Game({ scenario: findScenario('c1'), flags: { money: 50000 } });
  assert.ok(game.isUnlocked('temple_mercury') && !game.isUnlocked('temple_venus'));
  const G = store(game, 'granary', { wheat: 2400 });
  act(game, 'mercury', 'wrath');
  act(game, 'mercury', 'wrath');
  assert.ok(game.buildings.has(G.id), 'a new player\'s only granary does not burn');
  assert.equal(G.stock.wheat, 0, '1600, then the last 800');
  assert.match(game.messages[0].text, /vanish/);
});

test('Mercury with nothing stored anywhere takes nothing, and says so; a warehouse loses its largest stocks first', () => {
  const game = newGame({ seed: 'mercury-empty', size: 96, type: 'plains' });
  store(game, 'granary', {});
  assert.equal(fullestStorehouse(game), null);
  act(game, 'mercury', 'wrath');
  assert.match(game.messages[0].text, /found nothing stored/);
  const W = store(game, 'warehouse', { pottery: 800, oil: 1200, wine: 400 });
  assert.equal(loseStock(W, 1600), 1600);
  assert.deepEqual([W.stock.pottery, W.stock.oil, W.stock.wine], [400, 0, 400], 'oil (the most) first, then pottery');
  assert.equal(loseStock(W, 5000), 800, 'no more than it holds');
});

// ---------------------------------------------------------------------------
// Venus
// ---------------------------------------------------------------------------

test('Venus blesses every home (+25 mood) and the city mood, a factor that fades like a festival\'s', () => {
  const game = newGame({ seed: 'venus-bless', size: 96, type: 'plains' });
  const a = home(game, { mood: 60 });
  const b = home(game, { mood: 90 });
  const empty = home(game, { pop: 0, mood: null });
  act(game, 'venus', 'bless');
  assert.deepEqual([a.house.mood, b.house.mood, empty.house.mood], [85, 100, null], '+25, at most 100; an empty home has no mood');
  assert.equal(game.city.venusBoost, CONFIG.VENUS_BLESS_CITY);
  assert.match(game.messages[0].text, /^Venus is pleased!/);

  // The city mood: the factor is shown in full, then fades x0.8 a month until
  // it is under half a point, when it leaves the breakdown.
  const control = newGame({ seed: 'venus-bless', size: 96, type: 'plains' });
  const seen = [];
  for (let m = 0; m < 30; m++) {
    const f = computeSentiment(game);
    computeSentiment(control);
    if (!('venus' in f)) break;
    seen.push(f.venus);
  }
  assert.ok(Math.abs(seen[0] - 15) < 1e-9 && Math.abs(seen[1] - 12) < 1e-9 && Math.abs(seen[2] - 9.6) < 1e-9, `fades x0.8: ${seen.slice(0, 3)}`);
  assert.equal(seen.length, 16, 'listed until 15 x 0.8^n is under half a point');
  assert.ok(seen[seen.length - 1] >= 0.5);
  assert.equal(game.city.venusBoost, 0, 'then gone');
  assert.ok(!('venus' in computeSentiment(game)), 'and no longer listed');
});

test('Venus blessing lifts the city mood against an unblessed twin', () => {
  const a = newGame({ seed: 'venus-twin', size: 96, type: 'plains' });
  const b = newGame({ seed: 'venus-twin', size: 96, type: 'plains' });
  a.city.venusBoost = CONFIG.VENUS_BLESS_CITY;
  computeSentiment(a);
  computeSentiment(b);
  const lift = a.city.sentiment - b.city.sentiment;
  assert.ok(Math.abs(lift - CONFIG.VENUS_BLESS_CITY / 2) <= 0.5, `city mood moves halfway to its target each month: +${lift}`);
});

test('Venus\'s wrath: homes capped at 50, then -5, and the city mood falls; angered again, capped at 45, then -10', () => {
  const game = newGame({ seed: 'venus-wrath', size: 96, type: 'plains' });
  const hi = home(game, { mood: 80 });
  const lo = home(game, { mood: 30 });
  act(game, 'venus', 'wrath');
  assert.deepEqual([hi.house.mood, lo.house.mood], [45, 25]);
  assert.equal(game.city.venusBoost, CONFIG.VENUS_WRATH_CITY[0]);
  assert.match(game.messages[0].text, /^Venus is angry! Homes sour/);
  // The factor can be a home's reason for its mood.
  const f = computeSentiment(game);
  assert.equal(f.venus, CONFIG.VENUS_WRATH_CITY[0]);
  game.city.sentimentFactors = { venus: -8, gods: -3 };
  assert.equal(cityMoodCause(game), 'venus');
  assert.ok(MOOD_REASONS.venus);

  hi.house.mood = 80;
  lo.house.mood = 8;
  act(game, 'venus', 'wrath');
  assert.deepEqual([hi.house.mood, lo.house.mood], [35, 0], 'capped at 45, then -10, never below 0');
  assert.ok(game.city.venusBoost < CONFIG.VENUS_WRATH_CITY[1], 'the harder factor, on top of what is left of the first');
  assert.match(game.messages[0].text, /Angered again/);
});

test('Venus angered again, where disease is active: homes gain risk by how poorly they are cared for', () => {
  const game = newGame({ seed: 'venus-sick', size: 96, type: 'plains' });
  const poor = home(game, { tier: 3, pop: 12 });
  const sick = home(game, { tier: 3, pop: 12 });
  sick.house.sick = 10;
  sick.house.diseaseRisk = 0;
  poor.house.diseaseRisk = 30;
  act(game, 'venus', 'wrath');
  assert.equal(poor.house.diseaseRisk, 30, 'the first wrath brings no sickness');
  act(game, 'venus', 'wrath');
  const score = houseHealth(game, poor);
  assert.ok(score < 50, `a badly served home (score ${score})`);
  const want = 30 + CONFIG.VENUS_WRATH_DISEASE * (100 - score) / 100 * game.difficulty.disease;
  assert.ok(Math.abs(poor.house.diseaseRisk - want) < 1e-9, `risk ${poor.house.diseaseRisk}, want ${want}`);
  assert.ok(poor.house.diseaseRisk >= CONFIG.DISEASE_THRESHOLD, 'over the threshold: the daily roll can start an outbreak');
  assert.equal(sick.house.diseaseRisk, 0, 'a home already sick is left to its sickness');
  assert.match(game.messages[0].text, /sickness creeps into 1 poorly cared for home/);
});

test('Venus angered again: no sickness below 200 people or in a mission without disease; the first two missions get the lighter wrath again', () => {
  // The day's count said under 200 people (the wrath itself reads the month's 1000).
  const small = newGame({ seed: 'venus-small', size: 96, type: 'plains' });
  const h1 = home(small, { tier: 3, pop: 12 });
  act(small, 'venus', 'wrath');
  small.city.health.bigEnough = false;
  act(small, 'venus', 'wrath');
  assert.match(small.messages[0].text, /Angered again/);
  assert.equal(h1.house.diseaseRisk, 0, 'no disease where it cannot break out');

  // Aquae Clarae (mission 2): Venus is there, disease is not, and her second
  // wrath is the first one again.
  const game = new Game({ scenario: findScenario('c2'), flags: { money: 50000 } });
  assert.ok(game.isUnlocked('temple_venus'));
  const h = home(game, { tier: 3, pop: 12, mood: 80 });
  act(game, 'venus', 'wrath');
  h.house.mood = 80;
  act(game, 'venus', 'wrath');
  assert.equal(h.house.mood, 45, 'capped at 50 and -5, not 45 and -10');
  assert.equal(h.house.diseaseRisk, 0);
  assert.equal(game.city.venusBoost, CONFIG.VENUS_WRATH_CITY[0] * 2, 'the lighter factor twice');
});

test('Ceres and Mars strike the same way every time: the harder wrath is Mercury\'s and Venus\'s alone', () => {
  const game = newGame({ seed: 'gods-same', size: 96, type: 'plains' });
  game.city.treasury = 10000;
  const peace = game.city.ratings.peace = 50;
  act(game, 'mars', 'wrath');
  act(game, 'mars', 'wrath');
  assert.equal(game.city.ratings.peace, peace - 20, '-10 peace each time');
  assert.equal(game.city.gods.mars.angered, true, 'the flag is kept for every god, used by two');
  const spot = findFree(game, 3, 3);
  const farm = addBuilding(game, 'farm_wheat', spot.x, spot.y, 3);
  for (let k = 0; k < 2; k++) {
    farm.progress = 50;
    act(game, 'ceres', 'wrath');
    assert.equal(farm.progress, 0, `wrath ${k + 1}: the crop is lost, no more`);
    assert.ok(game.buildings.has(farm.id));
  }
});

// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

/** How many gods each home has access to, by building id. */
function godsPerHome(buildings, keys) {
  const out = {};
  for (const b of buildings) if (b.house) out[b.id] = keys.filter((k) => b.house.religion[k] > 0).length;
  return out;
}

test('save: a version 6 city (Jupiter and Vesta) loads with Mercury and Venus in their places', () => {
  // The fixture is a real save written by v0.11.1 (save version 6): the demo
  // city with both old temples, a priest of each on his rounds, homes with
  // their access, Jupiter at mood 37 and Vesta at 81.
  const text = readFileSync(path.join(ROOT, 'tests/fixtures/save-v6-jupiter-vesta.json'), 'utf8');
  const raw = JSON.parse(text);
  assert.equal(raw.version, 6);
  const oldTemples = raw.buildings.filter((b) => b.type === 'temple_jupiter' || b.type === 'temple_vesta');
  assert.equal(oldTemples.length, 2);
  const before = godsPerHome(raw.buildings, ['jupiter', 'ceres', 'neptune', 'mars', 'vesta']);

  const game = deserializeGame(raw);
  // The temples, where they stood, claiming their tiles.
  for (const old of oldTemples) {
    const b = game.buildings.get(old.id);
    assert.ok(b, `temple #${old.id} survived the load`);
    assert.equal(b.type, old.type === 'temple_jupiter' ? 'temple_mercury' : 'temple_venus');
    assert.equal(b.def.god, old.type === 'temple_jupiter' ? 'mercury' : 'venus');
    assert.deepEqual([b.x, b.y], [old.x, old.y]);
    assert.equal(game.map.building[game.map.idx(b.x + 1, b.y + 1)], b.id, 'its tiles are its own');
  }
  assert.equal(game.buildings.size, raw.buildings.length, 'no building was dropped');
  // The moods, carried over whole.
  const g = game.city.gods;
  assert.deepEqual(Object.keys(g).sort(), [...GOD_KEYS].sort());
  assert.deepEqual([g.mercury.mood, g.mercury.cooldown, g.mercury.festival], [37, 3, 9]);
  assert.deepEqual([g.venus.mood, g.venus.cooldown], [81, 5]);
  assert.equal(g.ceres.mood, raw.city.gods.ceres.mood);
  for (const k of GOD_KEYS) assert.equal(g[k].angered, false);
  assert.equal(game.city.venusBoost, 0);
  // Every home keeps its access, under the new names: none loses a god.
  for (const b of game.buildings.values()) {
    if (!b.house) continue;
    const r = raw.buildings.find((x) => x.id === b.id).house.religion;
    assert.equal(b.house.religion.mercury, r.jupiter);
    assert.equal(b.house.religion.venus, r.vesta);
    assert.ok(!('jupiter' in b.house.religion) && !('vesta' in b.house.religion));
  }
  assert.deepEqual(godsPerHome([...game.buildings.values()], GOD_KEYS), before);
  // Priests serve the new gods (and wear their colors).
  const priests = [...game.walkers.values()].filter((w) => w.type === 'priest');
  assert.equal(priests.length, raw.walkers.filter((w) => w.type === 'priest').length);
  for (const p of priests) assert.ok(GODS[p.god], `a priest of ${p.god}`);
  assert.ok(priests.some((p) => p.god === 'mercury') && priests.some((p) => p.god === 'venus'));

  // It plays on, and saves as version 7.
  for (let t = 0; t < TICKS_PER_MONTH; t++) game.tick();
  const again = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  assert.equal(serializeGame(again).version, 7);
  assert.ok([...again.buildings.values()].some((b) => b.type === 'temple_mercury'));
});

test('save: the upgrade renames a sandbox scenario\'s unlock list too, and leaves version 7 saves alone', () => {
  const data = { version: 6, city: { gods: { jupiter: { mood: 1 }, vesta: { mood: 2 }, mars: { mood: 3 } } }, buildings: [], walkers: [{ type: 'priest', god: 'vesta' }, { type: 'prefect' }], scenario: { unlocks: ['road', 'temple_jupiter', 'temple_vesta', 'temple_mars'] } };
  const up = upgradeGodsV6(data);
  assert.deepEqual(up.scenario.unlocks, ['road', 'temple_mercury', 'temple_venus', 'temple_mars']);
  assert.deepEqual(Object.keys(up.city.gods), ['mercury', 'venus', 'mars']);
  assert.equal(up.walkers[0].god, 'venus');
  assert.deepEqual(up.walkers[1], { type: 'prefect' });
  assert.equal(data.scenario.unlocks[1], 'temple_jupiter', 'a copy, not the original');
  // A v7 round trip keeps the angered flags and Venus's factor.
  const game = newGame({ seed: 'v7' });
  game.city.gods.mercury.angered = true;
  game.city.venusBoost = -7.5;
  const copy = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  assert.equal(copy.city.gods.mercury.angered, true);
  assert.equal(copy.city.venusBoost, -7.5);
});

// ---------------------------------------------------------------------------
// The old gods are gone
// ---------------------------------------------------------------------------

/** Every file under a directory. */
function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
}

test('no source file names Jupiter or Vesta, except the save upgrade that renames them', () => {
  const allowed = new Set([path.join(ROOT, 'src/core/save.js')]);
  const files = [...filesUnder(path.join(ROOT, 'src')), path.join(ROOT, 'tests/e2e/artsheet.html'), path.join(ROOT, 'index.html')];
  for (const f of files) {
    if (allowed.has(f)) continue;
    const text = readFileSync(f, 'utf8');
    assert.ok(!/jupiter|vesta/i.test(text), `${path.relative(ROOT, f)} still names an old god`);
  }
  // In the save code, only the upgrade and its notes may.
  const save = readFileSync(path.join(ROOT, 'src/core/save.js'), 'utf8').split('\n');
  const lines = save.map((l, i) => [i, l]).filter(([, l]) => /jupiter|vesta/i.test(l));
  assert.ok(lines.length > 0 && lines.length <= 4, `${lines.length} lines`);
  const upgradeAt = save.findIndex((l) => l.startsWith('export function upgradeGodsV6'));
  const historyEnd = save.findIndex((l) => l.startsWith(' * Typed-array map layers'));
  for (const [i, l] of lines) assert.ok(i < historyEnd || (i > upgradeAt - 30 && i < upgradeAt), `save.js line ${i + 1}: ${l.trim()}`);
});

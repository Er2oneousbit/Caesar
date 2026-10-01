/**
 * legion.test.mjs - Caesar's legions (sim/legion.js): the warning and the
 * countdown, the army's size per attack and difficulty, its targets, the
 * favor bands that send it home or halt it, the +10 favor only for an army
 * destroyed, and the loss of a city overrun (no recall at favor 0), from the
 * rules spec's worked examples.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { Game } from '../src/core/game.js';
import { DIFFICULTY } from '../src/data/difficulty.js';
import { sandboxScenario, findScenario, withDifficulty } from '../src/data/scenarios.js';
import { UNIT_TYPES } from '../src/data/units.js';
import { addBuilding, removeBuilding } from '../src/sim/entities.js';
import { spawnUnit, removeUnit, launchInvasion, threatSummary, enemyCount, damageBuilding, updateMilitary, militaryDaily } from '../src/sim/military.js';
import { Terrain, Wall } from '../src/world/map.js';
import { defeatTip } from '../src/ui/menus.js';
import {
  legionSize, siegeOrder, caesarDaily, startMarch, launchLegion, legionTargets, legionCount, legionSummary,
  isOverrun, checkOverrun, soldierCount,
} from '../src/sim/legion.js';
import { checkOutcome } from '../src/sim/ratings.js';
import { legionText } from '../src/ui/empireInfo.js';
import { empireTravelers, travelerLabel } from '../src/ui/empireMap.js';
import { buildDemoCity } from '../src/dev/demoCity.js';
import { newGame, findFree } from './helpers.mjs';

log.setLevel('error');

/** Run whole days (Game.runDays, named for the tests' reading). */
const days = (game, n) => game.runDays(n);

/** Messages so far whose text matches `re`. */
const said = (game, re) => game.messages.filter((m) => re.test(m.text));

// ---------------------------------------------------------------------------
// The warning and the countdown
// ---------------------------------------------------------------------------

test('favor 10 or less sets the legions marching, with a message every time; nothing pending first', () => {
  const game = newGame();
  game.city.ratings.favor = 11;
  caesarDaily(game);
  assert.equal(game.military.caesar.countdown, 0, '11 is above the line');
  game.city.ratings.favor = 10;
  caesarDaily(game);
  const cs = game.military.caesar;
  assert.equal(cs.countdown, CONFIG.LEGION_MARCH_DAYS, 'a 192-day march');
  assert.equal(CONFIG.LEGION_MARCH_DAYS, 12 * CONFIG.DAYS_PER_MONTH, 'twelve months');
  assert.equal(cs.size, 16, 'a first attack on Normal: 16 men');
  assert.equal(said(game, /Caesar has lost patience/).length, 1, 'warned');
  // Already marching: no second warning, the count goes on.
  caesarDaily(game);
  assert.equal(said(game, /Caesar has lost patience/).length, 1);
  assert.equal(cs.countdown, CONFIG.LEGION_MARCH_DAYS - 1);
});

test('the march cannot be called off: favor won back meanwhile, they still come (and go home)', () => {
  const game = newGame();
  game.city.ratings.favor = 9;
  caesarDaily(game);
  game.city.ratings.favor = 60; // gifts, requests met
  for (let d = 1; d < CONFIG.LEGION_MARCH_DAYS; d++) caesarDaily(game);
  assert.equal(game.military.caesar.countdown, 1, 'still on the road');
  caesarDaily(game);
  const cs = game.military.caesar;
  assert.ok(cs.army, 'arrived after 192 days');
  assert.equal(cs.attacks, 1);
  assert.equal(legionCount(game), 16);
  // Day 1 of the siege at favor 60: they turn for home at once (example 2).
  caesarDaily(game);
  assert.equal(cs.army.retreating, true);
  assert.equal(said(game, /favor in Rome is restored/).length, 1);
});

test('the daily check runs in the game: favor 10 one day, the legions at the gate twelve months later', () => {
  const game = newGame();
  game.city.ratings.favor = 5;
  days(game, 1);
  assert.equal(game.military.caesar.countdown, CONFIG.LEGION_MARCH_DAYS);
  days(game, CONFIG.LEGION_MARCH_DAYS);
  assert.ok(game.military.caesar.army, 'they came');
  const men = [...game.units.values()].filter((u) => u.legion);
  assert.equal(men.length, 16);
  assert.ok(men.every((u) => u.type === 'imperial' && u.side === 'enemy'));
});

// ---------------------------------------------------------------------------
// The army
// ---------------------------------------------------------------------------

test('sizes: 16, 32, 48, 72 on Normal, times the raid lever, at most 75', () => {
  const sizes = (d) => [0, 1, 2, 3, 4, 9].map((n) => legionSize(newGame({ difficulty: d }), n));
  assert.deepEqual(sizes('normal'), [16, 32, 48, 72, 72, 72]);
  assert.deepEqual(sizes('easy'), [11, 22, 34, 50, 50, 50]);
  assert.deepEqual(sizes('hard'), [21, 42, 62, 75, 75, 75], 'Hard: 72 x 1.3 = 94, capped at 75');
  assert.deepEqual(sizes('insane'), [24, 48, 72, 75, 75, 75]);
});

test('the imperial legionary: in proportion to the province\'s legionary, and never scaled by difficulty', () => {
  const im = UNIT_TYPES.imperial;
  const lg = UNIT_TYPES.legionary;
  assert.deepEqual([im.hp, im.attack, im.defense, im.side], [110, 18, 11, 'enemy']);
  assert.equal(im.hp, lg.hp, 'the same health');
  assert.ok(im.attack > lg.attack && im.defense > lg.defense, 'better armed');
  const game = newGame({ difficulty: 'insane' });
  const army = launchLegion(game, 3);
  const u = [...game.units.values()].find((x) => x.legion === army.id);
  assert.equal(u.maxHp, 110, 'Insane makes raiders tougher, not Caesar\'s men');
});

test('arrival: at the map entrance, company after company; the attack counts', () => {
  const game = newGame();
  const army = launchLegion(game, 20);
  assert.equal(army.size, 20);
  const men = [...game.units.values()].filter((u) => u.legion === army.id);
  assert.equal(men.length, 20);
  const e = game.map.entry;
  assert.ok(men.every((u) => Math.hypot(u.x - e.x, u.y - e.y) < 10), 'all near the entrance');
  // The second company waits its turn behind the first.
  assert.ok(Math.max(...men.map((u) => u.waitTicks)) >= 100);
  assert.equal(game.military.caesar.attacks, 1);
  assert.equal(said(game, /Caesar's legions have arrived/).length, 1);
});

test('targets: the residence first, then the best homes, then anything', () => {
  const game = newGame({ seed: 'demo' });
  const res = buildDemoCity(game, { level: 1 });
  assert.ok(res.ok);
  days(game, 16 * 4);
  const spot = findFree(game, 3, 3, res.center);
  const house = addBuilding(game, 'governor_house', spot.x, spot.y);
  let t = legionTargets(game);
  assert.equal(t.what, 'residence');
  assert.ok(t.isTarget(house.id));
  const homes = [...game.buildings.values()].filter((b) => b.house && b.house.pop > 0);
  assert.ok(homes.length > 1);
  assert.ok(!homes.some((b) => t.isTarget(b.id)), 'no home while the residence stands');
  removeBuilding(game, house);
  t = legionTargets(game);
  assert.equal(t.what, 'homes');
  const best = Math.max(...homes.map((b) => b.house.tier));
  for (const b of homes) assert.equal(t.isTarget(b.id), b.house.tier === best, `a level ${b.house.tier} home`);
  for (const b of homes) removeBuilding(game, b);
  t = legionTargets(game);
  assert.equal(t.what, 'anything');
  const any = [...game.buildings.values()][0];
  assert.ok(t.isTarget(any.id));
});

test('the army marches on the residence and breaks it', () => {
  const game = newGame({ type: 'plains', seed: 'legion-march' });
  const spot = findFree(game, 3, 3, { x: 32, y: 32 });
  const house = addBuilding(game, 'governor_house', spot.x, spot.y);
  game.city.ratings.favor = 5;
  launchLegion(game, 6);
  for (let d = 0; d < 80 && game.buildings.has(house.id); d++) days(game, 1);
  assert.ok(!game.buildings.has(house.id), 'the residence fell');
  assert.ok(said(game, /Caesar's legions have (set|torn down) a Governor's House/).length >= 1, 'in Caesar\'s name, not the raiders\'');
});

// ---------------------------------------------------------------------------
// Favor decides: home, halt, attack (the sane order)
// ---------------------------------------------------------------------------

test('siege orders by favor, per difficulty: home at the higher band, halt in the middle (first year only)', () => {
  const n = DIFFICULTY.normal;
  assert.deepEqual([n.legionHalt, n.legionHome], [18, 24]);
  assert.equal(siegeOrder(n, 24, 1), 'home');
  assert.equal(siegeOrder(n, 60, 300), 'home', 'high favor sends them home at any time');
  assert.equal(siegeOrder(n, 23, 1), 'halt');
  assert.equal(siegeOrder(n, 18, CONFIG.LEGION_HALT_DAYS), 'halt');
  assert.equal(siegeOrder(n, 18, CONFIG.LEGION_HALT_DAYS + 1), 'attack', 'after a year the siege goes on');
  assert.equal(siegeOrder(n, 17, 1), 'attack');
  const e = DIFFICULTY.easy;
  const i = DIFFICULTY.insane;
  assert.equal(siegeOrder(e, 22, 1), 'home');
  assert.equal(siegeOrder(i, 22, 1), 'halt', 'Insane asks more of a governor');
  assert.equal(siegeOrder(i, 21, 1), 'attack');
});

test('a halted army stands still; favor lost again sets it attacking', () => {
  const game = newGame();
  const cs = game.military.caesar;
  launchLegion(game, 4);
  for (const u of game.units.values()) u.waitTicks = 0;
  game.city.ratings.favor = 20;
  caesarDaily(game);
  assert.equal(cs.army.halted, true);
  assert.equal(said(game, /halt where they stand/).length, 1);
  const men = [...game.units.values()].filter((u) => u.legion);
  const before = men.map((u) => [u.x, u.y]);
  game.runTicks(60);
  assert.deepEqual(men.map((u) => [u.x, u.y]), before, 'nobody moved');
  assert.ok(men.every((u) => u.state === 'halt'));
  game.city.ratings.favor = 12;
  caesarDaily(game);
  assert.equal(cs.army.halted, false);
  assert.equal(said(game, /resume the attack/).length, 1);
});

// ---------------------------------------------------------------------------
// The end of an attack: +10 only for an army destroyed
// ---------------------------------------------------------------------------

test('an army destroyed earns Caesar\'s respect (+10); the next attack is bigger', () => {
  const game = newGame();
  game.city.ratings.favor = 9;
  const army = launchLegion(game, 3);
  for (const u of [...game.units.values()]) if (u.legion) removeUnit(game, u, 'died');
  assert.equal(army.killed, 3);
  caesarDaily(game);
  assert.equal(game.military.caesar.army, null, 'over');
  assert.equal(game.city.ratings.favor, 19, '+10');
  assert.equal(said(game, /respect/).length, 1);
  assert.equal(game.military.caesar.stats.beaten, 1);
  // Favor 19 is above 10: no new march. At 10 again, the second attack is 32.
  caesarDaily(game);
  assert.equal(game.military.caesar.countdown, 0);
  game.city.ratings.favor = 10;
  caesarDaily(game);
  assert.equal(game.military.caesar.size, 32);
});

test('an army that marches home earns nothing (the original paid a retreat as a victory)', () => {
  const game = newGame();
  launchLegion(game, 3);
  game.city.ratings.favor = 30;
  caesarDaily(game); // home
  assert.ok(game.military.caesar.army.retreating);
  // They walk out by the entrance; some may be killed on the way.
  const men = [...game.units.values()].filter((u) => u.legion);
  removeUnit(game, men[0], 'died');
  for (const u of men.slice(1)) removeUnit(game, u, 'fled');
  caesarDaily(game);
  assert.equal(game.military.caesar.army, null);
  assert.equal(game.city.ratings.favor, 30, 'no +10');
  assert.equal(game.military.caesar.stats.withdrew, 1);
});

test('the retreating army walks out by the map entrance and is gone', () => {
  const game = newGame();
  launchLegion(game, 4);
  game.city.ratings.favor = 40;
  for (let d = 0; d < 40 && game.military.caesar.army; d++) days(game, 1);
  assert.equal(game.military.caesar.army, null);
  assert.equal(legionCount(game), 0);
});

// ---------------------------------------------------------------------------
// Raids and legions at once
// ---------------------------------------------------------------------------

test('a raid and Caesar\'s legions can be in the province together, each with its own count', () => {
  const game = newGame({ invasions: 'occasional' });
  game.city.population = 800;
  const inv = launchInvasion(game, null, 5);
  const army = launchLegion(game, 4);
  assert.equal(enemyCount(game), 9);
  const raider = [...game.units.values()].find((u) => u.invasion === inv.id);
  const legionary = [...game.units.values()].find((u) => u.legion === army.id);
  removeUnit(game, legionary, 'died');
  removeUnit(game, raider, 'died');
  assert.equal(inv.killed, 1);
  assert.equal(army.killed, 1);
  const t = threatSummary(game);
  assert.equal(t.level, 'attack');
  assert.match(t.text, /3 of Caesar's legionaries and 4 raiders/);
  // A building the legions wreck counts for them, not for the raid.
  const b = [...game.buildings.values()][0] || addBuilding(game, 'well', 10, 10);
  damageBuilding(game, b, 1e6, { legion: army });
  assert.equal(inv.buildingsLost, 0);
  assert.equal(army.buildingsLost, 1);
});

// ---------------------------------------------------------------------------
// Losing: no recall at favor 0, only a city overrun
// ---------------------------------------------------------------------------

/** Mission 4 on Normal, with a population and a peak set by hand. */
function mission(pop, peak) {
  const game = new Game({ scenario: withDifficulty(findScenario('c4'), 'normal'), flags: { money: 20000, unlockall: true } });
  game.city.population = pop;
  game.city.stats.peakPopulation = peak;
  return game;
}

test('favor 0 no longer recalls the governor', () => {
  const game = mission(500, 500);
  let lost = null;
  game.events.on('defeat', (e) => { lost = e; });
  game.city.ratings.favor = 0;
  checkOutcome(game);
  assert.equal(lost, null);
  assert.equal(game.city.defeat, false);
});

test('overrun: invaders over soldiers + 2 while under a quarter of the peak population loses the mission', () => {
  const game = mission(240, 1000);
  let lost = null;
  game.events.on('defeat', (e) => { lost = e; });
  launchLegion(game, 3);
  assert.equal(soldierCount(game), 0);
  assert.equal(isOverrun(game), true, '3 > 0 + 2 and 240 < 250');
  game.city.population = 250;
  assert.equal(isOverrun(game), false, 'a quarter exactly is not under it');
  game.city.population = 240;
  const fort = addBuilding(game, 'fort_legion', 20, 20);
  const guard = spawnUnit(game, 'legionary', 21.5, 24.5, { fort: fort.id, slot: 0 });
  assert.equal(isOverrun(game), false, '3 is not more than 1 + 2');
  removeUnit(game, guard, 'died');
  assert.equal(checkOverrun(game), true);
  assert.ok(lost && /overrun/.test(lost.reason), lost && lost.reason);
  assert.match(lost.reason, /240 of the 1000 people/);
  assert.equal(game.city.defeat, true);
});

test('overrun needs the population to have fallen: a city at its peak holds out', () => {
  const game = mission(900, 1000);
  launchLegion(game, 10);
  assert.equal(isOverrun(game), false);
});

test('a sandbox (no goals) is never lost', () => {
  const game = newGame();
  game.city.population = 10;
  game.city.stats.peakPopulation = 1000;
  launchLegion(game, 5);
  assert.equal(isOverrun(game), true);
  assert.equal(checkOverrun(game), false);
  assert.equal(game.city.defeat, false);
});

test('the population peak is tracked as the city grows', () => {
  const game = newGame({ seed: 'demo' });
  buildDemoCity(game, { level: 1 });
  days(game, 16 * 5);
  assert.ok(game.city.population > 0);
  assert.ok(game.city.stats.peakPopulation >= game.city.population);
});

// ---------------------------------------------------------------------------
// Found in review
// ---------------------------------------------------------------------------

test('a walled-in entrance does not keep the legions out: they tear down what stands on it and come in', () => {
  const game = newGame();
  const { map } = game;
  const e = map.entry;
  // A gate on the entrance, and a wall or gate on every land tile around it.
  const shut = (x, y) => { const i = map.idx(x, y); if (map.terrain[i] !== Terrain.WATER && map.terrain[i] !== Terrain.ROCK) map.wall[i] = map.road[i] ? Wall.GATE : Wall.WALL; };
  shut(e.x, e.y);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (map.inBounds(e.x + dx, e.y + dy)) shut(e.x + dx, e.y + dy);
  map.touch();
  const army = launchLegion(game, 4);
  assert.ok(army, 'they came');
  assert.equal(game.military.caesar.attacks, 1, 'the attack counts');
  assert.equal(map.wall[map.idx(e.x, e.y)], Wall.NONE, 'the gate on the entrance is down');
  assert.equal(legionCount(game), 4);
});

test('a legionary leaves alone a soldier he cannot reach (an island fort) and the army is not held for ever', () => {
  const game = newGame({ type: 'plains', seed: 'legion-island' });
  const { map } = game;
  const s = findFree(game, 9, 9, { x: 32, y: 32 });
  const ix = s.x + 3;
  const iy = s.y + 4;
  // An island: one tile of land in a ring of water two tiles wide.
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx || dy) map.terrain[map.idx(ix + dx, iy + dy)] = Terrain.WATER;
  map.touch();
  const far = findFree(game, 3, 3, { x: 10, y: 10 });
  const fort = addBuilding(game, 'fort_legion', far.x, far.y);
  const guard = spawnUnit(game, 'legionary', ix + 0.5, iy + 0.5, { fort: fort.id, slot: 0, state: 'idle' });
  const army = launchLegion(game, 1);
  const u = [...game.units.values()].find((x) => x.legion === army.id);
  Object.assign(u, { x: ix + 3.5, y: iy + 0.5, px: ix + 3.5, py: iy + 0.5, waitTicks: 0 });
  game.city.ratings.favor = 5;
  let fighting = 0;
  for (let t = 0; t < 300; t++) {
    updateMilitary(game);
    if (u.state === 'fight') fighting++;
  }
  assert.ok(game.units.has(guard.id) && game.units.has(u.id));
  assert.ok(u.ignore && u.ignore.includes(guard.id), 'he gave up on the man across the water');
  assert.ok(fighting < 300, `not locked in a fight for ever (${fighting} of 300 ticks)`);
  assert.notEqual(u.state, 'fight');
  // A backstop: after two years in the province any army goes home.
  army.day = CONFIG.LEGION_MAX_DAYS;
  caesarDaily(game);
  assert.equal(army.retreating, true);
});

test('a raid ending keeps the arrows flying at Caesar\'s men', () => {
  const game = newGame({ invasions: 'occasional' });
  game.city.population = 800;
  const inv = launchInvasion(game, null, 2);
  const army = launchLegion(game, 2);
  const legionary = [...game.units.values()].find((u) => u.legion === army.id);
  for (const u of [...game.units.values()]) if (u.invasion === inv.id) removeUnit(game, u, 'died');
  game.projectiles.push({ x: 1, y: 1, z: 10, target: legionary.id, damage: 5, speed: 0.4, kind: 'arrow', life: 60 });
  militaryDaily(game); // the raid is over
  assert.equal(game.military.active, null);
  assert.equal(game.projectiles.length, 1, 'the arrow at the legionary flies on');
});

test('the defeat screen speaks of soldiers and people, the overrun rule, not of favor alone', () => {
  const tip = defeatTip();
  assert.match(tip, /outnumber its soldiers/);
  assert.match(tip, /people/);
  assert.doesNotMatch(tip, /send gifts when favor runs low/);
});

// ---------------------------------------------------------------------------
// What the screens say
// ---------------------------------------------------------------------------

test('words and the empire map: marching, on the map, nothing', () => {
  const game = newGame();
  assert.equal(legionText(game).level, 'none');
  assert.equal(legionSummary(game).state, 'none');
  game.city.ratings.favor = 4;
  caesarDaily(game);
  const s = legionSummary(game);
  assert.equal(s.state, 'marching');
  assert.equal(s.months, 12);
  assert.match(legionText(game).status, /16 of Caesar's legionaries are marching from Rome/);
  const t = empireTravelers(game).find((x) => x.kind === 'legion');
  assert.ok(t && !t.here);
  assert.match(travelerLabel(t), /Caesar's legions \(16 men\) marching from Rome, in 12 months/);
  assert.equal(threatSummary(game).label, '⚠ Legions');
  for (let d = 0; d < CONFIG.LEGION_MARCH_DAYS; d++) caesarDaily(game);
  const here = empireTravelers(game).find((x) => x.kind === 'legion');
  assert.ok(here && here.here);
  assert.match(legionText(game).status, /in the province: 16 of 16 left, attacking/);
});

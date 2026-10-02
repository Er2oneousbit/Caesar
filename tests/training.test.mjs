/**
 * training.test.mjs - the Military Academy, the Portus and large temples
 * (sim/training.js, sim/religion.js): their data and unlocks; a recruit
 * trained when he reaches the academy, never when he sets out, and the
 * academy nearest his fort (only one at full staff); soldiers and ships at
 * rest never sent there (an older save's trip comes home); damage
 * with and without training; the Portus's water; a large temple counting as
 * two; the battle strength helper; the panels' words; saves from version 11.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { serializeGame, deserializeGame, upgradeTrainingV11 } from '../src/core/save.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { UNIT_TYPES, FORT_CAPACITY } from '../src/data/units.js';
import { SCENARIOS, LARGE_TEMPLE_KEYS, NAVY_KEYS } from '../src/data/scenarios.js';
import { GOD_KEYS } from '../src/data/gods.js';
import { addBuilding, removeBuilding } from '../src/sim/entities.js';
import { checkBuilding } from '../src/sim/construction.js';
import { updateWalkers } from '../src/sim/walkers.js';
import { updateServiceSpawns } from '../src/sim/services.js';
import { updateReligion } from '../src/sim/religion.js';
import {
  spawnUnit, updateBarracks, updateMilitary, fortPost, deployFort, recallFort, rollDamage, unitDefense, missileDamage, holdingPosition,
} from '../src/sim/military.js';
import { shoreBerth, waterOf, shipSpeed, ramOf, deployStation } from '../src/sim/navy.js';
import { academyFor, portusFor, trainsNow, updateDrill, startDrill, battleStrength, trainedOf, reachBetween } from '../src/sim/training.js';
import { trainedText, trainingNote, schoolStatus, templeCount, inTrainingText } from '../src/ui/trainingInfo.js';
import { buildDemoCity, buildDemoNavy } from '../src/dev/demoCity.js';
import { Terrain } from '../src/world/map.js';
import { newGame, build, findFree } from './helpers.mjs';

log.setLevel('error');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A straight road with a barracks above it at the west end, a fort above it
 * at the east end and a Military Academy below it in the middle, all fully
 * staffed (the tests drive the walkers and soldiers directly, so the day's
 * labor count never resets them). Open land all around.
 */
function lineCity() {
  const game = newGame({ type: 'plains' });
  const s = openLand(game, 34, 10);
  assert.ok(s, 'room for the line city');
  const y = s.y + 4;
  build(game, 'road', s.x, y, s.x + 33, y);
  const barracks = addBuilding(game, 'barracks', s.x, s.y + 1);
  const academy = addBuilding(game, 'military_academy', s.x + 14, s.y + 5);
  const fort = addBuilding(game, 'fort_legion', s.x + 29, s.y + 1);
  game.processRoadChanges();
  for (const b of [barracks, academy, fort]) b.efficiency = 1;
  for (const b of [barracks, academy, fort]) assert.ok(b.accessRoad >= 0, `${b.type} has a road`);
  return { game, barracks, academy, fort, s };
}

/**
 * A w x h rectangle with no water, rock, road or building on it; its trees
 * are cleared to grass (a strip that long is rarely bare on a generated map).
 */
function openLand(game, w, h) {
  const { map } = game;
  for (let y = 2; y < map.h - h - 2; y++) {
    for (let x = 2; x < map.w - w - 2; x++) {
      let ok = true;
      for (let dy = 0; dy < h && ok; dy++) {
        for (let dx = 0; dx < w && ok; dx++) {
          const i = map.idx(x + dx, y + dy);
          const t = map.terrain[i];
          if (t === Terrain.WATER || t === Terrain.ROCK || map.road[i] || map.fixedRoad[i] || map.building[i]) ok = false;
        }
      }
      if (!ok) continue;
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const i = map.idx(x + dx, y + dy);
          if (map.terrain[i] === Terrain.TREES) map.terrain[i] = Terrain.GRASS;
        }
      }
      map.touch();
      return { x, y };
    }
  }
  return null;
}

/** The barracks sends one legionary recruit now. */
function sendRecruit(game, barracks) {
  barracks.stock.weapons = 50;
  barracks.trainProgress = 100;
  updateBarracks(game, barracks);
  const w = [...game.walkers.values()].find((x) => x.type === 'recruit' && !x.dead);
  assert.ok(w, 'a recruit set out');
  return w;
}

/** Tick the walkers until `done()` or `max` ticks. */
function walkUntil(game, done, max = 4000) {
  for (let t = 0; t < max; t++) {
    if (done()) return t;
    updateWalkers(game);
  }
  return -1;
}

/** Tick the soldiers until `done()` or `max` ticks. */
function fightUntil(game, done, max = 6000) {
  for (let t = 0; t < max; t++) {
    if (done()) return t;
    updateMilitary(game);
  }
  return -1;
}

/** A fort's garrison standing at its post, all untrained. */
function garrison(game, fort, n = FORT_CAPACITY) {
  const post = fortPost(game, fort);
  const men = [];
  for (let slot = 0; slot < n; slot++) men.push(spawnUnit(game, fort.def.unit, post.x, post.y, { fort: fort.id, slot, state: 'march' }));
  fightUntil(game, () => men.every((u) => u.state === 'idle'), 2000);
  return men;
}

// ---------------------------------------------------------------------------
// Data and unlocks
// ---------------------------------------------------------------------------

test('data: the Military Academy and the Portus, with the spec\'s numbers', () => {
  const a = BUILDINGS.military_academy;
  assert.deepEqual([a.size, a.cost, a.workers, a.labor, a.category, a.kind], [3, 1000, 20, 'military', 'military', 'military_academy']);
  assert.deepEqual(a.des, [-3, 1, 1, 3]);
  assert.ok(a.fire > 0 && a.damage > 0, 'it can burn and collapse like an ordinary building');
  assert.equal(a.walker, null, 'no walker of its own');
  const p = BUILDINGS.portus;
  assert.equal(p.name, 'Portus');
  assert.deepEqual([p.size, p.cost, p.workers, p.labor, p.placement, p.kind], [3, 600, 12, 'military', 'shore', 'portus']);
  assert.equal(p.placement, BUILDINGS.navalia.placement, 'the Navalia\'s water rule');
  assert.equal(p.placement, BUILDINGS.naval_station.placement, 'and the Naval Station\'s');
  for (const g of GOD_KEYS) assert.equal(BUILDINGS[`temple_large_${g}`].name.startsWith('Templum '), true);
});

test('unlocks: the academy with the first forts, the Portus with the fleet, large temples from mission 3', () => {
  const has = (s, k) => s.unlocks === 'all' || s.unlocks.includes(k);
  const firstFort = SCENARIOS.findIndex((s) => ['fort_legion', 'fort_archer', 'fort_cavalry'].some((k) => has(s, k)));
  const firstAcademy = SCENARIOS.findIndex((s) => has(s, 'military_academy'));
  assert.equal(firstAcademy, firstFort, 'from the first mission that has forts');
  assert.equal(SCENARIOS[firstAcademy].id, 'c3m', 'Firmum, the military province of step 3, a step sooner than mission 4');
  for (const s of SCENARIOS) {
    const forts = ['fort_legion', 'fort_archer', 'fort_cavalry'].some((k) => has(s, k));
    assert.equal(has(s, 'military_academy'), forts, `${s.id}: the Campus wherever there are forts, and only there`);
    assert.equal(has(s, 'portus'), has(s, 'navalia'), `${s.id}: the Portus wherever the Navalia is`);
    for (const k of LARGE_TEMPLE_KEYS) assert.equal(has(s, k), !['c1', 'c2'].includes(s.id), `${s.id}: ${k}`);
  }
  assert.ok(NAVY_KEYS.includes('portus'));
  assert.equal(has(SCENARIOS.find((s) => s.id === 'c6'), 'portus'), false, 'mission 6: no water to sail, no Portus');
  assert.equal(has(SCENARIOS.find((s) => s.id === 'c6'), 'military_academy'), true);
});

// ---------------------------------------------------------------------------
// Recruits
// ---------------------------------------------------------------------------

test('a recruit trains a month at the academy, his place in the fort held, and arrives a trained soldier', () => {
  const { game, barracks, academy, fort } = lineCity();
  const TRAIN = CONFIG.ACADEMY_TRAIN_DAYS * CONFIG.TICKS_PER_DAY;
  assert.equal(CONFIG.ACADEMY_TRAIN_DAYS, 16);
  const w = sendRecruit(game, barracks);
  assert.equal(w.state, 'toAcademy', 'the academy first');
  assert.equal(w.academy, academy.id);
  assert.equal(w.trained, false, 'not trained as he sets out');
  assert.ok(walkUntil(game, () => w.state === 'training') > 0, 'he reaches the academy');
  assert.equal(game.map.idx(w.x, w.y), academy.accessRoad, 'at the academy\'s road');
  assert.equal(w.trained, false, 'not trained on arrival: he stays to train');
  assert.equal(w.trainLeft, TRAIN);
  assert.equal(fort.recruiting, 1, 'his place in the fort is held for him');
  assert.equal(inTrainingText(game, academy), `1 (${CONFIG.ACADEMY_TRAIN_DAYS} days left)`, 'the academy panel');
  assert.equal(inTrainingText(game, fort), `1 (${CONFIG.ACADEMY_TRAIN_DAYS} days left)`, 'the fort panel');
  assert.equal(walkUntil(game, () => w.state === 'toFort'), TRAIN, 'a month of ticks at full staff, standing at the academy');
  assert.equal(game.map.idx(w.x, w.y), academy.accessRoad);
  assert.equal(w.trained, true, 'trained when his time is done');
  assert.equal(inTrainingText(game, academy), null);
  assert.equal(academy.trainedHere || 0, 0, 'counted only once he joins his fort');
  assert.ok(walkUntil(game, () => w.dead) > 0, 'on to his fort');
  const [u] = [...game.units.values()];
  assert.ok(u && u.fort === fort.id, 'a soldier of the fort');
  assert.equal(u.trained, true);
  assert.equal(game.military.stats.soldiersTrained, 1);
  assert.equal(academy.trainedHere, 1);
  assert.equal(trainedText(game, fort), '1 of 1 trained');
});

test('the detour: the academy nearest the fort (not the barracks), and only one at full staff', () => {
  const { game, barracks, academy, fort, s } = lineCity();
  // A second academy right by the barracks, far from the fort.
  const near = addBuilding(game, 'military_academy', s.x + 4, s.y + 5);
  game.processRoadChanges();
  near.efficiency = 1;
  assert.ok(reachBetween(academy, fort) < reachBetween(near, fort));
  assert.equal(academyFor(game, fort), academy, 'nearest the fort');
  // The spec's example: the academy next to the fort is two-thirds staffed, so it does not count.
  const byFort = addBuilding(game, 'military_academy', s.x + 25, s.y + 5);
  game.processRoadChanges();
  byFort.efficiency = 2 / 3;
  assert.equal(trainsNow(game, byFort), false, '19 of 20 trains nobody');
  assert.equal(academyFor(game, fort), academy);
  byFort.efficiency = 1;
  assert.equal(academyFor(game, fort), byFort);
  // None at full staff: straight to the fort, untrained.
  for (const a of [academy, near, byFort]) a.efficiency = 0.95;
  const w = sendRecruit(game, barracks);
  assert.equal(w.state, 'toFort');
  walkUntil(game, () => w.dead);
  assert.equal([...game.units.values()][0].trained, false);
});

test('a recruit at an academy short of staff waits, and goes on when it is staffed again; one whose academy is demolished goes on untrained', () => {
  const { game, barracks, academy } = lineCity();
  const TRAIN = CONFIG.ACADEMY_TRAIN_DAYS * CONFIG.TICKS_PER_DAY;
  const w = sendRecruit(game, barracks);
  walkUntil(game, () => w.state === 'training');
  walkUntil(game, () => false, 100);
  assert.equal(w.trainLeft, TRAIN - 100);
  academy.efficiency = 19 / 20; // (one worker gone)
  walkUntil(game, () => false, 500);
  assert.equal(w.state, 'training', 'he waits at the academy');
  assert.equal(w.trainLeft, TRAIN - 100, 'his training paused');
  assert.match(inTrainingText(game, academy), /paused/);
  academy.efficiency = 1;
  assert.equal(walkUntil(game, () => w.state === 'toFort'), TRAIN - 100, 'and resumed where it stopped');
  assert.equal(w.trained, true);
  walkUntil(game, () => w.dead);
  academy.efficiency = 0.5;
  const w2 = sendRecruit(game, barracks);
  assert.equal(w2.state, 'toFort', 'a half-staffed academy sends nobody a detour');
  walkUntil(game, () => w2.dead);
  academy.efficiency = 1;
  const w3 = sendRecruit(game, barracks);
  walkUntil(game, () => w3.state === 'training');
  walkUntil(game, () => false, TRAIN - 1);
  removeBuilding(game, academy); // (a tick before he was done)
  game.processRoadChanges();
  walkUntil(game, () => w3.state === 'toFort' || w3.dead);
  assert.equal(w3.trained, false, 'no academy, no training');
  walkUntil(game, () => w3.dead);
  const trained = [...game.units.values()].map((u) => u.trained);
  assert.deepEqual(trained, [true, false, false]);
});

test('review: a recruit kept waiting by an academy short of staff for more than TRAIN_WAIT_MAX_DAYS goes on untrained', () => {
  const { game, barracks, academy, fort } = lineCity();
  const w = sendRecruit(game, barracks);
  walkUntil(game, () => w.state === 'training');
  academy.efficiency = 0.5;
  const wait = CONFIG.TRAIN_WAIT_MAX_DAYS * CONFIG.TICKS_PER_DAY;
  walkUntil(game, () => false, wait);
  assert.equal(w.state, 'training', 'still waiting on the last tick allowed');
  walkUntil(game, () => false, 1);
  assert.equal(w.state, 'toFort', 'then on to his fort');
  assert.equal(w.trained, false, 'untrained');
  walkUntil(game, () => w.dead);
  assert.equal(trainedText(game, fort), '0 of 1 trained');
});

test('a recruit whose academy is demolished before he gets there walks on to his fort untrained', () => {
  const { game, barracks, academy } = lineCity();
  const w = sendRecruit(game, barracks);
  assert.equal(w.state, 'toAcademy');
  removeBuilding(game, academy);
  game.processRoadChanges();
  walkUntil(game, () => w.state === 'toFort' || w.dead);
  assert.equal(w.state, 'toFort', 'on his way, never training');
  assert.equal(w.trained, false);
});

// ---------------------------------------------------------------------------
// Soldiers at rest
// ---------------------------------------------------------------------------

test('soldiers at rest never go to the academy: they hold their posts; a recruit passing it still comes trained', () => {
  const { game, barracks, academy, fort } = lineCity();
  const men = garrison(game, fort, 3);
  const spots = men.map((u) => ({ x: u.x, y: u.y }));
  for (let d = 0; d < 20; d++) {
    updateDrill(game);
    fightUntil(game, () => false, CONFIG.TICKS_PER_DAY);
  }
  assert.equal(men.filter((u) => u.drill).length, 0, 'nobody is sent to the drill yard');
  assert.ok(men.every((u, k) => u.state === 'idle' && Math.hypot(u.x - spots[k].x, u.y - spots[k].y) < 0.05), 'every man still at his post');
  assert.equal(trainedOf(game, fort.id).trained, 0, 'men who joined untrained stay so');
  assert.equal(academy.trainedHere || 0, 0);
  // A new recruit still goes by the academy and joins trained.
  const w = sendRecruit(game, barracks);
  assert.equal(w.state, 'toAcademy');
  assert.ok(walkUntil(game, () => w.dead) > 0, 'on to his fort');
  assert.equal(trainedText(game, fort), '1 of 4 trained');
  assert.equal(academy.trainedHere, 1);
});

test('a soldier on his way to the drill yard in an older save comes straight home, untrained', () => {
  const { game, academy, fort } = lineCity();
  const [u] = garrison(game, fort, 1);
  const post = { x: u.x, y: u.y };
  // (What an older save holds for a man on his trip.)
  Object.assign(u, { drill: academy.id, drillDay: game.time.totalDays, drillDays: CONFIG.DRILL_MAX_DAYS, state: 'drill' });
  u.x += 6;
  updateMilitary(game);
  assert.equal(u.drill, 0, 'the trip is off');
  assert.ok(fightUntil(game, () => u.state === 'idle') > 0, 'he marches back');
  assert.ok(Math.hypot(u.x - post.x, u.y - post.y) < 0.2, 'to his post');
  assert.equal(u.trained, false);
  assert.equal(academy.trainedHere || 0, 0);
});

test('review: a far Portus gets time for the row there; a short trip gets DRILL_MAX_DAYS; a late one is given up', () => {
  const { game, fort } = lineCity();
  // (The time limit is what is tested, so a soldier stands in for a ship.)
  const [u] = garrison(game, fort, 1);
  startDrill(game, u, { id: 998, x: u.x, y: u.y + 2, size: 3 });
  assert.equal(u.drillDays, CONFIG.DRILL_MAX_DAYS, 'a near school: the floor');
  // 80 tiles away a legionary (1.5 tiles a day) needs about 53 days each way: never given up on day 41.
  const far = { id: 999, x: u.x + 80, y: u.y, size: 3 };
  startDrill(game, u, far);
  const oneWay = 81.5 / (UNIT_TYPES.legionary.speed * CONFIG.TICKS_PER_DAY);
  assert.ok(u.drillDays > 2 * oneWay, `${u.drillDays} days for a ${Math.round(oneWay)}-day walk`);
  u.drillDay = game.time.totalDays - 60;
  updateDrill(game);
  assert.equal(u.drill, far.id, 'still on the way on day 60');
  u.drillDay = game.time.totalDays - u.drillDays - 1;
  updateDrill(game);
  assert.equal(u.drill, 0, 'given up once the time is out');
});

test('review: a recruit trained on the way but lost before his fort is not counted as trained', () => {
  const { game, barracks, academy, fort } = lineCity();
  const w = sendRecruit(game, barracks);
  walkUntil(game, () => w.state === 'toFort');
  assert.equal(w.trained, true);
  removeBuilding(game, fort);
  game.processRoadChanges();
  walkUntil(game, () => w.dead);
  assert.equal(game.units.size, 0);
  assert.equal(academy.trainedHere || 0, 0);
  assert.equal(game.military.stats.soldiersTrained || 0, 0);
});

test('review: a legionary blocked from his raider stands still, but is not in close order', () => {
  const { game, fort } = lineCity();
  const [leg] = garrison(game, fort, 1);
  leg.trained = true;
  const raider = spawnUnit(game, 'raider', leg.x + 6, leg.y, { invasion: 1 });
  leg.state = 'engage';
  leg.moving = false;
  leg.target = raider.id;
  assert.equal(holdingPosition(game, leg), false, 'his raider is out of reach');
  raider.x = leg.x + 0.8;
  assert.equal(holdingPosition(game, leg), true, 'standing to fight him');
});

// ---------------------------------------------------------------------------
// What training gives
// ---------------------------------------------------------------------------

test('damage: a trained legionary holding position, a trained archer, untrained men (the numbers)', () => {
  const { game, fort } = lineCity();
  const [leg] = garrison(game, fort, 1);
  const flat = { rng: { next: () => 0.5 } }; // no spread: attack x 1.0
  const raider = UNIT_TYPES.raider;
  const slinger = UNIT_TYPES.slinger;
  const LEG = UNIT_TYPES.legionary;
  // Untrained: raider 11 - 9/2 = 6.5; slinger 8 - 4.5 = 3.5.
  assert.equal(unitDefense(game, leg), LEG.defense);
  assert.equal(rollDamage(flat, raider, LEG, 1, unitDefense(game, leg)), 6.5);
  assert.equal(missileDamage(game, leg, rollDamage(flat, slinger, LEG, 1, unitDefense(game, leg))), 3.5);
  // Trained and holding: defense 9 + 4 = 13: raider 11 - 6.5 = 4.5; a sling stone 2 (the floor), a quarter of it lands.
  leg.trained = true;
  assert.ok(holdingPosition(game, leg));
  assert.equal(unitDefense(game, leg), LEG.defense + LEG.holdDefense);
  assert.equal(rollDamage(flat, raider, LEG, 1, unitDefense(game, leg)), 4.5);
  assert.equal(missileDamage(game, leg, rollDamage(flat, slinger, LEG, 1, unitDefense(game, leg))), 0.5);
  // Standing to fight a raider in reach is holding too; running after one or marching is not.
  const foe = spawnUnit(game, 'raider', leg.x + 0.8, leg.y, { invasion: 1 });
  leg.state = 'engage';
  leg.target = foe.id;
  assert.ok(holdingPosition(game, leg), 'standing to fight');
  leg.moving = true;
  assert.equal(holdingPosition(game, leg), false, 'running after a raider');
  assert.equal(unitDefense(game, leg), LEG.defense);
  assert.equal(missileDamage(game, leg, 3.5), 3.5);
  leg.moving = false;
  leg.state = 'march';
  assert.equal(holdingPosition(game, leg), false, 'marching');
  assert.equal(missileDamage(game, leg, 3.5), 3.5);
  leg.state = 'idle';
  // Attack and hit points never change.
  assert.equal(leg.maxHp, LEG.hp);
  // Archers and cavalry: +2 defense at all times.
  const archer = spawnUnit(game, 'archer', leg.x + 5, leg.y, { fort: fort.id, slot: 7, trained: true });
  assert.equal(unitDefense(game, archer), UNIT_TYPES.archer.defense + 2);
  assert.equal(rollDamage(flat, raider, UNIT_TYPES.archer, 1, unitDefense(game, archer)), 11 - 2.5);
  archer.trained = false;
  assert.equal(rollDamage(flat, raider, UNIT_TYPES.archer, 1, unitDefense(game, archer)), 11 - 1.5);
  // Raiders are never trained.
  const r = spawnUnit(game, 'raider', 1.5, 1.5, { trained: true });
  r.trained = false;
  assert.equal(unitDefense(game, r), raider.defense);
});

test('a trained legion fort loses fewer men to the same warband than an untrained one', () => {
  /** Eight legionaries at their fort against sixteen raiders: men lost, and the health the rest have left. */
  const skirmish = (trained) => {
    const { game, fort } = lineCity();
    const men = garrison(game, fort);
    for (const u of men) u.trained = trained;
    game.military.active = { id: 1, origin: { x: fort.x, y: fort.y + 10 }, size: 16, killed: 0, buildingsLost: 0, startDay: 0, fleeing: false, reached: false };
    for (let k = 0; k < 16; k++) spawnUnit(game, 'raider', fort.x + 1.5 + (k % 4), fort.y + 9.5 + Math.floor(k / 4), { invasion: 1, state: 'advance' });
    fightUntil(game, () => ![...game.units.values()].some((u) => u.side === 'enemy') || !men.some((u) => game.units.has(u.id)));
    const alive = men.filter((u) => game.units.has(u.id));
    return { lost: men.length - alive.length, hp: Math.round(alive.reduce((n, u) => n + u.hp, 0)) };
  };
  const untrained = skirmish(false);
  const trained = skirmish(true);
  const say = `trained lost ${trained.lost} (${trained.hp} hp left), untrained ${untrained.lost} (${untrained.hp})`;
  assert.ok(trained.lost < untrained.lost, say);
  assert.ok(trained.hp > untrained.hp, say);
});

test('ships: a trained crew rows faster, rams harder and is harder to hit', () => {
  const L = UNIT_TYPES.liburnian;
  const ship = { type: 'liburnian', trained: false };
  assert.equal(shipSpeed(ship), L.speed);
  assert.equal(ramOf(ship), 45);
  ship.trained = true;
  assert.equal(shipSpeed(ship), L.trainedSpeed);
  assert.ok(L.trainedSpeed > L.speed);
  assert.equal(ramOf(ship), 55);
  const flat = { rng: { next: () => 0.5 } };
  const game = newGame();
  assert.equal(rollDamage(flat, UNIT_TYPES.raider_ship, L, 1, unitDefense(game, { type: 'liburnian', trained: false })), 9 - 3);
  assert.equal(rollDamage(flat, UNIT_TYPES.raider_ship, L, 1, unitDefense(game, { type: 'liburnian', trained: true })), 9 - 4.5);
});

test('battle strength: legionary 2, auxiliaries 1, a liburnian 4; one more trained (two for a ship)', () => {
  const s = (type, trained) => battleStrength({ type, trained });
  assert.deepEqual([s('legionary', false), s('archer', false), s('cavalry', false), s('liburnian', false)], [2, 1, 1, 4]);
  assert.deepEqual([s('legionary', true), s('archer', true), s('cavalry', true), s('liburnian', true)], [3, 2, 2, 6]);
  assert.equal(s('raider', false), 0);
  // A trained legion fort and an untrained archer fort: 8 x 3 + 8 x 1.
  const army = [...Array(8)].map(() => ({ type: 'legionary', trained: true })).concat([...Array(8)].map(() => ({ type: 'archer', trained: false })));
  assert.equal(army.reduce((n, u) => n + battleStrength(u), 0), 32);
});

// ---------------------------------------------------------------------------
// The Portus
// ---------------------------------------------------------------------------

/** A coastal demo city with a fleet and a Portus on its water, all staffed each day. */
function portusCity() {
  const game = newGame({ type: 'coast', size: 64, seed: 'demo' });
  const res = buildDemoCity(game, { level: 2 });
  assert.ok(res.ok, res.reason);
  game.runDays(16 * 3);
  const nv = buildDemoNavy(game, res.center, { stock: true, portus: true });
  assert.ok(nv.ok && nv.portus, 'fleet and Portus placed');
  return { game, ...nv };
}

function staffFleet(game) {
  for (const b of game.buildings.values()) if (['station', 'navalia', 'portus'].includes(b.def.kind)) b.efficiency = 1;
}

test('the Portus: its water rule, and only a fully staffed one on the station\'s water counts', () => {
  const { game, station, portus } = portusCity();
  staffFleet(game);
  // Placement: the same rule as the Navalia's (a shore of water ships can sail).
  const inland = findFree(game, 3, 3);
  const off = checkBuilding(game, 'portus', inland.x, inland.y);
  const nav = checkBuilding(game, 'navalia', inland.x, inland.y);
  assert.equal(off.ok, nav.ok);
  if (!off.ok) assert.equal(off.reason, nav.reason);
  assert.ok(waterOf(game, portus) > 0);
  assert.equal(portusFor(game, station), portus);
  portus.efficiency = 11 / 12;
  assert.equal(portusFor(game, station), null, 'not at full staff');
  assert.equal(schoolStatus(game, portus).text, `Trains nobody until fully staffed: ${portus.workers} of 12 workers.`);
  portus.efficiency = 1;
  // On other water than the station's: it does not count.
  const berth = shoreBerth(game, portus);
  const orig = game.map.navBody[berth];
  game.map.navBody[berth] = orig + 1000;
  try {
    assert.equal(portusFor(game, station), null, 'other water');
  } finally {
    game.map.navBody[berth] = orig;
  }
});

test('a new liburnian rows past the Portus first and reaches its berth trained; ships at rest stay at their berths', () => {
  const { game, station, portus } = portusCity();
  let firstState = null;
  for (let d = 0; d < 200 && !firstState; d++) {
    staffFleet(game);
    game.runDays(1);
    const ship = [...game.units.values()].find((u) => u.type === 'liburnian');
    if (ship) firstState = { drill: ship.drill, trained: ship.trained, id: ship.id };
  }
  assert.ok(firstState, 'a liburnian was launched');
  assert.equal(firstState.drill, portus.id, 'on its way to the Portus');
  assert.equal(firstState.trained, false, 'not trained as it sets out');
  const ship = game.units.get(firstState.id);
  for (let d = 0; d < 60 && !(ship.trained && ship.state === 'berthed'); d++) { staffFleet(game); game.runDays(1); }
  assert.equal(ship.trained, true, 'trained at the Portus');
  assert.equal(ship.state, 'berthed', 'then at its berth');
  assert.ok(portus.trainedHere >= 1);
  // An untrained ship at rest (from an older save, say) stays at its berth, as soldiers at rest do.
  for (const u of game.units.values()) if (u.station === station.id) { u.trained = false; u.drill = 0; }
  const berthed = [...game.units.values()].filter((u) => u.station === station.id && u.state === 'berthed');
  assert.ok(berthed.length > 0, 'a ship at its berth');
  for (let d = 0; d < 10; d++) { staffFleet(game); updateDrill(game); game.runDays(1); }
  assert.equal([...game.units.values()].filter((u) => u.station === station.id && u.drill).length, 0, 'no trips at rest');
  assert.ok(berthed.every((u) => u.state === 'berthed' && !u.trained), 'still berthed, untrained');
  // A new ship on its way there is called straight to its berth when the squadron is deployed.
  startDrill(game, berthed[0], portus);
  const berth = shoreBerth(game, station);
  assert.ok(deployStation(game, station.id, game.map.xOf(berth), game.map.yOf(berth)));
  assert.equal([...game.units.values()].filter((u) => u.drill).length, 0, 'deploying the squadron calls it back');
  staffFleet(game);
  assert.match(trainingNote(game, station), /Portus at .*ships at their berths stay there/);
});

test('a new liburnian moors at the Portus for its training, paused while it is short of staff, then rows on trained; a raid calls it home untrained', () => {
  const { game, station, portus } = portusCity();
  const TRAIN = CONFIG.PORTUS_TRAIN_DAYS * CONFIG.TICKS_PER_DAY;
  assert.equal(CONFIG.PORTUS_TRAIN_DAYS, 8);
  staffFleet(game);
  const berth = shoreBerth(game, portus);
  const ship = spawnUnit(game, 'liburnian', game.map.xOf(berth) + 0.5, game.map.yOf(berth) + 0.5, { station: station.id, slot: 0, state: 'sail', body: game.map.navBody[berth] });
  startDrill(game, ship, portus);
  assert.ok(fightUntil(game, () => ship.state === 'training', 200) >= 0, 'moored at the Portus');
  assert.equal(ship.trained, false, 'not trained on arrival');
  assert.equal(ship.trainLeft, TRAIN - 1, 'its first tick of training');
  assert.equal(inTrainingText(game, portus), `1 (${CONFIG.PORTUS_TRAIN_DAYS} days left)`, 'the Portus panel');
  assert.equal(inTrainingText(game, station), `1 (${CONFIG.PORTUS_TRAIN_DAYS} days left)`, 'the station panel');
  // A trip's time limit does not cut short a ship already there.
  ship.drillDay = game.time.totalDays - CONFIG.DRILL_MAX_DAYS - 5;
  updateDrill(game);
  assert.equal(ship.drill, portus.id, 'still training');
  fightUntil(game, () => false, 50);
  const left = ship.trainLeft;
  portus.efficiency = 11 / 12;
  fightUntil(game, () => false, 300);
  assert.equal(ship.trainLeft, left, 'paused while short of staff');
  assert.equal(ship.state, 'training', 'still moored');
  assert.match(inTrainingText(game, portus), /paused/);
  portus.efficiency = 1;
  assert.equal(fightUntil(game, () => ship.trained), left, 'resumed where it stopped');
  assert.equal(ship.drill, 0);
  assert.equal(portus.trainedHere, 1);
  // A ship kept waiting more than TRAIN_WAIT_MAX_DAYS by a Portus short of staff rows on untrained.
  const three = spawnUnit(game, 'liburnian', game.map.xOf(berth) + 0.5, game.map.yOf(berth) + 0.5, { station: station.id, slot: 2, state: 'sail', body: game.map.navBody[berth] });
  startDrill(game, three, portus);
  fightUntil(game, () => three.state === 'training', 200);
  portus.efficiency = 0.5;
  fightUntil(game, () => !three.drill, CONFIG.TRAIN_WAIT_MAX_DAYS * CONFIG.TICKS_PER_DAY + 5);
  portus.efficiency = 1;
  assert.equal(three.drill, 0, 'given up');
  assert.equal(three.trained, false);
  assert.ok(three.trainWait === 0 && three.trainLeft === 0);
  // A second one is called home by a raid while it trains, untrained.
  const two = spawnUnit(game, 'liburnian', game.map.xOf(berth) + 0.5, game.map.yOf(berth) + 0.5, { station: station.id, slot: 1, state: 'sail', body: game.map.navBody[berth] });
  startDrill(game, two, portus);
  fightUntil(game, () => two.state === 'training', 200);
  game.military.active = { id: 9, origin: { x: 0, y: 0 }, size: 1, killed: 0, buildingsLost: 0, startDay: 0, fleeing: false };
  updateDrill(game);
  game.military.active = null;
  assert.equal(two.drill, 0, 'called home');
  assert.equal(two.trainLeft, 0);
  assert.equal(two.trained, false);
  fightUntil(game, () => false, 5);
  assert.notEqual(two.state, 'training', 'rowing to its berth');
});

// ---------------------------------------------------------------------------
// Large temples
// ---------------------------------------------------------------------------

test('a large temple counts as two temples toward its god; homes still count distinct gods', () => {
  const game = newGame();
  game.city.population = 5000; // a god's share: 1,000 people, two temples' worth
  const s = findFree(game, 12, 6);
  build(game, 'road', s.x, s.y + 3, s.x + 11, s.y + 3);
  const large = addBuilding(game, 'temple_large_ceres', s.x, s.y);
  const small1 = addBuilding(game, 'temple_mars', s.x + 4, s.y + 1);
  const small2 = addBuilding(game, 'temple_mars', s.x + 6, s.y + 1);
  game.processRoadChanges();
  for (const b of [large, small1, small2]) b.efficiency = 1;
  const before = { ceres: game.city.gods.ceres.mood, mars: game.city.gods.mars.mood };
  updateReligion(game);
  assert.equal(game.city.gods.ceres.temples, 2, 'one large temple = two');
  assert.equal(game.city.gods.mars.temples, 2, 'two small temples');
  assert.equal(game.city.gods.ceres.mood - before.ceres, game.city.gods.mars.mood - before.mars, 'the same pull on the god\'s mood');
  assert.equal(templeCount(game, 'ceres').text, '2 (0 small, 1 large: a large temple counts as two)');
  assert.equal(templeCount(game, 'mars').text, '2');
  // Unstaffed, it counts for nothing.
  large.efficiency = 0;
  updateReligion(game);
  assert.equal(game.city.gods.ceres.temples, 0);
  // Its priest is an ordinary priest of its god.
  large.efficiency = 1;
  large.spawnTimer = 0;
  updateServiceSpawns(game, large);
  const priest = [...game.walkers.values()].find((w) => w.origin === large.id);
  assert.ok(priest, 'a priest set out');
  assert.equal(priest.type, 'priest');
  assert.equal(priest.god, 'ceres');
});

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

test('panel words: the fort\'s training line and the academy\'s status', () => {
  const { game, academy, fort } = lineCity();
  garrison(game, fort, 3);
  assert.equal(trainedText(game, fort), '0 of 3 trained');
  assert.match(trainingNote(game, fort), new RegExp(`^Recruits train at the Campus at ${academy.x}, ${academy.y} on their way here; men already in the fort stay at their posts`));
  assert.deepEqual(schoolStatus(game, academy), { level: 'good', text: 'Fully staffed: soldiers of the forts nearest it train here.' });
  academy.efficiency = 0.5;
  academy.workers = 10;
  assert.deepEqual(schoolStatus(game, academy), { level: 'warn', text: 'Trains nobody until fully staffed: 10 of 20 workers.' });
  assert.equal(trainingNote(game, fort), 'No Campus is fully staffed: only one with every worker trains anyone.');
  removeBuilding(game, academy);
  assert.match(trainingNote(game, fort), /^Build a Campus \(Military Academy\)/);
});

// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

test('saves: training, trips and a recruit mid-training survive a save; version 14 and 11 saves load', () => {
  const { game, barracks, academy, fort } = lineCity();
  const men = garrison(game, fort, 2);
  men[0].trained = true;
  startDrill(game, men[1], academy); // (a trip: a new ship's, or a soldier's in an older save)
  assert.equal(men[1].drill, academy.id);
  const w = sendRecruit(game, barracks);
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  assert.equal(data.version, CONFIG.SAVE_VERSION);
  assert.ok(CONFIG.SAVE_VERSION >= 12, 'training came with version 12');
  const again = deserializeGame(JSON.parse(JSON.stringify(data)));
  assert.equal(again.units.get(men[0].id).trained, true);
  assert.equal(again.units.get(men[1].id).drill, men[1].drill);
  assert.equal(again.walkers.get(w.id).state, 'toAcademy');
  // A recruit in training: where he stands, and the days he has left.
  walkUntil(game, () => w.state === 'training');
  walkUntil(game, () => false, 30);
  const mid = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  const mw = mid.walkers.get(w.id);
  assert.equal(mw.state, 'training');
  assert.equal(mw.trainLeft, w.trainLeft);
  assert.equal(mid.buildings.get(fort.id).recruiting, 1, 'his place still held');
  // A version 14 save (before training took time): nobody was mid-training,
  // and a recruit on his way trains when he gets there.
  const v14 = JSON.parse(JSON.stringify(data));
  v14.version = 14;
  const old14 = deserializeGame(v14);
  const ow = old14.walkers.get(w.id);
  assert.equal(ow.state, 'toAcademy');
  assert.equal(ow.trainLeft || 0, 0);
  for (let t = 0; t < 4000 && ow.state === 'toAcademy'; t++) updateWalkers(old14);
  assert.equal(ow.state, 'training', 'he trains on arrival');
  // A version 11 save: nobody trained, nobody on a trip, the recruit untrained.
  data.version = 11;
  for (const u of data.units) { delete u.trained; delete u.drill; delete u.drillDay; }
  for (const x of data.walkers) { delete x.trained; delete x.academy; }
  data.units[0].trained = true; // (whatever an old file held)
  const old = deserializeGame(data);
  for (const u of old.units.values()) {
    assert.equal(u.trained, false);
    assert.equal(u.drill, 0);
  }
  const rw = [...old.walkers.values()].find((x) => x.type === 'recruit');
  assert.equal(rw.trained, false);
  old.runDays(5);
  assert.ok(Number.isFinite(old.city.treasury), 'it plays on');
  // The upgrade is safe to run on a current game too.
  upgradeTrainingV11(game);
  assert.equal(men[0].trained, false);
});

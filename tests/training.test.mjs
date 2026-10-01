/**
 * training.test.mjs - the Military Academy, the Portus and large temples
 * (sim/training.js, sim/religion.js): their data and unlocks; a recruit
 * trained when he reaches the academy, never when he sets out, and the
 * academy nearest his fort (only one at full staff); soldiers and ships at
 * rest taking turns, one at a time, never while deployed or raided; damage
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
import { trainedText, trainingNote, schoolStatus, templeCount } from '../src/ui/trainingInfo.js';
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
  for (const g of GOD_KEYS) assert.equal(BUILDINGS[`temple_large_${g}`].name.startsWith('Large Temple of '), true);
});

test('unlocks: the academy with the first forts, the Portus with the fleet, large temples from mission 3', () => {
  const has = (s, k) => s.unlocks === 'all' || s.unlocks.includes(k);
  const firstFort = SCENARIOS.findIndex((s) => ['fort_legion', 'fort_archer', 'fort_cavalry'].some((k) => has(s, k)));
  const firstAcademy = SCENARIOS.findIndex((s) => has(s, 'military_academy'));
  assert.equal(firstAcademy, firstFort, 'from the first mission that has forts');
  assert.equal(SCENARIOS[firstAcademy].id, 'c4');
  for (const s of SCENARIOS) {
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

test('a recruit is trained when he reaches the academy, not when he sets out, and arrives a trained soldier', () => {
  const { game, barracks, academy, fort } = lineCity();
  const w = sendRecruit(game, barracks);
  assert.equal(w.state, 'toAcademy', 'the academy first');
  assert.equal(w.academy, academy.id);
  assert.equal(w.trained, false, 'not trained as he sets out');
  assert.ok(walkUntil(game, () => w.state === 'toFort') > 0, 'he reaches the academy');
  assert.equal(w.trained, true, 'trained on arrival');
  assert.equal(game.map.idx(w.x, w.y), academy.accessRoad, 'at the academy\'s road');
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

test('a recruit whose academy is demolished on the way walks on to his fort untrained; staff lost on the way changes nothing', () => {
  const { game, barracks, academy } = lineCity();
  const w = sendRecruit(game, barracks);
  academy.efficiency = 0.5; // (staff lost after he set out)
  walkUntil(game, () => w.state === 'toFort');
  assert.equal(w.trained, true, 'trained all the same: the academy was fully staffed when he set out');
  walkUntil(game, () => w.dead);
  const w2 = sendRecruit(game, barracks);
  assert.equal(w2.state, 'toFort', 'a half-staffed academy sends nobody a detour');
  walkUntil(game, () => w2.dead);
  academy.efficiency = 1;
  const w3 = sendRecruit(game, barracks);
  assert.equal(w3.state, 'toAcademy');
  removeBuilding(game, academy);
  game.processRoadChanges();
  walkUntil(game, () => w3.state === 'toFort' || w3.dead);
  assert.equal(w3.trained, false, 'no academy, no training');
  walkUntil(game, () => w3.dead);
  const trained = [...game.units.values()].map((u) => u.trained);
  assert.deepEqual(trained, [true, false, false]);
});

// ---------------------------------------------------------------------------
// Soldiers at rest
// ---------------------------------------------------------------------------

test('soldiers at rest take turns at the academy, one at a time, and come back trained', () => {
  const { game, academy, fort } = lineCity();
  const men = garrison(game, fort);
  updateDrill(game);
  const away = () => men.filter((u) => u.drill);
  assert.deepEqual(away().map((u) => u.slot), [0], 'the first untrained man, one at a time');
  updateDrill(game);
  assert.equal(away().length, 1, 'never two');
  const first = men[0];
  assert.ok(fightUntil(game, () => first.trained) > 0, 'he reaches the academy');
  assert.equal(first.drill, 0);
  assert.equal(academy.trainedHere, 1);
  assert.ok(fightUntil(game, () => first.state === 'idle') > 0, 'and marches back to his post');
  assert.ok(holdingPosition(game, first), 'back in his place');
  updateDrill(game);
  assert.deepEqual(away().map((u) => u.slot), [1], 'then the next');
  // Everyone in turn.
  for (let k = 0; k < 400 && men.some((u) => !u.trained); k++) {
    updateDrill(game);
    fightUntil(game, () => !men.some((u) => u.drill), 600);
  }
  assert.equal(trainedOf(game, fort.id).trained, FORT_CAPACITY, 'the whole fort, in time');
  assert.equal(trainedText(game, fort), `${FORT_CAPACITY} of ${FORT_CAPACITY} trained`);
  updateDrill(game);
  assert.equal(away().length, 0, 'nobody left to train');
});

test('soldiers at rest: never while deployed or raided, never to an academy short of staff', () => {
  const { game, academy, fort } = lineCity();
  const men = garrison(game, fort, 3);
  academy.efficiency = 19 / 20;
  updateDrill(game);
  assert.equal(men.filter((u) => u.drill).length, 0, 'short of staff: nobody goes');
  academy.efficiency = 1;
  updateDrill(game);
  assert.equal(men.filter((u) => u.drill).length, 1);
  // Deployed: the man on his way comes back, and nobody else goes.
  deployFort(game, fort.id, fort.x, fort.y + 8);
  assert.equal(men.filter((u) => u.drill).length, 0, 'deploying calls him back');
  updateDrill(game);
  assert.equal(men.filter((u) => u.drill).length, 0);
  recallFort(game, fort.id);
  fightUntil(game, () => men.every((u) => u.state === 'idle'));
  updateDrill(game);
  assert.equal(men.filter((u) => u.drill).length, 1);
  // A raid: home at once.
  game.military.active = { id: 99, origin: { x: 0, y: 0 }, size: 1, killed: 0, buildingsLost: 0, startDay: 0, fleeing: false };
  updateDrill(game);
  assert.equal(men.filter((u) => u.drill).length, 0, 'a raid calls him home');
  game.military.active = null;
  // No academy at all: nothing happens, nothing changes.
  removeBuilding(game, academy);
  const before = JSON.stringify([...game.units.values()]);
  updateDrill(game);
  assert.equal(JSON.stringify([...game.units.values()]), before);
});

test('a trip with no way there is given up, and the fort waits before sending another', () => {
  const { game, academy, fort } = lineCity();
  const men = garrison(game, fort, 2);
  updateDrill(game);
  const u = men.find((x) => x.drill);
  u.drillDay = game.time.totalDays - CONFIG.DRILL_MAX_DAYS - 1;
  updateDrill(game);
  assert.equal(u.drill, 0, 'given up');
  assert.equal(fort.drillWait, game.time.totalDays + CONFIG.DRILL_RETRY_DAYS);
  assert.equal(men.filter((x) => x.drill).length, 0, 'nobody else for now');
  fort.drillWait = 0;
  updateDrill(game);
  assert.equal(men.filter((x) => x.drill).length, 1);
  assert.ok(academy);
});

test('review: a far academy gets time for the walk there and back; a short trip gets DRILL_MAX_DAYS', () => {
  const { game, academy, fort } = lineCity();
  const [u] = garrison(game, fort, 1);
  startDrill(game, u, academy);
  assert.equal(u.drillDays, CONFIG.DRILL_MAX_DAYS, 'a near academy: the floor');
  // 80 tiles away a legionary (1.5 tiles a day) needs about 53 days each way: never given up on day 41.
  const far = { id: 999, x: u.x + 80, y: u.y, size: 3 };
  startDrill(game, u, far);
  const oneWay = 81.5 / (UNIT_TYPES.legionary.speed * CONFIG.TICKS_PER_DAY);
  assert.ok(u.drillDays > 2 * oneWay, `${u.drillDays} days for a ${Math.round(oneWay)}-day walk`);
  u.drill = academy.id; // (the time limit is what is tested: the trip itself goes to the real academy)
  u.drillDay = game.time.totalDays - 60;
  updateDrill(game);
  assert.equal(u.drill, academy.id, 'still on his way on day 60');
});

test('review: an academy that loses its road ends the trips to it at once', () => {
  const { game, academy, fort } = lineCity();
  const men = garrison(game, fort, 1);
  updateDrill(game);
  assert.equal(men[0].drill, academy.id);
  academy.accessRoad = -1; // (its road was torn up)
  updateMilitary(game);
  assert.equal(men[0].drill, 0, 'called off, not marched into the wall for 40 days');
  assert.equal(fort.drillWait || 0, 0, 'and the fort is not made to wait');
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
  // Standing to fight a raider in reach is holding too; running after one, marching or off to the drill yard is not.
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
  leg.drill = 1;
  assert.equal(holdingPosition(game, leg), false, 'on his way to the drill yard');
  leg.drill = 0;
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

test('a new liburnian rows past the Portus first and reaches its berth trained; ships at rest take turns', () => {
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
  // An untrained ship at rest (from an older save, say) goes over, one at a time.
  for (const u of game.units.values()) if (u.station === station.id) { u.trained = false; u.drill = 0; }
  const berthed = [...game.units.values()].filter((u) => u.station === station.id && u.state === 'berthed');
  assert.ok(berthed.length > 0, 'a ship at its berth');
  staffFleet(game);
  updateDrill(game);
  assert.equal([...game.units.values()].filter((u) => u.station === station.id && u.drill).length, 1, 'one at a time');
  const berth = shoreBerth(game, station);
  assert.ok(deployStation(game, station.id, game.map.xOf(berth), game.map.yOf(berth)));
  assert.equal([...game.units.values()].filter((u) => u.drill).length, 0, 'deploying the squadron calls it back');
  assert.match(trainingNote(game, station), /Portus at/);
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
  assert.match(trainingNote(game, fort), new RegExp(`^Recruits train at the Military Academy at ${academy.x}, ${academy.y}`));
  assert.deepEqual(schoolStatus(game, academy), { level: 'good', text: 'Fully staffed: soldiers of the forts nearest it train here.' });
  academy.efficiency = 0.5;
  academy.workers = 10;
  assert.deepEqual(schoolStatus(game, academy), { level: 'warn', text: 'Trains nobody until fully staffed: 10 of 20 workers.' });
  assert.equal(trainingNote(game, fort), 'No Military Academy is fully staffed: only one with every worker trains anyone.');
  removeBuilding(game, academy);
  assert.match(trainingNote(game, fort), /^Build a Military Academy/);
});

// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

test('saves: training and trips survive a save; a version 11 save loads with everyone untrained', () => {
  const { game, barracks, fort } = lineCity();
  const men = garrison(game, fort, 2);
  men[0].trained = true;
  updateDrill(game);
  assert.equal(men[1].drill > 0, true, 'the untrained one is on his way');
  const w = sendRecruit(game, barracks);
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  assert.equal(data.version, CONFIG.SAVE_VERSION);
  assert.ok(CONFIG.SAVE_VERSION >= 12, 'training came with version 12');
  const again = deserializeGame(JSON.parse(JSON.stringify(data)));
  assert.equal(again.units.get(men[0].id).trained, true);
  assert.equal(again.units.get(men[1].id).drill, men[1].drill);
  assert.equal(again.walkers.get(w.id).state, 'toAcademy');
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

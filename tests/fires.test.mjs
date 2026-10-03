/**
 * fires.test.mjs - prefects put fires out one building at a time (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Covers sim/risk.js: a prefect at a fire fights one burning building (all of
 * its tiles together) for PREFECT_DOUSE_TICKS, then the next one in reach,
 * then goes home; the flames keep heating and spreading from every building
 * still burning, the one he fights included; a building that burns out by
 * itself sends him on at once; two prefects take two buildings, never one;
 * a block alight calls a prefect for each building; and saves keep the
 * fight and which tiles burn together (an older save ties them by ruin).
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { serializeGame, deserializeGame, upgradeFireGroupsV27 } from '../src/core/save.js';
import { addBuilding, spawnWalker } from '../src/sim/entities.js';
import { updateWalkers } from '../src/sim/walkers.js';
import { startRoaming } from '../src/sim/movement.js';
import { igniteBuilding, updateFires, prefectArriveAtFire, dispatchPrefect, beingPutOut, fireOf } from '../src/sim/risk.js';
import { newGame, build, findFree } from './helpers.mjs';

log.setLevel('error');

/** A long east-west road on open land, nobody on it. */
function street() {
  const game = newGame({ size: 96, type: 'plains', seed: 'fires-one-at-a-time' });
  const spot = findFree(game, 28, 9);
  assert.ok(spot, 'room for a street');
  const y = spot.y + 4;
  const x0 = spot.x + 1;
  assert.ok(build(game, 'road', x0, y, x0 + 25, y).ok, 'road built');
  return { game, x0, y };
}

/** An occupied home beside the street. */
function home(game, x, y, size = 1) {
  const b = addBuilding(game, 'house', x, y, size);
  Object.assign(b.house, { tier: 3, pop: 9 });
  return b;
}

/** A prefect who has just run to the fire on tile `fireTile` and stands at road tile (x, y). */
function arrive(game, x, y, fireTile) {
  const p = spawnWalker(game, 'prefect', game.map.idx(x, y), null, { state: 'toFire', fireTile, speed: CONFIG.WALKER_SPEED * CONFIG.PREFECT_RUN_SPEED });
  prefectArriveAtFire(game, p);
  return p;
}

const steps = (game, n) => { for (let t = 0; t < n; t++) updateWalkers(game); };
const burning = (game, b) => game.fires.has(game.map.idx(b.x, b.y));
const offDuty = (game, p) => !game.walkers.has(p.id) || (p.state !== 'extinguish' && p.state !== 'toFire');

test('a prefect puts out one burning building at a time, then the next beside it, then leaves', () => {
  const { game, x0, y } = street();
  const a = home(game, x0 + 5, y + 1);
  const b = home(game, x0 + 6, y + 1);
  igniteBuilding(game, a, 'fire');
  igniteBuilding(game, b, 'spread');
  const p = arrive(game, x0 + 5, y, game.map.idx(a.x, a.y));
  // Before: he doused everything within 4 tiles the moment he arrived.
  assert.equal(p.state, 'extinguish');
  assert.ok(burning(game, a) && burning(game, b), 'both still burn as he starts');
  assert.equal(p.fireTile, game.map.idx(a.x, a.y), 'he fights the one he was called to');
  assert.ok(beingPutOut(game, game.map.idx(a.x, a.y)) && !beingPutOut(game, game.map.idx(b.x, b.y)));

  steps(game, CONFIG.PREFECT_DOUSE_TICKS - 1);
  assert.ok(burning(game, a), 'not out before his time is up');
  steps(game, 1);
  assert.ok(!burning(game, a) && burning(game, b), 'the first is out, the second burns on');
  assert.equal(p.state, 'extinguish');
  assert.equal(p.fireTile, game.map.idx(b.x, b.y), 'he turns to the next one in reach without moving');
  assert.deepEqual([p.x, p.y], [x0 + 5, y]);

  steps(game, CONFIG.PREFECT_DOUSE_TICKS);
  assert.equal(game.fires.size, 0, 'both out');
  assert.ok(offDuty(game, p), 'and he is done with fires');
});

test('a big building\'s tiles burn and go out together', () => {
  const { game, x0, y } = street();
  const big = home(game, x0 + 5, y + 1, 2);
  igniteBuilding(game, big, 'fire');
  assert.equal(game.fires.size, 4);
  const keys = new Set([...game.fires.keys()].map((i) => fireOf(game, i)));
  assert.deepEqual([...keys], [big.id], 'one fire, named after the building');
  arrive(game, x0 + 5, y, game.map.idx(big.x, big.y));
  steps(game, CONFIG.PREFECT_DOUSE_TICKS - 1);
  assert.equal(game.fires.size, 4);
  steps(game, 1);
  assert.equal(game.fires.size, 0, 'all four tiles at once');
});

test('the fire keeps spreading from a building while a prefect fights it', () => {
  const { game, x0, y } = street();
  const a = home(game, x0 + 5, y + 1);
  const next = home(game, x0 + 5, y + 2); // behind it, away from the street
  igniteBuilding(game, a, 'fire');
  const p = arrive(game, x0 + 5, y, game.map.idx(a.x, a.y));
  assert.equal(p.state, 'extinguish');
  const was = CONFIG.FIRE_SPREAD_CHANCE;
  try {
    CONFIG.FIRE_SPREAD_CHANCE = 1;
    next.fireRisk = 0;
    const fires = game.city.stats.fires;
    updateFires(game);
    assert.ok(!game.buildings.has(next.id), 'the home behind it caught');
    assert.equal(game.city.stats.fires, fires + 1);
    assert.ok(burning(game, next) && burning(game, a));
  } finally {
    CONFIG.FIRE_SPREAD_CHANCE = was;
  }
  // He finishes his building, then takes the one that caught from it.
  steps(game, CONFIG.PREFECT_DOUSE_TICKS);
  assert.ok(!burning(game, a));
  assert.equal(p.fireTile, game.map.idx(next.x, next.y));
});

test('a building being fought still heats its neighbours', () => {
  const { game, x0, y } = street();
  const a = home(game, x0 + 5, y + 1);
  const next = home(game, x0 + 6, y + 1);
  igniteBuilding(game, a, 'fire');
  arrive(game, x0 + 5, y, game.map.idx(a.x, a.y));
  const was = CONFIG.FIRE_SPREAD_CHANCE;
  try {
    CONFIG.FIRE_SPREAD_CHANCE = 0;
    next.fireRisk = 0;
    updateFires(game);
    assert.equal(next.fireRisk, CONFIG.FIRE_HEAT_PER_DAY);
  } finally {
    CONFIG.FIRE_SPREAD_CHANCE = was;
  }
});

test('a building that burns out while fought sends the prefect on at once', () => {
  const { game, x0, y } = street();
  const a = home(game, x0 + 5, y + 1);
  const b = home(game, x0 + 7, y + 1);
  igniteBuilding(game, a, 'fire');
  igniteBuilding(game, b, 'fire');
  const p = arrive(game, x0 + 5, y, game.map.idx(a.x, a.y));
  game.fires.set(game.map.idx(a.x, a.y), 1); // its last day
  game.fires.set(game.map.idx(b.x, b.y), 4);
  updateFires(game);
  assert.ok(!burning(game, a), 'burned out');
  steps(game, 1);
  assert.equal(p.state, 'extinguish');
  assert.equal(p.fireTile, game.map.idx(b.x, b.y), 'on to the next one the next tick');
  assert.equal(p.waitTicks, CONFIG.PREFECT_DOUSE_TICKS);
});

test('two prefects at one fire take two buildings, never the same one', () => {
  const { game, x0, y } = street();
  const a = home(game, x0 + 5, y + 1);
  const b = home(game, x0 + 6, y + 1);
  igniteBuilding(game, a, 'fire');
  igniteBuilding(game, b, 'spread');
  const p1 = arrive(game, x0 + 5, y, game.map.idx(a.x, a.y));
  const p2 = arrive(game, x0 + 5, y, game.map.idx(a.x, a.y)); // called to the same one
  assert.equal(p1.fireTile, game.map.idx(a.x, a.y));
  assert.equal(p2.state, 'extinguish');
  assert.equal(p2.fireTile, game.map.idx(b.x, b.y), 'the second takes the other building');
  steps(game, CONFIG.PREFECT_DOUSE_TICKS);
  assert.equal(game.fires.size, 0, 'both out in the time of one');
});

test('a prefect with every building in reach taken runs to the next fire', () => {
  const { game, x0, y } = street();
  const a = home(game, x0 + 5, y + 1);
  const far = home(game, x0 + 18, y + 1);
  igniteBuilding(game, a, 'fire');
  igniteBuilding(game, far, 'fire');
  arrive(game, x0 + 5, y, game.map.idx(a.x, a.y));
  const p2 = arrive(game, x0 + 5, y, game.map.idx(a.x, a.y));
  assert.equal(p2.state, 'toFire');
  assert.equal(p2.fireTile, game.map.idx(far.x, far.y));
  assert.ok(p2.path.length > 1, 'on his way');
});

test('a block alight calls a prefect for each burning building', () => {
  const { game, x0, y } = street();
  const ps = [x0 + 2, x0 + 22].map((x) => {
    const p = spawnWalker(game, 'prefect', game.map.idx(x, y), null, {});
    startRoaming(game, p, 0);
    p.roamLeft = 400;
    return p;
  });
  const a = home(game, x0 + 11, y + 1);
  const b = home(game, x0 + 12, y + 1);
  igniteBuilding(game, a, 'fire');
  igniteBuilding(game, b, 'spread');
  // Before: the second fire saw the first prefect on his way within 3 tiles and called nobody.
  assert.deepEqual(ps.map((p) => p.state), ['toFire', 'toFire']);
  assert.notEqual(fireOf(game, ps[0].fireTile), fireOf(game, ps[1].fireTile));
  // A reminder for a building someone is on the way to calls nobody more.
  const p3 = spawnWalker(game, 'prefect', game.map.idx(x0 + 14, y), null, {});
  startRoaming(game, p3, 0);
  p3.roamLeft = 400;
  assert.ok(dispatchPrefect(game, game.map.idx(a.x, a.y)));
  assert.equal(p3.state, 'roam', 'nobody more for the first');
  igniteBuilding(game, home(game, x0 + 25, y - 1), 'fire'); // a third, farther along
  assert.equal(p3.state, 'toFire', 'the third building calls the third prefect');
});

test('a save made mid-fight loads and the fight goes on; burning tiles stay tied to their building', () => {
  const { game, x0, y } = street();
  const big = home(game, x0 + 5, y + 1, 2);
  const b = home(game, x0 + 7, y + 1);
  igniteBuilding(game, big, 'fire');
  igniteBuilding(game, b, 'spread');
  const p = arrive(game, x0 + 6, y, game.map.idx(big.x, big.y));
  steps(game, 3);
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  assert.equal(data.version, CONFIG.SAVE_VERSION);
  const g2 = deserializeGame(JSON.parse(JSON.stringify(data)));
  const q = g2.walkers.get(p.id);
  assert.deepEqual([q.state, q.fireTile, q.waitTicks, q.afterWait], ['extinguish', p.fireTile, p.waitTicks, 'douse']);
  assert.deepEqual([...g2.fires.keys()].map((i) => fireOf(g2, i)), [...game.fires.keys()].map((i) => fireOf(game, i)));
  steps(g2, CONFIG.PREFECT_DOUSE_TICKS - 3);
  assert.equal(g2.fires.size, 1, 'the big home is out, all four tiles');
  assert.equal(q.fireTile, g2.map.idx(b.x, b.y));

  // Version 27: fires were [tile, days]; tiles of one ruin become one fire.
  const old = JSON.parse(JSON.stringify(data));
  old.version = 27;
  old.fires = old.fires.map(([i, d]) => [i, d]);
  const up = deserializeGame(old);
  const bigTiles = [0, 1].flatMap((dy) => [0, 1].map((dx) => up.map.idx(big.x + dx, big.y + dy)));
  const keys = new Set(bigTiles.map((i) => fireOf(up, i)));
  assert.equal(keys.size, 1, 'the big home is one fire');
  assert.notEqual(fireOf(up, up.map.idx(b.x, b.y)), [...keys][0], 'the small one another');
  steps(up, CONFIG.PREFECT_DOUSE_TICKS - 3);
  assert.equal(up.fires.size, 1);

  // The step on its own: a tile with no ruin is a fire of its own.
  const g3 = newGame({ seed: 'fires-save-3' });
  g3.fires.set(5, 3);
  g3.fires.set(6, 3);
  upgradeFireGroupsV27(g3);
  assert.notEqual(fireOf(g3, 5), fireOf(g3, 6));
});

test('a prefect from an older save, resting after a fire, goes on to the next one', () => {
  const { game, x0, y } = street();
  const a = home(game, x0 + 5, y + 1);
  igniteBuilding(game, a, 'fire');
  // As a version 27 save left him: resting where he had put a fire out, no fire of his own.
  const p = spawnWalker(game, 'prefect', game.map.idx(x0 + 5, y), null, { state: 'extinguish', waitTicks: 5, afterWait: 'nextFire' });
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  data.version = 27;
  data.fires = data.fires.map(([i, d]) => [i, d]);
  const up = deserializeGame(data);
  const q = up.walkers.get(p.id);
  steps(up, 5 + 2); // his rest, then the step to the fire beside him
  assert.equal(q.state, 'extinguish');
  assert.equal(q.afterWait, 'douse');
  assert.equal(q.fireTile, up.map.idx(a.x, a.y));
  steps(up, CONFIG.PREFECT_DOUSE_TICKS);
  assert.equal(up.fires.size, 0);
});

test('a prefecture sends at most PREFECT_FIRE_CREW fresh prefects to fires at a time', () => {
  const { game, x0, y } = street();
  const pre = addBuilding(game, 'prefecture', x0 + 1, y - 1, 1);
  pre.efficiency = 1;
  assert.ok(pre.accessRoad >= 0, 'the prefecture is on the street');
  // Six homes alight along the street, each its own fire (none touches another).
  for (let k = 0; k < 6; k++) igniteBuilding(game, home(game, x0 + 6 + k * 3, y + 1), 'fire');
  const crew = [...game.walkers.values()].filter((w) => w.type === 'prefect' && w.state === 'toFire');
  // Before: one for each 3-tile cluster; uncapped, one for every building.
  assert.equal(crew.length, CONFIG.PREFECT_FIRE_CREW, 'a crew, not one prefect for every building');
  assert.equal(new Set(crew.map((w) => fireOf(game, w.fireTile))).size, crew.length, 'each to a different building');
  // The fires left waiting are not forgotten: the crew takes them as theirs go out.
  steps(game, 20 * CONFIG.TICKS_PER_DAY);
  assert.equal(game.fires.size, 0, 'all six put out');
});

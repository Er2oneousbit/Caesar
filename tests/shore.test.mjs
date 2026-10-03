/**
 * shore.test.mjs - waterside buildings face their water: the Emporium, the
 * Navalia, a Naval Station, the Portus, a shipyard and a wharf are turned to
 * the water they touch as they are placed, in the placement preview, and as
 * an older save loads (playtest: a Portus and a Naval Station could stand
 * turned the wrong way until a ship first used them). Each must stand right
 * at the water's edge: the whole side it faces on the water, no strip of
 * land between (playtest: docks stood back from the water, touching it at
 * one tile); one that stood back in an older save keeps standing as it was.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { Terrain } from '../src/world/map.js';
import { checkBuilding, planAction, applyPlan, WATER_EDGE_REASON } from '../src/sim/construction.js';
import { addBuilding, shoreWaterAt, waterEdge } from '../src/sim/entities.js';
import { dockBerth } from '../src/sim/trade.js';
import { waterBeside } from '../src/sim/fishing.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { artState } from '../src/render/buildingArt.js';
import { newGame } from './helpers.mjs';

log.setLevel('error');

const SHORE = ['dock', 'naval_station', 'navalia', 'portus', 'shipyard', 'wharf'];
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // side 0 = -y, 1 = +x, 2 = +y, 3 = -x

/** How many tiles just past the footprint's `side` edge are water. */
function waterPastCount(map, x, y, S, side) {
  const [dx, dy] = DIRS[side];
  let n = 0;
  for (let k = 0; k < S; k++) {
    const tx = dx === 0 ? x + k : dx > 0 ? x + S : x - 1;
    const ty = dy === 0 ? y + k : dy > 0 ? y + S : y - 1;
    if (map.inBounds(tx, ty) && map.terrain[map.idx(tx, ty)] === Terrain.WATER) n++;
  }
  return n;
}

/** Is every tile just past the footprint's `side` edge water? */
const waterPast = (map, x, y, S, side) => waterPastCount(map, x, y, S, side) === S;

/** Placeable spots for `type` on the map, one per side the water lies on, as found. */
function spotsBySide(game, type) {
  const def = BUILDINGS[type];
  const S = def.size;
  const found = new Map();
  for (let y = 1; y < game.map.h - S - 1 && found.size < 4; y++) {
    for (let x = 1; x < game.map.w - S - 1 && found.size < 4; x++) {
      if (!checkBuilding(game, type, x, y).ok) continue;
      const i = shoreWaterAt(game.map, def, x, y);
      if (i < 0) continue;
      const plan = planAction(game, type, x, y, x + ((S - 1) >> 1), y + ((S - 1) >> 1));
      assert.deepEqual([plan.items[0].x, plan.items[0].y], [x, y], `${type}: the cursor anchors the preview at ${x},${y}`);
      const side = plan.items[0].state;
      if (!found.has(side)) found.set(side, { x, y });
    }
  }
  return found;
}

test('every waterside building faces its water in the preview, once placed, and after a load', () => {
  // (Lakes: their shores run every way, so every building finds straight
  // banks on two sides or more.)
  const game = newGame({ type: 'lakes', size: 96, seed: 'shore-face', money: 1e6 });
  for (const type of SHORE) {
    const def = BUILDINGS[type];
    const spots = spotsBySide(game, type);
    assert.ok(spots.size >= 2, `${type}: shores on at least two sides of a building (${[...spots.keys()]})`);
    for (const [side, { x, y }] of spots) {
      assert.ok(waterPast(game.map, x, y, def.size, side), `${type} at ${x},${y}: the preview turns it to side ${side}, where the water is`);
      const b = addBuilding(game, type, x, y, def.size);
      assert.equal(b.waterSide, side, `${type}: placed facing the same water`);
      assert.equal(artState(b) % 4, side, `${type}: drawn facing it`);
    }
  }
  // An older save whose waterside buildings never had a ship or boat: no side
  // saved; the load turns them to their water.
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  for (const b of data.buildings) delete b.waterSide;
  const loaded = deserializeGame(data);
  for (const b of loaded.buildings.values()) {
    if (!SHORE.includes(b.type)) continue;
    assert.ok(b.waterSide >= 0 && waterPast(loaded.map, b.x, b.y, b.size, b.waterSide), `${b.type} at ${b.x},${b.y} faces its water after the load`);
  }
});

// ---------------------------------------------------------------------------
// Right at the water's edge
// ---------------------------------------------------------------------------

/**
 * Open grass with one straight river, 8 tiles wide (rows 28 to 35), across
 * the whole 64-tile map, and a spit of land three tiles long in the water's
 * edge at x 20 to 22 (row 28): beside it the bank is straight, at it the
 * bank steps out one tile. `water`: more tiles made water first.
 */
function spitGame(water = []) {
  const game = newGame({ seed: 'water-edge', money: 1e6 });
  const { map } = game;
  map.terrain.fill(Terrain.GRASS);
  map.road.fill(0);
  map.fixedRoad.fill(0);
  for (let y = 28; y <= 35; y++) for (let x = 0; x < map.w; x++) map.terrain[map.idx(x, y)] = Terrain.WATER;
  for (let x = 20; x <= 22; x++) map.terrain[map.idx(x, 28)] = Terrain.GRASS;
  for (const [x, y] of water) map.terrain[map.idx(x, y)] = Terrain.WATER;
  map.computeWaterDistance();
  map.computeWaterways();
  game.onMapEdited();
  return game;
}

/** The plan for `type` held with its top-left at (x, y). */
const planAt = (game, type, x, y) => {
  const c = (BUILDINGS[type].size - 1) >> 1;
  return planAction(game, type, x + c, y + c, x + c, y + c);
};

test('a waterside building with land between part of its water side and the water is refused, and accepted right at the edge', () => {
  for (const type of SHORE) {
    const game = spitGame();
    const S = BUILDINGS[type].size;
    // Its south side partly on the water, partly on the spit: land in front of it.
    const gapX = 21 - S;
    const gap = checkBuilding(game, type, gapX, 28 - S);
    assert.equal(gap.ok, false, `${type} with the spit in front of part of it`);
    assert.equal(gap.reason, WATER_EDGE_REASON, type);
    assert.match(gap.reason, /^Must stand right at the water's edge/);
    const plan = planAt(game, type, gapX, 28 - S);
    assert.equal(plan.items[0].ok, false, `${type}: the preview is red`);
    assert.equal(plan.reason, WATER_EDGE_REASON);
    assert.equal(applyPlan(game, plan).ok, false, `${type}: nothing built`);
    // On the straight bank beside it, and out on the spit itself: the whole side on the water.
    for (const [x, y] of [[30, 28 - S], [20, 29 - S]]) {
      const chk = checkBuilding(game, type, x, y);
      assert.ok(chk.ok, `${type} at ${x},${y}: ${chk.reason}`);
      assert.equal(waterEdge(game.map, BUILDINGS[type], x, y).side, 2);
      assert.equal(planAt(game, type, x, y).items[0].state, 2, `${type}: the preview faces the river`);
    }
  }
});

test('a waterside building faces the side that lies right at the water, not a scrap of water at another side', () => {
  // A channel from the river comes up past a dock's east side and touches
  // it at its top tile only: the first water found round the dock (as it
  // always was found), but its whole south side lies on the river. It faces
  // south and berths there.
  const game = spitGame([[33, 25], [34, 25], [34, 26], [34, 27]]);
  const { map } = game;
  assert.equal(map.navigableBeside(30, 25, 3), map.idx(33, 25), 'the first water found is the channel, east');
  assert.ok(applyPlan(game, planAt(game, 'dock', 30, 25)).ok);
  const d = game.buildings.get(map.buildingAt(30, 25));
  assert.equal(d.waterSide, 2, 'it faces the river, where its whole side is');
  assert.equal(dockBerth(game, d), map.idx(30, 28), 'and berths there');
  assert.equal(artState(d), 2);
  // Both sides whole: the one found first, as before the rule.
  const two = spitGame([[33, 25], [33, 26], [33, 27]]);
  assert.ok(applyPlan(two, planAt(two, 'dock', 30, 25)).ok);
  assert.equal(two.buildings.get(two.map.buildingAt(30, 25)).waterSide, 1);
});

test('a waterside building that stood back from the water in an older save stays, and works as it did', () => {
  for (const type of SHORE) {
    const game = spitGame();
    const def = BUILDINGS[type];
    const S = def.size;
    const x = 21 - S;
    const b = addBuilding(game, type, x, 28 - S); // (as an older save holds it: never checked)
    const first = def.placement === 'shore' ? game.map.navigableBeside(x, 28 - S, S) : game.map.fishWaterBeside(x, 28 - S, S);
    assert.ok(first >= 0);
    assert.equal(waterEdge(game.map, def, x, 28 - S), null, `${type}: not right at the water`);
    assert.equal(shoreWaterAt(game.map, def, x, 28 - S), first, `${type}: the water it always had`);
    assert.equal(def.placement === 'shore' ? dockBerth(game, b) : waterBeside(game, b), first, `${type}: its berth`);
    const loaded = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
    const again = loaded.buildings.get(b.id);
    assert.ok(again, `${type}: still standing after a load`);
    assert.equal(again.waterSide, b.waterSide, `${type}: facing as before`);
  }
});

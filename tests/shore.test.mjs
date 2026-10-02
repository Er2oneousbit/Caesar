/**
 * shore.test.mjs - waterside buildings face their water: the Emporium, the
 * Navalia, a Naval Station, the Portus, a shipyard and a wharf are turned to
 * the water they touch as they are placed, in the placement preview, and as
 * an older save loads (playtest: a Portus and a Naval Station could stand
 * turned the wrong way until a ship first used them).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { Terrain } from '../src/world/map.js';
import { checkBuilding, planAction } from '../src/sim/construction.js';
import { addBuilding, shoreWaterAt } from '../src/sim/entities.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { artState } from '../src/render/buildingArt.js';
import { newGame } from './helpers.mjs';

log.setLevel('error');

const SHORE = ['dock', 'naval_station', 'navalia', 'portus', 'shipyard', 'wharf'];
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // side 0 = -y, 1 = +x, 2 = +y, 3 = -x

/** Is every tile just past the footprint's `side` edge water? (at least the one the building faces) */
function waterPast(map, x, y, S, side) {
  const [dx, dy] = DIRS[side];
  for (let k = 0; k < S; k++) {
    const tx = dx === 0 ? x + k : dx > 0 ? x + S : x - 1;
    const ty = dy === 0 ? y + k : dy > 0 ? y + S : y - 1;
    if (map.inBounds(tx, ty) && map.terrain[map.idx(tx, ty)] === Terrain.WATER) return true;
  }
  return false;
}

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
  const game = newGame({ type: 'coast', size: 96, seed: 'shore-face', money: 1e6 });
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

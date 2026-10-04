/**
 * shore.test.mjs - waterside buildings stand out over the water, as the
 * original's docks did (playtest): a 2x2 (the wharf, the shipyard) with its
 * front row on the water, a 3x3 (the Emporium, the Navalia, a Naval
 * Station, the Portus) with its two front rows on it, the rest on the shore;
 * refused anywhere else, with the reason in the preview. They face that
 * water by themselves, in the preview, once placed and after a load. The
 * water under them is closed to every boat (merchant ships, fishing boats,
 * liburnians, raider ships), which tie up just past the front instead; it
 * opens again when the building comes down, however it falls. Placement
 * never cuts a channel, covers the sea entry, a fishing ground, a boat or
 * another building's berth. One wholly on land from an older save stays,
 * and works as it did.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { Terrain, Road } from '../src/world/map.js';
import { checkBuilding, planAction, applyPlan, undoLast, waterRowsReason, turnRule } from '../src/sim/construction.js';
import { addBuilding, removeBuilding, shoreWaterAt, waterEdge, waterRowsFor, waterRowsSide, spawnWalker, computeAccessRoad, OVER_WATER_ART } from '../src/sim/entities.js';
import { followPath } from '../src/sim/movement.js';
import { dockBerth, shipPath } from '../src/sim/trade.js';
import { waterBeside } from '../src/sim/fishing.js';
import { waterPath, stationSpots } from '../src/sim/navy.js';
import { igniteBuilding } from '../src/sim/risk.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { artState } from '../src/render/buildingArt.js';
import { newGame } from './helpers.mjs';

log.setLevel('error');

const SHORE = ['dock', 'naval_station', 'navalia', 'portus', 'shipyard', 'wharf'];

/** Placeable spots for `type` on the map, one per side it faces, as found. */
function spotsBySide(game, type) {
  const S = BUILDINGS[type].size;
  const found = new Map();
  for (let y = 1; y < game.map.h - S - 1 && found.size < 4; y++) {
    for (let x = 1; x < game.map.w - S - 1 && found.size < 4; x++) {
      if (!checkBuilding(game, type, x, y).ok) continue;
      const plan = planAction(game, type, x, y, x + ((S - 1) >> 1), y + ((S - 1) >> 1));
      assert.deepEqual([plan.items[0].x, plan.items[0].y], [x, y], `${type}: the cursor anchors the preview at ${x},${y}`);
      const side = plan.items[0].state - OVER_WATER_ART;
      assert.ok(side >= 0 && side < 4, `${type}: the preview is drawn out over the water (${plan.items[0].state})`);
      if (!found.has(side)) found.set(side, { x, y });
    }
  }
  return found;
}

test('waterside buildings: one row of a 2x2 and two of a 3x3 stand on the water, and they turn themselves', () => {
  assert.equal(waterRowsFor(2), 1);
  assert.equal(waterRowsFor(3), 2);
  assert.equal(waterRowsFor(4), 2, 'and two for anything larger');
  for (const type of SHORE) assert.match(turnRule(type), /faces its water: it turns itself/, `${type}: R does not turn it`);
  assert.equal(waterRowsReason(BUILDINGS.dock), 'Two rows of the Emporium must stand on the water, the rest on the shore');
  assert.equal(waterRowsReason(BUILDINGS.wharf), 'One row of the Piscatoria must stand on the water, the rest on the shore');
});

test('every waterside building faces its water in the preview, once placed, and after a load', () => {
  // (Lakes: their shores run every way, so every building finds straight
  // banks on two sides or more.)
  const game = newGame({ type: 'lakes', size: 96, seed: 'shore-face', money: 1e6 });
  for (const type of SHORE) {
    const def = BUILDINGS[type];
    const spots = spotsBySide(game, type);
    assert.ok(spots.size >= 2, `${type}: shores on at least two sides of a building (${[...spots.keys()]})`);
    for (const [side, { x, y }] of spots) {
      if (!checkBuilding(game, type, x, y).ok) continue; // (taken by one placed before it in this loop)
      assert.equal(waterRowsSide(game.map, x, y, def.size), side, `${type} at ${x},${y}: the preview turns it to side ${side}, where its rows on the water are`);
      const b = addBuilding(game, type, x, y, def.size);
      assert.equal(b.waterSide, side, `${type}: placed facing the same water`);
      assert.equal(b.waterRows, waterRowsFor(def.size));
      assert.equal(artState(b) % 4, side, `${type}: drawn facing it`);
      assert.ok(artState(b) >= OVER_WATER_ART, `${type}: drawn out over the water`);
    }
  }
  // An older-style save whose waterside buildings never had a ship or boat:
  // no side saved; the load turns them to their water.
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  for (const b of data.buildings) { delete b.waterSide; delete b.waterRows; }
  const loaded = deserializeGame(data);
  for (const b of loaded.buildings.values()) {
    if (!SHORE.includes(b.type)) continue;
    assert.equal(b.waterSide, waterRowsSide(loaded.map, b.x, b.y, b.size), `${b.type} at ${b.x},${b.y} faces its water after the load`);
    assert.equal(b.waterRows, waterRowsFor(b.size), `${b.type}: its rows on the water, from the terrain`);
  }
});

// ---------------------------------------------------------------------------
// A straight river
// ---------------------------------------------------------------------------

/**
 * Open grass with one straight river across the whole 64-tile map, rows 28
 * to 28 + width - 1. Ships come in at its east end.
 */
function riverGame(width = 8) {
  const game = newGame({ seed: 'water-rows', money: 1e6 });
  const { map } = game;
  map.terrain.fill(Terrain.GRASS);
  map.road.fill(0);
  map.fixedRoad.fill(0);
  for (let y = 28; y < 28 + width; y++) for (let x = 0; x < map.w; x++) map.terrain[map.idx(x, y)] = Terrain.WATER;
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

/** The top-left row of `type` on the river's north bank, its front rows on the water. */
const northRow = (type) => 28 - (BUILDINGS[type].size - waterRowsFor(BUILDINGS[type].size));

test('placement: the front row (2x2) or two (3x3) on the water and the rest on the shore; anything else is red, with the reason', () => {
  for (const type of SHORE) {
    const game = riverGame();
    const def = BUILDINGS[type];
    const S = def.size;
    const rows = waterRowsFor(S);
    const y = northRow(type);
    // Right: its front rows on the water, facing the river (+y, side 2).
    const ok = checkBuilding(game, type, 30, y);
    assert.ok(ok.ok, `${type} at 30,${y}: ${ok.reason}`);
    assert.equal(planAt(game, type, 30, y).items[0].state, 2 + OVER_WATER_ART, `${type}: the preview faces the river, out over it`);
    // The berth: just past its front, the middle tile (the first of the two middle ones for a 2x2).
    assert.equal(ok.water, game.map.idx(30 + ((S - 1) >> 1), 28 + rows), `${type}: it ties up just past its front`);
    // Wrong: wholly on land at the water's edge (the older rule), a row too
    // far out, or a 3x3 with one row on the water; wholly on the water.
    const wrong = [y - 1, y + 1, 28];
    if (rows === 2) wrong.push(y - 1);
    for (const at of wrong) {
      const chk = checkBuilding(game, type, 30, at);
      assert.equal(chk.ok, false, `${type} at 30,${at}`);
      assert.equal(chk.reason, waterRowsReason(def), `${type} at 30,${at}`);
      const plan = planAt(game, type, 30, at);
      assert.equal(plan.items[0].ok, false, `${type}: the preview is red`);
      assert.equal(plan.reason, waterRowsReason(def));
      assert.equal(applyPlan(game, plan).ok, false, `${type}: nothing built`);
    }
    // Facing the other way, from the south bank (-y, side 0).
    const south = checkBuilding(game, type, 30, 36 - rows);
    assert.ok(south.ok, `${type} on the south bank: ${south.reason}`);
    assert.equal(planAt(game, type, 30, 36 - rows).items[0].state, 0 + OVER_WATER_ART);
  }
});

test('placement: a bank that bends under it, a pond, a bridge, or no water past its front is refused', () => {
  const game = riverGame();
  const { map } = game;
  // A tile of the land row is water: its rows on the water do not lie straight.
  map.terrain[map.idx(31, 27)] = Terrain.WATER;
  assert.equal(checkBuilding(game, 'dock', 30, 27).reason, waterRowsReason(BUILDINGS.dock));
  map.terrain[map.idx(31, 27)] = Terrain.GRASS;
  // A bridge across the river under its rows on the water.
  map.road[map.idx(31, 28)] = Road.BRIDGE;
  assert.equal(checkBuilding(game, 'dock', 30, 27).reason, 'A bridge is in the way');
  map.road[map.idx(31, 28)] = 0;
  // A 2-tile pond on the bank: no fish, no ships.
  const pond = newGame({ seed: 'water-rows', money: 1e6 });
  pond.map.terrain.fill(Terrain.GRASS);
  pond.map.terrain[pond.map.idx(20, 21)] = Terrain.WATER;
  pond.map.terrain[pond.map.idx(21, 21)] = Terrain.WATER;
  pond.map.computeWaterways();
  assert.match(checkBuilding(pond, 'wharf', 20, 20).reason, /pond has no fish/);
  // A sandbank just past its front: no water there to moor at.
  const narrow = riverGame();
  const front = narrow.map.idx(30, 29);
  narrow.map.terrain[front] = Terrain.GRASS;
  narrow.map.terrain[narrow.map.idx(31, 29)] = Terrain.GRASS;
  narrow.map.computeWaterways();
  assert.match(checkBuilding(narrow, 'wharf', 30, 27).reason, /moor just past its front: open water must lie there/);
});

test('placement: never over the sea entry, a fishing ground, a boat or another building\'s berth, and never across a channel', () => {
  // A river four wide: an Emporium on the north bank leaves two rows open;
  // a Navalia on the south bank just downstream would close the rest
  // (no boat passes between two tiles that only touch at a corner).
  const channel = riverGame(4);
  assert.ok(applyPlan(channel, planAt(channel, 'dock', 30, 27)).ok);
  assert.equal(checkBuilding(channel, 'navalia', 33, 30).reason, 'It would close the channel: no boat could sail past it');
  assert.ok(checkBuilding(channel, 'navalia', 34, 30).ok, 'a tile farther on, the water winds between them');
  const wide3 = riverGame(3);
  const clear = [...Array(50).keys()].map((k) => k + 5).find((x) => !wide3.map.fishingGrounds.some((g) => g.x >= x && g.x <= x + 2));
  assert.ok(checkBuilding(wide3, 'dock', clear, 27).ok, 'three wide: one row stays open');
  // The sea entry.
  const game = riverGame();
  const { map } = game;
  const e = map.seaEntry;
  assert.deepEqual(e, { x: 63, y: 28 });
  assert.equal(checkBuilding(game, 'wharf', 62, 27).reason, 'Ships come in from the sea here: keep this water open');
  // A fishing ground (in a river three wide they lie in its middle row).
  const three = riverGame(3);
  const g = three.map.fishingGrounds[0];
  assert.equal(g.y, 29);
  assert.equal(checkBuilding(three, 'dock', g.x - 1, 27).reason, 'A fishing ground lies here: keep this water open');
  // A boat on its rows.
  const boat = spawnWalker(game, 'ship', map.idx(31, 29), null, { state: 'toDock', speed: CONFIG.SHIP_SPEED });
  assert.equal(checkBuilding(game, 'dock', 30, 27).reason, 'A boat is in the way: wait until it has passed');
  game.walkers.delete(boat.id);
  assert.ok(checkBuilding(game, 'dock', 30, 27).ok);
  // Another building's berth: a south-bank Navalia whose rows cover the
  // berth of an Emporium on the north bank, in a river four wide.
  const four = riverGame(4);
  assert.ok(applyPlan(four, planAt(four, 'dock', 10, 27)).ok);
  const dock = four.buildings.get(four.map.buildingAt(10, 27));
  assert.equal(dockBerth(four, dock), four.map.idx(11, 30));
  assert.equal(checkBuilding(four, 'navalia', 10, 30).reason, 'The Emporium at 10, 27 has its berth here: keep this water open');
});

// ---------------------------------------------------------------------------
// Boats go round
// ---------------------------------------------------------------------------

test('the water under it is closed to every boat; ships tie up just past its front', () => {
  const game = riverGame(4);
  const { map } = game;
  const east = map.idx(63, 28);
  const west = map.idx(2, 28);
  assert.ok(shipPath(game, east, west).some((i) => map.yOf(i) === 28 && map.xOf(i) === 31), 'before: straight along the bank');
  const navBefore = map.navBody[map.idx(31, 28)];
  for (const [type, x] of [['dock', 30], ['wharf', 40], ['naval_station', 10]]) assert.ok(applyPlan(game, planAt(game, type, x, northRow(type))).ok, type);
  const dock = game.buildings.get(map.buildingAt(30, 27));
  const wharf = game.buildings.get(map.buildingAt(40, 27));
  const station = game.buildings.get(map.buildingAt(10, 27));
  for (const b of [dock, wharf, station]) {
    for (let dy = 0; dy < b.size; dy++) {
      for (let dx = 0; dx < b.size; dx++) {
        const i = map.idx(b.x + dx, b.y + dy);
        if (map.terrain[i] !== Terrain.WATER) continue;
        assert.equal(map.navigable[i], 0, `${b.type}: no ship sails at ${b.x + dx},${b.y + dy}`);
        assert.equal(map.navBody[i], 0);
        assert.equal(map.fishBody[i], 0);
      }
    }
  }
  assert.equal(map.navBody[map.idx(31, 30)], navBefore, 'the rest of the river keeps its number');
  // Merchant ships, warships and fishing boats all route round.
  const routes = [shipPath(game, east, west), waterPath(game, east, west)];
  for (const r of routes) {
    assert.ok(r, 'a way round');
    assert.ok(r.every((i) => !map.building[i]), 'never through a building');
  }
  // Berths: just past the front, alongside the middle of the quay.
  assert.equal(dockBerth(game, dock), map.idx(31, 30));
  assert.equal(waterBeside(game, wharf), map.idx(40, 29));
  const spots = stationSpots(game, station);
  for (const s of spots) assert.equal(map.building[map.idx(Math.floor(s.x), Math.floor(s.y))], 0, 'a liburnian lies on open water');
});

test('a merchant ship under way when a pier goes up across its course goes round it to its dock', () => {
  const game = riverGame(4);
  const { map } = game;
  assert.ok(applyPlan(game, planAt(game, 'dock', 10, 27)).ok);
  const dock = game.buildings.get(map.buildingAt(10, 27));
  const entry = map.idx(63, 28);
  const berth = dockBerth(game, dock);
  const ship = spawnWalker(game, 'ship', entry, null, { partner: 'tarraco', target: dock.id, state: 'toDock', speed: CONFIG.SHIP_SPEED });
  dock.shipId = ship.id;
  // Its course: along the north bank (row 28), then down to the berth.
  const path = [];
  for (let x = 63; x >= 13; x--) path.push(map.idx(x, 28));
  path.push(map.idx(13, 29), map.idx(13, 30), map.idx(12, 30), berth);
  assert.equal(berth, map.idx(11, 30));
  followPath(game, ship, path);
  game.runTicks(40);
  assert.ok(ship.x > 32);
  // A wharf with its row on the water across that course.
  assert.ok(applyPlan(game, planAt(game, 'wharf', 24, 27)).ok, 'a wharf stands out over its course now');
  // (The dock has no road or staff here, so the ship turns round once it gets there.)
  let there = false;
  for (let t = 0; t < 4000 && !there && game.walkers.has(ship.id); t++) {
    game.tick();
    assert.equal(map.building[map.idx(ship.x, ship.y)], 0, 'never on a building');
    there = map.idx(ship.x, ship.y) === berth;
  }
  assert.equal(there, true, 'it found its way round to the dock');
});

test('demolished, burned or undone, its rows are open water again, with no rubble or flames on the water', () => {
  for (const how of ['demolish', 'fire', 'undo']) {
    const game = riverGame(4);
    const { map } = game;
    const before = { nav: map.navigable.slice(), body: map.navBody.slice(), fish: map.fishBody.slice() };
    assert.ok(applyPlan(game, planAt(game, 'dock', 30, 27)).ok);
    const dock = game.buildings.get(map.buildingAt(30, 27));
    assert.equal(map.navigable[map.idx(30, 28)], 0);
    if (how === 'demolish') removeBuilding(game, dock, 'demolish');
    if (how === 'fire') igniteBuilding(game, dock, 'fire');
    if (how === 'undo') assert.ok(undoLast(game).ok);
    assert.equal(game.buildings.has(dock.id), false, how);
    assert.deepEqual(map.navigable, before.nav, `${how}: navigable again`);
    assert.deepEqual(map.navBody, before.body, `${how}: the same water`);
    assert.deepEqual(map.fishBody, before.fish, `${how}: fish again`);
    for (let x = 30; x <= 32; x++) {
      for (const y of [28, 29]) {
        assert.equal(map.rubble[map.idx(x, y)], 0, `${how}: no rubble on the water`);
        assert.equal(game.fires.has(map.idx(x, y)), false, `${how}: no flames on the water`);
      }
      if (how === 'fire') assert.equal(map.rubble[map.idx(x, 27)], 1, 'the shore row burns down to rubble');
    }
    assert.ok(shipPath(game, map.idx(63, 28), map.idx(31, 28)), `${how}: ships sail there again`);
  }
});

test('its road: beside its rows on the shore, never a bridge past its pier', () => {
  const game = riverGame(4);
  const { map } = game;
  const d = addBuilding(game, 'dock', 30, 27);
  map.road[map.idx(33, 28)] = Road.BRIDGE; // beside a row on the water
  game.processRoadChanges();
  assert.equal(d.accessRoad, -1, 'a bridge beside its pier gives no access');
  assert.equal(checkBuilding(game, 'dock', 20, 27).noRoad, true);
  map.road[map.idx(33, 27)] = Road.ROAD; // beside its row on the shore
  game.processRoadChanges();
  computeAccessRoad(game, d);
  assert.equal(d.accessRoad, map.idx(33, 27));
});

// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

test('a save keeps the water under a waterside building closed', () => {
  const game = riverGame(4);
  assert.ok(applyPlan(game, planAt(game, 'navalia', 30, 27)).ok);
  const loaded = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  const { map } = loaded;
  const b = loaded.buildings.get(map.buildingAt(30, 27));
  assert.equal(b.waterRows, 2);
  assert.equal(b.waterSide, 2);
  assert.equal(map.navigable[map.idx(31, 28)], 0, 'closed after the load');
  assert.deepEqual(map.navBody, game.map.navBody, 'the same water as before the save');
  assert.equal(dockBerth(loaded, b), map.idx(31, 30));
});

test('a waterside building on land in an older save stays, faces and berths as it did, and keeps its look', () => {
  for (const type of SHORE) {
    const game = riverGame();
    const def = BUILDINGS[type];
    const S = def.size;
    // Right at the water's edge (the rule from v0.18.6), and standing back
    // from it with a strip of beach in front of one tile (before that).
    for (const [x, y] of [[30, 28 - S], [20, 27 - S]]) {
      if (y === 27 - S) map(game).terrain[map(game).idx(x, 27)] = Terrain.WATER; // (a notch the older building touches)
      game.map.computeWaterways();
      const b = addBuilding(game, type, x, y); // (as an older save holds it: never checked)
      assert.equal(b.waterRows, 0, `${type}: wholly on land`);
      const first = def.placement === 'shore' ? game.map.navigableBeside(x, y, S) : game.map.fishWaterBeside(x, y, S);
      const edge = waterEdge(game.map, def, x, y, S);
      const was = edge ? edge.water : first;
      assert.equal(shoreWaterAt(game.map, def, x, y), was, `${type} at ${x},${y}: the water it always had`);
      assert.equal(def.placement === 'shore' ? dockBerth(game, b) : waterBeside(game, b), was, `${type}: its berth`);
      assert.ok(artState(b) < OVER_WATER_ART, `${type}: its old look`);
    }
    const data = JSON.parse(JSON.stringify(serializeGame(game)));
    data.version = 29;
    for (const b of data.buildings) delete b.waterRows;
    const loaded = deserializeGame(data);
    for (const b of game.buildings.values()) {
      if (b.type !== type) continue;
      const again = loaded.buildings.get(b.id);
      assert.ok(again, `${type}: still standing after a load`);
      assert.equal(again.waterRows, 0);
      assert.equal(again.waterSide, b.waterSide, `${type}: facing as before`);
      assert.equal(def.placement === 'shore' ? dockBerth(loaded, again) : waterBeside(loaded, again), def.placement === 'shore' ? b.berth : b.mooring, `${type}: the same berth`);
    }
  }
});

// ---------------------------------------------------------------------------
// Found in review
// ---------------------------------------------------------------------------

test('review: a spot whose rows lie right but which is refused (a boat there) still previews the pier facing the water', () => {
  const game = riverGame();
  const boat = spawnWalker(game, 'ship', game.map.idx(31, 29), null, { state: 'toDock', speed: CONFIG.SHIP_SPEED });
  const plan = planAt(game, 'dock', 30, 27);
  assert.equal(plan.items[0].ok, false);
  assert.equal(plan.items[0].state, 2 + OVER_WATER_ART, 'out over the water, facing the river');
  game.walkers.delete(boat.id);
});

test('review: a low bridge along an Emporium\'s front does not say it cuts it off when ships can still tie up beside it', () => {
  const game = riverGame();
  const { map } = game;
  // Two islets in the river carry a low bridge along row 30, past the dock's front.
  for (const x of [27, 36]) map.terrain[map.idx(x, 30)] = Terrain.GRASS;
  map.computeWaterways();
  assert.ok(applyPlan(game, planAt(game, 'dock', 30, 27)).ok);
  const dock = game.buildings.get(map.buildingAt(30, 27));
  assert.equal(dockBerth(game, dock), map.idx(31, 30));
  const plan = planAction(game, 'low_bridge', 27, 30, 36, 30);
  assert.equal(plan.reason, null, plan.reason);
  assert.ok(!plan.warnings.some((w) => /cuts the Emporium/.test(w)), plan.warnings.join(' / '));
  // Built, the ships tie up beside its rows on the water, and still come from the sea.
  assert.ok(applyPlan(game, plan).ok);
  const berth = dockBerth(game, dock);
  assert.ok(berth >= 0 && map.yOf(berth) < 30, `beside the pier (${map.xOf(berth)}, ${map.yOf(berth)})`);
  assert.ok(shipPath(game, map.idx(map.seaEntry.x, map.seaEntry.y), berth), 'ships still reach it');
});

/** (Readability: the map of a game.) */
function map(game) { return game.map; }

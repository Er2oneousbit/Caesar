/**
 * bridges.test.mjs - the two bridges (sim/bridges.js, sim/construction.js
 * planBridge): the ship bridge lets every boat under it, the low bridge
 * none; their lengths and prices; the warning when a low bridge would cut a
 * dock or a wharf off; merchant ships, fishing boats and raider ships under
 * way when one goes up; clearing and undoing one; saves.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { TOOLS } from '../src/data/buildings.js';
import { Terrain, Road } from '../src/world/map.js';
import { planAction, applyPlan, undoLast } from '../src/sim/construction.js';
import { addBuilding, spawnWalker } from '../src/sim/entities.js';
import { followPath } from '../src/sim/movement.js';
import { dockBerth, shipPath } from '../src/sim/trade.js';
import { waterBeside } from '../src/sim/fishing.js';
import { waterPath } from '../src/sim/navy.js';
import { spawnUnit, updateMilitary } from '../src/sim/military.js';
import { cutOffNote } from '../src/sim/bridges.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { newGame } from './helpers.mjs';

log.setLevel('error');

/**
 * Open grass with one straight river, 8 tiles wide (rows 28 to 35), across
 * the whole 64-tile map: ships come in at its east end (63, 28); fishing
 * grounds lie at x 6, 41 and 57.
 */
function riverGame() {
  const game = newGame({ seed: 'low-bridge' });
  const { map } = game;
  map.terrain.fill(Terrain.GRASS);
  map.road.fill(0);
  map.fixedRoad.fill(0);
  for (let y = 28; y <= 35; y++) for (let x = 0; x < map.w; x++) map.terrain[map.idx(x, y)] = Terrain.WATER;
  map.computeWaterDistance();
  map.computeWaterways();
  game.onMapEdited();
  assert.deepEqual(map.seaEntry, { x: 63, y: 28 });
  assert.deepEqual(map.fishingGrounds.map((g) => g.x), [6, 41, 57]);
  return game;
}

/** A bridge of `tool` straight across the river at column x (land at rows 27 and 36). */
function bridgeAt(game, tool, x) {
  return planAction(game, tool, x, 27, x, 36);
}

/** An Emporium on the north bank at x..x+2 (rows 25 to 27), its berth in row 28. */
function dockAt(game, x) {
  const d = addBuilding(game, 'dock', x, 25);
  dockBerth(game, d);
  assert.equal(game.map.yOf(d.berth), 28);
  return d;
}

test('bridges: the ship bridge costs 100 a tile and spans at least 3 tiles of water, the low bridge 40 and 1', () => {
  assert.equal(TOOLS.bridge.cost, 100);
  assert.equal(TOOLS.low_bridge.cost, 40);
  const game = riverGame();
  const ship = bridgeAt(game, 'bridge', 30);
  assert.equal(ship.reason, null);
  assert.equal(ship.cost, 8 * 100 + 2 * TOOLS.road.cost, '8 water tiles and a road tile on each bank');
  const low = bridgeAt(game, 'low_bridge', 30);
  assert.equal(low.cost, 8 * 40 + 2 * TOOLS.road.cost);
  // A stream 2 tiles wide: only a low bridge.
  const { map } = game;
  for (let y = 5; y <= 6; y++) for (let x = 0; x < 64; x++) map.terrain[map.idx(x, y)] = Terrain.WATER;
  map.computeWaterways();
  assert.match(planAction(game, 'bridge', 10, 4, 10, 7).reason, /at least 3 tiles of water/);
  assert.equal(planAction(game, 'low_bridge', 10, 4, 10, 7).reason, null);
});

test('bridges: the low bridge comes with the ship bridge in every mission that has one', () => {
  const game = riverGame();
  game.flags.unlockall = false;
  game.scenario = { ...game.scenario, unlocks: ['road', 'bridge'] };
  game.unlockedSet = new Set(['road', 'bridge']);
  assert.equal(game.isUnlocked('low_bridge'), true);
  game.unlockedSet = new Set(['road']);
  assert.equal(game.isUnlocked('low_bridge'), false);
});

test('bridges: ships sail under a ship bridge but no boat passes a low bridge', () => {
  const game = riverGame();
  const { map } = game;
  const dock = dockAt(game, 10);
  const entry = map.idx(63, 28);
  assert.ok(applyPlan(game, bridgeAt(game, 'bridge', 30)).ok);
  assert.ok(shipPath(game, entry, dock.berth), 'a merchant ship gets under the ship bridge');
  assert.equal(map.navBody[map.idx(5, 30)], map.navBody[entry], 'one water');
  assert.equal(map.hasLowBridge(), false);
  // The same crossing as a low bridge, a few tiles on.
  assert.ok(applyPlan(game, bridgeAt(game, 'low_bridge', 34)).ok);
  assert.equal(map.bridgeLow[map.idx(34, 30)], 1);
  assert.equal(map.road[map.idx(34, 30)], Road.BRIDGE, 'a road like any bridge: walkers cross it');
  assert.equal(shipPath(game, entry, dock.berth), null, 'no merchant ship past it');
  assert.notEqual(map.navBody[map.idx(5, 30)], map.navBody[entry], 'its water is split for warships and raider ships');
  assert.equal(map.navWhole[map.idx(5, 30)], map.navWhole[entry], '(but it is one river)');
  assert.equal(waterPath(game, entry, map.idx(5, 30)), null, 'no warship route past it');
  assert.notEqual(map.fishBody[map.idx(5, 30)], map.fishBody[entry], 'nor a fishing boat\'s');
  assert.match(cutOffNote(game, dock), /low bridge blocks the way to the sea/);
});

test('bridges: placing a low bridge warns of the dock it cuts off from the sea; the ship bridge does not', () => {
  const game = riverGame();
  dockAt(game, 10);
  assert.deepEqual(bridgeAt(game, 'bridge', 30).warnings, []);
  const low = bridgeAt(game, 'low_bridge', 30);
  assert.equal(low.reason, null, 'allowed: the choice is the player\'s');
  assert.ok(low.warnings.some((w) => /cuts the Emporium at 10, 25 off from the sea/.test(w)), low.warnings.join(' | '));
  // Downstream of the dock nothing is cut off, but ships will not sail on past it.
  const below = bridgeAt(game, 'low_bridge', 5);
  assert.equal(below.warnings.some((w) => /Emporium/.test(w)), false);
  assert.ok(below.warnings.some((w) => /ships from the sea will not sail beyond it/.test(w)));
});

test('bridges: a low bridge that leaves a wharf no fishing ground warns, and its panel says so once built', () => {
  const game = riverGame();
  const wharf = addBuilding(game, 'wharf', 14, 26);
  assert.ok(waterBeside(game, wharf) >= 0);
  assert.ok(applyPlan(game, bridgeAt(game, 'low_bridge', 10)).ok, 'ground 6 is now beyond a low bridge');
  assert.equal(cutOffNote(game, wharf), null, 'the ground at x 41 is still on its side');
  const plan = bridgeAt(game, 'low_bridge', 30);
  assert.ok(plan.warnings.some((w) => /cuts the Piscatoria at 14, 26 off from its fishing grounds/.test(w)), plan.warnings.join(' | '));
  assert.ok(applyPlan(game, plan).ok);
  assert.match(cutOffNote(game, wharf), /cuts it off from its fishing grounds/);
});

test('bridges: no low bridge where ships come in, nor over a boat; a ship bridge cannot be mixed into one', () => {
  const game = riverGame();
  const { map } = game;
  assert.match(planAction(game, 'low_bridge', 63, 27, 63, 36).reason, /Ships come in from the sea here/);
  const boat = spawnWalker(game, 'fishing_boat', map.idx(30, 31), null, { state: 'spare', body: map.fishBody[map.idx(30, 31)] });
  assert.ok(boat);
  assert.match(bridgeAt(game, 'low_bridge', 30).reason, /A boat is in the way/);
  assert.equal(bridgeAt(game, 'bridge', 30).reason, null, 'a ship bridge passes over it');
  assert.ok(applyPlan(game, bridgeAt(game, 'bridge', 30)).ok);
  assert.match(bridgeAt(game, 'low_bridge', 30).reason, /Ship Bridge stands here/);
});

test('bridges: clearing or undoing a low bridge opens the water again, as it was', () => {
  const game = riverGame();
  const { map } = game;
  const before = map.navBody.slice();
  const fishBefore = map.fishBody.slice();
  assert.ok(applyPlan(game, bridgeAt(game, 'low_bridge', 30)).ok);
  assert.ok(map.hasLowBridge());
  assert.ok(undoLast(game).ok);
  assert.equal(map.hasLowBridge(), false);
  assert.deepEqual(map.navBody, before);
  assert.deepEqual(map.fishBody, fishBefore);
  assert.ok(applyPlan(game, bridgeAt(game, 'low_bridge', 30)).ok);
  assert.ok(applyPlan(game, planAction(game, 'clear', 30, 29, 30, 34)).ok);
  assert.equal(map.bridgeLow[map.idx(30, 30)], 0);
  assert.equal(map.navBody[map.idx(5, 30)], map.navBody[map.idx(63, 28)], 'one water again');
  assert.deepEqual(map.fishingGrounds.map((g) => g.body), [1, 1, 1]);
});

test('bridges: a merchant ship under way when a low bridge goes up turns back to sea, never through it', () => {
  const game = riverGame();
  const { map } = game;
  const dock = dockAt(game, 10);
  const entry = map.idx(63, 28);
  const ship = spawnWalker(game, 'ship', entry, null, { partner: 'tarraco', target: dock.id, state: 'toDock', speed: CONFIG.SHIP_SPEED });
  dock.shipId = ship.id;
  followPath(game, ship, shipPath(game, entry, dock.berth));
  game.runTicks(40); // well out from the sea entry
  assert.ok(ship.x > 32);
  assert.ok(applyPlan(game, bridgeAt(game, 'low_bridge', 30)).ok);
  let crossed = false;
  for (let t = 0; t < 4000 && game.walkers.has(ship.id); t++) {
    game.tick();
    if (ship.x <= 30) crossed = true;
  }
  assert.equal(crossed, false, 'it never reached the low bridge\'s column');
  assert.equal(game.walkers.has(ship.id), false, 'it sailed back out to sea');
  assert.equal(dock.shipId, 0, 'the dock waits for another ship');
});

test('bridges: a ship bridge built in front of a merchant ship changes nothing: it sails under it to the dock', () => {
  const game = riverGame();
  const { map } = game;
  const dock = dockAt(game, 10);
  const entry = map.idx(63, 28);
  const ship = spawnWalker(game, 'ship', entry, null, { partner: 'tarraco', target: dock.id, state: 'toDock', speed: CONFIG.SHIP_SPEED });
  dock.shipId = ship.id;
  followPath(game, ship, shipPath(game, entry, dock.berth));
  game.runTicks(40);
  assert.ok(applyPlan(game, bridgeAt(game, 'bridge', 30)).ok);
  // (The dock has no road or staff here, so the ship turns round once it gets there.)
  let there = false;
  for (let t = 0; t < 4000 && !there && game.walkers.has(ship.id); t++) {
    game.tick();
    there = map.idx(ship.x, ship.y) === dock.berth;
  }
  assert.equal(there, true, 'it reached the dock, under the bridge');
});

test('bridges: a fishing boat sailing out when a low bridge cuts its ground off fishes at another, or comes home', () => {
  const game = riverGame();
  const { map } = game;
  const wharf = addBuilding(game, 'wharf', 48, 26);
  wharf.efficiency = 1;
  const moor = waterBeside(game, wharf);
  const body = map.fishBody[moor];
  const boat = spawnWalker(game, 'fishing_boat', moor, wharf, { state: 'toGround', body });
  wharf.boatId = boat.id;
  const path = game.pf.astar(moor, map.idx(6, 30), (i) => (map.fishBody[i] === body ? 1 : Infinity), { maxNodes: map.size * 4 });
  boat.ground = { x: 6, y: 30 };
  followPath(game, boat, path);
  game.runTicks(30);
  assert.ok(boat.x > 32, 'still east of the bridge');
  assert.ok(applyPlan(game, bridgeAt(game, 'low_bridge', 30)).ok);
  for (let t = 0; t < 3000 && boat.state === 'toGround'; t++) {
    game.tick();
    assert.ok(boat.x > 30, 'never at or past the bridge');
  }
  assert.equal(game.walkers.has(boat.id), true, 'not lost');
  assert.ok([41, 57].includes(boat.ground.x), `fishing at a ground on its side (${boat.ground.x})`);
});

test('bridges: a raider ship stopped by a new low bridge puts its warriors ashore near it, on its own side', () => {
  const game = riverGame();
  const { map } = game;
  addBuilding(game, 'house', 40, 20); // something for the raiders to walk to
  const entry = map.idx(63, 28);
  const water = map.idx(10, 28);
  const inv = { id: 7, origin: { x: 10, y: 27 }, size: 2, killed: 0, buildingsLost: 0, startDay: 0, fleeing: false, reached: false, sea: true, landing: { x: 10, y: 27, water }, landed: false, landedDay: null, ships: 1, shipsSunk: 0 };
  game.military.active = inv;
  const ship = spawnUnit(game, 'raider_ship', 63.5, 28.5, { invasion: 7, state: 'sail', crew: ['raider', 'raider'], pots: 0, body: map.navBody[entry] });
  ship.path = waterPath(game, entry, water);
  ship.pathIndex = 1;
  for (let t = 0; t < 60; t++) updateMilitary(game);
  assert.ok(ship.x > 34);
  assert.ok(applyPlan(game, bridgeAt(game, 'low_bridge', 30)).ok);
  for (let t = 0; t < 3000 && !inv.landed; t++) {
    updateMilitary(game);
    assert.ok(ship.x > 30, 'never past the bridge');
  }
  assert.equal(inv.landed, true);
  const raiders = [...game.units.values()].filter((u) => u.type === 'raider');
  assert.equal(raiders.length, 2);
  for (const r of raiders) assert.ok(r.x > 26 && Math.abs(r.x - ship.x) < 7, `ashore near the ship (${r.x.toFixed(1)}, ship ${ship.x.toFixed(1)})`);
});

test('bridges: a save keeps its low bridges; a save from before them loads with every bridge a ship bridge', () => {
  const game = riverGame();
  assert.ok(applyPlan(game, bridgeAt(game, 'low_bridge', 30)).ok);
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  const back = deserializeGame(data);
  assert.equal(back.map.bridgeLow[back.map.idx(30, 31)], 1);
  assert.deepEqual(back.map.navBody, game.map.navBody);
  delete data.map.bridgeLow;
  const old = deserializeGame(data);
  assert.equal(old.map.hasLowBridge(), false);
  assert.equal(old.map.road[old.map.idx(30, 31)], Road.BRIDGE);
  assert.equal(old.map.navBody[old.map.idx(5, 30)], old.map.navBody[old.map.idx(63, 28)]);
});

test('bridges: the low bridge is drawn on either axis, and walkers on it stand on its lower deck at every view turn', async () => {
  const { bridgeSpan } = await import('../src/render/renderer.js');
  const { lowBridgeSpec, bridgeSpec, LOW_BRIDGE_DECK_Z, BRIDGE_DECK_Z } = await import('../src/render/terrainArt.js');
  const { recordingContext } = await import('../src/render/draw.js');
  for (const axis of ['u', 'v']) {
    const spec = lowBridgeSpec(axis);
    assert.ok(spec.w > 0 && spec.h > 0);
    spec.draw(recordingContext().ctx);
    assert.ok(spec.h < bridgeSpec(axis).h, 'lower than the ship bridge');
  }
  assert.ok(LOW_BRIDGE_DECK_Z < BRIDGE_DECK_Z);
  const game = riverGame();
  const { map } = game;
  assert.ok(applyPlan(game, bridgeAt(game, 'low_bridge', 30)).ok);
  assert.ok(applyPlan(game, bridgeAt(game, 'bridge', 20)).ok);
  for (let turn = 0; turn < 4; turn++) {
    assert.equal(bridgeSpan(map, 30.5, 31.5, false, turn).lift, LOW_BRIDGE_DECK_Z, `turn ${turn}`);
    assert.equal(bridgeSpan(map, 20.5, 31.5, false, turn).lift, BRIDGE_DECK_Z, `turn ${turn}`);
  }
});

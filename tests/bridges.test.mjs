/**
 * bridges.test.mjs - the two bridges (sim/bridges.js, sim/construction.js
 * planBridge): the ship bridge lets every boat under it, the low bridge
 * none; their lengths and prices; the warning when a low bridge would cut a
 * dock or a wharf off; merchant ships, fishing boats and raider ships under
 * way when one goes up; clearing and undoing one; saves. And how they are
 * drawn (render/bridgeProfile.js): the ship bridge high over the masts,
 * its ramps from the banks' road tiles, the people on them lifted to what
 * is drawn at every view turn, the low bridge's short ramps.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { TOOLS } from '../src/data/buildings.js';
import { GameMap, Terrain, Road } from '../src/world/map.js';
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

test('bridges: a building\'s panel asks about low bridges only for waterside buildings, and asking costs no scan of the map', () => {
  const game = riverGame();
  const { map } = game;
  const house = addBuilding(game, 'house', 20, 10);
  let asked = 0;
  const real = map.hasLowBridge.bind(map);
  map.hasLowBridge = () => { asked++; return real(); };
  assert.equal(cutOffNote(game, house), null);
  assert.equal(asked, 0, 'a home is never cut off: not asked');
  map.hasLowBridge = real;
  assert.equal(map.hasLowBridge(), false);
  assert.ok(applyPlan(game, bridgeAt(game, 'low_bridge', 30)).ok);
  assert.equal(map.hasLowBridge(), true);
  map.bridgeLow.fill(0); // (the answer is the water as last worked out, not a scan of the layer)
  assert.equal(map.hasLowBridge(), true);
});

test('bridges: a liburnian a new low bridge cuts off from its station goes to one on its side, or is laid up; the plan warns of it', () => {
  for (const other of [false, true]) {
    const game = riverGame();
    const { map } = game;
    const st = addBuilding(game, 'naval_station', 10, 25);
    const there = other ? addBuilding(game, 'naval_station', 52, 25) : null;
    const u = spawnUnit(game, 'liburnian', 50.5, 31.5, { station: st.id, slot: 0, state: 'sail', body: map.navBody[map.idx(50, 31)] });
    const plan = bridgeAt(game, 'low_bridge', 30);
    assert.ok(plan.warnings.some((w) => /1 liburnian of the Statio at 10, 25 would be cut off from it/.test(w)), plan.warnings.join(' | '));
    assert.ok(applyPlan(game, plan).ok);
    if (other) {
      assert.equal(u.station, there.id, 'it joins the station on its own side');
      assert.ok(game.units.has(u.id));
    } else {
      assert.equal(game.units.has(u.id), false, 'laid up: it could never reach its berth');
      assert.ok(game.messages.some((m) => /A low bridge has cut 1 liburnian off from its station: 1 is laid up/.test(m.text)));
    }
  }
});

test('bridges: reading a waterside building\'s panel changes nothing (no berth found or turned while reading)', () => {
  const game = riverGame();
  assert.ok(applyPlan(game, bridgeAt(game, 'low_bridge', 30)).ok);
  const nav = addBuilding(game, 'navalia', 40, 25);
  nav.berth = undefined;
  nav.waterSide = undefined;
  cutOffNote(game, nav);
  assert.equal(nav.berth, undefined);
  assert.equal(nav.waterSide, undefined);
});

/**
 * A bare map for the bridges' looks: grass, a channel of water `n` tiles
 * wide (k = 10 to 9 + n along the bridge), and a straight bridge across it
 * in row j = 20 with a road tile on each bank (k = 9 and 10 + n). The
 * bridge runs along x for axis 'u', along y for 'v'; `pt(k, j)` is the map
 * point k along it and j across.
 */
function bridgeMap(axis, n, low = false) {
  const map = new GameMap(40, 40);
  map.terrain.fill(Terrain.GRASS);
  const pt = (k, j) => (axis === 'u' ? [k, j] : [j, k]);
  for (let k = 10; k < 10 + n; k++) for (let j = 0; j < 40; j++) map.terrain[map.idx(...pt(k, j))] = Terrain.WATER;
  for (let k = 9; k <= 10 + n; k++) {
    const i = map.idx(...pt(k, 20));
    const bank = k === 9 || k === 10 + n;
    map.road[i] = bank ? Road.ROAD : Road.BRIDGE;
    if (!bank && low) map.bridgeLow[i] = 1;
  }
  return { map, pt };
}

test('bridges: walkers climb the ship bridge\'s ramps from the middle of the bank\'s road tile to its deck, on either axis at every view turn (playtest: no ramps)', async () => {
  const { bridgeSpan } = await import('../src/render/renderer.js');
  const { BRIDGE_DECK_Z: Z } = await import('../src/render/terrainArt.js');
  assert.equal(Z % 3, 0, 'a third of the deck at each bank edge, two thirds a tile in: whole px');
  for (const axis of ['u', 'v']) {
    const { map, pt } = bridgeMap(axis, 6); // water k 10..15, banks 9 and 16
    for (let turn = 0; turn < 4; turn++) {
      const lift = (k, j = 20.5) => bridgeSpan(map, ...pt(k, j), false, turn).lift;
      const at = `axis ${axis}, turn ${turn}`;
      assert.equal(lift(8.5), 0, `${at}: the road before the bank`);
      assert.equal(lift(9.5), 0, `${at}: the ramp starts at road level in the middle of the bank's road tile`);
      assert.equal(lift(9.75), Z / 6, `${at}: halfway up the foot`);
      assert.equal(lift(10), Z / 3, `${at}: at the water's edge`);
      assert.equal(lift(10.5), (2 * Z) / 3, `${at}: halfway up the first tile`);
      assert.equal(lift(11), Z, `${at}: up on the deck`);
      assert.equal(lift(12.5), Z, `${at}: the deck`);
      assert.equal(lift(15.5), (2 * Z) / 3, `${at}: down the far ramp`);
      assert.equal(lift(16.5), 0, `${at}: back at road level on the far bank`);
      assert.equal(lift(9.5, 20.1), 0, `${at}: a road joining the bank tile from the side meets the ramp at road level`);
    }
  }
});

test('bridges: the deck drawn at each view turn is the one walkers stand on, ramps and feet alike', async () => {
  const { bridgeSpan } = await import('../src/render/renderer.js');
  const { bridgeLook, footLook, bridgeFeet } = await import('../src/render/bridgeProfile.js');
  const { deckAt } = await import('../src/render/terrainArt.js');
  const { toView } = await import('../src/render/view.js');
  const frac = (v) => v - Math.floor(v);
  for (const axis of ['u', 'v']) {
    for (const [n, low] of [[6, false], [3, false], [1, false], [4, true], [1, true]]) {
      const { map, pt } = bridgeMap(axis, n, low);
      for (let turn = 0; turn < 4; turn++) {
        for (let k = 9; k <= 10 + n; k++) {
          const [x, y] = pt(k, 20);
          const look = bridgeLook(map, x, y, turn);
          const feet = bridgeFeet(map, x, y);
          if (k === 9 || k === 10 + n) assert.equal(feet.length, low ? 0 : 1, 'a ship bridge\'s ramp starts on each bank\'s road tile; a low bridge\'s on the water');
          for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
            const [fx, fy] = pt(k + t, 20.5);
            const [vx, vy] = toView(fx, fy, turn, 40, 40);
            const lift = bridgeSpan(map, fx, fy, false, turn).lift;
            const label = `axis ${axis}, ${n} tiles${low ? ' low' : ''}, turn ${turn}, at ${k + t}`;
            if (look) {
              // Where the walker is along the tile as the view sees it.
              const tv = frac(look.axis === 'u' ? vx : vy);
              assert.ok(Math.abs(lift - deckAt(look.h, tv)) < 1e-9, label);
            } else if (feet.length) {
              const { axis: va, sign } = footLook(feet[0], turn);
              const tv = frac(va === 'u' ? vx : vy);
              const drawn = feet[0].h * Math.max(0, Math.min(1, (tv - 0.5) * sign * 2)); // (bridgeFootSpec's rise)
              assert.ok(Math.abs(lift - drawn) < 1e-9, label);
            }
          }
        }
      }
    }
  }
});

/** The highest point (px above its feet) a ship's art reaches, bobbing up as far as it goes. */
function artTop(draw) {
  let top = 0;
  const see = (y) => { top = Math.max(top, -y); };
  const ctx = new Proxy({}, {
    get: (t, k) => {
      if (k === 'moveTo' || k === 'lineTo') return (x, y) => see(y);
      if (k === 'fillRect' || k === 'strokeRect') return (x, y, w, h) => see(Math.min(y, y + h));
      if (k === 'quadraticCurveTo') return (cx, cy, x, y) => { see(cy); see(y); };
      if (k === 'arc') return (x, y, r) => see(y - r);
      if (k === 'ellipse') return (x, y, rx, ry) => see(y - ry);
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      return () => {};
    },
    set: () => true,
  });
  draw(ctx);
  return top;
}

test('bridges: the taller ship bridge clears the masts, ships stay under its deck and people over it at every view turn (playtest: too low for ships)', async () => {
  const { bridgeSpan } = await import('../src/render/renderer.js');
  const { BRIDGE_DECK_Z: Z } = await import('../src/render/terrainArt.js');
  const { drawWalker } = await import('../src/render/walkerArt.js');
  const { drawUnit } = await import('../src/render/militaryArt.js');
  const { viewTileOf } = await import('../src/render/view.js');
  // The highest each reaches over a full swell of its bobbing (the clock t).
  const highest = (draw) => Math.max(...Array.from({ length: 160 }, (_, i) => artTop((ctx) => draw(ctx, i * 0.02))));
  const merchant = highest((ctx, t) => drawWalker(ctx, { id: 0, type: 'ship', kind: 'ship', partner: 'massilia', state: 'toDock', moving: true, anim: 0 }, 0, 0, 1, t, 1, 0, 0));
  const liburnian = highest((ctx, t) => drawUnit(ctx, { id: 0, type: 'liburnian', hp: 180, maxHp: 180, facing: 1, moving: true, walked: 0, strikeTick: -99, hitTick: -99, state: 'sail' }, 0, 0, 1, t, 100, false, 0));
  assert.ok(merchant > 40 && liburnian > 35, `measured: merchant ${merchant}, liburnian ${liburnian}`);
  // Seen over a ship under the middle of a tile, the deck's far parapet
  // (0.3 of a tile back, 4 px high) hides 13.6 px more than the deck's height.
  assert.ok(merchant <= Z + 13.6 && liburnian <= Z + 13.6, `the masts pass under a deck ${Z} px up: merchant ${merchant}, liburnian ${liburnian}`);
  for (const axis of ['u', 'v']) {
    const { map, pt } = bridgeMap(axis, 6);
    for (let turn = 0; turn < 4; turn++) {
      for (let k = 9; k <= 16; k++) {
        const [x, y] = pt(k, 20);
        const [vx, vy] = viewTileOf(x, y, turn, 40, 40);
        const deck = vx + vy + 1 + 0.006; // the deck's (or the foot's) draw depth (renderer.js)
        const walker = bridgeSpan(map, ...pt(k + 0.5, 20.5), false, turn);
        assert.ok(walker.d > deck, `axis ${axis}, turn ${turn}, tile ${k}: people after the deck`);
        if (k === 9 || k === 16) continue; // (no ship on land)
        const ship = bridgeSpan(map, ...pt(k + 0.5, 20.5), true, turn);
        assert.ok(ship.d < deck && ship.lift === 0, `axis ${axis}, turn ${turn}, tile ${k}: a ship before the deck, on the water`);
      }
    }
  }
});

test('bridges: a ramp beside a roadblock starts at the water, a run that turns on the water stays up, a bridge alongside keeps its way, the low bridge ramps to its banks', async () => {
  const { bridgeSpan } = await import('../src/render/renderer.js');
  const { bridgeFeet, bridgeAxis } = await import('../src/render/bridgeProfile.js');
  const { BRIDGE_DECK_Z: Z, LOW_BRIDGE_DECK_Z: LZ } = await import('../src/render/terrainArt.js');
  // A roadblock on the bank's road tile keeps its look: the ramp starts at
  // the water's edge, as steep, and nobody is lifted on the bank.
  {
    const { map, pt } = bridgeMap('v', 6);
    map.roadblock[map.idx(...pt(9, 20))] = 1;
    const lift = (k) => bridgeSpan(map, ...pt(k, 20.5), false, 1).lift;
    assert.deepEqual(bridgeFeet(map, ...pt(9, 20)), []);
    assert.deepEqual([9.75, 10, 10.5, 11, 11.5, 12].map(lift), [0, 0, Z / 3, (2 * Z) / 3, Z, Z]);
    assert.deepEqual([15.5, 16.5].map(lift), [(2 * Z) / 3, 0], 'the far bank keeps its foot');
  }
  // The Imperial road may turn on the water: where the run meets more water
  // there is no bank, and the deck runs on at full height.
  {
    const { map, pt } = bridgeMap('u', 6);
    map.road[map.idx(...pt(16, 20))] = 0;
    map.terrain[map.idx(...pt(16, 20))] = Terrain.WATER;
    assert.equal(bridgeSpan(map, ...pt(15.9, 20.5), false, 0).lift, Z);
    // When the road leaves that last tile sideways onto a bank (the Imperial
    // road turning on its last water tile; review: a 33 px drop off the
    // side), the deck comes down toward that end as at a bank.
    map.road[map.idx(...pt(15, 21))] = Road.ROAD;
    map.terrain[map.idx(...pt(15, 21))] = Terrain.GRASS;
    assert.equal(bridgeSpan(map, ...pt(15.5, 20.5), false, 0).lift, Z / 3);
    assert.equal(bridgeSpan(map, ...pt(15.5, 21.2), false, 0).lift, 0, 'off it onto the side road');
  }
  // Two bridges side by side: each keeps its own way, and a road on the
  // bank beside the first tile no longer turns it across the river.
  {
    const { map, pt } = bridgeMap('u', 6);
    for (let k = 9; k <= 16; k++) map.road[map.idx(...pt(k, 21))] = map.road[map.idx(...pt(k, 20))];
    map.road[map.idx(...pt(9, 19))] = Road.ROAD;
    for (let k = 10; k <= 15; k++) assert.equal(bridgeAxis(map, ...pt(k, 20)), 'u', `tile ${k}`);
    assert.equal(bridgeSpan(map, ...pt(10.5, 20.5), false, 0).lift, (2 * Z) / 3);
    assert.equal(bridgeSpan(map, ...pt(9.5, 21.5), false, 0).lift, 0);
  }
  // The low bridge climbs to its deck over half a tile of water, and a one-tile one humps in the middle.
  for (const [n, expect] of [[4, [[10, 0], [10.25, LZ / 2], [10.5, LZ], [12, LZ], [13.75, LZ / 2], [9.5, 0], [14.5, 0]]], [1, [[10, 0], [10.25, LZ / 2], [10.5, LZ], [10.75, LZ / 2]]]]) {
    const { map, pt } = bridgeMap('u', n, true);
    for (const [k, h] of expect) assert.equal(bridgeSpan(map, ...pt(k, 20.5), false, 2).lift, h, `${n} tiles, at ${k}`);
  }
});

test('bridges: every piece of the bridges\' art draws at the heights the ramps give it, in sprites tall enough to hold it', async () => {
  const { bridgeSpec, bridgeFootSpec, lowBridgeSpec, BRIDGE_DECK_Z: Z, LOW_BRIDGE_DECK_Z: LZ } = await import('../src/render/terrainArt.js');
  const { recordingContext } = await import('../src/render/draw.js');
  const specs = [];
  for (const axis of ['u', 'v']) {
    for (const h of [[Z, Z, Z], [Z / 3, (2 * Z) / 3, Z], [Z, (2 * Z) / 3, Z / 3], [0, Z / 3, (2 * Z) / 3], [Z / 3, (2 * Z) / 3, Z / 3]]) {
      for (const abut of [false, true]) for (const snow of [0, 1]) specs.push([bridgeSpec(axis, ...h, abut, snow), Math.max(...h)]);
    }
    for (const sign of [1, -1]) specs.push([bridgeFootSpec(axis, sign, Z / 3, 0.5), Z / 3]);
    for (const h of [[LZ, LZ, LZ], [0, LZ, LZ], [0, LZ, 0]]) specs.push([lowBridgeSpec(axis, ...h), LZ]);
  }
  for (const [spec, top] of specs) {
    assert.ok(spec.w > 0 && spec.ay >= top + 4 && spec.h - spec.ay >= 32, 'room above the tile for the deck and its parapets');
    spec.draw(recordingContext().ctx);
  }
});

test('bridges: a ship under the deck is cut off at the far parapet, so no mast sticks up through a ramp (review: masts over the banks\' ramps)', async () => {
  const { mastClip } = await import('../src/render/bridgeProfile.js');
  const { BRIDGE_DECK_Z: Z } = await import('../src/render/terrainArt.js');
  const { toView } = await import('../src/render/view.js');
  const MAST = 46; // a merchantman's, pennant and swell included (measured above)
  for (const axis of ['u', 'v']) {
    const { map, pt } = bridgeMap(axis, 6);
    for (let turn = 0; turn < 4; turn++) {
      const at = (k, j) => {
        const [fx, fy] = pt(k, j);
        const [vx, vy] = toView(fx, fy, turn, 40, 40);
        const line = mastClip(map, fx, fy, turn);
        if (!line) return { ground: (vx + vy) * 16, clip: null };
        // The line's height at the ship's own screen column (the mast's).
        const x = (vx - vy) * 32;
        const n = line.findIndex((p) => p.x >= x);
        assert.ok(n > 0 && line.every((p, i) => !i || p.x > line[i - 1].x), 'the line runs left to right across the ship');
        const [a, b] = [line[n - 1], line[n]];
        return { ground: (vx + vy) * 16, clip: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) };
      };
      const label = `axis ${axis}, turn ${turn}`;
      // Under the first (ramp) tile, crossing the bridge: the top is cut under the parapet.
      const ramp = at(10.5, 20.5);
      assert.ok(ramp.clip !== null && ramp.ground - MAST < ramp.clip, `${label}: a mast over the ramp is cut`);
      assert.ok(ramp.ground - ramp.clip >= 2 * Z / 3 - 1, `${label}: not lower than the ramp over it`);
      // Under the middle of the deck it is cut at the deck over it (the deck's far half hides the rest anyway).
      const deck = at(12.5, 20.5);
      assert.ok(Math.abs(deck.ground - deck.clip - (Z + 4)) < 1e-9, `${label}: cut at the full deck, parapet included`);
      // Not yet under the deck (coming in past its far side), off the bridge, or a low bridge: not cut.
      // (Which edge of the tile is the far side depends on the turn.)
      assert.ok([at(12.5, 20.05), at(12.5, 20.95)].some((p) => p.clip === null), `${label}: a ship behind the deck is whole`);
      assert.equal(at(8.5, 20.5).clip, null);
    }
  }
  const { map, pt } = bridgeMap('u', 4, true);
  assert.equal(mastClip(map, ...pt(11.5, 20.5), 0), null, 'no boat passes a low bridge');
});

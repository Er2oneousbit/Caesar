/**
 * trade.test.mjs - headless tests for trade by land and sea (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Covers navigable water detection, dock placement rules, sea routes being
 * refused where ships cannot come, ships unloading at a dock and buying
 * exports from nearby warehouses, dock workers carting imports to storage,
 * caravans leaving with packs of what they bought, and the scenario data staying consistent (no sea partner on a map without
 * sea access).
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { Game } from '../src/core/game.js';
import { generateMap } from '../src/world/mapgen.js';
import { SCENARIOS, TRADE_PARTNERS } from '../src/data/scenarios.js';
import { addBuilding, spawnWalker } from '../src/sim/entities.js';
import { planAction } from '../src/sim/construction.js';
import { openRoute, setTradeMode, tradeAtDock, updateDock, dockBerth, routeKind, caravanArrive, caravanPacks } from '../src/sim/trade.js';
import { updateWalkers } from '../src/sim/walkers.js';
import { buildDemoCity, buildDemoHarbor } from '../src/dev/demoCity.js';
import { newGame, build, findFree } from './helpers.mjs';

log.setLevel('error');

/** First 3x3 spot (top-left) where a dock is allowed, nearest to `from`. */
function dockSpot(game, from) {
  const { map } = game;
  let best = null;
  for (let y = 1; y < map.h - 4; y++) {
    for (let x = 1; x < map.w - 4; x++) {
      const plan = planAction(game, 'dock', x + 1, y + 1, x + 1, y + 1);
      if (!plan.count) continue;
      const d = from ? Math.hypot(x - from.x, y - from.y) : 0;
      if (!best || d < best.d) best = { x, y, d };
      if (!from) return best;
    }
  }
  return best;
}

test('river and coast maps have navigable water that reaches the map edge', () => {
  for (const type of ['river', 'coast']) {
    for (const seed of ['a', 'b', 'c']) {
      const { map } = generateMap({ width: 64, height: 64, seed, type });
      map.computeNavigation();
      assert.ok(map.seaEntry, `${type}/${seed} has a sea entry`);
      const e = map.seaEntry;
      assert.ok(e.x === 0 || e.y === 0 || e.x === 63 || e.y === 63, 'entry on the edge');
      assert.equal(map.navigable[map.idx(e.x, e.y)], 1);
    }
  }
});

test('docks must touch navigable water', () => {
  const game = newGame({ type: 'coast', seed: 'beach' });
  const inland = findFree(game, 3, 3);
  const bad = planAction(game, 'dock', inland.x + 1, inland.y + 1, inland.x + 1, inland.y + 1);
  if (game.map.navigableBeside(inland.x, inland.y, 3) < 0) {
    assert.equal(bad.count, 0);
    assert.match(bad.reason, /bank|sea/i);
  }
  const spot = dockSpot(game);
  assert.ok(spot, 'a shore spot exists');
  const d = addBuilding(game, 'dock', spot.x, spot.y);
  assert.ok(dockBerth(game, d) >= 0, 'dock has a berth');
  assert.ok([0, 1, 2, 3].includes(d.waterSide), 'water side known for the art');
});

test('sea routes are refused where ships cannot come; land routes still work', () => {
  // Find a plains map without sea access.
  let game = null;
  for (const seed of ['b', 'd', 'x1', 'x2', 'x3']) {
    const g = newGame({ type: 'plains', seed });
    if (!g.map.seaEntry) { game = g; break; }
  }
  assert.ok(game, 'found a land-locked map');
  const sea = openRoute(game, 'massilia');
  assert.equal(sea.ok, false);
  assert.match(sea.reason, /sea/);
  assert.equal(planAction(game, 'dock', 10, 10, 10, 10).count, 0);
  assert.ok(openRoute(game, 'tarraco').ok, 'land route opens');
});

test('a ship trades at the dock: imports onto the quay, exports from nearby warehouses', () => {
  const game = newGame({ type: 'coast', seed: 'beach' });
  const res = buildDemoCity(game, { level: 1 });
  assert.ok(res.ok, res.reason);
  const harbor = buildDemoHarbor(game, res.center);
  assert.ok(harbor.ok && harbor.dock && harbor.warehouse, 'dock and warehouse built');
  const { dock, warehouse: wh } = harbor;
  assert.ok(dock.accessRoad >= 0 && wh.accessRoad >= 0, 'both on the road');
  dock.efficiency = 1;
  wh.efficiency = 1;
  for (const k of Object.keys(wh.stock)) wh.stock[k] = 0;
  wh.stock.pottery = 800;
  setTradeMode(game, 'pottery', 'export', 0);
  setTradeMode(game, 'wine', 'import', 600);
  setTradeMode(game, 'fruit', 'none');
  const before = game.city.treasury;
  const out = tradeAtDock(game, 'massilia', dock);
  assert.ok(out.sold.pottery > 0, 'exported pottery from the warehouse');
  assert.equal(out.bought.wine, 600, 'imported wine');
  assert.equal(dock.stock.wine, 600, 'wine waits on the quay');
  assert.equal(wh.stock.pottery, 800 - out.sold.pottery);
  assert.equal(game.city.treasury, before + out.earned - out.spent);
  // Dock workers cart the wine to storage (the warehouse, the nearest place with room).
  for (let day = 0; day < 8 && dock.stock.wine > 0; day++) {
    updateDock(game, dock);
    for (let t = 0; t < CONFIG.TICKS_PER_DAY * 3; t++) updateWalkers(game);
  }
  for (let t = 0; t < CONFIG.TICKS_PER_DAY * 8; t++) updateWalkers(game);
  assert.equal(dock.stock.wine, 0, 'quay emptied');
  assert.equal(wh.stock.wine, 600, 'wine reached the warehouse');
});

test('a caravan leaves with packs of what it bought, biggest lot first (for the art)', () => {
  assert.deepEqual(caravanPacks({ wine: 200, oil: 100, marble: 300 }), ['marble', 'wine'], 'two biggest lots');
  assert.deepEqual(caravanPacks({ wheat: 0 }), [], 'nothing bought');
  assert.deepEqual(caravanPacks(undefined), []);

  const game = newGame({ type: 'coast', seed: 'beach' });
  const res = buildDemoCity(game, { level: 1 });
  assert.ok(res.ok, res.reason);
  const { warehouse: wh } = buildDemoHarbor(game, res.center);
  assert.ok(wh && wh.accessRoad >= 0, 'a warehouse on the road');
  wh.efficiency = 1;
  const partner = Object.keys(game.city.trade.routes).find((id) => routeKind(id) === 'land' && Object.keys(TRADE_PARTNERS[id].buys).length >= 2);
  assert.ok(partner, 'a land partner that buys two goods');
  const [small, big] = Object.keys(TRADE_PARTNERS[partner].buys);
  for (const k of Object.keys(wh.stock)) wh.stock[k] = 0;
  wh.stock[small] = 200;
  wh.stock[big] = 400;
  for (const g of Object.keys(game.city.trade.settings)) setTradeMode(game, g, 'none');
  setTradeMode(game, small, 'export', 0);
  setTradeMode(game, big, 'export', 0);
  const arrive = () => {
    const w = spawnWalker(game, 'caravan', wh.accessRoad, null, { partner, target: wh.id, state: 'toWarehouse' });
    assert.equal(w.packs, undefined, 'coming in: plain bales');
    caravanArrive(game, w);
    return w;
  };
  assert.deepEqual(arrive().packs, [big, small], 'leaves loaded with what it bought');
  assert.deepEqual(arrive().packs, [], 'the next one finds nothing left to buy');
});

test('merchant ships sail in, trade and leave (full simulation)', () => {
  const game = newGame({ type: 'coast', seed: 'beach' });
  const res = buildDemoCity(game, { level: 2 });
  assert.ok(res.ok, res.reason);
  game.runDays(16 * 6);
  const harbor = buildDemoHarbor(game, res.center);
  assert.ok(harbor.ok && harbor.dock, 'harbor built');
  assert.ok(harbor.routes.length >= 1, 'sea routes opened');
  let sawShip = false;
  for (let d = 0; d < 120 && !game.city.trade.log.some((e) => e.kind === 'sea'); d++) {
    game.runDays(1);
    if ([...game.walkers.values()].some((w) => w.type === 'ship')) sawShip = true;
  }
  assert.ok(sawShip, 'a ship appeared');
  const entry = game.city.trade.log.find((e) => e.kind === 'sea');
  assert.ok(entry, 'a ship traded');
  assert.ok(entry.spent > 0 || entry.earned > 0);
  // Ships leave again.
  game.runDays(40);
  const ships = [...game.walkers.values()].filter((w) => w.type === 'ship');
  assert.ok(ships.every((w) => w.state !== 'docked' || game.buildings.get(w.target)), 'no ship stuck at a vanished dock');
});

test('scenario partners match their maps (no unreachable sea partners)', () => {
  for (const s of SCENARIOS) {
    const g = new Game({ scenario: s, flags: {} });
    for (const id of s.partners) {
      assert.ok(TRADE_PARTNERS[id], `${s.id}: partner ${id} exists`);
      if (routeKind(id) === 'sea') assert.ok(g.map.seaEntry, `${s.id}: sea partner ${id} needs sea access`);
    }
    if (s.partners.some((id) => routeKind(id) === 'sea')) {
      assert.ok(s.unlocks === 'all' || s.unlocks.includes('dock'), `${s.id}: dock unlocked for its sea partners`);
    }
  }
});

test('every trade partner has a route type, map position and color', () => {
  for (const [id, p] of Object.entries(TRADE_PARTNERS)) {
    assert.ok(p.route === 'land' || p.route === 'sea', `${id} route`);
    assert.ok(Array.isArray(p.pos) && p.pos[0] >= 0 && p.pos[0] <= 100 && p.pos[1] >= 0 && p.pos[1] <= 60, `${id} pos`);
    assert.match(p.color, /^#[0-9a-f]{6}$/i, `${id} color`);
    assert.ok(Object.keys(p.sells).length && Object.keys(p.buys).length, `${id} trades something`);
  }
});

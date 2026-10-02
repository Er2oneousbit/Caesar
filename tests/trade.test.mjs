/**
 * trade.test.mjs - headless tests for trade by land and sea (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Covers navigable water detection, dock placement rules, sea routes being
 * refused where ships cannot come, a ship waiting at a demo city's dock
 * while its imports land and go to storage and its exports are fetched,
 * caravans leaving with packs of what they bought, and the scenario data
 * staying consistent (no sea partner on a map without sea access). The
 * rules of a ship's stay at the dock are in dock.test.mjs.
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
import { GOODS } from '../src/data/goods.js';
import { planAction } from '../src/sim/construction.js';
import { openRoute, setTradeMode, shipArrive, dockBerth, routeKind, caravanArrive, caravanPacks, updateTrade, shipsWaiting, shipsWaitingText } from '../src/sim/trade.js';
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

test('a ship waits at the dock: imports land on the quay and go to storage, exports come from a warehouse near it', () => {
  const game = newGame({ type: 'coast', seed: 'beach' });
  const res = buildDemoCity(game, { level: 2 });
  assert.ok(res.ok, res.reason);
  game.runDays(16 * 6); // people to staff the harbor
  const harbor = buildDemoHarbor(game, res.center);
  assert.ok(harbor.ok && harbor.dock && harbor.warehouse, 'dock and warehouse built');
  const { dock, warehouse: wh } = harbor;
  assert.ok(dock.accessRoad >= 0 && wh.accessRoad >= 0, 'both on the road');
  for (const r of Object.values(game.city.trade.routes)) r.nextVisit = 1e9; // only the ship sent below
  for (const k of Object.keys(wh.stock)) wh.stock[k] = 0;
  wh.stock.pottery = 800;
  setTradeMode(game, 'pottery', 'export', 0);
  setTradeMode(game, 'wine', 'import', 600);
  setTradeMode(game, 'fruit', 'none');
  for (let d = 0; d < 40 && !(dock.efficiency >= 0.75 && wh.efficiency > 0); d++) game.runDays(1);
  assert.ok(dock.efficiency >= 0.75 && wh.efficiency > 0, 'the city staffs the dock and the warehouse');
  const ship = spawnWalker(game, 'ship', dockBerth(game, dock), null, { partner: 'massilia', target: dock.id, state: 'toDock', speed: CONFIG.SHIP_SPEED });
  dock.shipId = ship.id;
  const before = game.city.treasury;
  shipArrive(game, ship);
  assert.equal(ship.state, 'docked');
  assert.deepEqual(ship.unload, { wine: 600 }, 'it brings the wine you import');
  assert.deepEqual(ship.wants, { pottery: 600 }, 'and wants the pottery you export, up to Massilia\'s 600 a year');
  assert.equal(game.city.treasury, before, 'nothing changes hands on arrival');
  for (let d = 0; d < CONFIG.SHIP_MAX_STAY_DAYS + 1 && ship.state === 'docked'; d++) game.runDays(1);
  assert.notEqual(ship.state, 'docked', 'it sailed');
  assert.equal(ship.deal.sold.pottery, 600, 'pottery went aboard');
  assert.equal(ship.deal.bought.wine, 600, 'wine landed');
  assert.equal(wh.stock.pottery, 200);
  const entry = game.city.trade.log[0];
  assert.ok(entry && entry.kind === 'sea' && entry.earned === ship.deal.earned && entry.spent === ship.deal.spent, 'one log entry when it sailed');
  // Dock workers cart the wine to storage (the warehouse, the nearest place with room).
  game.runDays(16);
  assert.equal(dock.stock.wine, 0, 'quay emptied');
  assert.ok(wh.stock.wine > 0, 'wine reached the warehouse');
});

test('a ship that finds every Emporium taken waits offshore, and the dock and the Trade advisor say so', () => {
  // A stay lasts weeks, so a city with several sea partners needs more than
  // one Emporium; the player was never told ships were being turned away.
  const game = newGame({ type: 'coast', seed: 'beach' });
  const res = buildDemoCity(game, { level: 2 });
  assert.ok(res.ok, res.reason);
  game.runDays(16 * 6);
  const { dock } = buildDemoHarbor(game, res.center);
  assert.ok(dock, 'a dock');
  for (const r of Object.values(game.city.trade.routes)) r.nextVisit = 1e9;
  for (let d = 0; d < 40 && !(dock.efficiency > 0); d++) game.runDays(1);
  assert.ok(dock.efficiency > 0, 'staffed');
  const sea = Object.keys(game.city.trade.routes).filter((id) => routeKind(id) === 'sea');
  const [a, b] = sea;
  for (const id of [a, b]) game.city.trade.routes[id].open = true;
  // The Emporium is taken by a's ship; b's comes due.
  const ship = spawnWalker(game, 'ship', dockBerth(game, dock), null, { partner: a, target: dock.id, state: 'toDock', speed: CONFIG.SHIP_SPEED });
  dock.shipId = ship.id;
  const route = game.city.trade.routes[b];
  route.nextVisit = game.time.totalDays;
  updateTrade(game);
  assert.equal(route.waiting, true);
  assert.equal(route.nextVisit, game.time.totalDays + 6, 'it tries again in 6 days');
  assert.deepEqual(shipsWaiting(game), [TRADE_PARTNERS[b].name]);
  assert.match(shipsWaitingText(game), new RegExp(`A ship from ${TRADE_PARTNERS[b].name} is waiting offshore for a free Emporium`));
  // The Emporium frees up: the waiting ship ties up and the notice goes.
  dock.shipId = 0;
  route.nextVisit = game.time.totalDays;
  updateTrade(game);
  assert.equal(route.waiting, undefined);
  assert.equal(shipsWaitingText(game), null);
  // No staffed Emporium at all is not "waiting" (the route card says why).
  dock.efficiency = 0;
  dock.shipId = 0;
  for (const w of [...game.walkers.values()]) if (w.type === 'ship') game.walkers.delete(w.id);
  route.nextVisit = game.time.totalDays;
  updateTrade(game);
  assert.equal(route.waiting, undefined);
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

test("a caravan's panel lists what it comes for, then what it bought and sold here", async () => {
  const { walkerInfo } = await import('../src/ui/walkerTalk.js');
  const game = newGame({ type: 'coast', seed: 'beach' });
  const res = buildDemoCity(game, { level: 1 });
  assert.ok(res.ok, res.reason);
  const { warehouse: wh } = buildDemoHarbor(game, res.center);
  wh.efficiency = 1;
  const partner = Object.keys(game.city.trade.routes).find((id) => routeKind(id) === 'land' && Object.keys(TRADE_PARTNERS[id].buys).length >= 1 && Object.keys(TRADE_PARTNERS[id].sells).length >= 1);
  const good = Object.keys(TRADE_PARTNERS[partner].buys)[0];
  const imp = Object.keys(TRADE_PARTNERS[partner].sells)[0];
  for (const k of Object.keys(wh.stock)) wh.stock[k] = 0;
  wh.stock[good] = 300;
  for (const g of Object.keys(game.city.trade.settings)) setTradeMode(game, g, 'none');
  setTradeMode(game, good, 'export', 0);
  setTradeMode(game, imp, 'import', 200);
  wh.orders[imp] = 'accept';
  game.city.treasury = 10000;
  const w = spawnWalker(game, 'caravan', wh.accessRoad, null, { partner, target: wh.id, state: 'toWarehouse' });
  const row = (label) => walkerInfo(game, w).rows.find(([k]) => k === label)?.[1];
  const name = (g) => GOODS[g].name.toLowerCase();
  assert.match(row('Comes to buy'), new RegExp(name(good)), 'on its way: what it wants that you export');
  assert.match(row('Comes to sell'), new RegExp(name(imp)));
  caravanArrive(game, w);
  assert.match(row('Bought here'), /^\d+ [a-z]+ \(you earned \d+ Dn\)$/, row('Bought here'));
  assert.ok(row('Bought here').startsWith(`300 ${name(good)} `), row('Bought here'));
  assert.match(row('Sold here'), /^\d+ [a-z]+ \(you paid \d+ Dn\)$/, row('Sold here'));
  assert.ok(row('Sold here').startsWith(`200 ${name(imp)} `), row('Sold here'));
  assert.equal(row('Comes to buy'), undefined, 'after trading it says what it did');
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

test('ships come at the original pace; on Insane, half as many traders in winter', async () => {
  const { updateTrade } = await import('../src/sim/trade.js');
  const { DIFFICULTY } = await import('../src/data/difficulty.js');
  assert.ok(CONFIG.SHIP_INTERVAL_DAYS[0] >= 2 * CONFIG.CARAVAN_INTERVAL_DAYS[0] - 1, 'ships half as often as caravans');
  // Every partner's yearly trade fits in its traders at their average pace: a
  // busy route's come more often (sim/tradeDemand.js), so Delos's 8,000 a
  // year by sea fits as Capua's 2,600 by land does.
  const { visitsPerYear, routeVolume } = await import('../src/sim/tradeDemand.js');
  for (const [id, p] of Object.entries(TRADE_PARTNERS)) {
    const kind = routeKind(id);
    const most = routeVolume(p.buys, p.sells);
    const carry = (kind === 'sea' ? CONFIG.SHIP_MAX_TRADE : CONFIG.CARAVAN_MAX_TRADE) * visitsPerYear(kind, most);
    assert.ok(carry >= most * 0.99, `${id}: ${most} a year, ${Math.round(carry)} carried`);
  }
  assert.ok(CONFIG.DOCK_CAPACITY >= CONFIG.SHIP_MAX_TRADE, 'a dock holds a whole ship');
  // Insane's winter: the wait runs at half speed; Normal's does not.
  assert.equal(DIFFICULTY.insane.winterTrade, 2);
  for (const [diff, slowed] of [['normal', false], ['insane', true]]) {
    const game = newGame({ difficulty: diff });
    const id = Object.keys(game.city.trade.routes).find((k) => routeKind(k) === 'land');
    game.city.trade.routes[id].open = true;
    game.time.month = 0; // Ianuarius
    game.city.trade.routes[id].nextVisit = game.time.totalDays + 10;
    const due = game.city.trade.routes[id].nextVisit;
    for (let d = 0; d < 6; d++) { updateTrade(game); game.time.totalDays++; }
    const pushed = game.city.trade.routes[id].nextVisit - due;
    if (slowed) assert.equal(pushed, 3, 'six winter days count as three'); else assert.equal(pushed, 0);
  }
});

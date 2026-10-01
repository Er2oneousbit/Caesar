/**
 * dock.test.mjs - headless tests for a ship's stay at the dock (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Covers sim/trade.js's moored ship and the Dock's workers: how many workers
 * a Dock fields by staffing, a full exchange's length at two distances (and
 * with one worker), payment as imports land and as exports are handed over,
 * claims keeping every good at its export level (two ships at once
 * included), the 48-day limit and the "do not set out" rule, a Dock losing
 * its staff or demolished mid-visit with no goods lost, a ship with nothing
 * to trade sailing at once, quotas and the per-visit limit, storage orders
 * for imports (and none for exports), the panels' words, and saves: a real
 * version 7 save with a ship moored and wine on the quay, and a version 8
 * save made mid-visit that plays on exactly as the city it came from.
 *
 * The Dock sits on a straight desert road (no water: these tests moor the
 * ship by hand, and with no sea entry a ship that casts off simply leaves
 * the map), so road distances are plain differences in x. The clock is
 * driven by hand: walkers every tick, the Dock's daily update on its phase.
 * Staffing is set directly (no homes or labor needed).
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { GOODS } from '../src/data/goods.js';
import { TRADE_PARTNERS } from '../src/data/scenarios.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { addBuilding, spawnWalker, removeBuilding, killWalker } from '../src/sim/entities.js';
import { updateWalkers } from '../src/sim/walkers.js';
import { cityStock } from '../src/sim/storage.js';
import { setEmptying, setOrder } from '../src/sim/storageOrders.js';
import {
  setTradeMode, shipArrive, updateDock, dockWorkers, dockUsed, shipManifest, exportClaims, mooredShip, stayTicksLeft,
} from '../src/sim/trade.js';
import { dockRows, dockShipText, dockHint } from '../src/ui/dockInfo.js';
import { walkerInfo, walkerDoing } from '../src/ui/walkerTalk.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { newGame, build, findFree } from './helpers.mjs';

log.setLevel('error');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TPD = CONFIG.TICKS_PER_DAY;
/** Carthago sells fruit, grapes and furniture and buys weapons, marble and timber: 2,400 each way fits its quotas. */
const PARTNER = 'carthago';

/**
 * A desert map with a straight road 64 tiles long and a staffed Dock above
 * its left end. `wh(dx)` puts a staffed, empty warehouse above the road dx
 * tiles along: dx road tiles from the Dock.
 */
function harbor({ staff = 1 } = {}) {
  const game = newGame({ type: 'desert', size: 96, seed: 'harbor' });
  const spot = findFree(game, 70, 4);
  assert.ok(spot, 'a free strip of land');
  const ry = spot.y + 3;
  assert.ok(build(game, 'road', spot.x, ry, spot.x + 69, ry).ok, 'road laid');
  const place = (dx, type) => {
    const b = addBuilding(game, type, spot.x + dx, ry - BUILDINGS[type].size);
    assert.ok(b.accessRoad >= 0, `${type} at +${dx} touches the road`);
    assert.equal(b.accessRoad, game.map.idx(spot.x + dx, ry), 'its road is the tile below its corner');
    b.efficiency = 1;
    if (b.stock) for (const k of Object.keys(b.stock)) b.stock[k] = 0;
    return b;
  };
  const dock = place(0, 'dock');
  dock.efficiency = staff;
  for (const g of Object.keys(game.city.trade.settings)) setTradeMode(game, g, 'none');
  game.city.trade.routes[PARTNER].open = true;
  game.city.trade.routes[PARTNER].nextVisit = 1e9; // no ship comes on its own
  return { game, dock, wh: (dx) => place(dx, 'warehouse'), place };
}

/**
 * Alexandria's full exchange, in whole wagons: 2,400 wheat to sell (6 lots
 * of 400) and 2,400 of exports ready in `wh` (wine 800, oil 800, weapons 400,
 * furniture 400: 6 lots), the spec's worked example.
 */
function evenExchange(game, wh) {
  game.city.trade.routes.alexandria.open = true;
  Object.assign(wh.stock, { wine: 800, oil: 800, weapons: 400, furniture: 400 });
  wh.orders.wheat = 'accept';
  for (const g of ['wine', 'oil', 'weapons', 'furniture']) setTradeMode(game, g, 'export', 0);
  setTradeMode(game, 'wheat', 'import', 3200);
}

/** A ship of `partner` ties up at the dock now. */
function moor(game, dock, partner = PARTNER) {
  const ship = spawnWalker(game, 'ship', dock.accessRoad, null, { partner, target: dock.id, state: 'toDock' });
  dock.shipId = ship.id;
  shipArrive(game, ship);
  return ship;
}

/** One tick: walkers, then each dock's daily update on its phase. */
function tick(game, docks) {
  game.time.advance();
  updateWalkers(game);
  for (const d of docks) if (game.time.tick === d.phase && game.buildings.has(d.id)) updateDock(game, d);
}

/** Run until the ship has sailed (or `maxDays`): @returns days it stayed. */
function stay(game, docks, ship, maxDays = 60) {
  const t0 = game.time.totalTicks;
  for (let t = 0; t < maxDays * TPD && ship.state === 'docked'; t++) tick(game, docks);
  return (game.time.totalTicks - t0) / TPD;
}

/** Carthago's full exchange: 2,400 of imports wanted (fruit and grapes) and 2,400 of exports ready in `wh`. */
function fullExchange(game, wh) {
  wh.stock.weapons = 800;
  wh.stock.marble = 600;
  wh.stock.timber = 1000;
  wh.orders.fruit = 'accept';
  for (const g of ['weapons', 'marble', 'timber']) setTradeMode(game, g, 'export', 0);
  for (const g of ['fruit', 'grapes']) setTradeMode(game, g, 'import', 3200);
}

const carts = (game) => [...game.walkers.values()].filter((w) => w.type === 'cart');
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------
// Workers and timing
// ---------------------------------------------------------------------------

test('a Dock fields 1 to 3 dock workers by staffing, and never has more out', () => {
  const table = [[0, 0], [0.1, 1], [0.4, 1], [0.5, 2], [0.7, 2], [0.8, 3], [1, 3]];
  for (const [e, n] of table) assert.equal(dockWorkers({ efficiency: e }), n, `staffing ${e}`);
  // Half staffed: two workers, however much there is to do.
  const { game, dock, wh } = harbor({ staff: 0.5 });
  fullExchange(game, wh(10));
  const ship = moor(game, dock);
  let most = 0;
  for (let t = 0; t < 30 * TPD && ship.state === 'docked'; t++) {
    tick(game, [dock]);
    most = Math.max(most, carts(game).filter((c) => c.origin === dock.id).length);
  }
  assert.equal(most, 2, 'two dock workers out at the busiest');
});

test('a full exchange takes about the original\'s time: 18 days at 5 road tiles, 25 at 10', () => {
  for (const [dx, days] of [[5, 18], [10, 25]]) {
    const { game, dock, wh } = harbor();
    const w = wh(dx);
    evenExchange(game, w);
    const before = game.city.treasury;
    const ship = moor(game, dock, 'alexandria');
    assert.deepEqual(ship.unload, { wheat: 2400 }, 'the manifest: 2,400 to sell');
    assert.deepEqual(ship.wants, { wine: 800, oil: 800, weapons: 400, furniture: 400 }, '2,400 to buy');
    const d = stay(game, [dock], ship);
    assert.ok(Math.abs(d - days) <= 1.5, `${dx} tiles: stayed ${d} days, about ${days}`);
    assert.equal(sum(ship.deal.bought), 2400, 'all 2,400 imports landed');
    assert.equal(sum(ship.deal.sold), 2400, 'all 2,400 exports went aboard');
    const money = ship.deal.earned - ship.deal.spent;
    assert.equal(game.city.treasury, before + money, 'the money each way, nothing else');
    // One entry in the trade log, when it sailed, with the totals.
    const logged = game.city.trade.log;
    assert.equal(logged.length, 1);
    assert.deepEqual(logged[0].sold, { wine: 800, oil: 800, weapons: 400, furniture: 400 });
    assert.deepEqual(logged[0].bought, { wheat: 2400 });
    assert.equal(logged[0].earned, ship.deal.earned);
    assert.equal(logged[0].spent, ship.deal.spent);
    // The goods book counted each good once.
    assert.equal(game.city.goodsFlow.wheat.imported, 2400);
    assert.equal(game.city.goodsFlow.oil.exported, 800);
    // What is left on the quay is carted to storage afterwards; nothing is lost.
    for (let t = 0; t < 30 * TPD; t++) tick(game, [dock]);
    assert.equal(dockUsed(dock), 0, 'quay cleared');
    assert.equal(w.stock.wheat, 2400, 'every import in the warehouse');
  }
});

test('a full exchange in odd lots needs a third round, and one dock worker still finishes (no idle cut-off)', () => {
  // Carthago's 2,400 of exports split into 7 lots (weapons 800, marble 600,
  // timber 1,000): three workers need a third trip for the last one.
  const three = harbor();
  fullExchange(three.game, three.wh(10));
  let ship = moor(three.game, three.dock);
  assert.deepEqual(ship.unload, { fruit: 1500, grapes: 900 }, 'the manifest: 2,400 to sell, in the partner\'s order');
  assert.deepEqual(ship.wants, { weapons: 800, marble: 600, timber: 1000 }, '2,400 to buy');
  let d = stay(three.game, [three.dock], ship);
  assert.equal(sum(ship.deal.sold), 2400);
  assert.ok(d > 30 && d < CONFIG.SHIP_MAX_STAY_DAYS, `three workers, 7 lots at 10 tiles: ${d} days`);
  // One worker, 5 tiles: every trip carries one lot, and none is cut short.
  const one = harbor({ staff: 0.3 });
  evenExchange(one.game, one.wh(5));
  ship = moor(one.game, one.dock, 'alexandria');
  d = stay(one.game, [one.dock], ship);
  assert.equal(sum(ship.deal.sold), 2400);
  assert.equal(sum(ship.deal.bought), 2400);
  assert.ok(d > 26 && d < CONFIG.SHIP_MAX_STAY_DAYS, `one worker: ${d} days, longer than three take but within the limit`);
});

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

test('imports are paid as each lot lands on the quay, exports as each lot goes aboard', () => {
  const { game, dock, wh } = harbor();
  const w = wh(10);
  w.stock.timber = 400;
  setTradeMode(game, 'timber', 'export', 0);
  setTradeMode(game, 'furniture', 'import', 800);
  const t0 = game.city.treasury;
  const ship = moor(game, dock);
  assert.deepEqual(ship.unload, { furniture: 500 }, 'Carthago sells 500 furniture a year');
  assert.equal(game.city.treasury, t0, 'nothing paid on arrival');
  const route = game.city.trade.routes[PARTNER];
  // The first lot (400) lands after DOCK_UNLOAD_DAYS.
  for (let t = 0; t < CONFIG.DOCK_UNLOAD_DAYS * TPD - 1; t++) tick(game, [dock]);
  assert.equal(ship.deal.bought.furniture, undefined, 'not landed yet');
  tick(game, [dock]);
  assert.equal(ship.deal.bought.furniture, 400, 'a lot of 400 landed on day 3');
  assert.equal(dock.stock.furniture + carts(game).filter((c) => c.cargo?.good === 'furniture').reduce((n, c) => n + c.cargo.amount, 0), 400, 'on the quay, or already on a free worker\'s cart');
  const furniture = (GOODS.furniture.buy * 400) / 100;
  assert.equal(game.city.treasury, t0 - furniture, 'paid as it landed');
  assert.equal(route.bought.furniture, 400, 'the quota counts it');
  // The timber was picked up at the warehouse, but is not paid for until it is aboard.
  const fetcher = carts(game).find((c) => c.claim);
  assert.ok(fetcher, 'a worker is out for the timber');
  for (let t = 0; t < 30 * TPD && !fetcher.cargo; t++) tick(game, [dock]);
  assert.equal(w.stock.timber, 0, 'taken from the warehouse');
  assert.equal(route.sold.timber || 0, 0, 'not sold yet');
  assert.equal(ship.deal.earned, 0);
  for (let t = 0; t < 30 * TPD && !fetcher.dead; t++) tick(game, [dock]);
  assert.equal(route.sold.timber, 400, 'sold as it went aboard');
  assert.equal(ship.deal.earned, (GOODS.timber.sell * 400) / 100);
  assert.equal(game.city.treasury, t0 - ship.deal.spent + ship.deal.earned);
});

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

test('claims: three workers never take a good below its export level', () => {
  const { game, dock, wh } = harbor();
  const a = wh(6);
  const b = wh(12);
  a.stock.weapons = 300;
  b.stock.weapons = 500;
  setTradeMode(game, 'weapons', 'export', 300); // 500 to spare
  const ship = moor(game, dock);
  assert.deepEqual(ship.wants, { weapons: 500 });
  const out = exportClaims(game).byShip.get(ship.id);
  assert.equal(out.weapons, 500, 'two workers set out for 500 between them, the third stays home');
  assert.equal(carts(game).length, 2);
  let low = Infinity;
  for (let t = 0; t < 40 * TPD && ship.state === 'docked'; t++) {
    tick(game, [dock]);
    low = Math.min(low, cityStock(game, 'weapons'));
  }
  assert.equal(ship.deal.sold.weapons, 500);
  assert.equal(low, 300, 'never below the export level');
  assert.equal(cityStock(game, 'weapons'), 300);
});

test('claims: two ships at two docks share the surplus, never more', () => {
  const { game, dock, wh, place } = harbor({ staff: 0.3 }); // one worker here
  const dock2 = place(30, 'dock');
  const w = wh(15);
  w.stock.weapons = 1600;
  setTradeMode(game, 'weapons', 'export', 800); // 800 to spare
  game.city.trade.routes.cirta.open = true; // Cirta buys weapons too
  const s1 = moor(game, dock);
  assert.equal(s1.wants.weapons, 800, 'the first ship may want all of it');
  assert.equal(exportClaims(game).open.weapons, 400, 'its one worker claims a wagon');
  const s2 = moor(game, dock2, 'cirta');
  assert.equal(s2.wants.weapons, 400, 'the second wants only what is not claimed');
  let low = Infinity;
  for (let t = 0; t < 48 * TPD && (s1.state === 'docked' || s2.state === 'docked'); t++) {
    tick(game, [dock, dock2]);
    low = Math.min(low, cityStock(game, 'weapons'));
  }
  assert.equal((s1.deal.sold.weapons || 0) + (s2.deal.sold.weapons || 0), 800, '800 sold between them');
  assert.equal(low, 800, 'never below the level');
});

// ---------------------------------------------------------------------------
// The end of the stay
// ---------------------------------------------------------------------------

test('a ship with nothing to trade sails at once; one whose cargo cannot land sails within a day', () => {
  const { game, dock, wh } = harbor();
  const w = wh(8);
  let ship = moor(game, dock);
  assert.equal(ship.state, 'leaving', 'no import or export set: it sails at once');
  // Exports only in an unstaffed warehouse: nothing it could buy.
  w.stock.timber = 800;
  w.efficiency = 0;
  setTradeMode(game, 'timber', 'export', 0);
  ship = moor(game, dock);
  assert.deepEqual(ship.wants, {}, 'an unstaffed warehouse sells nothing');
  assert.equal(ship.state, 'leaving');
  // Imports, but no money.
  setTradeMode(game, 'fruit', 'import', 800);
  game.city.treasury = 0;
  ship = moor(game, dock);
  assert.deepEqual(ship.unload, { fruit: 800 });
  const d = stay(game, [dock], ship, 5);
  assert.ok(d <= 2, `sailed after ${d} days, nothing landed`);
  assert.equal(sum(ship.deal.bought), 0);
  assert.equal(game.city.trade.log.length, 0, 'visits with no trade are not logged');
});

test('the 48-day limit: the ship sails with what is left, and no worker sets out on a trip it cannot finish', () => {
  const { game, dock, wh } = harbor();
  const w = wh(20); // a fetch there and back takes 25 days
  w.stock.timber = 2400;
  setTradeMode(game, 'timber', 'export', 0);
  setTradeMode(game, 'fruit', 'import', 3200);
  const ship = moor(game, dock);
  assert.equal(carts(game).length, 3, 'three workers set out at once');
  // Had it been here 30 days already, with 18 left, none would have gone.
  for (const c of carts(game)) killWalker(game, c);
  ship.mooredTick -= 30 * TPD;
  updateDock(game, dock);
  assert.equal(carts(game).length, 0, 'no worker sets out: it would not be back in time');
  assert.equal(ship.wantsStuck, true, 'nothing more can come');
  assert.equal(ship.state, 'docked', 'it still has fruit to land');
  // The limit: it sails on the tick its 48 days are up, cargo or no cargo.
  ship.mooredTick = game.time.totalTicks - CONFIG.SHIP_MAX_STAY_DAYS * TPD + 2;
  const spent = ship.deal.spent;
  tick(game, [dock]);
  assert.equal(ship.state, 'docked');
  assert.equal(stayTicksLeft(game, ship), 1);
  tick(game, [dock]);
  assert.equal(ship.state, 'leaving', 'the limit');
  assert.ok(sum(ship.unload) > 0, 'with fruit still aboard');
  assert.equal(ship.deal.spent, spent, 'and the fruit still aboard is not paid for');
});

test('a Dock that loses its staff sends its ship away; a worker\'s export comes home to the quay, unpaid', () => {
  const { game, dock, wh } = harbor();
  const w = wh(10);
  w.stock.timber = 400;
  setTradeMode(game, 'timber', 'export', 0);
  setTradeMode(game, 'fruit', 'import', 800);
  const ship = moor(game, dock);
  const fetcher = carts(game).find((c) => c.claim);
  for (let t = 0; t < 30 * TPD && !fetcher.cargo; t++) tick(game, [dock]);
  assert.ok(fetcher.cargo, 'the timber is on its way');
  dock.efficiency = 0;
  for (let t = 0; t < TPD; t++) tick(game, [dock]);
  assert.equal(ship.state, 'leaving', 'no staff: the ship sails at the daily check');
  const t0 = game.city.treasury;
  for (let t = 0; t < 30 * TPD && !fetcher.dead; t++) tick(game, [dock]);
  assert.equal(dock.stock.timber, 400, 'the timber waits on the quay');
  assert.equal(game.city.treasury, t0, 'unpaid');
  assert.equal(cityStock(game, 'timber'), 400, 'still the city\'s');
  // Staff back: the dock workers take it back to storage.
  dock.efficiency = 1;
  for (let t = 0; t < 30 * TPD; t++) tick(game, [dock]);
  assert.equal(w.stock.timber, 400, 'back in the warehouse');
});

test('demolishing the Dock sends the ship away and loses no goods: a worker\'s load goes to storage', () => {
  const { game, dock, wh } = harbor();
  const w = wh(10);
  w.stock.timber = 400;
  setTradeMode(game, 'timber', 'export', 0);
  const ship = moor(game, dock);
  const fetcher = carts(game).find((c) => c.claim);
  for (let t = 0; t < 30 * TPD && !fetcher.cargo; t++) tick(game, [dock]);
  assert.ok(fetcher.cargo);
  removeBuilding(game, dock);
  tick(game, []);
  assert.equal(ship.state, 'leaving', 'the ship sails');
  assert.ok(!fetcher.dead, 'the worker carries on with its load');
  for (let t = 0; t < 30 * TPD && !fetcher.dead; t++) tick(game, []);
  assert.equal(w.stock.timber, 400, 'the timber is back in storage');
});

// ---------------------------------------------------------------------------
// Limits and orders
// ---------------------------------------------------------------------------

test('quotas and the per-visit limit: the manifest and every lot stay within them', () => {
  const { game, dock, wh } = harbor();
  const w = wh(5);
  const p = TRADE_PARTNERS[PARTNER];
  const route = game.city.trade.routes[PARTNER];
  Object.assign(w.stock, { weapons: 1000, marble: 800, timber: 1200 });
  for (const g of Object.keys(p.buys)) setTradeMode(game, g, 'export', 0);
  for (const g of Object.keys(p.sells)) setTradeMode(game, g, 'import', 3200);
  w.orders.fruit = 'accept';
  // Carthago sells 3,200 a year: a ship brings SHIP_MAX_TRADE of it.
  let m = shipManifest(game, PARTNER, dock);
  assert.equal(sum(m.unload), CONFIG.SHIP_MAX_TRADE, 'at most SHIP_MAX_TRADE');
  assert.deepEqual(m.wants, { weapons: 800, marble: 600, timber: 1000 }, 'each good up to its quota');
  route.bought.fruit = p.sells.fruit - 300; // only 300 fruit left this year
  m = shipManifest(game, PARTNER, dock);
  assert.deepEqual(m.unload, { fruit: 300, grapes: 1200, furniture: 500 }, 'the fruit quota left');
  const ship = moor(game, dock);
  // Another ship of the same partner sells weapons meanwhile: this one stops at the quota.
  route.sold.weapons = p.buys.weapons - 100;
  stay(game, [dock], ship);
  assert.ok(route.sold.weapons <= p.buys.weapons, `weapons ${route.sold.weapons} within the quota`);
  assert.ok(route.bought.fruit <= p.sells.fruit, 'fruit within the quota');
  assert.ok(sum(ship.deal.sold) <= CONFIG.SHIP_MAX_TRADE && sum(ship.deal.bought) <= CONFIG.SHIP_MAX_TRADE);
});

test('imports go where storage orders allow; exports come from any staffed warehouse, orders or not', () => {
  const { game, dock, wh } = harbor();
  const near = wh(5);
  const far = wh(12);
  setOrder(near, 'furniture', 'refuse');
  setTradeMode(game, 'furniture', 'import', 800);
  // Exports from a warehouse that refuses timber and is emptying.
  far.stock.timber = 400;
  setOrder(far, 'timber', 'refuse');
  setEmptying(far, true);
  setTradeMode(game, 'timber', 'export', 0);
  const ship = moor(game, dock);
  stay(game, [dock], ship);
  for (let t = 0; t < 30 * TPD; t++) tick(game, [dock]);
  assert.equal(ship.deal.sold.timber, 400, 'exports ignore Refuse and Empty');
  assert.equal(near.stock.furniture, 0, 'the nearer warehouse refuses furniture');
  assert.equal(far.stock.furniture, 0, 'an emptying warehouse takes none either');
  assert.equal(dock.stock.furniture, 500, 'so it waits on the quay');
  assert.equal(dock.noStorage, true, 'and the Dock says so');
  setOrder(near, 'furniture', 'accept');
  for (let t = 0; t < 20 * TPD; t++) tick(game, [dock]);
  assert.equal(near.stock.furniture, 500, 'accepted again: carted in');
});

test('a wagon from the quay still feeds a workshop with room for less than a whole wagon', () => {
  const { game, dock, wh, place } = harbor();
  const potter = place(6, 'pottery_ws');
  const w = wh(30);
  game.city.trade.routes.massilia.open = true;
  setTradeMode(game, 'clay', 'import', 1200);
  const ship = moor(game, dock, 'massilia');
  assert.deepEqual(ship.unload, { clay: 1200 });
  for (let t = 0; t < 30 * TPD; t++) tick(game, [dock]);
  assert.equal(potter.stock.clay, CONFIG.WORKSHOP_RAW_CAP, 'the Potter, nearer and first in line, filled up');
  assert.equal(w.stock.clay + dock.stock.clay + potter.stock.clay + carts(game).reduce((n, c) => n + (c.cargo?.good === 'clay' ? c.cargo.amount : 0), 0), 1200, 'the rest goes on to the warehouse');
});

test('import levels count what is on its way: a second ship, a caravan, and a level met mid-stay', async () => {
  const { tradeAt } = await import('../src/sim/trade.js');
  const { game, dock, wh, place } = harbor();
  const dock2 = place(30, 'dock');
  const w = wh(8);
  w.orders.fruit = 'accept';
  w.orders.wine = 'accept';
  game.city.trade.routes.cirta.open = true;
  setTradeMode(game, 'fruit', 'import', 800);
  const s1 = moor(game, dock);
  assert.deepEqual(s1.unload, { fruit: 800 });
  const s2 = moor(game, dock2, 'cirta');
  assert.equal(s2.state, 'leaving', 'Cirta\'s ship finds the shortfall already on its way, and sails');
  // A caravan while a ship still has wine aboard: it brings none.
  game.city.trade.routes.massilia.open = true;
  setTradeMode(game, 'wine', 'import', 600);
  const s3 = moor(game, dock2, 'massilia');
  assert.deepEqual(s3.unload, { wine: 600 });
  const out = tradeAt(game, 'capua', w);
  assert.equal(out.bought.wine, undefined, 'the caravan sells no wine');
  // The level met meanwhile (a caravan came first, say): the crane lands no more.
  w.stock.fruit = 800;
  const d = stay(game, [dock, dock2], s1, 10);
  assert.equal(sum(s1.deal.bought), 0, 'no fruit landed past the level');
  assert.ok(d <= 4, `it sailed after ${d} days`);
});

test('a partner that bought its year\'s worth mid-stay wants no more: no endless fetching', () => {
  const { game, dock, wh } = harbor();
  const w = wh(10);
  w.stock.weapons = 2400;
  setTradeMode(game, 'weapons', 'export', 0);
  const ship = moor(game, dock);
  assert.equal(ship.wants.weapons, 800);
  // Another Carthago ship at another dock bought them meanwhile.
  game.city.trade.routes[PARTNER].sold.weapons = TRADE_PARTNERS[PARTNER].buys.weapons;
  const d = stay(game, [dock], ship);
  assert.ok(d < 15, `sailed after ${d} days, when its workers were back`);
  assert.equal(ship.deal.sold.weapons, undefined, 'none sold past the quota');
  for (let t = 0; t < 30 * TPD; t++) tick(game, [dock]);
  assert.equal(w.stock.weapons, 2400, 'the two wagons fetched for it went back to storage');
});

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

test('the Dock and the ship say what is left to unload and load, the deal so far and the days', () => {
  const { game, dock, wh } = harbor();
  const w = wh(10);
  w.stock.timber = 1200;
  setTradeMode(game, 'timber', 'export', 0);
  setTradeMode(game, 'furniture', 'import', 800);
  const ship = moor(game, dock);
  const rows = Object.fromEntries(dockRows(game, dock));
  assert.equal(rows['To unload'], 'furniture 500');
  assert.equal(rows['To load'], 'timber 1,000 (1,000 on the way)');
  assert.equal(rows['Dock workers'], '3 of 3 out (3 at full staff)');
  for (let t = 0; t < 3 * TPD + 10; t++) tick(game, [dock]); // the first lot (400) landed, the last 100 not yet
  assert.equal(dockShipText(game, dock), `Carthago ship, tied up 3 days (leaves by day ${CONFIG.SHIP_MAX_STAY_DAYS} at the latest)`);
  const info = Object.fromEntries(walkerInfo(game, ship).rows);
  assert.equal(info.Doing, 'Unloading at the dock');
  assert.equal(info['Still to unload'], '100 furniture');
  assert.equal(info['Still to buy'], '1000 timber');
  assert.match(info['Sold here so far'], /^400 furniture \(you paid \d+ Dn\)$/);
  assert.equal(info['Bought here so far'], 'Nothing yet');
  assert.match(info['Days at the dock'], /^3 /);
  const fetcher = carts(game).find((c) => c.claim);
  assert.match(walkerDoing(game, fetcher), /^Fetching timber for the Carthago ship$|^Bringing 400 timber to the Carthago ship$/);
  assert.equal(dockHint(game, dock), null, 'nothing stuck');
  stay(game, [dock], ship);
  const after = Object.fromEntries(walkerInfo(game, ship).rows);
  assert.match(after['Bought here'], /^1000 timber \(you earned \d+ Dn\)$/, 'when it sails: the whole deal');
  // A ship still landing fruit, waiting for timber that cannot come: the Dock says why.
  setTradeMode(game, 'fruit', 'import', 800);
  w.stock.timber = 400;
  game.city.trade.routes[PARTNER].sold = {};
  const s2 = moor(game, dock);
  assert.deepEqual(s2.wants, { timber: 400 });
  for (const c of carts(game)) killWalker(game, c); // (the fetch never happens)
  w.efficiency = 0;
  updateDock(game, dock);
  assert.equal(s2.state, 'docked', 'fruit still to land');
  assert.equal(walkerDoing(game, s2), 'Unloading at the dock');
  assert.match(dockHint(game, dock), new RegExp(`^No staffed warehouse within ${CONFIG.DOCK_REACH} road tiles has timber to spare`));
});

// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

test('save: a real version 7 save with a ship moored and wine on the quay loads and plays on', () => {
  const raw = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/save-v7-ship-moored.json'), 'utf8'));
  assert.equal(raw.version, 7);
  const game = deserializeGame(raw);
  const ship = [...game.walkers.values()].find((w) => w.type === 'ship' && w.state === 'docked');
  assert.ok(ship, 'the ship is at the dock');
  const dock = game.buildings.get(ship.target);
  assert.equal(dock.stock.wine, 600, 'the wine it unloaded is on the quay');
  assert.deepEqual(ship.unload, {}, 'it traded everything on arrival');
  assert.deepEqual(ship.wants, {});
  assert.ok(ship.deal && ship.deal.bought.wine === 600, 'its deal is kept for its panel');
  assert.ok(mooredShip(game, dock) === ship);
  const logged = game.city.trade.log.length;
  game.runTicks(1);
  assert.equal(ship.state, 'leaving', 'it casts off on the first tick');
  assert.equal(game.city.trade.log.length, logged, 'its visit is not logged twice');
  // Only the dock and the walkers from here on (no homes using wine meanwhile):
  // the wine on the quay is carted to storage and none is lost.
  const wine = () => {
    let n = 0;
    for (const b of game.buildings.values()) n += (b.stock?.wine || 0) + (b.house?.goods?.wine || 0);
    for (const w of game.walkers.values()) n += (w.cargo?.good === 'wine' ? w.cargo.amount : 0) + (w.load?.wine || 0);
    return n;
  };
  const total = wine();
  dock.efficiency = 1;
  for (let t = 0; t < 30 * TPD; t++) tick(game, [dock]);
  assert.equal(dock.stock.wine, 0, 'dock workers carted the wine on');
  assert.equal(wine(), total, 'none lost');
  const again = serializeGame(game);
  assert.equal(again.version, CONFIG.SAVE_VERSION);
  assert.equal(CONFIG.SAVE_VERSION, 8);
});

test('save: a city saved mid-visit plays on exactly as the one it came from', () => {
  const { game, dock, wh } = harbor();
  fullExchange(game, wh(10));
  const ship = moor(game, dock);
  for (let t = 0; t < 9 * TPD + 7; t++) tick(game, [dock]);
  assert.ok(carts(game).some((c) => c.claim), 'workers out with claims');
  const copy = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  const dock2 = copy.buildings.get(dock.id);
  const ship2 = copy.walkers.get(ship.id);
  // The copy's staffing is as saved (no labor update runs in these ticks).
  stay(game, [dock], ship);
  stay(copy, [dock2], ship2);
  assert.deepEqual(ship2.deal, ship.deal, 'the same deal');
  assert.equal(copy.city.treasury, game.city.treasury);
  assert.equal(copy.time.totalTicks, game.time.totalTicks, 'sailed on the same tick');
});

/**
 * storage.test.mjs - headless tests for warehouse and granary orders
 * (sim/storageOrders.js): Accept, Refuse and Get per good, the Empty switch,
 * the carts they send, and what the info panel says about them (node:test).
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Most tests line buildings up along one straight road, so road distances
 * are plain differences in x, and drive the day by hand: the building's
 * daily update, then a day of walker ticks. Staffing is set directly (no
 * homes or labor needed).
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { GOOD_KEYS, FOOD_TYPES } from '../src/data/goods.js';
import { addBuilding, spawnWalker } from '../src/sim/entities.js';
import { updateWalkers } from '../src/sim/walkers.js';
import { findDeliveryTarget, findSupplier, storageSpaceFor, takeFromCity, storageByRoad } from '../src/sim/storage.js';
import { dispatchCart } from '../src/sim/production.js';
import { buyerArrive } from '../src/sim/market.js';
import { openRoute, setTradeMode, tradeAt } from '../src/sim/trade.js';
import {
  updateStorage, cycleOrder, setOrder, setEmptying, getGoods,
  WAREHOUSE_GET_LOAD, GRANARY_GET_LOAD, GRANARY_GET_FLOOR,
} from '../src/sim/storageOrders.js';
import { orderLines } from '../src/ui/storageInfo.js';
import { walkerDoing } from '../src/ui/walkerTalk.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { buildDemoCity } from '../src/dev/demoCity.js';
import { newGame, build, findFree } from './helpers.mjs';

log.setLevel('error');

/**
 * A desert map with a straight road 48 tiles long. Buildings go above it
 * (`up(dx, type)`, 3x3 storage touching the road with its bottom edge) or
 * below it (`down(dx, type)`), dx tiles from the strip's left end.
 */
function strip() {
  const game = newGame({ type: 'desert', size: 96, seed: 'orders' });
  const spot = findFree(game, 48, 7);
  assert.ok(spot, 'a free strip of land');
  const ry = spot.y + 3;
  assert.ok(build(game, 'road', spot.x, ry, spot.x + 47, ry).ok, 'road laid');
  const place = (dx, y, type, size) => {
    const b = addBuilding(game, type, spot.x + dx, y);
    assert.ok(b.accessRoad >= 0, `${type} at +${dx} touches the road`);
    b.efficiency = 1;
    if (b.stock) for (const k of Object.keys(b.stock)) b.stock[k] = 0;
    return b;
  };
  return {
    game,
    up: (dx, type) => place(dx, ry - 3, type),
    down: (dx, type) => place(dx, ry + 1, type),
  };
}

/** One game day for these buildings: their daily update, then a day of walking. */
function day(game, buildings) {
  for (const b of buildings) updateStorage(game, b);
  for (let t = 0; t < CONFIG.TICKS_PER_DAY; t++) updateWalkers(game);
}

/** Walk until every cart is home (or `maxDays` pass). */
function settle(game, maxDays = 80) {
  for (let t = 0; t < CONFIG.TICKS_PER_DAY * maxDays; t++) {
    if (![...game.walkers.values()].some((w) => w.type === 'cart')) return;
    updateWalkers(game);
  }
}

const carts = (game) => [...game.walkers.values()].filter((w) => w.type === 'cart');

// ---------------------------------------------------------------------------
// The orders themselves
// ---------------------------------------------------------------------------

test('storage orders: today\'s defaults, and a click cycles Accept, Refuse, Get', () => {
  const { game, up } = strip();
  const wh = up(0, 'warehouse');
  const gr = up(10, 'granary');
  // Warehouses refuse food by default (food goes to granaries); granaries take every food.
  for (const g of GOOD_KEYS) assert.equal(wh.orders[g], FOOD_TYPES.includes(g) ? 'refuse' : 'accept', g);
  for (const f of FOOD_TYPES) assert.equal(gr.orders[f], 'accept', f);
  assert.equal(wh.emptying, false);
  assert.equal(gr.emptying, false);
  assert.equal(cycleOrder(wh, 'wine'), 'refuse');
  assert.equal(cycleOrder(wh, 'wine'), 'get');
  assert.equal(cycleOrder(wh, 'wine'), 'accept');
  assert.equal(cycleOrder(wh, 'wheat'), 'get', 'refused food goes on to Get');
  assert.equal(cycleOrder(gr, 'wine'), null, 'a granary has no orders for wine');
  setOrder(wh, 'oil', 'nonsense');
  assert.equal(wh.orders.oil, 'accept', 'unknown states are ignored');
  assert.deepEqual(getGoods(wh), ['wheat']);
  // Nothing set: the daily update does nothing new (and sends no cart).
  updateStorage(game, gr);
  assert.equal(carts(game).length, 0);
  assert.equal(gr.orderNote, null);
});

test('a Refuse warehouse takes no deliveries, but still sells exports and feeds markets', () => {
  const { game, up, down } = strip();
  const wh = up(0, 'warehouse');
  const market = down(4, 'market');
  wh.stock.pottery = 800;
  setOrder(wh, 'pottery', 'refuse');
  setOrder(wh, 'timber', 'refuse');
  assert.equal(storageSpaceFor(wh, 'pottery'), 0);
  assert.equal(findDeliveryTarget(game, wh.accessRoad, 'pottery', 100), null, 'no cart brings pottery here');
  // A caravan buys the refused pottery, and sells no timber into it.
  assert.ok(openRoute(game, 'tarraco').ok);
  setTradeMode(game, 'pottery', 'export', 400); // sell down to 4 loads
  setTradeMode(game, 'timber', 'import', 400);
  const out = tradeAt(game, 'tarraco', wh);
  assert.ok(out.sold.pottery > 0, 'exports sold');
  assert.equal(out.bought.timber, undefined, 'no import into a refusing warehouse');
  assert.equal(wh.stock.timber, 0);
  // A market buyer still finds the pottery and takes some home.
  const left = wh.stock.pottery;
  assert.ok(left > 0);
  const found = findSupplier(game, market.accessRoad, 'pottery', 1, 70);
  assert.equal(found?.id, wh.id, 'the market buyer goes to the refusing warehouse');
  const buyer = spawnWalker(game, 'buyer', market.accessRoad, market, { target: wh.id, state: 'fetch', want: 'pottery', load: {} });
  buyerArrive(game, buyer);
  assert.ok(buyer.load.pottery > 0 && wh.stock.pottery < left, 'and buys from it');
});

test('an Empty warehouse receives no producer cart and no import; exports still go', () => {
  const { game, up, down } = strip();
  const wh = up(0, 'warehouse');
  const potter = down(6, 'pottery_ws');
  wh.stock.pottery = 400;
  setEmptying(wh, true);
  potter.stock.pottery = 200;
  assert.equal(dispatchCart(game, potter, 'pottery', 100), false, 'the potter finds nowhere to deliver');
  assert.equal(potter.noStorage, true);
  assert.equal(potter.stock.pottery, 200, 'and keeps its pottery');
  assert.ok(openRoute(game, 'tarraco').ok);
  setTradeMode(game, 'pottery', 'export', 0);
  setTradeMode(game, 'timber', 'import', 400);
  const out = tradeAt(game, 'tarraco', wh);
  assert.ok(out.sold.pottery > 0, 'exports still bought from it');
  assert.equal(wh.stock.timber, 0, 'no imports while emptying');
  // Turned off again, it takes deliveries again (its orders were kept).
  setEmptying(wh, false);
  assert.equal(dispatchCart(game, potter, 'pottery', 100), true);
  assert.equal(carts(game)[0].target, wh.id);
});

test('a Get warehouse still receives a producer cart', () => {
  const { game, up, down } = strip();
  const wh = up(0, 'warehouse');
  const potter = down(6, 'pottery_ws');
  setOrder(wh, 'pottery', 'get');
  potter.stock.pottery = 100;
  assert.equal(dispatchCart(game, potter, 'pottery', 100), true);
  const cart = carts(game)[0];
  assert.equal(cart.target, wh.id);
  assert.equal(wh.incoming.pottery, 100, 'room reserved');
  settle(game);
  assert.equal(wh.stock.pottery, 100, 'delivered');
  assert.equal(wh.incoming.pottery, 0);
});

// ---------------------------------------------------------------------------
// Warehouse Get
// ---------------------------------------------------------------------------

test('warehouse Get (example A): fetches 4 loads from the best source, nearer or fuller, then keeps 5 to 8', () => {
  const { game, up } = strip();
  const w1 = up(0, 'warehouse');
  const w3 = up(8, 'warehouse'); // 8 tiles of road, 3 loads: 8 - 12 = -4
  const w2 = up(14, 'warehouse'); // 14 tiles, 6 loads: 14 - 24 = -10, the better source
  w1.stock.wine = 200;
  w3.stock.wine = 300;
  w2.stock.wine = 600;
  setOrder(w1, 'wine', 'get');
  const by = Object.fromEntries(storageByRoad(game, w1.accessRoad, 'warehouse', w1.id).map((s) => [s.b.id, s.dist]));
  assert.deepEqual([by[w3.id], by[w2.id]], [8, 14], 'road distances');
  updateStorage(game, w1);
  const cart = carts(game)[0];
  assert.ok(cart, 'a Get cart set off');
  assert.equal(cart.state, 'collect');
  assert.equal(cart.target, w2.id, 'the fuller warehouse wins over the nearer one');
  assert.equal(cart.cargo, null, 'it goes empty');
  assert.equal(w1.incoming.wine, WAREHOUSE_GET_LOAD, 'room for its load is held at home');
  assert.match(walkerDoing(game, cart), /Going to the Warehouse for wine/);
  assert.match(orderLines(game, w1).map((l) => l.text).join(' '), /fetching wine from a Warehouse/);
  settle(game);
  assert.equal(w1.stock.wine, 600, '2 + 4 loads');
  assert.equal(w2.stock.wine, 200);
  assert.equal(w1.incoming.wine, 0, 'hold released');
  // 6 loads is more than 4: no trip.
  for (let d = 0; d < 3; d++) day(game, [w1]);
  assert.equal(w1.stock.wine, 600, 'Get keeps 5 to 8 loads, it does not fill up');
  // Markets bring it down to 4: it fetches again (now W3 scores best: 8 - 12 against 14 - 8).
  w1.stock.wine = 400;
  updateStorage(game, w1);
  assert.equal(carts(game)[0]?.target, w3.id);
  settle(game);
  assert.equal(w1.stock.wine, 700, 'all W3 had (3 loads)');
  assert.equal(w3.stock.wine, 0);
});

test('warehouse Get (example B): no trip without room for 8 loads, and the panel says why', () => {
  const { game, up } = strip();
  const w1 = up(0, 'warehouse');
  const w2 = up(10, 'warehouse');
  w2.stock.pottery = 2000;
  w1.stock.pottery = 100;
  w1.stock.marble = CONFIG.WAREHOUSE_CAPACITY - 100 - 700; // 700 free: less than 800
  setOrder(w1, 'pottery', 'get');
  for (let d = 0; d < 3; d++) day(game, [w1]);
  assert.equal(carts(game).length, 0, 'no trip');
  assert.equal(w1.orderNote.why, 'room');
  assert.match(orderLines(game, w1).map((l) => l.text).join(' '), /needs room for 8 loads/);
  w1.stock.marble -= 100; // 800 free
  updateStorage(game, w1);
  assert.equal(carts(game).length, 1, 'with room for 8 loads it goes');
});

test('warehouse Get (example C): two Get warehouses never take from each other; with no source it says so', () => {
  const { game, up } = strip();
  const w1 = up(0, 'warehouse');
  const w2 = up(10, 'warehouse');
  w2.stock.oil = 1000;
  setOrder(w1, 'oil', 'get');
  setOrder(w2, 'oil', 'get');
  for (let d = 0; d < 10; d++) day(game, [w1, w2]);
  assert.equal(carts(game).length, 0, 'no cart ever leaves');
  assert.equal(w1.stock.oil, 0);
  assert.equal(w2.stock.oil, 1000);
  assert.equal(w1.orderNote.why, 'nothing');
  assert.match(orderLines(game, w1).map((l) => l.text).join(' '), /no other warehouse on its roads has oil to spare/);
  // Some to spare elsewhere, but only 4 loads: still nothing (others must hold more than 4).
  const w3 = up(20, 'warehouse');
  w3.stock.oil = 400;
  day(game, [w1]);
  assert.equal(carts(game).length, 0, 'four loads are not enough to send for');
  w3.stock.oil = 500;
  updateStorage(game, w1);
  assert.equal(carts(game)[0]?.target, w3.id, 'it fetches from the Accept warehouse, not the other Get one');
});

test('two Get warehouses fed by one source never pass the good back and forth', () => {
  const { game, up } = strip();
  const a = up(0, 'warehouse');
  const b = up(30, 'warehouse');
  const src = up(15, 'warehouse');
  src.stock.furniture = 3000;
  a.stock.furniture = 0;
  b.stock.furniture = 800;
  setOrder(a, 'furniture', 'get');
  setOrder(b, 'furniture', 'get');
  const trips = [];
  for (let d = 0; d < 40; d++) {
    for (const w of carts(game)) if (w.state === 'collect' && !trips.includes(w.id)) trips.push(w.id);
    for (const w of carts(game)) assert.equal(w.target === a.id || w.target === b.id, false, 'no cart heads for the other Get warehouse');
    day(game, [a, b]);
    // Markets take from both, so both keep asking.
    a.stock.furniture = Math.max(0, a.stock.furniture - 150);
    b.stock.furniture = Math.max(0, b.stock.furniture - 150);
  }
  assert.ok(trips.length >= 4, `both fetched several times (${trips.length} trips)`);
});

test('Get needs the warehouse at least half staffed', () => {
  const { game, up } = strip();
  const w1 = up(0, 'warehouse');
  const w2 = up(10, 'warehouse');
  w2.stock.wine = 1000;
  setOrder(w1, 'wine', 'get');
  w1.efficiency = 0.4;
  updateStorage(game, w1);
  assert.equal(carts(game).length, 0);
  assert.equal(w1.orderNote.why, 'staff');
  assert.match(orderLines(game, w1).map((l) => l.text).join(' '), /needs at least 50% of its workers/);
  w1.efficiency = 0.5;
  updateStorage(game, w1);
  assert.equal(carts(game).length, 1);
});

test('one cart at a time: no second Get trip while the first is out', () => {
  const { game, up } = strip();
  const w1 = up(0, 'warehouse');
  const w2 = up(20, 'warehouse');
  w2.stock.wine = 2000;
  w2.stock.oil = 2000;
  setOrder(w1, 'wine', 'get');
  setOrder(w1, 'oil', 'get');
  updateStorage(game, w1);
  updateStorage(game, w1);
  updateStorage(game, w1);
  assert.equal(carts(game).length, 1);
  settle(game);
  updateStorage(game, w1);
  assert.equal(carts(game)[0].want, 'oil', 'wine is stocked now: the next good on Get');
});

test('a Get cart loses nothing: the room it needs is held from the moment it sets off', () => {
  const { game, up, down } = strip();
  const w1 = up(0, 'warehouse');
  const w2 = up(20, 'warehouse');
  const potter = down(4, 'pottery_ws');
  w2.stock.wine = 2000;
  w1.stock.marble = CONFIG.WAREHOUSE_CAPACITY - 1000;
  setOrder(w1, 'wine', 'get');
  updateStorage(game, w1);
  assert.equal(w1.incoming.wine, 400);
  assert.equal(storageSpaceFor(w1, 'pottery'), 600, 'deliveries see only the room left');
  // A potter fills every free unit while the Get cart is away.
  potter.stock.pottery = 1000;
  for (let k = 0; k < 6; k++) dispatchCart(game, potter, 'pottery', 100);
  assert.equal(w1.incoming.pottery, 600);
  settle(game);
  assert.equal(w1.stock.wine, 400, 'the whole Get load fits');
  assert.equal(w1.stock.pottery, 600);
  assert.equal(w1.stock.marble + w1.stock.wine + w1.stock.pottery, CONFIG.WAREHOUSE_CAPACITY, 'full, nothing lost');
  assert.equal(w2.stock.wine, 1600);
});

test('a source that goes over to Get while the cart is on its way gives nothing', () => {
  const { game, up } = strip();
  const w1 = up(0, 'warehouse');
  const w2 = up(20, 'warehouse');
  w2.stock.wine = 1000;
  setOrder(w1, 'wine', 'get');
  updateStorage(game, w1);
  setOrder(w2, 'wine', 'get');
  settle(game);
  assert.equal(w1.stock.wine, 0);
  assert.equal(w2.stock.wine, 1000);
  assert.equal(w1.incoming.wine, 0, 'hold released');
});

// ---------------------------------------------------------------------------
// Granary Get
// ---------------------------------------------------------------------------

test('granary Get (example D): fetches up to 8 loads of the food on Get, and leaves the last load', () => {
  const { game, up } = strip();
  const g1 = up(0, 'granary');
  const g2 = up(10, 'granary');
  g2.stock.wheat = 1500;
  g2.stock.vegetables = 300;
  setOrder(g1, 'wheat', 'get');
  assert.match(orderLines(game, g1)[0].text, /Get: fills the granary with wheat/);
  updateStorage(game, g1);
  assert.equal(carts(game)[0]?.want, 'wheat');
  assert.equal(g1.incoming.wheat, GRANARY_GET_LOAD);
  settle(game);
  assert.equal(g1.stock.wheat, 800);
  updateStorage(game, g1);
  settle(game);
  assert.equal(g1.stock.wheat, 1400, 'second trip: 600, leaving 100 behind');
  assert.equal(g2.stock.wheat, GRANARY_GET_FLOOR);
  for (let d = 0; d < 3; d++) day(game, [g1]);
  assert.equal(carts(game).length, 0, 'no more trips');
  assert.equal(g2.stock.wheat, 100);
  assert.equal(g2.stock.vegetables, 300, 'vegetables are not on Get: left alone');
  assert.equal(g1.orderNote.why, 'nothing');
  assert.match(orderLines(game, g1).map((l) => l.text).join(' '), /no other granary on its roads has wheat to spare/);
});

test('granary Get (example E): true road distance picks the near source; a small one counts double', () => {
  const { game, up } = strip();
  const g1 = up(0, 'granary');
  const near = up(6, 'granary');
  const far = up(30, 'granary');
  near.stock.fruit = 1000;
  far.stock.fruit = 1000;
  setOrder(g1, 'fruit', 'get');
  updateStorage(game, g1);
  assert.equal(carts(game)[0].target, near.id, 'the nearer granary');
  settle(game);
  // A small source (400 or less to give) 6 tiles away counts as 12: a big one 10 tiles away wins.
  const { game: g, up: up2 } = strip();
  const a = up2(0, 'granary');
  const small = up2(6, 'granary');
  const big = up2(10, 'granary');
  small.stock.meat = 300;
  big.stock.meat = 1000;
  setOrder(a, 'meat', 'get');
  updateStorage(g, a);
  assert.equal(carts(g)[0].target, big.id);
});

test('granary Get takes the food its source has most of, never from a granary on Get for it', () => {
  const { game, up } = strip();
  const g1 = up(0, 'granary');
  const g2 = up(10, 'granary');
  const g3 = up(20, 'granary');
  setOrder(g1, 'wheat', 'get');
  setOrder(g1, 'fruit', 'get');
  g2.stock.wheat = 300;
  g2.stock.fruit = 900;
  g3.stock.wheat = 2000;
  setOrder(g3, 'wheat', 'get');
  updateStorage(game, g1);
  const cart = carts(game)[0];
  assert.equal(cart.target, g2.id, 'g3 gets wheat itself: not a source');
  assert.equal(cart.want, 'fruit', 'the food g2 has most of');
  settle(game);
  assert.equal(g1.stock.fruit, 800);
  assert.equal(g3.stock.wheat, 2000);
});

test('a full granary does not fetch', () => {
  const { game, up } = strip();
  const g1 = up(0, 'granary');
  const g2 = up(10, 'granary');
  g2.stock.wheat = 1000;
  g1.stock.vegetables = CONFIG.GRANARY_CAPACITY - 50;
  setOrder(g1, 'wheat', 'get');
  updateStorage(game, g1);
  assert.equal(carts(game).length, 0);
  assert.equal(g1.orderNote.why, 'full');
});

// ---------------------------------------------------------------------------
// Empty
// ---------------------------------------------------------------------------

test('granary Empty (example F): one cart load at a time to a granary that accepts it, until it is empty', () => {
  const { game, up } = strip();
  const g1 = up(0, 'granary');
  const g2 = up(10, 'granary');
  g1.stock.wheat = 300;
  g1.stock.fruit = 200;
  setEmptying(g1, true);
  assert.equal(storageSpaceFor(g1, 'wheat'), 0, 'an emptying granary takes nothing in');
  const loads = [];
  for (let d = 0; d < 80 && (g1.stock.wheat + g1.stock.fruit > 0 || carts(game).length); d++) {
    updateStorage(game, g1);
    for (const w of carts(game)) if (!loads.some((l) => l.id === w.id)) loads.push({ id: w.id, good: w.cargo.good, amount: w.cargo.amount });
    if (carts(game).some((w) => w.state === 'deliver')) assert.match(orderLines(game, g1)[0].text, /Emptying: (wheat|fruit) going out/);
    else if (carts(game).length) assert.match(orderLines(game, g1)[0].text, /on its way back/);
    for (let t = 0; t < CONFIG.TICKS_PER_DAY; t++) updateWalkers(game);
  }
  assert.deepEqual(loads.map((l) => [l.good, l.amount]), [['wheat', CONFIG.CART_LOAD], ['wheat', 100], ['fruit', 200]]);
  assert.equal(g2.stock.wheat, 300);
  assert.equal(g2.stock.fruit, 200);
  updateStorage(game, g1);
  assert.equal(g1.orderNote.why, 'done');
  assert.match(orderLines(game, g1)[0].text, /nothing left to send/);
});

test('Empty skips a good with nowhere to go and sends the next one', () => {
  const { game, up } = strip();
  const w1 = up(0, 'warehouse');
  const w2 = up(10, 'warehouse');
  w1.stock.marble = 300;
  w1.stock.wine = 200;
  setOrder(w2, 'marble', 'refuse');
  setEmptying(w1, true);
  updateStorage(game, w1);
  const cart = carts(game)[0];
  assert.equal(cart?.cargo.good, 'wine', 'marble (first in order) has nowhere to go: wine goes');
  assert.equal(cart.target, w2.id);
  const text = orderLines(game, w1).map((l) => l.text).join(' ');
  assert.match(text, /Emptying: wine going out/);
  assert.match(text, /Emptying: nowhere to send marble/);
  settle(game);
  updateStorage(game, w1);
  assert.equal(carts(game).length, 0);
  assert.equal(w1.orderNote.why, 'nowhere');
  assert.deepEqual(w1.orderNote.goods, ['marble']);
  assert.equal(w1.stock.marble, 300, 'marble stays');
});

test('Empty sends raw materials to a workshop first, and pauses Get', () => {
  const { game, up, down } = strip();
  const w1 = up(0, 'warehouse');
  const w2 = up(20, 'warehouse');
  const potter = down(10, 'pottery_ws');
  w1.stock.clay = 200;
  w2.stock.wine = 2000;
  setOrder(w1, 'wine', 'get');
  setEmptying(w1, true);
  updateStorage(game, w1);
  const cart = carts(game)[0];
  assert.equal(cart.target, potter.id, 'clay to the potter');
  assert.equal(cart.cargo.good, 'clay');
  settle(game);
  assert.equal(potter.stock.clay, 200);
  for (let d = 0; d < 5; d++) day(game, [w1]);
  assert.equal(w1.stock.wine, 0, 'no Get while emptying');
  assert.match(orderLines(game, w1).map((l) => l.text).join(' '), /Get is paused while emptying/);
});

test('a cart that cannot deliver brings its load home, even to a building that is emptying', () => {
  const { game, up } = strip();
  const w1 = up(0, 'warehouse');
  const w2 = up(10, 'warehouse');
  w1.stock.wine = 200;
  setEmptying(w1, true);
  updateStorage(game, w1);
  assert.equal(carts(game)[0].target, w2.id);
  setOrder(w2, 'wine', 'refuse'); // changed its mind while the cart was on its way
  settle(game);
  assert.equal(w1.stock.wine, 200, 'back home, not lost');
  assert.equal(w2.stock.wine, 0);
});

// ---------------------------------------------------------------------------
// The Emperor, saves, and a whole city
// ---------------------------------------------------------------------------

test('the Emperor\'s requests take from storage not on Get first', () => {
  const { game, up } = strip();
  const keep = up(0, 'warehouse');
  const other = up(10, 'warehouse');
  keep.stock.wine = 800;
  other.stock.wine = 500;
  setOrder(keep, 'wine', 'get');
  assert.equal(takeFromCity(game, 'wine', 600), 600);
  assert.equal(other.stock.wine, 0, 'the other warehouse first');
  assert.equal(keep.stock.wine, 700, 'then the Get warehouse, for the rest');
});

test('a version 6 save loads: accept flags become Accept or Refuse, nothing emptying', () => {
  const { game, up } = strip();
  const wh = up(0, 'warehouse');
  const gr = up(10, 'granary');
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  // Rewrite it as version 6 wrote it: accept flags, no orders.
  data.version = 6;
  for (const raw of data.buildings) {
    if (raw.orders) {
      raw.accept = Object.fromEntries(Object.entries(raw.orders).map(([g, s]) => [g, s !== 'refuse']));
      delete raw.orders;
      delete raw.emptying;
      delete raw.orderNote;
    } else {
      raw.accept = null;
    }
  }
  data.buildings.find((r) => r.id === wh.id).accept.wine = false;
  data.buildings.find((r) => r.id === wh.id).accept.wheat = true;
  data.buildings.find((r) => r.id === gr.id).accept.fruit = false;
  const copy = deserializeGame(data);
  const w = copy.buildings.get(wh.id);
  const g = copy.buildings.get(gr.id);
  assert.equal(w.orders.wine, 'refuse');
  assert.equal(w.orders.wheat, 'accept');
  assert.equal(w.orders.pottery, 'accept');
  assert.equal(w.orders.meat, 'refuse');
  assert.equal(g.orders.fruit, 'refuse');
  assert.equal(g.orders.wheat, 'accept');
  assert.equal(w.emptying, false);
  assert.equal('accept' in w, false, 'the old flags are gone');
  assert.equal([...copy.buildings.values()].some((b) => 'accept' in b), false);
});

test('orders, Empty and a Get cart on its way survive save and load', () => {
  const { game, up } = strip();
  const w1 = up(0, 'warehouse');
  const w2 = up(20, 'warehouse');
  w2.stock.wine = 1000;
  setOrder(w1, 'wine', 'get');
  setOrder(w2, 'oil', 'refuse');
  setEmptying(w2, true);
  setEmptying(w2, false);
  setEmptying(up(40, 'granary'), true);
  updateStorage(game, w1);
  for (let t = 0; t < 60; t++) updateWalkers(game);
  const copy = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  const c1 = copy.buildings.get(w1.id);
  assert.equal(c1.orders.wine, 'get');
  assert.equal(copy.buildings.get(w2.id).orders.oil, 'refuse');
  assert.equal([...copy.buildings.values()].find((b) => b.type === 'granary').emptying, true);
  assert.equal(c1.incoming.wine, 400, 'the hold for the cart on its way');
  settle(copy);
  assert.equal(c1.stock.wine, 400);
  assert.equal(c1.incoming.wine, 0);
});

test('a demo city with Get and Empty orders keeps its books straight', () => {
  const game = newGame({ seed: 'orders-city' });
  assert.ok(buildDemoCity(game, { level: 2 }).ok);
  game.runDays(16 * 3);
  const stores = [...game.buildings.values()].filter((b) => b.orders);
  assert.ok(stores.length >= 2, 'the demo city has storage');
  for (const b of stores) {
    if (b.type === 'granary') setOrder(b, 'wheat', 'get');
    else setOrder(b, 'pottery', 'get');
  }
  setEmptying(stores[stores.length - 1], true);
  game.runDays(16 * 3);
  for (const b of game.buildings.values()) {
    if (b.stock) for (const [k, v] of Object.entries(b.stock)) assert.ok(v >= 0, `${b.type} ${k} ${v}`);
    if (b.incoming) for (const [k, v] of Object.entries(b.incoming)) assert.ok(v >= 0, `${b.type} incoming ${k} ${v}`);
  }
  // Every hold at a storage building belongs to a cart still on its way.
  for (const b of stores) {
    let held = 0;
    for (const w of game.walkers.values()) if (w.reserve && w.reserve.id === b.id && w.reserve.good) held += w.reserve.amount;
    const incoming = Object.values(b.incoming).reduce((s, v) => s + v, 0);
    assert.equal(incoming, held, `${b.type} #${b.id} holds only for carts on their way`);
  }
});

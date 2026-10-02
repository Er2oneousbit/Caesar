/**
 * horses.test.mjs - horses live at the Horse Ranch, never in a warehouse (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Covers data/goods.js keptAt and its rules in sim/storage.js, production.js,
 * trade.js and core/save.js: warehouses refuse horses (no order, no cart, no
 * caravan); a ranch keeps its horses in its stables (STABLE_CAPACITY, a full
 * ranch foals no more) until a barracks needs them, then its groom leads
 * them straight there; horses bought by sea go to a ranch with room, none
 * without a ranch (and the Trade advisor says so); horses sold come from
 * the ranches (caravan and ship); the city's stock, the Production advisor
 * and the Emperor count and take the ranches' horses; and a real version 16
 * save with horses in a warehouse loads with them moved to the ranch.
 *
 * Buildings line up above one straight desert road, so road distances are
 * plain differences in x. The clock is driven by hand and staffing is set
 * directly (no homes or labor needed).
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { TRADE_PARTNERS } from '../src/data/scenarios.js';
import { STABLE_CAPACITY } from '../src/data/units.js';
import { addBuilding, spawnWalker } from '../src/sim/entities.js';
import { updateWalkers } from '../src/sim/walkers.js';
import { updateProducer } from '../src/sim/production.js';
import { updateDemand } from '../src/sim/military.js';
import { storageAccepts, receiveGoods, findDeliveryTarget, cityStock, storageSpaceFor } from '../src/sim/storage.js';
import { updateStorage, orderGoods, collectArrive } from '../src/sim/storageOrders.js';
import { setTradeMode, shipArrive, updateDock, shipManifest, tradeAt, importBlockedText, importWarnings, keptImportRoom } from '../src/sim/trade.js';
import { fulfillRequest, updateEmperor, keptCap, describeRequest } from '../src/sim/emperor.js';
import { productionReport } from '../src/ui/production.js';
import { buildingStatus, importsPilingText } from '../src/ui/infoPanel.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { newGame, build, findFree } from './helpers.mjs';

log.setLevel('error');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TPD = CONFIG.TICKS_PER_DAY;

/**
 * A desert map with a straight road 64 tiles long. `place(dx, type)` puts a
 * staffed, empty 3x3 building above the road dx tiles along. Trade is off
 * for every good and no trader comes on its own.
 */
function strip() {
  const game = newGame({ type: 'desert', size: 96, seed: 'horses' });
  const spot = findFree(game, 70, 4);
  assert.ok(spot, 'a free strip of land');
  const ry = spot.y + 3;
  assert.ok(build(game, 'road', spot.x, ry, spot.x + 69, ry).ok, 'road laid');
  const place = (dx, type) => {
    const b = addBuilding(game, type, spot.x + dx, ry - BUILDINGS[type].size);
    assert.ok(b.accessRoad >= 0, `${type} at +${dx} touches the road`);
    b.efficiency = 1;
    if (b.stock) for (const k of Object.keys(b.stock)) b.stock[k] = 0;
    return b;
  };
  for (const g of Object.keys(game.city.trade.settings)) setTradeMode(game, g, 'none');
  for (const r of Object.values(game.city.trade.routes)) r.nextVisit = 1e9;
  return { game, place, road: game.map.idx(spot.x, ry) };
}

/** Walk every walker for `days` days (no daily updates). */
function walk(game, days) {
  for (let t = 0; t < days * TPD; t++) { game.time.advance(); updateWalkers(game); }
}

const carts = (game) => [...game.walkers.values()].filter((w) => w.type === 'cart');

/** Give a trade partner extra goods to buy or sell for one test (no partner buys horses yet). */
function withDeal(partner, side, good, n, fn) {
  const deal = TRADE_PARTNERS[partner][side];
  const had = deal[good];
  deal[good] = n;
  try { return fn(); } finally { if (had === undefined) delete deal[good]; else deal[good] = had; }
}

// ---------------------------------------------------------------------------
// Warehouses and the ranch
// ---------------------------------------------------------------------------

test('warehouses never take horses: no place, no order, no cart sent there', () => {
  const { game, place, road } = strip();
  const wh = place(10, 'warehouse');
  assert.equal('horses' in wh.stock, false, 'no horses in a warehouse');
  assert.equal(orderGoods(wh).includes('horses'), false, 'no order for horses in its panel');
  assert.equal(storageAccepts(wh, 'horses'), false);
  assert.equal(receiveGoods(wh, 'horses', 100), 0, 'a delivery is turned away');
  assert.equal(findDeliveryTarget(game, road, 'horses', 100), null, 'no cart takes horses to a warehouse, even an empty one');
  // A ranch with room is where they go.
  const ranch = place(20, 'horse_ranch');
  assert.equal(findDeliveryTarget(game, road, 'horses', 100)?.id, ranch.id);
  // ...but never from one ranch to another.
  assert.equal(findDeliveryTarget(game, road, 'horses', 100, place(30, 'horse_ranch').id)?.id, undefined);
});

test('a ranch keeps its horses until a barracks needs them, then a groom leads them straight there', () => {
  const { game, place } = strip();
  const wh = place(4, 'warehouse');
  const ranch = place(12, 'horse_ranch');
  const barracks = place(24, 'barracks');
  ranch.stock.horses = 300;
  const day = () => { updateDemand(game); updateProducer(game, ranch); walk(game, 1); };
  for (let d = 0; d < 10; d++) day();
  assert.equal(ranch.stock.horses, 300, 'no fort needs cavalry: the horses stay at the ranch');
  assert.equal(carts(game).length, 0, 'and no cart takes them to the warehouse');
  assert.equal('horses' in wh.stock, false);
  // A cavalry fort with empty places: the forts need 8 horses.
  place(40, 'fort_cavalry');
  day();
  const groom = carts(game).find((w) => w.origin === ranch.id);
  assert.ok(groom, 'a groom sets out');
  assert.equal(groom.target, barracks.id, 'to the barracks');
  assert.deepEqual(groom.cargo, { good: 'horses', amount: 300 });
  for (let d = 0; d < 20; d++) day();
  assert.equal(barracks.stock.horses, 300, 'the barracks has them');
  assert.equal(ranch.stock.horses, 0);
  assert.equal('horses' in wh.stock, false, 'none went to the warehouse');
});

test('the stables hold 8 horses: a full ranch foals no more, and says so', () => {
  const { game, place } = strip();
  const ranch = place(12, 'horse_ranch');
  Object.assign(ranch, { fertility: 1, herd: 8, progress: 99.9, laborAccess: 1 });
  ranch.stock.horses = STABLE_CAPACITY - 100;
  updateProducer(game, ranch);
  assert.equal(ranch.stock.horses, STABLE_CAPACITY, 'the last foal fits');
  for (let d = 0; d < 120; d++) updateProducer(game, ranch);
  assert.equal(ranch.stock.horses, STABLE_CAPACITY, 'no more foals while full');
  assert.match(buildingStatus(game, ranch).text, /stables are full/);
  // Room held for horses on their way in counts as taken.
  ranch.stock.horses = STABLE_CAPACITY - 100;
  ranch.incoming.horses = 100;
  ranch.progress = 99.9;
  updateProducer(game, ranch);
  assert.equal(ranch.stock.horses, STABLE_CAPACITY - 100, 'no foal into room an import has claimed');
});

// ---------------------------------------------------------------------------
// Trade
// ---------------------------------------------------------------------------

/** A Dock at the strip's start, Cirta's route open (it sells horses by sea), and a moorer. */
function harbor() {
  const s = strip();
  const dock = s.place(0, 'dock');
  s.game.city.trade.routes.cirta.open = true;
  const moor = () => {
    const ship = spawnWalker(s.game, 'ship', dock.accessRoad, null, { partner: 'cirta', target: dock.id, state: 'toDock' });
    dock.shipId = ship.id;
    shipArrive(s.game, ship);
    return ship;
  };
  /** Until the ship sails and every cart is home. */
  const run = (ship, maxDays = 60) => {
    for (let t = 0; t < maxDays * TPD && (ship.state === 'docked' || carts(s.game).length); t++) {
      s.game.time.advance();
      updateWalkers(s.game);
      if (s.game.time.tick === dock.phase && ship.state === 'docked') updateDock(s.game, dock);
    }
  };
  return { ...s, dock, moor, run };
}

test('horses bought by sea go to a ranch with room, never a warehouse; with no ranch none are bought', () => {
  // No ranch: the ship brings no horses, and the Trade advisor says why.
  {
    const { game, place, moor } = harbor();
    place(6, 'warehouse');
    setTradeMode(game, 'horses', 'import', 800);
    assert.match(importBlockedText(game, 'horses'), /cannot be imported/);
    const ship = moor();
    assert.equal(ship.unload?.horses, undefined, 'no horses in the manifest');
  }
  const { game, place, dock, moor, run } = harbor();
  const wh = place(6, 'warehouse');
  const ranch = place(14, 'horse_ranch');
  setTradeMode(game, 'horses', 'import', 800);
  assert.equal(importBlockedText(game, 'horses'), null);
  ranch.stock.horses = 300; // room for 5 more
  assert.equal(shipManifest(game, 'cirta', dock).unload.horses, 500, 'up to the import level, which the ranch has room for');
  ranch.stock.horses = 100; // room for 7, the level wants 7: the partner's 600 a year is the limit
  assert.equal(shipManifest(game, 'cirta', dock).unload.horses, 600);
  ranch.stock.horses = 600; // room for 2, the level wants 2
  const ship = moor();
  assert.equal(ship.unload.horses, 200);
  run(ship);
  assert.equal(ranch.stock.horses, 800, 'the bought horses are at the ranch');
  assert.equal('horses' in wh.stock, false, 'none in the warehouse');
  assert.equal(cityStock(game, 'horses'), 800);
  // Full stables: no more can come in, and the advisor says so.
  setTradeMode(game, 'horses', 'import', 1600);
  assert.match(importBlockedText(game, 'horses'), /stables are full/);
  const next = moor();
  assert.equal(next.unload?.horses, undefined, 'a full ranch takes no more');
});

test('horses sold are taken from the ranches: by a caravan and by a ship', () => {
  // A caravan at a warehouse sells the horses of the ranch on its roads.
  withDeal('tarraco', 'buys', 'horses', 600, () => {
    const { game, place } = strip();
    const wh = place(6, 'warehouse');
    const ranch = place(14, 'horse_ranch');
    ranch.stock.horses = 500;
    setTradeMode(game, 'horses', 'export', 200);
    game.city.trade.routes.tarraco.open = true;
    const out = tradeAt(game, 'tarraco', wh);
    assert.equal(out.sold.horses, 300, 'down to the export level');
    assert.equal(ranch.stock.horses, 200);
  });
  // A caravan selling horses puts them in the ranch, not the warehouse.
  withDeal('tarraco', 'sells', 'horses', 600, () => {
    const { game, place } = strip();
    const wh = place(6, 'warehouse');
    const ranch = place(14, 'horse_ranch');
    setTradeMode(game, 'horses', 'import', 400);
    game.city.trade.routes.tarraco.open = true;
    const out = tradeAt(game, 'tarraco', wh);
    assert.equal(out.bought.horses, 400);
    assert.equal(ranch.stock.horses, 400);
    assert.equal('horses' in wh.stock, false);
  });
  // A ship's dock workers fetch them from a staffed ranch near the Emporium.
  withDeal('cirta', 'buys', 'horses', 600, () => {
    const { game, place, moor, run } = harbor();
    place(6, 'warehouse');
    const ranch = place(14, 'horse_ranch');
    ranch.stock.horses = 400;
    setTradeMode(game, 'horses', 'export', 100);
    const ship = moor();
    assert.equal(ship.wants.horses, 300);
    run(ship);
    assert.equal(ship.deal.sold.horses, 300, 'three horses went aboard');
    assert.equal(ranch.stock.horses, 100, 'from the ranch, down to the export level');
  });
});

// ---------------------------------------------------------------------------
// The city's stock and the Emperor
// ---------------------------------------------------------------------------

test("the city's stock counts the ranches' horses; the Emperor's request takes them from there", () => {
  const { game, place } = strip();
  const ranch = place(12, 'horse_ranch');
  const other = place(20, 'horse_ranch');
  ranch.stock.horses = 300;
  other.stock.horses = 200;
  assert.equal(cityStock(game, 'horses'), 500);
  assert.equal(productionReport(game).goods.find((r) => r.good === 'horses')?.stock, 500, 'the Production advisor shows them');
  game.city.request = { kind: 'goods', good: 'horses', amount: 400, deadline: game.time.totalMonths + 12 };
  assert.ok(fulfillRequest(game).ok, 'the request can be sent');
  assert.equal(ranch.stock.horses + other.stock.horses, 100, 'four horses went to Rome');
});

// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

test('save: a real version 16 save with horses in a warehouse moves them to the ranch; the rest follow when it has room', () => {
  const raw = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/save-v16-horses-in-warehouse.json'), 'utf8'));
  assert.equal(raw.version, 16);
  const rawWh = raw.buildings.find((b) => b.type === 'warehouse' && b.stock.horses > 0);
  const rawRanch = raw.buildings.find((b) => b.type === 'horse_ranch');
  assert.deepEqual([rawWh.stock.horses, rawRanch.stock.horses, rawRanch.incoming], [700, 400, null], 'the fixture as made');
  const before = raw.buildings.reduce((n, b) => n + (b.stock?.horses || 0), 0);
  const game = deserializeGame(raw);
  const wh = game.buildings.get(rawWh.id);
  const ranch = game.buildings.get(rawRanch.id);
  assert.equal(ranch.stock.horses, STABLE_CAPACITY, 'the ranch filled first');
  assert.equal(wh.stock.horses, 300, 'what it had no room for stays at the warehouse');
  assert.deepEqual(ranch.incoming, { horses: 0 });
  assert.equal('horses' in wh.orders, false, 'no order for horses any more');
  assert.equal(wh.incoming.horses, 0, 'its incoming keeps a horses entry for the old carts');
  assert.equal([...game.buildings.values()].reduce((n, b) => n + (b.stock?.horses || 0), 0), before, 'no horse lost');
  // Room at the ranch (horses gone to the cavalry): the warehouse sends the rest there.
  ranch.stock.horses = 0;
  ranch.efficiency = 1;
  wh.efficiency = 1;
  for (let d = 0; d < 60 && wh.stock.horses > 0; d++) { updateStorage(game, wh); walk(game, 1); }
  walk(game, 10);
  assert.equal(wh.stock.horses, 0, 'the warehouse has none left');
  assert.ok(ranch.stock.horses >= 300, `they reached the ranch (${ranch.stock.horses})`);
  // And a save made now loads as it was (no upgrade again).
  const again = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  assert.equal(again.buildings.get(ranch.id).stock.horses, ranch.stock.horses);
});

// ---------------------------------------------------------------------------
// Found in review
// ---------------------------------------------------------------------------

test('review: a sea import in several lots all lands at a far, empty ranch (a dock worker on his way is not counted twice)', () => {
  const { game, place, dock, moor, run } = harbor();
  const ranch = place(30, 'horse_ranch');
  setTradeMode(game, 'horses', 'import', 800);
  const ship = moor();
  assert.equal(ship.unload.horses, 600, "Cirta's year: 600");
  // While a lot is on its way, the room it goes to is held at the ranch, not taken twice.
  let seen = false;
  for (let t = 0; t < 40 * TPD && ship.state === 'docked'; t++) {
    game.time.advance();
    updateWalkers(game);
    if (game.time.tick === dock.phase && ship.state === 'docked') updateDock(game, dock);
    if (ranch.incoming.horses > 0 && !seen) {
      seen = true;
      assert.equal(keptImportRoom(game, 'horses', 0, false), STABLE_CAPACITY - ranch.stock.horses - ranch.incoming.horses - dock.stock.horses);
      assert.deepEqual(importWarnings(game), [], 'the advisor does not call an empty ranch full');
    }
  }
  run(ship);
  assert.ok(seen, 'a dock worker carried horses to the ranch');
  assert.equal(ship.deal.bought.horses, 600, 'every lot landed');
  assert.equal(ranch.stock.horses, 600, 'and reached the ranch');
});

test('review: an older save keeps its warehouse horse entries for carts still on the road', () => {
  const raw = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/save-v16-horses-in-warehouse.json'), 'utf8'));
  const rawWh = raw.buildings.find((b) => b.type === 'warehouse' && b.stock.horses > 0);
  rawWh.stock.horses = 400; // all of it fits at the ranch: the warehouse is left with none
  const game = deserializeGame(raw);
  const wh = game.buildings.get(rawWh.id);
  assert.equal(wh.stock.horses, 0, 'moved to the ranch');
  // A cart of the old save coming home with horses puts them back, none lost.
  assert.equal(receiveGoods(wh, 'horses', 100, true), 100);
  assert.equal(wh.stock.horses, 100);
  // A Get cart of the old save fetching horses from another warehouse shrinks no hold to NaN.
  const src = addBuilding(game, 'warehouse', 2, 2);
  src.stock.horses = 100;
  const cart = spawnWalker(game, 'cart', wh.accessRoad, wh, { target: src.id, want: 'horses', state: 'collect', reserve: { id: wh.id, good: 'horses', amount: 100 } });
  wh.incoming.horses += 100;
  collectArrive(game, cart);
  for (const [g, n] of Object.entries(wh.incoming)) assert.ok(Number.isFinite(n), `incoming ${g} is ${n}`);
  wh.efficiency = 1;
  assert.ok(storageSpaceFor(wh, 'wine') > 0, 'the warehouse still takes deliveries');
});

test('review: the Emperor asks for horses only while a ranch stands, in whole horses its stables can hold', () => {
  const ask = (game, n = 400) => {
    const asked = [];
    game.city.population = 6000;
    for (let i = 0; i < n; i++) {
      game.city.request = null;
      game.city.nextRequestMonth = 0;
      updateEmperor(game);
      if (game.city.request?.kind === 'goods') asked.push(game.city.request);
    }
    return asked.filter((r) => r.good === 'horses');
  };
  const { game, place } = strip();
  game.difficulty = { ...game.difficulty, requestSize: 1.5 }; // Insane's larger requests
  assert.equal(ask(game).length, 0, 'no ranch: never horses');
  place(12, 'horse_ranch');
  const horses = ask(game);
  assert.ok(horses.length > 0, 'with a ranch, horses are asked for');
  for (const r of horses) {
    assert.equal(r.amount % 100, 0, `whole horses (${r.amount})`);
    assert.ok(r.amount >= 100 && r.amount <= STABLE_CAPACITY, `no more than one ranch holds (${r.amount})`);
  }
  assert.equal(keptCap(game, 'horses', 350), 400, 'rounded to whole horses');
  assert.equal(keptCap(game, 'horses', 2400), STABLE_CAPACITY, 'one ranch: 8 horses at most');
  assert.equal(keptCap(game, 'wine', 350), 350, 'other goods unchanged');
  assert.equal(describeRequest({ kind: 'goods', good: 'horses', amount: 400 }), '4 horses');
});

test('review: horses a groom brings home past the cap go on to another ranch with room, none lost', () => {
  const { game, place } = strip();
  const ranch = place(12, 'horse_ranch');
  const other = place(30, 'horse_ranch');
  ranch.stock.horses = STABLE_CAPACITY;
  assert.equal(receiveGoods(ranch, 'horses', 300, true), 300, 'its own groom is always let in');
  for (let d = 0; d < 30; d++) { updateDemand(game); updateProducer(game, ranch); walk(game, 1); }
  walk(game, 10);
  assert.equal(ranch.stock.horses, STABLE_CAPACITY, 'back to a full stable');
  assert.equal(other.stock.horses, 300, 'the rest went to the other ranch');
});

test('review: the Trade advisor warns about horses only while they are on Import from an open route', () => {
  const { game } = strip();
  game.city.trade.routes.cirta.open = false;
  setTradeMode(game, 'horses', 'none');
  assert.deepEqual(importWarnings(game), []);
  setTradeMode(game, 'horses', 'import', 800);
  assert.deepEqual(importWarnings(game), [], 'no open route sells them');
  game.city.trade.routes.cirta.open = true;
  assert.equal(importWarnings(game).length, 1);
  assert.match(importWarnings(game)[0], /cannot be imported/);
  setTradeMode(game, 'horses', 'none');
  assert.deepEqual(importWarnings(game), [], 'not on Import: nothing to say');
});

test('review: a Dock with horses stuck on its quay says where horses go', () => {
  const { place } = strip();
  const dock = place(0, 'dock');
  dock.stock.wine = 400;
  assert.doesNotMatch(importsPilingText(dock), /Equaria/);
  dock.stock.horses = 200;
  assert.match(importsPilingText(dock), /Equaria \(Horse Ranch\) with room or a Tirocinium/);
});

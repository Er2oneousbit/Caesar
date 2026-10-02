/**
 * tradeSwitches.test.mjs - trade by partner (sim/tradeSwitches.js; node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Each route card has a switch per good: a good trades with a partner only
 * while its global setting allows it and that partner's switch is on. These
 * check caravans (exports and imports), a ship's manifest and a ship
 * switched off mid-stay, imports on their way, a partner with every switch
 * off (no traders), the busy-route pace, wine sources, the Trade advisor's
 * words and the save upgrade. The sandbox's partners (data/scenarios.js):
 * Tarraco and Capua both buy pottery by land; Capua sells wine by land and
 * Massilia by sea; Massilia also buys pottery.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { spawnWalker, addBuilding } from '../src/sim/entities.js';
import {
  setTradeMode, tradeAt, caravanArrive, shipManifest, shipArrive, dockBerth, importsComing, importWarnings, updateTrade, newTradeState,
  dockFetchArrive, dockWorkerHome, updateDock, dockDispatch, keptImportRoom,
} from '../src/sim/trade.js';
import { routeInterval, usualInterval } from '../src/sim/tradeDemand.js';
import { partnerOn, setPartnerGood, onlyOn, partnerIdle, partnersFor } from '../src/sim/tradeSwitches.js';
import { updateWineSources } from '../src/sim/housing.js';
import { tripDays } from '../src/data/empireRoutes.js';
import { homeSiteId } from '../src/data/sites.js';
import { buildDemoCity, buildDemoHarbor } from '../src/dev/demoCity.js';
import { tradeLogLine } from '../src/ui/advisors.js';
import { empireTravelers } from '../src/ui/empireMap.js';
import { newGame } from './helpers.mjs';

log.setLevel('error');

/** A demo city with a staffed warehouse on the road (and a dock on the coast), every good on No trade. */
function tradeCity() {
  const game = newGame({ type: 'coast', seed: 'beach' });
  const res = buildDemoCity(game, { level: 1 });
  assert.ok(res.ok, res.reason);
  const harbor = buildDemoHarbor(game, res.center);
  assert.ok(harbor.ok && harbor.warehouse && harbor.warehouse.accessRoad >= 0, 'a warehouse on the road');
  const wh = harbor.warehouse;
  wh.efficiency = 1;
  for (const k of Object.keys(wh.stock)) wh.stock[k] = 0;
  for (const g of Object.keys(game.city.trade.settings)) setTradeMode(game, g, 'none');
  for (const r of Object.values(game.city.trade.routes)) r.nextVisit = 1e9; // only the traders sent here
  game.city.treasury = 50000;
  return { game, wh, dock: harbor.dock, center: res.center };
}

test('switches: all on by default, and a switch is stored only while off', () => {
  const state = newTradeState(['tarraco', 'capua']);
  assert.deepEqual(state.routes.tarraco.off, {}, 'a new route has every switch on');
  const game = newGame({ type: 'coast', seed: 'beach' });
  for (const id of Object.keys(game.city.trade.routes)) {
    for (const g of Object.keys(game.city.trade.settings)) assert.equal(partnerOn(game, id, g), true);
  }
  setPartnerGood(game, 'capua', 'pottery', false);
  assert.equal(partnerOn(game, 'capua', 'pottery'), false);
  assert.equal(partnerOn(game, 'tarraco', 'pottery'), true, 'the other partner keeps its own switch');
  assert.deepEqual(game.city.trade.routes.capua.off, { pottery: true });
  assert.deepEqual(onlyOn(game, 'capua', { pottery: 800, iron: 600 }), { iron: 600 });
  setPartnerGood(game, 'capua', 'pottery', true);
  assert.deepEqual(game.city.trade.routes.capua.off, {}, 'switched on again: nothing stored');
  setPartnerGood(game, 'nowhere', 'pottery', false); // an unknown partner or good is ignored
  setPartnerGood(game, 'capua', 'nothing', false);
  assert.deepEqual(game.city.trade.routes.capua.off, {});
});

test('a caravan from a buyer switched off buys none of that good; another buyer still does', () => {
  const { game, wh } = tradeCity();
  wh.stock.pottery = 1200;
  setTradeMode(game, 'pottery', 'export', 0);
  setPartnerGood(game, 'tarraco', 'pottery', false);
  const before = game.city.treasury;
  const off = tradeAt(game, 'tarraco', wh);
  assert.deepEqual(off.sold, {}, 'Tarraco is switched off for pottery: it buys none');
  assert.equal(wh.stock.pottery, 1200);
  assert.equal(game.city.treasury, before);
  assert.equal(game.city.trade.routes.tarraco.sold.pottery, undefined, 'its quota is untouched');
  const on = tradeAt(game, 'capua', wh);
  assert.equal(on.sold.pottery, 800, 'Capua, still on, buys its 800');
  assert.equal(wh.stock.pottery, 400);
  // Switched back on, Tarraco buys again.
  setPartnerGood(game, 'tarraco', 'pottery', true);
  assert.equal(tradeAt(game, 'tarraco', wh).sold.pottery, 400);
});

test('a caravan from a seller switched off brings none of that good', () => {
  const { game, wh } = tradeCity();
  setTradeMode(game, 'wine', 'import', 600);
  setTradeMode(game, 'wheat', 'import', 400);
  wh.orders.wine = 'accept';
  wh.orders.wheat = 'accept';
  setPartnerGood(game, 'capua', 'wine', false);
  const out = tradeAt(game, 'capua', wh);
  assert.equal(out.bought.wine, undefined, 'no wine from Capua');
  assert.equal(wh.stock.wine, 0);
  assert.equal(out.bought.wheat, 400, 'its wheat, still on, comes in');
  // The trade log names what changed hands, so the player sees whom it went to.
  const w = spawnWalker(game, 'caravan', wh.accessRoad, null, { partner: 'capua', target: wh.id, state: 'toWarehouse' });
  setPartnerGood(game, 'capua', 'wine', true);
  caravanArrive(game, w);
  const entry = game.city.trade.log[0];
  assert.equal(entry.partner, 'Capua');
  assert.deepEqual(entry.bought, { wine: 600 });
  assert.match(tradeLogLine(entry), /^.+ 🐪 Capua: bought wine 600: \+0 \/ −[\d,]+ Dn$/, tradeLogLine(entry));
  assert.match(tradeLogLine({ date: 'Mar 12', kind: 'sea', partner: 'Massilia', sold: { pottery: 200 }, bought: { wine: 100 }, earned: 320, spent: 215 }),
    /^Mar 12 ⛵ Massilia: sold pottery 200; bought wine 100: \+320 \/ −215 Dn$/);
});

test('the global setting stays the master: a switch on never trades a good on No trade, or the other way', () => {
  const { game, wh } = tradeCity();
  wh.stock.pottery = 1000;
  wh.orders.wine = 'accept';
  // Pottery on No trade, wine on Export (Capua sells wine, it never buys it): every switch on.
  setTradeMode(game, 'wine', 'export', 0);
  wh.stock.wine = 0;
  const out = tradeAt(game, 'capua', wh);
  assert.deepEqual(out.sold, {}, 'no pottery sold while it is on No trade');
  assert.deepEqual(out.bought, {}, 'no wine bought while it is on Export');
  // On Export with the switch on, it sells; off again, nothing.
  setTradeMode(game, 'pottery', 'export', 600);
  assert.equal(tradeAt(game, 'capua', wh).sold.pottery, 400, 'down to the export level, no lower');
  wh.stock.pottery = 1000;
  setPartnerGood(game, 'capua', 'pottery', false);
  assert.deepEqual(tradeAt(game, 'capua', wh).sold, {});
});

test("a ship's manifest leaves out the goods switched off with its partner, and one switched off mid-stay is dropped", () => {
  const { game, wh, dock } = tradeCity();
  assert.ok(dock, 'a dock');
  dock.efficiency = 1;
  wh.stock.pottery = 800;
  setTradeMode(game, 'pottery', 'export', 0);
  setTradeMode(game, 'wine', 'import', 600);
  assert.deepEqual(shipManifest(game, 'massilia', dock), { unload: { wine: 600 }, wants: { pottery: 600 } }, 'all on: as before');
  setPartnerGood(game, 'massilia', 'pottery', false);
  assert.deepEqual(shipManifest(game, 'massilia', dock), { unload: { wine: 600 }, wants: {} }, 'pottery off: it wants none');
  setPartnerGood(game, 'massilia', 'wine', false);
  assert.deepEqual(shipManifest(game, 'massilia', dock), { unload: {}, wants: {} }, 'wine off too: nothing to trade');
  setPartnerGood(game, 'massilia', 'pottery', true);
  setPartnerGood(game, 'massilia', 'wine', true);

  // Moored with both, then both switched off: imports on their way no longer
  // count it, nothing more lands, nothing goes aboard, and it sails.
  for (let d = 0; d < 60 && !(dock.efficiency >= 0.75 && wh.efficiency > 0); d++) game.runDays(1);
  game.runDays(40); // people to staff the harbor
  for (let d = 0; d < 60 && !(dock.efficiency >= 0.75 && wh.efficiency > 0); d++) game.runDays(1);
  assert.ok(dock.efficiency > 0 && wh.efficiency > 0, 'the dock and warehouse are staffed');
  for (const r of Object.values(game.city.trade.routes)) r.nextVisit = 1e9;
  wh.stock.pottery = 800;
  const ship = spawnWalker(game, 'ship', dockBerth(game, dock), null, { partner: 'massilia', target: dock.id, state: 'toDock', speed: CONFIG.SHIP_SPEED });
  dock.shipId = ship.id;
  shipArrive(game, ship);
  assert.equal(ship.state, 'docked');
  assert.equal(ship.unload.wine, 600);
  assert.ok(ship.wants.pottery > 0);
  assert.equal(importsComing(game, 'wine'), 600, 'its wine counts as on its way');
  setPartnerGood(game, 'massilia', 'wine', false);
  setPartnerGood(game, 'massilia', 'pottery', false);
  assert.equal(importsComing(game, 'wine'), 0, 'switched off: it will not land, so it is not counted');
  const pottery = wh.stock.pottery + dock.stock.pottery;
  for (let d = 0; d < CONFIG.SHIP_MAX_STAY_DAYS + 1 && ship.state === 'docked'; d++) game.runDays(1);
  assert.notEqual(ship.state, 'docked', 'it sailed');
  assert.equal(ship.deal.bought.wine || 0, 0, 'no wine landed after the switch');
  assert.equal(ship.deal.sold.pottery || 0, 0, 'no pottery went aboard after the switch');
  let held = 0;
  for (const b of game.buildings.values()) held += b.stock?.pottery || 0;
  for (const w of game.walkers.values()) if (w.cargo?.good === 'pottery') held += w.cargo.amount;
  assert.ok(held >= pottery, `the city kept its pottery (${held} of ${pottery})`);
});

test('a moored ship, export switched off lot by lot: no quay hand-over, no fetch, a claim released, a lot brought back kept and unpaid', () => {
  const { game, wh, dock } = tradeCity();
  game.runDays(40); // people to staff the harbor
  for (let d = 0; d < 60 && !(dock.efficiency >= 0.75 && wh.efficiency > 0); d++) game.runDays(1);
  assert.ok(dock.efficiency >= 0.75 && wh.efficiency > 0, 'the dock (3 workers) and warehouse are staffed');
  for (const r of Object.values(game.city.trade.routes)) r.nextVisit = 1e9;
  for (const w of [...game.walkers.values()]) if (w.type === 'cart' && w.origin === dock.id) game.walkers.delete(w.id);
  for (const k of Object.keys(dock.stock)) dock.stock[k] = 0;
  wh.stock.pottery = 1200;
  setTradeMode(game, 'pottery', 'export', 0);
  setTradeMode(game, 'wine', 'none');
  const ship = spawnWalker(game, 'ship', dockBerth(game, dock), null, { partner: 'massilia', target: dock.id, state: 'toDock', speed: CONFIG.SHIP_SPEED });
  dock.shipId = ship.id;
  shipArrive(game, ship);
  assert.deepEqual(ship.wants, { pottery: 600 });
  const out = [...game.walkers.values()].filter((w) => w.claim && w.claim.ship === ship.id);
  assert.ok(out.length >= 1, 'dock workers set out to fetch it');
  setPartnerGood(game, 'massilia', 'pottery', false);
  const earned = ship.deal.earned;
  const treasury = game.city.treasury;
  // A worker reaching the warehouse after the switch loads nothing and lets go of its claim.
  const fetcher = out[0];
  const whStock = wh.stock.pottery;
  dockFetchArrive(game, fetcher);
  assert.equal(wh.stock.pottery, whStock, 'nothing taken from the warehouse');
  assert.ok(!fetcher.claim || fetcher.claim.ship !== ship.id, 'its claim for the ship is let go');
  assert.equal(ship.state, 'docked', 'still moored: other workers are out for it');
  // Pottery on the quay does not go aboard, and the ship stops wanting it
  // (so dock workers may cart that pottery to storage).
  dock.stock.pottery = 200;
  updateDock(game, dock);
  assert.equal(ship.wants.pottery, undefined, 'it wants no more pottery');
  assert.equal(ship.deal.earned, earned, 'nothing handed over from the quay');
  assert.equal(ship.deal.sold.pottery || 0, 0);
  // A lot fetched before the switch, brought back after it, while the ship
  // (moored again here, still wanting pottery) waits: it stays the city's, unpaid.
  ship.state = 'docked';
  dock.shipId = ship.id;
  ship.wants = { pottery: 200 };
  const cityPottery = () => dock.stock.pottery + [...game.walkers.values()]
    .filter((w) => w.type === 'cart' && w.origin === dock.id && !w.claim && w.cargo?.good === 'pottery').reduce((n, w) => n + w.cargo.amount, 0);
  const before = cityPottery();
  const back = spawnWalker(game, 'cart', dock.accessRoad, dock, { speed: CONFIG.CART_SPEED, state: 'return', cargo: { good: 'pottery', amount: 200 }, claim: { ship: ship.id, partner: 'massilia', good: 'pottery', amount: 200, wh: wh.id, picked: true } });
  dockWorkerHome(game, back, dock);
  assert.equal(cityPottery() - before, 200, "the lot stays the city's: on the quay, or on its way back to storage");
  assert.equal(ship.deal.earned, earned, 'not paid for any of it');
  assert.equal(ship.deal.sold.pottery || 0, 0);
  assert.equal(game.city.treasury, treasury);
});

test('import room for horses ignores a moored ship switched off for them', () => {
  const { game, dock } = tradeCity();
  const ranch = addBuilding(game, 'horse_ranch', 2, 2);
  ranch.efficiency = 1;
  ranch.stock.horses = 0;
  ranch.incoming = { horses: 0 };
  const room = keptImportRoom(game, 'horses');
  assert.ok(room > 0, `the ranch has room (${room})`);
  const ship = spawnWalker(game, 'ship', dockBerth(game, dock), null, { partner: 'cirta', target: dock.id, state: 'docked', unload: { horses: 200 }, wants: {} });
  assert.ok(ship);
  assert.equal(keptImportRoom(game, 'horses'), room - 200, 'Cirta\'s horses aboard hold room');
  setPartnerGood(game, 'cirta', 'horses', false);
  assert.equal(keptImportRoom(game, 'horses'), room, 'switched off: they will not land, so they hold none');
});

test('a partner with every good switched off sends no traders; one switched on comes when due', () => {
  const { game } = tradeCity();
  const route = game.city.trade.routes.capua;
  route.open = true;
  const caravans = () => [...game.walkers.values()].filter((w) => w.type === 'caravan' && w.partner === 'capua' && !w.dead).length;
  for (const g of ['wheat', 'wine', 'pottery', 'furniture', 'iron', 'clothing']) setPartnerGood(game, 'capua', g, false);
  assert.equal(partnerIdle(game, 'capua', { pottery: 800, furniture: 600, iron: 600, clothing: 600 }), true);
  assert.ok(!empireTravelers(game).some((t) => t.id === 'capua'), 'the empire map shows nobody coming');
  route.nextVisit = game.time.totalDays;
  updateTrade(game);
  assert.equal(caravans(), 0, 'nobody set out');
  const [a, b] = routeInterval(game, 'capua');
  const wait = route.nextVisit - game.time.totalDays;
  assert.ok(wait >= a && wait <= b, `the wait runs as usual (${wait} in ${a} to ${b})`);
  setPartnerGood(game, 'capua', 'pottery', true);
  assert.equal(partnerIdle(game, 'capua', { pottery: 800 }), false);
  assert.ok(empireTravelers(game).some((t) => t.id === 'capua'), 'on the map again');
  route.nextVisit = game.time.totalDays;
  updateTrade(game);
  assert.equal(caravans(), 1, 'a caravan comes again');
  // A partner that deals in nothing is not "idle" by the switches.
  assert.equal(partnerIdle(game, 'nowhere', {}), false);
});

test("a busy route's pace counts only the goods switched on with it", () => {
  const game = newGame({ type: 'coast', seed: 'beach' });
  // Delos buys 8,000 a year (oil and wine 2,500 each): more than its ships carry at the usual pace.
  const usual = usualInterval('sea', tripDays(homeSiteId(game), 'delos'));
  const busy = routeInterval(game, 'delos');
  assert.ok(busy[1] < usual[1], `busy: every ${busy[0]} to ${busy[1]} days (usual ${usual[0]} to ${usual[1]})`);
  setPartnerGood(game, 'delos', 'oil', false);
  setPartnerGood(game, 'delos', 'wine', false);
  assert.deepEqual(routeInterval(game, 'delos'), usual, 'oil and wine off: 3,000 a year, the usual pace');
});

test('wine sources count only the sellers switched on, and the import warnings only those too', () => {
  const game = newGame({ type: 'coast', seed: 'beach' });
  const sellers = Object.keys(game.city.trade.routes).filter((id) => ['capua', 'massilia', 'rhodus'].includes(id));
  for (const id of sellers) game.city.trade.routes[id].open = true;
  setTradeMode(game, 'wine', 'import', 800);
  updateWineSources(game);
  assert.equal(game.city.wineSources, sellers.length);
  setPartnerGood(game, 'capua', 'wine', false);
  updateWineSources(game);
  assert.equal(game.city.wineSources, sellers.length - 1, 'Capua switched off: one kind of wine fewer');
  // Horses on Import from Cirta with no Horse Ranch: warned, unless Cirta is switched off for them.
  game.city.trade.routes.cirta.open = true;
  setTradeMode(game, 'horses', 'import', 400);
  assert.equal(importWarnings(game).length, 1);
  setPartnerGood(game, 'cirta', 'horses', false);
  assert.deepEqual(importWarnings(game), []);
});

test('the Goods table counts the partners switched on: "to 1 of 2 buyers"', () => {
  const game = newGame({ type: 'coast', seed: 'beach' });
  const ids = ['tarraco', 'capua', 'massilia'];
  const buysOf = (id) => ({ tarraco: { pottery: 800 }, capua: { pottery: 800 }, massilia: { pottery: 600 } })[id];
  assert.deepEqual(partnersFor(game, ids, 'pottery', 'export', buysOf), { on: 3, all: 3 });
  setPartnerGood(game, 'tarraco', 'pottery', false);
  assert.deepEqual(partnersFor(game, ids, 'pottery', 'export', buysOf), { on: 2, all: 3 });
  assert.deepEqual(partnersFor(game, ids, 'wine', 'import', buysOf), { on: 2, all: 2 }, 'wine: Capua and Massilia sell it');
});

test('save: the switches are kept, and a version 20 save loads with every switch on', () => {
  const game = newGame({ type: 'coast', seed: 'beach' });
  assert.equal(CONFIG.SAVE_VERSION, 21);
  setPartnerGood(game, 'capua', 'pottery', false);
  setPartnerGood(game, 'massilia', 'wine', false);
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  const again = deserializeGame(JSON.parse(JSON.stringify(data)));
  assert.equal(partnerOn(again, 'capua', 'pottery'), false, 'a switch off stays off');
  assert.equal(partnerOn(again, 'massilia', 'wine'), false);
  assert.equal(partnerOn(again, 'tarraco', 'pottery'), true);
  // A version 20 save: no `off` on its routes (what the old game would have written).
  for (const r of Object.values(data.city.trade.routes)) delete r.off;
  data.version = 20;
  const old = deserializeGame(data);
  for (const [id, r] of Object.entries(old.city.trade.routes)) {
    assert.deepEqual(r.off, {}, `${id}: every switch on`);
    assert.equal(partnerOn(old, id, 'pottery'), true);
  }
  setPartnerGood(old, 'capua', 'pottery', false); // and it can be switched
  assert.equal(partnerOn(old, 'capua', 'pottery'), false);
  old.runDays(5);
  assert.ok(Number.isFinite(old.city.treasury));
});

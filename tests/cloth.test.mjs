/**
 * cloth.test.mjs - the cloth industry and clothing in the housing ladder
 * (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Not in the original: a Flax Farm grows flax, a Linen Maker weaves it into
 * linen, a Clothing Maker sews the linen into clothing, and homes need
 * clothing from the Insula (level 12) up. Covered here: the data, the chain
 * from field to warehouse, the market's buyers and vendors, the need in the
 * ladder, the missions that unlock the chain and the partners that trade in
 * it, the capacity model, the cargo and building art, and loading a
 * version 9 save.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { GOODS, GOOD_KEYS, RAW_TYPES, MANUFACTURED, HOUSE_GOODS, FOOD_TYPES } from '../src/data/goods.js';
import { BUILDINGS, buildingsInCategory } from '../src/data/buildings.js';
import { HOUSE_TIERS } from '../src/data/housing.js';
import { GOD_KEYS } from '../src/data/gods.js';
import { SCENARIOS, TRADE_PARTNERS, findScenario } from '../src/data/scenarios.js';
import { addBuilding } from '../src/sim/entities.js';
import { updateHouse, consumeHouse } from '../src/sim/housing.js';
import { houseWantsGood, vendorSupply, updateMarketBuyer, buyerArrive, buyerUnload } from '../src/sim/market.js';
import { updateWarehouseSupply, updateProducer } from '../src/sim/production.js';
import { updateEmperor } from '../src/sim/emperor.js';
import { checkBuilding } from '../src/sim/construction.js';
import { topLevels, goodsAvailable, unlockedBuildings, planCity, SENSIBLE } from '../src/sim/capacity.js';
import { needReachable } from '../src/ui/problems.js';
import { describeNeed } from '../src/ui/infoPanel.js';
import { CARGO_ART, cargoArtOf } from '../src/render/cargoArt.js';
import { buildingSpec } from '../src/render/buildingArt.js';
import { recordingContext } from '../src/render/draw.js';
import { serializeGame, deserializeGame, upgradeClothV9, CLOTHING_GRACE_MONTHS } from '../src/core/save.js';
import { Game } from '../src/core/game.js';
import { buildDemoCity, buildDemoCloth } from '../src/dev/demoCity.js';
import { WaterBits, Terrain } from '../src/world/map.js';
import { newGame, build, findFree } from './helpers.mjs';

log.setLevel('error');

const CLOTH = ['farm_flax', 'linen_ws', 'clothing_ws'];
const INSULA = HOUSE_TIERS.findIndex((t) => t.name === 'Insula');
const TENEMENT = HOUSE_TIERS.findIndex((t) => t.name === 'Tenement');

/** Every service visit, food and good (clothing too unless told not to) in a home. */
function serveAll(h, { clothing = true } = {}) {
  for (const g of GOD_KEYS) h.religion[g] = 50;
  for (const v in h.ent) h.ent[v] = 50;
  for (const v in h.entBoth) h.entBoth[v] = 50;
  for (const k of ['school', 'library', 'academy', 'barber', 'clinic', 'baths', 'tax']) h[k] = 50;
  for (const f of FOOD_TYPES) h.food[f] = 500;
  for (const g of HOUSE_GOODS) h.goods[g] = 50;
  if (!clothing) h.goods.clothing = 0;
}

/** A 2x2 home of `level` on ground of desirability `des`, with fountain water and a hospital in reach. */
function bigHome(game, level, des) {
  const s = findFree(game, 2, 2);
  const b = addBuilding(game, 'house', s.x, s.y, 2);
  b.house.tier = level;
  b.house.pop = HOUSE_TIERS[level].people;
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const i = game.map.idx(s.x + dx, s.y + dy);
      game.map.desirability[i] = des;
      game.map.water[i] = WaterBits.FOUNTAIN | WaterBits.WELL | WaterBits.HOSPITAL;
    }
  }
  return b;
}

// ---------------------------------------------------------------------------
// The data
// ---------------------------------------------------------------------------

test('data: flax and linen are workshop inputs, clothing a home good, priced among their kind', () => {
  assert.equal(GOODS.flax.kind, 'raw');
  assert.equal(GOODS.linen.kind, 'raw', 'linen is worked up by a workshop, so carts and warehouses take it to one');
  assert.equal(GOODS.clothing.kind, 'goods');
  // The new raw materials come after the old ones, so loops over them keep their order.
  assert.deepEqual(RAW_TYPES.slice(-2), ['flax', 'linen']);
  assert.ok(MANUFACTURED.includes('clothing'));
  assert.equal(HOUSE_GOODS.at(-1), 'clothing', 'last, after the four older home goods');
  // Prices: flax like the crops, linen between a crop and finished goods, clothing among the goods.
  for (const g of ['flax', 'linen', 'clothing']) {
    assert.ok(GOODS[g].sell < GOODS[g].buy, `${g} sells for less than it costs`);
    assert.match(GOODS[g].color, /^#[0-9a-f]{6}$/);
  }
  assert.ok(GOODS.flax.buy >= GOODS.clay.buy && GOODS.flax.buy <= GOODS.grapes.buy);
  assert.ok(GOODS.linen.buy > GOODS.iron.buy && GOODS.linen.buy < GOODS.pottery.buy);
  assert.ok(GOODS.clothing.buy > GOODS.furniture.buy && GOODS.clothing.buy < GOODS.weapons.buy);
  // Every good, old and new, has a color of its own.
  assert.equal(new Set(GOOD_KEYS.map((g) => GOODS[g].color)).size, GOOD_KEYS.length);
});

test('data: a flax farm like the other crop farms, two workshops like the others', () => {
  const farm = BUILDINGS.farm_flax;
  const grove = BUILDINGS.farm_olive;
  for (const k of ['kind', 'size', 'cost', 'workers', 'labor', 'placement', 'productionDays', 'fire', 'damage', 'category']) assert.deepEqual(farm[k], grove[k], `flax farm ${k} as an olive grove's`);
  assert.equal(farm.produces, 'flax');
  assert.deepEqual(BUILDINGS.linen_ws.recipe, { flax: 100 });
  assert.equal(BUILDINGS.linen_ws.produces, 'linen');
  assert.deepEqual(BUILDINGS.clothing_ws.recipe, { linen: 100 });
  assert.equal(BUILDINGS.clothing_ws.produces, 'clothing');
  for (const k of ['linen_ws', 'clothing_ws']) {
    const d = BUILDINGS[k];
    assert.equal(d.kind, 'workshop');
    assert.equal(d.size, 2);
    assert.equal(d.workers, 10);
    assert.ok(d.cost >= 40 && d.cost <= 50, `${k} costs ${d.cost}, as workshops do`);
    assert.ok(d.productionDays >= 16 && d.productionDays <= 22);
  }
  // In the build menu: the farm with the farms, the workshops with industry.
  assert.ok(buildingsInCategory('farms').some((it) => it.key === 'farm_flax'));
  for (const k of ['linen_ws', 'clothing_ws']) assert.ok(buildingsInCategory('industry').some((it) => it.key === k));
});

test('placement: the flax farm wants meadow, like every farm', () => {
  const game = newGame({ seed: 'flax-meadow' });
  const { map } = game;
  let meadow = null;
  let dry = null;
  for (let y = 2; y < map.h - 5 && !(meadow && dry); y++) {
    for (let x = 2; x < map.w - 5; x++) {
      let free = true;
      for (let dy = 0; dy < 3 && free; dy++) for (let dx = 0; dx < 3; dx++) if (!map.isFree(x + dx, y + dy) || map.terrain[map.idx(x + dx, y + dy)] === Terrain.TREES) { free = false; break; }
      if (!free) continue;
      const n = map.countTerrain(x, y, 3, Terrain.MEADOW);
      if (!meadow && n === 9) meadow = { x, y };
      if (!dry && n === 0) dry = { x, y };
    }
  }
  assert.ok(meadow && dry, 'found meadow and dry land');
  assert.ok(checkBuilding(game, 'farm_flax', meadow.x, meadow.y).ok, 'on meadow');
  assert.ok(!checkBuilding(game, 'farm_flax', dry.x, dry.y).ok, 'not on dry land');
});

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

/**
 * A flax farm on full meadow, a Linen Maker, a Clothing Maker and a warehouse
 * side by side along one road, kept fully staffed (there are no homes).
 */
function chain() {
  const game = newGame({ seed: 'cloth-chain', size: 96 });
  const { map } = game;
  let spot = null;
  for (let y = 2; y < map.h - 6 && !spot; y++) {
    for (let x = 2; x < map.w - 16; x++) {
      if (map.countTerrain(x, y, 3, Terrain.MEADOW) < 9) continue;
      let free = true;
      for (let dy = 0; dy < 4 && free; dy++) for (let dx = 0; dx < 14; dx++) if (!map.isFree(x + dx, y + dy) || map.terrain[map.idx(x + dx, y + dy)] === Terrain.TREES) { free = false; break; }
      if (free) { spot = { x, y }; break; }
    }
  }
  assert.ok(spot, 'meadow with room beside it');
  const ry = spot.y + 3;
  assert.ok(build(game, 'road', spot.x, ry, spot.x + 13, ry).ok);
  const farm = addBuilding(game, 'farm_flax', spot.x, spot.y);
  const linen = addBuilding(game, 'linen_ws', spot.x + 4, spot.y + 1);
  const clothing = addBuilding(game, 'clothing_ws', spot.x + 7, spot.y + 1);
  const wh = addBuilding(game, 'warehouse', spot.x + 10, spot.y);
  game.processRoadChanges();
  for (const b of [farm, linen, clothing, wh]) assert.ok(b.accessRoad >= 0, `${b.type} is on the road`);
  assert.equal(farm.fertility, 1);
  const staffed = [farm, linen, clothing, wh];
  const run = (days) => {
    for (let t = 0; t < days * CONFIG.TICKS_PER_DAY; t++) {
      for (const b of staffed) { b.efficiency = 1; b.fireRisk = 0; b.damageRisk = 0; }
      game.tick();
    }
  };
  return { game, farm, linen, clothing, wh, run };
}

test('the chain: flax from the field to the Linen Maker, linen to the Clothing Maker, clothing to a warehouse', () => {
  const { game, linen, clothing, wh, run } = chain();
  run(95);
  const made = game.city.produced;
  assert.ok(made.flax >= 300, `flax grown: ${made.flax}`);
  assert.ok(made.linen >= 200, `linen woven: ${made.linen}`);
  assert.ok(made.clothing >= 100, `clothing sewn: ${made.clothing}`);
  // Raw materials go straight to the workshop that needs them, never to the warehouse.
  assert.equal(wh.stock.flax + wh.incoming.flax, 0, 'no flax in the warehouse: the Linen Maker took it');
  assert.equal(wh.stock.linen + wh.incoming.linen, 0, 'no linen in the warehouse: the Clothing Maker took it');
  assert.ok(wh.stock.clothing + wh.incoming.clothing >= 100, `clothing in store: ${wh.stock.clothing}`);
  assert.equal(linen.stock.clothing, undefined, 'a Linen Maker holds flax and linen only');
  assert.deepEqual(Object.keys(clothing.stock).sort(), ['clothing', 'linen']);
  // The goods book.
  const book = { ...game.city.goodsFlowLast };
  assert.ok(Object.keys(book).length > 0);
});

test('a warehouse forwards linen (and flax) to the workshop running low', () => {
  const { game, linen, clothing, wh } = chain();
  for (const b of [linen, clothing, wh]) b.efficiency = 1;
  wh.stock.linen = 300;
  updateWarehouseSupply(game, wh);
  const cart = wh.walkers.map((id) => game.walkers.get(id)).find((w) => w && w.type === 'cart');
  assert.ok(cart, 'a cart left the warehouse');
  assert.deepEqual(cart.cargo, { good: 'linen', amount: CONFIG.CART_CAPACITY });
  assert.equal(cart.target, clothing.id, 'to the Clothing Maker');
  assert.equal(clothing.incoming.linen, CONFIG.CART_CAPACITY);
});

test('the flax farm rests in an Insane winter, like every farm', () => {
  const game = newGame({ seed: 'flax-winter', difficulty: 'insane' });
  const s = findFree(game, 3, 3);
  const farm = addBuilding(game, 'farm_flax', s.x, s.y);
  farm.fertility = 1;
  farm.efficiency = 1;
  game.time.month = 0; // Ianuarius
  const before = farm.progress;
  for (let d = 0; d < 5; d++) updateProducer(game, farm);
  assert.equal(farm.progress, before, 'nothing grows in winter on Insane');
  game.time.month = 4;
  updateProducer(game, farm);
  assert.ok(farm.progress > before, 'it grows in spring');
});

// ---------------------------------------------------------------------------
// Homes and markets
// ---------------------------------------------------------------------------

test('housing: clothing from the Insula up, and nowhere below', () => {
  HOUSE_TIERS.forEach((t, i) => assert.equal(t.goods.includes('clothing'), i >= INSULA, `${t.name} ${i >= INSULA ? 'needs' : 'does not need'} clothing`));
  assert.equal(INSULA, 12);
  // Wine stays the villas' own need.
  assert.ok(!HOUSE_TIERS[INSULA].goods.includes('wine'));
  assert.ok(HOUSE_TIERS[INSULA + 1].goods.includes('wine'));
});

test('an Insula without clothing has a bad day and falls back; with it, it stays', () => {
  const game = newGame({ seed: 'insula-cloth' });
  const b = bigHome(game, INSULA, HOUSE_TIERS[INSULA].down + 3);
  serveAll(b.house, { clothing: false });
  updateHouse(game, b);
  assert.equal(b.house.devolveDays, 1);
  assert.ok(b.house.blocked.some((m) => m.key === 'goods' && m.good === 'clothing'), JSON.stringify(b.house.blocked));
  for (let d = 1; d < game.difficulty.devolveDays; d++) { serveAll(b.house, { clothing: false }); updateHouse(game, b); }
  assert.equal(b.house.tier, TENEMENT, 'fell back to a Tenement');
  // The same home with clothing keeps its level.
  const c = bigHome(game, INSULA, HOUSE_TIERS[INSULA].down + 3);
  for (let d = 0; d < 5; d++) { serveAll(c.house); updateHouse(game, c); }
  assert.equal(c.house.tier, INSULA);
  assert.equal(c.house.devolveDays, 0);
});

test('a Tenement moves up to an Insula only with clothing, and uses it up from then', () => {
  const game = newGame({ seed: 'tenement-cloth' });
  const b = bigHome(game, TENEMENT, HOUSE_TIERS[TENEMENT].up + 2);
  serveAll(b.house, { clothing: false });
  updateHouse(game, b);
  assert.equal(b.house.tier, TENEMENT, 'no clothing: no Insula');
  assert.ok(b.house.blocked.some((m) => m.key === 'goods' && m.good === 'clothing'));
  serveAll(b.house);
  updateHouse(game, b);
  assert.equal(b.house.tier, INSULA, 'with clothing it moves up');
  const had = b.house.goods.clothing;
  consumeHouse(game, b);
  assert.ok(b.house.goods.clothing < had, 'an Insula uses clothing up');
  // The info panel says who makes it.
  assert.match(describeNeed({ key: 'goods', good: 'clothing' }), /Clothing Maker makes it from linen/);
  assert.match(describeNeed({ key: 'goods', good: 'pottery' }), /Potter makes it from clay/);
});

test('markets: buyers fetch clothing for the homes that want it; vendors sell it only to them', () => {
  const game = newGame({ seed: 'cloth-market' });
  const s = findFree(game, 8, 4);
  assert.ok(build(game, 'road', s.x, s.y + 3, s.x + 7, s.y + 3).ok);
  const market = addBuilding(game, 'market', s.x, s.y + 1);
  const wh = addBuilding(game, 'warehouse', s.x + 3, s.y);
  game.processRoadChanges();
  market.efficiency = 1;
  wh.efficiency = 1;
  for (const f of FOOD_TYPES) market.stock[f] = CONFIG.MARKET_FOOD_CAP; // food is not short
  wh.stock.clothing = 400;
  game.city.goodsDemand = { clothing: 1 };
  updateMarketBuyer(game, market);
  const buyer = market.walkers.map((id) => game.walkers.get(id)).find((w) => w && w.type === 'buyer');
  assert.ok(buyer, 'a buyer went out');
  assert.equal(buyer.want, 'clothing');
  assert.equal(buyer.target, wh.id);
  buyerArrive(game, buyer);
  buyerUnload(game, buyer);
  assert.equal(market.stock.clothing, CONFIG.CART_CAPACITY, 'a load of clothing at the market');
  // Who wants it: a Tenement (for the Insula), an Insula; not an Apartment House.
  const mk = (tier) => { const h = addBuilding(game, 'house', 1, 1, 1).house; h.tier = tier; h.pop = 20; return h; };
  assert.ok(houseWantsGood(mk(TENEMENT), 'clothing'));
  assert.ok(houseWantsGood(mk(INSULA), 'clothing'));
  assert.ok(!houseWantsGood(mk(TENEMENT - 1), 'clothing'));
  const tenement = bigHome(game, TENEMENT, 30);
  const apartment = bigHome(game, TENEMENT - 1, 30);
  vendorSupply(game, market, tenement);
  vendorSupply(game, market, apartment);
  assert.ok(tenement.house.goods.clothing > 0, 'the Tenement got clothing');
  assert.equal(apartment.house.goods.clothing, 0, 'the Apartment House got none');
});

test('guard: a market buyer never spends a try on clothing while no storage holds any', () => {
  // Review finding: Tenements want clothing from the day they stand. With
  // three foods nobody stores also short, an unfillable clothing want took
  // the day's fourth try and the buyer fetched nothing, not even pottery.
  const game = newGame({ seed: 'cloth-guard' });
  const s = findFree(game, 8, 4);
  assert.ok(build(game, 'road', s.x, s.y + 3, s.x + 7, s.y + 3).ok);
  const market = addBuilding(game, 'market', s.x, s.y + 1);
  const wh = addBuilding(game, 'warehouse', s.x + 3, s.y);
  game.processRoadChanges();
  market.efficiency = 1;
  wh.efficiency = 1;
  for (const f of FOOD_TYPES) market.stock[f] = 0;
  market.stock.wheat = CONFIG.MARKET_FOOD_CAP * 0.3;
  market.stock.pottery = CONFIG.MARKET_GOODS_CAP * 0.2;
  wh.stock.pottery = 400;
  game.city.goodsDemand = { pottery: 1, clothing: 1 };
  const buyerWant = () => market.walkers.map((id) => game.walkers.get(id)).find((w) => w && w.type === 'buyer')?.want;
  updateMarketBuyer(game, market);
  assert.equal(buyerWant(), 'pottery', 'no clothing anywhere: the buyer goes for the pottery');
  // With clothing in store it is wanted again (and first: the market has none).
  for (const id of [...market.walkers]) game.walkers.get(id).dead = true;
  market.walkers = [];
  wh.stock.clothing = 200;
  market.buyerCooldown = 0;
  updateMarketBuyer(game, market);
  assert.equal(buyerWant(), 'clothing');
});

test('guard: the Emperor asks for flax, linen or clothing only while a building that makes it stands', () => {
  // Review finding: with the three goods in the pool, every mission 4+ city
  // drew different requests than before, and was asked for clothing it had
  // no way to make.
  const game = newGame({ seed: 'cloth-emperor' });
  const pick = () => {
    const goods = new Set();
    for (let k = 0; k < 300; k++) {
      game.city.request = null;
      game.city.nextRequestMonth = 0;
      game.city.population = 2000;
      updateEmperor(game);
      if (game.city.request && game.city.request.kind === 'goods') goods.add(game.city.request.good);
    }
    return goods;
  };
  const none = pick();
  for (const g of ['flax', 'linen', 'clothing']) assert.equal(none.has(g), false, `no cloth industry: never ${g}`);
  const s = findFree(game, 2, 2);
  addBuilding(game, 'clothing_ws', s.x, s.y);
  const some = pick();
  assert.equal(some.has('clothing'), true, 'a Clothing Maker: clothing can be asked for');
  assert.equal(some.has('flax'), false, 'but not flax, with no flax farm');
});

// ---------------------------------------------------------------------------
// Missions, partners and the capacity model
// ---------------------------------------------------------------------------

test('unlocks: the chain comes with mission 4\'s industry; every mission whose homes reach the Insula can clothe them', () => {
  const has = (s) => CLOTH.every((k) => unlockedBuildings(s).has(k));
  assert.deepEqual(SCENARIOS.map(has), [false, false, false, true, true, true, true]);
  for (const s of SCENARIOS) {
    const { top } = topLevels(s);
    if (top >= INSULA) assert.ok(goodsAvailable(s).all.has('clothing'), `${s.id}: homes reach level ${top}, and clothing can be had`);
  }
  // The ladder through the campaign is as before: mission 4 still reaches Villas.
  assert.deepEqual(SCENARIOS.map((s) => topLevels(s).top), [4, 7, 9, 13, 19, 19, 20]);
  // Without the chain and with no partner selling linen or clothing, mission 4's homes would stop at Tenements.
  const c4 = findScenario('c4');
  const bare = { ...c4, unlocks: c4.unlocks.filter((k) => !CLOTH.includes(k)) };
  assert.equal(topLevels(bare).top, TENEMENT, 'no clothing: Tenements at most');
  // A Clothing Maker alone does it there: Tarraco sells linen.
  assert.equal(topLevels({ ...bare, unlocks: [...bare.unlocks, 'clothing_ws'] }).top, INSULA + 1);
  assert.equal(topLevels({ ...bare, unlocks: [...bare.unlocks, 'clothing_ws'], partners: [] }).top, TENEMENT, 'and without Tarraco, nothing to sew');
  // The Problems overlay agrees.
  const g3 = new Game({ scenario: findScenario('c3'), flags: {} });
  const g4 = new Game({ scenario: c4, flags: {} });
  assert.equal(needReachable(g3, { key: 'goods', need: 1, good: 'clothing' }), false);
  assert.equal(needReachable(g4, { key: 'goods', need: 1, good: 'clothing' }), true);
});

test('partners: Egyptian and Hispanic linen for sale, clothing bought in Capua and Corinthus', () => {
  assert.ok(TRADE_PARTNERS.alexandria.sells.linen > 0, 'Alexandria sells linen');
  assert.ok(TRADE_PARTNERS.tarraco.sells.linen > 0, 'Tarraco sells linen');
  assert.ok(TRADE_PARTNERS.alexandria.sells.linen > TRADE_PARTNERS.tarraco.sells.linen, 'Egypt the most');
  assert.ok(TRADE_PARTNERS.capua.buys.clothing > 0);
  assert.ok(TRADE_PARTNERS.corinthus.buys.clothing > 0);
  for (const [id, p] of Object.entries(TRADE_PARTNERS)) {
    for (const g of [...Object.keys(p.sells), ...Object.keys(p.buys)]) assert.ok(GOODS[g], `${id} trades in ${g}, a good`);
    for (const g of Object.keys(p.sells)) assert.ok(!p.buys[g], `${id} does not both sell and buy ${g}`);
  }
  // A new game's trade settings have the three goods, with no trade.
  const game = newGame({ seed: 'cloth-trade' });
  for (const g of ['flax', 'linen', 'clothing']) assert.deepEqual(game.city.trade.settings[g], { mode: 'none', level: 400 });
});

test('capacity: the chain is planned three steps deep, for the homes and for what partners buy', () => {
  const c4 = findScenario('c4');
  const avail = goodsAvailable(c4);
  for (const g of ['flax', 'linen', 'clothing']) assert.ok(avail.made.has(g), `mission 4 makes ${g}`);
  const plan = planCity(c4, 2000, SENSIBLE);
  const count = Object.fromEntries(plan.items.map((it) => [it.key, it.count]));
  for (const k of CLOTH) assert.ok(count[k] >= 1, `a city of Insulae has a ${k}: ${JSON.stringify(count)}`);
  // Mission 6: Capua buys clothing, so more workshops than the homes alone need.
  const c6 = findScenario('c6');
  const withBuyer = planCity(c6, 2000, SENSIBLE).items.find((it) => it.key === 'clothing_ws').count;
  const noBuyer = planCity({ ...c6, partners: c6.partners.filter((id) => !TRADE_PARTNERS[id].buys.clothing) }, 2000, SENSIBLE).items.find((it) => it.key === 'clothing_ws').count;
  assert.ok(withBuyer > noBuyer, `clothing makers ${withBuyer} with Capua buying, ${noBuyer} without`);
  // Whatever the order of the unlocks, a three-step chain is found.
  const reversed = { ...c4, unlocks: [...c4.unlocks].reverse() };
  assert.ok(goodsAvailable(reversed).made.has('clothing'));
});

// ---------------------------------------------------------------------------
// Art, the demo builder and saves
// ---------------------------------------------------------------------------

test('art: carts carry flax, linen and clothing with art of their own; the three buildings draw', () => {
  for (const g of ['flax', 'linen', 'clothing']) {
    assert.ok(CARGO_ART[g], `${g} has cargo art`);
    assert.equal(cargoArtOf(g), CARGO_ART[g], `${g} is not drawn as the plain fallback block`);
  }
  for (const [k, states] of [['farm_flax', [0, 1, 2, 3, 4, 5, 9]], ['linen_ws', [0]], ['clothing_ws', [0]]]) {
    for (const st of states) {
      for (const v of [0, 1, 2, 3]) {
        const { ctx } = recordingContext();
        assert.doesNotThrow(() => buildingSpec(k, BUILDINGS[k].size, v, st).draw(ctx), `${k} look ${v} state ${st}`);
      }
    }
  }
});

test('the demo builder puts up a working cloth quarter', () => {
  const game = newGame({ seed: 'demo', size: 96 });
  const res = buildDemoCity(game, { level: 2 });
  assert.ok(res.ok);
  const cloth = buildDemoCloth(game, res.center);
  assert.ok(cloth.ok, 'farm, both workshops and a warehouse');
  assert.ok(cloth.farm.fertility > 0.5, 'the flax farm stands on meadow');
  for (const b of [cloth.farm, cloth.linen, cloth.clothing, cloth.warehouse]) assert.ok(b.accessRoad >= 0, `${b.type} has a road`);
});

test('save: a version 9 city loads with the new goods at 0 everywhere, and plays on', () => {
  const game = newGame({ seed: 'cloth-save', type: 'coast' });
  assert.ok(buildDemoCity(game, { level: 2 }).ok);
  game.runDays(40);
  const insula = bigHome(game, INSULA, HOUSE_TIERS[INSULA].down + 3);
  serveAll(insula.house);
  const tenement = bigHome(game, TENEMENT, HOUSE_TIERS[TENEMENT].down + 3);
  serveAll(tenement.house);
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  // Make it look like a version 9 save: no flax, linen or clothing anywhere.
  const strip = (o) => { if (o && typeof o === 'object') for (const g of ['flax', 'linen', 'clothing']) delete o[g]; };
  for (const b of data.buildings) {
    strip(b.stock); strip(b.incoming); strip(b.orders);
    if (b.house) strip(b.house.goods);
  }
  for (const g of ['flax', 'linen', 'clothing']) delete data.city.trade.settings[g];
  data.version = 9;
  const again = deserializeGame(data);
  let homes = 0;
  let markets = 0;
  let warehouses = 0;
  for (const b of again.buildings.values()) {
    if (b.house && b.house.tier < TENEMENT) { homes++; assert.equal(b.house.goods.clothing, 0, 'homes that need no clothing yet get none'); }
    if (b.def.kind === 'market') { markets++; assert.equal(b.stock.clothing, 0); assert.equal(b.incoming.clothing, 0); }
    if (b.def.kind === 'warehouse') {
      warehouses++;
      for (const g of ['flax', 'linen', 'clothing']) { assert.equal(b.stock[g], 0); assert.equal(b.incoming[g], 0); assert.equal(b.orders[g], 'accept'); }
    }
  }
  assert.ok(homes > 0 && markets > 0 && warehouses > 0, `${homes} homes, ${markets} markets, ${warehouses} warehouses checked`);
  for (const g of ['flax', 'linen', 'clothing']) assert.deepEqual(again.city.trade.settings[g], { mode: 'none', level: 400 });
  // Tenements and better start with three months of clothing (CLOTHING_GRACE_MONTHS)...
  const old = again.buildings.get(insula.id);
  const month = HOUSE_TIERS[INSULA].people / CONFIG.GOODS_PER_HOUSE_PEOPLE;
  assert.equal(CLOTHING_GRACE_MONTHS, 3);
  assert.ok(Math.abs(old.house.goods.clothing - month * CLOTHING_GRACE_MONTHS) < 1e-9, `an Insula: ${old.house.goods.clothing}`);
  assert.ok(again.buildings.get(tenement.id).house.goods.clothing > 0, 'a Tenement too');
  // ...and use it up: after that an Insula without clothing has bad days, as the docs say.
  for (let k = 0; k < 2 * CLOTHING_GRACE_MONTHS; k++) consumeHouse(again, old);
  assert.ok(old.house.goods.clothing < 1e-9, `used up in three months: ${old.house.goods.clothing}`);
  serveAll(old.house, { clothing: false });
  updateHouse(again, old);
  assert.equal(old.house.devolveDays, 1);
  again.runDays(30); // and it plays
  assert.ok(Number.isFinite(again.city.treasury));
  // The upgrade leaves a version 10 city alone.
  const fresh = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  const before = JSON.stringify([...fresh.buildings.values()].map((b) => b.stock || null));
  upgradeClothV9(fresh);
  assert.equal(JSON.stringify([...fresh.buildings.values()].map((b) => b.stock || null)), before);
  assert.equal(CONFIG.SAVE_VERSION, 10);
});

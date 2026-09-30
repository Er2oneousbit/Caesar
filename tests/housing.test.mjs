/**
 * housing.test.mjs - the 20-level housing ladder (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Each test sets up homes with exactly the services, stock, water and
 * desirability it needs, then runs the real daily check (updateHouse) and
 * the monthly consumption. Map layers (desirability, water) are written
 * directly: they are only recomputed on a new game day, which these tests
 * never run. Covered: moving up at once and one level a day, falling back
 * after the difficulty's bad days in a row (and the reset), goods and food
 * running out, blocks of four single-tile homes, growing into 2x2 / 3x3 /
 * 4x4 (in pass order, taking gardens last, breaking up homes it only partly
 * covers), splitting on the way down with people and goods conserved,
 * residents over capacity leaving, entertainment and wine sources.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { HOUSE_TIERS, MAX_TIER, houseCapacity } from '../src/data/housing.js';
import { FOOD_TYPES, HOUSE_GOODS } from '../src/data/goods.js';
import { GOD_KEYS } from '../src/data/gods.js';
import { VENUE_POINTS, VENUE_BOTH_BONUS, VENUE_SEATS, ENT_BASE_MAX } from '../src/data/buildings.js';
import { addBuilding } from '../src/sim/entities.js';
import { updateHouse, consumeHouse, useGoods, entertainmentScore, educationTier, blockTile, findGrowth, updateWineSources } from '../src/sim/housing.js';
import { vendorSupply, foodKindsWanted } from '../src/sim/market.js';
import { updateEntertainmentBase } from '../src/sim/entertainment.js';
import { updateEmigration } from '../src/sim/population.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { WaterBits, Terrain } from '../src/world/map.js';
import { newGame, findFree } from './helpers.mjs';

const T = (name) => HOUSE_TIERS.findIndex((t) => t.name === name);

/** Write desirability and water bits (a fountain, a well and a hospital by default) under a footprint. */
function ground(game, x, y, size, des, water = WaterBits.FOUNTAIN | WaterBits.WELL | WaterBits.HOSPITAL) {
  const { map } = game;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const i = map.idx(x + dx, y + dy);
      map.desirability[i] = des;
      map.water[i] = water;
    }
  }
}

/** Every service visit (50 days left), every food and good in stock. */
function serveAll(h, { hospital = true } = {}) {
  for (const g of GOD_KEYS) h.religion[g] = 50;
  for (const v in h.ent) h.ent[v] = 50;
  for (const v in h.entBoth) h.entBoth[v] = 50;
  for (const k of ['school', 'library', 'academy', 'barber', 'clinic', 'baths', 'tax']) h[k] = 50;
  for (const f of FOOD_TYPES) h.food[f] = 500;
  for (const g of HOUSE_GOODS) h.goods[g] = 50;
  return hospital;
}

/** A home of `level` with `pop` residents at (x, y) (size from the level unless given). */
function home(game, x, y, level, pop, size = level > 0 ? HOUSE_TIERS[level].size : 1) {
  const b = addBuilding(game, 'house', x, y, size);
  b.house.tier = level;
  b.house.pop = pop;
  return b;
}

/** People who had to leave homes: homeless walkers plus anyone with no road to leave by. */
function displaced(game) {
  let n = game.city.lostCitizens;
  for (const w of game.walkers.values()) if (w.type === 'homeless') n += w.people;
  return n;
}

/** Total residents in homes. */
function residents(game) {
  let n = 0;
  for (const b of game.buildings.values()) if (b.house) n += b.house.pop;
  return n;
}

/** Lay road tiles in a ring just outside the square (x, y, size). */
function ringRoad(game, x, y, size) {
  for (let k = -1; k <= size; k++) {
    for (const [tx, ty] of [[x + k, y - 1], [x + k, y + size], [x - 1, y + k], [x + size, y + k]]) game.map.road[game.map.idx(tx, ty)] = 1;
  }
}

/** A free spot whose top-left tile does (or does not) allow 2x2 blocks. */
function spotWithBlockRule(game, w, h, allowed) {
  const { map } = game;
  for (let y = 3; y < map.h - h - 3; y++) {
    for (let x = 3; x < map.w - w - 3; x++) {
      if (blockTile(game, x, y) !== allowed) continue;
      let ok = true;
      for (let dy = -1; dy <= h && ok; dy++) {
        for (let dx = -1; dx <= w; dx++) {
          const i = map.idx(x + dx, y + dy);
          if (!map.isFree(x + dx, y + dy) || map.terrain[i] === Terrain.TREES) { ok = false; break; }
        }
      }
      if (ok) return { x, y };
    }
  }
  throw new Error('no spot');
}

// ---------------------------------------------------------------------------

test('the ladder: 20 levels, footprints 1/2/3/4, desirability bands that never overlap', () => {
  assert.equal(MAX_TIER, 20);
  for (let t = 1; t <= 20; t++) {
    const L = HOUSE_TIERS[t];
    assert.equal(L.size, t <= 10 ? 1 : t <= 14 ? 2 : t <= 18 ? 3 : 4, `${L.name} size`);
    assert.equal(L.patrician, t >= 13, `${L.name} patrician`);
    if (t >= 2 && t < 20) assert.ok(L.up > L.down, `${L.name}: up above down`);
    // A home that just moved up is never at its new level's floor.
    if (t < 20) assert.ok(L.up > HOUSE_TIERS[t + 1].down, `${L.name}: up above the next level's down`);
  }
  assert.equal(houseCapacity(T('Domus'), 1), HOUSE_TIERS[T('Domus')].people);
  assert.equal(houseCapacity(T('Domus'), 2), HOUSE_TIERS[T('Domus')].people * 4, 'a block of four');
  assert.equal(houseCapacity(T('Tenement'), 2), HOUSE_TIERS[T('Tenement')].people);
  assert.equal(houseCapacity(0, 1), HOUSE_TIERS[1].people, 'a vacant lot takes a tent\'s worth');
  assert.ok(HOUSE_TIERS[T('Villa')].people < HOUSE_TIERS[T('Insula')].people, 'villas hold fewer people than insulae');
});

test('a home moves up as soon as it qualifies, never more than one level a day', () => {
  const game = newGame();
  const s = findFree(game, 1, 1);
  const b = home(game, s.x, s.y, T('Hut'), 11);
  serveAll(b.house);
  ground(game, s.x, s.y, 1, HOUSE_TIERS[T('Apartment House')].up - 1);
  const seen = [];
  for (let d = 0; d < 8; d++) {
    updateHouse(game, b);
    seen.push(b.house.tier);
  }
  assert.deepEqual(seen, [5, 6, 7, 8, 9, 10, 10, 10], 'one level per daily check, then desirability holds it at 10');
  assert.equal(b.house.blocked[0].key, 'des');
  assert.equal(game.city.stats.evolutions, 6);
});

test('desirability: bad at the floor, stable in between, moves up at `up`', () => {
  const game = newGame();
  const s = findFree(game, 1, 1);
  const lvl = T('Merchant House');
  const L = HOUSE_TIERS[lvl];
  const b = home(game, s.x, s.y, lvl, 17);
  serveAll(b.house);
  // Domus needs entertainment 20: give only a theater and no city base so it cannot move up on needs.
  for (const v in b.house.ent) b.house.ent[v] = 0;
  b.house.ent.theater = 50;
  ground(game, s.x, s.y, 1, L.down);
  updateHouse(game, b);
  assert.equal(b.house.devolveDays, 1, 'at the floor: a bad day');
  ground(game, s.x, s.y, 1, L.down + 1);
  updateHouse(game, b);
  assert.equal(b.house.devolveDays, 0, 'just above the floor: fine');
  assert.equal(b.house.tier, lvl);
  b.house.ent.amphitheater = 50; // 10 + 15 = 25: Domus needs 20
  ground(game, s.x, s.y, 1, L.up - 1);
  updateHouse(game, b);
  assert.equal(b.house.tier, lvl, 'one short of `up`: stays');
  ground(game, s.x, s.y, 1, L.up);
  updateHouse(game, b);
  assert.equal(b.house.tier, lvl + 1, 'at `up`: moves up');
});

test('falls back on the 3rd bad day in a row on Normal (6th on Easy); a good day resets the count', () => {
  for (const [difficulty, days] of [['normal', 3], ['easy', 6]]) {
    const game = newGame({ difficulty });
    const s = findFree(game, 1, 1);
    const lvl = T('Townhouse');
    const b = home(game, s.x, s.y, lvl, HOUSE_TIERS[lvl].people);
    serveAll(b.house);
    for (const g of HOUSE_GOODS) b.house.goods[g] = 0; // no pottery: cannot move up
    ground(game, s.x, s.y, 1, HOUSE_TIERS[lvl].down + 3);
    const lose = () => { b.house.school = 0; b.house.library = 0; };
    lose();
    for (let d = 1; d < days; d++) updateHouse(game, b);
    assert.equal(b.house.tier, lvl, `${difficulty}: still standing after ${days - 1} bad days`);
    b.house.school = 50; // a teacher came by
    updateHouse(game, b);
    assert.equal(b.house.devolveDays, 0, `${difficulty}: good day resets`);
    lose();
    for (let d = 1; d < days; d++) updateHouse(game, b);
    assert.equal(b.house.tier, lvl, `${difficulty}: the count started over`);
    updateHouse(game, b);
    assert.equal(b.house.tier, lvl - 1, `${difficulty}: falls on bad day ${days}`);
    // Townhouse (16) to Stone Cottage (14): two residents over capacity leave.
    assert.equal(b.house.pop, HOUSE_TIERS[lvl - 1].people);
    assert.equal(displaced(game), HOUSE_TIERS[lvl].people - HOUSE_TIERS[lvl - 1].people);
  }
});

test('tents never fall back and never have a bad day', () => {
  const game = newGame();
  const s = findFree(game, 1, 1);
  const b = home(game, s.x, s.y, 1, 5);
  ground(game, s.x, s.y, 1, -100, 0);
  for (let d = 0; d < 5; d++) updateHouse(game, b);
  assert.equal(b.house.tier, 1);
  assert.equal(b.house.devolveDays, 0);
  assert.ok(!b.house.devolving);
});

test('goods run out twice a month; the next check is a bad day', () => {
  const game = newGame();
  const s = findFree(game, 1, 1);
  const lvl = T('Merchant House');
  const b = home(game, s.x, s.y, lvl, 17);
  serveAll(b.house);
  for (const g of HOUSE_GOODS) b.house.goods[g] = 0;
  const each = Math.max(0.25, 17 / CONFIG.GOODS_PER_HOUSE_PEOPLE) / 2;
  b.house.goods.pottery = each * 1.5;
  b.house.goods.oil = 5; // not needed at this level: never used up
  useGoods(game, b);
  assert.ok(Math.abs(b.house.goods.pottery - each * 0.5) < 1e-9, 'half a month of pottery used');
  assert.equal(b.house.goods.oil, 5, 'goods the level does not need are kept');
  useGoods(game, b);
  assert.equal(b.house.goods.pottery, 0);
  ground(game, s.x, s.y, 1, HOUSE_TIERS[lvl].down + 2);
  updateHouse(game, b);
  assert.equal(b.house.devolveDays, 1);
  assert.equal(b.house.blocked.find((m) => m.key === 'goods').good, 'pottery');
});

test('food: tents forage; others eat only the kinds their level needs, first kinds first', () => {
  const game = newGame();
  const s = findFree(game, 3, 1);
  const tent = home(game, s.x, s.y, T('Family Tent'), 7);
  tent.house.food.wheat = 10;
  consumeHouse(game, tent);
  assert.equal(tent.house.food.wheat, 10, 'tents eat nothing');
  assert.equal(tent.house.hungry, false);
  const lvl = T('Insula'); // 2 kinds
  const b = home(game, s.x + 1, s.y, lvl, 88, 1);
  b.house.food = { wheat: 0, vegetables: 100, fruit: 100, meat: 100 };
  consumeHouse(game, b);
  const portion = (88 * CONFIG.FOOD_PER_PERSON_MONTH) / 2;
  assert.equal(b.house.food.vegetables, 100 - portion);
  assert.equal(b.house.food.fruit, 100 - portion);
  assert.equal(b.house.food.meat, 100, 'a third kind is kept, not eaten');
  assert.equal(b.house.hungry, false);
  // Only one kind left: it eats one portion (not the whole ration) and is not hungry.
  b.house.food = { wheat: 1, vegetables: 0, fruit: 0, meat: 0 };
  consumeHouse(game, b);
  assert.equal(b.house.food.wheat, 0);
  assert.equal(b.house.hungry, false);
  consumeHouse(game, b);
  assert.equal(b.house.hungry, true, 'nothing to eat');
});

test('food: when a kind runs short, the rest of the ration comes from other food', () => {
  const game = newGame();
  const s = findFree(game, 2, 2);
  const b = home(game, s.x, s.y, T('Tenement'), 80); // needs 1 kind
  b.house.food = { wheat: 0.5, vegetables: 30, fruit: 0, meat: 0 };
  const flow0 = game.city.foodFlow.shortfall;
  consumeHouse(game, b);
  const ration = 80 * CONFIG.FOOD_PER_PERSON_MONTH;
  assert.equal(b.house.food.wheat, 0);
  assert.ok(Math.abs(b.house.food.vegetables - (30 - (ration - 0.5))) < 1e-9);
  assert.equal(game.city.foodFlow.shortfall, flow0, 'no shortfall while there is food');
  assert.equal(b.house.hungry, false);
});

test('market vendors stock only the kinds of food a home needs', () => {
  const game = newGame();
  const s = findFree(game, 4, 1);
  const market = addBuilding(game, 'market', s.x, s.y);
  for (const f of FOOD_TYPES) market.stock[f] = 500;
  const tent = home(game, s.x + 2, s.y, T('Tent'), 5);
  assert.equal(foodKindsWanted(tent.house), 0);
  vendorSupply(game, market, tent);
  assert.ok(FOOD_TYPES.every((f) => tent.house.food[f] === 0), 'tents get no food');
  const lean = home(game, s.x + 3, s.y, T('Family Tent'), 7);
  assert.equal(foodKindsWanted(lean.house), 1, 'a Family Tent stocks up for a Lean-to');
  vendorSupply(game, market, lean);
  assert.ok(lean.house.food.wheat > 0);
  assert.equal(lean.house.food.vegetables, 0, 'one kind only, the first in order');
  // A home already holding vegetables gets them topped up rather than a new kind.
  lean.house.food = { wheat: 0, vegetables: 0.5, fruit: 0, meat: 0 };
  vendorSupply(game, market, lean);
  assert.equal(lean.house.food.wheat, 0);
  assert.ok(lean.house.food.vegetables > 0.5);
  // A leftover the market cannot top up does not keep out a kind it can.
  const ins = home(game, s.x + 2, s.y + 2, T('Insula'), 88, 1);
  ins.house.food = { wheat: 0.3, vegetables: 10, fruit: 0, meat: 0 };
  market.stock.wheat = 0;
  vendorSupply(game, market, ins);
  assert.ok(ins.house.food.fruit > 0, 'fruit comes in');
  assert.ok(ins.house.food.vegetables > 10, 'vegetables topped up');
});

test('four single-tile homes of one level join into a 2x2 block (only where the tile allows it)', () => {
  const game = newGame();
  const lvl = T('Townhouse');
  const make = (s) => [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy], k) => {
    const b = home(game, s.x + dx, s.y + dy, lvl, 10 + k);
    serveAll(b.house);
    for (const g of HOUSE_GOODS) b.house.goods[g] = 0;
    b.house.food.wheat = 10;
    ground(game, s.x + dx, s.y + dy, 1, HOUSE_TIERS[lvl].down + 2);
    return b;
  });
  const yes = make(spotWithBlockRule(game, 2, 2, true));
  updateHouse(game, yes[0]);
  const blk = yes[0];
  assert.equal(blk.size, 2);
  assert.ok(blk.house.merged);
  assert.equal(blk.house.tier, lvl, 'same level');
  assert.equal(blk.house.pop, 10 + 11 + 12 + 13);
  assert.equal(blk.house.food.wheat, 40);
  assert.equal(houseCapacity(blk.house.tier, blk.size), HOUSE_TIERS[lvl].people * 4);
  for (const o of yes.slice(1)) assert.ok(!game.buildings.has(o.id));
  const no = make(spotWithBlockRule(game, 2, 2, false));
  updateHouse(game, no[0]);
  assert.equal(no[0].size, 1, 'this tile never starts a block');
  // A settled tent joins three vacant lots.
  const s = spotWithBlockRule(game, 2, 2, true);
  const t = home(game, s.x, s.y, 1, 3);
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]]) home(game, s.x + dx, s.y + dy, 0, 0);
  ground(game, s.x, s.y, 2, 0, 0);
  updateHouse(game, t);
  assert.equal(t.size, 2);
  assert.equal(houseCapacity(t.house.tier, t.size), 20);
});

test('a block falls back as a block, and a block of Apartment Houses becomes a Tenement without growing', () => {
  const game = newGame();
  const s = spotWithBlockRule(game, 2, 2, true);
  const lvl = T('Apartment House');
  const b = home(game, s.x, s.y, lvl, 80, 2);
  b.house.merged = true;
  serveAll(b.house);
  ground(game, s.x, s.y, 2, HOUSE_TIERS[lvl].up);
  updateHouse(game, b);
  assert.equal(b.house.tier, T('Tenement'));
  assert.equal(b.size, 2);
  assert.ok(!b.house.merged, 'a real 2x2 home now');
  const c = home(game, s.x + 4, s.y, T('Domus'), 60, 2);
  c.house.merged = true;
  serveAll(c.house);
  c.house.goods.pottery = 0; // Domus needs pottery
  ground(game, s.x + 4, s.y, 2, HOUSE_TIERS[T('Domus')].down + 2);
  for (let d = 0; d < 3; d++) updateHouse(game, c);
  assert.equal(c.house.tier, T('Domus') - 1);
  assert.equal(c.size, 2);
  assert.ok(c.house.merged, 'still a block');
});

test('growing: lower homes first, then clear land, gardens last; blocked when there is no room', () => {
  const game = newGame();
  const s = findFree(game, 6, 6);
  const x = s.x + 2;
  const y = s.y + 2;
  // Roads above and left, so only the square anchored at the home can work.
  for (let k = -1; k <= 2; k++) {
    game.map.road[game.map.idx(x + k, y - 1)] = 1;
    game.map.road[game.map.idx(x - 1, y + k)] = 1;
  }
  const lvl = T('Apartment House');
  const b = home(game, x, y, lvl, 20);
  const nb = home(game, x + 1, y, T('Merchant House'), 17);
  nb.house.food.wheat = 30;
  const garden = addBuilding(game, 'garden', x + 1, y + 1);
  serveAll(b.house);
  ground(game, x, y, 1, HOUSE_TIERS[lvl].up);
  assert.deepEqual(findGrowth(game, b, 2), { x, y }, 'garden taken in the last pass');
  updateHouse(game, b);
  assert.equal(b.house.tier, T('Tenement'));
  assert.equal(b.size, 2);
  assert.equal(b.house.pop, 37);
  assert.ok(!game.buildings.has(nb.id) && !game.buildings.has(garden.id));
  assert.equal(b.house.food.wheat, 500 + 30);
  // Blocked: a well in the only square.
  const x2 = x + 4;
  for (let k = -1; k <= 2; k++) {
    game.map.road[game.map.idx(x2 + k, y - 1)] = 1;
    game.map.road[game.map.idx(x2 - 1, y + k)] = 1;
  }
  const c = home(game, x2, y, lvl, 20);
  addBuilding(game, 'well', x2 + 1, y + 1);
  serveAll(c.house);
  ground(game, x2, y, 1, HOUSE_TIERS[lvl].up);
  updateHouse(game, c);
  assert.equal(c.house.tier, lvl);
  assert.deepEqual(c.house.blocked, [{ key: 'space', have: 1, need: 2 }]);
  assert.equal(c.house.devolveDays, 0, 'no room is not a bad day');
});

test('growing prefers a square of lower homes over clear land', () => {
  const game = newGame();
  const s = findFree(game, 5, 5);
  const x = s.x + 2;
  const y = s.y + 2;
  const b = home(game, x, y, T('Apartment House'), 20);
  // Up-left square: all homes. The home's own square: clear land.
  for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0]]) home(game, x + dx, y + dy, T('Hut'), 5);
  assert.deepEqual(findGrowth(game, b, 2), { x: x - 1, y: y - 1 });
  // A higher-level neighbor cannot be taken over.
  game.buildings.get(game.map.buildingAt(x - 1, y - 1)).house.tier = MAX_TIER;
  assert.deepEqual(findGrowth(game, b, 2), { x, y }, 'falls back to clear land');
});

test('splitting on the way down: 2x2, 3x3 and 4x4, people and goods shared by tiles', () => {
  for (const [from, keep] of [['Tenement', 1], ['Peristyle Villa', 2], ['Grand Palatium', 3]]) {
    const game = newGame();
    const lvl = T(from);
    const S = HOUSE_TIERS[lvl].size;
    const f = findFree(game, S + 2, S + 2);
    const s = { x: f.x + 1, y: f.y + 1 };
    ringRoad(game, s.x, s.y, S);
    const pop = HOUSE_TIERS[lvl].people;
    const b = home(game, s.x, s.y, lvl, pop);
    serveAll(b.house);
    b.house.food = { wheat: 90, vegetables: 45, fruit: 0, meat: 0 };
    b.house.school = 0; // a need missing at every one of these levels
    b.house.library = 0;
    ground(game, s.x, s.y, S, HOUSE_TIERS[lvl].down + 2);
    for (let d = 0; d < 3; d++) updateHouse(game, b);
    assert.equal(b.house.tier, lvl - 1, `${from} fell`);
    assert.equal(b.size, keep, `${from} kept its anchor corner at ${keep}x${keep}`);
    assert.deepEqual([b.x, b.y], [s.x, s.y], 'the top-left corner, as roads are all around');
    const pieces = [...game.buildings.values()].filter((o) => o !== b && o.house);
    assert.equal(pieces.length, S * S - keep * keep);
    const each = Math.floor(pop / (S * S));
    for (const p of pieces) {
      assert.equal(p.size, 1);
      assert.equal(p.house.tier, T('Apartment House'));
      assert.equal(p.house.bornDay, game.time.totalDays);
      assert.equal(p.house.school, 0, 'pieces start with no service visits');
      assert.ok(Math.abs(p.house.food.wheat - 90 / (S * S)) < 1e-9);
    }
    assert.equal(residents(game) + displaced(game), pop, `${from}: nobody lost`);
    assert.ok(Math.abs([...game.buildings.values()].reduce((n, o) => n + (o.house ? o.house.food.wheat : 0), 0) - 90) < 1e-9, `${from}: no wheat lost`);
    assert.ok(pieces.every((p) => p.house.pop === Math.min(each, HOUSE_TIERS[p.house.tier].people)));
    // Pieces are checked from the next day, not today.
    const p0 = pieces[0];
    updateHouse(game, p0);
    assert.equal(p0.house.devolveDays, 0);
  }
});

test('a big home with a road on one side keeps the corner by the road; pieces out of reach stay vacant', () => {
  const game = newGame();
  const s = findFree(game, 8, 7);
  const x = s.x + 1;
  const y = s.y + 1;
  for (let k = -1; k <= 4; k++) game.map.road[game.map.idx(x + 5, y + k)] = 1; // 2 tiles right of the palace
  const lvl = T('Grand Palatium');
  const pop = HOUSE_TIERS[lvl].people;
  const b = home(game, x, y, lvl, pop);
  serveAll(b.house);
  b.house.food = { wheat: 160, vegetables: 0, fruit: 0, meat: 0 };
  b.house.school = 0;
  b.house.library = 0;
  ground(game, x, y, 4, HOUSE_TIERS[lvl].down + 2);
  for (let d = 0; d < 3; d++) updateHouse(game, b);
  assert.equal(b.house.tier, lvl - 1);
  assert.deepEqual([b.x, b.y, b.size], [x + 1, y, 3], 'kept the top-right 3x3, the corner still in reach of the road');
  assert.ok(b.accessRoad >= 0);
  const homes = [...game.buildings.values()].filter((o) => o.house && o !== b);
  assert.equal(homes.length, 7);
  const served = homes.filter((o) => o.house.pop > 0);
  assert.deepEqual(served.map((o) => [o.x, o.y]), [[x + 3, y + 3]], 'only the piece by the road is a home');
  assert.ok(homes.filter((o) => o.house.pop === 0).every((o) => o.house.tier === 0 && o.accessRoad < 0), 'the others are vacant lots');
  assert.equal(residents(game) + displaced(game), pop, 'nobody lost');
  assert.equal(game.city.lostCitizens, 0, 'they set out from the palace\'s road as homeless');
  const wheat = [...game.buildings.values()].reduce((n, o) => n + (o.house ? o.house.food.wheat : 0), 0);
  assert.ok(Math.abs(wheat - 160) < 1e-9, 'the wheat of the vacant tiles stays with the palace');
});

test('after falling back, the info panel shows the new level\'s status, not the old one\'s', () => {
  const game = newGame();
  const s = findFree(game, 1, 1);
  const lvl = T('Merchant House');
  const b = home(game, s.x, s.y, lvl, 17);
  serveAll(b.house);
  b.house.goods.pottery = 0; // Merchant House needs pottery; Townhouse does not
  ground(game, s.x, s.y, 1, HOUSE_TIERS[lvl].down + 2);
  for (let d = 0; d < 3; d++) updateHouse(game, b);
  assert.equal(b.house.tier, lvl - 1);
  assert.equal(b.house.devolving, false, 'the Townhouse has what it needs');
  assert.ok(b.house.blocked.some((m) => m.good === 'pottery'), 'what it lacks to move up again');
});

test('a palace growing over part of a 3x3 villa breaks it into nine homes and loses nobody', () => {
  const game = newGame();
  const s = findFree(game, 8, 6);
  const x = s.x + 1;
  const y = s.y + 1;
  // Roads above and left: only the square anchored at the palace can work.
  // A road on the villa's far side keeps its outside pieces within reach.
  for (let k = -1; k <= 4; k++) {
    game.map.road[game.map.idx(x + k, y - 1)] = 1;
    game.map.road[game.map.idx(x - 1, y + k)] = 1;
    game.map.road[game.map.idx(x + 6, y + k)] = 1;
  }
  const lvl = T('Palatium');
  const pal = home(game, x, y, lvl, 120);
  const villa = home(game, x + 3, y, T('Marble Villa'), 99);
  villa.house.food.wheat = 90;
  for (let k = 0; k < 3; k++) home(game, x + k, y + 3, T('Domus'), 18);
  home(game, x + 3, y + 3, T('Domus'), 18);
  serveAll(pal.house);
  pal.house.food.wheat = 0;
  game.city.wineSources = 2;
  game.city.entBase = ENT_BASE_MAX;
  ground(game, x, y, 3, HOUSE_TIERS[lvl].up);
  const before = residents(game);
  updateHouse(game, pal);
  assert.equal(pal.house.tier, T('Grand Palatium'));
  assert.equal(pal.size, 4);
  const pieces = [...game.buildings.values()].filter((o) => o.house && o !== pal);
  assert.equal(pieces.length, 6, 'six of the villa\'s nine tiles stay outside');
  for (const p of pieces) assert.equal(p.house.tier, T('Apartment House'));
  assert.equal(residents(game) + displaced(game), before, 'everyone housed or looking for a home');
  const wheat = [...game.buildings.values()].reduce((n, o) => n + (o.house ? o.house.food.wheat : 0), 0);
  assert.ok(Math.abs(wheat - 90) < 1e-9, 'the villa\'s wheat is all still somewhere');
});

test('moving up into a Villa sends residents over its capacity to look for a home', () => {
  const game = newGame();
  const s = findFree(game, 2, 2);
  const lvl = T('Insula');
  const b = home(game, s.x, s.y, lvl, HOUSE_TIERS[lvl].people);
  serveAll(b.house);
  game.city.wineSources = 1;
  ground(game, s.x, s.y, 2, HOUSE_TIERS[lvl].up);
  updateHouse(game, b);
  assert.equal(b.house.tier, T('Villa'));
  assert.equal(b.house.pop, HOUSE_TIERS[T('Villa')].people);
  assert.equal(displaced(game), HOUSE_TIERS[lvl].people - HOUSE_TIERS[T('Villa')].people);
  assert.ok(game.city.flags.firstVilla);
});

test('the top level never moves up', () => {
  const game = newGame();
  const s = findFree(game, 4, 4);
  const b = home(game, s.x, s.y, MAX_TIER, 150);
  serveAll(b.house);
  game.city.wineSources = 2;
  game.city.entBase = ENT_BASE_MAX;
  ground(game, s.x, s.y, 4, 100);
  updateHouse(game, b);
  assert.equal(b.house.tier, MAX_TIER);
  assert.equal(b.house.blocked, null);
  assert.equal(b.house.devolveDays, 0);
});

test('an empty block or big home goes back to one vacant lot per tile', () => {
  const game = newGame();
  const s = findFree(game, 2, 2);
  const b = home(game, s.x, s.y, T('Hut'), 0, 2);
  b.house.merged = true;
  updateHouse(game, b);
  const lots = [...game.buildings.values()].filter((o) => o.house);
  assert.equal(lots.length, 4);
  assert.ok(lots.every((o) => o.size === 1 && o.house.tier === 0 && o.house.pop === 0));
});

test('entertainment: city base from seats, venue points, and the both-shows bonus', () => {
  const game = newGame();
  const s = findFree(game, 12, 12);
  const theater = addBuilding(game, 'theater', s.x, s.y);
  const amph = addBuilding(game, 'amphitheater', s.x + 3, s.y);
  theater.efficiency = amph.efficiency = 1;
  theater.shows.theater = 10;
  amph.shows.amphitheater = 10;
  game.city.population = 800;
  updateEntertainmentBase(game);
  // theater 400/800 = 50%, amphitheater 900/800 = 100%, colosseum 0: avg 50 -> 10
  assert.equal(game.city.entBase, Math.floor((50 + 100 + 0) / 3 / 5));
  const h = home(game, s.x, s.y + 5, 5, 10).house;
  h.ent.theater = 5;
  h.ent.amphitheater = 5;
  assert.equal(entertainmentScore(game, h), game.city.entBase + VENUE_POINTS.theater + VENUE_POINTS.amphitheater);
  h.entBoth.amphitheater = 5;
  assert.equal(entertainmentScore(game, h), game.city.entBase + VENUE_POINTS.theater + VENUE_POINTS.amphitheater + VENUE_BOTH_BONUS.amphitheater);
  // An unstaffed venue seats nobody.
  theater.efficiency = 0;
  updateEntertainmentBase(game);
  assert.equal(game.city.entBase, Math.floor((0 + 100 + 0) / 3 / 5));
  assert.ok(VENUE_SEATS.colosseum > VENUE_SEATS.theater);
});

test('education tier needs the right combination', () => {
  const tier = (school, library, academy) => educationTier({ school, library, academy });
  assert.equal(tier(0, 0, 0), 0);
  assert.equal(tier(0, 0, 9), 0, 'an academy alone is nothing');
  assert.equal(tier(9, 0, 0), 1);
  assert.equal(tier(0, 9, 0), 1);
  assert.equal(tier(9, 0, 9), 1, 'academy without a library still tier 1');
  assert.equal(tier(9, 9, 0), 2);
  assert.equal(tier(9, 9, 9), 3);
});

test('wine sources: a working winery, plus each open route selling wine while importing', () => {
  const game = newGame();
  const s = findFree(game, 2, 2);
  const winery = addBuilding(game, 'wine_ws', s.x, s.y);
  updateWineSources(game);
  assert.equal(game.city.wineSources, 0, 'an unstaffed winery does not count');
  winery.efficiency = 0.5;
  updateWineSources(game);
  assert.equal(game.city.wineSources, 1);
  game.city.trade.routes.capua = { open: true, sold: {}, bought: {}, nextVisit: 0, visits: 0 };
  updateWineSources(game);
  assert.equal(game.city.wineSources, 1, 'not while wine is not set to import');
  game.city.trade.settings.wine.mode = 'import';
  updateWineSources(game);
  assert.equal(game.city.wineSources, 2);
});

test('emigrants leave the humblest homes, never villas', () => {
  const game = newGame();
  const s = findFree(game, 6, 3);
  const villa = home(game, s.x, s.y, T('Villa'), 40);
  const hut = home(game, s.x + 3, s.y, T('Hut'), 11);
  const domus = home(game, s.x + 4, s.y, T('Domus'), 18);
  game.city.sentiment = 0;
  game.city.population = 69;
  for (let d = 0; d < 400 && hut.house.pop > 0; d++) updateEmigration(game);
  assert.equal(hut.house.pop, 0);
  assert.equal(domus.house.pop, 18, 'the hut empties first');
  for (let d = 0; d < 400; d++) updateEmigration(game);
  assert.equal(domus.house.pop, 0);
  assert.equal(villa.house.pop, 40, 'patricians stay');
  // Insulae are plebeian homes: their people leave too, once the smaller homes are empty.
  const ins = home(game, s.x, s.y + 2, T('Insula'), 88);
  for (let d = 0; d < 400; d++) updateEmigration(game);
  assert.ok(ins.house.pop < 88);
  assert.equal(villa.house.pop, 40);
});

test('blocks, two-show visits and bad-day counts survive a save', () => {
  const game = newGame();
  const s = spotWithBlockRule(game, 2, 2, true);
  const b = home(game, s.x, s.y, T('Domus'), 60, 2);
  b.house.merged = true;
  b.house.entBoth.colosseum = 12;
  b.house.devolveDays = 2;
  const copy = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  const c = copy.buildings.get(b.id);
  assert.equal(c.size, 2);
  assert.ok(c.house.merged);
  assert.equal(c.house.entBoth.colosseum, 12);
  assert.equal(c.house.devolveDays, 2);
});

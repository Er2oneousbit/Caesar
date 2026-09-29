/**
 * sim.test.mjs - headless simulation tests (node:test, no dependencies)
 * ----------------------------------------------------------------------------
 * Run:  npm test      (or: node --test tests/)
 *
 * These tests drive the real simulation through the same construction API the
 * player uses, so they catch regressions in the whole pipeline: map gen,
 * placement, walkers, water, housing, labor, economy, trade and save/load.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { RNG } from '../src/core/rng.js';
import { log } from '../src/core/debug.js';
import { Game } from '../src/core/game.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { generateMap, MAP_TYPES } from '../src/world/mapgen.js';
import { Terrain, WaterBits } from '../src/world/map.js';
import { PathFinder } from '../src/world/pathfinding.js';
import { SCENARIOS, sandboxScenario } from '../src/data/scenarios.js';
import { HOUSE_TIERS } from '../src/data/housing.js';
import { planAction, applyPlan, undoLast, canUndo } from '../src/sim/construction.js';
import { addBuilding } from '../src/sim/entities.js';
import { checkTier, expandHouse } from '../src/sim/housing.js';
import { updateLabor } from '../src/sim/labor.js';
import { updateWater } from '../src/sim/water.js';
import { monthlyEconomy, houseMonthlyTax } from '../src/sim/economy.js';
import { openRoute, setTradeMode, tradeAt } from '../src/sim/trade.js';
import { buildDemoCity } from '../src/dev/demoCity.js';

log.setLevel('error');

/** A small sandbox game on a known map. */
function newGame(opts = {}) {
  const scenario = sandboxScenario({ size: 64, type: opts.type || 'river', seed: opts.seed || 'test-seed' });
  return new Game({ scenario, flags: { unlockall: true, money: opts.money ?? 50000 } });
}

function build(game, tool, x0, y0, x1 = x0, y1 = y0) {
  return applyPlan(game, planAction(game, tool, x0, y0, x1, y1));
}

/** Find a free rectangle of land (no water/rock/trees/buildings). */
function findFree(game, w, h) {
  const { map } = game;
  for (let y = 2; y < map.h - h - 2; y++) {
    for (let x = 2; x < map.w - w - 2; x++) {
      let ok = true;
      for (let dy = 0; dy < h && ok; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const i = map.idx(x + dx, y + dy);
          if (!map.isFree(x + dx, y + dy) || map.terrain[i] === Terrain.TREES) { ok = false; break; }
        }
      }
      if (ok) return { x, y };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------

test('RNG is deterministic and its state round-trips', () => {
  const a = new RNG('hello');
  const b = new RNG('hello');
  const seqA = Array.from({ length: 5 }, () => a.next());
  const seqB = Array.from({ length: 5 }, () => b.next());
  assert.deepEqual(seqA, seqB);
  const state = a.getState();
  const n1 = a.next();
  a.setState(state);
  assert.equal(a.next(), n1);
  for (let i = 0; i < 1000; i++) {
    const v = a.int(10);
    assert.ok(v >= 0 && v < 10);
  }
});

test('every map type generates a connected imperial road', () => {
  for (const type of Object.keys(MAP_TYPES)) {
    const { map } = generateMap({ width: 64, height: 64, seed: `t-${type}`, type });
    const pf = new PathFinder(map);
    const entry = map.idx(map.entry.x, map.entry.y);
    const exit = map.idx(map.exit.x, map.exit.y);
    assert.ok(map.road[entry], `${type}: entry has road`);
    assert.ok(pf.roadPath(entry, exit), `${type}: entry connects to exit`);
    let water = 0;
    for (let i = 0; i < map.size; i++) if (map.terrain[i] === Terrain.WATER) water++;
    assert.ok(water > 0, `${type}: has some water`);
  }
});

test('map generation is reproducible from the seed', () => {
  const a = generateMap({ width: 64, height: 64, seed: 42, type: 'lakes' }).map;
  const b = generateMap({ width: 64, height: 64, seed: 42, type: 'lakes' }).map;
  assert.deepEqual(Array.from(a.terrain), Array.from(b.terrain));
});

test('road planning, costs and undo refund', () => {
  const game = newGame();
  const spot = findFree(game, 8, 3);
  assert.ok(spot, 'found free land');
  const before = game.city.treasury;
  const res = build(game, 'road', spot.x, spot.y, spot.x + 7, spot.y);
  assert.ok(res.ok);
  assert.equal(res.count, 8);
  assert.equal(game.city.treasury, before - 8 * 4);
  assert.ok(canUndo(game));
  const u = undoLast(game);
  assert.ok(u.ok);
  assert.equal(game.city.treasury, before);
  assert.equal(game.map.road[game.map.idx(spot.x, spot.y)], 0);
});

test('placement rules reject bad spots', () => {
  const game = newGame();
  const { map } = game;
  let water = -1;
  for (let i = 0; i < map.size; i++) if (map.terrain[i] === Terrain.WATER) { water = i; break; }
  const plan = planAction(game, 'prefecture', map.xOf(water), map.yOf(water), map.xOf(water), map.yOf(water));
  assert.equal(plan.count, 0);
  assert.match(plan.reason, /water/i);
  // Farms need meadow.
  const spot = findFree(game, 3, 3);
  if (map.countTerrain(spot.x, spot.y, 3, Terrain.MEADOW) === 0) {
    const farm = planAction(game, 'farm_wheat', spot.x + 1, spot.y + 1, spot.x + 1, spot.y + 1);
    assert.equal(farm.count, 0);
    assert.match(farm.reason, /meadow/i);
  }
  // Not enough money
  const poor = newGame({ money: 3 });
  const p2 = planAction(poor, 'prefecture', spot.x, spot.y, spot.x, spot.y);
  assert.equal(p2.count, 0);
  assert.match(p2.reason, /money/i);
});

test('reservoir by the water fills, aqueduct feeds a second one, fountains get water', () => {
  const game = newGame();
  const { map } = game;
  // Find a free 3x3 touching water.
  let site = null;
  for (let y = 2; y < map.h - 5 && !site; y++) {
    for (let x = 2; x < map.w - 5 && !site; x++) {
      if (!map.isNearTerrain(x, y, 3, Terrain.WATER, 1)) continue;
      let free = true;
      for (let dy = 0; dy < 3 && free; dy++) for (let dx = 0; dx < 3; dx++) if (!map.isFree(x + dx, y + dy)) { free = false; break; }
      if (free) site = { x, y };
    }
  }
  assert.ok(site, 'found a reservoir site by the water');
  const r1 = addBuilding(game, 'reservoir', site.x, site.y);
  updateWater(game);
  assert.ok(r1.hasWater, 'first reservoir is full');
  assert.ok(map.water[map.idx(site.x + 1, site.y + 1)] & WaterBits.PIPED);
  // A fountain inside the piped area has water.
  let fountain = null;
  for (let r = 4; r < 9 && !fountain; r++) {
    for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r]]) {
      const x = site.x + 1 + dx;
      const y = site.y + 1 + dy;
      if (map.isFree(x, y)) { fountain = addBuilding(game, 'fountain', x, y); break; }
    }
  }
  assert.ok(fountain, 'placed a fountain');
  fountain.efficiency = 1;
  updateWater(game);
  assert.ok(fountain.hasWater, 'fountain has water');
  assert.ok(map.water[map.idx(fountain.x, fountain.y)] & WaterBits.FOUNTAIN, 'fountain covers its tile');
});

test('housing tiers: requirement checks behave', () => {
  const none = { des: 0, water: 0, food: 0, religion: 0, ent: 0, edu: 0, health: 0, goods: [] };
  assert.ok(checkTier(1, none).ok, 'tents need nothing');
  const r2 = checkTier(2, none);
  assert.ok(!r2.ok);
  assert.equal(r2.missing[0].key, 'water');
  assert.ok(checkTier(2, { ...none, water: 1 }).ok);
  const domus = { des: 7, water: 2, food: 1, religion: 1, ent: 15, edu: 0, health: 0, goods: ['pottery'] };
  assert.ok(checkTier(6, domus).ok);
  assert.ok(!checkTier(6, { ...domus, goods: [] }).ok);
});

test('small houses merge into a 2x2 home', () => {
  const game = newGame();
  const spot = findFree(game, 4, 4);
  const hs = [];
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const b = addBuilding(game, 'house', spot.x + dx, spot.y + dy);
    b.house.tier = 6;
    b.house.pop = 15;
    b.house.food.wheat = 5;
    hs.push(b);
  }
  const ok = expandHouse(game, hs[0], 2);
  assert.ok(ok, 'merge succeeded');
  assert.equal(hs[0].size, 2);
  assert.equal(hs[0].house.pop, 60);
  assert.equal(hs[0].house.food.wheat, 20);
  assert.equal(game.buildings.size, 1);
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) assert.equal(game.map.buildingAt(spot.x + dx, spot.y + dy), hs[0].id);
});

test('settlers move into houses and tents appear', () => {
  const game = newGame();
  const res = buildDemoCity(game, { level: 1 });
  assert.ok(res.ok, res.reason);
  game.runDays(16 * 3);
  assert.ok(game.city.population > 50, `population grew (${game.city.population})`);
  const tents = [...game.buildings.values()].filter((b) => b.house && b.house.tier >= 1).length;
  assert.ok(tents > 5);
});

test('labor priorities are staffed first', () => {
  const game = newGame();
  const spot = findFree(game, 10, 3);
  build(game, 'road', spot.x, spot.y + 1, spot.x + 9, spot.y + 1);
  const pre = addBuilding(game, 'prefecture', spot.x, spot.y);
  const eng = addBuilding(game, 'engineer_post', spot.x + 2, spot.y);
  const house = addBuilding(game, 'house', spot.x + 4, spot.y);
  game.processRoadChanges();
  house.house.tier = 3;
  house.house.pop = 20; // workforce = floor(20 * 0.32) = 6
  pre.laborAccess = eng.laborAccess = 30;
  game.city.laborPriority = ['engineering'];
  updateLabor(game);
  assert.equal(eng.workers, 5, 'engineers filled first');
  assert.equal(pre.workers, 1, 'prefecture gets the rest');
});

test('taxes need a collector visit; wages are paid monthly', () => {
  const game = newGame();
  const spot = findFree(game, 3, 3);
  const house = addBuilding(game, 'house', spot.x, spot.y);
  house.house.tier = 6;
  house.house.pop = 15;
  game.city.employed = 12;
  const t0 = game.city.treasury;
  monthlyEconomy(game);
  assert.equal(game.city.treasury, t0 - Math.round((12 * game.city.wage) / 12), 'only wages without tax coverage');
  house.house.tax = 10;
  const expected = Math.round(houseMonthlyTax(game, house.house));
  assert.ok(expected > 0);
  const t1 = game.city.treasury;
  monthlyEconomy(game);
  assert.equal(game.city.treasury, t1 - Math.round((12 * game.city.wage) / 12) + expected);
});

test('caravans buy exports and sell imports at a warehouse', () => {
  const game = newGame();
  const spot = findFree(game, 3, 3);
  const wh = addBuilding(game, 'warehouse', spot.x, spot.y);
  wh.efficiency = 1;
  wh.stock.pottery = 800;
  const partner = Object.keys(game.city.trade.routes).find((id) => id === 'tarraco');
  assert.ok(partner, 'tarraco available in sandbox');
  assert.ok(openRoute(game, partner).ok);
  setTradeMode(game, 'pottery', 'export', 0);
  setTradeMode(game, 'timber', 'import', 400);
  const before = game.city.treasury;
  const out = tradeAt(game, partner, wh);
  assert.ok(out.sold.pottery > 0, 'sold pottery');
  assert.ok(out.bought.timber > 0, 'bought timber');
  assert.equal(game.city.treasury, before + out.earned - out.spent);
  assert.equal(wh.stock.timber, out.bought.timber);
});

test('save and load round-trip keeps the city intact', () => {
  const game = newGame();
  buildDemoCity(game, { level: 2 });
  game.runDays(16 * 4);
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  const copy = deserializeGame(data);
  assert.equal(copy.buildings.size, game.buildings.size);
  assert.equal(copy.walkers.size, game.walkers.size);
  assert.equal(Math.round(copy.city.treasury), Math.round(game.city.treasury));
  assert.equal(copy.time.totalTicks, game.time.totalTicks);
  assert.deepEqual(Array.from(copy.map.road), Array.from(game.map.road));
  // Keeps running without errors.
  copy.runDays(16 * 2);
  assert.ok(copy.city.population > 0);
});

test('loading rejects garbage with a readable error', () => {
  assert.throws(() => deserializeGame({ hello: 1 }), /not a Colonia save/);
  assert.throws(() => deserializeGame({ format: 'colonia-save', version: 999, map: {}, time: {}, city: {}, buildings: [] }), /newer version/);
});

test('a demo city survives two years without errors and grows', () => {
  const game = newGame({ seed: 'soak' });
  const res = buildDemoCity(game, { level: 2 });
  assert.ok(res.ok, res.reason);
  const errors = [];
  const origError = log.error;
  log.error = (...a) => errors.push(a.map(String).join(' '));
  try {
    game.runDays(16 * 24);
  } finally {
    log.error = origError;
  }
  assert.deepEqual(errors, [], 'no errors logged by the simulation');
  assert.ok(game.city.population > 300, `population ${game.city.population}`);
  assert.ok(HOUSE_TIERS.length === 13);
});

test('campaign scenarios all build a valid game', () => {
  for (const s of SCENARIOS) {
    const g = new Game({ scenario: s, flags: {} });
    assert.ok(g.map.road[g.map.idx(g.map.entry.x, g.map.entry.y)], `${s.id} entry road`);
    assert.ok(g.city.treasury === s.funds, `${s.id} funds`);
    g.runDays(4);
  }
});

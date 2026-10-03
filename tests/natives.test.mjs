/**
 * natives.test.mjs - native villages and the mission post (sim/natives.js,
 * world/natives.js, data/natives.js): where villages stand (Mutina, Luna and
 * the sandbox when asked; the rest of the map and the game's own stream as
 * before), anger and the land a building may not stand on, the attack and
 * its villagers, the missionary's calm and its wearing off, who fights a
 * villager, native trade, clearing, and saves.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { Game } from '../src/core/game.js';
import { sandboxScenario, findScenario, withDifficulty } from '../src/data/scenarios.js';
import { NATIVES, MISSION_NATIVES } from '../src/data/natives.js';
import { Terrain } from '../src/world/map.js';
import { addBuilding, spawnWalker } from '../src/sim/entities.js';
import { planAction, applyPlan } from '../src/sim/construction.js';
import { updateWalkers } from '../src/sim/walkers.js';
import { spawnUnit, updateMilitary, hostileToRome } from '../src/sim/military.js';
import { setTradeMode } from '../src/sim/trade.js';
import { nativesDaily, missionaryVisit, villagesOf, nativePrice, landLayer, nativeLandWarning } from '../src/sim/natives.js';
import { ruinAt } from '../src/sim/ruins.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';

log.setLevel('error');

const N = NATIVES;

/** A sandbox with native villages (river, 96 tiles; three villages on this seed). */
function villageGame(natives = true, seed = 'natives-test') {
  const scenario = { ...sandboxScenario({ size: 96, type: 'river', seed, invasions: 'none' }), ...(natives ? { natives: true } : {}) };
  return new Game({ scenario, flags: { unlockall: true, money: 50000 } });
}

/** Chebyshev distance between two footprints. */
function gap(a, b) {
  const dx = Math.max(0, b.x - (a.x + a.size - 1), a.x - (b.x + b.size - 1));
  const dy = Math.max(0, b.y - (a.y + a.size - 1), a.y - (b.y + b.size - 1));
  return Math.max(dx, dy);
}

/** A free 1x1 tile at distance `d` (Chebyshev) from the meeting place, away from every other village piece by at least `min`. */
function spotNear(game, m, d, min = 0) {
  const { map } = game;
  const pieces = [...game.buildings.values()].filter((b) => b.def.kind === 'village');
  for (let y = m.y - d; y <= m.y + 1 + d; y++) {
    for (let x = m.x - d; x <= m.x + 1 + d; x++) {
      if (gap(m, { x, y, size: 1 }) !== d || !map.isFree(x, y) || map.terrain[map.idx(x, y)] === Terrain.TREES) continue;
      if (pieces.some((p) => p !== m && gap(p, { x, y, size: 1 }) < min)) continue;
      return { x, y };
    }
  }
  return null;
}

/** The first village, its meeting place and huts. */
function firstVillage(game) {
  const [v] = villagesOf(game);
  assert.ok(v, 'a village');
  return v;
}

test('natives: Mutina and Luna have 2 or 3 Ligurian villages away from the road and off the meadow; the other missions none', () => {
  for (const id of Object.keys(MISSION_NATIVES)) {
    const game = new Game({ scenario: withDifficulty(findScenario(id), 'normal') });
    const vs = villagesOf(game);
    assert.ok(vs.length >= 2 && vs.length <= 3, `${id}: ${vs.length} villages`);
    assert.equal(game.city.natives.people, 'ligurian');
    const road = [...Array(game.map.size).keys()].filter((i) => game.map.road[i]);
    for (const v of vs) {
      assert.ok(v.huts.length >= N.HUTS[0] && v.huts.length <= N.HUTS[1], `${id}: ${v.huts.length} huts`);
      for (const h of v.huts) {
        const d = Math.max(Math.abs(h.x + 0.5 - (v.m.x + 1)), Math.abs(h.y + 0.5 - (v.m.y + 1)));
        assert.ok(d >= N.HUT_RING[0] && d <= N.HUT_RING[1] + 0.5, `hut ${d} from its meeting place`);
      }
      for (let k = 0; k < 4; k++) assert.equal(game.map.terrain[game.map.idx(v.m.x + (k & 1), v.m.y + (k >> 1))], Terrain.GRASS, 'on grass, not meadow');
      const near = Math.min(...road.map((i) => Math.abs(game.map.xOf(i) - v.m.x) + Math.abs(game.map.yOf(i) - v.m.y)));
      assert.ok(near >= N.ROAD_CLEARANCE, `${near} tiles from the road`);
      assert.equal(v.m.anger, N.ANGER_MAX, 'angry at the start');
    }
    assert.equal(game.isUnlocked('mission_post'), true);
  }
  for (const id of ['c1', 'c4', 'c8m'].filter((x) => !MISSION_NATIVES[x])) {
    const game = new Game({ scenario: withDifficulty(findScenario(id), 'normal') });
    assert.equal(game.city.natives, null);
    assert.equal(game.isUnlocked('mission_post'), false, `${id}: no mission post without villages`);
  }
});

test('natives: none in the sandbox unless asked; asked, the map, the road and the game\'s own random stream are as without them', () => {
  const plain = villageGame(false);
  const with_ = villageGame(true);
  assert.equal(plain.city.natives, null);
  assert.equal([...plain.buildings.values()].some((b) => b.def.kind === 'village'), false);
  assert.equal(plain.isUnlocked('mission_post'), false, 'even with every building unlocked');
  assert.ok(villagesOf(with_).length >= 1 && villagesOf(with_).length <= 3);
  assert.deepEqual(with_.map.terrain, plain.map.terrain);
  assert.deepEqual(with_.map.road, plain.map.road);
  assert.deepEqual(with_.rng.getState(), plain.rng.getState());
  // The same seed, the same villages.
  const again = villageGame(true);
  assert.deepEqual(villagesOf(again).map((v) => [v.m.x, v.m.y, v.huts.length]), villagesOf(with_).map((v) => [v.m.x, v.m.y, v.huts.length]));
});

test('natives: a building on an angry village\'s land starts an attack; off it, or a road, or the mission post, does not', () => {
  const game = villageGame();
  const v = firstVillage(game);
  const far = spotNear(game, v.m, N.MEETING_LAND + 6, N.MEETING_LAND + 4);
  addBuilding(game, 'garden', far.x, far.y);
  const road = spotNear(game, v.m, 2, 1);
  game.map.road[game.map.idx(road.x, road.y)] = 1;
  const postSpot = spotNear(game, v.m, 4, 2);
  addBuilding(game, 'mission_post', postSpot.x, postSpot.y); // (its own 2x2 may overlap nothing: a mission post never angers)
  game.onMapEdited();
  game.runDays(3);
  assert.equal(game.city.natives.attacks, 0);
  assert.equal(v.m.attackDays, 0);
  const near = spotNear(game, v.m, N.MEETING_LAND, 1);
  const target = addBuilding(game, 'prefecture', near.x, near.y);
  assert.match(nativeLandWarning(game, 'prefecture', near.x, near.y, 1, 1), /Native land: .* attack while their village is angry/);
  game.runDays(1);
  assert.equal(game.city.natives.attacks, 1);
  assert.ok(v.m.attackDays > 0);
  assert.equal(v.m.target, target.id);
  assert.ok(game.messages.some((m) => /native village near .* is attacking: the Excubitorium/.test(m.text)));
  const men = [...game.units.values()].filter((u) => u.side === 'native');
  assert.equal(men.length, v.huts.length, 'one villager a hut');
  assert.ok(men.every((u) => u.attacking && hostileToRome(u)));
  assert.equal(game.city.raidMonth, true, 'no peace gained this month');
});

test('natives: the villagers tear the building down, then the attack ends and they go home', () => {
  const game = villageGame();
  const v = firstVillage(game);
  const near = spotNear(game, v.m, 4, 1);
  const target = addBuilding(game, 'prefecture', near.x, near.y);
  let days = 0;
  while (game.buildings.has(target.id) && days < 40) { game.runDays(1); days++; }
  assert.equal(game.buildings.has(target.id), false, `torn down in ${days} days`);
  assert.equal(ruinAt(game, game.map.idx(near.x, near.y)).cause, 'natives');
  assert.ok(game.messages.some((m) => m.text === 'Angry villagers have torn down an Excubitorium!'));
  assert.equal(game.city.natives.buildingsLost, 1);
  game.runDays(N.ATTACK_DAYS + 1);
  assert.equal(v.m.attackDays, 0, 'nothing left on its land: the attack is over');
  for (let d = 0; d < 20 && [...game.units.values()].some((u) => u.side === 'native'); d++) game.runDays(1);
  assert.equal([...game.units.values()].filter((u) => u.side === 'native').length, 0, 'every villager home');
});

test('natives: a missionary calms every hut and meeting place within 4 tiles; the calm lasts until anger is back at 100', () => {
  const game = villageGame();
  const v = firstVillage(game);
  missionaryVisit(game, { x: v.m.x, y: v.m.y });
  assert.equal(v.m.anger, 0, 'the meeting place is calm');
  for (const h of v.huts) assert.equal(h.anger, gap(h, { x: v.m.x, y: v.m.y, size: 1 }) <= N.CALM_REACH ? 0 : N.ANGER_MAX);
  assert.ok(game.messages.some((m) => /A missionary has calmed the native village/.test(m.text)));
  for (const b of [v.m, ...v.huts]) b.anger = N.ANGER_MAX - 2; // two days of calm left
  const near = spotNear(game, v.m, 3, 1);
  addBuilding(game, 'garden', near.x, near.y);
  game.runDays(2);
  assert.equal(game.city.natives.attacks, 0, 'still calm: 98, 99, 100 without a look');
  assert.equal(v.m.anger, N.ANGER_MAX);
  game.runDays(1);
  assert.equal(game.city.natives.attacks, 1, 'angry again: it looks, and attacks');
  // A missionary passing during the attack ends it at once, once no piece
  // still angry has the garden on its land (the huts beyond his reach have
  // been calmed on an earlier round).
  for (const h of v.huts) if (gap(h, { x: v.m.x, y: v.m.y, size: 1 }) > N.CALM_REACH) h.anger = 0;
  missionaryVisit(game, { x: v.m.x, y: v.m.y });
  assert.equal(v.m.attackDays, 0);
  assert.ok([...game.units.values()].filter((u) => u.side === 'native').every((u) => !u.attacking));
});

test('natives: Rome\'s soldiers fight a villager only while he attacks', () => {
  assert.equal(hostileToRome({ side: 'enemy' }), true);
  assert.equal(hostileToRome({ side: 'rome' }), false);
  assert.equal(hostileToRome({ side: 'native', attacking: false }), false);
  assert.equal(hostileToRome({ side: 'native', attacking: true }), true);
  const game = villageGame();
  const v = firstVillage(game);
  const hut = v.huts[0];
  const spot = spotNear(game, v.m, 10, 6);
  const fort = addBuilding(game, 'fort_legion', spot.x - 1, spot.y - 1);
  const soldier = spawnUnit(game, 'legionary', hut.x + 2.5, hut.y + 0.5, { fort: fort.id, slot: 0 });
  fort.rally = { x: soldier.x, y: soldier.y }; // deployed where he stands: he fights what comes near
  const calm = spawnUnit(game, 'villager', hut.x + 1.5, hut.y + 0.5, { village: v.m.id, hut: hut.id, attacking: false, state: 'home' });
  for (let t = 0; t < 30; t++) updateMilitary(game);
  assert.notEqual(soldier.target, calm.id, 'a villager going about his business is left alone');
  // Now his village attacks (a building on its land), and the next one out is fair game.
  const near = spotNear(game, v.m, 3, 1);
  addBuilding(game, 'garden', near.x, near.y);
  game.runDays(1);
  const angry = [...game.units.values()].find((u) => u.side === 'native' && u.attacking);
  assert.ok(angry);
  angry.x = soldier.x - 1;
  angry.y = soldier.y;
  let fought = false;
  for (let t = 0; t < 30 && !fought; t++) { updateMilitary(game); fought = soldier.target === angry.id || !game.units.has(angry.id); }
  assert.equal(fought, true, 'he takes on the attacking villager');
});

/** A calmed village beside a warehouse of pottery set for export, with a staffed mission post. */
function tradeSetup(stock = 500, level = 100) {
  const game = villageGame();
  const v = firstVillage(game);
  for (const b of [v.m, ...v.huts]) b.anger = 0;
  const spot = spotNear(game, v.m, 8, 3);
  let wh = null;
  for (let dy = -2; dy <= 2 && !wh; dy++) {
    for (let dx = -2; dx <= 2 && !wh; dx++) {
      const x = spot.x + dx;
      const y = spot.y + dy;
      let free = true;
      for (let k = 0; k < 9; k++) free = free && game.map.isFree(x + (k % 3), y + Math.floor(k / 3)) && game.map.terrain[game.map.idx(x + (k % 3), y + Math.floor(k / 3))] !== Terrain.TREES;
      if (free) wh = addBuilding(game, 'warehouse', x, y);
    }
  }
  assert.ok(wh, 'a warehouse near the village');
  wh.stock.pottery = stock;
  setTradeMode(game, 'pottery', 'export', level);
  const ps = spotNear(game, v.m, 14, 8);
  const post = addBuilding(game, 'mission_post', ps.x, ps.y);
  post.efficiency = 1;
  post.accessRoad = game.map.idx(ps.x, ps.y); // (staffed and on a road, as far as the villages can tell)
  return { game, v, wh, post };
}

/** Move walkers only (no day passes), until `done` or the tick limit. */
function walk(game, done, ticks = 4000) {
  for (let t = 0; t < ticks && !done(); t++) updateWalkers(game);
}

test('natives: a calmed village\'s trader walks to the warehouse and buys up to 3 loads of exports above the keep level, at the cheapest price', () => {
  const { game, v, wh } = tradeSetup(500, 100);
  v.m.traderDays = 1;
  const before = game.city.treasury;
  nativesDaily(game);
  const trader = [...game.walkers.values()].find((w) => w.type === 'native_trader');
  assert.ok(trader, 'a trader sets out');
  assert.equal(v.m.traderDays, N.TRADER_DAYS, 'the next in 9 days');
  walk(game, () => trader.state !== 'nativeBuy' || trader.dead);
  assert.equal(wh.stock.pottery, 200, '3 loads of 100');
  const price = nativePrice(game, 'pottery');
  assert.equal(Math.round(game.city.treasury - before), Math.round((price * 300) / 100));
  const entry = game.city.trade.log[0];
  assert.equal(entry.partner, 'The native village');
  assert.deepEqual(entry.sold, { pottery: 300 });
  assert.equal(game.city.natives.trades, 1);
  walk(game, () => trader.dead);
  assert.equal(trader.dead, true, 'home again, and gone');
});

test('natives: the trader keeps to the keep level; none comes without a staffed post or from an angry village', () => {
  const a = tradeSetup(250, 100);
  a.v.m.traderDays = 1;
  nativesDaily(a.game);
  const t = [...a.game.walkers.values()].find((w) => w.type === 'native_trader');
  walk(a.game, () => t.state !== 'nativeBuy' || t.dead);
  assert.equal(a.wh.stock.pottery, 150, 'one load: 150 above the level of 100 is one whole load');
  const b = tradeSetup();
  b.post.efficiency = 0;
  b.v.m.traderDays = 1;
  nativesDaily(b.game);
  assert.equal([...b.game.walkers.values()].some((w) => w.type === 'native_trader'), false, 'no staff at the post: no trade (the original traded on: a bug)');
  const c = tradeSetup();
  c.v.m.anger = N.ANGER_MAX;
  c.v.m.traderDays = 1;
  nativesDaily(c.game);
  assert.equal([...c.game.walkers.values()].some((w) => w.type === 'native_trader'), false, 'an angry village does not trade');
});

test('natives: a village cannot be cleared, and its land shows on the overlay', () => {
  const game = villageGame();
  const v = firstVillage(game);
  const plan = planAction(game, 'clear', v.m.x - 1, v.m.y - 1, v.m.x + 2, v.m.y + 2);
  assert.ok(plan.items.some((it) => it.ok === false && /not yours to clear/.test(it.reason)));
  applyPlan(game, plan);
  assert.ok(game.buildings.has(v.m.id));
  const layer = landLayer(game);
  assert.equal(layer[game.map.idx(v.m.x - N.MEETING_LAND, v.m.y)], 2, 'angry land');
  for (const b of game.buildings.values()) if (b.anger !== undefined) b.anger = 0; // every village calmed
  game.time.totalDays++; // (the layer is kept for a day)
  assert.equal(landLayer(game)[game.map.idx(v.m.x - N.MEETING_LAND, v.m.y)], 1, 'calmed land');
});

test('natives: a save keeps the villages, their anger, the attack and its villagers; an older save has none', () => {
  const game = villageGame();
  const v = firstVillage(game);
  v.huts[0].anger = 42;
  const near = spotNear(game, v.m, 3, 1);
  addBuilding(game, 'garden', near.x, near.y);
  game.runDays(1);
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  const back = deserializeGame(data);
  const bv = villagesOf(back).find((x) => x.m.id === v.m.id);
  assert.equal(bv.huts.find((h) => h.id === v.huts[0].id).anger, 43, 'calm: 1 angrier a day');
  assert.equal(bv.m.attackDays, v.m.attackDays);
  assert.equal([...back.units.values()].filter((u) => u.side === 'native').length, [...game.units.values()].filter((u) => u.side === 'native').length);
  assert.deepEqual(back.city.natives, game.city.natives);
  back.runDays(2); // (and plays on)
  const plain = villageGame(false);
  const old = JSON.parse(JSON.stringify(serializeGame(plain)));
  delete old.city.natives;
  const loaded = deserializeGame(old);
  assert.equal(loaded.city.natives, null);
  loaded.runDays(1);
});

test('natives: the mission post is 2x2, 100 Dn, 20 workers, never burns or falls down, and its missionary is a priest at a roadblock', async () => {
  const { BUILDINGS } = await import('../src/data/buildings.js');
  const { WALKER_TYPES } = await import('../src/data/walkers.js');
  const d = BUILDINGS.mission_post;
  assert.deepEqual([d.size, d.cost, d.workers, d.fire, d.damage, d.walker], [2, 100, 20, 0, 0, 'missionary']);
  assert.equal(WALKER_TYPES.missionary.group, 'religion');
  for (const k of ['native_hut', 'native_meeting', 'native_crops']) assert.equal(BUILDINGS[k].category, null, `${k}: never in the build menu`);
  assert.equal(CONFIG.CART_CAPACITY, 100, '(a load is 100 units)');
});

test('natives: the mission post\'s missionary calms as he walks (roamerVisit); raiders pass villages by', async () => {
  const { roamerVisit } = await import('../src/sim/services.js');
  const { computeField } = await import('../src/sim/military.js');
  const game = villageGame();
  const v = firstVillage(game);
  const w = spawnWalker(game, 'missionary', game.map.idx(v.m.x - 2, v.m.y), null, { state: 'roam' });
  roamerVisit(game, w);
  assert.equal(v.m.anger, 0);
  computeField(game);
  assert.notEqual(game.enemyField[game.map.idx(v.m.x, v.m.y)], 0, 'no raider goal');
});

test('natives: a village is never "idle" in the building tour, nor a problem on the Problems overlay', async () => {
  const { idleBuildings } = await import('../src/ui/cycle.js');
  const { problemOf } = await import('../src/ui/problems.js');
  const game = villageGame();
  const v = firstVillage(game);
  assert.equal(idleBuildings(game).some((b) => b.def.kind === 'village'), false);
  assert.equal(problemOf(game, v.m), null);
  assert.equal(problemOf(game, v.huts[0]), null);
});

test('natives: villages leave the city\'s run as it would be without them: its buildings\' ids (their work ticks), and where raiders come from', async () => {
  const { buildDemoCity } = await import('../src/dev/demoCity.js');
  const { launchInvasion } = await import('../src/sim/military.js');
  // Mutina's sweep moved (peace 56 to 47 with no attack): the villages took
  // ids 1 to 33, so every building of the city worked on another tick of the
  // day, and they counted in the city's middle that raiders come away from.
  const runs = [false, true].map((natives) => {
    const game = villageGame(natives);
    const res = buildDemoCity(game, { level: 2 });
    assert.ok(res.ok, res.reason);
    const own = [...game.buildings.values()].filter((b) => b.def.kind !== 'village');
    game.military.settings = { base: 6 };
    const inv = launchInvasion(game);
    return { ids: own.map((b) => `${b.type}@${b.x},${b.y}#${b.id}`).sort(), origin: inv && inv.origin };
  });
  assert.deepEqual(runs[1].ids, runs[0].ids, 'the city\'s buildings, places and ids as without villages');
  assert.deepEqual(runs[1].origin, runs[0].origin, 'the raid comes from the same edge');
});

test('natives: a save keeps the villages\' ids apart: the next building of the city gets the id it would have had', () => {
  const game = villageGame();
  const next = game.nextBuildingId;
  const back = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  assert.equal(back.nextBuildingId, next);
  assert.ok(villagesOf(back).length >= 1);
});

test('natives: a prefect on his rounds fights a villager who attacks, and calls him a villager', async () => {
  const { updatePrefectFights, foeLabel } = await import('../src/sim/prefectFight.js');
  const game = villageGame();
  const v = firstVillage(game);
  const h = v.huts[0];
  v.m.attackDays = 2;
  let pt = null;
  for (let d = 2; d < 6 && !pt; d++) for (let dx = -d; dx <= d && !pt; dx++) if (game.map.isFree(h.x + dx, h.y + d)) pt = { x: h.x + dx, y: h.y + d };
  const u = spawnUnit(game, 'villager', pt.x + 0.5, pt.y + 0.5, { village: v.m.id, hut: h.id, attacking: true, state: 'advance' });
  const p = spawnWalker(game, 'prefect', game.map.idx(pt.x, pt.y), null, { state: 'roam' });
  let fought = false;
  for (let t = 0; t < 50 && !fought; t++) { updatePrefectFights(game); fought = p.fight === u.id || !game.units.has(u.id); }
  assert.equal(fought, true, 'he takes him on (no raid needed)');
  assert.equal(foeLabel(u), 'a villager');
});

test('natives: a missionary passing the meeting place while a far hut stays angry does not end and restart the attack every day', () => {
  const game = villageGame();
  const v = firstVillage(game);
  const mis = { x: v.m.x, y: v.m.y };
  const far = v.huts.find((h) => gap(h, { x: mis.x, y: mis.y, size: 1 }) > N.CALM_REACH);
  assert.ok(far, 'a hut beyond his reach');
  let spot = null;
  for (let y = far.y - 3; y <= far.y + 3 && !spot; y++) {
    for (let x = far.x - 3; x <= far.x + 3 && !spot; x++) {
      if (!game.map.isFree(x, y) || game.map.terrain[game.map.idx(x, y)] === Terrain.TREES) continue;
      if (gap({ x, y, size: 1 }, { x: mis.x, y: mis.y, size: 1 }) <= N.CALM_REACH) continue;
      if ([...game.buildings.values()].some((b) => b.def.kind === 'village' && gap(b, { x, y, size: 1 }) < 1)) continue;
      spot = { x, y };
    }
  }
  addBuilding(game, 'garden', spot.x, spot.y);
  missionaryVisit(game, mis);
  for (let d = 0; d < 12; d++) {
    game.runDays(1);
    missionaryVisit(game, mis);
  }
  assert.equal(game.city.natives.attacks, 1, 'one attack, still going: the far hut is still angry');
  assert.equal(game.messages.filter((m) => /is attacking/.test(m.text)).length, 1);
});

test('natives: a villager who walks home is not "fallen": his hut can send him out again at once', () => {
  const game = villageGame();
  const v = firstVillage(game);
  const near = spotNear(game, v.m, 3, 1);
  addBuilding(game, 'garden', near.x, near.y);
  game.runDays(1);
  const hut = v.huts.find((h) => h.villager && game.units.has(h.villager));
  assert.ok(hut);
  const u = game.units.get(hut.villager);
  u.attacking = false; // sent home
  u.x = hut.x + 0.5;
  u.y = hut.y + 0.6;
  updateMilitary(game);
  assert.equal(game.units.has(u.id), false, 'home');
  assert.equal(hut.villager, 0, 'free to go out again, no 5-day wait');
});

test('natives: rioters, Caesar\'s men and raider ships leave a village be', async () => {
  const { pickRiotTarget, riotRank } = await import('../src/sim/crime.js');
  const { legionTargets } = await import('../src/sim/legion.js');
  const { nearestBuilding } = await import('../src/sim/navy.js');
  const game = villageGame();
  const v = firstVillage(game);
  for (const b of [v.m, ...v.huts]) assert.ok(riotRank(b) < 0, `${b.type}: no rioter's target`);
  assert.equal(pickRiotTarget(game, v.m.x, v.m.y), null, 'nothing else in the city: no target at all');
  const t = legionTargets(game);
  assert.equal(t.what, 'anything');
  assert.equal(t.isTarget(v.m.id), false);
  assert.equal(nearestBuilding(game, { x: v.m.x + 1, y: v.m.y + 1 }, 6), null, 'a raider ship\'s fire pot finds nothing to throw at');
});

test('natives: a building walled in on native land sets off no attack: the villagers could never reach it', async () => {
  const { Wall } = await import('../src/world/map.js');
  const game = villageGame();
  const v = firstVillage(game);
  const { map } = game;
  let spot = null;
  const pieces = [...game.buildings.values()].filter((b) => b.def.kind === 'village');
  for (let y = v.m.y - N.MEETING_LAND; y <= v.m.y + 1 + N.MEETING_LAND && !spot; y++) {
    for (let x = v.m.x - N.MEETING_LAND; x <= v.m.x + 1 + N.MEETING_LAND && !spot; x++) {
      let ok = !pieces.some((p) => gap(p, { x, y, size: 1 }) < 2);
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) ok = ok && map.isFree(x + dx, y + dy) && map.terrain[map.idx(x + dx, y + dy)] !== Terrain.TREES;
      if (ok) spot = { x, y };
    }
  }
  assert.ok(spot, 'room for a walled well');
  addBuilding(game, 'well', spot.x, spot.y);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) map.wall[map.idx(spot.x + dx, spot.y + dy)] = Wall.WALL;
  game.onMapEdited();
  game.runDays(3);
  assert.equal(game.city.natives.attacks, 0, 'no attack: the wall keeps them out');
  assert.equal(v.m.attackDays, 0);
  assert.ok(!game.city.raidMonth, 'peace is gained as usual');
});

test('natives: Caesar\'s men and villagers never route through a village piece (they could not break it)', async () => {
  const { fillField } = await import('../src/sim/military.js');
  const game = villageGame();
  const v = firstVillage(game);
  const near = spotNear(game, v.m, 3, 1);
  const g = addBuilding(game, 'garden', near.x, near.y);
  const field = new Float32Array(game.map.size);
  fillField(game, field, (id) => id === g.id, 12);
  assert.equal(field[game.map.idx(v.m.x, v.m.y)], Infinity, 'the meeting place is no way through');
  for (const h of v.huts) assert.equal(field[game.map.idx(h.x, h.y)], Infinity);
});

test('natives: an earthquake strikes the city\'s own middle and its cracks pass a village by', async () => {
  const { quakePoint, startQuake } = await import('../src/sim/events.js');
  const { RNG } = await import('../src/core/rng.js');
  const game = villageGame();
  assert.equal(quakePoint(game, new RNG('q')), null, 'villages alone are no city to strike');
  const v = firstVillage(game);
  const pieces = () => [...game.buildings.values()].filter((b) => b.def.kind === 'village').length;
  const before = pieces();
  for (let k = 0; k < 4; k++) {
    // The city's only building, beside the village: the quake strikes there.
    if (![...game.buildings.values()].some((b) => b.def.kind !== 'village')) {
      const near = spotNear(game, v.m, 2, 1) || spotNear(game, v.m, 3, 1);
      addBuilding(game, 'garden', near.x, near.y);
    }
    game.city.events.quake = null;
    assert.ok(startQuake(game, 'large'));
    game.runDays(12);
  }
  assert.equal(pieces(), before, 'not a hut nor the meeting place lost');
});

test('natives: prefects fight both a wolf and an attacking villager (one hostileToRome for all)', async () => {
  const { hostileToRome } = await import('../src/sim/military.js');
  assert.equal(hostileToRome({ side: 'wild' }), true);
  assert.equal(hostileToRome({ side: 'native', attacking: true }), true);
  assert.equal(hostileToRome({ side: 'native', attacking: false }), false);
  const { updatePrefectFights } = await import('../src/sim/prefectFight.js');
  for (const type of ['wolf', 'villager']) {
    const game = villageGame();
    const v = firstVillage(game);
    v.m.attackDays = 2;
    const pt = spotNear(game, v.m, 9, 5);
    const u = spawnUnit(game, type, pt.x + 0.5, pt.y + 0.5, type === 'villager' ? { village: v.m.id, hut: v.huts[0].id, attacking: true, state: 'advance' } : { pack: 0 });
    const p = spawnWalker(game, 'prefect', game.map.idx(pt.x, pt.y), null, { state: 'roam' });
    let fought = false;
    for (let t = 0; t < 50 && !fought; t++) { updatePrefectFights(game); fought = p.fight === u.id || !game.units.has(u.id); }
    assert.equal(fought, true, type);
  }
});

/**
 * military.test.mjs - headless tests for the military layer (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Covers the troop supply chains (weapons, Fletcher arrows from timber+iron,
 * horse breeding), recruiting, raids against defended and undefended cities,
 * a fort at rest holding its ground and a deployed one going out, watchtowers,
 * walls and gates, and saving/loading the military state.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { Terrain, Wall } from '../src/world/map.js';
import { addBuilding, removeBuilding } from '../src/sim/entities.js';
import { updateWorkshop, updateProducer } from '../src/sim/production.js';
import { planAction, applyPlan, undoLast } from '../src/sim/construction.js';
import { launchInvasion, spawnUnit, updateMilitary, deployFort, recallFort, militaryMonthly, garrisonCounts, fortPost } from '../src/sim/military.js';
import { HERD_START, HERD_MAX, HERD_GROWTH_DAYS, FORT_CAPACITY, UNIT_TYPES } from '../src/data/units.js';
import { buildDemoCity, buildDemoGarrison, commandGarrison } from '../src/dev/demoCity.js';
import { newGame, build, findFree, unitCounts } from './helpers.mjs';

log.setLevel('error');

/** Demo city that has had time to fill up (workers for the garrison). */
function grownCity(opts = {}) {
  const game = newGame(opts);
  const res = buildDemoCity(game, { level: 2 });
  assert.ok(res.ok, res.reason);
  game.runDays(16 * 5);
  game.city.laborPriority = ['military'];
  return { game, center: res.center };
}

// ---------------------------------------------------------------------------
// Supply chains
// ---------------------------------------------------------------------------

test('fletcher needs BOTH timber and iron to make arrows', () => {
  const game = newGame();
  const spot = findFree(game, 2, 2);
  const f = addBuilding(game, 'fletcher_ws', spot.x, spot.y);
  f.efficiency = 1;
  f.stock.timber = 200;
  for (let d = 0; d < 40; d++) updateWorkshop(game, f);
  assert.equal(f.stock.arrows, 0, 'no arrows from timber alone');
  f.stock.iron = 100;
  for (let d = 0; d < 20; d++) updateWorkshop(game, f);
  assert.ok(f.stock.arrows >= 100, `arrows made (${f.stock.arrows})`);
  assert.equal(f.stock.timber, 200 - (f.stock.arrows / 100) * 100, 'used 100 timber per batch');
  assert.equal(f.stock.iron, 100 - (f.stock.arrows / 100) * 50, 'used 50 iron per batch');
});

test('horse ranch herd grows from 2 to 8 mares and foals faster as it grows', () => {
  const game = newGame();
  const spot = findFree(game, 3, 3);
  const ranch = addBuilding(game, 'horse_ranch', spot.x, spot.y);
  assert.equal(ranch.herd, HERD_START);
  ranch.efficiency = 1;
  ranch.fertility = 1;
  const produced = [];
  for (let d = 1; d <= HERD_GROWTH_DAYS * 7; d++) {
    const before = ranch.stock.horses;
    updateProducer(game, ranch);
    if (ranch.stock.horses > before) produced.push(d);
    ranch.stock.horses = 0; // pretend a cart took them (no road in this test)
  }
  assert.equal(ranch.herd, HERD_MAX, 'herd matured');
  assert.ok(produced.length >= 3, `foals born: ${produced.length}`);
  // Mature ranch: about one horse per productionDays (30).
  ranch.progress = 0;
  let foals = 0;
  for (let d = 0; d < 90; d++) {
    const before = ranch.stock.horses;
    updateProducer(game, ranch);
    if (ranch.stock.horses > before) foals++;
    ranch.stock.horses = 0;
  }
  assert.ok(foals >= 2 && foals <= 4, `mature ranch foals ~3 in 90 days (${foals})`);
  // Idle ranches do not grow their herd.
  const idle = addBuilding(game, 'horse_ranch', spot.x, spot.y + 4);
  idle.efficiency = 0;
  for (let d = 0; d < 100; d++) updateProducer(game, idle);
  assert.equal(idle.herd, HERD_START);
});

test('barracks equips recruits and fills forts; each soldier type needs its own gear', () => {
  const { game, center } = grownCity();
  const gar = buildDemoGarrison(game, center, { stock: false });
  assert.ok(gar.ok, 'garrison placed');
  // The demo ranch would breed extra horses (extra cavalry): keep counts exact.
  if (gar.ranch) removeBuilding(game, gar.ranch);
  const barracks = gar.barracks;
  game.runDays(30);
  assert.equal(game.units.size, 0, 'no equipment, no soldiers');
  assert.match(barracks.blocked || '', /Waiting for/, `barracks says why (${barracks.blocked})`);
  // Deliver equipment: 2 legionaries (100 weapons), 2 archers (100 arrows), 2 cavalry (200 = 2 horses).
  barracks.stock.weapons = 100;
  barracks.stock.arrows = 100;
  barracks.stock.horses = 200;
  game.runDays(80);
  const c = unitCounts(game);
  assert.equal(c.legionary || 0, 2, `legionaries ${JSON.stringify(c)}`);
  assert.equal(c.archer || 0, 2, `archers ${JSON.stringify(c)}`);
  assert.equal(c.cavalry || 0, 2, `cavalry ${JSON.stringify(c)}`);
  assert.equal(barracks.stock.weapons + barracks.stock.arrows + barracks.stock.horses, 0, 'all equipment used');
  assert.equal(game.military.stats.trained, 6);
  // Monthly army pay goes to its own ledger row.
  const before = game.city.finance.thisYear.military || 0;
  militaryMonthly(game);
  const pay = 2 * UNIT_TYPES.legionary.upkeep + 2 * UNIT_TYPES.archer.upkeep + 2 * UNIT_TYPES.cavalry.upkeep;
  assert.equal((game.city.finance.thisYear.military || 0) - before, pay);
});

test('forts only ask for supplies they are missing (no hoarding export weapons)', () => {
  const { game, center } = grownCity();
  const gar = buildDemoGarrison(game, center, { stock: false });
  game.runDays(2);
  const d = game.military.demand;
  const legion = gar.forts.find((f) => f.type === 'fort_legion');
  assert.ok(legion, 'legion fort placed');
  assert.equal(d.weapons, 50 * FORT_CAPACITY, 'an empty legion fort wants 8 sets of weapons');
  // Demolishing the forts removes the demand.
  for (const f of gar.forts) removeBuilding(game, f);
  game.runDays(1);
  assert.equal(game.military.demand.weapons, 0);
});

// ---------------------------------------------------------------------------
// Raids
// ---------------------------------------------------------------------------

test('an undefended city is raided: buildings are wrecked and the raiders leave', () => {
  const { game } = grownCity();
  const lost0 = game.military.stats.buildingsLost;
  const inv = launchInvasion(game, null, 6);
  assert.equal(inv.size, 6);
  assert.equal([...game.units.values()].filter((u) => u.side === 'enemy').length, 6);
  for (let d = 0; d < 140 && game.military.active; d++) game.runDays(1);
  assert.equal(game.military.active, null, 'raid finished');
  assert.ok(game.military.stats.buildingsLost > lost0, 'buildings were lost');
  assert.equal(game.military.stats.repelled, 0);
  assert.equal([...game.units.values()].filter((u) => u.side === 'enemy').length, 0, 'raiders gone');
});

test('a garrison deployed against a raid repels it and peace rises; the forts come home after', () => {
  const { game, center } = grownCity();
  const gar = buildDemoGarrison(game, center, { stock: true });
  game.runDays(100);
  const soldiers = [...game.units.values()].filter((u) => u.side === 'rome').length;
  assert.ok(soldiers >= 10, `garrison recruited (${soldiers})`);
  const peace0 = game.city.ratings.peace;
  launchInvasion(game, null, 5);
  let out = 0;
  for (let d = 0; d < 140 && game.military.active; d++) {
    game.runDays(1);
    out = Math.max(out, commandGarrison(game, center)); // (forts at rest only hold their ground: a player sends them out)
  }
  assert.ok(out >= 1, 'forts were deployed against the raid');
  commandGarrison(game, center);
  assert.ok(gar.forts.every((f) => !f.rally), 'and recalled once it was over');
  assert.equal(game.military.active, null, 'raid finished');
  assert.equal(game.military.stats.repelled, 1, 'raid repelled');
  assert.ok(game.military.stats.enemiesKilled >= 4, `raiders killed: ${game.military.stats.enemiesKilled}`);
  assert.ok(game.city.ratings.peace > peace0 - 1, 'peace did not collapse');
});

test('raids are announced ahead and never hit tiny villages', () => {
  const game = newGame({ invasions: 'occasional' });
  const m = game.military;
  assert.ok(m.settings, 'raids on');
  assert.equal(m.nextRaidMonth, m.settings.first);
  // A village below the population floor only gets its raid postponed.
  game.time.totalMonths = m.nextRaidMonth - 3;
  game.city.population = 50;
  militaryMonthly(game);
  assert.equal(m.warned, null);
  assert.ok(m.nextRaidMonth > game.time.totalMonths + 3, 'postponed');
  // A real town gets a warning three months ahead, then the raid.
  game.city.population = 600;
  game.time.totalMonths = m.nextRaidMonth - 3;
  addBuilding(game, 'house', findFree(game, 1, 1).x, findFree(game, 1, 1).y);
  militaryMonthly(game);
  assert.ok(m.warned, 'scouts warned');
  game.time.totalMonths = m.nextRaidMonth;
  militaryMonthly(game);
  assert.ok(m.active, 'raid launched');
  const peaceful = newGame({ invasions: 'none' });
  assert.equal(peaceful.military.settings, null);
});

test("deploy sends a fort's soldiers to a rally point and recall brings them home", () => {
  const { game, center } = grownCity();
  const gar = buildDemoGarrison(game, center, { stock: true });
  game.runDays(40);
  const fort = gar.forts.find((f) => (garrisonCounts(game).get(f.id) || 0) > 0);
  assert.ok(fort, 'a fort has soldiers');
  const target = findFree(game, 1, 1, { x: fort.x + 10, y: fort.y });
  assert.ok(deployFort(game, fort.id, target.x, target.y));
  game.runDays(12);
  const men = [...game.units.values()].filter((u) => u.fort === fort.id);
  const near = men.filter((u) => Math.hypot(u.x - (target.x + 0.5), u.y - (target.y + 0.5)) < 4);
  assert.equal(near.length, men.length, 'all soldiers at the rally point');
  assert.ok(recallFort(game, fort.id));
  assert.equal(fort.rally, null);
});

// ---------------------------------------------------------------------------
// Holding the fort, and going out
// ---------------------------------------------------------------------------

/**
 * A fort of `type` on open plains with `n` soldiers standing at their posts,
 * nothing else near, and a raid under way (so raiders fight rather than flee).
 */
function heldFort(type = 'fort_legion', n = 1) {
  const game = newGame({ type: 'plains' });
  const spot = clearedLand(game, 22, 16);
  assert.ok(spot, 'open land');
  const fort = addBuilding(game, type, spot.x + 8, spot.y + 2);
  fort.efficiency = 1;
  const post = fortPost(game, fort);
  const men = [];
  for (let slot = 0; slot < n; slot++) men.push(spawnUnit(game, fort.def.unit, post.x, post.y, { fort: fort.id, slot, state: 'march' }));
  for (let t = 0; t < 2000 && !men.every((u) => u.state === 'idle'); t++) updateMilitary(game);
  assert.ok(men.every((u) => u.state === 'idle'), 'at their posts');
  game.military.active = { id: 1, origin: { x: 0, y: 0 }, size: 1, killed: 0, buildingsLost: 0, startDay: 0, fleeing: false, reached: false };
  return { game, fort, men, post: { x: men[0].x, y: men[0].y } };
}

/** A w x h rectangle with no water, rock, road or building, its trees cleared to grass. */
function clearedLand(game, w, h) {
  const { map } = game;
  const blocked = (i) => map.terrain[i] === Terrain.WATER || map.terrain[i] === Terrain.ROCK || map.road[i] || map.fixedRoad[i] || map.building[i];
  for (let y = 2; y < map.h - h - 2; y++) {
    for (let x = 2; x < map.w - w - 2; x++) {
      let ok = true;
      for (let dy = 0; dy < h && ok; dy++) for (let dx = 0; dx < w && ok; dx++) if (blocked(map.idx(x + dx, y + dy))) ok = false;
      if (!ok) continue;
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (map.terrain[map.idx(x + dx, y + dy)] === Terrain.TREES) map.terrain[map.idx(x + dx, y + dy)] = Terrain.GRASS;
      map.touch();
      return { x, y };
    }
  }
  return null;
}

/** Tick `ticks` times with an enemy pinned at (x, y); the farthest the soldier got from `from`. */
function pinned(game, u, foe, x, y, ticks, from) {
  let far = 0;
  for (let t = 0; t < ticks; t++) {
    foe.x = x;
    foe.y = y;
    updateMilitary(game);
    if (game.units.has(u.id)) far = Math.max(far, Math.hypot(u.x - from.x, u.y - from.y));
  }
  return far;
}

test('a fort at rest holds its ground: a raider 6 tiles off is left alone, one that comes to the post is fought (legion and cavalry, raiders and Caesar\'s men)', () => {
  for (const type of ['fort_legion', 'fort_cavalry']) {
    for (const [foeType, init] of [['raider', { invasion: 1 }], ['imperial', { legion: 1 }]]) {
      const { game, men: [u], post } = heldFort(type);
      const foe = spawnUnit(game, foeType, post.x, post.y + 6, init);
      const say = `${type} against ${foeType}`;
      const far = pinned(game, u, foe, post.x, post.y + 6, 120, post);
      assert.ok(far < 0.1, `${say}: he stays at his post (went ${far.toFixed(2)} tiles)`);
      assert.equal(u.target, 0, say);
      assert.equal(foe.hp, foe.maxHp, `${say}: nobody struck`);
      // One within reach of the post: he steps out, strikes, and steps back.
      const far2 = pinned(game, u, foe, post.x, post.y + 1.8, 60, post);
      assert.ok(foe.hp < foe.maxHp || !game.units.has(foe.id), `${say}: struck once he came to the post`);
      assert.ok(far2 < 2, `${say}: no farther than a step out (${far2.toFixed(2)})`);
      foe.hp = 1e6; // (so he lives on to be pulled away)
      pinned(game, u, foe, post.x, post.y + 6, 200, post);
      assert.equal(u.target, 0, `${say}: let go once the raider is off again`);
      assert.ok(Math.hypot(u.x - post.x, u.y - post.y) < 0.2, `${say}: back at his post`);
    }
  }
});

test('an archer at rest shoots from his post at what comes in range, and never walks out after a raider', () => {
  const { game, men: [u], post } = heldFort('fort_archer');
  const foe = spawnUnit(game, 'raider', post.x, post.y + 9, { invasion: 1 });
  const far = pinned(game, u, foe, post.x, post.y + 9, 120, post);
  assert.ok(far < 0.1, `out of range: he stays (went ${far.toFixed(2)})`);
  assert.equal(game.projectiles.length, 0, 'and shoots nothing');
  let shots = 0;
  for (let t = 0; t < 120; t++) {
    const before = game.projectiles.length;
    foe.x = post.x;
    foe.y = post.y + 5;
    updateMilitary(game);
    if (game.projectiles.length > before) shots++;
  }
  assert.ok(shots >= 2, `in range: he shoots (${shots})`);
  assert.ok(Math.hypot(u.x - post.x, u.y - post.y) < 0.1, 'from his post');
});

test('a fort at rest fights as one: a raider at the front man is taken on by the men behind him too', () => {
  const { game, men } = heldFort('fort_legion', 8);
  const front = men.reduce((a, b) => (b.y > a.y ? b : a));
  const rear = men.reduce((a, b) => (b.y < a.y ? b : a));
  const x = front.x;
  const y = front.y + 1.5;
  assert.ok(Math.hypot(rear.x - x, rear.y - y) > 2.5, 'the rear man\'s own post is out of reach');
  const foe = spawnUnit(game, 'raider', x, y, { invasion: 1 });
  foe.hp = 1e6;
  let rearEngaged = false;
  for (let t = 0; t < 60 && !rearEngaged; t++) {
    foe.x = x;
    foe.y = y;
    updateMilitary(game);
    rearEngaged = rear.target === foe.id;
  }
  assert.ok(rearEngaged, 'the rear man comes up to fight');
});

test('a man at rest answers a slinger striking at him, and lets him go when he stops', () => {
  const { game, men: [u], post } = heldFort('fort_legion');
  const foe = spawnUnit(game, 'slinger', post.x, post.y + 4.5, { invasion: 1 });
  foe.hp = 1e6;
  let answered = false;
  for (let t = 0; t < 120 && !answered; t++) {
    foe.x = post.x;
    foe.y = post.y + 4.5;
    updateMilitary(game);
    answered = u.target === foe.id && foe.target === u.id;
  }
  assert.ok(answered, 'he goes for the slinger shooting at him');
  // Out of his sling's range (still watching him): no longer striking at him, so he is let go.
  pinned(game, u, foe, post.x, post.y + 8, 300, post);
  assert.equal(u.target, 0);
  assert.ok(Math.hypot(u.x - post.x, u.y - post.y) < 0.2, 'back at his post');
});

test('a deployed fort still goes out: its men chase a raider 10 tiles from the standard, not one 20 off', () => {
  const { game, fort, men: [u], post } = heldFort('fort_legion');
  const rx = Math.floor(post.x);
  const ry = Math.floor(post.y) + 2;
  assert.ok(deployFort(game, fort.id, rx, ry));
  for (let t = 0; t < 2000 && u.state !== 'idle'; t++) updateMilitary(game);
  const rally = { x: rx + 0.5, y: ry + 0.5 };
  assert.ok(Math.hypot(u.x - rally.x, u.y - rally.y) < 1, 'at the rally point');
  const foe = spawnUnit(game, 'raider', rally.x + 20, rally.y, { invasion: 1 });
  const idle = pinned(game, u, foe, rally.x + 20, rally.y, 60, rally);
  assert.ok(idle < 0.5, 'one 20 tiles off is left alone');
  const far = pinned(game, u, foe, rally.x + 10, rally.y, 200, rally);
  assert.ok(far > 4, `he went out after the one 10 tiles off (${far.toFixed(1)} tiles)`);
});

// ---------------------------------------------------------------------------
// Towers, walls and gates
// ---------------------------------------------------------------------------

test('watchtowers shoot raiders in range', () => {
  const game = newGame();
  const spot = findFree(game, 12, 3);
  const tower = addBuilding(game, 'tower', spot.x, spot.y);
  tower.efficiency = 1;
  const raider = spawnUnit(game, 'raider', spot.x + 6.5, spot.y + 1.5, { invasion: 0 });
  const far = spawnUnit(game, 'raider', spot.x + 11.5, spot.y + 30.5, { invasion: 0 });
  let shots = 0;
  for (let t = 0; t < 80; t++) {
    const before = game.projectiles.length;
    updateMilitary(game);
    if (game.projectiles.length > before) shots++;
    // keep the test raider in place (without an active raid he would run away)
    if (game.units.has(raider.id)) { raider.x = spot.x + 6.5; raider.y = spot.y + 1.5; }
  }
  assert.ok(shots >= 2, `tower fired (${shots})`);
  assert.ok(!game.units.has(raider.id) || raider.hp < raider.maxHp, 'raider hit');
  assert.ok(!game.units.has(far.id) || far.hp === far.maxHp, 'raider out of range untouched');
});

test('walls: a gate where the wall crosses a road; roads cut gates; clear and undo work', () => {
  const game = newGame();
  const spot = findFree(game, 9, 9);
  const { map } = game;
  const midY = spot.y + 4;
  assert.ok(build(game, 'road', spot.x, midY, spot.x + 8, midY).ok, 'road built');
  const plan = planAction(game, 'wall', spot.x + 4, spot.y, spot.x + 4, spot.y + 8);
  assert.equal(plan.count, 9);
  assert.equal(plan.items.filter((i) => i.gate).length, 1, 'one gate on the road');
  assert.equal(plan.cost, 8 * 12 + 40);
  const t0 = game.city.treasury;
  assert.ok(applyPlan(game, plan).ok);
  assert.equal(game.city.treasury, t0 - (8 * 12 + 40));
  assert.equal(map.wall[map.idx(spot.x + 4, midY)], Wall.GATE, 'gate on the road');
  assert.ok(map.road[map.idx(spot.x + 4, midY)], 'road kept under the gate');
  assert.equal(map.wall[map.idx(spot.x + 4, spot.y)], Wall.WALL);
  // Buildings cannot go on walls.
  assert.equal(planAction(game, 'well', spot.x + 4, spot.y, spot.x + 4, spot.y).count, 0);
  // A new road through the wall cuts a gate, and undo puts the wall back.
  const roadPlan = planAction(game, 'road', spot.x + 2, spot.y + 1, spot.x + 6, spot.y + 1);
  assert.ok(roadPlan.items.some((i) => i.gate), 'road plan shows a gate');
  assert.ok(applyPlan(game, roadPlan).ok);
  assert.equal(map.wall[map.idx(spot.x + 4, spot.y + 1)], Wall.GATE);
  assert.ok(undoLast(game).ok);
  assert.equal(map.wall[map.idx(spot.x + 4, spot.y + 1)], Wall.WALL, 'undo restored the wall');
  assert.equal(map.road[map.idx(spot.x + 4, spot.y + 1)], 0);
  // Clearing a gate removes the gate but keeps the road.
  assert.ok(build(game, 'clear', spot.x + 4, midY).ok);
  assert.equal(map.wall[map.idx(spot.x + 4, midY)], Wall.NONE);
  assert.ok(map.road[map.idx(spot.x + 4, midY)]);
});

test('raiders break through a wall that blocks the only way in', () => {
  const game = newGame();
  const spot = findFree(game, 7, 7);
  const { map } = game;
  // A house with a wall ring around it; a raider outside.
  const house = addBuilding(game, 'house', spot.x + 3, spot.y + 3);
  house.house.tier = 3;
  house.house.pop = 5;
  for (let d = 0; d <= 4; d++) {
    for (const [x, y] of [[spot.x + 1 + d, spot.y + 1], [spot.x + 1 + d, spot.y + 5], [spot.x + 1, spot.y + 1 + d], [spot.x + 5, spot.y + 1 + d]]) {
      map.wall[map.idx(x, y)] = Wall.WALL;
    }
  }
  map.touch();
  const inv = launchInvasion(game, { x: spot.x + 3, y: spot.y + 6 }, 1);
  const raider = [...game.units.values()].find((u) => u.invasion === inv.id);
  raider.x = spot.x + 3.5;
  raider.y = spot.y + 6.5;
  let wallBroken = false;
  for (let t = 0; t < 20 * 60 && !wallBroken; t++) {
    updateMilitary(game);
    for (let d = 0; d <= 4 && !wallBroken; d++) {
      if (!map.wall[map.idx(spot.x + 1 + d, spot.y + 5)]) wallBroken = true;
    }
  }
  assert.ok(wallBroken, 'the raider broke a wall tile');
  assert.equal(raider.state === 'siege' || raider.state === 'advance', true, `raider pushing on (${raider.state})`);
});

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

test('military state survives save and load', () => {
  const { game, center } = grownCity();
  const gar = buildDemoGarrison(game, center, { stock: true });
  game.runDays(40);
  const fort = gar.forts[0];
  deployFort(game, fort.id, fort.x + 2, fort.y + 6);
  launchInvasion(game, null, 4);
  game.runDays(2);
  const wallTile = [...Array(game.map.size).keys()].find((i) => game.map.wall[i]);
  if (wallTile !== undefined) game.wallHp.set(wallTile, 100);
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  assert.equal(data.version, CONFIG.SAVE_VERSION);
  const copy = deserializeGame(data);
  assert.equal(copy.units.size, game.units.size, 'units kept');
  assert.deepEqual(unitCounts(copy), unitCounts(game));
  assert.deepEqual(copy.buildings.get(fort.id).rally, fort.rally, 'rally point kept');
  assert.equal(copy.military.active?.id, game.military.active?.id, 'raid in progress kept');
  assert.deepEqual(Array.from(copy.map.wall), Array.from(game.map.wall), 'walls kept');
  if (wallTile !== undefined) assert.equal(copy.wallHp.get(wallTile), 100, 'wall damage kept');
  assert.ok(copy.nextUnitId > Math.max(...copy.units.keys()));
  copy.runDays(10); // keeps running
});

test('a save without military state gets a fresh one', () => {
  const game = newGame();
  buildDemoCity(game, { level: 1 });
  game.runDays(20);
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  delete data.units;
  delete data.military;
  delete data.wallHp;
  delete data.map.wall;
  delete data.nextIds.unit;
  const copy = deserializeGame(data);
  assert.equal(copy.units.size, 0);
  assert.ok(copy.military && copy.military.stats, 'fresh military state');
  assert.equal(copy.map.wall.every((v) => v === 0), true);
  copy.runDays(5);
});

test('a province with frequent raids runs for two years without errors', () => {
  const game = newGame({ invasions: 'frequent', seed: 'raid-soak' });
  // This soaks raids for errors, not their timing: bring the first one forward
  // (frequent raids come after 3 years) so two years hold a few of them.
  game.military.nextRaidMonth = 12;
  const res = buildDemoCity(game, { level: 2 });
  assert.ok(res.ok, res.reason);
  game.runDays(16 * 4);
  buildDemoGarrison(game, res.center, { stock: true });
  const errors = [];
  const origError = log.error;
  log.error = (...a) => errors.push(a.map(String).join(' '));
  try {
    game.runDays(16 * 24);
  } finally {
    log.error = origError;
  }
  assert.deepEqual(errors, [], 'no errors logged');
  assert.ok(game.military.stats.raids >= 1, `raids happened (${game.military.stats.raids})`);
});

test('raiders in the province: no victory until they are gone, and peace falls that month instead of growing', async () => {
  // A playtest won mission 3 with raiders on the map, its peace still rising.
  const { checkOutcome, updateRatings, enemiesInProvince } = await import('../src/sim/ratings.js');
  const game = newGame({ size: 64, seed: 'raid-victory' });
  game.scenario.goals = { population: 1 };
  game.city.population = 10;
  const spot = findFree(game, 4, 4);
  const raider = spawnUnit(game, 'raider', spot.x + 1.5, spot.y + 1.5, { invasion: 0 });
  assert.equal(enemiesInProvince(game), true);
  checkOutcome(game);
  assert.equal(game.city.victory, false, 'held while a raider is in the province');
  assert.equal(game.messages.filter((m) => /Rome will not proclaim your victory/.test(m.text)).length, 1);
  checkOutcome(game);
  assert.equal(game.messages.filter((m) => /Rome will not proclaim your victory/.test(m.text)).length, 1, 'said once');
  // Peace: a month with the raider about loses 2, even in a happy city.
  game.city.sentiment = 80;
  game.city.ratings.peace = 30;
  game.runDays(1);
  assert.equal(game.city.raidMonth, true, 'the day marks the month');
  updateRatings(game);
  assert.equal(game.city.ratings.peace, 30 - CONFIG.PEACE_RAID_MONTH);
  // He is gone: the next month's check proclaims the victory.
  game.units.delete(raider.id);
  assert.equal(enemiesInProvince(game), false);
  game.city.population = 10; // (the day's census counted no homes)
  checkOutcome(game);
  assert.equal(game.city.victory, true);
  assert.equal(game.city.victoryHeld, undefined);
});

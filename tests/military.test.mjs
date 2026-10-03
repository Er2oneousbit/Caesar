/**
 * military.test.mjs - headless tests for the military layer (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Covers the troop supply chains (weapons, Fletcher arrows from timber+iron,
 * horse breeding), recruiting, raids against defended and undefended cities,
 * a fort at rest holding its ground and a deployed one going out, a fort's
 * men resting in its yard (in and out by its gate, called out to stand to,
 * never stranded, out of raiders' and thieves' reach), watchtowers,
 * walls and gates, and saving/loading the military state.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { Terrain, Wall } from '../src/world/map.js';
import { addBuilding, removeBuilding, inOwnFort } from '../src/sim/entities.js';
import { updateWorkshop, updateProducer } from '../src/sim/production.js';
import { planAction, applyPlan, undoLast } from '../src/sim/construction.js';
import { launchInvasion, spawnUnit, updateMilitary, deployFort, recallFort, militaryMonthly, garrisonCounts, fortPost, fillField, fortGate, yardSpot } from '../src/sim/military.js';
import { MinHeap } from '../src/world/pathfinding.js';
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
 * A fort of `type` on open plains with `n` soldiers standing at their posts
 * in its ranks, nothing else near, and a raid under way (so raiders fight
 * rather than flee). At rest the men are in the yard; a raider of the raid
 * pinned at the far corner of the map (`pin`, see pinned) has them stand to
 * on the fort's ground, where they fight from.
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
  assert.ok(men.every((u) => u.state === 'idle' && inOwnFort(game, u)), 'at rest in the yard');
  game.military.active = { id: 1, origin: { x: 0, y: 0 }, size: 1, killed: 0, buildingsLost: 0, startDay: 0, fleeing: false, reached: false };
  const far = { x: fort.x < game.map.w / 2 ? game.map.w - 2.5 : 2.5, y: fort.y < game.map.h / 2 ? game.map.h - 2.5 : 2.5 };
  const sentinel = spawnUnit(game, 'raider', far.x, far.y, { invasion: 1, pin: far });
  sentinel.hp = 1e9;
  for (let t = 0; t < 2000 && !men.every((u) => u.state === 'idle' && !inOwnFort(game, u)); t++) tick(game);
  assert.ok(men.every((u) => u.state === 'idle' && !inOwnFort(game, u)), 'stood to at their posts');
  return { game, fort, men, post: { x: men[0].x, y: men[0].y } };
}

/** One tick, units with a `pin` held there first. */
function tick(game) {
  for (const v of game.units.values()) if (v.pin) { v.x = v.pin.x; v.y = v.pin.y; }
  updateMilitary(game);
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
    tick(game);
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
    tick(game);
    if (game.projectiles.length > before) shots++;
  }
  assert.ok(shots >= 2, `in range: he shoots (${shots})`);
  assert.ok(Math.hypot(u.x - post.x, u.y - post.y) < 0.1, 'from his post');
  // The raider steps just out of range: he is let go, not followed.
  foe.hp = 1e6;
  const far2 = pinned(game, u, foe, post.x, post.y + 7, 60, post);
  assert.ok(far2 < 0.1, `no step after him (${far2.toFixed(2)})`);
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
    tick(game);
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
    tick(game);
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
  for (let t = 0; t < 2000 && u.state !== 'idle'; t++) tick(game);
  const rally = { x: rx + 0.5, y: ry + 0.5 };
  assert.ok(Math.hypot(u.x - rally.x, u.y - rally.y) < 1, 'at the rally point');
  const foe = spawnUnit(game, 'raider', rally.x + 20, rally.y, { invasion: 1 });
  const idle = pinned(game, u, foe, rally.x + 20, rally.y, 60, rally);
  assert.ok(idle < 0.5, 'one 20 tiles off is left alone');
  const far = pinned(game, u, foe, rally.x + 10, rally.y, 200, rally);
  assert.ok(far > 4, `he went out after the one 10 tiles off (${far.toFixed(1)} tiles)`);
});

// ---------------------------------------------------------------------------
// The fort's yard: men at rest inside the walls
// ---------------------------------------------------------------------------

/** A fort of `type` turned `turn` on open plains, `n` men put down at `at` (default: its post) marching home. */
function restingFort(type = 'fort_legion', n = FORT_CAPACITY, turn = 0, at = null) {
  const game = newGame({ type: 'plains' });
  const spot = clearedLand(game, 22, 16);
  assert.ok(spot, 'open land');
  const fort = addBuilding(game, type, spot.x + 8, spot.y + 2, undefined, { turn });
  fort.efficiency = 1;
  const from = at || fortPost(game, fort);
  const men = [];
  for (let slot = 0; slot < n; slot++) men.push(spawnUnit(game, fort.def.unit, from.x, from.y, { fort: fort.id, slot, state: 'march' }));
  return { game, fort, men };
}

/**
 * Tick until every man is idle (or `ticks` run out), keeping each man's
 * tiles in order: no man may stand on any building but his own fort, and
 * he goes in and out of it only between its door tile and the gate tile.
 */
function walkLog(game, fort, men, ticks = 3000, until = () => men.every((u) => u.state === 'idle')) {
  const map = game.map;
  const bad = [];
  const last = new Map(men.map((u) => [u.id, map.idx(Math.floor(u.x), Math.floor(u.y))]));
  let t = 0;
  for (; t < ticks && !until(); t++) {
    tick(game);
    for (const u of men) {
      if (!game.units.has(u.id)) continue;
      const i = map.idx(Math.floor(u.x), Math.floor(u.y));
      const was = last.get(u.id);
      if (i === was) continue;
      const b = map.building[i];
      if (b && b !== fort.id) bad.push(`man ${u.slot} on building ${b}`);
      const inNow = b === fort.id;
      const inThen = map.building[was] === fort.id;
      if (inNow !== inThen) {
        const gate = fortGate(game, fort);
        const door = map.idx(Math.floor(gate.door.x), Math.floor(gate.door.y));
        const out = map.idx(Math.floor(gate.out.x), Math.floor(gate.out.y));
        if (!((i === door && was === out) || (i === out && was === door))) bad.push(`man ${u.slot} crossed the wall from ${map.xOf(was)},${map.yOf(was)} to ${map.xOf(i)},${map.yOf(i)}`);
      }
      last.set(u.id, i);
    }
  }
  return { bad, ticks: t };
}

test('a fort at rest keeps its men in its yard, each on his spot, in by the gate, at every turn of the fort', () => {
  // Playtest: trained troops stood about outside their fort's walls.
  for (const type of ['fort_legion', 'fort_archer', 'fort_cavalry']) {
    for (const turn of [0, 1, 2, 3]) {
      const { game, fort, men } = restingFort(type, FORT_CAPACITY, turn);
      const say = `${type} turned ${turn}`;
      const { bad } = walkLog(game, fort, men);
      assert.deepEqual(bad, [], say);
      assert.ok(men.every((u) => u.state === 'idle'), `${say}: all at rest`);
      for (const u of men) {
        const s = yardSpot(fort, u.slot);
        assert.ok(inOwnFort(game, u), `${say}: man ${u.slot} is inside the walls`);
        assert.ok(Math.hypot(u.x - s.x, u.y - s.y) < 0.06, `${say}: man ${u.slot} on his spot`);
        // Clear of the walls (0.22 thick with the towers) on every side.
        const [a, b] = [u.x - fort.x, u.y - fort.y];
        assert.ok(Math.min(a, b, 3 - a, 3 - b) > 0.5, `${say}: man ${u.slot} well inside (${a.toFixed(2)}, ${b.toFixed(2)})`);
      }
      const spots = men.map((u) => yardSpot(fort, u.slot));
      for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) assert.ok(Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y) > 0.3, `${say}: spots ${i} and ${j} apart`);
      // The gate is the art's gateway, in the middle of the turned front wall.
      const gate = fortGate(game, fort);
      const mid = { x: fort.x + 1.5, y: fort.y + 1.5 };
      assert.equal(Math.hypot(gate.door.x - mid.x, gate.door.y - mid.y), 1, `${say}: the door is the middle tile of a side`);
      const side = [[0, 1], [-1, 0], [0, -1], [1, 0]][turn];
      assert.deepEqual([gate.out.x - mid.x, gate.out.y - mid.y], [side[0] * 2, side[1] * 2], `${say}: the gate faces the art's front`);
    }
  }
});

test('raiders call a resting fort\'s men out to its ground in front, where they always stood; with the raid over they go back in', () => {
  const { game, fort, men } = restingFort('fort_legion', 4);
  walkLog(game, fort, men);
  assert.ok(men.every((u) => inOwnFort(game, u)), 'at rest inside');
  game.military.active = { id: 1, origin: { x: 0, y: 0 }, size: 1, killed: 0, buildingsLost: 0, startDay: 0, fleeing: false, reached: false };
  const far = { x: fort.x < game.map.w / 2 ? game.map.w - 2.5 : 2.5, y: 2.5 };
  const raider = spawnUnit(game, 'raider', far.x, far.y, { invasion: 1, pin: far });
  raider.hp = 1e9;
  // The first tick: nobody picks a man inside the walls, near or far.
  const near = spawnUnit(game, 'raider', fort.x + 1.5, fort.y - 0.5, { invasion: 1, pin: { x: fort.x + 1.5, y: fort.y - 0.5 } });
  near.hp = 1e9;
  tick(game);
  assert.equal(near.target, 0, 'a raider by the wall does not go for the men inside');
  game.units.delete(near.id);
  const out = walkLog(game, fort, men, 3000, () => men.every((u) => u.state === 'idle' && !inOwnFort(game, u)));
  assert.deepEqual(out.bad, []);
  assert.ok(out.ticks < 200, `out within 10 days (${out.ticks} ticks)`);
  // Each on his old spot in the ranks (formationSpots: the open tiles nearest the post).
  const post = fortPost(game, fort);
  for (const u of men) assert.ok(Math.hypot(u.x - post.x, u.y - post.y) < 3, `man ${u.slot} by the post`);
  // The raid ends: back in.
  game.units.delete(raider.id);
  game.military.active = null;
  const back = walkLog(game, fort, men, 3000, () => men.every((u) => u.state === 'idle' && inOwnFort(game, u)));
  assert.deepEqual(back.bad, []);
  assert.ok(men.every((u) => inOwnFort(game, u)), 'back in the yard');
});

test('a wolf near the fort calls its men out, and they go back in only once it is well off', () => {
  const { game, fort, men } = restingFort('fort_archer', 2);
  walkLog(game, fort, men);
  const post = fortPost(game, fort);
  const at = (d) => ({ x: post.x, y: post.y + (post.y < game.map.h / 2 ? d : -d) });
  game.wildlife = null; // (a lone wolf with no pack: it stays where it is put)
  const wolf = spawnUnit(game, 'wolf', at(24).x, at(24).y, { pin: at(24) });
  for (let t = 0; t < 100; t++) tick(game);
  assert.ok(men.every((u) => inOwnFort(game, u)), 'a wolf 24 tiles off: they rest');
  wolf.pin = at(8);
  walkLog(game, fort, men, 400, () => men.every((u) => !inOwnFort(game, u)));
  assert.ok(men.every((u) => !inOwnFort(game, u)), 'a wolf 8 tiles off: they stand to');
  // It roams about the line: no going in and out by turns.
  wolf.pin = at(14);
  for (let t = 0; t < 200; t++) tick(game);
  assert.ok(men.every((u) => !inOwnFort(game, u)), 'a wolf 14 tiles off: still out');
  wolf.pin = at(20);
  walkLog(game, fort, men, 600, () => men.every((u) => inOwnFort(game, u) && u.state === 'idle'));
  assert.ok(men.every((u) => inOwnFort(game, u)), 'a wolf 20 tiles off: back in');
});

test('deployed, a fort\'s men leave by the gate and march out; recalled, they come back in by it', () => {
  const { game, fort, men } = restingFort('fort_cavalry', 3, 2);
  walkLog(game, fort, men);
  const rally = findFree(game, 1, 1, { x: fort.x + 9, y: fort.y + 1 });
  assert.ok(deployFort(game, fort.id, rally.x, rally.y));
  const out = walkLog(game, fort, men, 3000, () => men.every((u) => u.state === 'idle'));
  assert.deepEqual(out.bad, []);
  assert.ok(men.every((u) => Math.hypot(u.x - rally.x - 0.5, u.y - rally.y - 0.5) < 3), 'at the rally point');
  assert.ok(recallFort(game, fort.id));
  const back = walkLog(game, fort, men);
  assert.deepEqual(back.bad, []);
  assert.ok(men.every((u) => inOwnFort(game, u) && u.state === 'idle'), 'home in the yard');
});

test('a man inside never strands: the gate built over, the men use the post; every side shut, they stay in', () => {
  const { game, fort, men } = restingFort('fort_legion', 2);
  walkLog(game, fort, men);
  const gate = fortGate(game, fort);
  // A building on the gate tile: the next way in is the post.
  addBuilding(game, 'well', Math.floor(gate.out.x), Math.floor(gate.out.y));
  const alt = fortGate(game, fort);
  assert.ok(alt && (alt.out.x !== gate.out.x || alt.out.y !== gate.out.y), 'another way out');
  const post = fortPost(game, fort);
  assert.deepEqual([alt.out.x, alt.out.y], [Math.floor(post.x) + 0.5, Math.floor(post.y) + 0.5], 'by the post');
  const rally = findFree(game, 1, 1, { x: fort.x + 9, y: fort.y + 1 });
  deployFort(game, fort.id, rally.x, rally.y);
  const out = walkLog(game, fort, men);
  assert.deepEqual(out.bad, []);
  assert.ok(men.every((u) => !inOwnFort(game, u)), 'out by the post');
  recallFort(game, fort.id);
  walkLog(game, fort, men);
  assert.ok(men.every((u) => inOwnFort(game, u)), 'and back in');
  // Every tile round the fort built over or walled: no way out, and no harm.
  const map = game.map;
  for (let y = fort.y - 1; y <= fort.y + 3; y++) for (let x = fort.x - 1; x <= fort.x + 3; x++) {
    if (map.building[map.idx(x, y)]) continue;
    map.wall[map.idx(x, y)] = Wall.WALL;
  }
  map.touch();
  assert.equal(fortGate(game, fort), null, 'shut in');
  deployFort(game, fort.id, rally.x, rally.y);
  for (let t = 0; t < 300; t++) tick(game);
  assert.ok(men.every((u) => inOwnFort(game, u) && game.units.has(u.id)), 'they stay in their yard');
  assert.ok(men.every((u) => Number.isFinite(u.x) && Number.isFinite(u.y)));
});

test('a gateway opening into a walled pocket is no gate: the men go out by the post, and get to their rally point', () => {
  const { game, fort, men } = restingFort('fort_legion', 4);
  walkLog(game, fort, men);
  const gate = fortGate(game, fort);
  const ox = Math.floor(gate.out.x);
  const oy = Math.floor(gate.out.y);
  // Wall in the tile before the gateway on its three outer sides.
  const map = game.map;
  for (const [x, y] of [[ox - 1, oy], [ox + 1, oy], [ox, oy + 1]]) map.wall[map.idx(x, y)] = Wall.WALL;
  map.touch();
  const alt = fortGate(game, fort);
  assert.ok(alt && (alt.out.x !== gate.out.x || alt.out.y !== gate.out.y), 'the pocket is not the gate');
  const rally = findFree(game, 1, 1, { x: fort.x + 10, y: fort.y + 1 });
  assert.ok(deployFort(game, fort.id, rally.x, rally.y));
  const out = walkLog(game, fort, men);
  assert.deepEqual(out.bad, []);
  assert.ok(men.every((u) => Math.hypot(u.x - rally.x - 0.5, u.y - rally.y - 0.5) < 3), 'at the rally point');
});

test('nobody fights from the yard: an archer with a foe in range goes out first, and shoots only from outside', () => {
  const { game, fort, men } = restingFort('fort_archer', 4);
  walkLog(game, fort, men);
  game.wildlife = null; // (a lone wolf with no pack: it stays where it is put)
  // 4.5 tiles behind the back wall, in an archer's range of the yard.
  const at = { x: fort.x + 1.5, y: fort.y - 4.5 };
  const wolf = spawnUnit(game, 'wolf', at.x, at.y, { pin: at });
  wolf.hp = 1e9;
  let fromYard = 0;
  let shots = 0;
  for (let t = 0; t < 600; t++) {
    const before = new Map(men.map((u) => [u.id, u.strikeTick || 0]));
    tick(game);
    for (const u of men) {
      if ((u.strikeTick || 0) === before.get(u.id)) continue;
      shots++;
      if (inOwnFort(game, u)) fromYard++;
    }
  }
  assert.equal(fromYard, 0, `never from inside the walls (${shots} shots in all)`);
  // Out on their posts, as before: there it is out of range (it is behind the fort), so they hold.
  assert.ok(men.every((u) => !inOwnFort(game, u) && u.state === 'idle'), 'stood to on their posts');
});

test('men standing to or standing down halfway turn at once, not walking out the old route', () => {
  // The fort turned 2 has its gate at the back, away from its post: the way between goes round it.
  const { game, fort, men } = restingFort('fort_legion', 1, 2);
  walkLog(game, fort, men);
  const [u] = men;
  game.military.active = { id: 1, origin: { x: 0, y: 0 }, size: 1, killed: 0, buildingsLost: 0, startDay: 0, fleeing: false, reached: false };
  const far = { x: fort.x < game.map.w / 2 ? game.map.w - 2.5 : 2.5, y: 2.5 };
  const raider = spawnUnit(game, 'raider', far.x, far.y, { invasion: 1, pin: far });
  raider.hp = 1e9;
  const gate = fortGate(game, fort);
  // Out and on his way round to the ranks.
  for (let t = 0; t < 400 && !(!inOwnFort(game, u) && Math.hypot(u.x - gate.out.x, u.y - gate.out.y) > 1.5); t++) tick(game);
  assert.ok(!inOwnFort(game, u) && u.state === 'march', 'on his way');
  // The raid is over: he heads back to the gate at once.
  game.units.delete(raider.id);
  game.military.active = null;
  const d0 = Math.hypot(u.x - gate.out.x, u.y - gate.out.y);
  let worst = 0;
  for (let t = 0; t < 40; t++) { tick(game); worst = Math.max(worst, Math.hypot(u.x - gate.out.x, u.y - gate.out.y) - d0); }
  assert.ok(worst < 0.3, `no farther from the gate (${worst.toFixed(2)} tiles more)`);
});

test('a soldier standing outside in an older save walks into his fort\'s yard', () => {
  const { game, fort, men } = restingFort('fort_legion', 3);
  // Put down where an older version stood them: on their spots in the ranks.
  const post = fortPost(game, fort);
  men.forEach((u, k) => { u.x = post.x + (k % 2) * 0.5; u.y = post.y + 0.2 * k; u.state = 'idle'; });
  const copy = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  const moved = [...copy.units.values()].filter((u) => u.fort === fort.id);
  const f2 = copy.buildings.get(fort.id);
  const { bad } = walkLog(copy, f2, moved, 3000, () => moved.every((u) => u.state === 'idle' && inOwnFort(copy, u)));
  assert.deepEqual(bad, []);
  assert.ok(moved.every((u) => inOwnFort(copy, u) && u.state === 'idle'), 'in the yard');
});

test('a man leaving for a distant battle goes out by the gate', () => {
  const { game, fort, men } = restingFort('fort_legion', 1);
  walkLog(game, fort, men);
  const [u] = men;
  u.away = true;
  u.awayTick = game.time.totalTicks;
  const gate = fortGate(game, fort);
  let left = null;
  for (let t = 0; t < 200 && !left; t++) {
    tick(game);
    if (!inOwnFort(game, u)) left = { x: Math.floor(u.x), y: Math.floor(u.y) };
  }
  assert.deepEqual(left, { x: Math.floor(gate.out.x), y: Math.floor(gate.out.y) }, 'first step outside on the gate tile');
});

test('a thief passing the fort is not caught by the men resting behind its walls; a man outside catches him', async () => {
  const { updateCriminals } = await import('../src/sim/crime.js');
  const { spawnWalker } = await import('../src/sim/entities.js');
  const { game, fort, men } = restingFort('fort_legion', 1);
  walkLog(game, fort, men);
  const [u] = men;
  // A thief on the tile just outside the wall nearest the man, within a tile of him.
  const tx = Math.floor(u.x);
  const ty = fort.y - 1;
  const fresh = () => spawnWalker(game, 'thief', game.map.idx(tx, ty), null, { state: 'steal', hp: CONFIG.CRIMINAL_HP });
  u.y = fort.y + 0.6; // (by the back wall, a tile from the street)
  assert.ok(inOwnFort(game, u));
  const thief = fresh();
  updateCriminals(game);
  assert.equal(thief.hp, CONFIG.CRIMINAL_HP, 'nobody behind the wall lays a hand on him');
  // The same man standing in the street does.
  u.y = fort.y - 0.5;
  u.x = tx + 1.5;
  updateCriminals(game);
  assert.ok(thief.hp < CONFIG.CRIMINAL_HP || thief.dead, 'a man outside catches him');
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

test('a deployed soldier crosses a river by its bridge to reach a raider on the far bank, not straight at the water', async () => {
  // Playtest: soldiers walked straight at raiders across a river.
  const { straightClear } = await import('../src/sim/military.js');
  const { game, fort, men } = heldFort('fort_legion', 1);
  const { map } = game;
  const soldier = men[0];
  // A river two tiles wide, east of the fort, with one bridge 6 tiles south.
  const rx = Math.floor(soldier.x) + 4;
  const by = Math.floor(soldier.y) + 6;
  for (let y = 1; y < map.h - 1; y++) {
    for (const x of [rx, rx + 1]) {
      const i = map.idx(x, y);
      if (map.building[i]) continue;
      map.terrain[i] = Terrain.WATER;
      map.road[i] = y === by ? 3 : 0; // Road.BRIDGE on the crossing row
    }
  }
  assert.ok(deployFort(game, fort.id, Math.floor(soldier.x) + 2, Math.floor(soldier.y)), 'deployed toward the river');
  const raider = spawnUnit(game, 'raider', rx + 3.5, soldier.y, { invasion: 1 });
  raider.state = 'camp';
  assert.equal(straightClear(game, soldier, raider.x, raider.y), false, 'the river is in the way');
  let crossed = false;
  let atBank = 0;
  for (let t = 0; t < 2400 && game.units.has(raider.id) && !crossed; t++) {
    raider.x = rx + 3.5; raider.y = soldier.y; // he stays put on the far bank
    tick(game);
    if (Math.floor(soldier.x) > rx + 1) crossed = true;
    if (Math.abs(soldier.x - (rx - 0.5)) < 0.6 && Math.abs(Math.floor(soldier.y) - by) > 1) atBank++;
  }
  assert.ok(crossed || !game.units.has(raider.id), 'he got across');
  assert.ok(atBank < 20, `he did not stand on the bank facing the water (${atBank} ticks)`);
});

test('the raiders\' field crosses a big forest in one pass, each tile pushed a few times, not once per equal path', () => {
  // The field holds 32-bit floats and a forest tile costs 1.6, which they
  // hold only roughly. Compared unrounded, a tile's new cost kept beating its
  // own stored value, and each of the many equal paths across a forest
  // pushed it again: the woods of a step-10 map grew the search's heap past
  // the memory there was when Caesar's legions set out (Narbo Martius).
  const game = newGame();
  const { map } = game;
  for (let i = 0; i < map.size; i++) if (map.terrain[i] !== Terrain.WATER && !map.road[i]) map.terrain[i] = Terrain.TREES;
  const b = addBuilding(game, 'prefecture', 20, 20);
  const field = new Float32Array(map.size);
  let pushes = 0;
  const push = MinHeap.prototype.push;
  MinHeap.prototype.push = function (key, val) {
    if (++pushes > map.size * 8) throw new Error(`${pushes} pushes on a ${map.w} map`);
    return push.call(this, key, val);
  };
  try {
    fillField(game, field, (id) => id === b.id);
  } finally {
    MinHeap.prototype.push = push;
  }
  assert.ok(pushes <= map.size * 8, `${pushes} pushes`);
  // And the costs are still the walk: ten forest tiles west of the building, 16.
  assert.ok(Math.abs(field[map.idx(b.x - 10, b.y)] - 16) < 0.001, `${field[map.idx(b.x - 10, b.y)]}`);
});

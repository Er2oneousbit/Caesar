/**
 * wildlife.test.mjs - wolf packs (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Covers sim/wildlife.js: which maps have packs (missions of the north and
 * the hills, a sandbox that asks, never the desert), dens deep in the woods
 * far from the entry, drawn without touching the game's own random stream;
 * a pack hunting a walker who comes near, its bites by difficulty; a pack
 * that has fed resting; a pack growing back while one wolf lives, and gone
 * once the last is killed; soldiers and prefects killing wolves, and wolves
 * biting back; packs moving on, away from the city; wolves being no enemy
 * in the province; and packs kept by a save, none in an older one.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { Game } from '../src/core/game.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { findScenario, sandboxScenario, withDifficulty } from '../src/data/scenarios.js';
import { WOLF } from '../src/data/wildlife.js';
import { DIFFICULTY } from '../src/data/difficulty.js';
import { UNIT_TYPES } from '../src/data/units.js';
import { spawnWalker, addBuilding } from '../src/sim/entities.js';
import { spawnUnit, updateMilitary, removeUnit, fortPost, deployFort } from '../src/sim/military.js';
import { wolvesWanted, wildlifeDaily, wolfCounts, addPackAt, packOf, openGround, emptyWildlife } from '../src/sim/wildlife.js';
import { WALKER_HP } from '../src/sim/walkerHarm.js';
import { updatePrefectFights } from '../src/sim/prefectFight.js';
import { enemiesInProvince } from '../src/sim/ratings.js';
import { Terrain } from '../src/world/map.js';
import { newGame } from './helpers.mjs';

log.setLevel('error');

const wolvesOf = (game, pack) => [...game.units.values()].filter((u) => u.type === 'wolf' && (!pack || u.pack === pack.id));

/** Open grass with the trees cleared from a w x h box; its corner. */
function openBox(game, w, h) {
  const { map } = game;
  for (let y = 4; y < map.h - h - 4; y++) {
    for (let x = 4; x < map.w - w - 4; x++) {
      let ok = true;
      for (let dy = 0; dy < h && ok; dy++) for (let dx = 0; dx < w && ok; dx++) {
        const i = map.idx(x + dx, y + dy);
        if (map.terrain[i] === Terrain.WATER || map.terrain[i] === Terrain.ROCK || map.road[i] || map.fixedRoad[i] || map.building[i]) ok = false;
      }
      if (!ok) continue;
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (map.terrain[map.idx(x + dx, y + dy)] === Terrain.TREES) map.terrain[map.idx(x + dx, y + dy)] = Terrain.GRASS;
      map.touch();
      return { x, y };
    }
  }
  return null;
}

/** A pack set down on open plains, the game ticking units as core/game.js does. */
function packOnPlains(difficulty = 'normal') {
  const game = newGame({ type: 'plains', size: 128, difficulty });
  const at = openBox(game, 26, 26);
  assert.ok(at, 'open land');
  const pack = addPackAt(game, at.x + 13, at.y + 13);
  assert.ok(pack);
  return { game, at, pack };
}

function tick(game, n = 1) {
  for (let k = 0; k < n; k++) { game.time.totalTicks++; updateMilitary(game); }
}

test('wolves: on the missions of the north and the hills, never the first two or the desert; a sandbox only when asked', () => {
  for (const id of ['c3m', 'c4', 'c8m', 'c8p', 'c10m']) assert.equal(wolvesWanted(findScenario(id)), true, id);
  for (const id of ['c1', 'c2', 'c6', 'c7', 'c10p']) assert.equal(wolvesWanted(findScenario(id)), false, id);
  assert.equal(wolvesWanted(sandboxScenario()), false, 'sandbox: off by default');
  assert.equal(wolvesWanted({ ...sandboxScenario(), wolves: true }), true);
  assert.equal(wolvesWanted({ ...sandboxScenario({ type: 'desert' }), wolves: true }), false, 'never in the desert');
  assert.equal(wolvesWanted(sandboxScenario(), 'on'), true, 'the flag');
  assert.equal(wolvesWanted(findScenario('c8m'), 'off'), false);
  assert.equal(newGame().wildlife.packs.length, 0);
  assert.equal(wolvesOf(newGame()).length, 0);
});

test('wolves: a mission\'s packs: 1 to 4 by its land, 6 to 8 wolves each, dens deep in a wood far from the entry; the game\'s own draws untouched', () => {
  const scenario = withDifficulty(findScenario('c8m'), 'normal');
  const game = new Game({ scenario, flags: { unlockall: true } });
  const bare = new Game({ scenario, flags: { unlockall: true, wolves: 'off' } });
  const { map } = game;
  const packs = game.wildlife.packs;
  assert.ok(packs.length >= 1 && packs.length <= WOLF.maxPacks, `${packs.length} packs`);
  const counts = wolfCounts(game);
  for (const p of packs) {
    assert.ok(p.size >= WOLF.packMin && p.size <= WOLF.packMax);
    assert.equal(counts.get(p.id), p.size, 'every wolf on the map');
    assert.equal(map.terrain[map.idx(p.den.x, p.den.y)], Terrain.TREES, 'the den is in the trees');
    assert.ok(Math.hypot(p.den.x - map.entry.x, p.den.y - map.entry.y) >= WOLF.denFromEntry, 'far from the entry');
    for (const q of packs) if (q !== p) assert.ok(Math.hypot(p.den.x - q.den.x, p.den.y - q.den.y) >= WOLF.denApart);
  }
  for (const u of wolvesOf(game)) assert.equal(u.side, 'wild');
  // Drawn on a stream of their own: the game's stream is where it would be without them.
  assert.deepEqual(game.rng.getState(), bare.rng.getState());
  // And the same seed places the same dens.
  const again = new Game({ scenario, flags: { unlockall: true } });
  assert.deepEqual(again.wildlife.packs.map((p) => p.den), packs.map((p) => p.den));
});

/** A cart pusher standing on a road tile `d` tiles east of the pack's spot. */
function walkerBy(game, pack, d) {
  const x = pack.spot.x + d;
  const y = pack.spot.y;
  game.map.road[game.map.idx(x, y)] = 1;
  return spawnWalker(game, 'cart', game.map.idx(x, y), null, {});
}

test('wolves: a walker who comes near sets the pack on; he dies in 5 bites on Easy, 4 on Normal, 3 on Hard and Insane', () => {
  for (const [level, bites] of [['easy', 5], ['normal', 4], ['hard', 3], ['insane', 3]]) {
    assert.equal(Math.ceil(WALKER_HP / DIFFICULTY[level].wolfBite), bites, level);
    const { game, pack } = packOnPlains(level);
    const w = walkerBy(game, pack, 2);
    const seen = [];
    for (let t = 0; t < 400 && !w.dead; t++) {
      tick(game);
      if (w.hp !== undefined && seen[seen.length - 1] !== w.hp) seen.push(w.hp);
    }
    assert.ok(w.dead, `${level}: killed`);
    // Every bite is the level's: the hp he passed through after each, then dead.
    assert.equal(seen.length, bites - 1, `${level}: ${bites} bites (hp ${seen.join(', ')})`);
    assert.equal(game.wildlife.stats.walkersKilled, 1);
    assert.match(game.messages[0].text, /^Wolves killed a cart pusher near/);
  }
});

test('wolves: a walker far off is left alone; a pack that has fed rests before it hunts again', () => {
  const { game, pack } = packOnPlains();
  const far = walkerBy(game, pack, 12);
  tick(game, 200);
  assert.equal(far.hp, undefined, 'never bitten');
  assert.equal(pack.hunting, false);
  const near = walkerBy(game, pack, 2);
  for (let t = 0; t < 400 && !near.dead; t++) tick(game);
  assert.ok(near.dead);
  assert.equal(pack.hunting, false, 'fed: the hunt is over');
  const next = walkerBy(game, pack, 2);
  tick(game, 30);
  assert.equal(next.hp, undefined, 'a second walker is let be while the pack eats');
});

test('wolves: a pack grows back one wolf every 16 days while one lives, and is gone once the last is killed', () => {
  const { game, pack } = packOnPlains();
  const wolves = wolvesOf(game, pack);
  for (const u of wolves.slice(2)) removeUnit(game, u, 'died');
  assert.equal(game.wildlife.stats.wolvesKilled, pack.size - 2);
  const day0 = game.time.totalDays;
  const daily = (days) => { for (let d = 0; d < days; d++) { game.time.totalDays++; wildlifeDaily(game); } };
  daily(1);
  assert.equal(wolfCounts(game).get(pack.id), 2);
  daily(WOLF.refillDays);
  assert.equal(wolfCounts(game).get(pack.id), 3, `one back by day ${game.time.totalDays - day0}`);
  daily(WOLF.refillDays * 10);
  assert.equal(wolfCounts(game).get(pack.id), pack.size, 'back to its size, no more');
  // Kill them all: the pack is gone for good.
  for (const u of wolvesOf(game, pack)) removeUnit(game, u, 'died');
  daily(1);
  assert.equal(packOf(game, pack.id), null);
  assert.equal(game.wildlife.stats.packsCleared, 1);
  assert.match(game.messages[0].text, /wolf pack .* is no more/);
  daily(WOLF.refillDays * 2);
  assert.equal(wolvesOf(game).length, 0, 'none grow back');
});

test('wolves: a deployed legionary kills wolves, and a wolf he strikes bites back', () => {
  const { game, at, pack } = packOnPlains();
  const fort = addBuilding(game, 'fort_legion', at.x + 2, at.y + 2);
  fort.efficiency = 1;
  const post = fortPost(game, fort);
  const men = [0, 1, 2, 3].map((slot) => spawnUnit(game, 'legionary', post.x, post.y, { fort: fort.id, slot, state: 'march' }));
  deployFort(game, fort.id, pack.spot.x, pack.spot.y);
  const start = wolvesOf(game, pack).length;
  let bitten = false;
  for (let t = 0; t < 3000 && wolvesOf(game, pack).length > 0; t++) {
    tick(game);
    if (men.some((m) => m.hp < m.maxHp)) bitten = true;
  }
  assert.equal(wolvesOf(game, pack).length, 0, `the soldiers killed all ${start}`);
  assert.ok(bitten, 'the wolves bit back');
  assert.equal(game.wildlife.stats.wolvesKilled, start);
  assert.equal(game.military.stats.soldiersLost <= 1, true);
});

test('wolves: a prefect on his rounds fights a wolf in reach, and the wolf turns on him rather than on the walkers', () => {
  const { game, pack } = packOnPlains();
  const wolf = wolvesOf(game, pack)[0];
  const x = Math.floor(wolf.x) + 1;
  const y = Math.floor(wolf.y);
  game.map.road[game.map.idx(x, y)] = 1;
  const p = spawnWalker(game, 'prefect', game.map.idx(x, y), null, { state: 'roam' });
  for (let t = 0; t < 5; t++) { tick(game); updatePrefectFights(game); }
  const foe = game.units.get(p.fight);
  assert.ok(foe && foe.type === 'wolf', 'he fights a wolf');
  assert.ok(foe.hp < foe.maxHp || p.fightCd > 0, 'his blow');
  for (let t = 0; t < 40 && !(p.hp < CONFIG.PREFECT_COMBAT.hp); t++) { tick(game); updatePrefectFights(game); }
  assert.ok(p.dead || p.hp < CONFIG.PREFECT_COMBAT.hp, 'the wolf bites him back');
});

test('wolves: a pack moves on every few days, keeps to its ground, and leaves ground the city has built on', () => {
  const { game, at, pack } = packOnPlains();
  const spots = new Set();
  for (let d = 0; d < 60; d++) { game.time.totalDays++; wildlifeDaily(game); spots.add(`${pack.spot.x},${pack.spot.y}`); }
  assert.ok(spots.size > 3, `it moved (${spots.size} spots)`);
  for (const s of spots) {
    const [x, y] = s.split(',').map(Number);
    assert.ok(Math.hypot(x - pack.den.x, y - pack.den.y) <= WOLF.roamLeash, 'never far from its den');
  }
  // A building put up right by its spot: it moves on the next day.
  const here = { ...pack.spot };
  pack.nextMoveDay = game.time.totalDays + 99;
  addBuilding(game, 'house', here.x + 2, here.y, 1);
  assert.equal(openGround(game.map, here.x, here.y), false);
  game.time.totalDays++;
  wildlifeDaily(game);
  assert.ok(pack.spot.x !== here.x || pack.spot.y !== here.y, 'moved away from the house');
  assert.equal(openGround(game.map, pack.spot.x, pack.spot.y), true);
  assert.ok(at);
});

test('wolves: they are no enemy in the province (no victory or peace held up), and break no buildings', () => {
  const { game, pack } = packOnPlains();
  assert.equal(enemiesInProvince(game), false);
  const house = addBuilding(game, 'house', pack.spot.x + 1, pack.spot.y + 1, 1);
  tick(game, 300);
  assert.equal(house.hp, undefined, 'untouched');
  assert.equal(UNIT_TYPES.wolf.siege, undefined);
});

test('wolves: a save keeps the packs and their wolves; a save from before wolves has none, never new ones', () => {
  const scenario = withDifficulty(findScenario('c8m'), 'normal');
  const game = new Game({ scenario, flags: { unlockall: true } });
  game.runDays(3);
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  const back = deserializeGame(data);
  assert.deepEqual(back.wildlife.packs.map((p) => p.id), game.wildlife.packs.map((p) => p.id));
  assert.equal(wolvesOf(back).length, wolvesOf(game).length);
  back.runDays(2); // (and plays on)
  const old = JSON.parse(JSON.stringify(serializeGame(game)));
  delete old.wildlife;
  old.units = old.units.filter((u) => u.type !== 'wolf');
  const up = deserializeGame(old);
  assert.deepEqual(up.wildlife, emptyWildlife());
  assert.equal(wolvesOf(up).length, 0);
  assert.ok(CONFIG.SAVE_VERSION >= 22);
});

/**
 * hostile.test.mjs - one rule for who Rome fights (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Covers sim/military.js hostileToRome: soldiers, watchtowers and prefects
 * fight raiders, Caesar's men and wild animals (side 'wild'), and villagers
 * of a native village (side 'native') only while their village attacks; a
 * hostile that is no raider dying is no soldier lost.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { addBuilding, spawnWalker } from '../src/sim/entities.js';
import { spawnUnit, updateMilitary, fortPost, hostileToRome, removeUnit } from '../src/sim/military.js';
import { updatePrefectFights } from '../src/sim/prefectFight.js';
import { startRoaming } from '../src/sim/movement.js';
import { Terrain } from '../src/world/map.js';
import { newGame, build, findFree } from './helpers.mjs';

log.setLevel('error');

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

/** A legionary at rest at his fort's post, on open land. */
function heldLegionary() {
  const game = newGame({ type: 'plains' });
  const spot = clearedLand(game, 22, 16);
  const fort = addBuilding(game, 'fort_legion', spot.x + 8, spot.y + 2);
  fort.efficiency = 1;
  const post = fortPost(game, fort);
  const u = spawnUnit(game, 'legionary', post.x, post.y, { fort: fort.id, slot: 0, state: 'march' });
  for (let t = 0; t < 2000 && u.state !== 'idle'; t++) updateMilitary(game);
  assert.equal(u.state, 'idle', 'at his post');
  return { game, u, post: { x: u.x, y: u.y } };
}

/**
 * A stand-in foe of the given side: a raider's body (any land unit type
 * will do: the side is what the rule reads), held in place by the test.
 */
function foeOf(game, side, x, y, init = {}) {
  const foe = spawnUnit(game, 'raider', x, y, init);
  foe.side = side;
  foe.hp = foe.maxHp = 1e6; // (lives through every blow, so the test sees them all)
  return foe;
}

/** Tick `n` times with the foe pinned at (x, y); was it struck? */
function struck(game, foe, x, y, n) {
  for (let t = 0; t < n; t++) {
    foe.x = x;
    foe.y = y;
    updateMilitary(game);
  }
  return foe.hp < foe.maxHp || game.projectiles.some((p) => p.target === foe.id);
}

test('hostileToRome: enemies and wild animals always, villagers only while attacking, Rome never', () => {
  assert.equal(hostileToRome({ side: 'enemy' }), true);
  assert.equal(hostileToRome({ side: 'wild' }), true);
  assert.equal(hostileToRome({ side: 'native' }), false);
  assert.equal(hostileToRome({ side: 'native', attacking: true }), true);
  assert.equal(hostileToRome({ side: 'rome' }), false);
});

test('a soldier at rest takes on a wild animal at his post, and a villager only while his village attacks', () => {
  for (const [side, init, fought] of [['wild', {}, true], ['native', {}, false], ['native', { attacking: true }, true]]) {
    const { game, u, post } = heldLegionary();
    const foe = foeOf(game, side, post.x, post.y + 1.8, init);
    const hit = struck(game, foe, post.x, post.y + 1.8, 80);
    const say = `${side}${init.attacking ? ' attacking' : ''}`;
    assert.equal(hit, fought, `${say}: ${fought ? 'fought' : 'left alone'}`);
    if (!fought) assert.equal(u.target, 0, `${say}: no target`);
  }
});

test('a watchtower shoots a wild animal in range, never a villager at peace', () => {
  for (const [side, init, shot] of [['wild', {}, true], ['native', {}, false]]) {
    const game = newGame();
    const spot = findFree(game, 12, 3);
    const tower = addBuilding(game, 'tower', spot.x, spot.y);
    tower.efficiency = 1;
    const foe = foeOf(game, side, spot.x + 6.5, spot.y + 1.5, init);
    assert.equal(struck(game, foe, spot.x + 6.5, spot.y + 1.5, 80), shot, `${side}: ${shot ? 'shot' : 'left alone'}`);
  }
});

test('a prefect on his rounds fights a wild animal in reach, and leaves a villager at peace alone', () => {
  for (const [side, init, fights] of [['wild', {}, true], ['native', {}, false], ['native', { attacking: true }, true]]) {
    const game = newGame({ size: 96, type: 'plains', seed: 'prefect-save' });
    const spot = findFree(game, 26, 9);
    const y = spot.y + 4;
    assert.ok(build(game, 'road', spot.x + 1, y, spot.x + 24, y).ok, 'road built');
    const p = spawnWalker(game, 'prefect', game.map.idx(spot.x + 9, y), null, {});
    startRoaming(game, p, 0);
    p.roamLeft = 400;
    const foe = foeOf(game, side, p.x + 2, p.y + 1, init);
    updatePrefectFights(game);
    assert.equal(p.fight === foe.id, fights, `${side}${init.attacking ? ' attacking' : ''}`);
    if (fights) assert.ok(foe.hp < foe.maxHp, 'his first blow lands');
  }
});

test('a wild animal killed is no soldier lost and no raider slain', () => {
  const game = newGame();
  const foe = foeOf(game, 'wild', 10.5, 10.5);
  const st = game.military.stats;
  removeUnit(game, foe, 'died');
  assert.equal(st.soldiersLost, 0);
  assert.equal(st.enemiesKilled, 0);
});

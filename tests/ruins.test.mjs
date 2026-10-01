/**
 * ruins.test.mjs - rubble that remembers what fell (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Covers sim/ruins.js: every way a building leaves rubble records what stood
 * there, why it fell and when; the record spans the whole footprint, goes
 * tile by tile as rubble is cleared or built over (and comes back on undo),
 * survives a save as one entry per fallen building, and an older save loads
 * with rubble that has no record (the panel's old wording).
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { Terrain, Wall } from '../src/world/map.js';
import { addBuilding, footprintTiles } from '../src/sim/entities.js';
import { igniteBuilding, collapseBuilding } from '../src/sim/risk.js';
import { launchInvasion, updateMilitary } from '../src/sim/military.js';
import { ruinAt, serializeRuins, RUIN_CAUSES } from '../src/sim/ruins.js';
import { undoLast } from '../src/sim/construction.js';
import { HOUSE_TIERS } from '../src/data/housing.js';
import { ruinText } from '../src/ui/infoPanel.js';
import { newGame, build, findFree } from './helpers.mjs';

log.setLevel('error');

/**
 * A building of `type` on free land with no rubble (no road needed: it is
 * about to fall), so it never lands on the ruins of the last one.
 */
function placed(game, type, size = 1) {
  const { map } = game;
  for (let y = 2; y < map.h - size - 4; y++) {
    for (let x = 2; x < map.w - size - 4; x++) {
      let ok = true;
      for (let dy = 0; dy < size + 2 && ok; dy++) {
        for (let dx = 0; dx < size + 2 && ok; dx++) {
          const i = map.idx(x + dx, y + dy);
          ok = map.isFree(x + dx, y + dy) && map.terrain[i] !== Terrain.TREES && !map.rubble[i];
        }
      }
      if (ok) return addBuilding(game, type, x + 1, y + 1);
    }
  }
  throw new Error('no room');
}

test('ruins: every way a building falls is remembered, with the date', () => {
  const cases = [
    ['fire', (g, b) => igniteBuilding(g, b), 'burned down'],
    ['lightning', (g, b) => igniteBuilding(g, b, 'lightning'), 'struck by lightning'],
    ['raidFire', (g, b) => igniteBuilding(g, b, 'raid'), 'burned by raiders'],
    ['raidFire', (g, b) => igniteBuilding(g, b, 'raidQuiet'), 'burned by raiders'],
    ['riot', (g, b) => igniteBuilding(g, b, 'riot'), 'burned by rioters'],
    ['riot', (g, b) => igniteBuilding(g, b, 'riotQuiet'), 'burned by rioters'],
    ['collapse', (g, b) => collapseBuilding(g, b), 'collapsed'],
    ['raid', (g, b) => collapseBuilding(g, b, 'raid'), 'torn down by raiders'],
    ['raid', (g, b) => collapseBuilding(g, b, 'raidQuiet'), 'torn down by raiders'],
  ];
  for (const [cause, fell, words] of cases) {
    const game = newGame();
    game.runDays(CONFIG.DAYS_PER_MONTH * 6 + 3); // Iulius 300 BC
    const b = placed(game, 'prefecture');
    const i = game.map.idx(b.x, b.y);
    fell(game, b);
    assert.equal(game.map.rubble[i], 1);
    assert.deepEqual(ruinAt(game, i), { what: 'Prefecture', cause, month: 6, year: -300 }, cause);
    assert.equal(ruinText(ruinAt(game, i)), `Ruins of a Prefecture, ${words} in Iul 300 BC.`);
  }
  assert.ok(RUIN_CAUSES.includes('raidWall'));
});

test('ruins: a home is remembered by its level, and "an" before a vowel', () => {
  const game = newGame();
  const home = placed(game, 'house');
  home.house.tier = 4;
  home.house.pop = 5;
  const i = game.map.idx(home.x, home.y);
  igniteBuilding(game, home);
  assert.equal(ruinAt(game, i).what, HOUSE_TIERS[4].name);
  const post = placed(game, 'engineer_post');
  const j = game.map.idx(post.x, post.y);
  collapseBuilding(game, post);
  assert.equal(ruinText(ruinAt(game, j)), "Ruins of an Engineer's Post, collapsed in Ian 300 BC.");
});

test('ruins: raiders breaking a wall leave rubble that says so', () => {
  const game = newGame();
  const spot = findFree(game, 7, 7);
  const { map } = game;
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
  let broken = -1;
  for (let t = 0; t < 20 * 60 && broken < 0; t++) {
    updateMilitary(game);
    for (let d = 0; d <= 4 && broken < 0; d++) {
      const i = map.idx(spot.x + 1 + d, spot.y + 5);
      if (!map.wall[i]) broken = i;
    }
  }
  assert.ok(broken >= 0, 'the raider broke a wall tile');
  assert.equal(map.rubble[broken], 1);
  assert.equal(ruinAt(game, broken).cause, 'raidWall');
  assert.match(ruinText(ruinAt(game, broken)), /^Ruins of a Wall, broken down by raiders in /);
});

test('ruins: one record spans the footprint; clearing and building over take it tile by tile, undo gives it back', () => {
  const game = newGame();
  const b = placed(game, 'granary', 3);
  assert.equal(b.size, 3);
  const tiles = footprintTiles(game.map, b.x, b.y, 3);
  collapseBuilding(game, b);
  const rec = ruinAt(game, tiles[0]);
  for (const i of tiles) assert.equal(ruinAt(game, i), rec, 'the same record on every tile');
  assert.equal(serializeRuins(game).length, 1, 'one entry in the save');
  assert.equal(serializeRuins(game)[0].tiles.length, 9);

  // The clear tool takes one tile's rubble and its record.
  const [cx, cy] = [game.map.xOf(tiles[0]), game.map.yOf(tiles[0])];
  assert.ok(build(game, 'clear', cx, cy).ok);
  assert.equal(game.map.rubble[tiles[0]], 0);
  assert.equal(ruinAt(game, tiles[0]), null);
  assert.equal(game.ruins.has(tiles[0]), false);
  assert.equal(ruinAt(game, tiles[1]), rec, 'the rest still remember');

  // A home built on another tile clears it too.
  const [hx, hy] = [game.map.xOf(tiles[4]), game.map.yOf(tiles[4])];
  assert.ok(build(game, 'house', hx, hy).ok);
  assert.equal(game.ruins.has(tiles[4]), false);

  // A road over the rubble, then undone: the rubble and its record come back.
  const [rx, ry] = [game.map.xOf(tiles[8]), game.map.yOf(tiles[8])];
  assert.ok(build(game, 'road', rx, ry).ok);
  assert.equal(game.ruins.has(tiles[8]), false);
  assert.ok(undoLast(game).ok);
  assert.equal(game.map.rubble[tiles[8]], 1);
  assert.equal(ruinAt(game, tiles[8]), rec);
  assert.equal(serializeRuins(game)[0].tiles.length, 7);
});

test('ruins: a save keeps them, one entry per fallen building', () => {
  const game = newGame();
  const a = placed(game, 'granary', 3);
  igniteBuilding(game, a);
  game.fires.clear();
  game.runDays(CONFIG.DAYS_PER_MONTH);
  const b = placed(game, 'prefecture');
  collapseBuilding(game, b);
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  assert.equal(data.version, CONFIG.SAVE_VERSION);
  assert.equal(CONFIG.SAVE_VERSION, 7);
  assert.equal(data.ruins.length, 2);
  const copy = deserializeGame(data);
  const ai = copy.map.idx(a.x, a.y);
  const bi = copy.map.idx(b.x, b.y);
  assert.deepEqual(ruinAt(copy, ai), ruinAt(game, ai));
  assert.deepEqual(ruinAt(copy, bi), ruinAt(game, bi));
  assert.equal(ruinAt(copy, ai), ruinAt(copy, copy.map.idx(a.x + 2, a.y + 2)), 'still one record per footprint');
  // Nonsense entries (a hand-edited file) are skipped, never trusted.
  data.ruins.push({ what: 'X', cause: 'aliens', month: 1, year: 1, tiles: [ai] }, { what: 'Y', cause: 'fire', month: 1, year: -1, tiles: [-5, 1e9, 'a'] }, null);
  const copy2 = deserializeGame(data);
  assert.equal(ruinAt(copy2, ai).what, 'Granary');
});

test('ruins: a version 6 save loads; its rubble has no record and keeps the old words', () => {
  const game = newGame();
  const b = placed(game, 'prefecture');
  igniteBuilding(game, b);
  const i = game.map.idx(b.x, b.y);
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  data.version = 6;
  delete data.ruins;
  for (const raw of data.buildings) { delete raw.noRoadDays; delete raw.noRoadWarned; }
  const copy = deserializeGame(data);
  assert.equal(copy.map.rubble[i], 1, 'the rubble is still there');
  assert.equal(ruinAt(copy, i), null);
  assert.equal(ruinText(ruinAt(copy, i)), null, 'the panel falls back to "Rubble from a disaster."');
  assert.equal(copy.ruins.size, 0);
  // It plays on: new ruins are recorded as usual.
  const c = placed(copy, 'prefecture');
  collapseBuilding(copy, c);
  assert.equal(ruinAt(copy, copy.map.idx(c.x, c.y)).cause, 'collapse');
});

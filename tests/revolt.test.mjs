/**
 * revolt.test.mjs - the gladiator revolt (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Covers sim/revolt.js: no working gladiator school, no revolt (and no
 * word); with one, gladiators on their way to a venue and the entertainers
 * of venues showing gladiators turn into rebels, and new ones as they set
 * out; rebels go for buildings, hold up peace, and prefects fight them; at
 * the end month they flee and are gone; a save keeps it all.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { UNIT_TYPES } from '../src/data/units.js';
import { addBuilding, spawnWalker } from '../src/sim/entities.js';
import { updateMilitary, militaryDaily, militaryMonthly, threatSummary } from '../src/sim/military.js';
import { startRevolt, revoltActive, REVOLT_MONTHS } from '../src/sim/revolt.js';
import { enemiesInProvince } from '../src/sim/ratings.js';
import { updatePrefectFights } from '../src/sim/prefectFight.js';
import { newGame, findFree } from './helpers.mjs';

log.setLevel('error');

/** A gladiator school and an amphitheater; the school at work unless `idle`. */
function games(idle = false) {
  const game = newGame({ type: 'plains', size: 96 });
  const a = findFree(game, 4, 4);
  const school = addBuilding(game, 'gladiator_school', a.x, a.y);
  const b = findFree(game, 4, 4, { x: a.x + 10, y: a.y });
  const venue = addBuilding(game, 'amphitheater', b.x, b.y);
  school.efficiency = idle ? 0 : 1;
  school.accessRoad = game.map.idx(a.x, a.y + 3); // (a road at its door, as far as the revolt cares)
  return { game, school, venue };
}

const rebels = (game) => [...game.units.values()].filter((u) => u.revolt);

test('revolt: with no working gladiator school it is called off, without a word', () => {
  const { game } = games(true);
  const before = game.messages.length;
  assert.equal(startRevolt(game), false);
  assert.equal(game.military.revolt ?? null, null);
  assert.equal(game.messages.length, before);
});

test('revolt: gladiators on the way to a show and the entertainers of a gladiator show turn on the city, and new ones as they set out', () => {
  const { game, school, venue } = games();
  const perf = spawnWalker(game, 'performer', game.map.idx(school.x, school.y + 3), school, { venue: 'amphitheater', target: venue.id, state: 'toVenue' });
  const actor = spawnWalker(game, 'performer', game.map.idx(school.x + 1, school.y + 3), null, { venue: 'theater', target: venue.id, state: 'toVenue' });
  venue.shows.amphitheater = 20;
  const crier = spawnWalker(game, 'entertainer', game.map.idx(venue.x, venue.y + 3), venue, { state: 'roam' });
  assert.equal(startRevolt(game), true);
  assert.match(game.messages[0].text, /gladiators have revolted/);
  assert.ok(revoltActive(game));
  assert.ok(perf.dead && crier.dead, 'both turned');
  assert.ok(!actor.dead, 'an actor does not');
  assert.equal(rebels(game).length, 2);
  for (const u of rebels(game)) { assert.equal(u.type, 'gladiator'); assert.equal(u.side, 'enemy'); }
  // A new gladiator setting out the next day turns too.
  spawnWalker(game, 'performer', game.map.idx(school.x, school.y + 3), school, { venue: 'amphitheater', target: venue.id, state: 'toVenue' });
  militaryDaily(game);
  assert.equal(rebels(game).length, 3);
  assert.equal(game.military.revolt.turned, 3);
  // In the province they hold up peace and show in the threat.
  assert.equal(enemiesInProvince(game), true);
  assert.match(threatSummary(game).text, /3 gladiators in revolt/);
  // A second revolt cannot start while one is on.
  assert.equal(startRevolt(game), false);
});

test('revolt: rebels break buildings; at the end month they flee and are gone', () => {
  const { game, school, venue } = games();
  spawnWalker(game, 'performer', game.map.idx(school.x, school.y + 3), school, { venue: 'amphitheater', target: venue.id, state: 'toVenue' });
  startRevolt(game);
  const [u] = rebels(game);
  let broke = false;
  for (let t = 0; t < 4000 && !broke; t++) {
    game.time.totalTicks++;
    updateMilitary(game);
    broke = [...game.buildings.values()].some((b) => b.hp !== undefined);
  }
  assert.ok(broke, 'he struck a building');
  // Not over before its end month...
  game.time.totalMonths = game.military.revolt.endMonth - 1;
  militaryMonthly(game);
  assert.ok(revoltActive(game));
  game.time.totalMonths++;
  militaryMonthly(game);
  assert.equal(revoltActive(game), false);
  assert.match(game.messages[0].text, /revolt is over/);
  for (let t = 0; t < 6000 && game.units.has(u.id); t++) { game.time.totalTicks++; updateMilitary(game); }
  assert.ok(!game.units.has(u.id), 'he fled the map');
  militaryMonthly(game);
  assert.equal(game.military.revolt, null, 'all gone');
  assert.ok(REVOLT_MONTHS === 3);
  assert.equal(UNIT_TYPES.gladiator.hp, 75);
});

test('revolt: a prefect on his rounds fights a rebel in reach, and lets one fleeing after the revolt go', () => {
  const { game, school, venue } = games();
  const perf = spawnWalker(game, 'performer', game.map.idx(school.x, school.y + 3), school, { venue: 'amphitheater', target: venue.id, state: 'toVenue' });
  const x = perf.x;
  const y = perf.y;
  startRevolt(game);
  const [u] = rebels(game);
  game.map.road[game.map.idx(x + 1, y)] = 1;
  const p = spawnWalker(game, 'prefect', game.map.idx(x + 1, y), null, { state: 'roam' });
  updatePrefectFights(game);
  assert.equal(p.fight, u.id, 'he takes on the rebel');
  game.military.revolt.over = true;
  updatePrefectFights(game);
  assert.equal(p.fight || 0, 0, 'a rebel in flight is let go');
});

test('revolt: what rebels wreck is theirs, not a raid\'s: its ruins and messages say so, and the revolt counts it', () => {
  const { game, school, venue } = games();
  spawnWalker(game, 'performer', game.map.idx(school.x, school.y + 3), school, { venue: 'amphitheater', target: venue.id, state: 'toVenue' });
  startRevolt(game);
  const before = game.buildings.size;
  for (let t = 0; t < 20000 && game.buildings.size === before; t++) { game.time.totalTicks++; updateMilitary(game); }
  assert.ok(game.buildings.size < before, 'a building fell');
  assert.equal(game.military.stats.buildingsLost, 0, 'no raid lost it');
  assert.equal(game.military.revolt.buildingsLost, 1);
  const causes = [...game.ruins.values()].map((r) => r.cause);
  assert.ok(causes.length && causes.every((c) => c === 'revolt' || c === 'revoltFire'), causes.join());
  assert.match(game.messages[0].text, /^Rebel gladiators have (set|torn down)/);
});

test('revolt: a save keeps the revolt and its rebels', () => {
  const { game, school, venue } = games();
  spawnWalker(game, 'performer', game.map.idx(school.x, school.y + 3), school, { venue: 'amphitheater', target: venue.id, state: 'toVenue' });
  startRevolt(game);
  const back = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  assert.ok(revoltActive(back));
  assert.equal(back.military.revolt.endMonth, game.military.revolt.endMonth);
  assert.equal(rebels(back).length, 1);
});

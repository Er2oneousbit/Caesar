/**
 * cycle.test.mjs - going from building to building (ui/cycle.js): what
 * counts as idle (the info panel's red and amber status, but not
 * understaffing alone), the previous / next order within a kind (by id,
 * wrapping), "next idle" within a kind, and the tour of every idle
 * building, kind by kind. Homes and a hippodrome's side sections are never
 * stops. The panel buttons and the I key are checked in the smoke test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { addBuilding } from '../src/sim/entities.js';
import { buildingStatus } from '../src/ui/infoPanel.js';
import { isIdle, cyclable, buildingsOfKind, stepOfKind, stepIdle, idleBuildings, kindPosition, nextIdleFrom } from '../src/ui/cycle.js';
import { newGame, findFree } from './helpers.mjs';

log.setLevel('error');

/** A workshop set to work (true) or to stand idle with no road (false); `half`: understaffed. */
function workshop(game, type, working, { half = false } = {}) {
  const s = findFree(game, 3, 3);
  const b = addBuilding(game, type, s.x, s.y);
  if (working) {
    b.accessRoad = 0; // (any road tile: the status only asks whether there is one)
    b.laborAccess = 1;
    b.efficiency = half ? 0.5 : 1;
    for (const [good, n] of Object.entries(b.def.recipe)) b.stock[good] = n;
    b.noStorage = false;
  }
  return b;
}

const ids = (list) => list.map((b) => b.id);

test('idle: no road or no workers (red) and waiting for goods (amber) are idle; understaffed alone is not', () => {
  const game = newGame({ seed: 'cycle-idle' });
  const noRoad = workshop(game, 'furniture_ws', false);
  const good = workshop(game, 'furniture_ws', true);
  const half = workshop(game, 'furniture_ws', true, { half: true });
  const starved = workshop(game, 'furniture_ws', true);
  starved.stock.timber = 0;
  const noStaff = workshop(game, 'furniture_ws', true);
  noStaff.efficiency = 0;
  assert.equal(buildingStatus(game, noRoad).level, 'bad');
  assert.equal(buildingStatus(game, half).level, 'warn', 'understaffed is amber...');
  assert.equal(buildingStatus(game, half).understaffed, true);
  assert.equal(buildingStatus(game, starved).level, 'warn');
  assert.deepEqual([noRoad, good, half, starved, noStaff].map((b) => isIdle(game, b)), [true, false, false, true, true], '...but it still works, so it is not idle');
});

test('homes and a hippodrome\'s side sections are not stops', () => {
  const game = newGame({ seed: 'cycle-homes' });
  const s = findFree(game, 1, 1);
  const home = addBuilding(game, 'house', s.x, s.y);
  assert.equal(cyclable(home), false);
  assert.equal(isIdle(game, home), false);
  const w = workshop(game, 'pottery_ws', false);
  assert.equal(cyclable(w), true);
  assert.equal(cyclable({ id: 9, main: 4 }), false, 'a section points to its main part');
  assert.equal(cyclable({ id: 4, main: 4 }), true, 'the main part itself');
  assert.equal(cyclable(null), false);
});

test('previous / next: every building of the kind by id, wrapping both ways; other kinds left out', () => {
  const game = newGame({ seed: 'cycle-kind' });
  const a = workshop(game, 'furniture_ws', true);
  const potter = workshop(game, 'pottery_ws', false);
  const b = workshop(game, 'furniture_ws', false);
  const c = workshop(game, 'furniture_ws', true);
  assert.deepEqual(ids(buildingsOfKind(game, 'furniture_ws')), [a.id, b.id, c.id]);
  assert.equal(stepOfKind(game, a, 1).id, b.id);
  assert.equal(stepOfKind(game, b, 1).id, c.id);
  assert.equal(stepOfKind(game, c, 1).id, a.id, 'after the last, the first');
  assert.equal(stepOfKind(game, a, -1).id, c.id, 'before the first, the last');
  assert.equal(stepOfKind(game, c, -1).id, b.id);
  assert.equal(stepOfKind(game, potter, 1).id, potter.id, 'the only one of its kind: itself');
  assert.deepEqual(kindPosition(game, b), { index: 2, count: 3, idle: 1, selfIdle: true });
  assert.deepEqual(kindPosition(game, c), { index: 3, count: 3, idle: 1, selfIdle: false });
});

test('next idle of a kind: only the idle ones, from any building of the kind; null when none is idle', () => {
  const game = newGame({ seed: 'cycle-kind-idle' });
  const w = [true, false, true, false, true].map((on) => workshop(game, 'furniture_ws', on));
  const [a, b, c, d, e] = w;
  assert.equal(stepOfKind(game, a, 1, true).id, b.id);
  assert.equal(stepOfKind(game, b, 1, true).id, d.id);
  assert.equal(stepOfKind(game, c, 1, true).id, d.id, 'from a working one: the next idle one');
  assert.equal(stepOfKind(game, d, 1, true).id, b.id, 'wrapping');
  assert.equal(stepOfKind(game, e, 1, true).id, b.id);
  assert.equal(stepOfKind(game, b, -1, true).id, d.id, 'back, wrapping');
  assert.equal(stepOfKind(game, c, -1, true).id, b.id);
  // Put both idle ones to work: none left.
  for (const x of [b, d]) Object.assign(x, { accessRoad: 0, laborAccess: 1, efficiency: 1, noStorage: false, stock: { ...x.stock, timber: 500 } });
  assert.equal(stepOfKind(game, a, 1, true), null);
  // A newly idle one is found at once (nothing is cached).
  c.efficiency = 0;
  assert.equal(stepOfKind(game, a, 1, true).id, c.id);
  assert.equal(stepOfKind(game, c, 1, true).id, c.id, 'the only idle one: itself');
});

test('the idle tour: every idle building, kind by kind in the data\'s order, then by id; from anywhere, wrapping', () => {
  const game = newGame({ seed: 'cycle-tour' });
  // Built mixed up: two carpenters, a potter, a carpenter, a potter.
  const f1 = workshop(game, 'furniture_ws', false);
  const p1 = workshop(game, 'pottery_ws', false);
  const ok = workshop(game, 'pottery_ws', true);
  const f2 = workshop(game, 'furniture_ws', false);
  const p2 = workshop(game, 'pottery_ws', false);
  // data/buildings.js lists the potter before the carpenter.
  assert.deepEqual(ids(idleBuildings(game)), [p1.id, p2.id, f1.id, f2.id]);
  assert.equal(stepIdle(game, null, 1).id, p1.id, 'from nothing: the first');
  assert.equal(stepIdle(game, null, -1).id, f2.id, 'or, going back, the last');
  assert.equal(stepIdle(game, p1, 1).id, p2.id, 'the same kind first');
  assert.equal(stepIdle(game, p2, 1).id, f1.id, 'then the next kind');
  assert.equal(stepIdle(game, f2, 1).id, p1.id, 'wrapping');
  assert.equal(stepIdle(game, f1, -1).id, p2.id);
  assert.equal(stepIdle(game, ok, 1).id, p2.id, 'from a working building: on from its place');
  const s = findFree(game, 1, 1);
  const home = addBuilding(game, 'house', s.x, s.y);
  assert.equal(stepIdle(game, home, 1).id, p1.id, 'from a home: from the start');
  // Nothing idle: null.
  for (const b of [f1, p1, f2, p2]) Object.assign(b, { accessRoad: 0, laborAccess: 1, efficiency: 1, noStorage: false, stock: { ...b.stock, clay: 500, timber: 500 } });
  assert.equal(stepIdle(game, null, 1), null);
});

test('the I key: on from the open panel, else from the one shown last; "the only one" only when its own panel is open', () => {
  const game = newGame({ seed: 'cycle-i-key' });
  const ok = workshop(game, 'pottery_ws', true);
  const x = workshop(game, 'pottery_ws', false);
  // One idle building, shown last; a walker's or a tile's panel open now (open = null).
  assert.deepEqual(nextIdleFrom(game, null, x, 1), { to: x, only: false }, 'goes back to it');
  assert.deepEqual(nextIdleFrom(game, null, null, 1), { to: x, only: false });
  assert.deepEqual(nextIdleFrom(game, x, x, 1), { to: x, only: true }, 'its own panel open: nowhere else to go');
  assert.deepEqual(nextIdleFrom(game, ok, x, 1), { to: x, only: false }, 'from a working one');
  const s = findFree(game, 1, 1);
  const home = addBuilding(game, 'house', s.x, s.y);
  assert.deepEqual(nextIdleFrom(game, home, x, 1), { to: x, only: false }, 'a home\'s panel counts as none');
  // A second idle one: on from the open panel, not from the one shown last.
  const y = workshop(game, 'pottery_ws', false);
  assert.equal(nextIdleFrom(game, x, y, 1).to.id, y.id);
  assert.equal(nextIdleFrom(game, y, y, 1).to.id, x.id);
  assert.equal(nextIdleFrom(game, null, null, 1).to.id, x.id, 'from nothing: the first');
});

test('cycling reads the city and changes nothing in it', () => {
  const game = newGame({ seed: 'cycle-pure' });
  for (const on of [true, false, false, true]) workshop(game, 'furniture_ws', on);
  const rng = JSON.stringify(game.rng.getState());
  const snap = JSON.stringify([...game.buildings.values()].map((b) => [b.id, b.efficiency, b.stock, b.accessRoad]));
  const first = [...game.buildings.values()][0];
  stepOfKind(game, first, 1);
  stepOfKind(game, first, -1, true);
  stepIdle(game, null, 1);
  kindPosition(game, first);
  assert.equal(JSON.stringify(game.rng.getState()), rng);
  assert.equal(JSON.stringify([...game.buildings.values()].map((b) => [b.id, b.efficiency, b.stock, b.accessRoad])), snap);
});

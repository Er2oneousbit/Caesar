/**
 * empire.test.mjs - headless tests for the empire map's travelers (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * The Empire screen draws caravans, ships and warbands from timers the sim
 * already keeps (a route's nextVisit day, the raid schedule and the scouts'
 * report). These tests check that game state turns into the right travelers:
 * who is on the way, how far along, how many days or months are left, where
 * on the map, the readout's words, what a click finds, and that reading the
 * state never changes it.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { TRADE_PARTNERS, HOME_POS } from '../src/data/scenarios.js';
import { openRoute } from '../src/sim/trade.js';
import { militaryMonthly } from '../src/sim/military.js';
import { addBuilding } from '../src/sim/entities.js';
import { serializeGame } from '../src/core/save.js';
import {
  empireTravelers, tripDays, routePoint, warbandPoint, travelerLabel, empireHitAt, isDrawn, ROME_POS, SCOUT_MONTHS,
} from '../src/ui/empireMap.js';
import { newGame, findFree } from './helpers.mjs';

log.setLevel('error');

const near = (a, b, eps = 1e-9) => Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;

/** A sandbox where ships can come (river maps reach the sea). */
function seaGame() {
  for (const seed of ['test-seed', 'a', 'b', 'c', 'd']) {
    const g = newGame({ type: 'river', seed });
    if (g.map.seaEntry) return g;
  }
  throw new Error('no river map with sea access');
}

test('empire: every trip fits between two visits, so a route has at most one traveler out', () => {
  for (const id of Object.keys(TRADE_PARTNERS)) {
    const d = tripDays(id);
    assert.ok(d >= 1 && d <= CONFIG.CARAVAN_INTERVAL_DAYS[0], `${id}: ${d} days`);
  }
  // Far partners take longer than near ones.
  assert.ok(tripDays('alexandria') > tripDays('capua'));
});

test('empire: a route curve runs from the partner (0) to the province (1)', () => {
  for (const id of Object.keys(TRADE_PARTNERS)) {
    assert.ok(near(routePoint(id, 0), TRADE_PARTNERS[id].pos), `${id} starts at the partner`);
    assert.ok(near(routePoint(id, 1), HOME_POS), `${id} ends at the province`);
  }
});

test('empire: closed routes send nobody; an opened land route sends a caravan that closes in day by day', () => {
  const game = newGame();
  assert.deepEqual(empireTravelers(game), [], 'no routes open, no raids: nobody on the way');
  assert.ok(openRoute(game, 'tarraco').ok);
  // Opening a route sends the first caravan in 8 days (sim/trade.js).
  let [c] = empireTravelers(game);
  const trip = tripDays('tarraco');
  assert.equal(c.kind, 'caravan');
  assert.equal(c.id, 'tarraco');
  assert.equal(c.days, 8);
  assert.equal(c.onWay, true);
  assert.equal(c.frac, 1 - 8 / trip);
  assert.ok(near(c.pos, routePoint('tarraco', c.frac)));
  assert.equal(travelerLabel(c), 'Tarraco caravan: 8 days');
  // Half a day later it is half a day further: it glides between days.
  game.time.tick = CONFIG.TICKS_PER_DAY / 2;
  [c] = empireTravelers(game);
  assert.equal(c.days, 8, 'whole days, rounded up');
  assert.ok(Math.abs(c.frac - (1 - 7.5 / trip)) < 1e-9, `frac ${c.frac}`);
  game.time.tick = 0;
  // Five days on (the sim run for real), three days are left.
  game.runDays(5);
  [c] = empireTravelers(game);
  assert.equal(c.days, 3);
  assert.equal(travelerLabel(c), 'Tarraco caravan: 3 days');
  // Once it has arrived, the next one is weeks away and not yet on the road.
  game.runDays(4);
  [c] = empireTravelers(game);
  const r = game.city.trade.routes.tarraco;
  assert.ok(r.nextVisit > game.time.totalDays, 'the sim set the next visit');
  assert.ok(c.days >= CONFIG.CARAVAN_INTERVAL_DAYS[0] - 1, `${c.days} days`);
  assert.equal(c.onWay, false);
  assert.equal(c.frac, 0);
  assert.equal(isDrawn(c), false, 'not drawn before it sets out');
  assert.match(travelerLabel(c), /^Tarraco caravan: \d+ days \(sets out in \d+ days?\)$/);
});

test('empire: ships only where ships can come; travelers are listed by arrival', () => {
  const game = seaGame();
  assert.ok(openRoute(game, 'massilia').ok);
  assert.ok(openRoute(game, 'capua').ok);
  game.city.trade.routes.capua.nextVisit = game.time.totalDays + 2;
  game.city.trade.routes.massilia.nextVisit = game.time.totalDays + 6;
  const list = empireTravelers(game);
  assert.deepEqual(list.map((t) => [t.kind, t.id, t.days]), [['caravan', 'capua', 2], ['ship', 'massilia', 6]]);
  assert.equal(travelerLabel(list[1]), 'Massilia ship: 6 days');
  // On a map without sea access a sea route never brings a ship (it cannot
  // even be opened there): nothing is drawn for it.
  const land = ['b', 'd', 'x1', 'x2', 'x3'].map((seed) => newGame({ type: 'plains', seed })).find((g) => !g.map.seaEntry);
  assert.ok(land, 'found a land-locked map');
  land.city.trade.routes.massilia.open = true;
  land.city.trade.routes.massilia.nextVisit = land.time.totalDays + 3;
  assert.deepEqual(empireTravelers(land), []);
});

test('empire: a scouted warband closes in from its side over the three months, then raids show at the city', () => {
  const game = newGame({ invasions: 'occasional' });
  const m = game.military;
  game.city.population = 600;
  game.time.totalMonths = m.nextRaidMonth - SCOUT_MONTHS;
  const spot = findFree(game, 1, 1);
  addBuilding(game, 'house', spot.x, spot.y);
  militaryMonthly(game);
  assert.ok(m.warned, 'scouts warned');
  let w = empireTravelers(game).find((t) => t.kind === 'warband');
  assert.ok(w, 'the warband is on the map');
  assert.equal(w.size, m.warned.size);
  assert.equal(w.dir, m.warned.dir);
  assert.deepEqual(w.origin, m.warned.origin, 'the edge it enters by');
  assert.equal(w.months, 3);
  assert.equal(w.frac, 0);
  assert.ok(near(w.pos, warbandPoint(w.dir, 0)));
  assert.equal(travelerLabel(w), `Warband of ${w.size} from the ${w.dir}, in 3 months`);
  // Two and a half months later it is most of the way in, one month to go.
  game.time.totalMonths += 2;
  game.time.day = CONFIG.DAYS_PER_MONTH / 2;
  w = empireTravelers(game).find((t) => t.kind === 'warband');
  assert.equal(w.months, 1);
  assert.ok(Math.abs(w.frac - 2.5 / 3) < 1e-9, `frac ${w.frac}`);
  assert.equal(travelerLabel(w), `Warband of ${w.size} from the ${w.dir}, in 1 month`);
  // It walks straight at the province from its side of the map.
  const far = warbandPoint(w.dir, 0);
  const close = warbandPoint(w.dir, 1);
  assert.ok(Math.hypot(close[0] - HOME_POS[0], close[1] - HOME_POS[1]) < Math.hypot(far[0] - HOME_POS[0], far[1] - HOME_POS[1]));
  assert.ok(warbandPoint('north', 0)[1] < HOME_POS[1] && warbandPoint('east', 0)[0] > HOME_POS[0], 'north is up, east is right');
  // The raid starts: the warband is gone, the raiders show at the city.
  game.time.day = 0;
  game.time.totalMonths = m.nextRaidMonth;
  militaryMonthly(game);
  assert.ok(m.active, 'raid launched');
  const list = empireTravelers(game);
  assert.equal(list.some((t) => t.kind === 'warband'), false);
  const raid = list.find((t) => t.kind === 'raid');
  assert.ok(raid && raid.size > 0, 'raiders shown');
  assert.match(travelerLabel(raid), /^Raiders in the province: \d+ left$/);
});

test('empire: a click finds the traveler, the city, Rome or the province under it', () => {
  const game = newGame();
  assert.ok(openRoute(game, 'tarraco').ok);
  const travelers = empireTravelers(game);
  const c = travelers[0];
  const hit = empireHitAt(game, travelers, c.pos[0] + 0.3, c.pos[1], 2);
  assert.equal(hit.kind, 'traveler');
  assert.equal(hit.t.id, 'tarraco');
  const city = empireHitAt(game, travelers, ...TRADE_PARTNERS.capua.pos, 2);
  assert.deepEqual(city, { kind: 'city', id: 'capua' });
  assert.deepEqual(empireHitAt(game, travelers, ...ROME_POS, 2), { kind: 'rome' });
  assert.deepEqual(empireHitAt(game, travelers, ...HOME_POS, 2), { kind: 'home' });
  assert.equal(empireHitAt(game, travelers, 98, 2, 2), null, 'empty corner');
});

test('empire: reading the travelers changes nothing in the game', () => {
  const game = seaGame();
  game.military.settings = { first: 6, interval: [14, 22], base: 8 };
  assert.ok(openRoute(game, 'massilia').ok);
  assert.ok(openRoute(game, 'tarraco').ok);
  game.military.warned = { origin: { x: 0, y: 5 }, size: 14, dir: 'north' };
  game.military.nextRaidMonth = game.time.totalMonths + 3;
  // The whole saved state, less the moment it was saved.
  const state = () => { const s = serializeGame(game); delete s.meta.savedAt; return JSON.stringify(s); };
  const before = state();
  const rng = game.rng.getState();
  for (let i = 0; i < 5; i++) {
    const list = empireTravelers(game);
    empireHitAt(game, list, 50, 30, 3);
    list.map(travelerLabel);
  }
  assert.equal(state(), before);
  assert.deepEqual(game.rng.getState(), rng);
});

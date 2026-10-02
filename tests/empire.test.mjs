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
import { TRADE_PARTNERS, SCENARIOS } from '../src/data/scenarios.js';
import { SITES, SANDBOX_SITES } from '../src/data/sites.js';
import { openRoute, routeKind, FIRST_VISIT_DAYS } from '../src/sim/trade.js';
import { visitInterval, routeVolume } from '../src/sim/tradeDemand.js';
import { militaryMonthly } from '../src/sim/military.js';
import { addBuilding } from '../src/sim/entities.js';
import { serializeGame } from '../src/core/save.js';
import {
  empireTravelers, tripDays, routePoint, routePath, warbandPoint, travelerLabel, empireHitAt, isDrawn, ROME_POS, SCOUT_MONTHS, RUMOUR_MONTHS, frontierDir, placeLabels,
} from '../src/ui/empireMap.js';
import { at, isLand, ROUTES, MAP_W, MAP_H, LON_WEST, LON_EAST, LAT_NORTH, LAT_SOUTH } from '../src/data/empireGeo.js';
import { newGame, findFree } from './helpers.mjs';

log.setLevel('error');

const near = (a, b, eps = 1e-9) => Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;

/** The Etruscan coast, the sandbox's default site (tests/helpers.mjs newGame plays there). */
const ETRURIA = 'etruria';
const HOME_POS = SITES.etruria.pos;

/** Every site a game can be played at, with the partners it trades with there: a mission's, or all twelve for a sandbox site. */
function sitesAndPartners() {
  const out = new Map();
  for (const s of SCENARIOS) out.set(s.site, new Set([...(out.get(s.site) || []), ...s.partners]));
  for (const id of SANDBOX_SITES) out.set(id, new Set(Object.keys(TRADE_PARTNERS)));
  return out;
}

/** A sandbox where ships can come (river maps reach the sea). */
function seaGame() {
  for (const seed of ['test-seed', 'a', 'b', 'c', 'd']) {
    const g = newGame({ type: 'river', seed });
    if (g.map.seaEntry) return g;
  }
  throw new Error('no river map with sea access');
}

test('empire: every trip fits between two visits, so a route has at most one traveler out', () => {
  // From every site, to every partner it trades with, at the partners' own
  // demand: the shortest interval is at least the trip (a quiet route's is
  // the round trip; a busy one's is shorter but still longer than the trip;
  // the missions' own demand: tests/sites.test.mjs).
  for (const [site, partners] of sitesAndPartners()) {
    for (const id of partners) {
      const d = tripDays(site, id);
      const p = TRADE_PARTNERS[id];
      assert.ok(d >= 1 && visitInterval(routeKind(id), routeVolume(p.buys, p.sells), d)[0] >= d, `${site} ${id}: ${d} days`);
    }
  }
  // From the Etruscan coast every round trip fits in the usual interval.
  for (const id of Object.keys(TRADE_PARTNERS)) {
    const usual = routeKind(id) === 'sea' ? CONFIG.SHIP_INTERVAL_DAYS : CONFIG.CARAVAN_INTERVAL_DAYS;
    assert.ok(2 * tripDays(ETRURIA, id) <= usual[0], `${id}: ${tripDays(ETRURIA, id)} days`);
  }
  // Far partners take longer than near ones.
  assert.ok(tripDays(ETRURIA, 'alexandria') > tripDays(ETRURIA, 'capua'));
});

test('empire: a route curve runs from the partner (0) to the province (1), wherever the province is', () => {
  for (const site of Object.keys(SITES)) {
    for (const id of Object.keys(TRADE_PARTNERS)) {
      assert.ok(near(routePoint(site, id, 0), TRADE_PARTNERS[id].pos), `${site} ${id} starts at the partner`);
      assert.ok(near(routePoint(site, id, 1), SITES[site].pos), `${site} ${id} ends at the province`);
    }
  }
});

test('empire: closed routes send nobody; an opened land route sends a caravan that closes in day by day', () => {
  const game = newGame();
  assert.deepEqual(empireTravelers(game), [], 'no routes open, no raids: nobody on the way');
  assert.ok(openRoute(game, 'tarraco').ok);
  // Opening a route sends the first caravan when it can have come: Tarraco
  // is 13 days from the Etruscan coast (more than the 8 a near partner's
  // first caravan takes). It sets out from Tarraco that day.
  let [c] = empireTravelers(game);
  const trip = tripDays(ETRURIA, 'tarraco');
  assert.equal(trip, 13);
  assert.equal(c.kind, 'caravan');
  assert.equal(c.id, 'tarraco');
  assert.equal(c.days, 13);
  assert.equal(c.trip, trip);
  assert.equal(c.onWay, true);
  assert.equal(c.frac, 0);
  assert.ok(near(c.pos, TRADE_PARTNERS.tarraco.pos), 'at its city');
  assert.equal(travelerLabel(c), 'Tarraco caravan: 13 days');
  // Half a day later it is half a day further: it glides between days.
  game.time.tick = CONFIG.TICKS_PER_DAY / 2;
  [c] = empireTravelers(game);
  assert.equal(c.days, 13, 'whole days, rounded up');
  assert.ok(Math.abs(c.frac - (1 - 12.5 / trip)) < 1e-9, `frac ${c.frac}`);
  game.time.tick = 0;
  // Ten days on (the sim run for real), three days are left.
  game.runDays(10);
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

test('empire: a far route\'s first trader sets out from its city when the route opens, never halfway along', () => {
  const game = seaGame();
  assert.ok(openRoute(game, 'alexandria').ok);
  // Alexandria is 29 days from the Etruscan coast: its first ship is due
  // then (once 8 days, when it popped up most of the way to the province).
  const trip = tripDays(ETRURIA, 'alexandria');
  assert.equal(trip, 29);
  let [s] = empireTravelers(game);
  assert.equal(s.kind, 'ship');
  assert.equal(s.days, trip);
  assert.equal(s.trip, trip);
  assert.equal(s.onWay, true, 'drawn from the start');
  assert.equal(s.frac, 0);
  assert.ok(near(s.pos, TRADE_PARTNERS.alexandria.pos), 'at Alexandria');
  // Halfway through its trip it is halfway along the route.
  game.time.totalDays += trip / 2;
  [s] = empireTravelers(game);
  assert.ok(Math.abs(s.frac - 0.5) < 1e-9, `frac ${s.frac}`);
  // Once a ship has called, the next is due weeks later and takes the whole
  // trip, setting out from Alexandria as its last days begin.
  const r = game.city.trade.routes.alexandria;
  r.visits = 1;
  r.nextVisit = game.time.totalDays + trip;
  [s] = empireTravelers(game);
  assert.equal(s.trip, trip);
  assert.equal(s.frac, 0);
  assert.ok(near(s.pos, TRADE_PARTNERS.alexandria.pos));
});

test('empire: a near partner\'s first trader is due in a week and sets out the day the route opens', () => {
  const game = seaGame();
  assert.ok(openRoute(game, 'massilia').ok);
  assert.equal(tripDays(ETRURIA, 'massilia'), 6, 'six days by sea from the Etruscan coast');
  let [s] = empireTravelers(game);
  assert.equal(s.days, FIRST_VISIT_DAYS, 'never sooner than a week after opening');
  assert.equal(s.trip, FIRST_VISIT_DAYS, 'shown over the whole week, from its city');
  assert.equal(s.frac, 0);
  // A later ship is shown over its real six days.
  const r = game.city.trade.routes.massilia;
  r.visits = 1;
  r.nextVisit = game.time.totalDays + 10;
  [s] = empireTravelers(game);
  assert.equal(s.trip, 6);
  assert.equal(s.onWay, false);
});

/** Is there water within `r` map units of `p`? */
function waterNear(p, r) {
  for (let d = 0; d <= r; d += 0.1) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) if (!isLand([p[0] + d * Math.cos(a), p[1] + d * Math.sin(a)])) return true;
  }
  return false;
}

test('empire: the map is the real Mediterranean, longitude and latitude projected onto 100 x 60', () => {
  assert.deepEqual([...at(LON_WEST, LAT_NORTH)], [0, 0]);
  assert.deepEqual([...at(LON_EAST, LAT_SOUTH)], [MAP_W, MAP_H]);
  // Real places on the right side of the water.
  assert.ok(isLand(at(12.5, 42.5)) && isLand(at(-4, 40)) && isLand(at(22.2, 37.5)), 'Italy, Hispania, the Peloponnese');
  assert.ok(isLand(at(14, 37.5)) && isLand(at(9, 40)) && isLand(at(25, 35.2)), 'Sicily, Sardinia, Crete are islands on the sea');
  assert.ok(!isLand(at(12, 39)) && !isLand(at(15, 43)) && !isLand(at(25, 38.5)) && !isLand(at(34, 43)), 'Tyrrhenian, Adriatic, Aegean, Black Sea');
  assert.ok(!isLand(at(15.6, 38.2)), 'the Strait of Messina is open water');
  assert.ok(!isLand(at(-5.5, 35.95)), 'so are the Pillars of Hercules');
  // The places sit where they really are, relative to each other.
  const P = (id) => TRADE_PARTNERS[id].pos;
  assert.ok(P('tarraco')[0] < P('massilia')[0] && P('lugdunum')[1] < P('massilia')[1], 'Tarraco west of Massilia, Lugdunum north of it');
  assert.ok(P('carthago')[1] > ROME_POS[1] && P('alexandria')[0] > P('corinthus')[0], 'Carthago south of Rome, Alexandria east of Corinthus');
});

test('empire: every city on land, every port by the sea, every road over land and every sea lane over water, from every province', () => {
  assert.ok(isLand(ROME_POS), 'Rome');
  assert.ok(isLand(HOME_POS) && waterNear(HOME_POS, 1), 'the Etruscan coast: on land, on the coast so ships can come');
  for (const [id, p] of Object.entries(TRADE_PARTNERS)) {
    assert.ok(isLand(p.pos), `${id} on land`);
    assert.ok(ROUTES[id] && ROUTES[id].length > 0, `${id} has a route drawn through its waypoints`);
    // Ports touch the sea; Cirta, inland, is within 2 map units of its harbor.
    if (routeKind(id) === 'sea') assert.ok(waterNear(p.pos, 2), `${id} by the sea`);
  }
  // Every mission's site with every partner of that mission, and every
  // sandbox site with all twelve.
  for (const [site, partners] of sitesAndPartners()) {
    const s = SITES[site];
    assert.ok(isLand(s.pos), `${site} on land`);
    if ([...partners].some((id) => routeKind(id) === 'sea')) assert.ok(waterNear(s.pos, 2) || s.river, `${site}: by the sea or up a river, so ships can come`);
    for (const id of partners) {
      const sea = routeKind(id) === 'sea';
      const { len, river } = routePath(site, id);
      for (let i = 0; i <= 400; i++) {
        const q = routePoint(site, id, i / 400);
        // A ship's last stretch crosses the shore to the city (and from the
        // province's harbor): 2 map units at each end are left out, and
        // the river a ship comes up to Corduba.
        const run = (i / 400) * len;
        if (sea && (run < 2 || len - run < river + 2)) continue;
        assert.equal(isLand(q), !sea, `${site} ${id} ${sea ? 'sea lane' : 'road'} at ${(i / 400).toFixed(3)}: (${q[0].toFixed(2)}, ${q[1].toFixed(2)}) is ${isLand(q) ? 'land' : 'water'}`);
      }
    }
  }
});

test('empire: warbands close in over land on land and by sea at sea, from every province', () => {
  // The Etruscan coast: its northern sides are the Alps and the Po valley,
  // its south and south-west the Tyrrhenian Sea (drawn in a boat).
  const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  assert.ok(isLand(warbandPoint(ETRURIA, 'north', 0)) && isLand(warbandPoint(ETRURIA, 'north-west', 0)) && isLand(warbandPoint(ETRURIA, 'north-east', 0)));
  assert.equal(isLand(warbandPoint(ETRURIA, 'south', 0, true)), false);
  assert.equal(isLand(warbandPoint(ETRURIA, 'south-west', 0, true)), false);
  // A band that comes by land from the sea side is drawn on the nearest side
  // over land (it once stood in the sea): from the south, the Apennines.
  for (const site of Object.keys(SITES)) {
    for (const d of dirs) {
      for (const f of [0, 0.5, 1]) assert.ok(isLand(warbandPoint(site, d, f)), `${site}: a band by land from the ${d} is on land`);
    }
  }
  // At sea from every site raided by sea (the sandbox's sites, Populonia).
  for (const site of [...SANDBOX_SITES, 'populonia']) {
    for (const f of [0, 1]) assert.equal(isLand(warbandPoint(site, 'south', f, true)), false, `${site}: by sea`);
  }
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

test('empire: a scouted warband closes in from its side over its last three months, then raids show at the city', () => {
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
  assert.equal(w.frac, 0.5, 'half way in: its banner runs over the whole 6 months since word came');
  assert.ok(near(w.pos, warbandPoint(ETRURIA, w.dir, 0.5)));
  assert.equal(travelerLabel(w), `Warband of ${w.size} from the ${w.dir}, in 3 months`);
  // Two and a half months later it is most of the way in, one month to go.
  game.time.totalMonths += 2;
  game.time.day = CONFIG.DAYS_PER_MONTH / 2;
  w = empireTravelers(game).find((t) => t.kind === 'warband');
  assert.equal(w.months, 1);
  assert.ok(Math.abs(w.frac - (1 - 0.5 / RUMOUR_MONTHS)) < 1e-9, `frac ${w.frac}`);
  assert.equal(travelerLabel(w), `Warband of ${w.size} from the ${w.dir}, in 1 month`);
  // It walks straight at the province from its side of the map.
  const far = warbandPoint(ETRURIA, w.dir, 0);
  const close = warbandPoint(ETRURIA, w.dir, 1);
  assert.ok(Math.hypot(close[0] - HOME_POS[0], close[1] - HOME_POS[1]) < Math.hypot(far[0] - HOME_POS[0], far[1] - HOME_POS[1]));
  assert.ok(warbandPoint(ETRURIA, 'north', 0)[1] < HOME_POS[1] && warbandPoint(ETRURIA, 'east', 0)[0] > HOME_POS[0], 'north is up, east is right');
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

test('empire: a warband only rumoured stands at the frontier with no number, then moves to its side when scouted', () => {
  const game = newGame({ invasions: 'occasional' });
  const m = game.military;
  game.city.population = 600;
  const spot = findFree(game, 1, 1);
  addBuilding(game, 'house', spot.x, spot.y);
  game.time.totalMonths = m.nextRaidMonth - RUMOUR_MONTHS;
  militaryMonthly(game);
  assert.equal(m.warnStage, 1, 'word of it');
  let w = empireTravelers(game).find((t) => t.kind === 'warband');
  assert.ok(w && w.rumour, 'on the map as a rumour');
  assert.equal(w.size, null);
  assert.equal(w.dir, null);
  assert.equal(w.origin, null);
  assert.equal(w.frac, 0);
  assert.ok(near(w.pos, warbandPoint(ETRURIA, frontierDir(ETRURIA), 0)));
  assert.equal(travelerLabel(w), 'Warband gathering beyond the frontier, in about 6 months');
  // Overland all the way: a band of unknown road is not drawn at sea.
  assert.ok(isLand(warbandPoint(ETRURIA, frontierDir(ETRURIA), 0)) && isLand(warbandPoint(ETRURIA, frontierDir(ETRURIA), 0.5)));
  game.time.totalMonths += 2;
  w = empireTravelers(game).find((t) => t.kind === 'warband');
  assert.equal(travelerLabel(w), 'Warband gathering beyond the frontier, in about 4 months');
  assert.ok(Math.abs(w.frac - 2 / RUMOUR_MONTHS) < 1e-9);
  // The scouts find it: its side, its size, half way in.
  game.time.totalMonths = m.nextRaidMonth - SCOUT_MONTHS;
  militaryMonthly(game);
  w = empireTravelers(game).find((t) => t.kind === 'warband');
  assert.equal(w.rumour, undefined);
  assert.equal(w.dir, m.warned.dir);
  assert.ok(near(w.pos, warbandPoint(ETRURIA, w.dir, 0.5)));
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

test('a name with no free side goes where it covers the least of the others, not on top of one', () => {
  // Vercellae, threatened in Narbo Martius, sits among Lugdunum, Massilia,
  // Aquileia and the province: every side of its marker clashed, and its
  // name printed over Massilia's. Here a city ringed by markers: the one to
  // its left is small, so the name goes left (drawn right-aligned).
  const drawn = [];
  const ctx = {
    font: '', textAlign: 'left', lineWidth: 1, strokeStyle: '', fillStyle: '',
    measureText: (t) => ({ width: t.length * 1.2 }),
    strokeText() {},
    fillText(text, x, y) { drawn.push({ text, x, y, align: this.textAlign }); },
  };
  const centre = [50, 30];
  const names = [
    { text: 'N', pos: [50, 25], r: 4, bold: false, sides: ['above'] },
    { text: 'S', pos: [50, 35], r: 4, bold: false, sides: ['below'] },
    { text: 'E', pos: [58, 30], r: 4, bold: false, sides: ['right'] },
    { text: 'W', pos: [43.5, 30], r: 0.6, bold: false, sides: ['left'] },
    { text: 'Vercellae', pos: centre, r: 1.2, bold: false, sides: ['below', 'right', 'left', 'above'] },
  ];
  placeLabels(ctx, names, 1);
  const v = drawn.find((d) => d.text === 'Vercellae');
  assert.equal(v.align, 'right', JSON.stringify(drawn));
  assert.ok(v.x < centre[0]);
});

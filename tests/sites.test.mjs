/**
 * sites.test.mjs - where the province sits on the empire map (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Each mission has its own place on the empire map (data/sites.js); its trade
 * routes are found on a network of roads and sea lanes (data/empireRoutes.js)
 * that gives the Etruscan coast exactly the routes it always had. Distance is
 * Colonia's own rule: a far quiet route's traders come less often, never
 * sooner than one can go home and come back (sim/tradeDemand.js); the first
 * trader comes when it can have made the trip (sim/trade.js). Distant battles
 * are marched along the same network (data/battles.js).
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { Game } from '../src/core/game.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { SCENARIOS, TRADE_PARTNERS, sandboxScenario, findScenario } from '../src/data/scenarios.js';
import { SITES, SITE_IDS, SANDBOX_SITES, HOME_SITE, siteIdOf, homeSiteId } from '../src/data/sites.js';
import { routeWaypoints, routePath, tripDays, networkEdges, lineOver, lineLength, legionWay, smoothLine, TRIP_DAYS_PER_UNIT } from '../src/data/empireRoutes.js';
import { at, isLand, ROUTES, RIVERS_LL, project } from '../src/data/empireGeo.js';
import { THREATENED_CITIES, THREATENED_IDS, SANDBOX_THREATENED_IDS, marchLine, marchMonths } from '../src/data/battles.js';
import { routeInterval, visitInterval, routeVolume, buysInForce, usualInterval } from '../src/sim/tradeDemand.js';
import { openRoute, routeKind, updateTrade, firstVisitDays, FIRST_VISIT_DAYS } from '../src/sim/trade.js';
import { requestTroops, battleSummary } from '../src/sim/battle.js';
import { empireTravelers, empireHitAt, warbandPoint, frontierDir, legionRoad, markerSpots } from '../src/ui/empireMap.js';

log.setLevel('error');

/** A game at month `month` of a scenario (a stand-in: routeInterval reads only these). */
const at0 = (scenario, month = 0) => ({ scenario, seed: scenario.map.seed, time: { totalMonths: month } });

/** A small sandbox at a site. */
const sandboxAt = (site, opts = {}) => new Game({ scenario: sandboxScenario({ size: 64, type: 'coast', seed: 'beach', invasions: 'none', site, ...opts }), flags: { unlockall: true, money: 50000 } });

// ---------------------------------------------------------------------------
// Where each mission is
// ---------------------------------------------------------------------------

test('sites: every mission has its own place on the map, the Etruscan coast for Pons Aelius, Urbs Magna and the sandbox', () => {
  assert.deepEqual(Object.fromEntries(SCENARIOS.map((s) => [s.id, s.site])), {
    c1: 'castrum_novum', c2: 'volsinii', c3: 'figline', c3m: 'firmum', c4: 'etruria', c4p: 'paestum', c5: 'populonia', c5p: 'beneventum',
    c6: 'luceria', c6p: 'cosa', c7: 'etruria', c7p: 'copia', c8m: 'mutina', c8p: 'luna', c9m: 'corduba', c9p: 'carteia', c10m: 'narbo', c10p: 'puteoli',
  });
  // Where they really were (Puteoli a little inland of its real 40.82, which the map's coarse coast puts in the bay).
  const where = {
    etruria: [10.45, 43.72], castrum_novum: [13.96, 42.75], volsinii: [11.99, 42.64], figline: [11.42, 43.62], firmum: [13.72, 43.16], paestum: [15.0, 40.42],
    populonia: [10.52, 42.99], beneventum: [14.78, 41.13], luceria: [15.34, 41.51], cosa: [11.29, 42.41], copia: [16.47, 39.71], mutina: [10.93, 44.65],
    luna: [10.03, 44.07], corduba: [-4.78, 37.88], carteia: [-5.42, 36.18], narbo: [3.0, 43.18], puteoli: [14.12, 40.86],
  };
  assert.deepEqual(SITE_IDS.slice().sort(), Object.keys(where).sort());
  for (const [id, ll] of Object.entries(where)) assert.deepEqual([...SITES[id].pos], [...at(...ll)], id);
  assert.equal(HOME_SITE, 'etruria');
  assert.equal(sandboxScenario().site, 'etruria', 'the sandbox, by default');
  assert.equal(sandboxScenario({ site: 'narbo' }).site, 'narbo');
  assert.equal(sandboxScenario({ site: 'corduba' }).site, 'etruria', 'only the setup\'s choices');
  assert.equal(siteIdOf({ id: 'sandbox' }), 'etruria', 'a sandbox saved before sites');
  assert.equal(siteIdOf({ site: 'toString' }), 'etruria');
  assert.deepEqual(SANDBOX_SITES, ['etruria', 'luna', 'cosa', 'puteoli', 'paestum', 'narbo']);
});

test('sites: every site on land; every one with sea partners by the water or up a river; every frontier over land', () => {
  const waterNear = (p, r) => {
    for (let d = 0; d <= r; d += 0.1) for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) if (!isLand([p[0] + d * Math.cos(a), p[1] + d * Math.sin(a)])) return true;
    return false;
  };
  const seaSites = new Set([...SANDBOX_SITES, ...SCENARIOS.filter((s) => s.partners.some((id) => routeKind(id) === 'sea')).map((s) => s.site)]);
  for (const id of SITE_IDS) {
    const s = SITES[id];
    assert.ok(isLand(s.pos), `${id} on land`);
    if (seaSites.has(id)) assert.ok(waterNear(s.pos, 2) || s.river, `${id}: ships can come`);
    // A rumoured warband stands on its site's frontier side, over land from 9 map units out to 3.
    const step = { north: [0, -1], 'north-west': [-Math.SQRT1_2, -Math.SQRT1_2], west: [-1, 0] }[frontierDir(id)];
    assert.ok(step, `${id}: ${frontierDir(id)}`);
    for (let r = 9; r >= 3; r -= 0.5) assert.ok(isLand([s.pos[0] + step[0] * r, s.pos[1] + step[1] * r]), `${id}: its frontier ${frontierDir(id)} is land ${r} out`);
    for (const f of [0, 0.5, 1]) assert.ok(isLand(warbandPoint(id, frontierDir(id), f)));
  }
  // Corduba's ships come up the Baetis: its river is drawn, and every point of its leg is on it.
  const baetis = RIVERS_LL.baetis.map((p) => project(p));
  for (const p of SITES.corduba.river) {
    const q = project(p);
    assert.ok(baetis.some((b) => Math.hypot(b[0] - q[0], b[1] - q[1]) < 1e-9), `${p} on the Baetis`);
  }
  assert.deepEqual(SITES.corduba.river.at(-1), RIVERS_LL.baetis.at(-1), 'the leg ends at the river\'s mouth');
});

// ---------------------------------------------------------------------------
// The network
// ---------------------------------------------------------------------------

test('network: the Etruscan coast gets exactly the twelve routes it always had, point for point and length for length', () => {
  const lengths = {
    tarraco: 25.5052, massilia: 11.681, lugdunum: 14.6801, aquileia: 9.1463, capua: 11.0823, carthago: 19.873,
    cirta: 24.6069, corinthus: 38.1668, alexandria: 57.8618, gades: 46.2251, rhodus: 51.1356, delos: 44.3042,
  };
  for (const id of Object.keys(TRADE_PARTNERS)) {
    assert.deepEqual(routeWaypoints('etruria', id), ROUTES[id].map((p) => [...p]), `${id}: the same points`);
    assert.equal(routePath('etruria', id).len.toFixed(4), lengths[id].toFixed(4), `${id}: the same length`);
  }
});

test('network: every road over land and every lane over water (a city\'s harbor stretch aside)', () => {
  for (const { a, b } of networkEdges('land')) {
    const r = lineOver([a, b], true, { step: 0.1 });
    assert.ok(r.ok, `road ${a.map((v) => v.toFixed(1))} to ${b.map((v) => v.toFixed(1))}: water at ${r.at?.map((v) => v.toFixed(2))}`);
  }
  for (const { a, b, aCity, bCity } of networkEdges('sea')) {
    const r = lineOver([a, b], false, { step: 0.1, skipStart: aCity ? 2 : 0, skipEnd: bCity ? 2 : 0 });
    assert.ok(r.ok, `lane ${a.map((v) => v.toFixed(1))} to ${b.map((v) => v.toFixed(1))}: land at ${r.at?.map((v) => v.toFixed(2))}`);
  }
});

test('network: the way from each mission\'s site, and its trip at half a day a map unit', () => {
  assert.equal(TRIP_DAYS_PER_UNIT, 0.5);
  const len = (site, id) => +routePath(site, id).len.toFixed(1);
  // Near and far: Capua is next door to Puteoli, Alexandria across the sea from Corduba.
  assert.deepEqual([len('puteoli', 'capua'), tripDays('puteoli', 'capua')], [0.7, 1]);
  assert.deepEqual([len('puteoli', 'tarraco'), tripDays('puteoli', 'tarraco')], [37.3, 19]);
  assert.deepEqual([len('corduba', 'alexandria'), tripDays('corduba', 'alexandria')], [93.3, 47]);
  assert.deepEqual([len('corduba', 'gades'), tripDays('corduba', 'gades')], [6.9, 3]);
  assert.deepEqual([len('etruria', 'alexandria'), tripDays('etruria', 'alexandria')], [57.9, 29]);
  // Corduba's ships come up the Baetis (the last 4.8 units of every sea route there); its caravans from Lugdunum pass Tarraco.
  assert.equal(+routePath('corduba', 'gades').river.toFixed(1), 4.8);
  assert.equal(routePath('narbo', 'massilia').river, 0);
  assert.ok(routeWaypoints('corduba', 'lugdunum').some((p) => p[0] === TRADE_PARTNERS.tarraco.pos[0] && p[1] === TRADE_PARTNERS.tarraco.pos[1]), 'through Tarraco');
  // Every partner of every mission, and every partner from every sandbox site, has a way by its kind.
  for (const s of SCENARIOS) for (const id of s.partners) assert.ok(routeWaypoints(s.site, id), `${s.id} ${id}`);
  for (const site of SANDBOX_SITES) for (const id of Object.keys(TRADE_PARTNERS)) assert.ok(routeWaypoints(site, id), `${site} ${id}`);
});

// ---------------------------------------------------------------------------
// Trade timing
// ---------------------------------------------------------------------------

test('trade timing: a quiet route\'s traders come no oftener than the round trip; a busy one\'s then scaled by its demand', () => {
  // The Etruscan coast: Alexandria, 29 days off, keeps the usual 64-96 (its round trip, 58, fits).
  const c7 = findScenario('c7');
  assert.deepEqual(routeInterval(at0(c7), 'alexandria'), [64, 96]);
  // Puteoli: Capua a day off keeps 32-56; Tarraco, 19 days off, 38-62.
  const c10p = findScenario('c10p');
  assert.deepEqual(routeInterval(at0(c10p), 'capua'), [32, 56]);
  assert.deepEqual(routeInterval(at0(c10p), 'tarraco'), [38, 62]);
  // Carteia: Alexandria 42 days off, 4,500 a year: 84 to 116 (stretched to 84-116, not busy there).
  assert.deepEqual(visitInterval('sea', 4500, 42), [84, 116]);
  assert.deepEqual(routeInterval(at0(findScenario('c9p')), 'alexandria'), [84, 116]);
  // Corduba: Alexandria 47 days off: stretched to 94-126, too slow for its
  // 4,500 a year, so the busy rule brings it to 88-117. Rhodus 43 days off,
  // 6,500 a year: stretched to 86-118, busy at 60-82, the same pace as the
  // 57-85 it had. Gades, 3 days off, 6,000 a year: 61-92, as always.
  const c9m = findScenario('c9m');
  assert.deepEqual(usualInterval('sea', 47), [94, 126]);
  assert.deepEqual(routeInterval(at0(c9m), 'alexandria'), [88, 117]);
  assert.deepEqual(routeInterval(at0(c9m), 'rhodus'), [60, 82]);
  assert.deepEqual(visitInterval('sea', 6500, 0), [57, 85]);
  assert.deepEqual(routeInterval(at0(c9m), 'gades'), [61, 92]);
  assert.deepEqual(routeInterval(at0(c9m), 'lugdunum'), [34, 58]);
});

test('trade timing: at Pons Aelius, Urbs Magna and the default sandbox every route keeps exactly its old interval', () => {
  for (const scenario of [findScenario('c4'), findScenario('c7'), sandboxScenario()]) {
    for (const id of scenario.partners) {
      for (let month = 0; month <= 12 * 12; month += 6) {
        const g = at0(scenario, month);
        const p = TRADE_PARTNERS[id];
        const vol = routeVolume(buysInForce(scenario, g.seed, id, month), p.sells);
        assert.deepEqual(routeInterval(g, id), visitInterval(routeKind(id), vol), `${scenario.id} ${id} month ${month}`);
      }
    }
  }
});

test('trade timing: only far routes change, and every mission route still carries its whole year', () => {
  const changed = [];
  for (const s of SCENARIOS) {
    for (const id of s.partners) {
      const kind = routeKind(id);
      const carry = kind === 'sea' ? CONFIG.SHIP_MAX_TRADE : CONFIG.CARAVAN_MAX_TRADE;
      for (let month = 0; month <= (Math.ceil(s.paceYears) + 3) * 12; month += 3) {
        const vol = routeVolume(buysInForce(s, s.map.seed, id, month), TRADE_PARTNERS[id].sells);
        const [a, b] = routeInterval(at0(s, month), id);
        const old = visitInterval(kind, vol);
        if ((a !== old[0] || b !== old[1]) && !changed.includes(`${s.id} ${id}`)) changed.push(`${s.id} ${id}`);
        // Reach: what its traders carry in a year at that pace, against what
        // it trades (whole days round a busy route's interval: Mutina's
        // Capua at 7,600 a year carried 98.6% of it before distance counted).
        assert.ok(carry * (CONFIG.DAYS_PER_MONTH * CONFIG.MONTHS_PER_YEAR) / ((a + b) / 2) >= vol * 0.98, `${s.id} ${id} month ${month}: ${vol} a year`);
        // The map: a trader is never shown over more than the shortest interval, so it always sets out from its city.
        assert.ok(tripDays(s.site, id) <= a, `${s.id} ${id}: trip ${tripDays(s.site, id)} against ${a}`);
      }
    }
  }
  assert.deepEqual(changed.sort(), [
    'c10m alexandria', 'c10p tarraco', 'c5p tarraco', 'c6 tarraco', 'c7p tarraco',
    'c9m alexandria', 'c9m lugdunum', 'c9m rhodus', 'c9p alexandria', 'c9p corinthus', 'c9p delos',
  ]);
});

test('trade timing: the first trader comes when it can have made the trip, at least a week after the route opens', () => {
  const game = sandboxAt('puteoli');
  assert.equal(homeSiteId(game), 'puteoli');
  game.cheats.freeBuild = true;
  const now = game.time.totalDays;
  assert.ok(openRoute(game, 'capua').ok);
  assert.ok(openRoute(game, 'tarraco').ok);
  assert.equal(game.city.trade.routes.capua.nextVisit - now, FIRST_VISIT_DAYS, 'Capua, a day off: in 8 days');
  assert.equal(game.city.trade.routes.tarraco.nextVisit - now, 19, 'Tarraco, 19 days off: in 19');
  assert.equal(firstVisitDays(at0(findScenario('c7')), 'alexandria'), 29, 'Alexandria from the Etruscan coast');
  // The map shows each setting out from its city that day.
  const list = empireTravelers(game);
  for (const t of list) assert.deepEqual([t.onWay, t.frac, t.trip], [true, 0, t.days], t.id);
});

test('trade timing: on Insane a trader on the road stands still on a held winter day', () => {
  const game = new Game({ scenario: sandboxScenario({ size: 64, type: 'coast', seed: 'beach', invasions: 'none', difficulty: 'insane' }), flags: { unlockall: true, money: 50000 } });
  game.cheats.freeBuild = true;
  assert.ok(openRoute(game, 'tarraco').ok);
  const r = game.city.trade.routes.tarraco;
  r.visits = 1;
  game.time.month = 0; // Ianuarius
  if (game.time.totalDays % 2 === 0) game.time.totalDays++; // a held day (sim/trade.js: every other winter day)
  r.nextVisit = game.time.totalDays + 5;
  const before = empireTravelers(game)[0];
  updateTrade(game);
  game.time.totalDays++;
  const after = empireTravelers(game)[0];
  assert.equal(r.nextVisit, game.time.totalDays + 5, 'the visit moved a day later');
  assert.deepEqual(after.pos, before.pos);
  assert.ok(before.onWay && before.frac > 0);
});

// ---------------------------------------------------------------------------
// Armies
// ---------------------------------------------------------------------------

test('battles: the march from the Etruscan coast is as it was; each mission marches from its own site', () => {
  assert.deepEqual(THREATENED_IDS.map((id) => marchMonths('etruria', id)), [3, 3, 7, 5, 12, 3, 3]);
  const months = SCENARIOS.flatMap((s) => (s.distantBattles || []).map((e) => `${s.id} ${e.city} ${marchMonths(s.site, e.city)}`));
  assert.deepEqual(months, [
    'c3m ariminum 3', 'c4 placentia 3', 'c5 saguntum 8', 'c6 ariminum 3', 'c7 messana 5', 'c7 placentia 3',
    'c8m placentia 3', 'c8m ariminum 3', 'c9m italica 3', 'c9m italica 3', 'c10m aquae_sextiae 3', 'c10m vercellae 4',
  ]);
  // Every way by its kind: over land, or at sea (a ship's river leg aside).
  for (const s of SCENARIOS) {
    for (const e of s.distantBattles || []) {
      const c = THREATENED_CITIES[e.city];
      const line = marchLine(s.site, e.city);
      const river = c.route === 'sea' && SITES[s.site].river ? SITES[s.site].river.length : 0;
      line.slice(1 + river, -1).forEach((p) => assert.equal(isLand(p), c.route === 'land', `${s.id} ${e.city}: ${p.map((v) => v.toFixed(1))}`));
      const m = marchMonths(s.site, e.city);
      assert.ok(m >= CONFIG.BATTLE_MIN_MONTHS && m <= 12);
    }
  }
  // From every sandbox site, every city its random requests may name is within 12 months.
  for (const site of SANDBOX_SITES) for (const id of SANDBOX_THREATENED_IDS) assert.ok(marchMonths(site, id) <= 12, `${site} ${id}: ${marchMonths(site, id)}`);
});

test('battles: every march is drawn over land or at sea by its kind, curve and all (the way to Saguntum once crossed Ibiza)', () => {
  const pairs = [];
  for (const s of SCENARIOS) for (const e of s.distantBattles || []) pairs.push([s.site, e.city]);
  for (const site of SANDBOX_SITES) for (const city of SANDBOX_THREATENED_IDS) pairs.push([site, city]);
  for (const [site, city] of pairs) {
    const sea = THREATENED_CITIES[city].route === 'sea';
    const line = marchLine(site, city);
    // A ship leaves its harbor and reaches its city over 2 map units of shore, and Corduba's go down the river first.
    const river = sea && SITES[site].river ? SITES[site].river.length : 0;
    const skipStart = sea ? lineLength(line.slice(0, river + 1)) + 2 : 0;
    const r = lineOver(smoothLine(line), !sea, { step: 0.2, skipStart, skipEnd: sea ? 2 : 0 });
    assert.ok(r.ok, `${site} to ${city}: ${sea ? 'land' : 'water'} at ${r.at?.map((v) => v.toFixed(2))}`);
  }
});

test('battles: the Corduba briefing says what the march is', () => {
  const c9m = findScenario('c9m');
  const hint = c9m.hints.find((h) => /Italica/.test(h));
  assert.equal(marchMonths('corduba', 'italica'), 3);
  assert.match(hint, /about three months/);
  for (const s of SCENARIOS) for (const h of s.hints || []) assert.doesNotMatch(h, /a year at sea/, s.id);
});

test('battles: Corduba\'s troops march to Italica, down the Baetis, in 3 months; the request and the advisor say so', () => {
  const game = new Game({ scenario: findScenario('c9m') });
  assert.equal(homeSiteId(game), 'corduba');
  const msgs = [];
  const msg = game.message.bind(game);
  game.message = (text, ...rest) => { msgs.push(text); return msg(text, ...rest); };
  requestTroops(game, 'italica', 48);
  assert.match(msgs.at(-1), /about 3 months to get there/);
  assert.equal(battleSummary(game).march, 3);
  assert.equal(marchMonths('etruria', 'italica'), 12, 'from the Etruscan coast it was a 12-month voyage');
});

test('legions: Caesar\'s legions come by road from Rome, over land, to just short of the province', () => {
  for (const site of SITE_IDS) {
    const way = legionWay(site);
    assert.deepEqual(way.at(-1), [...SITES[site].pos], site);
    const road = legionRoad(site);
    assert.ok(lineOver(road, true, { skipStart: 0.3 }).ok, `${site}: over land`);
    const end = road.at(-1);
    assert.ok(Math.abs(Math.hypot(end[0] - SITES[site].pos[0], end[1] - SITES[site].pos[1]) - 2.5) < 1.5, `${site}: stops short`);
  }
  // From Rome to Corduba a straight line crosses the sea; the road does not.
  assert.equal(lineOver([legionWay('corduba')[0], SITES.corduba.pos], true).ok, false);
  assert.ok(lineOver(smoothLine(legionWay('corduba')), true, { skipStart: 0.3 }).ok);
});

// ---------------------------------------------------------------------------
// The map and saves
// ---------------------------------------------------------------------------

test('map: the province\'s star is where its site is, and a click finds it beside a partner next door', () => {
  const game = sandboxAt('puteoli');
  const travelers = empireTravelers(game);
  assert.deepEqual(empireHitAt(game, travelers, ...SITES.puteoli.pos, 2), { kind: 'home' });
  assert.deepEqual(empireHitAt(game, travelers, ...TRADE_PARTNERS.capua.pos, 2), { kind: 'city', id: 'capua' }, 'Capua, 0.7 units off, can still be clicked');
  // Raiders and Caesar's legions in the province are drawn beside it on land, apart (at Firmum and Puteoli they once stood in the sea).
  for (const site of SITE_IDS) {
    const { raid, legion } = markerSpots(site);
    assert.ok(isLand(raid) && isLand(legion), `${site}: markers on land`);
    assert.ok(Math.hypot(raid[0] - legion[0], raid[1] - legion[1]) >= 2, `${site}: markers apart`);
    for (const p of [raid, legion]) assert.ok(Math.hypot(p[0] - SITES[site].pos[0], p[1] - SITES[site].pos[1]) < 5, `${site}: beside it`);
  }
  // The Etruscan coast keeps the spots it always had.
  assert.deepEqual(markerSpots('etruria'), { raid: [SITES.etruria.pos[0] + 2.6, SITES.etruria.pos[1] - 2.4], legion: [SITES.etruria.pos[0] - 2.6, SITES.etruria.pos[1] + 3.6] });
  // A sandbox on the Etruscan coast finds its province there, not at Puteoli.
  const home = sandboxAt('etruria');
  assert.deepEqual(empireHitAt(home, [], ...SITES.etruria.pos, 2), { kind: 'home' });
  assert.notDeepEqual(empireHitAt(home, [], ...SITES.puteoli.pos, 0.3), { kind: 'home' });
});

test('saves: a campaign save loads at its mission\'s site, a sandbox keeps its own, one from before sites loads on the Etruscan coast', () => {
  const corduba = new Game({ scenario: findScenario('c9m') });
  const data = JSON.parse(JSON.stringify(serializeGame(corduba)));
  assert.deepEqual(data.scenario, { id: 'c9m' }, 'a campaign save stores the mission only');
  assert.equal(homeSiteId(deserializeGame(data)), 'corduba');
  const narbo = sandboxAt('narbo');
  assert.equal(homeSiteId(deserializeGame(JSON.parse(JSON.stringify(serializeGame(narbo))))), 'narbo');
  const old = JSON.parse(JSON.stringify(serializeGame(narbo)));
  delete old.scenario.site;
  const loaded = deserializeGame(old);
  assert.equal(homeSiteId(loaded), 'etruria');
  assert.deepEqual(routeInterval(loaded, 'alexandria'), [64, 96]);
  const bad = JSON.parse(JSON.stringify(serializeGame(narbo)));
  bad.scenario.site = 'atlantis';
  assert.throws(() => deserializeGame(bad), /Invalid save file: unknown province site "atlantis"/);
  // Not a name at all (a hand-edited file): refused, not quietly put on the Etruscan coast.
  bad.scenario.site = ['narbo'];
  assert.throws(() => deserializeGame(bad), /Invalid save file: unknown province site/);
});

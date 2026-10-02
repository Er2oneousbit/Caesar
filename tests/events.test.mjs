/**
 * events.test.mjs - the province's events (sim/events.js, data/events.js):
 * the monthly random draw and its switches, cooldowns and conditions; Rome's
 * wage and what reads it; trade stopped by landslides, storms and Neptune;
 * bad water; a mine or clay pit lost; the scheduled change of emperor and
 * price changes; the earthquake's cracks; saves mid-event; and the rule that
 * events never touch the game's own random stream.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { Game } from '../src/core/game.js';
import { serializeGame, deserializeGame, upgradeEventsV22 } from '../src/core/save.js';
import { Terrain, Road } from '../src/world/map.js';
import { SCENARIOS, findScenario, sandboxScenario, withDifficulty } from '../src/data/scenarios.js';
import { GOODS } from '../src/data/goods.js';
import { DIFFICULTY } from '../src/data/difficulty.js';
import {
  RANDOM_EVENTS, EVENT_TABLE_SIZE, EVENT_SWITCHES, EVENTS_BY_MISSION, QUAKE_SIZES, ROME_WAGE_MIN, ROME_WAGE_MAX,
  TRADE_HALT_DAYS, NEPTUNE_HALT_DAYS, WAGE_COOLDOWN, missionEvents, eventMonth, EVENT_MONTHS,
} from '../src/data/events.js';
import {
  eventDraw, applyEvent, eventCondition, randomEventMonth, eventsMonthly, scheduledEventsMonth, tradeHalted, tradeHaltText,
  startQuake, updateQuake, quakePoint, newEventState, eventSwitchedOn,
} from '../src/sim/events.js';
import { romeWage } from '../src/sim/economy.js';
import { computeSentiment } from '../src/sim/population.js';
import { updateTrade, openRoute } from '../src/sim/trade.js';
import { scheduledFactor, priceWith, tradePrice } from '../src/sim/prices.js';
import { updateReligion } from '../src/sim/religion.js';
import { refreshDiseaseGate } from '../src/sim/disease.js';
import { addBuilding, spawnWalker } from '../src/sim/entities.js';
import { buildDemoCity } from '../src/dev/demoCity.js';
import { GOD_KEYS } from '../src/data/gods.js';
import { RNG } from '../src/core/rng.js';
import { newGame, findFree } from './helpers.mjs';

log.setLevel('error');

const DPM = CONFIG.DAYS_PER_MONTH;
const lastMessage = (game) => game.messages[0];

/** Set the population as the day's count would (bad water and disease read the gate). */
function setPop(game, n) {
  game.city.population = n;
  refreshDiseaseGate(game);
}

/** A mission month at which the month's draw names `key` on this difficulty. */
function monthDrawing(seed, key, factor = 1, from = 0) {
  for (let m = from; m < from + 5000; m++) if (eventDraw(seed, m, factor) === key) return m;
  throw new Error(`no month draws ${key}`);
}

// ---------------------------------------------------------------------------
// The tables
// ---------------------------------------------------------------------------

test('events data: the original table (26 of 128 entries), every mission entry real and sane', () => {
  assert.equal(EVENT_TABLE_SIZE, 128);
  assert.equal(RANDOM_EVENTS.reduce((n, e) => n + e.entries, 0), 26);
  for (const e of RANDOM_EVENTS) assert.ok(EVENT_SWITCHES.includes(e.switch), `${e.key}'s switch`);
  for (const [id, e] of Object.entries(EVENTS_BY_MISSION)) {
    const s = findScenario(id);
    assert.ok(s, `${id} is a mission`);
    for (const k of e.random) assert.ok(EVENT_SWITCHES.includes(k), `${id}: switch ${k}`);
    if (e.quake) {
      assert.ok(QUAKE_SIZES[e.quake.size], `${id}: quake size`);
      assert.ok(e.quake.year >= 1 && e.quake.year <= Math.ceil(s.paceYears), `${id}: the quake comes within the mission's planned years`);
    }
    for (const y of e.emperor || []) assert.ok(y >= 1 && y <= Math.ceil(s.paceYears), `${id}: the emperor changes within the planned years`);
    for (const p of e.priceChanges || []) {
      assert.ok(GOODS[p.good], `${id}: ${p.good} is a good`);
      assert.ok(Math.abs(p.change) > 0 && Math.abs(p.change) < 1, `${id}: a share`);
    }
  }
  // Missions 1 and 2 teach the basics: no events.
  for (const id of ['c1', 'c2']) assert.deepEqual(missionEvents(findScenario(id)).random, []);
  // The sandbox: every random event, unless its setup switched them off; nothing scheduled.
  const sb = sandboxScenario({});
  assert.deepEqual([...missionEvents(sb).random], [...EVENT_SWITCHES]);
  assert.equal(missionEvents(sb).quake, null);
  assert.deepEqual([...missionEvents({ ...sb, events: false }).random], []);
});

test('events draw: one a month at the table\'s odds, the difficulty scaling the whole table', () => {
  const months = 128 * 400;
  const tally = (factor) => {
    const n = {};
    for (let m = 0; m < months; m++) {
      const k = eventDraw('odds', m, factor);
      if (k) n[k] = (n[k] || 0) + 1;
    }
    return n;
  };
  const normal = tally(1);
  for (const e of RANDOM_EVENTS) {
    const want = (e.entries / 128) * months;
    assert.ok(Math.abs(normal[e.key] - want) < want * 0.15, `${e.key}: ${normal[e.key]} against ${want.toFixed(0)}`);
  }
  const total = (n) => Object.values(n).reduce((a, b) => a + b, 0);
  const easy = tally(DIFFICULTY.easy.events);
  const insane = tally(DIFFICULTY.insane.events);
  assert.ok(Math.abs(total(easy) / total(normal) - 0.5) < 0.05, 'Easy: half as often');
  assert.ok(Math.abs(total(insane) / total(normal) - 1.5) < 0.08, 'Insane: half again as often');
  // Pure: the same seed and month draw the same.
  for (let m = 0; m < 50; m++) assert.equal(eventDraw('x', m), eventDraw('x', m));
});

// ---------------------------------------------------------------------------
// Rome's wage
// ---------------------------------------------------------------------------

test('Rome\'s wage: a rise from 34 by 4 stops at 36, a cut from 13 by 4 stops at the floor of 12', () => {
  const game = newGame({ events: true });
  assert.equal(romeWage(game), CONFIG.BASE_WAGE, 'Rome starts at the base wage');
  game.city.romeWage = 34;
  assert.ok(applyEvent(game, 'wageUp', 4));
  assert.equal(game.city.romeWage, ROME_WAGE_MAX);
  assert.match(lastMessage(game).text, /^Rome raises its wages to 36 Dn a year/);
  assert.equal(eventCondition(game, 'wageUp'), false, 'no rise above the cap');
  game.city.romeWage = 13;
  assert.ok(applyEvent(game, 'wageDown', 4));
  assert.equal(game.city.romeWage, ROME_WAGE_MIN, 'clamped after the cut (the original fell below its floor)');
  assert.match(lastMessage(game).text, /^Rome cuts its wages to 12 Dn a year/);
  assert.equal(eventCondition(game, 'wageDown'), false);
  // Worked example: Rome 30 + 3 in the original is 24 + 3 here; the city's own wage is untouched.
  game.city.romeWage = 24;
  applyEvent(game, 'wageUp', 3);
  assert.equal(game.city.romeWage, 27);
  assert.equal(game.city.wage, CONFIG.DEFAULT_WAGE);
  assert.equal(lastMessage(game).level, 'warn', 'the city now pays less than Rome');
});

test('Rome\'s wage is what the mood and prosperity measure the city\'s wage against', () => {
  const game = newGame();
  game.city.wage = 24;
  game.city.romeWage = 24;
  assert.equal(computeSentiment(game).wages, 0);
  game.city.romeWage = 27;
  assert.ok(Math.abs(computeSentiment(game).wages - -2.4) < 1e-9, '3 Dn under Rome: -2.4 mood');
  game.city.romeWage = 20;
  assert.ok(Math.abs(computeSentiment(game).wages - 3.2) < 1e-9, '4 Dn over Rome: +3.2');
});

// ---------------------------------------------------------------------------
// The monthly draw: switches, conditions, cooldowns
// ---------------------------------------------------------------------------

test('the monthly draw: a drawn event happens when switched on, and then cools down', () => {
  const game = newGame({ events: true });
  const m = monthDrawing(game.seed, 'wageUp');
  game.time.totalMonths = m;
  assert.equal(randomEventMonth(game), 'wageUp');
  assert.ok(game.city.romeWage > CONFIG.BASE_WAGE && game.city.romeWage <= CONFIG.BASE_WAGE + 4);
  assert.equal(game.city.events.cooldowns.wages, m);
  assert.equal(game.city.events.counts.wageUp, 1);
  // A wage draw 11 months after the last wage change is skipped (rise or
  // cut: one cooldown), 12 months after it comes.
  const next = monthDrawing(game.seed, 'wageDown', 1, m + 1);
  const wage = game.city.romeWage;
  game.time.totalMonths = next;
  game.city.events.cooldowns.wages = next - (WAGE_COOLDOWN - 1);
  assert.equal(randomEventMonth(game), null);
  assert.equal(game.city.romeWage, wage);
  game.city.events.cooldowns.wages = next - WAGE_COOLDOWN;
  assert.equal(randomEventMonth(game), 'wageDown');
  assert.ok(game.city.romeWage < wage);
});

test('the monthly draw: switched off (sandbox setup, mission, URL flag) or impossible, nothing happens', () => {
  const off = newGame(); // (the test helper's sandbox has its Events switch off)
  const m = monthDrawing(off.seed, 'wageUp');
  off.time.totalMonths = m;
  assert.equal(randomEventMonth(off), null);
  assert.equal(off.city.romeWage, CONFIG.BASE_WAGE);
  const flagged = newGame({ events: true });
  flagged.flags.events = 'off';
  flagged.time.totalMonths = m;
  assert.equal(eventSwitchedOn(flagged, 'wageUp'), false);
  assert.equal(randomEventMonth(flagged), null);
  // Figlina (c3) has only the clay pit: a wage draw does nothing there.
  const c3 = new Game({ scenario: findScenario('c3'), flags: {} });
  assert.equal(eventSwitchedOn(c3, 'clay'), true);
  assert.equal(eventSwitchedOn(c3, 'wageUp'), false);
  // On: the condition must hold too (no clay pit, no collapse).
  const on = newGame({ events: true });
  on.time.totalMonths = monthDrawing(on.seed, 'clay');
  assert.equal(randomEventMonth(on), null, 'no clay pit to flood');
  assert.equal(on.city.events.cooldowns.clay, undefined, 'and nothing cools down');
});

test('Easy and Insane wait 36 and 12 months before the same event comes again', () => {
  for (const [d, wait] of [['easy', 36], ['insane', 12]]) {
    const game = newGame({ events: true, difficulty: d });
    const s = findFree(game, 2, 2);
    addBuilding(game, 'clay_pit', s.x, s.y);
    addBuilding(game, 'clay_pit', s.x + 2, s.y);
    const f = DIFFICULTY[d].events;
    const m = monthDrawing(game.seed, 'clay', f);
    game.time.totalMonths = m;
    game.city.events.cooldowns.clay = m - (wait - 1);
    assert.equal(randomEventMonth(game), null, `${d}: ${wait - 1} months after the last`);
    game.city.events.cooldowns.clay = m - wait;
    assert.equal(randomEventMonth(game), 'clay', `${d}: ${wait} months after`);
    assert.equal(game.city.events.cooldowns.clay, m);
    // Each event cools down on its own: a clay pit lost holds back no mine.
    assert.equal(game.city.events.cooldowns.mine, undefined);
  }
});

// ---------------------------------------------------------------------------
// Trade disruptions
// ---------------------------------------------------------------------------

test('a land disruption: no caravan sets out for 48 days, the wait runs on, and only with an open land route', () => {
  const game = newGame({ events: true });
  assert.equal(eventCondition(game, 'land'), false, 'no open land route');
  assert.ok(openRoute(game, 'capua').ok);
  assert.equal(eventCondition(game, 'land'), true);
  const r = game.city.trade.routes.capua;
  game.runDays(1);
  const start = game.time.totalDays;
  assert.ok(applyEvent(game, 'land'));
  assert.match(lastMessage(game).text, /^Landslides close the mountain roads: no caravan will set out for your city until /);
  assert.ok(tradeHaltText(game, 'land'));
  assert.equal(tradeHalted(game, 'sea'), false, 'ships are not stopped');
  // Due on every day: the caravan would try to set out (and, with no
  // warehouse, turn back with a warning). While stopped, nobody tries.
  let tried = 0;
  for (let d = 0; d < TRADE_HALT_DAYS + 2; d++) {
    const halted = tradeHalted(game, 'land');
    assert.equal(halted, game.time.totalDays < start + TRADE_HALT_DAYS, `day ${d}`);
    r.nextVisit = game.time.totalDays;
    game.city.flags.noWarehouseWarned = false;
    updateTrade(game);
    if (game.city.flags.noWarehouseWarned) tried++;
    if (halted) assert.ok(r.nextVisit > game.time.totalDays, 'the wait is drawn again: that visit is lost');
    game.time.totalDays++;
  }
  assert.equal(tried, 2, 'caravans set out again on day 48');
  // Worked example: Martius day 5 + 48 days ends in Iunius.
  const g2 = newGame({ events: true });
  openRoute(g2, 'capua');
  Object.assign(g2.time, { month: 2, day: 5 });
  applyEvent(g2, 'land');
  assert.match(lastMessage(g2).text, /until Iunius 300 BC\.$/);
});

test('a sea disruption needs an open sea route and a staffed Emporium; a desert map has sandstorms', () => {
  const game = newGame({ events: true, type: 'coast', seed: 'sea-halt' });
  game.cheats.freeBuild = true;
  assert.ok(openRoute(game, 'massilia').ok);
  assert.equal(eventCondition(game, 'sea'), false, 'no Emporium');
  const s = findFree(game, 3, 3);
  const dock = addBuilding(game, 'dock', s.x, s.y);
  dock.efficiency = 0;
  assert.equal(eventCondition(game, 'sea'), false, 'no staff');
  dock.efficiency = 1;
  assert.equal(eventCondition(game, 'sea'), true);
  assert.ok(applyEvent(game, 'sea'));
  assert.match(lastMessage(game).text, /^Storms keep the merchant ships in port/);
  assert.equal(tradeHalted(game, 'sea'), true);
  assert.equal(tradeHalted(game, 'land'), false);
  const desert = newGame({ events: true, type: 'desert', seed: 'dunes' });
  openRoute(desert, 'capua');
  applyEvent(desert, 'land');
  assert.match(lastMessage(desert).text, /^Sandstorms close the caravan roads/);
});

test('Neptune\'s wrath: with a sea route, ships under sail sink and none sails for 80 days; a moored ship rides it out', () => {
  const game = newGame({ type: 'coast', seed: 'neptune-sea', size: 96 });
  game.cheats.freeBuild = true;
  const e = game.map.seaEntry;
  assert.ok(e, 'the coast reaches the sea');
  const at = game.map.idx(e.x, e.y);
  const sailing = spawnWalker(game, 'ship', at, null, { partner: 'massilia', state: 'toDock', target: 0 });
  const moored = spawnWalker(game, 'ship', at, null, { partner: 'massilia', state: 'docked', target: 0 });
  /** Neptune strikes (sim/religion.js), and only he. */
  const wrath = () => {
    game.city.population = 1000;
    for (const g of GOD_KEYS) game.city.gods[g].cooldown = 99;
    Object.assign(game.city.gods.neptune, { cooldown: 0, mood: 0 });
    updateReligion(game);
  };
  wrath();
  assert.ok(game.walkers.has(sailing.id) && !tradeHalted(game, 'sea'), 'no sea route open: trade untouched');
  assert.ok(openRoute(game, 'massilia').ok);
  wrath();
  assert.ok(!game.walkers.has(sailing.id), 'the ship under sail sank');
  assert.ok(game.walkers.has(moored.id), 'the moored one did not');
  assert.equal(game.city.events.seaUntil, game.time.totalDays + NEPTUNE_HALT_DAYS);
  assert.match(lastMessage(game).text, /A merchant ship goes down with its cargo, and no ship will sail for your city for 5 months\./);
});

// ---------------------------------------------------------------------------
// Bad water, mines and clay pits
// ---------------------------------------------------------------------------

test('bad water: health 85 falls to 35 (and 70 to 30, 50 to 25), only in a city of 200 or more', () => {
  const game = newGame({ events: true });
  setPop(game, 150);
  assert.equal(eventCondition(game, 'water'), false, 'too small');
  setPop(game, 250);
  assert.equal(eventCondition(game, 'water'), true);
  for (const [from, to] of [[85, 35], [70, 30], [50, 25], [10, 0]]) {
    game.city.health.value = from;
    assert.ok(applyEvent(game, 'water'));
    assert.equal(game.city.health.value, to, `from ${from}`);
  }
  assert.match(lastMessage(game).text, /^Bad water: .* City health falls from 10 to 0/);
  assert.equal(lastMessage(game).level, 'bad');
});

test('a mine collapses, a clay pit floods: the oldest one, into rubble that remembers it, with a message at it', () => {
  for (const [key, type] of [['mine', 'iron_mine'], ['clay', 'clay_pit']]) {
    const game = newGame({ events: true, seed: `lost-${key}` });
    assert.equal(eventCondition(game, key), false);
    const s = findFree(game, 6, 2);
    const first = addBuilding(game, type, s.x, s.y);
    const second = addBuilding(game, type, s.x + 3, s.y);
    assert.ok(applyEvent(game, key));
    assert.ok(!game.buildings.has(first.id) && game.buildings.has(second.id), 'the first placed goes');
    const i = game.map.idx(first.x, first.y);
    assert.equal(game.map.rubble[i], 1);
    assert.equal(game.ruins.get(i).cause, 'collapse');
    const m = lastMessage(game);
    assert.equal(m.x, first.x);
    assert.equal(m.y, first.y);
    assert.equal(m.kind, 'collapse', 'the auto-pause\'s collapse switch stops for it');
    assert.match(m.text, key === 'mine' ? /iron mine .* has collapsed/ : /clay pit .* flooded/);
  }
});

// ---------------------------------------------------------------------------
// Scheduled events
// ---------------------------------------------------------------------------

test('a new Caesar: favor 82 becomes 50 (and 12 becomes 50) in the scheduled month, with a message', () => {
  const s = findScenario('c5p');
  assert.deepEqual([...missionEvents(s).emperor], [3]);
  const game = new Game({ scenario: s, flags: {} });
  const at = eventMonth(game.seed, 'emperor', 0, 3);
  const [a, b] = EVENT_MONTHS.emperor;
  assert.ok(at >= 24 + a && at <= 24 + b, 'in its third year, Februarius to September');
  game.city.ratings.favor = 82;
  game.time.totalMonths = at - 1;
  scheduledEventsMonth(game);
  assert.equal(game.city.ratings.favor, 82, 'not yet');
  game.time.totalMonths = at;
  scheduledEventsMonth(game);
  assert.equal(game.city.ratings.favor, 50);
  assert.match(lastMessage(game).text, /^A new Caesar rules in Rome\. .*favor 82 becomes 50/);
  assert.equal(lastMessage(game).level, 'imperial');
  game.city.ratings.favor = 12;
  scheduledEventsMonth(game);
  assert.equal(game.city.ratings.favor, 50, 'a new emperor forgives');
});

test('a price change: Figlina\'s pottery is 20% dearer both ways from its month on, with news that month', () => {
  const s = findScenario('c3');
  const game = new Game({ scenario: s, flags: {} });
  const at = eventMonth(game.seed, 'price', 0, 2);
  assert.ok(at >= 12 + 2 && at <= 12 + 9, 'its second year, Martius to October');
  assert.equal(scheduledFactor(s, game.seed, at - 1, 'pottery'), 1);
  assert.equal(scheduledFactor(s, game.seed, at, 'pottery'), 1.2);
  assert.equal(scheduledFactor(s, game.seed, at, 'clay'), 1, 'other goods unchanged');
  const partner = s.partners[0];
  game.time.totalMonths = at - 1;
  const before = { buy: tradePrice(game, partner, 'pottery', 'buy'), sell: tradePrice(game, partner, 'pottery', 'sell') };
  game.time.totalMonths = at;
  // (Same mission year: the year's drift is the same.)
  assert.equal(tradePrice(game, partner, 'pottery', 'buy'), priceWith(s, game.seed, 1, partner, 'pottery', 'buy', at));
  const ratio = (side) => tradePrice(game, partner, 'pottery', side) / before[side];
  assert.ok(Math.abs(ratio('buy') - 1.2) < 0.02 && Math.abs(ratio('sell') - 1.2) < 0.02, 'both ways');
  const n = game.messages.length;
  scheduledEventsMonth(game);
  assert.equal(game.messages.length, n + 1);
  assert.match(lastMessage(game).text, /pottery is in demand .* rises 20% with every partner/);
  // The sandbox has none, and the events=off flag stops this one too.
  assert.equal(scheduledFactor(sandboxScenario({}), 'x', 999, 'pottery'), 1);
  game.flags.events = 'off';
  assert.equal(tradePrice(game, partner, 'pottery', 'buy'), priceWith(s, game.seed, 1, partner, 'pottery', 'buy', at - 1));
});

// ---------------------------------------------------------------------------
// The earthquake
// ---------------------------------------------------------------------------

/** A demo town with a quake started in it (sizes: data/events.js QUAKE_SIZES). */
function quakeTown(seed = 'quake-town', size = 'medium') {
  const game = newGame({ seed, size: 96 });
  assert.ok(buildDemoCity(game, { level: 1 }).ok);
  game.runDays(4);
  const rockBefore = game.map.terrain.filter((t) => t === Terrain.ROCK).length;
  const fixed = [];
  for (let i = 0; i < game.map.size; i++) if (game.map.fixedRoad[i]) fixed.push(i);
  const buildings = game.buildings.size;
  const q = startQuake(game, size);
  return { game, q, rockBefore, fixed, buildings };
}

/** Run until the quake is over; days it took. */
function runOut(game) {
  let days = 0;
  while (game.city.events.quake && days < 100) { game.runDays(1); days++; }
  return days;
}

test('earthquake: a medium one tries 100 to 163 steps at 6 a day, turns what it crosses to rock and reports its losses', () => {
  const { game, q, rockBefore, fixed } = quakeTown();
  assert.ok(q, 'the town is struck');
  assert.ok(q.tries >= 100 && q.tries <= 163, `${q.tries} tries`);
  assert.equal(q.perDay, 6);
  const start = lastMessage(game);
  assert.match(start.text, /^Earthquake! The ground splits open near/);
  assert.equal(start.x, q.x);
  assert.equal(start.kind, 'collapse');
  assert.equal(game.map.terrain[game.map.idx(q.x, q.y)], Terrain.ROCK, 'the point is struck at once');
  const days = runOut(game);
  assert.ok(Math.abs(days - q.tries / 6) <= 1, `${days} days for ${q.tries} tries`);
  const struck = game.map.terrain.filter((t) => t === Terrain.ROCK).length - rockBefore;
  assert.ok(struck > 10 && struck <= q.tries + 1, `${struck} tiles struck`);
  for (let i = 0; i < game.map.size; i++) {
    if (game.map.terrain[i] !== Terrain.ROCK) continue;
    assert.equal(game.map.building[i], 0, 'nothing stands on rock');
    assert.equal(game.map.road[i], Road.NONE);
    assert.equal(game.map.aqueduct[i], 0);
    assert.equal(game.map.rubble[i], 0);
  }
  for (const i of fixed) assert.ok(game.map.fixedRoad[i] && game.map.road[i] && game.map.terrain[i] !== Terrain.ROCK, 'the Imperial road\'s ends hold');
  for (const i of q.keep) assert.ok(game.map.road[i] && game.map.terrain[i] !== Terrain.ROCK, 'and the road between them');
  const end = lastMessage(game);
  assert.match(end.text, /^The earth is still\. /);
  assert.equal(end.x, q.x);
  assert.equal(game.city.events.counts.quake, 1);
  assert.equal(game.city.events.counts.quakeLost, q.lost);
  assert.ok(q.lost > 0, 'a medium quake through a town takes buildings');
  assert.match(end.text, new RegExp(`${q.lost} buildings? w`));
  // A building it broke that stood on more than the crack: rubble that remembers the quake.
  assert.ok([...game.ruins.values()].some((r) => r.cause === 'quake'), 'quake rubble');
});

test('earthquake: the Imperial road from entry to exit holds through every quake, however large', () => {
  // Mapgen marks only the road's two end tiles fixed; a crack across the
  // rest would leave rock no road can be built on, cutting the city off.
  let crossed = 0;
  for (const [seed, size] of [['road-a', 'large'], ['road-b', 'large'], ['road-c', 'medium'], ['road-d', 'large'], ['road-e', 'medium'], ['road-f', 'large']]) {
    const { game, q } = quakeTown(seed, size);
    const { map } = game;
    const ends = [map.idx(map.entry.x, map.entry.y), map.idx(map.exit.x, map.exit.y)];
    assert.ok(q.keep.length > 10 && q.keep[0] === ends[0] && q.keep.at(-1) === ends[1], `${seed}: the road is kept, end to end`);
    runOut(game);
    assert.ok(game.pf.roadPath(ends[0], ends[1]), `${seed}: entry to exit by road after the quake`);
    // The cracks did reach the road (they pass under it), or this proves nothing.
    if (q.arms.some((a) => q.keep.includes(map.idx(a.x, a.y))) || q.keep.some((i) => [1, -1, map.w, -map.w].some((d) => map.terrain[i + d] === Terrain.ROCK))) crossed++;
  }
  assert.ok(crossed >= 2, `the cracks reached the road in ${crossed} of 6 quakes`);
});

test('earthquake: desirability is redone after every strike, so a loaded game agrees with the live one', () => {
  const { game } = quakeTown('quake-des', 'medium');
  let compared = 0;
  while (game.city.events.quake) {
    game.runDays(1);
    if (game.dirty.des) continue; // (redone tomorrow)
    const copy = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
    assert.deepEqual([...game.map.desirability], [...copy.map.desirability], `day ${game.time.totalDays}`);
    compared++;
  }
  assert.ok(compared > 5, `${compared} days compared`);
});

test('earthquake: four cracks lean north, east, south and west, and never cross water', () => {
  const { game, q } = quakeTown('quake-arms', 'large');
  runOut(game);
  const [n, e, s, w] = q.arms;
  assert.ok(n.y < q.y && e.x > q.x && s.y > q.y && w.x < q.x, `the cracks end ${JSON.stringify(q.arms)} from ${q.x},${q.y}`);
  assert.equal(game.city.events.quake, null);
});

test('earthquake: the same seed shakes the same; save mid-quake and load: it ends the same', () => {
  const a = quakeTown('quake-save');
  const b = quakeTown('quake-save');
  assert.deepEqual({ ...a.q }, { ...b.q }, 'the same point and tries');
  a.game.runDays(5);
  const mid = deserializeGame(JSON.parse(JSON.stringify(serializeGame(a.game))));
  assert.ok(mid.city.events.quake, 'still shaking after the load');
  assert.deepEqual(mid.city.events.quake, a.game.city.events.quake);
  runOut(a.game);
  runOut(mid);
  runOut(b.game);
  assert.deepEqual([...mid.map.terrain], [...a.game.map.terrain], 'the loaded game cracks the same tiles');
  assert.deepEqual([...b.game.map.terrain], [...a.game.map.terrain], 'determinism');
});

test('earthquake: none without a city; its point is land near the middle of the buildings', () => {
  const empty = newGame({ events: true });
  assert.equal(startQuake(empty, 'small'), null, 'nothing to strike');
  const { game, q } = quakeTown('quake-point', 'small');
  let sx = 0;
  let sy = 0;
  let n = 0;
  // (The point was drawn before the strike; the middle moved little since.)
  for (const b of game.buildings.values()) { sx += b.x + b.size / 2; sy += b.y + b.size / 2; n++; }
  assert.ok(Math.abs(q.x - sx / n) <= 8 && Math.abs(q.y - sy / n) <= 8, 'near the middle');
  assert.equal(startQuake(game, 'small'), null, 'one at a time');
  const p = quakePoint(game, new RNG('p'));
  assert.notEqual(game.map.terrain[game.map.idx(p.x, p.y)], Terrain.WATER);
  // A small quake: 25 to 56 tries at 5 a day.
  assert.ok(q.tries >= 25 && q.tries <= 56 && q.perDay === 5);
  // Undo is off while it shakes.
  assert.equal(game.lastUndo, null);
});

test('earthquake: a mission\'s quake starts in its scheduled month (Puteoli\'s large one in year 8)', () => {
  const s = findScenario('c10p');
  assert.deepEqual(missionEvents(s).quake, { year: 8, size: 'large' });
  const game = new Game({ scenario: s, flags: { unlockall: true, money: 50000 } });
  assert.ok(buildDemoCity(game, { level: 1 }).ok);
  const at = eventMonth(game.seed, 'quake', 0, 8);
  assert.ok(at >= 7 * 12 + 2 && at <= 7 * 12 + 9);
  game.time.totalMonths = at - 1;
  eventsMonthly(game);
  assert.equal(game.city.events.quake, null);
  game.time.totalMonths = at;
  scheduledEventsMonth(game);
  assert.equal(game.city.events.quake?.size, 'large');
  const off = new Game({ scenario: s, flags: { unlockall: true, money: 50000, events: 'off' } });
  buildDemoCity(off, { level: 1 });
  off.time.totalMonths = at;
  scheduledEventsMonth(off);
  assert.equal(off.city.events.quake, null, 'the events=off flag stops scheduled events too');
});

// ---------------------------------------------------------------------------
// Saves and the game's own random stream
// ---------------------------------------------------------------------------

test('save: Rome\'s wage, cooldowns and trade stopped load as saved; a save without them loads with the defaults', () => {
  const game = newGame({ events: true });
  openRoute(game, 'capua');
  applyEvent(game, 'land');
  applyEvent(game, 'wageUp', 3);
  const text = JSON.stringify(serializeGame(game));
  const copy = deserializeGame(JSON.parse(text));
  const data = JSON.parse(text); // (a game keeps the save's city object: a separate parse for the old-save case)
  assert.equal(copy.city.romeWage, 27);
  assert.equal(tradeHalted(copy, 'land'), true);
  assert.deepEqual(copy.city.events, game.city.events);
  // A save from before events: the Game fills in the defaults.
  delete data.city.romeWage;
  delete data.city.events;
  const old = deserializeGame(data);
  assert.equal(romeWage(old), CONFIG.BASE_WAGE);
  assert.deepEqual(old.city.events, newEventState());
  // The upgrade the release wires at version 23 fills only what is missing:
  // a save made by this code before the bump (still tagged 22) keeps its events.
  upgradeEventsV22(copy);
  assert.equal(copy.city.romeWage, 27);
  assert.equal(tradeHalted(copy, 'land'), true);
  delete copy.city.romeWage;
  delete copy.city.events;
  upgradeEventsV22(copy);
  assert.equal(copy.city.romeWage, CONFIG.BASE_WAGE);
  assert.deepEqual(copy.city.events, newEventState());
  // A broken quake record is dropped, not left to break the tick.
  const bad = JSON.parse(JSON.stringify(serializeGame(game)));
  bad.city.events.quake = { arms: [1, 2] };
  const fixed = deserializeGame(bad);
  assert.equal(fixed.city.events.quake, null);
  fixed.runDays(1);
});

test('events never draw from the game\'s random stream: a month with nothing to happen leaves it as it was', () => {
  const game = newGame({ events: true });
  const state = JSON.stringify(game.rng.getState());
  const next = game.rng.next;
  game.rng.next = () => { throw new Error('the game\'s stream was read'); };
  for (let m = 0; m < 400; m++) {
    game.time.totalMonths = m;
    // Wage events change state but draw nothing from the game: count them out.
    game.city.events.cooldowns.wages = m;
    eventsMonthly(game);
  }
  game.rng.next = next;
  assert.equal(JSON.stringify(game.rng.getState()), state);
});

test('a sandbox with its Events switch off plays exactly as one before events: the same city after two years', () => {
  const run = (scenarioEvents, flags = {}) => {
    const s = sandboxScenario({ size: 64, seed: 'same-city', invasions: 'none' });
    if (scenarioEvents !== undefined) s.events = scenarioEvents;
    const game = new Game({ scenario: s, flags: { unlockall: true, money: 50000, ...flags } });
    buildDemoCity(game, { level: 2 });
    game.runDays(DPM * 24);
    return { pop: game.city.population, treasury: game.city.treasury, rng: JSON.stringify(game.rng.getState()), events: game.city.events.counts, wage: game.city.romeWage };
  };
  const off = run(false);
  const flagged = run(undefined, { events: 'off' });
  assert.deepEqual(flagged, off, 'the URL flag and the setup switch are the same');
  assert.deepEqual(off.events, {});
  assert.equal(off.wage, CONFIG.BASE_WAGE);
  const on = run(true);
  assert.ok(Object.keys(on.events).length > 0, 'with events on, something came in two years');
});

test('the sandbox setup\'s switch is kept in the scenario a sandbox save holds', () => {
  const s = sandboxScenario({ size: 64, seed: 'kept' });
  s.events = false;
  const game = new Game({ scenario: s, flags: { unlockall: true } });
  const copy = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  assert.equal(copy.scenario.events, false);
  assert.equal(eventSwitchedOn(copy, 'wageUp'), false);
  // Campaign missions are unchanged by the difficulty copy.
  assert.deepEqual(missionEvents(withDifficulty(findScenario('c7p'), 'hard')).quake, { year: 4, size: 'medium' });
  assert.ok(SCENARIOS.length > 0);
});

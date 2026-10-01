/**
 * battle.test.mjs - distant battles (sim/battle.js), the threatened cities
 * (data/battles.js), triumphal arches (sim/construction.js checkArch) and the
 * save upgrade for Caesar's legions and his wars (core/save.js), from the
 * rules spec's worked examples.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { SCENARIOS } from '../src/data/scenarios.js';
import { THREATENED_CITIES, THREATENED_IDS, marchLine, marchMonths, enemyWords } from '../src/data/battles.js';
import { isLand } from '../src/data/empireGeo.js';
import { addBuilding, removeBuilding } from '../src/sim/entities.js';
import { spawnUnit } from '../src/sim/military.js';
import {
  requestTroops, requestMonth, battleMonthly, sendTroops, sendBlocked, setService, serviceUnits, strengthOf,
  stepMarch, projectedToGo, lossShare, advantageOf, fightBattle, archesToBuild, awayCounts, awayUpkeep, battleSummary,
} from '../src/sim/battle.js';
import { checkArch, checkRoadblock, planAction } from '../src/sim/construction.js';
import { collapseBuilding, igniteBuilding } from '../src/sim/risk.js';
import { ruinAt } from '../src/sim/ruins.js';
import { updateDesirability } from '../src/sim/desirability.js';
import { legionSummary } from '../src/sim/legion.js';
import { battleLines, serviceNote } from '../src/ui/empireInfo.js';
import { empireTravelers, travelerLabel } from '../src/ui/empireMap.js';
import { Road } from '../src/world/map.js';
import { newGame, build, findFree } from './helpers.mjs';

log.setLevel('error');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A legion fort with `n` legionaries (`trained` of them trained) standing by it, its Empire service on. */
function fortWith(game, n, trained = 0, type = 'fort_legion') {
  const s = findFree(game, 3, 3, { x: 30, y: 30 });
  const fort = addBuilding(game, type, s.x, s.y);
  fort.efficiency = 1;
  for (let k = 0; k < n; k++) spawnUnit(game, fort.def.unit, s.x + 1.5, s.y + 3.5, { fort: fort.id, slot: k, state: 'idle', trained: k < trained });
  setService(game, fort, true);
  return fort;
}

/** Run until every soldier sent has left the province (they march to the map exit). */
function untilGone(game, max = 16 * 20) {
  for (let d = 0; d < max; d++) {
    if (![...game.units.values()].some((u) => u.away)) return d;
    game.runDays(1);
  }
  return -1;
}

/** Run month changes only (the battle's clock), with a fresh month each call. */
function months(game, n) {
  for (let k = 0; k < n; k++) {
    game.time.totalMonths++;
    battleMonthly(game);
  }
}

// ---------------------------------------------------------------------------
// The cities and the request
// ---------------------------------------------------------------------------

test('threatened cities: on land, their ways over land or sea, a few months\' march each', () => {
  for (const id of THREATENED_IDS) {
    const c = THREATENED_CITIES[id];
    assert.ok(isLand(c.pos), `${c.name} is on land`);
    const line = marchLine(id);
    for (const p of line.slice(1, -1)) assert.equal(isLand(p), c.route === 'land', `${c.name}: way point ${p.map((v) => v.toFixed(1))} ${c.route === 'land' ? 'on land' : 'at sea'}`);
    const m = marchMonths(id);
    assert.ok(m >= CONFIG.BATTLE_MIN_MONTHS && m <= 12, `${c.name}: ${m} months`);
    assert.ok(c.enemyMonths >= 4);
  }
  assert.equal(enemyWords(16), 'a small army');
  assert.equal(enemyWords(28), 'a large army');
  assert.equal(enemyWords(52), 'a mighty host');
  // From mission 4, which has forts; every city named exists.
  for (const s of SCENARIOS) {
    const n = Number(s.id.slice(1));
    assert.equal(!!s.distantBattles, n >= 4, `${s.id}`);
    for (const e of s.distantBattles || []) assert.ok(THREATENED_CITIES[e.city] && e.enemy > 0 && e.year >= 1);
  }
});

test('a scheduled request comes in its year, in a month from Martius to October drawn from the seed; one in progress drops the next', () => {
  const game = newGame();
  game.scenario.distantBattles = [{ year: 3, city: 'placentia', enemy: 16 }, { year: 3, city: 'ariminum', enemy: 20 }];
  const m0 = requestMonth(game, 0);
  assert.ok(m0 >= 2 && m0 <= 9);
  assert.equal(requestMonth(game, 0), m0, 'the same draw every time');
  game.time.totalMonths = 24 + m0 - 1;
  battleMonthly(game);
  assert.equal(game.military.battle, null, 'not yet');
  game.time.totalMonths = 24 + m0;
  battleMonthly(game);
  const b = game.military.battle;
  assert.ok(b);
  assert.equal(b.city, 'placentia');
  assert.equal(b.due, 24 + m0 + 24, 'the battle 24 months later');
  assert.equal(game.messages.filter((m) => /Caesar calls for troops/.test(m.text)).length, 1);
  // The second event of the same year finds a battle going on: dropped for good.
  const m1 = requestMonth(game, 1);
  game.time.totalMonths = 24 + m1;
  battleMonthly(game);
  assert.equal(game.military.battle.city, 'placentia');
});

test('the sandbox with raids on: a rare request from year 3, only to a city with an army; none with raids off', () => {
  const count = (invasions, army = 'fort') => {
    const game = newGame({ invasions, type: army === 'fleet' ? 'coast' : 'river', seed: 'demo' });
    if (army === 'fort') fortWith(game, 2, 0);
    if (army === 'fleet') {
      const st = addBuilding(game, 'naval_station', 5, 5);
      const e = game.map.seaEntry;
      spawnUnit(game, 'liburnian', e.x + 0.5, e.y + 0.5, { station: st.id, slot: 0, state: 'berthed' });
    }
    let n = 0;
    for (let m = 0; m < 24 + 360; m++) {
      game.time.totalMonths = m;
      battleMonthly(game);
      if (game.military.battle) {
        assert.ok(m >= CONFIG.SANDBOX_BATTLE_FROM, 'never before year 3');
        if (army === 'fleet') assert.equal(THREATENED_CITIES[game.military.battle.city].route, 'sea', 'a fleet alone is asked only for a city by the sea');
        n++;
        game.military.battle = null; // (as if fought and over)
        game.military.battles.lastEndMonth = m;
      }
    }
    return n;
  };
  const n = count('occasional');
  assert.ok(n >= 3 && n <= 20, `about one every three years over 30 years: ${n}`);
  assert.equal(count('none'), 0);
  assert.equal(count('occasional', 'none'), 0, 'a city with no soldiers and no ships is never asked (nor fined 50 favor)');
  assert.ok(count('occasional', 'fleet') >= 1, 'a fleet alone answers for cities by the sea');
});

// ---------------------------------------------------------------------------
// Sending, strength and the march
// ---------------------------------------------------------------------------

test('strength: every man of the forts switched on, trained men counting more', () => {
  const game = newGame();
  fortWith(game, 4, 2); // 2 x 3 + 2 x 2 = 10
  const archers = fortWith(game, 3, 1, 'fort_archer'); // 2 + 1 + 1 = 4
  const home = fortWith(game, 8, 0);
  setService(game, home, false); // stays home
  requestTroops(game, 'placentia', 16);
  const men = serviceUnits(game, 'placentia');
  assert.equal(men.length, 7);
  assert.equal(strengthOf(men), 14);
  assert.equal(battleSummary(game).ready.strength, 14);
  setService(game, archers, false);
  assert.equal(strengthOf(serviceUnits(game, 'placentia')), 10);
});

test('liburnians count on a sea route (4, 6 trained), not on a land route', () => {
  const game = newGame({ type: 'coast', seed: 'demo' });
  assert.ok(game.map.seaEntry, 'a coast map has water from the sea');
  fortWith(game, 2, 1); // 3 + 2
  const st = addBuilding(game, 'naval_station', 5, 5);
  setService(game, st, true);
  const e = game.map.seaEntry;
  for (let k = 0; k < 2; k++) spawnUnit(game, 'liburnian', e.x + 0.5, e.y + 0.5, { station: st.id, slot: k, state: 'berthed', trained: k === 0, body: game.map.navBody[game.map.idx(e.x, e.y)] });
  assert.equal(strengthOf(serviceUnits(game, 'saguntum')), 5 + 6 + 4, 'by sea: the squadron goes');
  assert.equal(strengthOf(serviceUnits(game, 'placentia')), 5, 'by land: soldiers only');
});

test('sending: once, only with soldiers switched on; they march out by the exit and their places are kept', () => {
  const game = newGame();
  const fort = fortWith(game, 8, 8);
  setService(game, fort, false);
  assert.match(sendBlocked(game), /no troops/);
  requestTroops(game, 'placentia', 16);
  assert.match(sendBlocked(game), /switch forts/);
  setService(game, fort, true);
  assert.equal(sendBlocked(game), '');
  const res = sendTroops(game);
  assert.ok(res.ok);
  assert.equal(res.strength, 24);
  assert.match(sendBlocked(game), /already on their way/);
  assert.ok(untilGone(game) >= 0, 'all left the province');
  const b = game.military.battle;
  assert.equal(b.sent.men.length, 8);
  assert.equal([...game.units.values()].filter((u) => u.fort === fort.id).length, 0);
  assert.equal(awayCounts(game).get(fort.id), 8, 'their places kept');
});

test('the march: the spec\'s late-but-in-time example (enemy 8 months off, Rome 6, 4 months left)', () => {
  // Saguntum's enemy marches 8 months; the troops' own march is set to 6 here.
  const b = { city: 'saguntum', due: 20, sent: { toGo: 6, march: 6 } };
  assert.equal(THREATENED_CITIES.saguntum.enemyMonths, 8);
  const at = (m) => ({ time: { totalMonths: m } });
  assert.equal(projectedToGo(b, 16), 1, 'in time');
  stepMarch(at(17), b);
  assert.equal(b.sent.toGo, 4, 'month 1: 5 against the enemy\'s 2, so two months nearer');
  stepMarch(at(18), b);
  assert.equal(b.sent.toGo, 2);
  stepMarch(at(19), b);
  assert.equal(b.sent.toGo, 1, 'held at 1: arrived, waiting');
  // Too late: sent with 2 months left, they are 4 away at the battle.
  const late = { city: 'saguntum', due: 20, sent: { toGo: 6, march: 6 } };
  stepMarch(at(19), late);
  assert.equal(late.sent.toGo, 4);
  assert.equal(projectedToGo({ city: 'saguntum', due: 20, sent: null }, 18, 6), 4);
});

test('losses on a win, by the margin; the unreachable 5% and 0% rows are gone', () => {
  assert.equal(advantageOf(96, 60), 37);
  assert.equal(lossShare(37), 0.25, 'example 1: 25%');
  assert.equal(advantageOf(90, 90), 0);
  assert.equal(lossShare(0), 0.7, 'a tie wins, at 70%');
  assert.equal(lossShare(9), 0.7);
  assert.equal(lossShare(10), 0.5);
  assert.equal(lossShare(50), 0.15);
  assert.equal(lossShare(99), 0.1, 'the best a battle against any enemy can do');
});

// ---------------------------------------------------------------------------
// The battle
// ---------------------------------------------------------------------------

/** A battle with troops sent and gone, `toGo` months off when it is fought now. */
function readyBattle({ men = 8, trained = 8, enemy = 16, city = 'placentia' } = {}) {
  const game = newGame();
  const fort = fortWith(game, men, trained);
  requestTroops(game, city, enemy);
  sendTroops(game);
  untilGone(game);
  return { game, fort, b: game.military.battle };
}

test('a battle won: +25 favor, an arch earned, a quarter lost, the rest home after the months they marched', () => {
  const { game, fort, b } = readyBattle({ men: 8, trained: 8, enemy: 16 }); // 24 against 16: 33, 25%
  game.city.ratings.favor = 40;
  b.sent.toGo = 1;
  fightBattle(game);
  assert.equal(b.outcome, 'won');
  assert.equal(game.city.ratings.favor, 65);
  assert.equal(game.city.archesEarned, 1);
  assert.equal(archesToBuild(game), 1);
  assert.equal(b.sent.men.length, 6, '2 of 8 fell (8 x 25%)');
  assert.equal(game.military.stats.soldiersLost, 2);
  assert.equal(b.phase, 'returning');
  assert.equal(b.homeIn, b.sent.march - 1);
  const lines = battleLines(game, battleSummary(game));
  assert.match(lines[0].text, /Victory at Placentia/);
  months(game, b.homeIn);
  assert.equal(game.military.battle, null, 'home, and the battle is over');
  const back = [...game.units.values()].filter((u) => u.fort === fort.id);
  assert.equal(back.length, 6);
  assert.ok(back.every((u) => u.trained), 'still trained');
  assert.equal(new Set(back.map((u) => u.slot)).size, 6, 'each in his own place');
  assert.equal(game.military.battles.won, 1);
});

test('too weak: -10 favor, every man sent is lost, the city falls for two years', () => {
  const { game, fort, b } = readyBattle({ men: 8, trained: 0, enemy: 20 }); // 16 < 20
  game.city.ratings.favor = 40;
  b.sent.toGo = 1;
  fightBattle(game);
  assert.equal(b.outcome, 'weak');
  assert.equal(game.city.ratings.favor, 30);
  assert.equal(game.city.archesEarned, 0);
  assert.equal(b.sent.men.length, 0);
  assert.equal(game.military.stats.soldiersLost, 8);
  assert.equal(awayCounts(game).get(fort.id) || 0, 0, 'the fort can be filled again');
  assert.equal(b.phase, 'foreign');
  assert.equal(b.foreignLeft, CONFIG.BATTLE_FOREIGN_MONTHS);
  months(game, CONFIG.BATTLE_FOREIGN_MONTHS);
  assert.equal(game.military.battle, null, 'retaken');
});

test('too late: -25 favor, the troops come home unharmed after the months they marched', () => {
  const { game, fort, b } = readyBattle({ men: 8, trained: 8, enemy: 10 });
  game.city.ratings.favor = 40;
  b.sent.toGo = 3;
  fightBattle(game);
  assert.equal(b.outcome, 'late');
  assert.equal(game.city.ratings.favor, 15);
  assert.equal(b.sent.men.length, 8, 'unharmed');
  assert.equal(b.homeIn, Math.max(1, b.sent.march - 3), 'the months they had covered (at least one)');
  months(game, b.homeIn);
  assert.equal([...game.units.values()].filter((u) => u.fort === fort.id).length, 8);
  assert.equal(game.military.battle.phase, 'foreign', 'the city is lost all the same');
});

test('nobody sent: -50 favor, which alone can start Caesar\'s march', () => {
  const game = newGame();
  requestTroops(game, 'messana', 30);
  game.city.ratings.favor = 60;
  game.time.totalMonths = game.military.battle.due - 1;
  months(game, 1);
  assert.equal(game.military.battle.outcome, 'none');
  assert.equal(game.city.ratings.favor, 10);
  game.runDays(1);
  assert.equal(legionSummary(game).state, 'marching', 'favor 10: the legions set out');
});

test('the whole way in the game: request, send, march, battle, home', () => {
  const game = newGame();
  const fort = fortWith(game, 8, 4); // 4 x 3 + 4 x 2 = 20
  requestTroops(game, 'placentia', 16);
  sendTroops(game);
  for (let m = 0; m < CONFIG.BATTLE_MONTHS + 6 && game.military.battle; m++) game.runDays(CONFIG.DAYS_PER_MONTH);
  assert.equal(game.military.battle, null, 'fought and home');
  assert.equal(game.military.battles.won, 1);
  assert.equal(game.city.archesEarned, 1);
  // 20 against 16: 20, half lost.
  assert.equal([...game.units.values()].filter((u) => u.fort === fort.id).length, 4);
});

test('the empire map shows the enemy, the troops and the threatened city', () => {
  const game = newGame();
  fortWith(game, 8, 8);
  requestTroops(game, 'placentia', 16);
  let t = empireTravelers(game);
  const enemy = t.find((x) => x.kind === 'enemy');
  assert.ok(enemy);
  assert.match(travelerLabel(enemy), /The army of the Gauls marching on Placentia: the battle in 24 months/);
  sendTroops(game);
  t = empireTravelers(game);
  const troops = t.find((x) => x.kind === 'troops');
  assert.ok(troops);
  assert.match(travelerLabel(troops), /Your troops \(strength 24\) on the way to Placentia/);
});

// ---------------------------------------------------------------------------
// Triumphal arches
// ---------------------------------------------------------------------------

/** A straight east-west road 12 tiles long on open land; returns its west end. */
function straightRoad(game) {
  const s = findFree(game, 14, 7, { x: 32, y: 32 });
  assert.ok(s, 'room for a road');
  build(game, 'road', s.x, s.y + 3, s.x + 13, s.y + 3);
  return { x: s.x, y: s.y + 3 };
}

test('the arch: free, 3x3, desirability 18 falling by 3 every 2 tiles over 5', () => {
  const d = BUILDINGS.triumphal_arch;
  assert.deepEqual([d.size, d.cost, d.kind, d.workers], [3, 0, 'arch', 0]);
  assert.deepEqual(d.des, [18, 2, -3, 5]);
});

test('the arch goes across a straight road, which runs on under it; one for each battle won', () => {
  const game = newGame({ type: 'plains' });
  const r = straightRoad(game);
  assert.match(checkArch(game, 'triumphal_arch', r.x + 4, r.y - 1).reason, /Caesar grants one/);
  assert.equal(game.isUnlocked('triumphal_arch'), false, 'not in the build menu yet');
  game.city.archesEarned = 1;
  assert.equal(game.isUnlocked('triumphal_arch'), true);
  // Off the road, and with the road along its edge: refused.
  assert.match(checkArch(game, 'triumphal_arch', r.x + 4, r.y - 5).reason, /across a straight road/);
  assert.match(checkArch(game, 'triumphal_arch', r.x + 4, r.y).reason, /across a straight road/);
  // A crossroads under it: refused.
  build(game, 'road', r.x + 9, r.y - 2, r.x + 9, r.y + 2);
  assert.match(checkArch(game, 'triumphal_arch', r.x + 8, r.y - 1).reason, /Only the road through its middle/);
  // Across the road (anchored on the road's middle tile): built, the road kept.
  const ok = checkArch(game, 'triumphal_arch', r.x + 3, r.y - 1);
  assert.ok(ok.ok, ok.reason);
  assert.equal(ok.axis, 0, 'the road runs along x');
  const res = build(game, 'triumphal_arch', r.x + 4, r.y); // (held by its middle tile)
  assert.ok(res.ok);
  const arch = [...game.buildings.values()].find((b) => b.type === 'triumphal_arch');
  assert.ok(arch);
  assert.equal(arch.axis, 0);
  const { map } = game;
  for (let dx = 0; dx < 3; dx++) assert.equal(map.road[map.idx(r.x + 3 + dx, r.y)], Road.ROAD, 'the road runs on under it');
  game.processRoadChanges();
  assert.equal(map.roadNet[map.idx(r.x, r.y)], map.roadNet[map.idx(r.x + 13, r.y)], 'one street from end to end');
  assert.ok(game.pf.roadPath(map.idx(r.x, r.y), map.idx(r.x + 7, r.y)), 'walkers pass under it');
  assert.equal(archesToBuild(game), 0);
  assert.equal(game.isUnlocked('triumphal_arch'), false);
  // Lost: the right comes back, the road stays.
  removeBuilding(game, arch);
  assert.equal(archesToBuild(game), 1);
  assert.equal(map.road[map.idx(r.x + 4, r.y)], Road.ROAD);
});

test('an arch along a north-south road turns with it, and its rings fall off', () => {
  const game = newGame({ type: 'plains' });
  const s = findFree(game, 7, 14, { x: 32, y: 32 });
  build(game, 'road', s.x + 3, s.y, s.x + 3, s.y + 13);
  game.city.archesEarned = 1;
  updateDesirability(game);
  const before = Float32Array.from(game.map.desirability);
  const ok = checkArch(game, 'triumphal_arch', s.x + 2, s.y + 5);
  assert.ok(ok.ok, ok.reason);
  assert.equal(ok.axis, 1);
  assert.ok(build(game, 'triumphal_arch', s.x + 3, s.y + 6).ok);
  updateDesirability(game);
  const gain = (dist) => game.map.desirability[game.map.idx(s.x + 4 + dist, s.y + 6)] - before[game.map.idx(s.x + 4 + dist, s.y + 6)];
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(gain), [18, 18, 15, 15, 12, 0]);
});

/** An arch built across a straight east-west road; returns it and the road's west end. */
function archOnRoad() {
  const game = newGame({ type: 'plains' });
  const r = straightRoad(game);
  game.city.archesEarned = 1;
  assert.ok(build(game, 'triumphal_arch', r.x + 4, r.y).ok);
  const arch = [...game.buildings.values()].find((b) => b.type === 'triumphal_arch');
  return { game, r, arch };
}

test('a wrecked arch leaves its road clear: rubble, flames and a ruin only on its six side tiles', () => {
  for (const fall of ['collapse', 'fire']) {
    const { game, r, arch } = archOnRoad();
    const { map } = game;
    if (fall === 'collapse') collapseBuilding(game, arch, 'legion');
    else igniteBuilding(game, arch, 'legion');
    for (let dx = 3; dx <= 5; dx++) {
      const i = map.idx(r.x + dx, r.y);
      assert.equal(map.road[i], Road.ROAD, `${fall}: the road stays`);
      assert.equal(map.rubble[i], 0, `${fall}: no rubble on the road`);
      assert.equal(game.fires.has(i), false, `${fall}: no flames on the road`);
      assert.equal(ruinAt(game, i), null);
      assert.equal(map.rubble[map.idx(r.x + dx, r.y - 1)], 1, `${fall}: rubble beside it`);
    }
    assert.equal(archesToBuild(game), 1, 'and the right to build it again');
  }
});

test('no plaza and no roadblock on the road under a standing arch', () => {
  const { game, r } = archOnRoad();
  const plan = planAction(game, 'plaza', r.x + 3, r.y, r.x + 5, r.y);
  assert.equal(plan.count, 0, 'the arch\'s road is not paved');
  assert.match(checkRoadblock(game, r.x + 4, r.y).reason, /Not under a building/);
  assert.equal(checkRoadblock(game, r.x + 8, r.y).ok, true, 'the open road still takes one');
});

test('a fort lost while its men are away: they are released, unpaid, and the message says so', () => {
  const { game, fort } = readyBattle({ men: 8, trained: 0, enemy: 10 });
  assert.equal(awayUpkeep(game), 8 * 2);
  removeBuilding(game, fort);
  assert.equal(awayUpkeep(game), 0, 'no pay for men with no post to come back to');
  assert.equal(awayCounts(game).get(fort.id) || 0, 0);
  assert.equal(game.military.battle.sent.men.length, 0);
  assert.ok(game.messages.some((m) => /away at a distant battle are released from service/.test(m.text)));
  // Their strength still fights the battle: won, no one to come home.
  game.military.battle.sent.toGo = 1;
  fightBattle(game);
  assert.equal(game.military.battle, null, 'won, and over');
});

test('the service note gives the right reason a squadron cannot go', () => {
  const game = newGame({ type: 'coast', seed: 'demo' });
  const st = addBuilding(game, 'naval_station', 5, 5);
  requestTroops(game, 'placentia', 16);
  assert.match(serviceNote(game, st), /not by the sea/);
  game.military.battle = null;
  requestTroops(game, 'saguntum', 16);
  assert.equal(serviceNote(game, st), '', 'by the sea, with water to it: it can');
  game.map.seaEntry = null;
  assert.match(serviceNote(game, st), /No water from here reaches the sea/);
});

// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

test('save: a battle under way, troops away, a legion marching and an arch earned survive a save', () => {
  const { game, fort } = readyBattle({ men: 8, trained: 4, enemy: 16 });
  game.city.archesEarned = 2;
  game.city.ratings.favor = 5;
  game.runDays(1);
  assert.equal(legionSummary(game).state, 'marching');
  const copy = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  assert.deepEqual(copy.military.battle, game.military.battle);
  assert.deepEqual(copy.military.caesar, game.military.caesar);
  assert.equal(copy.city.archesEarned, 2);
  assert.equal(copy.buildings.get(fort.id).service, true);
  assert.equal(awayCounts(copy).get(fort.id), 8);
});

test('save: a real version 13 save at favor 0 loads with nothing pending, every switch off, its population peak starting again from today, and plays on', () => {
  // Written by the code before Caesar's legions (save version 13): a sandbox
  // town with forts at favor 0, which recalled the governor then.
  const raw = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/save-v13-favor-zero.json'), 'utf8'));
  assert.equal(raw.version, 13);
  assert.equal(raw.military.caesar, undefined);
  const saved = { pop: raw.city.population, peak: raw.city.stats.peakPopulation }; // (the loader takes the raw city as it is)
  const game = deserializeGame(raw);
  const m = game.military;
  assert.equal(m.caesar.countdown, 0);
  assert.equal(m.caesar.army, null);
  assert.equal(m.caesar.attacks, 0);
  assert.equal(m.battle, null);
  assert.equal(game.city.archesEarned, 0);
  assert.ok(saved.peak > saved.pop, 'the fixture had shrunk from its peak');
  assert.equal(game.city.stats.peakPopulation, Math.max(saved.pop, game.city.population), 'the peak starts again at today\'s population: no loss to a rule the save never knew');
  const posts = [...game.buildings.values()].filter((b) => b.def.kind === 'fort' || b.def.kind === 'station');
  assert.ok(posts.length > 0);
  assert.ok(posts.every((b) => b.service === false));
  assert.ok([...game.units.values()].every((u) => !u.away));
  // Favor 0: no recall; the next day the legions set out.
  let lost = false;
  game.events.on('defeat', () => { lost = true; });
  game.runDays(1);
  assert.equal(lost, false);
  assert.equal(legionSummary(game).state, 'marching');
});

test('save: a version 11 save loads the same way', () => {
  const raw = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/save-v11-gift-sent.json'), 'utf8'));
  const game = deserializeGame(raw);
  assert.equal(game.military.battle, null);
  assert.equal(game.military.caesar.countdown, 0);
  assert.equal(game.city.archesEarned, 0);
  assert.equal(game.city.stats.peakPopulation >= game.city.population, true);
});

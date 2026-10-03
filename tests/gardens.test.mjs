/**
 * gardens.test.mjs - gardens and statues fade untended (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Covers sim/gardens.js and what it touches: the Topiaria (Gardeners' Yard)
 * and its gardener; a garden's or statue's care fading after a month of
 * grace, a step every 20 days to a floor of 25%, and never below; a visit
 * restoring it; desirability marked for a new pass only when a step changes;
 * no fading where the mission has no yard; plazas, the triumphal arch, the
 * residences and the Oracle never fading; the difficulty lever; saves (the
 * v24 upgrade, a round trip, a hand-edited step); the capacity model's
 * yards; the overlay and the panel's words; the untended look.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { Game } from '../src/core/game.js';
import { BUILDINGS, TOOLS, buildingsInCategory } from '../src/data/buildings.js';
import { WALKER_TYPES, roadblockBit } from '../src/data/walkers.js';
import { DIFFICULTY } from '../src/data/difficulty.js';
import { SCENARIOS, findScenario, withDifficulty } from '../src/data/scenarios.js';
import { addBuilding, spawnWalker } from '../src/sim/entities.js';
import { startRoaming, streetNeed } from '../src/sim/movement.js';
import { roamerVisit } from '../src/sim/services.js';
import { updateDesirability, desScale } from '../src/sim/desirability.js';
import { careApplies, careStepFor, careScale, updateCare, tendDecoration, careNeed, careInfo, YARD_TYPE } from '../src/sim/gardens.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { planCity, SENSIBLE } from '../src/sim/capacity.js';
import { overlayByKey } from '../src/render/overlays.js';
import { careText, careNote, careTip } from '../src/ui/gardenInfo.js';
import { artState } from '../src/render/buildingArt.js';
import { buildingKey } from '../src/render/renderer.js';
import { newGame as smallGame, build, findFree } from './helpers.mjs';

log.setLevel('error');

const TENDED = ['garden', 'statue_small', 'statue_medium', 'statue_large'];

/** A sandbox on open plains, with room for the layouts below. */
const newGame = (opts = {}) => smallGame({ size: 96, type: 'plains', ...opts });

/** A decoration on open land, its last visit `days` ago (its step not yet updated). */
function decoration(game, type = 'garden', days = 0) {
  const spot = findFree(game, BUILDINGS[type].size + 4, BUILDINGS[type].size + 4);
  const b = addBuilding(game, type, spot.x + 2, spot.y + 2);
  b.tendedDay = game.time.totalDays - days;
  return b;
}

/** A campaign mission's game, with its unlocks changed by `edit`. */
function missionGame(id, edit = (u) => u, difficulty = 'normal') {
  const s = withDifficulty(findScenario(id), difficulty);
  return new Game({ scenario: { ...s, unlocks: edit([...s.unlocks]) }, flags: { money: 50000 } });
}

// ---------------------------------------------------------------------------
// The yard and its gardener
// ---------------------------------------------------------------------------

test('gardens: the Topiaria, a small upkeep yard beside the gardens and statues, sends a Topiarius', () => {
  const d = BUILDINGS[YARD_TYPE];
  assert.deepEqual([d.name, d.en, d.category, d.size, d.cost, d.workers, d.labor, d.walker, d.needsRoad], ['Topiaria', 'Gardeners\' Yard', 'government', 1, 35, 4, 'engineering', 'gardener', true]);
  assert.equal(BUILDINGS.engineer_post.labor, d.labor, 'in the engineers\' labor category: upkeep');
  // In the build menu right after the statues.
  const menu = buildingsInCategory('government').map((it) => it.key);
  assert.equal(menu.indexOf(YARD_TYPE), menu.indexOf('statue_large') + 1);
  const w = WALKER_TYPES.gardener;
  assert.deepEqual([w.kind, w.effect, w.group], ['roamer', 'tend', 'maintenance']);
  assert.equal(w.name, 'Topiarius (Gardener)');
  assert.equal(roadblockBit('gardener'), roadblockBit('engineer'), 'a roadblock treats him as it treats prefects and engineers');
});

test('gardens: only the garden and the three statues are tended; plazas, the arch, the residences and the Oracle never fade', () => {
  const tended = Object.keys(BUILDINGS).filter((k) => BUILDINGS[k].tended);
  assert.deepEqual(tended, TENDED);
  for (const k of ['oracle', 'triumphal_arch', 'governor_house', 'governor_villa', 'governor_palace']) assert.ok(!BUILDINGS[k].tended, k);
  assert.ok(!TOOLS.plaza.tended);
  // A step on any of them (a hand edit) changes nothing: only the tended scale.
  const game = newGame({ seed: 'never-fade' });
  for (const k of ['oracle', 'triumphal_arch']) {
    const b = decoration(game, k, 999);
    b.careStep = 4;
    updateCare(game, b);
    assert.equal(careScale(b), 1, k);
    assert.equal(desScale(b), 1, k);
  }
  const palace = decoration(game, 'governor_palace', 999);
  palace.efficiency = 1;
  palace.careStep = 4;
  assert.equal(desScale(palace), 1, 'a residence follows its servants alone');
});

test('gardens: a plaza and an arch give the same desirability after a year untended', () => {
  const game = newGame({ seed: 'plaza-fade' });
  const spot = findFree(game, 16, 9);
  build(game, 'road', spot.x, spot.y + 4, spot.x + 15, spot.y + 4);
  build(game, 'plaza', spot.x + 1, spot.y + 4, spot.x + 3, spot.y + 4);
  const arch = addBuilding(game, 'triumphal_arch', spot.x + 9, spot.y + 3);
  arch.axis = 0;
  updateDesirability(game);
  const before = Array.from(game.map.desirability);
  game.runDays(CONFIG.DAYS_PER_MONTH * 12);
  updateDesirability(game);
  const near = [];
  for (let y = spot.y; y < spot.y + 9; y++) for (let x = spot.x; x < spot.x + 16; x++) near.push(game.map.idx(x, y));
  assert.deepEqual(near.map((i) => game.map.desirability[i]), near.map((i) => before[i]));
});

// ---------------------------------------------------------------------------
// Fading and tending
// ---------------------------------------------------------------------------

test('gardens: full for a month, then a step down every 20 days to 25%, and never below', () => {
  const game = newGame({ seed: 'fade' });
  const g = decoration(game, 'garden');
  const at = (days) => {
    g.tendedDay = game.time.totalDays - days;
    updateCare(game, g);
    return Math.round(careScale(g) * 100);
  };
  assert.deepEqual([0, 16, 35, 36, 55, 56, 75, 76, 95, 96, 200, 5000].map(at), [100, 100, 100, 80, 80, 60, 60, 40, 40, 25, 25, 25]);
  assert.deepEqual(CONFIG.CARE_LEVELS, [100, 80, 60, 40, 25]);
});

test('gardens: in a running game an untended garden and statue fade to the floor and stay there', () => {
  const game = newGame({ seed: 'fade-run' });
  const g = decoration(game, 'garden');
  const s = decoration(game, 'statue_medium');
  game.runDays(30);
  assert.deepEqual([g.careStep, s.careStep], [0, 0], 'a month of grace');
  game.runDays(10);
  assert.deepEqual([g.careStep, s.careStep], [1, 1], '80% after 36 days');
  game.runDays(200);
  assert.deepEqual([g.careStep, s.careStep], [4, 4], 'the floor');
  assert.equal(careScale(s), 0.25);
});

test('gardens: desirability follows the care, ring by ring', () => {
  const game = newGame({ seed: 'fade-des' });
  const spot = findFree(game, 14, 14);
  const at = (dx) => game.map.desirability[(spot.y + 6) * game.map.w + spot.x + dx];
  updateDesirability(game);
  const base = [5, 4, 3, 2, 1].map(at);
  const statue = addBuilding(game, 'statue_medium', spot.x + 6, spot.y + 6);
  const rings = () => {
    updateDesirability(game);
    return [5, 4, 3, 2, 1].map((dx, k) => at(dx) - base[k]);
  };
  // West of the statue, rings 1 to 5: 10, 8, 6, 4, 2 tended.
  assert.deepEqual(rings(), [10, 8, 6, 4, 2]);
  statue.careStep = 2; // 60%
  assert.deepEqual(rings(), [6, 5, 4, 2, 1]);
  statue.careStep = 4; // the floor, 25%
  assert.deepEqual(rings(), [3, 2, 2, 1, 1]);
});

test('gardens: a gardener passing within 2 tiles restores full care at once', () => {
  const game = newGame({ seed: 'tend' });
  const spot = findFree(game, 12, 6);
  build(game, 'road', spot.x, spot.y + 2, spot.x + 11, spot.y + 2);
  const near = addBuilding(game, 'garden', spot.x + 5, spot.y + 4); // 2 tiles off the road
  const far = addBuilding(game, 'statue_small', spot.x + 9, spot.y + 5); // 3 tiles off
  for (const b of [near, far]) { b.tendedDay = game.time.totalDays - 120; updateCare(game, b); }
  assert.deepEqual([near.careStep, far.careStep], [4, 4]);
  const w = spawnWalker(game, 'gardener', game.map.idx(spot.x + 5, spot.y + 2), null, {});
  game.dirty.des = false;
  roamerVisit(game, w);
  assert.equal(near.careStep, 0);
  assert.equal(near.tendedDay, game.time.totalDays);
  assert.equal(game.dirty.des, true, 'a step changed: a new pass');
  assert.equal(far.careStep, 4, 'out of reach');
  // Tending one already at full marks nothing.
  game.dirty.des = false;
  tendDecoration(game, near);
  assert.equal(game.dirty.des, false);
});

test('gardens: a yard\'s gardener walks his road and tends the gardens beside it', () => {
  const game = newGame({ seed: 'tend-walk' });
  const spot = findFree(game, 20, 6);
  build(game, 'road', spot.x, spot.y + 2, spot.x + 19, spot.y + 2);
  const yard = addBuilding(game, YARD_TYPE, spot.x + 1, spot.y + 1);
  game.processRoadChanges();
  const gardens = [4, 9, 14, 18].map((dx) => addBuilding(game, 'garden', spot.x + dx, spot.y + 3));
  for (const g of gardens) g.tendedDay = game.time.totalDays - 200;
  const w = spawnWalker(game, 'gardener', yard.accessRoad, yard, {});
  startRoaming(game, w, 1);
  game.runDays(12);
  for (const g of gardens) assert.ok(game.time.totalDays - g.tendedDay < 12, `garden at ${g.x}: tended ${game.time.totalDays - g.tendedDay} days ago`);
});

test('gardens: desirability is marked for a new pass only when a step changes', () => {
  const game = newGame({ seed: 'fade-dirty' });
  const g = decoration(game, 'garden', 40);
  game.dirty.des = false;
  updateCare(game, g);
  assert.equal(g.careStep, 1);
  assert.equal(game.dirty.des, true, 'into the first step');
  game.dirty.des = false;
  g.tendedDay -= 10; // 50 days: still the first step
  updateCare(game, g);
  assert.equal(game.dirty.des, false, 'the same step: no new pass');
  // Over a whole year untended, only the steps' days ask for one.
  const h = decoration(game, 'statue_small');
  let marks = 0;
  for (let d = 0; d < 192; d++) {
    game.dirty.des = false;
    h.tendedDay -= 1;
    updateCare(game, h);
    if (game.dirty.des) marks++;
  }
  assert.equal(marks, 4, 'four steps down, four passes');
});

test('gardens: they never fade where the mission has no gardeners\' yard; with one they do', () => {
  const without = missionGame('c2', (u) => u.filter((k) => k !== YARD_TYPE));
  assert.equal(careApplies(without), false);
  assert.equal(without.isUnlocked('statue_small'), true);
  const s = decoration(without, 'statue_small', 500);
  updateCare(without, s);
  assert.equal(s.careStep, 0);
  assert.equal(careInfo(without, s).applies, false);
  assert.equal(careText(without, s), 'Needs no tending here');
  without.runDays(200);
  assert.equal(s.careStep, 0, 'still full after 200 days');
  // (Its daily update runs on its own tick of the day: yesterday's at the latest.)
  assert.ok(without.time.totalDays - s.tendedDay <= 1, `kept tended, so it never drops at once if the yard comes later (${without.time.totalDays - s.tendedDay} days)`);
  // The mission as it is has the yard, and there they fade.
  const withYard = missionGame('c2');
  assert.equal(careApplies(withYard), true);
  const t = decoration(withYard, 'statue_small', 500);
  updateCare(withYard, t);
  assert.equal(t.careStep, 4);
  assert.ok(careApplies(newGame()), 'the sandbox has it');
});

test('gardens: the yard comes with the garden in the campaign, from the first mission', () => {
  for (const s of SCENARIOS) {
    if (s.unlocks === 'all') continue;
    const decor = TENDED.some((k) => s.unlocks.includes(k));
    assert.equal(s.unlocks.includes(YARD_TYPE), decor, `${s.id}: the yard where there are gardens or statues`);
  }
  assert.ok(findScenario('c1').unlocks.includes(YARD_TYPE));
});

test('gardens: the difficulty lever sets the pace of fading, not the grace or the floor', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(DIFFICULTY).map(([k, d]) => [k, d.careFade])), { easy: 0.5, normal: 1, hard: 1, insane: 1.5 });
  const step = (difficulty, days) => {
    const game = newGame({ seed: 'lever', difficulty });
    return careStepFor(game, decoration(game, 'garden', days));
  };
  // 56 days: 40 past the grace. Normal 2 steps of 20, Easy 1 of 40, Insane 3 of 13.3.
  assert.deepEqual(['easy', 'normal', 'hard', 'insane'].map((d) => step(d, 56)), [1, 2, 2, 3]);
  assert.deepEqual(['easy', 'normal', 'insane'].map((d) => step(d, 16)), [0, 0, 0], 'the same month of grace');
  assert.deepEqual(['easy', 'normal', 'insane'].map((d) => step(d, 1000)), [4, 4, 4], 'the same floor');
  assert.equal(step('easy', 175), 3, 'Easy: the floor only after 176 days');
  assert.equal(step('easy', 176), 4);
});

test('gardens: a gardener is drawn to the way with the decorations longest untended', () => {
  const game = newGame({ seed: 'pull' });
  const g = decoration(game, 'garden', 0);
  assert.equal(careNeed(game, g), 0);
  g.tendedDay -= 8;
  assert.equal(careNeed(game, g), 0.5);
  g.tendedDay -= 100;
  assert.equal(careNeed(game, g), 1);
  // A T junction: the garden down the east arm, nothing down the west one.
  const spot = findFree(game, 21, 8);
  const y = spot.y + 2;
  build(game, 'road', spot.x, y, spot.x + 20, y);
  build(game, 'road', spot.x + 10, y, spot.x + 10, y + 5);
  const yard = addBuilding(game, YARD_TYPE, spot.x + 11, y + 4);
  const east = addBuilding(game, 'garden', spot.x + 15, y + 1);
  east.tendedDay = game.time.totalDays - 50;
  const w = spawnWalker(game, 'gardener', game.map.idx(spot.x + 10, y), yard, {});
  const eastNeed = streetNeed(game, w, spot.x + 11, y, 1);
  const westNeed = streetNeed(game, w, spot.x + 9, y, 3);
  assert.ok(eastNeed > 0.5 && westNeed === 0, `east ${eastNeed}, west ${westNeed}`);
});

// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

test('save: a v24 city loads with every garden and statue fully tended, last visited the day it loads', () => {
  const game = newGame({ seed: 'save-v24' });
  const g = decoration(game, 'garden');
  const s = decoration(game, 'statue_large');
  game.runDays(150);
  assert.equal(g.careStep, 4);
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  data.version = 24;
  for (const b of data.buildings) { delete b.tendedDay; delete b.careStep; }
  const copy = deserializeGame(data);
  for (const id of [g.id, s.id]) {
    const b = copy.buildings.get(id);
    assert.equal(b.careStep, 0);
    assert.equal(b.tendedDay, copy.time.totalDays);
  }
  // Their desirability is whole on load, and they fade from the load day on.
  copy.runDays(30);
  assert.equal(copy.buildings.get(g.id).careStep, 0);
  copy.runDays(10);
  assert.equal(copy.buildings.get(g.id).careStep, 1);
});

test('save: care survives a save; a hand-edited step out of range loads as tended', () => {
  const game = newGame({ seed: 'save-care' });
  const g = decoration(game, 'garden', 60);
  updateCare(game, g);
  assert.equal(g.careStep, 2);
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  assert.equal(data.version, CONFIG.SAVE_VERSION);
  assert.equal(CONFIG.SAVE_VERSION, 25);
  const copy = deserializeGame(JSON.parse(JSON.stringify(data)));
  const b = copy.buildings.get(g.id);
  assert.deepEqual([b.careStep, b.tendedDay], [2, g.tendedDay]);
  assert.deepEqual(Array.from(copy.map.desirability), Array.from((updateDesirability(game), game.map.desirability)), 'the same desirability after the load');
  const bad = JSON.parse(JSON.stringify(data));
  bad.buildings.find((x) => x.id === g.id).careStep = 99;
  const fixed = deserializeGame(bad).buildings.get(g.id);
  assert.equal(fixed.careStep, 0);
  assert.ok(Number.isFinite(careScale(fixed)));
  // A visit in the future (it would never fade) loads as tended today.
  const future = JSON.parse(JSON.stringify(data));
  future.buildings.find((x) => x.id === g.id).tendedDay = 1e15;
  const loaded = deserializeGame(future);
  assert.equal(loaded.buildings.get(g.id).tendedDay, loaded.time.totalDays);
});

// ---------------------------------------------------------------------------
// The capacity model, the overlay, the panel and the look
// ---------------------------------------------------------------------------

test('capacity: yards for the homes that need gardens and statues; none for a town of Huts', () => {
  const count = (p) => p.items.find((it) => it.key === YARD_TYPE)?.count || 0;
  assert.equal(count(planCity(findScenario('c1'), 300, SENSIBLE)), 0, 'Huts keep their level on bare land');
  // Mission 2's Townhouses (they need 8 to stay): 450 people on 28 tiles, a gardener's 30-tile round covering 60.
  assert.equal(count(planCity(findScenario('c2'), 450, SENSIBLE)), 1);
  const c7 = planCity(findScenario('c7'), 8200, SENSIBLE);
  assert.equal(count(c7), 7);
});

test('overlay: the Gardens and statues overlay stands each one by its care, with the gardeners', () => {
  const ov = overlayByKey('gardens');
  assert.equal(ov.key, 'gardens');
  assert.deepEqual(ov.walkers, ['gardener']);
  const game = newGame({ seed: 'overlay' });
  const g = decoration(game, 'garden', 60);
  updateCare(game, g);
  assert.deepEqual(ov.column(g, game).v, 0.6);
  assert.equal(ov.column(decoration(game, 'oracle'), game), null);
  assert.equal(ov.show(decoration(game, YARD_TYPE)), true);
  assert.equal(careTip(game, g), 'Untended: bonus at 60% (last tended 60 days ago)');
  assert.equal(careText(game, g), 'Untended: bonus at 60%');
  assert.match(careNote(game, g), /Last tended 60 days ago\. A month \(16 days\) after a visit its desirability starts to fade, a step every 20 days, down to 25%\./);
  assert.match(careNote(newGame({ seed: 'overlay', difficulty: 'insane' }), g), /a step about every 13 days/);
  tendDecoration(game, g);
  assert.equal(careText(game, g), 'Tended');
  assert.equal(careTip(game, g), 'Tended (last tended today)');
});

test('render: an untended garden or statue has a sprite of its own; a tended one keeps the old key', () => {
  const game = newGame({ seed: 'look' });
  const g = decoration(game, 'garden');
  assert.equal(artState(g), 0);
  const fresh = buildingKey(g, 0, artState(g));
  assert.equal(fresh, `b:garden:1:0:0`, 'as before gardens faded');
  g.careStep = 1;
  assert.equal(artState(g), 0, '80%: still looks kept');
  g.careStep = 2;
  assert.equal(artState(g), 1, '60% and less: dry and dull');
  assert.notEqual(buildingKey(g, 0, artState(g)), fresh);
});

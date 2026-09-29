/**
 * sandbox.test.mjs - headless tests for map sizes and difficulty (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Difficulty levels (data/difficulty.js), up to Insane: the table is complete
 * and ordered, every lever reaches the system it is meant to (money, fire
 * risk, mood, raids, raiders, the Emperor), campaign missions can be played
 * at any level and their saves remember it. Map sizes, up to Uber (256x256):
 * the map generates with a working entry road, and settlers with a long walk
 * ride in faster with a pack mule. Save size for Uber is in save.test.mjs.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log, parseFlags } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { Game } from '../src/core/game.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { DIFFICULTY, DIFFICULTY_ORDER, difficultyOf } from '../src/data/difficulty.js';
import { SCENARIOS, sandboxScenario, withDifficulty, findScenario } from '../src/data/scenarios.js';
import { UNIT_TYPES } from '../src/data/units.js';
import { MAP_SIZES, MAP_SIZE_NOTES } from '../src/world/mapgen.js';
import { raidSize, spawnUnit } from '../src/sim/military.js';
import { updateEmperor, scheduleNextRequest } from '../src/sim/emperor.js';
import { updateRisk } from '../src/sim/risk.js';
import { computeSentiment } from '../src/sim/population.js';
import { addBuilding } from '../src/sim/entities.js';
import { buildDemoCity } from '../src/dev/demoCity.js';
import { newGame, findFree } from './helpers.mjs';

log.setLevel('error');

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

test('difficulty: every level sets every lever, Normal is neutral, Insane is hardest', () => {
  const keys = Object.keys(DIFFICULTY.normal).sort();
  for (const [k, d] of Object.entries(DIFFICULTY)) {
    assert.deepEqual(Object.keys(d).sort(), keys, `${k} has every lever`);
    assert.ok(d.name && d.desc, `${k} has a name and description`);
  }
  for (const [k, v] of Object.entries(DIFFICULTY.normal)) {
    if (typeof v === 'number') assert.equal(v, k === 'mood' ? 0 : 1, `normal.${k}`);
  }
  assert.deepEqual(DIFFICULTY_ORDER, ['easy', 'normal', 'hard', 'insane']);
  // Levers where less is harder, and where more is harder.
  const lessIsHarder = ['funds', 'production', 'immigration', 'mood', 'raidInterval', 'requestInterval', 'requestTime'];
  const moreIsHarder = ['risk', 'raidSize', 'enemy', 'requestSize'];
  for (let i = 1; i < DIFFICULTY_ORDER.length; i++) {
    const easier = DIFFICULTY[DIFFICULTY_ORDER[i - 1]];
    const harder = DIFFICULTY[DIFFICULTY_ORDER[i]];
    for (const k of lessIsHarder) assert.ok(harder[k] <= easier[k], `${harder.name}.${k} <= ${easier.name}.${k}`);
    for (const k of moreIsHarder) assert.ok(harder[k] >= easier[k], `${harder.name}.${k} >= ${easier.name}.${k}`);
  }
  assert.equal(difficultyOf('nope'), DIFFICULTY.normal);
});

test('difficulty: starting funds scale in the sandbox and the campaign', () => {
  assert.equal(sandboxScenario({ funds: 8000, difficulty: 'insane' }).funds, 3200);
  assert.equal(sandboxScenario({ funds: 8000, difficulty: 'easy' }).funds, 12000);
  assert.equal(sandboxScenario({ funds: 8000, difficulty: 'normal' }).funds, 8000);
  const c1 = SCENARIOS[0];
  const insane = withDifficulty(c1, 'insane');
  assert.equal(insane.funds, Math.round(c1.funds * 0.4));
  assert.equal(insane.difficulty, 'insane');
  assert.equal(insane.id, c1.id, 'still the same mission');
  assert.equal(c1.difficulty, undefined, 'the mission itself is not changed');
  assert.equal(withDifficulty(c1, 'normal'), c1);
  assert.equal(withDifficulty(c1, 'bogus'), c1);
  const game = new Game({ scenario: insane, flags: {} });
  assert.equal(game.difficultyKey, 'insane');
  assert.equal(game.difficulty, DIFFICULTY.insane);
  assert.equal(Math.round(game.city.treasury), insane.funds);
  // Unknown keys (hand-edited saves) play as Normal.
  assert.equal(new Game({ scenario: { ...c1, difficulty: 'bogus' }, flags: {} }).difficultyKey, 'normal');
});

test('difficulty: Insane raids come sooner, bigger and tougher; soldiers are unchanged', () => {
  const normal = newGame({ invasions: 'occasional' });
  const insane = newGame({ invasions: 'occasional', difficulty: 'insane' });
  assert.equal(normal.military.nextRaidMonth, 30);
  assert.equal(insane.military.nextRaidMonth, Math.round(30 * DIFFICULTY.insane.raidInterval));
  normal.city.population = 900;
  insane.city.population = 900;
  assert.ok(raidSize(insane) > raidSize(normal), `${raidSize(insane)} vs ${raidSize(normal)} raiders`);
  const raiderHp = UNIT_TYPES.raider.hp;
  assert.equal(spawnUnit(normal, 'raider', 5, 5).maxHp, raiderHp);
  const tough = spawnUnit(insane, 'raider', 5, 5);
  assert.equal(tough.maxHp, Math.round(raiderHp * DIFFICULTY.insane.enemy));
  assert.equal(tough.hp, tough.maxHp);
  const soldierType = Object.keys(UNIT_TYPES).find((k) => UNIT_TYPES[k].side === 'rome');
  assert.equal(spawnUnit(insane, soldierType, 6, 6).maxHp, UNIT_TYPES[soldierType].hp);
});

test('difficulty: the Insane Emperor asks for more, more often, with less time', () => {
  const make = (difficulty) => {
    const g = newGame({ difficulty, seed: 'emperor' });
    g.city.population = 1600;
    g.city.nextRequestMonth = 0;
    updateEmperor(g);
    return g;
  };
  const normal = make('normal');
  const insane = make('insane');
  const now = normal.time.totalMonths;
  assert.ok(normal.city.request && insane.city.request, 'both asked');
  // Same seed, same draws: the same kind of request, scaled.
  assert.equal(insane.city.request.kind, normal.city.request.kind);
  assert.ok(insane.city.request.amount >= normal.city.request.amount * 1.4, `${insane.city.request.amount} vs ${normal.city.request.amount}`);
  assert.equal(normal.city.request.deadline - now, CONFIG.REQUEST_DEADLINE_MONTHS);
  assert.equal(insane.city.request.deadline - now, Math.round(CONFIG.REQUEST_DEADLINE_MONTHS * DIFFICULTY.insane.requestTime));
  const [a, b] = CONFIG.REQUEST_INTERVAL_MONTHS;
  const k = DIFFICULTY.insane.requestInterval;
  for (let i = 0; i < 40; i++) {
    scheduleNextRequest(insane);
    const wait = insane.city.nextRequestMonth - insane.time.totalMonths;
    assert.ok(wait >= Math.round(a * k) && wait <= Math.round(b * k), `wait ${wait}`);
  }
});

test('difficulty: fire risk builds faster and Insane citizens are grumpier', () => {
  const grow = (difficulty) => {
    const g = newGame({ difficulty, seed: 'risk' });
    const spot = findFree(g, 2, 2);
    const b = addBuilding(g, 'pottery_ws', spot.x, spot.y);
    for (let d = 0; d < 20; d++) {
      updateRisk(g, b);
      if (b.fireRisk >= CONFIG.FIRE_THRESHOLD) break;
    }
    return b.fireRisk;
  };
  const ratio = grow('insane') / grow('normal');
  assert.ok(Math.abs(ratio - DIFFICULTY.insane.risk) < 0.01, `risk grows ${ratio.toFixed(2)}x`);

  const normal = newGame();
  const insane = newGame({ difficulty: 'insane' });
  assert.equal(computeSentiment(normal).difficulty, undefined, 'no difficulty row on Normal');
  assert.equal(computeSentiment(insane).difficulty, DIFFICULTY.insane.mood);
});

test('difficulty: campaign and sandbox saves remember it', () => {
  const campaign = new Game({ scenario: withDifficulty(findScenario('c1'), 'insane'), flags: {} });
  const data = JSON.parse(JSON.stringify(serializeGame(campaign)));
  assert.deepEqual(data.scenario, { id: 'c1' }, 'campaign saves store only the mission id');
  assert.equal(data.difficulty, 'insane');
  assert.equal(data.meta.difficulty, 'insane');
  const back = deserializeGame(data);
  assert.equal(back.difficultyKey, 'insane');
  assert.equal(back.scenario.funds, campaign.scenario.funds, 'Restart uses the same scaled funds');
  // Saves from before difficulty was stored load as Normal.
  delete data.difficulty;
  assert.equal(deserializeGame(data).difficultyKey, 'normal');

  const sandbox = newGame({ difficulty: 'hard' });
  assert.equal(deserializeGame(JSON.parse(JSON.stringify(serializeGame(sandbox)))).difficultyKey, 'hard');
});

test('difficulty: the difficulty= URL flag accepts known levels only', () => {
  assert.equal(parseFlags({ difficulty: 'insane' }).difficulty, 'insane');
  assert.equal(parseFlags({ difficulty: 'nightmare' }).difficulty, undefined);
  assert.equal(parseFlags({ map: 'uber' }).map, 'uber');
});

// ---------------------------------------------------------------------------
// Uber map
// ---------------------------------------------------------------------------

test('uber: the biggest map generates with an entry road and a note for the menu', () => {
  assert.equal(MAP_SIZES.uber, 256);
  for (const k of Object.keys(MAP_SIZES)) assert.ok(MAP_SIZE_NOTES[k], `${k} has a note`);
  const game = newGame({ size: MAP_SIZES.uber, seed: 'uber-gen' });
  const { map } = game;
  assert.equal(map.w, 256);
  assert.equal(map.h, 256);
  assert.ok(map.road[map.idx(map.entry.x, map.entry.y)], 'road at the entry');
  assert.ok(map.road[map.idx(map.exit.x, map.exit.y)], 'road at the exit');
  assert.equal(map.roadNet[map.idx(map.entry.x, map.entry.y)], map.roadNet[map.idx(map.exit.x, map.exit.y)], 'entry and exit connected');
});

test('uber: settlers with a long walk ride in faster, with a pack mule', () => {
  const far = newGame({ size: MAP_SIZES.uber, seed: 'uber-save', money: 90000 });
  assert.ok(buildDemoCity(far, { level: 1 }).ok);
  const near = newGame({ seed: 'near' });
  assert.ok(buildDemoCity(near, { level: 1 }).ok);
  const seen = { far: [], near: [] };
  for (let d = 0; d < 16 * 3; d++) {
    far.runDays(1);
    near.runDays(1);
    for (const [key, g] of [['far', far], ['near', near]]) {
      for (const w of g.walkers.values()) if (w.type === 'immigrant' && w.path) seen[key].push({ len: w.path.length, speed: w.speed, mule: !!w.mule });
    }
  }
  const long = seen.far.filter((s) => s.len > CONFIG.SETTLER_WALK_TILES);
  assert.ok(long.length > 0, 'Uber settlers had long trips');
  for (const s of long) {
    assert.ok(s.mule, 'long trips come with a mule');
    assert.ok(s.speed > CONFIG.WALKER_SPEED && s.speed <= CONFIG.WALKER_SPEED * CONFIG.SETTLER_MAX_SPEEDUP + 1e-9, `speed ${s.speed}`);
    // No trip takes much longer than a SETTLER_WALK_TILES walk (unless capped by the max speed-up).
    const ticks = s.len / s.speed;
    const cap = Math.max(CONFIG.SETTLER_WALK_TILES, s.len / CONFIG.SETTLER_MAX_SPEEDUP) / CONFIG.WALKER_SPEED;
    assert.ok(ticks <= cap + 1e-6, `${s.len} tiles in ${ticks.toFixed(0)} ticks`);
  }
  assert.ok(seen.near.length > 0, 'small-map settlers walked in too');
  for (const s of seen.near.filter((x) => x.len <= CONFIG.SETTLER_WALK_TILES)) {
    assert.ok(!s.mule && s.speed === CONFIG.WALKER_SPEED, 'short trips are on foot');
  }
});

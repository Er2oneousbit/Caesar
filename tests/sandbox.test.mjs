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
import { SCENARIOS, sandboxScenario, withDifficulty, findScenario, INVASION_PRESETS } from '../src/data/scenarios.js';
import { UNIT_TYPES } from '../src/data/units.js';
import { MAP_SIZES, MAP_SIZE_NOTES } from '../src/world/mapgen.js';
import { raidSize, spawnUnit } from '../src/sim/military.js';
import { updateEmperor, scheduleNextRequest } from '../src/sim/emperor.js';
import { updateRisk } from '../src/sim/risk.js';
import { computeSentiment } from '../src/sim/population.js';
import { addBuilding } from '../src/sim/entities.js';
import { updateProducer, farmDormant, farmSeasonNotice, daysToNextMare } from '../src/sim/production.js';
import { seasonOf, MONTH_NAMES } from '../src/sim/time.js';
import { seasonOf as renderSeasonOf } from '../src/render/weather.js';
import { buildingStatus } from '../src/ui/infoPanel.js';
import { updateReligion } from '../src/sim/religion.js';
import { HERD_START, HERD_GROWTH_DAYS } from '../src/data/units.js';
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
  // Multipliers are 1 on Normal; mood is in points (0), devolveDays in days
  // (3, the original game's rule), protestPeaceEvery a count (0: never) and
  // loanInterest a share (0.2: 20%).
  const normalValue = { mood: 0, devolveDays: 3, protestPeaceEvery: 0, loanInterest: 0.2 };
  for (const [k, v] of Object.entries(DIFFICULTY.normal)) {
    if (typeof v === 'number') assert.equal(v, normalValue[k] ?? 1, `normal.${k}`);
  }
  assert.deepEqual(DIFFICULTY_ORDER, ['easy', 'normal', 'hard', 'insane']);
  // Levers where less is harder, and where more is harder.
  const lessIsHarder = ['funds', 'production', 'winterGrowth', 'immigration', 'mood', 'raidInterval', 'requestInterval', 'requestTime', 'devolveDays'];
  const moreIsHarder = ['risk', 'raidSize', 'enemy', 'requestSize', 'crime', 'crimePeace', 'disease', 'loanInterest', 'winterTrade'];
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
  const first = INVASION_PRESETS.occasional.first;
  assert.equal(normal.military.nextRaidMonth, first);
  assert.equal(insane.military.nextRaidMonth, Math.round(first * DIFFICULTY.insane.raidInterval));
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

/**
 * A staffed, fully fertile farm of `type` in `game` (no road: it keeps its harvest),
 * with the calendar set to `month`.
 */
function winterFarm(game, type, month) {
  const spot = findFree(game, 3, 3);
  const b = addBuilding(game, type, spot.x, spot.y);
  b.fertility = 1;
  b.efficiency = 1;
  game.time.month = month;
  return b;
}

test('difficulty: only Insane farms rest in winter (December to Februarius)', () => {
  assert.equal(seasonOf(11), 'winter');
  assert.equal(renderSeasonOf, seasonOf, 'the map colors and the farms share one calendar');
  for (const key of DIFFICULTY_ORDER) {
    for (const month of [11, 0, 1]) {
      const game = newGame({ difficulty: key, seed: 'winter-farm' });
      const b = winterFarm(game, 'farm_wheat', month);
      b.progress = 40;
      for (let d = 0; d < 5; d++) updateProducer(game, b);
      if (key === 'insane') {
        assert.equal(b.progress, 40, `${MONTH_NAMES[month]} on Insane: progress kept, none added`);
        assert.ok(farmDormant(game, b));
        Object.assign(b, { accessRoad: 0, laborAccess: 1, noStorage: false }); // as if on a road, staffed
        assert.match(buildingStatus(game, b).text, /^Winter: nothing grows/);
      } else {
        assert.ok(b.progress > 40, `${MONTH_NAMES[month]} on ${key}: the farm grows`);
        assert.ok(!farmDormant(game, b));
      }
    }
  }
  // Other producers never rest.
  const insane = newGame({ difficulty: 'insane', seed: 'winter-farm' });
  insane.time.month = 0;
  const spot = findFree(insane, 2, 2);
  assert.ok(!farmDormant(insane, addBuilding(insane, 'pottery_ws', spot.x, spot.y)));
});

test('difficulty: Insane farms grow again from Martius and ship stored harvest all winter', () => {
  const game = newGame({ difficulty: 'insane', seed: 'winter-farm' });
  const b = winterFarm(game, 'farm_wheat', 1); // Februarius
  b.progress = 50;
  b.stock.wheat = 300;
  updateProducer(game, b);
  assert.equal(b.progress, 50);
  assert.equal(b.stock.wheat, 300, 'no harvest in winter, but nothing is lost');
  game.time.month = 2; // Martius
  updateProducer(game, b);
  assert.ok(b.progress > 50, 'spring: growing again');
  assert.ok(!farmDormant(game, b));
  // Every kind of farm rests, the ranch's herd included.
  for (const type of ['farm_veg', 'farm_fruit', 'farm_pig', 'farm_olive', 'farm_vine', 'horse_ranch']) {
    const g = newGame({ difficulty: 'insane', seed: `winter-${type}` });
    const f = winterFarm(g, type, 0);
    f.progress = 10;
    for (let d = 0; d < 40; d++) updateProducer(g, f);
    assert.equal(f.progress, 10, `${type} rests in winter`);
    if (f.herd !== undefined) assert.equal(f.herd, HERD_START, 'no new mares in winter');
  }
});

test('difficulty: the next-mare estimate counts the Insane winter rest, and matches the sim', () => {
  for (const difficulty of ['normal', 'insane']) {
    const g = newGame({ difficulty, seed: 'mare' });
    const ranch = winterFarm(g, 'horse_ranch', 10); // November: winter is two weeks off
    g.time.day = 8;
    ranch.herdDays = 0;
    const predicted = daysToNextMare(g, ranch);
    // Step the real calendar and the ranch's daily update until a mare is born.
    const herd0 = ranch.herd;
    let days = 0;
    while (ranch.herd === herd0 && days < 500) {
      for (let t = 0; t < CONFIG.TICKS_PER_DAY; t++) g.time.advance();
      ranch.efficiency = 1;
      updateProducer(g, ranch);
      days++;
    }
    assert.equal(predicted, days, `${difficulty}: predicted ${predicted}, took ${days}`);
    if (difficulty === 'normal') assert.equal(predicted, HERD_GROWTH_DAYS);
    else assert.ok(predicted > HERD_GROWTH_DAYS, 'the winter rest is counted');
  }
  const g = newGame({ difficulty: 'insane', seed: 'mare' });
  const idle = winterFarm(g, 'horse_ranch', 5);
  idle.efficiency = 0;
  assert.equal(daysToNextMare(g, idle), Infinity, 'an idle ranch never foals');
});

test('difficulty: a Ceres blessing still brings the harvest the next day, Insane winter or not', () => {
  for (const difficulty of ['normal', 'insane']) {
    const g = newGame({ difficulty, seed: 'ceres' });
    const field = winterFarm(g, 'farm_wheat', 0); // Ianuarius
    field.progress = 30;
    const ceres = g.city.gods.ceres;
    ceres.mood = 100; // a festival-happy goddess: blesses at this month's update
    ceres.cooldown = 0;
    updateReligion(g);
    assert.ok(g.messages.some((m) => /Ceres/.test(m.text)), `${difficulty}: blessed`);
    updateProducer(g, field); // the farm's next working day
    assert.equal(field.stock.wheat, CONFIG.CART_CAPACITY, `${difficulty}: harvested`);
  }
});

test('difficulty: over a real game year an Insane farm rests exactly the 48 winter days, with one notice each', () => {
  const game = newGame({ difficulty: 'insane', seed: 'winter-year' });
  const spot = findFree(game, 3, 3);
  const farm = addBuilding(game, 'farm_wheat', spot.x, spot.y);
  const said = [];
  game.events.on('message', (m) => said.push(`${m.date.split(' ')[0]}: ${m.text}`));
  let dormant = 0;
  const days = CONFIG.DAYS_PER_MONTH * CONFIG.MONTHS_PER_YEAR;
  for (let i = 0; i < days * CONFIG.TICKS_PER_DAY; i++) {
    game.tick();
    // (Game.tick moves the calendar before the buildings, so this is the month the farm saw.)
    if (game.time.tick === farm.phase && farmDormant(game, farm)) dormant++;
  }
  assert.equal(dormant, 3 * CONFIG.DAYS_PER_MONTH, 'Ianuarius, Februarius and December');
  const count = (re) => said.filter((t) => re.test(t)).length;
  assert.equal(count(/^Oct: Winter comes/), 1, said.join('\n'));
  assert.equal(count(/^Dec: Winter: the fields rest/), 1);
  assert.equal(count(/^Mar: Spring: the farms grow again/), 1);
  // The same year on Normal: no notices, no resting.
  const normal = newGame({ difficulty: 'normal', seed: 'winter-year' });
  const quiet = [];
  normal.events.on('message', (m) => quiet.push(m.text));
  normal.runDays(days);
  assert.equal(quiet.filter((t) => /farms|fields rest/.test(t)).length, 0);
});

test('difficulty: the Insane calendar warns before winter and cheers the spring', () => {
  const texts = (difficulty, month, starting = false) => {
    const g = newGame({ difficulty, seed: 'notice' });
    g.time.month = month;
    const before = g.messages.length;
    farmSeasonNotice(g, starting);
    return g.messages.slice(0, g.messages.length - before).map((m) => m.text);
  };
  assert.equal(texts('insane', 9).length, 1, 'October: winter is coming');
  assert.match(texts('insane', 9)[0], /import food/, 'the sandbox has partners that sell food');
  // Mission 1 has no trade partners: no advice to import.
  const c1 = new Game({ scenario: withDifficulty(findScenario('c1'), 'insane'), flags: {} });
  c1.time.month = 9;
  farmSeasonNotice(c1);
  assert.doesNotMatch(c1.messages[0].text, /import/);
  assert.match(texts('insane', 11)[0], /rest/);
  assert.match(texts('insane', 2)[0], /grow again/);
  assert.equal(texts('insane', 5).length, 0, 'nothing in summer');
  assert.equal(texts('insane', 0, true).length, 1, 'a new game starts in winter');
  for (const m of [0, 2, 9, 11]) assert.equal(texts('hard', m).length + texts('hard', m, true).length, 0, 'no notices on other levels');
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

test('raids leave time to build: no first raid inside 3 years on Normal, sandbox or campaign', () => {
  const firsts = [
    ...Object.entries(INVASION_PRESETS).filter(([, p]) => p).map(([k, p]) => [k, p.first]),
    ...SCENARIOS.filter((s) => s.military).map((s) => [s.id, s.military.first]),
  ];
  assert.ok(firsts.length >= 6);
  for (const [name, first] of firsts) assert.ok(first >= 36, `${name}: first raid after ${first} months`);
  assert.equal(INVASION_PRESETS.occasional.first, 96, 'occasional: 8 years (was 5: the owner still had barely a city)');
  assert.equal(INVASION_PRESETS.frequent.first, 60, 'frequent: 5 years (was 3)');
  // The sandbox default (occasional) on Normal: no warning before year 8 (7 years 9 months).
  const game = newGame({ invasions: 'occasional' });
  assert.equal(game.military.nextRaidMonth, 96);
});

test('demo city: every planned service is built, even where the site has trees or rock', () => {
  // The site may be up to a fifth blocked; on the balance sim's own seed
  // ('demo') the Forum and the second market used to be skipped without a
  // word, so that city never collected a denarius of tax.
  const want = { forum: 1, market: 2, prefecture: 2, engineer_post: 2, clinic: 1, school: 1, theater: 1, barber: 1, temple_mars: 1, temple_neptune: 1, temple_venus: 1, temple_ceres: 1, temple_mercury: 1 };
  for (const seed of ['demo', 'a1', 'test-seed', 'near']) {
    const game = newGame({ seed });
    assert.ok(buildDemoCity(game, { level: 2 }).ok, `${seed}: demo city built`);
    const have = {};
    for (const b of game.buildings.values()) have[b.type] = (have[b.type] || 0) + 1;
    // At least: the industry and farm quarters add prefectures of their own.
    for (const [type, n] of Object.entries(want)) assert.ok((have[type] || 0) >= n, `${seed}: ${type} ${have[type] || 0} of ${n}`);
  }
});

test('top bar: unemployment shows beside the mood and turns amber once it costs mood', async () => {
  const { workLine } = await import('../src/ui/hud.js');
  const calm = workLine({ unemploymentRate: 0.08, unemployed: 8, workforce: 100, sentimentFactors: { unemployment: 0 } });
  assert.equal(calm.value, '8%');
  assert.equal(calm.warn, false);
  assert.match(calm.title, /8 of 100 workers have no job/);
  const idle = workLine({ unemploymentRate: 0.32, unemployed: 123, workforce: 384, sentimentFactors: { unemployment: -13.2 } });
  assert.equal(idle.value, '32%');
  assert.equal(idle.warn, true);
  assert.match(idle.title, /now -13/);
  assert.match(idle.title, /build workplaces/);
  // The chip turns amber exactly where the mood starts to pay for it.
  const edge = { unemploymentRate: CONFIG.UNEMPLOYMENT_MOOD_FREE, unemployed: 10, workforce: 100 };
  assert.equal(workLine(edge).warn, false);
  const g = new Game({ scenario: sandboxScenario({ seed: 'work-chip' }) });
  g.city.unemploymentRate = CONFIG.UNEMPLOYMENT_MOOD_FREE;
  assert.equal(computeSentiment(g).unemployment, 0);
  g.city.unemploymentRate = CONFIG.UNEMPLOYMENT_MOOD_FREE + 0.05;
  assert.ok(computeSentiment(g).unemployment < 0);
});

test('demo city: every building that needs a road has one', async () => {
  // Its streets lie on fixed rows; rock or water could break one and leave
  // the buildings beside it with no road (no workers, no-road signs on the
  // main menu's town). The last pass joins or clears them.
  const { buildDemoCity } = await import('../src/dev/demoCity.js');
  const sites = [['river', 'menu-9', 96, 2], ['river', 'menu-4', 96, 2], ['river', 'demo', 64, 3]];
  for (const [type, seed, size, level] of sites) {
    const g = new Game({ scenario: sandboxScenario({ size, type, seed }), flags: { unlockall: true, money: 100000 } });
    assert.ok(buildDemoCity(g, { level }).ok);
    g.runDays(1);
    const lacking = [...g.buildings.values()].filter((b) => (b.def.needsRoad && b.def.workers && b.accessRoad < 0) || (b.house && b.accessRoad < 0));
    assert.deepEqual(lacking.map((b) => `${b.type}@${b.x},${b.y}`), [], `${type} ${seed}`);
  }
});

test('the Emperor waits: his first request comes in the third year, and not before 400 people', () => {
  const s = SCENARIOS.find((x) => x.requests);
  const g = new Game({ scenario: withDifficulty(s, 'normal') });
  const c = g.city;
  const [a, b] = CONFIG.FIRST_REQUEST_MONTHS;
  assert.ok(c.nextRequestMonth >= a && c.nextRequestMonth <= b, `first request at month ${c.nextRequestMonth}`);
  for (let k = 0; k < 20; k++) { // and on Insane, sooner but never in the first year and a half
    const ins = new Game({ scenario: withDifficulty(s, 'insane'), seed: `emp-${k}` });
    assert.ok(ins.city.nextRequestMonth >= Math.round(a * DIFFICULTY.insane.requestInterval), `${ins.city.nextRequestMonth}`);
  }
  c.population = 1000;
  g.time.totalMonths = 14; // where a first request could come before
  updateEmperor(g);
  assert.equal(c.request, null, 'not in the first year and a half');
  g.time.totalMonths = c.nextRequestMonth;
  c.population = CONFIG.REQUEST_MIN_POP - 1;
  updateEmperor(g);
  assert.equal(c.request, null, 'not in a small town');
  c.population = CONFIG.REQUEST_MIN_POP;
  updateEmperor(g);
  assert.ok(c.request, 'then he asks');
});

test('fire and collapse run at the original pace: x RISK_PACE on the listed rates', () => {
  const g = new Game({ scenario: sandboxScenario({ seed: 'pace' }) });
  const b = addBuilding(g, 'prefecture', 10, 10, 1);
  g.rng.next = () => 0.5; // the day's roll: x1.0, and no disaster
  updateRisk(g, b);
  assert.ok(Math.abs(b.fireRisk - b.def.fire * CONFIG.RISK_PACE) < 1e-9, `${b.fireRisk}`);
  assert.ok(Math.abs(b.damageRisk - b.def.damage * CONFIG.RISK_PACE) < 1e-9);
  // An ordinary building (1 a day) left alone on Normal: about 10 months.
  const months = CONFIG.FIRE_THRESHOLD / (1 * CONFIG.RISK_PACE) / CONFIG.DAYS_PER_MONTH;
  assert.ok(months > 9 && months < 11, `${months.toFixed(1)} months`);
});

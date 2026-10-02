/**
 * branches.test.mjs - headless tests for the campaign's branches (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * From step 3 on the campaign offers two provinces at the same rank, one
 * peaceful and one military (data/scenarios.js steps and tracks): which
 * missions a record of wins opens, what a win leads to (one mission, or the
 * choice of two), the savings a win stores for both missions of the next
 * step and the sibling fallback for records from before the branches, ranks,
 * the words on the choice cards (ui/campaignInfo.js), what sets a military
 * province apart from a peaceful one, and that a save of each new mission
 * loads back as that mission. The worked examples come from the rules spec.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { Game } from '../src/core/game.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import {
  SCENARIOS, findScenario, withDifficulty, ARMY_KEYS, NAVY_KEYS, LAST_STEP,
  stepOf, missionsAtStep, nextMissions, siblingOf, missionOpen, rankAfterWin, endsCareer,
} from '../src/data/scenarios.js';
import { RANKS, TOP_RANK } from '../src/data/ranks.js';
import { THREATENED_CITIES } from '../src/data/battles.js';
import { storeCampaignSavings, campaignSavings, savingsRecord } from '../src/sim/governor.js';
import { employmentCeiling, employsEnough, SENSIBLE } from '../src/sim/capacity.js';
import { goalMonths } from '../src/sim/pace.js';
import { generateMap, mapOptions } from '../src/world/mapgen.js';
import { postCard, threatLine, introLine, goalsLine, trackName, choiceLine } from '../src/ui/campaignInfo.js';

log.setLevel('error');

const NEW = ['c3m', 'c4p', 'c5p'];
/** The siblings of the late campaign (steps 6 on), each beside a mission of the other kind. */
const LATE = ['c6p', 'c7p', 'c8m', 'c8p', 'c9m', 'c9p', 'c10m', 'c10p'];
const ids = (list) => list.map((s) => s.id);
const has = (s, k) => s.unlocks === 'all' || s.unlocks.includes(k);

// ---------------------------------------------------------------------------
// The data
// ---------------------------------------------------------------------------

test('steps: two provinces at every step from 3 on, one peaceful and one military; one at steps 1 and 2', () => {
  assert.equal(LAST_STEP, 10);
  assert.deepEqual(ids(SCENARIOS), ['c1', 'c2', 'c3', 'c3m', 'c4', 'c4p', 'c5', 'c5p', 'c6', 'c6p', 'c7', 'c7p', 'c8m', 'c8p', 'c9m', 'c9p', 'c10m', 'c10p'], 'each new mission right after the one beside it');
  for (let n = 1; n <= LAST_STEP; n++) {
    const at = missionsAtStep(n);
    if (n >= 3) {
      assert.equal(at.length, 2, `step ${n}`);
      assert.deepEqual(at.map((s) => s.track).sort(), ['military', 'peaceful'], `step ${n}: one of each`);
      const [a, b] = at;
      // The same rank, start year and funds, as the original's pairs had.
      assert.deepEqual([a.rank, a.startYear, a.funds], [b.rank, b.startYear, b.funds], `step ${n}: siblings start alike`);
    } else {
      assert.equal(at.length, 1, `step ${n}`);
      assert.equal(at[0].track, undefined, `step ${n} has no track`);
    }
  }
  assert.deepEqual(Object.fromEntries(SCENARIOS.filter((s) => s.step >= 3).map((s) => [s.id, s.track])),
    { c3: 'peaceful', c3m: 'military', c4: 'military', c4p: 'peaceful', c5: 'military', c5p: 'peaceful', c6: 'military', c6p: 'peaceful', c7: 'military', c7p: 'peaceful', c8m: 'military', c8p: 'peaceful', c9m: 'military', c9p: 'peaceful', c10m: 'military', c10p: 'peaceful' });
  // Fixed map seeds, each its own.
  const seeds = SCENARIOS.map((s) => s.map.seed);
  assert.equal(new Set(seeds).size, seeds.length);
  assert.deepEqual(NEW.map((id) => findScenario(id).map), [
    { size: 112, type: 'lakes', seed: 'firmum-picenum' },
    { size: 128, type: 'coast', seed: 'paestum' },
    { size: 128, type: 'river', seed: 'beneventum' },
  ]);
  assert.deepEqual(LATE.map((id) => findScenario(id).map), [
    { size: 144, type: 'lakes', seed: 'cosa-portus' },
    { size: 160, type: 'river', seed: 'copia' },
    { size: 176, type: 'plains', seed: 'mutina' },
    { size: 176, type: 'coast', seed: 'luna' },
    { size: 192, type: 'river', seed: 'corduba' },
    { size: 192, type: 'coast', seed: 'carteia' },
    { size: 256, type: 'river', seed: 'narbo-martius', regions: true },
    { size: 224, type: 'coast', seed: 'puteoli', regions: true },
  ]);
});

test('steps: lookups by id (stepOf, missionsAtStep, nextMissions, siblingOf)', () => {
  assert.deepEqual(NEW.map(stepOf), [3, 4, 5]);
  assert.equal(stepOf('sandbox'), 0);
  assert.equal(stepOf('nope'), 0);
  assert.deepEqual(ids(nextMissions('c2')), ['c3', 'c3m']);
  assert.deepEqual(ids(nextMissions('c3')), ['c4', 'c4p']);
  assert.deepEqual(ids(nextMissions('c3m')), ['c4', 'c4p']);
  assert.deepEqual(ids(nextMissions('c5p')), ['c6', 'c6p']);
  assert.deepEqual(ids(nextMissions('c6p')), ['c7', 'c7p']);
  assert.deepEqual(ids(nextMissions('c7p')), ['c8m', 'c8p']);
  assert.deepEqual(ids(nextMissions('c8m')), ['c9m', 'c9p']);
  assert.deepEqual(ids(nextMissions('c9p')), ['c10m', 'c10p']);
  assert.deepEqual(ids(nextMissions('c10m')), []);
  assert.deepEqual(ids(nextMissions('c10p')), []);
  assert.deepEqual(ids(nextMissions('sandbox')), []);
  assert.equal(siblingOf('c4').id, 'c4p');
  assert.equal(siblingOf('c4p').id, 'c4');
  assert.equal(siblingOf('c3m').id, 'c3');
  assert.equal(siblingOf('c6').id, 'c6p');
  assert.equal(siblingOf('c7p').id, 'c7');
  assert.equal(siblingOf('c9m').id, 'c9p');
  assert.equal(siblingOf('c1'), null);
  assert.equal(siblingOf('sandbox'), null);
});

test('a military province: raids early, forts a step sooner, a distant battle; a peaceful one: none, and higher goals', () => {
  for (let n = 3; n <= LAST_STEP; n++) {
    const war = missionsAtStep(n).find((s) => s.track === 'military');
    const peace = missionsAtStep(n).find((s) => s.track === 'peaceful');
    assert.ok(war.military && war.distantBattles?.length, `${war.id}: raids and a call for troops`);
    assert.ok(has(war, 'fort_legion') && has(war, 'barracks') && has(war, 'military_academy'), `${war.id}: forts, a barracks and the Campus`);
    for (const e of war.distantBattles) assert.ok(THREATENED_CITIES[e.city], `${war.id}: ${e.city}`);
    assert.ok(!peace.military && !peace.distantBattles, `${peace.id}: no raids, no calls for troops`);
    for (const k of [...ARMY_KEYS, ...NAVY_KEYS]) assert.ok(!has(peace, k), `${peace.id}: no ${k}`);
    // The peaceful province is judged on what it builds.
    assert.ok(peace.goals.culture > war.goals.culture, `${peace.id} culture ${peace.goals.culture} over ${war.goals.culture}`);
    assert.ok(peace.goals.prosperity > war.goals.prosperity, `${peace.id} prosperity`);
    assert.ok(peace.goals.favor >= war.goals.favor, `${peace.id} favor`);
  }
  // Firmum: legionaries only (archers, cavalry and the fleet wait for step 4),
  // the campaign's earliest raids, and no water to the map's edge, so no raid
  // by sea and no fleet.
  const firmum = findScenario('c3m');
  for (const k of ['fort_archer', 'fort_cavalry', 'fletcher_ws', 'timber_yard', ...NAVY_KEYS]) assert.ok(!has(firmum, k), `Firmum: no ${k}`);
  assert.ok(has(firmum, 'iron_mine') && has(firmum, 'weapons_ws') && has(firmum, 'tower') && has(firmum, 'wall'));
  assert.equal(Math.min(...SCENARIOS.filter((s) => s.military).map((s) => s.military.first)), firmum.military.first);
  const { map } = generateMap(mapOptions(firmum.map));
  map.computeNavigation();
  assert.equal(map.seaEntry, null, 'Firmum\'s lakes do not reach the map edge');
  assert.ok(firmum.partners.every((id) => id === 'aquileia' || id === 'capua'));
  // The first raid: two years on Normal, 18 months on Insane.
  assert.equal(new Game({ scenario: firmum, flags: {} }).military.nextRaidMonth, 24);
  assert.equal(new Game({ scenario: withDifficulty(firmum, 'insane'), flags: {} }).military.nextRaidMonth, 18);
  assert.equal(new Game({ scenario: findScenario('c4p'), flags: {} }).military.nextRaidMonth, null);
  // Beneventum trades by land only, though its river is navigable.
  assert.deepEqual(findScenario('c5p').partners, ['capua', 'tarraco', 'aquileia', 'lugdunum']);
});

test('the new missions fit their jobs and keep to their pace', () => {
  // Never on the over-capacity list (tests/campaign.test.mjs holds that list to the old missions).
  for (const id of NEW) {
    const s = findScenario(id);
    const ceiling = employmentCeiling(s, SENSIBLE);
    assert.ok(s.goals.population <= ceiling && employsEnough(s, s.goals.population, SENSIBLE), `${id}: ${s.goals.population} people, ceiling ${ceiling}`);
    // A little under what a city of working homes alone employs (the goals
    // were set so before the model counted a villa quarter, which lifts the
    // ceilings of missions 4 on: those goals stay, with room to spare).
    const working = employmentCeiling(s, { ...SENSIBLE, villas: 0 });
    assert.ok(s.goals.population <= working && s.goals.population >= working * 0.9, `${id}: a goal a little under the ceiling of working homes (${s.goals.population} of ${working})`);
    // With the population in reach, peace sets the pace: a point a month from 20.
    const m = goalMonths(s.goals);
    assert.equal(m.fastest, m.peace, `${id}: peace sets the pace`);
    assert.equal(m.peace, s.goals.peace - 20);
  }
});

test('the late siblings ask for a little under the people their jobs allow, and the people set their pace', () => {
  // From step 6 the goals are set from the model with its villa quarter
  // (sim/capacity.js): between 80% and 92% of the sensible ceiling, a margin
  // for the quarter, the model's riskiest assumption. The ceiling counts the
  // demand in force when the goals can first be met.
  for (const id of LATE) {
    const s = findScenario(id);
    const ceiling = employmentCeiling(s, SENSIBLE);
    const goal = s.goals.population;
    assert.ok(goal <= ceiling * 0.92 && goal >= ceiling * 0.8, `${id}: ${goal} people of a ceiling of ${ceiling}`);
    assert.ok(employsEnough(s, goal, SENSIBLE), `${id}: a city of ${goal} has the jobs`);
    const m = goalMonths(s.goals);
    assert.equal(m.fastest, m.population, `${id}: the people set the pace`);
    // Their demand is on the original's tiers.
    for (const goods of Object.values(s.demand)) for (const v of Object.values(goods)) assert.ok([1500, 2500, 4000].includes(v), `${id}: ${v}`);
    for (const c of s.demandChanges) assert.ok([0, 1500, 2500, 4000].includes(c.to) && s.partners.includes(c.partner), `${id}: ${c.partner} ${c.good}`);
  }
});

// ---------------------------------------------------------------------------
// Progress: what opens, what a win leads to
// ---------------------------------------------------------------------------

test('unlocks: a step opens when any mission of the step before is won (worked examples)', () => {
  const open = (completed) => ids(SCENARIOS.filter((s) => missionOpen(s, completed)));
  assert.deepEqual(open([]), ['c1']);
  assert.deepEqual(open(['c1']), ['c1', 'c2']);
  assert.deepEqual(open(['c1', 'c2']), ['c1', 'c2', 'c3', 'c3m']);
  assert.deepEqual(open(['c1', 'c2', 'c3m']), ['c1', 'c2', 'c3', 'c3m', 'c4', 'c4p']);
  assert.deepEqual(open(['c1', 'c2', 'c3', 'c4p']), ['c1', 'c2', 'c3', 'c3m', 'c4', 'c4p', 'c5', 'c5p']);
  assert.deepEqual(open(['c1', 'c2', 'c3', 'c4', 'c5p']), ['c1', 'c2', 'c3', 'c3m', 'c4', 'c4p', 'c5', 'c5p', 'c6', 'c6p']);
  assert.deepEqual(open(['c6p']), ['c1', 'c6p', 'c7', 'c7p'], 'a peaceful win at step 6 opens both of step 7');
  assert.deepEqual(open(['c7p']), ['c1', 'c7p', 'c8m', 'c8p'], 'Copia alone opens step 8');
  assert.deepEqual(open(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']), ids(SCENARIOS).filter((id) => stepOf(id) <= 8), 'an old record that won Urbs Magna opens step 8');
  assert.deepEqual(open(['c8m']), ['c1', 'c8m', 'c9m', 'c9p']);
  assert.deepEqual(open(['c9p']), ['c1', 'c9p', 'c10m', 'c10p']);
  assert.deepEqual(open(['c10m']), ['c1', 'c10m'], 'a won mission of the last step stays open; nothing comes after it');
  // A record from before the branches needs no rewrite: it opens everything
  // it did, and the new missions beside the steps it reached.
  assert.deepEqual(open(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']), ids(SCENARIOS).filter((id) => stepOf(id) <= 7));
  assert.deepEqual(open(['c1', 'c2', 'c3']), ['c1', 'c2', 'c3', 'c3m', 'c4', 'c4p']);
  // A mission won stays open; unlockall opens everything; the sandbox is no mission.
  assert.equal(missionOpen(findScenario('c5p'), ['c5p']), true);
  assert.equal(SCENARIOS.every((s) => missionOpen(s, [], true)), true);
  assert.equal(missionOpen({ id: 'sandbox' }, ['c1']), false);
});

test('after a win: the next step\'s two provinces as cards; one mission alone as before', () => {
  // Win c2: Figlina (peaceful) and Firmum (military).
  const after2 = nextMissions('c2').map(postCard);
  assert.deepEqual(after2.map((c) => [c.id, c.track]), [['c3', 'Peaceful'], ['c3m', 'Military']]);
  assert.equal(after2[1].name, 'Firmum: The Picene Frontier');
  assert.equal(after2[1].threat, 'First raid after about 2 years; forts and a legion; Caesar may call for troops.');
  assert.equal(after2[0].threat, 'No raiders and no forts: Rome judges you by culture and prosperity.');
  assert.equal(after2[1].map, 'Lake District, 112×112');
  assert.equal(after2[1].goals, 'population 1,100, culture 35, prosperity 20, peace 48');
  assert.match(after2[1].intro, /^Rome planted the Latin colony of Firmum .* 264 BC/);
  // Win c3m: Pons Aelius (military) and Paestum (peaceful): tracks switch freely.
  const after3 = nextMissions('c3m').map(postCard);
  assert.deepEqual(after3.map((c) => [c.id, c.track]), [['c4', 'Military'], ['c4p', 'Peaceful']]);
  assert.equal(after3[0].threat, 'First raid after about 5 years; forts and a mixed army; Caesar may call for troops.');
  assert.equal(after3[1].threat, 'No raiders and no forts: Rome judges you by culture, prosperity and the Emperor\'s favor.');
  assert.equal(choiceLine(nextMissions('c3m')), 'Rome offers you two provinces, each for an Architect. Read one briefing, go back and read the other before you choose.');
  // Win c5p: Oasis Aurea (military) and Cosa (peaceful).
  const after5 = nextMissions('c5p').map(postCard);
  assert.deepEqual(after5.map((c) => [c.id, c.track]), [['c6', 'Military'], ['c6p', 'Peaceful']]);
  assert.equal(after5[1].threat, 'No raiders and no forts: Rome judges you by culture, prosperity and the Emperor\'s favor.');
  assert.equal(after5[1].map, 'Lake District, 144×144');
  assert.equal(choiceLine(nextMissions('c5p')), 'Rome offers you two provinces, each for a Procurator. Read one briefing, go back and read the other before you choose.');
  // A step of one mission still leads on to it alone.
  assert.deepEqual(ids(nextMissions('c1')), ['c2']);
  // Every intro carries a line of history: the colony and its year.
  for (const [id, year] of [['c3m', 264], ['c4p', 273], ['c5p', 268], ['c6p', 273], ['c7p', 193], ['c8m', 183], ['c8p', 177], ['c9m', 155], ['c9p', 171], ['c10m', 118], ['c10p', 194]]) assert.match(findScenario(id).intro, new RegExp(`${year} BC`), id);
  assert.equal(trackName(findScenario('c1')), null);
  assert.equal(introLine({ intro: 'One. Two.' }), 'One.');
  assert.equal(goalsLine(findScenario('c1')), 'population 300, culture 15, peace 35');
  assert.equal(threatLine(findScenario('c6')), 'First raid after about 4 years; forts and a mixed army; Caesar may call for troops.');
});

test('after a loss: the same step\'s choice again, where the step has two', () => {
  // The defeat screen offers missionsAtStep(stepOf(lost)) when it holds two.
  assert.deepEqual(ids(missionsAtStep(stepOf('c3m'))), ['c3', 'c3m']);
  assert.deepEqual(ids(missionsAtStep(stepOf('c4'))), ['c4', 'c4p']);
  assert.deepEqual(ids(missionsAtStep(stepOf('c6'))), ['c6', 'c6p']);
  assert.deepEqual(ids(missionsAtStep(stepOf('c2'))), ['c2'], 'one mission: Try again, no choice');
  assert.deepEqual(ids(missionsAtStep(stepOf('sandbox'))), []);
});

// ---------------------------------------------------------------------------
// Savings and ranks
// ---------------------------------------------------------------------------

test('savings: a win stores them for both missions of the next step; the last win at a step counts (worked examples)', () => {
  const record = {};
  assert.deepEqual(storeCampaignSavings(record, 'c2', 300), ['c3', 'c3m']);
  assert.deepEqual(record, { c3: 300, c3m: 300 });
  assert.deepEqual(storeCampaignSavings(record, 'c3m', 1200), ['c4', 'c4p']);
  assert.equal(record.c4, 1200);
  assert.equal(record.c4p, 1200);
  storeCampaignSavings(record, 'c3', 900); // step 3 won again, the other way
  assert.deepEqual([record.c4, record.c4p], [900, 900]);
  assert.deepEqual(storeCampaignSavings(record, 'c5p', 2000), ['c6', 'c6p']);
  assert.deepEqual([record.c6, record.c6p], [2000, 2000]);
  assert.deepEqual(storeCampaignSavings(record, 'c6p', 3000), ['c7', 'c7p']);
  assert.deepEqual([record.c7, record.c7p], [3000, 3000]);
  assert.deepEqual(storeCampaignSavings(record, 'c8p', 4000), ['c9m', 'c9p']);
  assert.deepEqual(storeCampaignSavings(record, 'c9m', 4500), ['c10m', 'c10p']);
  assert.deepEqual([record.c10m, record.c10p], [4500, 4500]);
  const before = { ...record };
  for (const s of missionsAtStep(LAST_STEP)) assert.deepEqual(storeCampaignSavings(record, s.id, 5000), [], s.id);
  assert.deepEqual(record, before, 'nothing written after the last step');
  // Each mission starts from them, and a game started with them has them.
  assert.equal(campaignSavings(record, 'c4p'), 900);
  assert.equal(new Game({ scenario: findScenario('c4p'), savings: campaignSavings(record, 'c4p') }).city.governor.savings, 900);
});

test('savings: an old record falls back to the sibling\'s entry, with no rewrite', () => {
  const progress = { completed: ['c1', 'c2', 'c3'], best: { c3: 'normal' }, savings: { c4: 800 } };
  const rec = savingsRecord(progress);
  assert.equal(campaignSavings(rec, 'c4p'), 800, 'Paestum reads Pons Aelius\'s entry');
  assert.equal(campaignSavings(rec, 'c4'), 800);
  assert.equal(campaignSavings(rec, 'c5p'), 0, 'a step never reached');
  assert.equal(campaignSavings(rec, 'c1'), 0);
  assert.deepEqual(progress.savings, { c4: 800 }, 'reading writes nothing');
  // An entry of its own wins over the sibling's, even 0.
  assert.equal(campaignSavings({ c4: 800, c4p: 0 }, 'c4p'), 0);
  assert.equal(campaignSavings({ c4: 800, c4p: 50 }, 'c4p'), 50);
  // Never for the sandbox, or a broken entry.
  assert.equal(campaignSavings({ sandbox: 500 }, 'sandbox'), 0);
  assert.equal(campaignSavings({ c4: 'lots' }, 'c4p'), 0);
});

test('ranks: both missions of a step at the step\'s rank (worked examples)', () => {
  const rank = (id) => new Game({ scenario: findScenario(id), flags: {} }).city.governor.rank;
  assert.deepEqual(['c3', 'c3m', 'c4', 'c4p', 'c5', 'c5p', 'c6', 'c6p', 'c7', 'c7p', 'c8m', 'c8p', 'c9m', 'c9p', 'c10m', 'c10p'].map(rank), [2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9]);
  // One rank a step, and a win at the last step makes the governor Caesar,
  // the top rank: all eleven are used.
  assert.deepEqual(['c1', 'c2', 'c3m', 'c5p', 'c7', 'c9p', 'c10m', 'c10p'].map(rankAfterWin), [1, 2, 3, 5, 7, 9, TOP_RANK, TOP_RANK]);
  assert.equal(RANKS[TOP_RANK].name, 'Caesar');
  assert.equal(rankAfterWin('sandbox'), null);
  assert.deepEqual(SCENARIOS.filter((s) => endsCareer(s.id)).map((s) => s.id), ['c10m', 'c10p']);
});

// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

test('saves: each new mission saves as its id and loads back as itself', () => {
  for (const id of [...NEW, ...LATE]) {
    const game = new Game({ scenario: withDifficulty(findScenario(id), 'hard'), flags: {}, savings: 400 });
    game.runDays(3);
    const data = JSON.parse(JSON.stringify(serializeGame(game)));
    assert.deepEqual(data.scenario, { id }, `${id}: only the id is stored`);
    const back = deserializeGame(data);
    assert.equal(back.scenario.id, id);
    assert.equal(back.scenario.step, stepOf(id));
    assert.equal(back.scenario.track, findScenario(id).track);
    assert.deepEqual(back.scenario.goals, findScenario(id).goals);
    assert.equal(back.difficultyKey, 'hard');
    assert.equal(back.city.governor.rank, findScenario(id).rank);
    assert.equal(back.city.governor.savings, 400);
    assert.equal(back.military.nextRaidMonth, game.military.nextRaidMonth);
  }
});

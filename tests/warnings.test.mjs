/**
 * warnings.test.mjs - the staged warnings before a raid (sim/military.js:
 * traders' word about 6 months ahead, the scouts' report at 3, a month away
 * at 1) and Caesar's legions' reminders on the march (sim/legion.js:
 * halfway, a month away), from the rules spec's worked examples: each
 * stage's timing by land, by sea and for the legions, a raid dated late, a
 * raid and the legions side by side, the drift, a march whose favor recovers,
 * saves between stages and saves from before them, and the message clicks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { DIFFICULTY } from '../src/data/difficulty.js';
import { addBuilding } from '../src/sim/entities.js';
import { militaryMonthly, threatSummary, launchInvasion, RAID_MIN_POP, RUMOUR_MONTHS, SCOUT_MONTHS, DOOR_MONTHS } from '../src/sim/military.js';
import { seaRoll, seaLandingNow } from '../src/sim/navy.js';
import { caesarDaily, startMarch, launchLegion, noticeStageFor, LEGION_HALFWAY_DAYS, LEGION_DOOR_DAYS } from '../src/sim/legion.js';
import { openMessage, clickHint } from '../src/ui/messages.js';
import { empireTravelers, travelerLabel } from '../src/ui/empireMap.js';
import { buildDemoCity } from '../src/dev/demoCity.js';
import { newGame, findFree } from './helpers.mjs';

log.setLevel('error');

/** A sandbox with raids on and a town worth raiding (one home, so the scouts find a side). */
function raidGame(opts = {}) {
  const game = newGame({ invasions: 'occasional', ...opts });
  const spot = findFree(game, 1, 1);
  addBuilding(game, 'house', spot.x, spot.y);
  game.city.population = 600;
  return game;
}

/** Messages posted while `fn` runs. */
function heard(game, fn) {
  const out = [];
  const on = (m) => out.push(m);
  game.events.on('message', on);
  try { fn(); } finally { game.events.off?.('message', on); }
  return out;
}

/** The month tick `left` months before the raid: the messages it posted. */
function monthAt(game, left) {
  game.time.totalMonths = game.military.nextRaidMonth - left;
  return heard(game, () => militaryMonthly(game));
}

/**
 * Load saved data, keeping the population it was saved with: a load counts
 * the people in the homes again, and these test towns have more on paper.
 */
function load(data) {
  const pop = data.city.population; // (the loaded city is this very object)
  const game = deserializeGame(data);
  game.city.population = pop;
  return game;
}

/** A round trip through the save format. */
const reload = (game) => load(JSON.parse(JSON.stringify(serializeGame(game))));

// ---------------------------------------------------------------------------
// Raids by land
// ---------------------------------------------------------------------------

test('a raid by land: word at 6 months, the scouts at 3, a month away at 1, then the raid; one message each, no draws but the scouts\'', () => {
  assert.deepEqual([RUMOUR_MONTHS, SCOUT_MONTHS, DOOR_MONTHS], [6, 3, 1]);
  const game = raidGame();
  const m = game.military;
  const log = {};
  const draws = {};
  for (let left = 8; left >= 0; left--) {
    const rng = JSON.stringify(game.rng.getState());
    log[left] = monthAt(game, left);
    draws[left] = JSON.stringify(game.rng.getState()) !== rng;
    if (left === 6) assert.equal(threatSummary(game).text, 'A warband is gathering beyond the frontier, about 6 months away');
    if (left === 1) assert.match(threatSummary(game).text, /in ~1 month$/, 'one month, not "1 months"');
  }
  for (const left of [8, 7, 5, 4, 2]) assert.deepEqual(log[left], [], `nothing at ${left} months`);
  // 6: the traders' word. No side, no size: nothing has been drawn.
  const [rumour] = log[6];
  assert.equal(log[6].length, 1);
  assert.equal(rumour.text, 'Traders speak of a warband gathering beyond the frontier, about 6 months away. Scouts will learn its strength and its road nearer the time.');
  assert.equal(rumour.level, 'warn');
  assert.equal(rumour.empire, 'warband', 'a click opens the empire map');
  assert.equal(rumour.x, undefined);
  assert.equal(draws[6], false, 'the rumour draws nothing');
  // 3: the scouts' report, as before, with the real count.
  const [scouts] = log[3];
  assert.equal(log[3].length, 1);
  assert.match(scouts.text, /^Scouts report a warband of about \d+ raiders gathering to the [a-z-]+, 3 months away\. Train soldiers and man your towers!$/);
  assert.equal(scouts.level, 'warn');
  assert.equal(scouts.empire, 'warband');
  assert.equal(draws[3], true, 'the scouts draw the side, as always');
  // 1: a month away, from the same side, a click on the edge.
  const [door] = log[1];
  assert.equal(log[1].length, 1);
  assert.match(door.text, /^The warband of about \d+ raiders is a month away and will come in from the [a-z-]+\. Man the walls and towers!$/);
  assert.equal(door.level, 'warn');
  assert.equal(door.empire, undefined, 'it glides to the place');
  assert.equal(draws[1], false, 'the last warning draws nothing');
  // 0: the raid, as always.
  assert.equal(log[0].length, 1);
  assert.match(log[0][0].text, /^Raiders are attacking from the [a-z-]+! \(\d+ warriors\)$/);
  assert.equal(log[0][0].level, 'bad');
  assert.ok(m.active, 'the raid is on');
  assert.equal(m.warnStage, 0);
  assert.equal(m.warned, null);
});

test('the stages say the same side and size the scouts fixed', () => {
  const game = raidGame();
  monthAt(game, 6);
  const [scouts] = monthAt(game, 3);
  const w = game.military.warned;
  assert.equal(game.military.warnStage, 2);
  assert.ok(scouts.text.includes(`about ${w.size} raiders gathering to the ${w.dir}`));
  assert.deepEqual([scouts.x, scouts.y], [w.origin.x, w.origin.y]);
  const [door] = monthAt(game, 1);
  assert.equal(game.military.warnStage, 3);
  assert.ok(door.text.includes(`about ${w.size} raiders is a month away and will come in from the ${w.dir}`));
  assert.deepEqual([door.x, door.y], [w.origin.x, w.origin.y]);
});

test('a raid dated inside a stage\'s lead skips the stages already past, one message a month', () => {
  // Five months ahead: the rumour with the real count.
  let game = raidGame();
  let said = monthAt(game, 5);
  assert.equal(said.length, 1);
  assert.match(said[0].text, /about 5 months away/);
  // Three months ahead, nothing said yet (example 2): straight to the scouts.
  game = raidGame();
  said = monthAt(game, 3);
  assert.equal(said.length, 1);
  assert.match(said[0].text, /^Scouts report/);
  assert.deepEqual(monthAt(game, 2), []);
  said = monthAt(game, 1);
  assert.equal(said.length, 1);
  assert.match(said[0].text, /is a month away/);
  // A month ahead, never scouted: the scouts must fix side and size first;
  // the raid comes next month, so there is no "a month away" as well.
  game = raidGame();
  said = monthAt(game, 1);
  assert.equal(said.length, 1);
  assert.match(said[0].text, /^Scouts report a warband of about \d+ raiders gathering to the [a-z-]+, a month away\./);
  assert.equal(game.military.warnStage, 2);
  said = monthAt(game, 0);
  assert.equal(said.length, 1);
  assert.match(said[0].text, /^Raiders are attacking/);
});

test('drift: a town that falls under 300 after the rumour hears the warband drifted away, then the rumour again', () => {
  // Example 3: word at 6 months with 320 people, 280 at the scouts' check.
  const game = raidGame();
  const m = game.military;
  game.city.population = 320;
  assert.equal(monthAt(game, 6).length, 1);
  assert.deepEqual(monthAt(game, 5), []);
  assert.deepEqual(monthAt(game, 4), []);
  game.city.population = 280;
  const now = m.nextRaidMonth - 3;
  const said = monthAt(game, 3);
  assert.deepEqual(said.map((x) => [x.text, x.level]), [['Scouts report the warband has drifted away, for now.', 'info']]);
  assert.equal(m.nextRaidMonth, now + 6, 'put off six months');
  assert.equal(m.warnStage, 0);
  // A month later the town has 310 again: word comes again, 5 months ahead.
  game.city.population = 310;
  const again = monthAt(game, 5);
  assert.equal(again.length, 1);
  assert.match(again[0].text, /about 5 months away/);
  assert.equal(m.warnStage, 1);
});

test('a hamlet hears nothing: no rumour under 300 people, and its raid is put off without a word', () => {
  const game = raidGame();
  game.city.population = RAID_MIN_POP - 1;
  assert.deepEqual(monthAt(game, 6), []);
  assert.equal(game.military.warnStage, 0);
  const before = game.military.nextRaidMonth;
  assert.deepEqual(monthAt(game, 3), [], 'put off silently: nothing had been said');
  assert.ok(game.military.nextRaidMonth > before);
});

test('a raid launched from the console mid-warning starts the next raid\'s warnings from nothing', () => {
  const game = raidGame();
  monthAt(game, 6);
  assert.equal(game.military.warnStage, 1);
  launchInvasion(game, null, 4);
  assert.equal(game.military.warnStage, 0);
  assert.equal(threatSummary(game).level, 'attack');
});

test('raids switched off between stages: the warning is cleared without a word', () => {
  const game = raidGame();
  monthAt(game, 3);
  assert.ok(game.military.warned);
  game.military.settings = null;
  assert.deepEqual(heard(game, () => militaryMonthly(game)), []);
  assert.equal(game.military.warned, null);
  assert.equal(game.military.warnStage, 0);
});

// ---------------------------------------------------------------------------
// Raids by sea
// ---------------------------------------------------------------------------

/** A grown coastal town whose next raid comes by sea. */
function seaRaidCity() {
  const game = newGame({ type: 'coast', size: 64, seed: 'demo', invasions: 'occasional' });
  assert.ok(buildDemoCity(game, { level: 2 }).ok);
  game.runDays(16 * 3);
  const m = game.military;
  let n = 1;
  while (seaRoll(game.seed, n) >= CONFIG.SEA_RAID_SHARE) n++;
  m.nextInvasionId = n;
  game.city.population = 1000;
  return game;
}

test('a raid by sea: the same rumour, the scouts name the landing, a month out the landing again; corrected if it moved', () => {
  const game = seaRaidCity();
  const m = game.military;
  const [rumour] = monthAt(game, 6);
  assert.match(rumour.text, /^Traders speak of a warband gathering beyond the frontier/, 'land or sea is not known yet');
  const [scouts] = monthAt(game, 3);
  assert.equal(m.warned.sea, true);
  const first = { ...m.warned.landing };
  assert.equal(scouts.text, `Scouts report about ${m.warned.size} raiders taking to their ships, by sea, from the ${m.warned.dir}. They will come ashore near ${first.x}, ${first.y} in about 3 months. Man the shore, and send the fleet if you have one!`);
  assert.equal(scouts.empire, 'warband');
  // A month out: the same shore (nothing was built there), said plainly.
  const save = JSON.stringify(serializeGame(game));
  const rng = JSON.stringify(game.rng.getState());
  let [door] = monthAt(game, 1);
  assert.equal(door.text, `Raider ships are a month off the coast: about ${m.warned.size} raiders, making for the shore near ${first.x}, ${first.y}. Man the shore and send out the fleet!`);
  assert.deepEqual([door.x, door.y], [first.x, first.y]);
  assert.equal(JSON.stringify(game.rng.getState()), rng, 'looking for the landing again draws nothing');
  // Example 4: the scouts' landing is no longer where they would land.
  const moved = load(JSON.parse(save));
  moved.military.warned.landing = { x: first.x + 5, y: first.y + 6 };
  [door] = monthAt(moved, 1);
  const now = seaLandingNow(moved);
  assert.equal(door.text, `Raider ships are a month off the coast: about ${moved.military.warned.size} raiders, making for the shore near ${now.x}, ${now.y} (not where the scouts first thought). Man the shore and send out the fleet!`);
  assert.deepEqual(moved.military.warned.landing, { x: now.x, y: now.y }, 'the report is corrected, so "Show the landing" goes there');
  // The raid itself comes as before.
  const [arrive] = monthAt(game, 0);
  assert.match(arrive.text, /^Raider ships are coming from the/);
  assert.equal(m.active.sea, true);
});

test('a raid by sea that can find no shore a month out (Sea raids switched off) is said to come overland, and does', () => {
  const game = seaRaidCity();
  const m = game.military;
  monthAt(game, 3);
  assert.equal(m.warned.sea, true);
  m.seaRaids = false;
  const [door] = monthAt(game, 1);
  assert.equal(door.text, `Raider ships are a month off the coast, about ${m.warned.size} raiders, but they can find no shore to land on. Expect them overland, from a side the scouts cannot yet tell.`);
  assert.equal(door.empire, 'warband');
  assert.equal(m.warned.noShore, true);
  assert.equal(m.warned.sea, true, 'the launch decides, as it always did');
  // The top bar, the advisor and the empire map tell the same story (from review).
  assert.equal(threatSummary(game).text, `About ${m.warned.size} raiders expected overland (their ships found no shore) in ~1 month`);
  const w = empireTravelers(game).find((t) => t.kind === 'warband');
  assert.equal(travelerLabel(w), `Warband of ${m.warned.size} by sea from the ${m.warned.dir}, no landing found, in 1 month`);
  const [arrive] = monthAt(game, 0);
  assert.match(arrive.text, /^Raiders are attacking from the/);
  assert.equal(m.active.sea, undefined);
});

// ---------------------------------------------------------------------------
// Caesar's legions
// ---------------------------------------------------------------------------

/** Daily checks until `n` days are left on the march; the messages they posted. */
function marchTo(game, n) {
  return heard(game, () => { while (game.military.caesar.countdown > n) caesarDaily(game); });
}

test('the legions: set out at 12 months, halfway at 96 days, a month away at 16, then the arrival', () => {
  assert.equal(LEGION_HALFWAY_DAYS, 96);
  assert.equal(LEGION_DOOR_DAYS, 16);
  const game = newGame();
  const d = game.difficulty;
  const cs = game.military.caesar;
  game.city.ratings.favor = 8;
  const start = heard(game, () => caesarDaily(game));
  assert.equal(start.length, 1);
  assert.match(start[0].text, /^Caesar has lost patience/);
  assert.equal(cs.noticeStage, 1);
  assert.deepEqual(marchTo(game, 97), [], 'nothing on the road before halfway');
  let said = marchTo(game, 96);
  assert.equal(said.length, 1);
  assert.equal(said[0].text, `Caesar's legions (16 men) are halfway from Rome, 6 months away. At your favor now (8) they would attack; from ${d.legionHalt} they would halt, from ${d.legionHome} turn for home.`);
  assert.equal(said[0].level, 'warn');
  assert.equal(said[0].empire, 'legion');
  assert.equal(cs.noticeStage, 2);
  assert.deepEqual(marchTo(game, 17), []);
  said = marchTo(game, 16);
  assert.equal(said.length, 1);
  const e = game.map.entry;
  assert.match(said[0].text, /^Caesar's legions \(16 men\) are a month away and will march in by the entrance in the [a-z-]+\. At your favor now \(8\) they will (make for|attack)/);
  assert.deepEqual([said[0].x, said[0].y], [e.x, e.y], 'a click glides to the entrance');
  assert.equal(said[0].level, 'warn');
  assert.equal(cs.noticeStage, 3);
  said = marchTo(game, 0);
  assert.ok(cs.army, 'arrived');
  assert.ok(said.some((m) => /^Caesar's legions have arrived/.test(m.text) && m.level === 'bad'));
  assert.equal(said.filter((m) => m.level === 'warn').length, 0, 'no reminder twice');
  assert.equal(cs.noticeStage, 0);
});

test('the reminders tell what the favor now would make the army do, with each difficulty\'s bands (example 5)', () => {
  for (const key of Object.keys(DIFFICULTY)) {
    const game = newGame({ difficulty: key });
    const d = game.difficulty;
    game.city.ratings.favor = 9;
    caesarDaily(game);
    // Halfway with favor in the halting band.
    game.city.ratings.favor = d.legionHalt + 1;
    let [msg] = marchTo(game, 96);
    assert.match(msg.text, new RegExp(`At your favor now \\(${d.legionHalt + 1}\\) they would halt where they stand; from ${d.legionHome} they would turn for home\\.$`), key);
    // A month away with favor won back: they will go home.
    game.city.ratings.favor = d.legionHome + 1;
    [msg] = marchTo(game, 16);
    assert.match(msg.text, new RegExp(`At your favor now \\(${d.legionHome + 1}\\) they will turn for home\\.$`), key);
  }
});

test('a march whose favor recovers: told so a month out, and the army turns for home on arrival', () => {
  const game = newGame();
  const cs = game.military.caesar;
  game.city.ratings.favor = 5;
  caesarDaily(game);
  game.city.ratings.favor = 60;
  const said = marchTo(game, 0);
  assert.deepEqual(said.filter((m) => m.level === 'warn').map((m) => /they would turn for home\.$|they will turn for home\.$/.test(m.text)), [true, true]);
  caesarDaily(game);
  assert.equal(cs.army.retreating, true);
  assert.equal(cs.noticeStage, 0);
});

test('a march found already near (a debug command) tells only the latest reminder', () => {
  const game = newGame();
  const cs = game.military.caesar;
  game.city.ratings.favor = 5;
  startMarch(game);
  cs.countdown = 16; // 15 left after today's step
  const said = heard(game, () => caesarDaily(game));
  assert.equal(said.length, 1);
  assert.match(said[0].text, /a month away/);
  assert.equal(cs.noticeStage, 3);
  // Brought in at once: the stage starts again for the next march.
  launchLegion(game);
  assert.equal(cs.noticeStage, 0);
});

test('a raid and the legions side by side: each army\'s stages come on their own days, both in the top bar', () => {
  const game = raidGame();
  const m = game.military;
  game.city.ratings.favor = 5;
  caesarDaily(game);
  m.caesar.countdown = 97; // the halfway reminder tomorrow
  // The rumour's month tick and the halfway day fall together: two messages, different news.
  const said = heard(game, () => { monthAt(game, 6); caesarDaily(game); });
  assert.equal(said.length, 2);
  assert.match(said[0].text, /^Traders speak of a warband/);
  assert.match(said[1].text, /^Caesar's legions \(\d+ men\) are halfway from Rome/);
  const t = threatSummary(game);
  assert.equal(t.label, '⚠ Raid');
  assert.match(t.text, /^A warband is gathering beyond the frontier, about 6 months away\. Caesar's legions \(\d+ men\) arrive in ~6 months$/);
});

// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

test('a save between stages tells nothing again: the stage is saved', () => {
  let game = raidGame();
  monthAt(game, 6);
  game = reload(game);
  assert.equal(game.military.warnStage, 1);
  assert.deepEqual(monthAt(game, 6), [], 'the same month again tells nothing');
  assert.equal(monthAt(game, 3).length, 1);
  monthAt(game, 1);
  game = reload(game);
  assert.equal(game.military.warnStage, 3);
  assert.deepEqual(monthAt(game, 1), []);
  assert.match(monthAt(game, 0)[0].text, /^Raiders are attacking/);
  // The legions' reminders too.
  game.city.ratings.favor = 5;
  caesarDaily(game);
  marchTo(game, 96);
  game = reload(game);
  assert.equal(game.military.caesar.noticeStage, 2);
  assert.deepEqual(marchTo(game, 17), []);
  assert.equal(marchTo(game, 16).length, 1);
});

test('a save from before the stages (version 14) loads with the stages already past counted as told; nothing on load, nothing late', () => {
  assert.equal(CONFIG.SAVE_VERSION, 15);
  /** The game saved as version 14 would have saved it. */
  const asV14 = (game) => {
    const data = JSON.parse(JSON.stringify(serializeGame(game)));
    data.version = 14;
    delete data.military.warnStage;
    delete data.military.caesar.noticeStage;
    return data;
  };
  // Scouted, a month to go: stage 3 is past; next month the raid.
  let game = raidGame();
  monthAt(game, 3);
  game.time.totalMonths = game.military.nextRaidMonth - 1;
  let data = asV14(game);
  let old = load(data);
  assert.equal(old.messages.length, game.messages.length, 'nothing posted on load');
  assert.equal(old.military.warnStage, 3);
  assert.deepEqual(monthAt(old, 1), []);
  assert.match(monthAt(old, 0)[0].text, /^Raiders are attacking/);
  // Scouted, two months to go: stage 2; "a month away" comes on time.
  game.time.totalMonths = game.military.nextRaidMonth - 2;
  old = load(asV14(game));
  assert.equal(old.military.warnStage, 2);
  assert.match(monthAt(old, 1)[0].text, /is a month away/);
  // Five months to go, nothing said (the old game had no rumour): no late rumour; the scouts on time.
  game = raidGame();
  game.time.totalMonths = game.military.nextRaidMonth - 5;
  old = load(asV14(game));
  assert.equal(old.military.warnStage, 1);
  assert.deepEqual(monthAt(old, 5), []);
  assert.deepEqual(monthAt(old, 4), []);
  assert.match(monthAt(old, 3)[0].text, /^Scouts report/);
  // Eight months to go: nothing past; the rumour comes at 6.
  game.time.totalMonths = game.military.nextRaidMonth - 8;
  old = load(asV14(game));
  assert.equal(old.military.warnStage, 0);
  assert.equal(monthAt(old, 6).length, 1);
  // A hamlet under 300 five months out: nothing counts as told (no drift message for words never said).
  game.city.population = 100;
  game.time.totalMonths = game.military.nextRaidMonth - 5;
  old = load(asV14(game));
  assert.equal(old.military.warnStage, 0);
  // Example 6: the legions 60 days out load past halfway; a month out comes on time.
  game = newGame();
  game.city.ratings.favor = 5;
  caesarDaily(game);
  game.military.caesar.countdown = 60;
  data = asV14(game);
  old = load(data);
  assert.equal(old.military.caesar.noticeStage, 2);
  assert.deepEqual(marchTo(old, 17), []);
  assert.equal(marchTo(old, 16).length, 1);
  assert.deepEqual([0, 1, 16, 17, 96, 97, 192].map(noticeStageFor), [0, 3, 3, 2, 2, 1, 1]);
});

// ---------------------------------------------------------------------------
// Clicks
// ---------------------------------------------------------------------------

test('a click on news of an army on its way opens the empire map on it; others glide as before', () => {
  const calls = [];
  const app = { ui: { openEmpire: (k) => calls.push(['empire', k]) }, renderer: { camera: { glideToTile: (x, y) => calls.push(['glide', x, y]) } } };
  assert.equal(openMessage(app, { text: 'a', empire: 'warband', x: 3, y: 4 }), true);
  assert.equal(openMessage(app, { text: 'b', x: 5, y: 6 }), true);
  assert.equal(openMessage(app, { text: 'c' }), false, 'a message with no place does nothing');
  assert.deepEqual(calls, [['empire', 'warband'], ['glide', 5, 6]]);
  assert.equal(clickHint({ empire: 'legion' }), 'Click to see it on the empire map');
  assert.equal(clickHint({ x: 1, y: 2 }), 'Click to go there');
  assert.equal(clickHint({}), '');
});

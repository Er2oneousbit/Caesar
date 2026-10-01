/**
 * governor.test.mjs - the governor's rank, salary, savings, gifts to the
 * Emperor, donations and residence (sim/governor.js, sim/emperor.js), from
 * the rules spec's worked examples.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { Game } from '../src/core/game.js';
import { serializeGame, deserializeGame, upgradeGovernorV12 } from '../src/core/save.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { RANKS, TOP_RANK, SANDBOX_RANK, clampRank } from '../src/data/ranks.js';
import { SCENARIOS, sandboxScenario, findScenario, withDifficulty } from '../src/data/scenarios.js';
import { RIOT_TARGETS } from '../src/data/crime.js';
import { addBuilding, removeBuilding } from '../src/sim/entities.js';
import { checkBuilding } from '../src/sim/construction.js';
import { updateDesirability } from '../src/sim/desirability.js';
import { pickRiotTarget, riotRank } from '../src/sim/crime.js';
import { ledgerNet } from '../src/sim/economy.js';
import {
  newGovernorState, salaryOf, rankForYearPay, salaryFavor, setSalary, paySalary, salaryNewYear,
  salaryOutlook, donate, residenceOf, storeCampaignSavings, campaignSavings, salaryAtVictory, salaryMonthsSoFar, savingsRecord,
} from '../src/sim/governor.js';
import { checkOutcome } from '../src/sim/ratings.js';
import { GIFT_SIZES, GIFT_MEMORY_MONTHS, giftCost, giftFavor, sendGift, giftsMonth } from '../src/sim/emperor.js';
import {
  rankLine, salaryOption, salaryOutlookText, giftLabel, giftBlocked, giftNote, briefingGovernorLine, victoryGovernorLine, salaryNow,
} from '../src/ui/governorInfo.js';
import { newGame, build, findFree } from './helpers.mjs';

log.setLevel('error');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TICKS_PER_MONTH = CONFIG.TICKS_PER_DAY * CONFIG.DAYS_PER_MONTH;

/** A sandbox game whose governor holds `rank` (savings and treasury as given). */
function governed({ rank = SANDBOX_RANK, savings = 0, money = 50000 } = {}) {
  const scenario = sandboxScenario({ size: 64, seed: 'governor', invasions: 'none', rank });
  return new Game({ scenario, flags: { unlockall: true, money }, savings });
}

/** Messages that name the salary's verdict at New Year. */
const salaryMessages = (game) => game.messages.filter((m) => /weighed your salary|modest salary/.test(m.text));

// ---------------------------------------------------------------------------
// Ranks
// ---------------------------------------------------------------------------

test('ranks: eleven, Citizen to Caesar, with the salary table from 0 to 100 Dn a month', () => {
  assert.equal(RANKS.length, 11);
  assert.equal(TOP_RANK, 10);
  assert.deepEqual(RANKS.map((r) => r.salary), [0, 2, 5, 8, 12, 20, 30, 40, 60, 80, 100]);
  assert.equal(RANKS[0].name, 'Citizen');
  assert.equal(RANKS[10].name, 'Caesar');
  assert.equal(new Set(RANKS.map((r) => r.name)).size, 11);
  assert.equal(clampRank(3), 3);
  assert.equal(clampRank(11), SANDBOX_RANK);
  assert.equal(clampRank('2', 0), 0);
});

test('ranks: one per mission (mission 1 a Citizen, mission 7 an Aedile); the sandbox picks one, the middle by default', () => {
  assert.deepEqual(SCENARIOS.map((s) => s.rank), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(withDifficulty(findScenario('c4'), 'hard').rank, 3, 'a difficulty keeps the rank');
  assert.equal(sandboxScenario({}).rank, 5);
  assert.equal(sandboxScenario({ rank: 9 }).rank, 9);
  assert.equal(new Game({ scenario: findScenario('c2') }).city.governor.rank, 1);
  const g = governed({ rank: 8 });
  assert.deepEqual(g.city.governor, { rank: 8, salaryRank: 8, savings: 0, paidThisYear: 0 }, 'the salary starts at the rank\'s own rate');
});

// ---------------------------------------------------------------------------
// Salary
// ---------------------------------------------------------------------------

test('salary: paid monthly from the treasury into savings, on its own ledger line, counted as spending', () => {
  const game = governed({ rank: 5 });
  const c = game.city;
  const t0 = c.treasury;
  game.runTicks(TICKS_PER_MONTH);
  assert.equal(c.governor.savings, 20);
  assert.equal(c.finance.thisYear.salary, 20);
  assert.equal(c.treasury, t0 - 20, 'nothing else moves the treasury of an empty city');
  assert.equal(ledgerNet({ ...c.finance.thisYear }), -20);
});

test('salary: a whole year at the rank\'s rate (a Procurator, 240 Dn) changes no favor', () => {
  const game = governed({ rank: 5 });
  game.runTicks(12 * TICKS_PER_MONTH);
  const c = game.city;
  assert.equal(game.time.month, 0, 'New Year has come');
  assert.equal(c.governor.savings, 240);
  assert.equal(c.finance.lastYear.salary, 240, 'twelve payments in the year, the last on New Year\'s Day before the books close');
  assert.equal(c.governor.paidThisYear, 0, 'the count starts again');
  assert.equal(c.ratings.favor, 50);
  assert.equal(salaryMessages(game).length, 0);
});

test('salary, worked example 1: a Quaestor drawing an Aedile\'s 30 Dn saves 360 a year and loses 2 favor; an Architect\'s 8 Dn saves 96 and gains 1', () => {
  for (const [rate, saved, favor] of [[6, 360, 48], [3, 96, 51]]) {
    const game = governed({ rank: 4 });
    const t0 = game.city.treasury;
    assert.ok(setSalary(game, rate).ok);
    game.runTicks(12 * TICKS_PER_MONTH);
    const c = game.city;
    assert.equal(c.governor.savings, saved);
    assert.equal(c.treasury, t0 - saved);
    assert.equal(c.ratings.favor, favor);
    assert.equal(salaryMessages(game).length, 1);
  }
});

test('salary, worked example 2: Caesar\'s pay all year, switched back on the last day, is judged on what was paid', () => {
  // The original looked only at the rate set on New Year's Eve (no favor
  // lost); Colonia judges the year's pay: 1,100 Dn is a Caesar's (a
  // Proconsul's year is 960), six ranks above a Quaestor.
  const game = governed({ rank: 4 });
  setSalary(game, 10);
  game.runTicks(11 * TICKS_PER_MONTH);
  assert.equal(game.city.governor.paidThisYear, 1100);
  setSalary(game, 4); // the last month at his own rate
  game.runTicks(TICKS_PER_MONTH);
  assert.equal(game.city.governor.savings, 1112);
  assert.equal(game.city.ratings.favor, 44);
  assert.match(salaryMessages(game)[0].text, /1112 Dn last year is a Caesar's pay, above your rank of Quaestor\. Favor -6\./);
});

test('salary: the yearly rule, worked through', () => {
  assert.equal(rankForYearPay(0), 0);
  assert.equal(rankForYearPay(24), 1);
  assert.equal(rankForYearPay(25), 2, 'a penny over a Clerk\'s year is an Engineer\'s pay');
  assert.equal(rankForYearPay(1200), 10);
  assert.equal(rankForYearPay(5000), 10);
  assert.equal(salaryFavor(4, 360), -2);
  assert.equal(salaryFavor(4, 144), 0);
  assert.equal(salaryFavor(4, 96), 1);
  assert.equal(salaryFavor(4, 0), 1, 'below the rank is +1 however far below');
  assert.equal(salaryFavor(0, 0), 0, 'a Citizen can never earn the +1');
  assert.equal(salaryFavor(0, 1200), -10);
  assert.equal(salaryOf(7), 40);
});

test('salary: never paid when the treasury cannot cover it, so it never puts the city in debt', () => {
  const game = governed({ rank: 5, money: 30 });
  const c = game.city;
  assert.equal(paySalary(game), 20);
  assert.equal(c.treasury, 10);
  assert.equal(paySalary(game), 0, '10 Dn left: no salary');
  assert.equal(c.treasury, 10);
  c.treasury = -500;
  assert.equal(paySalary(game), 0);
  assert.equal(c.governor.savings, 20);
  assert.equal(c.governor.paidThisYear, 20, 'the year counts what was paid');
});

test('salary: Rome stops it once the mission is won, and judges no more', () => {
  const game = governed({ rank: 4 });
  setSalary(game, 10);
  game.city.victory = true;
  assert.equal(paySalary(game), 0);
  assert.equal(setSalary(game, 2).ok, false);
  game.city.governor.paidThisYear = 1200;
  assert.equal(salaryNewYear(game), 0);
  assert.equal(game.city.governor.paidThisYear, 0);
  assert.equal(salaryNow(game), 'none (mission won)');
});

test('salary: what was drawn above the rank in the year of victory is taken back before the savings go on', () => {
  // The year of victory is never weighed at a New Year (the salary stops),
  // so Caesar's pay from New Year to the victory once cost nothing and went
  // on to the next mission. A Quaestor (12 Dn) won in Iunius (month 5): five
  // months' pay are due him, 60 Dn.
  const game = governed({ rank: 4, savings: 1000 });
  const c = game.city;
  assert.equal(salaryMonthsSoFar(5), 5);
  assert.equal(salaryMonthsSoFar(0), 12, 'the payment as Ianuarius begins is December\'s');
  game.time.month = 5;
  c.governor.paidThisYear = 500; // Caesar's 100 Dn for five months
  assert.equal(salaryAtVictory(game), 440);
  assert.equal(c.governor.savings, 560);
  assert.ok(game.messages.some((m) => /taken back 440 Dn/.test(m.text)));
  c.governor.paidThisYear = 60;
  assert.equal(salaryAtVictory(game), 0, 'his own rank\'s pay is his');
  // checkOutcome does it as it declares the victory.
  const won = governed({ rank: 4, savings: 1000 });
  won.time.month = 5;
  won.city.governor.paidThisYear = 500;
  won.scenario.goals = { population: 1 };
  won.city.population = 10;
  checkOutcome(won);
  assert.equal(won.city.victory, true);
  assert.equal(won.city.governor.savings, 560);
});

test('salary: a treasury too poor to pay him earns no thanks for a modest salary', () => {
  const game = governed({ rank: 5 }); // a Procurator drawing his own 20 Dn
  game.city.governor.paidThisYear = 100; // paid only five months
  assert.equal(salaryNewYear(game), 0);
  assert.equal(salaryMessages(game).length, 0);
  setSalary(game, 3); // chose an Architect's pay
  game.city.governor.paidThisYear = 96;
  assert.equal(salaryNewYear(game), 1);
});

test('savings: a damaged campaign record is replaced, so the victory screen still opens', () => {
  for (const bad of [5, '5', [], null, undefined]) {
    const progress = { savings: bad };
    const rec = savingsRecord(progress);
    assert.deepEqual(rec, {});
    assert.equal(storeCampaignSavings(rec, 'c1', 300), 'c2');
    assert.equal(progress.savings.c2, 300);
  }
  const ok = { savings: { c3: 90 } };
  assert.equal(savingsRecord(ok).c3, 90, 'a sound record is kept');
});

test('salary: set to any rank\'s rate, nothing else', () => {
  const game = governed();
  for (const bad of [-1, 11, 2.5, '3', null]) assert.equal(setSalary(game, bad).ok, false);
  assert.ok(setSalary(game, 0).ok);
  assert.equal(game.city.governor.salaryRank, 0);
  assert.ok(setSalary(game, 10).ok);
});

test('salary: the outlook for New Year counts what was paid and the months left at today\'s rate', () => {
  const game = governed({ rank: 4 });
  game.runTicks(3 * TICKS_PER_MONTH); // three payments of 12
  setSalary(game, 6);
  assert.deepEqual(salaryOutlook(game), { paid: 36 + 9 * 30, worth: 6, favor: -2 });
  setSalary(game, 4);
  assert.deepEqual(salaryOutlook(game), { paid: 144, worth: 4, favor: 0 });
});

// ---------------------------------------------------------------------------
// Gifts to the Emperor
// ---------------------------------------------------------------------------

test('gifts, worked example 3: savings 400 price them at 70, 150 and 300; a lavish one gives +10, and the next month a modest one +1', () => {
  const game = governed({ savings: 400 });
  const c = game.city;
  c.ratings.favor = 30;
  const t0 = c.treasury;
  assert.deepEqual([0, 1, 2].map((s) => giftCost(game, s)), [70, 150, 300]);
  assert.deepEqual([0, 1, 2].map((s) => giftFavor(game, s)), [3, 5, 10]);
  assert.deepEqual(sendGift(game, 2), { ok: true, cost: 300, favor: 10 });
  assert.equal(c.governor.savings, 100);
  assert.equal(c.ratings.favor, 40);
  assert.equal(c.treasury, t0, 'gifts never touch the treasury');
  giftsMonth(game);
  assert.equal(giftCost(game, 2), 150, 'half of 100, plus 100');
  const no = sendGift(game, 2);
  assert.equal(no.ok, false);
  assert.match(no.reason, /costs 150 Dn and your savings hold 100 Dn/);
  assert.equal(giftCost(game, 0), 32);
  assert.deepEqual(sendGift(game, 0), { ok: true, cost: 32, favor: 1 }, 'the second gift within a year');
  assert.equal(c.governor.savings, 68);
  assert.equal(c.ratings.favor, 41);
});

test('gifts: each further gift within a year pleases less; one that would please no more is refused and costs nothing', () => {
  const game = governed({ savings: 100000 });
  const c = game.city;
  c.ratings.favor = 0;
  const got = [];
  for (let k = 0; k < 5; k++) got.push(sendGift(game, 2).favor);
  assert.deepEqual(got, [10, 5, 3, 1, undefined]);
  const savings = c.governor.savings;
  const res = sendGift(game, 2);
  assert.equal(res.ok, false);
  assert.match(res.reason, /4 gifts from you within a year: another lavish gift would please him no more\. Gifts count in full again 12 months after your last one\./);
  assert.equal(c.governor.savings, savings);
  assert.equal(c.ratings.favor, 19);
  assert.equal(giftFavor(game, 0), 0);
  assert.equal(giftFavor(game, 1), 0);
});

test('gifts: the count starts again 12 months after the latest gift', () => {
  const game = governed({ savings: 5000 });
  const gf = game.city.gifts;
  sendGift(game, 1);
  for (let m = 0; m < 6; m++) giftsMonth(game);
  sendGift(game, 1); // the second, six months later: its 12 months start again
  assert.equal(gf.recent, 2);
  for (let m = 0; m < GIFT_MEMORY_MONTHS - 1; m++) giftsMonth(game);
  assert.equal(gf.recent, 2, '11 months after the last');
  giftsMonth(game);
  assert.deepEqual([gf.recent, gf.monthsSince], [0, 0]);
  assert.equal(giftFavor(game, 1), 5);
  // In a running game the count moves at each month's end.
  sendGift(game, 0);
  game.runTicks(12 * TICKS_PER_MONTH);
  assert.equal(gf.recent, 0);
});

test('gifts: none at all from empty savings; the four gifts of each size take turns', () => {
  const game = governed({ savings: 0 });
  assert.equal(sendGift(game, 0).ok, false);
  game.city.governor.savings = 100000;
  for (let k = 0; k < 5; k++) {
    sendGift(game, 0);
    game.city.gifts.recent = 0;
  }
  const items = game.messages.filter((m) => /delights the Emperor/.test(m.text)).map((m) => m.text.match(/gift of (.+?) \(\d/)[1]).reverse();
  assert.deepEqual(items, [...GIFT_SIZES[0].items, GIFT_SIZES[0].items[0]]);
});

// ---------------------------------------------------------------------------
// Donations
// ---------------------------------------------------------------------------

test('donations: savings into the treasury, a ledger line of their own that is not profit', () => {
  const game = governed({ savings: 800 });
  const c = game.city;
  const t0 = c.treasury;
  assert.deepEqual(donate(game, 500), { ok: true, amount: 500 });
  assert.equal(c.governor.savings, 300);
  assert.equal(c.treasury, t0 + 500);
  assert.equal(c.finance.thisYear.donations, 500);
  assert.equal(ledgerNet(c.finance.thisYear), 0, 'a gift to the city is not its profit');
  assert.match(donate(game, 301).reason, /hold only 300 Dn/);
  assert.equal(donate(game, 0).ok, false);
  assert.equal(donate(game, 'x').ok, false);
  assert.ok(donate(game, 300).ok);
  assert.equal(c.governor.savings, 0);
});

// ---------------------------------------------------------------------------
// Savings across the campaign
// ---------------------------------------------------------------------------

test('savings carry from mission to mission (worked example 5); replaying a mission starts from what it started with', () => {
  const record = {};
  assert.equal(storeCampaignSavings(record, 'c5', 2000), 'c6');
  assert.deepEqual(record, { c6: 2000 });
  assert.equal(campaignSavings(record, 'c6'), 2000);
  const game = new Game({ scenario: findScenario('c6'), savings: campaignSavings(record, 'c6') });
  assert.equal(game.city.governor.savings, 2000);
  assert.equal(game.city.governor.rank, 5);
  // Mission 6 won again later with less: mission 7 starts from that.
  storeCampaignSavings(record, 'c6', 150);
  storeCampaignSavings(record, 'c6', 90);
  assert.equal(campaignSavings(record, 'c7'), 90);
  assert.equal(campaignSavings(record, 'c6'), 2000, 'mission 6 keeps what it started with');
  // The first mission, the sandbox and the last mission's victory.
  assert.equal(campaignSavings(record, 'c1'), 0);
  assert.equal(campaignSavings({ sandbox: 500 }, 'sandbox'), 0);
  assert.equal(storeCampaignSavings(record, 'c7', 5000), null);
  assert.equal(campaignSavings(undefined, 'c3'), 0);
  assert.equal(new Game({ scenario: findScenario('c1') }).city.governor.savings, 0);
});

// ---------------------------------------------------------------------------
// The residence
// ---------------------------------------------------------------------------

test('residences: house 3x3, villa 4x4, palace 5x5 at the original\'s prices and desirability; no workers, no road', () => {
  const want = { governor_house: [3, 150, [12, 2, -2, 3]], governor_villa: [4, 400, [20, 2, -3, 4]], governor_palace: [5, 750, [28, 2, -4, 5]] };
  for (const [k, [size, cost, des]] of Object.entries(want)) {
    const d = BUILDINGS[k];
    assert.deepEqual([d.size, d.cost, d.des, d.workers, d.needsRoad, d.kind, d.category], [size, cost, des, 0, false, 'residence', 'government']);
    assert.ok(d.fire > 0 && d.damage > 0, 'none is fire-proof');
  }
  assert.equal(BUILDINGS.governor_house.name, 'Praetorium');
  assert.equal(BUILDINGS.governor_house.en, 'Governor\'s House');
});

test('residences: the house from mission 1, the villa from mission 3, the palace from mission 5', () => {
  const first = (k) => SCENARIOS.findIndex((s) => s.unlocks === 'all' || s.unlocks.includes(k)) + 1;
  assert.deepEqual([first('governor_house'), first('governor_villa'), first('governor_palace')], [1, 3, 5]);
  for (const s of SCENARIOS) {
    const has = (k) => s.unlocks === 'all' || s.unlocks.includes(k);
    if (has('governor_palace')) assert.ok(has('governor_villa'));
    if (has('governor_villa')) assert.ok(has('governor_house'));
  }
});

test('residences: one stands at a time; a second is refused with the reason until the first is demolished', () => {
  const game = newGame({ seed: 'residence' });
  const spot = findFree(game, 6, 6);
  const res = build(game, 'governor_house', spot.x + 1, spot.y + 1);
  assert.ok(res.ok, JSON.stringify(res));
  const house = residenceOf(game);
  assert.equal(house.type, 'governor_house');
  assert.equal(house.accessRoad < 0, true, 'no road anywhere near, and none needed');
  const far = findFree(game, 6, 6, { x: game.map.w - 8, y: game.map.h - 8 });
  const no = checkBuilding(game, 'governor_palace', far.x, far.y);
  assert.equal(no.ok, false);
  assert.equal(no.reason, 'You already have a residence (Praetorium): only one may stand at a time. Demolish it first to build another.');
  assert.equal(checkBuilding(game, 'governor_house', far.x, far.y).ok, false);
  removeBuilding(game, house);
  assert.ok(checkBuilding(game, 'governor_palace', far.x, far.y).ok);
});

test('residences: desirability by the spec\'s rings', () => {
  const game = newGame({ size: 64, seed: 'residence-des' });
  const spot = findFree(game, 13, 13);
  const before = (dx) => game.map.desirability[(spot.y + 6) * game.map.w + spot.x + dx];
  updateDesirability(game);
  const base = [4, 3, 2, 1, 0].map((d) => before(d));
  addBuilding(game, 'governor_palace', spot.x + 5, spot.y + 4);
  updateDesirability(game);
  // West of the palace: rings 1 to 5 get 28, 28, 24, 24, 20.
  assert.deepEqual([4, 3, 2, 1, 0].map((d, k) => before(d) - base[k]), [28, 28, 24, 24, 20]);
});

test('residences: rioters go for the governor\'s residence before anything else', () => {
  assert.deepEqual(RIOT_TARGETS[0], { kind: 'residence' });
  const game = newGame({ size: 128, type: 'plains', seed: 'riot-residence' });
  const senate = addBuilding(game, 'senate', 20, 20);
  const villa = addBuilding(game, 'governor_villa', 40, 20);
  assert.equal(riotRank(villa), 0);
  assert.ok(riotRank(senate) > 0);
  assert.equal(pickRiotTarget(game, 22, 30).id, villa.id, 'the residence, though the Senate is nearer');
});

// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

test('save: the governor, his savings and his gifts survive a save', () => {
  const game = governed({ rank: 3, savings: 640 });
  setSalary(game, 7);
  game.runTicks(2 * TICKS_PER_MONTH);
  sendGift(game, 1);
  addBuilding(game, 'governor_villa', 10, 10);
  const copy = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  assert.deepEqual(copy.city.governor, game.city.governor);
  assert.deepEqual(copy.city.gifts, game.city.gifts);
  assert.equal(residenceOf(copy).type, 'governor_villa');
  assert.equal(copy.scenario.rank, 3, 'a sandbox keeps its chosen rank');
  assert.ok(CONFIG.SAVE_VERSION >= 13, 'the governor came in save version 13');
});

test('save: a real version 11 save (mission 3, a gift sent 2 months before) loads at the mission\'s rank with no savings', () => {
  // Written by v0.13.4 (save version 11): Figlina in Iun 255 BC, a generous
  // gift sent in Apr from the treasury, 4 months of the old 6-month wait left.
  const raw = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/save-v11-gift-sent.json'), 'utf8'));
  assert.equal(raw.version, 11);
  assert.equal(raw.city.giftCooldown, 4);
  assert.equal(raw.city.governor, undefined);
  const game = deserializeGame(raw);
  const c = game.city;
  assert.equal(game.time.month, 5);
  assert.deepEqual(c.governor, { rank: 2, salaryRank: 2, savings: 0, paidThisYear: 25 }, 'an Engineer, as if paid 5 Dn for the five months gone');
  assert.deepEqual(c.gifts, { recent: 1, monthsSince: 2, sent: [0, 0, 0] });
  assert.ok(!('giftCooldown' in c));
  assert.equal(giftFavor(game, 1), 3, 'the next generous gift within the year is the second');
  // It plays on to New Year: 60 Dn paid, an Engineer's year, so no verdict.
  game.runTicks(7 * TICKS_PER_MONTH);
  assert.equal(game.time.month, 0);
  assert.equal(c.finance.lastYear.salary, 35, 'the seven months since the load');
  assert.equal(salaryMessages(game).length, 0);
  assert.equal(serializeGame(game).version, CONFIG.SAVE_VERSION);
});

test('save: the upgrade gives a sandbox the middle rank, maps no wait to no gifts, and leaves a version 13 city alone', () => {
  const game = governed({ rank: 7, savings: 9 });
  const keep = JSON.stringify([game.city.governor, game.city.gifts]);
  upgradeGovernorV12(game);
  assert.equal(JSON.stringify([game.city.governor, game.city.gifts]), keep);
  delete game.city.governor;
  delete game.city.gifts;
  game.city.giftCooldown = 0;
  delete game.scenario.rank; // as an older sandbox's scenario has none
  upgradeGovernorV12(game);
  assert.deepEqual(game.city.governor, newGovernorState({}));
  assert.equal(game.city.governor.rank, SANDBOX_RANK);
  assert.deepEqual(game.city.gifts, { recent: 0, monthsSince: 0, sent: [0, 0, 0] });
});

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

test('words: the Imperial advisor, the briefing and the victory screen', () => {
  const game = governed({ rank: 4, savings: 400 });
  assert.equal(rankLine(game), 'Quaestor, chosen when the city was founded');
  assert.equal(rankLine(new Game({ scenario: findScenario('c2') })), 'Clerk, the rank of mission 2');
  assert.equal(salaryOption(4, 4), 'Quaestor: 12 Dn a month (your rank)');
  assert.equal(salaryOption(10, 4), 'Caesar: 100 Dn a month');
  assert.equal(salaryNow(game), '12 Dn a month (Quaestor\'s rate)');
  assert.equal(salaryOutlookText(game), 'At this rate you will have drawn 144 Dn by New Year, a Quaestor\'s pay: Rome expects no less and minds no more.');
  setSalary(game, 6);
  assert.equal(salaryOutlookText(game), 'At this rate you will have drawn 360 Dn by New Year, an Aedile\'s pay, above your rank of Quaestor: Rome takes 2 favor for it then.');
  setSalary(game, 0);
  assert.equal(salaryOutlookText(game), 'At this rate you will have drawn 0 Dn by New Year, less than a Quaestor\'s pay: Rome will think well of it (+1 favor).');
  assert.deepEqual([0, 1, 2].map((s) => giftLabel(game, s)), ['Modest gift: 70 Dn (+3 favor)', 'Generous gift: 150 Dn (+5 favor)', 'Lavish gift: 300 Dn (+10 favor)']);
  assert.equal(giftBlocked(game, 2), null);
  game.city.governor.savings = 100;
  assert.equal(giftBlocked(game, 2), 'Costs 150 Dn; your savings hold 100 Dn.');
  assert.match(giftNote(game), /^A gift is paid from your savings and costs more the more you have saved: a modest one an eighth of your savings plus 20 Dn, a generous one a quarter of your savings plus 50 Dn, a lavish one half your savings plus 100 Dn\./);
  game.city.gifts = { recent: 4, monthsSince: 3, sent: [0, 0, 4] };
  assert.equal(giftLabel(game, 2), 'Lavish gift: 150 Dn (no favor)');
  assert.match(giftBlocked(game, 2), /would please him no more/);
  assert.match(giftNote(game), /Gifts he has had from you lately: 4; the count starts again 9 months from now if you send no more\.$/);
  assert.equal(briefingGovernorLine(findScenario('c1'), 0), 'You govern as a Citizen, with a salary of 0 Dn a month.');
  assert.equal(briefingGovernorLine(findScenario('c7'), 2500), 'You govern as an Aedile, with a salary of 30 Dn a month and 2,500 Dn of savings from your last post.');
  const won = new Game({ scenario: findScenario('c3'), savings: 1234 });
  assert.equal(victoryGovernorLine(won), 'Rome promotes you to Architect. Your savings of 1,234 Dn go with you to Pons Aelius.');
  assert.equal(victoryGovernorLine(new Game({ scenario: findScenario('c7') })), 'Your savings of 0 Dn are yours to keep.');
  assert.equal(victoryGovernorLine(game), null);
});

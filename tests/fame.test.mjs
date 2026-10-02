/**
 * fame.test.mjs - the Hall of Fame (sim/fame.js): a win's score from the
 * spec's worked example, its caps and the difficulty's multiplier; the ten
 * best wins in order, each mission once with its best, a lower replay
 * changing nothing; the career with the Caesar bonus; what is stored, read
 * back safely from junk; a game's win (the sandbox not scored).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { log } from '../src/core/debug.js';
import { Game } from '../src/core/game.js';
import { findScenario, withDifficulty, LAST_STEP, missionsAtStep } from '../src/data/scenarios.js';
import { winScore, winOf, recordWin, newFame, cleanFame, careerScore, ordinal, FAME_TOP, FAME_CAESAR } from '../src/sim/fame.js';
import { newGame } from './helpers.mjs';

log.setLevel('error');

const FIRMUM = { ratings: { culture: 45, prosperity: 30, peace: 50, favor: 40 }, population: 1800, goal: 1600, paceYears: 4.5, months: 72, difficulty: 'normal', battles: 1, raids: 2 };

test('fame: the worked example scores 452 (Firmum on Normal)', () => {
  const s = winScore(FIRMUM);
  assert.deepEqual(s, { ratings: 165, population: 112, pace: 75, mult: 1, base: 352, battles: 50, raids: 50, score: 452 });
});

test('fame: the population part stops at 200 and the pace part at 150; the difficulty multiplies the base, not the battles and raids', () => {
  const s = winScore({ ...FIRMUM, population: 5000, months: 12 });
  assert.equal(s.population, 200);
  assert.equal(s.pace, 150);
  const easy = winScore({ ...FIRMUM, difficulty: 'easy' });
  const insane = winScore({ ...FIRMUM, difficulty: 'insane' });
  const hard = winScore({ ...FIRMUM, difficulty: 'hard' });
  assert.equal(easy.base, 176);
  assert.equal(hard.base, 528);
  assert.equal(insane.base, 704);
  assert.equal(insane.score, 704 + 100, 'battles and raids are not doubled');
  assert.equal(winScore({ ...FIRMUM, months: 54 }).pace, 100, 'as fast as the plan: 100');
});

/** A win record as winOf makes it. */
const win = (mission, score, step = 3) => ({ mission, name: mission, step, difficulty: 'normal', score, years: 5, parts: {}, ratings: {}, population: 0 });

test('fame: the hall keeps the ten best wins, best first, each mission once with its best', () => {
  const fame = newFame();
  const ids = ['c1', 'c2', 'c3', 'c3m', 'c4', 'c4p', 'c5', 'c5p', 'c6', 'c6p', 'c7', 'c7p'];
  ids.forEach((id, k) => recordWin(fame, win(id, 100 + k * 10, k + 1), '2026-10-02'));
  assert.equal(fame.wins.length, FAME_TOP);
  assert.deepEqual(fame.wins.map((w) => w.score), [210, 200, 190, 180, 170, 160, 150, 140, 130, 120]);
  assert.equal(fame.wins[0].date, '2026-10-02', 'the real date, for the list');
  // A replay that beats its own best moves up; its old line goes.
  const r = recordWin(fame, win('c1', 205, 1), '2026-10-03');
  assert.equal(r.best, true);
  assert.equal(r.place, 2, '2nd best win');
  assert.equal(fame.wins.filter((w) => w.mission === 'c1').length, 1);
  // A tie keeps the older win ahead.
  const t = recordWin(fame, win('c8m', 205, 8));
  assert.equal(t.place, 3);
});

test('fame: a replay that scores lower changes nothing', () => {
  const fame = newFame();
  recordWin(fame, win('c3', 400), 'a');
  const before = JSON.stringify(fame);
  const r = recordWin(fame, win('c3', 300), 'b');
  assert.deepEqual(r, { place: 0, best: false, previous: 400, career: 400 });
  assert.equal(JSON.stringify(fame), before);
});

test('fame: the career adds the best win at each step, and 500 once the last step is won', () => {
  const fame = newFame();
  recordWin(fame, win('c3', 300, 3));
  recordWin(fame, win('c3m', 350, 3)); // the same step: the better counts
  recordWin(fame, win('c4', 200, 4));
  assert.equal(careerScore(fame), 550);
  const last = missionsAtStep(LAST_STEP)[0].id;
  const r = recordWin(fame, win(last, 100, LAST_STEP), '2026-10-02');
  assert.equal(r.career, 650 + FAME_CAESAR);
  assert.deepEqual(fame.career, { score: 650 + FAME_CAESAR, date: '2026-10-02' });
  assert.equal(fame.careers, 1, 'hailed Caesar once');
});

test('fame: what is stored reads back the same, and junk reads back as an empty hall', () => {
  const fame = newFame();
  recordWin(fame, win('c3', 300), '2026-10-02');
  assert.deepEqual(cleanFame(JSON.parse(JSON.stringify(fame))), fame);
  assert.deepEqual(cleanFame(null), newFame());
  assert.deepEqual(cleanFame('nonsense'), newFame());
  const odd = cleanFame({ wins: [null, { mission: 'c3', score: 'x' }, { mission: 'c2', score: 5 }], best: { nowhere: { score: 9 } }, career: 7 });
  assert.equal(odd.wins.length, 1);
  assert.deepEqual(odd.best, {});
  assert.deepEqual(odd.career, { score: 0, date: null });
});

test('fame: a campaign game\'s win is scored from its ratings, people, years, battles and raids; the sandbox is not', () => {
  assert.equal(winOf(newGame()), null, 'the sandbox');
  const game = new Game({ scenario: withDifficulty(findScenario('c3m'), 'hard') });
  const c = game.city;
  c.ratings = { culture: 45, prosperity: 30, peace: 50, favor: 40 };
  c.population = 1650;
  game.time.totalMonths = 60;
  game.military.battles.won = 2;
  game.military.stats.repelled = 1;
  const w = winOf(game);
  const s = game.scenario;
  const expect = winScore({ ratings: c.ratings, population: 1650, goal: s.goals.population, paceYears: s.paceYears, months: 60, difficulty: 'hard', battles: 2, raids: 1 });
  assert.equal(w.mission, 'c3m');
  assert.equal(w.step, 3);
  assert.equal(w.difficulty, 'hard');
  assert.equal(w.years, 5);
  assert.equal(w.score, expect.score);
  assert.equal(w.parts.battles, 100);
  assert.equal(w.parts.raids, 25);
  assert.equal(w.parts.mult, 1.5);
});

test('fame: ordinals', () => {
  assert.deepEqual([1, 2, 3, 4, 10, 11, 12, 13, 21, 22, 23].map(ordinal), ['1st', '2nd', '3rd', '4th', '10th', '11th', '12th', '13th', '21st', '22nd', '23rd']);
});

test('fame: a win by the console, or in a city built for free, is not scored; Caesar hails a governor once a province', () => {
  const game = new Game({ scenario: withDifficulty(findScenario('c3m'), 'normal') });
  assert.ok(winOf(game), 'won by play: scored');
  game.city.flags.consoleWin = true;
  assert.equal(winOf(game), null);
  const g2 = new Game({ scenario: withDifficulty(findScenario('c3m'), 'normal') });
  g2.city.flags.freeBuilt = true;
  assert.equal(winOf(g2), null);
  const fame = newFame();
  const last = missionsAtStep(LAST_STEP)[0].id;
  recordWin(fame, win(last, 100, LAST_STEP));
  recordWin(fame, win(last, 200, LAST_STEP)); // (the same province again, from a save)
  assert.equal(fame.careers, 1);
});

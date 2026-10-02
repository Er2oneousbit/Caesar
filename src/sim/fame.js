/**
 * fame.js
 * ----------------------------------------------------------------------------
 * The Hall of Fame: a score for each campaign win, the ten best wins and the
 * career's score. Not in Caesar III (its end screen showed the ratings, the
 * people and the treasury, and kept no list); Colonia's own design, with a
 * mission's goals and its planned pace (sim/pace.js, `paceYears`) as a fair
 * yardstick for every mission.
 *
 * Score of one win (winScore):
 *   R = the four ratings at the win, added (0 to 400)
 *   P = 100 x population / the population goal, at most 200 (whole points)
 *   S = 100 x paceYears / years taken, at most 150 (100 when as fast as the
 *       plan allows; whole points)
 *   D = the difficulty: Easy 0.5, Normal 1, Hard 1.5, Insane 2
 *   score = round(D x (R + P + S)) + 50 for each distant battle won and 25
 *   for each raid repelled in that mission (shown as lines of their own).
 *   Worked example: Firmum on Normal, ratings 45 + 30 + 50 + 40 = 165; 1,800
 *   people for a goal of 1,600: P 112; won in 6 years where the plan says
 *   4.5: S 75; one battle won and two raids repelled: 352 + 50 + 50 = 452.
 *
 * The career: the best win at each step of the campaign, added, plus 500
 * once a province of the last step is won (Rome hails the governor Caesar).
 * Missions can be replayed: each keeps its best win, and a replay that
 * scores lower changes nothing. The ten best wins list each mission once,
 * with its best.
 *
 * What is kept lives in the browser beside the campaign's progress (app.js,
 * `${STORAGE_PREFIX}fame`), never in a game save, and the sim never reads
 * it. The sandbox is not scored: its goals are the player's own.
 * ----------------------------------------------------------------------------
 */

import { LAST_STEP, stepOf } from '../data/scenarios.js';

/** The score's multiplier for each difficulty. */
export const FAME_MULT = Object.freeze({ easy: 0.5, normal: 1, hard: 1.5, insane: 2 });
/** Points for each distant battle won and each raid repelled in the mission. */
export const FAME_BATTLE = 50;
export const FAME_RAID = 25;
/** Points a career gets once a province of the last step is won. */
export const FAME_CAESAR = 500;
/** How many wins the hall lists. */
export const FAME_TOP = 10;

/** A hall with nothing in it. */
export function newFame() {
  return { wins: [], best: {}, career: { score: 0, date: null }, careers: 0 };
}

/**
 * A hall read back from storage, made safe: anything missing or broken
 * starts empty, so a hand-edited or old record never stops the menu.
 */
export function cleanFame(raw) {
  const out = newFame();
  if (!raw || typeof raw !== 'object') return out;
  if (Array.isArray(raw.wins)) out.wins = raw.wins.filter((w) => w && typeof w.mission === 'string' && Number.isFinite(w.score)).slice(0, FAME_TOP);
  if (raw.best && typeof raw.best === 'object') {
    for (const [id, b] of Object.entries(raw.best)) if (b && Number.isFinite(b.score) && stepOf(id)) out.best[id] = { score: b.score, step: stepOf(id) };
  }
  if (raw.career && Number.isFinite(raw.career.score)) out.career = { score: raw.career.score, date: typeof raw.career.date === 'string' ? raw.career.date : null };
  if (Number.isFinite(raw.careers)) out.careers = raw.careers;
  return out;
}

/**
 * The score of a win from its numbers.
 * @param {object} w  { ratings: {culture, prosperity, peace, favor}, population, goal, paceYears, months, difficulty, battles, raids }
 * @returns {{ratings:number, population:number, pace:number, mult:number, base:number, battles:number, raids:number, score:number}}
 */
export function winScore(w) {
  const r = w.ratings || {};
  const R = Math.round((r.culture || 0) + (r.prosperity || 0) + (r.peace || 0) + (r.favor || 0));
  // No population goal: as if met exactly (no mission has none, but a fair default).
  const P = w.goal > 0 ? Math.min(200, Math.floor((100 * (w.population || 0)) / w.goal)) : 100;
  const years = (w.months || 0) / 12;
  const S = w.paceYears > 0 && years > 0 ? Math.min(150, Math.floor((100 * w.paceYears) / years)) : 100;
  const mult = FAME_MULT[w.difficulty] ?? 1;
  const base = Math.round(mult * (R + P + S));
  const battles = (w.battles || 0) * FAME_BATTLE;
  const raids = (w.raids || 0) * FAME_RAID;
  return { ratings: R, population: P, pace: S, mult, base, battles, raids, score: base + battles + raids };
}

/** A campaign win's record from the game at its victory, or null for the sandbox. */
export function winOf(game) {
  const s = game.scenario;
  const step = stepOf(s.id);
  if (!step) return null;
  const c = game.city;
  const ratings = {
    culture: Math.round(c.ratings.culture),
    prosperity: Math.round(c.ratings.prosperity),
    peace: Math.round(c.ratings.peace),
    favor: Math.round(c.ratings.favor),
  };
  const m = game.military || {};
  const numbers = {
    ratings,
    population: c.population,
    goal: s.goals?.population || 0,
    paceYears: s.paceYears || 0,
    months: game.time.totalMonths,
    difficulty: game.difficultyKey,
    battles: m.battles?.won || 0,
    raids: m.stats?.repelled || 0,
  };
  return {
    mission: s.id,
    name: s.name,
    step,
    difficulty: game.difficultyKey,
    years: Math.round((game.time.totalMonths / 12) * 10) / 10,
    paceYears: numbers.paceYears,
    ratings,
    population: c.population,
    battlesWon: numbers.battles,
    raidsRepelled: numbers.raids,
    parts: winScore(numbers),
    score: winScore(numbers).score,
  };
}

/** The career's score from each mission's best: the best win at each step, plus FAME_CAESAR once the last step is won. */
export function careerScore(fame) {
  const byStep = new Map();
  for (const b of Object.values(fame.best)) byStep.set(b.step, Math.max(byStep.get(b.step) || 0, b.score));
  let sum = 0;
  for (const v of byStep.values()) sum += v;
  return sum + (byStep.has(LAST_STEP) ? FAME_CAESAR : 0);
}

/**
 * Put a win in the hall. `date` is the real date (for the list only).
 * @returns {{place:number, best:boolean, previous:number, career:number}}
 *   place: its place among the ten best (1-based), 0 when it is not there;
 *   best: it beat the mission's best (or was its first win); previous: the
 *   mission's best before it (0 for none); career: the career's score now
 */
export function recordWin(fame, win, date = null) {
  const prev = fame.best[win.mission]?.score || 0;
  const better = !fame.best[win.mission] || win.score > prev;
  if (win.step === LAST_STEP) fame.careers = (fame.careers || 0) + 1;
  if (better) {
    fame.best[win.mission] = { score: win.score, step: win.step };
    // One line a mission, with its best; ties keep the older win ahead.
    const entry = { ...win, date };
    const list = fame.wins.filter((w) => w.mission !== win.mission);
    let at = list.findIndex((w) => w.score < entry.score);
    if (at < 0) at = list.length;
    list.splice(at, 0, entry);
    fame.wins = list.slice(0, FAME_TOP);
    const career = careerScore(fame);
    if (career > fame.career.score) fame.career = { score: career, date };
  }
  const place = fame.wins.findIndex((w) => w.mission === win.mission && w.score === win.score) + 1;
  return { place: better ? place : 0, best: better, previous: prev, career: careerScore(fame) };
}

/** "1st", "2nd", "3rd", "4th"... */
export function ordinal(n) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

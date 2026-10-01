/**
 * pace.js
 * ----------------------------------------------------------------------------
 * How fast a mission's goals can be met, worked out from the game's own rate
 * limits. It sets the length of the campaign's missions: the tests hold each
 * mission to its planned pace, and `npm run sim -- --pace` prints the table.
 *
 * The model is a floor, the pace of a city that is always ready: a home
 * waiting for every settler, a good mood (PACE_MOOD) from the first day, and
 * every rating already deserved, so each one only waits on its monthly step.
 * Real play is slower (the homes, farms and services have to be built first),
 * but the floor is what the goals decide.
 *
 *   population  settlers arrive at immigrationPerDay(mood), more in a new
 *               city's first months (sim/population.js)
 *   culture     rises at most CULTURE_STEP a month
 *   prosperity  rises at most PROSPERITY_STEP a month
 *   peace       rises PEACE_PER_MONTH a month from PEACE_START
 *   favor       requests met and gifts from the governor's savings buy it:
 *               it takes those, not time
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { immigrationPerDay } from './population.js';

/** The mood of a well-run city (the model's settlers come at this mood). */
export const PACE_MOOD = 70;

/** Months for immigration to bring `target` people, from none. */
export function populationMonths(target, { mood = PACE_MOOD, factor = 1 } = {}) {
  let pop = 0;
  for (let m = 0; m < 12000; m++) {
    const fresh = m < CONFIG.NEW_CITY_BONUS_MONTHS;
    const perMonth = immigrationPerDay(Math.min(100, mood + (fresh ? CONFIG.NEW_CITY_MOOD : 0)), fresh, factor) * CONFIG.DAYS_PER_MONTH;
    if (perMonth <= 0) return Infinity;
    if (pop + perMonth >= target) return m + (target - pop) / perMonth;
    pop += perMonth;
  }
  return Infinity;
}

/**
 * The fewest months each goal needs, and `fastest`: the mission's floor (the
 * slowest goal). goals: a scenario's goals.
 */
export function goalMonths(goals, opts) {
  const out = {
    population: goals.population ? populationMonths(goals.population, opts) : 0,
    culture: (goals.culture || 0) / CONFIG.CULTURE_STEP,
    prosperity: (goals.prosperity || 0) / CONFIG.PROSPERITY_STEP,
    peace: Math.max(0, (goals.peace || 0) - CONFIG.PEACE_START) / CONFIG.PEACE_PER_MONTH,
    favor: 0,
  };
  out.fastest = Math.max(out.population, out.culture, out.prosperity, out.peace, out.favor);
  return out;
}

/** Real minutes that many game months take at 1x speed. */
export function monthsToMinutes(months) {
  return (months * CONFIG.DAYS_PER_MONTH * CONFIG.TICKS_PER_DAY) / CONFIG.TICKS_PER_SECOND / 60;
}

/**
 * mood.js
 * ----------------------------------------------------------------------------
 * Home mood: how content each household is, for crime only. City mood
 * (computeSentiment in sim/population.js) keeps driving migration exactly as
 * before and never reads these.
 *
 * Twice a month (day 0, right after the month's city mood, and day 8) every
 * occupied home works out a target:
 *
 *   target = city mood + hunger + food variety + envy + desirability + untaxed
 *            (clamped 0-100)
 *
 *   hunger       a home whose level eats and has no food at all (it went
 *                without at its last meal and the pantry is still empty):
 *                -MOOD_HUNGER x its hunger streak (updates in a row like that,
 *                at most MOOD_HUNGER_STREAK); any food resets it. Tents forage.
 *   variety      +MOOD_FOOD_EXTRA per kind of food beyond its level's need
 *   envy         the poorest homes (up to MOOD_ENVY_TIER) in a city with villas,
 *                or with insulae: being poor among the rich hurts most
 *   desirability its street's desirability / MOOD_DES_DIV, +-MOOD_DES_MAX
 *   untaxed      +MOOD_UNTAXED while no tax collector has registered it
 *
 * The home's mood then moves toward the target by at most MOOD_STEP. (A pure
 * running total, as in the original game, walks every home to 0 or 100 on
 * any small imbalance; the target keeps homes near what their street
 * deserves.) A newly occupied home starts at the city's mood; an empty one
 * has none (null) and never breeds crime.
 *
 * Each home also records its reason: its own most negative term, else the
 * city's worst mood factor, for the house panel and the crime overlay.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { HOUSE_TIERS } from '../data/housing.js';
import { FOOD_TYPES } from '../data/goods.js';

/** Clamp to 0..100. */
const clamp100 = (v) => Math.max(0, Math.min(100, v));

/**
 * The envy penalty the poorest homes feel this update, from the levels the
 * city has (its tier counts, rebuilt daily): richest neighbors count.
 */
export function envyPenalty(game) {
  const counts = game.city.tierCounts || [];
  let villas = false;
  let insulae = false;
  for (let t = CONFIG.MOOD_ENVY_INSULA_TIER; t < counts.length; t++) {
    if (!counts[t]) continue;
    if (HOUSE_TIERS[t].patrician) villas = true;
    else insulae = true;
  }
  if (villas) return CONFIG.MOOD_ENVY_VILLAS;
  if (insulae) return CONFIG.MOOD_ENVY_INSULAE;
  return 0;
}

/**
 * The city's worst mood factor (a key of city.sentimentFactors, most negative
 * first), or null when nothing drags the city down.
 */
export function cityMoodCause(game) {
  const f = game.city.sentimentFactors || {};
  let worst = null;
  for (const k of ['unemployment', 'food', 'taxes', 'wages', 'housing', 'gods', 'difficulty']) {
    if (f[k] < 0 && (worst === null || f[k] < f[worst])) worst = k;
  }
  return worst;
}

/**
 * A home's own terms this update (the hunger streak is passed in, already
 * advanced). Pure: reads the home, changes nothing.
 * @returns {{hunger:number, variety:number, envy:number, squalor:number, untaxed:number}}
 */
export function localMoodTerms(h, streak, envy) {
  const t = HOUSE_TIERS[h.tier];
  let kinds = 0;
  for (const f of FOOD_TYPES) if (h.food[f] > 0.01) kinds++;
  const des = h.des || 0;
  return {
    hunger: -CONFIG.MOOD_HUNGER * streak,
    variety: t.eats ? Math.min(CONFIG.MOOD_FOOD_EXTRA_MAX, Math.max(0, kinds - t.food) * CONFIG.MOOD_FOOD_EXTRA) : 0,
    envy: h.tier <= CONFIG.MOOD_ENVY_TIER ? envy : 0,
    squalor: Math.max(-CONFIG.MOOD_DES_MAX, Math.min(CONFIG.MOOD_DES_MAX, Math.trunc(des / CONFIG.MOOD_DES_DIV))),
    untaxed: h.tax > 0 ? 0 : CONFIG.MOOD_UNTAXED,
  };
}

/** One home's mood update (it must be occupied). */
export function updateHomeMood(game, b, envy, cityCause) {
  const h = b.house;
  const s = game.city.sentiment;
  const t = HOUSE_TIERS[h.tier];
  if (h.mood === null || h.mood === undefined) h.mood = s; // new household
  let kinds = 0;
  for (const f of FOOD_TYPES) if (h.food[f] > 0.01) kinds++;
  // Hungry: it went without at its last meal (consumeHouse) and still has
  // nothing in the pantry. (The pantry alone would count a home that just ate
  // its last loaf as hungry.) Tents forage: they never go hungry.
  const hungry = t.eats && !!h.hungry && kinds === 0;
  h.hungerStreak = hungry ? Math.min(CONFIG.MOOD_HUNGER_STREAK, (h.hungerStreak || 0) + 1) : 0;
  const terms = localMoodTerms(h, h.hungerStreak, envy);
  let sum = 0;
  let worst = null;
  for (const k in terms) {
    sum += terms[k];
    if (terms[k] < 0 && (worst === null || terms[k] < terms[worst])) worst = k;
  }
  const target = clamp100(s + sum);
  const step = Math.max(-CONFIG.MOOD_STEP, Math.min(CONFIG.MOOD_STEP, target - h.mood));
  h.mood = clamp100(h.mood + step);
  h.moodTarget = target;
  h.moodReason = worst ?? cityCause;
}

/** Twice a month: every home's mood moves toward its target. */
export function updateHomeMoods(game) {
  const envy = envyPenalty(game);
  const cause = cityMoodCause(game);
  for (const b of game.buildings.values()) {
    const h = b.house;
    if (!h) continue;
    if (h.pop <= 0) {
      // Nobody home: no mood, and the next family starts with a clean slate.
      h.mood = null;
      h.moodReason = null;
      h.hungerStreak = 0;
      h.criminal = 0;
      continue;
    }
    updateHomeMood(game, b, envy, cause);
  }
}

/**
 * A family moves into an empty home: it starts at the city's mood, with a
 * clean record (no criminal flag, no hunger), whatever the last family did.
 */
export function newHousehold(game, h) {
  h.mood = game.city.sentiment;
  h.moodReason = null;
  h.hungerStreak = 0;
  h.criminal = 0;
}

/** A riot spends the city's anger: every home's mood rises at once. */
export function liftAllMoods(game, amount) {
  for (const b of game.buildings.values()) {
    const h = b.house;
    if (h && h.pop > 0 && h.mood !== null && h.mood !== undefined) h.mood = clamp100(h.mood + amount);
  }
}

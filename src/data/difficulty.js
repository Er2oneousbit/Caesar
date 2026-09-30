/**
 * difficulty.js (data)
 * ----------------------------------------------------------------------------
 * Difficulty levels. Every lever the simulation reads lives in this one
 * table, so a level can be understood (and rebalanced) in one place.
 * Multipliers are relative to Normal (1 = no change); only `mood` is in points.
 *
 *   funds            starting treasury (sandbox and campaign)
 *   risk             how fast fire and collapse risk builds up
 *   production       farm, raw material and workshop speed
 *   immigration      settlers arriving per day
 *   mood             flat city-mood points (shown in the Overview advisor)
 *   winterGrowth     farm growth in winter (December to Februarius, x production):
 *                    1 = as the rest of the year, 0 = fields and herds rest until Martius
 *   raidSize         raiders per warband
 *   raidInterval     months until the first raid and between raids
 *   enemy            raider health and attack (and damage to buildings)
 *   requestSize      size of the Emperor's requests (goods and money)
 *   requestInterval  months between the Emperor's requests
 *   requestTime      months to deliver a request (x CONFIG.REQUEST_DEADLINE_MONTHS)
 *   devolveDays      bad days in a row before a home falls back a level (in days, not
 *                    a multiplier): 3 as in the original game, more forgiving on Easy
 *
 * Easy, Normal and Hard only use the first four levers plus raid size (and
 * Easy a longer devolveDays); Insane pulls on all of them. Balance check:
 * `npm run sim -- --difficulty insane` (scripts/simulate.mjs).
 *
 * Tuning notes (Insane, demo city over 12 maps, 4 years, no raids): risk 1.7
 * made a third of cities spiral (key service buildings burn or collapse
 * before the slower trickle of settlers can staff them), so it is 1.5: the
 * city ends about 2/3 the size of Normal's. With raids, the raid levers
 * matter less than the weaker economy; 1.5 x size, 1.15 x strength and 25%
 * shorter gaps need roughly twice Normal's army.
 *
 * Easy (demo city, 12 maps, 3 years): risk 0.7 meant 2.8 fires and 0.3
 * collapses per city, the first around month 17; 0.5 brings that to 0.6 and
 * 0.1, and most cities never have one.
 * ----------------------------------------------------------------------------
 */

export const DIFFICULTY = Object.freeze({
  easy: Object.freeze({
    name: 'Easy',
    desc: 'More money, faster growth, rare fires and collapses, homes slower to decline, smaller raids. Good for learning.',
    // risk 0.5: an unpatrolled building takes about a year to get dangerous
    // (0.7 still set off ~3 fires per young city; see the tuning notes above).
    funds: 1.5, risk: 0.5, production: 1.15, immigration: 1.25, mood: 0, winterGrowth: 1,
    raidSize: 0.7, raidInterval: 1, enemy: 1,
    requestSize: 1, requestInterval: 1, requestTime: 1,
    devolveDays: 6, // twice the grace: time for a market vendor or priest to come by
  }),
  normal: Object.freeze({
    name: 'Normal',
    desc: 'The game as designed.',
    funds: 1, risk: 1, production: 1, immigration: 1, mood: 0, winterGrowth: 1,
    raidSize: 1, raidInterval: 1, enemy: 1,
    requestSize: 1, requestInterval: 1, requestTime: 1,
    devolveDays: 3,
  }),
  hard: Object.freeze({
    name: 'Hard',
    desc: 'Less money, slower growth, more fires and bigger raids.',
    funds: 0.6, risk: 1.3, production: 0.9, immigration: 0.85, mood: 0, winterGrowth: 1,
    raidSize: 1.3, raidInterval: 1, enemy: 1,
    requestSize: 1, requestInterval: 1, requestTime: 1,
    devolveDays: 3,
  }),
  insane: Object.freeze({
    name: 'Insane',
    desc: 'For veterans. Scarce money, grumpy citizens, more fires, slow farms and workshops, nothing grows on the farms in winter, '
      + 'bigger and tougher raids that come more often, and an Emperor who demands 50% more, more often, with less time to deliver.',
    // winterGrowth 0: Dec-Feb farms keep their progress but add none (see sim/production.js).
    funds: 0.4, risk: 1.5, production: 0.8, immigration: 0.7, mood: -8, winterGrowth: 0,
    raidSize: 1.5, raidInterval: 0.75, enemy: 1.15,
    requestSize: 1.5, requestInterval: 0.7, requestTime: 0.75,
    devolveDays: 3,
  }),
});

/** Difficulty keys from easiest to hardest (for "best completed on" records). */
export const DIFFICULTY_ORDER = Object.freeze(Object.keys(DIFFICULTY));

/** The settings for a key, falling back to Normal for unknown/missing keys. */
export function difficultyOf(key) {
  return DIFFICULTY[key] || DIFFICULTY.normal;
}

/**
 * advisors.js (data)
 * ----------------------------------------------------------------------------
 * The words of the Health, Education and Entertainment advisors (ui/advisors.js,
 * ui/coverageInfo.js; the numbers come from sim/coverage.js). Every word is
 * written for Colonia.
 * ----------------------------------------------------------------------------
 */

/**
 * How well a service covers those who need it, in twelve words: none at all,
 * one for each ten percent from 1% to 99%, and full.
 */
export const COVERAGE_WORDS = Object.freeze([
  'None',
  'Almost none',
  'Very poor',
  'Poor',
  'Weak',
  'Patchy',
  'About half',
  'Fair',
  'Good',
  'Very good',
  'Nearly full',
  'Full',
]);

/** The city's health in a sentence, by tens: 0-9, 10-19 ... 90-99, then 100. */
export const CITY_HEALTH_VERDICTS = Object.freeze([
  'The city is gravely ill',
  'Sickness is everywhere',
  'The city\'s health is very poor',
  'The city\'s health is poor',
  'The city\'s health is below par',
  'The city\'s health is middling',
  'The city is fairly healthy',
  'The city is healthy',
  'The city is very healthy',
  'The city is in excellent health',
  'The city is in perfect health',
]);

/** City health at or above this is drawn as fine; below it, in red (the original's line was 40). */
export const CITY_HEALTH_WARN = 40;

/** Each kind of show, by the performer type that puts it on (data/buildings.js PERFORMER_NAMES). */
export const SHOW_NAMES = Object.freeze({ theater: 'plays', amphitheater: 'bouts', colosseum: 'beast shows' });


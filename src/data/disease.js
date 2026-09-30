/**
 * disease.js (data)
 * ----------------------------------------------------------------------------
 * The words and colors behind health and disease (sim/disease.js): how a
 * home's health score and its disease risk are described, and what a home
 * can lack. Every word is written for Colonia. The numbers are in config.js.
 * ----------------------------------------------------------------------------
 */

/** A home's health score in words: [lowest score, word], highest first. */
export const HEALTH_BANDS = Object.freeze([
  [80, 'Thriving'],
  [60, 'Healthy'],
  [40, 'Fair'],
  [20, 'Poor'],
  [0, 'Wretched'],
]);

/**
 * Disease risk in words, for the Health overlay and the house panel, in the
 * fire overlay's bands: [lowest risk, words].
 */
export const DISEASE_RISK_BANDS = Object.freeze([
  [81, 'Disease is close'],
  [61, 'High risk of disease'],
  [41, 'Some risk of disease'],
  [21, 'Low risk of disease'],
  [1, 'Very low risk of disease'],
  [0, 'No risk of disease'],
]);

/**
 * What lowers a home's health score, by key (sim/disease.js healthLacks),
 * most points first.
 */
export const HEALTH_LACKS = Object.freeze({
  care: 'no medicus or hospital',
  medicus: 'no medicus',
  hospital: 'no hospital within reach',
  hunger: 'no food at all',
  baths: 'no baths',
  barber: 'no barber',
  well: 'well water only',
  water: 'no clean water',
  food: 'not every kind of food',
});

/** Column and legend color of a sick home (Health and Problems overlays): pale and sickly. */
export const SICK_COLOR = '#b8d23a';

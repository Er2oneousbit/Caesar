/**
 * crime.js (data)
 * ----------------------------------------------------------------------------
 * The words and lists behind home mood and crime (sim/mood.js, sim/crime.js):
 * what rioters go for first, which buildings they spare, the bands a home's
 * mood is described by, and the reasons a home can be unhappy. Every word is
 * written for Colonia. The numbers are in config.js.
 * ----------------------------------------------------------------------------
 */

/**
 * What a mob goes for, most prized first. Rioters pick the highest entry that
 * stands within CONFIG.RIOT_TARGET_RANGE of the home they came from (the
 * nearest of equals, then the oldest), else the nearest listed building
 * anywhere. An entry matches a building type (`type`), a behavior family
 * (`kind`), a temple (`temple`) or homes from a level up (`homeMin`; each home
 * matches the first such entry, so list the richest first).
 */
export const RIOT_TARGETS = Object.freeze([
  { kind: 'residence' }, // the governor's own house, villa or palace
  { type: 'senate' },
  { homeMin: 13 }, // villas and palatia: the rich
  { type: 'hippodrome' },
  { type: 'colosseum' },
  { type: 'hospital' },
  { type: 'amphitheater' },
  { type: 'academy' },
  { type: 'theater' },
  { type: 'library' },
  { type: 'baths' },
  { type: 'forum' },
  { type: 'school' },
  { type: 'clinic' },
  { temple: true },
  { kind: 'workshop' },
  { type: 'granary' },
  { type: 'market' },
  { homeMin: 11 }, // tenements and insulae
  { kind: 'training' },
  { type: 'dock' },
  { type: 'barber' },
  { type: 'engineer_post' },
  { kind: 'raw' },
  { kind: 'barracks' },
  { homeMin: 7 }, // townhouses and up
  { kind: 'farm' },
]);

/**
 * Buildings rioters never set alight, by kind: stone works that do not burn
 * (wells, fountains, reservoirs, statues and gardens, walls' towers), and the
 * army's forts, the fleet's stone quays (naval stations) and the warehouses
 * (the original spared forts and warehouses too).
 */
export const RIOT_SPARED_KINDS = Object.freeze(['warehouse', 'fort', 'tower', 'well', 'fountain', 'reservoir', 'decor', 'station', 'village']); // (village: a native village's, not the city's: sim/natives.js)

/** Homes up to this level (tents to stone cottages) are too poor for a mob to bother with. */
export const RIOT_SPARED_TIER = 6;

/**
 * A home's mood in words, for the house panel: [lowest mood, word], highest
 * first (seven bands: 50+, 40s, 30s, 20s, 10s, 1-9, 0).
 */
export const MOOD_BANDS = Object.freeze([
  [50, 'Content'],
  [40, 'Grumbling'],
  [30, 'Unhappy'],
  [20, 'Resentful'],
  [10, 'Angry'],
  [1, 'Furious'],
  [0, 'Ready to riot'],
]);

/**
 * How much crime a home breeds, for the crime overlay: [lowest mood, column
 * height 0..10, words]. A home that already sent out a criminal shows at least
 * CRIME_FLAGGED_HEIGHT, whatever its mood.
 */
export const CRIME_BANDS = Object.freeze([
  [50, 0, 'No crime'],
  [41, 1, 'Little crime'],
  [31, 2, 'Little crime'],
  [21, 4, 'Some crime'],
  [11, 6, 'Much crime'],
  [1, 8, 'Crime is rife'],
  [0, 10, 'Lawless'],
]);
export const CRIME_FLAGGED_HEIGHT = 8;

/**
 * Why a home is unhappy, by reason key: its own troubles first (hunger, envy,
 * a squalid street), then the city's worst mood factor (the keys of
 * city.sentimentFactors).
 */
export const MOOD_REASONS = Object.freeze({
  hunger: 'There has been no food in the house',
  envy: 'The poor resent the rich homes in town',
  squalor: 'The street around it is squalid',
  taxes: 'Taxes are too high',
  wages: 'Wages are too low',
  unemployment: 'There is not enough work in the city',
  food: 'Food is short across the city',
  housing: 'Most of the city lives in poor homes',
  gods: 'The gods are angry with the city',
  venus: 'Venus has turned her face from the city',
  difficulty: 'The people are hard to please',
});

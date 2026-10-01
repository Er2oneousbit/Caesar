/**
 * housing.js (data)
 * ----------------------------------------------------------------------------
 * The housing ladder: 20 levels, from a tent to an imperial palace. A housing
 * plot starts as a vacant lot (level 0); settlers make it a Tent. The rules
 * that move a home up and down the ladder live in sim/housing.js.
 *
 * Footprints: levels 1-10 are single tiles (four neighbors of the same level
 * may join into one 2x2 "block" that still counts as that level), 11-14 are
 * 2x2, 15-18 are 3x3 and 19-20 are 4x4. A home grows into the bigger
 * footprint as it reaches 11, 15 and 19, and splits again if it falls back.
 *
 * Requirement fields: a home must meet its own level's needs to stay, and the
 * next level's needs to move up. All are "at least":
 *   water     1 = a well or a fountain, 2 = a fountain
 *   food      different food types in the pantry
 *   religion  different gods whose priests visited recently
 *   ent       entertainment score (see sim/housing.js entertainmentScore)
 *   edu       education tier: 1 = school or library, 2 = both,
 *             3 = school, library and academy
 *   barber    1 = a barber visited recently
 *   baths     1 = a bath attendant visited recently
 *   health    health tier: 1 = a medicus or a hospital, 2 = both
 *   goods     goods the household must have in stock
 *   wine      wine sources the CITY must have (a working winery, and each
 *             open trade partner selling wine while wine is set to import)
 *
 * Desirability: `up` is what a home needs (at least) to move up from this
 * level; at `down` or below it has a bad day. The gap between them keeps a
 * home that just moved up from falling straight back. It is wider (6) where a
 * home grows into a bigger footprint (11, 15, 19): the neighbors it takes
 * over stop adding their own desirability to its best tile.
 *
 * Other fields:
 *   size       footprint of the level (1, 2, 3 or 4)
 *   people     residents of one home at this level (per tile for single-tile
 *              levels, so a 2x2 block of them holds four times as many)
 *   tax        base tax per resident per year (before the tax rate)
 *   patrician  true = wealthy residents who do not work
 *   eats       false = forages: needs and eats no food (the two tent levels)
 *   fire/damage risk points per day (tents never collapse)
 *   desOut     desirability the home gives its neighbors [value, step, stepSize, range]
 * ----------------------------------------------------------------------------
 */

/** A level row with the defaults filled in, frozen. */
function L(row) {
  return Object.freeze({
    size: 1, water: 0, food: 0, religion: 0, ent: 0, edu: 0, barber: 0, baths: 0, health: 0, goods: [], wine: 0,
    tax: 1, patrician: false, eats: true, fire: 1, damage: 0.5, desOut: [0, 1, 0, 0],
    ...row,
  });
}

const POTTERY = ['pottery'];
const FURNISHED = ['pottery', 'furniture'];
const COMFORT = ['pottery', 'furniture', 'oil'];
const LUXURY = ['pottery', 'furniture', 'oil', 'wine'];

// Desirability the homes give off, by band: humble homes are poor neighbors,
// villas and palaces lift the streets around them.
const SQUALOR = [-1, 1, 1, 1];
const PLAIN = [0, 1, 0, 0];
const TIDY = [1, 1, -1, 1];

export const HOUSE_TIERS = Object.freeze([
  L({ name: 'Vacant Lot', people: 5, down: -99, up: -99, tax: 0, eats: false, fire: 0, damage: 0 }),
  // --- Single tiles ----------------------------------------------------------
  L({ name: 'Tent', people: 5, down: -99, up: -12, eats: false, fire: 1.1, damage: 0, desOut: SQUALOR }),
  L({ name: 'Family Tent', people: 7, down: -14, up: -6, water: 1, eats: false, fire: 1.1, damage: 0, desOut: SQUALOR }),
  L({ name: 'Lean-to', people: 9, down: -9, up: -1, water: 1, food: 1, fire: 1.1, damage: 0.4, desOut: SQUALOR }),
  L({ name: 'Hut', people: 11, down: -4, up: 3, water: 1, food: 1, religion: 1, tax: 2, fire: 1.0, damage: 0.5, desOut: SQUALOR }),
  L({ name: 'Cottage', people: 13, down: 0, up: 7, water: 2, food: 1, religion: 1, tax: 2, fire: 0.9, damage: 0.6, desOut: SQUALOR }),
  L({ name: 'Stone Cottage', people: 14, down: 4, up: 11, water: 2, food: 1, religion: 1, ent: 10, tax: 2, fire: 0.9, damage: 0.6, desOut: SQUALOR }),
  L({ name: 'Townhouse', people: 16, down: 8, up: 15, water: 2, food: 1, religion: 1, ent: 10, edu: 1, tax: 3, fire: 0.9, damage: 0.7, desOut: PLAIN }),
  L({ name: 'Merchant House', people: 17, down: 12, up: 19, water: 2, food: 1, religion: 1, ent: 10, edu: 1, baths: 1, goods: POTTERY, tax: 3, fire: 0.9, damage: 0.7, desOut: PLAIN }),
  L({ name: 'Domus', people: 18, down: 16, up: 23, water: 2, food: 1, religion: 1, ent: 20, edu: 1, baths: 1, goods: POTTERY, tax: 3, fire: 0.8, damage: 0.8, desOut: TIDY }),
  L({ name: 'Apartment House', people: 20, down: 20, up: 28, water: 2, food: 1, religion: 1, ent: 20, edu: 1, baths: 1, health: 1, goods: FURNISHED, tax: 4, fire: 0.8, damage: 0.8, desOut: TIDY }),
  // --- 2x2 -------------------------------------------------------------------
  L({ name: 'Tenement', size: 2, people: 80, down: 22, up: 34, water: 2, food: 1, religion: 1, ent: 20, edu: 2, barber: 1, baths: 1, health: 1, goods: COMFORT, tax: 4, fire: 1.0, damage: 1.2, desOut: TIDY }),
  L({ name: 'Insula', size: 2, people: 88, down: 31, up: 40, water: 2, food: 2, religion: 1, ent: 30, edu: 2, barber: 1, baths: 1, health: 1, goods: COMFORT, tax: 5, fire: 1.0, damage: 1.2, desOut: TIDY }),
  L({ name: 'Villa', size: 2, people: 44, down: 37, up: 45, water: 2, food: 2, religion: 2, ent: 30, edu: 2, barber: 1, baths: 1, health: 1, goods: LUXURY, tax: 8, patrician: true, fire: 0.6, damage: 0.8, desOut: [2, 1, -1, 2] }),
  L({ name: 'Garden Villa', size: 2, people: 48, down: 41, up: 49, water: 2, food: 2, religion: 2, ent: 40, edu: 2, barber: 1, baths: 1, health: 2, goods: LUXURY, tax: 9, patrician: true, fire: 0.6, damage: 0.8, desOut: [2, 1, -1, 2] }),
  // --- 3x3 -------------------------------------------------------------------
  L({ name: 'Peristyle Villa', size: 3, people: 99, down: 43, up: 53, water: 2, food: 2, religion: 2, ent: 45, edu: 3, barber: 1, baths: 1, health: 2, goods: LUXURY, tax: 10, patrician: true, fire: 0.6, damage: 0.8, desOut: [3, 2, -1, 3] }),
  L({ name: 'Marble Villa', size: 3, people: 108, down: 49, up: 57, water: 2, food: 3, religion: 3, ent: 50, edu: 3, barber: 1, baths: 1, health: 2, goods: LUXURY, tax: 11, patrician: true, fire: 0.6, damage: 0.8, desOut: [3, 2, -1, 3] }),
  L({ name: 'Mansion', size: 3, people: 117, down: 53, up: 61, water: 2, food: 3, religion: 3, ent: 55, edu: 3, barber: 1, baths: 1, health: 2, goods: LUXURY, wine: 2, tax: 12, patrician: true, fire: 0.6, damage: 0.8, desOut: [4, 2, -1, 4] }),
  L({ name: 'Palatium', size: 3, people: 126, down: 57, up: 66, water: 2, food: 3, religion: 4, ent: 60, edu: 3, barber: 1, baths: 1, health: 2, goods: LUXURY, wine: 2, tax: 13, patrician: true, fire: 0.6, damage: 0.8, desOut: [4, 2, -1, 4] }),
  // --- 4x4 -------------------------------------------------------------------
  // Entertainment 80 and 95 (were 70 and 80) since the hippodrome: with it a
  // home can score 116, and 80 no longer needed the colosseum (theater,
  // amphitheater and hippodrome reach it). Measured on the level 3 demo city
  // with every venue (3 years, river 96 and lakes 128): without a hippodrome
  // no home cleared 60; with one, 55-58% of homes cleared 80 and 38-43%
  // cleared 95. As in the original, the top level now needs the hippodrome
  // (80 is the most a city without one can give) and the one below it every
  // other venue at its best.
  L({ name: 'Grand Palatium', size: 4, people: 192, down: 60, up: 72, water: 2, food: 3, religion: 4, ent: 80, edu: 3, barber: 1, baths: 1, health: 2, goods: LUXURY, wine: 2, tax: 15, patrician: true, fire: 0.5, damage: 0.8, desOut: [5, 2, -1, 5] }),
  // The top level never moves up (`up` is out of reach).
  L({ name: 'Imperial Palatium', size: 4, people: 208, down: 68, up: 999, water: 2, food: 3, religion: 4, ent: 95, edu: 3, barber: 1, baths: 1, health: 2, goods: LUXURY, wine: 2, tax: 16, patrician: true, fire: 0.5, damage: 0.8, desOut: [5, 2, -1, 5] }),
]);

export const MAX_TIER = HOUSE_TIERS.length - 1;

/** Highest level a single tile (or a 2x2 block of single tiles) can reach. */
export const MAX_SMALL_TIER = 10;

/** First level of each footprint size: a home grows as it reaches these. */
export const GROWTH_TIERS = Object.freeze({ 2: 11, 3: 15, 4: 19 });

/**
 * Residents a house of the given level and footprint can hold. A 2x2 block of
 * single-tile homes holds four of them; bigger levels hold their `people`.
 */
export function houseCapacity(tier, size) {
  // Vacant lots accept a tent's worth of settlers.
  const t = tier === 0 ? HOUSE_TIERS[1] : HOUSE_TIERS[tier];
  return t.size === 1 ? t.people * size * size : t.people;
}

/** Human readable labels for requirement keys (used by the info panel). */
export const REQ_LABELS = Object.freeze({
  des: 'Desirability',
  water: 'Water',
  food: 'Food variety',
  religion: 'Religion',
  ent: 'Entertainment',
  edu: 'Education',
  barber: 'Barber',
  baths: 'Baths',
  health: 'Health',
  goods: 'Goods',
  wine: 'Wine sources',
  space: 'Room to expand',
});

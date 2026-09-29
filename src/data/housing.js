/**
 * housing.js (data)
 * ----------------------------------------------------------------------------
 * Housing tiers. A housing plot starts as tier 0 (vacant). Settlers make it a
 * Tent. From there a home climbs one tier at a time when EVERYTHING listed
 * for the next tier is available, and falls back when its current tier's
 * needs stop being met.
 *
 * Requirement fields (all are "at least"):
 *   des       desirability of the best tile under the house
 *   water     1 = well or fountain, 2 = fountain
 *   food      number of different food types in the pantry
 *   religion  number of different gods whose priests visited recently
 *   ent       entertainment points (theater 15, amphitheater 25, colosseum 35)
 *   edu       education level count (school, library, academy)
 *   health    health services count (barber, medicus, thermae, hospital)
 *   goods     manufactured goods the household must have in stock
 *
 * Other fields:
 *   size       minimum footprint (1x1, 2x2, 3x3). Homes merge with neighbors
 *              to grow into bigger footprints.
 *   popPerTile residents per tile of footprint
 *   tax        base tax per resident per year (before tax rate)
 *   patrician  true = wealthy residents who do not work
 *   fire/damage risk points per day
 *   desOut     desirability the home gives its neighbors [value, step, stepSize, range]
 * ----------------------------------------------------------------------------
 */

export const HOUSE_TIERS = Object.freeze([
  { name: 'Vacant Lot', size: 1, popPerTile: 0, des: -99, water: 0, food: 0, religion: 0, ent: 0, edu: 0, health: 0, goods: [], tax: 0, patrician: false, fire: 0, damage: 0, desOut: [0, 1, 0, 0] },
  { name: 'Tent', size: 1, popPerTile: 5, des: -99, water: 0, food: 0, religion: 0, ent: 0, edu: 0, health: 0, goods: [], tax: 1, patrician: false, fire: 1.1, damage: 0.2, desOut: [-1, 1, 1, 1] },
  { name: 'Lean-to', size: 1, popPerTile: 7, des: -12, water: 1, food: 0, religion: 0, ent: 0, edu: 0, health: 0, goods: [], tax: 1, patrician: false, fire: 1.1, damage: 0.4, desOut: [-1, 1, 1, 1] },
  { name: 'Hut', size: 1, popPerTile: 9, des: -8, water: 1, food: 1, religion: 0, ent: 0, edu: 0, health: 0, goods: [], tax: 2, patrician: false, fire: 1.0, damage: 0.5, desOut: [0, 1, 0, 0] },
  { name: 'Cottage', size: 1, popPerTile: 11, des: -4, water: 1, food: 1, religion: 1, ent: 0, edu: 0, health: 0, goods: [], tax: 2, patrician: false, fire: 0.9, damage: 0.6, desOut: [0, 1, 0, 0] },
  { name: 'Townhouse', size: 1, popPerTile: 13, des: 2, water: 2, food: 1, religion: 1, ent: 10, edu: 0, health: 0, goods: [], tax: 3, patrician: false, fire: 0.9, damage: 0.7, desOut: [1, 1, -1, 1] },
  { name: 'Domus', size: 1, popPerTile: 15, des: 6, water: 2, food: 1, religion: 1, ent: 15, edu: 0, health: 0, goods: ['pottery'], tax: 3, patrician: false, fire: 0.8, damage: 0.7, desOut: [1, 1, -1, 2] },
  { name: 'Tenement', size: 2, popPerTile: 16, des: 10, water: 2, food: 2, religion: 1, ent: 15, edu: 1, health: 1, goods: ['pottery'], tax: 4, patrician: false, fire: 1.1, damage: 1.2, desOut: [2, 1, -1, 2] },
  { name: 'Insula', size: 2, popPerTile: 18, des: 14, water: 2, food: 2, religion: 2, ent: 25, edu: 1, health: 2, goods: ['pottery', 'furniture'], tax: 5, patrician: false, fire: 1.1, damage: 1.4, desOut: [2, 1, -1, 3] },
  { name: 'Upper Insula', size: 2, popPerTile: 20, des: 18, water: 2, food: 2, religion: 2, ent: 35, edu: 2, health: 2, goods: ['pottery', 'furniture', 'oil'], tax: 6, patrician: false, fire: 1.0, damage: 1.4, desOut: [3, 1, -1, 3] },
  { name: 'Villa', size: 3, popPerTile: 9, des: 25, water: 2, food: 3, religion: 3, ent: 45, edu: 2, health: 3, goods: ['pottery', 'furniture', 'oil', 'wine'], tax: 10, patrician: true, fire: 0.6, damage: 0.8, desOut: [4, 1, -1, 4] },
  { name: 'Grand Villa', size: 3, popPerTile: 11, des: 34, water: 2, food: 3, religion: 3, ent: 55, edu: 3, health: 3, goods: ['pottery', 'furniture', 'oil', 'wine'], tax: 13, patrician: true, fire: 0.6, damage: 0.8, desOut: [5, 1, -1, 4] },
  { name: 'Palatium', size: 3, popPerTile: 13, des: 45, water: 2, food: 3, religion: 4, ent: 70, edu: 3, health: 4, goods: ['pottery', 'furniture', 'oil', 'wine'], tax: 16, patrician: true, fire: 0.6, damage: 0.8, desOut: [6, 1, -1, 5] },
]);

export const MAX_TIER = HOUSE_TIERS.length - 1;

/** Residents a house of the given tier and footprint can hold. */
export function houseCapacity(tier, size) {
  // Vacant lots accept a tent's worth of settlers.
  const t = tier === 0 ? HOUSE_TIERS[1] : HOUSE_TIERS[tier];
  return t.popPerTile * size * size;
}

/** Human readable labels for requirement keys (used by the info panel). */
export const REQ_LABELS = Object.freeze({
  des: 'Desirability',
  water: 'Water',
  food: 'Food variety',
  religion: 'Religion',
  ent: 'Entertainment',
  edu: 'Education',
  health: 'Health',
  goods: 'Goods',
  space: 'Room to expand',
});

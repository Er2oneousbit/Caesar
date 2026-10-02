/**
 * natives.js (data)
 * ----------------------------------------------------------------------------
 * Native villages and the mission post: who lives where, and the numbers of
 * their rules (sim/natives.js runs them, world/natives.js places the
 * villages).
 *
 * Colonia's provinces were taken from peoples who stayed. Luna (177 BC) was
 * founded on "land taken from the Ligurians", and the Ligurians held the
 * hills above Mutina for a generation after it: both missions have Ligurian
 * villages. The original had villages in a few late provinces; this is
 * Colonia's choice of two, to try the rules before more. The table is read
 * by mission id, so data/scenarios.js is left as it is; the sandbox has
 * villages only when its setup asks for them (scenario.natives).
 *
 * Rules (the original's, as the Julius engine reproduces them, in our
 * numbers; days carry over one to one):
 *   - a hut's land is every tile within HUT_LAND of it, a meeting place's
 *     within MEETING_LAND; each hut belongs to its village's meeting place
 *   - every hut and meeting place starts angry (ANGER_MAX). Each day one that
 *     is angry looks over its land: a building of the city there (not a road,
 *     wall or aqueduct, and not the mission post) sets off an attack for
 *     ATTACK_DAYS days, renewed every day the cause stays. One that has been
 *     calmed grows 1 angrier a day and does not look.
 *   - a missionary from a staffed mission post calms every hut and meeting
 *     place within CALM_REACH tiles of him (anger 0): ANGER_MAX days of calm.
 *   - while an attack lasts, each hut sends one villager (a unit: VILLAGER
 *     in data/units.js), a new one VILLAGER_DAYS after one falls.
 *   - while a staffed mission post stands, each calmed village sends a
 *     trader every TRADER_DAYS days, who buys up to TRADER_LOADS loads of
 *     goods set to Export above the keep level from the nearest warehouse.
 * ----------------------------------------------------------------------------
 */

/** The peoples, by key: their name and how a message names a village of theirs. */
export const NATIVE_PEOPLES = Object.freeze({
  ligurian: { name: 'Ligurian', plural: 'Ligurians', village: 'the Ligurian village' },
  // The sandbox's villages, wherever its province stands.
  native: { name: 'native', plural: 'natives', village: 'the native village' },
});

/**
 * Missions with villages, by id: the people, and how many villages (a
 * range; the map's own stream picks within it).
 */
export const MISSION_NATIVES = Object.freeze({
  c8m: { people: 'ligurian', villages: [2, 3] }, // Mutina: the Ligurian hills
  c8p: { people: 'ligurian', villages: [2, 3] }, // Luna: land taken from the Ligurians
});

/** The sandbox setup's villages (scenario.natives true). */
export const SANDBOX_NATIVES = Object.freeze({ people: 'native', villages: [1, 3] });

/** The villages a scenario has, or null: the sandbox's when its setup asks, else the mission's. */
export function nativesFor(scenario) {
  if (!scenario) return null;
  if (scenario.id === 'sandbox') return scenario.natives ? SANDBOX_NATIVES : null;
  return MISSION_NATIVES[scenario.id] || null;
}

export const NATIVES = Object.freeze({
  HUT_LAND: 3,
  MEETING_LAND: 6,
  ANGER_MAX: 100,
  ATTACK_DAYS: 2,
  CALM_REACH: 4,
  VILLAGER_DAYS: 5,
  TRADER_DAYS: 9,
  TRADER_LOADS: 3,
  // Placement (world/natives.js): Colonia's own, as no designer places them.
  ROAD_CLEARANCE: 25, // at least this far from the Imperial road
  EDGE_CLEARANCE: 6, // and from the map's edge
  SPACING: 22, // between two meeting places
  HUTS: [4, 8], // huts a village
  HUT_RING: [3, 5], // their distance from the meeting place's middle
  FIELDS: [2, 4], // patches of crops a village
  WOODS_NEAR: 6, // forest tiles within MEETING_LAND it wants (it sits at the woods' edge)
  MEADOW_MAX: 4, // meadow tiles within MEETING_LAND it may take (farm land stays the city's)
});

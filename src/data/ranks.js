/**
 * ranks.js (data)
 * ----------------------------------------------------------------------------
 * The governor's career: eleven ranks from private citizen to Caesar, each
 * with the monthly salary Rome allows it (the original's scale, 0 to 100 Dn).
 * The names are Roman offices and plain titles, worded for Colonia.
 *
 * The rank is fixed for a whole mission: the campaign's ten steps are played
 * one rank each, both provinces of a step alike (step 1 as a Citizen, step 10
 * as a Proconsul), and a win at the last step makes the governor Caesar, the
 * top rank, and ends the career (data/scenarios.js rankAfterWin). So all
 * eleven are used, the last as the reward. The sandbox setup lets the player
 * pick one (SANDBOX_RANK unless chosen). The salary itself can be set to the
 * rank's own rate or a lower rank's in the Imperial advisor, never a higher
 * one's (sim/governor.js).
 * ----------------------------------------------------------------------------
 */

export const RANKS = Object.freeze([
  { name: 'Citizen', salary: 0 },
  { name: 'Clerk', salary: 2 },
  { name: 'Engineer', salary: 5 },
  { name: 'Architect', salary: 8 },
  { name: 'Quaestor', salary: 12 },
  { name: 'Procurator', salary: 20 },
  { name: 'Aedile', salary: 30 },
  { name: 'Praetor', salary: 40 },
  { name: 'Consul', salary: 60 },
  { name: 'Proconsul', salary: 80 },
  { name: 'Caesar', salary: 100 },
].map((r) => Object.freeze(r)));

export const TOP_RANK = RANKS.length - 1;

/** The sandbox's rank when the setup does not pick one: the middle of the ladder. */
export const SANDBOX_RANK = 5;

/** A rank index made safe: an integer from 0 to TOP_RANK (anything else falls back to `fallback`). */
export function clampRank(r, fallback = SANDBOX_RANK) {
  return Number.isInteger(r) && r >= 0 && r <= TOP_RANK ? r : fallback;
}

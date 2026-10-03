/**
 * gardenInfo.js
 * ----------------------------------------------------------------------------
 * A garden's or statue's care in words (sim/gardens.js), for the inspect
 * panel and the Gardens overlay (render/overlays.js). Read-only: nothing
 * here changes the simulation.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { BUILDINGS, fullName } from '../data/buildings.js';
import { careInfo, YARD_TYPE } from '../sim/gardens.js';

const daysAgo = (n) => (n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`);

/** "Tended", "Untended: bonus at 60%", or that it never fades in this province. */
export function careText(game, b) {
  const c = careInfo(game, b);
  if (!c.applies) return 'Needs no tending here';
  return c.tended ? 'Tended' : `Untended: bonus at ${c.percent}%`;
}

/** How often a step of fading comes at this difficulty (CONFIG.CARE_STEP_DAYS / careFade): "every 20 days", or "about every 13 days" where it is not whole (Insane). */
export function careStepDays(game) {
  const d = CONFIG.CARE_STEP_DAYS / (game.difficulty.careFade ?? 1);
  return Number.isInteger(d) ? `every ${d} days` : `about every ${Math.round(d)} days`;
}

/** When it was last tended, and the rule, for the panel. */
export function careNote(game, b) {
  const c = careInfo(game, b);
  if (!c.applies) return 'This province has no gardeners, so its gardens and statues keep their full desirability.';
  const floor = CONFIG.CARE_LEVELS[CONFIG.CARE_LEVELS.length - 1];
  return `Last tended ${daysAgo(c.days)}. A month (${CONFIG.CARE_GRACE_DAYS} days) after a visit its desirability starts to fade, a step ${careStepDays(game)}, down to ${floor}%. `
    + `A gardener from a ${fullName(BUILDINGS[YARD_TYPE])} passing within ${CONFIG.SERVICE_RADIUS} tiles restores it in full.`;
}

/** The Gardens overlay's tooltip over a garden or statue. */
export function careTip(game, b) {
  if (!b.def.tended) return null;
  const c = careInfo(game, b);
  return c.applies ? `${careText(game, b)} (last tended ${daysAgo(c.days)})` : careText(game, b);
}

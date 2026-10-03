/**
 * gardens.js
 * ----------------------------------------------------------------------------
 * Gardens and statues need tending (Colonia's own rule: the original's
 * decorations needed no upkeep). A gardeners' yard (the Topiaria) sends
 * gardeners who roam the streets like prefects; each tends every garden and
 * statue within SERVICE_RADIUS of the road he walks (sim/services.js). A
 * decoration needs no road of its own, so reach is all that matters.
 *
 * Care: each tended decoration (`def.tended`: the garden and the three
 * statues; never a plaza, the triumphal arch, the governor's residence,
 * which its servants keep, or the Oracle) remembers the day of its last
 * visit (`tendedDay`). It keeps its full desirability for CARE_GRACE_DAYS,
 * then drops a step every CARE_STEP_DAYS / careFade days (data/difficulty.js)
 * through CONFIG.CARE_LEVELS to a floor of a quarter of its bonus, where it
 * stays. A visit puts it back to full at once.
 *
 * Only the step is kept (`careStep`, an index into CARE_LEVELS), and
 * desirability (sim/desirability.js desScale) is marked for a new pass only
 * when a decoration's step changes, never every day: the layer is worked
 * out over the whole map, and a city of a hundred gardens would otherwise
 * pay for it daily.
 *
 * The rule holds only where the mission has the Topiaria: where a player
 * cannot build a yard, gardens and statues never fade (careApplies).
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';

/** The building whose gardeners tend gardens and statues. */
export const YARD_TYPE = 'gardener_yard';

/** Does the care rule apply in this game (the mission has the yard)? */
export function careApplies(game) {
  return game.isUnlocked(YARD_TYPE);
}

/** Days since the decoration's last visit (0 for one never dated: see updateCare). */
export function daysUntended(game, b) {
  return Math.max(0, game.time.totalDays - (b.tendedDay ?? game.time.totalDays));
}

/**
 * The care step a decoration should be at today: 0 (full) for CARE_GRACE_DAYS
 * after its last visit, then one more every CARE_STEP_DAYS / careFade days,
 * up to the last of CONFIG.CARE_LEVELS (the floor). Always 0 where the rule
 * does not apply.
 */
export function careStepFor(game, b) {
  if (!b.def.tended || !careApplies(game)) return 0;
  const over = daysUntended(game, b) - CONFIG.CARE_GRACE_DAYS;
  if (over <= 0) return 0;
  const pace = game.difficulty.careFade ?? 1;
  return Math.min(CONFIG.CARE_LEVELS.length - 1, Math.floor((over * pace) / CONFIG.CARE_STEP_DAYS));
}

/** Share (0.25..1) of its desirability a building gives for its care: 1 for anything not tended. */
export function careScale(b) {
  if (!b.def.tended) return 1;
  return CONFIG.CARE_LEVELS[b.careStep || 0] / 100;
}

/** Put the decoration at care step `step`, marking desirability for a new pass if that changed it. */
function setCareStep(game, b, step) {
  if ((b.careStep || 0) === step) return;
  b.careStep = step;
  game.dirty.des = true;
}

/**
 * Daily, on the decoration's phase tick (core/game.js): move its care to
 * today's step. A decoration with no date yet (it should always have one:
 * addBuilding and the save upgrade give it) counts from today. Where the
 * rule does not apply it is kept tended today, so a game that later gains
 * the yard (a save loaded with every building unlocked) starts its
 * decorations at full rather than dropping them to the floor overnight.
 */
export function updateCare(game, b) {
  if (!b.def.tended) return;
  if (!careApplies(game)) b.tendedDay = game.time.totalDays;
  b.tendedDay ??= game.time.totalDays;
  setCareStep(game, b, careStepFor(game, b));
}

/** A gardener's visit (sim/services.js): full care from today. */
export function tendDecoration(game, b) {
  if (!b.def.tended) return;
  b.tendedDay = game.time.totalDays;
  setCareStep(game, b, 0);
}

/**
 * How badly a decoration needs a gardener (0..1), for his choice of way at
 * a junction (sim/movement.js streetNeed): rising to 1 as its month of grace
 * runs out, so gardeners go where the bonus is about to fade, not only where
 * it already has. 0 for anything else, and where the rule does not apply.
 */
export function careNeed(game, b) {
  if (!b || !b.def.tended || !careApplies(game)) return 0;
  return Math.min(1, daysUntended(game, b) / CONFIG.CARE_GRACE_DAYS);
}

/**
 * What the inspect panel and the overlay say about a decoration's care:
 * `applies` (false: it never fades here), `percent` of its bonus it gives,
 * `days` since its last visit, `tended` (still at full).
 */
export function careInfo(game, b) {
  const applies = !!b.def.tended && careApplies(game);
  const percent = Math.round(careScale(b) * 100);
  return { applies, percent, days: daysUntended(game, b), tended: percent === 100 };
}

/**
 * revolt.js
 * ----------------------------------------------------------------------------
 * The gladiator revolt, as the original had it, on Colonia's units.
 *
 * A scheduled event (the events table, sim/events.js, calls startRevolt in
 * its month; the console's `revolt` does it now):
 *   - No working Ludus Gladiatorius (staffed, with a road) that month: the
 *     revolt is called off for good, with no word, as in the original.
 *   - Otherwise a message, and for REVOLT_MONTHS months every gladiator who
 *     sets out turns on the city: each performer on his way from a school
 *     to a venue with gladiators, and each entertainer walking the streets
 *     for a venue whose gladiator shows are booked, becomes a `gladiator`
 *     unit (data/units.js: 75 health, attack 12, the original's 100 / 9 / 2
 *     on Colonia's scale) where he stands. The schools keep training, so new
 *     ones keep turning as they set out (looked for each day).
 *   - Gladiators go for the nearest buildings as raiders do and break what
 *     they reach (sim/military.js updateRaider). Soldiers, watchtowers and
 *     prefects fight them; while they are in the province no peace is gained
 *     (side 'enemy': sim/ratings.js enemiesInProvince).
 *   - In the end month a message says the revolt is over, and the survivors
 *     run for the map edge (the original struck them all dead on the spot;
 *     Colonia lets them flee, for looks) and are gone.
 *
 * State, saved with the military (core/save.js):
 *   game.military.revolt = { endMonth, turned, over } or null
 * Each rebel is a unit with `revolt: true`.
 * ----------------------------------------------------------------------------
 */

import { killWalker } from './entities.js';
import { spawnUnit } from './military.js';

/** How long a revolt lasts, in months (the original's 3). */
export const REVOLT_MONTHS = 3;

/** Is a revolt on now (rebels fight; after it, they flee)? */
export function revoltActive(game) {
  const r = game.military?.revolt;
  return !!r && !r.over;
}

/** A Ludus Gladiatorius at work: staffed and on a road. */
function schoolWorking(game) {
  for (const b of game.buildings.values()) {
    if (b.def.kind === 'training' && b.def.venue === 'amphitheater' && b.efficiency > 0 && b.accessRoad >= 0) return true;
  }
  return false;
}

/**
 * Start a gladiator revolt this month, lasting `months`. Returns false (and
 * says nothing) when no gladiator school works, or one is on already.
 */
export function startRevolt(game, months = REVOLT_MONTHS) {
  const m = game.military;
  if (revoltActive(game) || !schoolWorking(game)) return false;
  m.revolt = { endMonth: game.time.totalMonths + months, turned: 0, over: false };
  game.message(`The gladiators have revolted! Every gladiator who leaves his school turns on the city for the next ${months} months. Soldiers and prefects can put them down.`, 'bad', undefined, undefined, { kind: 'raid' });
  game.events.emit('sound', { name: 'horn' });
  turnGladiators(game);
  return true;
}

/** Is this walker a gladiator on his way to, or about the streets for, a show? */
function isGladiator(game, w) {
  if (w.dead) return false;
  if (w.type === 'performer') return w.venue === 'amphitheater'; // (the Ludus's men: the venue key of their show)
  if (w.type !== 'entertainer') return false;
  const v = game.buildings.get(w.origin);
  return !!v && v.def.kind === 'venue' && (v.shows?.amphitheater || 0) > 0;
}

/** Every gladiator out in the streets turns into a rebel where he stands. */
export function turnGladiators(game) {
  const r = game.military.revolt;
  if (!r || r.over) return 0;
  let n = 0;
  for (const w of [...game.walkers.values()]) {
    if (!isGladiator(game, w)) continue;
    spawnUnit(game, 'gladiator', w.x + 0.5, w.y + 0.5, { revolt: true, state: 'advance' });
    killWalker(game, w); // (a performer's booking at his venue is released)
    n++;
  }
  r.turned += n;
  return n;
}

/** Daily (sim/military.js militaryDaily): new gladiators turn as they set out. */
export function revoltDaily(game) {
  if (revoltActive(game)) turnGladiators(game);
}

/** Monthly (sim/military.js militaryMonthly): the end month ends it; the rebels flee. */
export function revoltMonthly(game) {
  const r = game.military.revolt;
  if (!r) return;
  if (r.over) {
    // Gone once the last rebel has left the map.
    let left = 0;
    for (const u of game.units.values()) if (u.revolt) left++;
    if (!left) game.military.revolt = null;
    return;
  }
  if (game.time.totalMonths < r.endMonth) return;
  r.over = true;
  game.message(`The gladiators' revolt is over: ${r.turned} rose against the city. The last of them flee the province.`, 'good');
}

/** Rebels on the map (for the threat summary). */
export function rebelCount(game) {
  let n = 0;
  for (const u of game.units.values()) if (u.revolt) n++;
  return n;
}

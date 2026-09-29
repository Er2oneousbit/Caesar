/**
 * entertainment.js
 * ----------------------------------------------------------------------------
 * Training buildings (Actor Troupe, Gladiator School, Menagerie) send
 * performers to venues. A venue with booked shows sends an Entertainer walker
 * around the neighborhood; homes it passes gain entertainment points.
 *
 *   theater       accepts actors
 *   amphitheater  accepts gladiators (or actors)
 *   colosseum     accepts gladiators and beasts
 * ----------------------------------------------------------------------------
 */

import { VENUE_SUPPLIERS } from '../data/buildings.js';
import { spawnWalker, killWalker } from './entities.js';
import { followPath } from './movement.js';

export const SHOW_DAYS = 32; // days of shows one performer provides
const REFILL_BELOW = 12; // venues ask for a new performer below this

/** Daily: training building dispatches a performer to a venue that needs one. */
export function updateTraining(game, b) {
  const def = b.def;
  if (b.efficiency <= 0 || b.accessRoad < 0) return;
  b.spawnTimer -= b.efficiency;
  if (b.spawnTimer > 0) return;
  b.spawnTimer = def.spawnDays;
  const perf = def.venue; // performer type this building trains
  const { buildings } = game;
  const found = game.pf.findNearest(b.accessRoad, (id) => {
    const v = buildings.get(id);
    if (!v || v.def.kind !== 'venue') return false;
    if (!VENUE_SUPPLIERS[v.def.venue].includes(perf)) return false;
    const pending = v.pendingPerf ? v.pendingPerf[perf] || 0 : 0;
    return pending === 0 && v.shows[perf] < REFILL_BELOW;
  }, 100);
  if (!found) return;
  const v = buildings.get(found.id);
  v.pendingPerf = v.pendingPerf || {};
  v.pendingPerf[perf] = (v.pendingPerf[perf] || 0) + 1;
  const w = spawnWalker(game, 'performer', b.accessRoad, b, {
    target: v.id,
    venue: perf,
    state: 'toVenue',
    reserve: { id: v.id, perf },
  });
  if (!w) {
    v.pendingPerf[perf]--;
    return;
  }
  followPath(game, w, found.path);
}

/** Performer arrived: book shows at the venue. */
export function performerArrive(game, w) {
  const v = game.buildings.get(w.target);
  if (v && v.shows && w.venue) v.shows[w.venue] = Math.max(v.shows[w.venue], SHOW_DAYS);
  killWalker(game, w); // releases the pending reservation
}

/** Daily: shows run down over time. */
export function updateVenue(game, b) {
  if (!b.shows) return;
  // Shows only play when the venue is staffed.
  if (b.efficiency <= 0) return;
  for (const k of ['theater', 'amphitheater', 'colosseum']) if (b.shows[k] > 0) b.shows[k]--;
}

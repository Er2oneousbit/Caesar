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
 *   hippodrome    accepts charioteers (a Factio's teams): races
 *
 * Every home also gets a city-wide base (0..ENT_BASE_MAX) for how well the
 * seats of working venues cover the population, averaged over the three
 * seat kinds: a big city needs more venues, not just one of each. A working
 * hippodrome seats the whole city (see VENUE_SEATS in data/buildings.js).
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { VENUE_SUPPLIERS, VENUE_SEATS, ENT_BASE_MAX, ENT_SEAT_KINDS, HIPPODROME_COVERAGE, SHOW_KINDS } from '../data/buildings.js';
import { spawnWalker, killWalker, mainOf } from './entities.js';
import { followPath } from './movement.js';
import { venueActive } from './services.js';

export const SHOW_DAYS = 32; // days of shows one performer provides
export const REFILL_BELOW = 12; // venues ask for a new performer below this

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
    const v = mainOf(game, buildings.get(id)); // a road beside any section leads to the hippodrome
    if (!v || v.def.kind !== 'venue') return false;
    if (!VENUE_SUPPLIERS[v.def.venue].includes(perf)) return false;
    const pending = v.pendingPerf ? v.pendingPerf[perf] || 0 : 0;
    return pending === 0 && v.shows[perf] < REFILL_BELOW;
  }, 100);
  if (!found) return;
  const v = mainOf(game, buildings.get(found.id));
  v.pendingPerf = v.pendingPerf || {};
  v.pendingPerf[perf] = (v.pendingPerf[perf] || 0) + 1;
  const init = { target: v.id, venue: perf, state: 'toVenue', reserve: { id: v.id, perf } };
  if (perf === 'hippodrome') init.speed = CONFIG.WALKER_SPEED * 2; // a racing team drives to the track
  const w = spawnWalker(game, 'performer', b.accessRoad, b, init);
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
  // The first races of the game get a message (once per game, as in the original).
  if (v && w.venue === 'hippodrome' && !game.city.flags.racesBegun) {
    game.city.flags.racesBegun = true;
    game.message('The chariots are racing at the hippodrome! The whole city turns out to cheer.', 'good', v.x, v.y);
  }
  killWalker(game, w); // releases the pending reservation
}

/** Daily: shows run down over time. */
export function updateVenue(game, b) {
  if (!b.shows) return;
  // Shows only play when the venue is staffed.
  if (b.efficiency <= 0) return;
  for (const k of SHOW_KINDS) if (b.shows[k] > 0) b.shows[k]--;
}

/** Is there a working hippodrome (staffed, races booked)? */
export function racesRunning(game) {
  for (const b of game.buildings.values()) {
    if (b.def.venue === 'hippodrome' && b.def.kind === 'venue' && b.efficiency > 0 && venueActive(b)) return true;
  }
  return false;
}

/**
 * Daily: the city-wide entertainment base. For each of the three seat kinds,
 * the share of the population its working venues (staffed, shows booked) can
 * seat, capped at 100%; a working hippodrome adds 100% of its own. The sum
 * over the three seat kinds (ENT_SEAT_KINDS, whatever the hippodrome adds),
 * over 5, is the base: 0..20 without a hippodrome, up to 26 with one.
 */
export function updateEntertainmentBase(game) {
  const { cover, base } = seatCoverage(game);
  game.city.entCoverage = cover;
  game.city.entBase = base;
}

/**
 * The seats behind the city-wide base, read-only (the Entertainment advisor
 * shows them): { seats, cover, base } with seats and cover (0-100, % of the
 * population) by venue kind.
 */
export function seatCoverage(game) {
  const pop = game.city.population;
  const seats = {};
  for (const k in VENUE_SEATS) seats[k] = 0;
  for (const b of game.buildings.values()) {
    if (b.def.kind !== 'venue' || b.efficiency <= 0 || !b.shows) continue;
    const k = b.def.venue;
    if (seats[k] === undefined) continue;
    if (Object.values(b.shows).some((d) => d > 0)) seats[k] += VENUE_SEATS[k];
  }
  let sum = 0;
  const cover = {};
  for (const k of Object.keys(VENUE_SEATS)) {
    cover[k] = pop > 0 ? Math.min(100, Math.floor((seats[k] * 100) / pop)) : 0;
    sum += cover[k];
  }
  // Only a city with a hippodrome gets the key, so other cities' state is as it was.
  if (racesRunning(game)) {
    cover.hippodrome = HIPPODROME_COVERAGE;
    sum += HIPPODROME_COVERAGE;
  }
  return { seats, cover, base: Math.min(ENT_BASE_MAX, Math.floor(sum / ENT_SEAT_KINDS / 5)) };
}

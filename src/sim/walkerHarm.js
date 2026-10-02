/**
 * walkerHarm.js
 * ----------------------------------------------------------------------------
 * The city's people on foot hurt by wolves (sim/wildlife.js) and by the
 * missile men of a raiding people (sim/military.js), as the original's
 * walkers could be.
 *
 * Walkers have no health of their own until first hurt: `hp` is set to
 * WALKER_HP at the first bite or stone (the original's 20) and is saved with
 * the walker. A walker at 0 is gone: killWalker releases whatever he had
 * reserved, a cart's load is lost with him, a caravan's visit is over, a
 * settler's family never arrives. His building sends another in its own
 * time, as after any walker.
 *
 * Who can be hurt (canHarm): anyone on foot in the streets or the fields:
 * service walkers, cart pushers and market buyers, settlers and emigrants,
 * traders' caravans, performers, recruits on the march, criminals. Not
 * ships and boats, not a recruit at his drill, and not a prefect: he is
 * armed and fights back (sim/prefectFight.js), so wolves and raiders meet
 * him as a fighter, not as prey.
 * ----------------------------------------------------------------------------
 */

import { WALKER_TYPES } from '../data/walkers.js';
import { killWalker } from './entities.js';

/** A walker's health when first hurt (the original's 20). */
export const WALKER_HP = 20;

const ON_FOOT = new Set(['roamer', 'carrier', 'traveler', 'criminal']);

/** Can this walker be bitten or struck where he stands? */
export function canHarm(w) {
  if (!w || w.dead || w.type === 'prefect') return false;
  const def = WALKER_TYPES[w.type];
  if (!def || !ON_FOOT.has(def.kind)) return false;
  return w.state !== 'training'; // (a recruit at the academy is indoors)
}

/**
 * Hurt a walker by `dmg`. At 0 he dies and is removed (the caller counts
 * him: a raid's stats or the wolves'). Returns true when he died.
 */
export function harmWalker(game, w, dmg) {
  if (w.hp === undefined) w.hp = WALKER_HP;
  w.hp -= dmg;
  w.hitTick = game.time.totalTicks;
  if (w.hp > 0) return false;
  game.events.emit('unitDied', { x: w.x + 0.5, y: w.y + 0.5, side: 'rome', type: w.type });
  killWalker(game, w);
  return true;
}

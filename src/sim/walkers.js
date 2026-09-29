/**
 * walkers.js (system)
 * ----------------------------------------------------------------------------
 * Per-tick walker update: advance movement, and when a walker reaches a tile
 * decide what happens next (serve buildings, keep roaming, deliver cargo...).
 *
 * The actual "what happens at the destination" logic lives in the behavior
 * modules (storage, market, population, trade, risk, entertainment). This
 * file only routes events to them.
 * ----------------------------------------------------------------------------
 */

import { killWalker, releaseReservation } from './entities.js';
import { followPath, goHome, pickRoamTile, setNextTile } from './movement.js';
import { roamerVisit } from './services.js';
import { buyerArrive, buyerUnload } from './market.js';
import { settlerArrive, seekHome } from './population.js';
import { caravanArrive, shipArrive, shipLeave } from './trade.js';
import { prefectArriveAtFire, afterWait } from './risk.js';
import { performerArrive } from './entertainment.js';
import { findDeliveryTarget, receiveGoods } from './storage.js';
import { recruitArrive } from './military.js';
import { FOOD_TYPES } from '../data/goods.js';

/** Advance every walker by one tick. */
export function updateWalkers(game) {
  for (const w of game.walkers.values()) {
    if (w.dead) continue;
    try {
      stepWalker(game, w);
    } catch (err) {
      // A single broken walker must not take the whole city down.
      game.log.error(`Walker ${w.id} (${w.type}) crashed and was removed:`, err);
      killWalker(game, w);
    }
  }
}

function stepWalker(game, w) {
  if (w.waitTicks > 0) {
    w.waitTicks--;
    if (w.waitTicks === 0 && w.afterWait) {
      const what = w.afterWait;
      w.afterWait = null;
      if (what === 'shipLeave') shipLeave(game, w);
      else afterWait(game, w, what);
    }
    return;
  }
  if (!w.moving) {
    if (w.pendingArrive) {
      w.pendingArrive = false;
      onPathEnd(game, w);
    }
    return;
  }
  w.progress += w.speed;
  if (w.progress < 1) return;
  w.progress -= 1;
  w.x = w.tx;
  w.y = w.ty;
  onArriveTile(game, w);
}

/** Walker has just stepped onto a new tile. */
function onArriveTile(game, w) {
  const { map } = game;
  if (w.kind === 'roamer') roamerVisit(game, w);
  if (w.dead) return;

  if (w.path) {
    w.pathIndex++;
    if (w.pathIndex >= w.path.length - 1) {
      w.path = null;
      w.moving = false;
      w.progress = 0;
      onPathEnd(game, w);
      return;
    }
    const next = w.path[w.pathIndex + 1];
    if (w.kind !== 'ship' && !map.road[next]) {
      reroute(game, w);
      return;
    }
    setNextTile(game, w, next);
    return;
  }

  if (w.state === 'roam') {
    w.roamLeft--;
    if (w.roamLeft <= 0) {
      goHome(game, w);
      return;
    }
    const next = pickRoamTile(game, w);
    if (next < 0) goHome(game, w);
    else setNextTile(game, w, next);
    return;
  }

  // Not on a path and not roaming: nothing sensible to do.
  w.moving = false;
}

/** The road ahead vanished: find a new route to the same destination. */
function reroute(game, w) {
  const { map, pf } = game;
  const dest = w.path[w.path.length - 1];
  const here = map.idx(w.x, w.y);
  const path = map.road[here] ? pf.roadPath(here, dest) : null;
  if (path) {
    followPath(game, w, path);
    return;
  }
  w.path = null;
  w.moving = false;
  if (w.state === 'return') {
    returnHome(game, w);
  } else if (w.kind === 'traveler' && (w.state === 'toHouse' || w.state === 'seeking')) {
    releaseReservation(game, w);
    seekHome(game, w);
  } else {
    killWalker(game, w);
  }
}

/** Walker reached the end of its path. Dispatch by state. */
function onPathEnd(game, w) {
  switch (w.state) {
    case 'return':
      returnHome(game, w);
      break;
    case 'deliver':
      cartArrive(game, w);
      break;
    case 'fetch':
      buyerArrive(game, w);
      break;
    case 'toHouse':
      settlerArrive(game, w);
      break;
    case 'seeking':
      seekHome(game, w);
      break;
    case 'leaving':
      killWalker(game, w);
      break;
    case 'toVenue':
      performerArrive(game, w);
      break;
    case 'toWarehouse':
      caravanArrive(game, w);
      break;
    case 'toFire':
      prefectArriveAtFire(game, w);
      break;
    case 'toFort':
      recruitArrive(game, w);
      break;
    case 'toDock':
      shipArrive(game, w);
      break;
    default:
      killWalker(game, w);
  }
}

/** Walker is back at its building. Unload anything it carries. */
function returnHome(game, w) {
  const origin = game.buildings.get(w.origin);
  if (origin) {
    if (w.type === 'buyer') buyerUnload(game, w);
    if (w.cargo && w.cargo.amount > 0) receiveGoods(origin, w.cargo.good, w.cargo.amount);
  }
  killWalker(game, w);
}

/** Cart reached its destination: unload, or try somewhere else. */
function cartArrive(game, w) {
  const target = game.buildings.get(w.target);
  releaseReservation(game, w);
  if (target && w.cargo) {
    const n = receiveGoods(target, w.cargo.good, w.cargo.amount);
    if (n > 0 && FOOD_TYPES.includes(w.cargo.good)) game.city.foodFlow.stored += n;
    w.cargo.amount -= n;
    if (w.cargo.amount <= 0) w.cargo = null;
  }
  if (w.cargo) {
    const { map } = game;
    const here = map.idx(w.x, w.y);
    if (map.road[here]) {
      const alt = findDeliveryTarget(game, here, w.cargo.good, w.cargo.amount, w.origin);
      if (alt && alt.id !== w.target) {
        const b = game.buildings.get(alt.id);
        if (b.incoming && b.incoming[w.cargo.good] !== undefined) b.incoming[w.cargo.good] += w.cargo.amount;
        w.reserve = { id: alt.id, good: w.cargo.good, amount: w.cargo.amount };
        w.target = alt.id;
        followPath(game, w, alt.path);
        return;
      }
    }
  }
  goHome(game, w);
}

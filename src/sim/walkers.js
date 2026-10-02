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

import { killWalker, releaseReservation, STRIDE_WRAP } from './entities.js';
import { followPath, goHome, pickRoamTile, setNextTile } from './movement.js';
import { roamerVisit } from './services.js';
import { buyerArrive, buyerUnload } from './market.js';
import { settlerArrive, seekHome } from './population.js';
import { caravanArrive, shipArrive, shipMoored, dockFetchArrive, dockWorkerHome, dockWorkerOnward } from './trade.js';
import { prefectArriveAtFire, afterWait } from './risk.js';
import { performerArrive } from './entertainment.js';
import { findDeliveryTarget, findDeliveryFit, receiveGoods, isStorage } from './storage.js';
import { collectArrive } from './storageOrders.js';
import { recruitArrive } from './military.js';
import { recruitAtAcademy, recruitTraining } from './training.js';
import { criminalAfterWait, thiefArrive, rioterArrive, rioterStep, hunterArrive, landPassable, offRoadReroute } from './crime.js';
import { physicianArrive, physicianAfterWait } from './disease.js';
import { boatArrive, boatAfterWait } from './fishing.js';
import { boatBlocked } from './bridges.js';
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
  // Held in a struggle (a prefect catching a criminal, sim/crime.js): both stand still.
  if (w.held > 0) {
    w.held--;
    return;
  }
  if (w.waitTicks > 0) {
    w.waitTicks--;
    if (w.waitTicks === 0 && w.afterWait) {
      const what = w.afterWait;
      w.afterWait = null;
      if (w.type === 'fishing_boat') boatAfterWait(game, w, what);
      else if (w.kind === 'criminal') criminalAfterWait(game, w, what);
      else if (what === 'nextSick') physicianAfterWait(game, w);
      else afterWait(game, w, what);
    }
    return;
  }
  // A recruit training at the academy stays there (sim/training.js).
  if (w.state === 'training' && w.type === 'recruit') {
    recruitTraining(game, w);
    return;
  }
  // A ship at the dock: its crane lands cargo while dock workers come and go.
  if (w.state === 'docked' && w.kind === 'ship') {
    shipMoored(game, w);
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
  w.walked = (w.walked + w.speed) % STRIDE_WRAP;
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
  // A rioter sets fire to what he passes, and stops there a while.
  if (w.type === 'rioter' && rioterStep(game, w)) return;

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
    // Rioters and prefects chasing them cross open land: only a new building
    // or wall in the way makes them plan again.
    if (w.offRoad) {
      if (!landPassable(game, next, w.type === 'rioter' ? w.target : 0)) offRoadReroute(game, w);
      else setNextTile(game, w, next);
      return;
    }
    if (w.kind !== 'ship' && !map.road[next]) {
      reroute(game, w);
      return;
    }
    // A low bridge built across a boat's route since it set out (sim/bridges.js).
    if (w.kind === 'ship' && map.bridgeLow[next]) {
      boatBlocked(game, w);
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
    case 'collect':
      collectArrive(game, w);
      break;
    case 'dockFetch':
      dockFetchArrive(game, w);
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
    case 'toSick':
      physicianArrive(game, w);
      break;
    case 'toAcademy':
      recruitAtAcademy(game, w); // he stays to train, then on to his fort
      break;
    case 'toFort':
      recruitArrive(game, w);
      break;
    case 'toDock':
      shipArrive(game, w);
      break;
    case 'toWharf':
    case 'toGround':
    case 'homeWithCatch':
      boatArrive(game, w);
      break;
    case 'steal':
      thiefArrive(game, w);
      break;
    case 'riot':
      rioterArrive(game, w);
      break;
    case 'hunt':
      hunterArrive(game, w);
      break;
    default:
      killWalker(game, w);
  }
}

/** Walker is back at its building. Unload anything it carries (its own goods: no orders apply). */
function returnHome(game, w) {
  const origin = game.buildings.get(w.origin);
  if (origin && origin.def.kind === 'dock' && w.type === 'cart') {
    dockWorkerHome(game, w, origin); // hands an export to the ship, sends the dock's workers out again
    return;
  }
  if (origin) {
    if (w.type === 'buyer') buyerUnload(game, w);
    if (w.cargo && w.cargo.amount > 0) receiveGoods(origin, w.cargo.good, w.cargo.amount, true);
  } else if (w.type === 'cart' && w.cargo && w.cargo.amount > 0 && deliverElsewhere(game, w)) {
    return;
  }
  killWalker(game, w);
}

/**
 * A cart whose home is gone (a dock worker's, when the Dock is demolished:
 * entities.js removeBuilding lets it go on) takes its load to wherever any
 * cart would take it, so the goods are not lost: as much as the best place
 * can take, then (cartArrive) on to the next with the rest. @returns {boolean}
 */
function deliverElsewhere(game, w) {
  const here = game.map.idx(w.x, w.y);
  if (!game.map.road[here]) return false;
  const t = findDeliveryFit(game, here, w.cargo.good, w.cargo.amount);
  if (!t) return false;
  const b = game.buildings.get(t.id);
  if (b.incoming && b.incoming[w.cargo.good] !== undefined) b.incoming[w.cargo.good] += t.amount;
  w.reserve = { id: t.id, good: w.cargo.good, amount: t.amount };
  w.target = t.id;
  w.state = 'deliver';
  w.claim = null;
  followPath(game, w, t.path);
  return true;
}

/** Cart reached its destination: unload, or try somewhere else. */
function cartArrive(game, w) {
  const target = game.buildings.get(w.target);
  releaseReservation(game, w);
  if (target && w.cargo) {
    const n = receiveGoods(target, w.cargo.good, w.cargo.amount);
    // Food counts as stored once, from the farm or dock; storage emptying
    // into other storage only moves it.
    const origin = game.buildings.get(w.origin);
    if (n > 0 && FOOD_TYPES.includes(w.cargo.good) && !(origin && isStorage(origin))) game.city.foodFlow.stored += n;
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
  // A dock worker that unloaded imports goes on from here to fetch an export for the ship.
  if (!w.cargo && game.buildings.get(w.origin)?.def.kind === 'dock' && dockWorkerOnward(game, w)) return;
  // No home to take the rest back to (a demolished Dock's worker): on to the next place.
  if (w.cargo && w.type === 'cart' && !game.buildings.has(w.origin) && deliverElsewhere(game, w)) return;
  goHome(game, w);
}

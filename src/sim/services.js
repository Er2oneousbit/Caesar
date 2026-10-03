/**
 * services.js
 * ----------------------------------------------------------------------------
 * Roaming service walkers: spawning them from their buildings and applying
 * their effect to everything within SERVICE_RADIUS tiles as they walk.
 *
 * This is the heart of the genre: a house only "has" a temple, a school or a
 * market if the right walker strolled past it recently. Each visit sets an
 * access timer on the house (CONFIG.ACCESS_DAYS) that counts down daily.
 *
 * Hiring is separate: see updateLaborAccess() (housing within road range).
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { VENUE_BOTH_SHOWS, SHOW_KINDS } from '../data/buildings.js';
import { WALKER_TYPES } from '../data/walkers.js';
import { spawnWalker, mainOf } from './entities.js';
import { startRoaming } from './movement.js';
import { vendorSupply } from './market.js';
import { cureHome } from './disease.js';
import { missionaryVisit } from './natives.js';
import { tendDecoration } from './gardens.js';

/** Apply a roamer's effect to every building within reach of its tile. */
export function roamerVisit(game, w) {
  const { map, buildings } = game;
  const def = WALKER_TYPES[w.type];
  // A missionary reaches farther than SERVICE_RADIUS, and only native villages (sim/natives.js).
  if (def.effect === 'mission') { missionaryVisit(game, w); return; }
  const r = CONFIG.SERVICE_RADIUS;
  const origin = w.origin ? buildings.get(w.origin) : null;
  const seen = [];
  const x0 = Math.max(0, w.x - r);
  const x1 = Math.min(map.w - 1, w.x + r);
  const y0 = Math.max(0, w.y - r);
  const y1 = Math.min(map.h - 1, w.y + r);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const id = map.building[y * map.w + x];
      if (!id || seen.includes(id)) continue;
      seen.push(id);
      // A hippodrome's sections share its upkeep: a prefect or engineer
      // passing any of them looks after the hippodrome.
      const b = mainOf(game, buildings.get(id));
      if (!b) continue;
      if (b.id !== id) {
        if (seen.includes(b.id)) continue;
        seen.push(b.id);
      }
      applyEffect(game, def.effect, w, origin, b);
    }
  }
}

function applyEffect(game, effect, w, origin, b) {
  const h = b.house;
  const days = CONFIG.ACCESS_DAYS;
  switch (effect) {
    case 'fire':
      b.fireRisk = 0;
      if (h) h.police = CONFIG.POLICE_DAYS; // a prefect on the street: half the crime (sim/crime.js)
      break;
    case 'damage':
      b.damageRisk = 0;
      break;
    case 'religion':
      if (h && w.god) h.religion[w.god] = days;
      break;
    case 'school':
    case 'library':
    case 'academy':
    case 'barber':
    case 'baths':
      if (h) h[effect] = days;
      break;
    case 'clinic':
      if (h) {
        h.clinic = days;
        // A physician passing by clears the home's disease risk and cures
        // the sick (sim/disease.js), as a prefect clears fire risk.
        if (h.pop > 0) cureHome(game, b);
      }
      break;
    case 'venue':
      if (h && w.venue) {
        h.ent[w.venue] = days;
        // A venue with both of its kinds of show booked is worth more; the
        // better visit is kept until it runs out.
        if (h.entBoth && venueHasBoth(origin, w.venue)) h.entBoth[w.venue] = days;
      }
      break;
    case 'tax':
      if (h && h.pop > 0) h.tax = CONFIG.TAX_ACCESS_DAYS;
      break;
    case 'market':
      if (h && origin) vendorSupply(game, origin, b);
      break;
    case 'tend':
      tendDecoration(game, b); // a garden or statue back to full care (sim/gardens.js)
      break;
    default:
      break;
  }
}

/**
 * Roamers whose next round starts as the last one heads home (see
 * updateServiceSpawns). Prefects and engineers first; then the services whose
 * homes still went without them once the roamers were drawn to the homes
 * that need them (sim/movement.js SERVICE_PULL), measured over six seeds and
 * two years on the mission 2 and mission 4 playtest saves and the demo city
 * (home-days without the service, for homes within reach of one).
 * Tax collectors: a registration lasts half as long as any other visit; the
 * mission 4 save's homes went 48,453 home-days unregistered without the
 * overlap and 14,218 with it, the demo city's 8,867 and 2,916, mission 2's
 * 2,156 and none. Priests, barbers, physicians and bath attendants: one
 * temple, barber, clinic or bath serves a wide area; the demo city's homes
 * went 10,041 home-days without Venus and 1,729 without a barber (1,833 and
 * none with it), the mission 4 save's 4,481 without baths and 2,169 without
 * a physician (720 and 960). Not teachers, librarians or scholars, whose
 * homes were seldom without them already (the demo city's longest wait for
 * a school 109 days), nor entertainers, who roam only while shows play and
 * gained nothing clear (the mission 4 save's theater homes 4,401 home-days
 * without, 8,978 with; its amphitheater's 5,736 and 2,249) for 60% more of
 * them in the streets, nor market vendors: a market already keeps two out,
 * the overlap made it three, and the mission 4 save's homes went 6,553
 * home-days without one before and 7,379 after.
 * Gardeners too, upkeep like the engineers: a garden or statue starts to
 * fade a month (16 days) after a visit, sooner than a gardener's round out
 * (15 days for his 30 tiles) and home again takes, so a yard that waited for
 * him to walk back would leave its streets to fade between rounds.
 */
const OVERLAP_ROUNDS = new Set(['prefect', 'engineer', 'gardener', 'taxman', 'priest', 'barber', 'physician', 'bather']);

/** How many of the building's own roamers are out (`onlyRoaming`: not counting those walking home)? */
function roamersOut(game, b, type, onlyRoaming = false) {
  let n = 0;
  for (const id of b.walkers) {
    const w = game.walkers.get(id);
    if (w && w.type === type && (!onlyRoaming || w.state !== 'return')) n++;
  }
  return n;
}

/** Does this venue have both kinds of show it can stage booked right now? */
export function venueHasBoth(venue, type) {
  const both = VENUE_BOTH_SHOWS[type];
  if (!venue || !venue.shows || !both) return false;
  return both.every((perf) => venue.shows[perf] > 0);
}

/** Is a venue currently booked with performances (or races, at the hippodrome)? */
export function venueActive(b) {
  if (!b.shows) return false;
  return SHOW_KINDS.some((k) => b.shows[k] > 0);
}

/**
 * Daily: spawn the building's service roamer when its timer runs out.
 * Understaffed buildings count down slower.
 */
export function updateServiceSpawns(game, b) {
  const def = b.def;
  if (!def.walker || b.accessRoad < 0 || b.efficiency <= 0) return;
  if (def.kind === 'venue' && !venueActive(b)) return;
  if (def.needsPiped && !b.hasWater) return;
  b.spawnTimer -= b.efficiency;
  if (b.spawnTimer > 0) return;
  // Markets keep two vendors on the streets; everything else one walker.
  // The roamers in OVERLAP_ROUNDS (prefects, engineers, tax collectors,
  // priests and the health services) count only while on their rounds: the
  // next one sets out as the last turns for home. Waiting for him to walk
  // all the way back left a prefecture's streets unwatched for half of every
  // round, and a round that wandered off up an empty road cost a whole month.
  const maxOut = def.kind === 'market' ? 2 : 1;
  if (roamersOut(game, b, def.walker, OVERLAP_ROUNDS.has(def.walker)) >= maxOut) return;
  const init = {};
  if (def.god) init.god = def.god;
  if (def.kind === 'venue') init.venue = def.venue;
  const speed = WALKER_TYPES[def.walker].speed;
  if (speed) init.speed = CONFIG.WALKER_SPEED * speed; // the charioteer drives at twice walking pace
  const w = spawnWalker(game, def.walker, b.accessRoad, b, init);
  if (w) {
    b.roamDir = ((b.roamDir || 0) + 1) % 4;
    startRoaming(game, w, b.roamDir);
  }
  b.spawnTimer = def.spawnDays;
}

/**
 * Every few days: a building can hire only if occupied housing is reachable
 * within LABOR_RANGE road tiles (people will not walk further to work).
 * The result lingers for LABOR_ACCESS_DAYS so a brief gap does not matter.
 */
export function updateLaborAccess(game, b) {
  const def = b.def;
  if (!def.workers) return;
  if ((game.time.totalDays + b.id) % 4 !== 0) return;
  const start = b.accessRoad >= 0 ? b.accessRoad : -1;
  if (start < 0) {
    if (!def.needsRoad) b.laborAccess = nearbyHousing(game, b) ? CONFIG.LABOR_ACCESS_DAYS : b.laborAccess;
    return;
  }
  const homes = game.homeByRoad;
  const found = game.pf.bfsRoad(start, (i) => {
    const list = homes.get(i);
    if (!list) return false;
    for (const id of list) {
      const hb = game.buildings.get(id);
      if (hb && hb.house.pop > 0) return true;
    }
    return false;
  }, CONFIG.LABOR_RANGE);
  if (found >= 0) b.laborAccess = CONFIG.LABOR_ACCESS_DAYS;
}

/** Road-less buildings (fountains without roads etc.): any occupied home within 6 tiles. */
function nearbyHousing(game, b) {
  const { map, buildings } = game;
  for (let y = b.y - 6; y < b.y + b.size + 6; y++) {
    for (let x = b.x - 6; x < b.x + b.size + 6; x++) {
      const hb = buildings.get(map.buildingAt(x, y));
      if (hb && hb.house && hb.house.pop > 0) return true;
    }
  }
  return false;
}

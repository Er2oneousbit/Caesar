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
import { VENUE_BOTH_SHOWS } from '../data/buildings.js';
import { WALKER_TYPES } from '../data/walkers.js';
import { spawnWalker } from './entities.js';
import { startRoaming } from './movement.js';
import { vendorSupply } from './market.js';

/** Apply a roamer's effect to every building within reach of its tile. */
export function roamerVisit(game, w) {
  const { map, buildings } = game;
  const def = WALKER_TYPES[w.type];
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
      const b = buildings.get(id);
      if (b) applyEffect(game, def.effect, w, origin, b);
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
    case 'clinic':
    case 'baths':
      if (h) h[effect] = days;
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
    default:
      break;
  }
}

/** Does the building have one of its own roamers out right now? */
function roamersOut(game, b, type) {
  let n = 0;
  for (const id of b.walkers) {
    const w = game.walkers.get(id);
    if (w && w.type === type) n++;
  }
  return n;
}

/** Does this venue have both kinds of show it can stage booked right now? */
export function venueHasBoth(venue, type) {
  const both = VENUE_BOTH_SHOWS[type];
  if (!venue || !venue.shows || !both) return false;
  return both.every((perf) => venue.shows[perf] > 0);
}

/** Is a venue currently booked with performances? */
export function venueActive(b) {
  if (!b.shows) return false;
  return b.shows.theater > 0 || b.shows.amphitheater > 0 || b.shows.colosseum > 0;
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
  const maxOut = def.kind === 'market' ? 2 : 1;
  if (roamersOut(game, b, def.walker) >= maxOut) return;
  const init = {};
  if (def.god) init.god = def.god;
  if (def.kind === 'venue') init.venue = def.venue;
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

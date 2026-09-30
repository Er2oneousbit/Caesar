/**
 * disease.js
 * ----------------------------------------------------------------------------
 * Health and disease: local outbreaks on the fire machinery (Colonia's own
 * design; not the original's city-wide plague).
 *
 * Health score (0-100), for every occupied home, from what it has:
 *   its level (up to HEALTH_LEVEL_MAX points), health care (a medicus visit
 *   and a hospital within reach HEALTH_CARE_BOTH, a hospital alone
 *   HEALTH_CARE_HOSPITAL, a medicus alone HEALTH_CARE_MEDICUS), baths,
 *   a barber, fountain water (a well does not count), HEALTH_PER_FOOD for each
 *   kind of food in the pantry; at most HEALTH_HUNGRY_MAX when its level eats
 *   and it has no food at all.
 *
 * Disease risk (daily, on the home's own tick, like fire risk). Not below
 * DISEASE_MIN_POP people, nor in a mission whose scenario says
 * `disease: false` (the first two):
 *   risk += DISEASE_RATE x (100 - score) / 100 x crowding x difficulty.disease
 *           x (0.6 to 1.4), halved within a staffed hospital's reach
 *   crowding = DISEASE_CROWD_BASE + min(DISEASE_CROWD_MAX, residents / DISEASE_CROWD_PEOPLE)
 * A physician passing by resets it to 0 (as a prefect resets fire risk). At
 * DISEASE_THRESHOLD a home has a DISEASE_OUTBREAK_CHANCE a day to fall sick.
 *
 * An outbreak: DISEASE_DEATHS of the residents die (DISEASE_DEATHS_HOSPITAL
 * within a hospital's reach), at least one; a home left empty becomes a
 * vacant lot. The rest are sick for SICK_DAYS: the home cannot move up and
 * takes in no settlers, and once a day every occupied home touching it gains
 * DISEASE_HEAT risk and has a DISEASE_SPREAD_CHANCE to fall sick at once
 * (halved within a hospital's reach). One chance a day per neighbor, however
 * many sick homes it touches: the lesson of updateFires, where rolling per
 * tile let one fire take a whole block.
 *
 * A physician who passes a sick home cures it. A staffed medicus near an
 * outbreak sends one, the way prefectures send prefects to fires: a
 * physician already on his rounds nearby is called over first. Otherwise
 * the home recovers by itself when its days run out.
 *
 * City health: monthly, HEALTH_STEP toward the residents' average score
 * (weighted by residents); it stays at HEALTH_START below DISEASE_MIN_POP
 * people. It is only shown: no rating, and not migration, reads it.
 *
 * Messages: at most one "Disease has broken out" pop-up a month; the month's
 * other outbreaks are summed up in one message at the start of the next.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { HOUSE_TIERS } from '../data/housing.js';
import { FOOD_TYPES } from '../data/goods.js';
import { WaterBits } from '../world/map.js';
import { spawnWalker, perimeterTiles } from './entities.js';
import { followPath, goHome } from './movement.js';
import { buildingLabel, withArticle } from './risk.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** A year's (or a game's) disease counts. */
export function newHealthCounts() {
  return { outbreaks: 0, spread: 0, deaths: 0, cured: 0, recovered: 0 };
}

/** Fresh city.health for a new game (and for saves made before disease existed). */
export function newHealthState() {
  return {
    value: CONFIG.HEALTH_START, // city health, the advisor's number
    target: CONFIG.HEALTH_START, // the residents' average health score last month
    messageMonth: -1, // month of the last outbreak pop-up (at most one a month)
    quiet: 0, // outbreaks since then with no pop-up of their own...
    quietDeaths: 0, // ...and their dead: summed up at the start of the next month
    year: newHealthCounts(),
    lastYear: null,
    total: newHealthCounts(), // since the city was founded (the sim report)
  };
}

function bump(game, key, n = 1) {
  const hc = game.city.health;
  hc.year[key] = (hc.year[key] || 0) + n;
  hc.total[key] = (hc.total[key] || 0) + n;
}

/** Yearly: this year's counts become last year's. */
export function healthNewYear(game) {
  const hc = game.city.health;
  hc.lastYear = hc.year;
  hc.year = newHealthCounts();
}

/** Disease happens in this game (not in the first two missions). */
export function diseaseEnabled(game) {
  return game.scenario.disease !== false;
}

/** Disease can break out now: enabled, and the city is big enough. */
export function diseaseActive(game) {
  return diseaseEnabled(game) && game.city.population >= CONFIG.DISEASE_MIN_POP;
}

// ---------------------------------------------------------------------------
// The rules, as pure functions (tests call these directly)
// ---------------------------------------------------------------------------

/**
 * A home's health score from what it has.
 * @param {{tier:number, medicus:boolean, hospital:boolean, baths:boolean, barber:boolean,
 *          fountain:boolean, foods:number, eats:boolean}} inp
 */
export function healthScore(inp) {
  let s = Math.min(CONFIG.HEALTH_LEVEL_MAX, inp.tier);
  if (inp.medicus && inp.hospital) s += CONFIG.HEALTH_CARE_BOTH;
  else if (inp.hospital) s += CONFIG.HEALTH_CARE_HOSPITAL;
  else if (inp.medicus) s += CONFIG.HEALTH_CARE_MEDICUS;
  if (inp.baths) s += CONFIG.HEALTH_BATHS;
  if (inp.barber) s += CONFIG.HEALTH_BARBER;
  if (inp.fountain) s += CONFIG.HEALTH_FOUNTAIN;
  s += CONFIG.HEALTH_PER_FOOD * inp.foods;
  s = Math.max(0, Math.min(100, s));
  if (inp.eats && inp.foods === 0) s = Math.min(s, CONFIG.HEALTH_HUNGRY_MAX);
  return s;
}

/**
 * What lowers a home's score, most points first (keys of HEALTH_LACKS in
 * data/disease.js). Its level is not a lack: it rises as the home does.
 */
export function healthLacks(inp) {
  const out = [];
  if (!inp.medicus && !inp.hospital) out.push('care');
  if (inp.eats && inp.foods === 0) out.push('hunger');
  if (inp.medicus && !inp.hospital) out.push('hospital');
  if (inp.hospital && !inp.medicus) out.push('medicus');
  if (!inp.baths) out.push('baths');
  if (!inp.barber) out.push('barber');
  if (!inp.fountain) out.push(inp.well ? 'well' : 'water');
  if (inp.foods > 0 && inp.foods < FOOD_TYPES.length) out.push('food');
  return out;
}

/** How much a home's residents crowd it: fuller homes build disease risk faster. */
export function crowding(pop) {
  return CONFIG.DISEASE_CROWD_BASE + Math.min(CONFIG.DISEASE_CROWD_MAX, Math.max(0, pop) / CONFIG.DISEASE_CROWD_PEOPLE);
}

/** Disease risk a home builds in a day on average (before the day's roll and a hospital). */
export function dailyRisk(score, pop, lever = 1) {
  return CONFIG.DISEASE_RATE * ((100 - score) / 100) * crowding(pop) * lever;
}

/** Residents who die when a home of `pop` falls sick (at least one, never more than live there). */
export function outbreakDeaths(pop, hospital = false) {
  if (pop <= 0) return 0;
  const share = hospital ? CONFIG.DISEASE_DEATHS_HOSPITAL : CONFIG.DISEASE_DEATHS;
  return Math.min(pop, Math.max(1, Math.round(pop * share)));
}

// ---------------------------------------------------------------------------
// Measuring a home
// ---------------------------------------------------------------------------

/** Does any tile of the building carry this water-layer bit? */
function footprintHas(game, b, bit) {
  const { map } = game;
  for (let dy = 0; dy < b.size; dy++) {
    for (let dx = 0; dx < b.size; dx++) {
      if (map.inBounds(b.x + dx, b.y + dy) && map.water[map.idx(b.x + dx, b.y + dy)] & bit) return true;
    }
  }
  return false;
}

/** Is the home within a staffed hospital's reach (sim/water.js marks it daily)? */
export function inHospitalReach(game, b) {
  return footprintHas(game, b, WaterBits.HOSPITAL);
}

/** What a home has, for its health score. Read-only. */
export function healthInputs(game, b) {
  const h = b.house;
  let foods = 0;
  for (const f of FOOD_TYPES) if (h.food[f] > 0.01) foods++;
  return {
    tier: h.tier,
    medicus: h.clinic > 0,
    hospital: inHospitalReach(game, b),
    baths: h.baths > 0,
    barber: h.barber > 0,
    fountain: footprintHas(game, b, WaterBits.FOUNTAIN),
    well: footprintHas(game, b, WaterBits.WELL),
    foods,
    eats: HOUSE_TIERS[h.tier].eats,
  };
}

/** A home's health score right now. */
export function houseHealth(game, b) {
  return healthScore(healthInputs(game, b));
}

// ---------------------------------------------------------------------------
// Daily: risk, outbreaks, sick homes
// ---------------------------------------------------------------------------

/** Daily, on the home's own tick (after its fire risk): disease risk grows, and may break out. */
export function updateDiseaseRisk(game, b) {
  const h = b.house;
  if (h.tier === 0 || h.pop <= 0) {
    h.diseaseRisk = 0; // nobody left to fall sick
    h.sick = 0;
    return;
  }
  if (h.sick > 0 || !diseaseActive(game)) return;
  const inp = healthInputs(game, b);
  let add = dailyRisk(healthScore(inp), h.pop, game.difficulty.disease ?? 1) * (0.6 + game.rng.next() * 0.8);
  if (inp.hospital) add *= 0.5;
  h.diseaseRisk = (h.diseaseRisk || 0) + add;
  if (h.diseaseRisk >= CONFIG.DISEASE_THRESHOLD && game.rng.chance(CONFIG.DISEASE_OUTBREAK_CHANCE)) outbreak(game, b);
}

/**
 * A home falls sick (also the console's `sick` command). Some residents die,
 * the rest are sick for SICK_DAYS, and a physician is sent for.
 * @param {'risk'|'spread'|'console'} cause
 * @returns {number} the residents who died (0: it was empty or already sick)
 */
export function outbreak(game, b, cause = 'risk') {
  const h = b.house;
  if (!h || h.pop <= 0 || h.sick > 0) return 0;
  const deaths = outbreakDeaths(h.pop, inHospitalReach(game, b));
  h.pop -= deaths;
  h.diseaseRisk = 0;
  h.sick = h.pop > 0 ? CONFIG.SICK_DAYS : 0; // a home left empty becomes a vacant lot (sim/housing.js)
  bump(game, 'outbreaks');
  bump(game, 'deaths', deaths);
  if (cause === 'spread') bump(game, 'spread');
  const sent = h.pop > 0 && dispatchPhysician(game, b);
  announce(game, b, deaths, cause, sent);
  return deaths;
}

/** The outbreak's message: one pop-up a month, the rest summed up next month. */
function announce(game, b, deaths, cause, sent) {
  const hc = game.city.health;
  const month = game.time.totalMonths;
  if (hc.messageMonth === month) {
    hc.quiet++;
    hc.quietDeaths += deaths;
    return;
  }
  hc.messageMonth = month;
  const where = withArticle(buildingLabel(b));
  const head = cause === 'spread' ? `Disease has spread to ${where}` : `Disease has broken out in ${where}`;
  const dead = `${deaths} ${deaths === 1 ? 'resident has' : 'residents have'} died`;
  let help;
  if (b.house.pop <= 0) help = 'The home stands empty.';
  else if (sent) help = 'A physician is on the way.';
  else help = 'No physician is near enough to help: a staffed Medicus nearby would send one.';
  game.message(`${head}: ${dead}. ${help}`, 'bad', b.x, b.y);
  game.events.emit('sound', { name: 'wrath' }); // a low, grim note (the war horn is for riots and raids)
}

/** A physician's visit: the home's disease risk is gone, and a sick home is cured. */
export function cureHome(game, b) {
  const h = b.house;
  if (!h) return;
  h.diseaseRisk = 0;
  if (h.sick > 0) {
    h.sick = 0;
    bump(game, 'cured');
  }
}

/**
 * Daily: sick homes spread the disease to the homes touching them, call for a
 * physician now and then, and count down to recovery.
 */
export function updateSickHomes(game) {
  const { map, buildings, rng } = game;
  const sick = [];
  for (const b of buildings.values()) {
    const h = b.house;
    if (!h || !(h.sick > 0)) continue;
    if (h.pop <= 0) { h.sick = 0; continue; }
    sick.push(b);
  }
  if (!sick.length) return;
  const spreads = diseaseActive(game);
  const near = [];
  const seen = new Set(sick.map((b) => b.id));
  for (const b of sick) {
    const h = b.house;
    if (spreads) {
      for (const i of perimeterTiles(map, b.x, b.y, b.size)) {
        const id = map.building[i];
        if (!id || seen.has(id)) continue;
        const nb = buildings.get(id);
        if (!nb || !nb.house || nb.house.pop <= 0 || nb.house.tier === 0) continue;
        seen.add(id);
        near.push(nb);
      }
    }
    // Remind a physician every few days while nobody has come.
    if (h.sick % 4 === 0) dispatchPhysician(game, b);
    h.sick--;
    if (h.sick <= 0) {
      h.sick = 0;
      bump(game, 'recovered');
    }
  }
  const lever = game.difficulty.disease ?? 1;
  for (const nb of near) {
    const nh = nb.house;
    if (!buildings.has(nb.id) || nh.sick > 0 || nh.pop <= 0) continue;
    nh.diseaseRisk = (nh.diseaseRisk || 0) + CONFIG.DISEASE_HEAT * lever;
    const p = CONFIG.DISEASE_SPREAD_CHANCE * lever * (inHospitalReach(game, nb) ? 0.5 : 1);
    if (rng.chance(p)) outbreak(game, nb, 'spread');
  }
}

// ---------------------------------------------------------------------------
// Physicians sent to the sick (as prefects to fires)
// ---------------------------------------------------------------------------

const onRounds = (w) => w.type === 'physician' && !w.dead && (w.state === 'roam' || w.state === 'return');

/** Is a physician already on his way to this home? */
function physicianComing(game, id) {
  for (const w of game.walkers.values()) if (w.type === 'physician' && !w.dead && w.state === 'toSick' && w.target === id) return true;
  return false;
}

function sendTo(game, w, b, path) {
  w.state = 'toSick';
  w.target = b.id;
  followPath(game, w, path);
}

/**
 * Send a physician to a sick home: one already walking his rounds within
 * PHYSICIAN_ALERT_RADIUS road tiles comes over; otherwise the nearest staffed
 * Medicus within that reach sends one. @returns {boolean} someone is coming
 */
export function dispatchPhysician(game, b) {
  const { map, pf } = game;
  const road = b.accessRoad;
  if (road < 0 || !map.road[road]) return false;
  if (physicianComing(game, b.id)) return true;
  const R = CONFIG.PHYSICIAN_ALERT_RADIUS;
  const byTile = new Map();
  for (const w of game.walkers.values()) if (onRounds(w)) byTile.set(map.idx(w.x, w.y), w);
  if (byTile.size > 0) {
    const found = pf.bfsRoad(road, (i) => byTile.has(i), R);
    if (found >= 0) {
      sendTo(game, byTile.get(found), b, pf.buildPath(found).reverse()); // physician -> home
      return true;
    }
  }
  const found = pf.findNearest(road, (id) => {
    const m = game.buildings.get(id);
    return !!m && m.type === 'clinic' && m.efficiency > 0 && m.accessRoad >= 0;
  }, R);
  if (!found) return false;
  const med = game.buildings.get(found.id);
  const path = pf.roadPath(med.accessRoad, road);
  if (!path) return false;
  const w = spawnWalker(game, 'physician', med.accessRoad, med, { state: 'toSick', target: b.id });
  if (!w) return false;
  followPath(game, w, path);
  return true;
}

/**
 * Cure every sick home within a physician's reach of where he stands (his
 * walk already does this tile by tile; this covers a physician who was sent
 * to the road he stood on).
 */
function treatAround(game, w) {
  const { map, buildings } = game;
  const r = CONFIG.SERVICE_RADIUS;
  for (let y = Math.max(0, w.y - r); y <= Math.min(map.h - 1, w.y + r); y++) {
    for (let x = Math.max(0, w.x - r); x <= Math.min(map.w - 1, w.x + r); x++) {
      const b = buildings.get(map.building[map.idx(x, y)]);
      if (b && b.house && b.house.pop > 0) {
        b.house.clinic = CONFIG.ACCESS_DAYS;
        cureHome(game, b);
      }
    }
  }
}

/** A physician sent to a sick home arrived: he stays a day, then looks for more. */
export function physicianArrive(game, w) {
  treatAround(game, w);
  w.state = 'treat';
  w.target = 0;
  w.waitTicks = CONFIG.PHYSICIAN_TREAT_TICKS;
  w.afterWait = 'nextSick';
}

/** After treating: the nearest other sick home within reach nobody is seeing to, else home. */
export function physicianAfterWait(game, w) {
  const { map, pf, buildings } = game;
  const here = map.idx(w.x, w.y);
  let target = null;
  if (map.road[here] && game.homeByRoad) {
    const found = pf.bfsRoad(here, (i) => {
      for (const id of game.homeByRoad.get(i) || []) {
        const b = buildings.get(id);
        if (b && b.house.sick > 0 && b.house.pop > 0 && !physicianComing(game, id)) { target = b; return true; }
      }
      return false;
    }, CONFIG.PHYSICIAN_ALERT_RADIUS);
    if (found >= 0 && target) {
      sendTo(game, w, target, pf.buildPath(found));
      return;
    }
  }
  goHome(game, w);
}

// ---------------------------------------------------------------------------
// Monthly: city health
// ---------------------------------------------------------------------------

/**
 * Monthly: sum up last month's quiet outbreaks, and move city health toward
 * the residents' average score (it stays at HEALTH_START in a small town).
 */
export function updateCityHealth(game) {
  const hc = game.city.health;
  if (hc.quiet > 0) {
    const n = hc.quiet;
    const d = hc.quietDeaths;
    game.message(`Disease struck ${n} more home${n > 1 ? 's' : ''} last month; ${d} ${d === 1 ? 'resident' : 'residents'} died.`, 'warn');
    hc.quiet = 0;
    hc.quietDeaths = 0;
  }
  if (game.city.population < CONFIG.DISEASE_MIN_POP) {
    hc.value = CONFIG.HEALTH_START;
    hc.target = CONFIG.HEALTH_START;
    return;
  }
  let people = 0;
  let sum = 0;
  for (const b of game.buildings.values()) {
    const h = b.house;
    if (!h || h.pop <= 0) continue;
    people += h.pop;
    sum += houseHealth(game, b) * h.pop;
  }
  hc.target = people > 0 ? Math.round(sum / people) : CONFIG.HEALTH_START;
  const step = Math.max(-CONFIG.HEALTH_STEP, Math.min(CONFIG.HEALTH_STEP, hc.target - hc.value));
  hc.value = Math.max(0, Math.min(100, hc.value + step));
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/** Occupied homes that are sick right now. */
export function sickHomes(game) {
  const out = [];
  for (const b of game.buildings.values()) if (b.house && b.house.pop > 0 && b.house.sick > 0) out.push(b);
  return out;
}

/** "risk 83, health 22 (a Hut at 12,40)" rows for the homes closest to an outbreak, for the console. */
export function riskiestHomes(game, n = 5) {
  const homes = [];
  for (const b of game.buildings.values()) if (b.house && b.house.pop > 0) homes.push(b);
  homes.sort((a, b) => (b.house.diseaseRisk || 0) - (a.house.diseaseRisk || 0) || a.id - b.id);
  return homes.slice(0, n).map((b) => {
    const h = b.house;
    return `risk ${Math.round(h.diseaseRisk || 0)}, health ${houseHealth(game, b)}: ${HOUSE_TIERS[h.tier].name} #${b.id} at ${b.x},${b.y}${h.sick > 0 ? ` (sick, ${h.sick} days left)` : ''}`;
  });
}

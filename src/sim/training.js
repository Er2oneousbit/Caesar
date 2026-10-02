/**
 * training.js
 * ----------------------------------------------------------------------------
 * The Military Academy (the original's) and the Portus (Colonia's own, the
 * fleet's counterpart, after the harbor Agrippa cut near Naples to train his
 * crews): who goes to be trained, and when.
 *
 * Training belongs to the man, or the ship's crew: every Roman unit has a
 * `trained` flag, set when he has trained his time at a fully staffed academy
 * (or the ship at the Portus), not as he sets out or arrives. The original trained a whole legion the moment one recruit
 * set out for the academy, even if he died on the way; Colonia's soldiers are
 * individuals, so the fort panel shows "5 of 8 trained" instead.
 *
 * Only a building at full staff trains anybody (every worker in place, a road,
 * and for a Portus its water), as in the original: 19 of 20 trains no one.
 * "Nearest" is the larger of the two axis distances between the buildings'
 * centers (the original's measure), the lower id on a tie.
 *
 * Who goes
 *   A new recruit: the barracks picks his fort as before. If a training
 *   academy stands anywhere, the one nearest HIS FORT (not the barracks: a
 *   recruit may cross the city and back, as in the original) is his first
 *   stop, as long as the roads join barracks, academy and fort. He walks to
 *   its road and stays there ACADEMY_TRAIN_DAYS (walker state 'training'),
 *   his place in the fort held for him; the days count only while the
 *   academy is fully staffed (one short of staff pauses him). Then, trained,
 *   he walks on to his fort; the academy demolished meanwhile, he walks on
 *   untrained.
 *
 *   No trips at rest: a soldier in a fort stays at his post until his fort is
 *   deployed (sim/military.js), as the original's legions did, so a man who
 *   joined untrained stays so; only the next recruits, passing the academy,
 *   come trained.
 *
 *   A new liburnian: launched at the Navalia for its station (sim/navy.js), it
 *   rows first to the berth of the training Portus nearest that station on the
 *   same water, moors there PORTUS_TRAIN_DAYS (counted, as at the academy,
 *   only while the Portus is fully staffed; `trainLeft`), then rows on to its
 *   own berth, trained. Ships at their berths stay there, as soldiers at rest
 *   do.
 *
 *   A raid, or the station being deployed, calls a new ship on its way to the
 *   Portus (or moored there, training) straight to its station, untrained (it
 *   is needed), and a ship launched then does not go. A trip that does not
 *   reach the Portus in time (DRILL_MAX_DAYS, or twice the row for a far
 *   Portus, see startDrill) is given up.
 *
 * What training gives (Colonia has no morale, so the original's effects
 * become stats, data/units.js): trained legionaries holding position take a
 * share of missile damage and defend better (the original's close order),
 * trained archers and cavalry defend a little better (sim/military.js
 * unitDefense, missileDamage); a trained crew rows faster, rams harder and is
 * harder to hit (sim/navy.js). Attack and hit points never change. For a
 * distant battle, battleStrength gives what each counts for.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { UNIT_TYPES } from '../data/units.js';
import { followPath } from './movement.js';
import { killWalker } from './entities.js';
import { waterOf } from './navy.js';

/** The larger of the two axis distances between two buildings' centers. */
export function reachBetween(a, b) {
  return Math.max(Math.abs(a.x + a.size / 2 - (b.x + b.size / 2)), Math.abs(a.y + a.size / 2 - (b.y + b.size / 2)));
}

/**
 * Does this academy or Portus train anyone right now? Every worker in place
 * and a road; a Portus also needs water ships can sail beside it.
 */
export function trainsNow(game, b) {
  if (!b || !(b.efficiency >= 1) || b.accessRoad < 0) return false;
  if (b.def.kind === 'portus') return waterOf(game, b) > 0;
  return b.def.kind === 'military_academy';
}

/** The training building of `kind` nearest `from` that `ok` accepts, or null. */
function nearestSchool(game, kind, from, ok = () => true) {
  let best = null;
  let bestD = Infinity;
  for (const b of game.buildings.values()) {
    if (b.def.kind !== kind || !trainsNow(game, b) || !ok(b)) continue;
    const d = reachBetween(b, from);
    if (d < bestD || (d === bestD && b.id < best.id)) { best = b; bestD = d; }
  }
  return best;
}

/** The academy a fort's men train at: the training one nearest the fort. */
export function academyFor(game, fort) {
  return nearestSchool(game, 'military_academy', fort);
}

/** The Portus a station's ships train at: the training one nearest it, on its water. */
export function portusFor(game, station) {
  const body = waterOf(game, station);
  if (!body) return null;
  return nearestSchool(game, 'portus', station, (p) => waterOf(game, p) === body);
}

/** What a unit counts for in a distant battle (data/units.js strength; 0 for raiders). */
export function battleStrength(u) {
  const def = UNIT_TYPES[u.type];
  if (!def || !def.strength) return 0;
  return u.trained ? def.trainedStrength : def.strength;
}

/**
 * Who is training right now, for the panels: the recruits at an academy (or
 * those of a fort) and the ships moored at a Portus (or those of a station),
 * each with the days left and whether the school is short of staff (paused).
 * Soonest done first. @returns {{days:number, paused:boolean, school:object|null}[]}
 */
export function inTraining(game, b) {
  const out = [];
  const add = (schoolId, ticks) => {
    const school = game.buildings.get(schoolId) || null;
    out.push({ days: Math.ceil(ticks / CONFIG.TICKS_PER_DAY), paused: !trainsNow(game, school), school });
  };
  for (const w of game.walkers.values()) {
    if (w.dead || w.type !== 'recruit' || w.state !== 'training') continue;
    if (w.academy === b.id || w.target === b.id) add(w.academy, w.trainLeft);
  }
  for (const u of game.units.values()) {
    if (!u.drill || !(u.trainLeft > 0)) continue; // (a ship still rowing there has not begun)
    if (u.drill === b.id || u.station === b.id) add(u.drill, u.trainLeft);
  }
  return out.sort((a, c) => a.days - c.days);
}

/** Trained men (or ships) of a fort or station, and how many it has. */
export function trainedOf(game, postId) {
  let trained = 0;
  let all = 0;
  for (const u of game.units.values()) {
    if (u.fort !== postId && u.station !== postId) continue;
    all++;
    if (u.trained) trained++;
  }
  return { trained, all };
}

/** Trained soldiers and trained ships in the whole city (the Military advisor). */
export function trainedTotals(game) {
  const out = { soldiers: 0, soldiersTrained: 0, ships: 0, shipsTrained: 0 };
  for (const u of game.units.values()) {
    if (u.side !== 'rome') continue;
    if (UNIT_TYPES[u.type].naval) { out.ships++; if (u.trained) out.shipsTrained++; } else { out.soldiers++; if (u.trained) out.soldiersTrained++; }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Recruits
// ---------------------------------------------------------------------------

/**
 * The first leg of a new recruit's march: to the road of the academy nearest
 * his fort, when the roads join barracks, academy and fort. Null: straight to
 * the fort, untrained.
 * @returns {{academy:object, path:number[]}|null}
 */
export function recruitDetour(game, barracks, fort) {
  const academy = academyFor(game, fort);
  if (!academy) return null;
  const path = game.pf.roadPath(barracks.accessRoad, academy.accessRoad);
  if (!path || !game.pf.roadPath(academy.accessRoad, fort.accessRoad)) return null;
  return { academy, path };
}

/**
 * A recruit reached the academy's road: he stays there to train (state
 * 'training', `trainLeft` ticks of ACADEMY_TRAIN_DAYS), his place in the fort
 * still held for him. The academy gone meanwhile: he walks on, untrained.
 */
export function recruitAtAcademy(game, w) {
  const academy = game.buildings.get(w.academy);
  if (!academy || academy.def.kind !== 'military_academy') { recruitOnward(game, w); return; }
  w.state = 'training';
  w.trainLeft = CONFIG.ACADEMY_TRAIN_DAYS * CONFIG.TICKS_PER_DAY;
  w.moving = false;
}

/**
 * Per tick (sim/walkers.js), a recruit at the academy: a day of training
 * counts only while it is fully staffed (trainsNow), so one short of staff
 * pauses him and a full staff again resumes; kept waiting more than
 * TRAIN_WAIT_MAX_DAYS in all, he goes on untrained. Done, he is trained and walks on
 * to his fort; the academy demolished, he walks on untrained.
 */
export function recruitTraining(game, w) {
  const academy = game.buildings.get(w.academy);
  if (!academy || academy.def.kind !== 'military_academy') { recruitOnward(game, w); return; }
  if (!trainsNow(game, academy)) {
    // Short of staff: he waits, but not for ever (see TRAIN_WAIT_MAX_DAYS).
    w.trainWait = (w.trainWait || 0) + 1;
    if (w.trainWait > CONFIG.TRAIN_WAIT_MAX_DAYS * CONFIG.TICKS_PER_DAY) recruitOnward(game, w);
    return;
  }
  w.trainLeft--;
  if (w.trainLeft > 0) return;
  w.trained = true;
  w.trainedAt = academy.id; // counted when he joins his fort (recruitTrained), not before
  recruitOnward(game, w);
}

/**
 * From the academy on to his fort, trained or not. No road there any more:
 * he is lost, as a recruit on his way to the fort is.
 */
function recruitOnward(game, w) {
  w.academy = 0;
  w.trainLeft = 0;
  w.trainWait = 0;
  const fort = game.buildings.get(w.target);
  const path = fort && fort.accessRoad >= 0 ? game.pf.roadPath(game.map.idx(w.x, w.y), fort.accessRoad) : null;
  if (!path) { killWalker(game, w); return; }
  w.state = 'toFort';
  followPath(game, w, path);
}

// ---------------------------------------------------------------------------
// Trips: a new ship to the Portus
// ---------------------------------------------------------------------------

/**
 * A recruit trained on his way became a soldier of his fort: count him at his
 * academy. (Counted then, not at the academy, so a recruit lost after it, his
 * fort demolished or full, is not counted as trained.)
 */
export function recruitTrained(game, w) {
  countTrained(game, game.buildings.get(w.trainedAt), 'military_academy');
}

/**
 * Send a new ship to the Portus. The trip may take at least DRILL_MAX_DAYS,
 * and for a far Portus twice the straight-line row there at its speed (with
 * room for detours), so a station far across a big map is not given up on
 * halfway there.
 */
export function startDrill(game, u, school) {
  const tiles = Math.hypot(school.x + school.size / 2 - u.x, school.y + school.size / 2 - u.y);
  const perDay = UNIT_TYPES[u.type].speed * CONFIG.TICKS_PER_DAY;
  u.drill = school.id;
  u.drillDay = game.time.totalDays;
  u.drillDays = Math.max(CONFIG.DRILL_MAX_DAYS, Math.ceil((2 * tiles) / perDay) + 10);
  u.path = null;
  u.state = 'drill';
}

/** The trip is over (or called off): on to the berth. */
export function endDrill(u) {
  u.drill = 0;
  u.drillDay = 0;
  u.drillDays = 0;
  u.trainLeft = 0;
  u.trainWait = 0;
  u.path = null;
}

/** A ship has trained its days at the Portus: its crew is trained for good. */
export function drilled(game, u, school) {
  u.trained = true;
  endDrill(u);
  countTrained(game, school, school.def.kind);
}

/** One more trained at a school (if it is gone since, the city's count only). */
function countTrained(game, school, kind) {
  if (school) school.trainedHere = (school.trainedHere || 0) + 1;
  const st = game.military.stats;
  if (kind === 'portus') st.crewsTrained = (st.crewsTrained || 0) + 1;
  else st.soldiersTrained = (st.soldiersTrained || 0) + 1;
}

/**
 * Daily (sim/military.js militaryDaily): the new ships on their way to the
 * Portus, or moored there training. A raid, or the station deployed or gone,
 * calls one straight to its berth, untrained; a trip that has not reached the
 * Portus in time (no way there, say) is given up. Nobody is
 * sent from here: men and ships at rest stay at their posts. (A soldier on a
 * trip in an older save is sent home by updateRoman, sim/military.js.)
 */
export function updateDrill(game) {
  const raid = !!game.military.active || !!game.military.caesar?.army; // (Caesar's legions too, sim/legion.js)
  const today = game.time.totalDays;
  for (const u of game.units.values()) {
    if (!u.drill || u.side !== 'rome') continue;
    const post = game.buildings.get(u.station || u.fort);
    if (raid || !post || post.rally) endDrill(u); // needed at home
    else if (!(u.trainLeft > 0) && today - u.drillDay > (u.drillDays || CONFIG.DRILL_MAX_DAYS)) endDrill(u); // (one moored there, training, has arrived)
  }
}

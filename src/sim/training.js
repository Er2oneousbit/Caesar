/**
 * training.js
 * ----------------------------------------------------------------------------
 * The Military Academy (the original's) and the Portus (Colonia's own, the
 * fleet's counterpart, after the harbor Agrippa cut near Naples to train his
 * crews): who goes to be trained, and when.
 *
 * Training belongs to the man, or the ship's crew: every Roman unit has a
 * `trained` flag, set when he ARRIVES at a fully staffed academy (or the ship
 * at the Portus). The original trained a whole legion the moment one recruit
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
 *   its road, is trained there, and walks on to his fort.
 *
 *   A soldier at rest (Colonia's own: in the original a legion already full
 *   never got a recruit, so it was never trained): each day a fort that is
 *   not deployed, while no raid is on, sends its first untrained idle soldier
 *   (the lowest slot) to the academy nearest it, DRILL_PER_POST at a time, so
 *   a fort is never emptied for the drill yard. He marches over open land like
 *   any soldier (sim/military.js), is trained at the academy's road and
 *   marches back to his post.
 *
 *   A new liburnian: launched at the Navalia for its station (sim/navy.js), it
 *   rows first to the berth of the training Portus nearest that station on the
 *   same water, then on to its own berth. Ships berthed at a station take
 *   turns as soldiers at rest do.
 *
 *   A raid, or the fort or station being deployed, calls everyone on a trip
 *   home at once (they are needed), and no new trip starts until it is over.
 *   A trip not done in time (DRILL_MAX_DAYS, or twice the walk for a far
 *   school, see startDrill) is given up; that fort or
 *   station then waits DRILL_RETRY_DAYS before sending anyone again.
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
 * A recruit reached the academy's road: trained (if it still stands; staff
 * lost since he set out changes nothing, as in the original), he walks on to
 * his fort. No road there any more: he is lost, as a recruit on his way to the
 * fort is.
 */
export function recruitAtAcademy(game, w) {
  const academy = game.buildings.get(w.academy);
  if (academy && academy.def.kind === 'military_academy') {
    w.trained = true;
    w.trainedAt = academy.id; // counted when he joins his fort (recruitTrained), not before
  }
  w.academy = 0;
  const fort = game.buildings.get(w.target);
  const path = fort && fort.accessRoad >= 0 ? game.pf.roadPath(game.map.idx(w.x, w.y), fort.accessRoad) : null;
  if (!path) { killWalker(game, w); return; }
  w.state = 'toFort';
  followPath(game, w, path);
}

// ---------------------------------------------------------------------------
// Trips: soldiers at rest, new ships, ships at rest
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
 * Send a soldier or a ship to an academy or Portus. The trip may take at
 * least DRILL_MAX_DAYS, and for a far school twice the straight-line journey
 * there at its speed (there and back, with room for detours), so a fort far
 * across a big map is not given up on halfway there.
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

/** The trip is over (or called off): back to the post. */
export function endDrill(u) {
  u.drill = 0;
  u.drillDay = 0;
  u.drillDays = 0;
  u.path = null;
}

/** A soldier or ship arrived: trained for good. */
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

/** Give up a trip (no way there): the post waits before sending anyone again. */
export function abandonDrill(game, u) {
  const post = game.buildings.get(u.fort || u.station);
  if (post) post.drillWait = game.time.totalDays + CONFIG.DRILL_RETRY_DAYS;
  endDrill(u);
}

/**
 * Daily (sim/military.js militaryDaily): trips for the men and ships at rest.
 * Does nothing at all, and draws nothing, in a city with no academy or Portus.
 */
export function updateDrill(game) {
  let academies = false;
  let ports = false;
  for (const b of game.buildings.values()) {
    if (b.def.kind === 'military_academy') academies = true;
    else if (b.def.kind === 'portus') ports = true;
  }
  if (!academies && !ports) return;
  const raid = !!game.military.active || !!game.military.caesar?.army; // (Caesar's legions too, sim/legion.js)
  const today = game.time.totalDays;
  const byPost = new Map(); // fort or station id -> its units
  for (const u of game.units.values()) {
    const post = u.side === 'rome' ? u.fort || u.station : 0;
    if (!post) continue;
    if (!byPost.has(post)) byPost.set(post, []);
    byPost.get(post).push(u);
  }
  for (const b of game.buildings.values()) {
    const fort = b.def.kind === 'fort';
    if (!(fort && academies) && !(b.def.kind === 'station' && ports)) continue;
    const men = byPost.get(b.id) || [];
    let away = 0;
    for (const u of men) {
      if (!u.drill) continue;
      if (raid || b.rally) endDrill(u); // needed at home
      else if (today - u.drillDay > (u.drillDays || CONFIG.DRILL_MAX_DAYS)) abandonDrill(game, u);
      else away++;
    }
    if (raid || b.rally || away >= CONFIG.DRILL_PER_POST || (b.drillWait || 0) > today) continue;
    const rest = fort ? 'idle' : 'berthed';
    let pupil = null;
    for (const u of men) if (!u.trained && !u.drill && u.state === rest && (!pupil || u.slot < pupil.slot)) pupil = u;
    if (!pupil) continue;
    const school = fort ? academyFor(game, b) : portusFor(game, b);
    if (school) startDrill(game, pupil, school);
  }
}

/** Where a soldier goes to be trained: the academy's road tile (the caller checks it has one). */
export function drillSpot(game, academy) {
  const i = academy.accessRoad;
  return { x: game.map.xOf(i) + 0.5, y: game.map.yOf(i) + 0.5 };
}

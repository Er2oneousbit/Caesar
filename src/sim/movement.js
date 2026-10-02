/**
 * movement.js
 * ----------------------------------------------------------------------------
 * Low-level walker movement helpers: follow a path, head home, pick the next
 * tile while roaming. Behavior modules (storage, market, trade...) use these to
 * send walkers around without knowing how movement works internally.
 *
 * Movement model: a walker always stands on tile (x,y) and walks toward the
 * adjacent tile (tx,ty). `progress` goes 0 -> 1; on reaching 1 the walker
 * "arrives" and walkers.js decides what happens next.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { WALKER_TYPES, roadblockBit } from '../data/walkers.js';
import { ROADBLOCK } from '../world/map.js';
import { killWalker, mainOf } from './entities.js';
import { vendorNeed } from './market.js';

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

/** Direction index (0..3) from one tile to an orthogonally adjacent tile, -1 otherwise. */
export function dirBetween(x0, y0, x1, y1) {
  for (let d = 0; d < 4; d++) if (x0 + DX[d] === x1 && y0 + DY[d] === y1) return d;
  return -1;
}

/** Point the walker at the next tile it should walk to. */
export function setNextTile(game, w, idx) {
  const { map } = game;
  const nx = map.xOf(idx);
  const ny = map.yOf(idx);
  w.tx = nx;
  w.ty = ny;
  const d = dirBetween(w.x, w.y, nx, ny);
  if (d >= 0) w.lastDir = d;
  w.moving = true;
}

/**
 * Make the walker follow a path (array of tile indices, path[0] = current tile).
 * A path of length 1 means "already there": the arrival fires on the next tick.
 */
export function followPath(game, w, path) {
  w.path = path;
  w.pathIndex = 0;
  w.progress = 0;
  if (!path || path.length <= 1) {
    w.path = null;
    w.moving = false;
    w.pendingArrive = true;
    return;
  }
  w.pendingArrive = false;
  setNextTile(game, w, path[1]);
}

/**
 * Walk along roads to a destination tile.
 * @returns {boolean} false if no road route exists
 */
export function walkTo(game, w, destIdx, maxDist = 1e9) {
  const { map } = game;
  const here = map.idx(w.x, w.y);
  const path = game.pf.roadPath(here, destIdx, maxDist);
  if (!path) return false;
  followPath(game, w, path);
  return true;
}

/**
 * Send the walker back to its origin building. Kills the walker if there is
 * no way home (origin demolished or disconnected from the road network).
 */
export function goHome(game, w) {
  const origin = game.buildings.get(w.origin);
  if (!origin || origin.accessRoad < 0) {
    killWalker(game, w);
    return false;
  }
  w.state = 'return';
  if (!walkTo(game, w, origin.accessRoad)) {
    killWalker(game, w);
    return false;
  }
  return true;
}

/**
 * Does a roadblock on tile `idx` stop this roaming walker? Only roamers are
 * ever stopped, and only by a roadblock that does not let their group through.
 */
export function roadblockStops(map, w, idx) {
  const rb = map.roadblock[idx];
  if (!rb) return false;
  const bit = roadblockBit(w.type);
  return bit !== 0 && !(rb & bit & ROADBLOCK.GROUPS);
}

/** Roamers strongly prefer to stay within this many tiles of home. */
const ROAM_RADIUS = 13;
/** How many recently walked tiles a roamer remembers (and avoids). */
const ROAM_MEMORY = 24;
/**
 * A roamer looks this far down each way it could take (following the road
 * through bends, up to the next junction, a dead end or a roadblock that
 * stops it) and weighs the way by what it finds (streetValue): an empty way
 * keeps EMPTY_STREET_WEIGHT of its weight, not zero.
 * Looking only at the next tile was not enough: a lone Forum's tax collector
 * turned onto the Imperial road (its first tile still beside a home), then
 * had no way but on to the empty map edge, and the registrations of the
 * homes he skipped ran out. Scoring only the share of tiles with something
 * to serve was too much: a clay pit at the end of an 8-tile spur lost a
 * third of its engineers' visits, so a way that reaches a building within
 * the lookahead counts in full. Not further: looking 16 tiles ahead made
 * the empty road from a housing block down to its farm quarter "lead to a
 * building" too, the block's engineers spent their rounds on it, and the
 * mission 3 playtest lost its Forum, temple and prefectures again. A
 * longer spur's outpost is better served by a post of its own.
 */
const ROAM_LOOKAHEAD = 8;
const EMPTY_STREET_WEIGHT = 0.2;
/**
 * Prefects and engineers are drawn to the way whose buildings are closest to
 * burning or falling down: a way whose worst building is at the disaster
 * threshold weighs 1 + RISK_PULL times as much. Without it the junctions were
 * coin tosses and a round takes some 25 days, and in a mission 2 playtest the
 * far side of a two-street block six tiles from its prefecture went 165 days
 * unvisited and burned (a Stone Cottage reaches the threshold in about 100).
 * With this and the overlapping rounds (sim/services.js), the longest gap
 * there fell to 58-82 days over six seeds; a pull of 4 left 81-108. The risk
 * is already in every save, so the pull needs no new state.
 */
const RISK_PULL = 10;
/**
 * Every other service roamer (priests, teachers, librarians, scholars,
 * barbers, physicians, bath attendants, entertainers, market vendors, tax
 * collectors) is drawn the same way to the way whose homes most need him
 * (streetNeed): a way whose neediest home has lost his access weighs
 * 1 + SERVICE_PULL times as much. They used to choose junctions by chance,
 * and in a mission 2 playtest the Stone Cottages on a school's far street
 * waited months for a teacher. Measured on that save over six seeds and two
 * years (with the lookahead of streetNeed and the overlapping rounds of
 * sim/services.js), the homes within ROAM_RADIUS of a service went 85,494
 * home-days without it, the longest wait 505 days; with a pull of 10, 3,312
 * days (longest wait 185), at 20, 137 (105), at 40 none (96: a visit lasts
 * 96 days), at 80, 392 (125). The mission 4 save and the demo city gained
 * little past 20. The pull is stronger than RISK_PULL because need, unlike
 * risk, stops growing once the access has run out: homes that lost it long
 * ago look no needier than homes that lost it yesterday.
 */
const SERVICE_PULL = 40;
/**
 * A home met k road steps down a way counts 1 - k * NEED_FADE of its need
 * (see streetNeed): half at the end of the lookahead, so a needy home round
 * the next corner draws less than one on the street itself.
 */
const NEED_FADE = 0.5 / ROAM_LOOKAHEAD;
/** Which risk a roamer's visit clears (sim/services.js), by its effect. */
const RISK_OF_EFFECT = { fire: 'fireRisk', damage: 'damageRisk' };

/** Is there any building within SERVICE_RADIUS of (x, y), i.e. would a walker there serve anything? */
function servesSomething(map, x, y) {
  const r = CONFIG.SERVICE_RADIUS;
  for (let ty = y - r; ty <= y + r; ty++) {
    for (let tx = x - r; tx <= x + r; tx++) if (map.inBounds(tx, ty) && map.building[map.idx(tx, ty)]) return true;
  }
  return false;
}

/**
 * What a way is worth to roamer `w` (0..1), starting at road tile (x, y)
 * heading `dir`: 1 when the tile it leads to (a dead end, a junction, the
 * last tile looked at) has something to serve, else the share of the tiles
 * on the way that do. A roadblock that stops `w` ends the way before it.
 */
export function streetValue(map, w, x, y, dir) {
  let served = 0;
  let n = 0;
  let endServes = false;
  for (let k = 0; k < ROAM_LOOKAHEAD; k++) {
    n++;
    endServes = servesSomething(map, x, y);
    if (endServes) served++;
    dir = wayOn(map, w, x, y, dir);
    if (dir < 0) break;
    x += DX[dir];
    y += DY[dir];
  }
  return endServes ? 1 : served / n;
}

/**
 * The way on along a street from road tile (x, y), arrived at heading `dir`:
 * the direction of the only road ahead, or -1 at a junction, a dead end or a
 * roadblock that stops roamer `w`.
 */
function wayOn(map, w, x, y, dir) {
  let next = -1;
  let ways = 0;
  for (let e = 0; e < 4; e++) {
    if (e === (dir + 2) % 4) continue;
    const nx = x + DX[e];
    const ny = y + DY[e];
    if (map.inBounds(nx, ny) && map.road[map.idx(nx, ny)]) { ways++; next = e; }
  }
  if (ways !== 1 || roadblockStops(map, w, map.idx(x + DX[next], y + DY[next]))) return -1;
  return next;
}

/**
 * The highest `score(building)` among the buildings a walker would pass going
 * `dir` from road tile (x, y): the same way, through bends up to the next
 * junction, that streetValue looks down.
 */
function worstAlong(game, w, x, y, dir, score) {
  const { map, buildings } = game;
  const r = CONFIG.SERVICE_RADIUS;
  let worst = 0;
  for (let k = 0; k < ROAM_LOOKAHEAD; k++) {
    for (let ty = y - r; ty <= y + r; ty++) {
      for (let tx = x - r; tx <= x + r; tx++) {
        if (!map.inBounds(tx, ty)) continue;
        const id = map.building[map.idx(tx, ty)];
        if (!id) continue;
        const v = score(buildings.get(id));
        if (v > worst) worst = v;
      }
    }
    dir = wayOn(map, w, x, y, dir);
    if (dir < 0) break;
    x += DX[dir];
    y += DY[dir];
  }
  return worst;
}

/**
 * The highest `risk` (0..1 of the disaster threshold) among the buildings a
 * walker would pass going `dir` from road tile (x, y).
 */
export function streetRisk(game, w, x, y, dir, risk) {
  const limit = risk === 'fireRisk' ? CONFIG.FIRE_THRESHOLD : CONFIG.DAMAGE_THRESHOLD;
  // A hippodrome's risk is kept on its main section (sim/risk.js), and a
  // walk past any section clears it (sim/services.js).
  const worst = worstAlong(game, w, x, y, dir, (b) => mainOf(game, b)?.[risk] || 0);
  return Math.min(1, worst / limit);
}

/** Effects whose visit sets the home timer of the same name (sim/services.js). */
const TIMER_EFFECTS = new Set(['school', 'library', 'academy', 'barber', 'baths', 'clinic']);

/** 0 for an access timer at full, 1 for one run out. */
const lapsed = (left, full) => 1 - Math.min(1, Math.max(0, left || 0) / full);

/**
 * How badly home `b` needs a visit from service roamer `w` (0..1): how far
 * the access his last visit gave it has run down (1 when it has none), or,
 * for a market vendor, how short its pantry is of what he carries
 * (vendorNeed). 0 for anything not a lived-in home, and for prefects and
 * engineers, who go by risk instead (streetRisk).
 */
export function homeNeed(game, w, b) {
  const h = b && b.house;
  if (!h || h.pop <= 0) return 0;
  const effect = WALKER_TYPES[w.type]?.effect;
  const days = CONFIG.ACCESS_DAYS;
  if (TIMER_EFFECTS.has(effect)) return lapsed(h[effect], days);
  switch (effect) {
    case 'religion': return w.god ? lapsed(h.religion[w.god], days) : 0;
    case 'venue': return w.venue ? lapsed(h.ent[w.venue], days) : 0;
    case 'tax': return lapsed(h.tax, CONFIG.TAX_ACCESS_DAYS);
    case 'market': {
      const market = w.origin ? game.buildings.get(w.origin) : null;
      return market && market.stock ? vendorNeed(market, h) : 0;
    }
    default: return 0;
  }
}

/**
 * How badly the homes down a way need service roamer `w` (0..1): the
 * neediest home (homeNeed) within reach of the roads he could walk from
 * road tile (x, y), stepped onto heading `dir`, within ROAM_LOOKAHEAD steps,
 * faded by NEED_FADE per step. Unlike streetRisk it looks past junctions
 * (never back through the one he stands on, nor past a roadblock that stops
 * him). Looking only to the next junction kept a temple's priests on the
 * streets beside it: the way to the block behind began among homes they had
 * just served, so it never drew them, and in the demo city the far rows went
 * up to 500 days without Venus. Measured with a pull of 10 over six seeds,
 * looking past junctions cut the demo city's home-days without a service in
 * reach from 131,518 to 49,111 and the mission 4 save's from 308,462 to
 * 267,369 (mission 2: 4,421 against 5,482, about even).
 * Homes farther than ROAM_RADIUS from his building count nothing: the pull
 * (up to 41 times) would otherwise outweigh the leash (a tenth) and draw him
 * off after homes he cannot keep, past the edge of his neighbourhood. With
 * this the mission 4 save's homes in reach went 178,495 home-days without a
 * service against 208,365, and all of its homes 226,700 against 248,811
 * (the demo city's 6,267 against 4,594, mission 2's none either way).
 */
export function streetNeed(game, w, x, y, dir) {
  const { map, buildings } = game;
  const r = CONFIG.SERVICE_RADIUS;
  const origin = w.origin ? buildings.get(w.origin) : null;
  const ox = origin ? origin.x + (origin.size - 1) / 2 : 0;
  const oy = origin ? origin.y + (origin.size - 1) / 2 : 0;
  const start = map.idx(x, y);
  const seen = new Set([map.idx(x - DX[dir], y - DY[dir]), start]);
  const needs = new Map(); // building id -> homeNeed, for homes beside several roads
  let worst = 0;
  let disc = 1;
  // Each building within reach of a road tile, first met at step k, counts
  // its need faded to `disc`; met again further on it can only count less.
  const look = (tx, ty) => {
    if (!map.inBounds(tx, ty)) return;
    const id = map.building[map.idx(tx, ty)];
    if (!id) return;
    let n = needs.get(id);
    if (n === undefined) {
      const b = buildings.get(id);
      const c = (b.size - 1) / 2; // from centre to centre, so a big home counts alike on every side
      n = origin && Math.max(Math.abs(b.x + c - ox), Math.abs(b.y + c - oy)) > ROAM_RADIUS ? 0 : homeNeed(game, w, b);
      needs.set(id, n);
    }
    if (n * disc > worst) worst = n * disc;
  };
  for (let ty = y - r; ty <= y + r; ty++) for (let tx = x - r; tx <= x + r; tx++) look(tx, ty);
  // Breadth first along the roads: a tile and the way it was entered by.
  // Everything within reach of a tile but the strip on its far side was
  // already in reach of the tile before it, one step nearer.
  let frontier = [start, dir];
  for (let k = 1; k <= ROAM_LOOKAHEAD && frontier.length; k++) {
    disc = 1 - k * NEED_FADE;
    if (worst >= disc) break; // nothing further on can beat it
    const next = [];
    for (let f = 0; f < frontier.length; f += 2) {
      const cx = map.xOf(frontier[f]);
      const cy = map.yOf(frontier[f]);
      for (let e = 0; e < 4; e++) {
        const nx = cx + DX[e];
        const ny = cy + DY[e];
        if (!map.inBounds(nx, ny)) continue;
        const j = map.idx(nx, ny);
        if (!map.road[j] || seen.has(j) || roadblockStops(map, w, j)) continue;
        seen.add(j);
        if (DX[e]) for (let ty = ny - r; ty <= ny + r; ty++) look(nx + DX[e] * r, ty);
        else for (let tx = nx - r; tx <= nx + r; tx++) look(tx, ny + DY[e] * r);
        if (k < ROAM_LOOKAHEAD) next.push(j, e);
      }
    }
    frontier = next;
  }
  return worst;
}

/**
 * Choose the next road tile for a roaming walker.
 *   - never reverses unless it hits a dead end
 *   - prefers going straight
 *   - avoids tiles it walked recently (better coverage)
 *   - avoids wandering far from its home building (keeps service local)
 *   - avoids streets with nothing along them to serve
 * @returns {number} tile index or -1 if the walker is stranded
 */
export function pickRoamTile(game, w) {
  const { map, rng } = game;
  const back = w.lastDir >= 0 ? (w.lastDir + 2) % 4 : -1;
  const origin = w.origin ? game.buildings.get(w.origin) : null;
  const ox = origin ? origin.x + (origin.size - 1) / 2 : w.x;
  const oy = origin ? origin.y + (origin.size - 1) / 2 : w.y;
  if (!w.memory) w.memory = [];
  const def = WALKER_TYPES[w.type];
  const risk = RISK_OF_EFFECT[def?.effect];
  const choices = [];
  for (let d = 0; d < 4; d++) {
    if (d === back) continue;
    const nx = w.x + DX[d];
    const ny = w.y + DY[d];
    if (!map.inBounds(nx, ny)) continue;
    const idx = map.idx(nx, ny);
    if (!map.road[idx] || roadblockStops(map, w, idx)) continue;
    let weight = d === w.lastDir ? 3 : 2;
    if (w.memory.includes(idx)) weight *= 0.25;
    if (Math.max(Math.abs(nx - ox), Math.abs(ny - oy)) > ROAM_RADIUS) weight *= 0.1;
    choices.push(d, weight);
  }
  // Looking down each way only matters at a junction: with one way on, it is
  // taken whatever it weighs (and the dice are thrown all the same).
  if (choices.length > 2) {
    for (let k = 0; k < choices.length; k += 2) {
      const d = choices[k];
      const nx = w.x + DX[d];
      const ny = w.y + DY[d];
      choices[k + 1] *= EMPTY_STREET_WEIGHT + (1 - EMPTY_STREET_WEIGHT) * streetValue(map, w, nx, ny, d);
      if (risk) choices[k + 1] *= 1 + RISK_PULL * streetRisk(game, w, nx, ny, d, risk);
      else if (def?.effect) choices[k + 1] *= 1 + SERVICE_PULL * streetNeed(game, w, nx, ny, d);
    }
  }
  let total = 0;
  for (let k = 1; k < choices.length; k += 2) total += choices[k];
  // Remember where we are now.
  w.memory.push(map.idx(w.x, w.y));
  if (w.memory.length > ROAM_MEMORY) w.memory.shift();
  if (total === 0) {
    // Dead end (or a roadblock ahead): turn around if there is a road behind us.
    if (back >= 0) {
      const nx = w.x + DX[back];
      const ny = w.y + DY[back];
      if (map.inBounds(nx, ny) && map.road[map.idx(nx, ny)] && !roadblockStops(map, w, map.idx(nx, ny))) return map.idx(nx, ny);
    }
    return -1;
  }
  let r = rng.next() * total;
  for (let k = 0; k < choices.length; k += 2) {
    r -= choices[k + 1];
    if (r <= 0) return map.idx(w.x + DX[choices[k]], w.y + DY[choices[k]]);
  }
  const d = choices[choices.length - 2];
  return map.idx(w.x + DX[d], w.y + DY[d]);
}

/**
 * Start a roamer on its patrol. `firstDir` rotates between spawns so a
 * building's walkers fan out in different directions.
 */
export function startRoaming(game, w, firstDir = 0) {
  const def = WALKER_TYPES[w.type];
  w.state = 'roam';
  w.roamLeft = def.roam || CONFIG.DEFAULT_ROAM;
  w.path = null;
  const { map } = game;
  for (let k = 0; k < 4; k++) {
    const d = (firstDir + k) % 4;
    const nx = w.x + DX[d];
    const ny = w.y + DY[d];
    if (map.inBounds(nx, ny) && map.road[map.idx(nx, ny)] && !roadblockStops(map, w, map.idx(nx, ny))) {
      w.lastDir = d;
      setNextTile(game, w, map.idx(nx, ny));
      return true;
    }
  }
  // Isolated single road tile (or roadblocks all round): nothing to roam.
  killWalker(game, w);
  return false;
}

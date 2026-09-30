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
import { killWalker } from './entities.js';

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
 * through bends, up to the next junction) and weighs the way by the share of
 * those tiles with anything to serve: an empty way keeps EMPTY_STREET_WEIGHT
 * of its weight, not zero, since an empty stretch can lead to more homes.
 * Looking only at the next tile was not enough: a lone Forum's tax collector
 * turned onto the Imperial road (its first tile still beside a home), then
 * had no way but on to the empty map edge, and the registrations of the
 * homes he skipped ran out.
 */
const ROAM_LOOKAHEAD = 8;
const EMPTY_STREET_WEIGHT = 0.2;

/** Is there any building within SERVICE_RADIUS of (x, y), i.e. would a walker there serve anything? */
function servesSomething(map, x, y) {
  const r = CONFIG.SERVICE_RADIUS;
  for (let ty = y - r; ty <= y + r; ty++) {
    for (let tx = x - r; tx <= x + r; tx++) if (map.inBounds(tx, ty) && map.building[map.idx(tx, ty)]) return true;
  }
  return false;
}

/** Share (0..1) of the next ROAM_LOOKAHEAD road tiles from (x, y), heading `dir`, with something to serve. */
function streetValue(map, x, y, dir) {
  let served = 0;
  let n = 0;
  for (let k = 0; k < ROAM_LOOKAHEAD; k++) {
    n++;
    if (servesSomething(map, x, y)) served++;
    // On along the only way ahead; stop at a junction or a dead end.
    let next = -1;
    let ways = 0;
    for (let e = 0; e < 4; e++) {
      if (e === (dir + 2) % 4) continue;
      const nx = x + DX[e];
      const ny = y + DY[e];
      if (map.inBounds(nx, ny) && map.road[map.idx(nx, ny)]) { ways++; next = e; }
    }
    if (ways !== 1) break;
    dir = next;
    x += DX[dir];
    y += DY[dir];
  }
  return served / n;
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
  let total = 0;
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
    weight *= EMPTY_STREET_WEIGHT + (1 - EMPTY_STREET_WEIGHT) * streetValue(map, nx, ny, d);
    choices.push(d, weight);
    total += weight;
  }
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

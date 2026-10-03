/**
 * makeRoom.js
 * ----------------------------------------------------------------------------
 * Nobody is built over. A building or wall placed where soldiers, raiders,
 * wolves or villagers stand, or a walker off the roads (a rioter, a prefect
 * after him, a native trader), used to leave them inside it: drawn in its
 * walls and, a unit, unable to plan a route out, since a route never starts
 * inside a building (playtest: troops found standing under a new academy
 * when it was cleared). Now each steps aside, the moment it is built, to the
 * nearest tile he may stand on, keeping as much of his place in his tile as
 * he can (a shove, not a jump to the tile's middle). Placing is never
 * refused for them: they make room, as a crowd does for builders.
 *
 * A unit's own fort's yard is his to stand in (sim/military.js yardSpot),
 * and ships never stand where anything is built. Walkers on the roads never
 * need this: nothing is built on a road. A soldier's spots and his fort's
 * gate need nothing either: they are worked out again whenever the map
 * changes (formationSpots, fortPost, fortGate key on map.revision), only
 * ever on open tiles.
 * ----------------------------------------------------------------------------
 */

import { UNIT_TYPES } from '../data/units.js';
import { passable } from './military.js';
import { inOwnFort } from './entities.js';
import { landPassable, offRoadReroute } from './crime.js';
import { nativeTraderReroute } from './natives.js';

// How far (tiles, either axis) to look for room: past the middle of the
// widest thing built at once, a hippodrome's three sections in a row.
const REACH = 12;

/**
 * Everyone standing on `tiles` (tile indices just built on, map layers
 * already set) where he may no longer stand steps aside to the nearest tile
 * he may. Draws nothing from the random stream.
 */
export function makeRoom(game, tiles) {
  if (!tiles.length) return;
  const map = game.map;
  const built = new Set(tiles);
  for (const u of game.units.values()) {
    if (UNIT_TYPES[u.type].naval) continue;
    const i = map.idx(Math.floor(u.x), Math.floor(u.y));
    if (!built.has(i) || passable(game, u.side, i) || inOwnFort(game, u)) continue;
    const to = nearestRoom(game, u.x, u.y, (j) => passable(game, u.side, j));
    if (!to) continue; // (walled in on every side: he stays, as before)
    u.x = u.px = to.x;
    u.y = u.py = to.y;
    u.path = null;
    u.pathFor = 0;
    u.stuck = 0;
    u.moving = false;
  }
  for (const w of game.walkers.values()) {
    if (w.dead || !w.offRoad) continue;
    const here = map.idx(w.x, w.y);
    const next = map.idx(w.tx, w.ty);
    const inside = built.has(here) && !landPassable(game, here);
    const into = built.has(next) && !landPassable(game, next);
    if (!inside && !into) continue;
    if (inside) {
      const to = nearestRoom(game, w.x + 0.5, w.y + 0.5, (j) => landPassable(game, j));
      if (!to) continue;
      w.x = Math.floor(to.x);
      w.y = Math.floor(to.y);
    }
    // Halt the step he was taking (into the new walls, or from where he stood) and plan again from here.
    w.tx = w.x;
    w.ty = w.y;
    w.progress = 0;
    w.moving = false;
    if (w.path) {
      if (w.type === 'native_trader') nativeTraderReroute(game, w);
      else offRoadReroute(game, w);
    }
  }
}

/**
 * The point nearest (x, y) on a tile `ok` accepts, within REACH: the
 * nearest such tile (the first in scan order on a tie), and on it the point
 * nearest (x, y), kept a little inside its edges. Null when there is none.
 */
function nearestRoom(game, x, y, ok) {
  const map = game.map;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let best = null;
  let bestD = Infinity;
  for (let r = 1; r <= REACH; r++) {
    // A ring further out can still hold a nearer tile than a corner of this
    // one, so look one ring past the first that has room.
    if (best && r - 1 > bestD) break;
    for (let ty = cy - r; ty <= cy + r; ty++) {
      for (let tx = cx - r; tx <= cx + r; tx++) {
        if (Math.max(Math.abs(tx - cx), Math.abs(ty - cy)) !== r || !map.inBounds(tx, ty) || !ok(map.idx(tx, ty))) continue;
        const px = Math.min(tx + 0.85, Math.max(tx + 0.15, x));
        const py = Math.min(ty + 0.85, Math.max(ty + 0.15, y));
        const d = Math.hypot(px - x, py - y);
        if (d < bestD) { bestD = d; best = { x: px, y: py }; }
      }
    }
  }
  return best;
}

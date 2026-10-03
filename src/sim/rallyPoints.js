/**
 * rallyPoints.js
 * ----------------------------------------------------------------------------
 * Where a fort's or naval station's rally point would go for a tile the
 * player picks: the Deploy click (app.js), a dragged rally flag dropped on
 * the map (input/input.js), and the ghost standard the renderer draws under
 * the pointer for both. One rule for all three, so the preview never says
 * yes where the drop says no.
 *
 *   fort     any tile on the map: soldiers march there and hold it.
 *   station  the nearest tile of the station's own water within 2 tiles
 *            (sim/navy.js stationRallyAt); none on dry land or other water.
 * ----------------------------------------------------------------------------
 */

import { deployFort } from './military.js';
import { deployStation, stationRallyAt } from './navy.js';

/** Is `b` a fort or a naval station: something with a rally point to move? */
export function hasRally(b) {
  return !!b && (b.def.kind === 'fort' || b.def.kind === 'station');
}

/**
 * The rally point fort or station `b` would get for tile (tx, ty), as the
 * {x, y} middle of a tile, or null where it cannot go.
 */
export function rallyTarget(game, b, tx, ty) {
  if (!hasRally(b) || !game.map.inBounds(tx, ty)) return null;
  if (b.def.kind === 'station') return stationRallyAt(game, b, tx, ty);
  return { x: tx + 0.5, y: ty + 0.5 };
}

/**
 * Send fort or station `id` to tile (tx, ty) (sim/military.js deployFort,
 * sim/navy.js deployStation). @returns false where it cannot go: nothing
 * changes then.
 */
export function deployTo(game, id, tx, ty) {
  const b = game.buildings.get(id);
  if (!rallyTarget(game, b, tx, ty)) return false;
  return b.def.kind === 'station' ? deployStation(game, id, tx, ty) : deployFort(game, id, tx, ty);
}

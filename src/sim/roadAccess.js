/**
 * roadAccess.js
 * ----------------------------------------------------------------------------
 * Making "no road" obvious. The rule itself lives in entities.js
 * (computeAccessRoad) and is the original's: a service or work building needs
 * a road touching one of its edges (any side; a corner does not count),
 * while a home takes a road within 2 tiles. A building with no road gets no
 * workers and does nothing, which a player can easily miss: in a playtest
 * prefectures placed inside housing blocks never hired anyone and the town
 * burned down. This module holds what the warnings need:
 *   - lacksRoad: the test behind the marker drawn over such buildings
 *   - accessEdgeTiles: where a road would give a building being placed access
 *   - updateRoadNotices: one message per building after a few days without
 * Nothing here changes how the city plays (no RNG, no rules).
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { Terrain } from '../world/map.js';
import { perimeterTiles } from './entities.js';

/**
 * Does this building need a road and have none it can use? Homes need one
 * for settlers; other buildings for their workers. One with no workers (the
 * Oracle) works without a road, so it never counts.
 */
export function lacksRoad(b) {
  return !!b.def.needsRoad && b.accessRoad < 0 && (!!b.house || b.def.workers > 0);
}

/**
 * The tiles where a road would give a building at (x, y) of size S access:
 * its edge ring, without the corners (a road there does not count). `open`
 * says whether a road can be laid on the tile at all (not water, rock, a
 * building or a fire; a wall would become a gate).
 * @returns {{x:number, y:number, i:number, open:boolean}[]}
 */
export function accessEdgeTiles(game, x, y, S) {
  const { map } = game;
  return perimeterTiles(map, x, y, S).map((i) => {
    const t = map.terrain[i];
    const open = !map.building[i] && t !== Terrain.WATER && t !== Terrain.ROCK && !game.fires.has(i);
    return { x: map.xOf(i), y: map.yOf(i), i, open };
  });
}

/**
 * Daily: a building that employs people and has had no road touching it for
 * NO_ROAD_NOTICE_DAYS says so, once in its life, with its place on the map
 * (click the message to go there). The days count again from 0 whenever a
 * road reaches it; the marker over it (render) stays as long as it lacks one.
 */
export function updateRoadNotices(game) {
  for (const b of game.buildings.values()) {
    if (b.house || !b.def.workers || !b.def.needsRoad) continue;
    if (b.accessRoad >= 0) {
      b.noRoadDays = 0;
      continue;
    }
    b.noRoadDays++;
    if (b.noRoadWarned || b.noRoadDays < CONFIG.NO_ROAD_NOTICE_DAYS) continue;
    b.noRoadWarned = true;
    game.message(noRoadText(b), 'warn', b.x, b.y);
  }
}

/** "The Prefecture at 12,30 has no road touching it: it gets no workers and does nothing." */
export function noRoadText(b) {
  return `The ${b.def.name} at ${b.x},${b.y} has no road touching it: it gets no workers and does nothing.`;
}

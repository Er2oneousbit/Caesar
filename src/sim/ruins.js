/**
 * ruins.js
 * ----------------------------------------------------------------------------
 * What stood on a rubble tile, why it fell, and when.
 *
 * The map's rubble layer is only a flag. When a building burns down or
 * collapses (or raiders break a wall), every tile it leaves rubble on points
 * to one record in `game.ruins` (tile index -> record):
 *
 *   { what: 'Prefecture', cause: 'fire', month: 6, year: -280,
 *     site: { type: 'prefecture', x: 12, y: 30, size: 1 } }
 *
 * `site` is where it stood and what to build to put it back (the rubble's
 * Rebuild button, construction.js rebuildPlan): its building type, 'house'
 * for a home (its plots come back as empty lots) or 'wall', and its
 * footprint. Ruins from before v0.12.2 have none and offer no rebuild.
 *
 * `what` is the building's name or the home's level name at the moment it
 * fell, `cause` one of RUIN_CAUSES, `month`/`year` the game date. Every tile
 * of a footprint shares the same record object, so clearing part of the
 * rubble leaves the rest still knowing what it was. A tile loses its record
 * when its rubble is cleared or built over (clearRuin), and a record whose
 * tiles are all gone is simply dropped.
 *
 * Saves store one entry per record with the list of tiles it still covers,
 * not one string per tile: a burned 3x3 building costs one short entry.
 * Records are words for the player only: nothing in the simulation reads
 * them, so they never change how a city plays.
 * ----------------------------------------------------------------------------
 */

/**
 * Why a ruin fell (the info panel words each one, see ui/infoPanel.js).
 *   fire       burned down (its own fire risk, or flames from next door)
 *   wrath      burned by an angry god (Mercury, angered again)
 *   raidFire   set on fire by raiders
 *   riot       set on fire by rioters
 *   collapse   fell down for want of repairs
 *   raid       torn down by raiders
 *   raidWall   a wall raiders broke through
 */
import { BUILDINGS } from '../data/buildings.js';

export const RUIN_CAUSES = Object.freeze(['fire', 'wrath', 'raidFire', 'riot', 'collapse', 'raid', 'raidWall']);

/** Remember what fell on these tiles (they hold rubble now); `site`: see the header. */
export function recordRuin(game, tiles, what, cause, site = null) {
  if (!game.ruins) return null;
  const rec = { what, cause, month: game.time.month, year: game.time.year };
  if (site) rec.site = { type: site.type, x: site.x, y: site.y, size: site.size };
  for (const i of tiles) game.ruins.set(i, rec);
  return rec;
}

/** The rubble on tile i is gone (cleared, or built over). */
export function clearRuin(game, i) {
  if (game.ruins) game.ruins.delete(i);
}

/** Put back a record (undoing a construction that cleared its rubble). */
export function restoreRuin(game, i, rec) {
  if (!game.ruins) return;
  if (rec) game.ruins.set(i, rec);
  else game.ruins.delete(i);
}

/** The record of the rubble on tile i, or null (no rubble, or rubble from an older save). */
export function ruinAt(game, i) {
  if (!game.map.rubble[i] || !game.ruins) return null;
  return game.ruins.get(i) || null;
}

/** A saved `site` if it makes sense (a known type, a footprint on the map), else null. */
function validSite(s, map) {
  if (!s || typeof s !== 'object') return null;
  const { type, x, y, size } = s;
  if (typeof type !== 'string' || !(type === 'house' || type === 'wall' || Object.hasOwn(BUILDINGS, type))) return null;
  if (![x, y, size].every(Number.isInteger) || size < 1 || size > 5 || x < 0 || y < 0 || x + size > map.w || y + size > map.h) return null;
  return { type, x, y, size };
}

/**
 * Ruins for the save: one entry per fallen building, with the tiles that
 * still hold its rubble. Tiles whose rubble went some other way are left
 * out (and records left with no tiles vanish).
 */
export function serializeRuins(game) {
  if (!game.ruins || game.ruins.size === 0) return [];
  const byRec = new Map();
  for (const [i, rec] of game.ruins) {
    if (!game.map.rubble[i]) continue;
    let tiles = byRec.get(rec);
    if (!tiles) byRec.set(rec, (tiles = []));
    tiles.push(i);
  }
  const out = [];
  for (const [rec, tiles] of byRec) out.push({ what: rec.what, cause: rec.cause, month: rec.month, year: rec.year, ...(rec.site ? { site: rec.site } : {}), tiles });
  return out;
}

/**
 * Read the ruins back from a save. Older saves have none: their rubble loads
 * without records and the info panel says what it always said. An entry that
 * does not make sense (a hand-edited file) is skipped, never trusted.
 */
export function restoreRuins(game, list) {
  game.ruins = new Map();
  if (!Array.isArray(list)) return;
  const { map } = game;
  for (const e of list) {
    if (!e || typeof e.what !== 'string' || !RUIN_CAUSES.includes(e.cause)) continue;
    if (!Number.isInteger(e.month) || e.month < 0 || e.month > 11 || !Number.isInteger(e.year) || !Array.isArray(e.tiles)) continue;
    const rec = { what: e.what.slice(0, 60), cause: e.cause, month: e.month, year: e.year };
    const site = validSite(e.site, map);
    if (site) rec.site = site;
    for (const i of e.tiles) {
      if (Number.isInteger(i) && i >= 0 && i < map.size && map.rubble[i]) game.ruins.set(i, rec);
    }
  }
}

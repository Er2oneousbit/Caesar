/**
 * ruins.js
 * ----------------------------------------------------------------------------
 * What stood on a rubble tile, why it fell, and when.
 *
 * The map's rubble layer is only a flag. When a building burns down or
 * collapses (or raiders break a wall), every tile it leaves rubble on points
 * to one record in `game.ruins` (tile index -> record):
 *
 *   { what: 'Prefecture', cause: 'fire', month: 6, year: -280 }
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
 *   lightning  struck by lightning (an angry god)
 *   raidFire   set on fire by raiders
 *   riot       set on fire by rioters
 *   collapse   fell down for want of repairs
 *   raid       torn down by raiders
 *   raidWall   a wall raiders broke through
 */
export const RUIN_CAUSES = Object.freeze(['fire', 'lightning', 'raidFire', 'riot', 'collapse', 'raid', 'raidWall']);

/** Remember what fell on these tiles (they hold rubble now). */
export function recordRuin(game, tiles, what, cause) {
  if (!game.ruins) return null;
  const rec = { what, cause, month: game.time.month, year: game.time.year };
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
  for (const [rec, tiles] of byRec) out.push({ what: rec.what, cause: rec.cause, month: rec.month, year: rec.year, tiles });
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
    for (const i of e.tiles) {
      if (Number.isInteger(i) && i >= 0 && i < map.size && map.rubble[i]) game.ruins.set(i, rec);
    }
  }
}

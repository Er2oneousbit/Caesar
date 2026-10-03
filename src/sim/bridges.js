/**
 * bridges.js
 * ----------------------------------------------------------------------------
 * The low bridge and the boats it stops. Two bridges carry roads over water
 * (data/buildings.js TOOLS): the ship bridge, high on stone arches, and the
 * cheaper timber low bridge. Both are Road.BRIDGE tiles; a low bridge's are
 * also marked in map.bridgeLow (saved), so the walkers, soldiers and raiders
 * crossing either never need to tell them apart.
 *
 * No boat passes a low bridge: merchant ships, fishing boats, liburnians and
 * raider ships alike. The map splits its ships' and boats' water there
 * (world/map.js splitAtLowBridges), so every water route already planned by
 * body (sim/navy.js, sim/fishing.js) stays on its side; merchant ships route
 * over navigable water with the low bridges taken out (sim/trade.js
 * shipPath). A boat already under way when a low bridge goes up meets it on
 * its route and plans again from where it is (boatBlocked; sim/navy.js
 * followWaterPath for the warships and raider ships).
 *
 * As in the original, a low bridge may cut a dock off from the sea. The
 * original said nothing until a yearly "no working dock" message; Colonia
 * warns while the bridge is being placed (lowBridgeCuts) and the cut-off
 * building's panel says why no ship comes (cutOffNote).
 *
 * Colonia's own consequence: raider ships cannot pass a low bridge either,
 * so a low bridge below the city keeps them out of the upper river.
 * ----------------------------------------------------------------------------
 */

import { UNIT_TYPES } from '../data/units.js';
import { killWalker, shoreWaterAt } from './entities.js';
import { followPath } from './movement.js';
import { dockBerth, shipLeave, shipPath } from './trade.js';
import { fishingBoatBlocked } from './fishing.js';
import { waterOf, rehomeShips } from './navy.js';

/** Tile index under a continuous position. */
function tileOf(map, x, y) {
  return map.idx(Math.max(0, Math.min(map.w - 1, Math.floor(x))), Math.max(0, Math.min(map.h - 1, Math.floor(y))));
}

/** Every tile a boat is on or sailing onto now (merchant ships, fishing boats, warships, raider ships). */
export function boatTiles(game) {
  const map = game.map;
  const out = new Set();
  for (const w of game.walkers.values()) {
    if (w.kind !== 'ship' || w.dead) continue;
    out.add(map.idx(w.x, w.y));
    if (w.moving && map.inBounds(w.tx, w.ty)) out.add(map.idx(w.tx, w.ty));
  }
  for (const u of game.units.values()) if (UNIT_TYPES[u.type]?.naval) out.add(tileOf(map, u.x, u.y));
  return out;
}

/**
 * A low bridge was built or cleared: work out the boats' water again and
 * tell every boat afloat which part of it it is on. Berths and moorings on
 * a new low bridge are found again beside their building.
 */
export function refreshWaterways(game) {
  const map = game.map;
  map.computeWaterways();
  for (const b of game.buildings.values()) {
    if (b.berth >= 0 && map.bridgeLow[b.berth]) b.berth = -1;
    if (b.mooring >= 0 && map.bridgeLow[b.mooring]) b.mooring = -1;
  }
  game.stationSpots = null; // (the squadrons' spots around their anchors, sim/navy.js)
  for (const u of game.units.values()) {
    if (!UNIT_TYPES[u.type]?.naval) continue;
    const body = map.navBody[tileOf(map, u.x, u.y)];
    if (body) u.body = body;
  }
  // A liburnian the bridge cut off from its station could never reach its
  // berth again: it goes to a station on its own side with room, or is laid
  // up, as when a station is lost (sim/navy.js).
  const cut = [];
  for (const u of [...game.units.values()]) {
    if (u.type !== 'liburnian' || !u.station || u.away) continue;
    const st = game.buildings.get(u.station);
    if (st && waterOf(game, st) && waterOf(game, st) !== u.body) cut.push(u);
  }
  if (cut.length) rehomeShips(game, cut, 'A low bridge has cut');
  for (const w of game.walkers.values()) {
    if (w.type !== 'fishing_boat') continue;
    const body = map.fishBody[map.idx(w.x, w.y)];
    if (body) w.body = body;
  }
}

/** A waterside building's berth as it stands, or where it would be found (read only). */
function berthNow(map, b) {
  return b.berth >= 0 && map.navigable[b.berth] && !map.bridgeLow[b.berth] ? b.berth : shoreWaterAt(map, b.def, b.x, b.y, b.size);
}

/** A wharf's mooring as it stands, or where it would be found (read only). */
function mooringNow(map, b) {
  return b.mooring >= 0 && map.fishBody[b.mooring] ? b.mooring : shoreWaterAt(map, b.def, b.x, b.y, b.size);
}

/** Tiles reachable from `start` stepping side to side over tiles `ok` passes. */
function reach(map, start, ok) {
  const seen = new Uint8Array(map.size);
  if (start < 0 || !ok(start)) return seen;
  const queue = [start];
  seen[start] = 1;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = map.xOf(i);
    const y = map.yOf(i);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      if (!map.inBounds(x + dx, y + dy)) continue;
      const j = map.idx(x + dx, y + dy);
      if (!seen[j] && ok(j)) { seen[j] = 1; queue.push(j); }
    }
  }
  return seen;
}

/** "the Emporium at 40, 12" */
function named(b) {
  return `the ${b.def.name} at ${b.x}, ${b.y}`;
}

/** "a, b and c" */
function listOf(parts) {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The warnings for a low bridge over tiles `span` (tile indices): every
 * Emporium, Statio, Navalia or Portus it would cut off from the sea entry,
 * every wharf it would cut off from all its fishing grounds, or, with none
 * of those, that ships from the sea will not sail past it. It may still be
 * built: the choice is the player's.
 * @returns {string[]}
 */
export function lowBridgeCuts(game, span) {
  const map = game.map;
  const planned = new Set(span);
  const out = [];
  if (map.seaEntry) {
    const entry = map.idx(map.seaEntry.x, map.seaEntry.y);
    const now = reach(map, entry, (i) => map.navigable[i] && !map.bridgeLow[i]);
    const then = reach(map, entry, (i) => map.navigable[i] && !map.bridgeLow[i] && !planned.has(i));
    const cut = [];
    for (const b of game.buildings.values()) {
      if (b.def.placement !== 'shore') continue;
      const berth = b.berth >= 0 && !planned.has(b.berth) ? b.berth : shoreWaterAt(map, b.def, b.x, b.y, b.size);
      if (berth >= 0 && now[berth] && !then[berth]) cut.push(named(b));
    }
    if (cut.length) out.push(`This low bridge cuts ${listOf(cut)} off from the sea: no ship will get past it.`);
    else if (span.some((i) => now[i])) out.push('No boat passes a low bridge: ships from the sea will not sail beyond it.');
  }
  const lost = [];
  for (const b of game.buildings.values()) {
    if (b.def.kind !== 'wharf') continue;
    const m = mooringNow(map, b);
    if (m < 0) continue;
    const body = map.fishBody[m];
    const grounds = map.groundsOf(body);
    if (!grounds.length) continue;
    const then = reach(map, m, (i) => map.fishBody[i] === body && !planned.has(i));
    if (!grounds.some((g) => then[map.idx(g.x, g.y)])) lost.push(named(b));
  }
  if (lost.length) out.push(`It cuts ${listOf(lost)} off from ${lost.length === 1 ? 'its' : 'their'} fishing grounds.`);
  // Liburnians on the far side of it from their station.
  const stranded = new Map();
  for (const u of game.units.values()) {
    if (u.type !== 'liburnian' || !u.station || u.away) continue;
    const st = game.buildings.get(u.station);
    const berth = st ? berthNow(map, st) : -1;
    if (berth < 0) continue;
    const body = map.navBody[berth];
    const side = reach(map, berth, (i) => map.navBody[i] === body && !planned.has(i));
    const at = tileOf(map, u.x, u.y);
    if (map.navBody[at] === body && !side[at]) stranded.set(st, (stranded.get(st) || 0) + 1);
  }
  for (const [st, n] of stranded) out.push(`${n} liburnian${n === 1 ? '' : 's'} of ${named(st)} would be cut off from ${n === 1 ? 'it' : 'them'}: sent to a station on ${n === 1 ? 'its' : 'their'} side with room, or laid up.`);
  return out;
}

/**
 * Why no ship or boat reaches a waterside building, when a low bridge is to
 * blame (its panel shows it), else null.
 */
export function cutOffNote(game, b) {
  const map = game.map;
  if ((b.def.placement !== 'shore' && b.def.kind !== 'wharf') || !map.hasLowBridge()) return null; // (cheap first: every panel and the Problems overlay ask)
  if (b.def.placement === 'shore' && map.seaEntry) {
    const berth = berthNow(map, b); // (read only: a panel must not move a berth or turn the art)
    const entry = map.idx(map.seaEntry.x, map.seaEntry.y);
    if (berth >= 0 && map.navWhole[berth] === map.navWhole[entry] && map.navBody[berth] !== map.navBody[entry]) {
      return 'A low bridge blocks the way to the sea: no ship from the sea can reach it.';
    }
  }
  if (b.def.kind === 'wharf') {
    const m = mooringNow(map, b);
    const whole = m >= 0 ? map.fishWhole[m] : 0;
    if (whole && !map.groundsOf(map.fishBody[m]).length && map.fishingGrounds.some((g) => map.fishWhole[map.idx(g.x, g.y)] === whole)) {
      return 'A low bridge cuts it off from its fishing grounds: its boat cannot reach them.';
    }
  }
  return null;
}

/**
 * A boat on a fixed route (a walker: a merchant ship or a fishing boat)
 * is about to sail onto a low bridge built since it set out: it plans
 * again from where it is. A merchant ship that can no longer reach its
 * dock turns back to sea; one that cannot get out is gone (as a ship with
 * no way out always was, sim/trade.js shipLeave).
 */
export function boatBlocked(game, w) {
  w.path = null;
  w.moving = false;
  w.progress = 0;
  if (w.type === 'fishing_boat') { fishingBoatBlocked(game, w); return; }
  if (w.type !== 'ship') { killWalker(game, w); return; }
  const map = game.map;
  if (w.state === 'toDock') {
    const dock = game.buildings.get(w.target);
    const berth = dock ? dockBerth(game, dock) : -1;
    const path = berth >= 0 ? shipPath(game, map.idx(w.x, w.y), berth) : null;
    if (path) { followPath(game, w, path); return; }
  }
  shipLeave(game, w); // (its dock is free for another ship; out to sea, or gone)
}

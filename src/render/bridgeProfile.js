/**
 * bridgeProfile.js
 * ----------------------------------------------------------------------------
 * How high a bridge's deck stands at each point along it, worked out from
 * the map alone (rendering only, the sim never sees it). The bridge art and
 * the people crossing share these numbers: the renderer draws each bridge
 * tile with the deck heights at its two ends and its middle (bridgeSpec,
 * lowBridgeSpec), and lifts a walker by the same heights read between those
 * three points (renderer.js bridgeSpan), so feet are always on the deck.
 *
 * The ship bridge (Pons) stands BRIDGE_DECK_Z over the water, high enough
 * for a ship's mast to pass under it. At a bank it climbs from the road on
 * a ramp RAMP_TILES long and always as steep, starting in the middle of the
 * road tile on the bank (the "foot", drawn on that road tile by
 * bridgeFootSpec) when that tile is a plain road, else at the water's edge.
 * The ramp starts in the middle of the bank tile so that a road joining it
 * from the side (a bridge ending at a junction) meets it at road level.
 *
 * The low bridge (Pons Sublicius) stands LOW_BRIDGE_DECK_Z over the water
 * and rises to it over the first and last LOW_RAMP_TILES of water, so the
 * people on it no longer hop up at the bank. No boat passes under it, so
 * its ramps on the water cost nothing.
 *
 * Where a run of bridge tiles ends at more water (a road that turned on the
 * water, as the Imperial road may on a river map), the deck runs on at full
 * height there: only a bank brings it down.
 * ----------------------------------------------------------------------------
 */

import { Road, Terrain } from '../world/map.js';
import { BRIDGE_DECK_Z, LOW_BRIDGE_DECK_Z, deckAt } from './terrainArt.js';
import { viewDir } from './view.js';

/** Length of a ship bridge's ramp (tiles): from the middle of the bank's road tile to the far edge of the first water tile. */
export const RAMP_TILES = 1.5;
/** Length of a low bridge's ramp (tiles), from the water's edge. */
export const LOW_RAMP_TILES = 0.5;
/** Longest run scanned each way (bridges span at most 16 tiles; the Imperial road's may be longer). */
const SCAN = 64;

/** Is (x, y) a bridge tile of this kind (low or not)? */
function bridgeOf(map, x, y, low) {
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  return map.road[i] === Road.BRIDGE && !map.bridgeLow[i] === !low;
}

/** Any road on (x, y), a bridge included. */
function roadAt(map, x, y) {
  return map.inBounds(x, y) && map.road[map.idx(x, y)] !== Road.NONE;
}

/**
 * Which way a bridge tile runs on the map: 'u' along x, 'v' along y. A
 * bridge neighbour along one axis only decides it (a road on the bank
 * beside the first tile used to turn its deck across the river); then a
 * road on both sides; then a road on either side along x.
 */
export function bridgeAxis(map, x, y) {
  const low = !!map.bridgeLow[map.idx(x, y)];
  const bx = bridgeOf(map, x - 1, y, low) || bridgeOf(map, x + 1, y, low);
  const by = bridgeOf(map, x, y - 1, low) || bridgeOf(map, x, y + 1, low);
  if (bx !== by) return bx ? 'u' : 'v';
  const rx = roadAt(map, x - 1, y) && roadAt(map, x + 1, y);
  const ry = roadAt(map, x, y - 1) && roadAt(map, x, y + 1);
  if (rx !== ry) return rx ? 'u' : 'v';
  return roadAt(map, x - 1, y) || roadAt(map, x + 1, y) ? 'u' : 'v';
}

/**
 * May a ship bridge's ramp start on this bank tile? A plain road on land
 * with nothing else drawn on it: a gate, an aqueduct over the road, a
 * roadblock or a building there keeps its own look, and the ramp then
 * starts at the water's edge instead.
 */
export function footOk(map, x, y) {
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  const r = map.road[i];
  return (r === Road.ROAD || r === Road.PLAZA) && map.terrain[i] !== Terrain.WATER &&
    !map.building[i] && !map.wall[i] && !map.aqueduct[i] && !map.roadblock[i];
}

/** How a run ends past its last tile: 'open' (more water: no ramp), 'foot' or 'bank'. */
function endKind(map, x, y, low) {
  if (!map.inBounds(x, y) || map.terrain[map.idx(x, y)] === Terrain.WATER) return 'open';
  return !low && footOk(map, x, y) ? 'foot' : 'bank';
}

/**
 * The deck heights of the bridge tile (x, y), in px at zoom 1, at its
 * near edge, middle and far edge along its axis (map order: lower x or y
 * first), rounded to whole px so the sprite's key stays short and the
 * walkers stand on exactly what is drawn. null when it is no bridge.
 * `ends`: whether the run ends just before / after this tile (its first or last tile).
 * @returns {{axis:'u'|'v', low:boolean, h:number[], ends:boolean[]}|null}
 */
export function bridgeProfile(map, x, y) {
  if (!map.inBounds(x, y) || map.road[map.idx(x, y)] !== Road.BRIDGE) return null;
  const low = !!map.bridgeLow[map.idx(x, y)];
  const axis = bridgeAxis(map, x, y);
  const [dx, dy] = axis === 'u' ? [1, 0] : [0, 1];
  let back = 0;
  while (back < SCAN && bridgeOf(map, x - dx * (back + 1), y - dy * (back + 1), low)) back++;
  let ahead = 0;
  while (ahead < SCAN && bridgeOf(map, x + dx * (ahead + 1), y + dy * (ahead + 1), low)) ahead++;
  const c = axis === 'u' ? x : y; // this tile's place along the axis
  const a0 = c - back; // the run's first and last tiles
  const a1 = c + ahead;
  const k0 = endKind(map, x - dx * (back + 1), y - dy * (back + 1), low);
  const k1 = endKind(map, x + dx * (ahead + 1), y + dy * (ahead + 1), low);
  const Z = low ? LOW_BRIDGE_DECK_Z : BRIDGE_DECK_Z;
  const L = low ? LOW_RAMP_TILES : RAMP_TILES;
  // Where each ramp starts at road level: the middle of a foot tile, else the water's edge.
  const s0 = k0 === 'foot' ? a0 - 0.5 : a0;
  const s1 = k1 === 'foot' ? a1 + 1.5 : a1 + 1;
  const at = (p) => {
    const up = k0 === 'open' ? Infinity : (p - s0) / L;
    const down = k1 === 'open' ? Infinity : (s1 - p) / L;
    return Math.round(Z * Math.max(0, Math.min(1, up, down)));
  };
  return { axis, low, h: [at(c), at(c + 0.5), at(c + 1)], ends: [back === 0, ahead === 0] };
}

export { deckAt }; // (the art's own reading of the heights, so a walker stands on what is drawn)

/**
 * How a bridge tile is drawn at view turn `turn`: its axis in the view, the
 * deck's heights in the view's order along it (the map's order reversed
 * when the turn runs that axis from the front of the view to the back),
 * and whether it is the run's first tile in the view (it draws its own
 * near support). null when it is no bridge.
 * @returns {{axis:'u'|'v', low:boolean, h:number[], abut:boolean}|null}
 */
export function bridgeLook(map, x, y, turn = 0) {
  const p = bridgeProfile(map, x, y);
  if (!p) return null;
  const [sx, sy] = viewDir(p.axis === 'u' ? 1 : 0, p.axis === 'u' ? 0 : 1, turn);
  const flip = sx + sy < 0;
  return { axis: sx ? 'u' : 'v', low: p.low, h: flip ? [p.h[2], p.h[1], p.h[0]] : p.h, abut: p.ends[flip ? 1 : 0] };
}

/**
 * How a ramp's foot (one of bridgeFeet) is drawn at view turn `turn`: the
 * view axis it climbs along, and +1 when it climbs toward the front of the
 * view (+t), -1 toward the back.
 * @returns {{axis:'u'|'v', sign:number}}
 */
export function footLook(f, turn = 0) {
  const [sx, sy] = viewDir(f.dx, f.dy, turn);
  return { axis: sx ? 'u' : 'v', sign: sx + sy > 0 ? 1 : -1 };
}

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * The ramp feet on a bank tile: for each ship bridge whose ramp starts on
 * it, the map step from this tile to the bridge and the deck's height at
 * their shared edge (the foot climbs to it from the tile's middle). Empty
 * on any other tile.
 * @returns {{dx:number, dy:number, h:number}[]}
 */
export function bridgeFeet(map, x, y) {
  const out = [];
  if (!footOk(map, x, y)) return out;
  for (const [dx, dy] of STEPS) {
    const bx = x + dx;
    const by = y + dy;
    if (!bridgeOf(map, bx, by, false)) continue;
    const p = bridgeProfile(map, bx, by);
    // Only a bridge that runs this way ends here (one alongside does not).
    if ((p.axis === 'u') !== (dx !== 0)) continue;
    const h = dx + dy > 0 ? p.h[0] : p.h[2];
    if (h > 0) out.push({ dx, dy, h });
  }
  return out;
}

/**
 * How far up (px at zoom 1) a walker at map point (fx, fy) stands: on a
 * bridge tile the deck under it, on a foot tile the ramp, else 0.
 * `feet`: the tile's bridgeFeet when the caller has them already.
 */
export function deckLift(map, fx, fy, feet = null) {
  const tx = Math.floor(fx);
  const ty = Math.floor(fy);
  const p = bridgeProfile(map, tx, ty);
  if (p) return deckAt(p.h, p.axis === 'u' ? fx - tx : fy - ty);
  let lift = 0;
  for (const f of feet || bridgeFeet(map, tx, ty)) {
    // How far from the tile's middle toward the bridge (0 at the middle, 0.5 at the edge).
    const toward = f.dx ? (fx - tx - 0.5) * f.dx : (fy - ty - 0.5) * f.dy;
    lift = Math.max(lift, f.h * Math.max(0, Math.min(1, toward * 2)));
  }
  return lift;
}

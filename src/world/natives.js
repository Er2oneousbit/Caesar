/**
 * natives.js (world)
 * ----------------------------------------------------------------------------
 * Where the native villages stand (Colonia's own placement: the original's
 * designers placed theirs by hand). Pure: it reads the map and a seed and
 * returns the plan; sim/natives.js builds it, at a new game only.
 *
 * The draws come from a stream of their own (`${seed}:natives`), after map
 * generation, so a map without villages, and every other draw of a map with
 * them, is exactly as it was.
 *
 *   1. Meeting places (2x2) on grass (not meadow: a village takes no farm
 *      land), at least ROAD_CLEARANCE tiles from the Imperial road and
 *      EDGE_CLEARANCE from the map's edge, with no more than MEADOW_MAX
 *      meadow tiles in their land; the best by woods nearby (a village sits
 *      at the woods' edge, WOODS_NEAR forest tiles count in full), with a
 *      draw to vary it, at least SPACING apart. Where no spot keeps the
 *      meadow rule (a plain of fields), the least meadow wins.
 *   2. Its huts (1x1): a count in HUTS, on grass or sand HUT_RING tiles from
 *      the meeting place's middle, each with a free tile between it and
 *      the next.
 *   3. Its crops (1x1, scenery): a count in FIELDS, on grass or sand next
 *      to a hut.
 * ----------------------------------------------------------------------------
 */

import { RNG } from '../core/rng.js';
import { Terrain } from './map.js';
import { NATIVES } from '../data/natives.js';

/** Distance (4-neighbour steps, any terrain) from every tile to the nearest road tile: the Imperial road at a new game. */
function roadDistance(map) {
  const dist = new Int32Array(map.size).fill(1 << 20);
  const queue = new Int32Array(map.size);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < map.size; i++) if (map.road[i]) { dist[i] = 0; queue[tail++] = i; }
  while (head < tail) {
    const i = queue[head++];
    const x = map.xOf(i);
    const y = map.yOf(i);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      if (!map.inBounds(x + dx, y + dy)) continue;
      const j = map.idx(x + dx, y + dy);
      if (dist[j] > dist[i] + 1) { dist[j] = dist[i] + 1; queue[tail++] = j; }
    }
  }
  return dist;
}

/** Tiles of `type` within `r` (Chebyshev) of the 2x2 at (x, y). */
function countNear(map, x, y, r, type) {
  let n = 0;
  for (let ty = y - r; ty <= y + 1 + r; ty++) {
    for (let tx = x - r; tx <= x + 1 + r; tx++) if (map.inBounds(tx, ty) && map.terrain[map.idx(tx, ty)] === type) n++;
  }
  return n;
}

/** Is tile (x, y) open for a village piece (on one of `kinds` of ground, nothing on it, not taken)? */
function open(map, taken, x, y, kinds) {
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  return kinds.includes(map.terrain[i]) && !map.road[i] && !map.building[i] && !map.wall[i] && !map.aqueduct[i] && !taken.has(i);
}

/**
 * The villages for this map: [{ meeting: {x, y}, huts: [{x, y}], fields: [{x, y}] }]
 * (top-left tiles), at most `count`, fewer where the map has no room.
 */
export function planVillages(map, seed, count) {
  const rng = new RNG(`${seed}:natives`);
  const N = NATIVES;
  const want = Array.isArray(count) ? rng.range(count[0], count[1]) : count;
  const road = roadDistance(map);
  const grass = [Terrain.GRASS];
  const taken = new Set();
  // Every spot that keeps the hard rules, scored (meadow over the limit: a
  // fallback, far down the list).
  const spots = [];
  const e = N.EDGE_CLEARANCE;
  for (let y = e; y < map.h - e - 1; y++) {
    for (let x = e; x < map.w - e - 1; x++) {
      let ok = true;
      for (let k = 0; k < 4 && ok; k++) {
        const tx = x + (k & 1);
        const ty = y + (k >> 1);
        if (!open(map, taken, tx, ty, grass) || road[map.idx(tx, ty)] < N.ROAD_CLEARANCE) ok = false;
      }
      if (!ok) continue;
      const meadow = countNear(map, x, y, N.MEETING_LAND, Terrain.MEADOW);
      const woods = Math.min(N.WOODS_NEAR, countNear(map, x, y, N.MEETING_LAND, Terrain.TREES));
      const over = Math.max(0, meadow - N.MEADOW_MAX);
      spots.push({ x, y, score: woods * 2 - over * 4 + rng.next() * 6 });
    }
  }
  spots.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
  const villages = [];
  for (const s of spots) {
    if (villages.length >= want) break;
    if (villages.some((v) => Math.max(Math.abs(v.meeting.x - s.x), Math.abs(v.meeting.y - s.y)) < N.SPACING)) continue;
    const plan = planVillage(map, rng, taken, s);
    if (plan) villages.push(plan);
  }
  return villages;
}

/** One village around a meeting place at spot `s`, or null if fewer than the fewest huts fit. */
function planVillage(map, rng, taken, s) {
  const N = NATIVES;
  const cx = s.x + 1;
  const cy = s.y + 1; // (the 2x2's middle is the corner between its tiles)
  const mine = new Set();
  const take = (x, y) => { const i = map.idx(x, y); taken.add(i); mine.add(i); };
  for (let k = 0; k < 4; k++) take(s.x + (k & 1), s.y + (k >> 1));
  // Hut spots: on the ring, in a random order, each with a tile of room around it.
  const ring = [];
  const [r0, r1] = N.HUT_RING;
  for (let y = cy - r1 - 1; y <= cy + r1; y++) {
    for (let x = cx - r1 - 1; x <= cx + r1; x++) {
      const d = Math.max(Math.abs(x + 0.5 - cx), Math.abs(y + 0.5 - cy));
      if (d >= r0 && d <= r1 + 0.5) ring.push({ x, y });
    }
  }
  rng.shuffle(ring);
  const huts = [];
  const want = rng.range(N.HUTS[0], N.HUTS[1]);
  const room = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (mine.has(map.idx(x + dx, y + dy))) return false;
    return true;
  };
  for (const p of ring) {
    if (huts.length >= want) break;
    if (!open(map, taken, p.x, p.y, [Terrain.GRASS, Terrain.SAND]) || !room(p.x, p.y)) continue;
    huts.push(p);
    take(p.x, p.y);
  }
  if (huts.length < N.HUTS[0]) {
    for (const i of mine) taken.delete(i);
    return null;
  }
  // Crops beside the huts.
  const fields = [];
  const nf = rng.range(N.FIELDS[0], N.FIELDS[1]);
  for (const h of rng.shuffle(huts.slice())) {
    if (fields.length >= nf) break;
    for (const [dx, dy] of rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]])) {
      const x = h.x + dx;
      const y = h.y + dy;
      if (!open(map, taken, x, y, [Terrain.GRASS, Terrain.SAND])) continue;
      fields.push({ x, y });
      take(x, y);
      break;
    }
  }
  return { meeting: { x: s.x, y: s.y }, huts, fields };
}

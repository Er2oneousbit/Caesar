/**
 * water.js
 * ----------------------------------------------------------------------------
 * Water supply network.
 *
 *   1. A reservoir touching natural water fills up.
 *   2. Water flows from full reservoirs along aqueducts to other reservoirs.
 *   3. Every full reservoir pipes water underground within RESERVOIR_RADIUS.
 *   4. Fountains and baths inside a piped area have water; staffed fountains
 *      supply homes within FOUNTAIN_RADIUS.
 *   5. Wells always work and supply homes within WELL_RADIUS.
 *   6. Staffed hospitals mark their service area (HOSPITAL bit).
 *
 * The whole thing is recomputed daily (cheap) and immediately after
 * construction changes.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { Terrain, WaterBits } from '../world/map.js';
import { perimeterTiles } from './entities.js';

/** Set a bit on every tile within `r` (Chebyshev) of a footprint. */
function markArea(map, x, y, size, r, bit) {
  const x0 = Math.max(0, x - r);
  const y0 = Math.max(0, y - r);
  const x1 = Math.min(map.w - 1, x + size - 1 + r);
  const y1 = Math.min(map.h - 1, y + size - 1 + r);
  for (let ty = y0; ty <= y1; ty++) {
    let i = ty * map.w + x0;
    for (let tx = x0; tx <= x1; tx++, i++) map.water[i] |= bit;
  }
}

export function updateWater(game) {
  const { map, buildings } = game;
  const reservoirs = [];
  const byTile = new Map(); // tile -> reservoir, for the aqueduct flood fill
  for (const b of buildings.values()) {
    if (b.def.kind !== 'reservoir') continue;
    b.hasWater = map.isNearTerrain(b.x, b.y, b.size, Terrain.WATER, 1);
    b.source = b.hasWater;
    reservoirs.push(b);
    for (const i of perimeterTiles(map, b.x, b.y, b.size)) byTile.set(i, b);
  }

  // Flood water through aqueducts from full reservoirs.
  for (let i = 0; i < map.size; i++) if (map.aqueduct[i]) map.aqueduct[i] = 1;
  const queue = [];
  const pushAqueductsAround = (r) => {
    for (const i of perimeterTiles(map, r.x, r.y, r.size)) {
      if (map.aqueduct[i] === 1) { map.aqueduct[i] = 2; queue.push(i); }
    }
  };
  for (const r of reservoirs) if (r.hasWater) pushAqueductsAround(r);
  while (queue.length) {
    const i = queue.pop();
    const x = i % map.w;
    const y = (i / map.w) | 0;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!map.inBounds(nx, ny)) continue;
      const n = map.idx(nx, ny);
      if (map.aqueduct[n] === 1) { map.aqueduct[n] = 2; queue.push(n); }
    }
    // Does this aqueduct touch a reservoir that is still dry?
    const r = byTile.get(i);
    if (r && !r.hasWater) { r.hasWater = true; pushAqueductsAround(r); }
  }

  // Coverage bits.
  map.water.fill(0);
  for (const r of reservoirs) if (r.hasWater) markArea(map, r.x, r.y, r.size, CONFIG.RESERVOIR_RADIUS, WaterBits.PIPED);
  for (const b of buildings.values()) {
    const kind = b.def.kind;
    if (kind === 'well') {
      markArea(map, b.x, b.y, b.size, CONFIG.WELL_RADIUS, WaterBits.WELL);
    } else if (kind === 'fountain' || b.def.needsPiped) {
      b.hasWater = (map.water[map.idx(b.x, b.y)] & WaterBits.PIPED) !== 0;
      if (kind === 'fountain' && b.hasWater && b.efficiency > 0) {
        markArea(map, b.x, b.y, b.size, CONFIG.FOUNTAIN_RADIUS, WaterBits.FOUNTAIN);
      }
    } else if (kind === 'hospital' && b.efficiency > 0) {
      markArea(map, b.x, b.y, b.size, CONFIG.HOSPITAL_RADIUS, WaterBits.HOSPITAL);
    }
  }
}

/**
 * desirability.js
 * ----------------------------------------------------------------------------
 * How pleasant each tile is to live on. Every building radiates a value that
 * fades with distance: gardens, statues and temples are positive, industry
 * and storage are negative. Terrain adds a little: waterfront views and trees
 * are nice, rubble is not. Houses need a minimum desirability to evolve.
 *
 * Formula for a source [value, step, stepSize, range] at distance d (1..range):
 *   value + floor((d - 1) / step) * stepSize, never crossing zero.
 * Tiles inside the source's own footprint are not affected.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { HOUSE_TIERS } from '../data/housing.js';
import { Road, Terrain } from '../world/map.js';

/** Add one source's contribution to the desirability layer, times `scale` (0..1). */
function radiate(map, x, y, size, des, scale = 1) {
  const [value, step, stepSize, range] = des;
  if (!value || range <= 0 || scale <= 0) return;
  const x0 = Math.max(0, x - range);
  const y0 = Math.max(0, y - range);
  const x1 = Math.min(map.w - 1, x + size - 1 + range);
  const y1 = Math.min(map.h - 1, y + size - 1 + range);
  for (let ty = y0; ty <= y1; ty++) {
    const dy = ty < y ? y - ty : ty > y + size - 1 ? ty - (y + size - 1) : 0;
    for (let tx = x0; tx <= x1; tx++) {
      const dx = tx < x ? x - tx : tx > x + size - 1 ? tx - (x + size - 1) : 0;
      const d = Math.max(dx, dy);
      if (d === 0 || d > range) continue;
      let v = value + Math.floor((d - 1) / Math.max(1, step)) * stepSize;
      if ((value > 0 && v < 0) || (value < 0 && v > 0)) v = 0;
      map.desirability[ty * map.w + tx] += scale === 1 ? v : Math.round(v * scale);
    }
  }
}

const PLAZA_DES = [4, 1, -1, 3];

/**
 * How much of its desirability a building gives: all of it, except a
 * governor's residence, which gives it as far as it is staffed (an empty
 * residence is a shuttered house). Labor marks desirability for a new pass
 * when a residence's staffing changes (sim/labor.js).
 */
export function desScale(b) {
  return b.def.kind === 'residence' ? b.efficiency : 1;
}
const RUBBLE_DES = [-2, 1, 1, 1];

export function updateDesirability(game) {
  const { map } = game;
  const des = map.desirability;
  des.fill(0);
  // Terrain: waterfront bonus and a touch of green near trees.
  for (let i = 0; i < map.size; i++) {
    const wd = map.waterDist[i];
    if (wd >= 1 && wd <= 3) des[i] += 4 - wd;
  }
  for (let i = 0; i < map.size; i++) {
    if (map.terrain[i] === Terrain.TREES) {
      const x = i % map.w;
      const y = (i / map.w) | 0;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        if (map.inBounds(x + dx, y + dy)) des[map.idx(x + dx, y + dy)] += 1;
      }
    }
    if (map.road[i] === Road.PLAZA) radiate(map, i % map.w, (i / map.w) | 0, 1, PLAZA_DES);
    if (map.rubble[i]) radiate(map, i % map.w, (i / map.w) | 0, 1, RUBBLE_DES);
  }
  for (const b of game.buildings.values()) {
    const src = b.house ? HOUSE_TIERS[b.house.tier].desOut : b.def.des;
    radiate(map, b.x, b.y, b.size, src, desScale(b));
  }
  for (let i = 0; i < map.size; i++) {
    if (des[i] < CONFIG.DES_MIN) des[i] = CONFIG.DES_MIN;
    else if (des[i] > CONFIG.DES_MAX) des[i] = CONFIG.DES_MAX;
  }
}

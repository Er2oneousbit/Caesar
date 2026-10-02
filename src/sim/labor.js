/**
 * labor.js
 * ----------------------------------------------------------------------------
 * Daily workforce allocation.
 *
 * Workforce = WORKFORCE_RATIO of all plebeian residents (patricians do not work).
 * A building can hire only if it has road access AND labor access (a walker
 * from it recently passed occupied housing).
 *
 * When there are fewer workers than jobs:
 *   1. categories the player marked as priorities are filled first, in order
 *   2. everything else shares the remainder proportionally
 * Inside a category every building gets the same share.
 * Efficiency (workers / needed) scales production and walker spawn speed.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { HOUSE_TIERS } from '../data/housing.js';

export function updateLabor(game) {
  const c = game.city;
  let workforce = 0;
  for (const b of game.buildings.values()) {
    const h = b.house;
    if (h && h.pop > 0 && !HOUSE_TIERS[h.tier].patrician) workforce += h.pop;
  }
  workforce = Math.floor(workforce * CONFIG.WORKFORCE_RATIO);

  // Gather eligible employers by labor category.
  const byCat = new Map();
  let jobs = 0;
  for (const b of game.buildings.values()) {
    const def = b.def;
    if (!def.workers) continue;
    if (b.laborAccess > 0) b.laborAccess--;
    const roadOk = !def.needsRoad || b.accessRoad >= 0;
    if (!roadOk || b.laborAccess <= 0) {
      if (def.kind === 'residence' && b.efficiency !== 0) game.dirty.des = true; // see below
      b.workers = 0;
      b.efficiency = 0;
      continue;
    }
    const cat = def.labor || 'industry';
    let entry = byCat.get(cat);
    if (!entry) { entry = { demand: 0, list: [] }; byCat.set(cat, entry); }
    entry.demand += def.workers;
    entry.list.push(b);
    jobs += def.workers;
  }

  // Allocate workers to categories.
  let remaining = workforce;
  const alloc = new Map();
  for (const cat of c.laborPriority) {
    const e = byCat.get(cat);
    if (!e) continue;
    const give = Math.min(remaining, e.demand);
    alloc.set(cat, give);
    remaining -= give;
  }
  let restDemand = 0;
  for (const [cat, e] of byCat) if (!alloc.has(cat)) restDemand += e.demand;
  const share = restDemand > 0 ? Math.min(1, remaining / restDemand) : 0;
  for (const [cat, e] of byCat) if (!alloc.has(cat)) alloc.set(cat, Math.floor(e.demand * share));

  // Spread each category's workers across its buildings.
  let employed = 0;
  c.laborByCat = {};
  for (const [cat, e] of byCat) {
    const total = alloc.get(cat) || 0;
    const frac = e.demand > 0 ? total / e.demand : 0;
    let used = 0;
    for (const b of e.list) {
      b.workers = Math.floor(b.def.workers * frac);
      used += b.workers;
    }
    // Hand out rounding leftovers one by one.
    let left = total - used;
    for (const b of e.list) {
      if (left <= 0) break;
      if (b.workers < b.def.workers) { b.workers++; left--; }
    }
    for (const b of e.list) {
      const was = b.efficiency;
      b.efficiency = b.workers / b.def.workers;
      // A residence's desirability follows its staff (sim/desirability.js);
      // the layer is otherwise worked out again only when the map changes.
      if (b.def.kind === 'residence' && b.efficiency !== was) game.dirty.des = true;
    }
    const catEmployed = e.list.reduce((s, b) => s + b.workers, 0);
    employed += catEmployed;
    c.laborByCat[cat] = { demand: e.demand, employed: catEmployed, buildings: e.list.length };
  }

  c.workforce = workforce;
  c.jobs = jobs;
  c.employed = employed;
  c.unemployed = Math.max(0, workforce - employed);
  c.unemploymentRate = workforce > 0 ? c.unemployed / workforce : 0;
}

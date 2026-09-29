/**
 * helpers.mjs - shared helpers for the headless test files (not a test itself:
 * `npm test` only runs tests/*.test.mjs).
 */

import { Game } from '../src/core/game.js';
import { sandboxScenario } from '../src/data/scenarios.js';
import { planAction, applyPlan } from '../src/sim/construction.js';
import { Terrain } from '../src/world/map.js';

/** A small sandbox game on a known map. Raids are off unless asked for. */
export function newGame(opts = {}) {
  const scenario = sandboxScenario({ size: opts.size || 64, type: opts.type || 'river', seed: opts.seed || 'test-seed', invasions: opts.invasions || 'none' });
  return new Game({ scenario, flags: { unlockall: true, money: opts.money ?? 50000 } });
}

/** Build with the player's construction API (plan + apply). */
export function build(game, tool, x0, y0, x1 = x0, y1 = y0) {
  return applyPlan(game, planAction(game, tool, x0, y0, x1, y1));
}

/** Find a free rectangle of open land (no water/rock/trees/buildings/roads). */
export function findFree(game, w, h, from = null) {
  const { map } = game;
  const spots = [];
  for (let y = 2; y < map.h - h - 2; y++) {
    for (let x = 2; x < map.w - w - 2; x++) {
      let ok = true;
      for (let dy = 0; dy < h && ok; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const i = map.idx(x + dx, y + dy);
          if (!map.isFree(x + dx, y + dy) || map.terrain[i] === Terrain.TREES) { ok = false; break; }
        }
      }
      if (!ok) continue;
      if (!from) return { x, y };
      spots.push({ x, y, d: Math.hypot(x - from.x, y - from.y) });
    }
  }
  spots.sort((a, b) => a.d - b.d);
  return spots[0] || null;
}

/** Count units by type. */
export function unitCounts(game) {
  const out = {};
  for (const u of game.units.values()) out[u.type] = (out[u.type] || 0) + 1;
  return out;
}

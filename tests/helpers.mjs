/**
 * helpers.mjs - shared helpers for the headless test files (not a test itself:
 * `npm test` only runs tests/*.test.mjs).
 */

import { Game } from '../src/core/game.js';
import { sandboxScenario } from '../src/data/scenarios.js';
import { EVENT_SWITCHES } from '../src/data/events.js';
import { planAction, applyPlan } from '../src/sim/construction.js';
import { Terrain } from '../src/world/map.js';

/**
 * A small sandbox game on a known map. Raids are off unless asked for;
 * difficulty is Normal unless asked for; the sandbox's random events
 * (sim/events.js) are off unless asked for (`events: true` for every switch,
 * or a list of them), so a test of one rule is not upset by a wage change or
 * a caved-in clay pit.
 */
export function newGame(opts = {}) {
  const scenario = sandboxScenario({ size: opts.size || 64, type: opts.type || 'river', seed: opts.seed || 'test-seed', invasions: opts.invasions || 'none', difficulty: opts.difficulty || 'normal' });
  scenario.events = Array.isArray(opts.events) ? [...opts.events] : opts.events === true ? [...EVENT_SWITCHES] : [];
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

/**
 * A stand-in for a building's cached sprite (render/sprites.js) whose pixels
 * a click can read: an S x S footprint drawn as a solid block `H` world px
 * tall over its diamond, nothing above it (as if a flag pole's air), made at
 * scale `s`. Its anchor is the footprint's top corner, `top` world px below
 * the sprite's top edge. `reads` counts the pixels read.
 */
export function blockSprite(S, H, s = 1, top = 60) {
  const w = 64 * S * s;
  const h = (32 * S + top) * s;
  const spr = { w, h, ax: 32 * S * s, ay: top * s, s, reads: 0 };
  const solid = (x, y) => {
    const dx = (x + 0.5) / s - 32 * S; // world px from the top corner
    const dy = (y + 0.5) / s - top;
    for (let z = 0; z <= H; z++) if (Math.abs(dx) / (32 * S) + Math.abs(dy + z - 16 * S) / (16 * S) <= 1) return true;
    return false;
  };
  spr.canvas = { getContext: () => ({ getImageData: (x, y) => { spr.reads++; return { data: [0, 0, 0, solid(x, y) ? 255 : 0] }; } }) };
  return spr;
}

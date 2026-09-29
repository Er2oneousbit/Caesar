/**
 * demoCity.js
 * ----------------------------------------------------------------------------
 * Builds a sample city on any generated map using ONLY the public
 * construction API (the same one the player uses). Used by:
 *   - the headless balance simulation (scripts/simulate.mjs)
 *   - automated screenshot tests
 *   - the debug console command `demo`
 *
 * Layout: find a mostly-free rectangle beside the Imperial road and fill it
 * with streets every third row (street, house, house), two cross streets
 * joining them to the Imperial road, and service buildings dropped into the
 * housing bands. Farms and a granary go on the best meadow nearby.
 * ----------------------------------------------------------------------------
 */

import { planAction, applyPlan } from '../sim/construction.js';
import { Terrain } from '../world/map.js';

/** Try to build; returns true on success. */
function build(game, tool, x0, y0, x1 = x0, y1 = y0) {
  const plan = planAction(game, tool, x0, y0, x1, y1);
  if (!plan || plan.count === 0) return false;
  return applyPlan(game, plan).ok;
}

/** Place a building with its top-left at (x, y) (planAction centers big ones). */
function place(game, type, x, y, size) {
  const off = Math.floor((size - 1) / 2);
  return build(game, type, x + off, y + off, x + off, y + off);
}

/**
 * Locate the best rectangle for the demo city.
 * @returns {{toLocal:Function, W:number, D:number}|null}
 */
function findSite(game, W, D) {
  const { map } = game;
  const road = [];
  for (let i = 0; i < map.size; i++) if (map.road[i]) road.push(i);
  if (!road.length) return null;
  // Imperial road tiles sorted by distance to the map center.
  const cx = map.w / 2;
  const cy = map.h / 2;
  road.sort((a, b) => Math.hypot(map.xOf(a) - cx, map.yOf(a) - cy) - Math.hypot(map.xOf(b) - cx, map.yOf(b) - cy));
  let best = null;
  for (const i of road.slice(0, 60)) {
    const rx = map.xOf(i);
    const ry = map.yOf(i);
    const alongX = map.hasRoad(rx + 1, ry) && map.hasRoad(rx - 1, ry);
    const alongY = map.hasRoad(rx, ry + 1) && map.hasRoad(rx, ry - 1);
    if (!alongX && !alongY) continue;
    for (const side of [1, -1]) {
      // Local (a, b): a runs along the road, b runs away from it (b=0 touches the road).
      const toWorld = (a, b) => (alongX ? { x: rx + a, y: ry + side * (b + 1) } : { x: rx + side * (b + 1), y: ry + a });
      let free = 0;
      for (let b = 0; b < D; b++) {
        for (let a = 0; a < W; a++) {
          const p = toWorld(a, b);
          if (map.isFree(p.x, p.y) && map.terrain[map.idx(p.x, p.y)] !== Terrain.TREES) free++;
        }
      }
      // The local street at a = 0 must reach the imperial road.
      if (!best || free > best.free) best = { free, toWorld };
    }
  }
  return best && best.free > W * D * 0.8 ? best : null;
}

/**
 * Build the demo city.
 * @param {object} game
 * @param {object} [opts] { level: 1 basic | 2 with culture & water | 3 with industry }
 * @returns {{ok:boolean, center?:{x:number,y:number}, reason?:string}}
 */
export function buildDemoCity(game, opts = {}) {
  const level = opts.level ?? 2;
  const W = 18;
  const D = 11;
  const site = findSite(game, W, D);
  if (!site) return { ok: false, reason: 'No free land next to the road' };
  const at = site.toWorld;
  const R = (a0, b0, a1, b1) => {
    const p = at(a0, b0);
    const q = at(a1, b1);
    return build(game, 'road', p.x, p.y, q.x, q.y);
  };
  // Streets: rows b = 2, 5, 8 run along the road; cross streets at a = 0 and a = W-1.
  R(0, 0, 0, D - 1);
  R(W - 1, 0, W - 1, D - 1);
  for (const b of [2, 5, 8]) R(0, b, W - 1, b);

  // Services dropped into the housing bands (local a, b of their top-left tile).
  const services = [
    ['well', 3, 0, 1], ['well', 10, 0, 1], ['well', 3, 3, 1], ['well', 11, 6, 1], ['well', 6, 9, 1], ['well', 13, 9, 1],
    ['prefecture', 7, 1, 1], ['engineer_post', 8, 1, 1], ['prefecture', 14, 4, 1], ['engineer_post', 5, 7, 1],
    ['market', 5, 3, 2], ['temple_ceres', 12, 3, 2], ['temple_jupiter', 1, 6, 2],
  ];
  if (level >= 2) {
    services.push(
      ['school', 9, 6, 2], ['theater', 15, 6, 2], ['barber', 2, 9, 1], ['forum', 15, 9, 2], ['temple_mars', 9, 9, 2],
      ['market', 5, 9, 2], ['temple_neptune', 12, 0, 2], ['temple_vesta', 1, 0, 2], ['clinic', 16, 3, 1],
    );
  }
  for (const [type, a, b, size] of services) {
    // top-left in world coords depends on orientation: take the min corner of the footprint.
    const p = at(a, b);
    const q = at(a + size - 1, b + size - 1);
    place(game, type, Math.min(p.x, q.x), Math.min(p.y, q.y), size);
  }
  // Houses everywhere else inside the rectangle.
  for (let b = 0; b < D; b++) {
    for (let a = 1; a < W - 1; a++) {
      if (b === 2 || b === 5 || b === 8) continue;
      const p = at(a, b);
      if (game.map.isFree(p.x, p.y)) build(game, 'house', p.x, p.y);
    }
  }
  // Level 2: an actor troupe beside the theater street (outside the housing).
  if (level >= 2) {
    const p = at(W + 1, 5);
    const q = at(W + 2, 6);
    R(W - 1, 5, W + 3, 5);
    place(game, 'actor_troupe', Math.min(p.x, q.x), Math.min(p.y, q.y) + 0, 2);
  }

  // Level 2+: a small pottery industry beside the city (jobs + goods).
  if (level >= 2) placeIndustry(game, at(W / 2, D / 2));

  // Farms + granary on the best meadow within reach.
  const farms = placeFarms(game, at(W / 2, D / 2), level >= 2 ? 4 : 2);
  const c = at(W / 2, D / 2);
  return { ok: true, center: c, farms };
}

/** Find fertile 3x3 spots, place farms and connect them by road. */
function placeFarms(game, center, count) {
  const { map, pf } = game;
  const spots = [];
  for (let y = 1; y < map.h - 4; y++) {
    for (let x = 1; x < map.w - 4; x++) {
      const d = Math.hypot(x - center.x, y - center.y);
      if (d > 30) continue;
      const meadow = map.countTerrain(x, y, 3, Terrain.MEADOW);
      if (meadow < 6) continue;
      let free = true;
      for (let dy = 0; dy < 3 && free; dy++) for (let dx = 0; dx < 3; dx++) if (!map.isFree(x + dx, y + dy)) { free = false; break; }
      if (free) spots.push({ x, y, score: meadow * 3 - d });
    }
  }
  spots.sort((a, b) => b.score - a.score);
  let placed = 0;
  let granary = false;
  const used = [];
  for (const s of spots) {
    if (placed >= count) break;
    if (used.some((u) => Math.abs(u.x - s.x) < 4 && Math.abs(u.y - s.y) < 4)) continue;
    if (!place(game, 'farm_wheat', s.x, s.y, 3)) continue;
    used.push(s);
    placed++;
    // Connect the farm: road from a tile beside it to the nearest existing road.
    connectToRoad(game, s.x + 3, s.y + 1);
    if (!granary) {
      // Granary right next to the first farm's road, guarded by a prefect and an engineer.
      for (const [gx, gy] of [[s.x + 4, s.y], [s.x + 4, s.y - 3], [s.x - 3, s.y], [s.x, s.y + 4]]) {
        if (place(game, 'granary', gx, gy, 3)) {
          granary = true;
          connectToRoad(game, gx - 1, gy + 1);
          guard(game, gx + 1, gy + 1);
          break;
        }
      }
    }
  }
  void pf;
  return placed;
}

/** Clay pit near water + potter + warehouse, connected by road. */
function placeIndustry(game, center) {
  const { map } = game;
  const spots = [];
  for (let y = 1; y < map.h - 3; y++) {
    for (let x = 1; x < map.w - 3; x++) {
      const d = Math.hypot(x - center.x, y - center.y);
      if (d > 26 || d < 8) continue;
      if (!map.isNearTerrain(x, y, 2, Terrain.WATER, 2)) continue;
      let free = true;
      for (let dy = 0; dy < 2 && free; dy++) for (let dx = 0; dx < 2; dx++) if (!map.isFree(x + dx, y + dy)) { free = false; break; }
      if (free) spots.push({ x, y, d });
    }
  }
  spots.sort((a, b) => a.d - b.d);
  for (const s of spots) {
    if (!place(game, 'clay_pit', s.x, s.y, 2)) continue;
    connectToRoad(game, s.x + 2, s.y);
    guard(game, s.x, s.y);
    // Potter and warehouse as close as possible, each connected by road.
    for (const [type, size] of [['pottery_ws', 2], ['warehouse', 3]]) {
      let done = false;
      for (let r = 2; r < 10 && !done; r++) {
        for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r], [r, r], [-r, r], [r, -r], [-r, -r]]) {
          if (place(game, type, s.x + dx, s.y + dy, size)) { connectToRoad(game, s.x + dx + size, s.y + dy); done = true; break; }
        }
      }
    }
    return true;
  }
  return false;
}

/**
 * Put a prefecture and an engineer's post on free tiles that touch a road,
 * as close as possible to (x, y). Keeps outlying storage/industry safe.
 */
function guard(game, x, y) {
  const { map } = game;
  for (const type of ['prefecture', 'engineer_post']) {
    let done = false;
    for (let r = 1; r <= 6 && !done; r++) {
      for (let dy = -r; dy <= r && !done; dy++) {
        for (let dx = -r; dx <= r && !done; dx++) {
          const tx = x + dx;
          const ty = y + dy;
          if (!map.isFree(tx, ty)) continue;
          const touchesRoad = map.hasRoad(tx + 1, ty) || map.hasRoad(tx - 1, ty) || map.hasRoad(tx, ty + 1) || map.hasRoad(tx, ty - 1);
          if (touchesRoad && place(game, type, tx, ty, 1)) done = true;
        }
      }
    }
  }
}

/** Build a road from (x, y) to the nearest existing road tile. */
function connectToRoad(game, x, y) {
  const { map } = game;
  if (!map.inBounds(x, y) || map.hasRoad(x, y)) return;
  let best = null;
  for (let r = 1; r < 40 && !best; r++) {
    for (let dy = -r; dy <= r && !best; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (map.hasRoad(x + dx, y + dy)) { best = { x: x + dx, y: y + dy }; break; }
      }
    }
  }
  if (best) build(game, 'road', x, y, best.x, best.y);
}

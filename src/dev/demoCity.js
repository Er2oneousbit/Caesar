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
 *
 * In a campaign mission it builds only what the mission unlocks (a locked
 * building is skipped, not tried slot after slot), unless the game was made
 * with the unlockall flag; in a sandbox everything is unlocked, so a sandbox
 * city is the same either way.
 * ----------------------------------------------------------------------------
 */

import { planAction, applyPlan, undoLast } from '../sim/construction.js';
import { removeBuilding } from '../sim/entities.js';
import { openRoute, setTradeMode } from '../sim/trade.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';
import { Terrain } from '../world/map.js';
import { CONFIG } from '../config.js';

/** Undo records of the builds made inside the current attempt() (null outside one). */
let recording = null;

/**
 * Build only if all of it can be built: a path tool (an aqueduct) that finds
 * no way round falls back to a straight line and builds the tiles that fit,
 * and half an aqueduct carries no water.
 */
function buildWhole(game, tool, x0, y0, x1, y1) {
  const plan = planAction(game, tool, x0, y0, x1, y1);
  if (!plan || plan.count === 0 || plan.items.some((it) => !it.ok)) return false;
  const ok = applyPlan(game, plan).ok;
  if (ok && recording) recording.push(game.lastUndo);
  return ok;
}

/** Try to build; returns true on success. */
function build(game, tool, x0, y0, x1 = x0, y1 = y0) {
  const plan = planAction(game, tool, x0, y0, x1, y1);
  if (!plan || plan.count === 0) return false;
  const ok = applyPlan(game, plan).ok;
  if (ok && recording) recording.push(game.lastUndo);
  return ok;
}

/**
 * Try a placement: `fn` builds and returns a result, or null to give up. On
 * null, every build it made (the building and its connecting roads) is undone
 * with a full refund, so rejected spots cost nothing and leave no stray roads.
 */
function attempt(game, fn) {
  const outer = recording;
  const mine = [];
  recording = mine;
  let result = null;
  try {
    result = fn();
  } finally {
    recording = outer;
  }
  if (result) {
    if (outer) outer.push(...mine);
    return result;
  }
  for (const u of mine.reverse()) {
    game.lastUndo = u;
    undoLast(game);
  }
  return null;
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
  // Build along roads that reach the map entry (settlers come that way), not
  // along a street the player left unconnected.
  game.processRoadChanges();
  const entryNet = map.roadNet[map.idx(map.entry.x, map.entry.y)];
  const road = [];
  for (let i = 0; i < map.size; i++) if (map.road[i] && map.roadNet[i] === entryNet) road.push(i);
  if (!road.length) return null;
  // Imperial road tiles sorted by distance to the map center.
  const cx = map.w / 2;
  const cy = map.h / 2;
  road.sort((a, b) => Math.hypot(map.xOf(a) - cx, map.yOf(a) - cy) - Math.hypot(map.xOf(b) - cx, map.yOf(b) - cy));
  // Farmland within walking reach: meadow tiles up to FIELD_REACH steps over
  // land (not across water) from the site's middle, outside the town itself.
  // Fields lie ROAD_CLEARANCE+ tiles off the road, so a town placed without
  // looking could end up nowhere near one and never staff its farms.
  const FIELD_REACH = 28;
  const dist = new Int16Array(map.size);
  const fieldsNear = (sx, sy, inTown) => {
    dist.fill(-1);
    const start = map.idx(sx, sy);
    const queue = [start];
    dist[start] = 0;
    let meadow = 0;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      if (map.terrain[i] === Terrain.MEADOW && !inTown.has(i)) meadow++;
      if (dist[i] >= FIELD_REACH) continue;
      const x = map.xOf(i);
      const y = map.yOf(i);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (!map.inBounds(nx, ny)) continue;
        const j = map.idx(nx, ny);
        if (dist[j] >= 0 || map.terrain[j] === Terrain.WATER) continue;
        dist[j] = dist[i] + 1;
        queue.push(j);
      }
    }
    return meadow;
  };
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
      const inTown = new Set();
      for (let b = 0; b < D; b++) {
        for (let a = 0; a < W; a++) {
          const p = toWorld(a, b);
          if (map.inBounds(p.x, p.y)) inTown.add(map.idx(p.x, p.y));
          if (map.isFree(p.x, p.y) && map.terrain[map.idx(p.x, p.y)] !== Terrain.TREES) free++;
        }
      }
      if (free <= W * D * 0.8) continue;
      // The local street at a = 0 must reach the imperial road.
      const mid = toWorld(W >> 1, D >> 1);
      if (!map.inBounds(mid.x, mid.y)) continue;
      // Enough land to build on, then as much farmland in reach as 4-6 farms want.
      const score = free * 0.25 + Math.min(120, fieldsNear(mid.x, mid.y, inTown));
      if (!best || score > best.score) best = { free, score, toWorld };
    }
  }
  return best;
}

/**
 * Build the demo city.
 * @param {object} game
 * @param {object} [opts] { level: 1 basic | 2 with culture and industry | 3 also piped water,
 *   homes: at most this many housing plots (default: every free tile of the housing bands) }
 * Level 3 is the yardstick for money (npm run sweep): with fountain water its
 * homes climb past Huts as a sensible player's do; level 2's stay Huts.
 * `homes` sizes the town to a mission's jobs (npm run sim -- --homes): the
 * whole rectangle houses far more people than mission 1's buildings employ.
 * @returns {{ok:boolean, center?:{x:number,y:number}, reason?:string}}
 */
export function buildDemoCity(game, opts = {}) {
  const level = opts.level ?? 2;
  const homes = opts.homes ?? Infinity;
  const can = (type) => game.isUnlocked(type);
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
    ['market', 5, 3, 2], ['temple_ceres', 12, 3, 2], ['temple_mercury', 1, 6, 2],
  ];
  if (level >= 2) {
    services.push(
      ['school', 9, 6, 2], ['theater', 15, 6, 2], ['barber', 2, 9, 1], ['forum', 15, 9, 2], ['temple_mars', 9, 9, 2],
      ['market', 5, 9, 2], ['temple_neptune', 12, 0, 2], ['temple_venus', 1, 0, 2], ['clinic', 16, 3, 1],
    );
  }
  if (level >= 3) {
    // Fountains in free slots of the housing bands (fed by pipeWater below).
    services.push(['fountain', 4, 1, 1], ['fountain', 11, 1, 1], ['fountain', 8, 4, 1], ['fountain', 3, 7, 1], ['fountain', 14, 7, 1], ['fountain', 8, 10, 1]);
  }
  // top-left in world coords depends on orientation: take the min corner of the footprint.
  const placeLocal = (type, a, b, size) => {
    const p = at(a, b);
    const q = at(a + size - 1, b + size - 1);
    return place(game, type, Math.min(p.x, q.x), Math.min(p.y, q.y), size);
  };
  // The site may be up to a fifth trees or rock, so a planned slot can be
  // blocked. Every service first gets its own slot; the ones that failed then
  // take the nearest free slot in a housing band (after all the planned ones,
  // so a moved service never takes another's slot). Skipping them silently
  // once left the balance sim's city without a Forum, so it never taxed.
  const failed = services.filter(([type, a, b, size]) => can(type) && !placeLocal(type, a, b, size));
  for (const [type, a0, b0, size] of failed) {
    const slots = [];
    for (let b = 0; b + size <= D; b++) {
      if ([2, 5, 8].some((s) => s >= b && s < b + size)) continue; // not across a street
      for (let a = 1; a + size <= W - 1; a++) slots.push({ a, b, d: Math.abs(a - a0) + Math.abs(b - b0) });
    }
    slots.sort((s, t) => s.d - t.d);
    slots.find((s) => placeLocal(type, s.a, s.b, size));
  }
  // Houses everywhere else inside the rectangle (up to `homes` of them).
  let plots = 0;
  for (let b = 0; b < D; b++) {
    for (let a = 1; a < W - 1; a++) {
      if (b === 2 || b === 5 || b === 8 || plots >= homes) continue;
      const p = at(a, b);
      if (game.map.isFree(p.x, p.y) && build(game, 'house', p.x, p.y)) plots++;
    }
  }
  // Level 2: an actor troupe beside the theater street (outside the housing).
  if (level >= 2 && can('actor_troupe')) {
    const p = at(W + 1, 5);
    const q = at(W + 2, 6);
    R(W - 1, 5, W + 3, 5);
    place(game, 'actor_troupe', Math.min(p.x, q.x), Math.min(p.y, q.y) + 0, 2);
  }

  // Level 2+: a small pottery industry beside the city (jobs + goods).
  if (level >= 2 && can('clay_pit') && can('pottery_ws')) placeIndustry(game, at(W / 2, D / 2));
  // Level 3: piped water for the fountains.
  if (level >= 3 && can('reservoir')) pipeWater(game, at(W / 2, D / 2));

  // Farms + granary on the best meadow within reach.
  const farms = can('farm_wheat') ? placeFarms(game, at(W / 2, D / 2), level >= 2 ? 4 : 2) : 0;
  roadEveryBuilding(game);
  const c = at(W / 2, D / 2);
  return { ok: true, center: c, farms };
}

/**
 * Last pass: every building that needs a road has one. The plan lays its
 * streets on fixed rows, and on some sites rock or water breaks a street, or a
 * service moved to a free slot lands away from one; those buildings never got
 * workers (four of mission 1's level 3 town, fountains among them, so its
 * homes lacked water), and the menu's town showed no-road signs. Each is
 * joined to the nearest road that reaches the map entry, from the middle of
 * each side in turn; one that cannot be joined is cleared (full refund), as a
 * player would. A home is kept if a road lies within its 2 tiles, else cleared.
 */
function roadEveryBuilding(game) {
  const { map } = game;
  game.processRoadChanges();
  const entryNet = map.roadNet[map.idx(map.entry.x, map.entry.y)];
  for (const b of [...game.buildings.values()]) {
    if (!game.buildings.has(b.id)) continue;
    const S = b.size;
    if (b.house) {
      if (b.accessRoad < 0) build(game, 'clear', b.x, b.y, b.x + S - 1, b.y + S - 1);
      continue;
    }
    if (!b.def.needsRoad || !b.def.workers || b.accessRoad >= 0) continue;
    const mid = Math.floor(S / 2);
    for (const [x, y] of [[b.x + mid, b.y + S], [b.x + S, b.y + mid], [b.x + mid, b.y - 1], [b.x - 1, b.y + mid]]) {
      if (b.accessRoad >= 0) break;
      connectToRoad(game, x, y, entryNet);
      game.processRoadChanges();
    }
    if (b.accessRoad < 0) build(game, 'clear', b.x, b.y, b.x + S - 1, b.y + S - 1);
  }
  game.processRoadChanges();
}

/**
 * Find fertile 3x3 spots, place farms and connect them by road. Fields lie at
 * least ROAD_CLEARANCE tiles off the Imperial road and come as a few big
 * patches, so the nearest can be a fair walk away: search wide, prefer close.
 */
function placeFarms(game, center, count) {
  const { map, pf } = game;
  const spots = [];
  for (let y = 1; y < map.h - 4; y++) {
    for (let x = 1; x < map.w - 4; x++) {
      const d = Math.hypot(x - center.x, y - center.y);
      if (d > 48) continue;
      const meadow = map.countTerrain(x, y, 3, Terrain.MEADOW);
      if (meadow < 6) continue;
      let free = true;
      for (let dy = 0; dy < 3 && free; dy++) for (let dx = 0; dx < 3; dx++) if (!map.isFree(x + dx, y + dy)) { free = false; break; }
      if (free) spots.push({ x, y, d, score: meadow * 3 - d });
    }
  }
  spots.sort((a, b) => b.score - a.score);
  // Settlers only work within LABOR_RANGE road tiles of their homes, so a farm
  // the town cannot reach by road would never be staffed. Measure from the
  // town's road nearest its center, with some slack for the spread of homes.
  game.processRoadChanges();
  let townRoad = -1;
  let nearest = Infinity;
  for (let i = 0; i < map.size; i++) {
    if (!map.road[i]) continue;
    const d = Math.hypot(map.xOf(i) - center.x, map.yOf(i) - center.y);
    if (d < nearest) { nearest = d; townRoad = i; }
  }
  const staffable = (b) => {
    if (!b || b.accessRoad < 0 || townRoad < 0) return false;
    const path = pf.roadPath(b.accessRoad, townRoad, CONFIG.LABOR_RANGE);
    return !!path && path.length <= CONFIG.LABOR_RANGE - 8;
  };
  const entryNet = map.roadNet[map.idx(map.entry.x, map.entry.y)];
  let placed = 0;
  const used = [];
  // First only farms within hiring reach; if that leaves too few, any farm
  // whose road at least joins the town's network.
  for (const strict of [true, false]) {
    for (const s of spots) {
      if (placed >= count) break;
      if (strict && s.d > CONFIG.LABOR_RANGE - 8) continue; // too far even as the crow flies
      if (used.some((u) => Math.abs(u.x - s.x) < 4 && Math.abs(u.y - s.y) < 4)) continue;
      const farm = attempt(game, () => {
        if (!place(game, 'farm_wheat', s.x, s.y, 3)) return null;
        const b = [...game.buildings.values()].pop();
        // Connect the farm: road from a tile beside it to the nearest road of the town's network.
        connectToRoad(game, s.x + 3, s.y + 1, entryNet);
        game.processRoadChanges();
        const joined = b.accessRoad >= 0 && map.roadNet[b.accessRoad] === entryNet;
        return joined && (!strict || staffable(b)) ? b : null;
      });
      if (!farm) continue;
      used.push(s);
      placed++;
    }
  }
  // A granary by the first farm (short cart trips), else near the town, guarded
  // by a prefect and an engineer. Without one the harvest never leaves the farms.
  if (placed) {
    const first = used[0];
    const granary = placeNear(game, 'granary', 3, { x: first.x + 1, y: first.y + 1 }, 3, 12)
      || placeNear(game, 'granary', 3, center, 3, 26);
    if (granary) guard(game, granary.x + 1, granary.y + 1);
  }
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
 * Level 3: pipe water to the town, as a sensible player would, so its homes
 * can climb past Huts: a reservoir on the nearest shore and, when that is too
 * far for its piped area (RESERVOIR_RADIUS) to reach the middle of town, an
 * aqueduct to a second reservoir beside it. @returns {boolean} water is on its way
 */
function pipeWater(game, center) {
  const { map } = game;
  const R = CONFIG.RESERVOIR_RADIUS;
  // Each reservoir gets a road and an engineer's post beside it. Added when
  // reservoirs could collapse (the lakeshore one here once did); they no
  // longer wear out, but the post now looks after the homes and workshops
  // around it, and the sweep's money yardstick was measured with it (without
  // it the level 3 cities collapse more often and end with other margins).
  const keepUp = (r) => { connectToRoad(game, r.x + 3, r.y + 1); guard(game, r.x + 3, r.y + 1, ['engineer_post']); };
  let shore = null;
  for (const s of findSpot(game, 3, center, 0, 60)) {
    if (map.isNearTerrain(s.x, s.y, 3, Terrain.WATER, 1) && place(game, 'reservoir', s.x, s.y, 3)) { shore = s; break; }
  }
  if (!shore) return false;
  keepUp(shore);
  if (Math.max(Math.abs(shore.x + 1 - center.x), Math.abs(shore.y + 1 - center.y)) <= R - 4) return true;
  for (const near of findSpot(game, 3, center, 6, R)) {
    const ok = attempt(game, () => {
      if (!place(game, 'reservoir', near.x, near.y, 3)) return null;
      // Try the sides of each reservoir that face the other, nearest first.
      for (const a of besideToward(shore, near)) {
        for (const b of besideToward(near, shore)) if (buildWhole(game, 'aqueduct', a.x, a.y, b.x, b.y)) return true;
      }
      return null;
    });
    if (ok) { keepUp(near); return true; }
  }
  return false;
}

/** The tiles just outside a 3x3 building at `s`, those facing `t` first. */
function besideToward(s, t) {
  const out = [];
  for (let k = 0; k < 3; k++) out.push({ x: s.x + 3, y: s.y + k }, { x: s.x - 1, y: s.y + k }, { x: s.x + k, y: s.y + 3 }, { x: s.x + k, y: s.y - 1 });
  const d = (p) => Math.abs(p.x - (t.x + 1)) + Math.abs(p.y - (t.y + 1));
  return out.sort((p, q) => d(p) - d(q)).slice(0, 4);
}

/**
 * Put a prefecture and an engineer's post on free tiles that touch a road,
 * as close as possible to (x, y). Keeps outlying storage/industry safe.
 */
function guard(game, x, y, types = ['prefecture', 'engineer_post']) {
  const { map } = game;
  for (const type of types.filter((t) => game.isUnlocked(t))) {
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
function connectToRoad(game, x, y, net = null) {
  const { map } = game;
  if (!map.inBounds(x, y) || map.hasRoad(x, y)) return;
  // With `net`, only a road on that network counts (skip a stray, unconnected street).
  const joins = (tx, ty) => map.hasRoad(tx, ty) && (net === null || map.roadNet[map.idx(tx, ty)] === net);
  let best = null;
  for (let r = 1; r < 40 && !best; r++) {
    for (let dy = -r; dy <= r && !best; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (joins(x + dx, y + dy)) { best = { x: x + dx, y: y + dy }; break; }
      }
    }
  }
  if (best) build(game, 'road', x, y, best.x, best.y);
}

// ---------------------------------------------------------------------------
// Military showcase
// ---------------------------------------------------------------------------

/**
 * Free square of `size` tiles for a building near `center` (closest first),
 * between minD and maxD tiles away. Optionally only on meadow (ranches).
 */
function findSpot(game, size, center, minD, maxD, meadowOnly = false) {
  const { map } = game;
  const spots = [];
  for (let y = 1; y < map.h - size - 1; y++) {
    for (let x = 1; x < map.w - size - 1; x++) {
      const d = Math.hypot(x - center.x, y - center.y);
      if (d < minD || d > maxD) continue;
      let ok = true;
      for (let dy = 0; dy < size && ok; dy++) {
        for (let dx = 0; dx < size; dx++) {
          const tx = x + dx;
          const ty = y + dy;
          if (!map.isFree(tx, ty) || map.terrain[map.idx(tx, ty)] === Terrain.TREES) { ok = false; break; }
        }
      }
      if (!ok) continue;
      if (meadowOnly && map.countTerrain(x, y, size, Terrain.MEADOW) < size * size * 0.6) continue;
      spots.push({ x, y, d });
    }
  }
  spots.sort((a, b) => a.d - b.d);
  return spots;
}

/**
 * Place `type` at the nearest good spot and connect it to the road network.
 * A spot that cannot be connected is given up (building removed) and the
 * next one is tried, so callers always get a working, road-linked building.
 */
function placeNear(game, type, size, center, minD, maxD, meadowOnly = false) {
  const { map } = game;
  let tries = 0;
  for (const s of findSpot(game, size, center, minD, maxD, meadowOnly)) {
    if (tries++ > 40) break;
    const placed = attempt(game, () => {
      if (!place(game, type, s.x, s.y, size)) return null;
      const b = [...game.buildings.values()].pop();
      if (!b || b.type !== type) return null;
      // Only keep it if its road reaches the map entry: that network is where
      // settlers (and so workers) live. A road that only reaches an isolated
      // street of empty homes would leave it unstaffed forever.
      game.processRoadChanges();
      const entryNet = map.roadNet[map.idx(map.entry.x, map.entry.y)];
      const joined = () => b.accessRoad >= 0 && map.roadNet[b.accessRoad] === entryNet;
      for (const [x, y] of [[s.x + size, s.y + 1], [s.x - 1, s.y + 1], [s.x + 1, s.y + size], [s.x + 1, s.y - 1]]) {
        if (joined()) break;
        connectToRoad(game, x, y, entryNet);
        game.processRoadChanges();
      }
      return joined() ? b : null;
    });
    if (placed) return placed;
  }
  return null;
}

/**
 * Add a garrison to the demo city: barracks, one fort of each kind, a horse
 * ranch, a fletcher, two watchtowers and a wall with a gate across the
 * Imperial road. Everything is placed on roads that reach the map entry.
 * With { stock: true } the barracks gets equipment up front, so soldiers
 * appear quickly (screenshots, tests, the --garrison simulation). With
 * { militaryFirst: true } military labor also goes first in the Labor
 * advisor, as a governor raising an army might set it (the console
 * showcase); the simulation leaves priorities alone, since a small city
 * that staffs its army first loses its prefects, engineers and farms.
 * @returns {{ok:boolean, barracks?:object, forts:object[], ranch?:object, wall:number}}
 */
export function buildDemoGarrison(game, center, opts = {}) {
  const forts = [];
  const barracks = placeNear(game, 'barracks', 3, center, 6, 30);
  if (barracks) guard(game, barracks.x, barracks.y);
  for (const type of ['fort_legion', 'fort_archer', 'fort_cavalry']) {
    const f = placeNear(game, type, 3, center, 8, 34);
    if (f) forts.push(f);
  }
  const ranch = placeNear(game, 'horse_ranch', 3, center, 6, 34, true) || placeNear(game, 'horse_ranch', 3, center, 6, 34);
  const fletcher = placeNear(game, 'fletcher_ws', 2, center, 6, 30);
  const towers = [placeNear(game, 'tower', 2, center, 10, 30), placeNear(game, 'tower', 2, center, 14, 34)].filter(Boolean);
  const wall = demoWall(game, center);
  if (opts.stock && barracks) {
    // Equipment up front, so recruits come quickly. Labor priorities only
    // change on request (militaryFirst): putting the army first starved the
    // prefects, engineers and farms of small cities, which burned down or
    // went hungry (on Hard and Insane most demo garrison cities fell to 0).
    barracks.stock.weapons = 400;
    barracks.stock.arrows = 400;
    barracks.stock.horses = 400;
  }
  if (opts.militaryFirst && barracks && !game.city.laborPriority.includes('military')) game.city.laborPriority.unshift('military');
  return { ok: !!barracks && forts.length > 0, barracks, forts, ranch, fletcher, towers, wall };
}

/** A wall across the Imperial road ~12 tiles from the center, with a gate on the road. */
function demoWall(game, center) {
  const { map } = game;
  let best = null;
  for (let i = 0; i < map.size; i++) {
    if (!map.fixedRoad[i] && !map.road[i]) continue;
    const x = map.xOf(i);
    const y = map.yOf(i);
    const d = Math.hypot(x - center.x, y - center.y);
    if (d < 11 || d > 16) continue;
    const alongX = map.hasRoad(x + 1, y) && map.hasRoad(x - 1, y) && !map.hasRoad(x, y + 1) && !map.hasRoad(x, y - 1);
    const alongY = map.hasRoad(x, y + 1) && map.hasRoad(x, y - 1) && !map.hasRoad(x + 1, y) && !map.hasRoad(x - 1, y);
    if (!alongX && !alongY) continue;
    if (!best || Math.abs(d - 13) < Math.abs(best.d - 13)) best = { x, y, d, alongX };
  }
  if (!best) return 0;
  const L = 5;
  const plan = best.alongX
    ? planAction(game, 'wall', best.x, best.y - L, best.x, best.y + L)
    : planAction(game, 'wall', best.x - L, best.y, best.x + L, best.y);
  if (!plan || !plan.count) return 0;
  const res = applyPlan(game, plan);
  return res.ok ? res.count : 0;
}

// ---------------------------------------------------------------------------
// Harbor showcase
// ---------------------------------------------------------------------------

/**
 * Add a Dock (on the nearest navigable shore), a warehouse beside it and
 * the fire/repair posts it needs, then open every sea route of the scenario
 * and set a few imports/exports. Used by screenshots and tests.
 * @returns {{ok:boolean, dock?:object, warehouse?:object, routes:string[]}}
 */
export function buildDemoHarbor(game, center) {
  const { map } = game;
  if (!map.seaEntry) return { ok: false, routes: [] };
  // Dock candidates: nearest to the city first.
  const spots = [];
  for (let y = 1; y < map.h - 4; y++) {
    for (let x = 1; x < map.w - 4; x++) {
      const d = Math.hypot(x - center.x, y - center.y);
      if (d > 34) continue;
      spots.push({ x, y, d });
    }
  }
  spots.sort((a, b) => a.d - b.d);
  let dock = null;
  let tries = 0;
  for (const s of spots) {
    if (tries > 30) break;
    if (!place(game, 'dock', s.x, s.y, 3)) continue;
    tries++;
    dock = [...game.buildings.values()].pop();
    // Road from the dock's land side to the nearest street with homes on it
    // (the nearest road may be the Imperial road, too far from any workers).
    let street = null;
    let bestD = Infinity;
    for (const b of game.buildings.values()) {
      if (!b.house || b.accessRoad < 0) continue;
      const d = Math.hypot(map.xOf(b.accessRoad) - dock.x, map.yOf(b.accessRoad) - dock.y);
      if (d < bestD) { bestD = d; street = { x: map.xOf(b.accessRoad), y: map.yOf(b.accessRoad) }; }
    }
    for (const [x, y] of [[dock.x + 3, dock.y + 1], [dock.x - 1, dock.y + 1], [dock.x + 1, dock.y + 3], [dock.x + 1, dock.y - 1]]) {
      if (!map.inBounds(x, y) || map.navigable[map.idx(x, y)] || map.building[map.idx(x, y)]) continue;
      if (!(street && build(game, 'road', x, y, street.x, street.y))) connectToRoad(game, x, y);
      game.processRoadChanges();
      if (dock.accessRoad >= 0) break;
    }
    if (dock.accessRoad >= 0) break;
    removeBuilding(game, dock, 'undo');
    game.onMapEdited();
    dock = null;
  }
  if (!dock) return { ok: false, routes: [] };
  guard(game, dock.x, dock.y);
  const warehouse = placeNear(game, 'warehouse', 3, { x: dock.x, y: dock.y }, 3, 12);
  const routes = [];
  for (const [id, r] of Object.entries(game.city.trade.routes)) {
    if (TRADE_PARTNERS[id].route !== 'sea') continue;
    game.cheats.freeBuild = true;
    if (openRoute(game, id).ok) routes.push(id);
    game.cheats.freeBuild = false;
  }
  setTradeMode(game, 'wine', 'import', 800);
  setTradeMode(game, 'fruit', 'import', 600);
  setTradeMode(game, 'pottery', 'export', 200);
  return { ok: true, dock, warehouse, routes };
}

/**
 * construction.js
 * ----------------------------------------------------------------------------
 * Everything the player can build or clear goes through here.
 *
 * Two-step API used by the UI (preview while dragging, apply on release):
 *   const plan = planAction(game, tool, x0, y0, x1, y1)
 *   applyPlan(game, plan)
 *
 * `tool` is a building key ('house', 'prefecture', ...) or a tile tool
 * ('road', 'aqueduct', 'plaza', 'bridge', 'low_bridge', 'wall', 'roadblock', 'clear').
 *
 * Roadblocks: placed on a road tile (map.roadblock), they turn back roaming
 * walkers (see sim/movement.js). Clearing a roadblock leaves its road.
 *
 * Walls: dragged like roads over open land. Where a wall crosses a road it
 * becomes a gate (citizens pass, raiders must break it). Dragging a road
 * through an existing wall turns that wall tile into a gate as well.
 *
 * A plan lists every tile/building it would touch with ok/reason flags and a
 * total cost, so the renderer can color the preview green/red and the UI can
 * show "Cost: 120 Dn". Nothing changes until applyPlan().
 *
 * The last construction can be undone (Ctrl+Z) for a few days, with a full
 * refund, as long as nothing has moved into it yet.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { BUILDINGS, TOOLS } from '../data/buildings.js';
import { HOUSE_TIERS } from '../data/housing.js';
import { Road, Terrain, WaterBits, Wall, ROADBLOCK } from '../world/map.js';
import { addBuilding, perimeterTiles, removeBuilding, linkedGroup, sideToward, spanLayout, spanOrigin } from './entities.js';
import { canAfford, transact } from './economy.js';
import { dockBerth } from './trade.js';
import { cityStock } from './storage.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';
import { waterBeside } from './fishing.js';
import { clearRuin, restoreRuin, ruinAt } from './ruins.js';
import { residenceOf } from './governor.js';
import { archesToBuild } from './battle.js';
import { boatTiles, lowBridgeCuts, refreshWaterways } from './bridges.js';

const UNDO_WINDOW_DAYS = 10;
const MAX_BRIDGE = 16;

/** 1x1 buildings the player can paint over an area by dragging. */
export function isAreaBuilding(key) {
  const def = BUILDINGS[key];
  return !!def && def.size === 1 && ['house', 'decor', 'well'].includes(def.kind);
}

/**
 * Can the player turn this building as he places it (R)? Null if he can,
 * else why not: a waterside building faces its water and a triumphal arch
 * runs along its road (both decided by the world, not the player).
 */
export function turnRule(type) {
  const def = BUILDINGS[type];
  if (!def || !def.size) return 'Only buildings turn';
  if (def.placement === 'shore' || def.placement === 'fishingShore') return `The ${def.name} faces its water: it turns itself`;
  if (def.kind === 'arch') return `The ${def.name} follows its road: it turns itself`;
  return null;
}

/** The turn a building of this type is placed with: `turn` if the player may choose it, else 0. */
export function placedTurn(type, turn) {
  return turnRule(type) ? 0 : (Number(turn) || 0) & 3;
}

/** How a tool is dragged: 'single' | 'area' | 'path' | 'line'. */
export function dragMode(tool) {
  if (TOOLS[tool]) return TOOLS[tool].drag;
  if (isAreaBuilding(tool)) return 'area';
  return 'single';
}

// ---------------------------------------------------------------------------
// Single building checks
// ---------------------------------------------------------------------------

/**
 * The placement warnings for a spot with no road a building could use. The
 * build ghost turns the warning color and shows them by the cursor
 * (render/renderer.js, ui/ui.js), so they cannot be missed.
 */
export const NO_ROAD_WARNING = 'No road touches it: it gets no workers and does nothing until a road runs along one of its edges (a corner does not count)';
export const HOUSE_NO_ROAD_WARNING = 'Too far from a road: settlers cannot reach it (a home needs a road within 2 tiles)';

/** The no-road warning to show by the cursor for a plan, or null when every spot has a road. */
export function planNoRoadWarning(plan) {
  if (!plan || !plan.items || !plan.items.some((it) => it.ok && it.noRoad)) return null;
  return BUILDINGS[plan.tool]?.kind === 'house' ? HOUSE_NO_ROAD_WARNING : NO_ROAD_WARNING;
}

/**
 * Validate placing building `type` with its top-left corner at (x, y),
 * turned `turn` (only a hippodrome's ground depends on it: its row of
 * sections runs along y at turns 1 and 3, sim/entities.js spanLayout).
 * `noRoad`: the spot has no road the building could use (see the warnings above).
 * @returns {{ok:boolean, reason?:string, cost:number, warnings:string[], noRoad?:boolean, fertility?:number}}
 */
export function checkBuilding(game, type, x, y, turn = 0) {
  const def = BUILDINGS[type];
  const fail = (reason, cost = def ? def.cost : 0) => ({ ok: false, reason, cost, warnings: [] });
  if (!def) return fail('Unknown building');
  if (def.kind === 'arch') return checkArch(game, type, x, y);
  if (!game.isUnlocked(type) || !def.category) return fail('Not available in this scenario');
  const { map } = game;
  const S = def.size;
  // A hippodrome: three sections in a row, along x or (turned) along y.
  const { w: W, h: H } = spanLayout(def, x, y, turn);
  if (def.limit && countOf(game, type) >= def.limit) return fail(`Only ${def.limit === 1 ? 'one' : def.limit} ${def.name} in a city`);
  // One residence at a time, whatever its size: a bigger one is built after
  // the old one is demolished, never in place of it (the player chooses).
  const home = def.kind === 'residence' ? residenceOf(game) : null;
  if (home) return fail(`You already have a residence (${home.def.name}): only one may stand at a time. Demolish it first to build another.`);
  let trees = 0;
  let rubble = 0;
  let meadow = 0;
  for (let dy = 0; dy < H; dy++) {
    for (let dx = 0; dx < W; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!map.inBounds(tx, ty)) return fail('Outside the map');
      const i = map.idx(tx, ty);
      const t = map.terrain[i];
      if (t === Terrain.WATER) return fail('Cannot build on water');
      if (t === Terrain.ROCK) return fail('Cannot build on rocks');
      if (map.building[i]) return fail('Something is already built here');
      if (map.road[i]) return fail('Cannot build on a road');
      if (map.aqueduct[i]) return fail('An aqueduct is in the way');
      if (map.wall[i]) return fail('A wall is in the way');
      if (game.fires.has(i)) return fail('The ground is on fire!');
      if (t === Terrain.TREES) trees++;
      if (t === Terrain.MEADOW) meadow++;
      if (map.rubble[i]) rubble++;
    }
  }
  const cost = def.cost + trees * CONFIG.CLEAR_TREE_COST + rubble * CONFIG.CLEAR_RUBBLE_COST;
  const out = { ok: true, cost, warnings: [], trees, rubble };
  switch (def.placement) {
    case 'meadow':
      if (meadow === 0) return fail('Farms need meadow (fertile yellow-green land)', cost);
      out.fertility = meadow / (S * S);
      if (out.fertility < 1) out.warnings.push(`Fertility ${Math.round(out.fertility * 100)}%: only part of the field is meadow`);
      break;
    case 'nearWater':
      if (!map.isNearTerrain(x, y, S, Terrain.WATER, 2)) return fail('Must be within 2 tiles of water', cost);
      break;
    case 'nearTrees':
      if (map.countNearTerrain(x, y, S, Terrain.TREES, 2) < CONFIG.WOODS_MIN_TILES) return fail(`Must be within 2 tiles of woods (${CONFIG.WOODS_MIN_TILES}+ tiles of forest; lone trees are not enough)`, cost);
      break;
    case 'nearRock':
      if (!map.isNearTerrain(x, y, S, Terrain.ROCK, 1)) return fail('Must be right next to rocks', cost);
      break;
    case 'shore': {
      if (!map.seaEntry) return fail('No river or sea here reaches the map edge: ships cannot come to this province', cost);
      const i = map.navigableBeside(x, y, S);
      if (i < 0) return fail('Must touch the bank of a river or sea that ships can sail', cost);
      out.water = i;
      break;
    }
    case 'fishingShore': {
      const i = map.fishWaterBeside(x, y, S);
      if (i < 0) return fail('Must touch the bank of a river, the sea or a big lake (a pond has no fish)', cost);
      if (def.kind === 'wharf' && !map.groundsOf(map.fishBody[i]).length) return fail('No fish in this water', cost);
      out.water = i;
      break;
    }
    default:
      break;
  }
  if (!canAfford(game, cost)) return fail('Not enough money', cost);
  // Soft warnings (placement allowed, but it will not work well).
  // (A building with no workers, the Oracle, works without a road.)
  if (def.needsRoad && def.kind !== 'house' && def.workers > 0) {
    const hasRoad = perimeterTiles(map, x, y, W, H).some((i) => map.road[i]);
    if (!hasRoad) {
      out.warnings.push(NO_ROAD_WARNING);
      out.noRoad = true;
    }
  }
  if (def.kind === 'house') {
    let near = false;
    for (let ty = y - 2; ty <= y + 2 && !near; ty++) {
      for (let tx = x - 2; tx <= x + 2; tx++) if (map.hasRoad(tx, ty)) { near = true; break; }
    }
    if (!near) {
      out.warnings.push(HOUSE_NO_ROAD_WARNING);
      out.noRoad = true;
    }
  }
  if (def.needsPiped && !(map.water[map.idx(x, y)] & WaterBits.PIPED)) {
    out.warnings.push('Outside every full reservoir\'s piped area: it will have no water');
  }
  if (def.kind === 'reservoir' && !map.isNearTerrain(x, y, S, Terrain.WATER, 1)) {
    const touchesAqueduct = perimeterTiles(map, x, y, S).some((i) => map.aqueduct[i]);
    if (!touchesAqueduct) out.warnings.push('Not next to water: connect it by aqueduct to a full reservoir');
  }
  if (def.kind === 'wharf' && out.water >= 0) {
    const body = map.fishBody[out.water];
    const yard = [...game.buildings.values()].some((b) => b.def.kind === 'shipyard' && map.fishBody[waterBeside(game, b)] === body);
    if (!yard) out.warnings.push('No shipyard on this water yet: the wharf needs a boat from one');
  }
  if (def.kind === 'shipyard' && !timberInSight(game)) {
    const sells = (game.scenario.partners || []).some((id) => TRADE_PARTNERS[id]?.sells.timber);
    out.warnings.push(`Shipyards need timber (${CONFIG.SHIPYARD_BOAT_TIMBER} a boat): build a Silva Caedua (Timber Yard) by woods${sells ? ' or import it' : ''}`);
  }
  if (def.venue === 'hippodrome' && def.kind === 'venue' && !countOf(game, 'chariot_maker')) {
    out.warnings.push('No Factio (Chariot Stable) yet: build one, connected by road, to start the races');
  }
  return out;
}

/**
 * A triumphal arch with its top-left corner at (x, y): free, one for each
 * distant battle won (sim/battle.js archesToBuild), and built across a
 * straight road the way a gate is cut through a wall. Its middle row (the
 * road runs along x, `axis` 0) or middle column (along y, `axis` 1) must be
 * plain road from side to side, which it keeps; its other six tiles must be
 * open land, with no road (an arch over a junction or a road two wide would
 * cut the streets beside it). The Imperial road's entrance is never built
 * over. @returns the checkBuilding result, with `axis`
 */
export function checkArch(game, type, x, y) {
  const def = BUILDINGS[type];
  const fail = (reason) => ({ ok: false, reason, cost: 0, warnings: [] });
  if (archesToBuild(game) <= 0) return fail('No arch to build: Caesar grants one for each distant battle won');
  const { map } = game;
  const S = def.size;
  const mid = Math.floor(S / 2);
  const plainRoad = (tx, ty) => map.inBounds(tx, ty) && map.road[map.idx(tx, ty)] === Road.ROAD;
  let alongX = true;
  let alongY = true;
  for (let d = 0; d < S; d++) {
    if (!plainRoad(x + d, y + mid)) alongX = false;
    if (!plainRoad(x + mid, y + d)) alongY = false;
  }
  if (!alongX && !alongY) return fail('Build it across a straight road: the road must run through its middle from one side to the other');
  const axis = alongX ? 0 : 1;
  let trees = 0;
  let rubble = 0;
  for (let dy = 0; dy < S; dy++) {
    for (let dx = 0; dx < S; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!map.inBounds(tx, ty)) return fail('Outside the map');
      const i = map.idx(tx, ty);
      const t = map.terrain[i];
      const onRoad = axis === 0 ? dy === mid : dx === mid;
      if (t === Terrain.WATER) return fail('Cannot build on water');
      if (t === Terrain.ROCK) return fail('Cannot build on rocks');
      if (map.building[i]) return fail('Something is already built here');
      if (map.aqueduct[i]) return fail('An aqueduct is in the way');
      if (map.wall[i]) return fail('A wall is in the way');
      if (game.fires.has(i)) return fail('The ground is on fire!');
      if (onRoad) {
        if (map.roadblock[i]) return fail('A roadblock is in the way');
        if (map.fixedRoad[i]) return fail('Not over the Imperial road\'s entrance');
      } else {
        if (map.road[i]) return fail('Only the road through its middle may cross it: no road beside it, and not at a crossroads');
        if (t === Terrain.TREES) trees++;
        if (map.rubble[i]) rubble++;
      }
    }
  }
  const cost = def.cost + trees * CONFIG.CLEAR_TREE_COST + rubble * CONFIG.CLEAR_RUBBLE_COST;
  if (!canAfford(game, cost)) return fail('Not enough money');
  return { ok: true, cost, warnings: [], trees, rubble, axis };
}

/**
 * Has the city any timber coming for a shipyard: a timber yard, a boat's
 * worth in storage or another shipyard, or an open route that sells it?
 * (Placement warning only: a shipyard does nothing without it.)
 */
function timberInSight(game) {
  if (countOf(game, 'timber_yard')) return true;
  let held = cityStock(game, 'timber');
  for (const b of game.buildings.values()) if (b.def.kind === 'shipyard') held += b.stock?.timber || 0;
  if (held >= CONFIG.SHIPYARD_BOAT_TIMBER) return true;
  const routes = game.city.trade?.routes || {};
  return Object.entries(routes).some(([id, r]) => r.open && TRADE_PARTNERS[id]?.sells.timber);
}

/** How many buildings of this type the city has. */
function countOf(game, type) {
  let n = 0;
  for (const b of game.buildings.values()) if (b.type === type) n++;
  return n;
}

/**
 * The plan that puts back what fell on rubble tile `i` (the rubble's Rebuild
 * button): the same building on the same footprint, or a home's plots as
 * empty lots, or a wall. A normal plan (its cost includes clearing the
 * rubble), so it is checked, paid for and undone like any other. Null when
 * the rubble does not know what stood there (ruins from before v0.12.2).
 */
export function rebuildPlan(game, i) {
  const rec = ruinAt(game, i);
  if (!rec || !rec.site) return null;
  const { type, x, y, size } = rec.site;
  const turn = rec.site.turn || 0; // (built back the way it stood)
  if (type === 'house') return planAction(game, 'house', x, y, x + size - 1, y + size - 1, turn);
  if (type === 'wall') return planAction(game, 'wall', x, y, x, y);
  if (!BUILDINGS[type]) return null;
  // (x, y) is where the building (a hippodrome's main section) stood.
  const o = spanOrigin(BUILDINGS[type], x, y, turn);
  const off = anchorOffset(type, turn);
  const plan = planAction(game, type, o.x + off.x, o.y + off.y, o.x + off.x, o.y + off.y, turn);
  // planAction anchors on the middle tile: the same footprint, or nothing.
  return plan.items[0] && plan.items[0].x === x && plan.items[0].y === y ? plan : null;
}

/** From a building's top-left tile to its center tile (where the cursor holds it), turned `turn`. */
export function anchorOffset(type, turn = 0) {
  const def = BUILDINGS[type];
  if (!def) return { x: 0, y: 0 };
  const { w, h } = spanLayout(def, 0, 0, turn);
  return { x: Math.floor((w - 1) / 2), y: Math.floor((h - 1) / 2) };
}

/** Anchor a building so the cursor tile sits at its center. */
export function anchorFor(type, cx, cy, turn = 0) {
  const off = anchorOffset(type, turn);
  return { x: cx - off.x, y: cy - off.y };
}

/**
 * A preview look for a waterside building being placed: which edge faces
 * the water (the art's state), as once it is built.
 */
function ghostState(game, def, x, y, water) {
  if ((def.placement !== 'fishingShore' && def.placement !== 'shore') || !(water >= 0)) return 0;
  return sideToward(game.map, water, x, y, def.size);
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/**
 * Build a preview plan for a tool drag from (x0,y0) to (x1,y1).
 * For single buildings (x1,y1) is the cursor tile. `turn`: quarter turns
 * of the building being placed (R; ignored for what turns itself, turnRule).
 */
export function planAction(game, tool, x0, y0, x1, y1, turn = 0) {
  const mode = dragMode(tool);
  if (tool === 'road' || tool === 'aqueduct' || tool === 'wall') return planPath(game, tool, x0, y0, x1, y1);
  if (tool === 'plaza') return planPlaza(game, x0, y0, x1, y1);
  if (tool === 'clear') return planClear(game, x0, y0, x1, y1);
  if (tool === 'bridge' || tool === 'low_bridge') return planBridge(game, x0, y0, x1, y1, tool);
  if (tool === 'roadblock') return planRoadblock(game, x1, y1);
  if (mode === 'area') return planBuildingArea(game, tool, x0, y0, x1, y1, placedTurn(tool, turn));
  // Single building
  const def = BUILDINGS[tool];
  const t = def ? placedTurn(tool, turn) : 0;
  const a = anchorFor(tool, x1, y1, t);
  const chk = checkBuilding(game, tool, a.x, a.y, t);
  const S = def?.size || 1;
  // A hippodrome: its main section first, where its turn puts it, with the
  // whole row's top-left and size (`origin`); its other sections are drawn
  // in the preview and built with the first.
  const lay = def ? spanLayout(def, a.x, a.y, t) : { sections: [a], w: 1, h: 1 };
  const m = lay.sections[0];
  const items = [{ x: m.x, y: m.y, size: S, ok: chk.ok, reason: chk.reason, cost: chk.cost, noRoad: !!chk.noRoad, state: def ? ghostState(game, def, a.x, a.y, chk.water) : 0, turn: t, origin: { x: a.x, y: a.y, w: lay.w, h: lay.h } }];
  for (let k = 1; k < lay.sections.length; k++) {
    const p = lay.sections[k];
    items.push({ x: p.x, y: p.y, size: S, ok: chk.ok, reason: chk.reason, cost: 0, noRoad: !!chk.noRoad, part: true, type: `${tool}_part`, state: k, turn: t });
  }
  return {
    tool,
    kind: 'building',
    turn: t,
    items,
    cost: chk.ok ? chk.cost : 0,
    count: chk.ok ? 1 : 0,
    warnings: chk.warnings,
    reason: chk.reason,
    fertility: chk.fertility,
  };
}

function rectTiles(map, x0, y0, x1, y1) {
  const out = [];
  const ax = Math.max(0, Math.min(x0, x1));
  const bx = Math.min(map.w - 1, Math.max(x0, x1));
  const ay = Math.max(0, Math.min(y0, y1));
  const by = Math.min(map.h - 1, Math.max(y0, y1));
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) out.push([x, y]);
  return out;
}

function planBuildingArea(game, tool, x0, y0, x1, y1, turn = 0) {
  const items = [];
  let cost = 0;
  let count = 0;
  let budget = game.cheats.freeBuild ? Infinity : game.city.treasury - CONFIG.DEBT_LIMIT;
  const warnings = new Set();
  for (const [x, y] of rectTiles(game.map, x0, y0, x1, y1)) {
    const chk = checkBuilding(game, tool, x, y);
    let ok = chk.ok;
    let reason = chk.reason;
    if (ok && chk.cost > budget) { ok = false; reason = 'Not enough money'; }
    if (ok) {
      budget -= chk.cost;
      cost += chk.cost;
      count++;
      for (const w of chk.warnings) warnings.add(w);
    }
    items.push({ x, y, size: 1, ok, reason, cost: chk.cost, noRoad: !!chk.noRoad, turn });
  }
  // Only show "not enough money" style reasons when nothing at all is valid.
  const firstBad = items.find((i) => !i.ok);
  return { tool, kind: 'area', turn, items, cost, count, warnings: [...warnings], reason: count === 0 && firstBad ? firstBad.reason : null };
}

/** Can a road/aqueduct/wall tile go here? Returns cost to enter (Infinity = blocked). */
function pathTileCost(game, tool, i) {
  const { map } = game;
  const t = map.terrain[i];
  if (tool === 'road') {
    if (map.road[i]) return 0.3;
    if (t === Terrain.WATER || t === Terrain.ROCK) return Infinity;
    if (map.building[i]) return Infinity;
    if (game.fires.has(i)) return Infinity;
    if (map.wall[i]) return 3; // possible (becomes a gate) but the planner avoids it
    return t === Terrain.TREES ? 1.6 : map.rubble[i] ? 1.4 : 1;
  }
  if (tool === 'wall') {
    if (map.wall[i]) return 0.3;
    if (t === Terrain.WATER || t === Terrain.ROCK) return Infinity;
    if (map.building[i] || map.aqueduct[i] || map.roadblock[i]) return Infinity;
    if (game.fires.has(i)) return Infinity;
    if (map.road[i]) return map.road[i] === Road.ROAD ? 1.5 : Infinity; // gate; never on bridges or plazas
    return t === Terrain.TREES ? 1.6 : map.rubble[i] ? 1.4 : 1;
  }
  // aqueduct
  if (map.aqueduct[i]) return 0.3;
  if (t === Terrain.WATER || t === Terrain.ROCK) return Infinity;
  if (map.building[i] || map.wall[i] || map.roadblock[i]) return Infinity;
  if (map.road[i] === Road.BRIDGE || map.road[i] === Road.PLAZA) return Infinity;
  if (game.fires.has(i)) return Infinity;
  return map.road[i] ? 1.5 : t === Terrain.TREES ? 1.6 : 1;
}

/**
 * Is a road-and-aqueduct tile a proper crossing: the road straight through
 * along one axis, the aqueduct straight along the other, so the road passes
 * under one arch at right angles (as through a gate)? `road(j)` and `aq(j)`
 * say whether tile j has a road or an aqueduct (after the change being
 * planned). A road may not run along under an aqueduct, turn or branch
 * under it, nor an aqueduct turn over a road (playtest).
 */
export function crossingOk(map, i, road, aq) {
  const x = map.xOf(i);
  const y = map.yOf(i);
  const at = (dx, dy, f) => map.inBounds(x + dx, y + dy) && f(map.idx(x + dx, y + dy));
  const roadH = at(-1, 0, road) || at(1, 0, road);
  const roadV = at(0, -1, road) || at(0, 1, road);
  const aqH = at(-1, 0, aq) || at(1, 0, aq);
  const aqV = at(0, -1, aq) || at(0, 1, aq);
  return !(roadH && roadV) && !(aqH && aqV) && !(roadH && aqH) && !(roadV && aqV);
}

/**
 * Mark the path items that would leave a road-and-aqueduct tile that is not
 * a proper crossing (crossingOk): the path's own tiles, or a crossing
 * beside them that the new road or aqueduct would join along its length.
 */
function checkCrossings(game, tool, tiles, items) {
  const { map } = game;
  if (tool !== 'road' && tool !== 'aqueduct') return;
  const added = new Set(tiles);
  const road = (j) => !!map.road[j] || (tool === 'road' && added.has(j));
  const aq = (j) => !!map.aqueduct[j] || (tool === 'aqueduct' && added.has(j));
  const W = map.w;
  tiles.forEach((i, k) => {
    const it = items[k];
    if (!it.ok || it.exists) return;
    for (const j of [i, i - 1, i + 1, i - W, i + W]) {
      if (j < 0 || j >= map.size || Math.abs(map.xOf(j) - map.xOf(i)) > 1) continue;
      if (!(road(j) && aq(j))) continue;
      if (!crossingOk(map, j, road, aq)) {
        it.ok = false;
        it.reason = 'A road crosses an aqueduct only straight through, at right angles: never along it, nor turning under it';
        return;
      }
    }
  });
}

function tileClearCost(game, i) {
  const { map } = game;
  return (map.terrain[i] === Terrain.TREES ? CONFIG.CLEAR_TREE_COST : 0) + (map.rubble[i] ? CONFIG.CLEAR_RUBBLE_COST : 0);
}

function planPath(game, tool, x0, y0, x1, y1) {
  const { map, pf } = game;
  const unit = TOOLS[tool].cost;
  const fail = (reason) => ({ tool, kind: 'path', items: [], cost: 0, count: 0, warnings: [], reason });
  if (!game.isUnlocked(tool)) return fail('Not available in this scenario');
  if (!map.inBounds(x0, y0) || !map.inBounds(x1, y1)) return fail('Outside the map');
  const start = map.idx(x0, y0);
  const goal = map.idx(x1, y1);
  let tiles = null;
  if (pathTileCost(game, tool, start) < Infinity && pathTileCost(game, tool, goal) < Infinity) {
    tiles = pf.astar(start, goal, (i) => pathTileCost(game, tool, i), { turnPenalty: 0.6, maxNodes: 60000 });
  }
  if (!tiles) {
    // Fall back to a simple L-shape so the player sees where it is blocked.
    tiles = [];
    const sx = Math.sign(x1 - x0);
    const sy = Math.sign(y1 - y0);
    let x = x0;
    let y = y0;
    tiles.push(map.idx(x, y));
    while (x !== x1) { x += sx; tiles.push(map.idx(x, y)); }
    while (y !== y1) { y += sy; tiles.push(map.idx(x, y)); }
  }
  const items = [];
  let cost = 0;
  let count = 0;
  let budget = game.cheats.freeBuild ? Infinity : game.city.treasury - CONFIG.DEBT_LIMIT;
  let gates = 0;
  for (const i of tiles) {
    const c = pathTileCost(game, tool, i);
    const exists = tool === 'road' ? !!map.road[i] : tool === 'wall' ? !!map.wall[i] : !!map.aqueduct[i];
    // A gate: a wall crossing a road, or a road cut through a wall.
    const gate = !exists && ((tool === 'wall' && !!map.road[i]) || (tool === 'road' && map.wall[i] === Wall.WALL));
    let ok = c < Infinity;
    let reason = ok ? null : 'Blocked';
    let tileCost = 0;
    if (!exists) {
      if (gate) tileCost = TOOLS.wall.gateCost + (tool === 'road' ? unit : 0);
      else tileCost = unit + tileClearCost(game, i);
    }
    if (ok && !exists && tileCost > budget) { ok = false; reason = 'Not enough money'; }
    if (ok && !exists) { budget -= tileCost; cost += tileCost; count++; if (gate) gates++; }
    items.push({ x: map.xOf(i), y: map.yOf(i), size: 1, ok, reason, exists, gate, cost: tileCost });
  }
  checkCrossings(game, tool, tiles, items);
  // A tile refused for its crossing does not count or cost.
  cost = 0;
  count = 0;
  for (const it of items) if (it.ok && !it.exists) { cost += it.cost; count++; }
  const bad = items.find((it) => !it.ok);
  const warnings = gates > 0 ? [`${gates} gate${gates === 1 ? '' : 's'} (${TOOLS.wall.gateCost} Dn each): citizens pass, raiders must break ${gates === 1 ? 'it' : 'them'}`] : [];
  return { tool, kind: 'path', items, cost, count, warnings, reason: bad ? bad.reason : null };
}

/** A roadblock on the road tile (x, y). */
export function checkRoadblock(game, x, y) {
  const { map } = game;
  const cost = TOOLS.roadblock.cost;
  const fail = (reason) => ({ ok: false, reason, cost });
  if (!game.isUnlocked('roadblock')) return fail('Not available in this scenario');
  if (!map.inBounds(x, y)) return fail('Outside the map');
  const i = map.idx(x, y);
  if (map.roadblock[i]) return fail('There is a roadblock here already');
  if (!map.road[i]) return fail('A Claustra (Roadblock) goes on a road');
  if (map.road[i] === Road.BRIDGE) return fail('Not on a bridge');
  if (map.wall[i]) return fail('Not in a gate');
  if (map.aqueduct[i]) return fail('Not under an aqueduct');
  if (map.building[i]) return fail('Not under a building (an arch keeps its road clear)');
  if (!canAfford(game, cost)) return fail('Not enough money');
  return { ok: true, cost };
}

function planRoadblock(game, x, y) {
  const chk = checkRoadblock(game, x, y);
  return {
    tool: 'roadblock',
    kind: 'building',
    items: [{ x, y, size: 1, ok: chk.ok, reason: chk.reason, cost: chk.cost }],
    cost: chk.ok ? chk.cost : 0,
    count: chk.ok ? 1 : 0,
    warnings: [],
    reason: chk.reason,
  };
}

function planPlaza(game, x0, y0, x1, y1) {
  const { map } = game;
  const unit = TOOLS.plaza.cost;
  const items = [];
  let cost = 0;
  let count = 0;
  let budget = game.cheats.freeBuild ? Infinity : game.city.treasury - CONFIG.DEBT_LIMIT;
  if (!game.isUnlocked('plaza')) return { tool: 'plaza', kind: 'area', items, cost: 0, count: 0, warnings: [], reason: 'Not available in this scenario' };
  for (const [x, y] of rectTiles(map, x0, y0, x1, y1)) {
    const i = map.idx(x, y);
    if (map.road[i] !== Road.ROAD || map.wall[i] || map.building[i]) continue; // only plain roads (not gates, nor the road under an arch) can be paved
    const ok = unit <= budget;
    if (ok) { budget -= unit; cost += unit; count++; }
    items.push({ x, y, size: 1, ok, reason: ok ? null : 'Not enough money', cost: unit });
  }
  return { tool: 'plaza', kind: 'area', items, cost, count, warnings: [], reason: count === 0 ? 'Drag over existing roads to pave them' : null };
}

/**
 * A bridge, `tool` 'bridge' (the ship bridge) or 'low_bridge': a straight
 * line from open land across water to open land. A low bridge closes the
 * water to boats (sim/bridges.js): its plan warns of every dock, station
 * or wharf it would cut off, and it may not stand where a boat is now or
 * on the tile where ships come in from the sea.
 */
function planBridge(game, x0, y0, x1, y1, tool = 'bridge') {
  const { map } = game;
  const def = TOOLS[tool];
  const low = tool === 'low_bridge';
  const fail = (reason, items = []) => ({ tool, kind: 'line', items, cost: 0, count: 0, warnings: [], reason });
  if (!game.isUnlocked(tool)) return fail('Not available in this scenario');
  // Snap to the dominant axis.
  const horizontal = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
  const ex = horizontal ? x1 : x0;
  const ey = horizontal ? y0 : y1;
  const tiles = [];
  const sx = Math.sign(ex - x0);
  const sy = Math.sign(ey - y0);
  let x = x0;
  let y = y0;
  tiles.push([x, y]);
  while (x !== ex || y !== ey) { x += sx; y += sy; tiles.push([x, y]); }
  const items = tiles.map(([tx, ty]) => ({ x: tx, y: ty, size: 1, ok: true, reason: null, cost: 0 }));
  if (tiles.length < 3) return fail('Drag from one bank across the water to the other bank', items.map((i) => ({ ...i, ok: false })));
  let cost = 0;
  let count = 0;
  let waterRun = 0;
  const entry = map.seaEntry ? map.idx(map.seaEntry.x, map.seaEntry.y) : -1;
  const boats = low ? boatTiles(game) : null;
  for (let k = 0; k < tiles.length; k++) {
    const [tx, ty] = tiles[k];
    const it = items[k];
    if (!map.inBounds(tx, ty)) { it.ok = false; it.reason = 'Outside the map'; continue; }
    const i = map.idx(tx, ty);
    const t = map.terrain[i];
    const endpoint = k === 0 || k === tiles.length - 1;
    if (endpoint) {
      const land = t !== Terrain.WATER && t !== Terrain.ROCK && !map.building[i] && !map.wall[i];
      if (!land) { it.ok = false; it.reason = `A ${def.name} (${def.en}) must start and end on open land`; }
      else if (!map.road[i]) { it.cost = TOOLS.road.cost; cost += it.cost; count++; }
    } else {
      if (t !== Terrain.WATER || map.building[i]) { it.ok = false; it.reason = 'A bridge can only span open water'; }
      else if (map.road[i] === Road.BRIDGE && !map.bridgeLow[i] !== !low) { it.ok = false; it.reason = `A ${low ? TOOLS.bridge.en : TOOLS.low_bridge.en} stands here: clear it first`; }
      else if (low && i === entry) { it.ok = false; it.reason = 'Ships come in from the sea here: no low bridge on this tile'; }
      else if (low && map.road[i] !== Road.BRIDGE && boats.has(i)) { it.ok = false; it.reason = 'A boat is in the way: wait until it has passed'; }
      else if (map.road[i] === Road.BRIDGE) { it.cost = 0; }
      else { it.cost = def.cost; cost += it.cost; count++; }
      waterRun++;
    }
  }
  if (waterRun > MAX_BRIDGE) return fail(`Too long: bridges span at most ${MAX_BRIDGE} tiles of water`, items.map((i) => ({ ...i, ok: false })));
  if (waterRun < def.minWater) return fail(`Too short: a ${def.name} (${def.en}) spans at least ${def.minWater} tiles of water, so ships pass between its piers. Use a low bridge here.`, items.map((i) => ({ ...i, ok: false })));
  if (items.some((i) => !i.ok)) return { tool, kind: 'line', items, cost: 0, count: 0, warnings: [], reason: items.find((i) => !i.ok).reason };
  if (!canAfford(game, cost)) return fail('Not enough money', items.map((i) => ({ ...i, ok: false })));
  const span = items.filter((it, k) => k > 0 && k < items.length - 1).map((it) => map.idx(it.x, it.y));
  return { tool, kind: 'line', items, cost, count, warnings: low ? lowBridgeCuts(game, span) : [], reason: null };
}

function planClear(game, x0, y0, x1, y1) {
  const { map, buildings } = game;
  const items = [];
  const seen = new Set();
  let cost = 0;
  let count = 0;
  let evicted = 0;
  const warnings = [];
  for (const [x, y] of rectTiles(map, x0, y0, x1, y1)) {
    const i = map.idx(x, y);
    const id = map.building[i];
    if (id) {
      if (!seen.has(id)) {
        // A hippodrome comes down whole: show every section it takes with it.
        const b = buildings.get(id);
        for (const x of b ? linkedGroup(game, b) : []) {
          if (seen.has(x.id)) continue;
          seen.add(x.id);
          items.push({ x: x.x, y: x.y, size: x.size, ok: true, building: x.id, cost: 0 });
          count++;
          if (x.house) evicted += x.house.pop;
        }
        seen.add(id);
      }
      continue;
    }
    if (map.roadblock[i]) {
      // A roadblock comes down first and leaves its road behind.
      items.push({ x, y, size: 1, ok: true, roadblock: true, cost: 0 });
      count++;
      continue;
    }
    if (map.wall[i]) {
      // Walls and gates come down first; a gate leaves its road behind.
      items.push({ x, y, size: 1, ok: true, wall: true, cost: 0 });
      count++;
      continue;
    }
    if (map.road[i]) {
      if (map.fixedRoad[i]) { items.push({ x, y, size: 1, ok: false, reason: 'The Imperial road entrance cannot be removed', cost: 0 }); continue; }
      items.push({ x, y, size: 1, ok: true, road: true, cost: 0 });
      count++;
      continue;
    }
    if (map.aqueduct[i]) { items.push({ x, y, size: 1, ok: true, aqueduct: true, cost: 0 }); count++; continue; }
    const c = tileClearCost(game, i);
    if (c > 0) {
      const ok = game.cheats.freeBuild || game.city.treasury - cost - c >= CONFIG.DEBT_LIMIT;
      items.push({ x, y, size: 1, ok, reason: ok ? null : 'Not enough money', cost: c, terrainClear: true });
      if (ok) { cost += c; count++; }
    }
  }
  if (evicted > 0) warnings.push(`${evicted} residents will lose their homes`);
  return { tool: 'clear', kind: 'area', items, cost, count, warnings, reason: count === 0 ? 'Nothing to clear here' : null };
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/**
 * Carry out a plan. Returns { ok, count, cost, reason }.
 * Records an undo entry for build actions.
 */
export function applyPlan(game, plan) {
  if (!plan || plan.count === 0) return { ok: false, count: 0, cost: 0, reason: plan?.reason || 'Nothing to do' };
  const { map } = game;
  const undo = { tool: plan.tool, day: game.time.totalDays, cost: 0, ops: [] };
  let spent = 0;
  let done = 0;
  // `ruin`: what the rubble remembered (sim/ruins.js), so an undo gives it back.
  const saveTile = (i) => ({ i, terrain: map.terrain[i], rubble: map.rubble[i], wall: map.wall[i], ruin: game.ruins.get(i) || null });
  const clearTile = (i) => {
    if (map.terrain[i] === Terrain.TREES) map.terrain[i] = Terrain.GRASS;
    map.rubble[i] = 0;
    clearRuin(game, i);
  };

  let lowChanged = false; // a low bridge built or cleared: the boats' water changes
  if (plan.tool === 'clear') {
    for (const it of plan.items) {
      if (!it.ok) continue;
      if (it.building) {
        const b = game.buildings.get(it.building);
        if (b) { done += linkedGroup(game, b).length; removeBuilding(game, b, 'demolish'); } // a hippodrome: all its sections
      } else if (it.road) {
        const i = map.idx(it.x, it.y);
        if (map.bridgeLow[i]) { map.bridgeLow[i] = 0; lowChanged = true; }
        map.road[i] = Road.NONE;
        map.aqueduct[i] = 0;
        map.roadblock[i] = 0;
        done++;
      } else if (it.roadblock) {
        map.roadblock[map.idx(it.x, it.y)] = 0;
        done++;
      } else if (it.aqueduct) {
        map.aqueduct[map.idx(it.x, it.y)] = 0;
        done++;
      } else if (it.wall) {
        const i = map.idx(it.x, it.y);
        map.wall[i] = Wall.NONE;
        game.wallHp.delete(i);
        done++;
      } else if (it.terrainClear) {
        const i = map.idx(it.x, it.y);
        if (!game.cheats.freeBuild && game.city.treasury - it.cost < CONFIG.DEBT_LIMIT) continue;
        clearTile(i);
        spent += it.cost;
        done++;
      }
    }
    if (spent > 0) transact(game, 'construction', -spent);
    if (lowChanged) refreshWaterways(game); // boats may pass where a low bridge stood
    game.onMapEdited();
    game.lastUndo = null;
    game.events.emit('sound', { name: 'demolish' });
    return { ok: done > 0, count: done, cost: spent };
  }

  if (plan.tool === 'roadblock') {
    for (const it of plan.items) {
      if (!it.ok || !checkRoadblock(game, it.x, it.y).ok) continue;
      const i = map.idx(it.x, it.y);
      map.roadblock[i] = ROADBLOCK.PRESENT; // lets nobody through until the player says so
      undo.ops.push({ op: 'roadblock', i });
      spent += it.cost;
      done++;
    }
  } else if (plan.tool === 'road' || plan.tool === 'aqueduct' || plan.tool === 'plaza' || plan.tool === 'bridge' || plan.tool === 'low_bridge' || plan.tool === 'wall') {
    // A boat may have sailed under the line since the plan was made: no
    // low bridge with a gap in it, and none over a boat.
    if (plan.tool === 'low_bridge') {
      const boats = boatTiles(game);
      if (plan.items.some((it) => it.ok && map.inBounds(it.x, it.y) && map.road[map.idx(it.x, it.y)] !== Road.BRIDGE && boats.has(map.idx(it.x, it.y)))) {
        return { ok: false, count: 0, cost: 0, reason: 'A boat is in the way: wait until it has passed' };
      }
    }
    for (const it of plan.items) {
      if (!it.ok || it.exists) continue;
      const i = map.idx(it.x, it.y);
      if (!game.cheats.freeBuild && game.city.treasury - spent - it.cost < CONFIG.DEBT_LIMIT) break;
      if (plan.tool === 'road') {
        if (map.road[i]) continue;
        undo.ops.push({ op: 'road', ...saveTile(i) });
        clearTile(i);
        map.road[i] = Road.ROAD;
        if (map.wall[i]) { map.wall[i] = Wall.GATE; game.wallHp.delete(i); } // cut a gate
      } else if (plan.tool === 'wall') {
        if (map.wall[i] || map.building[i] || map.aqueduct[i]) continue;
        if (map.road[i] && map.road[i] !== Road.ROAD) continue;
        undo.ops.push({ op: 'wall', ...saveTile(i) });
        if (map.road[i]) map.wall[i] = Wall.GATE;
        else { clearTile(i); map.wall[i] = Wall.WALL; }
        game.wallHp.delete(i);
      } else if (plan.tool === 'aqueduct') {
        if (map.aqueduct[i]) continue;
        undo.ops.push({ op: 'aqueduct', ...saveTile(i) });
        clearTile(i);
        map.aqueduct[i] = 1;
      } else if (plan.tool === 'plaza') {
        if (map.road[i] !== Road.ROAD) continue;
        undo.ops.push({ op: 'plaza', i });
        map.road[i] = Road.PLAZA;
      } else if (plan.tool === 'bridge' || plan.tool === 'low_bridge') {
        if (it.cost === 0) continue;
        const water = map.terrain[i] === Terrain.WATER;
        undo.ops.push({ op: 'road', ...saveTile(i) });
        if (water) {
          map.road[i] = Road.BRIDGE;
          if (plan.tool === 'low_bridge') { map.bridgeLow[i] = 1; lowChanged = true; }
        } else { clearTile(i); map.road[i] = Road.ROAD; }
      }
      spent += it.cost;
      done++;
    }
  } else {
    // Buildings (single or area)
    for (const it of plan.items) {
      if (!it.ok || it.part) continue; // a hippodrome's sections come with its first
      const turn = placedTurn(plan.tool, it.turn ?? plan.turn); // (the R key's choice: looks only, but for a hippodrome's row)
      const o = it.origin || it; // the whole row's top-left, for a hippodrome
      const chk = checkBuilding(game, plan.tool, o.x, o.y, turn); // re-check: earlier items may have changed things
      if (!chk.ok) continue;
      const lay = spanLayout(BUILDINGS[plan.tool], o.x, o.y, turn);
      const tiles = [];
      for (let dy = 0; dy < lay.h; dy++) {
        for (let dx = 0; dx < lay.w; dx++) {
          const i = map.idx(o.x + dx, o.y + dy);
          tiles.push(saveTile(i));
          clearTile(i);
        }
      }
      const b = addBuilding(game, plan.tool, lay.sections[0].x, lay.sections[0].y, undefined, { turn });
      if (chk.axis !== undefined) b.axis = chk.axis; // a triumphal arch: the way its road runs (art, sim/battle.js)
      if (b.def.placement === 'shore') dockBerth(game, b); // berth + which side faces the water (docks, the navalia, naval stations)
      if (b.def.placement === 'fishingShore') waterBeside(game, b); // slip or mooring + which side faces the water
      undo.ops.push({ op: 'building', id: b.id, tiles });
      if (lay.sections.length > 1) addSections(game, b, lay.sections, undo);
      spent += chk.cost;
      done++;
    }
  }
  if (spent > 0) transact(game, 'construction', -spent);
  if (lowChanged) refreshWaterways(game);
  undo.cost = spent;
  game.lastUndo = done > 0 ? undo : null;
  game.onMapEdited();
  if (done > 0) game.events.emit('sound', { name: 'build' });
  return { ok: done > 0, count: done, cost: spent };
}

/**
 * A hippodrome's other sections, linked to it (`main`, `parts`): each its
 * own 5x5 building that holds its tiles and draws its stretch of track. The
 * hippodrome's road access takes a road beside any of them (entities.js).
 * Undoing any one removes the whole (removeBuilding takes the group).
 */
function addSections(game, b, sections, undo) {
  b.parts = [];
  for (let k = 1; k < sections.length; k++) {
    const p = addBuilding(game, `${b.type}_part`, sections[k].x, sections[k].y, undefined, { turn: b.turn });
    p.main = b.id;
    p.section = k;
    b.parts.push(p.id);
    undo.ops.push({ op: 'building', id: p.id, tiles: [] });
  }
}

/** Is there something to undo right now? */
export function canUndo(game) {
  const u = game.lastUndo;
  if (!u) return false;
  if (game.time.totalDays - u.day > UNDO_WINDOW_DAYS) return false;
  for (const op of u.ops) {
    if (op.op !== 'building') continue;
    const b = game.buildings.get(op.id);
    if (!b) return false;
    if (b.house && (b.house.pop > 0 || b.house.incoming > 0)) return false;
  }
  return true;
}

/** Undo the last construction with a full refund. */
export function undoLast(game) {
  if (!canUndo(game)) return { ok: false, reason: 'Nothing to undo' };
  const u = game.lastUndo;
  const { map } = game;
  let lowChanged = false;
  for (const op of [...u.ops].reverse()) {
    if (op.op === 'building') {
      const b = game.buildings.get(op.id);
      if (b) removeBuilding(game, b, 'undo');
      for (const t of op.tiles) { map.terrain[t.i] = t.terrain; map.rubble[t.i] = t.rubble; restoreRuin(game, t.i, t.ruin); }
    } else if (op.op === 'road') {
      if (map.bridgeLow[op.i]) { map.bridgeLow[op.i] = 0; lowChanged = true; }
      map.road[op.i] = Road.NONE;
      map.terrain[op.i] = op.terrain;
      map.rubble[op.i] = op.rubble;
      restoreRuin(game, op.i, op.ruin);
      map.wall[op.i] = op.wall || Wall.NONE; // a gate cut through a wall becomes wall again
    } else if (op.op === 'wall') {
      map.wall[op.i] = op.wall || Wall.NONE;
      map.terrain[op.i] = op.terrain;
      map.rubble[op.i] = op.rubble;
      restoreRuin(game, op.i, op.ruin);
      game.wallHp.delete(op.i);
    } else if (op.op === 'aqueduct') {
      map.aqueduct[op.i] = 0;
      map.terrain[op.i] = op.terrain;
      map.rubble[op.i] = op.rubble;
      restoreRuin(game, op.i, op.ruin);
    } else if (op.op === 'plaza') {
      map.road[op.i] = Road.ROAD;
    } else if (op.op === 'roadblock') {
      map.roadblock[op.i] = 0;
    }
  }
  if (u.cost > 0) {
    game.city.treasury += u.cost;
    game.city.finance.thisYear.construction = Math.max(0, game.city.finance.thisYear.construction - u.cost);
  }
  game.lastUndo = null;
  if (lowChanged) refreshWaterways(game);
  game.onMapEdited();
  return { ok: true, refund: u.cost };
}

/** Residents a demolition would evict (UI confirmation helper). */
export function houseLabel(b) {
  return b.house ? HOUSE_TIERS[b.house.tier].name : b.def.name;
}

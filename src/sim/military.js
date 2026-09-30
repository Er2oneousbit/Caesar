/**
 * military.js
 * ----------------------------------------------------------------------------
 * Soldiers, raiders, towers, walls and invasions.
 *
 * Supply chain (carts deliver only while forts have empty places)
 *   Weaponsmith (iron)          ---weapons---\
 *   Fletcher (timber + iron)    ---arrows----+--> Barracks --recruit walks by road--> Fort
 *   Horse Ranch (breeding herd) ---horses----/
 *   Warehouses forward stored weapons/arrows/horses to barracks too.
 *   One recruit: legionary 50 weapons, archer 50 arrows, cavalryman 1 horse.
 *
 * Units (both sides) move freely over open land in continuous tile
 * coordinates (tile centers are at .5). Roman soldiers stand on formation
 * spots around their fort (or a rally point the player picks) and engage
 * raiders inside their guard radius. Raiders follow a "flow field": one
 * Dijkstra pass from every building tile gives each land tile the cost to
 * reach the nearest building, so every raider just walks downhill. Walls cost
 * extra in that field, so raiders pick the cheapest place to break through.
 *
 * Invasions are announced ~3 months ahead, then a warband spawns at a map
 * edge that can reach the city's homes. It flees when mostly destroyed, or
 * withdraws (with plunder if it reached the city) after a while, so an
 * undefended city is punished but not wiped out.
 * ----------------------------------------------------------------------------
 */

import { UNIT_TYPES, FORT_CAPACITY, TRAIN_DAYS } from '../data/units.js';
import { RECRUIT_COST, RECRUIT_SOURCE, GOODS } from '../data/goods.js';
import { Terrain, Road, Wall } from '../world/map.js';
import { MinHeap } from '../world/pathfinding.js';
import { INVASION_PRESETS } from '../data/scenarios.js';
import { difficultyOf } from '../data/difficulty.js';
import { spawnWalker, killWalker, STRIDE_WRAP } from './entities.js';
import { followPath } from './movement.js';
import { transact } from './economy.js';
import { igniteBuilding, collapseBuilding } from './risk.js';
import { logGoods } from './goodsLedger.js';

// When a fort has fewer open tiles around its post than soldiers, extra men
// share tiles using these sub-tile offsets.
const SLOT_OFFSETS = [[0, 0], [0.26, -0.26], [-0.26, 0.26], [0.26, 0.26], [-0.26, -0.26]];
// How far from its fort a garrison reacts to raiders (tiles). Deployed troops
// guard def.aggro * 1.5 around their rally point instead.
const GUARD_RADIUS = { legionary: 16, archer: 14, cavalry: 26 };
const WALL_HP = { [Wall.WALL]: 220, [Wall.GATE]: 320 };
const FIELD_WALL_COST = 14; // how much raiders dislike breaking a wall vs walking
const TOWER_RANGE = 8;
const TOWER_DAMAGE = 12;
const TOWER_COOLDOWN = 30; // ticks at full staff
const RAID_MAX_DAYS = 80; // raiders give up and withdraw after this long
const RAID_MAX_LOSSES = 10; // ...or after destroying this many buildings
export const RAID_MIN_POP = 300; // hamlets smaller than this are not worth raiding (the raid is put off)

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Fresh military state for a new game.
 * @param {object} scenario  scenario.military = invasion settings or null;
 *                           scenario.difficulty scales the wait for the first raid
 * @param {GameTime} time
 * @param {object} [flags]   debug flag raids=off|occasional|frequent overrides the scenario
 */
export function newMilitaryState(scenario, time, flags = {}) {
  let settings = scenario.military ? { ...scenario.military } : null;
  if (flags.raids === 'off') settings = null;
  else if (flags.raids && INVASION_PRESETS[flags.raids]) settings = { ...INVASION_PRESETS[flags.raids] };
  const wait = settings ? Math.max(6, Math.round(settings.first * difficultyOf(scenario.difficulty).raidInterval)) : 0;
  return {
    settings,
    nextRaidMonth: settings ? time.totalMonths + wait : null,
    warned: null, // { origin:{x,y}, size, dir }
    active: null, // { id, origin, size, killed, buildingsLost, startDay, fleeing, plundered }
    nextInvasionId: 1,
    lastLossMessageDay: -99,
    lastWallMessageDay: -99,
    demand: { weapons: 0, arrows: 0, horses: 0 }, // see updateDemand()
    lastUpkeep: 0,
    stats: { raids: 0, repelled: 0, enemiesKilled: 0, soldiersLost: 0, buildingsLost: 0, trained: 0 },
  };
}

export class Unit {
  constructor(id, type, x, y) {
    const def = UNIT_TYPES[type];
    if (!def) throw new Error(`Unknown unit type "${type}"`);
    this.id = id;
    this.type = type;
    this.side = def.side;
    this.x = x; // continuous tile coordinates
    this.y = y;
    this.hp = def.hp;
    this.maxHp = def.hp;
    this.cooldown = 0;
    this.state = 'idle';
    this.target = 0; // enemy unit id
    this.fort = 0; // Roman: fort building id
    this.slot = 0; // Roman: formation slot
    this.invasion = 0; // raider: invasion id
    this.path = null; // tile indices when following an A* path
    this.pathIndex = 0;
    this.stuck = 0;
    this.facing = 1; // screen direction for art
    this.moving = false;
    this.strikeTick = -99; // last attack (art swings the weapon)
    this.hitTick = -99; // last time it was hurt (health bar flashes)
    this.ox = 0; // small personal offset so crowds do not stack perfectly
    this.oy = 0;
    this.px = x; // position at the start of the tick (render interpolation)
    this.py = y;
    this.walked = 0; // tiles walked, modulo STRIDE_WRAP (drives the leg animation)
  }
}

/** Create a unit and register it. */
export function spawnUnit(game, type, x, y, init = {}) {
  const u = new Unit(game.nextUnitId++, type, x, y);
  u.ox = (game.rng.next() - 0.5) * 0.5;
  u.oy = (game.rng.next() - 0.5) * 0.5;
  // Tougher raiders on harder difficulties (their attack is scaled in enemyPower()).
  if (u.side === 'enemy') u.hp = u.maxHp = Math.round(u.maxHp * enemyPower(game, u));
  Object.assign(u, init);
  game.units.set(u.id, u);
  return u;
}

/** Remove a unit (death, disbanding, fleeing off the map). */
export function removeUnit(game, u, cause = 'died') {
  if (!game.units.has(u.id)) return;
  game.units.delete(u.id);
  const st = game.military.stats;
  if (cause === 'died') {
    if (u.side === 'enemy') {
      st.enemiesKilled++;
      const inv = game.military.active;
      if (inv && inv.id === u.invasion) inv.killed++;
    } else {
      st.soldiersLost++;
    }
    game.events.emit('unitDied', { x: u.x, y: u.y, side: u.side, type: u.type });
  }
}

export function unitsOfFort(game, fortId) {
  const out = [];
  for (const u of game.units.values()) if (u.fort === fortId) out.push(u);
  return out;
}

export function enemyCount(game) {
  let n = 0;
  for (const u of game.units.values()) if (u.side === 'enemy') n++;
  return n;
}

// ---------------------------------------------------------------------------
// Passability & movement
// ---------------------------------------------------------------------------

function passable(game, side, i) {
  const map = game.map;
  const t = map.terrain[i];
  if (t === Terrain.ROCK) return false;
  if (t === Terrain.WATER && map.road[i] !== Road.BRIDGE) return false;
  if (map.building[i]) return false;
  const w = map.wall[i];
  if (w === Wall.WALL) return false;
  if (w === Wall.GATE && side === 'enemy') return false;
  return true;
}

/** Can the unit step to continuous position (nx, ny)? */
function canEnter(game, u, nx, ny) {
  const map = game.map;
  const tx = Math.floor(nx);
  const ty = Math.floor(ny);
  if (!map.inBounds(tx, ty)) return false;
  if (tx === Math.floor(u.x) && ty === Math.floor(u.y)) return true;
  return passable(game, u.side, map.idx(tx, ty));
}

/**
 * Step toward a point, sliding along obstacles.
 * @returns {boolean} true when (almost) there
 */
function moveToward(game, u, tx, ty, speed) {
  const dx = tx - u.x;
  const dy = ty - u.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.05) {
    u.moving = false;
    return true;
  }
  const step = Math.min(d, speed);
  const nx = u.x + (dx / d) * step;
  const ny = u.y + (dy / d) * step;
  const sdx = dx - dy; // screen-space x direction
  if (Math.abs(sdx) > 0.01) u.facing = sdx > 0 ? 1 : -1;
  u.moving = true;
  if (canEnter(game, u, nx, ny)) {
    u.x = nx;
    u.y = ny;
    u.stuck = 0;
  } else if (Math.abs(dx) > 0.01 && canEnter(game, u, u.x + Math.sign(dx) * step, u.y)) {
    u.x += Math.sign(dx) * step;
    u.stuck++;
  } else if (Math.abs(dy) > 0.01 && canEnter(game, u, u.x, u.y + Math.sign(dy) * step)) {
    u.y += Math.sign(dy) * step;
    u.stuck++;
  } else {
    u.stuck += 2;
    u.moving = false;
  }
  if (u.moving) u.walked = (u.walked + step) % STRIDE_WRAP;
  return false;
}

/** Plan an A* route for a unit to a tile (used when steering gets stuck or for long marches). */
function planPath(game, u, goalX, goalY) {
  const map = game.map;
  let gx = Math.max(0, Math.min(map.w - 1, Math.floor(goalX)));
  let gy = Math.max(0, Math.min(map.h - 1, Math.floor(goalY)));
  // If the goal tile is blocked, aim for the nearest open tile around it.
  if (!passable(game, u.side, map.idx(gx, gy))) {
    let found = false;
    for (let r = 1; r <= 3 && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          const x = gx + dx;
          const y = gy + dy;
          if (map.inBounds(x, y) && passable(game, u.side, map.idx(x, y))) { gx = x; gy = y; found = true; }
        }
      }
    }
    if (!found) return null;
  }
  const start = map.idx(Math.floor(u.x), Math.floor(u.y));
  const cost = (i) => {
    if (!passable(game, u.side, i)) return Infinity;
    if (map.road[i]) return 0.7;
    return map.terrain[i] === Terrain.TREES ? 1.8 : 1;
  };
  return game.pf.astar(start, map.idx(gx, gy), cost, { maxNodes: 9000 });
}

/** Follow u.path; returns true when the path is finished. */
function followUnitPath(game, u, speed) {
  if (!u.path || u.pathIndex >= u.path.length) {
    u.path = null;
    return true;
  }
  const map = game.map;
  const i = u.path[u.pathIndex];
  const last = u.pathIndex === u.path.length - 1;
  const tx = map.xOf(i) + 0.5 + (last ? 0 : u.ox * 0.5);
  const ty = map.yOf(i) + 0.5 + (last ? 0 : u.oy * 0.5);
  if (moveToward(game, u, tx, ty, speed)) u.pathIndex++;
  if (u.stuck > 30) {
    u.path = null; // blocked (something was built on the way): re-plan later
    u.stuck = 0;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Forts & posts
// ---------------------------------------------------------------------------

/** The open tile in front of a fort where its soldiers stand (cached). */
export function fortPost(game, fort) {
  if (fort.post && fort.postRev === game.map.revision) return fort.post;
  const map = game.map;
  const S = fort.size;
  const cands = [];
  for (let d = 0; d < S; d++) {
    cands.push([fort.x + d, fort.y + S], [fort.x + S, fort.y + d], [fort.x + d, fort.y - 1], [fort.x - 1, fort.y + d]);
  }
  let post = { x: fort.x + S / 2, y: fort.y + S + 0.5 };
  for (const [x, y] of cands) {
    if (map.inBounds(x, y) && passable(game, 'rome', map.idx(x, y))) { post = { x: x + 0.5, y: y + 0.5 }; break; }
  }
  fort.post = post;
  fort.postRev = map.revision;
  return post;
}

/** The point a fort's soldiers gather around: its rally point or its parade tile. */
function anchorOf(game, fort) {
  return fort.rally || fortPost(game, fort);
}

/**
 * Standing spots for a fort's soldiers: the open tiles nearest the anchor
 * (breadth-first, so they fill a road or a field naturally instead of
 * poking into buildings). Cached per fort until the map or anchor changes.
 */
function formationSpots(game, fort) {
  const base = anchorOf(game, fort);
  const key = `${game.map.revision}:${base.x},${base.y}`;
  if (!game.formations) game.formations = new Map(); // fort id -> { key, spots } (derived, not saved)
  const hit = game.formations.get(fort.id);
  if (hit && hit.key === key) return hit.spots;
  const map = game.map;
  const bx = Math.floor(base.x);
  const by = Math.floor(base.y);
  const tiles = [];
  if (map.inBounds(bx, by)) {
    // BFS may cross blocked tiles (a rally point inside a building) but only
    // collects open ones, and never strays more than 5 tiles.
    const start = map.idx(bx, by);
    const seen = new Set([start]);
    const queue = [start];
    for (let q = 0; q < queue.length && tiles.length < FORT_CAPACITY; q++) {
      const i = queue[q];
      if (passable(game, 'rome', i)) tiles.push(i);
      const x = map.xOf(i);
      const y = map.yOf(i);
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!map.inBounds(nx, ny) || Math.abs(nx - bx) > 5 || Math.abs(ny - by) > 5) continue;
        const j = map.idx(nx, ny);
        if (!seen.has(j)) { seen.add(j); queue.push(j); }
      }
    }
  }
  const spots = [];
  for (let s = 0; s < FORT_CAPACITY; s++) {
    if (!tiles.length) { spots.push({ x: base.x, y: base.y }); continue; }
    const i = tiles[s % tiles.length];
    const off = SLOT_OFFSETS[Math.floor(s / tiles.length) % SLOT_OFFSETS.length];
    spots.push({ x: map.xOf(i) + 0.5 + off[0], y: map.yOf(i) + 0.5 + off[1] });
  }
  game.formations.set(fort.id, { key, spots });
  return spots;
}

/** Where a soldier should stand right now. */
function postOf(game, u, fort) {
  return formationSpots(game, fort)[u.slot % FORT_CAPACITY];
}

/**
 * A fort was removed (demolished or destroyed by raiders): its soldiers have
 * nowhere to live and disband. Hooked to the 'buildingRemoved' event in Game.
 */
export function disbandFort(game, fort) {
  const men = unitsOfFort(game, fort.id);
  for (const u of men) removeUnit(game, u, 'disbanded');
  if (men.length) game.message(`With the ${fort.def.name} gone, its ${men.length} soldier${men.length === 1 ? '' : 's'} disbanded.`, 'warn', fort.x, fort.y);
}

/** Send a fort's soldiers to a tile (they hold there and defend it). */
export function deployFort(game, fortId, tx, ty) {
  const fort = game.buildings.get(fortId);
  if (!fort || fort.def.kind !== 'fort') return false;
  fort.rally = { x: tx + 0.5, y: ty + 0.5 };
  for (const u of unitsOfFort(game, fortId)) { u.path = null; u.target = 0; u.state = 'march'; }
  return true;
}

/** Bring a fort's soldiers home. */
export function recallFort(game, fortId) {
  const fort = game.buildings.get(fortId);
  if (!fort) return false;
  fort.rally = null;
  for (const u of unitsOfFort(game, fortId)) { u.path = null; u.target = 0; u.state = 'march'; }
  return true;
}

// ---------------------------------------------------------------------------
// Barracks & recruits
// ---------------------------------------------------------------------------

/** What is stopping a barracks right now (for the info panel), or ''. */
export function barracksStatus(game, b) {
  return b.blocked || '';
}

/** Soldiers alive per fort id, in one pass over the units. */
export function garrisonCounts(game) {
  const out = new Map();
  for (const u of game.units.values()) if (u.fort) out.set(u.fort, (out.get(u.fort) || 0) + 1);
  return out;
}

/**
 * Daily: how much of each military input the forts still need to fill their
 * ranks (weapons/arrows/horses, in units). Cached on game.military.demand.
 */
export function updateDemand(game) {
  const demand = { weapons: 0, arrows: 0, horses: 0 };
  const counts = garrisonCounts(game);
  for (const f of game.buildings.values()) {
    if (f.def.kind !== 'fort') continue;
    const room = FORT_CAPACITY - (counts.get(f.id) || 0) - (f.recruiting || 0);
    if (room <= 0) continue;
    for (const [good, n] of Object.entries(RECRUIT_COST[f.def.unit] || {})) demand[good] = (demand[good] || 0) + n * room;
  }
  game.military.demand = demand;
  return demand;
}

/**
 * Units of a military input that should still go to barracks: what the forts
 * need minus what barracks already hold or have on the way. 0 = send goods to
 * warehouses instead (so the barracks never hoards export weapons).
 */
export function militaryNeed(game, good) {
  const want = game.military?.demand?.[good] || 0;
  if (want <= 0) return 0;
  let held = 0;
  for (const b of game.buildings.values()) {
    if (b.def.kind === 'barracks') held += (b.stock[good] || 0) + (b.incoming[good] || 0);
  }
  return Math.max(0, want - held);
}

/** Can this barracks take `amount` more of a good right now? */
export function barracksHasRoom(b, good, amount) {
  return b.def.kind === 'barracks' && b.efficiency > 0 && b.stock[good] !== undefined
    && b.stock[good] + b.incoming[good] + amount <= b.def.inputCap;
}

/** Daily: train a recruit and send him to the fort that needs one most. */
export function updateBarracks(game, b) {
  if (b.trainProgress === undefined) b.trainProgress = 0;
  if (b.efficiency <= 0 || b.accessRoad < 0) {
    b.blocked = b.accessRoad < 0 ? 'No road access.' : 'No workers.';
    return;
  }
  if (b.trainProgress < 100) b.trainProgress = Math.min(100, b.trainProgress + (b.efficiency * 100) / TRAIN_DAYS);
  if (b.trainProgress < 100) { b.blocked = ''; return; }

  // Forts that still have room, emptiest first.
  const counts = garrisonCounts(game);
  const forts = [];
  for (const f of game.buildings.values()) {
    if (f.def.kind !== 'fort' || f.efficiency <= 0 || f.accessRoad < 0) continue;
    const have = (counts.get(f.id) || 0) + (f.recruiting || 0);
    if (have < FORT_CAPACITY) forts.push({ f, fill: have / FORT_CAPACITY });
  }
  if (!forts.length) { b.blocked = 'All staffed forts are fully manned.'; return; }
  forts.sort((a, c) => a.fill - c.fill);
  const missing = new Set();
  for (const { f } of forts) {
    const cost = RECRUIT_COST[f.def.unit] || {};
    const ok = Object.entries(cost).every(([good, n]) => (b.stock[good] || 0) >= n);
    if (!ok) { for (const good of Object.keys(cost)) missing.add(good); continue; }
    const path = game.pf.roadPath(b.accessRoad, f.accessRoad);
    if (!path) continue;
    for (const [good, n] of Object.entries(cost)) b.stock[good] -= n;
    f.recruiting = (f.recruiting || 0) + 1;
    const w = spawnWalker(game, 'recruit', b.accessRoad, b, { target: f.id, state: 'toFort', reserve: { id: f.id, recruit: 1 }, unitType: f.def.unit });
    if (!w) { f.recruiting--; for (const [good, n] of Object.entries(cost)) b.stock[good] += n; return; }
    for (const [good, n] of Object.entries(cost)) logGoods(game, good, 'used', n);
    followPath(game, w, path);
    b.trainProgress = 0;
    b.blocked = '';
    game.military.stats.trained++;
    return;
  }
  b.blocked = missing.size
    ? `Waiting for ${[...missing].map((g) => `${GOODS[g].name.toLowerCase()} (${RECRUIT_SOURCE[g]})`).join(' or ')}.`
    : 'No road route to a fort.';
}

/** A recruit reached his fort: he becomes a soldier. */
export function recruitArrive(game, w) {
  const fort = game.buildings.get(w.target);
  if (fort && fort.def.kind === 'fort') {
    const used = new Set(unitsOfFort(game, fort.id).map((u) => u.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    if (slot < FORT_CAPACITY) {
      // The recruit steps off the road as a soldier and marches to his post.
      spawnUnit(game, fort.def.unit, w.x + 0.5, w.y + 0.5, { fort: fort.id, slot, state: 'march' });
      game.events.emit('sound', { name: 'recruit' });
    }
  }
  killWalker(game, w); // releases the fort's "recruiting" reservation
}

// ---------------------------------------------------------------------------
// Buildings & walls under attack
// ---------------------------------------------------------------------------

export function buildingMaxHp(b) {
  if (b.def.hp) return b.def.hp;
  return (b.house ? 45 : 80) * b.size * b.size;
}

function damageBuilding(game, b, dmg) {
  if (b.hp === undefined) b.hp = buildingMaxHp(b);
  b.hp -= dmg;
  b.lastRaided = game.time.totalDays;
  const inv = game.military.active;
  if (inv) inv.reached = true; // the warband made it to the city: plunder is possible
  if (b.hp > 0) return;
  if (inv) inv.buildingsLost++;
  game.military.stats.buildingsLost++;
  game.city.ratings.peace = Math.max(0, game.city.ratings.peace - 1);
  const now = game.time.totalDays;
  const loud = now - game.military.lastLossMessageDay >= 4;
  if (loud) game.military.lastLossMessageDay = now;
  // Raiders torch most of what they break.
  if (game.rng.chance(0.6) && (b.house ? b.house.tier > 0 : b.def.fire > 0)) igniteBuilding(game, b, loud ? 'raid' : 'raidQuiet');
  else collapseBuilding(game, b, loud ? 'raid' : 'raidQuiet');
}

function damageWall(game, i, dmg) {
  const map = game.map;
  const kind = map.wall[i];
  if (!kind) return;
  const hp = (game.wallHp.get(i) ?? WALL_HP[kind]) - dmg;
  if (hp > 0) { game.wallHp.set(i, hp); return; }
  game.wallHp.delete(i);
  map.wall[i] = Wall.NONE;
  if (!map.road[i]) map.rubble[i] = 1;
  map.touch();
  const now = game.time.totalDays;
  if (now - game.military.lastWallMessageDay >= 5) {
    game.military.lastWallMessageDay = now;
    game.message(kind === Wall.GATE ? 'Raiders have smashed a gate!' : 'Raiders have broken through a wall!', 'bad', map.xOf(i), map.yOf(i));
  }
  game.events.emit('collapse', { x: map.xOf(i), y: map.yOf(i), size: 1 });
}

export function wallHpOf(game, i) {
  const kind = game.map.wall[i];
  if (!kind) return { hp: 0, max: 0 };
  return { hp: game.wallHp.get(i) ?? WALL_HP[kind], max: WALL_HP[kind] };
}

// ---------------------------------------------------------------------------
// Raider flow field
// ---------------------------------------------------------------------------

/** Dijkstra from every building tile: cost for a raider to reach a building. */
function computeField(game) {
  const map = game.map;
  let field = game.enemyField;
  if (!field || field.length !== map.size) field = game.enemyField = new Float32Array(map.size);
  fillField(game, field, () => true);
  game.enemyFieldRev = map.revision;
  game.enemyFieldTick = game.time.totalTicks;
}

/**
 * Raider travel cost from each tile to the nearest building for which
 * isSource(buildingId) is true (0 on those buildings, Infinity if cut off).
 */
function fillField(game, field, isSource) {
  const map = game.map;
  const n = map.size;
  field.fill(Infinity);
  const heap = new MinHeap(4096);
  for (let i = 0; i < n; i++) {
    if (map.building[i] && isSource(map.building[i])) { field[i] = 0; heap.push(0, i); }
  }
  const w = map.w;
  while (heap.length) {
    const i = heap.pop();
    const d = field[i];
    const x = i % w;
    const y = (i / w) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 1 ? 1 : k === 3 ? -1 : 0);
      const ny = y + (k === 0 ? -1 : k === 2 ? 1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= map.h) continue;
      const j = ny * w + nx;
      if (map.building[j]) continue;
      const t = map.terrain[j];
      if (t === Terrain.ROCK) continue;
      if (t === Terrain.WATER && map.road[j] !== Road.BRIDGE) continue;
      let c = t === Terrain.TREES ? 1.6 : 1;
      if (map.wall[j]) c += FIELD_WALL_COST;
      const nd = d + c;
      if (nd < field[j]) { field[j] = nd; heap.push(nd, j); }
    }
  }
}

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

/** Strength multiplier for a unit: raiders scale with difficulty, Rome's soldiers never do. */
function enemyPower(game, u) {
  return u.side === 'enemy' ? game.difficulty.enemy : 1;
}

function rollDamage(game, attDef, tgtDef, power = 1) {
  const raw = attDef.attack * power * (0.75 + game.rng.next() * 0.5) - tgtDef.defense * 0.5;
  return Math.max(2, raw);
}

function hurt(game, target, dmg) {
  target.hp -= dmg;
  target.hitTick = game.time.totalTicks;
  if (target.hp <= 0) removeUnit(game, target, 'died');
}

/** Melee hit or launch a missile at another unit. */
function attackUnit(game, u, def, target) {
  u.strikeTick = game.time.totalTicks;
  u.cooldown = def.cooldown;
  const sdx = (target.x - u.x) - (target.y - u.y);
  if (Math.abs(sdx) > 0.01) u.facing = sdx > 0 ? 1 : -1;
  const dmg = rollDamage(game, def, UNIT_TYPES[target.type], enemyPower(game, u));
  if (def.ranged) {
    game.projectiles.push({ x: u.x, y: u.y, z: 10, target: target.id, damage: dmg, speed: 0.4, kind: u.side === 'enemy' ? 'stone' : 'arrow', life: 60 });
    game.events.emit('sound', { name: 'arrow' });
  } else {
    hurt(game, target, dmg);
    game.events.emit('sound', { name: 'clash' });
  }
}

/** Nearest hostile unit within `range` of (x, y). */
function nearestHostile(list, x, y, range) {
  let best = null;
  let bestD = range;
  for (const e of list) {
    const d = Math.hypot(e.x - x, e.y - y);
    if (d > bestD) continue;
    best = e;
    bestD = d;
  }
  return best;
}

/**
 * A soldier's choice of raider: anyone threatening his post (within `guard`
 * of the anchor) or right next to him (within his aggro), but never one that
 * would lure him more than guard + 4 tiles away. Raiders already fought by
 * several soldiers count as farther away, so a squad spreads its attacks.
 */
function pickTarget(enemies, u, def, anchor, guard) {
  let best = null;
  let bestScore = Infinity;
  for (const e of enemies) {
    if (u.ignore && u.ignore.includes(e.id)) continue;
    const dAnchor = Math.hypot(e.x - anchor.x, e.y - anchor.y);
    if (dAnchor > guard + 4) continue;
    const d = Math.hypot(e.x - u.x, e.y - u.y);
    if (dAnchor > guard && d > def.aggro) continue;
    const score = d + (e.pressure || 0) * 0.8;
    if (score < bestScore) { bestScore = score; best = e; }
  }
  return best;
}

function updateRoman(game, u, enemies) {
  const def = UNIT_TYPES[u.type];
  const fort = game.buildings.get(u.fort);
  if (!fort) { removeUnit(game, u, 'disbanded'); return; }
  if (u.noPath > 0) u.noPath--;
  if (u.ignore && game.time.totalTicks > u.ignoreUntil) u.ignore = null;
  const post = postOf(game, u, fort);
  const anchor = anchorOf(game, fort);
  const guard = fort.rally ? def.aggro * 1.5 : GUARD_RADIUS[u.type] || def.aggro;
  let target = u.target ? game.units.get(u.target) : null;
  if (target && (target.side !== 'enemy' || Math.hypot(target.x - anchor.x, target.y - anchor.y) > guard + 4)) target = null;
  if ((game.time.totalTicks + u.id) % 6 === 0 || !target) {
    const pick = pickTarget(enemies, u, def, anchor, guard);
    if (pick !== target) {
      if (target) target.pressure = Math.max(0, (target.pressure || 0) - 1);
      if (pick) pick.pressure = (pick.pressure || 0) + 1;
      if (pick || !target) target = pick;
    }
  }
  u.target = target ? target.id : 0;

  if (target) {
    u.state = 'engage';
    const d = Math.hypot(target.x - u.x, target.y - u.y);
    if (d <= def.range) {
      u.moving = false;
      u.path = null;
      if (u.cooldown <= 0) attackUnit(game, u, def, target);
      return;
    }
    if (u.path) { followUnitPath(game, u, def.speed); return; }
    moveToward(game, u, target.x, target.y, def.speed);
    if (u.stuck > 20) {
      replan(game, u, target.x, target.y);
      if (!u.path) {
        // No way to get at this raider (other river bank...): ignore him for a while.
        (u.ignore ||= []).push(target.id);
        u.ignoreUntil = game.time.totalTicks + 400;
        target.pressure = Math.max(0, (target.pressure || 0) - 1);
        u.target = 0;
      }
    }
    return;
  }
  // No enemy: go to (or stay at) the post.
  const d = Math.hypot(post.x - u.x, post.y - u.y);
  // Close enough, or as close as the terrain allows (post slot blocked).
  if (d < 0.15 || (d < 1.2 && u.stuck > 10)) { u.state = 'idle'; u.moving = false; u.path = null; u.stuck = 0; return; }
  u.state = 'march';
  if (u.path) { followUnitPath(game, u, def.speed); return; }
  if (d > 5 && u.stuck === 0 && !u.noPath) {
    replan(game, u, post.x, post.y);
    if (u.path) return;
  }
  moveToward(game, u, post.x, post.y, def.speed);
  if (u.stuck > 20) replan(game, u, post.x, post.y);
}

/** Plan an A* route, remembering failures for a while so we do not retry every tick. */
function replan(game, u, x, y) {
  u.stuck = 0;
  if (u.noPath > 0) return;
  u.path = planPath(game, u, x, y);
  u.pathIndex = 0;
  if (!u.path) u.noPath = 60;
}

function updateRaider(game, u, romans) {
  const def = UNIT_TYPES[u.type];
  const map = game.map;
  const inv = game.military.active;
  if (!inv || inv.id !== u.invasion || inv.fleeing) {
    // Run for the map edge and vanish there.
    u.state = 'flee';
    const o = inv && inv.id === u.invasion ? inv.origin : { x: u.x < map.w / 2 ? 0 : map.w - 1, y: u.y };
    moveToward(game, u, o.x + 0.5, o.y + 0.5, def.speed * 1.1);
    const edge = u.x < 1.5 || u.y < 1.5 || u.x > map.w - 1.5 || u.y > map.h - 1.5;
    if (edge || u.stuck > 60) removeUnit(game, u, 'fled');
    return;
  }
  // Fight soldiers who come close.
  let target = u.target ? game.units.get(u.target) : null;
  if (target && Math.hypot(target.x - u.x, target.y - u.y) > def.aggro * 1.6) target = null;
  if ((game.time.totalTicks + u.id) % 6 === 0 || !target) target = nearestHostile(romans, u.x, u.y, def.aggro) || target;
  u.target = target ? target.id : 0;
  if (target) {
    u.state = 'fight';
    const d = Math.hypot(target.x - u.x, target.y - u.y);
    if (d <= def.range) { u.moving = false; if (u.cooldown <= 0) attackUnit(game, u, def, target); return; }
    moveToward(game, u, target.x, target.y, def.speed);
    return;
  }
  // Otherwise head for the nearest building via the flow field.
  const tx = Math.floor(u.x);
  const ty = Math.floor(u.y);
  const here = map.idx(tx, ty);
  const field = game.enemyField;
  let best = -1;
  let bestV = field[here];
  let bestKind = null; // 'building' | 'wall' | 'move'
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const nx = tx + dx;
    const ny = ty + dy;
    if (!map.inBounds(nx, ny)) continue;
    const j = map.idx(nx, ny);
    if (map.building[j]) {
      // Adjacent building: attack it right away.
      best = j;
      bestKind = 'building';
      break;
    }
    if (dx !== 0 && dy !== 0) continue; // walk orthogonally, but strike diagonally
    if (field[j] < bestV) { bestV = field[j]; best = j; bestKind = map.wall[j] ? 'wall' : 'move'; }
  }
  if (best < 0) {
    // Nothing reachable to attack from here (cut off by water or walls with
    // no weak spot): wait. militaryDaily() withdraws a warband stuck like this.
    u.state = 'camp';
    u.moving = false;
    return;
  }
  if (bestKind === 'building' || bestKind === 'wall') {
    u.state = 'siege';
    u.moving = false;
    const sdx = (map.xOf(best) - tx) - (map.yOf(best) - ty);
    if (sdx !== 0) u.facing = sdx > 0 ? 1 : -1;
    if (u.cooldown <= 0) {
      u.cooldown = def.cooldown;
      u.strikeTick = game.time.totalTicks;
      const dmg = def.siege * enemyPower(game, u) * (0.75 + game.rng.next() * 0.5);
      if (bestKind === 'wall') damageWall(game, best, dmg);
      else {
        const b = game.buildings.get(map.building[best]);
        if (b) damageBuilding(game, b, dmg);
      }
    }
    return;
  }
  u.state = 'advance';
  moveToward(game, u, map.xOf(best) + 0.5 + u.ox, map.yOf(best) + 0.5 + u.oy, def.speed);
}

function updateProjectiles(game) {
  if (!game.projectiles.length) return;
  const keep = [];
  for (const p of game.projectiles) {
    const t = game.units.get(p.target);
    if (!t) continue; // target gone: the missile falls harmlessly
    const dx = t.x - p.x;
    const dy = t.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d <= p.speed || --p.life <= 0) {
      if (d <= 1) hurt(game, t, p.damage);
      continue;
    }
    p.vx = (dx / d) * p.speed; // kept for the renderer (arrow direction)
    p.vy = (dy / d) * p.speed;
    p.x += p.vx;
    p.y += p.vy;
    p.z = Math.max(2, p.z * 0.97);
    keep.push(p);
  }
  game.projectiles = keep;
}

function updateTowers(game, enemies) {
  if (!enemies.length) return;
  for (const b of game.buildings.values()) {
    if (b.def.kind !== 'tower' || b.efficiency <= 0) continue;
    if (b.shotTimer > 0) { b.shotTimer--; continue; }
    const cx = b.x + b.size / 2;
    const cy = b.y + b.size / 2;
    const target = nearestHostile(enemies, cx, cy, TOWER_RANGE);
    if (!target) continue;
    b.shotTimer = Math.round(TOWER_COOLDOWN / b.efficiency);
    game.projectiles.push({ x: cx, y: cy, z: 38, target: target.id, damage: TOWER_DAMAGE * (0.8 + game.rng.next() * 0.4), speed: 0.45, kind: 'arrow', life: 60 });
  }
}

/** Per tick: move and fight. Cheap when there is nobody around. */
export function updateMilitary(game) {
  if (game.units.size === 0 && game.projectiles.length === 0) return;
  const romans = [];
  const enemies = [];
  for (const u of game.units.values()) {
    u.px = u.x; // previous position: the renderer interpolates between ticks
    u.py = u.y;
    (u.side === 'enemy' ? enemies : romans).push(u);
  }
  // pressure = how many soldiers are on each raider (pickTarget spreads attacks)
  for (const e of enemies) e.pressure = 0;
  for (const u of romans) {
    const t = u.target ? game.units.get(u.target) : null;
    if (t) t.pressure++;
  }
  if (enemies.length) {
    const stale = game.enemyFieldRev !== game.map.revision && game.time.totalTicks - (game.enemyFieldTick || 0) > 20;
    if (!game.enemyField || stale || game.time.totalTicks - (game.enemyFieldTick || 0) > 200) computeField(game);
  }
  for (const u of romans) {
    if (!game.units.has(u.id)) continue;
    if (u.cooldown > 0) u.cooldown--;
    updateRoman(game, u, enemies);
  }
  for (const u of enemies) {
    if (!game.units.has(u.id)) continue;
    if (u.cooldown > 0) u.cooldown--;
    updateRaider(game, u, romans);
  }
  updateTowers(game, enemies.filter((e) => game.units.has(e.id)));
  updateProjectiles(game);
}

// ---------------------------------------------------------------------------
// Invasions
// ---------------------------------------------------------------------------

const DIRS = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];

/** Compass direction of a tile as seen on screen from the map center. */
export function screenDirection(map, x, y) {
  const cx = map.w / 2;
  const cy = map.h / 2;
  const sx = (x - y) - (cx - cy);
  const sy = (x + y) - (cx + cy);
  const a = Math.atan2(-sy, sx); // screen up = north
  const k = Math.round(a / (Math.PI / 4));
  return DIRS[(k + 8) % 8];
}

/**
 * Pick a land tile on the map edge from which raiders can actually walk to
 * the city's homes (not just an outlying farm across a river), preferring
 * edges far from the city center. Falls back to the imperial road entry.
 */
function pickRaidOrigin(game) {
  const map = game.map;
  const field = new Float32Array(map.size);
  fillField(game, field, (id) => !!game.buildings.get(id)?.house);
  let cx = map.w / 2;
  let cy = map.h / 2;
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (const b of game.buildings.values()) { sx += b.x; sy += b.y; n++; }
  if (n) { cx = sx / n; cy = sy / n; }
  let best = null;
  let bestScore = -Infinity;
  const consider = (x, y) => {
    const i = map.idx(x, y);
    if (!passable(game, 'enemy', i)) return;
    if (!field || !Number.isFinite(field[i])) return; // cut off from the city (far river bank...)
    const score = Math.hypot(x - cx, y - cy) + game.rng.next() * 12;
    if (score > bestScore) { bestScore = score; best = { x, y }; }
  };
  for (let k = 0; k < map.w; k += 2) { consider(k, 0); consider(k, map.h - 1); }
  for (let k = 1; k < map.h - 1; k += 2) { consider(0, k); consider(map.w - 1, k); }
  return best || { x: map.entry.x, y: map.entry.y };
}

/** How many raiders the next warband brings. */
export function raidSize(game) {
  const s = game.military.settings;
  const base = s ? s.base : 5;
  const n = Math.round((base + game.city.population / 450 + (game.military.stats.raids || 0)) * game.difficulty.raidSize);
  return Math.max(3, Math.min(40, n));
}

/** Monthly: pay the army, warn about raids, launch them. */
export function militaryMonthly(game) {
  const m = game.military;
  let upkeep = 0;
  for (const u of game.units.values()) if (u.side === 'rome') upkeep += UNIT_TYPES[u.type].upkeep;
  if (upkeep > 0) transact(game, 'military', -upkeep);
  m.lastUpkeep = upkeep;

  if (!m.settings || m.nextRaidMonth === null || m.active) return;
  const now = game.time.totalMonths;
  if (game.city.population < RAID_MIN_POP) {
    // Nothing worth raiding yet: push the date back.
    if (now >= m.nextRaidMonth - 3) {
      m.nextRaidMonth = now + 6;
      if (m.warned) game.message('Scouts report the warband has drifted away, for now.', 'info');
      m.warned = null;
    }
    return;
  }
  if (!m.warned && now >= m.nextRaidMonth - 3) {
    const origin = pickRaidOrigin(game);
    m.warned = { origin, size: raidSize(game), dir: screenDirection(game.map, origin.x, origin.y) };
    game.message(`Scouts report a warband of about ${m.warned.size} raiders gathering to the ${m.warned.dir}. They will strike in about 3 months. Train soldiers and man your towers!`, 'warn', origin.x, origin.y);
    game.events.emit('sound', { name: 'horn' });
  } else if (m.warned && now >= m.nextRaidMonth) {
    launchInvasion(game, m.warned.origin, m.warned.size);
  }
}

/** Spawn a warband now. Returns the invasion record. */
export function launchInvasion(game, origin, size) {
  const m = game.military;
  const map = game.map;
  if (!origin) origin = pickRaidOrigin(game);
  size = Math.max(1, size || raidSize(game));
  const inv = { id: m.nextInvasionId++, origin, size, killed: 0, buildingsLost: 0, startDay: game.time.totalDays, fleeing: false, reached: false };
  m.active = inv;
  m.warned = null;
  m.stats.raids++;
  const pop = game.city.population;
  for (let k = 0; k < size; k++) {
    let type = 'raider';
    const roll = game.rng.next();
    if (pop >= 1200 && roll < 0.22) type = 'horseman';
    else if (pop >= 700 && roll > 0.8) type = 'slinger';
    // Scatter around the origin on land.
    let x = origin.x;
    let y = origin.y;
    for (let t = 0; t < 12; t++) {
      const tx = origin.x + game.rng.range(-3, 3);
      const ty = origin.y + game.rng.range(-3, 3);
      if (map.inBounds(tx, ty) && passable(game, 'enemy', map.idx(tx, ty))) { x = tx; y = ty; break; }
    }
    spawnUnit(game, type, x + 0.5, y + 0.5, { invasion: inv.id, state: 'advance' });
  }
  computeField(game);
  game.message(`Raiders are attacking from the ${screenDirection(map, origin.x, origin.y)}! (${size} warriors)`, 'bad', origin.x, origin.y);
  game.events.emit('sound', { name: 'horn' });
  game.events.emit('invasion', inv);
  return inv;
}

/** Daily: raid progress, retreat and aftermath; buildings slowly repair. */
export function militaryDaily(game) {
  const m = game.military;
  updateDemand(game);
  const inv = m.active;
  if (inv) {
    let alive = 0;
    let camped = 0;
    for (const u of game.units.values()) {
      if (u.side !== 'enemy' || u.invasion !== inv.id) continue;
      alive++;
      if (u.state === 'camp') camped++;
    }
    // Everyone left is cut off from the city for a few days: give up.
    inv.campDays = alive > 0 && camped === alive ? (inv.campDays || 0) + 1 : 0;
    const days = game.time.totalDays - inv.startDay;
    if (alive === 0) {
      endInvasion(game, inv);
    } else if (!inv.fleeing) {
      if (inv.killed > 0 && alive <= Math.ceil(inv.size * 0.3)) {
        inv.fleeing = true;
        inv.repelled = true;
        game.message('The raiders are fleeing! Your soldiers have broken the warband.', 'good');
      } else if (days > RAID_MAX_DAYS || inv.buildingsLost >= RAID_MAX_LOSSES || inv.campDays >= 4) {
        inv.fleeing = true;
        // Only a warband that reached the city carries anything off:
        // up to 15% of the treasury, about 60 Dn per surviving raider.
        const loot = inv.reached ? Math.min(Math.max(0, Math.round(game.city.treasury * 0.15)), alive * 60) : 0;
        if (loot > 0) transact(game, 'plunder', -loot);
        inv.plundered = loot;
        if (loot > 0) game.message(`The raiders withdraw with ${loot} Dn of plunder. Build forts and towers before they return.`, 'bad');
        else game.message('The raiders give up and withdraw.', 'info');
      }
    }
  }
  // Damaged buildings are patched up slowly once the fighting stops.
  if (!inv) {
    for (const b of game.buildings.values()) {
      if (b.hp !== undefined && b.hp < buildingMaxHp(b) && game.time.totalDays - (b.lastRaided || 0) > 5) {
        b.hp = Math.min(buildingMaxHp(b), b.hp + buildingMaxHp(b) * 0.05);
      }
    }
  }
}

function endInvasion(game, inv) {
  const m = game.military;
  const r = game.city.ratings;
  if (inv.repelled || inv.killed >= inv.size * 0.7) {
    m.stats.repelled++;
    r.peace = Math.min(100, r.peace + 8);
    r.favor = Math.min(100, r.favor + 3);
    game.message(`The warband is gone: ${inv.killed} raiders slain. The province is safe for now.`, 'good');
    game.events.emit('sound', { name: 'fanfare' });
  } else if (inv.buildingsLost >= 5) {
    r.peace = Math.max(0, r.peace - 5);
    r.favor = Math.max(0, r.favor - 3);
  }
  m.active = null;
  const s = m.settings;
  if (s) {
    const k = game.difficulty.raidInterval;
    const [a, b] = s.interval;
    m.nextRaidMonth = game.time.totalMonths + game.rng.range(Math.max(4, Math.round(a * k)), Math.max(5, Math.round(b * k)));
  }
  game.projectiles = [];
}

/** Summary for the advisor and HUD. */
export function threatSummary(game) {
  const m = game.military;
  const enemies = enemyCount(game);
  if (enemies > 0) return { level: 'attack', text: `${enemies} raiders in the province`, enemies };
  if (m.warned) {
    const months = Math.max(0, m.nextRaidMonth - game.time.totalMonths);
    return { level: 'warned', text: `About ${m.warned.size} raiders expected from the ${m.warned.dir} in ~${months} months`, enemies: 0 };
  }
  if (!m.settings) return { level: 'none', text: 'No raids in this province.', enemies: 0 };
  return { level: 'calm', text: 'No known threats.', enemies: 0 };
}

export { WALL_HP, TOWER_RANGE, TOWER_COOLDOWN };

/**
 * navy.js
 * ----------------------------------------------------------------------------
 * Sea raids and the provincial fleet. Not in the original, which had no war
 * at sea; modelled on Rome's provincial fleets and their light warship, the
 * liburnian (two banks of oars, a bronze ram, a square sail).
 *
 * Sea raids (the Sea raids switch: game.military.seaRaids)
 *   Where navigable water reaches the sea entry, each raid comes by sea with
 *   chance SEA_RAID_SHARE, rolled when the scouts see it on a stream of its
 *   own (seeded by the map seed and the raid's number), so a raid that comes
 *   by land draws exactly what it always did. It needs a landing (findLanding):
 *   open shore beside that water, from which raiders can walk to a home, the
 *   walk to the nearest home as close to LANDING_WALK as can be.
 *
 *   Raider ships (units, `naval`) carry the warband, RAID_SHIP_CREW a ship,
 *   from the sea entry to the water by the landing, set out one after another,
 *   and put their raiders ashore there: from then on they are ordinary raiders
 *   (sim/military.js), and the raid's days count from the first landing. The
 *   ships wait offshore; when the raid ends they sail back out and leave. A
 *   warband that flees runs back to its landing and boards while a ship of
 *   its own is afloat. While at sea a ship shoots arrows at liburnians in
 *   range, and throws fire pots (RAID_SHIP_POTS a ship, none while leaving)
 *   at fishing boats (they sink) and at buildings by the shore (damage and
 *   fire risk). A sunk ship drowns the raiders still aboard.
 *
 * The fleet (like the barracks and its forts)
 *   Navalia ---liburnian sails by water---> Naval Station (4 berths)
 *   The Navalia builds a liburnian from LIBURNIAN_COST (timber, iron, linen,
 *   brought by cart while a staffed station has an empty berth), in
 *   NAVALIA_BUILD_DAYS at full staff, only while it holds the materials and a
 *   staffed station on its water has room; the ship belongs to the emptiest
 *   such station from its launch. A squadron holds its berths (the water
 *   beside its station) and fights raider ships within STATION_GUARD of them,
 *   or within STATION_GUARD_DEPLOYED of the spot on its water where the player
 *   deployed it, chasing at most STATION_CHASE farther. Liburnians shoot and
 *   ram; they never leave their own water (map.navBody).
 *   A station that is lost sends its ships to another station on the same
 *   water with room; the rest are laid up (gone), like a lost fort's men.
 *
 * Ships move in continuous tile coordinates like soldiers: straight at their
 * goal while the water between is clear, else along an A* route over their
 * water (re-planned now and then while chasing a moving ship).
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { UNIT_TYPES, STATION_CAPACITY, RAM_REACH, RAM_COOLDOWN } from '../data/units.js';
import { GOODS } from '../data/goods.js';
import { Terrain } from '../world/map.js';
import { RNG } from '../core/rng.js';
import { spawnUnit, removeUnit, passable, fillField, computeField, damageBuilding, enemyPower, rollDamage, hurt, screenDirection, warbandType, unitDefense } from './military.js';
import { portusFor, startDrill, endDrill, drilled, trainsNow } from './training.js';
import { awayCounts, awayOf, leaveForBattle, dropAway, postsAway, takesNewMen, AWAY_MAX_TICKS } from './battle.js';
import { dockBerth } from './trade.js';
import { killWalker, STRIDE_WRAP } from './entities.js';
import { riskRates } from './risk.js';
import { logGoods } from './goodsLedger.js';

/** When there are fewer water tiles than ships at a spot, ships share tiles with these offsets. */
const SHARE_OFFSETS = [[0, 0], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3], [-0.3, -0.3]];
/** A raider ship that found nothing to shoot at looks again this many ticks later. */
const LOOK_AGAIN_TICKS = 10;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function isShip(u) {
  return !!UNIT_TYPES[u.type]?.naval;
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

/** Tile index under a continuous position (clamped to the map). */
function tileAt(map, x, y) {
  return map.idx(Math.max(0, Math.min(map.w - 1, Math.floor(x))), Math.max(0, Math.min(map.h - 1, Math.floor(y))));
}

/** Water route between two tiles of the same navigable water (ships pass under bridges), or null. */
export function waterPath(game, from, to) {
  const body = game.map.navBody;
  const b = body[from];
  if (!b || body[to] !== b) return null;
  return game.pf.astar(from, to, (i) => (body[i] === b ? 1 : Infinity), { maxNodes: game.map.size * 4 });
}

/** Up to `n` tiles of the same navigable water around tile `start`, nearest first (breadth first, at most `r` tiles away). */
function waterAround(map, start, n, r = 4) {
  const body = map.navBody[start];
  if (!body) return [];
  const sx = map.xOf(start);
  const sy = map.yOf(start);
  const out = [];
  const seen = new Set([start]);
  const queue = [start];
  for (let q = 0; q < queue.length && out.length < n; q++) {
    const i = queue[q];
    out.push(i);
    const x = map.xOf(i);
    const y = map.yOf(i);
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!map.inBounds(nx, ny) || Math.abs(nx - sx) > r || Math.abs(ny - sy) > r) continue;
      const j = map.idx(nx, ny);
      if (!seen.has(j) && map.navBody[j] === body) { seen.add(j); queue.push(j); }
    }
  }
  return out;
}

/** The tile of navigable water `body` nearest to (x, y) within `r` tiles, or -1. */
function nearestWater(map, x, y, body, r = 2) {
  let best = -1;
  let bestD = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!map.inBounds(tx, ty)) continue;
      const i = map.idx(tx, ty);
      if (map.navBody[i] !== body) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  return best;
}

/**
 * Is the straight line between two points on water of `body` all the way?
 * Every tile it crosses is checked (a grid walk, not samples, which could
 * skip the corner of a bank and let a ship row onto land); where it passes
 * exactly through a corner, both tiles beside it must be water.
 */
function clearWater(map, body, x0, y0, x1, y1) {
  const water = (x, y) => map.inBounds(x, y) && map.navBody[map.idx(x, y)] === body;
  let x = Math.floor(x0);
  let y = Math.floor(y0);
  const xe = Math.floor(x1);
  const ye = Math.floor(y1);
  if (!water(x, y)) return false;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const tdx = dx ? Math.abs(1 / dx) : Infinity;
  const tdy = dy ? Math.abs(1 / dy) : Infinity;
  let tx = dx > 0 ? (x + 1 - x0) / dx : dx < 0 ? (x0 - x) / -dx : Infinity;
  let ty = dy > 0 ? (y + 1 - y0) / dy : dy < 0 ? (y0 - y) / -dy : Infinity;
  for (let n = Math.abs(xe - x) + Math.abs(ye - y) + 2; n > 0 && (x !== xe || y !== ye); n--) {
    if (Math.abs(tx - ty) < 1e-9) {
      if (!water(x + sx, y) || !water(x, y + sy)) return false;
      x += sx;
      y += sy;
      tx += tdx;
      ty += tdy;
    } else if (tx < ty) {
      x += sx;
      tx += tdx;
    } else {
      y += sy;
      ty += tdy;
    }
    if (!water(x, y)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Moving ships
// ---------------------------------------------------------------------------

/** One step toward a point (no checks: callers know the way is water). @returns {boolean} arrived */
function stepToward(u, tx, ty, speed) {
  const dx = tx - u.x;
  const dy = ty - u.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.05) { u.moving = false; return true; }
  const step = Math.min(d, speed);
  u.x += (dx / d) * step;
  u.y += (dy / d) * step;
  const sdx = dx - dy; // screen-space x direction
  if (Math.abs(sdx) > 0.01) u.facing = sdx > 0 ? 1 : -1;
  u.moving = true;
  u.walked = (u.walked + step) % STRIDE_WRAP; // the oars stroke with the distance rowed
  return false;
}

/** Follow u.path (tile indices). @returns {boolean} true when the route is done (or there is none) */
function followWaterPath(game, u, speed) {
  if (!u.path || u.pathIndex >= u.path.length) { u.path = null; return true; }
  const map = game.map;
  const i = u.path[u.pathIndex];
  if (stepToward(u, map.xOf(i) + 0.5, map.yOf(i) + 0.5, speed)) u.pathIndex++;
  if (u.pathIndex >= u.path.length) { u.path = null; return true; }
  return false;
}

/** Set a water route from where the ship is to tile `goal` (null if there is none). */
function routeTo(game, u, goal) {
  const path = waterPath(game, tileAt(game.map, u.x, u.y), goal);
  u.path = path;
  u.pathIndex = path && path.length > 1 ? 1 : 0;
  u.pathGoal = goal;
  return !!path;
}

/**
 * Head for a point on the ship's own water: straight there while the water
 * between is clear, else by a planned route (planned again every 20 ticks
 * while the goal moves, as a chased ship does).
 */
function steer(game, u, tx, ty, speed) {
  const map = game.map;
  const here = tileAt(map, u.x, u.y);
  const body = map.navBody[here];
  if (!body || (u.body && body !== u.body)) {
    // Off its water: back to the nearest tile of it (never frozen ashore).
    const own = u.body || anyWaterBody(map, u);
    const home = own ? nearestWater(map, Math.floor(u.x), Math.floor(u.y), own, 3) : -1;
    u.path = null;
    if (home >= 0) stepToward(u, map.xOf(home) + 0.5, map.yOf(home) + 0.5, speed);
    else u.moving = false;
    return;
  }
  const goal = nearestWater(map, Math.floor(tx), Math.floor(ty), body, 3);
  if (goal < 0) { u.moving = false; return; }
  if (u.path) {
    const stale = u.pathGoal !== goal && (game.time.totalTicks + u.id) % 20 === 0;
    if (!stale) { followWaterPath(game, u, speed); return; }
    u.path = null;
  }
  if (clearWater(map, body, u.x, u.y, tx, ty)) { stepToward(u, tx, ty, speed); return; }
  if (u.noPath > 0) { u.noPath--; u.moving = false; return; }
  if (!routeTo(game, u, goal)) { u.noPath = 40; u.moving = false; return; }
  followWaterPath(game, u, speed);
}

/** The navigable water nearest a ship that has lost track of its own (0: none within 3 tiles). */
function anyWaterBody(map, u) {
  const x0 = Math.floor(u.x);
  const y0 = Math.floor(u.y);
  for (let r = 1; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (map.inBounds(x0 + dx, y0 + dy) && map.navBody[map.idx(x0 + dx, y0 + dy)]) return map.navBody[map.idx(x0 + dx, y0 + dy)];
      }
    }
  }
  return 0;
}

/** Where a walker (a fishing boat) is now, in continuous tile coordinates. */
function walkerPoint(w) {
  return { x: w.x + (w.tx - w.x) * (w.progress || 0) + 0.5, y: w.y + (w.ty - w.y) * (w.progress || 0) + 0.5 };
}

/** Arrows from the deck at a ship. */
function shoot(game, u, def, target) {
  u.strikeTick = game.time.totalTicks;
  u.cooldown = def.cooldown;
  const sdx = (target.x - u.x) - (target.y - u.y);
  if (Math.abs(sdx) > 0.01) u.facing = sdx > 0 ? 1 : -1;
  const dmg = rollDamage(game, def, UNIT_TYPES[target.type], enemyPower(game, u), unitDefense(game, target));
  game.projectiles.push({ x: u.x, y: u.y, z: 14, target: target.id, damage: dmg, speed: 0.4, kind: 'arrow', life: 60 });
  game.events.emit('sound', { name: 'arrow' });
}

// ---------------------------------------------------------------------------
// Naval stations and their squadrons
// ---------------------------------------------------------------------------

/** The water tile beside a station or navalia (its berths, its slip), or -1. Cached, with the side facing the water. */
export function shoreBerth(game, b) {
  return dockBerth(game, b);
}

/** Which navigable water a station or navalia stands by (0: none). */
export function waterOf(game, b) {
  const i = shoreBerth(game, b);
  return i >= 0 ? game.map.navBody[i] : 0;
}

/** The liburnians of a station. */
export function squadron(game, stationId) {
  const out = [];
  for (const u of game.units.values()) if (u.station === stationId) out.push(u);
  return out;
}

/** Liburnians per station id, in one pass. */
export function squadronCounts(game) {
  const out = new Map();
  for (const u of game.units.values()) if (u.station) out.set(u.station, (out.get(u.station) || 0) + 1);
  return out;
}

/** The point a squadron gathers around: its rally point, or its berths. */
function anchorOf(game, st) {
  if (st.rally) return st.rally;
  const i = shoreBerth(game, st);
  return i >= 0 ? { x: game.map.xOf(i) + 0.5, y: game.map.yOf(i) + 0.5 } : { x: st.x + st.size / 2, y: st.y + st.size / 2 };
}

/** Where each of a station's ships lies: the water tiles nearest its anchor (cached until the anchor moves). */
export function stationSpots(game, st) {
  const a = anchorOf(game, st);
  const key = `${a.x},${a.y}`;
  if (!game.stationSpots) game.stationSpots = new Map(); // station id -> { key, spots } (derived, not saved)
  const hit = game.stationSpots.get(st.id);
  if (hit && hit.key === key) return hit.spots;
  const map = game.map;
  const tiles = waterAround(map, tileAt(map, a.x, a.y), STATION_CAPACITY);
  const spots = [];
  for (let s = 0; s < STATION_CAPACITY; s++) {
    if (!tiles.length) { spots.push({ x: a.x, y: a.y }); continue; }
    const i = tiles[s % tiles.length];
    const off = SHARE_OFFSETS[Math.floor(s / tiles.length) % SHARE_OFFSETS.length];
    spots.push({ x: map.xOf(i) + 0.5 + off[0], y: map.yOf(i) + 0.5 + off[1] });
  }
  game.stationSpots.set(st.id, { key, spots });
  return spots;
}

/** The lowest berth number a station's squadron does not use. */
export function freeSlot(game, st) {
  const used = new Set([...squadron(game, st.id), ...awayOf(game, st.id)].map((u) => u.slot));
  let s = 0;
  while (used.has(s)) s++;
  return s;
}

/**
 * Stations on navigable water `body` with an empty berth, emptiest first
 * (ties: the older station). `staffed`: only those with workers (the
 * Navalia sends new ships only there). `newShips`: only those that take a
 * new ship (not deployed, none of theirs away: sim/battle.js takesNewMen).
 */
function stationsWithRoom(game, body, { staffed = true, except = 0, newShips = false } = {}) {
  const counts = squadronCounts(game);
  const away = awayCounts(game); // (berths kept for ships at a distant battle, sim/battle.js)
  const gone = newShips ? postsAway(game) : null;
  const out = [];
  for (const st of game.buildings.values()) {
    if (st.def.kind !== 'station' || st.id === except) continue;
    if (staffed && st.efficiency <= 0) continue;
    if (gone && !takesNewMen(game, st, gone)) continue;
    if (!body || waterOf(game, st) !== body) continue;
    const have = (counts.get(st.id) || 0) + (away.get(st.id) || 0);
    if (have < STATION_CAPACITY) out.push({ st, have });
  }
  out.sort((a, b) => a.have - b.have || a.st.id - b.st.id);
  return out;
}

/**
 * Send a station's squadron to a spot on its water (the player's click):
 * the nearest tile of that water within 2 tiles of it.
 * @returns {boolean} false when there is no such water there
 */
export function deployStation(game, stationId, tx, ty) {
  const st = game.buildings.get(stationId);
  if (!st || st.def.kind !== 'station') return false;
  const body = waterOf(game, st);
  if (!body) return false;
  const i = nearestWater(game.map, tx, ty, body, 2);
  if (i < 0) return false;
  st.rally = { x: game.map.xOf(i) + 0.5, y: game.map.yOf(i) + 0.5 };
  for (const u of squadron(game, stationId)) { endDrill(u); u.target = 0; u.state = 'sail'; } // (a ship on its way to the Portus comes too)
  return true;
}

/** Bring a squadron back to its berths. */
export function recallStation(game, stationId) {
  const st = game.buildings.get(stationId);
  if (!st || st.def.kind !== 'station') return false;
  st.rally = null;
  for (const u of squadron(game, stationId)) { u.path = null; u.target = 0; u.state = 'sail'; }
  return true;
}

/**
 * A station was lost (demolished, or wrecked by raiders): each of its ships
 * goes to another station on the same water with an empty berth (staffed or
 * not); the rest are laid up and gone. Hooked to 'buildingRemoved' in Game.
 */
export function stationLost(game, st) {
  const ships = squadron(game, st.id);
  const away = dropAway(game, st.id); // (at a distant battle: released there, sim/battle.js)
  if (!ships.length && !away) return;
  let moved = 0;
  let lost = 0;
  for (const u of ships) {
    const body = u.body || game.map.navBody[tileAt(game.map, u.x, u.y)];
    const [dest] = stationsWithRoom(game, body, { staffed: false, except: st.id });
    if (dest) {
      u.slot = freeSlot(game, dest.st); // (before it joins: its old slot is not taken there)
      u.station = dest.st.id;
      u.path = null;
      u.target = 0;
      u.state = 'sail';
      moved++;
    } else {
      removeUnit(game, u, 'disbanded');
      lost++;
    }
  }
  const parts = [];
  if (moved) parts.push(`${moved} liburnian${moved === 1 ? ' sails' : 's sail'} to another station`);
  if (lost) parts.push(`${lost} ${lost === 1 ? 'is' : 'are'} laid up for want of a berth`);
  if (away) parts.push(`the ${away} away at a distant battle ${away === 1 ? 'is' : 'are'} released from service and will not come back`);
  game.message(`With the ${st.def.name} gone, ${parts.join(' and ')}.`, 'warn', st.x, st.y);
}

// ---------------------------------------------------------------------------
// The Navalia
// ---------------------------------------------------------------------------

/** Daily: build the next liburnian, and launch it for the emptiest staffed station on its water. */
export function updateNavalia(game, b) {
  const slip = shoreBerth(game, b);
  if (b.efficiency <= 0 || b.accessRoad < 0) { b.blocked = b.accessRoad < 0 ? 'No road access.' : 'No workers.'; return; }
  if (slip < 0) { b.blocked = 'It does not stand by water a ship can sail.'; return; }
  const [dest] = stationsWithRoom(game, game.map.navBody[slip], { newShips: true });
  if (!dest) {
    b.blocked = stationsWithRoom(game, game.map.navBody[slip]).length
      ? 'No new liburnians while deployed: the stations on this water with an empty berth are deployed or have ships away.'
      : 'No staffed Statio (Naval Station) on this water has an empty berth.';
    return;
  }
  const cost = CONFIG.LIBURNIAN_COST;
  const missing = Object.keys(cost).filter((g) => (b.stock[g] || 0) < cost[g]);
  if (missing.length) { b.blocked = `Waiting for ${missing.map((g) => GOODS[g].name.toLowerCase()).join(', ')}.`; return; }
  b.blocked = '';
  b.progress = Math.min(100, (b.progress || 0) + (b.efficiency * 100) / CONFIG.NAVALIA_BUILD_DAYS);
  if (b.progress < 100 - 1e-6) return; // (30 steps of 100/30 add up to a hair under 100)
  for (const [g, n] of Object.entries(cost)) { b.stock[g] -= n; logGoods(game, g, 'used', n); }
  const map = game.map;
  const ship = spawnUnit(game, 'liburnian', map.xOf(slip) + 0.5, map.yOf(slip) + 0.5, { station: dest.st.id, slot: freeSlot(game, dest.st), state: 'sail', body: map.navBody[slip] });
  // A training Portus on its water: the new crew rows past it first (sim/training.js), unless raiders are about or its station is deployed.
  const school = game.military.active || game.military.caesar?.army || dest.st.rally ? null : portusFor(game, dest.st);
  if (school) startDrill(game, ship, school);
  b.progress = 0;
  b.built = (b.built || 0) + 1;
  const st = game.military.stats;
  st.shipsBuilt = (st.shipsBuilt || 0) + 1;
  game.message(school ? 'A liburnian is launched at the Navalia. Its crew rows to the Portus to train, then on to its Statio.' : 'A liburnian is launched at the Navalia and rows to its Statio.', 'good', b.x, b.y);
  game.events.emit('sound', { name: 'recruit' });
}

/**
 * Daily: the timber, iron and linen the staffed stations' empty berths still
 * need (none without a navalia). Cached on game.military.navalDemand.
 */
export function updateNavalDemand(game) {
  const need = { timber: 0, iron: 0, linen: 0 };
  // Empty berths at staffed stations, by water: only a navalia on the same
  // water can fill them (a navalia on other water must not hoard for them).
  const yards = [];
  const roomBy = new Map();
  const counts = squadronCounts(game);
  const away = awayCounts(game); // ships at a distant battle keep their berths (sim/battle.js)
  const gone = postsAway(game); // (a station deployed or with ships away takes no new ones)
  for (const b of game.buildings.values()) {
    if (b.def.kind === 'navalia') yards.push(b);
    else if (b.def.kind === 'station' && b.efficiency > 0 && takesNewMen(game, b, gone)) {
      const body = waterOf(game, b);
      if (body) roomBy.set(body, (roomBy.get(body) || 0) + Math.max(0, STATION_CAPACITY - (counts.get(b.id) || 0) - (away.get(b.id) || 0)));
    }
  }
  const served = new Set();
  for (const y of yards) {
    const body = waterOf(game, y);
    y.fleetNeeds = (roomBy.get(body) || 0) > 0; // (derived each day; navaliaHasRoom reads it)
    if (y.fleetNeeds) served.add(body);
  }
  let room = 0;
  for (const body of served) room += roomBy.get(body);
  for (const [g, n] of Object.entries(CONFIG.LIBURNIAN_COST)) need[g] = room * n;
  game.military.navalDemand = need;
  return need;
}

/**
 * Units of a good that should still go to a navalia: what the fleet needs
 * minus what the navalia hold or have on the way. 0: deliver it elsewhere
 * (workshops and warehouses), as the barracks' goods do.
 */
export function navalNeed(game, good) {
  const want = game.military?.navalDemand?.[good] || 0;
  if (want <= 0) return 0;
  let held = 0;
  for (const b of game.buildings.values()) {
    if (b.def.kind === 'navalia') held += (b.stock[good] || 0) + (b.incoming[good] || 0);
  }
  return Math.max(0, want - held);
}

/** Can this navalia take `amount` more of a good right now (a staffed station on its water has an empty berth)? */
export function navaliaHasRoom(b, good, amount) {
  return b.def.kind === 'navalia' && b.efficiency > 0 && b.fleetNeeds !== false && b.stock[good] !== undefined
    && b.stock[good] + b.incoming[good] + amount <= b.def.inputCap;
}

// ---------------------------------------------------------------------------
// Sea raids: the plan, the landing, the launch
// ---------------------------------------------------------------------------

/**
 * Does the raid the scouts have just seen come by sea? Only with the switch
 * on and water from the sea entry; then with chance SEA_RAID_SHARE, on a
 * random stream of its own (the map seed and the raid's number), so the
 * game's own stream is untouched. Returns its landing, or null (by land).
 */
export function seaRaidPlan(game) {
  const m = game.military;
  if (!m.seaRaids || !game.map.seaEntry) return null;
  if (seaRoll(game.seed, m.nextInvasionId) >= CONFIG.SEA_RAID_SHARE) return null;
  return findLanding(game);
}

/** The roll for raid number `n` on a map seed (0..1). */
export function seaRoll(seed, n) {
  return new RNG(`${seed}:searaid:${n}`).next();
}

/** A land tile's neighbor on navigable water `body`, or -1. */
function waterBesideTile(map, i, body) {
  const x = map.xOf(i);
  const y = map.yOf(i);
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const nx = x + dx;
    const ny = y + dy;
    if (!map.inBounds(nx, ny)) continue;
    const j = map.idx(nx, ny);
    if (map.navBody[j] === body) return j;
  }
  return -1;
}

/**
 * Where raiders by sea come ashore: open land beside the sea entry's water
 * from which they can walk to a home, its walk to the nearest home as close
 * to LANDING_WALK as can be (at least LANDING_MIN_WALK); ties: the first
 * tile. No random draws. @returns {{x, y, water}|null} water = the tile
 * beside it where the first ship lies
 */
export function findLanding(game) {
  const map = game.map;
  const e = map.seaEntry;
  if (!e) return null;
  const body = map.navBody[map.idx(e.x, e.y)];
  if (!body) return null;
  const field = new Float32Array(map.size);
  fillField(game, field, (id) => !!game.buildings.get(id)?.house);
  let best = null;
  let bestScore = Infinity;
  for (let i = 0; i < map.size; i++) {
    const f = field[i];
    if (!Number.isFinite(f) || f < CONFIG.LANDING_MIN_WALK) continue;
    if (map.terrain[i] === Terrain.WATER || !passable(game, 'enemy', i)) continue; // (a bridge is no beach)
    const score = Math.abs(f - CONFIG.LANDING_WALK);
    if (score >= bestScore) continue;
    const water = waterBesideTile(map, i, body);
    if (water < 0) continue;
    bestScore = score;
    best = { x: map.xOf(i), y: map.yOf(i), water };
  }
  return best;
}

/**
 * Where raider ships setting out now would come ashore, or null when the raid
 * would go by land after all (the Sea raids switch turned off, no landing,
 * or no water route to it): launchSeaInvasion's own tests, with no random
 * draws, for the warning a month before a raid by sea (sim/military.js).
 * @returns {{x, y, water}|null}
 */
export function seaLandingNow(game) {
  const map = game.map;
  const e = map.seaEntry;
  if (!game.military.seaRaids || !e) return null;
  const landing = findLanding(game);
  if (!landing || !waterPath(game, map.idx(e.x, e.y), landing.water)) return null;
  return landing;
}

/**
 * Launch a raid by sea now: its ships set out from the sea entry for the
 * landing, one every 30 ticks. Returns the invasion record, or null if no
 * landing (or no water route to it) can be found: the raid comes by land.
 */
export function launchSeaInvasion(game, size) {
  const m = game.military;
  const map = game.map;
  const e = map.seaEntry;
  if (!e) return null;
  const landing = findLanding(game);
  if (!landing) return null;
  const entry = map.idx(e.x, e.y);
  const first = waterPath(game, entry, landing.water);
  if (!first) return null;
  const n = Math.max(1, Math.min(CONFIG.RAID_SHIP_MAX, Math.ceil(size / CONFIG.RAID_SHIP_CREW)));
  const moors = waterAround(map, landing.water, n, 3);
  const inv = {
    id: m.nextInvasionId++, origin: { x: landing.x, y: landing.y }, size, killed: 0, buildingsLost: 0,
    startDay: game.time.totalDays, fleeing: false, reached: false,
    sea: true, landing, landed: false, landedDay: null, ships: n, shipsSunk: 0,
  };
  m.active = inv;
  m.warned = null;
  m.warnStage = 0;
  m.stats.raids++;
  m.stats.seaRaids = (m.stats.seaRaids || 0) + 1;
  // The same warriors as a warband by land, one roll each, shared out among the ships.
  const crews = Array.from({ length: n }, () => []);
  for (let k = 0; k < size; k++) crews[k % n].push(warbandType(game));
  for (let s = 0; s < n; s++) {
    const moor = moors[s] ?? landing.water;
    const path = moor === landing.water ? first : waterPath(game, entry, moor);
    const u = spawnUnit(game, 'raider_ship', e.x + 0.5, e.y + 0.5, {
      invasion: inv.id, state: 'sail', crew: crews[s], pots: CONFIG.RAID_SHIP_POTS, body: map.navBody[entry],
      waitTicks: s * 30, // they come in a line, not all on one tile
    });
    u.path = path || first;
    u.pathIndex = u.path.length > 1 ? 1 : 0;
  }
  const dir = screenDirection(map, e.x, e.y);
  game.message(`Raider ships are coming from the ${dir}: ${n} ship${n === 1 ? '' : 's'} with ${size} warriors. They will land near ${landing.x}, ${landing.y}.`, 'bad', landing.x, landing.y);
  game.events.emit('sound', { name: 'horn' });
  game.events.emit('invasion', inv);
  return inv;
}

/** Days since a raid by sea came ashore (0 until it has): its clock for RAID_MAX_DAYS. */
export function seaRaidDays(game, inv) {
  return inv.landedDay === null || inv.landedDay === undefined ? 0 : game.time.totalDays - inv.landedDay;
}

/** Is a ship of this raid still afloat (to carry its fleeing raiders away)? */
export function fleeingToShips(game, inv) {
  for (const u of game.units.values()) if (u.invasion === inv.id && isShip(u)) return true;
  return false;
}

/** A fleeing raider is back at the landing (he boards and is gone). */
export function landingReached(u, inv) {
  return Math.hypot(u.x - (inv.origin.x + 0.5), u.y - (inv.origin.y + 0.5)) < 1.3;
}

/** Can raiders step ashore on this tile? */
function shoreOk(game, x, y) {
  const map = game.map;
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  return map.terrain[i] !== Terrain.WATER && passable(game, 'enemy', i);
}

/**
 * Put a ship's raiders ashore at the raid's landing (or, if that is now built
 * on, the nearest open shore), each on open land within 2 tiles of it from
 * which raiders can walk to a home (never across a creek, cut off).
 */
function landCrew(game, u, inv) {
  const map = game.map;
  const field = new Float32Array(map.size);
  fillField(game, field, (id) => !!game.buildings.get(id)?.house);
  const ok = (x, y) => shoreOk(game, x, y) && Number.isFinite(field[map.idx(x, y)]);
  let spot = { x: inv.landing.x, y: inv.landing.y };
  if (!ok(spot.x, spot.y)) {
    // Something was built there while they sailed: the nearest open shore
    // within 4 tiles of the ship, or a new landing altogether.
    spot = null;
    const ux = Math.floor(u.x);
    const uy = Math.floor(u.y);
    let bestD = Infinity;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (dx * dx + dy * dy >= bestD || !ok(ux + dx, uy + dy)) continue;
        bestD = dx * dx + dy * dy;
        spot = { x: ux + dx, y: uy + dy };
      }
    }
    if (!spot) {
      const L = findLanding(game);
      if (L && routeTo(game, u, L.water)) { inv.landing = L; inv.origin = { x: L.x, y: L.y }; return; }
      startLeaving(game, u);
      return;
    }
    inv.origin = { x: spot.x, y: spot.y }; // where they run back to
  }
  for (const type of u.crew || []) {
    let x = spot.x;
    let y = spot.y;
    for (let t = 0; t < 8; t++) {
      const tx = spot.x + game.rng.range(-2, 2);
      const ty = spot.y + game.rng.range(-2, 2);
      if (ok(tx, ty)) { x = tx; y = ty; break; }
    }
    spawnUnit(game, type, x + 0.5, y + 0.5, { invasion: inv.id, state: 'advance' });
  }
  u.crew = [];
  u.state = 'offshore';
  u.path = null;
  u.moving = false;
  if (!inv.landed) {
    inv.landed = true;
    inv.landedDay = game.time.totalDays;
    game.message(`Raiders are coming ashore near ${spot.x}, ${spot.y}!`, 'bad', spot.x, spot.y);
    game.events.emit('sound', { name: 'horn' });
  }
  computeField(game);
}

/** Sail back out by the sea entry (the raid is over, or broken before it landed). */
function startLeaving(game, u) {
  const e = game.map.seaEntry;
  u.state = 'leave';
  u.target = 0;
  if (!e || !routeTo(game, u, game.map.idx(e.x, e.y))) removeUnit(game, u, 'fled');
}

// ---------------------------------------------------------------------------
// Per tick: ships sail and fight
// ---------------------------------------------------------------------------

/** Per tick (sim/military.js updateMilitary): liburnians, then raider ships. */
export function updateNavy(game, fleet, pirates) {
  for (const u of fleet) {
    if (!game.units.has(u.id)) continue;
    if (u.cooldown > 0) u.cooldown--;
    if (u.ramCooldown > 0) u.ramCooldown--;
    updateLiburnian(game, u, pirates);
  }
  for (const u of pirates) {
    if (!game.units.has(u.id)) continue;
    if (u.cooldown > 0) u.cooldown--;
    updateRaiderShip(game, u, fleet);
  }
}

/**
 * A liburnian's choice of raider ship: one near its anchor (within `guard`)
 * or right next to it (within its aggro), never one past guard + chase.
 */
function pickShip(game, pirates, u, def, anchor, guard) {
  let best = null;
  let bestD = Infinity;
  for (const e of pirates) {
    if (!game.units.has(e.id)) continue;
    const dA = dist(e, anchor);
    if (dA > guard + CONFIG.STATION_CHASE) continue;
    const d = dist(e, u);
    if (dA > guard && d > def.aggro) continue;
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function updateLiburnian(game, u, pirates) {
  const def = UNIT_TYPES[u.type];
  // Sent to a distant battle (sim/battle.js): out to sea by the sea entry,
  // fighting no one on the way. One that cannot get there in AWAY_MAX_TICKS
  // is taken to have found its way out.
  if (u.away) {
    const e = game.map.seaEntry;
    u.state = 'away';
    u.target = 0;
    // (A squadron on other water than the sea entry's, a lake or a second
    // river, goes out its own way: it leaves at once.)
    const out = !e || game.map.navBody[game.map.idx(e.x, e.y)] !== u.body;
    if (out || dist(u, { x: e.x + 0.5, y: e.y + 0.5 }) < 1.2 || game.time.totalTicks - (u.awayTick || 0) > AWAY_MAX_TICKS) { leaveForBattle(game, u); return; }
    steer(game, u, e.x + 0.5, e.y + 0.5, shipSpeed(u, def));
    return;
  }
  const st = game.buildings.get(u.station);
  if (!st || st.def.kind !== 'station') { removeUnit(game, u, 'disbanded'); return; }
  const anchor = anchorOf(game, st);
  const guard = st.rally ? CONFIG.STATION_GUARD_DEPLOYED : CONFIG.STATION_GUARD;
  let target = u.target ? game.units.get(u.target) : null;
  if (target && dist(target, anchor) > guard + CONFIG.STATION_CHASE) target = null;
  if (!target || (game.time.totalTicks + u.id) % 6 === 0) target = pickShip(game, pirates, u, def, anchor, guard) || target;
  u.target = target ? target.id : 0;
  if (target) {
    u.state = 'engage';
    const d = dist(u, target);
    if (d <= RAM_REACH && !(u.ramCooldown > 0)) {
      // The ram: a heavy blow to a ship it reaches (harder from a trained crew).
      u.ramCooldown = RAM_COOLDOWN;
      u.strikeTick = game.time.totalTicks;
      hurt(game, target, ramOf(u, def) * (0.8 + game.rng.next() * 0.4));
      game.events.emit('sound', { name: 'clash' });
    }
    if (game.units.has(target.id) && d <= def.range && u.cooldown <= 0) shoot(game, u, def, target);
    // Close in to ram, each from its own side (its personal offset), so a
    // squadron surrounds a ship rather than piling onto one spot.
    if (d > 0.9) steer(game, u, target.x + u.ox * 2.4, target.y + u.oy * 2.4, shipSpeed(u, def));
    else u.moving = false;
    return;
  }
  if (u.drill && rowToPortus(game, u, def)) return;
  const spot = stationSpots(game, st)[(u.slot || 0) % STATION_CAPACITY];
  if (dist(u, spot) < 0.08) {
    u.state = st.rally ? 'holding' : 'berthed';
    u.moving = false;
    u.path = null;
    return;
  }
  u.state = 'sail';
  steer(game, u, spot.x, spot.y, shipSpeed(u, def));
}

/** A liburnian's speed: a trained crew rows in time, and faster. */
export function shipSpeed(u, def = UNIT_TYPES[u.type]) {
  return u.trained && def.trainedSpeed ? def.trainedSpeed : def.speed;
}

/** A liburnian's ram damage before its +-20%: harder from a trained crew. */
export function ramOf(u, def = UNIT_TYPES[u.type]) {
  return u.trained && def.trainedRam ? def.trainedRam : def.ram;
}

/**
 * A new liburnian sent to the Portus (sim/training.js) rows to its berth and
 * moors there PORTUS_TRAIN_DAYS (`trainLeft`, counted only while the Portus
 * is fully staffed, but kept waiting no more than TRAIN_WAIT_MAX_DAYS in
 * all), then, trained, rows on to its station. A Portus gone, or
 * on other water: the trip is off, and it rows on untrained.
 * @returns {boolean} true while still going (or moored there)
 */
function rowToPortus(game, u, def) {
  const p = game.buildings.get(u.drill);
  const berth = p && p.def.kind === 'portus' ? shoreBerth(game, p) : -1;
  if (berth < 0 || game.map.navBody[berth] !== u.body) { endDrill(u); return false; }
  const spot = { x: game.map.xOf(berth) + 0.5, y: game.map.yOf(berth) + 0.5 };
  if (dist(u, spot) < 0.3) {
    u.state = 'training';
    u.moving = false;
    if (!(u.trainLeft > 0)) u.trainLeft = CONFIG.PORTUS_TRAIN_DAYS * CONFIG.TICKS_PER_DAY;
    if (!trainsNow(game, p)) {
      // Short of staff: the drill waits, but not for ever (TRAIN_WAIT_MAX_DAYS): then on, untrained.
      u.trainWait = (u.trainWait || 0) + 1;
      if (u.trainWait <= CONFIG.TRAIN_WAIT_MAX_DAYS * CONFIG.TICKS_PER_DAY) return true;
      endDrill(u);
      return false;
    }
    u.trainLeft--;
    if (u.trainLeft > 0) return true;
    drilled(game, u, p);
    return false;
  }
  u.state = 'drill';
  steer(game, u, spot.x, spot.y, shipSpeed(u, def));
  return true;
}

function updateRaiderShip(game, u, fleet) {
  const def = UNIT_TYPES[u.type];
  const inv = game.military.active;
  const mine = !!inv && inv.id === u.invasion;
  if (u.waitTicks > 0) { u.waitTicks--; u.moving = false; return; } // waiting its turn to set out
  // The raid is over, or broken before this ship landed: away.
  if (u.state !== 'leave' && (!mine || (inv.fleeing && (u.crew || []).length))) startLeaving(game, u);
  if (!game.units.has(u.id)) return;
  if (u.cooldown <= 0) raiderShipShoot(game, u, def, fleet);
  if (u.state === 'sail') {
    if (followWaterPath(game, u, def.speed)) landCrew(game, u, inv);
  } else if (u.state === 'leave') {
    if (followWaterPath(game, u, def.speed)) removeUnit(game, u, 'fled');
  } else {
    u.moving = false; // offshore, waiting for the raiders
  }
}

/**
 * A raider ship's shot: arrows at the nearest liburnian in range; else, with
 * a fire pot left and not leaving, a pot at the nearest fishing boat in
 * range, else at the nearest building with a tile in range.
 */
function raiderShipShoot(game, u, def, fleet) {
  let lib = null;
  let bestD = def.range;
  for (const f of fleet) {
    if (!game.units.has(f.id)) continue;
    const d = dist(f, u);
    if (d <= bestD) { bestD = d; lib = f; }
  }
  if (lib) { shoot(game, u, def, lib); return; }
  if (u.state === 'leave' || !(u.pots > 0)) return;
  const boat = nearestBoat(game, u, def.range);
  if (boat) { throwPot(game, u, def, { walker: boat.w.id }, boat.p); return; }
  const hit = nearestBuilding(game, u, def.range);
  if (hit) { throwPot(game, u, def, { building: hit.b.id }, hit.p); return; }
  u.cooldown = LOOK_AGAIN_TICKS; // nothing in reach: look again in a moment
}

function nearestBoat(game, u, range) {
  let best = null;
  let bestD = range;
  for (const w of game.walkers.values()) {
    if (w.type !== 'fishing_boat' || w.dead) continue;
    const p = walkerPoint(w);
    const d = dist(p, u);
    if (d <= bestD) { bestD = d; best = { w, p }; }
  }
  return best;
}

/** The nearest building with a tile within `range`, and the point of it nearest the ship. */
function nearestBuilding(game, u, range) {
  let best = null;
  let bestD = range;
  for (const b of game.buildings.values()) {
    const S = b.size;
    const px = Math.max(b.x, Math.min(b.x + S, u.x));
    const py = Math.max(b.y, Math.min(b.y + S, u.y));
    const d = Math.hypot(px - u.x, py - u.y);
    if (d > bestD || (d === bestD && best && best.b.id < b.id)) continue;
    bestD = d;
    best = { b, p: { x: px, y: py } };
  }
  return best;
}

function throwPot(game, u, def, target, at) {
  u.pots--;
  u.cooldown = def.cooldown;
  u.strikeTick = game.time.totalTicks;
  const sdx = (at.x - u.x) - (at.y - u.y);
  if (Math.abs(sdx) > 0.01) u.facing = sdx > 0 ? 1 : -1;
  game.projectiles.push({
    pot: true, ...target, x: u.x, y: u.y, z: 14, tx: at.x, ty: at.y,
    damage: CONFIG.RAID_SHIP_POT_DAMAGE * enemyPower(game, u), speed: 0.3, kind: 'firepot', life: 90,
  });
  game.events.emit('sound', { name: 'arrow' });
}

/**
 * A fire pot in flight (sim/military.js updateProjectiles): it flies at its
 * boat (following it) or the spot of its building, and on arrival sinks the
 * boat, or hurts the building and raises its fire risk. A target that is
 * gone, or a miss, falls in the water. @returns {boolean} true when done
 */
export function potHit(game, p) {
  let to = { x: p.tx, y: p.ty };
  let boat = null;
  let b = null;
  if (p.walker) {
    boat = game.walkers.get(p.walker);
    if (!boat || boat.dead) return true;
    to = walkerPoint(boat);
  } else {
    b = game.buildings.get(p.building);
    if (!b) return true;
  }
  const dx = to.x - p.x;
  const dy = to.y - p.y;
  const d = Math.hypot(dx, dy);
  if (d <= p.speed || --p.life <= 0) {
    if (d <= 1.2) {
      if (boat) sinkBoat(game, boat);
      else potOnBuilding(game, b, p.damage);
    }
    return true;
  }
  p.vx = (dx / d) * p.speed;
  p.vy = (dy / d) * p.speed;
  p.x += p.vx;
  p.y += p.vy;
  p.z = Math.max(4, p.z * 0.97);
  return false;
}

/** A fire pot sinks a fishing boat (its shipyard builds another). */
function sinkBoat(game, w) {
  killWalker(game, w);
  const st = game.military.stats;
  st.boatsSunk = (st.boatsSunk || 0) + 1;
  game.events.emit('sound', { name: 'splash' });
  const inv = game.military.active;
  if (inv && !inv.boatSaid) {
    inv.boatSaid = true; // once a raid
    game.message('Raider ships have sunk a fishing boat! A Fabrica Navalis will build another.', 'bad', w.x, w.y);
  }
}

/** A fire pot bursts on a building: damage, and fire risk if it can burn (prefects clear it as always). */
function potOnBuilding(game, b, dmg) {
  damageBuilding(game, b, dmg, { fromSea: true });
  if (game.buildings.has(b.id) && riskRates(b).fire > 0) b.fireRisk += CONFIG.RAID_SHIP_FIRE_HEAT;
  game.events.emit('sound', { name: 'fire' });
}

// ---------------------------------------------------------------------------
// For the info panels and the advisor
// ---------------------------------------------------------------------------

/** What a ship is doing, in words. */
export function shipStatus(game, u) {
  if (u.type === 'raider_ship') {
    if (u.waitTicks > 0) return 'Gathering at the edge of the map';
    switch (u.state) {
      case 'sail': return (u.crew || []).length ? `Sailing in with ${u.crew.length} raider${u.crew.length === 1 ? '' : 's'} aboard` : 'Sailing in';
      case 'offshore': return 'Waiting offshore for its raiders';
      case 'leave': return 'Sailing away';
      default: return 'At sea';
    }
  }
  const st = game.buildings.get(u.station);
  switch (u.state) {
    case 'engage': return 'Fighting a raider ship';
    case 'berthed': return 'At its berth';
    case 'drill': return 'Rowing to the Portus to train its crew';
    case 'training': {
      const days = Math.ceil((u.trainLeft || 0) / CONFIG.TICKS_PER_DAY);
      return `Moored at the Portus: its crew trains, ${days} day${days === 1 ? '' : 's'} left${trainsNow(game, game.buildings.get(u.drill)) ? '' : ' (paused: the Portus is short of staff)'}`;
    }
    case 'away': return 'Sailing out to a distant battle';
    case 'holding': return st && st.rally ? `Holding the water at ${Math.floor(st.rally.x)}, ${Math.floor(st.rally.y)}` : 'Holding its place';
    default: return st && st.rally ? 'Rowing to where it was sent' : 'Rowing to its berth';
  }
}

/** Fleet figures for the Military advisor. */
export function fleetSummary(game) {
  let ships = 0;
  let atSea = 0;
  let pay = 0;
  let raiders = 0;
  for (const u of game.units.values()) {
    if (!isShip(u)) continue;
    if (u.side === 'enemy') { raiders++; continue; }
    ships++;
    pay += UNIT_TYPES[u.type].upkeep || 0;
    if (u.state !== 'berthed') atSea++;
  }
  return { ships, atSea, pay, raiders };
}

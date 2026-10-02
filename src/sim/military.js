/**
 * military.js
 * ----------------------------------------------------------------------------
 * Soldiers, raiders, towers, walls and invasions.
 *
 * Supply chain (carts deliver only while forts have empty places)
 *   Weaponsmith (iron)          ---weapons---\
 *   Fletcher (timber + iron)    ---arrows----+--> Barracks --recruit walks by road--> Fort
 *   Horse Ranch (breeding herd) ---horses----/
 *   Warehouses forward stored weapons/arrows to barracks too; horses stay at
 *   the ranch (never in a warehouse) until a barracks needs them.
 *   One recruit: legionary 50 weapons, archer 50 arrows, cavalryman 1 horse.
 *
 * Units (both sides) move freely over open land in continuous tile
 * coordinates (tile centers are at .5). Roman soldiers stand on formation
 * spots around their fort (or a rally point the player picks). At the fort they
 * hold their ground (fight only what comes to them); deployed, they engage
 * raiders around the rally point. Raiders follow a "flow field": one
 * Dijkstra pass from every building tile gives each land tile the cost to
 * reach the nearest building, so every raider just walks downhill. Walls cost
 * extra in that field, so raiders pick the cheapest place to break through.
 *
 * Invasions are announced in three stages (raidWarning below): word of a
 * warband about 6 months ahead, the scouts' report of its size and road
 * about 3 months ahead, and a last warning a month ahead. Then a warband
 * spawns at a map edge that can reach the city's homes. It flees when mostly destroyed, or
 * withdraws (with plunder if it reached the city) after a while, so an
 * undefended city is punished but not wiped out. Where ships can sail, about
 * a third of raids come by sea instead: raider ships put the warband ashore
 * near the city (sim/navy.js, which also runs the fleet). Ships are units
 * too (`naval`), but sail and fight apart: soldiers, raiders and towers on
 * land never see them.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { UNIT_TYPES, FORT_CAPACITY, TRAIN_DAYS } from '../data/units.js';
import { TOOLS } from '../data/buildings.js';
import { RECRUIT_COST, RECRUIT_SOURCE, GOODS } from '../data/goods.js';
import { Terrain, Road, Wall } from '../world/map.js';
import { MinHeap } from '../world/pathfinding.js';
import { INVASION_PRESETS } from '../data/scenarios.js';
import { difficultyOf } from '../data/difficulty.js';
import { spawnWalker, killWalker, STRIDE_WRAP, mainOf } from './entities.js';
import { followPath } from './movement.js';
import { transact } from './economy.js';
import { igniteBuilding, collapseBuilding, riskRates } from './risk.js';
import { recordRuin } from './ruins.js';
import { logGoods } from './goodsLedger.js';
import { seaRaidPlan, seaLandingNow, launchSeaInvasion, updateNavy, potHit, fleeingToShips, landingReached, updateNavalDemand, seaRaidDays } from './navy.js';
import { recruitDetour, recruitTrained, updateDrill, endDrill } from './training.js';
import { newCaesarState, updateLegionary, refreshLegionField, legionCount, legionSummary } from './legion.js';
import { leaveForBattle, awayCounts, awayOf, awayUpkeep, dropAway, AWAY_MAX_TICKS } from './battle.js';

// When a fort has fewer open tiles around its post than soldiers, extra men
// share tiles using these sub-tile offsets.
const SLOT_OFFSETS = [[0, 0], [0.26, -0.26], [-0.26, 0.26], [0.26, 0.26], [-0.26, -0.26]];
// A fort that is not deployed holds its ground, as the original's legions did
// until sent out: a legionary or cavalryman takes on only an enemy within
// HOLD_REACH tiles of the fort's ranks (he steps out, strikes and steps
// back), and lets go once the enemy is HOLD_LEASH tiles beyond that; an
// archer only one his arrows reach from his post. Anyone answers an enemy
// striking at him (see inZone). To fight in the
// field, the player deploys the fort (a rally point): deployed troops guard
// def.aggro * 1.5 around it and chase up to 4 tiles farther (fightZone).
const HOLD_REACH = 2;
const HOLD_LEASH = 1;
const WALL_HP = { [Wall.WALL]: 220, [Wall.GATE]: 320 };
const FIELD_WALL_COST = 14; // how much raiders dislike breaking a wall vs walking
const TOWER_RANGE = 8;
const TOWER_DAMAGE = 12;
const TOWER_COOLDOWN = 30; // ticks at full staff
const RAID_MAX_DAYS = 80; // raiders give up and withdraw after this long
const RAID_MAX_LOSSES = 10; // ...or after destroying this many buildings
export const RAID_MIN_POP = 300; // hamlets smaller than this are not worth raiding (the raid is put off)

// The warnings before a raid, in months before it strikes (militaryMonthly).
// Only the scouting at SCOUT_MONTHS draws anything (the side, by the game's
// stream, and land or sea, on a stream of its own); the rumour before it and
// the last warning after it only read state, so they change no raid.
export const RUMOUR_MONTHS = 6; // traders' word: a warband is gathering, not yet where or how big
export const SCOUT_MONTHS = 3; // the scouts fix its side, size and road (land or sea)
export const DOOR_MONTHS = 1; // a month away: the last warning

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
    warned: null, // { origin:{x,y}, size, dir, sea?, landing?, noShore? }: the scouts' report
    warnStage: 0, // warnings given for the coming raid: 0 none, 1 rumour, 2 scouted, 3 a month away
    active: null, // { id, origin, size, killed, buildingsLost, startDay, fleeing, plundered }
    nextInvasionId: 1,
    lastLossMessageDay: -99,
    lastWallMessageDay: -99,
    demand: { weapons: 0, arrows: 0, horses: 0 }, // see updateDemand()
    navalDemand: { timber: 0, iron: 0, linen: 0 }, // what the stations' empty berths need (sim/navy.js)
    lastUpkeep: 0,
    // Sea raids (sim/navy.js): the switch. Off (the sandbox's setup, the
    // Settings, a scenario's seaRaids: false or the flag searaids=off), every
    // raid comes by land, exactly as before. The flag searaids=on (Settings'
    // choice for a new mission) wins over the scenario.
    seaRaids: flags.searaids === 'off' ? false : flags.searaids === 'on' ? true : scenario.seaRaids !== false,
    stats: { raids: 0, repelled: 0, enemiesKilled: 0, soldiersLost: 0, buildingsLost: 0, trained: 0, seaRaids: 0, shipsSunk: 0, shipsLost: 0, shipsBuilt: 0, boatsSunk: 0 },
    caesar: newCaesarState(), // Caesar's legions (sim/legion.js)
    battle: null, // a distant battle Caesar asked troops for (sim/battle.js)
    battles: { won: 0, lost: 0, lastEndMonth: -999 },
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
    this.trained = false; // Roman: trained at a Military Academy or the Portus (sim/training.js)
    this.drill = 0; // Roman ship: id of the Portus it is on its way to, 0 = none (soldiers no longer go)
    this.drillDay = 0; // ...the day he set out
    this.drillDays = 0; // ...and how long the trip may take (sim/training.js startDrill)
    this.trainLeft = 0; // ...and, moored at the Portus, the ticks of training left
    this.trainWait = 0; // ...and the ticks it has waited there for a full staff
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
    const inv = game.military.active;
    const mine = inv && inv.id === u.invasion;
    if (UNIT_TYPES[u.type].naval) {
      // A sunk raider ship drowns the raiders still aboard: they count as slain.
      const drowned = u.side === 'enemy' ? (u.crew || []).length : 0;
      if (u.side === 'enemy') {
        st.shipsSunk = (st.shipsSunk || 0) + 1;
        st.enemiesKilled += drowned;
        if (mine) { inv.killed += drowned; inv.shipsSunk = (inv.shipsSunk || 0) + 1; }
        game.message(drowned ? `A raider ship has been sunk with ${drowned} raider${drowned === 1 ? '' : 's'} aboard!` : 'A raider ship has been sunk!', 'good', Math.floor(u.x), Math.floor(u.y));
      } else {
        st.shipsLost = (st.shipsLost || 0) + 1;
        game.message('A liburnian has been sunk! The Navalia can build another.', 'bad', Math.floor(u.x), Math.floor(u.y));
      }
      u.crew = [];
      game.events.emit('sound', { name: 'splash' });
    } else if (u.side === 'enemy') {
      st.enemiesKilled++;
      if (u.legion) {
        // One of Caesar's men (sim/legion.js): his army's count, not a raid's.
        const cs = game.military.caesar;
        if (cs && cs.army && cs.army.id === u.legion) cs.army.killed++;
        if (cs) cs.stats.slain++;
      } else if (mine) inv.killed++;
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

/** Raiders in the province: on land, and still aboard their ships. */
export function enemyCount(game) {
  let n = 0;
  for (const u of game.units.values()) {
    if (u.side !== 'enemy') continue;
    n += UNIT_TYPES[u.type].naval ? (u.crew || []).length : 1;
  }
  return n;
}

/** Raider ships on the map (sailing in, offshore or leaving). */
export function raiderShipCount(game) {
  let n = 0;
  for (const u of game.units.values()) if (u.side === 'enemy' && UNIT_TYPES[u.type].naval) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Passability & movement
// ---------------------------------------------------------------------------

export function passable(game, side, i) {
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
  const away = dropAway(game, fort.id); // (at a distant battle: released there, sim/battle.js)
  const parts = [];
  if (men.length) parts.push(`its ${men.length} soldier${men.length === 1 ? '' : 's'} disbanded`);
  if (away) parts.push(`the ${away} away at a distant battle ${away === 1 ? 'is' : 'are'} released from service and will not come back`);
  if (parts.length) game.message(`With the ${fort.def.name} gone, ${parts.join(', and ')}.`, 'warn', fort.x, fort.y);
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
  updateNavalDemand(game); // the fleet's timber, iron and linen (sim/navy.js)
  const demand = { weapons: 0, arrows: 0, horses: 0 };
  const counts = garrisonCounts(game);
  const away = awayCounts(game); // men at a distant battle keep their places (sim/battle.js)
  for (const f of game.buildings.values()) {
    if (f.def.kind !== 'fort') continue;
    const room = FORT_CAPACITY - (counts.get(f.id) || 0) - (away.get(f.id) || 0) - (f.recruiting || 0);
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

  // Forts that still have room, emptiest first. A fort whose men are away at
  // a distant battle keeps their places for them (sim/battle.js).
  const counts = garrisonCounts(game);
  const away = awayCounts(game);
  const forts = [];
  for (const f of game.buildings.values()) {
    if (f.def.kind !== 'fort' || f.efficiency <= 0 || f.accessRoad < 0) continue;
    const have = (counts.get(f.id) || 0) + (away.get(f.id) || 0) + (f.recruiting || 0);
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
    // A fully staffed Military Academy: he is trained there first (sim/training.js).
    const detour = recruitDetour(game, b, f);
    const w = spawnWalker(game, 'recruit', b.accessRoad, b, {
      target: f.id, state: detour ? 'toAcademy' : 'toFort', academy: detour ? detour.academy.id : 0, trained: false, trainLeft: 0, trainWait: 0,
      reserve: { id: f.id, recruit: 1 }, unitType: f.def.unit,
    });
    if (!w) { f.recruiting--; for (const [good, n] of Object.entries(cost)) b.stock[good] += n; return; }
    for (const [good, n] of Object.entries(cost)) logGoods(game, good, 'used', n);
    followPath(game, w, detour ? detour.path : path);
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
    // (The places of men away at a distant battle are kept for them.)
    const used = new Set([...unitsOfFort(game, fort.id), ...awayOf(game, fort.id)].map((u) => u.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    if (slot < FORT_CAPACITY) {
      // The recruit steps off the road as a soldier and marches to his post.
      spawnUnit(game, fort.def.unit, w.x + 0.5, w.y + 0.5, { fort: fort.id, slot, state: 'march', trained: !!w.trained });
      if (w.trained) recruitTrained(game, w);
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

/**
 * Raiders (or a raider ship's fire pot, `fromSea`) hurt a building; at 0 hit
 * points it burns or collapses. Fire pots alone never let a raid carry off
 * plunder: only raiders who reach the city on foot do. `legion`: Caesar's
 * army struck it (sim/legion.js), which is no part of a raid.
 */
export function damageBuilding(game, b, dmg, { fromSea = false, legion = null } = {}) {
  if (b.hp === undefined) b.hp = buildingMaxHp(b);
  b.hp -= dmg;
  b.lastRaided = game.time.totalDays;
  const inv = legion ? null : game.military.active;
  if (inv && !fromSea) inv.reached = true; // the warband made it to the city: plunder is possible
  if (b.hp > 0) return;
  if (inv) inv.buildingsLost++;
  if (legion) {
    legion.buildingsLost++;
    const cs = game.military.caesar;
    if (cs) cs.stats.buildingsLost = (cs.stats.buildingsLost || 0) + 1;
  }
  game.military.stats.buildingsLost++;
  game.city.ratings.peace = Math.max(0, game.city.ratings.peace - 1);
  const now = game.time.totalDays;
  const loud = now - game.military.lastLossMessageDay >= 4;
  if (loud) game.military.lastLossMessageDay = now;
  // Raiders torch most of what they break.
  // (A hippodrome's outer sections burn as the hippodrome does.)
  const who = legion ? 'legion' : 'raid';
  if (game.rng.chance(0.6) && riskRates(mainOf(game, b)).fire > 0) igniteBuilding(game, b, loud ? who : `${who}Quiet`);
  else collapseBuilding(game, b, loud ? who : `${who}Quiet`);
}

/** Raiders (or, `legion`, Caesar's men) hit a wall or gate on tile i. */
function damageWall(game, i, dmg, legion = false) {
  const map = game.map;
  const kind = map.wall[i];
  if (!kind) return;
  const hp = (game.wallHp.get(i) ?? WALL_HP[kind]) - dmg;
  if (hp > 0) { game.wallHp.set(i, hp); return; }
  game.wallHp.delete(i);
  map.wall[i] = Wall.NONE;
  if (!map.road[i]) {
    map.rubble[i] = 1;
    recordRuin(game, [i], TOOLS.wall.name, legion ? 'legionWall' : 'raidWall', { type: 'wall', x: game.map.xOf(i), y: game.map.yOf(i), size: 1 });
  }
  map.touch();
  const now = game.time.totalDays;
  if (now - game.military.lastWallMessageDay >= 5) {
    game.military.lastWallMessageDay = now;
    const who = legion ? 'Caesar\'s legions have' : 'Raiders have';
    game.message(kind === Wall.GATE ? `${who} smashed a gate!` : `${who} broken through a wall!`, 'bad', map.xOf(i), map.yOf(i));
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
export function computeField(game) {
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
 * Other buildings block the way, unless `breakCost` is given: then they can
 * be broken through for that much more (Caesar's legions, sim/legion.js).
 */
export function fillField(game, field, isSource, breakCost = 0) {
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
      if (map.building[j] && !breakCost) continue;
      const t = map.terrain[j];
      if (t === Terrain.ROCK) continue;
      if (t === Terrain.WATER && map.road[j] !== Road.BRIDGE) continue;
      let c = t === Terrain.TREES ? 1.6 : 1;
      if (map.wall[j]) c += FIELD_WALL_COST;
      if (map.building[j]) c += breakCost;
      const nd = d + c;
      if (nd < field[j]) { field[j] = nd; heap.push(nd, j); }
    }
  }
}

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

/**
 * Strength multiplier for a unit: raiders scale with difficulty, Rome's
 * soldiers never do, and neither do Caesar's (the difficulty sets how many
 * he sends, sim/legion.js).
 */
export function enemyPower(game, u) {
  return u.side === 'enemy' && !u.legion && u.type !== 'imperial' ? game.difficulty.enemy : 1;
}

/** One blow or missile: attack (+-25%) less half the target's defense, at least 2. `defense`: the target's now (unitDefense). */
export function rollDamage(game, attDef, tgtDef, power = 1, defense = tgtDef.defense) {
  const raw = attDef.attack * power * (0.75 + game.rng.next() * 0.5) - defense * 0.5;
  return Math.max(2, raw);
}

/**
 * Is a Roman soldier holding position: standing his ground, at his post (by
 * the fort, or where it was deployed) or standing to fight a raider in reach,
 * and not running after one or marching? A trained legionary holding
 * position is in close order. (Colonia's soldiers step out to meet a raider
 * near their post, and deployed ones go out to meet raiders around their
 * rally point, rather than wait in line, so standing still is the test, not
 * the spot: a test of "at his post" alone gave a garrison that charges no
 * close order at all.)
 */
export function holdingPosition(game, u) {
  if (u.moving || !u.fort) return false;
  if (u.state === 'idle') return true;
  if (u.state !== 'engage') return false;
  // Standing to fight means his raider is in reach: one blocked from reaching
  // his raider also stands still, but is no formation.
  const t = u.target ? game.units.get(u.target) : null;
  return !!t && Math.hypot(t.x - u.x, t.y - u.y) <= UNIT_TYPES[u.type].range;
}

/**
 * A unit's defense right now: its type's, plus what training gives
 * (data/units.js): trainedDefense always, holdDefense while holding
 * position. Untrained units (and every raider) have their type's.
 */
export function unitDefense(game, u) {
  const def = UNIT_TYPES[u.type];
  if (!u.trained) return def.defense;
  let d = def.defense + (def.trainedDefense || 0);
  if (def.holdDefense && holdingPosition(game, u)) d += def.holdDefense;
  return d;
}

/** A missile's damage on arrival: a trained legionary holding position takes only holdMissile of it. */
export function missileDamage(game, target, dmg) {
  if (!target.trained) return dmg;
  const share = UNIT_TYPES[target.type].holdMissile;
  return share && holdingPosition(game, target) ? dmg * share : dmg;
}

export function hurt(game, target, dmg) {
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
  const dmg = rollDamage(game, def, UNIT_TYPES[target.type], enemyPower(game, u), unitDefense(game, target));
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
 * Where a soldier may fight right now (see HOLD_REACH). A zone is `spots`
 * (the ground it is measured from: an enemy's distance is to the nearest),
 * `guard` (an enemy this close to it is taken on), `leash` (a fight is given
 * up beyond this), `near` (an enemy this close to the soldier himself is
 * taken on too, inside the leash) and, holding the fort, `self` (an enemy
 * this close to him is fought wherever he is: a man marching home who is
 * struck strikes back) and `hold` (so is one striking at him, see inZone).
 *   Deployed: around the rally point, guard def.aggro * 1.5, leash 4 more,
 *   near his aggro; nothing beyond the leash.
 *   Holding the fort: a legionary or cavalryman, the fort's ranks (every
 *   spot of its formation: the men hold their ground together, or raiders
 *   cut down the front man while the rest look on), guard HOLD_REACH; an
 *   archer, his own post, guard his range. Leash HOLD_LEASH more (an archer:
 *   none).
 */
function fightZone(game, def, fort, post) {
  if (fort.rally) {
    const guard = def.aggro * 1.5;
    return { spots: [fort.rally], guard, leash: guard + 4, near: def.aggro, self: -1, hold: false };
  }
  const guard = def.ranged ? def.range : HOLD_REACH;
  const spots = def.ranged ? [post] : formationSpots(game, fort);
  // (An archer lets go the moment a raider leaves his range: he shoots from his post, never steps out.)
  return { spots, guard, leash: def.ranged ? guard : guard + HOLD_LEASH, near: -1, self: def.range, hold: true };
}

/** Distance from an enemy to the nearest spot of a zone. */
function zoneDistance(zone, e) {
  let best = Infinity;
  for (const s of zone.spots) best = Math.min(best, Math.hypot(e.x - s.x, e.y - s.y));
  return best;
}

/**
 * May the soldier fight this enemy? `keeping`: one he is fighting already
 * (held to the leash, not the guard). A man holding the fort also answers an
 * enemy striking at him from wherever it stands (a slinger out of reach of
 * the ranks has come to him all the same), and only while it does.
 */
function inZone(zone, u, e, keeping) {
  const d = Math.hypot(e.x - u.x, e.y - u.y);
  if (d <= zone.self) return true;
  if (zone.hold && e.target === u.id && d <= UNIT_TYPES[e.type].range + 0.5) return true;
  const dZone = zoneDistance(zone, e);
  if (dZone > zone.leash) return false;
  return keeping || dZone <= zone.guard || d <= zone.near;
}

/**
 * A soldier's choice of enemy: one inside his fight zone. Raiders already
 * fought by several soldiers count as farther away, so a squad spreads its
 * attacks.
 */
function pickTarget(enemies, u, zone) {
  let best = null;
  let bestScore = Infinity;
  for (const e of enemies) {
    if (u.ignore && u.ignore.includes(e.id)) continue;
    if (!inZone(zone, u, e, false)) continue;
    const d = Math.hypot(e.x - u.x, e.y - u.y);
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
  // On a trip to the drill yard in an older save: soldiers at rest no longer
  // go (sim/training.js), so he comes straight home, untrained.
  if (u.drill) endDrill(u);
  const post = postOf(game, u, fort);
  const zone = fightZone(game, def, fort, post);
  let target = u.target ? game.units.get(u.target) : null;
  if (target && (target.side !== 'enemy' || !inZone(zone, u, target, true))) target = null;
  if ((game.time.totalTicks + u.id) % 6 === 0 || !target) {
    const pick = pickTarget(enemies, u, zone);
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
  // No enemy: to (or at) his post.
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

/**
 * A soldier sent to a distant battle (sim/battle.js) marches to the map exit
 * over open land, as to his post, and leaves the province there. One who
 * cannot get there in AWAY_MAX_TICKS (cut off by water, say) is taken to have
 * found another way out.
 */
function marchOut(game, u) {
  const ex = game.map.exit;
  u.state = 'away';
  u.target = 0;
  const d = marchTo(game, u, ex.x + 0.5, ex.y + 0.5, UNIT_TYPES[u.type].speed);
  if (d < 1.2 || game.time.totalTicks - (u.awayTick || 0) > AWAY_MAX_TICKS) leaveForBattle(game, u);
}

/**
 * One tick of a long march over open land to (tx, ty): along an A* route
 * where steering alone would not do, as a soldier marches to his post.
 * (Soldiers leaving for a distant battle, Caesar's men going home.)
 * @returns {number} the distance left before this tick's step
 */
export function marchTo(game, u, tx, ty, speed) {
  if (u.noPath > 0) u.noPath--;
  const d = Math.hypot(tx - u.x, ty - u.y);
  if (u.path) { followUnitPath(game, u, speed); return d; }
  if (d > 5 && u.stuck === 0 && !u.noPath) {
    replan(game, u, tx, ty);
    if (u.path) return d;
  }
  moveToward(game, u, tx, ty, speed);
  if (u.stuck > 20) replan(game, u, tx, ty);
  return d;
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
    // Run for the map edge and vanish there. A warband that came by sea runs
    // back to its landing and boards its ships, while one is still afloat.
    u.state = 'flee';
    const own = inv && inv.id === u.invasion;
    const ships = own && inv.sea && fleeingToShips(game, inv);
    const o = own && (ships || !inv.sea) ? inv.origin : { x: u.x < map.w / 2 ? 0 : map.w - 1, y: u.y };
    moveToward(game, u, o.x + 0.5, o.y + 0.5, def.speed * 1.1);
    const edge = u.x < 1.5 || u.y < 1.5 || u.x > map.w - 1.5 || u.y > map.h - 1.5;
    if (edge || (ships && landingReached(u, inv)) || u.stuck > 60) removeUnit(game, u, 'fled');
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
    // A raider ship's fire pot at a boat or a building (sim/navy.js).
    if (p.pot) { if (!potHit(game, p)) keep.push(p); continue; }
    const t = game.units.get(p.target);
    if (!t) continue; // target gone: the missile falls harmlessly
    const dx = t.x - p.x;
    const dy = t.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d <= p.speed || --p.life <= 0) {
      if (d <= 1) hurt(game, t, missileDamage(game, t, p.damage)); // (close order: judged as it lands)
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
  const fleet = []; // liburnians
  const pirates = []; // raider ships
  for (const u of game.units.values()) {
    u.px = u.x; // previous position: the renderer interpolates between ticks
    u.py = u.y;
    if (UNIT_TYPES[u.type].naval) (u.side === 'enemy' ? pirates : fleet).push(u);
    else (u.side === 'enemy' ? enemies : romans).push(u);
  }
  // pressure = how many soldiers are on each raider (pickTarget spreads attacks)
  for (const e of enemies) e.pressure = 0;
  for (const u of romans) {
    const t = u.target ? game.units.get(u.target) : null;
    if (t) t.pressure++;
  }
  let raiders = false;
  let legionaries = false;
  for (const e of enemies) if (e.legion) legionaries = true; else raiders = true;
  if (raiders) {
    const stale = game.enemyFieldRev !== game.map.revision && game.time.totalTicks - (game.enemyFieldTick || 0) > 20;
    if (!game.enemyField || stale || game.time.totalTicks - (game.enemyFieldTick || 0) > 200) computeField(game);
  }
  if (legionaries) refreshLegionField(game); // Caesar's men walk a field of their own (sim/legion.js)
  // Soldiers on their way out to a distant battle (sim/battle.js) fight no
  // one here, and no one picks a fight with them. (Liburnians sailing out are
  // in `fleet`: sim/navy.js sends them on.)
  const home = romans.some((u) => u.away) ? romans.filter((u) => !u.away) : romans;
  for (const u of romans) {
    if (!game.units.has(u.id)) continue;
    if (u.cooldown > 0) u.cooldown--;
    if (u.away) marchOut(game, u);
    else updateRoman(game, u, enemies);
  }
  for (const u of enemies) {
    if (!game.units.has(u.id)) continue;
    if (u.cooldown > 0) u.cooldown--;
    if (u.legion) updateLegionary(game, u, home);
    else updateRaider(game, u, home);
  }
  if (fleet.length || pirates.length) updateNavy(game, fleet, pirates);
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
  let upkeep = awayUpkeep(game); // men and ships away at a distant battle are paid too (sim/battle.js)
  for (const u of game.units.values()) if (u.side === 'rome') upkeep += UNIT_TYPES[u.type].upkeep;
  if (upkeep > 0) transact(game, 'military', -upkeep);
  m.lastUpkeep = upkeep;

  if (!m.settings || m.nextRaidMonth === null) {
    // Raids switched off (only a debug flag can, mid-game): nothing is coming.
    m.warned = null;
    m.warnStage = 0;
    return;
  }
  if (m.active) return;
  raidWarning(game, m.nextRaidMonth - game.time.totalMonths);
}

/**
 * The coming raid, `left` months before it strikes: at most one message a
 * month, the latest stage due. A raid dated inside a stage's lead (a short
 * interval, a raid put off, a save from before the stages) skips the stages
 * already past rather than bunching them up:
 *
 *   left <= RUMOUR_MONTHS  traders' word (stage 1)
 *   left <= SCOUT_MONTHS   the scouts' report (stage 2): side, size, land or sea
 *   left <= DOOR_MONTHS    a month away (stage 3)
 *   left <= 0              the raid
 *
 * A city under RAID_MIN_POP hears nothing, and at the scouts' check its raid
 * is put off 6 months; if anything had been said, the warband "drifted away".
 */
function raidWarning(game, left) {
  const m = game.military;
  if (game.city.population < RAID_MIN_POP) {
    // Nothing worth raiding yet: push the date back.
    if (left <= SCOUT_MONTHS) {
      m.nextRaidMonth = game.time.totalMonths + 6;
      if (m.warned || m.warnStage > 0) game.message('Scouts report the warband has drifted away, for now.', 'info');
      m.warned = null;
      m.warnStage = 0;
    }
    return;
  }
  if (!m.warned && left <= SCOUT_MONTHS) scoutRaid(game, left);
  else if (m.warned && left <= 0) launchInvasion(game, m.warned.origin, m.warned.size, { sea: !!m.warned.sea });
  else if (m.warned && left <= DOOR_MONTHS && m.warnStage < 3) raidAtTheDoor(game);
  else if (!m.warned && left <= RUMOUR_MONTHS && m.warnStage < 1) {
    m.warnStage = 1;
    // Nothing is drawn yet (side, size and road are the scouts' to find), so
    // the rumour gives only the time.
    game.message(`Traders speak of a warband gathering beyond the frontier, about ${monthsAway(left)}. Scouts will learn its strength and its road nearer the time.`, 'warn', undefined, undefined, { empire: 'warband' });
  }
}

/** "6 months away", "a month away" (or "about to strike" when the day has come). */
function monthsAway(n) {
  if (n <= 0) return 'about to strike';
  return n === 1 ? 'a month away' : `${n} months away`;
}

/**
 * Stage 2, the scouts' report: the warband's side and size, and whether it
 * comes by sea, fixed now and kept in `warned` until the raid. About a third
 * of raids come by sea where ships can sail (sim/navy.js): decided here, on a
 * random stream of its own, so a raid by land draws exactly what it always
 * did. A click opens the empire map on the warband, whose card shows the edge
 * or the landing.
 */
function scoutRaid(game, left) {
  const m = game.military;
  const sea = seaRaidPlan(game);
  if (sea) {
    const size = raidSize(game);
    const e = game.map.seaEntry;
    const when = left <= 0 ? 'any day now' : `in about ${left === 1 ? 'a month' : `${left} months`}`;
    m.warned = { origin: { x: e.x, y: e.y }, size, dir: screenDirection(game.map, e.x, e.y), sea: true, landing: { x: sea.x, y: sea.y } };
    game.message(`Scouts report about ${size} raiders taking to their ships, by sea, from the ${m.warned.dir}. They will come ashore near ${sea.x}, ${sea.y} ${when}. Man the shore, and send the fleet if you have one!`, 'warn', sea.x, sea.y, { empire: 'warband' });
  } else {
    const origin = pickRaidOrigin(game);
    m.warned = { origin, size: raidSize(game), dir: screenDirection(game.map, origin.x, origin.y) };
    game.message(`Scouts report a warband of about ${m.warned.size} raiders gathering to the ${m.warned.dir}, ${monthsAway(left)}. Train soldiers and man your towers!`, 'warn', origin.x, origin.y, { empire: 'warband' });
  }
  m.warnStage = 2;
  game.events.emit('sound', { name: 'horn' });
}

/**
 * Stage 3, a month before the raid; a click glides to where it will come in.
 * By land: its side again. By sea: the landing is looked for again (the city
 * may have built along that shore since the scouts' report; no random
 * draws) and the report is corrected to it. With none (or the Sea raids
 * switch turned off since) the raid will come over land, from a side drawn
 * only at the launch, so the message cannot name one. `warned.sea` stays as
 * it is: the launch decides, exactly as before these warnings.
 */
function raidAtTheDoor(game) {
  const m = game.military;
  const w = m.warned;
  m.warnStage = 3;
  if (!w.sea) {
    game.message(`The warband of about ${w.size} raiders is a month away and will come in from the ${w.dir}. Man the walls and towers!`, 'warn', w.origin.x, w.origin.y);
    return;
  }
  const landing = seaLandingNow(game);
  if (!landing) {
    w.noShore = true;
    game.message(`Raider ships are a month off the coast, about ${w.size} raiders, but they can find no shore to land on. Expect them overland, from a side the scouts cannot yet tell.`, 'warn', undefined, undefined, { empire: 'warband' });
    return;
  }
  const moved = !w.landing || w.landing.x !== landing.x || w.landing.y !== landing.y;
  w.landing = { x: landing.x, y: landing.y };
  delete w.noShore;
  game.message(`Raider ships are a month off the coast: about ${w.size} raiders, making for the shore near ${landing.x}, ${landing.y}${moved ? ' (not where the scouts first thought)' : ''}. Man the shore and send out the fleet!`, 'warn', landing.x, landing.y);
}

/** One warrior of a warband, one roll: horsemen from 1,200 people, slingers from 700. */
export function warbandType(game) {
  const pop = game.city.population;
  const roll = game.rng.next();
  if (pop >= 1200 && roll < 0.22) return 'horseman';
  if (pop >= 700 && roll > 0.8) return 'slinger';
  return 'raider';
}

/**
 * Spawn a warband now. Returns the invasion record. `sea`: it comes by sea
 * (raider ships from the sea entry, sim/navy.js), if the switch is still on
 * and a landing can still be found; else by land from a map edge (a sea
 * entry is no place to walk in from, so the edge is picked again).
 */
export function launchInvasion(game, origin, size, { sea = false } = {}) {
  const m = game.military;
  const map = game.map;
  if (sea && m.seaRaids) {
    const inv = launchSeaInvasion(game, Math.max(1, size || raidSize(game)));
    if (inv) return inv;
  }
  if (!origin || sea) origin = pickRaidOrigin(game);
  size = Math.max(1, size || raidSize(game));
  const inv = { id: m.nextInvasionId++, origin, size, killed: 0, buildingsLost: 0, startDay: game.time.totalDays, fleeing: false, reached: false };
  m.active = inv;
  m.warned = null;
  m.warnStage = 0; // (a raid from the console too: the next date is drawn when it ends, its warnings from nothing)
  m.stats.raids++;
  for (let k = 0; k < size; k++) {
    const type = warbandType(game);
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
  updateDrill(game); // new ships on their way to the Portus, or training there: called home by a raid (sim/training.js)
  const inv = m.active;
  if (inv) {
    // Alive: raiders ashore, and those still aboard their ships (a raid by
    // sea is not over while its ships carry raiders).
    let alive = 0;
    let ashore = 0;
    let camped = 0;
    for (const u of game.units.values()) {
      if (u.side !== 'enemy' || u.invasion !== inv.id) continue;
      if (UNIT_TYPES[u.type].naval) { alive += (u.crew || []).length; continue; }
      alive++;
      ashore++;
      if (u.state === 'camp') camped++;
    }
    // Everyone left is cut off from the city for a few days: give up.
    inv.campDays = ashore > 0 && camped === alive ? (inv.campDays || 0) + 1 : 0;
    // A raid by sea counts its days from the landing (sim/navy.js).
    const days = inv.sea ? seaRaidDays(game, inv) : game.time.totalDays - inv.startDay;
    if (alive === 0) {
      endInvasion(game, inv);
    } else if (!inv.fleeing) {
      if (inv.killed > 0 && alive <= Math.ceil(inv.size * 0.3)) {
        inv.fleeing = true;
        inv.repelled = true;
        game.message(inv.sea && !inv.landed ? 'The raider ships are turning back! Your fleet has broken them at sea.' : 'The raiders are fleeing! Your soldiers have broken the warband.', 'good');
      } else if (inv.sea && !inv.landed && game.time.totalDays - inv.startDay > CONFIG.SEA_SAIL_MAX_DAYS) {
        inv.fleeing = true; // they never got ashore: no plunder
        game.message('The raider ships found no way ashore and sail away.', 'info');
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
  if (!inv && !m.caesar?.army) {
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
  // The raid's missiles are done with; those at Caesar's men (sim/legion.js),
  // still fighting, fly on.
  game.projectiles = game.projectiles.filter((p) => !p.pot && game.units.get(p.target)?.legion);
}

/** Summary for the advisor and HUD. */
export function threatSummary(game) {
  const m = game.military;
  const enemies = enemyCount(game);
  const ships = raiderShipCount(game);
  const legion = legionCount(game); // Caesar's men (sim/legion.js)
  const raiders = enemies - legion;
  const caesar = legionSummary(game);
  // Caesar's legions on the road, as a second line to whatever else is going on.
  const marching = caesar.state === 'marching' ? `Caesar's legions (${caesar.size} men) arrive in ~${caesar.months} month${caesar.months === 1 ? '' : 's'}` : '';
  if (enemies > 0) {
    const who = [legion ? `${legion} of Caesar's legionaries` : '', raiders ? `${raiders} raiders` : ''].filter(Boolean).join(' and ');
    return { level: 'attack', text: `${who} in the province${ships ? ` (${ships} raider ship${ships === 1 ? '' : 's'} offshore)` : ''}${marching ? `. ${marching}` : ''}`, enemies, ships, legion, label: `⚔ ${enemies}` };
  }
  const months = Math.max(0, (m.nextRaidMonth ?? 0) - game.time.totalMonths);
  const inMonths = `${months} month${months === 1 ? '' : 's'}`;
  if (m.warned) {
    // Raider ships that found no shore a month out (raidAtTheDoor) come overland, from a side not known yet.
    const from = m.warned.noShore ? 'overland (their ships found no shore)' : `${m.warned.sea ? 'by sea ' : ''}from the ${m.warned.dir}`;
    return { level: 'warned', text: `About ${m.warned.size} raiders expected ${from} in ~${inMonths}${marching ? `. ${marching}` : ''}`, enemies: 0, sea: !!m.warned.sea, label: '⚠ Raid' };
  }
  if (m.warnStage > 0 && !m.active) {
    // Only the traders' word so far (militaryMonthly): no side or size yet.
    return { level: 'warned', text: `A warband is gathering beyond the frontier, about ${inMonths} away${marching ? `. ${marching}` : ''}`, enemies: 0, rumour: true, label: '⚠ Raid' };
  }
  if (marching) return { level: 'warned', text: marching, enemies: 0, legion: true, label: '⚠ Legions' };
  if (!m.settings) return { level: 'none', text: 'No raids in this province.', enemies: 0 };
  return { level: 'calm', text: 'No known threats.', enemies: 0 };
}

export { WALL_HP, TOWER_RANGE, TOWER_COOLDOWN };
// For Caesar's legionaries (sim/legion.js), who move and fight as raiders do.
export { moveToward as moveUnitToward, attackUnit as attackWith, damageWall as damageWallAt };

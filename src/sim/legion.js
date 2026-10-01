/**
 * legion.js
 * ----------------------------------------------------------------------------
 * Caesar's anger: the legions he sends against a governor whose favor
 * collapsed, and the loss of a city overrun by its enemies. The original's
 * rules, with its plain bugs left out (see the notes below).
 *
 * Favor 0 is not a defeat. Instead, checked daily (after the raids' day):
 *   - with no attack coming or on the map, favor at CONFIG.LEGION_FAVOR or
 *     less sets Caesar's legions marching: a message every time (the
 *     original announced only the first), and LEGION_MARCH_DAYS (12 months)
 *     later the army appears at the map entrance. The march cannot be called
 *     off: favor won back meanwhile only changes what the army does on arrival.
 *   - the army's size: CONFIG.LEGION_SIZES by the number of Caesar's attacks
 *     in this city so far (16, 32, 48, then 72), x the difficulty's raidSize,
 *     at most LEGION_MAX. Every man is an imperial legionary (data/units.js).
 *   - on the map, each day, favor decides (data/difficulty.js legionHalt and
 *     legionHome, the sane order: the original's was swapped):
 *       favor >= legionHome   the army marches home (for good)
 *       favor >= legionHalt   it halts where it stands, still fighting anyone
 *                             who attacks it, during its siege's first
 *                             LEGION_HALT_DAYS; after that it fights on
 *       below                 it attacks
 *   - targets: the governor's residence first, then the homes of the best
 *     level the city has (the nearest of them), then anything. The army
 *     walks a flow field seeded from its targets (sim/military.js fillField)
 *     in which other buildings can be broken through at a cost, so it goes
 *     round the city where it can and through it where it must.
 *   - the end: when no imperial legionary is left, the attack is over. Only
 *     an army destroyed in the field earns the governor Caesar's respect
 *     (+LEGION_RESPECT favor); one that marched home earns nothing (the
 *     original counted men who fled as killed, so a retreat paid the same).
 *     The next day, favor still at 10 or less starts the next, bigger attack.
 *
 * Raids go on as before beside it: a warband and the legions can be in the
 * province at once (sim/military.js keeps them apart: a legionary carries
 * `legion`, a raider `invasion`).
 *
 * Losing (checkOverrun, daily, in a game with goals): more invaders on the
 * map (Caesar's men, raiders ashore or still aboard their ships) than the
 * province's soldiers plus OVERRUN_MARGIN, while the population is under
 * OVERRUN_SHARE of its peak (city.stats.peakPopulation). The original's rule.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { UNIT_TYPES } from '../data/units.js';
import { Terrain, Wall } from '../world/map.js';
import { spawnUnit, removeUnit, passable, fillField, damageBuilding, damageWallAt, moveUnitToward, attackWith, enemyCount, screenDirection, marchTo } from './military.js';
import { residenceOf } from './governor.js';

/** Fresh state: no attack coming, none so far. Kept on game.military.caesar (saved with it). */
export function newCaesarState() {
  return {
    attacks: 0, // attacks that reached the province (sets the next one's size)
    countdown: 0, // days until the legions arrive (0: none on the road)
    size: 0, // men on the road (fixed when they set out)
    marchDays: 0, // their whole march, for the empire map
    army: null, // on the map: { id, size, killed, day, halted, retreating, campDays, buildingsLost }
    nextId: 1,
    stats: { attacks: 0, beaten: 0, withdrew: 0, slain: 0, buildingsLost: 0 },
  };
}

/** Men in Caesar's attack number `n` (0 = the first) on this difficulty. */
export function legionSize(game, n) {
  const sizes = CONFIG.LEGION_SIZES;
  const base = sizes[Math.min(n, sizes.length - 1)];
  return Math.max(1, Math.min(CONFIG.LEGION_MAX, Math.round(base * game.difficulty.raidSize)));
}

/**
 * What the army on the map does at this favor on day `day` of its siege
 * (1 = the day it arrived): 'home', 'halt' or 'attack'.
 */
export function siegeOrder(difficulty, favor, day) {
  if (favor >= difficulty.legionHome) return 'home';
  if (favor >= difficulty.legionHalt && day <= CONFIG.LEGION_HALT_DAYS) return 'halt';
  return 'attack';
}

/** Is Caesar's army on the map? */
export function legionOnMap(game) {
  return !!game.military.caesar?.army;
}

/** Imperial legionaries on the map now. */
export function legionCount(game) {
  let n = 0;
  for (const u of game.units.values()) if (u.legion) n++;
  return n;
}

/** Daily (after the raids' day): the march, the siege, its end, and a new march. */
export function caesarDaily(game) {
  const cs = game.military.caesar;
  if (!cs) return;
  if (cs.army) siegeDay(game, cs);
  else if (cs.countdown > 0) {
    cs.countdown--;
    if (cs.countdown <= 0) launchLegion(game);
  } else if (game.city.ratings.favor <= CONFIG.LEGION_FAVOR) startMarch(game);
  checkOverrun(game);
}

/** Favor has fallen to LEGION_FAVOR or below: the legions set out (always announced). */
export function startMarch(game) {
  const cs = game.military.caesar;
  cs.size = legionSize(game, cs.attacks);
  cs.countdown = CONFIG.LEGION_MARCH_DAYS;
  cs.marchDays = CONFIG.LEGION_MARCH_DAYS;
  const months = Math.round(CONFIG.LEGION_MARCH_DAYS / CONFIG.DAYS_PER_MONTH);
  const again = cs.attacks > 0 ? ' again' : '';
  game.message(`Caesar has lost patience with your governorship (favor ${Math.floor(game.city.ratings.favor)}). ${cs.size} of his legionaries are marching${again} from Rome and will reach the province in ${months} months. Win back his favor before they come and they will turn for home; if not, they will make for your residence and the finest homes. Ready your army!`, 'bad');
  game.events.emit('sound', { name: 'horn' });
}

/**
 * The tiles the army can come in by: the open land nearest the map entrance
 * (breadth-first from it, at most `n`). Empty when the entrance is walled in.
 */
function entryTiles(game, n) {
  const map = game.map;
  const start = map.idx(map.entry.x, map.entry.y);
  const seen = new Set([start]);
  const queue = [start];
  const out = [];
  for (let q = 0; q < queue.length && out.length < n && q < 4000; q++) {
    const i = queue[q];
    const open = passable(game, 'enemy', i);
    if (open) out.push(i);
    // Only open land leads on (and the entrance itself, which may be a gate or an arch).
    if (!open && q > 0) continue;
    const x = map.xOf(i);
    const y = map.yOf(i);
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      if (!map.inBounds(x + dx, y + dy)) continue;
      const j = map.idx(x + dx, y + dy);
      if (!seen.has(j) && map.terrain[j] !== Terrain.WATER && map.terrain[j] !== Terrain.ROCK) { seen.add(j); queue.push(j); }
    }
  }
  return out;
}

/** How long a legionary leaves alone a soldier he could not get at (20 days, as the province's soldiers do). */
const IGNORE_TICKS = 400;

/** A legionary going home is gone after this long, found way or not (a month). */
const LEAVE_TICKS = CONFIG.TICKS_PER_DAY * CONFIG.DAYS_PER_MONTH;

/** Ticks between companies marching in, and between two men of one. */
const COMPANY_TICKS = 100;
const MAN_TICKS = 6;
const COMPANY = 16;

/**
 * Whatever stands on the map entrance comes down before Caesar's men (the
 * original's rule): a gate or wall there, or a building. Without this a gate
 * on the entrance and walls beside it kept the legions out for good: no
 * open land to come in by, the attack never counted, and a new march set out
 * the next day, for ever. @returns {boolean} something was torn down
 */
function breachEntry(game) {
  const map = game.map;
  const i = map.idx(map.entry.x, map.entry.y);
  let broke = false;
  if (map.wall[i]) {
    map.wall[i] = Wall.NONE;
    game.wallHp.delete(i);
    map.touch();
    broke = true;
  }
  const b = map.building[i] ? game.buildings.get(map.building[i]) : null;
  if (b) { damageBuilding(game, b, 1e9, { legion: game.military.caesar.army }); broke = true; }
  if (broke) game.message('Caesar\'s legions have torn down what barred the entrance to the province!', 'bad', map.entry.x, map.entry.y);
  return broke;
}

/**
 * The legions arrive at the map entrance. They come in a column, company
 * after company (each man waits his turn at the entrance). If the entrance
 * itself is barred they tear down what stands on it (breachEntry) and come in
 * there, then break through whatever else is in their way.
 * @returns {object|null} the army (null only if the entrance is not land at all)
 */
export function launchLegion(game, size = 0) {
  const cs = game.military.caesar;
  const n = Math.max(1, size || cs.size || legionSize(game, cs.attacks));
  let tiles = entryTiles(game, Math.min(n, 24));
  if (!tiles.length && breachEntry(game)) tiles = entryTiles(game, Math.min(n, 24));
  cs.countdown = 0;
  cs.size = 0;
  if (!tiles.length) {
    game.message('Caesar\'s legions found no way into the province and turned back. They will come again while his anger lasts.', 'warn');
    return null;
  }
  const army = { id: cs.nextId++, size: n, killed: 0, day: 0, halted: false, retreating: false, campDays: 0, buildingsLost: 0 };
  cs.army = army;
  cs.attacks++;
  cs.stats.attacks++;
  const map = game.map;
  for (let k = 0; k < n; k++) {
    const i = tiles[k % tiles.length];
    const wait = Math.floor(k / COMPANY) * COMPANY_TICKS + (k % COMPANY) * MAN_TICKS;
    spawnUnit(game, 'imperial', map.xOf(i) + 0.5, map.yOf(i) + 0.5, { legion: army.id, state: 'advance', waitTicks: wait });
  }
  computeLegionField(game);
  const e = map.entry;
  const aim = { residence: 'your residence', homes: 'the finest homes', anything: 'whatever stands in the province' }[legionTargets(game).what];
  game.message(`Caesar's legions have arrived: ${n} imperial legionaries are marching in from the ${screenDirection(map, e.x, e.y)}, making for ${aim}!`, 'bad', e.x, e.y);
  game.events.emit('sound', { name: 'horn' });
  game.events.emit('invasion', { legion: army.id });
  return army;
}

/** A day of the siege: favor's orders, a stuck army, and the end. */
function siegeDay(game, cs) {
  const a = cs.army;
  a.day++;
  let alive = 0;
  let camped = 0;
  for (const u of game.units.values()) {
    if (u.legion !== a.id) continue;
    alive++;
    if (u.state === 'camp') camped++;
  }
  if (alive === 0) { endLegion(game, cs); return; }
  if (a.retreating) return;
  const order = siegeOrder(game.difficulty, game.city.ratings.favor, a.day);
  if (order === 'home') {
    a.retreating = true;
    a.halted = false;
    game.message('Your favor in Rome is restored: Caesar\'s legions turn for home.', 'good');
    return;
  }
  if (order === 'halt' && !a.halted) game.message('Caesar\'s favor is softening: his legions halt where they stand. Win back more of it and they will go home; lose it and they will attack again.', 'imperial');
  else if (order === 'attack' && a.halted) {
    game.message(a.day > CONFIG.LEGION_HALT_DAYS ? 'Caesar\'s patience is spent: after a year at your gates his legions attack again.' : 'Caesar\'s favor has fallen again: his legions resume the attack!', 'bad');
  }
  a.halted = order === 'halt';
  // Nothing left they can reach (the city across a river, say): they go home.
  a.campDays = camped === alive && !a.halted ? a.campDays + 1 : 0;
  if (a.campDays >= CONFIG.LEGION_CAMP_DAYS) {
    a.retreating = true;
    game.message('Caesar\'s legions find nothing more they can reach and march home.', 'info');
  } else if (a.day > CONFIG.LEGION_MAX_DAYS) {
    // A backstop: whatever holds them (a fight they can never finish), no
    // army stays for ever, blocking the repairs, the drill yards and the next attack.
    a.retreating = true;
    game.message('After two years in the province Caesar\'s legions march home.', 'info');
  }
}

/** Respect for a governor who destroyed Caesar's army: the first, second, third and later wordings. */
const RESPECT_TEXT = [
  'Caesar\'s legions are destroyed. The Emperor grudgingly respects a governor who will fight for his city.',
  'Caesar\'s second army lies dead before your walls. Rome talks of little else; the Emperor\'s respect for you grows.',
  'Again Caesar\'s legions have fallen to your soldiers. The Emperor respects your stand, if not your governorship.',
];

/** The last imperial legionary is gone: the attack is over. */
function endLegion(game, cs) {
  const a = cs.army;
  cs.army = null;
  game.legionField = null;
  const r = game.city.ratings;
  if (!a.retreating) {
    r.favor = Math.min(100, r.favor + CONFIG.LEGION_RESPECT);
    cs.stats.beaten++;
    game.message(`${RESPECT_TEXT[Math.min(cs.attacks, RESPECT_TEXT.length) - 1] || RESPECT_TEXT[0]} (+${CONFIG.LEGION_RESPECT} favor)`, 'good');
    game.events.emit('sound', { name: 'fanfare' });
  } else {
    cs.stats.withdrew++;
    game.message('The last of Caesar\'s legions has left the province.', 'info');
  }
}

// ---------------------------------------------------------------------------
// The army on the map
// ---------------------------------------------------------------------------

/** The best level of home that has people in it (-1: none). */
function bestHomeTier(game) {
  let best = -1;
  for (const b of game.buildings.values()) if (b.house && b.house.pop > 0 && b.house.tier > best) best = b.house.tier;
  return best;
}

/**
 * What the army goes for now: the residence; else the homes of the best
 * level with people in them; else any building. As { key, isTarget }.
 */
export function legionTargets(game) {
  const res = residenceOf(game);
  if (res) return { key: `r${res.id}`, isTarget: (id) => id === res.id, what: 'residence' };
  const tier = bestHomeTier(game);
  if (tier >= 0) {
    return { key: `h${tier}`, isTarget: (id) => { const b = game.buildings.get(id); return !!(b && b.house && b.house.pop > 0 && b.house.tier === tier); }, what: 'homes' };
  }
  return { key: 'any', isTarget: () => true, what: 'anything' };
}

/** The army's flow field toward its targets, other buildings breakable at LEGION_BREAK_COST. */
export function computeLegionField(game) {
  const map = game.map;
  let field = game.legionField;
  if (!field || field.length !== map.size) field = game.legionField = new Float32Array(map.size);
  const t = legionTargets(game);
  fillField(game, field, t.isTarget, CONFIG.LEGION_BREAK_COST);
  game.legionFieldKey = t.key;
  game.legionFieldRev = map.revision;
  game.legionFieldTick = game.time.totalTicks;
}

/** Per tick, before the legionaries move: keep their field fresh (cheap when nothing changed). */
export function refreshLegionField(game) {
  const now = game.time.totalTicks;
  const age = now - (game.legionFieldTick || 0);
  if (game.legionField && age < 20) return;
  const stale = !game.legionField || game.legionFieldRev !== game.map.revision || age > 200;
  if (stale || legionTargets(game).key !== game.legionFieldKey) computeLegionField(game);
}

/** The nearest Roman soldier within `range`, or null. */
function nearestRoman(romans, u, range) {
  let best = null;
  let bestD = range;
  for (const r of romans) {
    if (u.ignore && u.ignore.includes(r.id)) continue; // (out of his reach: see IGNORE_TICKS)
    const d = Math.hypot(r.x - u.x, r.y - u.y);
    if (d <= bestD) { bestD = d; best = r; }
  }
  return best;
}

/**
 * One imperial legionary, per tick (sim/military.js updateMilitary): wait his
 * turn at the entrance, fight soldiers who come close, and otherwise march
 * on his targets, halt, or go home as the army's orders say.
 */
export function updateLegionary(game, u, romans) {
  const def = UNIT_TYPES[u.type];
  const map = game.map;
  const a = game.military.caesar?.army;
  if (u.waitTicks > 0) { u.waitTicks--; u.moving = false; u.state = 'advance'; return; }
  if (!a || a.id !== u.legion || a.retreating) {
    // Home: back out by the map entrance. One who cannot find the way in a
    // month (a wall without a breach between him and it) is gone anyway.
    if (u.state !== 'flee') { u.state = 'flee'; u.leaveTick = game.time.totalTicks; u.path = null; u.target = 0; }
    const e = map.entry;
    const d = marchTo(game, u, e.x + 0.5, e.y + 0.5, def.speed * 1.1);
    const edge = u.x < 1.5 || u.y < 1.5 || u.x > map.w - 1.5 || u.y > map.h - 1.5;
    if (d < 1.2 || edge || game.time.totalTicks - (u.leaveTick || 0) > LEAVE_TICKS) removeUnit(game, u, 'fled');
    return;
  }
  // Soldiers who come close are fought, halted or not. One he cannot get at
  // (across a river, on an island) he leaves alone for a while, as the
  // province's soldiers do (sim/military.js updateRoman): locked on such a
  // man the army would stand there for ever, never camped, never done.
  if (u.ignore && game.time.totalTicks > u.ignoreUntil) u.ignore = null;
  let target = u.target ? game.units.get(u.target) : null;
  if (target && (Math.hypot(target.x - u.x, target.y - u.y) > def.aggro * 1.6 || (u.ignore && u.ignore.includes(target.id)))) target = null;
  if ((game.time.totalTicks + u.id) % 6 === 0 || !target) target = nearestRoman(romans, u, def.aggro) || target;
  u.target = target ? target.id : 0;
  if (target) {
    u.state = 'fight';
    const d = Math.hypot(target.x - u.x, target.y - u.y);
    if (d <= def.range) { u.moving = false; u.stuck = 0; if (u.cooldown <= 0) attackWith(game, u, def, target); return; }
    moveUnitToward(game, u, target.x, target.y, def.speed);
    if (u.stuck > 20) {
      (u.ignore ||= []).push(target.id);
      u.ignoreUntil = game.time.totalTicks + IGNORE_TICKS;
      u.target = 0;
      u.stuck = 0;
    }
    return;
  }
  if (a.halted) { u.state = 'halt'; u.moving = false; return; }
  marchOnTargets(game, u, def, a);
}

/**
 * Downhill on the legion field: strike a target beside him; else step to the
 * lowest neighbor, breaking the building or wall that stands there if it is
 * the way on.
 */
function marchOnTargets(game, u, def, army) {
  const map = game.map;
  const field = game.legionField;
  if (!field) { u.state = 'camp'; u.moving = false; return; }
  const tx = Math.floor(u.x);
  const ty = Math.floor(u.y);
  const here = map.idx(tx, ty);
  let best = -1;
  let bestV = field[here];
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const nx = tx + dx;
    const ny = ty + dy;
    if (!map.inBounds(nx, ny)) continue;
    const j = map.idx(nx, ny);
    if (map.building[j] && field[j] === 0) { best = j; break; } // a target beside him: strike it
    if (dx !== 0 && dy !== 0) continue; // walk orthogonally, strike diagonally
    if (field[j] < bestV) { bestV = field[j]; best = j; }
  }
  if (best < 0) { u.state = 'camp'; u.moving = false; return; }
  if (map.building[best] || map.wall[best]) {
    u.state = 'siege';
    u.moving = false;
    const sdx = (map.xOf(best) - tx) - (map.yOf(best) - ty);
    if (sdx !== 0) u.facing = sdx > 0 ? 1 : -1;
    if (u.cooldown > 0) return;
    u.cooldown = def.cooldown;
    u.strikeTick = game.time.totalTicks;
    const dmg = def.siege * (0.75 + game.rng.next() * 0.5);
    if (map.building[best]) {
      const b = game.buildings.get(map.building[best]);
      if (b) damageBuilding(game, b, dmg, { legion: army });
    } else damageWallAt(game, best, dmg, true);
    return;
  }
  u.state = 'advance';
  moveUnitToward(game, u, map.xOf(best) + 0.5 + u.ox, map.yOf(best) + 0.5 + u.oy, def.speed);
}

// ---------------------------------------------------------------------------
// Losing: the city overrun
// ---------------------------------------------------------------------------

/** The province's soldiers on the map (land units: ships cannot hold a street). */
export function soldierCount(game) {
  let n = 0;
  for (const u of game.units.values()) if (u.side === 'rome' && !UNIT_TYPES[u.type].naval && !u.away) n++;
  return n;
}

/**
 * Is the city overrun? More invaders than soldiers + OVERRUN_MARGIN while
 * the population is under OVERRUN_SHARE of its peak.
 */
export function isOverrun(game) {
  const invaders = enemyCount(game);
  if (invaders <= soldierCount(game) + CONFIG.OVERRUN_MARGIN) return false;
  const peak = game.city.stats.peakPopulation || 0;
  return game.city.population < peak * CONFIG.OVERRUN_SHARE;
}

/** Daily: a mission (a game with goals) whose city is overrun is lost. */
export function checkOverrun(game) {
  const c = game.city;
  if (c.defeat || c.victory) return false;
  if (!(game.scenario.goals && Object.values(game.scenario.goals).some((v) => v > 0))) return false;
  if (!isOverrun(game)) return false;
  c.defeat = true;
  const legions = legionCount(game) > 0;
  game.events.emit('defeat', {
    reason: `Your city has been overrun: ${enemyCount(game)} ${legions ? 'of Caesar\'s soldiers and other invaders' : 'invaders'} hold its streets against ${soldierCount(game)} soldiers of yours, and only ${c.population} of the ${c.stats.peakPopulation} people who once lived here remain. Rome has sent a new governor.`,
  });
  return true;
}

/** For the advisors and the empire map: what Caesar's anger is doing now. */
export function legionSummary(game) {
  const cs = game.military.caesar;
  if (!cs) return { state: 'none' };
  if (cs.army) {
    const a = cs.army;
    return { state: a.retreating ? 'leaving' : a.halted ? 'halted' : 'attack', men: legionCount(game), size: a.size, day: a.day };
  }
  if (cs.countdown > 0) {
    return { state: 'marching', size: cs.size, days: cs.countdown, months: Math.ceil(cs.countdown / CONFIG.DAYS_PER_MONTH), frac: cs.marchDays ? 1 - cs.countdown / cs.marchDays : 0 };
  }
  return { state: 'none', next: legionSize(game, cs.attacks) };
}

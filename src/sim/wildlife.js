/**
 * wildlife.js
 * ----------------------------------------------------------------------------
 * Wolf packs: the original's wolves, fitted to Colonia.
 *
 * Where: on the maps of the missions data/wildlife.js names (and a sandbox
 * whose setup asks), 1 to 4 packs by the map's land, each of 6 to 8 wolves,
 * with a den in a wood far from the map's entry and its road. The dens are
 * drawn once, at a new game, from the map's seed on a stream of their own
 * (placePacks), so a map without wolves is made exactly as before.
 *
 * Wolves are units (side 'wild', data/units.js), moving over open land like
 * raiders, never through buildings, walls, gates or water, and they break
 * nothing. They are hostile to Rome (sim/military.js hostileToRome), so
 * soldiers, watchtowers and prefects fight them, but they are no enemy in
 * the province: they hold up no victory and cost no peace.
 *
 * A pack:
 *   - rests at its spot and every WOLF.roamDays moves on, up to
 *     WOLF.roamReach tiles, to open land (no road or building) with little
 *     desirability (the edge of the city, never its heart; in winter a
 *     little nearer), no building within WOLF.roamClear nor road within
 *     WOLF.roamRoad (openGround), no Roman soldier near, and never more than
 *     WOLF.roamLeash from its den; at once, when the city builds up the
 *     ground where it rests. Each move is drawn from the seed, the pack and
 *     the day, so nothing about it needs saving but the spot. (Colonia's
 *     own clearances, with the rest after a kill below: with buildings kept
 *     only 3 tiles off and no rest, Mutina's packs settled beside the demo
 *     city and killed 166 walkers in three years; now 5.)
 *   - hunts: a walker who comes within WOLF.notice of a wolf sets the whole
 *     pack on. Each wolf then runs at the nearest walker within
 *     WOLF.huntReach of it (one another wolf is on counts twice as far, so
 *     they spread), not beyond WOLF.huntLeash of the pack's spot, and bites
 *     him: the difficulty's wolfBite a bite against a walker's 20 health
 *     (sim/walkerHarm.js), so a walker dies in 5 bites on Easy, 4 on Normal,
 *     3 on Hard and Insane. A walker being bitten stands (held), as one held
 *     by a prefect does. A kill ends the hunt: the pack has fed and hunts
 *     no more for WOLF.fedDays. With no prey for WOLF.huntCalm ticks, the
 *     pack also goes back to its rest. Wolves leave alone ships and boats, prefects
 *     (armed: they fight wolves as raiders, sim/prefectFight.js), soldiers
 *     at rest and raiders.
 *   - fights back: a wolf a soldier or prefect strikes bites him back.
 *   - grows back: while one wolf lives, the pack gains one every
 *     WOLF.refillDays at its spot, up to its size. Only killing every wolf
 *     ends a pack for good.
 *
 * Messages: the first walker a pack kills, then at most one about wolves
 * every WOLF.messageDays; and the end of a pack.
 *
 * State (saved, core/save.js `wildlife`):
 *   game.wildlife = { packs: [pack], nextPackId, lastMessageDay, stats }
 *     pack = { id, den: {x, y}, spot: {x, y}, size, nextMoveDay, refillDay
 *              (null: full), hunting, lastPreyTick, fedUntil (a tick),
 *              told, walkersKilled }
 *     stats = { wolvesKilled, walkersKilled, packsCleared }
 *   each wolf: a unit with `pack` (its pack's id) and `prey` (a walker id).
 * An older save without `wildlife` loads with no packs (emptyWildlife).
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { RNG } from '../core/rng.js';
import { UNIT_TYPES } from '../data/units.js';
import { WALKER_TYPES } from '../data/walkers.js';
import { WOLF, WOLVES_BY_MISSION } from '../data/wildlife.js';
import { Terrain } from '../world/map.js';
import { Unit, removeUnit, passable, marchTo, moveUnitToward, rollDamage, unitDefense, hurt } from './military.js';
import { fightPrefect } from './prefectFight.js';
import { canHarm, harmWalker } from './walkerHarm.js';
import { seasonOf } from './time.js';
import { withArticle } from './risk.js';

/** No packs: a map without wolves, or an older save. */
export function emptyWildlife() {
  return { packs: [], nextPackId: 1, lastMessageDay: -999, stats: { wolvesKilled: 0, walkersKilled: 0, packsCleared: 0 } };
}

/**
 * Does a new game of this scenario have wolves? The flag (wolves=on|off, the
 * sim's --wolves) decides if given; else a sandbox's setup (scenario.wolves),
 * or the mission's own (data/wildlife.js). Never on the desert map.
 */
export function wolvesWanted(scenario, flag = null) {
  if (flag === 'on') return true;
  if (flag === 'off') return false;
  if (scenario?.map?.type === 'desert') return false;
  if (!scenario || scenario.id === 'sandbox') return !!scenario?.wolves;
  return !!WOLVES_BY_MISSION[scenario.id];
}

/** Wildlife for a new game: its packs placed and their wolves on the map. */
export function newWildlife(game, scenario, flags = {}) {
  const wl = emptyWildlife();
  if (wolvesWanted(scenario, flags.wolves)) placePacks(game, wl);
  return wl;
}

/** The wolves a game's packs have, by pack id. */
export function wolfCounts(game) {
  const out = new Map();
  for (const u of game.units.values()) if (u.type === 'wolf') out.set(u.pack, (out.get(u.pack) || 0) + 1);
  return out;
}

/** A pack by id, or null. */
export function packOf(game, id) {
  return game.wildlife?.packs.find((p) => p.id === id) || null;
}

// ---------------------------------------------------------------------------
// Placement (a new game)
// ---------------------------------------------------------------------------

/**
 * Dens for a new game's packs: tree tiles deep in a wood (WOLF.denWoods
 * trees around), far from the map's entry, exit and Imperial road, and far
 * from each other, drawn on the map's own wildlife stream. A map with too
 * few woods gets fewer packs, or none.
 */
export function placePacks(game, wl) {
  const map = game.map;
  const rng = new RNG(`${game.seed}:wildlife`);
  let land = 0;
  for (let i = 0; i < map.size; i++) if (map.terrain[i] !== Terrain.WATER) land++;
  const want = Math.max(1, Math.min(WOLF.maxPacks, Math.round(land / WOLF.landPerPack)));
  const roads = [];
  for (let i = 0; i < map.size; i++) if (map.fixedRoad[i] || map.road[i]) roads.push(i);
  const far = (x, y, pt, d) => Math.hypot(x - pt.x, y - pt.y) >= d;
  const cands = [];
  for (let y = 3; y < map.h - 3; y++) {
    for (let x = 3; x < map.w - 3; x++) {
      const i = map.idx(x, y);
      if (map.terrain[i] !== Terrain.TREES || !passable(game, 'wild', i)) continue;
      if (!far(x, y, map.entry, WOLF.denFromEntry) || !far(x, y, map.exit, WOLF.denFromEntry)) continue;
      let trees = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (map.terrain[map.idx(x + dx, y + dy)] === Terrain.TREES) trees++;
      if (trees < WOLF.denWoods) continue;
      cands.push({ x, y });
    }
  }
  rng.shuffle(cands);
  const dens = [];
  for (const c of cands) {
    if (dens.length >= want) break;
    if (dens.some((d) => !far(c.x, c.y, d, WOLF.denApart))) continue;
    if (roads.some((i) => Math.hypot(map.xOf(i) - c.x, map.yOf(i) - c.y) < WOLF.denFromRoad)) continue;
    dens.push(c);
  }
  for (const den of dens) makePack(game, wl, den, rng);
}

/** A pack of 6 to 8 at `den`, its wolves on the map, drawn on `rng`. */
function makePack(game, wl, den, rng) {
  const pack = {
    id: wl.nextPackId++, den: { x: den.x, y: den.y }, spot: { x: den.x, y: den.y }, size: rng.range(WOLF.packMin, WOLF.packMax),
    nextMoveDay: game.time.totalDays + WOLF.roamDays, refillDay: null, hunting: false, lastPreyTick: 0, fedUntil: 0, told: false, walkersKilled: 0,
  };
  wl.packs.push(pack);
  for (let n = 0; n < pack.size; n++) spawnWolf(game, pack, rng);
  return pack;
}

/**
 * A new pack with its den at the nearest land a wolf can stand on to (x, y)
 * (the console's "wolves here", tests): its size and its wolves drawn from
 * the seed, the place and the day. Null when there is no land near.
 */
export function addPackAt(game, x, y) {
  const map = game.map;
  let den = null;
  for (let r = 0; r <= 4 && !den; r++) {
    for (let dy = -r; dy <= r && !den; dy++) {
      for (let dx = -r; dx <= r && !den; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (map.inBounds(tx, ty) && passable(game, 'wild', map.idx(tx, ty))) den = { x: tx, y: ty };
      }
    }
  }
  if (!den) return null;
  game.wildlife ??= emptyWildlife();
  return makePack(game, game.wildlife, den, new RNG(`${game.seed}:wolves:new:${den.x},${den.y}:${game.time.totalDays}`));
}

/**
 * A wolf of `pack` on open land near its spot. Drawn on `rng` (the wildlife
 * stream, or the day's), never the game's own, so the city's draws stay as
 * they were.
 */
function spawnWolf(game, pack, rng) {
  const map = game.map;
  let x = pack.spot.x;
  let y = pack.spot.y;
  for (let t = 0; t < 12; t++) {
    const tx = pack.spot.x + rng.range(-2, 2);
    const ty = pack.spot.y + rng.range(-2, 2);
    if (map.inBounds(tx, ty) && passable(game, 'wild', map.idx(tx, ty))) { x = tx; y = ty; break; }
  }
  const u = new Unit(game.nextUnitId++, 'wolf', x + 0.5, y + 0.5);
  u.ox = (rng.next() - 0.5) * 0.5;
  u.oy = (rng.next() - 0.5) * 0.5;
  u.pack = pack.id;
  u.prey = 0;
  u.state = 'rest';
  game.units.set(u.id, u);
  return u;
}

// ---------------------------------------------------------------------------
// Per tick (sim/military.js updateMilitary)
// ---------------------------------------------------------------------------

/**
 * Every wolf's tick. `romans`: the province's soldiers at home (those
 * striking at a wolf are bitten back).
 */
export function updateWolves(game, wolves, romans) {
  const wl = game.wildlife;
  if (!wl) return;
  const now = game.time.totalTicks;
  const bite = { ...UNIT_TYPES.wolf, attack: game.difficulty.wolfBite ?? UNIT_TYPES.wolf.attack };
  // A soldier striking at a wolf (it bites back), and how many wolves are on each walker (they spread).
  const foes = new Map();
  for (const r of romans) {
    const t = r.target ? game.units.get(r.target) : null;
    if (t && t.side === 'wild' && !foes.has(t.id)) foes.set(t.id, r);
  }
  const chased = new Map();
  for (const u of wolves) if (u.prey) chased.set(u.prey, (chased.get(u.prey) || 0) + 1);
  for (const u of wolves) {
    if (!game.units.has(u.id)) continue;
    if (u.cooldown > 0) u.cooldown--;
    const pack = packOf(game, u.pack);
    if (!pack) { removeUnit(game, u, 'fled'); continue; }
    updateWolf(game, u, pack, bite, foes.get(u.id), chased, now);
  }
  for (const p of wl.packs) if (p.hunting && now - p.lastPreyTick > WOLF.huntCalm) p.hunting = false;
}

function updateWolf(game, u, pack, def, foe, chased, now) {
  // 1. A soldier striking at him, in reach: he bites back.
  if (foe && game.units.has(foe.id) && Math.hypot(foe.x - u.x, foe.y - u.y) <= def.range + 0.4) {
    u.state = 'fight';
    u.target = foe.id; // (the renderer turns him to face it)
    u.moving = false;
    face(u, foe.x, foe.y);
    if (u.cooldown <= 0) {
      strike(game, u, def);
      hurt(game, foe, rollDamage(game, def, UNIT_TYPES[foe.type], 1, unitDefense(game, foe)));
    }
    return;
  }
  if (u.target) u.target = 0;
  // 2. A prefect fighting him: he turns on the prefect (sim/prefectFight.js).
  if (fightPrefect(game, u, def)) return;
  // 3. The pack is hunting: the nearest walker in reach.
  if (pack.hunting) {
    const w = preyFor(game, u, pack, chased, now);
    if (w) { chase(game, u, pack, w, def, now); return; }
  }
  if (u.prey) u.prey = 0;
  // 4. A walker near him sets the pack on (looked for every few ticks),
  // unless the pack has just fed.
  if ((now + u.id) % 5 === 0 && !(now < (pack.fedUntil || 0)) && walkerNear(game, u, WOLF.notice)) {
    pack.hunting = true;
    pack.lastPreyTick = now;
  }
  // 5. Back to the pack's spot, each wolf to his own place in it.
  const a = u.id * 2.39996; // (the golden angle: places spread round the spot)
  const r = 0.6 + (u.id % 3) * 0.55;
  const tx = pack.spot.x + 0.5 + Math.cos(a) * r;
  const ty = pack.spot.y + 0.5 + Math.sin(a) * r;
  if (Math.hypot(tx - u.x, ty - u.y) < 0.3 || (u.stuck > 30 && Math.hypot(tx - u.x, ty - u.y) < 2.5)) {
    u.state = 'rest';
    u.moving = false;
    u.path = null;
    u.stuck = 0;
    return;
  }
  // A route planned for the pack's last spot (or a hunt) is no good for this one.
  const goal = `${pack.spot.x},${pack.spot.y}`;
  if (u.goal !== goal) { u.path = null; u.goal = goal; }
  u.state = 'prowl';
  marchTo(game, u, tx, ty, def.speed * 0.6);
}

/** A walker within `d` tiles of the wolf, that a wolf can bite? */
function walkerNear(game, u, d) {
  for (const w of game.walkers.values()) {
    if (Math.abs(w.x + 0.5 - u.x) > d || Math.abs(w.y + 0.5 - u.y) > d) continue;
    if (canHarm(w) && Math.hypot(w.x + 0.5 - u.x, w.y + 0.5 - u.y) <= d) return w;
  }
  return null;
}

/**
 * The walker a hunting wolf goes for: the one he has, while it can still be
 * bitten and is on the pack's ground; looked for afresh every few ticks:
 * the nearest within WOLF.huntReach of him and WOLF.huntLeash of the pack's
 * spot, one another wolf is on counting twice as far.
 */
function preyFor(game, u, pack, chased, now) {
  const onGround = (w) => Math.hypot(w.x + 0.5 - (pack.spot.x + 0.5), w.y + 0.5 - (pack.spot.y + 0.5)) <= WOLF.huntLeash;
  let w = u.prey ? game.walkers.get(u.prey) : null;
  if (w && (!canHarm(w) || !onGround(w))) w = null;
  if (w && (now + u.id) % 6 !== 0) return w;
  let best = w;
  let bestD = w ? Math.hypot(w.x + 0.5 - u.x, w.y + 0.5 - u.y) : Infinity;
  for (const p of game.walkers.values()) {
    if (Math.abs(p.x + 0.5 - u.x) > WOLF.huntReach || Math.abs(p.y + 0.5 - u.y) > WOLF.huntReach) continue;
    if (!canHarm(p) || !onGround(p)) continue;
    const d = Math.hypot(p.x + 0.5 - u.x, p.y + 0.5 - u.y);
    if (d > WOLF.huntReach) continue;
    const others = (chased.get(p.id) || 0) - (p.id === u.prey ? 1 : 0);
    const score = others > 0 ? d * 2 : d;
    if (score < bestD) { bestD = score; best = p; }
  }
  return best;
}

/** Run at a walker and bite him. */
function chase(game, u, pack, w, def, now) {
  u.prey = w.id;
  u.path = null; // (straight at him; a route home is planned afresh after)
  u.goal = null;
  pack.lastPreyTick = now;
  u.state = 'hunt';
  const wx = w.x + 0.5;
  const wy = w.y + 0.5;
  if (Math.hypot(wx - u.x, wy - u.y) > def.range + 0.3) {
    moveUnitToward(game, u, wx, wy, def.speed);
    if (u.stuck > 30) { u.prey = 0; u.stuck = 0; } // (no way to him: another, next look)
    return;
  }
  u.moving = false;
  w.held = Math.max(w.held || 0, 2); // (he stands while the wolves are on him)
  face(u, wx, wy);
  if (u.cooldown > 0) return;
  strike(game, u, def);
  const what = WALKER_TYPES[w.type]?.name.toLowerCase() || 'citizen';
  const x = w.x;
  const y = w.y;
  if (!harmWalker(game, w, def.attack)) return;
  u.prey = 0;
  // A kill ends the hunt: the pack eats and rests a while (Colonia's own:
  // without it a pack beside a busy road hunted without end).
  pack.hunting = false;
  pack.fedUntil = now + WOLF.fedDays * CONFIG.TICKS_PER_DAY;
  const wl = game.wildlife;
  pack.walkersKilled = (pack.walkersKilled || 0) + 1;
  wl.stats.walkersKilled++;
  const day = game.time.totalDays;
  if (!pack.told || day - wl.lastMessageDay >= WOLF.messageDays) {
    pack.told = true;
    wl.lastMessageDay = day;
    game.message(`Wolves killed ${withArticle(what)} near ${x}, ${y}. Soldiers sent there can clear the pack; while one wolf lives it grows back.`, 'bad', x, y);
  }
}

function face(u, x, y) {
  const sdx = (x - u.x) - (y - u.y);
  if (Math.abs(sdx) > 0.01) u.facing = sdx > 0 ? 1 : -1;
}

function strike(game, u, def) {
  u.cooldown = def.cooldown;
  u.strikeTick = game.time.totalTicks;
  game.events.emit('sound', { name: 'clash' });
}

// ---------------------------------------------------------------------------
// Daily (core/game.js onDay)
// ---------------------------------------------------------------------------

/**
 * Each pack's day: a pack with no wolf left is gone; one short of its size
 * grows a wolf back every WOLF.refillDays; one at rest moves on every
 * WOLF.roamDays. Every draw comes from the seed, the pack and the day.
 */
export function wildlifeDaily(game) {
  const wl = game.wildlife;
  if (!wl || !wl.packs.length) return;
  const day = game.time.totalDays;
  const counts = wolfCounts(game);
  for (const pack of [...wl.packs]) {
    const n = counts.get(pack.id) || 0;
    if (n === 0) {
      wl.packs = wl.packs.filter((p) => p !== pack);
      wl.stats.packsCleared++;
      game.message(`The wolf pack near ${pack.spot.x}, ${pack.spot.y} is no more. The roads there are safe.`, 'good', pack.spot.x, pack.spot.y);
      continue;
    }
    if (n < pack.size) {
      if (pack.refillDay === null || pack.refillDay === undefined) pack.refillDay = day + WOLF.refillDays;
      else if (day >= pack.refillDay) {
        spawnWolf(game, pack, new RNG(`${game.seed}:wolves:${pack.id}:cub:${day}`));
        pack.refillDay = n + 1 < pack.size ? day + WOLF.refillDays : null;
      }
    } else pack.refillDay = null;
    // At rest, it moves on every few days, and at once when the city has
    // built up its ground (a building or road too near its spot).
    const crowded = !openGround(game.map, pack.spot.x, pack.spot.y);
    if (!pack.hunting && (day >= pack.nextMoveDay || crowded)) {
      const spot = roamSpot(game, pack, new RNG(`${game.seed}:wolves:${pack.id}:${day}`));
      if (spot) pack.spot = spot;
      pack.nextMoveDay = day + WOLF.roamDays;
    }
  }
}

/**
 * Where a pack moves on to: open land within WOLF.roamReach of its spot (or,
 * when nothing there will do, anywhere within WOLF.roamLeash of its den),
 * never farther than WOLF.roamLeash from the den, with no road or building
 * on it, none within WOLF.roamClear and WOLF.roamRoad (openGround), no
 * Roman soldier within WOLF.roamSoldiers, and desirability at most
 * WOLF.roamDesire (in winter WOLF.roamDesireWinter). A few tries, or it stays.
 */
export function roamSpot(game, pack, rng) {
  const map = game.map;
  const limit = seasonOf(game.time.month) === 'winter' ? WOLF.roamDesireWinter : WOLF.roamDesire;
  const soldiers = [];
  for (const u of game.units.values()) if (u.side === 'rome' && !UNIT_TYPES[u.type].naval) soldiers.push(u);
  for (let t = 0; t < 24; t++) {
    // The first tries near where it is; then from the den, its whole ground.
    const from = t < 12 ? pack.spot : pack.den;
    const reach = t < 12 ? WOLF.roamReach : WOLF.roamLeash;
    const a = rng.next() * Math.PI * 2;
    const d = 3 + rng.next() * (reach - 3);
    const x = Math.round(from.x + Math.cos(a) * d);
    const y = Math.round(from.y + Math.sin(a) * d);
    if (!map.inBounds(x, y) || Math.hypot(x - pack.den.x, y - pack.den.y) > WOLF.roamLeash) continue;
    const i = map.idx(x, y);
    if (!passable(game, 'wild', i) || map.desirability[i] > limit || !openGround(map, x, y)) continue;
    if (soldiers.some((s) => Math.hypot(s.x - (x + 0.5), s.y - (y + 0.5)) < WOLF.roamSoldiers)) continue;
    return { x, y };
  }
  return null;
}

/** No building within WOLF.roamClear of (x, y), and no road within WOLF.roamRoad: the wolves' kind of ground. */
export function openGround(map, x, y) {
  const r = WOLF.roamClear;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!map.inBounds(tx, ty)) continue;
      const i = map.idx(tx, ty);
      if (map.building[i]) return false;
      if ((map.road[i] || map.fixedRoad[i]) && Math.abs(dx) <= WOLF.roamRoad && Math.abs(dy) <= WOLF.roamRoad) return false;
    }
  }
  return true;
}

/** A wolf died: counted (sim/military.js removeUnit sees only that a unit died). */
export function wolfKilled(game) {
  if (game.wildlife) game.wildlife.stats.wolvesKilled++;
}

/** For the wolf's panel and the advisor: a pack in a line. */
export function packSummary(game, pack) {
  const n = wolfCounts(game).get(pack.id) || 0;
  const regrow = n < pack.size && pack.refillDay !== null && pack.refillDay !== undefined ? `, another in ${Math.max(0, pack.refillDay - game.time.totalDays)} days` : '';
  return `${n} of ${pack.size} wolves near ${pack.spot.x}, ${pack.spot.y}${pack.hunting ? ', hunting' : ''}${regrow}`;
}

/**
 * natives.js
 * ----------------------------------------------------------------------------
 * Native villages and the mission post (parity #20; the numbers and the
 * missions are data/natives.js, the placement world/natives.js).
 *
 * A village is its meeting place (2x2) with its huts and crops (1x1), each
 * piece a building of kind 'village' with `village` = its meeting place's
 * id. They are placed with the map at a new game, never by the player, and
 * cannot be cleared; nothing burns or falls down there, and raiders and
 * Caesar's men pass them by.
 *
 * Anger (b.anger on huts and meeting places, saved with the building):
 *   every one starts angry (ANGER_MAX). Daily, one that is angry looks over
 *   its land (HUT_LAND or MEETING_LAND tiles around it): any building of the
 *   city there sets its village attacking for ATTACK_DAYS days (renewed every
 *   day the cause stays: m.attackDays on the meeting place). One that has
 *   been calmed grows 1 angrier a day and does not look. A missionary from a
 *   staffed mission post calms (anger 0) every hut and meeting place within
 *   CALM_REACH tiles of him: ANGER_MAX days of peace.
 *
 * Attacks: each angry hut of an attacking village sends one villager (a unit,
 *   side 'native'), a new one VILLAGER_DAYS after one falls. He goes for the
 *   city's building in the village's land nearest its meeting place (the
 *   original took the one nearest its "main" meeting place, which by a bug
 *   was the last one found: here each village goes for its own), breaking
 *   through buildings in his way as raiders do. Rome's soldiers, towers and
 *   prefects fight villagers only while they attack (hostileToRome in
 *   sim/military.js); villagers never start a fight with a walker. When the
 *   attack ends (a missionary may end it, once no piece still angry has a
 *   city building on its land), they walk home. A villager
 *   is no enemy in the province (the victory waits for none), but a month
 *   with an attack gains no peace.
 *
 * Trade: while a mission post is staffed (the original traded on for ever
 *   once one had worked, even after it was gone: a bug, not kept), each
 *   calmed village sends a trader every TRADER_DAYS days. He walks over open
 *   land to the nearest warehouse and buys up to TRADER_LOADS loads (100
 *   units each) of goods set to Export, above their keep level, at the
 *   cheapest price a partner pays this year (the base price with none); he
 *   tries the next warehouse if the first has none, then goes home. The
 *   trade log names the village.
 *
 * Save state: the village pieces are buildings (anger, attackDays, target,
 * traderDays, a hut's villager), villagers are units, traders walkers, and
 * game.city.natives (null in a city without villages: every older save)
 * counts attacks, losses and trade.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { NATIVES, NATIVE_PEOPLES, NATIVE_ID_BASE, nativesFor } from '../data/natives.js';
import { UNIT_TYPES } from '../data/units.js';
import { GOOD_KEYS, GOODS } from '../data/goods.js';
import { Terrain } from '../world/map.js';
import { planVillages } from '../world/natives.js';
import { addBuilding, spawnWalker, killWalker, inOwnFort } from './entities.js';
import { followPath } from './movement.js';
import { spawnUnit, removeUnit, moveToward, fillField, attackUnit, nearestHostile, buildingMaxHp } from './military.js';
import { fightPrefect } from './prefectFight.js';
import { collapseBuilding } from './risk.js';
import { landPassable } from './crime.js';
import { cityStock, takeGoods } from './storage.js';
import { transact } from './economy.js';
import { priceRange } from './prices.js';
import { logGoods } from './goodsLedger.js';

const N = NATIVES;
/** How much more a villager's route counts a building he must break through (as Caesar's men's). */
const BREAK_COST = 12;

/** City-wide native state for a city with villages. */
export function villagesState(people) {
  return { people, attacks: 0, slain: 0, buildingsLost: 0, calmed: 0, trades: 0, earned: 0 };
}

/** A piece of a native village (hut, meeting place, crops)? */
export function isVillage(b) {
  return !!b && b.def.kind === 'village';
}

/** A hut or meeting place: the pieces with land and anger. */
export function hasLand(b) {
  return isVillage(b) && b.def.village !== 'crops';
}

/** Tiles of land around a village piece. */
export function landRadius(b) {
  return b.def.village === 'meeting' ? N.MEETING_LAND : b.def.village === 'hut' ? N.HUT_LAND : 0;
}

/** The people of this city's villages ({ name, plural, village }), or null. */
export function peopleOf(game) {
  const st = game.city.natives;
  return st ? NATIVE_PEOPLES[st.people] || NATIVE_PEOPLES.native : null;
}

/** Is this building of the city the natives mind on their land (not a village piece or a mission post)? */
function offends(b) {
  return !!b && !isVillage(b) && b.type !== 'mission_post';
}

/** Chebyshev distance between two footprints (0 when they touch or overlap). */
function gap(a, b) {
  const dx = Math.max(0, b.x - (a.x + a.size - 1), a.x - (b.x + b.size - 1));
  const dy = Math.max(0, b.y - (a.y + a.size - 1), a.y - (b.y + b.size - 1));
  return Math.max(dx, dy);
}

/** The city's buildings within `r` tiles of village piece `b` (its land). */
function offendersNear(game, b, r) {
  const { map, buildings } = game;
  const out = new Map();
  for (let y = Math.max(0, b.y - r); y <= Math.min(map.h - 1, b.y + b.size - 1 + r); y++) {
    for (let x = Math.max(0, b.x - r); x <= Math.min(map.w - 1, b.x + b.size - 1 + r); x++) {
      const id = map.building[map.idx(x, y)];
      if (!id || out.has(id)) continue;
      const o = buildings.get(id);
      if (offends(o)) out.set(id, o);
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Founding
// ---------------------------------------------------------------------------

/**
 * A new game: place the scenario's villages (none in most), on the map's own
 * stream (world/natives.js), with ids from NATIVE_ID_BASE up, so the
 * city's own buildings are numbered as in a game without villages.
 */
export function foundVillages(game) {
  const spec = nativesFor(game.scenario);
  if (!spec) return 0;
  const plans = planVillages(game.map, game.seed, spec.villages);
  if (!plans.length) return 0;
  game.city.natives = villagesState(spec.people);
  // Ids of their own (NATIVE_ID_BASE up), so the city's buildings get the
  // ids, and with them the update ticks, they would have had with none.
  const cityNext = game.nextBuildingId;
  game.nextBuildingId = NATIVE_ID_BASE;
  for (const p of plans) {
    const m = addBuilding(game, 'native_meeting', p.meeting.x, p.meeting.y, undefined, { quiet: true });
    m.village = m.id;
    m.anger = N.ANGER_MAX;
    m.attackDays = 0;
    m.target = 0;
    m.traderDays = N.TRADER_DAYS;
    for (const h of p.huts) {
      const b = addBuilding(game, 'native_hut', h.x, h.y, undefined, { quiet: true });
      b.village = m.id;
      b.anger = N.ANGER_MAX;
      b.villager = 0;
      b.villagerDay = 0;
    }
    for (const f of p.fields) addBuilding(game, 'native_crops', f.x, f.y, undefined, { quiet: true }).village = m.id;
  }
  game.nextBuildingId = cityNext;
  return plans.length;
}

/** The villages of this city: [{ m: meeting place, huts: [] }], in id order. */
export function villagesOf(game) {
  const byId = new Map();
  for (const b of game.buildings.values()) if (b.type === 'native_meeting') byId.set(b.id, { m: b, huts: [] });
  for (const b of game.buildings.values()) if (b.type === 'native_hut' && byId.has(b.village)) byId.get(b.village).huts.push(b);
  return [...byId.values()];
}

/** Is a mission post at work (staffed, with a road)? */
export function postWorking(game) {
  for (const b of game.buildings.values()) if (b.type === 'mission_post' && b.efficiency > 0 && b.accessRoad >= 0) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------

/** Daily (core/game.js onDay): anger, attacks, villagers out, traders out. */
export function nativesDaily(game) {
  const st = game.city.natives;
  if (!st) return;
  const trade = postWorking(game);
  for (const v of villagesOf(game)) {
    const found = new Map();
    for (const b of [v.m, ...v.huts]) {
      if (b.anger < N.ANGER_MAX) { b.anger += 1; continue; }
      for (const o of offendersNear(game, b, landRadius(b))) found.set(o.id, o);
    }
    if (found.size) startAttack(game, v, [...found.values()]);
    if (v.m.attackDays > 0) {
      game.city.raidMonth = true; // no peace gained this month (sim/ratings.js)
      sendVillagers(game, v);
      v.m.attackDays--;
      if (v.m.attackDays <= 0) endAttack(game, v);
    } else if (trade && v.m.anger < N.ANGER_MAX) {
      v.m.traderDays = (v.m.traderDays ?? N.TRADER_DAYS) - 1;
      if (v.m.traderDays <= 0) {
        v.m.traderDays = N.TRADER_DAYS;
        sendTrader(game, v.m);
      }
    }
  }
}

/** A building of the city stands on angry land: the village attacks (or keeps attacking) for ATTACK_DAYS. */
function startAttack(game, v, found) {
  const m = v.m;
  const was = m.attackDays > 0;
  if (!game.buildings.has(m.target) || !targetReachable(game, v)) pickTarget(game, v, found);
  if (!m.target) {
    if (was) endAttack(game, v); // (walled off since: the men go home)
    return;
  }
  m.attackDays = N.ATTACK_DAYS;
  if (was) return;
  const st = game.city.natives;
  st.attacks++;
  const t = game.buildings.get(m.target);
  const who = peopleOf(game);
  const name = `${who.village[0].toUpperCase()}${who.village.slice(1)}`;
  game.message(`${name} near ${m.x}, ${m.y} is attacking: the ${t.def.name} at ${t.x}, ${t.y} stands on its land. A missionary from a Sacellum Pacis (Mission Post) would calm it.`, 'bad', t.x, t.y, { kind: 'raid' });
  game.events.emit('sound', { name: 'horn' });
}

/** Each angry hut of an attacking village sends out its villager (a new one VILLAGER_DAYS after one falls). */
function sendVillagers(game, v) {
  const today = game.time.totalDays;
  for (const h of v.huts) {
    if (h.villager && game.units.has(h.villager)) continue;
    if (h.villager) { h.villager = 0; h.villagerDay = today + N.VILLAGER_DAYS; } // fallen: another in a while
    if (h.anger < N.ANGER_MAX || today < (h.villagerDay || 0)) continue;
    const u = spawnUnit(game, 'villager', h.x + 0.5, h.y + 0.5, { village: v.m.id, hut: h.id, attacking: true, state: 'advance' });
    h.villager = u.id;
  }
}

/** The attack is over: the villagers walk home. */
function endAttack(game, v) {
  v.m.attackDays = 0;
  v.m.target = 0;
  for (const u of game.units.values()) if (u.side === 'native' && u.village === v.m.id) { u.attacking = false; u.target = 0; }
}

// ---------------------------------------------------------------------------
// The missionary
// ---------------------------------------------------------------------------

/**
 * A missionary steps onto a tile (sim/services.js roamerVisit): every hut and
 * meeting place within CALM_REACH of him is calmed. A meeting place calmed
 * ends its village's attack at once.
 */
export function missionaryVisit(game, w) {
  const { map, buildings } = game;
  const st = game.city.natives;
  if (!st) return;
  const r = N.CALM_REACH;
  const seen = new Set();
  const villages = new Set(); // meeting place ids of the villages he calmed something of
  const calmedMeetings = new Set(); // meeting places that were angry
  for (let y = Math.max(0, w.y - r); y <= Math.min(map.h - 1, w.y + r); y++) {
    for (let x = Math.max(0, w.x - r); x <= Math.min(map.w - 1, w.x + r); x++) {
      const id = map.building[map.idx(x, y)];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const b = buildings.get(id);
      if (!hasLand(b)) continue;
      if (b.def.village === 'meeting' && b.anger >= N.ANGER_MAX) calmedMeetings.add(b.id);
      b.anger = 0;
      villages.add(b.village);
    }
  }
  // Then each village he touched: its attack ends only when no piece still
  // angry has a building of the city on its land. (Ending it whenever the
  // meeting place was calmed, with a far hut still angry, let the hut begin
  // it again the next day: a new attack, message and horn every day.)
  for (const mid of villages) {
    const m = buildings.get(mid);
    if (!m) continue;
    const ends = m.attackDays > 0 && !offendersInVillage(game, m).length;
    if (calmedMeetings.has(mid)) {
      st.calmed++;
      game.message(`A missionary has calmed ${peopleOf(game).village} near ${m.x}, ${m.y}${ends ? ': its men go home' : ''}. It keeps the peace for ${N.ANGER_MAX} days unless a missionary passes again.`, 'good', m.x, m.y);
    }
    if (ends) endAttack(game, { m });
  }
}

// ---------------------------------------------------------------------------
// Villagers (per tick, from sim/military.js updateMilitary)
// ---------------------------------------------------------------------------

/** The route field toward a village's target (not saved; planned again when the target or the map changes). */
function fieldFor(game, m) {
  game.nativeFields ??= new Map();
  const hit = game.nativeFields.get(m.id);
  const fresh = hit && hit.target === m.target && (hit.rev === game.map.revision || game.time.totalTicks - hit.tick < 20);
  if (fresh) return hit.field;
  const field = hit && hit.field.length === game.map.size ? hit.field : new Float32Array(game.map.size);
  fillField(game, field, (id) => id === m.target, BREAK_COST, true);
  game.nativeFields.set(m.id, { target: m.target, rev: game.map.revision, tick: game.time.totalTicks, field });
  return field;
}

/** Can a villager from any of the village's huts walk to its target now (walls block him)? */
function targetReachable(game, v) {
  const map = game.map;
  const field = fieldFor(game, v.m);
  for (const h of v.huts) {
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      if (map.inBounds(h.x + dx, h.y + dy) && Number.isFinite(field[map.idx(h.x + dx, h.y + dy)])) return true;
    }
  }
  return false;
}

/**
 * The village's target: the city's building on its land nearest the
 * meeting place that its men can reach (walls block them; the four nearest
 * are tried), or 0. A building none can reach sets off no attack: one that
 * did kept the village "attacking" for good, its men pushing at the wall,
 * and no peace was gained while it lasted.
 */
function pickTarget(game, v, list) {
  const m = v.m;
  const cx = m.x + m.size / 2;
  const cy = m.y + m.size / 2;
  const order = list.slice().sort((a, b) => Math.hypot(a.x + a.size / 2 - cx, a.y + a.size / 2 - cy) - Math.hypot(b.x + b.size / 2 - cx, b.y + b.size / 2 - cy) || a.id - b.id);
  for (const o of order.slice(0, 4)) {
    m.target = o.id;
    if (targetReachable(game, v)) return o.id;
  }
  m.target = 0;
  return 0;
}

/** A villager going home: to his hut, where he is gone (and not fallen: the hut may send him out again at once). */
function goHome(game, u, def) {
  u.state = 'home';
  const hut = game.buildings.get(u.hut);
  if (!hut) { removeUnit(game, u, 'fled'); return; }
  moveToward(game, u, hut.x + 0.5, hut.y + 0.5, def.speed);
  if (Math.hypot(hut.x + 0.5 - u.x, hut.y + 0.5 - u.y) < 0.9 || u.stuck > 80) {
    if (hut.villager === u.id) hut.villager = 0;
    removeUnit(game, u, 'home');
  }
}

/**
 * One villager's tick: home when his village's attack is over; else fight a
 * soldier who comes close (or a prefect who takes him on), else go for the
 * village's target, breaking what stands in his way.
 */
export function updateVillager(game, u, romans) {
  const def = UNIT_TYPES[u.type];
  const map = game.map;
  const m = game.buildings.get(u.village);
  if (!u.attacking || !m || !(m.attackDays > 0)) { goHome(game, u, def); return; }
  let target = u.target ? game.units.get(u.target) : null;
  if (target && (Math.hypot(target.x - u.x, target.y - u.y) > def.aggro * 1.6 || inOwnFort(game, target))) target = null; // (a man in his fort's yard is out of reach)
  if ((game.time.totalTicks + u.id) % 6 === 0 || !target) target = nearestHostile(romans, u.x, u.y, def.aggro) || target;
  u.target = target ? target.id : 0;
  if (target) {
    u.state = 'fight';
    const d = Math.hypot(target.x - u.x, target.y - u.y);
    if (d <= def.range) { u.moving = false; if (u.cooldown <= 0) attackUnit(game, u, def, target); return; }
    moveToward(game, u, target.x, target.y, def.speed);
    return;
  }
  if (fightPrefect(game, u, def)) return;
  if (!game.buildings.has(m.target)) {
    const v = villagesOf(game).find((x) => x.m.id === m.id) || { m, huts: [] };
    if (!pickTarget(game, v, offendersInVillage(game, m))) { endAttack(game, v); goHome(game, u, def); return; }
  }
  const field = fieldFor(game, m);
  const tx = Math.floor(u.x);
  const ty = Math.floor(u.y);
  let best = -1;
  let bestV = field[map.idx(tx, ty)];
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    if (!map.inBounds(tx + dx, ty + dy)) continue;
    const j = map.idx(tx + dx, ty + dy);
    if (map.building[j] === m.target) { best = j; break; } // there
    if (field[j] < bestV) { bestV = field[j]; best = j; }
  }
  if (best < 0) { u.state = 'camp'; u.moving = false; return; } // no way on (walls): he waits
  const id = map.building[best];
  const b = id ? game.buildings.get(id) : null;
  if (b && !isVillage(b)) {
    // At the target, or a building in his way: he breaks it.
    u.state = 'siege';
    u.moving = false;
    const sdx = (map.xOf(best) - tx) - (map.yOf(best) - ty);
    if (sdx !== 0) u.facing = sdx > 0 ? 1 : -1;
    if (u.cooldown <= 0) {
      u.cooldown = def.cooldown;
      u.strikeTick = game.time.totalTicks;
      strike(game, b, def.siege * (0.75 + game.rng.next() * 0.5));
    }
    return;
  }
  u.state = 'advance';
  moveToward(game, u, map.xOf(best) + 0.5 + u.ox, map.yOf(best) + 0.5 + u.oy, def.speed);
}

/** The city's buildings on any of a village's land now. */
function offendersInVillage(game, m) {
  const out = new Map();
  for (const b of game.buildings.values()) {
    if (!hasLand(b) || b.village !== m.id || b.anger < N.ANGER_MAX) continue;
    for (const o of offendersNear(game, b, landRadius(b))) out.set(o.id, o);
  }
  return [...out.values()];
}

/** A villager's blow at a building: at 0 it is torn down. */
function strike(game, b, dmg) {
  if (b.hp === undefined) b.hp = buildingMaxHp(b);
  b.hp -= dmg;
  b.lastRaided = game.time.totalDays;
  if (b.hp > 0) return;
  const st = game.city.natives;
  if (st) st.buildingsLost++;
  collapseBuilding(game, b, 'natives');
}

// ---------------------------------------------------------------------------
// Native trade
// ---------------------------------------------------------------------------

/** A free tile beside a building (where a walker sets out or comes home), or -1. */
function besideTile(game, b) {
  const { map } = game;
  for (let d = 0; d < b.size; d++) {
    for (const [x, y] of [[b.x + d, b.y + b.size], [b.x + b.size, b.y + d], [b.x + d, b.y - 1], [b.x - 1, b.y + d]]) {
      if (map.inBounds(x, y) && landPassable(game, map.idx(x, y))) return map.idx(x, y);
    }
  }
  return -1;
}

/** A route over open land (and roads) to tile `to`, stopping beside building `targetId` if given. */
function landRoute(game, from, to, targetId = 0) {
  const { map } = game;
  const cost = (i) => {
    if (!landPassable(game, i, targetId)) return Infinity;
    if (map.road[i]) return 0.7;
    return map.terrain[i] === Terrain.TREES ? 1.6 : 1;
  };
  const path = game.pf.astar(from, to, cost, { maxNodes: map.size * 2 });
  if (!path || !targetId) return path;
  const k = path.findIndex((i, n) => n > 0 && map.building[i] === targetId);
  return k > 0 ? path.slice(0, k) : path;
}

/** The goods a native trader buys now: set to Export and above the keep level. */
function exportsNow(game) {
  const settings = game.city.trade.settings;
  return GOOD_KEYS.filter((g) => settings[g]?.mode === 'export' && !GOODS[g].keptAt && cityStock(game, g) - settings[g].level >= CONFIG.CART_CAPACITY);
}

/** Warehouses holding something the trader buys, nearest the meeting place first; those in `skip` left out. */
function marketsFor(game, m, skip = []) {
  const goods = exportsNow(game);
  if (!goods.length) return [];
  const cx = m.x + m.size / 2;
  const cy = m.y + m.size / 2;
  const out = [];
  for (const b of game.buildings.values()) {
    if (b.def.kind !== 'warehouse' || skip.includes(b.id)) continue;
    if (!goods.some((g) => (b.stock[g] || 0) >= CONFIG.CART_CAPACITY)) continue;
    out.push({ b, d: Math.hypot(b.x + b.size / 2 - cx, b.y + b.size / 2 - cy) });
  }
  out.sort((a, b) => a.d - b.d || a.b.id - b.b.id);
  return out.map((o) => o.b);
}

/** A village sends its trader to the nearest warehouse with something it buys (one out at a time). */
function sendTrader(game, m) {
  if (m.traderId && game.walkers.has(m.traderId)) return;
  const start = besideTile(game, m);
  if (start < 0) return;
  const w = spawnWalker(game, 'native_trader', start, null, { state: 'nativeBuy', village: m.id, tried: [], offRoad: true });
  if (!w) return;
  m.traderId = w.id;
  if (!traderOn(game, w, m)) killWalker(game, w);
}

/** Send the trader on to the next warehouse with goods for him, or home. @returns {boolean} false when he has nowhere to go */
function traderOn(game, w, m) {
  const here = game.map.idx(w.x, w.y);
  for (const wh of marketsFor(game, m, w.tried).slice(0, 3)) {
    const path = landRoute(game, here, game.map.idx(wh.x, wh.y), wh.id);
    if (!path) { w.tried.push(wh.id); continue; }
    w.state = 'nativeBuy';
    w.target = wh.id;
    followPath(game, w, path);
    return true;
  }
  return traderHome(game, w, m);
}

/** Back to the meeting place (where he is gone). */
function traderHome(game, w, m) {
  w.state = 'nativeHome';
  w.target = 0;
  const home = m ? besideTile(game, m) : -1;
  const path = home >= 0 ? landRoute(game, game.map.idx(w.x, w.y), home) : null;
  if (!path) return false;
  followPath(game, w, path);
  return true;
}

/** The price a village pays for a good: the cheapest a partner pays this year, or the base price with none. */
export function nativePrice(game, good) {
  const r = priceRange(game, good, 'sell');
  return r ? r.lo : GOODS[good].sell || GOODS[good].buy || 1;
}

/**
 * The trader reached a warehouse (sim/walkers.js onPathEnd): he buys, a load
 * (100 units) at a time, up to TRADER_LOADS loads of what it holds above
 * the keep levels, then goes home; with nothing bought he tries the next
 * warehouse (at most three in all).
 */
export function nativeTraderArrive(game, w) {
  const m = game.buildings.get(w.village);
  const wh = game.buildings.get(w.target);
  w.tried.push(w.target);
  let loads = N.TRADER_LOADS;
  const deal = { earned: 0, sold: {} };
  if (wh && wh.def.kind === 'warehouse') {
    const settings = game.city.trade.settings;
    for (const g of exportsNow(game)) {
      while (loads > 0 && (wh.stock[g] || 0) >= CONFIG.CART_CAPACITY && cityStock(game, g) - settings[g].level >= CONFIG.CART_CAPACITY) {
        takeGoods(wh, g, CONFIG.CART_CAPACITY);
        deal.sold[g] = (deal.sold[g] || 0) + CONFIG.CART_CAPACITY;
        loads--;
      }
    }
  }
  if (loads === N.TRADER_LOADS) {
    if (w.tried.length >= 3 || !m || !traderOn(game, w, m)) { if (!m || !traderHome(game, w, m)) killWalker(game, w); }
    return;
  }
  for (const [g, n] of Object.entries(deal.sold)) {
    const money = Math.round((nativePrice(game, g) * n) / 100);
    transact(game, 'exports', money);
    logGoods(game, g, 'exported', n);
    deal.earned += money;
  }
  const st = game.city.natives;
  if (st) { st.trades++; st.earned += deal.earned; }
  const log = game.city.trade.log;
  const who = peopleOf(game);
  log.unshift({ date: game.time.shortLabel(), partner: who ? who.village.replace(/^the /, 'The ') : 'A village', kind: 'land', earned: deal.earned, spent: 0, sold: deal.sold, bought: {} });
  if (log.length > 20) log.pop();
  w.deal = { sold: deal.sold, bought: {}, earned: deal.earned, spent: 0 };
  w.packs = Object.keys(deal.sold).slice(0, 2);
  if (!m || !traderHome(game, w, m)) killWalker(game, w);
}

/** Something was built across the trader's way: plan again (sim/walkers.js). */
export function nativeTraderReroute(game, w) {
  w.path = null;
  w.moving = false;
  const m = game.buildings.get(w.village);
  if (!m) { killWalker(game, w); return; }
  const ok = w.state === 'nativeBuy' ? traderOn(game, w, m) : traderHome(game, w, m);
  if (!ok) killWalker(game, w);
}

// ---------------------------------------------------------------------------
// For the panels, the overlay and placing buildings
// ---------------------------------------------------------------------------

/**
 * Per tile: 0 no village's land, 1 a calmed village piece's land, 2 an angry
 * one's (cached per day and map change: the Native land overlay).
 */
export function landLayer(game) {
  const key = `${game.time.totalDays}:${game.map.revision}`;
  if (game.nativeLand && game.nativeLand.key === key) return game.nativeLand.layer;
  const { map } = game;
  const layer = new Uint8Array(map.size);
  for (const b of game.buildings.values()) {
    if (!hasLand(b)) continue;
    const r = landRadius(b);
    const v = b.anger >= N.ANGER_MAX ? 2 : 1;
    for (let y = Math.max(0, b.y - r); y <= Math.min(map.h - 1, b.y + b.size - 1 + r); y++) {
      for (let x = Math.max(0, b.x - r); x <= Math.min(map.w - 1, b.x + b.size - 1 + r); x++) {
        const i = map.idx(x, y);
        if (layer[i] < v) layer[i] = v;
      }
    }
  }
  game.nativeLand = { key, layer };
  return layer;
}

/**
 * The warning for a building placed at (x, y), w x h tiles: on the land of
 * a village piece that is angry now (they attack), or calmed (they will
 * when it wears off). Null off native land, and for the mission post.
 */
export function nativeLandWarning(game, type, x, y, w, h) {
  if (!game.city.natives || type === 'mission_post') return null;
  const box = { x, y, size: Math.max(w, h) };
  let calm = false;
  for (const b of game.buildings.values()) {
    if (!hasLand(b) || gap(b, box) > landRadius(b)) continue;
    if (b.anger >= N.ANGER_MAX) return `Native land: the ${peopleOf(game).plural} attack while their village is angry. Calm it first with a missionary from a Sacellum Pacis (Mission Post).`;
    calm = true;
  }
  return calm ? `Native land: calmed for now, but the ${peopleOf(game).plural} attack once a missionary has not passed for ${N.ANGER_MAX} days.` : null;
}

/** A village piece's panel rows: [label, value]. */
export function villageRows(game, b) {
  const who = peopleOf(game);
  const m = game.buildings.get(b.village);
  const huts = m ? villagesOf(game).find((v) => v.m.id === m.id)?.huts.length || 0 : 0;
  const rows = [['People', who ? who.plural : 'Natives']];
  if (hasLand(b)) {
    rows.push(['Anger', b.anger >= N.ANGER_MAX ? 'Angry' : `Calm (${b.anger} / ${N.ANGER_MAX})`]);
    rows.push(['Its land', `Every tile within ${landRadius(b)} of it`]);
  }
  if (m) rows.push(['Village', `${huts} huts round the meeting place at ${m.x}, ${m.y}`]);
  if (m && postWorking(game) && m.anger < N.ANGER_MAX && !(m.attackDays > 0)) rows.push(['Trader', `Comes to trade in ${Math.max(0, m.traderDays ?? N.TRADER_DAYS)} days`]);
  return rows;
}

/** The mission post's panel rows: the villages, calm and angry, and the trade so far. */
export function missionRows(game) {
  const st = game.city.natives;
  if (!st) return [];
  const vs = villagesOf(game);
  const calm = vs.filter((v) => v.m.anger < N.ANGER_MAX).length;
  return [
    ['Villages', `${vs.length}: ${calm} calm, ${vs.length - calm} angry`],
    ['Attacks so far', String(st.attacks)],
    ['Native trade', st.trades ? `${st.trades} visits, ${st.earned} Dn` : 'None yet'],
  ];
}

/** A village piece's state in words (its panel). */
export function villageStatus(game, b) {
  const m = game.buildings.get(b.village);
  if (m && m.attackDays > 0) {
    const t = game.buildings.get(m.target);
    return { level: 'bad', text: `Attacking${t ? ` the ${t.def.name} at ${t.x}, ${t.y}` : ''}: a building of yours stands on the village's land.` };
  }
  if (!hasLand(b)) return { level: '', text: 'The village\'s field.' };
  if (b.anger >= N.ANGER_MAX) return { level: 'warn', text: `Angry: it attacks any building put within ${landRadius(b)} tiles of it. A missionary passing within ${N.CALM_REACH} tiles calms it.` };
  return { level: 'good', text: `Calm for ${N.ANGER_MAX - b.anger} more days (a missionary passing again calms it anew).` };
}

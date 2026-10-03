/**
 * events.js
 * ----------------------------------------------------------------------------
 * The province's events: the original's monthly random events and a
 * mission's scheduled ones (data/events.js has the tables and which mission
 * has what).
 *
 * Random events (monthly, after the Emperor's month)
 *   One draw a month against the original's table of 128 entries, the
 *   difficulty's `events` lever shrinking or growing it (eventDraw). The
 *   event drawn happens only if the mission switches it on, its condition
 *   holds and it is not cooling down (the difficulty's eventCooldown months
 *   since it last came; Rome's wages 12 on every level). So at most one a
 *   month, and none of the original's repeats two months running.
 *     wageUp / wageDown  Rome's wage (city.romeWage, sim/economy.js) moves 1
 *                        to 4 Dn, within ROME_WAGE_MIN..MAX. The city's own
 *                        wage stays; citizens now measure it against Rome's.
 *     land / sea         while a city has an open route of the kind (and, by
 *                        sea, a staffed Emporium): no caravan, or no ship, sets
 *                        out on any route of the kind for TRADE_HALT_DAYS
 *                        (sim/trade.js updateTrade asks tradeHalted). Traders
 *                        already in the province finish their visit.
 *     water              with DISEASE's 200 people or more: city health falls
 *                        (sim/disease.js foulWater)
 *     mine / clay        the oldest iron mine collapses, the oldest clay pit
 *                        floods: rubble, with a message that points at it
 *
 * Scheduled events (a mission's, data/events.js), each in its month
 *   quake     the earthquake (below)
 *   emperor   a new Caesar: favor starts afresh at 50 (the original's engine
 *             had that step but never called it)
 *   price     news of a price change (sim/prices.js applies it: pure)
 *   revolt    the gladiators' revolt (sim/revolt.js startRevolt: called off,
 *             without a word, when no gladiator school works that month)
 *
 * The earthquake
 *   It strikes the tile nearest the middle of the city's buildings, a few
 *   tiles off (a quake in empty country would be no event: the original's
 *   designers placed the point where the city would be). Four cracks then
 *   grow from there, a few tries a day: each try picks a crack (1 in 4) and
 *   a way, its own (north, east, south, west) half the time, a side a
 *   quarter each, never back. A crack cannot enter rock or water, and a
 *   failed try is lost. Each tile it enters is struck: a building there
 *   comes down (the rest of its ground is rubble), roads, aqueducts and
 *   walls go, and the tile is rock for good. The Imperial road is Rome's:
 *   the road from the map entry to the exit as the quake finds it (`keep`,
 *   the shortest way by road) holds, a crack passing under it without
 *   striking. Otherwise a crack across it, rock being unbuildable, could
 *   cut the city from the empire for good. A wolf pack's den (sim/wildlife.js)
 *   holds the same way. Undo is off while it shakes.
 *
 * Randomness: every draw is on a stream of its own from the map's seed and
 * the date (`${seed}:events:${month}`, a crack's try from the quake's stream
 * and the tries left), never the game's: a city where no event fires plays
 * exactly as before, and a loaded game draws the same.
 *
 * Saved (city.events, city.romeWage): the cooldowns, the day each trade
 * disruption ends, the quake in progress and the counts for the reports.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { RNG } from '../core/rng.js';
import { Terrain, DIRS4 } from '../world/map.js';
import { GOODS } from '../data/goods.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';
import {
  RANDOM_EVENTS, EVENT_TABLE_SIZE, WAGE_COOLDOWN, ROME_WAGE_MIN, ROME_WAGE_MAX, TRADE_HALT_DAYS, NEPTUNE_HALT_DAYS,
  BAD_WATER_MIN_POP, QUAKE_SIZES, QUAKE_JITTER, missionEvents, eventMonth,
} from '../data/events.js';
import { MONTH_NAMES, formatYear } from './time.js';
import { removeBuilding, linkedGroup, groupTiles, mainOf, killWalker } from './entities.js';
import { recordRuin, clearRuin } from './ruins.js';
import { buildingLabel, withArticle } from './risk.js';
import { foulWater, diseaseEnabled } from './disease.js';
import { romeWage } from './economy.js';
import { startRevolt } from './revolt.js';

const TPD = CONFIG.TICKS_PER_DAY;

/** Fresh state: nothing cooling down, no trade stopped, no quake. Kept in city.events (saved). */
export function newEventState() {
  return {
    cooldowns: {}, // event (or shared cooldown) key -> mission month it last came
    landUntil: 0, // game.time.totalDays when caravans may set out again
    seaUntil: 0, // ...and ships
    quake: null, // the earthquake in progress (startQuake)
    counts: {}, // event key -> times it came (the sim report and tests); quakeLost, quakeHomes
  };
}

/**
 * A city's event state, filled out: a save from before events (or a hand
 * edit) gets the defaults, and a quake in progress that does not hold
 * together is dropped rather than left to break the tick.
 */
export function eventStateOf(city) {
  const e = city.events && typeof city.events === 'object' ? city.events : newEventState();
  if (!e.cooldowns || typeof e.cooldowns !== 'object') e.cooldowns = {};
  if (!e.counts || typeof e.counts !== 'object') e.counts = {};
  if (!Number.isFinite(e.landUntil)) e.landUntil = 0;
  if (!Number.isFinite(e.seaUntil)) e.seaUntil = 0;
  if (e.quake && !validQuake(e.quake)) e.quake = null;
  e.quake ??= null;
  city.events = e;
  if (!Number.isFinite(city.romeWage)) city.romeWage = CONFIG.BASE_WAGE;
  return e;
}

function validQuake(q) {
  return Array.isArray(q.arms) && q.arms.length === 4 && q.arms.every((a) => a && Number.isInteger(a.x) && Number.isInteger(a.y))
    && Number.isFinite(q.left) && Number.isFinite(q.perDay) && q.perDay > 0 && Number.isFinite(q.t) && typeof q.stream === 'string'
    && (q.keep === undefined || (Array.isArray(q.keep) && q.keep.every(Number.isInteger)));
}

function count(game, key, n = 1) {
  const c = game.city.events.counts;
  c[key] = (c[key] || 0) + n;
}

// ---------------------------------------------------------------------------
// Random events
// ---------------------------------------------------------------------------

/**
 * The event drawn for mission month `month` (or null): one draw on the
 * month's own stream against the table, which the difficulty's `factor`
 * shrinks (above 1: the events take a bigger share) or grows.
 */
export function eventDraw(seed, month, factor = 1) {
  if (!(factor > 0)) return null;
  const slot = Math.floor((new RNG(`${seed}:events:${month}`).next() * EVENT_TABLE_SIZE) / factor);
  let at = 0;
  for (const e of RANDOM_EVENTS) {
    at += e.entries;
    if (slot < at) return e.key;
  }
  return null;
}

/** The second draw of a month's event (a wage step), on the same month's stream. */
function eventAmount(seed, month, lo, hi) {
  const r = new RNG(`${seed}:events:${month}`);
  r.next(); // (the first went to the draw)
  return r.range(lo, hi);
}

/** Months the event `e` waits before it may come again on this difficulty. */
function cooldownOf(game, e) {
  return e.cooldown === 'wages' ? WAGE_COOLDOWN : game.difficulty.eventCooldown ?? 24;
}

/** Is this random event switched on in this game (its mission, or the sandbox's setup)? */
export function eventSwitchedOn(game, key) {
  const e = RANDOM_EVENTS.find((x) => x.key === key);
  return !!e && game.flags.events !== 'off' && missionEvents(game.scenario).random.includes(e.switch);
}

/** Does the city have an open route of this kind ('land' or 'sea') that a disruption would stop? */
function tradesBy(game, kind) {
  for (const [id, r] of Object.entries(game.city.trade.routes)) {
    if (!r.open) continue;
    if ((TRADE_PARTNERS[id]?.route === 'sea' ? 'sea' : 'land') !== kind) continue;
    if (kind === 'land') return true;
    if (!game.map.seaEntry) return false;
    for (const b of game.buildings.values()) if (b.def.kind === 'dock' && b.efficiency > 0) return true;
    return false;
  }
  return false;
}

/** The oldest building of a type (lowest id: the first placed still standing), or null. */
function oldest(game, type) {
  let best = null;
  for (const b of game.buildings.values()) if (b.type === type && (!best || b.id < best.id)) best = b;
  return best;
}

/** Can the event happen in this city now (its condition, not its switch or cooldown)? */
export function eventCondition(game, key) {
  const c = game.city;
  switch (key) {
    case 'wageUp': return romeWage(game) < ROME_WAGE_MAX;
    case 'wageDown': return romeWage(game) > ROME_WAGE_MIN;
    case 'land': return tradesBy(game, 'land');
    case 'sea': return tradesBy(game, 'sea');
    case 'water': return diseaseEnabled(game) && c.population >= BAD_WATER_MIN_POP && c.health.bigEnough === true;
    case 'mine': return !!oldest(game, 'iron_mine');
    case 'clay': return !!oldest(game, 'clay_pit');
    default: return false;
  }
}

/** Monthly: the month's random event, if one is drawn and may happen. @returns {string|null} its key */
export function randomEventMonth(game) {
  const now = game.time.totalMonths;
  const key = eventDraw(game.seed, now, game.difficulty.events ?? 1);
  if (!key || !eventSwitchedOn(game, key)) return null;
  const e = RANDOM_EVENTS.find((x) => x.key === key);
  const last = game.city.events.cooldowns[e.cooldown];
  if (Number.isFinite(last) && now - last < cooldownOf(game, e)) return null;
  if (!eventCondition(game, key)) return null;
  applyEvent(game, key, eventAmount(game.seed, now, 1, 4));
  return key;
}

/**
 * Make a random event happen now (the month's draw, or the console's
 * `event` command): its effect and message, its cooldown and count.
 * `step`: a wage event's 1 to 4 Dn. @returns {boolean} it happened
 */
export function applyEvent(game, key, step = 2) {
  const e = RANDOM_EVENTS.find((x) => x.key === key);
  if (!e || !eventCondition(game, key)) return false;
  const c = game.city;
  switch (key) {
    case 'wageUp':
    case 'wageDown': {
      const up = key === 'wageUp';
      // Clamped after the step (the original checked its floor before the
      // cut, so a wage of 5 cut by 4 fell to 1: its bug, not kept).
      c.romeWage = Math.max(ROME_WAGE_MIN, Math.min(ROME_WAGE_MAX, romeWage(game) + (up ? step : -step)));
      const w = c.romeWage;
      game.message(up ? `Rome raises its wages to ${w} Dn a year, and your workers will expect as much: you pay ${c.wage}${c.wage < w ? ', and moods will suffer until you match it' : ''} (Labor advisor).`
        : `Rome cuts its wages to ${w} Dn a year, and your workers will settle for as much: you pay ${c.wage}${c.wage > w ? ', more than you need to' : ''} (Labor advisor).`, up && c.wage < w ? 'warn' : 'info');
      break;
    }
    case 'land': {
      haltTrade(game, 'land', TRADE_HALT_DAYS);
      const desert = game.scenario.map?.type === 'desert';
      game.message(`${desert ? 'Sandstorms close the caravan roads' : 'Landslides close the mountain roads'}: no caravan will set out for your city until ${haltEndLabel(game, 'land')}.`, 'warn');
      break;
    }
    case 'sea':
      haltTrade(game, 'sea', TRADE_HALT_DAYS);
      game.message(`Storms keep the merchant ships in port: none will sail for your city until ${haltEndLabel(game, 'sea')}.`, 'warn');
      break;
    case 'water': {
      const h = foulWater(game);
      game.message(`Bad water: the wells and fountains are fouled. City health falls from ${h.from} to ${h.to} (Health advisor).`, 'bad');
      break;
    }
    case 'mine':
    case 'clay': {
      const b = oldest(game, key === 'mine' ? 'iron_mine' : 'clay_pit');
      const at = { x: b.x, y: b.y };
      ruinBuilding(game, b, 'collapse');
      c.stats.collapses++;
      game.message(key === 'mine' ? `A shaft gives way: the iron mine at ${at.x}, ${at.y} has collapsed into rubble.`
        : `The clay pit at ${at.x}, ${at.y} has flooded and caved in: it is rubble now.`, 'bad', at.x, at.y, { kind: 'collapse' });
      game.events.emit('collapse', { x: at.x, y: at.y, size: b.size });
      game.events.emit('sound', { name: 'collapse' });
      break;
    }
    default: return false;
  }
  game.city.events.cooldowns[e.cooldown] = game.time.totalMonths;
  count(game, key);
  return true;
}

/**
 * A building comes down into rubble that remembers it (sim/ruins.js), but
 * for the tile `spare` (a crack's: rock, not rubble) and any road under it.
 * No message: the event's own says what happened.
 */
function ruinBuilding(game, b, cause, spare = -1) {
  const { map } = game;
  const main = mainOf(game, b);
  const tiles = groupTiles(game, b).filter((i) => i !== spare && !map.road[i]);
  const site = { type: main.house ? 'house' : main.type, x: main.x, y: main.y, size: main.size, turn: main.turn || 0 };
  const label = buildingLabel(main);
  removeBuilding(game, b, cause);
  for (const i of tiles) map.rubble[i] = 1;
  if (tiles.length) recordRuin(game, tiles, label, cause, site);
  return main;
}

// ---------------------------------------------------------------------------
// Trade disruptions
// ---------------------------------------------------------------------------

/** No trader of this kind ('land' or 'sea') sets out for `days` days from today (never shortening one under way). */
export function haltTrade(game, kind, days) {
  const ev = game.city.events;
  const key = kind === 'sea' ? 'seaUntil' : 'landUntil';
  ev[key] = Math.max(ev[key] || 0, game.time.totalDays + days);
}

/** Is trade of this kind stopped today? */
export function tradeHalted(game, kind) {
  const ev = game.city.events;
  return !!ev && game.time.totalDays < (kind === 'sea' ? ev.seaUntil : ev.landUntil);
}

/** "Iunius 279 BC": the month a disruption ends in. */
function haltEndLabel(game, kind) {
  const left = (kind === 'sea' ? game.city.events.seaUntil : game.city.events.landUntil) - game.time.totalDays;
  return dateIn(game, left);
}

/** The month and year `days` days from today. */
function dateIn(game, days) {
  const t = game.time;
  const months = Math.floor((t.day + days) / CONFIG.DAYS_PER_MONTH);
  const m = t.month + months;
  let year = t.year + Math.floor(m / 12);
  if (t.year < 0 && year >= 0) year++; // no year 0
  return `${MONTH_NAMES[((m % 12) + 12) % 12]} ${formatYear(year)}`;
}

/** The route cards' and the Trade advisor's note while trade of this kind is stopped, or null. */
export function tradeHaltText(game, kind) {
  if (!tradeHalted(game, kind)) return null;
  return kind === 'sea' ? `Storms: no ship sails for your city until ${haltEndLabel(game, 'sea')}.`
    : `${game.scenario.map?.type === 'desert' ? 'Sandstorms' : 'Landslides'}: no caravan sets out for your city until ${haltEndLabel(game, 'land')}.`;
}

/**
 * Neptune's wrath at sea (sim/religion.js): with an open sea route, merchant
 * ships under sail sink (those tied up at an Emporium ride it out) and no
 * ship sails for NEPTUNE_HALT_DAYS. @returns {{ sunk: number, halted: boolean }}
 */
export function neptuneStorms(game) {
  if (!Object.entries(game.city.trade.routes).some(([id, r]) => r.open && TRADE_PARTNERS[id]?.route === 'sea')) return { sunk: 0, halted: false };
  let sunk = 0;
  for (const w of [...game.walkers.values()]) {
    if (w.type !== 'ship' || (w.state !== 'toDock' && w.state !== 'leaving')) continue;
    const dock = game.buildings.get(w.target);
    if (dock && dock.shipId === w.id) dock.shipId = 0;
    killWalker(game, w);
    sunk++;
  }
  haltTrade(game, 'sea', NEPTUNE_HALT_DAYS);
  return { sunk, halted: true };
}

// ---------------------------------------------------------------------------
// Scheduled events
// ---------------------------------------------------------------------------

/** Monthly: the mission's scheduled events due this month. */
export function scheduledEventsMonth(game) {
  const now = game.time.totalMonths;
  const sched = missionEvents(game.scenario);
  if (game.flags.events === 'off') return;
  if (sched.quake && eventMonth(game.seed, 'quake', 0, sched.quake.year) === now && !game.city.events.quake) startQuake(game, sched.quake.size);
  sched.emperor.forEach((year, k) => { if (eventMonth(game.seed, 'emperor', k, year) === now) newEmperor(game); });
  sched.priceChanges.forEach((p, k) => { if (GOODS[p.good] && eventMonth(game.seed, 'price', k, p.year) === now) priceNews(game, p); });
  // The gladiators' revolt (sim/revolt.js): nothing at all unless a school works that month.
  sched.revolt.forEach((year, k) => { if (eventMonth(game.seed, 'revolt', k, year) === now && startRevolt(game)) count(game, 'revolt'); });
}

/** Monthly hook (core/game.js onMonth): the scheduled events, then the random draw. */
export function eventsMonthly(game) {
  scheduledEventsMonth(game);
  randomEventMonth(game);
}

/** A new Caesar rules: favor starts afresh at 50 (the later community engine's rule; the original never applied it). */
export function newEmperor(game) {
  const r = game.city.ratings;
  const before = Math.floor(r.favor);
  r.favor = 50;
  count(game, 'emperor');
  game.message(`A new Caesar rules in Rome. Your standing with him starts afresh: favor ${before} becomes 50.`, 'imperial');
  game.events.emit('sound', { name: 'fanfare' });
}

/** The month a scheduled price change takes effect: its news (sim/prices.js applies it). */
function priceNews(game, p) {
  const pct = Math.round(Math.abs(p.change) * 100);
  const name = GOODS[p.good].name.toLowerCase();
  count(game, 'price');
  game.message(p.change >= 0
    ? `News from Rome: ${name} is in demand across the empire. Its price rises ${pct}% with every partner, to buy and to sell, from now on.`
    : `News from Rome: the empire is awash with ${name}. Its price falls ${pct}% with every partner, to buy and to sell, from now on.`, 'info');
}

// ---------------------------------------------------------------------------
// The earthquake
// ---------------------------------------------------------------------------

/**
 * Where a quake strikes: the land tile nearest the middle of the city's
 * buildings, moved up to QUAKE_JITTER tiles either way, never on water,
 * rock or the Imperial road (`keep`: tile indices that hold). Null for a
 * province with no buildings.
 */
export function quakePoint(game, rng, keep = new Set()) {
  const { map } = game;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const b of game.buildings.values()) {
    if (b.def.kind === 'village') continue; // (the city's own middle: a native village is not the city, sim/natives.js)
    sx += b.x + b.size / 2;
    sy += b.y + b.size / 2;
    n++;
  }
  if (!n) return null;
  const cx = Math.floor(sx / n) + rng.range(-QUAKE_JITTER, QUAKE_JITTER);
  const cy = Math.floor(sy / n) + rng.range(-QUAKE_JITTER, QUAKE_JITTER);
  const open = (x, y) => {
    if (!map.inBounds(x, y)) return false;
    const i = map.idx(x, y);
    const t = map.terrain[i];
    return t !== Terrain.WATER && t !== Terrain.ROCK && !map.fixedRoad[i] && !keep.has(i);
  };
  for (let r = 0; r < Math.max(map.w, map.h); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (open(cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
      }
    }
  }
  return null;
}

/** Every tile a native village's piece stands on (an earthquake passes them by). */
function villageTiles(game) {
  const out = [];
  for (const b of game.buildings.values()) {
    if (b.def.kind !== 'village') continue;
    for (let dy = 0; dy < b.size; dy++) for (let dx = 0; dx < b.size; dx++) out.push(game.map.idx(b.x + dx, b.y + dy));
  }
  return out;
}

/**
 * The earth shakes: strike the point, then the cracks grow day by day
 * (updateQuake). `size`: small | medium | large. @returns the quake, or null
 * (no city to strike, or one already shaking)
 */
export function startQuake(game, size = 'small') {
  const ev = game.city.events;
  if (ev.quake) return null;
  const def = QUAKE_SIZES[size] || QUAKE_SIZES.small;
  const stream = `${game.seed}:quake:${game.time.totalTicks}`;
  const rng = new RNG(stream);
  // The Imperial road holds, and so do the wolves' dens (sim/wildlife.js): a
  // crack passes under a den without turning it to rock, and the quake never
  // strikes there first.
  // A native village holds too (sim/natives.js): a lost meeting place would
  // leave its huts with no village.
  const keep = [...imperialRoad(game), ...denTiles(game), ...villageTiles(game)];
  const p = quakePoint(game, rng, new Set(keep));
  if (!p) return null;
  const tries = rng.range(def.tries[0], def.tries[1]);
  const q = { size: def.name, x: p.x, y: p.y, arms: [0, 1, 2, 3].map(() => ({ x: p.x, y: p.y })), left: tries, tries, perDay: def.perDay, t: 0, lost: 0, homes: 0, stream, keep };
  ev.quake = q;
  count(game, 'quake');
  game.lastUndo = null;
  strike(game, q, game.map.idx(p.x, p.y));
  game.message(`Earthquake! The ground splits open near ${p.x}, ${p.y}. Cracks will spread from there for ${Math.round(tries / def.perDay)} days or so, and whatever stands in their way will fall.`, 'bad', p.x, p.y, { kind: 'collapse' });
  game.events.emit('sound', { name: 'collapse' });
  return q;
}

/**
 * The road that holds: the shortest way by road from the map entry to the
 * exit as the quake finds it (tile indices), and the two end tiles, which
 * can never be removed anyway. Mapgen marks only those ends `fixedRoad`, and
 * the player may have rebuilt the rest, so it is found afresh, once, and
 * kept with the quake (saved).
 */
function imperialRoad(game) {
  const { map } = game;
  const from = map.idx(map.entry.x, map.entry.y);
  const to = map.idx(map.exit.x, map.exit.y);
  return game.pf.roadPath(from, to) || (map.road[from] ? [from] : []);
}

/** The tiles of the wolf packs' dens (none on a map without wolves). */
function denTiles(game) {
  const { map } = game;
  return (game.wildlife?.packs || []).filter((p) => map.inBounds(p.den.x, p.den.y)).map((p) => map.idx(p.den.x, p.den.y));
}

/** The quake's `keep` as a set (built once per quake object, so a loaded quake builds its own). */
const keepSets = new WeakMap();
function keepSet(q) {
  let k = keepSets.get(q);
  if (!k) keepSets.set(q, (k = new Set(q.keep || [])));
  return k;
}

/** Per tick: the quake's cracks try their steps, perDay a day spread over the day's ticks. */
export function updateQuake(game) {
  const q = game.city.events?.quake;
  if (!q) return;
  const due = Math.floor(((q.t + 1) * q.perDay) / TPD) - Math.floor((q.t * q.perDay) / TPD);
  q.t++;
  for (let k = 0; k < due && q.left > 0; k++) crackTry(game, q);
  if (q.left <= 0) endQuake(game, q);
}

/**
 * One try: a crack, drawn 1 in 4, steps its own way half the time and to a
 * side a quarter each; into rock, water or off the map it fails (the try is
 * spent). Under the Imperial road it moves on without striking.
 */
function crackTry(game, q) {
  const { map } = game;
  const r = new RNG(`${q.stream}:${q.left}`);
  q.left--;
  const a = r.int(4);
  const p = r.next();
  const dir = p < 0.5 ? a : p < 0.75 ? (a + 1) % 4 : (a + 3) % 4;
  const arm = q.arms[a];
  const nx = arm.x + DIRS4[dir][0];
  const ny = arm.y + DIRS4[dir][1];
  if (!map.inBounds(nx, ny)) return;
  const i = map.idx(nx, ny);
  if (map.terrain[i] === Terrain.ROCK || map.terrain[i] === Terrain.WATER) return;
  arm.x = nx;
  arm.y = ny;
  if (map.fixedRoad[i] || keepSet(q).has(i)) return;
  strike(game, q, i);
}

/** A crack strikes tile i: whatever stands there falls, and it is rock for good. */
function strike(game, q, i) {
  const { map } = game;
  let built = false;
  const id = map.building[i];
  const b = id ? game.buildings.get(id) : null;
  if (b) {
    const main = ruinBuilding(game, b, 'quake', i);
    q.lost++;
    if (main.house) q.homes++;
    built = true;
    game.events.emit('collapse', { x: b.x, y: b.y, size: b.size });
    game.events.emit('sound', { name: 'collapse' });
  }
  if (map.road[i] || map.aqueduct[i] || map.wall[i] || map.roadblock[i]) built = true;
  map.road[i] = 0;
  map.aqueduct[i] = 0;
  map.wall[i] = 0;
  map.roadblock[i] = 0;
  game.wallHp.delete(i);
  map.rubble[i] = 0;
  clearRuin(game, i);
  game.fires.delete(i);
  map.terrain[i] = Terrain.ROCK;
  game.lastUndo = null; // (an undo could put back what the crack took)
  // Desirability reads trees and rubble as well as buildings, so it is
  // redone after any strike (a loaded game recomputes it and must agree).
  if (built) game.onMapEdited();
  else {
    game.markDirty('des');
    map.touch();
  }
}

/** The last try is spent: the earth is still. */
function endQuake(game, q) {
  game.city.events.quake = null;
  count(game, 'quakeLost', q.lost);
  count(game, 'quakeHomes', q.homes);
  const lost = q.lost === 0 ? 'Nothing was lost.' : `${q.lost} building${q.lost === 1 ? ' was' : 's were'} lost${q.homes ? `, ${q.homes} of them homes` : ''}.`;
  game.message(`The earth is still. ${lost} The cracks are rock now: build around them.`, q.lost ? 'warn' : 'info', q.x, q.y);
}

/** For the console and the reports: "a medium earthquake, 40 of 130 tries left, 6 buildings lost so far". */
export function quakeSummary(game) {
  const q = game.city.events?.quake;
  if (!q) return null;
  return `${withArticle(q.size)} earthquake at ${q.x}, ${q.y}: ${q.left} of ${q.tries} tries left, ${q.lost} building${q.lost === 1 ? '' : 's'} lost so far`;
}

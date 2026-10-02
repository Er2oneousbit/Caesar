/**
 * crime.js
 * ----------------------------------------------------------------------------
 * Crime: unhappy homes (sim/mood.js) breed protesters, thieves and riots, and
 * prefects and soldiers catch them.
 *
 * The daily roll (after fires). Not below CRIME_MIN_POP people, nor in a
 * mission whose scenario says `crime: false` (the first two):
 *   1. every occupied home at mood CRIME_MOOD or more settles down (its
 *      "criminal produced" flag goes back to 0);
 *   2. among homes that can still produce something (a protester needs the
 *      flag at 0; a thief the flag below 2 and mood under THIEF_MOOD; a riot
 *      mood RIOT_MOOD or less while city mood is under RIOT_CITY_MOOD) the one
 *      with the lowest mood is chosen, the oldest on a tie. (The original
 *      looked only at the unhappiest home, so one that had used up its
 *      criminals blocked every other unhappy home.)
 *   3. chance = CRIME_CHANCE_MAX x (1 - city mood / CRIME_CHANCE_ZERO), one
 *      smooth line (the original's jumped up at two mood edges), x the
 *      difficulty's `crime`, halved when a prefect passed the home within
 *      POLICE_DAYS (a change from the original, where prefects did not
 *      prevent crime).
 *   4. the worst the home can produce happens: a riot, else a thief, else a
 *      protester.
 *
 * Protester  stands on a road near its home for about four days. Harmless,
 *            and no cost to peace.
 * Thief      walks to the nearest working Forum or Senate and steals a share
 *            of this year's taxes there, never more than the treasury holds
 *            (else from the nearest stocked market), then vanishes. A prefect
 *            who catches him first saves the money: the theft happens on
 *            arrival, not at spawn (in the original the walker was only
 *            decoration).
 * Riot       the rioters' own home burns; a mob (1 to 6, by population) sets
 *            off, overland, for the most prized building near their home
 *            (data/crime.js RIOT_TARGETS; the original's mob crossed the whole
 *            map), or with none near, the nearest listed building it can
 *            reach, setting fire to what it passes. Every home's mood rises by
 *            RIOT_MOOD_BOOST and peace falls at once (see Peace). Rioters
 *            go home after RIOTER_MAX_DAYS.
 *
 * Catching: a prefect (not one fighting a fire) or a soldier next to a
 * criminal holds him until his CRIMINAL_HP of struggle is spent. Every
 * HUNT_EVERY ticks a roaming prefect also looks for a thief or rioter within
 * HUNT_RANGE that nobody chases yet and runs after him (over open land if
 * need be); once he is caught the prefect goes home. One he finds no way to
 * reach (across a river) he leaves alone for HUNT_RETRY_TICKS and keeps on
 * his patrol. Fires come first: a prefect sent to a fire drops the hunt
 * (sim/risk.js).
 *
 * Peace, scaled by the difficulty's crimePeace (0 Easy, 1 Normal, 2 Hard,
 * 3 Insane): a riot costs RIOT_PEACE x that at once, a thief THIEF_PEACE x
 * that at once and (above 0) the month's peace gain (sim/ratings.js).
 * Protests cost nothing, except that on Insane every protestPeaceEvery-th
 * costs PROTEST_PEACE. The year's counts (city.crime) feed the sim report.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { HOUSE_TIERS } from '../data/housing.js';
import { GOODS } from '../data/goods.js';
import { UNIT_TYPES } from '../data/units.js';
import { RIOT_TARGETS, RIOT_SPARED_KINDS, RIOT_SPARED_TIER, MOOD_REASONS } from '../data/crime.js';
import { Terrain, Road, Wall } from '../world/map.js';
import { spawnWalker, killWalker } from './entities.js';
import { followPath, goHome, startRoaming } from './movement.js';
import { igniteBuilding, buildingLabel, withArticle } from './risk.js';
import { transact } from './economy.js';
import { liftAllMoods, cityMoodCause } from './mood.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Crime's cost in peace, at once (the difficulty has already scaled it). */
function losePeace(game, n) {
  const r = game.city.ratings;
  if (n > 0) r.peace = Math.max(0, r.peace - n);
}

/** A year's (or a game's) crime counts. */
export function newCrimeCounts() {
  return { protesters: 0, thieves: 0, thefts: 0, stolen: 0, looted: 0, riots: 0, riotBurned: 0, caught: 0 };
}

/** Fresh city.crime for a new game (and for saves made before crime existed). */
export function newCrimeState() {
  return {
    month: false, // a thief appeared this month: no peace gain (ratings.js; not on Easy); protesters do not count
    protestTally: 0, // protests since the last one that cost peace (Insane, see data/difficulty.js)
    protestMonth: -1, // month of the last protest message (at most one a month)
    riotMessageDay: -99, // last "rioters set ... on fire" message (they are grouped)
    year: newCrimeCounts(),
    lastYear: null,
    total: newCrimeCounts(), // since the city was founded (the sim report)
  };
}

function bump(game, key, n = 1) {
  const cr = game.city.crime;
  cr.year[key] = (cr.year[key] || 0) + n;
  cr.total[key] = (cr.total[key] || 0) + n;
}

/** Yearly: this year's counts become last year's. */
export function crimeNewYear(game) {
  const cr = game.city.crime;
  cr.lastYear = cr.year;
  cr.year = newCrimeCounts();
}

/** Crime happens in this game (not in the first two missions). */
export function crimeEnabled(game) {
  return game.scenario.crime !== false;
}

// ---------------------------------------------------------------------------
// The rules, as pure functions (tests call these directly)
// ---------------------------------------------------------------------------

/** Daily chance of a crime at city mood `s` (before difficulty and police cover). */
export function crimeChance(s) {
  return CONFIG.CRIME_CHANCE_MAX * Math.max(0, 1 - s / CONFIG.CRIME_CHANCE_ZERO);
}

/**
 * The worst a home at `mood` with criminal flag `flag` can produce while the
 * city's mood is `s`: 'riot', 'thief', 'protester' or null. `riotOk` false:
 * no road close enough for a riot.
 */
export function crimeOutcome(mood, flag, s, riotOk = true) {
  if (mood >= CONFIG.CRIME_MOOD) return null;
  if (riotOk && mood <= CONFIG.RIOT_MOOD && s < CONFIG.RIOT_CITY_MOOD) return 'riot';
  if (mood < CONFIG.THIEF_MOOD && flag < 2) return 'thief';
  if (flag === 0) return 'protester';
  return null;
}

/**
 * Denarii a thief takes from the Forum when `taxes` were collected this year
 * and the treasury holds `treasury`: a thief cannot take coins that are not
 * in the chest, so a theft never puts the city in debt.
 */
export function theftAmount(taxes, treasury = Infinity) {
  const n = Math.min(CONFIG.THEFT_CAP, Math.floor(Math.max(0, taxes) * CONFIG.THEFT_SHARE));
  if (n < CONFIG.THEFT_MIN) return 0;
  return Math.min(n, Math.max(0, Math.floor(treasury)));
}

/** Rioters in a mob, by city population. */
export function mobSize(pop) {
  for (const [upTo, n] of CONFIG.RIOT_MOB) if (pop <= upTo) return n;
  return CONFIG.RIOT_MOB_MAX;
}

/** Can a mob set this building alight? */
export function riotEligible(b) {
  if (!b) return false;
  if (b.house) return b.house.tier > RIOT_SPARED_TIER;
  return !RIOT_SPARED_KINDS.includes(b.def.kind);
}

/** Place of a building in RIOT_TARGETS (0 = most prized), or -1 if a mob ignores it. */
export function riotRank(b) {
  if (!riotEligible(b)) return -1;
  for (let k = 0; k < RIOT_TARGETS.length; k++) {
    const t = RIOT_TARGETS[k];
    if (t.type && b.type === t.type) return k;
    if (t.kind && b.def.kind === t.kind) return k;
    if (t.temple && b.def.god) return k;
    if (t.homeMin && b.house && b.house.tier >= t.homeMin) return k;
  }
  return -1;
}

/** Tiles from (x, y) to the nearest tile of a building's footprint (either axis). */
function footprintDist(b, x, y) {
  const dx = x < b.x ? b.x - x : x >= b.x + b.size ? x - (b.x + b.size - 1) : 0;
  const dy = y < b.y ? b.y - y : y >= b.y + b.size ? y - (b.y + b.size - 1) : 0;
  return Math.max(dx, dy);
}

/**
 * What a mob at (x, y) goes for: the most prized listed building within
 * RIOT_TARGET_RANGE (nearest of equals, then the oldest); if none is that
 * close, the nearest listed building anywhere; null if there is none.
 */
export function pickRiotTarget(game, x, y, excludeId = 0) {
  let near = null;
  let nearKey = null;
  let far = null;
  let farKey = null;
  for (const b of game.buildings.values()) {
    if (b.id === excludeId) continue;
    const rank = riotRank(b);
    if (rank < 0) continue;
    const d = footprintDist(b, x, y);
    if (d <= CONFIG.RIOT_TARGET_RANGE) {
      const key = [rank, d, b.id];
      if (!nearKey || lexLess(key, nearKey)) { near = b; nearKey = key; }
    } else if (!near) {
      const key = [d, b.id];
      if (!farKey || lexLess(key, farKey)) { far = b; farKey = key; }
    }
  }
  return near || far;
}

/**
 * The nearest listed building a mob starting on tile `from` can actually
 * walk to (a breadth-first search over open land, so no path budget runs
 * out on a big map and a river in the way is noticed), with the path there.
 * @returns {{b:object, path:number[]}|null}
 */
export function nearestReachableRiotTarget(game, from, excludeId = 0) {
  const { map } = game;
  const prev = new Int32Array(map.size).fill(-2); // -2 = not reached
  const queue = new Int32Array(map.size);
  let head = 0;
  let tail = 0;
  prev[from] = -1;
  queue[tail++] = from;
  while (head < tail) {
    const i = queue[head++];
    const x = map.xOf(i);
    const y = map.yOf(i);
    for (const [dx, dy] of NEIGHBORS) {
      if (!map.inBounds(x + dx, y + dy)) continue;
      const j = map.idx(x + dx, y + dy);
      const id = map.building[j];
      if (id && id !== excludeId) {
        const b = game.buildings.get(id);
        if (riotRank(b) >= 0) {
          const path = [];
          for (let k = i; k !== -1; k = prev[k]) path.push(k);
          return { b, path: path.reverse() };
        }
      }
      if (prev[j] !== -2 || !landPassable(game, j)) continue;
      prev[j] = i;
      queue[tail++] = j;
    }
  }
  return null;
}

/**
 * A mob on tile `from`: the most prized listed building within
 * RIOT_TARGET_RANGE of (x, y), else the nearest listed building it can reach.
 * @returns {{b:object, path:number[]|null}|null} path: known only for the second kind
 */
function riotTargetFrom(game, from, x, y, excludeId = 0) {
  const b = pickRiotTarget(game, x, y, excludeId);
  if (b && footprintDist(b, x, y) <= CONFIG.RIOT_TARGET_RANGE) return { b, path: null };
  return nearestReachableRiotTarget(game, from, excludeId);
}

function lexLess(a, b) {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k];
  return false;
}

/**
 * The nearest road tile within `radius` of a building's footprint (either
 * axis; ties by straight-line distance, then scan order), or -1.
 */
export function roadNearFootprint(game, b, radius) {
  const { map } = game;
  let best = -1;
  let bestD = Infinity;
  for (let y = b.y - radius; y < b.y + b.size + radius; y++) {
    for (let x = b.x - radius; x < b.x + b.size + radius; x++) {
      if (!map.inBounds(x, y)) continue;
      const i = map.idx(x, y);
      if (!map.road[i]) continue;
      const dx = x < b.x ? b.x - x : x >= b.x + b.size ? x - (b.x + b.size - 1) : 0;
      const dy = y < b.y ? b.y - y : y >= b.y + b.size ? y - (b.y + b.size - 1) : 0;
      const d = Math.max(dx, dy) * 10 + Math.min(dx, dy);
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The daily roll
// ---------------------------------------------------------------------------

/**
 * Settle homes at mood CRIME_MOOD+ and choose the home a crime would come
 * from: the lowest mood among homes that can still produce something (oldest
 * on a tie). @returns {{b:object, outcome:string}|null}
 */
export function pickCrimeHouse(game) {
  const s = game.city.sentiment;
  let best = null;
  for (const b of game.buildings.values()) {
    const h = b.house;
    if (!h || h.pop <= 0 || h.mood === null || h.mood === undefined) continue;
    if (h.mood >= CONFIG.CRIME_MOOD) { h.criminal = 0; continue; }
    if (best && h.mood > best.b.house.mood) continue;
    const flag = h.criminal || 0;
    let outcome = crimeOutcome(h.mood, flag, s);
    if (outcome === 'riot' && roadNearFootprint(game, b, CONFIG.RIOT_ROAD_RADIUS) < 0) outcome = crimeOutcome(h.mood, flag, s, false);
    if (!outcome) continue;
    if (!best || h.mood < best.b.house.mood || b.id < best.b.id) best = { b, outcome };
  }
  return best;
}

/** Daily: maybe one crime. */
export function updateCrime(game) {
  if (!crimeEnabled(game) || game.city.population < CONFIG.CRIME_MIN_POP) return;
  const pick = pickCrimeHouse(game);
  if (!pick) return;
  const h = pick.b.house;
  const p = crimeChance(game.city.sentiment) * (game.difficulty.crime ?? 1) * (h.police > 0 ? 0.5 : 1);
  if (!game.rng.chance(p)) return;
  commitCrime(game, pick.b, pick.outcome);
}

/**
 * The home breeds its criminal (also the console's `crime` command).
 * @returns {object|null} the first walker that appeared, or null
 */
export function commitCrime(game, b, outcome) {
  if (outcome === 'riot') return startRiot(game, b);
  if (outcome === 'thief') return spawnThief(game, b);
  return spawnProtester(game, b);
}

function spawnProtester(game, b) {
  const h = b.house;
  h.criminal = Math.max(h.criminal || 0, 1);
  const road = roadNearFootprint(game, b, CONFIG.CRIMINAL_ROAD_RADIUS);
  if (road < 0) return null; // the flag is spent all the same
  const [lo, hi] = CONFIG.PROTEST_TICKS;
  const w = spawnWalker(game, 'protester', road, null, { state: 'protest', home: b.id, hp: CONFIG.CRIMINAL_HP, waitTicks: game.rng.range(lo, hi), afterWait: 'vanish' });
  if (!w) return null;
  // Protests are the mildest sign of unrest and homes protest below mood 50
  // while peace grows from 45, so a cost for each would keep even a content
  // city from gaining peace. Only where the difficulty says so does every
  // so-many-th protest cost a little (see data/difficulty.js).
  const cr = game.city.crime;
  bump(game, 'protesters');
  const every = game.difficulty.protestPeaceEvery;
  if (every > 0) {
    cr.protestTally = (cr.protestTally || 0) + 1;
    if (cr.protestTally >= every) {
      cr.protestTally = 0;
      losePeace(game, CONFIG.PROTEST_PEACE);
    }
  }
  if (cr.protestMonth !== game.time.totalMonths) {
    cr.protestMonth = game.time.totalMonths;
    const why = h.moodReason && MOOD_REASONS[h.moodReason] ? ` ${MOOD_REASONS[h.moodReason]}.` : '';
    game.message(`Citizens are protesting in the street by ${withArticle(buildingLabel(b))}.${why}`, 'warn', b.x, b.y);
  }
  return w;
}

function spawnThief(game, b) {
  const h = b.house;
  h.criminal = 2;
  const road = roadNearFootprint(game, b, CONFIG.CRIMINAL_ROAD_RADIUS);
  if (road < 0) return null;
  const w = spawnWalker(game, 'thief', road, null, { state: 'steal', home: b.id, hp: CONFIG.CRIMINAL_HP });
  if (!w) return null;
  sendThief(game, w);
  // One who vanished at once (a stub of road with nowhere to go) never
  // walked the streets: he is not counted and costs no peace.
  if (!game.walkers.has(w.id)) return null;
  const m = game.difficulty.crimePeace;
  if (m > 0) {
    game.city.crime.month = true;
    losePeace(game, CONFIG.THIEF_PEACE * m);
  }
  bump(game, 'thieves');
  return w;
}

/** A Forum or Senate a thief can rob: staffed and on a road. */
const isTreasury = (b) => !!b && (b.type === 'forum' || b.type === 'senate') && b.efficiency > 0 && b.accessRoad >= 0;
/** A market with anything on its stalls. */
const isStockedMarket = (b) => !!b && b.def.kind === 'market' && Object.values(b.stock).some((n) => n >= 1);

/**
 * Send a thief to the nearest Forum or Senate by road, else the nearest
 * stocked market; with neither in reach he wanders a little and gives up.
 */
function sendThief(game, w) {
  const { map, pf, buildings } = game;
  const here = map.idx(w.x, w.y);
  let found = map.road[here] ? pf.findNearest(here, (id) => isTreasury(buildings.get(id)), CONFIG.THIEF_RANGE) : null;
  if (!found && map.road[here]) found = pf.findNearest(here, (id) => isStockedMarket(buildings.get(id)), CONFIG.THIEF_RANGE);
  if (!found) {
    startRoaming(game, w, w.id % 4); // a short aimless walk (WALKER_TYPES.thief.roam), then he is gone
    return;
  }
  w.state = 'steal';
  w.target = found.id;
  followPath(game, w, found.path);
}

/** A thief reached his target: rob it, then vanish. */
export function thiefArrive(game, w) {
  const b = game.buildings.get(w.target);
  if (isTreasury(b)) {
    const n = theftAmount(game.city.finance.thisYear.taxes || 0, game.city.treasury);
    if (n > 0) {
      transact(game, 'stolen', -n);
      bump(game, 'thefts');
      bump(game, 'stolen', n);
      game.message(`A thief stole ${n} Dn from the ${b.def.name}!`, 'bad', b.x, b.y);
      game.events.emit('sound', { name: 'coin' });
    }
    killWalker(game, w);
    return;
  }
  if (isStockedMarket(b)) {
    let good = null;
    for (const k in b.stock) if (!good || b.stock[k] > b.stock[good]) good = k;
    const n = Math.min(CONFIG.MARKET_THEFT_MAX, Math.floor(b.stock[good] / 2));
    if (n > 0) {
      b.stock[good] -= n;
      bump(game, 'thefts');
      bump(game, 'looted', n);
      game.message(`A thief made off with ${n} ${GOODS[good].name.toLowerCase()} from ${withArticle(b.def.name)}.`, 'bad', b.x, b.y);
    }
    killWalker(game, w);
    return;
  }
  // The target closed or emptied on the way: look once more, then give up.
  if (!w.retried) {
    w.retried = true;
    sendThief(game, w);
    return;
  }
  killWalker(game, w);
}

// ---------------------------------------------------------------------------
// Riots
// ---------------------------------------------------------------------------

/**
 * A riot at home `b`: its home burns, a mob sets off, the city's anger is
 * spent (every home's mood + RIOT_MOOD_BOOST) and peace falls.
 * @returns {object|null} the first rioter, or null (no road: nothing happens)
 */
export function startRiot(game, b) {
  const { map } = game;
  const road = roadNearFootprint(game, b, CONFIG.RIOT_ROAD_RADIUS);
  if (road < 0) return null;
  const c = game.city;
  const cx = b.x + (b.size >> 1);
  const cy = b.y + (b.size >> 1);
  const label = buildingLabel(b);
  const reason = cityMoodCause(game) || b.house.moodReason; // the city's worst mood factor, else the home's own trouble
  const target = riotTargetFrom(game, road, cx, cy, b.id)?.b ?? null;
  const n = mobSize(c.population);
  igniteBuilding(game, b, 'riotQuiet'); // the riot's own message says so
  let first = null;
  for (let i = 0; i < n; i++) {
    const w = spawnWalker(game, 'rioter', road, null, {
      state: 'riot',
      hp: CONFIG.CRIMINAL_HP,
      target: target ? target.id : 0,
      offRoad: true,
      startDay: game.time.totalDays,
      waitTicks: CONFIG.RIOTER_START_TICKS + i * CONFIG.RIOTER_STAGGER_TICKS,
      afterWait: 'riotGo',
    });
    if (w && !first) first = w;
  }
  liftAllMoods(game, CONFIG.RIOT_MOOD_BOOST);
  losePeace(game, CONFIG.RIOT_PEACE * game.difficulty.crimePeace);
  bump(game, 'riots');
  const why = reason && MOOD_REASONS[reason] ? MOOD_REASONS[reason] : 'The people have had enough';
  const aim = target ? ` They are heading for ${withArticle(buildingLabel(target))}.` : '';
  game.message(`Riot! The people of ${withArticle(label)} have set their home alight and taken to the streets. ${why}.${aim}`, 'bad', map.xOf(road), map.yOf(road));
  game.events.emit('sound', { name: 'horn' });
  return first;
}

/** Can a walker off the roads step onto tile i? (`throughId`: a building it may enter) */
export function landPassable(game, i, throughId = 0) {
  const { map } = game;
  const t = map.terrain[i];
  if (t === Terrain.ROCK) return false;
  if (t === Terrain.WATER && map.road[i] !== Road.BRIDGE) return false;
  if (map.wall[i] === Wall.WALL) return false; // gates let citizens through
  const id = map.building[i];
  return !id || id === throughId;
}

/**
 * A route over open land and roads (roads are quicker, trees slower) from
 * tile `from` to tile `to`. With `targetId` the path may end on that
 * building; it is cut short at the building's first tile, so the walker stops
 * beside it. @returns {number[]|null}
 */
export function landPath(game, from, to, targetId = 0) {
  const { map } = game;
  const cost = (i) => {
    if (!landPassable(game, i, targetId)) return Infinity;
    if (map.road[i]) return 0.7;
    return map.terrain[i] === Terrain.TREES ? 1.6 : 1;
  };
  const path = game.pf.astar(from, to, cost, { maxNodes: 12000 });
  if (!path || !targetId) return path;
  const k = path.findIndex((i, n) => n > 0 && map.building[i] === targetId);
  return k > 0 ? path.slice(0, k) : path;
}

/** The tile of a building's footprint nearest to (x, y). */
function nearestTileOf(game, b, x, y) {
  return game.map.idx(Math.max(b.x, Math.min(b.x + b.size - 1, x)), Math.max(b.y, Math.min(b.y + b.size - 1, y)));
}

/** Has this rioter been at large for RIOTER_MAX_DAYS? Then the mob has lost heart. */
const rioterSpent = (game, w) => game.time.totalDays - (w.startDay ?? game.time.totalDays) >= CONFIG.RIOTER_MAX_DAYS;

/**
 * A rioter looks for (or keeps) a target and sets off. A target he cannot
 * reach (across a river, or past the path search's budget) gives way to the
 * nearest listed building he can; with none at all he leaves.
 */
function riotGo(game, w) {
  if (rioterSpent(game, w)) { killWalker(game, w); return; }
  const { map } = game;
  const here = map.idx(w.x, w.y);
  let t = game.buildings.get(w.target);
  let path = null;
  if (riotRank(t) < 0) {
    const pick = riotTargetFrom(game, here, w.x, w.y);
    t = pick ? pick.b : null;
    path = pick ? pick.path : null;
  }
  if (t && !path) path = landPath(game, here, nearestTileOf(game, t, w.x, w.y), t.id);
  if (!path) {
    const pick = nearestReachableRiotTarget(game, here);
    t = pick ? pick.b : null;
    path = pick ? pick.path : null;
  }
  if (!t || !path) { killWalker(game, w); return; } // nothing left he can reach: he goes home
  w.target = t.id;
  w.state = 'riot';
  followPath(game, w, path);
}

/** A rioter sets a building alight, then stays by the flames a while. */
function riotBurn(game, w, b) {
  const now = game.time.totalDays;
  const cr = game.city.crime;
  const loud = now - cr.riotMessageDay >= 4;
  if (loud) cr.riotMessageDay = now;
  igniteBuilding(game, b, loud ? 'riot' : 'riotQuiet');
  bump(game, 'riotBurned');
  w.path = null;
  w.moving = false;
  w.progress = 0;
  w.waitTicks = CONFIG.RIOTER_BURN_TICKS;
  w.afterWait = 'riotGo';
}

const NEIGHBORS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * A rioter stepped onto a new tile: he sets the first building beside him
 * that a mob burns alight (neighbors in a fixed order).
 * @returns {boolean} true if he stopped to burn something
 */
export function rioterStep(game, w) {
  if (w.state !== 'riot') return false;
  const { map } = game;
  for (const [dx, dy] of NEIGHBORS) {
    const b = game.buildings.get(map.buildingAt(w.x + dx, w.y + dy));
    if (riotEligible(b)) {
      riotBurn(game, w, b);
      return true;
    }
  }
  return false;
}

/** A rioter reached his target: burn it if it still stands, then pick the next. */
export function rioterArrive(game, w) {
  const t = game.buildings.get(w.target);
  if (riotEligible(t) && footprintDist(t, w.x, w.y) <= 1) {
    riotBurn(game, w, t);
    return;
  }
  riotGo(game, w);
}

// ---------------------------------------------------------------------------
// Walker hooks (sim/walkers.js)
// ---------------------------------------------------------------------------

/** A criminal's wait ran out. */
export function criminalAfterWait(game, w, what) {
  if (what === 'riotGo') riotGo(game, w);
  else killWalker(game, w); // a protester goes home ('vanish')
}

/**
 * The next tile of an off-road walker's path is blocked (something was built
 * there): plan again.
 */
export function offRoadReroute(game, w) {
  w.path = null;
  w.moving = false;
  if (w.type === 'rioter') riotGo(game, w);
  else if (w.state === 'hunt') chase(game, w, game.walkers.get(w.huntTarget));
  else headHome(game, w);
}

/** A hunting prefect reached where his quarry was. */
export function hunterArrive(game, w) {
  const t = game.walkers.get(w.huntTarget);
  if (!t || t.dead) { endHunt(game, w); return; }
  if (Math.max(Math.abs(t.x - w.x), Math.abs(t.y - w.y)) <= 1) return; // holding him (updateCriminals)
  chase(game, w, t);
}

// ---------------------------------------------------------------------------
// Catching and hunting (every tick)
// ---------------------------------------------------------------------------

/** Prefects busy with a fire do not stop for criminals. */
const onFireDuty = (p) => p.state === 'toFire' || p.state === 'extinguish';

/** Will prefect `p` leave criminal `t` alone for now (no way to reach him lately)? */
function noWayTo(game, p, t) {
  const until = p.noChase ? p.noChase[t.id] : undefined;
  return until !== undefined && game.time.totalTicks < until;
}

/**
 * Remember that `p` found no way to reach `t`, so the next looks around skip
 * him for HUNT_RETRY_TICKS: a failed search over open land costs about a
 * millisecond on a big map, too much to repeat every HUNT_EVERY ticks.
 */
function markNoWay(game, p, t) {
  const now = game.time.totalTicks;
  const keep = {};
  for (const id in p.noChase || {}) if (p.noChase[id] > now) keep[id] = p.noChase[id];
  keep[t.id] = now + CONFIG.HUNT_RETRY_TICKS;
  p.noChase = keep;
}

/**
 * Start a chase from a patrol: false (and he keeps to his patrol, or his walk
 * home) when there is no way to reach the criminal.
 */
function startChase(game, p, t) {
  const { map } = game;
  const path = landPath(game, map.idx(p.x, p.y), map.idx(t.x, t.y));
  if (!path) { markNoWay(game, p, t); return false; }
  runAfter(game, p, t, path);
  return true;
}

/** Keep running after criminal `t` (over open land if need be); lost him: home. */
function chase(game, p, t) {
  if (!t || t.dead) { endHunt(game, p); return; }
  const { map } = game;
  const path = landPath(game, map.idx(p.x, p.y), map.idx(t.x, t.y));
  if (!path) { markNoWay(game, p, t); endHunt(game, p); return; }
  runAfter(game, p, t, path);
}

function runAfter(game, p, t, path) {
  p.state = 'hunt';
  p.huntTarget = t.id;
  p.offRoad = true;
  p.speed = CONFIG.WALKER_SPEED * CONFIG.PREFECT_RUN_SPEED;
  followPath(game, p, path);
}

function endHunt(game, p) {
  p.huntTarget = 0;
  p.speed = CONFIG.WALKER_SPEED;
  headHome(game, p);
}

/** Back to his building: by road if he stands on one, else across the land to its road. */
function headHome(game, p) {
  const { map } = game;
  const here = map.idx(p.x, p.y);
  const origin = game.buildings.get(p.origin);
  if (map.road[here] || !origin || origin.accessRoad < 0) {
    p.offRoad = false;
    goHome(game, p);
    return;
  }
  const path = landPath(game, here, origin.accessRoad);
  if (!path) { killWalker(game, p); return; }
  p.state = 'return';
  p.offRoad = true;
  followPath(game, p, path);
}

/** A criminal was caught. */
function caught(game, c, bySoldier) {
  bump(game, 'caught');
  if (c.type === 'thief') {
    game.message(`${bySoldier ? 'A soldier' : 'A prefect'} caught a thief before he could steal anything.`, 'good', c.x, c.y);
  }
  killWalker(game, c);
}

/** Per tick: prefects and soldiers next to criminals hold and catch them; prefects hunt. */
export function updateCriminals(game) {
  const criminals = [];
  const prefects = [];
  for (const w of game.walkers.values()) {
    if (w.dead) continue;
    if (w.kind === 'criminal') criminals.push(w);
    else if (w.type === 'prefect') prefects.push(w);
  }
  if (!criminals.length) {
    // Nobody left to chase: hunters head home.
    for (const p of prefects) if (p.state === 'hunt') endHunt(game, p);
    return;
  }
  const soldiers = [];
  for (const u of game.units.values()) if (u.side === 'rome' && !UNIT_TYPES[u.type].naval) soldiers.push(u); // (a warship catches nobody in the street)
  for (const c of criminals) {
    // Checked every tick, not only between moves: a rioter on a long march
    // gives up on time too.
    if (c.type === 'rioter' && rioterSpent(game, c)) { killWalker(game, c); continue; }
    let dmg = 0;
    let bySoldier = false;
    for (const p of prefects) {
      // (One fighting a raider has his hands full: sim/prefectFight.js.)
      if (onFireDuty(p) || p.fight || Math.max(Math.abs(p.x - c.x), Math.abs(p.y - c.y)) > 1) continue;
      dmg += CONFIG.CATCH_PREFECT;
      p.held = 1; // stands still while the struggle lasts
    }
    for (const u of soldiers) {
      if (Math.max(Math.abs(Math.floor(u.x) - c.x), Math.abs(Math.floor(u.y) - c.y)) > 1) continue;
      dmg += CONFIG.CATCH_SOLDIER;
      bySoldier = true;
    }
    if (dmg <= 0) continue;
    c.held = 1;
    c.hp = (c.hp ?? CONFIG.CRIMINAL_HP) - dmg;
    if (c.hp <= 0) caught(game, c, bySoldier);
  }
  if (game.time.totalTicks % CONFIG.HUNT_EVERY === 0) hunt(game, prefects);
}

/** Every HUNT_EVERY ticks: roaming prefects go after thieves and rioters nobody chases yet. */
function hunt(game, prefects) {
  const quarry = [];
  for (const w of game.walkers.values()) if (!w.dead && (w.type === 'thief' || w.type === 'rioter')) quarry.push(w);
  const chased = new Set();
  for (const p of prefects) {
    if (p.state !== 'hunt') continue;
    const t = game.walkers.get(p.huntTarget);
    if (!t || t.dead) { endHunt(game, p); continue; }
    chased.add(t.id);
    // Standing where he last saw him and the quarry moved on: after him.
    if (!p.moving && !p.pendingArrive && Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y)) > 1) chase(game, p, t);
  }
  for (const p of prefects) {
    if (p.dead || (p.state !== 'roam' && p.state !== 'return') || p.held > 0) continue;
    let best = null;
    let bestD = CONFIG.HUNT_RANGE + 1;
    for (const t of quarry) {
      if (t.dead || chased.has(t.id) || noWayTo(game, p, t)) continue;
      const d = Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y));
      if (d < bestD) { bestD = d; best = t; }
    }
    if (!best) continue;
    if (startChase(game, p, best)) chased.add(best.id);
  }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/** Live criminals by type, for the console and the sim report. */
export function criminalsAbout(game) {
  const out = { protester: 0, thief: 0, rioter: 0 };
  for (const w of game.walkers.values()) if (!w.dead && w.kind === 'criminal') out[w.type]++;
  return out;
}

/** "Mood 23 (a Hut at 12,40)" rows for the unhappiest homes, for the console. */
export function unhappiestHomes(game, n = 5) {
  const homes = [];
  for (const b of game.buildings.values()) {
    const h = b.house;
    if (h && h.pop > 0 && h.mood !== null && h.mood !== undefined) homes.push(b);
  }
  homes.sort((a, b) => a.house.mood - b.house.mood || a.id - b.id);
  return homes.slice(0, n).map((b) => `mood ${b.house.mood} ${HOUSE_TIERS[b.house.tier].name} #${b.id} at ${b.x},${b.y}${b.house.criminal ? ` (flag ${b.house.criminal})` : ''}${b.house.police > 0 ? ' police' : ''}: ${MOOD_REASONS[b.house.moodReason] || 'no complaint'}`);
}

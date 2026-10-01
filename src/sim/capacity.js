/**
 * capacity.js
 * ----------------------------------------------------------------------------
 * How many people a mission's buildings can employ: the yardstick for its
 * population goal. Beside sim/pace.js (how fast goals can be met), this says
 * how big a goal can be at all. A test holds every campaign mission's
 * population goal under it, and `npm run sim -- --capacity` prints the table.
 *
 * Why it matters: WORKFORCE_RATIO of the plebeian residents look for work, and
 * above UNEMPLOYMENT_GRACE unemployment the city's mood falls (up to 15 points,
 * sim/population.js), so peace stops growing (it needs PEACE_MOOD). A goal of
 * more people than the mission's buildings can employ cannot be met by a well
 * run city: mission 1 asked for 1,200 people when a sensible town of Huts
 * employs about 70 to 90, and stalled near 720 with 70% unemployment.
 *
 * The model is a yardstick, not a simulation. For a city of P people, all in
 * the best working homes the mission allows, it lists the buildings a sensible
 * player puts up (planCity) and counts their workers; the employment ceiling
 * is the largest P whose jobs keep unemployment at or below the grace. Every
 * assumption leans toward FEWER jobs (a real city builds more than this), so
 * a goal under the ceiling can be met:
 *
 *   homes      every home at the working level: the best level the unlocks
 *              allow whose residents work (patricians do not, so villas could
 *              only add people on top of the ceiling, never jobs-short ones)
 *   services   a roaming walker serves HOMES_PER_STREET_TILE home tiles for
 *              each tile of its `roam` (data/walkers.js), as if it never walked
 *              the same street twice: the fewest buildings that could cover
 *              the homes. Fountains and hospitals cover their radius, of which
 *              HOME_SHARE is homes. Upkeep (prefects, engineers) covers homes,
 *              plus one of each for the farms and one for any industry
 *   food       grown on full meadow at the fastest food farm's rate and the
 *              most productive difficulty, at least one farm per food kind the
 *              level eats; granaries hold GRANARY_MONTHS of food
 *   gods       every unlocked god gets temples for its share of the city
 *              (PEOPLE_PER_TEMPLE, sim/religion.js), at least one; the gods the
 *              level needs also send priests past every home
 *   shows      the cheapest set of venues (and the troupes and schools that
 *              keep them booked) that reaches the level's entertainment
 *   industry   only as far as there is a buyer: the homes' own use of the
 *              goods their level needs, plus each trade partner's yearly
 *              `buys` of what the city can make. Raw materials come from the
 *              city's own producers when the mission unlocks them (else they
 *              are bought, which employs nobody here). Warehouses hold
 *              WAREHOUSE_MONTHS of that flow; a dock when there is a sea partner
 *   army       a mission with raids: a barracks, one fort of each unlocked
 *              kind and two towers (their equipment is a one-off batch, so
 *              it adds no lasting workshop jobs)
 *   rule       buildings come whole: a third of a farm's harvest still takes
 *              a whole farm and its workers
 *
 * The land ceiling asks whether the map has room: homes and their streets on
 * LAND_FOR_HOMES of the buildable land, and food from farms on MEADOW_FARMED
 * of the meadow at the least productive difficulty.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { BUILDINGS, VENUE_POINTS, VENUE_BOTH_BONUS, VENUE_BOTH_SHOWS, VENUE_SEATS, VENUE_SUPPLIERS, ENT_BASE_MAX } from '../data/buildings.js';
import { HOUSE_TIERS } from '../data/housing.js';
import { FOOD_TYPES } from '../data/goods.js';
import { GOD_KEYS } from '../data/gods.js';
import { WALKER_TYPES } from '../data/walkers.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';
import { DIFFICULTY } from '../data/difficulty.js';
import { Terrain } from '../world/map.js';
import { SHOW_DAYS, REFILL_BELOW } from './entertainment.js';

/** Home tiles within SERVICE_RADIUS of one street tile: street, house, house means two rows each side. */
export const HOMES_PER_STREET_TILE = 4;
/** Share of a residential area that is homes (street, house, house: two rows in three). */
export const HOME_SHARE = 2 / 3;
/** Months of food a city's granaries hold. */
export const GRANARY_MONTHS = 2;
/** Months of goods (made, bought and sold) a city's warehouses hold. */
export const WAREHOUSE_MONTHS = 2;
/** Share of the buildable land a city gives its homes and their streets (the rest: farms, industry, services, awkward corners). */
export const LAND_FOR_HOMES = 0.5;
/** Share of the meadow a city can farm (fields come in patches a 3x3 farm does not fill). */
export const MEADOW_FARMED = 2 / 3;
/** Share of the employment ceiling a mission's population goal may ask for (see scenarios.js). */
export const GOAL_SHARE = 0.85;

const VENUE_KINDS = Object.keys(VENUE_POINTS);
const PER_MONTH = CONFIG.DAYS_PER_MONTH;
const PER_YEAR = CONFIG.DAYS_PER_MONTH * CONFIG.MONTHS_PER_YEAR;

// ---------------------------------------------------------------------------
// What a mission can build, make and buy
// ---------------------------------------------------------------------------

/** Building keys a mission unlocks (its tools, such as roads, left out). */
export function unlockedBuildings(s) {
  return new Set(s.unlocks === 'all' ? Object.keys(BUILDINGS) : s.unlocks.filter((k) => BUILDINGS[k]));
}

/** The unlocked building that makes `good` (the one with the fewest workers per unit), or null. */
function producerOf(keys, good) {
  let best = null;
  for (const k of keys) {
    const d = BUILDINGS[k];
    if (d.produces !== good) continue;
    if (!best || d.workers * d.productionDays < best.workers * best.productionDays) best = { key: k, ...d };
  }
  return best;
}

/**
 * Goods the city can make (an unlocked producer whose inputs it makes or
 * buys) and goods it can buy (a partner sells them).
 */
export function goodsAvailable(s) {
  const keys = unlockedBuildings(s);
  const bought = new Set();
  for (const id of s.partners) for (const g of Object.keys(TRADE_PARTNERS[id].sells)) bought.add(g);
  const made = new Set();
  // Raw goods first, then the workshops that use them (a workshop's input may be bought).
  for (let pass = 0; pass < 2; pass++) {
    for (const k of keys) {
      const d = BUILDINGS[k];
      if (!d.produces) continue;
      if (d.recipe && !Object.keys(d.recipe).every((r) => made.has(r) || bought.has(r))) continue;
      made.add(d.produces);
    }
  }
  return { made, bought, all: new Set([...made, ...bought]) };
}

/** A venue kind can put on shows: it is unlocked and some unlocked school trains a performer it takes. */
function venueKinds(keys) {
  return VENUE_KINDS.filter((v) => keys.has(v) && VENUE_SUPPLIERS[v].some((p) => trainerOf(keys, p)));
}

/** The unlocked training building for a kind of performer, or null. */
function trainerOf(keys, performer) {
  for (const k of keys) if (BUILDINGS[k].kind === 'training' && BUILDINGS[k].venue === performer) return k;
  return null;
}

/**
 * Entertainment a home gets from a set of venue kinds, all visiting it: their
 * points, the both-shows bonus where both performers can be trained, and the
 * seat base (sim/entertainment.js: the average seat coverage over EVERY venue
 * kind, over 5) at `seatShare` coverage of each kind in the set.
 */
function entertainmentOf(keys, set, seatShare = 1) {
  let score = Math.min(ENT_BASE_MAX, Math.floor((set.length * seatShare * 100) / VENUE_KINDS.length / 5));
  for (const v of set) {
    score += VENUE_POINTS[v];
    if (bothShows(keys, v)) score += VENUE_BOTH_BONUS[v] || 0;
  }
  return score;
}

/** Can venue kind `v` book both its kinds of show (VENUE_BOTH_SHOWS)? */
function bothShows(keys, v) {
  return !!VENUE_BOTH_SHOWS[v] && VENUE_BOTH_SHOWS[v].every((p) => trainerOf(keys, p));
}

/** The best entertainment score a home can get with the mission's venues. */
export function bestEntertainment(keys) {
  return entertainmentOf(keys, venueKinds(keys));
}

/** Gods the mission can worship (an unlocked temple). */
function godsOf(keys) {
  return GOD_KEYS.filter((g) => keys.has(`temple_${g}`));
}

/** Can a home at housing level `t` have everything it needs in this mission? */
function levelReachable(s, t, ctx) {
  const n = HOUSE_TIERS[t];
  const { keys, goods, gods, foods, water, edu, health, wine, ent } = ctx;
  return n.water <= water && n.food <= foods && n.religion <= gods && n.ent <= ent && n.edu <= edu
    && (!n.barber || keys.has('barber')) && (!n.baths || keys.has('baths')) && n.health <= health
    && n.goods.every((g) => goods.all.has(g)) && n.wine <= wine;
}

/** What a mission offers its homes, as counts (see data/housing.js for the needs). */
function offers(s) {
  const keys = unlockedBuildings(s);
  const goods = goodsAvailable(s);
  return {
    keys,
    goods,
    gods: godsOf(keys).length,
    foods: FOOD_TYPES.filter((f) => goods.all.has(f)).length,
    water: keys.has('fountain') ? 2 : keys.has('well') ? 1 : 0,
    edu: keys.has('school') && keys.has('library') ? (keys.has('academy') ? 3 : 2) : keys.has('school') || keys.has('library') ? 1 : 0,
    health: (keys.has('clinic') ? 1 : 0) + (keys.has('hospital') ? 1 : 0),
    // A working winery, and each partner selling wine (data/housing.js `wine`).
    wine: (keys.has('wine_ws') && goods.made.has('wine') ? 1 : 0) + s.partners.filter((id) => TRADE_PARTNERS[id].sells.wine).length,
    ent: bestEntertainment(keys),
  };
}

/**
 * The highest housing level the mission's buildings and partners allow, and
 * the highest whose residents work (the model's homes).
 */
export function topLevels(s) {
  const ctx = offers(s);
  let top = 0;
  let working = 0;
  for (let t = 1; t < HOUSE_TIERS.length; t++) {
    if (!levelReachable(s, t, ctx)) break;
    top = t;
    if (!HOUSE_TIERS[t].patrician) working = t;
  }
  return { top, working };
}

/** Residents per tile of a home at level `t` (a 2x2 home holds its `people` on four tiles). */
export function peoplePerTile(t) {
  const n = HOUSE_TIERS[t];
  return n.people / (n.size * n.size);
}

// ---------------------------------------------------------------------------
// The sensible city of P people
// ---------------------------------------------------------------------------

/** Home tiles one building of `key` serves with its roaming walker. */
function walkerReach(key) {
  const roam = WALKER_TYPES[BUILDINGS[key].walker]?.roam ?? CONFIG.DEFAULT_ROAM;
  return roam * HOMES_PER_STREET_TILE;
}

/** Home tiles inside a square of the given radius around a building. */
function radiusReach(radius) {
  return (2 * radius + 1) ** 2 * HOME_SHARE;
}

/** Units one building makes in a year at full staff. */
function yearlyOutput(def, production) {
  return (CONFIG.CART_CAPACITY * PER_YEAR * production) / def.productionDays;
}

/** The most productive difficulty's production (fewest farms and workshops: fewest jobs). */
export function topProduction() {
  return Math.max(...Object.values(DIFFICULTY).map((d) => d.production));
}

/** The least productive difficulty's production (most farmland). */
export function lowProduction() {
  return Math.min(...Object.values(DIFFICULTY).map((d) => d.production));
}

/**
 * The buildings a sensible city of `people` residents puts up, all in homes
 * of the mission's working level (see the header for every assumption).
 * @returns {{level:number, homeTiles:number, items:{key:string, count:number, why:string}[], jobs:number}}
 */
export function planCity(s, people, { production = topProduction() } = {}) {
  const ctx = offers(s);
  const { keys, goods } = ctx;
  const level = topLevels(s).working;
  const need = HOUSE_TIERS[level];
  const tiles = people / peoplePerTile(level);
  const items = [];
  const add = (key, count, why) => {
    if (!keys.has(key) || count <= 0) return;
    const have = items.find((it) => it.key === key);
    if (have) { have.count += count; have.why += `; ${why}`; } else items.push({ key, count, why });
  };
  const cover = (key, why) => add(key, Math.max(1, Math.ceil(tiles / walkerReach(key))), why);
  if (people <= 0) return { level, homeTiles: 0, items, jobs: 0 };

  // Upkeep, markets and taxes: walkers past every home (a Senate's tax
  // collectors count with the forums').
  cover('prefecture', 'fire watch');
  cover('engineer_post', 'repairs');
  cover('market', 'food and goods to the door');
  if (keys.has('senate')) add('senate', 1, 'culture and prosperity');
  const taxReach = walkerReach('forum');
  add('forum', Math.max(keys.has('senate') ? 0 : 1, Math.ceil(tiles / taxReach) - (keys.has('senate') ? 1 : 0)), 'taxes');

  // Water: wells employ nobody; fountains cover their radius.
  if (need.water >= 2) add('fountain', Math.ceil(tiles / radiusReach(CONFIG.FOUNTAIN_RADIUS)), 'fountain water');

  // Food: what the people eat, at least one farm for each kind the level eats.
  const farms = FOOD_TYPES.map((f) => producerOf(keys, f)).filter(Boolean);
  if (need.food > 0 && farms.length) {
    const fastest = farms.reduce((a, b) => (b.productionDays < a.productionDays ? b : a));
    const monthly = people * CONFIG.FOOD_PER_PERSON_MONTH;
    const perFarm = (CONFIG.CART_CAPACITY * PER_MONTH * production) / fastest.productionDays;
    add(fastest.key, Math.max(need.food, Math.ceil(monthly / perFarm)), 'food');
    add('granary', Math.max(1, Math.ceil((monthly * GRANARY_MONTHS) / CONFIG.GRANARY_CAPACITY)), 'food store');
    add('prefecture', 1, 'farms');
    add('engineer_post', 1, 'farms');
  }

  // Gods: every unlocked god's share of the city, and priests past every home
  // for the gods the level needs.
  const gods = godsOf(keys);
  gods.forEach((g, i) => {
    const share = Math.max(1, Math.ceil(people / GOD_KEYS.length / CONFIG.PEOPLE_PER_TEMPLE));
    const priests = i < need.religion ? Math.ceil(tiles / walkerReach(`temple_${g}`)) : 0;
    add(`temple_${g}`, Math.max(share, priests), `${g}`);
  });

  // Health, grooming and schooling: walkers past every home.
  if (need.barber) cover('barber', 'barber');
  if (need.baths) cover('baths', 'baths');
  if (need.health >= 1) cover('clinic', 'health care');
  if (need.health >= 2) add('hospital', Math.ceil(tiles / radiusReach(CONFIG.HOSPITAL_RADIUS)), 'hospital');
  if (need.edu >= 1) cover(keys.has('school') ? 'school' : 'library', 'schooling');
  if (need.edu >= 2) cover('library', 'library');
  if (need.edu >= 3) cover('academy', 'academy');

  // Shows: the cheapest set of venues that reaches the level's entertainment.
  if (need.ent > 0) for (const it of venuePlan(keys, need.ent, tiles, people)) add(it.key, it.count, it.why);

  // Industry and trade: the homes' own goods, and what partners buy.
  const flow = industryPlan(s, keys, goods, need, people, production);
  for (const it of flow.items) add(it.key, it.count, it.why);
  if (flow.units > 0) {
    add('warehouse', Math.max(1, Math.ceil((flow.units / CONFIG.MONTHS_PER_YEAR) * WAREHOUSE_MONTHS / CONFIG.WAREHOUSE_CAPACITY)), 'goods store');
    if (flow.made > 0) { add('prefecture', 1, 'industry'); add('engineer_post', 1, 'industry'); }
  }
  if (s.partners.some((id) => TRADE_PARTNERS[id].route === 'sea')) add('dock', 1, 'sea trade');

  // The army, when the province is raided.
  if (s.military) {
    add('barracks', 1, 'army');
    for (const k of ['fort_legion', 'fort_archer', 'fort_cavalry']) add(k, 1, 'army');
    add('tower', 2, 'army');
  }

  const jobs = items.reduce((n, it) => n + it.count * BUILDINGS[it.key].workers, 0);
  return { level, homeTiles: tiles, items, jobs };
}

/**
 * Venues, and the schools that train their performers, for an entertainment
 * score of `want`: of every set of venue kinds that can reach it, the one
 * with the fewest workers. Each kind's venues send entertainers past every
 * home; when the seat base is needed too, they seat that share of the city.
 * A trainer sends a performer every `spawnDays`; a venue wants one every
 * SHOW_DAYS - REFILL_BELOW days.
 */
function venuePlan(keys, want, tiles, people) {
  const kinds = venueKinds(keys);
  let best = null;
  for (let mask = 1; mask < 1 << kinds.length; mask++) {
    const set = kinds.filter((_, i) => mask & (1 << i));
    const visits = entertainmentOf(keys, set, 0);
    // Seat share needed for the base (0 when the visits are enough).
    let seatShare = 0;
    if (visits < want) {
      const base = want - visits;
      seatShare = (base * 5 * VENUE_KINDS.length) / (set.length * 100);
      if (seatShare > 1 || base > ENT_BASE_MAX) continue;
    }
    const items = [];
    const shows = {};
    for (const v of set) {
      const venues = Math.max(Math.ceil(tiles / walkerReach(v)), Math.ceil((seatShare * people) / VENUE_SEATS[v]));
      items.push({ key: v, count: venues, why: 'shows' });
      // The shows it books: both kinds when the bonus is counted, else its own (or the first it takes).
      const performers = bothShows(keys, v) ? VENUE_BOTH_SHOWS[v] : [VENUE_SUPPLIERS[v].find((p) => trainerOf(keys, p))];
      for (const p of performers) shows[p] = (shows[p] || 0) + venues;
    }
    for (const [p, venues] of Object.entries(shows)) {
      const key = trainerOf(keys, p);
      const perTrainer = (SHOW_DAYS - REFILL_BELOW) / BUILDINGS[key].spawnDays;
      items.push({ key, count: Math.ceil(venues / perTrainer), why: 'performers' });
    }
    const jobs = items.reduce((n, it) => n + it.count * BUILDINGS[it.key].workers, 0);
    if (!best || jobs < best.jobs) best = { jobs, items };
  }
  return best ? best.items : [];
}

/**
 * Producers for the homes' own goods and partners' purchases, with the raw
 * materials they use when the city makes those itself.
 * @returns {{items:object[], units:number, made:number}} units: yearly flow through warehouses
 */
function industryPlan(s, keys, goods, need, people, production) {
  const demand = {}; // units a year
  const want = (g, units) => { demand[g] = (demand[g] || 0) + units; };
  for (const g of need.goods) if (goods.made.has(g)) want(g, (people / CONFIG.GOODS_PER_HOUSE_PEOPLE) * CONFIG.MONTHS_PER_YEAR);
  let units = 0;
  for (const g of need.goods) units += (people / CONFIG.GOODS_PER_HOUSE_PEOPLE) * CONFIG.MONTHS_PER_YEAR; // made or bought, it passes a warehouse
  for (const id of s.partners) {
    for (const [g, n] of Object.entries(TRADE_PARTNERS[id].buys)) {
      if (!goods.made.has(g)) continue;
      want(g, n);
      units += n; // exports leave from a warehouse, food too
    }
  }
  // Workshops' raw materials, made at home when the mission has the producer.
  for (const g of Object.keys(demand)) {
    const def = producerOf(keys, g);
    if (!def || !def.recipe) continue;
    for (const [r, per] of Object.entries(def.recipe)) if (producerOf(keys, r)) want(r, (demand[g] * per) / CONFIG.CART_CAPACITY);
  }
  const items = [];
  let made = 0;
  for (const [g, n] of Object.entries(demand)) {
    const def = producerOf(keys, g);
    if (!def || n <= 0) continue;
    items.push({ key: def.key, count: Math.ceil(n / yearlyOutput(def, production)), why: `${g}` });
    made += n;
  }
  return { items, units, made };
}

/** Jobs in a sensible city of `people` residents (planCity's total). */
export function jobsFor(s, people, opts) {
  return planCity(s, people, opts).jobs;
}

/** Can a city of `people` residents keep unemployment at or below the grace? */
export function employsEnough(s, people, opts) {
  const workforce = people * CONFIG.WORKFORCE_RATIO;
  return jobsFor(s, people, opts) >= workforce * (1 - CONFIG.UNEMPLOYMENT_GRACE);
}

/**
 * The employment ceiling: the largest population (in steps of `step`) whose
 * jobs keep unemployment at or below CONFIG.UNEMPLOYMENT_GRACE. Jobs grow in
 * whole buildings, so a size just past the ceiling may fit again a little
 * later: the largest one that fits counts (a player builds the next farm
 * before it is needed).
 */
export function employmentCeiling(s, { step = 10, max = 200000, ...opts } = {}) {
  let best = 0;
  let misses = 0;
  for (let p = step; p <= max; p += step) {
    if (employsEnough(s, p, opts)) { best = p; misses = 0; } else if (++misses > 2000 / step + 200) break;
  }
  return best;
}

/** Buildable and meadow tiles of a generated map (world/map.js). */
export function landOf(map) {
  let buildable = 0;
  let meadow = 0;
  for (let i = 0; i < map.size; i++) {
    const t = map.terrain[i];
    if (t === Terrain.WATER || t === Terrain.ROCK) continue;
    buildable++;
    if (t === Terrain.MEADOW) meadow++;
  }
  return { buildable, meadow };
}

/**
 * The land ceiling: the people the map has room to house (LAND_FOR_HOMES of
 * its buildable land, HOME_SHARE of that homes) and to feed (farms on
 * MEADOW_FARMED of its meadow, at the least productive difficulty).
 * land: landOf(map).
 */
export function landCeiling(s, land, { production = lowProduction() } = {}) {
  const level = topLevels(s).working;
  const housed = land.buildable * LAND_FOR_HOMES * HOME_SHARE * peoplePerTile(level);
  const keys = unlockedBuildings(s);
  const farms = FOOD_TYPES.map((f) => producerOf(keys, f)).filter(Boolean);
  if (!farms.length) return Math.floor(housed);
  const slowest = farms.reduce((a, b) => (b.productionDays > a.productionDays ? b : a));
  const perFarm = (CONFIG.CART_CAPACITY * PER_MONTH * production) / slowest.productionDays;
  const fed = Math.floor((land.meadow * MEADOW_FARMED) / (slowest.size * slowest.size)) * perFarm / CONFIG.FOOD_PER_PERSON_MONTH;
  return Math.floor(Math.min(housed, fed));
}

/**
 * One mission's capacity, for the table and the tests. land: landOf(map), or
 * null to skip the land ceiling.
 */
export function missionCapacity(s, land = null) {
  const { top, working } = topLevels(s);
  const employment = employmentCeiling(s);
  const plan = planCity(s, employment);
  return {
    id: s.id,
    top,
    working,
    perTile: peoplePerTile(working),
    employment,
    jobsPer100: employment ? (plan.jobs / employment) * 100 : 0,
    land: land ? landCeiling(s, land) : null,
    plan,
  };
}

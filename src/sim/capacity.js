/**
 * capacity.js
 * ----------------------------------------------------------------------------
 * How many people a mission's buildings can employ: the yardstick for its
 * population goal. Beside sim/pace.js (how fast goals can be met), this says
 * how big a goal can be at all. A test holds the campaign's population goals
 * under it, and `npm run sim -- --capacity` prints the table.
 *
 * Why it matters: WORKFORCE_RATIO of the plebeian residents look for work, and
 * above UNEMPLOYMENT_MOOD_FREE unemployment the city's mood falls (up to 15
 * points, sim/population.js), so peace stops growing (it needs PEACE_MOOD). A
 * goal of more people than the mission's buildings can employ cannot be met by
 * a well run city: mission 1 asked for 1,200 people when a sensible town of
 * Huts has about 100 jobs, and stalled near 600 to 720 with half its workers
 * idle.
 *
 * The model is a yardstick, not a simulation. For a city of P people, in the
 * best working homes the mission allows and, where its homes can reach the
 * Villa, a villa quarter, it lists the buildings a player puts up (planCity)
 * and counts their workers; the employment ceiling is the largest P whose
 * jobs keep the plebeians' unemployment at or below UNEMPLOYMENT_MOOD_FREE.
 * Two profiles say how generously the player builds:
 *
 *   LEAN       a building for each trip's worth of homes: a walker covers 4
 *              home tiles for each tile of its roam, farms grow just what the
 *              city eats. Few buildings, though not a strict floor: a walker
 *              starts each trip in a new direction and serves on the way home,
 *              so over the months a visit lasts one building can reach more.
 *   SENSIBLE   a careful player's town: 2 home tiles per tile of roam (in a
 *              street, house, house grid each home lies beside a street, so a
 *              street tile has 2 homes of its own; a chosen figure, not a
 *              count: the demo city builds denser, about 1.2) and 3 farms more
 *              than the town needs (the demo city builds 4 where a mission 1
 *              town of 300 needs 1: fields only partly on meadow, a harvest
 *              Ceres may blight, granaries to fill). Checked by play, not
 *              derived: in mission 1, `npm run sim -- --scenario c1 --unlocks
 *              --homes 40` had 312 people, 95 to 100 jobs and 4% out of work
 *              (348 people on 44 plots: 14%), and the profile gives 300; in
 *              mission 2 the demo city's whole site (`--level 3`) held 450 to
 *              481 people at 4%, and the profile gives 450. The ceilings of
 *              big cities lean on the 2: at 1.2 the late missions' would be
 *              far higher. The campaign's goals are held to this profile.
 *
 * Both profiles share the rest:
 *
 *   homes      the working level: the best level the unlocks allow whose
 *              residents work. Where the homes can reach the Villa, a villa
 *              quarter too: PATRICIAN_SHARE of the people in Villas (the
 *              cheapest patrician home, so the fewest jobs per person). The
 *              villas' people need every service, food and five goods but add
 *              no workers, as patricians in the original; the late missions'
 *              prosperity goals all but require them (the rating counts
 *              patricians up to 15% of the city). The share was checked in
 *              play with the demo city's villa quarter (see PATRICIAN_SHARE)
 *   quarters   walkers serve every home they pass, villa or not: each walker
 *              service, fountain, hospital and show is planned over the tiles
 *              of every home whose level needs it, both quarters together (a
 *              Villa needs what an Insula does and a second god, whose priests
 *              are added for the villas' tiles). Play showed villas growing
 *              among the working homes, served by the same walkers, so the
 *              villa quarter brings no services of its own (planning them per
 *              quarter, with at least one of each, made the ceilings jump by
 *              a whole set of services even for a few villas). Food, granaries,
 *              industry, warehouses, exports, docks, the army, the Senate and
 *              the hippodrome are planned once for the whole city; the villas
 *              add their food and five goods, wine among them
 *   services   one building per stretch of homes its walker covers (above).
 *              Fountains and hospitals cover their radius, of which HOME_SHARE
 *              is homes. Upkeep (prefects, engineers) covers homes, plus one of
 *              each for the farms and one for any industry; gardeners' yards
 *              cover the homes that need gardens and statues (DECOR_DOWN)
 *   food       farms on full meadow at the most productive difficulty: homes
 *              eat their level's kinds of food in equal shares (sim/housing.js
 *              consumeHouse), so the fastest kinds are each grown on their own
 *              farms at their own rate, at least one farm a kind, plus the
 *              profile's spareFarms on the fastest; granaries hold
 *              GRANARY_MONTHS of food
 *   gods       every unlocked god gets temples for its share of the city
 *              (PEOPLE_PER_TEMPLE, sim/religion.js), at least one; the gods the
 *              level needs also send priests past every home
 *   shows      the cheapest set of venues (and the troupes and schools that
 *              keep them booked) that reaches the level's entertainment
 *   industry   only as far as there is a buyer: the homes' own use of the
 *              goods their level needs, plus each trade partner's yearly
 *              purchases of what the city can make, as in force when the
 *              mission's goals can first be met (its paceYears: a rise the
 *              mission schedules after that does not count; sim/tradeDemand.js).
 *              Raw materials come from the city's own producers when the
 *              mission unlocks them (else they are bought, which employs nobody
 *              here). Warehouses hold WAREHOUSE_MONTHS of that flow
 *   docks      enough Emporia for the sea partners' ships: each route's ships
 *              a year (more on a busy route) staying SHIP_STAY_DAYS
 *   hippodrome where it is unlocked with its chariot stable: one of each (a
 *              city has one), as a late city builds for its palaces' shows
 *   army       a mission with raids: a barracks, one fort of each unlocked
 *              kind and two towers (their equipment is a one-off batch, so
 *              it adds no lasting workshop jobs)
 *   rule       buildings come whole: a third of a farm's harvest still takes
 *              a whole farm and its workers
 *
 * The land ceiling asks whether the map has room: homes and their streets on
 * LAND_FOR_HOMES of the buildable land, and food from farms on MEADOW_FARMED
 * of the meadow at the least productive difficulty (Insane, whose fields rest
 * in winter).
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { BUILDINGS, VENUE_POINTS, VENUE_BOTH_BONUS, VENUE_BOTH_SHOWS, VENUE_SEATS, VENUE_SUPPLIERS, ENT_BASE_MAX, ENT_SEATS_MAX, ENT_SEAT_KINDS } from '../data/buildings.js';
import { HOUSE_TIERS } from '../data/housing.js';
import { FOOD_TYPES } from '../data/goods.js';
import { GOD_KEYS } from '../data/gods.js';
import { WALKER_TYPES } from '../data/walkers.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';
import { DIFFICULTY } from '../data/difficulty.js';
import { Terrain } from '../world/map.js';
import { SHOW_DAYS, REFILL_BELOW } from './entertainment.js';
import { buysInForce, routeVolume, visitsPerYear } from './tradeDemand.js';

/** Home tiles within SERVICE_RADIUS of one street tile: street, house, house means two rows each side. */
export const HOMES_PER_STREET_TILE = 4;
/** How generously a player builds (see the header): planCity's options. */
export const LEAN = Object.freeze({ homesPerStreetTile: HOMES_PER_STREET_TILE, spareFarms: 0 });
export const SENSIBLE = Object.freeze({ homesPerStreetTile: 2, spareFarms: 3 });
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
/**
 * Share of the people the model houses in villas where the homes can reach
 * the Villa: what play showed, not the most a city could have. The demo city
 * with wine for its markets (`npm run sim -- --level 3 --uptown --cloth
 * --wine`, one to six blocks, or with a villa block: --villas) kept 0 to 13%
 * of its people in villas on average over its last three years, 4% across
 * eleven runs (villas move up and down the ladder: at most 19% in a month);
 * docs/DEVELOPMENT.md has the runs. The prosperity rating rewards patricians
 * up to 15%, and the ceilings are very sensitive to the share (each point
 * of it is a point off the workforce of the whole city), so the careful
 * figure.
 */
export const PATRICIAN_SHARE = 0.05;
/** The villa quarter's homes: the cheapest patrician level (the Villa). */
export const VILLA_LEVEL = HOUSE_TIERS.findIndex((t) => t.patrician);
/**
 * The homes that keep gardens and statues among them: from the level whose
 * `down` desirability (data/housing.js) first asks for more than the bare
 * land gives (the Stone Cottage, 4: a well, a temple and trees no longer do),
 * so the gardeners' yards are planned over their tiles (planCity). A Hut
 * (down -4) or a Cottage (0) keeps its level on bare land, and a mission 1
 * town of Huts plans none.
 */
export const DECOR_DOWN = 4;
/** Days a merchant ship stays at an Emporium with storage about 10 road tiles away (docs/GAMEPLAY.md): the docks' count. */
export const SHIP_STAY_DAYS = 25;

// The three seat kinds. The hippodrome is left out of the shows' plan: one
// per city, it cannot be multiplied to reach every home, and the levels the
// model plans for need at most 30 entertainment (it is planned once a city
// where it is unlocked, for its jobs: planCity).
const VENUE_KINDS = Object.keys(VENUE_SEATS);
const PER_MONTH = CONFIG.DAYS_PER_MONTH;
const PER_YEAR = CONFIG.DAYS_PER_MONTH * CONFIG.MONTHS_PER_YEAR;

// ---------------------------------------------------------------------------
// What a mission can build, make and buy
// ---------------------------------------------------------------------------

/** Building keys a mission unlocks (its tools, such as roads, left out). */
export function unlockedBuildings(s) {
  return new Set(s.unlocks === 'all' ? Object.keys(BUILDINGS) : s.unlocks.filter((k) => BUILDINGS[k]));
}

/**
 * The unlocked building that makes `good` (the one with the fewest workers
 * per unit), or null. Food comes from farms only: fishing wharves depend on
 * the water and a shipyard, so the model leaves them out (fish is extra food
 * on water maps, never counted on).
 */
function producerOf(keys, good) {
  let best = null;
  for (const k of keys) {
    const d = BUILDINGS[k];
    if (d.produces !== good) continue;
    if (d.kind === 'wharf') continue;
    if (!best || d.workers * d.productionDays < best.workers * best.productionDays) best = { key: k, ...d };
  }
  return best;
}

/**
 * Goods the city can make (an unlocked producer whose inputs it makes or
 * buys) and goods it can buy (a partner sells them). `s.standIns` (not a
 * mission field): goods that reach the homes with no workshop and no partner,
 * as the demo city's uptown stocks its markets (simulate.mjs --blocks); they
 * count as bought, employing nobody.
 */
export function goodsAvailable(s) {
  const keys = unlockedBuildings(s);
  const bought = new Set(s.standIns || []);
  for (const id of s.partners) for (const g of Object.keys(TRADE_PARTNERS[id].sells)) bought.add(g);
  const made = new Set();
  // Raw goods first, then the workshops that use them (a workshop's input may
  // be bought), pass after pass until nothing new: a chain can be three long
  // (flax, then linen, then clothing).
  for (let size = -1; size !== made.size;) {
    size = made.size;
    for (const k of keys) {
      const d = BUILDINGS[k];
      if (!d.produces || d.kind === 'wharf') continue; // fish depends on the water: never counted on
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
  let score = Math.min(ENT_SEATS_MAX, Math.floor((set.length * seatShare * 100) / ENT_SEAT_KINDS / 5));
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
    // The hippodrome's points and seats count for which levels can be reached
    // at all; the shows' plan never counts on it (see VENUE_KINDS).
    ent: bestEntertainment(keys) + (keys.has('hippodrome') && keys.has('chariot_maker') ? VENUE_POINTS.hippodrome + ENT_BASE_MAX - ENT_SEATS_MAX : 0),
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
function walkerReach(key, perStreetTile = HOMES_PER_STREET_TILE) {
  const roam = WALKER_TYPES[BUILDINGS[key].walker]?.roam ?? CONFIG.DEFAULT_ROAM;
  return roam * perStreetTile;
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

/**
 * The least productive difficulty's yearly farm rate (most farmland): its
 * production, less the winter months (December to Februarius) its fields
 * rest or slow down (winterGrowth).
 */
export function lowProduction() {
  return Math.min(...Object.values(DIFFICULTY).map((d) => d.production * (1 - (3 / CONFIG.MONTHS_PER_YEAR) * (1 - (d.winterGrowth ?? 1)))));
}

/** The villa quarter's share for a mission and a plan's `villas` option: 0 where the homes cannot reach the Villa. */
export function villaShare(s, villas = PATRICIAN_SHARE) {
  return villas > 0 && topLevels(s).top >= VILLA_LEVEL ? villas : 0;
}

/**
 * The buildings a sensible city of `people` residents puts up (see the header
 * for every assumption): its working quarter at the mission's working level
 * and, where the Villa can be reached, a villa quarter of `villas` of the
 * people (false or 0: none, every home a working one).
 * @returns {{level:number, villaLevel:number, homeTiles:number, villaTiles:number, plebs:number, villas:number,
 *   items:{key:string, count:number, why:string}[], jobs:number}}
 */
export function planCity(s, people, { production = topProduction(), homesPerStreetTile = LEAN.homesPerStreetTile, spareFarms = LEAN.spareFarms, villas = PATRICIAN_SHARE } = {}) {
  const reach = (key) => walkerReach(key, homesPerStreetTile);
  const ctx = offers(s);
  const { keys, goods } = ctx;
  const level = topLevels(s).working;
  const share = villaShare(s, villas);
  const quarters = [{ level, people: people * (1 - share), why: '' }];
  if (share > 0) quarters.push({ level: VILLA_LEVEL, people: people * share, why: ' (villas)' });
  for (const q of quarters) {
    q.need = HOUSE_TIERS[q.level];
    q.tiles = q.people / peoplePerTile(q.level);
  }
  const [plebs, villa = { level: 0, people: 0, tiles: 0 }] = quarters;
  const items = [];
  const add = (key, count, why) => {
    if (!keys.has(key) || count <= 0) return;
    const have = items.find((it) => it.key === key);
    if (have) { have.count += count; have.why += `; ${why}`; } else items.push({ key, count, why });
  };
  // Walkers serve every home they pass, villa or not: a service is planned
  // over the tiles of every home whose level needs it, both quarters together.
  const tilesNeeding = (needs) => quarters.reduce((n, q) => n + (needs(q.need) ? q.tiles : 0), 0);
  const cover = (key, needs, why) => {
    const tiles = tilesNeeding(needs);
    if (tiles > 0) add(key, Math.max(1, Math.ceil(tiles / reach(key))), why);
  };
  const everyone = () => true;
  const result = (jobs) => ({ level, villaLevel: villa.level, homeTiles: plebs.tiles, villaTiles: villa.tiles, plebs: plebs.people, villas: villa.people, items, jobs });
  if (people <= 0) return result(0);

  // Upkeep, markets and taxes: walkers past every home (a Senate's tax
  // collectors count with the forums').
  cover('prefecture', everyone, 'fire watch');
  cover('engineer_post', everyone, 'repairs');
  // Gardeners where gardens and statues stand: among the homes that need
  // desirability just to keep their level (DECOR_DOWN), whose streets a
  // player lines with them. Like any walker service, a yard for each stretch
  // of those homes its gardener's round covers.
  cover('gardener_yard', (n) => n.down >= DECOR_DOWN, 'gardens and statues');
  cover('market', everyone, 'food and goods to the door');
  if (keys.has('senate')) add('senate', 1, 'culture and prosperity');
  const taxmen = Math.ceil(tilesNeeding(everyone) / reach('forum'));
  add('forum', Math.max(keys.has('senate') ? 0 : 1, taxmen - (keys.has('senate') ? 1 : 0)), 'taxes');

  // Water: wells employ nobody; fountains cover their radius.
  const piped = tilesNeeding((n) => n.water >= 2);
  if (piped > 0) add('fountain', Math.ceil(piped / radiusReach(CONFIG.FOUNTAIN_RADIUS)), 'fountain water');

  // Food for everyone: each kind the homes eat on its own farms, at its own rate.
  const farms = foodPlan(keys, quarters, people, production, spareFarms);
  for (const it of farms) add(it.key, it.count, it.why);
  if (farms.length) {
    add('granary', Math.max(1, Math.ceil((people * CONFIG.FOOD_PER_PERSON_MONTH * GRANARY_MONTHS) / CONFIG.GRANARY_CAPACITY)), 'food store');
    add('prefecture', 1, 'farms');
    add('engineer_post', 1, 'farms');
  }

  // Gods: every unlocked god's share of the whole city, and priests past every
  // home whose level needs that god (the villas' second god: their tiles only).
  godsOf(keys).forEach((g, i) => {
    const temples = Math.max(1, Math.ceil(people / GOD_KEYS.length / CONFIG.PEOPLE_PER_TEMPLE));
    const tiles = tilesNeeding((n) => i < n.religion);
    add(`temple_${g}`, Math.max(temples, tiles > 0 ? Math.ceil(tiles / reach(`temple_${g}`)) : 0), `${g}`);
  });

  // Health, grooming, schooling and shows: walkers past every home that needs them.
  cover('barber', (n) => n.barber, 'barber');
  cover('baths', (n) => n.baths, 'baths');
  cover('clinic', (n) => n.health >= 1, 'health care');
  const sick = tilesNeeding((n) => n.health >= 2);
  if (sick > 0) add('hospital', Math.ceil(sick / radiusReach(CONFIG.HOSPITAL_RADIUS)), 'hospital');
  cover(keys.has('school') ? 'school' : 'library', (n) => n.edu >= 1, 'schooling');
  cover('library', (n) => n.edu >= 2, 'library');
  cover('academy', (n) => n.edu >= 3, 'academy');
  const ent = Math.max(0, ...quarters.map((q) => q.need.ent));
  if (ent > 0) {
    const shows = quarters.filter((q) => q.need.ent > 0);
    const tiles = shows.reduce((n, q) => n + q.tiles, 0);
    const audience = shows.reduce((n, q) => n + q.people, 0);
    for (const it of venuePlan(keys, ent, tiles, audience, reach)) add(it.key, it.count, it.why);
  }
  // The hippodrome: one a city, with its chariot stable, where it is unlocked.
  if (keys.has('hippodrome') && keys.has('chariot_maker')) {
    add('hippodrome', 1, 'races');
    add('chariot_maker', 1, 'races');
  }

  // Industry and trade: each quarter's own goods, and what partners buy.
  const flow = industryPlan(s, keys, goods, quarters, production);
  for (const it of flow.items) add(it.key, it.count, it.why);
  if (flow.units > 0) {
    add('warehouse', Math.max(1, Math.ceil((flow.units / CONFIG.MONTHS_PER_YEAR) * WAREHOUSE_MONTHS / CONFIG.WAREHOUSE_CAPACITY)), 'goods store');
    if (flow.made > 0) { add('prefecture', 1, 'industry'); add('engineer_post', 1, 'industry'); }
  }
  add('dock', docksFor(s), 'sea trade');

  // The army, when the province is raided.
  if (s.military) {
    add('barracks', 1, 'army');
    for (const k of ['fort_legion', 'fort_archer', 'fort_cavalry']) add(k, 1, 'army');
    add('tower', 2, 'army');
  }

  return result(items.reduce((n, it) => n + it.count * BUILDINGS[it.key].workers, 0));
}

/**
 * Farms for a city's food. Homes eat as many kinds as their level needs, a
 * share of the ration from each (sim/housing.js consumeHouse), so the city
 * grows that many kinds, the fastest it can, each on its own farms at its own
 * rate (a vegetable farm fills a load in 22 days, wheat in 20): at least one
 * farm a kind, and the profile's spare farms on the fastest. A level that
 * eats more kinds than the mission can grow is fed from the farms it has.
 */
function foodPlan(keys, quarters, people, production, spareFarms) {
  const kinds = Math.max(0, ...quarters.map((q) => q.need.food));
  const farms = FOOD_TYPES.map((f) => producerOf(keys, f)).filter(Boolean).sort((a, b) => a.productionDays - b.productionDays);
  if (kinds <= 0 || !farms.length) return [];
  const grown = farms.slice(0, kinds);
  const monthly = (people * CONFIG.FOOD_PER_PERSON_MONTH) / grown.length;
  const out = grown.map((f) => ({ key: f.key, count: Math.max(1, Math.ceil(monthly / ((CONFIG.CART_CAPACITY * PER_MONTH * production) / f.productionDays))), why: 'food' }));
  out[0].count += spareFarms + (kinds - grown.length);
  return out;
}

/**
 * Emporia for a mission's sea partners: each route's ships a year (more on a
 * busy route, sim/tradeDemand.js) staying SHIP_STAY_DAYS, as many docks as
 * keep them all, at least one. None without a sea partner.
 */
export function docksFor(s, years = s.paceYears || 0) {
  let dockDays = 0;
  for (const id of s.partners) {
    const p = TRADE_PARTNERS[id];
    if (p.route !== 'sea') continue;
    dockDays += visitsPerYear('sea', routeVolume(demandAt(s, id, years), p.sells)) * SHIP_STAY_DAYS;
  }
  return dockDays > 0 ? Math.max(1, Math.ceil(dockDays / PER_YEAR)) : 0;
}

/**
 * What a partner buys a year in a mission `years` into it (sim/tradeDemand.js):
 * its table, the mission's `demand`, and the changes the mission schedules
 * before then (a rise after the goals can first be met does not count).
 */
export function demandAt(s, partnerId, years = s.paceYears || 0) {
  return buysInForce(s, s.map?.seed, partnerId, Math.ceil(years * CONFIG.MONTHS_PER_YEAR) - 1);
}

/**
 * Venues, and the schools that train their performers, for an entertainment
 * score of `want`: of every set of venue kinds that can reach it, the one
 * with the fewest workers. Each kind's venues send entertainers past every
 * home; when the seat base is needed too, they seat that share of the city.
 * A trainer sends a performer every `spawnDays`; a venue wants one every
 * SHOW_DAYS - REFILL_BELOW days.
 */
function venuePlan(keys, want, tiles, people, reach) {
  const kinds = venueKinds(keys);
  let best = null;
  for (let mask = 1; mask < 1 << kinds.length; mask++) {
    const set = kinds.filter((_, i) => mask & (1 << i));
    const visits = entertainmentOf(keys, set, 0);
    // Seat share needed for the base (0 when the visits are enough).
    let seatShare = 0;
    if (visits < want) {
      const base = want - visits;
      seatShare = (base * 5 * ENT_SEAT_KINDS) / (set.length * 100);
      if (seatShare > 1 || base > ENT_SEATS_MAX) continue;
    }
    const items = [];
    const shows = {};
    for (const v of set) {
      const venues = Math.max(Math.ceil(tiles / reach(v)), Math.ceil((seatShare * people) / VENUE_SEATS[v]));
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
 * Producers for each quarter's own goods (by its level) and partners'
 * purchases (the demand in force by the mission's planned pace: demandAt),
 * with the raw materials they use when the city makes those itself. The
 * quarters' goods are added up first, so a workshop is never rounded up twice.
 * @returns {{items:object[], units:number, made:number}} units: yearly flow through warehouses
 */
function industryPlan(s, keys, goods, quarters, production) {
  const demand = {}; // units a year
  const want = (g, units) => { demand[g] = (demand[g] || 0) + units; };
  let units = 0;
  for (const q of quarters) {
    const yearly = (q.people / CONFIG.GOODS_PER_HOUSE_PEOPLE) * CONFIG.MONTHS_PER_YEAR;
    for (const g of q.need.goods) {
      if (goods.made.has(g)) want(g, yearly);
      units += yearly; // made or bought, it passes a warehouse
    }
  }
  for (const id of s.partners) {
    for (const [g, n] of Object.entries(demandAt(s, id))) {
      if (!goods.made.has(g)) continue;
      want(g, n);
      units += n; // exports leave from a warehouse, food too
    }
  }
  // Workshops' raw materials, made at home when the mission has the producer,
  // down the chain: clothing's linen, and that linen's flax.
  const inputsOf = (g, units) => {
    const def = producerOf(keys, g);
    if (!def || !def.recipe) return;
    for (const [r, per] of Object.entries(def.recipe)) {
      if (!producerOf(keys, r)) continue;
      const n = (units * per) / CONFIG.CART_CAPACITY;
      want(r, n);
      inputsOf(r, n);
    }
  };
  for (const [g, n] of Object.entries({ ...demand })) inputsOf(g, n);
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

/**
 * Can a city of `people` residents keep unemployment at or below the grace?
 * Only the plebeians look for work: the villa quarter's people use services
 * and goods (jobs) but add no workers.
 */
export function employsEnough(s, people, opts) {
  const plan = planCity(s, people, opts);
  return plan.jobs >= plan.plebs * CONFIG.WORKFORCE_RATIO * (1 - CONFIG.UNEMPLOYMENT_MOOD_FREE);
}

/**
 * The employment ceiling: the largest population (in steps of `step`) whose
 * jobs keep unemployment at or below CONFIG.UNEMPLOYMENT_MOOD_FREE. Jobs grow in
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
 * its buildable land, HOME_SHARE of that homes: the working quarter and, as
 * planCity has one, the villa quarter, whose Villas hold half as many a tile)
 * and to feed (farms on MEADOW_FARMED of its meadow, at the least productive
 * difficulty). land: landOf(map).
 */
export function landCeiling(s, land, { production = lowProduction(), villas = PATRICIAN_SHARE } = {}) {
  const share = villaShare(s, villas);
  const tilesPerPerson = (1 - share) / peoplePerTile(topLevels(s).working) + (share > 0 ? share / peoplePerTile(VILLA_LEVEL) : 0);
  const housed = (land.buildable * LAND_FOR_HOMES * HOME_SHARE) / tilesPerPerson;
  const keys = unlockedBuildings(s);
  const farms = FOOD_TYPES.map((f) => producerOf(keys, f)).filter(Boolean);
  if (!farms.length) return Math.floor(housed);
  const slowest = farms.reduce((a, b) => (b.productionDays > a.productionDays ? b : a));
  const perFarm = (CONFIG.CART_CAPACITY * PER_MONTH * production) / slowest.productionDays;
  const fed = Math.floor((land.meadow * MEADOW_FARMED) / (slowest.size * slowest.size)) * perFarm / CONFIG.FOOD_PER_PERSON_MONTH;
  return Math.floor(Math.min(housed, fed));
}

/**
 * One mission's capacity, for the table and the tests: the employment ceiling
 * at both profiles (`lean`, `sensible`, with the jobs and the villa quarter's
 * people at that size), the sensible ceiling with every home a working one
 * (`allWorking`: no villa quarter) and, with land (landOf(map)), the land
 * ceiling.
 */
export function missionCapacity(s, land = null) {
  const { top, working } = topLevels(s);
  const at = (profile) => {
    const people = employmentCeiling(s, profile);
    const plan = planCity(s, people, profile);
    return { people, jobs: plan.jobs, villas: Math.round(plan.villas) };
  };
  return {
    id: s.id,
    top,
    working,
    perTile: peoplePerTile(working),
    lean: at(LEAN),
    sensible: at(SENSIBLE),
    allWorking: at({ ...SENSIBLE, villas: 0 }),
    land: land ? landCeiling(s, land) : null,
  };
}

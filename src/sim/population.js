/**
 * population.js
 * ----------------------------------------------------------------------------
 * Immigration, emigration, homeless citizens, city mood ("sentiment") and the
 * daily city statistics (population, tier counts, goods demand).
 *
 * Immigration: when there are empty beds in homes connected to the Imperial
 * road and the city mood is good enough, groups of settlers walk in from the
 * entry point. Rate scales with sentiment.
 *
 * Sentiment (0-100) is recalculated monthly from taxes, wages, unemployment,
 * food supply, housing quality, the gods' moods, festivals and Venus's
 * blessing or wrath. Below ~30 people stop coming, below 25 they start
 * leaving.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { GOD_KEYS } from '../data/gods.js';
import { FOOD_TYPES, HOUSE_GOODS } from '../data/goods.js';
import { HOUSE_TIERS, houseCapacity } from '../data/housing.js';
import { spawnWalker, killWalker } from './entities.js';
import { followPath, walkTo } from './movement.js';
import { romeWage } from './economy.js';
import { houseWantsGood, foodKindsWanted } from './market.js';
import { sendEmigrants } from './housing.js';
import { newHousehold } from './mood.js';

/** Daily: recompute population, workforce inputs and goods demand. */
export function computeCityStats(game) {
  const c = game.city;
  let pop = 0;
  let plebs = 0;
  let houses = 0;
  let fed = 0;
  let tierSum = 0;
  const tiers = new Array(HOUSE_TIERS.length).fill(0);
  const demand = {};
  for (const g of HOUSE_GOODS) demand[g] = 0;
  for (const b of game.buildings.values()) {
    const h = b.house;
    if (!h) continue;
    tiers[h.tier] += 1;
    if (h.pop <= 0) continue;
    houses++;
    pop += h.pop;
    tierSum += h.tier * h.pop;
    if (!HOUSE_TIERS[h.tier].patrician) plebs += h.pop;
    if (!h.hungry) fed += h.pop;
    for (const g of HOUSE_GOODS) if (houseWantsGood(h, g)) demand[g]++;
  }
  c.population = pop;
  c.plebs = plebs;
  c.patricians = pop - plebs;
  c.houses = houses;
  c.tierCounts = tiers;
  c.avgTier = pop > 0 ? tierSum / pop : 0;
  c.fedShare = pop > 0 ? fed / pop : 1;
  c.goodsDemand = demand;
  if (pop > c.stats.peakPopulation) c.stats.peakPopulation = pop;
}

/** Entry tile index and its road network id (0 = disconnected). */
function entryInfo(game) {
  const { map } = game;
  const idx = map.idx(map.entry.x, map.entry.y);
  return { idx, net: map.road[idx] ? map.roadNet[idx] : 0 };
}

/**
 * Settlers a day at a given city mood, in a new city (its first months) or
 * not, at a difficulty's immigration factor. Also the pace model's rate
 * (sim/pace.js).
 */
export function immigrationPerDay(mood, newCity = false, factor = 1) {
  if (mood < CONFIG.IMMIGRATION_MIN_MOOD) return 0;
  return CONFIG.IMMIGRATION_BASE_PER_DAY * ((mood - 20) / 80) * (newCity ? CONFIG.NEW_CITY_IMMIGRATION : 1) * factor;
}

/** Daily: settlers arrive at homes with free space. */
export function updateImmigration(game) {
  const c = game.city;
  const { map } = game;
  const entry = entryInfo(game);
  if (!entry.net) {
    if (!c.flags.entryWarned) {
      c.flags.entryWarned = true;
      game.message('The road to the map entrance is broken. No settlers can reach the city!', 'bad', map.entry.x, map.entry.y);
    }
    return;
  }
  c.flags.entryWarned = false;
  if (c.sentiment < CONFIG.IMMIGRATION_MIN_MOOD) return;

  const vacancies = [];
  for (const b of game.buildings.values()) {
    const h = b.house;
    if (!h || b.accessRoad < 0) continue;
    if (map.roadNet[b.accessRoad] !== entry.net) {
      b.noEntryRoute = true;
      continue;
    }
    b.noEntryRoute = false;
    if (h.sick > 0) continue; // a sick home takes in no settlers (sim/disease.js)
    const free = houseCapacity(h.tier, b.size) - h.pop - h.incoming;
    if (free > 0) vacancies.push({ b, free });
  }
  c.vacancies = vacancies.reduce((s, v) => s + v.free, 0);
  if (vacancies.length === 0) return;

  const perDay = immigrationPerDay(c.sentiment, game.time.totalMonths < CONFIG.NEW_CITY_BONUS_MONTHS, game.difficulty.immigration);
  c.immigrationAcc = Math.min(40, c.immigrationAcc + perDay);
  let guard = 0;
  while (c.immigrationAcc >= 1 && vacancies.length > 0 && guard++ < 12) {
    const k = game.rng.int(vacancies.length);
    const v = vacancies[k];
    const n = Math.max(1, Math.min(CONFIG.IMMIGRANT_GROUP_MAX, v.free, Math.floor(c.immigrationAcc)));
    const path = game.pf.roadPath(entry.idx, v.b.accessRoad);
    if (!path) {
      vacancies.splice(k, 1);
      continue;
    }
    const w = spawnWalker(game, 'immigrant', entry.idx, null, {
      people: n,
      target: v.b.id,
      state: 'toHouse',
      reserve: { id: v.b.id, people: n },
    });
    if (!w) break;
    v.b.house.incoming += n;
    followPath(game, w, path);
    // A long way to go (big maps): they come with a pack mule, faster than on foot.
    if (path.length > CONFIG.SETTLER_WALK_TILES) {
      w.speed = CONFIG.WALKER_SPEED * Math.min(CONFIG.SETTLER_MAX_SPEEDUP, path.length / CONFIG.SETTLER_WALK_TILES);
      w.mule = true;
    }
    c.immigrationAcc -= n;
    v.free -= n;
    if (v.free <= 0) vacancies.splice(k, 1);
  }
}

/**
 * Daily: unhappy citizens pack up and leave, from the humblest homes first.
 * Patricians (villas and palaces) never leave this way.
 */
export function updateEmigration(game) {
  const c = game.city;
  if (c.sentiment >= 25 || c.population < 20) return;
  const chance = (25 - c.sentiment) / 40;
  if (!game.rng.chance(chance)) return;
  let lowest = Infinity;
  let occupied = [];
  for (const b of game.buildings.values()) {
    const h = b.house;
    if (!h || h.pop <= 0 || HOUSE_TIERS[h.tier].patrician || h.tier > lowest) continue;
    if (h.tier < lowest) { lowest = h.tier; occupied = []; }
    occupied.push(b);
  }
  if (occupied.length === 0) return;
  const b = game.rng.pick(occupied);
  const n = Math.min(b.house.pop, game.rng.range(2, 6));
  b.house.pop -= n;
  sendEmigrants(game, b, n);
}

/** Settlers (or homeless) reached their new home. */
export function settlerArrive(game, w) {
  const b = game.buildings.get(w.target);
  if (b && b.house) {
    const h = b.house;
    // Release the reservation first, then move in whoever fits.
    if (w.reserve && w.reserve.id === b.id) {
      h.incoming = Math.max(0, h.incoming - w.reserve.people);
      w.reserve = null;
    }
    // Fell sick while they were on the way (sim/disease.js): they look elsewhere.
    const free = h.sick > 0 ? 0 : houseCapacity(h.tier, b.size) - h.pop;
    const n = Math.max(0, Math.min(free, w.people));
    if (h.pop <= 0 && n > 0) newHousehold(game, h); // an empty home: a fresh start (sim/mood.js)
    h.pop += n;
    if (h.tier === 0 && h.pop > 0) {
      h.tier = 1;
      game.markDirty('des');
      game.events.emit('houseChanged', b);
    }
    w.people -= n;
    if (n > 0 && w.type === 'immigrant') game.city.stats.immigrated += n;
  }
  if (w.people > 0) {
    // House vanished or filled up: look elsewhere.
    seekHome(game, w);
    return;
  }
  killWalker(game, w);
}

/**
 * Homeless / redirected settlers look for the nearest home with free space.
 * If none exists they give up and leave the city.
 */
export function seekHome(game, w) {
  const { map, pf, buildings } = game;
  const here = map.idx(w.x, w.y);
  let found = null;
  if (map.road[here]) {
    const target = pf.bfsRoad(here, (i) => {
      // A road tile qualifies if some house using it as access road has room.
      const id = homeAt(game, i, w.people);
      if (id) { found = id; return true; }
      return false;
    }, 120);
    if (target >= 0 && found) {
      const b = buildings.get(found);
      b.house.incoming += w.people;
      w.reserve = { id: b.id, people: w.people };
      w.target = b.id;
      w.state = 'toHouse';
      followPath(game, w, pf.buildPath(target));
      return;
    }
  }
  // Give up: head for the exit.
  w.type = 'emigrant';
  w.state = 'leaving';
  game.city.stats.emigrated += w.people;
  const exitIdx = map.idx(map.exit.x, map.exit.y);
  if (!walkTo(game, w, exitIdx)) killWalker(game, w);
}

/** A house whose access road is tile `i` and that can take `people`. */
function homeAt(game, i, people) {
  if (!game.homeByRoad) return 0;
  const list = game.homeByRoad.get(i);
  if (!list) return 0;
  for (const id of list) {
    const b = game.buildings.get(id);
    if (!b || b.house.sick > 0) continue; // no newcomers in a sick home
    const free = houseCapacity(b.house.tier, b.size) - b.house.pop - b.house.incoming;
    if (free >= Math.min(people, 1)) return id;
  }
  return 0;
}

/** Rebuild the road tile -> houses index used by seekHome (daily). */
export function indexHomesByRoad(game) {
  const idx = new Map();
  for (const b of game.buildings.values()) {
    if (!b.house || b.accessRoad < 0) continue;
    let list = idx.get(b.accessRoad);
    if (!list) { list = []; idx.set(b.accessRoad, list); }
    list.push(b.id);
  }
  game.homeByRoad = idx;
}

/**
 * Of the occupied homes whose people eat (or are about to: a Family Tent
 * stocks up for a Lean-to), those with food in the larder: the Overview's
 * "Homes with food". Not the mood's food factor (fedShare), which counts
 * homes not going hungry: tents forage and never go hungry, so a city of
 * tents read "100% with food" with none in any home. Tents are left out
 * altogether: no vendor gives them food, so counting them read "0%" in a
 * city whose every eating home was fed.
 */
export function homesWithFood(game) {
  let homes = 0;
  let withFood = 0;
  for (const b of game.buildings.values()) {
    const h = b.house;
    if (!h || h.pop <= 0 || foodKindsWanted(h) <= 0) continue;
    homes++;
    if (FOOD_TYPES.some((f) => h.food[f] > 0.01)) withFood++;
  }
  return { homes, withFood };
}

/** Monthly: recompute city sentiment (0-100). Returns the factor breakdown. */
export function computeSentiment(game) {
  const c = game.city;
  const f = {};
  f.base = 50;
  f.taxes = -(c.taxRate - CONFIG.DEFAULT_TAX_RATE) * (c.taxRate > CONFIG.DEFAULT_TAX_RATE ? 3 : 1.5);
  f.wages = (c.wage - romeWage(game)) * 0.8; // against what Rome pays now (sim/events.js moves it)
  const free = CONFIG.UNEMPLOYMENT_MOOD_FREE;
  f.unemployment = c.unemploymentRate > free ? -Math.min(15, (c.unemploymentRate - free) * 60) : 0;
  f.food = c.population > 60 ? -(1 - c.fedShare) * 18 : 0;
  // Family Tents (2) are neutral; a city averaging Apartment Houses (10) gets the full +10.
  f.housing = Math.min(10, Math.max(-4, (c.avgTier - 2) * 1.25));
  let moodSum = 0;
  for (const g of GOD_KEYS) moodSum += c.gods[g].mood;
  f.gods = Math.max(-8, Math.min(6, (moodSum / GOD_KEYS.length - 50) * 0.15));
  f.festival = c.festivalBoost;
  // Venus's blessing or wrath (sim/religion.js), decaying like the festival
  // boost; listed only while it is felt.
  if (c.venusBoost) f.venus = c.venusBoost;
  f.newCity = game.time.totalMonths < CONFIG.NEW_CITY_BONUS_MONTHS ? CONFIG.NEW_CITY_MOOD : 0;
  if (game.difficulty.mood) f.difficulty = game.difficulty.mood; // Insane: a hard-to-please populace
  let s = 0;
  for (const k in f) s += f[k];
  s = Math.max(0, Math.min(100, s));
  c.sentiment = Math.round(c.sentiment + (s - c.sentiment) * 0.5);
  c.sentimentFactors = f;
  c.festivalBoost *= 0.8;
  // Under half a point it rounds to nothing in the advisor: drop it there.
  c.venusBoost = Math.abs((c.venusBoost || 0) * CONFIG.VENUS_DECAY) < 0.5 ? 0 : c.venusBoost * CONFIG.VENUS_DECAY;
  return f;
}

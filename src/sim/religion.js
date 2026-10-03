/**
 * religion.js
 * ----------------------------------------------------------------------------
 * The gods' moods (0-100), updated monthly.
 *
 * Each god expects enough temples for its share of the population
 * (PEOPLE_PER_TEMPLE per temple; a large temple counts as two, as the
 * original counted 1,500 people of coverage to a small temple's 750). Homes
 * still count distinct gods, whatever the size of the temple whose priest
 * passed. Festivals and oracles lift every mood.
 * Very happy gods bless the city; angry gods punish it.
 *
 * Festivals cost money, food from the granaries and, large or grand, wine
 * from the warehouses, all or nothing, and are held at the god's temples,
 * whose priests a bigger feast needs more of: a staffed temple has one, a
 * large temple two; a small festival needs 1, a large one 3, a grand one 3
 * and an Oracle (Colonia's own rule; festivalTempleBlocked). A god whose last festival is more
 * than a year past is neglected: its mood target falls a point a month, 28
 * at most (the original's rule; not in towns under 800 people). A
 * city-wide cooldown (2, 4 or 8 months) still spaces them, short enough
 * for small festivals in turn to keep all five gods inside their year; one
 * held within 3 months of the last lifts the people's mood less, so the
 * turns do not lift the city mood above what festivals did before.
 *
 * Two levels of wrath (the original's minor and major curse): a god that
 * strikes is "angered" until its mood climbs back above GOD_CALM_MOOD. If it
 * strikes again before then, Mercury and Venus strike harder, except in a
 * mission whose scenario says majorWrath: false (the first two), where the
 * second wrath is like the first. Ceres, Neptune and Mars strike the same
 * way every time.
 *
 * The five gods (data/gods.js):
 *   Ceres    blessing: every farm ripens.  wrath: farm progress lost.
 *   Neptune  blessing: money.  wrath: buildings near water weakened, and
 *            every fishing boat sinks (the original's curse; the shipyards
 *            build new ones); where the city trades by sea, merchant ships
 *            under sail sink too and none sails for 80 days (sim/events.js).
 *   Mercury  blessing: the emptiest working granary gets MERCURY_BLESS_FOOD of
 *            each land food (no fish).  wrath: the fullest granary or warehouse loses
 *            MERCURY_WRATH_LOSS units; again before he calms, it burns.
 *   Mars     blessing: +10 peace.  wrath: -10 peace, treasury looted.
 *   Venus    blessing: every home's mood +VENUS_BLESS_HOME and a city mood
 *            factor that decays (city.venusBoost, sim/population.js).
 *            wrath: home moods capped and lowered, a negative factor; again
 *            before she calms, harder, and badly served homes gain disease
 *            risk where disease is active.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { GODS, GOD_KEYS } from '../data/gods.js';
import { FOOD_TYPES, LAND_FOODS } from '../data/goods.js';
import { transact } from './economy.js';
import { igniteBuilding, buildingLabel } from './risk.js';
import { farmDormant } from './production.js';
import { isStorage, storageUsed, storageRoom, storageAccepts, receiveGoods, takeGoods } from './storage.js';
import { liftAllMoods } from './mood.js';
import { diseaseActive, houseHealth } from './disease.js';
import { logGoods } from './goodsLedger.js';
import { sinkFishingBoats } from './fishing.js';
import { neptuneStorms } from './events.js';

/** Towns smaller than this do not bother the gods much (flat mood targets, no wrath, no neglect). */
export const SMALL_TOWN = 800;

/**
 * One god's fresh state. angered: it struck and has not calmed since (see
 * the header). monthsSinceFestival: month turns since its last festival
 * (0 in a new game, as in the original); festivalsHeld: festivals held for
 * it this game, so the advisor can tell "none yet" from "this month".
 */
export function newGodMood() {
  return { mood: CONFIG.GOD_MOOD_START, festival: 0, cooldown: 6, temples: 0, angered: false, monthsSinceFestival: 0, festivalsHeld: 0 };
}

/**
 * What a god's mood target loses after `months` without a festival: nothing
 * for FESTIVAL_FREE_MONTHS, then a point a month, FESTIVAL_NEGLECT_MAX at
 * most (the original's target fell from +12 to -28 over 40 months).
 */
export function festivalNeglect(months) {
  return Math.min(CONFIG.FESTIVAL_NEGLECT_MAX, Math.max(0, (months || 0) - CONFIG.FESTIVAL_FREE_MONTHS));
}

/**
 * Month turns since the city's last festival, for any god (Infinity when
 * none has been held this game, as in a new game or a save from before the
 * count).
 */
export function monthsSinceAnyFestival(game) {
  let months = Infinity;
  for (const g of GOD_KEYS) {
    const s = game.city.gods[g];
    if (s && s.festivalsHeld > 0) months = Math.min(months, s.monthsSinceFestival || 0);
  }
  return months;
}

/**
 * The neglect a god's mood target takes this month: none where its temple
 * is not unlocked (it stays neutral at 50) or in a town under SMALL_TOWN
 * people, whose gods have flat targets and never strike.
 */
export function neglectPenalty(game, god) {
  if (!game.isUnlocked(`temple_${god}`) || game.city.population < SMALL_TOWN) return 0;
  return festivalNeglect(game.city.gods[god].monthsSinceFestival);
}

export function newGodState() {
  const s = {};
  for (const g of GOD_KEYS) s[g] = newGodMood();
  return s;
}

export function updateReligion(game) {
  const c = game.city;
  const pop = c.population;
  const temples = {};
  let oracles = 0;
  for (const g of GOD_KEYS) temples[g] = 0;
  for (const b of game.buildings.values()) {
    // A large temple counts as two (data/buildings.js templeWeight).
    if (b.def.god && b.efficiency > 0) temples[b.def.god] += b.def.templeWeight || 1;
    if (b.type === 'oracle') oracles++;
  }
  const wanted = Math.max(1, pop / GOD_KEYS.length);
  for (const g of GOD_KEYS) {
    const s = c.gods[g];
    s.temples = temples[g];
    // Another month without a festival (the original counted at the turn of
    // the month too): a festival held mid-month is a whole year free.
    s.monthsSinceFestival = (s.monthsSinceFestival || 0) + 1;
    let target;
    if (!game.isUnlocked(`temple_${g}`)) target = 50; // cannot be worshipped here: stays neutral
    else if (pop < SMALL_TOWN) target = temples[g] > 0 ? 70 : 55; // small towns do not bother the gods much
    else if (temples[g] === 0) target = 5; // big cities that ignore a god anger it
    else target = 20 + 60 * Math.min(1, (temples[g] * CONFIG.PEOPLE_PER_TEMPLE) / wanted);
    target -= neglectPenalty(game, g); // a year without a festival in its honor
    // Blessings (mood 92+) need festivals or oracles on top of good temple coverage.
    target += Math.min(20, oracles * 6) + s.festival;
    target = Math.max(0, Math.min(100, target));
    const delta = Math.max(-4, Math.min(6, target - s.mood));
    s.mood = Math.max(0, Math.min(100, s.mood + delta));
    s.festival *= 0.85;
    if (s.mood > CONFIG.GOD_CALM_MOOD) s.angered = false;
    if (s.cooldown > 0) s.cooldown--;
    if (s.mood >= CONFIG.GOD_BLESS_MOOD && s.cooldown <= 0) {
      bless(game, g);
      s.cooldown = 14;
    } else if (s.mood <= CONFIG.GOD_WRATH_MOOD && s.cooldown <= 0 && pop >= SMALL_TOWN) {
      wrath(game, g, s);
      s.cooldown = 8;
      s.mood = Math.min(100, s.mood + 12);
    }
  }
}

/** "the Granary at 12,40" */
function placeLabel(b) {
  return `the ${buildingLabel(b)} at ${b.x},${b.y}`;
}

/** The lowest id of a list of buildings that tie. */
const byId = (a, b) => a.id - b.id;

// ---------------------------------------------------------------------------
// Mercury
// ---------------------------------------------------------------------------

/**
 * The granary Mercury fills: of the granaries that accept some food, the
 * working one (staffed) holding the least, the lowest id on a tie; with none
 * working, any of them. Null when no granary accepts food (or there is none).
 * (The original could pick an empty, unstaffed granary that no cart or
 * market uses; and a granary set to refuse every food is "emptiest" only
 * because it takes nothing, so the gift would be lost.)
 */
export function emptiestGranary(game) {
  const all = [...game.buildings.values()]
    .filter((b) => b.def.kind === 'granary' && LAND_FOODS.some((f) => storageAccepts(b, f)))
    .sort(byId);
  const working = all.filter((b) => b.efficiency > 0);
  let best = null;
  for (const b of working.length ? working : all) if (!best || storageUsed(b) < storageUsed(best)) best = b;
  return best;
}

/**
 * The storehouse Mercury punishes: the granary or warehouse holding the most
 * units, the lowest id on a tie. Null when nothing is stored anywhere.
 */
export function fullestStorehouse(game) {
  let best = null;
  for (const b of [...game.buildings.values()].filter(isStorage).sort(byId)) {
    if (storageUsed(b) > (best ? storageUsed(best) : 0)) best = b;
  }
  return best;
}

/**
 * Take `amount` units out of a storehouse: a granary's foods in their order
 * (wheat, vegetables, fruit, meat), a warehouse's largest stock first (the
 * original emptied its storage spaces in order; Colonia has no spaces).
 * @returns {number} units taken
 */
export function loseStock(b, amount) {
  let left = amount;
  if (b.def.kind === 'granary') {
    for (const f of FOOD_TYPES) if (left > 0) left -= takeGoods(b, f, left);
  } else {
    while (left > 0) {
      let good = null;
      for (const k in b.stock) if (b.stock[k] > 0 && (good === null || b.stock[k] > b.stock[good])) good = k;
      if (good === null) break;
      left -= takeGoods(b, good, left);
    }
  }
  return amount - left;
}

/** Mercury's blessing. @returns {{text:string, x?:number, y?:number}} */
function blessMercury(game) {
  const b = emptiestGranary(game);
  if (!b) return { text: 'He found no granary that would take food.' };
  let given = 0;
  // The four land foods, as the original's four food slots: the gift stays
  // 2,400 units, and never brings fish to a city that has no wharf.
  for (const f of LAND_FOODS) {
    // Through the granary's own door: its room and what it accepts. A food
    // it refuses would only be carted away again. Foods the city does not
    // grow are given all the same: Mercury brings them from afar.
    // Never into room held for a cart on its way home (a Get cart's load,
    // sim/storageOrders.js): filled by the gift, the granary threw the
    // returning load away.
    const n = receiveGoods(b, f, Math.min(CONFIG.MERCURY_BLESS_FOOD, storageRoom(b)));
    logGoods(game, f, 'imported', n);
    given += n;
  }
  if (given <= 0) return { text: `His merchants found ${placeLabel(b)} full.`, x: b.x, y: b.y };
  return { text: `His merchants bring ${given} units of food to ${placeLabel(b)}.`, x: b.x, y: b.y };
}

/** Mercury's wrath; `major`: again before he calmed. @returns {{text:string, x?:number, y?:number}} */
function wrathMercury(game, major) {
  const b = fullestStorehouse(game);
  if (!b) return { text: 'He found nothing stored to take.' };
  const where = placeLabel(b);
  if (major) {
    // The storehouse burns with everything in it; the fire spreads by the
    // normal rules and prefects come. igniteBuilding stays quiet: this
    // message names the building.
    igniteBuilding(game, b, 'wrath');
    return { text: `Angered again, he sets ${where} on fire, and everything in it is lost.`, x: b.x, y: b.y };
  }
  const lost = loseStock(b, CONFIG.MERCURY_WRATH_LOSS);
  return { text: `${lost} units of goods vanish from ${where}. Anger him again before he calms and it will burn.`, x: b.x, y: b.y };
}

// ---------------------------------------------------------------------------
// Venus
// ---------------------------------------------------------------------------

/** Every occupied home's mood capped at `cap`, then moved by `delta` (clamped 0-100). */
export function capHomeMoods(game, cap, delta) {
  for (const b of game.buildings.values()) {
    const h = b.house;
    if (!h || h.pop <= 0 || h.mood === null || h.mood === undefined) continue;
    h.mood = Math.max(0, Math.min(100, Math.min(h.mood, cap) + delta));
  }
}

/**
 * Venus angered again, where disease is active: every occupied home that is
 * not already sick gains VENUS_WRATH_DISEASE x (100 - health score) / 100
 * disease risk, x the difficulty's disease lever. The daily roll does the
 * rest (sim/disease.js); a passing physician clears it.
 * @returns {number} homes that reached the outbreak threshold
 */
export function venusSickness(game) {
  if (!diseaseActive(game)) return 0;
  const lever = game.difficulty.disease ?? 1;
  let atRisk = 0;
  for (const b of game.buildings.values()) {
    const h = b.house;
    if (!h || h.pop <= 0 || h.sick > 0) continue;
    h.diseaseRisk = (h.diseaseRisk || 0) + (CONFIG.VENUS_WRATH_DISEASE * (100 - houseHealth(game, b)) / 100) * lever;
    if (h.diseaseRisk >= CONFIG.DISEASE_THRESHOLD) atRisk++;
  }
  return atRisk;
}

function blessVenus(game) {
  liftAllMoods(game, CONFIG.VENUS_BLESS_HOME);
  game.city.venusBoost = (game.city.venusBoost || 0) + CONFIG.VENUS_BLESS_CITY;
  return null; // the god's own blessing text says it
}

function wrathVenus(game, major) {
  const k = major ? 1 : 0;
  capHomeMoods(game, CONFIG.VENUS_WRATH_CAP[k], CONFIG.VENUS_WRATH_HOME[k]);
  game.city.venusBoost = (game.city.venusBoost || 0) + CONFIG.VENUS_WRATH_CITY[k];
  if (!major) return { text: 'Homes sour and the city\'s mood falls. Anger her again before she calms and it will be worse.' };
  const sick = venusSickness(game);
  return { text: `Angered again, she turns every home bitter${sick > 0 ? `, and sickness creeps into ${sick} poorly cared for home${sick > 1 ? 's' : ''}: physicians are needed` : ''}.` };
}

// ---------------------------------------------------------------------------
// Blessings and wraths
// ---------------------------------------------------------------------------

function bless(game, god) {
  const c = game.city;
  const name = GODS[god].name;
  let note = null;
  switch (god) {
    case 'ceres':
      // Nearly ripe: harvested on the farm's next working day. A field resting
      // for an Insane winter grows nothing that day, so it gets the full 100.
      for (const b of game.buildings.values()) if (b.def.kind === 'farm') b.progress = farmDormant(game, b) ? Math.max(b.progress, 100) : 99.9;
      break;
    case 'neptune': {
      const bonus = Math.round(200 + c.population * 0.2);
      transact(game, 'other', bonus);
      break;
    }
    case 'mercury':
      note = blessMercury(game);
      break;
    case 'mars':
      c.ratings.peace = Math.min(100, c.ratings.peace + 10);
      break;
    case 'venus':
      note = blessVenus(game);
      break;
    default:
      break;
  }
  game.message(`${name} is pleased! ${note ? note.text : GODS[god].blessing}`, 'good', note?.x, note?.y);
  game.events.emit('sound', { name: 'blessing' });
}

/** A god strikes. `s` is its state: an angered god strikes harder (see the header). */
function wrath(game, god, s) {
  const c = game.city;
  const name = GODS[god].name;
  const all = [...game.buildings.values()];
  const major = !!s.angered && !!GODS[god].harderWrath && game.scenario.majorWrath !== false;
  s.angered = true;
  let note = null;
  switch (god) {
    case 'ceres':
      for (const b of all) if (b.def.kind === 'farm') b.progress = 0;
      break;
    case 'neptune': {
      // Not buildings that can never collapse (a reservoir on the shore):
      // they would only show risk that can never act. Homes always take it,
      // as a Tent may move up to a level that can collapse.
      for (const b of all) if ((b.house || b.def.damage > 0) && game.map.isNearTerrain(b.x, b.y, b.size, 4, 3)) b.damageRisk += 60;
      const sunk = sinkFishingBoats(game);
      // And trade by sea (the original's rule): ships under sail sink and
      // none sails for 5 months, where the city trades by sea (sim/events.js).
      const sea = neptuneStorms(game);
      const parts = [];
      if (sunk > 0) parts.push(`His storms sink ${sunk === 1 ? 'a fishing boat' : `all ${sunk} fishing boats`}: the shipyards must build new ones.`);
      if (sea.halted) parts.push(`${sea.sunk > 0 ? `${sea.sunk === 1 ? 'A merchant ship goes' : `${sea.sunk} merchant ships go`} down with ${sea.sunk === 1 ? 'its' : 'their'} cargo, and n` : 'N'}o ship will sail for your city for 5 months.`);
      if (parts.length) note = { text: `${GODS[god].wrath} ${parts.join(' ')}` };
      break;
    }
    case 'mercury':
      note = wrathMercury(game, major);
      break;
    case 'mars': {
      c.ratings.peace = Math.max(0, c.ratings.peace - 10);
      const loot = Math.min(Math.max(0, c.treasury), Math.round(100 + c.population * 0.1));
      if (loot > 0) transact(game, 'other', -loot);
      break;
    }
    case 'venus':
      note = wrathVenus(game, major);
      break;
    default:
      break;
  }
  game.message(`${name} is angry! ${note ? note.text : GODS[god].wrath}`, 'bad', note?.x, note?.y);
  game.events.emit('sound', { name: 'wrath' });
}

// ---------------------------------------------------------------------------
// Festivals
// ---------------------------------------------------------------------------

/** Festival sizes by index (0 small, 1 large, 2 grand). */
export const FESTIVAL_SIZES = Object.freeze(['small', 'large', 'grand']);

/** Festival cost for the current population. size: 0 small, 1 large, 2 grand */
export function festivalCost(game, size) {
  const base = [60, 150, 400][size];
  return Math.round(base + game.city.population * [0.15, 0.4, 1][size]);
}

/**
 * Units of food a festival takes from the granaries: FESTIVAL_FOOD_SHARE of
 * a month of the city's food, a load (CART_CAPACITY) at least.
 */
export function festivalFood(game, size) {
  const month = game.city.population * CONFIG.FOOD_PER_PERSON_MONTH;
  return Math.max(CONFIG.CART_CAPACITY, Math.ceil(month * CONFIG.FESTIVAL_FOOD_SHARE[size]));
}

/**
 * Units of wine a festival takes from the warehouses: a grand one the
 * original's population / FESTIVAL_WINE_PEOPLE + 1 loads, a large one half
 * of that rounded up, a small one none.
 */
export function festivalWine(game, size) {
  if (size === 0) return 0;
  const grand = Math.floor(game.city.population / CONFIG.FESTIVAL_WINE_PEOPLE) + 1;
  return (size === 2 ? grand : Math.ceil(grand / 2)) * CONFIG.CART_CAPACITY;
}

/** Everything a festival of this size costs now: { money (Dn), food, wine (units) }. */
export function festivalNeeds(game, size) {
  return { money: festivalCost(game, size), food: festivalFood(game, size), wine: festivalWine(game, size) };
}

/**
 * What the city has toward a festival: its treasury, the food in its
 * granaries and the wine in its warehouses (staffed or not: nobody needs to
 * carry it, as for the Emperor's requests). Food a market already bought is
 * the people's, and food in a warehouse is not counted: a festival is fed
 * from the granaries.
 */
export function festivalMeans(game) {
  let food = 0;
  let wine = 0;
  for (const b of game.buildings.values()) {
    if (b.def.kind === 'granary') for (const f of FOOD_TYPES) food += b.stock[f] || 0;
    else if (b.def.kind === 'warehouse') wine += b.stock.wine || 0;
  }
  return { money: game.city.treasury, food, wine };
}

/**
 * Priests a festival of each size needs among the god's temples at work
 * (FESTIVAL_SIZES order): a bigger feast needs more priests to lead its
 * rites. A temple has one, a large temple two (data/buildings.js
 * templeWeight, as it counts for the god's mood), so a small festival needs
 * any temple of the god, a large one a temple and a large temple (or two
 * large, or three small), and a grand one the same and an Oracle.
 */
export const FESTIVAL_PRIESTS = Object.freeze([1, 3, 3]);

/**
 * The priests a god's festivals can draw on: its temples at work (staffed,
 * efficiency > 0, as they count for its mood: an empty temple has no
 * priests to lead the rites), the priests its idle temples would bring, and
 * the Oracles (any: one speaks for every god; it has no workers, so it
 * counts once it stands, as it does for the moods).
 */
export function festivalTemples(game, god) {
  const t = { priests: 0, idle: 0, oracles: 0 };
  for (const b of game.buildings.values()) {
    if (b.type === 'oracle') t.oracles++;
    if (b.def.god !== god) continue;
    t[b.efficiency > 0 ? 'priests' : 'idle'] += b.def.templeWeight || 1;
  }
  return t;
}

/**
 * Why the temples stop a festival of this size for `god`, or null when they
 * do not (Colonia's own rule, after the original's festivals held at a
 * god's temple): the god's temples at work must hold FESTIVAL_PRIESTS[size]
 * priests, and a grand festival needs an Oracle as well. A province without
 * the god's temples, or without oracles for a grand one, says so first, as
 * building the rest would not help; else what is missing ("Needs a temple
 * of Mars.", "Needs temples of Mars with 3 priests (a temple has 1, a large
 * temple 2): 2 at work.", "Needs an Oracle.").
 */
export function festivalTempleBlocked(game, god, size) {
  const name = GODS[god].name;
  if (!game.isUnlocked(`temple_${god}`)) return `Temples of ${name} are not available in this province.`;
  if (size >= 2 && !game.isUnlocked('oracle')) return 'Oracles are not available in this province.';
  const t = festivalTemples(game, god);
  const need = FESTIVAL_PRIESTS[size];
  const parts = [];
  if (t.priests < need) {
    if (need === 1) parts.push(`${t.idle ? 'a staffed temple' : 'a temple'} of ${name}`);
    else {
      const idle = t.idle ? `, ${t.idle} more in temples without workers` : '';
      parts.push(`temples of ${name} with ${need} priests (a temple has 1, a large temple 2): ${t.priests} at work${idle}`);
    }
  }
  if (size >= 2 && !t.oracles) parts.push('an Oracle');
  return parts.length ? `Needs ${parts.join(parts.length > 1 && need > 1 ? '; and ' : ' and ')}.` : null;
}

/**
 * Why a festival of this size cannot be held now, or null when it can: the
 * cooldown, else what the god's temples lack (with `god`; without it, only
 * what every god's festival needs) and every part of its cost the city is
 * short of ("Needs 200 wine in the warehouses, 100 stored.").
 */
export function festivalBlocked(game, size, god = null) {
  const c = game.city;
  if (c.festivalCooldown > 0) return `Citizens are still recovering from the last festival (${c.festivalCooldown} month${c.festivalCooldown === 1 ? '' : 's'}).`;
  const need = festivalNeeds(game, size);
  const have = festivalMeans(game);
  const short = [];
  const temples = god ? festivalTempleBlocked(game, god, size) : null;
  if (temples) short.push(temples);
  if (need.money > have.money && !game.cheats.freeBuild) short.push(`Needs ${need.money} Dn, ${Math.floor(have.money)} in the treasury.`);
  if (need.food > have.food) short.push(`Needs ${need.food} food in the granaries, ${Math.floor(have.food)} stored.`);
  if (need.wine > have.wine) short.push(`Needs ${need.wine} wine in the warehouses, ${Math.floor(have.wine)} stored.`);
  return short.length ? short.join(' ') : null;
}

/**
 * How much of each stock to take so that `amount` comes from the largest
 * first and they end as level as can be: the largest is drawn down to the
 * next, then both to the third, and so on. `stocks` is [{ key, n }] in a
 * fixed order, which breaks ties. Whole units when the stocks and the
 * amount are whole (the first in order give the odd unit); a market buyer
 * may have left a fraction, and then the shares are exact.
 * @returns {Map<string, number>} key -> units to take (only keys that give)
 */
export function levelTakes(stocks, amount) {
  const rest = stocks.map((s) => ({ key: s.key, left: s.n || 0, take: 0 }));
  let need = amount;
  while (need > 1e-9) {
    const live = rest.filter((s) => s.left > 1e-9);
    if (!live.length) break;
    const top = Math.max(...live.map((s) => s.left));
    const group = live.filter((s) => s.left >= top - 1e-9);
    const next = Math.max(0, ...live.filter((s) => s.left < top - 1e-9).map((s) => s.left));
    const step = top - next;
    if (need >= step * group.length) {
      for (const s of group) { s.take += s.left - next; s.left = next; }
      need -= step * group.length;
      continue;
    }
    // The last step: the group shares what is left, level with each other.
    const whole = Number.isInteger(need) && group.every((s) => Number.isInteger(s.left));
    const per = whole ? Math.floor(need / group.length) : need / group.length;
    let odd = whole ? need - per * group.length : 0;
    for (const s of group) {
      const n = per + (odd > 0 ? 1 : 0);
      if (odd > 0) odd--;
      s.take += n;
      s.left -= n;
    }
    need = 0;
  }
  return new Map(rest.filter((s) => s.take > 0).map((s) => [s.key, s.take]));
}

/**
 * Take `amount` of a good from the storehouses of a kind ('granary' or
 * 'warehouse'): the one holding the most of it first, the lowest id on a
 * tie, each as far as it goes; but a store set to Get that good last, as
 * the Emperor's requests do (storage.js takeFromCity): the player wants it
 * kept there. Logged as used in the goods book.
 * @returns {number} units taken
 */
function takeFromStores(game, kind, good, amount) {
  const getting = (b) => (b.orders?.[good] === 'get' ? 1 : 0);
  const stores = [...game.buildings.values()]
    .filter((b) => b.def.kind === kind && (b.stock[good] || 0) > 0)
    .sort((a, b) => getting(a) - getting(b) || b.stock[good] - a.stock[good] || a.id - b.id);
  let left = amount;
  for (const b of stores) if (left > 1e-9) left -= takeGoods(b, good, left);
  const taken = amount - left;
  logGoods(game, good, 'used', taken);
  return taken;
}

/**
 * Take a festival's goods: its food spread over the foods the granaries
 * hold (the largest stocks first, levelled; ties in FOOD_TYPES order), and
 * its wine from the warehouses. The caller has checked that it is all there
 * (festivalBlocked), so nothing is taken from a city that cannot pay in full.
 */
export function spendFestivalGoods(game, need) {
  const stocks = FOOD_TYPES.map((f) => {
    let n = 0;
    for (const b of game.buildings.values()) if (b.def.kind === 'granary') n += b.stock[f] || 0;
    return { key: f, n };
  });
  for (const [f, n] of levelTakes(stocks, need.food)) takeFromStores(game, 'granary', f, n);
  if (need.wine > 0) takeFromStores(game, 'warehouse', 'wine', need.wine);
}

/**
 * Hold a festival for a god, at the temples its size needs
 * (festivalTempleBlocked) and paid in full (money, food and, for a large or
 * grand one, wine) or not at all. Whatever its size, the god's months since
 * its last festival go back to 0 (the original's rule).
 * @returns {{ok:boolean, reason?:string}}
 */
export function holdFestival(game, god, size) {
  const c = game.city;
  if (!GODS[god]) return { ok: false, reason: 'Unknown god' };
  if (!FESTIVAL_SIZES[size]) return { ok: false, reason: 'Unknown festival size' };
  const why = festivalBlocked(game, size, god);
  if (why) return { ok: false, reason: why };
  const need = festivalNeeds(game, size);
  transact(game, 'festivals', -need.money);
  spendFestivalGoods(game, need);
  const s = c.gods[god];
  // (Read before this god's count is reset.)
  const cityShare = Math.min(1, monthsSinceAnyFestival(game) / CONFIG.FESTIVAL_CITY_FULL_MONTHS);
  s.festival += [15, 30, 50][size];
  s.mood = Math.min(100, s.mood + [5, 10, 18][size]);
  s.monthsSinceFestival = 0;
  s.festivalsHeld = (s.festivalsHeld || 0) + 1;
  c.festivalBoost += [4, 8, 14][size] * cityShare;
  c.festivalCooldown = CONFIG.FESTIVAL_COOLDOWN[size];
  const goods = need.wine > 0 ? `${need.food} food and ${need.wine} wine` : `${need.food} food`;
  game.message(`A ${FESTIVAL_SIZES[size]} festival is held in honor of ${GODS[god].name}: the people feast on ${goods} from the city's stores.`, 'good');
  game.events.emit('sound', { name: 'festival' });
  return { ok: true };
}

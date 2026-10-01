/**
 * religion.js
 * ----------------------------------------------------------------------------
 * The gods' moods (0-100), updated monthly.
 *
 * Each god expects enough temples for its share of the population
 * (PEOPLE_PER_TEMPLE per temple). Festivals and oracles lift every mood.
 * Very happy gods bless the city; angry gods punish it.
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
 *            build new ones).
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

/** One god's fresh state. angered: it struck and has not calmed since (see the header). */
export function newGodMood() {
  return { mood: CONFIG.GOD_MOOD_START, festival: 0, cooldown: 6, temples: 0, angered: false };
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
    if (b.def.god && b.efficiency > 0) temples[b.def.god]++;
    if (b.type === 'oracle') oracles++;
  }
  const wanted = Math.max(1, pop / GOD_KEYS.length);
  for (const g of GOD_KEYS) {
    const s = c.gods[g];
    s.temples = temples[g];
    let target;
    if (!game.isUnlocked(`temple_${g}`)) target = 50; // cannot be worshipped here: stays neutral
    else if (pop < 800) target = temples[g] > 0 ? 70 : 55; // small towns do not bother the gods much
    else if (temples[g] === 0) target = 5; // big cities that ignore a god anger it
    else target = 20 + 60 * Math.min(1, (temples[g] * CONFIG.PEOPLE_PER_TEMPLE) / wanted);
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
    } else if (s.mood <= CONFIG.GOD_WRATH_MOOD && s.cooldown <= 0 && pop >= 800) {
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
      if (sunk > 0) note = { text: `${GODS[god].wrath} His storms sink ${sunk === 1 ? 'a fishing boat' : `all ${sunk} fishing boats`}: the shipyards must build new ones.` };
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

/** Festival cost for the current population. size: 0 small, 1 large, 2 grand */
export function festivalCost(game, size) {
  const base = [60, 150, 400][size];
  return Math.round(base + game.city.population * [0.15, 0.4, 1][size]);
}

/**
 * Hold a festival for a god.
 * @returns {{ok:boolean, reason?:string}}
 */
export function holdFestival(game, god, size) {
  const c = game.city;
  if (!GODS[god]) return { ok: false, reason: 'Unknown god' };
  if (c.festivalCooldown > 0) return { ok: false, reason: `Citizens are still recovering from the last festival (${c.festivalCooldown} months).` };
  const cost = festivalCost(game, size);
  if (c.treasury < cost && !game.cheats.freeBuild) return { ok: false, reason: 'Not enough money.' };
  transact(game, 'festivals', -cost);
  c.gods[god].festival += [15, 30, 50][size];
  c.gods[god].mood = Math.min(100, c.gods[god].mood + [5, 10, 18][size]);
  c.festivalBoost += [4, 8, 14][size];
  c.festivalCooldown = [3, 5, 8][size];
  game.message(`A ${['small', 'large', 'grand'][size]} festival is held in honor of ${GODS[god].name}.`, 'good');
  game.events.emit('sound', { name: 'festival' });
  return { ok: true };
}

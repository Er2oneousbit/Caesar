/**
 * religion.js
 * ----------------------------------------------------------------------------
 * The gods' moods (0-100), updated monthly.
 *
 * Each god expects enough temples for its share of the population
 * (PEOPLE_PER_TEMPLE per temple). Festivals and oracles lift every mood.
 * Very happy gods bless the city; angry gods punish it.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { GODS, GOD_KEYS } from '../data/gods.js';
import { transact } from './economy.js';
import { igniteBuilding } from './risk.js';
import { farmDormant } from './production.js';

export function newGodState() {
  const s = {};
  for (const g of GOD_KEYS) s[g] = { mood: CONFIG.GOD_MOOD_START, festival: 0, cooldown: 6, temples: 0 };
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
    if (s.cooldown > 0) s.cooldown--;
    if (s.mood >= CONFIG.GOD_BLESS_MOOD && s.cooldown <= 0) {
      bless(game, g);
      s.cooldown = 14;
    } else if (s.mood <= CONFIG.GOD_WRATH_MOOD && s.cooldown <= 0 && pop >= 800) {
      wrath(game, g);
      s.cooldown = 8;
      s.mood = Math.min(100, s.mood + 12);
    }
  }
}

function bless(game, god) {
  const c = game.city;
  const name = GODS[god].name;
  switch (god) {
    case 'jupiter':
      c.ratings.favor = Math.min(100, c.ratings.favor + 10);
      break;
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
    case 'mars':
      c.ratings.peace = Math.min(100, c.ratings.peace + 10);
      break;
    case 'vesta':
      for (const b of game.buildings.values()) b.fireRisk = 0;
      break;
    default:
      break;
  }
  game.message(`${name} is pleased! ${GODS[god].blessing}`, 'good');
  game.events.emit('sound', { name: 'blessing' });
}

function wrath(game, god) {
  const c = game.city;
  const { rng } = game;
  const name = GODS[god].name;
  const all = [...game.buildings.values()];
  switch (god) {
    case 'jupiter': {
      const targets = all.filter((b) => b.house && b.house.pop > 0);
      if (targets.length) igniteBuilding(game, rng.pick(targets), 'lightning');
      break;
    }
    case 'ceres':
      for (const b of all) if (b.def.kind === 'farm') b.progress = 0;
      break;
    case 'neptune':
      // Not buildings that can never collapse (a reservoir on the shore):
      // they would only show risk that can never act. Homes always take it,
      // as a Tent may move up to a level that can collapse.
      for (const b of all) if ((b.house || b.def.damage > 0) && game.map.isNearTerrain(b.x, b.y, b.size, 4, 3)) b.damageRisk += 60;
      break;
    case 'mars': {
      c.ratings.peace = Math.max(0, c.ratings.peace - 10);
      const loot = Math.min(Math.max(0, c.treasury), Math.round(100 + c.population * 0.1));
      if (loot > 0) transact(game, 'other', -loot);
      break;
    }
    case 'vesta': {
      const homes = all.filter((b) => b.house && b.house.pop > 0);
      rng.shuffle(homes);
      for (const b of homes.slice(0, 2)) b.fireRisk += 90;
      break;
    }
    default:
      break;
  }
  game.message(`${name} is angry! ${GODS[god].wrath}`, 'bad');
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

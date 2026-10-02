/**
 * battles.js (data)
 * ----------------------------------------------------------------------------
 * The cities Caesar may ask the province to defend in a distant battle
 * (sim/battle.js), and the enemies that threaten them. None of them trades
 * with the province: they are frontier towns and Rome's allies of the third
 * and second centuries BC, each threatened as it was in its day.
 *
 *   name        the city
 *   enemy       who threatens it (in messages: "an army of the Gauls")
 *   pos         where it is on the empire map (data/empireGeo.js `at`)
 *   route       'land' (soldiers march) or 'sea' (they sail, and the Naval
 *               Stations' squadrons may go too, sim/battle.js)
 *   path        [lon, lat] points the province's army passes on its way,
 *               from the province to the city (over land, or at sea: a test
 *               holds each to its kind). Its length sets the march in months
 *               (marchMonths)
 *   enemyFrom   [lon, lat] where the enemy gathers; it marches in a
 *               straight line to the city over enemyMonths months, arriving
 *               in the battle's month
 *
 * Scenario events (data/scenarios.js `distantBattles`) name a city and the
 * enemy's strength; the sandbox draws both (sim/battle.js).
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { at, project } from './empireGeo.js';
import { HOME_POS } from './scenarios.js';

export const THREATENED_CITIES = Object.freeze({
  // A Latin colony on the Po (founded 218 BC), the Gauls' first target.
  placentia: {
    name: 'Placentia', enemy: 'the Gauls', pos: at(9.7, 45.05), route: 'land',
    path: [[10.2, 44.4], [9.9, 44.8]], enemyFrom: [8.6, 47.4], enemyMonths: 6,
  },
  // On the Adriatic over the Apennines (a colony from 268 BC), watched by the Gauls of the Po.
  ariminum: {
    name: 'Ariminum', enemy: 'the Gauls', pos: at(12.45, 43.98), route: 'land',
    path: [[11.25, 43.77], [11.9, 43.85]], enemyFrom: [12.9, 46.9], enemyMonths: 6,
  },
  // Rome's ally on the coast of Hispania, whose siege in 219 BC began a war.
  saguntum: {
    name: 'Saguntum', enemy: 'Carthage', pos: at(-0.45, 39.68), route: 'sea',
    path: [[9.85, 43.6], [8.6, 43.4], [6.5, 42.6], [4.5, 41.6], [2.6, 40.6], [1.2, 40.0], [0.3, 39.7]], enemyFrom: [-0.98, 37.62], enemyMonths: 8,
  },
  // On the strait of Sicily, where Rome's first war with Carthage began (264 BC).
  messana: {
    name: 'Messana', enemy: 'Carthage', pos: at(15.35, 38.15), route: 'sea',
    path: [[10.1, 43.3], [10.25, 42.7], [10.9, 41.6], [12.4, 40.0], [14.4, 38.9], [15.2, 38.45]], enemyFrom: [12.5, 37.8], enemyMonths: 7,
  },
  // The town Scipio founded on the Baetis for his wounded veterans (206 BC),
  // raided by the Lusitanians from 155 BC. The way: along the coast of
  // Hispania, through the strait and up the river (the last leg is the
  // river, drawn straight).
  italica: {
    name: 'Italica', enemy: 'the Lusitanians', pos: at(-6.04, 37.44), route: 'sea',
    path: [[9.85, 43.6], [8.6, 43.4], [6.5, 42.6], [4.5, 41.6], [2.6, 40.6], [1.2, 40.0], [0.4, 38.9], [-0.6, 37.9], [-1.6, 37.2], [-3.0, 36.6], [-4.6, 36.4], [-5.6, 35.95], [-6.2, 36.2], [-6.45, 36.72]],
    enemyFrom: [-8.0, 39.5], enemyMonths: 7,
  },
});

export const THREATENED_IDS = Object.freeze(Object.keys(THREATENED_CITIES));

/**
 * The cities the sandbox's random requests name: the third century's wars,
 * as they always were. The later towns (Italica, Aquae Sextiae, Vercellae)
 * belong to the late campaign's provinces, a century after the sandbox's
 * founding year, and leaving them out keeps every sandbox city's draws as
 * they were.
 */
export const SANDBOX_THREATENED_IDS = Object.freeze(['placentia', 'ariminum', 'saguntum', 'messana']);

/** The army's way to a city on the empire map (map units): the province, the path, the city. */
export function marchLine(id) {
  const c = THREATENED_CITIES[id];
  return [HOME_POS, ...c.path.map((p) => project(p)), c.pos];
}

/** Length of a polyline (map units). */
function lineLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
}

/**
 * Months the province's army marches to a city: the length of its way on
 * the empire map at CONFIG.BATTLE_MONTH_UNITS a month, at least
 * BATTLE_MIN_MONTHS (the original counted the markers on its map).
 */
export function marchMonths(id) {
  if (!THREATENED_CITIES[id]) return CONFIG.BATTLE_MIN_MONTHS;
  return Math.max(CONFIG.BATTLE_MIN_MONTHS, Math.round(lineLength(marchLine(id)) / CONFIG.BATTLE_MONTH_UNITS));
}

/** The enemy's line on the empire map: where it gathers, then the city. */
export function enemyLine(id) {
  const c = THREATENED_CITIES[id];
  return [project(c.enemyFrom), c.pos];
}

/**
 * The enemy's strength in words, for the request (the original's three
 * wordings, at half its thresholds for Colonia's half-size forts).
 */
export function enemyWords(strength) {
  if (strength < 23) return 'a small army';
  if (strength < 45) return 'a large army';
  return 'a mighty host';
}

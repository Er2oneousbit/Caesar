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
 *   path        [lon, lat] points the army passes on its way from the
 *               Etruscan coast to the city (over land, or at sea: a test
 *               holds each to its kind), drawn for that site before the
 *               province moved by mission and kept for it. From any other
 *               site the army takes the roads or the sea lanes
 *               (data/empireRoutes.js networkWay). The way's length sets the
 *               march in months (marchMonths)
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
import { SITES, HOME_SITE } from './sites.js';
import { networkWay, lineLength } from './empireRoutes.js';

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
  // A Roman post of 122 BC in the hills behind Massilia, where the Teutones
  // came down the Rhone; the way runs along the coast road.
  aquae_sextiae: {
    name: 'Aquae Sextiae', enemy: 'the Teutones', pos: at(5.45, 43.53), route: 'land',
    path: [[10.0, 44.15], [9.3, 44.5], [8.5, 44.4], [7.6, 44.05], [6.8, 43.8], [6.2, 43.62]], enemyFrom: [4.0, 46.5], enemyMonths: 6,
  },
  // A town of the Po plain under the Alps, where the Cimbri came over the passes.
  vercellae: {
    name: 'Vercellae', enemy: 'the Cimbri', pos: at(8.42, 45.32), route: 'land',
    path: [[10.2, 44.2], [9.6, 44.6], [9.0, 45.0]], enemyFrom: [9.5, 46.8], enemyMonths: 5,
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

/**
 * The army's way from a site to a city on the empire map (map units): the
 * site, the points it passes, the city. From the Etruscan coast, the city's
 * own `path`; from anywhere else the roads (a city reached by land) or the
 * lanes and the site's river (by sea), to the point of them nearest the city.
 */
export function marchLine(siteId, id) {
  const c = THREATENED_CITIES[id];
  const site = (SITES[siteId] || SITES[HOME_SITE]).pos;
  if (!SITES[siteId] || siteId === HOME_SITE) return [site, ...c.path.map((p) => project(p)), c.pos];
  const way = networkWay(siteId, c.route, c.pos);
  // A way that ends on the city itself (Ariminum is a stage on the Adriatic road) ends there once.
  const last = way[way.length - 1];
  if (last && Math.hypot(last[0] - c.pos[0], last[1] - c.pos[1]) < 0.05) way.pop();
  return [site, ...way, c.pos];
}

/**
 * Months the province's army marches from a site to a city: the length of
 * its way on the empire map at CONFIG.BATTLE_MONTH_UNITS a month, at least
 * BATTLE_MIN_MONTHS (the original counted the markers on its map).
 */
export function marchMonths(siteId, id) {
  if (!THREATENED_CITIES[id]) return CONFIG.BATTLE_MIN_MONTHS;
  return Math.max(CONFIG.BATTLE_MIN_MONTHS, Math.round(lineLength(marchLine(siteId, id)) / CONFIG.BATTLE_MONTH_UNITS));
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

/**
 * scenarios.js (data)
 * ----------------------------------------------------------------------------
 * Campaign missions + the sandbox. Everything here is original text.
 *
 * Scenario fields:
 *   id, name, title, intro        display text
 *   map: { size, type, seed }     passed to world/mapgen.js
 *   funds                         starting treasury (Dn)
 *   startYear                     negative = BC
 *   goals: { population, culture, prosperity, peace, favor }  (0 = not required)
 *   paceYears                     the planned floor: the fewest game years the
 *                                 goals allow (sim/pace.js; a test holds the
 *                                 goals to it). A year is about 5.3 minutes at 1x
 *   unlocks: 'all' | string[]     building keys + tool keys available
 *   partners: string[]            trade partner ids (see TRADE_PARTNERS). Only list
 *                                 sea partners on maps with navigable water
 *                                 (river, coast, or a big lake at the map edge)
 *   requests: boolean             Emperor makes requests
 *   crime, disease: false         none of it in this mission (the first two,
 *                                 which teach the basics); missing = on
 *   majorWrath: false             a god angered again before it calms strikes
 *                                 only as hard as the first time (Mercury does
 *                                 not burn the storehouse; sim/religion.js).
 *                                 The first two missions, as in the original,
 *                                 where a new player's one granary would burn
 *   difficulty                    key of data/difficulty.js (missing = normal;
 *                                 campaign missions get it from withDifficulty)
 *   hints: string[]               tips shown at start
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { DIFFICULTY, difficultyOf } from './difficulty.js';

/**
 * Trade partners.
 *   route  'land': caravans walk in along the Imperial road to a warehouse.
 *          'sea':  merchant ships sail in from the map edge to a Dock (needs
 *                  navigable water: a river, the coast or a big edge lake).
 *   sells  goods the city can IMPORT from them (units/year)
 *   buys   goods the city can EXPORT to them (units/year)
 *   pos    [x, y] on the Trade advisor's empire map (0..100 x 0..60)
 *   color  sail / banner color
 */
export const TRADE_PARTNERS = Object.freeze({
  tarraco: { name: 'Tarraco', route: 'land', openCost: 500, pos: [14, 24], color: '#b8573a', sells: { timber: 1200, olives: 1000 }, buys: { wheat: 1500, pottery: 800 } },
  massilia: { name: 'Massilia', route: 'sea', openCost: 700, pos: [30, 17], color: '#3f6fb0', sells: { clay: 1200, wine: 600 }, buys: { furniture: 800, vegetables: 1200, pottery: 600 } },
  lugdunum: { name: 'Lugdunum', route: 'land', openCost: 800, pos: [30, 6], color: '#6d7480', sells: { iron: 1000, meat: 1200, arrows: 400 }, buys: { oil: 800, wine: 800, fruit: 1000 } },
  aquileia: { name: 'Aquileia', route: 'land', openCost: 600, pos: [55, 8], color: '#7a9c5a', sells: { pottery: 600, vegetables: 1500 }, buys: { clay: 1200, olives: 1000, meat: 1000 } },
  capua: { name: 'Capua', route: 'land', openCost: 700, pos: [57, 25], color: '#a38b3d', sells: { wheat: 1500, wine: 600 }, buys: { pottery: 800, furniture: 600, iron: 600 } },
  carthago: { name: 'Carthago', route: 'sea', openCost: 1000, pos: [46, 42], color: '#8a3a9a', sells: { fruit: 1500, grapes: 1200, furniture: 500 }, buys: { weapons: 800, marble: 600, timber: 1000 } },
  cirta: { name: 'Cirta', route: 'sea', openCost: 900, pos: [36, 49], color: '#c9962e', sells: { horses: 600, fruit: 800 }, buys: { weapons: 600, pottery: 800, oil: 600 } },
  corinthus: { name: 'Corinthus', route: 'sea', openCost: 1200, pos: [76, 30], color: '#2f8a8a', sells: { marble: 800, oil: 800 }, buys: { wine: 1000, wheat: 2000, iron: 1000, arrows: 600 } },
  alexandria: { name: 'Alexandria', route: 'sea', openCost: 1400, pos: [88, 50], color: '#d6ab3c', sells: { wheat: 2500, vegetables: 1000 }, buys: { wine: 800, oil: 800, weapons: 600, furniture: 600 } },
});

/** Where the player's province sits on the empire map. */
export const HOME_POS = Object.freeze([48, 22]);

/**
 * Invasion settings. `first` = months until the first raid, `interval` = months
 * between raids, `base` = raiders in the first warband (grows with the city).
 * The first raid leaves time to build a town and an army (an iron mine, a
 * weaponsmith, a barracks and a fort) before it: 5 years with occasional
 * raids, 3 with frequent ones (Insane: 25% sooner).
 */
export const INVASION_PRESETS = Object.freeze({
  none: null,
  occasional: { first: 60, interval: [24, 36], base: 5 },
  frequent: { first: 36, interval: [12, 20], base: 7 },
});

/*
 * The campaign's length: each mission's goals are set so the fastest possible
 * city takes the mission's paceYears (sim/pace.js), about 1 year for the first
 * and 15 for the last. With the homes, farms and services to build first,
 * that is roughly half an hour for the first missions and a few hours for the
 * last at normal speed. The goals follow the housing ladder: what the
 * unlocked buildings let homes reach (Huts in the first mission, Townhouses
 * in the second, Domus in the third, Villas in the fourth, then everything).
 */
const BASIC = ['house', 'road', 'roadblock', 'clear', 'well', 'prefecture', 'engineer_post', 'farm_wheat', 'granary', 'market', 'temple_ceres', 'temple_mercury', 'garden', 'forum'];
const TIER2 = [...BASIC, 'reservoir', 'aqueduct', 'fountain', 'barber', 'school', 'theater', 'actor_troupe', 'farm_veg', 'temple_neptune', 'temple_mars', 'temple_venus', 'statue_small', 'plaza'];
const TIER3 = [...TIER2, 'clay_pit', 'pottery_ws', 'warehouse', 'baths', 'clinic', 'library', 'statue_medium', 'farm_fruit'];
const TIER4 = [...TIER3, 'bridge', 'timber_yard', 'furniture_ws', 'amphitheater', 'gladiator_school', 'farm_olive', 'oil_ws', 'farm_pig', 'dock',
  'iron_mine', 'weapons_ws', 'fletcher_ws', 'barracks', 'fort_legion', 'fort_archer', 'tower', 'wall'];

export const SCENARIOS = Object.freeze([
  {
    id: 'c1', name: 'Novum Castrum', title: 'First Foundations',
    intro: 'The Senate has granted you a patch of riverside land and a handful of settlers. Lay out roads, give families a place to live, keep them fed and keep the fires down. Grow a town, bring the gods to its streets and keep the peace to prove you can govern.',
    map: { size: 64, type: 'river', seed: 'novum-castrum' },
    funds: 6000, startYear: -280,
    goals: { population: 1200, culture: 15, prosperity: 0, peace: 35, favor: 0 },
    paceYears: 1.25,
    unlocks: BASIC, partners: [], requests: false, crime: false, disease: false, majorWrath: false,
    hints: [
      'Build Housing Plots next to the Imperial Road (or any road connected to it). Settlers arrive from the map edge.',
      'Place a Well within 2 tiles of homes so tents can become Family Tents.',
      'A Wheat Farm on meadow (the yellow-green land) feeds a Granary; a Market sends vendors to sell food to homes.',
      'A Prefecture and an Engineer\'s Post keep fires and collapses away. Put them near your homes.',
      'The Forum sends tax collectors. Homes they have not visited pay nothing!',
      `Culture here comes from the temples: every home a priest visits counts. Peace grows a point a month while the city is content (a mood of ${CONFIG.PEACE_MOOD} or more): fed, housed, at work and not overtaxed.`,
      'Click any building for details. Homes tell you exactly what they need to grow.',
    ],
  },
  {
    id: 'c2', name: 'Aquae Clarae', title: 'Clear Waters',
    intro: 'A lakeside town needs clean water and a little culture. Build reservoirs by the lakes, run aqueducts, and give citizens fountains, schools and a stage.',
    map: { size: 96, type: 'lakes', seed: 'aquae-clarae' },
    funds: 7000, startYear: -270,
    goals: { population: 2500, culture: 35, prosperity: 20, peace: 45, favor: 0 },
    paceYears: 2.25,
    unlocks: TIER2, partners: [], requests: false, crime: false, disease: false, majorWrath: false,
    hints: [
      'A Reservoir placed next to water fills up. Fountains inside its piped area (10 tiles) supply homes within 4 tiles.',
      'Aqueducts connect a full reservoir to other reservoirs farther inland.',
      'Cottages need a fountain; above them homes want entertainment, then a school. A Theater needs actors: build an Actor Troupe nearby.',
      'Prosperity grows with better homes, a profit, work for everyone and fair wages.',
    ],
  },
  {
    id: 'c3', name: 'Figlina', title: 'Clay and Commerce',
    intro: 'The plains of Figlina are rich in clay. Build an industry, fill warehouses and open your first trade route. Prosperity is now expected of you.',
    map: { size: 112, type: 'plains', seed: 'figlina' },
    funds: 7000, startYear: -255,
    goals: { population: 3500, culture: 45, prosperity: 30, peace: 50, favor: 0 },
    paceYears: 3.6,
    unlocks: TIER3, partners: ['tarraco', 'aquileia'], requests: true,
    hints: [
      'Clay Pits must be near water. Potters turn clay into pottery, which Merchant Houses and every home above them need, with Thermae nearby.',
      'Warehouses store goods. Caravans only trade with warehouses.',
      'Open trade routes in the Trade advisor, then mark goods for import or export.',
    ],
  },
  {
    id: 'c4', name: 'Pons Aelius', title: 'The River Crossing',
    intro: 'A great river divides this province. Bridge it, harvest its forests and olive groves, and entertain a growing people with gladiatorial games.',
    map: { size: 128, type: 'river', seed: 'pons-aelius' },
    funds: 8000, startYear: -240,
    goals: { population: 5000, culture: 50, prosperity: 40, peace: 55, favor: 0 },
    paceYears: 5.7,
    unlocks: TIER4, partners: ['tarraco', 'massilia', 'lugdunum'], requests: true,
    military: { first: 60, interval: [30, 40], base: 4 },
    hints: [
      'Bridges must start and end on land and run straight across water.',
      'Massilia trades by sea: build a Dock on the river bank. Tarraco and Lugdunum send caravans along the Imperial road.',
      'Apartment Houses need furniture (a Carpenter, from timber); Tenements, the first big homes, also need oil, a barber, and both a school and a library.',
      'Raiders roam these hills. A Barracks trains soldiers for your forts: legionaries need weapons (Weaponsmith), archers need arrows (Fletcher, from timber).',
    ],
  },
  {
    id: 'c5', name: 'Portus Mercatorum', title: 'Merchant Shore',
    intro: 'A coastal province with iron in its hills and vines on its slopes. Grow a wealthy city worthy of villas, and keep the Emperor happy.',
    map: { size: 128, type: 'coast', seed: 'portus-mercatorum' },
    funds: 9000, startYear: -225,
    goals: { population: 6500, culture: 60, prosperity: 50, peace: 60, favor: 55 },
    paceYears: 7.8,
    unlocks: 'all', partners: ['massilia', 'lugdunum', 'carthago', 'corinthus', 'cirta', 'alexandria'], requests: true,
    military: { first: 48, interval: [22, 32], base: 6 },
    hints: [
      'Villas need wine, two kinds of food and two gods. Patricians do not work, but pay handsome taxes and lift prosperity.',
      'The Emperor\'s favor drifts back toward 50: his requests, the yearly tribute and gifts raise it.',
      'Cavalry needs horses. Breed them at a Horse Ranch on meadow (the herd grows over time), or import them from Cirta by sea.',
    ],
  },
  {
    id: 'c6', name: 'Oasis Aurea', title: 'Sands of Gold',
    intro: 'Water is life in the desert. Only the land around the oases can feed your people. Plan every aqueduct carefully.',
    map: { size: 128, type: 'desert', seed: 'oasis-aurea' },
    funds: 10000, startYear: -210,
    goals: { population: 7000, culture: 60, prosperity: 55, peace: 65, favor: 60 },
    paceYears: 8.5,
    unlocks: 'all', partners: ['capua', 'aquileia', 'lugdunum', 'tarraco'], requests: true,
    military: { first: 42, interval: [20, 30], base: 6 },
    hints: ['No ship can reach the desert, but caravans can: import wheat from Capua if the oases cannot feed everyone.', 'Desert raiders ride fast: towers and cavalry help.'],
  },
  {
    id: 'c7', name: 'Urbs Magna', title: 'The Great City',
    intro: 'Your last and greatest charge: build a city to rival Rome itself.',
    map: { size: 160, type: 'lakes', seed: 'urbs-magna' },
    funds: 12000, startYear: -190,
    goals: { population: 12000, culture: 75, prosperity: 70, peace: 75, favor: 65 },
    paceYears: 15.4,
    unlocks: 'all', partners: Object.keys(TRADE_PARTNERS), requests: true,
    military: { first: 36, interval: [14, 22], base: 8 },
    hints: [
      'Palatia need four gods, a Medicus and a Valetudinarium, wine from two sources (a staffed winery and an import route) and plenty of shows.',
      'A Senate adds to culture and prosperity. Expect regular raids: walls with gates, towers and a mixed army keep the capital safe.',
    ],
  },
]);

/**
 * A campaign mission played at a difficulty: a copy with the key set and the
 * starting funds scaled. Normal returns the mission as written.
 */
export function withDifficulty(scenario, difficulty = 'normal') {
  if (!scenario || !DIFFICULTY[difficulty] || difficulty === 'normal') return scenario;
  return { ...scenario, difficulty, funds: Math.round(scenario.funds * difficultyOf(difficulty).funds) };
}

/** Sandbox settings template. The New Game screen fills in the blanks. */
export function sandboxScenario({ size = 96, type = 'river', seed = 'sandbox', funds = 8000, difficulty = 'normal', invasions = 'occasional' } = {}) {
  return {
    id: 'sandbox', name: 'Sandbox', title: 'Free Build',
    intro: 'No goals, no deadlines. Build the city you want.',
    map: { size, type, seed },
    funds: Math.round(funds * difficultyOf(difficulty).funds),
    startYear: -300,
    goals: { population: 0, culture: 0, prosperity: 0, peace: 0, favor: 0 },
    unlocks: 'all', partners: Object.keys(TRADE_PARTNERS), requests: true,
    military: INVASION_PRESETS[invasions] ?? null,
    invasions,
    difficulty,
    hints: ['Tip: press F1 for help at any time.'],
  };
}

export function findScenario(id) {
  return SCENARIOS.find((s) => s.id === id) || null;
}

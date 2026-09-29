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
 *   unlocks: 'all' | string[]     building keys + tool keys available
 *   partners: string[]            trade partner ids (see TRADE_PARTNERS)
 *   requests: boolean             Emperor makes requests
 *   hints: string[]               tips shown at start
 * ----------------------------------------------------------------------------
 */

/**
 * Trade partners. `sells` = goods the city can IMPORT from them (units/year),
 * `buys` = goods the city can EXPORT to them (units/year).
 */
export const TRADE_PARTNERS = Object.freeze({
  tarraco: { name: 'Tarraco', openCost: 500, sells: { timber: 1200, olives: 1000 }, buys: { wheat: 1500, pottery: 800 } },
  massilia: { name: 'Massilia', openCost: 700, sells: { clay: 1200, wine: 600 }, buys: { furniture: 800, vegetables: 1200, pottery: 600 } },
  lugdunum: { name: 'Lugdunum', openCost: 800, sells: { iron: 1000, meat: 1200 }, buys: { oil: 800, wine: 800, fruit: 1000 } },
  carthago: { name: 'Carthago', openCost: 1000, sells: { fruit: 1500, grapes: 1200, furniture: 500 }, buys: { weapons: 800, marble: 600, timber: 1000 } },
  corinthus: { name: 'Corinthus', openCost: 1200, sells: { marble: 800, oil: 800 }, buys: { wine: 1000, wheat: 2000, iron: 1000 } },
  aquileia: { name: 'Aquileia', openCost: 600, sells: { pottery: 600, vegetables: 1500 }, buys: { clay: 1200, olives: 1000, meat: 1000 } },
});

const BASIC = ['house', 'road', 'clear', 'well', 'prefecture', 'engineer_post', 'farm_wheat', 'granary', 'market', 'temple_ceres', 'temple_jupiter', 'garden'];
const TIER2 = [...BASIC, 'reservoir', 'aqueduct', 'fountain', 'barber', 'school', 'theater', 'actor_troupe', 'farm_veg', 'temple_neptune', 'temple_mars', 'temple_vesta', 'forum', 'statue_small', 'plaza'];
const TIER3 = [...TIER2, 'clay_pit', 'pottery_ws', 'warehouse', 'baths', 'clinic', 'library', 'statue_medium', 'farm_fruit'];
const TIER4 = [...TIER3, 'bridge', 'timber_yard', 'furniture_ws', 'amphitheater', 'gladiator_school', 'farm_olive', 'oil_ws', 'farm_pig'];

export const SCENARIOS = Object.freeze([
  {
    id: 'c1', name: 'Novum Castrum', title: 'First Foundations',
    intro: 'The Senate has granted you a patch of riverside land and a handful of settlers. Lay out roads, give families a place to live, keep them fed and keep the fires down. Reach a population of 250 to prove you can govern.',
    map: { size: 64, type: 'river', seed: 'novum-castrum' },
    funds: 6000, startYear: -280,
    goals: { population: 250, culture: 0, prosperity: 0, peace: 0, favor: 0 },
    unlocks: BASIC, partners: [], requests: false,
    hints: [
      'Build Housing Plots next to the Imperial Road (or any road connected to it). Settlers arrive from the map edge.',
      'Place a Well within 2 tiles of homes so tents can become Lean-tos.',
      'A Wheat Farm on meadow (the yellow-green land) feeds a Granary; a Market sends vendors to sell food to homes.',
      'A Prefecture and an Engineer\'s Post keep fires and collapses away. Put them near your homes.',
      'Click any building for details. Homes tell you exactly what they need to grow.',
    ],
  },
  {
    id: 'c2', name: 'Aquae Clarae', title: 'Clear Waters',
    intro: 'A lakeside town needs clean water and a little culture. Build reservoirs by the lakes, run aqueducts, and give citizens fountains, schools and a stage.',
    map: { size: 80, type: 'lakes', seed: 'aquae-clarae' },
    funds: 7000, startYear: -270,
    goals: { population: 700, culture: 12, prosperity: 0, peace: 0, favor: 0 },
    unlocks: TIER2, partners: [], requests: false,
    hints: [
      'A Reservoir placed next to water fills up. Fountains inside its piped area (10 tiles) supply homes within 4 tiles.',
      'Aqueducts connect a full reservoir to other reservoirs farther inland.',
      'A Theater needs actors: build an Actor Troupe nearby.',
      'The Forum sends tax collectors. Untaxed homes pay nothing!',
    ],
  },
  {
    id: 'c3', name: 'Figlina', title: 'Clay and Commerce',
    intro: 'The plains of Figlina are rich in clay. Build an industry, fill warehouses and open your first trade route. Prosperity is now expected of you.',
    map: { size: 96, type: 'plains', seed: 'figlina' },
    funds: 7000, startYear: -255,
    goals: { population: 1200, culture: 20, prosperity: 15, peace: 0, favor: 0 },
    unlocks: TIER3, partners: ['tarraco', 'aquileia'], requests: true,
    hints: [
      'Clay Pits must be near water. Potters turn clay into pottery, which Domus-level homes need.',
      'Warehouses store goods. Caravans only trade with warehouses.',
      'Open trade routes in the Trade advisor, then mark goods for import or export.',
    ],
  },
  {
    id: 'c4', name: 'Pons Aelius', title: 'The River Crossing',
    intro: 'A great river divides this province. Bridge it, harvest its forests and olive groves, and entertain a growing people with gladiatorial games.',
    map: { size: 96, type: 'river', seed: 'pons-aelius' },
    funds: 8000, startYear: -240,
    goals: { population: 2000, culture: 30, prosperity: 25, peace: 10, favor: 0 },
    unlocks: TIER4, partners: ['tarraco', 'massilia', 'lugdunum'], requests: true,
    hints: [
      'Bridges must start and end on land and run straight across water.',
      'Insulae need furniture; Upper Insulae also need oil.',
    ],
  },
  {
    id: 'c5', name: 'Portus Mercatorum', title: 'Merchant Shore',
    intro: 'A coastal province with iron in its hills and vines on its slopes. Grow a wealthy city worthy of villas, and keep the Emperor happy.',
    map: { size: 112, type: 'coast', seed: 'portus-mercatorum' },
    funds: 9000, startYear: -225,
    goals: { population: 3000, culture: 40, prosperity: 35, peace: 20, favor: 40 },
    unlocks: 'all', partners: ['massilia', 'lugdunum', 'carthago', 'corinthus'], requests: true,
    hints: ['Villas need wine and three food types. Patricians do not work, but pay handsome taxes.'],
  },
  {
    id: 'c6', name: 'Oasis Aurea', title: 'Sands of Gold',
    intro: 'Water is life in the desert. Only the land around the oases can feed your people. Plan every aqueduct carefully.',
    map: { size: 96, type: 'desert', seed: 'oasis-aurea' },
    funds: 10000, startYear: -210,
    goals: { population: 2500, culture: 35, prosperity: 30, peace: 20, favor: 35 },
    unlocks: 'all', partners: ['carthago', 'corinthus', 'aquileia'], requests: true,
    hints: ['Import food if the oases cannot feed everyone.'],
  },
  {
    id: 'c7', name: 'Urbs Magna', title: 'The Great City',
    intro: 'Your last and greatest charge: build a city to rival Rome itself.',
    map: { size: 128, type: 'lakes', seed: 'urbs-magna' },
    funds: 12000, startYear: -190,
    goals: { population: 6000, culture: 60, prosperity: 55, peace: 40, favor: 55 },
    unlocks: 'all', partners: ['tarraco', 'massilia', 'lugdunum', 'carthago', 'corinthus', 'aquileia'], requests: true,
    hints: ['Palatia need four gods, four health services and every entertainment venue.'],
  },
]);

/** Sandbox settings template. The New Game screen fills in the blanks. */
export function sandboxScenario({ size = 96, type = 'river', seed = 'sandbox', funds = 8000, difficulty = 'normal' } = {}) {
  const fundsByDiff = { easy: 1.5, normal: 1, hard: 0.6 };
  return {
    id: 'sandbox', name: 'Sandbox', title: 'Free Build',
    intro: 'No goals, no deadlines. Build the city you want.',
    map: { size, type, seed },
    funds: Math.round(funds * (fundsByDiff[difficulty] ?? 1)),
    startYear: -300,
    goals: { population: 0, culture: 0, prosperity: 0, peace: 0, favor: 0 },
    unlocks: 'all', partners: Object.keys(TRADE_PARTNERS), requests: true,
    difficulty,
    hints: ['Tip: press F1 for help at any time.'],
  };
}

export function findScenario(id) {
  return SCENARIOS.find((s) => s.id === id) || null;
}

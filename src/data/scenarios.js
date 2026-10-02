/**
 * scenarios.js (data)
 * ----------------------------------------------------------------------------
 * Campaign missions + the sandbox. Everything here is original text.
 *
 * Scenario fields:
 *   id, name, title, intro        display text (id: c1 to c7, and a step
 *                                 number with a track letter for the
 *                                 missions added beside them: c3m, c4p...)
 *   step                          place in the campaign, 1 to 7. Winning any
 *                                 mission of a step opens every mission of
 *                                 the next (missionOpen, nextMissions)
 *   track: 'peaceful'|'military'  at a step with two missions, which kind
 *                                 this one is; missing at a single step
 *   map: { size, type, seed }     passed to world/mapgen.js
 *   funds                         starting treasury (Dn)
 *   startYear                     negative = BC
 *   goals: { population, culture, prosperity, peace, favor }  (0 = not required)
 *                                 population: no more than the mission's buildings
 *                                 can employ (sim/capacity.js; a test holds it
 *                                 there)
 *   paceYears                     the planned floor: the fewest game years the
 *                                 goals allow (sim/pace.js; a test holds the
 *                                 goals to it). A year is 8 minutes at 1x
 *   unlocks: 'all' | string[]     building keys + tool keys available
 *   partners: string[]            trade partner ids (see TRADE_PARTNERS). Only list
 *                                 sea partners on maps with navigable water
 *                                 (river, coast, or a big lake at the map edge)
 *   demand                        optional { partner: { good: units } }: what a
 *                                 partner buys a year in this mission, on the
 *                                 tiers DEMAND_TIERS (sim/tradeDemand.js), in
 *                                 place of its own table's amount
 *   demandChanges                 optional [{ year, partner, good, to }]: in the
 *                                 mission's year `year`, in a month from Martius
 *                                 to October drawn from the map's seed, the
 *                                 partner's yearly amount of `good` becomes `to`
 *                                 (0 stops it); the player is told
 *   requests: boolean             Emperor makes requests
 *   crime, disease: false         none of it in this mission (the first two,
 *                                 which teach the basics); missing = on
 *   majorWrath: false             a god angered again before it calms strikes
 *                                 only as hard as the first time (Mercury does
 *                                 not burn the storehouse; sim/religion.js).
 *                                 The first two missions, as in the original,
 *                                 where a new player's one granary would burn
 *   military                      invasion settings (INVASION_PRESETS), or none
 *   distantBattles                Caesar's requests for troops (sim/battle.js), in
 *                                 the missions with forts (Firmum, then step 4
 *                                 on, peaceful provinces aside): each { year, city,
 *                                 enemy } asks in the mission's year `year` (1 =
 *                                 its first), in a month from Martius to October
 *                                 drawn from the map's seed, for troops for `city`
 *                                 (data/battles.js) against `enemy` strength; the
 *                                 battle is fought BATTLE_MONTHS later
 *   seaRaids: false               every raid comes by land (missing = some come
 *                                 by sea where ships can sail; sim/navy.js)
 *   rank                          the governor's rank (data/ranks.js): one per
 *                                 step, Citizen at step 1 and one up each step
 *                                 after (both missions of a step share it,
 *                                 as in the original); the sandbox's is picked in
 *                                 its setup. Sets the salary (sim/governor.js)
 *   difficulty                    key of data/difficulty.js (missing = normal;
 *                                 campaign missions get it from withDifficulty)
 *   hints: string[]               tips shown at start
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { DIFFICULTY, difficultyOf } from './difficulty.js';
import { at } from './empireGeo.js';
import { BUILDINGS, TOOLS } from './buildings.js';
import { SANDBOX_RANK, clampRank } from './ranks.js';
import { GOD_KEYS } from './gods.js';

/**
 * Trade partners.
 *   route  'land': caravans walk in along the Imperial road to a warehouse.
 *          'sea':  merchant ships sail in from the map edge to a Dock (needs
 *                  navigable water: a river, the coast or a big edge lake).
 *   sells  goods the city can IMPORT from them (units/year)
 *   buys   goods the city can EXPORT to them (units/year)
 *   pos    [x, y] on the empire map (0..100 x 0..60), where the city really
 *          is: at(longitude, latitude), see data/empireGeo.js. Carthago
 *          sits just inland of its harbor; Cirta is inland too, and its
 *          ships put in on the coast below it
 *   color  sail / banner color
 *   labelSides  optional: the sides of its dot the empire map tries for its
 *          name, in order (default above, below, right, left); Delos and
 *          Rhodus lie close to Corinthus and each other
 *
 * Cloth (not in the original), by what each place was known for: Egypt's
 * linen was the finest in the Mediterranean (Alexandria sells the most), and
 * Hispania's coast round Tarraco wove linen of its own; rich Capua and
 * Corinthus buy clothing. A mission whose homes can reach the Insula, where
 * clothing is first needed, also unlocks the Linarium, Textrinum and
 * Taberna Vestiaria (TIER4 on), so linen bought in only saves a flax field.
 *
 * Three partners for the late campaign, by sea from the far ends of the sea:
 * Gades, the Phoenician port beyond the Pillars of Hercules and Rome's ally
 * from 206 BC (its olives and the iron of Hispania's mines); Rhodus, the
 * trading republic and its wine, hungry for grain, timber and iron for its
 * fleet; and Delos, a free port from 166 BC, the market of the Aegean. They
 * buy on the original's quota tiers (1,500, 2,500 and 4,000 a year, see
 * sim/tradeDemand.js), and so do the late missions' own `demand` fields; a
 * route this busy sends its ships more often. Urbs Magna keeps the nine it
 * always had (its list is written out), the sandbox has all twelve.
 */
export const TRADE_PARTNERS = Object.freeze({
  tarraco: { name: 'Tarraco', route: 'land', openCost: 500, pos: at(1.25, 41.12), color: '#b8573a', sells: { timber: 1200, olives: 1000, linen: 600 }, buys: { wheat: 1500, pottery: 800 } },
  massilia: { name: 'Massilia', route: 'sea', openCost: 700, pos: at(5.37, 43.29), color: '#3f6fb0', sells: { clay: 1200, wine: 600 }, buys: { furniture: 800, vegetables: 1200, pottery: 600 } },
  lugdunum: { name: 'Lugdunum', route: 'land', openCost: 800, pos: at(4.83, 45.76), color: '#6d7480', sells: { iron: 1000, meat: 1200, arrows: 400 }, buys: { oil: 800, wine: 800, fruit: 1000 } },
  aquileia: { name: 'Aquileia', route: 'land', openCost: 600, pos: at(13.37, 45.77), color: '#7a9c5a', sells: { pottery: 600, vegetables: 1500 }, buys: { clay: 1200, olives: 1000, meat: 1000 } },
  capua: { name: 'Capua', route: 'land', openCost: 700, pos: at(14.25, 41.08), color: '#a38b3d', sells: { wheat: 1500, wine: 600 }, buys: { pottery: 800, furniture: 600, iron: 600, clothing: 600 } },
  carthago: { name: 'Carthago', route: 'sea', openCost: 1000, pos: at(10.25, 36.85), color: '#8a3a9a', sells: { fruit: 1500, grapes: 1200, furniture: 500 }, buys: { weapons: 800, marble: 600, timber: 1000 } },
  cirta: { name: 'Cirta', route: 'sea', openCost: 900, pos: at(6.61, 36.37), color: '#c9962e', sells: { horses: 600, fruit: 800 }, buys: { weapons: 600, pottery: 800, oil: 600 } },
  corinthus: { name: 'Corinthus', route: 'sea', openCost: 1200, pos: at(22.92, 37.9), color: '#2f8a8a', sells: { marble: 800, oil: 800 }, buys: { wine: 1000, wheat: 2000, iron: 1000, arrows: 600, clothing: 600 } },
  alexandria: { name: 'Alexandria', route: 'sea', openCost: 1400, pos: at(29.9, 31.15), color: '#d6ab3c', sells: { wheat: 2500, vegetables: 1000, linen: 1000 }, buys: { wine: 800, oil: 800, weapons: 600, furniture: 600 } },
  gades: { name: 'Gades', route: 'sea', openCost: 1300, pos: at(-6.25, 36.52), color: '#b03f5e', sells: { olives: 1500, iron: 1000 }, buys: { pottery: 1500, furniture: 1500, clothing: 1500, wine: 1500 } },
  rhodus: { name: 'Rhodus', route: 'sea', openCost: 1300, pos: at(28.22, 36.43), labelSides: ['below', 'right', 'above', 'left'], color: '#d9783b', sells: { wine: 1500 }, buys: { wheat: 2500, timber: 1500, iron: 1500, weapons: 1000 } },
  delos: { name: 'Delos', route: 'sea', openCost: 1500, pos: at(25.27, 37.4), labelSides: ['right', 'below', 'above', 'left'], color: '#c25fa0', sells: { linen: 1000, marble: 800 }, buys: { oil: 2500, wine: 2500, clothing: 1500, furniture: 1500 } },
});

/** The nine partners of the first seven missions (Urbs Magna trades with all of them). */
export const FIRST_NINE = Object.freeze(['tarraco', 'massilia', 'lugdunum', 'aquileia', 'capua', 'carthago', 'cirta', 'corinthus', 'alexandria']);

/**
 * Where the player's province sits on the empire map: the Etruscan coast by
 * the mouth of the Arno (Pisae's country). The province is anyone's, but
 * here it reads well: on the coast, so ships can come; on the peninsula, so
 * caravans walk in from Gaul, over the Alps, along the Po and from Capua
 * through Rome; north of Rome, so every route fans out from it without
 * crossing Italy, and the south of the boot (heel and toe) stays clear.
 * Moving it means moving the routes too (ROUTES_LL in data/empireGeo.js).
 */
export const HOME_POS = at(10.45, 43.72);

/**
 * Invasion settings. `first` = months until the first raid, `interval` = months
 * between raids, `base` = raiders in the first warband (grows with the city).
 * The first raid leaves time to build a town and an army (an iron mine, a
 * weaponsmith, a barracks and a fort) before it: 5 years with occasional
 * raids, 3 with frequent ones (Insane: 25% sooner).
 */
export const INVASION_PRESETS = Object.freeze({
  none: null,
  // First raid in months: 8 and 5 years (were 5 and 3: a sandbox on Normal
  // still had barely a city when the first warband came).
  occasional: { first: 96, interval: [24, 36], base: 5 },
  frequent: { first: 60, interval: [12, 20], base: 7 },
});

/*
 * The campaign's goals. Population: about a third of the plebeians look for
 * work, and above 10% unemployment the city's mood falls and peace stops
 * growing, so a goal of more people than the mission's buildings employ
 * cannot be met by a well run city. Mission 1 once asked for 1,200 people
 * when a sensible town of its buildings has about 100 jobs. Missions 1 and 2
 * ask for what a sensibly built town employs: measured with the demo city
 * (`npm run sim -- --scenario c1 --unlocks --homes 40`: 312 people, 4% out
 * of work) and held under the capacity model's sensible ceiling by a test
 * (sim/capacity.js, `npm run sim -- --capacity`). Missions 3 to 7 ask for a
 * little under what a city of working homes alone employs; the model now
 * counts a few villas too, which leaves them room to spare (see the ROADMAP
 * note "The late missions need more jobs").
 *
 * Length: each mission's goals are set so the fastest possible city takes the
 * mission's paceYears (sim/pace.js). In missions 1 and 2 peace sets it (a
 * point a month from 20); from mission 3 on, the population.
 *
 * The homes follow the housing ladder: what the unlocked buildings let homes
 * reach (Huts in the first mission, Townhouses in the second, Domus in the
 * third, Villas in the fourth, then everything). The third mission has the
 * amphitheater for its Domus: a theater alone gives a home at most 16
 * entertainment (10 for a visit, 6 from the seat base), and a Domus needs 20.
 */
/**
 * The fleet (sim/navy.js): the missions with raids and water ships can sail
 * (4, the river; 5, the coast; 7, a lake at the map's edge) and the sandbox.
 * Firmum is raided but its lakes never reach the map's edge: no fleet there.
 */
export const NAVY_KEYS = Object.freeze(['navalia', 'naval_station', 'portus']);
/*
 * The governor's residences come with the career, as the original's bigger
 * ones came with later missions: the house from the first mission, the
 * villa from the third, the palace from the fifth (every building is open
 * from there). No rank is asked for: the mission decides.
 */
const BASIC = ['house', 'road', 'roadblock', 'clear', 'well', 'prefecture', 'engineer_post', 'farm_wheat', 'granary', 'market', 'temple_ceres', 'temple_mercury', 'garden', 'forum', 'governor_house'];
const TIER2 = [...BASIC, 'reservoir', 'aqueduct', 'fountain', 'barber', 'school', 'theater', 'actor_troupe', 'farm_veg', 'temple_neptune', 'temple_mars', 'temple_venus', 'statue_small', 'plaza'];
/** The large temples (one per god) come with the third mission, the first to ask for Domus and bigger homes. */
export const LARGE_TEMPLE_KEYS = Object.freeze(GOD_KEYS.map((g) => `temple_large_${g}`));
const TIER3 = [...TIER2, 'clay_pit', 'pottery_ws', 'warehouse', 'baths', 'clinic', 'library', 'statue_medium', 'farm_fruit', 'amphitheater', 'gladiator_school', 'governor_villa', ...LARGE_TEMPLE_KEYS];
/** The Military Academy comes with the first forts (mission 4); the Portus with the fleet (NAVY_KEYS). */
const TIER4 = [...TIER3, 'bridge', 'timber_yard', 'furniture_ws', 'farm_olive', 'oil_ws', 'farm_pig', 'dock', 'farm_flax', 'linen_ws', 'clothing_ws',
  'iron_mine', 'weapons_ws', 'fletcher_ws', 'barracks', 'fort_legion', 'fort_archer', 'military_academy', 'tower', 'wall', 'shipyard', 'wharf', ...NAVY_KEYS];
/**
 * Steps 5 and 6: every building and tool but the hippodrome and its chariot
 * maker, which come with step 7, the first whose homes can reach the
 * Imperial Palatium (it needs the hippodrome's shows; earlier the Circus
 * would only make the missions easier). From step 7 every province has it.
 */
const HIPPODROME_KEYS = ['hippodrome', 'hippodrome_part', 'chariot_maker'];
/** Every building and tool, as a list (for `'all'` with some taken out). */
const ALL_KEYS = [...Object.keys(TOOLS), ...Object.keys(BUILDINGS)];
const ALL_BUT_HIPPODROME = ALL_KEYS.filter((k) => !HIPPODROME_KEYS.includes(k));
/** Mission 6's desert has no water a ship can sail: no fleet there (a test holds every mission's fleet to its water). */
const ALL_BUT_HIPPODROME_AND_NAVY = ALL_BUT_HIPPODROME.filter((k) => !NAVY_KEYS.includes(k));

/*
 * Campaign branches: from step 3 on each step offers two provinces at the
 * same rank, one peaceful and one military, as the original's career did
 * from its third rank. The military one has raids early, forts a step
 * sooner and Caesar's calls for troops; the peaceful one has no raids, no
 * army and higher culture, prosperity and favor goals. The iron mine, the
 * weaponsmith and the fletcher are industry, not army: their goods sell, so
 * the peaceful provinces keep them.
 */
/** The army's buildings: forts, their barracks and academy, towers and walls (the fleet is NAVY_KEYS). */
export const ARMY_KEYS = Object.freeze(['barracks', 'fort_legion', 'fort_archer', 'fort_cavalry', 'military_academy', 'tower', 'wall']);
const withoutArmy = (keys) => keys.filter((k) => !ARMY_KEYS.includes(k) && !NAVY_KEYS.includes(k));
/**
 * Firmum (step 3, military): mission 3's buildings and legionaries to hold
 * the hill. Archers (timber and the fletcher), cavalry and the fleet wait for
 * step 4; the Campus comes with the first forts, as it always has.
 */
const FIRMUM = [...TIER3, 'iron_mine', 'weapons_ws', 'barracks', 'fort_legion', 'military_academy', 'tower', 'wall'];

export const SCENARIOS = Object.freeze([
  {
    id: 'c1', step: 1, name: 'Novum Castrum', title: 'First Foundations',
    intro: 'The Senate has granted you a patch of riverside land and a handful of settlers. Lay out roads, give families a place to live, keep them fed and keep the fires down. Grow a town, bring the gods to its streets and keep the peace to prove you can govern.',
    map: { size: 64, type: 'river', seed: 'novum-castrum' },
    funds: 6000, startYear: -280,
    goals: { population: 300, culture: 15, prosperity: 0, peace: 35, favor: 0 },
    paceYears: 1.25,
    rank: 0, // Citizen (data/ranks.js)
    unlocks: BASIC, partners: [], requests: false, crime: false, disease: false, majorWrath: false,
    hints: [
      'Mark housing plots (Area) next to the Imperial road, or any road (Via) joined to it. Settlers arrive from the map edge.',
      'Place a Puteus (Well) within 2 tiles of homes so tents can become Family Tents.',
      'A Seges (Wheat Farm) on meadow, the yellow-green land, feeds a Granarium (Granary); a Macellum (Market) sends vendors to sell food to homes.',
      'An Excubitorium (Prefecture) and a Collegium Fabrum (Engineer\'s Post) keep fires and collapses away. Put them near your homes.',
      'The Forum sends tax collectors. Homes they have not visited pay nothing!',
      `Culture here comes from the temples: every home a priest visits counts. Peace grows a point a month while the city is content (a mood of ${CONFIG.PEACE_MOOD} or more): fed, housed, at work and not overtaxed.`,
      'Click any building for details. Homes tell you exactly what they need to grow.',
      `This land gives little work: a town of about 300 people fills its jobs. More homes than that only add idle hands, and above ${CONFIG.UNEMPLOYMENT_MOOD_FREE * 100}% unemployment the mood falls and peace stops growing. The Labor advisor shows how many are out of work.`,
    ],
  },
  {
    id: 'c2', step: 2, name: 'Aquae Clarae', title: 'Clear Waters',
    intro: 'A lakeside town needs clean water and a little culture. Build reservoirs by the lakes, run aqueducts, and give citizens fountains, schools and a stage.',
    map: { size: 96, type: 'lakes', seed: 'aquae-clarae' },
    funds: 7000, startYear: -270,
    goals: { population: 450, culture: 35, prosperity: 20, peace: 45, favor: 0 },
    paceYears: 2.1,
    rank: 1, // Clerk (data/ranks.js)
    unlocks: TIER2, partners: [], requests: false, crime: false, disease: false, majorWrath: false,
    hints: [
      'A Castellum Aquae (Reservoir) placed next to water fills up. A Lacus (Fountain) inside its piped area (10 tiles) supplies homes within 4 tiles.',
      'An Aquaeductus (Aqueduct) connects a full reservoir to other reservoirs farther inland.',
      'Cottages need a fountain; above them homes want entertainment, then a school. A Theatrum (Theater) needs actors: build a Grex (Actor Troupe) nearby.',
      'Prosperity grows with better homes, a profit, work for everyone and fair wages.',
      'Work is still scarce here: about 450 people fill the jobs a sensible town has. Build homes for the people your buildings can employ, not more.',
    ],
  },
  {
    id: 'c3', step: 3, track: 'peaceful', name: 'Figlina', title: 'Clay and Commerce',
    intro: 'The plains of Figlina are rich in clay. Build an industry, fill warehouses and open your first trade route. Prosperity is now expected of you.',
    map: { size: 112, type: 'plains', seed: 'figlina' },
    funds: 7000, startYear: -255,
    goals: { population: 950, culture: 45, prosperity: 30, peace: 50, favor: 0 },
    paceYears: 2.5,
    rank: 2, // Engineer (data/ranks.js)
    unlocks: TIER3, partners: ['tarraco', 'aquileia'], requests: true,
    hints: [
      'A Cretifodina (Clay Pit) must be near water. A Figlina (Potter) turns clay into pottery, which Merchant Houses and every home above them need, with Balneae (Baths) nearby.',
      'A Horreum (Warehouse) stores goods. Caravans only trade with warehouses.',
      'Open trade routes in the Trade advisor, then mark goods for import or export.',
      'Trade is work: what your partners buy keeps farms, clay pits and potters staffed. Let the town grow as its jobs do.',
      'A Domus wants more shows than a theater gives: add an Amphitheatrum (Amphitheater), with gladiators from a Ludus Gladiatorius (Gladiator School), and actors too for its best shows.',
    ],
  },
  {
    id: 'c3m', step: 3, track: 'military', name: 'Firmum', title: 'The Picene Frontier',
    intro: 'Rome planted the Latin colony of Firmum on a hilltop above the Picene country in 264 BC, once the Picenes were beaten, and the tribes in the valleys have not forgotten the war. Dig iron from the hills, arm a legion and hold the town: whoever holds Firmum holds the road along the Adriatic.',
    // A seed with no water reaching the map's edge: the Picenes come over
    // the hills, never by ship, so the province needs no fleet.
    map: { size: 112, type: 'lakes', seed: 'firmum-picenum' },
    funds: 7000, startYear: -255,
    goals: { population: 1100, culture: 35, prosperity: 20, peace: 48, favor: 0 },
    paceYears: 2.3,
    rank: 2, // Engineer, as Figlina (data/ranks.js)
    unlocks: FIRMUM, partners: ['aquileia', 'capua'], requests: true,
    // The earliest raids of the campaign, and the smallest: two years in
    // (18 months on Insane), never before the town has 300 people. Time for
    // an iron mine, a weaponsmith, a barracks and one fort.
    military: { first: 24, interval: [16, 24], base: 3 },
    distantBattles: [{ year: 2, city: 'ariminum', enemy: 12 }],
    hints: [
      'Raiders come down from the hills within two years. A Ferraria (Iron Mine) by the rocks and a Fabrica (Weaponsmith) arm the legionaries a Tirocinium (Barracks) trains for a Castra (Legion Fort).',
      'Word of a raid comes about six months before it and scouts report its size and road three months before, and the Empire map shows the warband and the edge it will come in by. Build Turres (Towers) and a Murus (Wall) across that way in.',
      'A Campus (Military Academy) trains your legionaries to fight harder.',
      'Capua buys iron: what the mine digs beyond the weaponsmith\'s needs is trade, and work.',
      'A Domus wants more shows than a theater gives: add an Amphitheatrum (Amphitheater), with gladiators from a Ludus Gladiatorius (Gladiator School).',
    ],
  },
  {
    id: 'c4', step: 4, track: 'military', name: 'Pons Aelius', title: 'The River Crossing',
    intro: 'A great river divides this province. Bridge it, harvest its forests and olive groves, and entertain a growing people with gladiatorial games.',
    map: { size: 128, type: 'river', seed: 'pons-aelius' },
    funds: 8000, startYear: -240,
    goals: { population: 2700, culture: 50, prosperity: 40, peace: 55, favor: 0 },
    paceYears: 2.9,
    rank: 3, // Architect (data/ranks.js)
    unlocks: TIER4, partners: ['tarraco', 'massilia', 'lugdunum'], requests: true,
    military: { first: 60, interval: [30, 40], base: 4 },
    distantBattles: [{ year: 3, city: 'placentia', enemy: 16 }],
    hints: [
      'A Pons (Bridge) must start and end on land and run straight across water.',
      'Massilia trades by sea: build an Emporium (Trade Dock) on the river bank. Tarraco and Lugdunum send caravans along the Imperial road.',
      'Apartment Houses need furniture (an Officina Lignaria, the carpenter, from timber); Tenements, the first big homes, also need oil, a barber, and both a school and a library.',
      'Insulae also need clothing: a Linarium (Flax Field) on meadow, a Textrinum (Linen Weaver) and a Taberna Vestiaria (Clothing Maker), or linen bought from Tarraco for the Taberna Vestiaria.',
      'Raiders roam these hills. A Tirocinium (Barracks) trains soldiers for your forts: legionaries need weapons (Fabrica, the weaponsmith), archers need arrows (Officina Sagittaria, the fletcher, from timber and iron).',
    ],
  },
  {
    id: 'c4p', step: 4, track: 'peaceful', name: 'Paestum', title: 'City of Temples',
    intro: 'The Greeks of Poseidonia raised great temples on this shore long before Rome made their city the Latin colony of Paestum in 273 BC. Keep the gods content, fill the harbor with ships from Massilia and Corinthus, and make Paestum a city the Greeks would envy. No enemy threatens this shore: Rome will judge you by what you build.',
    map: { size: 128, type: 'coast', seed: 'paestum' },
    funds: 8000, startYear: -240,
    goals: { population: 2700, culture: 60, prosperity: 50, peace: 65, favor: 40 },
    paceYears: 3.75,
    rank: 3, // Architect, as Pons Aelius (data/ranks.js)
    unlocks: withoutArmy(TIER4), partners: ['capua', 'massilia', 'corinthus'], requests: true,
    hints: [
      'No raiders come to Paestum, and you may build no forts. Rome watches your favor instead: meet Caesar\'s requests and send gifts, for if his favor runs out his legions come, and there is no army here to meet them.',
      'Culture is the measure of this city: a Templum (Grand Temple) counts as two temples to its god, and schools, a Bibliotheca (Library) and shows add the rest.',
      'Corinthus sells marble and oil by sea and buys wheat, iron and clothing. Build an Emporium (Trade Dock) on the shore.',
      'Apartment Houses need furniture (an Officina Lignaria, the carpenter, from timber); Tenements also need oil, a barber, and both a school and a library; Insulae need clothing too.',
    ],
  },
  {
    id: 'c5', step: 5, track: 'military', name: 'Portus Mercatorum', title: 'Merchant Shore',
    intro: 'A coastal province with iron in its hills and vines on its slopes. Grow a wealthy city worthy of villas, and keep the Emperor happy.',
    map: { size: 128, type: 'coast', seed: 'portus-mercatorum' },
    funds: 9000, startYear: -225,
    goals: { population: 4600, culture: 60, prosperity: 50, peace: 60, favor: 55 },
    paceYears: 5.1,
    rank: 4, // Quaestor (data/ranks.js)
    unlocks: ALL_BUT_HIPPODROME, partners: ['massilia', 'lugdunum', 'carthago', 'corinthus', 'cirta', 'alexandria'], requests: true,
    military: { first: 48, interval: [22, 32], base: 6 },
    distantBattles: [{ year: 3, city: 'saguntum', enemy: 28 }],
    hints: [
      'Villas need wine, two kinds of food and two gods. Patricians do not work, but pay handsome taxes and lift prosperity.',
      'From the Insula up homes need clothing. Alexandria\'s ships bring Egyptian linen for a Taberna Vestiaria (Clothing Maker), and Corinthus buys clothing.',
      'The Emperor\'s favor drifts back toward 50: his requests, the yearly tribute and gifts raise it.',
      'Cavalry needs horses. Breed them at an Equaria (Horse Ranch) on meadow, where the herd grows over time, or import them from Cirta by sea.',
    ],
  },
  {
    id: 'c5p', step: 5, track: 'peaceful', name: 'Beneventum', title: 'The Market on the Appian Way',
    intro: 'The Samnite town of Maleventum became the Latin colony of Beneventum, the "good outcome", in 268 BC, and the Appian Way runs through it from Capua. Every caravan between Capua and the Adriatic passes here: build a market town worthy of the road, with rich homes, full warehouses and busy streets. The Samnite wars are over; the Senate expects prosperity, not victories.',
    map: { size: 128, type: 'river', seed: 'beneventum' },
    funds: 9000, startYear: -225,
    goals: { population: 3000, culture: 65, prosperity: 60, peace: 70, favor: 65 },
    paceYears: 4.2,
    rank: 4, // Quaestor, as Portus Mercatorum (data/ranks.js)
    // The river is navigable, but every partner comes by land: the colony lives by caravans.
    unlocks: withoutArmy(ALL_BUT_HIPPODROME), partners: ['capua', 'tarraco', 'aquileia', 'lugdunum'], requests: true,
    hints: [
      'Beneventum trades only by land: four caravan routes meet here. Open them in the Trade advisor and let warehouses near the Imperial road do the business.',
      'There is no army here and no raiders to fear, but Caesar\'s favor must stay high: his requests, the yearly tribute and gifts all count.',
      'Villas need wine, two kinds of food and two gods. Patricians do not work, but pay handsome taxes and lift prosperity.',
    ],
  },
  {
    id: 'c6', step: 6, track: 'military', name: 'Oasis Aurea', title: 'Sands of Gold',
    intro: 'Water is life in the desert. Only the land around the oases can feed your people. Plan every aqueduct carefully.',
    map: { size: 128, type: 'desert', seed: 'oasis-aurea' },
    funds: 10000, startYear: -210,
    goals: { population: 3500, culture: 60, prosperity: 55, peace: 70, favor: 60 },
    paceYears: 4.2,
    rank: 5, // Procurator (data/ranks.js)
    unlocks: ALL_BUT_HIPPODROME_AND_NAVY, partners: ['capua', 'aquileia', 'lugdunum', 'tarraco'], requests: true,
    military: { first: 42, interval: [20, 30], base: 6 },
    distantBattles: [{ year: 4, city: 'ariminum', enemy: 32 }],
    hints: ['No ship can reach the desert, but caravans can: import wheat from Capua if the oases cannot feed everyone.', 'Desert raiders ride fast: towers and cavalry help.'],
  },
  {
    id: 'c6p', step: 6, track: 'peaceful', name: 'Cosa', title: 'The Loyal Colony',
    intro: 'Cosa, a Latin colony of 273 BC, stands on a hill above the Etruscan coast and its lagoon. Hannibal has been in Italy for eight years, and the colonies are tired of sending men and money; when twelve of them refused, Cosa was among the eighteen that kept faith. Plant vines, send wine to Gaul and Greece from the lagoon harbor, and give Rome a colony it can count on. No enemy reaches this coast: Rome will judge you by what you build.',
    // A lake of the seed reaches the map's edge: the lagoon, open to ships.
    map: { size: 144, type: 'lakes', seed: 'cosa-portus' },
    funds: 10000, startYear: -210,
    goals: { population: 5600, culture: 70, prosperity: 65, peace: 75, favor: 70 },
    paceYears: 6.5,
    rank: 5, // Procurator, as Oasis Aurea (data/ranks.js)
    unlocks: withoutArmy(ALL_BUT_HIPPODROME), partners: ['lugdunum', 'capua', 'massilia', 'corinthus', 'alexandria'], requests: true,
    // Wine on the original's tiers: Corinthus's thirst grows in the third year.
    demand: { corinthus: { wine: 2500 }, alexandria: { wine: 1500 }, lugdunum: { wine: 1500 } },
    demandChanges: [{ year: 3, partner: 'corinthus', good: 'wine', to: 4000 }],
    hints: [
      'Wine is Cosa\'s trade: a Vinea (Vineyard) on meadow and a Cella Vinaria (Winery). Corinthus, Alexandria and the Gauls of Lugdunum buy it, and within a few years Corinthus will want more.',
      'The lagoon reaches the sea: an Emporium (Trade Dock) on its shore receives the ships of Massilia, Corinthus and Alexandria.',
      'No raiders come to Cosa, and you may build no forts. Rome watches your favor instead: meet Caesar\'s requests and send gifts, for if his favor runs out his legions come.',
      'Villas need wine, two kinds of food and two gods. Patricians do not work, but pay handsome taxes and lift prosperity: give them a quarter of their own, away from the workshops.',
    ],
  },
  {
    id: 'c7', step: 7, track: 'military', name: 'Urbs Magna', title: 'The Great City',
    intro: 'Your greatest charge yet: build a city to rival Rome itself.',
    map: { size: 160, type: 'lakes', seed: 'urbs-magna' },
    funds: 12000, startYear: -190,
    goals: { population: 5800, culture: 75, prosperity: 70, peace: 75, favor: 65 },
    paceYears: 6.8,
    rank: 6, // Aedile (data/ranks.js)
    unlocks: 'all', partners: FIRST_NINE, requests: true,
    military: { first: 36, interval: [14, 22], base: 8 },
    distantBattles: [{ year: 3, city: 'messana', enemy: 40 }, { year: 9, city: 'placentia', enemy: 52 }],
    hints: [
      'Palatia need four gods, a Medicus (Physician) and a Valetudinarium (Hospital), wine from two sources (a staffed winery and an import route) and plenty of shows.',
      'A Curia (Senate House) adds to culture and prosperity. Expect regular raids: walls with gates, towers and a mixed army keep the capital safe.',
      'The Circus (Hippodrome, one per city, 15 x 5 tiles) races chariots from a Factio (Chariot Stable): its charioteers bring 30 entertainment to the homes they pass, and every home gains a little more.',
    ],
  },
  {
    id: 'c7p', step: 7, track: 'peaceful', name: 'Copia', title: 'Plenty',
    intro: 'In 193 BC Rome planted a Latin colony on the plain where Greek Thurii stood, beside the ruins of Sybaris, and named it Copia: plenty. The richest farmland of the south is yours, and Greece and Hispania are hungry. Feed your city and theirs: here the fields are the work. No enemy threatens the plain; Rome will judge you by culture, prosperity and the Emperor\'s favor.',
    map: { size: 160, type: 'river', seed: 'copia' },
    funds: 12000, startYear: -190,
    goals: { population: 6000, culture: 77, prosperity: 73, peace: 78, favor: 70 },
    paceYears: 7.1,
    rank: 6, // Aedile, as Urbs Magna (data/ranks.js)
    unlocks: withoutArmy(ALL_KEYS), partners: ['tarraco', 'lugdunum', 'aquileia', 'capua', 'massilia', 'corinthus'], requests: true,
    // Food by the shipload and the caravan, Tarraco's wheat rising in the fourth year.
    demand: { corinthus: { wheat: 4000 }, tarraco: { wheat: 2500 }, massilia: { vegetables: 2500 }, lugdunum: { fruit: 1500 }, aquileia: { meat: 1500 } },
    demandChanges: [{ year: 4, partner: 'tarraco', good: 'wheat', to: 4000 }],
    hints: [
      'Corinthus and Tarraco buy wheat by the shipload and the caravan, Massilia vegetables, Lugdunum fruit and Aquileia meat: Copia\'s people work in the fields. Within a few years Tarraco will want more.',
      'Traders take goods only from warehouses, and carts fill the granaries first: give a Horreum (Warehouse) by the fields a Get order for wheat.',
      'The Circus (Hippodrome, one per city) comes with this province: its charioteers bring entertainment to every home they pass, and the Imperial Palatium needs its races.',
      'No raiders come to Copia, and you may build no forts. Keep Caesar\'s favor high with his requests and gifts, for if it runs out his legions come.',
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
export function sandboxScenario({ size = 96, type = 'river', seed = 'sandbox', funds = 8000, difficulty = 'normal', invasions = 'occasional', seaRaids = true, rank = SANDBOX_RANK } = {}) {
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
    seaRaids: seaRaids !== false, // some raids come by sea where ships can sail (sim/navy.js)
    difficulty,
    rank: clampRank(rank), // the governor's rank, picked in the setup (data/ranks.js)
    hints: ['Tip: press F1 for help at any time.'],
  };
}

export function findScenario(id) {
  return SCENARIOS.find((s) => s.id === id) || null;
}

// ---------------------------------------------------------------------------
// The campaign's steps. A step holds one mission, or two siblings at the
// same rank (one peaceful, one military). Code that walks the campaign asks
// these instead of taking the next mission in the list, which is a sibling
// at a split.
// ---------------------------------------------------------------------------

/** The last step of the campaign. */
export const LAST_STEP = Math.max(...SCENARIOS.map((s) => s.step));

/** The step of a campaign mission (1 to LAST_STEP), or 0 for the sandbox and unknown ids. */
export function stepOf(id) {
  return findScenario(id)?.step ?? 0;
}

/** Every mission at step `n`, in list order (the existing mission first). */
export function missionsAtStep(n) {
  return SCENARIOS.filter((s) => s.step === n);
}

/** The missions a win at `id` leads to: every mission of the next step (none after the last, or outside the campaign). */
export function nextMissions(id) {
  const n = stepOf(id);
  return n ? missionsAtStep(n + 1) : [];
}

/** The other mission at the same step, or null at a step with one mission. */
export function siblingOf(id) {
  const n = stepOf(id);
  return (n && missionsAtStep(n).find((s) => s.id !== id)) || null;
}

/**
 * Whether the campaign list opens a mission: the first step always; any
 * mission whose step before has a mission won (so both siblings open
 * together, and the player may switch tracks at every step); and a mission
 * already won. `completed` holds mission ids, so a record from before the
 * branches (['c1', 'c2', 'c3']) needs no rewrite: it opens both missions of
 * step 4, and Firmum too.
 */
export function missionOpen(s, completed = [], unlockAll = false) {
  if (!s || !s.step) return false;
  if (unlockAll || s.step === 1 || completed.includes(s.id)) return true;
  return missionsAtStep(s.step - 1).some((m) => completed.includes(m.id));
}

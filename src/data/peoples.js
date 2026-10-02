/**
 * peoples.js (data)
 * ----------------------------------------------------------------------------
 * Who raids a province. Each mission's warbands come from a real people of
 * its place and time (the third and second centuries BC): Gauls from the
 * north, Ligurians from the hills, Carthaginians with Numidian horse in the
 * south, Lusitanians in Hispania, the Cimbri and Teutones in Gaul. A people
 * brings its own kinds of warrior in its own shares, goes for its own kind
 * of target and breaks at its own losses (sim/military.js).
 *
 * People fields:
 *   name     the people, for messages and panels ("Ligurians")
 *   one      one of them ("a Ligurian" is `a ${one}`)
 *   mix      { unit type: share in percent } (data/units.js), one roll per
 *            man; null = the generic warband (sim/military.js warbandType:
 *            raiders, horsemen from 1,200 people, slingers from 700)
 *   target   what the warband makes for first (sim/military.js raidTargets):
 *              nearest  the nearest building of any kind (as before peoples)
 *              food     granaries, warehouses, markets, then farms
 *              homes    the governor's residence, then the best homes
 *              troops   forts, barracks, the academy, prefectures
 *              stores   warehouses and granaries
 *              random   one of the four above, drawn for each raid
 *            With none of them standing, any building, as before. On the
 *            way, a building beside a warrior is still struck.
 *   breaks   the warband flees once no more than this share of it is left:
 *            0.3 = it breaks after 70% losses (the generic band). The
 *            original's morale caps read as shares: mobs break sooner, the
 *            disciplined later.
 *   missilesAtWalkers  its missile men (slingers, javelineers) strike the
 *            city's people in the street when the city has fewer than
 *            WALKER_TARGET_SOLDIERS soldiers (the original's rule)
 *   desc     a line for the Military advisor
 *
 * A warband's size is scaled so that its strength (the sum of health x
 * attack over its men, sim/military.js peopleSize) matches the generic
 * band's: a people of fewer, harder men sends fewer of them, so each
 * mission's raids weigh what they did before peoples, give or take a man.
 *
 * Which people a game faces (sim/military.js peopleFor): a mission's own
 * (PEOPLE_BY_MISSION); else its site's (PEOPLE_BY_SITE); the sandbox meets
 * the generic band unless its setup asks for the province's own people
 * (scenario `raiders: 'site'`). Nothing here is saved but the people's id
 * (military.people, and each raid's `people`).
 * ----------------------------------------------------------------------------
 */

/** The people of a sandbox and of anything not listed: today's mixed band. */
export const GENERIC_PEOPLE = 'barbarians';

/** Soldiers a city needs, or missile men aim at its walkers too. */
export const WALKER_TARGET_SOLDIERS = 4;

export const PEOPLES = Object.freeze({
  barbarians: {
    name: 'Raiders', one: 'raider', mix: null, target: 'nearest', breaks: 0.3, missilesAtWalkers: false,
    desc: 'A mixed band from beyond the frontier: warriors on foot, slingers once the city is worth it, horsemen once it is rich. They burn the nearest buildings and break when 70% have fallen.',
  },
  // The Senones and their kin, who held the Adriatic coast north of Picenum.
  gauls: {
    name: 'Gauls', one: 'Gaul', mix: { swordsman: 50, axeman: 30, raider: 20 }, target: 'homes', breaks: 0.45, missilesAtWalkers: true,
    desc: 'Swordsmen and axemen from the north, with some lighter warriors. They make for the finest homes and the governor\'s house, and a fierce charge breaks when about half of them have fallen.',
  },
  // The Boii and the Insubres who came south in 225 BC and met two consular
  // armies at Telamon, on the Etruscan coast near Cosa: chariots and all.
  boii: {
    name: 'Boii and Insubres', one: 'Gaul', mix: { swordsman: 50, axeman: 25, chariot: 15, raider: 10 }, target: 'homes', breaks: 0.45, missilesAtWalkers: true,
    desc: 'A great Gaulish host from the Po: swordsmen, axemen and war chariots as fast as your cavalry. They make for the finest homes and break when about half have fallen.',
  },
  // The hill peoples between the Arno and the Alps, Rome's long war of the
  // second century BC. Light men who come for food.
  ligurians: {
    name: 'Ligurians', one: 'Ligurian', mix: { raider: 70, slinger: 30 }, target: 'food', breaks: 0.4, missilesAtWalkers: true,
    desc: 'Light hillmen with axes and slings. They come for food (granaries, warehouses, markets, farms) and slip away when 60% have fallen.',
  },
  // ...on the coast, where they were pirates too: after the stores.
  ligurians_coast: {
    name: 'Ligurians', one: 'Ligurian', mix: { raider: 60, slinger: 40 }, target: 'stores', breaks: 0.4, missilesAtWalkers: true,
    desc: 'Ligurian hillmen and pirates, many of them slingers. They make for the warehouses and granaries and slip away when 60% have fallen.',
  },
  // ...in the Apennine hills above the Via Aemilia, some with heavier arms.
  ligurians_hills: {
    name: 'Ligurians', one: 'Ligurian', mix: { raider: 60, slinger: 30, swordsman: 10 }, target: 'food', breaks: 0.4, missilesAtWalkers: true,
    desc: 'Ligurians from the hills: light men with slings, a few with swords. They come for food and slip away when 60% have fallen.',
  },
  // Hannibal's army in Apulia and Campania: Numidian horse and javelin men,
  // drilled infantry, a few elephants. They go for the army first.
  carthaginians: {
    name: 'Carthaginians', one: 'Carthaginian', mix: { javelineer: 40, horseman: 40, hoplite: 15, elephant: 5 }, target: 'troops', breaks: 0.3, missilesAtWalkers: true,
    desc: 'Numidian horsemen and javelin men, heavy foot in the Greek way and now and then a war elephant. They strike at your forts, barracks and prefectures first and hold until 70% have fallen.',
  },
  // Viriathus's people, who raided Baetica for a decade: fast, light, mounted.
  lusitanians: {
    name: 'Lusitanians', one: 'Lusitanian', mix: { raider: 50, javelineer: 30, horseman: 20 }, target: 'food', breaks: 0.4, missilesAtWalkers: true,
    desc: 'Fast raiders, javelin men and horsemen from the western hills. They come for food and melt away when 60% have fallen.',
  },
  // The Cimbri and the Teutones, who came down the Rhone in 105 to 102 BC.
  cimbri: {
    name: 'Cimbri and Teutones', one: 'Cimbrian', mix: { swordsman: 40, axeman: 30, raider: 20, horseman: 10 }, target: 'random', breaks: 0.35, missilesAtWalkers: true,
    desc: 'A whole people on the move: swordsmen, axemen, raiders and horsemen. Each warband picks its own prey (food, homes, troops or stores) and breaks when 65% have fallen.',
  },
});

/** Each military mission's people (missions not listed take their site's). */
export const PEOPLE_BY_MISSION = Object.freeze({
  c3m: 'gauls', // Firmum: the Senones' kin from the north
  c4: 'ligurians', // Pons Aelius: Rome's base against the Ligurians
  c5: 'ligurians_coast', // Portus Mercatorum: Ligurians by land and sea
  c6: 'carthaginians', // Oasis Aurea: Cannae is 70 km from Luceria
  c7: 'boii', // Urbs Magna: the Boii and Insubres of Telamon
  c8m: 'ligurians_hills', // Mutina: the Ligurian hills
  c9m: 'lusitanians', // Corduba: Viriathus
  c10m: 'cimbri', // Narbo Martius: the Cimbri and the Teutones
});

/** The people of each province site (data/sites.js): Gauls to the north, Hannibal in the south, Iberians in Hispania. */
export const PEOPLE_BY_SITE = Object.freeze({
  etruria: 'ligurians',
  castrum_novum: 'gauls',
  volsinii: 'gauls',
  figline: 'ligurians',
  firmum: 'gauls',
  paestum: 'carthaginians',
  populonia: 'ligurians_coast',
  beneventum: 'carthaginians',
  luceria: 'carthaginians',
  cosa: 'boii',
  copia: 'carthaginians',
  mutina: 'ligurians_hills',
  luna: 'ligurians_coast',
  corduba: 'lusitanians',
  carteia: 'lusitanians',
  narbo: 'cimbri',
  puteoli: 'carthaginians',
});

/** A people by id, falling back to the generic band. */
export function peopleById(id) {
  return PEOPLES[id] || PEOPLES[GENERIC_PEOPLE];
}

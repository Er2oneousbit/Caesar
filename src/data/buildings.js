/**
 * buildings.js (data)
 * ----------------------------------------------------------------------------
 * Every placeable building, plus the build-menu categories and the tile tools
 * (road, plaza, aqueduct, bridge, clear).
 *
 * Field reference:
 *   name           the building's Latin name, which every message, advisor
 *                  and panel uses (Castra, Horreum)
 *   en             its English name, shown with the Latin one in the build
 *                  menu, its tooltip and the inspect panel's title, so a new
 *                  player can always tell what a building is (fullName)
 *   desc           what it does, in English
 *   category       build menu category key (see CATEGORIES)
 *   size           square footprint in tiles (1..5)
 *   cost           construction cost in Dn
 *   workers        employees needed at full efficiency (0 = none)
 *   labor          labor category (see LABOR_CATEGORIES) used for priorities
 *   des            desirability [value, step, stepSize, range]
 *                  value at distance 1, changes by stepSize every `step` tiles,
 *                  zero beyond `range`. Negative value = unpleasant neighbor.
 *   fire, damage   risk points gained per day (0 = immune). 100 = disaster.
 *                  Immune to both: wells, fountains, reservoirs, warehouses,
 *                  the engineer's post, farms, gardens, statues and forts
 *                  (raiders, rioters and an angered Mercury, who burns the
 *                  fullest storehouse, can still destroy them).
 *   walker         roaming walker type spawned by the building
 *   spawnDays      days between walker spawns at full staff
 *   placement      extra placement rule: 'meadow' | 'nearWater' | 'nearTrees' | 'nearRock'
 *                  | 'shore' (beside navigable water: docks, the navalia, naval stations)
 *                  | 'fishingShore' (beside water with fish: shipyards, wharves)
 *   kind           behavior family (drives sim dispatch):
 *                    service | farm | raw | workshop | granary | warehouse |
 *                    market | venue | training | water | reservoir |
 *                    fountain | well | decor | hospital | house | dock |
 *                    barracks | fort | tower | shipyard | wharf | part |
 *                    navalia | station | military_academy | portus |
 *                    residence (the governor's) | arch (a triumphal arch,
 *                    built across a road)
 *   span           sections in a row along the map's x axis (the hippodrome:
 *                  3 of size x size). The first is the building itself, the
 *                  others are `part` buildings linked to it (sim/linked.js)
 *   limit          at most this many in a city (the hippodrome: 1)
 *   produces       good produced (farm/raw/workshop)
 *   consumes       raw good consumed (single-input workshops, 100 per batch)
 *   recipe         raw goods per 100-unit batch, e.g. { timber: 100, iron: 50 }.
 *                  Filled in automatically from `consumes`; list it yourself
 *                  for multi-input workshops (the Fletcher). Code reads recipe.
 *   productionDays days per 100-unit batch at full efficiency
 *   god            temple patron (temples only)
 *   templeWeight   temples it counts as toward its god's "one staffed temple
 *                  per PEOPLE_PER_TEMPLE" (default 1; a large temple 2, as the
 *                  original counted 1,500 people of coverage to a small one's 750)
 *   venue          entertainment venue type (venues/training)
 *   needsPiped     requires piped water from a reservoir to operate
 *   inputs         goods a building accepts by cart for its own use
 *                  (barracks: weapons, arrows, horses; navalia: timber, iron,
 *                  linen), with inputCap units each
 *   unit           soldier type a fort garrisons (see data/units.js)
 *   hp             hit points against raiders (default: by size)
 *                  Forts never burn or decay (fire/damage 0): only raiders
 *                  can destroy them, and then their garrison disbands.
 * ----------------------------------------------------------------------------
 */

/** Build menu categories, in display order. */
export const CATEGORIES = Object.freeze([
  { key: 'housing', name: 'Housing', icon: '🏠', hotkey: 'H' },
  { key: 'roads', name: 'Roads', icon: '🛣', hotkey: 'R' },
  { key: 'water', name: 'Water', icon: '💧' },
  { key: 'health', name: 'Health', icon: '⚕' },
  { key: 'religion', name: 'Temples', icon: '🏛' },
  { key: 'education', name: 'Education', icon: '📜' },
  { key: 'entertainment', name: 'Entertainment', icon: '🎭' },
  { key: 'government', name: 'Government & Decor', icon: '⚖' },
  { key: 'engineering', name: 'Engineering', icon: '🔨' },
  { key: 'security', name: 'Security', icon: '🔥' },
  { key: 'farms', name: 'Farms', icon: '🌾' },
  { key: 'industry', name: 'Industry', icon: '⚒' },
  { key: 'commerce', name: 'Storage & Markets', icon: '📦' },
  { key: 'military', name: 'Military', icon: '⚔' },
]);

/** Labor categories (used by the labor advisor and priorities). */
export const LABOR_CATEGORIES = Object.freeze({
  industry: 'Industry & Commerce',
  food: 'Food Production',
  engineering: 'Engineering',
  water: 'Water',
  safety: 'Prefectures',
  entertainment: 'Entertainment',
  healthEdu: 'Health & Education',
  govReligion: 'Government & Religion',
  military: 'Military',
});

/**
 * Tile tools: not buildings, they edit map layers directly.
 * `drag`: 'path' draws a connected line, 'area' fills a rectangle, 'line' is a straight line.
 */
export const TOOLS = Object.freeze({
  road: { name: 'Via', en: 'Road', category: 'roads', cost: 4, drag: 'path', desc: 'Walkers only travel on roads. Most buildings need a road next to them.' },
  plaza: { name: 'Platea', en: 'Plaza', category: 'roads', cost: 15, drag: 'area', desc: 'Paves existing roads with decorative stone. Raises desirability nearby.' },
  bridge: { name: 'Pons', en: 'Bridge', category: 'roads', cost: 40, drag: 'line', desc: 'A straight road across water. Start and end on the banks.' },
  roadblock: { name: 'Claustra', en: 'Roadblock', category: 'roads', cost: 12, drag: 'single', desc: 'Placed on a road: walkers roaming the streets turn back here, so a building serves only the homes you mean it to. Carts, market buyers, settlers and anyone else heading somewhere pass. Click it to let some kinds of walker through.' },
  aqueduct: { name: 'Aquaeductus', en: 'Aqueduct', category: 'water', cost: 8, drag: 'path', desc: 'Carries water between reservoirs. Can cross roads.' },
  wall: { name: 'Murus', en: 'Wall', category: 'military', cost: 12, gateCost: 40, drag: 'path', desc: 'Stone walls that raiders must break through. Drag a wall across a road to build a gate that citizens (not raiders) can pass.' },
  clear: { name: 'Clear Land', category: null, cost: 0, drag: 'area', desc: 'Demolish buildings, roads, roadblocks, walls and aqueducts, or clear trees and rubble.' },
});

/** Units of each raw material a single-input workshop uses per batch (= one cart). */
const BATCH = 100;

// Helper to keep the table compact. Every building gets sane defaults.
function B(def) {
  const out = {
    size: 1,
    cost: 10,
    workers: 0,
    labor: null,
    des: [0, 1, 0, 0],
    fire: 1,
    damage: 1,
    walker: null,
    spawnDays: 4,
    placement: null,
    kind: 'service',
    needsRoad: true,
    ...def,
  };
  // Every workshop gets a recipe so the sim only has one code path.
  if (out.kind === 'workshop' && !out.recipe) out.recipe = { [out.consumes]: BATCH };
  if (out.recipe) out.recipe = Object.freeze({ ...out.recipe });
  return Object.freeze(out);
}

/** The five gods' large temples (`temple_large_<god>`), in the gods' order. */
function largeTemples() {
  const out = {};
  // `of`: the god's name in the Latin genitive ("Templum Cereris", of Ceres).
  for (const [god, name, of, what] of [
    ['ceres', 'Ceres', 'Cereris', 'the goddess of the harvest'],
    ['neptune', 'Neptune', 'Neptuni', 'the god of the waters'],
    ['mercury', 'Mercury', 'Mercurii', 'the god of trade and travellers'],
    ['mars', 'Mars', 'Martis', 'the god of war and protection'],
    ['venus', 'Venus', 'Veneris', 'the goddess of love and beauty'],
  ]) {
    out[`temple_large_${god}`] = B({
      name: `Templum ${of}`, en: `Grand Temple of ${name}`, category: 'religion', cost: 150, size: 3, workers: 5, labor: 'govReligion',
      des: [14, 2, -2, 5], walker: 'priest', god, spawnDays: 4, fire: 0.6, templeWeight: 2,
      desc: `A grand temple to ${what}. Its priests walk the same rounds as a small temple's, but ${name} counts it as two temples, and it is a fine neighbor.`,
    });
  }
  return out;
}

export const BUILDINGS = Object.freeze({
  // --- Housing -------------------------------------------------------------
  house: B({
    name: 'Area', en: 'Housing Plot', category: 'housing', kind: 'house', cost: 10, size: 1,
    desc: 'Marks land for settlers. Homes grow as you provide water, food, religion and more.',
    fire: 0, damage: 0,
  }),

  // --- Water ---------------------------------------------------------------
  // Wells, fountains and reservoirs never burn or collapse, as in the
  // original. Wells and reservoirs need no road, so an engineer could not
  // always reach one; when they could wear out, a reservoir left off his
  // rounds fell unseen and dried every fountain and bath it fed.
  well: B({
    name: 'Puteus', en: 'Well', category: 'water', kind: 'well', cost: 5, size: 1, workers: 0,
    des: [-1, 1, 1, 1], fire: 0, damage: 0, needsRoad: false,
    desc: 'Basic ground water for homes within 2 tiles. Enough for the humblest dwellings.',
  }),
  fountain: B({
    name: 'Lacus', en: 'Fountain', category: 'water', kind: 'fountain', cost: 15, size: 1, workers: 4, labor: 'water',
    des: [1, 1, -1, 1], fire: 0, damage: 0, needsPiped: true,
    desc: 'Clean running water for homes within 4 tiles. Must sit inside a reservoir\'s piped area.',
  }),
  reservoir: B({
    name: 'Castellum Aquae', en: 'Reservoir', category: 'water', kind: 'reservoir', cost: 80, size: 3, workers: 0,
    des: [-2, 1, 1, 2], fire: 0, damage: 0, needsRoad: false,
    desc: 'Fills when built next to water or linked by aqueduct to a full reservoir. Pipes water 10 tiles around.',
  }),

  // --- Health --------------------------------------------------------------
  barber: B({
    name: 'Tonstrina', en: 'Barber', category: 'health', cost: 25, size: 1, workers: 2, labor: 'healthEdu',
    des: [2, 1, -1, 2], walker: 'barber', spawnDays: 4,
    desc: 'A shave and the latest gossip. Homes need a barber from Tenement up.',
  }),
  clinic: B({
    name: 'Medicus', en: 'Physician', category: 'health', cost: 30, size: 1, workers: 5, labor: 'healthEdu',
    des: [0, 1, 0, 0], walker: 'physician', spawnDays: 4,
    desc: 'A physician visits homes to treat the sick. Health care for Apartment Houses and up (a hospital also counts).',
  }),
  baths: B({
    name: 'Balneae', en: 'Baths', category: 'health', cost: 55, size: 2, workers: 10, labor: 'healthEdu',
    des: [4, 1, -1, 3], walker: 'bather', spawnDays: 4, needsPiped: true,
    desc: 'Public baths. They need piped water from a Castellum Aquae (Reservoir). Homes need the baths from Merchant House up.',
  }),
  hospital: B({
    name: 'Valetudinarium', en: 'Hospital', category: 'health', kind: 'hospital', cost: 300, size: 3, workers: 30, labor: 'healthEdu',
    des: [-1, 2, 1, 2], fire: 1, damage: 1,
    desc: 'A hospital serving every home within 12 tiles. With a Medicus as well, it is the full health care Garden Villas and up need.',
  }),

  // --- Religion ------------------------------------------------------------
  // The original's five gods, in its order. The temples differ only in their
  // god: the same cost, workers, desirability and priest round, as in the
  // original.
  temple_ceres: B({
    name: 'Aedes Cereris', en: 'Temple of Ceres', category: 'religion', cost: 50, size: 2, workers: 2, labor: 'govReligion',
    des: [4, 2, -1, 6], walker: 'priest', god: 'ceres', spawnDays: 4, fire: 0.6,
    desc: 'Honors the goddess of the harvest. Priests bring religion to nearby homes.',
  }),
  temple_neptune: B({
    name: 'Aedes Neptuni', en: 'Temple of Neptune', category: 'religion', cost: 50, size: 2, workers: 2, labor: 'govReligion',
    des: [4, 2, -1, 6], walker: 'priest', god: 'neptune', spawnDays: 4, fire: 0.6,
    desc: 'Honors the god of the waters.',
  }),
  temple_mercury: B({
    name: 'Aedes Mercurii', en: 'Temple of Mercury', category: 'religion', cost: 50, size: 2, workers: 2, labor: 'govReligion',
    des: [4, 2, -1, 6], walker: 'priest', god: 'mercury', spawnDays: 4, fire: 0.6,
    desc: 'Honors the god of trade and travellers, who watches over granaries and warehouses.',
  }),
  temple_mars: B({
    name: 'Aedes Martis', en: 'Temple of Mars', category: 'religion', cost: 50, size: 2, workers: 2, labor: 'govReligion',
    des: [4, 2, -1, 6], walker: 'priest', god: 'mars', spawnDays: 4, fire: 0.6,
    desc: 'Honors the god of war and protection.',
  }),
  temple_venus: B({
    name: 'Aedes Veneris', en: 'Temple of Venus', category: 'religion', cost: 50, size: 2, workers: 2, labor: 'govReligion',
    des: [4, 2, -1, 6], walker: 'priest', god: 'venus', spawnDays: 4, fire: 0.6,
    desc: 'Honors the goddess of love and beauty, who keeps the people content.',
  }),
  // Large temples (3x3), one per god as in the original: the same priest on
  // the same round as a small temple, so no farther reach on the ground. What
  // the size buys is coverage (a large temple counts as two temples toward its
  // god, sim/religion.js) and desirability. They burn and collapse like the
  // small ones, as in the original (Augustus makes them fire-proof).
  ...largeTemples(),
  oracle: B({
    name: 'Oraculum', en: 'Oracle', category: 'religion', kind: 'decor', cost: 200, size: 2, workers: 0,
    des: [8, 1, -2, 6], fire: 0, damage: 0.5,
    desc: 'A sacred shrine that pleases every god a little each month.',
  }),

  // --- Education -----------------------------------------------------------
  school: B({
    name: 'Ludus Litterarius', en: 'School', category: 'education', cost: 50, size: 2, workers: 10, labor: 'healthEdu',
    des: [-2, 1, 1, 2], walker: 'teacher', spawnDays: 4,
    desc: 'Teachers visit homes with children. First level of education.',
  }),
  library: B({
    name: 'Bibliotheca', en: 'Library', category: 'education', cost: 80, size: 2, workers: 20, labor: 'healthEdu',
    des: [4, 1, -1, 4], walker: 'librarian', spawnDays: 4,
    desc: 'Scrolls for the literate. Second level of education.',
  }),
  academy: B({
    name: 'Academia', en: 'Academy', category: 'education', cost: 150, size: 3, workers: 30, labor: 'healthEdu',
    des: [4, 2, -1, 6], walker: 'scholar', spawnDays: 5,
    desc: 'Higher learning for the elite. Third level of education.',
  }),

  // --- Entertainment -------------------------------------------------------
  theater: B({
    name: 'Theatrum', en: 'Theater', category: 'entertainment', kind: 'venue', venue: 'theater', cost: 50, size: 2, workers: 8, labor: 'entertainment',
    des: [4, 1, -1, 4], walker: 'entertainer', spawnDays: 4,
    desc: 'Stages plays when actors arrive from a Grex (Actor Troupe). Worth 10 entertainment to the homes its entertainers pass.',
  }),
  amphitheater: B({
    name: 'Amphitheatrum', en: 'Amphitheater', category: 'entertainment', kind: 'venue', venue: 'amphitheater', cost: 110, size: 3, workers: 12, labor: 'entertainment',
    des: [4, 1, -1, 4], walker: 'entertainer', spawnDays: 4,
    desc: 'Hosts gladiator bouts (from a Ludus Gladiatorius) and plays (from a Grex). Worth 15 entertainment, 20 while it has both.',
  }),
  colosseum: B({
    name: 'Arena', en: 'Great Arena', category: 'entertainment', kind: 'venue', venue: 'colosseum', cost: 400, size: 5, workers: 25, labor: 'entertainment',
    des: [-3, 2, 1, 6], walker: 'entertainer', spawnDays: 4,
    desc: 'Grand spectacles with gladiators (Ludus Gladiatorius) and beasts (Vivarium). Worth 20 entertainment, 30 while it has both.',
  }),
  actor_troupe: B({
    name: 'Grex', en: 'Actor Troupe', category: 'entertainment', kind: 'training', venue: 'theater', cost: 50, size: 2, workers: 5, labor: 'entertainment',
    des: [2, 1, -1, 2], spawnDays: 6,
    desc: 'Trains actors who walk to theaters to perform.',
  }),
  gladiator_school: B({
    name: 'Ludus Gladiatorius', en: 'Gladiator School', category: 'entertainment', kind: 'training', venue: 'amphitheater', cost: 75, size: 3, workers: 8, labor: 'entertainment',
    des: [-3, 1, 1, 3], spawnDays: 7,
    desc: 'Trains gladiators for the Amphitheatrum and the Arena.',
  }),
  menagerie: B({
    name: 'Vivarium', en: 'Menagerie', category: 'entertainment', kind: 'training', venue: 'colosseum', cost: 75, size: 3, workers: 8, labor: 'entertainment',
    des: [-4, 1, 1, 3], spawnDays: 8,
    desc: 'Keeps exotic beasts for the games at the Arena (Great Arena).',
  }),
  // The hippodrome: 15 x 5 tiles, three 5 x 5 sections in a row (the first is
  // the hippodrome itself, the other two are hippodrome_part). The original's
  // 3,500 Dn and 150 staff scaled as Colonia scaled the colosseum (1,500 to
  // 400, 100 to 25). Fire and collapse are checked once, for the whole.
  hippodrome: B({
    name: 'Circus', en: 'Hippodrome', category: 'entertainment', kind: 'venue', venue: 'hippodrome', cost: 900, size: 5, span: 3, limit: 1, workers: 40, labor: 'entertainment',
    des: [-3, 2, 1, 6], walker: 'charioteer', spawnDays: 8,
    desc: 'Chariot races: 15 x 5 tiles, one per city. While races run (a Factio sends the teams), its charioteer gives the homes he passes 30 entertainment, its seats hold the whole city (up to 6 more for every home) and prosperity rises a little.',
  }),
  hippodrome_part: B({
    name: 'Circus', en: 'Hippodrome', category: null, kind: 'part', cost: 0, size: 5, workers: 0, needsRoad: false,
    des: [-3, 2, 1, 6], fire: 0, damage: 0,
    desc: 'Part of the hippodrome\'s track.',
  }),
  chariot_maker: B({
    name: 'Factio', en: 'Chariot Stable', category: 'entertainment', kind: 'training', venue: 'hippodrome', cost: 75, size: 3, workers: 10, labor: 'entertainment',
    des: [-3, 1, 1, 3], spawnDays: 8,
    desc: 'Builds racing chariots and trains the teams that race at the hippodrome. One keeps the races going.',
  }),

  // --- Government & decoration --------------------------------------------
  forum: B({
    name: 'Forum', en: 'Forum', category: 'government', cost: 75, size: 2, workers: 6, labor: 'govReligion',
    des: [4, 2, -1, 6], walker: 'taxman', spawnDays: 4,
    desc: 'Tax collectors register households. Only registered homes pay taxes.',
  }),
  senate: B({
    name: 'Curia', en: 'Senate House', category: 'government', cost: 400, size: 4, workers: 30, labor: 'govReligion',
    des: [8, 2, -2, 8], walker: 'taxman', spawnDays: 3,
    desc: 'The seat of local government. Collects taxes and boosts every rating.',
  }),
  // The governor's residences (sim/governor.js): decor, one at a time, and
  // what rioters (and Caesar's legions) go for first. The original's costs
  // and desirability; no workers, no road. Stone and well kept, so slower to
  // burn or crack than a temple, but not immune as statues are.
  governor_house: B({
    name: 'Praetorium', en: 'Governor\'s House', category: 'government', kind: 'residence', cost: 150, size: 3, needsRoad: false,
    des: [12, 2, -2, 3], fire: 0.5, damage: 0.5,
    desc: 'Your own home in the province. Raises desirability nearby. Only one residence may stand at a time.',
  }),
  governor_villa: B({
    name: 'Praetorium Maius', en: 'Governor\'s Villa', category: 'government', kind: 'residence', cost: 400, size: 4, needsRoad: false,
    des: [20, 2, -3, 4], fire: 0.5, damage: 0.5,
    desc: 'A villa befitting a governor, with a colonnaded garden. Raises desirability over a wide area. Only one residence may stand at a time.',
  }),
  governor_palace: B({
    name: 'Regia', en: 'Governor\'s Palace', category: 'government', kind: 'residence', cost: 750, size: 5, needsRoad: false,
    des: [28, 2, -4, 5], fire: 0.5, damage: 0.5,
    desc: 'A marble palace, among the most desirable buildings in the province. Only one residence may stand at a time.',
  }),
  garden: B({
    name: 'Viridarium', en: 'Garden', category: 'government', kind: 'decor', cost: 12, size: 1, needsRoad: false,
    des: [3, 1, -1, 3], fire: 0, damage: 0,
    desc: 'A little green. Raises desirability nearby.',
  }),
  statue_small: B({
    name: 'Signum', en: 'Small Statue', category: 'government', kind: 'decor', cost: 15, size: 1, needsRoad: false,
    des: [3, 1, -1, 3], fire: 0, damage: 0,
    desc: 'A modest monument. Raises desirability.',
  }),
  statue_medium: B({
    name: 'Statua', en: 'Statue', category: 'government', kind: 'decor', cost: 60, size: 2, needsRoad: false,
    des: [10, 1, -2, 5], fire: 0, damage: 0,
    desc: 'An impressive monument. Raises desirability a lot.',
  }),
  statue_large: B({
    name: 'Colossus', en: 'Grand Statue', category: 'government', kind: 'decor', cost: 160, size: 3, needsRoad: false,
    des: [14, 2, -2, 7], fire: 0, damage: 0,
    desc: 'A towering tribute. Raises desirability across a wide area.',
  }),
  // The original's reward for a distant battle won (sim/battle.js): free, one
  // for each victory, built across a straight road (the road runs on through
  // its middle, sim/construction.js checkArch). Desirability rings of 18, 18,
  // 15, 15, 12: the falling reading of the original's numbers, whose step
  // was printed with a rising sign no other monument has.
  triumphal_arch: B({
    name: 'Fornix', en: 'Triumphal Arch', category: 'government', kind: 'arch', cost: 0, size: 3, needsRoad: false,
    des: [18, 2, -3, 5], fire: 0, damage: 0, hp: 1200,
    desc: 'Granted by Caesar for a distant battle won: one arch for each victory, at no cost. Build it across a straight road, which runs on under it. Raises desirability over a wide area. A lost arch may be built again.',
  }),

  // --- Engineering & security --------------------------------------------
  engineer_post: B({
    name: 'Collegium Fabrum', en: 'Engineer\'s Post', category: 'engineering', cost: 30, size: 1, workers: 5, labor: 'engineering',
    // Never burns or collapses, as in the original: its engineers keep their
    // own post in repair, and a post that fell would take its cover with it.
    des: [0, 1, 0, 0], walker: 'engineer', spawnDays: 3, fire: 0, damage: 0,
    desc: 'Engineers inspect buildings and prevent collapses. The post itself never burns or collapses on its own.',
  }),
  prefecture: B({
    name: 'Excubitorium', en: 'Prefecture', category: 'security', cost: 30, size: 1, workers: 6, labor: 'safety',
    des: [-2, 1, 1, 2], walker: 'prefect', spawnDays: 3, fire: 0,
    desc: 'Prefects reduce fire risk and rush to fight fires.',
  }),

  // --- Farms ---------------------------------------------------------------
  farm_wheat: B({
    name: 'Seges', en: 'Wheat Farm', category: 'farms', kind: 'farm', produces: 'wheat', cost: 40, size: 3, workers: 10, labor: 'food',
    des: [-2, 1, 1, 2], fire: 0, damage: 0, placement: 'meadow', productionDays: 20,
    desc: 'Grows wheat on meadow land. Output scales with the share of meadow under it.',
  }),
  farm_veg: B({
    name: 'Hortus', en: 'Vegetable Farm', category: 'farms', kind: 'farm', produces: 'vegetables', cost: 40, size: 3, workers: 10, labor: 'food',
    des: [-2, 1, 1, 2], fire: 0, damage: 0, placement: 'meadow', productionDays: 22,
    desc: 'Grows vegetables on meadow land.',
  }),
  farm_fruit: B({
    name: 'Pomarium', en: 'Orchard', category: 'farms', kind: 'farm', produces: 'fruit', cost: 40, size: 3, workers: 10, labor: 'food',
    des: [-2, 1, 1, 2], fire: 0, damage: 0, placement: 'meadow', productionDays: 24,
    desc: 'Grows fruit on meadow land.',
  }),
  farm_pig: B({
    name: 'Hara', en: 'Pig Farm', category: 'farms', kind: 'farm', produces: 'meat', cost: 40, size: 3, workers: 10, labor: 'food',
    des: [-3, 1, 1, 3], fire: 0, damage: 0, placement: 'meadow', productionDays: 26,
    desc: 'Raises pigs for meat on meadow land.',
  }),
  farm_olive: B({
    name: 'Olivetum', en: 'Olive Grove', category: 'farms', kind: 'farm', produces: 'olives', cost: 40, size: 3, workers: 10, labor: 'industry',
    des: [-2, 1, 1, 2], fire: 0, damage: 0, placement: 'meadow', productionDays: 24,
    desc: 'Grows olives for oil presses.',
  }),
  farm_vine: B({
    name: 'Vinea', en: 'Vineyard', category: 'farms', kind: 'farm', produces: 'grapes', cost: 40, size: 3, workers: 10, labor: 'industry',
    des: [-2, 1, 1, 2], fire: 0, damage: 0, placement: 'meadow', productionDays: 24,
    desc: 'Grows grapes for wineries.',
  }),
  // The cloth industry (not in the original). A flax field is a crop farm like
  // the olive grove and the vineyard: the same cost, staff and pace, resting
  // in an Insane winter like every farm.
  farm_flax: B({
    name: 'Linarium', en: 'Flax Field', category: 'farms', kind: 'farm', produces: 'flax', cost: 40, size: 3, workers: 10, labor: 'industry',
    des: [-2, 1, 1, 2], fire: 0, damage: 0, placement: 'meadow', productionDays: 24,
    desc: 'Grows flax on meadow land for a Textrinum (Linen Weaver).',
  }),

  // --- Raw materials -------------------------------------------------------
  clay_pit: B({
    name: 'Cretifodina', en: 'Clay Pit', category: 'industry', kind: 'raw', produces: 'clay', cost: 40, size: 2, workers: 8, labor: 'industry',
    des: [-3, 1, 1, 3], fire: 0.8, damage: 1.5, placement: 'nearWater', productionDays: 20,
    desc: 'Digs clay. Must be within 2 tiles of water.',
  }),
  timber_yard: B({
    name: 'Silva Caedua', en: 'Timber Yard', category: 'industry', kind: 'raw', produces: 'timber', cost: 40, size: 2, workers: 8, labor: 'industry',
    // Burns no faster than it collapses, like the workshops (it was fire 2).
    des: [-4, 1, 1, 3], fire: 1, damage: 1, placement: 'nearTrees', productionDays: 22,
    desc: 'Fells trees for timber. Must be within 2 tiles of woods: at least 4 tiles of forest (lone trees are not enough).',
  }),
  iron_mine: B({
    name: 'Ferraria', en: 'Iron Mine', category: 'industry', kind: 'raw', produces: 'iron', cost: 50, size: 2, workers: 10, labor: 'industry',
    des: [-6, 1, 1, 4], fire: 1, damage: 2.5, placement: 'nearRock', productionDays: 26,
    desc: 'Mines iron ore. Must be next to rocks.',
  }),
  marble_quarry: B({
    name: 'Lapicidina', en: 'Marble Quarry', category: 'industry', kind: 'raw', produces: 'marble', cost: 50, size: 2, workers: 10, labor: 'industry',
    des: [-6, 1, 1, 4], fire: 0.5, damage: 2.5, placement: 'nearRock', productionDays: 30,
    desc: 'Cuts marble blocks, a valuable export. Must be next to rocks.',
  }),

  // --- Workshops -----------------------------------------------------------
  // Fire and damage 1 each, so a workshop burns and collapses at the same
  // pace, as in the original. Fire rates of 1.5 to 3 made them the city's
  // main fire source, burning two or three times as often as they fell.
  pottery_ws: B({
    name: 'Figlina', en: 'Potter', category: 'industry', kind: 'workshop', produces: 'pottery', consumes: 'clay', cost: 40, size: 2, workers: 10, labor: 'industry',
    des: [-4, 1, 1, 3], fire: 1, damage: 1, productionDays: 18,
    desc: 'Turns clay into pottery.',
  }),
  furniture_ws: B({
    name: 'Officina Lignaria', en: 'Carpenter', category: 'industry', kind: 'workshop', produces: 'furniture', consumes: 'timber', cost: 40, size: 2, workers: 10, labor: 'industry',
    des: [-4, 1, 1, 3], fire: 1, damage: 1, productionDays: 20,
    desc: 'Turns timber into furniture.',
  }),
  oil_ws: B({
    name: 'Trapetum', en: 'Oil Press', category: 'industry', kind: 'workshop', produces: 'oil', consumes: 'olives', cost: 50, size: 2, workers: 10, labor: 'industry',
    des: [-4, 1, 1, 3], fire: 1, damage: 1, productionDays: 20,
    desc: 'Presses olives into oil.',
  }),
  wine_ws: B({
    name: 'Cella Vinaria', en: 'Winery', category: 'industry', kind: 'workshop', produces: 'wine', consumes: 'grapes', cost: 45, size: 2, workers: 10, labor: 'industry',
    des: [-1, 1, 1, 1], fire: 1, damage: 1, productionDays: 22,
    desc: 'Ferments grapes into wine.',
  }),
  weapons_ws: B({
    name: 'Fabrica', en: 'Weaponsmith', category: 'industry', kind: 'workshop', produces: 'weapons', consumes: 'iron', cost: 50, size: 2, workers: 10, labor: 'industry',
    des: [-4, 1, 1, 3], fire: 1, damage: 1, productionDays: 22,
    desc: 'Forges iron into weapons: legionaries need them, and they sell well abroad.',
  }),
  fletcher_ws: B({
    name: 'Officina Sagittaria', en: 'Fletcher', category: 'industry', kind: 'workshop', produces: 'arrows', recipe: { timber: 100, iron: 50 }, cost: 45, size: 2, workers: 8, labor: 'industry',
    des: [-2, 1, 1, 2], fire: 1, damage: 1, productionDays: 16,
    desc: 'Makes bows and iron-tipped arrows from timber (shafts) and iron (arrowheads): 100 timber + 50 iron per 100 arrows. Archer recruits need them at the barracks.',
  }),
  // Cloth: two workshops, each the size, staff and pace of the others. A
  // weaver's and a tailor's shop are quieter neighbors than a kiln or a forge.
  linen_ws: B({
    name: 'Textrinum', en: 'Linen Weaver', category: 'industry', kind: 'workshop', produces: 'linen', consumes: 'flax', cost: 45, size: 2, workers: 10, labor: 'industry',
    des: [-2, 1, 1, 2], fire: 1, damage: 1, productionDays: 20,
    desc: 'Spins flax and weaves it into linen on its looms. A Taberna Vestiaria (Clothing Maker) needs linen.',
  }),
  clothing_ws: B({
    name: 'Taberna Vestiaria', en: 'Clothing Maker', category: 'industry', kind: 'workshop', produces: 'clothing', consumes: 'linen', cost: 50, size: 2, workers: 10, labor: 'industry',
    des: [-1, 1, 1, 1], fire: 1, damage: 1, productionDays: 18,
    desc: 'Cuts and sews linen into tunics and cloaks. Homes need clothing from the Insula up.',
  }),

  // --- Storage & markets --------------------------------------------------
  market: B({
    name: 'Macellum', en: 'Market', category: 'commerce', kind: 'market', cost: 40, size: 2, workers: 5, labor: 'industry',
    des: [-2, 1, 1, 2], walker: 'vendor', spawnDays: 3,
    desc: 'Buyers fetch food and goods from storage; vendors sell them door to door.',
  }),
  granary: B({
    name: 'Granarium', en: 'Granary', category: 'commerce', kind: 'granary', cost: 100, size: 3, workers: 12, labor: 'food',
    des: [-4, 1, 1, 4], fire: 1, damage: 1,
    desc: 'Stores food from farms. Markets buy food here.',
  }),
  warehouse: B({
    name: 'Horreum', en: 'Warehouse', category: 'commerce', kind: 'warehouse', cost: 70, size: 3, workers: 6, labor: 'industry',
    // Never burns or collapses, as in the original (players of it know
    // "warehouses don't burn"); raiders can still wreck one.
    des: [-5, 2, 1, 4], fire: 0, damage: 0,
    desc: 'Stores raw materials and goods. Supplies workshops and trades with caravans. Never burns or collapses on its own.',
  }),
  dock: B({
    name: 'Emporium', en: 'Trade Dock', category: 'commerce', kind: 'dock', cost: 120, size: 3, workers: 10, labor: 'industry',
    des: [-6, 1, 1, 3], fire: 1.2, damage: 1, placement: 'shore',
    desc: 'Merchant ships from sea trade routes tie up here and wait while they trade. Build it on the bank of a river or sea that reaches the map edge. Up to 3 dock workers (by staffing) cart imports to storage and fetch exports from warehouses connected to the dock by road: keep one close.',
  }),

  // --- Fishing (sim/fishing.js) ---------------------------------------------
  // On the bank of water with fish (a river, the sea or a big lake, where gulls
  // circle over the fishing grounds). No inputs: a shipyard builds a boat from
  // nothing in 16 days at full staff, and keeps one spare ready.
  shipyard: B({
    name: 'Fabrica Navalis', en: 'Shipyard', category: 'industry', kind: 'shipyard', cost: 100, size: 2, workers: 10, labor: 'industry',
    des: [-6, 1, 1, 3], fire: 1, damage: 1, placement: 'fishingShore',
    desc: 'Builds fishing boats (one every 16 days at full staff) and sends each to the nearest wharf on its water that has none. Keeps one spare boat ready. Build it on the bank of a river, the sea or a big lake with fish.',
  }),
  wharf: B({
    name: 'Piscatoria', en: 'Fishing Wharf', category: 'farms', kind: 'wharf', produces: 'fish', cost: 60, size: 2, workers: 6, labor: 'food',
    des: [-6, 1, 1, 3], fire: 1, damage: 1, placement: 'fishingShore',
    desc: 'Its boat (from a Fabrica Navalis on the same water) sails to the nearest fishing ground, fishes for 4 days and brings back 100 fish; carts take the catch to a granary. Fish is a food of its own. The sea does not freeze: wharves fish all winter.',
  }),

  // --- Horses & military ----------------------------------------------------
  horse_ranch: B({
    name: 'Equaria', en: 'Horse Ranch', category: 'farms', kind: 'farm', produces: 'horses', cost: 70, size: 3, workers: 10, labor: 'military',
    des: [-3, 1, 1, 2], fire: 0, damage: 0, placement: 'meadow', productionDays: 30,
    desc: 'Breeds horses on meadow pasture for the cavalry. The breeding herd starts with 2 mares and grows over time (on Insane, not in winter), so a ranch gets more productive as it matures.',
  }),
  barracks: B({
    name: 'Tirocinium', en: 'Barracks', category: 'military', kind: 'barracks', cost: 150, size: 3, workers: 10, labor: 'military',
    des: [-6, 1, 1, 3], fire: 1, damage: 1, inputs: ['weapons', 'arrows', 'horses'], inputCap: 400,
    desc: 'Trains recruits and sends them to your forts. Legionaries need weapons, archers need arrows, cavalry need horses. Carts deliver them from workshops, ranches and warehouses.',
  }),
  // The original's Military Academy (sim/training.js): only a fully staffed
  // one trains anybody. No walker of its own, no goods, no fee.
  military_academy: B({
    name: 'Campus', en: 'Military Academy', category: 'military', kind: 'military_academy', cost: 1000, size: 3, workers: 20, labor: 'military',
    des: [-3, 1, 1, 3], fire: 1, damage: 1,
    desc: 'A drill yard where soldiers learn to fight in close order. Only a fully staffed academy trains anyone. Each new recruit marches here first (the academy nearest his fort), then on to his fort, and soldiers resting in a fort come over one at a time. Trained legionaries holding their ground take a quarter of a missile\'s damage and defend better; trained archers and cavalry defend a little better.',
  }),
  fort_legion: B({
    name: 'Castra', en: 'Legion Fort', category: 'military', kind: 'fort', unit: 'legionary', cost: 300, size: 3, workers: 8, labor: 'military',
    des: [-8, 1, 2, 4], fire: 0, damage: 0, hp: 700,
    desc: 'Home of 8 heavily armored legionaries, the backbone of your defense. Each recruit needs a set of weapons at the barracks.',
  }),
  fort_archer: B({
    name: 'Praesidium', en: 'Archer Fort', category: 'military', kind: 'fort', unit: 'archer', cost: 220, size: 3, workers: 8, labor: 'military',
    des: [-6, 1, 2, 3], fire: 0, damage: 0, hp: 600,
    desc: 'Home of 8 auxiliary archers who shoot raiders from a distance. Each recruit needs arrows from an Officina Sagittaria (Fletcher).',
  }),
  fort_cavalry: B({
    name: 'Castra Equitum', en: 'Cavalry Fort', category: 'military', kind: 'fort', unit: 'cavalry', cost: 350, size: 3, workers: 8, labor: 'military',
    des: [-8, 1, 2, 4], fire: 0, damage: 0, hp: 700,
    desc: 'Home of 8 fast horsemen who run down raiders. Every recruit needs a horse from an Equaria (Horse Ranch) or an import.',
  }),
  tower: B({
    name: 'Turris', en: 'Watchtower', category: 'military', kind: 'tower', cost: 120, size: 2, workers: 6, labor: 'military',
    des: [-3, 1, 1, 2], fire: 0, damage: 0.5, hp: 500, needsRoad: true,
    desc: 'Archers on the tower shoot any raider within 8 tiles. Pairs well with walls.',
  }),

  // --- The fleet (sim/navy.js): like the barracks and its forts -------------
  // On the bank of a river or sea that ships can sail, like a dock. Not in
  // the original, which had no war at sea.
  navalia: B({
    name: 'Navalia', en: 'Naval Dockyard', category: 'military', kind: 'navalia', cost: 400, size: 3, workers: 12, labor: 'military',
    des: [-6, 1, 1, 3], fire: 1.2, damage: 1, placement: 'shore', inputs: ['timber', 'iron', 'linen'], inputCap: 400,
    desc: 'The naval dockyard. Builds liburnians, light warships, from 300 timber, 100 iron and 100 linen each (carts bring them while a staffed Statio, a naval station, has an empty berth), and sends each to the emptiest station on its water. Build it on the bank of a river or sea that ships can sail.',
  }),
  // The Portus (Colonia's own, like the fleet): the fleet's academy, after the
  // harbor Agrippa cut near Naples to train his crews. Rome's first war fleet,
  // in 260 BC, learned to row on benches on dry land while its ships were
  // built. Only a fully staffed one trains a crew (sim/training.js).
  portus: B({
    name: 'Portus', en: 'Training Harbor', category: 'military', kind: 'portus', cost: 600, size: 3, workers: 12, labor: 'military',
    des: [-4, 1, 1, 3], fire: 1, damage: 1, placement: 'shore',
    desc: 'A sheltered training harbor where liburnian crews learn to row in time, as Rome\'s first war fleet learned on benches on dry land while its ships were built. Only a fully staffed Portus trains a crew. Each new liburnian rows past it first (the Portus nearest its station, on the same water), then to its berth, and ships resting at a station come over one at a time. A trained crew rows faster, rams harder and is harder to hit. Build it on the bank of the water a Statio (Naval Station) stands by.',
  }),
  naval_station: B({
    name: 'Statio', en: 'Naval Station', category: 'military', kind: 'station', cost: 500, size: 3, workers: 10, labor: 'military',
    des: [-6, 1, 1, 3], fire: 0, damage: 0, hp: 800, placement: 'shore',
    desc: 'A stone quay with berths for a squadron of 4 liburnians, which fight raider ships near it. Click it and press Deploy to send its squadron anywhere on its water. Build it on the bank of a river or sea that ships can sail.',
  }),
});

export const BUILDING_KEYS = Object.freeze(Object.keys(BUILDINGS));

/**
 * A gate is not a building of its own: the wall tool cuts one where it
 * crosses a road. The inspect panel names it like a building.
 */
export const GATE = Object.freeze({ name: 'Porta', en: 'Gate' });

/**
 * "Castra (Legion Fort)": a building's (or tool's, or the gate's) Latin name
 * with its English name after it, for the inspect panel's title and the
 * tooltips. Only the Latin when the two are the same word (Forum) or there
 * is no English one (Clear Land, which is a tool and stays English).
 */
export function fullName(def) {
  return def.en && def.en !== def.name ? `${def.name} (${def.en})` : def.name;
}

/**
 * Each building's Latin plural, for "3 Figlinae are waiting for clay": an
 * English "s" on a Latin name reads wrong ("Castras"). Some are the same
 * word as the singular (Aedes, Castra, Portus, Navalia, Balneae).
 */
const PLURALS = Object.freeze({
  house: 'Areae', well: 'Putei', fountain: 'Lacus', reservoir: 'Castella Aquae',
  barber: 'Tonstrinae', clinic: 'Medici', baths: 'Balneae', hospital: 'Valetudinaria',
  temple_ceres: 'Aedes Cereris', temple_neptune: 'Aedes Neptuni', temple_mercury: 'Aedes Mercurii', temple_mars: 'Aedes Martis', temple_venus: 'Aedes Veneris',
  temple_large_ceres: 'Templa Cereris', temple_large_neptune: 'Templa Neptuni', temple_large_mercury: 'Templa Mercurii', temple_large_mars: 'Templa Martis', temple_large_venus: 'Templa Veneris',
  oracle: 'Oracula', school: 'Ludi Litterarii', library: 'Bibliothecae', academy: 'Academiae',
  theater: 'Theatra', amphitheater: 'Amphitheatra', colosseum: 'Arenae', actor_troupe: 'Greges', gladiator_school: 'Ludi Gladiatorii', menagerie: 'Vivaria',
  hippodrome: 'Circi', hippodrome_part: 'Circi', chariot_maker: 'Factiones',
  forum: 'Fora', senate: 'Curiae', governor_house: 'Praetoria', governor_villa: 'Praetoria Maiora', governor_palace: 'Regiae',
  garden: 'Viridaria', statue_small: 'Signa', statue_medium: 'Statuae', statue_large: 'Colossi', triumphal_arch: 'Fornices',
  engineer_post: 'Collegia Fabrum', prefecture: 'Excubitoria',
  farm_wheat: 'Segetes', farm_veg: 'Horti', farm_fruit: 'Pomaria', farm_pig: 'Harae', farm_olive: 'Oliveta', farm_vine: 'Vineae', farm_flax: 'Linaria',
  clay_pit: 'Cretifodinae', timber_yard: 'Silvae Caeduae', iron_mine: 'Ferrariae', marble_quarry: 'Lapicidinae',
  pottery_ws: 'Figlinae', furniture_ws: 'Officinae Lignariae', oil_ws: 'Trapeta', wine_ws: 'Cellae Vinariae', weapons_ws: 'Fabricae',
  fletcher_ws: 'Officinae Sagittariae', linen_ws: 'Textrina', clothing_ws: 'Tabernae Vestiariae',
  market: 'Macella', granary: 'Granaria', warehouse: 'Horrea', dock: 'Emporia', shipyard: 'Fabricae Navales', wharf: 'Piscatoriae',
  horse_ranch: 'Equariae', barracks: 'Tirocinia', military_academy: 'Campi', fort_legion: 'Castra', fort_archer: 'Praesidia', fort_cavalry: 'Castra Equitum',
  tower: 'Turres', navalia: 'Navalia', portus: 'Portus', naval_station: 'Stationes',
});

/** A building type's Latin plural ("Horrea"); its name with an "s" for one missing from the table. */
export function pluralName(type) {
  return PLURALS[type] || `${BUILDINGS[type]?.name || type}s`;
}

/** Buildings grouped by category for the build menu. */
export function buildingsInCategory(cat) {
  const out = [];
  for (const [key, def] of Object.entries(TOOLS)) if (def.category === cat) out.push({ key, tool: true, def });
  for (const key of BUILDING_KEYS) if (BUILDINGS[key].category === cat) out.push({ key, tool: false, def: BUILDINGS[key] });
  return out;
}

/**
 * Entertainment a home gets from a venue whose entertainer passed by recently
 * (see entertainmentScore in sim/housing.js).
 */
export const VENUE_POINTS = Object.freeze({ theater: 10, amphitheater: 15, colosseum: 20, hippodrome: 30 });

/**
 * Extra points when the visiting venue had both of its kinds of show booked:
 * actors and gladiators at an amphitheater, gladiators and beasts at a colosseum.
 */
export const VENUE_BOTH_BONUS = Object.freeze({ amphitheater: 5, colosseum: 10 });

/**
 * The two kinds of show that earn a venue its VENUE_BOTH_BONUS (performer
 * types, as in `shows`). Theaters only stage plays.
 */
export const VENUE_BOTH_SHOWS = Object.freeze({ amphitheater: ['theater', 'amphitheater'], colosseum: ['amphitheater', 'colosseum'] });

/**
 * City-wide entertainment: people each working venue (staffed, shows booked)
 * can seat. How well the seats cover the population, averaged over these
 * three venue kinds (ENT_SEAT_KINDS), gives every home up to ENT_SEATS_MAX
 * points on top of its own visits.
 *
 * A working hippodrome (staffed, races booked) seats the whole city: its 100%
 * coverage is added to the sum, still divided by the three seat kinds, so it
 * is worth up to 6 more points to every home (the original's +5, rounded the
 * way Colonia's base rounds) and the base can reach ENT_BASE_MAX. A city
 * without one gets exactly what it got before the hippodrome.
 */
export const VENUE_SEATS = Object.freeze({ theater: 400, amphitheater: 900, colosseum: 2000 });
export const ENT_SEAT_KINDS = 3;
export const ENT_SEATS_MAX = 20; // the base from the three seat kinds alone
export const ENT_BASE_MAX = 26; // with a working hippodrome too
export const HIPPODROME_COVERAGE = 100; // % of the city a working hippodrome seats

/** Performer display names by venue they train for. */
export const PERFORMER_NAMES = Object.freeze({ theater: 'Actor', amphitheater: 'Gladiator', colosseum: 'Beast Tamer', hippodrome: 'Charioteer' });

/**
 * Which training buildings can supply a venue.
 * Colosseum shows need gladiators OR beasts (both = better); amphitheaters take gladiators or actors.
 */
export const VENUE_SUPPLIERS = Object.freeze({
  theater: ['theater'],
  amphitheater: ['amphitheater', 'theater'],
  colosseum: ['amphitheater', 'colosseum'],
  hippodrome: ['hippodrome'],
});

/** Every kind of show a venue can have booked (the keys of a venue's `shows`). */
export const SHOW_KINDS = Object.freeze(['theater', 'amphitheater', 'colosseum', 'hippodrome']);

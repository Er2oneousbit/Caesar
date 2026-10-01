/**
 * buildings.js (data)
 * ----------------------------------------------------------------------------
 * Every placeable building, plus the build-menu categories and the tile tools
 * (road, plaza, aqueduct, bridge, clear).
 *
 * Field reference:
 *   name, desc      display text
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
 *                  | 'shore' (beside navigable water: docks)
 *   kind           behavior family (drives sim dispatch):
 *                    service | farm | raw | workshop | granary | warehouse |
 *                    market | venue | training | water | reservoir |
 *                    fountain | well | decor | hospital | house | dock |
 *                    barracks | fort | tower
 *   produces       good produced (farm/raw/workshop)
 *   consumes       raw good consumed (single-input workshops, 100 per batch)
 *   recipe         raw goods per 100-unit batch, e.g. { timber: 100, iron: 50 }.
 *                  Filled in automatically from `consumes`; list it yourself
 *                  for multi-input workshops (the Fletcher). Code reads recipe.
 *   productionDays days per 100-unit batch at full efficiency
 *   god            temple patron (temples only)
 *   venue          entertainment venue type (venues/training)
 *   needsPiped     requires piped water from a reservoir to operate
 *   inputs         goods a building accepts by cart for its own use
 *                  (barracks: weapons, arrows, horses), with inputCap units each
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
  road: { name: 'Road', category: 'roads', cost: 4, drag: 'path', desc: 'Walkers only travel on roads. Most buildings need a road next to them.' },
  plaza: { name: 'Plaza', category: 'roads', cost: 15, drag: 'area', desc: 'Paves existing roads with decorative stone. Raises desirability nearby.' },
  bridge: { name: 'Bridge', category: 'roads', cost: 40, drag: 'line', desc: 'A straight road across water. Start and end on the banks.' },
  roadblock: { name: 'Roadblock', category: 'roads', cost: 12, drag: 'single', desc: 'Placed on a road: walkers roaming the streets turn back here, so a building serves only the homes you mean it to. Carts, market buyers, settlers and anyone else heading somewhere pass. Click it to let some kinds of walker through.' },
  aqueduct: { name: 'Aqueduct', category: 'water', cost: 8, drag: 'path', desc: 'Carries water between reservoirs. Can cross roads.' },
  wall: { name: 'Wall', category: 'military', cost: 12, gateCost: 40, drag: 'path', desc: 'Stone walls that raiders must break through. Drag a wall across a road to build a gate that citizens (not raiders) can pass.' },
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

export const BUILDINGS = Object.freeze({
  // --- Housing -------------------------------------------------------------
  house: B({
    name: 'Housing Plot', category: 'housing', kind: 'house', cost: 10, size: 1,
    desc: 'Marks land for settlers. Homes grow as you provide water, food, religion and more.',
    fire: 0, damage: 0,
  }),

  // --- Water ---------------------------------------------------------------
  // Wells, fountains and reservoirs never burn or collapse, as in the
  // original. Wells and reservoirs need no road, so an engineer could not
  // always reach one; when they could wear out, a reservoir left off his
  // rounds fell unseen and dried every fountain and bath it fed.
  well: B({
    name: 'Well', category: 'water', kind: 'well', cost: 5, size: 1, workers: 0,
    des: [-1, 1, 1, 1], fire: 0, damage: 0, needsRoad: false,
    desc: 'Basic ground water for homes within 2 tiles. Enough for the humblest dwellings.',
  }),
  fountain: B({
    name: 'Fountain', category: 'water', kind: 'fountain', cost: 15, size: 1, workers: 4, labor: 'water',
    des: [1, 1, -1, 1], fire: 0, damage: 0, needsPiped: true,
    desc: 'Clean running water for homes within 4 tiles. Must sit inside a reservoir\'s piped area.',
  }),
  reservoir: B({
    name: 'Reservoir', category: 'water', kind: 'reservoir', cost: 80, size: 3, workers: 0,
    des: [-2, 1, 1, 2], fire: 0, damage: 0, needsRoad: false,
    desc: 'Fills when built next to water or linked by aqueduct to a full reservoir. Pipes water 10 tiles around.',
  }),

  // --- Health --------------------------------------------------------------
  barber: B({
    name: 'Barber', category: 'health', cost: 25, size: 1, workers: 2, labor: 'healthEdu',
    des: [2, 1, -1, 2], walker: 'barber', spawnDays: 4,
    desc: 'A shave and the latest gossip. Homes need a barber from Tenement up.',
  }),
  clinic: B({
    name: 'Medicus', category: 'health', cost: 30, size: 1, workers: 5, labor: 'healthEdu',
    des: [0, 1, 0, 0], walker: 'physician', spawnDays: 4,
    desc: 'A physician visits homes to treat the sick. Health care for Apartment Houses and up (a hospital also counts).',
  }),
  baths: B({
    name: 'Thermae', category: 'health', cost: 55, size: 2, workers: 10, labor: 'healthEdu',
    des: [4, 1, -1, 3], walker: 'bather', spawnDays: 4, needsPiped: true,
    desc: 'Public baths. Need piped water from a reservoir. Homes need the baths from Merchant House up.',
  }),
  hospital: B({
    name: 'Valetudinarium', category: 'health', kind: 'hospital', cost: 300, size: 3, workers: 30, labor: 'healthEdu',
    des: [-1, 2, 1, 2], fire: 1, damage: 1,
    desc: 'A hospital serving every home within 12 tiles. With a medicus as well, it is the full health care Garden Villas and up need.',
  }),

  // --- Religion ------------------------------------------------------------
  // The original's five gods, in its order. The temples differ only in their
  // god: the same cost, workers, desirability and priest round, as in the
  // original.
  temple_ceres: B({
    name: 'Temple of Ceres', category: 'religion', cost: 50, size: 2, workers: 2, labor: 'govReligion',
    des: [4, 2, -1, 6], walker: 'priest', god: 'ceres', spawnDays: 4, fire: 0.6,
    desc: 'Honors the goddess of the harvest. Priests bring religion to nearby homes.',
  }),
  temple_neptune: B({
    name: 'Temple of Neptune', category: 'religion', cost: 50, size: 2, workers: 2, labor: 'govReligion',
    des: [4, 2, -1, 6], walker: 'priest', god: 'neptune', spawnDays: 4, fire: 0.6,
    desc: 'Honors the god of the waters.',
  }),
  temple_mercury: B({
    name: 'Temple of Mercury', category: 'religion', cost: 50, size: 2, workers: 2, labor: 'govReligion',
    des: [4, 2, -1, 6], walker: 'priest', god: 'mercury', spawnDays: 4, fire: 0.6,
    desc: 'Honors the god of trade and travellers, who watches over granaries and warehouses.',
  }),
  temple_mars: B({
    name: 'Temple of Mars', category: 'religion', cost: 50, size: 2, workers: 2, labor: 'govReligion',
    des: [4, 2, -1, 6], walker: 'priest', god: 'mars', spawnDays: 4, fire: 0.6,
    desc: 'Honors the god of war and protection.',
  }),
  temple_venus: B({
    name: 'Temple of Venus', category: 'religion', cost: 50, size: 2, workers: 2, labor: 'govReligion',
    des: [4, 2, -1, 6], walker: 'priest', god: 'venus', spawnDays: 4, fire: 0.6,
    desc: 'Honors the goddess of love and beauty, who keeps the people content.',
  }),
  oracle: B({
    name: 'Oracle', category: 'religion', kind: 'decor', cost: 200, size: 2, workers: 0,
    des: [8, 1, -2, 6], fire: 0, damage: 0.5,
    desc: 'A sacred shrine that pleases every god a little each month.',
  }),

  // --- Education -----------------------------------------------------------
  school: B({
    name: 'School', category: 'education', cost: 50, size: 2, workers: 10, labor: 'healthEdu',
    des: [-2, 1, 1, 2], walker: 'teacher', spawnDays: 4,
    desc: 'Teachers visit homes with children. First level of education.',
  }),
  library: B({
    name: 'Library', category: 'education', cost: 80, size: 2, workers: 20, labor: 'healthEdu',
    des: [4, 1, -1, 4], walker: 'librarian', spawnDays: 4,
    desc: 'Scrolls for the literate. Second level of education.',
  }),
  academy: B({
    name: 'Academy', category: 'education', cost: 150, size: 3, workers: 30, labor: 'healthEdu',
    des: [4, 2, -1, 6], walker: 'scholar', spawnDays: 5,
    desc: 'Higher learning for the elite. Third level of education.',
  }),

  // --- Entertainment -------------------------------------------------------
  theater: B({
    name: 'Theater', category: 'entertainment', kind: 'venue', venue: 'theater', cost: 50, size: 2, workers: 8, labor: 'entertainment',
    des: [4, 1, -1, 4], walker: 'entertainer', spawnDays: 4,
    desc: 'Stages plays when actors arrive from an Actor Troupe. Worth 10 entertainment to the homes its entertainers pass.',
  }),
  amphitheater: B({
    name: 'Amphitheater', category: 'entertainment', kind: 'venue', venue: 'amphitheater', cost: 110, size: 3, workers: 12, labor: 'entertainment',
    des: [4, 1, -1, 4], walker: 'entertainer', spawnDays: 4,
    desc: 'Hosts gladiator bouts (from a Gladiator School) and plays (from an Actor Troupe). Worth 15 entertainment, 20 while it has both.',
  }),
  colosseum: B({
    name: 'Colosseum', category: 'entertainment', kind: 'venue', venue: 'colosseum', cost: 400, size: 5, workers: 25, labor: 'entertainment',
    des: [-3, 2, 1, 6], walker: 'entertainer', spawnDays: 4,
    desc: 'Grand spectacles with gladiators (Gladiator School) and beasts (Menagerie). Worth 20 entertainment, 30 while it has both.',
  }),
  actor_troupe: B({
    name: 'Actor Troupe', category: 'entertainment', kind: 'training', venue: 'theater', cost: 50, size: 2, workers: 5, labor: 'entertainment',
    des: [2, 1, -1, 2], spawnDays: 6,
    desc: 'Trains actors who walk to theaters to perform.',
  }),
  gladiator_school: B({
    name: 'Gladiator School', category: 'entertainment', kind: 'training', venue: 'amphitheater', cost: 75, size: 3, workers: 8, labor: 'entertainment',
    des: [-3, 1, 1, 3], spawnDays: 7,
    desc: 'Trains gladiators for amphitheaters and the colosseum.',
  }),
  menagerie: B({
    name: 'Menagerie', category: 'entertainment', kind: 'training', venue: 'colosseum', cost: 75, size: 3, workers: 8, labor: 'entertainment',
    des: [-4, 1, 1, 3], spawnDays: 8,
    desc: 'Keeps exotic beasts for the colosseum games.',
  }),

  // --- Government & decoration --------------------------------------------
  forum: B({
    name: 'Forum', category: 'government', cost: 75, size: 2, workers: 6, labor: 'govReligion',
    des: [4, 2, -1, 6], walker: 'taxman', spawnDays: 4,
    desc: 'Tax collectors register households. Only registered homes pay taxes.',
  }),
  senate: B({
    name: 'Senate', category: 'government', cost: 400, size: 4, workers: 30, labor: 'govReligion',
    des: [8, 2, -2, 8], walker: 'taxman', spawnDays: 3,
    desc: 'The seat of local government. Collects taxes and boosts every rating.',
  }),
  garden: B({
    name: 'Garden', category: 'government', kind: 'decor', cost: 12, size: 1, needsRoad: false,
    des: [3, 1, -1, 3], fire: 0, damage: 0,
    desc: 'A little green. Raises desirability nearby.',
  }),
  statue_small: B({
    name: 'Small Statue', category: 'government', kind: 'decor', cost: 15, size: 1, needsRoad: false,
    des: [3, 1, -1, 3], fire: 0, damage: 0,
    desc: 'A modest monument. Raises desirability.',
  }),
  statue_medium: B({
    name: 'Statue', category: 'government', kind: 'decor', cost: 60, size: 2, needsRoad: false,
    des: [10, 1, -2, 5], fire: 0, damage: 0,
    desc: 'An impressive monument. Raises desirability a lot.',
  }),
  statue_large: B({
    name: 'Grand Statue', category: 'government', kind: 'decor', cost: 160, size: 3, needsRoad: false,
    des: [14, 2, -2, 7], fire: 0, damage: 0,
    desc: 'A towering tribute. Raises desirability across a wide area.',
  }),

  // --- Engineering & security --------------------------------------------
  engineer_post: B({
    name: 'Engineer\'s Post', category: 'engineering', cost: 30, size: 1, workers: 5, labor: 'engineering',
    // Never burns or collapses, as in the original: its engineers keep their
    // own post in repair, and a post that fell would take its cover with it.
    des: [0, 1, 0, 0], walker: 'engineer', spawnDays: 3, fire: 0, damage: 0,
    desc: 'Engineers inspect buildings and prevent collapses. The post itself never burns or collapses on its own.',
  }),
  prefecture: B({
    name: 'Prefecture', category: 'security', cost: 30, size: 1, workers: 6, labor: 'safety',
    des: [-2, 1, 1, 2], walker: 'prefect', spawnDays: 3, fire: 0,
    desc: 'Prefects reduce fire risk and rush to fight fires.',
  }),

  // --- Farms ---------------------------------------------------------------
  farm_wheat: B({
    name: 'Wheat Farm', category: 'farms', kind: 'farm', produces: 'wheat', cost: 40, size: 3, workers: 10, labor: 'food',
    des: [-2, 1, 1, 2], fire: 0, damage: 0, placement: 'meadow', productionDays: 20,
    desc: 'Grows wheat on meadow land. Output scales with the share of meadow under it.',
  }),
  farm_veg: B({
    name: 'Vegetable Farm', category: 'farms', kind: 'farm', produces: 'vegetables', cost: 40, size: 3, workers: 10, labor: 'food',
    des: [-2, 1, 1, 2], fire: 0, damage: 0, placement: 'meadow', productionDays: 22,
    desc: 'Grows vegetables on meadow land.',
  }),
  farm_fruit: B({
    name: 'Orchard', category: 'farms', kind: 'farm', produces: 'fruit', cost: 40, size: 3, workers: 10, labor: 'food',
    des: [-2, 1, 1, 2], fire: 0, damage: 0, placement: 'meadow', productionDays: 24,
    desc: 'Grows fruit on meadow land.',
  }),
  farm_pig: B({
    name: 'Pig Farm', category: 'farms', kind: 'farm', produces: 'meat', cost: 40, size: 3, workers: 10, labor: 'food',
    des: [-3, 1, 1, 3], fire: 0, damage: 0, placement: 'meadow', productionDays: 26,
    desc: 'Raises pigs for meat on meadow land.',
  }),
  farm_olive: B({
    name: 'Olive Grove', category: 'farms', kind: 'farm', produces: 'olives', cost: 40, size: 3, workers: 10, labor: 'industry',
    des: [-2, 1, 1, 2], fire: 0, damage: 0, placement: 'meadow', productionDays: 24,
    desc: 'Grows olives for oil presses.',
  }),
  farm_vine: B({
    name: 'Vineyard', category: 'farms', kind: 'farm', produces: 'grapes', cost: 40, size: 3, workers: 10, labor: 'industry',
    des: [-2, 1, 1, 2], fire: 0, damage: 0, placement: 'meadow', productionDays: 24,
    desc: 'Grows grapes for wineries.',
  }),

  // --- Raw materials -------------------------------------------------------
  clay_pit: B({
    name: 'Clay Pit', category: 'industry', kind: 'raw', produces: 'clay', cost: 40, size: 2, workers: 8, labor: 'industry',
    des: [-3, 1, 1, 3], fire: 0.8, damage: 1.5, placement: 'nearWater', productionDays: 20,
    desc: 'Digs clay. Must be within 2 tiles of water.',
  }),
  timber_yard: B({
    name: 'Timber Yard', category: 'industry', kind: 'raw', produces: 'timber', cost: 40, size: 2, workers: 8, labor: 'industry',
    // Burns no faster than it collapses, like the workshops (it was fire 2).
    des: [-4, 1, 1, 3], fire: 1, damage: 1, placement: 'nearTrees', productionDays: 22,
    desc: 'Fells trees for timber. Must be within 2 tiles of woods: at least 4 tiles of forest (lone trees are not enough).',
  }),
  iron_mine: B({
    name: 'Iron Mine', category: 'industry', kind: 'raw', produces: 'iron', cost: 50, size: 2, workers: 10, labor: 'industry',
    des: [-6, 1, 1, 4], fire: 1, damage: 2.5, placement: 'nearRock', productionDays: 26,
    desc: 'Mines iron ore. Must be next to rocks.',
  }),
  marble_quarry: B({
    name: 'Marble Quarry', category: 'industry', kind: 'raw', produces: 'marble', cost: 50, size: 2, workers: 10, labor: 'industry',
    des: [-6, 1, 1, 4], fire: 0.5, damage: 2.5, placement: 'nearRock', productionDays: 30,
    desc: 'Cuts marble blocks, a valuable export. Must be next to rocks.',
  }),

  // --- Workshops -----------------------------------------------------------
  // Fire and damage 1 each, so a workshop burns and collapses at the same
  // pace, as in the original. Fire rates of 1.5 to 3 made them the city's
  // main fire source, burning two or three times as often as they fell.
  pottery_ws: B({
    name: 'Potter', category: 'industry', kind: 'workshop', produces: 'pottery', consumes: 'clay', cost: 40, size: 2, workers: 10, labor: 'industry',
    des: [-4, 1, 1, 3], fire: 1, damage: 1, productionDays: 18,
    desc: 'Turns clay into pottery.',
  }),
  furniture_ws: B({
    name: 'Carpenter', category: 'industry', kind: 'workshop', produces: 'furniture', consumes: 'timber', cost: 40, size: 2, workers: 10, labor: 'industry',
    des: [-4, 1, 1, 3], fire: 1, damage: 1, productionDays: 20,
    desc: 'Turns timber into furniture.',
  }),
  oil_ws: B({
    name: 'Oil Press', category: 'industry', kind: 'workshop', produces: 'oil', consumes: 'olives', cost: 50, size: 2, workers: 10, labor: 'industry',
    des: [-4, 1, 1, 3], fire: 1, damage: 1, productionDays: 20,
    desc: 'Presses olives into oil.',
  }),
  wine_ws: B({
    name: 'Winery', category: 'industry', kind: 'workshop', produces: 'wine', consumes: 'grapes', cost: 45, size: 2, workers: 10, labor: 'industry',
    des: [-1, 1, 1, 1], fire: 1, damage: 1, productionDays: 22,
    desc: 'Ferments grapes into wine.',
  }),
  weapons_ws: B({
    name: 'Weaponsmith', category: 'industry', kind: 'workshop', produces: 'weapons', consumes: 'iron', cost: 50, size: 2, workers: 10, labor: 'industry',
    des: [-4, 1, 1, 3], fire: 1, damage: 1, productionDays: 22,
    desc: 'Forges iron into weapons: legionaries need them, and they sell well abroad.',
  }),
  fletcher_ws: B({
    name: 'Fletcher', category: 'industry', kind: 'workshop', produces: 'arrows', recipe: { timber: 100, iron: 50 }, cost: 45, size: 2, workers: 8, labor: 'industry',
    des: [-2, 1, 1, 2], fire: 1, damage: 1, productionDays: 16,
    desc: 'Makes bows and iron-tipped arrows from timber (shafts) and iron (arrowheads): 100 timber + 50 iron per 100 arrows. Archer recruits need them at the barracks.',
  }),

  // --- Storage & markets --------------------------------------------------
  market: B({
    name: 'Market', category: 'commerce', kind: 'market', cost: 40, size: 2, workers: 5, labor: 'industry',
    des: [-2, 1, 1, 2], walker: 'vendor', spawnDays: 3,
    desc: 'Buyers fetch food and goods from storage; vendors sell them door to door.',
  }),
  granary: B({
    name: 'Granary', category: 'commerce', kind: 'granary', cost: 100, size: 3, workers: 12, labor: 'food',
    des: [-4, 1, 1, 4], fire: 1, damage: 1,
    desc: 'Stores food from farms. Markets buy food here.',
  }),
  warehouse: B({
    name: 'Warehouse', category: 'commerce', kind: 'warehouse', cost: 70, size: 3, workers: 6, labor: 'industry',
    // Never burns or collapses, as in the original (players of it know
    // "warehouses don't burn"); raiders can still wreck one.
    des: [-5, 2, 1, 4], fire: 0, damage: 0,
    desc: 'Stores raw materials and goods. Supplies workshops and trades with caravans. Never burns or collapses on its own.',
  }),
  dock: B({
    name: 'Dock', category: 'commerce', kind: 'dock', cost: 120, size: 3, workers: 10, labor: 'industry',
    des: [-6, 1, 1, 3], fire: 1.2, damage: 1, placement: 'shore',
    desc: 'Merchant ships from sea trade routes tie up here and wait while they trade. Build it on the bank of a river or sea that reaches the map edge. Up to 3 dock workers (by staffing) cart imports to storage and fetch exports from warehouses connected to the dock by road: keep one close.',
  }),

  // --- Horses & military ----------------------------------------------------
  horse_ranch: B({
    name: 'Horse Ranch', category: 'farms', kind: 'farm', produces: 'horses', cost: 70, size: 3, workers: 10, labor: 'military',
    des: [-3, 1, 1, 2], fire: 0, damage: 0, placement: 'meadow', productionDays: 30,
    desc: 'Breeds horses on meadow pasture for the cavalry. The breeding herd starts with 2 mares and grows over time (on Insane, not in winter), so a ranch gets more productive as it matures.',
  }),
  barracks: B({
    name: 'Barracks', category: 'military', kind: 'barracks', cost: 150, size: 3, workers: 10, labor: 'military',
    des: [-6, 1, 1, 3], fire: 1, damage: 1, inputs: ['weapons', 'arrows', 'horses'], inputCap: 400,
    desc: 'Trains recruits and sends them to your forts. Legionaries need weapons, archers need arrows, cavalry need horses. Carts deliver them from workshops, ranches and warehouses.',
  }),
  fort_legion: B({
    name: 'Legion Fort', category: 'military', kind: 'fort', unit: 'legionary', cost: 300, size: 3, workers: 8, labor: 'military',
    des: [-8, 1, 2, 4], fire: 0, damage: 0, hp: 700,
    desc: 'Home of 8 heavily armored legionaries, the backbone of your defense. Each recruit needs a set of weapons at the barracks.',
  }),
  fort_archer: B({
    name: 'Archer Fort', category: 'military', kind: 'fort', unit: 'archer', cost: 220, size: 3, workers: 8, labor: 'military',
    des: [-6, 1, 2, 3], fire: 0, damage: 0, hp: 600,
    desc: 'Home of 8 auxiliary archers who shoot raiders from a distance. Each recruit needs arrows from a Fletcher.',
  }),
  fort_cavalry: B({
    name: 'Cavalry Fort', category: 'military', kind: 'fort', unit: 'cavalry', cost: 350, size: 3, workers: 8, labor: 'military',
    des: [-8, 1, 2, 4], fire: 0, damage: 0, hp: 700,
    desc: 'Home of 8 fast horsemen who run down raiders. Every recruit needs a horse from a Horse Ranch (or imported).',
  }),
  tower: B({
    name: 'Watchtower', category: 'military', kind: 'tower', cost: 120, size: 2, workers: 6, labor: 'military',
    des: [-3, 1, 1, 2], fire: 0, damage: 0.5, hp: 500, needsRoad: true,
    desc: 'Archers on the tower shoot any raider within 8 tiles. Pairs well with walls.',
  }),
});

export const BUILDING_KEYS = Object.freeze(Object.keys(BUILDINGS));

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
export const VENUE_POINTS = Object.freeze({ theater: 10, amphitheater: 15, colosseum: 20 });

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
 * can seat. How well the seats cover the population, averaged over the venue
 * kinds, gives every home up to ENT_BASE_MAX points on top of its own visits.
 */
export const VENUE_SEATS = Object.freeze({ theater: 400, amphitheater: 900, colosseum: 2000 });
export const ENT_BASE_MAX = 20;

/** Performer display names by venue they train for. */
export const PERFORMER_NAMES = Object.freeze({ theater: 'Actor', amphitheater: 'Gladiator', colosseum: 'Beast Tamer' });

/**
 * Which training buildings can supply a venue.
 * Colosseum shows need gladiators OR beasts (both = better); amphitheaters take gladiators or actors.
 */
export const VENUE_SUPPLIERS = Object.freeze({
  theater: ['theater'],
  amphitheater: ['amphitheater', 'theater'],
  colosseum: ['amphitheater', 'colosseum'],
});

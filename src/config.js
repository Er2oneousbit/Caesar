/**
 * config.js
 * ----------------------------------------------------------------------------
 * Every tunable number in the game lives here so balancing does not require
 * hunting through system code. Values are grouped by system.
 *
 * Units cheat sheet:
 *   - "tick"  : one simulation step. TICKS_PER_SECOND ticks run per real
 *               second at 1x speed (12: a game day takes 1.67 s).
 *   - "day"   : TICKS_PER_DAY ticks. Most building logic runs once per day.
 *   - "unit"  : one unit of a good. A cart carries CART_CAPACITY units.
 *   - "Dn"    : denarii, the city's money.
 * ----------------------------------------------------------------------------
 */

export const CONFIG = {
  // --- Game identity ------------------------------------------------------
  GAME_TITLE: 'Colonia',
  GAME_TAGLINE: 'Veni, vidi, aedificavi.',
  VERSION: '0.9.1',
  SAVE_VERSION: 4, // v4: the 20-level housing ladder; saves before v4 cannot be loaded (see core/save.js)
  STORAGE_PREFIX: 'colonia.',

  // --- Rendering (isometric) ---------------------------------------------
  TILE_W: 64, // diamond width in world pixels at zoom 1
  TILE_H: 32, // diamond height in world pixels at zoom 1
  ZOOM_LEVELS: [0.5, 0.75, 1, 1.5, 2],
  DEFAULT_ZOOM_INDEX: 2,
  MAX_DPR: 2, // cap device pixel ratio to keep sprite caches small
  EDGE_SCROLL_PX: 12, // mouse this close to the screen edge scrolls the map
  PAN_SPEED: 900, // keyboard pan speed, screen px per second

  // --- Time ----------------------------------------------------------------
  // Real-time pace only: the balance is all per tick/day, so this sets how
  // fast everything looks. At 20 people walked 2 tiles a second (a jog for
  // their size); at 12 they walk 1.2 and a month takes about 27 s at 1x.
  TICKS_PER_SECOND: 12,
  TICKS_PER_DAY: 20,
  DAYS_PER_MONTH: 16,
  MONTHS_PER_YEAR: 12,
  SPEEDS: [0, 1, 2, 4, 8], // index 0 = paused; 8x runs about as fast as the old top speed
  MAX_TICKS_PER_FRAME: 40, // safety valve so a slow frame can't spiral
  AUTOSAVE_EVERY_MONTHS: 3,

  // --- Walkers -------------------------------------------------------------
  WALKER_SPEED: 0.1, // tiles per tick: 2 tiles a game day (1.2 tiles/s at 1x)
  CART_SPEED: 0.08,
  SERVICE_RADIUS: 2, // walkers serve buildings within this many tiles
  ACCESS_DAYS: 96, // how long a house "remembers" a service visit (six months)
  TAX_ACCESS_DAYS: 48, // how long a tax collector's visit keeps a house registered
  LABOR_ACCESS_DAYS: 24, // grace period: labor access lingers this long after housing disappears
  DEFAULT_ROAM: 26, // tiles a roaming walker travels before heading home
  MAX_WALKERS: 3000,

  // --- Goods & storage ---------------------------------------------------
  CART_CAPACITY: 100, // one production batch / trade lot
  FARM_CART_LOAD: 400, // farm wagons haul the whole harvest
  CART_LOAD: 200, // other producers' carts carry up to this much
  GRANARY_CAPACITY: 2400,
  WAREHOUSE_CAPACITY: 3200,
  PRODUCER_MAX_STOCK: 400, // raw producers and farms stop when this full
  WORKSHOP_RAW_CAP: 200, // raw materials a workshop will hold
  MARKET_FOOD_CAP: 800, // per food type
  MARKET_GOODS_CAP: 300, // per manufactured good
  MARKET_BUYER_LOAD: 400, // units of the main item a market buyer carries back
  WOODS_MIN_TILES: 4, // forest tiles a timber yard needs within 2 tiles: woods, not the odd lone tree

  // --- Housing -------------------------------------------------------------
  // Homes move up at once and fall back after game.difficulty.devolveDays bad
  // days in a row (data/difficulty.js); the ladder itself is data/housing.js.
  FOOD_PER_PERSON_MONTH: 0.25, // units of food eaten per resident per month (a 100-unit load feeds 400 person-months)
  GOODS_PER_HOUSE_PEOPLE: 20, // one unit of each needed good per this many residents per month
  GOODS_MIDMONTH_DAY: 8, // goods are used up twice a month: at the month's start and on this day
  WORKFORCE_RATIO: 0.32, // share of plebeian residents that can work
  LABOR_RANGE: 40, // a building can hire if occupied housing is within this many road tiles

  // --- Immigration -------------------------------------------------------
  IMMIGRANT_GROUP_MAX: 6,
  SETTLER_WALK_TILES: 70, // settlers with a longer trip than this (big maps) ride in on a mule...
  SETTLER_MAX_SPEEDUP: 2, // ...up to this many times walking speed (a trot): trips up to 140 tiles take no longer than a 70-tile walk
  IMMIGRATION_BASE_PER_DAY: 6, // people/day arriving when sentiment is 100 (scaled by (mood - 20) / 80)
  IMMIGRATION_MIN_MOOD: 30, // below this mood nobody moves in
  NEW_CITY_BONUS_MONTHS: 12, // a new city's first months, when settlers are keen so cities can start:
  NEW_CITY_MOOD: 20, // ...extra mood
  NEW_CITY_IMMIGRATION: 1.6, // ...and this many times the settlers

  // --- Economy -------------------------------------------------------------
  DEFAULT_TAX_RATE: 7, // percent
  DEFAULT_WAGE: 24, // Dn per worker per year
  BASE_WAGE: 24, // the wage citizens consider "fair"
  TAX_K: 2, // Dn per resident per year for each point of a tier's `tax`, at the default tax rate
  CLEAR_TREE_COST: 2,
  CLEAR_RUBBLE_COST: 2,
  DEBT_LIMIT: 0, // cannot start construction when treasury is below this

  // --- Risk ----------------------------------------------------------------
  FIRE_THRESHOLD: 100,
  DAMAGE_THRESHOLD: 100,
  FIRE_BURN_DAYS: 6, // how long a burning ruin keeps burning
  FIRE_SPREAD_CHANCE: 0.02, // chance a building beside a fire catches, per day (once, however many burning tiles it touches)
  FIRE_HEAT_PER_DAY: 5, // fire risk a building beside a fire gains per day (once, however many burning tiles it touches)
  PREFECT_RUN_SPEED: 1.6, // prefects run (speed multiplier) when heading to a fire
  PREFECT_ALERT_RADIUS: 24, // prefects within this road distance respond to fires

  // --- Water ---------------------------------------------------------------
  WELL_RADIUS: 2,
  FOUNTAIN_RADIUS: 4,
  RESERVOIR_RADIUS: 10,
  HOSPITAL_RADIUS: 12,

  // --- Desirability ------------------------------------------------------
  DES_MIN: -100,
  DES_MAX: 100,

  // --- Religion ------------------------------------------------------------
  PEOPLE_PER_TEMPLE: 500, // each temple keeps its god content for this many citizens (x5 gods)
  GOD_MOOD_START: 60,
  GOD_BLESS_MOOD: 92,
  GOD_WRATH_MOOD: 12,

  // --- Trade ---------------------------------------------------------------
  CARAVAN_INTERVAL_DAYS: [32, 56], // random range between visits per open route
  CARAVAN_MAX_TRADE: 800, // units bought + sold per visit (each direction)
  SHIP_MAX_TRADE: 1200, // ships carry more than caravans
  SHIP_SPEED: 0.06, // tiles per tick
  SHIP_DOCK_TICKS: 120, // how long a ship stays tied up (loading/unloading)
  DOCK_CAPACITY: 1600, // units of unloaded imports a dock can hold
  DOCK_REACH: 60, // road tiles: warehouses this close to a dock sell exports to ships

  // --- Ratings ------------------------------------------------------------
  // Culture and prosperity move toward what the city deserves by at most
  // these many points a month; peace grows while the mood is good. These set
  // how fast a mission's goals can be met (sim/pace.js).
  CULTURE_STEP: 4,
  PROSPERITY_STEP: 2,
  PEACE_START: 20,
  PEACE_PER_MONTH: 1, // while the mood is at least PEACE_MOOD
  PEACE_MOOD: 45,

  // --- Emperor -------------------------------------------------------------
  REQUEST_INTERVAL_MONTHS: [14, 26],
  REQUEST_DEADLINE_MONTHS: 12,
  FAVOR_START: 50,
};

/** Derived constants (computed once, never edit these directly). */
export const TICKS_PER_MONTH = CONFIG.TICKS_PER_DAY * CONFIG.DAYS_PER_MONTH;
export const HALF_W = CONFIG.TILE_W / 2;
export const HALF_H = CONFIG.TILE_H / 2;

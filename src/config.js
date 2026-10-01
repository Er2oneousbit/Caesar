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
  VERSION: '0.12.2',
  SAVE_VERSION: 8, // v8: ships wait at the dock while dock workers carry goods both ways; v7: storage orders, rubble that remembers what fell, and the original's five gods; v6: disease; v5: home mood and crime (v4 to v6 saves load, upgraded); saves before v4 cannot be loaded (see core/save.js)
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
  TICKS_PER_SECOND: 8, // a year in 8 minutes at 1x (was 12: 5.3 minutes, and seasons flew by, the owner said); nothing in game time changes
  TICKS_PER_DAY: 20,
  DAYS_PER_MONTH: 16,
  MONTHS_PER_YEAR: 12,
  SPEEDS: [0, 1, 2, 4, 8], // index 0 = paused; 8x runs about as fast as the old top speed
  MAX_TICKS_PER_FRAME: 40, // safety valve so a slow frame can't spiral
  AUTOSAVE_EVERY_MONTHS: 3,

  // --- Walkers -------------------------------------------------------------
  WALKER_SPEED: 0.1, // tiles per tick: 2 tiles a game day (0.8 tiles/s at 1x)
  CART_SPEED: 0.08,
  SERVICE_RADIUS: 2, // walkers serve buildings within this many tiles
  ACCESS_DAYS: 96, // how long a house "remembers" a service visit (six months)
  TAX_ACCESS_DAYS: 48, // how long a tax collector's visit keeps a house registered
  LABOR_ACCESS_DAYS: 24, // grace period: labor access lingers this long after housing disappears
  NO_ROAD_NOTICE_DAYS: 8, // a building that employs people says so once after this many days with no road touching it
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
  UNEMPLOYMENT_MOOD_FREE: 0.1, // unemployment up to this share costs no mood; beyond it, 6 points per 10% (at most 15). A mission's population goal must fit its jobs at it (sim/capacity.js)
  NEW_CITY_BONUS_MONTHS: 12, // a new city's first months, when settlers are keen so cities can start:
  NEW_CITY_MOOD: 20, // ...extra mood
  NEW_CITY_IMMIGRATION: 1.6, // ...and this many times the settlers

  // --- Economy -------------------------------------------------------------
  DEFAULT_TAX_RATE: 7, // percent
  DEFAULT_WAGE: 24, // Dn per worker per year
  BASE_WAGE: 24, // the wage citizens consider "fair"
  TAX_K: 5, // Dn per resident per year for each point of a tier's `tax`, at the default tax rate.
  // 5, not 2 (v0.11.1, the owner's call): with 2 only a city of Apartment Houses paid its
  // wages (a worker costs BASE_WAGE, WORKFORCE_RATIO of the people work), so every smaller one
  // lost money on every difficulty. With 5 a Cottage town about pays its way (npm run sweep).
  CLEAR_TREE_COST: 2,
  CLEAR_RUBBLE_COST: 2,
  DEBT_LIMIT: 0, // cannot start construction when treasury is below this
  LOAN_AMOUNT: 2000, // Rome lends this much (sim/loans.js)...
  LOAN_MONTHS: 24, // ...repaid monthly over this many months, with the difficulty's loanInterest

  // --- Risk ----------------------------------------------------------------
  FIRE_THRESHOLD: 100,
  // Every building's fire and collapse rates (data/buildings.js, data/housing.js)
  // run at this pace: the original's clock (research: a standard building there
  // burns or falls in about 161 days unserved; Colonia's rates gave 103). The
  // owner, v0.12.1 on Normal: fire still came too fast. x difficulty.risk on top.
  RISK_PACE: 0.62,
  DAMAGE_THRESHOLD: 100,
  FIRE_BURN_DAYS: 6, // how long a burning ruin keeps burning
  FIRE_SPREAD_CHANCE: 0.02, // chance a building beside a fire catches, per day (once, however many burning tiles it touches)
  FIRE_HEAT_PER_DAY: 5, // fire risk a building beside a fire gains per day (once, however many burning tiles it touches)
  PREFECT_RUN_SPEED: 1.6, // prefects run (speed multiplier) when heading to a fire
  PREFECT_ALERT_RADIUS: 24, // prefects within this road distance respond to fires

  // --- Home mood and crime (sim/mood.js, sim/crime.js) ----------------------
  // Each home has a mood (0-100) for crime only: city mood (sentiment) still
  // drives migration. Twice a month (days 0 and 8) a home's mood moves toward
  // city mood plus its own local terms, by at most MOOD_STEP.
  MOOD_MIDMONTH_DAY: 8, // the second update of the month (the first follows the month's city mood)
  MOOD_STEP: 3, // most a home's mood moves per update (smoothing, so homes do not all run to 0 or 100)
  MOOD_HUNGER: 5, // x the hunger streak (updates in a row with no food at all, at most MOOD_HUNGER_STREAK)
  MOOD_HUNGER_STREAK: 3,
  MOOD_FOOD_EXTRA: 3, // per kind of food beyond what the home's level needs...
  MOOD_FOOD_EXTRA_MAX: 6, // ...at most this much
  MOOD_ENVY_TIER: 4, // homes up to this level (tents, lean-tos, huts) envy rich neighbors:
  MOOD_ENVY_VILLAS: -8, // ...in a city with villas or palatia
  MOOD_ENVY_INSULAE: -5, // ...in a city with insulae (level 11+) but no villas
  MOOD_ENVY_INSULA_TIER: 11,
  MOOD_DES_DIV: 5, // local desirability / this, clamped to +-MOOD_DES_MAX
  MOOD_DES_MAX: 5,
  MOOD_UNTAXED: 3, // a home no tax collector has registered is a little happier
  CRIME_MIN_POP: 300, // no crime in a smaller town
  CRIME_MOOD: 50, // homes below this mood may produce a criminal; at or above, they settle down
  // Homes sit within a few points of city mood (a target, not a running total
  // as in the original, whose homes spread from 0 to 100), so these bands are
  // set 5 higher than the original's 30 and 10: thieves come as a city nears
  // the mood where settlers stop coming (30), riots only under real neglect
  // (city mood around 15-20: in the demo city, taxes of 17% and more).
  THIEF_MOOD: 35, // below this: a thief
  RIOT_MOOD: 15, // at or below this, while city mood is under RIOT_CITY_MOOD: a riot
  RIOT_CITY_MOOD: 30,
  CRIME_CHANCE_MAX: 0.61, // daily chance of a crime at city mood 0...
  CRIME_CHANCE_ZERO: 108, // ...falling in a straight line to 0 at this mood (x difficulty.crime)
  POLICE_DAYS: 32, // a prefect's visit gives a home police cover this long: half the crime chance
  CRIMINAL_ROAD_RADIUS: 2, // protesters and thieves appear on a road this close to their home
  RIOT_ROAD_RADIUS: 4, // a riot needs a road this close
  PROTEST_TICKS: [70, 76], // how long a protester stands in the street (3.5 to 3.8 days)
  THIEF_RANGE: 50, // road tiles a thief will walk to a Forum, Senate or market
  THEFT_SHARE: 0.25, // a thief at the Forum takes this share of this year's taxes...
  THEFT_CAP: 400, // ...at most this much (Dn)...
  THEFT_MIN: 5, // ...and nothing when that would be less than this (never more than the treasury holds)
  MARKET_THEFT_MAX: 100, // a thief at a market takes half its biggest stock, at most this
  RIOT_MOB: [[150, 1], [300, 2], [800, 3], [1200, 4], [2000, 5]], // [population up to, rioters]; more: RIOT_MOB_MAX
  RIOT_MOB_MAX: 6,
  RIOT_TARGET_RANGE: 40, // rioters go for the most prized building this close to their home
  RIOT_MOOD_BOOST: 20, // every home's mood rises this much after a riot: the anger is spent
  RIOT_PEACE: 5, // peace lost at once to a riot (x the difficulty's crimePeace)
  THIEF_PEACE: 1, // peace lost at once to a thief (x crimePeace; above 0 he also costs that month's gain)
  PROTEST_PEACE: 1, // peace lost to every protestPeaceEvery-th protest (Insane only)
  RIOTER_START_TICKS: 20, // rioter i sets off after this + i x RIOTER_STAGGER_TICKS
  RIOTER_STAGGER_TICKS: 4,
  RIOTER_BURN_TICKS: 64, // a rioter stays about 3 days by each building it sets on fire
  RIOTER_MAX_DAYS: 16, // then the mob loses heart: a rioter still at large after this goes home (checked every tick)
  CRIMINAL_HP: 12, // how much struggle a criminal puts up before he is caught:
  CATCH_PREFECT: 0.8, // ...a prefect takes about 15 ticks (per tick, next to him)
  CATCH_SOLDIER: 2, // ...a soldier about 6
  HUNT_RANGE: 30, // prefects chase thieves and rioters this close (tiles, either axis)
  HUNT_EVERY: 10, // ticks between a roaming prefect's looks around
  HUNT_RETRY_TICKS: 160, // a criminal a prefect found no way to reach is left alone by him this long (8 days)

  // --- Health and disease (sim/disease.js) ----------------------------------
  // Every occupied home has a health score (0-100), from its level and what it
  // has: health care, baths, a barber, fountain water and food. The poorer
  // the score and the fuller the home, the faster it builds disease risk,
  // which a physician's visit resets (as a prefect resets fire risk). City
  // health is only shown: it feeds no rating and no migration.
  DISEASE_MIN_POP: 200, // no disease in a smaller town (and city health stays at HEALTH_START)
  HEALTH_START: 50, // city health of a new city
  HEALTH_STEP: 2, // city health moves this much a month toward the homes' average score
  HEALTH_LEVEL_MAX: 10, // a home's level adds its number, up to this
  HEALTH_CARE_BOTH: 50, // a medicus visit and a hospital within reach
  HEALTH_CARE_HOSPITAL: 40, // a hospital alone
  HEALTH_CARE_MEDICUS: 30, // a medicus alone
  HEALTH_BATHS: 15,
  HEALTH_BARBER: 10,
  HEALTH_FOUNTAIN: 10, // fountain water (a well does not count)
  HEALTH_PER_FOOD: 10, // per kind of food in the pantry
  HEALTH_HUNGRY_MAX: 40, // a home whose level eats and that has no food scores at most this
  // Daily risk = DISEASE_RATE x (100 - score) / 100 x crowding x difficulty.disease
  // x (0.6 to 1.4), halved within a staffed hospital's reach. Crowding is
  // DISEASE_CROWD_BASE + min(DISEASE_CROWD_MAX, residents / DISEASE_CROWD_PEOPLE).
  // At 0.5 a crowded home (40 people) scoring 20 that no physician visits
  // reaches the threshold in about 10 months on Normal; one scoring 80
  // (which takes health care) would need over 3 years, and gets visited.
  DISEASE_RATE: 0.2, // was 0.5, then 0.31: the owner found disease too fast on Normal (v0.12.1, then a 5-year sandbox save: 37 outbreaks)
  DISEASE_CROWD_BASE: 0.5,
  DISEASE_CROWD_PEOPLE: 40,
  DISEASE_CROWD_MAX: 1.5,
  DISEASE_THRESHOLD: 100, // from here, each day...
  DISEASE_OUTBREAK_CHANCE: 0.25, // ...this chance that the home falls sick (as with fire)
  DISEASE_DEATHS: 0.2, // share of a home's residents who die when it falls sick (at least 1)...
  DISEASE_DEATHS_HOSPITAL: 0.1, // ...within a staffed hospital's reach
  SICK_DAYS: 32, // a sick home recovers by itself after this many days (a physician cures it at once)
  DISEASE_HEAT: 0.3, // disease risk a home beside a sick one gains per day, x difficulty.disease (once, however many sick homes it touches). Was 1, five times a Family Tent's own: one outbreak set off the whole block
  DISEASE_SPREAD_CHANCE: 0.003, // chance a day that it falls sick at once, x difficulty.disease (halved within a hospital's reach); was 0.005
  PHYSICIAN_ALERT_RADIUS: 24, // road tiles: a physician or a staffed medicus this close is sent to a sick home
  PHYSICIAN_NEAR: 3, // no second physician is sent to a sick home this near one another is heading to
  PHYSICIAN_TREAT_TICKS: 20, // a physician stays a day with the sick, then looks for more

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
  // Two levels of wrath, as in the original: a god that strikes stays angered
  // until its mood climbs back above GOD_CALM_MOOD, and if it strikes again
  // before then, Mercury and Venus strike harder (not in a mission whose
  // scenario says majorWrath: false, the first two).
  GOD_CALM_MOOD: 50,
  // Mercury: the original's numbers (a load there is 100 units here).
  MERCURY_BLESS_FOOD: 600, // units of each food the emptiest working granary receives (6 loads; room permitting)
  MERCURY_WRATH_LOSS: 1600, // units lost from the fullest granary or warehouse (16 loads, half a full granary)
  // Venus. Home moods (sim/mood.js) only breed crime and city mood (sim/
  // population.js) drives migration, so she touches both, where the original's
  // one happiness value did both jobs.
  VENUS_BLESS_HOME: 25, // every occupied home's mood (the original's +25); homes drift back at MOOD_STEP an update, about 4 months
  // The city mood factor: about a grand festival's worth (+14) for a blessing,
  // which needs festivals or oracles to reach. City mood moves halfway to its
  // target each month, so a factor of F moves it by about 0.65 x F at most
  // (after two months), 0.4 x F after six, and is mostly gone after a year.
  // Measured on the balance sim's demo city (mood about 45; six seeds, Normal
  // and Hard): the blessing lifts it about 7 points; the first wrath takes
  // about 3, the second about 9 more for a few months, so a city at 40 stays
  // above 30, where settlers keep coming and peace stops falling 2 a month.
  // (-8 and -15 took it to 28 on Hard and peace fell to 0.) The second wrath
  // still costs about 20 peace through the thieves it breeds, and a few
  // outbreaks: felt, and mended within a year.
  VENUS_BLESS_CITY: 15,
  VENUS_WRATH_CITY: [-5, -10], // first wrath, then again before she calms
  VENUS_DECAY: 0.8, // the factor's monthly decay, as the festival boost
  // Every occupied home's mood capped, then lowered. The original's: cap 50,
  // -5 (homes at 45, just under its protest line of 50), then cap 40, -10
  // (30, its thief line). Colonia's thief line is 5 higher (THIEF_MOOD 35),
  // so the second cap is too: homes end on the thief line, not past it, and
  // fall under it only where the city's mood or their own troubles pull.
  VENUS_WRATH_CAP: [50, 45],
  VENUS_WRATH_HOME: [-5, -10],
  // Again before she calms, where disease is active: every occupied home
  // gains this x (100 - its health score) / 100 disease risk (threshold 100):
  // a home with no care (score about 20) gets 64, most of the way to an
  // outbreak, a well served one (80) gets 16. A passing physician clears it,
  // as always. The original's "certain plague" next month, made local: it
  // falls on the badly served homes and resolves at once (the original's
  // plague could stay armed for years).
  VENUS_WRATH_DISEASE: 80,

  // --- Trade ---------------------------------------------------------------
  CARAVAN_INTERVAL_DAYS: [32, 56], // random range between caravans per open land route (about the original's pace)
  SHIP_INTERVAL_DAYS: [64, 96], // ...and between ships per sea route: about 2.4 a year, the original's (research: 2-2.8); was 32-56, twice as often
  CARAVAN_MAX_TRADE: 800, // units bought + sold per visit (each direction)
  SHIP_MAX_TRADE: 2400, // units each way per ship: twice the old 1,200, so half as many ships still carry a route's yearly trade (Corinthus buys 4,600 a year)
  SHIP_SPEED: 0.06, // tiles per tick
  // A moored ship waits while the Dock's workers carry goods both ways (sim/trade.js):
  // a full exchange (2,400 each way in wagons of 400) takes 18 / 25 / 38 days with the
  // warehouse 5 / 10 / 15 road tiles from the dock (measured), near the original's
  // 23 / 33 / 44 (research: dock-trade spec).
  SHIP_MAX_STAY_DAYS: 48, // a ship casts off after this many days moored, whatever is left (a full exchange fits with storage up to about 18 road tiles away)
  DOCK_LOAD: 400, // units a dock worker's wagon carries each trip (two of the original's loads: Colonia's carts walk half its pace)
  DOCK_UNLOAD_DAYS: 3, // days the dock's crane takes to land DOCK_LOAD from the ship onto the quay (the original's 1.6 days a load)
  DOCK_CAPACITY: 2400, // units of unloaded imports a dock can hold (a whole ship's load)
  DOCK_REACH: 60, // road tiles: dock workers fetch exports from staffed warehouses this close to the dock (a trip must also end before the stay limit)

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
  FIRST_REQUEST_MONTHS: [36, 48], // the Emperor's first request: in the fourth year (x difficulty.requestInterval; was 14-26 like the rest, then 24-36: still too early for a city to get going, the owner said)...
  REQUEST_MIN_POP: 500, // ...and not before the city has this many people (was 150, then 400)
  REQUEST_DEADLINE_MONTHS: 12,
  FAVOR_START: 50,
};

/** Derived constants (computed once, never edit these directly). */
export const TICKS_PER_MONTH = CONFIG.TICKS_PER_DAY * CONFIG.DAYS_PER_MONTH;
export const HALF_W = CONFIG.TILE_W / 2;
export const HALF_H = CONFIG.TILE_H / 2;

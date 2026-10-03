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
  VERSION: '0.18.9',
  SAVE_VERSION: 29, // v29: soldiers at rest go to train (a soldier's drill, drillDay, drillDays, trainLeft and trainWait are now his trip from his fort to the Campus; an older save's soldier on a trip comes home untrained: upgradeSoldierTripsV28); v28: prefects fight one burning building at a time (fires[] entries carry their fire, the burned building's id; a prefect at a fire waits with afterWait 'douse'; an older save's burning tiles are tied together by their ruin: upgradeFireGroupsV27); v27: festivals (each god's monthsSinceFestival and festivalsHeld; an older save's gods start a fresh year, none held: upgradeFestivalsV26); v26: gardens and statues fade untended (their tendedDay and careStep; an older save's start fully tended, last visited the day it loads: upgradeGardensV25); v25: numbered forts (each fort's `number`, Castra III and Shift+3; an older save numbers its forts in id order: upgradeFortNumbersV24); v24: the sandbox's events, a switch each (scenario.events: the list of switches on; an older sandbox gets all of them if its events were on, none if off: upgradeEventSwitchesV23); v23: events (city.romeWage, city.events: cooldowns, trade stopped, an earthquake under way), raiders' peoples (military.people), wolf packs (wildlife, units of side 'wild') and the gladiator revolt, low bridges (map.bridgeLow), native villages (city.natives, village buildings with their anger, villagers of side 'native', the mission post and its walkers); a v22 save loads with none of them (upgradeEventsV22 and the constructor's defaults); v22: buildings turn (each building's `turn`, 0..3, quarter turns of its art; a hippodrome turned 1 or 3 lies north-south, its sections along y); v21: trade by partner (each route's `off`: the goods switched off with that partner, sim/tradeSwitches.js); v20: horses live at the Horse Ranch (its stables' stock and incoming), never in warehouses (warehouse stock, incoming and orders have no horses); v19: recall from a distant battle (military.recalls: riders out, recalled troops coming home); v17: shipyards hold timber (stock, incoming), a boat takes 100; v16: training takes time: a recruit training at the academy (walker state 'training', trainLeft) and a new ship moored at the Portus (unit trainLeft); v15: staged raid warnings and the legions' reminders (military.warnStage, caesar.noticeStage); v14: Caesar's legions (no recall at favor 0), distant battles and the forts' and stations' Empire service switch, triumphal arches; v13: the governor (rank, salary, personal savings; gifts to the Emperor from savings, with a count of recent gifts) and his residence v12: training (Military Academy, Portus): soldiers, liburnians and recruits have a trained flag, and those on a drill trip their academy or Portus; large temples; v11: sea raids and the fleet (navalia, naval stations, liburnians, raider ships); v10: the cloth industry (flax, linen, clothing; homes need clothing from the Insula up); v9: fish (a fifth food), shipyards, wharves and fishing boats, the hippodrome; v8: ships wait at the dock while dock workers carry goods both ways; v7: storage orders, rubble that remembers what fell, and the original's five gods; v6: disease; v5: home mood and crime (v4 to v14 saves load, upgraded); saves before v4 cannot be loaded (see core/save.js)
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
  TICKS_PER_SECOND: 8, // a year in 8 minutes at 1x (was 12: 5.3 minutes, and seasons went by too fast); nothing in game time changes
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
  // 5, not 2 (v0.11.1): with 2 only a city of Apartment Houses paid its
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
  // burns or falls in about 161 days unserved; Colonia's rates gave 103, and
  // fire came too fast in v0.12.1 playtests on Normal). x difficulty.risk on top.
  RISK_PACE: 0.62,
  DAMAGE_THRESHOLD: 100,
  FIRE_BURN_DAYS: 6, // how long a burning ruin keeps burning
  FIRE_SPREAD_CHANCE: 0.02, // chance a building beside a fire catches, per day (once, however many burning tiles it touches)
  FIRE_HEAT_PER_DAY: 5, // fire risk a building beside a fire gains per day (once, however many burning tiles it touches)
  PREFECT_RUN_SPEED: 1.6, // prefects run (speed multiplier) when heading to a fire
  PREFECT_ALERT_RADIUS: 24, // prefects within this road distance respond to fires
  // A prefect fights one burning building at a time (sim/risk.js): he stands
  // at it this many ticks, then it is out and he takes the next one in reach.
  // Half a day: the original's prefect stands up to a day at each burning
  // tile, but a building here is its whole footprint, and a prefect called to
  // a block of homes should be done before the 6 days a ruin burns let the
  // flames heat their way through it (measured: see the commit).
  PREFECT_DOUSE_TICKS: 10,
  // He fights a burning building with a tile this close to him (Chebyshev,
  // tiles): the 4 he used to douse everything within, from the road he runs to.
  PREFECT_DOUSE_REACH: 4,
  // A prefecture sends no fresh prefect to a fire while this many of its own
  // are on fire duty (its patrolling prefects called to a fire count too);
  // the next prefecture in reach sends one instead. As many as a block alight
  // needs to be fought building by building, not one for every burning
  // building: unchecked, one street on fire drew 17 from one post.
  PREFECT_FIRE_CREW: 3,
  // Prefects against raiders and Caesar's legionaries (sim/prefectFight.js).
  // A prefect on his rounds stops and fights an enemy this close (tiles, from
  // the middle of his tile): close by only, he never leaves his street for one.
  PREFECT_FIGHT_REACH: 2,
  // ...and keeps standing his ground until the enemy is farther than this,
  // then goes back to his rounds (a little more than the reach, so an enemy
  // stepping to and fro at the edge does not start and end a fight every tick).
  PREFECT_FIGHT_LEASH: 3,
  // A prefect as a fighter: a watchman with a club, not a soldier. About a
  // third of a legionary's attack (14) and a little more than a third of his
  // health (110), light defense, and a blow as often as a legionary's (every
  // cooldown ticks). Alone he loses to a raider (Normal: about 4 blows of ~10
  // kill him while he deals ~3.5 a blow to the raider's 70): prefects slow a
  // warband, they do not stop it. He does not heal; a fresh one comes from
  // the prefecture once he falls.
  PREFECT_COMBAT: { hp: 40, attack: 5, defense: 2, cooldown: 20 },
  // Prefects killed within this many days and PREFECT_LOSS_NEAR tiles of each
  // other make one message, and only from the second on: one prefect falling
  // says nothing, a street's watch cut down does.
  PREFECT_LOSS_DAYS: 10,
  PREFECT_LOSS_NEAR: 12,

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
  DISEASE_RATE: 0.2, // was 0.5, then 0.31: disease came too fast on Normal (v0.12.1 playtests, then a 5-year sandbox save: 37 outbreaks)
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
  // Gardens and statues fade untended (sim/gardens.js; Colonia's own, where
  // the mission has the Topiaria). Full for CARE_GRACE_DAYS after a
  // gardener's visit, then a step down every CARE_STEP_DAYS (at Normal's
  // pace, difficulty lever careFade) through CARE_LEVELS: 80%, 60%, 40%, and
  // the floor, 25% of its bonus, from 96 days (six months) on. Steps, not a
  // smooth fade, so desirability is worked out again a few times a season,
  // never every day.
  CARE_GRACE_DAYS: 16, // a month
  CARE_STEP_DAYS: 20,
  CARE_LEVELS: [100, 80, 60, 40, 25], // % of its desirability at each step

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
  // Festivals (sim/religion.js). Each god counts the months since its last
  // festival (any size). The original's mood target held +12 the month of a
  // festival, 0 a year on and -28 at most; Colonia's festival boost stands in
  // for the +12, so a god loses nothing for FESTIVAL_FREE_MONTHS, then a
  // point of its mood target a month, FESTIVAL_NEGLECT_MAX at most (40
  // months on, as in the original). Not below 800 people, where the gods'
  // targets are flat and they never strike.
  FESTIVAL_FREE_MONTHS: 12,
  FESTIVAL_NEGLECT_MAX: 28,
  // Months before the next festival (small, large, grand), city-wide. Five
  // gods at a small festival each every 2 months come round in 10, inside
  // the free year; a large one in the round still makes it (4 + 4 x 2 = 12).
  // A grand one is the rare treat it was (a round with one takes 16 months).
  // The original had no cooldown, only one festival planned at a time, held
  // 2, 3 or 4 months after it was ordered.
  FESTIVAL_COOLDOWN: [2, 4, 8],
  // ...but the people tire of them: a festival held sooner than this many
  // months after the last one (any god's) lifts the city mood only in
  // proportion (2 months: two thirds). 3 was the small festival's cooldown
  // before the gods took turns, so the city mood a festival every 2 months
  // keeps (about +5 to +7) is what one every 3 months kept before (+4 to
  // +8); at full value it would hold +7 to +11 for good. The gods' own
  // festival boost is never cut.
  FESTIVAL_CITY_FULL_MONTHS: 3,
  // Goods: food from the granaries, a share of a month of the city's food
  // (FOOD_PER_PERSON_MONTH), one load at least (Colonia's own); wine from the
  // warehouses for a large or grand festival: the original's grand festival
  // took population / FESTIVAL_WINE_PEOPLE + 1 loads, a large one half of
  // that here, rounded up.
  FESTIVAL_FOOD_SHARE: [0.05, 0.1, 0.2],
  FESTIVAL_WINE_PEOPLE: 500,

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
  // Prices (sim/prices.js; Colonia's own rules: the original had one price table for every partner).
  // The province's farthest partner trades at this much above base, its nearest at base, the others
  // in proportion to their route's length. Both ways: a far partner's goods cost more to bring in, and
  // a far market pays more for goods rare there. A quarter is enough to make the far routes worth
  // their longer waits without making the near ones pointless.
  TRADE_DISTANCE_PREMIUM: 0.25,
  // Each good's price drifts each New Year: last year's drift pulled halfway back toward 1, plus a
  // seeded step of up to +-10%, never beyond +-15%. Enough that a good can be worth switching to
  // or away from, never so much that a city's trade plan breaks in one year.
  PRICE_DRIFT_MAX: 0.15,
  PRICE_DRIFT_STEP: 0.1,
  PRICE_DRIFT_PULL: 0.5,

  // --- Fishing (sim/fishing.js) -------------------------------------------
  // The original's pace: a shipyard builds a boat in 16 days at full staff; a
  // wharf's boat waits (1.02 - staff) x 10 days at the wharf (0.2 days at full
  // staff, 5.2 at half, never with nobody), sails to the nearest fishing
  // ground, fishes 4 days and lands one load. Boats sail at walking speed.
  SHIPYARD_BOAT_DAYS: 16,
  // Colonia's own rule (the original's boats cost nothing): a boat takes one
  // lot of timber, used at launch, and the yard builds only while it holds
  // the lot. It holds up to two lots (data/buildings.js inputCap): the boat on
  // the slip and the next, so a spare that sails off is followed at once.
  SHIPYARD_BOAT_TIMBER: 100,
  FISH_DAYS: 4, // days a boat fishes per trip (at the difficulty's production 1; slower where it is lower)
  FISH_CATCH: 100, // units of fish a boat lands per trip
  BOAT_WAIT_DAYS: 10, // x (1.02 - staffing): the boat's wait at the wharf between trips
  WHARF_FULL: 200, // the boat waits while its wharf holds this much fish (two catches) or more
  // Fishing grounds, derived from the terrain (world/map.js computeFishing):
  FISH_BODY_MIN: 80, // tiles: smaller water is a pond, with no fish worth a boat
  // More than the original's 8 a map: at one per 250 tiles, 4 a body and 8 a
  // map, a whole coastline had 4 grounds and most rivers 1 or 2 (playtest:
  // "pretty light"). Now one per 150 tiles of water, up to 10 a body, and the
  // map's limit grows with its area (8 on a 96x96 map, at most 24).
  FISH_TILES_PER_GROUND: 150, // one ground per this much water, 1 to FISH_GROUNDS_PER_BODY a body
  FISH_GROUNDS_PER_BODY: 10,
  FISH_GROUNDS_MAX: 8, // on a 96x96 map, bigger bodies first; scaled by the map's area (fishingGroundsMax)
  FISH_GROUNDS_MAX_CAP: 24, // on the biggest maps
  FISH_GROUND_SPACING: 10, // tiles (Chebyshev) between two grounds on the same water

  // --- Sea raids and the fleet (sim/navy.js; ships' fighting numbers: data/units.js) ---
  // Not in the original, which had no war at sea. On a map whose navigable
  // water reaches the sea entry, with the Sea raids switch on, each raid comes
  // by sea with this chance (rolled when the scouts see it, on a random
  // stream of its own: a raid that comes by land is the raid it always was).
  SEA_RAID_SHARE: 1 / 3,
  RAID_SHIP_CREW: 8, // raiders a ship carries: a warband of 14 comes in 2 ships...
  RAID_SHIP_MAX: 5, // ...and never more than this many
  LANDING_WALK: 6, // the landing: the shore whose walk to the nearest home is closest to this (tiles)...
  LANDING_MIN_WALK: 3, // ...and never closer than this
  SEA_SAIL_MAX_DAYS: 60, // ships that have not put their raiders ashore by then give up
  // Fire pots: what makes a raid by sea dangerous before it lands. Each ship
  // throws at most RAID_SHIP_POTS (one every 2 days, range 5): at a fishing
  // boat (it sinks) or a building by the shore (damage x the difficulty's
  // enemy strength, and fire risk if it can burn: prefects clear that as
  // always). Ten pots are 200 damage: four huts, or half a dock, per ship.
  RAID_SHIP_POTS: 10,
  RAID_SHIP_POT_DAMAGE: 20,
  RAID_SHIP_FIRE_HEAT: 25,
  // The Navalia builds a liburnian from these (by cart, only while a staffed
  // Naval Station has an empty berth) in this many days at full staff.
  LIBURNIAN_COST: { timber: 300, iron: 100, linen: 100 },
  NAVALIA_BUILD_DAYS: 30,
  STATION_GUARD: 12, // a squadron at its berth fights raider ships this close to it (tiles)...
  STATION_GUARD_DEPLOYED: 8, // ...deployed, this close to its rally point...
  STATION_CHASE: 4, // ...and chases one at most this much farther

  // Training at the Campus and the Portus (sim/training.js). Training takes
  // time, so the academy is a stage of the recruit's way and not a gate he is
  // waved through: a recruit stays ACADEMY_TRAIN_DAYS at the academy (a game
  // month), a new liburnian PORTUS_TRAIN_DAYS moored at the Portus (a crew
  // learns its strokes in half that), and the days count only while the
  // school is fully staffed. A new ship's trip there that is not done in
  // DRILL_MAX_DAYS (no way there, say; the days moored at the Portus aside)
  // is given up, and the ship rows on to its berth untrained.
  ACADEMY_TRAIN_DAYS: 16,
  PORTUS_TRAIN_DAYS: 8,
  // A school short of staff pauses its pupils, but a recruit (or ship) kept
  // waiting more than this many days in all goes on untrained: his place in
  // the fort is held while he waits, so a school that never gets its staff
  // back would keep a fort short of a man for ever.
  TRAIN_WAIT_MAX_DAYS: 32,
  DRILL_MAX_DAYS: 40,
  // Soldiers (and ships) at rest who joined untrained go to be trained too,
  // TRIPS_AT_ONCE at a time from each fort or station, counting one still
  // on his way back, and never the last man at home: the fort is never
  // emptied for the drill yard, and a raid finds it short of one man.
  // Measured (a fort of 8 untrained legionaries, the Campus by the same road
  // about 10 or 20 tiles' walk away): one at a time, all 8 trained and home
  // in 15 or 23 months, never fewer than 7 in the yard; two at a time, in 8
  // or 11.5 months, but down to 6. One: a fort a quarter short when a
  // warband comes is a weaker fort than one trained a little later.
  TRIPS_AT_ONCE: 1,
  // A trip given up (no way there over land in its time) holds back that
  // fort's or station's next one this many days, or it would send man after
  // man down the same dead end.
  TRIP_RETRY_DAYS: 16,

  // --- Ratings ------------------------------------------------------------
  // Culture and prosperity move toward what the city deserves by at most
  // these many points a month; peace grows while the mood is good. These set
  // how fast a mission's goals can be met (sim/pace.js).
  CULTURE_STEP: 4,
  PROSPERITY_STEP: 2,
  HIPPODROME_PROSPERITY: 2, // on the prosperity target while the hippodrome has races
  PEACE_START: 20,
  PEACE_PER_MONTH: 1, // while the mood is at least PEACE_MOOD
  PEACE_MOOD: 45,
  PEACE_RAID_MONTH: 2, // peace lost in a month when enemies were in the province, instead of any gain

  // --- Emperor -------------------------------------------------------------
  REQUEST_INTERVAL_MONTHS: [14, 26],
  FIRST_REQUEST_MONTHS: [36, 48], // the Emperor's first request: in the fourth year (x difficulty.requestInterval; was 14-26 like the rest, then 24-36: still too early for a city to get going)...
  REQUEST_MIN_POP: 500, // ...and not before the city has this many people (was 150, then 400)
  REQUEST_DEADLINE_MONTHS: 12,
  FAVOR_START: 50,

  // --- Caesar's legions (sim/legion.js) -------------------------------------
  // The original's teeth for a governor out of favor: no recall at 0, but an
  // army. Checked daily: favor at LEGION_FAVOR or less, with no attack already
  // coming or on the map, warns the governor and sets the legions marching.
  LEGION_FAVOR: 10,
  LEGION_MARCH_DAYS: 192, // 12 months on the road from Rome; recovering favor does not stop them, only what they do on arrival
  // Men in the first, second, third and every later attack: the original's
  // 32 / 64 / 96 / 144 halved for Colonia's 8-man forts, x the difficulty's
  // raidSize, at most LEGION_MAX.
  LEGION_SIZES: [16, 32, 48, 72],
  LEGION_MAX: 75,
  LEGION_HALT_DAYS: 192, // the middle favor band halts the army only in its siege's first year; after that it fights on
  LEGION_RESPECT: 10, // favor when the army is destroyed (never when it marches home)
  LEGION_CAMP_DAYS: 4, // an army with nothing it can reach for this long goes home
  LEGION_MAX_DAYS: 384, // ...and any army after two years in the province, whatever holds it there
  LEGION_BREAK_COST: 20, // how much the legions' route finding dislikes breaking through a building that is not their target (a wall: 14)
  // The mission is lost when the city is overrun: more invaders (Caesar's
  // men and raiders) than the province's soldiers plus OVERRUN_MARGIN, while
  // the population is under OVERRUN_SHARE of its peak. The original's rule.
  OVERRUN_MARGIN: 2,
  OVERRUN_SHARE: 0.25,

  // --- Distant battles (sim/battle.js; the cities: data/battles.js) ----------
  // Caesar asks for troops; the battle is fought BATTLE_MONTHS later. Troops
  // more than BATTLE_IN_TIME months away when it comes arrive too late.
  BATTLE_MONTHS: 24,
  BATTLE_IN_TIME: 2,
  BATTLE_FAVOR: { won: 25, weak: -10, late: -25, none: -50 },
  BATTLE_FOREIGN_MONTHS: 24, // a lost city is in enemy hands this long (no new request meanwhile)
  // Losses on a win by the advantage 100 x (Rome - enemy) / Rome: [advantage
  // up to, share lost]. The original's table; its 5% and 0% rows could never
  // be reached (the advantage stays under 100 while the enemy has any
  // strength), so they are left out.
  BATTLE_LOSSES: [[9, 0.7], [24, 0.5], [49, 0.25], [74, 0.15], [Infinity, 0.1]],
  BATTLE_MONTH_UNITS: 4, // map units of the empire map an army covers in a month (data/battles.js paths)
  BATTLE_MIN_MONTHS: 3, // the shortest march to a threatened city
  // The sandbox (raids on): from SANDBOX_BATTLE_FROM months, a request each
  // month with SANDBOX_BATTLE_CHANCE (about one every three years), at least
  // SANDBOX_BATTLE_GAP months after the last one ended.
  SANDBOX_BATTLE_FROM: 24,
  SANDBOX_BATTLE_CHANCE: 1 / 36,
  SANDBOX_BATTLE_GAP: 12,
};

/** Derived constants (computed once, never edit these directly). */
export const TICKS_PER_MONTH = CONFIG.TICKS_PER_DAY * CONFIG.DAYS_PER_MONTH;
export const HALF_W = CONFIG.TILE_W / 2;
export const HALF_H = CONFIG.TILE_H / 2;

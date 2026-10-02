/**
 * game.js
 * ----------------------------------------------------------------------------
 * The Game object owns the whole simulation state and runs the systems in a
 * fixed order every tick. It has NO knowledge of the DOM or canvas, so it runs
 * identically in the browser and in Node (tests, balance scripts).
 *
 * Tick order:
 *   1. advance the calendar
 *   2. move walkers, then soldiers/raiders/missiles (sim/military.js)
 *   3. daily logic for the buildings whose "phase" matches this tick
 *      (spreads work evenly across the day instead of spiking at midnight;
 *      a home's disease risk comes after its fire risk)
 *      then criminals: prefects and soldiers catch them, prefects hunt
 *   4. on a new day:   labor, no-road notices, water, desirability, city
 *                      stats, entertainment base, wine sources, mid-month
 *                      goods use, immigration, fires, sick homes, home moods
 *                      (day 8), trade, raid progress, Caesar's legions (their
 *                      march, the siege) and the check for a city overrun
 *   5. on a new month: consumption, finances, army pay, the governor's
 *                      salary, raid warnings, city mood, home moods,
 *                      religion, ratings, city health, Emperor, distant
 *                      battles, farm season notice, the count of recent
 *                      gifts, the victory check
 *   6. on a new year:  tribute, ledger rollover, the salary's favor, trade
 *                      quotas, crime and disease counts
 *   7. on a new day, after all that: the crime roll
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { EventBus } from './events.js';
import { RNG } from './rng.js';
import { log } from './debug.js';
import { generateMap, mapOptions } from '../world/mapgen.js';
import { PathFinder } from '../world/pathfinding.js';
import { BUILDINGS } from '../data/buildings.js';
import { GameTime } from '../sim/time.js';
import { computeAccessRoad } from '../sim/entities.js';
import { updateWalkers } from '../sim/walkers.js';
import { updateHouse, consumeHouse, useGoods, updateWineSources } from '../sim/housing.js';
import { updateProducer, updateWorkshop, farmSeasonNotice } from '../sim/production.js';
import { updateStorage } from '../sim/storageOrders.js';
import { updateMarketBuyer } from '../sim/market.js';
import { updateTraining, updateVenue, updateEntertainmentBase } from '../sim/entertainment.js';
import { updateServiceSpawns, updateLaborAccess } from '../sim/services.js';
import { updateRisk, updateFires } from '../sim/risk.js';
import { updateRoadNotices } from '../sim/roadAccess.js';
import { updateLabor } from '../sim/labor.js';
import { updateWater } from '../sim/water.js';
import { updateDesirability } from '../sim/desirability.js';
import { computeCityStats, computeSentiment, updateImmigration, updateEmigration, indexHomesByRoad } from '../sim/population.js';
import { monthlyEconomy, yearlyEconomy, newLedger } from '../sim/economy.js';
import { repayLoan } from '../sim/loans.js';
import { newGodState, newGodMood, updateReligion } from '../sim/religion.js';
import { GOD_KEYS } from '../data/gods.js';
import { newTradeState, updateTrade, resetTradeYear, updateDock, tradeMonthly } from '../sim/trade.js';
import { pricesNewYear } from '../sim/prices.js';
import { updateShipyard, updateWharf } from '../sim/fishing.js';
import { updateRatings, checkOutcome, enemiesInProvince } from '../sim/ratings.js';
import { updateEmperor, scheduleNextRequest, newGiftState, giftsMonth } from '../sim/emperor.js';
import { newGovernorState, paySalary, salaryNewYear } from '../sim/governor.js';
import { newMilitaryState, updateMilitary, updateBarracks, militaryDaily, militaryMonthly, updateDemand, disbandFort } from '../sim/military.js';
import { updatePrefectFights } from '../sim/prefectFight.js';
import { updateNavalia, stationLost, shoreBerth } from '../sim/navy.js';
import { caesarDaily } from '../sim/legion.js';
import { battleMonthly, archesToBuild } from '../sim/battle.js';
import { DIFFICULTY, difficultyOf } from '../data/difficulty.js';
import { closeGoodsMonth } from '../sim/goodsLedger.js';
import { updateHomeMoods } from '../sim/mood.js';
import { newCrimeState, updateCrime, updateCriminals, crimeNewYear } from '../sim/crime.js';
import { newHealthState, updateDiseaseRisk, updateSickHomes, updateCityHealth, healthNewYear, refreshDiseaseGate } from '../sim/disease.js';

// Difficulty levels live in data/difficulty.js; re-exported here for older imports.
export { DIFFICULTY } from '../data/difficulty.js';

/** Fresh city-wide state for a new game. */
export function newCityState(scenario, funds, savings = 0) {
  return {
    name: scenario.name,
    treasury: funds,
    taxRate: CONFIG.DEFAULT_TAX_RATE,
    wage: CONFIG.DEFAULT_WAGE,
    population: 0,
    plebs: 0,
    patricians: 0,
    houses: 0,
    tierCounts: [],
    avgTier: 0,
    fedShare: 1,
    workforce: 0,
    jobs: 0,
    employed: 0,
    unemployed: 0,
    unemploymentRate: 0,
    laborPriority: [],
    loan: null, // a loan from Rome being repaid: { left, monthly } (sim/loans.js)
    laborByCat: {},
    sentiment: 60,
    sentimentFactors: {},
    festivalBoost: 0,
    festivalCooldown: 0,
    venusBoost: 0, // Venus's blessing (+) or wrath (-) on the city mood, decaying (sim/religion.js)
    immigrationAcc: 0,
    vacancies: 0,
    goodsDemand: {},
    entBase: 0, // city-wide entertainment every home gets (sim/entertainment.js)
    entCoverage: {}, // % of the population each venue kind can seat
    wineSources: 0, // for the top housing levels (sim/housing.js updateWineSources)
    ratings: { culture: 0, prosperity: 0, peace: CONFIG.PEACE_START, favor: CONFIG.FAVOR_START },
    coverage: {},
    gods: newGodState(),
    trade: newTradeState(scenario.partners || []),
    finance: { thisYear: newLedger(), lastYear: null },
    request: null,
    nextRequestMonth: CONFIG.FIRST_REQUEST_MONTHS[0], // set by scheduleNextRequest for a new game
    governor: newGovernorState(scenario, savings), // rank, salary, personal savings (sim/governor.js)
    archesEarned: 0, // triumphal arches granted for distant battles won (sim/battle.js)
    gifts: newGiftState(), // gifts to the Emperor within the last year (sim/emperor.js)
    produced: {},
    foodFlow: { harvested: 0, stored: 0, toMarket: 0, sold: 0, eaten: 0, shortfall: 0 },
    foodFlowLast: null,
    goodsFlow: {}, // this month's goods book (sim/goodsLedger.js)
    goodsFlowLast: null, // last month's
    lostCitizens: 0,
    taxCoverage: 0,
    lastMonth: { wages: 0, taxes: 0 },
    history: [],
    stats: { fires: 0, collapses: 0, evolutions: 0, devolutions: 0, immigrated: 0, emigrated: 0, peakPopulation: 0, requestsMet: 0, requestsFailed: 0 },
    crime: newCrimeState(), // this year's protesters, thieves, riots... (sim/crime.js)
    health: newHealthState(), // city health and this year's outbreaks (sim/disease.js)
    flags: {},
    victory: false,
    defeat: false,
  };
}

export class Game {
  /**
   * @param {object} opts
   * @param {object} opts.scenario   scenario definition (data/scenarios.js)
   * @param {object} [opts.flags]    debug flags (core/debug.js)
   * @param {object} [opts.restore]  internal: prebuilt state from a save file
   * @param {number} [opts.savings]  the governor's savings brought from the last mission
   */
  constructor({ scenario, flags = {}, restore = null, savings = 0 }) {
    if (!scenario) throw new Error('Game needs a scenario');
    this.flags = flags;
    this.log = log;
    this.events = new EventBus();
    this.scenario = scenario;
    this.difficultyKey = DIFFICULTY[scenario.difficulty] ? scenario.difficulty : 'normal';
    this.difficulty = difficultyOf(this.difficultyKey); // every difficulty lever, see data/difficulty.js
    this.cheats = { freeBuild: false };
    this.buildings = new Map();
    this.walkers = new Map();
    this.fires = new Map(); // tile index -> days left burning
    this.messages = [];
    this.dirty = { des: true, water: true, roads: true };
    this.lastUndo = null;
    this.homeByRoad = new Map();
    this.unlockedSet = new Set(scenario.unlocks === 'all' ? Object.keys(BUILDINGS) : scenario.unlocks || []);

    if (restore) {
      // save.js fills in map, time, rng, city, entities
      Object.assign(this, restore);
    } else {
      const seed = flags.seed ?? scenario.map.seed;
      this.seed = seed;
      this.rng = new RNG(`${seed}:sim`);
      const { map, info } = generateMap({ ...mapOptions(scenario.map), seed });
      map.computeNavigation(); // rivers/sea reaching the map edge (ships, docks)
      map.computeFishing(); // water with fish and its fishing grounds (wharves)
      this.map = map;
      this.mapInfo = info;
      this.time = new GameTime(scenario.startYear);
      this.nextBuildingId = 1;
      this.nextWalkerId = 1;
      this.nextMessageId = 1;
      this.city = newCityState(scenario, flags.money ?? scenario.funds, savings);
      scheduleNextRequest(this, true);
    }
    // Military state. `??=` keeps what a save restored and fills in defaults
    // for new games and for saves made before the military existed.
    this.units ??= new Map(); // unit id -> Unit (soldiers and raiders)
    this.nextUnitId ??= 1;
    this.wallHp ??= new Map(); // tile index -> remaining hp of a damaged wall/gate
    this.ruins ??= new Map(); // rubble tile index -> what fell there, why and when (sim/ruins.js)
    this.military ??= newMilitaryState(scenario, this.time, flags);
    this.city.crime ??= newCrimeState(); // saves from before crime (v4)
    this.city.health ??= newHealthState(); // saves from before disease (v4, v5)
    for (const g of GOD_KEYS) this.city.gods[g] ??= newGodMood(); // a god a save lacks starts afresh
    this.city.venusBoost ??= 0;
    this.projectiles = []; // arrows and sling stones in flight (not saved)
    this.enemyField = null; // raider flow field (derived, see military.js)
    this.events.on('buildingRemoved', ({ building }) => {
      if (building.def.kind === 'fort') disbandFort(this, building);
      if (building.def.kind === 'station') stationLost(this, building); // its ships go to another station, or are laid up
    });
    this.pf = new PathFinder(this.map);
    this.processRoadChanges();
  }

  /** Can the player build this building/tool in the current scenario? */
  isUnlocked(key) {
    if (key === 'clear') return true;
    // A triumphal arch is never unlocked by a mission: Caesar grants one for
    // each distant battle won (sim/battle.js), whatever the scenario allows.
    if (BUILDINGS[key]?.kind === 'arch') return archesToBuild(this) > 0;
    if (this.flags.unlockall || this.scenario.unlocks === 'all') return true;
    return this.unlockedSet.has(key);
  }

  markDirty(...keys) {
    for (const k of keys) this.dirty[k] = true;
  }

  /**
   * Player-facing notification. level: info | good | warn | bad | imperial.
   * A click on it glides to tile `x`, `y`; or, with `opts.empire` (a
   * traveler kind of ui/empireMap.js: 'warband', 'legion'), opens the empire
   * map with that traveler picked out, for news of something still on its way.
   */
  message(text, level = 'info', x, y, opts = null) {
    const m = { id: this.nextMessageId++, text, level, x, y, date: this.time.shortLabel() };
    if (opts && opts.empire) m.empire = opts.empire;
    this.messages.unshift(m);
    if (this.messages.length > 150) this.messages.pop();
    this.events.emit('message', m);
    this.log.info(`[msg:${level}] ${text}`);
    return m;
  }

  /** Called by construction after any map edit. */
  onMapEdited() {
    this.markDirty('roads', 'des', 'water');
    this.processRoadChanges();
    updateWater(this);
    this.map.touch();
  }

  /** Road network ids + every building's access road. */
  processRoadChanges() {
    this.map.computeRoadNetworks();
    for (const b of this.buildings.values()) computeAccessRoad(this, b);
    indexHomesByRoad(this);
    this.dirty.roads = false;
  }

  /**
   * Rebuild every derived layer (water coverage, desirability, road networks,
   * statistics) WITHOUT advancing the simulation. Used after loading a save.
   */
  recomputeDerived() {
    this.processRoadChanges();
    updateWater(this);
    updateDesirability(this);
    this.dirty.des = false;
    computeCityStats(this);
    updateEntertainmentBase(this);
    updateWineSources(this);
    updateDemand(this);
    this.map.touch();
  }

  /** Advance the simulation one tick. */
  tick() {
    const t = this.time.advance();
    updateWalkers(this);
    updateMilitary(this);
    // After the units moved, before criminals: a prefect fighting an enemy is
    // held, so he neither grapples with a thief nor sets off on a hunt.
    updatePrefectFights(this);
    updateCriminals(this);
    const phase = this.time.tick;
    for (const b of this.buildings.values()) {
      if (b.phase === phase) this.updateBuilding(b);
    }
    if (t.newDay) this.onDay();
    if (t.newMonth) this.onMonth();
    if (t.newYear) this.onYear();
    // The crime roll comes last, so on the 1st of a month it sees the homes'
    // fresh moods and counts toward the new month (peace) and year.
    if (t.newDay) updateCrime(this);
  }

  /** Daily logic for one building (called on its phase tick). */
  updateBuilding(b) {
    try {
      switch (b.def.kind) {
        case 'house': updateHouse(this, b); break;
        case 'farm':
        case 'raw': updateProducer(this, b); break;
        case 'workshop': updateWorkshop(this, b); break;
        case 'granary':
        case 'warehouse': updateStorage(this, b); break;
        case 'market': updateMarketBuyer(this, b); break;
        case 'training': updateTraining(this, b); break;
        case 'venue': updateVenue(this, b); break;
        case 'barracks': updateBarracks(this, b); break;
        case 'navalia': updateNavalia(this, b); break;
        case 'station':
        case 'portus': shoreBerth(this, b); break; // (its berths, cached; the ships sail in sim/navy.js)
        case 'dock': updateDock(this, b); break;
        case 'shipyard': updateShipyard(this, b); break;
        case 'wharf': updateWharf(this, b); break;
        default: break;
      }
      if (!this.buildings.has(b.id)) return;
      updateServiceSpawns(this, b);
      updateLaborAccess(this, b);
      updateRisk(this, b);
      if (b.house && this.buildings.has(b.id)) updateDiseaseRisk(this, b);
    } catch (err) {
      this.log.error(`Building ${b.id} (${b.type}) update failed:`, err);
    }
  }

  onDay() {
    if (this.dirty.roads) this.processRoadChanges();
    updateLabor(this);
    updateRoadNotices(this); // after labor: the same day's access roads
    updateWater(this);
    if (this.dirty.des) {
      updateDesirability(this);
      this.dirty.des = false;
    }
    computeCityStats(this);
    refreshDiseaseGate(this); // saved, so homes ticking before tomorrow's count agree after a load
    updateEntertainmentBase(this);
    updateWineSources(this);
    if (this.time.day === CONFIG.GOODS_MIDMONTH_DAY) {
      for (const b of this.buildings.values()) if (b.house) useGoods(this, b);
    }
    indexHomesByRoad(this);
    updateImmigration(this);
    updateEmigration(this);
    updateFires(this);
    updateSickHomes(this);
    if (this.time.day === CONFIG.MOOD_MIDMONTH_DAY) updateHomeMoods(this); // day 0's runs in onMonth
    updateTrade(this);
    militaryDaily(this);
    caesarDaily(this); // Caesar's legions, and the loss of a city overrun (sim/legion.js)
    if (enemiesInProvince(this)) this.city.raidMonth = true; // no peace gained this month (sim/ratings.js)
    this.events.emit('day', this.time);
  }

  onMonth() {
    for (const b of this.buildings.values()) if (b.house) consumeHouse(this, b);
    // The instalment first, so the month's debt check (in monthlyEconomy)
    // sees a treasury it emptied.
    repayLoan(this);
    monthlyEconomy(this);
    militaryMonthly(this);
    paySalary(this); // last of the month's money, so it never puts the city in debt
    computeSentiment(this);
    updateHomeMoods(this); // after the month's city mood, which every home starts from
    updateReligion(this);
    updateRatings(this);
    this.city.crime.month = false; // the peace rating has read it
    this.city.raidMonth = false; // (and this)
    updateCityHealth(this);
    updateEmperor(this);
    battleMonthly(this); // Caesar's calls for troops and the distant battles (sim/battle.js)
    tradeMonthly(this); // news of a partner's demand changing this month (sim/tradeDemand.js)
    farmSeasonNotice(this); // Insane: the farms stop in winter
    const c = this.city;
    c.foodFlowLast = { ...c.foodFlow };
    for (const k in c.foodFlow) c.foodFlow[k] = 0;
    closeGoodsMonth(this);
    if (c.festivalCooldown > 0) c.festivalCooldown--;
    giftsMonth(this);
    c.history.push({ m: this.time.totalMonths, pop: c.population, treasury: Math.round(c.treasury), sentiment: c.sentiment });
    if (c.history.length > 240) c.history.shift();
    checkOutcome(this);
    this.events.emit('month', this.time);
  }

  onYear() {
    yearlyEconomy(this);
    salaryNewYear(this); // the year's salary against the governor's rank
    resetTradeYear(this);
    pricesNewYear(this); // news of the year's biggest price moves (sim/prices.js: prices follow the date)
    crimeNewYear(this);
    healthNewYear(this);
    this.events.emit('year', this.time);
  }

  /** Run many ticks at once (tests, fast-forward). */
  runTicks(n) {
    for (let i = 0; i < n; i++) this.tick();
  }

  /** Convenience: run whole days. */
  runDays(days) { this.runTicks(days * CONFIG.TICKS_PER_DAY); }
}

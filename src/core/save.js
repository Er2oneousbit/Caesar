/**
 * save.js
 * ----------------------------------------------------------------------------
 * Save / load.
 *
 * Format (JSON):
 *   {
 *     format: 'colonia-save', version: SAVE_VERSION,
 *     meta:   { city, scenarioId, date, population, treasury, difficulty, savedAt },
 *     scenario (sandbox: in full; campaign: { id }), flags, difficulty,
 *     rng, time, seed, map (base64 layers), buildings[], walkers[], fires[],
 *     ruins[], units[], military, wildlife, wallHp[], city, messages[], nextIds, camera
 *   }
 *
 * Raiders' peoples and wolves (data/peoples.js, sim/wildlife.js) need no
 * upgrade step: `military.people` missing is the scenario's people from
 * then on, and a raid such a save had scouted or under way is marked the
 * generic band it was (core/game.js); a save without `wildlife` has no
 * packs. Wolves
 * are units like any other (type 'wolf', side 'wild', with `pack`).
 *
 * Version history:
 *   1  first release
 *   2  military: units[], military (raid schedule + stats), wallHp[], map.wall.
 *      Version 1 saves load fine; the missing parts start empty.
 *   3  map layers may be PackBits-compressed ("pb:" + base64), and walker
 *      and soldier paths are stored as 16-bit values ("u16:" + base64). An
 *      Uber map (256x256) would otherwise spend ~600 KB of every save on
 *      layers that are mostly runs of the same byte, and long paths cost
 *      about 6 characters a step as JSON numbers. Older saves (plain base64
 *      layers, paths as arrays) load.
 *   4  the 20-level housing ladder (v0.7): house levels were renumbered and
 *      homes got new fields, so saves before version 4 are refused with a
 *      readable message (until 1.0, a release may break older saves).
 *   5  home mood and crime: homes have a mood, hunger streak, criminal flag
 *      and police timer; city.crime holds the year's counts; protesters,
 *      thieves and rioters are walkers. Version 4 saves load: every new field
 *      has a safe default (an occupied home starts at the city's mood, no
 *      flags, no police cover, no criminals about), see upgradeV4().
 *   6  disease: homes have a disease risk and sick days; city.health holds
 *      city health and the year's outbreaks; physicians can be on their way
 *      to a sick home. Version 5 (and 4) saves load: no home is sick, every
 *      risk starts at 0 and city health at its starting value, see
 *      upgradeV5().
 *   7  three changes in one release (v0.12), each loading older saves:
 *      - the original's five gods: Mercury and Venus took the places of two
 *        gods of Colonia's own, Jupiter and Vesta. Each god has an `angered`
 *        flag, and city.venusBoost is Venus's factor in the city mood.
 *        upgradeGodsV6() renames the old gods on the raw data before
 *        anything is built from it (their temples, their moods, every home's
 *        access to them, their priests), so no temple is dropped as an
 *        unknown building and no home loses a god.
 *      - storage orders: granaries and warehouses hold `orders` (per good
 *        'accept', 'refuse' or 'get') and an Empty switch (`emptying`) in
 *        place of the old `accept` flags; carts can be out fetching
 *        ('collect'). Each accept flag becomes Accept or Refuse and nothing
 *        is emptying, see upgradeOrdersV6().
 *      - ruins: rubble remembers what stood there, why it fell and when
 *        (ruins[]: one entry per fallen building with the tiles it still
 *        covers, see sim/ruins.js). Older saves load with rubble that has no
 *        record; its info panel says what it always said.
 *   8  ships wait at the dock while dock workers carry goods both ways
 *      (sim/trade.js): a moored ship holds what it still has to unload
 *      (`unload`), what it still wants (`wants`), its running `deal`, when
 *      it tied up (`mooredTick`) and its crane's progress; a dock worker
 *      fetching an export holds a `claim` and walks in state 'dockFetch'.
 *      A version 7 ship at the dock had traded everything on arrival (and
 *      was logged then): it loads with nothing left to trade and casts off
 *      on the first tick, see upgradeShipsV7(). Goods on a quay stay there
 *      and dock workers cart them on, as before.
 *   9  fish and the hippodrome: fish is a fifth food (every food list,
 *      granary, warehouse, market and dock stock and trade setting has it);
 *      shipyards, wharves and fishing boats (walkers) keep their state; a
 *      hippodrome is three linked buildings (`parts`, `main`); homes have
 *      hippodrome access and venues a hippodrome show count. Fishing grounds
 *      are derived from the terrain at load, never saved. Older saves load
 *      with no fish, no boats and the new keys at 0, see upgradeFishV8().
 *  10  the cloth industry: flax, linen and clothing are goods (every
 *      warehouse and dock stock and trade setting has them), homes and
 *      markets hold clothing, and homes need it from the Insula up. Older
 *      saves load with the new goods at 0 and no trade in them, see
 *      upgradeClothV9(); their Tenements and better homes start with three
 *      months of clothing, and fall back after that unless a market brings
 *      more.
 *  11  sea raids and the fleet (sim/navy.js): military.seaRaids (the
 *      switch), the fleet's demand and new stats; navalia (stock, progress)
 *      and naval stations (rally); liburnians (station, slot) and raider
 *      ships (crew, pots, route) are units; a raid by sea has `sea`,
 *      `landing`, `landed` and `landedDay`. Older saves load with no fleet,
 *      the switch on (the default) and any raid the scouts already saw
 *      coming by land as it was; the raids after it may come by sea, see
 *      upgradeNavyV10().
 *  12  training (sim/training.js), and large temples: soldiers and
 *      liburnians have a `trained` flag and, while on a trip to a Military
 *      Academy or the Portus, `drill` (its id), `drillDay` and `drillDays`
 *      (its time limit); a recruit walker may be on his way to an academy
 *      (state 'toAcademy', `academy`, then `trainedAt`) and carries `trained`; academies and the Portus count `trainedHere`,
 *      forts and stations hold `drillWait`. Large temples are new building
 *      types and need nothing. Older saves load with every soldier, ship and
 *      recruit untrained and nobody on a trip, see upgradeTrainingV11().
 *  13  the governor (sim/governor.js): city.governor holds his rank, the
 *      salary he draws (salaryRank), his personal savings and the salary
 *      paid this year; city.gifts counts his gifts to the Emperor within a
 *      year, in place of city.giftCooldown. Older saves load at the mission's rank (a
 *      sandbox at the middle rank), drawing its salary, with no savings, as
 *      if that salary had been paid since New Year (so the first New Year
 *      neither rewards nor punishes it), and a gift still cooling down
 *      counts as one gift sent that many months ago, see
 *      upgradeGovernorV12().
 *  14  Caesar's legions, distant battles and triumphal arches (favor 0 no
 *      longer recalls the governor): military.caesar (sim/legion.js: the
 *      legions' march, the army on the map, the count of attacks; imperial
 *      legionaries are units with `legion` and `waitTicks`), military.battle
 *      and military.battles (sim/battle.js: a call for troops, the troops
 *      away and their records), each fort's and station's Empire service
 *      switch (`service`), men and ships on their way out (`away`,
 *      `awayTick`), city.archesEarned, and triumphal arches (`axis`). Older
 *      saves load with no legions coming, no battle, no arches earned and
 *      every switch off; the population peak the overrun rule reads
 *      (city.stats.peakPopulation) starts again at today's population. See
 *      upgradeEmpireV13().
 *  15  staged warnings: military.warnStage (the warnings given for the coming
 *      raid: rumour, scouts' report, a month away; sim/military.js),
 *      warned.noShore (raider ships that found no landing a month out), and
 *      military.caesar.noticeStage (the legions' reminders, sim/legion.js).
 *      Messages may carry `empire` (a click opens the empire map). Older
 *      saves load with every stage whose moment has passed counted as given,
 *      so nothing is told late or twice, see upgradeWarningsV14().
 *  16  training takes time (sim/training.js): a recruit walker training at
 *      the academy is in state 'training' with `trainLeft` (ticks of
 *      training at full staff still to go) and `trainWait` (ticks waited
 *      for a full staff), and a new liburnian moored at the Portus has both
 *      too. Soldiers at rest no longer go to the
 *      academy. Older saves need nothing: nobody in them is mid-training
 *      (a recruit or ship still on its way trains on arrival), and a soldier
 *      caught on a trip to the academy comes straight home (updateRoman
 *      did it then; upgradeSoldierTripsV27 since version 28).
 *  17  shipyards need timber (sim/fishing.js; Colonia's own rule): a
 *      shipyard holds `stock.timber` and `incoming.timber`, and a boat takes
 *      100, used at launch. Older saves load with
 *      100 timber in a yard that has a boat started (progress above 0), so
 *      the boat on the slip finishes as it would have, and none in the
 *      others, see upgradeShipyardTimberV16().
 *  19  recall from a distant battle (sim/battle.js): military.recalls, a
 *      list of riders carrying a fort's or station's recall and of recalled
 *      troops on their way home, each { post, city, march, rider,
 *      riderTotal, homeIn, homeTotal, men, ships } (records like
 *      battle.sent's). Older saves load with no rider out and nobody
 *      recalled, see upgradeRecallsV18().
 *  20  horses live at the Horse Ranch, never in a warehouse (data/goods.js
 *      keptAt): a ranch has `incoming` (horses on their way to its stables),
 *      and a new warehouse's stock, incoming and orders have no horses (an
 *      upgraded one keeps a horses entry in stock and incoming, for the old
 *      save's carts still on the road, but no order). An older
 *      save's warehouse horses move to ranches with room, in id order (the
 *      roads are not built yet while a save loads); what no ranch has room for
 *      stays at its warehouse, which sends it to a barracks that needs it or
 *      a ranch with room, a horse a day (sim/production.js). The warehouse's
 *      horse order is dropped. See upgradeHorsesV19().
 *  21  trade by partner (sim/tradeSwitches.js): each trade route holds
 *      `off`, { good: true } for the goods the player switched off with
 *      that partner. Older saves load with every switch on (an empty `off`
 *      on every route), so they trade as before, see
 *      upgradeTradeSwitchesV20().
 *  23  everything since 22, in one step:
 *      - events (sim/events.js): city.romeWage (what Rome pays, which random
 *      events move) and city.events (each event's cooldown, the day land and
 *      sea trade may start again, the earthquake in progress with its cracks'
 *      ends, the counts). The cracks themselves are rock in the map. Older
 *      saves load with Rome at the base wage, nothing cooling down, trade
 *      open and no quake, see upgradeEventsV22() (the Game constructor
 *      fills the same defaults, so a save without them loads either way).
 *      - raiders' peoples, wolf packs and the gladiator revolt
 *        (data/peoples.js, sim/wildlife.js, sim/revolt.js): see above; no
 *        step needed.
 *      - low bridges (sim/bridges.js): map.bridgeLow, 1 on a low bridge's
 *        tiles. A v22 save has no layer: every bridge is a ship bridge, as
 *        it was.
 *      - native villages (sim/natives.js): city.natives (null without
 *        villages, as in every v22 save: the Game constructor fills it),
 *        village buildings (kind 'village', ids from NATIVE_ID_BASE, with
 *        anger and their attack), villagers (units, side 'native'), the
 *        mission post, missionaries and village traders.
 *  24  the sandbox's events, one switch each (data/events.js): a sandbox
 *      scenario's `events` is the list of switches left on, where it was
 *      one switch (true, false, or missing before events). An older
 *      sandbox with its events on (or from before them) gets every switch
 *      on, one with them off none, see upgradeEventSwitchesV23(). Campaign
 *      saves store only the mission id and are unchanged.
 *  25  numbered forts (sim/fortNumbers.js): each fort holds its `number`
 *      (Castra III; Shift+3 shows it), the lowest free one when it was
 *      placed. Older saves number their forts 1, 2, 3... in id order, the
 *      order they were built, see upgradeFortNumbersV24().
 *  26  gardens and statues fade untended (sim/gardens.js): each garden and
 *      statue holds `tendedDay` (the day a gardener last passed) and
 *      `careStep` (how far its desirability has faded). An older save's
 *      start fully tended, last visited the day it loads, see
 *      upgradeGardensV25().
 *  27  festivals cost goods and the gods mind being forgotten
 *      (sim/religion.js): each god in city.gods has `monthsSinceFestival`
 *      (its mood target falls once it passes a year) and `festivalsHeld`.
 *      Older saves load as a new game starts: every god at 0 months, a
 *      fresh year, with none held yet, see upgradeFestivalsV26().
 *  28  soldiers at rest go to train (sim/training.js): a soldier on a trip
 *      from his fort to the Campus holds `drill` (its id), `drillDay` and
 *      `drillDays`, and there `trainLeft` and `trainWait`, as a ship on its
 *      way to the Portus does; a fort or station may hold `drillWait` (no
 *      trip before that day). In an older save a soldier could hold a trip
 *      only from before version 16, when it meant something else: he comes
 *      straight home, untrained, see upgradeSoldierTripsV27().
 *
 * Typed-array map layers are base64 encoded, run-length compressed first
 * when that is smaller (encodeLayer). Derived data (building tile layer,
 * desirability, water coverage, road networks) is rebuilt on load.
 *
 * Browser storage: localStorage key `colonia.save.<slot>`. Every read/write
 * is wrapped in try/catch because storage can be missing, full or blocked.
 * Slots: auto (monthly + when the page is hidden/closed), quick (F5),
 * slot1..slot5 (manual). localStorage belongs to this browser and site only:
 * clearing site data deletes the saves, so the menus offer export/copy.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { Game } from './game.js';
import { RNG } from './rng.js';
import { GameMap } from '../world/map.js';
import { GameTime } from '../sim/time.js';
import { Building, Walker, footprintTiles, faceWater } from '../sim/entities.js';
import { Unit, RUMOUR_MONTHS, DOOR_MONTHS, RAID_MIN_POP } from '../sim/military.js';
import { UNIT_TYPES } from '../data/units.js';
import { BUILDINGS } from '../data/buildings.js';
import { WALKER_TYPES } from '../data/walkers.js';
import { findScenario, withDifficulty } from '../data/scenarios.js';
import { SITES } from '../data/sites.js';
import { HOUSE_TIERS } from '../data/housing.js';
import { serializeRuins, restoreRuins } from '../sim/ruins.js';
import { isStable, stableRoom } from '../sim/storage.js';
import { newGovernorState, salaryOf } from '../sim/governor.js';
import { newGiftState, GIFT_MEMORY_MONTHS } from '../sim/emperor.js';
import { newCaesarState, noticeStageFor } from '../sim/legion.js';
import { emptyWildlife } from '../sim/wildlife.js';
import { newTradeState } from '../sim/trade.js';
import { eventStateOf } from '../sim/events.js';
import { sandboxEventSwitches } from '../data/events.js';
import { log } from './debug.js';
import { NATIVE_ID_BASE } from '../data/natives.js';
import { isFort, numberForts } from '../sim/fortNumbers.js';
import { endDrill } from '../sim/training.js';

/** Oldest save version this game can load (4: the 20-level housing ladder). */
export const MIN_SAVE_VERSION = 4;

// ---------------------------------------------------------------------------
// Base64 for Uint8Array (works in browsers and Node 16+)
// ---------------------------------------------------------------------------

export function encodeBytes(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function decodeBytes(str) {
  if (typeof str !== 'string') throw new Error('Map layer is not a string');
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// PackBits run-length compression for map layers
// ---------------------------------------------------------------------------
// A header byte h, then:
//   h = 0..127    copy the next h + 1 bytes as they are (a "literal" run)
//   h = 129..255  repeat the next byte 257 - h times (2..128 copies)
//   h = 128       nothing (never written)
// Map layers are mostly long runs (empty road/wall layers, big grass
// fields), so they shrink 5-50x; random data grows by under 1%.

/** Compress bytes with PackBits. */
export function packBits(src) {
  const n = src.length;
  const out = new Uint8Array(n + Math.ceil(n / 128) + 2);
  let o = 0;
  let i = 0;
  while (i < n) {
    let run = 1;
    while (i + run < n && run < 128 && src[i + run] === src[i]) run++;
    if (run >= 3) {
      out[o++] = 257 - run;
      out[o++] = src[i];
      i += run;
      continue;
    }
    // Literal run: until 3 equal bytes start (worth a repeat) or 128 bytes.
    const start = i;
    let lit = 0;
    while (i < n && lit < 128) {
      if (i + 2 < n && src[i] === src[i + 1] && src[i] === src[i + 2]) break;
      i++;
      lit++;
    }
    out[o++] = lit - 1;
    out.set(src.subarray(start, start + lit), o);
    o += lit;
  }
  return out.slice(0, o);
}

/** Decompress PackBits data that must come out exactly `length` bytes long. */
export function unpackBits(src, length) {
  const out = new Uint8Array(length);
  let i = 0;
  let o = 0;
  while (i < src.length && o < length) {
    const h = src[i++];
    if (h < 128) {
      const cnt = h + 1;
      if (o + cnt > length || i + cnt > src.length) throw new Error('Corrupt map layer (literal run overflows)');
      out.set(src.subarray(i, i + cnt), o);
      i += cnt;
      o += cnt;
    } else if (h > 128) {
      const cnt = 257 - h;
      if (o + cnt > length || i >= src.length) throw new Error('Corrupt map layer (repeat run overflows)');
      out.fill(src[i++], o, o + cnt);
      o += cnt;
    }
  }
  if (o !== length) throw new Error(`Corrupt map layer (${o} of ${length} bytes)`);
  return out;
}

/** A map layer for the save: PackBits + base64 ("pb:...") when smaller, else plain base64. */
export function encodeLayer(bytes) {
  const packed = packBits(bytes);
  return packed.length < bytes.length * 0.95 ? `pb:${encodeBytes(packed)}` : encodeBytes(bytes);
}

/** Read a map layer written by encodeLayer: "pb:" + PackBits, or plain base64 (when that was smaller). */
export function decodeLayer(str, length) {
  if (typeof str !== 'string') throw new Error('Map layer is not a string');
  if (str.startsWith('pb:')) return unpackBits(decodeBytes(str.slice(3)), length);
  return decodeBytes(str);
}

// ---------------------------------------------------------------------------
// Paths (walkers, soldiers): tile indices as 16-bit little-endian values
// ---------------------------------------------------------------------------
// Maps are at most 256x256, so every tile index fits in 16 bits: 2.7
// characters a step in base64 instead of about 6 as JSON numbers. Anything
// unexpected (a negative or huge value) is kept as a plain array instead.

/** A path for the save: "u16:<base64>", or the path itself if it can't be packed. */
export function encodePath(path) {
  if (!path || !path.length) return path ? [] : null;
  const bytes = new Uint8Array(path.length * 2);
  for (let k = 0; k < path.length; k++) {
    const v = path[k];
    if (!Number.isInteger(v) || v < 0 || v > 0xffff) return Array.from(path);
    bytes[2 * k] = v & 0xff;
    bytes[2 * k + 1] = v >>> 8;
  }
  return `u16:${encodeBytes(bytes)}`;
}

/** Read a path written by encodePath ("u16:" + base64), or a plain array (hand-edited saves), or null. */
export function decodePath(p) {
  if (p === null || p === undefined) return null;
  if (Array.isArray(p)) return p;
  if (typeof p !== 'string' || !p.startsWith('u16:')) throw new Error('Corrupt path in save');
  const bytes = decodeBytes(p.slice(4));
  if (bytes.length % 2) throw new Error('Corrupt path in save (odd length)');
  const out = new Array(bytes.length / 2);
  for (let k = 0; k < out.length; k++) out[k] = bytes[2 * k] | (bytes[2 * k + 1] << 8);
  return out;
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

/** Turn a game into a plain JSON-safe object. */
export function serializeGame(game, extra = {}) {
  const buildings = [];
  for (const b of game.buildings.values()) buildings.push({ ...b });
  const walkers = [];
  for (const w of game.walkers.values()) walkers.push({ ...w, path: encodePath(w.path) });
  const units = [];
  for (const u of game.units.values()) units.push({ ...u, path: encodePath(u.path) });
  const isCampaign = !!findScenario(game.scenario.id);
  return {
    format: 'colonia-save',
    version: CONFIG.SAVE_VERSION,
    meta: {
      city: game.city.name,
      scenarioId: game.scenario.id,
      date: game.time.label(),
      population: game.city.population,
      treasury: Math.round(game.city.treasury),
      difficulty: game.difficultyKey,
      savedAt: new Date().toISOString(),
    },
    scenario: isCampaign ? { id: game.scenario.id } : game.scenario,
    difficulty: game.difficultyKey, // campaign saves only store the mission id
    flags: { unlockall: !!game.flags.unlockall },
    seed: game.seed,
    rng: game.rng.getState(),
    time: game.time.serialize(),
    map: game.map.serialize(encodeLayer),
    buildings,
    walkers,
    fires: [...game.fires],
    ruins: serializeRuins(game),
    units,
    military: game.military,
    wildlife: game.wildlife,
    wallHp: [...game.wallHp],
    city: game.city,
    messages: game.messages.slice(0, 60),
    nextIds: { building: game.nextBuildingId, walker: game.nextWalkerId, message: game.nextMessageId, unit: game.nextUnitId },
    cheats: { ...game.cheats },
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Deserialize
// ---------------------------------------------------------------------------

function assert(cond, msg) {
  if (!cond) throw new Error(`Invalid save file: ${msg}`);
}

/**
 * Rebuild a Game from saved data. Throws a readable error for bad files.
 * @param {object} data parsed save object
 * @param {object} [flags] current debug flags (merged with saved ones)
 */
export function deserializeGame(data, flags = {}) {
  assert(data && typeof data === 'object', 'not an object');
  assert(data.format === 'colonia-save', 'this is not a Colonia save file');
  assert(Number.isInteger(data.version), 'missing version');
  if (data.version > CONFIG.SAVE_VERSION) throw new Error(`This save was made by a newer version of the game (save v${data.version}, game supports v${CONFIG.SAVE_VERSION}).`);
  if (data.version < MIN_SAVE_VERSION) throw new Error(`This save was made by an older version of Colonia (save v${data.version}) and cannot be loaded: homes now have 20 levels. Start a new city.`);
  assert(data.map && data.time && data.city && Array.isArray(data.buildings), 'missing sections');
  // Renames on the raw data, before anything is built from it.
  if (data.version < 7) data = upgradeGodsV6(data);
  if (data.version < 24) data = upgradeEventSwitchesV23(data);

  const scenario = data.scenario && data.scenario.map ? data.scenario : withDifficulty(findScenario(data.scenario?.id), data.difficulty);
  assert(scenario, `unknown scenario "${data.scenario?.id}"`);
  // A sandbox saved before the province could move has no site: the
  // Etruscan coast, where it always was (data/sites.js siteIdOf). One that
  // names a site this game does not know cannot be put on the map.
  assert(scenario.site === undefined || (typeof scenario.site === 'string' && Object.hasOwn(SITES, scenario.site)), `unknown province site "${scenario.site}"`);

  const map = GameMap.deserialize(data.map, decodeLayer);
  const rng = new RNG(1);
  rng.setState(data.rng);
  const restore = {
    seed: data.seed,
    rng,
    map,
    mapInfo: {},
    time: GameTime.deserialize(data.time),
    nextBuildingId: data.nextIds?.building || 1,
    nextWalkerId: data.nextIds?.walker || 1,
    nextMessageId: data.nextIds?.message || 1,
    city: data.city,
    messages: Array.isArray(data.messages) ? data.messages : [],
    nextUnitId: data.nextIds?.unit || 1,
    wallHp: new Map(Array.isArray(data.wallHp) ? data.wallHp : []),
  };
  // Military state: Game fills in a fresh one if a save lacks it.
  if (data.military && typeof data.military === 'object') restore.military = data.military;
  // Wolf packs (sim/wildlife.js): a save from before them has none, never new ones.
  restore.wildlife = data.wildlife && typeof data.wildlife === 'object' && Array.isArray(data.wildlife.packs) ? data.wildlife : emptyWildlife();
  const game = new Game({ scenario, flags: { ...data.flags, ...flags }, restore });
  if (data.cheats) Object.assign(game.cheats, data.cheats);

  // Buildings
  let maxB = 0;
  for (const raw of data.buildings) {
    if (!BUILDINGS[raw.type]) {
      log.warn(`Skipping unknown building type "${raw.type}" in save`);
      continue;
    }
    const b = new Building(raw.id, raw.type, raw.x, raw.y, raw.size);
    const freshOrders = b.orders;
    Object.assign(b, raw);
    // A good added since the save was made gets its default order.
    if (freshOrders && b.orders && b.orders !== freshOrders) b.orders = { ...freshOrders, ...b.orders };
    game.buildings.set(b.id, b);
    for (const i of footprintTiles(map, b.x, b.y, b.size)) map.building[i] = b.id;
    if (b.id < NATIVE_ID_BASE) maxB = Math.max(maxB, b.id); // (a native village's ids are apart: sim/natives.js)
  }
  game.nextBuildingId = Math.max(game.nextBuildingId, maxB + 1);

  // Walkers
  let maxW = 0;
  for (const raw of data.walkers || []) {
    if (!WALKER_TYPES[raw.type]) continue;
    const w = new Walker(raw.id, raw.type, raw.x, raw.y);
    Object.assign(w, raw);
    w.path = decodePath(raw.path);
    w.dead = false;
    game.walkers.set(w.id, w);
    maxW = Math.max(maxW, w.id);
  }
  game.nextWalkerId = Math.max(game.nextWalkerId, maxW + 1);
  // Drop walker references to buildings that no longer exist.
  for (const b of game.buildings.values()) b.walkers = (b.walkers || []).filter((id) => game.walkers.has(id));

  for (const [i, d] of data.fires || []) game.fires.set(i, d);
  restoreRuins(game, data.ruins); // (none before version 7)

  // Soldiers and raiders
  let maxU = 0;
  for (const raw of data.units || []) {
    if (!UNIT_TYPES[raw.type]) continue;
    const u = new Unit(raw.id, raw.type, raw.x, raw.y);
    Object.assign(u, raw);
    u.path = decodePath(raw.path);
    game.units.set(u.id, u);
    maxU = Math.max(maxU, u.id);
  }
  game.nextUnitId = Math.max(game.nextUnitId, maxU + 1);

  if (data.version < 5) upgradeV4(game);
  if (data.version < 6) upgradeV5(game);
  if (data.version < 7) upgradeOrdersV6(game);
  if (data.version < 8) upgradeShipsV7(game);
  if (data.version < 9) upgradeFishV8(game);
  if (data.version < 10) upgradeClothV9(game);
  if (data.version < 11) upgradeNavyV10(game);
  if (data.version < 12) upgradeTrainingV11(game);
  if (data.version < 13) upgradeGovernorV12(game);
  if (data.version < 14) upgradeEmpireV13(game);
  if (data.version < 15) upgradeWarningsV14(game);
  if (data.version < 17) upgradeShipyardTimberV16(game);
  if (data.version < 19) upgradeRecallsV18(game);
  if (data.version < 20) upgradeHorsesV19(game);
  if (data.version < 21) upgradeTradeSwitchesV20(game);
  if (data.version < 22) upgradeTurnsV21(game);
  if (data.version < 23) upgradeEventsV22(game);
  if (data.version < 25) upgradeFortNumbersV24(game);
  // A fort with no number, or a number another fort holds (a hand-edited
  // file), gets the lowest free one: Shift+N must find one fort only.
  numberForts(game);
  if (data.version < 26) upgradeGardensV25(game);
  if (data.version < 27) upgradeFestivalsV26(game);
  if (data.version < 28) upgradeSoldierTripsV27(game);
  addNewPartners(game);
  // A turn that is not 0..3 (a hand-edited file) is taken as no turn.
  for (const b of game.buildings.values()) if (!(Number.isInteger(b.turn) && b.turn >= 0 && b.turn < 4)) b.turn = 0;
  // A garden's or statue's care out of range, or a visit in the future (a
  // hand-edited file, which would never fade), is taken as tended today: a step past the end of CONFIG.CARE_LEVELS has no share
  // of its desirability to give, and the whole layer would turn to NaN.
  for (const b of game.buildings.values()) {
    if (!b.def.tended) continue;
    if (!(Number.isInteger(b.careStep) && b.careStep >= 0 && b.careStep < CONFIG.CARE_LEVELS.length) || !Number.isFinite(b.tendedDay) || b.tendedDay > game.time.totalDays) {
      b.careStep = 0;
      b.tendedDay = game.time.totalDays;
    }
  }
  // A hippodrome's sections lie the way its main section says (they were placed so).
  for (const b of game.buildings.values()) if (b.main && game.buildings.has(b.main)) b.turn = game.buildings.get(b.main).turn;

  // Rebuild derived state (no simulation side effects).
  game.recomputeDerived();
  // A waterside building that no ship or boat had used yet was saved with no
  // side: turn it to its water now, with the water layers rebuilt (sim/entities.js faceWater).
  for (const b of game.buildings.values()) if (b.waterSide === undefined) faceWater(game, b);
  return game;
}

/**
 * A campaign save stores only its mission's id, so it loads with the
 * mission's partners as they are now: a partner the mission has gained
 * since the save was made (Capua at Figlina) gets its route, closed, as a
 * new game has it. Without it the partner could never be traded with,
 * though the mission's goals count on it. No save version: the routes
 * already there are kept as they are.
 */
function addNewPartners(game) {
  const routes = game.city.trade?.routes;
  if (!routes) return;
  for (const [id, route] of Object.entries(newTradeState(game.scenario.partners || []).routes)) routes[id] ??= route;
}

/**
 * A version 4 save (before home mood and crime): give every home the new
 * fields. An occupied home starts at the city's mood, as a new household
 * does; city.crime was filled in by the Game constructor.
 */
function upgradeV4(game) {
  for (const b of game.buildings.values()) {
    const h = b.house;
    if (!h) continue;
    h.mood = h.pop > 0 ? game.city.sentiment : null;
    h.moodReason = null;
    h.hungerStreak = 0;
    h.criminal = 0;
    h.police = 0;
  }
}

/**
 * A version 5 save (before disease): no home is sick yet and every disease
 * risk starts at 0. city.health (city health at its starting value, no
 * outbreaks) was filled in by the Game constructor; it moves toward the
 * homes' real average from the next month.
 */
function upgradeV5(game) {
  for (const b of game.buildings.values()) {
    const h = b.house;
    if (!h) continue;
    h.diseaseRisk = 0;
    h.sick = 0;
  }
}

/**
 * A version 6 save (before storage orders): a granary's or warehouse's
 * accept flags become its orders (accepted: Accept, not: Refuse), with
 * nothing on Get and Empty off, so the city works exactly as it did.
 */
function upgradeOrdersV6(game) {
  for (const b of game.buildings.values()) {
    const old = b.accept;
    delete b.accept; // every building had the field (null outside storage)
    if (!b.orders) continue; // not storage
    if (old && typeof old === 'object') {
      for (const good of Object.keys(b.orders)) if (good in old) b.orders[good] = old[good] ? 'accept' : 'refuse';
    }
    b.emptying = false;
    b.orderNote = null;
  }
}

/** How long a ship stayed at the dock before version 8 (ticks): 6 days, whatever it traded. */
const OLD_SHIP_STAY_TICKS = 120;

/**
 * A save before version 8: a ship at the dock had already traded everything
 * the moment it arrived (and the trade log has its visit), and was only
 * waiting out its 6 days. It loads with nothing left to unload or buy, its
 * deal kept for its panel and not logged a second time, so it casts off on
 * the first tick. Its days at the dock count from when it arrived.
 */
function upgradeShipsV7(game) {
  for (const w of game.walkers.values()) {
    if (w.type !== 'ship' || w.state !== 'docked') continue;
    const stayed = Math.max(0, OLD_SHIP_STAY_TICKS - (w.waitTicks || 0));
    w.mooredTick = game.time.totalTicks - stayed;
    w.unload = {};
    w.wants = {};
    w.deal = w.deal || { sold: {}, bought: {}, earned: 0, spent: 0 };
    w.dealLogged = true;
    w.crane = 0;
    w.craneIdle = 0;
    w.craneTurn = 0;
    w.wantTurn = 0;
    w.wantsStuck = true;
    w.waitTicks = 0;
    w.afterWait = null;
  }
}

/**
 * A save before version 8 (before fish and the hippodrome): every food list
 * gets fish at 0 (homes' pantries, granaries, warehouses, markets and docks,
 * and what is on its way to them), the trade settings get fish (no trade),
 * homes get hippodrome access at 0 and venues a hippodrome show count at 0.
 * Granary and warehouse orders for fish were filled in with their defaults
 * as the buildings were read (Accept in a granary, Refuse in a warehouse).
 * There are no boats, wharves or hippodromes yet, so nothing else changes.
 */
export function upgradeFishV8(game) {
  for (const b of game.buildings.values()) {
    const h = b.house;
    if (h) {
      if (h.food) h.food.fish ??= 0;
      if (h.ent) h.ent.hippodrome ??= 0;
      continue;
    }
    const kind = b.def.kind;
    if (kind === 'granary' || kind === 'warehouse' || kind === 'market' || kind === 'dock') {
      if (b.stock) b.stock.fish ??= 0;
      if (b.incoming) b.incoming.fish ??= 0;
    }
    if (b.shows) b.shows.hippodrome ??= 0;
  }
  const settings = game.city.trade && game.city.trade.settings;
  if (settings) settings.fish ??= { mode: 'none', level: 400 };
}

/** The goods added in version 10 (the cloth industry). */
const CLOTH_GOODS = ['flax', 'linen', 'clothing'];

/** Months of clothing an upgraded save's Tenements and better homes start with (see upgradeClothV9). */
export const CLOTHING_GRACE_MONTHS = 3;

/**
 * A save before version 10 (before the cloth industry): markets get
 * clothing at 0 (also on the way to them), warehouses and docks flax, linen
 * and clothing at 0, and the trade settings get the three goods with no
 * trade. Warehouse orders for them were filled in with their defaults
 * (Accept) as the buildings were read.
 *
 * Homes get clothing at 0, except those that need it now (Insulae and up)
 * or will next (Tenements): they start with what a market vendor would have
 * left them, CLOTHING_GRACE_MONTHS of it, so a loaded city has time to build
 * the chain (its first clothing takes about two months) before they fall
 * back. Without it every villa of a loaded late mission fell to a Tenement
 * within days.
 */
export function upgradeClothV9(game) {
  const firstLevel = HOUSE_TIERS.findIndex((t) => t.goods.includes('clothing'));
  for (const b of game.buildings.values()) {
    const h = b.house;
    if (h) {
      if (!h.goods || h.goods.clothing !== undefined) continue;
      const months = h.pop > 0 && h.tier >= firstLevel - 1 ? CLOTHING_GRACE_MONTHS : 0;
      h.goods.clothing = (Math.max(0.25, h.pop / CONFIG.GOODS_PER_HOUSE_PEOPLE)) * months;
      continue;
    }
    const kind = b.def.kind;
    const goods = kind === 'market' ? ['clothing'] : kind === 'warehouse' || kind === 'dock' ? CLOTH_GOODS : [];
    for (const g of goods) {
      if (b.stock) b.stock[g] ??= 0;
      if (b.incoming) b.incoming[g] ??= 0;
    }
  }
  const settings = game.city.trade && game.city.trade.settings;
  if (settings) for (const g of CLOTH_GOODS) settings[g] ??= { mode: 'none', level: 400 };
}

/**
 * A save before version 11 (before sea raids and the fleet): the Sea raids
 * switch takes the scenario's choice (on, unless a sandbox said no; no older
 * sandbox did), the fleet needs nothing yet and its counts start at 0. A raid
 * already warned of or under way has no `sea` and stays a raid by land; the
 * next one is decided by the new rule.
 */
export function upgradeNavyV10(game) {
  const m = game.military;
  if (!m) return;
  m.seaRaids ??= game.scenario.seaRaids !== false;
  m.navalDemand ??= { timber: 0, iron: 0, linen: 0 };
  const st = m.stats || (m.stats = {});
  for (const k of ['seaRaids', 'shipsSunk', 'shipsLost', 'shipsBuilt', 'boatsSunk']) st[k] ??= 0;
}

/** How long the Emperor waited between gifts before version 13 (months). */
const OLD_GIFT_COOLDOWN = 6;

/**
 * A save before version 13 (before the governor's rank, salary and savings):
 * the governor takes the mission's rank (a sandbox, which had none, the
 * middle one) and draws its salary, with nothing saved. His salary counts as
 * paid for the months of this year already gone, so the first New Year judges
 * it at his rank and changes no favor. Gifts were paid from the treasury and
 * then barred for six months: a gift still barred counts as one gift sent
 * (6 - months left) months ago, so the next one within the year pleases the
 * Emperor less, as the old wait meant.
 */
export function upgradeGovernorV12(game) {
  const c = game.city;
  if (!c.governor) {
    c.governor = newGovernorState(game.scenario);
    c.governor.paidThisYear = salaryOf(c.governor.rank) * game.time.month;
  }
  if (!c.gifts) {
    c.gifts = newGiftState();
    const left = Number(c.giftCooldown) || 0;
    if (left > 0) {
      c.gifts.recent = 1;
      c.gifts.monthsSince = Math.max(0, Math.min(GIFT_MEMORY_MONTHS - 1, OLD_GIFT_COOLDOWN - left));
    }
  }
  delete c.giftCooldown;
}

/**
 * A save before version 14 (before Caesar's legions, distant battles and
 * triumphal arches): no legions on the road or on the map and no attack so
 * far, no battle asked for, no arch earned, and every fort's and station's
 * Empire service switch off with nobody away. A city that had fallen to
 * favor 0 or below simply goes on (the recall is gone): the daily check
 * sets Caesar's legions marching if its favor is still 10 or less. The
 * population peak the overrun rule reads (city.stats.peakPopulation, kept
 * for the advisors since the first saves) starts again at today's
 * population: a city that had shrunk before the rule existed is not lost to
 * the first raid after loading.
 */
export function upgradeEmpireV13(game) {
  const m = game.military;
  if (m) {
    m.caesar = newCaesarState();
    m.battle = null;
    m.battles = { won: 0, lost: 0, lastEndMonth: -999 };
  }
  const c = game.city;
  c.archesEarned = 0;
  c.stats = c.stats || {};
  c.stats.peakPopulation = c.population || 0;
  for (const b of game.buildings.values()) if (b.def.kind === 'fort' || b.def.kind === 'station') b.service = false;
  for (const u of game.units.values()) {
    u.away = false;
    u.awayTick = 0;
  }
}

/**
 * A save before version 15 (before the staged warnings): each stage whose
 * moment has passed counts as given, read from the timers the save has, so
 * nothing is posted on load and nothing comes late; the next stage comes on
 * time. The month's tick has run for the month the save was made in, so:
 *   a raid the scouts reported: stage 2, or 3 with a month or less to go;
 *   one not yet reported, 6 months or less away, in a city worth raiding:
 *     stage 1 (the rumour is not told late; the scouts report on time);
 *   Caesar's legions on the road: by the days left (noticeStageFor).
 */
export function upgradeWarningsV14(game) {
  const m = game.military;
  if (!m) return;
  const left = m.nextRaidMonth === null || m.nextRaidMonth === undefined ? null : m.nextRaidMonth - game.time.totalMonths;
  if (m.warned) m.warnStage = left !== null && left <= DOOR_MONTHS ? 3 : 2;
  else if (m.settings && !m.active && left !== null && left <= RUMOUR_MONTHS && game.city.population >= RAID_MIN_POP) m.warnStage = 1;
  else m.warnStage = 0;
  if (m.caesar) m.caesar.noticeStage = noticeStageFor(m.caesar.countdown);
}

/**
 * A save before version 17 (before shipyards needed timber): a yard with a
 * boat started (progress above 0, or one finished and waiting for room on
 * the water) holds the 100 timber that boat is built from, so it is launched
 * when it would have been; a yard with nothing started holds none and waits
 * for its first load. A spare already on the water was built and stays.
 */
export function upgradeShipyardTimberV16(game) {
  for (const b of game.buildings.values()) {
    if (b.def.kind !== 'shipyard') continue;
    b.stock = { timber: (b.progress || 0) > 0 ? CONFIG.SHIPYARD_BOAT_TIMBER : 0 };
    b.incoming = { timber: 0 };
  }
}

/**
 * A save before version 19 (before the recall from a distant battle): no
 * rider is out and nobody is on the way home from a recall. Troops away at
 * a battle stay with the army, and may be recalled from now on.
 */
export function upgradeRecallsV18(game) {
  if (game.military) game.military.recalls = [];
}

/**
 * A save before version 20 (before horses lived at the Horse Ranch): every
 * ranch gets its `incoming` (nothing on the way), and the horses in
 * warehouses move to ranches with room, the lowest ids first. What no ranch
 * has room for stays at its warehouse as a last resort, with no order for it
 * (warehouses never take horses in again: storageAccepts, orderGoods; its
 * stock and incoming keep a horses entry for the old save's carts); that warehouse's supply cart takes
 * it on to a barracks that needs horses or a ranch with room (sim/production.js
 * updateWarehouseSupply). A cart on its way to a warehouse with horses finds
 * it refusing them and goes on to a barracks or ranch, or home.
 * @returns {number} horses' units moved to ranches (for the tests)
 */
export function upgradeHorsesV19(game) {
  const ranches = [];
  for (const b of game.buildings.values()) {
    if (!isStable(b, b.def.produces)) continue;
    if (!b.incoming || typeof b.incoming !== 'object') b.incoming = {};
    b.incoming.horses ??= 0;
    b.stock.horses ??= 0;
    ranches.push(b);
  }
  let moved = 0;
  for (const wh of game.buildings.values()) {
    if (wh.def.kind !== 'warehouse') continue;
    if (wh.orders) delete wh.orders.horses;
    // The stock and incoming keys stay (at 0 once empty): carts of the old
    // save still on the road use them, a returning one to put its horses
    // back (receiveGoods needs the key) and a Get cart to shrink its hold.
    // Nothing new comes in: storageAccepts refuses horses everywhere.
    wh.stock.horses ??= 0;
    if (wh.incoming) wh.incoming.horses ??= 0;
    for (const r of ranches) {
      const n = Math.min(wh.stock.horses, stableRoom(r));
      if (n <= 0) continue;
      r.stock.horses += n;
      wh.stock.horses -= n;
      moved += n;
    }
  }
  return moved;
}

/**
 * A save before version 22 (before buildings could be turned): every
 * building stands as it always did, at turn 0, and the hippodrome lies
 * along x as it always had to.
 */
export function upgradeTurnsV21(game) {
  for (const b of game.buildings.values()) b.turn = 0;
}

/**
 * A save before version 23 (before events): Rome pays the base wage, no
 * event is cooling down, no trade is stopped and nothing shakes. Wired as
 * `if (data.version < 23)`. It only fills what is missing (sim/events.js
 * eventStateOf, which the Game constructor runs too): a save made by the
 * events branch before the bump is tagged 22 and keeps its Rome's wage,
 * cooldowns and a quake under way.
 */
export function upgradeEventsV22(game) {
  eventStateOf(game.city);
}

/**
 * A save before version 26 (before gardens and statues faded untended,
 * sim/gardens.js): every garden and statue starts fully tended, last visited
 * the day the save loads, so none fades before a gardener could reach it.
 * Wired before the derived layers are rebuilt, so the first desirability
 * pass already counts them at full.
 */
export function upgradeGardensV25(game) {
  for (const b of game.buildings.values()) {
    if (!b.def.tended) continue;
    b.tendedDay = game.time.totalDays;
    b.careStep = 0;
  }
}

/**
 * A save before version 27 (festivals that cost goods, gods that mind being
 * forgotten): every god starts as in a new game, 0 months since a festival
 * and none held, so no god of an older city is neglected for a year. A god
 * the save lacks starts afresh anyway (the Game constructor).
 */
export function upgradeFestivalsV26(game) {
  for (const s of Object.values(game.city.gods || {})) {
    if (!s || typeof s !== 'object') continue;
    s.monthsSinceFestival = 0;
    s.festivalsHeld = 0;
  }
}

/**
 * A save before version 28 (before soldiers at rest went to train): a
 * soldier caught on a trip, which only a save from before version 16 could
 * hold, comes straight home untrained, as the versions between had him do,
 * rather than train by the new rules on an old trip's numbers. Ships keep
 * theirs: a ship's trip still means what it meant.
 */
export function upgradeSoldierTripsV27(game) {
  for (const u of game.units.values()) if (u.side === 'rome' && !UNIT_TYPES[u.type].naval && u.drill) endDrill(u);
}

/**
 * A save before version 24 (one Events switch for the sandbox): returns a
 * copy of the raw data whose sandbox scenario lists its switches, every one
 * if its events were on (`true`, or no field: a save from before events,
 * which played with them all once loaded) and none if they were off. It
 * runs on the raw data because the Game reads its events from the scenario
 * it is built with. Campaign saves hold only the mission id and are left
 * alone, as is a sandbox that already holds a list (a hand edit).
 */
export function upgradeEventSwitchesV23(data) {
  const s = data.scenario;
  if (!s || typeof s !== 'object' || s.id !== 'sandbox' || Array.isArray(s.events)) return data;
  return { ...data, scenario: { ...s, events: sandboxEventSwitches(s.events !== false) } };
}

/**
 * A save before version 25 (before numbered forts): its forts are numbered
 * 1, 2, 3... in id order, the order they were built, as if each had taken
 * the lowest free number when placed and none had been torn down since.
 */
export function upgradeFortNumbersV24(game) {
  for (const b of game.buildings.values()) if (isFort(b)) b.number = 0;
  numberForts(game);
}

/**
 * A save before version 21 (before trade by partner): every route gets an
 * empty `off`, every switch on, so each good trades with every partner its
 * setting allows, as it did. Whatever an old save held there is dropped.
 */
export function upgradeTradeSwitchesV20(game) {
  for (const r of Object.values(game.city.trade?.routes || {})) r.off = {};
}

/**
 * A save before version 12 (before the Military Academy and the Portus):
 * every soldier, liburnian and recruit on his way is untrained, and nobody is
 * on a trip to be trained. (The Unit constructor's defaults already say so;
 * this says it outright, whatever an old save held.)
 */
export function upgradeTrainingV11(game) {
  for (const u of game.units.values()) {
    if (u.side !== 'rome') continue;
    u.trained = false;
    u.drill = 0;
    u.drillDay = 0;
    u.drillDays = 0;
  }
  for (const w of game.walkers.values()) {
    if (w.type !== 'recruit') continue;
    w.trained = false;
    w.academy = 0;
  }
}

/**
 * The two gods of Colonia's own that saves before version 7 have, and the
 * original's gods that took their places (their moods, temples and
 * priests carry over).
 */
export const OLD_GODS = Object.freeze({ jupiter: 'mercury', vesta: 'venus' });

/** A god key or a `temple_<god>` building type, renamed if it is an old one. */
function newGodKey(k) {
  return Object.hasOwn(OLD_GODS, k) ? OLD_GODS[k] : k;
}
function newTempleType(t) {
  return typeof t === 'string' && t.startsWith('temple_') ? `temple_${newGodKey(t.slice(7))}` : t;
}

/** An object keyed by gods, with the old keys renamed (other keys kept as they are). */
function renameGodKeys(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[newGodKey(k)] = v;
  return out;
}

/**
 * A save before version 7 (Jupiter and Vesta): returns a copy of the raw data
 * with the old gods renamed everywhere a god's key is stored. It must run
 * before the Game and its buildings are built: the loader drops buildings of
 * an unknown type, so the old temples would vanish and leave their tiles
 * unclaimed. The parts it changes are copied; the caller's object is left
 * alone. Old messages that name the old gods stay as they were (history),
 * and fire risk from an old wrath plays out.
 */
export function upgradeGodsV6(data) {
  const out = { ...data };
  // The gods' state: the old god's whole state (mood, festival boost,
  // cooldown, temples) goes to its successor. Nobody is angered yet.
  const city = { ...data.city };
  const gods = renameGodKeys(city.gods || {});
  for (const k in gods) gods[k] = { ...gods[k], angered: false };
  city.gods = gods;
  city.venusBoost = 0;
  out.city = city;
  // Temples, and every home's access to each god.
  out.buildings = data.buildings.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const b = { ...raw, type: newTempleType(raw.type) };
    if (raw.house && typeof raw.house === 'object') b.house = { ...raw.house, religion: renameGodKeys(raw.house.religion) };
    return b;
  });
  // Priests: their god colors their tunic and gives homes access.
  if (Array.isArray(data.walkers)) out.walkers = data.walkers.map((w) => (w && w.god ? { ...w, god: newGodKey(w.god) } : w));
  // A sandbox save carries its scenario in full, unlock list included.
  if (data.scenario && Array.isArray(data.scenario.unlocks)) out.scenario = { ...data.scenario, unlocks: data.scenario.unlocks.map(newTempleType) };
  return out;
}

// ---------------------------------------------------------------------------
// Browser storage slots
// ---------------------------------------------------------------------------

const slotKey = (slot) => `${CONFIG.STORAGE_PREFIX}save.${slot}`;

/** Save to a localStorage slot. @returns {{ok:boolean, reason?:string, bytes?:number}} */
export function saveToSlot(game, slot, extra) {
  try {
    const json = JSON.stringify(serializeGame(game, extra));
    localStorage.setItem(slotKey(slot), json);
    return { ok: true, bytes: json.length };
  } catch (err) {
    log.error('Save failed:', err);
    const full = err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message));
    return { ok: false, reason: full ? 'Browser storage is full. Delete old saves or export to a file.' : `Could not save: ${err.message}` };
  }
}

/** Load raw save data from a slot (null if empty). Throws on corrupt data. */
export function readSlot(slot) {
  let json = null;
  try {
    json = localStorage.getItem(slotKey(slot));
  } catch (err) {
    log.warn('Storage unavailable:', err);
    return null;
  }
  if (!json) return null;
  return JSON.parse(json);
}

/** Metadata for every slot that holds a save. */
export function listSlots(slots) {
  const out = [];
  for (const slot of slots) {
    try {
      const data = readSlot(slot);
      if (data && data.meta) out.push({ slot, meta: data.meta });
    } catch {
      out.push({ slot, meta: null, corrupt: true });
    }
  }
  return out;
}

export function deleteSlot(slot) {
  try { localStorage.removeItem(slotKey(slot)); } catch { /* ignore */ }
}

/** Size of one slot in characters (0 if empty or unavailable). */
export function slotSize(slot) {
  try {
    const v = localStorage.getItem(slotKey(slot));
    return v ? v.length : 0;
  } catch {
    return 0;
  }
}

/** Typical per-site localStorage allowance (browsers differ; about 5 MB). */
export const STORAGE_BUDGET = 5 * 1024 * 1024;

/**
 * How much localStorage this game uses (all `colonia.*` keys) and whether
 * storage works at all. Sizes are in characters, which is what the usual
 * ~5 MB per-site limit counts for these ASCII saves.
 * @returns {{available:boolean, used:number, saves:number}}
 */
export function storageUsage() {
  try {
    let used = 0;
    let saves = 0;
    for (let k = 0; k < localStorage.length; k++) {
      const key = localStorage.key(k);
      if (!key || !key.startsWith(CONFIG.STORAGE_PREFIX)) continue;
      const v = localStorage.getItem(key) || '';
      used += key.length + v.length;
      if (key.startsWith(`${CONFIG.STORAGE_PREFIX}save.`)) saves++;
    }
    return { available: true, used, saves };
  } catch {
    return { available: false, used: 0, saves: 0 };
  }
}

/**
 * Can this page hand the player a downloaded file? Artifact/embed builds set
 * window.__COLONIA_EMBED__ because their hosts block downloads; those builds
 * rely on "Copy save data" instead.
 */
export function canDownloadFiles() {
  return !(typeof window !== 'undefined' && window.__COLONIA_EMBED__);
}

/**
 * A save file's name: colonia-[slot-]city-year.json, e.g.
 * colonia-slot1-aquae-clarae-279bc.json. Any part may be missing.
 */
export function saveFileName({ slot = null, city = null, year = null } = {}) {
  const part = (s) => String(s).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  const bits = ['colonia'];
  if (slot) bits.push(part(slot));
  bits.push(city ? part(city) || 'city' : slot ? null : 'colonia');
  if (Number.isFinite(year)) bits.push(year < 0 ? `${-year}bc` : `${year}ad`);
  return `${bits.filter(Boolean).join('-')}.json`;
}

/** Hand the browser a text file to download. */
function downloadText(text, name) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Offer the game being played as a downloadable .json file. */
export function exportToFile(game, extra) {
  const data = serializeGame(game, extra);
  downloadText(JSON.stringify(data), saveFileName({ city: game.city.name, year: game.time.year }));
}

/**
 * Offer one save slot as a .json file, without loading it: the slot's text
 * exactly as stored, so a save from an older version (or one that no longer
 * loads) can still be kept or sent with a bug report.
 * @returns {string} the file name
 */
export function exportSlotToFile(slot) {
  let text = null;
  try {
    text = localStorage.getItem(slotKey(slot));
  } catch (err) {
    throw new Error('Browser storage is not available');
  }
  if (!text) throw new Error('That save slot is empty');
  let meta = null;
  let year = null;
  try {
    const data = JSON.parse(text);
    meta = data.meta || null;
    year = data.time ? data.time.year : null;
  } catch { /* a damaged save still downloads, named after its slot */ }
  const name = saveFileName({ slot, city: meta && meta.city, year });
  downloadText(text, name);
  return name;
}

/** Read a save from a File object (file input). */
export async function importFromFile(file) {
  if (!file) throw new Error('No file selected');
  if (file.size > 20 * 1024 * 1024) throw new Error('File is too large to be a save game');
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON');
  }
  return data;
}

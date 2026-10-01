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
 *     ruins[], units[], military, wallHp[], city, messages[], nextIds, camera
 *   }
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
 *   7  storage orders: granaries and warehouses hold `orders` (per good
 *      'accept', 'refuse' or 'get') and an Empty switch (`emptying`) in
 *      place of the old `accept` flags; carts can be out fetching ('collect').
 *      Version 6 (and older) saves load: each accept flag becomes Accept or
 *      Refuse and nothing is emptying, see upgradeV6().
 *   7  ruins: rubble remembers what stood there, why it fell and when
 *      (ruins[]: one entry per fallen building with the tiles it still
 *      covers, see sim/ruins.js). Older saves load with rubble that has no
 *      record; its info panel says what it always said.
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
import { Building, Walker, footprintTiles } from '../sim/entities.js';
import { Unit } from '../sim/military.js';
import { UNIT_TYPES } from '../data/units.js';
import { BUILDINGS } from '../data/buildings.js';
import { WALKER_TYPES } from '../data/walkers.js';
import { findScenario, withDifficulty } from '../data/scenarios.js';
import { serializeRuins, restoreRuins } from '../sim/ruins.js';
import { log } from './debug.js';

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

  const scenario = data.scenario && data.scenario.map ? data.scenario : withDifficulty(findScenario(data.scenario?.id), data.difficulty);
  assert(scenario, `unknown scenario "${data.scenario?.id}"`);

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
    maxB = Math.max(maxB, b.id);
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
  if (data.version < 7) upgradeV6(game);

  // Rebuild derived state (no simulation side effects).
  game.recomputeDerived();
  return game;
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
function upgradeV6(game) {
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

/** Offer the save as a downloadable .json file. */
export function exportToFile(game, extra) {
  const data = serializeGame(game, extra);
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = (game.city.name || 'colonia').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  a.href = url;
  a.download = `colonia-${safe}-${game.time.year < 0 ? `${-game.time.year}bc` : `${game.time.year}ad`}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
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

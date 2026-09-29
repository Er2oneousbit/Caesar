/**
 * save.js
 * ----------------------------------------------------------------------------
 * Save / load.
 *
 * Format (JSON):
 *   {
 *     format: 'colonia-save', version: SAVE_VERSION,
 *     meta:   { city, scenarioId, date, population, savedAt },
 *     scenario, flags, difficulty,
 *     rng, time, seed, map (base64 layers), buildings[], walkers[], fires[],
 *     city, messages[], nextIds, camera
 *   }
 *
 * Typed-array map layers are base64 encoded. Derived data (building tile
 * layer, desirability, water coverage, road networks) is rebuilt on load.
 *
 * Browser storage: localStorage key `colonia.save.<slot>`. Every read/write
 * is wrapped in try/catch because storage can be missing, full or blocked.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { Game } from './game.js';
import { RNG } from './rng.js';
import { GameMap } from '../world/map.js';
import { GameTime } from '../sim/time.js';
import { Building, Walker, footprintTiles } from '../sim/entities.js';
import { BUILDINGS } from '../data/buildings.js';
import { WALKER_TYPES } from '../data/walkers.js';
import { findScenario } from '../data/scenarios.js';
import { log } from './debug.js';

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
// Serialize
// ---------------------------------------------------------------------------

/** Turn a game into a plain JSON-safe object. */
export function serializeGame(game, extra = {}) {
  const buildings = [];
  for (const b of game.buildings.values()) buildings.push({ ...b });
  const walkers = [];
  for (const w of game.walkers.values()) {
    const copy = { ...w };
    if (copy.path) copy.path = Array.from(copy.path);
    walkers.push(copy);
  }
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
      savedAt: new Date().toISOString(),
    },
    scenario: isCampaign ? { id: game.scenario.id } : game.scenario,
    flags: { unlockall: !!game.flags.unlockall },
    seed: game.seed,
    rng: game.rng.getState(),
    time: game.time.serialize(),
    map: game.map.serialize(encodeBytes),
    buildings,
    walkers,
    fires: [...game.fires],
    city: game.city,
    messages: game.messages.slice(0, 60),
    nextIds: { building: game.nextBuildingId, walker: game.nextWalkerId, message: game.nextMessageId },
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
  assert(data.map && data.time && data.city && Array.isArray(data.buildings), 'missing sections');

  const scenario = data.scenario && data.scenario.map ? data.scenario : findScenario(data.scenario?.id);
  assert(scenario, `unknown scenario "${data.scenario?.id}"`);

  const map = GameMap.deserialize(data.map, decodeBytes);
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
  };
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
    Object.assign(b, raw);
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
    w.dead = false;
    game.walkers.set(w.id, w);
    maxW = Math.max(maxW, w.id);
  }
  game.nextWalkerId = Math.max(game.nextWalkerId, maxW + 1);
  // Drop walker references to buildings that no longer exist.
  for (const b of game.buildings.values()) b.walkers = (b.walkers || []).filter((id) => game.walkers.has(id));

  for (const [i, d] of data.fires || []) game.fires.set(i, d);

  // Rebuild derived state (no simulation side effects).
  game.recomputeDerived();
  return game;
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

/**
 * save.test.mjs - headless tests for the save format (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Covers the packing added in save version 3 (map layers PackBits run-length
 * coded as "pb:<base64>", paths as 16-bit values "u16:<base64>"), that saves
 * from older versions (plain base64 layers, array paths) still load, and that
 * an Uber (256x256) city saves to a size that fits comfortably in browser
 * storage and loads back intact.
 * The basic city round trip is in sim.test.mjs, military state in
 * military.test.mjs.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { serializeGame, deserializeGame, packBits, unpackBits, encodeLayer, decodeLayer, encodeBytes, decodeBytes, encodePath, decodePath } from '../src/core/save.js';
import { MAP_SIZES } from '../src/world/mapgen.js';
import { buildDemoCity } from '../src/dev/demoCity.js';
import { newGame } from './helpers.mjs';

log.setLevel('error');

const LAYERS = ['terrain', 'variant', 'road', 'aqueduct', 'rubble', 'fixedRoad', 'wall'];

/** Deterministic pseudo-random bytes. */
function noise(n, seed = 7) {
  let s = seed >>> 0;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

test('save: PackBits round-trips every kind of data', () => {
  const cases = {
    empty: new Uint8Array(0),
    one: Uint8Array.of(5),
    two: Uint8Array.of(5, 5),
    three: Uint8Array.of(5, 5, 5),
    zeros: new Uint8Array(65536),
    random: noise(70000),
    // Run lengths around the 128-byte limits of both kinds of run.
    runs: Uint8Array.from({ length: 5000 }, (_, i) => Math.floor(i / 127) % 3),
    longRuns: Uint8Array.from({ length: 5000 }, (_, i) => (i < 129 ? 1 : i < 258 ? 2 : i < 390 ? 3 : 4)),
    // Short runs of 2 between literals (not worth a repeat) and exact 128s.
    pairs: Uint8Array.from({ length: 999 }, (_, i) => Math.floor(i / 2) % 7),
    mixed: (() => {
      const a = noise(4096, 3);
      a.fill(9, 1000, 2500);
      a.fill(0, 3000, 3003);
      return a;
    })(),
  };
  for (const [name, src] of Object.entries(cases)) {
    const back = unpackBits(packBits(src), src.length);
    assert.deepEqual(Array.from(back), Array.from(src), name);
  }
  assert.ok(packBits(cases.zeros).length <= 1024, `zeros pack to ${packBits(cases.zeros).length} bytes`);
  assert.ok(packBits(cases.random).length < cases.random.length * 1.01, 'random data grows under 1%');
});

test('save: layers use "pb:" only when it helps, and decode either way', () => {
  const flat = new Uint8Array(4096);
  const rough = noise(4096);
  assert.ok(encodeLayer(flat).startsWith('pb:'));
  assert.ok(!encodeLayer(rough).startsWith('pb:'), 'random data stays plain base64');
  assert.deepEqual(Array.from(decodeLayer(encodeLayer(flat), 4096)), Array.from(flat));
  assert.deepEqual(Array.from(decodeLayer(encodeLayer(rough), 4096)), Array.from(rough));
  // Older saves: plain base64, no prefix.
  assert.deepEqual(Array.from(decodeLayer(encodeBytes(rough), 4096)), Array.from(rough));
});

test('save: corrupt compressed layers fail with a readable error', () => {
  const good = packBits(new Uint8Array(1000));
  assert.throws(() => unpackBits(good.slice(0, good.length - 2), 1000), /Corrupt map layer/, 'truncated');
  assert.throws(() => unpackBits(good, 999), /Corrupt map layer/, 'too long');
  assert.throws(() => unpackBits(good, 1001), /Corrupt map layer/, 'too short');
  assert.throws(() => unpackBits(Uint8Array.of(5, 1, 2), 6), /Corrupt map layer/, 'literal runs past the data');
  assert.throws(() => decodeLayer(42, 10), /not a string/);
});

test('save: paths pack to 16-bit values and come back the same', () => {
  const path = [0, 1, 255, 256, 257, 4096, 65535, 12345];
  const packed = encodePath(path);
  assert.ok(packed.startsWith('u16:'));
  assert.deepEqual(decodePath(packed), path);
  assert.equal(encodePath(null), null);
  assert.equal(decodePath(null), null);
  assert.deepEqual(decodePath(encodePath([])), []);
  // Older saves stored arrays; values that don't fit stay a plain array.
  assert.deepEqual(decodePath([3, 4, 5]), [3, 4, 5]);
  assert.deepEqual(encodePath([1, -1, 70000]), [1, -1, 70000]);
  assert.throws(() => decodePath('garbage'), /Corrupt path/);
});

test('save: a version 2 save (plain base64 layers) still loads', () => {
  const game = newGame({ seed: 'old-save' });
  buildDemoCity(game, { level: 1 });
  game.runDays(16 * 2);
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  assert.equal(data.version, CONFIG.SAVE_VERSION);
  // Rewrite it the way version 2 wrote it.
  data.version = 2;
  for (const name of LAYERS) data.map[name] = encodeBytes(decodeLayer(data.map[name], game.map.size));
  for (const w of data.walkers) w.path = decodePath(w.path);
  assert.ok(LAYERS.every((name) => !data.map[name].startsWith('pb:')));
  assert.ok(data.walkers.some((w) => Array.isArray(w.path) && w.path.length > 1), 'some walkers mid-path');
  const copy = deserializeGame(data);
  for (const name of LAYERS) assert.deepEqual(Array.from(copy.map[name]), Array.from(game.map[name]), name);
  assert.equal(copy.buildings.size, game.buildings.size);
  for (const w of game.walkers.values()) assert.deepEqual(copy.walkers.get(w.id).path, w.path ? Array.from(w.path) : null);
  copy.runDays(16);
});

test('save: an Uber city saves small and loads back the same', () => {
  const game = newGame({ size: MAP_SIZES.uber, seed: 'uber-save', money: 90000 });
  assert.equal(game.map.w, 256);
  const res = buildDemoCity(game, { level: 2 });
  assert.ok(res.ok, res.reason);
  game.runDays(16 * 3);
  const text = JSON.stringify(serializeGame(game));
  // Uncompressed, the seven layers alone were about 600 KB of base64.
  assert.ok(text.length < 300 * 1024, `save is ${Math.round(text.length / 1024)} KB`);
  const copy = deserializeGame(JSON.parse(text));
  for (const name of LAYERS) assert.deepEqual(Array.from(copy.map[name]), Array.from(game.map[name]), name);
  assert.equal(copy.buildings.size, game.buildings.size);
  assert.equal(copy.walkers.size, game.walkers.size);
  for (const w of game.walkers.values()) assert.deepEqual(copy.walkers.get(w.id).path, w.path ? Array.from(w.path) : null, `walker ${w.id} path`);
  assert.equal(copy.time.totalTicks, game.time.totalTicks);
  // Saved and loaded, the city carries on exactly as the original does.
  game.runDays(16);
  copy.runDays(16);
  assert.equal(copy.city.population, game.city.population);
  assert.equal(Math.round(copy.city.treasury), Math.round(game.city.treasury));
});

test('save: base64 helpers round-trip large arrays', () => {
  const big = noise(200000, 11); // bigger than the 32 KB chunk used to build the string
  assert.deepEqual(Array.from(decodeBytes(encodeBytes(big))), Array.from(big));
});

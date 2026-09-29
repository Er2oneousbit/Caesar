/**
 * render.test.mjs - headless tests for the render layer's pure logic (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Canvas drawing itself is checked by the browser smoke test and the
 * screenshots; these tests cover the math that decides WHAT gets drawn:
 *   - camera: animated zoom keeps the point under the cursor fixed, glides
 *     land on their target, flings slow down and stop, and turning motion
 *     off makes all of it instant
 *   - sprite cache: over its time budget it borrows the other zoom level's
 *     art instead of stalling the frame
 *   - day and night: the sky cycle is continuous, lamps are on at night and
 *     off by day, and it follows game ticks
 *   - seasons: months map to seasons, palettes change month by month
 *   - weather: the state machine only snows in winter, eases levels, and a
 *     storm throws lightning with thunder
 *   - edge blending: a tile learns which stronger ground borders it
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { Camera, worldOf } from '../src/render/camera.js';
import { SpriteCache } from '../src/render/sprites.js';
import { skyAt, dayTime, DAY_TICKS } from '../src/render/lighting.js';
import { seasonOf, seasonPalette, Weather, WEATHER } from '../src/render/weather.js';
import { blendCode } from '../src/render/renderer.js';
import { GameMap, Terrain } from '../src/world/map.js';

/** A camera looking at a 64x64 map through an 800x600 CSS px view. */
function makeCamera(smooth = true) {
  const cam = new Camera();
  cam.setMapBounds(64, 64);
  cam.resize(800, 600, 1);
  cam.smooth = smooth;
  cam.centerOnTile(32, 32);
  return cam;
}

/** Run the camera for `seconds` at 60 fps. */
function run(cam, seconds) {
  for (let t = 0; t < seconds; t += 1 / 60) cam.update(1 / 60);
}

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

test('camera: animated zoom eases to the next level and keeps the cursor spot fixed', () => {
  const cam = makeCamera();
  const before = cam.screenToWorld(200, 150);
  const z0 = cam.zoom;
  assert.ok(cam.zoomStep(1, 200, 150));
  assert.equal(cam.zoom, z0, 'nothing jumps on the click itself');
  assert.equal(cam.targetZoom, CONFIG.ZOOM_LEVELS[CONFIG.DEFAULT_ZOOM_INDEX + 1]);
  cam.update(1 / 60);
  assert.ok(cam.zoom > z0 && cam.zoom < cam.targetZoom, 'part way there after one frame');
  const mid = cam.screenToWorld(200, 150);
  near(mid.x, before.x, 1e-6, 'x under cursor mid-zoom');
  near(mid.y, before.y, 1e-6, 'y under cursor mid-zoom');
  run(cam, 1);
  assert.equal(cam.zoom, cam.targetZoom, 'arrives exactly');
  assert.equal(cam.moving, false);
  const after = cam.screenToWorld(200, 150);
  near(after.x, before.x, 1e-6, 'x under cursor after');
  near(after.y, before.y, 1e-6, 'y under cursor after');
});

test('camera: sprites are drawn for the zoom level, not the in-between zoom', () => {
  const cam = makeCamera();
  cam.zoomStep(-1);
  cam.update(1 / 60);
  assert.notEqual(cam.scale, cam.spriteScale);
  assert.equal(cam.spriteScale, cam.targetZoom * cam.dpr);
});

test('camera: a glide travels to the tile and ends centered on it', () => {
  const cam = makeCamera();
  cam.glideToTile(20, 40);
  assert.ok(cam.glide, 'glide started');
  cam.update(0.05);
  const target = worldOf(20.5, 40.5);
  const c1 = cam.center();
  assert.ok(Math.hypot(c1.x - target.x, c1.y - target.y) > 1, 'not there yet after one step');
  run(cam, 2);
  const c = cam.center();
  near(c.x, target.x, 1e-6, 'center x');
  near(c.y, target.y, 1e-6, 'center y');
  assert.equal(cam.glide, null);
});

test('camera: a player pan cancels a glide', () => {
  const cam = makeCamera();
  cam.glideToTile(10, 10);
  cam.update(0.05);
  cam.panScreen(5, 0);
  assert.equal(cam.glide, null);
});

test('camera: a fling slides, slows down and stops', () => {
  const cam = makeCamera();
  const x0 = cam.x;
  cam.fling(-1500, 0); // dragged left fast: the view keeps moving right
  assert.ok(cam.vel);
  cam.update(1 / 60);
  const step1 = cam.x - x0;
  assert.ok(step1 > 0, 'moving');
  const x1 = cam.x;
  cam.update(1 / 60);
  assert.ok(cam.x - x1 < step1, 'slowing down');
  run(cam, 5);
  assert.equal(cam.vel, null, 'stopped');
  cam.fling(20, 0);
  assert.equal(cam.vel, null, 'tiny flings are ignored');
});

test('camera: with motion off, zoom and glides are instant', () => {
  const cam = makeCamera(false);
  const before = cam.screenToWorld(100, 100);
  cam.zoomStep(1, 100, 100);
  assert.equal(cam.zoom, cam.targetZoom);
  const after = cam.screenToWorld(100, 100);
  near(after.x, before.x, 1e-6, 'cursor spot x');
  near(after.y, before.y, 1e-6, 'cursor spot y');
  cam.glideToTile(5, 5);
  assert.equal(cam.glide, null);
  const c = cam.center();
  const t = worldOf(5.5, 5.5);
  const clamped = cam.clampCenter(t.x, t.y);
  near(c.x, clamped.x, 1e-6, 'jumped x');
  near(c.y, clamped.y, 1e-6, 'jumped y');
  cam.fling(-2000, 0);
  assert.equal(cam.vel, null);
});

test('camera: setting zoomIndex directly jumps (saves, test views)', () => {
  const cam = makeCamera();
  cam.zoomIndex = 0;
  assert.equal(cam.zoom, CONFIG.ZOOM_LEVELS[0]);
  assert.equal(cam.moving, false);
  cam.restore({ x: 10, y: 20, zoomIndex: 4 });
  assert.equal(cam.zoom, CONFIG.ZOOM_LEVELS[4]);
});

// --- sprite cache ---------------------------------------------------------

/** Minimal stand-in canvas for node: every context method is a no-op. */
class FakeCanvas {
  constructor(w, h) { this.width = w; this.height = h; }
  getContext() { return new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } }); }
}

test('sprite cache: over budget it borrows the other zoom level, then catches up', () => {
  const had = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = FakeCanvas;
  try {
    const cache = new SpriteCache();
    const spec = () => ({ w: 10, h: 10, ax: 5, ay: 5, draw() {} });
    cache.beginFrame(1);
    for (let k = 0; k < 5; k++) cache.get(`a${k}`, spec);
    // New zoom level with no time budget left: existing art is borrowed.
    cache.beginFrame(2, 0);
    cache.spentMs = 1; // pretend the budget is already used up
    const borrowed = cache.get('a0', spec);
    assert.equal(borrowed.s, 1, 'borrowed from scale 1');
    assert.equal(cache.borrowed, 1);
    // Art that exists nowhere is still drawn (something must show).
    const fresh = cache.get('new', spec);
    assert.equal(fresh.s, 2);
    // Next frame with budget: the sharp version is made.
    cache.beginFrame(2);
    assert.equal(cache.get('a0', spec).s, 2);
    // Only two zoom levels are kept.
    cache.beginFrame(4);
    cache.get('a1', spec);
    assert.equal(cache.byScale.size, 2);
  } finally {
    globalThis.OffscreenCanvas = had;
  }
});

// --- day and night --------------------------------------------------------

test('sky: noon is plain daylight, midnight is dark with the lamps lit', () => {
  const noon = skyAt(0.3);
  assert.deepEqual(noon.tint, [255, 255, 255]);
  assert.equal(noon.lamps, 0);
  assert.equal(noon.sun, 1);
  const night = skyAt(0.8);
  assert.ok(night.tint.every((c) => c < 200), `night tint ${night.tint}`);
  assert.ok(night.tint[2] > night.tint[0], 'night is blue');
  assert.equal(night.lamps, 1);
  assert.equal(night.sun, 0);
  const sunset = skyAt(0.67);
  assert.ok(sunset.tint[0] > sunset.tint[2], 'sunset is warm');
});

test('sky: the cycle has no jumps (so the light never pops)', () => {
  let prev = skyAt(0);
  for (let t = 0.001; t <= 1.0001; t += 0.001) {
    const s = skyAt(t);
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(s.tint[c] - prev.tint[c]) <= 6, `tint jump at ${t.toFixed(3)}`);
    assert.ok(Math.abs(s.lamps - prev.lamps) <= 0.06, `lamp jump at ${t.toFixed(3)}`);
    prev = s;
  }
});

test('sky: time of day follows game ticks and wraps once per day', () => {
  const a = dayTime(1000);
  assert.ok(a >= 0 && a < 1);
  assert.ok(Math.abs(dayTime(1000 + DAY_TICKS) - a) < 1e-9, 'one day later, same time');
  assert.ok(dayTime(0) < 0.3, 'a new game starts in the morning');
});

// --- seasons ---------------------------------------------------------------

test('seasons: months map to seasons, palettes shift month by month', () => {
  assert.equal(seasonOf(0), 'winter');
  assert.equal(seasonOf(11), 'winter');
  assert.equal(seasonOf(3), 'spring');
  assert.equal(seasonOf(6), 'summer');
  assert.equal(seasonOf(9), 'autumn');
  const keys = new Set();
  for (let m = 0; m < 12; m++) keys.add(seasonPalette(m).grass);
  assert.equal(keys.size, 12, 'every month has its own grass color');
  assert.equal(seasonPalette(null).key, 's', 'seasons off: one fixed look');
  assert.equal(seasonPalette(null).grass, seasonPalette(6).grass, 'the fixed look is summer');
  assert.ok(seasonPalette(0).bare > 0.3, 'many winter trees are bare');
  assert.equal(seasonPalette(6).bare, 0, 'no bare trees in summer');
  assert.ok(seasonPalette(3).blossom > 0.3, 'spring blossoms');
});

// --- weather ---------------------------------------------------------------

/** Deterministic random numbers for the weather tests. */
function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

test('weather: it only snows in winter, and snow turns to rain in spring', () => {
  const w = new Weather(seeded(7));
  const seen = new Set();
  for (let i = 0; i < 3000; i++) {
    w.update(5, 'summer');
    seen.add(w.kind);
  }
  assert.ok(!seen.has('snow'), 'no summer snow');
  assert.ok(seen.has('clear') && seen.size >= 3, `a mix of weather: ${[...seen]}`);
  w.force('snow', true);
  w.update(1, 'spring');
  assert.equal(w.kind, 'rain');
});

test('weather: levels ease toward the new weather instead of jumping', () => {
  const w = new Weather(seeded(3));
  w.force('rain');
  assert.equal(w.rain, 0, 'nothing yet');
  w.update(1, 'autumn');
  assert.ok(w.rain > 0 && w.rain < WEATHER.rain.rain, 'building up');
  for (let i = 0; i < 60; i++) w.update(1, 'autumn');
  assert.ok(Math.abs(w.rain - WEATHER.rain.rain) < 0.02, 'arrived');
  w.update(0, 'autumn'); // paused: nothing moves
});

test('weather: a thunderstorm flashes and calls for thunder', () => {
  const w = new Weather(seeded(11));
  let thunder = 0;
  w.onThunder = (delay) => { assert.ok(delay > 0); thunder++; };
  w.force('storm', true);
  let flashed = false;
  for (let i = 0; i < 400; i++) {
    w.update(0.1, 'summer');
    if (w.flash > 0.5) flashed = true;
  }
  assert.ok(flashed, 'lightning flashed');
  assert.ok(thunder >= 2, `thunder ${thunder}`);
  const t = w.tint();
  assert.ok(t.every((c) => c < 255), 'a storm darkens the scene');
});

// --- edge blending ----------------------------------------------------------

test('blend: a sand tile next to grass gets a grass fringe on that edge', () => {
  const map = new GameMap(16, 16);
  map.terrain.fill(Terrain.SAND);
  map.terrain[map.idx(5, 4)] = Terrain.GRASS; // north of (5, 5)
  const code = blendCode(map, 5, 5);
  assert.equal(code >> 8, Terrain.GRASS);
  assert.equal((code >> 4) & 15, 1, 'north edge');
  assert.equal(code & 15, 0, 'no corners');
  // The grass tile itself is stronger: nothing blends onto it.
  assert.equal(blendCode(map, 5, 4), 0);
  // Only a diagonal neighbour: a corner blob (north-east).
  const c2 = blendCode(map, 4, 5);
  assert.equal((c2 >> 4) & 15, 0);
  assert.equal(c2 & 15, 1, 'NE corner');
  // Water never blends.
  map.terrain[map.idx(9, 9)] = Terrain.WATER;
  map.terrain[map.idx(9, 8)] = Terrain.GRASS;
  assert.equal(blendCode(map, 9, 9), 0);
});

test('blend: a corner is skipped when an edge next to it already blends', () => {
  const map = new GameMap(16, 16);
  map.terrain.fill(Terrain.MEADOW);
  map.terrain[map.idx(5, 4)] = Terrain.GRASS; // N
  map.terrain[map.idx(6, 4)] = Terrain.GRASS; // NE (touches the N edge's end)
  const code = blendCode(map, 5, 5);
  assert.equal((code >> 4) & 15, 1);
  assert.equal(code & 15, 0);
});

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
 *   - weather: snow only in winter and nothing but snow in winter, spring is
 *     the rainy season, a new season draws new weather, levels ease, and a
 *     storm throws lightning with thunder
 *   - edge blending: a tile learns which stronger ground borders it
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG, HALF_W, HALF_H } from '../src/config.js';
import { Camera, worldOf } from '../src/render/camera.js';
import { SpriteCache } from '../src/render/sprites.js';
import { skyAt, dayTime, DAY_TICKS } from '../src/render/lighting.js';
import { seasonOf, seasonPalette, seasonalKind, Weather, WEATHER, SEASON_NAMES, MONTH_LOOK, SNOW_LEVELS, coverLevelOf } from '../src/render/weather.js';
import { groundColor } from '../src/render/terrainArt.js';
import { GameTime } from '../src/sim/time.js';
import { blendCode, mapGateOffset } from '../src/render/renderer.js';
import { generateMap } from '../src/world/mapgen.js';
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
  // Season boundaries follow the calendar: Dec-Feb, Mar-May, Jun-Aug, Sep-Nov.
  assert.deepEqual([...Array(12).keys()].map((m) => SEASON_NAMES[seasonOf(m)]),
    ['Winter', 'Winter', 'Spring', 'Spring', 'Spring', 'Summer', 'Summer', 'Summer', 'Fall', 'Fall', 'Fall', 'Winter']);
  const t = new GameTime();
  assert.equal(t.season(), 'winter', 'a new game starts in mid-winter (Ianuarius)');
  const keys = new Set();
  for (let m = 0; m < 12; m++) keys.add(seasonPalette(m).grass);
  assert.equal(keys.size, 9, 'the three winter months and Iunius/Iulius share a look; the rest each have their own');
  assert.equal(seasonPalette(null).key, 's', 'seasons off: one fixed look');
  assert.equal(seasonPalette(null).grass, seasonPalette(6).grass, 'the fixed look is summer');
  assert.ok(seasonPalette(0).bare > 0.3, 'many winter trees are bare');
  assert.equal(seasonPalette(6).bare, 0, 'no bare trees in summer');
  assert.ok(seasonPalette(3).blossom > 0.3, 'spring blossoms');
});

test('seasons: every month it can snow in looks fully wintry', () => {
  const winter = seasonPalette(0);
  for (let m = 0; m < 12; m++) {
    const p = seasonPalette(m);
    if (seasonOf(m) === 'winter') {
      assert.equal(MONTH_LOOK[m], 0, `month ${m} is pure winter`);
      assert.equal(p.key, winter.key, `month ${m} shares the winter sprites`);
      assert.deepEqual(p.leaves, winter.leaves, `month ${m}: no autumn leaves left`);
    } else {
      assert.notEqual(p.key, winter.key, `month ${m} is not winter`);
    }
  }
  // The shoulder months blend: early spring and late autumn are part winter.
  assert.ok(seasonPalette(2).bare > 0 && seasonPalette(2).bare < winter.bare, 'Martius: a few trees still bare');
  assert.ok(seasonPalette(10).bare > seasonPalette(9).bare && seasonPalette(10).bare < winter.bare, 'November: leaves falling');
});

test('seasons: snow cover is part of the palette (and never with seasons off)', () => {
  const keys = new Set();
  let last = -1;
  for (let l = 0; l <= SNOW_LEVELS; l++) {
    const p = seasonPalette(0, l);
    keys.add(p.key);
    assert.equal(p.snowLevel, l);
    assert.ok(p.snow > last, 'deeper snow is whiter');
    last = p.snow;
    assert.equal(p.grass, seasonPalette(0).grass, 'the season colors are the same under the snow');
  }
  assert.equal(keys.size, SNOW_LEVELS + 1, 'each snow level has its own sprites');
  assert.equal(seasonPalette(0, 0).key, seasonPalette(0).key, 'no snow: the plain winter key');
  assert.equal(seasonPalette(null, 3).key, 's', 'seasons off: never any snow');
  assert.equal(seasonPalette(null, 3).snow, 0);
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255); };
  assert.ok(lum(groundColor(Terrain.GRASS, seasonPalette(0, 3))) > lum(groundColor(Terrain.GRASS, seasonPalette(0))) + 200, 'deep snow whitens the grass');
  assert.equal(groundColor(Terrain.WATER, seasonPalette(0, 3)), groundColor(Terrain.WATER, seasonPalette(0)), 'water stays water');
});

// --- weather ---------------------------------------------------------------

/** Deterministic random numbers for the weather tests. */
function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** Run the weather through `years` of the calendar; per season: seconds of each kind and of visible rain/snow. */
function weatherHistory(w, years, dt = 0.25) {
  const out = {};
  const monthSec = (CONFIG.TICKS_PER_DAY * CONFIG.DAYS_PER_MONTH) / CONFIG.TICKS_PER_SECOND;
  for (let t = 0; t < years * 12 * monthSec; t += dt) {
    const season = seasonOf(Math.floor(t / monthSec) % 12);
    w.update(dt, season);
    const s = (out[season] ||= { t: 0, clear: 0, cloudy: 0, rain: 0, storm: 0, snow: 0, wet: 0, white: 0, bad: [] });
    s.t += dt;
    s[w.kind] += dt;
    if (w.rain > 0.1) s.wet += dt;
    if (w.snow > 0.1) s.white += dt;
    if (season === 'winter' ? w.rain > 0 : w.snow > 0) s.bad.push(t);
  }
  return out;
}

test('weather: snow falls only in winter, and in winter nothing but snow', () => {
  assert.equal(seasonalKind('rain', 'winter'), 'snow');
  assert.equal(seasonalKind('storm', 'winter'), 'snow');
  assert.equal(seasonalKind('snow', 'spring'), 'rain');
  assert.equal(seasonalKind('clear', 'winter'), 'clear');
  assert.equal(seasonalKind('storm', 'summer'), 'storm');
  for (let seed = 1; seed <= 4; seed++) {
    const w = new Weather(seeded(seed));
    let winterBolts = 0;
    let season = '';
    w.onThunder = () => { if (season === 'winter') winterBolts++; };
    const orig = w.update.bind(w);
    w.update = (dt, s) => { season = s; orig(dt, s); };
    const h = weatherHistory(w, 30);
    assert.equal(h.winter.rain + h.winter.storm, 0, `seed ${seed}: no rain or storms in winter`);
    assert.equal(winterBolts, 0, `seed ${seed}: no thunder in winter`);
    assert.ok(h.winter.snow > 0 && h.winter.white > 0, `seed ${seed}: it snows in winter`);
    for (const s of ['spring', 'summer', 'autumn']) assert.equal(h[s].snow + h[s].white, 0, `seed ${seed}: no snow in ${s}`);
    for (const s of ['winter', 'spring', 'summer', 'autumn']) assert.deepEqual(h[s].bad, [], `seed ${seed} ${s}: wrong precipitation drawn`);
  }
});

test('weather: spring is the rainy season, summer mostly clear, winter snowy', () => {
  const h = weatherHistory(new Weather(seeded(7)), 300, 0.5);
  const share = (s, k) => h[s][k] / h[s].t;
  assert.ok(share('spring', 'wet') > 2 * share('summer', 'wet'), `spring rain ${share('spring', 'wet').toFixed(2)} vs summer ${share('summer', 'wet').toFixed(2)}`);
  assert.ok(share('spring', 'wet') > share('autumn', 'wet'), 'spring is wetter than fall');
  assert.ok(share('autumn', 'wet') > share('summer', 'wet'), 'fall is wetter than summer');
  assert.ok(share('summer', 'clear') > 0.6, `summer clear ${share('summer', 'clear').toFixed(2)}`);
  assert.ok(share('summer', 'storm') > share('summer', 'rain'), 'summer rain comes as thunderstorms');
  assert.ok(share('winter', 'white') > 0.3, `winter snow ${share('winter', 'white').toFixed(2)}`);
});

test('weather: a new season brings new weather at once; the old rain or snow stops', () => {
  const w = new Weather(seeded(3));
  w.update(1, 'autumn');
  w.force('rain', true);
  w.update(1, 'autumn');
  assert.ok(w.rain > 0.5, 'raining in the fall');
  w.update(0.1, 'winter');
  assert.equal(w.rain, 0, 'the rain stops as winter starts');
  assert.notEqual(w.kind, 'rain');
  assert.ok(w.timer > 15, `a new spell was drawn (${w.timer.toFixed(1)} s)`);
  w.force('snow', true);
  w.update(1, 'winter');
  assert.ok(w.snow > 0.5, 'snowing');
  w.update(0.1, 'spring');
  assert.equal(w.snow, 0, 'the snow melts away as spring starts');
  // Forced from the console in the wrong season: fitted at the next update.
  w.force('snow', true);
  w.update(0.1, 'spring');
  assert.equal(w.kind, 'rain');
  assert.equal(w.snow, 0);
  // Paused (dt 0) the rules still hold: turning Seasons off mid-snowfall
  // (the weather then follows summer) stops the snow at once.
  w.force('snow', true);
  w.update(1, 'winter');
  assert.ok(w.snow > 0.5);
  w.update(0, 'summer');
  assert.equal(w.snow, 0, 'no snow on summer ground, even while paused');
  assert.equal(w.kind, 'rain');
});

test('weather: levels ease toward the new weather instead of jumping', () => {
  const w = new Weather(seeded(3));
  w.force('rain');
  assert.equal(w.rain, 0, 'nothing yet');
  w.update(1, 'autumn');
  assert.ok(w.rain > 0 && w.rain < WEATHER.rain.rain, 'building up');
  for (let i = 0; i < 40; i++) w.update(1, 'autumn'); // within the forced spell (FORCE_HOLD)
  assert.ok(Math.abs(w.rain - WEATHER.rain.rain) < 0.02, 'arrived');
  w.update(0, 'autumn'); // paused: nothing moves
});

test('weather: rain and snow never fall at the same time', () => {
  // Long histories that switch between winter and spring, so they hit every
  // snow -> rain and rain -> snow change, and snow melting into spring rain.
  for (let seed = 1; seed <= 8; seed++) {
    const w = new Weather(seeded(seed));
    for (let i = 0; i < 12000; i++) {
      w.update(1 / 3, Math.floor(i / 1500) % 2 ? 'spring' : 'winter');
      assert.ok(!(w.rain > 0 && w.snow > 0), `seed ${seed} step ${i}: rain ${w.rain.toFixed(3)} with snow ${w.snow.toFixed(3)}`);
    }
  }
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

test('weather: snow settles over a few days and melts after, faster in spring and rain', () => {
  const DAY = CONFIG.TICKS_PER_DAY / CONFIG.TICKS_PER_SECOND; // game seconds per day
  const w = new Weather(seeded(3));
  w.force('snow');
  let t = 0;
  const reached = [];
  while (w.coverLevel < SNOW_LEVELS && t < 30 * DAY) {
    w.timer = 1e9; // keep it snowing
    w.update(0.1, 'winter');
    t += 0.1;
    if (reached[w.coverLevel] === undefined) reached[w.coverLevel] = t / DAY;
  }
  assert.ok(reached[1] > 0.5 && reached[1] < 4, `a dusting after ${reached[1]} days`);
  assert.ok(reached[3] > 3 && reached[3] < 9, `deep snow after ${reached[3]} days`);
  const meltDays = (season, kind) => {
    const v = new Weather(seeded(5));
    v.force('snow', true);
    v.cover = 1;
    v.coverLevel = SNOW_LEVELS;
    v.force(kind);
    let tt = 0;
    while (v.cover > 0 && tt < 200 * DAY) { v.timer = 1e9; v.update(0.1, season); tt += 0.1; }
    assert.equal(v.coverLevel, 0);
    return tt / DAY;
  };
  const winterDry = meltDays('winter', 'clear');
  const spring = meltDays('spring', 'clear');
  const springRain = meltDays('spring', 'rain'); // (winter has no rain: it falls as snow)
  assert.ok(winterDry > 15 && winterDry < 45, `winter snow lies ${winterDry} days`);
  assert.ok(spring < winterDry / 2, `spring melts it (${spring} days)`);
  assert.ok(springRain < spring, `rain washes it away faster (${springRain} vs ${spring} days)`);
  // Quantized with a little hysteresis, so a level never flickers.
  assert.equal(coverLevelOf(0.5, 0), 2);
  assert.equal(coverLevelOf(0.44, 2), 2, 'just under the step: stays');
  assert.equal(coverLevelOf(0.38, 2), 1, 'clearly under: steps down');
  w.clearCover();
  assert.equal(w.cover, 0);
  assert.equal(w.coverLevel, 0);
});

test('sprite keys: dropping one look or snow level never drops another', () => {
  // The renderer forgets an old look with key.endsWith(suffix): ground and
  // tree keys end in ~{palette key} (p0, p0n2, p10...), building and rock keys
  // in ~n{level} (or nothing without snow).
  const looks = new Set();
  for (let m = 0; m < 12; m++) for (let l = 0; l <= SNOW_LEVELS; l++) looks.add(seasonPalette(m, l).key);
  looks.add(seasonPalette(null).key);
  const ground = [...looks].map((k) => `g1.3.12~${k}`);
  const snowSuffixes = ['', ...Array.from({ length: SNOW_LEVELS }, (_, i) => `~n${i + 1}`)];
  const builds = snowSuffixes.map((sfx) => `b:house:1:0:3${sfx}`);
  const all = [...ground, ...builds, 'k2', 'k2~n1'];
  for (const k of looks) {
    const hit = all.filter((key) => key.endsWith(`~${k}`));
    assert.deepEqual(hit, [`g1.3.12~${k}`], `dropping look ${k}`);
  }
  for (const sfx of snowSuffixes.slice(1)) {
    const hit = all.filter((key) => key.endsWith(sfx));
    assert.ok(hit.every((key) => key.startsWith('b:') || key.startsWith('k')), `dropping ${sfx} keeps ground and trees`);
    assert.ok(hit.length >= 1);
  }
});

test('sprite cache: a new look is prepared behind the old one, then swapped whole', () => {
  const had = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = FakeCanvas;
  try {
    const cache = new SpriteCache();
    const spec = () => ({ w: 10, h: 10, ax: 5, ay: 5, draw() {} });
    cache.beginFrame(1);
    const old = cache.get('g1~p0', spec);
    cache.beginFrame(1, 0);
    cache.spentMs = 1; // budget used up
    assert.equal(cache.get('g1~p0n1', spec, 'g1~p0'), old, 'the old look is drawn');
    assert.equal(cache.pending, 1, 'the new sprite is still missing');
    assert.ok(!cache.current.has('g1~p0n1'));
    assert.notEqual(cache.get('g2~p0n1', spec, 'g2~p0'), undefined, 'no old art: drawn anyway');
    cache.beginFrame(1); // a frame with time
    assert.equal(cache.get('g1~p0n1', spec, 'g1~p0'), old, 'still the old look while the change runs');
    assert.ok(cache.current.has('g1~p0n1'), 'but the new sprite is prepared');
    assert.equal(cache.pending, 0, 'nothing missing: the renderer may swap');
    cache.beginFrame(1);
    const next = cache.get('g1~p0n1', spec); // after the swap (no fallback)
    assert.notEqual(next, old);
    assert.equal(cache.get('g1~p0n1', spec), next, 'cached');
  } finally {
    globalThis.OffscreenCanvas = had;
  }
});

// --- map gates ---------------------------------------------------------------

test('map gates: the entrance and exit pillars stand across the Imperial road', () => {
  for (const type of ['river', 'coast', 'lakes', 'plains', 'desert']) {
    for (const seed of ['g1', 'g2', 'g3']) {
      const { map } = generateMap({ width: 64, height: 64, seed, type });
      for (const end of [map.entry, map.exit]) {
        assert.ok(map.hasRoad(end.x, end.y), `${type}/${seed}: the gate stands on the road`);
        const { ox, oy } = mapGateOffset(map, end);
        // Back from world px to tiles: the pillar's step (a, b) across the road.
        const a = Math.round((ox / HALF_W + oy / HALF_H) / 2 / 0.46);
        const b = Math.round((oy / HALF_H - ox / HALF_W) / 2 / 0.46);
        assert.equal(Math.abs(a) + Math.abs(b), 1, 'one tile step');
        // The road leaves the map edge tile through exactly one neighbour
        // (sometimes along the edge first); the pillars stand across it.
        assert.ok(end.x === 0 || end.y === 0 || end.x === map.w - 1 || end.y === map.h - 1, 'on the map edge');
        const next = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([nx, ny]) => map.hasRoad(end.x + nx, end.y + ny));
        assert.equal(next.length, 1, 'one road on from the edge');
        assert.equal(Math.abs(a * next[0][0] + b * next[0][1]), 0, `${type}/${seed}: across the road, not along it`);
        assert.ok(!map.hasRoad(end.x + a, end.y + b) && !map.hasRoad(end.x - a, end.y - b), 'no road through a pillar');
      }
    }
  }
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

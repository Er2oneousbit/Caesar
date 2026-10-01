/**
 * walkers.test.mjs - headless tests for roadblocks and walker inspection (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Roadblocks: placed only on roads, cleared (and undone) leaving the road,
 * saved with their permissions; roaming walkers turn back at one unless
 * their group may pass, while walkers heading somewhere always pass.
 * Walker inspection: clicking picks the figure under the pointer, and the
 * panel's text says who a walker is, what it carries and what it thinks.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { Game } from '../src/core/game.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { TOOLS } from '../src/data/buildings.js';
import { ROADBLOCK_GROUPS, roadblockBit, WALKER_TYPES } from '../src/data/walkers.js';
import { ROADBLOCK, Wall } from '../src/world/map.js';
import { planAction, undoLast } from '../src/sim/construction.js';
import { spawnWalker } from '../src/sim/entities.js';
import { startRoaming, followPath, pickRoamTile, streetValue } from '../src/sim/movement.js';
import { addBuilding } from '../src/sim/entities.js';
import { updateWalkers } from '../src/sim/walkers.js';
import { walkerInfo, walkerSays, cityTrouble } from '../src/ui/walkerTalk.js';
import { Renderer, walkerWorld } from '../src/render/renderer.js';
import { Camera } from '../src/render/camera.js';
import { roadblockSpec } from '../src/render/terrainArt.js';
import { recordingContext } from '../src/render/draw.js';
import { newGame, build, findFree } from './helpers.mjs';

log.setLevel('error');

/** A straight east-west road of `len` tiles on open land. */
function straightRoad(game, len = 24) {
  const spot = findFree(game, len + 2, 5);
  assert.ok(spot, 'room for a road');
  const y = spot.y + 2;
  const x0 = spot.x + 1;
  const x1 = x0 + len - 1;
  assert.ok(build(game, 'road', x0, y, x1, y).ok, 'road built');
  return { x0, x1, y };
}

/** Tick walkers until `w` is gone (or `ticks` run out); the x of every tile it stood on. */
function trackX(game, w, ticks = 4000) {
  const xs = [w.x];
  for (let t = 0; t < ticks && game.walkers.has(w.id); t++) {
    updateWalkers(game);
    if (xs[xs.length - 1] !== w.x) xs.push(w.x);
  }
  return xs;
}

test('roadblocks go on roads only, and clearing one leaves its road', () => {
  const game = newGame({ seed: 'rb-place' });
  const { map } = game;
  const { x0, y } = straightRoad(game, 12);
  const at = x0 + 5;
  const i = map.idx(at, y);
  assert.equal(planAction(game, 'roadblock', at, y - 2, at, y - 2).reason, 'Roadblocks go on a road');
  const money = game.city.treasury;
  assert.ok(build(game, 'roadblock', at, y).ok);
  assert.equal(map.roadblock[i], ROADBLOCK.PRESENT, 'a new roadblock lets no one through');
  assert.equal(game.city.treasury, money - TOOLS.roadblock.cost);
  assert.equal(planAction(game, 'roadblock', at, y, at, y).count, 0, 'one per tile');
  assert.equal(map.building[i], 0, 'not a building: soldiers and raiders see only the road');
  // Undo: gone, refunded.
  assert.ok(undoLast(game).ok);
  assert.equal(map.roadblock[i], 0);
  assert.equal(game.city.treasury, money);
  // Clear: the roadblock goes first, the road stays; a second clear takes the road.
  assert.ok(build(game, 'roadblock', at, y).ok);
  assert.ok(build(game, 'clear', at, y).ok);
  assert.equal(map.roadblock[i], 0);
  assert.ok(map.road[i], 'the road is still there');
  assert.ok(build(game, 'roadblock', at, y).ok);
  // A wall cannot be dragged over a roadblock, and a roadblock cannot go in a gate.
  assert.ok(!build(game, 'wall', at, y - 1, at, y + 1).ok || map.wall[i] === Wall.NONE, 'no gate over the roadblock');
  assert.equal(map.wall[i], Wall.NONE);
  const gx = x0 + 9;
  assert.ok(build(game, 'wall', gx, y - 1, gx, y + 1).ok);
  assert.equal(map.wall[map.idx(gx, y)], Wall.GATE);
  assert.equal(planAction(game, 'roadblock', gx, y, gx, y).reason, 'Not in a gate');
});

test('a roaming walker turns back at a roadblock unless its group may pass', () => {
  for (const allowed of [false, true]) {
    const game = newGame({ seed: 'rb-roam', size: 96 });
    const { map } = game;
    const { x0, y } = straightRoad(game, 24);
    const rb = x0 + 8;
    assert.ok(build(game, 'roadblock', rb, y).ok);
    if (allowed) map.roadblock[map.idx(rb, y)] |= roadblockBit('priest');
    const w = spawnWalker(game, 'priest', map.idx(x0 + 2, y), null, {});
    startRoaming(game, w, 1); // heading east, toward the roadblock
    const xs = trackX(game, w);
    const far = Math.max(...xs);
    if (allowed) assert.ok(far > rb, `let through: reached x ${far}, past the roadblock at ${rb}`);
    else assert.ok(far < rb, `stopped: got as far as x ${far}, the roadblock is at ${rb} (${xs.join(' ')})`);
  }
});

test('walkers heading somewhere pass roadblocks, and other groups stay stopped', () => {
  const game = newGame({ seed: 'rb-pass' });
  const { map, pf } = game;
  const { x0, x1, y } = straightRoad(game, 20);
  const rb = x0 + 6;
  assert.ok(build(game, 'roadblock', rb, y).ok);
  // Priests may pass; a prefect may not.
  map.roadblock[map.idx(rb, y)] |= roadblockBit('priest');
  const p = spawnWalker(game, 'prefect', map.idx(x0 + 1, y), null, {});
  startRoaming(game, p, 1);
  assert.ok(Math.max(...trackX(game, p)) < rb, 'the prefect turned back');
  // A cart on its way somewhere walks straight through.
  const cart = spawnWalker(game, 'cart', map.idx(x0 + 1, y), null, { state: 'return' });
  followPath(game, cart, pf.roadPath(map.idx(x0 + 1, y), map.idx(x1, y)));
  assert.ok(Math.max(...trackX(game, cart)) >= x1 - 1, 'the cart went past');
  // Only roamers have a group.
  for (const [type, def] of Object.entries(WALKER_TYPES)) {
    if (def.kind === 'roamer') assert.ok(roadblockBit(type) > 0, `${type} has a roadblock group`);
    else assert.equal(roadblockBit(type), 0, `${type} is never stopped`);
  }
  assert.equal(ROADBLOCK_GROUPS.reduce((m, g) => m | g.bit, 0), ROADBLOCK.GROUPS, 'every group bit fits the layer');
});

test('roadblocks and their permissions are saved', () => {
  const game = newGame({ seed: 'rb-save' });
  const { x0, y } = straightRoad(game, 10);
  const i = game.map.idx(x0 + 4, y);
  assert.ok(build(game, 'roadblock', x0 + 4, y).ok);
  game.map.roadblock[i] |= roadblockBit('vendor') | roadblockBit('taxman');
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  const back = deserializeGame(data);
  assert.equal(back.map.roadblock[i], game.map.roadblock[i]);
  // A save from before roadblocks has none.
  delete data.map.roadblock;
  const old = deserializeGame(data);
  assert.equal(old.map.roadblock.reduce((n, v) => n + (v ? 1 : 0), 0), 0);
});

test('clicking picks the walker figure under the pointer', () => {
  const cam = new Camera();
  cam.setMapBounds(64, 64);
  cam.resize(800, 600, 1);
  cam.centerOnTile(32, 32);
  const walkers = [
    { id: 7, x: 32, y: 32, tx: 33, ty: 32, progress: 0.5, moving: true, speed: 0.1, kind: 'roamer' },
    { id: 9, x: 36, y: 30, tx: 36, ty: 30, progress: 0, moving: false, speed: 0.1, kind: 'traveler' },
  ];
  const r = { camera: cam, walkerSpots: walkers.map((w) => ({ id: w.id, ...walkerWorld(w, 0), ship: false })) };
  const pick = (sx, sy) => Renderer.prototype.pickWalker.call(r, sx, sy);
  const screenOf = (w, up = 10) => {
    const { wx, wy } = walkerWorld(w, 0);
    const s = cam.toScreen(wx, wy - up);
    return { x: s.x / cam.dpr, y: s.y / cam.dpr };
  };
  for (const w of walkers) {
    const s = screenOf(w);
    assert.equal(pick(s.x, s.y), w.id, `walker ${w.id} under its body`);
  }
  const s = screenOf(walkers[0]);
  assert.equal(pick(s.x + 40, s.y), 0, 'nothing 40 px to the side');
  assert.equal(pick(s.x, s.y - 60), 0, 'nothing well above its head');
  // A tall building just in front of a walker hides it: the click is the building's.
  const behind = { id: 11, x: 20, y: 20, tx: 20, ty: 20, progress: 0, moving: false, speed: 0.1, kind: 'roamer' };
  const inFront = { id: 12, x: 22, y: 22, tx: 22, ty: 22, progress: 0, moving: false, speed: 0.1, kind: 'roamer' };
  r.walkerSpots = [behind, inFront].map((w) => ({ id: w.id, ...walkerWorld(w, 0), ship: false }));
  r.buildingBoxes = [{ x: 21, y: 21, S: 1, H: 40 }];
  cam.centerOnTile(21, 21);
  const b1 = screenOf(behind);
  assert.equal(pick(b1.x, b1.y), 0, 'the walker behind the building is hidden');
  r.buildingBoxes = [];
  assert.equal(pick(b1.x, b1.y), 11, 'with nothing in front it can be clicked');
  r.buildingBoxes = [{ x: 21, y: 21, S: 1, H: 40 }];
  const f1 = screenOf(inFront);
  assert.equal(pick(f1.x, f1.y), 12, 'a walker in front of the building is clicked');
  // Zoomed out a figure is a few pixels wide; its target stays about 22 x 36
  // CSS px, so a click a little beside or above it still finds it.
  r.buildingBoxes = [];
  r.walkerSpots = walkers.map((w) => ({ id: w.id, ...walkerWorld(w, 0), ship: false }));
  cam.zoomIndex = 0;
  cam.centerOnTile(32, 32);
  const z = screenOf(walkers[0], 0);
  assert.equal(pick(z.x + 9, z.y - 4), 7, 'zoomed out: 9 px beside its feet');
  assert.equal(pick(z.x, z.y - 28), 7, 'zoomed out: just above its head');
  assert.equal(pick(z.x + 30, z.y), 0, 'but not 30 px away');
  // The strict box is the figure itself: the generous one gives way on a
  // building or a roadblock (app.js clickTile), so it must be told apart.
  const strict = (sx, sy) => Renderer.prototype.pickWalker.call(r, sx, sy, false);
  assert.equal(strict(z.x + 9, z.y - 4), 0, 'strict: 9 px beside is not the figure');
  assert.equal(strict(z.x, z.y - 6), 7, 'strict: on the figure');
});

test('a walker says who it is, what it carries and what troubles the city', () => {
  const game = newGame({ seed: 'rb-talk' });
  const { map } = game;
  const { x0, y } = straightRoad(game, 8);
  const i = map.idx(x0, y);
  const cart = spawnWalker(game, 'cart', i, null, { cargo: { good: 'wheat', amount: 400 }, state: 'deliver' });
  const info = walkerInfo(game, cart);
  assert.equal(info.title, WALKER_TYPES.cart.name);
  assert.deepEqual(info.rows.find(([k]) => k === 'Carrying'), ['Carrying', '400 wheat']);
  // The same line on every refresh of the panel.
  assert.equal(walkerSays(game, cart), walkerSays(game, cart));
  // A hungry city: some citizens say so; foreign traders talk about trade.
  const c = game.city;
  c.population = 500;
  c.fedShare = 0.4;
  assert.equal(cityTrouble(game), 'hunger');
  const priests = [];
  for (let k = 0; k < 30; k++) priests.push(spawnWalker(game, 'priest', i, null, { god: 'ceres' }));
  const lines = priests.map((w) => walkerSays(game, w));
  assert.ok(lines.some((l) => /hungry|bread|Food/.test(l)), `someone mentions the food: ${[...new Set(lines)].join(' | ')}`);
  assert.ok(lines.some((l) => /Ceres|temple/.test(l)), 'someone talks about their own work');
  // Raiders on the way come first.
  game.military.warned = { origin: { x: 0, y: 0 }, size: 5, dir: 'north' };
  assert.equal(cityTrouble(game), 'raid');
  game.military.warned = null;
  // Emigrants give the city's worst failing as their reason.
  c.sentimentFactors = { base: 50, taxes: -9, food: -3 };
  const em = spawnWalker(game, 'emigrant', i, null, { people: 4, state: 'leaving' });
  assert.equal(walkerSays(game, em), 'The taxes drove us out.');
  assert.deepEqual(walkerInfo(game, em).rows.find(([k]) => k === 'People'), ['People', '4']);
});

test('a roadblock is drawn across its road either way', () => {
  for (const axis of ['u', 'v']) {
    const spec = roadblockSpec(axis);
    const { ctx } = recordingContext();
    spec.draw(ctx);
    assert.ok(spec.w > 0 && spec.h > spec.ay, `${axis}: sprite size`);
  }
});

test('a roamer at a junction prefers the street with buildings along it over an empty one', () => {
  // A T: a road comes up from the south to a junction; west runs empty, east
  // is lined with homes. A lone Forum's tax collector once spent his rounds
  // on the empty Imperial road while the homes he skipped stopped paying.
  const game = newGame({ size: 96, type: 'plains', seed: 'roam-street' });
  const spot = findFree(game, 21, 8);
  const jx = spot.x + 10;
  const jy = spot.y + 3;
  assert.ok(build(game, 'road', spot.x, jy, spot.x + 20, jy).ok);
  assert.ok(build(game, 'road', jx, jy, jx, jy + 3).ok);
  for (let x = jx + 3; x <= jx + 9; x++) addBuilding(game, 'house', x, jy - 1, 1);
  let east = 0;
  const trials = 400;
  for (let k = 0; k < trials; k++) {
    const w = { x: jx, y: jy, lastDir: 0, memory: [], origin: 0 }; // heading north, at the junction
    const next = pickRoamTile(game, w);
    if (game.map.xOf(next) > jx) east++;
  }
  // Both turns weigh the same without the rule (about half each).
  assert.ok(east / trials > 0.7, `east ${east} of ${trials}`);
});

test('a roamer weighs a way by where it leads: an empty road on to a dead end, a spur to a building, a roadblock', () => {
  const game = newGame({ size: 96, type: 'plains', seed: 'roam-street' });
  const { map } = game;
  const spot = findFree(game, 11, 14);
  const cx = spot.x + 2;
  const cy = spot.y + 8;
  const N = 0; const E = 1; const S = 2;
  assert.ok(build(game, 'road', cx, cy, cx + 8, cy).ok, 'a street in from the east');
  assert.ok(build(game, 'road', cx, cy - 7, cx, cy + 3).ok, 'north (7 tiles, a dead end) and south of the corner');
  addBuilding(game, 'house', cx - 1, cy - 1, 1); // beside the first tile north only
  for (let y = cy + 1; y <= cy + 3; y++) addBuilding(game, 'house', cx - 1, y, 1);
  const w = { type: 'taxman' };
  // North: 3 of its 7 tiles are in reach of that one home, and it ends in
  // nothing (the Imperial road out to the map edge, in small).
  assert.equal(streetValue(map, w, cx, cy - 1, N), 3 / 7);
  assert.equal(streetValue(map, w, cx, cy + 1, S), 1, 'south: homes all along');
  // A spur that runs empty to a building at its end counts in full: a clay
  // pit down a long spur lost half its engineers' visits when it did not.
  addBuilding(game, 'well', cx + 1, cy - 7, 1);
  assert.equal(streetValue(map, w, cx, cy - 1, N), 1, 'the same road, now ending at a building');
  // A roadblock that stops the walker ends the way before it: the homes
  // beyond count for nothing to a tax collector held back there.
  map.roadblock[map.idx(cx + 3, cy)] = 128; // nobody through
  const e = streetValue(map, w, cx + 1, cy, E);
  addBuilding(game, 'house', cx + 6, cy + 1, 1);
  assert.equal(streetValue(map, w, cx + 1, cy, E), e, 'homes beyond the roadblock change nothing');
});

test('a carter is picked by a click on his cart as well as on him', async () => {
  const { cartReach } = await import('../src/render/renderer.js');
  const cam = new Camera();
  cam.setMapBounds(64, 64);
  cam.resize(800, 600, 1);
  cam.centerOnTile(32, 32);
  const w = { id: 5, x: 32, y: 32, tx: 33, ty: 32, progress: 0, moving: false, speed: 0.1, kind: 'carrier' };
  const at = walkerWorld(w, 0);
  const r = { camera: cam, walkerSpots: [{ id: 5, ...at, ship: false, ahead: cartReach(null) }] };
  const pick = (sx, sy, generous) => Renderer.prototype.pickWalker.call(r, sx, sy, generous);
  const screenOf = (dx, up) => { const s = cam.toScreen(at.wx + dx, at.wy - up); return { x: s.x / cam.dpr, y: s.y / cam.dpr }; };
  const cart = screenOf(12, 6); // the middle of a hand cart, ahead of him
  assert.equal(pick(cart.x, cart.y, false), 5, 'a click on the cart picks the carter');
  assert.equal(pick(cart.x, cart.y, true), 5);
  // Behind him there is no cart: no pick there beyond his own figure.
  const behind = screenOf(-12, 6);
  assert.equal(pick(behind.x, behind.y, false), 0);
  // Without a cart (any other walker) the same spot ahead is not his.
  r.walkerSpots[0].ahead = 0;
  assert.equal(pick(cart.x, cart.y, false), 0, 'old behavior: the cart was not clickable');
  assert.ok(cartReach({ kind: 'farm' }) > cartReach(null), 'a wagon and its ox reach farther');
});

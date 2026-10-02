/**
 * view.test.mjs - turning the view (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 *   - map <-> view coordinates at every turn (on a map that is not square),
 *     turn 1 clockwise on the screen, the tile under a screen point and back
 *     at every turn, the camera keeping its middle tile as the view turns,
 *     and the turn kept with the camera state (none in an older save: 0)
 *   - depth: two buildings, a walker and a building, ghost order, each way
 *     round at the turns that put one behind the other
 *   - neighbour masks turned: roads, shores, walls and aqueducts, and the
 *     ground blends, against the same map turned for real
 *   - picking a tile, a walker and a building's tile at every turn, and a
 *     tall building hiding a walker behind it as the view sees it
 *   - sprite keys: a building's art turn is its own plus the view's, the
 *     look suffixes stay last; a unit's and a projectile's screen direction,
 *     the races' direction, the map gate's pillars
 *   - turning changes nothing in the sim
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { toView, fromView, viewTileOf, viewSize, tileAxes, viewFoot, viewDir, rotMask, rotNibbles, rotBlend, viewAxis, mapRectOfView } from '../src/render/view.js';
import { needleAngle } from '../src/ui/hud.js';
import { Camera, worldOf } from '../src/render/camera.js';
import { Renderer, walkerWorld, ghostOrder, blendCode, aqueductMaskAt, buildingKey, artTurn, raceSpot, mapGateOffset, bridgeSpan } from '../src/render/renderer.js';
import { GameMap, Terrain, Road } from '../src/world/map.js';
import { turnDir } from '../src/render/turn.js';
import { newGame, findFree } from './helpers.mjs';
import { planAction, applyPlan } from '../src/sim/construction.js';
import { serializeGame } from '../src/core/save.js';
import { HALF_W, HALF_H } from '../src/config.js';
import { BUILDINGS } from '../src/data/buildings.js';

const TURNS = [0, 1, 2, 3];

/** A camera over a W x H map at view turn t, middle of the map in the middle of an 800 x 600 view. */
function cameraAt(W, H, t, zoomIndex = 2) {
  const cam = new Camera();
  cam.smooth = false;
  cam.setMapBounds(W, H);
  cam.resize(800, 600, 1);
  cam.zoomIndex = zoomIndex;
  cam.setTurn(t);
  cam.centerOnTile(W >> 1, H >> 1);
  return cam;
}

/** A renderer good enough for the view helpers (no canvas): the map and a camera. */
function rendererFor(map, t) {
  const r = Object.create(Renderer.prototype);
  r.camera = cameraAt(map.w, map.h, t);
  r.game = { map, buildings: new Map(), walkers: new Map(), units: new Map() };
  r.stripCache = new WeakMap();
  r.headings = new Map();
  return r;
}

/** The map seen at turn t, built for real: every layer copied to its view tile. */
function turnedMap(map, t) {
  const [W, H] = viewSize(map.w, map.h, t);
  const m = new GameMap(W, H);
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const [vx, vy] = viewTileOf(x, y, t, map.w, map.h);
      const i = map.idx(x, y);
      const j = m.idx(vx, vy);
      for (const layer of ['terrain', 'road', 'aqueduct', 'wall', 'building']) m[layer][j] = map[layer][i];
    }
  }
  return m;
}

/** A small map, not square, with every kind of ground, roads, a wall line and aqueducts. */
function patchwork() {
  const map = new GameMap(19, 16);
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const kinds = [Terrain.GRASS, Terrain.MEADOW, Terrain.TREES, Terrain.SAND, Terrain.WATER, Terrain.ROCK];
  for (let i = 0; i < map.size; i++) map.terrain[i] = kinds[Math.floor(rnd() * kinds.length)];
  for (let i = 0; i < map.size; i++) {
    if (map.terrain[i] === Terrain.WATER || map.terrain[i] === Terrain.ROCK) continue;
    const r = rnd();
    if (r < 0.3) map.road[i] = Road.ROAD;
    else if (r < 0.4) map.aqueduct[i] = 1;
    else if (r < 0.48) map.wall[i] = 1;
  }
  // Reservoirs (building id 90) beside aqueducts: their own bits in an aqueduct's mask.
  for (let i = 0; i < map.size; i += 7) if (!map.aqueduct[i] && !map.road[i] && !map.wall[i]) map.building[i] = 90;
  return map;
}

/** The buildings the patchwork's tiles name: reservoirs. */
const RESERVOIRS = new Map([[90, { def: { kind: 'reservoir' } }]]);

test('view: map and view coordinates at every turn, on a map that is not square', () => {
  const W = 13;
  const H = 9;
  for (const t of TURNS) {
    const [VW, VH] = viewSize(W, H, t);
    assert.deepEqual([VW, VH], t & 1 ? [H, W] : [W, H]);
    const ax = tileAxes(t, W, H);
    const seen = new Set();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const [vx, vy] = viewTileOf(x, y, t, W, H);
        assert.ok(vx >= 0 && vy >= 0 && vx < VW && vy < VH, `turn ${t}: (${x}, ${y}) lies in the view map`);
        seen.add(vy * VW + vx);
        // The tile's center is the view tile's center, and back again.
        const [cx, cy] = toView(x + 0.5, y + 0.5, t, W, H);
        assert.deepEqual([cx, cy], [vx + 0.5, vy + 0.5]);
        assert.deepEqual(fromView(cx, cy, t, W, H), [x + 0.5, y + 0.5]);
        // The loop's affine map finds the map tile of a view tile.
        assert.deepEqual([ax.ox + ax.xx * vx + ax.xy * vy, ax.oy + ax.yx * vx + ax.yy * vy], [x, y]);
        // A footprint's view corner is the view tile of its single tile.
        assert.deepEqual(viewFoot(x, y, 1, 1, t, W, H), [vx, vy]);
      }
    }
    assert.equal(seen.size, W * H, `turn ${t}: one view tile for every map tile`);
    // The whole view is the whole map; a part of it the same part of the map.
    assert.deepEqual(mapRectOfView(0, VW - 1, 0, VH - 1, t, W, H), { tx0: 0, tx1: W - 1, ty0: 0, ty1: H - 1 });
    const part = mapRectOfView(2, 4, 1, 3, t, W, H);
    for (let vy = 1; vy <= 3; vy++) {
      for (let vx = 2; vx <= 4; vx++) {
        const x = ax.ox + ax.xx * vx + ax.xy * vy;
        const y = ax.oy + ax.yx * vx + ax.yy * vy;
        assert.ok(x >= part.tx0 && x <= part.tx1 && y >= part.ty0 && y <= part.ty1);
      }
    }
    assert.equal((part.tx1 - part.tx0 + 1) * (part.ty1 - part.ty0 + 1), 9);
    // Looking past the map's edge (an empty range of view tiles) is no map
    // tile at all, at every turn: swapped round, it reached outside the map
    // and the water hints read tiles of the row before or after (review).
    for (const [a, b, c, d] of [[W + 3, W - 1, 0, H - 1], [0, 4, VH + 2, VH - 1], [-1 + VW + 17, VW - 1, VH + 17, VH - 1]]) {
      const r = mapRectOfView(a, b, c, d, t, W, H);
      assert.ok(r.tx0 > r.tx1 || r.ty0 > r.ty1, `turn ${t}: empty, not ${JSON.stringify(r)}`);
    }
  }
  // Four quarter turns are no turn.
  assert.deepEqual(viewDir(...viewDir(...viewDir(...viewDir(2, 5, 1), 1), 1), 1), [2, 5]);
  // Directions turn as building art does (render/turn.js).
  for (const t of TURNS) for (const d of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1]]) assert.deepEqual(viewDir(d[0], d[1], t), turnDir(d[0], d[1], t));
});

test('view: turn 1 turns the city a quarter turn clockwise on the screen', () => {
  // A step east (+x) goes down and right at turn 0; a quarter turn clockwise takes it down and left.
  const W = 20;
  const screen = (t, dx, dy) => {
    const a = toView(10, 10, t, W, W);
    const b = toView(10 + dx, 10 + dy, t, W, W);
    const pa = worldOf(...a);
    const pb = worldOf(...b);
    return [Math.sign(pb.x - pa.x), Math.sign(pb.y - pa.y)];
  };
  assert.deepEqual(screen(0, 1, 0), [1, 1], 'east: down and right');
  assert.deepEqual(screen(1, 1, 0), [-1, 1], 'turn 1: down and left');
  assert.deepEqual(screen(2, 1, 0), [-1, -1], 'turn 2: up and left');
  assert.deepEqual(screen(3, 1, 0), [1, -1], 'turn 3: up and right');
  // And the needle's north (screen up at turn 0, a step of (-1, -1)) turns right at turn 1.
  assert.deepEqual(screen(0, -1, -1), [0, -1]);
  assert.deepEqual(screen(1, -1, -1), [1, 0]);
  assert.deepEqual(TURNS.map((t) => Math.round(needleAngle(t))), [0, 90, 180, 270]);
  // Turning on from 3 to 0 the needle goes on round, not back three quarters (review).
  assert.equal(Math.round(needleAngle(0, 270)), 360);
  assert.equal(Math.round(needleAngle(3, 360)), 270);
  assert.equal(Math.round(needleAngle(1, 360)), 450);
});

test('view: the tile under a screen point and back, at every turn', () => {
  for (const [W, H] of [[64, 64], [40, 24]]) {
    for (const t of TURNS) {
      const cam = cameraAt(W, H, t);
      for (const [x, y] of [[W >> 1, H >> 1], [(W >> 1) + 3, (H >> 1) - 2], [(W >> 1) - 5, (H >> 1) + 4]]) {
        const w = cam.mapToWorld(x + 0.5, y + 0.5);
        const s = cam.toScreen(w.x, w.y);
        assert.deepEqual(cam.screenToTile(s.x / cam.dpr, s.y / cam.dpr), { x, y }, `${W}x${H} turn ${t}: tile (${x}, ${y})`);
        // A point near a corner of the tile is still the tile.
        const c = cam.mapToWorld(x + 0.1, y + 0.9);
        const sc = cam.toScreen(c.x, c.y);
        assert.deepEqual(cam.screenToTile(sc.x / cam.dpr, sc.y / cam.dpr), { x, y });
        const m = cam.worldToMap(w.x, w.y);
        assert.ok(Math.abs(m.x - x - 0.5) < 1e-9 && Math.abs(m.y - y - 0.5) < 1e-9);
      }
    }
  }
});

test('view: turning keeps the tile in the middle of the screen, and the camera bounds follow', () => {
  const W = 40;
  const H = 24;
  const cam = cameraAt(W, H, 0);
  cam.centerOnTile(30, 5);
  const middle = () => {
    const c = cam.center();
    const m = cam.worldToMap(c.x, c.y);
    return [Math.floor(m.x), Math.floor(m.y)];
  };
  assert.deepEqual(middle(), [30, 5]);
  for (const t of [1, 2, 3, 0, 3]) {
    cam.setTurn(t);
    assert.equal(cam.turn, t);
    assert.deepEqual(middle(), [30, 5], `turn ${t}`);
    const [VW, VH] = viewSize(W, H, t);
    assert.deepEqual(cam.bounds, { left: -VH * HALF_W, right: VW * HALF_W, top: 0, bottom: (VW + VH) * HALF_H });
  }
  // A glide to a tile ends on it at any turn.
  cam.setTurn(1);
  cam.glideToTile(12, 20);
  assert.deepEqual(middle(), [12, 20]);
});

test('view: the turn is kept with the camera state, and a save without one opens at turn 0', () => {
  const cam = cameraAt(64, 64, 2);
  cam.centerOnTile(10, 50);
  const state = cam.serialize();
  assert.equal(state.turn, 2);
  const back = cameraAt(64, 64, 0);
  back.restore(state);
  assert.equal(back.turn, 2);
  const c = back.center();
  const m = back.worldToMap(c.x, c.y);
  assert.deepEqual([Math.floor(m.x), Math.floor(m.y)], [10, 50]);
  const old = cameraAt(64, 64, 3);
  old.restore({ x: state.x, y: state.y, zoomIndex: 2 });
  assert.equal(old.turn, 0, 'an older save has no turn: unturned');
  old.restore({ ...state, turn: 'x' });
  assert.equal(old.turn, 0, 'a broken one too');
});

test('view: a renderer attached to a game opens unturned', () => {
  const game = newGame({ seed: 'view-attach' });
  const r = Object.create(Renderer.prototype);
  r.camera = cameraAt(game.map.w, game.map.h, 3);
  Object.assign(r, { unsub: [], headings: new Map(), ambient: { reset() {} }, appear: new Map(), weather: { reset() {} }, sprites: { invalidateWhere() {} }, palPrev: null, snowPrev: null });
  r.attach(game);
  assert.equal(r.camera.turn, 0);
  assert.equal(r.viewTurn, 0);
});

test('view: depth order turns with the view (buildings, walkers and ghosts)', () => {
  const map = new GameMap(40, 40);
  const a = { x: 10, y: 10, size: 2 };
  // East of a: down the screen (in front) at turns 0 and 1, up it (behind) at 2 and 3.
  const b = { x: 13, y: 10, size: 2 };
  const front = (r, bl) => Math.max(...r.stripsFor(bl));
  for (const t of TURNS) {
    const r = rendererFor(map, t);
    const ahead = front(r, b) > front(r, a);
    assert.equal(ahead, t === 0 || t === 1, `turn ${t}: the eastern building ${t === 0 || t === 1 ? 'in front' : 'behind'}`);
    // Its strips are those of the same footprint seen from that side.
    const [vx, vy] = viewFoot(b.x, b.y, 2, 2, t, 40, 40);
    assert.equal(front(r, b), vx + vy + 3, 'the front strip is the front tile');
  }
  // A walker south of a building (+y) is in front of it at turns 0 and 3 (down the screen), behind at 1 and 2.
  const w = { x: 11, y: 13, tx: 11, ty: 13, progress: 0, moving: false, speed: 0.1 };
  for (const t of TURNS) {
    const r = rendererFor(map, t);
    const d = walkerWorld(w, 0, t, 40, 40).d;
    assert.equal(d > front(r, a), t === 0 || t === 3, `turn ${t}`);
  }
  // Ghosts back to front: a row of homes along x is drawn east to west at turns 2 and 3.
  const items = [0, 1, 2].map((k) => ({ x: 5 + k, y: 5, size: 1, k }));
  assert.deepEqual(ghostOrder(items, 0, 40, 40).map((it) => it.k), [0, 1, 2]);
  assert.deepEqual(ghostOrder(items, 1, 40, 40).map((it) => it.k), [0, 1, 2]);
  assert.deepEqual(ghostOrder(items, 2, 40, 40).map((it) => it.k), [2, 1, 0]);
  assert.deepEqual(ghostOrder(items, 3, 40, 40).map((it) => it.k), [2, 1, 0]);
  assert.deepEqual(ghostOrder(items).map((it) => it.k), [0, 1, 2], 'unturned by default');
  // A walker on a bridge: its deck's depth is the view's.
  map.terrain[map.idx(20, 20)] = Terrain.WATER;
  map.road[map.idx(20, 20)] = Road.BRIDGE;
  for (const t of TURNS) {
    const [vx, vy] = viewTileOf(20, 20, t, 40, 40);
    assert.ok(Math.abs(bridgeSpan(map, 20.5, 20.5, false, t).d - (vx + vy + 1.01)) < 1e-9);
  }
});

test('view: neighbour masks turned are those of the map turned for real (roads, shores, walls, aqueducts, blends)', () => {
  const map = patchwork();
  assert.equal(rotMask(0b0001, 1), 0b0010, 'north becomes east at turn 1');
  assert.equal(rotMask(0b1000, 1), 0b0001, 'west becomes north');
  assert.equal(rotMask(0b0101, 3), 0b1010);
  assert.equal(viewAxis('u', 1), 'v');
  assert.equal(viewAxis('u', 2), 'u');
  for (const t of TURNS) {
    const m = turnedMap(map, t);
    const r0 = rendererFor(map, 0);
    const rt = rendererFor(m, 0);
    r0.game.buildings = new Map();
    let blends = 0;
    let reservoirs = 0;
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const [vx, vy] = viewTileOf(x, y, t, map.w, map.h);
        const at = `turn ${t} (${x}, ${y})`;
        assert.equal(rotMask(r0.roadMask(x, y), t), rt.roadMask(vx, vy), `road ${at}`);
        assert.equal(rotMask(r0.shoreMask(x, y), t), rt.shoreMask(vx, vy), `shore ${at}`);
        assert.equal(rotMask(r0.wallMask(x, y), t), rt.wallMask(vx, vy), `wall ${at}`);
        assert.equal(rotNibbles(aqueductMaskAt(map, RESERVOIRS, x, y), t), aqueductMaskAt(m, RESERVOIRS, vx, vy), `aqueduct ${at}`);
        if (aqueductMaskAt(map, RESERVOIRS, x, y) > 15) reservoirs++;
        const code = blendCode(map, x, y);
        if (code) blends++;
        assert.equal(rotBlend(code, t), blendCode(m, vx, vy), `blend ${at}`);
      }
    }
    assert.ok(blends > 20, 'the patchwork has plenty of edges to blend');
    assert.ok(reservoirs > 2, 'and aqueducts meeting reservoirs');
  }
});

test('view: picking a tile, a walker and a building at every turn; a building in front hides a walker', () => {
  const game = newGame({ seed: 'view-pick' });
  const at = findFree(game, 6, 6);
  const plan = planAction(game, 'prefecture', at.x + 2, at.y + 2, at.x + 2, at.y + 2);
  assert.ok(applyPlan(game, plan).ok, plan.reason);
  const b = game.buildings.get(game.map.buildingAt(at.x + 2, at.y + 2));
  const map = game.map;
  for (const t of TURNS) {
    const cam = cameraAt(map.w, map.h, t);
    cam.centerOnTile(b.x, b.y);
    // The building's tile under the middle of its footprint.
    const c = cam.toScreen(...Object.values(cam.mapToWorld(b.x + b.size / 2, b.y + b.size / 2)));
    const tile = cam.screenToTile(c.x / cam.dpr, c.y / cam.dpr);
    assert.equal(map.buildingAt(tile.x, tile.y), b.id, `turn ${t}: the click is on the building`);
    // A walker beside it is picked at every turn.
    const w = { id: 5, x: b.x - 1, y: b.y, tx: b.x - 1, ty: b.y, progress: 0, moving: false, speed: 0.1, kind: 'roamer' };
    const spot = walkerWorld(w, 0, t, map.w, map.h);
    const r = { camera: cam, walkerSpots: [{ id: 5, ...spot, ship: false }], buildingBoxes: [] };
    const s = cam.toScreen(spot.wx, spot.wy - 10);
    assert.equal(Renderer.prototype.pickWalker.call(r, s.x / cam.dpr, s.y / cam.dpr), 5, `turn ${t}: the walker`);
    // A tall building on the tile in front of the walker as the view sees it hides it.
    const [vx, vy] = viewTileOf(w.x, w.y, t, map.w, map.h);
    r.buildingBoxes = [{ x: vx + 1, y: vy + 1, S: 1, H: 40 }];
    assert.equal(Renderer.prototype.pickWalker.call(r, s.x / cam.dpr, s.y / cam.dpr), 0, `turn ${t}: hidden behind a building`);
    // The renderer's own boxes are in view tiles: the same footprint gives that box.
    const rr = rendererFor(map, t);
    const foot = rr.footAt(w.x, w.y);
    assert.deepEqual([foot.vx, foot.vy], [vx, vy]);
    // And a 3 x 3 footprint's view corner is the view tile nearest the top of the screen.
    const big = rr.footAt(b.x, b.y, 3);
    const tiles = [];
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) tiles.push(viewTileOf(b.x + dx, b.y + dy, t, map.w, map.h));
    assert.deepEqual([big.vx, big.vy], [Math.min(...tiles.map((c) => c[0])), Math.min(...tiles.map((c) => c[1]))]);
  }
});

test('view: sprite keys carry the art turn, the building\'s own plus the view\'s', () => {
  const b = { type: 'school', size: 2, turn: 0, house: null };
  assert.equal(buildingKey(b, 0, 0), 'b:school:2:0:0', 'unturned keys as they always were');
  assert.equal(buildingKey(b, 0, 0, 0), 'b:school:2:0:0');
  assert.equal(buildingKey(b, 0, 0, 1), 'b:school:2:0:0:t1');
  b.turn = 3;
  assert.equal(buildingKey(b, 0, 0, 1), 'b:school:2:0:0', 'turned 3 and seen at 1: the art as drawn');
  assert.equal(buildingKey(b, 0, 0, 2), 'b:school:2:0:0:t1');
  assert.equal(artTurn(b, 3), 2);
  const sick = { type: 'house', size: 1, turn: 1, house: { pop: 5, sick: 3 } };
  assert.equal(buildingKey(sick, 2, 4, 1), 'b:house:1:2:4:t2:sick', 'the turn before :sick, the look suffixes added after');
});

test('view: soldiers, ships and missiles face the way they go as the view sees it', () => {
  const map = new GameMap(30, 30);
  const r = rendererFor(map, 0);
  // Marching east (+x): right on the unturned screen, left at turns 1 and 2, right at 3.
  const u = { id: 1, x: 10.5, y: 10, px: 10, py: 10, facing: 1 };
  assert.equal(r.unitFace(u, 0), 1);
  assert.equal(r.unitFace(u, 1), -1);
  assert.equal(r.unitFace(u, 2), -1);
  assert.equal(r.unitFace(u, 3), 1);
  // Standing still it keeps its last heading.
  const still = { ...u, px: u.x, py: u.y };
  assert.equal(r.unitFace(still, 1), -1);
  // Turned to face a foe without moving (the sim's facing says left): a heading that disagrees gives way.
  still.facing = -1;
  assert.equal(r.unitFace(still, 0), -1);
  assert.equal(r.unitFace(still, 2), 1, 'half a turn: the other way');
  // A unit never seen moving faces as the sim says at turn 0, and the other way at turn 2.
  const fresh = { id: 2, x: 5, y: 5, px: 5, py: 5, facing: -1 };
  assert.equal(r.unitFace(fresh, 0), -1);
  assert.equal(r.unitFace(fresh, 2), 1);
  // Missiles: their velocity turned with the view.
  assert.deepEqual(viewDir(1, 0, 1), [-0, 1]);
  // A soldier who marched south, stopped and fights a foe to his west faces
  // the foe at every turn (review: at a quarter turn the last step and the
  // sim's 1-bit facing agreed, and he was drawn facing away).
  const foe = { id: 8, x: 19, y: 20, px: 19, py: 20, facing: 1 };
  const soldier = { id: 7, x: 20, y: 20, px: 20, py: 19, facing: -1, target: 0 };
  r.game.units = new Map([[7, soldier], [8, foe]]);
  r.unitFace(soldier, 0); // marching south (+y)
  Object.assign(soldier, { px: 20, py: 20, target: 8 });
  for (const t of TURNS) {
    const [a, b] = viewDir(-1, 0, t); // the foe's side, seen at turn t
    const want = a - b > 0 ? 1 : -1;
    assert.equal(r.unitFace(soldier, t), t ? want : soldier.facing, `turn ${t}`);
  }
});

test('view: the races, the map gate\'s pillars and the walker\'s step turn with the view', () => {
  const hip = { def: BUILDINGS.hippodrome, x: 10, y: 10, size: 5, turn: 0 };
  // +U along x: right at turns 0 and 3, left at 1 and 2; the spot itself is on the map, the same at every turn.
  assert.deepEqual(TURNS.map((t) => raceSpot(hip, 4, 2.5, t)[2]), [1, -1, -1, 1]);
  assert.deepEqual(raceSpot(hip, 4, 2.5, 2).slice(0, 2), raceSpot(hip, 4, 2.5, 0).slice(0, 2));
  // A hippodrome laid north-south (turn 1): +U along y, left unturned, and left again at turn 3.
  assert.deepEqual(TURNS.map((t) => raceSpot({ ...hip, turn: 1 }, 4, 2.5, t)[2]), [-1, -1, 1, 1]);
  // The gate's pillars stand across the road at every turn: their offset turned with the view.
  const map = new GameMap(20, 20);
  for (let x = 0; x < 6; x++) map.road[map.idx(x, 10)] = Road.ROAD;
  const end = { x: 0, y: 10 };
  const o0 = mapGateOffset(map, end, [1, 0], 0);
  const o2 = mapGateOffset(map, end, [1, 0], 2);
  assert.ok(Math.abs(o0.ox + o2.ox) < 1e-9 && Math.abs(o0.oy + o2.oy) < 1e-9, 'half a turn: the other way round');
  const o1 = mapGateOffset(map, end, [1, 0], 1);
  // At turn 1 the road runs along the view's y, so the pillars stand across it: along the view's x.
  const [a, b] = viewDir(0, 1, 1);
  assert.ok(Math.abs(o1.ox - (a - b) * HALF_W * 0.46) < 1e-9 && Math.abs(o1.oy - (a + b) * HALF_H * 0.46) < 1e-9);
});

test('view: turning the view changes nothing in the sim', () => {
  const game = newGame({ seed: 'view-sim' });
  const state = () => {
    const s = serializeGame(game);
    delete s.meta.savedAt; // (the clock)
    return JSON.stringify(s);
  };
  const before = state();
  const r = Object.create(Renderer.prototype);
  r.camera = cameraAt(game.map.w, game.map.h, 0);
  r.game = game;
  r.effects = null;
  r.follow = null;
  for (const t of [1, 2, 3, 0]) r.setViewTurn(t);
  assert.equal(state(), before);
});

test('view: the minimap turns with the view (a burning tile shows where the view puts it) and a click on it finds the spot', async () => {
  const { Minimap } = await import('../src/render/minimap.js');
  // A 2D context that keeps only the picture the minimap puts into it.
  const ctx = () => new Proxy({ drawn: null }, {
    get: (o, k) => (k in o ? o[k] : k === 'createImageData' ? (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }) : k === 'putImageData' ? (img) => { o.drawn = img; } : () => {}),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  const had = globalThis.document;
  globalThis.document = { createElement: () => { const c = { width: 0, height: 0, ctx: ctx() }; c.getContext = () => c.ctx; return c; } };
  try {
    const game = newGame({ seed: 'view-minimap' });
    const map = game.map;
    // Two tiles side by side: a minimap pixel row holds two rows of tiles
    // and the one drawn last shows, so of each pair of neighbours only the
    // one at an odd x + y of the view is seen (at every turn one of these).
    game.fires.set(map.idx(20, 9), 1);
    game.fires.set(map.idx(21, 9), 1);
    const canvas = { width: 440, height: 224, getContext: () => ctx() };
    const mm = new Minimap(canvas);
    for (const t of TURNS) {
      const cam = cameraAt(map.w, map.h, t);
      mm.draw(game, cam, 1e6 * (t + 1));
      const img = mm.base.ctx.drawn;
      const [mx, my] = [[20, 9], [21, 9]].find(([x, y]) => viewTileOf(x, y, t, map.w, map.h).reduce((a, b) => a + b) % 2 === 1);
      const [vx, vy] = viewTileOf(mx, my, t, map.w, map.h);
      const px = vx - vy + map.h - 1;
      const py = (vx + vy) >> 1;
      const o = (py * img.width + px) * 4;
      assert.deepEqual([...img.data.slice(o, o + 3)], [255, 80, 20], `turn ${t}: the fire's pixel`);
      // A click on the minimap where that tile shows takes the view to it.
      const { scale, ox, oy } = mm.layout;
      const w = mm.toWorld(ox + (px + 1) * scale, oy + (py + 0.5) * scale);
      const m = cam.worldToMap(w.x, w.y);
      assert.ok(Math.abs(m.x - mx - 0.5) <= 1 && Math.abs(m.y - my - 0.5) <= 1, `turn ${t}: ${JSON.stringify(m)} for (${mx}, ${my})`);
      // North (the map's (0, 0) corner) is up at turn 0 and goes round with the view: right at turn 1.
      if (t === 0) assert.ok(mm.north.y < 20, JSON.stringify(mm.north));
      if (t === 1) assert.ok(mm.north.x > canvas.width - 40, JSON.stringify(mm.north));
    }
  } finally {
    globalThis.document = had;
  }
});

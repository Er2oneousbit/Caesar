/**
 * fortKeys.test.mjs - numbered forts, Shift+1..9, F and draggable rally flags (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Covers the forts' numbers (sim/fortNumbers.js: the lowest free one, taken
 * again after a demolition, saved, and given in id order to the forts of a
 * save from before them), the rule for where a rally point may go
 * (sim/rallyPoints.js), the keys (input/input.js: Shift+digit by its key,
 * never stolen from a text field, F) and a rally flag's click and drag
 * (input.js with a fake canvas, app.js with a fake app around it).
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { Renderer } from '../src/render/renderer.js';
import { Camera } from '../src/render/camera.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { addBuilding, removeBuilding } from '../src/sim/entities.js';
import { freeFortNumber, fortByNumber, numberForts, roman, fortTitle, fortKey } from '../src/sim/fortNumbers.js';
import { rallyTarget, deployTo } from '../src/sim/rallyPoints.js';
import { deployStation, stationRallyAt } from '../src/sim/navy.js';
import { buildDemoCity, buildDemoNavy } from '../src/dev/demoCity.js';
import { newGame, build, findFree } from './helpers.mjs';

// input.js listens on `window`; an EventTarget is all it needs, before it loads.
globalThis.window ??= new EventTarget();
const { Input } = await import('../src/input/input.js');
const { App } = await import('../src/app.js');

log.setLevel('error');

/** Place a fort with the player's construction API, on the first free 3x3 from `from`. */
function placeFort(game, type = 'fort_legion', from = null) {
  const s = findFree(game, 3, 3, from);
  assert.ok(s, 'room for a fort');
  const res = build(game, type, s.x + 1, s.y + 1); // (the cursor is the middle of a 3x3)
  assert.ok(res.ok, res.reason);
  const id = game.map.building[game.map.idx(s.x, s.y)];
  const b = game.buildings.get(id);
  assert.equal(b?.type, type);
  return b;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

test('forts: each takes the lowest free number, and a demolished fort\'s number is taken again', () => {
  const game = newGame({ seed: 'forts' });
  const a = placeFort(game, 'fort_legion');
  const b = placeFort(game, 'fort_archer', { x: 40, y: 40 });
  const c = placeFort(game, 'fort_cavalry', { x: 10, y: 45 });
  assert.deepEqual([a.number, b.number, c.number], [1, 2, 3]);
  assert.equal(fortByNumber(game, 2), b);
  removeBuilding(game, b, 'demolish');
  assert.equal(fortByNumber(game, 2), null);
  assert.equal(freeFortNumber(game), 2);
  const d = placeFort(game, 'fort_legion', { x: 40, y: 40 });
  assert.equal(d.number, 2, 'the gap is filled');
  const e = placeFort(game, 'fort_archer', { x: 50, y: 10 });
  assert.equal(e.number, 4);
  // Other military buildings have no number; nor do a fort's neighbours.
  const tower = addBuilding(game, 'tower', findFree(game, 2, 2).x, findFree(game, 2, 2).y);
  assert.equal(tower.number, undefined);
});

test('forts: numbers in Roman numerals, the fort\'s title and its key', () => {
  assert.deepEqual([1, 2, 3, 4, 9, 10, 14, 40, 0].map(roman), ['I', 'II', 'III', 'IV', 'IX', 'X', 'XIV', 'XL', '']);
  const game = newGame({ seed: 'titles' });
  const forts = [];
  for (let k = 0; k < 10; k++) forts.push(addBuilding(game, k % 2 ? 'fort_archer' : 'fort_legion', 2 + (k % 5) * 4, 2 + Math.floor(k / 5) * 4));
  assert.equal(fortTitle(forts[2]), 'Castra III');
  assert.equal(fortTitle(forts[1]), 'Praesidium II');
  assert.equal(fortKey(forts[8]), 'Shift+9');
  assert.equal(fortKey(forts[9]), '', 'fort X is reached by its panel only');
  const well = addBuilding(game, 'well', 30, 30);
  assert.equal(fortTitle(well), well.def.name);
  assert.equal(fortKey(well), '');
});

test('forts: the number is saved, and costs no randomness', () => {
  const game = newGame({ seed: 'saved' });
  const rng0 = JSON.stringify(game.rng.getState());
  const a = placeFort(game, 'fort_legion');
  const b = placeFort(game, 'fort_archer', { x: 40, y: 40 });
  removeBuilding(game, a, 'demolish');
  assert.equal(JSON.stringify(game.rng.getState()), rng0, 'numbering draws nothing from the seeded RNG');
  const back = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  assert.equal(back.buildings.get(b.id).number, 2, 'fort II stays II although I is gone');
  const c = placeFort(back, 'fort_cavalry', { x: 10, y: 45 });
  assert.equal(c.number, 1, 'and the loaded city fills the gap');
});

test('save: a version 24 save (before numbered forts) numbers its forts in id order', () => {
  const game = newGame({ seed: 'v24' });
  const forts = [placeFort(game, 'fort_legion'), placeFort(game, 'fort_archer', { x: 40, y: 40 }), placeFort(game, 'fort_cavalry', { x: 10, y: 45 })];
  removeBuilding(game, forts[0], 'demolish');
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  data.version = 24;
  for (const b of data.buildings) delete b.number;
  const back = deserializeGame(data);
  assert.deepEqual([forts[1].id, forts[2].id].map((id) => back.buildings.get(id).number), [1, 2], 'by id: the older fort is I');
  back.runDays(2); // (and plays on)
});

test('save: forts with no number or a doubled one (a hand edit) are numbered afresh, the older keeping theirs', () => {
  const game = newGame({ seed: 'dup' });
  const forts = [placeFort(game, 'fort_legion'), placeFort(game, 'fort_archer', { x: 40, y: 40 }), placeFort(game, 'fort_cavalry', { x: 10, y: 45 })];
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  const raw = (id) => data.buildings.find((b) => b.id === id);
  raw(forts[0].id).number = 5;
  raw(forts[1].id).number = 5;
  raw(forts[2].id).number = 'x';
  const back = deserializeGame(data);
  assert.deepEqual(forts.map((f) => back.buildings.get(f.id).number), [5, 1, 2]);
  // numberForts leaves a sound list alone.
  numberForts(back);
  assert.deepEqual(forts.map((f) => back.buildings.get(f.id).number), [5, 1, 2]);
  // A huge number (spelled out in numerals it ran out of memory) is renumbered (review).
  raw(forts[0].id).number = 1e12;
  raw(forts[1].id).number = 1;
  raw(forts[2].id).number = 2;
  const huge = deserializeGame(data);
  assert.equal(huge.buildings.get(forts[0].id).number, 3);
  assert.equal(roman(5000), '5000', 'past the numerals: digits');
  assert.equal(roman(3999), 'MMMCMXCIX');
});

// ---------------------------------------------------------------------------
// Where a rally point may go
// ---------------------------------------------------------------------------

test('rally points: a fort may go to any tile on the map, never off it', () => {
  const game = newGame({ seed: 'rally' });
  const f = placeFort(game);
  assert.deepEqual(rallyTarget(game, f, 3, 4), { x: 3.5, y: 4.5 });
  assert.equal(rallyTarget(game, f, -1, 4), null);
  assert.equal(rallyTarget(game, f, 3, game.map.h), null);
  assert.ok(deployTo(game, f.id, 7, 8));
  assert.deepEqual(f.rally, { x: 7.5, y: 8.5 });
  assert.equal(deployTo(game, f.id, game.map.w + 2, 8), false);
  assert.deepEqual(f.rally, { x: 7.5, y: 8.5 }, 'off the map: the flag stays where it was');
  const well = addBuilding(game, 'well', findFree(game, 1, 1).x, findFree(game, 1, 1).y);
  assert.equal(rallyTarget(game, well, 3, 4), null, 'a well has no rally point');
  assert.equal(deployTo(game, well.id, 3, 4), false);
});

test('rally points: a station\'s flag goes only on its own water, the tile the ships will hold', () => {
  const game = newGame({ type: 'coast', size: 64, seed: 'demo' });
  const res = buildDemoCity(game, { level: 2 });
  assert.ok(res.ok, res.reason);
  const nv = buildDemoNavy(game, res.center, {});
  assert.ok(nv.ok, 'navy placed');
  const st = nv.station;
  const { map } = game;
  let water = null;
  let land = null;
  for (let y = 0; y < map.h && !(water && land); y++) {
    for (let x = 0; x < map.w; x++) {
      if (!water && stationRallyAt(game, st, x, y) && map.navBody[map.idx(x, y)]) water = { x, y };
      if (!land && !stationRallyAt(game, st, x, y)) land = { x, y };
    }
  }
  assert.ok(water && land);
  assert.deepEqual(rallyTarget(game, st, water.x, water.y), { x: water.x + 0.5, y: water.y + 0.5 });
  assert.equal(rallyTarget(game, st, land.x, land.y), null);
  assert.ok(deployTo(game, st.id, water.x, water.y));
  const was = { ...st.rally };
  assert.equal(deployTo(game, st.id, land.x, land.y), false);
  assert.deepEqual(st.rally, was, 'on land: the flag stays where it was');
  // The preview is the deploy: a click a tile off the water lands where rallyTarget said.
  const near = rallyTarget(game, st, water.x + 1, water.y + 1);
  if (near) {
    assert.ok(deployStation(game, st.id, water.x + 1, water.y + 1));
    assert.deepEqual(st.rally, near);
  }
});

test('flags: a standard is picked by its own drawing at every zoom and view turn, the nearest of two', () => {
  for (const dpr of [1, 2]) {
    const cam = new Camera();
    cam.setMapBounds(64, 48);
    cam.resize(900, 700, dpr);
    for (let turn = 0; turn < 4; turn++) {
      cam.setTurn(turn);
      for (let z = 0; z < CONFIG.ZOOM_LEVELS.length; z++) {
        cam.zoomIndex = z;
        cam.centerOnTile(20, 30);
        const spot = (id, x, y) => { const w = cam.mapToWorld(x + 0.5, y + 0.5); return { id, wx: w.x, wy: w.y }; };
        const r = { camera: cam, flagSpots: [spot(3, 20, 30)] };
        const pick = (p) => Renderer.prototype.pickFlag.call(r, p.x, p.y);
        const css = (wx, wy) => { const s = cam.toScreen(wx, wy); return { x: s.x / cam.dpr, y: s.y / cam.dpr }; };
        const s = r.flagSpots[0];
        const at = `dpr ${dpr} turn ${turn} zoom ${CONFIG.ZOOM_LEVELS[z]}`;
        assert.equal(pick(css(s.wx + 5, s.wy - 20)), 3, `${at}: its cloth`);
        assert.equal(pick(css(s.wx, s.wy - 8)), 3, `${at}: its pole`);
        assert.equal(pick(css(s.wx, s.wy - 26)), 3, `${at}: its finial`);
        // The fort's number over the finial (drawStandardNumber: from 29 world
        // px up, at least 9 device px tall) is part of it too (review).
        const numTop = 29 + Math.max(7, (9 * cam.dpr) / cam.scale);
        assert.equal(pick(css(s.wx + 4, s.wy - numTop + 1)), 3, `${at}: its number`);
        const base = css(s.wx, s.wy);
        assert.equal(pick({ x: base.x - 40, y: base.y }), 0, `${at}: not 40 px beside it`);
        assert.equal(pick({ x: base.x, y: base.y + 30 }), 0, `${at}: not 30 px below it`);
        assert.deepEqual(cam.screenToTile(base.x, base.y), { x: 20, y: 30 }, `${at}: its foot is on its tile`);
        // Two standards a tile apart: each is picked on its own cloth.
        r.flagSpots.push(spot(4, 21, 30));
        const t = r.flagSpots[1];
        assert.equal(pick(css(t.wx + 5, t.wy - 20)), 4, `${at}: the second`);
        assert.equal(pick(css(s.wx + 5, s.wy - 20)), 3, `${at}: still the first`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Keys and the flag under the pointer (input.js with a fake canvas and app)
// ---------------------------------------------------------------------------

function fakeApp() {
  const canvas = new EventTarget();
  canvas.style = {};
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1130, height: 820 });
  const calls = [];
  const pans = [];
  const app = {
    game: { map: { revision: 0, inBounds: () => true }, city: { treasury: 0 } },
    settings: { edgeScroll: true },
    deploying: 0,
    renderer: {
      canvas, tool: null, plan: null, hoverTile: null, flagDrag: null,
      flagAt: null, // { x, y, r, id }: a flag drawn there (CSS px)
      pickFlag(x, y) { const f = this.flagAt; return f && Math.hypot(x - f.x, y - f.y) <= f.r ? f.id : 0; },
      pickWalker: () => 0,
      pickUnit: () => 0,
      camera: { panScreen: (dx, dy) => pans.push([dx, dy]), screenToTile: (x, y) => ({ x: Math.floor(x / 10), y: Math.floor(y / 10) }), stopMotion() {}, fling() {} },
    },
    ui: { onToolChanged() {}, onPlanChanged() {} },
    sfx: { _ensure() {} },
    blockingModal: () => false,
    cancelDeploy() {},
    log: console,
    showFort: (n) => calls.push(['showFort', n]),
    deployKey: () => calls.push(['deployKey']),
    setSpeed: (n) => calls.push(['speed', n]),
    clickFlag: (id) => calls.push(['clickFlag', id]),
    dropFlag: (id, x, y) => calls.push(['dropFlag', id, x, y]),
    clickTile: (x, y) => calls.push(['clickTile', x, y]),
  };
  return { app, canvas, calls, pans };
}
const pev = (type, x, y, extra = {}) => Object.assign(new Event(type), { clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse', ...extra });
const kev = (key, code, extra = {}) => ({ key, code, target: {}, preventDefault() {}, ...extra });

test('keys: Shift+1..9 show forts by the key pressed, whatever it types; plain digits stay game speed', () => {
  const { app, calls } = fakeApp();
  const input = new Input(app);
  input.onKeyDown(kev('#', 'Digit3', { shiftKey: true })); // US layout: Shift+3 types "#"
  input.onKeyDown(kev('3', 'Digit3', { shiftKey: true })); // AZERTY: Shift+3 types "3"
  input.onKeyDown(kev('3', 'Digit3'));
  input.onKeyDown(kev('(', 'Digit9', { shiftKey: true }));
  input.onKeyDown(kev(')', 'Digit0', { shiftKey: true })); // no fort 0
  input.onKeyDown(kev('#', 'Digit3', { shiftKey: true, repeat: true })); // held: once
  assert.deepEqual(calls, [['showFort', 3], ['showFort', 3], ['speed', 3], ['showFort', 9]]);
});

test('keys: on a keyboard whose top row types & é " \' (AZERTY), that row still sets the speed, as does the numpad (review)', () => {
  const { app, calls } = fakeApp();
  const input = new Input(app);
  input.onKeyDown(kev('&', 'Digit1'));
  input.onKeyDown(kev('\'', 'Digit4'));
  input.onKeyDown(kev('2', 'Numpad2'));
  input.onKeyDown(kev('5', 'Digit5')); // (no speed 5)
  assert.deepEqual(calls, [['speed', 1], ['speed', 4], ['speed', 2]]);
});

test('keys: digits typed into a text field are the field\'s, not the forts\'', () => {
  const { app, calls } = fakeApp();
  const input = new Input(app);
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
    input.onKeyDown(kev('!', 'Digit1', { shiftKey: true, target: { tagName } }));
    input.onKeyDown(kev('f', 'KeyF', { target: { tagName } }));
  }
  assert.deepEqual(calls, []);
});

test('keys: F deploys the open fort or station (once per press); D still scrolls', () => {
  const { app, calls } = fakeApp();
  const input = new Input(app);
  input.onKeyDown(kev('f', 'KeyF'));
  input.onKeyDown(kev('F', 'KeyF', { shiftKey: true }));
  input.onKeyDown(kev('f', 'KeyF', { repeat: true }));
  assert.deepEqual(calls, [['deployKey'], ['deployKey']]);
  input.onKeyDown(kev('d', 'KeyD'));
  assert.ok(input.keys.has('KeyD'), 'D is the scroll key it always was');
});

test('flags: a click on a rally flag opens its fort, never the tile or walker under it', () => {
  const { app, canvas, calls, pans } = fakeApp();
  const input = new Input(app);
  app.renderer.flagAt = { x: 200, y: 150, r: 12, id: 42 };
  canvas.dispatchEvent(pev('pointerdown', 202, 148));
  window.dispatchEvent(pev('pointermove', 204, 149)); // a wobble within the click slop
  window.dispatchEvent(pev('pointerup', 204, 149));
  assert.deepEqual(calls, [['clickFlag', 42]]);
  assert.equal(pans.length, 0);
  assert.equal(app.renderer.flagDrag, null);
});

test('flags: a drag moves the flag, shows its ghost on the tile under the pointer and never pans the map', () => {
  const { app, canvas, calls, pans } = fakeApp();
  const input = new Input(app);
  app.renderer.flagAt = { x: 200, y: 150, r: 12, id: 42 };
  canvas.dispatchEvent(pev('pointerdown', 200, 150));
  window.dispatchEvent(pev('pointermove', 260, 180));
  assert.deepEqual(app.renderer.flagDrag, { id: 42, x: 26, y: 18 });
  window.dispatchEvent(pev('pointermove', 315, 222));
  assert.deepEqual(app.renderer.flagDrag, { id: 42, x: 31, y: 22 });
  input.update(1 / 60); // (no edge scroll either while a flag is held)
  window.dispatchEvent(pev('pointerup', 315, 222));
  assert.deepEqual(calls, [['dropFlag', 42, 31, 22]]);
  assert.equal(pans.length, 0, 'the map stayed put');
  assert.equal(app.renderer.flagDrag, null);
  // A press beside the flag pans as before.
  canvas.dispatchEvent(pev('pointerdown', 500, 500));
  window.dispatchEvent(pev('pointermove', 560, 520));
  window.dispatchEvent(pev('pointerup', 560, 520));
  assert.ok(pans.length > 0, 'the map pans from open ground');
  assert.equal(calls.length, 1);
});

test('flags: the map moving under a held flag (keys, zoom) moves its ghost; Esc and a second finger put it back', () => {
  const { app, canvas, calls } = fakeApp();
  const input = new Input(app);
  app.renderer.flagAt = { x: 200, y: 150, r: 12, id: 7 };
  canvas.dispatchEvent(pev('pointerdown', 200, 150));
  window.dispatchEvent(pev('pointermove', 260, 180));
  app.renderer.camera.screenToTile = (x, y) => ({ x: Math.floor(x / 10) + 5, y: Math.floor(y / 10) });
  input.update(1 / 60);
  assert.deepEqual(app.renderer.flagDrag, { id: 7, x: 31, y: 18 });
  input.onKeyDown(kev('Escape', 'Escape'));
  assert.equal(app.renderer.flagDrag, null);
  window.dispatchEvent(pev('pointerup', 260, 180));
  assert.deepEqual(calls, [], 'Esc dropped nothing');
  // Touch: a second finger starts a pinch, and the flag stays where it was.
  canvas.dispatchEvent(pev('pointerdown', 200, 150, { pointerType: 'touch' }));
  window.dispatchEvent(pev('pointermove', 240, 170, { pointerType: 'touch' }));
  canvas.dispatchEvent(pev('pointerdown', 400, 400, { pointerId: 2, pointerType: 'touch' }));
  assert.equal(input.flag, null);
  window.dispatchEvent(pev('pointerup', 240, 170, { pointerType: 'touch' }));
  window.dispatchEvent(pev('pointerup', 400, 400, { pointerId: 2, pointerType: 'touch' }));
  assert.deepEqual(calls, []);
});

test('flags: a flag press whose release was lost never turns the next pan into a drop; nor does leaving the window (review)', () => {
  const { app, canvas, calls, pans } = fakeApp();
  const input = new Input(app);
  app.renderer.flagAt = { x: 200, y: 150, r: 12, id: 42 };
  canvas.dispatchEvent(pev('pointerdown', 200, 150));
  window.dispatchEvent(pev('pointermove', 260, 180)); // dragging; then the pointerup is lost (alt-tab)
  input.pointers.clear();
  canvas.dispatchEvent(pev('pointerdown', 500, 500)); // a new press on open ground
  assert.equal(input.flag, null);
  assert.equal(app.renderer.flagDrag, null);
  window.dispatchEvent(pev('pointermove', 560, 520));
  window.dispatchEvent(pev('pointerup', 560, 520));
  assert.deepEqual(calls, [], 'no drop');
  assert.ok(pans.length > 0, 'a plain pan');
  canvas.dispatchEvent(pev('pointerdown', 200, 150));
  window.dispatchEvent(pev('pointermove', 260, 180));
  window.dispatchEvent(new Event('blur'));
  assert.equal(input.flag, null, 'the window lost focus: the flag goes back');
  window.dispatchEvent(pev('pointerup', 260, 180));
  assert.deepEqual(calls, []);
});

test('flags: let go over a panel or the sidebar, the flag stays where it was', () => {
  const { app, canvas, calls } = fakeApp();
  const input = new Input(app);
  app.renderer.flagAt = { x: 200, y: 150, r: 12, id: 42 };
  const panel = {};
  const had = Object.hasOwn(globalThis, 'document');
  const was = globalThis.document;
  globalThis.document = { elementFromPoint: (x) => (x > 1000 ? panel : canvas) };
  try {
    canvas.dispatchEvent(pev('pointerdown', 200, 150));
    window.dispatchEvent(pev('pointermove', 1050, 150));
    assert.deepEqual(app.renderer.flagDrag, { id: 42, x: -1, y: -1 }, 'no ghost on the tile hidden under the panel');
    window.dispatchEvent(pev('pointerup', 1050, 150));
    assert.deepEqual(calls, []);
    // Back over the map, the drop counts.
    canvas.dispatchEvent(pev('pointerdown', 200, 150));
    window.dispatchEvent(pev('pointermove', 1050, 150));
    window.dispatchEvent(pev('pointermove', 400, 300));
    window.dispatchEvent(pev('pointerup', 400, 300));
    assert.deepEqual(calls, [['dropFlag', 42, 40, 30]]);
  } finally {
    if (had) globalThis.document = was;
    else delete globalThis.document;
  }
});

test('flags: with a tool in hand or while picking a deploy point, a press on a flag is for the tile', () => {
  const { app, canvas, calls } = fakeApp();
  const input = new Input(app);
  app.renderer.flagAt = { x: 200, y: 150, r: 12, id: 42 };
  app.deploying = 9;
  canvas.dispatchEvent(pev('pointerdown', 200, 150));
  window.dispatchEvent(pev('pointerup', 200, 150));
  assert.deepEqual(calls, [['clickTile', 20, 15]]);
});

// ---------------------------------------------------------------------------
// The app's side: Shift+N, F, a click and a drop (App methods on a fake app)
// ---------------------------------------------------------------------------

function appFor(game) {
  const a = Object.create(App.prototype);
  const log = { glides: [], shown: [], messages: [], errors: [], sounds: [] };
  a.game = game;
  a.deploying = 0;
  a.fortHop = null;
  a.renderer = { deployFort: 0, camera: { glideToTile: (x, y) => log.glides.push([x, y]) } };
  a.input = { setTool() {} };
  a.sfx = { play: (s) => log.sounds.push(s) };
  const info = { open: false, target: null, showBuilding: (id) => { info.open = true; info.target = { kind: 'building', id }; log.shown.push(id); } };
  a.ui = {
    info, modalKind: null, // 'advisors' or 'empire' (they do not block the keys), or 'outcome'
    hasModal() { return !!this.modalKind; },
    closeModal() { this.modalKind = null; },
    messages: { push: (m) => log.messages.push(m.text) },
    toastError: (t) => log.errors.push(t),
  };
  return { a, log };
}

test('app: over the Advisors or the Empire map, Shift+N and F close it first; a panel hidden behind it is not "open" (review)', () => {
  const game = newGame({ seed: 'modal' });
  const f = placeFort(game);
  const { a, log } = appFor(game);
  game.units.set(999, { id: 999, fort: f.id, side: 'rome', type: 'legionary' });
  a.showFort(1);
  deployTo(game, f.id, 5, 6);
  a.ui.modalKind = 'advisors'; // F2 over the open fort panel
  a.showFort(1);
  assert.equal(a.ui.modalKind, null, 'the advisors closed');
  assert.deepEqual(log.glides.at(-1), [f.x + 1, f.y + 1], 'the fort first, not its standard behind the modal');
  a.showFort(1);
  assert.deepEqual(log.glides.at(-1), [5, 6], 'then its standard');
  a.ui.modalKind = 'empire';
  a.deployKey();
  assert.equal(a.ui.modalKind, null, 'the empire map closed');
  assert.equal(a.deploying, f.id);
  a.cancelDeploy();
  a.ui.modalKind = 'outcome'; // (the win screen stays: its own rules)
  a.deployKey();
  assert.equal(a.ui.modalKind, 'outcome');
});

test('app: Shift+N glides to fort N and opens it; again, to its standard and back; a missing fort is said so', () => {
  const game = newGame({ seed: 'hop' });
  const f1 = placeFort(game);
  const f2 = placeFort(game, 'fort_archer', { x: 40, y: 40 });
  const { a, log } = appFor(game);
  a.showFort(2);
  assert.deepEqual(log.glides, [[f2.x + 1, f2.y + 1]]);
  assert.deepEqual(log.shown, [f2.id]);
  a.showFort(2); // not deployed: the fort again
  assert.deepEqual(log.glides.at(-1), [f2.x + 1, f2.y + 1]);
  deployTo(game, f2.id, 5, 6);
  a.showFort(2);
  assert.deepEqual(log.glides.at(-1), [5, 6], 'to its standard');
  a.showFort(2);
  assert.deepEqual(log.glides.at(-1), [f2.x + 1, f2.y + 1], 'and back to the fort');
  a.showFort(1);
  assert.deepEqual(log.shown.at(-1), f1.id);
  a.ui.info.target = { kind: 'building', id: f2.id }; // fort II opened by a click
  a.showFort(2);
  assert.deepEqual(log.glides.at(-1), [5, 6], 'its panel open: to its standard');
  const glides = log.glides.length;
  a.showFort(7);
  assert.equal(log.glides.length, glides, 'no fort VII: the view stays');
  assert.match(log.messages.at(-1), /No fort holds the number VII \(Shift\+7\)/);
});

test('app: F starts deploy mode for the open fort with men, and F again cancels it', () => {
  const game = newGame({ seed: 'fkey' });
  const f = placeFort(game);
  const { a, log } = appFor(game);
  a.deployKey();
  assert.equal(a.deploying, 0);
  assert.match(log.messages.at(-1), /Open a fort or a naval station first/);
  a.ui.info.showBuilding(f.id);
  a.deployKey();
  assert.equal(a.deploying, 0, 'no soldiers yet');
  assert.match(log.errors.at(-1), /no soldiers/);
  game.units.set(999, { id: 999, fort: f.id, side: 'rome', type: 'legionary' });
  a.deployKey();
  assert.equal(a.deploying, f.id);
  assert.equal(a.renderer.deployFort, f.id);
  a.deployKey();
  assert.equal(a.deploying, 0, 'F again cancels');
});

test('app: a dropped flag redeploys where allowed and stays where it was elsewhere', () => {
  const game = newGame({ seed: 'drop' });
  const f = placeFort(game);
  const { a, log } = appFor(game);
  deployTo(game, f.id, 5, 6);
  assert.equal(a.dropFlag(f.id, 9, 12), true);
  assert.deepEqual(f.rally, { x: 9.5, y: 12.5 });
  assert.deepEqual(log.shown.at(-1), f.id, 'its panel opens, with Recall');
  assert.equal(log.sounds.at(-1), 'horn');
  assert.equal(a.dropFlag(f.id, -3, 12), false);
  assert.deepEqual(f.rally, { x: 9.5, y: 12.5 }, 'off the map: unchanged');
  const sounds = log.sounds.length;
  assert.equal(a.dropFlag(f.id, 9, 12), false, 'dropped where it stood: no new orders');
  assert.equal(log.sounds.length, sounds);
  a.clickFlag(f.id);
  assert.deepEqual(log.shown.at(-1), f.id);
  assert.equal(a.dropFlag(12345, 1, 1), false, 'a fort gone meanwhile: nothing');
});

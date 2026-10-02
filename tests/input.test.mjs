/**
 * input.test.mjs - headless tests for mouse edge scrolling (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * A fresh map must hold still until the player does something. When the main
 * menu (or a modal) disappears from under a still cursor, or a page loads under
 * one, the browser sends pointerenter but no pointermove; the input code used to
 * read its never-set position (-1, -1) as "at the top-left screen edge" and
 * scrolled the view off the map at full speed. These tests drive src/input/
 * input.js with a fake canvas and app (no DOM, no build).
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// input.js listens on `window`; an EventTarget is all it needs. It must exist
// before the module loads, hence the dynamic import.
globalThis.window ??= new EventTarget();
const { Input } = await import('../src/input/input.js');

function fakeApp() {
  const canvas = new EventTarget();
  canvas.style = {};
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1130, height: 820 });
  const pans = [];
  const app = {
    game: null,
    settings: { edgeScroll: true },
    renderer: { canvas, tool: null, plan: null, hoverTile: null, camera: { panScreen: (dx, dy) => pans.push([dx, dy]), screenToTile: () => ({ x: 0, y: 0 }), stopMotion() {} } },
    ui: { onToolChanged() {}, onPlanChanged() {} },
    blockingModal: () => false,
    cancelDeploy() {},
    log: console,
  };
  return { app, canvas, pans };
}
const ev = (type, x, y) => Object.assign(new Event(type), { clientX: x, clientY: y, pointerId: 1, button: 0 });
const fakeGame = () => ({ map: { revision: 0, inBounds: () => true }, city: { treasury: 0 } });

test('input: a cursor uncovered by the menu (pointerenter, no move) does not scroll a fresh map', () => {
  const { app, canvas, pans } = fakeApp();
  const input = new Input(app);
  app.game = fakeGame(); // the game starts; the menu vanishes under the cursor
  canvas.dispatchEvent(ev('pointerenter', 828, 615));
  for (let i = 0; i < 30; i++) input.update(1 / 60);
  assert.equal(pans.length, 0, `panned ${pans.length} frames, mouse ${JSON.stringify({ ...input.mouse, game: !!input.mouse.game })}`);
  assert.deepEqual([input.mouse.x, input.mouse.y], [828, 615], 'the real position is known');
});

test('input: a cursor resting in the edge band scrolls only once it really moves', () => {
  const { app, canvas, pans } = fakeApp();
  const input = new Input(app);
  app.game = fakeGame();
  canvas.dispatchEvent(ev('pointerenter', 3, 400));
  input.update(1 / 60);
  assert.equal(pans.length, 0);
  window.dispatchEvent(ev('pointermove', 4, 400));
  input.update(1 / 60);
  assert.equal(pans.length, 1, 'edge scrolling still works');
  assert.ok(pans[0][0] > 0 && pans[0][1] === 0, 'toward the left edge only');
});

test('input: every new map waits for a real move (restart / load with the cursor at an edge)', () => {
  const { app, canvas, pans } = fakeApp();
  const input = new Input(app);
  app.game = fakeGame();
  canvas.dispatchEvent(ev('pointerenter', 500, 400));
  window.dispatchEvent(ev('pointermove', 1125, 400)); // a real move into the right edge band
  input.update(1 / 60);
  assert.equal(pans.length, 1);
  app.game = fakeGame(); // quick-load, restart or a new map; the cursor has not moved
  pans.length = 0;
  for (let i = 0; i < 10; i++) input.update(1 / 60);
  assert.equal(pans.length, 0);
});

test('input: moves behind the menu keep the position but hold no old game', () => {
  const { app } = fakeApp();
  const input = new Input(app);
  app.game = fakeGame();
  window.dispatchEvent(ev('pointermove', 300, 300));
  assert.equal(input.mouse.game, app.game);
  app.game = null; // back to the main menu
  window.dispatchEvent(ev('pointermove', 310, 320));
  assert.equal(input.mouse.game, null, 'the finished game is not kept alive');
  assert.deepEqual([input.mouse.x, input.mouse.y], [310, 320]);
});

test('input: Q and ] turn the view clockwise, Shift+Q and [ back; the hover follows the map under a still cursor', () => {
  const { app, canvas, pans } = fakeApp();
  const turns = [];
  app.turnView = (dir) => turns.push(dir);
  const input = new Input(app);
  app.game = fakeGame();
  const key = (k) => input.onKeyDown({ key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, target: {}, preventDefault() {} });
  for (const k of ['q', ']', 'Q', '[']) key(k);
  assert.deepEqual(turns, [1, 1, -1, -1]);
  // Held down, a key turns the view once, not at the keyboard's repeat rate (review).
  for (const k of ['q', 'q', ']', 'Q', '[']) input.onKeyDown({ key: k, code: 'KeyQ', repeat: true, target: {}, preventDefault() {} });
  assert.deepEqual(turns, [1, 1, -1, -1]);
  // The view turned under a still cursor: the tile under it is another, and so is a drag's far end.
  let under = { x: 4, y: 5 };
  app.renderer.camera.screenToTile = () => under;
  canvas.dispatchEvent(ev('pointerenter', 500, 400));
  window.dispatchEvent(ev('pointermove', 500, 400));
  assert.deepEqual(app.renderer.hoverTile, { x: 4, y: 5 });
  input.drag = { x0: 1, y0: 1, x1: 4, y1: 5, id: 1 };
  under = { x: 9, y: 2 };
  input.rehover();
  assert.deepEqual(app.renderer.hoverTile, { x: 9, y: 2 });
  assert.deepEqual([input.drag.x1, input.drag.y1], [9, 2]);
  // Scrolling stays the screen's: the left arrow pans right on the screen, whatever the turn.
  input.keys.add('ArrowLeft');
  input.update(1 / 60);
  assert.ok(pans.length === 1 && pans[0][0] > 0 && pans[0][1] === 0);
});

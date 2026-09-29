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

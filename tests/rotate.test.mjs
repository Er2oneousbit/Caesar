/**
 * rotate.test.mjs - turning buildings as they are placed (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 *   - the plan carries the turn and the building is placed with it; what
 *     turns itself (waterside buildings, the triumphal arch) stays at 0
 *   - R turns the building in hand (the ghost turns with it), the turn is
 *     kept for the next of that kind, R with nothing in hand is the Road
 *     tool, and R on a waterside building says why it does not turn
 *   - the sprite key carries the turn
 *   - saves keep it, a version 21 save loads at turn 0, a broken turn is 0
 *   - rubble remembers the turn and Rebuild puts it back so; undo of the
 *     rebuild brings the rubble back with it
 *   - homes painted over an area all take the turn, and so do the lots a
 *     turned home falls back to
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= new EventTarget();
const { Input } = await import('../src/input/input.js');

const { newGame, findFree } = await import('./helpers.mjs');
const { planAction, applyPlan, turnRule, placedTurn, rebuildPlan, undoLast } = await import('../src/sim/construction.js');
const { serializeGame, deserializeGame } = await import('../src/core/save.js');
const { buildingKey } = await import('../src/render/renderer.js');
const { igniteBuilding } = await import('../src/sim/risk.js');
const { ruinAt } = await import('../src/sim/ruins.js');
const { BUILDINGS } = await import('../src/data/buildings.js');
const { growHouse, updateHouse } = await import('../src/sim/housing.js');
const { CONFIG } = await import('../src/config.js');
const { log } = await import('../src/core/debug.js');
log.setLevel('error');

/** Place `type` turned `turn` on free land; the building. */
function placeTurned(game, type, turn) {
  const S = BUILDINGS[type].size;
  const at = findFree(game, S + 2, S + 2);
  const plan = planAction(game, type, at.x + 1, at.y + 1, at.x + 1, at.y + 1, turn);
  assert.equal(plan.turn, turn);
  assert.ok(plan.items.every((it) => it.turn === turn), 'every item of the plan');
  assert.ok(applyPlan(game, plan).ok, plan.reason);
  return game.buildings.get(game.map.buildingAt(plan.items[0].x, plan.items[0].y));
}

test('rotate: a building is placed with the turn of its plan, looks only', () => {
  const game = newGame({ seed: 'rotate-a' });
  for (const t of [0, 1, 2, 3]) {
    const b = placeTurned(game, 'prefecture', t);
    assert.equal(b.turn, t);
  }
  const s = placeTurned(game, 'senate', 3);
  assert.equal(s.turn, 3);
  assert.equal(placedTurn('prefecture', 6), 2, 'turns wrap round');
});

test('rotate: waterside buildings and the triumphal arch turn themselves; R is not for them', () => {
  for (const k of ['dock', 'shipyard', 'wharf', 'navalia', 'naval_station', 'portus']) {
    assert.match(turnRule(k), /faces its water/, k);
    assert.equal(placedTurn(k, 1), 0);
  }
  assert.match(turnRule('triumphal_arch'), /follows its road/);
  assert.equal(placedTurn('triumphal_arch', 3), 0);
  for (const k of ['house', 'garden', 'statue_small', 'prefecture', 'hippodrome', 'granary']) assert.equal(turnRule(k), null, k);
  assert.ok(turnRule('road'), 'tools do not turn');
});

/** An Input driven by key presses on a real game (the canvas and UI faked). */
function inputOn(game) {
  const canvas = new EventTarget();
  canvas.style = {};
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 700 });
  const toasts = [];
  const selected = [];
  const app = {
    game,
    settings: { edgeScroll: false },
    renderer: { canvas, tool: null, plan: null, hoverTile: null, camera: { panScreen() {}, screenToTile: () => ({ x: 0, y: 0 }), stopMotion() {} } },
    ui: { onToolChanged() {}, onPlanChanged() {}, onTurnChanged() {}, toastError: (t) => toasts.push(t), selectTool: (k) => { selected.push(k); input.setTool(k); } },
    blockingModal: () => false,
    cancelDeploy() {},
    log: console,
  };
  const input = new Input(app);
  input.mouse.over = true;
  const key = (k) => input.onKeyDown({ key: k, code: `Key${k.toUpperCase()}`, target: {}, preventDefault() {} });
  return { input, app, key, toasts, selected };
}

test('rotate: R turns the ghost a quarter turn clockwise, kept for the next of that kind', () => {
  const game = newGame({ seed: 'rotate-r' });
  const { input, app, key, selected } = inputOn(game);
  const at = findFree(game, 4, 4);
  input.setTool('prefecture');
  input.hover = { x: at.x + 1, y: at.y + 1 };
  input.refreshPlan();
  assert.equal(app.renderer.plan.turn, 0);
  key('r');
  assert.equal(app.renderer.plan.turn, 1, 'the ghost turned');
  assert.equal(app.renderer.plan.items[0].turn, 1);
  key('r'); key('r'); key('r'); key('r');
  assert.equal(app.renderer.plan.turn, 1, 'four more turns: round again');
  // Another kind, then back: the prefecture keeps its turn.
  input.setTool('engineer_post');
  assert.equal(input.turnFor('engineer_post'), 0);
  input.setTool('prefecture');
  input.refreshPlan();
  assert.equal(app.renderer.plan.turn, 1, 'kept for the next prefecture');
  assert.ok(applyPlan(game, app.renderer.plan).ok);
  assert.equal(game.buildings.get(game.map.buildingAt(at.x + 1, at.y + 1)).turn, 1);
  // Nothing in hand: R is the Road tool, as it was.
  input.setTool(null);
  key('r');
  assert.deepEqual(selected, ['road']);
  assert.equal(input.tool, 'road');
  // A road in hand: R does nothing more (no turn for roads).
  key('r');
  assert.equal(input.turns.road, undefined);
});

test('rotate: after R the build panel shows the new plan (it was emptied when the panel was redrawn after it)', () => {
  const game = newGame({ seed: 'rotate-p' });
  const { input, app, key } = inputOn(game);
  const seen = [];
  app.ui.onTurnChanged = () => seen.push('panel');
  app.ui.onPlanChanged = (p) => seen.push(p ? `plan ${p.turn}` : 'no plan');
  const at = findFree(game, 4, 4);
  input.setTool('school');
  input.hover = { x: at.x + 1, y: at.y + 1 };
  input.refreshPlan();
  seen.length = 0;
  key('r'); // without moving the mouse
  assert.deepEqual(seen, ['panel', 'plan 1'], 'the panel first, then the turned plan in it');
});

test('rotate: R on a waterside building does not turn it, and says why', () => {
  const game = newGame({ seed: 'rotate-w' });
  const { input, key, toasts } = inputOn(game);
  input.setTool('dock');
  key('R');
  assert.equal(input.turnFor('dock'), 0);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /faces its water/);
  input.setTool('triumphal_arch');
  assert.equal(input.turnTool(), false);
  assert.match(toasts[1], /follows its road/);
});

test('rotate: the sprite key carries the turn (and turn 0 keys are as before)', () => {
  const game = newGame({ seed: 'rotate-k' });
  const b = placeTurned(game, 'school', 0);
  assert.equal(buildingKey(b, 0, 0), 'b:school:2:0:0');
  b.turn = 3;
  assert.equal(buildingKey(b, 0, 0), 'b:school:2:0:0:t3');
  assert.ok(!buildingKey(b, 0, 0).includes('~'), 'the look and snow suffixes stay last (added after)');
});

test('rotate: saves keep the turn; a version 21 save loads at turn 0; a broken turn is 0', () => {
  const game = newGame({ seed: 'rotate-s' });
  const a = placeTurned(game, 'library', 2);
  const c = placeTurned(game, 'garden', 1);
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  assert.equal(data.version, CONFIG.SAVE_VERSION);
  assert.ok(CONFIG.SAVE_VERSION >= 22, 'turns came with version 22');
  const back = deserializeGame(JSON.parse(JSON.stringify(data)));
  assert.equal(back.buildings.get(a.id).turn, 2);
  assert.equal(back.buildings.get(c.id).turn, 1);
  // Version 21: no turns at all (what that game wrote).
  const old = JSON.parse(JSON.stringify(data));
  old.version = 21;
  for (const b of old.buildings) delete b.turn;
  const loaded = deserializeGame(old);
  for (const b of loaded.buildings.values()) assert.equal(b.turn, 0, `${b.type}`);
  const bad = JSON.parse(JSON.stringify(data));
  bad.buildings.find((b) => b.id === a.id).turn = 'sideways';
  assert.equal(deserializeGame(bad).buildings.get(a.id).turn, 0);
});

test('rotate: rubble remembers the turn; Rebuild puts it back turned, undo brings the rubble back', () => {
  const game = newGame({ seed: 'rotate-ruin' });
  const b = placeTurned(game, 'market', 3);
  const { x, y } = b;
  igniteBuilding(game, b);
  game.fires.clear();
  const i = game.map.idx(x, y);
  assert.equal(ruinAt(game, i).site.turn, 3);
  // ...also after a save.
  const again = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  assert.equal(ruinAt(again, i).site.turn, 3);
  const plan = rebuildPlan(game, i);
  assert.equal(plan.turn, 3);
  assert.ok(applyPlan(game, plan).ok);
  assert.equal(game.buildings.get(game.map.buildingAt(x, y)).turn, 3, 'rebuilt the way it stood');
  undoLast(game);
  assert.equal(game.map.buildingAt(x, y), 0);
  assert.equal(ruinAt(game, i).site.turn, 3, 'the undone rebuild leaves the rubble as it was');
  assert.equal(rebuildPlan(game, i).turn, 3);
});

test('rotate: homes painted turned are each turned, and the lots a turned home falls back to keep its turn', () => {
  const game = newGame({ seed: 'rotate-h' });
  const at = findFree(game, 3, 3);
  const plan = planAction(game, 'house', at.x, at.y, at.x + 1, at.y + 1, 2);
  assert.ok(applyPlan(game, plan).ok);
  const homes = new Set();
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) homes.add(game.buildings.get(game.map.buildingAt(at.x + dx, at.y + dy)));
  assert.equal(homes.size, 4);
  for (const h of homes) assert.equal(h.turn, 2);
  // One grows over the other three, then empties: the lots it falls back to keep its turn.
  const b = game.buildings.get(game.map.buildingAt(at.x, at.y));
  assert.ok(growHouse(game, b, 2), 'grown to 2x2');
  b.house.tier = 13;
  b.house.pop = 0;
  b.house.incoming = 0;
  updateHouse(game, b);
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const lot = game.buildings.get(game.map.buildingAt(at.x + dx, at.y + dy));
      assert.equal(lot.size, 1);
      assert.equal(lot.turn, 2, `the lot at +${dx},+${dy}`);
    }
  }
});

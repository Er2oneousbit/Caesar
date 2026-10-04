/**
 * roads.test.mjs - making "no road" obvious (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Covers sim/roadAccess.js and the placement plan it feeds: which buildings
 * lack a road (the red sign over them), the edge tiles where a road would
 * serve a building being placed (a corner does not count), the plan's no-road
 * flag and warning (the orange ghost and the warning by the cursor), and the
 * one-time message after 8 days without a road.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { Terrain } from '../src/world/map.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { planAction, planNoRoadWarning, checkBuilding, NO_ROAD_WARNING, HOUSE_NO_ROAD_WARNING } from '../src/sim/construction.js';
import { lacksRoad, accessEdgeTiles, noRoadText } from '../src/sim/roadAccess.js';
import { newGame, build, findFree } from './helpers.mjs';

log.setLevel('error');

/** Free land of w x h tiles with a margin of 3 all round (room for roads). */
function room(game, w, h) {
  const s = findFree(game, w + 6, h + 6);
  return { x: s.x + 3, y: s.y + 3 };
}

const messagesAbout = (game, b) => game.messages.filter((m) => m.text === noRoadText(b));

test('roads: the edge tiles a road would serve are the ring around the footprint, corners left out', () => {
  const game = newGame();
  const { map } = game;
  const s = room(game, 2, 2);
  const edges = accessEdgeTiles(game, s.x, s.y, 2);
  assert.equal(edges.length, 8, 'two tiles on each of four sides');
  const key = (x, y) => `${x},${y}`;
  const got = new Set(edges.map((e) => key(e.x, e.y)));
  for (const [x, y] of [[s.x, s.y - 1], [s.x + 1, s.y - 1], [s.x + 2, s.y], [s.x + 2, s.y + 1], [s.x, s.y + 2], [s.x + 1, s.y + 2], [s.x - 1, s.y], [s.x - 1, s.y + 1]]) {
    assert.ok(got.has(key(x, y)), `edge tile ${x},${y}`);
  }
  for (const [x, y] of [[s.x - 1, s.y - 1], [s.x + 2, s.y - 1], [s.x - 1, s.y + 2], [s.x + 2, s.y + 2]]) {
    assert.ok(!got.has(key(x, y)), `corner ${x},${y} does not count`);
  }
  assert.ok(edges.every((e) => e.open && e.i === map.idx(e.x, e.y)), 'all open on free land');
  // Water, rock or a building on an edge tile: no road can go there.
  map.terrain[map.idx(s.x - 1, s.y)] = Terrain.WATER;
  map.terrain[map.idx(s.x + 2, s.y)] = Terrain.ROCK;
  assert.ok(build(game, 'well', s.x, s.y + 2).ok);
  const shut = accessEdgeTiles(game, s.x, s.y, 2).filter((e) => !e.open).map((e) => key(e.x, e.y)).sort();
  assert.deepEqual(shut, [key(s.x - 1, s.y), key(s.x + 2, s.y), key(s.x, s.y + 2)].sort());
  // At the map's edge only the tiles on the map are listed.
  assert.equal(accessEdgeTiles(game, 0, 0, 1).length, 2);
});

test('roads: placing with no road touching flags the plan; a corner road is not enough, an edge road is', () => {
  const game = newGame();
  const s = room(game, 1, 1);
  let plan = planAction(game, 'prefecture', s.x, s.y, s.x, s.y);
  assert.equal(plan.items[0].ok, true, 'still allowed: it is a warning');
  assert.equal(plan.items[0].noRoad, true);
  assert.ok(plan.warnings.includes(NO_ROAD_WARNING));
  assert.equal(planNoRoadWarning(plan), NO_ROAD_WARNING);
  // A road at the corner only.
  assert.ok(build(game, 'road', s.x - 1, s.y - 1).ok);
  plan = planAction(game, 'prefecture', s.x, s.y, s.x, s.y);
  assert.equal(plan.items[0].noRoad, true, 'a corner does not count');
  // A road along one edge: any side will do.
  for (const [rx, ry] of [[s.x + 1, s.y], [s.x, s.y + 1]]) {
    const g2 = newGame();
    assert.ok(build(g2, 'road', rx, ry).ok);
    const p2 = planAction(g2, 'prefecture', s.x, s.y, s.x, s.y);
    assert.equal(p2.items[0].noRoad, false, `road at ${rx - s.x},${ry - s.y}`);
    assert.equal(planNoRoadWarning(p2), null);
    assert.ok(!p2.warnings.includes(NO_ROAD_WARNING));
  }
  // Wells need no road, and the Oracle, with no workers, works without one: never flagged.
  assert.equal(planAction(game, 'well', s.x + 3, s.y + 3, s.x + 3, s.y + 3).items[0].noRoad, false);
  const far = room(game, 2, 2);
  const oraclePlan = planAction(game, 'oracle', far.x, far.y, far.x, far.y);
  assert.equal(oraclePlan.items[0].ok && oraclePlan.items[0].noRoad, false);
  assert.ok(build(game, 'oracle', oraclePlan.items[0].x, oraclePlan.items[0].y).ok);
  const oracle = [...game.buildings.values()].find((b) => b.type === 'oracle');
  assert.equal(oracle.accessRoad, -1);
  assert.equal(lacksRoad(oracle), false, 'no red sign over an Oracle');
});

test('roads: homes take a road within 2 tiles; further out the plot is flagged', () => {
  const game = newGame();
  const s = room(game, 6, 1);
  assert.ok(build(game, 'road', s.x, s.y).ok);
  const plan = planAction(game, 'house', s.x + 1, s.y, s.x + 5, s.y);
  const flags = plan.items.map((it) => it.noRoad);
  assert.deepEqual(flags, [false, false, true, true, true], 'plots 1 and 2 tiles away are fine, 3 and more are not');
  assert.equal(planNoRoadWarning(plan), HOUSE_NO_ROAD_WARNING);
  assert.equal(planNoRoadWarning(planAction(game, 'house', s.x + 1, s.y + 2, s.x + 1, s.y + 2)), null, 'a diagonal road within 2 tiles counts for a home');
});

test('roads: a building with workers and no road says so once, after 8 days', () => {
  const game = newGame();
  const s = room(game, 1, 1);
  assert.ok(build(game, 'prefecture', s.x, s.y).ok);
  const pre = [...game.buildings.values()].find((b) => b.type === 'prefecture');
  assert.equal(lacksRoad(pre), true, 'the red sign shows over it');
  game.runDays(CONFIG.NO_ROAD_NOTICE_DAYS - 1);
  assert.equal(messagesAbout(game, pre).length, 0, 'not yet');
  game.runDays(1);
  const msgs = messagesAbout(game, pre);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].text, `The Excubitorium at ${pre.x},${pre.y} has no road touching it: it gets no workers and does nothing.`);
  assert.equal(msgs[0].level, 'warn');
  assert.deepEqual([msgs[0].x, msgs[0].y], [pre.x, pre.y], 'click it to go there');
  // Never again, even after a road comes and goes.
  game.runDays(40);
  assert.ok(build(game, 'road', s.x + 1, s.y).ok);
  game.runDays(2);
  assert.equal(lacksRoad(pre), false, 'the sign goes as soon as a road touches it');
  game.city.treasury += 100;
  assert.ok(build(game, 'clear', s.x + 1, s.y).ok);
  game.runDays(20);
  assert.equal(messagesAbout(game, pre).length, 1, 'one message per building');
  // It survives a save: no second message after loading.
  const copy = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  copy.runDays(20);
  assert.equal(messagesAbout(copy, copy.buildings.get(pre.id)).length, 1);
});

test('roads: no message when a road touches it, or arrives in time; none for buildings that need no road', () => {
  const game = newGame();
  const s = room(game, 8, 1);
  assert.ok(build(game, 'road', s.x, s.y + 1, s.x + 1, s.y + 1).ok);
  assert.ok(build(game, 'prefecture', s.x, s.y).ok, 'road along its south edge');
  assert.ok(build(game, 'engineer_post', s.x + 4, s.y).ok, 'no road yet');
  assert.ok(build(game, 'well', s.x + 7, s.y).ok, 'needs no road');
  const byType = (t) => [...game.buildings.values()].find((b) => b.type === t);
  game.runDays(CONFIG.NO_ROAD_NOTICE_DAYS - 3);
  assert.ok(build(game, 'road', s.x + 4, s.y + 1).ok, 'the road arrives in time');
  game.runDays(CONFIG.NO_ROAD_NOTICE_DAYS * 3);
  for (const t of ['prefecture', 'engineer_post', 'well']) {
    assert.equal(messagesAbout(game, byType(t)).length, 0, t);
    assert.equal(lacksRoad(byType(t)), false, t);
  }
  assert.equal(byType('engineer_post').noRoadDays, 0, 'the count starts again once a road touches it');
});

test('roads: the door is only drawn; a road along any of the four sides serves a building', () => {
  // The owner asked whether a building's door must face the road. It need
  // not: every side counts the same (sim/entities.js computeAccessRoad).
  for (const [type, S] of [['prefecture', 1], ['market', 2]]) {
    for (const side of ['north', 'east', 'south', 'west']) {
      const game = newGame();
      const s = room(game, S + 4, S + 4);
      const x = s.x + 2;
      const y = s.y + 2;
      assert.ok(build(game, type, x + (S - 1 >> 1), y + (S - 1 >> 1)).ok, `${type} placed`);
      const b = [...game.buildings.values()].find((q) => q.type === type);
      assert.equal(b.accessRoad, -1, 'no road yet');
      const [rx, ry] = { north: [x, y - 1], east: [x + S, y], south: [x, y + S], west: [x - 1, y] }[side];
      assert.ok(build(game, 'road', rx, ry).ok);
      game.processRoadChanges();
      assert.equal(b.accessRoad, game.map.idx(rx, ry), `${type}: a road on its ${side} side serves it`);
      assert.equal(lacksRoad(b), false);
    }
  }
});

test('a road crosses an aqueduct only straight through, at right angles; never along it, nor turning under it', () => {
  // Playtest: roads could run along under an aqueduct.
  const game = newGame({ size: 64, type: 'plains', seed: 'aq-cross' });
  const s = findFree(game, 12, 12);
  const ax = s.x + 1;
  const ay = s.y + 6;
  const ok = (tool, x0, y0, x1, y1) => planAction(game, tool, x0, y0, x1, y1);
  assert.ok(build(game, 'aqueduct', ax, ay, ax + 9, ay).ok, 'an aqueduct east-west');
  // A road straight across it, north-south: fine.
  const across = ok('road', ax + 3, ay - 3, ax + 3, ay + 3);
  assert.ok(across.items.every((it) => it.ok), JSON.stringify(across.items.filter((it) => !it.ok)));
  assert.ok(build(game, 'road', ax + 3, ay - 3, ax + 3, ay + 3).ok);
  // Along it, east-west under the arches: refused.
  const along = ok('road', ax + 5, ay, ax + 8, ay);
  assert.ok(along.items.some((it) => !it.ok && /right angles/.test(it.reason || '')), JSON.stringify(along.items));
  // A crossing beside the first one would join it along the aqueduct: refused.
  const beside = ok('road', ax + 4, ay - 3, ax + 4, ay + 3);
  assert.ok(beside.items.some((it) => !it.ok), 'two roads side by side under the arches make a road along it');
  // A road that turns under the aqueduct: refused.
  const turn = ok('road', ax + 7, ay - 3, ax + 7, ay);
  assert.ok(turn.items.every((it) => it.ok), 'a road ending under the arch, straight in, is fine');
  assert.ok(build(game, 'road', ax + 7, ay - 3, ax + 7, ay).ok);
  const branch = ok('road', ax + 8, ay + 3, ax + 8, ay + 1);
  assert.ok(branch.items.every((it) => it.ok), 'a road beside the aqueduct, not under it, is fine');
  // An aqueduct laid along an existing road: refused; across it: fine.
  assert.ok(build(game, 'road', s.x, s.y + 10, s.x + 9, s.y + 10).ok, 'a road east-west');
  const aqAlong = ok('aqueduct', s.x + 2, s.y + 10, s.x + 6, s.y + 10);
  assert.ok(aqAlong.items.some((it) => !it.ok), 'an aqueduct along a road');
  const aqAcross = ok('aqueduct', s.x + 2, s.y + 8, s.x + 2, s.y + 11);
  assert.ok(aqAcross.items.every((it) => it.ok), JSON.stringify(aqAcross.items.filter((it) => !it.ok)));
  // An aqueduct that comes down onto the road and turns along it: refused.
  assert.ok(build(game, 'aqueduct', s.x + 7, s.y + 8, s.x + 7, s.y + 10).ok, 'an aqueduct ending on the road, straight in');
  const aqTurn = ok('aqueduct', s.x + 8, s.y + 10, s.x + 8, s.y + 10);
  assert.ok(aqTurn.items.some((it) => !it.ok), 'turning along the road from the crossing');
});

test('no road under the aqueduct tile that steps down into a reservoir, nor a reservoir beside such a road', () => {
  // Playtest: a road could be laid on the tile where an aqueduct meets its reservoir.
  const game = newGame({ size: 64, type: 'plains', seed: 'aq-res' });
  const s = findFree(game, 12, 12);
  // (build() takes a 3x3's middle tile: the footprint is s.x..s.x+2, s.y+4..s.y+6.)
  assert.ok(build(game, 'reservoir', s.x + 1, s.y + 5).ok, 'a reservoir');
  // An aqueduct running east from its side, along y = s.y + 5.
  assert.ok(build(game, 'aqueduct', s.x + 3, s.y + 5, s.x + 9, s.y + 5).ok);
  const plan = (x0, y0, x1, y1) => planAction(game, 'road', x0, y0, x1, y1);
  // Across the aqueduct's first tile, right beside the reservoir: refused.
  const atRim = plan(s.x + 3, s.y + 2, s.x + 3, s.y + 8);
  assert.ok(atRim.items.some((it) => !it.ok && /steps down into the reservoir/.test(it.reason || '')), JSON.stringify(atRim.items.filter((it) => !it.ok)));
  // A tile further along: a plain crossing, fine (a road ending under the arch, straight in).
  const further = plan(s.x + 6, s.y + 8, s.x + 6, s.y + 5);
  assert.ok(further.items.every((it) => it.ok), JSON.stringify(further.items.filter((it) => !it.ok)));
  assert.ok(build(game, 'road', s.x + 6, s.y + 8, s.x + 6, s.y + 5).ok);
  // A reservoir placed right above that crossing (top-left s.x+5, s.y+2): refused.
  const res2 = checkBuilding(game, 'reservoir', s.x + 5, s.y + 2);
  assert.ok(!res2.ok && /step down into the reservoir/.test(res2.reason || ''), JSON.stringify(res2));
});

/**
 * turn.test.mjs - turned art (render/turn.js), headless (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 *   - the turn itself: four quarter turns come back round, turn 1 takes the
 *     art's +u edge to +v (clockwise on the screen and the map)
 *   - every building and home level (and 2x2 blocks) draws at every turn,
 *     with the same units as at turn 0 and inside its sprite's box
 *   - painter's order: a box behind another after the turn is painted first,
 *     a chimney through its roof stays on it, a door turned away is drawn
 *     under its walls and never lit, windows show on the faces seen
 *   - flags turn with their buildings; buildings the same from every side
 *     draw the same whatever the turn
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildingSpec, flagsFor, drawWarehouseStock, drawGranaryStock } from '../src/render/buildingArt.js';
import { lightsOf } from '../src/render/lighting.js';
import { recordingContext, box, door, P } from '../src/render/draw.js';
import { turnUV, turnDir, drawTurned, turnCheck, sortUnits } from '../src/render/turn.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { HOUSE_TIERS } from '../src/data/housing.js';
import { HALF_W, HALF_H } from '../src/config.js';
import { OVER_WATER_ART } from '../src/sim/entities.js';

/** Every building drawing worth checking: [key, size, variant, state]. */
function allArt() {
  const out = [];
  for (const [k, d] of Object.entries(BUILDINGS)) {
    if (!d.size) continue;
    if (k === 'house') {
      for (let t = 0; t < HOUSE_TIERS.length; t++) {
        const S = HOUSE_TIERS[t].size;
        for (const v of [0, 5]) {
          out.push([k, S, v, t]);
          if (S === 1) out.push([k, 2, v, t]); // a block of four
        }
      }
      continue;
    }
    const states = k === 'hippodrome_part' ? [1, 2] : d.kind === 'farm' ? [0, 4, 7] : [0, 1];
    // Waterside buildings out over the water: facing each side, with the
    // hull on the slip or the catch on the deck (sim/entities.js OVER_WATER_ART).
    if (d.placement === 'shore' || d.placement === 'fishingShore') {
      for (let side = 0; side < 4; side++) for (const extra of [0, 4, 8]) states.push(OVER_WATER_ART + side + extra);
    }
    for (const st of states) out.push([k, d.size, 0, st]);
  }
  return out;
}

/** Draw a building at a turn through the recorder; its stats. */
function stats(key, S, variant, state, turn) {
  const { ctx } = recordingContext();
  turnCheck.record = true;
  turnCheck.last = null;
  try {
    buildingSpec(key, S, variant, state, false, 0, false, turn).draw(ctx);
  } finally {
    turnCheck.record = false;
  }
  return turnCheck.last;
}

test('turn: four quarter turns come back round; turn 1 takes +u to +v (clockwise)', () => {
  for (const [u, v] of [[0.2, 0.7], [1.5, 0.25], [0, 3]]) {
    let p = [u, v];
    for (let t = 0; t < 4; t++) p = turnUV(p[0], p[1], 3, 1);
    assert.deepEqual(p.map((x) => Math.round(x * 1e9) / 1e9), [u, v]);
    for (let t = 0; t < 4; t++) {
      const q = turnUV(u, v, 3, t);
      assert.ok(q[0] >= 0 && q[0] <= 3 && q[1] >= 0 && q[1] <= 3, 'stays in the footprint');
    }
  }
  const dir = (...a) => turnDir(...a).map((x) => x + 0); // (no -0)
  assert.deepEqual(dir(1, 0, 1), [0, 1], '+u to +v');
  assert.deepEqual(dir(0, 1, 1), [-1, 0], '+v to -u');
  assert.deepEqual(dir(1, 0, 2), [-1, 0]);
  assert.deepEqual(dir(1, 0, 3), [0, -1]);
  // On the screen +u points right and down, +v left and down: a quarter turn clockwise.
  const at = (u, v) => [(u - v) * HALF_W, (u + v) * HALF_H];
  const [x0, y0] = at(...turnUV(2, 1, 2, 0));
  const [x1, y1] = at(...turnUV(2, 1, 2, 1));
  const c = at(1, 1);
  const cross = (x0 - c[0]) * (y1 - c[1]) - (y0 - c[1]) * (x1 - c[0]);
  assert.ok(cross > 0, 'clockwise on the screen');
});

test('turn: every building and home draws at every turn, the same units, inside its sprite', () => {
  let n = 0;
  for (const [key, S, variant, state] of allArt()) {
    const spec = buildingSpec(key, S, variant, state);
    const base = stats(key, S, variant, state, 0);
    // How far the art as written already reaches past its box (an arena's rim does by a few px).
    const [bx0, by0, bx1, by1] = base.bbox;
    const room = [Math.max(1, -spec.ax - bx0), Math.max(1, -spec.ay - by0), Math.max(1, bx1 - (spec.w - spec.ax)), Math.max(1, by1 - (spec.h - spec.ay))];
    assert.ok(base && base.paints > 0, `${key} ${state}: draws`);
    for (let t = 0; t < 4; t++) {
      const s = stats(key, S, variant, state, t);
      const what = `${key} size ${S} look ${variant} state ${state} turn ${t}`;
      assert.equal(s.units, base.units, `${what}: the same units as turn 0`);
      assert.ok(s.paints > 0, `${what}: paints`);
      const [x0, y0, x1, y1] = s.bbox;
      // (Within a pixel, or as far as the art as written already reaches.)
      assert.ok(x0 >= -spec.ax - room[0] && x1 <= spec.w - spec.ax + room[2], `${what}: inside the sprite's width (${x0}..${x1})`);
      assert.ok(y0 >= -spec.ay - room[1] && y1 <= spec.h - spec.ay + room[3], `${what}: inside the sprite's height (${y0}..${y1})`);
      n++;
    }
  }
  assert.ok(n > 400, `${n} drawings checked`);
});

test('turn: turn 0 is drawn straight onto the canvas, through no recorder', () => {
  turnCheck.last = null;
  const { ctx } = recordingContext();
  buildingSpec('senate', 4, 0, 0).draw(ctx);
  assert.equal(turnCheck.last, null);
  buildingSpec('senate', 4, 0, 0, false, 0, false, 1).draw(ctx);
  assert.ok(turnCheck.last && turnCheck.last.paints > 0, 'a turned one is recorded and replayed');
});

/** Record a drawing at a turn; the units in painted order with their first fill color. */
function painted(S, turn, fn) {
  const fills = [];
  let fill = null;
  const { ctx } = recordingContext();
  const spy = new Proxy(ctx, {
    get: (t, k) => (k === 'fill' ? () => fills.push(fill) : t[k]),
    set: (t, k, v) => { if (k === 'fillStyle') fill = v; t[k] = v; return true; },
  });
  drawTurned(spy, S, turn, fn, { record: true });
  return fills;
}

test('turn: painter\'s order after the turn: the box behind is painted first', () => {
  // As written, A is at the back (small u + v) and B in front.
  const draw = (ctx) => {
    box(ctx, 0.1, 0.1, 0.6, 0.6, 0, 40, '#aa0000', { plain: true }); // (tall enough to overlap on the screen)
    box(ctx, 1.2, 1.2, 0.6, 0.6, 0, 40, '#00aa00', { plain: true });
  };
  const first = (fills) => fills.findIndex((f) => f.startsWith('#') && f !== '#000000');
  const order = (t) => {
    const f = painted(2, t, draw);
    const a = f.findIndex((c) => c === '#aa0000');
    const b = f.findIndex((c) => c === '#00aa00');
    return a < b ? 'A' : 'B';
  };
  assert.equal(order(0), 'A', 'as written');
  assert.equal(order(2), 'B', 'half a turn: B is now behind');
  assert.ok(first(painted(2, 1, draw)) >= 0);
});

test('turn: a door turned away is drawn under its walls and gives no light; one turned to the viewer does', () => {
  const draw = (ctx) => {
    box(ctx, 0.2, 0.2, 0.6, 0.6, 0, 12, '#c0c0c0', { plain: true });
    door(ctx, 'left', 0.2, 0.2, 0.8, 0.8, 0, 0.5, '#123456');
  };
  for (let t = 0; t < 4; t++) {
    const { ctx, lights } = recordingContext();
    drawTurned(ctx, 1, t, draw, { record: true });
    const seen = t === 0 || t === 3; // +v looks at the viewer at turn 0, +u at turn 3
    assert.equal(lights.filter((l) => l.kind === 'door').length, seen ? 1 : 0, `turn ${t}: lit only when seen`);
    const fills = painted(1, t, draw);
    const doorAt = fills.indexOf('#123456');
    const wallAt = fills.indexOf('#c0c0c0');
    assert.ok(seen ? doorAt > wallAt : doorAt < wallAt, `turn ${t}: door ${seen ? 'over' : 'under'} the wall`);
  }
});

test('turn: a chimney through its roof stays on top of it at every turn', () => {
  for (let t = 0; t < 4; t++) {
    const fills = painted(1, t, (ctx) => {
      box(ctx, 0.16, 0.16, 0.68, 0.66, 0, 12, '#dddddd', { plain: true });
      box(ctx, 0.16, 0.16, 0.68, 0.66, 12, 6, '#aa3322', { plain: true }); // stands in for the roof
      box(ctx, 0.62, 0.3, 0.1, 0.1, 16, 8, '#555555', { plain: true });
    });
    assert.ok(fills.lastIndexOf('#555555') > fills.lastIndexOf('#aa3322'), `turn ${t}`);
  }
});

test('turn: flags turn with their building; pixel-placed ones (the colosseum) stay', () => {
  const f0 = flagsFor('prefecture', 1, 0)[0];
  const f2 = flagsFor('prefecture', 1, 2)[0];
  const [u, v] = turnUV(0.86, 0.3, 1, 2);
  assert.equal(f2.x, (u - v) * HALF_W);
  assert.notEqual(f0.x, f2.x);
  assert.deepEqual(flagsFor('colosseum', 5, 1).map((f) => f.x), flagsFor('colosseum', 5, 0).map((f) => f.x));
});

test('turn: round and symmetric buildings draw the same at every turn', () => {
  for (const [k, S] of [['reservoir', 3], ['colosseum', 5], ['well', 1]]) {
    const ref = JSON.stringify(painted(S, 0, (c) => buildingSpec(k, S, 0, 1).draw(c)));
    for (let t = 1; t < 4; t++) {
      assert.equal(JSON.stringify(painted(S, 0, (c) => buildingSpec(k, S, 0, 1, false, 0, false, t).draw(c))), ref, `${k} turn ${t}`);
    }
  }
});

test('turn: the sort keeps the drawing order where nothing says otherwise, and breaks cycles', () => {
  const u = (b, idx) => ({ b, idx, ops: [] });
  const units = [u([0, 1, 0, 1, 0, 0], 0), u([0, 1, 0, 1, 0, 0], 1), u(null, 2)];
  assert.deepEqual(sortUnits(units, [[0, 0, 10, 10], [0, 0, 10, 10], [0, 0, 10, 10]]).map((x) => x.idx), [0, 1, 2]);
  // B entirely behind A along u: B goes first.
  const ab = [u([1, 2, 0, 1, 0, 5], 0), u([0, 1, 0, 1, 0, 5], 1)];
  assert.deepEqual(sortUnits(ab, [[0, 0, 10, 10], [0, 0, 10, 10]]).map((x) => x.idx), [1, 0]);
  // Apart on the screen: no reordering.
  assert.deepEqual(sortUnits(ab, [[0, 0, 10, 10], [20, 0, 30, 10]]).map((x) => x.idx), [0, 1]);
  void P;
});

test('turn: a turned warehouse\'s stock paints its crates and only the walls that cover them; the walls are recorded once', () => {
  const stock = { pottery: 400, oil: 300, wine: 800, iron: 200, timber: 100 };
  const { ctx } = recordingContext();
  assert.equal(drawWarehouseStock(ctx, stock, 0), null, 'turn 0: just the crates');
  for (const t of [1, 2, 3]) {
    const painted = drawWarehouseStock(ctx, stock, t, 0);
    const crates = painted.filter((u) => u.item);
    const walls = painted.filter((u) => !u.item);
    assert.ok(crates.length >= 10, `turn ${t}: the crates (${crates.length})`);
    const meets = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    for (const w of walls) assert.ok(crates.some((c) => meets(c.box, w.box)), `turn ${t}: a wall painted again covers a crate`);
    // Not the whole warehouse again (its translucent shades would darken twice).
    const again = drawWarehouseStock(ctx, stock, t, 0);
    const firstWall = walls[0];
    if (firstWall) assert.ok(again.includes(firstWall), `turn ${t}: the same recorded wall, kept`);
  }
  // At turn 2 the office stands in front of the far bays: it is painted over them.
  assert.ok(drawWarehouseStock(ctx, stock, 2, 0).some((u) => !u.item), 'turn 2: the office covers crates behind it');
  const sacks = drawGranaryStock(ctx, 3, 1, 2, 0);
  assert.ok(sacks.some((u) => u.item), 'a granary\'s sacks, turned');
});

test('turn: a round building\'s night torches stay put at every turn (its art does not turn)', () => {
  const at0 = lightsOf('amphitheater:3:0:0', 'amphitheater', 3, 0, 0, 0).torches;
  const at1 = lightsOf('amphitheater:3:0:0:t1', 'amphitheater', 3, 0, 0, 1).torches;
  assert.deepEqual(at1, at0);
  const s0 = lightsOf('school:2:0:0', 'school', 2, 0, 0, 0);
  const s2 = lightsOf('school:2:0:0:t2', 'school', 2, 0, 0, 2);
  assert.notDeepEqual(s2.windows, s0.windows, 'a school\'s windows do move');
});

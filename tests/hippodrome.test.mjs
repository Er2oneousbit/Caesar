/**
 * hippodrome.test.mjs - the hippodrome (three linked 5x5 sections), the
 * chariot maker, races, the charioteer and what they are worth to homes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { BUILDINGS, VENUE_POINTS, ENT_BASE_MAX, ENT_SEATS_MAX } from '../src/data/buildings.js';
import { WALKER_TYPES } from '../src/data/walkers.js';
import { checkBuilding, planAction, applyPlan, undoLast, rebuildPlan } from '../src/sim/construction.js';
import { linkedGroup, computeAccessRoad } from '../src/sim/entities.js';
import { igniteBuilding, collapseBuilding } from '../src/sim/risk.js';
import { updateTraining, updateEntertainmentBase, racesRunning, SHOW_DAYS } from '../src/sim/entertainment.js';
import { updateServiceSpawns, venueActive } from '../src/sim/services.js';
import { updateWalkers } from '../src/sim/walkers.js';
import { streetRisk } from '../src/sim/movement.js';
import { entertainmentScore } from '../src/sim/housing.js';
import { updateRatings } from '../src/sim/ratings.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { vendorSupply } from '../src/sim/market.js';
import { Building, newHouseData } from '../src/sim/entities.js';
import { newGame, build, findFree } from './helpers.mjs';

/** A hippodrome placed at a free 15x5 spot (with a 1-tile margin for roads), or fails the test. */
function placeHippodrome(game) {
  const spot = findFree(game, 17, 7);
  assert.ok(spot, 'room for a hippodrome');
  const x = spot.x + 1;
  const y = spot.y + 1;
  const res = build(game, 'hippodrome', x + 7, y + 2); // held by its middle tile
  assert.ok(res.ok, 'placed');
  const main = game.buildings.get(game.map.building[game.map.idx(x, y)]);
  return { main, x, y };
}

test('hippodrome: data as the spec sets it (900 Dn, 40 workers, 30 points, one per city)', () => {
  const d = BUILDINGS.hippodrome;
  assert.equal(d.cost, 900);
  assert.equal(d.workers, 40);
  assert.equal(d.size * d.span, 15);
  assert.equal(d.size, 5);
  assert.equal(d.limit, 1);
  assert.equal(VENUE_POINTS.hippodrome, 30);
  assert.equal(WALKER_TYPES.charioteer.roam, 2 * WALKER_TYPES.entertainer.roam);
  assert.equal(WALKER_TYPES.charioteer.speed, 2);
  assert.equal(BUILDINGS.chariot_maker.spawnDays, 8);
  assert.equal(BUILDINGS.hippodrome_part.category, null, 'its sections are not in the build menu');
  assert.equal(ENT_BASE_MAX, 26);
  assert.equal(ENT_SEATS_MAX, 20);
});

test('hippodrome: placed as three linked 5x5 sections in a row, one cost; a second is refused', () => {
  const game = newGame({ size: 96 });
  const before = game.city.treasury;
  const { main, x, y } = placeHippodrome(game);
  assert.equal(before - game.city.treasury, BUILDINGS.hippodrome.cost + 0, 'one price for the whole');
  const group = linkedGroup(game, main);
  assert.deepEqual(group.map((b) => [b.type, b.x, b.y, b.size]), [['hippodrome', x, y, 5], ['hippodrome_part', x + 5, y, 5], ['hippodrome_part', x + 10, y, 5]]);
  for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 15; dx++) assert.ok(game.map.building[game.map.idx(x + dx, y + dy)], 'all 75 tiles taken');
  const again = findFree(game, 17, 7);
  const chk = checkBuilding(game, 'hippodrome', again.x + 1, again.y + 1);
  assert.equal(chk.ok, false);
  assert.match(chk.reason, /Only one Circus/);
  assert.equal(checkBuilding(game, 'hippodrome_part', again.x + 1, again.y + 1).ok, false, 'a section alone cannot be placed');
});

test('hippodrome: a road beside any section gives it access; the preview shows all three', () => {
  const game = newGame({ size: 96 });
  const { main, x, y } = placeHippodrome(game);
  assert.equal(main.accessRoad, -1);
  build(game, 'road', x + 12, y + 5); // beside the last section only
  computeAccessRoad(game, main);
  assert.equal(main.accessRoad, game.map.idx(x + 12, y + 5));
  const spot = findFree(game, 17, 7);
  const plan = planAction(game, 'clear', x, y, x, y);
  assert.equal(plan.items.length, 3, 'clearing one section shows the whole');
  void spot;
});

test('hippodrome: demolishing any section takes the whole; undo takes it back with a refund', () => {
  const game = newGame({ size: 96 });
  const { main, x, y } = placeHippodrome(game);
  const money = game.city.treasury;
  assert.ok(undoLast(game).ok);
  assert.equal(game.city.treasury, money + BUILDINGS.hippodrome.cost);
  for (let dx = 0; dx < 15; dx++) assert.equal(game.map.building[game.map.idx(x + dx, y + 2)], 0);
  void main;
  const again = placeHippodrome(game);
  const part = linkedGroup(game, again.main)[2];
  applyPlan(game, planAction(game, 'clear', part.x, part.y, part.x, part.y));
  assert.equal([...game.buildings.values()].filter((b) => b.type.startsWith('hippodrome')).length, 0, 'gone, all three');
});

test('hippodrome: when it burns all three sections fall; the rubble rebuilds the whole', () => {
  const game = newGame({ size: 96 });
  const { main, x, y } = placeHippodrome(game);
  igniteBuilding(game, linkedGroup(game, main)[1]);
  assert.equal([...game.buildings.values()].filter((b) => b.type.startsWith('hippodrome')).length, 0);
  for (let dx = 0; dx < 15; dx++) assert.equal(game.map.rubble[game.map.idx(x + dx, y + 2)], 1, 'rubble over the whole track');
  game.fires.clear();
  const plan = rebuildPlan(game, game.map.idx(x + 12, y + 1));
  assert.ok(plan && plan.count === 1, 'the rubble of any section offers the hippodrome back');
  assert.equal(plan.items[0].x, x);
  assert.ok(applyPlan(game, plan).ok);
  assert.equal(linkedGroup(game, game.buildings.get(game.map.building[game.map.idx(x, y)])).length, 3);
  const g2 = newGame({ size: 96 });
  const h2 = placeHippodrome(g2);
  collapseBuilding(g2, h2.main);
  assert.equal([...g2.buildings.values()].filter((b) => b.type.startsWith('hippodrome')).length, 0);
});

test('hippodrome: only its main section burns or decays (the parts are fire-proof)', () => {
  assert.equal(BUILDINGS.hippodrome.fire, 1);
  assert.equal(BUILDINGS.hippodrome_part.fire, 0);
  assert.equal(BUILDINGS.hippodrome_part.damage, 0);
});

/** A city with a hippodrome and a chariot maker on one road, both staffed. */
function raceCity() {
  const game = newGame({ size: 96 });
  const { main, x, y } = placeHippodrome(game);
  build(game, 'road', x - 1, y + 6, x + 16, y + 6);
  build(game, 'road', x + 7, y + 5, x + 7, y + 6);
  const maker = build(game, 'chariot_maker', x + 1, y + 8);
  assert.ok(maker.ok);
  game.processRoadChanges();
  const cm = game.buildings.get(game.map.building[game.map.idx(x + 1, y + 8)]);
  main.efficiency = 1;
  cm.efficiency = 1;
  return { game, main, maker: cm };
}

test('hippodrome: its risk draws a prefect or engineer down a street beside any of its sections', () => {
  // Risk is kept on the main section, and a walk past any section clears it;
  // a street beside the other sections alone once never drew anyone to it.
  const { game, main } = raceCity();
  const { map } = game;
  const part = [...game.buildings.values()].find((b) => b.main === main.id);
  assert.ok(part, 'a section that is not the main one');
  main.fireRisk = CONFIG.FIRE_THRESHOLD;
  main.damageRisk = CONFIG.DAMAGE_THRESHOLD / 2;
  // West along the road under that section only, from its east end: the
  // way passes nothing but the section (lookahead 8 tiles, reach 2).
  const x = part.x + part.size - 1;
  const y = part.y + part.size + 1;
  assert.ok(map.road[map.idx(x, y)], 'a road under the section');
  const w = { type: 'prefect' };
  assert.equal(streetRisk(game, w, x, y, 3, 'fireRisk') > 0.99, true);
  assert.equal(streetRisk(game, w, x, y, 3, 'damageRisk'), 0.5);
});

test('chariot maker: sends a team that books 32 days of races; the races run the charioteer', () => {
  const { game, main, maker } = raceCity();
  assert.ok(main.accessRoad >= 0 && maker.accessRoad >= 0);
  assert.equal(venueActive(main), false);
  maker.spawnTimer = 0;
  updateTraining(game, maker);
  const team = game.walkers.get(maker.walkers[0]);
  assert.ok(team && team.venue === 'hippodrome', 'a team is on its way');
  assert.equal(team.speed, CONFIG.WALKER_SPEED * 2, 'driving, at twice walking pace');
  for (let t = 0; t < 400 && game.walkers.has(team.id); t++) updateWalkers(game);
  assert.equal(main.shows.hippodrome, SHOW_DAYS, 'races booked');
  assert.ok(racesRunning(game));
  assert.equal(game.messages.filter((m) => /chariots are racing/.test(m.text)).length, 1, 'the first races get a message');
  maker.spawnTimer = 0;
  main.shows.hippodrome = 0;
  updateTraining(game, maker);
  const t2 = game.walkers.get(maker.walkers[maker.walkers.length - 1]);
  for (let t = 0; t < 400 && t2 && game.walkers.has(t2.id); t++) updateWalkers(game);
  assert.equal(game.messages.filter((m) => /chariots are racing/.test(m.text)).length, 1, 'once per game');
  main.spawnTimer = 0;
  updateServiceSpawns(game, main);
  const rider = main.walkers.map((id) => game.walkers.get(id)).find((w) => w && w.type === 'charioteer');
  assert.ok(rider, 'the charioteer goes out');
  assert.equal(rider.speed, CONFIG.WALKER_SPEED * 2);
  assert.equal(rider.roamLeft, 52);
  assert.equal(rider.venue, 'hippodrome');
});

test('hippodrome: no races, no charioteer and no seats (Colonia keeps the rule for every venue)', () => {
  const { game, main } = raceCity();
  main.spawnTimer = 0;
  updateServiceSpawns(game, main);
  assert.equal(main.walkers.length, 0);
  game.city.population = 1000;
  updateEntertainmentBase(game);
  assert.equal(game.city.entBase, 0);
  assert.equal(game.city.entCoverage.hippodrome, undefined);
});

test('entertainment: a working hippodrome seats the whole city (+6 to every home, base up to 26)', () => {
  const { game, main } = raceCity();
  game.city.population = 1000;
  main.shows.hippodrome = 10;
  updateEntertainmentBase(game);
  assert.equal(game.city.entCoverage.hippodrome, 100);
  assert.equal(game.city.entBase, 6, 'floor(100 / 3 / 5)');
  // With the three seat kinds at 100% too: 400 / 15 = 26.
  for (const [type, n] of [['theater', 3], ['amphitheater', 2], ['colosseum', 1]]) {
    for (let k = 0; k < n; k++) {
      const v = new Building(9000 + k * 10 + n, type, 0, 0);
      v.efficiency = 1;
      v.shows[type === 'colosseum' ? 'colosseum' : type] = 10;
      game.buildings.set(v.id, v);
    }
  }
  updateEntertainmentBase(game);
  assert.equal(game.city.entBase, 26);
  main.efficiency = 0;
  updateEntertainmentBase(game);
  assert.equal(game.city.entBase, 20, 'unstaffed: back to the three seat kinds');
});

test('entertainment: a home the charioteer passed gets 30, and the top score is 116', () => {
  const game = newGame();
  game.city.entBase = 26;
  const h = newHouseData();
  h.ent = { theater: 5, amphitheater: 5, colosseum: 5, hippodrome: 5 };
  h.entBoth = { amphitheater: 5, colosseum: 5 };
  assert.equal(entertainmentScore(game, h), 26 + 10 + 20 + 30 + 30);
  h.ent = { theater: 0, amphitheater: 0, colosseum: 0, hippodrome: 5 };
  h.entBoth = { amphitheater: 0, colosseum: 0 };
  assert.equal(entertainmentScore(game, h), 26 + 30);
});

test('prosperity: +2 on its target while races run', () => {
  const run = (races) => {
    const { game, main } = raceCity();
    game.city.population = 1000;
    game.city.avgTier = 6;
    game.city.ratings.prosperity = 0;
    main.shows.hippodrome = races ? 20 : 0;
    // Step the rating up to its target and read where it settles.
    for (let k = 0; k < 40; k++) updateRatings(game);
    return game.city.ratings.prosperity;
  };
  assert.equal(run(true) - run(false), CONFIG.HIPPODROME_PROSPERITY);
});

test('save: a hippodrome keeps its sections linked and its races', () => {
  const { game, main } = raceCity();
  main.shows.hippodrome = 17;
  const again = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  const m2 = again.buildings.get(main.id);
  assert.equal(m2.shows.hippodrome, 17);
  assert.equal(linkedGroup(again, m2).length, 3);
  assert.ok(m2.accessRoad >= 0);
});

test('fish reaches homes: a vendor hands fish to a home that wants a kind the market has', () => {
  const game = newGame();
  const market = new Building(500, 'market', 0, 0);
  const home = new Building(501, 'house', 2, 2);
  home.house.pop = 20;
  home.house.tier = 12; // an Insula keeps two kinds of food
  market.stock.wheat = 300;
  market.stock.fish = 300;
  vendorSupply(game, market, home);
  assert.ok(home.house.food.wheat > 0 && home.house.food.fish > 0, 'wheat and fish');
});

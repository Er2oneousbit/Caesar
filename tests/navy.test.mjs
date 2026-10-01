/**
 * navy.test.mjs - sea raids and the provincial fleet (sim/navy.js): the
 * third of raids that comes by sea (deterministic, off with the switch, never
 * without water from the sea), the landing, raider ships' fire pots, the
 * Navalia and its materials, naval stations and their squadrons, the
 * player's orders, fighting at sea, losing a station, the unlocks and the
 * save upgrade from version 10.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { log } from '../src/core/debug.js';
import { RNG } from '../src/core/rng.js';
import { CONFIG } from '../src/config.js';
import { Game } from '../src/core/game.js';
import { serializeGame, deserializeGame, upgradeNavyV10 } from '../src/core/save.js';
import { sandboxScenario, SCENARIOS, NAVY_KEYS } from '../src/data/scenarios.js';
import { UNIT_TYPES, STATION_CAPACITY } from '../src/data/units.js';
import { generateMap } from '../src/world/mapgen.js';
import { Terrain } from '../src/world/map.js';
import { addBuilding, removeBuilding, spawnWalker } from '../src/sim/entities.js';
import { checkBuilding } from '../src/sim/construction.js';
import { findDeliveryTarget } from '../src/sim/storage.js';
import { spawnUnit, updateMilitary, militaryMonthly, militaryDaily, launchInvasion, enemyCount, fillField, threatSummary } from '../src/sim/military.js';
import {
  seaRaidPlan, seaRoll, findLanding, updateNavalia, updateNavalDemand, navalNeed, squadron, squadronCounts,
  deployStation, recallStation, stationSpots, shoreBerth, waterOf,
} from '../src/sim/navy.js';
import { buildDemoCity, buildDemoNavy, buildDemoFishery } from '../src/dev/demoCity.js';
import { newGame } from './helpers.mjs';

log.setLevel('error');

const TPD = CONFIG.TICKS_PER_DAY;

/** A coastal sandbox with the demo city grown a little (homes for a landing to aim at). */
function coastCity(opts = {}) {
  const game = newGame({ type: 'coast', size: 64, seed: 'demo', ...opts });
  const res = buildDemoCity(game, { level: 2 });
  assert.ok(res.ok, res.reason);
  game.runDays(16 * 3);
  return { game, center: res.center };
}

/** A coastal city with a naval station and a navalia, both fully staffed from now on. */
function fleetCity(opts = {}) {
  const { game, center } = coastCity(opts);
  const nv = buildDemoNavy(game, center, opts.stock === false ? {} : { stock: true });
  assert.ok(nv.ok, 'navy placed');
  staff(game);
  return { game, center, station: nv.station, navalia: nv.navalia };
}

/** Every fleet building at full staff (labor is not what these tests are about). */
function staff(game) {
  for (const b of game.buildings.values()) if (b.def.kind === 'station' || b.def.kind === 'navalia') b.efficiency = 1;
}

/** Run whole days keeping the fleet staffed. */
function runDays(game, n) {
  for (let d = 0; d < n; d++) { staff(game); game.runDays(1); }
}

/** A navigable water tile of the sea entry's water, `r` tiles or so from tile (x, y). */
function seaTileNear(game, x, y, r = 3) {
  const { map } = game;
  const body = map.navBody[map.idx(map.seaEntry.x, map.seaEntry.y)];
  let best = null;
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (map.navBody[map.idx(tx, ty)] !== body) continue;
      const d = Math.abs(Math.hypot(tx - x, ty - y) - r);
      if (!best || d < best.d) best = { x: tx, y: ty, d };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Which raids come by sea
// ---------------------------------------------------------------------------

test('sea raids: about a third, decided by the map seed and the raid number alone', () => {
  // The same seed and raid number always give the same answer...
  assert.equal(seaRoll('demo', 3), seaRoll('demo', 3));
  assert.notEqual(seaRoll('demo', 3), seaRoll('demo', 4));
  // ...and over many maps about a third of raids come by sea.
  let sea = 0;
  const N = 600;
  for (let k = 0; k < N; k++) if (seaRoll(`seed-${k}`, 1 + (k % 7)) < CONFIG.SEA_RAID_SHARE) sea++;
  assert.ok(sea > N * 0.27 && sea < N * 0.4, `${sea} of ${N} by sea`);
});

test('sea raids: the scouts see a raid by sea when the roll says so, never with the switch off or without water from the sea', () => {
  const { game } = coastCity({ invasions: 'occasional' });
  const m = game.military;
  assert.equal(m.seaRaids, true, 'on by default');
  // Find raid numbers that come by sea and by land on this map.
  let seaId = 0;
  let landId = 0;
  for (let n = 1; n < 40 && (!seaId || !landId); n++) {
    if (seaRoll(game.seed, n) < CONFIG.SEA_RAID_SHARE) seaId ||= n;
    else landId ||= n;
  }
  m.nextInvasionId = seaId;
  assert.ok(seaRaidPlan(game), 'by sea');
  m.nextInvasionId = landId;
  assert.equal(seaRaidPlan(game), null, 'by land');
  m.nextInvasionId = seaId;
  m.seaRaids = false;
  assert.equal(seaRaidPlan(game), null, 'the switch is off');
  // The scouts' warning: by sea, with a landing; then by land with the switch off.
  m.seaRaids = true;
  game.city.population = 1000;
  m.nextRaidMonth = game.time.totalMonths + 3;
  militaryMonthly(game);
  assert.equal(m.warned.sea, true);
  assert.ok(m.warned.landing && Number.isInteger(m.warned.landing.x));
  assert.match(game.messages[0].text, /by sea, from the/);
  assert.match(threatSummary(game).text, /by sea/);
  // A map with no water reaching the sea: never by sea.
  const plains = newGame({ type: 'plains', size: 64, seed: 'demo', invasions: 'occasional' });
  assert.equal(plains.map.seaEntry, null);
  for (let n = 1; n < 20; n++) { plains.military.nextInvasionId = n; assert.equal(seaRaidPlan(plains), null); }
});

test('sea raids: a raid by land draws exactly what it did before, switch on or off', () => {
  // A raid number that comes by land: the shared random stream is untouched
  // by the choice, so both cities warn and launch alike.
  const { game } = coastCity({ invasions: 'occasional' });
  let landId = 1;
  while (seaRoll(game.seed, landId) < CONFIG.SEA_RAID_SHARE) landId++;
  const data = JSON.stringify(serializeGame(game));
  const on = deserializeGame(JSON.parse(data));
  const off = deserializeGame(JSON.parse(data));
  off.military.seaRaids = false;
  for (const g of [on, off]) {
    g.military.nextInvasionId = landId;
    g.city.population = 1000;
    g.military.nextRaidMonth = g.time.totalMonths + 3;
    militaryMonthly(g); // the warning
    g.military.nextRaidMonth = g.time.totalMonths;
    militaryMonthly(g); // the launch
  }
  assert.equal(on.military.active.sea, undefined);
  assert.deepEqual(on.rng.getState(), off.rng.getState());
  assert.deepEqual([...on.units.values()].map((u) => [u.type, u.x, u.y]), [...off.units.values()].map((u) => [u.type, u.x, u.y]));
});

// ---------------------------------------------------------------------------
// The landing
// ---------------------------------------------------------------------------

test('sea raids: the landing is open shore by the sea entry\'s water, a walk of 3 tiles or more from the homes', () => {
  const { game } = coastCity();
  const { map } = game;
  const L = findLanding(game);
  assert.ok(L, 'a landing');
  const i = map.idx(L.x, L.y);
  assert.notEqual(map.terrain[i], Terrain.WATER);
  assert.equal(map.building[i], 0);
  const sea = map.navBody[map.idx(map.seaEntry.x, map.seaEntry.y)];
  assert.equal(map.navBody[L.water], sea, 'the ship lies on the sea entry\'s water');
  assert.equal(Math.abs(map.xOf(L.water) - L.x) + Math.abs(map.yOf(L.water) - L.y), 1, 'right beside it');
  const field = new Float32Array(map.size);
  fillField(game, field, (id) => !!game.buildings.get(id)?.house);
  assert.ok(Number.isFinite(field[i]), 'raiders can walk from it to a home');
  assert.ok(field[i] >= CONFIG.LANDING_MIN_WALK);
  assert.deepEqual(findLanding(game), L, 'no random draws: the same landing again');
});

// ---------------------------------------------------------------------------
// Raider ships
// ---------------------------------------------------------------------------

test('raider ships: they sail in, land their raiders, wait offshore, then leave; raiders aboard count', () => {
  const { game } = coastCity();
  const inv = launchInvasion(game, null, 12, { sea: true });
  assert.equal(inv.sea, true);
  assert.equal(inv.ships, 2, '12 raiders: two ships');
  const ships = [...game.units.values()].filter((u) => u.type === 'raider_ship');
  assert.equal(ships.length, 2);
  assert.equal(ships.reduce((n, u) => n + u.crew.length, 0), 12);
  assert.equal(enemyCount(game), 12, 'raiders aboard are raiders in the province');
  // Sail until they land.
  for (let d = 0; d < 80 && !inv.landed; d++) game.runDays(1);
  assert.ok(inv.landed, 'they came ashore');
  game.runDays(2);
  const ashore = [...game.units.values()].filter((u) => u.side === 'enemy' && !UNIT_TYPES[u.type].naval);
  assert.equal(ashore.length + inv.killed, 12, 'every raider came ashore');
  assert.ok([...game.units.values()].some((u) => u.type === 'raider_ship' && u.state === 'offshore'), 'the ships wait offshore');
  // The raid runs its course; then the ships sail away and leave.
  for (let d = 0; d < 200 && game.military.active; d++) game.runDays(1);
  assert.equal(game.military.active, null, 'the raid ended');
  for (let d = 0; d < 80 && [...game.units.values()].some((u) => u.type === 'raider_ship'); d++) game.runDays(1);
  assert.equal([...game.units.values()].filter((u) => u.side === 'enemy').length, 0, 'ships and raiders gone');
  assert.equal(game.military.stats.seaRaids, 1);
});

test('raider ships: fire pots sink a fishing boat and burn into a building by the shore; never more than its pots', () => {
  const { game, center } = coastCity();
  const { map } = game;
  game.military.active = { id: 99, origin: { x: 0, y: 0 }, size: 1, killed: 0, buildingsLost: 0, startDay: 0, fleeing: false, reached: false, sea: true, landed: true, landedDay: 0 };
  // A wharf by the water and a raider ship 3 tiles off it.
  const fish = buildDemoFishery(game, center, { wharves: 1 });
  const b = fish.wharves[0];
  assert.ok(b && map.navigableBeside(b.x, b.y, b.size) >= 0, 'a building by the shore');
  const w = seaTileNear(game, b.x, b.y, 3);
  const ship = spawnUnit(game, 'raider_ship', w.x + 0.5, w.y + 0.5, { invasion: 99, state: 'offshore', crew: [], pots: 2 });
  // A fishing boat beside the ship first: it is the first target.
  const boatTile = seaTileNear(game, w.x, w.y, 1);
  const boat = spawnWalker(game, 'fishing_boat', map.idx(boatTile.x, boatTile.y), null, { state: 'moored', body: map.fishBody[map.idx(boatTile.x, boatTile.y)] });
  assert.ok(boat);
  const risk0 = b.fireRisk;
  const hp0 = b.hp ?? Infinity;
  for (let t = 0; t < 200; t++) updateMilitary(game);
  assert.ok(!game.walkers.has(boat.id), 'the boat is sunk');
  assert.equal(game.military.stats.boatsSunk, 1);
  assert.equal(ship.pots, 0, 'two pots thrown');
  const still = game.buildings.get(b.id);
  if (still) {
    assert.ok(still.hp < hp0, `the building is hurt (${still.hp})`);
    if (still.def.fire > 0 || still.house) assert.ok(still.fireRisk >= risk0 + CONFIG.RAID_SHIP_FIRE_HEAT - 1e-9, 'and its fire risk is up');
  }
  assert.equal(game.military.active.reached, false, 'pots alone are no reason for plunder');
  // Out of pots: nothing more is thrown.
  const flying = game.projectiles.length;
  for (let t = 0; t < 200; t++) updateMilitary(game);
  assert.ok(game.projectiles.length <= flying, 'no more pots');
});

// ---------------------------------------------------------------------------
// The Navalia and the stations
// ---------------------------------------------------------------------------

test('navalia: it needs timber, iron and linen, and a staffed station with room, then launches a liburnian', () => {
  const { game, station, navalia } = fleetCity({ stock: false });
  assert.ok(shoreBerth(game, navalia) >= 0 && waterOf(game, navalia) === waterOf(game, station));
  updateNavalia(game, navalia);
  assert.match(navalia.blocked, /Waiting for timber, iron, linen/);
  navalia.stock.timber = 300;
  navalia.stock.iron = 100;
  updateNavalia(game, navalia);
  assert.match(navalia.blocked, /Waiting for linen/);
  navalia.stock.linen = 100;
  let days = 0;
  while (squadron(game, station.id).length === 0 && days < 60) { updateNavalia(game, navalia); days++; }
  assert.equal(days, CONFIG.NAVALIA_BUILD_DAYS, 'one ship in NAVALIA_BUILD_DAYS at full staff');
  const [ship] = squadron(game, station.id);
  assert.equal(ship.type, 'liburnian');
  assert.deepEqual([navalia.stock.timber, navalia.stock.iron, navalia.stock.linen], [0, 0, 0], 'materials used');
  assert.equal(game.military.stats.shipsBuilt, 1);
  // An unstaffed station gets no ships.
  station.efficiency = 0;
  navalia.stock.timber = 300; navalia.stock.iron = 100; navalia.stock.linen = 100;
  updateNavalia(game, navalia);
  assert.match(navalia.blocked, /No staffed Naval Station/);
});

test('navalia: carts bring its timber only while a station has an empty berth; then the workshops get it', () => {
  const { game, station, navalia } = fleetCity({ stock: false });
  updateNavalDemand(game);
  assert.equal(navalNeed(game, 'timber'), STATION_CAPACITY * CONFIG.LIBURNIAN_COST.timber);
  const from = station.accessRoad;
  const t = findDeliveryTarget(game, from, 'timber', 100);
  assert.ok(t && t.id === navalia.id, 'timber goes to the navalia');
  // A full squadron: no more demand.
  const berth = shoreBerth(game, station);
  for (let k = 0; k < STATION_CAPACITY; k++) spawnUnit(game, 'liburnian', game.map.xOf(berth) + 0.5, game.map.yOf(berth) + 0.5, { station: station.id, slot: k, state: 'sail' });
  updateNavalDemand(game);
  assert.equal(navalNeed(game, 'timber'), 0);
  const t2 = findDeliveryTarget(game, from, 'timber', 100);
  assert.ok(!t2 || t2.id !== navalia.id, 'not to the navalia');
});

test('stations: a squadron of four berths beside its station; the fifth ship is not built', () => {
  const { game, station, navalia } = fleetCity();
  for (const g of Object.keys(CONFIG.LIBURNIAN_COST)) navalia.stock[g] = CONFIG.LIBURNIAN_COST[g] * 5;
  runDays(game, CONFIG.NAVALIA_BUILD_DAYS * 5 + 30);
  const ships = squadron(game, station.id);
  assert.equal(ships.length, STATION_CAPACITY);
  assert.equal(squadronCounts(game).get(station.id), STATION_CAPACITY);
  assert.match(navalia.blocked, /No staffed Naval Station on this water has an empty berth/);
  const spots = stationSpots(game, station);
  for (const u of ships) {
    assert.equal(u.state, 'berthed', `${u.id} at its berth`);
    assert.ok(Math.hypot(u.x - spots[u.slot].x, u.y - spots[u.slot].y) < 0.1);
    assert.ok(game.map.navigable[game.map.idx(Math.floor(u.x), Math.floor(u.y))], 'on the water');
  }
  // Monthly pay: 4 Dn a liburnian.
  const before = game.city.finance.thisYear.military || 0;
  militaryMonthly(game);
  assert.equal((game.city.finance.thisYear.military || 0) - before, STATION_CAPACITY * UNIT_TYPES.liburnian.upkeep);
});

test('stations: the player sends a squadron to water on its river or sea, and recalls it', () => {
  const { game, station } = fleetCity();
  const berth = shoreBerth(game, station);
  for (let k = 0; k < 2; k++) spawnUnit(game, 'liburnian', game.map.xOf(berth) + 0.5, game.map.yOf(berth) + 0.5, { station: station.id, slot: k, state: 'sail' });
  const far = seaTileNear(game, station.x, station.y, 10);
  assert.ok(deployStation(game, station.id, far.x, far.y));
  assert.deepEqual(station.rally, { x: far.x + 0.5, y: far.y + 0.5 });
  runDays(game, 12);
  for (const u of squadron(game, station.id)) {
    assert.equal(u.state, 'holding');
    assert.ok(Math.hypot(u.x - station.rally.x, u.y - station.rally.y) < 3, 'out at the spot');
  }
  // Land away from the water: refused.
  const land = [...game.buildings.values()].find((b) => b.house);
  assert.equal(deployStation(game, station.id, land.x, land.y), false);
  assert.ok(recallStation(game, station.id));
  assert.equal(station.rally, null);
  runDays(game, 12);
  for (const u of squadron(game, station.id)) assert.equal(u.state, 'berthed');
});

// ---------------------------------------------------------------------------
// War at sea
// ---------------------------------------------------------------------------

test('sea combat: a liburnian sinks a raider ship and drowns its raiders; five raider ships sink a liburnian', () => {
  const { game, station } = fleetCity();
  const inv = { id: 7, origin: { x: 0, y: 0 }, size: 8, killed: 0, buildingsLost: 0, startDay: 0, fleeing: false, reached: false, sea: true, landed: false };
  game.military.active = inv;
  const berth = shoreBerth(game, station);
  const bx = game.map.xOf(berth);
  const by = game.map.yOf(berth);
  const lib = spawnUnit(game, 'liburnian', bx + 0.5, by + 0.5, { station: station.id, slot: 0, state: 'berthed' });
  const w = seaTileNear(game, bx, by, 4);
  const pirate = spawnUnit(game, 'raider_ship', w.x + 0.5, w.y + 0.5, { invasion: 7, state: 'offshore', crew: ['raider', 'raider', 'raider'], pots: 0 });
  for (let t = 0; t < 1500 && game.units.has(pirate.id); t++) updateMilitary(game);
  assert.ok(!game.units.has(pirate.id), 'the raider ship is sunk');
  assert.ok(game.units.has(lib.id), 'the liburnian survives');
  assert.equal(inv.killed, 3, 'its raiders drowned');
  assert.equal(game.military.stats.shipsSunk, 1);
  // Five on one.
  const pack = [];
  for (let k = 0; k < 5; k++) {
    const s = seaTileNear(game, Math.floor(lib.x), Math.floor(lib.y), 2 + (k % 2));
    pack.push(spawnUnit(game, 'raider_ship', s.x + 0.5 + k * 0.05, s.y + 0.5, { invasion: 7, state: 'offshore', crew: [], pots: 0 }));
  }
  for (let t = 0; t < 4000 && game.units.has(lib.id); t++) updateMilitary(game);
  assert.ok(!game.units.has(lib.id), 'outnumbered, the liburnian is sunk');
  assert.equal(game.military.stats.shipsLost, 1);
  assert.ok(pack.some((p) => game.units.has(p.id)), 'and the pack is not all sunk');
});

test('stations: a lost station sends its ships to another on the same water, or lays them up', () => {
  const { game, center, station } = fleetCity();
  const berth = shoreBerth(game, station);
  for (let k = 0; k < 3; k++) spawnUnit(game, 'liburnian', game.map.xOf(berth) + 0.5, game.map.yOf(berth) + 0.5, { station: station.id, slot: k, state: 'sail' });
  // A second station on the same water, with room for two (two berths taken).
  const nv2 = buildDemoNavy(game, center);
  const other = [...game.buildings.values()].find((b) => b.def.kind === 'station' && b.id !== station.id);
  assert.ok(other, `a second station (${nv2.ok})`);
  const ob = shoreBerth(game, other);
  for (let k = 0; k < 2; k++) spawnUnit(game, 'liburnian', game.map.xOf(ob) + 0.5, game.map.yOf(ob) + 0.5, { station: other.id, slot: k, state: 'sail' });
  removeBuilding(game, station, 'demolish');
  assert.equal(squadron(game, other.id).length, STATION_CAPACITY, 'two ships moved over');
  assert.equal([...game.units.values()].filter((u) => u.type === 'liburnian').length, STATION_CAPACITY, 'the third was laid up');
  assert.deepEqual(squadron(game, other.id).map((u) => u.slot).sort(), [0, 1, 2, 3], 'each in a berth of its own');
  assert.match(game.messages[0].text, /2 liburnians sail to another station and 1 is laid up/);
  // The last station goes: every ship is laid up.
  removeBuilding(game, other, 'demolish');
  assert.equal([...game.units.values()].filter((u) => u.type === 'liburnian').length, 0);
});

test('a raid by sea against the fleet: ships are sunk before they land, the raid is broken at sea', () => {
  const { game, station } = fleetCity();
  const berth = shoreBerth(game, station);
  for (let k = 0; k < STATION_CAPACITY; k++) spawnUnit(game, 'liburnian', game.map.xOf(berth) + 0.5, game.map.yOf(berth) + 0.5, { station: station.id, slot: k, state: 'sail' });
  runDays(game, 6);
  // Send the squadron out to the water by the sea entry, where the raiders come in.
  const e = game.map.seaEntry;
  const out = seaTileNear(game, e.x, e.y, 6);
  assert.ok(deployStation(game, station.id, out.x, out.y));
  runDays(game, 30);
  const inv = launchInvasion(game, null, 10, { sea: true });
  assert.ok(inv.sea);
  for (let d = 0; d < 150 && game.military.active; d++) runDays(game, 1);
  assert.ok(game.military.stats.shipsSunk >= 1, `raider ships sunk: ${game.military.stats.shipsSunk}`);
  assert.ok(inv.killed >= 1);
});

// ---------------------------------------------------------------------------
// Unlocks and saves
// ---------------------------------------------------------------------------

test('unlocks: the fleet comes with the missions that have raids and water from the sea (4, 5, 7) and the sandbox', () => {
  const has = (s, k) => s.unlocks === 'all' || s.unlocks.includes(k);
  for (const s of SCENARIOS) {
    const { map } = generateMap({ width: s.map.size, height: s.map.size, seed: s.map.seed, type: s.map.type });
    map.computeNavigation();
    const fleet = NAVY_KEYS.every((k) => has(s, k));
    assert.equal(NAVY_KEYS.some((k) => has(s, k)), fleet, `${s.id}: both or neither`);
    assert.equal(fleet, !!s.military && !!map.seaEntry, `${s.id}: fleet ${fleet}, raids ${!!s.military}, water from the sea ${!!map.seaEntry}`);
  }
  assert.deepEqual(SCENARIOS.filter((s) => NAVY_KEYS.every((k) => has(s, k))).map((s) => s.id), ['c4', 'c5', 'c7']);
  assert.equal(sandboxScenario().unlocks, 'all');
  // Placement: on the shore of water ships can sail, like a dock.
  const { game } = coastCity();
  const { map } = game;
  let shore = null;
  let inland = null;
  for (let y = 1; y < map.h - 4 && (!shore || !inland); y++) {
    for (let x = 1; x < map.w - 4; x++) {
      const ok = checkBuilding(game, 'naval_station', x, y).ok;
      if (ok) shore ||= { x, y };
      else if (!inland && map.isFree(x, y) && map.isFree(x + 2, y + 2) && map.navigableBeside(x, y, 3) < 0) inland = { x, y };
    }
  }
  assert.ok(shore, 'a station fits on the shore');
  assert.match(checkBuilding(game, 'navalia', inland.x, inland.y).reason || '', /bank of a river or sea/);
});

test('save: the fleet and a raid by sea survive a save; a version 10 city loads with no fleet and the switch on', () => {
  const { game, station } = fleetCity();
  const berth = shoreBerth(game, station);
  spawnUnit(game, 'liburnian', game.map.xOf(berth) + 0.5, game.map.yOf(berth) + 0.5, { station: station.id, slot: 0, state: 'sail' });
  const inv = launchInvasion(game, null, 9, { sea: true });
  game.runDays(3);
  const copy = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  assert.equal(copy.military.active.sea, true);
  assert.deepEqual(copy.military.active.landing, inv.landing);
  const ships = (g) => [...g.units.values()].filter((u) => UNIT_TYPES[u.type].naval).map((u) => [u.type, u.x, u.y, u.station || 0, (u.crew || []).length, u.pots ?? null, u.path ? u.path.length : 0]);
  assert.deepEqual(ships(copy), ships(game));
  assert.equal(copy.military.seaRaids, true);
  // Both play on alike for a while (no pots or arrows were in flight at the save).
  copy.runDays(1);
  game.runDays(1);
  assert.deepEqual(ships(copy).map((s) => s.slice(0, 5)), ships(game).map((s) => s.slice(0, 5)));

  // A version 10 save: no switch, no fleet stats, no fleet.
  const plain = coastCity({ invasions: 'occasional' }).game;
  const data = JSON.parse(JSON.stringify(serializeGame(plain)));
  data.version = 10;
  delete data.military.seaRaids;
  delete data.military.navalDemand;
  for (const k of ['seaRaids', 'shipsSunk', 'shipsLost', 'shipsBuilt', 'boatsSunk']) delete data.military.stats[k];
  data.military.warned = { origin: { x: 0, y: 5 }, size: 9, dir: 'north-west' }; // seen coming by land
  const old = deserializeGame(data);
  assert.equal(old.military.seaRaids, true, 'the switch is on');
  assert.equal(old.military.stats.shipsSunk, 0);
  assert.equal(old.military.warned.sea, undefined, 'a raid already seen stays a raid by land');
  old.runDays(20);
  assert.ok(Number.isFinite(old.city.treasury), 'it plays on');
  // The upgrade leaves a version 11 city alone.
  const m = JSON.stringify(game.military);
  upgradeNavyV10(game);
  assert.equal(JSON.stringify(game.military), m);
  assert.ok(CONFIG.SAVE_VERSION >= 11, 'the fleet came with version 11');
});

test('switch: a sandbox set up without sea raids, or the flag, keeps every raid on land', () => {
  const s = sandboxScenario({ type: 'coast', size: 64, seed: 'demo', seaRaids: false });
  assert.equal(new Game({ scenario: s, flags: {} }).military.seaRaids, false);
  const on = sandboxScenario({ type: 'coast', size: 64, seed: 'demo' });
  assert.equal(new Game({ scenario: on, flags: {} }).military.seaRaids, true);
  assert.equal(new Game({ scenario: on, flags: { searaids: 'off' } }).military.seaRaids, false);
  assert.equal(new Game({ scenario: s, flags: { searaids: 'on' } }).military.seaRaids, true, 'Settings\' choice for a new mission wins');
  // With the switch off, a raid asked to come by sea comes by land.
  const { game } = coastCity();
  game.military.seaRaids = false;
  const inv = launchInvasion(game, null, 6, { sea: true });
  assert.equal(inv.sea, undefined);
  assert.equal([...game.units.values()].filter((u) => u.type === 'raider_ship').length, 0);
});

test('fishing and the fleet: a wharf\'s boat and a liburnian share the water; militaryDaily keeps the raid alive while raiders are aboard', () => {
  const { game, center } = coastCity();
  buildDemoFishery(game, center, { wharves: 1 });
  const inv = launchInvasion(game, null, 8, { sea: true });
  militaryDaily(game);
  assert.equal(game.military.active, inv, 'not over: its raiders are aboard');
  assert.equal(inv.campDays || 0, 0);
});

// ---------------------------------------------------------------------------
// Found in review
// ---------------------------------------------------------------------------

test('review: a squadron sent all over its river never rows onto land (a straight line across a bank\'s corner)', () => {
  // River seed 'c': deploy 31 of this walk once put a liburnian on a grass
  // corner, where it stayed for good (the straight line was sampled every
  // 0.35 tiles, not walked tile by tile).
  const game = newGame({ type: 'river', size: 64, seed: 'c' });
  const res = buildDemoCity(game, { level: 2 });
  game.runDays(48);
  const nv = buildDemoNavy(game, res.center, { stock: true });
  assert.ok(nv.ok);
  runDays(game, 130);
  const st = nv.station;
  const { map } = game;
  const body = waterOf(game, st);
  const water = [];
  for (let i = 0; i < map.size; i++) if (map.navBody[i] === body) water.push(i);
  const rng = new RNG('wanderc');
  assert.ok(squadron(game, st.id).length >= 2, 'ships to send');
  for (let k = 0; k < 32; k++) {
    const i = water[Math.floor(rng.next() * water.length)];
    deployStation(game, st.id, map.xOf(i), map.yOf(i));
    for (let t = 0; t < TPD * 40; t++) {
      staff(game);
      game.tick();
      for (const u of squadron(game, st.id)) assert.ok(map.navBody[map.idx(Math.floor(u.x), Math.floor(u.y))] === body, `deploy ${k}: liburnian ${u.id} on land at ${u.x.toFixed(2)},${u.y.toFixed(2)}`);
    }
  }
});

test('review: a ship moved from a lost station takes a berth of its own there', () => {
  const { game, center, station } = fleetCity();
  const other = buildDemoNavy(game, center).station;
  assert.ok(other && other.id !== station.id);
  const at = (b) => { const i = shoreBerth(game, b); return [game.map.xOf(i) + 0.5, game.map.yOf(i) + 0.5]; };
  for (let k = 0; k < 3; k++) spawnUnit(game, 'liburnian', ...at(other), { station: other.id, slot: k, state: 'sail' });
  const moved = spawnUnit(game, 'liburnian', ...at(station), { station: station.id, slot: 3, state: 'sail' });
  removeBuilding(game, station, 'demolish');
  assert.equal(moved.station, other.id);
  assert.deepEqual(squadron(game, other.id).map((u) => u.slot).sort(), [0, 1, 2, 3]);
});

test('review: a navalia takes no materials for stations on other water', () => {
  const { game, station, navalia } = fleetCity({ stock: false });
  updateNavalDemand(game);
  assert.equal(navalia.fleetNeeds, true);
  // Pretend the navalia's slip is on other water than the station's berths.
  const slip = shoreBerth(game, navalia);
  const orig = game.map.navBody[slip];
  game.map.navBody[slip] = orig + 1000;
  try {
    updateNavalDemand(game);
    assert.equal(navalia.fleetNeeds, false);
    assert.equal(navalNeed(game, 'timber'), 0);
    assert.notEqual(findDeliveryTarget(game, station.accessRoad, 'timber', 100)?.id, navalia.id);
  } finally {
    game.map.navBody[slip] = orig;
  }
});

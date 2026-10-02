/**
 * water.test.mjs - fish (a fifth food), shipyards, wharves and fishing boats
 * (sim/fishing.js, world/map.js computeFishing), the timber a boat takes
 * (Colonia's own rule), with the four guards that keep a city without fish
 * exactly as it was.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { Game } from '../src/core/game.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { sandboxScenario, SCENARIOS, NAVY_KEYS } from '../src/data/scenarios.js';
import { FOOD_TYPES, LAND_FOODS, GOODS } from '../src/data/goods.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { GameMap, Terrain } from '../src/world/map.js';
import { checkBuilding } from '../src/sim/construction.js';
import { removeBuilding, Building, perimeterTiles } from '../src/sim/entities.js';
import { updateWalkers } from '../src/sim/walkers.js';
import { updateShipyard, updateWharf, wharfBoat, spareBoat, sinkFishingBoats, waterBeside } from '../src/sim/fishing.js';
import { receiveGoods, deliveryRoom, findDeliveryTarget, rawHasRoom } from '../src/sim/storage.js';
import { updateWarehouseSupply } from '../src/sim/production.js';
import { buildingStatus } from '../src/ui/infoPanel.js';
import { productionReport } from '../src/ui/production.js';
import { updateMarketBuyer } from '../src/sim/market.js';
import { updateEmperor } from '../src/sim/emperor.js';
import { missionCapacity, bestEntertainment, unlockedBuildings } from '../src/sim/capacity.js';
import { healthLacks } from '../src/sim/disease.js';
import { HOUSE_TIERS } from '../src/data/housing.js';
import { newGame, build } from './helpers.mjs';

const TPD = CONFIG.TICKS_PER_DAY;

/** A coast sandbox (big water with fishing grounds). */
function coastGame(opts = {}) {
  return newGame({ type: 'coast', size: 64, seed: 'fish-test', ...opts });
}

/** Land 2x2 spots touching water with fishing grounds, nearest the first ground first. */
function shoreSpots(game) {
  const { map } = game;
  const g = map.fishingGrounds[0];
  const out = [];
  for (let y = 1; y < map.h - 3; y++) {
    for (let x = 1; x < map.w - 3; x++) {
      if (!checkBuilding(game, 'wharf', x, y).ok) continue;
      out.push({ x, y, d: Math.hypot(x - g.x, y - g.y) });
    }
  }
  return out.sort((a, b) => a.d - b.d);
}

/** Place `type` (2x2) at the first free shore spot from `spots`, with a road tile beside it; returns the building. */
function placeOnShore(game, type, spots) {
  const { map } = game;
  for (const s of spots) {
    if (!checkBuilding(game, type, s.x, s.y).ok) continue;
    if (!build(game, type, s.x, s.y).ok) continue;
    const b = game.buildings.get(map.building[map.idx(s.x, s.y)]);
    for (const i of perimeterTiles(map, b.x, b.y, b.size)) {
      if (map.isFree(map.xOf(i), map.yOf(i)) && build(game, 'road', map.xOf(i), map.yOf(i)).ok) break;
    }
    if (b.accessRoad >= 0) return b;
    removeBuilding(game, b, 'undo');
  }
  return null;
}

/** Run n days by hand: walkers every tick, the fishing buildings daily, staff as set. */
function runFishingDays(game, n) {
  for (let d = 0; d < n; d++) {
    for (let t = 0; t < TPD; t++) updateWalkers(game);
    for (const b of [...game.buildings.values()]) {
      if (b.def.kind === 'shipyard') updateShipyard(game, b);
      if (b.def.kind === 'wharf') updateWharf(game, b);
    }
  }
}

/**
 * A staffed shipyard and wharf on the coast. The yard starts with `timber`
 * (four boats by default, as the demo fishery's), so the tests of boats and
 * catches are not about wood; the timber tests pass 0.
 */
function fishingSetup({ timber = 4 * CONFIG.SHIPYARD_BOAT_TIMBER, ...opts } = {}) {
  const game = coastGame(opts);
  const spots = shoreSpots(game);
  const yard = placeOnShore(game, 'shipyard', spots);
  const wharf = placeOnShore(game, 'wharf', spots);
  assert.ok(yard && wharf, 'a shipyard and a wharf on the coast');
  yard.efficiency = 1;
  wharf.efficiency = 1;
  yard.stock.timber = timber;
  return { game, yard, wharf, spots };
}

// ---------------------------------------------------------------------------
// Fishing grounds
// ---------------------------------------------------------------------------

test('fishing grounds: derived from the terrain only, the same every time, no random draws', () => {
  const a = coastGame();
  const b = coastGame();
  assert.ok(a.map.fishingGrounds.length > 0, 'the coast has fishing grounds');
  assert.deepEqual(a.map.fishingGrounds, b.map.fishingGrounds);
  const before = a.rng.getState();
  a.map.computeFishing();
  assert.deepEqual(a.rng.getState(), before, 'no draw from the game\'s random stream');
  assert.deepEqual(a.map.fishingGrounds, b.map.fishingGrounds, 'recomputing changes nothing');
});

/** The map's limit on grounds: 8 on a 96x96 map, more on a bigger one, at most 24. */
const groundsMax = (size) => Math.max(CONFIG.FISH_GROUNDS_MAX, Math.min(CONFIG.FISH_GROUNDS_MAX_CAP, Math.round(CONFIG.FISH_GROUNDS_MAX * size * size / (96 * 96))));

test('fishing grounds: bodies of 80+ tiles, at most 10 a body and the map limit, 10 apart, on fishing water', () => {
  for (const type of ['river', 'coast', 'lakes', 'desert', 'plains']) {
    for (const size of [64, 128]) {
      const g = new Game({ scenario: sandboxScenario({ type, size, seed: 'grounds' }) });
      const { map } = g;
      const grounds = map.fishingGrounds;
      assert.ok(grounds.length <= groundsMax(size), `${type} ${size}: at most ${groundsMax(size)}`);
      const sizes = new Map();
      for (let i = 0; i < map.size; i++) if (map.fishBody[i]) sizes.set(map.fishBody[i], (sizes.get(map.fishBody[i]) || 0) + 1);
      for (const n of sizes.values()) assert.ok(n >= CONFIG.FISH_BODY_MIN, 'no pond counts as fishing water');
      for (const id of sizes.keys()) assert.ok(grounds.some((gr) => gr.body === id), 'fishing water always has a ground (water left without one counts as a pond)');
      for (const gr of grounds) {
        assert.equal(map.fishBody[map.idx(gr.x, gr.y)], gr.body, 'a ground lies on its own water');
        assert.equal(map.terrain[map.idx(gr.x, gr.y)], Terrain.WATER);
        const mine = grounds.filter((o) => o.body === gr.body);
        assert.ok(mine.length <= CONFIG.FISH_GROUNDS_PER_BODY);
        for (const o of mine) if (o !== gr) assert.ok(Math.max(Math.abs(o.x - gr.x), Math.abs(o.y - gr.y)) >= CONFIG.FISH_GROUND_SPACING, 'grounds on one water are 10 apart');
      }
    }
  }
  // Playtest: "pretty light". A coast had 4 grounds and a river 1 or 2.
  const count = (type) => new Game({ scenario: sandboxScenario({ type, size: 128, seed: 'grounds' }) }).map.fishingGrounds.length;
  assert.ok(count('coast') >= 8, `a 128 coast: ${count('coast')}`);
  assert.ok(count('river') >= 3, `a 128 river: ${count('river')}`);
  assert.equal(groundsMax(96), 8);
  assert.equal(groundsMax(256), 24);
});

test('fishing grounds: a tiny lake is a pond (no fish); a big one has a ground in open water', () => {
  const map = new GameMap(40, 40);
  map.terrain.fill(Terrain.GRASS);
  const lake = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) map.terrain[map.idx(x, y)] = Terrain.WATER; };
  lake(2, 2, 6, 6); // 36 tiles: a pond
  lake(15, 15, 14, 14); // 196 tiles
  map.computeFishing();
  assert.equal(map.fishBody[map.idx(4, 4)], 0, 'the pond has no fish');
  assert.equal(map.fishingGrounds.length, 1);
  const g = map.fishingGrounds[0];
  assert.ok(g.x >= 17 && g.x <= 25 && g.y >= 17 && g.y <= 25, 'the ground lies 3 or more tiles out from the shore (Chebyshev)');
  assert.equal(map.fishWaterBeside(29, 20, 2), map.idx(28, 20), 'the bank beside the lake touches fishing water');
  assert.equal(map.fishWaterBeside(8, 3, 2), -1, 'the pond\'s bank does not');
});

test('fishing grounds: water left without a ground (the map limit taken) takes no shipyard', () => {
  // A 256 lakes map: more big lakes than the map's 24 grounds.
  const game = new Game({ scenario: sandboxScenario({ type: 'lakes', size: 256, seed: 'sandbox' }), flags: { unlockall: true, money: 1e6 } });
  const { map } = game;
  assert.equal(map.fishingGrounds.length, groundsMax(256));
  let refused = 0;
  for (let y = 1; y < map.h - 3; y++) {
    for (let x = 1; x < map.w - 3; x++) {
      const chk = checkBuilding(game, 'shipyard', x, y);
      if (chk.ok) assert.ok(map.groundsOf(map.fishBody[map.fishWaterBeside(x, y, 2)]).length > 0, 'a shipyard only where boats can fish');
      // Bank of a big lake (80+ tiles) with no ground: refused.
      const near = map.isNearTerrain(x, y, 2, Terrain.WATER, 1);
      if (near && !chk.ok && /pond/.test(chk.reason || '')) refused++;
    }
  }
  assert.ok(refused > 0);
});

test('fishing grounds: the same after a save and load (never saved, derived again)', () => {
  const game = coastGame();
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  assert.equal(JSON.stringify(data).includes('fishingGrounds'), false, 'not in the save');
  const again = deserializeGame(data);
  assert.deepEqual(again.map.fishingGrounds, game.map.fishingGrounds);
  assert.deepEqual([...again.map.fishBody], [...game.map.fishBody]);
});

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

test('placement: wharves and shipyards on the bank of water with fish, never inland or by a pond', () => {
  const game = coastGame();
  const spots = shoreSpots(game);
  assert.ok(spots.length > 0);
  assert.ok(checkBuilding(game, 'shipyard', spots[0].x, spots[0].y).ok);
  // Inland: far from any water.
  const { map } = game;
  let inland = null;
  for (let y = 2; y < map.h - 4 && !inland; y++) for (let x = 2; x < map.w - 4; x++) if (map.isFree(x, y) && map.isFree(x + 1, y) && map.isFree(x, y + 1) && map.isFree(x + 1, y + 1) && map.waterDist[map.idx(x, y)] > 5) { inland = { x, y }; break; }
  const r = checkBuilding(game, 'wharf', inland.x, inland.y);
  assert.equal(r.ok, false);
  assert.match(r.reason, /bank of a river, the sea or a big lake/);
  // A wharf on water whose body has no ground is refused ("No fish in this water").
  const body = map.fishBody[map.fishWaterBeside(spots[0].x, spots[0].y, 2)];
  const saved = map.fishingGrounds;
  map.fishingGrounds = saved.filter((g) => g.body !== body);
  assert.equal(checkBuilding(game, 'wharf', spots[0].x, spots[0].y).reason, 'No fish in this water');
  assert.ok(checkBuilding(game, 'shipyard', spots[0].x, spots[0].y).ok, 'a shipyard only needs the water');
  map.fishingGrounds = saved;
  // A wharf with no shipyard on its water warns.
  assert.ok(checkBuilding(game, 'wharf', spots[0].x, spots[0].y).warnings.some((w) => /No shipyard/.test(w)));
});

// ---------------------------------------------------------------------------
// The shipyard and the boats
// ---------------------------------------------------------------------------

test('shipyard: a boat in 16 days at full staff, sent to the wharf; one spare kept, then nothing more', () => {
  const { game, yard, wharf } = fishingSetup();
  runFishingDays(game, CONFIG.SHIPYARD_BOAT_DAYS - 1);
  assert.equal(spareBoat(game, yard), null, 'not before 16 days');
  runFishingDays(game, 1);
  const first = spareBoat(game, yard);
  assert.ok(first, 'the first boat on day 16, waiting by the yard');
  runFishingDays(game, 1);
  assert.equal(wharfBoat(game, wharf), first, 'the next day it goes to the wharf, which now owns it');
  assert.equal(first.origin, wharf.id);
  assert.equal(spareBoat(game, yard), null);
  runFishingDays(game, CONFIG.SHIPYARD_BOAT_DAYS + 1);
  const spare = spareBoat(game, yard);
  assert.ok(spare, 'a spare boat built ahead');
  const progress = yard.progress;
  runFishingDays(game, 30);
  assert.equal(spareBoat(game, yard), spare, 'the spare waits: no wharf needs it');
  assert.equal(yard.progress, progress, 'and the yard builds nothing while it waits');
  assert.equal([...game.walkers.values()].filter((w) => w.type === 'fishing_boat').length, 2);
});

test('shipyard: half staff takes twice as long; no staff, no boat', () => {
  const { game, yard } = fishingSetup();
  yard.efficiency = 0.5;
  runFishingDays(game, 31);
  assert.equal(spareBoat(game, yard), null);
  runFishingDays(game, 1);
  assert.ok(spareBoat(game, yard), 'day 32 at half staff');
  const { game: g2, yard: y2 } = fishingSetup();
  y2.efficiency = 0;
  runFishingDays(g2, 40);
  assert.equal(y2.progress, 0);
});

test('wharf: its boat fishes 4 days at the nearest ground and lands 100 fish; carts take it to a granary', () => {
  const { game, yard, wharf } = fishingSetup();
  runFishingDays(game, CONFIG.SHIPYARD_BOAT_DAYS + 1);
  const boat = wharfBoat(game, wharf);
  assert.ok(boat);
  const states = new Set();
  let days = 0;
  while ((wharf.catches || 0) === 0 && days < 80) {
    for (let t = 0; t < TPD; t++) { updateWalkers(game); states.add(boat.state); }
    updateWharf(game, wharf);
    days++;
  }
  assert.equal(wharf.catches, 1, 'a catch landed');
  assert.ok(states.has('toGround') && states.has('fishing') && states.has('homeWithCatch'), [...states].join(','));
  assert.ok(wharf.stock.fish === CONFIG.FISH_CATCH || game.city.produced.fish === CONFIG.FISH_CATCH);
  assert.equal(game.city.produced.fish, CONFIG.FISH_CATCH);
  assert.ok(yard.boatsBuilt >= 1);
});

test('wharf: the boat waits while two catches wait on the quay, and never sails with nobody at work', () => {
  const { game, wharf } = fishingSetup();
  runFishingDays(game, CONFIG.SHIPYARD_BOAT_DAYS + 3);
  const boat = wharfBoat(game, wharf);
  // Let it land a first catch, then fill the quay the moment it ties up.
  for (let t = 0; t < TPD * 80 && !(wharf.catches > 0 && boat.state === 'moored'); t++) updateWalkers(game);
  assert.equal(boat.state, 'moored');
  wharf.stock.fish = CONFIG.WHARF_FULL; // two catches waiting, no cart run
  const landed = wharf.catches;
  for (let t = 0; t < TPD * 30; t++) updateWalkers(game);
  assert.equal(boat.state, 'moored', 'full quay: it stays');
  assert.equal(wharf.catches, landed);
  wharf.stock.fish = CONFIG.WHARF_FULL - CONFIG.FISH_CATCH; // one catch: it sails again
  for (let t = 0; t < TPD * 2; t++) updateWalkers(game);
  assert.equal(boat.state, 'toGround', 'one catch on the quay does not hold it');
  wharf.stock.fish = 0;
  wharf.efficiency = 0;
  const caught = wharf.catches || 0;
  for (let t = 0; t < TPD * 60; t++) updateWalkers(game);
  assert.ok((wharf.catches || 0) <= caught + 1, 'with nobody at work at most the trip already under way ends');
  for (let t = 0; t < TPD * 10; t++) updateWalkers(game);
  assert.equal(boat.state, 'moored');
});

test('boats: a demolished wharf\'s boat sinks with it, a demolished yard\'s spare too; the next boat goes to a new wharf', () => {
  const { game, yard, wharf, spots } = fishingSetup();
  runFishingDays(game, CONFIG.SHIPYARD_BOAT_DAYS + 1);
  const boat = wharfBoat(game, wharf);
  removeBuilding(game, wharf, 'demolish');
  assert.equal(game.walkers.has(boat.id), false);
  runFishingDays(game, CONFIG.SHIPYARD_BOAT_DAYS);
  const spare = spareBoat(game, yard);
  assert.ok(spare);
  const w2 = placeOnShore(game, 'wharf', spots);
  w2.efficiency = 1;
  runFishingDays(game, 1);
  assert.equal(wharfBoat(game, w2), spare, 'the spare sails to the new wharf');
  runFishingDays(game, CONFIG.SHIPYARD_BOAT_DAYS + 1);
  const next = spareBoat(game, yard);
  removeBuilding(game, yard, 'demolish');
  assert.equal(game.walkers.has(next.id), false, 'the spare goes with its yard');
  assert.ok(wharfBoat(game, w2), 'the wharf keeps its own boat');
});

test('boats: the nearest staffed wharf on the same water gets the boat, not the first built', () => {
  const { game, yard, wharf, spots } = fishingSetup();
  // A second wharf as near the yard as possible.
  const near = spots.filter((s) => checkBuilding(game, 'wharf', s.x, s.y).ok).sort((a, b) => Math.hypot(a.x - yard.x, a.y - yard.y) - Math.hypot(b.x - yard.x, b.y - yard.y));
  const w2 = placeOnShore(game, 'wharf', near);
  w2.efficiency = 1;
  // By water route from the yard's slip.
  const fb = game.map.fishBody;
  const d = (w) => game.pf.astar(waterBeside(game, yard), waterBeside(game, w), (i) => (fb[i] ? 1 : Infinity), { maxNodes: game.map.size * 4 }).length;
  assert.notEqual(d(w2), d(wharf), 'the test needs one wharf nearer than the other');
  runFishingDays(game, CONFIG.SHIPYARD_BOAT_DAYS + 1);
  const [nearest, farther] = d(w2) < d(wharf) ? [w2, wharf] : [wharf, w2];
  assert.ok(wharfBoat(game, nearest), 'the nearer wharf has the first boat');
  assert.equal(wharfBoat(game, farther), null);
});

test('Neptune\'s wrath sinks every fishing boat; the yard builds new ones', () => {
  const { game, yard, wharf } = fishingSetup();
  runFishingDays(game, 2 * CONFIG.SHIPYARD_BOAT_DAYS + 2);
  assert.ok(wharfBoat(game, wharf) && spareBoat(game, yard));
  assert.equal(sinkFishingBoats(game), 2);
  assert.equal(wharfBoat(game, wharf), null);
  runFishingDays(game, CONFIG.SHIPYARD_BOAT_DAYS + 2);
  assert.ok(wharfBoat(game, wharf), 'a new boat');
});

test('Insane winter: the fields rest but the boats still fish', () => {
  const { game, wharf } = fishingSetup({ difficulty: 'insane' });
  game.time.month = 0; // Ianuarius: winter
  runFishingDays(game, 60);
  assert.ok((wharf.catches || 0) > 0, 'catches landed in winter');
});

// ---------------------------------------------------------------------------
// Timber for the boats (Colonia's own rule: the original's boats cost nothing)
// ---------------------------------------------------------------------------

const BOAT_TIMBER = CONFIG.SHIPYARD_BOAT_TIMBER;

test('timber: a boat takes 100, used at launch and logged as used; the yard holds up to 200', () => {
  assert.equal(BOAT_TIMBER, 100);
  assert.equal(BUILDINGS.shipyard.inputCap, 2 * BOAT_TIMBER, 'two boats');
  assert.deepEqual(BUILDINGS.shipyard.inputs, ['timber']);
  const { game, yard } = fishingSetup({ timber: BOAT_TIMBER });
  assert.deepEqual(yard.incoming, { timber: 0 });
  runFishingDays(game, CONFIG.SHIPYARD_BOAT_DAYS - 1);
  assert.equal(yard.stock.timber, BOAT_TIMBER, 'nothing used while the boat is on the slip');
  runFishingDays(game, 1);
  assert.equal(yard.boatsBuilt, 1, 'day 16, as before');
  assert.equal(yard.stock.timber, 0, 'the lot went into the boat');
  assert.equal(game.city.goodsFlow.timber.used, BOAT_TIMBER, 'the Production advisor counts it as used');
  // The cap: a delivery fills it to 200 and no further.
  assert.equal(receiveGoods(yard, 'timber', 300), 2 * BOAT_TIMBER);
  assert.equal(yard.stock.timber, 2 * BOAT_TIMBER);
  assert.equal(receiveGoods(yard, 'timber', 100), 0, 'full');
  assert.equal(deliveryRoom(yard, 'timber'), 0);
  assert.equal(receiveGoods(yard, 'iron', 100), 0, 'timber only');
});

test('timber: with none the yard adds no progress; work waits for a whole boat\'s lot and is never lost', () => {
  const { game, yard, wharf } = fishingSetup({ timber: 0 });
  runFishingDays(game, 30);
  assert.equal(yard.progress, 0, 'no timber, no work');
  assert.equal(yard.boatsBuilt || 0, 0);
  yard.stock.timber = BOAT_TIMBER - 1;
  runFishingDays(game, 10);
  assert.equal(yard.progress, 0, 'less than a boat\'s lot is not enough');
  yard.stock.timber = BOAT_TIMBER;
  runFishingDays(game, 8);
  const half = yard.progress;
  assert.ok(half > 45 && half < 55, `half a boat in 8 days (${half})`);
  // The lot cannot leave the yard in play; if it did, the work would wait, not vanish.
  yard.stock.timber = 0;
  runFishingDays(game, 10);
  assert.equal(yard.progress, half, 'progress kept');
  yard.stock.timber = BOAT_TIMBER;
  runFishingDays(game, 9);
  assert.ok(wharfBoat(game, wharf), 'finished and sent on once the timber is back');
});

test('timber: two boats from 200 when two wharves want them; then the spare waits for timber', () => {
  const { game, yard, wharf, spots } = fishingSetup({ timber: 2 * BOAT_TIMBER });
  const w2 = placeOnShore(game, 'wharf', spots);
  w2.efficiency = 1;
  runFishingDays(game, 2 * CONFIG.SHIPYARD_BOAT_DAYS + 3);
  assert.ok(wharfBoat(game, wharf) && wharfBoat(game, w2), 'both wharves have a boat');
  assert.equal(yard.stock.timber, 0);
  runFishingDays(game, 40);
  assert.equal(spareBoat(game, yard), null, 'no spare without timber');
  assert.equal(yard.progress, 0);
  assert.equal(yard.boatsBuilt, 2);
});

test('timber: the walker cap keeps both the finished boat\'s progress and its timber', () => {
  const { game, yard } = fishingSetup({ timber: BOAT_TIMBER });
  yard.progress = 99.99;
  const fakes = [];
  for (let k = 0; game.walkers.size < CONFIG.MAX_WALKERS; k++) { const id = 1e9 + k; fakes.push(id); game.walkers.set(id, { id, dead: false }); }
  updateShipyard(game, yard);
  assert.ok(yard.progress >= 100, 'finished');
  assert.equal(spareBoat(game, yard), null, 'no room on the water for it yet');
  assert.equal(yard.stock.timber, BOAT_TIMBER, 'its timber still in the yard');
  for (const id of fakes) game.walkers.delete(id);
  updateShipyard(game, yard);
  assert.ok(spareBoat(game, yard), 'launched once there is room');
  assert.equal(yard.stock.timber, 0);
});

test('timber: Neptune\'s boats are replaced only as timber comes in', () => {
  const { game, yard, wharf } = fishingSetup({ timber: BOAT_TIMBER });
  runFishingDays(game, CONFIG.SHIPYARD_BOAT_DAYS + 2);
  assert.ok(wharfBoat(game, wharf));
  assert.equal(sinkFishingBoats(game), 1);
  runFishingDays(game, CONFIG.SHIPYARD_BOAT_DAYS * 2);
  assert.equal(wharfBoat(game, wharf), null, 'no timber, no new boat');
  yard.stock.timber = BOAT_TIMBER;
  runFishingDays(game, CONFIG.SHIPYARD_BOAT_DAYS + 2);
  assert.ok(wharfBoat(game, wharf), 'a new boat from the new lot');
});

/** A warehouse joined by road to the shipyard (its road tile), nearest first. */
function warehouseBy(game, yard) {
  const { map } = game;
  const spots = [];
  for (let y = 2; y < map.h - 5; y++) for (let x = 2; x < map.w - 5; x++) {
    const d = Math.hypot(x - yard.x, y - yard.y);
    if (d >= 4 && d < 16) spots.push({ x, y, d });
  }
  spots.sort((a, b) => a.d - b.d);
  const rx = map.xOf(yard.accessRoad);
  const ry = map.yOf(yard.accessRoad);
  for (const s of spots) {
    if (!checkBuilding(game, 'warehouse', s.x, s.y).ok || !build(game, 'warehouse', s.x, s.y).ok) continue;
    const wh = game.buildings.get(map.building[map.idx(s.x, s.y)]);
    for (const i of perimeterTiles(map, wh.x, wh.y, wh.size)) {
      if (map.road[i] || !map.isFree(map.xOf(i), map.yOf(i))) continue;
      if (build(game, 'road', map.xOf(i), map.yOf(i), rx, ry).ok) break;
    }
    game.processRoadChanges();
    if (wh.accessRoad >= 0 && game.pf.findNearest(wh.accessRoad, (id) => id === yard.id, 100, wh.id)) return wh;
    removeBuilding(game, wh, 'undo');
  }
  return null;
}

test('timber: carts bring it like a workshop\'s raw material, nearest first, up to 200 counting loads on their way', () => {
  const { game, yard } = fishingSetup({ timber: 0 });
  const wh = warehouseBy(game, yard);
  assert.ok(wh, 'a warehouse joined to the yard by road');
  wh.efficiency = 1;
  // A producer's cart (a timber yard's, a dock wagon) finds the shipyard before storage.
  const t = findDeliveryTarget(game, wh.accessRoad, 'timber', BOAT_TIMBER, wh.id);
  assert.equal(t && t.id, yard.id, 'timber goes to the shipyard first');
  // And a warehouse holding timber sends it, one cart a day, until the yard has 200 counting carts on the way.
  wh.stock.timber = 1000;
  let sent = 0;
  for (let d = 0; d < 40; d++) {
    const before = wh.stock.timber;
    updateWarehouseSupply(game, wh);
    sent += before - wh.stock.timber;
    assert.ok(yard.stock.timber + yard.incoming.timber <= 2 * BOAT_TIMBER, 'never more than 200 held and coming');
    for (let k = 0; k < TPD; k++) updateWalkers(game);
  }
  assert.equal(sent, 2 * BOAT_TIMBER, 'two cart loads');
  assert.equal(yard.stock.timber, 2 * BOAT_TIMBER, 'delivered');
  assert.equal(yard.incoming.timber, 0);
  const t2 = findDeliveryTarget(game, wh.accessRoad, 'timber', BOAT_TIMBER, 0);
  assert.notEqual(t2 && t2.id, yard.id, 'a full yard takes no more');
  // The same tier as the workshops: a carpenter with room counts too.
  const carpenter = new Building(9999, 'furniture_ws', 0, 0);
  assert.equal(rawHasRoom(carpenter, 'timber', BOAT_TIMBER), true);
  yard.stock.timber = BOAT_TIMBER;
  assert.equal(rawHasRoom(yard, 'timber', BOAT_TIMBER), true);
  assert.equal(rawHasRoom(yard, 'clay', BOAT_TIMBER), false);
});

test('timber: the panel and the Production advisor say what the yard lacks, and where to get it', () => {
  const { game, yard, wharf } = fishingSetup({ timber: 0 });
  yard.laborAccess = wharf.laborAccess = 1000; // workers found (labor is not what this is about)
  // A wharf waits for a boat: a warning, with the mission's sources.
  assert.deepEqual(buildingStatus(game, yard), { level: 'warn', text: 'Needs timber: build a Silva Caedua (Timber Yard) or buy timber.' });
  assert.equal(buildingStatus(game, wharf).text, 'Waiting for a boat: the shipyard has no timber. Build a Silva Caedua (Timber Yard) or buy timber.');
  game.city.goodsFlowLast = {};
  const report = productionReport(game);
  assert.ok(report.troubles.some((t) => t.name === 'Fabrica Navalis' && /^Needs timber/.test(t.text)), 'listed under troubles');
  assert.ok(report.hints.includes('A Fabrica Navalis is waiting for timber: build more Silvae Caeduae, or import from Tarraco.'), report.hints.join(' | '));
  // Timber on its way: nothing to ask for.
  yard.incoming.timber = BOAT_TIMBER;
  assert.doesNotMatch(buildingStatus(game, yard).text, /timber/);
  yard.incoming.timber = 0;
  // No partner sells timber (Paestum, Portus Mercatorum): fell it.
  game.scenario = { ...game.scenario, partners: ['massilia', 'corinthus'] };
  assert.equal(buildingStatus(game, yard).text, 'Needs timber: build a Silva Caedua (Timber Yard).');
  assert.ok(productionReport(game).hints.includes('A Fabrica Navalis is waiting for timber: build more Silvae Caeduae.'));
  // Every wharf has its boat: only the spare waits, said plainly, not as a trouble.
  yard.stock.timber = BOAT_TIMBER;
  runFishingDays(game, CONFIG.SHIPYARD_BOAT_DAYS + 2);
  assert.ok(wharfBoat(game, wharf));
  const s = buildingStatus(game, yard);
  assert.equal(s.level, '');
  assert.match(s.text, /^Needs timber for a spare boat \(every wharf on this water has one\)/);
  assert.ok(!productionReport(game).troubles.some((t) => t.name === 'Fabrica Navalis'));
  // A yard built before any wharf says so, rather than that every wharf has a boat.
  removeBuilding(game, wharf, 'demolish');
  assert.match(buildingStatus(game, yard).text, /^Needs timber for a spare boat \(no wharf on this water yet\)/);
  // A shipyard placed with no timber in sight warns; with a boat's worth in a yard already it does not.
  const spot = shoreSpots(game).find((p) => checkBuilding(game, 'shipyard', p.x, p.y).ok);
  assert.ok(checkBuilding(game, 'shipyard', spot.x, spot.y).warnings.some((w) => /^Shipyards need timber/.test(w)));
  yard.stock.timber = BOAT_TIMBER;
  assert.ok(!checkBuilding(game, 'shipyard', spot.x, spot.y).warnings.some((w) => /^Shipyards need timber/.test(w)));
});

test('timber: a save from before it (version 15) gives a yard with a boat started its 100 timber, the others none', () => {
  const { game, yard } = fishingSetup({ timber: 0 });
  const idle = placeOnShore(game, 'shipyard', shoreSpots(game));
  assert.ok(idle);
  yard.progress = 60;
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  data.version = 15;
  for (const b of data.buildings) if (b.type === 'shipyard') { b.stock = null; b.incoming = null; }
  const again = deserializeGame(data);
  const y2 = again.buildings.get(yard.id);
  const i2 = again.buildings.get(idle.id);
  assert.deepEqual([y2.stock, y2.incoming], [{ timber: BOAT_TIMBER }, { timber: 0 }], 'the boat on the slip keeps its wood');
  assert.deepEqual([i2.stock, i2.incoming], [{ timber: 0 }, { timber: 0 }]);
  y2.efficiency = 1;
  runFishingDays(again, 6);
  assert.equal(y2.boatsBuilt || 0, 0);
  runFishingDays(again, 1);
  assert.equal(y2.boatsBuilt, 1, 'launched on schedule (40% left: 6.4 days)');
  assert.equal(y2.stock.timber, 0);
  assert.equal(serializeGame(again).version, CONFIG.SAVE_VERSION);
});

// ---------------------------------------------------------------------------
// Fish as food, and the four guards
// ---------------------------------------------------------------------------

test('fish: a fifth food after the four land foods, stored in granaries, never in warehouses by default', () => {
  assert.deepEqual(FOOD_TYPES, [...LAND_FOODS, 'fish']);
  assert.equal(GOODS.fish.kind, 'food');
  assert.equal(BUILDINGS.wharf.produces, 'fish');
  const game = newGame();
  const g = new Building(1, 'granary', 0, 0);
  const w = new Building(2, 'warehouse', 0, 0);
  const m = new Building(3, 'market', 0, 0);
  assert.equal(g.stock.fish, 0);
  assert.equal(g.orders.fish, 'accept', 'granaries take fish');
  assert.equal(w.orders.fish, 'refuse', 'warehouses refuse food by default, fish too');
  assert.equal(m.stock.fish, 0, 'markets sell it');
  assert.deepEqual(game.city.trade.settings.fish, { mode: 'none', level: 400 });
});

test('guard: Mercury brings the four land foods and no fish', () => {
  assert.deepEqual(LAND_FOODS, ['wheat', 'vegetables', 'fruit', 'meat']);
});

test('guard: a market buyer never goes for fish while no storage holds any', () => {
  const game = newGame();
  const { map } = game;
  // A market and a granary with wheat, side by side on a road.
  let spot = null;
  for (let y = 4; y < map.h - 10 && !spot; y++) for (let x = 4; x < map.w - 10; x++) {
    let ok = true;
    for (let dy = 0; dy < 4 && ok; dy++) for (let dx = 0; dx < 7; dx++) if (!map.isFree(x + dx, y + dy) || map.terrain[map.idx(x + dx, y + dy)] === Terrain.TREES) { ok = false; break; }
    if (ok) spot = { x, y };
  }
  build(game, 'road', spot.x, spot.y + 3, spot.x + 6, spot.y + 3);
  build(game, 'market', spot.x, spot.y + 1);
  build(game, 'granary', spot.x + 4, spot.y + 1);
  const market = game.buildings.get(map.building[map.idx(spot.x, spot.y + 1)]);
  const granary = game.buildings.get(map.building[map.idx(spot.x + 3, spot.y)]);
  market.efficiency = 1;
  granary.efficiency = 1;
  for (const f of LAND_FOODS) market.stock[f] = CONFIG.MARKET_FOOD_CAP; // the land foods are full
  granary.stock.wheat = 400;
  updateMarketBuyer(game, market);
  const buyer = market.walkers.map((id) => game.walkers.get(id)).find((w) => w && w.type === 'buyer');
  assert.equal(buyer, undefined, 'no buyer out for fish nobody has');
  granary.stock.fish = 200;
  market.buyerCooldown = 0;
  updateMarketBuyer(game, market);
  const b2 = market.walkers.map((id) => game.walkers.get(id)).find((w) => w && w.type === 'buyer');
  assert.equal(b2 && b2.want, 'fish', 'with fish in store the buyer goes for it');
});

test('guard: the Emperor asks for fish only while a wharf is at work', () => {
  const pick = (game) => {
    const goods = new Set();
    for (let k = 0; k < 200; k++) {
      game.city.request = null;
      game.city.nextRequestMonth = 0;
      game.city.population = 2000;
      updateEmperor(game);
      if (game.city.request && game.city.request.kind === 'goods') goods.add(game.city.request.good);
    }
    return goods;
  };
  const { game, wharf } = fishingSetup();
  wharf.efficiency = 0;
  assert.equal(pick(game).has('fish'), false, 'no working wharf: never fish');
  wharf.efficiency = 1;
  assert.equal(pick(game).has('fish'), true, 'a working wharf: fish can be asked for');
});

test('guard: the capacity model ignores wharves and plans no hippodrome (its numbers do not move)', () => {
  for (const s of SCENARIOS) {
    const keys = unlockedBuildings(s);
    const without = { ...s, unlocks: [...keys].filter((k) => !['wharf', 'shipyard', 'hippodrome', 'chariot_maker'].includes(k)) };
    const a = missionCapacity(s);
    const b = missionCapacity(without);
    assert.deepEqual({ ...a, top: 0 }, { ...b, top: 0 }, `${s.id}: the same people and jobs with or without them`);
    assert.equal(bestEntertainment(keys) <= 80, true, `${s.id}: the model's venues stop at the colosseum`);
    // Only which levels a city could reach at all sees the hippodrome: the top one needs it.
    const hip = keys.has('hippodrome');
    assert.equal(HOUSE_TIERS[a.top].name === 'Imperial Palatium', hip && HOUSE_TIERS[b.top].name === 'Grand Palatium', `${s.id}: top level`);
  }
});

test('guard: a home\'s health still counts four kinds of food as "every kind"', () => {
  const base = { medicus: true, hospital: true, baths: true, barber: true, fountain: true, eats: true };
  assert.equal(healthLacks({ ...base, foods: 3 }).includes('food'), true);
  assert.equal(healthLacks({ ...base, foods: 4 }).includes('food'), false, 'four kinds were enough before fish, and still are');
});

// ---------------------------------------------------------------------------
// Unlocks and saves
// ---------------------------------------------------------------------------

test('unlocks: shipyard and wharf from mission 4; missions 5 and 6 have all but the hippodrome', () => {
  const byId = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
  const has = (s, k) => s.unlocks === 'all' || s.unlocks.includes(k);
  for (const id of ['c1', 'c2', 'c3']) assert.equal(has(byId[id], 'wharf'), false, `${id}: no wharf yet`);
  for (const id of ['c4', 'c5', 'c6', 'c7']) {
    assert.equal(has(byId[id], 'wharf'), true, `${id}: wharf`);
    assert.equal(has(byId[id], 'shipyard'), true, `${id}: shipyard`);
  }
  for (const id of ['c4', 'c5', 'c6']) {
    assert.equal(has(byId[id], 'hippodrome'), false, `${id}: no hippodrome`);
    assert.equal(has(byId[id], 'chariot_maker'), false, `${id}: no chariot maker`);
  }
  for (const id of ['c5', 'c6']) {
    // Nothing else they had under 'all' is lost: every building and tool
    // (mission 6's desert has no water a ship can sail, so no fleet there:
    // tests/navy.test.mjs).
    const navy = id === 'c6' ? [...NAVY_KEYS] : [];
    const lost = [...Object.keys(BUILDINGS)].filter((k) => !['hippodrome', 'hippodrome_part', 'chariot_maker', ...navy].includes(k) && !byId[id].unlocks.includes(k));
    assert.deepEqual(lost, [], `${id}: every other building`);
    for (const t of ['road', 'plaza', 'bridge', 'roadblock', 'aqueduct', 'wall', 'clear']) assert.ok(byId[id].unlocks.includes(t), `${id}: ${t}`);
  }
  assert.equal(byId.c7.unlocks, 'all');
  assert.equal(sandboxScenario().unlocks, 'all');
});

test('save: a version 7 city loads with no boats or fish and every food list extended', () => {
  const game = coastGame();
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  // Make it look like a v7 save: no fish anywhere, no hippodrome keys.
  const strip = (o) => { if (o && typeof o === 'object') { delete o.fish; delete o.hippodrome; } };
  for (const b of data.buildings) {
    strip(b.stock); strip(b.incoming); strip(b.orders); strip(b.shows);
    if (b.house) { strip(b.house.food); strip(b.house.ent); }
  }
  delete data.city.trade.settings.fish;
  data.version = 7;
  const again = deserializeGame(data);
  for (const b of again.buildings.values()) {
    if (b.house) { assert.equal(b.house.food.fish, 0); assert.equal(b.house.ent.hippodrome, 0); }
    if (b.def.kind === 'granary') { assert.equal(b.stock.fish, 0); assert.equal(b.orders.fish, 'accept'); }
    if (b.def.kind === 'warehouse') { assert.equal(b.stock.fish, 0); assert.equal(b.orders.fish, 'refuse'); }
  }
  assert.deepEqual(again.city.trade.settings.fish, { mode: 'none', level: 400 });
  again.runDays(20); // and it plays
});

test('save: boats, wharves and shipyards keep their state', () => {
  const { game, yard, wharf } = fishingSetup();
  runFishingDays(game, CONFIG.SHIPYARD_BOAT_DAYS + 5);
  const boat = wharfBoat(game, wharf);
  assert.ok(boat);
  const again = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  const w2 = again.buildings.get(wharf.id);
  const b2 = wharfBoat(again, w2);
  assert.ok(b2, 'the wharf still has its boat');
  assert.equal(b2.state, boat.state);
  assert.equal(b2.x, boat.x);
  assert.equal(again.buildings.get(yard.id).progress, yard.progress);
});

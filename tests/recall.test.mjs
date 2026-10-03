/**
 * recall.test.mjs - no new men while deployed, and the recall from a distant
 * battle (sim/battle.js takesNewMen, recallFromBattle; sim/military.js
 * updateDemand and updateBarracks; sim/navy.js updateNavalDemand and
 * updateNavalia): a deployed fort or one with men away takes no recruits (a
 * recruit already on his way still joins) until it is recalled and its men
 * are home; the same for Naval Stations and the Navalia; the rider's time
 * and the way home; what a recall does to the battle; saves with a rider out
 * (version 19) and from before it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { addBuilding } from '../src/sim/entities.js';
import { updateWalkers } from '../src/sim/walkers.js';
import { spawnUnit, updateBarracks, updateDemand, deployFort, recallFort } from '../src/sim/military.js';
import { shoreBerth, squadron, updateNavalia, updateNavalDemand, deployStation, recallStation } from '../src/sim/navy.js';
import {
  requestTroops, battleMonthly, sendTroops, setService, fightBattle, awayCounts, battleSummary,
  takesNewMen, riderMonths, recallFromBattle, recallBlocked, recallOf, awayUpkeep,
} from '../src/sim/battle.js';
import { battleLines, newMenNote, recallLines } from '../src/ui/empireInfo.js';
import { empireTravelers, travelerLabel } from '../src/ui/empireMap.js';
import { buildDemoCity, buildDemoNavy } from '../src/dev/demoCity.js';
import { removeBuilding } from '../src/sim/entities.js';
import { newGame, build, findFree } from './helpers.mjs';

log.setLevel('error');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A barracks and an empty legion fort on one straight road, both fully staffed. */
function barracksAndFort() {
  const game = newGame({ type: 'plains' });
  const s = findFree(game, 20, 6, { x: 32, y: 32 });
  assert.ok(s, 'room for a barracks and a fort');
  build(game, 'road', s.x, s.y + 3, s.x + 19, s.y + 3);
  const barracks = addBuilding(game, 'barracks', s.x, s.y);
  const fort = addBuilding(game, 'fort_legion', s.x + 15, s.y);
  game.processRoadChanges();
  for (const b of [barracks, fort]) {
    b.efficiency = 1;
    assert.ok(b.accessRoad >= 0, `${b.type} has a road`);
  }
  return { game, barracks, fort, s };
}

/** The barracks tries to send a recruit now (stocked, trained); returns the new walker or null. */
function tryRecruit(game, barracks) {
  barracks.stock.weapons = 100;
  barracks.trainProgress = 100;
  const before = new Set(game.walkers.keys());
  updateBarracks(game, barracks);
  return [...game.walkers.values()].find((w) => w.type === 'recruit' && !before.has(w.id)) || null;
}

/** A legion fort with `n` legionaries (`trained` of them trained) by it, its Empire service on. */
function fortWith(game, n, trained = 0) {
  const s = findFree(game, 3, 3, { x: 30, y: 30 });
  const fort = addBuilding(game, 'fort_legion', s.x, s.y);
  fort.efficiency = 1;
  for (let k = 0; k < n; k++) spawnUnit(game, fort.def.unit, s.x + 1.5, s.y + 3.5, { fort: fort.id, slot: k, state: 'idle', trained: k < trained });
  setService(game, fort, true);
  return fort;
}

/** Run until every soldier sent has left the province. */
function untilGone(game, max = 16 * 20) {
  for (let d = 0; d < max; d++) {
    if (![...game.units.values()].some((u) => u.away)) return d;
    game.runDays(1);
  }
  return -1;
}

/** Month changes only (the battle's clock). */
function months(game, n) {
  for (let k = 0; k < n; k++) {
    game.time.totalMonths++;
    battleMonthly(game);
  }
}

/**
 * Troops sent to Saguntum (7 months' march; its enemy 8 months off) and gone
 * from the province, the clock set back so the march starts now: the battle
 * in 24 months, the troops 7 months off. One fort per entry of `forts`.
 */
function marching({ forts = [[8, 8]], enemy = 16 } = {}) {
  const game = newGame();
  const posts = forts.map(([n, t]) => fortWith(game, n, t));
  requestTroops(game, 'saguntum', enemy);
  assert.ok(sendTroops(game).ok);
  assert.ok(untilGone(game) >= 0, 'all left the province');
  const b = game.military.battle;
  b.due = game.time.totalMonths + CONFIG.BATTLE_MONTHS;
  b.sent.march = 7;
  b.sent.toGo = 7;
  return { game, posts, b };
}

const atFort = (game, fort) => [...game.units.values()].filter((u) => u.fort === fort.id);

// ---------------------------------------------------------------------------
// No new men while deployed
// ---------------------------------------------------------------------------

test('a deployed fort takes no recruits; one already on his way still joins; recalled, it takes them again', () => {
  const { game, barracks, fort, s } = barracksAndFort();
  updateDemand(game);
  assert.equal(game.military.demand.weapons, 50 * 8, 'an empty fort wants weapons for 8');
  const w = tryRecruit(game, barracks);
  assert.ok(w, 'a recruit sets out');
  deployFort(game, fort.id, s.x + 10, s.y + 5);
  assert.equal(takesNewMen(game, fort), false);
  assert.match(newMenNote(game, fort), /^No recruits while deployed/);
  updateDemand(game);
  assert.equal(game.military.demand.weapons, 0, 'no weapons wanted for a deployed fort');
  assert.equal(tryRecruit(game, barracks), null, 'no second recruit');
  assert.match(barracks.blocked, /No recruits while deployed/);
  for (let t = 0; t < 4000 && !w.dead; t++) updateWalkers(game);
  assert.ok(w.dead, 'he reached the fort');
  assert.equal(atFort(game, fort).length, 1, 'and joined it, deployed or not');
  recallFort(game, fort.id);
  assert.equal(takesNewMen(game, fort), true);
  assert.equal(newMenNote(game, fort), '');
  updateDemand(game);
  assert.equal(game.military.demand.weapons, 50 * 7);
  assert.ok(tryRecruit(game, barracks), 'recruiting resumes');
});

test('a fort with men away at a distant battle takes no recruits until they are all home', () => {
  const game = newGame();
  const fort = fortWith(game, 4, 4); // 12 against 10
  requestTroops(game, 'placentia', 10);
  sendTroops(game);
  updateDemand(game);
  assert.equal(game.military.demand.weapons, 0, 'none while they march out through the province');
  assert.match(newMenNote(game, fort), /away at a distant battle/);
  untilGone(game);
  updateDemand(game);
  assert.equal(game.military.demand.weapons, 0, 'none while they are away');
  const b = game.military.battle;
  b.sent.toGo = 1;
  fightBattle(game);
  assert.equal(b.outcome, 'won');
  updateDemand(game);
  assert.equal(game.military.demand.weapons, 0, 'none while the survivors come home');
  months(game, b.homeIn);
  assert.equal(game.military.battle, null);
  const back = atFort(game, fort).length;
  assert.ok(back > 0 && back < 8);
  updateDemand(game);
  assert.equal(game.military.demand.weapons, 50 * (8 - back), 'home: the empty places are filled again');
});

/** A coastal city with a Naval Station and a stocked Navalia, both staffed. */
function fleetCity() {
  const game = newGame({ type: 'coast', size: 64, seed: 'demo' });
  const res = buildDemoCity(game, { level: 2 });
  assert.ok(res.ok, res.reason);
  const nv = buildDemoNavy(game, res.center, { stock: true });
  assert.ok(nv.ok, 'navy placed');
  nv.station.efficiency = 1;
  nv.navalia.efficiency = 1;
  return { game, station: nv.station, navalia: nv.navalia };
}

test('a deployed station, or one with a ship away, gets no new liburnians from the Navalia; recalled and home, it does', () => {
  const { game, station, navalia } = fleetCity();
  updateNavalDemand(game);
  assert.ok(game.military.navalDemand.timber > 0, 'empty berths want timber');
  const berth = shoreBerth(game, station);
  assert.ok(deployStation(game, station.id, game.map.xOf(berth), game.map.yOf(berth)));
  assert.match(newMenNote(game, station), /^No recruits while deployed: the Navalia sends no new liburnians/);
  updateNavalDemand(game);
  assert.equal(game.military.navalDemand.timber, 0, 'no timber wanted for a deployed squadron');
  const progress = navalia.progress || 0;
  updateNavalia(game, navalia);
  assert.match(navalia.blocked, /No new liburnians while deployed/);
  assert.equal(navalia.progress || 0, progress, 'no work on a ship nobody takes');
  recallStation(game, station.id);
  updateNavalDemand(game);
  assert.ok(game.military.navalDemand.timber > 0);
  let days = 0;
  while (squadron(game, station.id).length === 0 && days < 60) { updateNavalia(game, navalia); days++; }
  assert.equal(squadron(game, station.id).length, 1, 'recalled: a ship is launched for it');
  // A ship of it on its way out to a distant battle: no new ships again.
  const [ship] = squadron(game, station.id);
  ship.away = true;
  assert.equal(takesNewMen(game, station), false);
  updateNavalDemand(game);
  assert.equal(game.military.navalDemand.timber, 0);
  updateNavalia(game, navalia);
  assert.match(navalia.blocked, /No new liburnians while deployed/);
});

// ---------------------------------------------------------------------------
// The recall
// ---------------------------------------------------------------------------

test('the rider: half the months marched, rounded up, at least one', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 8].map(riderMonths), [1, 1, 1, 2, 2, 3, 4]);
});

test('recall, worked example: 4 months out, the rider takes 2, they turn 6 months out and are home 6 months later', () => {
  const { game, posts: [fort], b } = marching();
  assert.match(recallBlocked(game, fort.id), /^$/);
  months(game, 4);
  assert.equal(b.sent.toGo, 3, '4 months marched');
  const res = recallFromBattle(game, fort.id);
  assert.ok(res.ok);
  assert.deepEqual([res.turned, res.rider], [0, 2], 'all gone: a rider, 2 months');
  assert.match(recallBlocked(game, fort.id), /already/);
  assert.equal(b.sent.men.length, 8, 'they still march with the army');
  assert.equal(b.sent.strength, 24, 'and still count');
  months(game, 1);
  assert.equal(recallOf(game, fort.id).rider, 1);
  assert.equal(b.sent.men.length, 8);
  months(game, 1);
  const r = recallOf(game, fort.id);
  assert.equal(r.rider, 0, 'the rider has reached them');
  assert.equal(b.sent.toGo, 1, 'they had marched on to the city meanwhile');
  assert.equal(r.homeIn, 6, 'home after the 6 months they had marched');
  assert.equal(b.sent.men.length, 0, 'no longer with the army');
  assert.equal(b.sent.strength, 0, 'nor in its strength');
  assert.equal(r.men.length, 8);
  assert.equal(awayCounts(game).get(fort.id), 8, 'their places still kept');
  assert.equal(awayUpkeep(game), 8 * 2, 'and they are still paid');
  assert.equal(takesNewMen(game, fort), false, 'no recruits until they are home');
  assert.ok(game.messages.some((m) => /rider has reached the troops/.test(m.text)));
  months(game, 5);
  assert.equal(atFort(game, fort).length, 0, 'a month to go');
  months(game, 1);
  const back = atFort(game, fort);
  assert.equal(back.length, 8, 'home');
  assert.ok(back.every((u) => u.trained && !u.away));
  assert.equal(new Set(back.map((u) => u.slot)).size, 8);
  assert.equal(recallOf(game, fort.id), null);
  assert.equal(takesNewMen(game, fort), true, 'recruiting resumes');
});

test('recall before the battle: the rest fight alone, and too few lose; recalling everyone counts as nobody sent', () => {
  // Two forts of 8 trained legionaries: 48 against 30. One recalled: 24 < 30.
  const { game, posts: [a, bFort], b } = marching({ forts: [[8, 8], [8, 8]], enemy: 30 });
  months(game, 2);
  recallFromBattle(game, a.id);
  months(game, recallOf(game, a.id).rider);
  assert.equal(b.sent.strength, 24);
  assert.equal(battleSummary(game).sent.men, 8);
  game.city.ratings.favor = 50;
  b.sent.toGo = 1; // (there in time)
  b.due = game.time.totalMonths + 1;
  months(game, 1);
  assert.equal(b.outcome, 'weak', 'too weak without the recalled fort');
  assert.equal(game.city.ratings.favor, 40);
  assert.equal(game.military.stats.soldiersLost, 8, 'only the men still with the army are lost');
  assert.equal(recallOf(game, a.id).men.length, 8, 'the recalled ones march on home');
  months(game, recallOf(game, a.id).homeIn);
  assert.equal(atFort(game, a).length, 8);
  assert.equal(atFort(game, bFort).length, 0);

  // Everyone recalled: -50, as if none had been sent (never cheaper than staying home).
  const all = marching({ enemy: 10 });
  months(all.game, 1);
  recallFromBattle(all.game, all.posts[0].id);
  months(all.game, recallOf(all.game, all.posts[0].id).rider);
  assert.match(battleLines(all.game, battleSummary(all.game)).map((l) => l.text).join(' '), /called all your troops back/);
  all.game.city.ratings.favor = 60;
  all.b.due = all.game.time.totalMonths + 1;
  months(all.game, 1);
  assert.equal(all.b.outcome, 'none');
  assert.equal(all.game.city.ratings.favor, 10);
  assert.ok(all.game.messages.some((m) => /You called all your troops back/.test(m.text)));
});

test('a rider who comes after the battle is too late: his men fight with the rest and come home by the battle\'s rule', () => {
  const { game, posts: [fort], b } = marching({ enemy: 16 }); // 24 against 16: a win, 25% lost
  months(game, 6);
  b.due = game.time.totalMonths + 2;
  const res = recallFromBattle(game, fort.id); // 6 marched: 3 months' ride, the battle in 2
  assert.equal(res.rider, 3);
  assert.match(game.messages[0].text, /after the battle/);
  assert.match(recallLines(battleSummary(game).recalls, 2)[0].text, /after the battle/);
  months(game, 2);
  assert.equal(b.outcome, 'won');
  assert.equal(recallOf(game, fort.id), null, 'the order is void');
  assert.equal(b.sent.men.length, 6, 'they fought: 2 of 8 fell');
  assert.ok(game.messages.some((m) => /did not reach the troops/.test(m.text)));
  assert.equal(b.homeIn, 6, 'home by the battle\'s rule: the months they had marched');
});

test('a rider reaching them in the battle\'s own month turns them in time', () => {
  const { game, posts: [fort], b } = marching({ enemy: 16 });
  months(game, 2); // 2 marched: a 1-month ride
  b.due = game.time.totalMonths + 1;
  recallFromBattle(game, fort.id);
  months(game, 1);
  assert.equal(b.outcome, 'none', 'nobody left at the battle');
  assert.equal(recallOf(game, fort.id).men.length, 8);
});

test('sent troops leave the province at once, with their places kept', () => {
  const game = newGame();
  const fort = fortWith(game, 4, 0);
  requestTroops(game, 'placentia', 6);
  assert.ok(sendTroops(game).ok);
  assert.equal(atFort(game, fort).length, 0, 'none walk to the edge first');
  assert.equal(game.military.battle.sent.men.length, 4);
  assert.equal(takesNewMen(game, fort), false);
});

test('men still in the province (a save from before they left at once) turn back at once, with no rider, and no longer count', () => {
  const game = newGame({ type: 'plains' }); // (a long way to the exit: they follow a route there)
  const fort = fortWith(game, 4, 0);
  requestTroops(game, 'placentia', 6);
  sendTroops(game);
  const b = game.military.battle;
  // As an older save had them: back on the map, on their way to the exit.
  for (const rec of b.sent.men.splice(0)) {
    spawnUnit(game, rec.type, fort.x + 1.5, fort.y + 3.5, { fort: fort.id, slot: rec.slot, state: 'away', away: true, awayTick: game.time.totalTicks });
  }
  game.runDays(3);
  const leaving = [...game.units.values()].filter((u) => u.away);
  assert.equal(leaving.length, 4, 'still on their way out');
  const res = recallFromBattle(game, fort.id);
  assert.deepEqual([res.turned, res.rider], [4, 0]);
  assert.equal(recallOf(game, fort.id), null);
  assert.ok(atFort(game, fort).every((u) => !u.away));
  assert.equal(b.sent.strength, 0);
  assert.match(recallBlocked(game, fort.id), /None of its men/);
  assert.equal(takesNewMen(game, fort), true, 'back in the province: recruits may come again');
  // They walk home from where they are, not on along their way to the exit.
  const ex = game.map.exit;
  const toExit = () => Math.min(...atFort(game, fort).map((u) => Math.hypot(u.x - ex.x - 0.5, u.y - ex.y - 0.5)));
  const before = toExit();
  game.runDays(3);
  assert.ok(toExit() > before, `farther from the exit after turning (${before.toFixed(1)} to ${toExit().toFixed(1)})`);
});

test('the recall of a station speaks of its liburnians, not men', () => {
  const r = { post: 1, name: 'Statio', city: 'saguntum', cityName: 'Saguntum', march: 7, rider: 2, riderTotal: 2, homeIn: 0, homeTotal: 0, men: 0, ships: 3 };
  assert.match(recallLines([r])[0].text, /to the 3 liburnians of the Statio/);
  assert.match(recallLines([{ ...r, rider: 0, homeIn: 4 }])[0].text, /3 liburnians of the Statio on the way home, 4 months/);
});

test('the empire map shows the rider riding out, then the recalled troops coming home', () => {
  const { game, posts: [fort] } = marching();
  months(game, 4);
  recallFromBattle(game, fort.id);
  let t = empireTravelers(game);
  const rider = t.find((x) => x.kind === 'rider');
  assert.ok(rider, 'the rider is on the map');
  assert.match(travelerLabel(rider), /A rider carrying your recall to the troops of the .+: he reaches them in 2 months/);
  const troops = t.find((x) => x.kind === 'troops');
  assert.ok(troops && !troops.home, 'his men still marching on');
  months(game, 2);
  t = empireTravelers(game);
  assert.equal(t.filter((x) => x.kind === 'rider').length, 0);
  const home = t.find((x) => x.kind === 'troops' && x.home);
  assert.ok(home, 'turned back');
  assert.match(travelerLabel(home), /Recalled troops of the .+ coming home: 6 months/);
  assert.equal(t.filter((x) => x.kind === 'troops' && !x.home).length, 0, 'nobody left marching on');
});

test('a fort lost while a rider is out: its men are released and the order dropped', () => {
  const { game, posts: [fort], b } = marching();
  months(game, 3);
  recallFromBattle(game, fort.id);
  removeBuilding(game, fort);
  assert.equal(recallOf(game, fort.id), null);
  assert.equal(b.sent.men.length, 0);
  months(game, 3);
  assert.equal(game.military.recalls.length, 0);
});

// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

test('save: a rider out and men coming home survive a save and carry on', () => {
  const { game, posts: [a, bFort] } = marching({ forts: [[8, 8], [6, 0]] });
  months(game, 2);
  recallFromBattle(game, a.id);
  months(game, 1); // (2 marched: a 1-month ride) a's men turned
  months(game, 2);
  recallFromBattle(game, bFort.id); // 5 marched: a 3-month ride
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  assert.ok(data.version >= 19, 'recalls came with version 19');
  const copy = deserializeGame(data);
  assert.deepEqual(copy.military.recalls, game.military.recalls);
  assert.equal(recallOf(copy, bFort.id).rider, 3);
  assert.ok(recallOf(copy, a.id).homeIn > 0);
  for (const g of [game, copy]) months(g, 3);
  assert.deepEqual(copy.military.recalls, game.military.recalls, 'the same from there on');
  assert.equal(recallOf(copy, bFort.id).rider, 0, 'the rider reached them after the load');
  assert.equal(atFort(copy, a).length, 8, 'the first fort\'s men are home');
});

test('save: an older save (version 16) with troops away loads with no rider out, and they can be recalled', () => {
  const { game, posts: [fort] } = marching();
  months(game, 2);
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  data.version = 16;
  delete data.military.recalls;
  const copy = deserializeGame(data);
  assert.deepEqual(copy.military.recalls, []);
  assert.equal(copy.military.battle.sent.men.length, 8);
  assert.ok(recallFromBattle(copy, fort.id).ok);
  assert.equal(recallOf(copy, fort.id).rider, 1);
});

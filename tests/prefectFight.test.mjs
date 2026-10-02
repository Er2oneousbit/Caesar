/**
 * prefectFight.test.mjs - prefects against raiders and Caesar's legionaries (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Covers sim/prefectFight.js: a prefect on his rounds fights an enemy within
 * reach and not one farther off; fires come first; he goes back to his
 * rounds when the enemy leaves; the enemy strikes back and can kill him; his
 * prefecture sends the next after its usual delay; one message for several
 * falling together; his kills count for the raid and the legion; ships are
 * out of reach; a save made mid-fight loads and the fight goes on; his panel
 * says he is fighting; and a warband still does real damage to a town with
 * prefectures and no soldiers.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { addBuilding, spawnWalker } from '../src/sim/entities.js';
import { spawnUnit, updateMilitary, launchInvasion } from '../src/sim/military.js';
import { updateWalkers } from '../src/sim/walkers.js';
import { startRoaming } from '../src/sim/movement.js';
import { updatePrefectFights, prefectFoe } from '../src/sim/prefectFight.js';
import { updateServiceSpawns } from '../src/sim/services.js';
import { igniteBuilding } from '../src/sim/risk.js';
import { walkerDoing, walkerSays, walkerInfo } from '../src/ui/walkerTalk.js';
import { buildDemoCity } from '../src/dev/demoCity.js';
import { Terrain } from '../src/world/map.js';
import { newGame, build, findFree } from './helpers.mjs';

log.setLevel('error');

/** A long east-west road on open land, a raid in progress (so its raiders stay), and a prefect on his rounds. */
function street(len = 24) {
  const game = newGame({ size: 96, type: 'plains', seed: 'prefect-save' });
  const spot = findFree(game, len + 2, 9);
  assert.ok(spot, 'room for a street');
  const y = spot.y + 4;
  const x0 = spot.x + 1;
  assert.ok(build(game, 'road', x0, y, x0 + len - 1, y).ok, 'road built');
  const inv = { id: 7, origin: { x: 1, y: 1 }, size: 2, killed: 0, buildingsLost: 0, startDay: 0, fleeing: false, reached: false };
  game.military.active = inv;
  const p = spawnWalker(game, 'prefect', game.map.idx(x0 + 8, y), null, {});
  startRoaming(game, p, 0);
  p.roamLeft = 400;
  return { game, x0, y, inv, p };
}

/** A raider of the raid, `dx`, `dy` tiles from the middle of the prefect's tile. */
function raiderNear(game, p, dx, dy, inv, type = 'raider') {
  return spawnUnit(game, type, p.x + 0.5 + dx, p.y + 0.5 + dy, { invasion: inv.id, state: 'advance' });
}

/** The tick's order (core/game.js): walkers, units, then prefects' fights. */
function tick(game, n = 1) {
  for (let t = 0; t < n; t++) {
    game.time.totalTicks++;
    updateWalkers(game);
    updateMilitary(game);
    updatePrefectFights(game);
  }
}

test('a prefect on his rounds fights an enemy within 2 tiles, and not one 6 tiles away', () => {
  const { game, p, inv } = street();
  const far = raiderNear(game, p, 0, 6, inv);
  updatePrefectFights(game);
  assert.ok(!p.fight, 'no fight with a raider 6 tiles off');
  assert.ok(!p.held, 'he walks on');
  assert.equal(far.hp, far.maxHp);

  const near = raiderNear(game, p, 1.5, 0.5, inv);
  updatePrefectFights(game);
  assert.equal(p.fight, near.id, 'he fights the raider in reach');
  assert.equal(p.held, 1, 'standing his ground');
  assert.equal(p.hp, CONFIG.PREFECT_COMBAT.hp, 'his health is set as the fight starts');
  assert.ok(near.hp < near.maxHp, 'his first blow lands');
  assert.equal(near.foe, p.id, 'the raider turns on him');
  assert.equal(far.hp, far.maxHp, 'the far one is untouched');
});

test('a prefect hits about a third as hard as a legionary', () => {
  const c = CONFIG.PREFECT_COMBAT;
  assert.ok(c.attack > 0 && c.attack <= 14 / 2 && c.attack >= 14 / 4, `attack ${c.attack}`);
  assert.ok(c.hp > 0 && c.hp < 110 / 2, `hp ${c.hp}`);
});

test('a prefect running to a fire ignores enemies; a fire pulls one out of a fight', () => {
  const { game, p, inv, x0, y } = street();
  const runner = spawnWalker(game, 'prefect', game.map.idx(x0 + 16, y), null, { state: 'toFire' });
  const r = raiderNear(game, runner, 1, 0.5, inv);
  updatePrefectFights(game);
  assert.ok(!runner.fight, 'a prefect on his way to a fire does not stop');
  assert.equal(r.hp, r.maxHp);

  const r2 = raiderNear(game, p, -1, 0.5, inv);
  updatePrefectFights(game);
  assert.equal(p.fight, r2.id, 'fighting');
  // A fire beside the street: the nearest prefect not on fire duty is sent.
  runner.state = 'extinguish';
  const home = addBuilding(game, 'house', p.x - 3, y + 1, 1);
  Object.assign(home.house, { tier: 3, pop: 9 });
  igniteBuilding(game, home, 'fire');
  assert.equal(p.state, 'toFire', 'sent to the fire');
  updatePrefectFights(game);
  assert.ok(!p.fight, 'the fight is dropped: fires come first');
  r2.hp = r2.maxHp; // (alive for the next tick, whatever the blow did)
  tick(game);
  assert.notEqual(r2.foe, p.id, 'the raider lets him go on his next turn');
});

test('he fights while the enemy stays in reach, waits on the leash, and goes back to his rounds once it leaves', () => {
  const { game, p, inv } = street();
  const r = raiderNear(game, p, 1.5, 0.5, inv);
  updatePrefectFights(game);
  assert.equal(p.fight, r.id);
  // Between reach and leash: still his fight, but no blow lands from there.
  r.x = p.x + 0.5 + 2.6;
  r.y = p.y + 0.5;
  p.fightCd = 0;
  const hp = r.hp;
  updatePrefectFights(game);
  assert.equal(p.fight, r.id, 'still on the leash');
  assert.equal(r.hp, hp, 'out of reach: no blow');
  // Gone beyond the leash: back to his rounds, and he walks on.
  r.x = p.x + 0.5 + CONFIG.PREFECT_FIGHT_LEASH + 1;
  updatePrefectFights(game);
  assert.ok(!p.fight, 'fight over');
  const start = `${p.x},${p.y}`;
  for (let t = 0; t < 40; t++) { game.time.totalTicks++; updateWalkers(game); }
  assert.notEqual(`${p.x},${p.y}`, start, 'walking his rounds again');
  assert.equal(p.state, 'roam');
});

test('the enemy strikes back; a prefect can die, and his prefecture sends the next only after its spawn delay', () => {
  const { game, p, inv, x0, y } = street();
  const pre = addBuilding(game, 'prefecture', x0 + 2, y + 1);
  game.processRoadChanges();
  assert.ok(pre.accessRoad >= 0, 'prefecture on the road');
  pre.efficiency = 1;
  pre.spawnTimer = 0;
  // Make p his prefecture's prefect.
  p.origin = pre.id;
  pre.walkers.push(p.id);
  const r = raiderNear(game, p, 1, 0.5, inv);
  tick(game, 1);
  assert.equal(p.fight, r.id);
  r.hp = r.maxHp = 1e6; // the raider will not fall first
  for (let t = 0; t < 400 && game.walkers.has(p.id); t++) tick(game, 1);
  assert.ok(!game.walkers.has(p.id), 'the prefect was killed');
  assert.equal(game.military.stats.prefectsLost, 1, 'counted in the military stats');
  assert.ok(!pre.walkers.includes(p.id));
  assert.ok(!r.foe, 'the raider goes back to the buildings');
  assert.equal(pre.spawnTimer, pre.def.spawnDays, 'the prefecture waits its usual delay');
  const prefects = () => [...game.walkers.values()].filter((w) => w.type === 'prefect' && w.origin === pre.id).length;
  for (let d = 1; d < pre.def.spawnDays; d++) {
    updateServiceSpawns(game, pre);
    assert.equal(prefects(), 0, `no new prefect on day ${d}`);
  }
  updateServiceSpawns(game, pre);
  assert.equal(prefects(), 1, 'a new prefect sets out after the delay');
  assert.equal(game.messages.filter((m) => /prefects/.test(m.text)).length, 0, 'one prefect falling makes no message');
});

test('several prefects falling close together make one message, not one each', () => {
  const { game, p, inv, x0, y } = street();
  const others = [12, 14].map((dx) => spawnWalker(game, 'prefect', game.map.idx(x0 + dx, y), null, { state: 'roam', roamLeft: 400 }));
  const all = [p, ...others];
  for (const w of all) {
    const r = raiderNear(game, w, 1, 0.5, inv);
    r.hp = r.maxHp = 1e6;
    w.hp = 1;
  }
  const before = game.messages.length;
  for (let t = 0; t < 200 && all.some((w) => game.walkers.has(w.id)); t++) tick(game, 1);
  assert.ok(all.every((w) => !game.walkers.has(w.id)), 'all three fell');
  assert.equal(game.military.stats.prefectsLost, 3);
  const said = game.messages.slice(before).filter((m) => /prefects/.test(m.text));
  assert.equal(said.length, 1, `one message (${said.map((m) => m.text).join(' | ')})`);
  assert.match(said[0].text, /Raiders have killed 2 prefects/);
});

test('kills by prefects count toward the raid and the legion; ships are out of reach', () => {
  const { game, p, inv } = street();
  const r = raiderNear(game, p, 1, 0.5, inv);
  r.hp = 1;
  updatePrefectFights(game);
  assert.ok(!game.units.has(r.id), 'the raider fell');
  assert.equal(inv.killed, 1, "counted in the raid's slain");
  assert.equal(game.military.stats.enemiesKilled, 1);

  // One of Caesar's legionaries.
  const cs = game.military.caesar;
  cs.army = { id: 3, size: 1, killed: 0, day: 0, halted: false, retreating: false, campDays: 0, buildingsLost: 0 };
  const leg = spawnUnit(game, 'imperial', p.x + 1.5, p.y + 0.5, { legion: 3, state: 'advance' });
  leg.hp = 1;
  p.fightCd = 0;
  updatePrefectFights(game);
  assert.ok(!game.units.has(leg.id), 'the legionary fell');
  assert.equal(cs.army.killed, 1, "counted in the legion's slain");

  // A raider ship beside the street (its crew aboard): no fight.
  const ship = spawnUnit(game, 'raider_ship', p.x + 1.5, p.y + 0.5, { invasion: inv.id, crew: ['raider'] });
  p.fightCd = 0;
  updatePrefectFights(game);
  assert.ok(!p.fight, 'a ship is out of reach');
  assert.equal(ship.hp, ship.maxHp);
});

test('a prefect strikes once every cooldown ticks, as a soldier does', () => {
  const { game, p, inv } = street();
  const r = raiderNear(game, p, 1, 0.5, inv);
  r.hp = r.maxHp = 1e6;
  const blows = [];
  for (let t = 0; t < 100; t++) {
    const hp = r.hp;
    updatePrefectFights(game);
    if (r.hp < hp) blows.push(t);
  }
  const gaps = blows.slice(1).map((t, k) => t - blows[k]);
  assert.ok(gaps.length >= 3 && gaps.every((g) => g === CONFIG.PREFECT_COMBAT.cooldown), `blows at ${blows.join(', ')}`);
});

test('no fight across water, nor with a fleeing warband or a halted legion', () => {
  const { game, p, inv } = street();
  // Water between: a raider 2 tiles off, beyond a strip of river.
  const i = game.map.idx(p.x, p.y + 1);
  game.map.terrain[i] = Terrain.WATER;
  const across = raiderNear(game, p, 0, 2, inv);
  updatePrefectFights(game);
  assert.ok(!p.fight, 'not across water');
  assert.equal(across.hp, across.maxHp);
  game.map.terrain[i] = Terrain.GRASS;
  updatePrefectFights(game);
  assert.equal(p.fight, across.id, 'with the water gone he fights');

  // The warband breaks and flees: he lets it go.
  inv.fleeing = true;
  updatePrefectFights(game);
  assert.ok(!p.fight, 'a fleeing raider is let go');

  // Caesar's men: halted, he leaves them be; attacking, he fights.
  game.military.active = null;
  const cs = game.military.caesar;
  cs.army = { id: 4, size: 1, killed: 0, day: 0, halted: true, retreating: false, campDays: 0, buildingsLost: 0 };
  across.hp = 0;
  game.units.delete(across.id);
  const leg = spawnUnit(game, 'imperial', p.x + 1.5, p.y + 0.5, { legion: 4, state: 'halt' });
  updatePrefectFights(game);
  assert.ok(!p.fight, 'a halted army is left alone');
  cs.army.halted = false;
  updatePrefectFights(game);
  assert.equal(p.fight, leg.id, 'an attacking one is fought');
});

test('the panel says he is fighting', () => {
  const { game, p, inv } = street();
  const r = raiderNear(game, p, 1, 0.5, inv);
  updatePrefectFights(game);
  assert.equal(prefectFoe(game, p), r);
  assert.equal(walkerDoing(game, p), 'Fighting a raider');
  assert.equal(walkerSays(game, p), 'Fighting a raider!');
  assert.ok(walkerInfo(game, p).rows.some(([k]) => k === 'Health'), 'his health shows');
});

test('a save made mid-fight loads, and the fight goes on', () => {
  const { game, p, inv } = street();
  const r = raiderNear(game, p, 1, 0.5, inv);
  r.hp = r.maxHp = 1e6;
  tick(game, 30);
  assert.equal(p.fight, r.id);
  assert.ok(p.hp < CONFIG.PREFECT_COMBAT.hp, 'he has been hurt');
  const data = JSON.parse(JSON.stringify(serializeGame(game)));
  const copy = deserializeGame(data);
  const p2 = copy.walkers.get(p.id);
  const r2 = copy.units.get(r.id);
  assert.equal(p2.fight, r.id, 'his fight is kept');
  assert.equal(p2.hp, p.hp, 'and his wounds');
  assert.equal(r2.foe, p.id, "and the raider's");
  const hp = r2.hp;
  const pos = `${p2.x},${p2.y}`;
  tick(copy, 40);
  assert.ok(r2.hp < hp, 'he keeps striking');
  assert.ok(!copy.walkers.has(p2.id) || p2.hp < p.hp, 'and keeps being struck');
  if (copy.walkers.has(p2.id)) assert.equal(`${p2.x},${p2.y}`, pos, 'standing his ground');
});

test('prefects slow a warband without stopping it: 10 raiders still do real damage to a town with prefectures and no soldiers', () => {
  const game = newGame();
  assert.ok(buildDemoCity(game, { level: 2 }).ok);
  game.runDays(16 * 6);
  const prefectures = [...game.buildings.values()].filter((b) => b.type === 'prefecture').length;
  assert.ok(prefectures >= 3, `prefectures ${prefectures}`);
  launchInvasion(game, null, 10);
  for (let d = 0; d < 200 && game.military.active; d++) game.runDays(1);
  const st = game.military.stats;
  assert.equal(game.military.active, null, 'the raid is over');
  assert.ok(st.buildingsLost >= 8, `buildings lost ${st.buildingsLost}`);
  assert.ok(st.repelled === 0, 'not repelled by prefects alone');
});

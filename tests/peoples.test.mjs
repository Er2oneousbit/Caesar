/**
 * peoples.test.mjs - who raids a province, with what, and how they fight (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Covers data/peoples.js and its rules in sim/military.js: each people's
 * new kinds of warrior and their stats (and their order against a legionary,
 * which is the original's); which people raids each mission and each site,
 * the sandbox keeping the generic band unless asked; a warband's mix, and
 * its size held to the generic band's strength; breaking at the people's
 * losses; going for the people's targets; missile men striking walkers in a
 * city with few soldiers; an elephant's hide; the people named in messages;
 * and the people kept by a save, an older save's raid staying generic.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { Game } from '../src/core/game.js';
import { serializeGame, deserializeGame } from '../src/core/save.js';
import { UNIT_TYPES } from '../src/data/units.js';
import { PEOPLES, PEOPLE_BY_MISSION, PEOPLE_BY_SITE, GENERIC_PEOPLE } from '../src/data/peoples.js';
import { SITES, SANDBOX_SITES } from '../src/data/sites.js';
import { SCENARIOS, findScenario, sandboxScenario, withDifficulty } from '../src/data/scenarios.js';
import { addBuilding, spawnWalker } from '../src/sim/entities.js';
import {
  peopleFor, warbandType, peopleSize, peopleStrength, launchInvasion, spawnUnit, updateMilitary, militaryDaily,
  missileDamage, raidTargets, computeField, raidPeople,
} from '../src/sim/military.js';
import { Terrain } from '../src/world/map.js';
import { drawUnit } from '../src/render/militaryArt.js';
import { newGame } from './helpers.mjs';

log.setLevel('error');

/** The spec's table: each new kind, scaled from the original by Colonia's legionary. */
const NEW_KINDS = {
  swordsman: { hp: 80, attack: 14, defense: 4 },
  axeman: { hp: 88, attack: 21, defense: 5, siege: 14 },
  javelineer: { hp: 50, attack: 7, defense: 2, range: 4, ranged: true },
  chariot: { hp: 88, attack: 21, defense: 6, siege: 6, mounted: true },
  elephant: { hp: 145, attack: 28, defense: 8, siege: 25, missileShare: 0.5 },
  hoplite: { hp: 88, attack: 17, defense: 6 },
  gladiator: { hp: 75, attack: 12, defense: 4, siege: 10 },
};

test('peoples: each new kind of warrior has its stats, is an enemy, and has a name and a description', () => {
  for (const [type, want] of Object.entries(NEW_KINDS)) {
    const d = UNIT_TYPES[type];
    assert.ok(d, type);
    for (const [k, v] of Object.entries(want)) assert.equal(d[k], v, `${type}.${k}`);
    assert.equal(d.side, 'enemy', type);
    assert.ok(d.name && d.desc && d.siege > 0, `${type}: name, description, siege`);
  }
  // Speeds: the heavy kinds slower than a raider, the javelineer and chariot faster.
  const raider = UNIT_TYPES.raider.speed;
  for (const t of ['swordsman', 'axeman', 'hoplite', 'elephant']) assert.ok(UNIT_TYPES[t].speed < raider, `${t} is slow`);
  assert.ok(UNIT_TYPES.javelineer.speed > raider && UNIT_TYPES.chariot.speed >= UNIT_TYPES.cavalry.speed);
});

test('peoples: against a legionary, the new kinds stand in the original\'s order (blows to kill, blows to be killed)', () => {
  // The original's figures (health, attack, defense) for its legionary and the
  // kinds Colonia's are made from, and the order they give. Ties may fall either way.
  const ORIG = {
    legionary: [150, 10, 0], raider: [90, 7, 1], swordsman: [110, 10, 1], axeman: [120, 15, 2], javelineer: [70, 5, 0],
    chariot: [120, 15, 4], elephant: [200, 20, 5], hoplite: [120, 12, 2],
  };
  const origToKill = (t) => ORIG[t][0] / Math.max(1, ORIG.legionary[1] - ORIG[t][2]);
  const origToFell = (t) => ORIG.legionary[0] / Math.max(1, ORIG[t][1] - ORIG.legionary[2]);
  const leg = UNIT_TYPES.legionary;
  // Colonia's average blow: attack less half the defense, at least 2 (sim/military.js rollDamage).
  const toKill = (t) => UNIT_TYPES[t].hp / Math.max(2, leg.attack - UNIT_TYPES[t].defense * 0.5);
  const toFell = (t) => leg.hp / Math.max(2, UNIT_TYPES[t].attack - leg.defense * 0.5);
  const kinds = Object.keys(ORIG).filter((t) => t !== 'legionary');
  for (const a of kinds) {
    for (const b of kinds) {
      if (origToKill(a) < origToKill(b) - 0.01) assert.ok(toKill(a) <= toKill(b) + 0.01, `harder to kill: ${b} than ${a}`);
      if (origToFell(a) < origToFell(b) - 0.01) assert.ok(toFell(a) <= toFell(b) + 0.01, `fells a legionary sooner: ${a} than ${b}`);
    }
  }
});

test('peoples: every people\'s mix is enemy kinds in shares adding to 100, with a target and a breaking point', () => {
  const TARGETS = ['nearest', 'food', 'homes', 'troops', 'stores', 'random'];
  for (const [id, p] of Object.entries(PEOPLES)) {
    assert.ok(p.name && p.one && p.desc, id);
    assert.ok(TARGETS.includes(p.target), `${id} target ${p.target}`);
    assert.ok(p.breaks > 0 && p.breaks < 1, `${id} breaks`);
    if (!p.mix) { assert.equal(id, GENERIC_PEOPLE); continue; }
    let sum = 0;
    for (const [t, share] of Object.entries(p.mix)) {
      assert.equal(UNIT_TYPES[t]?.side, 'enemy', `${id}: ${t}`);
      sum += share;
    }
    assert.equal(sum, 100, `${id} shares`);
  }
  // The generic band is today's: nearest building, break at 70% losses.
  assert.equal(PEOPLES[GENERIC_PEOPLE].target, 'nearest');
  assert.equal(PEOPLES[GENERIC_PEOPLE].breaks, 0.3);
});

test('peoples: each military mission is raided by its own people, every site has one, the sandbox keeps the generic band', () => {
  const want = { c3m: 'gauls', c4: 'ligurians', c5: 'ligurians_coast', c6: 'carthaginians', c7: 'boii', c8m: 'ligurians_hills', c9m: 'lusitanians', c10m: 'cimbri' };
  for (const [id, people] of Object.entries(want)) assert.equal(peopleFor(findScenario(id)), people, id);
  for (const s of SCENARIOS) {
    assert.ok(PEOPLES[peopleFor(s)], `${s.id} has a people`);
    if (s.military) assert.ok(PEOPLE_BY_MISSION[s.id], `${s.id} raids, so it names its people`);
  }
  for (const site of Object.keys(SITES)) assert.ok(PEOPLES[PEOPLE_BY_SITE[site]], `site ${site}`);
  // North: Gauls or Ligurians; Hispania: Iberians (Lusitanians); the south: Hannibal's army; Gaul: the Cimbri.
  assert.equal(PEOPLE_BY_SITE.corduba, 'lusitanians');
  assert.equal(PEOPLE_BY_SITE.carteia, 'lusitanians');
  assert.equal(PEOPLE_BY_SITE.narbo, 'cimbri');
  assert.equal(PEOPLE_BY_SITE.puteoli, 'carthaginians');
  assert.equal(PEOPLE_BY_SITE.firmum, 'gauls');
  // The sandbox: generic by default at every site; its own people when its setup asks.
  for (const site of SANDBOX_SITES) {
    assert.equal(peopleFor(sandboxScenario({ site })), GENERIC_PEOPLE, site);
    assert.equal(peopleFor({ ...sandboxScenario({ site }), raiders: 'site' }), PEOPLE_BY_SITE[site], site);
  }
  // Flags (debug URL, sim): a people by name, or the site's.
  assert.equal(peopleFor(sandboxScenario(), 'gauls'), 'gauls');
  assert.equal(peopleFor(sandboxScenario({ site: 'narbo' }), 'site'), 'cimbri');
  assert.equal(peopleFor(findScenario('c7'), 'nonsense'), 'boii');
  assert.equal(newGame().military.people, GENERIC_PEOPLE);
});

test('peoples: a people\'s warband is made of its own kinds in about its shares; the generic band is as it was', () => {
  const game = newGame();
  const counts = {};
  const N = 4000;
  for (let k = 0; k < N; k++) {
    const t = warbandType(game, PEOPLES.carthaginians);
    counts[t] = (counts[t] || 0) + 1;
  }
  for (const [t, share] of Object.entries(PEOPLES.carthaginians.mix)) {
    assert.ok(Math.abs(counts[t] / N - share / 100) < 0.03, `${t}: ${counts[t]} of ${N}`);
  }
  assert.deepEqual(Object.keys(counts).sort(), Object.keys(PEOPLES.carthaginians.mix).sort());
  // The generic band: raiders only in a small town (horsemen from 1,200 people, slingers from 700).
  game.city.population = 400;
  for (let k = 0; k < 200; k++) assert.equal(warbandType(game, PEOPLES[GENERIC_PEOPLE]), 'raider');
});

test('peoples: a warband weighs what the generic band of that size would (health x attack), within 10% from 10 men up', () => {
  const generic = peopleStrength(PEOPLES[GENERIC_PEOPLE]);
  for (const [id, p] of Object.entries(PEOPLES)) {
    for (let size = 10; size <= 40; size++) {
      const n = peopleSize(size, p);
      const ratio = (n * peopleStrength(p)) / (size * generic);
      assert.ok(ratio > 0.9 && ratio < 1.1, `${id} for ${size}: ${n} men, ${ratio.toFixed(2)}`);
    }
    assert.ok(peopleSize(3, p) >= 2, `${id}: at least 2`);
  }
  assert.equal(peopleSize(17, PEOPLES[GENERIC_PEOPLE]), 17);
  // Fewer Gauls than raiders, more Ligurians.
  assert.ok(peopleSize(20, PEOPLES.gauls) < 20 && peopleSize(20, PEOPLES.ligurians) > 20);
});

/** A raid record of `people`, `size` strong with `killed` slain, its living men on the map; one day passes. */
function raidAfterLosses(people, size, killed) {
  const game = newGame();
  const inv = { id: 5, origin: { x: 1, y: 1 }, size, killed, buildingsLost: 0, startDay: game.time.totalDays, fleeing: false, reached: false, people, target: 'nearest' };
  game.military.active = inv;
  for (let k = 0; k < size - killed; k++) spawnUnit(game, 'raider', 20.5, 20.5 + k * 0.1, { invasion: inv.id });
  militaryDaily(game);
  return inv;
}

test('peoples: a warband breaks at its people\'s losses: Gauls after 55%, the generic band after 70%', () => {
  assert.equal(raidAfterLosses('gauls', 20, 10).fleeing, false, 'Gauls hold at half lost');
  const g = raidAfterLosses('gauls', 20, 11);
  assert.equal(g.fleeing, true, 'Gauls break at 55% lost');
  assert.equal(g.repelled, true);
  assert.equal(raidAfterLosses(GENERIC_PEOPLE, 20, 13).fleeing, false, 'the generic band holds at 65% lost');
  assert.equal(raidAfterLosses(GENERIC_PEOPLE, 20, 14).fleeing, true, 'and breaks at 70%');
  assert.equal(raidAfterLosses('carthaginians', 20, 13).fleeing, false, 'Carthaginians hold as long as the generic band');
});

/** Open plains with the trees cleared from a w x h box; its corner. */
function openBox(game, w, h) {
  const { map } = game;
  for (let y = 4; y < map.h - h - 4; y++) {
    for (let x = 4; x < map.w - w - 4; x++) {
      let ok = true;
      for (let dy = 0; dy < h && ok; dy++) for (let dx = 0; dx < w && ok; dx++) {
        const i = map.idx(x + dx, y + dy);
        if (map.terrain[i] === Terrain.WATER || map.terrain[i] === Terrain.ROCK || map.road[i] || map.fixedRoad[i] || map.building[i]) ok = false;
      }
      if (!ok) continue;
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (map.terrain[map.idx(x + dx, y + dy)] === Terrain.TREES) map.terrain[map.idx(x + dx, y + dy)] = Terrain.GRASS;
      map.touch();
      return { x, y };
    }
  }
  return null;
}

test('peoples: a warband makes for its people\'s targets: Ligurians pass a nearer home to reach a granary', () => {
  for (const [people, struck] of [['ligurians', 'granary'], [GENERIC_PEOPLE, 'house']]) {
    const game = newGame({ type: 'plains', size: 96 });
    const at = openBox(game, 30, 9);
    assert.ok(at, 'open land');
    const y = at.y + 3;
    const house = addBuilding(game, 'house', at.x + 2, y + 1, 1); // 6 tiles west of the raider
    const granary = addBuilding(game, 'granary', at.x + 22, y, 3); // 12 tiles east
    assert.ok(house && granary);
    assert.equal(raidTargets(game, 'food').isTarget(granary.id), true);
    assert.equal(raidTargets(game, 'food').isTarget(house.id), false);
    const inv = launchInvasion(game, { x: at.x + 8, y: y + 1 }, 1, { people });
    // One warrior, set down between the two.
    for (const u of game.units.values()) { u.x = at.x + 8.5; u.y = y + 1.5; u.type = 'raider'; }
    computeField(game);
    assert.equal(inv.target, PEOPLES[people].target);
    for (let t = 0; t < 1500 && house.hp === undefined && granary.hp === undefined; t++) { game.time.totalTicks++; updateMilitary(game); }
    const hit = granary.hp !== undefined ? 'granary' : house.hp !== undefined ? 'house' : 'nothing';
    assert.equal(hit, struck, `${people}: struck the ${hit}`);
  }
});

test('peoples: a people\'s slingers strike the city\'s people in a city with few soldiers; the generic band\'s do not', () => {
  for (const [people, soldiers, hurt] of [['ligurians', 0, true], [GENERIC_PEOPLE, 0, false], ['ligurians', 4, false]]) {
    const game = newGame({ type: 'plains' });
    const at = openBox(game, 12, 12);
    const inv = { id: 3, origin: { x: 1, y: 1 }, size: 1, killed: 0, buildingsLost: 0, startDay: 0, fleeing: false, reached: false, people, target: 'nearest' };
    game.military.active = inv;
    const w = spawnWalker(game, 'cart', game.map.idx(at.x + 6, at.y + 6), null, {});
    const s = spawnUnit(game, 'slinger', at.x + 3.5, at.y + 6.5, { invasion: inv.id });
    // Soldiers far off (they count, but cannot reach): pinned in place below.
    const men = [];
    for (let k = 0; k < soldiers; k++) men.push(spawnUnit(game, 'legionary', 1.5, 1.5 + k, { fort: 999 }));
    for (let t = 0; t < 200 && !w.dead; t++) {
      s.x = at.x + 3.5; s.y = at.y + 6.5;
      for (const m of men) { m.x = 1.5; m.y = 1.5; }
      game.time.totalTicks++;
      updateMilitary(game);
      for (const m of men) if (!game.units.has(m.id)) game.units.set(m.id, m); // (no fort: kept on the map for the count)
    }
    assert.equal(w.hp !== undefined && w.hp < 20 || w.dead, hurt, `${people} with ${soldiers} soldiers`);
  }
});

test('peoples: an elephant takes half a missile\'s damage', () => {
  const game = newGame();
  const e = spawnUnit(game, 'elephant', 10.5, 10.5, {});
  const r = spawnUnit(game, 'raider', 12.5, 10.5, {});
  assert.equal(missileDamage(game, e, 10), 5);
  assert.equal(missileDamage(game, r, 10), 10);
});

test('peoples: messages and the threat name the people; the generic band\'s read as before', () => {
  const g1 = newGame();
  launchInvasion(g1, { x: 1, y: 30 }, 6, { people: 'gauls' });
  assert.match(g1.messages[0].text, /^Gauls are attacking from the /);
  assert.equal(raidPeople(g1).name, 'Gauls');
  const g2 = newGame();
  launchInvasion(g2, { x: 1, y: 30 }, 6);
  assert.match(g2.messages[0].text, /^Raiders are attacking from the /);
});

/** A canvas stand-in that writes down every call and colour, for comparing drawings. */
function tracingContext() {
  const log = [];
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (...a) => { log.push(`${String(k)}(${a.map((v) => (typeof v === 'number' ? v.toFixed(1) : v)).join(',')})`); }),
    set: (t, k, v) => { log.push(`${String(k)}=${v}`); return true; },
  });
  return { ctx, log };
}

test('peoples: every land unit draws at both facings, each kind a drawing of its own', () => {
  const drawn = new Map();
  for (const [type, def] of Object.entries(UNIT_TYPES)) {
    if (def.naval) continue;
    for (const facing of [1, -1]) {
      for (const [moving, hurt] of [[false, false], [true, true]]) {
        const u = { id: 7, type, side: def.side, x: 5, y: 5, hp: hurt ? def.hp / 2 : def.hp, maxHp: def.hp, facing, moving, walked: 1.3, strikeTick: hurt ? 100 : -99, hitTick: -99, state: 'advance' };
        const { ctx, log: calls } = tracingContext();
        drawUnit(ctx, u, 100, 100, 1, 0.5, 102, false, 1.3, facing);
        assert.ok(calls.length > 10, `${type} draws`);
        if (facing === 1 && !moving) drawn.set(type, calls.join(';'));
      }
    }
  }
  const seen = new Map();
  for (const [type, sig] of drawn) {
    assert.ok(!seen.has(sig), `${type} looks just like ${seen.get(sig)}`);
    seen.set(sig, type);
  }
});

test('peoples: a save keeps the province\'s people and the raid\'s; an older save\'s raid stays the generic band', () => {
  const scenario = withDifficulty(findScenario('c7'), 'normal');
  const game = new Game({ scenario, flags: { unlockall: true } });
  assert.equal(game.military.people, 'boii');
  const inv = launchInvasion(game, { x: 1, y: 30 }, 5);
  assert.equal(inv.people, 'boii');
  const back = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))));
  assert.equal(back.military.people, 'boii');
  assert.equal(back.military.active.people, 'boii');
  // A save from before peoples: no military.people, a raid with no people.
  const old = JSON.parse(JSON.stringify(serializeGame(game)));
  delete old.military.people;
  delete old.military.active.people;
  const up = deserializeGame(old);
  assert.equal(up.military.people, 'boii', 'from now on, the mission\'s people');
  assert.equal(up.military.active.people, GENERIC_PEOPLE, 'the raid under way was the generic band');
});

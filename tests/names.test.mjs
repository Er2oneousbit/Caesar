/**
 * names.test.mjs - the buildings' Latin names (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * Covers data/buildings.js: every building and tool has a Latin name (`name`)
 * and an English one (`en`), Clear Land alone keeps English; no two
 * buildings share a Latin name; the type keys (saves, sprite keys) never
 * changed with the names; fullName ("Castra (Legion Fort)") for the panel's
 * title and the tooltips; the Latin plurals; and the messages and ruins use
 * the Latin name.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { BUILDINGS, BUILDING_KEYS, TOOLS, GATE, fullName, pluralName } from '../src/data/buildings.js';
import { igniteBuilding } from '../src/sim/risk.js';
import { addBuilding } from '../src/sim/entities.js';
import { ruinAt } from '../src/sim/ruins.js';
import { ruinText } from '../src/ui/infoPanel.js';
import { newGame, findFree } from './helpers.mjs';

log.setLevel('error');

// The type keys as they were before the names changed: saves and sprite
// keys are built on them, so a rename must never touch them.
const KEYS = ['house', 'well', 'fountain', 'reservoir', 'barber', 'clinic', 'baths', 'hospital', 'temple_ceres', 'temple_neptune', 'temple_mercury', 'temple_mars',
  'temple_venus', 'temple_large_ceres', 'temple_large_neptune', 'temple_large_mercury', 'temple_large_mars', 'temple_large_venus', 'oracle', 'school', 'library', 'academy',
  'theater', 'amphitheater', 'colosseum', 'actor_troupe', 'gladiator_school', 'menagerie', 'hippodrome', 'hippodrome_part', 'chariot_maker', 'forum', 'senate',
  'governor_house', 'governor_villa', 'governor_palace', 'garden', 'statue_small', 'statue_medium', 'statue_large', 'triumphal_arch', 'engineer_post', 'prefecture',
  'farm_wheat', 'farm_veg', 'farm_fruit', 'farm_pig', 'farm_olive', 'farm_vine', 'farm_flax', 'clay_pit', 'timber_yard', 'iron_mine', 'marble_quarry', 'pottery_ws',
  'furniture_ws', 'oil_ws', 'wine_ws', 'weapons_ws', 'fletcher_ws', 'linen_ws', 'clothing_ws', 'market', 'granary', 'warehouse', 'dock', 'shipyard', 'wharf',
  'horse_ranch', 'barracks', 'military_academy', 'fort_legion', 'fort_archer', 'fort_cavalry', 'tower', 'navalia', 'portus', 'naval_station'];

test('names: every building and tool has a Latin name and an English one; only Clear Land stays English', () => {
  for (const [key, def] of [...Object.entries(BUILDINGS), ...Object.entries(TOOLS)]) {
    assert.equal(typeof def.name, 'string', key);
    assert.ok(def.name.length > 1, key);
    if (key === 'clear') {
      assert.equal(def.name, 'Clear Land');
      assert.equal(def.en, undefined, 'a tool, not a building: no Latin name');
      continue;
    }
    assert.equal(typeof def.en, 'string', `${key} has an English name`);
    assert.ok(def.en.length > 1, key);
  }
  // A few by name, as decided (the English beside each).
  const want = {
    fort_legion: ['Castra', 'Legion Fort'], warehouse: ['Horreum', 'Warehouse'], granary: ['Granarium', 'Granary'], dock: ['Emporium', 'Trade Dock'],
    portus: ['Portus', 'Training Harbor'], military_academy: ['Campus', 'Military Academy'], temple_large_ceres: ['Templum Cereris', 'Grand Temple of Ceres'],
    temple_venus: ['Aedes Veneris', 'Temple of Venus'], prefecture: ['Excubitorium', 'Prefecture'], engineer_post: ['Collegium Fabrum', 'Engineer\'s Post'],
    governor_villa: ['Praetorium Maius', 'Governor\'s Villa'], triumphal_arch: ['Fornix', 'Triumphal Arch'], colosseum: ['Arena', 'Great Arena'],
    house: ['Area', 'Housing Plot'], clinic: ['Medicus', 'Physician'], baths: ['Balneae', 'Baths'],
  };
  for (const [k, [la, en]] of Object.entries(want)) assert.deepEqual([BUILDINGS[k].name, BUILDINGS[k].en], [la, en], k);
  assert.deepEqual([TOOLS.roadblock.name, TOOLS.roadblock.en], ['Claustra', 'Roadblock']);
  assert.deepEqual([GATE.name, GATE.en], ['Porta', 'Gate']);
});

test('names: no two buildings share a Latin name (a hippodrome\'s track sections read as the hippodrome), nor a tool a building\'s', () => {
  const seen = new Map();
  for (const [key, def] of [...Object.entries(BUILDINGS), ...Object.entries(TOOLS)]) {
    if (key === 'hippodrome_part') {
      assert.equal(def.name, BUILDINGS.hippodrome.name, 'an inspected section reads like its hippodrome');
      continue;
    }
    assert.equal(seen.has(def.name), false, `${key} and ${seen.get(def.name)} are both "${def.name}"`);
    seen.set(def.name, key);
  }
});

test('names: the type keys did not change with the names (saves and sprite keys stand on them)', () => {
  assert.deepEqual([...BUILDING_KEYS], KEYS);
  assert.deepEqual(Object.keys(TOOLS), ['road', 'plaza', 'bridge', 'roadblock', 'aqueduct', 'wall', 'clear']);
});

test('names: the panel title and tooltip show the Latin name with the English after it, once when they are the same word', () => {
  assert.equal(fullName(BUILDINGS.fort_legion), 'Castra (Legion Fort)');
  assert.equal(fullName(BUILDINGS.temple_large_mars), 'Templum Martis (Grand Temple of Mars)');
  assert.equal(fullName(BUILDINGS.forum), 'Forum', 'Forum is Forum in both');
  assert.equal(fullName(TOOLS.clear), 'Clear Land');
  assert.equal(fullName(GATE), 'Porta (Gate)');
});

test('names: every building has its Latin plural, never an English "s" on a Latin name', () => {
  for (const key of BUILDING_KEYS) {
    const p = pluralName(key);
    assert.notEqual(p, `${BUILDINGS[key].name}s`, `${key}: a plural of its own`);
  }
  assert.equal(pluralName('pottery_ws'), 'Figlinae');
  assert.equal(pluralName('fort_legion'), 'Castra', 'castra is already plural');
  assert.equal(pluralName('warehouse'), 'Horrea');
  assert.equal(pluralName('temple_large_venus'), 'Templa Veneris');
});

test('names: a fire\'s message and the ruins it leaves use the Latin name', () => {
  const game = newGame({ seed: 'latin-names' });
  const spot = findFree(game, 5, 5);
  const b = addBuilding(game, 'warehouse', spot.x + 1, spot.y + 1, 3);
  igniteBuilding(game, b);
  assert.ok(game.messages.some((m) => m.text === 'Fire! A Horreum has burned down.'), game.messages.map((m) => m.text).join(' | '));
  const ruin = ruinAt(game, game.map.idx(b.x, b.y));
  assert.equal(ruin.what, 'Horreum');
  assert.match(ruinText(ruin), /^Ruins of a Horreum, burned down in /);
});

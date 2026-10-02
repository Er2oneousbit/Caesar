/**
 * autoPause.test.mjs - Settings > Auto-pause (ui/autoPause.js): the switches
 * and their defaults, which message kinds each one stops for, and that the
 * sim labels the right messages (and only those) with a kind: a fire that
 * breaks out but not one spreading or set by raiders, the scouts' report
 * but not the rumour or the reminder a month out, raiders by land and sea,
 * Caesar's legions setting out and arriving, the Emperor's request, the
 * call for troops, a collapse from neglect, an outbreak of disease.
 * The app pausing on them (only in the running game's own ticks) is checked
 * in the browser smoke test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { addBuilding } from '../src/sim/entities.js';
import { igniteBuilding, collapseBuilding } from '../src/sim/risk.js';
import { militaryMonthly, launchInvasion } from '../src/sim/military.js';
import { seaRoll } from '../src/sim/navy.js';
import { startMarch, launchLegion } from '../src/sim/legion.js';
import { updateEmperor } from '../src/sim/emperor.js';
import { requestTroops } from '../src/sim/battle.js';
import { outbreak } from '../src/sim/disease.js';
import { buildDemoCity } from '../src/dev/demoCity.js';
import { AUTO_PAUSE, AUTO_PAUSE_DEFAULTS, autoPauseSwitches, autoPauseFor, autoPauseText } from '../src/ui/autoPause.js';
import { newGame, findFree } from './helpers.mjs';

log.setLevel('error');

/** Messages posted while `fn` runs. */
function heard(game, fn) {
  const out = [];
  const off = game.events.on('message', (m) => out.push(m));
  try { fn(); } finally { off(); }
  return out;
}

/** Settings with only the switches in `on` turned on. */
const only = (...on) => ({ autoPause: Object.fromEntries(AUTO_PAUSE.map((s) => [s.key, on.includes(s.key)])) });

// ---------------------------------------------------------------------------
// The switches
// ---------------------------------------------------------------------------

test('auto-pause: six switches, all off by default but raiders or legions arriving', () => {
  assert.deepEqual(AUTO_PAUSE.map((s) => s.key), ['fire', 'scouted', 'arrive', 'caesar', 'collapse', 'disease']);
  assert.deepEqual(AUTO_PAUSE_DEFAULTS, { fire: false, scouted: false, arrive: true, caesar: false, collapse: false, disease: false });
  assert.deepEqual(autoPauseSwitches({}), AUTO_PAUSE_DEFAULTS, 'settings saved before the switches existed');
  assert.deepEqual(autoPauseSwitches(null), AUTO_PAUSE_DEFAULTS);
});

test('auto-pause: saved switches win over the defaults; a missing or broken one takes its default', () => {
  const s = { autoPause: { fire: true, arrive: false, disease: 'yes', bogus: true } };
  assert.deepEqual(autoPauseSwitches(s), { fire: true, scouted: false, arrive: false, caesar: false, collapse: false, disease: false });
  assert.deepEqual(autoPauseSwitches({ autoPause: 'on' }), AUTO_PAUSE_DEFAULTS, 'not an object: the defaults');
});

test('auto-pause: each switch stops for its own kinds of event and no other', () => {
  const kinds = { fire: ['fire'], scouted: ['scouted', 'legionMarch'], arrive: ['raid', 'legion'], caesar: ['request', 'troops'], collapse: ['collapse'], disease: ['disease'] };
  const all = Object.values(kinds).flat();
  for (const sw of AUTO_PAUSE) {
    for (const kind of all) {
      const hit = autoPauseFor({ kind }, only(sw.key));
      if (kinds[sw.key].includes(kind)) assert.equal(hit?.key, sw.key, `${sw.key} stops for ${kind}`);
      else assert.equal(hit, null, `${sw.key} lets ${kind} pass`);
    }
  }
  // Everything off: nothing pauses. A message with no kind never does.
  for (const kind of all) assert.equal(autoPauseFor({ kind }, only()), null);
  assert.equal(autoPauseFor({ text: 'Fire! A Tent has burned down.' }, only('fire')), null, 'the words alone mean nothing');
  assert.equal(autoPauseFor({ kind: 'unknown' }, only(...Object.keys(kinds))), null);
  // The defaults: a raid stops the game, a fire does not.
  assert.equal(autoPauseFor({ kind: 'raid' }, {})?.key, 'arrive');
  assert.equal(autoPauseFor({ kind: 'fire' }, {}), null);
});

test('auto-pause: the note names what happened', () => {
  assert.equal(autoPauseText({ kind: 'fire' }), '⏸ Paused: a fire broke out. Click to look; Space resumes.');
  assert.match(autoPauseText({ kind: 'legion' }), /Caesar's legions have arrived/);
  assert.match(autoPauseText({ kind: 'troops' }), /Caesar calls for troops/);
});

// ---------------------------------------------------------------------------
// The sim's labels
// ---------------------------------------------------------------------------

test('labels: a fire that breaks out (or a riot\'s) is a fire; one spreading, a raid\'s or a legion\'s is not', () => {
  const game = newGame({ seed: 'pause-fire' });
  const at = () => { const s = findFree(game, 2, 2); return addBuilding(game, 'pottery_ws', s.x, s.y); };
  const kindOf = (cause) => heard(game, () => igniteBuilding(game, at(), cause))[0];
  assert.equal(kindOf('fire').kind, 'fire');
  assert.equal(kindOf('riot').kind, 'fire');
  const spread = kindOf('spread');
  assert.match(spread.text, /^Fire! /, 'a spreading fire still says so');
  assert.equal(spread.kind, undefined);
  assert.equal(kindOf('raid').kind, undefined);
  assert.equal(kindOf('legion').kind, undefined);
  assert.equal(game.city.stats.fires, 5);
});

test('labels: a collapse from neglect is a collapse; a raid\'s is not', () => {
  const game = newGame({ seed: 'pause-collapse' });
  const at = () => { const s = findFree(game, 2, 2); return addBuilding(game, 'pottery_ws', s.x, s.y); };
  const [decay] = heard(game, () => collapseBuilding(game, at()));
  assert.equal(decay.kind, 'collapse');
  assert.match(decay.text, /has collapsed!$/);
  const [raid] = heard(game, () => collapseBuilding(game, at(), 'raid'));
  assert.equal(raid.kind, undefined);
});

test('labels: of a raid\'s warnings only the scouts\' report is "scouted"; the raid itself is "raid"', () => {
  const game = newGame({ invasions: 'occasional', seed: 'pause-raid' });
  const spot = findFree(game, 1, 1);
  addBuilding(game, 'house', spot.x, spot.y);
  game.city.population = 600;
  const m = game.military;
  const byLeft = {};
  for (let left = 7; left >= 0; left--) {
    game.time.totalMonths = m.nextRaidMonth - left;
    byLeft[left] = heard(game, () => militaryMonthly(game)).map((x) => x.kind ?? null);
  }
  assert.deepEqual(byLeft[6], [null], 'the rumour');
  assert.deepEqual(byLeft[3], ['scouted'], 'the scouts');
  assert.deepEqual(byLeft[1], [null], 'a month away');
  assert.deepEqual(byLeft[0], ['raid'], 'the raid');
  for (const left of [7, 5, 4, 2]) assert.deepEqual(byLeft[left], [], `nothing ${left} months out`);
});

test('labels: a raid by sea is scouted, and its ships arriving are "raid"', () => {
  const game = newGame({ type: 'coast', size: 64, seed: 'demo', invasions: 'occasional' });
  assert.ok(buildDemoCity(game, { level: 2 }).ok);
  game.runDays(16 * 3);
  const m = game.military;
  let n = 1;
  while (seaRoll(game.seed, n) >= CONFIG.SEA_RAID_SHARE) n++;
  m.nextInvasionId = n;
  game.city.population = 1000;
  game.time.totalMonths = m.nextRaidMonth - 3;
  const [scouts] = heard(game, () => militaryMonthly(game));
  assert.ok(m.warned.sea, 'by sea');
  assert.equal(scouts.kind, 'scouted');
  const ships = heard(game, () => launchInvasion(game, null, 12, { sea: true }));
  assert.deepEqual(ships.map((x) => x.kind), ['raid']);
  assert.match(ships[0].text, /^Raider ships are coming/);
});

test('labels: Caesar\'s legions setting out and arriving, his request, his call for troops', () => {
  const game = newGame({ seed: 'pause-caesar' });
  assert.deepEqual(heard(game, () => startMarch(game)).map((x) => x.kind), ['legionMarch']);
  assert.deepEqual(heard(game, () => launchLegion(game, 3)).map((x) => x.kind), ['legion']);
  game.city.request = null;
  game.city.nextRequestMonth = 0;
  game.city.population = 2000;
  const req = heard(game, () => updateEmperor(game));
  assert.ok(game.city.request, 'a request was made');
  assert.deepEqual(req.map((x) => x.kind), ['request']);
  assert.deepEqual(heard(game, () => requestTroops(game, 'placentia', 16)).map((x) => x.kind), ['troops']);
});

test('labels: an outbreak of disease is "disease"; the month\'s sum of the rest is not', () => {
  const game = newGame({ seed: 'pause-disease' });
  const homes = [];
  for (let k = 0; k < 2; k++) {
    const s = findFree(game, 1, 1);
    const b = addBuilding(game, 'house', s.x, s.y);
    Object.assign(b.house, { tier: 3, pop: 9, mood: 60 });
    homes.push(b);
  }
  const first = heard(game, () => outbreak(game, homes[0]));
  assert.deepEqual(first.map((x) => x.kind), ['disease']);
  assert.deepEqual(heard(game, () => outbreak(game, homes[1])), [], 'one pop-up a month');
  game.time.totalMonths++;
  const s = findFree(game, 1, 1);
  const third = addBuilding(game, 'house', s.x, s.y);
  Object.assign(third.house, { tier: 3, pop: 9, mood: 60 });
  const next = heard(game, () => outbreak(game, third));
  assert.deepEqual(next.map((x) => x.kind ?? null), [null, 'disease'], 'last month\'s sum, then the new outbreak');
});

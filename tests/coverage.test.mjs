/**
 * coverage.test.mjs - headless tests for the Health, Education and
 * Entertainment advisors (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * The coverage helpers (sim/coverage.js) and their words (ui/coverageInfo.js):
 * the twelve coverage words, the people a service reaches and the needs of
 * homes it meets (a hospital serving a home that needs only some health care,
 * a library one that needs only a school or a library, academy demand
 * counted), the seats behind the city-wide entertainment base, which venue
 * most needs performers, each advisor's advice and the order it is picked in,
 * the Overview's health and crime lines, figures that agree with what the sim
 * itself counts in a running city, and reading changing nothing.
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
import { serializeGame } from '../src/core/save.js';
import { SCENARIOS, withDifficulty } from '../src/data/scenarios.js';
import { Game } from '../src/core/game.js';
import { VENUE_SEATS, ENT_BASE_MAX } from '../src/data/buildings.js';
import { HOUSE_TIERS } from '../src/data/housing.js';
import { COVERAGE_WORDS, CITY_HEALTH_VERDICTS } from '../src/data/advisors.js';
import { addBuilding } from '../src/sim/entities.js';
import { refreshDiseaseGate } from '../src/sim/disease.js';
import { updateEntertainmentBase } from '../src/sim/entertainment.js';
import { computeCoverage } from '../src/sim/ratings.js';
import { buildDemoCity } from '../src/dev/demoCity.js';
import { WaterBits } from '../src/world/map.js';
import {
  coveragePct, coverageBand, nextNeeds, healthReport, educationReport, entertainmentReport, pickHealthAdvice,
  pickEducationAdvice, pickEntertainmentAdvice, venueNeedingShows, topShortage, crimeNow, healthTrend,
  HEALTH_KINDS, EDUCATION_KINDS, VENUE_KINDS, TRAINER_KINDS,
} from '../src/sim/coverage.js';
import {
  coverageText, healthVerdict, cityHealthLine, crimeLine, healthAdviceText, educationAdviceText, entertainmentAdviceText,
  pluralName, firstLevelNeeding, performersText, educationLadderText,
} from '../src/ui/coverageInfo.js';
import { newGame, findFree } from './helpers.mjs';

log.setLevel('error');

/** Level numbers by name, so the tests read like the ladder. */
const LEVEL = Object.fromEntries(HOUSE_TIERS.map((t, i) => [t.name, i]));

/** An occupied single-tile home at the given level (placed directly, like a save would). */
function home(game, x, y, tier, pop = 10) {
  const b = addBuilding(game, 'house', x, y, 1);
  Object.assign(b.house, { tier, pop, mood: 60 });
  return b;
}

/** A building placed directly, staffed or not. */
function place(game, type, x, y, staffed = true) {
  const b = addBuilding(game, type, x, y);
  b.efficiency = staffed ? 1 : 0;
  return b;
}

/** A game with room for a row of homes at (x, y) and buildings below them. */
function plot(seed = 'coverage') {
  const game = newGame({ size: 128, type: 'plains', seed });
  const s = findFree(game, 20, 12);
  assert.ok(s, 'room to build');
  return { game, x: s.x, y: s.y };
}

// ---------------------------------------------------------------------------
// The small pieces
// ---------------------------------------------------------------------------

test('coverage words: twelve of them, none, one per ten percent, and full', () => {
  assert.equal(COVERAGE_WORDS.length, 12);
  assert.equal(new Set(COVERAGE_WORDS).size, 12, 'all different');
  assert.equal(coverageBand(0), 0);
  assert.equal(coverageBand(1), 1);
  assert.equal(coverageBand(9), 1);
  assert.equal(coverageBand(10), 2);
  assert.equal(coverageBand(55), 6);
  assert.equal(coverageBand(99), 10);
  assert.equal(coverageBand(100), 11);
  assert.equal(coverageText(0), 'None (0%)');
  assert.equal(coverageText(100), 'Full (100%)');
  assert.equal(coverageText(null), 'No one needs it yet');
  // Truncated, so 100% means everyone: 299 of 300 is not full.
  assert.equal(coveragePct(299, 300), 99);
  assert.equal(coveragePct(2, 3), 66);
  assert.equal(coveragePct(5, 0), null, 'nobody to cover');
  assert.equal(coveragePct(500, 300), 100, 'never above 100');
});

test('city health in words: a verdict by tens, red below 40, and the trend', () => {
  assert.equal(CITY_HEALTH_VERDICTS.length, 11);
  assert.equal(healthVerdict(0), CITY_HEALTH_VERDICTS[0]);
  assert.equal(healthVerdict(57), CITY_HEALTH_VERDICTS[5]);
  assert.equal(healthVerdict(100), CITY_HEALTH_VERDICTS[10]);
  const line = (value, target, judged = true, sickHomes = 0) => cityHealthLine({ city: { value, target, trend: healthTrend({ value, target }), judged }, sick: { homes: sickHomes, people: 0 } });
  assert.equal(line(39, 39).low, true);
  assert.equal(line(40, 40).low, false);
  assert.match(line(57, 61).text, /^57: .*, rising$/);
  assert.match(line(57, 50).text, /falling/);
  assert.doesNotMatch(line(57, 57).text, /rising|falling/);
  assert.match(line(57, 57, true, 2).text, /2 homes sick$/);
  assert.match(line(50, 50, false).text, /Too small to judge \(under 200 people\)/);
  assert.equal(line(10, 10, false).low, false, 'a small town is not judged');
});

test('the needs a home is measured by are its next level\'s, or its own at the top', () => {
  assert.equal(nextNeeds({ tier: LEVEL.Cottage }).name, 'Stone Cottage');
  assert.equal(nextNeeds({ tier: HOUSE_TIERS.length - 1 }).name, HOUSE_TIERS[HOUSE_TIERS.length - 1].name);
  assert.equal(firstLevelNeeding('edu'), 'Townhouse');
  assert.equal(firstLevelNeeding('edu', 3), 'Peristyle Villa');
  assert.match(educationLadderText(), /from Townhouse up, both from Tenement up, and an academy as well from Peristyle Villa up/);
  assert.equal(pluralName('library'), 'Bibliothecae');
  assert.equal(pluralName('clinic'), 'Medici');
  assert.equal(pluralName('theater'), 'Theatra');
  assert.equal(pluralName('baths'), 'Balneae', 'already plural');
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

test('health: buildings, reach, and the needs of homes each kind meets', () => {
  const { game, x, y } = plot('health');
  game.city.population = 500;
  refreshDiseaseGate(game);
  place(game, 'clinic', x, y + 6);
  place(game, 'barber', x + 2, y + 6, false); // built, no workers
  // A Domus (level 9) wants a medicus or a hospital to become an Apartment
  // House; an Insula (12) wants a barber and baths too; a Villa (13) wants
  // both kinds of care to become a Garden Villa.
  const a = home(game, x, y, LEVEL.Domus, 10); // medicus visit: served
  const b = home(game, x + 1, y, LEVEL.Domus, 12); // in a hospital's reach only: served all the same
  const c = home(game, x + 2, y, LEVEL.Domus, 14); // nothing: short of care
  const d = home(game, x + 3, y, LEVEL.Villa, 20); // a medicus visit, no hospital: short of a hospital
  const e = home(game, x + 4, y, LEVEL.Cottage, 8); // needs no health building yet
  a.house.clinic = 50;
  d.house.clinic = 50;
  game.map.water[game.map.idx(b.x, b.y)] |= WaterBits.HOSPITAL;
  c.house.barber = 10;
  const rep = healthReport(game);
  assert.deepEqual(Object.keys(rep.rows), [...HEALTH_KINDS]);
  const { clinic, hospital, barber, baths } = rep.rows;
  assert.equal(rep.people, 64);
  assert.deepEqual([clinic.built, clinic.staffed, clinic.working], [1, 1, 1]);
  assert.deepEqual([barber.built, barber.staffed, barber.working], [1, 0, 0]);
  assert.deepEqual([hospital.built, baths.built], [0, 0]);
  // Reach: everyone visited (or in reach), needed or not.
  assert.equal(clinic.reach, 30);
  assert.equal(clinic.reachPct, Math.floor(3000 / 64));
  assert.equal(hospital.reach, 12);
  assert.equal(barber.reach, 14);
  // Needs: the four homes above a Cottage need care; a, b and d have it
  // (b by its hospital), c does not. Only the Villa needs a hospital.
  assert.deepEqual([clinic.need, clinic.served, clinic.shortHomes, clinic.pct], [56, 42, 1, 75]);
  assert.deepEqual([hospital.need, hospital.served, hospital.shortHomes, hospital.pct], [20, 0, 1, 0]);
  assert.deepEqual([barber.need, barber.served, barber.shortHomes], [20, 0, 1], 'only the Villa\'s next level needs a barber');
  assert.equal(baths.need, 56, 'every home above a Cottage needs the baths for its next level');
  assert.equal(rep.noCare, 22, 'c and e: no medicus or hospital');
  assert.equal(e.house.tier, LEVEL.Cottage);
  // The advice: four homes need the baths, the most; none is built.
  assert.deepEqual(rep.advice, { key: 'build', type: 'baths', homes: 4 });
  assert.match(healthAdviceText(rep.advice), /^4 homes need the baths to keep or reach their level, and the city has no Balneae yet/);
});

test('health advice: most homes held back first (ties in the original\'s order), then care, then needs the province cannot meet', () => {
  const row = (type, shortHomes, built = 1, working = built) => ({ type, shortHomes, built, working });
  const rows = (o) => Object.fromEntries(HEALTH_KINDS.map((k) => [k, o[k] || row(k, 0)]));
  // The most homes wins; a tie goes to the baths, then the barber, then care.
  assert.equal(pickHealthAdvice({ rows: rows({ barber: row('barber', 3), clinic: row('clinic', 5) }) }).type, 'clinic');
  assert.equal(pickHealthAdvice({ rows: rows({ barber: row('barber', 5), clinic: row('clinic', 5) }) }).type, 'barber');
  assert.equal(pickHealthAdvice({ rows: rows({ baths: row('baths', 5), barber: row('barber', 5) }) }).type, 'baths');
  // None built, built but idle, or more needed.
  assert.equal(pickHealthAdvice({ rows: rows({ barber: row('barber', 2, 0) }) }).key, 'build');
  assert.equal(pickHealthAdvice({ rows: rows({ barber: row('barber', 2, 2, 0) }) }).key, 'idle');
  assert.equal(pickHealthAdvice({ rows: rows({ barber: row('barber', 2, 2, 1) }) }).key, 'more');
  // Nothing held back: the people without care, where there is disease.
  assert.deepEqual(pickHealthAdvice({ rows: rows({}), noCare: 30, people: 300, diseaseOn: true }), { key: 'care', share: 10 });
  assert.equal(pickHealthAdvice({ rows: rows({}), noCare: 29, people: 300, diseaseOn: true }).key, 'fine', 'under a tenth');
  assert.equal(pickHealthAdvice({ rows: rows({}), noCare: 300, people: 300, diseaseOn: false }).key, 'fine', 'no disease here');
  // A building the province does not have: only when nothing else is wrong.
  const locked = rows({ hospital: row('hospital', 9, 0) });
  const unlocked = (k) => k !== 'hospital';
  assert.deepEqual(pickHealthAdvice({ rows: locked, unlocked }), { key: 'locked', type: 'hospital', homes: 9 });
  assert.equal(pickHealthAdvice({ rows: locked, unlocked, noCare: 100, people: 100, diseaseOn: true }).key, 'care');
  assert.equal(pickHealthAdvice({ rows: { ...locked, barber: row('barber', 1) }, unlocked }).type, 'barber');
  assert.equal(topShortage(rows({}), HEALTH_KINDS), null);
  // Every advice has words, none with an em dash.
  for (const a of [{ key: 'build', type: 'baths', homes: 1 }, { key: 'idle', type: 'baths', homes: 2 }, { key: 'more', type: 'hospital', homes: 2 }, { key: 'more', type: 'clinic', homes: 2 }, { key: 'locked', type: 'hospital', homes: 3 }, { key: 'care', share: 40 }, { key: 'fine' }]) {
    const t = healthAdviceText(a);
    assert.ok(t.length > 10 && !t.includes(String.fromCharCode(0x2014)), `${a.key}: ${t}`);
  }
  assert.match(healthAdviceText({ key: 'idle', type: 'baths', homes: 1 }), /^1 home needs the baths .*piped water/);
  assert.match(healthAdviceText({ key: 'more', type: 'hospital', homes: 2 }), /within 12 tiles/);
});

test('health: city health, its trend, outbreaks this year and last, and sick homes now', () => {
  const { game, x, y } = plot('health-city');
  const sick = home(game, x, y, LEVEL.Hut, 9);
  home(game, x + 1, y, LEVEL.Hut, 9);
  sick.house.sick = 12;
  const hc = game.city.health;
  hc.value = 44;
  hc.target = 51;
  hc.year.outbreaks = 3;
  hc.year.deaths = 5;
  hc.lastYear = { outbreaks: 1, deaths: 2, cured: 1, spread: 0, recovered: 0 };
  let rep = healthReport(game);
  assert.deepEqual(rep.sick, { homes: 1, people: 9 });
  assert.equal(rep.city.trend, 'rising');
  assert.equal(rep.city.judged, false, 'under 200 people at the day\'s count');
  assert.equal(rep.year.outbreaks, 3);
  assert.equal(rep.lastYear.deaths, 2);
  game.city.population = 250;
  refreshDiseaseGate(game);
  rep = healthReport(game);
  assert.equal(rep.city.judged, true);
  assert.equal(rep.city.disease, true);
  // The first two missions have no disease: the advisor says so.
  const c1 = new Game({ scenario: withDifficulty(SCENARIOS.find((s) => s.id === 'c1'), 'normal') });
  assert.equal(healthReport(c1).city.disease, false);
  assert.equal(healthReport(c1).lastYear, null, 'no last year in a new game');
});

// ---------------------------------------------------------------------------
// Education
// ---------------------------------------------------------------------------

test('education: a library serves a home that needs only one of the two, and academy demand counts', () => {
  const { game, x, y } = plot('education');
  place(game, 'school', x, y + 6);
  place(game, 'library', x + 3, y + 6, false);
  // A Stone Cottage (6) needs a school or a library to become a Townhouse; an
  // Apartment House (10) needs both for a Tenement; a Garden Villa (14) all
  // three for a Peristyle Villa (the original never counted that last need).
  const a = home(game, x, y, LEVEL['Stone Cottage'], 10); // a library only: served
  const b = home(game, x + 1, y, LEVEL['Apartment House'], 20); // a school only: short of a library
  const c = home(game, x + 2, y, LEVEL['Garden Villa'], 30); // school and library: short of an academy
  home(game, x + 3, y, LEVEL.Hut, 5); // needs no schooling
  a.house.library = 20;
  b.house.school = 20;
  c.house.school = 20;
  c.house.library = 20;
  const rep = educationReport(game);
  const { school, library, academy } = rep.rows;
  assert.deepEqual(Object.keys(rep.rows), [...EDUCATION_KINDS]);
  assert.deepEqual([school.built, school.staffed, library.built, library.staffed], [1, 1, 1, 0]);
  assert.deepEqual([school.reach, library.reach, academy.reach], [50, 40, 0]);
  assert.deepEqual([school.need, school.served, school.shortHomes, school.pct], [60, 60, 0, 100]);
  assert.deepEqual([library.need, library.served, library.shortHomes, library.pct], [50, 30, 1, 60]);
  assert.deepEqual([academy.need, academy.served, academy.shortHomes, academy.pct], [30, 0, 1, 0]);
  assert.equal(rep.shortest.type, 'academy');
  // One home each is short of a library and an academy: the library comes
  // first (the ladder's order), and is built but has no workers.
  assert.deepEqual(rep.advice, { key: 'idle', type: 'library', homes: 1 });
  assert.match(educationAdviceText(rep.advice), /^1 home needs a library to keep or reach their level, and no Bibliotheca is working/);
});

test('education advice: held back first, then no demand, then a need the province cannot meet', () => {
  const row = (type, shortHomes, need, pct, built = 1) => ({ type, shortHomes, need, pct, built, working: built });
  const rows = (o) => ({ school: row('school', 0, 0, null), library: row('library', 0, 0, null), academy: row('academy', 0, 0, null), ...o });
  assert.deepEqual(pickEducationAdvice({ rows: rows({}) }), { key: 'noDemand' });
  assert.match(educationAdviceText({ key: 'noDemand' }), /Townhouses and up/);
  assert.deepEqual(pickEducationAdvice({ rows: rows({ school: row('school', 0, 100, 100) }) }), { key: 'fine' });
  assert.deepEqual(pickEducationAdvice({ rows: rows({ school: row('school', 2, 100, 80, 0) }) }), { key: 'build', type: 'school', homes: 2 });
  // A tie of homes held back goes to the school, then the library.
  assert.equal(pickEducationAdvice({ rows: rows({ school: row('school', 2, 100, 80), library: row('library', 2, 50, 10) }) }).type, 'school');
  // Every kind serving all who need it.
  assert.deepEqual(pickEducationAdvice({ rows: rows({ school: row('school', 0, 100, 100), library: row('library', 0, 50, 100) }) }), { key: 'fine' });
  assert.equal(educationAdviceText({ key: 'fine' }), 'Every home that needs schooling has it.');
  // An academy the province does not have.
  assert.deepEqual(pickEducationAdvice({ rows: rows({ school: row('school', 0, 100, 100), academy: row('academy', 4, 40, 0, 0) }), unlocked: (k) => k !== 'academy' }), { key: 'locked', type: 'academy', homes: 4 });
  assert.match(educationAdviceText({ key: 'locked', type: 'academy', homes: 4 }), /no Academia to build/);
});

// ---------------------------------------------------------------------------
// Entertainment
// ---------------------------------------------------------------------------

test('entertainment: seats, shows booked, the city-wide base, and homes short of their next level', () => {
  const { game, x, y } = plot('entertainment');
  game.city.population = 800;
  const theater = place(game, 'theater', x, y + 6);
  const amph = place(game, 'amphitheater', x + 3, y + 6);
  place(game, 'colosseum', x + 7, y + 6, false);
  place(game, 'actor_troupe', x + 13, y + 6);
  theater.shows.theater = 10;
  amph.shows.amphitheater = 10; // gladiators, but no actors
  // A Domus (9) needs entertainment 20 to become an Apartment House.
  const a = home(game, x, y, LEVEL.Domus, 10); // a theater visit: 10 + base
  home(game, x + 1, y, LEVEL.Domus, 10); // nothing but the base
  const c = home(game, x + 2, y, LEVEL.Domus, 10); // theater and amphitheater: plenty
  a.house.ent.theater = 30;
  c.house.ent.theater = 30;
  c.house.ent.amphitheater = 30;
  updateEntertainmentBase(game);
  const rep = entertainmentReport(game);
  const { theater: t, amphitheater: am, colosseum: co } = rep.venues;
  assert.deepEqual(Object.keys(rep.venues), [...VENUE_KINDS]);
  assert.deepEqual(Object.keys(rep.trainers), [...TRAINER_KINDS]);
  // Colonia's seats (not the original's 500 / 800 / 1,500), the rule behind the base.
  assert.equal(t.seats, VENUE_SEATS.theater);
  assert.equal(am.seats, VENUE_SEATS.amphitheater);
  assert.equal(co.seats, 0, 'an unstaffed venue seats nobody');
  assert.deepEqual([t.cover, am.cover, co.cover], [50, 100, 0]);
  assert.deepEqual({ ...game.city.entCoverage }, { theater: t.cover, amphitheater: am.cover, colosseum: co.cover }, 'what the sim itself counted');
  assert.equal(rep.base, game.city.entBase);
  assert.equal(rep.base, Math.floor((50 + 100 + 0) / 3 / 5));
  assert.ok(rep.base <= ENT_BASE_MAX);
  // Shows: kinds of show booked at staffed venues, of those they can stage.
  assert.deepEqual([t.showing, t.playing, t.slots], [1, 1, 1]);
  assert.deepEqual([am.showing, am.playing, am.slots], [1, 1, 2]);
  assert.deepEqual([co.built, co.staffed, co.slots], [1, 0, 0]);
  assert.deepEqual(am.empty, { theater: 1 }, 'the amphitheater has no actors');
  assert.deepEqual([t.reach, am.reach, co.reach], [20, 10, 0]);
  assert.deepEqual(rep.trainers.actor_troupe.supplies, ['theater', 'amphitheater']);
  // Homes: the base alone (10) is short of 20; a theater visit is enough.
  assert.deepEqual(rep.short, { none: 1, more: 0 });
  assert.equal(rep.needShows, 'amphitheater', 'its empty actors\' slot weighs 2');
  assert.deepEqual(rep.missing, { perfs: ['theater'], silent: false });
  // A venue without shows sends no entertainer, so the advice for homes with
  // no visit also names the venues that need performers.
  assert.deepEqual(rep.advice, { key: 'none', homes: 1, shows: { type: 'amphitheater', perfs: ['theater'], silent: false } });
  assert.equal(entertainmentAdviceText(rep.advice), '1 home short of entertainment gets no entertainer\'s visit. Amphitheatra lack plays: they need actors (Grex); a venue with both kinds of show is worth more. Build venues where there are none.');
  // The base and the cover are the day's count, what homes get until
  // tomorrow, even after a show runs out today; the seats are now.
  theater.shows.theater = 0;
  const later = entertainmentReport(game);
  assert.equal(later.base, game.city.entBase);
  assert.equal(later.venues.theater.cover, 50);
  assert.equal(later.venues.theater.seats, 0);
});

test('entertainment: the venue most in need of performers, by the original\'s weights, only for shows the province can train', () => {
  const v = (empty) => ({ empty });
  // One theater without a show weighs 1, an amphitheater's empty slot 2, a colosseum's 3.
  assert.equal(venueNeedingShows({ theater: v({ theater: 2 }), amphitheater: v({ theater: 1 }), colosseum: v({}) }), 'theater', 'two empty theaters tie with one empty amphitheater slot: the smaller venue wins');
  assert.equal(venueNeedingShows({ theater: v({ theater: 1 }), amphitheater: v({ theater: 1 }), colosseum: v({}) }), 'amphitheater');
  assert.equal(venueNeedingShows({ theater: v({ theater: 2 }), amphitheater: v({}), colosseum: v({ colosseum: 1 }) }), 'colosseum');
  assert.equal(venueNeedingShows({ theater: v({}), amphitheater: v({}), colosseum: v({}) }), null);
  // Without a Menagerie in the province, a colosseum's empty beasts' slot does not count.
  assert.equal(venueNeedingShows({ theater: v({ theater: 1 }), amphitheater: v({}), colosseum: v({ colosseum: 1 }) }, (k) => k !== 'menagerie'), 'theater');
  assert.match(performersText('amphitheater'), /^gladiators \(Ludus Gladiatorius\) or actors \(Grex\)$/);
});

test('entertainment advice, in the original\'s order', () => {
  assert.deepEqual(pickEntertainmentAdvice({ short: { none: 3, more: 2 } }), { key: 'none', homes: 3, shows: null });
  assert.equal(entertainmentAdviceText({ key: 'none', homes: 3, shows: null }), '3 homes short of entertainment get no entertainer\'s visit: build venues among the homes.');
  assert.deepEqual(pickEntertainmentAdvice({ short: { none: 3, more: 2 }, needShows: 'theater', missing: { perfs: ['theater'], silent: true } }).shows, { type: 'theater', perfs: ['theater'], silent: true });
  assert.deepEqual(pickEntertainmentAdvice({ short: { none: 0, more: 0 }, average: 0 }), { key: 'noDemand' });
  assert.deepEqual(pickEntertainmentAdvice({ short: { none: 0, more: 0 }, average: 14 }), { key: 'fine' });
  assert.deepEqual(pickEntertainmentAdvice({ short: { none: 2, more: 2 }, needShows: 'colosseum', missing: { perfs: ['colosseum'], silent: false } }), { key: 'shows', type: 'colosseum', perfs: ['colosseum'], silent: false });
  assert.equal(entertainmentAdviceText({ key: 'shows', type: 'colosseum', perfs: ['colosseum'], silent: false }), 'Arenae lack beast shows: they need beast tamers (Vivarium); a venue with both kinds of show is worth more.');
  assert.equal(entertainmentAdviceText({ key: 'shows', type: 'theater', perfs: ['theater'], silent: true }), 'Theatra stand without shows: they need actors (Grex).');
  assert.deepEqual(pickEntertainmentAdvice({ short: { none: 1, more: 4 }, needShows: null }), { key: 'more', homes: 4 });
  assert.match(entertainmentAdviceText({ key: 'noDemand' }), /Stone Cottages and up/);
  assert.match(entertainmentAdviceText({ key: 'shows', type: 'colosseum' }), /^Arenae stand without shows: they need gladiators \(Ludus Gladiatorius\) or beast tamers \(Vivarium\)\.$/);
  for (const a of [{ key: 'none', homes: 2 }, { key: 'fine' }, { key: 'shows', type: 'theater' }, { key: 'more', homes: 1 }]) {
    const t = entertainmentAdviceText(a);
    assert.ok(t.length > 10 && !t.includes(String.fromCharCode(0x2014)), `${a.key}: ${t}`);
  }
});

// ---------------------------------------------------------------------------
// The Overview's crime line
// ---------------------------------------------------------------------------

test('the crime line counts the criminals on the streets now, worst first', () => {
  const { game } = plot('crime-line');
  const crim = (type) => game.walkers.set(1000 + game.walkers.size, { id: 1000 + game.walkers.size, kind: 'criminal', type, dead: false });
  assert.equal(crimeNow(game).key, 'small', 'a town under 300');
  game.city.population = 400;
  assert.equal(crimeNow(game).key, 'calm');
  assert.deepEqual(crimeLine(crimeNow(game)), { text: 'No crime on the streets', level: 'ok' });
  crim('protester');
  assert.deepEqual(crimeLine(crimeNow(game)), { text: '1 protester in the streets', level: 'warn' });
  crim('thief');
  crim('thief');
  assert.deepEqual(crimeLine(crimeNow(game)), { text: '2 thieves about', level: 'bad' });
  crim('rioter');
  assert.equal(crimeNow(game).key, 'riot');
  assert.equal(crimeLine(crimeNow(game)).level, 'bad');
  const c1 = new Game({ scenario: withDifficulty(SCENARIOS.find((s) => s.id === 'c1'), 'normal') });
  assert.equal(crimeLine(crimeNow(c1)).text, 'No crime in this province');
  assert.equal(CONFIG.CRIME_MIN_POP, 300);
});

// ---------------------------------------------------------------------------
// A running city
// ---------------------------------------------------------------------------

test('in a running city the advisors\' figures agree with what the sim counts, and reading them changes nothing', () => {
  const game = newGame({ seed: 'demo' });
  buildDemoCity(game, { level: 3 });
  game.runDays(16 * 14);
  const state = () => { const s = serializeGame(game); delete s.meta.savedAt; return JSON.stringify(s); };
  const before = state();
  const rngState = () => [game.rng.a, game.rng.b, game.rng.c, game.rng.d].join(',');
  const rng = rngState();
  const hr = healthReport(game);
  const er = educationReport(game);
  const en = entertainmentReport(game);
  crimeNow(game);
  assert.equal(state(), before, 'the save is the same');
  assert.equal(rngState(), rng, 'no random numbers drawn');
  // The residents the culture rating counts as reached are the advisor's.
  const cov = computeCoverage(game);
  assert.ok(hr.people > 100, `a city of ${hr.people}`);
  for (const k of EDUCATION_KINDS) assert.equal(er.rows[k].reach, Math.round(cov[k] * er.people), k);
  let clinic = 0;
  for (const b of game.buildings.values()) if (b.house && b.house.pop > 0 && b.house.clinic > 0) clinic += b.house.pop;
  assert.equal(hr.rows.clinic.reach, clinic);
  assert.equal(hr.rows.clinic.built, [...game.buildings.values()].filter((b) => b.type === 'clinic').length);
  // The seats are the base's (the day's count has not changed since).
  assert.deepEqual({ ...game.city.entCoverage }, Object.fromEntries(VENUE_KINDS.map((k) => [k, en.venues[k].cover])));
  assert.equal(en.base, game.city.entBase);
  // Served never exceeds need, nor reach the people.
  for (const r of [...Object.values(hr.rows), ...Object.values(er.rows)]) {
    assert.ok(r.served <= r.need && r.reach <= hr.people, `${r.type}: ${r.served}/${r.need}, ${r.reach}`);
  }
});

/**
 * coverage.js
 * ----------------------------------------------------------------------------
 * The numbers behind the Health, Education and Entertainment advisors, read
 * from the city as the sim leaves it, and the one piece of advice each gives.
 * Read-only: nothing here changes the game (the original's Entertainment
 * advisor recomputed city values whenever it was opened; Colonia's must not).
 *
 * Coverage follows Colonia's own rules, not the original's places per
 * building:
 *   - Health and education reach homes by walker visits (sim/services.js),
 *     and a hospital by its area (HOSPITAL_RADIUS), with no limit on how many
 *     homes one building serves. So a service's coverage is the people it
 *     serves out of the people who need it: the residents of homes whose
 *     next level (their own, at the top) asks for it, and of those, the ones
 *     whose home has it. Its reach is everyone it visited, needed or not:
 *     what the culture rating and the health score count.
 *   - Entertainment has seats (data/buildings.js VENUE_SEATS: theater 400,
 *     amphitheater 900, colosseum 2,000; the original's were 500, 800 and
 *     1,500): a venue kind's coverage is the seats of its working venues
 *     (staffed, shows booked) as a share of the population, the rule behind
 *     the city-wide base (sim/entertainment.js seatCoverage).
 * Percentages are truncated, so 100 means everyone.
 *
 * The advice is the original's idea in Colonia's terms: the need that holds
 * the most homes back from their next level, each home counted once per need
 * (the original counted a home ready to move up twice, and never counted the
 * demand for academies). Needs no building of the province can meet come
 * last: the Problems overlay leaves such homes alone, and so does the advice.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { BUILDINGS, VENUE_BOTH_SHOWS, VENUE_SUPPLIERS } from '../data/buildings.js';
import { HOUSE_TIERS, MAX_TIER } from '../data/housing.js';
import { inHospitalReach, diseaseActive, diseaseEnabled } from './disease.js';
import { entertainmentScore } from './housing.js';
import { seatCoverage } from './entertainment.js';
import { crimeEnabled, criminalsAbout } from './crime.js';

/** Health buildings, in the advisor's order (care first: it matters most for disease). */
export const HEALTH_KINDS = Object.freeze(['clinic', 'hospital', 'baths', 'barber']);
/** Ties in the health advice go to the earlier of these (the original's order). */
export const HEALTH_ADVICE_ORDER = Object.freeze(['baths', 'barber', 'clinic', 'hospital']);
/** Education buildings, from the first level of schooling up; also the order ties go by. */
export const EDUCATION_KINDS = Object.freeze(['school', 'library', 'academy']);
/** Entertainment venues, smallest first; also the order ties go by. */
export const VENUE_KINDS = Object.freeze(['theater', 'amphitheater', 'colosseum']);
/** Training buildings (they send performers to venues), in the venues' order. */
export const TRAINER_KINDS = Object.freeze(
  Object.keys(BUILDINGS).filter((k) => BUILDINGS[k].kind === 'training')
    .sort((a, b) => VENUE_KINDS.indexOf(BUILDINGS[a].venue) - VENUE_KINDS.indexOf(BUILDINGS[b].venue)),
);
/**
 * How much an empty kind of show at a staffed venue weighs when the advisor
 * asks which venues most need performers (the original's 1, 2 and 3).
 */
export const SHOW_WEIGHTS = Object.freeze({ theater: 1, amphitheater: 2, colosseum: 3 });
/** The care advice speaks up when at least this share of the people has no medicus or hospital. */
export const NO_CARE_SHARE = 0.1;

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

/** `part` as a truncated percentage of `whole` (0-100), or null when there is no whole. */
export function coveragePct(part, whole) {
  if (!(whole > 0)) return null;
  return Math.max(0, Math.min(100, Math.floor((part * 100) / whole)));
}

/**
 * Which of the twelve coverage words (data/advisors.js COVERAGE_WORDS) a
 * percentage gets: 0 for none, 1-10 for 1-9% up to 90-99%, 11 for 100%.
 */
export function coverageBand(pct) {
  if (!(pct > 0)) return 0;
  if (pct >= 100) return 11;
  return 1 + Math.floor(pct / 10);
}

/** The needs a home is measured against: its next level's (its own at the top). Needs only grow up the ladder. */
export function nextNeeds(h) {
  return HOUSE_TIERS[Math.max(1, Math.min(MAX_TIER, h.tier + 1))];
}

/** Every occupied home. */
function eachHome(game, fn) {
  for (const b of game.buildings.values()) {
    const h = b.house;
    if (h && h.pop > 0) fn(b, h);
  }
}

/**
 * Buildings of each type: built, staffed (any workers), working (staffed,
 * and with piped water where it needs it) and their ids, in one pass.
 */
export function countBuildings(game, types) {
  const out = {};
  for (const t of types) out[t] = { built: 0, staffed: 0, working: 0, ids: [] };
  for (const b of game.buildings.values()) {
    const c = out[b.type];
    if (!c) continue;
    c.built++;
    c.ids.push(b.id);
    if (b.efficiency > 0) {
      c.staffed++;
      if (!b.def.needsPiped || b.hasWater) c.working++;
    }
  }
  return out;
}

/** A service's row: its buildings, then the people it reaches and serves (filled in by tally). */
function serviceRow(type, counts) {
  return { type, name: BUILDINGS[type].name, ...counts, reach: 0, need: 0, served: 0, shortHomes: 0, reachPct: null, pct: null };
}

/**
 * Count one home in a service's row: `has` it was visited (or is in reach),
 * `needs` its next level asks for it, `served` that need is met.
 */
function tally(row, pop, has, needs, served) {
  if (has) row.reach += pop;
  if (!needs) return;
  row.need += pop;
  if (served) row.served += pop;
  else row.shortHomes++;
}

function finishRows(rows, people) {
  for (const r of Object.values(rows)) {
    r.reachPct = coveragePct(r.reach, people);
    r.pct = coveragePct(r.served, r.need);
  }
}

/**
 * The need that holds the most homes back, among the services in `order`
 * (ties to the earlier), or null. Needs the province cannot meet (no such
 * building unlocked) only count when nothing else does: key 'locked'.
 * Otherwise 'build' (none built), 'idle' (none working) or 'more'.
 */
export function topShortage(rows, order, unlocked = () => true) {
  const short = order.map((k) => rows[k]).filter((r) => r && r.shortHomes > 0);
  if (!short.length) return null;
  const most = (list) => list.reduce((a, r) => (r.shortHomes > a.shortHomes ? r : a));
  const open = short.filter((r) => unlocked(r.type));
  if (!open.length) {
    const r = most(short);
    return { key: 'locked', type: r.type, homes: r.shortHomes };
  }
  const r = most(open);
  return { key: r.built === 0 ? 'build' : r.working === 0 ? 'idle' : 'more', type: r.type, homes: r.shortHomes };
}

/** Of the rows with people who need them, the one serving the smallest share (ties to the earlier), or null. */
export function lowestCoverage(rows, order) {
  let low = null;
  for (const k of order) {
    const r = rows[k];
    if (!r || r.pct === null) continue;
    if (!low || r.pct < low.pct) low = r;
  }
  return low;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/** Is city health going up, down or holding (it moves toward last month's average score)? */
export function healthTrend(hc) {
  if (hc.target > hc.value) return 'rising';
  if (hc.target < hc.value) return 'falling';
  return 'steady';
}

/**
 * The Health advisor's numbers:
 *   city    { value, target, trend, judged (the city is big enough for disease
 *             and for its health to move), disease (it happens in this province) }
 *   year, lastYear   outbreaks, deaths, cured ... (city.health), lastYear null in the first year
 *   sick    { homes, people } sick right now
 *   rows    by HEALTH_KINDS: buildings, reach, need, served, shortHomes, reachPct, pct
 *   noCare  residents with neither a medicus visit nor a hospital in reach
 *   advice  pickHealthAdvice
 */
export function healthReport(game) {
  const counts = countBuildings(game, HEALTH_KINDS);
  const rows = {};
  for (const k of HEALTH_KINDS) rows[k] = serviceRow(k, counts[k]);
  let people = 0;
  let homes = 0;
  let noCare = 0;
  const sick = { homes: 0, people: 0 };
  eachHome(game, (b, h) => {
    const pop = h.pop;
    people += pop;
    homes++;
    if (h.sick > 0) { sick.homes++; sick.people += pop; }
    const n = nextNeeds(h);
    const has = { barber: h.barber > 0, baths: h.baths > 0, clinic: h.clinic > 0, hospital: inHospitalReach(game, b) };
    if (!has.clinic && !has.hospital) noCare += pop;
    tally(rows.barber, pop, has.barber, n.barber > 0, has.barber);
    tally(rows.baths, pop, has.baths, n.baths > 0, has.baths);
    // Health care 1 is "a medicus or a hospital" (data/housing.js), so a
    // home that needs only that is served by a hospital as well; care 2
    // needs both, a medicus visit and a hospital in reach.
    tally(rows.clinic, pop, has.clinic, n.health >= 1, n.health >= 2 ? has.clinic : has.clinic || has.hospital);
    tally(rows.hospital, pop, has.hospital, n.health >= 2, has.hospital);
  });
  finishRows(rows, people);
  const hc = game.city.health;
  const report = {
    city: { value: hc.value, target: hc.target, trend: healthTrend(hc), judged: hc.bigEnough === true, disease: diseaseEnabled(game) },
    year: { ...hc.year },
    lastYear: hc.lastYear ? { ...hc.lastYear } : null,
    sick,
    people,
    homes,
    noCare,
    rows,
  };
  report.advice = pickHealthAdvice({ rows, unlocked: (k) => game.isUnlocked(k), noCare, people, diseaseOn: diseaseActive(game) });
  return report;
}

/**
 * The Health advisor's advice, most pressing first:
 *   the health building that holds the most homes back ('build' / 'idle' /
 *   'more', with its type and homes); else, where there is disease, 'care'
 *   when NO_CARE_SHARE or more of the people have no medicus or hospital
 *   (with their `share`, a percentage): such homes fall sick more often; else
 *   a need the province cannot meet ('locked'); else 'fine'.
 */
export function pickHealthAdvice({ rows, unlocked = () => true, noCare = 0, people = 0, diseaseOn = false }) {
  const top = topShortage(rows, HEALTH_ADVICE_ORDER, unlocked);
  if (top && top.key !== 'locked') return top;
  if (diseaseOn && people > 0 && noCare >= people * NO_CARE_SHARE) return { key: 'care', share: coveragePct(noCare, people) };
  return top || { key: 'fine' };
}

// ---------------------------------------------------------------------------
// Education
// ---------------------------------------------------------------------------

/**
 * The Education advisor's numbers: rows by EDUCATION_KINDS (as for health),
 * `shortest` (the row serving the smallest share of those who need it, or
 * null), and the advice (pickEducationAdvice).
 */
export function educationReport(game) {
  const counts = countBuildings(game, EDUCATION_KINDS);
  const rows = {};
  for (const k of EDUCATION_KINDS) rows[k] = serviceRow(k, counts[k]);
  let people = 0;
  eachHome(game, (b, h) => {
    const pop = h.pop;
    people += pop;
    const need = nextNeeds(h).edu;
    const s = h.school > 0;
    const l = h.library > 0;
    const a = h.academy > 0;
    // Education 1 is "a school or a library" (data/housing.js), so a home
    // that needs only that is served by a library as well.
    tally(rows.school, pop, s, need >= 1, need >= 2 ? s : s || l);
    tally(rows.library, pop, l, need >= 2, l);
    tally(rows.academy, pop, a, need >= 3, a);
  });
  finishRows(rows, people);
  const shortest = lowestCoverage(rows, EDUCATION_KINDS);
  const advice = pickEducationAdvice({ rows, unlocked: (k) => game.isUnlocked(k) });
  return { people, rows, shortest, advice };
}

/**
 * The Education advisor's advice: the building that holds the most homes
 * back ('build' / 'idle' / 'more'); else 'noDemand' when no home needs
 * schooling yet; else 'locked' (a need the province cannot meet); else
 * 'fine'. (Every home that needs a kind and lacks it counts as held back,
 * so a kind short of 100% always has homes held back.)
 */
export function pickEducationAdvice({ rows, unlocked = () => true }) {
  const top = topShortage(rows, EDUCATION_KINDS, unlocked);
  if (top && top.key !== 'locked') return top;
  if (!(rows.school.need > 0)) return { key: 'noDemand' };
  return top || { key: 'fine' };
}

// ---------------------------------------------------------------------------
// Entertainment
// ---------------------------------------------------------------------------

/** The kinds of show a venue can stage (performer types, as in `shows`). */
export function venueSlots(type) {
  return VENUE_BOTH_SHOWS[type] || [type];
}

/**
 * The Entertainment advisor's numbers:
 *   venues    by VENUE_KINDS: buildings, `showing` (staffed venues with any
 *             show booked), `slots` / `playing` (kinds of show those staffed
 *             venues can stage / have booked), `empty` (unbooked kinds of
 *             show by performer type), `seats` (of the venues with shows
 *             now), `cover` (% of the population seated, the seat rule, as
 *             counted at the start of the day), `reach` (residents an
 *             entertainer of the kind visited lately)
 *   trainers  by TRAINER_KINDS: buildings, and the venue kinds they supply
 *   base      the city-wide base every home gets today (0 to ENT_BASE_MAX).
 *             It and `cover` are the day's count (city.entBase,
 *             city.entCoverage), what homes' scores use until tomorrow;
 *             a show that ran out today counts again then.
 *   short     homes below their next level's entertainment: `none` (no
 *             entertainer visited: no venue near, or none near with shows)
 *             and `more` (some did, not enough)
 *   average   residents' average entertainment score
 *   needShows the venue kind most in need of performers, or null, and
 *   missing   the kinds of show it lacks that the province can train for
 *             (performer types), and whether none of them plays (`silent`)
 *   advice    pickEntertainmentAdvice
 */
export function entertainmentReport(game) {
  const counts = countBuildings(game, [...VENUE_KINDS, ...TRAINER_KINDS]);
  const seat = seatCoverage(game);
  const today = game.city.entCoverage || seat.cover;
  const venues = {};
  for (const k of VENUE_KINDS) {
    venues[k] = { type: k, name: BUILDINGS[k].name, ...counts[k], showing: 0, slots: 0, playing: 0, empty: {}, seats: seat.seats[k], cover: today[k] ?? seat.cover[k], reach: 0 };
  }
  for (const b of game.buildings.values()) {
    const v = venues[b.type];
    if (!v || !(b.efficiency > 0) || !b.shows) continue;
    for (const p of venueSlots(b.type)) {
      v.slots++;
      if (b.shows[p] > 0) v.playing++;
      else v.empty[p] = (v.empty[p] || 0) + 1;
    }
    if (Object.values(b.shows).some((d) => d > 0)) v.showing++;
  }
  const trainers = {};
  for (const k of TRAINER_KINDS) {
    const perf = BUILDINGS[k].venue;
    trainers[k] = { type: k, name: BUILDINGS[k].name, ...counts[k], supplies: VENUE_KINDS.filter((v) => VENUE_SUPPLIERS[v].includes(perf)) };
  }
  let people = 0;
  let points = 0;
  const short = { none: 0, more: 0 };
  eachHome(game, (b, h) => {
    const pop = h.pop;
    people += pop;
    const score = entertainmentScore(game, h);
    points += score * pop;
    let visited = false;
    for (const k of VENUE_KINDS) {
      if (h.ent[k] > 0) { venues[k].reach += pop; visited = true; }
    }
    if (score < nextNeeds(h).ent) short[visited ? 'more' : 'none']++;
  });
  const unlocked = (k) => game.isUnlocked(k);
  const needShows = venueNeedingShows(venues, unlocked);
  const missing = needShows ? missingShows(venues[needShows], unlocked) : null;
  const average = people > 0 ? points / people : 0;
  const base = game.city.entBase ?? seat.base;
  return {
    venues, trainers, base, people, short, average, needShows, missing,
    advice: pickEntertainmentAdvice({ short, average, needShows, missing }),
  };
}

/** A performer type some training building of the province trains. */
function trainable(perf, unlocked) {
  return TRAINER_KINDS.some((t) => BUILDINGS[t].venue === perf && unlocked(t));
}

/**
 * What a venue kind's staffed venues lack: { perfs (the kinds of show missing
 * somewhere that the province can train for), silent (no show plays at any) }.
 */
export function missingShows(v, unlocked = () => true) {
  return { perfs: Object.keys(v.empty || {}).filter((p) => trainable(p, unlocked)), silent: v.playing === 0 };
}

/**
 * The venue kind most in need of performers: each kind of show a staffed
 * venue stands without weighs SHOW_WEIGHTS of its venue kind (only shows a
 * training building of the province can supply); the heaviest kind wins,
 * ties to the smaller venue. null when nothing is missing.
 */
export function venueNeedingShows(venues, unlocked = () => true) {
  let best = null;
  let bestWeight = 0;
  for (const k of VENUE_KINDS) {
    const v = venues[k];
    if (!v || !v.empty) continue;
    let weight = 0;
    for (const [perf, n] of Object.entries(v.empty)) if (trainable(perf, unlocked)) weight += n * SHOW_WEIGHTS[k];
    if (weight > bestWeight) { best = k; bestWeight = weight; }
  }
  return best;
}

/**
 * The Entertainment advisor's advice, in the original's order:
 *   'none'     more homes short of entertainment have no entertainer's visit
 *              than have one ({ homes, and the venue kind needing shows with
 *              what it lacks, if any: a venue without shows sends no
 *              entertainer, so its neighbors count here too });
 *   'noDemand' no home is short and none has any entertainment yet;
 *   'fine'     no home is short;
 *   'shows'    a venue kind lacks performers ({ type, perfs, silent });
 *   'more'     homes want more: more venues, or bigger ones ({ homes }).
 */
export function pickEntertainmentAdvice({ short, average = 0, needShows = null, missing = null }) {
  const shows = needShows ? { type: needShows, perfs: missing ? missing.perfs : [], silent: missing ? missing.silent : false } : null;
  if (short.none > short.more) return { key: 'none', homes: short.none, shows };
  if (short.more === 0) return { key: average > 0 ? 'fine' : 'noDemand' };
  if (shows) return { key: 'shows', ...shows };
  return { key: 'more', homes: short.more };
}

// ---------------------------------------------------------------------------
// The Overview's crime line
// ---------------------------------------------------------------------------

/**
 * Crime right now, from the criminals on the streets (the original's chief
 * advisor read the day's counters, mostly 0, so its worst line never showed):
 * { key: 'off' (no crime in this province) | 'small' (under CRIME_MIN_POP
 * people) | 'riot' | 'thief' | 'protest' | 'calm', about (live criminals by
 * type), year (this year's counts) }.
 */
export function crimeNow(game) {
  const about = criminalsAbout(game);
  const year = { ...game.city.crime.year };
  let key = 'calm';
  if (!crimeEnabled(game)) key = 'off';
  else if (about.rioter > 0) key = 'riot';
  else if (about.thief > 0) key = 'thief';
  else if (about.protester > 0) key = 'protest';
  else if (game.city.population < CONFIG.CRIME_MIN_POP) key = 'small';
  return { key, about, year };
}

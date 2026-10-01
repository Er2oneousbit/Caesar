/**
 * coverageInfo.js
 * ----------------------------------------------------------------------------
 * The Health, Education and Entertainment advisors and the Overview's health
 * and crime lines in words (the numbers come from sim/coverage.js). Read-only:
 * nothing here changes the simulation.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { BUILDINGS, PERFORMER_NAMES, VENUE_SUPPLIERS, pluralName } from '../data/buildings.js';
import { HOUSE_TIERS } from '../data/housing.js';
import { COVERAGE_WORDS, CITY_HEALTH_VERDICTS, CITY_HEALTH_WARN, SHOW_NAMES } from '../data/advisors.js';
import { coverageBand, venueSlots, TRAINER_KINDS } from '../sim/coverage.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const homesText = (n) => plural(n, 'home');
const nameOf = (type) => BUILDINGS[type].name;

/** "Bibliothecae", "Theatra" ... (the Latin plurals live with the names, data/buildings.js). */
export { pluralName };

/** "Good (72%)", or "No one needs it yet" when nobody does (pct null). */
export function coverageText(pct) {
  if (pct === null || pct === undefined) return 'No one needs it yet';
  return `${COVERAGE_WORDS[coverageBand(pct)]} (${pct}%)`;
}

/** The coverage word alone ("None" ... "Full"). */
export function coverageWord(pct) {
  return COVERAGE_WORDS[coverageBand(pct || 0)];
}

/** The city's health as a sentence by tens. */
export function healthVerdict(value) {
  const v = Math.max(0, Math.min(100, Math.floor(value)));
  return CITY_HEALTH_VERDICTS[Math.min(10, Math.floor(v / 10))];
}

/** Is city health low enough to be drawn in red? */
export function healthIsLow(value) {
  return value < CITY_HEALTH_WARN;
}

/** The first level of the ladder that needs at least `min` of `key` (a HOUSE_TIERS field), by name. */
export function firstLevelNeeding(key, min = 1) {
  const t = HOUSE_TIERS.find((row) => row[key] >= min);
  return t ? t.name : null;
}

/** When homes start to need schooling, by level, as a sentence. */
export function educationLadderText() {
  const at = (n) => firstLevelNeeding('edu', n);
  return `Homes need a school or a library from ${at(1)} up, both from ${at(2)} up, and an academy as well from ${at(3)} up.`;
}

/** What a building does for a home that needs it, for the advice lines. */
const NEED_WORDS = {
  clinic: 'a medicus nearby',
  hospital: `a hospital within ${CONFIG.HOSPITAL_RADIUS} tiles`,
  baths: 'the baths',
  barber: 'a barber',
  school: 'a school',
  library: 'a library',
  academy: 'an academy',
};

/** A shortage ('build' / 'idle' / 'more' / 'locked') from topShortage, in words. */
function shortageText(a) {
  const who = `${homesText(a.homes)} need${a.homes === 1 ? 's' : ''} ${NEED_WORDS[a.type]} to keep or reach their level`;
  const name = nameOf(a.type);
  const them = a.homes === 1 ? 'it' : 'them';
  switch (a.key) {
    case 'build': return `${who}, and the city has no ${name} yet: build one near ${them}.`;
    case 'idle': return `${who}, and no ${name} is working: see that one has workers${BUILDINGS[a.type].needsPiped ? ' and piped water' : ''}.`;
    case 'more': return a.type === 'hospital'
      ? `${who}: build another ${name} within ${CONFIG.HOSPITAL_RADIUS} tiles of ${them}.`
      : `${who}: build another ${name} whose walkers pass ${them}.`;
    case 'locked': return `${who}, but this province has no ${name} to build.`;
    default: return '';
  }
}

/** The Health advisor's advice line. */
export function healthAdviceText(a) {
  switch (a.key) {
    case 'care': return `${a.share}% of the people have no medicus or hospital near: their homes fall sick more often.`;
    case 'fine': return 'Health care meets the needs of every home.';
    default: return shortageText(a);
  }
}

/** The Education advisor's advice line. */
export function educationAdviceText(a) {
  switch (a.key) {
    case 'noDemand': return `No home needs schooling yet: ${firstLevelNeeding('edu')}s and up do.`;
    case 'fine': return 'Every home that needs schooling has it.';
    default: return shortageText(a);
  }
}

/**
 * Performers and who trains them: "actors (Grex) or gladiators
 * (Ludus Gladiatorius)", for the given performer types (default: every kind
 * the venue takes).
 */
export function performersText(venue, perfs = VENUE_SUPPLIERS[venue]) {
  return perfs.map((perf) => {
    const trainer = TRAINER_KINDS.find((t) => BUILDINGS[t].venue === perf);
    return `${PERFORMER_NAMES[perf].toLowerCase()}s${trainer ? ` (${nameOf(trainer)})` : ''}`;
  }).join(' or ');
}

/** The Entertainment advisor's advice line. */
export function entertainmentAdviceText(a) {
  switch (a.key) {
    case 'none': {
      // A venue without shows sends no entertainer, so a home beside an idle
      // venue counts here too: name the venues that need performers.
      const who = `${homesText(a.homes)} short of entertainment get${a.homes === 1 ? 's' : ''} no entertainer's visit`;
      if (!a.shows) return `${who}: build venues among the homes.`;
      return `${who}. ${showsText(a.shows)} Build venues where there are none.`;
    }
    case 'noDemand': return `No home needs entertainment yet: ${firstLevelNeeding('ent')}s and up do.`;
    case 'fine': return 'Entertainment meets the needs of every home.';
    case 'shows': return showsText(a);
    case 'more': return `${homesText(a.homes)} want${a.homes === 1 ? 's' : ''} more entertainment: build more venues near ${a.homes === 1 ? 'it' : 'them'}, or bigger ones.`;
    default: return '';
  }
}

/**
 * A venue kind short of performers ({ type, perfs, silent }), in a sentence:
 * "Theatra stand without shows: they need actors (Grex)." or
 * "Amphitheatra lack plays: they need actors (Grex); a venue with
 * both kinds of show is worth more."
 */
export function showsText(s) {
  const known = !!(s.perfs && s.perfs.length);
  const perfs = known ? s.perfs : VENUE_SUPPLIERS[s.type];
  const need = `they need ${performersText(s.type, perfs)}`;
  if (s.silent || !known || venueSlots(s.type).length < 2) return `${pluralName(s.type)} stand without shows: ${need}.`;
  return `${pluralName(s.type)} lack ${perfs.map((p) => SHOW_NAMES[p]).join(' and ')}: ${need}; a venue with both kinds of show is worth more.`;
}

/** The Overview's health line: { text, low }. */
export function cityHealthLine(rep) {
  const { city, sick } = rep;
  const sickText = sick.homes ? `, ${homesText(sick.homes)} sick` : '';
  if (!city.judged) return { text: `Too small to judge (under ${CONFIG.DISEASE_MIN_POP} people)${sickText}`, low: false };
  const trend = city.trend === 'steady' ? '' : `, ${city.trend}`;
  return { text: `${city.value}: ${healthVerdict(city.value).toLowerCase()}${trend}${sickText}`, low: healthIsLow(city.value) };
}

/** The Overview's crime line: { text, level: 'ok' | 'warn' | 'bad' } (sim/coverage.js crimeNow). */
export function crimeLine(cr) {
  const n = (k) => cr.about[k];
  switch (cr.key) {
    case 'off': return { text: 'No crime in this province', level: 'ok' };
    case 'riot': return { text: `Rioting: ${plural(n('rioter'), 'rioter')} in the streets`, level: 'bad' };
    case 'thief': return { text: `${plural(n('thief'), 'thief', 'thieves')} about`, level: 'bad' };
    case 'protest': return { text: `${plural(n('protester'), 'protester')} in the streets`, level: 'warn' };
    case 'small': return { text: `No crime in a town under ${CONFIG.CRIME_MIN_POP} people`, level: 'ok' };
    default: return { text: 'No crime on the streets', level: 'ok' };
  }
}

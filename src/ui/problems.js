/**
 * problems.js
 * ----------------------------------------------------------------------------
 * What the Problems overlay shows: for each building, the one thing wrong
 * with it, or null.
 *
 *   homes      a sick home (sim/disease.js), then a home in unrest (mood under
 *              UNREST_MOOD, or one that already sent out a criminal; only
 *              where there is crime), each with a color of its own; then
 *              the first need that keeps a home from its next level, colored
 *              by kind (water, food, temples...); a tall column when the home
 *              is falling back a level, a shorter one when it only cannot
 *              grow; an empty lot no settler can reach. A home already as
 *              good as the province allows (its next level needs something
 *              the mission's buildings and partners cannot give) is no problem
 *   buildings  what the info panel's status line says is wrong: red for a
 *              building that does not work (no road, no workers, no water...),
 *              amber for one that works badly (understaffed, short of goods,
 *              nowhere to deliver)
 *
 * Each problem has the words for the overlay's tooltip.
 * ----------------------------------------------------------------------------
 */

import { HOUSE_TIERS, MAX_TIER } from '../data/housing.js';
import { BUILDINGS, VENUE_POINTS, VENUE_BOTH_BONUS, VENUE_BOTH_SHOWS, VENUE_SUPPLIERS, ENT_BASE_MAX } from '../data/buildings.js';
import { FOOD_TYPES } from '../data/goods.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';
import { buildingStatus, describeNeed } from './infoPanel.js';
import { SICK_COLOR } from '../data/disease.js';
import { crimeEnabled } from '../sim/crime.js';
import { moodWord, moodReasonText, criminalText } from './crimeInfo.js';
import { sickText } from './healthInfo.js';

const BAD = '#d9534f';
const WARN = '#f0ad4e';
/** A home in unrest: a dark wine red, apart from the "not working" red. */
export const UNREST_COLOR = '#8b1e3f';
/** A home below this mood is in unrest (a thief may come from it: CONFIG.THIEF_MOOD is 35). */
export const UNREST_MOOD = 30;

/** Kinds of need a home can lack: color and legend label, by need key. */
export const NEED_KINDS = Object.freeze({
  water: ['#3d7fe0', 'Water'],
  food: ['#e8a33a', 'Food'],
  religion: ['#9a5cc8', 'Temples'],
  ent: ['#e0609a', 'Entertainment'],
  edu: ['#2fa7a7', 'Education'],
  health: ['#58b25a', 'Health, barber, baths'],
  barber: ['#58b25a', 'Health, barber, baths'],
  baths: ['#58b25a', 'Health, barber, baths'],
  goods: ['#a86a3a', 'Goods and wine'],
  wine: ['#a86a3a', 'Goods and wine'],
  des: ['#cfc23a', 'Desirability'],
  space: ['#9a9a9a', 'Room to grow'],
});

/** The overlay's legend: [color, label] rows. */
export const PROBLEM_LEGEND = Object.freeze([
  [SICK_COLOR, 'Sick home'],
  [UNREST_COLOR, 'Home in unrest'],
  ...[...new Map(Object.values(NEED_KINDS).map(([c, l]) => [l, c]))].map(([l, c]) => [c, `Home needs: ${l.toLowerCase()}`]),
  [BAD, 'Not working'],
  [WARN, 'Working badly'],
]);

/** Per game: need -> can this mission meet it at all (the answers never change mid-game). */
const reachCache = new WeakMap();

/**
 * Could the city meet need `m` (an entry of a home's `blocked` list) at all,
 * with the buildings its mission unlocks and its trade partners?
 */
export function needReachable(game, m) {
  let cache = reachCache.get(game);
  if (!cache) reachCache.set(game, (cache = new Map()));
  const key = `${m.key}:${m.need}:${m.good || ''}`;
  if (!cache.has(key)) cache.set(key, reachable(game, m));
  return cache.get(key);
}

function reachable(game, m) {
  const has = (k) => game.isUnlocked(k);
  const partners = (game.scenario.partners || []).filter((id) => TRADE_PARTNERS[id]);
  const sells = (good) => partners.some((id) => TRADE_PARTNERS[id].sells[good]);
  const makes = (good, depth = 0) => depth < 3 && Object.entries(BUILDINGS).some(([k, d]) => d.produces === good && has(k)
    && (!d.recipe || Object.keys(d.recipe).every((raw) => makes(raw, depth + 1) || sells(raw))));
  const gets = (good) => makes(good) || sells(good);
  switch (m.key) {
    case 'water': return m.need >= 2 ? has('fountain') : has('well') || has('fountain');
    case 'food': return FOOD_TYPES.filter(gets).length >= m.need;
    case 'religion': return Object.keys(BUILDINGS).filter((k) => BUILDINGS[k].god && has(k)).length >= m.need;
    case 'ent': {
      // The best score: the city-wide base plus every venue that can get performers.
      const trained = (perf) => Object.keys(BUILDINGS).some((k) => BUILDINGS[k].kind === 'training' && BUILDINGS[k].venue === perf && has(k));
      const venues = Object.keys(VENUE_POINTS).filter((v) => has(v) && VENUE_SUPPLIERS[v].some(trained));
      let best = venues.length ? ENT_BASE_MAX : 0;
      for (const v of venues) best += VENUE_POINTS[v] + (VENUE_BOTH_SHOWS[v] && VENUE_BOTH_SHOWS[v].every(trained) ? VENUE_BOTH_BONUS[v] || 0 : 0);
      return best >= m.need;
    }
    case 'edu': return (has('school') || has('library') ? 1 : 0) + (has('school') && has('library') ? 1 : 0) + (has('school') && has('library') && has('academy') ? 1 : 0) >= m.need;
    case 'barber': return has('barber');
    case 'baths': return has('baths');
    case 'health': return (has('clinic') ? 1 : 0) + (has('hospital') ? 1 : 0) >= m.need;
    case 'goods': return gets(m.good);
    case 'wine': return (has('wine_ws') && makes('wine') ? 1 : 0) + partners.filter((id) => TRADE_PARTNERS[id].sells.wine).length >= m.need;
    default: return true; // desirability, room to grow
  }
}

/**
 * The one thing wrong with building `b`, or null.
 * @returns {{v:number, color:string, text:string}|null} v: 0..1 column height
 */
export function problemOf(game, b) {
  const hs = b.house;
  if (hs) {
    if (hs.pop <= 0) {
      if (b.accessRoad < 0) return { v: 0.55, color: BAD, text: 'Empty lot: no road within 2 tiles, so settlers cannot get here.' };
      if (b.noEntryRoute) return { v: 0.55, color: BAD, text: 'Empty lot: its road does not reach the map entrance.' };
      return null;
    }
    // Sickness and unrest come before what the home lacks to move up.
    if (hs.sick > 0) return { v: 1, color: SICK_COLOR, text: `${HOUSE_TIERS[hs.tier].name}. ${sickText(hs)}` };
    const unrest = unrestOf(game, b);
    if (unrest) return unrest;
    const blocked = hs.blocked || [];
    if (!blocked.length || (hs.tier >= MAX_TIER && !hs.devolving)) return null;
    // Growing: only if the next level can be reached here at all.
    if (!hs.devolving && !blocked.every((n) => needReachable(game, n))) return null;
    const m = blocked[0];
    const color = (NEED_KINDS[m.key] || NEED_KINDS.space)[0];
    const more = blocked.length > 1 ? ` (and ${blocked.length - 1} more need${blocked.length > 2 ? 's' : ''})` : '';
    const tier = HOUSE_TIERS[hs.tier];
    if (hs.devolving) {
      const left = Math.max(1, game.difficulty.devolveDays - (hs.devolveDays || 0));
      return { v: 1, color, text: `${tier.name}, falling back to ${HOUSE_TIERS[hs.tier - 1].name} in ${left} day${left > 1 ? 's' : ''}. Needs: ${describeNeed(m)}${more}` };
    }
    return { v: 0.55, color, text: `${tier.name}. To become a ${HOUSE_TIERS[hs.tier + 1].name}: ${describeNeed(m)}${more}` };
  }
  const s = buildingStatus(game, b);
  if (s.level === 'bad') return { v: 1, color: BAD, text: `${b.def.name}: ${s.text}` };
  if (s.level === 'warn') return { v: 0.55, color: WARN, text: `${b.def.name}: ${s.text}` };
  return null;
}

/**
 * A home in unrest (sim/mood.js, sim/crime.js): mood under UNREST_MOOD, or
 * a criminal already sent out. Only where there is crime.
 * @returns {{v:number, color:string, text:string}|null}
 */
export function unrestOf(game, b) {
  const hs = b.house;
  if (!hs || hs.pop <= 0 || hs.mood === null || hs.mood === undefined || !crimeEnabled(game)) return null;
  if (!(hs.mood < UNREST_MOOD) && !(hs.criminal > 0)) return null;
  const parts = [`${HOUSE_TIERS[hs.tier].name}, in unrest: mood ${hs.mood} (${moodWord(hs.mood).toLowerCase()}).`];
  const why = hs.mood < 50 ? moodReasonText(hs) : null;
  if (why) parts.push(why);
  const done = criminalText(hs);
  if (done) parts.push(done);
  return { v: hs.criminal > 0 ? 1 : 0.8, color: UNREST_COLOR, text: parts.join(' ') };
}

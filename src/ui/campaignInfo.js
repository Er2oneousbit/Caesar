/**
 * campaignInfo.js
 * ----------------------------------------------------------------------------
 * The words for the campaign's choice of province (data/scenarios.js steps
 * and tracks): the cards the victory and defeat screens offer where a step
 * has two missions, and the goals line the campaign list shows. Pure
 * functions of the scenario data: no DOM, so the tests read them in node.
 * ----------------------------------------------------------------------------
 */

import { MAP_TYPES } from '../world/mapgen.js';
import { RANKS } from '../data/ranks.js';
import { ARMY_KEYS } from '../data/scenarios.js';
import { withArticle } from '../sim/risk.js';

/** A track's tag on a card and in the campaign list. */
export const TRACK_NAMES = Object.freeze({ peaceful: 'Peaceful', military: 'Military' });

const num = (n) => Math.round(n).toLocaleString('en-US');

/** "Peaceful", "Military", or null for a mission alone at its step. */
export function trackName(s) {
  return TRACK_NAMES[s.track] || null;
}

/** "population 1,100, culture 35, prosperity 20, peace 48": the goals asked for (0 = not asked). */
export function goalsLine(s) {
  return Object.entries(s.goals).filter(([, v]) => v).map(([k, v]) => `${k} ${num(v)}`).join(', ');
}

/** The intro's first sentence: the province in a line. */
export function introLine(s) {
  return s.intro.split(/(?<=[.!?])\s+/)[0];
}

/**
 * What sets a province apart, in one plain line, read from its data so it
 * cannot drift from the game: when raiders first come, whether it has forts,
 * and Caesar's calls for troops; or, with no raids, what Rome judges instead.
 */
export function threatLine(s) {
  const has = (k) => s.unlocks === 'all' || s.unlocks.includes(k);
  const forts = ARMY_KEYS.some((k) => k.startsWith('fort_') && has(k));
  if (!s.military) {
    const judged = s.goals.favor > 0 ? 'culture, prosperity and the Emperor\'s favor' : 'culture and prosperity';
    return `No raiders${forts ? '' : ' and no forts'}: Rome judges you by ${judged}.`;
  }
  const years = Math.round(s.military.first / 12);
  const parts = [`First raid after about ${years} year${years === 1 ? '' : 's'}`];
  if (forts) parts.push(has('fort_archer') ? 'forts and a mixed army' : 'forts and a legion');
  if (s.distantBattles?.length) parts.push('Caesar may call for troops');
  return `${parts.join('; ')}.`;
}

/**
 * Everything a choice card shows for a mission: name and title, track, map,
 * goals, the intro's first line and the threats.
 */
export function postCard(s) {
  return {
    id: s.id,
    name: `${s.name}: ${s.title}`,
    track: trackName(s),
    map: `${MAP_TYPES[s.map.type].name}, ${s.map.size}×${s.map.size}`,
    goals: goalsLine(s),
    intro: introLine(s),
    threat: threatLine(s),
  };
}

/** The choice's heading: "Rome offers you two provinces, both for an Architect." */
export function choiceLine(missions) {
  const rank = withArticle(RANKS[missions[0]?.rank ?? 0].name);
  return `Rome offers you ${missions.length === 2 ? 'two provinces' : 'a choice of provinces'}, each for ${rank}. Read one briefing, go back and read the other before you choose.`;
}

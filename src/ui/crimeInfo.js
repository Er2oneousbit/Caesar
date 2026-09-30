/**
 * crimeInfo.js
 * ----------------------------------------------------------------------------
 * Home mood and crime in words, for the house panel and the crime overlay
 * (render/overlays.js). Read-only: nothing here changes the simulation.
 * ----------------------------------------------------------------------------
 */

import { MOOD_BANDS, CRIME_BANDS, CRIME_FLAGGED_HEIGHT, MOOD_REASONS } from '../data/crime.js';

const hasMood = (h) => !!h && h.pop > 0 && h.mood !== null && h.mood !== undefined;

/** "Content", "Grumbling" ... for a mood 0-100 (seven bands). */
export function moodWord(mood) {
  for (const [min, word] of MOOD_BANDS) if (mood >= min) return word;
  return MOOD_BANDS[MOOD_BANDS.length - 1][1];
}

/**
 * How much crime a home breeds: { height 0..10, words }. A home that has
 * already sent out a protester or thief shows at least CRIME_FLAGGED_HEIGHT.
 * null for an empty home.
 */
export function crimeBand(h) {
  if (!hasMood(h)) return null;
  let band = CRIME_BANDS[CRIME_BANDS.length - 1];
  for (const b of CRIME_BANDS) if (h.mood >= b[0]) { band = b; break; }
  let [, height, words] = band;
  if (h.criminal > 0 && height < CRIME_FLAGGED_HEIGHT) {
    height = CRIME_FLAGGED_HEIGHT;
    words = 'Trouble brewing';
  }
  return { height, words };
}

/** Why the home is unhappy, as a sentence, or null. */
export function moodReasonText(h) {
  return h && h.moodReason && MOOD_REASONS[h.moodReason] ? `${MOOD_REASONS[h.moodReason]}.` : null;
}

/** Does a prefect patrol this home (police cover), in words. */
export function policeText(h) {
  return h && h.police > 0 ? 'A prefect patrols this street.' : 'No prefect has passed lately.';
}

/** What the home has already done, or null. */
export function criminalText(h) {
  if (!h || !(h.criminal > 0)) return null;
  return h.criminal >= 2 ? 'It has already sent a thief out.' : 'It has already sent a protester out.';
}

/** The crime overlay's tooltip for a building (occupied homes only). */
export function crimeTip(game, b) {
  const h = b.house;
  if (!hasMood(h)) return null;
  const band = crimeBand(h);
  const parts = [`${band.words}. Mood ${h.mood} (${moodWord(h.mood).toLowerCase()}).`];
  const why = h.mood < 50 ? moodReasonText(h) : null;
  if (why) parts.push(why);
  const done = criminalText(h);
  if (done) parts.push(done);
  parts.push(policeText(h));
  if (game.scenario.crime === false) parts.push('(No crime in this province.)');
  return parts.join(' ');
}

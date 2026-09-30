/**
 * healthInfo.js
 * ----------------------------------------------------------------------------
 * Health and disease in words, for the house panel, the Disease overlay
 * (render/overlays.js) and the Problems overlay. Read-only: nothing here
 * changes the simulation.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { HEALTH_BANDS, DISEASE_RISK_BANDS, HEALTH_LACKS } from '../data/disease.js';
import { healthInputs, healthScore, healthLacks, diseaseEnabled } from '../sim/disease.js';

const occupied = (h) => !!h && h.pop > 0;

/** "Healthy", "Poor" ... for a health score 0-100. */
export function healthWord(score) {
  for (const [min, word] of HEALTH_BANDS) if (score >= min) return word;
  return HEALTH_BANDS[HEALTH_BANDS.length - 1][1];
}

/** Disease risk in words ("Low risk of disease"), in the fire overlay's bands. */
export function riskWords(risk) {
  const r = Math.round(risk || 0);
  for (const [min, words] of DISEASE_RISK_BANDS) if (r >= min) return words;
  return DISEASE_RISK_BANDS[DISEASE_RISK_BANDS.length - 1][1];
}

/** What lowers a home's score, as "no medicus or hospital, no baths", or null. */
export function lacksText(inp) {
  const keys = healthLacks(inp);
  return keys.length ? keys.map((k) => HEALTH_LACKS[k]).join(', ') : null;
}

/** A sick home, in words, or null. */
export function sickText(h) {
  if (!occupied(h) || !(h.sick > 0)) return null;
  return `Sick: ${h.sick} day${h.sick === 1 ? '' : 's'} left, unless a physician cures it sooner. It cannot move up or take in settlers.`;
}

/** Why there is no disease here now, or null when there can be. */
export function noDiseaseText(game) {
  if (!diseaseEnabled(game)) return 'There is no disease in this province.';
  if (game.city.population < CONFIG.DISEASE_MIN_POP) return `No disease while the city has under ${CONFIG.DISEASE_MIN_POP} people.`;
  return null;
}

/** A home's health at a glance: { score, word, lacks, risk, riskWords, sick }, or null for an empty home. */
export function homeHealth(game, b) {
  const h = b.house;
  if (!occupied(h)) return null;
  const inp = healthInputs(game, b);
  const score = healthScore(inp);
  const risk = Math.min(100, Math.round(h.diseaseRisk || 0));
  return { score, word: healthWord(score), lacks: lacksText(inp), risk, riskWords: riskWords(risk), sick: h.sick > 0 ? h.sick : 0 };
}

/**
 * The Disease overlay's column: { v 0..1, sick } for an occupied home, by its
 * disease risk (a sick home stands at full height), or null.
 */
export function healthColumn(b) {
  const h = b.house;
  if (!occupied(h)) return null;
  if (h.sick > 0) return { v: 1, sick: true };
  const v = Math.min(1, (h.diseaseRisk || 0) / CONFIG.DISEASE_THRESHOLD);
  return v >= 0.01 ? { v, sick: false } : null;
}

/** The Disease overlay's tooltip for a building (occupied homes only). */
export function healthTip(game, b) {
  const hh = homeHealth(game, b);
  if (!hh) return null;
  const parts = [];
  const sick = sickText(b.house);
  if (sick) parts.push(sick);
  parts.push(`Health ${hh.score} (${hh.word.toLowerCase()})${hh.lacks ? `: ${hh.lacks}` : ''}.`);
  if (!sick) parts.push(`${hh.riskWords}.`);
  const none = noDiseaseText(game);
  if (none) parts.push(`(${none})`);
  return parts.join(' ');
}

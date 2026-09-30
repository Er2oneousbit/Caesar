/**
 * ratings.js
 * ----------------------------------------------------------------------------
 * The four city ratings (0-100) and the scenario victory check.
 *
 *   Culture     religion, entertainment and education coverage
 *   Prosperity  housing quality, patricians, profit, employment, wages
 *   Peace       grows while citizens are content, drops with unrest
 *   Favor       the Emperor's opinion (see emperor.js for most changes)
 *
 * Ratings drift toward their target a few points per month so one good or
 * bad month does not swing them wildly.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { GOD_KEYS } from '../data/gods.js';
import { ledgerNet } from './economy.js';
import { entertainmentScore } from './housing.js';

/** Coverage shares (0..1) of the population for culture services. */
export function computeCoverage(game) {
  let pop = 0;
  let rel = 0;
  let school = 0;
  let library = 0;
  let academy = 0;
  let entPoints = 0;
  let health = 0;
  for (const b of game.buildings.values()) {
    const h = b.house;
    if (!h || h.pop <= 0) continue;
    pop += h.pop;
    let gods = 0;
    for (const g of GOD_KEYS) if (h.religion[g] > 0) gods++;
    if (gods > 0) rel += h.pop;
    if (h.school > 0) school += h.pop;
    if (h.library > 0) library += h.pop;
    if (h.academy > 0) academy += h.pop;
    entPoints += entertainmentScore(game, h) * h.pop;
    if (h.barber > 0 || h.clinic > 0 || h.baths > 0) health += h.pop;
  }
  const p = Math.max(1, pop);
  return {
    religion: rel / p,
    school: school / p,
    library: library / p,
    academy: academy / p,
    entertainment: entPoints / p, // average entertainment score per resident
    health: health / p,
  };
}

function approach(current, target, maxStep) {
  const d = Math.max(-maxStep, Math.min(maxStep, target - current));
  return Math.max(0, Math.min(100, Math.round((current + d) * 10) / 10));
}

export function updateRatings(game) {
  const c = game.city;
  const r = c.ratings;
  const cov = computeCoverage(game);
  c.coverage = cov;
  const hasSenate = [...game.buildings.values()].some((b) => b.type === 'senate' && b.efficiency > 0);
  const tiny = c.population < 100;

  // Culture
  const culture = tiny ? 0 : cov.religion * 25 + Math.min(1, cov.entertainment / 40) * 25 + cov.school * 15 + cov.library * 15 + cov.academy * 12 + (hasSenate ? 8 : 0);
  r.culture = approach(r.culture, culture, CONFIG.CULTURE_STEP);

  // Prosperity
  const net = ledgerNet(c.finance.lastYear);
  // Full marks for housing quality at an average of level 12 (Insula).
  let prosperity = Math.min(1, c.avgTier / 12) * 40;
  prosperity += Math.min(15, (c.patricians / Math.max(1, c.population)) * 100);
  prosperity += net > 0 ? 15 : net > -500 ? 5 : 0;
  prosperity += c.unemploymentRate < 0.05 ? 10 : c.unemploymentRate < 0.12 ? 5 : 0;
  prosperity += c.wage >= CONFIG.BASE_WAGE ? 8 : 0;
  prosperity += hasSenate ? 10 : 0;
  if (tiny) prosperity = Math.min(prosperity, 10);
  r.prosperity = approach(r.prosperity, prosperity, CONFIG.PROSPERITY_STEP);

  // Peace: slowly builds while people are content.
  if (c.sentiment >= CONFIG.PEACE_MOOD) r.peace = Math.min(100, r.peace + CONFIG.PEACE_PER_MONTH);
  else if (c.sentiment < 30) r.peace = Math.max(0, r.peace - 2);

  // Favor: gently returns toward 50.
  if (r.favor < 50) r.favor = Math.min(50, r.favor + 0.5);
  else if (r.favor > 50) r.favor = Math.max(50, r.favor - 0.5);
}

/** Which scenario goals are met right now. */
export function goalStatus(game) {
  const g = game.scenario.goals;
  const c = game.city;
  const rows = [];
  if (g.population) rows.push({ key: 'population', label: 'Population', have: c.population, need: g.population });
  for (const k of ['culture', 'prosperity', 'peace', 'favor']) {
    if (g[k]) rows.push({ key: k, label: k[0].toUpperCase() + k.slice(1), have: Math.floor(c.ratings[k]), need: g[k] });
  }
  for (const row of rows) row.ok = row.have >= row.need;
  return rows;
}

/** Monthly: victory / defeat checks. */
export function checkOutcome(game) {
  const c = game.city;
  if (c.ratings.favor <= 0 && !c.defeat) {
    c.defeat = true;
    game.events.emit('defeat', { reason: 'The Emperor has lost all faith in you and sent a replacement governor.' });
    return;
  }
  const rows = goalStatus(game);
  if (rows.length > 0 && !c.victory && rows.every((r) => r.ok)) {
    c.victory = true;
    game.events.emit('victory', { scenario: game.scenario.id });
  }
}

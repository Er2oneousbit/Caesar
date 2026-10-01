/**
 * governorInfo.js
 * ----------------------------------------------------------------------------
 * The words for the governor's rank, salary, savings and gifts (sim/governor.js,
 * sim/emperor.js), shown by the Imperial and Finance advisors, the sandbox
 * setup and the campaign's briefing and victory screens. Pure functions of
 * the game state: no DOM, so the tests read them in node.
 * ----------------------------------------------------------------------------
 */

import { RANKS } from '../data/ranks.js';
import { SCENARIOS } from '../data/scenarios.js';
import { salaryOf, salaryOutlook } from '../sim/governor.js';
import { GIFT_SIZES, GIFT_MEMORY_MONTHS, giftCost, giftFavor } from '../sim/emperor.js';
import { withArticle } from '../sim/risk.js';

/** A gift's share of the savings in words. */
const SHARE_WORDS = { 2: 'half your savings', 4: 'a quarter of your savings', 8: 'an eighth of your savings' };

const dn = (n) => `${Math.round(n).toLocaleString('en-US')} Dn`;

/** "Citizen: 0 Dn a month", the salary picker's line for a rank. */
export function salaryOption(rank, ownRank) {
  return `${RANKS[rank].name}: ${dn(RANKS[rank].salary)} a month${rank === ownRank ? ' (your rank)' : ''}`;
}

/** "Clerk, the rank of mission 2" or "Procurator, chosen when the city was founded". */
export function rankLine(game) {
  const rank = RANKS[game.city.governor.rank].name;
  const k = SCENARIOS.findIndex((s) => s.id === game.scenario.id);
  return k >= 0 ? `${rank}, the rank of mission ${k + 1}` : `${rank}, chosen when the city was founded`;
}

/**
 * Where the year's salary is heading and what Rome will make of it at New
 * Year (salaryOutlook in sim/governor.js), in one sentence.
 */
export function salaryOutlookText(game) {
  const gv = game.city.governor;
  if (game.city.victory) return 'The mission is won: Rome pays no more salary here.';
  const o = salaryOutlook(game);
  const own = RANKS[gv.rank].name;
  const head = `At this rate you will have drawn ${dn(o.paid)} by New Year`;
  if (o.favor < 0) return `${head}, ${withArticle(RANKS[o.worth].name)}'s pay, above your rank of ${own}: Rome takes ${-o.favor} favor for it then.`;
  if (o.favor > 0) return `${head}, less than ${withArticle(own)}'s pay: Rome will think well of it (+1 favor).`;
  return `${head}, ${withArticle(own)}'s pay: Rome expects no less and minds no more.`;
}

/** A gift button's words: "Lavish gift: 300 Dn (+10 favor)". */
export function giftLabel(game, size) {
  const f = giftFavor(game, size);
  return `${GIFT_SIZES[size].name}: ${dn(giftCost(game, size))} (${f > 0 ? `+${f} favor` : 'no favor'})`;
}

/** Why a gift button is greyed out, or null when it can be sent. */
export function giftBlocked(game, size) {
  if (giftFavor(game, size) <= 0) return 'The Emperor has had enough gifts of this size this year: it would please him no more.';
  const cost = giftCost(game, size);
  if (cost > game.city.governor.savings) return `Costs ${dn(cost)}; your savings hold ${dn(game.city.governor.savings)}.`;
  return null;
}

/** The line under the gift buttons: how gifts are priced and how many he has had lately. */
export function giftNote(game) {
  const gf = game.city.gifts;
  const shares = GIFT_SIZES.map((g) => `${withArticle(g.name.split(' ')[0].toLowerCase())} one ${SHARE_WORDS[g.share] || `1/${g.share}`} plus ${g.base} Dn`).join(', ');
  const price = `A gift is paid from your savings and costs more the more you have saved: ${shares}. Each further gift within a year of the last pleases the Emperor less.`;
  if (gf.recent <= 0) return price;
  const wait = GIFT_MEMORY_MONTHS - gf.monthsSince;
  return `${price} Gifts he has had from you lately: ${gf.recent}; the count starts again ${wait} month${wait === 1 ? '' : 's'} from now if you send no more.`;
}

/** The briefing's line before a mission: the rank and the savings brought along. */
export function briefingGovernorLine(scenario, savings) {
  const r = RANKS[scenario.rank ?? 0];
  return `You govern as ${withArticle(r.name)}, with a salary of ${dn(r.salary)} a month${savings > 0 ? ` and ${dn(savings)} of savings from your last post` : ''}.`;
}

/** The victory screen's line: the promotion and the savings that go with it, or null outside the campaign. */
export function victoryGovernorLine(game) {
  const k = SCENARIOS.findIndex((s) => s.id === game.scenario.id);
  if (k < 0) return null;
  const next = SCENARIOS[k + 1];
  const savings = dn(game.city.governor.savings);
  if (!next) return `Your savings of ${savings} are yours to keep.`;
  return `Rome promotes you to ${RANKS[next.rank].name}. Your savings of ${savings} go with you to ${next.name}.`;
}

/** The salary drawn now, in a few words (Finance advisor). */
export function salaryNow(game) {
  const gv = game.city.governor;
  if (game.city.victory) return 'none (mission won)';
  return `${dn(salaryOf(gv.salaryRank))} a month (${RANKS[gv.salaryRank].name}'s rate)`;
}

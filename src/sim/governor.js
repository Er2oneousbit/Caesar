/**
 * governor.js
 * ----------------------------------------------------------------------------
 * The governor himself: his rank, his salary, his personal savings and his
 * residence.
 *
 * Rank       fixed for the mission (scenario.rank; data/ranks.js). It sets
 *            the most salary Rome lets him draw.
 * Salary     his rank's rate or a lower rank's, chosen in the Imperial
 *            advisor (the rank's own by default). Never a higher rank's:
 *            Colonia's own rule (the original let a governor draw any rate
 *            and took favor for it at New Year, a trap more than a choice),
 *            so the picker greys those out and setSalary refuses them. Paid
 *            at each month's end from the treasury into his savings, after
 *            wages, taxes and army pay, and only while the treasury can
 *            cover it: the salary never puts the city in debt (Colonia's
 *            debt stops all building and costs favor every month, harsher
 *            than the original's, which paid down to -5,000 Dn). Not paid
 *            after the mission is won (the original stopped it too).
 * Favor      at each New Year, Rome judges what was actually paid over the
 *            year: the lowest rank whose year of pay covers it. Below the
 *            governor's own rank, by his own choice, favor rises by 1; at
 *            it, nothing. (The original looked only at the rate set on New
 *            Year's Eve; judging the year's pay means a modest rate must be
 *            kept all year to earn the point.)
 *            A save from before the rule may hold a rate above the rank. It
 *            is brought down to the rank as it loads, with no favor lost,
 *            and what was drawn above the rank's rate since New Year goes
 *            back from his savings to the treasury (salaryWithinRank): so no
 *            year's pay is ever above the rank, and nothing is left for a
 *            New Year or a victory to judge.
 * Savings    carried from mission to mission (the app keeps them in the
 *            campaign progress on victory). Spent on gifts to the Emperor
 *            (sim/emperor.js) or donated to the treasury, which the ledger
 *            shows on a line of its own and prosperity does not count as
 *            profit. Festivals stay paid from the treasury.
 * Residence  three sizes (data/buildings.js, kind 'residence'), one standing
 *            at a time; decor only, and the first thing rioters go for.
 * ----------------------------------------------------------------------------
 */

import { RANKS, TOP_RANK, SANDBOX_RANK, clampRank } from '../data/ranks.js';
import { transact } from './economy.js';
import { withArticle } from './risk.js';
import { findScenario, nextMissions, siblingOf } from '../data/scenarios.js';

/** The governor's state for a new game (city.governor). */
export function newGovernorState(scenario, savings = 0) {
  const rank = clampRank(scenario.rank, SANDBOX_RANK);
  return {
    rank,
    salaryRank: rank, // whose rate he draws: his own until he picks another
    savings: Math.max(0, Math.floor(savings)),
    paidThisYear: 0, // salary paid since New Year (the yearly favor rule)
  };
}

/** Monthly salary of a rank (Dn). */
export function salaryOf(rank) {
  return RANKS[clampRank(rank, 0)].salary;
}

/** The lowest rank whose year of pay covers `paid` Dn (what a year's pay "was worth"). */
export function rankForYearPay(paid) {
  for (let r = 0; r <= TOP_RANK; r++) if (RANKS[r].salary * 12 >= paid) return r;
  return TOP_RANK;
}

/**
 * Favor change for a year in which `paid` Dn of salary went to a governor
 * of `rank`: +1 below it, 0 at it. (A year above the rank cannot happen: the
 * rate never goes above it, and an older save's is brought down as it loads,
 * see salaryWithinRank.)
 */
export function salaryFavor(rank, paid) {
  return rankForYearPay(paid) < rank ? 1 : 0;
}

/**
 * How many months' salary the year so far holds when the month step runs in
 * `month` (0-11): the payment made as Ianuarius begins is December's, so it
 * closes the old year (game.onMonth runs before game.onYear).
 */
export function salaryMonthsSoFar(month) {
  return month === 0 ? 12 : month;
}

/** Why a rank's rate cannot be drawn: above the governor's own rank. Null when it can. */
export function salaryAboveRank(game, salaryRank) {
  const rank = game.city.governor.rank;
  if (salaryRank <= rank) return null;
  return `Rome pays no governor above his rank: ${withArticle(RANKS[rank].name)} draws at most ${RANKS[rank].salary} Dn a month.`;
}

/** Set the salary to a rank's rate, the governor's own or lower. @returns {{ok:boolean, reason?:string}} */
export function setSalary(game, salaryRank) {
  const gv = game.city.governor;
  if (game.city.victory) return { ok: false, reason: 'The mission is won: Rome no longer pays a salary here.' };
  if (!Number.isInteger(salaryRank) || salaryRank < 0 || salaryRank > TOP_RANK) return { ok: false, reason: 'Unknown salary.' };
  const above = salaryAboveRank(game, salaryRank);
  if (above) return { ok: false, reason: above };
  gv.salaryRank = salaryRank;
  return { ok: true };
}

/**
 * On load: a save from before the salary was held to the rank may draw a
 * higher rank's rate. It drops to the rank's own, and what was drawn above
 * the rank's rate since New Year goes back from the savings to the treasury
 * (as far as the savings hold it; the salary ledger line shrinks by as
 * much). No favor is lost: the old rule's New Year judgement is gone, and
 * this leaves no year's pay above the rank for it to have judged. Also
 * mends a rate that is not a rank at all (a hand-edited file).
 * @returns {number} Dn returned to the treasury
 */
export function salaryWithinRank(game) {
  const c = game.city;
  const gv = c.governor;
  if (!gv) return 0;
  const lowered = !(Number.isInteger(gv.salaryRank) && gv.salaryRank >= 0 && gv.salaryRank <= gv.rank);
  if (lowered) gv.salaryRank = gv.rank;
  const due = salaryOf(gv.rank) * salaryMonthsSoFar(game.time.month);
  const over = Math.max(0, (gv.paidThisYear || 0) - due);
  if (!lowered && over <= 0) return 0;
  // The year's pay counts no more than the rank's, whatever the savings
  // could give back: the year is judged as if the rate had always been it.
  gv.paidThisYear = Math.min(gv.paidThisYear || 0, due);
  const back = Math.min(gv.savings, over);
  if (back > 0) {
    gv.savings -= back;
    c.treasury += back;
    const ledger = c.finance?.thisYear;
    if (ledger && ledger.salary) ledger.salary = Math.max(0, ledger.salary - back);
  }
  const own = RANKS[gv.rank];
  const returned = `the ${back} Dn you drew above ${withArticle(own.name)}'s pay this year has gone back to the treasury`;
  if (lowered) game.message(`Rome now pays no governor above his rank: your salary is ${withArticle(own.name)}'s ${own.salary} Dn a month${back > 0 ? `, and ${returned}` : ''}.`, 'info');
  else if (back > 0) game.message(`Rome now pays no governor above his rank: ${returned}.`, 'info');
  return back;
}

/** Monthly (after wages, taxes and army pay): the salary into savings, when the treasury covers it. */
export function paySalary(game) {
  const c = game.city;
  const gv = c.governor;
  if (c.victory) return 0;
  const pay = salaryOf(gv.salaryRank);
  if (pay <= 0 || c.treasury < pay) return 0;
  transact(game, 'salary', -pay);
  gv.savings += pay;
  gv.paidThisYear += pay;
  return pay;
}

/** New Year: Rome weighs the year's salary against the rank, then the count starts again. */
export function salaryNewYear(game) {
  const c = game.city;
  const gv = c.governor;
  const paid = gv.paidThisYear;
  let d = c.victory ? 0 : salaryFavor(gv.rank, paid);
  // Rome thanks a governor who chose less than his rank's pay, not one whose
  // treasury could not pay him (paySalary skips a month it cannot cover).
  if (d > 0 && gv.salaryRank >= gv.rank) d = 0;
  gv.paidThisYear = 0;
  if (!d) return 0;
  const r = c.ratings;
  r.favor = Math.max(0, Math.min(100, r.favor + d));
  game.message(`Rome notes your modest salary: ${paid} Dn last year, less than ${withArticle(RANKS[gv.rank].name)}'s pay. Favor +${d}.`, 'good');
  return d;
}

/**
 * Where this year's salary is heading if the rate stays as it is: the pay
 * so far plus the current rate for the months left (this one included), and
 * the favor that would bring at New Year. For the Imperial advisor.
 */
export function salaryOutlook(game) {
  const gv = game.city.governor;
  const left = game.city.victory ? 0 : 12 - game.time.month;
  const paid = gv.paidThisYear + salaryOf(gv.salaryRank) * left;
  // As salaryNewYear: the point is for a lower rate chosen, not for months
  // the treasury could not pay at the rank's own.
  const chosen = gv.salaryRank < gv.rank;
  return { paid, favor: game.city.victory || !chosen ? 0 : salaryFavor(gv.rank, paid) };
}

/**
 * The campaign progress's savings record, made a plain object if it is
 * missing or damaged (a number or an array in a hand-edited or corrupted
 * record stopped the victory screen from opening).
 */
export function savingsRecord(progress) {
  const r = progress.savings;
  if (!r || typeof r !== 'object' || Array.isArray(r)) progress.savings = {};
  return progress.savings;
}

/** Move savings into the treasury. @returns {{ok:boolean, reason?:string, amount?:number}} */
export function donate(game, amount) {
  const gv = game.city.governor;
  const n = Math.floor(Number(amount));
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: 'Choose an amount to donate.' };
  if (n > gv.savings) return { ok: false, reason: `Your savings hold only ${gv.savings} Dn.` };
  gv.savings -= n;
  transact(game, 'donations', n);
  game.message(`You gave ${n} Dn of your own savings to the city's treasury.`, 'good');
  return { ok: true, amount: n };
}

/**
 * The campaign's record of savings (the app keeps it in its progress, with
 * the missions won): `record[id]` is what mission `id` starts with. Winning a
 * mission stores the governor's savings for every mission of the next step
 * (both siblings where the campaign branches), as the original kept one
 * figure per rank that both of its provinces read. So replaying a mission
 * later starts from what its step was last entered with. The last mission
 * has no next one: nothing is stored.
 * @returns {string[]} the ids written (none after the last step)
 */
export function storeCampaignSavings(record, missionId, savings) {
  const next = nextMissions(missionId).map((s) => s.id);
  for (const id of next) record[id] = Math.max(0, Math.floor(savings));
  return next;
}

/**
 * The savings a mission starts with: 0 for the first, the sandbox, or a
 * mission never reached. A mission with no entry of its own reads its
 * sibling's: a record from before the campaign branched holds c4 but not
 * Paestum beside it, and the same step means the same figure.
 */
export function campaignSavings(record, missionId) {
  if (!record || !findScenario(missionId)) return 0;
  const sibling = siblingOf(missionId);
  const v = record[missionId] === undefined && sibling ? record[sibling.id] : record[missionId];
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** The governor's residence standing in the city, or null. */
export function residenceOf(game) {
  for (const b of game.buildings.values()) if (b.def.kind === 'residence') return b;
  return null;
}

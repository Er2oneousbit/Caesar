/**
 * governor.js
 * ----------------------------------------------------------------------------
 * The governor himself: his rank, his salary, his personal savings and his
 * residence.
 *
 * Rank       fixed for the mission (scenario.rank; data/ranks.js). It sets
 *            the salary Rome expects him to draw.
 * Salary     any rank's rate, chosen in the Imperial advisor (the rank's own
 *            by default). Paid at each month's end from the treasury into
 *            his savings, after wages, taxes and army pay, and only while the
 *            treasury can cover it: the salary never puts the city in debt
 *            (Colonia's debt stops all building and costs favor every month,
 *            harsher than the original's, which paid down to -5,000 Dn).
 *            Not paid after the mission is won (the original stopped it too).
 * Favor      at each New Year, Rome judges what was actually paid over the
 *            year: the lowest rank whose year of pay covers it. Above the
 *            governor's own rank, favor falls by the gap (two ranks above:
 *            -2); below it, favor rises by 1; at it, nothing. (The original
 *            looked only at the rate set on New Year's Eve, so a governor
 *            could draw Caesar's pay all year and switch back the night
 *            before; judging the year's pay closes that.)
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
 * of `rank`: -gap above it, +1 below it, 0 at it.
 */
export function salaryFavor(rank, paid) {
  const gap = rankForYearPay(paid) - rank;
  if (gap > 0) return -gap;
  return gap < 0 ? 1 : 0;
}

/**
 * How many months' salary the year so far holds when the month step runs in
 * `month` (0-11): the payment made as Ianuarius begins is December's, so it
 * closes the old year (game.onMonth runs before game.onYear).
 */
export function salaryMonthsSoFar(month) {
  return month === 0 ? 12 : month;
}

/** Set the salary to a rank's rate. @returns {{ok:boolean, reason?:string}} */
export function setSalary(game, salaryRank) {
  const gv = game.city.governor;
  if (game.city.victory) return { ok: false, reason: 'The mission is won: Rome no longer pays a salary here.' };
  if (!Number.isInteger(salaryRank) || salaryRank < 0 || salaryRank > TOP_RANK) return { ok: false, reason: 'Unknown salary.' };
  gv.salaryRank = salaryRank;
  return { ok: true };
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
  const own = RANKS[gv.rank].name;
  if (d < 0) game.message(`Rome has weighed your salary: ${paid} Dn last year is ${withArticle(RANKS[rankForYearPay(paid)].name)}'s pay, above your rank of ${own}. Favor ${d}.`, 'bad');
  else game.message(`Rome notes your modest salary: ${paid} Dn last year, less than ${withArticle(own)}'s pay. Favor +${d}.`, 'good');
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
  return { paid, worth: rankForYearPay(paid), favor: game.city.victory ? 0 : salaryFavor(gv.rank, paid) };
}

/**
 * On victory (the month step, before any New Year): the year so far is never
 * weighed at a New Year, since the salary stops with the mission won, so
 * what the governor paid himself above his rank's rate this year is taken
 * back from his savings before they go on to the next mission. Without it,
 * drawing Caesar's pay from New Year to the victory cost nothing and
 * carried up to 1,100 Dn into the next mission.
 * @returns {number} Dn taken back
 */
export function salaryAtVictory(game) {
  const gv = game.city.governor;
  if (!gv) return 0;
  const due = salaryOf(gv.rank) * salaryMonthsSoFar(game.time.month);
  const over = Math.min(gv.savings, Math.max(0, gv.paidThisYear - due));
  if (over <= 0) return 0;
  gv.savings -= over;
  gv.paidThisYear -= over;
  game.message(`Rome has taken back ${over} Dn of this year's salary: more than ${withArticle(RANKS[gv.rank].name)}'s pay.`, 'bad');
  return over;
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

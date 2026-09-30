/**
 * loans.js
 * ----------------------------------------------------------------------------
 * Loans from Rome.
 *
 * A city in debt cannot build (CONFIG.DEBT_LIMIT), so one that lost its Forum
 * while in the red could never rebuild the one thing that brings money in
 * (found playing mission 3 on Insane). Rome lends LOAN_AMOUNT once no other
 * loan is outstanding, in debt or not, repaid in equal monthly instalments
 * over LOAN_MONTHS with the difficulty's loanInterest (10% on Easy to 40% on
 * Insane, over the whole term). The player asks for it (Finance advisor), so
 * a city that never borrows plays exactly as before.
 *
 * The loan and its repayments have ledger lines of their own ('loans',
 * 'repayments') but stay out of ledgerNet (economy.js): borrowed money is not
 * profit, and prosperity must not be bought with it.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { transact } from './economy.js';

/** What Rome offers this city now: { amount, total, monthly, months }. */
export function loanTerms(game) {
  const amount = CONFIG.LOAN_AMOUNT;
  const total = Math.round(amount * (1 + game.difficulty.loanInterest));
  const months = CONFIG.LOAN_MONTHS;
  return { amount, total, monthly: Math.ceil(total / months), months };
}

/** Take the loan: the money now, the repayments monthly. */
export function takeLoan(game) {
  const c = game.city;
  if (c.loan) return { ok: false, reason: 'A loan from Rome is still being repaid.' };
  const t = loanTerms(game);
  transact(game, 'loans', t.amount);
  c.loan = { left: t.total, monthly: t.monthly };
  game.message(`Rome lends you ${t.amount} Dn. It wants ${t.total} Dn back: ${t.monthly} Dn a month for ${t.months} months.`, 'good');
  return { ok: true };
}

/**
 * Monthly, before wages and taxes (game.js): pay the instalment (the last
 * one is what is left). It is paid even from an empty treasury: Rome does
 * not wait, and the debt that follows costs favor as any debt does, from
 * that same month.
 */
export function repayLoan(game) {
  const c = game.city;
  if (!c.loan) return;
  const pay = Math.min(c.loan.monthly, c.loan.left);
  transact(game, 'repayments', -pay);
  c.loan.left -= pay;
  if (c.loan.left <= 0) {
    c.loan = null;
    // The debt message comes once a spell of debt, so a city still in the red
    // hears here that Rome would lend again.
    const again = c.treasury < 0 ? ' The treasury is still in debt: Rome will lend again (Finance advisor).' : '';
    game.message(`The loan from Rome is repaid in full.${again}`, c.treasury < 0 ? 'warn' : 'good');
  }
}

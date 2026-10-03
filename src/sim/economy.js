/**
 * economy.js
 * ----------------------------------------------------------------------------
 * Money in, money out.
 *
 * Monthly:  wages are paid to every employed worker (wage is Dn/worker/year)
 *           taxes are collected from homes registered by a tax collector
 * Yearly:   the Emperor's tribute is due; the finance ledger rolls over
 *
 * The ledger (city.finance.thisYear / lastYear) feeds the Finance advisor.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { HOUSE_TIERS } from '../data/housing.js';

// 'loans' and 'repayments' (sim/loans.js) are shown but stay out of ledgerNet:
// borrowed money is not profit. 'donations' (the governor's savings given to
// the city, sim/governor.js) stay out too: a gift is not the city's profit.
// 'salary' (the governor's, paid into his savings) is spending like any other.
// 'gifts' is money sent for the Emperor's requests (the key is kept from when
// gifts to him were paid from the treasury, so older ledgers read the same).
export const LEDGER_KEYS = ['taxes', 'exports', 'other', 'loans', 'donations', 'wages', 'imports', 'construction', 'tribute', 'festivals', 'gifts', 'salary', 'military', 'plunder', 'stolen', 'repayments'];

export function newLedger() {
  const l = {};
  for (const k of LEDGER_KEYS) l[k] = 0;
  return l;
}

/** Add income (positive) or spending (negative) to the treasury and ledger. */
export function transact(game, category, amount) {
  const c = game.city;
  c.treasury += amount;
  const ledger = c.finance.thisYear;
  if (ledger[category] === undefined) ledger[category] = 0;
  ledger[category] += Math.abs(amount);
}

/**
 * The wage Rome pays (Dn a worker a year): what citizens hold the city's own
 * wage up against (the mood's wages factor, prosperity, the Labor advisor).
 * It starts at CONFIG.BASE_WAGE and moves only when Rome raises or cuts it
 * (a random event, sim/events.js), so a city without that event reads the
 * constant as it always did.
 */
export function romeWage(game) {
  const w = game.city.romeWage;
  return Number.isFinite(w) ? w : CONFIG.BASE_WAGE;
}

/** Can the city afford a purchase right now? (debug freebuild bypasses) */
export function canAfford(game, cost) {
  if (game.cheats.freeBuild) return true;
  return game.city.treasury - cost >= CONFIG.DEBT_LIMIT;
}

/**
 * Expected tax per month from one house at the current rate.
 * Yearly tax per resident = tier.tax * TAX_K at the default rate (7%),
 * scaling linearly with the rate. E.g. a Domus resident pays ~6 Dn/year.
 */
export function houseMonthlyTax(game, h) {
  const t = HOUSE_TIERS[h.tier];
  return (h.pop * t.tax * CONFIG.TAX_K * (game.city.taxRate / CONFIG.DEFAULT_TAX_RATE)) / 12;
}

/** Monthly finances. */
export function monthlyEconomy(game) {
  const c = game.city;
  // Wages
  const wages = Math.round((c.employed * c.wage) / 12);
  if (wages > 0) transact(game, 'wages', -wages);
  // Taxes
  let taxes = 0;
  let registered = 0;
  let unregistered = 0;
  for (const b of game.buildings.values()) {
    const h = b.house;
    if (!h || h.pop <= 0) continue;
    if (h.tax > 0) {
      taxes += houseMonthlyTax(game, h);
      registered += h.pop;
    } else {
      unregistered += h.pop;
    }
  }
  taxes = Math.round(taxes);
  if (taxes > 0) transact(game, 'taxes', taxes);
  c.taxCoverage = registered + unregistered > 0 ? registered / (registered + unregistered) : 0;
  c.lastMonth = { wages, taxes };
  // Debt makes the Emperor nervous.
  if (c.treasury < 0) {
    c.ratings.favor = Math.max(0, c.ratings.favor - 3);
    if (!c.flags.debtWarned) {
      c.flags.debtWarned = true;
      const offer = c.loan ? '' : ' Rome will lend you money: see the Finance advisor.';
      game.message(`The treasury is in debt! The Emperor's favor will fall every month until you recover, and nothing can be built.${offer}`, 'bad');
    }
  } else {
    c.flags.debtWarned = false;
  }
}

/** Yearly: tribute to Rome and ledger rollover. */
export function yearlyEconomy(game) {
  const c = game.city;
  const tribute = Math.round(Math.max(0, c.population - 150) * 0.5);
  if (tribute > 0) {
    if (c.treasury >= tribute) {
      transact(game, 'tribute', -tribute);
      c.ratings.favor = Math.min(100, c.ratings.favor + 3);
      game.message(`Annual tribute of ${tribute} Dn has been sent to Rome.`, 'info');
    } else {
      c.ratings.favor = Math.max(0, c.ratings.favor - 10);
      game.message(`The treasury could not pay the annual tribute of ${tribute} Dn. The Emperor is displeased.`, 'bad');
    }
  }
  c.finance.lastYear = c.finance.thisYear;
  c.finance.lastYear.balance = c.treasury;
  c.finance.thisYear = newLedger();
}

/** Net profit of a ledger (income minus spending). */
export function ledgerNet(l) {
  if (!l) return 0;
  // `|| 0`: ledgers from older saves have no military/plunder/stolen/salary rows.
  return (l.taxes + l.exports + l.other) - (l.wages + l.imports + l.construction + l.tribute + l.festivals + l.gifts + (l.salary || 0) + (l.military || 0) + (l.plunder || 0) + (l.stolen || 0));
}

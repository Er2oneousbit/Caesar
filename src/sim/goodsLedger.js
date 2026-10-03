/**
 * goodsLedger.js
 * ----------------------------------------------------------------------------
 * The city's goods book: for each good, how much was made, used (eaten,
 * worked up in a workshop, built into a boat or ship, used by homes, spent on recruits,
 * eaten and drunk at festivals, sent to the Emperor), imported and exported this month. At the turn of the month it
 * becomes last month's (city.goodsFlowLast), which the Production advisor
 * shows. Bookkeeping only: nothing in the simulation reads it.
 * ----------------------------------------------------------------------------
 */

/** Add n units of `good` to this month's `field` (made | used | imported | exported). */
export function logGoods(game, good, field, n) {
  if (!(n > 0)) return;
  const c = game.city;
  const book = c.goodsFlow || (c.goodsFlow = {});
  const row = book[good] || (book[good] = { made: 0, used: 0, imported: 0, exported: 0 });
  row[field] += n;
}

/** Monthly: this month's book becomes last month's. */
export function closeGoodsMonth(game) {
  const c = game.city;
  c.goodsFlowLast = c.goodsFlow || {};
  c.goodsFlow = {};
}

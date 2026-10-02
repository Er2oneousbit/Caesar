/**
 * tradeSwitches.js
 * ----------------------------------------------------------------------------
 * Whom the city trades each good with: the switches on each partner's route
 * card (Trade advisor, empire map). Colonia's own rule: in the original one
 * setting per good applied to every open route.
 *
 *   - Each partner has a switch for each good it sells or buys, on unless
 *     the player switched it off. A good trades with a partner only while
 *     the good's own setting (Import or Export, with its level: sim/trade.js
 *     setTradeMode) allows it AND that partner's switch is on. The good's
 *     setting stays the master: switching a partner on never makes a good
 *     on No trade move.
 *   - One switch per partner and good, for both ways: no partner both sells
 *     and buys the same good (the missions' demand included), and the
 *     good's setting picks one way anyway.
 *   - A partner with every good it deals in switched off sends no traders:
 *     its route stays open and the wait for the next trader runs as usual,
 *     but nobody sets out (sim/trade.js updateTrade). Switch a good on and
 *     the next trader comes when due.
 *   - State: each route's `off` holds { good: true } for the goods switched
 *     off, nothing for the rest, so a new game and an older save (core/save.js
 *     upgradeTradeSwitchesV20) have every switch on.
 * ----------------------------------------------------------------------------
 */

import { GOODS } from '../data/goods.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';

/** Is the city trading `good` with this partner (its switch on)? On for a game with no trade state (the pace tools' bare games). */
export function partnerOn(game, partnerId, good) {
  return !game.city?.trade?.routes?.[partnerId]?.off?.[good];
}

/** Switch a good on or off with one partner. */
export function setPartnerGood(game, partnerId, good, on) {
  const route = game.city.trade.routes[partnerId];
  if (!route || !GOODS[good]) return;
  if (!route.off || typeof route.off !== 'object') route.off = {};
  if (on) delete route.off[good];
  else route.off[good] = true;
}

/** The part of a { good: units } table this partner's switches leave on. */
export function onlyOn(game, partnerId, goods) {
  const out = {};
  for (const [good, n] of Object.entries(goods || {})) if (partnerOn(game, partnerId, good)) out[good] = n;
  return out;
}

/**
 * Has the player switched off every good this partner deals in (`buys`:
 * what it buys now, sim/tradeDemand.js partnerBuys)? Its traders stay home.
 * A partner that deals in nothing at all is not idle by the switches: it
 * comes as it always did.
 */
export function partnerIdle(game, partnerId, buys) {
  const goods = [...Object.keys(TRADE_PARTNERS[partnerId]?.sells || {}), ...Object.keys(buys || {})];
  return goods.length > 0 && goods.every((good) => !partnerOn(game, partnerId, good));
}

/**
 * The partners of a list (`ids`) that deal in a good one way, and how many of
 * them have their switch on: { on, all }. `side`: 'import' (it sells the
 * good) or 'export' (it buys it); `buysOf(id)`: what a partner buys now.
 */
export function partnersFor(game, ids, good, side, buysOf) {
  const deal = ids.filter((id) => (side === 'import' ? TRADE_PARTNERS[id]?.sells[good] > 0 : buysOf(id)[good] > 0));
  return { on: deal.filter((id) => partnerOn(game, id, good)).length, all: deal.length };
}

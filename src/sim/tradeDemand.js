/**
 * tradeDemand.js
 * ----------------------------------------------------------------------------
 * What each trade partner buys in a mission, and how often its traders come.
 * Pure: it reads the scenario and the date, never game state, so nothing here
 * is saved (a save made before a demand change loads and gets it on time).
 *
 * Demand in force (the original's quota tiers, in Colonia's units)
 *   A partner's yearly purchase of a good starts from its own table
 *   (TRADE_PARTNERS `buys`). A mission may set some of them for itself
 *   (scenario `demand: { partner: { good: units } }`), on the original's
 *   tiers of 15, 25 and 40 loads a year: DEMAND_TIERS. A mission may also
 *   schedule demand changes (scenario `demandChanges: [{ year, partner,
 *   good, to }]`): in the mission's year `year` (1 = its first), in a month
 *   from Martius to October drawn from the map's seed on a stream of its own
 *   (as distant battles draw theirs, sim/battle.js), the partner's yearly
 *   amount of that good becomes `to`; 0 stops it. Every change is worked out
 *   from the scenario and the date, so a change never needs saving.
 *
 * Busy routes come more often (Colonia's form of the original's rule that a
 *   route of large quotas keeps up to three traders in the province)
 *   A caravan carries CARAVAN_MAX_TRADE each way and comes every 32 to 56
 *   days, about 3,500 units a year; a ship carries SHIP_MAX_TRADE every 64
 *   to 96 days, about 5,800. A route whose larger direction (what it buys, or
 *   what it sells) is more than that comes proportionally more often: its
 *   interval is scaled by carry / volume, so on average its traders can carry
 *   its whole year. The line sits at the full carry, not below it, so every
 *   route of the first seven missions keeps its pace (the busiest, Aquileia's
 *   caravans at 3,200 and Corinthus's ships at 5,200, are at 92% and 90% of
 *   it).
 *
 * Far routes (Colonia's own rule: in the original a partner's place on the
 *   empire map changed nothing about trade)
 *   A trader needs tripDays days to come from its city and as many to go
 *   back (data/empireRoutes.js: half a day per map unit of its route). A
 *   quiet route's traders cannot come more often than one round trip, so
 *   the usual range [a, b] becomes [max(a, 2 x trip), that + (b - a)]. The
 *   busy rule then scales that range, so a far busy route keeps several
 *   traders on the road at once and still carries its whole year. Every
 *   round trip from the Etruscan coast (Alexandria's is the longest, 58
 *   days against the ships' 64) fits in the usual range: there, and for
 *   every near partner anywhere, nothing changes. The capacity model
 *   (sim/capacity.js) counts ships without distance (visitsPerYear): a far
 *   route sends fewer ships, but each stays longer for its bigger loads.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { RNG } from '../core/rng.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';
import { homeSiteId } from '../data/sites.js';
import { tripDays } from '../data/empireRoutes.js';

/** The original's yearly quota tiers (15, 25 and 40 loads of 100), and 0 for none. */
export const DEMAND_TIERS = Object.freeze([0, 1500, 2500, 4000]);

/** Days in a game year. */
const DAYS_PER_YEAR = CONFIG.DAYS_PER_MONTH * CONFIG.MONTHS_PER_YEAR;

/**
 * The month (0-11) of a mission's demand change number `k`: Martius to
 * October, drawn from the map's seed on its own stream (the game's random
 * stream is never touched).
 */
export function demandChangeMonth(seed, k) {
  return 2 + new RNG(`${seed}:demand:${k}`).range(0, 7);
}

/** The mission month (game.time.totalMonths) in which change number `k` takes effect. */
export function demandChangeAt(seed, change, k) {
  return (change.year - 1) * CONFIG.MONTHS_PER_YEAR + demandChangeMonth(seed, k);
}

/**
 * A partner's `demandChanges` entries, each with its index `k` and month
 * `at`, in the order they take effect: by month, then by place in the list.
 * Each month is drawn on its own, so two changes of one year may fall in
 * either order; applying them in list order would let an earlier entry
 * that comes later in the year be undone by one that came before it.
 */
export function changesInOrder(scenario, seed, partnerId) {
  const changes = scenario?.demandChanges || [];
  const out = [];
  changes.forEach((c, k) => { if (c.partner === partnerId) out.push({ c, k, at: demandChangeAt(seed, c, k) }); });
  return out.sort((a, b) => a.at - b.at || a.k - b.k);
}

/**
 * A partner's yearly purchases in force: its own table, the scenario's
 * `demand`, then every `demandChanges` entry due by mission month `month`, in
 * the order they take effect (changesInOrder). `before` (a change's index):
 * only the changes that take effect before that one, for "was" in its news.
 * Goods at 0 are left out (it no longer buys them).
 * @returns {Object<string, number>} good -> units a year
 */
export function buysInForce(scenario, seed, partnerId, month, before = -1) {
  const p = TRADE_PARTNERS[partnerId];
  if (!p) return {};
  const out = { ...p.buys, ...(scenario?.demand?.[partnerId] || {}) };
  for (const { c, k, at } of changesInOrder(scenario, seed, partnerId)) {
    if (k === before) break;
    if (at <= month) out[c.good] = c.to;
  }
  for (const g of Object.keys(out)) if (!(out[g] > 0)) delete out[g];
  return out;
}

/** What a partner buys in this game now (good -> units a year). */
export function partnerBuys(game, partnerId) {
  return buysInForce(game.scenario, game.seed, partnerId, game.time.totalMonths);
}

/**
 * The usual [shortest, longest] days between a route's traders, stretched
 * for a trader `trip` days from its city each way: never shorter than the
 * round trip, the spread kept. Exactly the usual range while the round trip
 * fits in it.
 */
export function usualInterval(kind, trip = 0) {
  const [a, b] = kind === 'sea' ? CONFIG.SHIP_INTERVAL_DAYS : CONFIG.CARAVAN_INTERVAL_DAYS;
  const lo = Math.max(a, 2 * trip);
  return [lo, lo + (b - a)];
}

/** Units a route's traders carry in a year at the usual pace (each way), for traders `trip` days away. */
export function carryPerYear(kind, trip = 0) {
  const [a, b] = usualInterval(kind, trip);
  const carry = kind === 'sea' ? CONFIG.SHIP_MAX_TRADE : CONFIG.CARAVAN_MAX_TRADE;
  return (carry * DAYS_PER_YEAR) / ((a + b) / 2);
}

/** A route's yearly volume: the larger of what it buys and what it sells. */
export function routeVolume(buys, sells) {
  const sum = (o) => Object.values(o || {}).reduce((n, v) => n + v, 0);
  return Math.max(sum(buys), sum(sells));
}

/** The factor a route's interval is scaled by: 1, or less for a route busier than its traders carry. */
export function visitFactor(kind, volume, trip = 0) {
  return volume > 0 ? Math.min(1, carryPerYear(kind, trip) / volume) : 1;
}

/**
 * The [shortest, longest] days between a route's traders for a yearly
 * volume and a trip of `trip` days each way (0: distance not counted): the
 * usual range stretched to the round trip (usualInterval), then scaled down
 * for a busy route (whole days, at least 1). Exactly the usual range when
 * the route is neither far nor busy, so the game's random draw for the next
 * visit is unchanged.
 */
export function visitInterval(kind, volume, trip = 0) {
  const range = usualInterval(kind, trip);
  const f = visitFactor(kind, volume, trip);
  if (f >= 1) return [range[0], range[1]];
  return [Math.max(1, Math.round(range[0] * f)), Math.max(1, Math.round(range[1] * f))];
}

/** A route's interval in this game now: its demand in force, its sales and its trip from the province's site. */
export function routeInterval(game, partnerId) {
  const p = TRADE_PARTNERS[partnerId];
  const kind = p?.route === 'sea' ? 'sea' : 'land';
  return visitInterval(kind, p ? routeVolume(partnerBuys(game, partnerId), p.sells) : 0, p ? tripDays(homeSiteId(game), partnerId) : 0);
}

/**
 * Traders a year a route sends on average for a yearly volume (the capacity
 * model's dock count). Distance is not counted: a far quiet route's ships
 * come less often but carry more each, so the days ships spend at the docks
 * follow the goods (see the header).
 */
export function visitsPerYear(kind, volume) {
  const [a, b] = visitInterval(kind, volume);
  return DAYS_PER_YEAR / ((a + b) / 2);
}

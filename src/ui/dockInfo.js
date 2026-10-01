/**
 * dockInfo.js
 * ----------------------------------------------------------------------------
 * Plain words for a Dock and the ship at it (sim/trade.js): the ship and how
 * long it has been tied up, what is still to unload and to load (and how much
 * of that is on a dock worker's cart), the dock workers out, and a hint when
 * the trade is stuck. No DOM here, so the tests can read the same words the
 * info panel shows.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { GOODS, formatAmount } from '../data/goods.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';
import { cartsOut } from '../sim/production.js';
import { dockWorkers, mooredShip, daysMoored, exportClaims } from '../sim/trade.js';
import { goodsList } from './storageInfo.js';
import { fmt } from './dom.js';

/** "wine 800"; horses, counted by the head: "3 horses". */
function amountOf(good, n) {
  const g = GOODS[good];
  return g.unitSize ? formatAmount(good, n) : `${g.name.toLowerCase()} ${fmt(n)}`;
}

/** "wine 800, clay 400", or '' for none. */
export function goodsAmounts(o) {
  return Object.entries(o || {}).filter(([, n]) => n > 0).map(([g, n]) => amountOf(g, n)).join(', ');
}

/** "Massilia ship, tied up 12 days (leaves by day 48 at the latest)". */
export function dockShipText(game, dock) {
  const ship = dock.shipId ? game.walkers.get(dock.shipId) : null;
  if (!ship) return 'None at the moment';
  const name = `${TRADE_PARTNERS[ship.partner]?.name || 'A'} ship`;
  if (ship.state === 'toDock') return `${name}, on its way`;
  if (ship.state !== 'docked') return `${name}, leaving`;
  const d = daysMoored(game, ship);
  return `${name}, tied up ${d} day${d === 1 ? '' : 's'} (leaves by day ${CONFIG.SHIP_MAX_STAY_DAYS} at the latest)`;
}

/**
 * The Dock panel's rows: what the moored ship still has to unload and to
 * load (with how much of that is on a worker's cart), and the dock workers.
 * @returns {[string, string][]}
 */
export function dockRows(game, dock) {
  const rows = [];
  const ship = mooredShip(game, dock);
  if (ship) {
    const onWay = exportClaims(game).byShip.get(ship.id) || {};
    const load = Object.entries(ship.wants || {}).filter(([, n]) => n > 0)
      .map(([g, n]) => `${amountOf(g, n)}${onWay[g] > 0 ? ` (${fmt(onWay[g])} on the way)` : ''}`);
    rows.push(['To unload', goodsAmounts(ship.unload) || 'Nothing']);
    rows.push(['To load', load.join(', ') || 'Nothing']);
  }
  const most = dockWorkers(dock);
  const full = dockWorkers({ efficiency: 1 });
  rows.push(['Dock workers', most > 0 ? `${cartsOut(game, dock)} of ${most} out (${full} at full staff)` : `none (no staff; ${full} at full staff)`]);
  return rows;
}

/**
 * Why the moored ship is waiting for exports that will not come, or null:
 * nothing it still wants can be fetched in time (no staffed warehouse near
 * enough holds any above your export level).
 */
export function dockHint(game, dock) {
  const ship = mooredShip(game, dock);
  if (!ship || !ship.wantsStuck) return null;
  const goods = Object.keys(ship.wants || {}).filter((g) => ship.wants[g] > 0);
  if (!goods.length) return null;
  return `No staffed warehouse within ${CONFIG.DOCK_REACH} road tiles has ${goodsList(goods)} to spare above your export level, that dock workers can bring before the ship sails.`;
}

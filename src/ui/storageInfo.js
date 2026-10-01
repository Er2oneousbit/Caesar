/**
 * storageInfo.js
 * ----------------------------------------------------------------------------
 * Plain words for a granary's or warehouse's orders (sim/storageOrders.js):
 * the label on each good's order button, and lines saying what Get and Empty
 * are doing right now. No DOM here, so the tests can read the same words the
 * info panel shows.
 * ----------------------------------------------------------------------------
 */

import { GOODS } from '../data/goods.js';
import { BUILDINGS } from '../data/buildings.js';
import { getGoods, orderCart, ORDER_MIN_STAFF, WAREHOUSE_GET_ROOM } from '../sim/storageOrders.js';

/** Button label and tooltip for each order. */
export const ORDER_LABELS = Object.freeze({
  accept: { label: 'Accept', title: 'Takes deliveries of this good. Click to refuse it.' },
  refuse: { label: 'Refuse', title: 'Takes no deliveries of this good (markets, traders and other storage can still take it out). Click to get it.' },
  get: { label: 'Get', title: 'Takes deliveries and sends its cart to fetch this good from other storage. Click to accept it only.' },
});

/** "wine", "wine and oil", "wine, oil and pottery". */
export function goodsList(goods) {
  const names = goods.map((g) => (GOODS[g]?.name || g).toLowerCase());
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * What the building's orders are doing, as status lines for the info panel.
 * @returns {{level:'good'|'warn'|'bad'|'', text:string}[]}
 */
export function orderLines(game, b) {
  if (!b.orders) return [];
  const granary = b.def.kind === 'granary';
  const kind = granary ? 'granary' : 'warehouse';
  const lines = [];
  const note = b.orderNote;
  const cart = orderCart(game, b);
  const gets = getGoods(b);
  const staffLine = (what) => ({ level: 'bad', text: `${what} needs at least ${Math.round(ORDER_MIN_STAFF * 100)}% of its workers to send the cart.` });
  if (b.emptying) {
    if (cart && cart.state === 'deliver' && cart.cargo) {
      lines.push({ level: 'good', text: `Emptying: ${goodsList([cart.cargo.good])} going out.` });
    } else if (cart && cart.state === 'return') {
      lines.push({ level: '', text: 'Emptying: its cart is on its way back for the next load.' });
    } else if (note?.kind === 'empty' && note.why === 'staff') {
      lines.push(staffLine('Emptying'));
    } else if (note?.kind === 'empty' && note.why === 'done') {
      lines.push({ level: 'good', text: `Emptying: nothing left to send. Turn Empty off to take deliveries again.` });
    } else if (!(note?.kind === 'empty' && note.why === 'nowhere')) {
      lines.push({ level: '', text: 'Emptying: its cart takes one load out each day it is free.' });
    }
    const stuck = note?.kind === 'empty' ? (note.why === 'nowhere' ? note.goods : note.stuck || []) : [];
    if (stuck.length) lines.push({ level: 'warn', text: `Emptying: nowhere to send ${goodsList(stuck)}.` });
    if (gets.length) lines.push({ level: '', text: 'Get is paused while emptying.' });
    return lines;
  }
  if (!gets.length) return lines;
  lines.push({
    level: '',
    text: granary
      ? `Get: fills the granary with ${goodsList(gets)} from other granaries on its roads.`
      : `Get: keeps 5 to 8 loads of ${goodsList(gets)}, fetching up to 4 from other warehouses when 4 or fewer are left.`,
  });
  if (cart && cart.state === 'collect') {
    const src = game.buildings.get(cart.target);
    lines.push({ level: 'good', text: `Its cart is fetching ${goodsList([cart.want])}${src ? ` from a ${BUILDINGS[src.type].name}` : ''}.` });
  } else if (cart && cart.state === 'return' && cart.cargo) {
    lines.push({ level: 'good', text: `Its cart is bringing back ${Math.round(cart.cargo.amount)} ${goodsList([cart.cargo.good])}.` });
  } else if (note?.kind === 'get') {
    if (note.why === 'staff') lines.push(staffLine('Get'));
    else if (note.why === 'nothing') lines.push({ level: 'warn', text: `Get: no other ${kind} on its roads has ${goodsList(note.goods)} to spare.` });
    else if (note.why === 'room') lines.push({ level: 'warn', text: `Get: needs room for ${WAREHOUSE_GET_ROOM / 100} loads (${WAREHOUSE_GET_ROOM} units) before it fetches.` });
    else if (note.why === 'full') lines.push({ level: '', text: 'Get: the granary is full.' });
  }
  return lines;
}

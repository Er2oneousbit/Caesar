/**
 * goods.js
 * ----------------------------------------------------------------------------
 * Every tradeable/storable resource.
 *
 *   kind:  'food'  eaten by houses, stored in granaries (and warehouses)
 *          'raw'   raw materials for workshops, stored in warehouses
 *          'goods' manufactured goods houses want, stored in warehouses
 *   buy:   Dn the city PAYS per cart (100 units) when importing
 *   sell:  Dn the city EARNS per cart when exporting
 *   color: used for cart cargo, warehouse stacks and UI chips
 * ----------------------------------------------------------------------------
 */

export const GOODS = Object.freeze({
  // Food
  wheat: { name: 'Wheat', kind: 'food', color: '#e4c35a', buy: 32, sell: 22, icon: '🌾' },
  vegetables: { name: 'Vegetables', kind: 'food', color: '#6aa84f', buy: 42, sell: 30, icon: '🥬' },
  fruit: { name: 'Fruit', kind: 'food', color: '#d9534f', buy: 44, sell: 32, icon: '🍎' },
  meat: { name: 'Meat', kind: 'food', color: '#b5655a', buy: 52, sell: 38, icon: '🍖' },
  // Raw materials
  clay: { name: 'Clay', kind: 'raw', color: '#b8683c', buy: 44, sell: 30, icon: '🧱' },
  timber: { name: 'Timber', kind: 'raw', color: '#8b5a2b', buy: 55, sell: 38, icon: '🪵' },
  olives: { name: 'Olives', kind: 'raw', color: '#7a8a3a', buy: 46, sell: 32, icon: '🫒' },
  grapes: { name: 'Grapes', kind: 'raw', color: '#6b3fa0', buy: 48, sell: 34, icon: '🍇' },
  iron: { name: 'Iron', kind: 'raw', color: '#6d7480', buy: 64, sell: 44, icon: '⛏' },
  marble: { name: 'Marble', kind: 'raw', color: '#e9e6df', buy: 210, sell: 150, icon: '🪨' },
  // Manufactured goods
  pottery: { name: 'Pottery', kind: 'goods', color: '#c7643e', buy: 170, sell: 128, icon: '🏺' },
  furniture: { name: 'Furniture', kind: 'goods', color: '#a0703c', buy: 200, sell: 150, icon: '🪑' },
  oil: { name: 'Oil', kind: 'goods', color: '#c9b13a', buy: 180, sell: 136, icon: '🛢' },
  wine: { name: 'Wine', kind: 'goods', color: '#7b1f3a', buy: 215, sell: 160, icon: '🍷' },
  weapons: { name: 'Weapons', kind: 'goods', color: '#9aa3ad', buy: 250, sell: 180, icon: '⚔' },
});

export const GOOD_KEYS = Object.freeze(Object.keys(GOODS));
export const FOOD_TYPES = Object.freeze(GOOD_KEYS.filter((k) => GOODS[k].kind === 'food'));
export const RAW_TYPES = Object.freeze(GOOD_KEYS.filter((k) => GOODS[k].kind === 'raw'));
export const MANUFACTURED = Object.freeze(GOOD_KEYS.filter((k) => GOODS[k].kind === 'goods'));

/** Goods houses consume (weapons are export/military only). */
export const HOUSE_GOODS = Object.freeze(['pottery', 'furniture', 'oil', 'wine']);

/** Empty stock record { wheat: 0, ... } */
export function emptyStock(keys = GOOD_KEYS) {
  const s = {};
  for (const k of keys) s[k] = 0;
  return s;
}

/**
 * goods.js
 * ----------------------------------------------------------------------------
 * Every tradeable/storable resource.
 *
 *   kind:  'food'  eaten by houses, stored in granaries (and warehouses)
 *          'raw'   raw materials for workshops, stored in warehouses. Linen
 *                  is one too, though a workshop makes it: what makes a good
 *                  'raw' is that a workshop works it up, so carts take it to
 *                  a Clothing Maker first and warehouses forward it to one
 *          'goods' manufactured goods houses want, stored in warehouses
 *   buy:   Dn the city PAYS per cart (100 units) when importing
 *   sell:  Dn the city EARNS per cart when exporting
 *   color: used for cart cargo, warehouse stacks and UI chips
 *   keptAt: (horses) the building type that keeps this good instead of a
 *          warehouse: horses live in the Horse Ranch's stables. Warehouses
 *          never take it; trade, the Emperor and the city's stock counts
 *          use those buildings as its store (sim/storage.js)
 * ----------------------------------------------------------------------------
 */

export const GOODS = Object.freeze({
  // Food
  wheat: { name: 'Wheat', kind: 'food', color: '#e4c35a', buy: 32, sell: 22, icon: '🌾' },
  vegetables: { name: 'Vegetables', kind: 'food', color: '#6aa84f', buy: 42, sell: 30, icon: '🥬' },
  fruit: { name: 'Fruit', kind: 'food', color: '#d9534f', buy: 44, sell: 32, icon: '🍎' },
  meat: { name: 'Meat', kind: 'food', color: '#b5655a', buy: 52, sell: 38, icon: '🍖' },
  // Fish (fishing wharves): a fifth food of its own, last among the foods, so
  // every loop over the foods keeps the first four in their old order. No
  // trade partner deals in it yet.
  fish: { name: 'Fish', kind: 'food', color: '#8fb3c2', buy: 48, sell: 34, icon: '🐟' },
  // Raw materials
  clay: { name: 'Clay', kind: 'raw', color: '#b8683c', buy: 44, sell: 30, icon: '🧱' },
  timber: { name: 'Timber', kind: 'raw', color: '#8b5a2b', buy: 55, sell: 38, icon: '🪵' },
  olives: { name: 'Olives', kind: 'raw', color: '#7a8a3a', buy: 46, sell: 32, icon: '🫒' },
  grapes: { name: 'Grapes', kind: 'raw', color: '#6b3fa0', buy: 48, sell: 34, icon: '🍇' },
  iron: { name: 'Iron', kind: 'raw', color: '#6d7480', buy: 64, sell: 44, icon: '⛏' },
  marble: { name: 'Marble', kind: 'raw', color: '#e9e6df', buy: 210, sell: 150, icon: '🪨' },
  // The cloth industry (not in the original): flax from a farm, spun and woven
  // into linen, sewn into clothing. Last among the raw materials, so every
  // loop over them keeps the others in their old order. Flax is priced like
  // the other crops; linen, made by a workshop, between a crop and finished
  // goods; clothing, two workshops from the field, above furniture.
  flax: { name: 'Flax', kind: 'raw', color: '#b7a974', buy: 44, sell: 30, icon: '🌿' },
  linen: { name: 'Linen', kind: 'raw', color: '#ece6d2', buy: 110, sell: 80, icon: '🧵' },
  // Manufactured goods
  pottery: { name: 'Pottery', kind: 'goods', color: '#c7643e', buy: 170, sell: 128, icon: '🏺' },
  furniture: { name: 'Furniture', kind: 'goods', color: '#a0703c', buy: 200, sell: 150, icon: '🪑' },
  oil: { name: 'Oil', kind: 'goods', color: '#c9b13a', buy: 180, sell: 136, icon: '🛢' },
  wine: { name: 'Wine', kind: 'goods', color: '#7b1f3a', buy: 215, sell: 160, icon: '🍷' },
  weapons: { name: 'Weapons', kind: 'goods', color: '#9aa3ad', buy: 250, sell: 180, icon: '⚔' },
  arrows: { name: 'Arrows', kind: 'goods', color: '#b89a64', buy: 130, sell: 95, icon: '🏹' },
  // Clothing (Clothing Maker: linen -> clothing): homes need it from the Insula up.
  clothing: { name: 'Clothing', kind: 'goods', color: '#4a6fa5', buy: 220, sell: 165, icon: '👕' },
  // Military stock: 100 units = one horse. Horses stay at the Horse Ranch
  // (keptAt): a warehouse is no place for a living animal.
  horses: { name: 'Horses', kind: 'stock', color: '#8a5a3c', buy: 420, sell: 300, icon: '🐎', unitSize: 100, unitName: 'horse', keptAt: 'horse_ranch' },
});

export const GOOD_KEYS = Object.freeze(Object.keys(GOODS));
export const FOOD_TYPES = Object.freeze(GOOD_KEYS.filter((k) => GOODS[k].kind === 'food'));
export const RAW_TYPES = Object.freeze(GOOD_KEYS.filter((k) => GOODS[k].kind === 'raw'));
export const MANUFACTURED = Object.freeze(GOOD_KEYS.filter((k) => GOODS[k].kind === 'goods'));
/** What a warehouse stores and has orders for: every good but those kept elsewhere (horses). */
export const WAREHOUSE_GOODS = Object.freeze(GOOD_KEYS.filter((k) => !GOODS[k].keptAt));

/**
 * The four foods that grow on land (the original's four food slots). Fish is
 * a fifth food, but some rules stay with these four so that a city without a
 * wharf plays exactly as before: Mercury's blessing brings these and no fish,
 * and a home's health still counts "every kind of food" as four.
 */
export const LAND_FOODS = Object.freeze(['wheat', 'vegetables', 'fruit', 'meat']);

/**
 * Military inputs: what a barracks uses to equip one recruit (units).
 *   legionary: half a cart of weapons (Weaponsmith: iron -> weapons)
 *   archer:    half a cart of arrows  (Fletcher: timber -> arrows)
 *   cavalry:   one horse              (Horse Ranch, or imports)
 */
export const RECRUIT_COST = Object.freeze({ legionary: { weapons: 50 }, archer: { arrows: 50 }, cavalry: { horses: 100 } });

/** Where each military input comes from (barracks status messages, help). */
export const RECRUIT_SOURCE = Object.freeze({ weapons: 'Fabrica', arrows: 'Officina Sagittaria', horses: 'Equaria' });

/** "3 horses" style display for goods with a unit size, units otherwise. */
export function formatAmount(good, units) {
  const g = GOODS[good];
  if (g && g.unitSize) {
    const n = Math.floor(units / g.unitSize);
    return `${n} ${g.unitName}${n === 1 ? '' : 's'}`;
  }
  return `${Math.round(units)} units`;
}

/**
 * Goods houses consume (weapons and arrows are export/military only).
 * Clothing comes last, so loops over the older four keep their order.
 */
export const HOUSE_GOODS = Object.freeze(['pottery', 'furniture', 'oil', 'wine', 'clothing']);

/** Empty stock record { wheat: 0, ... } */
export function emptyStock(keys = GOOD_KEYS) {
  const s = {};
  for (const k of keys) s[k] = 0;
  return s;
}

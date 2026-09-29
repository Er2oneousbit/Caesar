/**
 * overlays.js
 * ----------------------------------------------------------------------------
 * Information overlays (like a thermal camera for your city).
 *
 * Each overlay may define:
 *   tile(game, i)    -> CSS color to tint a ground tile, or null
 *   show(b)          -> true: draw the building normally (e.g. prefectures in
 *                      the fire overlay); false: draw it as a flat footprint
 *   house(b)         -> 0..1 column height for houses (coverage level)
 *   value(b)         -> 0..1 column height for any building (risk, staffing)
 *   bad              -> true when a high column is BAD (risks), for coloring
 *   walkers          -> walker types still drawn in this overlay
 * ----------------------------------------------------------------------------
 */

import { WaterBits } from '../world/map.js';
import { GOD_KEYS } from '../data/gods.js';
import { VENUE_POINTS } from '../data/buildings.js';
import { FOOD_TYPES } from '../data/goods.js';

const is = (...types) => (b) => types.includes(b.type);

export const OVERLAYS = [
  { key: 'none', name: 'No overlay', hotkey: '0' },
  {
    key: 'water', name: 'Water supply',
    tile(game, i) {
      const bits = game.map.water[i];
      if (bits & WaterBits.FOUNTAIN) return 'rgba(30,100,230,0.45)';
      if (bits & WaterBits.WELL) return 'rgba(90,180,235,0.4)';
      if (bits & WaterBits.PIPED) return 'rgba(120,150,210,0.18)';
      return null;
    },
    show: (b) => ['well', 'fountain', 'reservoir', 'baths'].includes(b.type),
    house: (b) => (b.house.water || 0) / 2,
    walkers: [],
  },
  {
    key: 'fire', name: 'Fire risk', bad: true,
    show: is('prefecture'),
    value: (b) => Math.min(1, b.fireRisk / 100),
    walkers: ['prefect'],
  },
  {
    key: 'damage', name: 'Collapse risk', bad: true,
    show: is('engineer_post'),
    value: (b) => Math.min(1, b.damageRisk / 100),
    walkers: ['engineer'],
  },
  {
    key: 'desirability', name: 'Desirability',
    tile(game, i) {
      const d = game.map.desirability[i];
      if (d === 0) return null;
      if (d > 0) return `rgba(40,170,60,${Math.min(0.6, 0.12 + d / 60).toFixed(2)})`;
      return `rgba(200,50,40,${Math.min(0.6, 0.12 - d / 40).toFixed(2)})`;
    },
    show: () => false,
    walkers: [],
  },
  {
    key: 'religion', name: 'Religion',
    show: (b) => !!b.def.god || b.type === 'oracle',
    house: (b) => GOD_KEYS.reduce((n, g) => n + (b.house.religion[g] > 0 ? 1 : 0), 0) / 4,
    walkers: ['priest'],
  },
  {
    key: 'entertainment', name: 'Entertainment',
    show: (b) => b.def.kind === 'venue' || b.def.kind === 'training',
    house: (b) => Object.keys(VENUE_POINTS).reduce((n, v) => n + (b.house.ent[v] > 0 ? VENUE_POINTS[v] : 0), 0) / 75,
    walkers: ['entertainer', 'performer'],
  },
  {
    key: 'education', name: 'Education',
    show: is('school', 'library', 'academy'),
    house: (b) => ((b.house.school > 0) + (b.house.library > 0) + (b.house.academy > 0)) / 3,
    walkers: ['teacher', 'librarian', 'scholar'],
  },
  {
    key: 'health', name: 'Health',
    show: is('barber', 'clinic', 'baths', 'hospital'),
    house: (b) => ((b.house.barber > 0) + (b.house.clinic > 0) + (b.house.baths > 0)) / 3,
    walkers: ['barber', 'physician', 'bather'],
  },
  {
    key: 'food', name: 'Food supply',
    show: (b) => b.type === 'market' || b.type === 'granary' || b.def.kind === 'farm',
    house: (b) => FOOD_TYPES.reduce((n, f) => n + (b.house.food[f] > 0.01 ? 1 : 0), 0) / 3,
    walkers: ['vendor', 'buyer', 'cart'],
  },
  {
    key: 'tax', name: 'Tax collection',
    show: is('forum', 'senate'),
    house: (b) => (b.house.tax > 0 ? 1 : 0),
    walkers: ['taxman'],
  },
  {
    key: 'labor', name: 'Employment',
    show: () => false,
    value: (b) => (b.def.workers ? b.efficiency : null),
    walkers: [],
  },
];

export function overlayByKey(key) {
  return OVERLAYS.find((o) => o.key === key) || OVERLAYS[0];
}

/** Column color for a 0..1 value. Good overlays go red->green, risk overlays green->red. */
export function columnColor(v, bad) {
  const t = bad ? v : 1 - v;
  const r = Math.round(60 + 190 * t);
  const g = Math.round(190 - 130 * t);
  const b = Math.round(70 - 30 * t);
  return `rgb(${r},${g},${b})`;
}

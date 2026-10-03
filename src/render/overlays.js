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
 *   column(b, game)  -> { v, color } or null: a column of its own color
 *                      (used instead of house/value)
 *   tip(game, b)     -> text for the tooltip over a building, or null
 *                      (the crime overlay's words live in ui/crimeInfo.js,
 *                      the health overlay's in ui/healthInfo.js)
 *   legend           -> [color, label] rows shown while the overlay is on
 *   walkers          -> walker types still drawn in this overlay
 * ----------------------------------------------------------------------------
 */

import { WaterBits } from '../world/map.js';
import { GOD_KEYS } from '../data/gods.js';
import { FOOD_TYPES } from '../data/goods.js';
import { educationTier } from '../sim/housing.js';
import { problemOf, PROBLEM_LEGEND } from '../ui/problems.js';
import { crimeBand, crimeTip } from '../ui/crimeInfo.js';
import { healthColumn, healthTip } from '../ui/healthInfo.js';
import { SICK_COLOR } from '../data/disease.js';
import { riskRates } from '../sim/risk.js';
import { landLayer } from '../sim/natives.js';
import { careScale } from '../sim/gardens.js';
import { careTip } from '../ui/gardenInfo.js';

const is = (...types) => (b) => types.includes(b.type);

export const OVERLAYS = [
  { key: 'none', name: 'No overlay', hotkey: '0' },
  {
    // Everything that is wrong, and why (ui/problems.js).
    key: 'problems', name: 'Problems',
    show: () => false,
    column: (b, game) => problemOf(game, b),
    tip: (game, b) => problemOf(game, b)?.text || null,
    legend: PROBLEM_LEGEND,
    walkers: [],
  },
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
    // No column over what can never burn (a warehouse, a garden): a column
    // there, however short, says it could. The same for collapse below.
    value: (b) => (riskRates(b).fire > 0 ? Math.min(1, b.fireRisk / 100) : null),
    walkers: ['prefect'],
  },
  {
    // Homes by how much crime they breed (their mood, sim/mood.js); a home
    // that already sent out a criminal stands tall whatever its mood.
    key: 'crime', name: 'Crime', bad: true,
    show: is('prefecture'),
    column: (b) => {
      const band = b.house ? crimeBand(b.house) : null;
      return band && band.height > 0 ? { v: band.height / 10, color: columnColor(band.height / 10, true) } : null;
    },
    tip: crimeTip,
    legend: [
      [columnColor(1, true), 'Crime is rife (or trouble already made)'],
      [columnColor(0.6, true), 'Much crime'],
      [columnColor(0.2, true), 'Little crime'],
    ],
    walkers: ['prefect', 'protester', 'thief', 'rioter'],
  },
  {
    key: 'damage', name: 'Collapse risk', bad: true,
    show: is('engineer_post'),
    value: (b) => (riskRates(b).damage > 0 ? Math.min(1, b.damageRisk / 100) : null),
    walkers: ['engineer'],
  },
  {
    // Gardens and statues by the share of their desirability their care
    // leaves them (sim/gardens.js): a full column while tended, down to a
    // quarter. The yards stand as they are, and their gardeners walk.
    key: 'gardens', name: 'Gardens and statues',
    show: is('gardener_yard'),
    column: (b) => {
      if (!b.def.tended) return null;
      const v = careScale(b);
      return { v, color: columnColor(v, false) };
    },
    tip: careTip,
    legend: [
      [columnColor(1, false), 'Tended: its full desirability'],
      [columnColor(0.6, false), 'Fading untended'],
      [columnColor(0.25, false), 'Untended: down to a quarter'],
    ],
    walkers: ['gardener'],
  },
  {
    // The native villages' land (sim/natives.js): red where an angry village
    // attacks whatever is built, green where a calmed one's lies (until the
    // calm wears off). The original showed it in its risk overlay.
    key: 'natives', name: 'Native land',
    tile(game, i) {
      if (!game.city.natives) return null;
      const v = landLayer(game)[i];
      return v === 2 ? 'rgba(205,60,40,0.34)' : v === 1 ? 'rgba(60,165,80,0.3)' : null;
    },
    show: (b) => b.def.kind === 'village' || b.type === 'mission_post',
    legend: [
      ['rgba(205,60,40,0.8)', 'Angry village\'s land: building here starts an attack'],
      ['rgba(60,165,80,0.8)', 'Calmed by a missionary (for 100 days)'],
    ],
    walkers: ['missionary', 'native_trader'],
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
    show: (b) => b.def.kind === 'venue' || b.def.kind === 'training' || b.def.kind === 'part', // (part: the hippodrome's other sections)
    // The score the home had at its last daily check (95 = the top level's need).
    house: (b) => Math.min(1, ((b.house.levels && b.house.levels.ent) || 0) / 95),
    walkers: ['entertainer', 'charioteer', 'performer'],
  },
  {
    key: 'education', name: 'Education',
    show: is('school', 'library', 'academy'),
    house: (b) => educationTier(b.house) / 3,
    walkers: ['teacher', 'librarian', 'scholar'],
  },
  {
    key: 'health', name: 'Health',
    show: is('barber', 'clinic', 'baths', 'hospital'),
    house: (b) => ((b.house.barber > 0) + (b.house.clinic > 0) + (b.house.baths > 0)) / 3,
    walkers: ['barber', 'physician', 'bather'],
  },
  {
    // Homes by disease risk (sim/disease.js), like the fire overlay; a sick
    // home stands at full height in a color of its own. Its own overlay: it
    // once replaced the Health one above, and with it the only view of which
    // homes a barber, medicus and baths reach.
    key: 'disease', name: 'Disease', bad: true,
    show: is('barber', 'clinic', 'baths', 'hospital'),
    column: (b) => {
      const col = b.house ? healthColumn(b) : null;
      if (!col) return null;
      return { v: col.v, color: col.sick ? SICK_COLOR : columnColor(col.v, true) };
    },
    tip: healthTip,
    legend: [
      [SICK_COLOR, 'Sick home'],
      [columnColor(0.9, true), 'Disease is close'],
      [columnColor(0.5, true), 'Some risk of disease'],
      [columnColor(0.1, true), 'Very low risk'],
    ],
    walkers: ['physician', 'barber', 'bather'],
  },
  {
    key: 'food', name: 'Food supply',
    show: (b) => b.type === 'market' || b.type === 'granary' || b.def.kind === 'farm' || b.def.kind === 'wharf' || b.def.kind === 'shipyard',
    house: (b) => FOOD_TYPES.reduce((n, f) => n + (b.house.food[f] > 0.01 ? 1 : 0), 0) / 3,
    walkers: ['vendor', 'buyer', 'cart', 'fishing_boat'],
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

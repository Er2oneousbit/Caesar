/**
 * production.js
 * ----------------------------------------------------------------------------
 * The Production advisor's figures (no DOM here, so tests can read them):
 *
 *   goods      per good: made, used, imported and exported last month
 *              (sim/goodsLedger.js), what the storehouses hold now, and the
 *              month's net change
 *   troubles   buildings that do not work or work badly, grouped by kind of
 *              building and reason (the info panel's status line)
 *   hints      the bottlenecks in plain words: workshops waiting for a raw
 *              material, buildings without workers, harvests with nowhere to
 *              go, goods used faster than they come in, homes short of food
 * ----------------------------------------------------------------------------
 */

import { BUILDINGS, pluralName } from '../data/buildings.js';
import { GOODS, GOOD_KEYS } from '../data/goods.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';
import { cityStock } from '../sim/storage.js';
import { buildingStatus } from './infoPanel.js';
import { withArticle } from '../sim/risk.js';

/** "3 producers", "a producer". */
function count(n, name) {
  return n === 1 ? `a ${name}` : `${n} ${name}${/s$/.test(name) ? '' : 's'}`;
}

/** "a Figlina", "3 Figlinae": a building type counted, with its Latin plural. */
function countType(n, type) {
  return n === 1 ? withArticle(BUILDINGS[type].name) : `${n} ${pluralName(type)}`;
}

/** "clay", "clay and timber". */
function andList(items) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Buildings the mission allows that make `good`, in the plural ("Figlinae"). */
function makersOf(game, good) {
  return Object.entries(BUILDINGS).filter(([k, d]) => d.produces === good && game.isUnlocked(k)).map(([k]) => pluralName(k));
}

/** Trade partners of this mission that sell `good`. */
function sellersOf(game, good) {
  return (game.scenario.partners || []).filter((id) => TRADE_PARTNERS[id] && TRADE_PARTNERS[id].sells[good]).map((id) => TRADE_PARTNERS[id].name);
}

/** Everything the Production advisor shows. */
export function productionReport(game) {
  const c = game.city;
  const last = c.goodsFlowLast || null;
  // --- goods ---------------------------------------------------------------
  const goods = [];
  for (const k of GOOD_KEYS) {
    const f = (last && last[k]) || { made: 0, used: 0, imported: 0, exported: 0 };
    const stock = cityStock(game, k);
    if (!(f.made || f.used || f.imported || f.exported || stock)) continue;
    goods.push({ good: k, name: GOODS[k].name, made: f.made, used: f.used, imported: f.imported, exported: f.exported, stock, net: f.made + f.imported - f.used - f.exported });
  }
  // --- troubles --------------------------------------------------------------
  const groups = new Map();
  const statuses = [];
  for (const b of game.buildings.values()) {
    if (b.house) continue;
    const s = buildingStatus(game, b);
    if (s.level !== 'bad' && s.level !== 'warn') continue;
    statuses.push({ b, s });
    // One group per kind of building and reason (numbers aside: "at 60%", "3 / 8").
    const key = `${b.type}|${s.level}|${s.text.replace(/\d+/g, '#')}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { name: b.def.name, level: s.level, text: s.text, ids: [] }));
    g.ids.push(b.id);
  }
  const troubles = [...groups.values()].sort((a, b) => (a.level === b.level ? b.ids.length - a.ids.length : a.level === 'bad' ? -1 : 1));
  // --- hints -----------------------------------------------------------------
  const hints = [];
  const waiting = new Map(); // workshop type -> { type, goods: Set, n }
  let noWorkers = 0;
  let noStorage = 0;
  for (const { b, s } of statuses) {
    if (b.def.kind === 'workshop' && s.text.startsWith('Waiting for')) {
      const w = waiting.get(b.type) || { type: b.type, goods: new Set(), n: 0 };
      for (const [good, n] of Object.entries(b.def.recipe)) if (b.stock[good] < n) w.goods.add(good);
      w.n++;
      waiting.set(b.type, w);
    } else if (/^(No workers available|Cannot find workers)/.test(s.text)) noWorkers++;
    else if (b.noStorage) noStorage++;
  }
  for (const w of waiting.values()) {
    const need = [...w.goods];
    const names = need.map((g) => GOODS[g].name.toLowerCase());
    const makers = [...new Set(need.flatMap((g) => makersOf(game, g)))];
    const sellers = [...new Set(need.flatMap((g) => sellersOf(game, g)))];
    const how = [makers.length ? `build more ${andList(makers)}` : null, sellers.length ? `import from ${andList(sellers)}` : null].filter(Boolean);
    hints.push(`${countType(w.n, w.type)} ${w.n === 1 ? 'is' : 'are'} waiting for ${andList(names)}${how.length ? `: ${how.join(', or ')}` : ''}.`);
  }
  if (noWorkers) hints.push(`${count(noWorkers, 'building')} ${noWorkers === 1 ? 'has' : 'have'} no workers: the city needs more people living near them, or labor priorities (Labor advisor).`);
  if (noStorage) hints.push(`${count(noStorage, 'producer')} ${noStorage === 1 ? 'has' : 'have'} nowhere to deliver: build a Granarium or a Horreum with room nearby.`);
  for (const r of goods) {
    const inflow = r.made + r.imported;
    if (r.used > inflow && r.stock < (r.used - inflow) * 3) {
      const months = r.used - inflow > 0 ? Math.floor(r.stock / (r.used - inflow)) : 0;
      hints.push(`${r.name}: ${Math.round(r.used)} used last month, ${Math.round(inflow)} came in; the ${Math.round(r.stock)} in store ${months < 1 ? 'will not last the month' : `last${months === 1 ? 's' : ''} about ${months} month${months === 1 ? '' : 's'}`}.`);
    }
  }
  const short = c.foodFlowLast ? c.foodFlowLast.shortfall : 0;
  if (short > 1) hints.push(`Homes went short of ${Math.round(short)} food last month: more farms, granaries or food imports.`);
  return { hasMonth: !!last, goods, troubles, hints };
}

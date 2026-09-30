/**
 * advisors.js
 * ----------------------------------------------------------------------------
 * The Advisors window: one tab per area of city management.
 *
 *   Overview   scenario goals, city mood and what drives it, trend charts
 *   Labor      workforce, wages, hiring priorities per category
 *   Population housing tiers, immigration
 *   Production goods made and used last month, idle buildings and why,
 *              the bottlenecks (ui/production.js)
 *   Finance    tax rate and the yearly ledger
 *   Trade      trade routes and import/export settings per good
 *   Military   threats, forts and their orders, supplies, battle record
 *   Religion   gods' moods and festivals
 *   Ratings    culture / prosperity / peace / favor explained
 *   Imperial   the Emperor's requests and gifts
 *   Messages   the full message log
 * ----------------------------------------------------------------------------
 */

import { h, mount, fmt, pct, bar, kv } from './dom.js';
import { CONFIG } from '../config.js';
import { LABOR_CATEGORIES } from '../data/buildings.js';
import { HOUSE_TIERS } from '../data/housing.js';
import { GOODS, GOOD_KEYS, RECRUIT_SOURCE, formatAmount } from '../data/goods.js';
import { UNIT_TYPES, FORT_CAPACITY } from '../data/units.js';
import { threatSummary, garrisonCounts, recallFort } from '../sim/military.js';
import { GODS, GOD_KEYS } from '../data/gods.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';
import { goalStatus } from '../sim/ratings.js';
import { LEDGER_KEYS, ledgerNet, houseMonthlyTax } from '../sim/economy.js';
import { openRoute, setTradeMode, routeKind } from '../sim/trade.js';
import { empireMapCanvas } from './empireMap.js';
import { cityStock } from '../sim/storage.js';
import { festivalCost, holdFestival } from '../sim/religion.js';
import { describeRequest, canFulfill, fulfillRequest, sendGift, GIFT_SIZES } from '../sim/emperor.js';
import { productionReport } from './production.js';

export const ADVISOR_TABS = [
  ['overview', 'Overview'],
  ['labor', 'Labor'],
  ['population', 'Population'],
  ['production', 'Production'],
  ['finance', 'Finance'],
  ['trade', 'Trade'],
  ['military', 'Military'],
  ['religion', 'Religion'],
  ['ratings', 'Ratings'],
  ['imperial', 'Imperial'],
  ['messages', 'Messages'],
];

const MOOD_LABELS = {
  base: 'Base contentment',
  taxes: 'Tax rate',
  wages: 'Wages',
  unemployment: 'Unemployment',
  food: 'Food supply',
  housing: 'Housing quality',
  gods: 'The gods\' moods',
  festival: 'Recent festivals',
  newCity: 'New city optimism',
  difficulty: 'Difficulty',
};

export class Advisors {
  constructor(app) {
    this.app = app;
    this.tab = 'overview';
    this.body = null;
    this.timer = 0;
    this.interacting = false;
    this.showNext = new Map(); // Production: which building of a trouble group "Show" goes to next
  }

  /** Build the modal element (UI puts it in the modal root). */
  element(tab) {
    if (tab) this.tab = tab;
    this.tabsEl = h('div', { class: 'tabs' });
    this.body = h('div', { class: 'modal-body' });
    const modal = h('div', { class: 'modal' },
      h('div', { class: 'modal-head' }, h('h2', {}, 'Advisors'), h('button', { class: 'panel-close', title: 'Close (Esc)', onclick: () => this.app.ui.closeModal() }, '×')),
      this.tabsEl,
      this.body);
    // Pause auto refresh while dragging sliders.
    modal.addEventListener('pointerdown', (e) => { if (e.target.tagName === 'INPUT') this.interacting = true; });
    modal.addEventListener('pointerup', () => { this.interacting = false; });
    this.render();
    return modal;
  }

  switchTab(tab) {
    this.tab = tab;
    this.render();
  }

  update(dt) {
    this.timer += dt;
    if (this.timer < 1.5 || this.interacting) return;
    this.timer = 0;
    const active = document.activeElement;
    if (active && this.body && this.body.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) return;
    this.render();
  }

  render() {
    if (!this.body || !this.app.game) return;
    mount(this.tabsEl, ADVISOR_TABS.map(([k, name]) => h('button', { class: `tab${k === this.tab ? ' active' : ''}`, onclick: () => this.switchTab(k) }, name)));
    const fn = this[`tab_${this.tab}`];
    const scroll = this.body.scrollTop;
    mount(this.body, fn ? fn.call(this, this.app.game) : 'Unknown tab');
    this.body.scrollTop = scroll;
  }

  // ------------------------------------------------------------------ tabs
  tab_overview(g) {
    const c = g.city;
    const goals = goalStatus(g);
    const f = c.sentimentFactors || {};
    return [
      h('div', { class: 'grid2' },
        h('div', { class: 'card' },
          h('h4', {}, `${g.scenario.name}: ${g.scenario.title}`),
          goals.length === 0 ? h('div', { class: 'muted' }, 'Sandbox: no goals. Build freely!') :
            goals.map((r) => h('div', {}, kv(`${r.ok ? '✔' : '✖'} ${r.label}`, `${fmt(r.have)} / ${fmt(r.need)}`, r.ok ? 'ok' : ''), bar(r.have, r.need))),
          c.victory ? h('div', { class: 'status good', style: { marginTop: '6px' } }, 'All goals achieved!') : null),
        h('div', { class: 'card' },
          h('h4', {}, 'At a glance'),
          kv('Population', fmt(c.population)),
          kv('Treasury', `${fmt(c.treasury)} Dn`),
          kv('Workforce / jobs', `${fmt(c.workforce)} / ${fmt(c.jobs)}`),
          kv('Unemployment', pct(c.unemploymentRate)),
          kv('Homes with food', pct(c.fedShare)),
          kv('Free housing space', fmt(c.vacancies || 0)),
          kv('Emperor\'s favor', `${Math.round(c.ratings.favor)}`))),
      trendCharts(c.history || []),
      h('div', { class: 'card', style: { marginTop: '10px' } },
        h('h4', {}, `City mood: ${c.sentiment} / 100`),
        bar(c.sentiment, 100),
        h('div', { class: 'muted', style: { margin: '4px 0' } }, 'Above 30 settlers keep arriving. Below 25 people start leaving.'),
        h('table', { class: 'tbl' }, Object.entries(f).map(([k, v]) => h('tr', {}, h('td', {}, MOOD_LABELS[k] || k), h('td', { class: `r num ${v > 0 ? 'ok' : v < 0 ? 'no' : ''}` }, `${v > 0 ? '+' : ''}${Math.round(v)}`))))),
    ];
  }

  tab_labor(g) {
    const c = g.city;
    const pri = c.laborPriority;
    const wageInput = h('input', {
      type: 'range', min: 8, max: 48, step: 1, value: c.wage,
      oninput: (e) => { c.wage = Number(e.target.value); wageVal.textContent = `${c.wage} Dn / worker / year`; },
    });
    const wageVal = h('b', {}, `${c.wage} Dn / worker / year`);
    const rows = Object.entries(LABOR_CATEGORIES).map(([key, name]) => {
      const d = c.laborByCat?.[key] || { demand: 0, employed: 0, buildings: 0 };
      const idx = pri.indexOf(key);
      return h('tr', {},
        h('td', {}, name),
        h('td', { class: 'r num' }, `${fmt(d.employed)} / ${fmt(d.demand)}`),
        h('td', {}, bar(d.employed, d.demand || 1)),
        h('td', { class: 'r' }, h('button', {
          class: `btn small${idx >= 0 ? ' primary' : ''}`,
          title: 'Priority categories are staffed first, in order',
          onclick: () => {
            if (idx >= 0) pri.splice(idx, 1);
            else pri.push(key);
            this.render();
          },
        }, idx >= 0 ? `Priority ${idx + 1}` : 'Set priority')));
    });
    return [
      h('div', { class: 'grid2' },
        h('div', { class: 'card' },
          kv('Workforce', fmt(c.workforce)),
          kv('Jobs', fmt(c.jobs)),
          kv('Employed', fmt(c.employed)),
          kv('Unemployed', `${fmt(c.unemployed)} (${pct(c.unemploymentRate)})`),
          h('div', { class: 'muted', style: { marginTop: '4px' } }, `About ${Math.round(CONFIG.WORKFORCE_RATIO * 100)}% of plebeians work. Patricians never do.`)),
        h('div', { class: 'card' },
          h('h4', {}, 'Wages'),
          wageVal, wageInput,
          h('div', { class: 'muted' }, `Rome pays ${CONFIG.BASE_WAGE}. Higher wages please citizens; lower wages save money but hurt mood.`),
          kv('Wages last month', `${fmt(c.lastMonth?.wages || 0)} Dn`))),
      h('h4', {}, 'Labor categories'),
      h('div', { class: 'muted' }, 'When workers are short, priority categories are staffed first; the rest share what is left.'),
      h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, 'Category'), h('th', { class: 'r' }, 'Staffed'), h('th', {}, ''), h('th', {}, '')), rows),
    ];
  }

  tab_production(g) {
    const rep = productionReport(g);
    const num = (v) => (v ? fmt(Math.round(v)) : '');
    const show = (grp) => {
      const k = `${grp.name}|${grp.text}`;
      const i = (this.showNext.get(k) || 0) % grp.ids.length;
      this.showNext.set(k, i + 1);
      const b = g.buildings.get(grp.ids[i]);
      if (!b) return;
      this.app.ui.closeModal();
      this.app.renderer.camera.glideToTile(b.x + (b.size - 1) / 2, b.y + (b.size - 1) / 2);
      this.app.ui.info.showBuilding(b.id);
    };
    return [
      h('div', { class: 'card' },
        h('h4', {}, 'Bottlenecks'),
        rep.hints.length ? h('ul', { class: 'needs' }, rep.hints.map((t) => h('li', {}, t))) : h('div', { class: 'muted' }, 'None: everything built is working and nothing is running out.')),
      h('h4', {}, 'Goods last month'),
      rep.hasMonth ? null : h('div', { class: 'muted' }, 'The figures fill in at the end of the first month.'),
      rep.goods.length ? h('table', { class: 'tbl' },
        h('tr', {}, h('th', {}, 'Good'), h('th', { class: 'r' }, 'Made'), h('th', { class: 'r' }, 'Used'), h('th', { class: 'r' }, 'Imported'), h('th', { class: 'r' }, 'Exported'), h('th', { class: 'r' }, 'In store'), h('th', { class: 'r' }, 'Change')),
        rep.goods.map((r) => h('tr', {},
          h('td', {}, r.name),
          h('td', { class: 'r num' }, num(r.made)),
          h('td', { class: 'r num' }, num(r.used)),
          h('td', { class: 'r num' }, num(r.imported)),
          h('td', { class: 'r num' }, num(r.exported)),
          h('td', { class: 'r num' }, fmt(Math.round(r.stock))),
          h('td', { class: `r num ${r.net > 0.5 ? 'ok' : r.net < -0.5 ? 'no' : ''}` }, Math.abs(r.net) < 0.5 ? '0' : `${r.net > 0 ? '+' : ''}${fmt(Math.round(r.net))}`)))) : h('div', { class: 'muted' }, 'Nothing made or stored yet.'),
      h('div', { class: 'muted' }, 'Used: eaten, worked up in workshops, used by homes, spent on recruits and sent to the Emperor. In store: granaries, warehouses and docks.'),
      h('h4', {}, 'Buildings not working as they should'),
      rep.troubles.length ? h('table', { class: 'tbl' },
        rep.troubles.map((grp) => h('tr', {},
          h('td', {}, h('span', { class: grp.level === 'bad' ? 'no' : '' }, grp.level === 'bad' ? '●' : '○'), ` ${grp.name}${grp.ids.length > 1 ? ` ×${grp.ids.length}` : ''}`),
          h('td', {}, grp.text),
          h('td', { class: 'r' }, h('button', { class: 'btn small', title: grp.ids.length > 1 ? 'Each press shows the next one' : 'Go there', onclick: () => show(grp) }, 'Show'))))) : h('div', { class: 'muted' }, 'All working.'),
    ];
  }

  tab_population(g) {
    const c = g.city;
    const tiers = c.tierCounts || [];
    return [
      h('div', { class: 'grid2' },
        h('div', { class: 'card' },
          kv('Population', fmt(c.population)),
          kv('Plebeians', fmt(c.plebs)),
          kv('Patricians', fmt(c.patricians)),
          kv('Occupied homes', fmt(c.houses)),
          kv('Free housing space', fmt(c.vacancies || 0)),
          kv('Peak population', fmt(c.stats.peakPopulation))),
        h('div', { class: 'card' },
          h('h4', {}, 'Immigration'),
          h('div', {}, c.sentiment >= 30 ? (c.vacancies > 0 ? 'Settlers are arriving to fill empty homes.' : 'People want to come, but there is no free housing. Build more homes!') : 'The city mood is too low: nobody wants to move here.'),
          kv('Arrived (total)', fmt(c.stats.immigrated)),
          kv('Left (total)', fmt(c.stats.emigrated)),
          kv('Houses improved', fmt(c.stats.evolutions)),
          kv('Houses declined', fmt(c.stats.devolutions)))),
      h('h4', {}, 'Homes by level'),
      h('table', { class: 'tbl' },
        h('tr', {}, h('th', {}, 'Level'), h('th', { class: 'r' }, 'Homes'), h('th', {}, 'Needs to reach this level')),
        HOUSE_TIERS.map((t, i) => (i === 0 ? null : h('tr', {},
          h('td', {}, `${i}. ${t.name}`),
          h('td', { class: 'r num' }, fmt(tiers[i] || 0)),
          h('td', { class: 'muted', style: { fontSize: '12px' } }, tierNeeds(i)))))),
    ];
  }

  tab_finance(g) {
    const c = g.city;
    const taxVal = h('b', {}, `${c.taxRate}%`);
    const taxInput = h('input', {
      type: 'range', min: 0, max: 25, step: 1, value: c.taxRate,
      oninput: (e) => { c.taxRate = Number(e.target.value); taxVal.textContent = `${c.taxRate}%`; est.textContent = `${fmt(estTax())} Dn / month`; },
    });
    const estTax = () => {
      let t = 0;
      for (const b of g.buildings.values()) if (b.house && b.house.pop > 0 && b.house.tax > 0) t += houseMonthlyTax(g, b.house);
      return t;
    };
    const est = h('span', { class: 'num' }, `${fmt(estTax())} Dn / month`);
    const ly = c.finance.lastYear;
    const ty = c.finance.thisYear;
    const labels = { taxes: 'Taxes', exports: 'Exports', other: 'Other income/costs', wages: 'Wages', imports: 'Imports', construction: 'Construction', tribute: 'Tribute to Rome', festivals: 'Festivals', gifts: 'Gifts & requests', military: 'Army pay', plunder: 'Lost to raiders' };
    const income = ['taxes', 'exports', 'other'];
    return [
      h('div', { class: 'grid2' },
        h('div', { class: 'card' },
          h('h4', {}, 'Tax rate'),
          taxVal, taxInput,
          kv('Expected taxes', ''), est,
          kv('Homes registered', pct(c.taxCoverage)),
          h('div', { class: 'muted' }, `Only homes visited by a tax collector (Forum/Senate) pay. Above ${CONFIG.DEFAULT_TAX_RATE}% citizens grumble.`)),
        h('div', { class: 'card' },
          kv('Treasury', `${fmt(c.treasury)} Dn`),
          kv('Wages last month', `${fmt(c.lastMonth?.wages || 0)} Dn`),
          kv('Taxes last month', `${fmt(c.lastMonth?.taxes || 0)} Dn`),
          kv('Net this year', `${fmt(ledgerNet(ty))} Dn`),
          ly ? kv('Net last year', `${fmt(ledgerNet(ly))} Dn`) : null)),
      h('h4', {}, 'Ledger'),
      h('table', { class: 'tbl' },
        h('tr', {}, h('th', {}, ''), h('th', { class: 'r' }, 'This year'), h('th', { class: 'r' }, 'Last year')),
        LEDGER_KEYS.map((k) => h('tr', {},
          h('td', {}, `${income.includes(k) ? '+' : '−'} ${labels[k]}`),
          h('td', { class: 'r num' }, fmt(ty[k] || 0)),
          h('td', { class: 'r num' }, ly ? fmt(ly[k] || 0) : '-')))),
    ];
  }

  tab_trade(g) {
    const t = g.city.trade;
    const partners = Object.entries(t.routes);
    if (!partners.length) return h('div', { class: 'muted' }, 'No trade partners are available in this scenario.');
    const seaOk = !!g.map.seaEntry;
    const docks = [...g.buildings.values()].filter((b) => b.def.kind === 'dock');
    const staffedDock = docks.some((b) => b.efficiency > 0);
    const routeCards = partners.map(([id, r]) => {
      const p = TRADE_PARTNERS[id];
      const sea = routeKind(id) === 'sea';
      const list = (obj, used) => Object.entries(obj).map(([good, cap]) => h('span', { class: 'chip', title: `${fmt(used[good] || 0)} of ${fmt(cap)} this year` }, `${GOODS[good].icon} ${GOODS[good].name} ${fmt(used[good] || 0)}/${fmt(cap)}`));
      let how;
      if (!sea) how = h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Caravans come along the Imperial road to a staffed warehouse.');
      else if (!seaOk) how = h('div', { class: 'status bad', style: { fontSize: '12px' } }, 'Unreachable: no river or coast connects this province to the sea.');
      else if (!docks.length) how = h('div', { class: 'status warn', style: { fontSize: '12px' } }, 'Ships need a Dock: build one on the bank of the river or sea.');
      else if (!staffedDock) how = h('div', { class: 'status warn', style: { fontSize: '12px' } }, 'Your Dock has no workers: ships cannot tie up.');
      else how = h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Ships call at your Dock and buy from warehouses near it.');
      return h('div', { class: 'card' },
        h('div', { class: 'row' },
          h('h4', { style: { flex: 1 } }, h('span', { style: { color: p.color } }, '● '), p.name),
          h('span', { class: 'chip', title: sea ? 'Sea route: merchant ships and a Dock' : 'Land route: caravans on the Imperial road' }, sea ? '⛵ Sea' : '🐪 Land'),
          r.open ? h('span', { class: 'chip ok' }, 'Open') : h('button', {
            class: 'btn small primary',
            disabled: sea && !seaOk,
            onclick: () => { const res = openRoute(g, id); if (!res.ok) this.app.ui.toastError(res.reason); this.render(); },
          }, `Open route (${fmt(p.openCost)} Dn)`)),
        how,
        h('div', { class: 'muted' }, 'They sell (you can import):'), h('div', {}, list(p.sells, r.bought)),
        h('div', { class: 'muted' }, 'They buy (you can export):'), h('div', {}, list(p.buys, r.sold)));
    });
    const tradeable = GOOD_KEYS.filter((k) => partners.some(([id]) => TRADE_PARTNERS[id].sells[k] || TRADE_PARTNERS[id].buys[k]));
    const rows = tradeable.map((k) => {
      const s = t.settings[k];
      const canImport = partners.some(([id]) => TRADE_PARTNERS[id].sells[k]);
      const canExport = partners.some(([id]) => TRADE_PARTNERS[id].buys[k]);
      return h('tr', {},
        h('td', {}, `${GOODS[k].icon} ${GOODS[k].name}`),
        h('td', { class: 'r num' }, fmt(cityStock(g, k))),
        h('td', {}, h('select', {
          onchange: (e) => { setTradeMode(g, k, e.target.value); this.render(); },
        }, h('option', { value: 'none', selected: s.mode === 'none' }, 'No trade'),
        canImport ? h('option', { value: 'import', selected: s.mode === 'import' }, `Import (buy ${GOODS[k].buy})`) : null,
        canExport ? h('option', { value: 'export', selected: s.mode === 'export' }, `Export (sell ${GOODS[k].sell})`) : null)),
        h('td', {}, s.mode === 'none' ? '' : h('input', {
          type: 'number', min: 0, max: 3200, step: 100, value: s.level, style: { width: '80px' },
          title: s.mode === 'export' ? 'Keep at least this much in storage' : 'Buy until storage holds this much',
          onchange: (e) => setTradeMode(g, k, null, Number(e.target.value)),
        })),
        h('td', { class: 'muted', style: { fontSize: '12px' } }, s.mode === 'export' ? 'keep' : s.mode === 'import' ? 'target' : ''));
    });
    const log = t.log.slice(0, 6).map((e) => h('div', { class: 'muted', style: { fontSize: '12px' } }, `${e.date} ${e.kind === 'sea' ? '⛵' : '🐪'} ${e.partner}: +${fmt(e.earned)} / −${fmt(e.spent)} Dn`));
    return [
      h('div', { class: 'card empire-card' },
        empireMapCanvas(g),
        h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '4px' } }, '╌ land route (caravans)   ··· sea route (ships)   solid = open. ', seaOk ? 'Ships can reach this province.' : 'No ships can reach this province: only land routes work here.')),
      h('div', { class: 'muted', style: { marginTop: '8px' } }, 'Land routes: caravans trade with staffed warehouses on the Imperial road. Sea routes: ships unload imports at a staffed Dock (dock workers cart them to storage) and buy exports from warehouses near it. Prices are per 100 units.'),
      h('div', { class: 'grid2', style: { marginTop: '8px' } }, routeCards),
      h('h4', {}, 'Goods'),
      h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, 'Good'), h('th', { class: 'r' }, 'In storage'), h('th', {}, 'Mode'), h('th', {}, 'Level'), h('th', {}, '')), rows),
      log.length ? h('h4', {}, 'Recent caravans and ships') : null, log,
    ];
  }

  tab_military(g) {
    const m = g.military;
    const t = threatSummary(g);
    const counts = garrisonCounts(g);
    const all = [...g.buildings.values()];
    const forts = all.filter((b) => b.def.kind === 'fort');
    const barracks = all.filter((b) => b.def.kind === 'barracks');
    const towers = all.filter((b) => b.def.kind === 'tower');
    let soldiers = 0;
    let pay = 0;
    for (const u of g.units.values()) if (u.side === 'rome') { soldiers++; pay += UNIT_TYPES[u.type].upkeep; }
    const st = m.stats;
    const threat = h('div', { class: 'card' },
      h('h4', {}, 'Threat'),
      h('div', { class: `status ${t.level === 'attack' ? 'bad' : t.level === 'warned' ? 'warn' : 'good'}` }, t.level === 'calm' ? 'Scouts see no warband near the province.' : t.text),
      m.settings ? h('div', { class: 'muted', style: { marginTop: '4px' } }, 'Raiders come from the map edges. Scouts warn about 3 months ahead; warbands grow with your city.') : null,
      t.level === 'attack' ? h('button', { class: 'btn small primary', style: { marginTop: '6px' }, onclick: () => { this.app.ui.closeModal(); this.app.focusThreat(); } }, 'Show me the raiders') : null);
    const army = h('div', { class: 'card' },
      h('h4', {}, 'Army'),
      kv('Soldiers', fmt(soldiers)),
      kv('Army pay', `${fmt(pay)} Dn / month`),
      kv('Forts / barracks / towers', `${forts.length} / ${barracks.length} / ${towers.length}`),
      kv('Record', `${st.repelled} of ${st.raids} raids repelled`),
      kv('Raiders slain / soldiers lost', `${fmt(st.enemiesKilled)} / ${fmt(st.soldiersLost)}`),
      kv('Buildings lost to raids', fmt(st.buildingsLost)));
    const need = m.demand || {};
    const supplies = h('table', { class: 'tbl' },
      h('tr', {}, h('th', {}, 'Supply'), h('th', { class: 'r' }, 'Forts need'), h('th', { class: 'r' }, 'At barracks'), h('th', { class: 'r' }, 'In storage'), h('th', {}, 'Made by')),
      ['weapons', 'arrows', 'horses'].map((good) => h('tr', {},
        h('td', {}, `${GOODS[good].icon} ${GOODS[good].name}`),
        h('td', { class: 'r num' }, formatAmount(good, need[good] || 0)),
        h('td', { class: 'r num' }, formatAmount(good, barracks.reduce((s, b) => s + (b.stock[good] || 0), 0))),
        h('td', { class: 'r num' }, formatAmount(good, cityStock(g, good))),
        h('td', { class: 'muted' }, RECRUIT_SOURCE[good]))));
    const fortRows = forts.map((f) => {
      const unit = UNIT_TYPES[f.def.unit];
      const n = counts.get(f.id) || 0;
      return h('tr', {},
        h('td', {}, h('span', { style: { color: unit.color, fontWeight: 700 } }, '■ '), f.def.name),
        h('td', { class: 'r num' }, `${n}/${FORT_CAPACITY}${f.recruiting ? ` (+${f.recruiting})` : ''}`),
        h('td', { class: 'r num' }, pct(f.efficiency)),
        h('td', {}, f.rally ? `Holding ${Math.floor(f.rally.x)},${Math.floor(f.rally.y)}` : 'At the fort'),
        h('td', { class: 'r' },
          h('button', { class: 'btn small', onclick: () => { this.app.ui.closeModal(); this.app.renderer.camera.glideToTile(f.x + 1, f.y + 1); this.app.ui.info.showBuilding(f.id); } }, 'Show'),
          h('button', { class: 'btn small primary', disabled: n === 0, onclick: () => { this.app.ui.closeModal(); this.app.startDeploy(f.id); } }, 'Deploy'),
          h('button', { class: 'btn small', disabled: !f.rally, onclick: () => { recallFort(g, f.id); this.render(); } }, 'Recall')));
    });
    return [
      h('div', { class: 'grid2' }, threat, army),
      h('h4', {}, 'Forts'),
      forts.length
        ? h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, 'Fort'), h('th', { class: 'r' }, 'Soldiers'), h('th', { class: 'r' }, 'Staff'), h('th', {}, 'Orders'), h('th', {}, '')), fortRows)
        : h('div', { class: 'muted' }, 'No forts yet. Build a Barracks and at least one fort (Military menu). Garrisons guard the area around their fort; use Deploy to send them where raiders will come.'),
      h('h4', {}, 'Supplies'),
      supplies,
      h('div', { class: 'muted', style: { fontSize: '12.5px', marginTop: '4px' } },
        'Each recruit needs equipment at the Barracks: a legionary 50 weapons (Weaponsmith: iron), an archer 50 arrows (Fletcher: timber + iron), a cavalryman one horse (Horse Ranch on meadow, or imported). Carts deliver them automatically while forts have empty places.'),
    ];
  }

  tab_religion(g) {
    const c = g.city;
    return [
      h('div', { class: 'muted' }, `Each god wants about one staffed temple per ${CONFIG.PEOPLE_PER_TEMPLE} of its share of citizens. Once the city passes 800 people, gods without any temple grow angry. Festivals and oracles can lift moods high enough for blessings.`),
      GOD_KEYS.map((k) => {
        const s = c.gods[k];
        return h('div', { class: 'card', style: { marginTop: '8px' } },
          h('div', { class: 'row' }, h('h4', { style: { flex: 1, color: GODS[k].color } }, GODS[k].name), h('span', { class: 'muted' }, GODS[k].domain)),
          kv('Mood', `${Math.round(s.mood)} / 100`), bar(s.mood, 100),
          kv('Staffed temples', `${s.temples}`),
          h('div', { class: 'muted', style: { fontSize: '12px' } }, `Blessing: ${GODS[k].blessing} Wrath: ${GODS[k].wrath}`),
          h('div', { class: 'row', style: { marginTop: '6px' } },
            ['Small', 'Large', 'Grand'].map((name, size) => h('button', {
              class: 'btn small',
              disabled: c.festivalCooldown > 0,
              onclick: () => { const r = holdFestival(g, k, size); if (!r.ok) this.app.ui.toastError(r.reason); this.render(); },
            }, `${name} festival (${fmt(festivalCost(g, size))} Dn)`))));
      }),
      c.festivalCooldown > 0 ? h('div', { class: 'muted', style: { marginTop: '6px' } }, `Next festival possible in ${c.festivalCooldown} months.`) : null,
    ];
  }

  tab_ratings(g) {
    const r = g.city.ratings;
    const cov = g.city.coverage || {};
    const goals = g.scenario.goals;
    const row = (key, name, tip) => h('div', { class: 'card', style: { marginTop: '8px' } },
      kv(name, `${Math.floor(r[key])}${goals[key] ? ` (goal ${goals[key]})` : ''}`), bar(r[key], 100),
      h('div', { class: 'muted', style: { fontSize: '12.5px', marginTop: '3px' } }, tip));
    const seats = g.city.entCoverage || {};
    const seatText = `Venue seats for ${seats.theater || 0}% (theaters), ${seats.amphitheater || 0}% (amphitheaters) and ${seats.colosseum || 0}% (colosseums) of the city give every home +${g.city.entBase || 0} entertainment.`;
    return [
      row('culture', 'Culture', `Religion ${pct(cov.religion)}, school ${pct(cov.school)}, library ${pct(cov.library)}, academy ${pct(cov.academy)} of citizens covered; average entertainment ${Math.round(cov.entertainment || 0)}. ${seatText} Build temples, schools, libraries and venues where people live.`),
      row('prosperity', 'Prosperity', 'Rises with better housing, patrician villas, a profitable treasury, low unemployment, fair wages and a Senate. Changes slowly.'),
      row('peace', 'Peace', `Grows each month the city is content (mood ${CONFIG.PEACE_MOOD}+). Falls with unrest, raids and the wrath of Mars.`),
      row('favor', 'Favor', 'The Emperor likes paid tributes, fulfilled requests and gifts. Debt and missed requests anger him. At 0 you are recalled!'),
    ];
  }

  tab_imperial(g) {
    const c = g.city;
    const r = c.request;
    return [
      h('div', { class: 'card' },
        kv('Emperor\'s favor', `${Math.round(c.ratings.favor)} / 100`), bar(c.ratings.favor, 100),
        h('div', { class: 'muted' }, 'Each year Rome collects a tribute based on your population.')),
      h('div', { class: 'card', style: { marginTop: '10px' } },
        h('h4', {}, 'Current request'),
        r ? [
          h('div', {}, `The Emperor asks for ${describeRequest(r)}.`),
          kv('Deadline', `${Math.max(0, r.deadline - g.time.totalMonths)} months left`),
          r.kind === 'goods' ? kv('In storage', `${fmt(cityStock(g, r.good))} / ${fmt(r.amount)}`) : kv('Treasury', `${fmt(c.treasury)} / ${fmt(r.amount)}`),
          h('button', {
            class: 'btn primary', style: { marginTop: '6px' }, disabled: !canFulfill(g),
            onclick: () => { const res = fulfillRequest(g); if (!res.ok) this.app.ui.toastError(res.reason); else this.app.sfx.play('fanfare'); this.render(); },
          }, 'Send it to Rome'),
        ] : h('div', { class: 'muted' }, g.scenario.requests ? 'No requests at the moment.' : 'The Emperor makes no requests in this scenario.')),
      h('div', { class: 'card', style: { marginTop: '10px' } },
        h('h4', {}, 'Send a personal gift'),
        c.giftCooldown > 0 ? h('div', { class: 'muted' }, `The Emperor was gifted recently. Wait ${c.giftCooldown} months.`) : null,
        h('div', { class: 'row' }, GIFT_SIZES.map((gs, i) => h('button', {
          class: 'btn small', disabled: c.giftCooldown > 0,
          onclick: () => { const res = sendGift(g, i); if (!res.ok) this.app.ui.toastError(res.reason); else this.app.sfx.play('coin'); this.render(); },
        }, `${gs.name}: ${fmt(gs.cost)} Dn (+${gs.favor})`)))),
    ];
  }

  tab_messages(g) {
    if (!g.messages.length) return h('div', { class: 'muted' }, 'No messages yet.');
    return h('div', {}, g.messages.map((m) => h('div', {
      class: `toast ${m.level}`, style: { animation: 'none', marginBottom: '5px' },
      onclick: () => { if (m.x !== undefined) { this.app.renderer.camera.glideToTile(m.x, m.y); this.app.ui.closeModal(); } },
    }, h('span', { class: 'date' }, m.date), m.text)));
  }
}

/** Short summary of what a level needs (Population tab, help). */
export function tierNeeds(i) {
  const t = HOUSE_TIERS[i];
  const parts = [];
  if (t.water) parts.push(t.water === 2 ? 'fountain' : 'well');
  if (t.food) parts.push(`${t.food} food`);
  if (t.religion) parts.push(`${t.religion} god${t.religion > 1 ? 's' : ''}`);
  if (t.ent) parts.push(`ent ${t.ent}`);
  if (t.edu) parts.push(['', 'school or library', 'school+library', 'school+library+academy'][t.edu]);
  if (t.baths) parts.push('baths');
  if (t.barber) parts.push('barber');
  if (t.health) parts.push(t.health >= 2 ? 'medicus+hospital' : 'medicus or hospital');
  if (t.goods.length) parts.push(t.goods.join(', '));
  if (t.wine > 1) parts.push(`${t.wine} wine sources`);
  const prev = i > 0 ? HOUSE_TIERS[i - 1].up : -99;
  if (prev > -50) parts.push(`des ${prev}`);
  if (t.size > 1) parts.push(`${t.size}x${t.size}`);
  return parts.join(' · ') || 'settlers';
}

/**
 * Small line charts of the city's monthly history (population, treasury,
 * mood): the last 20 years at most, one point a month.
 */
function trendCharts(history) {
  if (history.length < 2) return h('div', { class: 'card', style: { marginTop: '10px' } }, h('h4', {}, 'Trends'), h('div', { class: 'muted' }, 'The charts fill in month by month.'));
  const years = Math.max(1, Math.round(history.length / 12));
  return h('div', { class: 'card', style: { marginTop: '10px' } },
    h('h4', {}, `Trends (last ${history.length < 12 ? `${history.length} months` : `${years} year${years > 1 ? 's' : ''}`})`),
    h('div', { class: 'grid3' },
      lineChart('Population', history.map((p) => p.pop), (v) => fmt(v)),
      lineChart('Treasury', history.map((p) => p.treasury), (v) => `${fmt(v)} Dn`),
      lineChart('Mood', history.map((p) => p.sentiment), (v) => `${v}`, [0, 100])));
}

/** One chart: a canvas with the line, its range and the latest value. */
function lineChart(title, values, label, range = null) {
  const W = 220;
  const H = 64;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = h('canvas', { width: W * dpr, height: H * dpr, class: 'trend', 'aria-label': `${title} chart` });
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const css = getComputedStyle(document.documentElement);
    const line = css.getPropertyValue('--bronze').trim() || '#a0703a';
    const grid = css.getPropertyValue('--line').trim() || '#ccc';
    let lo = range ? range[0] : Math.min(...values);
    let hi = range ? range[1] : Math.max(...values);
    if (hi - lo < 1) { hi += 1; lo -= 1; }
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    if (lo < 0 && hi > 0) { // the zero line (a treasury in debt)
      const y0 = H - 4 - ((0 - lo) / (hi - lo)) * (H - 8);
      ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(W, y0); ctx.stroke();
    }
    ctx.strokeStyle = line;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = (i / (values.length - 1)) * (W - 2) + 1;
      const y = H - 4 - ((v - lo) / (hi - lo)) * (H - 8);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  return h('div', { class: 'trend-box' },
    h('div', { class: 'trend-head' }, h('b', {}, title), h('span', { class: 'num' }, label(values[values.length - 1]))),
    canvas,
    h('div', { class: 'muted trend-range' }, `${label(Math.min(...values))} to ${label(Math.max(...values))}`));
}

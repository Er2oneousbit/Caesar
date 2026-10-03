/**
 * advisors.js
 * ----------------------------------------------------------------------------
 * The Advisors window: one tab per area of city management.
 *
 *   Overview   scenario goals, the city at a glance (with its health and
 *              crime lines), city mood and what drives it, trend charts
 *   Labor      workforce, wages, hiring priorities per category
 *   Population housing tiers, immigration
 *   Production goods made and used last month, idle buildings and why,
 *              the bottlenecks (ui/production.js)
 *   Finance    tax rate and the yearly ledger
 *   Trade      trade routes (each with a switch per good: whom you trade
 *              it with), import/export settings per good
 *   Military   threats, forts and their orders, supplies, battle record
 *   Health     city health, disease this year and last, the health
 *              buildings' reach and the needs they meet, advice
 *   Education  schools, libraries, academies: reach, needs met, advice
 *   Entertainment  venues and their shows and seats, training buildings,
 *              the city-wide base, advice (numbers: sim/coverage.js,
 *              words: ui/coverageInfo.js)
 *   Religion   gods' moods and festivals
 *   Ratings    culture / prosperity / peace / favor explained
 *   Imperial   the Emperor's requests, the governor's rank, salary and
 *              savings, gifts and donations (ui/governorInfo.js words them)
 *   Messages   the full message log
 * ----------------------------------------------------------------------------
 */

import { h, mount, fmt, pct, bar, kv } from './dom.js';
import { openMessage, clickHint } from './messages.js';
import { CONFIG } from '../config.js';
import { LABOR_CATEGORIES, ENT_BASE_MAX, VENUE_SEATS } from '../data/buildings.js';
import { HOUSE_TIERS } from '../data/housing.js';
import { GOODS, GOOD_KEYS, RECRUIT_SOURCE, formatAmount } from '../data/goods.js';
import { UNIT_TYPES, FORT_CAPACITY, STATION_CAPACITY } from '../data/units.js';
import { threatSummary, garrisonCounts, recallFort, RUMOUR_MONTHS, SCOUT_MONTHS, raidPeople } from '../sim/military.js';
import { packSummary } from '../sim/wildlife.js';
import { squadronCounts, recallStation, fleetSummary, navalNeed } from '../sim/navy.js';
import { trainedTotals } from '../sim/training.js';
import { templeCount } from './trainingInfo.js';
import { GODS, GOD_KEYS } from '../data/gods.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';
import { goalStatus } from '../sim/ratings.js';
import { LEDGER_KEYS, ledgerNet, houseMonthlyTax, romeWage } from '../sim/economy.js';
import { tradeHaltText } from '../sim/events.js';
import { openRoute, setTradeMode, routeKind, shipsWaitingText, importWarnings } from '../sim/trade.js';
import { partnerBuys, routeInterval } from '../sim/tradeDemand.js';
import { partnerOn, setPartnerGood, partnerIdle, partnersFor } from '../sim/tradeSwitches.js';
import { homeSiteId } from '../data/sites.js';
import { tripDays } from '../data/empireRoutes.js';
import { tradePrice, priceRange, rangeText, distanceNote, marketLine } from '../sim/prices.js';
import { empireMapCanvas } from './empireMap.js';
import { cityStock } from '../sim/storage.js';
import { holdFestival, festivalNeeds, festivalMeans, festivalBlocked, festivalNeglect, neglectPenalty, FESTIVAL_SIZES } from '../sim/religion.js';
import { describeRequest, canFulfill, fulfillRequest, sendGift, GIFT_SIZES } from '../sim/emperor.js';
import { setSalary, donate } from '../sim/governor.js';
import { RANKS } from '../data/ranks.js';
import { rankLine, salaryOption, salaryOutlookText, giftLabel, giftBlocked, giftNote, salaryNow } from './governorInfo.js';
import { battleSummary, sendTroops, sendBlocked, strengthOf, awayCounts, awayOf, recallSummary } from '../sim/battle.js';
import { legionText, battleLines, archLine, serviceButton, recallControls, recallLines, postsInBattle } from './empireInfo.js';
import { productionReport } from './production.js';
import { homesWithFood } from '../sim/population.js';
import { loanTerms, takeLoan } from '../sim/loans.js';
import { healthReport, educationReport, entertainmentReport, crimeNow, HEALTH_KINDS, EDUCATION_KINDS, VENUE_KINDS, TRAINER_KINDS } from '../sim/coverage.js';
import { sickHomes } from '../sim/disease.js';
import { idleBuildings } from './cycle.js';
import {
  coverageText, healthVerdict, healthIsLow, cityHealthLine, crimeLine, healthAdviceText, educationAdviceText,
  entertainmentAdviceText, pluralName, educationLadderText,
} from './coverageInfo.js';

export const ADVISOR_TABS = [
  ['overview', 'Overview'],
  ['labor', 'Labor'],
  ['population', 'Population'],
  ['production', 'Production'],
  ['finance', 'Finance'],
  ['trade', 'Trade'],
  ['military', 'Military'],
  ['health', 'Health'],
  ['education', 'Education'],
  ['entertainment', 'Entertainment'],
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
  venus: 'Venus\'s blessing or wrath',
  festival: 'Recent festivals',
  newCity: 'New city optimism',
  difficulty: 'Difficulty',
};

/**
 * One trade partner's card: route kind, open or not (with the button to open
 * it), what it sells and buys with this year's amounts, and what the route
 * needs. Shared by the Trade advisor and the Empire map (ui/empire.js). What
 * it buys is this mission's demand in force (sim/tradeDemand.js); each good
 * shows this partner's price this year (sim/prices.js), per 100 units, beside
 * its switch: untick it and the city stops trading that good with this
 * partner (sim/tradeSwitches.js). `onChange` runs after the player opened
 * the route or flipped a switch.
 */
export function tradeRouteCard(app, g, id, onChange) {
  const p = TRADE_PARTNERS[id];
  const r = g.city.trade.routes[id];
  const sea = routeKind(id) === 'sea';
  const seaOk = !!g.map.seaEntry;
  const docks = [...g.buildings.values()].filter((b) => b.def.kind === 'dock');
  const staffedDock = docks.some((b) => b.efficiency > 0);
  // side: 'buy' for what it sells you (you pay), 'sell' for what it buys (you earn).
  const list = (obj, used, side) => Object.entries(obj).map(([good, cap]) => {
    const price = tradePrice(g, id, good, side);
    const on = partnerOn(g, id, good);
    const name = GOODS[good].name.toLowerCase();
    const deal = side === 'buy' ? `Buy ${name} from ${p.name}` : `Sell ${name} to ${p.name}`;
    const state = on ? 'on: untick to stop' : `off: ${p.name} ${side === 'buy' ? 'sells you' : 'buys'} none until you tick it`;
    return h('label', { class: `chip trade-good${on ? '' : ' off'}`, title: `${deal} (${state}). ${fmt(used[good] || 0)} of ${fmt(cap)} this year, at ${price} Dn per 100 units.` },
      h('input', {
        type: 'checkbox', class: 'trade-switch', checked: on, 'aria-label': deal, dataset: { switch: `${id}:${good}` },
        onchange: (e) => {
          setPartnerGood(g, id, good, e.target.checked);
          onChange();
          // The card is drawn afresh: keep the keyboard on the same switch.
          document.querySelector(`input.trade-switch[data-switch="${id}:${good}"]`)?.focus();
        },
      }),
      `${GOODS[good].icon} ${GOODS[good].name} ${fmt(used[good] || 0)}/${fmt(cap)} · ${price} Dn`);
  });
  const idle = partnerIdle(g, id, partnerBuys(g, id));
  let how;
  if (!sea) how = h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Caravans come along the Imperial road to a staffed warehouse.');
  else if (!seaOk) how = h('div', { class: 'status bad', style: { fontSize: '12px' } }, 'Unreachable: no river or coast connects this province to the sea.');
  else if (!docks.length) how = h('div', { class: 'status warn', style: { fontSize: '12px' } }, 'Ships need an Emporium (Trade Dock): build one on the bank of the river or sea.');
  else if (!staffedDock) how = h('div', { class: 'status warn', style: { fontSize: '12px' } }, 'Your Emporium has no workers: ships cannot tie up.');
  else how = h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Ships wait at your Emporium while dock workers unload them and fetch exports from warehouses near it.');
  // How far it is and how often its traders come (a far quiet route less often, a busy one more: sim/tradeDemand.js).
  const trip = tripDays(homeSiteId(g), id);
  const [a, b] = routeInterval(g, id);
  const pace = h('div', { class: 'muted route-pace', style: { fontSize: '12px' } }, `About ${trip} day${trip === 1 ? '' : 's'} ${sea ? 'at sea' : 'on the road'} each way; ${sea ? 'a ship' : 'a caravan'} every ${a} to ${b} days.`);
  return h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('h4', { style: { flex: 1 } }, h('span', { style: { color: p.color } }, '● '), p.name),
      h('span', { class: 'chip', title: sea ? 'Sea route: merchant ships and an Emporium' : 'Land route: caravans on the Imperial road' }, sea ? '⛵ Sea' : '🐪 Land'),
      r.open ? h('span', { class: 'chip ok' }, 'Open') : h('button', {
        class: 'btn small primary',
        disabled: sea && !seaOk,
        onclick: () => { const res = openRoute(g, id); if (!res.ok) app.ui.toastError(res.reason); onChange(); },
      }, `Open route (${fmt(p.openCost)} Dn)`)),
    how,
    pace,
    h('div', { class: 'muted route-prices', style: { fontSize: '12px' } }, distanceNote(g.scenario, id)),
    idle ? h('div', { class: 'status warn route-idle', style: { fontSize: '12px' } }, `Every good is switched off: ${sea ? 'no ships' : 'no caravans'} will come until you tick one.`) : null,
    r.open && tradeHaltText(g, sea ? 'sea' : 'land') ? h('div', { class: 'status warn route-halt', style: { fontSize: '12px' } }, tradeHaltText(g, sea ? 'sea' : 'land')) : null,
    h('div', { class: 'muted' }, 'They sell (you can import):'), h('div', {}, list(p.sells, r.bought, 'buy')),
    h('div', { class: 'muted' }, 'They buy (you can export):'), h('div', {}, list(partnerBuys(g, id), r.sold, 'sell')));
}

/**
 * One visit in the trade log, with what changed hands, so the player sees
 * whom each good went to and came from: "Mar 12 🐪 Capua: sold pottery 200;
 * bought wine 100: +320 / −215 Dn" (sold and bought: by the city).
 */
export function tradeLogLine(e) {
  const goods = (o) => Object.entries(o || {}).filter(([k, n]) => n > 0 && GOODS[k]).map(([k, n]) => `${GOODS[k].name.toLowerCase()} ${fmt(n)}`).join(', ');
  const parts = [];
  if (goods(e.sold)) parts.push(`sold ${goods(e.sold)}`);
  if (goods(e.bought)) parts.push(`bought ${goods(e.bought)}`);
  const what = parts.length ? `${parts.join('; ')}: ` : '';
  return `${e.date} ${e.kind === 'sea' ? '⛵' : '🐪'} ${e.partner}: ${what}+${fmt(e.earned)} / −${fmt(e.spent)} Dn`;
}

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
    this.tabsEl = h('div', { class: 'tabs advisor-tabs' });
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
    const food = homesWithFood(g);
    const health = cityHealthLine(healthReport(g));
    const crime = crimeLine(crimeNow(g));
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
          kv('Homes with food', food.homes ? `${fmt(food.withFood)} of ${fmt(food.homes)} (${pct(food.withFood / food.homes)})` : 'No homes yet'),
          this.tabLink(kv('City health', health.text, health.low ? 'no' : ''), 'health', 'Open the Health advisor'),
          kv('Crime', crime.text, crime.level === 'bad' ? 'no' : ''),
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
          h('div', { class: 'muted' }, `Rome pays ${romeWage(g)}. Higher wages please citizens; lower wages save money but hurt mood.`),
          kv('Wages last month', `${fmt(c.lastMonth?.wages || 0)} Dn`))),
      h('h4', {}, 'Labor categories'),
      h('div', { class: 'muted' }, 'When workers are short, priority categories are staffed first; the rest share what is left.'),
      h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, 'Category'), h('th', { class: 'r' }, 'Staffed'), h('th', {}, ''), h('th', {}, '')), rows),
    ];
  }

  /**
   * A "Show" button's press: close the advisors and go to the next building
   * of the group `key` (each press the next one), with its panel open.
   */
  showNextOf(g, key, ids) {
    if (!ids.length) return;
    const i = (this.showNext.get(key) || 0) % ids.length;
    this.showNext.set(key, i + 1);
    const b = g.buildings.get(ids[i]);
    if (!b) return;
    this.app.ui.closeModal();
    this.app.renderer.camera.glideToTile(b.x + (b.size - 1) / 2, b.y + (b.size - 1) / 2);
    this.app.ui.info.showBuilding(b.id);
  }

  /**
   * A building type's name in a coverage table: a link that goes to each of
   * `ids` in turn (as a Show button would), or plain text when none is built.
   */
  nameLink(g, key, name, ids) {
    if (!ids.length) return name;
    return h('button', { class: 'linkbtn', title: ids.length > 1 ? `Show one (each press the next of ${ids.length})` : 'Show it', onclick: () => this.showNextOf(g, key, ids) }, name);
  }

  /** A small "Show" button that goes to each of `ids` in turn, or null when there are none. */
  showButton(g, key, ids, label = 'Show') {
    if (!ids.length) return null;
    return h('button', { class: 'btn small', title: ids.length > 1 ? 'Each press shows the next one' : 'Go there', onclick: () => this.showNextOf(g, key, ids) }, label);
  }

  tab_production(g) {
    const rep = productionReport(g);
    const num = (v) => (v ? fmt(Math.round(v)) : '');
    const show = (grp) => this.showNextOf(g, `${grp.name}|${grp.text}`, grp.ids);
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
      h('div', { class: 'muted' }, 'Used: eaten, worked up in workshops, built into boats and ships, used by homes, spent on recruits and sent to the Emperor. In store: granaries, warehouses and docks.'),
      h('div', { class: 'row' }, h('h4', { style: { flex: 1 } }, 'Buildings not working as they should'),
        idleBuildings(g).length ? h('button', { class: 'btn small next-idle', title: 'Go to the idle buildings one by one, kind by kind (I; Shift+I goes back). Understaffed ones still work and are left out.', onclick: () => this.app.nextIdle(1) }, 'Next idle building (I)') : null),
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
    const labels = { taxes: 'Taxes', exports: 'Exports', other: 'Other income/costs', wages: 'Wages', imports: 'Imports', construction: 'Construction', tribute: 'Tribute to Rome', festivals: 'Festivals', gifts: 'Requests sent to Rome', salary: 'Governor\'s salary', donations: 'Governor\'s donations', military: 'Army pay', plunder: 'Lost to raiders', stolen: 'Stolen by thieves', loans: 'Loan from Rome', repayments: 'Loan repayments' };
    const income = ['taxes', 'exports', 'other', 'loans', 'donations'];
    return [
      h('div', { class: 'grid2' },
        h('div', { class: 'card' },
          h('h4', {}, 'Tax rate'),
          taxVal, taxInput,
          kv('Expected taxes', ''), est,
          kv('Homes registered', pct(c.taxCoverage)),
          h('div', { class: 'muted' }, `Only homes visited by a tax collector (Forum or Curia) in the last ${CONFIG.TAX_ACCESS_DAYS} days pay. Above ${CONFIG.DEFAULT_TAX_RATE}% citizens grumble.`),
          unregisteredNote(g)),
        h('div', { class: 'card' },
          kv('Treasury', `${fmt(c.treasury)} Dn`),
          kv('Wages last month', `${fmt(c.lastMonth?.wages || 0)} Dn`),
          kv('Taxes last month', `${fmt(c.lastMonth?.taxes || 0)} Dn`),
          kv('Net this year', `${fmt(ledgerNet(ty))} Dn`),
          ly ? kv('Net last year', `${fmt(ledgerNet(ly))} Dn`) : null,
          kv('Your salary', salaryNow(g)),
          kv('Your savings', `${fmt(c.governor.savings)} Dn`),
          this.loanCard(g))),
      h('h4', {}, 'Ledger'),
      h('table', { class: 'tbl' },
        h('tr', {}, h('th', {}, ''), h('th', { class: 'r' }, 'This year'), h('th', { class: 'r' }, 'Last year')),
        LEDGER_KEYS.map((k) => h('tr', {},
          h('td', {}, `${income.includes(k) ? '+' : '−'} ${labels[k]}`),
          h('td', { class: 'r num' }, fmt(ty[k] || 0)),
          h('td', { class: 'r num' }, ly ? fmt(ly[k] || 0) : '-')))),
    ];
  }

  /** Finance tab: the loan being repaid, or Rome's offer (sim/loans.js). */
  loanCard(g) {
    const c = g.city;
    if (c.loan) {
      const months = Math.ceil(c.loan.left / c.loan.monthly);
      return h('div', { style: { marginTop: '6px' } }, kv('Loan from Rome', `${fmt(c.loan.left)} Dn owed: ${fmt(c.loan.monthly)} Dn a month, ${months} more month${months === 1 ? '' : 's'}`));
    }
    const t = loanTerms(g);
    return h('div', { style: { marginTop: '6px' } },
      h('button', {
        class: 'btn small',
        onclick: () => { const res = takeLoan(g); if (!res.ok) this.app.ui.toastError(res.reason); else this.app.sfx.play('coin'); this.render(); },
      }, `Borrow ${fmt(t.amount)} Dn from Rome`),
      h('div', { class: 'muted' }, `Repaid as ${fmt(t.monthly)} Dn a month for ${t.months} months (${fmt(t.total)} Dn in all). Borrowed money is not counted as profit.`));
  }

  tab_trade(g) {
    const t = g.city.trade;
    const partners = Object.entries(t.routes);
    if (!partners.length) return h('div', { class: 'muted' }, 'No trade partners are available in this scenario.');
    const seaOk = !!g.map.seaEntry;
    const routeCards = partners.map(([id]) => tradeRouteCard(this.app, g, id, () => this.render()));
    const buys = Object.fromEntries(partners.map(([id]) => [id, partnerBuys(g, id)]));
    const ids = partners.map(([id]) => id);
    const tradeable = GOOD_KEYS.filter((k) => t.settings[k]?.mode === 'export' || partners.some(([id]) => TRADE_PARTNERS[id].sells[k] || buys[id][k]));
    const rows = tradeable.map((k) => {
      const s = t.settings[k];
      const canImport = partners.some(([id]) => TRADE_PARTNERS[id].sells[k]);
      // A good still set to Export keeps the option after its last buyer
      // stopped buying it (a mission's demand change), so the list shows the
      // setting as it is; the player can switch it off.
      const canExport = partners.some(([id]) => buys[id][k]) || s.mode === 'export';
      return h('tr', {},
        h('td', {}, `${GOODS[k].icon} ${GOODS[k].name}`),
        h('td', { class: 'r num' }, fmt(cityStock(g, k))),
        h('td', {}, h('select', {
          onchange: (e) => { setTradeMode(g, k, e.target.value); this.render(); },
        }, h('option', { value: 'none', selected: s.mode === 'none' }, 'No trade'),
        canImport ? h('option', { value: 'import', selected: s.mode === 'import' }, priceRange(g, k, 'buy') ? `Import (buy ${rangeText(priceRange(g, k, 'buy'))})` : 'Import') : null,
        canExport ? h('option', { value: 'export', selected: s.mode === 'export' }, priceRange(g, k, 'sell') ? `Export (sell ${rangeText(priceRange(g, k, 'sell'))})` : 'Export') : null),
        // Under the choice, not in a column of its own: the table is already wide on a phone.
        this.partnersCell(g, k, s.mode, ids, buys)),
        h('td', {}, s.mode === 'none' ? '' : h('input', {
          type: 'number', min: 0, max: 3200, step: 100, value: s.level, style: { width: '80px' },
          title: s.mode === 'export' ? 'Keep at least this much in storage' : 'Buy until storage holds this much',
          onchange: (e) => setTradeMode(g, k, null, Number(e.target.value)),
        })),
        h('td', { class: 'muted', style: { fontSize: '12px' } }, s.mode === 'export' ? 'keep' : s.mode === 'import' ? 'target' : ''));
    });
    // Goods on Import from an open route that cannot come in now (horses with no Horse Ranch).
    const blocked = importWarnings(g);
    const log = t.log.slice(0, 6).map((e) => h('div', { class: 'muted trade-log', style: { fontSize: '12px' } }, tradeLogLine(e)));
    return [
      h('div', { class: 'card empire-card' },
        empireMapCanvas(g),
        h('div', { class: 'row', style: { fontSize: '12px', marginTop: '4px' } },
          h('span', { class: 'muted', style: { flex: 1 } }, '╌ land route (caravans)   ··· sea route (ships)   solid = open. ', seaOk ? 'Ships can reach this province.' : 'No ships can reach this province: only land routes work here.'),
          h('button', { class: 'btn small', title: 'Who is on the way, and when (E)', onclick: () => this.app.ui.openEmpire() }, 'Empire map'))),
      h('div', { class: 'muted', style: { marginTop: '8px' } }, 'Land routes: caravans trade with staffed warehouses on the Imperial road. Sea routes: ships wait at a staffed Emporium (Trade Dock) while its workers cart their imports to storage and fetch exports from warehouses near it (a stay of 2 to 7 weeks: several sea partners need more than one Emporium). Prices are per 100 units, each partner\'s own this year: dearer both ways the farther its route, and every price moves a little each New Year (a range: the cheapest partner to the dearest).'),
      marketLine(g.scenario) ? h('div', { class: 'muted market-line', style: { marginTop: '4px' } }, `Local market: ${marketLine(g.scenario)}`) : null,
      shipsWaitingText(g) ? h('div', { class: 'status warn', style: { marginTop: '8px' } }, `⚓ ${shipsWaitingText(g)}`) : null,
      h('div', { class: 'grid2', style: { marginTop: '8px' } }, routeCards),
      h('h4', {}, 'Goods'),
      h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, 'Good'), h('th', { class: 'r' }, 'In storage'), h('th', {}, 'Mode'), h('th', {}, 'Level'), h('th', {}, '')), rows),
      blocked.map((text) => h('div', { class: 'status warn', style: { marginTop: '6px' } }, text)),
      log.length ? h('h4', {}, 'Recent caravans and ships') : null, log,
    ];
  }

  /**
   * A Goods row's partners: with how many of the partners that deal in the
   * good this way its switch is on (sim/tradeSwitches.js), "to 3 of 5
   * buyers", warned when none is. Empty on No trade.
   */
  partnersCell(g, good, mode, ids, buys) {
    if (mode !== 'import' && mode !== 'export') return '';
    const { on, all } = partnersFor(g, ids, good, mode, (id) => buys[id]);
    if (!all) return '';
    const who = mode === 'export' ? (all === 1 ? 'buyer' : 'buyers') : (all === 1 ? 'seller' : 'sellers');
    const title = 'Partners you trade it with, of those that deal in it (open routes or not). Switch each on or off on its route card.';
    if (!on) return h('span', { class: 'status warn trade-partners', style: { fontSize: '12px' }, title }, `${all === 1 ? 'its only' : 'every'} ${who.replace(/s$/, '')} switched off`);
    return h('span', { class: 'muted trade-partners', style: { fontSize: '12px' }, title }, `${mode === 'export' ? 'to' : 'from'} ${on} of ${all} ${who}`);
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
    for (const u of g.units.values()) if (u.side === 'rome' && !UNIT_TYPES[u.type].naval) { soldiers++; pay += UNIT_TYPES[u.type].upkeep; }
    const st = m.stats;
    const fleet = fleetSummary(g);
    const trained = trainedTotals(g);
    const stations = all.filter((b) => b.def.kind === 'station');
    const yards = all.filter((b) => b.def.kind === 'navalia');
    const seaOk = !!g.map.seaEntry;
    const folk = raidPeople(g, null);
    const threat = h('div', { class: 'card' },
      h('h4', {}, 'Threat'),
      h('div', { class: `status ${t.level === 'attack' ? 'bad' : t.level === 'warned' ? 'warn' : 'good'}` }, t.level === 'calm' ? 'Scouts see no warband near the province.' : t.text),
      m.settings ? h('div', { class: 'muted', style: { marginTop: '4px' } }, `Raiders come from the map edges${seaOk && m.seaRaids ? `, and about ${Math.round(CONFIG.SEA_RAID_SHARE * 100)}% of raids by sea` : ''}. Word of a warband comes about ${RUMOUR_MONTHS} months ahead, the scouts' report of its size and side about ${SCOUT_MONTHS}; warbands grow with your city.`) : null,
      m.settings && seaOk ? h('div', { class: 'muted', style: { fontSize: '12px' } }, `Sea raids: ${m.seaRaids ? 'on' : 'off'} (Settings).`) : null,
      // Who raids this province (data/peoples.js), when it is a people of its own.
      m.settings && folk.mix ? h('div', { class: 'muted', style: { marginTop: '4px' } }, h('b', {}, `Your enemies here: the ${folk.name}. `), folk.desc) : null,
      t.level === 'attack' ? h('button', { class: 'btn small primary', style: { marginTop: '6px' }, onclick: () => { this.app.ui.closeModal(); this.app.focusThreat(); } }, t.legion && t.enemies === t.legion ? 'Show me the legions' : 'Show me the raiders') : null,
      t.level === 'warned' ? h('button', { class: 'btn small', style: { marginTop: '6px' }, title: 'Where the warband is and the side it will enter by (E)', onclick: () => this.app.ui.openEmpire(t.legion ? 'legion' : 'warband') }, 'Show on the empire map') : null);
    const army = h('div', { class: 'card' },
      h('h4', {}, 'Army'),
      kv('Soldiers', fmt(soldiers)),
      soldiers ? kv('Trained (Campus)', `${fmt(trained.soldiersTrained)} of ${fmt(trained.soldiers)}`) : null,
      kv('Army pay', `${fmt(pay)} Dn / month`),
      kv('Forts / barracks / towers', `${forts.length} / ${barracks.length} / ${towers.length}`),
      kv('Record', `${st.repelled} of ${st.raids} raids repelled`),
      kv('Raiders slain / soldiers lost', `${fmt(st.enemiesKilled)} / ${fmt(st.soldiersLost)}`),
      kv('Prefects lost fighting', fmt(st.prefectsLost || 0)),
      st.walkersKilled ? kv('People struck down by missiles', fmt(st.walkersKilled)) : null,
      kv('Buildings lost to raids', fmt(st.buildingsLost)));
    // Wolf packs (sim/wildlife.js): only on a map that has had any.
    const wl = g.wildlife;
    const wolves = wl && wl.nextPackId > 1 ? h('div', { class: 'card' },
      h('h4', {}, 'Wolves'),
      wl.packs.length
        ? h('div', { class: 'muted' }, 'Packs keep to the woods and fall on anyone who walks near. Deploy a fort by a pack to clear it: while one wolf lives, it grows back.')
        : h('div', { class: 'status good' }, 'Every pack has been cleared.'),
      ...wl.packs.map((p) => kv(`Pack ${p.id}`, packSummary(g, p))),
      kv('Wolves killed', fmt(wl.stats.wolvesKilled)),
      kv('People killed by wolves', fmt(wl.stats.walkersKilled))) : null;
    // The fleet: only where ships can sail, or once there is a ship.
    const showFleet = seaOk || fleet.ships > 0 || stations.length > 0;
    const fleetCard = showFleet ? h('div', { class: 'card' },
      h('h4', {}, 'Fleet'),
      kv('Liburnians', `${fmt(fleet.ships)} (${fmt(fleet.atSea)} at sea)`),
      fleet.ships ? kv('Trained crews (Portus)', `${fmt(trained.shipsTrained)} of ${fmt(trained.ships)}`) : null,
      kv('Fleet pay', `${fmt(fleet.pay)} Dn / month`),
      kv('Navalia / stations', `${yards.length} / ${stations.length}`),
      kv('Raider ships sunk / liburnians lost', `${fmt(st.shipsSunk || 0)} / ${fmt(st.shipsLost || 0)}`),
      kv('Raids by sea', fmt(st.seaRaids || 0)),
      fleet.raiders ? h('div', { class: 'status bad' }, `${fleet.raiders} raider ship${fleet.raiders === 1 ? '' : 's'} in the province's waters.`) : null) : null;
    const stationRows = stations.map((b) => {
      const n = squadronCounts(g).get(b.id) || 0;
      const gone = awayCounts(g).get(b.id) || 0;
      return h('tr', {},
        h('td', {}, h('span', { style: { color: UNIT_TYPES.liburnian.color, fontWeight: 700 } }, '⛵ '), b.def.name),
        h('td', { class: 'r num' }, `${n}/${STATION_CAPACITY}${gone ? ` (${gone} away)` : ''}`),
        h('td', { class: 'r num' }, pct(b.efficiency)),
        h('td', {}, b.rally ? `Holding ${Math.floor(b.rally.x)},${Math.floor(b.rally.y)}` : 'At its berths'),
        h('td', {}, serviceButton(g, b, () => this.render())),
        h('td', { class: 'r' },
          h('button', { class: 'btn small', onclick: () => { this.app.ui.closeModal(); this.app.renderer.camera.glideToTile(b.x + 1, b.y + 1); this.app.ui.info.showBuilding(b.id); } }, 'Show'),
          h('button', { class: 'btn small primary', disabled: n === 0, onclick: () => { this.app.ui.closeModal(); this.app.startDeploy(b.id); } }, 'Deploy'),
          h('button', { class: 'btn small', disabled: !b.rally, onclick: () => { recallStation(g, b.id); this.render(); } }, 'Recall')));
    });
    const navalSupplies = yards.length ? h('table', { class: 'tbl' },
      h('tr', {}, h('th', {}, 'Ship stores'), h('th', { class: 'r' }, 'Fleet needs'), h('th', { class: 'r' }, 'At the navalia'), h('th', { class: 'r' }, 'In storage')),
      Object.keys(CONFIG.LIBURNIAN_COST).map((good) => h('tr', {},
        h('td', {}, `${GOODS[good].icon} ${GOODS[good].name}`),
        h('td', { class: 'r num' }, fmt(navalNeed(g, good))),
        h('td', { class: 'r num' }, fmt(yards.reduce((sum, b) => sum + (b.stock[good] || 0), 0))),
        h('td', { class: 'r num' }, fmt(cityStock(g, good)))))) : null;
    const need = m.demand || {};
    const supplies = h('table', { class: 'tbl' },
      h('tr', {}, h('th', {}, 'Supply'), h('th', { class: 'r' }, 'Forts need'), h('th', { class: 'r' }, 'At barracks'), h('th', { class: 'r' }, 'In storage'), h('th', {}, 'Made by')),
      ['weapons', 'arrows', 'horses'].map((good) => h('tr', {},
        h('td', {}, `${GOODS[good].icon} ${GOODS[good].name}`),
        h('td', { class: 'r num' }, formatAmount(good, need[good] || 0)),
        h('td', { class: 'r num' }, formatAmount(good, barracks.reduce((s, b) => s + (b.stock[good] || 0), 0))),
        h('td', { class: 'r num' }, formatAmount(good, cityStock(g, good))),
        h('td', { class: 'muted' }, RECRUIT_SOURCE[good]))));
    const away = awayCounts(g); // at a distant battle (sim/battle.js)
    const fortRows = forts.map((f) => {
      const unit = UNIT_TYPES[f.def.unit];
      const n = counts.get(f.id) || 0;
      return h('tr', {},
        h('td', {}, h('span', { style: { color: unit.color, fontWeight: 700 } }, '■ '), f.def.name),
        h('td', { class: 'r num' }, `${n}/${FORT_CAPACITY}${f.recruiting ? ` (+${f.recruiting})` : ''}${away.get(f.id) ? ` (${away.get(f.id)} away)` : ''}`),
        h('td', { class: 'r num' }, pct(f.efficiency)),
        h('td', {}, f.rally ? `Holding ${Math.floor(f.rally.x)},${Math.floor(f.rally.y)}` : 'At the fort'),
        h('td', {}, serviceButton(g, f, () => this.render())),
        h('td', { class: 'r' },
          h('button', { class: 'btn small', onclick: () => { this.app.ui.closeModal(); this.app.renderer.camera.glideToTile(f.x + 1, f.y + 1); this.app.ui.info.showBuilding(f.id); } }, 'Show'),
          h('button', { class: 'btn small primary', disabled: n === 0, onclick: () => { this.app.ui.closeModal(); this.app.startDeploy(f.id); } }, 'Deploy'),
          h('button', { class: 'btn small', disabled: !f.rally, onclick: () => { recallFort(g, f.id); this.render(); } }, 'Recall')));
    });
    return [
      h('div', { class: 'grid2' }, threat, army, fleetCard, wolves),
      h('h4', {}, 'Forts'),
      forts.length
        ? h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, 'Fort'), h('th', { class: 'r' }, 'Soldiers'), h('th', { class: 'r' }, 'Staff'), h('th', {}, 'Orders'), h('th', { title: 'Sent when Caesar calls for troops (Imperial advisor)' }, 'Distant battles'), h('th', {}, '')), fortRows)
        : h('div', { class: 'muted' }, 'No forts yet. Build a Tirocinium (Barracks) and at least one fort (Military menu). Garrisons at rest hold their fort and fight only what comes to them; use Deploy to send them out to meet raiders.'),
      h('h4', {}, 'Supplies'),
      supplies,
      h('div', { class: 'muted', style: { fontSize: '12.5px', marginTop: '4px' } },
        'Each recruit needs equipment at the Tirocinium: a legionary 50 weapons (Fabrica: iron), an archer 50 arrows (Officina Sagittaria: timber + iron), a cavalryman one horse (Equaria on meadow, or imported). Carts deliver them automatically while forts have empty places.'),
      showFleet ? h('h4', {}, 'Naval stations') : null,
      showFleet ? (stations.length
        ? h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, 'Station'), h('th', { class: 'r' }, 'Liburnians'), h('th', { class: 'r' }, 'Staff'), h('th', {}, 'Orders'), h('th', { title: 'Sent when Caesar calls for troops for a city by the sea (Imperial advisor)' }, 'Distant battles'), h('th', {}, '')), stationRows)
        : h('div', { class: 'muted' }, `No naval stations yet. Build a Navalia and a Statio (Naval Station) on the shore (Military menu): the Navalia builds liburnians from ${Object.entries(CONFIG.LIBURNIAN_COST).map(([gd, n]) => `${n} ${GOODS[gd].name.toLowerCase()}`).join(', ')}, and each station berths ${STATION_CAPACITY} of them to fight raider ships.`)) : null,
      navalSupplies,
    ];
  }

  /** Make a row open another tab when clicked or on Enter (the Overview's health line). */
  tabLink(el, tab, title) {
    el.classList.add('link');
    el.title = title;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.addEventListener('click', () => this.switchTab(tab));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.switchTab(tab); } });
    return el;
  }

  /**
   * Health and Education: one row per building type: built and staffed, the
   * people its walkers reached, and the needs of homes it meets; its name
   * goes to each building of the type in turn.
   */
  serviceTable(g, rows, kinds) {
    return h('table', { class: 'tbl coverage' },
      h('tr', {}, h('th', {}, 'Building'), h('th', { class: 'r' }, 'Staffed'), h('th', { class: 'r' }, 'Reach'), h('th', {}, 'Homes\' needs')),
      kinds.map((k) => {
        const r = rows[k];
        const dry = r.staffed - r.working;
        return h('tr', { dataset: { kind: k } },
          h('td', {}, this.nameLink(g, `service|${k}`, r.name, r.ids), dry > 0 ? h('div', { class: 'no sub' }, `${dry} without water`) : null),
          h('td', { class: `r num${r.built && !r.staffed ? ' no' : ''}`, title: 'Staffed buildings of those built' }, `${r.staffed} of ${r.built}`),
          h('td', { class: 'r num', title: 'Residents of the homes it reached' }, fmt(r.reach), h('div', { class: 'muted sub' }, `${r.reachPct ?? 0}% of all`)),
          h('td', { title: 'Of the people whose homes need it to keep or reach their level, how many have it' },
            h('span', { class: coverageClass(r.pct) }, coverageText(r.pct)),
            r.need ? h('div', { class: 'muted sub num' }, `${fmt(r.served)} of ${fmt(r.need)} people`) : null));
      }));
  }

  /** One advice line, in a status box: good when nothing is wrong. */
  adviceBox(text, fine) {
    return h('div', { class: `status ${fine ? 'good' : 'warn'} advice`, style: { margin: '8px 0' } }, text);
  }

  tab_health(g) {
    const rep = healthReport(g);
    const { city, sick, year, lastYear } = rep;
    const last = (k) => (lastYear ? fmt(lastYear[k] || 0) : '-');
    const sickIds = sickHomes(g).map((b) => b.id);
    const trend = { rising: `rising toward ${city.target}`, falling: `falling toward ${city.target}`, steady: 'holding steady' }[city.trend];
    const healthCard = h('div', { class: 'card' },
      h('h4', {}, 'City health'),
      city.judged ? [
        kv(healthVerdict(city.value), `${city.value} / 100`, healthIsLow(city.value) ? 'no' : ''),
        bar(city.value, 100),
        h('div', { class: 'muted sub', style: { marginTop: '4px' } }, `${trend[0].toUpperCase()}${trend.slice(1)}: it moves ${CONFIG.HEALTH_STEP} points a month toward the homes' average health score, ${city.target} last month.`),
      ] : h('div', { class: 'muted' }, `Too small to judge: a city's health counts from ${CONFIG.DISEASE_MIN_POP} people.`),
      city.disease ? null : h('div', { class: 'muted sub', style: { marginTop: '4px' } }, 'There is no disease in this province.'));
    const diseaseCard = h('div', { class: 'card' },
      h('h4', {}, 'Disease'),
      h('div', { class: 'row' },
        h('div', { style: { flex: 1 } }, kv('Sick homes now', sick.homes ? `${fmt(sick.homes)} (${fmt(sick.people)} people)` : 'None', sick.homes ? 'no' : '')),
        this.showButton(g, 'sick', sickIds)),
      h('table', { class: 'tbl' },
        h('tr', {}, h('th', {}, ''), h('th', { class: 'r' }, 'This year'), h('th', { class: 'r' }, 'Last year')),
        [['Outbreaks', 'outbreaks'], ['Deaths', 'deaths'], ['Cured by physicians', 'cured']].map(([label, k]) => h('tr', {},
          h('td', {}, label), h('td', { class: 'r num' }, fmt(year[k] || 0)), h('td', { class: 'r num' }, last(k))))));
    return [
      h('div', { class: 'grid2' }, healthCard, diseaseCard),
      this.adviceBox(healthAdviceText(rep.advice), rep.advice.key === 'fine'),
      h('h4', {}, 'Health buildings'),
      this.serviceTable(g, rep.rows, HEALTH_KINDS),
      h('div', { class: 'muted sub', style: { marginTop: '4px' } },
        `Reach: the residents of homes its walkers visited in the last ${CONFIG.ACCESS_DAYS} days (a hospital: homes within ${CONFIG.HOSPITAL_RADIUS} tiles while it is staffed). Every one of them scores higher on health and falls sick less. `
        + 'Homes\' needs: of the people whose homes need it to keep or reach their level, how many have it. A home that needs only some health care is served by a medicus or a hospital.'),
    ];
  }

  tab_education(g) {
    const rep = educationReport(g);
    const low = rep.shortest;
    return [
      h('div', { class: 'card' },
        kv('Population', fmt(rep.people)),
        low && low.pct < 100 ? kv('Shortest', `${pluralName(low.type)}: ${coverageText(low.pct)}`, 'no') : null,
        h('div', { class: 'muted sub', style: { marginTop: '4px' } }, `${educationLadderText()} Everyone reached also counts toward culture (Ratings).`)),
      this.adviceBox(educationAdviceText(rep.advice), rep.advice.key === 'fine' || rep.advice.key === 'noDemand'),
      h('h4', {}, 'Schools, libraries and academies'),
      this.serviceTable(g, rep.rows, EDUCATION_KINDS),
      h('div', { class: 'muted sub', style: { marginTop: '4px' } },
        `Reach: the residents of homes a teacher, librarian or scholar visited in the last ${CONFIG.ACCESS_DAYS} days; a building serves every home its walker passes, however many. Homes' needs: of the people whose homes need it to keep or reach their level, how many have it (a library also serves a home that needs only a school or a library).`),
    ];
  }

  tab_entertainment(g) {
    const rep = entertainmentReport(g);
    const c = g.city;
    const venueRows = VENUE_KINDS.map((k) => {
      const v = rep.venues[k];
      return h('tr', { dataset: { kind: k } },
        h('td', {}, this.nameLink(g, `venue|${k}`, v.name, v.ids)),
        h('td', { class: `r num${v.built && !v.staffed ? ' no' : ''}`, title: 'Staffed venues of those built' }, `${v.staffed} of ${v.built}`),
        h('td', { class: `r num${v.staffed && v.playing < v.slots ? ' no' : ''}`, title: 'Kinds of show booked at the staffed venues, of those they can stage' }, `${v.playing} of ${v.slots}`),
        h('td', { title: `Seats of the venues with shows (${fmt(VENUE_SEATS[k])} each), as a share of the population` }, fmt(v.seats), h('div', { class: 'muted sub' }, coverageText(v.cover))),
        h('td', { class: 'r num', title: 'Residents of the homes its entertainers visited lately' }, fmt(v.reach)));
    });
    const trainerRows = TRAINER_KINDS.map((k) => {
      const t = rep.trainers[k];
      return h('tr', { dataset: { kind: k } },
        h('td', {}, this.nameLink(g, `trainer|${k}`, t.name, t.ids)),
        h('td', { class: `r num${t.built && !t.staffed ? ' no' : ''}` }, `${t.staffed} of ${t.built}`),
        h('td', { class: 'muted' }, t.supplies.map((v) => pluralName(v)).join(', ')));
    });
    const shortHomes = rep.short.none + rep.short.more;
    return [
      h('div', { class: 'grid2' },
        h('div', { class: 'card' },
          h('h4', {}, 'City-wide entertainment'),
          kv('Every home gets', `+${rep.base} of ${ENT_BASE_MAX}`), bar(rep.base, ENT_BASE_MAX),
          h('div', { class: 'muted sub', style: { marginTop: '4px' } }, 'From the seats of venues with shows: the share of the people each kind of venue can seat, averaged over the three kinds and divided by 5.')),
        h('div', { class: 'card' },
          h('h4', {}, 'Homes'),
          kv('Average entertainment', fmt(rep.average)),
          kv('Short of their next level', shortHomes ? `${fmt(shortHomes)} home${shortHomes === 1 ? '' : 's'}` : 'None', shortHomes ? 'no' : ''),
          shortHomes ? kv('...with no entertainer\'s visit', fmt(rep.short.none)) : null,
          h('div', { class: 'row', style: { marginTop: '6px' } },
            h('span', { class: 'muted sub', style: { flex: 1 } }, c.festivalCooldown > 0 ? `Festivals lift the mood: the next is possible in ${c.festivalCooldown} month${c.festivalCooldown === 1 ? '' : 's'}.` : festivalBlocked(g, 0) ? 'Festivals lift the mood: the city cannot pay for one yet (see Festivals).' : 'Festivals lift the mood: one can be held now.'),
            h('button', { class: 'btn small', onclick: () => this.switchTab('religion') }, 'Festivals')))),
      this.adviceBox(entertainmentAdviceText(rep.advice), rep.advice.key === 'fine' || rep.advice.key === 'noDemand'),
      h('h4', {}, 'Venues'),
      h('table', { class: 'tbl coverage' },
        h('tr', {}, h('th', {}, 'Venue'), h('th', { class: 'r' }, 'Staffed'), h('th', { class: 'r' }, 'Shows'), h('th', {}, 'Seats'), h('th', { class: 'r' }, 'Reach')),
        venueRows),
      h('div', { class: 'muted sub', style: { marginTop: '4px' } }, `Shows: the kinds of show booked at the staffed venues, of those they can stage (a theater plays; an amphitheater stages plays and bouts, an arena bouts and beasts, worth more with both). Seats: theater ${fmt(VENUE_SEATS.theater)}, amphitheater ${fmt(VENUE_SEATS.amphitheater)}, arena ${fmt(VENUE_SEATS.colosseum)} each.`),
      h('h4', {}, 'Training'),
      h('table', { class: 'tbl coverage' },
        h('tr', {}, h('th', {}, 'Building'), h('th', { class: 'r' }, 'Staffed'), h('th', {}, 'Sends performers to')),
        trainerRows),
    ];
  }

  tab_religion(g) {
    const c = g.city;
    // Each size's cost and what stops it (the cooldown or a shortfall), worked
    // out once: the table and every god's buttons read the same answers.
    const sizes = FESTIVAL_SIZES.map((key, size) => ({ key, size, name: key[0].toUpperCase() + key.slice(1), need: festivalNeeds(g, size), blocked: festivalBlocked(g, size) }));
    const have = festivalMeans(g);
    const cell = (need, held, unit) => h('td', { class: `r num${need > held ? ' no' : ''}` }, need > 0 ? `${fmt(need)}${unit}` : '-');
    const short = (r) => r.blocked && c.festivalCooldown <= 0; // the cooldown is said once, below the table
    return [
      h('div', { class: 'muted' }, `Each god wants about one staffed temple per ${CONFIG.PEOPLE_PER_TEMPLE} of its share of citizens; a large temple counts as two. Once the city passes 800 people, gods without any temple grow angry, and so does a god with no festival in its honor for more than ${CONFIG.FESTIVAL_FREE_MONTHS} months. Festivals and oracles can lift moods high enough for blessings. A god that has struck stays angered until its mood is back above ${CONFIG.GOD_CALM_MOOD}.`),
      h('div', { class: 'card festivals', style: { marginTop: '8px' } },
        h('h4', {}, 'Festivals'),
        h('table', { class: 'tbl coverage' },
          h('tr', {}, h('th', {}, 'Size'), h('th', { class: 'r' }, 'Denarii'), h('th', { class: 'r' }, 'Food'), h('th', { class: 'r' }, 'Wine'), h('th', { class: 'r', title: 'Months before another festival can be held' }, 'Pause')),
          sizes.map((r) => h('tr', { dataset: { size: r.key } },
            h('td', {}, r.name),
            cell(r.need.money, g.cheats.freeBuild ? Infinity : have.money, ' Dn'),
            cell(r.need.food, have.food, ''),
            cell(r.need.wine, have.wine, ''),
            h('td', { class: 'r num' }, `${CONFIG.FESTIVAL_COOLDOWN[r.size]} months`))),
          h('tr', { class: 'muted' }, h('td', {}, 'The city has'), h('td', { class: 'r num' }, `${fmt(have.money)} Dn`), h('td', { class: 'r num', title: 'Food in the granaries' }, fmt(have.food)), h('td', { class: 'r num', title: 'Wine in the warehouses' }, fmt(have.wine)), h('td', {}))),
        sizes.filter(short).map((r) => h('div', { class: 'status bad', style: { fontSize: '12px', marginTop: '4px' }, dataset: { short: r.key } }, `${r.name}: ${r.blocked}`)),
        h('div', { class: 'muted sub', style: { marginTop: '4px' } }, `Food comes from the granaries (the largest stocks first), wine from the warehouses; a festival is held only if all of it is there. Any festival resets its god's year; a large or grand one lifts the god and the people more.`),
        c.festivalCooldown > 0 ? h('div', { class: 'muted', style: { marginTop: '4px' } }, `Next festival possible in ${c.festivalCooldown} month${c.festivalCooldown === 1 ? '' : 's'}.`) : null),
      GOD_KEYS.map((k) => {
        const s = c.gods[k];
        const months = s.monthsSinceFestival || 0;
        const penalty = neglectPenalty(g, k);
        // Past its year in a town still too small for the gods to mind.
        const waiting = !penalty && festivalNeglect(months) > 0 && g.isUnlocked(`temple_${k}`);
        return h('div', { class: 'card', style: { marginTop: '8px' }, dataset: { god: k } },
          h('div', { class: 'row' }, h('h4', { style: { flex: 1, color: GODS[k].color } }, GODS[k].name), h('span', { class: 'muted' }, GODS[k].domain)),
          kv('Mood', `${Math.round(s.mood)} / 100`), bar(s.mood, 100),
          kv('Staffed temples', templeCount(g, k).text),
          kv('Last festival', s.festivalsHeld ? (months === 0 ? 'this month' : `${months} month${months === 1 ? '' : 's'} ago`) : 'none yet'),
          penalty > 0 ? h('div', { class: 'status bad', style: { fontSize: '12px' }, dataset: { neglect: penalty } }, `Neglected: mood target -${penalty}. A festival of any size in ${GODS[k].name}'s honor ends it.`) : null,
          waiting ? h('div', { class: 'muted', style: { fontSize: '12px' } }, `No festival for ${months} months: from 800 people ${GODS[k].name}'s mood target will fall ${festivalNeglect(months)}.`) : null,
          s.angered ? h('div', { class: 'status bad', style: { fontSize: '12px' } }, `Angered: until ${GODS[k].name}'s mood is back above ${CONFIG.GOD_CALM_MOOD}, another wrath strikes ${GODS[k].harderWrath && g.scenario.majorWrath !== false ? 'harder' : 'again'}.`) : null,
          h('div', { class: 'muted', style: { fontSize: '12px' } }, `Blessing: ${GODS[k].blessing} Wrath: ${GODS[k].wrath}`),
          h('div', { class: 'row', style: { marginTop: '6px' } },
            sizes.map((r) => h('button', {
              class: 'btn small',
              disabled: !!r.blocked,
              title: r.blocked || `${fmt(r.need.money)} Dn, ${fmt(r.need.food)} food${r.need.wine ? `, ${fmt(r.need.wine)} wine` : ''}`,
              dataset: { size: r.key },
              onclick: () => { const res = holdFestival(g, k, r.size); if (!res.ok) this.app.ui.toastError(res.reason); this.render(); },
            }, `${r.name} festival`))));
      }),
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
    const seatText = `Venue seats for ${seats.theater || 0}% (theaters), ${seats.amphitheater || 0}% (amphitheaters) and ${seats.colosseum || 0}% (arenas) of the city${seats.hippodrome ? ', and races at the hippodrome for everyone,' : ''} give every home +${g.city.entBase || 0} entertainment.`;
    return [
      row('culture', 'Culture', `Religion ${pct(cov.religion)}, school ${pct(cov.school)}, library ${pct(cov.library)}, academy ${pct(cov.academy)} of citizens covered; average entertainment ${Math.round(cov.entertainment || 0)}. ${seatText} Build temples, schools, libraries and venues where people live.`),
      row('prosperity', 'Prosperity', 'Rises with better housing, patrician villas, a profitable treasury, low unemployment, fair wages and a Curia. Changes slowly.'),
      row('peace', 'Peace', `Grows each month the city is content (mood ${CONFIG.PEACE_MOOD}+). No growth in a month when a thief is about (except on Easy); falls with low mood, thieves and riots (more on harder levels), raids and the wrath of Mars.`),
      row('favor', 'Favor', `The Emperor likes paid tributes, fulfilled requests, troops sent when he calls for them and gifts. Debt, missed requests and calls ignored anger him. At ${CONFIG.LEGION_FAVOR} or less he sends his legions against you (Imperial advisor).`),
    ];
  }

  tab_imperial(g) {
    const c = g.city;
    const r = c.request;
    return [
      h('div', { class: 'card' },
        kv('Emperor\'s favor', `${Math.round(c.ratings.favor)} / 100`), bar(c.ratings.favor, 100),
        h('div', { class: 'muted' }, 'Each year Rome collects a tribute based on your population.')),
      this.legionCard(g),
      this.battleCard(g),
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
      this.governorCard(g),
      h('div', { class: 'card gift-card', style: { marginTop: '10px' } },
        h('h4', {}, 'Send a gift to the Emperor (from your savings)'),
        h('div', { class: 'row' }, GIFT_SIZES.map((gs, i) => {
          const why = giftBlocked(g, i);
          return h('button', {
            class: 'btn small gift-btn', disabled: !!why, title: why || '',
            onclick: () => { const res = sendGift(g, i); if (!res.ok) this.app.ui.toastError(res.reason); else this.app.sfx.play('coin'); this.render(); },
          }, giftLabel(g, i));
        })),
        h('div', { class: 'muted', style: { fontSize: '12.5px', marginTop: '4px' } }, giftNote(g))),
    ];
  }

  /** Imperial tab: Caesar's anger (sim/legion.js), worded by ui/empireInfo.js. */
  legionCard(g) {
    const t = legionText(g);
    return h('div', { class: `card legion-card${t.level === 'none' ? '' : ` ${t.level}`}`, style: { marginTop: '10px' } },
      h('h4', {}, 'Caesar\'s legions'),
      h('div', { class: `status ${t.level === 'none' ? 'good' : t.level}` }, t.status),
      h('div', { class: 'muted', style: { fontSize: '12.5px', marginTop: '4px' } }, t.note),
      t.show ? h('button', { class: 'btn small primary', style: { marginTop: '6px' }, onclick: () => { this.app.ui.closeModal(); this.app.focusThreat(); } }, 'Show me the legions') : null,
      t.map ? h('button', { class: 'btn small', style: { marginTop: '6px' }, onclick: () => this.app.ui.openEmpire('legion') }, 'Show on the empire map') : null);
  }

  /**
   * Imperial tab: Caesar's call for troops (sim/battle.js): the city, the
   * enemy, the time left, the troops switched to Empire service and the
   * button that sends them; then the march, the battle and the way home.
   */
  battleCard(g) {
    const s = battleSummary(g);
    const forts = [...g.buildings.values()].filter((b) => b.def.kind === 'fort' || (b.def.kind === 'station' && s && s.fleet));
    const record = g.military.battles || { won: 0, lost: 0 };
    const head = h('h4', {}, 'Calls for troops');
    if (!s) {
      return h('div', { class: 'card battle-card', style: { marginTop: '10px' } }, head,
        h('div', { class: 'muted' }, 'Caesar has asked for no troops. When he does, switch forts (and, for a city by the sea, naval stations) to Empire service and send them from here.'),
        recallLines(recallSummary(g)).map((l) => h('div', { class: l.cls || '' }, l.text)),
        kv('Battles won / lost', `${record.won} / ${record.lost}`),
        archLine(g));
    }
    const lines = battleLines(g, s);
    const send = () => {
      const why = sendBlocked(g);
      if (why) { this.app.ui.toastError(why); return; }
      const ready = s.ready;
      const what = `${ready.men} soldier${ready.men === 1 ? '' : 's'}${ready.ships ? ` and ${ready.ships} liburnian${ready.ships === 1 ? '' : 's'}` : ''}`;
      this.app.ui.confirm(`${what} (strength ${ready.strength} against ${s.words}, about ${s.enemy}) will leave at once. Their forts take no recruits until they are home. You can recall them, but a rider must catch up with them first.`, () => {
        const res = sendTroops(g);
        if (!res.ok) this.app.ui.toastError(res.reason);
        this.app.ui.openAdvisors('imperial');
      }, { title: `Send troops to ${s.name}?`, yes: 'Send them' });
    };
    const pending = s.phase === 'pending' && !s.sent;
    return h('div', { class: 'card battle-card', style: { marginTop: '10px' } }, head,
      lines.map((l) => h('div', { class: l.cls || '' }, l.text)),
      pending && forts.length ? h('table', { class: 'tbl', style: { marginTop: '6px' } },
        h('tr', {}, h('th', {}, 'Post'), h('th', { class: 'r' }, 'Men'), h('th', { class: 'r' }, 'Strength'), h('th', {}, 'Empire service')),
        forts.map((b) => {
          const men = [...g.units.values()].filter((u) => (u.fort || u.station) === b.id && !u.away);
          return h('tr', {},
            h('td', {}, b.def.name),
            h('td', { class: 'r num' }, fmt(men.length)),
            h('td', { class: 'r num' }, fmt(strengthOf(men))),
            h('td', {}, serviceButton(g, b, () => this.render())));
        })) : null,
      pending && !forts.length ? h('div', { class: 'muted' }, 'You have no forts to send. Build a Tirocinium (Barracks) and a fort (Military menu).') : null,
      s.phase === 'pending' && s.sent ? this.recallTable(g) : null,
      pending ? h('button', { class: 'btn primary send-troops', style: { marginTop: '6px' }, disabled: !!sendBlocked(g), title: sendBlocked(g) || '', onclick: send }, `Send the troops (strength ${s.ready.strength})`) : null,
      h('button', { class: 'btn small', style: { marginTop: '6px', marginLeft: '6px' }, onclick: () => this.app.ui.openEmpire() }, 'Show on the empire map'),
      kv('Battles won / lost', `${record.won} / ${record.lost}`),
      archLine(g));
  }

  /**
   * Imperial tab, troops sent: each fort and station with men away, how
   * many, and a Recall button (or its rider, or its way home).
   */
  recallTable(g) {
    const posts = postsInBattle(g);
    if (!posts.length) return null;
    return h('table', { class: 'tbl', style: { marginTop: '6px' } },
      h('tr', {}, h('th', {}, 'Post'), h('th', { class: 'r' }, 'Away'), h('th', {}, 'Recall')),
      posts.map((b) => {
        const away = awayOf(g, b.id).length + [...g.units.values()].filter((u) => u.away && (u.fort || u.station) === b.id).length;
        return h('tr', {},
          h('td', {}, b.def.name),
          h('td', { class: 'r num' }, fmt(away)),
          h('td', {}, recallControls(g, b, () => this.render(), (why) => this.app.ui.toastError(why))));
      }));
  }

  /**
   * Imperial tab: the governor's rank, his salary (any rank's rate, picked
   * here) and what Rome will make of it, his savings and donations to the
   * treasury (sim/governor.js).
   */
  governorCard(g) {
    const gv = g.city.governor;
    const won = g.city.victory;
    const give = (n) => { const res = donate(g, n); if (!res.ok) this.app.ui.toastError(res.reason); else this.app.sfx.play('coin'); this.render(); };
    const amounts = [100, 500].filter((n) => n < gv.savings);
    return h('div', { class: 'card governor-card', style: { marginTop: '10px' } },
      h('h4', {}, 'The governor'),
      kv('Rank', rankLine(g)),
      kv('Personal savings', `${fmt(gv.savings)} Dn`),
      h('div', { class: 'field', style: { marginTop: '6px' } }, h('label', {}, 'Your salary, paid monthly from the treasury'),
        h('select', {
          class: 'salary-select', disabled: won,
          onchange: (e) => { const res = setSalary(g, Number(e.target.value)); if (!res.ok) this.app.ui.toastError(res.reason); this.render(); },
        }, RANKS.map((r, i) => h('option', { value: i, selected: i === gv.salaryRank }, salaryOption(i, gv.rank))))),
      kv('Paid this year', `${fmt(gv.paidThisYear)} Dn`),
      h('div', { class: 'muted', style: { fontSize: '12.5px' } }, salaryOutlookText(g)),
      h('div', { class: 'muted', style: { fontSize: '12.5px', marginTop: '4px' } }, 'Rome judges the year\'s pay at New Year: above your rank\'s costs favor, below it earns a little. The salary is not paid while the treasury cannot cover it.'),
      h('div', { class: 'row', style: { marginTop: '6px', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
        h('span', {}, 'Give to the city:'),
        amounts.map((n) => h('button', { class: 'btn small donate-btn', onclick: () => give(n) }, `${fmt(n)} Dn`)),
        h('button', { class: 'btn small donate-btn', disabled: gv.savings <= 0, onclick: () => give(gv.savings) }, `All (${fmt(gv.savings)} Dn)`)),
      h('div', { class: 'muted', style: { fontSize: '12.5px' } }, 'Donations go into the treasury, on a ledger line of their own; they are not counted as the city\'s profit. Your savings go with you to your next mission.'));
  }

  tab_messages(g) {
    if (!g.messages.length) return h('div', { class: 'muted' }, 'No messages yet.');
    return h('div', {}, g.messages.map((m) => h('div', {
      class: `toast ${m.level}`, style: { animation: 'none', marginBottom: '5px' }, title: clickHint(m),
      // (The empire map takes the advisors' place; a glide needs them closed.)
      onclick: () => { if (m.empire) openMessage(this.app, m); else if (openMessage(this.app, m)) this.app.ui.closeModal(); },
    }, h('span', { class: 'date' }, m.date), m.text)));
  }
}

/** The color of a coverage figure: green when everyone who needs it has it, red under half. */
function coverageClass(pct) {
  if (pct === null || pct === undefined) return '';
  return pct >= 100 ? 'ok' : pct < 50 ? 'no' : '';
}

/**
 * Finance tab: how many homes pay no tax, and where to find out why (a lone
 * Forum's collector can spend his rounds on streets nobody lives on, and the
 * registrations he left behind run out).
 */
function unregisteredNote(g) {
  let n = 0;
  for (const b of g.buildings.values()) if (b.house && b.house.pop > 0 && !(b.house.tax > 0)) n++;
  if (!n) return null;
  return h('div', { class: 'muted' }, `${fmt(n)} home${n === 1 ? ' is' : 's are'} not registered. Click one: its panel says why.`);
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

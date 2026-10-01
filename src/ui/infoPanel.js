/**
 * infoPanel.js
 * ----------------------------------------------------------------------------
 * The "what is this and what does it need" panel shown when you click a
 * building, a walker, a ship of war or a tile. For houses it spells out
 * exactly which needs block the next tier, which is the most important
 * feedback loop in the game. A roadblock's tile shows who it lets through; a
 * walker shows where it comes from, what it is doing and what it has to say
 * (ui/walkerTalk.js); a liburnian or raider ship its hull, its work and its
 * station or raid.
 * ----------------------------------------------------------------------------
 */

import { h, mount, fmt, pct, bar, kv } from './dom.js';
import { CONFIG } from '../config.js';
import { BUILDINGS, LABOR_CATEGORIES, VENUE_POINTS, VENUE_BOTH_BONUS, VENUE_SUPPLIERS, PERFORMER_NAMES, ENT_BASE_MAX, ENT_SEATS_MAX } from '../data/buildings.js';
import { HOUSE_TIERS, MAX_TIER, houseCapacity } from '../data/housing.js';
import { GOODS, FOOD_TYPES, HOUSE_GOODS, RECRUIT_COST, formatAmount } from '../data/goods.js';
import { UNIT_TYPES, FORT_CAPACITY, HERD_MAX, STATION_CAPACITY } from '../data/units.js';
import { GODS, GOD_KEYS } from '../data/gods.js';
import { WALKER_TYPES, ROADBLOCK_GROUPS } from '../data/walkers.js';
import { TERRAIN_NAMES, WaterBits, Road, Wall, ROADBLOCK } from '../world/map.js';
import { walkerInfo } from './walkerTalk.js';
import { storageCapacity, storageUsed } from '../sim/storage.js';
import { cycleOrder, setEmptying, orderGoods } from '../sim/storageOrders.js';
import { ORDER_LABELS, orderLines } from './storageInfo.js';
import { dockShipText, dockRows, dockHint } from './dockInfo.js';
import { venueActive, venueHasBoth } from '../sim/services.js';
import { houseMonthlyTax } from '../sim/economy.js';
import { garrisonCounts, recallFort, wallHpOf, buildingMaxHp, TOWER_RANGE, TOWER_COOLDOWN } from '../sim/military.js';
import { dockBerth, dockUsed } from '../sim/trade.js';
import { wharfBoat, spareBoat, boatStatus, bodyOf, wharvesWithoutBoat } from '../sim/fishing.js';
import { squadronCounts, recallStation, waterOf, shipStatus, ramOf } from '../sim/navy.js';
import { trainedText, trainingNote, schoolStatus } from './trainingInfo.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';
import { removeBuilding } from '../sim/entities.js';
import { riskRates } from '../sim/risk.js';
import { farmDormant, daysToNextMare } from '../sim/production.js';
import { moodWord, moodReasonText, criminalText, crimeBand } from './crimeInfo.js';
import { homeHealth, sickText, noDiseaseText } from './healthInfo.js';
import { ruinAt } from '../sim/ruins.js';
import { rebuildPlan } from '../sim/construction.js';
import { lacksRoad } from '../sim/roadAccess.js';
import { withArticle } from '../sim/risk.js';
import { MONTH_SHORT, formatYear } from '../sim/time.js';
import { rankLine } from './governorInfo.js';
import { awayOf } from '../sim/battle.js';
import { serviceButton, serviceNote } from './empireInfo.js';

/** "in about 12 days", counting the winter rest on Insane. */
function nextMareText(game, b) {
  const days = daysToNextMare(game, b);
  if (!Number.isFinite(days)) return 'not while the ranch is idle';
  return `in about ${days} days${farmDormant(game, b) ? ' (after the winter)' : ''}`;
}

/**
 * "; a Clothing Maker makes it from linen": who makes a home's good, for the
 * description of the need. Most chains are one workshop long and named in
 * the help; clothing's is two (flax, linen, clothing), so say it here too.
 */
function madeBy(good) {
  const def = Object.values(BUILDINGS).find((d) => d.kind === 'workshop' && d.produces === good);
  if (!def) return '';
  const inputs = Object.keys(def.recipe).map((g) => GOODS[g].name.toLowerCase()).join(' and ');
  return `; ${withArticle(def.name)} makes it from ${inputs}`;
}

/** Plain-English description of one missing house requirement. */
export function describeNeed(m) {
  switch (m.key) {
    case 'water': return m.need >= 2 ? 'Clean water from a fountain within 4 tiles (fountains need a reservoir).' : 'Access to water: a well within 2 tiles.';
    case 'food': return `${m.need} type${m.need > 1 ? 's' : ''} of food (has ${m.have}). A market vendor must pass by, and the market needs a stocked granary.`;
    case 'religion': return `Priests of ${m.need} different god${m.need > 1 ? 's' : ''} visiting (has ${m.have}). Build temples nearby.`;
    case 'ent': return `Entertainment ${m.need} (has ${m.have}). Entertainers passing by: theater ${VENUE_POINTS.theater}, amphitheater ${VENUE_POINTS.amphitheater} (${VENUE_POINTS.amphitheater + VENUE_BOTH_BONUS.amphitheater} with plays and gladiators), colosseum ${VENUE_POINTS.colosseum} (${VENUE_POINTS.colosseum + VENUE_BOTH_BONUS.colosseum} with gladiators and beasts), the hippodrome's charioteers ${VENUE_POINTS.hippodrome}, plus up to ${ENT_SEATS_MAX} when the city's venues have seats for everyone (${ENT_BASE_MAX} with races at the hippodrome).`;
    case 'edu': return `${['', 'A school or a library nearby.', 'Both a school and a library nearby.', 'A school, a library and an academy nearby.'][m.need]} (has ${['none', 'one of school and library', 'school and library', 'all three'][m.have]})`;
    case 'barber': return 'A barber nearby.';
    case 'baths': return 'Public baths (Thermae) nearby. They need piped water from a reservoir.';
    case 'health': return m.need >= 2
      ? `Both a medicus nearby and a hospital within ${CONFIG.HOSPITAL_RADIUS} tiles (has ${m.have === 0 ? 'neither' : m.hospital ? 'the hospital' : 'the medicus'}).`
      : `A medicus nearby, or a hospital within ${CONFIG.HOSPITAL_RADIUS} tiles.`;
    case 'goods': return `${GOODS[m.good].name} sold by a market vendor (needs a warehouse stocked with ${GOODS[m.good].name.toLowerCase()}${madeBy(m.good)}).`;
    case 'wine': return `Two sources of wine in the city (has ${m.have}): a working winery, and each open trade route that sells wine while wine is set to import.`;
    case 'des': return `Desirability ${m.need} (now ${m.have}). Gardens, statues, plazas, temples and grand homes help; humble homes, industry and storage hurt.`;
    case 'space': return `Room to grow into a ${m.need}×${m.need} home: homes of its level or lower, clear land or gardens beside it.`;
    case 'sick': return `To be well again: ${m.have} day${m.have === 1 ? '' : 's'} of sickness left, or a physician's visit.`;
    default: return m.key;
  }
}

/** How the panel words each cause of a ruin (sim/ruins.js RUIN_CAUSES). */
const RUIN_WORDS = {
  fire: 'burned down',
  wrath: 'burned by an angry god',
  raidFire: 'burned by raiders',
  riot: 'burned by rioters',
  collapse: 'collapsed',
  raid: 'torn down by raiders',
  raidWall: 'broken down by raiders',
  legionFire: 'burned by Caesar\'s legions',
  legion: 'torn down by Caesar\'s legions',
  legionWall: 'broken down by Caesar\'s legions',
};

/**
 * "Ruins of a Prefecture, burned down in Iul 280 BC." for a rubble record,
 * or null for rubble without one (from a save before version 7).
 */
export function ruinText(rec) {
  if (!rec) return null;
  return `Ruins of ${withArticle(rec.what)}, ${RUIN_WORDS[rec.cause] || 'fallen'} in ${MONTH_SHORT[rec.month]} ${formatYear(rec.year)}.`;
}

/** Status line for any non-house building. */
export function buildingStatus(game, b) {
  const def = b.def;
  if (lacksRoad(b)) return { level: 'bad', text: 'No road touches this building, so it gets no workers and does nothing. Build a road along any of its edges (any side works; a corner does not).' };
  if (def.workers && b.laborAccess <= 0) return { level: 'bad', text: `Cannot find workers: no occupied housing within ${CONFIG.LABOR_RANGE} tiles along the roads.` };
  if (def.workers && b.efficiency <= 0) return { level: 'bad', text: 'No workers available. The city needs more people, or change labor priorities.' };
  if (def.needsPiped && !b.hasWater) return { level: 'bad', text: 'No piped water. It must sit inside a full reservoir\'s area.' };
  switch (def.kind) {
    case 'residence':
      return { level: 'good', text: 'The governor lives here.' };
    case 'reservoir':
      if (!b.hasWater) return { level: 'bad', text: 'Dry. Build next to a river/lake, or connect by aqueduct to a full reservoir.' };
      break;
    case 'farm':
      if (b.fertility <= 0) return { level: 'bad', text: 'No meadow under this field: nothing grows.' };
      if (b.noStorage) return { level: 'warn', text: 'Harvest is piling up: no granary or warehouse with room is reachable.' };
      if (farmDormant(game, b)) return { level: 'warn', text: 'Winter: nothing grows until spring (Martius). Stored harvest still goes out.' };
      break;
    case 'raw':
      if (b.resourceOk === false) return { level: 'bad', text: 'The natural resource nearby is gone.' };
      if (b.noStorage) return { level: 'warn', text: 'No workshop or warehouse with room is reachable.' };
      break;
    case 'workshop': {
      const missing = Object.entries(def.recipe).filter(([good, n]) => b.stock[good] < n).map(([good]) => GOODS[good].name.toLowerCase());
      if (missing.length) return { level: 'warn', text: `Waiting for ${missing.join(' and ')} from a producer or warehouse.` };
      if (b.noStorage) return { level: 'warn', text: 'No warehouse with room is reachable for the finished goods.' };
      break;
    }
    case 'barracks':
    case 'navalia':
      if (b.blocked) return { level: 'warn', text: b.blocked };
      break;
    case 'military_academy':
    case 'portus':
      return schoolStatus(game, b);
    case 'station': {
      if (!waterOf(game, b)) return { level: 'bad', text: 'Not beside water that ships can sail.' };
      const n = squadronCounts(game).get(b.id) || 0;
      if (n >= STATION_CAPACITY) return { level: 'good', text: `Squadron at full strength (${STATION_CAPACITY} liburnians).` };
      const yard = [...game.buildings.values()].some((x) => x.def.kind === 'navalia' && waterOf(game, x) === waterOf(game, b));
      if (!yard) return { level: 'bad', text: 'No Navalia on this water: build one on its shore to build liburnians for this station.' };
      break;
    }
    case 'wharf': {
      if (!wharfBoat(game, b)) {
        const yard = [...game.buildings.values()].some((x) => x.def.kind === 'shipyard' && bodyOf(game, x) === bodyOf(game, b));
        return { level: 'warn', text: yard ? 'Waiting for a boat from the shipyard.' : 'Waiting for a boat: build a Shipyard on this water.' };
      }
      if (b.noStorage) return { level: 'warn', text: 'The catch is piling up: no granary or warehouse with room is reachable.' };
      break;
    }
    case 'shipyard':
      if (bodyOf(game, b) === 0) return { level: 'bad', text: 'Not beside water with fish.' };
      break;
    case 'dock':
      if (!game.map.seaEntry) return { level: 'bad', text: 'No river or sea here reaches the map edge: ships cannot come.' };
      if (dockBerth(game, b) < 0) return { level: 'bad', text: 'Not beside water that ships can sail.' };
      if (b.noStorage && dockUsed(b) > 0) return { level: 'warn', text: 'Imports are piling up: no warehouse, granary or workshop with room is reachable by road.' };
      if (dockHint(game, b)) return { level: 'warn', text: dockHint(game, b) };
      break;
    case 'fort': {
      const n = garrisonCounts(game).get(b.id) || 0;
      if (n >= FORT_CAPACITY) return { level: 'good', text: `Garrison at full strength (${FORT_CAPACITY} soldiers).` };
      const hasBarracks = [...game.buildings.values()].some((x) => x.def.kind === 'barracks');
      if (!hasBarracks) return { level: 'bad', text: 'No Barracks: build one (connected by road) to train recruits for this fort.' };
      const cost = Object.keys(RECRUIT_COST[def.unit] || {});
      if (cost.length && b.efficiency > 0 && (b.recruiting || 0) === 0) {
        return { level: 'warn', text: `${n} / ${FORT_CAPACITY} soldiers. Recruits need ${cost.map((g) => GOODS[g].name.toLowerCase()).join(' and ')} at the Barracks.` };
      }
      break;
    }
    case 'venue':
      if (def.venue === 'hippodrome' && !venueActive(b)) return { level: 'warn', text: 'No races: a Chariot Maker connected by road sends the teams.' };
      if (!venueActive(b)) {
        const need = VENUE_SUPPLIERS[def.venue].map((v) => PERFORMER_NAMES[v].toLowerCase() + 's').join(' or ');
        return { level: 'warn', text: `No shows booked. It needs ${need} from a training building connected by road.` };
      }
      break;
    case 'market': {
      const any = [...FOOD_TYPES, ...HOUSE_GOODS].some((k) => b.stock[k] > 0);
      if (!any) return { level: 'warn', text: 'The stalls are empty. The buyer needs a stocked granary or warehouse nearby.' };
      break;
    }
    default:
      break;
  }
  if (def.workers && b.efficiency < 1) return { level: 'warn', text: `Understaffed: working at ${pct(b.efficiency)}.` };
  return { level: 'good', text: 'Working normally.' };
}

/**
 * What a home's panel says about its taxes, and why when it pays none: a
 * home is registered only for TAX_ACCESS_DAYS after a tax collector walks by,
 * and "needs a Forum nearby" once sent a player with a Forum next door
 * looking in the wrong place (its collector was walking other streets).
 */
export function taxLine(game, hs) {
  if (hs.tax > 0) {
    const days = Math.ceil(hs.tax);
    return `Registered: ~${fmt(houseMonthlyTax(game, hs))} Dn/month, for ${days} more day${days === 1 ? '' : 's'} unless a tax collector passes again`;
  }
  const offices = [...game.buildings.values()].filter((b) => b.def.walker === 'taxman');
  if (!offices.length) return 'Not registered: the city has no Forum to send tax collectors';
  if (!offices.some((b) => b.efficiency > 0 && b.accessRoad >= 0)) return 'Not registered: no Forum has the workers and a road to send tax collectors';
  return `Not registered: no tax collector has passed in the last ${CONFIG.TAX_ACCESS_DAYS} days. A Forum nearer by, or roadblocks that keep its collector on these streets, would reach it`;
}

export class InfoPanel {
  constructor(app, root) {
    this.app = app;
    this.el = h('div', { id: 'info-panel', class: 'hidden' });
    root.appendChild(this.el);
    this.target = null; // { kind: 'building', id } | { kind: 'tile', x, y } | { kind: 'walker', id }
    this.timer = 0;
    // A pointer held down in the panel (a press on a button, say): the timed
    // rebuild waits, or it would replace the button between press and
    // release and the click would be lost. It runs on the next frame after
    // the release instead, once the click has landed.
    this.pressed = false;
    this.el.addEventListener('pointerdown', () => { this.pressed = true; });
    const release = () => {
      if (!this.pressed) return;
      this.pressed = false;
      this.timer = Math.max(this.timer, 0.7); // the frame after the click event
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }

  get open() { return !this.el.classList.contains('hidden'); }

  showBuilding(id) {
    // A hippodrome's other sections show the hippodrome.
    const b = this.app.game?.buildings.get(id);
    if (b && b.main && this.app.game.buildings.has(b.main)) id = b.main;
    this.target = { kind: 'building', id };
    this.unselectWalker();
    this.app.renderer.selectedId = id;
    this.el.classList.remove('hidden');
    this.render();
  }

  showTile(x, y) {
    this.target = { kind: 'tile', x, y };
    this.unselectWalker();
    this.app.renderer.selectedId = 0;
    this.el.classList.remove('hidden');
    this.render();
  }

  /** Show a walker; the renderer rings it (and follows it if asked). */
  showWalker(id) {
    this.target = { kind: 'walker', id };
    this.app.renderer.selectedId = 0;
    this.app.renderer.selectedUnit = 0;
    this.app.renderer.selectedWalker = id;
    this.app.renderer.follow = null;
    this.el.classList.remove('hidden');
    this.render();
  }

  /** Show a ship of war (a liburnian or a raider ship); the renderer rings it. */
  showUnit(id) {
    this.target = { kind: 'unit', id };
    this.unselectWalker();
    this.app.renderer.selectedId = 0;
    this.app.renderer.selectedUnit = id;
    this.el.classList.remove('hidden');
    this.render();
  }

  unselectWalker() {
    this.app.renderer.selectedWalker = 0;
    this.app.renderer.selectedUnit = 0;
    this.app.renderer.follow = null;
  }

  close() {
    this.target = null;
    this.app.renderer.selectedId = 0;
    this.unselectWalker();
    this.el.classList.add('hidden');
  }

  update(dt) {
    if (!this.open) return;
    this.timer += dt;
    if (this.timer < 0.7) return;
    if (this.pressed) return; // a press in progress: rebuild after the release
    this.timer = 0;
    // Do not rebuild while the user is interacting with a control inside.
    if (this.el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    this.refresh();
  }

  /**
   * The timed refresh: the panel is rebuilt off-screen and swapped in only
   * when something in it changed. Replacing it every 0.7 s whatever happened
   * pulled buttons out from under the pointer: on a slow machine a button
   * (a storehouse's order, say) was never still long enough to be clicked.
   */
  refresh() {
    const live = this.el;
    const scratch = live.cloneNode(false);
    this.el = scratch;
    try {
      this.render();
    } finally {
      this.el = live;
    }
    if (!this.target) { this.close(); return; } // render closed it (the building is gone)
    if (scratch.innerHTML === live.innerHTML) return;
    live.replaceChildren(...scratch.childNodes);
  }

  render() {
    const g = this.app.game;
    if (!g || !this.target) { this.close(); return; }
    if (this.target.kind === 'tile') { this.renderTile(g); return; }
    if (this.target.kind === 'walker') { this.renderWalker(g); return; }
    if (this.target.kind === 'unit') { this.renderUnit(g); return; }
    const b = g.buildings.get(this.target.id);
    if (!b) { this.close(); return; }
    if (b.house) this.renderHouse(g, b);
    else this.renderBuilding(g, b);
  }

  head(title, sub) {
    return h('div', { class: 'panel-head' },
      h('h3', {}, title),
      sub ? h('span', { class: 'chip' }, sub) : null,
      h('button', { class: 'panel-close', title: 'Close (right click)', onclick: () => this.close() }, '×'));
  }

  /**
   * Fire and collapse risk. What cannot burn or collapse (a warehouse, a
   * well, a Tent's roof) says so: "0%" would read as "safe for now".
   */
  risks(b) {
    const rates = riskRates(b);
    if (!(rates.fire > 0) && !(rates.damage > 0)) {
      return h('div', { class: 'panel-sec' }, h('h5', {}, 'Risks'), h('div', { class: 'muted' }, 'None: it never burns or collapses on its own.'));
    }
    const row = (label, rate, risk, never) => (rate > 0
      ? [kv(label, `${Math.round(risk)}%`), bar(risk, 100, 'risk')]
      : [kv(label, never)]);
    return h('div', { class: 'panel-sec' },
      h('h5', {}, 'Risks'),
      row('Fire risk', rates.fire, b.fireRisk, 'None: it cannot burn'),
      row('Collapse risk', rates.damage, b.damageRisk, 'None: it cannot collapse'));
  }

  demolishButton(g, b) {
    return h('div', { class: 'panel-sec row' },
      h('button', {
        class: 'btn danger small',
        onclick: () => {
          const people = b.house ? b.house.pop : 0;
          const msg = people > 0 ? `Demolish this home? ${people} residents will become homeless.` : `Demolish this ${b.house ? 'home' : b.def.name}?`;
          this.app.ui.confirm(msg, () => {
            if (!g.buildings.has(b.id)) return;
            removeBuilding(g, b, 'demolish');
            g.onMapEdited();
            this.app.sfx.play('demolish');
            this.close();
          }, { title: 'Demolish', yes: 'Demolish', danger: true });
        },
      }, '⛏ Demolish'),
      h('span', { class: 'muted', style: { fontSize: '12px' } }, `#${b.id} at ${b.x},${b.y}`));
  }

  renderHouse(g, b) {
    const hs = b.house;
    const tier = HOUSE_TIERS[hs.tier];
    const cap = houseCapacity(hs.tier, b.size);
    const parts = [this.head(tier.name, hs.merged ? `${b.size}×${b.size} block` : `${b.size}×${b.size}`)];
    if (hs.tier === 0 || hs.pop === 0) {
      let text = 'Waiting for settlers.';
      let level = 'warn';
      if (b.accessRoad < 0) { text = 'No road within 2 tiles: settlers cannot get here.'; level = 'bad'; }
      else if (b.noEntryRoute) { text = 'The road here is not connected to the map entrance.'; level = 'bad'; }
      else if (g.city.sentiment < 30) { text = 'Nobody wants to move to the city right now (mood is too low).'; level = 'bad'; }
      else if (hs.incoming > 0) { text = `${hs.incoming} settlers are on their way.`; level = 'good'; }
      parts.push(h('div', { class: `status ${level}` }, text));
    } else {
      parts.push(kv('Residents', `${hs.pop} / ${cap}${hs.incoming ? ` (+${hs.incoming} arriving)` : ''}`));
      parts.push(kv('Class', tier.patrician ? 'Patricians (do not work)' : 'Plebeians (can work)'));
      // Evolution status
      let status;
      const fresh = hs.bornDay === g.time.totalDays;
      if (fresh && hs.devolving && hs.blocked) {
        status = h('div', { class: 'status warn' }, h('b', {}, 'Split off a bigger home today, with no service visits yet. To keep its level it needs:'), h('ul', { class: 'needs' }, hs.blocked.map((m) => h('li', {}, describeNeed(m)))));
      } else if (hs.devolving && hs.blocked) {
        const left = Math.max(1, g.difficulty.devolveDays - hs.devolveDays);
        status = h('div', { class: 'status bad' }, h('b', {}, `Will decline to ${HOUSE_TIERS[hs.tier - 1].name} in ${left} day${left > 1 ? 's' : ''} unless it gets:`), h('ul', { class: 'needs' }, hs.blocked.map((m) => h('li', {}, describeNeed(m)))));
      } else if (hs.tier >= MAX_TIER) {
        status = h('div', { class: 'status good' }, 'The finest home in the province.');
      } else if (hs.blocked && hs.blocked.length) {
        status = h('div', { class: 'status warn' }, h('b', {}, `To become a ${HOUSE_TIERS[hs.tier + 1].name} it needs:`), h('ul', { class: 'needs' }, hs.blocked.map((m) => h('li', {}, describeNeed(m)))));
      } else {
        status = h('div', { class: 'status good' }, `All needs met: it will become a ${HOUSE_TIERS[hs.tier + 1].name} tomorrow.`);
      }
      parts.push(status);
      const lv = hs.levels || {};
      const gods = GOD_KEYS.filter((k) => hs.religion[k] > 0).map((k) => GODS[k].name);
      const ent = Object.keys(VENUE_POINTS).filter((v) => hs.ent[v] > 0).map((v) => (hs.entBoth && hs.entBoth[v] > 0 ? `${v} (both shows)` : v));
      if (g.city.entBase > 0) ent.push(`city ${g.city.entBase}`);
      const health = [['barber', 'Barber'], ['clinic', 'Medicus'], ['baths', 'Thermae']].filter(([k]) => hs[k] > 0).map(([, n]) => n);
      if (lv.hospital) health.push('Hospital');
      const edu = [['school', 'School'], ['library', 'Library'], ['academy', 'Academy']].filter(([k]) => hs[k] > 0).map(([, n]) => n);
      parts.push(h('div', { class: 'panel-sec' },
        h('h5', {}, 'Services'),
        kv('Water', hs.water >= 2 ? 'Fountain' : hs.water === 1 ? 'Well' : 'None'),
        kv('Food', FOOD_TYPES.filter((f) => hs.food[f] > 0.01).map((f) => `${GOODS[f].name} ${Math.floor(hs.food[f])}`).join(', ') || 'None'),
        kv('Religion', gods.join(', ') || 'None'),
        kv('Entertainment', ent.length ? `${lv.ent || 0} (${ent.join(', ')})` : 'None'),
        kv('Education', edu.join(', ') || 'None'),
        kv('Health', health.join(', ') || 'None'),
        kv('Goods', HOUSE_GOODS.filter((x) => hs.goods[x] > 0.01).map((x) => GOODS[x].name).join(', ') || 'None'),
        kv('Desirability', hs.tier >= MAX_TIER ? `${hs.des} (falls at ${tier.down})` : `${hs.des} (${tier.up} to move up${hs.tier > 1 ? `, falls at ${tier.down}` : ''})`),
        kv('Taxes', taxLine(g, hs)),
      ));
      parts.push(this.moodSection(g, hs));
      parts.push(this.healthSection(g, b));
    }
    parts.push(this.risks(b));
    parts.push(this.demolishButton(g, b));
    mount(this.el, parts);
  }

  /** A home's mood (sim/mood.js) and what it means for crime (sim/crime.js). */
  moodSection(g, hs) {
    const known = hs.mood !== null && hs.mood !== undefined;
    const why = known && hs.mood < 50 ? moodReasonText(hs) : null;
    const band = known && g.scenario.crime !== false ? crimeBand(hs) : null;
    return h('div', { class: 'panel-sec' },
      h('h5', {}, 'Mood and order'),
      kv('Mood', known ? `${hs.mood} / 100, ${moodWord(hs.mood).toLowerCase()}` : 'New household (settling in)'),
      known ? bar(hs.mood, 100) : null,
      why ? h('div', { class: 'muted' }, why) : null,
      band ? kv('Crime', band.words) : null,
      criminalText(hs) ? h('div', { class: 'muted' }, criminalText(hs)) : null,
      kv('Police', hs.police > 0 ? `Patrolled (${hs.police} days left)` : 'None lately'),
      h('div', { class: 'muted' }, g.scenario.crime === false ? 'There is no crime in this province.' : 'A home below 50 may send a protester into the street; far below, a thief or a riot. A prefect passing by halves the chance.'));
  }

  /** A home's health score, what lowers it, its disease risk and sickness (sim/disease.js). */
  healthSection(g, b) {
    const hh = homeHealth(g, b);
    if (!hh) return null;
    const sick = sickText(b.house);
    const none = noDiseaseText(g);
    return h('div', { class: 'panel-sec' },
      h('h5', {}, 'Health'),
      sick ? h('div', { class: 'status bad' }, sick) : null,
      kv('Health', `${hh.score} / 100, ${hh.word.toLowerCase()}`),
      bar(hh.score, 100),
      hh.lacks ? h('div', { class: 'muted' }, `Lowered by: ${hh.lacks}.`) : null,
      sick ? null : kv('Disease risk', `${hh.riskWords} (${hh.risk})`),
      sick ? null : bar(hh.risk, 100, 'risk'),
      h('div', { class: 'muted' }, none || 'Crowded homes with poor health build disease risk; a passing physician clears it and cures the sick.'));
  }

  renderBuilding(g, b) {
    const def = b.def;
    const st = buildingStatus(g, b);
    const parts = [this.head(def.name, `${b.size * (def.span || 1)}×${b.size}`), h('div', { class: `status ${st.level}` }, st.text)];
    if (def.workers) {
      parts.push(h('div', { class: 'panel-sec' },
        h('h5', {}, 'Employment'),
        kv('Workers', `${b.workers} / ${def.workers}`), bar(b.workers, def.workers),
        kv('Labor category', LABOR_CATEGORIES[def.labor] || 'Industry')));
    }
    const sec = (title, ...kids) => h('div', { class: 'panel-sec' }, h('h5', {}, title), kids);
    switch (def.kind) {
      case 'farm':
        if (b.herd !== undefined) {
          parts.push(sec('Horse ranch',
            kv('Breeding mares', `${b.herd} / ${HERD_MAX}`), bar(b.herd, HERD_MAX),
            b.herd < HERD_MAX ? kv('Next mare', nextMareText(g, b)) : null,
            kv('Pasture (meadow)', pct(b.fertility)),
            kv('Next foal', pct(b.progress / 100)), bar(b.progress, 100),
            kv('Horses waiting', formatAmount('horses', b.stock.horses)),
            h('div', { class: 'muted' }, 'A bigger herd foals faster: a new ranch is 4x slower than a mature one. Horses go to a Barracks that needs them, otherwise to a warehouse.')));
          break;
        }
        parts.push(sec('Farm', kv('Crop', GOODS[def.produces].name), kv('Fertility', pct(b.fertility)),
          kv('Growth', farmDormant(g, b) ? `${pct(b.progress / 100)} (resting for the winter)` : pct(b.progress / 100)), bar(b.progress, 100),
          kv('Stored', `${fmt(b.stock[def.produces])} units`)));
        break;
      case 'raw':
        parts.push(sec('Production', kv('Produces', GOODS[def.produces].name), kv('Progress', pct(b.progress / 100)), bar(b.progress, 100), kv('Stored', `${fmt(b.stock[def.produces])} units`)));
        break;
      case 'workshop':
        parts.push(sec('Workshop',
          Object.entries(def.recipe).map(([good, n]) => kv(`${GOODS[good].name} (needs ${n}/batch)`, `${fmt(b.stock[good])} units`)),
          kv(GOODS[def.produces].name, `${fmt(b.stock[def.produces])} units`), kv('Progress', pct(b.progress / 100)), bar(b.progress, 100)));
        break;
      case 'granary':
      case 'warehouse':
        parts.push(this.storageSection(g, b));
        break;
      case 'market':
        parts.push(sec('Market stock',
          h('table', { class: 'tbl' }, [...FOOD_TYPES, ...HOUSE_GOODS].filter((k) => b.stock[k] > 0).map((k) => h('tr', {}, h('td', {}, `${GOODS[k].icon} ${GOODS[k].name}`), h('td', { class: 'r num' }, fmt(b.stock[k]))))),
          [...FOOD_TYPES, ...HOUSE_GOODS].every((k) => b.stock[k] <= 0) ? h('div', { class: 'muted' }, 'Empty') : null));
        break;
      case 'venue': {
        if (def.venue === 'hippodrome') {
          const on = venueActive(b) && b.efficiency > 0;
          parts.push(sec('Races',
            kv('Races', on ? `Running: ${b.shows.hippodrome} days booked` : b.shows.hippodrome > 0 ? 'Booked, but nobody works here' : 'None booked'),
            kv('Entertainment value', `${VENUE_POINTS.hippodrome} to the homes its charioteers pass`),
            kv('Seats', on ? `The whole city: +${ENT_BASE_MAX - ENT_SEATS_MAX} at most to every home` : 'None while no races run'),
            kv('Prosperity', on ? `+${CONFIG.HIPPODROME_PROSPERITY} while races run` : 'Nothing while no races run'),
            h('div', { class: 'muted' }, 'A Chariot Maker connected by road books 32 days of races with each team it sends. One hippodrome per city.')));
          break;
        }
        const acc = VENUE_SUPPLIERS[def.venue];
        const both = venueHasBoth(b, def.venue);
        const value = VENUE_POINTS[def.venue] + (both ? VENUE_BOTH_BONUS[def.venue] || 0 : 0);
        parts.push(sec('Shows', kv('Entertainment value', `${value}${VENUE_BOTH_BONUS[def.venue] ? (both ? ' (both kinds of show)' : ` (${VENUE_POINTS[def.venue] + VENUE_BOTH_BONUS[def.venue]} with both kinds of show)`) : ''}`), acc.map((v) => kv(`${PERFORMER_NAMES[v]} shows`, `${b.shows[v]} days left`))));
        break;
      }
      case 'training': {
        const venues = Object.entries(VENUE_SUPPLIERS).filter(([, list]) => list.includes(def.venue)).map(([v]) => v);
        parts.push(sec('Training', kv('Trains', `${PERFORMER_NAMES[def.venue]}s`), kv('Performs at', venues.join(', ')), kv('Next performer', `${Math.max(0, Math.ceil(b.spawnTimer))} days`)));
        break;
      }
      case 'barracks':
        parts.push(sec('Equipment in store',
          def.inputs.map((good) => kv(`${GOODS[good].icon} ${GOODS[good].name}`, `${formatAmount(good, b.stock[good])}${b.incoming[good] ? ` (+${formatAmount(good, b.incoming[good])} on the way)` : ''}`)),
          h('div', { class: 'muted' }, 'One recruit needs: legionary 50 weapons, archer 50 arrows, cavalryman 1 horse.')));
        parts.push(sec('Training',
          kv('Next recruit', pct((b.trainProgress || 0) / 100)), bar(b.trainProgress || 0, 100),
          kv('Recruits trained', fmt(g.military.stats.trained))));
        break;
      case 'fort': {
        const unit = UNIT_TYPES[def.unit];
        const n = garrisonCounts(g).get(b.id) || 0;
        parts.push(sec('Garrison',
          kv(`${unit.name}s`, `${n} / ${FORT_CAPACITY}`), bar(n, FORT_CAPACITY),
          b.recruiting ? kv('Recruits on the way', `${b.recruiting}`) : null,
          kv('Training', trainedText(g, b)),
          h('div', { class: 'muted', style: { fontSize: '12px' } }, trainingNote(g, b)),
          kv('Orders', b.rally ? `Holding ${Math.floor(b.rally.x)}, ${Math.floor(b.rally.y)}` : 'Guarding the fort'),
          awayOf(g, b.id).length ? kv('Away', `${awayOf(g, b.id).length} at a distant battle (their places are kept)`) : null,
          kv('Pay', `${fmt(unit.upkeep * (n + awayOf(g, b.id).length))} Dn / month`),
          h('div', { class: 'muted' }, unit.desc),
          h('div', { class: 'row', style: { marginTop: '6px' } },
            h('button', { class: 'btn small primary', disabled: n === 0, title: 'Then click the map where they should stand', onclick: () => this.app.startDeploy(b.id) }, '⚑ Deploy…'),
            h('button', { class: 'btn small', disabled: !b.rally, onclick: () => { recallFort(g, b.id); this.render(); } }, '↩ Recall'),
            serviceButton(g, b, () => this.render()))));
        break;
      }
      case 'dock': {
        const goods = Object.entries(b.stock).filter(([, v]) => v > 0);
        const open = Object.entries(g.city.trade.routes).filter(([id, r]) => r.open && TRADE_PARTNERS[id]?.route === 'sea').map(([id]) => TRADE_PARTNERS[id].name);
        parts.push(sec('Harbor',
          kv('Ship', dockShipText(g, b)),
          ...dockRows(g, b).map(([k, v]) => kv(k, v)),
          kv('Sea routes open', open.join(', ') || 'None (open them in the Trade advisor)'),
          kv('On the quay', `${fmt(dockUsed(b))} / ${fmt(CONFIG.DOCK_CAPACITY)}`), bar(dockUsed(b), CONFIG.DOCK_CAPACITY),
          goods.length ? h('div', {}, goods.map(([k, v]) => h('span', { class: 'chip' }, `${GOODS[k].icon} ${GOODS[k].name} ${fmt(v)}`))) : null,
          h('div', { class: 'muted' }, `A ship waits here while it trades. The crane lands its imports on the quay (you pay as they land) and dock workers cart them to storage; they fetch exports from staffed warehouses within ${CONFIG.DOCK_REACH} road tiles (you are paid as each load goes aboard). The ship sails when both are done, or after ${CONFIG.SHIP_MAX_STAY_DAYS} days: keep storage near the Dock.`)));
        break;
      }
      case 'wharf': {
        const boat = wharfBoat(g, b);
        const ground = boat && boat.ground ? `${boat.ground.x}, ${boat.ground.y}` : null;
        const grounds = g.map.groundsOf(bodyOf(g, b)).length;
        const trouble = b.boatTrouble && g.time.totalDays - b.boatTrouble.day < CONFIG.DAYS_PER_MONTH * 3 ? `A boat ${b.boatTrouble.what}.` : null;
        parts.push(sec('Fishing',
          kv('Boat', boat ? boatStatus(g, b) : 'None: a Shipyard on this water sends one'),
          ground ? kv('Fishing ground', ground) : null,
          kv('Fishing grounds on this water', `${grounds}`),
          kv('Catch in store', `${fmt(b.stock.fish || 0)} fish`),
          kv('Catches landed', `${fmt(b.catches || 0)} (${CONFIG.FISH_CATCH} fish each)`),
          trouble ? h('div', { class: 'status warn' }, trouble) : null,
          h('div', { class: 'muted' }, `The boat fishes ${CONFIG.FISH_DAYS} days at the nearest fishing ground (gulls circle over it) and brings back ${CONFIG.FISH_CATCH} fish; carts take them to a granary. Fewer workers: a longer wait between trips. The sea does not freeze: fishing goes on all winter.`)));
        break;
      }
      case 'shipyard': {
        const spare = spareBoat(g, b);
        const wanting = wharvesWithoutBoat(g, b);
        parts.push(sec('Boatbuilding',
          kv('Spare boat', spare ? 'Waiting on the water for a wharf' : 'None'),
          spare ? null : kv('Next boat', pct(Math.min(100, b.progress) / 100)),
          spare ? null : bar(Math.min(100, b.progress), 100),
          kv('Wharves on this water without a boat', `${wanting}`),
          kv('Boats built', `${fmt(b.boatsBuilt || 0)}`),
          h('div', { class: 'muted' }, `A boat takes ${CONFIG.SHIPYARD_BOAT_DAYS} days at full staff and needs no materials. It goes to the nearest staffed wharf on this water that has none; the yard keeps one spare ready and builds no more until a wharf takes it.`)));
        break;
      }
      case 'navalia': {
        const cost = CONFIG.LIBURNIAN_COST;
        parts.push(sec('Materials in store',
          def.inputs.map((good) => kv(`${GOODS[good].icon} ${GOODS[good].name}`, `${fmt(b.stock[good] || 0)} / ${fmt(cost[good])}${b.incoming[good] ? ` (+${fmt(b.incoming[good])} on the way)` : ''}`)),
          h('div', { class: 'muted' }, `One liburnian needs ${Object.entries(cost).map(([g, n]) => `${n} ${GOODS[g].name.toLowerCase()}`).join(', ')}. Carts bring them while a staffed Naval Station on this water has an empty berth.`)));
        parts.push(sec('Shipbuilding',
          kv('Next liburnian', pct((b.progress || 0) / 100)), bar(b.progress || 0, 100),
          kv('Takes', `${CONFIG.NAVALIA_BUILD_DAYS} days at full staff`),
          kv('Launched here', fmt(b.built || 0))));
        break;
      }
      case 'station': {
        const unit = UNIT_TYPES.liburnian;
        const n = squadronCounts(g).get(b.id) || 0;
        parts.push(sec('Squadron',
          kv('Liburnians', `${n} / ${STATION_CAPACITY}`), bar(n, STATION_CAPACITY),
          kv('Crews', trainedText(g, b)),
          h('div', { class: 'muted', style: { fontSize: '12px' } }, trainingNote(g, b)),
          kv('Orders', b.rally ? `Holding the water at ${Math.floor(b.rally.x)}, ${Math.floor(b.rally.y)}` : 'Guarding its berths'),
          kv('Guards', `raider ships within ${b.rally ? CONFIG.STATION_GUARD_DEPLOYED : CONFIG.STATION_GUARD} tiles (chases ${CONFIG.STATION_CHASE} more)`),
          awayOf(g, b.id).length ? kv('Away', `${awayOf(g, b.id).length} at a distant battle (their berths are kept)`) : null,
          kv('Pay', `${fmt(unit.upkeep * (n + awayOf(g, b.id).length))} Dn / month`),
          h('div', { class: 'muted' }, unit.desc),
          h('div', { class: 'row', style: { marginTop: '6px' } },
            h('button', { class: 'btn small primary', disabled: n === 0, title: 'Then click the water where they should go', onclick: () => this.app.startDeploy(b.id) }, '⚑ Deploy…'),
            h('button', { class: 'btn small', disabled: !b.rally, onclick: () => { recallStation(g, b.id); this.render(); } }, '↩ Recall'),
            serviceButton(g, b, () => this.render())),
          serviceNote(g, b) ? h('div', { class: 'muted', style: { fontSize: '12px' } }, serviceNote(g, b)) : null));
        break;
      }
      case 'military_academy':
        parts.push(sec('Drill yard',
          kv('Soldiers trained here', fmt(b.trainedHere || 0)),
          h('div', { class: 'muted' }, `Only a fully staffed academy (${def.workers} workers) trains anyone. Each new recruit from the Barracks marches first to the academy nearest his fort, then on to it; soldiers resting in a fort come over one at a time (never while deployed or while raiders are about). Trained legionaries holding their ground take a quarter of a missile's damage and +${UNIT_TYPES.legionary.holdDefense} defense; trained archers and cavalry +${UNIT_TYPES.archer.trainedDefense} defense. Attack and health stay the same.`)));
        break;
      case 'portus':
        parts.push(sec('Training harbor',
          kv('Crews trained here', fmt(b.trainedHere || 0)),
          h('div', { class: 'muted' }, `Only a fully staffed Portus (${def.workers} workers) trains a crew. A new liburnian rows past the Portus nearest its station on the same water first, then to its berth; ships at their berths come over one at a time. A trained crew rows faster (${(UNIT_TYPES.liburnian.trainedSpeed * CONFIG.TICKS_PER_DAY).toFixed(1)} tiles a day to ${(UNIT_TYPES.liburnian.speed * CONFIG.TICKS_PER_DAY).toFixed(1)}), rams harder (${UNIT_TYPES.liburnian.trainedRam} to ${UNIT_TYPES.liburnian.ram}) and is harder to hit (+${UNIT_TYPES.liburnian.trainedDefense} defense). Rome's first war fleet, in 260 BC, learned to row on benches on dry land while its ships were built.`)));
        break;
      case 'tower':
        parts.push(sec('Watchtower',
          kv('Range', `${TOWER_RANGE} tiles`),
          kv('Shoots', b.efficiency > 0 ? `every ${(TOWER_COOLDOWN / b.efficiency / CONFIG.TICKS_PER_SECOND).toFixed(1)} s at normal speed` : 'not at all (no staff)'),
          h('div', { class: 'muted' }, 'Archers on the tower shoot raiders in range. Raiders will try to tear it down: back it with walls and soldiers.')));
        break;
      case 'reservoir':
        parts.push(sec('Water', kv('Status', b.hasWater ? (b.source ? 'Full (fed by natural water)' : 'Full (fed by aqueduct)') : 'Dry'), kv('Piped area', `${CONFIG.RESERVOIR_RADIUS} tiles`)));
        break;
      case 'fountain':
        parts.push(sec('Water', kv('Status', b.hasWater ? 'Flowing' : 'Dry'), kv('Supplies homes within', `${CONFIG.FOUNTAIN_RADIUS} tiles`)));
        break;
      case 'well':
        parts.push(sec('Water', kv('Supplies homes within', `${CONFIG.WELL_RADIUS} tiles`)));
        break;
      case 'hospital':
        parts.push(sec('Care', kv('Serves homes within', `${CONFIG.HOSPITAL_RADIUS} tiles`)));
        break;
      case 'decor': {
        const [v, , , r] = def.des;
        parts.push(sec('Beauty', kv('Desirability', `+${v} fading over ${r} tiles`)));
        break;
      }
      case 'arch': {
        const [v, , , r] = def.des;
        parts.push(sec('Triumph',
          kv('Desirability', `+${v} fading over ${r} tiles`),
          kv('Arches earned', `${g.city.archesEarned || 0} (one for each distant battle won)`),
          h('div', { class: 'muted' }, 'Granted by Caesar for a victory far away. The road runs on under it. If it is lost, it may be built again.')));
        break;
      }
      case 'residence': {
        const [v, , , r] = def.des;
        parts.push(sec('The governor\'s home',
          kv('Desirability', `+${v} fading over ${r} tiles`),
          kv('Governor', rankLine(g)),
          kv('Personal savings', `${fmt(g.city.governor.savings)} Dn`),
          h('div', { class: 'muted' }, 'Only one residence may stand at a time. Rioters within 40 tiles go for it before anything else. Your salary and gifts are in the Imperial advisor.')));
        break;
      }
      default:
        break;
    }
    if (def.god) {
      const s = g.city.gods[def.god];
      parts.push(sec(`${GODS[def.god].name}`, h('div', { class: 'muted' }, GODS[def.god].domain), kv('Mood', `${Math.round(s.mood)} / 100`), bar(s.mood, 100)));
    }
    if (def.walker) {
      const out = b.walkers.map((id) => g.walkers.get(id)).filter((w) => w && w.type === def.walker).length;
      parts.push(sec('Walker', kv(WALKER_TYPES[def.walker].name, out ? 'Out on patrol' : 'At the building'), h('div', { class: 'muted' }, WALKER_TYPES[def.walker].desc)));
    }
    // Always, so a warehouse or well says it is safe rather than saying nothing.
    parts.push(this.risks(b));
    if (b.hp !== undefined && b.hp < buildingMaxHp(b)) {
      parts.push(sec('Raid damage', kv('Condition', `${Math.max(0, Math.round(b.hp))} / ${buildingMaxHp(b)}`), bar(b.hp, buildingMaxHp(b), 'risk'), h('div', { class: 'muted' }, 'Repairs itself slowly once the fighting stops.')));
    }
    parts.push(this.demolishButton(g, b));
    mount(this.el, parts);
  }

  /**
   * Stock, and the orders: one button per good that cycles Accept, Refuse,
   * Get (sim/storageOrders.js), the Empty switch, and what they are doing.
   */
  storageSection(g, b) {
    const cap = storageCapacity(b);
    const used = storageUsed(b);
    const granary = b.def.kind === 'granary';
    const cycle = (k) => { cycleOrder(b, k); this.render(); };
    return h('div', { class: 'panel-sec' },
      h('h5', {}, 'Storage'),
      kv('Used', `${fmt(used)} / ${fmt(cap)}`), bar(used, cap),
      orderLines(g, b).map((line) => h('div', { class: `status ${line.level}`, style: { marginTop: '6px' } }, line.text)),
      h('div', { class: 'row', style: { marginTop: '6px', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
        h('button', {
          class: `btn small empty-btn${b.emptying ? ' active' : ''}`,
          title: b.emptying ? 'Take deliveries again' : 'Take nothing in and send everything stored here elsewhere, one cart at a time',
          onclick: () => { setEmptying(b, !b.emptying); this.render(); },
        }, b.emptying ? 'Stop emptying' : `Empty the ${granary ? 'granary' : 'warehouse'}`),
        h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Click an order to change it: Accept, Refuse, Get.')),
      h('table', { class: 'tbl', style: { marginTop: '6px' } },
        h('tr', {}, h('th', {}, 'Good'), h('th', { class: 'r' }, 'Stored'), h('th', { class: 'r' }, 'Orders')),
        orderGoods(b).map((k) => {
          const state = b.orders[k] || 'accept';
          const label = ORDER_LABELS[state];
          return h('tr', {},
            h('td', {}, `${GOODS[k].icon} ${GOODS[k].name}`),
            h('td', { class: 'r num' }, fmt(b.stock[k])),
            h('td', { class: 'r' }, h('button', {
              class: `btn small order-btn ${state}`,
              'data-good': k,
              title: label.title,
              onclick: () => cycle(k),
            }, label.label)));
        })));
  }

  /** A liburnian or a raider ship: its hull, what it is doing, its station or raid. */
  renderUnit(g) {
    const u = g.units.get(this.target.id);
    if (!u) { this.close(); return; }
    const def = UNIT_TYPES[u.type];
    const ours = u.side === 'rome';
    const st = ours ? g.buildings.get(u.station) : null;
    mount(this.el,
      this.head(def.name, ours ? 'Fleet' : 'Enemy'),
      h('div', { class: 'muted' }, def.desc),
      kv('Hull', `${Math.max(0, Math.ceil(u.hp))} / ${u.maxHp}`), bar(Math.max(0, u.hp), u.maxHp),
      kv('Doing', shipStatus(g, u)),
      ours ? kv('Station', st ? `${st.def.name} at ${st.x}, ${st.y}` : 'None') : null,
      ours ? kv('Crew', u.trained ? 'Trained at the Portus: faster, harder rams, harder to hit' : 'Untrained') : null,
      ours ? kv('Arms', `arrows (range ${def.range} tiles) and a bronze ram (${ramOf(u, def)} damage)`) : null,
      ours ? kv('Pay', `${def.upkeep} Dn / month`) : null,
      !ours ? kv('Raiders aboard', fmt((u.crew || []).length)) : null,
      !ours ? kv('Fire pots left', `${fmt(u.pots || 0)} of ${CONFIG.RAID_SHIP_POTS}`) : null,
      h('div', { class: 'panel-sec row' },
        st ? h('button', { class: 'btn small', onclick: () => this.showBuilding(st.id) }, 'Its station') : null,
        h('span', { class: 'muted', style: { fontSize: '12px' } }, `#${u.id} at ${Math.floor(u.x)},${Math.floor(u.y)}`)));
  }

  /** A walker: who, from where, doing what, carrying what, and what it says. */
  renderWalker(g) {
    const w = g.walkers.get(this.target.id);
    if (!w || w.dead) { this.close(); return; }
    const info = walkerInfo(g, w);
    const r = this.app.renderer;
    const following = !!(r.follow && r.follow.id === w.id);
    const origin = w.origin ? g.buildings.get(w.origin) : null;
    mount(this.el,
      this.head(info.title, WALKER_TYPES[w.type].kind === 'roamer' ? 'Roamer' : null),
      h('div', { class: 'muted' }, info.desc),
      ...info.rows.map(([k, v]) => kv(k, v)),
      h('div', { class: 'panel-sec walker-says' }, h('i', {}, `"${info.says}"`)),
      h('div', { class: 'panel-sec row' },
        h('button', {
          class: `btn small${following ? ' active' : ''}`,
          title: 'Keep the view on this walker (move the map to stop)',
          onclick: () => { r.follow = following ? null : { id: w.id }; this.render(); },
        }, following ? 'Following' : 'Follow'),
        origin ? h('button', { class: 'btn small', onclick: () => { r.camera.glideToTile(origin.x, origin.y); this.showBuilding(origin.id); } }, `Show ${origin.house ? 'home' : 'its building'}`) : null));
  }

  /** A roadblock: which walker groups it lets through. */
  renderRoadblock(g, x, y) {
    const map = g.map;
    const i = map.idx(x, y);
    const set = (bits) => { map.roadblock[i] = ROADBLOCK.PRESENT | (bits & ROADBLOCK.GROUPS); this.render(); };
    const bits = map.roadblock[i] & ROADBLOCK.GROUPS;
    mount(this.el,
      this.head('Roadblock', `${x},${y}`),
      h('div', { class: 'muted' }, 'Walkers roaming the streets turn back here. Carts, market buyers, settlers, caravans and anyone else heading somewhere always pass.'),
      h('div', { class: 'panel-sec' },
        h('h5', {}, 'Let through'),
        ROADBLOCK_GROUPS.map((grp) => h('label', { class: 'check-row' },
          h('input', { type: 'checkbox', checked: !!(bits & grp.bit), onchange: (e) => set(e.target.checked ? bits | grp.bit : bits & ~grp.bit) }),
          h('span', {}, grp.name)))),
      h('div', { class: 'panel-sec row' },
        h('button', { class: 'btn small', onclick: () => set(ROADBLOCK.GROUPS) }, 'Everyone'),
        h('button', { class: 'btn small', onclick: () => set(0) }, 'No one'),
        h('button', {
          class: 'btn danger small',
          onclick: () => { map.roadblock[i] = 0; g.onMapEdited(); this.app.sfx.play('demolish'); this.render(); },
        }, 'Remove')));
  }

  renderTile(g) {
    const { x, y } = this.target;
    const map = g.map;
    if (!map.inBounds(x, y)) { this.close(); return; }
    const i = map.idx(x, y);
    if (map.roadblock[i]) { this.renderRoadblock(g, x, y); return; }
    const t = map.terrain[i];
    const bits = map.water[i];
    const water = [bits & WaterBits.FOUNTAIN ? 'fountain' : null, bits & WaterBits.WELL ? 'well' : null, bits & WaterBits.PIPED ? 'reservoir pipes' : null].filter(Boolean);
    const road = map.road[i];
    const notes = [];
    if (t === 1) notes.push('Fertile meadow: farms built here grow well.');
    if (t === 2) notes.push('Forest: timber yards need trees nearby. Building here clears the trees (small cost).');
    if (t === 3) notes.push('Rocks cannot be cleared. Mines and quarries must touch them.');
    if (t === 4) notes.push('Water: reservoirs next to it fill up; clay pits need it nearby.');
    if (map.fixedRoad[i]) notes.push('The Imperial road connects the city to the rest of the Empire.');
    if (x === map.entry.x && y === map.entry.y) notes.push('Map entrance (green pennants): settlers and trade caravans arrive here.');
    if (x === map.exit.x && y === map.exit.y) notes.push('Map exit (red pennants): people leaving the city, and trade caravans heading home, go this way.');
    if (map.rubble[i]) notes.push(`${ruinText(ruinAt(g, i)) || 'Rubble from a disaster.'} Clear it before building.`);
    if (g.fires.has(i)) notes.push('Burning! Prefects are on their way.');
    const wall = map.wall[i];
    if (wall) notes.push(wall === Wall.GATE ? 'A gate: citizens pass freely, raiders must break it down.' : 'A wall: raiders must break through it (or find a way around).');
    mount(this.el,
      this.head(TERRAIN_NAMES[t], `${x},${y}`),
      kv('Desirability', `${map.desirability[i]}`),
      kv('Water access', water.join(', ') || 'None'),
      road ? kv('Road', road === Road.PLAZA ? 'Plaza' : road === Road.BRIDGE ? 'Bridge' : 'Road') : null,
      map.aqueduct[i] ? kv('Aqueduct', map.aqueduct[i] === 2 ? 'Carrying water' : 'Dry') : null,
      wall ? kv(wall === Wall.GATE ? 'Gate' : 'Wall', `${Math.round(wallHpOf(g, i).hp)} / ${wallHpOf(g, i).max} hp`) : null,
      notes.length ? h('div', { class: 'panel-sec' }, notes.map((n) => h('div', {}, n))) : null,
      map.rubble[i] ? this.rebuildButton(g, i) : null);
  }

  /**
   * Rubble that remembers what stood there offers to put it back: the same
   * building on the same spot (a home's plots as empty lots), at the usual
   * price plus clearing the rubble, undone like any building. Greyed out
   * with the reason when it cannot be (still burning, no money, locked...).
   */
  rebuildButton(g, i) {
    const rec = ruinAt(g, i);
    if (!rec || !rec.site) return null;
    const plan = rebuildPlan(g, i);
    const { type, size } = rec.site;
    const name = type === 'house' ? (size > 1 ? 'the housing plots' : 'the housing plot') : type === 'wall' ? 'the wall' : `the ${BUILDINGS[type]?.name || type}`;
    const ok = !!plan && plan.count > 0 && plan.items.every((it) => it.ok);
    const why = !plan ? 'The ground has changed since.' : plan.reason || plan.items.find((it) => !it.ok)?.reason || '';
    return h('div', { class: 'panel-sec' },
      h('button', {
        class: 'btn small primary',
        disabled: !ok,
        title: ok ? '' : why,
        onclick: () => {
          const fresh = rebuildPlan(g, i);
          if (!fresh) return;
          this.app.applyPlan(fresh);
          const id = g.map.buildingAt(rec.site.x, rec.site.y);
          if (id) this.showBuilding(id); else this.render();
        },
      }, `Rebuild ${name}${ok ? ` (${plan.cost} Dn)` : ''}`),
      ok ? null : h('div', { class: 'muted' }, why));
  }
}

export { BUILDINGS };

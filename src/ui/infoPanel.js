/**
 * infoPanel.js
 * ----------------------------------------------------------------------------
 * The "what is this and what does it need" panel shown when you click a
 * building or tile. For houses it spells out exactly which needs block the
 * next tier, which is the most important feedback loop in the game.
 * ----------------------------------------------------------------------------
 */

import { h, mount, fmt, pct, bar, kv } from './dom.js';
import { CONFIG } from '../config.js';
import { BUILDINGS, LABOR_CATEGORIES, VENUE_POINTS, VENUE_SUPPLIERS, PERFORMER_NAMES } from '../data/buildings.js';
import { HOUSE_TIERS, MAX_TIER, houseCapacity } from '../data/housing.js';
import { GOODS, FOOD_TYPES, HOUSE_GOODS } from '../data/goods.js';
import { GODS, GOD_KEYS } from '../data/gods.js';
import { WALKER_TYPES } from '../data/walkers.js';
import { TERRAIN_NAMES, WaterBits, Road } from '../world/map.js';
import { storageCapacity, storageUsed } from '../sim/storage.js';
import { venueActive } from '../sim/services.js';
import { houseMonthlyTax } from '../sim/economy.js';
import { removeBuilding } from '../sim/entities.js';

/** Plain-English description of one missing house requirement. */
export function describeNeed(m) {
  switch (m.key) {
    case 'water': return m.need >= 2 ? 'Clean water from a fountain within 4 tiles (fountains need a reservoir).' : 'Access to water: a well within 2 tiles.';
    case 'food': return `${m.need} type${m.need > 1 ? 's' : ''} of food (has ${m.have}). A market vendor must pass by, and the market needs a stocked granary.`;
    case 'religion': return `Priests of ${m.need} different god${m.need > 1 ? 's' : ''} visiting (has ${m.have}). Build temples nearby.`;
    case 'ent': return `Entertainment ${m.need} (has ${m.have}). Theater 15, amphitheater 25, colosseum 35.`;
    case 'edu': return ['', 'A school nearby.', 'Both a school and a library nearby.', 'School, library and academy access.'][m.need] + ` (has ${m.have})`;
    case 'health': return `${m.need} health service${m.need > 1 ? 's' : ''} (has ${m.have}): barber, medicus, thermae, hospital.`;
    case 'goods': return `${GOODS[m.good].name} sold by a market vendor (needs a warehouse stocked with ${GOODS[m.good].name.toLowerCase()}).`;
    case 'des': return `Desirability ${m.need} (now ${m.have}). Gardens, statues, plazas and temples help; industry and storage hurt.`;
    case 'space': return `Room to grow into a ${m.need}×${m.need} home: neighboring small houses or empty land.`;
    default: return m.key;
  }
}

/** Status line for any non-house building. */
export function buildingStatus(game, b) {
  const def = b.def;
  if (def.needsRoad && b.accessRoad < 0) return { level: 'bad', text: 'No road access. Build a road touching this building.' };
  if (def.workers && b.laborAccess <= 0) return { level: 'bad', text: `Cannot find workers: no occupied housing within ${CONFIG.LABOR_RANGE} tiles along the roads.` };
  if (def.workers && b.efficiency <= 0) return { level: 'bad', text: 'No workers available. The city needs more people, or change labor priorities.' };
  if (def.needsPiped && !b.hasWater) return { level: 'bad', text: 'No piped water. It must sit inside a full reservoir\'s area.' };
  switch (def.kind) {
    case 'reservoir':
      if (!b.hasWater) return { level: 'bad', text: 'Dry. Build next to a river/lake, or connect by aqueduct to a full reservoir.' };
      break;
    case 'farm':
      if (b.fertility <= 0) return { level: 'bad', text: 'No meadow under this field: nothing grows.' };
      if (b.noStorage) return { level: 'warn', text: 'Harvest is piling up: no granary or warehouse with room is reachable.' };
      break;
    case 'raw':
      if (b.resourceOk === false) return { level: 'bad', text: 'The natural resource nearby is gone.' };
      if (b.noStorage) return { level: 'warn', text: 'No workshop or warehouse with room is reachable.' };
      break;
    case 'workshop':
      if (b.stock[def.consumes] < CONFIG.CART_CAPACITY) return { level: 'warn', text: `Waiting for ${GOODS[def.consumes].name.toLowerCase()} from a producer or warehouse.` };
      if (b.noStorage) return { level: 'warn', text: 'No warehouse with room is reachable for the finished goods.' };
      break;
    case 'venue':
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

export class InfoPanel {
  constructor(app, root) {
    this.app = app;
    this.el = h('div', { id: 'info-panel', class: 'hidden' });
    root.appendChild(this.el);
    this.target = null; // { kind: 'building', id } | { kind: 'tile', x, y }
    this.timer = 0;
  }

  get open() { return !this.el.classList.contains('hidden'); }

  showBuilding(id) {
    this.target = { kind: 'building', id };
    this.app.renderer.selectedId = id;
    this.el.classList.remove('hidden');
    this.render();
  }

  showTile(x, y) {
    this.target = { kind: 'tile', x, y };
    this.app.renderer.selectedId = 0;
    this.el.classList.remove('hidden');
    this.render();
  }

  close() {
    this.target = null;
    this.app.renderer.selectedId = 0;
    this.el.classList.add('hidden');
  }

  update(dt) {
    if (!this.open) return;
    this.timer += dt;
    if (this.timer < 0.7) return;
    this.timer = 0;
    // Do not rebuild while the user is interacting with a control inside.
    if (this.el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    this.render();
  }

  render() {
    const g = this.app.game;
    if (!g || !this.target) { this.close(); return; }
    if (this.target.kind === 'tile') { this.renderTile(g); return; }
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

  risks(b) {
    return h('div', { class: 'panel-sec' },
      h('h5', {}, 'Risks'),
      kv('Fire risk', `${Math.round(b.fireRisk)}%`), bar(b.fireRisk, 100, 'risk'),
      kv('Collapse risk', `${Math.round(b.damageRisk)}%`), bar(b.damageRisk, 100, 'risk'));
  }

  demolishButton(g, b) {
    return h('div', { class: 'panel-sec row' },
      h('button', {
        class: 'btn danger small',
        onclick: () => {
          const people = b.house ? b.house.pop : 0;
          const msg = people > 0 ? `Demolish this home? ${people} residents will become homeless.` : `Demolish this ${b.house ? 'home' : b.def.name}?`;
          if (!window.confirm(msg)) return;
          removeBuilding(g, b, 'demolish');
          g.onMapEdited();
          this.app.sfx.play('demolish');
          this.close();
        },
      }, '⛏ Demolish'),
      h('span', { class: 'muted', style: { fontSize: '12px' } }, `#${b.id} at ${b.x},${b.y}`));
  }

  renderHouse(g, b) {
    const hs = b.house;
    const tier = HOUSE_TIERS[hs.tier];
    const cap = houseCapacity(hs.tier, b.size);
    const parts = [this.head(tier.name, `${b.size}×${b.size}`)];
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
      if (hs.devolving && hs.blocked) {
        status = h('div', { class: 'status bad' }, h('b', {}, `Will decline to ${HOUSE_TIERS[hs.tier - 1].name} unless it gets:`), h('ul', { class: 'needs' }, hs.blocked.map((m) => h('li', {}, describeNeed(m)))));
      } else if (hs.tier >= MAX_TIER) {
        status = h('div', { class: 'status good' }, 'The finest home in the province.');
      } else if (hs.blocked && hs.blocked.length) {
        status = h('div', { class: 'status warn' }, h('b', {}, `To become a ${HOUSE_TIERS[hs.tier + 1].name} it needs:`), h('ul', { class: 'needs' }, hs.blocked.map((m) => h('li', {}, describeNeed(m)))));
      } else {
        status = h('div', { class: 'status good' }, `All needs met: it will soon become a ${HOUSE_TIERS[hs.tier + 1].name}.`);
      }
      parts.push(status);
      const lv = hs.levels || {};
      const gods = GOD_KEYS.filter((k) => hs.religion[k] > 0).map((k) => GODS[k].name);
      const ent = Object.keys(VENUE_POINTS).filter((v) => hs.ent[v] > 0);
      const health = [['barber', 'Barber'], ['clinic', 'Medicus'], ['baths', 'Thermae']].filter(([k]) => hs[k] > 0).map(([, n]) => n);
      if (lv.health > health.length) health.push('Hospital');
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
        kv('Desirability', `${hs.des}`),
        kv('Taxes', hs.tax > 0 ? `Registered: ~${fmt(houseMonthlyTax(g, hs))} Dn/month` : 'Not registered (needs a Forum nearby)'),
      ));
    }
    parts.push(this.risks(b));
    parts.push(this.demolishButton(g, b));
    mount(this.el, parts);
  }

  renderBuilding(g, b) {
    const def = b.def;
    const st = buildingStatus(g, b);
    const parts = [this.head(def.name, `${b.size}×${b.size}`), h('div', { class: `status ${st.level}` }, st.text)];
    if (def.workers) {
      parts.push(h('div', { class: 'panel-sec' },
        h('h5', {}, 'Employment'),
        kv('Workers', `${b.workers} / ${def.workers}`), bar(b.workers, def.workers),
        kv('Labor category', LABOR_CATEGORIES[def.labor] || 'Industry')));
    }
    const sec = (title, ...kids) => h('div', { class: 'panel-sec' }, h('h5', {}, title), kids);
    switch (def.kind) {
      case 'farm':
        parts.push(sec('Farm', kv('Crop', GOODS[def.produces].name), kv('Fertility', pct(b.fertility)), kv('Growth', pct(b.progress / 100)), bar(b.progress, 100), kv('Stored', `${fmt(b.stock[def.produces])} units`)));
        break;
      case 'raw':
        parts.push(sec('Production', kv('Produces', GOODS[def.produces].name), kv('Progress', pct(b.progress / 100)), bar(b.progress, 100), kv('Stored', `${fmt(b.stock[def.produces])} units`)));
        break;
      case 'workshop':
        parts.push(sec('Workshop', kv(`${GOODS[def.consumes].name} (raw)`, `${fmt(b.stock[def.consumes])} units`), kv(GOODS[def.produces].name, `${fmt(b.stock[def.produces])} units`), kv('Progress', pct(b.progress / 100)), bar(b.progress, 100)));
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
        const acc = VENUE_SUPPLIERS[def.venue];
        parts.push(sec('Shows', kv('Entertainment value', `${VENUE_POINTS[def.venue]}`), acc.map((v) => kv(`${PERFORMER_NAMES[v]} shows`, `${b.shows[v]} days left`))));
        break;
      }
      case 'training': {
        const venues = Object.entries(VENUE_SUPPLIERS).filter(([, list]) => list.includes(def.venue)).map(([v]) => v);
        parts.push(sec('Training', kv('Trains', `${PERFORMER_NAMES[def.venue]}s`), kv('Performs at', venues.join(', ')), kv('Next performer', `${Math.max(0, Math.ceil(b.spawnTimer))} days`)));
        break;
      }
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
    if (def.fire || def.damage) parts.push(this.risks(b));
    parts.push(this.demolishButton(g, b));
    mount(this.el, parts);
  }

  storageSection(g, b) {
    const cap = storageCapacity(b);
    const used = storageUsed(b);
    const keys = b.def.kind === 'granary' ? FOOD_TYPES : Object.keys(b.stock);
    return h('div', { class: 'panel-sec' },
      h('h5', {}, 'Storage'),
      kv('Used', `${fmt(used)} / ${fmt(cap)}`), bar(used, cap),
      h('table', { class: 'tbl', style: { marginTop: '6px' } },
        h('tr', {}, h('th', {}, 'Good'), h('th', { class: 'r' }, 'Stored'), h('th', { class: 'r' }, 'Accept')),
        keys.map((k) => h('tr', {},
          h('td', {}, `${GOODS[k].icon} ${GOODS[k].name}`),
          h('td', { class: 'r num' }, fmt(b.stock[k])),
          h('td', { class: 'r' }, h('input', {
            type: 'checkbox',
            checked: !!b.accept[k],
            title: 'Accept deliveries of this good',
            onchange: (e) => { b.accept[k] = e.target.checked; },
          }))))));
  }

  renderTile(g) {
    const { x, y } = this.target;
    const map = g.map;
    if (!map.inBounds(x, y)) { this.close(); return; }
    const i = map.idx(x, y);
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
    if (map.rubble[i]) notes.push('Rubble from a disaster. Clear it before building.');
    if (g.fires.has(i)) notes.push('Burning! Prefects are on their way.');
    mount(this.el,
      this.head(TERRAIN_NAMES[t], `${x},${y}`),
      kv('Desirability', `${map.desirability[i]}`),
      kv('Water access', water.join(', ') || 'None'),
      road ? kv('Road', road === Road.PLAZA ? 'Plaza' : road === Road.BRIDGE ? 'Bridge' : 'Road') : null,
      map.aqueduct[i] ? kv('Aqueduct', map.aqueduct[i] === 2 ? 'Carrying water' : 'Dry') : null,
      notes.length ? h('div', { class: 'panel-sec' }, notes.map((n) => h('div', {}, n))) : null);
  }
}

export { BUILDINGS };

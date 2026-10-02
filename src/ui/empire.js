/**
 * empire.js
 * ----------------------------------------------------------------------------
 * The Empire screen (E, the compass in the top bar, or the Trade advisor):
 * the empire map at full size with everyone on the way to the city.
 *
 *   map     your province, Rome, every partner and its route (ui/empireMap.js),
 *           caravans and ships moving along their routes, a warband closing
 *           in (at the frontier while only rumoured, from the side it will
 *           enter by once scouted)
 *   hover   (tap on phones) a readout: "Massilia ship: 6 days"; a message
 *           about a warband or the legions opens the map with it picked out
 *           as if hovered (focus)
 *   click   a city or a traveler: that partner's card, with the button to
 *           open its route; a scouted warband: close the map and look at the
 *           map edge it will enter by; raiders in the province: look at them
 *   side    a legend, the list of travelers with their days, the threats
 *
 * The game keeps running behind it (like the Advisors), so travelers move;
 * the screen only reads game state, apart from opening a route.
 * ----------------------------------------------------------------------------
 */

import { h, mount } from './dom.js';
import { tradeRouteCard } from './advisors.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';
import { routeKind } from '../sim/trade.js';
import { SITES, homeSiteId } from '../data/sites.js';
import { battleSummary } from '../sim/battle.js';
import {
  MAP_W, MAP_H, drawEmpire, empireTravelers, empireHitAt, travelerLabel, isDrawn, figureCenter, figureScale,
  drawCaravan, drawShip, drawBanner, drawCity, drawRome, drawRoute, drawStandard, drawBattleCity, drawRider,
  SCOUT_MONTHS, RUMOUR_MONTHS,
} from './empireMap.js';

/** How far (CSS px) from a city or traveler a pointer still counts as on it. */
const HIT_PX = 16;
/** Seconds between checks whether the side panel needs rebuilding. */
const PANEL_EVERY = 0.4;
/** Map height as a share of its width. */
const ASPECT = MAP_H / MAP_W;

export class EmpireView {
  /** @param {import('../app.js').App} app */
  constructor(app) {
    this.app = app;
    this.selected = null; // partner id whose card is shown
    this.hover = null; // empireHitAt() result under the pointer (or last tapped)
    this.travelers = [];
    this.sigs = {};
    this.timer = 0;
    this.css = { w: 0, h: 0, dpr: 0 };
    // A press inside the side panel holds its rebuilds until the release:
    // the days tick by every second or two (faster at high speed), and a
    // button rebuilt between press and release would never get its click.
    this.pressing = false;
    if (typeof window !== 'undefined') {
      const release = () => { this.pressing = false; };
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
    }
  }

  /** Build the modal element (UI puts it in the modal root). */
  element() {
    const app = this.app;
    this.canvas = h('canvas', {
      class: 'empire-full',
      role: 'img',
      'aria-label': 'Empire map: your province, Rome, trade partners and their routes, caravans, ships and warbands on the way',
    });
    this.canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') this.setHover(this.hitAt(e)); });
    this.canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.setHover(null); });
    this.canvas.addEventListener('pointerdown', (e) => { this.pointerType = e.pointerType; });
    this.canvas.addEventListener('click', (e) => this.onClick(e));
    this.wrap = h('div', { class: 'empire-map-wrap' }, this.canvas);
    this.readout = h('div', { class: 'empire-readout', 'aria-live': 'polite' });
    this.threatsEl = h('div', { class: 'empire-section' });
    this.tradeEl = h('div', { class: 'empire-section' });
    this.cardEl = h('div', { class: 'empire-section' });
    this.modal = h('div', { class: 'modal empire-modal', role: 'dialog', 'aria-label': 'Empire map' },
      h('div', { class: 'modal-head' },
        h('h2', {}, 'The Empire'),
        h('button', { class: 'panel-close', title: 'Close (Esc)', onclick: () => app.ui.closeModal() }, '×')),
      h('div', { class: 'modal-body empire-body' },
        h('div', { class: 'empire-main' }, this.wrap, this.readout),
        h('div', { class: 'empire-side', onpointerdown: () => { this.pressing = true; } }, this.threatsEl, this.tradeEl, this.cardEl, legend())));
    this.body = this.modal.querySelector('.empire-body');
    this.sigs = {};
    this.hover = null;
    this.timer = PANEL_EVERY; // fill the panel on the first update
    this.css = { w: 0, h: 0, dpr: 0 };
    return this.modal;
  }

  /** Per frame while open: redraw the map, refresh the panel when what it says changed. */
  update(dt) {
    const g = this.app.game;
    if (!g || !this.canvas || !this.canvas.isConnected) return;
    this.travelers = empireTravelers(g);
    if (this.hover && this.hover.kind === 'traveler') this.hover = this.refind(this.hover.t);
    this.draw(g);
    this.timer += dt;
    if (this.timer >= PANEL_EVERY) {
      this.timer = 0;
      this.renderPanel(g);
    }
    this.showReadout();
  }

  /** The same traveler in the fresh list (positions move every frame). */
  refind(t) {
    const same = this.travelers.find((o) => o.kind === t.kind && o.id === t.id && isDrawn(o));
    return same ? { kind: 'traveler', t: same } : null;
  }

  /** Size the canvas to the room it has (keeping the map's shape) and draw. */
  draw(g) {
    const back = this.modal.parentElement;
    const head = this.modal.querySelector('.modal-head');
    const roomW = this.wrap.clientWidth;
    // On a wide screen the map may use the height the window has (the modal
    // is at most 94% of it); on a phone (one column) it takes the width and
    // the panel follows below. Less the head, the body's padding and the
    // readout under the map, so the body does not scroll because of the map.
    const pad = this.body ? parseFloat(getComputedStyle(this.body).paddingTop) + parseFloat(getComputedStyle(this.body).paddingBottom) : 28;
    const modalH = back ? Math.min(back.clientHeight - 32, window.innerHeight * 0.94) : roomW;
    const roomH = modalH - 6 - (head ? head.offsetHeight : 0) - pad - this.readout.offsetHeight - 8;
    const w = Math.max(120, Math.floor(Math.min(roomW, roomH / ASPECT)));
    const hgt = Math.round(w * ASPECT);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w !== this.css.w || dpr !== this.css.dpr) {
      this.css = { w, h: hgt, dpr };
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${hgt}px`;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(hgt * dpr);
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const pxPerUnit = w / MAP_W;
    ctx.setTransform(pxPerUnit * dpr, 0, 0, pxPerUnit * dpr, 0, 0);
    drawEmpire(ctx, g, { travelers: this.travelers, pxPerUnit, selected: this.selected, hover: this.hover, time: performance.now() / 1000 });
  }

  /** What is under a pointer event, in map units. */
  hitAt(e) {
    const g = this.app.game;
    if (!g || !this.css.w) return null;
    const r = this.canvas.getBoundingClientRect();
    const u = MAP_W / r.width; // map units per CSS px
    return empireHitAt(g, this.travelers, (e.clientX - r.left) * u, (e.clientY - r.top) * u, HIT_PX * u, figureScale(r.width / MAP_W));
  }

  /** Where a traveler's figure is on screen (client px), or null: for the smoke test. */
  clientPoint(t) {
    if (!this.canvas || !this.canvas.isConnected) return null;
    const r = this.canvas.getBoundingClientRect();
    const px = r.width / MAP_W;
    const [x, y] = figureCenter(t, figureScale(px));
    return { x: r.left + x * px, y: r.top + y * px };
  }

  setHover(hit) { this.hover = hit; }

  /**
   * A click picks what is under it. On a touch screen the first tap on
   * something only shows what it is (there is no hover there); a second
   * tap on it acts.
   */
  onClick(e) {
    const hit = this.hitAt(e);
    const touch = this.pointerType && this.pointerType !== 'mouse';
    if (touch && !sameHit(hit, this.hover)) {
      this.hover = hit;
      if (hit && (hit.kind === 'city' || (hit.kind === 'traveler' && hit.t.id))) this.select(hit.kind === 'city' ? hit.id : hit.t.id);
      return;
    }
    this.hover = hit;
    this.act(hit);
  }

  act(hit) {
    if (!hit) return;
    if (hit.kind === 'city') this.select(hit.id);
    else if (hit.kind === 'traveler' && hit.t.id) this.select(hit.t.id);
    else if (hit.kind === 'traveler' && hit.t.kind === 'warband' && !hit.t.rumour && !hit.t.noShore) this.goToEdge(hit.t);
    else if (hit.kind === 'traveler' && (hit.t.kind === 'raid' || (hit.t.kind === 'legion' && hit.t.here))) { this.app.ui.closeModal(); this.app.focusThreat(); }
    else if (hit.kind === 'battle' || (hit.kind === 'traveler' && ['legion', 'enemy', 'troops', 'rider'].includes(hit.t.kind))) this.app.ui.openAdvisors('imperial');
  }

  /**
   * Pick out the traveler of this kind ('warband', 'legion' on its way) as if
   * the pointer were on it: ringed, read out under the map. For a message or
   * a button about it (ui.openEmpire). Moving the pointer over the map moves on.
   */
  focus(kind) {
    const t = this.travelers.find((o) => o.kind === kind && !o.here && isDrawn(o));
    if (t) this.hover = { kind: 'traveler', t };
  }

  select(id) {
    this.selected = id;
    this.sigs.card = null; // show the card at once
    this.renderPanel(this.app.game);
  }

  /** Close the map and look at the map edge a scouted warband will enter by (by sea: where it will land). */
  goToEdge(t) {
    const app = this.app;
    const g = app.game;
    if (!g || !t.origin) return;
    app.ui.closeModal();
    const landing = t.sea ? g.military.warned?.landing : null;
    if (landing) {
      app.renderer.camera.glideToTile(landing.x, landing.y);
      app.ui.messages.push({ text: `Scouts expect the warband of ${t.size} to come ashore here, ${t.months > 0 ? `in about ${t.months} month${t.months === 1 ? '' : 's'}` : 'any day now'}.`, level: 'warn', date: '' });
      return;
    }
    // A little inside the map from the edge tile, so the view is not half off the map.
    const x = Math.round(t.origin.x + (g.map.w / 2 - t.origin.x) * 0.15);
    const y = Math.round(t.origin.y + (g.map.h / 2 - t.origin.y) * 0.15);
    app.renderer.camera.glideToTile(x, y);
    app.ui.messages.push({ text: `Scouts expect the warband of ${t.size} to enter here, ${t.months > 0 ? `in about ${t.months} month${t.months === 1 ? '' : 's'}` : 'any day now'}.`, level: 'warn', date: '' });
  }

  /** The line under the map: what the pointer is on, or a hint. */
  showReadout() {
    const g = this.app.game;
    const hit = this.hover;
    let text = 'Point at (or tap) a city or a traveler. Click a city to trade with it, a warband to see where it will strike.';
    if (hit && hit.kind === 'traveler') {
      text = travelerLabel(hit.t);
      const verb = this.pointerType && this.pointerType !== 'mouse' ? 'Tap again' : 'Click';
      if (hit.t.kind === 'warband' && hit.t.rumour) text += `. Scouts will learn its strength and its road about ${SCOUT_MONTHS} months before it strikes.`;
      else if (hit.t.kind === 'warband' && hit.t.noShore) text += '. Expect them overland, from a side the scouts cannot yet tell.';
      else if (hit.t.kind === 'warband') text += `. ${verb} to see ${hit.t.sea ? 'the shore where it will land' : 'the map edge it will enter by'}.`;
      else if (hit.t.kind === 'raid' || (hit.t.kind === 'legion' && hit.t.here)) text += `. ${verb} to look at them.`;
      else if (hit.t.kind === 'legion' || hit.t.kind === 'enemy' || hit.t.kind === 'troops' || hit.t.kind === 'rider') text += `. ${verb} for the Imperial advisor.`;
    } else if (hit && hit.kind === 'city') {
      text = cityLine(g, hit.id);
    } else if (hit && hit.kind === 'battle') {
      text = battleLine(g);
    } else if (hit && hit.kind === 'home') {
      const site = SITES[homeSiteId(g)];
      text = `${g.city.name || 'Your province'}: your province. ${site.name}, ${site.region}.`;
    } else if (hit && hit.kind === 'rome') {
      text = 'Rome: the Emperor\'s city';
    }
    if (this.readout.textContent !== text) this.readout.textContent = text;
  }

  /** Rebuild each side panel section only when what it shows changed (a rebuild under a press would eat the click). */
  renderPanel(g) {
    if (!g) return;
    const trade = this.travelers.filter((t) => t.kind === 'caravan' || t.kind === 'ship');
    const threats = this.travelers.filter((t) => ['warband', 'raid', 'legion', 'enemy', 'troops', 'rider'].includes(t.kind));
    const anyOpen = Object.values(g.city.trade.routes).some((r) => r.open);
    const imperial = () => this.app.ui.openAdvisors('imperial');
    const figure = (t) => glyph((ctx) => (t.kind === 'legion' ? drawStandard(ctx, 2.5, 4.4, null, 1, '#6d2a6b') : t.kind === 'troops' ? drawStandard(ctx, 2.5, 4.4, null, 1, '#a8322b') : t.kind === 'rider' ? drawRider(ctx, 2.5, 3.8, 1.2) : drawBanner(ctx, 3.1, 3.8, null, 1, t.kind === 'raid', !!t.sea)), 5, 4.4);
    const button = (t) => {
      if (t.kind === 'warband' && t.rumour) return h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Road not yet known');
      if (t.kind === 'warband' && t.noShore) return h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Coming overland');
      if (t.kind === 'warband') return h('button', { class: 'btn small', title: t.sea ? 'Close the map and look at the shore where it will land' : 'Close the map and look at the map edge it will enter by', onclick: () => this.goToEdge(t) }, t.sea ? 'Show the landing' : 'Show the edge');
      if (t.kind === 'raid' || (t.kind === 'legion' && t.here)) return h('button', { class: 'btn small primary', onclick: () => { this.app.ui.closeModal(); this.app.focusThreat(); } }, 'Show them');
      return h('button', { class: 'btn small', title: 'Caesar\'s anger and his calls for troops', onclick: imperial }, 'Imperial advisor');
    };
    this.section('threats', this.threatsEl, JSON.stringify([threats.map((t) => [t.kind, t.size, t.dir, t.months, !!t.sea, t.state, t.home, !!t.rumour, !!t.noShore, t.post]), !!g.military.settings]), () => [
      h('h4', {}, 'Threats'),
      threats.length
        ? threats.map((t) => h('div', { class: 'empire-row' },
          h('span', { class: 'empire-glyph' }, figure(t)),
          h('span', { style: { flex: 1 } }, travelerLabel(t)),
          button(t)))
        : h('div', { class: 'muted' }, g.military.settings ? `No warband is known to be gathering. Word of one comes about ${RUMOUR_MONTHS} months ahead, the scouts' report of its size and road about ${SCOUT_MONTHS} months ahead.` : 'No raids in this province.'),
    ]);
    this.section('trade', this.tradeEl, JSON.stringify([trade.map((t) => [t.id, t.days, t.onWay]), anyOpen, this.selected]), () => {
      const onWay = trade.filter((t) => t.onWay);
      const later = trade.filter((t) => !t.onWay);
      const row = (t) => h('button', { type: 'button', class: `empire-row link${t.id === this.selected ? ' sel' : ''}`, title: `${TRADE_PARTNERS[t.id].name}: show its trade`, onclick: () => this.select(t.id) },
        h('span', { class: 'empire-glyph' }, glyph((ctx) => (t.kind === 'ship' ? drawShip(ctx, 2.5, 3, t.color) : drawCaravan(ctx, 2.5, 2.6, t.color)), 5, 4)),
        h('span', {}, travelerLabel(t)));
      return [
        h('h4', {}, 'On the way'),
        onWay.length ? onWay.map(row) : h('div', { class: 'muted' }, anyOpen ? 'Nobody on the road or at sea right now.' : 'No trade routes are open. Click a city to open one.'),
        later.length ? [h('h4', {}, 'Coming later'), later.map(row)] : null,
      ];
    });
    const sel = this.selected && g.city.trade.routes[this.selected] ? this.selected : null;
    const r = sel ? g.city.trade.routes[sel] : null;
    // The card's note on docks changes as Docks are built and staffed.
    const docks = [...g.buildings.values()].filter((b) => b.def.kind === 'dock');
    const dockState = [docks.length, docks.some((b) => b.efficiency > 0)];
    this.section('card', this.cardEl, JSON.stringify([sel, r && [r.open, r.sold, r.bought], !!g.map.seaEntry, dockState]), () => (sel
      ? [h('h4', {}, 'Trade partner'), tradeRouteCard(this.app, g, sel, () => { this.sigs.card = null; this.renderPanel(this.app.game); })]
      : [h('h4', {}, 'Trade partner'), h('div', { class: 'muted' }, Object.keys(g.city.trade.routes).length ? 'Click a city on the map for what it buys and sells, and to open a route to it.' : 'No trade partners are available in this scenario.')]));
  }

  section(key, el, sig, build) {
    if (this.sigs[key] === sig || (this.pressing && this.sigs[key] !== null)) return;
    this.sigs[key] = sig;
    mount(el, build());
  }
}

function sameHit(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'city') return a.id === b.id;
  if (a.kind === 'traveler') return a.t.kind === b.t.kind && a.t.id === b.t.id;
  return true;
}

/** The threatened city of a distant battle, in a line (sim/battle.js). */
function battleLine(g) {
  const s = battleSummary(g);
  if (!s) return '';
  if (s.phase === 'foreign') return `${s.name}: in the hands of ${s.enemyName} (retaken in ${s.foreignLeft} months)`;
  if (s.phase === 'returning') return `${s.name}: the battle is over; your troops are on their way home`;
  return `${s.name}: threatened by ${s.words} of ${s.enemyName}, the battle in ${s.monthsLeft} month${s.monthsLeft === 1 ? '' : 's'}. Click for the Imperial advisor.`;
}

/** "Tarraco: land route, open" and the like. */
function cityLine(g, id) {
  const p = TRADE_PARTNERS[id];
  const r = g.city.trade.routes[id];
  const sea = routeKind(id) === 'sea';
  const state = r.open ? 'open' : sea && !g.map.seaEntry ? 'no ships can reach this province' : `closed, opens for ${p.openCost} Dn`;
  return `${p.name}: ${sea ? 'sea' : 'land'} route, ${state}. Click for its trade.`;
}

/** A small canvas with one of the map's figures, for the legend and the lists. */
function glyph(paint, wUnits = 5, hUnits = 4, px = 5) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = h('canvas', { width: Math.round(wUnits * px * dpr), height: Math.round(hUnits * px * dpr), 'aria-hidden': 'true' });
  c.style.width = `${wUnits * px}px`;
  c.style.height = `${hUnits * px}px`;
  const ctx = c.getContext('2d');
  if (ctx) {
    // On the map's parchment, as on the map: the figures' colors are chosen for it (and stay legible in the dark theme).
    ctx.fillStyle = '#e3d3ac';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.scale(px * dpr, px * dpr);
    paint(ctx);
  }
  return c;
}

/** The legend, drawn with the map's own figures. */
function legend() {
  const row = (paint, text, w) => h('div', { class: 'empire-row' }, h('span', { class: 'empire-glyph' }, glyph(paint, w || 5, 4)), h('span', {}, text));
  return h('div', { class: 'empire-section empire-legend' },
    h('h4', {}, 'Legend'),
    row((ctx) => drawCity(ctx, [2.5, 2], null, '#a8322b', true, true), 'Your province'),
    row((ctx) => drawRome(ctx, [2.5, 2], 1, false), 'Rome'),
    row((ctx) => drawCity(ctx, [2.5, 2], null, TRADE_PARTNERS.capua.color, true, false), 'Trade partner (grey while its route is closed)'),
    row((ctx) => drawRoute(ctx, [[0.5, 2], [6.5, 2]], false, true, false), 'Land route: caravans', 7),
    row((ctx) => drawRoute(ctx, [[0.5, 2], [6.5, 2]], true, true, false), 'Sea route: merchant ships', 7),
    row((ctx) => drawRoute(ctx, [[0.5, 2], [6.5, 2]], false, false, false), 'Faint and broken: not open yet', 7),
    row((ctx) => drawCaravan(ctx, 2.5, 2.6, TRADE_PARTNERS.tarraco.color), 'Caravan, in its city\'s color'),
    row((ctx) => drawShip(ctx, 2.5, 3, TRADE_PARTNERS.massilia.color), 'Ship, in its city\'s color'),
    row((ctx) => drawBanner(ctx, 3.1, 3.8, null), 'Warband and its size'),
    row((ctx) => drawStandard(ctx, 2.5, 4.4, null, 1, '#6d2a6b'), 'Caesar\'s legions, when he is angry'),
    row((ctx) => drawBattleCity(ctx, [2.5, 2.3], false), 'A city Caesar asks troops for'),
    row((ctx) => drawStandard(ctx, 2.5, 4.4, null, 1, '#a8322b'), 'Your troops sent to it'),
    row((ctx) => drawRider(ctx, 2.5, 3.8, 1.2), 'A rider carrying your recall to them'));
}

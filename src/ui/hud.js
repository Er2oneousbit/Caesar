/**
 * hud.js
 * ----------------------------------------------------------------------------
 * The top bar: menu button, city name, treasury, population, date, mood,
 * speed controls, overlay picker, advisors and help buttons.
 * Refreshed a few times per second by UI.update().
 * ----------------------------------------------------------------------------
 */

import { h, fmt } from './dom.js';
import { OVERLAYS } from '../render/overlays.js';
import { threatSummary } from '../sim/military.js';

const SPEED_LABELS = ['⏸', '▶', '▶▶', '▶▶▶', '⏩'];
const SPEED_TITLES = ['Pause (Space)', 'Normal speed (1)', 'Fast (2)', 'Faster (3)', 'Fastest (4)'];

export class Hud {
  constructor(app, root) {
    this.app = app;
    this.el = h('div', { id: 'hud-top' });
    this.menuBtn = h('button', { class: 'hud-btn', title: 'Game menu (Esc)', onclick: () => app.ui.openPauseMenu() }, '☰');
    this.title = h('span', { class: 'hud-title' }, 'Colonia');
    this.money = this.stat('💰', 'Treasury', 'Treasury (denarii). Click for finances.', () => app.ui.openAdvisors('finance'));
    this.pop = this.stat('👥', 'Population', 'Population. Click for details.', () => app.ui.openAdvisors('population'));
    this.date = this.stat('📅', 'Date', 'Current date');
    this.mood = this.stat('🙂', 'Mood', 'City mood (sentiment). Low mood stops immigration.', () => app.ui.openAdvisors('overview'));
    // Raid alert: hidden in peace time, amber when scouts warn, red during an attack.
    this.threat = h('button', { class: 'hud-btn threat hidden', onclick: () => app.focusThreat() }, '');
    this.speedBtns = SPEED_LABELS.map((lbl, i) => h('button', { class: 'hud-btn', title: SPEED_TITLES[i], onclick: () => (i === 0 ? app.togglePause() : app.setSpeed(i)) }, lbl));
    this.overlaySel = h('select', { class: 'hud-select', title: 'Information overlay (O)', onchange: (e) => app.setOverlay(e.target.value) },
      OVERLAYS.map((o) => h('option', { value: o.key }, o.key === 'none' ? '🗺 Overlays' : o.name)));
    this.el.append(
      this.menuBtn,
      this.title,
      this.money.el,
      this.pop.el,
      this.date.el,
      this.mood.el,
      this.threat,
      h('div', { class: 'speed-group' }, this.speedBtns),
      h('span', { class: 'hud-spacer' }),
      this.overlaySel,
      h('button', { class: 'hud-btn', title: 'Advisors (F2)', onclick: () => app.ui.openAdvisors() }, '📜 Advisors'),
      h('button', { class: 'hud-btn', title: 'Messages', onclick: () => app.ui.openAdvisors('messages') }, '✉'),
      h('button', { class: 'hud-btn', title: 'Help (F1)', onclick: () => app.ui.openHelp() }, '?'),
    );
    root.appendChild(this.el);
  }

  stat(icon, label, title, onclick) {
    const val = h('span', { class: 'num' }, '-');
    const el = h('div', { class: 'hud-stat', title, onclick, style: onclick ? { cursor: 'pointer' } : null }, h('span', {}, icon), val);
    return { el, val };
  }

  update() {
    const { app } = this;
    const g = app.game;
    if (!g) return;
    const c = g.city;
    this.title.textContent = c.name;
    this.money.val.textContent = `${fmt(c.treasury)} Dn`;
    this.money.el.classList.toggle('neg', c.treasury < 0);
    this.pop.val.textContent = fmt(c.population);
    this.date.val.textContent = g.time.shortLabel();
    const s = c.sentiment;
    this.mood.el.firstChild.textContent = s >= 70 ? '😀' : s >= 50 ? '🙂' : s >= 30 ? '😐' : '😠';
    this.mood.val.textContent = `${s}`;
    const t = threatSummary(g);
    const show = t.level === 'attack' || t.level === 'warned';
    this.threat.classList.toggle('hidden', !show);
    if (show) {
      this.threat.classList.toggle('attack', t.level === 'attack');
      this.threat.textContent = t.level === 'attack' ? `⚔ ${t.enemies}` : '⚠ Raid';
      this.threat.title = `${t.text}. Click to ${t.level === 'attack' ? 'look at the raiders' : 'open the military advisor'}.`;
    }
    const active = app.paused ? 0 : app.speedIndex;
    this.speedBtns.forEach((b, i) => b.classList.toggle('active', i === active));
    if (this.overlaySel.value !== app.renderer.overlay.key) this.overlaySel.value = app.renderer.overlay.key;
  }
}

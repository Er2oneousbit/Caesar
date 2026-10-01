/**
 * hud.js
 * ----------------------------------------------------------------------------
 * The top bar: menu button, city name, treasury, population, date, mood,
 * unemployment, speed controls, overlay picker, advisors and help buttons.
 * Refreshed a few times per second by UI.update().
 * ----------------------------------------------------------------------------
 */

import { h, fmt } from './dom.js';
import { CONFIG } from '../config.js';
import { OVERLAYS } from '../render/overlays.js';
import { threatSummary } from '../sim/military.js';
import { SEASON_NAMES } from '../sim/time.js';
import { WEATHER } from '../render/weather.js';

const SEASON_ICONS = { winter: '❄️', spring: '🌱', summer: '☀️', autumn: '🍂' };

const SPEED_LABELS = ['⏸', '▶', '▶▶', '▶▶▶', '⏩'];
const SPEED_TITLES = ['Pause (Space)', 'Normal speed', 'Fast', 'Faster', 'Fastest'].map((t, i) => (i ? `${t}, ${CONFIG.SPEEDS[i]}x (${i})` : t));

/**
 * The top bar's unemployment chip: the share of the workforce without a job,
 * amber once it costs mood (above UNEMPLOYMENT_MOOD_FREE, see computeSentiment
 * in sim/population.js), with the mood it costs and the way out in the tooltip.
 */
export function workLine(c) {
  const rate = c.unemploymentRate || 0;
  const pct = Math.round(rate * 100);
  const cost = Math.round(-(c.sentimentFactors?.unemployment || 0));
  const warn = rate > CONFIG.UNEMPLOYMENT_MOOD_FREE;
  const idle = `${fmt(c.unemployed || 0)} of ${fmt(c.workforce || 0)} workers have no job`;
  const title = warn
    ? `Unemployment ${pct}%: ${idle}. Above ${Math.round(CONFIG.UNEMPLOYMENT_MOOD_FREE * 100)}% it lowers the city mood${cost > 0 ? ` (now -${cost})` : ''}: build workplaces, or stop adding homes. Click for labor.`
    : `Unemployment ${pct}%: ${idle}. Above ${Math.round(CONFIG.UNEMPLOYMENT_MOOD_FREE * 100)}% it lowers the city mood. Click for labor.`;
  return { value: `${pct}%`, warn, title };
}

export class Hud {
  constructor(app, root) {
    this.app = app;
    this.el = h('div', { id: 'hud-top' });
    this.menuBtn = h('button', { class: 'hud-btn', title: 'Game menu (Esc)', onclick: () => app.ui.openPauseMenu() }, '☰');
    this.title = h('span', { class: 'hud-title' }, 'Colonia');
    this.money = this.stat('💰', 'Treasury', 'Treasury (denarii). Click for finances.', () => app.ui.openAdvisors('finance'));
    this.pop = this.stat('👥', 'Population', 'Population. Click for details.', () => app.ui.openAdvisors('population'));
    this.date = this.stat('📅', 'Date', 'Current date and season');
    this.date.el.classList.add('date');
    this.season = h('span', { class: 'lbl season' }, '');
    this.date.el.append(this.season);
    this.mood = this.stat('🙂', 'Mood', 'City mood (sentiment). Low mood stops immigration.', () => app.ui.openAdvisors('overview'));
    // Unemployment beside the mood it drives: past UNEMPLOYMENT_MOOD_FREE it costs mood, so it turns amber there.
    this.work = this.stat('⚒', 'Unemployment', 'Unemployment. Click for labor.', () => app.ui.openAdvisors('labor'));
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
      this.work.el,
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

  /**
   * Show the season's name next to the date only while the top bar has room
   * for it (the bar clips what does not fit, with no scrollbar). Measured
   * again only when something in the bar or its width changed; the class is
   * cleared before measuring, so the word never flickers on and off.
   */
  fitSeason() {
    const el = this.el;
    const sig = `${el.clientWidth}|${this.title.textContent}|${this.money.val.textContent}|${this.pop.val.textContent}|${this.date.val.textContent}|${this.season.textContent}|${this.mood.val.textContent}|${this.work.val.textContent}|${this.threat.className}|${this.threat.textContent}`;
    if (sig === this.fitSig) return;
    this.fitSig = sig;
    el.classList.remove('no-season');
    if (el.scrollWidth > el.clientWidth) el.classList.add('no-season');
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
    const season = g.time.season();
    const r = app.renderer;
    if (this.season.textContent !== SEASON_NAMES[season]) {
      this.date.el.firstChild.textContent = SEASON_ICONS[season];
      this.season.textContent = SEASON_NAMES[season];
    }
    const tip = `${g.time.label()}, ${SEASON_NAMES[season].toLowerCase()}${r.weatherOn ? `. Weather: ${WEATHER[r.weather.kind].label.toLowerCase()}` : ''}`;
    if (this.date.el.title !== tip) this.date.el.title = tip; // no DOM write when nothing changed
    const s = c.sentiment;
    this.mood.el.firstChild.textContent = s >= 70 ? '😀' : s >= 50 ? '🙂' : s >= 30 ? '😐' : '😠';
    this.mood.val.textContent = `${s}`;
    const u = workLine(c);
    this.work.val.textContent = u.value;
    this.work.el.classList.toggle('warn', u.warn);
    if (this.work.el.title !== u.title) this.work.el.title = u.title;
    const t = threatSummary(g);
    const show = t.level === 'attack' || t.level === 'warned';
    this.threat.classList.toggle('hidden', !show);
    if (show) {
      this.threat.classList.toggle('attack', t.level === 'attack');
      this.threat.textContent = t.level === 'attack' ? `⚔ ${t.enemies}` : '⚠ Raid';
      this.threat.title = `${t.text}. Click to ${t.level === 'attack' ? 'look at the raiders' : 'open the military advisor'}.`;
    }
    this.fitSeason();
    const active = app.paused ? 0 : app.speedIndex;
    this.speedBtns.forEach((b, i) => b.classList.toggle('active', i === active));
    if (this.overlaySel.value !== app.renderer.overlay.key) this.overlaySel.value = app.renderer.overlay.key;
  }
}

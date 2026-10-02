/**
 * hud.js
 * ----------------------------------------------------------------------------
 * The top bar: menu button, city name, treasury, population, date, mood,
 * unemployment, speed controls, overlay picker, empire map, advisors and help buttons.
 * Refreshed a few times per second by UI.update().
 * ----------------------------------------------------------------------------
 */

import { h, fmt } from './dom.js';
import { CONFIG } from '../config.js';
import { OVERLAYS } from '../render/overlays.js';
import { threatSummary } from '../sim/military.js';
import { SEASON_NAMES } from '../sim/time.js';
import { WEATHER } from '../render/weather.js';
import { viewDir } from '../render/view.js';

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

/**
 * The top bar's north needle at view turn `turn`, in degrees clockwise from
 * up (north is the game's compass: straight up at turn 0, a step of (-1, -1)
 * on the map; on the screen a step (dx, dy) moves (dx - dy) * 32 px across
 * and (dx + dy) * 16 px down). Taken the shortest way round from where it
 * points now (`from`), so its eased turn follows the city's: from 270 it
 * goes on to 360, not back three quarters to 0.
 */
export function needleAngle(turn, from = null) {
  const [dx, dy] = viewDir(-1, -1, turn);
  const deg = (Math.atan2((dx + dy) * 16, (dx - dy) * 32) * 180) / Math.PI + 90;
  if (from === null || from === undefined) return deg;
  return from + ((((deg - from) % 360) + 540) % 360) - 180;
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
    // Turning the view (render/view.js): the city a quarter turn either way,
    // and a needle pointing north (a click turns back to the start, north up).
    this.northNeedle = h('span', { class: 'needle' }, '↑');
    this.viewBtns = h('div', { class: 'view-group' },
      h('button', { class: 'hud-btn', id: 'hud-turn-left', title: 'Turn the view: the city a quarter turn anticlockwise (Shift+Q or [)', 'aria-label': 'Turn the view anticlockwise', onclick: () => app.turnView(-1) }, '⟲'),
      h('button', { class: 'hud-btn north', id: 'hud-north', title: 'Where north lies. Click to turn the view back to the start', 'aria-label': 'North', onclick: () => app.turnView(-app.renderer.viewTurn) }, this.northNeedle),
      h('button', { class: 'hud-btn', id: 'hud-turn-right', title: 'Turn the view: the city a quarter turn clockwise (Q or ])', 'aria-label': 'Turn the view clockwise', onclick: () => app.turnView(1) }, '⟳'));
    this.shownTurn = -1;
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
      this.viewBtns,
      h('button', { class: 'hud-btn', id: 'hud-empire', title: 'Empire map (E)', 'aria-label': 'Empire map', onclick: () => app.ui.openEmpire() }, '🧭'),
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
      this.threat.textContent = t.label || (t.level === 'attack' ? `⚔ ${t.enemies}` : '⚠ Raid');
      this.threat.title = `${t.text}. Click to ${t.level === 'attack' ? 'look at them' : 'open the military advisor'}.`;
    }
    this.fitSeason();
    const active = app.paused ? 0 : app.speedIndex;
    this.speedBtns.forEach((b, i) => b.classList.toggle('active', i === active));
    if (this.overlaySel.value !== app.renderer.overlay.key) this.overlaySel.value = app.renderer.overlay.key;
    this.showViewTurn(app.renderer.viewTurn);
  }

  /**
   * Point the needle at north as the view shows it. The game's compass
   * (the scouts' "from the north", sim/military.js screenDirection) is the
   * unturned screen's, so north is straight up at turn 0: the map's (0, 0)
   * corner, a step of (-1, -1). Each quarter turn of the city turns it with
   * it (right at turn 1).
   */
  showViewTurn(turn) {
    if (turn === this.shownTurn) return;
    this.shownTurn = turn;
    this.needleDeg = needleAngle(turn, this.needleDeg);
    this.northNeedle.style.transform = `rotate(${Math.round(this.needleDeg)}deg)`;
    this.northNeedle.parentElement.dataset.turn = String(turn); // (for the browser smoke test)
  }
}

/**
 * ui.js
 * ----------------------------------------------------------------------------
 * UI coordinator: creates every DOM widget, routes updates to them, and owns
 * the modal layer (one modal at a time) and the main menu layer.
 * ----------------------------------------------------------------------------
 */

import { h, mount, fmt } from './dom.js';
import { Hud } from './hud.js';
import { Sidebar } from './sidebar.js';
import { InfoPanel } from './infoPanel.js';
import { Messages } from './messages.js';
import { Advisors } from './advisors.js';
import { EmpireView } from './empire.js';
import { DebugConsole } from './console.js';
import { helpModal } from './help.js';
import { mainMenu, pauseMenu, titleGate } from './menus.js';
import { BUILDINGS, TOOLS } from '../data/buildings.js';
import { TERRAIN_NAMES } from '../world/map.js';
import { planNoRoadWarning } from '../sim/construction.js';

/** How long the leaving title gate still catches input (about a double-click). */
const GATE_GUARD_MS = 500;

export class UI {
  /** @param {import('../app.js').App} app */
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.hud = new Hud(app, root);
    this.sidebar = new Sidebar(app, root);
    this.info = new InfoPanel(app, root);
    this.messages = new Messages(app, root);
    this.advisors = new Advisors(app);
    this.empire = new EmpireView(app);
    this.console = new DebugConsole(app, root);
    this.debugEl = h('div', { id: 'debug-hud', class: 'hidden' });
    // Overlay helpers: a tooltip over the building under the pointer, and a legend.
    this.tipEl = h('div', { id: 'tooltip', class: 'hidden', role: 'tooltip' });
    this.legendEl = h('div', { id: 'overlay-legend', class: 'hidden' });
    this.legendKey = null;
    root.append(this.tipEl, this.legendEl);
    this.modalRoot = h('div', { id: 'modal-root' });
    this.menuRoot = h('div', { id: 'menu-root' });
    root.append(this.debugEl, this.menuRoot, this.modalRoot);
    this.modalPause = false;
    this.modalKind = null;
    this.hudTimer = 0;
    this.debugTimer = 0;
  }

  // ------------------------------------------------------------ main menu
  showMainMenu() {
    this.hideAudioGate();
    mount(this.menuRoot, mainMenu(this.app));
    this.setGameChrome(false);
    if (this.app.needsAudioGate()) this.showAudioGate();
  }

  hideMainMenu() {
    this.hideAudioGate();
    mount(this.menuRoot);
  }

  get audioGateOpen() { return !!this.gate; }

  /**
   * Title gate over the main menu: "click, tap or press any key to begin".
   * Browsers hold sound back until the player interacts, so this first
   * gesture is the one that starts the menu music. It swallows that gesture,
   * so no menu button underneath is pressed by it.
   */
  showAudioGate() {
    if (this.gate) return;
    const menu = this.menuRoot.querySelector('#main-menu');
    if (menu) { menu.inert = true; menu.classList.add('gated'); } // not seen, clickable, focusable or read out
    const begin = (e) => {
      if (e.type === 'keydown') {
        if (e.repeat || e.isComposing) { e.preventDefault(); e.stopPropagation(); return; }
        // Leave Tab, modifiers, Escape and browser keys alone (Escape is not a
        // user activation, so it could not start the music anyway).
        if (e.ctrlKey || e.metaKey || e.altKey || /^(Tab|Escape|Shift|Control|Alt|AltGraph|Meta|CapsLock|NumLock|ScrollLock|Fn|OS|F\d+)$/.test(e.key)) return;
        e.preventDefault();
      }
      e.stopPropagation(); // the gesture is the gate's: no game shortcut, no menu button
      this.app.unlockAudio(); // inside the gesture, so the browser lets the sound start
      this.hideAudioGate(e.type === 'keydown');
    };
    const el = titleGate(this.app);
    el.addEventListener('click', begin);
    this.gate = { el, menu, begin };
    window.addEventListener('keydown', begin, true);
    this.menuRoot.appendChild(el);
    // Never pull focus out of an embedding page (artifact viewer) or another window.
    setTimeout(() => { if (document.hasFocus()) el.querySelector('.gate-begin')?.focus({ preventScroll: true }); }, 0);
  }

  /**
   * Remove the title gate (the audio started, or the player moved on). It
   * fades for a moment but keeps catching clicks until it is gone, so the
   * rest of a tap (the click that follows touchend) cannot land on a menu
   * button that appears under the finger.
   */
  hideAudioGate(byKey = false) {
    const g = this.gate;
    if (!g) return;
    this.gate = null;
    const focusMenu = byKey && g.el.contains(document.activeElement); // keyboard players land on the menu
    window.removeEventListener('keydown', g.begin, true);
    // Guard the rest of the gesture: auto-repeats of the held key and the
    // second click of a double-click / double tap must not press a menu button.
    const until = performance.now() + GATE_GUARD_MS;
    const guard = (e) => {
      if (performance.now() > until && e.type === 'click') return;
      if ((e.type === 'keydown' && e.repeat) || (e.type === 'click' && e.detail >= 2)) { e.preventDefault(); e.stopPropagation(); }
    };
    // Keyboard players land on the first menu button once the key is up AND
    // the menu takes input again (focus() on an inert element does nothing),
    // whichever comes last; until then a second Enter only meets the gate.
    let released = false;
    let gone = false;
    const focusFirst = () => {
      if (focusMenu && released && gone && g.menu && g.menu.isConnected) g.menu.querySelector('.btn')?.focus({ preventScroll: true });
    };
    const end = () => {
      window.removeEventListener('keydown', guard, true);
      window.removeEventListener('click', guard, true);
      window.removeEventListener('keyup', end, true);
      released = true;
      focusFirst();
    };
    window.addEventListener('keydown', guard, true);
    window.addEventListener('click', guard, true);
    if (focusMenu) window.addEventListener('keyup', end, true); // keyboard: focus the menu once the key is released
    else setTimeout(end, GATE_GUARD_MS);
    // Fade out from the opacity on screen now: a gate dropped at once (autoplay
    // that starts a moment late) is still invisible and must not flash.
    g.el.style.setProperty('--gate-from', getComputedStyle(g.el).opacity);
    g.el.classList.add('leaving');
    if (g.menu) g.menu.classList.remove('gated'); // the menu card fades in
    setTimeout(() => {
      g.el.remove();
      if (g.menu) g.menu.inert = false;
      gone = true;
      focusFirst();
    }, 250);
  }

  get mainMenuOpen() { return this.menuRoot.childElementCount > 0; }

  /** Show/hide the in-game widgets (hidden behind the main menu). */
  setGameChrome(visible) {
    for (const el of [this.hud.el, this.sidebar.el, this.messages.el]) el.classList.toggle('hidden', !visible);
    if (!visible) this.info.close();
  }

  // ---------------------------------------------------------------- modals
  /**
   * Show a modal element. `pause` stops the simulation while it is open.
   */
  showModal(el, { pause = true, kind = null } = {}) {
    const backdrop = h('div', {
      class: 'modal-backdrop',
      onpointerdown: (e) => { if (e.target === backdrop && kind !== 'outcome') this.closeModal(); },
    }, el);
    mount(this.modalRoot, backdrop);
    this.modalPause = pause;
    this.modalKind = kind;
  }

  closeModal() {
    mount(this.modalRoot);
    this.modalPause = false;
    this.modalKind = null;
  }

  hasModal() { return this.modalRoot.childElementCount > 0; }

  /**
   * In-game confirmation dialog (window.confirm is blocked in some embeds,
   * and a styled dialog fits the game better anyway).
   */
  confirm(message, onYes, { title = 'Are you sure?', yes = 'Yes', no = 'Cancel', danger = false } = {}) {
    const modal = h('div', { class: 'modal narrow', role: 'alertdialog' },
      h('div', { class: 'modal-head' }, h('h2', {}, title)),
      h('div', { class: 'modal-body' }, h('p', {}, message)),
      h('div', { class: 'modal-foot' },
        h('button', { class: 'btn', onclick: () => this.closeModal() }, no),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { this.closeModal(); onYes(); } }, yes)));
    this.showModal(modal, { pause: true, kind: 'confirm' });
    setTimeout(() => modal.querySelector('.modal-foot .btn:last-child')?.focus(), 0);
  }

  /** Show text the player can copy (fallback when the clipboard is blocked). */
  showText(title, text, note = '') {
    const area = h('textarea', { id: 'text-dialog', readonly: true, style: { width: '100%', height: '180px', fontFamily: 'monospace', fontSize: '11px' } });
    area.value = text;
    this.showModal(h('div', { class: 'modal narrow' },
      h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'panel-close', onclick: () => this.closeModal() }, '×')),
      h('div', { class: 'modal-body' }, note ? h('p', { class: 'muted' }, note) : null, area),
      h('div', { class: 'modal-foot' }, h('button', { class: 'btn primary', onclick: () => this.closeModal() }, 'Done'))), { pause: true, kind: 'text' });
    setTimeout(() => { area.focus(); area.select(); }, 0);
  }

  /** Ask for pasted text, then call onSubmit(text). */
  askText(title, note, submitLabel, onSubmit) {
    const area = h('textarea', { id: 'paste-dialog', placeholder: 'Paste here', style: { width: '100%', height: '180px', fontFamily: 'monospace', fontSize: '11px' } });
    this.showModal(h('div', { class: 'modal narrow' },
      h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'panel-close', onclick: () => this.closeModal() }, '×')),
      h('div', { class: 'modal-body' }, h('p', { class: 'muted' }, note), area),
      h('div', { class: 'modal-foot' },
        h('button', { class: 'btn', onclick: () => this.closeModal() }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => onSubmit(area.value) }, submitLabel))), { pause: true, kind: 'text' });
    setTimeout(() => area.focus(), 0);
  }

  openHelp(tab) { this.showModal(helpModal(this.app, tab), { pause: true, kind: 'help' }); }

  openAdvisors(tab) {
    if (!this.app.game) return;
    this.showModal(this.advisors.element(tab), { pause: false, kind: 'advisors' });
  }

  /**
   * The Empire screen: runs with the game, like the Advisors, so travelers
   * move. `focus`: a traveler kind ('warband', 'legion') to pick out, for a
   * message or a button about it.
   */
  openEmpire(focus = null) {
    if (!this.app.game) return;
    this.showModal(this.empire.element(), { pause: false, kind: 'empire' });
    this.empire.update(0); // drawn before the next frame, not one frame late
    if (focus) this.empire.focus(focus);
  }

  /** E: open the Empire screen, or close it when it is open. */
  toggleEmpire() {
    if (this.modalKind === 'empire') this.closeModal();
    else this.openEmpire();
  }

  openPauseMenu() {
    if (!this.app.game) return;
    this.showModal(pauseMenu(this.app), { pause: true, kind: 'pause' });
  }

  // ----------------------------------------------------------------- tools
  /** Select a build tool from anywhere (keyboard, menu). */
  selectTool(key) {
    const g = this.app.game;
    if (key && g && !g.isUnlocked(key)) {
      this.toastError('That is not available in this scenario.');
      return;
    }
    const def = key ? BUILDINGS[key] || TOOLS[key] : null;
    if (def && def.category && def.category !== this.sidebar.category) {
      this.sidebar.category = def.category;
      this.sidebar.renderCategories();
    }
    this.app.input.setTool(key);
    if (key) this.info.close();
  }

  onToolChanged(tool) {
    this.sidebar.renderList();
    this.sidebar.showToolInfo(tool);
  }

  onPlanChanged(plan) { this.sidebar.showPlan(plan); }

  /** The building in hand was turned (R): the build panel shows its new turn. */
  onTurnChanged(tool) { this.sidebar.showToolInfo(tool); this.app.sfx?.play?.('click'); }

  /** Error/feedback toast that is not recorded in the game's message log. */
  toastError(text) {
    this.messages.push({ text, level: 'warn', date: '' });
    this.app.sfx.play('error');
  }

  onGameStarted() {
    this.closeModal();
    this.hideMainMenu();
    this.setGameChrome(true);
    this.messages.clear();
    this.info.close();
    this.sidebar.category = 'housing';
    this.sidebar.renderCategories();
    this.sidebar.renderList();
    this.sidebar.showToolInfo(null);
  }

  // ---------------------------------------------------------------- update
  update(dt, now) {
    this.hudTimer += dt;
    if (this.hudTimer > 0.25) {
      this.hudTimer = 0;
      this.hud.update();
    }
    if (this.app.game) this.sidebar.update(now);
    this.info.update(dt);
    if (this.modalKind === 'advisors') this.advisors.update(dt);
    if (this.modalKind === 'empire') this.empire.update(dt);
    this.updateOverlayHelp();
    this.updateDebug(dt);
  }

  /**
   * The overlay's legend (while an overlay with one is on) and its tooltip:
   * what `overlay.tip` says about the building under the pointer. While a
   * building is being placed where no road would reach it, the same tooltip
   * says so by the cursor in the warning style (the sidebar alone was easy
   * to miss, and a building with no road does nothing at all).
   */
  updateOverlayHelp() {
    const app = this.app;
    const g = app.game;
    const ov = app.renderer.overlay;
    const legend = g && !this.mainMenuOpen && ov.legend ? ov : null;
    if ((legend ? legend.key : null) !== this.legendKey) {
      this.legendKey = legend ? legend.key : null;
      this.legendEl.classList.toggle('hidden', !legend);
      if (legend) {
        mount(this.legendEl,
          h('b', {}, legend.name),
          legend.legend.map(([color, label]) => h('div', { class: 'legend-row' }, h('i', { style: { background: color } }), label)),
          h('div', { class: 'muted' }, 'Point at a column to see why.'),
          legend.key === 'problems' ? h('div', { class: 'muted' }, 'I: the next idle building.') : null);
      }
    }
    const t = app.renderer.hoverTile;
    const m = app.input ? app.input.mouse : null;
    let text = null;
    let warn = false;
    if (g && t && m && m.over && !this.hasModal()) {
      if (app.input.tool) {
        const w = planNoRoadWarning(app.renderer.plan);
        if (w) { text = `⚠ ${w}`; warn = true; }
      } else if (ov.tip) {
        const b = g.buildings.get(g.map.buildingAt(t.x, t.y));
        if (b) text = ov.tip(g, b);
      }
    }
    this.tipEl.classList.toggle('warn', warn);
    this.tipEl.classList.toggle('hidden', !text);
    if (!text) return;
    if (this.tipEl.textContent !== text) this.tipEl.textContent = text;
    const r = app.canvas.getBoundingClientRect();
    const x = Math.min(r.left + m.x + 16, window.innerWidth - this.tipEl.offsetWidth - 8);
    const y = Math.min(r.top + m.y + 18, window.innerHeight - this.tipEl.offsetHeight - 8);
    this.tipEl.style.left = `${Math.max(4, x)}px`;
    this.tipEl.style.top = `${Math.max(4, y)}px`;
  }

  updateDebug(dt) {
    const show = this.app.showDebugHud;
    this.debugEl.classList.toggle('hidden', !show);
    if (!show) return;
    this.debugTimer += dt;
    if (this.debugTimer < 0.25) return;
    this.debugTimer = 0;
    const a = this.app;
    const g = a.game;
    const p = a.perf;
    const lines = [
      `FPS ${p.fps}  frame ${p.frameMs.toFixed(1)}ms  render ${a.renderer.stats.ms.toFixed(1)}ms`,
      `sim ${p.simMs.toFixed(2)}ms/frame  ticks/frame ${p.ticks}  speed ${a.paused ? 'paused' : a.speedIndex}`,
      `objects ${a.renderer.stats.objects}  tiles ${a.renderer.stats.tiles}  sprites ${a.renderer.sprites.created}`,
    ];
    if (g) {
      lines.push(`buildings ${g.buildings.size}  walkers ${g.walkers.size}  fires ${g.fires.size}  zoom ${a.renderer.camera.zoom}`);
      const t = a.input.hover;
      if (t && g.map.inBounds(t.x, t.y)) {
        const i = g.map.idx(t.x, t.y);
        lines.push(`tile ${t.x},${t.y} ${TERRAIN_NAMES[g.map.terrain[i]]} des ${g.map.desirability[i]} water ${g.map.water[i]} road ${g.map.road[i]}/net ${g.map.roadNet[i]} bld ${g.map.building[i]}`);
      }
      lines.push(`pop ${fmt(g.city.population)} work ${g.city.employed}/${g.city.workforce} mood ${g.city.sentiment}`);
    }
    this.debugEl.textContent = lines.join('\n');
  }
}

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
import { DebugConsole } from './console.js';
import { helpModal } from './help.js';
import { mainMenu, pauseMenu } from './menus.js';
import { BUILDINGS, TOOLS } from '../data/buildings.js';
import { TERRAIN_NAMES } from '../world/map.js';

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
    this.console = new DebugConsole(app, root);
    this.debugEl = h('div', { id: 'debug-hud', class: 'hidden' });
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
    mount(this.menuRoot, mainMenu(this.app));
    this.setGameChrome(false);
  }

  hideMainMenu() { mount(this.menuRoot); }

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
    this.updateDebug(dt);
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

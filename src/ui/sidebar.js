/**
 * sidebar.js
 * ----------------------------------------------------------------------------
 * Right-hand panel: minimap, build categories, the list of buildings in the
 * chosen category, a description/cost box for the current tool, and quick
 * actions (clear land, undo, cancel). On phones it becomes a bottom sheet.
 * ----------------------------------------------------------------------------
 */

import { h, mount, fmt } from './dom.js';
import { CATEGORIES, BUILDINGS, TOOLS, LABOR_CATEGORIES, buildingsInCategory, fullName } from '../data/buildings.js';
import { iconCanvas } from './icons.js';
import { Minimap } from '../render/minimap.js';
import { planNoRoadWarning } from '../sim/construction.js';
import { archesToBuild } from '../sim/battle.js';

/**
 * The English name under the Latin one (Castra, then "Legion Fort"), smaller
 * and muted: none when they are the same word (Forum) or for Clear Land.
 */
function englishName(def) {
  return def.en && def.en !== def.name ? h('span', { class: 'en' }, def.en) : null;
}

export class Sidebar {
  constructor(app, root) {
    this.app = app;
    this.category = 'housing';
    this.el = h('aside', { id: 'sidebar' });
    const mmCanvas = h('canvas', { id: 'minimap', width: 440, height: 224, title: 'Minimap: click or drag to move the view' });
    this.minimap = new Minimap(mmCanvas);
    this.bindMinimap(mmCanvas);
    this.catsEl = h('div', { id: 'categories' });
    this.listEl = h('div', { id: 'build-list' });
    this.infoEl = h('div', { id: 'tool-info' });
    this.undoBtn = h('button', { class: 'btn small', title: 'Undo last construction (Ctrl+Z)', onclick: () => app.undo() }, '↶ Undo');
    this.cancelBtn = h('button', { class: 'btn small', title: 'Stop building (right click)', onclick: () => app.ui.selectTool(null) }, '✋ Inspect');
    this.el.append(
      h('div', { id: 'minimap-wrap' }, mmCanvas),
      this.catsEl,
      this.listEl,
      this.infoEl,
      h('div', { id: 'tool-actions' },
        h('button', { class: 'btn small', title: 'Clear land / demolish (X)', onclick: () => app.ui.selectTool('clear') }, '⛏ Clear'),
        this.undoBtn,
        this.cancelBtn),
    );
    root.appendChild(this.el);
    this.renderCategories();
    this.renderList();
    this.showToolInfo(null);
  }

  bindMinimap(canvas) {
    let down = false;
    // A click travels to the spot; dragging on the minimap follows the pointer directly.
    const move = (e, glide = false) => {
      const r = canvas.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * canvas.width;
      const py = ((e.clientY - r.top) / r.height) * canvas.height;
      const w = this.minimap.toWorld(px, py);
      if (glide) this.app.renderer.camera.glideToWorld(w.x, w.y);
      else this.app.renderer.camera.centerOnWorld(w.x, w.y);
    };
    canvas.addEventListener('pointerdown', (e) => { down = true; canvas.setPointerCapture(e.pointerId); move(e, true); });
    canvas.addEventListener('pointermove', (e) => { if (down) move(e); });
    canvas.addEventListener('pointerup', () => { down = false; });
  }

  renderCategories() {
    mount(this.catsEl, CATEGORIES.map((c) => h('button', {
      class: `cat-btn${c.key === this.category ? ' active' : ''}`,
      title: c.name + (c.hotkey ? ` (${c.hotkey})` : ''),
      onclick: () => {
        const same = this.category === c.key;
        this.category = c.key;
        this.renderCategories();
        this.renderList();
        if (same) this.listEl.classList.toggle('collapsed');
        else this.listEl.classList.remove('collapsed');
      },
    }, c.icon)));
  }

  renderList() {
    const g = this.app.game;
    const cat = CATEGORIES.find((c) => c.key === this.category);
    // A triumphal arch shows only while one is there to build (one for each
    // distant battle won, sim/battle.js), as the original's did.
    const items = buildingsInCategory(this.category).filter(({ key, def }) => def.kind !== 'arch' || (g && g.isUnlocked(key)));
    this.archSig = g ? archesToBuild(g) : 0;
    const current = this.app.input ? this.app.input.tool : null;
    mount(this.listEl,
      h('div', { class: 'build-cat-title' }, cat ? cat.name : ''),
      items.map(({ key, def }) => {
        const unlocked = !g || g.isUnlocked(key);
        const cost = def.kind === 'arch' ? `Free (${this.archSig})` : def.cost ? `${def.cost} Dn` : '';
        return h('button', {
          class: `build-item${current === key ? ' active' : ''}${unlocked ? '' : ' locked'}`,
          dataset: { key }, // for the smoke test, which should not depend on the wording
          title: `${fullName(def)}\n${unlocked ? def.desc : 'Not available in this scenario'}`,
          onclick: () => { if (unlocked) this.app.ui.selectTool(key); },
          onmouseenter: () => { if (!this.app.input?.tool) this.showToolInfo(key, true); },
          onmouseleave: () => { if (!this.app.input?.tool) this.showToolInfo(null); },
        }, iconCanvas(key), h('span', { class: 'nm' }, def.name, englishName(def), unlocked ? null : h('div', { class: 'muted', style: { fontSize: '11px' } }, 'Locked')), h('span', { class: 'cost' }, cost));
      }));
  }

  /** Description of a building/tool (hover or selected). */
  showToolInfo(key, preview = false) {
    if (!key) {
      mount(this.infoEl,
        h('h4', {}, 'Inspect mode'),
        h('div', { class: 'muted' }, 'Click a building, a walker or a tile for details. Pick something to build from the categories above.'),
      );
      return;
    }
    const def = BUILDINGS[key] || TOOLS[key];
    if (!def) return;
    const facts = [];
    if (def.cost) facts.push(`${def.cost} Dn${TOOLS[key] && TOOLS[key].drag !== 'single' ? ' / tile' : ''}`);
    if (def.size) facts.push(`${def.size * (def.span || 1)}×${def.size}`); // (the hippodrome: 15x5)
    if (def.workers) facts.push(`${def.workers} workers (${LABOR_CATEGORIES[def.labor] || 'Industry'})`);
    this.planEl = h('div', {});
    mount(this.infoEl,
      h('h4', {}, def.name, englishName(def)),
      facts.length ? h('div', { class: 'muted' }, facts.join(' · ')) : null,
      // The plan (cost, why it cannot go here, warnings) above the
      // description, so the fixed-height box never scrolls it out of sight.
      this.planEl,
      h('div', { style: { marginTop: '3px' } }, def.desc),
    );
  }

  /** Live preview summary while placing. */
  showPlan(plan) {
    if (!this.planEl) return;
    if (!plan) { mount(this.planEl); return; }
    const parts = [];
    if (plan.count > 0) {
      const what = plan.tool === 'clear' ? 'to clear' : plan.kind === 'building' ? '' : 'tiles';
      parts.push(h('div', { style: { marginTop: '4px', fontWeight: 600 } }, plan.kind === 'building' ? `Cost: ${fmt(plan.cost)} Dn` : `${plan.count} ${what} · ${fmt(plan.cost)} Dn`));
      if (plan.fertility !== undefined) parts.push(h('div', { class: plan.fertility >= 0.75 ? 'ok' : 'warn' }, `Fertility: ${Math.round(plan.fertility * 100)}%`));
    }
    if (plan.reason && plan.count === 0) parts.push(h('div', { class: 'err' }, plan.reason));
    // No road in reach: in the error style, because the building would do nothing.
    const noRoad = planNoRoadWarning(plan);
    for (const w of plan.warnings || []) parts.push(h('div', { class: w === noRoad ? 'err' : 'warn' }, `⚠ ${w}`));
    mount(this.planEl, parts);
  }

  update(now) {
    const g = this.app.game;
    if (!g) return;
    this.minimap.draw(g, this.app.renderer.camera, now);
    this.undoBtn.disabled = !this.app.canUndo();
    // An arch earned or built: the Government list shows it, or stops showing it.
    if (this.category === 'government' && archesToBuild(g) !== this.archSig) this.renderList();
  }
}

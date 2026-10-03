/**
 * input.js
 * ----------------------------------------------------------------------------
 * Mouse, touch and keyboard handling for the game view.
 *
 * Mouse:
 *   left click          inspect a building / walker / tile (or place with a tool)
 *   left drag           pan the map (no tool) / drag roads, housing, clearing
 *   left drag on a      move a deployed fort's or station's rally flag (a
 *     rally flag        click on it opens its panel); never pans the map
 *   right click         cancel the current tool (or close the info panel)
 *   middle/right drag   pan the map
 *   wheel               zoom toward the cursor (trackpad scrolls add up
 *                       to one zoom level per WHEEL_STEP pixels)
 * Touch:
 *   tap = click, one-finger drag = pan (or tool drag), pinch = zoom,
 *   two-finger drag = pan; a drag that starts on a rally flag moves the flag
 * Letting go of a fast drag flings the map: it keeps sliding and slows down
 * (camera.fling). Grabbing the map again stops it.
 * Keyboard shortcuts are listed in KEY_HELP (shown in the in-game Help).
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { dragMode, planAction, turnRule } from '../sim/construction.js';
import { postsAway } from '../sim/battle.js';
import { BUILDINGS } from '../data/buildings.js';

export const KEY_HELP = [
  ['W A S D / Arrow keys', 'Scroll the map'],
  ['Mouse wheel, + / -', 'Zoom in / out (eases toward the cursor)'],
  ['Left click (no tool)', 'Inspect a building, a walker or a tile'],
  ['Left drag (no tool)', 'Scroll the map; let go while moving to fling it'],
  ['Right click', 'Cancel tool / close panel'],
  ['Drag a rally flag', 'Move a deployed fort\'s or naval station\'s standard (a click on it opens its panel)'],
  ['Space or P', 'Pause / resume'],
  ['M', 'Music on / off'],
  ['1 2 3 4', `Game speed ${CONFIG.SPEEDS.slice(1).map((v) => `${v}x`).join(', ')}`],
  ['H', 'Housing tool'],
  ['R', 'Turn the building being placed a quarter turn clockwise (with no building in hand: Road tool)'],
  ['Q / Shift+Q, ] / [', 'Turn the view: the city a quarter turn clockwise / anticlockwise'],
  ['X or Delete', 'Clear land tool'],
  ['Ctrl+Z or U', 'Undo last construction'],
  ['O / Shift+O', 'Next overlay / turn overlays off'],
  ['E', 'Empire map: trade partners, caravans and ships on the way, warbands'],
  [', / .', 'The building before / after the open one of the same kind'],
  ['I / Shift+I', 'Next / previous idle building (not working, or short of goods)'],
  ['Shift+1 to Shift+9', 'Show fort I to IX and open its panel (again: glide to its standard, if deployed)'],
  ['F', 'Deploy the fort or naval station whose panel is open (then click where they go; F or Esc cancels)'],
  ['Home', 'Glide to the map entrance'],
  ['F1', 'Help'],
  ['F2', 'Advisors'],
  ['F3', 'Toggle debug HUD'],
  ['F5 / F9', 'Quick save / quick load'],
  ['` (backtick)', 'Debug console'],
  ['Esc', 'Cancel / close / game menu'],
];

const CLICK_SLOP = 6; // px of movement before a press becomes a drag
const WHEEL_STEP = 40; // wheel delta (px) per zoom level; a mouse notch is ~100, trackpads send small steps
const FLING_WINDOW_MS = 90; // the pointer must still be moving this recently when released to fling

export class Input {
  /** @param {import('../app.js').App} app */
  constructor(app) {
    this.app = app;
    this.canvas = app.renderer.canvas;
    this.tool = null;
    this.drag = null; // active tool drag { x0, y0, x1, y1 }
    this.press = null; // pending left press { sx, sy, moved, id }
    this.pan = null; // { sx, sy, id }
    this.pointers = new Map(); // id -> {x, y}
    this.pinch = null;
    this.flag = null; // a press on a rally flag { id, sx, sy, lx, ly, moved, pointerId }: a click or a drag of the flag
    this.keys = new Set();
    // `game` is the game the pointer last really moved in (null behind menus).
    // Edge scrolling waits for it: when a menu closes (or the page loads) under
    // a still cursor the browser sends pointerenter but no pointermove, and an
    // unknown position must never count as "at the screen edge".
    this.mouse = { x: -1, y: -1, over: false, game: null };
    this.hover = null;
    this.planKey = '';
    // The turn the player gave each kind of building (R), kept for the next
    // one of that kind for the rest of the session.
    this.turns = {};
    // The tool the player turned by hand (R) since he took it up, or null.
    // Until he does, a building with a road along one side only turns its
    // front to that road by itself (sim/construction.js roadTurn); once he
    // does, his turn holds until he picks another tool.
    this.handTurned = null;
    // The last building plan shown { tool, turn, auto }: kept when the ghost
    // goes (the pointer left the map for the build panel's Turn button), so
    // the button turns on from what the player last saw, as R does.
    this.lastShown = null;
    this.wheelAcc = 0; // wheel delta not yet turned into a zoom step
    this.flick = { vx: 0, vy: 0, t: 0 }; // drag velocity (CSS px/s) for the fling on release
    this.bind();
  }

  bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e, true));
    c.addEventListener('pointerenter', (e) => { this.mouse.over = true; this.trackMouse(e); });
    c.addEventListener('pointerleave', () => { this.mouse.over = false; this.hover = null; this.app.renderer.hoverTile = null; if (!this.drag) this.refreshPlan(); });
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.cancelFlag(); }); // (its release may never come)
  }

  get game() { return this.app.game; }

  /** Select a build tool (or null for inspect mode). */
  setTool(key) {
    if (key) this.app.cancelDeploy?.();
    this.tool = key || null;
    this.handTurned = null; // (a new tool: the road decides again until R)
    this.lastShown = null;
    this.drag = null;
    this.planKey = '';
    this.app.renderer.tool = this.tool;
    this.refreshPlan();
    this.canvas.style.cursor = this.tool ? 'cell' : 'crosshair';
    this.app.ui.onToolChanged(this.tool);
  }

  /** The turn the next building of this kind is placed with (0..3). */
  turnFor(tool) {
    return this.turns[tool] ?? 0;
  }

  /**
   * R: a quarter turn clockwise for the building in hand; with no building
   * in hand R is still the Road tool.
   */
  onTurnKey() {
    if (!this.tool || !BUILDINGS[this.tool]?.size) { this.app.ui.selectTool('road'); return; }
    this.turnTool();
  }

  /**
   * Turn the building in hand (R, or the build panel's Turn button). One
   * that turns itself (by its water or its road) stays as it is and the
   * player is told why. @returns true if it turned
   */
  turnTool() {
    const tool = this.tool;
    if (!tool) return false;
    const why = turnRule(tool);
    if (why) {
      this.app.ui.toastError?.(why);
      return false;
    }
    // A quarter turn on from what the ghost shows: the turn the road gave
    // it, if it took one, else the turn kept for this kind.
    const seen = this.lastShown;
    const shown = this.handTurned !== tool && seen && seen.tool === tool && seen.auto ? seen.turn : this.turnFor(tool);
    this.turns[tool] = (shown + 1) & 3;
    this.handTurned = tool;
    // The build panel first (it starts a fresh plan box), then the plan it shows.
    this.app.ui.onTurnChanged?.(tool, this.turns[tool]);
    this.planKey = '';
    this.refreshPlan();
    return true;
  }

  localPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  tileAt(p) { return this.app.renderer.camera.screenToTile(p.x, p.y); }

  /**
   * The map moved under a still pointer (the view turned): the tile under it
   * is another, so the hover, a drag's far end and the plan follow it.
   */
  rehover() {
    if (!this.game || !this.mouse.over || this.mouse.game !== this.game) return;
    const t = this.tileAt(this.mouse);
    this.hover = t;
    this.app.renderer.hoverTile = this.game.map.inBounds(t.x, t.y) ? t : null;
    if (this.drag) { this.drag.x1 = t.x; this.drag.y1 = t.y; }
    this.refreshPlan();
  }

  // ---------------------------------------------------------------- pointers
  onDown(e) {
    if (!this.game || this.app.blockingModal()) return;
    this.app.sfx._ensure();
    this.canvas.setPointerCapture?.(e.pointerId);
    const p = this.localPos(e);
    this.pointers.set(e.pointerId, p);
    // A flag press whose release never came (lost focus mid-drag) must not
    // turn this new press into a drop.
    if (this.pointers.size === 1) this.cancelFlag();
    this.app.renderer.camera.stopMotion(); // grabbing the map stops a fling or glide
    this.flick = { vx: 0, vy: 0, t: e.timeStamp || performance.now() };
    if (this.pointers.size === 2) {
      // Start a pinch: abandon any press/drag.
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      this.press = null;
      this.drag = null;
      this.cancelFlag();
      this.refreshPlan();
      return;
    }
    if (e.button === 1 || e.button === 2) {
      this.pan = { sx: p.x, sy: p.y, id: e.pointerId, moved: false, button: e.button };
      return;
    }
    if (e.button !== 0) return;
    // A rally flag under the pointer wins over everything under it: a click
    // opens its panel, a drag moves it (never the map). Not with a tool in
    // hand or while picking a deploy point: those clicks are for the tile.
    // A ship's hull is the one thing that wins over a flag: a squadron holds
    // the water around its flag and is drawn over it, and the flag's top
    // still shows above the hulls to be grabbed by.
    const r0 = this.app.renderer;
    const flag = this.tool || this.app.deploying ? 0 : r0.pickFlag(p.x, p.y);
    if (flag && !r0.pickShip?.(p.x, p.y, true)) {
      this.flag = { id: flag, sx: p.x, sy: p.y, lx: p.x, ly: p.y, moved: false, pointerId: e.pointerId };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    const t = this.tileAt(p);
    if (this.tool && dragMode(this.tool) !== 'single') {
      this.drag = { x0: t.x, y0: t.y, x1: t.x, y1: t.y, id: e.pointerId };
      this.refreshPlan();
    } else {
      // The walker under the pointer when the button goes down: by the
      // release a walker has moved on (half a tile in a click at 4x), and
      // picking it at the release point missed the one the player pressed on.
      const r = this.app.renderer;
      const walker = this.tool ? null : { strict: r.pickWalker(p.x, p.y, false), loose: r.pickWalker(p.x, p.y, true), unit: r.pickUnit(p.x, p.y) };
      this.press = { sx: p.x, sy: p.y, lx: p.x, ly: p.y, moved: false, id: e.pointerId, walker };
    }
  }

  /** Remember where the pointer is (canvas CSS px), menus up or not. */
  trackMouse(e) {
    const p = this.localPos(e);
    this.mouse.x = p.x;
    this.mouse.y = p.y;
    return p;
  }

  onMove(e) {
    const p = this.trackMouse(e);
    this.mouse.game = this.game; // a real move (null behind menus: no old game kept alive)
    if (!this.game) return;
    const prev = this.pointers.get(e.pointerId);
    if (prev) this.pointers.set(e.pointerId, p);
    const cam = this.app.renderer.camera;

    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      cam.panScreen(mid.x - this.pinch.mid.x, mid.y - this.pinch.mid.y);
      this.pinch.mid = mid;
      if (dist / this.pinch.dist > 1.3) { cam.zoomStep(1, mid.x, mid.y); this.pinch.dist = dist; }
      else if (dist / this.pinch.dist < 0.77) { cam.zoomStep(-1, mid.x, mid.y); this.pinch.dist = dist; }
      return;
    }
    if (this.pan && this.pan.id === e.pointerId) {
      const dx = p.x - this.pan.sx;
      const dy = p.y - this.pan.sy;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.pan.moved = true;
      this.dragPan(dx, dy, e);
      this.pan.sx = p.x;
      this.pan.sy = p.y;
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (this.flag && this.flag.pointerId === e.pointerId) {
      const f = this.flag;
      if (!f.moved && Math.hypot(p.x - f.sx, p.y - f.sy) > CLICK_SLOP) f.moved = true;
      f.lx = p.x;
      f.ly = p.y;
      f.over = this.overCanvas(e);
      if (f.moved) this.flagDragAt(p);
    } else if (!this.press && !this.pan && !this.drag && !this.tool && !this.app.deploying && !this.pinch && e.pointerType === 'mouse') {
      // An open hand over a rally flag says it can be picked up.
      const r = this.app.renderer;
      this.canvas.style.cursor = r.pickFlag(p.x, p.y) && !r.pickShip?.(p.x, p.y, true) ? 'grab' : 'crosshair';
    }
    if (this.press && this.press.id === e.pointerId) {
      if (!this.press.moved && Math.hypot(p.x - this.press.sx, p.y - this.press.sy) > CLICK_SLOP) this.press.moved = true;
      if (this.press.moved && !this.tool) {
        this.dragPan(p.x - this.press.lx, p.y - this.press.ly, e);
        this.canvas.style.cursor = 'grabbing';
      }
      this.press.lx = p.x;
      this.press.ly = p.y;
    }
    const t = this.tileAt(p);
    if (!this.hover || this.hover.x !== t.x || this.hover.y !== t.y) {
      this.hover = t;
      this.app.renderer.hoverTile = this.game.map.inBounds(t.x, t.y) ? t : null;
      if (this.drag) { this.drag.x1 = t.x; this.drag.y1 = t.y; }
      this.refreshPlan();
    }
  }

  onUp(e, cancelled = false) {
    const p = this.pointers.has(e.pointerId) ? this.localPos(e) : null;
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    if (this.flag && this.flag.pointerId === e.pointerId) {
      const f = this.flag;
      this.cancelFlag();
      if (cancelled || this.app.blockingModal()) return;
      if (!f.moved) { this.app.clickFlag(f.id); return; }
      // Let go over the sidebar or a panel: not on the map, so the flag
      // stays (the tile hidden under the panel is not what was aimed at).
      if (!this.overCanvas(e)) return;
      const t = this.tileAt(this.localPos(e));
      this.app.dropFlag(f.id, t.x, t.y);
      return;
    }
    if (this.pan && this.pan.id === e.pointerId) {
      const wasClick = !this.pan.moved;
      const button = this.pan.button;
      this.pan = null;
      if (!wasClick && !cancelled) this.release(e);
      this.canvas.style.cursor = this.tool ? 'cell' : 'crosshair';
      if (wasClick && button === 2 && !cancelled) this.app.rightClick();
      return;
    }
    if (this.drag && this.drag.id === e.pointerId) {
      const plan = cancelled ? null : this.app.renderer.plan;
      this.drag = null;
      if (plan) this.app.applyPlan(plan);
      this.planKey = '';
      this.refreshPlan();
      return;
    }
    if (this.press && this.press.id === e.pointerId) {
      const press = this.press;
      this.press = null;
      this.canvas.style.cursor = this.tool ? 'cell' : 'crosshair';
      if (cancelled || !p) return;
      if (this.tool) {
        // single-building tools place on release (unless it turned into a drag)
        if (!press.moved) {
          const plan = this.app.renderer.plan;
          if (plan) this.app.applyPlan(plan);
          this.planKey = '';
          this.refreshPlan();
        }
        return;
      }
      if (!press.moved) {
        const t = this.tileAt(p);
        this.app.clickTile(t.x, t.y, p, press.walker);
      } else {
        this.release(e);
      }
    }
  }

  onWheel(e) {
    e.preventDefault();
    if (!this.game) return;
    const p = this.localPos(e);
    // deltaMode 1 = lines (Firefox mouse wheels), 2 = pages; 0 = pixels.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const d = e.deltaY * unit;
    if (Math.sign(d) !== Math.sign(this.wheelAcc)) this.wheelAcc = 0; // direction changed
    this.wheelAcc += d;
    // A mouse notch zooms one level at once; small trackpad deltas add up.
    const step = Math.abs(d) >= WHEEL_STEP ? Math.sign(d) : Math.abs(this.wheelAcc) >= WHEEL_STEP ? Math.sign(this.wheelAcc) : 0;
    if (!step) return;
    this.wheelAcc = 0;
    this.app.renderer.camera.zoomStep(-step, p.x, p.y);
  }

  /**
   * A rally flag being dragged is over CSS point `p`: the renderer draws
   * its ghost on the map tile there (red where it cannot go).
   */
  flagDragAt(p) {
    const t = this.flag.over === false ? { x: -1, y: -1 } : this.tileAt(p); // (over a panel: no ghost)
    const d = this.app.renderer.flagDrag;
    if (d && d.id === this.flag.id && d.x === t.x && d.y === t.y) return;
    this.app.renderer.flagDrag = { id: this.flag.id, x: t.x, y: t.y };
  }

  /**
   * Is the pointer of event `e` over the game view itself, not over the
   * sidebar, a panel or a button on top of it? (Pointer capture sends the
   * events of a drag to the canvas wherever the pointer goes.)
   */
  overCanvas(e) {
    if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return true;
    return document.elementFromPoint(e.clientX, e.clientY) === this.canvas;
  }

  /** Drop a flag press or drag without moving the flag (pinch, Esc, pointer cancelled). */
  cancelFlag() {
    if (!this.flag) return;
    this.flag = null;
    this.app.renderer.flagDrag = null;
    this.canvas.style.cursor = this.tool ? 'cell' : 'crosshair';
  }

  /** Pan the camera by a drag delta and remember how fast the drag is going. */
  dragPan(dx, dy, e) {
    this.app.renderer.camera.panScreen(dx, dy);
    const t = e.timeStamp || performance.now();
    const dt = Math.max(4, t - this.flick.t) / 1000;
    const a = 0.4; // smoothing: recent motion counts most
    this.flick.vx = this.flick.vx * (1 - a) + (dx / dt) * a;
    this.flick.vy = this.flick.vy * (1 - a) + (dy / dt) * a;
    this.flick.t = t;
  }

  /** End of a drag: fling the map if the pointer was still moving. */
  release(e) {
    const t = e.timeStamp || performance.now();
    if (t - this.flick.t <= FLING_WINDOW_MS) this.app.renderer.camera.fling(this.flick.vx, this.flick.vy);
    this.flick = { vx: 0, vy: 0, t };
  }

  /** Recompute the construction preview for the current hover/drag. */
  refreshPlan() {
    const r = this.app.renderer;
    if (!this.tool || !this.game) {
      r.plan = null;
      this.app.ui.onPlanChanged(null);
      return;
    }
    let x0, y0, x1, y1;
    if (this.drag) ({ x0, y0, x1, y1 } = this.drag);
    else if (this.hover && this.mouse.over) { x0 = x1 = this.hover.x; y0 = y1 = this.hover.y; }
    else { r.plan = null; this.app.ui.onPlanChanged(null); return; }
    const turn = this.turnFor(this.tool);
    const auto = this.handTurned !== this.tool; // (the road may turn it: map.revision in the key covers new roads)
    // The clear tool also hangs on which forts and stations have men away
    // (sim/construction.js demolishBlocked): one whose men came home while
    // the cursor stood still is planned again at the next press.
    const away = this.tool === 'clear' ? [...postsAway(this.game)].join(',') : '';
    const key = `${this.tool}:${x0},${y0},${x1},${y1}:${this.game.map.revision}:${Math.floor(this.game.city.treasury)}:${turn}:${auto}:${away}`;
    if (key === this.planKey) return;
    this.planKey = key;
    try {
      r.plan = planAction(this.game, this.tool, x0, y0, x1, y1, turn, { auto });
      if (r.plan && r.plan.kind === 'building' && r.plan.tool === this.tool) this.lastShown = { tool: this.tool, turn: r.plan.turn, auto: !!r.plan.autoTurned };
    } catch (err) {
      this.app.log.error('Planning failed:', err);
      r.plan = null;
    }
    this.app.ui.onPlanChanged(r.plan);
  }

  // ---------------------------------------------------------------- keyboard
  onKeyDown(e) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Escape') e.target.blur();
      if (e.code === 'Backquote' && e.target.id === 'console-input') { e.preventDefault(); this.app.toggleConsole(); }
      return;
    }
    const a = this.app;
    const k = e.key;
    // Keys that work even with menus open.
    if (e.code === 'Backquote') { e.preventDefault(); a.toggleConsole(); return; }
    if (k === 'Escape' && this.flag) { e.preventDefault(); this.cancelFlag(); return; } // a flag being dragged goes back
    if (k === 'Escape') { e.preventDefault(); a.escape(); return; }
    if (k === 'F1') { e.preventDefault(); a.ui.openHelp(); return; }
    if (!a.game || a.blockingModal()) return;
    this.keys.add(e.code);
    if (k === 'F2') { e.preventDefault(); a.ui.openAdvisors(); return; }
    if (k === 'F3') { e.preventDefault(); a.toggleDebugHud(); return; }
    if (k === 'F5') { e.preventDefault(); a.quickSave(); return; }
    if (k === 'F9') { e.preventDefault(); a.quickLoad(); return; }
    if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) { e.preventDefault(); a.undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Shift+1..9: fort 1..9 (app.showFort). By the key's place (e.code), not
    // the character it types: Shift+1 is "!" on one keyboard and "1" on
    // another, and on those "1" must not also set the game speed.
    if (e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
      e.preventDefault();
      if (!e.repeat) a.showFort(Number(e.code.slice(5)));
      return;
    }
    // Game speed by the key's place too: on a keyboard whose top row types
    // "&" unshifted (AZERTY), Shift gave the digits and now shows forts.
    if (!e.shiftKey && /^Digit[1-4]$/.test(e.code)) { a.setSpeed(Number(e.code.slice(5))); return; }
    switch (k) {
      case ' ': case 'p': case 'P': e.preventDefault(); a.togglePause(); break;
      case '1': a.setSpeed(1); break;
      case '2': a.setSpeed(2); break;
      case '3': a.setSpeed(3); break;
      case '4': a.setSpeed(4); break;
      case 'h': case 'H': a.ui.selectTool('house'); break;
      case 'f': case 'F': if (!e.repeat) a.deployKey(); break; // held, it would flick deploy mode on and off
      case 'r': case 'R': this.onTurnKey(); break; // turn the building in hand, else the Road tool
      // The view: the city a quarter turn clockwise, or back. Once a press:
      // held, the key would spin the city at the keyboard's repeat rate.
      case 'q': case ']': if (!e.repeat) a.turnView(1); break;
      case 'Q': case '[': if (!e.repeat) a.turnView(-1); break;
      case 'x': case 'X': case 'Delete': a.ui.selectTool('clear'); break;
      case 'u': case 'U': a.undo(); break;
      case 'm': case 'M': a.toggleMusic(); break;
      case 'e': case 'E': if (!e.repeat) a.ui.toggleEmpire(); break; // holding E must not flicker it open and shut
      case ',': a.cycleKind(-1); break;
      case '.': a.cycleKind(1); break;
      case 'i': a.nextIdle(1); break;
      case 'I': a.nextIdle(-1); break;
      case 'o': a.cycleOverlay(1); break;
      case 'O': a.setOverlay('none'); break;
      case '+': case '=': this.app.renderer.camera.zoomStep(1); break;
      case '-': case '_': this.app.renderer.camera.zoomStep(-1); break;
      case 'Home': a.centerOnEntry(true); break;
      default: break;
    }
  }

  /** Per-frame: keyboard panning and edge scrolling. */
  update(dt) {
    if (!this.game || this.app.blockingModal()) return;
    const cam = this.app.renderer.camera;
    const speed = CONFIG.PAN_SPEED * dt;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) dx += speed;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) dx -= speed;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) dy += speed;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) dy -= speed;
    // Edge scrolling only after a real pointer move on this map (see this.mouse).
    if (this.app.settings.edgeScroll && this.mouse.over && this.mouse.game === this.game && !this.pan && !this.press && !this.flag) {
      const r = this.canvas.getBoundingClientRect();
      const m = CONFIG.EDGE_SCROLL_PX;
      if (this.mouse.x < m) dx += speed;
      else if (this.mouse.x > r.width - m) dx -= speed;
      if (this.mouse.y < m) dy += speed;
      else if (this.mouse.y > r.height - m) dy -= speed;
    }
    if (dx || dy) cam.panScreen(dx, dy);
    // The map moved (keys, a zoom) under a flag being dragged: its ghost
    // follows the tile now under the pointer.
    if (this.flag && this.flag.moved) this.flagDragAt({ x: this.flag.lx, y: this.flag.ly });
  }
}

/**
 * messages.js
 * ----------------------------------------------------------------------------
 * Toast notifications in the corner. Messages with a map location jump the
 * camera there when clicked; news of a warband or Caesar's legions still on
 * the way opens the empire map with it picked out. The full history lives in
 * game.messages and is shown in the Advisors > Messages tab. A sticky toast
 * (the auto-pause's "Paused: ..." note) stays until it is dismissed.
 * ----------------------------------------------------------------------------
 */

import { h } from './dom.js';

const MAX_VISIBLE = 4;
const LIFETIME_MS = 9000;

export class Messages {
  constructor(app, root) {
    this.app = app;
    this.el = h('div', { id: 'messages', role: 'status', 'aria-live': 'polite' });
    root.appendChild(this.el);
  }

  /** Show message `m`; returns its toast. `m.sticky`: no timer, it stays until dismiss(). */
  push(m) {
    const toast = h('div', {
      class: `toast ${m.level || 'info'}`,
      title: clickHint(m),
      onclick: () => {
        openMessage(this.app, m);
        toast.remove();
      },
    }, h('span', { class: 'date' }, m.date || ''), m.text);
    if (m.sticky) toast.classList.add('sticky');
    this.el.prepend(toast);
    // Too many: the oldest go, but never a sticky one (the auto-pause's note
    // must outlast the toasts of the overlay keys pressed while paused).
    while (this.el.children.length > MAX_VISIBLE) {
      const old = [...this.el.children].reverse().find((t) => !t.classList.contains('sticky'));
      if (!old) break;
      old.remove();
    }
    if (!m.sticky) setTimeout(() => this.dismiss(toast), m.level === 'bad' || m.level === 'imperial' ? LIFETIME_MS * 1.5 : LIFETIME_MS);
    return toast;
  }

  /** Fade a toast out (harmless if it is already gone). */
  dismiss(toast) {
    if (!toast || !toast.isConnected) return;
    toast.classList.add('fade');
    setTimeout(() => toast.remove(), 700);
  }

  clear() { this.el.replaceChildren(); }
}

/** The tooltip of a message: what a click on it does. */
export function clickHint(m) {
  if (m.empire) return 'Click to see it on the empire map';
  if (m.x !== undefined && m.x !== null) return 'Click to go there';
  return m.open ? 'Click to look' : '';
}

/**
 * A click on a message (a toast, or a line of the Messages tab): news of
 * something still on its way (`empire`, core/game.js message()) opens the
 * empire map with it picked out; else a message with a place glides there;
 * else one with an `open` function (a UI-only message: the auto-pause's
 * note about news with no place, which opens the Imperial advisor) calls it.
 * @returns {boolean} it went somewhere
 */
export function openMessage(app, m) {
  if (m.empire) { app.ui.openEmpire(m.empire); return true; }
  if (m.x === undefined || m.x === null) {
    if (typeof m.open !== 'function') return false;
    m.open(app);
    return true;
  }
  app.renderer.camera.glideToTile(m.x, m.y);
  return true;
}

/**
 * messages.js
 * ----------------------------------------------------------------------------
 * Toast notifications in the corner. Messages with a map location jump the
 * camera there when clicked; news of a warband or Caesar's legions still on
 * the way opens the empire map with it picked out. The full history lives in
 * game.messages and is shown in the Advisors > Messages tab.
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

  push(m) {
    const toast = h('div', {
      class: `toast ${m.level || 'info'}`,
      title: clickHint(m),
      onclick: () => {
        openMessage(this.app, m);
        toast.remove();
      },
    }, h('span', { class: 'date' }, m.date || ''), m.text);
    this.el.prepend(toast);
    while (this.el.children.length > MAX_VISIBLE) this.el.lastChild.remove();
    setTimeout(() => {
      toast.classList.add('fade');
      setTimeout(() => toast.remove(), 700);
    }, m.level === 'bad' || m.level === 'imperial' ? LIFETIME_MS * 1.5 : LIFETIME_MS);
  }

  clear() { this.el.replaceChildren(); }
}

/** The tooltip of a message: what a click on it does. */
export function clickHint(m) {
  if (m.empire) return 'Click to see it on the empire map';
  return m.x !== undefined && m.x !== null ? 'Click to go there' : '';
}

/**
 * A click on a message (a toast, or a line of the Messages tab): news of
 * something still on its way (`empire`, core/game.js message()) opens the
 * empire map with it picked out; else a message with a place glides there.
 * @returns {boolean} it went somewhere
 */
export function openMessage(app, m) {
  if (m.empire) { app.ui.openEmpire(m.empire); return true; }
  if (m.x === undefined || m.x === null) return false;
  app.renderer.camera.glideToTile(m.x, m.y);
  return true;
}

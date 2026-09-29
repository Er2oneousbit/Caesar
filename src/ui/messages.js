/**
 * messages.js
 * ----------------------------------------------------------------------------
 * Toast notifications in the corner. Messages with a map location jump the
 * camera there when clicked. The full history lives in game.messages and is
 * shown in the Advisors > Messages tab.
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
      title: m.x !== undefined ? 'Click to go there' : '',
      onclick: () => {
        if (m.x !== undefined) this.app.renderer.camera.centerOnTile(m.x, m.y);
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

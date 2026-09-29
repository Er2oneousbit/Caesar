/**
 * dom.js
 * ----------------------------------------------------------------------------
 * Tiny helpers for building DOM without a framework.
 *
 *   h('div', { class: 'card', onclick: fn }, 'text', childNode, [more, kids])
 *
 * Props: `class`, `style` (object or string), `on*` event handlers, `dataset`
 * (object), any other key becomes an attribute (or a property for value /
 * checked / disabled / selected). Children may be strings, numbers, nodes,
 * arrays, or null/false (skipped).
 * ----------------------------------------------------------------------------
 */

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else if (k === 'html') el.innerHTML = v; // only ever used with trusted static strings
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

/** Replace all children of an element. */
export function mount(el, ...children) {
  el.replaceChildren();
  appendChildren(el, children);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

/** 12345 -> "12,345" */
export function fmt(n) {
  if (!Number.isFinite(n)) return '0';
  return Math.round(n).toLocaleString('en-US');
}

/** Money with the Dn suffix. */
export function money(n) { return `${fmt(n)} Dn`; }

/** 0.1234 -> "12%" */
export function pct(x) { return `${Math.round((x || 0) * 100)}%`; }

/** A progress bar element. */
export function bar(value, max = 1, cls = '') {
  const p = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  return h('div', { class: `bar ${cls}` }, h('i', { style: { width: `${(p * 100).toFixed(1)}%` } }));
}

/** Key/value row. */
export function kv(k, v, cls = '') {
  return h('div', { class: `kv ${cls}` }, h('span', { class: 'muted' }, k), h('span', { class: 'num' }, v));
}

/** Clamp helper for sliders. */
export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

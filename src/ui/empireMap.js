/**
 * empireMap.js
 * ----------------------------------------------------------------------------
 * The little map at the top of the Trade advisor: a stylized inland sea with
 * your province and every trade partner of the scenario.
 *
 *   land route  dashed brown line curving over land (caravans on the road)
 *   sea route   dotted blue line arcing across the water (merchant ships)
 *   open routes are drawn solid and bold, closed ones faint
 *
 * All shapes are drawn in a 100 x 60 "map unit" space and scaled to the
 * canvas. Original, hand-placed shapes (not a real map trace).
 * ----------------------------------------------------------------------------
 */

import { h } from './dom.js';
import { TRADE_PARTNERS, HOME_POS } from '../data/scenarios.js';
import { routeKind } from '../sim/trade.js';

const W = 100;
const H = 60;

/** Coastline of the stylized sea, clockwise from the western strait. */
const SEA = [
  [0, 33], [6, 31], [12, 30], [18, 27], [24, 23], [30, 21], [36, 22], [41, 24], [45, 27], [49, 31], [53, 36],
  [57, 33], [60, 28], [58, 20], [56, 12], [60, 12], [64, 20], [68, 26], [72, 28], [74, 34], [78, 32], [82, 28],
  [86, 32], [90, 30], [96, 34], [100, 38], [100, 46], [94, 48], [84, 48], [76, 47], [68, 46], [60, 48], [54, 44],
  [50, 40], [46, 40], [42, 43], [34, 45], [24, 44], [14, 42], [6, 38], [0, 38],
];

/** Some islands so the sea does not look empty. */
const ISLANDS = [
  [[44, 33], [46, 32], [47, 35], [45, 36]], // big island west of the toe
  [[40, 30], [41.5, 29.5], [42, 32], [40.5, 32.5]],
  [[82, 40], [86, 39.5], [85, 41], [81.5, 41]],
  [[66, 38], [67, 37.5], [67.5, 38.6], [66.4, 39]],
];

/**
 * Canvas element with the empire map for the current game.
 * @param {object} game
 * @param {number} [cssWidth] display width in CSS px (height follows 100:60)
 */
export function empireMapCanvas(game, cssWidth = 640) {
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const cssHeight = Math.round((cssWidth * H) / W);
  const canvas = h('canvas', {
    class: 'empire-map',
    width: Math.round(cssWidth * dpr),
    height: Math.round(cssHeight * dpr),
    role: 'img',
    'aria-label': 'Map of trade routes: your province and its trading partners by land and sea',
  });
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const s = (cssWidth * dpr) / W; // px per map unit
  ctx.scale(s, s);
  drawBase(ctx);
  const routes = game.city.trade.routes;
  const home = HOME_POS;
  const seaOk = !!game.map.seaEntry;
  // routes first, cities on top
  for (const [id, r] of Object.entries(routes)) {
    const p = TRADE_PARTNERS[id];
    if (!p) continue;
    const sea = routeKind(id) === 'sea';
    drawRoute(ctx, home, p.pos, sea, r.open, sea && !seaOk);
  }
  for (const [id, r] of Object.entries(routes)) {
    const p = TRADE_PARTNERS[id];
    if (!p) continue;
    drawCity(ctx, p.pos, p.name, p.color, r.open, false);
  }
  drawCity(ctx, home, game.city.name || 'Your province', '#a8322b', true, true);
  return canvas;
}

function drawBase(ctx) {
  // parchment land
  ctx.fillStyle = '#e3d3ac';
  ctx.fillRect(0, 0, W, H);
  // a few faint hills
  ctx.fillStyle = 'rgba(150,120,70,0.18)';
  for (const [x, y] of [[20, 10], [40, 12], [70, 10], [88, 18], [30, 54], [70, 56], [12, 50]]) {
    ctx.beginPath();
    ctx.moveTo(x - 3, y + 1.5);
    ctx.lineTo(x, y - 1.5);
    ctx.lineTo(x + 3, y + 1.5);
    ctx.fill();
  }
  // sea with a soft shore line
  smoothPath(ctx, SEA);
  ctx.fillStyle = '#8fb8d6';
  ctx.fill();
  ctx.lineWidth = 0.45;
  ctx.strokeStyle = '#5f86a6';
  ctx.stroke();
  for (const isl of ISLANDS) {
    smoothPath(ctx, isl);
    ctx.fillStyle = '#e3d3ac';
    ctx.fill();
    ctx.lineWidth = 0.3;
    ctx.strokeStyle = '#5f86a6';
    ctx.stroke();
  }
  // compass
  ctx.fillStyle = '#6b5a3a';
  ctx.font = '2.4px serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', 96, 4.5);
  ctx.beginPath();
  ctx.moveTo(96, 5.5); ctx.lineTo(95, 9); ctx.lineTo(97, 9);
  ctx.fill();
  // frame
  ctx.strokeStyle = '#8a6a44';
  ctx.lineWidth = 0.6;
  ctx.strokeRect(0.3, 0.3, W - 0.6, H - 0.6);
}

/** Closed curve through the midpoints of a polygon's edges (rounded coast). */
function smoothPath(ctx, pts) {
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  ctx.beginPath();
  const m0 = mid(pts[n - 1], pts[0]);
  ctx.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const m = mid(p, pts[(i + 1) % n]);
    ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  ctx.closePath();
}

function drawRoute(ctx, a, b, sea, open, blocked) {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  // Sea routes bow out over the water (south), land routes over the land (north).
  const cx = mx;
  const cy = sea ? Math.max(my + 6, 37) : Math.max(2, my - 7);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.quadraticCurveTo(cx, cy, b[0], b[1]);
  ctx.lineCap = 'round';
  if (sea) {
    ctx.setLineDash(open ? [] : [0.3, 1.2]);
    ctx.strokeStyle = blocked ? 'rgba(120,120,120,0.6)' : open ? '#1f5f99' : 'rgba(31,95,153,0.75)';
  } else {
    ctx.setLineDash(open ? [] : [1.6, 1.1]);
    ctx.strokeStyle = open ? '#7a4a1e' : 'rgba(122,74,30,0.7)';
  }
  ctx.lineWidth = open ? 0.75 : 0.45;
  ctx.stroke();
  ctx.setLineDash([]);
  if (sea && !blocked) {
    // a tiny sail halfway along the curve
    const t = 0.5;
    const x = (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * cx + t * t * b[0];
    const y = (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * cy + t * t * b[1];
    ctx.fillStyle = open ? '#f4efe2' : 'rgba(244,239,226,0.7)';
    ctx.beginPath();
    ctx.moveTo(x, y - 1.6); ctx.lineTo(x + 1.1, y); ctx.lineTo(x - 0.2, y);
    ctx.fill();
    ctx.fillStyle = '#5e3b20';
    ctx.fillRect(x - 1, y, 2.2, 0.5);
  }
}

function drawCity(ctx, pos, name, color, open, home) {
  const [x, y] = pos;
  ctx.fillStyle = home ? '#a8322b' : open ? color : '#8f8676';
  ctx.strokeStyle = '#2a241c';
  ctx.lineWidth = 0.25;
  ctx.beginPath();
  if (home) {
    // a little star for your province
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? 0.9 : 2;
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  } else {
    ctx.arc(x, y, 1.1, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  ctx.font = `${home ? 'bold ' : ''}2.3px serif`;
  ctx.textAlign = 'center';
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = 'rgba(243,234,210,0.9)';
  ctx.strokeText(name, x, y - 2.2);
  ctx.fillStyle = '#2a241c';
  ctx.fillText(name, x, y - 2.2);
}

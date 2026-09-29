/**
 * walkerArt.js
 * ----------------------------------------------------------------------------
 * Draws walkers (little citizens) directly each frame. They are tiny, so a
 * handful of shapes per figure is enough: shadow, legs, tunic, head, and an
 * item that tells the player what job they do (bucket = prefect, cart = cart
 * pusher, scroll = teacher...). Original simple figures.
 * ----------------------------------------------------------------------------
 */

import { WALKER_TYPES } from '../data/walkers.js';
import { GOODS } from '../data/goods.js';
import { GODS } from '../data/gods.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';

const SKIN = ['#e3b68c', '#c99a6b', '#a8784e', '#f0caa2', '#b98a5e'];
const HAIR = ['#3a2a1e', '#5a3a22', '#1e1a16', '#7a5a3a', '#9a8a7a'];

/**
 * Draw one walker.
 * @param {CanvasRenderingContext2D} ctx  (identity transform, device pixels)
 * @param {object} w      walker
 * @param {number} sx,sy  feet position in device px
 * @param {number} k      scale (zoom * dpr)
 * @param {number} t      animation time in seconds
 * @param {number} dirX   screen-space movement direction sign (-1 left, 1 right)
 * @param {number} dirY   screen-space vertical direction sign (-1 up, 1 down)
 */
export function drawWalker(ctx, w, sx, sy, k, t, dirX, dirY) {
  const def = WALKER_TYPES[w.type];
  if (def.kind === 'ship') { drawShip(ctx, w, sx, sy, k, t, dirX); return; }
  const moving = w.moving;
  const phase = moving ? Math.sin((t * 9 + w.anim) * 1.0) : 0;
  const face = dirX < 0 ? -1 : 1;
  const tunic = w.type === 'priest' && w.god ? GODS[w.god].color : def.tunic;
  const skin = SKIN[w.id % SKIN.length];

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, 4.2 * k, 1.8 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  // a little bounce in each step (the shadow stays on the ground)
  if (moving) sy -= Math.abs(Math.sin((t * 9 + w.anim) * 1.0)) * 0.8 * k;

  const item = w.mule ? 'mule' : def.item; // settlers on a long trip lead a pack mule
  if (item === 'cart') drawCart(ctx, w, sx + face * 7 * k, sy + dirY * 1.5 * k, k, face, phase);
  if (item === 'mule') drawMule(ctx, sx + face * 8 * k, sy + dirY * 1.5 * k, k, face, phase);

  // legs
  ctx.strokeStyle = '#4a3a2c';
  ctx.lineWidth = 1.3 * k;
  ctx.beginPath();
  ctx.moveTo(sx - 1 * k, sy - 5 * k);
  ctx.lineTo(sx - 1 * k + phase * 1.8 * k, sy - 0.5 * k);
  ctx.moveTo(sx + 1 * k, sy - 5 * k);
  ctx.lineTo(sx + 1 * k - phase * 1.8 * k, sy - 0.5 * k);
  ctx.stroke();

  // bundle on the back
  if (item === 'bundle') {
    ctx.fillStyle = '#8a6a44';
    ctx.beginPath();
    ctx.ellipse(sx - face * 3 * k, sy - 10 * k, 3 * k, 3.4 * k, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // tunic
  ctx.fillStyle = tunic;
  ctx.beginPath();
  ctx.moveTo(sx - 2.6 * k, sy - 12.5 * k);
  ctx.lineTo(sx + 2.6 * k, sy - 12.5 * k);
  ctx.lineTo(sx + 3.3 * k, sy - 4.5 * k);
  ctx.lineTo(sx - 3.3 * k, sy - 4.5 * k);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(sx - 3 * k, sy - 8 * k, 6 * k, 1 * k); // belt

  // arms
  ctx.strokeStyle = skin;
  ctx.lineWidth = 1.1 * k;
  ctx.beginPath();
  ctx.moveTo(sx + face * 2.4 * k, sy - 11.5 * k);
  ctx.lineTo(sx + face * (3.5 + (item === 'cart' ? 2 : 0)) * k, sy - (item === 'cart' ? 9 : 7.5 - phase) * k);
  ctx.stroke();

  // head + hair
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(sx, sy - 15 * k, 2.4 * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = HAIR[(w.id >> 2) % HAIR.length];
  ctx.beginPath();
  ctx.arc(sx, sy - 15.8 * k, 2.4 * k, Math.PI, 0);
  ctx.fill();

  drawItem(ctx, w, item, sx, sy, k, face);
}

function drawItem(ctx, w, item, sx, sy, k, face) {
  const hx = sx + face * 4 * k;
  const hy = sy - 7 * k;
  switch (item) {
    case 'bucket':
      ctx.fillStyle = '#7a5a3a';
      ctx.fillRect(hx - 1.5 * k, hy - 1 * k, 3 * k, 3 * k);
      ctx.fillStyle = '#6fb0e0';
      ctx.fillRect(hx - 1.5 * k, hy - 1.2 * k, 3 * k, 0.9 * k);
      break;
    case 'hammer':
      ctx.fillStyle = '#6b4a2a';
      ctx.fillRect(hx - 0.4 * k, hy - 4 * k, 0.8 * k, 5 * k);
      ctx.fillStyle = '#777';
      ctx.fillRect(hx - 1.6 * k, hy - 4.5 * k, 3.2 * k, 1.4 * k);
      break;
    case 'staff':
      ctx.strokeStyle = '#8a6a44';
      ctx.lineWidth = 0.8 * k;
      ctx.beginPath();
      ctx.moveTo(hx, sy);
      ctx.lineTo(hx, sy - 18 * k);
      ctx.stroke();
      break;
    case 'scroll':
      ctx.fillStyle = '#efe3bd';
      ctx.fillRect(hx - 1.5 * k, hy - 1.5 * k, 3 * k, 2 * k);
      break;
    case 'bag':
      ctx.fillStyle = '#5a3a22';
      ctx.fillRect(hx - 1.5 * k, hy - 0.5 * k, 3 * k, 2.4 * k);
      break;
    case 'towel':
      ctx.fillStyle = '#f5f5f0';
      ctx.fillRect(sx - 2.6 * k, sy - 12.5 * k, 2 * k, 5 * k);
      break;
    case 'mask':
      ctx.fillStyle = '#f2e6c8';
      ctx.beginPath();
      ctx.arc(hx, hy - 1 * k, 1.8 * k, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'purse':
      ctx.fillStyle = '#d6ab3c';
      ctx.beginPath();
      ctx.arc(hx, hy + 0.5 * k, 1.5 * k, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'basket': {
      const load = w.load ? Object.keys(w.load)[0] : null;
      ctx.fillStyle = '#a0703c';
      ctx.beginPath();
      ctx.ellipse(sx, sy - 18.5 * k, 3.4 * k, 1.8 * k, 0, 0, Math.PI * 2);
      ctx.fill();
      if (load) {
        ctx.fillStyle = GOODS[load]?.color || '#e4c35a';
        ctx.beginPath();
        ctx.ellipse(sx, sy - 19.5 * k, 2.6 * k, 1.3 * k, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    default:
      break;
  }
}

function drawCart(ctx, w, cx, cy, k, face, phase) {
  // two-wheeled hand cart with a load colored by its cargo
  ctx.fillStyle = '#7a5a3a';
  ctx.fillRect(cx - 4 * k, cy - 7 * k, 8 * k, 3 * k);
  if (w.cargo && w.cargo.amount > 0) {
    const color = GOODS[w.cargo.good]?.color || '#c9a86b';
    ctx.fillStyle = color;
    ctx.fillRect(cx - 3.5 * k, cy - 10 * k, 7 * k, 3.2 * k);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(cx - 3.5 * k, cy - 7.6 * k, 7 * k, 0.8 * k);
  }
  ctx.fillStyle = '#3a2a1e';
  ctx.beginPath();
  ctx.arc(cx, cy - 2.2 * k, 2.2 * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#a08060';
  ctx.lineWidth = 0.5 * k;
  ctx.beginPath();
  const a = phase * 1.5;
  ctx.moveTo(cx + Math.cos(a) * 2 * k, cy - 2.2 * k + Math.sin(a) * 2 * k);
  ctx.lineTo(cx - Math.cos(a) * 2 * k, cy - 2.2 * k - Math.sin(a) * 2 * k);
  ctx.stroke();
}

function drawMule(ctx, cx, cy, k, face, phase) {
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, 6 * k, 2 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#5a4230';
  ctx.lineWidth = 1.2 * k;
  ctx.beginPath();
  for (const lx of [-3.5, -1.5, 2, 4]) {
    ctx.moveTo(cx + lx * k, cy - 5 * k);
    ctx.lineTo(cx + (lx + phase * (lx > 0 ? 1 : -1)) * k, cy);
  }
  ctx.stroke();
  ctx.fillStyle = '#7a5f48';
  ctx.beginPath();
  ctx.ellipse(cx, cy - 7 * k, 6 * k, 3 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + face * 6.5 * k, cy - 10 * k, 2 * k, 1.6 * k, face * -0.5, 0, Math.PI * 2);
  ctx.fill();
  // packs
  ctx.fillStyle = '#c9a86b';
  ctx.fillRect(cx - 4 * k, cy - 11 * k, 7 * k, 3.5 * k);
  ctx.fillStyle = '#9b5a3a';
  ctx.fillRect(cx - 3 * k, cy - 13 * k, 5 * k, 2 * k);
}

/**
 * Merchant ship: a round-bellied hull, one mast and a square sail striped in
 * the trading partner's color. The sail is furled while tied up at a dock.
 */
function drawShip(ctx, w, sx, sy, k0, t, dirX) {
  const k = k0 * 1.4; // ships are drawn larger than people
  const f = dirX < 0 ? -1 : 1;
  const y = sy + Math.sin(t * 2 + w.id) * 0.8 * k; // gentle bobbing
  const X = (dx) => sx + dx * f * k;
  const Y = (dy) => y + dy * k;
  const color = TRADE_PARTNERS[w.partner]?.color || '#c0392b';
  // wake
  ctx.fillStyle = 'rgba(235,245,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + 1 * k, 18 * k, 3.6 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  // hull
  ctx.fillStyle = '#5e3b20';
  ctx.beginPath();
  ctx.moveTo(X(-15), Y(-8));
  ctx.lineTo(X(12), Y(-7));
  ctx.lineTo(X(18), Y(-12));
  ctx.lineTo(X(15), Y(-3));
  ctx.lineTo(X(8), Y(0));
  ctx.lineTo(X(-10), Y(0));
  ctx.lineTo(X(-16), Y(-5));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8a6a44'; // deck rail
  ctx.fillRect(Math.min(X(-14), X(12)), Y(-8.2), 26 * k, 1.4 * k);
  ctx.fillStyle = color; // painted band
  ctx.fillRect(Math.min(X(-12), X(10)), Y(-5), 22 * k, 1.2 * k);
  // steering oar at the stern
  ctx.strokeStyle = '#3a2618';
  ctx.lineWidth = 1 * k;
  ctx.beginPath(); ctx.moveTo(X(-13), Y(-9)); ctx.lineTo(X(-17), Y(1)); ctx.stroke();
  // mast and yard
  ctx.fillStyle = '#4a3222';
  ctx.fillRect(X(-1) - 0.6 * k, Y(-32), 1.2 * k, 24 * k);
  ctx.fillRect(Math.min(X(-10), X(8)), Y(-29), 18 * k, 1.1 * k);
  if (w.state === 'docked') {
    // furled sail on the yard
    ctx.fillStyle = '#efe6d0';
    ctx.fillRect(Math.min(X(-9), X(7)), Y(-28), 16 * k, 2.2 * k);
  } else {
    // full sail, bellied toward the bow, with a stripe in the partner's color
    ctx.fillStyle = '#efe6d0';
    ctx.beginPath();
    ctx.moveTo(X(-9), Y(-28));
    ctx.lineTo(X(7), Y(-28));
    ctx.quadraticCurveTo(X(10), Y(-20), X(7), Y(-12));
    ctx.lineTo(X(-9), Y(-12));
    ctx.quadraticCurveTo(X(-6), Y(-20), X(-9), Y(-28));
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(Math.min(X(-8), X(8)), Y(-22), 16 * k, 3 * k);
  }
  // pennant
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(X(-1), Y(-32));
  ctx.lineTo(X(-1) - f * 6 * k, Y(-31) + Math.sin(t * 4) * k);
  ctx.lineTo(X(-1), Y(-30));
  ctx.fill();
}

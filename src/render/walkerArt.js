/**
 * walkerArt.js
 * ----------------------------------------------------------------------------
 * Draws walkers (little citizens) directly each frame. They are tiny, so a
 * handful of shapes per figure is enough: shadow, legs, tunic, head, and an
 * item that tells the player what job they do (bucket = prefect, cart = cart
 * pusher, scroll = teacher...). Criminals: a protester shakes a placard, a
 * hooded thief carries a sack, a rioter waves a torch. Original simple figures.
 *
 * Carts show what they carry and how much (cargoArt.js); a farm's wagon is
 * bigger and pulled by an ox; horses are led on a rope, not carted. A
 * caravan's mules carry packs of the goods it bought on their way out.
 * ----------------------------------------------------------------------------
 */

import { WALKER_TYPES } from '../data/walkers.js';
import { GOODS } from '../data/goods.js';
import { GODS } from '../data/gods.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';
import { cartCapacity, isWagon, cargoLevel, horsesLed, drawCargo, LED_GOODS } from './cargoArt.js';
import { chariotBody } from './hippodromeArt.js';

const SKIN = ['#e3b68c', '#c99a6b', '#a8784e', '#f0caa2', '#b98a5e'];
const HAIR = ['#3a2a1e', '#5a3a22', '#1e1a16', '#7a5a3a', '#9a8a7a'];
// Walk cycle: 0.8 leg swings per tile walked, about 1.6 steps a tile (2 steps
// a second at 1x). 0.8 x STRIDE_WRAP (100) is whole, so w.walked's wrap never shows.
const STEP_RAD = Math.PI * 2 * 0.8;

/**
 * Draw one walker.
 * @param {CanvasRenderingContext2D} ctx  (identity transform, device pixels)
 * @param {object} w      walker
 * @param {number} sx,sy  feet position in device px
 * @param {number} k      scale (zoom * dpr)
 * @param {number} t      animation time in seconds
 * @param {number} dirX   screen-space movement direction sign (-1 left, 1 right)
 * @param {number} dirY   screen-space vertical direction sign (-1 up, 1 down)
 * @param {number} [stride] tiles walked (interpolated): drives the legs
 * @param {object|null} [origin] def of the building that sent a cart: how
 *        much the cart holds, and whether it is a farm wagon
 */
export function drawWalker(ctx, w, sx, sy, k, t, dirX, dirY, stride = w.walked || 0, origin = null) {
  const def = WALKER_TYPES[w.type];
  if (w.type === 'fishing_boat') { drawFishingBoat(ctx, w, sx, sy, k, t, dirX); return; }
  if (def.kind === 'ship') { drawShip(ctx, w, sx, sy, k, t, dirX); return; }
  const moving = w.moving;
  // Legs step with the distance walked, so they match the ground speed at any
  // game speed and stand still while paused.
  const step = stride * STEP_RAD + w.anim;
  const phase = moving ? Math.sin(step) : 0;
  const face = dirX < 0 ? -1 : 1;
  // A charioteer drives: the hippodrome's through the streets, a chariot
  // maker's team on its way to the races.
  if (def.item === 'chariot' || (w.type === 'performer' && w.venue === 'hippodrome')) {
    drawChariot(ctx, sx, sy, k, face, phase, def.tunic && w.type === 'charioteer' ? def.tunic : '#b8573a', w.id);
    return;
  }
  const tunic = w.type === 'priest' && w.god ? GODS[w.god].color : def.tunic;
  const skin = SKIN[w.id % SKIN.length];
  const item = w.mule ? 'mule' : def.item;
  const riding = !!w.mule; // settlers from far away ride in on a mule (merchants lead theirs)

  if (riding) {
    // The mule carries the rider and the packs; the rider sits on its back.
    drawMule(ctx, sx, sy + dirY * 0.5 * k, k, face, phase, true);
    sy -= 5.5 * k + (moving ? Math.abs(Math.sin(step)) * 0.6 * k : 0);
  } else {
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, 4.2 * k, 1.8 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    // a little bounce in each step (the shadow stays on the ground)
    if (moving) sy -= Math.abs(Math.sin(step)) * 0.8 * k;
  }

  // A carter with horses on board leads them on a rope instead of pushing a
  // cart, and a ranch's drover walks home with just the rope (not a wagon).
  const loaded = !!(w.cargo && w.cargo.amount > 0);
  const leading = item === 'cart' && (loaded ? LED_GOODS.includes(w.cargo.good) : LED_GOODS.includes(origin?.produces));
  if (leading) drawLedHorses(ctx, sx, sy, k, face, dirY, phase, loaded ? horsesLed(w.cargo.amount) : 0, w.id);
  else if (item === 'cart') drawCart(ctx, w, sx, sy, k, face, dirY, phase, cartCapacity(origin, w.cargo?.amount), isWagon(origin));
  if (item === 'mule' && !riding) drawMule(ctx, sx + face * 8 * k, sy + dirY * 1.5 * k, k, face, phase, false, w.packs);

  // legs: striding, or astride the mule
  ctx.strokeStyle = '#4a3a2c';
  ctx.lineWidth = 1.3 * k;
  ctx.beginPath();
  if (riding) {
    ctx.moveTo(sx - 1 * k, sy - 5 * k);
    ctx.lineTo(sx - 0.5 * k + face * 1.2 * k, sy - 1.5 * k);
    ctx.moveTo(sx + 1 * k, sy - 5 * k);
    ctx.lineTo(sx + 1.5 * k + face * 1.2 * k, sy - 1.5 * k);
  } else {
    ctx.moveTo(sx - 1 * k, sy - 5 * k);
    ctx.lineTo(sx - 1 * k + phase * 1.8 * k, sy - 0.5 * k);
    ctx.moveTo(sx + 1 * k, sy - 5 * k);
    ctx.lineTo(sx + 1 * k - phase * 1.8 * k, sy - 0.5 * k);
  }
  ctx.stroke();

  // a thief's loot sack over the shoulder, behind him
  if (item === 'sack') {
    ctx.fillStyle = '#6e5a3e';
    ctx.beginPath();
    ctx.ellipse(sx - face * 3.2 * k, sy - 10.5 * k, 2.6 * k, 3 * k, face * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // bundle on the back
  if (item === 'bundle' && !riding) {
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

  // arms (protesters and rioters raise theirs: a placard, a torch)
  const raised = item === 'placard' || item === 'torch';
  const wave = raised ? Math.sin(t * (item === 'torch' ? 7 : 4) + w.id) : 0; // visual only
  ctx.strokeStyle = skin;
  ctx.lineWidth = 1.1 * k;
  ctx.beginPath();
  if (leading) {
    // the rope hand reaches back to the horses following him
    ctx.moveTo(sx - face * 2.4 * k, sy - 11.5 * k);
    ctx.lineTo(sx - face * 4 * k, sy - 8 * k);
  } else {
    ctx.moveTo(sx + face * 2.4 * k, sy - 11.5 * k);
    if (raised) ctx.lineTo(sx + face * (3.6 + wave * 0.5) * k, sy - (16 + wave) * k);
    // a carter holds the back of his cart's bed
    else if (item === 'cart') ctx.lineTo(sx + face * 4.8 * k, sy - 8.2 * k);
    else ctx.lineTo(sx + face * 3.5 * k, sy - (7.5 - phase) * k);
  }
  ctx.stroke();

  // head + hair
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(sx, sy - 15 * k, 2.4 * k, 0, Math.PI * 2);
  ctx.fill();
  if (item === 'sack') {
    // a thief keeps his hood up
    ctx.fillStyle = def.tunic;
    ctx.beginPath();
    ctx.arc(sx, sy - 15.4 * k, 2.8 * k, Math.PI * 0.95, Math.PI * 2.05);
    ctx.fill();
  } else {
    ctx.fillStyle = HAIR[(w.id >> 2) % HAIR.length];
    ctx.beginPath();
    ctx.arc(sx, sy - 15.8 * k, 2.4 * k, Math.PI, 0);
    ctx.fill();
  }

  drawItem(ctx, w, item, sx, sy, k, face, wave, t);
}

function drawItem(ctx, w, item, sx, sy, k, face, wave = 0, t = 0) {
  const hx = sx + face * 4 * k;
  const hy = sy - 7 * k;
  switch (item) {
    case 'placard': {
      // a board on a pole, shaken at the street
      const px = sx + face * (3.6 + wave * 0.5) * k;
      const py = sy - (16 + wave) * k;
      ctx.strokeStyle = '#6b4a2a';
      ctx.lineWidth = 0.8 * k;
      ctx.beginPath();
      ctx.moveTo(px, py + 3 * k);
      ctx.lineTo(px, py - 6 * k);
      ctx.stroke();
      ctx.fillStyle = '#e8dcc0';
      ctx.fillRect(px - 3.2 * k, py - 10.5 * k, 6.4 * k, 4.6 * k);
      ctx.fillStyle = '#9b2d20'; // a daubed slogan
      ctx.fillRect(px - 2.2 * k, py - 9.2 * k, 4.4 * k, 0.7 * k);
      ctx.fillRect(px - 2.2 * k, py - 7.7 * k, 3 * k, 0.7 * k);
      break;
    }
    case 'torch': {
      const px = sx + face * (3.6 + wave * 0.5) * k;
      const py = sy - (16 + wave) * k;
      ctx.strokeStyle = '#5a3a22';
      ctx.lineWidth = 1 * k;
      ctx.beginPath();
      ctx.moveTo(px, py + 2 * k);
      ctx.lineTo(px, py - 3 * k);
      ctx.stroke();
      const flick = 1 + 0.25 * Math.sin(t * 23 + w.id * 3);
      ctx.fillStyle = 'rgba(255,170,40,0.95)';
      ctx.beginPath();
      ctx.ellipse(px, py - 4.6 * k, 1.6 * k, 2.4 * k * flick, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,240,160,0.95)';
      ctx.beginPath();
      ctx.ellipse(px, py - 4.2 * k, 0.8 * k, 1.3 * k * flick, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
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

/**
 * A two-wheeled hand cart pushed ahead of the carter or, for a farm's
 * (`wagon`), a longer four-wheeled wagon with an ox in the shafts. The load sits on the bed (cargoArt.js); an empty cart shows
 * the inside of its bed.
 */
function drawCart(ctx, w, sx, sy, k, face, dirY, phase, cap, wagon) {
  const hw = wagon ? 5.5 : 4; // half the bed's length
  const cx = sx + face * (hw + 4.5) * k; // the bed's back edge just past his hands
  const cy = sy + dirY * 1.5 * k;
  if (wagon) drawOx(ctx, cx + face * (hw + 7) * k, cy, k, face, phase, cx + face * hw * k);
  const amount = w.cargo ? w.cargo.amount : 0;
  ctx.fillStyle = '#7a5a3a';
  ctx.fillRect(cx - hw * k, cy - 7 * k, 2 * hw * k, 3 * k);
  if (amount > 0) {
    drawCargo(ctx, w.cargo.good, cargoLevel(amount, cap), cx, cy - 7 * k, k, face, hw);
  } else {
    ctx.fillStyle = '#4e3826'; // the inside of an empty bed
    ctx.fillRect(cx - (hw - 0.7) * k, cy - 7 * k, 2 * (hw - 0.7) * k, 1 * k);
  }
  ctx.fillStyle = '#5e4430'; // side board
  ctx.fillRect(cx - hw * k, cy - 5.2 * k, 2 * hw * k, 0.6 * k);
  // Wheels: a wagon shows two, a hand cart one, each with a turning spoke.
  const r = wagon ? 2.5 : 2.2;
  const a = phase * 1.5;
  for (const wx of wagon ? [cx - hw * 0.55 * k, cx + hw * 0.55 * k] : [cx]) {
    ctx.fillStyle = '#3a2a1e';
    ctx.beginPath();
    ctx.arc(wx, cy - r * k, r * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#a08060';
    ctx.lineWidth = 0.5 * k;
    ctx.beginPath();
    ctx.moveTo(wx + Math.cos(a) * (r - 0.2) * k, cy - r * k + Math.sin(a) * (r - 0.2) * k);
    ctx.lineTo(wx - Math.cos(a) * (r - 0.2) * k, cy - r * k - Math.sin(a) * (r - 0.2) * k);
    ctx.stroke();
  }
}

/** The ox in a farm wagon's shafts; `poleX` is where the shaft meets the bed. */
function drawOx(ctx, cx, cy, k, face, phase, poleX) {
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, 6 * k, 2 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#5a4634';
  ctx.lineWidth = 1.4 * k;
  ctx.beginPath();
  for (const lx of [-3.5, -1.8, 2, 3.8]) {
    ctx.moveTo(cx + face * lx * k, cy - 5 * k);
    ctx.lineTo(cx + face * (lx + phase * 0.7 * (lx > 0 ? 1 : -1)) * k, cy);
  }
  // the shaft from the bed to the yoke
  ctx.moveTo(poleX, cy - 5.5 * k);
  ctx.lineTo(cx + face * 3 * k, cy - 8.5 * k);
  ctx.stroke();
  ctx.fillStyle = '#9a8770'; // a pale draught ox
  ctx.beginPath();
  ctx.ellipse(cx, cy - 7 * k, 5.8 * k, 3.2 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath(); // the head, carried low
  ctx.ellipse(cx + face * 6.2 * k, cy - 7.5 * k, 2.2 * k, 1.7 * k, face * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6e5a46'; // the yoke on its neck
  ctx.fillRect(cx + face * 3.6 * k - 0.6 * k, cy - 10.2 * k, 1.2 * k, 2.4 * k);
  ctx.strokeStyle = '#efe6d0'; // horns
  ctx.lineWidth = 0.7 * k;
  ctx.beginPath();
  ctx.moveTo(cx + face * 5.8 * k, cy - 9 * k);
  ctx.quadraticCurveTo(cx + face * 6.4 * k, cy - 11 * k, cx + face * 7.8 * k, cy - 10.8 * k);
  ctx.stroke();
}

const HORSE_COATS = ['#7a4a2c', '#4a3324', '#a8693c', '#b8b0a4']; // bay, dark, chestnut, grey

/**
 * A drover leading `n` horses (1 to 4) on a rope: they follow behind him, the
 * second beside the first (further back in the picture), the next pair
 * behind those. With 0 he is walking home with the rope.
 */
function drawLedHorses(ctx, sx, sy, k, face, dirY, phase, n, id) {
  const base = sy - dirY * 1.5 * k;
  for (let i = n - 1; i >= 0; i--) {
    const hx = sx - face * (12 + (i % 2) * 1.5 + (i >> 1) * 7) * k;
    const hy = base - ((i % 2) * 2.6 + (i >> 1) * 0.6) * k;
    drawHorse(ctx, hx, hy, k, face, i % 2 ? -phase : phase, HORSE_COATS[(id + i) % HORSE_COATS.length]);
  }
  // the lead rope, from the drover's hand to the first horse's head (or,
  // with no horses, hanging loose from his hand)
  ctx.strokeStyle = '#d8c8a0';
  ctx.lineWidth = 0.5 * k;
  ctx.beginPath();
  ctx.moveTo(sx - face * 4 * k, sy - 8 * k);
  if (n > 0) ctx.lineTo(sx - face * 5.6 * k, base - 11.8 * k);
  else ctx.lineTo(sx - face * 4.6 * k, sy - 3.5 * k);
  ctx.stroke();
}

/** One horse: longer legs than a mule, an arched neck, a dark mane and tail. */
function drawHorse(ctx, cx, cy, k, face, phase, coat) {
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, 5.5 * k, 1.8 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = coat;
  ctx.lineWidth = 1.1 * k;
  ctx.beginPath();
  for (const lx of [-3.6, -2.2, 2.2, 3.6]) {
    ctx.moveTo(cx + face * lx * k, cy - 6.5 * k);
    ctx.lineTo(cx + face * (lx + phase * 1.2 * (lx > 0 ? 1 : -1)) * k, cy);
  }
  ctx.stroke();
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(cx, cy - 8 * k, 5 * k, 2.4 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath(); // the neck, rising forward
  ctx.moveTo(cx + face * 2.6 * k, cy - 9.8 * k);
  ctx.lineTo(cx + face * 4.6 * k, cy - 13.2 * k);
  ctx.lineTo(cx + face * 6 * k, cy - 12.6 * k);
  ctx.lineTo(cx + face * 5 * k, cy - 7.8 * k);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath(); // the head, nose down and forward
  ctx.ellipse(cx + face * 6.5 * k, cy - 11.9 * k, 2 * k, 0.9 * k, face * 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2a1e16'; // mane and tail
  ctx.lineWidth = 0.9 * k;
  ctx.beginPath();
  ctx.moveTo(cx + face * 2.7 * k, cy - 10.4 * k);
  ctx.lineTo(cx + face * 4.5 * k, cy - 13.6 * k);
  ctx.moveTo(cx - face * 4.8 * k, cy - 9 * k);
  ctx.quadraticCurveTo(cx - face * 6.4 * k, cy - 8 * k, cx - face * 6 * k, cy - 4.5 * k);
  ctx.stroke();
}

/**
 * A pack mule; with `rider` the packs ride on its rump behind the rider.
 * `packs` (a caravan on its way out) lists the goods it bought, drawn as
 * cargo on its back; an empty list means it bought nothing (an empty pack
 * saddle). Without it (on the way in) the mule carries plain bales.
 */
function drawMule(ctx, cx, cy, k, face, phase, rider = false, packs = undefined) {
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
  if (rider) {
    const px = cx - face * 4.5 * k;
    ctx.fillStyle = '#c9a86b';
    ctx.fillRect(px - 2 * k, cy - 11 * k, 4 * k, 3.5 * k);
    ctx.fillStyle = '#9b5a3a';
    ctx.fillRect(px - 1.5 * k, cy - 12.5 * k, 3 * k, 1.8 * k);
    return;
  }
  if (Array.isArray(packs)) {
    // the pack saddle, then what was bought: two of the first good, one of a second on top
    // (a little forward, clear of the merchant walking at the mule's flank)
    const px = cx + face * 1.2 * k;
    ctx.fillStyle = '#6e4a2c';
    ctx.fillRect(px - 3.6 * k, cy - 10.4 * k, 7.2 * k, 1.4 * k);
    if (packs[0]) drawCargo(ctx, packs[0], 2, px, cy - 10 * k, k, face, 3.4);
    if (packs[1]) drawCargo(ctx, packs[1], 1, px, cy - 12.4 * k, k, face, 3.4);
    return;
  }
  ctx.fillStyle = '#c9a86b';
  ctx.fillRect(cx - 4 * k, cy - 11 * k, 7 * k, 3.5 * k);
  ctx.fillStyle = '#9b5a3a';
  ctx.fillRect(cx - 3 * k, cy - 13 * k, 5 * k, 2 * k);
}

/**
 * A racing chariot and its team of two horses, galloping, the driver
 * standing in the car with the reins (his tunic in his faction's colour).
 * Exported for the hippodrome's races (renderer) and the art sheet.
 */
export function drawChariot(ctx, sx, sy, k, face, phase, color, id = 0) {
  // the horses, side by side ahead of the car (the far one first)
  const coats = HORSE_COATS;
  drawHorse(ctx, sx + face * 10.5 * k, sy - 1.6 * k, k, face, -phase, coats[(id + 1) % coats.length]);
  drawHorse(ctx, sx + face * 9.5 * k, sy, k, face, phase, coats[id % coats.length]);
  chariotBody(ctx, sx, sy, k, color);
  // the driver, leaning forward with the reins
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(sx - 2 * k, sy - 9 * k);
  ctx.lineTo(sx + 1.6 * k, sy - 9 * k);
  ctx.lineTo(sx + 2.2 * k + face * 0.8 * k, sy - 15 * k);
  ctx.lineTo(sx - 1.2 * k + face * 0.8 * k, sy - 15 * k);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = SKIN[id % SKIN.length];
  ctx.beginPath(); ctx.arc(sx + face * 1.2 * k, sy - 17 * k, 2.1 * k, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#d6ab3c'; // a leather cap
  ctx.beginPath(); ctx.arc(sx + face * 1.2 * k, sy - 17.6 * k, 2.1 * k, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = '#3a2a1e';
  ctx.lineWidth = 0.5 * k;
  ctx.beginPath(); ctx.moveTo(sx + face * 2.5 * k, sy - 12.5 * k); ctx.lineTo(sx + face * 14.5 * k, sy - 12 * k); ctx.stroke();
}

/**
 * Fishing boat: a small open boat with a short mast and a triangular sail
 * while it sails, the fisherman in the stern and the net: heaped in the bow
 * on the way, cast over the side (a ring of floats on the water) while it
 * fishes, and a basket of the catch on the way home.
 */
function drawFishingBoat(ctx, w, sx, sy, k0, t, dirX) {
  const k = k0 * 1.05;
  const f = dirX < 0 ? -1 : 1;
  const y = sy + Math.sin(t * 2.4 + w.id) * 0.6 * k;
  const X = (dx) => sx + dx * f * k;
  const Y = (dy) => y + dy * k;
  const fishing = w.state === 'fishing';
  const moored = w.state === 'moored' || w.state === 'spare';
  if (fishing) {
    // the net in the water beside the boat: a ring of cork floats
    ctx.strokeStyle = 'rgba(60,50,40,0.45)';
    ctx.lineWidth = 0.6 * k;
    ctx.beginPath(); ctx.ellipse(X(-2), Y(4), 13 * k, 4.2 * k, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#e0c060';
    for (let n = 0; n < 9; n++) {
      const a = (Math.PI * 2 * n) / 9 + Math.sin(t + n) * 0.05;
      ctx.fillRect(X(-2) + Math.cos(a) * 13 * k - 0.8 * k, Y(4) + Math.sin(a) * 4.2 * k - 0.6 * k, 1.6 * k, 1.2 * k);
    }
  } else if (!moored) {
    // a small wake
    ctx.fillStyle = 'rgba(235,245,255,0.3)';
    ctx.beginPath(); ctx.ellipse(sx, sy + 1 * k, 10 * k, 2.4 * k, 0, 0, Math.PI * 2); ctx.fill();
  }
  // the hull
  ctx.fillStyle = '#6e4a2c';
  ctx.beginPath();
  ctx.moveTo(X(-8), Y(-4.5));
  ctx.lineTo(X(7), Y(-4.5));
  ctx.lineTo(X(10), Y(-7));
  ctx.lineTo(X(8), Y(-1));
  ctx.lineTo(X(4), Y(0.5));
  ctx.lineTo(X(-6), Y(0.5));
  ctx.lineTo(X(-9), Y(-3));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#a07a50'; // the rail
  ctx.fillRect(Math.min(X(-8), X(7)), Y(-4.9), 15 * k, 1 * k);
  ctx.fillStyle = '#3d6f8f'; // a painted eye on the bow, against the evil eye
  ctx.fillRect(X(7.2) - 0.6 * k, Y(-3.6), 1.2 * k, 1 * k);
  // the catch, or the net heaped in the bow
  if (w.state === 'homeWithCatch') {
    ctx.fillStyle = '#b08850';
    ctx.fillRect(X(2) - 2.5 * k, Y(-7.2), 5 * k, 2.6 * k);
    ctx.fillStyle = '#b9c9cf';
    ctx.beginPath(); ctx.ellipse(X(2), Y(-7.4), 2.4 * k, 0.8 * k, 0, 0, Math.PI * 2); ctx.fill();
  } else if (!fishing) {
    ctx.fillStyle = 'rgba(80,70,55,0.9)';
    ctx.beginPath(); ctx.ellipse(X(3.5), Y(-5.6), 2.8 * k, 1.3 * k, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e0c060';
    ctx.fillRect(X(3) - 0.6 * k, Y(-6.6), 1.2 * k, 0.9 * k);
  }
  // mast, and the sail while under way
  ctx.fillStyle = '#4a3222';
  ctx.fillRect(X(-0.5) - 0.45 * k, Y(-19), 0.9 * k, 14.5 * k);
  if (!fishing && !moored) {
    ctx.fillStyle = '#e9dfc6';
    ctx.beginPath();
    ctx.moveTo(X(-0.5), Y(-19));
    ctx.quadraticCurveTo(X(5), Y(-12), X(6), Y(-6.5));
    ctx.lineTo(X(-0.5), Y(-6.5));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(160,90,60,0.6)';
    ctx.fillRect(Math.min(X(-0.5), X(4)), Y(-10), 4.2 * k, 0.9 * k);
  }
  // the fisherman in the stern: hauling the net over the side while fishing
  const skin = SKIN[w.id % SKIN.length];
  const fx = X(-5);
  const lean = fishing ? Math.sin(t * 3 + w.id) * 0.8 : 0;
  ctx.fillStyle = '#7a5a3a';
  ctx.fillRect(fx - 1.8 * k, Y(-10.5), 3.6 * k, 5.6 * k);
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(fx + f * lean * k, Y(-12.2), 1.7 * k, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = skin;
  ctx.lineWidth = 0.9 * k;
  ctx.beginPath();
  ctx.moveTo(fx, Y(-9.5));
  if (fishing) ctx.lineTo(fx - f * (3 + lean) * k, Y(-5.5));
  else ctx.lineTo(fx - f * 2.5 * k, Y(-7)); // a hand on the steering oar
  ctx.stroke();
  if (!fishing) {
    ctx.strokeStyle = '#3a2618';
    ctx.lineWidth = 0.8 * k;
    ctx.beginPath(); ctx.moveTo(X(-7.5), Y(-6)); ctx.lineTo(X(-10.5), Y(0.5)); ctx.stroke();
  }
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

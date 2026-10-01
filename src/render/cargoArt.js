/**
 * cargoArt.js
 * ----------------------------------------------------------------------------
 * What a cart carries, drawn on its bed so a player can read the city's
 * logistics at a glance: sacks of wheat, crates of vegetables and fruit,
 * baskets of olives and grapes, joints of meat, lumps of clay, logs, iron
 * ingots, marble blocks, pots, amphorae of oil (pale) and wine (dark), a
 * table and chairs, shields with spears, sheaves of arrows. Horses are not
 * carted at all: the drover leads them (walkerArt.js).
 *
 * The load shows as 1 to 4 items against what that cart can hold, so a full
 * cart looks full and a part load looks part full. A good with no art of its
 * own gets a plain block in its GOODS color.
 *
 * Drawn live every frame (walkers are not cached), so each item is a handful
 * of shapes. All coordinates are device pixels at scale k; an item is drawn
 * around (x, y) = the middle of where it rests on the bed.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { GOODS } from '../data/goods.js';

/** Items a full cart shows. */
export const CARGO_STEPS = 4;

/**
 * How much a cart can carry, by the building that sent it: farm wagons haul
 * the whole harvest, a warehouse sends one lot at a time to a workshop or a
 * barracks, everyone else (quarries, workshops, docks) up to CART_LOAD. A
 * load bigger than that (it never is today) counts as full.
 * @param {object|null} originDef  the sending building's def, null if gone
 * @param {number} [amount]        units on board
 */
export function cartCapacity(originDef, amount = 0) {
  const kind = originDef?.kind;
  const cap = kind === 'farm' ? CONFIG.FARM_CART_LOAD
    : kind === 'warehouse' ? CONFIG.CART_CAPACITY
      : CONFIG.CART_LOAD;
  return Math.max(cap, amount || 0);
}

/**
 * Items to draw for `amount` units on a cart that holds `capacity`: 0 for an
 * empty cart, else 1 to CARGO_STEPS, rounded up so any load shows at least one.
 */
export function cargoLevel(amount, capacity) {
  if (!(amount > 0) || !(capacity > 0)) return 0;
  return Math.min(CARGO_STEPS, Math.max(1, Math.ceil((amount / capacity) * CARGO_STEPS - 1e-9)));
}

/** Horses a drover leads: one per horse on the books (100 units), 1 to 4. */
export function horsesLed(amount) {
  const per = GOODS.horses.unitSize || CONFIG.CART_CAPACITY;
  return Math.min(CARGO_STEPS, Math.max(1, Math.floor((amount || 0) / per)));
}

// --- the items --------------------------------------------------------------

const WOOD = '#8a6440';
const WOOD_DARK = '#5e4028';
const WICKER = '#b08850';

function ellipse(ctx, x, y, rx, ry, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
}

/** Grain sack: a plump burlap bag with ears of wheat at the tie. */
function sack(ctx, x, y, k) {
  ctx.fillStyle = '#d2b98a';
  ellipse(ctx, x, y - 1.3 * k, 1.75 * k, 1.35 * k);
  ctx.fillStyle = '#e4c35a';
  ellipse(ctx, x, y - 2.7 * k, 0.9 * k, 0.6 * k);
}

/** A slatted crate heaped with produce: `heap` color, `spot` a second color. */
function crate(heap, spot) {
  return (ctx, x, y, k, f, i) => {
    ctx.fillStyle = WOOD;
    ctx.fillRect(x - 1.7 * k, y - 1.3 * k, 3.4 * k, 1.3 * k);
    ctx.fillStyle = heap;
    ellipse(ctx, x, y - 1.4 * k, 1.6 * k, 1 * k);
    ctx.fillStyle = spot;
    ellipse(ctx, x + f * (i % 2 ? -0.6 : 0.6) * k, y - 1.9 * k, 0.6 * k, 0.5 * k);
  };
}

/** Fruit: a crate of round red apples, three to a crate. */
function fruitCrate(ctx, x, y, k, f) {
  ctx.fillStyle = WOOD;
  ctx.fillRect(x - 1.7 * k, y - 1.3 * k, 3.4 * k, 1.3 * k);
  ctx.fillStyle = '#d9534f';
  ctx.beginPath();
  ctx.arc(x - 0.85 * k, y - 1.6 * k, 0.8 * k, 0, Math.PI * 2);
  ctx.arc(x + 0.85 * k, y - 1.6 * k, 0.8 * k, 0, Math.PI * 2);
  ctx.arc(x, y - 2.5 * k, 0.8 * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f0b040'; // one golden pear among the apples
  ellipse(ctx, x + f * 0.85 * k, y - 1.7 * k, 0.45 * k, 0.55 * k);
}

/** A wicker basket heaped with small round fruit (olives, grapes). */
function basket(heap, dot) {
  return (ctx, x, y, k) => {
    ctx.fillStyle = WICKER;
    ctx.beginPath();
    ctx.moveTo(x - 1.7 * k, y - 1.6 * k);
    ctx.lineTo(x + 1.7 * k, y - 1.6 * k);
    ctx.lineTo(x + 1.2 * k, y);
    ctx.lineTo(x - 1.2 * k, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = heap;
    ctx.beginPath();
    ctx.arc(x - 0.7 * k, y - 1.9 * k, 0.75 * k, 0, Math.PI * 2);
    ctx.arc(x + 0.7 * k, y - 1.9 * k, 0.75 * k, 0, Math.PI * 2);
    ctx.arc(x, y - 2.5 * k, 0.75 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = dot;
    ellipse(ctx, x + 0.3 * k, y - 2.6 * k, 0.4 * k, 0.4 * k);
  };
}

/** A joint of meat: a ham with its bone sticking out. */
function joint(ctx, x, y, k, f) {
  ctx.fillStyle = '#9e3b30';
  ellipse(ctx, x - f * 0.3 * k, y - 1.2 * k, 1.6 * k, 1.15 * k, f * 0.35);
  ctx.fillStyle = '#d0786a'; // the cut face
  ellipse(ctx, x - f * 0.7 * k, y - 1.4 * k, 0.6 * k, 0.5 * k, f * 0.35);
  ctx.fillStyle = '#f2ead8'; // the bone
  ctx.fillRect(x + f * 1.3 * k - 0.35 * k, y - 2.5 * k, 0.7 * k, 1.1 * k);
}

/** Clay: two wet reddish lumps, the lower one darker. */
function clayLumps(ctx, x, y, k, f) {
  ctx.fillStyle = '#93502c';
  ellipse(ctx, x, y - 0.8 * k, 1.7 * k, 0.85 * k);
  ctx.fillStyle = '#c0703f';
  ellipse(ctx, x + f * 0.3 * k, y - 1.7 * k, 1.15 * k, 0.75 * k);
}

/** Iron: two ingots, one across the other. */
function ingots(ctx, x, y, k) {
  for (const dy of [0, 1.1]) {
    ctx.fillStyle = '#4e545d';
    ctx.beginPath();
    ctx.moveTo(x - 1.6 * k, y - dy * k);
    ctx.lineTo(x + 1.6 * k, y - dy * k);
    ctx.lineTo(x + 1.15 * k, y - (dy + 1) * k);
    ctx.lineTo(x - 1.15 * k, y - (dy + 1) * k);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#a9b1bb'; // a bright top edge, so it reads as metal
    ctx.fillRect(x - 1.15 * k, y - (dy + 1) * k, 2.3 * k, 0.35 * k);
  }
}

/** Marble: a cut white block with a shaded end and a grey vein. */
function marbleBlock(ctx, x, y, k, f) {
  ctx.fillStyle = '#f1eee8';
  ctx.fillRect(x - 1.6 * k, y - 2.1 * k, 3.2 * k, 2.1 * k);
  ctx.fillStyle = '#c3bfb5';
  ctx.fillRect(f > 0 ? x + 0.9 * k : x - 1.6 * k, y - 2.1 * k, 0.7 * k, 2.1 * k);
  ctx.strokeStyle = '#a19c92';
  ctx.lineWidth = 0.35 * k;
  ctx.beginPath();
  ctx.moveTo(x - f * 1.2 * k, y - 1.6 * k);
  ctx.lineTo(x + f * 0.4 * k, y - 0.5 * k);
  ctx.stroke();
}

/** Pottery: a round terracotta pot with a neck and a dark band. */
function pot(ctx, x, y, k) {
  ctx.fillStyle = '#c7643e';
  ctx.beginPath();
  ctx.arc(x, y - 1.25 * k, 1.25 * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - 0.6 * k, y - 3 * k, 1.2 * k, 0.9 * k);
  ctx.fillStyle = '#6e2f18';
  ctx.fillRect(x - 0.75 * k, y - 3.2 * k, 1.5 * k, 0.4 * k); // rim
  ctx.fillRect(x - 1.15 * k, y - 1.5 * k, 2.3 * k, 0.4 * k); // painted band
}

/** An amphora standing upright: `body` clay color, `top` stopper and band. */
function amphora(body, top) {
  return (ctx, x, y, k) => {
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 0.95 * k, y - 1.6 * k);
    ctx.quadraticCurveTo(x - 1.05 * k, y - 3.2 * k, x - 0.35 * k, y - 3.4 * k);
    ctx.lineTo(x - 0.35 * k, y - 4.1 * k);
    ctx.lineTo(x + 0.35 * k, y - 4.1 * k);
    ctx.lineTo(x + 0.35 * k, y - 3.4 * k);
    ctx.quadraticCurveTo(x + 1.05 * k, y - 3.2 * k, x + 0.95 * k, y - 1.6 * k);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = top;
    ctx.fillRect(x - 0.5 * k, y - 4.6 * k, 1 * k, 0.65 * k); // stopper
    ctx.fillRect(x - 0.95 * k, y - 2.6 * k, 1.9 * k, 0.45 * k); // band
  };
}

/** Furniture: tables at the bottom, chairs (seat and back) on top. */
function furniturePiece(ctx, x, y, k, f, i) {
  ctx.fillStyle = '#7a4f28';
  if (i < 2) {
    // a table: top and two legs
    ctx.fillRect(x - 1.7 * k, y - 2.3 * k, 3.4 * k, 0.6 * k);
    ctx.fillRect(x - 1.4 * k, y - 1.8 * k, 0.5 * k, 1.8 * k);
    ctx.fillRect(x + 0.9 * k, y - 1.8 * k, 0.5 * k, 1.8 * k);
  } else {
    // a chair: back, seat and front leg
    ctx.fillRect(x - f * 1.1 * k - 0.25 * k, y - 3.2 * k, 0.5 * k, 3.2 * k);
    ctx.fillRect(x - 1.1 * k, y - 1.4 * k, 2.2 * k, 0.5 * k);
    ctx.fillRect(x + f * 1.1 * k - 0.25 * k, y - 1.4 * k, 0.5 * k, 1.4 * k);
  }
  ctx.fillStyle = '#c08a50'; // the lit top edge
  ctx.fillRect(x - (i < 2 ? 1.7 : 1.1) * k, y - (i < 2 ? 2.3 : 1.4) * k, (i < 2 ? 3.4 : 2.2) * k, 0.25 * k);
}

/** Weapons: a legion shield standing on edge, red with a bronze boss. */
function shield(ctx, x, y, k) {
  ctx.fillStyle = '#a3301f';
  ctx.fillRect(x - 0.85 * k, y - 3.2 * k, 1.7 * k, 3.2 * k);
  ctx.fillStyle = '#d6ab3c';
  ctx.beginPath();
  ctx.arc(x, y - 1.6 * k, 0.5 * k, 0, Math.PI * 2);
  ctx.fill();
}

/** Spears bundled across the top of a weapons load (drawn once per cart). */
function spears(ctx, x, y, k, f, n, hw) {
  const top = y - (n > 1 ? 3.4 : 3) * k;
  ctx.strokeStyle = '#6b4a2a';
  ctx.lineWidth = 0.45 * k;
  ctx.beginPath();
  ctx.moveTo(x - f * (hw + 0.5) * k, top + 0.6 * k);
  ctx.lineTo(x + f * (hw + 0.8) * k, top - 0.6 * k);
  ctx.moveTo(x - f * (hw + 0.2) * k, top + 1 * k);
  ctx.lineTo(x + f * (hw + 1.2) * k, top - 0.1 * k);
  ctx.stroke();
  ctx.fillStyle = '#d4d9df'; // iron points
  ctx.fillRect(x + f * (hw + 0.8) * k - 0.4 * k, top - 0.9 * k, 0.8 * k, 0.6 * k);
  ctx.fillRect(x + f * (hw + 1.2) * k - 0.4 * k, top - 0.4 * k, 0.8 * k, 0.6 * k);
}

/** Arrows: an upright sheaf, tied at the waist, pale fletching on top. */
function sheaf(ctx, x, y, k) {
  ctx.fillStyle = '#b89a64';
  ctx.beginPath();
  ctx.moveTo(x - 0.45 * k, y);
  ctx.lineTo(x + 0.45 * k, y);
  ctx.lineTo(x + 0.9 * k, y - 3.4 * k);
  ctx.lineTo(x - 0.9 * k, y - 3.4 * k);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#efe6d2'; // goose feathers, a red cock feather on each
  ctx.fillRect(x - 0.95 * k, y - 4.2 * k, 1.9 * k, 1 * k);
  ctx.fillStyle = '#b8452e';
  ctx.fillRect(x - 0.95 * k, y - 4.2 * k, 1.9 * k, 0.4 * k);
  ctx.fillStyle = '#4a3420';
  ctx.fillRect(x - 0.7 * k, y - 1.8 * k, 1.4 * k, 0.4 * k); // the tie
}

/** Timber: one log lying along the bed, its cut end facing forward. */
function log(ctx, x, y, k, f, hw) {
  ctx.fillStyle = '#7a4c24';
  ctx.fillRect(x - hw * k, y - 1.3 * k, 2 * hw * k, 1.3 * k);
  ctx.fillStyle = '#5a3818'; // bark
  ctx.fillRect(x - hw * k, y - 0.45 * k, 2 * hw * k, 0.45 * k);
  ctx.fillStyle = '#e0bb84'; // the sawn end
  ellipse(ctx, x + f * hw * k, y - 0.65 * k, 0.5 * k, 0.65 * k);
}

/** Fallback: a block in the good's own color. */
function block(color) {
  return (ctx, x, y, k) => {
    ctx.fillStyle = color;
    ctx.fillRect(x - 1.6 * k, y - 1.9 * k, 3.2 * k, 1.9 * k);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(x - 1.6 * k, y - 0.5 * k, 3.2 * k, 0.5 * k);
  };
}

/**
 * Cargo art per good. `draw(ctx, x, y, k, face, i)` paints item i;
 * `layout` places the items:
 *   'pile'   two on the bed, then up to two on top of those
 *   'row'    one row, standing side by side (tall things: amphorae, shields)
 *   'layers' one on top of the other, each the bed's length (logs)
 * Horses have none on purpose: they are led, not carted.
 */
export const CARGO_ART = Object.freeze({
  wheat: { layout: 'pile', draw: sack },
  vegetables: { layout: 'pile', draw: crate('#6aa84f', '#e08a2e') }, // greens and a carrot
  fruit: { layout: 'pile', draw: fruitCrate },
  meat: { layout: 'pile', draw: joint },
  clay: { layout: 'pile', draw: clayLumps },
  timber: { layout: 'layers', draw: log },
  olives: { layout: 'pile', draw: basket('#55652a', '#2e2a1e') }, // green and black olives
  grapes: { layout: 'pile', draw: basket('#6b3fa0', '#4f8a3a') }, // purple bunches, a leaf
  iron: { layout: 'pile', draw: ingots },
  marble: { layout: 'pile', draw: marbleBlock },
  pottery: { layout: 'pile', draw: pot },
  furniture: { layout: 'pile', draw: furniturePiece },
  oil: { layout: 'row', draw: amphora('#e6d7aa', '#c9a832') }, // pale jars, golden seals
  wine: { layout: 'row', draw: amphora('#a9583c', '#3e0f1e') }, // red clay, dark stoppers
  weapons: { layout: 'row', draw: shield, extra: spears },
  arrows: { layout: 'row', draw: sheaf },
});

/** Goods that are led on foot rather than carted (see walkerArt.js). */
export const LED_GOODS = Object.freeze(['horses']);

/** The art for a good: its own, or a block in its GOODS color. */
export function cargoArtOf(good) {
  return CARGO_ART[good] || { layout: 'pile', draw: block(GOODS[good]?.color || '#c9a86b') };
}

/**
 * Draw `n` items of `good` on a cart bed.
 * @param {number} cx    bed center, device px
 * @param {number} y     top of the bed, device px
 * @param {number} face  -1 facing left, 1 facing right (mirrors the art)
 * @param {number} hw    half the bed's length, in k units
 */
export function drawCargo(ctx, good, n, cx, y, k, face, hw = 4) {
  if (n <= 0) return;
  const art = cargoArtOf(good);
  if (art.layout === 'layers') {
    for (let i = 0; i < n; i++) art.draw(ctx, cx, y - i * 1.2 * k, k, face, hw - 0.2 * i);
    return;
  }
  if (art.layout === 'row') {
    const gap = Math.min(2, (2 * hw - 0.4) / CARGO_STEPS);
    for (let i = 0; i < n; i++) art.draw(ctx, cx + face * (i - (n - 1) / 2) * gap * k, y, k, face, i);
  } else {
    // A pile: the bottom pair spreads along the bed, the top pair sits on it.
    const dx = hw * 0.45;
    for (let i = 0; i < n; i++) {
      const top = i >= 2;
      const x = n === 1 ? 0 : top ? (n === 3 ? 0 : (i === 2 ? -0.6 : 0.6) * dx) : (i === 0 ? -dx : dx);
      art.draw(ctx, cx + face * x * k, y - (top ? 2 : 0) * k, k, face, i);
    }
  }
  if (art.extra) art.extra(ctx, cx, y, k, face, n, hw);
}

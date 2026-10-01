/**
 * militaryArt.js
 * ----------------------------------------------------------------------------
 * Art for the military layer, all procedural and original:
 *
 *   wallSpec()        cached sprite for a wall or gate tile (connects to
 *                     neighboring walls, gates and watchtowers)
 *   drawUnit()        soldiers and raiders, drawn live every frame like walkers
 *                     (ships of war: shipArt.js)
 *   drawProjectile()  arrows, sling stones and raider ships' fire pots in flight
 *   drawRallyFlag()   the standard planted where a fort's troops are deployed
 *
 * Live drawing works in device pixels: (sx, sy) are the feet, k is the pixel
 * scale (zoom * devicePixelRatio), like walkerArt.js.
 * ----------------------------------------------------------------------------
 */

import { CONFIG, HALF_W } from '../config.js';
import { UNIT_TYPES } from '../data/units.js';
import { P, poly, quad, box, shade, horse } from './draw.js';
import { drawWarship } from './shipArt.js';

const TH = CONFIG.TILE_H;
const STONE = '#b9ad92';

// ---------------------------------------------------------------------------
// Walls & gates
// ---------------------------------------------------------------------------

/**
 * Sprite spec for one wall tile.
 * @param {number} mask     connections: 1=N(-y) 2=E(+x) 4=S(+y) 8=W(-x)
 * @param {boolean} gate    a gate over a road
 * @param {boolean} damaged below half hit points: show cracks and rubble
 */
export function wallSpec(mask, gate, damaged) {
  return {
    w: CONFIG.TILE_W,
    h: TH + 34,
    ax: HALF_W,
    ay: 34,
    draw(ctx) {
      const H = gate ? 16 : 15; // wall height px
      const t = 0.17; // half thickness in tiles
      const color = damaged ? shade(STONE, -0.12) : STONE;
      // Which way does the wall run? Gates pick the axis across their road.
      const alongU = (mask & 2) || (mask & 8) || (!(mask & 1) && !(mask & 4));
      const seg = (u0, v0, du, dv) => {
        box(ctx, u0, v0, du, dv, 0, H, color);
        merlons(ctx, u0, v0, du, dv, H, color);
      };
      if (gate) {
        // Two pillars on the wall line and a lintel over the road.
        const pill = 0.22;
        if (alongU) {
          box(ctx, 0, 0.5 - t, pill, t * 2, 0, H + 5, shade(color, -0.06));
          box(ctx, 1 - pill, 0.5 - t, pill, t * 2, 0, H + 5, shade(color, -0.06));
          box(ctx, 0, 0.5 - t, 1, t * 2, H, 5, shade(color, 0.04));
          doors(ctx, 'u', t);
        } else {
          box(ctx, 0.5 - t, 0, t * 2, pill, 0, H + 5, shade(color, -0.06));
          box(ctx, 0.5 - t, 1 - pill, t * 2, pill, 0, H + 5, shade(color, -0.06));
          box(ctx, 0.5 - t, 0, t * 2, 1, H, 5, shade(color, 0.04));
          doors(ctx, 'v', t);
        }
        return;
      }
      // Back segments first (N, W), then the pier, then front (E, S).
      if (mask & 1) seg(0.5 - t, 0, t * 2, 0.5 - t);
      if (mask & 8) seg(0, 0.5 - t, 0.5 - t, t * 2);
      box(ctx, 0.5 - t - 0.03, 0.5 - t - 0.03, t * 2 + 0.06, t * 2 + 0.06, 0, H + 3, shade(color, -0.03));
      if (mask & 2) seg(0.5 + t, 0.5 - t, 0.5 - t, t * 2);
      if (mask & 4) seg(0.5 - t, 0.5 + t, t * 2, 0.5 - t);
      if (!mask) seg(0.15, 0.5 - t, 0.7, t * 2); // lone block
      if (damaged) cracks(ctx, H);
    },
  };
}

/** Little battlement blocks along the top of a wall segment. */
function merlons(ctx, u0, v0, du, dv, H, color) {
  const alongU = du >= dv;
  const len = alongU ? du : dv;
  const n = Math.max(1, Math.round(len / 0.2));
  const m = 0.09;
  for (let k = 0; k < n; k++) {
    const c = (k + 0.5) / n;
    if (alongU) box(ctx, u0 + du * c - m / 2, v0 + dv - m, m, m, H, 3, shade(color, 0.08), { stroke: null });
    else box(ctx, u0 + du - m, v0 + dv * c - m / 2, m, m, H, 3, shade(color, 0.08), { stroke: null });
  }
}

/** Open wooden gate leaves, seen through the arch. */
function doors(ctx, axis, t) {
  const wood = '#6e4a2a';
  if (axis === 'u') {
    poly(ctx, [P(0.22, 0.5 + t, 0), P(0.34, 0.5 + t + 0.25, 0), P(0.34, 0.5 + t + 0.25, 13), P(0.22, 0.5 + t, 13)], wood, shade(wood, -0.4), 0.5);
    poly(ctx, [P(0.78, 0.5 + t, 0), P(0.66, 0.5 + t + 0.25, 0), P(0.66, 0.5 + t + 0.25, 13), P(0.78, 0.5 + t, 13)], shade(wood, -0.1), shade(wood, -0.4), 0.5);
  } else {
    poly(ctx, [P(0.5 + t, 0.22, 0), P(0.5 + t + 0.25, 0.34, 0), P(0.5 + t + 0.25, 0.34, 13), P(0.5 + t, 0.22, 13)], wood, shade(wood, -0.4), 0.5);
    poly(ctx, [P(0.5 + t, 0.78, 0), P(0.5 + t + 0.25, 0.66, 0), P(0.5 + t + 0.25, 0.66, 13), P(0.5 + t, 0.78, 13)], shade(wood, -0.1), shade(wood, -0.4), 0.5);
  }
}

/** Cracks and fallen stones on a battered wall. */
function cracks(ctx, H) {
  ctx.strokeStyle = 'rgba(40,32,24,0.8)';
  ctx.lineWidth = 0.7;
  const [x, y] = P(0.5, 0.7, H * 0.8);
  ctx.beginPath();
  ctx.moveTo(x - 2, y); ctx.lineTo(x + 1, y + 4); ctx.lineTo(x - 1, y + 7); ctx.lineTo(x + 2, y + 10);
  ctx.stroke();
  quad(ctx, 0.62, 0.72, 0.78, 0.86, 0, '#8f8570');
  quad(ctx, 0.2, 0.75, 0.3, 0.85, 0, '#9a8f78');
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

const SKIN = ['#e3b68c', '#c99a6b', '#a8784e', '#f0caa2'];
// Walk cycles in radians per tile marched: 0.8 leg swings a tile on foot (about
// 1.4 steps/s for a legionary at 1x), 0.55 for horses' longer stride. Both times
// STRIDE_WRAP (100) are whole numbers, so the wrap of u.walked never shows.
const STEP_RAD = Math.PI * 2 * 0.8;
const HOOF_RAD = Math.PI * 2 * 0.55;
const BARB_HAIR = ['#c9a14a', '#a0522d', '#7a5a3a', '#d8c07a'];

/**
 * Draw one soldier or raider.
 * @param {CanvasRenderingContext2D} ctx identity transform, device px
 * @param {object} u     the unit
 * @param {number} sx,sy feet position (device px)
 * @param {number} k     pixel scale
 * @param {number} t     animation time (s)
 * @param {number} tick  current sim tick (for strike/hit flashes)
 * @param {boolean} [highlight] draw a selection ring (units of the selected fort)
 */
export function drawUnit(ctx, u, sx, sy, k, t, tick, highlight = false, stride = u.walked || 0) {
  const def = UNIT_TYPES[u.type];
  if (def.naval) { drawWarship(ctx, u, sx, sy, k, t, tick, highlight, stride); return; }
  const face = u.facing < 0 ? -1 : 1;
  // Legs step with the distance marched (still when halted or paused, quicker when running).
  const phase = u.moving ? Math.sin(stride * (def.mounted ? HOOF_RAD : STEP_RAD) + u.id) : 0;
  const striking = tick - u.strikeTick < 8;
  const enemy = def.side === 'enemy';

  if (highlight) {
    ctx.strokeStyle = 'rgba(255,230,120,0.9)';
    ctx.lineWidth = 1.2 * k;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 7 * k, 3 * k, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // shadow (tinted red under raiders so they read as hostile at a glance)
  ctx.fillStyle = enemy ? 'rgba(120,0,0,0.35)' : 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, 4.5 * k, 1.9 * k, 0, 0, Math.PI * 2);
  ctx.fill();

  let by = sy; // where the rider's feet are (raised on horseback)
  if (def.mounted) {
    horse(ctx, sx, sy, k, enemy ? '#3b2a20' : '#8a5a3c', face, phase, enemy ? '#1a120c' : '#3a2618');
    by = sy - 7 * k;
  } else {
    // legs
    ctx.strokeStyle = enemy ? '#3a3026' : '#5a4632';
    ctx.lineWidth = 1.4 * k;
    ctx.beginPath();
    ctx.moveTo(sx - 1 * k, sy - 5 * k);
    ctx.lineTo(sx - 1 * k + phase * 1.8 * k, sy - 0.5 * k);
    ctx.moveTo(sx + 1 * k, sy - 5 * k);
    ctx.lineTo(sx + 1 * k - phase * 1.8 * k, sy - 0.5 * k);
    ctx.stroke();
  }

  // body
  const tunic = def.color;
  const skin = SKIN[u.id % SKIN.length];
  const top = by - (def.mounted ? 7 : 12.5) * k;
  const bottom = by - (def.mounted ? 0 : 4.5) * k;
  if (u.type === 'archer') {
    // quiver on the back
    ctx.fillStyle = '#6b4a2a';
    ctx.fillRect(sx - face * 3.4 * k - 1 * k, top - 1.5 * k, 2 * k, 6 * k);
  }
  ctx.fillStyle = tunic;
  ctx.beginPath();
  ctx.moveTo(sx - 2.6 * k, top);
  ctx.lineTo(sx + 2.6 * k, top);
  ctx.lineTo(sx + 3.3 * k, bottom);
  ctx.lineTo(sx - 3.3 * k, bottom);
  ctx.closePath();
  ctx.fill();
  // Caesar's own legionaries (sim/legion.js) are Romans too: armor and helmet, not a barbarian's hair.
  const imperial = u.type === 'imperial';
  if (u.type === 'legionary' || u.type === 'cavalry' || imperial) {
    // segmented iron armor over the tunic
    ctx.fillStyle = '#8a9099';
    ctx.fillRect(sx - 2.5 * k, top + 0.5 * k, 5 * k, 4 * k);
    ctx.fillStyle = 'rgba(40,40,50,0.4)';
    ctx.fillRect(sx - 2.5 * k, top + 2.2 * k, 5 * k, 0.6 * k);
  }
  if (enemy && !def.mounted && !imperial) {
    // checked trousers
    ctx.fillStyle = 'rgba(40,60,90,0.35)';
    ctx.fillRect(sx - 3 * k, bottom - 2 * k, 6 * k, 2 * k);
  }

  // head
  const hy = top - 2.6 * k;
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(sx, hy, 2.4 * k, 0, Math.PI * 2);
  ctx.fill();
  if (enemy && !imperial) {
    // wild hair and a beard
    ctx.fillStyle = BARB_HAIR[u.id % BARB_HAIR.length];
    ctx.beginPath();
    ctx.arc(sx, hy - 0.8 * k, 2.8 * k, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(sx - face * 3 * k - 0.8 * k, hy - 1 * k, 1.6 * k, 4.5 * k);
    ctx.fillRect(sx + face * 0.4 * k - 1.2 * k, hy + 1 * k, 2.4 * k, 1.6 * k);
  } else if (u.type === 'archer') {
    ctx.fillStyle = '#7a5a3a'; // leather cap
    ctx.beginPath();
    ctx.arc(sx, hy - 0.6 * k, 2.6 * k, Math.PI, 0);
    ctx.fill();
  } else {
    // iron helmet with a crest
    ctx.fillStyle = '#9aa1aa';
    ctx.beginPath();
    ctx.arc(sx, hy - 0.5 * k, 2.8 * k, Math.PI, 0);
    ctx.fill();
    // Crests: red for the province's legionaries, gold for its horsemen, a
    // tall white plume over a gilded rim for Caesar's.
    ctx.fillStyle = u.type === 'cavalry' ? '#d6ab3c' : imperial ? '#f1ece2' : '#c0392b';
    if (imperial) {
      ctx.fillRect(sx - 1.4 * k, hy - 6.2 * k, 2.8 * k, 3 * k);
      ctx.fillStyle = '#d6ab3c';
      ctx.fillRect(sx - 2.8 * k, hy - 0.9 * k, 5.6 * k, 0.8 * k);
    } else ctx.fillRect(sx - 2.2 * k, hy - 4.6 * k, 4.4 * k, 1.3 * k);
  }

  drawWeapon(ctx, u, def, sx, top, k, face, striking, t);
  if (u.hp < u.maxHp) drawHealth(ctx, u, sx, hy - 6 * k, k, tick);
}

function drawWeapon(ctx, u, def, sx, top, k, face, striking, t) {
  const hx = sx + face * 3.6 * k; // hand
  const hy = top + 3 * k;
  switch (u.type) {
    case 'legionary':
    case 'imperial': {
      // tall curved shield (scutum) on the facing side, gladius thrust when striking
      ctx.fillStyle = def.color;
      ctx.fillRect(sx + face * 1.6 * k - (face < 0 ? 3.6 * k : 0), top - 0.5 * k, 3.6 * k, 9.5 * k);
      ctx.strokeStyle = '#d6ab3c';
      ctx.lineWidth = 0.6 * k;
      ctx.strokeRect(sx + face * 1.6 * k - (face < 0 ? 3.6 * k : 0), top - 0.5 * k, 3.6 * k, 9.5 * k);
      ctx.fillStyle = '#d6ab3c';
      ctx.beginPath(); ctx.arc(sx + face * 3.4 * k, top + 4.2 * k, 0.9 * k, 0, Math.PI * 2); ctx.fill();
      const reach = striking ? 6 : 3;
      ctx.strokeStyle = '#d0d5dc';
      ctx.lineWidth = 1 * k;
      ctx.beginPath();
      ctx.moveTo(hx, hy + 1 * k);
      ctx.lineTo(hx + face * reach * k, hy + (striking ? 0 : -2) * k);
      ctx.stroke();
      break;
    }
    case 'archer': {
      // bow held forward; the string is drawn back right after a shot
      ctx.strokeStyle = '#6b4a2a';
      ctx.lineWidth = 1 * k;
      ctx.beginPath();
      ctx.arc(hx - face * 1 * k, hy, 4.5 * k, face > 0 ? -1.1 : Math.PI - 1.1 + 0.0, face > 0 ? 1.1 : Math.PI + 1.1);
      ctx.stroke();
      ctx.strokeStyle = '#efe6d0';
      ctx.lineWidth = 0.4 * k;
      ctx.beginPath();
      const bx = hx - face * 1 * k + face * Math.cos(1.1) * 4.5 * k;
      ctx.moveTo(bx, hy - Math.sin(1.1) * 4.5 * k);
      ctx.lineTo(striking ? sx : bx, hy);
      ctx.lineTo(bx, hy + Math.sin(1.1) * 4.5 * k);
      ctx.stroke();
      break;
    }
    case 'cavalry':
    case 'horseman': {
      // lance: lowered when charging, upright otherwise
      ctx.strokeStyle = u.type === 'cavalry' ? '#8a6a44' : '#5a4a3a';
      ctx.lineWidth = 0.9 * k;
      ctx.beginPath();
      if (striking || u.state === 'engage' || u.state === 'fight') {
        ctx.moveTo(sx - face * 4 * k, hy);
        ctx.lineTo(sx + face * 10 * k, hy + 1 * k);
      } else {
        ctx.moveTo(hx, hy + 3 * k);
        ctx.lineTo(hx + face * 1 * k, hy - 12 * k);
      }
      ctx.stroke();
      ctx.fillStyle = '#c9ced6';
      if (striking || u.state === 'engage' || u.state === 'fight') ctx.fillRect(sx + face * 10 * k - 1 * k, hy, 2 * k, 2 * k);
      if (u.type === 'horseman') {
        ctx.fillStyle = '#7a5a3a'; // round shield on the far side
        ctx.beginPath(); ctx.arc(sx - face * 2.8 * k, top + 3 * k, 2.6 * k, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'raider': {
      // round wooden shield and an axe raised to strike
      ctx.fillStyle = '#8a6a44';
      ctx.beginPath(); ctx.arc(sx + face * 2.6 * k, top + 4 * k, 3 * k, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#c9a36b';
      ctx.lineWidth = 0.6 * k;
      ctx.beginPath(); ctx.arc(sx + face * 2.6 * k, top + 4 * k, 1.8 * k, 0, Math.PI * 2); ctx.stroke();
      const up = striking ? 0 : 1;
      ctx.strokeStyle = '#5a3c22';
      ctx.lineWidth = 0.9 * k;
      ctx.beginPath();
      ctx.moveTo(sx - face * 2 * k, hy + 2 * k);
      ctx.lineTo(sx - face * (2 - up * 1) * k + face * (striking ? 5 : 0) * k, hy - (up ? 7 : 1) * k);
      ctx.stroke();
      ctx.fillStyle = '#9aa1aa';
      ctx.fillRect(sx - face * (1 - up) * k + face * (striking ? 5 : 0) * k - 1.2 * k, hy - (up ? 8 : 2) * k, 2.4 * k, 2 * k);
      break;
    }
    case 'slinger': {
      // sling whirling overhead
      const a = t * 18 + u.id;
      ctx.strokeStyle = '#6b4a2a';
      ctx.lineWidth = 0.5 * k;
      ctx.beginPath();
      ctx.moveTo(hx, hy - 2 * k);
      const r = striking ? 5 : 3;
      ctx.lineTo(hx + Math.cos(a) * r * k, hy - 5 * k + Math.sin(a) * r * 0.5 * k);
      ctx.stroke();
      break;
    }
    default:
      break;
  }
}

/** Health bar over a wounded unit; flashes white for a moment after a hit. */
function drawHealth(ctx, u, sx, y, k, tick) {
  const w = 12 * k;
  const h = 2 * k;
  const f = Math.max(0, u.hp / u.maxHp);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(sx - w / 2 - 0.5 * k, y - 0.5 * k, w + k, h + k);
  ctx.fillStyle = f > 0.6 ? '#5ec04a' : f > 0.3 ? '#e0b03a' : '#d9412b';
  ctx.fillRect(sx - w / 2, y, w * f, h);
  if (tick - u.hitTick < 4) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 0.6 * k;
    ctx.strokeRect(sx - w / 2 - 0.5 * k, y - 0.5 * k, w + k, h + k);
  }
}

// ---------------------------------------------------------------------------
// Projectiles & flags
// ---------------------------------------------------------------------------

/** An arrow (short shaft pointing along its flight) or a sling stone. */
export function drawProjectile(ctx, p, sx, sy, k) {
  if (p.kind === 'firepot') {
    // a clay pot trailing flame
    ctx.fillStyle = 'rgba(255,150,40,0.75)';
    ctx.beginPath();
    ctx.ellipse(sx - (p.vx - p.vy || 0) * 6 * k, sy - 1.5 * k, 1.4 * k, 2.4 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5a3c22';
    ctx.beginPath();
    ctx.arc(sx, sy, 1.6 * k, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (p.kind === 'stone') {
    ctx.fillStyle = '#6f675c';
    ctx.beginPath();
    ctx.arc(sx, sy, 1.3 * k, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // screen direction of travel
  const dx = (p.vx || 0) - (p.vy || 0);
  const dy = ((p.vx || 0) + (p.vy || 0)) * 0.5;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  ctx.strokeStyle = '#4a3a2a';
  ctx.lineWidth = 0.9 * k;
  ctx.beginPath();
  ctx.moveTo(sx - ux * 4 * k, sy - uy * 4 * k);
  ctx.lineTo(sx + ux * 4 * k, sy + uy * 4 * k);
  ctx.stroke();
  ctx.fillStyle = '#f2eee6';
  ctx.fillRect(sx - ux * 4 * k - 0.8 * k, sy - uy * 4 * k - 0.8 * k, 1.6 * k, 1.6 * k);
}

/** Standard planted at a deployment point, in the fort's color. */
export function drawRallyFlag(ctx, sx, sy, k, color, t) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, 3 * k, 1.2 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5e3b20';
  ctx.fillRect(sx - 0.7 * k, sy - 24 * k, 1.4 * k, 24 * k);
  const wave = Math.sin(t * 3) * 1.2 * k;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(sx + 0.7 * k, sy - 24 * k);
  ctx.lineTo(sx + 10 * k, sy - 23 * k + wave);
  ctx.lineTo(sx + 8 * k, sy - 20 * k + wave);
  ctx.lineTo(sx + 10 * k, sy - 17 * k + wave);
  ctx.lineTo(sx + 0.7 * k, sy - 18 * k);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#d6ab3c';
  ctx.fillRect(sx - 1.4 * k, sy - 27 * k, 2.8 * k, 3 * k);
}

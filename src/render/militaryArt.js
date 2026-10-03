/**
 * militaryArt.js
 * ----------------------------------------------------------------------------
 * Art for the military layer, all procedural and original:
 *
 *   wallSpec()        cached sprite for a wall or gate tile (connects to
 *                     neighboring walls, gates and watchtowers)
 *   drawUnit()        soldiers, raiders of every people (data/peoples.js: from
 *                     swordsmen and axemen to war chariots and elephants),
 *                     gladiators in revolt and wolves, drawn live every frame
 *                     like walkers (ships of war: shipArt.js)
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
 * @param {number} [facing] which way it looks on the screen (1 right, -1 left):
 *   the sim's `u.facing` is for the unturned view, the renderer passes the
 *   turned view's own (Renderer.unitFace)
 */
export function drawUnit(ctx, u, sx, sy, k, t, tick, highlight = false, stride = u.walked || 0, facing = u.facing) {
  const def = UNIT_TYPES[u.type];
  if (def.naval) { drawWarship(ctx, u, sx, sy, k, t, tick, highlight, stride, facing); return; }
  const face = facing < 0 ? -1 : 1;
  // Legs step with the distance marched (still when halted or paused, quicker when running).
  const phase = u.moving ? Math.sin(stride * (def.mounted ? HOOF_RAD : STEP_RAD) + u.id) : 0;
  const striking = tick - u.strikeTick < 8;
  const enemy = def.side === 'enemy';
  const native = def.side === 'native'; // a native village's man (sim/natives.js): hair, no helmet, a spear

  if (highlight) {
    ctx.strokeStyle = 'rgba(255,230,120,0.9)';
    ctx.lineWidth = 1.2 * k;
    ctx.beginPath();
    ctx.ellipse(sx, sy, (u.type === 'elephant' || u.type === 'chariot' ? 11 : 7) * k, 3 * k, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Beasts and cars have shapes of their own.
  if (u.type === 'wolf') { drawWolf(ctx, u, sx, sy, k, face, stride, striking, tick); return; }
  if (u.type === 'elephant') { drawElephant(ctx, u, def, sx, sy, k, face, stride, striking, tick); return; }
  if (u.type === 'chariot') { drawChariot(ctx, u, def, sx, sy, k, face, stride, striking, tick); return; }
  // shadow (tinted red under raiders so they read as hostile at a glance;
  // orange under a villager while his village attacks)
  ctx.fillStyle = enemy ? 'rgba(120,0,0,0.35)' : native && u.attacking ? 'rgba(150,80,0,0.35)' : 'rgba(0,0,0,0.25)';
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
  // Bare-chested fighters: the axeman under a fur over one shoulder, the
  // gladiator with a broad belt and an arm guard. (The tunic shows below as a kilt.)
  if (u.type === 'axeman' || u.type === 'gladiator') {
    ctx.fillStyle = skin;
    ctx.fillRect(sx - 2.5 * k, top, 5 * k, 4.6 * k);
    if (u.type === 'axeman') {
      ctx.fillStyle = '#6a5440';
      ctx.beginPath();
      ctx.moveTo(sx - face * 2.6 * k, top);
      ctx.lineTo(sx + face * 0.6 * k, top);
      ctx.lineTo(sx - face * 2.6 * k, top + 4.6 * k);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = '#c9a24a';
      ctx.fillRect(sx - 2.7 * k, top + 4.2 * k, 5.4 * k, 1.2 * k);
      ctx.fillStyle = '#b8bec6';
      ctx.fillRect(sx + face * 2.4 * k - 0.7 * k, top + 0.6 * k, 1.4 * k, 3.4 * k);
    }
  }
  // A hoplite's bronze greaves.
  if (u.type === 'hoplite') {
    ctx.fillStyle = '#b8873a';
    ctx.fillRect(sx - 1.8 * k, sy - 4 * k, 1.3 * k, 3 * k);
    ctx.fillRect(sx + 0.5 * k, sy - 4 * k, 1.3 * k, 3 * k);
  }
  // Caesar's own legionaries (sim/legion.js) are Romans too: armor and helmet, not a barbarian's hair.
  const imperial = u.type === 'imperial';
  if (u.type === 'legionary' || u.type === 'cavalry' || imperial) {
    // segmented iron armor over the tunic
    ctx.fillStyle = '#8a9099';
    ctx.fillRect(sx - 2.5 * k, top + 0.5 * k, 5 * k, 4 * k);
    ctx.fillStyle = 'rgba(40,40,50,0.4)';
    ctx.fillRect(sx - 2.5 * k, top + 2.2 * k, 5 * k, 0.6 * k);
  }
  // Checked trousers: the northern peoples (not the Greek-armed, the
  // Numidians or a gladiator).
  const helmeted = u.type === 'hoplite' || u.type === 'gladiator';
  if (enemy && !def.mounted && !imperial && !helmeted && u.type !== 'javelineer') {
    ctx.fillStyle = 'rgba(40,60,90,0.35)';
    ctx.fillRect(sx - 3 * k, bottom - 2 * k, 6 * k, 2 * k);
  }

  // head
  const hy = top - 2.6 * k;
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(sx, hy, 2.4 * k, 0, Math.PI * 2);
  ctx.fill();
  if (u.type === 'hoplite') {
    // A bronze helmet with cheek guards and a tall crest across it.
    ctx.fillStyle = '#b8873a';
    ctx.beginPath();
    ctx.arc(sx, hy - 0.3 * k, 2.8 * k, Math.PI * 0.85, Math.PI * 2.15);
    ctx.fill();
    ctx.fillRect(sx - face * 0.6 * k - 1 * k, hy - 0.3 * k, 2 * k, 2.6 * k);
    ctx.fillStyle = '#2a2420';
    ctx.beginPath();
    ctx.ellipse(sx - face * 0.4 * k, hy - 4.2 * k, 3.6 * k, 1.4 * k, 0, Math.PI, 0);
    ctx.fill();
  } else if (u.type === 'gladiator') {
    // A broad-brimmed helmet with a grille over the face and a crest.
    ctx.fillStyle = '#a9afb8';
    ctx.beginPath();
    ctx.arc(sx, hy - 0.2 * k, 2.9 * k, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(sx - 3.8 * k, hy - 0.4 * k, 7.6 * k, 0.9 * k);
    ctx.fillStyle = 'rgba(30,30,36,0.75)';
    ctx.fillRect(sx + face * 0.5 * k - 1.1 * k, hy + 0.5 * k, 2.2 * k, 1.8 * k);
    ctx.fillStyle = '#b8322a';
    ctx.fillRect(sx - 0.7 * k, hy - 5.4 * k, 1.4 * k, 2.6 * k);
  } else if (u.type === 'javelineer') {
    // Close dark curls under a headband.
    ctx.fillStyle = '#2a201a';
    ctx.beginPath();
    ctx.arc(sx, hy - 0.7 * k, 2.6 * k, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#e8dcc0';
    ctx.fillRect(sx - 2.6 * k, hy - 1 * k, 5.2 * k, 0.7 * k);
  } else if ((enemy && !imperial) || native) {
    // wild hair and a beard
    ctx.fillStyle = BARB_HAIR[u.id % BARB_HAIR.length];
    ctx.beginPath();
    ctx.arc(sx, hy - 0.8 * k, 2.8 * k, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(sx - face * 3 * k - 0.8 * k, hy - 1 * k, 1.6 * k, 4.5 * k);
    ctx.fillRect(sx + face * 0.4 * k - 1.2 * k, hy + 1 * k, 2.4 * k, 1.6 * k);
    if (u.type === 'swordsman') {
      // A Celtic iron cap with a knob on top, over the hair.
      ctx.fillStyle = '#8f969e';
      ctx.beginPath();
      ctx.arc(sx, hy - 1 * k, 2.6 * k, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(sx - 0.6 * k, hy - 4.6 * k, 1.2 * k, 1.2 * k);
    }
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
    case 'villager': {
      // a hunting spear, thrust when striking
      ctx.strokeStyle = '#6b4a2a';
      ctx.lineWidth = 0.9 * k;
      ctx.beginPath();
      if (striking) { ctx.moveTo(sx - face * 3 * k, hy + 1 * k); ctx.lineTo(sx + face * 9 * k, hy); } else { ctx.moveTo(hx, hy + 4 * k); ctx.lineTo(hx + face * 1.5 * k, hy - 10 * k); }
      ctx.stroke();
      ctx.fillStyle = '#9aa1aa';
      if (striking) ctx.fillRect(sx + face * 9 * k - 1 * k, hy - 1 * k, 2 * k, 2 * k);
      else ctx.fillRect(hx + face * 1.5 * k - 0.8 * k, hy - 12 * k, 1.6 * k, 2.4 * k);
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
    case 'swordsman': {
      // A tall narrow oval shield with a spine and boss, and a long sword.
      const shx = sx + face * 2.4 * k;
      ctx.fillStyle = '#4f7a52';
      ctx.beginPath();
      ctx.ellipse(shx, top + 4 * k, 1.9 * k, 5 * k, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2f4a32';
      ctx.lineWidth = 0.6 * k;
      ctx.beginPath(); ctx.moveTo(shx, top - 0.6 * k); ctx.lineTo(shx, top + 8.6 * k); ctx.stroke();
      ctx.fillStyle = '#b9bec4';
      ctx.beginPath(); ctx.arc(shx, top + 4 * k, 0.8 * k, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#c9ced6';
      ctx.lineWidth = 1 * k;
      ctx.beginPath();
      ctx.moveTo(sx - face * 1.5 * k, hy + 1 * k);
      if (striking) ctx.lineTo(sx + face * 8 * k, hy + 0.5 * k);
      else ctx.lineTo(sx - face * 2.5 * k, hy - 7 * k);
      ctx.stroke();
      break;
    }
    case 'axeman': {
      // A long-hafted axe in both hands: over the head, then down.
      const ax = striking ? sx + face * 6 * k : sx - face * 1 * k;
      const ay = striking ? hy + 1 * k : hy - 9 * k;
      ctx.strokeStyle = '#5a3c22';
      ctx.lineWidth = 1.1 * k;
      ctx.beginPath(); ctx.moveTo(sx + face * 0.5 * k, hy + 2 * k); ctx.lineTo(ax, ay); ctx.stroke();
      ctx.fillStyle = '#9aa1aa';
      ctx.beginPath();
      ctx.moveTo(ax, ay - 1.8 * k);
      ctx.lineTo(ax + face * 2.6 * k, ay - 2.6 * k);
      ctx.lineTo(ax + face * 2.6 * k, ay + 2.6 * k);
      ctx.lineTo(ax, ay + 1.8 * k);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'javelineer': {
      // A small round shield and a few javelins; one thrown forward when striking.
      ctx.fillStyle = '#9a7a4a';
      ctx.beginPath(); ctx.arc(sx - face * 2.4 * k, top + 3.5 * k, 2.2 * k, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#7a5a34';
      ctx.lineWidth = 0.6 * k;
      ctx.beginPath();
      for (const d of [-0.8, 0, 0.8]) {
        ctx.moveTo(hx + d * k, hy + 3 * k);
        ctx.lineTo(hx + (d + face * 1.5) * k, hy - 8 * k);
      }
      ctx.stroke();
      if (striking) {
        ctx.beginPath(); ctx.moveTo(hx, hy - 2 * k); ctx.lineTo(hx + face * 9 * k, hy - 4 * k); ctx.stroke();
      }
      break;
    }
    case 'hoplite': {
      // A great round bronze shield in front and a long spear, overhand when striking.
      ctx.strokeStyle = '#6b4a2a';
      ctx.lineWidth = 0.9 * k;
      ctx.beginPath();
      if (striking) { ctx.moveTo(sx - face * 5 * k, hy - 1 * k); ctx.lineTo(sx + face * 11 * k, hy + 1.5 * k); }
      else { ctx.moveTo(hx, hy + 5 * k); ctx.lineTo(hx + face * 1 * k, hy - 13 * k); }
      ctx.stroke();
      ctx.fillStyle = '#c4923e';
      ctx.beginPath(); ctx.arc(sx + face * 2.2 * k, top + 4 * k, 4 * k, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#8a6224';
      ctx.lineWidth = 0.7 * k;
      ctx.beginPath(); ctx.arc(sx + face * 2.2 * k, top + 4 * k, 3.3 * k, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#3a2a1e'; // the shield's painted device
      ctx.beginPath(); ctx.arc(sx + face * 2.2 * k, top + 4 * k, 1.1 * k, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'gladiator': {
      // A short curved shield and a gladius.
      ctx.fillStyle = '#8a2a24';
      ctx.fillRect(sx + face * 1.8 * k - (face < 0 ? 3 * k : 0), top + 0.5 * k, 3 * k, 7 * k);
      ctx.strokeStyle = '#d6ab3c';
      ctx.lineWidth = 0.5 * k;
      ctx.strokeRect(sx + face * 1.8 * k - (face < 0 ? 3 * k : 0), top + 0.5 * k, 3 * k, 7 * k);
      ctx.strokeStyle = '#d0d5dc';
      ctx.lineWidth = 1 * k;
      ctx.beginPath();
      ctx.moveTo(sx - face * 1.5 * k, hy + 2 * k);
      ctx.lineTo(sx - face * 1.5 * k + face * (striking ? 9 : 3) * k, hy + (striking ? 1 : -3) * k);
      ctx.stroke();
      break;
    }
    default:
      break;
  }
}

/**
 * A grey wolf, side on: a low body, four legs at a trot, the tail out
 * behind and the head forward, lowered and jaws open when it bites.
 */
function drawWolf(ctx, u, sx, sy, k, face, stride, striking, tick) {
  const fur = u.id % 3 === 0 ? '#8a8172' : u.id % 3 === 1 ? '#6f685d' : '#7d7568';
  const phase = u.moving ? Math.sin(stride * HOOF_RAD * 1.4 + u.id) : 0;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, 5 * k, 1.6 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  // legs
  ctx.strokeStyle = shade(fur, -0.3);
  ctx.lineWidth = 1 * k;
  ctx.beginPath();
  for (const [lx, sw] of [[-2.8, 1], [-1.8, -1], [2, -1], [3, 1]]) {
    ctx.moveTo(sx + face * lx * k, sy - 3.6 * k);
    ctx.lineTo(sx + face * (lx + phase * sw * 1.1) * k, sy);
  }
  ctx.stroke();
  // tail
  ctx.strokeStyle = fur;
  ctx.lineWidth = 1.4 * k;
  ctx.beginPath();
  ctx.moveTo(sx - face * 3.8 * k, sy - 4.6 * k);
  ctx.quadraticCurveTo(sx - face * 6.4 * k, sy - 4.4 * k, sx - face * 6.6 * k, sy - 2.2 * k);
  ctx.stroke();
  // body, with a paler belly
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(sx, sy - 4.6 * k, 4.4 * k, 1.9 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shade(fur, 0.25);
  ctx.beginPath();
  ctx.ellipse(sx, sy - 3.7 * k, 3 * k, 0.8 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  // head: neck, skull, snout, ears
  const low = striking ? 1.6 : 0;
  const hx = sx + face * 4.6 * k;
  const hy = sy - (6.4 - low) * k;
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(hx, hy, 1.7 * k, 1.4 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(hx + face * 0.8 * k, hy - 0.6 * k);
  ctx.lineTo(hx + face * 3.4 * k, hy + 0.2 * k);
  ctx.lineTo(hx + face * 0.8 * k, hy + 1 * k);
  ctx.closePath();
  ctx.fill();
  if (striking) {
    ctx.strokeStyle = '#a8322b';
    ctx.lineWidth = 0.6 * k;
    ctx.beginPath(); ctx.moveTo(hx + face * 1 * k, hy + 0.6 * k); ctx.lineTo(hx + face * 3.2 * k, hy + 1.4 * k); ctx.stroke();
  }
  ctx.fillStyle = shade(fur, -0.25);
  ctx.beginPath();
  ctx.moveTo(hx - face * 0.6 * k, hy - 1 * k);
  ctx.lineTo(hx - face * 0.1 * k, hy - 2.8 * k);
  ctx.lineTo(hx + face * 0.5 * k, hy - 1.1 * k);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e8d070';
  ctx.fillRect(hx + face * 0.7 * k - 0.3 * k, hy - 0.5 * k, 0.6 * k, 0.5 * k);
  if (u.hp < u.maxHp) drawHealth(ctx, u, sx, sy - 11 * k, k, tick);
}

/**
 * A war elephant: a grey hulk on four pillar legs, trunk and tusks forward,
 * a wooden tower on its back with a spearman in it. Drawn about twice a
 * man's size, so it reads at a glance among the warband.
 */
function drawElephant(ctx, u, def, sx, sy, k, face, stride, striking, tick) {
  const hide = def.color;
  const phase = u.moving ? Math.sin(stride * STEP_RAD * 0.7 + u.id) : 0;
  ctx.fillStyle = 'rgba(120,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, 10 * k, 3 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  // legs: far pair darker, then near pair
  for (const [lx, sw, dark] of [[-4.6, -1, 0.3], [3.6, 1, 0.3], [-3.2, 1, 0.12], [5, -1, 0.12]]) {
    ctx.fillStyle = shade(hide, -dark);
    ctx.fillRect(sx + face * (lx + phase * sw * 0.8) * k - 1.3 * k, sy - 7 * k, 2.6 * k, 7 * k);
  }
  // body
  ctx.fillStyle = hide;
  ctx.beginPath();
  ctx.ellipse(sx, sy - 10 * k, 8.4 * k, 5.4 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  // head, ear, trunk (swung forward when it strikes) and a tusk
  const hx = sx + face * 7.4 * k;
  const hy = sy - 12.6 * k;
  ctx.beginPath();
  ctx.arc(hx, hy, 3.6 * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shade(hide, -0.15);
  ctx.beginPath();
  ctx.ellipse(hx - face * 1.6 * k, hy + 0.4 * k, 2 * k, 3 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hide;
  ctx.lineWidth = 2 * k;
  ctx.beginPath();
  ctx.moveTo(hx + face * 2.6 * k, hy + 1 * k);
  if (striking) ctx.quadraticCurveTo(hx + face * 7 * k, hy - 1 * k, hx + face * 7.6 * k, hy - 5 * k);
  else ctx.quadraticCurveTo(hx + face * 4.6 * k, hy + 6 * k, hx + face * 3.4 * k, sy - 1.5 * k);
  ctx.stroke();
  ctx.strokeStyle = '#f2ece0';
  ctx.lineWidth = 0.9 * k;
  ctx.beginPath();
  ctx.moveTo(hx + face * 2 * k, hy + 2 * k);
  ctx.quadraticCurveTo(hx + face * 4.6 * k, hy + 3 * k, hx + face * 5.4 * k, hy + 0.8 * k);
  ctx.stroke();
  ctx.fillStyle = '#1a1612';
  ctx.fillRect(hx + face * 1.2 * k - 0.4 * k, hy - 1.2 * k, 0.8 * k, 0.8 * k);
  // the tower, a red cloth under it, and its spearman
  ctx.fillStyle = '#9a2a24';
  ctx.fillRect(sx - 5 * k, sy - 15.4 * k, 9 * k, 3 * k);
  ctx.fillStyle = '#8a6a3a';
  ctx.fillRect(sx - 4 * k, sy - 20.5 * k, 7 * k, 5.4 * k);
  ctx.strokeStyle = '#5a4426';
  ctx.lineWidth = 0.6 * k;
  ctx.strokeRect(sx - 4 * k, sy - 20.5 * k, 7 * k, 5.4 * k);
  ctx.fillStyle = SKIN[u.id % SKIN.length];
  ctx.beginPath(); ctx.arc(sx - 0.5 * k, sy - 22.4 * k, 1.8 * k, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#b8873a';
  ctx.beginPath(); ctx.arc(sx - 0.5 * k, sy - 22.8 * k, 1.9 * k, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = '#6b4a2a';
  ctx.lineWidth = 0.8 * k;
  ctx.beginPath();
  ctx.moveTo(sx + face * 1 * k, sy - 19 * k);
  ctx.lineTo(sx + face * (striking ? 9 : 2.5) * k, sy - (striking ? 18 : 28) * k);
  ctx.stroke();
  if (u.hp < u.maxHp) drawHealth(ctx, u, sx, sy - 27 * k, k, tick);
}

/**
 * A war chariot: two ponies yoked to a light car on a big spoked wheel, a
 * driver at the reins and a spearman behind him.
 */
function drawChariot(ctx, u, def, sx, sy, k, face, stride, striking, tick) {
  const phase = u.moving ? Math.sin(stride * HOOF_RAD + u.id) : 0;
  ctx.fillStyle = 'rgba(120,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, 10 * k, 2.4 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  // the far pony a little behind the near one
  horse(ctx, sx + face * 5.6 * k, sy - 0.8 * k, k * 0.8, '#5a4030', face, -phase, '#1a120c');
  horse(ctx, sx + face * 4.4 * k, sy, k * 0.85, '#7a5436', face, phase, '#2a1a10');
  // pole from the car to the yoke
  ctx.strokeStyle = '#5a3c22';
  ctx.lineWidth = 0.8 * k;
  ctx.beginPath(); ctx.moveTo(sx - face * 2 * k, sy - 4 * k); ctx.lineTo(sx + face * 8 * k, sy - 9 * k); ctx.stroke();
  // the car: a wicker box over the axle
  const cx = sx - face * 5 * k;
  ctx.fillStyle = '#9a7a44';
  ctx.fillRect(cx - 3.4 * k, sy - 7.6 * k, 6.8 * k, 4 * k);
  ctx.strokeStyle = '#6a5228';
  ctx.lineWidth = 0.5 * k;
  ctx.strokeRect(cx - 3.4 * k, sy - 7.6 * k, 6.8 * k, 4 * k);
  // the wheel, its spokes turning with the ground covered
  const wr = 3.2 * k;
  const wy = sy - wr;
  ctx.strokeStyle = '#3a2a1a';
  ctx.lineWidth = 0.9 * k;
  ctx.beginPath(); ctx.arc(cx, wy, wr, 0, Math.PI * 2); ctx.stroke();
  const a0 = -face * stride * 1.3;
  ctx.lineWidth = 0.5 * k;
  ctx.beginPath();
  for (let s = 0; s < 4; s++) {
    const a = a0 + (s * Math.PI) / 4;
    ctx.moveTo(cx - Math.cos(a) * wr, wy - Math.sin(a) * wr);
    ctx.lineTo(cx + Math.cos(a) * wr, wy + Math.sin(a) * wr);
  }
  ctx.stroke();
  // crew: the driver forward, the spearman behind
  for (const [dx, spear] of [[1.4, false], [-1.6, true]]) {
    const x = cx + face * dx * k;
    ctx.fillStyle = def.color;
    ctx.fillRect(x - 1.4 * k, sy - 12.6 * k, 2.8 * k, 5.4 * k);
    ctx.fillStyle = SKIN[(u.id + (spear ? 1 : 0)) % SKIN.length];
    ctx.beginPath(); ctx.arc(x, sy - 14.2 * k, 1.7 * k, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = BARB_HAIR[(u.id + (spear ? 2 : 0)) % BARB_HAIR.length];
    ctx.beginPath(); ctx.arc(x, sy - 14.8 * k, 1.9 * k, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = spear ? '#6b4a2a' : '#3a2a1a';
    ctx.lineWidth = (spear ? 0.8 : 0.4) * k;
    ctx.beginPath();
    if (spear) {
      ctx.moveTo(x, sy - 11 * k);
      ctx.lineTo(x + face * (striking ? 12 : 2) * k, sy - (striking ? 11 : 21) * k);
    } else {
      ctx.moveTo(x + face * 1 * k, sy - 10 * k);
      ctx.lineTo(sx + face * 9 * k, sy - 10.5 * k); // the reins
    }
    ctx.stroke();
  }
  if (u.hp < u.maxHp) drawHealth(ctx, u, sx, sy - 22 * k, k, tick);
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

/**
 * An arrow (short shaft pointing along its flight) or a sling stone. (vx, vy):
 * its velocity in view tiles (the map's own unless the view is turned).
 */
export function drawProjectile(ctx, p, sx, sy, k, vx = p.vx || 0, vy = p.vy || 0) {
  if (p.kind === 'firepot') {
    // a clay pot trailing flame
    ctx.fillStyle = 'rgba(255,150,40,0.75)';
    ctx.beginPath();
    ctx.ellipse(sx - (vx - vy) * 6 * k, sy - 1.5 * k, 1.4 * k, 2.4 * k, 0, 0, Math.PI * 2);
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
  const dx = vx - vy;
  const dy = (vx + vy) * 0.5;
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

/**
 * A fort's number in Roman numerals ("III") over its standard, so the
 * player can tell which army holds where and which Shift key finds it.
 * Gold on a dark edge to read on grass, sand and water alike. Left out
 * zoomed far out, where it would be larger than the standard itself.
 */
export function drawStandardNumber(ctx, sx, sy, k, text, dpr = 1) {
  if (k < 0.45 * dpr) return;
  const px = Math.round(Math.max(7 * k, 9 * dpr));
  ctx.save();
  ctx.font = `bold ${px}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, 0.3 * px);
  ctx.strokeStyle = 'rgba(30,20,10,0.85)';
  const x = sx + 4 * k;
  const y = sy - 29 * k;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#f3d27a';
  ctx.fillText(text, x, y);
  ctx.restore();
}

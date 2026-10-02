/**
 * buildingArt.js
 * ----------------------------------------------------------------------------
 * Procedural art for every building and house tier, built from the simple
 * primitives in draw.js (boxes, roofs, columns, windows). All original.
 *
 * buildingSpec(key, size, variant, state, live) returns a sprite spec for
 * sprites.js. `state` carries art-relevant status: house tier, farm growth
 * stage, reservoir filled, etc. It is part of the cache key.
 *
 * Flags: FLAG_SPECS lists every flag and banner. In the game view (`live`)
 * the sprite keeps only the poles and the renderer draws the cloth every
 * frame so it flutters (liveArt.js); icons and other still pictures get a
 * painted cloth.
 *
 * Painter's order inside each drawing: back (small u+v) first, front last.
 * ----------------------------------------------------------------------------
 */

import { HALF_W, CONFIG } from '../config.js';
import { HOUSE_TIERS } from '../data/housing.js';
import { GOODS } from '../data/goods.js';
import { BUILDINGS } from '../data/buildings.js';
import { UNIT_TYPES } from '../data/units.js';
import { GODS } from '../data/gods.js';
import { P, poly, quad, ground, box, gableRoof, hipRoof, colonnade, windows, door, shade, mix, tree, bareTree, cypress, hash01, horse, setRoofSnow, roofSnowAmount, SNOW } from './draw.js';
import { drawTurned, drawTurnedOver, withOrigin, turnUV, unit, decal, TS } from './turn.js';
import { shipyardArt, wharfArt } from './waterArt.js';
import { navaliaArt, stationArt, portusArt } from './navyArt.js';
import { hippodromeArt, chariotMakerArt } from './hippodromeArt.js';
import { nativeHutArt, nativeMeetingArt, nativeCropsArt, missionPostArt } from './nativeArt.js';

const TH = CONFIG.TILE_H;

export const COL = Object.freeze({
  cream: '#e8dcc0',
  white: '#f1ece2',
  ochre: '#d6ac6b',
  pink: '#dfb49c',
  mud: '#b8986a',
  wood: '#8a5a33',
  woodDark: '#5e3b20',
  terra: '#b8573a',
  terraDark: '#93432c',
  thatch: '#c9a75b',
  marble: '#f2eee6',
  stone: '#a79f8f',
  stoneDark: '#7f7768',
  paving: '#cfc2a2',
  soil: '#7d5c3b',
  soilLight: '#9a7650',
  grass: '#6f9e46',
  water: '#4a90c8',
  cloth: '#ece2c8',
  gold: '#d6ab3c',
  iron: '#6f7680',
  slate: '#6d7480',
  sand: '#dcc58e',
});

/** Extra art height (px above the footprint's top corner) per key. */
const HEIGHT = {
  house: 70, well: 24, fountain: 26, reservoir: 30, barber: 34, clinic: 34, baths: 50, hospital: 50,
  oracle: 56, school: 44, library: 52, academy: 60, theater: 40, amphitheater: 46, colosseum: 70,
  actor_troupe: 44, gladiator_school: 40, menagerie: 40, forum: 46, senate: 84, garden: 30,
  governor_house: 52, governor_villa: 66, governor_palace: 104,
  statue_small: 40, statue_medium: 64, statue_large: 90, triumphal_arch: 82, engineer_post: 44, prefecture: 40,
  clay_pit: 30, timber_yard: 34, iron_mine: 40, marble_quarry: 40, market: 36, granary: 50, warehouse: 40,
  barracks: 36, fort_legion: 36, fort_archer: 36, fort_cavalry: 36, tower: 66, horse_ranch: 34, dock: 44,
  shipyard: 36, wharf: 30, hippodrome: 46, hippodrome_part: 46, chariot_maker: 34, navalia: 42, naval_station: 58,
  portus: 40, military_academy: 48,
  native_hut: 34, native_meeting: 34, native_crops: 18, mission_post: 44,
};

/**
 * How far (in tiles) a building's shadow reaches across the ground. The sun
 * is in the upper left (the same light the art is shaded with), so shadows
 * fall to the lower right. Flat things (fields, plazas) cast almost none.
 */
const SHADOW = {
  well: 0.15, fountain: 0.2, reservoir: 0.25, garden: 0.15, plaza: 0, market: 0.3, horse_ranch: 0.25,
  clay_pit: 0.08, iron_mine: 0.45, marble_quarry: 0.35, dock: 0.35, statue_small: 0.35, statue_medium: 0.6,
  statue_large: 0.9, triumphal_arch: 0.9, tower: 1.15, senate: 1.1, colosseum: 1.05, amphitheater: 0.7, theater: 0.55, granary: 0.8,
  warehouse: 0.4, barracks: 0.55, fort_legion: 0.5, fort_archer: 0.5, fort_cavalry: 0.5, engineer_post: 0.45,
  prefecture: 0.45, shipyard: 0.3, wharf: 0.25, hippodrome: 0.35, hippodrome_part: 0.35, chariot_maker: 0.45,
  navalia: 0.4, naval_station: 0.55, portus: 0.3, military_academy: 0.5, governor_house: 0.55, governor_villa: 0.75, governor_palace: 1.0,
  native_crops: 0.05, native_hut: 0.5, native_meeting: 0.4,
};
/** Shadow length per house level (tents are low, insulae tall, villas wide but low, palaces tall). */
const HOUSE_SHADOW = [0, 0.18, 0.2, 0.22, 0.26, 0.3, 0.34, 0.45, 0.5, 0.5, 0.65, 0.95, 1.1, 0.5, 0.55, 0.55, 0.6, 0.65, 0.7, 0.85, 0.9];

export function shadowLength(b) {
  if (b.house) return HOUSE_SHADOW[b.house.tier] ?? 0.3;
  if (SHADOW[b.type] !== undefined) return SHADOW[b.type];
  const kind = b.def.kind;
  if (kind === 'farm') return 0.2;
  if (kind === 'decor') return 0.2;
  if (kind === 'workshop') return 0.5;
  return Math.min(1.1, heightFor(b.type, b.size) / 70);
}

function heightFor(key, size) {
  if (key.startsWith('temple_large_')) return 84;
  if (key.startsWith('temple_')) return 56;
  if (key.startsWith('farm_')) return 34;
  if (key.endsWith('_ws')) return 50;
  return HEIGHT[key] ?? 30 + size * 16;
}

/**
 * Buildings that look the same from every side (round, or square and
 * symmetric): drawn as written whatever their turn, which spares them the
 * recorder and keeps arches drawn on their two front faces in front.
 */
export const SAME_EVERY_WAY = new Set(['well', 'fountain', 'reservoir', 'amphitheater', 'colosseum', 'oracle', 'statue_small', 'native_hut']);

/**
 * Sprite spec for a building.
 * @param {string} key   building type
 * @param {number} S     footprint size
 * @param {number} variant 0..3
 * @param {*} state      extra art state (tier, stage, filled...)
 */
export function buildingSpec(key, S, variant = 0, state = 0, live = false, snow = 0, sick = false, turn = 0) {
  const extra = heightFor(key, S);
  return {
    w: S * CONFIG.TILE_W,
    h: extra + S * TH + 2,
    ax: S * HALF_W,
    ay: extra,
    draw(ctx) {
      const fn = ART[key] || (key.startsWith('temple_') ? templeArt : key.startsWith('farm_') ? farmArt : key.endsWith('_ws') ? workshopArt : genericArt);
      liveFlags = live;
      setRoofSnow(snow);
      try {
        // Turned art (turn.js): the same drawing, turned in its footprint
        // (round and square-symmetric buildings look the same from every side).
        drawTurned(ctx, S, SAME_EVERY_WAY.has(key) ? 0 : turn, (c) => fn(c, S, variant, state, key));
        if (sick) sickSign(ctx, S, extra); // (always at the front corner, whatever the turn)
      } finally {
        liveFlags = false;
        setRoofSnow(0);
      }
    },
  };
}

/**
 * A sick home (sim/disease.js): the whole house drawn a little pale and
 * sallow, and a pale cloth hung on a pole at its front corner, the old sign
 * to keep away from a house with fever in it.
 */
function sickSign(ctx, S, extra) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop'; // tint only what the house drew
  ctx.fillStyle = 'rgba(206,222,150,0.28)';
  ctx.fillRect(-S * HALF_W - 2, -extra - 2, S * CONFIG.TILE_W + 4, extra + S * TH + 6);
  ctx.restore();
  const [x, y] = P(S - 0.12, S - 0.42);
  ctx.fillStyle = COL.woodDark;
  ctx.fillRect(x - 0.6, y - 15, 1.2, 15);
  ctx.fillStyle = '#e9ecd2';
  ctx.beginPath();
  ctx.moveTo(x + 0.6, y - 15);
  ctx.lineTo(x + 7, y - 14);
  ctx.lineTo(x + 6.2, y - 9.5);
  ctx.lineTo(x + 7.4, y - 7.5);
  ctx.lineTo(x + 0.6, y - 8.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,130,70,0.8)';
  ctx.lineWidth = 0.6;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Flags and banners
// ---------------------------------------------------------------------------

/** True while drawing a sprite for the game view: flags get poles only. */
let liveFlags = false;

/**
 * Every flag, by building type. Pole foot at footprint (u, v, z) - or at
 * local pixels (x, y) - pole height h, cloth width w and height ch, color,
 * swallowtail or plain. Functions receive the footprint size S.
 */
const FLAG_SPECS = {
  prefecture: () => [{ u: 0.86, v: 0.3, z: 16, h: 12, w: 6, ch: 5, color: '#c0392b' }],
  forum: () => [{ u: 1.35, v: 1.3, z: 4, h: 12, w: 5.5, ch: 4, color: '#a8322b' }],
  senate: (S) => [
    { u: 0.4, v: S - 0.4, z: 36, h: 14, w: 6.5, ch: 4.5, color: '#6b3fa0' },
    { u: S - 0.4, v: 0.4, z: 36, h: 14, w: 6.5, ch: 4.5, color: '#6b3fa0' },
  ],
  colosseum: (S) => [-40, 0, 40].map((dx) => ({ x: dx, y: (S * TH) / 2 - 48, h: 12, w: 6.5, ch: 4, color: '#a8322b' })),
  // The governor's banners (GOV.banner): at his gate, on his roof, on every wing of the palace.
  governor_house: (S) => [S * 0.42 - 0.12, S * 0.42 + 1.02].map((u) => ({ u, v: S - 0.32, z: 7, h: 13, w: 5.5, ch: 7, color: GOV.banner })),
  governor_villa: (S) => [1.1, S - 0.3].map((u) => ({ u, v: 0.85, z: 36, h: 14, w: 6.5, ch: 4.5, color: GOV.banner, swallow: true })),
  governor_palace: (S) => [[0.82, 0.45], [S - 0.82, 0.45], [0.82, S - 1.25], [S - 0.82, S - 1.25]].map(([u, v]) => ({ u, v, z: 34, h: 15, w: 7, ch: 4.5, color: GOV.banner, swallow: true })),
  barracks: (S) => [{ u: S - 0.35, v: 0.3, z: 26, h: 14, w: 9.5, ch: 5.2, color: '#a8322b', swallow: true }],
  military_academy: (S) => [{ u: S - 0.42, v: 1.32, z: 5, h: 20, w: 9.5, ch: 5.2, color: '#a8322b', swallow: true }], // on the instructor's tribunal
  fort: (S, key) => [{ u: S * 0.5, v: S * 0.5, z: 0, h: 26, w: 9.5, ch: 5.2, color: UNIT_TYPES[BUILDINGS[key]?.unit]?.color || '#a8322b', swallow: true }],
};

const flagCache = new Map();

/**
 * Flags of a building type: pole TOP in local px, cloth size and style.
 * @returns {Array<{x:number,y:number,h:number,w:number,ch:number,color:string,swallow:boolean}>}
 */
export function flagsFor(key, S, turn = 0) {
  const ck = `${key}:${S}:${turn & 3}`;
  let list = flagCache.get(ck);
  if (list) return list;
  const fn = FLAG_SPECS[key] || (key.startsWith('fort_') ? FLAG_SPECS.fort : null);
  list = (fn ? fn(S, key) : []).map((f) => {
    // A flag placed by footprint (u, v) turns with the building (pixel-placed
    // ones are on round buildings, the same from every side).
    let at = null;
    if (f.u !== undefined) {
      const [u, v] = turnUV(f.u, f.v, S, turn);
      at = { u, v, z: f.z };
    }
    const [x, y] = at ? [(at.u - at.v) * HALF_W, (at.u + at.v) * (TH / 2) - at.z] : [f.x, f.y];
    return { x, y: y - f.h, h: f.h, w: f.w, ch: f.ch, color: f.color, swallow: !!f.swallow, at };
  });
  flagCache.set(ck, list);
  return list;
}

/** Outline of a flag's cloth hanging still from the pole top (x, y). */
function clothPath(ctx, x, y, f) {
  ctx.beginPath();
  ctx.moveTo(x + 0.6, y);
  ctx.lineTo(x + f.w, y);
  if (f.swallow) ctx.lineTo(x + f.w * 0.8, y + f.ch / 2);
  ctx.lineTo(x + f.w, y + f.ch);
  ctx.lineTo(x + 0.6, y + f.ch);
  ctx.closePath();
}

/** Draw a building's flag poles (and, for still pictures, their cloth). */
function flagPoles(ctx, key, S) {
  for (const f of flagsFor(key, S, TS.t)) {
    // (Its own unit when turned: the pole from its foot up, cloth and all.)
    const b = f.at ? [f.at.u, f.at.u, f.at.v, f.at.v, f.at.z, f.at.z + f.h + f.ch] : null;
    unit(b, () => flagPole(ctx, f));
  }
}

function flagPole(ctx, f) {
  ctx.fillStyle = COL.woodDark;
  ctx.fillRect(f.x - 0.6, f.y, 1.2, f.h);
  if (f.swallow) {
    ctx.fillStyle = COL.gold;
    ctx.fillRect(f.x - 1.3, f.y - 2.4, 2.6, 2.4); // eagle-ish finial
  }
  if (!liveFlags) {
    ctx.fillStyle = f.color;
    clothPath(ctx, f.x, f.y, f);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Houses
// ---------------------------------------------------------------------------

/**
 * House looks. Homes get 8 variants (the renderer passes id % 8): the low two
 * bits pick colors from these palettes, the third bit (`alt`) swaps in
 * extra details such as shutters, flower boxes, chimneys, jars and fences.
 */
const WALLS = [COL.cream, COL.white, '#e6d2b0', '#efe0c9'];
const WALLS_ALT = ['#ead3bd', '#dccdb4', '#f1e6cf', '#e0c9a2'];
const ROOFS = [COL.terra, COL.terraDark, '#c26a3e', '#a45b44'];
const DOORS = ['#4a3222', '#5a2a1f', '#2f4a5a', '#3d5a3a'];
const SHUTTERS = ['#4f7a52', '#4d6f8f', '#8a5a33', '#7a4f6a'];

/** Wall color for a home variant (0..7). */
const houseWall = (variant) => ((variant >> 2) & 1 ? WALLS_ALT : WALLS)[variant % 4];

/** A clay storage jar (amphora) standing at (u, v). */
function jar(ctx, u, v, color = '#b8683f') {
  const [x, y] = P(u, v);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(x - 1, y - 0.5, 3.5, 1);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(x, y - 3, 2, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(x - 0.9, y - 7, 1.8, 1.6);
  ctx.fillStyle = shade(color, 0.25);
  ctx.fillRect(x - 1.2, y - 4.5, 0.8, 2);
}

/** A little wooden fence along the front edges of a plot (from u0/v0 to 1). */
function fence(ctx, u0, v0, color = COL.wood) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.7;
  const a = P(u0, 0.95, 3);
  const b = P(0.95, 0.95, 3);
  const c = P(0.95, v0, 3);
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
  ctx.fillStyle = shade(color, -0.2);
  for (let k = 0; k <= 4; k++) {
    const [px, py] = P(u0 + ((0.95 - u0) * k) / 4, 0.95);
    ctx.fillRect(px - 0.4, py - 3.6, 0.8, 3.6);
    const [qx, qy] = P(0.95, v0 + ((0.95 - v0) * k) / 4);
    ctx.fillRect(qx - 0.4, qy - 3.6, 0.8, 3.6);
  }
}

/**
 * A home: `tier` is its level (0 = vacant lot). Levels 1-10 are single-tile
 * homes (a 2x2 block of them is drawn as four), 11-12 insulae, 13-18 villas
 * (2x2, then 3x3) and 19-20 palaces (4x4).
 */
function houseArt(ctx, S, variant, tier) {
  const native = tier === 0 ? 1 : HOUSE_TIERS[tier].size;
  if (S > native && native === 1) {
    // A 2x2 block of single-tile homes: four homes, each with its own look.
    for (let s = 0; s <= 2 * (S - 1); s++) {
      for (let i = 0; i < S; i++) {
        const j = s - i;
        if (j < 0 || j >= S) continue;
        // (Drawn in its own square of the footprint, so a turned block turns as one.)
        withOrigin(i, j, () => smallHouse(ctx, (variant + i * 3 + j * 5) % 8, tier));
      }
    }
    return;
  }
  if (native === 1) { smallHouse(ctx, variant, tier); return; }
  if (tier <= 12) { insulaArt(ctx, S, variant, tier === 12); return; }
  if (tier <= 18) { villaArt(ctx, S, variant, tier - 13); return; }
  palaceArt(ctx, S, variant, tier - 19);
}

/** Awning colors for shop fronts. */
const AWNINGS = ['#b8573a', '#5d7fa3', '#a38b3d', '#7a9c5a'];

function smallHouse(ctx, variant, tier) {
  const wall = houseWall(variant);
  const alt = (variant >> 2) & 1; // second look: extra details
  const pal = variant % 4;
  switch (tier) {
    case 0: {
      quad(ctx, 0.12, 0.12, 0.88, 0.88, 0, '#b8a071');
      const stakes = [[0.15, 0.15], [0.85, 0.15], [0.85, 0.85], [0.15, 0.85]];
      ctx.strokeStyle = '#e8e0cc';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      stakes.forEach(([u, v], k) => { const p = P(u, v, 3); if (k === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
      ctx.closePath();
      ctx.stroke();
      for (const [u, v] of stakes) { const [x, y] = P(u, v); ctx.fillStyle = COL.woodDark; ctx.fillRect(x - 0.6, y - 4, 1.2, 4); }
      // sign
      const [sx, sy] = P(0.62, 0.78);
      ctx.fillStyle = COL.woodDark;
      ctx.fillRect(sx - 0.5, sy - 9, 1, 9);
      ctx.fillStyle = '#e9d9a8';
      ctx.fillRect(sx - 4, sy - 12, 8, 4);
      return;
    }
    case 1: {
      // Tent
      quad(ctx, 0.1, 0.1, 0.9, 0.9, 0, '#a7925f');
      const cloth = ['#e9dcc0', '#d9c7a3', '#efe6d2', '#cdb894'][variant % 4];
      gableRoof(ctx, 0.18, 0.22, 0.58, 0.46, 0, 13, cloth, 'u', 0);
      // entrance flap
      poly(ctx, [P(0.76, 0.35), P(0.76, 0.55), P(0.76, 0.45, 9)], '#4b3a28');
      if (variant % 2 === 0) {
        gableRoof(ctx, 0.5, 0.62, 0.3, 0.26, 0, 8, shade(cloth, -0.08), 'v', 0);
      }
      // campfire stones
      const [fx, fy] = P(0.3, 0.8);
      ctx.fillStyle = '#6b5f52';
      ctx.fillRect(fx - 2, fy - 1, 4, 2);
      return;
    }
    case 2: {
      // Family Tent: a big tent, a second one beside it, an awning over the
      // cooking place and a water jar from the well.
      quad(ctx, 0.07, 0.07, 0.93, 0.93, 0, '#a58f5c');
      const cloth = ['#e9dcc0', '#d9c7a3', '#efe6d2', '#cdb894'][variant % 4];
      gableRoof(ctx, 0.12, 0.14, 0.54, 0.46, 0, 14, cloth, 'u', 0);
      poly(ctx, [P(0.66, 0.26), P(0.66, 0.46), P(0.66, 0.36, 9)], '#4b3a28');
      gableRoof(ctx, 0.6, 0.12, 0.3, 0.34, 0, 10, shade(cloth, -0.1), 'v', 0);
      // awning: a sheet on two poles, sloping to the front
      for (const u of [0.2, 0.58]) {
        const [x, y] = P(u, 0.86);
        ctx.fillStyle = COL.woodDark;
        ctx.fillRect(x - 0.5, y - 7, 1, 7);
      }
      poly(ctx, [P(0.18, 0.64, 10), P(0.6, 0.64, 10), P(0.6, 0.88, 7), P(0.18, 0.88, 7)], shade(cloth, alt ? -0.18 : 0.04), shade(cloth, -0.4), 0.5);
      const [fx, fy] = P(0.38, 0.78);
      ctx.fillStyle = '#6b5f52';
      ctx.fillRect(fx - 2, fy - 1, 4, 2);
      ctx.fillStyle = '#3d3630';
      ctx.fillRect(fx - 1.2, fy - 3.2, 2.4, 2.2); // cooking pot
      jar(ctx, 0.84, 0.72, '#8a6a4a');
      return;
    }
    case 3: {
      // Lean-to
      quad(ctx, 0.1, 0.1, 0.9, 0.9, 0, '#a08a5c');
      box(ctx, 0.2, 0.22, 0.58, 0.5, 0, 9, alt ? '#7d5431' : COL.wood);
      // mono-pitch plank roof
      poly(ctx, [P(0.16, 0.18, 12), P(0.82, 0.18, 12), P(0.82, 0.76, 8), P(0.16, 0.76, 8)], alt ? '#8a6a44' : '#9b7446', '#5a3c22', 0.6);
      const sn = roofSnowAmount();
      if (sn > 0) {
        // Snow on the planks, from the high edge down (deeper snow reaches further).
        const f = Math.min(1, 0.2 + 0.95 * sn);
        poly(ctx, [P(0.16, 0.18, 12), P(0.82, 0.18, 12), P(0.82, 0.18 + 0.58 * f, 12 - 4 * f), P(0.16, 0.18 + 0.58 * f, 12 - 4 * f)], SNOW);
      }
      door(ctx, 'left', 0.2, 0.22, 0.78, 0.72, 0, 0.35, '#3d2a1a', 0.14, 6);
      if (alt) {
        fence(ctx, 0.35, 0.3, '#8a6a44');
      } else {
        // wood pile
        const [wx, wy] = P(0.82, 0.84);
        ctx.fillStyle = '#6e4a2a';
        ctx.fillRect(wx - 3, wy - 3, 6, 3);
        ctx.fillStyle = '#8a6040';
        ctx.fillRect(wx - 3, wy - 3, 6, 0.8);
      }
      return;
    }
    case 4: {
      // Hut
      quad(ctx, 0.08, 0.08, 0.92, 0.92, 0, '#a59067');
      box(ctx, 0.18, 0.2, 0.64, 0.6, 0, 10, alt ? '#bfa276' : COL.mud);
      hipRoof(ctx, 0.18, 0.2, 0.64, 0.6, 10, 9, alt ? '#b8954c' : COL.thatch);
      door(ctx, 'left', 0.18, 0.2, 0.82, 0.8, 0, 0.5, DOORS[pal], 0.14, 6);
      if (alt) {
        // a small vegetable patch
        quad(ctx, 0.62, 0.84, 0.9, 0.95, 0, '#6d5638');
        for (let k = 0; k < 3; k++) { const [x, y] = P(0.66 + k * 0.1, 0.9); ctx.fillStyle = '#5f9a48'; ctx.fillRect(x - 1, y - 1.6, 2, 1.6); }
      } else {
        jar(ctx, 0.84, 0.62);
      }
      return;
    }
    case 5: {
      // Cottage
      quad(ctx, 0.06, 0.06, 0.94, 0.94, 0, '#b3a27a');
      box(ctx, 0.16, 0.16, 0.68, 0.66, 0, 12, wall);
      gableRoof(ctx, 0.16, 0.16, 0.68, 0.66, 12, 9, ROOFS[pal], variant % 2 ? 'u' : 'v');
      if (alt) box(ctx, 0.62, 0.3, 0.1, 0.1, 16, 8, COL.stoneDark); // chimney, rising out of the roof
      door(ctx, 'left', 0.16, 0.16, 0.84, 0.82, 0, 0.3, DOORS[pal]);
      windows(ctx, 'right', 0.16, 0.16, 0.84, 0.82, 0, 1, 2, '#4a3a2a', { z: 5, h: 3.5, shutters: alt ? SHUTTERS[pal] : null });
      if (!alt) jar(ctx, 0.9, 0.55, '#c7643e');
      return;
    }
    case 6: {
      // Stone Cottage: dressed stone walls, a tiled roof, a chimney and a
      // walled herb garden (or a fruit tree).
      quad(ctx, 0.05, 0.05, 0.95, 0.95, 0, '#b5a77f');
      const stone = alt ? '#b9ae98' : COL.stone;
      box(ctx, 0.14, 0.14, 0.62, 0.6, 0, 14, stone);
      gableRoof(ctx, 0.14, 0.14, 0.62, 0.6, 14, 9, ROOFS[pal], variant % 2 ? 'v' : 'u');
      box(ctx, 0.56, 0.24, 0.1, 0.1, 18, 9, COL.stoneDark);
      door(ctx, 'left', 0.14, 0.14, 0.76, 0.74, 0, 0.3, DOORS[pal]);
      windows(ctx, 'right', 0.14, 0.14, 0.76, 0.74, 0, 1, 2, '#4a3a2a', { z: 5, h: 4, shutters: SHUTTERS[(pal + alt) % 4] });
      if (alt) {
        box(ctx, 0.8, 0.14, 0.06, 0.72, 0, 3, COL.stoneDark, { plain: true });
        for (let k = 0; k < 3; k++) { const [x, y] = P(0.88, 0.3 + k * 0.2); ctx.fillStyle = '#5f9a48'; ctx.fillRect(x - 1.2, y - 2, 2.4, 2); }
      } else {
        tree(ctx, 0.86, 0.84, 0.42, '#4f8a3c', '#6b4a2a', variant);
      }
      return;
    }
    case 7: {
      // Townhouse
      quad(ctx, 0.05, 0.05, 0.95, 0.95, 0, COL.paving);
      box(ctx, 0.12, 0.12, 0.76, 0.74, 0, 21, wall);
      hipRoof(ctx, 0.12, 0.12, 0.76, 0.74, 21, 9, ROOFS[alt ? (pal + 2) % 4 : 0]);
      windows(ctx, 'left', 0.12, 0.12, 0.88, 0.86, 0, 2, 3, '#4a3a2a', { z: 5, h: 4, gap: 9, flowers: alt === 1 });
      windows(ctx, 'right', 0.12, 0.12, 0.88, 0.86, 0, 2, 2, '#4a3a2a', { z: 5, h: 4, gap: 9, shutters: alt ? null : SHUTTERS[pal] });
      return;
    }
    case 8: {
      // Merchant House: a shop on the ground floor, the family above.
      quad(ctx, 0.04, 0.04, 0.96, 0.96, 0, COL.paving);
      box(ctx, 0.1, 0.1, 0.78, 0.74, 0, 24, wall);
      hipRoof(ctx, 0.1, 0.1, 0.78, 0.74, 24, 9, ROOFS[(pal + 1) % 4]);
      windows(ctx, 'left', 0.1, 0.1, 0.88, 0.84, 0, 1, 3, '#4a3a2a', { z: 14, h: 4, flowers: alt === 0 });
      windows(ctx, 'right', 0.1, 0.1, 0.88, 0.84, 0, 1, 2, '#4a3a2a', { z: 14, h: 4, shutters: alt ? SHUTTERS[pal] : null });
      poly(ctx, [P(0.2, 0.84, 1), P(0.72, 0.84, 1), P(0.72, 0.84, 9), P(0.2, 0.84, 9)], '#3a2c20');
      poly(ctx, [P(0.16, 0.84, 11), P(0.76, 0.84, 11), P(0.76, 0.98, 7.5), P(0.16, 0.98, 7.5)], AWNINGS[pal], shade(AWNINGS[pal], -0.4), 0.5);
      door(ctx, 'right', 0.1, 0.1, 0.88, 0.84, 0, 0.62, DOORS[pal], 0.14, 8);
      jar(ctx, 0.84, 0.93, '#c7643e');
      if (alt) jar(ctx, 0.12, 0.92, '#b8683f');
      return;
    }
    case 9: {
      // Domus: L-shaped house around a tiny courtyard
      quad(ctx, 0.04, 0.04, 0.96, 0.96, 0, COL.paving);
      box(ctx, 0.08, 0.08, 0.84, 0.36, 0, 17, wall);
      gableRoof(ctx, 0.08, 0.08, 0.84, 0.36, 17, 8, ROOFS[pal], 'u');
      if (alt) cypress(ctx, 0.3, 0.72, 0.6);
      else tree(ctx, 0.32, 0.72, 0.55, '#4f8a3c', '#6b4a2a', variant);
      box(ctx, 0.58, 0.44, 0.34, 0.48, 0, 14, shade(wall, -0.04));
      gableRoof(ctx, 0.58, 0.44, 0.34, 0.48, 14, 7, ROOFS[(pal + 1) % 4], 'v');
      windows(ctx, 'right', 0.58, 0.44, 0.92, 0.92, 0, 1, 2, '#4a3a2a', { z: 5, h: 4, shutters: alt ? SHUTTERS[pal] : null, flowers: !alt });
      door(ctx, 'left', 0.58, 0.44, 0.92, 0.92, 0, 0.5, DOORS[pal]);
      if (alt) jar(ctx, 0.5, 0.9, '#b8683f');
      return;
    }
    default: {
      // Apartment House: a narrow three-storey block with a shop below.
      const a = 0.1;
      const b = 0.9;
      const ochre = ['#d6ac6b', '#dcb77e', '#cfa262', '#e0bf88'][pal];
      quad(ctx, 0.03, 0.03, 0.97, 0.97, 0, COL.paving);
      box(ctx, a, a, b - a, b - a, 0, 32, ochre);
      hipRoof(ctx, a, a, b - a, b - a, 32, 7, COL.terra, 0.05);
      windows(ctx, 'left', a, a, b, b, 0, 2, 2, '#3f3126', { z: 13, h: 4.5, gap: 10, shutters: alt ? SHUTTERS[pal] : null });
      windows(ctx, 'right', a, a, b, b, 0, 2, 2, '#3f3126', { z: 13, h: 4.5, gap: 10, flowers: !alt });
      poly(ctx, [P(0.22, b, 2), P(0.62, b, 2), P(0.62, b, 8), P(0.22, b, 8)], '#3a2c20');
      poly(ctx, [P(0.2, b, 10), P(0.64, b, 10), P(0.64, b + 0.12, 7), P(0.2, b + 0.12, 7)], AWNINGS[(pal + 1) % 4]);
      door(ctx, 'right', a, a, b, b, 0, 0.5, DOORS[pal], 0.14, 7);
      if (alt) {
        // a wooden balcony along the right face
        ctx.strokeStyle = COL.woodDark;
        ctx.lineWidth = 0.8;
        const p = P(b + 0.06, a + 0.1, 21);
        const q = P(b + 0.06, b - 0.1, 21);
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
      }
    }
  }
}

/** Tenement (4 floors, balconies) and Insula (5 floors, pink, roof garden). */
function insulaArt(ctx, S, variant, grand) {
  const floors = grand ? 5 : 4;
  const colors = grand ? ['#e2b9a1', '#e8c4a8', '#dcae96', '#e9cdb4'] : ['#d6ac6b', '#dcb77e', '#cfa262', '#e0bf88'];
  const wall = colors[variant % 4];
  const h = floors * 10 + 2;
  const a = 0.12;
  const b = S - 0.12;
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, COL.paving);
  box(ctx, a, a, b - a, b - a, 0, h, wall);
  // roof: shallow tiled hip roof
  hipRoof(ctx, a, a, b - a, b - a, h, 7, COL.terra, 0.05);
  const cols = Math.round(S * 3);
  const alt = (variant >> 2) & 1;
  windows(ctx, 'left', a, a, b, b, 0, floors - 1, cols, '#3f3126', { z: 14, h: 4.5, gap: 10, shutters: alt ? SHUTTERS[variant % 4] : null });
  windows(ctx, 'right', a, a, b, b, 0, floors - 1, cols, '#3f3126', { z: 14, h: 4.5, gap: 10, flowers: alt === 0 });
  if (alt) {
    // washing hung out on a line across the right face
    const z = 10 * (floors - 1) + 9;
    const p = P(b + 0.08, a + 0.15, z);
    const q = P(b + 0.08, b - 0.15, z);
    ctx.strokeStyle = '#6b5a48';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    const cloth = ['#f2eee6', '#b8573a', '#5d7fa3', '#e8d7a0'];
    for (let k = 0; k < 4; k++) {
      const t = 0.18 + k * 0.2;
      const x = p[0] + (q[0] - p[0]) * t;
      const y = p[1] + (q[1] - p[1]) * t;
      ctx.fillStyle = cloth[(k + variant) % 4];
      ctx.fillRect(x - 1.2, y, 2.4, 2.6 + (k % 2));
    }
  }
  // ground floor shops with awnings
  for (let k = 0; k < cols; k++) {
    const t0 = (k + 0.15) / cols;
    const t1 = (k + 0.85) / cols;
    const u0 = a + (b - a) * t0;
    const u1 = a + (b - a) * t1;
    poly(ctx, [P(u0, b, 3), P(u1, b, 3), P(u1, b, 8), P(u0, b, 8)], '#3a2c20');
    poly(ctx, [P(u0, b, 10), P(u1, b, 10), P(u1, b + 0.12, 7), P(u0, b + 0.12, 7)], AWNINGS[(k + variant) % 4]);
  }
  // wooden balconies along the right face
  ctx.strokeStyle = COL.woodDark;
  ctx.lineWidth = 0.8;
  for (let f = 1; f < floors - 1; f++) {
    const z = 10 * f + 11;
    const p = P(b + 0.06, a + 0.1, z);
    const q = P(b + 0.06, b - 0.1, z);
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
  }
  if (grand) {
    // roof garden
    for (let k = 0; k < 3; k++) {
      const [x, y] = P(a + 0.4 + k * 0.35, a + 0.35 + (k % 2) * 0.3, h + 3);
      ctx.fillStyle = k % 2 ? '#4f8a3c' : '#5f9a48';
      ctx.beginPath(); ctx.arc(x, y - 2, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/**
 * Villas around a courtyard with a pool. `grade` 0-1 are the 2x2 Villa and
 * Garden Villa, 2-5 the 3x3 Peristyle Villa, Marble Villa, Mansion and
 * Palatium: marble walls from grade 3, taller halls, more columns, gold
 * accents from grade 4 and a dome on the Palatium.
 */
function villaArt(ctx, S, variant, grade) {
  const small = S < 3;
  const marble = grade >= 3;
  const wall = marble ? COL.marble : houseWall(variant);
  const roof = grade >= 4 ? '#a8513a' : ROOFS[variant % 2 ? 2 : 0];
  const alt = (variant >> 2) & 1;
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, '#7fa956');
  // garden path
  quad(ctx, S * 0.52, S * 0.52, S * 0.6, S - 0.1, 0, COL.paving);
  // back wing
  const d = small ? 0.7 : 0.85;
  const wingH = small ? (grade >= 1 ? 17 : 14) : grade >= 3 ? 24 : 16;
  box(ctx, 0.12, 0.12, S - 0.24, d, 0, wingH, wall);
  gableRoof(ctx, 0.12, 0.12, S - 0.24, d, wingH, small ? 7 : 9, roof, 'u');
  // side wing
  const sideH = small ? 12 : 16;
  box(ctx, 0.12, 0.12 + d, d, S - 0.45 - d, 0, sideH, shade(wall, -0.03));
  gableRoof(ctx, 0.12, 0.12 + d, d, S - 0.45 - d, sideH, small ? 6 : 8, shade(roof, -0.05), 'v');
  // courtyard pool
  const pool = small ? 0.36 : grade >= 3 ? 0.7 : 0.5;
  const pu = S * 0.62;
  const pv = S * 0.5 + (small ? 0.25 : 0.2);
  quad(ctx, pu - pool / 2, pv - pool / 2, pu + pool / 2, pv + pool / 2, 0, '#e4dccb');
  quad(ctx, pu - pool / 2 + 0.06, pv - pool / 2 + 0.06, pu + pool / 2 - 0.06, pv + pool / 2 - 0.06, 0.5, COL.water);
  // peristyle columns along the courtyard edge
  const cu = 0.12 + d + 0.08;
  const cv = 0.12 + d + 0.05;
  colonnade(ctx, cu, cv, S - 0.15, cv, small ? 3 : grade >= 3 ? 6 : 4, 0, small ? 11 : 14, COL.marble, small ? 1.3 : 1.6);
  if (grade === 1) {
    // Garden Villa: flower beds and a fruit tree in the court
    quad(ctx, S - 0.55, 1.0, S - 0.15, 1.3, 0, '#5d8a3e');
    for (let k = 0; k < 3; k++) { const [x, y] = P(S - 0.5 + k * 0.14, 1.18); ctx.fillStyle = k % 2 ? '#d9534f' : '#f0c24a'; ctx.fillRect(x - 0.8, y - 1.6, 1.6, 1.4); }
    tree(ctx, S - 0.35, S - 0.75, 0.5, '#4f8a3c', '#6b4a2a', variant + 3);
  }
  if (alt) {
    // clipped hedges along the front and a statue in the garden
    box(ctx, 1.05, S - 0.2, S - 1.2, 0.12, 0, 4, '#4f7a3a', { top: '#5f8f46' });
    const [sx, sy] = P(S - 0.5, S - 0.55);
    ctx.fillStyle = COL.stone;
    ctx.fillRect(sx - 2.5, sy - 3, 5, 3);
    ctx.fillStyle = '#ece6d8';
    ctx.fillRect(sx - 1.2, sy - 10, 2.4, 7);
    ctx.beginPath(); ctx.arc(sx, sy - 11, 1.6, 0, Math.PI * 2); ctx.fill();
    cypress(ctx, 1.2, S - 0.35, small ? 0.6 : 0.75);
  } else {
    cypress(ctx, S - 0.3, S - 0.35, small ? 0.65 : 0.8);
    tree(ctx, 1.25, S - 0.3, small ? 0.55 : 0.7, '#4f8a3c', '#6b4a2a', variant);
  }
  if (grade === 4) {
    // Mansion: gilded finials on the gable ends of the hall
    for (const u of [0.1, S - 0.14]) {
      const [x, y] = P(u, 0.12 + d / 2, wingH + 9);
      ctx.fillStyle = COL.gold;
      ctx.fillRect(x - 1, y - 4, 2, 4);
    }
  }
  if (grade >= 5) {
    // Palatium: a dome and golden accents on the main wing
    const [x, y] = P(S * 0.5, 0.55, wingH + 8);
    ctx.fillStyle = '#e9e4d8';
    ctx.beginPath(); ctx.ellipse(x, y, 13, 7, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#d6cfbf';
    ctx.beginPath(); ctx.ellipse(x, y, 13, 3, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = COL.gold;
    ctx.fillRect(x - 1, y - 11, 2, 4);
  }
  if (grade >= 4) colonnade(ctx, 0.2, cv, 0.9, cv, 4, 0, 18, COL.marble, 1.6);
}

/**
 * Palaces (4x4): a domed hall across the back, a long wing on the left, a
 * paved court with colonnades, a fountain pool and statues. `grade` 1 (the
 * Imperial Palatium) adds gilding, a larger dome and a second fountain.
 */
function palaceArt(ctx, S, variant, grade) {
  const alt = (variant >> 2) & 1;
  const wall = COL.marble;
  const roof = grade ? '#9c4a36' : '#a8513a';
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, '#7fa956');
  quad(ctx, 1.15, 1.25, S - 0.2, S - 0.2, 0, COL.paving);
  // hall across the back
  const hd = 1.0;
  const hallH = grade ? 34 : 30;
  box(ctx, 0.12, 0.12, S - 0.24, hd, 0, hallH, wall);
  gableRoof(ctx, 0.12, 0.12, S - 0.24, hd, hallH, 11, roof, 'u');
  windows(ctx, 'right', 0.12, 0.12, S - 0.12, 0.12 + hd, 0, 2, 2, '#4a3a2a', { z: 8, h: 6, gap: 12 });
  // long wing on the left
  const wingH = grade ? 24 : 22;
  box(ctx, 0.12, 0.12 + hd, 0.9, S - 0.45 - hd, 0, wingH, shade(wall, -0.03));
  gableRoof(ctx, 0.12, 0.12 + hd, 0.9, S - 0.45 - hd, wingH, 9, shade(roof, -0.05), 'v');
  windows(ctx, 'left', 0.12, 0.12 + hd, 1.02, S - 0.33, 0, 1, 2, '#4a3a2a', { z: 8, h: 6 });
  // dome on the hall
  const [x, y] = P(S * 0.52, 0.62, hallH + 10);
  const r = grade ? 18 : 15;
  ctx.fillStyle = '#ece7db';
  ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.55, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#d6cfbf';
  ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.22, 0, 0, Math.PI); ctx.fill();
  ctx.fillStyle = COL.gold;
  ctx.fillRect(x - 1.2, y - r * 0.55 - 5, 2.4, 5);
  if (grade) {
    ctx.fillStyle = shade(COL.gold, -0.1);
    ctx.fillRect(x - r, y - 1, r * 2, 1.6); // gilded ring at the dome's foot
  }
  // colonnades facing the court
  colonnade(ctx, 1.2, 1.2, S - 0.2, 1.2, 8, 0, 18, COL.marble, 1.7);
  colonnade(ctx, 1.1, 1.45, 1.1, S - 0.4, 5, 0, 16, COL.marble, 1.6);
  // fountain pool in the court
  const pu = S * 0.62;
  const pv = S * 0.62;
  const pool = grade ? 1.0 : 0.85;
  quad(ctx, pu - pool / 2, pv - pool / 2, pu + pool / 2, pv + pool / 2, 0, '#e4dccb');
  quad(ctx, pu - pool / 2 + 0.07, pv - pool / 2 + 0.07, pu + pool / 2 - 0.07, pv + pool / 2 - 0.07, 0.5, COL.water);
  // garden beds either side of the pool
  for (const [u0, v0, u1, v1] of [[1.45, pv - 0.3, pu - pool / 2 - 0.15, pv + 0.3], [pu - 0.3, 1.5, pu + 0.3, pv - pool / 2 - 0.15]]) {
    quad(ctx, u0, v0, u1, v1, 0, '#5d8a3e');
    for (let k = 0; k < 3; k++) {
      const [bx, by] = P(u0 + ((u1 - u0) * (k + 0.5)) / 3, v0 + ((v1 - v0) * (k + 0.5)) / 3);
      ctx.fillStyle = (k + variant) % 3 ? '#4f7a3a' : '#d9534f';
      ctx.beginPath(); ctx.arc(bx, by - 1.6, 1.8, 0, Math.PI * 2); ctx.fill();
    }
  }
  const [fx, fy] = P(pu, pv, 1);
  ctx.fillStyle = COL.marble;
  ctx.fillRect(fx - 1.5, fy - 7, 3, 7);
  ctx.fillStyle = grade ? COL.gold : '#d6cfbf';
  ctx.fillRect(fx - 3, fy - 8, 6, 1.6);
  // statues on the court corners and cypresses along the front
  for (const [u, v] of [[S - 0.45, 1.55], [1.5, S - 0.45]]) {
    const [sx, sy] = P(u, v);
    ctx.fillStyle = COL.stone;
    ctx.fillRect(sx - 2.5, sy - 3, 5, 3);
    ctx.fillStyle = grade ? COL.gold : '#ece6d8';
    ctx.fillRect(sx - 1.2, sy - 10, 2.4, 7);
    ctx.beginPath(); ctx.arc(sx, sy - 11, 1.6, 0, Math.PI * 2); ctx.fill();
  }
  if (alt) {
    box(ctx, 1.3, S - 0.18, S - 1.5, 0.1, 0, 4, '#4f7a3a', { top: '#5f8f46' });
  } else {
    cypress(ctx, S - 0.3, S - 0.3, 0.85);
    cypress(ctx, 0.35, S - 0.3, 0.8);
  }
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

function wellArt(ctx) {
  quad(ctx, 0.15, 0.15, 0.85, 0.85, 0, COL.paving);
  const [x, y] = P(0.5, 0.5);
  ctx.fillStyle = shade(COL.stone, -0.2);
  ctx.beginPath(); ctx.ellipse(x, y, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = COL.stone;
  ctx.fillRect(x - 10, y - 5, 20, 5);
  ctx.beginPath(); ctx.ellipse(x, y - 5, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2c4a66';
  ctx.beginPath(); ctx.ellipse(x, y - 5, 7, 3.4, 0, 0, Math.PI * 2); ctx.fill();
  // wooden frame
  ctx.fillStyle = COL.woodDark;
  ctx.fillRect(x - 9, y - 17, 1.6, 12);
  ctx.fillRect(x + 7.4, y - 17, 1.6, 12);
  ctx.fillRect(x - 9, y - 18, 18, 1.6);
  ctx.fillStyle = '#8a6a44';
  ctx.fillRect(x - 1.5, y - 14, 3, 3.5);
}

function fountainArt(ctx, S, v, filled) {
  quad(ctx, 0.08, 0.08, 0.92, 0.92, 0, COL.paving);
  box(ctx, 0.2, 0.2, 0.6, 0.6, 0, 4, COL.stone);
  quad(ctx, 0.26, 0.26, 0.74, 0.74, 4.1, filled ? COL.water : '#8a7d68');
  const [x, y] = P(0.5, 0.5, 4);
  ctx.fillStyle = COL.marble;
  ctx.fillRect(x - 1.5, y - 10, 3, 10);
  ctx.beginPath(); ctx.ellipse(x, y - 10, 4, 1.8, 0, 0, Math.PI * 2); ctx.fill();
  if (filled) {
    ctx.strokeStyle = 'rgba(200,230,255,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - 11); ctx.quadraticCurveTo(x - 5, y - 17, x - 7, y - 3);
    ctx.moveTo(x, y - 11); ctx.quadraticCurveTo(x + 5, y - 17, x + 7, y - 3);
    ctx.stroke();
  }
}

function reservoirArt(ctx, S, v, filled) {
  const h = 12;
  box(ctx, 0.1, 0.1, S - 0.2, S - 0.2, 0, h, COL.stone, { noTop: true });
  // rim
  quad(ctx, 0.1, 0.1, S - 0.1, S - 0.1, h, shade(COL.stone, 0.15));
  quad(ctx, 0.35, 0.35, S - 0.35, S - 0.35, h, filled ? '#3f86c0' : '#8a7a5e');
  if (filled) {
    ctx.strokeStyle = 'rgba(220,240,255,0.6)';
    ctx.lineWidth = 0.8;
    for (let k = 1; k < 4; k++) {
      const p = P(0.6, 0.35 + k * 0.55, h);
      const q = P(S - 0.6, 0.35 + k * 0.55, h);
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    }
  }
  // arches along the visible faces
  ctx.fillStyle = 'rgba(40,32,24,0.55)';
  for (let k = 0; k < 3; k++) {
    const t = 0.5 + k;
    for (const face of ['left', 'right']) {
      const a = face === 'left' ? P(t - 0.25, S - 0.1, 0) : P(S - 0.1, t - 0.25, 0);
      const b2 = face === 'left' ? P(t + 0.25, S - 0.1, 0) : P(S - 0.1, t + 0.25, 0);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(a[0], a[1] - 5);
      ctx.quadraticCurveTo((a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2 - 11, b2[0], b2[1] - 5);
      ctx.lineTo(b2[0], b2[1]);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

function smallShop(ctx, wall, roof, awning, sign) {
  quad(ctx, 0.05, 0.05, 0.95, 0.95, 0, COL.paving);
  box(ctx, 0.14, 0.14, 0.72, 0.62, 0, 15, wall);
  gableRoof(ctx, 0.14, 0.14, 0.72, 0.62, 15, 8, roof, 'u');
  // awning over the door
  poly(ctx, [P(0.3, 0.76, 11), P(0.7, 0.76, 11), P(0.7, 0.92, 7), P(0.3, 0.92, 7)], awning, shade(awning, -0.4), 0.5);
  door(ctx, 'left', 0.14, 0.14, 0.86, 0.76, 0, 0.5, '#3d2a1a', 0.16, 6);
  if (sign) {
    const [x, y] = P(0.86, 0.5, 12);
    ctx.fillStyle = sign;
    ctx.fillRect(x - 1, y - 4, 4, 5);
  }
}

function barberArt(ctx) {
  smallShop(ctx, COL.white, COL.terra, '#c8a24a', '#b8573a');
  // stool + basin in front
  const [x, y] = P(0.25, 0.9);
  ctx.fillStyle = '#9a8a6a';
  ctx.fillRect(x - 2, y - 3, 4, 3);
}

function clinicArt(ctx) {
  smallShop(ctx, COL.cream, COL.terraDark, '#3f8f5a', '#3f8f5a');
  // herb pots
  for (const u of [0.2, 0.8]) {
    const [x, y] = P(u, 0.92);
    ctx.fillStyle = '#9b5a3a';
    ctx.fillRect(x - 2, y - 3, 4, 3);
    ctx.fillStyle = '#4f8a3c';
    ctx.beginPath(); ctx.arc(x, y - 5, 2.6, 0, Math.PI * 2); ctx.fill();
  }
}

/** `filled`: piped water reaches it (the pool lies dry and cracked without). */
function bathsArt(ctx, S, v, filled) {
  quad(ctx, 0.04, 0.04, S - 0.04, S - 0.04, 0, COL.paving);
  box(ctx, 0.12, 0.12, S - 0.24, 1.0, 0, 20, COL.cream);
  // dome
  const [x, y] = P(S / 2, 0.62, 20);
  ctx.fillStyle = '#e6dfd0';
  ctx.beginPath(); ctx.ellipse(x, y, 17, 10, 0, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = '#b9b0a0';
  ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.ellipse(x, y, 17, 10, 0, Math.PI, 0); ctx.stroke();
  ctx.fillStyle = '#cfc6b4';
  ctx.beginPath(); ctx.ellipse(x, y, 17, 4, 0, 0, Math.PI); ctx.fill();
  // outdoor pool
  quad(ctx, 0.25, 1.25, S - 0.25, S - 0.2, 0, '#dcd3c2');
  quad(ctx, 0.35, 1.32, S - 0.35, S - 0.28, 0.5, filled ? COL.water : '#8a7d68');
  if (!filled) {
    // a dry basin: cracks across its floor
    ctx.strokeStyle = 'rgba(70,58,44,0.6)';
    ctx.lineWidth = 0.6;
    for (const [a, b, c, d] of [[0.6, 1.5, 1.2, 1.9], [1.1, 1.45, 0.9, 2.1], [S - 0.7, 1.6, S - 1.1, 2.0]]) {
      const [x1, y1] = P(a, b, 0.5);
      const [x2, y2] = P(c, d, 0.5);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
  }
  colonnade(ctx, 0.2, 1.15, S - 0.2, 1.15, 5, 0, 13, COL.marble, 1.5);
}

function hospitalArt(ctx, S) {
  quad(ctx, 0.04, 0.04, S - 0.04, S - 0.04, 0, COL.paving);
  box(ctx, 0.12, 0.12, S - 0.24, 0.8, 0, 18, COL.white);
  gableRoof(ctx, 0.12, 0.12, S - 0.24, 0.8, 18, 8, COL.terra, 'u');
  box(ctx, 0.12, 0.92, 0.8, S - 1.04, 0, 16, COL.cream);
  gableRoof(ctx, 0.12, 0.92, 0.8, S - 1.04, 16, 7, COL.terraDark, 'v');
  quad(ctx, 1.1, 1.1, S - 0.2, S - 0.2, 0, '#86ad5e');
  box(ctx, S - 0.9, 1.1, 0.7, S - 1.3, 0, 16, COL.white);
  gableRoof(ctx, S - 0.9, 1.1, 0.7, S - 1.3, 16, 7, COL.terra, 'v');
  windows(ctx, 'left', 0.12, 0.92, 0.92, S - 0.12, 0, 1, 3, '#3f3126', { z: 6 });
  windows(ctx, 'left', S - 0.9, 1.1, S - 0.2, S - 0.2, 0, 1, 2, '#3f3126', { z: 6 });
  tree(ctx, 1.5, 2.2, 0.6, '#4f8a3c');
}

/**
 * Each god's temple looks like its god, so they can be told apart at a
 * glance, in the build menu's small icons too: a roof color of its own, the
 * god's color (GODS[g].color, which its priests wear) and emblem on the
 * pediment, and something of the god's in front.
 */
export const TEMPLE_LOOKS = {
  ceres: { roof: '#c98f3a', wall: '#efe3c4', field: GODS.ceres.color, emblem: 'wheat', front: 'baskets' },
  neptune: { roof: '#3f8f86', wall: '#e2ebe8', field: GODS.neptune.color, emblem: 'trident', front: 'pool' },
  mercury: { roof: '#b4b8c4', wall: '#e8e2d4', field: GODS.mercury.color, emblem: 'caduceus', front: 'herm' },
  mars: { roof: '#7a2a22', wall: '#dcc7b4', field: GODS.mars.color, emblem: 'shield', front: 'trophy' },
  venus: { roof: '#d9909c', wall: '#f5e8e8', field: GODS.venus.color, emblem: 'shell', front: 'roses' },
};

/**
 * Where a temple's altar stands (footprint u, v): front right, the god's
 * piece at the front left. The renderer's live flame (altarFlameOffset) and
 * the night torch (lighting.js) sit on it.
 */
export function templeAltar(S, turn = 0) {
  return turnUV(S - 0.24, S - 0.08, S, turn);
}

function templeArt(ctx, S, variant, state, key) {
  const look = TEMPLE_LOOKS[BUILDINGS[key]?.god] || TEMPLE_LOOKS.ceres;
  if (key.startsWith('temple_large_')) { largeTempleArt(ctx, S, look); return; }
  const top = 19;
  quad(ctx, 0.02, 0.02, S - 0.02, S - 0.02, 0, '#d8cfbb');
  box(ctx, 0.12, 0.12, S - 0.24, S - 0.24, 0, 5, COL.stone);
  // steps at the front
  box(ctx, 0.4, S - 0.2, S - 0.8, 0.14, 0, 3, shade(COL.stone, 0.1));
  // cella
  box(ctx, 0.35, 0.25, S - 0.7, S - 0.95, 5, top, look.wall);
  door(ctx, 'left', 0.35, 0.25, S - 0.35, S - 0.7, 5, 0.5, '#5a4a3a', 0.22, 10);
  // front and side columns
  colonnade(ctx, 0.3, S - 0.3, S - 0.3, S - 0.3, 5, 5, top, COL.marble, 1.7);
  colonnade(ctx, S - 0.3, 0.3, S - 0.3, S - 0.55, 4, 5, top, COL.marble, 1.7);
  // roof with the pediment facing the viewer, in the god's colors
  gableRoof(ctx, 0.25, 0.2, S - 0.5, S - 0.4, 5 + top, 10, look.roof, 'v', 0.05);
  const z = 6 + top;
  decal(0, 1, () => { // the pediment and its emblem, on the front gable
    poly(ctx, [P(0.4, S - 0.2, z), P(S - 0.4, S - 0.2, z), P(S / 2, S - 0.2, z + 7)], look.field, shade(look.field, -0.4), 0.5);
    const [ex, ey] = P(S / 2, S - 0.2, z + 2.4);
    emblem(ctx, look.emblem, ex, ey);
  });
  // the god's piece at the front left, an altar with its fire at the front right
  frontPiece(ctx, look.front, 0.24, S - 0.1);
  altar(ctx, S - 0.24, S - 0.08); // (templeAltar: the live flame's spot)
}

/**
 * A large temple (3x3): the small temple made grand, in the same god's roof,
 * walls, emblem and piece, so the two sizes read as one god's. A walled
 * precinct with cypresses, a tall podium with a flight of steps, columns all
 * along the front and the side, a deeper pediment with the god's emblem and
 * gilded figures on its corners, the god's piece and the altar in front.
 */
function largeTempleArt(ctx, S, look) {
  const pz = 8; // podium
  const top = 27; // columns
  quad(ctx, 0.02, 0.02, S - 0.02, S - 0.02, 0, '#ddd4c0'); // the precinct's paving
  // the precinct wall along the back edges, and its cypresses
  box(ctx, 0.02, 0.02, S - 0.04, 0.1, 0, 4, shade(COL.stone, 0.12), { plain: true });
  box(ctx, 0.02, 0.12, 0.1, S - 0.14, 0, 4, shade(COL.stone, 0.12), { plain: true });
  cypress(ctx, 0.24, 0.24, 0.85);
  cypress(ctx, S - 0.22, 0.24, 0.75);
  cypress(ctx, 0.24, S - 0.22, 0.75);
  // the podium, and its steps down to the front
  box(ctx, 0.45, 0.4, S - 0.85, S - 0.95, 0, pz, COL.stone);
  for (let k = 0; k < 3; k++) box(ctx, 0.8, S - 0.55 + k * 0.13, S - 1.6, 0.13, 0, pz * (3 - k) / 3, shade(COL.stone, 0.06 + k * 0.04), { plain: true });
  // the cella
  box(ctx, 0.75, 0.6, S - 1.45, S - 1.75, pz, top, look.wall);
  door(ctx, 'left', 0.75, 0.6, S - 0.7, S - 1.15, pz, 0.5, '#5a4a3a', 0.3, 15);
  // columns all along the side, then the front
  colonnade(ctx, S - 0.55, 0.55, S - 0.55, S - 1.0, 5, pz, top, COL.marble, 1.9);
  colonnade(ctx, 0.6, S - 0.7, S - 0.55, S - 0.7, 6, pz, top, COL.marble, 1.9);
  // the roof, pediment to the viewer, in the god's colors
  const z = pz + top;
  gableRoof(ctx, 0.5, 0.45, S - 0.95, S - 0.9, z, 14, look.roof, 'v', 0.06);
  const fv = S - 0.45; // the roof's front edge
  const mid = 0.5 + (S - 0.95) / 2;
  decal(0, 1, () => { // the pediment, its gilded band and the emblem, on the front gable
    poly(ctx, [P(0.56, fv, z + 1), P(S - 0.51, fv, z + 1), P(mid, fv, z + 12)], look.field, shade(look.field, -0.4), 0.6);
    ctx.strokeStyle = COL.gold;
    ctx.lineWidth = 1;
    const [b0x, b0y] = P(0.56, fv, z);
    const [b1x, b1y] = P(S - 0.51, fv, z);
    ctx.beginPath(); ctx.moveTo(b0x, b0y); ctx.lineTo(b1x, b1y); ctx.stroke();
    const [ex, ey] = P(mid, fv, z + 4.6);
    emblem(ctx, look.emblem, ex, ey);
    // gilded figures on the pediment's peak and corners
    ctx.fillStyle = COL.gold;
    for (const [u, dz, r] of [[mid, 12, 1.8], [0.56, 1, 1.3], [S - 0.51, 1, 1.3]]) {
      const [x, y] = P(u, fv, z + dz);
      ctx.fillRect(x - r / 2, y - r * 2.2, r, r * 2.2);
      ctx.beginPath(); ctx.arc(x, y - r * 2.6, r * 0.6, 0, Math.PI * 2); ctx.fill();
    }
  });
  // the god's piece at the front left, the altar with its fire at the front right
  frontPiece(ctx, look.front, 0.36, S - 0.12);
  altar(ctx, S - 0.24, S - 0.08);
}

/** A small altar with its fire. */
function altar(ctx, u, v) {
  const [x, y] = P(u, v);
  ctx.fillStyle = shade(COL.stone, 0.2);
  ctx.fillRect(x - 3, y - 4, 6, 4);
  ctx.fillStyle = '#e8903a';
  ctx.beginPath(); ctx.arc(x, y - 5.5, 1.8, 0, Math.PI * 2); ctx.fill();
}

/** A god's emblem, about 7 px tall, centered at (x, y). */
function emblem(ctx, kind, x, y) {
  ctx.lineCap = 'round';
  switch (kind) {
    case 'wheat': // Ceres: a sheaf
      ctx.strokeStyle = '#f5df8a';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (const dx of [-1.6, 0, 1.6]) { ctx.moveTo(x, y + 3); ctx.lineTo(x + dx, y - 1.5); }
      ctx.stroke();
      ctx.fillStyle = '#f5df8a';
      for (const dx of [-1.6, 0, 1.6]) { ctx.beginPath(); ctx.ellipse(x + dx, y - 2.4, 0.8, 1.4, 0, 0, Math.PI * 2); ctx.fill(); }
      break;
    case 'trident': // Neptune
      ctx.strokeStyle = '#eef3f5';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y + 3.2); ctx.lineTo(x, y - 3.2);
      ctx.moveTo(x - 2, y - 0.8); ctx.lineTo(x + 2, y - 0.8);
      ctx.moveTo(x - 2, y - 0.8); ctx.lineTo(x - 2, y - 2.8);
      ctx.moveTo(x + 2, y - 0.8); ctx.lineTo(x + 2, y - 2.8);
      ctx.stroke();
      break;
    case 'shield': // Mars
      ctx.fillStyle = '#d1a24a';
      ctx.beginPath(); ctx.arc(x, y, 2.7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7a5a2a';
      ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill();
      break;
    case 'caduceus': // Mercury: a winged staff
      ctx.strokeStyle = '#f0d98a';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(x, y + 3.2); ctx.lineTo(x, y - 3);
      ctx.moveTo(x, y - 2.4); ctx.lineTo(x - 2.4, y - 3.4);
      ctx.moveTo(x, y - 2.4); ctx.lineTo(x + 2.4, y - 3.4);
      ctx.moveTo(x - 1.2, y + 2); ctx.quadraticCurveTo(x + 1.6, y + 0.8, x - 1.2, y - 0.4);
      ctx.moveTo(x + 1.2, y + 2); ctx.quadraticCurveTo(x - 1.6, y + 0.8, x + 1.2, y - 0.4);
      ctx.stroke();
      break;
    case 'shell': // Venus: a scallop shell
      ctx.fillStyle = '#fbe3ea';
      ctx.beginPath(); ctx.moveTo(x, y + 2.5); ctx.arc(x, y + 2.5, 3.6, Math.PI * 1.15, Math.PI * 1.85); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#c2507a';
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      for (let k = 0; k < 5; k++) { const a = Math.PI * (1.2 + k * 0.15); ctx.moveTo(x, y + 2.5); ctx.lineTo(x + Math.cos(a) * 3.4, y + 2.5 + Math.sin(a) * 3.4); }
      ctx.stroke();
      break;
    default:
      break;
  }
  ctx.lineCap = 'butt';
}

/** Something of the god's standing in front of the temple, at (u, v). */
function frontPiece(ctx, kind, u, v) {
  const [x, y] = P(u, v);
  switch (kind) {
    case 'baskets': // Ceres: baskets of the harvest
      for (const [dx, dy] of [[-3, 0], [3, 1.5]]) {
        ctx.fillStyle = '#8a6030';
        ctx.fillRect(x + dx - 2.5, y + dy - 4, 5, 4);
        ctx.fillStyle = '#e8c25a';
        ctx.beginPath(); ctx.ellipse(x + dx, y + dy - 4.5, 2.6, 1.3, 0, 0, Math.PI * 2); ctx.fill();
      }
      break;
    case 'pool': { // Neptune: a basin with a dolphin
      quad(ctx, u - 0.14, v - 0.18, u + 0.16, v + 0.04, 0.5, '#d8d2c2');
      quad(ctx, u - 0.1, v - 0.14, u + 0.12, v, 1, COL.water);
      ctx.strokeStyle = '#7d8a90';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y - 3, 2.6, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      break;
    }
    case 'trophy': // Mars: arms of the defeated on a post
      ctx.fillStyle = COL.woodDark;
      ctx.fillRect(x - 0.5, y - 14, 1, 14);
      ctx.fillRect(x - 4, y - 11, 8, 1);
      ctx.fillStyle = '#b8903a';
      ctx.beginPath(); ctx.arc(x, y - 14.5, 2, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#a8322b';
      ctx.beginPath(); ctx.ellipse(x, y - 8, 2.4, 3.2, 0, 0, Math.PI * 2); ctx.fill();
      break;
    case 'herm': // Mercury: a herm (a pillar with a head)
      ctx.fillStyle = COL.stone;
      ctx.fillRect(x - 1.5, y - 10, 3, 10);
      ctx.fillStyle = COL.marble;
      ctx.beginPath(); ctx.arc(x, y - 11.5, 1.8, 0, Math.PI * 2); ctx.fill();
      break;
    case 'roses': // Venus: rose bushes
      for (const [dx, dy] of [[-3, 0], [3, 1.5]]) {
        ctx.fillStyle = '#4f7a3a';
        ctx.beginPath(); ctx.arc(x + dx, y + dy - 2.6, 2.8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e06a8a';
        for (const [rx, ry] of [[-1, -3.4], [1.2, -2.6], [0, -1.6]]) { ctx.beginPath(); ctx.arc(x + dx + rx, y + dy + ry, 0.8, 0, Math.PI * 2); ctx.fill(); }
      }
      break;
    default:
      break;
  }
}

function oracleArt(ctx, S) {
  quad(ctx, 0.02, 0.02, S - 0.02, S - 0.02, 0, '#d8cfbb');
  const [cx, cy] = P(S / 2, S / 2);
  // round platform
  ctx.fillStyle = COL.stone;
  ctx.beginPath(); ctx.ellipse(cx, cy, 26, 13, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = shade(COL.stone, 0.15);
  ctx.beginPath(); ctx.ellipse(cx, cy - 4, 26, 13, 0, 0, Math.PI * 2); ctx.fill();
  // ring of columns (back half first)
  const cols = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    cols.push([Math.cos(a) * 20, Math.sin(a) * 10]);
  }
  cols.sort((a, b) => a[1] - b[1]);
  for (const [dx, dy] of cols) {
    ctx.fillStyle = dy > 0 ? COL.marble : shade(COL.marble, -0.12);
    ctx.fillRect(cx + dx - 1.6, cy - 4 + dy - 22, 3.2, 22);
  }
  // conical roof
  ctx.fillStyle = COL.terra;
  ctx.beginPath();
  ctx.moveTo(cx - 25, cy - 26);
  ctx.lineTo(cx, cy - 44);
  ctx.lineTo(cx + 25, cy - 26);
  ctx.ellipse(cx, cy - 26, 25, 7, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = COL.gold;
  ctx.fillRect(cx - 1, cy - 48, 2, 5);
}

function schoolArt(ctx, S) {
  quad(ctx, 0.04, 0.04, S - 0.04, S - 0.04, 0, '#b7a377');
  box(ctx, 0.12, 0.12, S - 0.24, 0.9, 0, 16, COL.cream);
  gableRoof(ctx, 0.12, 0.12, S - 0.24, 0.9, 16, 9, COL.slate, 'u');
  windows(ctx, 'left', 0.12, 0.12, S - 0.12, 1.02, 0, 1, 4, '#3f3126', { z: 6 });
  tree(ctx, 0.5, 1.55, 0.7, '#4f8a3c');
  // benches in the yard
  for (const u of [1.1, 1.5]) {
    const [x, y] = P(u, 1.5);
    ctx.fillStyle = COL.wood;
    ctx.fillRect(x - 5, y - 2.5, 10, 2);
  }
}

function libraryArt(ctx, S) {
  quad(ctx, 0.04, 0.04, S - 0.04, S - 0.04, 0, '#d8cfbb');
  box(ctx, 0.12, 0.12, S - 0.24, S - 0.24, 0, 4, COL.stone);
  box(ctx, 0.2, 0.2, S - 0.4, S - 0.75, 4, 22, COL.marble);
  colonnade(ctx, 0.22, S - 0.3, S - 0.22, S - 0.3, 6, 4, 22, COL.marble, 1.5);
  gableRoof(ctx, 0.16, 0.16, S - 0.32, S - 0.36, 26, 8, COL.terraDark, 'u', 0.04);
  // scroll racks visible through the portico
  for (let k = 0; k < 4; k++) {
    const [x, y] = P(0.5 + k * 0.3, S - 0.55, 12);
    ctx.fillStyle = '#e8d9a8';
    ctx.fillRect(x - 2, y - 2, 4, 2);
  }
}

function academyArt(ctx, S) {
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, '#d8cfbb');
  box(ctx, 0.12, 0.12, S - 0.24, 0.95, 0, 24, COL.marble);
  gableRoof(ctx, 0.12, 0.12, S - 0.24, 0.95, 24, 9, COL.terra, 'u');
  box(ctx, 0.12, 1.07, 0.9, S - 1.2, 0, 20, shade(COL.marble, -0.04));
  gableRoof(ctx, 0.12, 1.07, 0.9, S - 1.2, 20, 8, COL.terraDark, 'v');
  quad(ctx, 1.15, 1.15, S - 0.15, S - 0.15, 0, '#8fb465');
  colonnade(ctx, 1.1, 1.1, S - 0.1, 1.1, 5, 0, 16, COL.marble, 1.5);
  colonnade(ctx, 1.1, 1.3, 1.1, S - 0.15, 4, 0, 16, COL.marble, 1.5);
  cypress(ctx, S - 0.4, S - 0.4, 0.8);
  // statue of a thinker
  const [x, y] = P(1.95, 1.95);
  ctx.fillStyle = COL.stone;
  ctx.fillRect(x - 3, y - 4, 6, 4);
  ctx.fillStyle = '#e9e4d8';
  ctx.fillRect(x - 1.5, y - 12, 3, 8);
  ctx.beginPath(); ctx.arc(x, y - 13, 2, 0, Math.PI * 2); ctx.fill();
}

// ---------------------------------------------------------------------------
// Entertainment
// ---------------------------------------------------------------------------

/** The theater's bowl: its centre (u, v) and each row's radius (tiles), as liveArt.js seats its crowd. */
export const THEATER_BOWL = (S) => [S * 0.45 + 0.12, S * 0.45 + 0.12];
export const THEATER_ROW_R = (k) => (28 - k * 4) / 45.25;

/**
 * Points of a level circle's arc in the footprint (centre u, v, radius r
 * tiles, height z): angles from a0 to a1, the back half by default (on the
 * screen a circle of r tiles is an ellipse 45 r px across and half as tall).
 */
function bowlArc(u, v, r, z, a0 = Math.PI * 0.7, a1 = Math.PI * 1.8, n = 18) {
  const out = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n;
    out.push(P(u + Math.cos(a) * r, v + Math.sin(a) * r, z));
  }
  return out;
}

function theaterArt(ctx, S) {
  quad(ctx, 0.02, 0.02, S - 0.02, S - 0.02, 0, '#cbbf9f');
  // stepped seating: a half bowl at the back, open toward the stage (drawn
  // through footprint points, so it turns with the stage)
  const [cu, cv] = THEATER_BOWL(S);
  for (let k = 0; k < 5; k++) {
    const pts = bowlArc(cu, cv, THEATER_ROW_R(k), 2.5 * k);
    pts.push(P(cu, cv, 2.5 * k));
    poly(ctx, pts, k % 2 ? '#d9cdb0' : '#cbbd9c');
  }
  poly(ctx, bowlArc(cu + 0.03, cv + 0.03, 0.2, 0, 0, Math.PI * 2), '#b8a582'); // the orchestra
  // stage building in front
  box(ctx, 0.35, S - 0.55, S - 0.7, 0.3, 0, 14, COL.cream);
  colonnade(ctx, 0.45, S - 0.22, S - 0.45, S - 0.22, 5, 0, 10, COL.marble, 1.2);
  // banners
  const [bx, by] = P(0.4, S - 0.55, 14);
  ctx.fillStyle = '#b8573a';
  ctx.fillRect(bx - 1, by - 9, 5, 7);
}

function arenaArt(ctx, S, levels, rxF, ryF) {
  quad(ctx, 0.02, 0.02, S - 0.02, S - 0.02, 0, '#cbbf9f');
  const [cx, cy] = P(S / 2, S / 2);
  const rx = S * 28 * rxF;
  const ry = S * 14 * ryF;
  const h = levels * 11;
  // outer wall (back half, then arena, then front half)
  ctx.fillStyle = shade(COL.stone, 0.1);
  ctx.beginPath(); ctx.ellipse(cx, cy - h, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  // seating ring
  ctx.fillStyle = '#c9bb9a';
  ctx.beginPath(); ctx.ellipse(cx, cy - h + 1, rx * 0.9, ry * 0.9, 0, 0, Math.PI * 2); ctx.fill();
  for (let k = 1; k < 4; k++) {
    ctx.strokeStyle = 'rgba(120,100,70,0.5)';
    ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.ellipse(cx, cy - h + 1 + k * 2, rx * (0.9 - k * 0.08), ry * (0.9 - k * 0.08), 0, 0, Math.PI * 2); ctx.stroke();
  }
  // sand floor
  ctx.fillStyle = COL.sand;
  ctx.beginPath(); ctx.ellipse(cx, cy - 2, rx * 0.5, ry * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  // front wall with arches
  ctx.fillStyle = COL.stone;
  ctx.beginPath();
  ctx.ellipse(cx, cy - h, rx, ry, 0, 0, Math.PI);
  ctx.lineTo(cx - rx, cy);
  ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(50,40,30,0.55)';
  const arches = Math.round(10 * S / 3);
  for (let lv = 0; lv < levels; lv++) {
    for (let k = 1; k < arches; k++) {
      const a = Math.PI * (k / arches);
      const ax = cx + Math.cos(a) * rx * 0.98;
      const ay = cy + Math.sin(a) * ry * 0.98 - lv * 11 - 2;
      ctx.beginPath();
      ctx.moveTo(ax - 2, ay);
      ctx.lineTo(ax - 2, ay - 5);
      ctx.arc(ax, ay - 5, 2, Math.PI, 0);
      ctx.lineTo(ax + 2, ay);
      ctx.fill();
    }
  }
}

function amphitheaterArt(ctx, S) { arenaArt(ctx, S, 2, 0.9, 0.9); }
function colosseumArt(ctx, S, variant, state, key) {
  arenaArt(ctx, S, 3, 0.92, 0.92);
  flagPoles(ctx, key, S); // flags on top
}

function actorTroupeArt(ctx, S) {
  quad(ctx, 0.04, 0.04, S - 0.04, S - 0.04, 0, COL.paving);
  box(ctx, 0.12, 0.12, S - 0.24, 1.1, 0, 18, '#e3cfa8');
  gableRoof(ctx, 0.12, 0.12, S - 0.24, 1.1, 18, 9, COL.terra, 'u');
  // colorful drapes and masks
  const colors = ['#b8573a', '#d9a13a', '#5d7fa3', '#7a9c5a'];
  for (let k = 0; k < 4; k++) {
    const u = 0.3 + k * 0.4;
    poly(ctx, [P(u, 1.22, 14), P(u + 0.25, 1.22, 14), P(u + 0.25, 1.22, 5), P(u, 1.22, 5)], colors[k]);
  }
  const [x, y] = P(1.2, 1.7);
  ctx.fillStyle = '#f2eee6';
  ctx.beginPath(); ctx.arc(x, y - 6, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2b2118';
  ctx.fillRect(x - 2, y - 7, 1.2, 1.2);
  ctx.fillRect(x + 0.8, y - 7, 1.2, 1.2);
}

function gladiatorSchoolArt(ctx, S) {
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, COL.sand);
  box(ctx, 0.1, 0.1, S - 0.2, 0.7, 0, 16, '#cdb994');
  gableRoof(ctx, 0.1, 0.1, S - 0.2, 0.7, 16, 7, COL.terraDark, 'u');
  box(ctx, 0.1, 0.8, 0.7, S - 0.9, 0, 14, '#c4af88');
  gableRoof(ctx, 0.1, 0.8, 0.7, S - 0.9, 14, 6, COL.terra, 'v');
  // training posts
  for (const [u, v] of [[1.4, 1.4], [2.2, 1.6], [1.8, 2.3]]) {
    const [x, y] = P(u, v);
    ctx.fillStyle = COL.woodDark;
    ctx.fillRect(x - 1, y - 10, 2, 10);
    ctx.fillRect(x - 4, y - 8, 8, 1.4);
  }
  // fence
  ctx.strokeStyle = COL.wood;
  ctx.lineWidth = 0.8;
  const p1 = P(0.9, S - 0.1, 4);
  const p2 = P(S - 0.1, S - 0.1, 4);
  const p3 = P(S - 0.1, 0.9, 4);
  ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.stroke();
}

function menagerieArt(ctx, S) {
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, '#a99a6e');
  box(ctx, 0.1, 0.1, S - 0.2, 0.8, 0, 14, '#c8b48c');
  gableRoof(ctx, 0.1, 0.1, S - 0.2, 0.8, 14, 7, COL.terraDark, 'u');
  // cages with bars
  for (const [u, v] of [[0.3, 1.2], [1.3, 1.2], [0.3, 2.1], [1.3, 2.1]]) {
    box(ctx, u, v, 0.8, 0.7, 0, 10, '#7a6a52', { top: '#8f7d62' });
    ctx.strokeStyle = '#3a3026';
    ctx.lineWidth = 0.8;
    for (let k = 1; k < 6; k++) {
      const p = P(u + (k / 6) * 0.8, v + 0.7, 0);
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0], p[1] - 10); ctx.stroke();
    }
    const [x, y] = P(u + 0.45, v + 0.4);
    ctx.fillStyle = '#c9923a';
    ctx.beginPath(); ctx.ellipse(x, y - 3, 3.5, 2, 0, 0, Math.PI * 2); ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Government & decor
// ---------------------------------------------------------------------------

function forumArt(ctx, S) {
  quad(ctx, 0.02, 0.02, S - 0.02, S - 0.02, 0, '#ddd4c2');
  quad(ctx, 0.5, 0.5, S - 0.2, S - 0.2, 0.2, '#e8e1d2');
  box(ctx, 0.1, 0.1, S - 0.2, 0.45, 0, 18, COL.marble);
  gableRoof(ctx, 0.1, 0.1, S - 0.2, 0.45, 18, 7, COL.terra, 'u');
  colonnade(ctx, 0.2, 0.62, S - 0.2, 0.62, 5, 0, 15, COL.marble, 1.4);
  colonnade(ctx, 0.3, 0.8, 0.3, S - 0.2, 4, 0, 15, COL.marble, 1.4);
  // speaker's platform with a flag
  box(ctx, 1.1, 1.1, 0.5, 0.4, 0, 4, COL.stone);
  flagPoles(ctx, 'forum', S);
}

function senateArt(ctx, S) {
  quad(ctx, 0.02, 0.02, S - 0.02, S - 0.02, 0, '#ddd4c2');
  box(ctx, 0.2, 0.2, S - 0.4, S - 0.4, 0, 6, COL.stone);
  box(ctx, 0.45, 0.35, S - 0.9, S - 1.25, 6, 32, COL.marble);
  colonnade(ctx, 0.4, S - 0.45, S - 0.4, S - 0.45, 8, 6, 30, COL.marble, 1.9);
  colonnade(ctx, S - 0.4, 0.4, S - 0.4, S - 0.7, 6, 6, 30, COL.marble, 1.9);
  gableRoof(ctx, 0.35, 0.3, S - 0.7, S - 0.65, 36, 10, COL.terra, 'v', 0.05);
  // dome
  const [x, y] = P(S * 0.45, S * 0.4, 44);
  ctx.fillStyle = '#e9e4d8';
  ctx.beginPath(); ctx.ellipse(x, y, 22, 14, 0, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = '#bdb4a3';
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.ellipse(x, y, 22, 14, 0, Math.PI, 0); ctx.stroke();
  ctx.fillStyle = COL.gold;
  ctx.fillRect(x - 1.5, y - 20, 3, 6);
  // steps
  box(ctx, 0.9, S - 0.3, S - 1.8, 0.22, 0, 3, shade(COL.stone, 0.15));
  flagPoles(ctx, 'senate', S); // imperial purple on the roof corners
}

// ---------------------------------------------------------------------------
// The governor's residences
// ---------------------------------------------------------------------------

/**
 * The governor's colors: warm plaster for the house, white stucco for the
 * villa, marble for the palace, with deep purple-red banners and gilding,
 * so each reads at a glance as grander than the homes around it.
 */
const GOV = Object.freeze({ plaster: '#e9d3a6', stucco: '#f3ece0', roof: '#a9472f', banner: '#7a2848', door: '#4a2a22', glass: '#3c2f2a' });

/** A small gilded ornament (an acroterion) at a gable's peak. */
function gilt(ctx, u, v, z, s = 1) {
  const [x, y] = P(u, v, z);
  ctx.fillStyle = COL.gold;
  ctx.fillRect(x - 1.2 * s, y - 4 * s, 2.4 * s, 4 * s);
  ctx.beginPath(); ctx.arc(x, y - 4.6 * s, 1.4 * s, 0, Math.PI * 2); ctx.fill();
}

/**
 * A temple-fronted porch on the +v (front-left) face: `n` columns along
 * v = `vf` from u0 to u1, `h` px tall from z0, under a gable whose end
 * faces the viewer (a pediment), crowned with gilt.
 */
function portico(ctx, u0, u1, vb, vf, z0, h, n, roof, r = 1.7) {
  colonnade(ctx, u0 + 0.08, vf - 0.08, u1 - 0.08, vf - 0.08, n, z0, h, COL.marble, r);
  box(ctx, u0, vb, u1 - u0, vf - vb, z0 + h, 3, COL.marble, { plain: true });
  gableRoof(ctx, u0, vb, u1 - u0, vf - vb, z0 + h + 3, 7 + (u1 - u0) * 2, roof, 'v', 0.04);
  gilt(ctx, (u0 + u1) / 2, vf + 0.04, z0 + h + 3 + 7 + (u1 - u0) * 2);
}

/** A gilded figure on a pedestal (statues flanking the palace steps). */
function giltStatue(ctx, u, v, z = 0) {
  const [x, y] = P(u, v, z);
  ctx.fillStyle = COL.stone;
  ctx.fillRect(x - 3, y - 5, 6, 5);
  ctx.fillStyle = shade(COL.stone, 0.15);
  ctx.fillRect(x - 3, y - 5, 2.4, 5);
  ctx.fillStyle = COL.gold;
  ctx.fillRect(x - 1.3, y - 13, 2.6, 8);
  ctx.beginPath(); ctx.arc(x, y - 14.4, 1.7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = shade(COL.gold, -0.2);
  ctx.fillRect(x + 1.3, y - 15, 0.8, 9); // a staff
}

/**
 * The Governor's House (3x3): a town house round a court, the hall at the
 * back two storeys high, a wing on the left, a short colonnade on the right,
 * the rain pool in the middle of the court and, in the front wall, a gate
 * with two columns and a pediment under the governor's banners.
 */
function governorHouseArt(ctx, S, variant) {
  const wall = GOV.plaster;
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, '#7fa956');
  quad(ctx, 0.18, 0.18, S - 0.18, S - 0.18, 0, '#d9ccad'); // the paved court
  // the hall across the back
  box(ctx, 0.2, 0.2, S - 0.4, 0.95, 0, 24, wall);
  windows(ctx, 'right', 0.2, 0.2, S - 0.2, 1.15, 0, 2, 1, GOV.glass, { z: 5, h: 5, gap: 10, shutters: '#6b4a3a' });
  windows(ctx, 'left', 0.2, 0.2, S - 0.2, 1.15, 0, 1, 4, GOV.glass, { z: 14, h: 5 });
  door(ctx, 'left', 0.2, 0.2, S - 0.2, 1.15, 0, 0.62, GOV.door, 0.24, 9);
  gableRoof(ctx, 0.2, 0.2, S - 0.4, 0.95, 24, 9, GOV.roof, 'u');
  // the wing on the left
  box(ctx, 0.2, 1.15, 0.8, S - 1.6, 0, 15, shade(wall, -0.04));
  windows(ctx, 'right', 0.2, 1.15, 1.0, S - 0.45, 0, 1, 2, GOV.glass, { z: 5, h: 5 });
  gableRoof(ctx, 0.2, 1.15, 0.8, S - 1.6, 15, 7, shade(GOV.roof, -0.05), 'v');
  // the rain pool (impluvium), and a bay tree in a pot by it
  const pu = S * 0.6;
  const pv = S * 0.55;
  quad(ctx, pu - 0.32, pv - 0.28, pu + 0.32, pv + 0.28, 0, '#e4dccb');
  quad(ctx, pu - 0.25, pv - 0.21, pu + 0.25, pv + 0.21, 0.5, COL.water);
  jar(ctx, pu + 0.5, pv - 0.35, '#a85a3a');
  // a short colonnade along the right of the court
  colonnade(ctx, S - 0.32, 1.35, S - 0.32, S - 0.75, 3, 0, 13, COL.marble, 1.3);
  box(ctx, S - 0.42, 1.25, 0.2, S - 1.95, 13, 2, COL.marble, { plain: true });
  // the front wall, and the gate in it
  box(ctx, 0.2, S - 0.42, S - 0.4, 0.2, 0, 7, shade(wall, -0.06));
  const g0 = S * 0.42;
  const g1 = S * 0.42 + 0.9;
  door(ctx, 'left', 0.2, S - 0.42, S - 0.2, S - 0.22, 0, (g0 + g1) / 2 / S, GOV.door, 0.36, 9);
  portico(ctx, g0, g1, S - 0.5, S - 0.08, 0, 13, 2, GOV.roof, 1.5);
  if ((variant >> 2) & 1) cypress(ctx, S - 0.2, S - 0.2, 0.65);
  else tree(ctx, S - 0.22, S - 0.25, 0.5, '#4f8a3c', '#6b4a2a', variant);
  cypress(ctx, 0.25, S - 0.2, 0.6);
  flagPoles(ctx, 'governor_house', S);
}

/**
 * The Governor's Villa (4x4): a two-storey house of white stucco with a
 * tower room at its back corner, a pillared porch and pediment on its front,
 * a wing on the left, and before it a walled garden with a long pool, a
 * line of columns and cypresses.
 */
function governorVillaArt(ctx, S, variant) {
  const wall = GOV.stucco;
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, '#7aa452');
  quad(ctx, 1.2, 1.55, S - 0.2, S - 0.2, 0, '#8db35e'); // the garden
  quad(ctx, S * 0.5 - 0.15, 1.55, S * 0.5 + 0.15, S - 0.05, 0, COL.paving); // its path
  // the tower room at the back corner
  box(ctx, 0.25, 0.25, 0.75, 0.75, 0, 40, shade(wall, -0.03));
  windows(ctx, 'right', 0.25, 0.25, 1.0, 1.0, 0, 1, 1, GOV.glass, { z: 31, h: 5 });
  hipRoof(ctx, 0.25, 0.25, 0.75, 0.75, 40, 10, GOV.roof);
  gilt(ctx, 0.62, 0.62, 50);
  // the house across the back
  box(ctx, 1.0, 0.25, S - 1.25, 1.2, 0, 28, wall);
  windows(ctx, 'right', 1.0, 0.25, S - 0.25, 1.45, 0, 2, 2, GOV.glass, { z: 5, h: 6, gap: 12, shutters: '#4f7a52' });
  windows(ctx, 'left', 1.0, 0.25, S - 0.25, 1.45, 0, 1, 5, GOV.glass, { z: 18, h: 6, shutters: '#4f7a52' });
  gableRoof(ctx, 1.0, 0.25, S - 1.25, 1.2, 28, 10, GOV.roof, 'u');
  // the wing on the left, with a door to the garden
  box(ctx, 0.25, 1.0, 0.85, S - 1.6, 0, 18, shade(wall, -0.05));
  windows(ctx, 'right', 0.25, 1.0, 1.1, S - 0.6, 0, 1, 3, GOV.glass, { z: 6, h: 6 });
  door(ctx, 'left', 0.25, 1.0, 1.1, S - 0.6, 0, 0.5, GOV.door, 0.24, 9);
  gableRoof(ctx, 0.25, 1.0, 0.85, S - 1.6, 18, 8, shade(GOV.roof, -0.05), 'v');
  // the porch on the front of the house
  door(ctx, 'left', 1.0, 0.25, S - 0.25, 1.45, 0, 0.5, GOV.door, 0.3, 11);
  portico(ctx, S * 0.5 - 0.62, S * 0.5 + 0.62, 1.45, 1.95, 0, 20, 4, GOV.roof, 1.6);
  // the long pool, with columns along its far side
  quad(ctx, 1.3, 2.25, S * 0.5 - 0.2, S - 0.4, 0, '#e4dccb');
  quad(ctx, 1.37, 2.32, S * 0.5 - 0.27, S - 0.47, 0.5, COL.water);
  colonnade(ctx, 1.22, 2.15, 1.22, S - 0.4, 4, 0, 12, COL.marble, 1.2);
  // flower beds and a statue on the right of the path
  quad(ctx, S * 0.5 + 0.3, 2.3, S - 0.45, 2.75, 0, '#5d8a3e');
  for (let k = 0; k < 4; k++) {
    const [x, y] = P(S * 0.5 + 0.4 + k * 0.24, 2.52);
    ctx.fillStyle = (k + variant) % 2 ? '#d9534f' : '#f0c24a';
    ctx.beginPath(); ctx.arc(x, y - 1.4, 1.5, 0, Math.PI * 2); ctx.fill();
  }
  giltStatue(ctx, S - 0.75, S - 0.9);
  // cypresses at the front
  cypress(ctx, S - 0.25, S - 0.25, 0.85);
  cypress(ctx, 1.25, S - 0.2, 0.75);
  if ((variant >> 2) & 1) cypress(ctx, S - 0.25, 1.75, 0.8);
  else tree(ctx, S - 0.3, 1.8, 0.65, '#4f8a3c', '#6b4a2a', variant);
  flagPoles(ctx, 'governor_villa', S);
}

/**
 * The Governor's Palace (5x5): marble on a raised platform. A domed hall at
 * the back with a six-columned porch and a gilded pediment, two long wings
 * with colonnades facing the court, a fountain in the court, steps down to
 * the street between gilded statues, banners on every wing.
 */
function governorPalaceArt(ctx, S, variant) {
  const wall = COL.marble;
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, '#7fa956');
  quad(ctx, 1.2, S - 1.05, S - 1.2, S - 0.05, 0, COL.paving); // the forecourt
  // the platform
  box(ctx, 0.25, 0.25, S - 0.5, S - 1.25, 0, 6, COL.stone);
  quad(ctx, 0.3, 0.3, S - 0.3, S - 1.05, 6, '#e3dccd');
  // the left wing
  box(ctx, 0.35, 0.35, 0.95, S - 1.55, 6, 22, shade(wall, -0.04));
  windows(ctx, 'right', 0.35, 0.35, 1.3, S - 1.2, 6, 1, 4, GOV.glass, { z: 14, h: 6 });
  gableRoof(ctx, 0.35, 0.35, 0.95, S - 1.55, 28, 8, shade(GOV.roof, -0.05), 'v');
  colonnade(ctx, 1.45, 2.0, 1.45, S - 1.35, 4, 6, 18, COL.marble, 1.5);
  // the hall across the back
  box(ctx, 1.3, 0.35, S - 2.6, 1.55, 6, 32, wall);
  windows(ctx, 'left', 1.3, 0.35, S - 1.3, 1.9, 6, 1, 6, GOV.glass, { z: 26, h: 6 });
  gableRoof(ctx, 1.3, 0.35, S - 2.6, 1.55, 38, 9, GOV.roof, 'u');
  // the dome over the hall: a drum, the dome, a gilded lantern
  const [dx, dy] = P(S * 0.5, 1.1, 50);
  ctx.fillStyle = shade(wall, -0.08);
  ctx.fillRect(dx - 22, dy - 8, 44, 10);
  ctx.fillStyle = '#ece7db';
  ctx.beginPath(); ctx.ellipse(dx, dy - 8, 24, 21, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); ctx.ellipse(dx - 8, dy - 16, 7, 11, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#bdb4a3';
  ctx.lineWidth = 0.8;
  for (const k of [-0.5, 0, 0.5]) {
    ctx.beginPath(); ctx.ellipse(dx, dy - 8, 24 * Math.abs(k) + 0.1, 21, 0, Math.PI, 0); ctx.stroke();
  }
  ctx.fillStyle = shade(COL.gold, -0.1);
  ctx.fillRect(dx - 24, dy - 9, 48, 1.8); // gilded ring at the dome's foot
  ctx.fillStyle = COL.gold;
  ctx.fillRect(dx - 2, dy - 35, 4, 7);
  ctx.beginPath(); ctx.arc(dx, dy - 36.5, 2.2, 0, Math.PI * 2); ctx.fill();
  // the great porch before the hall
  portico(ctx, S * 0.5 - 1.05, S * 0.5 + 1.05, 1.9, 2.45, 6, 26, 6, GOV.roof, 1.9);
  // the right wing
  box(ctx, S - 1.3, 0.35, 0.95, S - 1.55, 6, 22, shade(wall, -0.04));
  windows(ctx, 'right', S - 1.3, 0.35, S - 0.35, S - 1.2, 6, 2, 4, GOV.glass, { z: 10, h: 5, gap: 9 });
  windows(ctx, 'left', S - 1.3, 0.35, S - 0.35, S - 1.2, 6, 1, 2, GOV.glass, { z: 14, h: 6 });
  gableRoof(ctx, S - 1.3, 0.35, 0.95, S - 1.55, 28, 8, shade(GOV.roof, -0.05), 'v');
  colonnade(ctx, S - 1.45, 2.0, S - 1.45, S - 1.35, 4, 6, 18, COL.marble, 1.5);
  // the fountain in the court
  const fu = S * 0.5;
  const fv = S - 1.75;
  quad(ctx, fu - 0.45, fv - 0.35, fu + 0.45, fv + 0.35, 6.5, '#e4dccb');
  quad(ctx, fu - 0.37, fv - 0.27, fu + 0.37, fv + 0.27, 7, COL.water);
  const [fx, fy] = P(fu, fv, 7);
  ctx.fillStyle = wall;
  ctx.fillRect(fx - 1.5, fy - 8, 3, 8);
  ctx.fillStyle = COL.gold;
  ctx.fillRect(fx - 3.2, fy - 9, 6.4, 1.6);
  // steps down from the platform, between gilded statues
  box(ctx, S * 0.5 - 1.0, S - 1.0, 2.0, 0.22, 0, 4, shade(COL.stone, 0.12));
  box(ctx, S * 0.5 - 1.1, S - 0.78, 2.2, 0.22, 0, 2, shade(COL.stone, 0.18));
  giltStatue(ctx, S * 0.5 - 1.35, S - 0.75);
  giltStatue(ctx, S * 0.5 + 1.35, S - 0.75);
  // cypresses at the front corners, beds of flowers between them
  for (const [u, v] of [[0.3, S - 0.3], [S - 0.3, S - 0.3], [S - 0.3, S - 1.4]]) cypress(ctx, u, v, 0.9);
  for (let k = 0; k < 5; k++) {
    const [x, y] = P(0.55 + k * 0.12, S - 0.55 + (k % 2) * 0.12);
    ctx.fillStyle = (k + variant) % 3 ? '#4f7a3a' : '#d9534f';
    ctx.beginPath(); ctx.arc(x, y - 1.5, 1.7, 0, Math.PI * 2); ctx.fill();
  }
  flagPoles(ctx, 'governor_palace', S);
}

function gardenArt(ctx, S, variant) {
  quad(ctx, 0.04, 0.04, S - 0.04, S - 0.04, 0, '#6e9d44');
  // hedge border
  ctx.strokeStyle = '#3e6b2c';
  ctx.lineWidth = 2;
  const pts = [P(0.1, 0.1, 1), P(0.9, 0.1, 1), P(0.9, 0.9, 1), P(0.1, 0.9, 1)];
  ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke();
  // flowers
  for (let k = 0; k < 9; k++) {
    const [x, y] = P(0.2 + hash01(variant, k, 51) * 0.6, 0.2 + hash01(variant, k, 52) * 0.6);
    ctx.fillStyle = ['#e85d5d', '#f4e27a', '#f7f2e4', '#c77dd6'][k % 4];
    ctx.beginPath(); ctx.arc(x, y - 1, 1.3, 0, Math.PI * 2); ctx.fill();
  }
  if (variant % 2) cypress(ctx, 0.5, 0.5, 0.75);
  else tree(ctx, 0.5, 0.5, 0.6, '#4f8a3c', '#6b4a2a', variant);
}

/**
 * Statues, by size: a marble citizen in a toga on a moulded pedestal; a
 * bronze warrior with spear and cloak on a stepped plinth among cypresses and
 * flower beds; a bronze horseman on a tall inscribed pedestal in a paved
 * square with a cypress at each corner.
 */
function statueArt(ctx, S, variant, state, key) {
  if (key === 'statue_large') grandStatue(ctx, S);
  else if (key === 'statue_medium') heroStatue(ctx, S);
  else smallStatue(ctx);
}

/** A pedestal: base, shaft, cornice; returns the height of its top. */
function pedestal(ctx, c, half, h, stone) {
  box(ctx, c - half - 0.05, c - half - 0.05, (half + 0.05) * 2, (half + 0.05) * 2, 0, 2.5, shade(stone, -0.12));
  box(ctx, c - half, c - half, half * 2, half * 2, 2.5, h, stone);
  box(ctx, c - half - 0.04, c - half - 0.04, (half + 0.04) * 2, (half + 0.04) * 2, 2.5 + h, 1.6, shade(stone, 0.08));
  return 4.1 + h;
}

/**
 * A standing figure with its feet at (x, y), `k` px per unit (about 18 units
 * tall), lit from the upper left. pose: 'toga' (an orator's raised arm) or
 * 'spear' (a warrior with a spear and a cloak).
 */
function figure(ctx, x, y, k, color, pose) {
  const light = shade(color, 0.22);
  const dark = shade(color, -0.22);
  if (pose === 'spear') {
    // cloak behind, falling from the shoulders
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.moveTo(x - 2.4 * k, y - 13 * k); ctx.lineTo(x + 2.6 * k, y - 13 * k); ctx.lineTo(x + 3.6 * k, y - 1 * k); ctx.lineTo(x - 3.4 * k, y - 1.5 * k); ctx.closePath(); ctx.fill();
  }
  // legs and robe (a toga falls to the feet; a warrior's tunic stops above the knees)
  ctx.fillStyle = color;
  if (pose === 'toga') {
    ctx.beginPath(); ctx.moveTo(x - 2.7 * k, y); ctx.lineTo(x - 1.9 * k, y - 10 * k); ctx.lineTo(x + 1.9 * k, y - 10 * k); ctx.lineTo(x + 2.9 * k, y); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = dark;
    ctx.lineWidth = 0.5 * k;
    ctx.beginPath(); ctx.moveTo(x - 1.6 * k, y - 9 * k); ctx.lineTo(x + 1.8 * k, y - 1 * k); ctx.moveTo(x - 0.4 * k, y - 9.6 * k); ctx.lineTo(x + 2.4 * k, y - 4 * k); ctx.stroke();
  } else {
    ctx.fillRect(x - 1.5 * k, y - 5 * k, 1.2 * k, 5 * k);
    ctx.fillRect(x + 0.3 * k, y - 5 * k, 1.2 * k, 5 * k);
    ctx.beginPath(); ctx.moveTo(x - 2.2 * k, y - 4.5 * k); ctx.lineTo(x - 1.9 * k, y - 10 * k); ctx.lineTo(x + 1.9 * k, y - 10 * k); ctx.lineTo(x + 2.2 * k, y - 4.5 * k); ctx.closePath(); ctx.fill();
  }
  // torso, lit side
  ctx.fillStyle = color;
  ctx.fillRect(x - 2 * k, y - 14.5 * k, 4 * k, 5 * k);
  ctx.fillStyle = light;
  ctx.fillRect(x - 2 * k, y - 14.5 * k, 1.4 * k, 5 * k);
  // head
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y - 16.4 * k, 1.8 * k, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = light;
  ctx.beginPath(); ctx.arc(x - 0.6 * k, y - 16.9 * k, 0.8 * k, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.3 * k;
  ctx.beginPath();
  if (pose === 'toga') {
    // the orator's right arm raised, the left holding a fold of the toga
    ctx.moveTo(x + 1.8 * k, y - 13.6 * k); ctx.lineTo(x + 4.6 * k, y - 16.4 * k);
    ctx.moveTo(x - 1.8 * k, y - 13.4 * k); ctx.lineTo(x - 2.6 * k, y - 10.4 * k);
  } else {
    // spear in the left hand, the right arm on the hip
    ctx.moveTo(x - 1.8 * k, y - 13.6 * k); ctx.lineTo(x - 3.4 * k, y - 11 * k);
    ctx.moveTo(x + 1.8 * k, y - 13.4 * k); ctx.lineTo(x + 2.8 * k, y - 11 * k); ctx.lineTo(x + 1.8 * k, y - 10 * k);
  }
  ctx.stroke();
  if (pose === 'spear') {
    ctx.strokeStyle = shade(color, -0.35);
    ctx.lineWidth = 0.6 * k;
    ctx.beginPath(); ctx.moveTo(x - 3.6 * k, y + 0.5 * k); ctx.lineTo(x - 3.6 * k, y - 22 * k); ctx.stroke();
    ctx.fillStyle = shade(color, 0.3);
    ctx.beginPath(); ctx.moveTo(x - 3.6 * k, y - 24.5 * k); ctx.lineTo(x - 4.4 * k, y - 21.5 * k); ctx.lineTo(x - 2.8 * k, y - 21.5 * k); ctx.fill();
    // a crested helmet
    ctx.fillStyle = '#a8322b';
    ctx.fillRect(x - 0.4 * k, y - 19.6 * k, 0.8 * k, 1.6 * k);
  }
  ctx.lineCap = 'butt';
}

const MARBLE_STATUE = '#ece7dc';
const BRONZE = '#6f8f7c'; // weathered bronze, green with age

function smallStatue(ctx) {
  quad(ctx, 0.08, 0.08, 0.92, 0.92, 0, COL.paving);
  const top = pedestal(ctx, 0.5, 0.16, 7, COL.stone);
  const [x, y] = P(0.5, 0.5, top);
  figure(ctx, x, y, 0.95, MARBLE_STATUE, 'toga');
}

function heroStatue(ctx, S) {
  quad(ctx, 0.04, 0.04, S - 0.04, S - 0.04, 0, COL.paving);
  // flower beds at the front corners, cypresses at the back
  for (const [u, v] of [[0.1, S - 0.5], [S - 0.5, 0.1]]) quad(ctx, u, v, u + 0.4, v + 0.4, 0, '#5d8a3e');
  for (const [u, v] of [[0.3, S - 0.3], [S - 0.3, 0.3]]) {
    const [fx, fy] = P(u, v);
    ctx.fillStyle = '#e0b94a';
    ctx.fillRect(fx - 3, fy - 2, 2, 1.4);
    ctx.fillStyle = '#d9534f';
    ctx.fillRect(fx + 1, fy - 1.4, 2, 1.4);
  }
  cypress(ctx, 0.3, 0.3, 0.75);
  box(ctx, 0.45, 0.45, S - 0.9, S - 0.9, 0, 2.5, shade(COL.stone, -0.06));
  box(ctx, 0.6, 0.6, S - 1.2, S - 1.2, 2.5, 2.5, COL.stone);
  const c = S / 2;
  box(ctx, c - 0.22, c - 0.22, 0.44, 0.44, 5, 12, COL.marble);
  box(ctx, c - 0.26, c - 0.26, 0.52, 0.52, 17, 1.6, shade(COL.marble, -0.06));
  // a bronze plaque on the front face
  poly(ctx, [P(c - 0.12, c + 0.22, 8), P(c + 0.12, c + 0.22, 8), P(c + 0.12, c + 0.22, 13), P(c - 0.12, c + 0.22, 13)], '#8a6d3a');
  const [x, y] = P(c, c, 18.6);
  figure(ctx, x, y, 1.35, BRONZE, 'spear');
  cypress(ctx, S - 0.3, S - 0.3, 0.7);
}

function grandStatue(ctx, S) {
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, COL.paving);
  // a darker band around the square
  quad(ctx, 0.2, 0.2, S - 0.2, S - 0.2, 0.2, shade(COL.paving, -0.08));
  quad(ctx, 0.35, 0.35, S - 0.35, S - 0.35, 0.4, COL.paving);
  cypress(ctx, 0.25, 0.25, 0.85);
  cypress(ctx, S - 0.25, 0.25, 0.85);
  cypress(ctx, 0.25, S - 0.25, 0.85);
  const c = S / 2;
  box(ctx, c - 0.8, c - 0.8, 1.6, 1.6, 0, 3, shade(COL.stone, -0.06));
  box(ctx, c - 0.62, c - 0.62, 1.24, 1.24, 3, 3, COL.stone);
  box(ctx, c - 0.42, c - 0.42, 0.84, 0.84, 6, 20, COL.marble);
  box(ctx, c - 0.48, c - 0.48, 0.96, 0.96, 26, 2, shade(COL.marble, -0.06));
  // the inscription, on the front face
  decal(0, 1, () => {
    ctx.strokeStyle = 'rgba(70,60,50,0.55)';
    ctx.lineWidth = 0.6;
    for (let k = 0; k < 3; k++) {
      const p = P(c - 0.26, c + 0.42, 20 - k * 3.2);
      const q = P(c + 0.26, c + 0.42, 20 - k * 3.2);
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    }
  });
  // the horseman, in bronze
  const [x, y] = P(c, c, 28);
  const s = 1.7;
  horse(ctx, x, y, s, BRONZE, 1, 0.35, shade(BRONZE, -0.3));
  ctx.fillStyle = shade(BRONZE, -0.08);
  ctx.fillRect(x - 1.8 * s, y - 16 * s, 3 * s, 6.4 * s);
  ctx.fillStyle = shade(BRONZE, 0.2);
  ctx.fillRect(x - 1.8 * s, y - 16 * s, 1 * s, 6.4 * s);
  ctx.beginPath(); ctx.arc(x - 0.3 * s, y - 17.4 * s, 1.3 * s, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = shade(BRONZE, -0.08);
  ctx.lineWidth = 1.1 * s;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x + 0.8 * s, y - 15 * s); ctx.lineTo(x + 3.6 * s, y - 18.4 * s); ctx.stroke();
  ctx.lineCap = 'butt';
  cypress(ctx, S - 0.25, S - 0.25, 0.85);
}

/** The arch's face the road comes out of: the vault's curve, the keystone and the gilded inscription. */
function archFace(ctx, pt, face, axis, H, A, S, marble) {
  const face2 = axis === 0 ? shade(marble, -0.2) : marble; // that face's light (box: right faces are darker)
  const curve = [pt(face, 1.0, H), pt(face, 2.0, H), pt(face, 2.0, H - 12)];
  for (let k = 1; k < 12; k++) {
    const t = k / 12; // across the opening, from its near side back to its far side
    const c = 2.0 - t;
    curve.push(pt(face, c, H - 12 + Math.sin(Math.PI * t) * 9));
  }
  curve.push(pt(face, 1.0, H - 12));
  poly(ctx, curve, face2, shade(marble, -0.45), 0.6);
  // the keystone, and the inscription on the attic in gold
  {
    const [x, y] = pt(face, 1.5, H - 2.5);
    ctx.fillStyle = shade(COL.gold, -0.1);
    ctx.fillRect(x - 1.4, y - 2.5, 2.8, 3);
  }
  ctx.strokeStyle = 'rgba(176,132,42,0.85)';
  ctx.lineWidth = 0.8;
  for (let k = 0; k < 3; k++) {
    const z = H + 3 + A - 4 - k * 4;
    const p = pt(face, 0.55 + k * 0.08, z);
    const q = pt(face, S - 0.55 - k * 0.08, z);
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
  }
}

/**
 * A triumphal arch (3x3), built across a road (`axis` 0: the road runs along
 * x, 1: along y). Two marble piers with engaged columns stand either side of
 * the road, which runs on under the vault (the middle strip is left
 * unpainted so the road shows through); over them the attic, its
 * inscription in gold on the face the road comes out of, and on top a
 * gilded team of horses with the victor in his chariot.
 */
function triumphalArchArt(ctx, S, variant, axis) {
  const H = 34; // the opening's height (px)
  const A = 15; // the attic
  const a0 = 0.85; // the arch's depth along the road...
  const a1 = S - 0.85;
  const marble = COL.marble;
  const stone = shade(COL.marble, -0.08);
  // Everything is drawn in (along the road, across it) and turned by axis.
  const bx = (p0, p1, c0, c1, z, h, color, o) => (axis === 0 ? box(ctx, p0, c0, p1 - p0, c1 - c0, z, h, color, o) : box(ctx, c0, p0, c1 - c0, p1 - p0, z, h, color, o));
  const pt = (p, c, z) => (axis === 0 ? P(p, c, z) : P(c, p, z));
  const flat = (p0, p1, c0, c1, color) => (axis === 0 ? quad(ctx, p0, c0, p1, c1, 0, color) : quad(ctx, c0, p0, c1, p1, 0, color));
  // paving either side of the road (the road itself shows through)
  flat(0.05, S - 0.05, 0.05, 1.0, COL.paving);
  flat(0.05, S - 0.05, 2.0, S - 0.05, COL.paving);
  // the piers: a plinth, then the marble, the far one first
  for (const [c0, c1] of [[0.15, 1.0], [2.0, S - 0.15]]) {
    bx(a0, a1, c0, c1, 0, 3, shade(COL.stone, -0.05), { plain: true });
    bx(a0 + 0.05, a1 - 0.05, c0 + 0.05, c1, 3, H - 3, marble, { plain: true });
    // two engaged columns on the face the road comes out of
    const p = a1 - 0.02;
    const cs = [c0 + 0.22, c1 - 0.18];
    decal(axis === 0 ? 1 : 0, axis === 0 ? 0 : 1, () => cs.forEach((c) => {
      const [x, y] = pt(p, c, 3);
      ctx.fillStyle = shade(marble, axis === 0 ? -0.12 : 0.04);
      ctx.fillRect(x - 1.6, y - (H - 6), 3.2, H - 6);
      ctx.fillStyle = 'rgba(80,70,60,0.25)';
      ctx.fillRect(x + 0.6, y - (H - 6), 1, H - 6);
      ctx.fillStyle = shade(COL.gold, -0.1);
      ctx.fillRect(x - 2.2, y - (H - 5), 4.4, 1.6); // capital
    }));
  }
  // the entablature, the attic and its cornice, over both piers and the road
  bx(a0, a1, 0.15, S - 0.15, H, 3, stone, { plain: true });
  bx(a0 + 0.05, a1 - 0.05, 0.2, S - 0.2, H + 3, A, marble, { plain: true });
  bx(a0, a1, 0.15, S - 0.15, H + 3 + A, 2.2, stone, { plain: true });
  // the vault: the arch's curve on the face the road comes out of
  const face = a1 - 0.05;
  // (One face, as a whole: turned away, it goes behind the attic.)
  decal(axis === 0 ? 1 : 0, axis === 0 ? 0 : 1, () => archFace(ctx, pt, face, axis, H, A, S, marble));
  // the gilded team on top, facing the way the road runs on
  const top = H + 3 + A + 2.2;
  const dir = axis === 0 ? 1 : -1;
  for (const c of [1.25, 1.75]) {
    const [x, y] = pt(S / 2, c, top);
    horse(ctx, x, y, 1.15, COL.gold, dir, 0.2, shade(COL.gold, -0.35));
  }
  const [cx, cy] = pt(S / 2 - 0.45, 1.5, top);
  ctx.fillStyle = shade(COL.gold, -0.18);
  ctx.fillRect(cx - 3, cy - 5, 6, 5); // the chariot
  ctx.fillStyle = COL.gold;
  ctx.fillRect(cx - 1.1, cy - 13, 2.2, 8); // the victor
  ctx.beginPath(); ctx.arc(cx, cy - 14.3, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3f7a3a';
  ctx.fillRect(cx - 1.6, cy - 16.2, 3.2, 0.9); // his laurel
}

/**
 * The iron mine: a rocky hillside with a timber-framed entrance, a winding
 * frame over the shaft, rails, an ore cart, and a heap of red iron ore.
 */
function ironMineArt(ctx, S) {
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, '#8d8373');
  quad(ctx, 0.25, 1.1, S - 0.15, S - 0.1, 0, '#75685a'); // trodden ground in front
  // the hillside, rising to the back
  const R = S - 0.15;
  // (Its far sides too, for a turned mine: as written they stay hidden behind the rest.)
  decal(-1, 0, () => poly(ctx, [P(0.1, 0.1, 0), P(0.1, 0.1, 26), P(0.1, 0.55, 22), P(0.1, 1.2, 0)], '#7d7466', '#5d564b', 0.6));
  decal(0, -1, () => poly(ctx, [P(0.1, 0.1, 0), P(R, 0.1, 0), P(R, 0.1, 18), P(0.1, 0.1, 26)], '#958b78', '#5d564b', 0.6));
  poly(ctx, [P(0.1, 0.1, 26), P(R, 0.1, 18), P(R, 0.45, 16), P(0.1, 0.55, 22)], '#a39985', '#5d564b', 0.6); // top
  decal(0, 1, () => poly(ctx, [P(0.1, 0.55, 22), P(R, 0.45, 16), P(R, 0.9, 0), P(0.1, 1.2, 0)], '#8c8272', '#5d564b', 0.6)); // front face
  decal(1, 0, () => poly(ctx, [P(R, 0.1, 18), P(R, 0.45, 16), P(R, 0.9, 0), P(R, 0.1, 0)], '#6d6457', '#5d564b', 0.6)); // side
  // cracks and ledges in the rock
  ctx.strokeStyle = 'rgba(60,54,46,0.6)';
  ctx.lineWidth = 0.6;
  for (const [a, b] of [[[1.0, 0.95, 5], [1.3, 0.85, 10]], [[0.3, 1.05, 12], [0.5, 0.98, 16]], [[1.5, 0.8, 3], [1.7, 0.6, 9]]]) {
    const p = P(...a);
    const q = P(...b);
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
  }
  // the entrance, framed in timber
  poly(ctx, [P(0.46, 1.13, 0), P(0.74, 1.08, 0), P(0.74, 1.08, 9), P(0.46, 1.13, 9)], '#1e1a16');
  box(ctx, 0.42, 1.1, 0.05, 0.05, 0, 11, COL.wood);
  box(ctx, 0.74, 1.05, 0.05, 0.05, 0, 11, COL.wood);
  box(ctx, 0.4, 1.06, 0.42, 0.08, 11, 1.6, COL.woodDark);
  // rails out of the entrance to the ore heap
  ctx.strokeStyle = '#4a4540';
  ctx.lineWidth = 0.7;
  for (const off of [-0.05, 0.05]) {
    const p = P(0.6 + off, 1.15);
    const q = P(1.25 + off, 1.75);
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
  }
  // the winding frame over the shaft, at the back right
  const [wx, wy] = P(1.55, 1.05);
  ctx.strokeStyle = COL.woodDark;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(wx - 7, wy); ctx.lineTo(wx, wy - 26); ctx.lineTo(wx + 7, wy);
  ctx.moveTo(wx - 4.5, wy - 9); ctx.lineTo(wx + 4.5, wy - 9);
  ctx.stroke();
  ctx.strokeStyle = COL.wood;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(wx, wy - 24, 4, 0, Math.PI * 2); ctx.moveTo(wx - 4, wy - 24); ctx.lineTo(wx + 4, wy - 24); ctx.moveTo(wx, wy - 28); ctx.lineTo(wx, wy - 20); ctx.stroke();
  ctx.strokeStyle = '#3a3530';
  ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(wx + 4, wy - 24); ctx.lineTo(wx + 4, wy - 4); ctx.stroke();
  // the ore heap: red-brown iron ore with dark lumps
  const [hx, hy] = P(1.45, 1.7);
  ctx.fillStyle = '#7a4a36';
  ctx.beginPath(); ctx.ellipse(hx, hy - 2, 9, 4.5, 0, Math.PI, 0); ctx.lineTo(hx + 9, hy); ctx.lineTo(hx - 9, hy); ctx.fill();
  ctx.fillStyle = '#5a3326';
  for (const [dx, dy] of [[-4, -3], [1, -5], [4, -2], [-1, -1.5]]) { ctx.beginPath(); ctx.arc(hx + dx, hy + dy, 1.3, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#9aa0a6';
  ctx.fillRect(hx + 2, hy - 4.5, 1, 1);
  // an ore cart on the rails
  const [cx, cy] = P(1.0, 1.5);
  ctx.fillStyle = '#6b4a2a';
  ctx.fillRect(cx - 4, cy - 6, 8, 4);
  ctx.fillStyle = '#7a4a36';
  ctx.beginPath(); ctx.ellipse(cx, cy - 6, 3.6, 1.5, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#3a3a3a';
  ctx.beginPath(); ctx.arc(cx - 2.5, cy - 1.5, 1.4, 0, Math.PI * 2); ctx.arc(cx + 2.5, cy - 1.5, 1.4, 0, Math.PI * 2); ctx.fill();
}

// ---------------------------------------------------------------------------
// Engineering & security
// ---------------------------------------------------------------------------

function engineerArt(ctx) {
  quad(ctx, 0.05, 0.05, 0.95, 0.95, 0, '#bca77f');
  box(ctx, 0.14, 0.14, 0.55, 0.6, 0, 14, COL.cream);
  gableRoof(ctx, 0.14, 0.14, 0.55, 0.6, 14, 7, COL.terra, 'v');
  // wooden crane
  const [x, y] = P(0.82, 0.55);
  ctx.strokeStyle = COL.woodDark;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x - 4, y); ctx.lineTo(x, y - 26); ctx.lineTo(x + 4, y);
  ctx.moveTo(x, y - 26); ctx.lineTo(x - 12, y - 18);
  ctx.stroke();
  ctx.strokeStyle = '#3a3026';
  ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.moveTo(x - 12, y - 18); ctx.lineTo(x - 12, y - 9); ctx.stroke();
  ctx.fillStyle = COL.stone;
  ctx.fillRect(x - 14, y - 9, 4, 3);
}

function prefectureArt(ctx) {
  quad(ctx, 0.05, 0.05, 0.95, 0.95, 0, COL.paving);
  box(ctx, 0.14, 0.14, 0.72, 0.62, 0, 16, COL.white);
  gableRoof(ctx, 0.14, 0.14, 0.72, 0.62, 16, 8, '#a8322b', 'u');
  door(ctx, 'left', 0.14, 0.14, 0.86, 0.76, 0, 0.5, '#5a2a1f', 0.2, 8);
  // red banner + water barrel
  flagPoles(ctx, 'prefecture', 1);
  const [bx, by] = P(0.3, 0.9);
  ctx.fillStyle = COL.wood;
  ctx.fillRect(bx - 3, by - 6, 6, 6);
  ctx.fillStyle = '#4a90c8';
  ctx.fillRect(bx - 2.4, by - 6.5, 4.8, 1.2);
}

// ---------------------------------------------------------------------------
// Farms & raw materials
// ---------------------------------------------------------------------------

const CROP = {
  farm_wheat: { young: '#7fae4c', ripe: '#e2c15a', kind: 'rows' },
  farm_veg: { young: '#6ea84a', ripe: '#4f9a3a', kind: 'heads', fruit: '#c9503a' },
  farm_fruit: { young: '#5d9a44', ripe: '#4b8a3a', kind: 'trees', fruit: '#d9463a' },
  farm_olive: { young: '#7f9a6a', ripe: '#8a9c78', kind: 'trees', fruit: '#4d5a2a' },
  farm_vine: { young: '#6d9a4a', ripe: '#5a8a3c', kind: 'vines', fruit: '#6b3fa0' },
  farm_pig: { young: '#8a7a55', ripe: '#8a7a55', kind: 'pigs' },
  // Flax: thin green stalks that open sky-blue flowers, so a flax field reads
  // blue from afar (no other crop does).
  farm_flax: { young: '#79a052', ripe: '#6f9548', kind: 'flax', fruit: '#6f8fd8', bloom: '#b9cdf3' },
};

/** Winter tones for a resting farm: the crop stands (as high as it grew) but dry and dull. */
const WINTER_STRAW = '#a39a6c';
const WINTER_OLIVE = '#6f7358';

function farmArt(ctx, S, variant, stage, key) {
  // Stages 5..9: the same growth stage, resting for an Insane winter. The crop
  // keeps its height (progress is frozen, not lost) but turns dry and dull:
  // no fruit, bare orchard trees and vines, most pigs in the sty.
  const resting = stage >= 5;
  if (resting) stage -= 5;
  const base = CROP[key] || CROP.farm_wheat;
  const crop = resting
    ? { ...base, young: mix(base.young, WINTER_STRAW, 0.7), ripe: mix(base.ripe, WINTER_STRAW, 0.7), fruit: null }
    : base;
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, crop.kind === 'pigs' ? '#9a8a5c' : COL.soil);
  const sn = roofSnowAmount();
  if (sn > 0) {
    // Snow lying on the field (the rows and plants still show through).
    ctx.globalAlpha = 0.35 + 0.55 * sn;
    quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, SNOW);
    ctx.globalAlpha = 1;
  }
  const t = stage / 4; // 0..1 growth
  if (crop.kind === 'rows' || crop.kind === 'heads') {
    for (let r = 0; r < 9; r++) {
      const v = 0.2 + r * ((S - 0.4) / 8);
      const p = P(1.0, v);
      const q = P(S - 0.12, v);
      ctx.strokeStyle = shade(COL.soil, -0.25);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
      if (stage === 0) continue;
      const col = stage >= 4 ? crop.ripe : crop.young;
      for (let k = 0; k < 9; k++) {
        const u = 1.05 + k * ((S - 1.2) / 8);
        const [x, y] = P(u, v);
        const h = 1.5 + t * 5;
        ctx.fillStyle = col;
        if (crop.kind === 'rows') ctx.fillRect(x - 1, y - h, 2, h);
        else { ctx.beginPath(); ctx.arc(x, y - 1.5, 1 + t * 1.8, 0, Math.PI * 2); ctx.fill(); }
        if (crop.fruit && crop.kind === 'heads' && stage >= 3 && k % 3 === 0) { ctx.fillStyle = crop.fruit; ctx.fillRect(x - 0.8, y - 3, 1.6, 1.6); }
      }
    }
  } else if (crop.kind === 'trees') {
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 3; k++) {
        const u = 1.2 + k * 0.62;
        const v = 0.45 + r * 0.95;
        const size = 0.35 + t * 0.35;
        if (resting && key !== 'farm_olive') bareTree(ctx, u, v, size, r * 3 + k, 0, WINTER_STRAW); // fruit trees drop their leaves
        else tree(ctx, u, v, size, resting ? WINTER_OLIVE : stage >= 4 ? crop.ripe : crop.young, '#6b4a2a', r * 3 + k); // olives stay green
        if (crop.fruit && stage >= 3) {
          const [x, y] = P(u, v);
          ctx.fillStyle = crop.fruit;
          for (let f = 0; f < 3; f++) ctx.fillRect(x - 3 + f * 3, y - 6 - (f % 2) * 3 - t * 4, 1.5, 1.5);
        }
      }
    }
  } else if (crop.kind === 'vines') {
    for (let r = 0; r < 6; r++) {
      const v = 0.3 + r * ((S - 0.6) / 5);
      const p = P(1.0, v);
      const q = P(S - 0.12, v);
      ctx.strokeStyle = COL.woodDark;
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(p[0], p[1] - 5); ctx.lineTo(q[0], q[1] - 5); ctx.stroke();
      if (stage === 0 || resting) continue; // bare canes in winter
      ctx.strokeStyle = crop.young;
      ctx.lineWidth = 1 + t * 2.4;
      ctx.beginPath(); ctx.moveTo(p[0], p[1] - 4); ctx.lineTo(q[0], q[1] - 4); ctx.stroke();
      if (stage >= 3) {
        for (let k = 0; k < 6; k++) {
          const [x, y] = P(1.1 + k * ((S - 1.3) / 5), v);
          ctx.fillStyle = crop.fruit;
          ctx.beginPath(); ctx.arc(x, y - 3, 1.3, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  } else if (crop.kind === 'flax') {
    // Close rows of leafy stalks; from the third stage they carry blue
    // flowers (a few paler ones), so the field turns blue as it ripens.
    for (let r = 0; r < 11; r++) {
      const v = 0.16 + r * ((S - 0.32) / 10);
      const p = P(1.0, v);
      const q = P(S - 0.12, v);
      ctx.strokeStyle = shade(COL.soil, -0.2);
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
      if (stage === 0) continue;
      const h = 2 + t * 6;
      // The leaves: a green band along the row, as tall as the crop.
      ctx.strokeStyle = crop.young;
      ctx.lineWidth = 1 + t * 2;
      ctx.beginPath(); ctx.moveTo(p[0], p[1] - h * 0.35); ctx.lineTo(q[0], q[1] - h * 0.35); ctx.stroke();
      for (let k = 0; k < 13; k++) {
        const u = 1.04 + (k + (r % 2) * 0.5) * ((S - 1.2) / 13);
        const [x, y] = P(u, v);
        ctx.fillStyle = stage >= 4 ? crop.ripe : crop.young;
        ctx.fillRect(x - 0.5, y - h, 1, h);
        if (!crop.fruit || stage < 2) continue;
        ctx.fillStyle = hash01(variant, r * 13 + k, 71) < 0.18 ? crop.bloom : crop.fruit;
        const fr = 0.9 + t * 0.8;
        ctx.beginPath(); ctx.arc(x, y - h, fr, 0, Math.PI * 2); ctx.fill();
        if (stage >= 3) { ctx.beginPath(); ctx.arc(x + 1.6, y - h + 1.2, fr * 0.8, 0, Math.PI * 2); ctx.fill(); }
      }
    }
  } else if (crop.kind === 'pigs') {
    // fenced pen with pigs; more pigs as the herd grows
    ctx.strokeStyle = COL.wood;
    ctx.lineWidth = 1;
    const c = [P(1.0, 0.15, 4), P(S - 0.12, 0.15, 4), P(S - 0.12, S - 0.12, 4), P(1.0, S - 0.12, 4)];
    ctx.beginPath(); c.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke();
    const n = resting ? 2 : 2 + stage * 2; // winter: most pigs stay in the sty
    for (let k = 0; k < n; k++) {
      const [x, y] = P(1.3 + hash01(variant, k, 61) * (S - 1.6), 0.4 + hash01(variant, k, 62) * (S - 0.8));
      ctx.fillStyle = '#e8a7a0';
      ctx.beginPath(); ctx.ellipse(x, y - 2, 3.4, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d98f88';
      ctx.beginPath(); ctx.arc(x + 3, y - 2.6, 1.4, 0, Math.PI * 2); ctx.fill();
    }
  }
  // farmhouse in the back corner (u 0..1)
  box(ctx, 0.12, 0.15, 0.7, 0.7, 0, 13, COL.cream);
  gableRoof(ctx, 0.12, 0.15, 0.7, 0.7, 13, 7, COL.terra, 'u');
  door(ctx, 'left', 0.12, 0.15, 0.82, 0.85, 0, 0.5);
  // hay stack
  const [hx, hy] = P(0.45, 1.3);
  ctx.fillStyle = COL.thatch;
  ctx.beginPath(); ctx.ellipse(hx, hy - 4, 5, 5, 0, Math.PI, 0); ctx.fill();
  ctx.fillRect(hx - 5, hy - 4, 10, 4);
}

function clayPitArt(ctx, S) {
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, '#a07a52');
  quad(ctx, 0.35, 0.35, S - 0.3, S - 0.3, 0, '#6a4428');
  quad(ctx, 0.5, 0.5, S - 0.45, S - 0.45, 0, '#58361f');
  // ladder
  const p = P(0.6, 0.45, 0);
  ctx.strokeStyle = COL.wood;
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(p[0] - 2, p[1]); ctx.lineTo(p[0] - 2, p[1] - 10); ctx.moveTo(p[0] + 2, p[1]); ctx.lineTo(p[0] + 2, p[1] - 10); ctx.stroke();
  // clay piles
  for (const [u, v] of [[0.3, S - 0.3], [S - 0.3, 0.3]]) {
    const [x, y] = P(u, v);
    ctx.fillStyle = '#b8683c';
    ctx.beginPath(); ctx.ellipse(x, y - 2, 6, 5, 0, Math.PI, 0); ctx.fill();
  }
}

function timberYardArt(ctx, S) {
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, '#9c8a62');
  box(ctx, 0.1, 0.1, 0.9, 0.7, 0, 14, COL.wood);
  gableRoof(ctx, 0.1, 0.1, 0.9, 0.7, 14, 6, '#7a5a3a', 'u');
  // log piles
  for (const [u, v] of [[1.1, 1.2], [0.5, 1.4], [1.5, 0.6]]) {
    for (let k = 0; k < 3; k++) {
      const [x, y] = P(u, v, k * 3);
      ctx.fillStyle = k % 2 ? '#8b5a2b' : '#7a4c24';
      ctx.fillRect(x - 8, y - 3, 16, 3);
      ctx.fillStyle = '#c9a36b';
      ctx.beginPath(); ctx.arc(x + 8, y - 1.5, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function mineArt(ctx, S, variant, state, key) {
  const marble = key === 'marble_quarry';
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, marble ? '#c9c2b2' : '#8c8274');
  if (marble) {
    box(ctx, 0.15, 0.15, 1.0, 0.8, 0, 16, '#e9e5dc');
    box(ctx, 0.15, 0.95, 0.6, 0.5, 0, 8, '#dedad0');
    for (const [u, v] of [[1.4, 1.3], [1.5, 0.5]]) box(ctx, u, v, 0.3, 0.3, 0, 5, '#f2efe8');
    const [x, y] = P(1.5, 1.0);
    ctx.strokeStyle = COL.woodDark;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 2, y - 24); ctx.lineTo(x - 12, y - 16); ctx.stroke();
  } else {
    ironMineArt(ctx, S);
  }
}

// ---------------------------------------------------------------------------
// Workshops
// ---------------------------------------------------------------------------

function workshopArt(ctx, S, variant, state, key) {
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, '#b9a57c');
  const wall = key === 'wine_ws' ? '#dcc7a3' : key === 'weapons_ws' ? '#bdb2a0' : key === 'fletcher_ws' ? '#d8c9a8' : COL.cream;
  box(ctx, 0.12, 0.12, 1.2, 0.95, 0, 18, wall);
  gableRoof(ctx, 0.12, 0.12, 1.2, 0.95, 18, 8, key === 'weapons_ws' ? COL.slate : COL.terra, 'u');
  door(ctx, 'left', 0.12, 0.12, 1.32, 1.07, 0, 0.4, '#3d2a1a', 0.2, 9);
  // chimney
  if (key === 'pottery_ws' || key === 'weapons_ws') {
    box(ctx, 0.9, 0.25, 0.18, 0.18, 18, 12, COL.stoneDark);
  }
  // product displays in the yard
  const yard = [[1.55, 0.5], [1.6, 1.2], [0.6, 1.55], [1.2, 1.65]];
  for (const [u, v] of yard) {
    const [x, y] = P(u, v);
    switch (key) {
      case 'pottery_ws':
        ctx.fillStyle = '#c7643e';
        ctx.beginPath(); ctx.ellipse(x, y - 4, 3, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(x - 1.5, y - 9, 3, 2);
        break;
      case 'furniture_ws':
        ctx.fillStyle = '#8a5a33';
        ctx.fillRect(x - 4, y - 5, 8, 1.6);
        ctx.fillRect(x - 3.5, y - 5, 1.2, 5);
        ctx.fillRect(x + 2.3, y - 5, 1.2, 5);
        break;
      case 'oil_ws':
      case 'wine_ws':
        ctx.fillStyle = key === 'oil_ws' ? '#c9b13a' : '#7b1f3a';
        ctx.beginPath(); ctx.ellipse(x, y - 4, 2.6, 4.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#a0703c';
        ctx.fillRect(x - 1, y - 10, 2, 2);
        break;
      case 'weapons_ws':
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(x - 3, y - 4, 6, 3);
        ctx.fillStyle = '#b8bec6';
        ctx.fillRect(x - 0.6, y - 12, 1.2, 8);
        break;
      case 'fletcher_ws':
        // a sheaf of arrows (iron tips, white fletching) and a strung bow
        ctx.strokeStyle = '#b89a64';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (let a = -2; a <= 2; a++) { ctx.moveTo(x + a * 0.6, y); ctx.lineTo(x + a * 1.3, y - 11); }
        ctx.stroke();
        ctx.fillStyle = '#f2eee6';
        for (let a = -2; a <= 2; a++) ctx.fillRect(x + a * 0.6 - 0.6, y - 3, 1.2, 2);
        ctx.fillStyle = '#6f7680';
        for (let a = -2; a <= 2; a++) ctx.fillRect(x + a * 1.3 - 0.5, y - 12.5, 1, 1.6);
        ctx.strokeStyle = '#6b4a2a';
        ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.arc(x + 6, y - 7, 5, -Math.PI / 2 - 0.9, -Math.PI / 2 + 0.9); ctx.stroke();
        break;
      default:
        break;
    }
  }
  if (key === 'oil_ws') {
    // press beam
    const [x, y] = P(1.6, 1.6);
    ctx.fillStyle = COL.woodDark;
    ctx.fillRect(x - 12, y - 12, 18, 2);
    ctx.fillRect(x + 4, y - 12, 2, 12);
  }
}

// ---------------------------------------------------------------------------
// Cloth (not in the original): the Linen Maker and the Clothing Maker
// ---------------------------------------------------------------------------

/** Natural linen and its shadow side. */
const LINEN = '#efe9d6';
const LINEN_SHADE = '#cfc6ab';

/** A bundle of retted flax standing on end (a stook), tied at the waist. */
function flaxStook(ctx, u, v) {
  const [x, y] = P(u, v);
  // A sheaf: splayed foot, tied waist, the seed heads fanning out on top.
  ctx.fillStyle = '#b9a76a';
  ctx.beginPath();
  ctx.moveTo(x - 3.6, y);
  ctx.lineTo(x - 1.4, y - 4.5);
  ctx.lineTo(x - 3.2, y - 9);
  ctx.lineTo(x + 3.2, y - 9);
  ctx.lineTo(x + 1.4, y - 4.5);
  ctx.lineTo(x + 3.6, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#d6c690'; // the lit side
  ctx.fillRect(x - 1.6, y - 8.5, 1.2, 8);
  ctx.fillStyle = '#8c7a46'; // seed heads
  for (const dx of [-2.4, -0.8, 0.8, 2.4]) { ctx.beginPath(); ctx.arc(x + dx, y - 9.3, 0.9, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#6b4a2a';
  ctx.fillRect(x - 1.8, y - 5, 3.6, 1.1);
}

/** A bolt of linen lying on its side: a pale roll with its end toward the viewer. */
function linenBolt(ctx, u, v, z = 0) {
  const [x, y] = P(u, v, z);
  ctx.fillStyle = LINEN_SHADE;
  ctx.fillRect(x - 5, y - 3, 8, 3);
  ctx.fillStyle = LINEN;
  ctx.fillRect(x - 5, y - 3.4, 8, 1.6);
  ctx.beginPath(); ctx.ellipse(x + 3, y - 1.7, 1.3, 1.7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = LINEN_SHADE;
  ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.arc(x + 3, y - 1.7, 0.7, 0, Math.PI * 1.6); ctx.stroke();
}

/**
 * Linen Maker: a weaving shed, and in its yard an upright loom of the
 * Roman kind: two posts and a beam, the woven cloth hanging from the beam
 * and the pale warp below it held taut by a row of clay weights. Stooks of
 * flax wait by the shed, and bolts of finished linen lie on a bench.
 */
function linenMakerArt(ctx, S) {
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, '#b9a57c');
  box(ctx, 0.12, 0.12, 1.25, 0.85, 0, 16, '#e4d8bc');
  gableRoof(ctx, 0.12, 0.12, 1.25, 0.85, 16, 8, COL.terra, 'u');
  door(ctx, 'left', 0.12, 0.12, 1.37, 0.97, 0, 0.3, '#3d2a1a', 0.2, 9);
  windows(ctx, 'right', 0.12, 0.12, 1.37, 0.97, 0, 1, 2, '#4a3a2a', { z: 7, h: 4 });
  // Flax waiting to be spun, along the shed's side.
  for (const [u, v] of [[1.6, 0.28], [1.82, 0.4], [1.62, 0.56]]) flaxStook(ctx, u, v);
  // Bolts of linen stacked on a low bench: two below, one on top.
  box(ctx, 1.48, 0.78, 0.4, 0.42, 0, 3, COL.wood);
  linenBolt(ctx, 1.6, 0.88, 3);
  linenBolt(ctx, 1.62, 1.08, 3);
  linenBolt(ctx, 1.61, 0.98, 6);
  // The loom, square to the shed's front: posts, beam, cloth, warp, weights.
  const top = 21;
  const [ax, ay] = P(0.42, 1.55);
  const [bx, by] = P(1.3, 1.55);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(bx + 4, by + 2); ctx.lineTo(ax + 4, ay + 2); ctx.closePath(); ctx.fill();
  const at = (t, z) => [ax + (bx - ax) * t, ay + (by - ay) * t - z];
  // The woven cloth, hanging from the beam (weaving runs downward).
  poly(ctx, [at(0.08, top - 1), at(0.92, top - 1), at(0.92, top - 9), at(0.08, top - 9)], LINEN, LINEN_SHADE, 0.5);
  ctx.strokeStyle = 'rgba(160,140,100,0.55)';
  ctx.lineWidth = 0.4;
  for (const z of [top - 4, top - 7]) {
    const [p, q] = [at(0.08, z), at(0.92, z)];
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
  }
  // The warp below the cloth, down to the weights.
  ctx.strokeStyle = '#f4efe0';
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  for (let k = 0; k <= 10; k++) {
    const [px, py] = at(0.1 + k * 0.08, top - 9);
    const [qx, qy] = at(0.1 + k * 0.08, 4);
    ctx.moveTo(px, py); ctx.lineTo(qx, qy);
  }
  ctx.stroke();
  ctx.fillStyle = '#9a5a36';
  for (let k = 0; k <= 10; k += 2) {
    const [x, y] = at(0.1 + k * 0.08, 3.5);
    ctx.beginPath(); ctx.arc(x, y, 1.1, 0, Math.PI * 2); ctx.fill();
  }
  // Posts and beam last, in front.
  ctx.fillStyle = COL.woodDark;
  for (const t of [0.02, 0.98]) {
    const [x, y] = at(t, 0);
    ctx.fillRect(x - 0.9, y - top - 2, 1.8, top + 2);
  }
  const [p, q] = [at(0, top), at(1, top)];
  ctx.strokeStyle = COL.wood;
  ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
  // A basket of spun thread at the loom's foot.
  const [tx, ty] = P(1.65, 1.75);
  ctx.fillStyle = '#b08850';
  ctx.fillRect(tx - 2.5, ty - 3, 5, 3);
  ctx.fillStyle = LINEN;
  for (const dx of [-1.2, 1.2]) { ctx.beginPath(); ctx.arc(tx + dx, ty - 3.4, 1.2, 0, Math.PI * 2); ctx.fill(); }
}

/** Tunic colors: woad blue, madder red, saffron, undyed linen and a sea green. */
const TUNICS = ['#4a6fa5', '#b0413e', '#d9a441', LINEN, '#4f8a7a'];

/** A tunic hanging by its shoulders at (x, y): body, short sleeves, a neck. */
function tunic(ctx, x, y, color, s = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x - 2.2 * s, y, 4.4 * s, 6.5 * s);
  ctx.fillRect(x - 3.6 * s, y, 7.2 * s, 2 * s);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(x + 0.9 * s, y + 2 * s, 1.3 * s, 4.5 * s); // the fold in shadow
  ctx.fillStyle = 'rgba(60,40,20,0.55)';
  ctx.fillRect(x - 0.7 * s, y, 1.4 * s, 0.8 * s); // the neck opening
}

/**
 * Clothing Maker: a tailor's shop with a striped awning over its counter,
 * folded clothes stacked on the counter, and a line of new tunics in every
 * dye drying in the yard.
 */
function clothingMakerArt(ctx, S, variant) {
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, '#c2b08a');
  box(ctx, 0.12, 0.12, 1.15, 1.0, 0, 18, '#ecdcbf');
  gableRoof(ctx, 0.12, 0.12, 1.15, 1.0, 18, 8, COL.terraDark, 'v');
  door(ctx, 'left', 0.12, 0.12, 1.27, 1.12, 0, 0.7, '#3d2a1a', 0.18, 9);
  windows(ctx, 'right', 0.12, 0.12, 1.27, 1.12, 0, 1, 2, '#4a3a2a', { z: 8, h: 4, shutters: '#4d6f8f' });
  // A striped awning over the counter on the street side.
  const stripes = 5;
  for (let k = 0; k < stripes; k++) {
    const a = 0.16 + (k * 0.6) / stripes;
    const b = a + 0.6 / stripes;
    poly(ctx, [P(a, 1.12, 13), P(b, 1.12, 13), P(b, 1.45, 9), P(a, 1.45, 9)], k % 2 ? LINEN : '#4a6fa5');
  }
  for (const u of [0.18, 0.74]) {
    const [x, y] = P(u, 1.43);
    ctx.fillStyle = COL.woodDark;
    ctx.fillRect(x - 0.5, y - 9, 1, 9);
  }
  // The counter with folded clothes on it.
  box(ctx, 0.22, 1.18, 0.5, 0.2, 0, 4, COL.wood);
  for (let k = 0; k < 3; k++) {
    const [x, y] = P(0.32 + k * 0.15, 1.27, 4);
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = TUNICS[(variant + k * 2 + j) % TUNICS.length];
      ctx.fillRect(x - 2.4, y - 1.7 * (j + 1), 4.8, 1.7);
    }
  }
  // The drying line across the yard, tunics hanging from it.
  const [ax, ay] = P(1.5, 0.25);
  const [bx, by] = P(1.6, 1.85);
  const H = 20;
  ctx.fillStyle = COL.woodDark;
  ctx.fillRect(ax - 0.6, ay - H, 1.2, H);
  ctx.fillRect(bx - 0.6, by - H, 1.2, H);
  ctx.strokeStyle = '#6b5a44';
  ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(ax, ay - H + 1); ctx.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 - H + 5, bx, by - H + 1); ctx.stroke();
  for (let k = 0; k < 4; k++) {
    const t = 0.16 + k * 0.22;
    const sag = 8 * t * (1 - t); // the curve's own sag: its control point sits 4 px low, so 2 px at the middle
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t - H + 1 + sag;
    tunic(ctx, x, y, TUNICS[(variant + k) % TUNICS.length], 1.3);
  }
}

// ---------------------------------------------------------------------------
// Storage & markets
// ---------------------------------------------------------------------------

function marketArt(ctx, S) {
  quad(ctx, 0.02, 0.02, S - 0.02, S - 0.02, 0, '#d6cab0');
  const stalls = [[0.2, 0.2], [1.1, 0.2], [0.2, 1.1], [1.1, 1.1]];
  const awnings = ['#b8573a', '#5d7fa3', '#d9a13a', '#7a9c5a'];
  stalls.forEach(([u, v], k) => {
    box(ctx, u, v, 0.7, 0.55, 0, 6, COL.wood, { top: '#a9875c' });
    // poles
    for (const [pu, pv] of [[u + 0.05, v + 0.6], [u + 0.65, v + 0.6]]) {
      const [x, y] = P(pu, pv);
      ctx.fillStyle = COL.woodDark;
      ctx.fillRect(x - 0.5, y - 14, 1, 14);
    }
    // striped awning
    poly(ctx, [P(u - 0.05, v - 0.05, 16), P(u + 0.75, v - 0.05, 16), P(u + 0.75, v + 0.7, 12), P(u - 0.05, v + 0.7, 12)], awnings[k], shade(awnings[k], -0.4), 0.5);
    for (let s = 1; s < 4; s += 2) {
      const a = u - 0.05 + (s / 4) * 0.8;
      poly(ctx, [P(a, v - 0.05, 16), P(a + 0.2, v - 0.05, 16), P(a + 0.2, v + 0.7, 12), P(a, v + 0.7, 12)], '#f2eee6');
    }
    // goods on the counter
    const [x, y] = P(u + 0.35, v + 0.3, 6);
    ctx.fillStyle = ['#e4c35a', '#6aa84f', '#d9534f', '#c7643e'][k];
    ctx.beginPath(); ctx.arc(x, y - 1, 2.2, 0, Math.PI * 2); ctx.fill();
  });
}

function granaryArt(ctx, S) {
  quad(ctx, 0.02, 0.02, S - 0.02, S - 0.02, 0, '#bfae88');
  // raised floor on piers
  box(ctx, 0.15, 0.15, S - 0.3, 1.6, 0, 5, COL.stoneDark);
  box(ctx, 0.2, 0.2, S - 0.4, 1.5, 5, 20, COL.cream);
  gableRoof(ctx, 0.2, 0.2, S - 0.4, 1.5, 25, 12, COL.terra, 'u');
  windows(ctx, 'left', 0.2, 0.2, S - 0.2, 1.7, 5, 1, 6, '#5a4a3a', { z: 16, h: 3, w: 0.1 });
  door(ctx, 'left', 0.2, 0.2, S - 0.2, 1.7, 5, 0.5, '#4a3222', 0.3, 12);
  // ramp
  poly(ctx, [P(1.2, 1.7, 5), P(1.8, 1.7, 5), P(1.8, 2.2, 0), P(1.2, 2.2, 0)], '#a08a5c');
}

function warehouseArt(ctx, S) {
  quad(ctx, 0.02, 0.02, S - 0.02, S - 0.02, 0, '#b9a987');
  // office in the back corner
  box(ctx, 0.1, 0.1, 1.0, 0.9, 0, 18, COL.cream);
  gableRoof(ctx, 0.1, 0.1, 1.0, 0.9, 18, 8, COL.terra, 'v');
  // low wall around the yard
  box(ctx, 1.12, 0.08, S - 1.2, 0.1, 0, 7, COL.stone);
  box(ctx, 0.08, 1.02, 0.1, S - 1.1, 0, 7, COL.stone);
  // bay markings
  ctx.strokeStyle = 'rgba(90,70,40,0.35)';
  ctx.lineWidth = 0.7;
  for (const [u0, v0] of WAREHOUSE_BAYS) {
    const pts = [P(u0, v0), P(u0 + 0.6, v0), P(u0 + 0.6, v0 + 0.6), P(u0, v0 + 0.6)];
    ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke();
  }
}

/** Where goods stacks go in a warehouse yard (u0, v0 of each 0.6 tile bay). */
export const WAREHOUSE_BAYS = [
  [1.25, 0.3], [2.05, 0.3], [1.25, 1.1], [2.05, 1.1], [0.3, 1.25], [0.3, 2.05], [1.25, 2.05], [2.05, 2.05],
];

/**
 * Draw goods stacks (dynamic, every frame) inside a warehouse sprite's local
 * space; turned with the warehouse, its office drawn again over any stack
 * it stands in front of (turn.js drawTurnedOver).
 */
export function drawWarehouseStock(ctx, stock, turn = 0, snow = 0) {
  return drawTurnedOver(ctx, 3, turn, (c) => overArt(c, snow, () => warehouseArt(c, 3)), (c) => warehouseCrates(c, stock), `warehouse:${snow}`);
}

/** The building's own art drawn again over live details: as in its sprite (snow, bare flag poles). */
function overArt(ctx, snow, fn) {
  liveFlags = true;
  setRoofSnow(snow);
  try { fn(); } finally { liveFlags = false; setRoofSnow(0); }
}

function warehouseCrates(ctx, stock) {
  let bay = 0;
  for (const [good, amount] of Object.entries(stock)) {
    if (amount < 1) continue;
    let crates = Math.ceil(amount / 100);
    while (crates > 0 && bay < WAREHOUSE_BAYS.length) {
      const inBay = Math.min(4, crates);
      crates -= inBay;
      const [u0, v0] = WAREHOUSE_BAYS[bay++];
      const color = GOODS[good]?.color || '#999';
      for (let k = 0; k < inBay; k++) {
        const du = (k % 2) * 0.28;
        const dv = Math.floor(k / 2) * 0.28;
        box(ctx, u0 + 0.04 + du, v0 + 0.04 + dv, 0.24, 0.24, 0, 6, color, { stroke: shade(color, -0.5) });
      }
    }
  }
}

/** Granary fill indicator: grain sacks in front of the building. */
export function drawGranaryStock(ctx, S, fill, turn = 0, snow = 0) {
  return drawTurnedOver(ctx, S, turn, (c) => overArt(c, snow, () => granaryArt(c, S)), (c) => granarySacks(c, S, fill), `granary:${snow}`);
}

function granarySacks(ctx, S, fill) {
  const sacks = Math.round(fill * 10);
  for (let k = 0; k < sacks; k++) {
    const u = 0.35 + (k % 5) * 0.3;
    const v = S - 0.55 + Math.floor(k / 5) * 0.25;
    const [x, y] = P(u, v);
    ctx.fillStyle = '#d9c28a';
    ctx.beginPath(); ctx.ellipse(x, y - 3, 3.4, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#9a8350';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
}

function genericArt(ctx, S) {
  quad(ctx, 0.04, 0.04, S - 0.04, S - 0.04, 0, COL.paving);
  box(ctx, 0.15, 0.15, S - 0.3, S - 0.3, 0, 14, COL.cream);
  hipRoof(ctx, 0.15, 0.15, S - 0.3, S - 0.3, 14, 8, COL.terra);
}


// ---------------------------------------------------------------------------
// Military
// ---------------------------------------------------------------------------

/** Small ground tent (a gable roof sitting on the earth). */
function tent(ctx, u, v, color = '#e3d7bb') {
  gableRoof(ctx, u, v, 0.42, 0.34, 0, 8, color, 'u', 0);
}

function barracksArt(ctx, S) {
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, '#b4a47e'); // packed-earth drill yard
  // long dormitory block along the back
  box(ctx, 0.12, 0.12, S - 0.24, 1.0, 0, 18, '#d9ccb0');
  gableRoof(ctx, 0.12, 0.12, S - 0.24, 1.0, 18, 8, COL.slate, 'u');
  windows(ctx, 'left', 0.12, 0.12, S - 0.12, 1.12, 0, 1, 6, '#3f3126', { z: 8, h: 4 });
  door(ctx, 'left', 0.12, 0.12, S - 0.12, 1.12, 0, 0.5, '#4a3222', 0.24, 10);
  // armory wing along the left side
  box(ctx, 0.12, 1.22, 0.9, S - 1.34, 0, 14, '#cfc1a2');
  gableRoof(ctx, 0.12, 1.22, 0.9, S - 1.34, 14, 7, shade(COL.slate, 0.08), 'v');
  door(ctx, 'right', 0.12, 1.22, 1.02, S - 0.12, 0, 0.5, '#4a3222', 0.24, 9);
  // wooden training posts in the yard
  for (const [u, v] of [[1.5, 1.6], [2.15, 1.6], [1.5, 2.35], [2.15, 2.35]]) {
    const [x, y] = P(u, v);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(x + 2, y, 3, 1.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COL.woodDark;
    ctx.fillRect(x - 1, y - 11, 2, 11);
  }
  // spear rack
  const [rx, ry] = P(S - 0.22, 1.55);
  ctx.fillStyle = COL.wood;
  ctx.fillRect(rx - 6, ry - 8, 12, 1.4);
  ctx.strokeStyle = '#b8bec6';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let k = 0; k < 4; k++) { ctx.moveTo(rx - 4.5 + k * 3, ry); ctx.lineTo(rx - 4.5 + k * 3, ry - 15); }
  ctx.stroke();
  flagPoles(ctx, 'barracks', S);
}

/**
 * Military Academy: a sanded drill yard with the ranks' lines raked into it,
 * a colonnaded hall along the back, training posts (the pali recruits strike
 * with wooden swords) with a wicker shield hung on one, a rack of practice
 * javelins, and the instructor's stone tribunal flying the standard.
 */
function militaryAcademyArt(ctx, S) {
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, '#cdb88c'); // the sanded yard
  // the ranks' lines raked in the sand
  ctx.strokeStyle = 'rgba(120,96,60,0.35)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (const v of [1.45, 1.85, 2.25, 2.65]) {
    const [ax, ay] = P(0.25, v);
    const [bx, by] = P(S - 0.9, v);
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
  }
  ctx.stroke();
  // the hall along the back, its colonnade facing the yard
  box(ctx, 0.1, 0.1, S - 0.2, 0.62, 0, 17, '#ddd0b2');
  windows(ctx, 'right', 0.1, 0.1, S - 0.1, 0.72, 0, 1, 2, '#3f3126', { z: 8, h: 4 });
  colonnade(ctx, 0.2, 0.98, S - 0.2, 0.98, 7, 0, 17, COL.marble, 1.5);
  gableRoof(ctx, 0.06, 0.06, S - 0.12, 0.98, 17, 9, COL.terra, 'u', 0.04);
  // the instructor's tribunal at the right of the yard, the standard on it
  box(ctx, S - 0.62, 1.12, 0.42, 0.42, 0, 5, shade(COL.stone, 0.08));
  flagPoles(ctx, 'military_academy', S);
  // training posts in rows, a wicker shield hung on the first
  for (const [u, v] of [[0.55, 1.65], [1.05, 1.65], [0.55, 2.3], [1.05, 2.3], [1.55, 2.3]]) {
    const [x, y] = P(u, v);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(x + 2, y, 3, 1.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COL.woodDark;
    ctx.fillRect(x - 1.1, y - 13, 2.2, 13);
  }
  const [sx, sy] = P(0.55, 1.65, 7);
  ctx.fillStyle = '#b89a5a';
  ctx.beginPath(); ctx.ellipse(sx + 2.2, sy, 2.6, 3.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#7a6236';
  ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.ellipse(sx + 2.2, sy, 1.5, 2.4, 0, 0, Math.PI * 2); ctx.stroke();
  // the rack of practice javelins at the front right
  const [rx, ry] = P(S - 0.25, 2.35);
  ctx.fillStyle = COL.wood;
  ctx.fillRect(rx - 6, ry - 8, 12, 1.4);
  ctx.strokeStyle = '#c8b48a';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let k = 0; k < 5; k++) { ctx.moveTo(rx - 5 + k * 2.5, ry); ctx.lineTo(rx - 5 + k * 2.5, ry - 16); }
  ctx.stroke();
}

/**
 * Walled camp (castra): corner towers, a gate facing the viewer, and inside
 * tents (legion, archers) or a stable (cavalry). Flies its soldiers' color.
 */
function fortArt(ctx, S, variant, state, key) {
  const unit = BUILDINGS[key]?.unit;
  const color = UNIT_TYPES[unit]?.color || '#a8322b';
  const wall = '#b9ad92';
  const T = 0.12; // wall thickness
  const H = 11; // wall height
  const TW = 0.44; // tower size
  const TH2 = 21; // tower height
  quad(ctx, 0.02, 0.02, S - 0.02, S - 0.02, 0, '#a99a74');
  const tower = (u, v) => {
    box(ctx, u, v, TW, TW, 0, TH2, shade(wall, -0.04));
    box(ctx, u - 0.04, v - 0.04, TW + 0.08, TW + 0.08, TH2, 3, shade(wall, 0.08));
  };
  // back towers and walls (drawn first: they are behind everything)
  tower(0.02, 0.02);
  box(ctx, TW, 0.1, S - 2 * TW, T, 0, H, wall);
  box(ctx, 0.1, TW, T, S - 2 * TW, 0, H, wall);
  tower(S - TW - 0.02, 0.02);
  tower(0.02, S - TW - 0.02);
  // interior
  if (key === 'fort_cavalry') {
    box(ctx, 0.5, 0.55, 0.5, S - 1.1, 0, 9, COL.wood);
    gableRoof(ctx, 0.5, 0.55, 0.5, S - 1.1, 9, 5, '#7a5a3a', 'v');
    const [hx, hy] = P(1.7, 1.2);
    horse(ctx, hx, hy, 0.9, '#8a5a3c', 1);
    const [gx, gy] = P(2.0, 1.75);
    horse(ctx, gx, gy, 0.9, '#d9d0c0', -1, 0, '#8a7a6a');
  } else {
    for (const [u, v] of [[0.62, 0.62], [1.28, 0.62], [1.94, 0.62], [0.62, 1.3]]) tent(ctx, u, v);
    if (key === 'fort_archer') {
      // straw target on a stand
      const [x, y] = P(2.05, 1.55);
      ctx.fillStyle = COL.woodDark;
      ctx.fillRect(x - 0.6, y - 10, 1.2, 10);
      ctx.fillStyle = '#e1cf8e';
      ctx.beginPath(); ctx.arc(x, y - 11, 4.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c0392b';
      ctx.beginPath(); ctx.arc(x, y - 11, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e1cf8e';
      ctx.beginPath(); ctx.arc(x, y - 11, 1, 0, Math.PI * 2); ctx.fill();
    } else {
      tent(ctx, 1.94, 1.3);
    }
  }
  flagPoles(ctx, key, S); // the fort's standard in its soldiers' color
  // front walls: right face (+u), then the front-left face (+v) with the gate
  box(ctx, S - 0.1 - T, TW, T, S - 2 * TW, 0, H, wall);
  const g0 = S / 2 - 0.32;
  const g1 = S / 2 + 0.32;
  const fv = S - 0.1 - T;
  box(ctx, TW, fv, g0 - TW, T, 0, H, wall);
  box(ctx, g1, fv, S - TW - g1, T, 0, H, wall);
  box(ctx, g0 - 0.12, fv - 0.04, 0.14, T + 0.08, 0, H + 6, shade(wall, -0.08));
  box(ctx, g1 - 0.02, fv - 0.04, 0.14, T + 0.08, 0, H + 6, shade(wall, -0.08));
  box(ctx, g0 - 0.12, fv - 0.02, g1 - g0 + 0.24, T + 0.04, H + 6, 3, shade(wall, 0.05));
  // shields hung on the front wall in the unit color
  for (const u of [TW + 0.25, S - TW - 0.25]) {
    const [x, y] = P(u, S - 0.1, 6);
    ctx.fillStyle = color;
    ctx.fillRect(x - 2, y - 3, 4, 5);
    ctx.fillStyle = COL.gold;
    ctx.fillRect(x - 0.6, y - 1, 1.2, 1.2);
  }
  tower(S - TW - 0.02, S - TW - 0.02);
}

/** Stone watchtower with a crenellated top and an archer on watch. */
function towerArt(ctx, S) {
  const stone = '#b9ad92';
  quad(ctx, 0.04, 0.04, S - 0.04, S - 0.04, 0, COL.paving);
  const a = 0.32;
  const w = S - 0.64;
  const h = 44;
  box(ctx, a, a, w, w, 0, h, stone);
  // stone courses
  ctx.strokeStyle = 'rgba(80,70,55,0.35)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let z = 8; z < h; z += 8) {
    const p0 = P(a, a + w, z);
    const p1 = P(a + w, a + w, z);
    const p2 = P(a + w, a, z);
    ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]);
  }
  ctx.stroke();
  door(ctx, 'left', a, a, a + w, a + w, 0, 0.5, '#4a3222', 0.3, 11);
  windows(ctx, 'left', a, a, a + w, a + w, 0, 2, 1, '#2a241c', { z: 18, h: 7, w: 0.06, gap: 13 });
  windows(ctx, 'right', a, a, a + w, a + w, 0, 2, 1, '#2a241c', { z: 18, h: 7, w: 0.06, gap: 13 });
  // overhanging fighting platform
  const o = 0.1;
  box(ctx, a - o, a - o, w + 2 * o, w + 2 * o, h, 5, shade(stone, 0.06));
  // archer on watch (behind the front merlons)
  const [x, y] = P(a + w / 2, a + w / 2, h + 5);
  ctx.fillStyle = '#3f7a3a';
  ctx.fillRect(x - 2.4, y - 9, 4.8, 7);
  ctx.fillStyle = '#e3b68c';
  ctx.beginPath(); ctx.arc(x, y - 11, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#6b4a2a';
  ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.arc(x + 4, y - 7, 5, -Math.PI / 2 - 0.9, -Math.PI / 2 + 0.9); ctx.stroke();
  // merlons along the two front edges
  const m = 0.16;
  for (let k = 0; k < 4; k++) {
    const t = a - o + (k + 0.5) * ((w + 2 * o) / 4);
    box(ctx, t - m / 2, a + w + o - m, m, m, h + 5, 4, shade(stone, 0.1));
    box(ctx, a + w + o - m, t - m / 2, m, m, h + 5, 4, shade(stone, 0.1));
  }
}

/** Horse ranch: stable, fenced paddock and the breeding herd (state = herd size). */
function ranchArt(ctx, S, variant, herd) {
  quad(ctx, 0.03, 0.03, S - 0.03, S - 0.03, 0, '#86a85a');
  // trodden earth near the stable
  quad(ctx, 0.1, 0.9, 1.2, S - 0.2, 0, '#9a9a5c');
  // stable in the back corner
  box(ctx, 0.12, 0.12, 1.25, 0.7, 0, 12, COL.wood);
  gableRoof(ctx, 0.12, 0.12, 1.25, 0.7, 12, 7, '#7a5a3a', 'u');
  door(ctx, 'left', 0.12, 0.12, 1.37, 0.82, 0, 0.3, '#3d2a1a', 0.22, 9);
  door(ctx, 'left', 0.12, 0.12, 1.37, 0.82, 0, 0.7, '#3d2a1a', 0.22, 9);
  // hay and water trough
  const [hx, hy] = P(0.35, 1.25);
  ctx.fillStyle = COL.thatch;
  ctx.beginPath(); ctx.ellipse(hx, hy - 4, 5, 5, 0, Math.PI, 0); ctx.fill();
  ctx.fillRect(hx - 5, hy - 4, 10, 4);
  box(ctx, 0.9, 1.1, 0.5, 0.14, 0, 3, COL.wood, { top: COL.water });
  // paddock fence
  const f = [[1.5, 0.15], [S - 0.12, 0.15], [S - 0.12, S - 0.12], [0.2, S - 0.12], [0.2, 1.6]];
  ctx.strokeStyle = '#f0e6d0';
  ctx.lineWidth = 0.8;
  for (let k = 1; k < f.length; k++) {
    // (Rail by rail, so a turned ranch can sort each against the stable.)
    ctx.beginPath();
    for (const z of [3, 6]) {
      const a = P(...f[k - 1], z);
      const b = P(...f[k], z);
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
  }
  ctx.fillStyle = '#d9ceb4';
  for (const [u, v] of f) { const [x, y] = P(u, v); ctx.fillRect(x - 0.6, y - 7, 1.2, 7); }
  // horses, back to front so nearer ones overlap farther ones
  const coats = ['#8a5a3c', '#5a3a26', '#d9d0c0', '#a8744a', '#3b2a20', '#b89a78'];
  const spots = [];
  for (let k = 0; k < Math.max(1, herd); k++) {
    spots.push({ u: 1.45 + hash01(variant, k, 71) * (S - 1.8), v: 0.5 + hash01(variant, k, 72) * (S - 1.0), k });
  }
  spots.sort((p1, p2) => p1.u + p1.v - (p2.u + p2.v));
  for (const s of spots) {
    const [x, y] = P(s.u, s.v);
    horse(ctx, x, y, 0.85, coats[(s.k + variant) % coats.length], hash01(variant, s.k, 73) < 0.5 ? 1 : -1);
  }
}

/**
 * Dock: plank quay with a crane and bollards on the water side, a store
 * shed and cargo on the land side. `side` = which edge faces the water
 * (0 = -v, 1 = +u, 2 = +v, 3 = -u); the layout is designed with water on
 * the +u edge and mirrored/rotated into place.
 */
function dockArt(ctx, S, variant, side = 1) {
  const T = (u, v) => (side === 1 ? [u, v] : side === 3 ? [S - u, v] : side === 2 ? [v, u] : [v, S - u]);
  const rect = (u0, v0, du, dv) => {
    const a = T(u0, v0);
    const b = T(u0 + du, v0 + dv);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])];
  };
  quad(ctx, 0.02, 0.02, S - 0.02, S - 0.02, 0, '#a07e55');
  // plank seams parallel to the water edge
  ctx.strokeStyle = 'rgba(70,45,25,0.45)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let u = 0.3; u < S; u += 0.3) {
    const p = P(...T(u, 0.04));
    const q = P(...T(u, S - 0.04));
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
  }
  ctx.stroke();
  // 3D pieces, drawn back to front by their position on screen
  const items = [];
  const shed = rect(0.15, 0.2, 1.15, S - 0.4);
  items.push({ d: shed[0] + shed[1], draw: () => {
    box(ctx, shed[0], shed[1], shed[2], shed[3], 0, 15, '#d8c9a8');
    gableRoof(ctx, shed[0], shed[1], shed[2], shed[3], 15, 7, COL.terra, shed[2] >= shed[3] ? 'u' : 'v');
  } });
  for (const [cu, cv, color] of [[1.55, 0.45, '#8a5a33'], [1.55, 0.8, '#b8683c'], [1.9, 0.5, '#c9b13a'], [1.5, S - 0.7, '#7b1f3a']]) {
    const r = rect(cu, cv, 0.26, 0.26);
    items.push({ d: r[0] + r[1] + 0.3, draw: () => box(ctx, r[0], r[1], r[2], r[3], 0, 6, color) });
  }
  const [crU, crV] = T(S - 0.45, S * 0.55);
  items.push({ d: crU + crV, draw: () => {
    const [x, y] = P(crU, crV);
    ctx.strokeStyle = COL.woodDark;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 4, y); ctx.lineTo(x, y - 28); ctx.lineTo(x + 4, y);
    const tip = P(...T(S + 0.3, S * 0.55), 34);
    ctx.moveTo(x, y - 28); ctx.lineTo(tip[0], tip[1]);
    ctx.stroke();
    ctx.strokeStyle = '#3a3026';
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(tip[0], tip[1]); ctx.lineTo(tip[0], tip[1] + 12); ctx.stroke();
    ctx.fillStyle = '#c9a36b';
    ctx.fillRect(tip[0] - 2.5, tip[1] + 12, 5, 4);
  } });
  for (const bv of [0.4, S / 2, S - 0.4]) {
    const [bu, bvv] = T(S - 0.12, bv);
    items.push({ d: bu + bvv, draw: () => {
      const [x, y] = P(bu, bvv);
      ctx.fillStyle = '#4a3a2a';
      ctx.fillRect(x - 1.3, y - 5, 2.6, 5);
      ctx.fillStyle = '#6b5640';
      ctx.fillRect(x - 1.8, y - 6, 3.6, 1.4);
    } });
  }
  items.sort((a, b) => a.d - b.d);
  for (const it of items) it.draw();
}

const ART = {
  house: houseArt,
  well: wellArt,
  fountain: fountainArt,
  reservoir: reservoirArt,
  barber: barberArt,
  clinic: clinicArt,
  baths: bathsArt,
  hospital: hospitalArt,
  oracle: oracleArt,
  school: schoolArt,
  library: libraryArt,
  academy: academyArt,
  theater: theaterArt,
  amphitheater: amphitheaterArt,
  colosseum: colosseumArt,
  actor_troupe: actorTroupeArt,
  gladiator_school: gladiatorSchoolArt,
  menagerie: menagerieArt,
  forum: forumArt,
  senate: senateArt,
  governor_house: governorHouseArt,
  governor_villa: governorVillaArt,
  governor_palace: governorPalaceArt,
  garden: gardenArt,
  statue_small: statueArt,
  statue_medium: statueArt,
  statue_large: statueArt,
  triumphal_arch: triumphalArchArt,
  engineer_post: engineerArt,
  prefecture: prefectureArt,
  clay_pit: clayPitArt,
  timber_yard: timberYardArt,
  iron_mine: mineArt,
  marble_quarry: mineArt,
  market: marketArt,
  granary: granaryArt,
  warehouse: warehouseArt,
  barracks: barracksArt,
  fort_legion: fortArt,
  fort_archer: fortArt,
  fort_cavalry: fortArt,
  tower: towerArt,
  horse_ranch: ranchArt,
  dock: dockArt,
  shipyard: shipyardArt,
  wharf: wharfArt,
  navalia: navaliaArt,
  naval_station: stationArt,
  portus: portusArt,
  military_academy: militaryAcademyArt,
  hippodrome: hippodromeArt,
  hippodrome_part: hippodromeArt,
  chariot_maker: chariotMakerArt,
  linen_ws: linenMakerArt,
  clothing_ws: clothingMakerArt,
  native_hut: nativeHutArt,
  native_meeting: nativeMeetingArt,
  native_crops: nativeCropsArt,
  mission_post: missionPostArt,
};

/**
 * Art state that changes the building's look (part of the sprite key).
 * `resting`: a farm resting for the winter (Insane) draws its crop at the
 * height it reached, in dry winter tones, with bare fruit trees and vines
 * and fewer pigs (state 5..9 = growth stage + 5).
 */
export function artState(b, resting = false) {
  const kind = b.def.kind;
  if (b.house) return b.house.tier;
  if (b.herd !== undefined) return b.herd; // horse ranch: one sprite per herd size
  if (kind === 'dock' || kind === 'station' || kind === 'portus') return b.waterSide ?? 1; // which edge faces the water (see dockArt)
  // Navalia: the water's edge, and the liburnian on the slip (0 none, 1 keel and frames, 2 planked).
  if (kind === 'navalia') return (b.waterSide ?? 1) + 4 * (!(b.progress > 0) ? 0 : b.progress < 50 ? 1 : 2);
  // Shipyard: the water's edge, and the boat on the slip (0 none, 1 ribs, 2 planked; none while its spare waits on the water).
  if (kind === 'shipyard') return (b.waterSide ?? 1) + 4 * (b.spareId || !(b.progress > 0) ? 0 : b.progress < 50 ? 1 : 2);
  if (kind === 'wharf') return (b.waterSide ?? 1) + 4 * ((b.stock?.fish || 0) > 0 ? 1 : 0); // baskets of fish on the deck
  if (kind === 'part') return b.section || 0; // a hippodrome's stretch of track
  if (kind === 'arch') return b.axis || 0; // the way the road runs under it
  if (kind === 'farm') return Math.min(4, Math.floor(b.progress / 20)) + (resting ? 5 : 0);
  // Water works and what runs on piped water (the baths) show it: a full
  // pool, or a dry one (the baths were always drawn full, even out of a
  // reservoir's reach, which said they worked when they did not).
  if (kind === 'reservoir' || kind === 'fountain' || b.def.needsPiped) return b.hasWater ? 1 : 0;
  return 0;
}

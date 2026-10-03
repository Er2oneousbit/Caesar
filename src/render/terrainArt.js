/**
 * terrainArt.js
 * ----------------------------------------------------------------------------
 * Procedural art for ground tiles (grass, meadow, sand, water, roads, plazas,
 * bridges, rubble) and small terrain objects (trees, rocks, aqueducts).
 * All original drawings made from simple shapes.
 *
 * Tile sprites: 64x32 diamond, anchor at the top corner. Each land type
 * has 8 variants so large fields do not look tiled.
 *
 * Seasons: grass, meadow, forest-floor and tree colors come from a palette
 * (weather.js seasonPalette), so the renderer asks for the current month's
 * look. Lying snow (pal.snow, 0..1) whitens the ground (SNOW_HOLD: sand and
 * rock keep less), caps the trees, the tops of the rocks and a stone
 * bridge's parapets. Water, roads, plazas and bridge decks stay as they
 * are: cleared roads read well in the snow.
 *
 * Edge blending: where two kinds of ground meet, blendSpec() draws a wavy
 * fringe of the "stronger" neighbour onto the weaker tile (forest floor >
 * grass > meadow > sand > rock), so the map shows soft, natural edges instead
 * of hard diamond steps. BLEND_RANK says who spreads onto whom.
 * ----------------------------------------------------------------------------
 */

import { HALF_W, HALF_H, CONFIG } from '../config.js';
import { Terrain } from '../world/map.js';
import { P, poly, quad, shade, mix, tree, bareTree, cypress, hash01, SNOW, SNOW_SHADE } from './draw.js';
import { seasonPalette } from './weather.js';

const TW = CONFIG.TILE_W;
const TH = CONFIG.TILE_H;

export const TERRAIN_COLORS = {
  [Terrain.GRASS]: '#7ea34d',
  [Terrain.MEADOW]: '#a7ad55',
  [Terrain.TREES]: '#6f9644',
  [Terrain.ROCK]: '#9a9282',
  [Terrain.WATER]: '#3a77a8',
  [Terrain.SAND]: '#d8c38e',
};

/**
 * Which ground spreads onto which at a boundary: a tile gets a fringe from a
 * neighbour with a HIGHER rank. Water (and anything unlisted) never blends;
 * shorelines have their own art.
 */
export const BLEND_RANK = Object.freeze({
  [Terrain.ROCK]: 1,
  [Terrain.SAND]: 2,
  [Terrain.MEADOW]: 3,
  [Terrain.GRASS]: 4,
  [Terrain.TREES]: 5,
});

/** How much of the snow each ground keeps (warm beach sand and bare rock less). */
const SNOW_HOLD = Object.freeze({
  [Terrain.GRASS]: 1,
  [Terrain.MEADOW]: 1,
  [Terrain.TREES]: 0.9,
  [Terrain.SAND]: 0.7,
  [Terrain.ROCK]: 0.6,
});

/** Snow on a ground type in this palette, 0..1. */
function snowOn(type, pal) {
  return pal.snow ? pal.snow * (SNOW_HOLD[type] || 0) : 0;
}

/** Base ground color of a terrain type in a season (whitened by lying snow). */
export function groundColor(type, pal = seasonPalette(null)) {
  let c;
  switch (type) {
    case Terrain.GRASS: c = pal.grass; break;
    case Terrain.MEADOW: c = pal.meadow; break;
    case Terrain.TREES: c = pal.forest; break;
    case Terrain.SAND: c = pal.sand; break;
    default: c = TERRAIN_COLORS[type];
  }
  const sn = snowOn(type, pal);
  return sn ? mix(c, SNOW, sn) : c;
}

/**
 * Texture of lying snow: soft brighter drifts and blue-grey hollows. Drawn
 * on top of the ground's own texture, so thin snow still shows grass.
 */
function snowTexture(ctx, seed, sn) {
  ctx.globalAlpha = 0.35 + sn * 0.5;
  ctx.fillStyle = SNOW;
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const [x, y] = P(0.2 + hash01(seed, k, 101) * 0.6, 0.2 + hash01(seed, k, 102) * 0.6);
    const rx = 4 + hash01(seed, k, 103) * 6;
    ctx.moveTo(x + rx, y);
    ctx.ellipse(x, y, rx, rx * 0.4, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.globalAlpha = 0.3 + sn * 0.3;
  ctx.fillStyle = SNOW_SHADE;
  for (let k = 0; k < 7; k++) {
    const [x, y] = P(0.1 + hash01(seed, k, 104) * 0.8, 0.1 + hash01(seed, k, 105) * 0.8);
    ctx.fillRect(x - 1.6, y - 0.4, 3.2, 0.9);
  }
  ctx.globalAlpha = 1;
}

/** Diamond slightly larger than the tile to hide seams between tiles. */
function tileDiamond(ctx, color) {
  const e = 0.7;
  poly(ctx, [[0, -e], [HALF_W + e * 2, HALF_H], [0, TH + e], [-HALF_W - e * 2, HALF_H]], color);
}

/** Random speckles for ground texture. */
function speckle(ctx, seed, count, colors, size = 1.4) {
  for (let k = 0; k < count; k++) {
    const u = hash01(seed, k, 1);
    const v = hash01(seed, k, 2);
    const [x, y] = P(u, v);
    ctx.fillStyle = colors[k % colors.length];
    ctx.fillRect(x - size / 2, y - size / 4, size, size * 0.6);
  }
}

/** Small pebbles with a lit top (ground detail). */
function pebbles(ctx, seed, count, color) {
  for (let k = 0; k < count; k++) {
    const [x, y] = P(0.15 + hash01(seed, k, 51) * 0.7, 0.15 + hash01(seed, k, 52) * 0.7);
    const r = 0.8 + hash01(seed, k, 53) * 1.1;
    ctx.fillStyle = shade(color, -0.25);
    ctx.beginPath(); ctx.ellipse(x + 0.4, y + 0.3, r, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shade(color, 0.3);
    ctx.fillRect(x - r * 0.4, y - r * 0.4, r * 0.6, r * 0.3);
  }
}

/** A soft darker or lighter patch on the ground (worn earth, clover, damp). */
function patch(ctx, seed, color, alpha) {
  const [x, y] = P(0.3 + hash01(seed, 61) * 0.4, 0.3 + hash01(seed, 62) * 0.4);
  const rx = 6 + hash01(seed, 63) * 7;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, rx * 0.45, 0, 0, Math.PI * 2);
  ctx.ellipse(x + rx * 0.5, y + 1.5, rx * 0.6, rx * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * Spec for a plain ground tile.
 * @param {number} type     Terrain
 * @param {number} variant  0..7
 * @param {object} [pal]    season palette (weather.js); summer when omitted
 */
export function groundTileSpec(type, variant, pal = seasonPalette(null)) {
  return {
    w: TW + 4,
    h: TH + 3,
    ax: HALF_W + 2,
    ay: 1,
    draw(ctx) {
      const base = groundColor(type, pal);
      const sn = snowOn(type, pal);
      // Per-variant shading breaks up large fields; under snow it is softer,
      // or the near-white tiles would show a diamond quilt.
      const tint = ((variant & 3) - 1.5) * 0.025 * (1 - 0.6 * sn);
      if (type === Terrain.WATER) {
        tileDiamond(ctx, base);
        return;
      }
      tileDiamond(ctx, shade(base, tint));
      const seed = type * 97 + variant * 13;
      if (type === Terrain.GRASS || type === Terrain.TREES) {
        if (variant === 5) patch(ctx, seed, shade(base, -0.18), 0.35); // worn patch
        if (variant === 6) patch(ctx, seed, shade(base, 0.14), 0.4); // clover
        speckle(ctx, seed, 26, [shade(base, -0.14), shade(base, 0.12), shade(base, -0.06)]);
        // a few grass tufts
        ctx.strokeStyle = shade(base, -0.22);
        ctx.lineWidth = 0.7;
        for (let k = 0; k < 5 - Math.round(sn * 3); k++) {
          const [x, y] = P(hash01(seed, k, 5) * 0.8 + 0.1, hash01(seed, k, 6) * 0.8 + 0.1);
          ctx.beginPath();
          ctx.moveTo(x - 1.5, y);
          ctx.lineTo(x - 0.5, y - 2.5);
          ctx.moveTo(x + 1.2, y);
          ctx.lineTo(x + 0.6, y - 2.2);
          ctx.stroke();
        }
        if (variant === 3 || variant === 7) pebbles(ctx, seed, 2, '#a39a88');
        if (type === Terrain.TREES) {
          // forest floor: fallen leaves in the season's colors
          for (let k = 0; k < Math.round(9 * (1 - sn)); k++) {
            const [x, y] = P(hash01(seed, k, 71) * 0.8 + 0.1, hash01(seed, k, 72) * 0.8 + 0.1);
            ctx.fillStyle = pal.leaves[k % pal.leaves.length];
            ctx.fillRect(x - 0.9, y - 0.5, 1.8, 1);
          }
        } else if (pal.flowers > 1.2 && !sn) {
          // spring: a few wild flowers in the grass too
          for (let k = 0; k < 3; k++) {
            const [x, y] = P(hash01(seed, k, 73) * 0.8 + 0.1, hash01(seed, k, 74) * 0.8 + 0.1);
            ctx.fillStyle = k % 2 ? '#f7f2e4' : '#f4e27a';
            ctx.fillRect(x - 0.7, y - 0.7, 1.4, 1.4);
          }
        }
      } else if (type === Terrain.MEADOW) {
        speckle(ctx, seed, 22, [shade(base, -0.12), shade(base, 0.1)]);
        // little flowers (lots in spring, hardly any in winter)
        const n = sn ? 0 : Math.round(7 * pal.flowers);
        const colors = ['#f4e27a', '#f7f2e4', '#d9a3c7', '#9fb4e8', '#e9876b'];
        for (let k = 0; k < n; k++) {
          const [x, y] = P(hash01(seed, k, 7) * 0.8 + 0.1, hash01(seed, k, 8) * 0.8 + 0.1);
          ctx.fillStyle = colors[(k + variant) % (pal.flowers > 1.2 ? 5 : 3)];
          ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
        }
      } else if (type === Terrain.SAND) {
        speckle(ctx, seed, 28, [shade(base, -0.1), shade(base, 0.08), shade(base, -0.18)], 1.1);
        if (variant & 1) {
          // wind ripples
          ctx.strokeStyle = shade(base, -0.12);
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          for (let k = 0; k < 3; k++) {
            const [x, y] = P(0.25 + k * 0.2, 0.3 + hash01(seed, k, 81) * 0.4);
            ctx.moveTo(x - 6, y);
            ctx.quadraticCurveTo(x, y - 1.6, x + 6, y);
          }
          ctx.stroke();
        }
        if (variant === 2 || variant === 6) pebbles(ctx, seed, 2, '#bfb39b');
      } else if (type === Terrain.ROCK) {
        speckle(ctx, seed, 30, [shade(base, -0.15), shade(base, 0.1)]);
        // cracks
        ctx.strokeStyle = shade(base, -0.3);
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        const [x, y] = P(0.3 + hash01(seed, 91) * 0.4, 0.3 + hash01(seed, 92) * 0.4);
        ctx.moveTo(x - 7, y + 1);
        ctx.lineTo(x - 2, y - 1);
        ctx.lineTo(x + 3, y + 0.5);
        ctx.lineTo(x + 7, y - 1.5);
        ctx.stroke();
        pebbles(ctx, seed, 3, '#a39a88');
      }
      if (sn) snowTexture(ctx, seed, sn);
    },
  };
}

/**
 * A ground tile with its edge blend already painted on: one sprite, one draw.
 * (Drawing the blend as a second sprite per tile added enough draw calls to
 * push busy views past the point where the browser flushes the canvas
 * mid-frame, which doubled the frame time when zoomed out.)
 * @param {number} code packed blend code: (type << 8) | (edges << 4) | corners
 */
export function groundBlendSpec(type, variant, code, pal = seasonPalette(null)) {
  const g = groundTileSpec(type, variant, pal);
  const b = blendSpec(code >> 8, (code >> 4) & 15, code & 15, variant & 3, pal);
  return { ...g, draw(ctx) { g.draw(ctx); b.draw(ctx); } };
}

/**
 * Soft edge where a stronger ground type `type` borders this tile.
 * edges bits (neighbour of that type on this side): 1=N 2=E 4=S 8=W.
 * corners bits (only a diagonal neighbour): 1=NE 2=SE 4=SW 8=NW.
 * A wavy fringe runs along each edge; the waves always meet the tile corners
 * at the same depth, so fringes on neighbouring tiles join up seamlessly.
 */
export function blendSpec(type, edges, corners, variant, pal = seasonPalette(null)) {
  return {
    w: TW + 4,
    h: TH + 3,
    ax: HALF_W + 2,
    ay: 1,
    draw(ctx) {
      const base = groundColor(type, pal);
      const seed = type * 131 + variant * 17 + edges * 3;
      const shapes = (depth) => {
        ctx.beginPath();
        for (let side = 0; side < 4; side++) if (edges & (1 << side)) fringePath(ctx, side, depth, seed + side * 7);
        for (let c = 0; c < 4; c++) if (corners & (1 << c)) cornerPath(ctx, c, depth * 0.8);
      };
      // a soft outer band, then the solid fringe
      ctx.fillStyle = base;
      ctx.globalAlpha = 0.4;
      shapes(0.34);
      ctx.fill();
      ctx.globalAlpha = 1;
      shapes(0.2);
      ctx.fill();
      // the neighbour's texture inside the fringe
      ctx.save();
      shapes(0.3);
      ctx.clip();
      speckle(ctx, seed, 26, [shade(base, -0.14), shade(base, 0.12), shade(base, -0.06)]);
      const sn = snowOn(type, pal);
      if (type === Terrain.MEADOW && !sn) {
        for (let k = 0; k < Math.round(5 * pal.flowers); k++) {
          const [x, y] = P(hash01(seed, k, 7), hash01(seed, k, 8));
          ctx.fillStyle = k % 2 ? '#f4e27a' : '#f7f2e4';
          ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
        }
      } else if (type === Terrain.TREES) {
        for (let k = 0; k < Math.round(8 * (1 - sn)); k++) {
          const [x, y] = P(hash01(seed, k, 71), hash01(seed, k, 72));
          ctx.fillStyle = pal.leaves[k % pal.leaves.length];
          ctx.fillRect(x - 0.9, y - 0.5, 1.8, 1);
        }
      }
      ctx.restore();
    },
  };
}

/** Add the fringe polygon along one side (0=N 1=E 2=S 3=W) to the current path. */
function fringePath(ctx, side, depth, seed) {
  const N = 10;
  const amp = 0.3 + hash01(seed, 1) * 0.35;
  const freq = 1 + Math.floor(hash01(seed, 2) * 2);
  const ph = hash01(seed, 3) * Math.PI * 2;
  // Depth along the edge: 0.8*depth at both ends, wavier in the middle.
  const d = (s) => depth * (0.8 + amp * Math.sin(Math.PI * s) * (0.6 + 0.4 * Math.sin(s * Math.PI * 2 * freq + ph)));
  const at = (s, dd) => {
    switch (side) {
      case 0: return P(s, dd); // N edge v=0, inward +v
      case 1: return P(1 - dd, s); // E edge u=1, inward -u
      case 2: return P(s, 1 - dd); // S edge v=1, inward -v
      default: return P(dd, s); // W edge u=0, inward +u
    }
  };
  const a = at(0, 0);
  ctx.moveTo(a[0], a[1]);
  const b = at(1, 0);
  ctx.lineTo(b[0], b[1]);
  for (let k = N; k >= 0; k--) {
    const p = at(k / N, d(k / N));
    ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
}

/** Add a rounded blob in one corner (0=NE 1=SE 2=SW 3=NW) to the current path. */
function cornerPath(ctx, c, r) {
  // corner point, then the two edge directions away from it (in u, v)
  const C = [[1, 0], [1, 1], [0, 1], [0, 0]][c];
  const A = [[-1, 0], [-1, 0], [1, 0], [1, 0]][c];
  const B = [[0, 1], [0, -1], [0, -1], [0, 1]][c];
  const p0 = P(C[0], C[1]);
  const p1 = P(C[0] + A[0] * r, C[1] + A[1] * r);
  const q = P(C[0] + (A[0] + B[0]) * r * 0.85, C[1] + (A[1] + B[1]) * r * 0.85);
  const p2 = P(C[0] + B[0] * r, C[1] + B[1] * r);
  ctx.moveTo(p0[0], p0[1]);
  ctx.lineTo(p1[0], p1[1]);
  ctx.quadraticCurveTo(q[0], q[1], p2[0], p2[1]);
  ctx.closePath();
}

/** Water tile with animated ripples; frame 0..3 */
export function waterTileSpec(variant, frame) {
  return {
    w: TW + 4,
    h: TH + 3,
    ax: HALF_W + 2,
    ay: 1,
    draw(ctx) {
      const base = TERRAIN_COLORS[Terrain.WATER];
      tileDiamond(ctx, shade(base, (variant - 1.5) * 0.02));
      ctx.strokeStyle = 'rgba(210,235,250,0.55)';
      ctx.lineWidth = 0.9;
      for (let k = 0; k < 3; k++) {
        const u = (hash01(variant, k, 3) + frame * 0.07) % 1;
        const v = (hash01(variant, k, 4) + frame * 0.05) % 1;
        const [x, y] = P(u * 0.7 + 0.15, v * 0.7 + 0.15);
        const len = 3 + hash01(variant, k, 9) * 4;
        const a = Math.sin((frame + k) * 1.3) * 0.8;
        ctx.globalAlpha = 0.35 + 0.35 * Math.abs(a);
        ctx.beginPath();
        ctx.moveTo(x - len, y);
        ctx.quadraticCurveTo(x, y - 1.2, x + len, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  };
}

/**
 * Shoreline decoration on a WATER tile. mask bits: 1=N 2=E 4=S 8=W
 * (set when the neighbor on that side is land).
 */
export function shoreSpec(mask) {
  return {
    w: TW + 4,
    h: TH + 3,
    ax: HALF_W + 2,
    ay: 1,
    draw(ctx) {
      const band = 0.18;
      const shallow = 'rgba(120,180,200,0.75)';
      const foam = 'rgba(235,245,240,0.8)';
      // N edge: T(0,0)-R(1,0) ; E: R(1,0)-B(1,1) ; S: L(0,1)-B(1,1) ; W: T(0,0)-L(0,1)
      if (mask & 1) { quad(ctx, 0, 0, 1, band, 0, shallow); quad(ctx, 0, 0, 1, band * 0.3, 0, foam); }
      if (mask & 2) { quad(ctx, 1 - band, 0, 1, 1, 0, shallow); quad(ctx, 1 - band * 0.3, 0, 1, 1, 0, foam); }
      if (mask & 4) { quad(ctx, 0, 1 - band, 1, 1, 0, shallow); quad(ctx, 0, 1 - band * 0.3, 1, 1, 0, foam); }
      if (mask & 8) { quad(ctx, 0, 0, band, 1, 0, shallow); quad(ctx, 0, 0, band * 0.3, 1, 0, foam); }
    },
  };
}

const ROAD_COLOR = '#c2b08c';
const ROAD_EDGE = '#8e7b5a';

/** Road piece connecting toward neighbors in `mask` (1=N 2=E 4=S 8=W). */
export function roadSpec(mask, variant) {
  return {
    w: TW + 4,
    h: TH + 3,
    ax: HALF_W + 2,
    ay: 1,
    draw(ctx) {
      const a = 0.12;
      const b = 0.88;
      const col = shade(ROAD_COLOR, (variant - 1.5) * 0.03);
      const parts = [[a, a, b, b]];
      if (mask & 1) parts.push([a, 0, b, a]);
      if (mask & 2) parts.push([b, a, 1, b]);
      if (mask & 4) parts.push([a, b, b, 1]);
      if (mask & 8) parts.push([0, a, a, b]);
      for (const [u0, v0, u1, v1] of parts) quad(ctx, u0 - 0.01, v0 - 0.01, u1 + 0.01, v1 + 0.01, 0, col);
      // cobble texture
      for (let k = 0; k < 14; k++) {
        const u = a + hash01(variant, k, 11) * (b - a);
        const v = a + hash01(variant, k, 12) * (b - a);
        const [x, y] = P(u, v);
        ctx.fillStyle = k % 2 ? shade(col, -0.12) : shade(col, 0.1);
        ctx.fillRect(x - 1.5, y - 0.6, 3, 1.2);
      }
      // curbs on unconnected sides
      ctx.strokeStyle = ROAD_EDGE;
      ctx.lineWidth = 0.9;
      const edge = (p, q) => { ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); };
      if (!(mask & 1)) edge(P(a, a), P(b, a));
      if (!(mask & 2)) edge(P(b, a), P(b, b));
      if (!(mask & 4)) edge(P(a, b), P(b, b));
      if (!(mask & 8)) edge(P(a, a), P(a, b));
    },
  };
}

/**
 * A roadblock: a striped bar on two trestles across the road, and a post with
 * a small board by one end. axis: 'u' when the road runs along u (east-west
 * in tile terms; the bar then spans v), 'v' when it runs along v.
 */
export function roadblockSpec(axis) {
  return {
    w: TW,
    h: TH + 26,
    ax: HALF_W,
    ay: 26,
    draw(ctx) {
      // (a, b): a = along the road, b = across it; P wants (u, v).
      const Q = axis === 'u' ? (a, b, z) => P(a, b, z) : (a, b, z) => P(b, a, z);
      const wood = '#7a5634';
      const dark = shade(wood, -0.4);
      const line = (p, q, color, w) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = w;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(q[0], q[1]);
        ctx.stroke();
      };
      const b0 = 0.16;
      const b1 = 0.84;
      const mid = 0.5;
      const bar = 9; // height of the bar
      // Shadow on the road.
      poly(ctx, [Q(mid - 0.05, b0, 0), Q(mid + 0.09, b0, 0), Q(mid + 0.09, b1, 0), Q(mid - 0.05, b1, 0)], 'rgba(40,30,20,0.22)');
      // Trestles: a pair of crossed legs at each end.
      const trestle = (b) => {
        line(Q(mid - 0.1, b, 0), Q(mid + 0.02, b, bar + 1), dark, 1.6);
        line(Q(mid + 0.1, b, 0), Q(mid - 0.02, b, bar + 1), wood, 1.6);
      };
      trestle(b0 + 0.04);
      // The bar: red and cream stripes, a top face and a front face.
      const n = 6;
      for (let k = 0; k < n; k++) {
        const s0 = b0 + ((b1 - b0) * k) / n;
        const s1 = b0 + ((b1 - b0) * (k + 1)) / n;
        const col = k % 2 ? '#e8dcc0' : '#b3352a';
        poly(ctx, [Q(mid - 0.025, s0, bar + 2), Q(mid + 0.025, s0, bar + 2), Q(mid + 0.025, s1, bar + 2), Q(mid - 0.025, s1, bar + 2)], shade(col, 0.15));
        poly(ctx, [Q(mid + 0.025, s0, bar + 2), Q(mid + 0.025, s1, bar + 2), Q(mid + 0.025, s1, bar - 1), Q(mid + 0.025, s0, bar - 1)], col, shade(col, -0.45), 0.4);
      }
      trestle(b1 - 0.04);
      // A post with a board, beside the far end of the bar.
      const pb = b1 + 0.02;
      line(Q(mid - 0.12, pb, 0), Q(mid - 0.12, pb, 20), dark, 1.5);
      poly(ctx, [Q(mid - 0.12, pb - 0.1, 21), Q(mid - 0.12, pb + 0.1, 21), Q(mid - 0.12, pb + 0.1, 14), Q(mid - 0.12, pb - 0.1, 14)], '#d9c79b', dark, 0.6);
      line(Q(mid - 0.12, pb - 0.06, 18.5), Q(mid - 0.12, pb + 0.06, 18.5), '#b3352a', 0.9);
      line(Q(mid - 0.12, pb - 0.06, 16.5), Q(mid - 0.12, pb + 0.04, 16.5), '#6b5a40', 0.7);
    },
  };
}

/** Decorative paving (plaza) covering the whole tile. */
export function plazaSpec(variant) {
  return {
    w: TW + 4,
    h: TH + 3,
    ax: HALF_W + 2,
    ay: 1,
    draw(ctx) {
      tileDiamond(ctx, '#d9d0bd');
      const n = 4;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if ((i + j + variant) % 2) continue;
          quad(ctx, i / n + 0.02, j / n + 0.02, (i + 1) / n - 0.02, (j + 1) / n - 0.02, 0, '#e9e3d4');
        }
      }
      quad(ctx, 0.38, 0.38, 0.62, 0.62, 0, '#b5563d');
    },
  };
}

/**
 * Height of a ship bridge's deck over the water (px at zoom 1). A
 * merchantman's mast stands about 45 px with its pennant (and bobs a px
 * more) and a liburnian's 41: seen over a ship under the middle of a tile,
 * the deck's width and its far parapet hide 13 px more than the deck's
 * height, so both pass under it with their masts out of sight (a test
 * measures the ships' art against it). People on it stand this high
 * (bridgeProfile.js).
 */
export const BRIDGE_DECK_Z = 33;
const BR_S0 = 0.2; // the deck's two sides across the tile
export const BRIDGE_FAR_SIDE = BR_S0; // (bridgeProfile.js mastClip: the far parapet a mast must stay under)
const BR_S1 = 0.8;
const BR_PIER = 0.14; // a pier's thickness along the bridge
const BR_SPRING = 7; // where the arches spring, over the water
const BR_DECK = 5; // the deck's thickness over an arch
export const BR_PARAPET = 4;
const BR_STONE = '#b9ad94';
const BR_PAVING = '#a89a80';

/** Height at `t` (0..1 along a bridge tile) of a deck whose heights at 0, 0.5 and 1 are `h`. */
export function deckAt(h, t) {
  return t <= 0.5 ? h[0] + (h[1] - h[0]) * t * 2 : h[1] + (h[2] - h[1]) * (t - 0.5) * 2;
}

/** A band along a deck (a parapet, a beam): from `lo` to `hi` over the deck at `s`, the deck's heights `h`. */
function deckBand(at, s, h, lo, hi) {
  return [at(0, s, h[0] + lo), at(0.5, s, h[1] + lo), at(1, s, h[2] + lo), at(1, s, h[2] + hi), at(0.5, s, h[1] + hi), at(0, s, h[0] + hi)];
}

/**
 * Level courses of masonry on a wall, clipped to its outline `pts`: against
 * them the top of a ramp reads as a slope, even where a ramp climbing
 * toward the viewer runs almost flat across the screen.
 */
function courses(ctx, pts, at, s, top, color) {
  ctx.save();
  ctx.beginPath();
  pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let z = 4; z < top; z += 5) {
    const a = at(-0.1, s, z);
    const b = at(1.1, s, z);
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Light on a ramp's paving from the sun in the upper left of the screen
 * (the shadows fall to the lower right): a ramp climbing toward the front
 * of the view faces the sun and shows lighter, one going down darker.
 */
function rampLight(rise) {
  return rise > 0 ? 'rgba(255,248,230,0.16)' : 'rgba(40,30,20,0.14)';
}

/** A line through points, for parapet copings and rails. */
function strokeLine(ctx, pts, color, lw) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}

/**
 * Stone ship bridge over water, one tile of it: an arch from pier to pier
 * high enough for a ship to sail under, the paved deck on top with a
 * parapet each side. axis 'u' runs along x, 'v' along y (in the view). The
 * deck stands h0, hm, h1 px up at the tile's near edge, middle and far
 * edge (bridgeProfile.js: a ramp comes down to each bank), and the arch
 * flattens under a ramp. Each tile draws the pier at its far end (+t): the
 * pier at its near end is the previous tile's, drawn earlier, so a ship
 * under this tile (drawn just before it, renderer.js) shows in front of
 * the near pier and behind the far one, as it would. `abut`: the run's
 * first tile in the view, which draws its own support at the near end.
 * `snow` (0..1) caps the parapets and cutwaters; the deck stays clear, as
 * the roads do.
 */
export function bridgeSpec(axis, h0 = BRIDGE_DECK_Z, hm = h0, h1 = hm, abut = false, snow = 0) {
  const h = [h0, hm, h1];
  const deck = (t) => deckAt(h, t);
  const top = Math.max(h0, hm, h1);
  const stone = BR_STONE;
  const dark = shade(stone, -0.35);
  const cap = snow ? mix(shade(stone, 0.12), SNOW, 0.5 + snow * 0.5) : shade(stone, 0.12);
  // Along the bridge (t, 0..1) and across it (s, 0..1), as tile (u, v).
  const at = axis === 'u' ? (t, s, z) => P(t, s, z) : (t, s, z) => P(s, t, z);
  const tA = abut ? BR_PIER : 0; // the opening, between the supports
  const tB = 1 - BR_PIER;
  const crown = BRIDGE_DECK_Z - BR_DECK - 3;
  // A round arch from pier to pier, pressed flat where a ramp comes down over it.
  const arch = (t) => {
    const u = (t - tA) / (tB - tA);
    const round = BR_SPRING + (crown - BR_SPRING) * Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2));
    return Math.max(-2, Math.min(round, deck(t) - BR_DECK));
  };
  const N = 14;
  const curve = (s, dz = 0) => {
    const pts = [];
    for (let k = 0; k <= N; k++) {
      const t = tA + ((tB - tA) * k) / N;
      pts.push(at(t, s, arch(t) + dz));
    }
    return pts;
  };
  return {
    w: TW + 4,
    h: TH + 10 + top + BR_PARAPET + 4,
    ax: HALF_W + 2,
    ay: top + BR_PARAPET + 4,
    draw(ctx) {
      // The far pier's end, seen through the next tile's arch (or the
      // bridge's end over a bank), and the near support's inner face.
      poly(ctx, [at(1, BR_S1, -2), at(1, BR_S0, -2), at(1, BR_S0, h1), at(1, BR_S1, h1)], shade(stone, -0.28), dark, 0.5);
      if (abut) poly(ctx, [at(tA, BR_S1, -2), at(tA, BR_S0, -2), at(tA, BR_S0, deck(tA)), at(tA, BR_S1, deck(tA))], shade(stone, -0.32), dark, 0.5);
      // The front face: the deck's edge and the far pier down into the
      // water, with the arch left open (a ship under it shows through).
      const face = [at(0, BR_S1, h0), at(0.5, BR_S1, hm), at(1, BR_S1, h1), at(1, BR_S1, -2), at(tB, BR_S1, -2), ...curve(BR_S1).reverse()];
      if (abut) face.push(at(tA, BR_S1, -2), at(0, BR_S1, -2));
      poly(ctx, face, shade(stone, -0.04), dark, 0.6);
      courses(ctx, face, at, BR_S1, top, shade(stone, -0.14));
      // The cornice under the parapet, and the ring of voussoirs round the arch.
      poly(ctx, deckBand(at, BR_S1, h, -2.4, 0), shade(stone, 0.08));
      strokeLine(ctx, curve(BR_S1, 1.3), shade(stone, 0.1), 1.6);
      ctx.strokeStyle = shade(stone, -0.22);
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let k = 1; k < 6; k++) {
        const t = tA + ((tB - tA) * k) / 6;
        const a = arch(t);
        if (a < 1) continue;
        const p = at(t, BR_S1, a);
        const q = at(t, BR_S1, a + 2.6);
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(q[0], q[1]);
      }
      ctx.stroke();
      // The cutwater: a pointed stone nose on the pier, breaking the current.
      const cwH = BR_SPRING - 1;
      const tm = (tB + 1) / 2;
      const nose = BR_S1 + 0.09;
      poly(ctx, [at(tB, BR_S1, -2), at(tm, nose, -2), at(tm, nose, cwH), at(tB, BR_S1, cwH)], shade(stone, -0.02), dark, 0.5);
      poly(ctx, [at(tm, nose, -2), at(1, BR_S1, -2), at(1, BR_S1, cwH), at(tm, nose, cwH)], shade(stone, -0.18), dark, 0.5);
      poly(ctx, [at(tB, BR_S1, cwH), at(tm, nose, cwH), at(1, BR_S1, cwH), at(tm, (BR_S1 + nose) / 2, cwH + 3)], cap, dark, 0.4);
      // The deck and its paving joints.
      poly(ctx, [at(-0.02, BR_S0, h0), at(0.5, BR_S0, hm), at(1.02, BR_S0, h1), at(1.02, BR_S1, h1), at(0.5, BR_S1, hm), at(-0.02, BR_S1, h0)], BR_PAVING, shade(BR_PAVING, -0.35), 0.6);
      if (hm !== h0) poly(ctx, [at(0, BR_S0, h0), at(0.5, BR_S0, hm), at(0.5, BR_S1, hm), at(0, BR_S1, h0)], rampLight(hm - h0));
      if (h1 !== hm) poly(ctx, [at(0.5, BR_S0, hm), at(1, BR_S0, h1), at(1, BR_S1, h1), at(0.5, BR_S1, hm)], rampLight(h1 - hm));
      ctx.strokeStyle = shade(BR_PAVING, -0.18);
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let k = 1; k < 4; k++) {
        const p = at(k / 4, BR_S0, deck(k / 4));
        const q = at(k / 4, BR_S1, deck(k / 4));
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(q[0], q[1]);
      }
      ctx.stroke();
      // Parapets, the far one first, each with its coping (snow on it in winter).
      for (const s of [BR_S0, BR_S1]) {
        poly(ctx, deckBand(at, s, h, 0, BR_PARAPET), shade(stone, s > 0.5 ? -0.08 : 0.05), dark, 0.6);
        strokeLine(ctx, [at(0, s, h0 + BR_PARAPET), at(0.5, s, hm + BR_PARAPET), at(1, s, h1 + BR_PARAPET)], cap, snow ? 1.5 : 1);
      }
    },
  };
}

/**
 * The foot of a ship bridge's ramp, on the road tile at the bank: from road
 * level in the middle of the tile up to `h` px at its edge on the bridge's
 * side, between low walls, so the road visibly climbs to the deck. axis
 * 'u' or 'v' as bridgeSpec (in the view); sign +1 when the bridge lies at
 * +t from this tile, -1 at -t. The road's other half, and any road joining
 * it from the side, stays at road level.
 */
export function bridgeFootSpec(axis, sign, h, snow = 0) {
  const stone = BR_STONE;
  const dark = shade(stone, -0.35);
  const cap = snow ? mix(shade(stone, 0.12), SNOW, 0.5 + snow * 0.5) : shade(stone, 0.12);
  const at = axis === 'u' ? (t, s, z) => P(t, s, z) : (t, s, z) => P(s, t, z);
  const edge = sign > 0 ? 1 : 0;
  const rise = (t) => h * Math.max(0, Math.min(1, (t - 0.5) * sign * 2));
  const post = 0.5 + sign * 0.08; // where the walls rise out of the road
  return {
    w: TW + 4,
    h: TH + 8 + h + BR_PARAPET + 4,
    ax: HALF_W + 2,
    ay: h + BR_PARAPET + 4,
    draw(ctx) {
      const ramp = [at(0.5, BR_S0, 0), at(edge, BR_S0, h), at(edge, BR_S1, h), at(0.5, BR_S1, 0)];
      poly(ctx, ramp, BR_PAVING, shade(BR_PAVING, -0.35), 0.6);
      poly(ctx, ramp, rampLight(sign));
      ctx.strokeStyle = shade(BR_PAVING, -0.18);
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (const t of [0.5 + sign * 0.17, 0.5 + sign * 0.34]) {
        const p = at(t, BR_S0, rise(t));
        const q = at(t, BR_S1, rise(t));
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(q[0], q[1]);
      }
      ctx.stroke();
      // The near retaining wall under the ramp, then the parapets on the
      // walls, each starting at a stone post where the road begins to climb.
      const wall = [at(post, BR_S1, 0), at(edge, BR_S1, 0), at(edge, BR_S1, h), at(post, BR_S1, rise(post))];
      poly(ctx, wall, shade(stone, -0.04), dark, 0.6);
      courses(ctx, wall, at, BR_S1, h, shade(stone, -0.14));
      for (const s of [BR_S0, BR_S1]) {
        poly(ctx, [at(post, s, rise(post)), at(edge, s, h), at(edge, s, h + BR_PARAPET), at(post, s, rise(post) + BR_PARAPET)], shade(stone, s > 0.5 ? -0.08 : 0.05), dark, 0.6);
        strokeLine(ctx, [at(post, s, rise(post) + BR_PARAPET), at(edge, s, h + BR_PARAPET)], cap, snow ? 1.5 : 1);
        // The post: a squat block a little taller than the parapet.
        const [p0, p1] = sign > 0 ? [post - 0.06, post] : [post, post + 0.06];
        poly(ctx, [at(p0, s + 0.03, 0), at(p1, s + 0.03, 0), at(p1, s + 0.03, BR_PARAPET + 3), at(p0, s + 0.03, BR_PARAPET + 3)], shade(stone, -0.06), dark, 0.5);
        poly(ctx, [at(p1, s + 0.03, 0), at(p1, s - 0.03, 0), at(p1, s - 0.03, BR_PARAPET + 3), at(p1, s + 0.03, BR_PARAPET + 3)], shade(stone, -0.24), dark, 0.5);
        poly(ctx, [at(p0, s - 0.03, BR_PARAPET + 3), at(p1, s - 0.03, BR_PARAPET + 3), at(p1, s + 0.03, BR_PARAPET + 3), at(p0, s + 0.03, BR_PARAPET + 3)], cap);
      }
    },
  };
}

/** Height of a low bridge's deck over the water (px at zoom 1): people on it are lifted this much. */
export const LOW_BRIDGE_DECK_Z = 5;

/**
 * Timber low bridge on piles, just over the water: a bent of two piles with
 * a cross brace under the middle of each tile, a plank deck laid across the
 * way, and a light rail each side. Low and plain beside the stone ship
 * bridge, so the player sees at a glance which one closes the river to
 * boats. axis 'u' runs along x, 'v' along y, as bridgeSpec; h0, hm, h1 the
 * deck's height at the tile's near edge, middle and far edge (its short
 * ramps down to the banks, bridgeProfile.js).
 */
export function lowBridgeSpec(axis, h0 = LOW_BRIDGE_DECK_Z, hm = h0, h1 = hm) {
  const h = [h0, hm, h1];
  const deck = (t) => deckAt(h, t);
  const z = Math.max(h0, hm, h1);
  const wood = '#8d6b45';
  const dark = shade(wood, -0.45);
  const plank = '#a07c52';
  const at = axis === 'u' ? (t, s, zz) => P(t, s, zz) : (t, s, zz) => P(s, t, zz);
  const line = (ctx, a, b, color, lw) => strokeLine(ctx, [a, b], color, lw);
  return {
    w: TW + 4,
    h: TH + 8 + z + 10,
    ax: HALF_W + 2,
    ay: z + 10,
    draw(ctx) {
      // The bent: back pile, brace, front pile (back to front).
      const pile = (s0) => {
        poly(ctx, [at(0.45, s0, -3), at(0.55, s0, -3), at(0.55, s0, hm), at(0.45, s0, hm)], shade(wood, -0.15), dark, 0.5);
      };
      pile(0.24);
      if (hm > 2) line(ctx, at(0.5, 0.24, hm - 1), at(0.5, 0.76, -1), shade(wood, -0.25), 1.2);
      pile(0.76);
      // The deck, its planks across the way, and its front beam.
      poly(ctx, [at(-0.02, 0.2, h0), at(0.5, 0.2, hm), at(1.02, 0.2, h1), at(1.02, 0.8, h1), at(0.5, 0.8, hm), at(-0.02, 0.8, h0)], plank, dark, 0.6);
      for (let k = 1; k < 8; k++) line(ctx, at(k / 8, 0.2, deck(k / 8)), at(k / 8, 0.8, deck(k / 8)), shade(plank, -0.22), 0.5);
      poly(ctx, deckBand(at, 0.8, h, -2, 0), shade(wood, -0.1), dark, 0.5);
      // Rails: posts and a top bar each side.
      for (const s0 of [0.2, 0.8]) {
        for (const t of [0.1, 0.5, 0.9]) line(ctx, at(t, s0, deck(t)), at(t, s0, deck(t) + 4), dark, 0.9);
        strokeLine(ctx, [at(0, s0, h0 + 4), at(0.5, s0, hm + 4), at(1, s0, h1 + 4)], shade(wood, s0 > 0.5 ? -0.1 : 0.08), 1.1);
      }
    },
  };
}

/** Rubble decal: scattered stones and soot. */
export function rubbleSpec(variant) {
  return {
    w: TW + 4,
    h: TH + 8,
    ax: HALF_W + 2,
    ay: 6,
    draw(ctx) {
      quad(ctx, 0.1, 0.1, 0.9, 0.9, 0, 'rgba(60,50,40,0.35)');
      for (let k = 0; k < 11; k++) {
        const u = 0.15 + hash01(variant, k, 21) * 0.7;
        const v = 0.15 + hash01(variant, k, 22) * 0.7;
        const [x, y] = P(u, v);
        const s = 1.5 + hash01(variant, k, 23) * 2.5;
        ctx.fillStyle = k % 3 === 0 ? '#8a8173' : k % 3 === 1 ? '#a89c86' : '#5f564a';
        ctx.beginPath();
        ctx.moveTo(x - s, y);
        ctx.lineTo(x - s * 0.3, y - s * 0.9);
        ctx.lineTo(x + s, y - s * 0.4);
        ctx.lineTo(x + s * 0.6, y + s * 0.3);
        ctx.closePath();
        ctx.fill();
      }
    },
  };
}

/** 1-3 trees on a tile (object sprite, extends upward). */
/**
 * Trees on a forest tile. `sway` (-2..2) is the wind frame: the renderer
 * cycles through these cached frames with a phase that rolls across the map,
 * so forests ripple in gusts without redrawing any art per frame.
 */
export function treesSpec(variant, sway = 0, pal = seasonPalette(null)) {
  return {
    w: TW + 8,
    h: TH + 34,
    ax: HALF_W + 4,
    ay: 34,
    draw(ctx) {
      const n = 1 + (variant % 3);
      const spots = [
        [0.35, 0.3],
        [0.7, 0.55],
        [0.3, 0.72],
      ];
      const drawList = spots.slice(0, n).sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
      drawList.forEach(([u, v], k) => {
        const size = 0.75 + hash01(variant, k, 31) * 0.4;
        // Neighbouring trees on a tile do not move in perfect lockstep.
        const s = sway * (0.8 + hash01(variant, k, 33) * 0.4);
        const leaves = pal.leaves[(variant + k) % pal.leaves.length];
        if (hash01(variant, k, 32) < 0.28) cypress(ctx, u, v, size, '#2f5a2a', s, pal.snow); // evergreen
        else if (hash01(variant, k, 34) < pal.bare) bareTree(ctx, u, v, size, variant + k, s, leaves, pal.snow);
        else tree(ctx, u, v, size, leaves, '#6b4a2a', variant + k, s, !pal.snow && hash01(variant, k, 35) < pal.blossom ? 1 : 0, pal.snow); // no blossom under snow
      });
    },
  };
}

/** Boulders on a rock tile. */
export function rocksSpec(variant, snow = 0) {
  return {
    w: TW,
    h: TH + 20,
    ax: HALF_W,
    ay: 20,
    draw(ctx) {
      const n = 2 + (variant % 3);
      const stones = [];
      for (let k = 0; k < n; k++) stones.push([0.2 + hash01(variant, k, 41) * 0.6, 0.2 + hash01(variant, k, 42) * 0.6, 5 + hash01(variant, k, 43) * 7]);
      stones.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
      for (const [u, v, s] of stones) {
        const [x, y] = P(u, v);
        const h = s * 1.1;
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath();
        ctx.ellipse(x + 2, y + 1, s * 1.1, s * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        poly(ctx, [[x - s, y], [x - s * 0.7, y - h * 0.8], [x + s * 0.1, y - h], [x + s, y - h * 0.5], [x + s * 0.8, y + 1]], '#8d8577', '#5d564b', 0.8);
        poly(ctx, [[x - s * 0.7, y - h * 0.8], [x + s * 0.1, y - h], [x + s * 0.2, y - h * 0.4], [x - s * 0.5, y - h * 0.3]], snow ? mix('#b0a898', SNOW, 0.5 + snow * 0.5) : '#b0a898');
      }
    },
  };
}

/** Height of a reservoir's rim (reservoirArt): an aqueduct steps down to it. */
const RESERVOIR_RIM = 12;

/**
 * Aqueduct segment. mask bits 1=N 2=E 4=S 8=W: connections; the same bits
 * shifted up 4 (16=N ... 128=W) mark the ones that are a reservoir, where the
 * channel ramps down to the reservoir's rim and pours in. filled: water in
 * the channel. overRoad: a straight aqueduct crossing a road is a bridge, a
 * pier each side and one wide arch the road passes under.
 */
export function aqueductSpec(mask, filled, overRoad = false) {
  return {
    w: TW,
    h: TH + 30,
    ax: HALF_W,
    ay: 30,
    draw(ctx) {
      const H = 20;
      const t = 0.14; // half thickness
      const stone = '#bdb3a0';
      const water = filled ? '#4b95cf' : '#8a7e6a';
      const conn = mask & 15;
      const res = (mask >> 4) & 15;
      if (overRoad && !res && (conn === 10 || conn === 5)) {
        aqueductBridge(ctx, conn === 10 ? 'u' : 'v', H, t, stone, water);
        return;
      }
      const seg = (u0, v0, u1, v1) => {
        const du = u1 - u0;
        const dv = v1 - v0;
        const along = Math.abs(du) > Math.abs(dv) ? 'u' : 'v';
        const a = Math.min(u0, u1);
        const b = Math.min(v0, v1);
        if (along === 'u') {
          // wall along u, thickness in v
          boxWithArch(ctx, a, 0.5 - t, Math.abs(du), t * 2, H, stone, 'u');
          quad(ctx, a, 0.5 - t * 0.6, a + Math.abs(du), 0.5 + t * 0.6, H + 0.5, water);
        } else {
          boxWithArch(ctx, 0.5 - t, b, t * 2, Math.abs(dv), H, stone, 'v');
          quad(ctx, 0.5 - t * 0.6, b, 0.5 + t * 0.6, b + Math.abs(dv), H + 0.5, water);
        }
      };
      // Into a reservoir: the wall slopes from the pier's height down to the
      // rim (reaching a little past the tile edge, where the rim is), the
      // channel with it.
      const ramp = (dir) => {
        const reach = 0.12;
        const [u0, v0, u1, v1] = {
          1: [0.5 - t, -reach, 0.5 + t, 0.5 - t],
          2: [0.5 + t, 0.5 - t, 1 + reach, 0.5 + t],
          4: [0.5 - t, 0.5 + t, 0.5 + t, 1 + reach],
          8: [-reach, 0.5 - t, 0.5 - t, 0.5 + t],
        }[dir];
        // Height: H at the pier, the rim at the far end.
        const z = (u, v) => {
          const f = dir === 2 ? (u - u0) / (u1 - u0) : dir === 8 ? (u1 - u) / (u1 - u0) : dir === 4 ? (v - v0) / (v1 - v0) : (v1 - v) / (v1 - v0);
          return H + (RESERVOIR_RIM - H) * f;
        };
        slopedWall(ctx, u0, v0, u1, v1, z, stone);
        const w = t * 0.6;
        const [cu0, cv0, cu1, cv1] = dir === 2 || dir === 8 ? [u0, 0.5 - w, u1, 0.5 + w] : [0.5 - w, v0, 0.5 + w, v1];
        poly(ctx, [P(cu0, cv0, z(cu0, cv0) + 0.5), P(cu1, cv0, z(cu1, cv0) + 0.5), P(cu1, cv1, z(cu1, cv1) + 0.5), P(cu0, cv1, z(cu0, cv1) + 0.5)], water);
      };
      const part = (dir, u0, v0, u1, v1) => {
        if (!(conn & dir)) return;
        if (res & dir) ramp(dir);
        else seg(u0, v0, u1, v1);
      };
      // back segments first (N, W), then pier, then front (E, S)
      part(1, 0.5, 0, 0.5, 0.5 - t);
      part(8, 0, 0.5, 0.5 - t, 0.5);
      boxWithArch(ctx, 0.5 - t, 0.5 - t, t * 2, t * 2, H, shade(stone, -0.05), null);
      quad(ctx, 0.5 - t * 0.6, 0.5 - t * 0.6, 0.5 + t * 0.6, 0.5 + t * 0.6, H + 0.5, water);
      part(2, 0.5 + t, 0.5, 1, 0.5);
      part(4, 0.5, 0.5 + t, 0.5, 1);
      if (!conn) {
        // lonely pier: draw a short cross so it reads as aqueduct
        seg(0.1, 0.5, 0.5 - t, 0.5);
        seg(0.5 + t, 0.5, 0.9, 0.5);
      }
    },
  };
}

/**
 * A wall whose height varies along it: footprint u0..u1 x v0..v1, height
 * z(u, v) at each corner; the two visible faces and the top.
 */
function slopedWall(ctx, u0, v0, u1, v1, z, color) {
  const st = shade(color, -0.45);
  poly(ctx, [P(u0, v1, 0), P(u1, v1, 0), P(u1, v1, z(u1, v1)), P(u0, v1, z(u0, v1))], color, st, 0.5);
  poly(ctx, [P(u1, v0, 0), P(u1, v1, 0), P(u1, v1, z(u1, v1)), P(u1, v0, z(u1, v0))], shade(color, -0.2), st, 0.5);
  poly(ctx, [P(u0, v0, z(u0, v0)), P(u1, v0, z(u1, v0)), P(u1, v1, z(u1, v1)), P(u0, v1, z(u0, v1))], shade(color, 0.15), st, 0.5);
}

/**
 * An aqueduct carried over a road: a pier at each side of the tile and one
 * wide arch between them, so the road shows through underneath.
 * along: 'u' (the aqueduct runs east-west) or 'v' (north-south).
 */
function aqueductBridge(ctx, along, H, t, stone, water) {
  const pier = 0.14;
  const spring = H - 9; // where the arch springs from the piers
  const st = shade(stone, -0.45);
  const w = t * 0.6;
  if (along === 'u') {
    const v0 = 0.5 - t;
    const v1 = 0.5 + t;
    boxWithArch(ctx, 0, v0, pier, t * 2, H, shade(stone, -0.05), null);
    // the span: its face follows the arch below and the channel above
    const face = [P(pier, v1, H), P(1 - pier, v1, H), P(1 - pier, v1, spring)];
    for (let k = 1; k < 12; k++) {
      const f = k / 12;
      face.push(P(1 - pier - (1 - 2 * pier) * f, v1, spring + 6 * Math.sin(Math.PI * f)));
    }
    face.push(P(pier, v1, spring));
    poly(ctx, face, stone, st, 0.5);
    poly(ctx, [P(pier, v0, H), P(1 - pier, v0, H), P(1 - pier, v1, H), P(pier, v1, H)], shade(stone, 0.15), st, 0.5);
    quad(ctx, pier, 0.5 - w, 1 - pier, 0.5 + w, H + 0.5, water);
    boxWithArch(ctx, 1 - pier, v0, pier, t * 2, H, shade(stone, -0.05), null);
    quad(ctx, 0, 0.5 - w, pier, 0.5 + w, H + 0.5, water);
    quad(ctx, 1 - pier, 0.5 - w, 1, 0.5 + w, H + 0.5, water);
  } else {
    const u0 = 0.5 - t;
    const u1 = 0.5 + t;
    boxWithArch(ctx, u0, 0, t * 2, pier, H, shade(stone, -0.05), null);
    const face = [P(u1, pier, H), P(u1, 1 - pier, H), P(u1, 1 - pier, spring)];
    for (let k = 1; k < 12; k++) {
      const f = k / 12;
      face.push(P(u1, 1 - pier - (1 - 2 * pier) * f, spring + 6 * Math.sin(Math.PI * f)));
    }
    face.push(P(u1, pier, spring));
    poly(ctx, face, shade(stone, -0.2), st, 0.5);
    poly(ctx, [P(u0, pier, H), P(u1, pier, H), P(u1, 1 - pier, H), P(u0, 1 - pier, H)], shade(stone, 0.15), st, 0.5);
    quad(ctx, 0.5 - w, pier, 0.5 + w, 1 - pier, H + 0.5, water);
    boxWithArch(ctx, u0, 1 - pier, t * 2, pier, H, shade(stone, -0.05), null);
    quad(ctx, 0.5 - w, 0, 0.5 + w, pier, H + 0.5, water);
    quad(ctx, 0.5 - w, 1 - pier, 0.5 + w, 1, H + 0.5, water);
  }
}

/** Box with a dark arch opening on its visible long face. */
function boxWithArch(ctx, u0, v0, du, dv, h, color, along) {
  const u1 = u0 + du;
  const v1 = v0 + dv;
  const st = shade(color, -0.45);
  poly(ctx, [P(u0, v1, 0), P(u1, v1, 0), P(u1, v1, h), P(u0, v1, h)], color, st, 0.5);
  poly(ctx, [P(u1, v0, 0), P(u1, v1, 0), P(u1, v1, h), P(u1, v0, h)], shade(color, -0.2), st, 0.5);
  poly(ctx, [P(u0, v0, h), P(u1, v0, h), P(u1, v1, h), P(u0, v1, h)], shade(color, 0.15), st, 0.5);
  if (along === 'u' && du > 0.2) {
    const um = (u0 + u1) / 2;
    const w = du * 0.32;
    archShape(ctx, P(um - w, v1, 0), P(um + w, v1, 0), h * 0.62);
  } else if (along === 'v' && dv > 0.2) {
    const vm = (v0 + v1) / 2;
    const w = dv * 0.32;
    archShape(ctx, P(u1, vm - w, 0), P(u1, vm + w, 0), h * 0.62);
  }
}

function archShape(ctx, p, q, h) {
  ctx.fillStyle = 'rgba(40,32,24,0.75)';
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  ctx.lineTo(p[0], p[1] - h * 0.6);
  ctx.quadraticCurveTo((p[0] + q[0]) / 2, (p[1] + q[1]) / 2 - h * 1.25, q[0], q[1] - h * 0.6);
  ctx.lineTo(q[0], q[1]);
  ctx.closePath();
  ctx.fill();
}

/** Minimap colors per terrain type. */
export const MINIMAP_TERRAIN = {
  [Terrain.GRASS]: [126, 163, 77],
  [Terrain.MEADOW]: [175, 176, 88],
  [Terrain.TREES]: [62, 110, 50],
  [Terrain.ROCK]: [140, 132, 118],
  [Terrain.WATER]: [58, 119, 168],
  [Terrain.SAND]: [216, 195, 142],
};

export { mix };

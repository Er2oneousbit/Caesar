/**
 * terrainArt.js
 * ----------------------------------------------------------------------------
 * Procedural art for ground tiles (grass, meadow, sand, water, roads, plazas,
 * bridges, rubble) and small terrain objects (trees, rocks, aqueducts).
 * All original drawings made from simple shapes.
 *
 * Tile sprites: 64x32 diamond, anchor at the top corner. Each terrain type
 * has 4 variants so large fields do not look tiled.
 * ----------------------------------------------------------------------------
 */

import { HALF_W, HALF_H, CONFIG } from '../config.js';
import { Terrain } from '../world/map.js';
import { P, poly, quad, shade, mix, tree, cypress, hash01 } from './draw.js';

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

/** Spec for a plain ground tile. */
export function groundTileSpec(type, variant) {
  return {
    w: TW + 4,
    h: TH + 3,
    ax: HALF_W + 2,
    ay: 1,
    draw(ctx) {
      const base = TERRAIN_COLORS[type];
      const tint = (variant - 1.5) * 0.025;
      if (type === Terrain.WATER) {
        tileDiamond(ctx, base);
        return;
      }
      tileDiamond(ctx, shade(base, tint));
      const seed = type * 97 + variant * 13;
      if (type === Terrain.GRASS || type === Terrain.TREES) {
        speckle(ctx, seed, 26, [shade(base, -0.14), shade(base, 0.12), shade(base, -0.06)]);
        // a few grass tufts
        ctx.strokeStyle = shade(base, -0.22);
        ctx.lineWidth = 0.7;
        for (let k = 0; k < 5; k++) {
          const [x, y] = P(hash01(seed, k, 5) * 0.8 + 0.1, hash01(seed, k, 6) * 0.8 + 0.1);
          ctx.beginPath();
          ctx.moveTo(x - 1.5, y);
          ctx.lineTo(x - 0.5, y - 2.5);
          ctx.moveTo(x + 1.2, y);
          ctx.lineTo(x + 0.6, y - 2.2);
          ctx.stroke();
        }
      } else if (type === Terrain.MEADOW) {
        speckle(ctx, seed, 22, [shade(base, -0.12), shade(base, 0.1)]);
        // little flowers
        for (let k = 0; k < 7; k++) {
          const [x, y] = P(hash01(seed, k, 7) * 0.8 + 0.1, hash01(seed, k, 8) * 0.8 + 0.1);
          ctx.fillStyle = k % 3 === 0 ? '#f4e27a' : k % 3 === 1 ? '#f7f2e4' : '#d9a3c7';
          ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
        }
      } else if (type === Terrain.SAND) {
        speckle(ctx, seed, 28, [shade(base, -0.1), shade(base, 0.08), shade(base, -0.18)], 1.1);
      } else if (type === Terrain.ROCK) {
        speckle(ctx, seed, 30, [shade(base, -0.15), shade(base, 0.1)]);
      }
    },
  };
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

/** Bridge deck over water. axis 'u' runs along x, 'v' along y. */
export function bridgeSpec(axis) {
  return {
    w: TW + 4,
    h: TH + 16,
    ax: HALF_W + 2,
    ay: 12,
    draw(ctx) {
      const z = 6;
      const deck = '#9a6a3c';
      const rail = '#6b4526';
      if (axis === 'u') {
        // posts in the water
        for (const u of [0.2, 0.8]) {
          const [x, y] = P(u, 0.5, 0);
          ctx.fillStyle = '#5a3c22';
          ctx.fillRect(x - 1.5, y - z, 3, z + 2);
        }
        quad(ctx, -0.02, 0.18, 1.02, 0.82, z, deck, shade(deck, -0.4));
        for (let k = 1; k < 8; k++) {
          const p = P(k / 8, 0.18, z);
          const q = P(k / 8, 0.82, z);
          ctx.strokeStyle = shade(deck, -0.2);
          ctx.lineWidth = 0.6;
          ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
        }
        poly(ctx, [P(0, 0.2, z), P(1, 0.2, z), P(1, 0.2, z + 4), P(0, 0.2, z + 4)], null, rail, 1);
        poly(ctx, [P(0, 0.8, z), P(1, 0.8, z), P(1, 0.8, z + 4), P(0, 0.8, z + 4)], null, rail, 1);
      } else {
        for (const v of [0.2, 0.8]) {
          const [x, y] = P(0.5, v, 0);
          ctx.fillStyle = '#5a3c22';
          ctx.fillRect(x - 1.5, y - z, 3, z + 2);
        }
        quad(ctx, 0.18, -0.02, 0.82, 1.02, z, deck, shade(deck, -0.4));
        for (let k = 1; k < 8; k++) {
          const p = P(0.18, k / 8, z);
          const q = P(0.82, k / 8, z);
          ctx.strokeStyle = shade(deck, -0.2);
          ctx.lineWidth = 0.6;
          ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
        }
        poly(ctx, [P(0.2, 0, z), P(0.2, 1, z), P(0.2, 1, z + 4), P(0.2, 0, z + 4)], null, rail, 1);
        poly(ctx, [P(0.8, 0, z), P(0.8, 1, z), P(0.8, 1, z + 4), P(0.8, 0, z + 4)], null, rail, 1);
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
export function treesSpec(variant) {
  return {
    w: TW,
    h: TH + 34,
    ax: HALF_W,
    ay: 34,
    draw(ctx) {
      const n = 1 + (variant % 3);
      const spots = [
        [0.35, 0.3],
        [0.7, 0.55],
        [0.3, 0.72],
      ];
      const greens = ['#3e7a34', '#4b8a3a', '#356b2e', '#58914a'];
      const drawList = spots.slice(0, n).sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
      drawList.forEach(([u, v], k) => {
        const size = 0.75 + hash01(variant, k, 31) * 0.4;
        if (hash01(variant, k, 32) < 0.28) cypress(ctx, u, v, size, '#2f5a2a');
        else tree(ctx, u, v, size, greens[(variant + k) % greens.length], '#6b4a2a', variant + k);
      });
    },
  };
}

/** Boulders on a rock tile. */
export function rocksSpec(variant) {
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
        poly(ctx, [[x - s * 0.7, y - h * 0.8], [x + s * 0.1, y - h], [x + s * 0.2, y - h * 0.4], [x - s * 0.5, y - h * 0.3]], '#b0a898');
      }
    },
  };
}

/**
 * Aqueduct segment. mask bits 1=N 2=E 4=S 8=W (connections).
 * filled: water in the channel.
 */
export function aqueductSpec(mask, filled) {
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
      // back segments first (N, W), then pier, then front (E, S)
      if (mask & 1) seg(0.5, 0, 0.5, 0.5 - t);
      if (mask & 8) seg(0, 0.5, 0.5 - t, 0.5);
      boxWithArch(ctx, 0.5 - t, 0.5 - t, t * 2, t * 2, H, shade(stone, -0.05), null);
      quad(ctx, 0.5 - t * 0.6, 0.5 - t * 0.6, 0.5 + t * 0.6, 0.5 + t * 0.6, H + 0.5, water);
      if (mask & 2) seg(0.5 + t, 0.5, 1, 0.5);
      if (mask & 4) seg(0.5, 0.5 + t, 0.5, 1);
      if (!mask) {
        // lonely pier: draw a short cross so it reads as aqueduct
        seg(0.1, 0.5, 0.5 - t, 0.5);
        seg(0.5 + t, 0.5, 0.9, 0.5);
      }
    },
  };
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

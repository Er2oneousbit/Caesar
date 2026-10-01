/**
 * icons.js
 * ----------------------------------------------------------------------------
 * Small preview icons for the build menu, drawn with the same procedural art
 * as the game world (so icons always match what you will build). The art is
 * rendered once, cropped to its visible pixels, then scaled to fit the icon.
 * ----------------------------------------------------------------------------
 */

import { HALF_W, HALF_H } from '../config.js';
import { BUILDINGS } from '../data/buildings.js';
import { buildingSpec } from '../render/buildingArt.js';
import { roadSpec, plazaSpec, aqueductSpec, bridgeSpec, waterTileSpec, groundTileSpec, roadblockSpec } from '../render/terrainArt.js';
import { Terrain } from '../world/map.js';
import { wallSpec } from '../render/militaryArt.js';

const cache = new Map();
const ART_SCALE = 2; // render the source art at 2x for crisp downscaling

function specsFor(key) {
  switch (key) {
    case 'road': return [groundTileSpec(Terrain.GRASS, 1), roadSpec(2 | 8, 1)];
    case 'plaza': return [plazaSpec(0)];
    case 'aqueduct': return [groundTileSpec(Terrain.GRASS, 1), aqueductSpec(2 | 8, true)];
    case 'bridge': return [waterTileSpec(0, 0), bridgeSpec('u')];
    case 'roadblock': return [groundTileSpec(Terrain.GRASS, 1), roadSpec(2 | 8, 1), roadblockSpec('u')];
    case 'wall': return [groundTileSpec(Terrain.GRASS, 1), wallSpec(2 | 8, false, false)];
    case 'clear': return null;
    case 'house': return [buildingSpec('house', 1, 1, 4)];
    // Waterside buildings with their water edge to the lower right; the yard with a hull on its slip.
    case 'shipyard': return [buildingSpec('shipyard', 2, 0, 1 + 4 * 2)];
    case 'wharf': return [buildingSpec('wharf', 2, 0, 1 + 4)];
    case 'navalia': return [buildingSpec('navalia', 3, 0, 1 + 4 * 2)];
    case 'naval_station': return [buildingSpec('naval_station', 3, 0, 1)];
    case 'portus': return [buildingSpec('portus', 3, 0, 1)];
    case 'hippodrome': {
      // All three sections, each a tile-row of 5 further along x.
      const parts = [0, 1, 2].map((s) => buildingSpec(s ? 'hippodrome_part' : 'hippodrome', 5, 0, s));
      const dx = 5 * HALF_W;
      const dy = 5 * HALF_H;
      return [{ ...parts[0], w: parts[0].w + 2 * dx, h: parts[0].h + 2 * dy, draw(ctx) {
        parts.forEach((p, s) => { ctx.save(); ctx.translate(s * dx, s * dy); p.draw(ctx); ctx.restore(); });
      } }];
    }
    default: {
      const def = BUILDINGS[key];
      if (!def) return null;
      const state = def.kind === 'farm' ? 4 : def.kind === 'reservoir' || def.kind === 'fountain' || def.needsPiped ? 1 : 0;
      return [buildingSpec(key, def.size, 0, state)];
    }
  }
}

/** Render layered specs (sharing one anchor) into a canvas and crop to content. */
function renderCropped(specs) {
  const ax = Math.max(...specs.map((s) => s.ax));
  const ay = Math.max(...specs.map((s) => s.ay));
  const w = Math.max(...specs.map((s) => s.w - s.ax)) + ax;
  const h = Math.max(...specs.map((s) => s.h - s.ay)) + ay;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * ART_SCALE);
  c.height = Math.ceil(h * ART_SCALE);
  const ctx = c.getContext('2d');
  for (const spec of specs) {
    ctx.setTransform(ART_SCALE, 0, 0, ART_SCALE, ax * ART_SCALE, ay * ART_SCALE);
    try { spec.draw(ctx); } catch { /* icons are decorative */ }
  }
  // Find the bounding box of visible pixels.
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width;
  let y0 = c.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (data[(y * c.width + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { canvas: c, sx: 0, sy: 0, sw: c.width, sh: c.height };
  return { canvas: c, sx: x0, sy: y0, sw: x1 - x0 + 1, sh: y1 - y0 + 1 };
}

/**
 * Get a canvas icon for a building/tool key. Returns a fresh canvas each call
 * (DOM nodes cannot be shared) copied from a cached master.
 */
export function iconCanvas(key, cssW = 44, cssH = 34) {
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const W = Math.round(cssW * dpr);
  const H = Math.round(cssH * dpr);
  const ck = `${key}:${W}x${H}`;
  let master = cache.get(ck);
  if (!master) {
    master = document.createElement('canvas');
    master.width = W;
    master.height = H;
    const ctx = master.getContext('2d');
    const specs = specsFor(key);
    if (!specs) {
      ctx.font = `${Math.round(H * 0.6)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(key === 'clear' ? '⛏' : '?', W / 2, H / 2);
    } else {
      const src = renderCropped(specs);
      const pad = 1;
      const s = Math.min((W - pad * 2) / src.sw, (H - pad * 2) / src.sh);
      const dw = src.sw * s;
      const dh = src.sh * s;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src.canvas, src.sx, src.sy, src.sw, src.sh, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }
    cache.set(ck, master);
  }
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.style.width = `${cssW}px`;
  c.style.height = `${cssH}px`;
  c.getContext('2d').drawImage(master, 0, 0);
  return c;
}

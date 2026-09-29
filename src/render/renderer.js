/**
 * renderer.js
 * ----------------------------------------------------------------------------
 * Draws the city every frame.
 *
 * Passes:
 *   1. Ground: terrain tiles, shorelines, roads, plazas, bridges, rubble and
 *      overlay tints. Flat things never overlap each other, so order is free.
 *   2. Objects: trees, rocks, aqueducts, walls, buildings, walkers, soldiers,
 *      raiders, missiles, rally flags, flames, overlay columns. Sorted
 *      back-to-front by "depth" (x + y of their front point).
 *
 * Multi-tile buildings are drawn as vertical strips half a tile wide. Each
 * strip is sorted by the front-most footprint tile it covers. This is the
 * classic trick that lets walkers pass correctly in front of and behind
 * big buildings with a simple depth sort.
 *
 *   3. Tool previews (ghost building, green/red tiles), hover and selection.
 *      Water buildings show their supply area: the one being placed or the
 *      one clicked in dark blue, existing coverage of that kind in pale blue.
 *   4. Particles (dust, smoke).
 *
 * Life in the picture (all visual only): buildings cast soft shadows to the
 * lower right, new buildings rise out of a puff of dust, forests sway in
 * gusts that roll across the map, water glints, fountains spray, fires glow
 * and throw embers, and (ambient.js) cloud shadows drift over the city while
 * birds fly past. `ambientOn` / `motionOn` switch the optional parts off
 * (Settings, or the system's reduced-motion preference).
 * ----------------------------------------------------------------------------
 */

import { CONFIG, HALF_W, HALF_H } from '../config.js';
import { Terrain, Road, WaterBits } from '../world/map.js';
import { BUILDINGS } from '../data/buildings.js';
import { UNIT_TYPES } from '../data/units.js';
import { wallHpOf, TOWER_RANGE } from '../sim/military.js';
import { wallSpec, drawUnit, drawProjectile, drawRallyFlag } from './militaryArt.js';
import { Camera, tileOfWorld } from './camera.js';
import { SpriteCache } from './sprites.js';
import { groundTileSpec, waterTileSpec, shoreSpec, roadSpec, plazaSpec, bridgeSpec, rubbleSpec, treesSpec, rocksSpec, aqueductSpec } from './terrainArt.js';
import { buildingSpec, artState, drawWarehouseStock, drawGranaryStock, shadowLength } from './buildingArt.js';
import { drawWalker } from './walkerArt.js';
import { Effects, drawFlames, drawSpray, drawGlint } from './effects.js';
import { Ambient } from './ambient.js';
import { overlayByKey, columnColor } from './overlays.js';

const K_STRIP = 0;
const K_WALKER = 1;
const K_FIRE = 2;
const K_COLUMN = 3;
const K_EXTRA = 4;
const K_UNIT = 5;
const K_PROJ = 6;
const K_FLAG = 7;

/**
 * Water buildings that supply an area: every tile within `r` of the footprint
 * (a square, exactly what sim/water.js marks), and the water-layer bit that
 * shows where buildings of that kind supply water right now.
 */
const WATER_AREA = Object.freeze({
  well: { r: CONFIG.WELL_RADIUS, bit: WaterBits.WELL },
  fountain: { r: CONFIG.FOUNTAIN_RADIUS, bit: WaterBits.FOUNTAIN },
  reservoir: { r: CONFIG.RESERVOIR_RADIUS, bit: WaterBits.PIPED },
});
/** Radius colors: the building being placed or selected (dark) vs. existing coverage (pale). */
const RADIUS_STRONG = Object.freeze({ fill: 'rgba(28,96,214,0.36)', edge: 'rgba(16,64,170,0.95)' });
const RADIUS_PALE = Object.freeze({ fill: 'rgba(150,208,255,0.28)', edge: 'rgba(120,186,250,0.8)' });

export class Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.camera = new Camera();
    this.sprites = new SpriteCache();
    this.effects = new Effects();
    this.game = null;
    this.overlay = overlayByKey('none');
    this.hoverTile = null; // {x, y}
    this.plan = null; // construction preview from the input tool
    this.tool = null;
    this.selectedId = 0;
    this.deployFort = 0; // fort id while the player picks a deployment tile
    this.time = 0;
    this.frame = 0;
    this.stats = { tiles: 0, objects: 0, ms: 0, coverage: null };
    this.viewTiles = null; // visible tile range of the last frame {tx0, tx1, ty0, ty1}
    this.stripCache = new WeakMap();
    this.unsub = [];
    this.ambient = new Ambient();
    this.ambientOn = true; // clouds and birds (Settings: ambient effects)
    this.motionOn = true; // swaying trees, glints, construction animation (off with reduced motion)
    this.appear = new Map(); // building id -> time it was placed (rise-in animation)
    this.puffBudget = 0; // dust puffs allowed this frame (a demo city appears all at once)
  }

  /** Point the renderer at a (new) game. */
  attach(game) {
    for (const u of this.unsub) u();
    this.unsub = [];
    this.game = game;
    this.camera.setMapBounds(game.map.w, game.map.h);
    this.stripCache = new WeakMap();
    this.effects = new Effects();
    this.ambient.reset(game.map.w, game.map.h);
    this.appear.clear();
    this.unsub.push(game.events.on('buildingAdded', (b) => {
      if (!this.motionOn) return;
      this.appear.set(b.id, this.time);
      if (this.puffBudget > 0) {
        this.puffBudget--;
        const cx = b.x + b.size / 2;
        const cy = b.y + b.size / 2;
        this.effects.dust((cx - cy) * HALF_W, (cx + cy) * HALF_H, Math.min(1, b.size * 0.35));
      }
    }));
    this.unsub.push(game.events.on('collapse', ({ x, y, size }) => {
      const cx = x + size / 2;
      const cy = y + size / 2;
      this.effects.dust((cx - cy) * HALF_W, (cx + cy) * HALF_H, size);
    }));
    this.unsub.push(game.events.on('unitDied', ({ x, y }) => {
      this.effects.dust((x - y) * HALF_W, (x + y) * HALF_H, 0.3);
    }));
  }

  resize(cssW, cssH, dpr) {
    const oldDpr = this.camera.dpr;
    this.camera.resize(cssW, cssH, dpr);
    this.canvas.width = this.camera.viewW;
    this.canvas.height = this.camera.viewH;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    if (oldDpr !== this.camera.dpr) this.sprites.clear();
  }

  setOverlay(key) { this.overlay = overlayByKey(key); }

  /** Screen-space depth strips for a building (cached until it moves/grows). */
  stripsFor(b) {
    const sig = `${b.x},${b.y},${b.size}`;
    const hit = this.stripCache.get(b);
    if (hit && hit.sig === sig) return hit.depths;
    const S = b.size;
    const depths = new Array(2 * S);
    for (let j = 0; j < 2 * S; j++) {
      const m = b.x - b.y - S + j;
      let best = -Infinity;
      for (let dy = 0; dy < S; dy++) {
        for (let dx = 0; dx < S; dx++) {
          const x = b.x + dx;
          const y = b.y + dy;
          const k = x - y;
          if (k === m || k === m + 1) best = Math.max(best, x + y + 1);
        }
      }
      depths[j] = best;
    }
    this.stripCache.set(b, { sig, depths });
    return depths;
  }

  /**
   * Render one frame.
   * @param {number} alpha  0..1 progress toward the next sim tick (smooth walkers)
   * @param {number} dt     seconds since the last frame
   */
  render(alpha, dt) {
    const t0 = performance.now();
    this.time += dt;
    this.frame++;
    const { ctx, camera: cam, game } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#2a241c';
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);
    if (!game) return;
    const k = cam.scale;
    this.sprites.setScale(k);
    const { map } = game;
    const ov = this.overlay;
    const overlayOn = ov.key !== 'none';

    // --- visible tile range -------------------------------------------------
    const vr = cam.viewRect();
    const x0w = vr.x - HALF_W * 2;
    const x1w = vr.x + vr.w + HALF_W * 2;
    const y0w = vr.y - CONFIG.TILE_H * 2;
    const y1w = vr.y + vr.h + 140; // tall sprites below the view reach up into it
    const corners = [tileOfWorld(x0w, y0w), tileOfWorld(x1w, y0w), tileOfWorld(x0w, y1w), tileOfWorld(x1w, y1w)];
    const tx0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x))));
    const tx1 = Math.min(map.w - 1, Math.ceil(Math.max(...corners.map((c) => c.x))));
    const ty0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y))));
    const ty1 = Math.min(map.h - 1, Math.ceil(Math.max(...corners.map((c) => c.y))));
    const groundBottom = vr.y + vr.h + 4;
    this.viewTiles = { tx0, tx1, ty0, ty1 };
    this.stats.coverage = null;
    this.puffBudget = 4;
    const motion = this.motionOn;
    const glints = motion && cam.zoom >= 1;
    const visibleBuildings = [];
    const waterFrame = Math.floor(this.time * 2.5) % 4;

    const items = [];
    const seenBuildings = new Set();
    let tiles = 0;

    const drawSpr = (spr, wx, wy, a = 1) => {
      const dx = Math.round((wx - cam.x) * k) - spr.ax;
      const dy = Math.round((wy - cam.y) * k) - spr.ay;
      if (a !== 1) ctx.globalAlpha = a;
      ctx.drawImage(spr.canvas, dx, dy);
      if (a !== 1) ctx.globalAlpha = 1;
    };

    // --- pass 1: ground -----------------------------------------------------
    for (let y = ty0; y <= ty1; y++) {
      for (let x = tx0; x <= tx1; x++) {
        const wx = (x - y) * HALF_W;
        const wy = (x + y) * HALF_H;
        if (wx < x0w || wx > x1w || wy < y0w || wy > y1w) continue;
        const i = y * map.w + x;
        const terr = map.terrain[i];
        const variant = map.variant[i] & 3;
        const bid = map.building[i];
        if (wy <= groundBottom) {
          tiles++;
          if (terr === Terrain.WATER) {
            drawSpr(this.sprites.get(`w${variant}.${waterFrame}`, () => waterTileSpec(variant, waterFrame)), wx, wy);
            const mask = this.shoreMask(x, y);
            if (mask) drawSpr(this.sprites.get(`sh${mask}`, () => shoreSpec(mask)), wx, wy);
            if (glints && !mask && (Math.imul(i, 2654435761) >>> 0) % 6 === 0) {
              // Sun glints: brief flashes at a fixed spot per tile.
              const h = (Math.imul(i, 40503) >>> 0) % 997;
              const a = Math.sin(this.time * 2.1 + h);
              if (a > 0.82) drawGlint(ctx, (wx + ((h % 30) - 15) - cam.x) * k, (wy + HALF_H + (((h >> 3) % 12) - 6) - cam.y) * k, k, (a - 0.82) * 4.5);
            }
          } else {
            drawSpr(this.sprites.get(`g${terr}.${variant}`, () => groundTileSpec(terr, variant)), wx, wy);
          }
          const road = map.road[i];
          if (road === Road.ROAD) {
            const mask = this.roadMask(x, y);
            drawSpr(this.sprites.get(`r${mask}.${variant}`, () => roadSpec(mask, variant)), wx, wy);
          } else if (road === Road.PLAZA) {
            drawSpr(this.sprites.get(`pz${variant & 1}`, () => plazaSpec(variant & 1)), wx, wy);
          } else if (road === Road.BRIDGE) {
            const axis = map.hasRoad(x + 1, y) || map.hasRoad(x - 1, y) ? 'u' : 'v';
            drawSpr(this.sprites.get(`br${axis}`, () => bridgeSpec(axis)), wx, wy);
          }
          if (map.rubble[i] && !bid) drawSpr(this.sprites.get(`rb${variant}`, () => rubbleSpec(variant)), wx, wy);
          if (overlayOn && ov.tile) {
            const c = ov.tile(game, i);
            if (c) this.fillDiamond(wx, wy, c);
          }
        }
        // --- collect objects on this tile ---
        const depth = x + y + 1;
        if (bid) {
          if (!seenBuildings.has(bid)) {
            seenBuildings.add(bid);
            const b = game.buildings.get(bid);
            if (b) {
              this.collectBuilding(b, items, overlayOn);
              visibleBuildings.push(b);
            }
          }
        } else if (terr === Terrain.TREES && !map.road[i]) {
          // Wind: 5 cached sway frames; the phase rolls across the map in gusts.
          const tv = map.variant[i] & 7;
          const sway = motion ? Math.round(Math.sin(this.time * 1.7 - (x * 0.45 + y * 0.25)) * 2) : 0;
          items.push({ d: depth - 0.01, kind: K_STRIP, spr: this.sprites.get(`t${tv}.${sway}`, () => treesSpec(tv, sway)), wx, wy, full: true });
        } else if (terr === Terrain.ROCK) {
          items.push({ d: depth - 0.01, kind: K_STRIP, spr: this.sprites.get(`k${variant}`, () => rocksSpec(variant)), wx, wy, full: true });
        }
        if (map.wall[i]) {
          const gate = map.wall[i] === 2;
          let mask = this.wallMask(x, y);
          // A gate with no wall beside it spans across its road.
          if (gate && !mask) mask = map.hasRoad(x, y - 1) || map.hasRoad(x, y + 1) ? 10 : 5;
          const hp = wallHpOf(game, i);
          const damaged = hp.hp < hp.max * 0.5;
          items.push({ d: depth, kind: K_STRIP, spr: this.sprites.get(`wl${mask}.${gate ? 1 : 0}.${damaged ? 1 : 0}`, () => wallSpec(mask, gate, damaged)), wx, wy, full: true });
        }
        if (map.aqueduct[i]) {
          const mask = this.aqueductMask(x, y);
          const filled = map.aqueduct[i] === 2;
          items.push({ d: depth, kind: K_STRIP, spr: this.sprites.get(`aq${mask}.${filled ? 1 : 0}`, () => aqueductSpec(mask, filled)), wx, wy, full: true });
        }
        if (game.fires.size && game.fires.has(i)) {
          items.push({ d: depth + 0.002, kind: K_FIRE, wx, wy: wy + HALF_H, seed: i });
          if (Math.random() < dt * 2) this.effects.smoke(wx, wy - 4, true);
        }
      }
    }

    // --- building shadows (on the ground, under every object) --------------
    if (!overlayOn) for (const b of visibleBuildings) this.drawBuildingShadow(b);

    // --- walkers ------------------------------------------------------------
    for (const w of game.walkers.values()) {
      if (overlayOn && ov.walkers && !ov.walkers.includes(w.type)) continue;
      const p = w.moving ? Math.min(1, w.progress + alpha * w.speed) : 0;
      const fx = w.x + (w.tx - w.x) * p + 0.5;
      const fy = w.y + (w.ty - w.y) * p + 0.5;
      const wx = (fx - fy) * HALF_W;
      const wy = (fx + fy) * HALF_H;
      if (wx < x0w || wx > x1w || wy < y0w || wy > vr.y + vr.h + 30) continue;
      const ddx = (w.tx - w.x) - (w.ty - w.y);
      const ddy = (w.tx - w.x) + (w.ty - w.y);
      items.push({ d: fx + fy + 0.003, kind: K_WALKER, w, wx, wy, dirX: ddx === 0 ? (w.lastDir === 1 || w.lastDir === 0 ? 1 : -1) : Math.sign(ddx), dirY: Math.sign(ddy) });
    }

    // --- soldiers, raiders, missiles, rally flags ---------------------------
    const tick = game.time.totalTicks;
    const inView = (wx, wy) => wx >= x0w && wx <= x1w && wy >= y0w && wy <= vr.y + vr.h + 40;
    for (const u of game.units.values()) {
      const fx = u.px + (u.x - u.px) * alpha;
      const fy = u.py + (u.y - u.py) * alpha;
      const wx = (fx - fy) * HALF_W;
      const wy = (fx + fy) * HALF_H;
      if (inView(wx, wy)) items.push({ d: fx + fy + 0.004, kind: K_UNIT, u, wx, wy });
    }
    for (const p of game.projectiles) {
      const wx = (p.x - p.y) * HALF_W;
      const wy = (p.x + p.y) * HALF_H - p.z;
      if (inView(wx, wy)) items.push({ d: p.x + p.y + 0.5, kind: K_PROJ, p, wx, wy });
    }
    for (const b of game.buildings.values()) {
      if (!b.rally) continue;
      const wx = (b.rally.x - b.rally.y) * HALF_W;
      const wy = (b.rally.x + b.rally.y) * HALF_H;
      if (inView(wx, wy)) items.push({ d: b.rally.x + b.rally.y + 0.002, kind: K_FLAG, wx, wy, color: UNIT_TYPES[b.def.unit]?.color || '#a8322b' });
    }
    const selFort = this.selectedId && game.buildings.get(this.selectedId)?.def.kind === 'fort' ? this.selectedId : 0;

    // --- pass 2: sorted objects --------------------------------------------
    items.sort((a, b) => a.d - b.d || a.kind - b.kind);
    for (const it of items) {
      switch (it.kind) {
        case K_STRIP: {
          const spr = it.spr;
          const dx = Math.round((it.wx - cam.x) * k) - spr.ax;
          const dy = Math.round((it.wy - cam.y) * k) - spr.ay;
          if (it.alpha) ctx.globalAlpha = it.alpha;
          if (it.full) {
            ctx.drawImage(spr.canvas, dx, dy);
          } else {
            const sx0 = Math.round((it.j * spr.w) / it.n);
            const sx1 = Math.round(((it.j + 1) * spr.w) / it.n);
            if (sx1 > sx0) ctx.drawImage(spr.canvas, sx0, 0, sx1 - sx0, spr.h, dx + sx0, dy, sx1 - sx0, spr.h);
          }
          if (it.alpha) ctx.globalAlpha = 1;
          break;
        }
        case K_WALKER:
          drawWalker(ctx, it.w, Math.round((it.wx - cam.x) * k), Math.round((it.wy - cam.y) * k), k, this.time, it.dirX, it.dirY);
          break;
        case K_FIRE:
          drawFlames(ctx, (it.wx - cam.x) * k, (it.wy - cam.y) * k, k, this.time, it.seed);
          break;
        case K_COLUMN:
          this.drawColumn(it);
          break;
        case K_EXTRA:
          this.drawExtra(it);
          break;
        case K_UNIT:
          drawUnit(ctx, it.u, Math.round((it.wx - cam.x) * k), Math.round((it.wy - cam.y) * k), k, this.time, tick, selFort !== 0 && it.u.fort === selFort);
          break;
        case K_PROJ:
          drawProjectile(ctx, it.p, (it.wx - cam.x) * k, (it.wy - cam.y) * k, k);
          break;
        case K_FLAG:
          drawRallyFlag(ctx, Math.round((it.wx - cam.x) * k), Math.round((it.wy - cam.y) * k), k, it.color, this.time);
          break;
        default:
          break;
      }
    }

    // --- ambient: cloud shadows and birds over the city --------------------
    if (this.ambientOn) {
      this.ambient.update(dt);
      this.ambient.draw(ctx, cam, vr, this.time);
    }

    // --- pass 3: previews, hover, selection --------------------------------
    this.drawToolPreview();
    if (this.selectedId) {
      const b = game.buildings.get(this.selectedId);
      if (b) {
        // A clicked well/fountain/reservoir shows the area it supplies.
        const water = WATER_AREA[b.def.kind];
        if (water) this.drawCoverage(this.squareTiles(b.x, b.y, b.size, water.r));
        this.outlineFootprint(b.x, b.y, b.size, 'rgba(255,230,120,0.95)', 2);
        if (b.rally) this.drawRallyLine(b);
        if (b.def.kind === 'tower') this.drawRange(b.x, b.y, b.size, TOWER_RANGE, 'rgba(255,120,60,0.12)');
      } else this.selectedId = 0;
    }
    if (this.deployFort && this.hoverTile) {
      // Picking a deployment point: ghost standard under the cursor.
      const f = game.buildings.get(this.deployFort);
      const color = f ? UNIT_TYPES[f.def.unit]?.color || '#a8322b' : '#a8322b';
      const { x, y } = this.hoverTile;
      this.outlineFootprint(x, y, 1, 'rgba(255,230,120,0.95)', 2);
      ctx.globalAlpha = 0.7;
      drawRallyFlag(ctx, Math.round(((x - y) * HALF_W - cam.x) * k), Math.round(((x + y + 1) * HALF_H - cam.y) * k), k, color, this.time);
      ctx.globalAlpha = 1;
    }

    // --- pass 4: particles -------------------------------------------------
    this.effects.update(dt);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.effects.draw(ctx, cam);

    this.stats.tiles = tiles;
    this.stats.objects = items.length;
    this.stats.ms = performance.now() - t0;
  }

  /** Queue a building's strips (or its overlay stand-in). */
  collectBuilding(b, items, overlayOn) {
    const ov = this.overlay;
    const wx = (b.x - b.y) * HALF_W;
    const wy = (b.x + b.y) * HALF_H;
    const depths = this.stripsFor(b);
    const front = Math.max(...depths);
    if (overlayOn && ov.show && !ov.show(b)) {
      // Flat footprint + optional info column.
      const color = b.house ? 'rgba(214,190,140,0.9)' : 'rgba(150,145,135,0.85)';
      items.push({ d: front - 0.5, kind: K_EXTRA, b, flat: color, wx, wy });
      let v = null;
      if (b.house && ov.house) v = b.house.pop > 0 ? ov.house(b) : null;
      else if (ov.value) v = ov.value(b);
      if (v !== null && v !== undefined) {
        const cx = b.x + b.size / 2;
        const cy = b.y + b.size / 2;
        items.push({ d: front + 0.001, kind: K_COLUMN, wx: (cx - cy) * HALF_W, wy: (cx + cy) * HALF_H, v: Math.max(0, Math.min(1, v)), bad: !!ov.bad, S: b.size });
      }
      return;
    }
    const state = artState(b);
    const key = `b:${b.type}:${b.size}:${b.variant}:${state}`;
    const spr = this.sprites.get(key, () => buildingSpec(b.type, b.size, b.variant, state));
    const n = depths.length;
    // Just built: rise out of the ground and fade in (half a second).
    let alpha;
    let rise = 0;
    const t0 = this.appear.get(b.id);
    if (t0 !== undefined) {
      const p = (this.time - t0) / 0.5;
      if (p >= 1) this.appear.delete(b.id);
      else {
        const e = 1 - (1 - p) ** 3; // ease out
        alpha = Math.max(0.05, e);
        rise = (1 - e) * 14;
      }
    }
    if (b.size === 1) {
      items.push({ d: front, kind: K_STRIP, spr, wx, wy: wy + rise, full: true, alpha });
    } else {
      for (let j = 0; j < n; j++) items.push({ d: depths[j], kind: K_STRIP, spr, wx, wy: wy + rise, j, n, alpha });
    }
    const kind = b.def.kind;
    if (kind === 'warehouse' || kind === 'granary') {
      items.push({ d: front + 0.0005, kind: K_EXTRA, b, wx, wy, stock: true });
    }
    if ((b.type === 'pottery_ws' || b.type === 'weapons_ws') && b.efficiency > 0 && b.progress > 0 && Math.random() < 0.03) {
      this.effects.smoke(wx + (0.99 - 0.34) * HALF_W, wy + (0.99 + 0.34) * HALF_H - 32);
    }
    // Hearth smoke from lived-in homes (only when zoomed in enough to see it).
    if (b.house && b.house.pop > 0 && b.house.tier >= 3 && b.house.tier <= 9 && this.camera.zoom >= 1 && Math.random() < 0.0015) {
      this.effects.smoke(wx + (Math.random() - 0.5) * 8, wy + b.size * HALF_H - 14 - b.size * 10);
    }
    if (kind === 'fountain' && b.hasWater && b.efficiency > 0 && this.motionOn) {
      items.push({ d: front + 0.0006, kind: K_EXTRA, b, wx, wy, spray: true });
    }
  }

  /** Neighbor road mask: 1=N 2=E 4=S 8=W */
  roadMask(x, y) {
    const m = this.game.map;
    return (m.hasRoad(x, y - 1) ? 1 : 0) | (m.hasRoad(x + 1, y) ? 2 : 0) | (m.hasRoad(x, y + 1) ? 4 : 0) | (m.hasRoad(x - 1, y) ? 8 : 0);
  }

  /** Land neighbors of a water tile. */
  shoreMask(x, y) {
    const m = this.game.map;
    const land = (tx, ty) => m.inBounds(tx, ty) && m.terrain[m.idx(tx, ty)] !== Terrain.WATER;
    return (land(x, y - 1) ? 1 : 0) | (land(x + 1, y) ? 2 : 0) | (land(x, y + 1) ? 4 : 0) | (land(x - 1, y) ? 8 : 0);
  }

  /** Wall connections: other walls/gates or watchtowers. 1=N 2=E 4=S 8=W */
  wallMask(x, y) {
    const { map, buildings } = this.game;
    const conn = (tx, ty) => {
      if (!map.inBounds(tx, ty)) return false;
      const i = map.idx(tx, ty);
      if (map.wall[i]) return true;
      const b = map.building[i] ? buildings.get(map.building[i]) : null;
      return !!b && b.def.kind === 'tower';
    };
    return (conn(x, y - 1) ? 1 : 0) | (conn(x + 1, y) ? 2 : 0) | (conn(x, y + 1) ? 4 : 0) | (conn(x - 1, y) ? 8 : 0);
  }

  /** Dashed line from a deployed fort to its standard. */
  drawRallyLine(b) {
    const { ctx, camera: cam } = this;
    const k = cam.scale;
    const cx = b.x + b.size / 2;
    const cy = b.y + b.size / 2;
    const a = [((cx - cy) * HALF_W - cam.x) * k, ((cx + cy) * HALF_H - cam.y) * k];
    const z = [((b.rally.x - b.rally.y) * HALF_W - cam.x) * k, ((b.rally.x + b.rally.y) * HALF_H - cam.y) * k];
    ctx.save();
    ctx.setLineDash([6 * cam.dpr, 5 * cam.dpr]);
    ctx.strokeStyle = 'rgba(255,230,120,0.8)';
    ctx.lineWidth = 1.5 * cam.dpr;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(z[0], z[1]);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Soft shadow on the ground to the lower right of a building (sun in the
   * upper left, like the art's shading). Drawn after the ground and before
   * every object, so walkers and neighbours stand on top of it. The polygon
   * wraps the footprint's two front edges, so the building's own tiles are
   * never darkened (flat farms and plazas stay bright).
   */
  drawBuildingShadow(b) {
    const L = shadowLength(b) * 1.25;
    if (L <= 0.03) return;
    const { ctx, camera: cam } = this;
    const k = cam.scale;
    const S = b.size;
    const pt = (u, v) => [((b.x + u - (b.y + v)) * HALF_W - cam.x) * k, ((b.x + u + b.y + v) * HALF_H - cam.y) * k];
    for (const [len, alpha] of [[L, 0.14], [L * 0.55, 0.12]]) {
      const dv = len * 0.4;
      const pts = [pt(S, 0), pt(S + len, dv), pt(S + len, S + dv), pt(len, S + dv), pt(0, S), pt(S, S)];
      ctx.fillStyle = `rgba(16,22,10,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let q = 1; q < pts.length; q++) ctx.lineTo(pts[q][0], pts[q][1]);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** Tile indices within `r` of a footprint (the square sim/water.js covers). */
  squareTiles(x0, y0, S, r, out = new Set()) {
    const map = this.game.map;
    for (let y = Math.max(0, y0 - r); y <= Math.min(map.h - 1, y0 + S - 1 + r); y++) {
      for (let x = Math.max(0, x0 - r); x <= Math.min(map.w - 1, x0 + S - 1 + r); x++) out.add(map.idx(x, y));
    }
    return out;
  }

  /**
   * Paint water coverage: visible tiles where `isPale(i)` is true in pale
   * blue (what existing buildings already supply) and the `strong` tiles in
   * dark blue on top (the building being placed or the one selected). Each
   * tile is filled once, so overlapping radii do not stack into darker
   * blotches, and each area gets a crisp outline.
   * @param {Set<number>} strong  tile indices
   * @param {(i:number)=>boolean} [isPale]
   */
  drawCoverage(strong, isPale = null) {
    const { ctx, camera: cam, game } = this;
    const map = game.map;
    const k = cam.scale;
    const pt = (x, y) => [((x - y) * HALF_W - cam.x) * k, ((x + y) * HALF_H - cam.y) * k];
    // Sides of tile (x, y): [neighbor, from corner, to corner] (N, E, S, W).
    const sides = (x, y) => [
      [map.inBounds(x, y - 1) ? map.idx(x, y - 1) : -1, pt(x, y), pt(x + 1, y)],
      [map.inBounds(x + 1, y) ? map.idx(x + 1, y) : -1, pt(x + 1, y), pt(x + 1, y + 1)],
      [map.inBounds(x, y + 1) ? map.idx(x, y + 1) : -1, pt(x, y + 1), pt(x + 1, y + 1)],
      [map.inBounds(x - 1, y) ? map.idx(x - 1, y) : -1, pt(x, y), pt(x, y + 1)],
    ];
    const paleEdges = [];
    const strongEdges = [];
    let paleCount = 0;
    const v = this.viewTiles;
    if (isPale && v) {
      const inside = (j) => j >= 0 && (strong.has(j) || isPale(j));
      for (let y = v.ty0; y <= v.ty1; y++) {
        for (let x = v.tx0; x <= v.tx1; x++) {
          const i = map.idx(x, y);
          if (strong.has(i) || !isPale(i)) continue;
          paleCount++;
          this.fillDiamond((x - y) * HALF_W, (x + y) * HALF_H, RADIUS_PALE.fill);
          for (const [j, a, b] of sides(x, y)) if (!inside(j)) paleEdges.push(a, b);
        }
      }
    }
    for (const i of strong) {
      const x = map.xOf(i);
      const y = map.yOf(i);
      this.fillDiamond((x - y) * HALF_W, (x + y) * HALF_H, RADIUS_STRONG.fill);
      for (const [j, a, b] of sides(x, y)) if (!strong.has(j)) strongEdges.push(a, b);
    }
    for (const [edges, color, width] of [[paleEdges, RADIUS_PALE.edge, 1], [strongEdges, RADIUS_STRONG.edge, 1.6]]) {
      if (!edges.length) continue;
      ctx.strokeStyle = color;
      ctx.lineWidth = width * cam.dpr;
      ctx.beginPath();
      for (let e = 0; e < edges.length; e += 2) {
        ctx.moveTo(edges[e][0], edges[e][1]);
        ctx.lineTo(edges[e + 1][0], edges[e + 1][1]);
      }
      ctx.stroke();
    }
    // Exposed for the browser smoke test (and the curious): tiles painted this frame.
    this.stats.coverage = { strong: strong.size, pale: paleCount };
  }

  /** Tint every tile within `r` (Chebyshev) of a footprint. */
  drawRange(x0, y0, S, r, color) {
    const map = this.game.map;
    for (let y = y0 - r; y < y0 + S + r; y++) {
      for (let x = x0 - r; x < x0 + S + r; x++) {
        if (map.inBounds(x, y)) this.fillDiamond((x - y) * HALF_W, (x + y) * HALF_H, color);
      }
    }
  }

  /** Aqueduct connections: other aqueducts or reservoirs. */
  aqueductMask(x, y) {
    const { map, buildings } = this.game;
    const conn = (tx, ty) => {
      if (!map.inBounds(tx, ty)) return false;
      const i = map.idx(tx, ty);
      if (map.aqueduct[i]) return true;
      const b = buildings.get(map.building[i]);
      return !!b && b.def.kind === 'reservoir';
    };
    return (conn(x, y - 1) ? 1 : 0) | (conn(x + 1, y) ? 2 : 0) | (conn(x, y + 1) ? 4 : 0) | (conn(x - 1, y) ? 8 : 0);
  }

  /** Fill a tile diamond (world coords of its top corner) with a color. */
  fillDiamond(wx, wy, color, S = 1) {
    const { ctx, camera: cam } = this;
    const k = cam.scale;
    const x = (wx - cam.x) * k;
    const y = (wy - cam.y) * k;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + HALF_W * S * k, y + HALF_H * S * k);
    ctx.lineTo(x, y + CONFIG.TILE_H * S * k);
    ctx.lineTo(x - HALF_W * S * k, y + HALF_H * S * k);
    ctx.closePath();
    ctx.fill();
  }

  outlineFootprint(tx, ty, S, color, width = 1.5) {
    const { ctx, camera: cam } = this;
    const k = cam.scale;
    const wx = (tx - ty) * HALF_W;
    const wy = (tx + ty) * HALF_H;
    const x = (wx - cam.x) * k;
    const y = (wy - cam.y) * k;
    ctx.strokeStyle = color;
    ctx.lineWidth = width * cam.dpr;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + HALF_W * S * k, y + HALF_H * S * k);
    ctx.lineTo(x, y + CONFIG.TILE_H * S * k);
    ctx.lineTo(x - HALF_W * S * k, y + HALF_H * S * k);
    ctx.closePath();
    ctx.stroke();
  }

  drawColumn(it) {
    const { ctx, camera: cam } = this;
    const k = cam.scale;
    const x = (it.wx - cam.x) * k;
    const y = (it.wy - cam.y) * k;
    const h = (6 + it.v * 44) * k;
    const r = (3 + it.S) * k;
    const color = columnColor(it.v, it.bad);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(x + 2 * k, y, r * 1.3, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(x - r, y - h, r * 2, h);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x - r, y - h, r * 0.7, h);
    ctx.beginPath();
    ctx.ellipse(x, y - h, r, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  /** Flat overlay footprints, dynamic stock displays and fountain spray. */
  drawExtra(it) {
    const { ctx, camera: cam } = this;
    const k = cam.scale;
    const b = it.b;
    if (it.spray) {
      // Spout top of fountainArt: local P(0.5, 0.5, 4) raised 10 px.
      drawSpray(ctx, (it.wx - cam.x) * k, (it.wy + HALF_H * 1 - 14 - cam.y) * k, k, this.time, b.id);
      return;
    }
    if (it.flat) {
      this.fillDiamond(it.wx, it.wy, it.flat, b.size);
      return;
    }
    if (it.stock) {
      ctx.save();
      ctx.setTransform(k, 0, 0, k, Math.round((it.wx - cam.x) * k), Math.round((it.wy - cam.y) * k));
      if (b.def.kind === 'warehouse') drawWarehouseStock(ctx, b.stock);
      else {
        let used = 0;
        for (const key in b.stock) used += b.stock[key];
        drawGranaryStock(ctx, b.size, used / CONFIG.GRANARY_CAPACITY);
      }
      ctx.restore();
    }
  }

  /** Construction previews: ghost building, tile markers, coverage radius. */
  drawToolPreview() {
    const { game, plan } = this;
    if (!plan) {
      if (this.hoverTile) this.outlineFootprint(this.hoverTile.x, this.hoverTile.y, 1, 'rgba(255,255,255,0.55)', 1);
      return;
    }
    const map = game.map;
    const def = BUILDINGS[plan.tool];
    const water = def ? WATER_AREA[def.kind] : null;
    // Other area-of-effect buildings keep a simple single-color hint.
    const radius = { hospital: CONFIG.HOSPITAL_RADIUS, tower: TOWER_RANGE }[plan.tool];
    if (water) {
      // Water buildings: the new one(s) in dark blue over the pale area the
      // existing ones of this kind already supply. While hovering a single
      // spot the radius shows even where it cannot be built; in a drag only
      // the valid spots count.
      const strong = new Set();
      const single = plan.items.length === 1;
      for (const it of plan.items) if (single || it.ok) this.squareTiles(it.x, it.y, it.size, water.r, strong);
      this.drawCoverage(strong, (i) => (map.water[i] & water.bit) !== 0);
    } else if (radius && plan.items.length === 1) {
      const it = plan.items[0];
      const S = it.size;
      for (let y = it.y - radius; y < it.y + S + radius; y++) {
        for (let x = it.x - radius; x < it.x + S + radius; x++) {
          if (!map.inBounds(x, y)) continue;
          this.fillDiamond((x - y) * HALF_W, (x + y) * HALF_H, 'rgba(80,160,255,0.16)');
        }
      }
    }
    for (const it of plan.items) {
      const color = it.ok ? (plan.tool === 'clear' ? 'rgba(230,80,40,0.45)' : 'rgba(80,220,90,0.38)') : 'rgba(230,40,40,0.5)';
      const wx = (it.x - it.y) * HALF_W;
      const wy = (it.x + it.y) * HALF_H;
      if (def && plan.kind === 'building' && it.ok) {
        const spr = this.sprites.get(`b:${plan.tool}:${it.size}:0:${plan.tool === 'house' ? 0 : 0}`, () => buildingSpec(plan.tool, it.size, 0, 0));
        this.fillDiamond(wx, wy, color, it.size);
        const k = this.camera.scale;
        this.ctx.globalAlpha = 0.72;
        this.ctx.drawImage(spr.canvas, Math.round((wx - this.camera.x) * k) - spr.ax, Math.round((wy - this.camera.y) * k) - spr.ay);
        this.ctx.globalAlpha = 1;
      } else {
        this.fillDiamond(wx, wy, color, it.size);
      }
    }
  }
}

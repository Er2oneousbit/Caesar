/**
 * lighting.js
 * ----------------------------------------------------------------------------
 * Day and night.
 *
 * The sun goes round once every DAY_TICKS simulation ticks, so the sky
 * follows GAME time: it stops while the game is paused, runs faster at higher
 * speeds and comes back the same after loading a save. skyAt(t) gives the
 * light for a moment of the day: a multiply TINT for the whole scene (white
 * by day, warm at sunset, blue at night), how bright the LAMPS are (0..1) and
 * how strong the SUN is (0..1, for shadows and cloud shade).
 *
 * At dusk the city lights up. Light is drawn in two layers (NightLights):
 *   1. a LIGHT MAP at half resolution: filled with the tint, then warm pools
 *      of light are added where there are lit homes, torches, lanterns and
 *      fires. The scene is multiplied by it, so lit areas keep their day
 *      colors while everything else sinks into the night.
 *   2. GLOWS added on top (additive): lit windows, torch flames, fires.
 * Window and door positions come from the building art itself (draw.js
 * records where windows() and door() put openings), torch positions from the
 * TORCHES table below. Everything here is visual only.
 * ----------------------------------------------------------------------------
 */

import { CONFIG, HALF_W, HALF_H } from '../config.js';
import { recordingContext, hash01 } from './draw.js';
import { buildingSpec, templeAltar, SAME_EVERY_WAY } from './buildingArt.js';
import { turnUV } from './turn.js';
import { makeCanvas } from './sprites.js';

/** One day and night: 5 minutes of game time at 1x speed. */
export const DAY_TICKS = CONFIG.TICKS_PER_SECOND * 60 * 5;
/** Time of day a new game starts at (0..1, see SKY): mid-morning. */
const DAY_START = 0.08;

/**
 * The sky through one day, t = 0..1. [t, multiply tint rgb, lamps 0..1].
 * Day takes a bit over half the cycle; sunset and dawn get their own colors.
 */
const SKY = [
  [0.00, [255, 255, 255], 0],
  [0.56, [255, 255, 255], 0],
  [0.62, [255, 236, 206], 0.04], // golden hour
  [0.67, [240, 180, 150], 0.35], // sunset
  [0.71, [150, 146, 202], 0.8], // blue hour
  [0.75, [112, 124, 186], 1], // night
  [0.87, [112, 124, 186], 1],
  [0.92, [204, 170, 188], 0.5], // dawn
  [0.96, [255, 234, 214], 0.08], // sunrise
  [1.00, [255, 255, 255], 0],
];

/** The time of day the menu's city is shown at: mid-morning, in full sun. */
export const MENU_TIME = 0.2;

/**
 * Ticks to run from `totalTicks` until the time of day is `t` (0..1). The
 * menu's city ran a fixed 80 days, which since the 16-day month always
 * ended at nightfall: every visit to the menu opened on a city at night.
 */
export function ticksUntil(totalTicks, t) {
  const now = dayTime(totalTicks);
  const ahead = (((t - now) % 1) + 1) % 1;
  return Math.round(ahead * DAY_TICKS);
}

/** Time of day (0..1) for a tick count. */
export function dayTime(totalTicks) {
  const t = (totalTicks / DAY_TICKS + DAY_START) % 1;
  return t < 0 ? t + 1 : t;
}

const smooth = (x) => x * x * (3 - 2 * x);

/**
 * Light at time of day t.
 * @returns {{t:number, tint:number[], lamps:number, sun:number, night:boolean}}
 */
export function skyAt(t) {
  const tt = ((t % 1) + 1) % 1;
  let k = 1;
  while (k < SKY.length - 1 && SKY[k][0] < tt) k++;
  const [t0, c0, l0] = SKY[k - 1];
  const [t1, c1, l1] = SKY[k];
  const f = t1 > t0 ? smooth(Math.max(0, Math.min(1, (tt - t0) / (t1 - t0)))) : 0;
  const tint = c0.map((v, i) => Math.round(v + (c1[i] - v) * f));
  const lamps = l0 + (l1 - l0) * f;
  const luma = (0.299 * tint[0] + 0.587 * tint[1] + 0.114 * tint[2]) / 255;
  const sun = Math.round(Math.max(0, Math.min(1, (luma - 0.55) / 0.45)) * 1000) / 1000;
  return { t: tt, tint, lamps, sun, night: lamps > 0.5 };
}

/** Broad daylight: nothing to draw. */
export const NOON = Object.freeze(skyAt(0.3));

// ---------------------------------------------------------------------------
// Which buildings light up, and where
// ---------------------------------------------------------------------------

/** Kinds that stay dark at night (their workers go home). */
const DARK_KINDS = new Set(['farm', 'raw', 'workshop', 'granary', 'warehouse', 'decor', 'well', 'fountain', 'reservoir']);

/**
 * Torches and lanterns [u, v, z] (footprint tiles, height px) by building
 * type. Functions get the footprint size S.
 */
const TORCHES = {
  // the altar's fire at the front right, torches either side of the steps
  temple: (S) => [[...templeAltar(S), 6], [0.4, S - 0.12, 10], [S - 0.4, S - 0.12, 10]],
  oracle: (S) => [[S / 2, S / 2, 8]],
  forum: (S) => [[0.3, S - 0.2, 12], [S - 0.2, 0.3, 12], [1.35, 1.3, 8]],
  senate: (S) => [[S * 0.3, S - 0.15, 12], [S * 0.7, S - 0.15, 12]],
  theater: (S) => [[0.35, S - 0.2, 14], [S - 0.35, S - 0.2, 14]],
  amphitheater: (S) => [[S / 2, S - 0.05, 24], [S - 0.05, S / 2, 24], [S * 0.15, S * 0.85, 22]],
  colosseum: (S) => [[S / 2, S - 0.05, 35], [S - 0.05, S / 2, 35], [S * 0.12, S * 0.88, 33], [S * 0.88, S * 0.12, 33]],
  prefecture: () => [[0.62, 0.8, 8]],
  barracks: (S) => [[S * 0.4, 1.2, 12], [S * 0.6, 1.2, 12]],
  fort: (S) => [[S / 2 - 0.36, S - 0.05, 19], [S / 2 + 0.36, S - 0.05, 19], [S - 0.24, S - 0.24, 26]],
  tower: (S) => [[S / 2, S / 2, 50]],
  dock: (S) => [[S * 0.2, S * 0.2, 12], [S * 0.8, S * 0.8, 12]],
  market: (S) => [[S / 2, S / 2, 12]],
  gladiator_school: (S) => [[S * 0.5, S - 0.1, 10]],
};

function torchesFor(type, S, state) {
  if (type === 'house') return state === 1 && S === 1 ? [[0.3, 0.8, 2]] : []; // tents: the campfire
  const fn = TORCHES[type] || (type.startsWith('temple_') ? TORCHES.temple : type.startsWith('fort_') ? TORCHES.fort : null);
  return fn ? fn(S) : [];
}

/** Local point P(u, v, z) (same projection as draw.js). */
const lp = (u, v, z = 0) => [(u - v) * HALF_W, (u + v) * HALF_H - z];

const lightCache = new Map(); // sprite key -> { windows, doors, torches, cx, cy }

/**
 * Where a building's lights are, in local world px from its footprint's top
 * corner. Cached per sprite key (type, size, variant, art state).
 */
export function lightsOf(key, type, S, variant, state, turn = 0) {
  if (SAME_EVERY_WAY.has(type)) turn = 0; // (drawn as written at every turn: its torches stay put too)
  let info = lightCache.get(key);
  if (info) return info;
  const { ctx, lights } = recordingContext();
  try {
    buildingSpec(type, S, variant, state, false, 0, false, turn).draw(ctx);
  } catch {
    // Art that cannot be recorded simply has no windows at night.
  }
  const windows = [];
  const doors = [];
  for (const l of lights) (l.kind === 'door' ? doors : windows).push([l.x, l.y, Math.max(1.6, Math.min(l.w, l.h) * 0.8)]);
  const [cx, cy] = lp(S / 2, S / 2, 8);
  info = { windows, doors, torches: torchesFor(type, S, state).map(([u, v, z]) => lp(...turnUV(u, v, S, turn), z)), cx, cy };
  if (lightCache.size > 2000) lightCache.clear();
  lightCache.set(key, info);
  return info;
}

/** Is this building lit at night (at this lamp level)? Homes switch on one by one. */
export function isLit(b, lamps) {
  if (b.house) return b.house.pop > 0 && lamps > 0.1 + hash01(b.id, 7) * 0.5;
  const kind = b.def.kind;
  if (DARK_KINDS.has(kind)) return false;
  if (b.def.workers && !(b.efficiency > 0)) return false; // closed: no staff
  return lamps > 0.05 + hash01(b.id, 7) * 0.2;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/** A radial glow sprite: `rgb` at the center fading to nothing. */
function makeGlow(size, rgb, core = 0.15) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, `rgba(${rgb},1)`);
  grad.addColorStop(core, `rgba(${rgb},0.85)`);
  grad.addColorStop(0.5, `rgba(${rgb},0.35)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/**
 * Collects this frame's lights (screen device px) and composites them.
 * Queue with pool()/glow() between begin() and apply().
 */
export class NightLights {
  constructor() {
    this.map = null; // light map canvas (half resolution)
    this.mctx = null;
    this.sprites = null; // glow sprites, made on first use (needs a DOM)
    this.pools = []; // [x, y, rx, ry, alpha, fire]
    this.glows = []; // [x, y, r, alpha, fire]
    this.nPools = 0;
    this.nGlows = 0;
  }

  begin() {
    this.nPools = 0;
    this.nGlows = 0;
  }

  /** A pool of light on the ground (an iso ellipse), center (x, y), radius rx. */
  pool(x, y, rx, alpha, fire = false) {
    const p = this.pools[this.nPools] || (this.pools[this.nPools] = new Array(6));
    p[0] = x; p[1] = y; p[2] = rx; p[3] = rx * 0.6; p[4] = alpha; p[5] = fire;
    this.nPools++;
  }

  /** A small bright glow (window, flame) added on top of the night scene. */
  glow(x, y, r, alpha, fire = false) {
    const p = this.glows[this.nGlows] || (this.glows[this.nGlows] = new Array(5));
    p[0] = x; p[1] = y; p[2] = r; p[3] = alpha; p[4] = fire;
    this.nGlows++;
  }

  ensureSprites() {
    if (this.sprites) return this.sprites;
    this.sprites = {
      pool: makeGlow(128, '255,222,170', 0.2),
      firePool: makeGlow(128, '255,170,90', 0.25),
      glow: makeGlow(32, '255,214,130', 0.12),
      fireGlow: makeGlow(32, '255,150,60', 0.12),
    };
    return this.sprites;
  }

  /**
   * Darken the scene by the sky tint, let the queued pools of light through,
   * then add the glows. `W`, `H` are the canvas size in device px.
   */
  apply(ctx, W, H, sky) {
    const spr = this.ensureSprites();
    const mw = Math.max(1, Math.ceil(W / 2));
    const mh = Math.max(1, Math.ceil(H / 2));
    if (!this.map || this.map.width !== mw || this.map.height !== mh) {
      this.map = makeCanvas(mw, mh);
      this.mctx = this.map.getContext('2d');
    }
    const m = this.mctx;
    m.globalCompositeOperation = 'source-over';
    m.globalAlpha = 1;
    m.fillStyle = `rgb(${sky.tint[0]},${sky.tint[1]},${sky.tint[2]})`;
    m.fillRect(0, 0, mw, mh);
    if (this.nPools) {
      m.globalCompositeOperation = 'lighter';
      for (let i = 0; i < this.nPools; i++) {
        const [x, y, rx, ry, a, fire] = this.pools[i];
        if (a <= 0.01) continue;
        m.globalAlpha = Math.min(1, a);
        m.drawImage(fire ? spr.firePool : spr.pool, (x - rx) / 2, (y - ry) / 2, rx, ry);
      }
      m.globalCompositeOperation = 'source-over';
      m.globalAlpha = 1;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.map, 0, 0, mw, mh, 0, 0, mw * 2, mh * 2);
    if (this.nGlows) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < this.nGlows; i++) {
        const [x, y, r, a, fire] = this.glows[i];
        if (a <= 0.01) continue;
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(fire ? spr.fireGlow : spr.glow, x - r, y - r, r * 2, r * 2);
      }
    }
    ctx.restore();
  }
}

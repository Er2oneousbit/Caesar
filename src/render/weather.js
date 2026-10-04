/**
 * weather.js
 * ----------------------------------------------------------------------------
 * Seasons and weather. Purely visual: nothing here touches the simulation,
 * so it may use Math.random() freely (tests can pass their own random).
 *
 * SEASONS follow the game calendar (month 0 = Ianuarius). seasonPalette()
 * blends four looks along MONTH_LOOK: December to Februarius are full winter
 * (snow only ever falls on winter scenery), and the shoulder months (Martius,
 * Maius, Augustus, September, November) blend, so the map shifts in steps
 * instead of changing all at once:
 *   winter  grey-green grass, many trees bare, hardly any flowers
 *   spring  fresh green, meadows full of flowers, blossoming trees
 *   summer  the classic look
 *   autumn  olive-gold grass, orange and red leaves
 * Cypresses stay dark green all year. The renderer puts the palette's `key`
 * into ground/tree sprite keys and drops last month's sprites.
 *
 * WEATHER is a small state machine (clear, cloudy, rain, storm, snow) that
 * picks what comes next with odds that depend on the season, and eases the
 * current levels toward the new state so a shower builds up and fades out.
 * Season rules (the seasons themselves are calendar data in sim/time.js):
 *   spring  the rainy season (nearly three times summer's rain)
 *   summer  mostly clear; its rain comes as the odd thunderstorm
 *   fall    some showers (the internal key is 'autumn')
 *   winter  snow and only snow: no rain, no thunder; no snow in other seasons
 * A new season draws new weather at once, spells last 20-45 s, and a new or
 * loaded game opens with a short clear spell (reset()).
 * SNOW COVER: snow settles while it falls (`cover` 0..1, full after about six
 * days of snowfall) and melts after, slowly in winter, fast in spring. It is
 * quantized to `coverLevel` 0..3, which seasonPalette() folds into the sprite
 * keys, so white ground, trees and roofs cost no extra draws per frame.
 * The renderer uses `overcast` to dim the scene (and hide sun shadows),
 * draws rain/snow in screen space with draw(), and adds lightning `flash`.
 * ----------------------------------------------------------------------------
 */

import { mix } from './draw.js';
import { SEASONS, SEASON_NAMES, seasonOf } from '../sim/time.js';

export { SEASONS, SEASON_NAMES, seasonOf };

/** The four looks (winter, spring, summer, autumn); MONTH_LOOK places each month among them. */
const LOOKS = [
  { // winter
    grass: '#7b935d', meadow: '#9fa16d', forest: '#667f4c', sand: '#d2c092',
    // Many Mediterranean trees are evergreen: a third stand bare, the rest go dark and dull.
    leaves: ['#4f6a40', '#65704a', '#465f3b', '#6d7452'], bare: 0.35, blossom: 0, flowers: 0.08,
  },
  { // spring
    grass: '#7ca94e', meadow: '#a3b65a', forest: '#6a9a45', sand: '#d8c38e',
    leaves: ['#4f903a', '#60a246', '#46833a', '#6aa950'], bare: 0, blossom: 0.4, flowers: 1.7,
  },
  { // summer (the original colors)
    grass: '#7ea34d', meadow: '#a7ad55', forest: '#6f9644', sand: '#d8c38e',
    leaves: ['#3e7a34', '#4b8a3a', '#356b2e', '#58914a'], bare: 0, blossom: 0, flowers: 1,
  },
  { // autumn
    grass: '#8b9a4f', meadow: '#b1a457', forest: '#7a8946', sand: '#d8c38e',
    leaves: ['#c47a2e', '#d4a23c', '#a8532f', '#6f8a3c'], bare: 0.12, blossom: 0, flowers: 0.25,
  },
];

/**
 * Where each month sits among the looks: 0 winter, 1 spring, 2 summer,
 * 3 autumn (3.5 = half way from autumn back to winter). Every month that
 * seasonOf() calls winter is pure winter, so snow always falls on winter
 * scenery; the blending happens in the shoulder months. Months with the
 * same look share one palette (and one set of sprites).
 */
export const MONTH_LOOK = Object.freeze([0, 0, 0.5, 1, 1.5, 2, 2, 2.35, 2.7, 3, 3.5, 0]);

/** Snow cover levels drawn (0 = none .. SNOW_LEVELS = deep) and how white each makes the ground. */
export const SNOW_LEVELS = 3;
const SNOW_AMOUNT = [0, 0.4, 0.7, 0.9];

const paletteCache = new Map();

/**
 * Ground and tree colors for a month (0..11). `key` is short and stable, for
 * sprite cache keys. Pass month = null for the plain summer look (seasons off).
 * `snow` is the snow cover level 0..SNOW_LEVELS (ignored with seasons off);
 * it becomes `pal.snow` (0..1, how white the ground is) and part of the key.
 */
export function seasonPalette(month, snow = 0) {
  const off = month === null || month === undefined;
  const m = off ? 6 : ((Math.round(month) % 12) + 12) % 12;
  const pos = off ? 2 : MONTH_LOOK[m];
  const lvl = off ? 0 : Math.max(0, Math.min(SNOW_LEVELS, Math.round(snow) || 0));
  const key = (off ? 's' : `p${Math.round(pos * 20)}`) + (lvl ? `n${lvl}` : '');
  const season = seasonOf(m);
  const ck = `${key}|${season}`;
  let p = paletteCache.get(ck);
  if (p) return p;
  const i = Math.floor(pos) % 4; // look before this month
  const f = pos - Math.floor(pos); // how far toward the next look
  const a = LOOKS[i];
  const b = LOOKS[(i + 1) % 4];
  p = Object.freeze({
    key,
    season,
    grass: mix(a.grass, b.grass, f),
    meadow: mix(a.meadow, b.meadow, f),
    forest: mix(a.forest, b.forest, f),
    sand: mix(a.sand, b.sand, f),
    leaves: a.leaves.map((c, k) => mix(c, b.leaves[k], f)),
    bare: a.bare + (b.bare - a.bare) * f,
    blossom: a.blossom + (b.blossom - a.blossom) * f,
    flowers: a.flowers + (b.flowers - a.flowers) * f,
    snowLevel: lvl,
    snow: SNOW_AMOUNT[lvl],
  });
  paletteCache.set(ck, p);
  return p;
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

/** Target levels for each kind of weather. */
export const WEATHER = Object.freeze({
  clear: { overcast: 0, rain: 0, snow: 0, storm: false, label: 'Clear' },
  cloudy: { overcast: 0.5, rain: 0, snow: 0, storm: false, label: 'Cloudy' },
  rain: { overcast: 0.8, rain: 0.75, snow: 0, storm: false, label: 'Rain' },
  storm: { overcast: 1, rain: 1, snow: 0, storm: true, label: 'Thunderstorm' },
  snow: { overcast: 0.65, rain: 0, snow: 0.85, storm: false, label: 'Snow' },
});

/**
 * Odds of what comes next, by season (weights). Spring is the rainy season,
 * summer is mostly clear with the odd thunderstorm, autumn is cool with some
 * rain, and in winter every shower falls as snow.
 */
export const ODDS = Object.freeze({
  winter: { clear: 3, cloudy: 3, snow: 4 },
  spring: { clear: 3.5, cloudy: 2.5, rain: 3.5, storm: 0.5 },
  summer: { clear: 8, cloudy: 1.5, rain: 0.3, storm: 0.7 },
  autumn: { clear: 4.5, cloudy: 3, rain: 2, storm: 0.5 },
});

/**
 * The kind of weather a season allows: in winter rain and thunderstorms fall
 * as snow, and snow only falls in winter (it melts into rain in spring).
 */
export function seasonalKind(kind, season) {
  if (season === 'winter') return kind === 'rain' || kind === 'storm' ? 'snow' : kind;
  return kind === 'snow' ? 'rain' : kind;
}

/**
 * Seconds (of running game time at any speed) a weather spell lasts. A season
 * is 80 s (3 months of 16 days of 20 ticks at 12 ticks/s): two or three spells.
 */
const SPELL = [20, 45];
/** Weather forced from the console holds this long (seconds), unless the season turns. */
const FORCE_HOLD = 60;
/** A new or loaded game opens with clear skies for this long (seconds). */
const OPENING = [12, 25];
/** How fast levels move toward the target (per second). */
const EASE = 0.25;
/**
 * Snow cover, per second of game time (a game day is 1.67 s): it settles
 * while it snows (full after about 6 days of steady snow) and melts slowly
 * in winter, fast once spring comes, faster still in the rain.
 */
const COVER = Object.freeze({ build: 0.18, meltWinter: 0.03, meltWarm: 0.15, meltRain: 0.12, stillSnowing: 0.3 });
/** Cover at which each snow level starts (levels 1..3), and the hysteresis on the way down. */
export const SNOW_STEPS = Object.freeze([0.12, 0.45, 0.8]);
const STEP_HYST = 0.04;

/**
 * Quantize snow cover to a drawn level. Going down needs the cover a little
 * below the step, so a level never flickers back and forth.
 */
export function coverLevelOf(cover, prev = 0) {
  let lvl = 0;
  while (lvl < SNOW_STEPS.length && cover >= SNOW_STEPS[lvl]) lvl++;
  if (lvl < prev && cover >= SNOW_STEPS[prev - 1] - STEP_HYST) return prev;
  return lvl;
}

/** Falling snow: CSS px of screen per flake at full snow, and the flakes' colour. */
export const FLAKE_AREA = 4000;
export const FLAKE_COLOR = 'rgba(250,252,255,0.5)'; // half see-through: 0.8 still hid the city (playtest)

export class Weather {
  /** @param {() => number} [random] */
  constructor(random = Math.random) {
    this.random = random;
    this.onThunder = null; // callback(delaySeconds) when lightning strikes
    this.drops = []; // rain streaks (screen px)
    this.flakes = []; // snowflakes (screen px)
    this.reset();
  }

  /**
   * Clear skies for a new or loaded game (Renderer.attach): a short clear
   * opening, then the game's own season decides. Forgets the last game's
   * season, so a game that starts in another season than the menu city does
   * not draw its first weather at once.
   */
  reset() {
    this.kind = 'clear';
    this.timer = OPENING[0] + this.random() * (OPENING[1] - OPENING[0]);
    this.overcast = 0;
    this.rain = 0;
    this.snow = 0;
    this.flash = 0; // lightning brightness 0..1
    this.boltTimer = 6;
    this.secondBolt = -1;
    this.drops.length = 0;
    this.flakes.length = 0;
    this.splashes = [];
    this.fillNow = false; // next draw: fill the sky at once instead of building up
    this.season = null; // season of the last update (a new season draws new weather)
    this.clearCover(); // a new city starts without snow on the ground
  }

  /** Drop all snow cover at once (weather switched off, a new game). */
  clearCover() {
    this.cover = 0; // snow lying on the ground 0..1 (render only, not saved)
    this.coverLevel = 0; // cover quantized for the art: 0..SNOW_LEVELS
  }

  /** Pick the next weather for a season. */
  pick(season) {
    const odds = ODDS[season] || ODDS.summer;
    let total = 0;
    for (const k in odds) total += odds[k];
    let r = this.random() * total;
    for (const k in odds) {
      r -= odds[k];
      if (r <= 0) return k;
    }
    return 'clear';
  }

  /** Switch to a kind of weather now (console, tests). `instant` skips the ease. */
  force(kind, instant = false) {
    if (!WEATHER[kind]) return false;
    this.kind = kind;
    this.timer = FORCE_HOLD;
    if (instant) {
      const w = WEATHER[kind];
      this.overcast = w.overcast;
      this.rain = w.rain;
      this.snow = w.snow;
      this.fillNow = true;
    }
    return true;
  }

  /**
   * Advance the weather.
   * @param {number} dt      seconds of running game time (0 while paused)
   * @param {string} season  current season name
   */
  update(dt, season) {
    // The season rules hold on every frame, paused or not (a Seasons toggle
    // or a console command while paused must not leave rain in winter).
    // A new season brings new weather at once (a spell is about as long as a
    // season, so otherwise one season's weather would run on into the next).
    if (season !== this.season) {
      if (this.season !== null) this.timer = 0;
      this.season = season;
    }
    // Winter turns rain and storms into snow; snow melts into rain when winter
    // ends (this also fits weather forced from the console to the season).
    this.kind = seasonalKind(this.kind, season);
    // Only snow in winter and never snow outside it: when the season turns,
    // the other kind stops at once, so rain and snow never fall together.
    if (season === 'winter') this.rain = 0;
    else this.snow = 0;
    if (dt <= 0) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = SPELL[0] + this.random() * (SPELL[1] - SPELL[0]);
      this.kind = seasonalKind(this.pick(season), season);
    }
    const w = WEATHER[this.kind];
    const step = Math.min(1, dt * EASE);
    this.overcast += (w.overcast - this.overcast) * step;
    this.rain += (w.rain - this.rain) * step;
    this.snow += (w.snow - this.snow) * step;
    if (this.rain < 0.005 && w.rain === 0) this.rain = 0;
    if (this.snow < 0.005 && w.snow === 0) this.snow = 0;
    // Snow cover builds while it snows and melts after.
    // (It starts to melt as soon as the snowfall thins out.)
    const melt = this.snow > COVER.stillSnowing ? 0 : (season === 'winter' ? COVER.meltWinter : COVER.meltWarm) + COVER.meltRain * this.rain;
    this.cover = Math.max(0, Math.min(1, this.cover + dt * (COVER.build * this.snow - melt)));
    this.coverLevel = coverLevelOf(this.cover, this.coverLevel);
    // Lightning: a flash (sometimes two) every few seconds in a storm.
    this.flash = Math.max(0, this.flash - dt * 4);
    if (this.secondBolt >= 0) {
      this.secondBolt -= dt;
      if (this.secondBolt < 0) this.flash = Math.max(this.flash, 0.7);
    }
    if (w.storm && this.rain > 0.6) {
      this.boltTimer -= dt;
      if (this.boltTimer <= 0) {
        this.boltTimer = 5 + this.random() * 11;
        this.flash = 1;
        if (this.random() < 0.4) this.secondBolt = 0.14;
        if (this.onThunder) this.onThunder(0.4 + this.random() * 1.2);
      }
    }
  }

  /**
   * Multiply tint for clouds and rain (rgb 0..255), applied with the sky's.
   * Overcast dims the scene and cools it a little.
   */
  tint() {
    const o = this.overcast;
    return [255 * (1 - 0.34 * o), 255 * (1 - 0.3 * o), 255 * (1 - 0.2 * o)];
  }

  /**
   * Animate and draw rain and snow over the whole screen.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} W,H  canvas size (device px)
   * @param {number} dpr  device pixel ratio (sizes are in CSS px)
   * @param {number} dt   seconds since the last frame (animation keeps going while paused)
   * @param {number} time seconds, for snow sway
   */
  draw(ctx, W, H, dpr, dt, time) {
    const area = (W * H) / (dpr * dpr);
    this.updateDrops(this.drops, Math.round((this.rain * area) / 2400), () => this.newDrop(W, H, dpr, true));
    // A flake per 4,000 CSS px at full snow, and a little see-through: one
    // per 3,000 at 0.9 read as a blizzard over the city (playtest, v0.15.2).
    this.updateDrops(this.flakes, Math.round((this.snow * area) / FLAKE_AREA), () => this.newFlake(W, H, dpr, true));
    this.fillNow = false;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.drops.length) {
      ctx.strokeStyle = 'rgba(205,218,235,0.5)';
      ctx.lineWidth = Math.max(1, dpr * 0.9);
      ctx.beginPath();
      for (const d of this.drops) {
        d.y += d.vy * dt;
        d.x += d.vx * dt;
        if (d.y - d.len > H || d.x > W + 20) Object.assign(d, this.newDrop(W, H, dpr, false));
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.vx * 0.022, d.y - d.len);
      }
      ctx.stroke();
      // Little splashes where drops hit the ground.
      const want = this.rain * 70 * dt * (area / 1e6);
      for (let n = want + this.random(); n >= 1; n--) this.splashes.push({ x: this.random() * W, y: this.random() * H, t: 0 });
      ctx.strokeStyle = 'rgba(215,228,240,0.5)';
      ctx.lineWidth = Math.max(1, dpr * 0.8);
      ctx.beginPath();
      for (const s of this.splashes) {
        s.t += dt;
        const r = (1 + s.t * 14) * dpr;
        ctx.moveTo(s.x + r, s.y);
        ctx.ellipse(s.x, s.y, r, r * 0.4, 0, 0, Math.PI * 2);
      }
      ctx.stroke();
      this.splashes = this.splashes.filter((s) => s.t < 0.22);
    } else if (this.splashes.length) {
      this.splashes = [];
    }
    if (this.flakes.length) {
      ctx.fillStyle = FLAKE_COLOR;
      ctx.beginPath();
      for (const f of this.flakes) {
        f.y += f.vy * dt;
        const x = f.x + Math.sin(time * f.wob + f.phase) * 10 * dpr;
        if (f.y - f.r > H) Object.assign(f, this.newFlake(W, H, dpr, false));
        ctx.moveTo(x + f.r, f.y);
        ctx.arc(x, f.y, f.r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    if (this.flash > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(200,210,255,${(0.26 * this.flash).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  /** Grow or shrink a particle list toward `target` entries. */
  updateDrops(list, target, make) {
    if (list.length > target) list.length = target;
    // Add a few per frame so a shower builds up instead of appearing at once.
    for (let n = Math.min(target - list.length, this.fillNow ? Infinity : 40); n > 0; n--) list.push(make());
  }

  newDrop(W, H, dpr, anywhere) {
    const vy = (700 + this.random() * 350) * dpr;
    return {
      x: this.random() * (W + 200) - 200,
      y: anywhere ? this.random() * H : -this.random() * H * 0.3,
      vy,
      vx: vy * 0.22,
      len: (9 + this.random() * 8) * dpr,
    };
  }

  newFlake(W, H, dpr, anywhere) {
    return {
      x: this.random() * W,
      y: anywhere ? this.random() * H : -this.random() * H * 0.2 - 4,
      vy: (28 + this.random() * 40) * dpr,
      r: (0.9 + this.random() * 1.6) * dpr,
      wob: 0.8 + this.random() * 1.4,
      phase: this.random() * 6.28,
    };
  }
}

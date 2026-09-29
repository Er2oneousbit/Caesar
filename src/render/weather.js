/**
 * weather.js
 * ----------------------------------------------------------------------------
 * Seasons and weather. Purely visual: nothing here touches the simulation,
 * so it may use Math.random() freely (tests can pass their own random).
 *
 * SEASONS follow the game calendar (month 0 = Ianuarius). seasonPalette()
 * blends four mid-season looks month by month, so each month shifts the
 * colors a little instead of the map changing all at once:
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
 * The renderer uses `overcast` to dim the scene (and hide sun shadows),
 * draws rain/snow in screen space with draw(), and adds lightning `flash`.
 * ----------------------------------------------------------------------------
 */

import { mix } from './draw.js';

export const SEASONS = Object.freeze(['winter', 'spring', 'summer', 'autumn']);

/** Season name for a month (Dec-Feb winter, Mar-May spring, ...). */
export function seasonOf(month) {
  return SEASONS[Math.floor((((month + 1) % 12) + 12) % 12 / 3)];
}

/** Mid-season looks (Ian, Apr, Iul, Oct); months in between blend. */
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

const paletteCache = new Map();

/**
 * Ground and tree colors for a month (0..11). `key` is short and stable, for
 * sprite cache keys. Pass month = null for the plain summer look (seasons off).
 */
export function seasonPalette(month) {
  const m = month === null || month === undefined ? 6 : ((Math.round(month) % 12) + 12) % 12;
  const key = month === null || month === undefined ? 's' : String(m);
  let p = paletteCache.get(key);
  if (p) return p;
  const i = Math.floor(m / 3); // look before this month
  const f = (m - i * 3) / 3; // how far toward the next look
  const a = LOOKS[i];
  const b = LOOKS[(i + 1) % 4];
  p = Object.freeze({
    key,
    season: seasonOf(m),
    grass: mix(a.grass, b.grass, f),
    meadow: mix(a.meadow, b.meadow, f),
    forest: mix(a.forest, b.forest, f),
    sand: mix(a.sand, b.sand, f),
    leaves: a.leaves.map((c, k) => mix(c, b.leaves[k], f)),
    bare: a.bare + (b.bare - a.bare) * f,
    blossom: a.blossom + (b.blossom - a.blossom) * f,
    flowers: a.flowers + (b.flowers - a.flowers) * f,
  });
  paletteCache.set(key, p);
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

/** Odds of what comes next, by season (weights). */
const ODDS = {
  winter: { clear: 3, cloudy: 3, rain: 2, snow: 2 },
  spring: { clear: 5, cloudy: 2.5, rain: 2, storm: 0.5 },
  summer: { clear: 7, cloudy: 1.5, rain: 0.5, storm: 1 },
  autumn: { clear: 4, cloudy: 3, rain: 2.5, storm: 0.5 },
};

/** Seconds (of running game time at any speed) a weather spell lasts. */
const SPELL = [35, 110];
/** How fast levels move toward the target (per second). */
const EASE = 0.25;

export class Weather {
  /** @param {() => number} [random] */
  constructor(random = Math.random) {
    this.random = random;
    this.kind = 'clear';
    this.timer = SPELL[0] + random() * (SPELL[1] - SPELL[0]);
    this.overcast = 0;
    this.rain = 0;
    this.snow = 0;
    this.flash = 0; // lightning brightness 0..1
    this.boltTimer = 6;
    this.secondBolt = -1;
    this.onThunder = null; // callback(delaySeconds) when lightning strikes
    this.drops = []; // rain streaks (screen px)
    this.flakes = []; // snowflakes (screen px)
    this.splashes = [];
    this.fillNow = false; // next draw: fill the sky at once instead of building up
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
    this.timer = SPELL[1];
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
    if (dt <= 0) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = SPELL[0] + this.random() * (SPELL[1] - SPELL[0]);
      let next = this.pick(season);
      if (next === 'snow' && season !== 'winter') next = 'rain';
      this.kind = next;
    }
    // Snow melts into rain when winter ends.
    if (this.kind === 'snow' && season !== 'winter') this.kind = 'rain';
    const w = WEATHER[this.kind];
    const step = Math.min(1, dt * EASE);
    this.overcast += (w.overcast - this.overcast) * step;
    // One kind of precipitation at a time: when rain follows snow (or snow
    // follows rain), the old one tapers off 3x faster and the new one only
    // starts once it has stopped, so rain never falls through the snow.
    let rainTarget = w.rain;
    let snowTarget = w.snow;
    let rainStep = step;
    let snowStep = step;
    if (rainTarget > 0 && this.snow > 0) { rainTarget = 0; snowStep = Math.min(1, dt * EASE * 3); }
    if (snowTarget > 0 && this.rain > 0) { snowTarget = 0; rainStep = Math.min(1, dt * EASE * 3); }
    this.rain += (rainTarget - this.rain) * rainStep;
    this.snow += (snowTarget - this.snow) * snowStep;
    if (this.rain < 0.005 && rainTarget === 0) this.rain = 0;
    if (this.snow < 0.005 && snowTarget === 0) this.snow = 0;
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
    this.updateDrops(this.flakes, Math.round((this.snow * area) / 3000), () => this.newFlake(W, H, dpr, true));
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
      ctx.fillStyle = 'rgba(250,252,255,0.9)';
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

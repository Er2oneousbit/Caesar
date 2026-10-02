/**
 * renderer.js
 * ----------------------------------------------------------------------------
 * Draws the city every frame.
 *
 * Passes:
 *   1. Ground: terrain tiles, shorelines, roads, plazas, bridges, rubble and
 *      overlay tints. Flat things never overlap each other, so order is free.
 *   2. Objects: trees, rocks, aqueducts, walls, buildings, walkers, soldiers,
 *      raiders, ships of war, missiles, rally flags, flames, overlay columns. Sorted
 *      back-to-front by "depth" (x + y of their front point).
 *
 * Multi-tile buildings are drawn as vertical strips half a tile wide. Each
 * strip is sorted by the front-most footprint tile it covers. This is the
 * classic trick that lets walkers pass correctly in front of and behind
 * big buildings with a simple depth sort.
 *
 *   3. Tool previews (ghost building, green/red tiles), hover and selection.
 *      A building placed where no road would touch it is drawn in the
 *      warning color, with the edge tiles where a road would serve it
 *      picked out. Just before this pass, a red "no road" sign floats over
 *      every building that has no road to use (drawn over the night and the
 *      weather, at a size that stays readable when zoomed far out).
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
 *
 * The world around the city (all optional, see Settings):
 *   - day and night (lighting.js, `dayNightOn`): the scene is tinted by the
 *     time of day, and after dusk windows, torches, lanterns and fires light
 *     it up. Drawn after the particles, before tool previews, so previews
 *     and selection outlines always stay easy to read.
 *   - seasons (weather.js, `seasonsOn`): ground and tree colors follow the
 *     month; last month's sprites are dropped as the month turns.
 *   - weather (weather.js, `weatherOn`): overcast dims the scene and hides
 *     sun shadows; rain, snow and lightning are drawn over the world.
 * Where two kinds of ground meet, blend sprites soften the edge (the codes
 * are cached per tile until the map changes).
 * ----------------------------------------------------------------------------
 */

import { CONFIG, HALF_W, HALF_H } from '../config.js';
import { Terrain, Road, WaterBits } from '../world/map.js';
import { BUILDINGS } from '../data/buildings.js';
import { UNIT_TYPES } from '../data/units.js';
import { wallHpOf, TOWER_RANGE } from '../sim/military.js';
import { waterOf, shoreBerth } from '../sim/navy.js';
import { farmDormant } from '../sim/production.js';
import { wallSpec, drawUnit, drawProjectile, drawRallyFlag } from './militaryArt.js';
import { Camera, tileOfWorld } from './camera.js';
import { SpriteCache } from './sprites.js';
import { groundTileSpec, groundBlendSpec, waterTileSpec, shoreSpec, roadSpec, plazaSpec, bridgeSpec, rubbleSpec, treesSpec, rocksSpec, aqueductSpec, BLEND_RANK, roadblockSpec } from './terrainArt.js';
import { buildingSpec, artState, drawWarehouseStock, drawGranaryStock, shadowLength, flagsFor, templeAltar } from './buildingArt.js';
import { drawFlag, drawShoppers, drawCrowd, drawAltarFlame, drawMapGate, GATE_H, drawNoRoadSign, NO_ROAD_SIGN_R } from './liveArt.js';
import { lacksRoad, accessEdgeTiles } from '../sim/roadAccess.js';
import { drawWalker, drawChariot } from './walkerArt.js';
import { isWagon } from './cargoArt.js';
import { drawGulls } from './waterArt.js';
import { Effects, drawFlames, drawSpray, drawGlint } from './effects.js';
import { Ambient } from './ambient.js';
import { NightLights, NOON, skyAt, dayTime, lightsOf, isLit } from './lighting.js';
import { Weather, seasonPalette } from './weather.js';
import { hash01 } from './draw.js';
import { overlayByKey, columnColor } from './overlays.js';

/** A fort's or naval station's color: its rally standard and the ghost one while deploying. */
function forceColor(b) {
  if (b.def.kind === 'station') return UNIT_TYPES.liburnian.color;
  return UNIT_TYPES[b.def.unit]?.color || '#a8322b';
}

const K_STRIP = 0;
const K_WALKER = 1;
const K_FIRE = 2;
const K_COLUMN = 3;
const K_EXTRA = 4;
const K_UNIT = 5;
const K_PROJ = 6;
const K_FLAG = 7;
const K_GATE = 8; // the gateway at the map entrance / exit

/** The build ghost on a spot with no road it could use: the warning color. */
const NO_ROAD_FILL = 'rgba(245,140,30,0.55)';
const NO_ROAD_TINT = 'rgba(255,120,20,0.42)';
/** Edge tiles where a road would serve the building being placed. */
const ROAD_EDGE_FILL = 'rgba(255,226,120,0.34)';
const ROAD_EDGE_LINE = 'rgba(255,214,80,0.95)';

/**
 * A sprite spec drawn as `spec` and then washed over in `color`, only where
 * the art itself drew (the ghost of a building with no road in reach).
 */
export function tintedSpec(spec, color) {
  return {
    ...spec,
    draw(ctx) {
      spec.draw(ctx);
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = color;
      ctx.fillRect(-spec.ax, -spec.ay, spec.w, spec.h);
      ctx.restore();
    },
  };
}

/**
 * Where a map gate's pillars stand: the world offset (px) from the road tile's
 * center to one pillar, across the road (the other pillar mirrors it). The
 * gate faces the way the Imperial road was laid (`dir`, recorded by mapgen),
 * so a road the player builds beside the edge tile never turns it. Without
 * it (old saves, or that road removed): the road going into the map, then
 * any road beside the tile, then the middle of the map.
 */
export function mapGateOffset(map, end, dir = null) {
  let dx = 0;
  let dy = 0;
  const inward = end.x === 0 ? [1, 0] : end.x === map.w - 1 ? [-1, 0] : end.y === 0 ? [0, 1] : end.y === map.h - 1 ? [0, -1] : null;
  const tries = [dir, inward, [1, 0], [-1, 0], [0, 1], [0, -1]];
  const hit = tries.find((t) => t && map.hasRoad(end.x + t[0], end.y + t[1]));
  if (hit) [dx, dy] = hit;
  if (!dx && !dy) { // no road beside it (should not happen): face the middle of the map
    if (Math.abs(map.w / 2 - end.x) > Math.abs(map.h / 2 - end.y)) dx = Math.sign(map.w / 2 - end.x) || 1;
    else dy = Math.sign(map.h / 2 - end.y) || 1;
  }
  const a = -dy; // across the road, in tiles
  const b = dx;
  const r = 0.46; // pillars stand inside the tile, just off the road
  return { ox: (a - b) * HALF_W * r, oy: (a + b) * HALF_H * r };
}

/**
 * Where a temple's live altar flame goes, in world px at zoom 1 from the
 * building's anchor: on the altar templeArt draws (templeAltar), its fire
 * about 5 px up. (It was once placed at the front left, where the god's own
 * piece stands since each god got its look, so it burned over a herm or a
 * rose bush.)
 */
export function altarFlameOffset(S) {
  const [u, v] = templeAltar(S);
  return [(u - v) * HALF_W, (u + v) * HALF_H - 5];
}

/**
 * One step of a look change (a season palette, or a snow level): the look is
 * `cur`, `prev` the complete look still drawn while `cur` is prepared (null
 * when no change is in progress) and `next` the look that just became due.
 * Returns the look to keep drawing meanwhile and the looks whose sprites can
 * go. The complete old look always stays the stand-in: when changes overlap
 * (snow 0 -> 1 -> 2 a few frames apart) the half-made middle look is dropped,
 * and a change back to `prev` simply ends the change.
 * `hard` (a new or loaded game) switches at once and keeps no stand-in.
 * @returns {{prev: string|null, drop: string[]}}
 */
export function lookStep(cur, prev, next, hard = false) {
  if (hard) return { prev: null, drop: prev !== null && prev !== next ? [prev, cur] : [cur] };
  if (prev !== null) return { prev: prev === next ? null : prev, drop: [cur] };
  return { prev: cur, drop: [] };
}

/**
 * A building sprite's cache key (before the snow suffix, `~n{level}`, which
 * must stay last so a look change can drop sprites by suffix). A sick home
 * (sim/disease.js) is drawn with a sign of its own, so it has a key of its
 * own: `:sick`, after the art state.
 */
export function buildingKey(b, variant, state) {
  const sick = b.house && b.house.pop > 0 && b.house.sick > 0;
  return `b:${b.type}:${b.size}:${variant}:${state}${sick ? ':sick' : ''}`;
}

/**
 * Aqueduct connections of tile (x, y), bits 1=N 2=E 4=S 8=W: other aqueducts
 * or reservoirs; the same bits shifted up 4 mark the reservoirs (the channel
 * steps down to their rim, see aqueductSpec).
 */
export function aqueductMaskAt(map, buildings, x, y) {
  const what = (tx, ty) => {
    if (!map.inBounds(tx, ty)) return 0;
    const i = map.idx(tx, ty);
    if (map.aqueduct[i]) return 1;
    const b = buildings.get(map.building[i]);
    return b && b.def.kind === 'reservoir' ? 2 : 0;
  };
  let mask = 0;
  [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([dx, dy], k) => {
    const w = what(x + dx, y + dy);
    if (w) mask |= 1 << k;
    if (w === 2) mask |= 16 << k;
  });
  return mask;
}

/** Pennant colors of the map gates: where people arrive, and where they leave. */
const ENTRY_COLOR = '#3f9a3a';
const EXIT_COLOR = '#b8322b';

/**
 * Water buildings that supply an area: every tile within `r` of the footprint
 * (a square, exactly what sim/water.js marks), and the water-layer bit that
 * shows where buildings of that kind supply water right now.
 */
/** Radius colors: the building being placed or selected (dark) vs. existing coverage (pale). */
const RADIUS_STRONG = Object.freeze({ fill: 'rgba(28,96,214,0.36)', edge: 'rgba(16,64,170,0.95)' });
const RADIUS_PALE = Object.freeze({ fill: 'rgba(150,208,255,0.28)', edge: 'rgba(84,160,240,0.95)' });
/**
 * The reservoirs' piped area in teal, not blue: placing a fountain shows the
 * piped area under the existing fountains' reach, and in the same pale blue
 * the two ran together, so a player could not see where fountains already
 * gave water (found in a playtest of mission 2).
 */
const PIPED_STRONG = Object.freeze({ fill: 'rgba(16,150,128,0.34)', edge: 'rgba(8,110,92,0.95)' });
const PIPED_PALE = Object.freeze({ fill: 'rgba(110,220,190,0.26)', edge: 'rgba(60,180,150,0.8)' });
/**
 * Water hints under a tool: the palest blue for well water, a clear blue
 * for fountain water, teal for pipes. The fountain hint is drawn over roofs
 * and paving, and at 0.24 fill with a thin, half-clear edge it vanished over
 * a housing block (mission 2 playtest): it now has a full-strength edge two
 * pixels wide, as a clicked fountain's own area has.
 */
const HINT_FAINT = Object.freeze({ fill: 'rgba(150,208,255,0.15)', edge: 'rgba(120,186,250,0.45)' });
const HINT_FOUNTAIN = Object.freeze({ fill: 'rgba(60,132,236,0.3)', edge: 'rgba(28,92,210,0.95)', width: 2 });
const HINT_PIPED = Object.freeze({ fill: 'rgba(110,220,190,0.16)', edge: 'rgba(60,180,150,0.5)' });
const BLUE = Object.freeze({ strong: RADIUS_STRONG, pale: RADIUS_PALE });
const TEAL = Object.freeze({ strong: PIPED_STRONG, pale: PIPED_PALE });

const WATER_AREA = Object.freeze({
  well: { r: CONFIG.WELL_RADIUS, bit: WaterBits.WELL, colors: BLUE },
  fountain: { r: CONFIG.FOUNTAIN_RADIUS, bit: WaterBits.FOUNTAIN, colors: BLUE },
  reservoir: { r: CONFIG.RESERVOIR_RADIUS, bit: WaterBits.PIPED, colors: TEAL },
});

/**
 * Water already there, tinted faintly while a tool is in hand (the original
 * did this for housing): the layers to show, weakest first. Housing plots
 * show where homes would get water (well water pale, fountain water a
 * stronger blue); buildings that need piped water (fountains, baths) show
 * the reservoirs' piped area, where they would run, and a fountain also
 * the water the fountains already give, so a new one can be set where it is
 * needed (with the cursor off the map there was nothing else to show it).
 * Wells and reservoirs already show their own coverage while being placed.
 * @returns {Array<{key:string, bit:number, style:{fill:string, edge:string}}>}
 */
export function waterHintLayers(tool) {
  if (tool === 'house') {
    return [
      { key: 'well', bit: WaterBits.WELL, style: HINT_FAINT },
      { key: 'fountain', bit: WaterBits.FOUNTAIN, style: HINT_FOUNTAIN },
    ];
  }
  const def = BUILDINGS[tool];
  if (!def || !def.needsPiped) return [];
  const piped = { key: 'piped', bit: WaterBits.PIPED, style: HINT_PIPED };
  if (def.kind === 'fountain') return [piped, { key: 'fountain', bit: WaterBits.FOUNTAIN, style: HINT_FOUNTAIN }];
  return [piped];
}

/**
 * Meadow under a farm tool: farms grow only on meadow (a farm's output
 * scales with the share of meadow under it), and in winter snow covers the
 * meadow's colour and flowers, so the land a farm could use was impossible
 * to tell from grass (mission 2 playtest). A green-gold tint with a clear
 * edge, drawn over the snow like the water hints.
 */
const HINT_MEADOW = Object.freeze({ fill: 'rgba(196,206,64,0.3)', edge: 'rgba(150,152,20,0.95)', width: 2 });

/** The meadow hint layer for a tool, or null: tools whose buildings are placed on meadow. */
export function meadowHintLayer(tool) {
  const def = BUILDINGS[tool];
  return def && def.placement === 'meadow' ? { key: 'meadow', style: HINT_MEADOW } : null;
}

/** The hint layer a tile's water bits fall in: the strongest that applies, or -1. */
export function waterHintOf(bits, layers) {
  for (let k = layers.length - 1; k >= 0; k--) if (bits & layers[k].bit) return k;
  return -1;
}

/** Does a market have anything on its stalls? */
function hasStock(b) {
  if (!b.stock) return false;
  for (const key in b.stock) if (b.stock[key] > 0) return true;
  return false;
}

/** Is a show on at this venue? (Same test as services.js: any booked performance.) */
function showOn(b) {
  const s = b.shows;
  return !!s && (s.theater > 0 || s.amphitheater > 0 || s.colosseum > 0);
}

/** Neighbour offsets: edges N E S W, then corners NE SE SW NW. */
const EDGE_NB = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const CORNER_NB = [[1, -1], [1, 1], [-1, 1], [-1, -1]];

/**
 * Which stronger ground borders tile (x, y), and on which edges/corners.
 * Only the strongest neighbouring type blends (two different ones at the
 * same tile are rare). @returns packed code, 0 = none.
 */
export function blendCode(map, x, y) {
  const own = BLEND_RANK[map.terrain[map.idx(x, y)]];
  if (!own) return 0; // water (shorelines have their own art)
  let best = -1;
  let bestRank = own;
  const look = (dx, dy) => {
    const tx = x + dx;
    const ty = y + dy;
    if (!map.inBounds(tx, ty)) return -1;
    return map.terrain[map.idx(tx, ty)];
  };
  for (const [dx, dy] of EDGE_NB.concat(CORNER_NB)) {
    const t = look(dx, dy);
    const r = BLEND_RANK[t] || 0;
    if (r > bestRank) { best = t; bestRank = r; }
  }
  if (best < 0) return 0;
  let edges = 0;
  for (let s = 0; s < 4; s++) if (look(EDGE_NB[s][0], EDGE_NB[s][1]) === best) edges |= 1 << s;
  let corners = 0;
  for (let c = 0; c < 4; c++) {
    // A corner only needs its own blob when neither edge next to it blends.
    const e1 = 1 << c; // NE touches N(0)+E(1), SE: E(1)+S(2), SW: S(2)+W(3), NW: W(3)+N(0)
    const e2 = 1 << ((c + 1) % 4);
    if (edges & (e1 | e2)) continue;
    if (look(CORNER_NB[c][0], CORNER_NB[c][1]) === best) corners |= 1 << c;
  }
  if (!edges && !corners) return 0;
  return (best << 8) | (edges << 4) | corners;
}

/**
 * Where a walker stands this frame: tile coordinates (fx, fy) and world
 * pixels (wx, wy) of its feet, part way to the next tile (alpha: 0..1 toward
 * the next sim tick).
 */
export function walkerWorld(w, alpha) {
  const p = w.moving ? Math.min(1, w.progress + alpha * w.speed) : 0;
  const fx = w.x + (w.tx - w.x) * p + 0.5;
  const fy = w.y + (w.ty - w.y) * p + 0.5;
  return { fx, fy, wx: (fx - fy) * HALF_W, wy: (fx + fy) * HALF_H };
}

/**
 * How far ahead of a carter (world px, at zoom 1) his cart reaches: a hand
 * cart's far end, or a farm wagon and its ox (walkerArt.js drawCart).
 */
export function cartReach(originDef) {
  return isWagon(originDef) ? 30 : 15;
}

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
    this.selectedWalker = 0; // walker shown in the info panel (ringed)
    this.selectedUnit = 0; // ship shown in the info panel (ringed)
    this.shipSpots = []; // where each warship and raider ship was drawn this frame, for clicks (pickShip)
    this.follow = null; // { id } of a walker the view follows (until the map is moved)
    this.walkerSpots = []; // where each walker was drawn this frame, for clicks (pickWalker)
    this.buildingBoxes = []; // footprint and height of each building drawn this frame (pickWalker)
    this.noRoadMarks = []; // buildings in view with no road to use, and their height (the red sign)
    this.noRoadSpots = []; // where those signs were drawn this frame (device px)
    this.deployFort = 0; // fort or naval station id while the player picks a deployment tile
    this.time = 0;
    this.frame = 0;
    this.stats = { tiles: 0, objects: 0, ms: 0, coverage: null, waterHint: null, noRoad: 0, ghostNoRoad: false, roadEdges: 0 };
    this.viewTiles = null; // visible tile range of the last frame {tx0, tx1, ty0, ty1}
    this.stripCache = new WeakMap();
    this.unsub = [];
    this.ambient = new Ambient();
    this.ambientOn = true; // clouds and birds (Settings: ambient effects)
    this.motionOn = true; // swaying trees, glints, construction animation (off with reduced motion)
    this.appear = new Map(); // building id -> time it was placed (rise-in animation)
    this.puffBudget = 0; // dust puffs allowed this frame (a demo city appears all at once)
    this.spriteBudgetMs = 8; // ms per frame for drawing new sprites before borrowing another zoom level's
    this.lookBudgetMs = 4; // the same while a new month or snow level is prepared (the old look shows meanwhile)
    // The world around the city (Settings).
    this.dayNightOn = true;
    this.seasonsOn = true;
    this.weatherOn = true;
    this.lights = new NightLights();
    this.weather = new Weather();
    this.sky = NOON; // light of the last frame (see lighting.js skyAt)
    this.pal = seasonPalette(null); // season palette of the last frame
    this.palPrev = null; // last palette's key while the new look is prepared (its sprites are still drawn)
    this.snowKey = ''; // snow suffix of building and rock sprite keys ('' = no snow)
    this.snowPrev = null; // last snow suffix while the new one is prepared
    this.lookHard = false; // next look change switches at once (set by attach)
    this.fixedTime = null; // set 0..1 to freeze the time of day (screenshots, console)
    this.lastTicks = 0; // sim ticks seen last frame (weather runs on game time)
    this.blendCodes = null; // per tile: packed edge-blend code, -1 = not computed yet
    this.blendRev = -1;
    this.gates = []; // wall gate tiles in view this frame (they get torches at night)
    this.mapGates = []; // map entrance/exit gateways in view this frame (torches too)
  }

  /** Point the renderer at a (new) game. */
  attach(game) {
    for (const u of this.unsub) u();
    this.unsub = [];
    this.game = game;
    this.walkerSpots = [];
    this.shipSpots = [];
    this.selectedUnit = 0;
    this.camera.setMapBounds(game.map.w, game.map.h);
    this.stripCache = new WeakMap();
    this.effects = new Effects();
    this.ambient.reset(game.map.w, game.map.h);
    this.appear.clear();
    this.blendCodes = null;
    this.lastTicks = game.time.totalTicks;
    this.weather.reset(); // a new or loaded game opens with clear skies (and no snow cover)
    // A new or loaded game switches look at once: preparing it behind the
    // last game's look would only delay the first picture of the new map.
    this.finishLookChange();
    this.lookHard = true;
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
    cam.smooth = this.motionOn;
    cam.update(dt);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#2a241c';
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);
    if (!game) return;
    if (this.follow) this.followWalker(alpha);
    const k = cam.scale;
    const env = this.updateEnvironment(dt);
    const pal = env.pal;
    // Sprites are drawn for the zoom LEVEL; while the zoom eases they are scaled a little.
    const changing = this.palPrev !== null || this.snowPrev !== null;
    this.sprites.beginFrame(cam.spriteScale, changing ? Math.min(this.spriteBudgetMs, this.lookBudgetMs) : this.spriteBudgetMs);
    const { map } = game;
    const ov = this.overlay;
    const overlayOn = ov.key !== 'none';
    const pp = this.palPrev; // last look, still drawn while the new one is prepared

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
    this.stats.waterHint = null;
    this.puffBudget = 4;
    this.gates.length = 0;
    const motion = this.motionOn;
    const glints = motion && cam.zoom >= 1 && env.sun > 0.5 && env.overcast < 0.5;
    const visibleBuildings = [];
    this.buildingBoxes = [];
    this.noRoadMarks = [];
    const waterFrame = Math.floor(this.time * 2.5) % 4;

    const items = [];
    const seenBuildings = new Set();
    let tiles = 0;

    const drawSpr = (spr, wx, wy) => this.blit(spr, wx, wy);

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
            const gv = map.variant[i] & 7;
            // Where a different kind of ground borders this tile, the sprite
            // has a soft edge painted in (one draw either way; see groundBlendSpec).
            const code = bid ? 0 : this.blendAt(i, x, y);
            if (code > 0) drawSpr(this.sprites.get(`g${terr}.${gv}.${code}~${pal.key}`, () => groundBlendSpec(terr, gv, code, pal), pp === null ? null : `g${terr}.${gv}.${code}~${pp}`), wx, wy);
            else drawSpr(this.sprites.get(`g${terr}.${gv}~${pal.key}`, () => groundTileSpec(terr, gv, pal), pp === null ? null : `g${terr}.${gv}~${pp}`), wx, wy);
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
          items.push({ d: depth - 0.01, kind: K_STRIP, spr: this.sprites.get(`t${tv}.${sway}~${pal.key}`, () => treesSpec(tv, sway, pal), pp === null ? null : `t${tv}.${sway}~${pp}`), wx, wy, full: true });
        } else if (terr === Terrain.ROCK) {
          items.push({ d: depth - 0.01, kind: K_STRIP, spr: this.sprites.get(`k${variant}${this.snowKey}`, () => rocksSpec(variant, pal.snow), this.snowPrev === null ? null : `k${variant}${this.snowPrev}`), wx, wy, full: true });
        }
        if (map.wall[i]) {
          const gate = map.wall[i] === 2;
          if (gate) this.gates.push(i);
          let mask = this.wallMask(x, y);
          // A gate with no wall beside it spans across its road.
          if (gate && !mask) mask = map.hasRoad(x, y - 1) || map.hasRoad(x, y + 1) ? 10 : 5;
          const hp = wallHpOf(game, i);
          const damaged = hp.hp < hp.max * 0.5;
          items.push({ d: depth, kind: K_STRIP, spr: this.sprites.get(`wl${mask}.${gate ? 1 : 0}.${damaged ? 1 : 0}`, () => wallSpec(mask, gate, damaged)), wx, wy, full: true });
        }
        if (map.roadblock[i]) {
          const axis = map.hasRoad(x + 1, y) || map.hasRoad(x - 1, y) ? 'u' : 'v';
          items.push({ d: depth, kind: K_STRIP, spr: this.sprites.get(`rbk${axis}`, () => roadblockSpec(axis)), wx, wy, full: true });
        }
        if (map.aqueduct[i]) {
          const mask = this.aqueductMask(x, y);
          const filled = map.aqueduct[i] === 2;
          const overRoad = map.road[i] ? 1 : 0; // a bridge over the road
          items.push({ d: depth, kind: K_STRIP, spr: this.sprites.get(`aq${mask}.${filled ? 1 : 0}.${overRoad}`, () => aqueductSpec(mask, filled, !!overRoad)), wx, wy, full: true });
        }
        if (game.fires.size && game.fires.has(i)) {
          items.push({ d: depth + 0.002, kind: K_FIRE, wx, wy: wy + HALF_H, seed: i });
          if (Math.random() < dt * 2) this.effects.smoke(wx, wy - 4, true);
        }
      }
    }

    // --- building shadows (on the ground, under every object) --------------
    // Sun shadows fade at night and under a cloudy sky.
    const shadowA = env.sun * (1 - env.overcast * 0.75);
    if (!overlayOn && shadowA > 0.03) for (const b of visibleBuildings) this.drawBuildingShadow(b, shadowA);

    // --- walkers ------------------------------------------------------------
    this.walkerSpots = [];
    for (const w of game.walkers.values()) {
      if (overlayOn && ov.walkers && !ov.walkers.includes(w.type)) continue;
      const { fx, fy, wx, wy } = walkerWorld(w, alpha);
      if (wx < x0w || wx > x1w || wy < y0w || wy > vr.y + vr.h + 30) continue;
      const ddx = (w.tx - w.x) - (w.ty - w.y);
      const ddy = (w.tx - w.x) + (w.ty - w.y);
      const stride = w.walked + (w.moving ? alpha * w.speed : 0); // tiles walked, for the leg animation
      // A cart's look depends on who sent it (a farm's wagon, a warehouse's single lot).
      const origin = w.type === 'cart' ? game.buildings.get(w.origin)?.def || null : null;
      const dirX = ddx === 0 ? (w.lastDir === 1 || w.lastDir === 0 ? 1 : -1) : Math.sign(ddx);
      // A carter's cart (and a wagon's ox) is drawn ahead of him and is most
      // of what the eye sees: clicks on it pick the carter (cartReach).
      this.walkerSpots.push({ id: w.id, wx, wy, ship: w.kind === 'ship', ahead: w.type === 'cart' ? dirX * cartReach(origin) : 0 });
      items.push({ d: fx + fy + 0.003, kind: K_WALKER, w, wx, wy, stride, origin, dirX, dirY: Math.sign(ddy) });
    }

    // --- soldiers, raiders, missiles, rally flags ---------------------------
    const tick = game.time.totalTicks;
    const inView = (wx, wy) => wx >= x0w && wx <= x1w && wy >= y0w && wy <= vr.y + vr.h + 40;
    this.shipSpots = [];
    for (const u of game.units.values()) {
      const fx = u.px + (u.x - u.px) * alpha;
      const fy = u.py + (u.y - u.py) * alpha;
      const wx = (fx - fy) * HALF_W;
      const wy = (fx + fy) * HALF_H;
      // u.walked already includes this tick's step; the drawing is (1 - alpha) of it behind.
      const stride = u.walked - (1 - alpha) * Math.hypot(u.x - u.px, u.y - u.py);
      // (Ships are big: in view a little farther out, so their masts do not pop in.)
      const naval = UNIT_TYPES[u.type].naval;
      if (!inView(wx, wy) && !(naval && inView(wx, wy - 60))) continue;
      items.push({ d: fx + fy + 0.004, kind: K_UNIT, u, wx, wy, stride });
      if (naval) this.shipSpots.push({ id: u.id, wx, wy });
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
      if (inView(wx, wy)) items.push({ d: b.rally.x + b.rally.y + 0.002, kind: K_FLAG, wx, wy, color: forceColor(b) });
    }
    // Map entrance and exit: a gateway over the Imperial road at the map edge.
    // Two items, so walkers on the tile pass between the pillars.
    this.mapGates = [];
    for (const [end, dir, color, seed] of [[map.entry, map.entryDir, ENTRY_COLOR, 1.3], [map.exit, map.exitDir, EXIT_COLOR, 4.1]]) {
      const wx = (end.x - end.y) * HALF_W;
      const wy = (end.x + end.y + 1) * HALF_H; // tile center
      if (!inView(wx, wy) && !inView(wx, wy - GATE_H * 2)) continue; // base or top on screen
      const { ox, oy } = mapGateOffset(map, end, dir);
      this.mapGates.push({ wx, wy, ox, oy });
      const d = end.x + end.y + 1;
      items.push({ d: d - 0.05, kind: K_GATE, wx, wy, ox, oy, color, seed, part: 'back' });
      items.push({ d: d + 0.05, kind: K_GATE, wx, wy, ox, oy, color, seed, part: 'front' });
    }
    // The selected fort's soldiers or naval station's ships are ringed.
    const selKind = this.selectedId ? game.buildings.get(this.selectedId)?.def.kind : null;
    const selFort = selKind === 'fort' || selKind === 'station' ? this.selectedId : 0;

    // --- pass 2: sorted objects --------------------------------------------
    items.sort((a, b) => a.d - b.d || a.kind - b.kind);
    for (const it of items) {
      switch (it.kind) {
        case K_STRIP:
          if (it.alpha) ctx.globalAlpha = it.alpha;
          if (it.full) this.blit(it.spr, it.wx, it.wy);
          else this.blitStrip(it.spr, it.wx, it.wy, it.j, it.n);
          if (it.alpha) ctx.globalAlpha = 1;
          break;
        case K_WALKER:
          if (it.w.id === this.selectedWalker) this.drawWalkerRing(it);
          drawWalker(ctx, it.w, Math.round((it.wx - cam.x) * k), Math.round((it.wy - cam.y) * k), k, this.time, it.dirX, it.dirY, it.stride, it.origin);
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
          drawUnit(ctx, it.u, Math.round((it.wx - cam.x) * k), Math.round((it.wy - cam.y) * k), k, this.time, tick, (selFort !== 0 && (it.u.fort === selFort || it.u.station === selFort)) || it.u.id === this.selectedUnit, it.stride);
          break;
        case K_PROJ:
          drawProjectile(ctx, it.p, (it.wx - cam.x) * k, (it.wy - cam.y) * k, k);
          break;
        case K_FLAG:
          drawRallyFlag(ctx, Math.round((it.wx - cam.x) * k), Math.round((it.wy - cam.y) * k), k, it.color, this.time);
          break;
        case K_GATE:
          drawMapGate(ctx, Math.round((it.wx - cam.x) * k), Math.round((it.wy - cam.y) * k), k, it.ox * k, it.oy * k, it.color, motion ? this.time : 0, it.seed, it.part, pal.snow);
          break;
        default:
          break;
      }
    }

    // --- particles (dust, smoke), under the night and the weather ----------
    this.effects.update(dt);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.effects.draw(ctx, cam);

    // --- gulls over the fishing grounds (where wharves' boats go) ----------
    this.drawFishingGrounds(motion);

    // --- ambient: cloud shadows and birds over the city --------------------
    if (this.ambientOn) {
      // Cloud shade needs sunshine; birds stay home at night and in the rain.
      this.ambient.shade = shadowA;
      this.ambient.birdsOk = env.sun > 0.4 && env.rain < 0.2 && env.snow < 0.2;
      this.ambient.update(dt);
      this.ambient.draw(ctx, cam, vr, this.time);
    }

    // --- night and cloud cover: tint the scene, then light it up -----------
    const tint = env.tint;
    if (!overlayOn && (tint[0] < 254 || tint[1] < 254 || tint[2] < 254)) {
      this.lights.begin();
      if (env.lamps > 0.01) this.collectLights(visibleBuildings, items, env);
      this.lights.apply(ctx, cam.viewW, cam.viewH, env);
    }
    this.stats.lights = !overlayOn && env.lamps > 0.01 ? this.lights.nPools + this.lights.nGlows : 0;

    // --- rain, snow, lightning ---------------------------------------------
    // (Not with reduced motion: no falling particles and no lightning flashes.)
    if (this.weatherOn && motion && (env.rain > 0.01 || env.snow > 0.01 || this.weather.flash > 0.01 || this.weather.drops.length || this.weather.flakes.length)) {
      this.weather.draw(ctx, cam.viewW, cam.viewH, cam.dpr, dt, this.time);
    }

    // --- no-road signs: over the night and the weather, so always readable --
    this.drawNoRoadMarks();

    // --- pass 3: previews, hover, selection --------------------------------
    this.drawToolPreview();
    if (this.selectedId) {
      const b = game.buildings.get(this.selectedId);
      if (b) {
        // A clicked well/fountain/reservoir shows the area it supplies.
        const water = WATER_AREA[b.def.kind];
        if (water) this.drawCoverage(this.squareTiles(b.x, b.y, b.size, water.r), null, water.colors);
        this.outlineFootprint(b.x, b.y, b.size, 'rgba(255,230,120,0.95)', 2);
        if (b.def.kind === 'station') this.drawSeaGuard(b);
        if (b.rally) this.drawRallyLine(b);
        if (b.def.kind === 'tower') this.drawRange(b.x, b.y, b.size, TOWER_RANGE, 'rgba(255,120,60,0.12)');
      } else this.selectedId = 0;
    }
    if (this.deployFort && this.hoverTile) {
      // Picking a deployment point: ghost standard under the cursor.
      const f = game.buildings.get(this.deployFort);
      const color = f ? forceColor(f) : '#a8322b';
      const { x, y } = this.hoverTile;
      this.outlineFootprint(x, y, 1, 'rgba(255,230,120,0.95)', 2);
      ctx.globalAlpha = 0.7;
      drawRallyFlag(ctx, Math.round(((x - y) * HALF_W - cam.x) * k), Math.round(((x + y + 1) * HALF_H - cam.y) * k), k, color, this.time);
      ctx.globalAlpha = 1;
    }

    this.stats.tiles = tiles;
    this.stats.objects = items.length;
    this.stats.borrowed = this.sprites.borrowed;
    this.stats.pending = this.sprites.pending;
    // Every sprite of the new look is ready: drop the old look, so the next
    // frame shows the new one whole.
    if (this.sprites.pending === 0) this.finishLookChange();
    this.stats.ms = performance.now() - t0;
  }

  /**
   * Time of day, season and weather for this frame.
   * @returns {{t:number, tint:number[], lamps:number, sun:number, overcast:number, rain:number, snow:number, pal:object}}
   */
  updateEnvironment(dt) {
    const game = this.game;
    const ticks = game.time.totalTicks;
    // Weather runs on game time: frozen while paused, faster at high speed.
    const ran = Math.max(0, Math.min(40, ticks - this.lastTicks)) / CONFIG.TICKS_PER_SECOND;
    this.lastTicks = ticks;
    const month = this.seasonsOn ? game.time.month : null;
    let sky = NOON;
    if (this.fixedTime !== null) sky = skyAt(this.fixedTime);
    else if (this.dayNightOn) sky = skyAt(dayTime(ticks));
    this.sky = sky;
    const w = this.weather;
    if (this.weatherOn) {
      w.update(ran, seasonPalette(month).season);
    } else if (w.kind !== 'clear' || w.overcast > 0 || w.drops.length || w.flakes.length || w.cover > 0) {
      w.force('clear', true);
      w.drops.length = 0;
      w.flakes.length = 0;
      w.flash = 0;
      w.clearCover();
    }
    // Season and snow cover: a new month or a new snow level brings new
    // ground/tree art (and snow on roofs). The old sprites stand in until the
    // new ones are drawn (a few frames at most), then they are dropped.
    const snowLevel = this.weatherOn && this.seasonsOn ? w.coverLevel : 0;
    const pal = seasonPalette(month, snowLevel);
    const hard = this.lookHard; // first frame of a new game: no preparing
    this.lookHard = false;
    if (pal.key !== this.pal.key) {
      const step = lookStep(this.pal.key, this.palPrev, pal.key, hard);
      for (const k of step.drop) this.dropSuffix(`~${k}`);
      this.palPrev = step.prev;
      this.pal = pal;
    }
    const snowKey = snowLevel ? `~n${snowLevel}` : '';
    if (snowKey !== this.snowKey) {
      const step = lookStep(this.snowKey, this.snowPrev, snowKey, hard);
      for (const k of step.drop) if (k) this.dropSuffix(k); // '' = the snowless art, always kept
      this.snowPrev = step.prev;
      this.snowKey = snowKey;
    }
    const on = this.weatherOn;
    const wt = on ? w.tint() : [255, 255, 255];
    const tint = [0, 1, 2].map((c) => Math.round((sky.tint[c] * wt[c]) / 255));
    // A dark thunderstorm makes some homes light their lamps even by day.
    const stormLamps = on ? Math.max(0, w.overcast - 0.85) * 2 : 0;
    return {
      t: sky.t,
      tint,
      lamps: Math.max(sky.lamps, stormLamps),
      sun: sky.sun,
      overcast: on ? w.overcast : 0,
      rain: on ? w.rain : 0,
      snow: on ? w.snow : 0,
      pal,
    };
  }

  /** Forget sprites whose key ends with a suffix (an old season look or snow level). */
  dropSuffix(suffix) {
    this.sprites.invalidateWhere((key) => key.endsWith(suffix));
  }

  /** The new look is fully drawn: drop the sprites of the old one. */
  finishLookChange() {
    if (this.palPrev !== null) {
      this.dropSuffix(`~${this.palPrev}`);
      this.palPrev = null;
    }
    if (this.snowPrev !== null) {
      if (this.snowPrev) this.dropSuffix(this.snowPrev); // '' = the snowless art, kept
      this.snowPrev = null;
    }
  }

  /**
   * Edge-blend code of a land tile: (ground type << 8) | (edges << 4) | corners,
   * or 0 when no stronger ground borders it (see terrainArt.js blendSpec).
   * Cached per tile until the map changes.
   */
  blendAt(i, x, y) {
    const map = this.game.map;
    const n = map.w * map.h;
    if (!this.blendCodes || this.blendCodes.length !== n || this.blendRev !== map.revision) {
      if (!this.blendCodes || this.blendCodes.length !== n) this.blendCodes = new Int32Array(n);
      this.blendCodes.fill(-1);
      this.blendRev = map.revision;
    }
    let c = this.blendCodes[i];
    if (c < 0) {
      c = blendCode(map, x, y);
      this.blendCodes[i] = c;
    }
    return c;
  }

  /** Art variant of a building (houses get more looks than other buildings). */
  artVariant(b) {
    return b.house ? b.id % 8 : b.variant;
  }

  /**
   * Queue this frame's night lights: lit homes and public buildings (window
   * glows, torches), wall gates, fires, and lanterns carried by walkers,
   * soldiers, raiders and ships.
   */
  collectLights(visibleBuildings, items, env) {
    const { camera: cam, game, lights: L } = this;
    const k = cam.scale;
    const lamps = env.lamps;
    const tile = HALF_W * k; // half a tile's width in device px
    const t = this.time;
    const flick = (seed) => 0.84 + 0.09 * Math.sin(t * 9.1 + seed) + 0.07 * Math.sin(t * 23.7 + seed * 1.7);
    const windowsToo = k >= 0.7; // window glows are lost when zoomed far out
    if (lamps > 0.01) {
      for (const b of visibleBuildings) {
        if (!isLit(b, lamps)) continue;
        const variant = this.artVariant(b);
        const state = artState(b, farmDormant(game, b));
        const info = lightsOf(`${b.type}:${b.size}:${variant}:${state}`, b.type, b.size, variant, state);
        const ox = ((b.x - b.y) * HALF_W - cam.x) * k;
        const oy = ((b.x + b.y) * HALF_H - cam.y) * k;
        // Each building fades in over a little while after its turn comes.
        const on = b.house ? 0.1 + hash01(b.id, 7) * 0.5 : 0.05 + hash01(b.id, 7) * 0.2;
        const a = Math.min(1, (lamps - on) / 0.15);
        if (a <= 0) continue;
        const bright = b.house ? 0.16 + b.house.tier * 0.015 : 0.4;
        L.pool(ox + info.cx * k, oy + info.cy * k, tile * (0.9 + b.size * 0.75), a * bright);
        if (windowsToo) {
          const share = b.house ? 0.55 : 0.8;
          for (let n = 0; n < info.windows.length; n++) {
            if (hash01(b.id, n, 11) > share) continue;
            const [x, y, r] = info.windows[n];
            L.glow(ox + x * k, oy + y * k, r * k * 2.4, a * 0.8);
          }
          for (let n = 0; n < info.doors.length; n++) {
            if (hash01(b.id, n, 12) > 0.5) continue;
            const [x, y, r] = info.doors[n];
            L.glow(ox + x * k, oy + y * k, r * k * 2.8, a * 0.5);
          }
        }
        for (let n = 0; n < info.torches.length; n++) {
          const [x, y] = info.torches[n];
          const f = flick(b.id * 3 + n);
          L.pool(ox + x * k, oy + (y + 10) * k, tile * 2, a * 0.5 * f, true);
          L.glow(ox + x * k, oy + y * k, 7 * k * f, a * 0.95 * f, true);
        }
      }
      // Torches on both sides of each wall gate.
      const map = game.map;
      for (const i of this.gates) {
        const x = map.xOf(i);
        const y = map.yOf(i);
        const sx = ((x - y) * HALF_W - cam.x) * k;
        const sy = ((x + y + 1) * HALF_H - cam.y) * k;
        const f = flick(i);
        L.pool(sx, sy, tile * 2.2, 0.6 * lamps * f, true);
        L.glow(sx - 12 * k, sy - 20 * k, 6 * k * f, 0.9 * lamps * f, true);
        L.glow(sx + 12 * k, sy - 20 * k, 6 * k * f, 0.9 * lamps * f, true);
      }
      // A torch on each pillar of the map entrance and exit gateways.
      for (const mg of this.mapGates) {
        const sx = (mg.wx - cam.x) * k;
        const sy = (mg.wy - cam.y) * k;
        const f = flick(mg.wx * 0.1);
        L.pool(sx, sy, tile * 2.2, 0.55 * lamps * f, true);
        for (const side of [1, -1]) L.glow(sx + side * mg.ox * k, sy + (side * mg.oy - GATE_H - 2) * k, 5.5 * k * f, 0.9 * lamps * f, true);
      }
      // Lanterns and torches on the move.
      for (const it of items) {
        if (it.kind === K_WALKER) {
          const w = it.w;
          const ship = w.type === 'ship';
          if (!ship && w.id % 3) continue;
          const sx = (it.wx - cam.x) * k;
          const sy = (it.wy - cam.y) * k;
          L.pool(sx, sy, tile * (ship ? 2.4 : 1.2), (ship ? 0.6 : 0.4) * lamps);
          L.glow(sx + 3 * k, sy - (ship ? 22 : 11) * k, 3.5 * k, 0.8 * lamps);
        } else if (it.kind === K_UNIT) {
          const u = it.u;
          if (u.side === 'enemy' ? u.id % 2 : u.id % 4) continue;
          const sx = (it.wx - cam.x) * k;
          const sy = (it.wy - cam.y) * k;
          const f = flick(u.id);
          L.pool(sx, sy, tile * 1.9, 0.5 * lamps * f, true);
          L.glow(sx + 4 * k, sy - 16 * k, 5 * k * f, 0.9 * lamps * f, true);
        }
      }
    }
    // Fires light up the night whatever the lamps are doing.
    if (game.fires.size) {
      const map = game.map;
      const vt = this.viewTiles;
      for (const i of game.fires.keys()) {
        const x = map.xOf(i);
        const y = map.yOf(i);
        if (vt && (x < vt.tx0 || x > vt.tx1 || y < vt.ty0 || y > vt.ty1)) continue;
        const sx = ((x - y) * HALF_W - cam.x) * k;
        const sy = ((x + y + 1) * HALF_H - cam.y) * k;
        const f = flick(i * 7);
        L.pool(sx, sy, tile * 4.5, 0.95 * f, true);
        L.glow(sx, sy - 12 * k, 20 * k * f, 0.45 * f, true);
      }
    }
  }

  /**
   * Draw a cached sprite with its anchor at world (wx, wy). A sprite made for
   * another scale (a zoom still easing, or one borrowed from the previous
   * zoom level) is stretched to fit.
   */
  blit(spr, wx, wy) {
    const cam = this.camera;
    const k = cam.scale;
    if (spr.s === k) {
      this.ctx.drawImage(spr.canvas, Math.round((wx - cam.x) * k) - spr.ax, Math.round((wy - cam.y) * k) - spr.ay);
      return;
    }
    const f = k / spr.s;
    this.ctx.drawImage(spr.canvas, (wx - cam.x) * k - spr.ax * f, (wy - cam.y) * k - spr.ay * f, spr.w * f, spr.h * f);
  }

  /** Draw strip j of n (a vertical slice) of a building sprite; see blit(). */
  blitStrip(spr, wx, wy, j, n) {
    const cam = this.camera;
    const k = cam.scale;
    const sx0 = Math.round((j * spr.w) / n);
    const sx1 = Math.round(((j + 1) * spr.w) / n);
    if (sx1 <= sx0) return;
    if (spr.s === k) {
      const dx = Math.round((wx - cam.x) * k) - spr.ax;
      const dy = Math.round((wy - cam.y) * k) - spr.ay;
      this.ctx.drawImage(spr.canvas, sx0, 0, sx1 - sx0, spr.h, dx + sx0, dy, sx1 - sx0, spr.h);
      return;
    }
    // Stretched: snap each strip's edges to whole pixels so neighbouring
    // strips meet exactly (no hairline seams through buildings).
    const f = k / spr.s;
    const X = (wx - cam.x) * k - spr.ax * f;
    const Y = Math.round((wy - cam.y) * k - spr.ay * f);
    const d0 = Math.round(X + sx0 * f);
    const d1 = Math.round(X + sx1 * f);
    if (d1 > d0) this.ctx.drawImage(spr.canvas, sx0, 0, sx1 - sx0, spr.h, d0, Y, d1 - d0, Math.round(spr.h * f));
  }

  /** Queue a building's strips (or its overlay stand-in). */
  collectBuilding(b, items, overlayOn) {
    const ov = this.overlay;
    const wx = (b.x - b.y) * HALF_W;
    const wy = (b.x + b.y) * HALF_H;
    const depths = this.stripsFor(b);
    const front = Math.max(...depths);
    if (overlayOn && ov.show && !ov.show(b)) {
      if (lacksRoad(b)) this.noRoadMarks.push({ b, H: 0 });
      // Flat footprint + optional info column.
      const color = b.house ? 'rgba(214,190,140,0.9)' : 'rgba(150,145,135,0.85)';
      items.push({ d: front - 0.5, kind: K_EXTRA, b, flat: color, wx, wy });
      let v = null;
      let tint = null; // the overlay's own column color
      if (ov.column) {
        const col = ov.column(b, this.game);
        if (col) ({ v, color: tint } = col);
      } else if (b.house && ov.house) v = b.house.pop > 0 ? ov.house(b) : null;
      else if (ov.value) v = ov.value(b);
      if (v !== null && v !== undefined) {
        const cx = b.x + b.size / 2;
        const cy = b.y + b.size / 2;
        items.push({ d: front + 0.001, kind: K_COLUMN, wx: (cx - cy) * HALF_W, wy: (cx + cy) * HALF_H, v: Math.max(0, Math.min(1, v)), bad: !!ov.bad, color: tint, S: b.size });
      }
      return;
    }
    const state = artState(b, farmDormant(this.game, b));
    const variant = this.artVariant(b);
    const key = buildingKey(b, variant, state);
    const sick = key.endsWith(':sick');
    // `true`: live flags (the sprite has bare poles; drawExtra adds fluttering cloth).
    const snow = this.pal.snow;
    const spr = this.sprites.get(key + this.snowKey, () => buildingSpec(b.type, b.size, variant, state, true, snow, sick), this.snowPrev === null ? null : key + this.snowPrev);
    if (spr && spr.s) this.buildingBoxes.push({ x: b.x, y: b.y, S: b.size, H: spr.ay / spr.s });
    if (lacksRoad(b)) this.noRoadMarks.push({ b, H: spr && spr.s ? spr.ay / spr.s : 0 });
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
    if (b.house && b.house.pop > 0 && b.house.tier >= 4 && b.house.tier <= 12 && this.camera.zoom >= 1 && Math.random() < 0.0015) {
      this.effects.smoke(wx + (Math.random() - 0.5) * 8, wy + b.size * HALF_H - 14 - b.size * 10);
    }
    if (kind === 'fountain' && b.hasWater && b.efficiency > 0 && this.motionOn) {
      items.push({ d: front + 0.0006, kind: K_EXTRA, b, wx, wy, spray: true });
    }
    // Live details. Flag cloth always (the sprite only has the poles).
    const flags = flagsFor(b.type, b.size);
    if (flags.length) items.push({ d: front + 0.0007, kind: K_EXTRA, b, wx, wy: wy + rise, flags });
    if (this.camera.zoom < 0.75 || rise) return; // the rest is too small to see when zoomed out
    if (kind === 'market' && b.efficiency > 0 && hasStock(b)) {
      items.push({ d: front + 0.0004, kind: K_EXTRA, b, wx, wy, live: 'market' });
    } else if (kind === 'venue' && b.def.venue === 'hippodrome') {
      if (this.motionOn && b.shows && b.shows.hippodrome > 0 && b.efficiency > 0) this.raceItems(b, items);
    } else if (kind === 'venue' && showOn(b)) {
      items.push({ d: front + 0.0003, kind: K_EXTRA, b, wx, wy, live: 'crowd' });
    } else if (b.type.startsWith('temple_')) {
      items.push({ d: front + 0.0004, kind: K_EXTRA, b, wx, wy, live: 'altar' });
    } else if (b.type === 'weapons_ws' && b.efficiency > 0 && b.progress > 0 && this.motionOn && Math.random() < 0.035) {
      // The smith hammers: sparks fly out of the forge door (workshopArt door, left face).
      const [dx, dy] = [(0.6 - 1.07) * HALF_W, (0.6 + 1.07) * HALF_H - 4];
      this.effects.sparks(wx + dx, wy + dy, 4 + Math.floor(Math.random() * 4));
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

  /**
   * The water a selected naval station's squadron guards: within
   * STATION_GUARD of its berths, or STATION_GUARD_DEPLOYED of where it was
   * sent, on its own water (sim/navy.js).
   */
  drawSeaGuard(b) {
    const map = this.game.map;
    const body = waterOf(this.game, b);
    if (!body) return;
    let a = b.rally;
    if (!a) {
      const i = shoreBerth(this.game, b);
      a = { x: map.xOf(i) + 0.5, y: map.yOf(i) + 0.5 };
    }
    const r = b.rally ? CONFIG.STATION_GUARD_DEPLOYED : CONFIG.STATION_GUARD;
    for (let y = Math.floor(a.y - r); y <= a.y + r; y++) {
      for (let x = Math.floor(a.x - r); x <= a.x + r; x++) {
        if (!map.inBounds(x, y) || map.navBody[map.idx(x, y)] !== body) continue;
        if (Math.hypot(x + 0.5 - a.x, y + 0.5 - a.y) > r) continue;
        this.fillDiamond((x - y) * HALF_W, (x + y) * HALF_H, 'rgba(255,236,160,0.2)'); // (pale gold: blue would vanish on the water)
      }
    }
  }

  /** The ship (warship or raider ship) drawn under a screen point, or 0. */
  pickShip(sx, sy) {
    const cam = this.camera;
    const p = cam.screenToWorld(sx, sy);
    const css = cam.dpr / cam.scale; // world px per CSS px
    let best = 0;
    let bestD = Infinity;
    for (const s of this.shipSpots) {
      const dx = p.x - s.wx;
      const dy = p.y - s.wy;
      if (Math.abs(dx) > Math.max(24, 12 * css) || dy < -Math.max(44, 20 * css) || dy > Math.max(6, 4 * css)) continue;
      const d = Math.hypot(dx, dy + 18);
      if (d < bestD) { bestD = d; best = s.id; }
    }
    return best;
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
  drawBuildingShadow(b, strength = 1) {
    const L = shadowLength(b) * 1.25;
    if (L <= 0.03) return;
    const { ctx, camera: cam } = this;
    const k = cam.scale;
    const S = b.size;
    const pt = (u, v) => [((b.x + u - (b.y + v)) * HALF_W - cam.x) * k, ((b.x + u + b.y + v) * HALF_H - cam.y) * k];
    for (const [len, alpha] of [[L, 0.14], [L * 0.55, 0.12]]) {
      const dv = len * 0.4;
      const pts = [pt(S, 0), pt(S + len, dv), pt(S + len, S + dv), pt(len, S + dv), pt(0, S), pt(S, S)];
      ctx.fillStyle = `rgba(16,22,10,${(alpha * strength).toFixed(3)})`;
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
  /**
   * Sides of tile (x, y) on screen: [neighbor index or -1, from corner, to
   * corner] for N, E, S and W, for outlining areas of tiles.
   */
  tileSides(x, y) {
    const { camera: cam, game } = this;
    const map = game.map;
    const k = cam.scale;
    const pt = (px, py) => [((px - py) * HALF_W - cam.x) * k, ((px + py) * HALF_H - cam.y) * k];
    return [
      [map.inBounds(x, y - 1) ? map.idx(x, y - 1) : -1, pt(x, y), pt(x + 1, y)],
      [map.inBounds(x + 1, y) ? map.idx(x + 1, y) : -1, pt(x + 1, y), pt(x + 1, y + 1)],
      [map.inBounds(x, y + 1) ? map.idx(x, y + 1) : -1, pt(x, y + 1), pt(x + 1, y + 1)],
      [map.inBounds(x - 1, y) ? map.idx(x - 1, y) : -1, pt(x, y), pt(x, y + 1)],
    ];
  }

  /** Stroke a list of screen-space segments (pairs of points). */
  strokeEdges(edges, color, width) {
    if (!edges.length) return;
    const { ctx, camera: cam } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = width * cam.dpr;
    ctx.beginPath();
    for (let e = 0; e < edges.length; e += 2) {
      ctx.moveTo(edges[e][0], edges[e][1]);
      ctx.lineTo(edges[e + 1][0], edges[e + 1][1]);
    }
    ctx.stroke();
  }

  /**
   * Faint water hints (see waterHintLayers): every visible tile in a layer is
   * filled once, with its strongest layer's tint, and each layer's area gets
   * a thin outline where it meets weaker ground. `skip(i)`: tiles another
   * preview paints (they count as covered, so no outline runs along them).
   * Each layer is one path and one fill: zoomed out over a big city the hint
   * covers thousands of tiles, and a fill per tile would flush the canvas
   * mid-frame (see ARCHITECTURE.md, Draw calls).
   */
  drawWaterHints(layers, skip = null) {
    const map = this.game.map;
    const counts = this.drawTileHints(layers, (j) => waterHintOf(map.water[j], layers), skip);
    // Exposed for the browser smoke test: tiles hinted this frame, by layer.
    if (counts) this.stats.waterHint = counts;
  }

  /**
   * Tint tiles by hint layer: `layerOf(i)` gives a tile's layer (an index
   * into `layers`, the strongest wins) or -1. Each layer is filled once and
   * outlined where it meets weaker ground (see drawWaterHints).
   * @returns {Object<string, number>|null} tiles hinted, by layer key
   */
  drawTileHints(layers, layerOf, skip = null) {
    const v = this.viewTiles;
    if (!v || !layers.length) return null;
    const { ctx, camera: cam } = this;
    const k = cam.scale;
    const map = this.game.map;
    const cls = (j) => {
      if (j < 0) return -1;
      if (skip && skip(j)) return Infinity;
      return layerOf(j);
    };
    const edges = layers.map(() => []);
    const tiles = layers.map(() => []);
    const counts = {};
    for (const l of layers) counts[l.key] = 0;
    for (let y = v.ty0; y <= v.ty1; y++) {
      for (let x = v.tx0; x <= v.tx1; x++) {
        const i = map.idx(x, y);
        const c = cls(i);
        if (c < 0 || c === Infinity) continue;
        counts[layers[c].key]++;
        tiles[c].push(x, y);
        for (const [j, a, b] of this.tileSides(x, y)) if (cls(j) < c) edges[c].push(a, b);
      }
    }
    layers.forEach((l, n) => {
      const t = tiles[n];
      if (!t.length) return;
      ctx.fillStyle = l.style.fill;
      ctx.beginPath();
      for (let q = 0; q < t.length; q += 2) {
        // Top corner of the tile, then around the diamond.
        const sx = ((t[q] - t[q + 1]) * HALF_W - cam.x) * k;
        const sy = ((t[q] + t[q + 1]) * HALF_H - cam.y) * k;
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + HALF_W * k, sy + HALF_H * k);
        ctx.lineTo(sx, sy + CONFIG.TILE_H * k);
        ctx.lineTo(sx - HALF_W * k, sy + HALF_H * k);
        ctx.closePath();
      }
      ctx.fill();
    });
    layers.forEach((l, n) => this.strokeEdges(edges[n], l.style.edge, l.style.width || 1));
    return counts;
  }

  drawCoverage(strong, isPale = null, colors = BLUE) {
    const { game } = this;
    const map = game.map;
    const sides = (x, y) => this.tileSides(x, y);
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
          this.fillDiamond((x - y) * HALF_W, (x + y) * HALF_H, colors.pale.fill);
          for (const [j, a, b] of sides(x, y)) if (!inside(j)) paleEdges.push(a, b);
        }
      }
    }
    for (const i of strong) {
      const x = map.xOf(i);
      const y = map.yOf(i);
      this.fillDiamond((x - y) * HALF_W, (x + y) * HALF_H, colors.strong.fill);
      for (const [j, a, b] of sides(x, y)) if (!strong.has(j)) strongEdges.push(a, b);
    }
    this.strokeEdges(paleEdges, colors.pale.edge, 1.4);
    this.strokeEdges(strongEdges, colors.strong.edge, 1.6);
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

  /**
   * Aqueduct connections (bits 1=N 2=E 4=S 8=W): other aqueducts or
   * reservoirs; the same bits shifted up 4 mark the reservoirs (the channel
   * steps down to their rim, see aqueductSpec).
   */
  aqueductMask(x, y) {
    return aqueductMaskAt(this.game.map, this.game.buildings, x, y);
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
    const color = it.color || columnColor(it.v, it.bad);
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

  /** Flat overlay footprints, stock displays, fountain spray and other live details. */
  /**
   * Races at the hippodrome (looks only): three chariots lapping the spina.
   * Each is drawn just after the strip of its section's sprite that holds
   * it (a strip is a screen column, drawn at its front tile's depth), so the
   * track does not paint over it.
   * Track coordinates as in hippodromeArt.js (U along the 15 tiles, v across).
   */
  raceItems(b, items) {
    const A = 2.9;
    const B = 12.1;
    const R = 0.8;
    const straight = B - A;
    const arc = Math.PI * R;
    const L = 2 * straight + 2 * arc;
    const colors = ['#2f6db5', '#b8573a', '#3f8f5a'];
    for (let n = 0; n < 3; n++) {
      let s = ((this.time * (1.9 - n * 0.12) + n * 3.1) % L + L) % L;
      let U;
      let v;
      let face;
      if (s < straight) { U = B - s; v = 2.5 + R; face = -1; } else if ((s -= straight) < arc) {
        const a = Math.PI / 2 + s / R;
        U = A + Math.cos(a) * R * 1.2; v = 2.5 + Math.sin(a) * R; face = Math.sin(a) > 0 ? -1 : 1;
      } else if ((s -= arc) < straight) { U = A + s; v = 2.5 - R; face = 1; } else {
        const a = -Math.PI / 2 + (s - straight) / R;
        U = B + Math.cos(a) * R * 1.2; v = 2.5 + Math.sin(a) * R; face = Math.sin(a) < 0 ? 1 : -1;
      }
      const x = b.x + U;
      const y = b.y + v;
      const sec = this.game.buildings.get(this.game.map.buildingAt(Math.floor(x), Math.floor(y))) || b;
      const depths = this.stripsFor(sec);
      const j = Math.floor(x) - Math.floor(y) - (sec.x - sec.y - sec.size);
      const d = Math.max(depths[Math.max(0, Math.min(depths.length - 1, j - 1))], depths[Math.max(0, Math.min(depths.length - 1, j))]);
      items.push({ d: d + 0.0008, kind: K_EXTRA, b, wx: (x - y) * HALF_W, wy: (x + y) * HALF_H, race: { face, color: colors[n], n } });
    }
  }

  /** Gulls wheeling over each fishing ground in view (still with reduced motion). */
  drawFishingGrounds(motion) {
    const { ctx, camera: cam, game } = this;
    const grounds = game.map.fishingGrounds;
    if (!grounds || !grounds.length) return;
    const k = cam.scale;
    const t = motion ? this.time : 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    grounds.forEach((g, n) => {
      const sx = ((g.x - g.y) * HALF_W - cam.x) * k;
      const sy = ((g.x + g.y + 1) * HALF_H - cam.y) * k;
      if (sx < -80 * k || sy < -80 * k || sx > cam.viewW + 80 * k || sy > cam.viewH + 80 * k) return;
      drawGulls(ctx, sx, sy, k, t, n * 2.3 + g.x * 0.1);
    });
  }

  drawExtra(it) {
    const { ctx, camera: cam } = this;
    const k = cam.scale;
    const b = it.b;
    const t = this.motionOn ? this.time : 0; // reduced motion: everything holds still
    if (it.race) {
      const phase = Math.sin(t * 16 + it.race.n * 2);
      drawChariot(ctx, Math.round((it.wx - cam.x) * k), Math.round((it.wy - cam.y) * k), k * 0.9, it.race.face, phase, it.race.color, b.id + it.race.n);
      return;
    }
    if (it.flags) {
      const ox = (it.wx - cam.x) * k;
      const oy = (it.wy - cam.y) * k;
      it.flags.forEach((f, n) => drawFlag(ctx, ox + f.x * k, oy + f.y * k, k, f, t, b.id * 1.3 + n * 2.1));
      return;
    }
    if (it.live) {
      const ox = (it.wx - cam.x) * k;
      const oy = (it.wy - cam.y) * k;
      if (it.live === 'market') drawShoppers(ctx, ox, oy, k, b.size, t, b.id);
      else if (it.live === 'crowd') drawCrowd(ctx, ox, oy, k, b.type, b.size, t, b.id, b.type === 'theater' ? 0.2 : 0.5);
      else if (it.live === 'altar') {
        const [fx, fy] = altarFlameOffset(b.size);
        drawAltarFlame(ctx, ox + fx * k, oy + fy * k, k, t, b.id);
      }
      return;
    }
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

  /**
   * The walker drawn at CSS pixel (sx, sy) of the screen, or 0: the figure
   * nearest the point among those whose box holds it. The box is the figure
   * itself (a little bigger, never under about 12 x 22 CSS px) or, with
   * `generous`, never under about 22 x 36 CSS px (people were
   * hard to click; zoomed out a figure is a few pixels wide). The generous
   * box only wins on open ground (app.js clickTile): on a building or a
   * roadblock it would steal clicks meant for them. Where a building stands
   * in front of a walker and covers the point, the building gets the click.
   */
  pickWalker(sx, sy, generous = true) {
    const cam = this.camera;
    const p = cam.screenToWorld(sx, sy);
    const css = cam.dpr / cam.scale; // world px per CSS px
    // Buildings as prisms: height H over their footprint. The screen column
    // through the point crosses a footprint between world y lo and hi; the
    // building covers the point if the point is at most H above that span,
    // and it is in front of a walker whose feet are above hi.
    const hx = p.x / HALF_W;
    const covers = (feetY) => (this.buildingBoxes || []).some((o) => {
      const lo = Math.max(HALF_H * (2 * o.x - hx), HALF_H * (2 * o.y + hx));
      const hi = Math.min(HALF_H * (2 * (o.x + o.S) - hx), HALF_H * (2 * (o.y + o.S) + hx));
      return lo <= hi && hi > feetY + 1 && p.y <= hi && p.y + o.H >= lo;
    });
    let best = 0;
    let bestD = Infinity;
    for (const s of this.walkerSpots) {
      const hw = s.ship ? Math.max(26, 12 * css) : Math.max(7, (generous ? 11 : 6) * css);
      const top = s.ship ? Math.max(40, 20 * css) : generous ? Math.max(24, 30 * css) : Math.max(22, 16 * css);
      const bottom = generous ? Math.max(5, 6 * css) : Math.max(4, 3 * css);
      const dx = p.x - s.wx;
      const dy = p.y - s.wy;
      // The box runs from the figure to the far end of its cart, if it has one.
      const near = Math.min(0, s.ahead || 0);
      const far = Math.max(0, s.ahead || 0);
      if (dx < near - hw || dx > far + hw || dy < -top || dy > bottom) continue;
      const ex = dx < near ? dx - near : dx > far ? dx - far : 0;
      const d = Math.hypot(ex, dy + top / 2);
      if (d < bestD && !covers(s.wy)) { bestD = d; best = s.id; }
    }
    return best;
  }

  /** Keep the followed walker in the middle of the view; stop once the map is moved. */
  followWalker(alpha) {
    const f = this.follow;
    const cam = this.camera;
    const w = this.game.walkers.get(f.id);
    const moved = f.x !== undefined && (Math.abs(cam.x - f.x) > 0.5 || Math.abs(cam.y - f.y) > 0.5);
    if (!w || w.dead || moved) { this.follow = null; return; }
    const { wx, wy } = walkerWorld(w, alpha);
    cam.setCenter(wx, wy - 10);
    f.x = cam.x;
    f.y = cam.y;
  }

  /** A ring at the feet of the selected walker. */
  drawWalkerRing(it) {
    const { ctx, camera: cam } = this;
    const k = cam.scale;
    const x = Math.round((it.wx - cam.x) * k);
    const y = Math.round((it.wy - cam.y) * k);
    const r = it.w.kind === 'ship' ? 20 : 7;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,230,120,0.95)';
    ctx.lineWidth = Math.max(1.5, 1.6 * k);
    ctx.beginPath();
    ctx.ellipse(x, y, r * k, r * 0.5 * k, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The red "no road" sign over every building in view that needs a road
   * and has none it can use (sim/roadAccess.js lacksRoad). It floats just
   * above the art (`H`, the sprite's height over the footprint's top
   * corner; 0 for an overlay's flat footprint) and never shrinks below
   * its zoom-1 size (about 20 CSS px across), so it shows at every zoom.
   */
  drawNoRoadMarks() {
    const marks = this.noRoadMarks;
    this.stats.noRoad = marks.length;
    this.noRoadSpots = []; // where each sign's disc was drawn (device px), for the browser smoke test
    if (!marks.length) return;
    const { ctx, camera: cam } = this;
    const k = cam.scale;
    const s = Math.max(k, cam.dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const { b, H } of marks) {
      const S = b.size;
      const cx = b.x + S / 2;
      const cy = b.y + S / 2;
      // The tail's tip just over the roof (H is the art's headroom, flag poles included).
      const top = H > 0 ? (b.x + b.y) * HALF_H - H * 0.55 : (cx + cy) * HALF_H;
      const bob = this.motionOn ? Math.sin(this.time * 3 + b.id) * 1.2 * s : 0;
      const sx = Math.round(((cx - cy) * HALF_W - cam.x) * k);
      const sy = Math.round((top - cam.y) * k + bob);
      drawNoRoadSign(ctx, sx, sy, s);
      this.noRoadSpots.push({ id: b.id, x: sx, y: sy - (NO_ROAD_SIGN_R + 4) * s, r: NO_ROAD_SIGN_R * s });
    }
  }

  /** Construction previews: water hints, ghost building, tile markers, coverage radius. */
  drawToolPreview() {
    const { game, plan } = this;
    this.stats.ghostNoRoad = false; // exposed for the browser smoke test
    this.stats.roadEdges = 0;
    const map = game.map;
    const def = plan ? BUILDINGS[plan.tool] : null;
    const water = def ? WATER_AREA[def.kind] : null;
    // Water buildings: the new one(s) in dark blue over the pale area the
    // existing ones of this kind already supply. While hovering a single
    // spot the radius shows even where it cannot be built; in a drag only
    // the valid spots count.
    let strong = null;
    if (water) {
      strong = new Set();
      const single = plan.items.length === 1;
      for (const it of plan.items) if (single || it.ok) this.squareTiles(it.x, it.y, it.size, water.r, strong);
    }
    // Faint hints of the water already there, whenever the tool is in hand
    // (under the rest; tiles the coverage preview paints are left to it).
    const hints = waterHintLayers(this.tool);
    if (hints.length) this.drawWaterHints(hints, water ? (i) => strong.has(i) || (map.water[i] & water.bit) !== 0 : null);
    const meadow = meadowHintLayer(this.tool);
    this.stats.meadowHint = meadow ? this.drawTileHints([meadow], (i) => (map.terrain[i] === Terrain.MEADOW ? 0 : -1))?.meadow ?? 0 : null;
    if (!plan) {
      if (this.hoverTile) this.outlineFootprint(this.hoverTile.x, this.hoverTile.y, 1, 'rgba(255,255,255,0.55)', 1);
      return;
    }
    // Other area-of-effect buildings keep a simple single-color hint.
    const radius = { hospital: CONFIG.HOSPITAL_RADIUS, tower: TOWER_RANGE }[plan.tool];
    if (water) {
      this.drawCoverage(strong, (i) => (map.water[i] & water.bit) !== 0, water.colors);
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
    // No road would touch a single building placed here: pick out the edge
    // tiles where one would (a corner does not count; homes, which take a
    // road within 2 tiles, are placed by area and only get the color).
    this.stats.ghostNoRoad = plan.items.some((it) => it.ok && it.noRoad);
    if (plan.kind === 'building' && plan.items[0] && !plan.items.some((x) => !x.part && x !== plan.items[0]) && plan.items[0].ok && plan.items[0].noRoad) {
      const it = plan.items[0];
      const span = plan.items.length; // a hippodrome: its sections in a row
      for (const e of accessEdgeTiles(game, it.x, it.y, it.size * span, it.size)) {
        if (!e.open) continue;
        this.fillDiamond((e.x - e.y) * HALF_W, (e.x + e.y) * HALF_H, ROAD_EDGE_FILL);
        this.outlineFootprint(e.x, e.y, 1, ROAD_EDGE_LINE, 1.4);
        this.stats.roadEdges++;
      }
    }
    for (const it of plan.items) {
      const color = !it.ok ? 'rgba(230,40,40,0.5)' : plan.tool === 'clear' ? 'rgba(230,80,40,0.45)' : it.noRoad ? NO_ROAD_FILL : 'rgba(80,220,90,0.38)';
      const wx = (it.x - it.y) * HALF_W;
      const wy = (it.x + it.y) * HALF_H;
      if (plan.tool === 'roadblock' && it.ok) {
        const axis = map.hasRoad(it.x + 1, it.y) || map.hasRoad(it.x - 1, it.y) ? 'u' : 'v';
        this.fillDiamond(wx, wy, color);
        this.ctx.globalAlpha = 0.8;
        this.blit(this.sprites.get(`rbk${axis}`, () => roadblockSpec(axis)), wx, wy);
        this.ctx.globalAlpha = 1;
      } else if (def && plan.kind === 'building' && it.ok) {
        // Same sprite (and cache key) as a placed building of variant 0: live flags.
        // With no road in reach it is washed over in the warning color
        // (its own key, before the snow suffix that must stay last).
        // `type`, `state`: a hippodrome's other sections, a waterside building's turn.
        const snow = this.pal.snow;
        const type = it.type || plan.tool;
        const st = it.state || 0;
        const spr = it.noRoad
          ? this.sprites.get(`b:${type}:${it.size}:0:${st}:noroad${this.snowKey}`, () => tintedSpec(buildingSpec(type, it.size, 0, st, true, snow), NO_ROAD_TINT))
          : this.sprites.get(`b:${type}:${it.size}:0:${st}${this.snowKey}`, () => buildingSpec(type, it.size, 0, st, true, snow));
        this.fillDiamond(wx, wy, color, it.size);
        this.ctx.globalAlpha = 0.72;
        this.blit(spr, wx, wy);
        this.ctx.globalAlpha = 1;
      } else {
        this.fillDiamond(wx, wy, color, it.size);
      }
    }
  }
}

/**
 * map.js
 * ----------------------------------------------------------------------------
 * The tile grid. Every per-tile layer is a flat typed array indexed by
 *   idx = y * width + x
 * Typed arrays keep memory small and iteration fast (a 128x128 map is only
 * 16,384 tiles per layer) and they serialize nicely into save files.
 *
 * Coordinate system (isometric, see render/camera.js for the projection):
 *   +x runs toward the lower-right of the screen, +y toward the lower-left.
 *   Tile (0,0) is the top corner of the diamond-shaped map.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';

/** Base terrain types. Stored in map.terrain. */
export const Terrain = Object.freeze({
  GRASS: 0,
  MEADOW: 1, // fertile land, farms need it
  TREES: 2, // forest, clearable, timber yards need it nearby
  ROCK: 3, // impassable, never clearable, mines/quarries need it nearby
  WATER: 4, // rivers/lakes/sea
  SAND: 5, // beaches and desert, buildable but not fertile
});

export const TERRAIN_NAMES = ['Grass', 'Meadow', 'Forest', 'Rocks', 'Water', 'Sand'];


/** Values stored in map.road */
export const Road = Object.freeze({
  NONE: 0,
  ROAD: 1,
  PLAZA: 2, // decorative paving on top of a road (+desirability)
  BRIDGE: 3, // road over water
});

/**
 * map.roadblock: 0 = none; a roadblock stores ROADBLOCK.PRESENT plus the bits
 * of the walker groups it lets through (data/walkers.js ROADBLOCK_GROUPS).
 */
export const ROADBLOCK = Object.freeze({
  PRESENT: 128,
  GROUPS: 127, // mask of the group bits
});

/** Values stored in map.wall */
export const Wall = Object.freeze({
  NONE: 0,
  WALL: 1, // blocks raiders and walkers
  GATE: 2, // wall across a road: citizens pass, raiders must break it
});

/** Bit flags stored in map.water (water supply coverage) */
export const WaterBits = Object.freeze({
  WELL: 1, // within range of a well
  FOUNTAIN: 2, // within range of a working fountain
  PIPED: 4, // inside a filled reservoir's piped-water area
  HOSPITAL: 8, // inside a staffed hospital's service area (reuses this layer)
});

/** 4-neighborhood offsets in the order N(up-right), E(down-right), S(down-left), W(up-left) */
export const DIRS4 = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export class GameMap {
  /**
   * @param {number} width
   * @param {number} height
   */
  constructor(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 256 || height > 256) {
      throw new Error(`Invalid map size ${width}x${height} (allowed 16..256)`);
    }
    this.w = width;
    this.h = height;
    this.size = width * height;

    // --- persistent layers (saved) ---
    this.terrain = new Uint8Array(this.size); // Terrain.*
    this.variant = new Uint8Array(this.size); // random 0..255 for visual variety
    this.road = new Uint8Array(this.size); // Road.*
    this.aqueduct = new Uint8Array(this.size); // 0 none, 1 dry, 2 carrying water
    this.rubble = new Uint8Array(this.size); // 1 = collapsed/burnt debris
    this.fixedRoad = new Uint8Array(this.size); // 1 = imperial road tile that cannot be removed
    this.wall = new Uint8Array(this.size); // Wall.*
    this.roadblock = new Uint8Array(this.size); // 0 or ROADBLOCK.PRESENT | allowed group bits (only on roads)
    this.bridgeLow = new Uint8Array(this.size); // 1 = a low bridge: a Road.BRIDGE tile no boat passes under

    // --- derived layers (recomputed, not saved) ---
    this.building = new Int32Array(this.size); // building id occupying the tile, 0 = none
    this.desirability = new Int16Array(this.size);
    this.water = new Uint8Array(this.size); // WaterBits
    this.roadNet = new Int32Array(this.size); // road network component id (0 = no road)
    this.waterDist = new Uint8Array(this.size); // distance to nearest water tile (capped 255)
    this.navigable = new Uint8Array(this.size); // 1 = water that ships can sail (reaches the map edge)
    this.navBody = new Int32Array(this.size); // which navigable water (1, 2, ...): ships never leave theirs (computeNavigation, split at low bridges)
    this.fishBody = new Int32Array(this.size); // water body with fish (1, 2, ...), 0 = land or a pond (computeFishing, split at low bridges)
    // The same two before low bridges split them (splitAtLowBridges): the
    // very same arrays while there is no low bridge.
    this.navWhole = this.navBody;
    this.fishWhole = this.fishBody;

    /** Edge water tile where merchant ships appear and leave, or null (no sea access). */
    this.seaEntry = null;
    /** Fishing grounds { x, y, body } (computeFishing): derived from the terrain, never saved. */
    this.fishingGrounds = [];

    /** Entry/exit tiles for the imperial road (set by mapgen). */
    this.entry = { x: 0, y: 0 };
    this.exit = { x: 0, y: 0 };
    /** The Imperial road's first step [dx, dy] from each end (map gates face it); null in old saves. */
    this.entryDir = null;
    this.exitDir = null;

    /** Incremented whenever any layer changes; the renderer uses it to refresh caches. */
    this.revision = 0;
  }

  idx(x, y) { return y * this.w + x; }
  xOf(i) { return i % this.w; }
  yOf(i) { return (i / this.w) | 0; }

  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }

  terrainAt(x, y) { return this.inBounds(x, y) ? this.terrain[this.idx(x, y)] : Terrain.ROCK; }

  isWater(x, y) { return this.inBounds(x, y) && this.terrain[this.idx(x, y)] === Terrain.WATER; }

  hasRoad(x, y) { return this.inBounds(x, y) && this.road[this.idx(x, y)] !== Road.NONE; }

  buildingAt(x, y) { return this.inBounds(x, y) ? this.building[this.idx(x, y)] : 0; }

  /**
   * Can a structure be placed on this tile's terrain (ignoring what is on it)?
   * Trees count as buildable because construction clears them automatically.
   */
  isTerrainBuildable(x, y) {
    if (!this.inBounds(x, y)) return false;
    const t = this.terrain[this.idx(x, y)];
    return t === Terrain.GRASS || t === Terrain.MEADOW || t === Terrain.SAND || t === Terrain.TREES;
  }

  /** Tile is completely empty land: buildable terrain, no road, building, aqueduct or wall. */
  isFree(x, y) {
    if (!this.isTerrainBuildable(x, y)) return false;
    const i = this.idx(x, y);
    return this.road[i] === 0 && this.building[i] === 0 && this.aqueduct[i] === 0 && this.wall[i] === 0;
  }

  /** Mark the map as changed (renderer caches, minimap). */
  touch() { this.revision++; }

  /**
   * Recompute the distance-to-water layer with a multi-source BFS.
   * Used by desirability (waterfront bonus) and placement rules.
   */
  computeWaterDistance() {
    const { w, h, size } = this;
    const dist = this.waterDist;
    dist.fill(255);
    const queue = new Int32Array(size);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < size; i++) {
      if (this.terrain[i] === Terrain.WATER) {
        dist[i] = 0;
        queue[tail++] = i;
      }
    }
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      const y = (i / w) | 0;
      const d = dist[i] + 1;
      if (d > 254) continue;
      if (x > 0 && dist[i - 1] > d) { dist[i - 1] = d; queue[tail++] = i - 1; }
      if (x < w - 1 && dist[i + 1] > d) { dist[i + 1] = d; queue[tail++] = i + 1; }
      if (y > 0 && dist[i - w] > d) { dist[i - w] = d; queue[tail++] = i - w; }
      if (y < h - 1 && dist[i + w] > d) { dist[i + w] = d; queue[tail++] = i + w; }
    }
  }

  /**
   * Mark navigable water: every body of water that touches the map edge and
   * is big enough to be a river or sea (not a tiny pond in a corner). Ships
   * sail under bridges. Each such body gets its own number in navBody
   * (warships and raider ships stay on theirs). Also picks `seaEntry`, the edge tile of the largest
   * such body where ships come and go (middle of its longest edge stretch).
   * Water never changes after map generation, so this runs once per game.
   */
  computeNavigation(minTiles = 80) {
    const { w, h, size } = this;
    const nav = this.navigable;
    nav.fill(0);
    this.navBody.fill(0);
    this.seaEntry = null;
    const label = new Int32Array(size);
    const queue = new Int32Array(size);
    const onEdge = (i) => {
      const x = i % w;
      const y = (i / w) | 0;
      return x === 0 || y === 0 || x === w - 1 || y === h - 1;
    };
    let best = null;
    let next = 0;
    for (let start = 0; start < size; start++) {
      if (!onEdge(start) || this.terrain[start] !== Terrain.WATER || label[start]) continue;
      next++;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      label[start] = next;
      const edgeTiles = [];
      while (head < tail) {
        const i = queue[head++];
        if (onEdge(i)) edgeTiles.push(i);
        const x = i % w;
        const y = (i / w) | 0;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
          if (j >= 0 && !label[j] && this.terrain[j] === Terrain.WATER) { label[j] = next; queue[tail++] = j; }
        }
      }
      if (tail < minTiles) continue;
      for (let k = 0; k < tail; k++) {
        nav[queue[k]] = 1;
        this.navBody[queue[k]] = next;
      }
      if (!best || tail > best.count) best = { count: tail, edgeTiles };
    }
    if (best) {
      // Middle of the edge stretch, so ships appear in open water, not a corner.
      const mid = best.edgeTiles[Math.floor(best.edgeTiles.length / 2)];
      this.seaEntry = { x: mid % w, y: (mid / w) | 0 };
    }
    return !!best;
  }

  /**
   * Water with fish, and its fishing grounds. Like navigable water, they
   * depend only on the terrain, which never changes after generation, so
   * they are derived at every new game and load and never saved (old saves
   * get them too). No random draws: the map generator's random stream is
   * untouched, so every map stays as it was.
   *
   *   1. Fishing water: every body of water (tiles joined side to side) of
   *      at least FISH_BODY_MIN tiles. Rivers, coasts and big lakes; not ponds.
   *   2. Each water tile's distance from land (Chebyshev, so 2 or more means
   *      all 8 neighbours are water). Grounds lie best 3 to 6 tiles out, not
   *      at the map's edge:
   *      open water, but not so far that boats spend the day sailing. A
   *      narrow river gets its widest spots.
   *   3. One ground per FISH_TILES_PER_GROUND tiles of a body, 1 to
   *      FISH_GROUNDS_PER_BODY, at least FISH_GROUND_SPACING apart; at most
   *      FISH_GROUNDS_MAX on the map, bigger bodies first. A body left with
   *      no ground is not fishing water (fishBody 0), like a pond.
   *   4. Ties: the tile's variant byte (random, saved, stable), then its index.
   */
  computeFishing(cfg = CONFIG) {
    const { w, h, size } = this;
    const body = this.fishBody;
    body.fill(0);
    this.fishingGrounds = [];
    const isWater = (i) => this.terrain[i] === Terrain.WATER;
    // 1. Bodies of water (4-connected), in tile order.
    const label = new Int32Array(size);
    const queue = new Int32Array(size);
    const bodies = [];
    for (let start = 0; start < size; start++) {
      if (!isWater(start) || label[start]) continue;
      const id = bodies.length + 1;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      label[start] = id;
      while (head < tail) {
        const i = queue[head++];
        const x = i % w;
        const y = (i / w) | 0;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
          if (j >= 0 && !label[j] && isWater(j)) { label[j] = id; queue[tail++] = j; }
        }
      }
      bodies.push({ id, tiles: Array.from(queue.subarray(0, tail)) });
    }
    // 2. Distance from land (8-connected BFS from every land tile).
    const dist = new Uint8Array(size).fill(255);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < size; i++) if (!isWater(i)) { dist[i] = 0; queue[tail++] = i; }
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      const y = (i / w) | 0;
      const d = dist[i] + 1;
      if (d > 254) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < h && dist[ny * w + nx] > d) { dist[ny * w + nx] = d; queue[tail++] = ny * w + nx; }
        }
      }
    }
    // How good a spot is (lower is better): 3 to 6 tiles from the shore is
    // best; within 3 tiles of the map's edge only if nothing else will do
    // (out there the water runs on off the map, far from any wharf).
    const score = (i) => {
      const d = dist[i];
      const x = i % w;
      const y = (i / w) | 0;
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y) < 3 ? 1000 : 0;
      return edge + (d >= 3 && d <= 6 ? 0 : d > 6 ? d - 6 : 100 - d);
    };
    // 3. Bigger bodies first (ties: the first in tile order).
    const fishing = bodies.filter((b) => b.tiles.length >= cfg.FISH_BODY_MIN).sort((a, b) => b.tiles.length - a.tiles.length || a.id - b.id);
    let n = 0;
    const max = Math.max(cfg.FISH_GROUNDS_MAX, Math.min(cfg.FISH_GROUNDS_MAX_CAP ?? cfg.FISH_GROUNDS_MAX, Math.round(cfg.FISH_GROUNDS_MAX * size / (96 * 96))));
    for (const b of fishing) {
      const want = Math.max(1, Math.min(cfg.FISH_GROUNDS_PER_BODY, Math.floor(b.tiles.length / cfg.FISH_TILES_PER_GROUND)));
      const cand = b.tiles.slice().sort((p, q) => score(p) - score(q) || this.variant[p] - this.variant[q] || p - q);
      const mine = [];
      for (const i of cand) {
        if (mine.length >= want || n >= max) break;
        const x = i % w;
        const y = (i / w) | 0;
        if (mine.some((g) => Math.max(Math.abs(g.x - x), Math.abs(g.y - y)) < cfg.FISH_GROUND_SPACING)) continue;
        mine.push({ x, y, body: b.id });
        n++;
      }
      // Water left without a ground (the map's 8 were taken by bigger
      // waters) has no fish worth a boat, like a pond: no shipyard or wharf
      // there, so no boat is built that could never fish.
      if (!mine.length) continue;
      for (const i of b.tiles) body[i] = b.id;
      this.fishingGrounds.push(...mine);
    }
    return this.fishingGrounds.length;
  }

  /** Fishing grounds on water body `id`. */
  groundsOf(id) {
    return id ? this.fishingGrounds.filter((g) => g.body === id) : [];
  }

  /**
   * Is there a low bridge on the map (as the boats' water was last worked
   * out)? Cheap: the water was split exactly when there is one
   * (splitAtLowBridges), so no scan of the layer.
   */
  hasLowBridge() {
    return this.navWhole !== this.navBody;
  }

  /**
   * Every water route for boats: the navigable water and the fishing water
   * from the terrain (placement reads them as they are), then each split
   * where a low bridge closes it. Runs at a load and whenever a low bridge
   * is built or cleared (sim/bridges.js refreshWaterways). The terrain never
   * changes, so the first two give the same answer every time.
   */
  computeWaterways() {
    this.computeNavigation();
    this.computeFishing();
    this.splitAtLowBridges();
  }

  /**
   * No boat passes a low bridge, so it cuts the water it spans in two: its
   * tiles leave navBody and fishBody (0, like land), and water joined only
   * through them gets a number of its own. In each body the part holding
   * its first tile (in tile order) keeps the body's number: with no low
   * bridge every number is what computeNavigation and computeFishing gave,
   * so every map, save and sim run is as before. A ship's or boat's `body`
   * then names the water it can really reach. Fishing grounds take the
   * number of the part they lie in (0 under a low bridge: nobody fishes
   * there). navWhole and fishWhole keep the bodies whole, to tell water
   * cut off by a low bridge from other water.
   */
  splitAtLowBridges() {
    if (this.bridgeLow.indexOf(1) < 0) {
      this.navWhole = this.navBody;
      this.fishWhole = this.fishBody;
      return;
    }
    this.navWhole = this.navBody.slice();
    this.fishWhole = this.fishBody.slice();
    this.splitLabels(this.navBody);
    this.splitLabels(this.fishBody);
    for (const g of this.fishingGrounds) g.body = this.fishBody[this.idx(g.x, g.y)];
  }

  /** Split the bodies numbered in `label` at the low bridges (see splitAtLowBridges). */
  splitLabels(label) {
    const { w, h, size } = this;
    const low = this.bridgeLow;
    let next = 1;
    for (let i = 0; i < size; i++) {
      if (low[i]) label[i] = 0;
      if (label[i] >= next) next = label[i] + 1;
    }
    const kept = new Set();
    const done = new Uint8Array(size);
    const queue = new Int32Array(size);
    for (let start = 0; start < size; start++) {
      const old = label[start];
      if (!old || done[start]) continue;
      const id = kept.has(old) ? next++ : old;
      kept.add(old);
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      done[start] = 1;
      while (head < tail) {
        const i = queue[head++];
        label[i] = id;
        const x = i % w;
        const y = (i / w) | 0;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
          if (j >= 0 && !done[j] && label[j] === old) { done[j] = 1; queue[tail++] = j; }
        }
      }
    }
  }

  /**
   * First water tile with fish orthogonally beside a footprint (where a
   * wharf's boat moors, or a shipyard launches), or -1.
   */
  fishWaterBeside(x, y, S) {
    for (let d = 0; d < S; d++) {
      for (const [tx, ty] of [[x + d, y - 1], [x + S, y + d], [x + d, y + S], [x - 1, y + d]]) {
        if (this.inBounds(tx, ty) && this.fishBody[this.idx(tx, ty)]) return this.idx(tx, ty);
      }
    }
    return -1;
  }

  /**
   * First navigable water tile orthogonally beside a footprint (a dock's
   * berth), or -1 if the footprint is not on a navigable shore. Never under
   * a low bridge: no ship gets there.
   */
  navigableBeside(x, y, S) {
    for (let d = 0; d < S; d++) {
      for (const [tx, ty] of [[x + d, y - 1], [x + S, y + d], [x + d, y + S], [x - 1, y + d]]) {
        if (this.inBounds(tx, ty) && this.navigable[this.idx(tx, ty)] && !this.bridgeLow[this.idx(tx, ty)]) return this.idx(tx, ty);
      }
    }
    return -1;
  }

  /**
   * Label connected road networks. Each connected group of road tiles gets
   * the same positive id in map.roadNet. Two buildings can exchange walkers
   * only if their access roads share a network id.
   */
  computeRoadNetworks() {
    const { w, h, size } = this;
    const net = this.roadNet;
    net.fill(0);
    const stack = new Int32Array(size);
    let label = 0;
    for (let start = 0; start < size; start++) {
      if (this.road[start] === 0 || net[start] !== 0) continue;
      label++;
      let sp = 0;
      stack[sp++] = start;
      net[start] = label;
      while (sp > 0) {
        const i = stack[--sp];
        const x = i % w;
        const y = (i / w) | 0;
        if (x > 0 && this.road[i - 1] && !net[i - 1]) { net[i - 1] = label; stack[sp++] = i - 1; }
        if (x < w - 1 && this.road[i + 1] && !net[i + 1]) { net[i + 1] = label; stack[sp++] = i + 1; }
        if (y > 0 && this.road[i - w] && !net[i - w]) { net[i - w] = label; stack[sp++] = i - w; }
        if (y < h - 1 && this.road[i + w] && !net[i + w]) { net[i + w] = label; stack[sp++] = i + w; }
      }
    }
    return label;
  }

  /** Iterate the 4 orthogonal neighbors that are in bounds. */
  forNeighbors4(x, y, fn) {
    for (let k = 0; k < 4; k++) {
      const nx = x + DIRS4[k][0];
      const ny = y + DIRS4[k][1];
      if (this.inBounds(nx, ny)) fn(nx, ny, k);
    }
  }

  /** Count tiles of a terrain type inside a square footprint. */
  countTerrain(x, y, size, type) {
    let n = 0;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        if (this.terrainAt(x + dx, y + dy) === type) n++;
      }
    }
    return n;
  }

  /**
   * Is any tile within `radius` (Chebyshev) of the footprint of the given terrain type?
   * Used for "must be near water/trees/rocks" placement rules.
   */
  /** How many tiles of `type` lie within `radius` of a footprint (outside it). */
  countNearTerrain(x, y, size, type, radius = 1) {
    let n = 0;
    for (let ty = y - radius; ty < y + size + radius; ty++) {
      for (let tx = x - radius; tx < x + size + radius; tx++) {
        if (tx >= x && tx < x + size && ty >= y && ty < y + size) continue;
        if (this.inBounds(tx, ty) && this.terrain[this.idx(tx, ty)] === type) n++;
      }
    }
    return n;
  }

  isNearTerrain(x, y, size, type, radius = 1) {
    for (let ty = y - radius; ty < y + size + radius; ty++) {
      for (let tx = x - radius; tx < x + size + radius; tx++) {
        if (tx >= x && tx < x + size && ty >= y && ty < y + size) continue;
        if (this.terrainAt(tx, ty) === type && this.inBounds(tx, ty)) return true;
      }
    }
    return false;
  }

  /** Serialize the persistent layers (see core/save.js). */
  serialize(encode) {
    return {
      w: this.w,
      h: this.h,
      entry: { ...this.entry },
      exit: { ...this.exit },
      entryDir: this.entryDir,
      exitDir: this.exitDir,
      terrain: encode(this.terrain),
      variant: encode(this.variant),
      road: encode(this.road),
      aqueduct: encode(this.aqueduct),
      rubble: encode(this.rubble),
      fixedRoad: encode(this.fixedRoad),
      wall: encode(this.wall),
      roadblock: encode(this.roadblock),
      bridgeLow: encode(this.bridgeLow),
    };
  }

  /** Rebuild a map from serialized data. Derived layers are recomputed by the game. */
  static deserialize(data, decode) {
    const m = new GameMap(data.w, data.h);
    const layers = ['terrain', 'variant', 'road', 'aqueduct', 'rubble', 'fixedRoad', 'wall', 'roadblock', 'bridgeLow'];
    for (const name of layers) {
      // Older saves had no walls or roadblocks, and no low bridges (every bridge passed ships).
      if (data[name] === undefined && (name === 'wall' || name === 'roadblock' || name === 'bridgeLow')) continue;
      const arr = decode(data[name], m.size);
      if (arr.length !== m.size) throw new Error(`Save file map layer "${name}" has wrong size`);
      m[name].set(arr);
    }
    m.entry = { x: data.entry.x, y: data.entry.y };
    m.exit = { x: data.exit.x, y: data.exit.y };
    const dir = (d) => (Array.isArray(d) && d.length === 2 && Math.abs(d[0]) + Math.abs(d[1]) === 1 ? [d[0], d[1]] : null);
    m.entryDir = dir(data.entryDir); // (older saves have none)
    m.exitDir = dir(data.exitDir);
    m.computeWaterDistance();
    m.computeRoadNetworks();
    for (let i = 0; i < m.size; i++) if (m.bridgeLow[i] && m.road[i] !== Road.BRIDGE) m.bridgeLow[i] = 0; // (only ever on a bridge)
    m.computeWaterways();
    return m;
  }
}

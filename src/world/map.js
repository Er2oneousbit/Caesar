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

    // --- derived layers (recomputed, not saved) ---
    this.building = new Int32Array(this.size); // building id occupying the tile, 0 = none
    this.desirability = new Int16Array(this.size);
    this.water = new Uint8Array(this.size); // WaterBits
    this.roadNet = new Int32Array(this.size); // road network component id (0 = no road)
    this.waterDist = new Uint8Array(this.size); // distance to nearest water tile (capped 255)
    this.navigable = new Uint8Array(this.size); // 1 = water that ships can sail (reaches the map edge)

    /** Edge water tile where merchant ships appear and leave, or null (no sea access). */
    this.seaEntry = null;

    /** Entry/exit tiles for the imperial road (set by mapgen). */
    this.entry = { x: 0, y: 0 };
    this.exit = { x: 0, y: 0 };

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
   * sail under bridges. Also picks `seaEntry`, the edge tile of the largest
   * such body where ships come and go (middle of its longest edge stretch).
   * Water never changes after map generation, so this runs once per game.
   */
  computeNavigation(minTiles = 80) {
    const { w, h, size } = this;
    const nav = this.navigable;
    nav.fill(0);
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
      for (let k = 0; k < tail; k++) nav[queue[k]] = 1;
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
   * First navigable water tile orthogonally beside a footprint (a dock's
   * berth), or -1 if the footprint is not on a navigable shore.
   */
  navigableBeside(x, y, S) {
    for (let d = 0; d < S; d++) {
      for (const [tx, ty] of [[x + d, y - 1], [x + S, y + d], [x + d, y + S], [x - 1, y + d]]) {
        if (this.inBounds(tx, ty) && this.navigable[this.idx(tx, ty)]) return this.idx(tx, ty);
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
      terrain: encode(this.terrain),
      variant: encode(this.variant),
      road: encode(this.road),
      aqueduct: encode(this.aqueduct),
      rubble: encode(this.rubble),
      fixedRoad: encode(this.fixedRoad),
      wall: encode(this.wall),
    };
  }

  /** Rebuild a map from serialized data. Derived layers are recomputed by the game. */
  static deserialize(data, decode) {
    const m = new GameMap(data.w, data.h);
    const layers = ['terrain', 'variant', 'road', 'aqueduct', 'rubble', 'fixedRoad', 'wall'];
    for (const name of layers) {
      if (data[name] === undefined && name === 'wall') continue; // older saves had no walls
      const arr = decode(data[name]);
      if (arr.length !== m.size) throw new Error(`Save file map layer "${name}" has wrong size`);
      m[name].set(arr);
    }
    m.entry = { x: data.entry.x, y: data.entry.y };
    m.exit = { x: data.exit.x, y: data.exit.y };
    m.computeWaterDistance();
    m.computeRoadNetworks();
    m.computeNavigation();
    return m;
  }
}

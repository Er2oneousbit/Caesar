/**
 * mapgen.js
 * ----------------------------------------------------------------------------
 * Procedural map generator.
 *
 * Pipeline:
 *   1. Fill the base terrain (grass, or sand for deserts).
 *   2. Carve water according to the map type (river, coast, lakes, ponds).
 *   3. Sprinkle meadows (fertile land, more common near water), forests and
 *      rock outcrops using fbm noise with percentile thresholds so every seed
 *      gets similar proportions.
 *   4. Add beaches next to water.
 *   5. Lay the Imperial Road from an entry tile on one map edge to an exit tile
 *      on another edge using A* (it avoids water and rocks when it can).
 *   6. Clear rock within about ROAD_ROCK_CLEARANCE tiles of that road. Every
 *      city starts along it and rock can never be cleared, so outcrops
 *      hugging the road would wall off the first building lots. The tiles
 *      get the ground they would have had without the rock.
 *
 * The same (seed, size, type) always produces the same map.
 * ----------------------------------------------------------------------------
 */

import { GameMap, Terrain, Road } from './map.js';
import { RNG } from '../core/rng.js';
import { ValueNoise } from './noise.js';
import { PathFinder } from './pathfinding.js';

/** Sandbox map sizes (tiles per side). Uber is the engine's maximum (GameMap allows up to 256). */
export const MAP_SIZES = Object.freeze({ small: 64, medium: 96, large: 128, uber: 256 });

/**
 * Rock-free distance each side of the Imperial road, in tiles. The edge is
 * ragged (+-1 tile of noise), so rock never comes closer than this minus 1.
 */
export const ROAD_ROCK_CLEARANCE = 5;

/** One-line notes shown under the size picker. */
export const MAP_SIZE_NOTES = Object.freeze({
  small: 'Quick games; room for a town.',
  medium: 'Room for a city.',
  large: 'Room for a great city.',
  uber: 'Sixteen times the land of Small: room for a capital and its whole province. Settlers bound for far-off homes ride in with pack mules. Saves run a few hundred KB.',
});

export const MAP_TYPES = Object.freeze({
  river: { name: 'River Valley', desc: 'A river winds through fertile floodplains. Plenty of water, meadows along the banks.' },
  coast: { name: 'Coastline', desc: 'The sea borders one side of the province. Beaches, fishing waters and trade.' },
  lakes: { name: 'Lake District', desc: 'Scattered lakes and forests. Good all-round land.' },
  plains: { name: 'Open Plains', desc: 'Wide grassland with only small ponds. Water is scarce; plan aqueducts.' },
  desert: { name: 'Desert Frontier', desc: 'Sand everywhere, fertile land only around oases. A real challenge.' },
});

/**
 * Value at a given percentile of a Float32Array (0..1). Used to turn noise into
 * "the top 10% of tiles" style thresholds.
 */
function percentile(values, p) {
  const sorted = Float32Array.from(values).sort();
  const k = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[k];
}

/**
 * Generate a new map.
 * @param {{width:number, height:number, seed:number|string, type:string}} opts
 * @returns {{map: GameMap, info: object}}
 */
export function generateMap({ width, height, seed, type }) {
  if (!MAP_TYPES[type]) throw new Error(`Unknown map type "${type}"`);
  const rng = new RNG(`${seed}:${width}x${height}:${type}`);
  const map = new GameMap(width, height);
  const nWater = new ValueNoise(rng);
  const nMeadow = new ValueNoise(rng);
  const nTrees = new ValueNoise(rng);
  const nRock = new ValueNoise(rng);
  const nDetail = new ValueNoise(rng);
  const info = { type, seed, river: null, coastSide: -1 };

  // 1. Base terrain
  map.terrain.fill(type === 'desert' ? Terrain.SAND : Terrain.GRASS);

  // 2. Water
  if (type === 'river') info.river = carveRiver(map, rng, nWater);
  else if (type === 'coast') info.coastSide = carveCoast(map, rng, nWater);
  else carveLakes(map, nWater, type === 'lakes' ? 0.1 : type === 'plains' ? 0.03 : 0.045, type === 'lakes' ? 20 : 14);

  map.computeWaterDistance();

  // 3. Meadows, forests and rocks via percentile thresholds on noise.
  const { size, w } = map;
  const meadowVal = new Float32Array(size);
  const treeVal = new Float32Array(size);
  const rockVal = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = i % w;
    const y = (i / w) | 0;
    const wd = map.waterDist[i];
    // Meadows like water: add a bonus near rivers/lakes (floodplains).
    const nearWater = wd <= 5 ? (6 - wd) * 0.05 : 0;
    meadowVal[i] = nMeadow.fbm(x / 13, y / 13, 3) + nearWater;
    treeVal[i] = nTrees.fbm(x / 11 + 50, y / 11 + 50, 4);
    rockVal[i] = nRock.fbm(x / 8 + 100, y / 8 + 100, 3);
  }
  const meadowCut = percentile(meadowVal, type === 'desert' ? 0.93 : 0.8);
  const treeCut = percentile(treeVal, type === 'desert' ? 0.96 : 0.84);
  const rockCut = percentile(rockVal, type === 'desert' ? 0.93 : 0.95);
  const base = type === 'desert' ? Terrain.SAND : Terrain.GRASS;

  /**
   * The ground a land tile gets when it is not rock: forest, meadow or plain.
   * No random draws, so step 6 can ask again without changing the rest of
   * the map for this seed.
   */
  const groundAt = (i) => {
    const wd = map.waterDist[i];
    if (treeVal[i] > treeCut && (type !== 'desert' || wd <= 6)) return Terrain.TREES;
    if (meadowVal[i] > meadowCut && (type !== 'desert' || wd <= 6)) return Terrain.MEADOW;
    return base;
  };

  for (let i = 0; i < size; i++) {
    if (map.terrain[i] === Terrain.WATER) continue;
    if (rockVal[i] > rockCut && map.waterDist[i] > 2) {
      map.terrain[i] = Terrain.ROCK;
      continue;
    }
    const ground = groundAt(i);
    if (ground !== base) map.terrain[i] = ground;
    else if (type !== 'desert' && rng.chance(0.012)) map.terrain[i] = Terrain.TREES; // lone trees for variety
  }

  // 4. Beaches: land touching water sometimes becomes sand.
  for (let i = 0; i < size; i++) {
    const t = map.terrain[i];
    if (t === Terrain.WATER || t === Terrain.ROCK) continue;
    if (map.waterDist[i] === 1) {
      const x = i % w;
      const y = (i / w) | 0;
      const beachy = nDetail.noise(x / 4, y / 4);
      if ((type === 'coast' && beachy > 0.25) || beachy > 0.72) map.terrain[i] = Terrain.SAND;
    }
  }

  // 5. Imperial road, then 6. keep rock away from it
  const roadPath = placeImperialRoad(map, rng, type, info);
  clearRocksNearRoad(map, roadPath, groundAt, nDetail);

  // Visual variants
  for (let i = 0; i < size; i++) map.variant[i] = rng.int(256);

  map.computeWaterDistance();
  map.computeRoadNetworks();
  map.touch();
  return { map, info };
}

/** Carve a meandering river across the map. Returns { axis, centers }. */
function carveRiver(map, rng, noise) {
  const axis = rng.chance(0.5) ? 'x' : 'y';
  const along = axis === 'x' ? map.w : map.h;
  const across = axis === 'x' ? map.h : map.w;
  const base = across * (0.35 + rng.next() * 0.3);
  const amp = across * 0.28;
  const centers = [];
  let prevC = null;
  for (let t = 0; t < along; t++) {
    let c = base + (noise.fbm(t / 22, 3.7, 3) - 0.5) * 2 * amp;
    c = Math.max(7, Math.min(across - 8, c));
    const width = 2 + Math.floor(noise.noise(t / 9, 11.3) * 2.99);
    const lo = Math.min(c, prevC ?? c) - width / 2;
    const hi = Math.max(c, prevC ?? c) + width / 2;
    for (let a = Math.floor(lo); a <= Math.ceil(hi) - 1; a++) {
      if (a < 0 || a >= across) continue;
      const x = axis === 'x' ? t : a;
      const y = axis === 'x' ? a : t;
      map.terrain[map.idx(x, y)] = Terrain.WATER;
    }
    centers.push(c);
    prevC = c;
  }
  // A small oxbow lake near the river adds variety.
  if (rng.chance(0.7)) {
    const t = rng.range(Math.floor(along * 0.2), Math.floor(along * 0.8));
    const side = rng.chance(0.5) ? -1 : 1;
    const c = centers[t] + side * rng.range(6, 9);
    const r = rng.range(2, 3);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + 1) continue;
        const x = axis === 'x' ? t + dx : Math.round(c) + dx;
        const y = axis === 'x' ? Math.round(c) + dy : t + dy;
        if (map.inBounds(x, y)) map.terrain[map.idx(x, y)] = Terrain.WATER;
      }
    }
  }
  return { axis, centers };
}

/**
 * Flood one map edge with sea, with a noisy coastline.
 * Side: 0 = y=0 edge, 1 = x=max edge, 2 = y=max edge, 3 = x=0 edge.
 */
function carveCoast(map, rng, noise) {
  const side = rng.int(4);
  const { w, h } = map;
  const depthBase = Math.min(w, h) * 0.2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let d;
      let along;
      if (side === 0) { d = y; along = x; }
      else if (side === 1) { d = w - 1 - x; along = y; }
      else if (side === 2) { d = h - 1 - y; along = x; }
      else { d = x; along = y; }
      const depth = depthBase + (noise.fbm(along / 16, 2.5, 4) - 0.5) * depthBase * 1.1;
      if (d < depth) map.terrain[map.idx(x, y)] = Terrain.WATER;
    }
  }
  return side;
}

/** Lakes/ponds: the top `fraction` of a noise field becomes water. */
function carveLakes(map, noise, fraction, scale) {
  const { size, w } = map;
  const vals = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = i % w;
    const y = (i / w) | 0;
    vals[i] = noise.fbm(x / scale, y / scale, 4);
  }
  const cut = percentile(vals, 1 - fraction);
  for (let i = 0; i < size; i++) if (vals[i] > cut) map.terrain[i] = Terrain.WATER;
}

/** Find the land tile on an edge closest to the desired position. */
function snapToLandOnEdge(map, edge, pos) {
  const { w, h } = map;
  const len = edge === 'x0' || edge === 'x1' ? h : w;
  for (let off = 0; off < len; off++) {
    for (const s of [1, -1]) {
      const p = Math.round(pos + s * off);
      if (p < 2 || p >= len - 2) continue;
      let x;
      let y;
      if (edge === 'x0') { x = 0; y = p; }
      else if (edge === 'x1') { x = w - 1; y = p; }
      else if (edge === 'y0') { x = p; y = 0; }
      else { x = p; y = h - 1; }
      const t = map.terrain[map.idx(x, y)];
      if (t !== Terrain.WATER && t !== Terrain.ROCK) return { x, y };
    }
  }
  // Worst case: force a tile to grass.
  const x = edge === 'x0' ? 0 : edge === 'x1' ? w - 1 : Math.floor(w / 2);
  const y = edge === 'y0' ? 0 : edge === 'y1' ? h - 1 : Math.floor(h / 2);
  map.terrain[map.idx(x, y)] = Terrain.GRASS;
  return { x, y };
}

/** Choose entry/exit points and connect them with a road. */
function placeImperialRoad(map, rng, type, info) {
  const { w, h } = map;
  let entryEdge;
  let exitEdge;
  let entryPos;
  let exitPos;

  if (type === 'river' && info.river) {
    // Keep the road on one bank so the starting city is not split by water.
    const { axis, centers } = info.river;
    const across = axis === 'x' ? h : w;
    const cStart = centers[0];
    const cEnd = centers[centers.length - 1];
    const lowSpace = Math.min(cStart, cEnd);
    const highSpace = across - Math.max(cStart, cEnd);
    const useLow = lowSpace > highSpace;
    const pick = (c) => (useLow ? Math.max(4, c * 0.45) : Math.min(across - 5, c + (across - c) * 0.55));
    entryEdge = axis === 'x' ? 'x0' : 'y0';
    exitEdge = axis === 'x' ? 'x1' : 'y1';
    entryPos = pick(cStart);
    exitPos = pick(cEnd);
  } else if (type === 'coast') {
    // Run the road parallel to the coast, well inland.
    const side = info.coastSide;
    const inland = (len) => len * (0.55 + rng.next() * 0.2);
    if (side === 0 || side === 2) {
      entryEdge = 'x0';
      exitEdge = 'x1';
      entryPos = side === 0 ? inland(h) : h - inland(h);
      exitPos = side === 0 ? inland(h) : h - inland(h);
    } else {
      entryEdge = 'y0';
      exitEdge = 'y1';
      entryPos = side === 3 ? inland(w) : w - inland(w);
      exitPos = side === 3 ? inland(w) : w - inland(w);
    }
  } else {
    const horizontal = rng.chance(0.5);
    entryEdge = horizontal ? 'x0' : 'y0';
    exitEdge = horizontal ? 'x1' : 'y1';
    const len = horizontal ? h : w;
    entryPos = len * (0.25 + rng.next() * 0.5);
    exitPos = len * (0.25 + rng.next() * 0.5);
  }

  const entry = snapToLandOnEdge(map, entryEdge, entryPos);
  const exit = snapToLandOnEdge(map, exitEdge, exitPos);
  map.entry = entry;
  map.exit = exit;

  // Cost model: prefer grass, avoid meadows/forests a bit, avoid water and
  // rock strongly (they become bridges / get blasted only if unavoidable).
  const pf = new PathFinder(map);
  const wobble = new ValueNoise(rng);
  const cost = (i) => {
    const t = map.terrain[i];
    const x = i % w;
    const y = (i / w) | 0;
    let c = 1 + wobble.noise(x / 6, y / 6) * 0.8;
    if (t === Terrain.MEADOW) c += 0.6;
    else if (t === Terrain.TREES) c += 1.5;
    else if (t === Terrain.WATER) c += 30;
    else if (t === Terrain.ROCK) c += 60;
    // Avoid hugging the map border
    if (x < 2 || y < 2 || x > w - 3 || y > h - 3) c += 2;
    return c;
  };
  const path = pf.astar(map.idx(entry.x, entry.y), map.idx(exit.x, exit.y), cost, { turnPenalty: 2.5 });
  if (!path) throw new Error('Map generation failed to connect the imperial road');
  for (const i of path) {
    const t = map.terrain[i];
    if (t === Terrain.WATER) {
      map.road[i] = Road.BRIDGE;
    } else {
      if (t === Terrain.TREES || t === Terrain.ROCK) map.terrain[i] = Terrain.GRASS;
      map.road[i] = Road.ROAD;
    }
  }
  map.fixedRoad[map.idx(entry.x, entry.y)] = 1;
  map.fixedRoad[map.idx(exit.x, exit.y)] = 1;
  info.roadLength = path.length;
  return path;
}

/**
 * Turn rock within about ROAD_ROCK_CLEARANCE tiles of the road back into the
 * ground it would have been (groundAt). The radius wobbles by up to a tile
 * with low-frequency noise, so the outcrops keep a natural, ragged edge
 * instead of a ruler-straight one. Rock elsewhere stays for quarries and mines.
 */
function clearRocksNearRoad(map, path, groundAt, noise) {
  const { w } = map;
  const reach = ROAD_ROCK_CLEARANCE + 1;
  for (const i of path) {
    const cx = i % w;
    const cy = (i / w) | 0;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (!map.inBounds(x, y)) continue;
        const j = y * w + x;
        if (map.terrain[j] !== Terrain.ROCK) continue;
        const r = ROAD_ROCK_CLEARANCE + (noise.noise(x / 3 + 40, y / 3 + 40) - 0.5) * 2;
        if (dx * dx + dy * dy <= r * r) map.terrain[j] = groundAt(j);
      }
    }
  }
}

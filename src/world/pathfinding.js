/**
 * pathfinding.js
 * ----------------------------------------------------------------------------
 * Grid search helpers shared by walkers, construction and map generation.
 *
 *   bfsRoad()        breadth-first search over road tiles (walkers)
 *   roadPath()       shortest road path between two road tiles
 *   findNearest()    nearest building (by road distance) matching a predicate
 *   astar()          weighted A* with optional turn penalty (road planning, mapgen)
 *
 * All searches reuse preallocated typed arrays. A "generation stamp" marks
 * which entries are valid for the current search, so nothing needs clearing
 * between searches. That keeps hundreds of searches per second cheap.
 * ----------------------------------------------------------------------------
 */

/** Minimal binary min-heap of (priority, value) pairs using typed arrays. */
export class MinHeap {
  constructor(capacity) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
    this.length = 0;
  }

  clear() { this.length = 0; }

  push(key, val) {
    if (this.length >= this.keys.length) this._grow();
    let i = this.length++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.keys[i] = this.keys[parent];
      this.vals[i] = this.vals[parent];
      i = parent;
    }
    this.keys[i] = key;
    this.vals[i] = val;
  }

  /** Remove and return the value with the smallest key. */
  pop() {
    const top = this.vals[0];
    const lastKey = this.keys[--this.length];
    const lastVal = this.vals[this.length];
    let i = 0;
    const n = this.length;
    while (true) {
      let child = i * 2 + 1;
      if (child >= n) break;
      if (child + 1 < n && this.keys[child + 1] < this.keys[child]) child++;
      if (this.keys[child] >= lastKey) break;
      this.keys[i] = this.keys[child];
      this.vals[i] = this.vals[child];
      i = child;
    }
    this.keys[i] = lastKey;
    this.vals[i] = lastVal;
    return top;
  }

  _grow() {
    const k = new Float64Array(this.keys.length * 2);
    const v = new Int32Array(this.vals.length * 2);
    k.set(this.keys);
    v.set(this.vals);
    this.keys = k;
    this.vals = v;
  }
}

export class PathFinder {
  /** @param {import('./map.js').GameMap} map */
  constructor(map) {
    this.map = map;
    const n = map.size;
    this.stamp = new Uint32Array(n * 4); // *4 so A* can store (tile, direction) states
    this.gen = 1;
    this.dist = new Float64Array(n * 4);
    this.prev = new Int32Array(n * 4);
    this.queue = new Int32Array(n);
    this.heap = new MinHeap(1024);
    this.lastStart = -1;
  }

  _nextGen() {
    this.gen++;
    if (this.gen >= 0xfffffff0) {
      this.stamp.fill(0);
      this.gen = 1;
    }
  }

  /**
   * Breadth-first search across road tiles starting at `start` (a road tile).
   * @param {number} start          tile index
   * @param {(idx:number)=>boolean} isGoal  called for every reached road tile
   * @param {number} [maxDist]      stop expanding past this many steps
   * @returns {number} goal tile index or -1
   */
  bfsRoad(start, isGoal, maxDist = 1e9) {
    const { map } = this;
    const { w, h, road } = map;
    if (start < 0 || start >= map.size || road[start] === 0) return -1;
    this._nextGen();
    const gen = this.gen;
    const { stamp, dist, prev, queue } = this;
    let head = 0;
    let tail = 0;
    stamp[start] = gen;
    dist[start] = 0;
    prev[start] = -1;
    queue[tail++] = start;
    this.lastStart = start;
    while (head < tail) {
      const i = queue[head++];
      if (isGoal(i)) return i;
      const d = dist[i] + 1;
      if (d > maxDist) continue;
      const x = i % w;
      const y = (i / w) | 0;
      // Unrolled neighbor checks (hot path)
      if (y > 0) { const n = i - w; if (road[n] && stamp[n] !== gen) { stamp[n] = gen; dist[n] = d; prev[n] = i; queue[tail++] = n; } }
      if (x < w - 1) { const n = i + 1; if (road[n] && stamp[n] !== gen) { stamp[n] = gen; dist[n] = d; prev[n] = i; queue[tail++] = n; } }
      if (y < h - 1) { const n = i + w; if (road[n] && stamp[n] !== gen) { stamp[n] = gen; dist[n] = d; prev[n] = i; queue[tail++] = n; } }
      if (x > 0) { const n = i - 1; if (road[n] && stamp[n] !== gen) { stamp[n] = gen; dist[n] = d; prev[n] = i; queue[tail++] = n; } }
    }
    return -1;
  }

  /** After a BFS, rebuild the path from the search start to `goal` (inclusive). */
  buildPath(goal) {
    const out = [];
    let i = goal;
    let guard = 0;
    while (i !== -1 && guard++ < this.map.size) {
      out.push(i);
      i = this.prev[i];
    }
    out.reverse();
    return out;
  }

  /** Road distance of a tile reached in the most recent BFS, or -1. */
  reachedDist(i) { return this.stamp[i] === this.gen ? this.dist[i] : -1; }

  /**
   * Shortest path over roads between two road tiles.
   * @returns {number[]|null} list of tile indices from start to goal
   */
  roadPath(start, goal, maxDist = 1e9) {
    if (start === goal) return [start];
    const found = this.bfsRoad(start, (i) => i === goal, maxDist);
    return found === -1 ? null : this.buildPath(found);
  }

  /**
   * Find the nearest building (by road distance) for which `predicate(id)`
   * returns true. A building counts as reached when the search visits a road
   * tile orthogonally adjacent to its footprint.
   * @returns {{id:number, goal:number, path:number[]}|null}
   */
  findNearest(start, predicate, maxDist = 1e9, excludeId = 0) {
    const { map } = this;
    const { w, h, building } = map;
    const checked = new Map();
    let foundId = 0;
    const goal = this.bfsRoad(
      start,
      (i) => {
        const x = i % w;
        const y = (i / w) | 0;
        const neighbors = [y > 0 ? i - w : -1, x < w - 1 ? i + 1 : -1, y < h - 1 ? i + w : -1, x > 0 ? i - 1 : -1];
        for (const n of neighbors) {
          if (n < 0) continue;
          const id = building[n];
          if (!id || id === excludeId) continue;
          let ok = checked.get(id);
          if (ok === undefined) {
            ok = !!predicate(id);
            checked.set(id, ok);
          }
          if (ok) { foundId = id; return true; }
        }
        return false;
      },
      maxDist,
    );
    if (goal === -1) return null;
    return { id: foundId, goal, path: this.buildPath(goal) };
  }

  /**
   * Weighted A* over the grid (4-connected).
   * @param {number} start
   * @param {number} goal
   * @param {(idx:number, fromIdx:number)=>number} costFn  cost to enter idx; Infinity = blocked
   * @param {object} [opts]
   * @param {number} [opts.turnPenalty=0]  extra cost when the path changes direction
   * @param {number} [opts.maxNodes]       give up after expanding this many states
   * @returns {number[]|null}
   */
  astar(start, goal, costFn, opts = {}) {
    const { map } = this;
    const { w, h } = map;
    const turnPenalty = opts.turnPenalty || 0;
    const maxNodes = opts.maxNodes || map.size * 8;
    if (start === goal) return [start];
    this._nextGen();
    const gen = this.gen;
    const { stamp, dist, prev, heap } = this;
    heap.clear();
    const gx = goal % w;
    const gy = (goal / w) | 0;
    const hfn = (i) => Math.abs((i % w) - gx) + Math.abs(((i / w) | 0) - gy);
    // State = tile * 4 + incoming direction (0..3). Start uses all 4 "directions" with no penalty.
    for (let d = 0; d < 4; d++) {
      const s = start * 4 + d;
      stamp[s] = gen;
      dist[s] = 0;
      prev[s] = -1;
      heap.push(hfn(start), s);
    }
    const DX = [0, 1, 0, -1];
    const DY = [-1, 0, 1, 0];
    let expanded = 0;
    while (heap.length > 0) {
      const s = heap.pop();
      const i = s >> 2;
      const dir = s & 3;
      if (i === goal) {
        // rebuild path from state chain
        const out = [];
        let cur = s;
        let guard = 0;
        while (cur !== -1 && guard++ < map.size * 4) {
          const tile = cur >> 2;
          if (out.length === 0 || out[out.length - 1] !== tile) out.push(tile);
          cur = prev[cur];
        }
        out.reverse();
        return out;
      }
      if (++expanded > maxNodes) return null;
      const x = i % w;
      const y = (i / w) | 0;
      const base = dist[s];
      for (let nd = 0; nd < 4; nd++) {
        const nx = x + DX[nd];
        const ny = y + DY[nd];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        const c = costFn(n, i);
        if (!(c < Infinity)) continue;
        let g = base + c;
        if (turnPenalty && prev[s] !== -1 && nd !== dir) g += turnPenalty;
        const ns = n * 4 + nd;
        if (stamp[ns] === gen && dist[ns] <= g) continue;
        stamp[ns] = gen;
        dist[ns] = g;
        prev[ns] = s;
        heap.push(g + hfn(n), ns);
      }
    }
    return null;
  }
}

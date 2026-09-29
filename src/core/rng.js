/**
 * rng.js
 * ----------------------------------------------------------------------------
 * Seeded pseudo random number generator (sfc32 + splitmix32 seeding).
 *
 * Why seeded? Two reasons:
 *   1. Map generation is reproducible: same seed = same map. Great for bug
 *      reports ("seed 1234, medium river map").
 *   2. The RNG state is saved with the game, so a loaded save continues the
 *      exact same random sequence (useful when chasing simulation bugs).
 *
 * Math.random() is never used by the simulation. Rendering-only randomness
 * (sparkles, smoke puffs) may use Math.random() since it does not affect state.
 * ----------------------------------------------------------------------------
 */

/** Hash any string/number into a 32-bit unsigned int (FNV-1a for strings). */
export function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const s = String(seed);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class RNG {
  /** @param {number|string} seed */
  constructor(seed = 1) {
    this.a = 0; this.b = 0; this.c = 0; this.d = 0;
    this.setSeed(seed);
  }

  /** Re-seed the generator. Uses splitmix32 to spread the seed bits. */
  setSeed(seed) {
    let s = hashSeed(seed);
    const splitmix = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = splitmix(); this.b = splitmix(); this.c = splitmix(); this.d = splitmix();
    // Warm up so nearby seeds diverge quickly.
    for (let i = 0; i < 12; i++) this.next();
  }

  /** @returns {number} float in [0, 1) */
  next() {
    // sfc32 by Chris Doty-Humphrey (public domain algorithm)
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** Integer in [0, max) */
  int(max) { return Math.floor(this.next() * max); }

  /** Integer in [min, max] inclusive */
  range(min, max) { return min + Math.floor(this.next() * (max - min + 1)); }

  /** True with probability p */
  chance(p) { return this.next() < p; }

  /** Random element of a non-empty array */
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }

  /** In-place Fisher-Yates shuffle, returns the same array */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** Serializable state for save games */
  getState() { return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0]; }

  setState(state) {
    if (!Array.isArray(state) || state.length !== 4) throw new Error('Invalid RNG state');
    [this.a, this.b, this.c, this.d] = state.map((v) => v >>> 0);
  }
}

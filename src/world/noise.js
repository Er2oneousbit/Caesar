/**
 * noise.js
 * ----------------------------------------------------------------------------
 * Seeded 2D value noise + fractal Brownian motion (fbm).
 *
 * Value noise = random values on an integer lattice, smoothly interpolated.
 * fbm = several octaves of noise stacked at increasing frequency and
 * decreasing amplitude, which gives natural looking blobs (lakes, forests).
 * Output range is roughly [0, 1].
 * ----------------------------------------------------------------------------
 */

export class ValueNoise {
  /** @param {import('../core/rng.js').RNG} rng */
  constructor(rng) {
    this.perm = new Uint8Array(512);
    this.values = new Float32Array(256);
    const p = [];
    for (let i = 0; i < 256; i++) {
      p.push(i);
      this.values[i] = rng.next();
    }
    rng.shuffle(p);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  _lattice(ix, iy) {
    return this.values[this.perm[(this.perm[ix & 255] + iy) & 511]];
  }

  /** Smooth noise at (x, y), result in [0, 1]. */
  noise(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    // smootherstep fade for less grid-looking results
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const v00 = this._lattice(x0, y0);
    const v10 = this._lattice(x0 + 1, y0);
    const v01 = this._lattice(x0, y0 + 1);
    const v11 = this._lattice(x0 + 1, y0 + 1);
    const a = v00 + (v10 - v00) * sx;
    const b = v01 + (v11 - v01) * sx;
    return a + (b - a) * sy;
  }

  /**
   * Fractal noise.
   * @param {number} octaves    number of layers (3-5 is typical)
   * @param {number} lacunarity frequency multiplier per octave
   * @param {number} gain       amplitude multiplier per octave
   */
  fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += this.noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}

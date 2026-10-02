/**
 * view.js
 * ----------------------------------------------------------------------------
 * The view turn: the city seen from any of its four sides (0..3 quarter
 * turns clockwise on the screen), as the original's map rotation. Rendering
 * and input only: the sim never sees it.
 *
 * The renderer works in VIEW tiles. A W x H map seen at turn t is a map of
 * W' x H' view tiles (W and H swap on an odd turn), drawn with the usual
 * projection (camera.js): view tile (vx, vy) has its top corner at world px
 * ((vx - vy) * 32, (vx + vy) * 16). Turning by t is the same quarter turn
 * clockwise that render/turn.js gives building art (turn 1 takes +x to +y),
 * so a building is drawn with its art turned by `b.turn + t`.
 *
 * Map point -> view point (continuous coordinates, (x + 0.5, y + 0.5) a tile
 * center):
 *   t = 0   (x, y)
 *   t = 1   (H - y, x)
 *   t = 2   (W - x, H - y)
 *   t = 3   (y, W - x)
 * A direction (dx, dy) turns as render/turn.js turnDir: N becomes E at turn
 * 1, so a neighbour mask (bits N E S W) rotates left by t, and a corner mask
 * (NE SE SW NW) too.
 * ----------------------------------------------------------------------------
 */

/** View map size [W', H'] of a W x H map at turn t. */
export function viewSize(W, H, t) {
  return t & 1 ? [H, W] : [W, H];
}

/** A continuous map point (x, y) of a W x H map, in view coordinates at turn t. */
export function toView(x, y, t, W, H) {
  switch (t & 3) {
    case 1: return [H - y, x];
    case 2: return [W - x, H - y];
    case 3: return [y, W - x];
    default: return [x, y];
  }
}

/** A continuous view point back to map coordinates (the inverse of toView). */
export function fromView(vx, vy, t, W, H) {
  switch (t & 3) {
    case 1: return [vy, H - vx];
    case 2: return [W - vx, H - vy];
    case 3: return [W - vy, vx];
    default: return [vx, vy];
  }
}

/** The view tile of map tile (x, y). */
export function viewTileOf(x, y, t, W, H) {
  switch (t & 3) {
    case 1: return [H - 1 - y, x];
    case 2: return [W - 1 - x, H - 1 - y];
    case 3: return [y, W - 1 - x];
    default: return [x, y];
  }
}

/**
 * Map tile of a view tile, as an affine map of (vx, vy) so a loop over view
 * tiles finds each map tile with two multiply-adds: x = ox + xx * vx + xy * vy,
 * y = oy + yx * vx + yy * vy.
 */
export function tileAxes(t, W, H) {
  switch (t & 3) {
    case 1: return { ox: 0, xx: 0, xy: 1, oy: H - 1, yx: -1, yy: 0 };
    case 2: return { ox: W - 1, xx: -1, xy: 0, oy: H - 1, yx: 0, yy: -1 };
    case 3: return { ox: W - 1, xx: 0, xy: -1, oy: 0, yx: 1, yy: 0 };
    default: return { ox: 0, xx: 1, xy: 0, oy: 0, yx: 0, yy: 1 };
  }
}

/** A w x h footprint at map tile (x, y), in view tiles: its corner nearest the view's top [vx, vy]. */
export function viewFoot(x, y, w, h, t, W, H) {
  const a = toView(x, y, t, W, H);
  const b = toView(x + w, y + h, t, W, H);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
}

/** A direction (dx, dy) on the map, as seen at view turn t (render/turn.js turnDir). */
export function viewDir(dx, dy, t) {
  switch (t & 3) {
    case 1: return [-dy, dx];
    case 2: return [-dx, -dy];
    case 3: return [dy, -dx];
    default: return [dx, dy];
  }
}

/** A 4-bit neighbour mask (N E S W, or NE SE SW NW) as seen at view turn t. */
export function rotMask(m, t) {
  t &= 3;
  return t ? ((m << t) | (m >> (4 - t))) & 15 : m;
}

/** Each 4-bit group of a mask rotated (an aqueduct's links and reservoirs, a blend's edges and corners). */
export function rotNibbles(m, t, groups = 2) {
  if (!(t & 3)) return m;
  let out = m & ~((1 << (4 * groups)) - 1);
  for (let g = 0; g < groups; g++) out |= rotMask((m >> (4 * g)) & 15, t) << (4 * g);
  return out;
}

/** A blend code (render/renderer.js blendCode: ground << 8 | edges << 4 | corners) as seen at view turn t. */
export function rotBlend(code, t) {
  return code > 0 ? rotNibbles(code, t, 2) : code;
}

/** A road-like axis ('u' along x, 'v' along y) as seen at view turn t. */
export function viewAxis(axis, t) {
  return t & 1 ? (axis === 'u' ? 'v' : 'u') : axis;
}

/**
 * shipArt.js
 * ----------------------------------------------------------------------------
 * Ships of war, drawn live every frame like walkers and soldiers (all
 * procedural and original), seen from the side and turned to their heading:
 *
 *   liburnian    the provincial fleet's light warship: a long low hull with
 *                two banks of oars that stroke as it rows, a bronze ram at the
 *                waterline, an eye painted on the bow against ill luck, a
 *                curled sternpost, marines' shields along the rail and a
 *                square sail with a red stripe (furled in battle, at its berth
 *                and lying still: it fights under oars alone). Red and gold:
 *                Rome's.
 *   raider_ship  a dark, lean longship with a tall curled prow, one bank of
 *                oars and a patched brown sail; the raiders aboard show
 *                behind their round shields, and the one at the bow swings a
 *                burning pot when it throws.
 *
 * (sx, sy) is the waterline under the middle of the hull, in device pixels;
 * k is the pixel scale (zoom x devicePixelRatio), as in walkerArt.js.
 * ----------------------------------------------------------------------------
 */

const ROME_RED = '#a8322b';
const GOLD = '#d6ab3c';
const BRONZE = '#b8862e';
const SKIN = ['#e3b68c', '#c99a6b', '#a8784e', '#f0caa2'];
const RAIDER_SHIELDS = ['#8a6a44', '#5a3c22', '#9b7a3a', '#6e5236'];
// Oar strokes per tile rowed (the oars move with the distance, so they rest when the ship does).
const STROKE_RAD = Math.PI * 2 * 1.4;

/**
 * Draw a ship of war (a unit with `naval`).
 * @param {number} t      animation time (s)
 * @param {number} tick   sim tick (shot flashes)
 * @param {boolean} highlight ring it (selected, or of the selected station)
 * @param {number} stride tiles rowed (interpolated): drives the oars
 */
export function drawWarship(ctx, u, sx, sy, k, t, tick, highlight, stride, facing = u.facing) {
  if (u.type === 'raider_ship') drawRaiderShip(ctx, u, sx, sy, k, t, tick, highlight, stride, facing);
  else drawLiburnian(ctx, u, sx, sy, k, t, tick, highlight, stride, facing);
}

/** Frame for a hull: X(dx), Y(dy) in hull units, bow toward +dx turned to face `f`. */
function frame(sx, sy, K, f, bob) {
  return { X: (dx) => sx + dx * f * K, Y: (dy) => sy + bob + dy * K };
}

function wake(ctx, sx, sy, K, moving) {
  ctx.fillStyle = moving ? 'rgba(235,245,255,0.35)' : 'rgba(20,40,60,0.18)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + 1 * K, (moving ? 22 : 17) * K, (moving ? 3.8 : 2.6) * K, 0, 0, Math.PI * 2);
  ctx.fill();
}

function ring(ctx, sx, sy, K) {
  ctx.strokeStyle = 'rgba(255,230,120,0.9)';
  ctx.lineWidth = 1.2 * K;
  ctx.beginPath();
  ctx.ellipse(sx, sy + 0.5 * K, 24 * K, 6 * K, 0, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * A bank of oars between dx0 and dx1, from the hull at height `y0` down into
 * the water. Rowing: each oar swings fore and aft with the stroke; at rest
 * (moving false) the oars lie still, blades just in the water; shipped (at a
 * berth) only the looms show, drawn in.
 */
function oars(ctx, F, f, K, dx0, dx1, n, y0, phase, mode, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.75 * K;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const dx = dx0 + ((dx1 - dx0) * i) / (n - 1);
    if (mode === 'shipped') {
      ctx.moveTo(F.X(dx), F.Y(y0));
      ctx.lineTo(F.X(dx - 1.2), F.Y(y0 + 1.6));
      continue;
    }
    const swing = mode === 'rowing' ? Math.sin(phase) : 0;
    const lift = mode === 'rowing' ? Math.max(0, Math.cos(phase)) * 1.6 : 0; // blades come out of the water on the return
    ctx.moveTo(F.X(dx), F.Y(y0));
    ctx.lineTo(F.X(dx + swing * 3.2), F.Y(4.2 - lift));
  }
  ctx.stroke();
}

function drawLiburnian(ctx, u, sx, sy, k, t, tick, highlight, stride, facing = u.facing) {
  const K = k * 1.3;
  const f = facing < 0 ? -1 : 1;
  const F = frame(sx, sy, K, f, Math.sin(t * 2 + u.id) * 0.5 * K);
  const { X, Y } = F;
  const fighting = u.state === 'engage';
  const atBerth = u.state === 'berthed';
  const rowing = u.moving;
  if (highlight) ring(ctx, sx, sy, K);
  wake(ctx, sx, sy, K, rowing);
  const phase = stride * STROKE_RAD;
  const mode = atBerth ? 'shipped' : rowing ? 'rowing' : 'rest';
  // the hull: long and low, the stem rising at the bow, the stern curling up
  ctx.fillStyle = '#5a3a22';
  ctx.beginPath();
  ctx.moveTo(X(-17), Y(-8));
  ctx.lineTo(X(13), Y(-8));
  ctx.quadraticCurveTo(X(17), Y(-9), X(18), Y(-13));
  ctx.lineTo(X(18.6), Y(-12.6));
  ctx.quadraticCurveTo(X(18.4), Y(-6), X(16), Y(-2.2));
  ctx.lineTo(X(10), Y(0.9));
  ctx.lineTo(X(-11), Y(0.9));
  ctx.quadraticCurveTo(X(-17), Y(0.2), X(-18.5), Y(-5));
  ctx.closePath();
  ctx.fill();
  // the oar box along the side, where the oars come out, and the red band under the rail
  ctx.fillStyle = '#3e2816';
  ctx.fillRect(Math.min(X(-13), X(12)), Y(-5.9), 25 * K, 3.6 * K);
  ctx.fillStyle = '#2a1a0e'; // the two rows of oar ports
  for (let i = 0; i < 9; i++) {
    ctx.fillRect(X(-12 + i * 2.85) - 0.45 * K, Y(-5.4), 0.9 * K, 0.8 * K);
    ctx.fillRect(X(-11 + i * 2.85) - 0.45 * K, Y(-3.5), 0.9 * K, 0.8 * K);
  }
  ctx.fillStyle = ROME_RED;
  ctx.fillRect(Math.min(X(-16), X(13)), Y(-7.6), 29 * K, 1.5 * K);
  ctx.fillStyle = GOLD; // the gilded rail
  ctx.fillRect(Math.min(X(-16.5), X(13)), Y(-8.4), 29.5 * K, 0.8 * K);
  // the bronze ram at the waterline: a blunt three-finned beak
  ctx.fillStyle = BRONZE;
  ctx.beginPath();
  ctx.moveTo(X(15.6), Y(-3.4));
  ctx.lineTo(X(22.5), Y(-1.9));
  ctx.lineTo(X(22.8), Y(-1.1));
  ctx.lineTo(X(15.6), Y(0.2));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#e8c36a';
  ctx.lineWidth = 0.5 * K;
  ctx.beginPath(); ctx.moveTo(X(16.5), Y(-1.6)); ctx.lineTo(X(22.2), Y(-1.5)); ctx.stroke();
  // the eye on the bow
  ctx.fillStyle = '#f2eee6';
  ctx.beginPath(); ctx.ellipse(X(14.6), Y(-5.9), 1.35 * K, 0.85 * K, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1d2a3a';
  ctx.beginPath(); ctx.arc(X(14.6) + f * 0.35 * K, Y(-5.9), 0.55 * K, 0, Math.PI * 2); ctx.fill();
  // the sternpost curling up and forward, gilded
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1.1 * K;
  ctx.beginPath();
  ctx.moveTo(X(-17.5), Y(-7.5));
  ctx.quadraticCurveTo(X(-21.5), Y(-11), X(-19.5), Y(-15.5));
  ctx.quadraticCurveTo(X(-18.5), Y(-16.5), X(-17.6), Y(-15));
  ctx.stroke();
  // the steering oar on the quarter
  ctx.strokeStyle = '#3a2618';
  ctx.lineWidth = 1 * K;
  ctx.beginPath(); ctx.moveTo(X(-14), Y(-9)); ctx.lineTo(X(-18), Y(2)); ctx.stroke();
  // two banks of oars, the upper (darker) stroking a beat behind the lower
  oars(ctx, F, f, K, -12, 10.8, 9, -5, phase + 0.5, mode, '#6b4a2c');
  oars(ctx, F, f, K, -11, 11.8, 9, -3.1, phase, mode, '#a07a4e');
  // mast, yard and sail (furled in battle and at the berth: it fights under oars)
  ctx.fillStyle = '#4a3222';
  ctx.fillRect(X(-1) - 0.6 * K, Y(-31), 1.2 * K, 23 * K);
  ctx.fillRect(Math.min(X(-10), X(8)), Y(-29), 18 * K, 1.1 * K);
  if (fighting || atBerth || !rowing) { // (and lying still where it was sent)
    ctx.fillStyle = '#ece4cf';
    ctx.fillRect(Math.min(X(-9.5), X(7.5)), Y(-28.2), 17 * K, 2.2 * K);
  } else {
    ctx.fillStyle = '#ece4cf';
    ctx.beginPath();
    ctx.moveTo(X(-9), Y(-28));
    ctx.lineTo(X(7), Y(-28));
    ctx.quadraticCurveTo(X(9.5), Y(-20.5), X(7), Y(-13));
    ctx.lineTo(X(-9), Y(-13));
    ctx.quadraticCurveTo(X(-6.5), Y(-20.5), X(-9), Y(-28));
    ctx.fill();
    ctx.fillStyle = ROME_RED; // the stripe down the middle
    ctx.fillRect(Math.min(X(-2.6), X(0.6)), Y(-28), 3.2 * K, 15 * K);
  }
  // the pennant at the masthead
  ctx.fillStyle = ROME_RED;
  ctx.beginPath();
  ctx.moveTo(X(-1), Y(-31));
  ctx.lineTo(X(-1) - f * 6 * K, Y(-30) + Math.sin(t * 4 + u.id) * K);
  ctx.lineTo(X(-1), Y(-29));
  ctx.fill();
  // marines behind their shields along the rail; the one at the bow draws a bow when it shoots
  const shooting = tick - u.strikeTick < 8;
  for (const [i, dx] of [-9, -4, 3, 8].entries()) {
    ctx.fillStyle = SKIN[(u.id + i) % SKIN.length];
    ctx.beginPath(); ctx.arc(X(dx), Y(-10.6), 1.2 * K, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9aa1aa'; // helmet
    ctx.beginPath(); ctx.arc(X(dx), Y(-11), 1.25 * K, Math.PI, 0); ctx.fill();
    ctx.fillStyle = ROME_RED;
    ctx.fillRect(X(dx) - 1.3 * K, Y(-10), 2.6 * K, 2.4 * K);
    ctx.fillStyle = GOLD;
    ctx.fillRect(X(dx) - 0.35 * K, Y(-9.2), 0.7 * K, 0.7 * K);
  }
  if (shooting) {
    ctx.strokeStyle = '#6b4a2a';
    ctx.lineWidth = 0.7 * K;
    ctx.beginPath(); ctx.arc(X(10.5), Y(-11), 2.6 * K, -1.2, 1.2); ctx.stroke();
  }
  if (u.hp < u.maxHp) health(ctx, u, sx, Y(-35), K, tick);
}

function drawRaiderShip(ctx, u, sx, sy, k, t, tick, highlight, stride, facing = u.facing) {
  const K = k * 1.25;
  const f = facing < 0 ? -1 : 1;
  const F = frame(sx, sy, K, f, Math.sin(t * 2.2 + u.id) * 0.6 * K);
  const { X, Y } = F;
  const rowing = u.moving;
  if (highlight) ring(ctx, sx, sy, K);
  wake(ctx, sx, sy, K, rowing);
  // shadowed red water under it, like a raider's shadow: it reads as hostile at a glance
  ctx.fillStyle = 'rgba(120,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(sx, sy + 1.2 * K, 15 * K, 2.4 * K, 0, 0, Math.PI * 2); ctx.fill();
  const phase = stride * STROKE_RAD;
  // the hull: dark and lean, a tall prow curling back at the bow, a low one at the stern
  ctx.fillStyle = '#2b1f17';
  ctx.beginPath();
  ctx.moveTo(X(-15), Y(-6));
  ctx.lineTo(X(14), Y(-6));
  ctx.quadraticCurveTo(X(18), Y(-7), X(19.5), Y(-15));
  ctx.quadraticCurveTo(X(19.8), Y(-18), X(17.6), Y(-17.2));
  ctx.lineTo(X(18.2), Y(-15.4));
  ctx.quadraticCurveTo(X(17.5), Y(-5), X(12), Y(0.7));
  ctx.lineTo(X(-10), Y(0.7));
  ctx.quadraticCurveTo(X(-15), Y(0), X(-17.5), Y(-9));
  ctx.lineTo(X(-16.6), Y(-9.4));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#5a4230'; // a pale strake along the side
  ctx.lineWidth = 0.6 * K;
  ctx.beginPath(); ctx.moveTo(X(-14), Y(-3.4)); ctx.lineTo(X(15), Y(-3.4)); ctx.stroke();
  // the head on the prow: a pale knot of carved wood
  ctx.fillStyle = '#b89a6a';
  ctx.beginPath(); ctx.arc(X(18.4), Y(-17.2), 1.1 * K, 0, Math.PI * 2); ctx.fill();
  // one bank of oars
  oars(ctx, F, f, K, -10, 10, 7, -4.2, phase, rowing ? 'rowing' : 'rest', '#6b5236');
  // mast and the patched sail (furled while it waits offshore)
  ctx.fillStyle = '#3a2a1e';
  ctx.fillRect(X(-1) - 0.55 * K, Y(-25), 1.1 * K, 19 * K);
  ctx.fillRect(Math.min(X(-8), X(6)), Y(-23.5), 14 * K, 1 * K);
  if (u.state === 'offshore') {
    ctx.fillStyle = '#7a6040';
    ctx.fillRect(Math.min(X(-7.5), X(5.5)), Y(-23), 13 * K, 2 * K);
  } else {
    ctx.fillStyle = '#7a6040';
    ctx.beginPath();
    ctx.moveTo(X(-7), Y(-23));
    ctx.lineTo(X(5), Y(-23));
    ctx.quadraticCurveTo(X(7.5), Y(-16), X(5), Y(-10));
    ctx.lineTo(X(-7), Y(-10));
    ctx.quadraticCurveTo(X(-5), Y(-16), X(-7), Y(-23));
    ctx.fill();
    ctx.fillStyle = '#5c4630'; // patches
    ctx.fillRect(X(-4.5) - 1.5 * K, Y(-20), 3 * K, 3 * K);
    ctx.fillRect(X(2) - 1.2 * K, Y(-15), 2.4 * K, 2.6 * K);
  }
  // the raiders aboard behind their round shields: the crew while it carries one, else a few hands
  const aboard = Math.max(2, Math.min(5, (u.crew || []).length));
  for (let i = 0; i < aboard; i++) {
    const dx = 10 - i * 5;
    ctx.fillStyle = SKIN[(u.id + i) % SKIN.length];
    ctx.beginPath(); ctx.arc(X(dx), Y(-8.4), 1.15 * K, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c9a14a'; // hair
    ctx.beginPath(); ctx.arc(X(dx), Y(-8.9), 1.15 * K, Math.PI, 0); ctx.fill();
    ctx.fillStyle = RAIDER_SHIELDS[(u.id + i) % RAIDER_SHIELDS.length];
    ctx.beginPath(); ctx.arc(X(dx), Y(-6.6), 1.6 * K, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#c9a36b';
    ctx.lineWidth = 0.4 * K;
    ctx.stroke();
  }
  // a fire pot swung at the bow as it throws
  if (tick - u.strikeTick < 8) {
    const fx = X(12.5);
    const fy = Y(-12);
    ctx.fillStyle = '#5a3c22';
    ctx.beginPath(); ctx.arc(fx, fy, 1.2 * K, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,170,40,0.9)';
    ctx.beginPath(); ctx.ellipse(fx, fy - 1.6 * K, 0.9 * K, 1.7 * K, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (u.hp < u.maxHp) health(ctx, u, sx, Y(-28), K, tick);
}

/** A health bar over a damaged ship; it flashes white for a moment after a hit. */
function health(ctx, u, sx, y, K, tick) {
  const w = 16 * K;
  const h = 1.8 * K;
  const fr = Math.max(0, u.hp / u.maxHp);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(sx - w / 2 - 0.5 * K, y - 0.5 * K, w + K, h + K);
  ctx.fillStyle = fr > 0.6 ? '#5ec04a' : fr > 0.3 ? '#e0b03a' : '#d9412b';
  ctx.fillRect(sx - w / 2, y, w * fr, h);
  if (tick - u.hitTick < 4) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 0.6 * K;
    ctx.strokeRect(sx - w / 2 - 0.5 * K, y - 0.5 * K, w + K, h + K);
  }
}

/**
 * empireRoutes.js (data)
 * ----------------------------------------------------------------------------
 * The ways across the empire map from wherever the province sits (its site,
 * data/sites.js): each trade partner's route, the days its traders need on
 * it, the army's way to a distant battle and the road Caesar's legions take
 * from Rome. Pure data and arithmetic (no canvas, no randomness), so the sim
 * can use it: the traders' trip sets how often a far partner's traders can
 * come (sim/tradeDemand.js), and the army's way its march in months
 * (data/battles.js).
 *
 * The network
 *   Two graphs of [lon, lat] points: roads over land and lanes over water.
 *   Their spine is the twelve routes drawn for the Etruscan coast (ROUTES_LL
 *   in data/empireGeo.js), each a chain from its partner to that site; the
 *   roads and lanes below join every other site to it. A route is the
 *   shortest way through the graph of its kind (by straight length on the
 *   map, ties to the first point listed), and is drawn, as it always was, as
 *   a smooth curve through the partner, the points and the site. A test
 *   holds the Etruscan coast's twelve routes to exactly their old points and
 *   lengths: an edge that would make one of them shorter has no place here.
 *   On roads a city may be a stage on the way (Corduba's caravans from
 *   Lugdunum pass through Tarraco); a sea lane only begins or ends at one.
 *   A site with a river (Corduba) reaches the lanes at its river's mouth.
 *
 * Distance (Colonia's own rule; the original's trade ignored its map)
 *   A trader is on the road TRIP_DAYS_PER_UNIT days for every map unit of
 *   its route each way (tripDays). A quiet route cannot send traders more
 *   often than one can go home and come back, so its usual interval is
 *   stretched to at least the round trip (sim/tradeDemand.js visitInterval).
 *   From the Etruscan coast every round trip fits in the usual interval, so
 *   nothing changes there.
 * ----------------------------------------------------------------------------
 */

import { project, isLand, ROUTES_LL } from './empireGeo.js';
import { TRADE_PARTNERS } from './scenarios.js';
import { SITES, HOME_SITE } from './sites.js';

/**
 * Days a caravan or ship needs per map unit of its route, each way: about 78
 * km a game day, a caravan's pace on Roman roads, and a slow one for a ship
 * that hugs the coast and waits for wind. Any slower and the round trip to
 * Tarraco (25.5 units) or Alexandria (57.9) from the Etruscan coast would
 * outgrow the usual interval between visits.
 */
export const TRIP_DAYS_PER_UNIT = 0.5;

/** Rome, the Emperor's seat on the Tiber, where Caesar's legions set out. */
export const ROME_LL = Object.freeze([12.48, 41.9]);

// ---------------------------------------------------------------------------
// The roads and lanes added to the Etruscan coast's routes. A chain names its
// points in order: [lon, lat], a partner id ('tarraco') or a site ('@corduba').
// The same point must be written the same way everywhere it appears.
// ---------------------------------------------------------------------------

const ROMA = [12.48, 41.95]; // the road through Rome on Capua's route
const NEMAUSUS = [4.36, 43.84];
const PO_CROSSING = [9.6, 44.95];
const BONONIA = [11.35, 44.55];
const APENNINE_WEST = [9.8, 44.3];
const LUCA = [10.5, 43.85];
const HISPALIS = [-5.99, 37.39];

const ROADS = [
  // The Via Augusta down the coast of Hispania and over to the Baetis.
  ['tarraco', [0.52, 40.81], [-0.4, 39.7], [-0.6, 39.0], [-3.63, 38.03], '@corduba', HISPALIS],
  [HISPALIS, [-5.75, 36.6], '@carteia'],
  // Up the Rhone to Lugdunum, and the spur to Narbo.
  [NEMAUSUS, [4.85, 44.55], [4.87, 45.52], 'lugdunum'],
  [[3.0, 43.3], '@narbo'],
  // The Via Aemilia and the Adriatic coast down to Apulia and over to Capua.
  [PO_CROSSING, '@mutina', BONONIA, [12.45, 43.98], [13.45, 43.55], '@firmum', '@castrum_novum', [14.3, 42.2], [14.92, 41.8], '@luceria', '@beneventum', 'capua'],
  // The Via Salaria from Firmum to Rome.
  ['@firmum', [13.58, 42.85], [12.86, 42.4], ROMA],
  // Campania and the south.
  ['capua', '@puteoli'],
  ['capua', [14.67, 40.74], '@paestum'],
  [[14.67, 40.74], [15.5, 40.45], [16.1, 39.85], '@copia'],
  // Etruria.
  [ROMA, '@cosa', [11.9, 42.5]],
  [[11.9, 42.5], '@volsinii'],
  ['@populonia', '@etruria'],
  ['@etruria', '@figline', [11.2, 43.2]],
  ['@figline', BONONIA],
  ['@figline', LUCA, APENNINE_WEST],
  [APENNINE_WEST, '@luna'],
  ['@luna', LUCA, [10.9, 44.1]],
  ['@luna', [10.2, 44.4]],
];

const MASSILIA_LANE = [5.7, 42.95];
const GADES_LANE = [5.2, 39.6];
const CARTHAGO_LANE = [10.5, 37.4];
const CORINTHUS_LANE = [18.5, 38.0];
const MESSINA_SOUTH = [16.4, 37.7];
const ALEXANDRIA_LANE = [17.5, 36.6];
const TYRRHENIAN = [12.4, 40.0];
const OFF_CAPRI = [13.9, 40.45];
const CALABRIA = [14.4, 38.9];
const SALERNUM = [14.8, 40.3];
const CORSICA_EAST = [10.25, 42.7];
const ELBA = [10.9, 41.6];
const PISAE_WEST = [9.85, 43.72];
const PISAE_SOUTH = [[10.1, 43.3], [10.0, 43.3], [9.95, 43.3]];
const STRAIT = [-5.6, 35.95];
const BAETICA = [-4.5, 36.15];
const CAPE_LACINIUM = [17.6, 38.9];

const LANES = [
  // The Gulf of Lion, from Narbo to the Massilia and Gades lanes.
  ['@narbo', [3.6, 42.95], MASSILIA_LANE],
  [[3.6, 42.95], GADES_LANE],
  // South of Sardinia and Sicily, from the Balearic sea to the east.
  [GADES_LANE, [8.0, 38.7], CARTHAGO_LANE, [11.75, 37.35], [13.8, 36.55], [15.2, 36.35], ALEXANDRIA_LANE],
  [[8.0, 38.7], [7.8, 37.55]],
  [[15.2, 36.35], MESSINA_SOUTH],
  // Across the Tyrrhenian, so a ship from the south need not call at Pisae.
  [TYRRHENIAN, [10.75, 39.0], [10.3, 39.4]],
  [PISAE_WEST, ...PISAE_SOUTH],
  [CORSICA_EAST, [8.7, 43.62]],
  // The strait, and the mouth of the Baetis.
  [[-6.36, 36.8], [-6.45, 36.3]],
  ['@carteia', STRAIT],
  ['@carteia', BAETICA],
  // Off Saguntum: a dead end, for the army's ships (a distant battle) only.
  [[2.5, 38.75], [0.2, 39.6]],
  // Campania.
  ['@puteoli', [14.05, 40.7], OFF_CAPRI, TYRRHENIAN],
  [OFF_CAPRI, CALABRIA],
  ['@paestum', SALERNUM, CALABRIA],
  [SALERNUM, OFF_CAPRI],
  // Copia, round Cape Lacinium.
  ['@copia', [17.1, 39.8], CAPE_LACINIUM, CORINTHUS_LANE],
  [CAPE_LACINIUM, MESSINA_SOUTH],
  // The harbors of Luna, Populonia and Cosa.
  ...[PISAE_WEST, ...PISAE_SOUTH].map((p) => ['@luna', p]),
  ...[CORSICA_EAST, ...PISAE_SOUTH, PISAE_WEST].map((p) => ['@populonia', p]),
  ['@cosa', CORSICA_EAST],
  ['@cosa', ELBA],
];

// ---------------------------------------------------------------------------
// The graphs
// ---------------------------------------------------------------------------

/** A chain's point: { key, pos, city } (city: a partner's or a site's own point). */
function nodeOf(ref) {
  if (Array.isArray(ref)) return { key: `${ref[0]},${ref[1]}`, pos: project(ref), city: false };
  if (ref.startsWith('@')) {
    const s = SITES[ref.slice(1)];
    if (!s) throw new Error(`empireRoutes: unknown site ${ref}`);
    return { key: ref, pos: s.pos, city: true };
  }
  const p = TRADE_PARTNERS[ref];
  if (!p) throw new Error(`empireRoutes: unknown partner ${ref}`);
  return { key: ref, pos: p.pos, city: true };
}

const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);

/** A graph from chains: nodes in the order first listed, edges both ways. */
function buildGraph(chains) {
  const nodes = [];
  const index = new Map();
  const add = (ref) => {
    const n = nodeOf(ref);
    if (!index.has(n.key)) { index.set(n.key, nodes.length); nodes.push({ ...n, links: [] }); }
    return index.get(n.key);
  };
  for (const chain of chains) {
    for (let i = 1; i < chain.length; i++) {
      const a = add(chain[i - 1]);
      const b = add(chain[i]);
      if (a === b || nodes[a].links.some((l) => l.to === b)) continue;
      const d = dist(nodes[a].pos, nodes[b].pos);
      nodes[a].links.push({ to: b, d });
      nodes[b].links.push({ to: a, d });
    }
  }
  return { nodes, index };
}

/** The Etruscan coast's routes of one kind, as chains from each partner to the site. */
function spine(kind) {
  return Object.entries(ROUTES_LL)
    .filter(([id]) => (TRADE_PARTNERS[id]?.route === 'sea' ? 'sea' : 'land') === kind)
    .map(([id, pts]) => [id, ...pts, `@${HOME_SITE}`]);
}

let graphs = null;
function graph(kind) {
  if (!graphs) graphs = { land: buildGraph([...spine('land'), ...ROADS]), sea: buildGraph([...spine('sea'), ...LANES]) };
  return graphs[kind];
}

/** Every road (kind 'land') or lane ('sea') as { a, b, aCity, bCity }: its ends and whether each is a city's own point (for the tests). */
export function networkEdges(kind) {
  const { nodes } = graph(kind);
  const out = [];
  nodes.forEach((n, i) => { for (const l of n.links) if (l.to > i) out.push({ a: n.pos, b: nodes[l.to].pos, aCity: n.city, bCity: nodes[l.to].city }); });
  return out;
}

/**
 * Shortest distances from node `from` over a graph (Dijkstra; ties go to the
 * node listed first, so the result never depends on anything but the data).
 * On lanes a city's node is an end, never a stage on the way.
 */
function shortest(kind, from) {
  const { nodes } = graph(kind);
  const d = new Array(nodes.length).fill(Infinity);
  const prev = new Array(nodes.length).fill(-1);
  const done = new Array(nodes.length).fill(false);
  d[from] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && d[i] < Infinity && (u < 0 || d[i] < d[u])) u = i;
    if (u < 0) break;
    done[u] = true;
    if (u !== from && kind === 'sea' && nodes[u].city) continue;
    for (const { to, d: len } of nodes[u].links) {
      if (d[u] + len < d[to]) { d[to] = d[u] + len; prev[to] = u; }
    }
  }
  return { d, prev };
}

const treeCache = new Map();
function treeFrom(kind, key) {
  const k = `${kind}|${key}`;
  if (!treeCache.has(k)) {
    const i = graph(kind).index.get(key);
    treeCache.set(k, i === undefined ? null : shortest(kind, i));
  }
  return treeCache.get(k);
}

/** The nodes from the tree's root to node `to`, inclusive, or null if it cannot be reached. */
function walkBack(tree, to) {
  if (!tree || to === undefined || tree.d[to] === Infinity) return null;
  const out = [];
  for (let i = to; i >= 0; i = tree.prev[i]) out.push(i);
  return out.reverse();
}

/** The key of the node where a site meets a graph: its own, or on the lanes its river's mouth. */
function gateKey(siteId, kind) {
  const s = SITES[siteId];
  if (kind === 'sea' && s.river) { const m = s.river[s.river.length - 1]; return `${m[0]},${m[1]}`; }
  return `@${siteId}`;
}

/** The points ships pass between a site and its river's mouth (none for a site on the sea). */
function riverPoints(siteId, kind) {
  const s = SITES[siteId];
  return kind === 'sea' && s.river ? s.river.map((p) => project(p)) : [];
}

// ---------------------------------------------------------------------------
// Curves (drawn, and measured: a route's length is its curve's)
// ---------------------------------------------------------------------------

/** Points per stretch between two waypoints when a route is turned into a line. */
export const CURVE_STEPS = 10;

/**
 * Centripetal Catmull-Rom curve through `pts`, as a polyline. Centripetal
 * (rather than uniform) keeps the curve from overshooting or looping at
 * sharp turns, so a lane threading a strait stays in it.
 */
export function smoothLine(pts) {
  if (pts.length < 3) return pts.map((p) => [p[0], p[1]]);
  const ext = (a, b) => [2 * a[0] - b[0], 2 * a[1] - b[1]]; // mirror for the ends
  const all = [ext(pts[0], pts[1]), ...pts, ext(pts[pts.length - 1], pts[pts.length - 2])];
  const out = [[pts[0][0], pts[0][1]]];
  for (let i = 1; i < all.length - 2; i++) {
    const [p0, p1, p2, p3] = [all[i - 1], all[i], all[i + 1], all[i + 2]];
    const knot = (a, b) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
    const t1 = knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    const lerp = (a, b, ta, tb, t) => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
    for (let s = 1; s <= CURVE_STEPS; s++) {
      const t = t1 + ((t2 - t1) * s) / CURVE_STEPS;
      const a1 = lerp(p0, p1, 0, t1, t);
      const a2 = lerp(p1, p2, t1, t2, t);
      const a3 = lerp(p2, p3, t2, t3, t);
      const b1 = lerp(a1, a2, 0, t2, t);
      const b2 = lerp(a2, a3, t1, t3, t);
      out.push(lerp(b1, b2, t1, t2, t));
    }
  }
  return out;
}

/** Distance run at each point of a polyline. */
function cumulative(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}

/** Length of a polyline (map units). */
export function lineLength(pts) {
  const cum = cumulative(pts);
  return cum[cum.length - 1];
}

// ---------------------------------------------------------------------------
// Trade routes
// ---------------------------------------------------------------------------

/**
 * The points a partner's route passes between the partner (first) and the
 * site (last), both left out: the shortest way through the roads or lanes,
 * and up the site's river for a ship. Null if no way exists.
 */
export function routeWaypoints(siteId, partnerId) {
  const p = TRADE_PARTNERS[partnerId];
  if (!p || !SITES[siteId]) return null;
  const kind = p.route === 'sea' ? 'sea' : 'land';
  const { nodes, index } = graph(kind);
  const way = walkBack(treeFrom(kind, gateKey(siteId, kind)), index.get(partnerId));
  if (!way) return null;
  // From the gate to the partner: turn it round, drop the partner, keep the gate unless it is the site.
  const pts = way.reverse().slice(1).map((i) => nodes[i].pos);
  if (gateKey(siteId, kind) === `@${siteId}`) pts.pop();
  return [...pts, ...riverPoints(siteId, kind).reverse().slice(1)];
}

const pathCache = new Map();

/**
 * A partner's route from a site as drawn: { pts, cum, len, river }, a
 * polyline from the partner (first point) to the province (last), the
 * distance run at each point, and `river`: how much of its province end is a
 * river (map units; 0 but at Corduba). A partner the site has no way to is
 * joined by a straight line.
 */
export function routePath(siteId, partnerId) {
  const key = `${siteId}|${partnerId}`;
  let path = pathCache.get(key);
  if (path) return path;
  const p = TRADE_PARTNERS[partnerId];
  const site = SITES[siteId] || SITES[HOME_SITE];
  const way = routeWaypoints(siteId, partnerId) || [];
  const pts = smoothLine([p.pos, ...way, site.pos]);
  const cum = cumulative(pts);
  const len = cum[cum.length - 1];
  // The curve passes through each waypoint every CURVE_STEPS points: the
  // river begins at the mouth, the river's last point in the waypoints.
  const riverLegs = p.route === 'sea' ? riverPoints(siteId, 'sea').length : 0;
  const river = riverLegs && way.length >= riverLegs ? len - cum[(way.length + 1 - riverLegs) * CURVE_STEPS] : 0;
  path = { pts, cum, len, river };
  pathCache.set(key, path);
  return path;
}

/**
 * Days a partner's caravan or ship spends on the way from its city to the
 * province (and as many back): the route's length at TRIP_DAYS_PER_UNIT,
 * rounded, at least 1.
 */
export function tripDays(siteId, partnerId) {
  if (!TRADE_PARTNERS[partnerId]) return 1;
  return Math.max(1, Math.round(routePath(siteId, partnerId).len * TRIP_DAYS_PER_UNIT));
}

// ---------------------------------------------------------------------------
// Armies: the way to a distant battle, and the legions' road from Rome
// ---------------------------------------------------------------------------

/**
 * The points an army passes from a site toward `target` ([x, y]) by `kind`
 * ('land': the roads; 'sea': the lanes, and the site's river first): the
 * shortest way to the point of the network nearest the target that it can
 * reach, the site and the target left out. On the lanes that point is never
 * a city's harbor (a city's node is no stage on a ship's way).
 */
export function networkWay(siteId, kind, target) {
  const { nodes } = graph(kind);
  const tree = treeFrom(kind, gateKey(siteId, kind));
  const river = riverPoints(siteId, kind); // site side first, the mouth last
  // The river's own points come first, so one beside the target ends the way there.
  let best = null;
  river.forEach((p, i) => { const d = dist(p, target); if (!best || d < best.d) best = { d, river: i }; });
  if (tree) {
    nodes.forEach((n, i) => {
      if (tree.d[i] === Infinity || (kind === 'sea' && n.city && i !== graph(kind).index.get(gateKey(siteId, kind)))) return;
      const d = dist(n.pos, target);
      if (!best || d < best.d) best = { d, node: i };
    });
  }
  if (!best) return [];
  if (best.river !== undefined) return river.slice(0, best.river + 1);
  const way = walkBack(tree, best.node).map((i) => nodes[i].pos);
  if (!river.length) way.shift(); // (the site itself)
  return [...river.slice(0, -1), ...way];
}

/**
 * The road Caesar's legions take from Rome to a site, as points from Rome to
 * the site: along the roads (from Rome a straight line to Corduba would
 * cross the sea).
 */
export function legionWay(siteId) {
  const { nodes, index } = graph('land');
  const way = walkBack(treeFrom('land', `${ROMA[0]},${ROMA[1]}`), index.get(`@${siteId}`));
  const rome = project(ROME_LL);
  const site = (SITES[siteId] || SITES[HOME_SITE]).pos;
  if (!way) return [rome, site];
  // Rome itself in place of the road's point beside it, and the site last.
  return [rome, ...way.slice(1, -1).map((i) => nodes[i].pos), site];
}

/** Is every point `step` map units apart along the polyline on land (true) or water (false)? (For the tests.) */
export function lineOver(pts, land, { step = 0.25, skipStart = 0, skipEnd = 0 } = {}) {
  const cum = cumulative(pts);
  const len = cum[cum.length - 1];
  for (let s = skipStart; s <= len - skipEnd; s += step) {
    let i = 1;
    while (i < pts.length - 1 && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1];
    const u = seg > 0 ? (s - cum[i - 1]) / seg : 0;
    const q = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u];
    if (isLand(q) !== land) return { ok: false, at: q };
  }
  return { ok: true };
}

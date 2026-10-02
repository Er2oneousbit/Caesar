/**
 * cycle.js
 * ----------------------------------------------------------------------------
 * Going from building to building: the info panel's previous / next buttons
 * (every building of one kind, every Officina Lignaria say), its "next idle"
 * button (the idle ones of that kind), and the I key and the Production
 * advisor's button (the idle buildings of every kind). No DOM here, so tests
 * can read it.
 *
 * Idle: the info panel's status line (ui/infoPanel.js buildingStatus) says it
 * does not work (red: no road, no workers, no water...) or works badly (amber:
 * waiting for a raw material, nowhere to deliver, no shows booked, a farm
 * resting for the winter...), as the Problems overlay marks it. Understaffing
 * alone is left out: the building still works, only slower, and when labor is
 * short every building of a kind is understaffed, so "next idle" would only
 * repeat "next". Homes are not cycled (the Problems overlay covers them).
 *
 * Order: one kind's buildings by id, the order they were built in, which
 * stays put as the city changes (an order by place would jump about as
 * buildings come and go). Across kinds, the kinds come in the order
 * data/buildings.js lists them (related buildings together), so a tour of
 * the idle buildings shows all of one kind before the next. Both wrap around.
 * ----------------------------------------------------------------------------
 */

import { BUILDINGS } from '../data/buildings.js';
import { buildingStatus } from './infoPanel.js';

const KIND_ORDER = new Map(Object.keys(BUILDINGS).map((k, i) => [k, i]));

/** A building the cycle visits: not a home, and only a big building's main part (a hippodrome's sections show the hippodrome). */
export function cyclable(b) {
  return !!b && !b.house && !(b.main && b.main !== b.id);
}

/** Is building `b` idle (see the header)? */
export function isIdle(game, b) {
  if (!cyclable(b)) return false;
  const s = buildingStatus(game, b);
  return s.level === 'bad' || (s.level === 'warn' && !s.understaffed);
}

/** Every building of `type`, by id. */
export function buildingsOfKind(game, type) {
  const out = [];
  for (const b of game.buildings.values()) if (b.type === type && cyclable(b)) out.push(b);
  return out.sort((a, c) => a.id - c.id);
}

/**
 * The one after `from` in `list` (sorted by `key`), or before it when `dir`
 * is -1, wrapping around. `from` need not be in the list: the step starts
 * from where it would stand. Null for an empty list; `from` itself when it
 * is the only one.
 */
function step(list, key, from, dir) {
  if (!list.length) return null;
  const k = from ? key(from) : null;
  const cmp = (a, c) => (a[0] - c[0]) || (a[1] - c[1]);
  if (dir >= 0) return (k && list.find((b) => cmp(key(b), k) > 0)) || list[0];
  for (let i = list.length - 1; i >= 0; i--) if (!k || cmp(key(list[i]), k) < 0) return list[i];
  return list[list.length - 1];
}

/**
 * The next building of the same kind as `b` (dir 1) or the one before it
 * (dir -1); with `idle`, only idle ones. Null when there is none; `b` itself
 * when it is the only one.
 */
export function stepOfKind(game, b, dir = 1, idle = false) {
  if (!cyclable(b)) return null;
  const list = buildingsOfKind(game, b.type).filter((x) => !idle || isIdle(game, x));
  return step(list, (x) => [0, x.id], b, dir);
}

/** Every idle building in the city, kind by kind (see the header). */
export function idleBuildings(game) {
  const out = [];
  for (const b of game.buildings.values()) if (isIdle(game, b)) out.push(b);
  return out.sort((a, c) => (kindIndex(a) - kindIndex(c)) || (a.id - c.id));
}

function kindIndex(b) {
  return KIND_ORDER.get(b.type) ?? KIND_ORDER.size;
}

/**
 * The next idle building of any kind after `from` (a building, or null to
 * start at the first), or the one before it with dir -1. From a building of
 * some kind it goes on to that kind's next idle one, then the next kind's.
 * Null when nothing is idle.
 */
export function stepIdle(game, from, dir = 1) {
  return step(idleBuildings(game), (x) => [kindIndex(x), x.id], cyclable(from) ? from : null, dir);
}

/**
 * The I key's next stop: on from `open` (the building whose panel is open,
 * or null), else from `last` (the one it showed last; a walker's, a tile's
 * or a home's panel may have been opened since). `only`: the open building
 * is the only idle one, so there is nowhere else to go. It once compared
 * against `last` too, and then said "the only idle building" instead of
 * going back to it after a walker had been clicked.
 * @returns {{to: object|null, only: boolean}}
 */
export function nextIdleFrom(game, open, last, dir = 1) {
  const from = cyclable(open) ? open : cyclable(last) ? last : null;
  const to = stepIdle(game, from, dir);
  return { to, only: !!(to && cyclable(open) && to.id === open.id) };
}

/**
 * Where `b` stands among its kind, for the panel's row: its place (1-based),
 * how many there are, how many of them are idle and whether `b` is one.
 */
export function kindPosition(game, b) {
  const list = buildingsOfKind(game, b.type);
  const idle = list.filter((x) => isIdle(game, x));
  return { index: list.findIndex((x) => x.id === b.id) + 1, count: list.length, idle: idle.length, selfIdle: idle.includes(b) };
}

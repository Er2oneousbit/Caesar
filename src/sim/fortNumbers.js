/**
 * fortNumbers.js
 * ----------------------------------------------------------------------------
 * Every fort carries a number, as the legions did: Castra I, Praesidium II.
 * Shift+1..9 jumps to fort 1..9 (input/input.js, app.js), so a player need
 * not scroll back across the map to find an army.
 *
 * A new fort takes the lowest number no standing fort holds, so a fort
 * built after one was demolished takes the old one's number again and the
 * keys stay 1, 2, 3 rather than drifting to 7, 8, 9. The number is saved
 * (`b.number`): it depends on the order forts were built and torn down,
 * which a loaded city cannot work out again.
 *
 * Bookkeeping only: nothing in the simulation reads the number, and it uses
 * no randomness, so it cannot change how a city plays.
 * ----------------------------------------------------------------------------
 */

/**
 * The highest number a loaded fort may keep. No city comes near it; a
 * hand-edited file's 1e12 would otherwise be spelled out in numerals
 * (roman): hundreds of megabytes of "M".
 */
export const MAX_FORT_NUMBER = 999;

/** Is `b` a fort (legion, archer or cavalry)? Naval stations are not numbered. */
export function isFort(b) {
  return !!b && b.def.kind === 'fort';
}

/** The lowest number (1, 2, ...) no fort of the city holds, except fort `except`. */
export function freeFortNumber(game, except = 0) {
  const used = new Set();
  for (const b of game.buildings.values()) if (isFort(b) && b.id !== except && b.number > 0) used.add(b.number);
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/** The standing fort numbered `n`, or null. */
export function fortByNumber(game, n) {
  for (const b of game.buildings.values()) if (isFort(b) && b.number === n) return b;
  return null;
}

/**
 * Give every fort without a number one, in id order (the order they were
 * built): a save from before the numbers (core/save.js), or a hand-edited
 * one. Forts that have a number keep it; two forts with the same number
 * (a hand-edited file) leave the later one to be numbered afresh.
 */
export function numberForts(game) {
  const forts = [...game.buildings.values()].filter(isFort).sort((a, b) => a.id - b.id);
  const seen = new Set();
  for (const f of forts) {
    if (Number.isInteger(f.number) && f.number > 0 && f.number <= MAX_FORT_NUMBER && !seen.has(f.number)) seen.add(f.number);
    else f.number = 0;
  }
  for (const f of forts) {
    if (f.number > 0) continue;
    f.number = freeFortNumber(game, f.id);
  }
}

const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];

/** `n` in Roman numerals (1 -> I, 4 -> IV, 14 -> XIV); '' for anything under 1. */
export function roman(n) {
  let out = '';
  let left = Math.floor(n);
  if (!(left > 0)) return '';
  if (left > 3999) return String(left); // (past what the numerals spell: plain digits)
  for (const [v, s] of ROMAN) {
    while (left >= v) { out += s; left -= v; }
  }
  return out;
}

/** A fort's name with its number ("Castra III"); any other building's plain name. */
export function fortTitle(b) {
  return isFort(b) && b.number > 0 ? `${b.def.name} ${roman(b.number)}` : b.def.name;
}

/** The key that shows fort `b` ("Shift+3"), or '' past 9 (those are reached by their panel). */
export function fortKey(b) {
  return isFort(b) && b.number >= 1 && b.number <= 9 ? `Shift+${b.number}` : '';
}

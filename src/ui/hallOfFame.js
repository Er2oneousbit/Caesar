/**
 * hallOfFame.js
 * ----------------------------------------------------------------------------
 * The Hall of Fame's words: the list of the ten best wins and the career's
 * score (from the main menu and the campaign screen), and the lines on the
 * victory screen with this win's score, its parts and its place. The scores
 * and what is kept are sim/fame.js; menus.js frames these in its modals.
 * ----------------------------------------------------------------------------
 */

import { h, fmt } from './dom.js';
import { DIFFICULTY } from '../data/difficulty.js';
import { LAST_STEP } from '../data/scenarios.js';
import { FAME_TOP, FAME_BATTLE, FAME_RAID, FAME_CAESAR, ordinal } from '../sim/fame.js';

/** A stored date (YYYY-MM-DD) as the list shows it, or a dash. */
function dateText(d) {
  return typeof d === 'string' && d ? d : '-';
}

/** The hall: the career's score, then the ten best wins (or a word on how to get in). */
export function hallOfFameBody(app) {
  const fame = app.fame;
  const wins = fame.wins || [];
  const rows = wins.map((w, k) => h('tr', { class: 'fame-row', title: `Ratings ${w.parts?.ratings ?? '-'}, population ${fmt(w.population || 0)}, ${w.years} years; distant battles won ${w.battlesWon || 0}, raids repelled ${w.raidsRepelled || 0}` },
    h('td', { class: 'num' }, String(k + 1)),
    h('td', {}, h('b', {}, w.name), h('span', { class: 'muted' }, ` · step ${w.step}`)),
    h('td', {}, DIFFICULTY[w.difficulty]?.name || w.difficulty),
    h('td', { class: 'r num' }, fmt(w.score)),
    h('td', { class: 'r num' }, String(w.years)),
    h('td', { class: 'r num muted' }, dateText(w.date))));
  const career = fame.career?.score || 0;
  return [
    h('p', { class: 'fame-career' }, career
      ? `Your career: ${fmt(career)} points${fame.career.date ? ` (set ${fame.career.date})` : ''}${fame.careers ? `. Hailed Caesar ${fame.careers === 1 ? 'once' : `${fame.careers} times`}` : ''}.`
      : 'No career yet: win a campaign mission to enter the hall.'),
    wins.length
      ? h('table', { class: 'tbl fame' },
        h('tr', {}, h('th', {}, '#'), h('th', {}, 'Province'), h('th', {}, 'Level'), h('th', { class: 'r' }, 'Score'), h('th', { class: 'r' }, 'Years'), h('th', { class: 'r' }, 'Won')),
        rows)
      : null,
    h('p', { class: 'muted' }, `The ${FAME_TOP} best wins, each province once with its best. A win scores its four ratings added, plus 100 x its people / the population goal (at most 200), plus 100 x the planned years / the years it took (at most 150), all times the difficulty (Easy x0.5, Normal x1, Hard x1.5, Insane x2), plus ${FAME_BATTLE} for each distant battle won and ${FAME_RAID} for each raid repelled. The career adds the best win at each of the ${LAST_STEP} steps, and ${FAME_CAESAR} once Rome hails you Caesar. The sandbox is not scored.`),
  ];
}

/**
 * The victory screen's lines for this win (app.lastWin: the win and where it
 * went, set by app.js onVictory), or null for the sandbox.
 */
export function fameVictoryLines(app) {
  const r = app.lastWin;
  if (!r) return null;
  const { win, place, best, previous, career } = r;
  const p = win.parts;
  const level = DIFFICULTY[win.difficulty]?.name || win.difficulty;
  const parts = [
    h('tr', {}, h('td', {}, 'Ratings added'), h('td', { class: 'r num' }, fmt(p.ratings))),
    h('tr', {}, h('td', {}, `People: ${fmt(win.population)} against the goal`), h('td', { class: 'r num' }, fmt(p.population))),
    h('tr', {}, h('td', {}, win.paceYears ? `Pace: ${win.years} years against ${win.paceYears} planned` : 'Pace against the plan'), h('td', { class: 'r num' }, fmt(p.pace))),
    h('tr', {}, h('td', {}, `x ${p.mult} (${level})`), h('td', { class: 'r num' }, fmt(p.base))),
    p.battles ? h('tr', {}, h('td', {}, `Distant battles won (${win.battlesWon})`), h('td', { class: 'r num' }, `+${fmt(p.battles)}`)) : null,
    p.raids ? h('tr', {}, h('td', {}, `Raids repelled (${win.raidsRepelled})`), h('td', { class: 'r num' }, `+${fmt(p.raids)}`)) : null,
  ];
  const where = best
    ? place ? `the ${ordinal(place)} best win in the Hall of Fame` : `a new best for ${win.name}, not among the ${FAME_TOP} best wins`
    : `short of your best here (${fmt(previous)}): the hall is unchanged`;
  return h('div', { class: 'fame-win' },
    h('p', {}, h('b', {}, `Score: ${fmt(win.score)} points`), `, ${where}. Career: ${fmt(career)}.`),
    h('table', { class: 'tbl fame-parts' }, parts));
}

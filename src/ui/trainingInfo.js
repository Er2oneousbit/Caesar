/**
 * trainingInfo.js
 * ----------------------------------------------------------------------------
 * The words the panels and advisors use for training (sim/training.js) and
 * for temples counted by size (sim/religion.js). Pure functions of the game
 * state, so the tests can read them as the player does.
 * ----------------------------------------------------------------------------
 */

import { BUILDINGS } from '../data/buildings.js';
import { trainsNow, trainedOf, academyFor, portusFor, inTraining } from '../sim/training.js';
import { waterOf } from '../sim/navy.js';

/**
 * Who is in training for a fort or station, or at an academy or Portus, and
 * the days each has left: "2 (5 and 16 days left)", with "paused" while the
 * school is short of staff. Null when nobody is.
 */
export function inTrainingText(game, b) {
  const list = inTraining(game, b);
  if (!list.length) return null;
  const days = list.map((t) => t.days);
  const said = days.length === 1 ? String(days[0]) : `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`;
  const paused = list.some((t) => t.paused) ? '; paused: the school is short of staff' : '';
  return `${list.length} (${said} day${days.length === 1 && days[0] === 1 ? '' : 's'} left${paused})`;
}

/** "5 of 8 trained" for a fort or station (its men or ships now). */
export function trainedText(game, post) {
  const { trained, all } = trainedOf(game, post.id);
  return `${trained} of ${all} trained`;
}

/**
 * Where a fort's men (or a station's crews) are trained, or why they are not:
 * a line for its panel.
 */
export function trainingNote(game, post) {
  const fort = post.def.kind === 'fort';
  const school = fort ? academyFor(game, post) : portusFor(game, post);
  const name = BUILDINGS[fort ? 'military_academy' : 'portus'].name;
  if (school) {
    return fort
      ? `Recruits train at the ${name} at ${school.x}, ${school.y} on their way here; men already in the fort stay at their posts.`
      : `New ships row past the ${name} at ${school.x}, ${school.y} first; ships at their berths stay there.`;
  }
  const kind = fort ? 'military_academy' : 'portus';
  const any = [...game.buildings.values()].some((b) => b.def.kind === kind && (fort || waterOf(game, b) === waterOf(game, post)));
  if (any) return `No ${name}${fort ? '' : ' on this water'} is fully staffed: only one with every worker trains anyone.`;
  return fort
    ? 'Build a Campus (Military Academy), fully staffed, to train these men: trained legionaries holding their ground shrug off missiles.'
    : 'Build a Portus (Training Harbor) on this water, fully staffed, to train these crews: they row faster and ram harder.';
}

/** Status line for a Military Academy or a Portus (buildingStatus in ui/infoPanel.js), or null. */
export function schoolStatus(game, b) {
  const need = b.def.workers;
  if (b.def.kind === 'portus' && !waterOf(game, b)) return { level: 'bad', text: 'Not beside water that ships can sail.' };
  if (!trainsNow(game, b)) return { level: 'warn', text: `Trains nobody until fully staffed: ${b.workers} of ${need} workers.` };
  if (b.def.kind === 'portus') {
    const station = [...game.buildings.values()].some((x) => x.def.kind === 'station' && waterOf(game, x) === waterOf(game, b));
    if (!station) return { level: 'warn', text: 'No Statio (Naval Station) on this water: its crews train elsewhere, or not at all.' };
    return { level: 'good', text: 'Fully staffed: crews on this water train here.' };
  }
  return { level: 'good', text: 'Fully staffed: soldiers of the forts nearest it train here.' };
}

/**
 * A god's staffed temples as the Religion advisor shows them: the count its
 * mood is judged by, a large temple counting as two, and how it is made up
 * when a large temple is among them.
 * @returns {{weight:number, small:number, large:number, text:string}}
 */
export function templeCount(game, god) {
  let small = 0;
  let large = 0;
  let weight = 0;
  for (const b of game.buildings.values()) {
    if (b.def.god !== god || !(b.efficiency > 0)) continue;
    const w = b.def.templeWeight || 1;
    weight += w;
    if (w > 1) large++;
    else small++;
  }
  const text = large ? `${weight} (${small} small, ${large} large: a large temple counts as two)` : `${weight}`;
  return { weight, small, large, text };
}

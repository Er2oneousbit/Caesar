/**
 * events.js (data)
 * ----------------------------------------------------------------------------
 * The province's events (sim/events.js): the monthly table of random events,
 * the earthquakes' sizes, and what each campaign mission switches on and
 * schedules. Kept out of data/scenarios.js so missions can gain events
 * without touching the mission texts.
 *
 * Random events (the original's monthly draw): each month one number is
 * drawn against a table of EVENT_TABLE_SIZE entries, most of them nothing.
 * `entries` is how many of those name the event; at Normal the chance a
 * month is entries / 128 (Rome raising wages: 3 entries, 2.3% a month). The
 * difficulty's `events` lever shrinks or grows the table (Easy 0.5: half as
 * often), not each event, so the events keep their shares. An event fires
 * only if its mission switches it on, its condition holds and it is not
 * cooling down (data/difficulty.js eventCooldown; wages always 12 months).
 *
 *   wageUp, wageDown  Rome's wage moves 1 to 4 Dn (the citizens' yardstick for
 *                     theirs: sim/economy.js romeWage), between ROME_WAGE_MIN
 *                     and ROME_WAGE_MAX
 *   land, sea         no caravan (or no ship) sets out on any route of the
 *                     kind for TRADE_HALT_DAYS
 *   water             bad water: city health falls (sim/disease.js)
 *   mine, clay        the oldest iron mine collapses, the oldest clay pit
 *                     floods (it becomes rubble)
 *
 * Mission entries (EVENTS_BY_MISSION, keyed by mission id):
 *   random        the switches: which random events can happen there
 *                 ('wages' covers both wage events)
 *   quake         { year, size }: an earthquake in that mission year (1 = the
 *                 first), in a month from Martius to October drawn from the
 *                 map's seed; size small | medium | large (QUAKE_SIZES)
 *   emperor       [year, ...]: a new Caesar in that year, in a month from
 *                 Februarius to September; favor starts afresh at 50
 *   priceChanges  [{ year, good, change }]: from a month of that year
 *                 (Martius to October), the good's price with every partner,
 *                 both ways, is (1 + change) times what it was, for good
 *   revolt        [year, ...]: the gladiators revolt in that year, in a month
 *                 from Aprilis to Iulius, for 3 months (sim/revolt.js); with
 *                 no gladiator school at work that month it is called off
 *                 for good, without a word, as in the original
 *
 * The sandbox has every random event, each switched on or off in its setup
 * (scenario `events`: the switches left on, sandboxEventSwitches), and
 * nothing scheduled: an earthquake, a new Caesar, a price change and the
 * gladiators' revolt belong to a mission's story, so the setup has no
 * switch for them, and a mission keeps the events it was designed with.
 * A switch that is off leaves its table entries in place, drawing nothing,
 * so the other events come exactly as often as with every switch on.
 * Missions 1 and 2 teach the basics and have none. The choices follow the places: the peaceful track
 * gets the hazards (earthquakes in the south, bad water in the desert), the
 * military one wages and roads cut in war.
 * ----------------------------------------------------------------------------
 */

import { RNG } from '../core/rng.js';

/** Entries in the monthly table; those no event names draw nothing. */
export const EVENT_TABLE_SIZE = 128;

/**
 * The random events in table order. `entries`: the table entries naming it
 * (the original's); `switch`: the mission switch that allows it; `cooldown`:
 * the event key whose cooldown it shares (the two wage events share one).
 */
export const RANDOM_EVENTS = Object.freeze([
  { key: 'wageUp', entries: 3, switch: 'wages', cooldown: 'wages' },
  { key: 'wageDown', entries: 3, switch: 'wages', cooldown: 'wages' },
  { key: 'land', entries: 5, switch: 'land', cooldown: 'land' },
  { key: 'sea', entries: 4, switch: 'sea', cooldown: 'sea' },
  { key: 'water', entries: 2, switch: 'water', cooldown: 'water' },
  { key: 'mine', entries: 4, switch: 'mine', cooldown: 'mine' },
  { key: 'clay', entries: 5, switch: 'clay', cooldown: 'clay' },
].map((e) => Object.freeze(e)));

/** Every switch a mission (or the sandbox) can turn on. */
export const EVENT_SWITCHES = Object.freeze(['wages', 'land', 'sea', 'water', 'mine', 'clay']);

/**
 * The sandbox's switches left on, from its scenario's `events`: a list of
 * switch keys (the setup's, saved with the game), put in EVENT_SWITCHES
 * order with anything unknown dropped. `false` is none and anything else
 * (true, or a scenario built in code without the field) is all of them,
 * so a test or tool can still say on or off in one word.
 */
export function sandboxEventSwitches(events) {
  if (events === false) return [];
  if (Array.isArray(events)) return EVENT_SWITCHES.filter((k) => events.includes(k));
  return [...EVENT_SWITCHES];
}

/**
 * The events option of the URL flag and the balance simulator: 'on' (every
 * switch), 'off' (no event at all, a mission's scheduled ones too), 'none'
 * (no sandbox switch on) or a comma list of the switches to leave on
 * ('wages,sea').
 * @returns {'off'|string[]|null} 'off', the switches on, or null when it
 *   names something that is not a switch
 */
export function parseEventsOption(text) {
  const s = String(text ?? '').trim().toLowerCase();
  if (s === 'off') return 'off';
  if (s === 'on') return [...EVENT_SWITCHES];
  if (s === 'none') return [];
  const keys = s.split(',').map((k) => k.trim()).filter(Boolean);
  if (!keys.length || keys.some((k) => !EVENT_SWITCHES.includes(k))) return null;
  return sandboxEventSwitches(keys);
}

/** Months before Rome moves wages again, on every difficulty. */
export const WAGE_COOLDOWN = 12;

/**
 * Rome's wage stays within these (Dn a worker a year). The original's 30
 * could go to 45 (1.5 times) and, by a bug, down to 1; Colonia's 24 goes
 * to 36 and no lower than half, 12.
 */
export const ROME_WAGE_MIN = 12;
export const ROME_WAGE_MAX = 36;

/** Dn Rome's wage moves by in one event, fewest and most (drawn on the month's stream). */
export const WAGE_STEP = Object.freeze([1, 4]);

/** Days a trade disruption lasts (the original's 3 months), and Neptune's storms. */
export const TRADE_HALT_DAYS = 48;
export const NEPTUNE_HALT_DAYS = 80;

/** Bad water needs this many people (the original's 200; disease's own floor too). */
export const BAD_WATER_MIN_POP = 200;

/**
 * What each switch is called in the sandbox setup, and what it allows.
 * Rome's two wage events are one switch, as they are for a mission: they
 * share a cooldown, and a wage that could only rise (or only fall) would
 * drift to its bound and stay there. The numbers come from the tables
 * above, so the setup says what the game does.
 */
export const EVENT_SWITCH_INFO = Object.freeze({
  wages: Object.freeze({ name: 'Rome\'s wage', desc: `Rome raises or cuts the wage your workers measure theirs against, by ${WAGE_STEP[0]} to ${WAGE_STEP[1]} Dn.` }),
  land: Object.freeze({ name: 'Land trade stopped', desc: `Landslides (sandstorms in the desert) stop every caravan for ${TRADE_HALT_DAYS} days.` }),
  sea: Object.freeze({ name: 'Sea trade stopped', desc: `Storms keep every merchant ship in port for ${TRADE_HALT_DAYS} days.` }),
  water: Object.freeze({ name: 'Bad water', desc: `The wells and fountains are fouled and city health falls (from ${BAD_WATER_MIN_POP} people).` }),
  mine: Object.freeze({ name: 'Mine collapse', desc: 'The oldest iron mine caves in.' }),
  clay: Object.freeze({ name: 'Clay pit flood', desc: 'The oldest clay pit floods and caves in.' }),
});

/**
 * Earthquakes. `tries`: [fewest, most] steps the four cracks try in all;
 * `perDay`: tries a day (the original's 10, 8 and 6 ticks between tries at
 * 50 ticks a day). A small quake lasts 5 to 11 days, a medium 16 to 27, a
 * large 31 to 47.
 */
export const QUAKE_SIZES = Object.freeze({
  small: Object.freeze({ name: 'small', tries: [25, 56], perDay: 5 }),
  medium: Object.freeze({ name: 'medium', tries: [100, 163], perDay: 6 }),
  large: Object.freeze({ name: 'large', tries: [250, 377], perDay: 8 }),
});

/** How far the quake's point may lie from the middle of the city, either way (tiles). */
export const QUAKE_JITTER = 4;

/** What each campaign mission switches on and schedules (see the header). */
export const EVENTS_BY_MISSION = Object.freeze({
  c3: { random: ['clay'], priceChanges: [{ year: 2, good: 'pottery', change: 0.2 }] }, // the kilns' fame spreads
  c3m: { random: ['wages', 'land'] },
  c4: { random: ['land', 'sea'] },
  c4p: { random: ['sea'], quake: { year: 2, size: 'small' } }, // Lucania shakes
  c5: { random: ['mine', 'sea'] },
  c5p: { random: ['land'], emperor: [3] }, // the Appian Way's landslides
  c6: { random: ['land', 'water'] }, // sandstorms, and fouled oasis wells
  c6p: { random: [], emperor: [5], priceChanges: [{ year: 3, good: 'wine', change: 0.2 }] },
  c7: { random: ['wages'], emperor: [4], revolt: [5] }, // the great city's schools
  c7p: { random: [], quake: { year: 4, size: 'medium' }, priceChanges: [{ year: 3, good: 'wheat', change: 0.15 }] }, // Calabria
  c8m: { random: ['mine'], quake: { year: 5, size: 'medium' } }, // the Emilian plain
  c8p: { random: ['sea'], priceChanges: [{ year: 3, good: 'marble', change: 0.25 }] }, // Rome builds in marble
  c9m: { random: ['wages', 'mine'] },
  c9p: { random: ['sea'], quake: { year: 6, size: 'small' } }, // the strait
  c10m: { random: ['wages', 'land'], emperor: [7] },
  c10p: { random: [], quake: { year: 8, size: 'large' }, revolt: [6] }, // the Phlegraean Fields; Capua's schools next door
});

/** Nothing switched on, nothing scheduled. */
const NO_EVENTS = Object.freeze({ random: Object.freeze([]), quake: null, emperor: Object.freeze([]), priceChanges: Object.freeze([]), revolt: Object.freeze([]) });

/**
 * A scenario's events: its mission's entry, filled out (a mission without
 * one has none); the sandbox has the random events its setup left switched
 * on (scenario `events`, sandboxEventSwitches), and nothing scheduled.
 */
export function missionEvents(scenario) {
  if (!scenario) return NO_EVENTS;
  if (scenario.id === 'sandbox') return { ...NO_EVENTS, random: sandboxEventSwitches(scenario.events) };
  const e = Object.hasOwn(EVENTS_BY_MISSION, scenario.id) ? EVENTS_BY_MISSION[scenario.id] : null;
  if (!e) return NO_EVENTS;
  return { random: e.random || [], quake: e.quake || null, emperor: e.emperor || [], priceChanges: e.priceChanges || [], revolt: e.revolt || [] };
}

/**
 * The months (0 = Ianuarius) each scheduled kind can fall in, the
 * original's: an earthquake and a price change from Martius to October, a
 * new emperor from Februarius to September, a gladiators' revolt from
 * Aprilis to Iulius.
 */
export const EVENT_MONTHS = Object.freeze({ quake: [2, 9], emperor: [1, 8], price: [2, 9], revolt: [3, 6] });

const monthCache = new Map(); // drawn months by stream (prices read them for every lot traded)

/**
 * The mission month (game.time.totalMonths) of scheduled event number `k`
 * of a kind, in mission year `year` (1 = the first): its month drawn from
 * the map's seed on a stream of its own, never the game's (as a partner's
 * demand changes are, sim/tradeDemand.js), so it needs no saving.
 */
export function eventMonth(seed, kind, k, year) {
  const [a, b] = EVENT_MONTHS[kind];
  const key = `${seed}:events:${kind}:${k}`;
  let m = monthCache.get(key);
  if (m === undefined) monthCache.set(key, (m = new RNG(key).range(0, b - a)));
  return (Math.max(1, year) - 1) * 12 + a + m;
}

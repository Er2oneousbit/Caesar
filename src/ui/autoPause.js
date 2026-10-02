/**
 * autoPause.js
 * ----------------------------------------------------------------------------
 * Settings > Auto-pause: switches that pause the game when something happens
 * the player should see at once. No DOM here, so tests can read it.
 *
 * The sim labels the messages of these events with a `kind` (core/game.js
 * message()); nothing new is kept in the sim, and it never reads the label,
 * so a game plays the same with the switches on or off. Which kinds each
 * switch stops for:
 *
 *   fire      a fire breaks out (or rioters start one). Not a fire spreading
 *             from one already burning, nor buildings raiders or Caesar's
 *             legions set alight: they are part of the attack
 *   scouted   the scouts' report on a raid (by land or sea, about 3 months
 *             ahead: the first word with its side and size, time enough to
 *             act), and Caesar's legions setting out from Rome. Not the
 *             traders' rumour before it (no side, no size) nor the reminder a
 *             month away (it repeats what the scouts said)
 *   arrive    raiders (by land, or their ships by sea) or Caesar's legions
 *             come onto the map. On by default: the one event that costs
 *             buildings within days if the player is looking elsewhere at 8x
 *   caesar    the Emperor asks for goods or money, or calls for troops
 *   collapse  a building falls down from neglect (not one torn down in a raid)
 *   disease   disease breaks out in a home (the monthly sum of the quieter
 *             cases is not an event)
 *
 * The app (app.js onGameMessage) pauses only for events of the running game's
 * own ticks: the menu's demo city, console commands and the headless sim
 * never pause.
 * ----------------------------------------------------------------------------
 */

/** The switches, in the order Settings lists them. */
export const AUTO_PAUSE = Object.freeze([
  { key: 'fire', label: 'A fire breaks out', kinds: ['fire'], on: false },
  { key: 'scouted', label: 'Scouts report a raid, or Caesar\'s legions set out', kinds: ['scouted', 'legionMarch'], on: false },
  { key: 'arrive', label: 'Raiders or Caesar\'s legions arrive', kinds: ['raid', 'legion'], on: true },
  { key: 'caesar', label: 'Caesar makes a request or calls for troops', kinds: ['request', 'troops'], on: false },
  { key: 'collapse', label: 'A building collapses', kinds: ['collapse'], on: false },
  { key: 'disease', label: 'Disease breaks out', kinds: ['disease'], on: false },
].map((s) => Object.freeze(s)));

/** The defaults: { fire: false, ..., arrive: true, ... }. */
export const AUTO_PAUSE_DEFAULTS = Object.freeze(Object.fromEntries(AUTO_PAUSE.map((s) => [s.key, s.on])));

/**
 * The switches as they stand: the saved ones over the defaults. Settings are
 * merged one level deep when read (app.js readJson), so a switch added in a
 * later version is missing from an older saved `autoPause` and takes its
 * default here; anything not a boolean counts as unset.
 * @param {object} settings  app.settings
 * @returns {Object<string, boolean>}
 */
export function autoPauseSwitches(settings) {
  const saved = settings && typeof settings.autoPause === 'object' && settings.autoPause ? settings.autoPause : {};
  const out = {};
  for (const s of AUTO_PAUSE) out[s.key] = typeof saved[s.key] === 'boolean' ? saved[s.key] : s.on;
  return out;
}

/**
 * Should message `m` pause the game? The switch that says so, or null.
 * @param {{kind?:string}} m       a game message (core/game.js message())
 * @param {object} settings        app.settings
 * @returns {object|null}          an entry of AUTO_PAUSE
 */
export function autoPauseFor(m, settings) {
  if (!m || !m.kind) return null;
  const on = autoPauseSwitches(settings);
  return AUTO_PAUSE.find((s) => on[s.key] && s.kinds.includes(m.kind)) || null;
}

/** What happened, by message kind, for the toast that says why the game stopped. */
const WHY = Object.freeze({
  fire: 'a fire broke out',
  scouted: 'scouts report a raid',
  legionMarch: 'Caesar\'s legions set out from Rome',
  raid: 'raiders are attacking',
  legion: 'Caesar\'s legions have arrived',
  request: 'the Emperor makes a request',
  troops: 'Caesar calls for troops',
  collapse: 'a building collapsed',
  disease: 'disease broke out',
});

/** The toast that says why the game stopped. */
export function autoPauseText(m) {
  return `⏸ Paused: ${WHY[m.kind] || 'something happened'}. Click to look; Space resumes.`;
}

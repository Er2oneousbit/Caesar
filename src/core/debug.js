/**
 * debug.js
 * ----------------------------------------------------------------------------
 * Debug flags + a leveled logger with a ring buffer.
 *
 * Flags come from the URL query string in the browser, for example:
 *   index.html?debug=1&seed=42&map=large&skipmenu=1
 *
 * Supported flags (also listed in the in-game Help and README):
 *   debug=1        show the debug HUD (FPS, tick time, entity counts, tile info)
 *   log=LEVEL      error | warn | info | debug   (default: info, debug if debug=1)
 *   seed=N         force the map seed for new games
 *   map=SIZE       small | medium | large | uber (sandbox default map size)
 *   maptype=TYPE   river | coast | lakes | plains | desert
 *   difficulty=D   easy | normal | hard | insane (with skipmenu=1 or scenario=ID)
 *   scenario=ID    start a scenario directly (see data/scenarios.js ids)
 *   skipmenu=1     jump straight into a sandbox game
 *   money=N        starting treasury override
 *   speed=N        starting speed index (0-4)
 *   unlockall=1    every building available in every scenario
 *   raids=MODE     off | occasional | frequent  (override invasions for new games)
 *   searaids=off   every raid comes by land (new games; sim/navy.js)
 *   people=ID      who raids a new game: a people of data/peoples.js (gauls,
 *                  ligurians, carthaginians...), or site for the province's own
 *   wolves=on|off  wolf packs on a new game's map, or none (sim/wildlife.js)
 *   nofog=1        reserved for future use
 *   mute=1         start with sound off
 *
 * The logger keeps the last 300 lines in memory so the crash screen can offer
 * a "copy error report" button with recent context.
 * ----------------------------------------------------------------------------
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

/** Parse flags from a query string (browser) or a plain object (Node/tests). */
export function parseFlags(source) {
  const flags = {
    debug: false,
    log: 'info',
    seed: null,
    map: null,
    maptype: null,
    scenario: null,
    skipmenu: false,
    money: null,
    speed: null,
    unlockall: false,
    raids: null,
    searaids: null,
    people: null,
    wolves: null,
    mute: false,
  };
  let params;
  try {
    if (typeof source === 'string') params = new URLSearchParams(source);
    else if (source && typeof source === 'object') params = new Map(Object.entries(source));
    else if (typeof location !== 'undefined') params = new URLSearchParams(location.search);
    else params = new Map();
  } catch {
    params = new Map();
  }
  const get = (k) => (params.get ? params.get(k) : undefined);
  const truthy = (v) => v !== undefined && v !== null && v !== '0' && v !== 'false' && v !== false;

  flags.debug = truthy(get('debug'));
  flags.log = LEVELS[get('log')] !== undefined ? get('log') : flags.debug ? 'debug' : 'info';
  const seed = get('seed');
  if (seed !== undefined && seed !== null && seed !== '') flags.seed = isNaN(Number(seed)) ? seed : Number(seed);
  if (['small', 'medium', 'large', 'uber'].includes(get('map'))) flags.map = get('map'); // keys of MAP_SIZES (world/mapgen.js)
  if (['river', 'coast', 'lakes', 'plains', 'desert'].includes(get('maptype'))) flags.maptype = get('maptype');
  if (['easy', 'normal', 'hard', 'insane'].includes(get('difficulty'))) flags.difficulty = get('difficulty'); // keys of data/difficulty.js
  if (get('scenario')) flags.scenario = String(get('scenario'));
  flags.skipmenu = truthy(get('skipmenu'));
  const money = Number(get('money'));
  if (get('money') !== undefined && get('money') !== null && Number.isFinite(money)) flags.money = money;
  const speed = Number(get('speed'));
  if (get('speed') !== undefined && get('speed') !== null && Number.isInteger(speed)) flags.speed = speed;
  flags.unlockall = truthy(get('unlockall'));
  if (['off', 'occasional', 'frequent'].includes(get('raids'))) flags.raids = get('raids');
  if (['off', 'on'].includes(get('searaids'))) flags.searaids = get('searaids');
  // (An unknown people falls back to the province's own: sim/military.js peopleFor.)
  if (/^[a-z_]+$/.test(String(get('people') ?? ''))) flags.people = String(get('people'));
  if (['off', 'on'].includes(get('wolves'))) flags.wolves = get('wolves');
  flags.mute = truthy(get('mute'));
  return flags;
}

/** Leveled logger with an in-memory ring buffer for crash reports. */
export class Logger {
  constructor(level = 'info', capacity = 300) {
    this.level = LEVELS[level] ?? LEVELS.info;
    this.capacity = capacity;
    this.lines = [];
  }

  setLevel(level) { this.level = LEVELS[level] ?? this.level; }

  _push(lvl, args) {
    const text = args
      .map((a) => {
        if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
        if (typeof a === 'object') {
          try { return JSON.stringify(a); } catch { return String(a); }
        }
        return String(a);
      })
      .join(' ');
    this.lines.push(`[${new Date().toISOString().slice(11, 19)}] ${lvl.toUpperCase()} ${text}`);
    if (this.lines.length > this.capacity) this.lines.shift();
  }

  error(...a) { this._push('error', a); if (this.level >= 0) console.error('[colonia]', ...a); }
  warn(...a) { this._push('warn', a); if (this.level >= 1) console.warn('[colonia]', ...a); }
  info(...a) { this._push('info', a); if (this.level >= 2) console.info('[colonia]', ...a); }
  debug(...a) { if (this.level >= 3) { this._push('debug', a); console.debug('[colonia]', ...a); } }

  /** Recent log lines as one string (used by the crash screen). */
  dump() { return this.lines.join('\n'); }
}

/** Shared logger instance. Level is adjusted at boot from the flags. */
export const log = new Logger('info');

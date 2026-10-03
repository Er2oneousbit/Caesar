/**
 * risk.js
 * ----------------------------------------------------------------------------
 * Fire and collapse.
 *
 * Every building slowly accumulates fire risk and damage risk each day.
 * Prefects walking past reset fire risk; engineers reset damage risk. When a
 * risk passes its threshold the building burns down or collapses and leaves
 * rubble. Burning ruins keep burning for a while and can spread to neighbors
 * until a prefect puts them out.
 *
 * Nearby prefects (walking or at their prefecture) are dispatched to fires.
 * A prefect fights one burning building at a time (all of its tiles, which
 * game.fireGroups ties together): he stands at it PREFECT_DOUSE_TICKS, it
 * goes out, and he takes the next one within PREFECT_DOUSE_REACH, then the
 * nearest elsewhere, then goes home. No two prefects fight the same
 * building. Meanwhile every building still burning, the one being fought
 * included, heats its neighbours and may spread as before: the building is
 * lost the moment it catches, so what a prefect saves is the street around it.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { HOUSE_TIERS } from '../data/housing.js';
import { footprintTiles, removeBuilding, spawnWalker, groupTiles, mainOf } from './entities.js';
import { followPath, goHome } from './movement.js';
import { recordRuin } from './ruins.js';

/** Display name for messages: house tier name or building name. */
export function buildingLabel(b) {
  return b.house ? HOUSE_TIERS[b.house.tier].name : b.def.name;
}

/** "a Horreum" / "an Excubitorium": the Latin names start with a vowel as often as not. */
export function withArticle(label) {
  return `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label}`;
}

/**
 * Fire and damage risk a building gains a day, before difficulty: a home's
 * come from its level (an empty lot gains none), anything else's from its
 * data. A rate of 0 means it never burns (or never collapses); the UI asks
 * here too, so it never shows odds for a building that cannot go off.
 */
export function riskRates(b) {
  const r = b.house ? HOUSE_TIERS[b.house.tier] : b.def;
  return { fire: r.fire, damage: r.damage };
}

/** Where a building stood and what would put it back (a home: its plots), for the rubble's Rebuild. */
function siteOf(b) {
  return { type: b.house ? 'house' : b.type, x: b.x, y: b.y, size: b.size, turn: b.turn || 0 };
}

/**
 * What falls when `b` burns or collapses: its own tiles, and a hippodrome's
 * whole track (all three sections go together; the rubble remembers the
 * hippodrome, so its Rebuild puts the whole of it back). `main`: the
 * building the rubble is named after.
 */
function fallingGround(game, b) {
  // A road under a building (a triumphal arch's middle, sim/construction.js
  // checkArch) stays road: no rubble, flames or ruin on it, as a broken gate
  // leaves its road (sim/military.js damageWall).
  const { map } = game;
  const open = (i) => !map.road[i];
  const main = mainOf(game, b);
  if (main === b && !(b.parts && b.parts.length)) return { own: footprintTiles(map, b.x, b.y, b.size).filter(open), rest: [], main: b };
  const own = footprintTiles(map, b.x, b.y, b.size);
  const rest = groupTiles(game, b).filter((i) => !own.includes(i) && open(i));
  return { own: own.filter(open), rest, main };
}

/** Daily risk growth + disaster checks for one building. */
export function updateRisk(game, b) {
  const { fire, damage: dmg } = riskRates(b);
  const { rng } = game;
  const mult = game.difficulty.risk * CONFIG.RISK_PACE;
  if (fire > 0) b.fireRisk += fire * mult * (0.6 + rng.next() * 0.8);
  if (dmg > 0) b.damageRisk += dmg * mult * (0.6 + rng.next() * 0.8);
  // Fire-proof (fire 0) and indestructible (damage 0) buildings never burn or
  // collapse, even if spreading flames pushed their risk up.
  if (fire > 0 && b.fireRisk >= CONFIG.FIRE_THRESHOLD && rng.chance(0.25)) {
    igniteBuilding(game, b, 'fire');
  } else if (dmg > 0 && b.damageRisk >= CONFIG.DAMAGE_THRESHOLD && rng.chance(0.25)) {
    collapseBuilding(game, b);
  }
}

/** What the rubble remembers for each way a building is set alight (sim/ruins.js). */
const RUIN_OF_FIRE = { fire: 'fire', spread: 'fire', wrath: 'wrath', raid: 'raidFire', raidQuiet: 'raidFire', riot: 'riot', riotQuiet: 'riot', legion: 'legionFire', legionQuiet: 'legionFire', revolt: 'revoltFire', revoltQuiet: 'revoltFire' };

/**
 * Burn a building down: it becomes a burning ruin.
 * @param {'fire'|'spread'|'wrath'|'raid'|'raidQuiet'|'riot'|'riotQuiet'|'legion'|'legionQuiet'|'revolt'|'revoltQuiet'} cause
 *        spread = caught from a fire beside it: burns and reads as 'fire',
 *        but is not a new outbreak for the auto-pause (ui/autoPause.js);
 *        raidQuiet, riotQuiet, legionQuiet, revoltQuiet = no message (raiders,
 *        a mob, Caesar's legions or rebel gladiators (sim/revolt.js)
 *        wrecking a whole street would otherwise flood the
 *        log); wrath = no message either, the angry god's own message says
 *        where (sim/religion.js)
 */
export function igniteBuilding(game, b, cause = 'fire') {
  const { own: tiles, rest, main } = fallingGround(game, b);
  const label = buildingLabel(b);
  const aLabel = withArticle(label);
  removeBuilding(game, b, 'fire');
  for (const i of tiles) {
    game.map.rubble[i] = 1;
    game.fires.set(i, CONFIG.FIRE_BURN_DAYS);
    game.fireGroups.set(i, b.id); // building ids are never reused: one key per fire
  }
  // The rest of a hippodrome falls in with the burning section, without flames.
  for (const i of rest) game.map.rubble[i] = 1;
  recordRuin(game, [...tiles, ...rest], label, RUIN_OF_FIRE[cause] || 'fire', siteOf(main));
  game.city.stats.fires++;
  const texts = {
    wrath: null,
    raid: `Raiders have set ${aLabel} on fire!`,
    raidQuiet: null,
    riot: `Rioters have set ${aLabel} on fire!`,
    riotQuiet: null,
    legion: `Caesar's legions have set ${aLabel} on fire!`,
    legionQuiet: null,
    revolt: `Rebel gladiators have set ${aLabel} on fire!`,
    revoltQuiet: null,
  };
  // `in`, not `??`: the quiet causes are null on purpose (`??` turned them
  // back into a "Fire!" message for every building raiders burned).
  const text = cause in texts ? texts[cause] : `Fire! ${aLabel[0].toUpperCase()}${aLabel.slice(1)} has burned down.`;
  // A fire that breaks out (or a riot's) is news the auto-pause may stop for;
  // one spreading from a fire already burning is not a new event.
  if (text) game.message(text, 'bad', b.x, b.y, cause === 'fire' || cause === 'riot' ? { kind: 'fire' } : null);
  game.events.emit('sound', { name: 'fire' });
  if (tiles.length) dispatchPrefect(game, tiles[0]);
}

/**
 * Collapse a building into rubble.
 * @param {'decay'|'raid'|'raidQuiet'|'legion'|'legionQuiet'|'revolt'|'revoltQuiet'} cause
 */
export function collapseBuilding(game, b, cause = 'decay') {
  const { own, rest, main } = fallingGround(game, b);
  const tiles = [...own, ...rest];
  const label = buildingLabel(b);
  const aLabel = withArticle(label);
  removeBuilding(game, b, 'collapse');
  for (const i of tiles) game.map.rubble[i] = 1;
  const ruin = cause === 'raid' || cause === 'raidQuiet' ? 'raid' : cause === 'legion' || cause === 'legionQuiet' ? 'legion' : cause === 'revolt' || cause === 'revoltQuiet' ? 'revolt' : cause === 'natives' ? 'natives' : 'collapse';
  recordRuin(game, tiles, label, ruin, siteOf(main));
  game.city.stats.collapses++;
  if (cause === 'raid') game.message(`Raiders have torn down ${aLabel}!`, 'bad', b.x, b.y);
  else if (cause === 'legion') game.message(`Caesar's legions have torn down ${aLabel}!`, 'bad', b.x, b.y);
  else if (cause === 'revolt') game.message(`Rebel gladiators have torn down ${aLabel}!`, 'bad', b.x, b.y);
  else if (cause === 'natives') game.message(`Angry villagers have torn down ${aLabel}!`, 'bad', b.x, b.y);
  else if (cause !== 'raidQuiet' && cause !== 'legionQuiet' && cause !== 'revoltQuiet') game.message(`${aLabel[0].toUpperCase()}${aLabel.slice(1)} has collapsed!`, 'bad', b.x, b.y, { kind: 'collapse' });
  game.events.emit('collapse', { x: b.x, y: b.y, size: b.size });
  game.events.emit('sound', { name: 'collapse' });
}

/**
 * Daily: burning ruins burn down, heat the buildings beside them, may spread,
 * and eventually go out. A building beside the flames is heated, and gets
 * one chance to catch, once a day however many burning tiles it touches:
 * counted per tile, a big building burning next to a row of homes rolled
 * against each of them several times a day, and one fire took a whole
 * housing block before a prefect could arrive.
 */
export function updateFires(game) {
  if (game.fires.size === 0) return;
  const { map, rng, buildings } = game;
  const near = [];
  const seen = new Set();
  for (const [i, days] of [...game.fires]) {
    if (days <= 1) {
      putOutTile(game, i);
      continue;
    }
    game.fires.set(i, days - 1);
    const x = map.xOf(i);
    const y = map.yOf(i);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      // Flames beside any section of the hippodrome heat the hippodrome.
      const nb = mainOf(game, buildings.get(map.buildingAt(x + dx, y + dy)));
      if (!nb || seen.has(nb.id)) continue;
      if (!(riskRates(nb).fire > 0)) continue; // fire-proof: the flames pass it by
      seen.add(nb.id);
      near.push(nb);
    }
    // Remind a prefect every few days while the fire is unattended.
    if (days % 3 === 0) dispatchPrefect(game, i);
  }
  for (const nb of near) {
    if (!buildings.has(nb.id)) continue;
    nb.fireRisk += CONFIG.FIRE_HEAT_PER_DAY;
    if (rng.chance(CONFIG.FIRE_SPREAD_CHANCE)) igniteBuilding(game, nb, 'spread');
  }
}

/** Nearest road tile within `radius` of a tile, or -1. */
function roadNear(game, idx, radius) {
  const { map } = game;
  const x = map.xOf(idx);
  const y = map.yOf(idx);
  let best = -1;
  let bestD = 1e9;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!map.inBounds(tx, ty)) continue;
      const i = map.idx(tx, ty);
      if (!map.road[i]) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  return best;
}

/** How many of a prefecture's prefects are on fire duty (running to a fire, or at one). */
function fireCrewOut(game, b) {
  let n = 0;
  for (const id of b.walkers || []) {
    const w = game.walkers.get(id);
    if (w && (w.state === 'toFire' || w.state === 'extinguish')) n++;
  }
  return n;
}

/**
 * Send the closest available prefect to a fire. Prefers prefects already
 * walking nearby; otherwise a staffed prefecture sends a fresh one.
 */
export function dispatchPrefect(game, fireIdx) {
  const { map, pf } = game;
  const road = roadNear(game, fireIdx, 3);
  if (road < 0) return false;

  // Is someone already on the way to this building's fire, or at it? One
  // prefect for each burning building: as each fights one at a time, a block
  // alight calls several, and a prefect called to a building another has
  // taken fights the next one beside it (prefectArriveAtFire).
  const key = fireOf(game, fireIdx);
  for (const w of game.walkers.values()) {
    if (w.type !== 'prefect' || (w.state !== 'toFire' && w.state !== 'extinguish')) continue;
    if (w.fireTile !== undefined && game.fires.has(w.fireTile) && fireOf(game, w.fireTile) === key) return true;
  }

  // Roaming prefects, indexed by the tile they stand on.
  const byTile = new Map();
  for (const w of game.walkers.values()) {
    if (w.type === 'prefect' && w.state !== 'toFire' && w.state !== 'extinguish') byTile.set(map.idx(w.x, w.y), w);
  }
  if (byTile.size > 0) {
    const found = pf.bfsRoad(road, (i) => byTile.has(i), CONFIG.PREFECT_ALERT_RADIUS);
    if (found >= 0) {
      const w = byTile.get(found);
      const path = pf.buildPath(found).reverse(); // prefect -> fire
      // Fires come first: a prefect chasing a criminal drops the hunt (sim/crime.js).
      w.huntTarget = 0;
      w.offRoad = false;
      w.state = 'toFire';
      w.fireTile = fireIdx;
      w.speed = CONFIG.WALKER_SPEED * CONFIG.PREFECT_RUN_SPEED;
      followPath(game, w, path);
      return true;
    }
  }

  // Otherwise a prefecture sends someone, if it has not sent its whole crew
  // to fires already: with one prefect called for each burning building, a
  // street alight had a prefecture send 17 at once (and its patrols wait
  // until they are back). The rest of the fire waits for those out (each
  // takes the next one when his is out), or a prefecture farther off.
  const found = pf.findNearest(road, (id) => {
    const b = game.buildings.get(id);
    return b && b.type === 'prefecture' && b.efficiency > 0 && b.accessRoad >= 0 && fireCrewOut(game, b) < CONFIG.PREFECT_FIRE_CREW;
  }, CONFIG.PREFECT_ALERT_RADIUS);
  if (!found) return false;
  const pre = game.buildings.get(found.id);
  const path = pf.roadPath(pre.accessRoad, road);
  if (!path) return false;
  const w = spawnWalker(game, 'prefect', pre.accessRoad, pre, { state: 'toFire', fireTile: fireIdx, speed: CONFIG.WALKER_SPEED * CONFIG.PREFECT_RUN_SPEED });
  if (!w) return false;
  followPath(game, w, path);
  return true;
}

// ---------------------------------------------------------------------------
// Putting fires out: one burning building at a time
// ---------------------------------------------------------------------------

/**
 * The fire a burning tile belongs to: the id of the building that burned
 * there (igniteBuilding). A tile with none (set alight by a test or the
 * console, or a hand-edited save) is a fire of its own, under a negative key
 * no building id can take.
 */
export function fireOf(game, i) {
  const g = game.fireGroups.get(i);
  return g === undefined ? -(i + 1) : g;
}

/** A burning tile goes out (burned out, put out, or swallowed by an earthquake). */
export function putOutTile(game, i) {
  game.fires.delete(i);
  game.fireGroups.delete(i);
}

/** Put out every tile of one fire; returns how many there were. */
function putOutFire(game, key) {
  let n = 0;
  for (const i of [...game.fires.keys()]) {
    if (fireOf(game, i) !== key) continue;
    putOutTile(game, i);
    n++;
  }
  return n;
}

/** Is this prefect standing at a fire he is putting out (still burning)? */
function dousing(game, w) {
  return w.type === 'prefect' && w.state === 'extinguish' && w.fireTile !== undefined && game.fires.has(w.fireTile);
}

/** Fires a prefect is putting out right now: fire key -> that prefect. */
export function firesBeingFought(game) {
  const out = new Map();
  if (game.fires.size === 0) return out;
  for (const w of game.walkers.values()) if (dousing(game, w)) out.set(fireOf(game, w.fireTile), w);
  return out;
}

/** Is the fire on burning tile i being put out by a prefect (the info panel's note)? */
export function beingPutOut(game, i) {
  return game.fires.has(i) && firesBeingFought(game).has(fireOf(game, i));
}

/**
 * The burning tile of the fire prefect `w` should fight from where he
 * stands, or -1: a fire with a tile within PREFECT_DOUSE_REACH that no other
 * prefect is fighting, the one he was called to (`called`, a tile) first,
 * then the nearest. Ties go to the tile set alight first (the fires map
 * keeps that order), so the choice is the same on every run.
 */
function fireInReach(game, w, called = -1) {
  const { map } = game;
  const fought = firesBeingFought(game);
  const own = called >= 0 && game.fires.has(called) ? fireOf(game, called) : null;
  let best = -1;
  let bestD = Infinity;
  for (const i of game.fires.keys()) {
    const d = Math.max(Math.abs(map.xOf(i) - w.x), Math.abs(map.yOf(i) - w.y));
    if (d > CONFIG.PREFECT_DOUSE_REACH) continue;
    const key = fireOf(game, i);
    const other = fought.get(key);
    if (other && other !== w) continue;
    const score = key === own ? -1 : d;
    if (score < bestD) { bestD = score; best = i; }
  }
  return best;
}

/** Stand at the fire on tile i and fight it. */
function fightFire(game, w, i) {
  w.state = 'extinguish';
  w.fireTile = i;
  w.waitTicks = CONFIG.PREFECT_DOUSE_TICKS;
  w.afterWait = 'douse';
}

/**
 * Prefect reached the fire he was called to: he fights that building, or,
 * if another prefect is at it (or it is out), the next burning building in
 * reach; with none, he looks farther (afterWait 'nextFire').
 */
export function prefectArriveAtFire(game, w) {
  const i = fireInReach(game, w, w.fireTile === undefined ? -1 : w.fireTile);
  w.fireTile = undefined;
  if (i >= 0) fightFire(game, w, i);
  else afterWait(game, w, 'nextFire');
}

/**
 * The nearest burning tile within PREFECT_ALERT_RADIUS (tiles, straight
 * line) of prefect `w` whose fire no other prefect is fighting, or -1. A
 * fire another prefect is already running to comes after every other: the
 * prefects at a big fire spread over its buildings instead of queueing.
 */
function nextFireFor(game, w) {
  const { map } = game;
  const fought = firesBeingFought(game);
  const called = new Set();
  for (const o of game.walkers.values()) {
    if (o !== w && o.type === 'prefect' && o.state === 'toFire' && o.fireTile !== undefined && game.fires.has(o.fireTile)) called.add(fireOf(game, o.fireTile));
  }
  let best = -1;
  let bestD = Infinity;
  for (const i of game.fires.keys()) {
    const d = Math.abs(map.xOf(i) - w.x) + Math.abs(map.yOf(i) - w.y);
    if (d > CONFIG.PREFECT_ALERT_RADIUS) continue;
    const key = fireOf(game, i);
    if (fought.has(key)) continue;
    const score = d + (called.has(key) ? CONFIG.PREFECT_ALERT_RADIUS * 4 : 0);
    if (score < bestD) { bestD = score; best = i; }
  }
  return best;
}

/**
 * Called when a waiting walker finishes waiting. A prefect whose building is
 * out takes the next one within reach without moving, then runs to the
 * nearest fire elsewhere, then heads home.
 *   douse     his time at the building is up: it goes out
 *   nextFire  look for another fire (also an older save's prefect resting
 *             after a fire, from when he put out everything around him)
 */
export function afterWait(game, w, what) {
  if (what === 'douse') {
    if (w.fireTile !== undefined && game.fires.has(w.fireTile) && putOutFire(game, fireOf(game, w.fireTile)) > 0) {
      game.events.emit('sound', { name: 'splash' });
    }
    w.fireTile = undefined;
    const i = fireInReach(game, w);
    if (i >= 0) {
      fightFire(game, w, i);
      return;
    }
    what = 'nextFire';
  }
  if (what === 'nextFire' && game.fires.size > 0) {
    const { map, pf } = game;
    const here = map.idx(w.x, w.y);
    if (map.road[here]) {
      const best = nextFireFor(game, w);
      if (best >= 0) {
        const road = roadNear(game, best, 3);
        const path = road >= 0 ? pf.roadPath(here, road, CONFIG.PREFECT_ALERT_RADIUS * 2) : null;
        if (path) {
          w.state = 'toFire';
          w.fireTile = best;
          w.speed = CONFIG.WALKER_SPEED * CONFIG.PREFECT_RUN_SPEED;
          followPath(game, w, path);
          return;
        }
      }
    }
  }
  w.fireTile = undefined;
  w.speed = CONFIG.WALKER_SPEED;
  goHome(game, w);
}

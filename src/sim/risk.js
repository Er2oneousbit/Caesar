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
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { HOUSE_TIERS } from '../data/housing.js';
import { footprintTiles, removeBuilding, spawnWalker } from './entities.js';
import { followPath, goHome } from './movement.js';
import { recordRuin } from './ruins.js';

/** Display name for messages: house tier name or building name. */
export function buildingLabel(b) {
  return b.house ? HOUSE_TIERS[b.house.tier].name : b.def.name;
}

/** "a Prefecture" / "an Archer Fort" */
export function withArticle(label) {
  return `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label}`;
}

/** Daily risk growth + disaster checks for one building. */
export function updateRisk(game, b) {
  let fire = b.def.fire;
  let dmg = b.def.damage;
  if (b.house) {
    if (b.house.tier === 0) return; // empty lots cannot burn
    const t = HOUSE_TIERS[b.house.tier];
    fire = t.fire;
    dmg = t.damage;
  }
  const { rng } = game;
  const mult = game.difficulty.risk;
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
const RUIN_OF_FIRE = { fire: 'fire', wrath: 'wrath', raid: 'raidFire', raidQuiet: 'raidFire', riot: 'riot', riotQuiet: 'riot' };

/**
 * Burn a building down: it becomes a burning ruin.
 * @param {'fire'|'wrath'|'raid'|'raidQuiet'|'riot'|'riotQuiet'} cause
 *        raidQuiet, riotQuiet = no message (raiders or a mob wrecking a whole
 *        street would otherwise flood the log); wrath = no message either,
 *        the angry god's own message says where (sim/religion.js)
 */
export function igniteBuilding(game, b, cause = 'fire') {
  const tiles = footprintTiles(game.map, b.x, b.y, b.size);
  const label = buildingLabel(b);
  const aLabel = withArticle(label);
  removeBuilding(game, b, 'fire');
  for (const i of tiles) {
    game.map.rubble[i] = 1;
    game.fires.set(i, CONFIG.FIRE_BURN_DAYS);
  }
  recordRuin(game, tiles, label, RUIN_OF_FIRE[cause] || 'fire');
  game.city.stats.fires++;
  const texts = {
    wrath: null,
    raid: `Raiders have set ${aLabel} on fire!`,
    raidQuiet: null,
    riot: `Rioters have set ${aLabel} on fire!`,
    riotQuiet: null,
  };
  // `in`, not `??`: the quiet causes are null on purpose (`??` turned them
  // back into a "Fire!" message for every building raiders burned).
  const text = cause in texts ? texts[cause] : `Fire! ${aLabel[0].toUpperCase()}${aLabel.slice(1)} has burned down.`;
  if (text) game.message(text, 'bad', b.x, b.y);
  game.events.emit('sound', { name: 'fire' });
  dispatchPrefect(game, tiles[0]);
}

/**
 * Collapse a building into rubble.
 * @param {'decay'|'raid'|'raidQuiet'} cause
 */
export function collapseBuilding(game, b, cause = 'decay') {
  const tiles = footprintTiles(game.map, b.x, b.y, b.size);
  const label = buildingLabel(b);
  const aLabel = withArticle(label);
  removeBuilding(game, b, 'collapse');
  for (const i of tiles) game.map.rubble[i] = 1;
  recordRuin(game, tiles, label, cause === 'raid' || cause === 'raidQuiet' ? 'raid' : 'collapse');
  game.city.stats.collapses++;
  if (cause === 'raid') game.message(`Raiders have torn down ${aLabel}!`, 'bad', b.x, b.y);
  else if (cause !== 'raidQuiet') game.message(`${aLabel[0].toUpperCase()}${aLabel.slice(1)} has collapsed!`, 'bad', b.x, b.y);
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
      game.fires.delete(i);
      continue;
    }
    game.fires.set(i, days - 1);
    const x = map.xOf(i);
    const y = map.yOf(i);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const id = map.buildingAt(x + dx, y + dy);
      if (!id || seen.has(id)) continue;
      const nb = buildings.get(id);
      if (!nb) continue;
      const flammable = nb.house ? nb.house.tier > 0 : nb.def.fire > 0;
      if (!flammable) continue;
      seen.add(id);
      near.push(nb);
    }
    // Remind a prefect every few days while the fire is unattended.
    if (days % 3 === 0) dispatchPrefect(game, i);
  }
  for (const nb of near) {
    if (!buildings.has(nb.id)) continue;
    nb.fireRisk += CONFIG.FIRE_HEAT_PER_DAY;
    if (rng.chance(CONFIG.FIRE_SPREAD_CHANCE)) igniteBuilding(game, nb);
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

/**
 * Send the closest available prefect to a fire. Prefers prefects already
 * walking nearby; otherwise a staffed prefecture sends a fresh one.
 */
export function dispatchPrefect(game, fireIdx) {
  const { map, pf } = game;
  const road = roadNear(game, fireIdx, 3);
  if (road < 0) return false;

  // Is someone already on the way?
  for (const w of game.walkers.values()) {
    if (w.type === 'prefect' && w.state === 'toFire' && w.fireTile !== undefined) {
      const fx = map.xOf(w.fireTile);
      const fy = map.yOf(w.fireTile);
      if (Math.abs(fx - map.xOf(fireIdx)) <= 3 && Math.abs(fy - map.yOf(fireIdx)) <= 3) return true;
    }
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

  // Otherwise a prefecture sends someone.
  const found = pf.findNearest(road, (id) => {
    const b = game.buildings.get(id);
    return b && b.type === 'prefecture' && b.efficiency > 0 && b.accessRoad >= 0;
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

/** Prefect reached the fire: put out everything within 4 tiles, then rest. */
export function prefectArriveAtFire(game, w) {
  const { map } = game;
  let putOut = 0;
  for (const i of [...game.fires.keys()]) {
    if (Math.abs(map.xOf(i) - w.x) <= 4 && Math.abs(map.yOf(i) - w.y) <= 4) {
      game.fires.delete(i);
      putOut++;
    }
  }
  w.state = 'extinguish';
  w.waitTicks = putOut > 0 ? 30 : 1;
  w.afterWait = 'nextFire';
  w.fireTile = undefined;
  if (putOut > 0) game.events.emit('sound', { name: 'splash' });
}

/**
 * Called when a waiting walker finishes waiting. A prefect who just put out a
 * fire looks for the next fire nearby before heading home.
 */
export function afterWait(game, w, what) {
  if (what === 'nextFire' && game.fires.size > 0) {
    const { map, pf } = game;
    const here = map.idx(w.x, w.y);
    if (map.road[here]) {
      let best = -1;
      let bestD = Infinity;
      for (const i of game.fires.keys()) {
        const d = Math.abs(map.xOf(i) - w.x) + Math.abs(map.yOf(i) - w.y);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0 && bestD <= CONFIG.PREFECT_ALERT_RADIUS) {
        const road = roadNear(game, best, 3);
        const path = road >= 0 ? pf.roadPath(here, road, CONFIG.PREFECT_ALERT_RADIUS * 2) : null;
        if (path) {
          w.state = 'toFire';
          w.fireTile = best;
          followPath(game, w, path);
          return;
        }
      }
    }
  }
  w.speed = CONFIG.WALKER_SPEED;
  goHome(game, w);
}

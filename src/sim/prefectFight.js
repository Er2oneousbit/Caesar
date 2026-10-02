/**
 * prefectFight.js
 * ----------------------------------------------------------------------------
 * Prefects against raiders and Caesar's legionaries.
 *
 * A prefect on his rounds (walking his patrol or heading home: not running to
 * a fire, putting one out or chasing a criminal) who has an enemy on land
 * within CONFIG.PREFECT_FIGHT_REACH tiles stops and fights him, as the
 * original's prefects did. He stands on his road tile (sim/walkers.js: a
 * held walker does not move) and strikes with CONFIG.PREFECT_COMBAT, a third
 * of a legionary's attack, while the enemy is within reach. An enemy who goes
 * farther than CONFIG.PREFECT_FIGHT_LEASH ends the fight and the prefect goes
 * on with his rounds: he never chases one across the map. Fires come first:
 * a prefect sent to a fire (sim/risk.js dispatchPrefect) drops the fight.
 * Raiders still aboard their ships are out of reach (only land units count),
 * and so is an enemy across water, a wall or a building (clearBetween). He
 * leaves alone an enemy who is not out to fight (fightable): a fleeing
 * warband, and Caesar's men while they wait their turn at the entrance,
 * march home, or stand halted.
 *
 * The enemy he fights turns on him (fightPrefect, called from the raider's
 * and the legionary's own update): only once no soldier is near, as a raider
 * prefers soldiers, and he goes back to the buildings once the prefect is
 * dead, gone, or out of his way. A prefect can be killed: the walker is
 * removed, the military stats count him, and his prefecture sends the next
 * one only after its usual spawn delay, so the streets go unwatched for a
 * while. A message comes only when several fall close together.
 *
 * An enemy a prefect kills counts toward the raid's (or the legion's) slain
 * like any other (sim/military.js removeUnit), so the same rules repel it.
 *
 * State, all saved with the walker or unit (core/save.js copies every field):
 *   prefect  fight    id of the enemy unit he fights (0: none)
 *            hp       his health, set at his first fight (he does not heal)
 *            fightCd  ticks until his next blow
 *            hitTick  last tick he was hurt
 *   enemy    foe      id of the prefect he fights back (0: none)
 *            foeIgnore { prefect id: tick } prefects he could not get at,
 *                      left alone (and leaving him alone) until that tick
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { UNIT_TYPES } from '../data/units.js';
import { killWalker } from './entities.js';
import { hurt, rollDamage, enemyPower, unitDefense, moveUnitToward, passable, hostileToRome } from './military.js';

/** Ticks an enemy who cannot get at a prefect, and that prefect, leave each other alone. */
const IGNORE_TICKS = 200;

/** A prefect walking his rounds: on patrol or heading home, not on fire duty, not hunting. */
function onRounds(p) {
  return p.state === 'roam' || p.state === 'return';
}

/** Where a prefect stands, in the units' continuous coordinates (tile middles at .5). */
function spot(p) {
  return { x: p.x + 0.5, y: p.y + 0.5 };
}

function distTo(p, u) {
  const s = spot(p);
  return Math.hypot(u.x - s.x, u.y - s.y);
}

/** Has enemy `u` given up on prefect `p` (and `p` on him) for now? */
function avoids(game, u, p) {
  const until = u.foeIgnore ? u.foeIgnore[p.id] : undefined;
  return until !== undefined && game.time.totalTicks < until;
}

/**
 * Is enemy `u` still out to fight, so a prefect takes him on? Not a raider
 * whose warband is fleeing (he runs and would never strike back: free kills),
 * nor one of Caesar's legionaries still waiting his turn at the entrance,
 * marching home, or in an army that has halted (an armed truce: a prefect
 * picking a fight there would only be cut down, and the next after him).
 */
function fightable(game, u) {
  if (u.side === 'native') return !!u.attacking; // a villager, only while his village attacks (sim/natives.js)
  if (u.legion) {
    const a = game.military.caesar?.army;
    return !!a && a.id === u.legion && !a.retreating && !a.halted && !(u.waitTicks > 0);
  }
  const inv = game.military.active;
  return !!inv && inv.id === u.invasion && !inv.fleeing;
}

/**
 * Open land between a prefect and an enemy: every tile strictly between
 * them (sampled along the line) is one the enemy could walk. A prefect does
 * not strike across a river, a wall or a building, nor take on a raider he
 * could never be reached by.
 */
function clearBetween(game, p, u) {
  const { map } = game;
  const s = spot(p);
  const d = Math.hypot(u.x - s.x, u.y - s.y);
  const steps = Math.ceil(d / 0.25);
  const own = map.idx(p.x, p.y);
  const theirs = map.idx(Math.floor(u.x), Math.floor(u.y));
  for (let k = 1; k < steps; k++) {
    const i = map.idx(Math.floor(s.x + ((u.x - s.x) * k) / steps), Math.floor(s.y + ((u.y - s.y) * k) / steps));
    if (i !== own && i !== theirs && !passable(game, 'enemy', i)) return false;
  }
  return true;
}

/** The enemy unit prefect `w` is fighting right now, or null (for the UI too). */
export function prefectFoe(game, w) {
  if (!w || w.type !== 'prefect' || !w.fight) return null;
  return game.units.get(w.fight) || null;
}

/** "a raider" / "one of Caesar's legionaries", for the prefect's panel and talk. */
export function foeLabel(u) {
  if (u && u.side === 'native') return 'a villager';
  return u && (u.legion || u.type === 'imperial') ? 'one of Caesar\'s legionaries' : 'a raider';
}

function endFight(p) {
  p.fight = 0;
}

/**
 * Per tick, after the units have moved (core/game.js tick): every prefect on
 * his rounds fights the enemy in reach, keeps fighting him while he stays on
 * the leash, or goes back to his rounds.
 */
export function updatePrefectFights(game) {
  const enemies = [];
  for (const u of game.units.values()) if (hostileToRome(u) && !UNIT_TYPES[u.type].naval) enemies.push(u);
  for (const p of game.walkers.values()) {
    if (p.dead || p.type !== 'prefect') continue;
    if (!enemies.length || !onRounds(p)) { if (p.fight) endFight(p); continue; }
    let e = p.fight ? game.units.get(p.fight) : null;
    if (e && (distTo(p, e) > CONFIG.PREFECT_FIGHT_LEASH || avoids(game, e, p) || !fightable(game, e))) e = null;
    if (!e) e = nearestEnemy(game, p, enemies);
    if (!e) { if (p.fight) endFight(p); continue; }
    p.fight = e.id;
    if (p.hp === undefined) p.hp = CONFIG.PREFECT_COMBAT.hp;
    p.held = 1; // stands his ground (sim/walkers.js stepWalker), as when he holds a criminal
    // The enemy turns on him, unless another prefect already has his attention.
    if (!validFoe(game, e, game.walkers.get(e.foe))) e.foe = p.id;
    // A blow every cooldown ticks, counted as a unit's is (down, then strike at 0).
    if (p.fightCd > 0) p.fightCd--;
    if (!(p.fightCd > 0) && distTo(p, e) <= CONFIG.PREFECT_FIGHT_REACH && clearBetween(game, p, e)) strikeEnemy(game, p, e);
  }
}

/** The nearest land enemy within reach of prefect `p` (the first one on a tie), or null. */
function nearestEnemy(game, p, enemies) {
  let best = null;
  let bestD = CONFIG.PREFECT_FIGHT_REACH;
  for (const u of enemies) {
    if (!game.units.has(u.id) || avoids(game, u, p) || !fightable(game, u)) continue;
    const d = distTo(p, u);
    if (!(d < bestD || (!best && d <= bestD)) || !clearBetween(game, p, u)) continue;
    best = u;
    bestD = d;
  }
  return best;
}

/** A prefect's blow. The enemy's slain count and the raid's (sim/military.js removeUnit) see a kill. */
function strikeEnemy(game, p, e) {
  const c = CONFIG.PREFECT_COMBAT;
  p.fightCd = c.cooldown;
  p.strikeTick = game.time.totalTicks;
  hurt(game, e, rollDamage(game, c, UNIT_TYPES[e.type], 1, unitDefense(game, e)));
  game.events.emit('sound', { name: 'clash' });
}

/** Is prefect `p` still a fight for enemy `u`: alive, on his rounds, fighting him, near enough? */
function validFoe(game, u, p) {
  return !!p && !p.dead && p.type === 'prefect' && p.fight === u.id && onRounds(p)
    && !avoids(game, u, p) && fightable(game, u) && distTo(p, u) <= CONFIG.PREFECT_FIGHT_LEASH;
}

/**
 * An enemy's turn (sim/military.js updateRaider, sim/legion.js
 * updateLegionary), after he found no soldier to fight: strike the prefect
 * fighting him, or step up to him. One he cannot get at he leaves alone for a
 * while (and that prefect him), and goes back to the buildings.
 * A slinger's stone at a prefect strikes at once (no missile flies: a
 * missile only knows units).
 * @returns {boolean} true when the enemy spent his turn on a prefect
 */
export function fightPrefect(game, u, def) {
  if (!u.foe) return false;
  const p = game.walkers.get(u.foe);
  if (!validFoe(game, u, p)) { u.foe = 0; return false; }
  u.state = 'fight';
  const s = spot(p);
  if (Math.hypot(s.x - u.x, s.y - u.y) <= def.range) {
    u.moving = false;
    u.stuck = 0;
    if (u.cooldown <= 0) strikePrefect(game, u, def, p);
    return true;
  }
  moveUnitToward(game, u, s.x, s.y, def.speed);
  if (u.stuck > 20) {
    // No way to him (a building or water between them): leave each other be.
    const now = game.time.totalTicks;
    const keep = {};
    for (const id in u.foeIgnore || {}) if (u.foeIgnore[id] > now) keep[id] = u.foeIgnore[id];
    keep[p.id] = now + IGNORE_TICKS;
    u.foeIgnore = keep;
    u.foe = 0;
    u.stuck = 0;
    endFight(p);
  }
  return true;
}

/** An enemy's blow at a prefect. */
function strikePrefect(game, u, def, p) {
  const c = CONFIG.PREFECT_COMBAT;
  u.strikeTick = game.time.totalTicks;
  u.cooldown = def.cooldown;
  const s = spot(p);
  const sdx = (s.x - u.x) - (s.y - u.y);
  if (Math.abs(sdx) > 0.01) u.facing = sdx > 0 ? 1 : -1;
  p.hp = (p.hp ?? c.hp) - rollDamage(game, def, c, enemyPower(game, u), c.defense);
  p.hitTick = game.time.totalTicks;
  game.events.emit('sound', { name: 'clash' });
  if (p.hp <= 0) prefectKilled(game, p, u);
}

/**
 * A prefect has fallen: he is gone, counted, and his prefecture waits its
 * usual spawn delay before sending the next (sim/services.js counts only the
 * prefects out, so without this a new one would set out at once and a raid
 * would cost the streets nothing).
 */
function prefectKilled(game, p, u) {
  const m = game.military;
  m.stats.prefectsLost = (m.stats.prefectsLost || 0) + 1;
  const home = game.buildings.get(p.origin);
  if (home && home.def.spawnDays) home.spawnTimer = Math.max(home.spawnTimer || 0, home.def.spawnDays);
  u.foe = 0;
  game.events.emit('unitDied', { x: p.x + 0.5, y: p.y + 0.5, side: 'rome', type: 'prefect' });
  lossMessage(game, p, u);
  killWalker(game, p);
}

/**
 * One message for prefects falling together: from the second killed within
 * PREFECT_LOSS_DAYS and PREFECT_LOSS_NEAR tiles, and then not again until
 * PREFECT_LOSS_DAYS have passed. One per prefect would flood the log in a
 * big raid; none at all would hide that the watch is being cut down.
 */
function lossMessage(game, p, u) {
  const m = game.military;
  const day = game.time.totalDays;
  const keep = CONFIG.PREFECT_LOSS_DAYS;
  const losses = (m.prefectLosses || []).filter((l) => day - l.day < keep);
  losses.push({ day, x: p.x, y: p.y });
  m.prefectLosses = losses;
  const near = losses.filter((l) => Math.max(Math.abs(l.x - p.x), Math.abs(l.y - p.y)) <= CONFIG.PREFECT_LOSS_NEAR).length;
  if (near < 2 || day - (m.lastPrefectMessageDay ?? -999) < keep) return;
  m.lastPrefectMessageDay = day;
  const by = u.legion || u.type === 'imperial' ? 'Caesar\'s legionaries have' : 'Raiders have';
  game.message(`${by} killed ${near} prefects in the streets! Their prefectures will send others.`, 'bad', p.x, p.y);
}

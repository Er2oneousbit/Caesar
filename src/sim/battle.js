/**
 * battle.js
 * ----------------------------------------------------------------------------
 * Distant battles: Caesar asks the province for troops to defend a city of
 * the empire (data/battles.js), and the battle is fought BATTLE_MONTHS later.
 * The original's rules, in Colonia's units, with the fleet able to answer a
 * call to a city by the sea (Colonia's own).
 *
 * The request (monthly)
 *   A mission's scheduled events (data/scenarios.js distantBattles): in the
 *   mission's year `year`, in a month from Martius to October drawn from the
 *   map's seed on a stream of its own (the game's own random stream is never
 *   touched, so a city that is never asked plays exactly as before). The
 *   sandbox, with raids on: from SANDBOX_BATTLE_FROM months, each month a
 *   SANDBOX_BATTLE_CHANCE draw on that stream, picking the city and the
 *   enemy's strength. A request that comes while another battle is still
 *   being fought, its troops are on the road or its city is still in enemy
 *   hands is dropped, as in the original.
 *
 * Sending (the Imperial advisor; once per battle, while it is pending)
 *   Every fort whose Empire service switch is on sends all its soldiers, and,
 *   when the city lies on a sea route and the province's water reaches the
 *   sea, every Naval Station switched on sends its squadron. Their strength
 *   is fixed there and then: battleStrength (sim/training.js) of each man and
 *   ship. Soldiers march to the map exit and ships sail to the sea entry,
 *   leaving the province there; their records travel with the troops
 *   (`sent.men`, `sent.ships`). Their places at home are kept: the barracks
 *   and the navalia do not fill them, and they are paid as before.
 *
 * The march (monthly while the battle is pending)
 *   At the start the troops are marchMonths away (the length of their way on
 *   the empire map). Each month they come a month nearer, and one more while
 *   they are farther off than the enemy is from the city (troops sent late
 *   catch up), never nearer than 1. The enemy waits at its gathering place
 *   until its own march (enemyMonths) must begin, and reaches the city in the
 *   battle's month.
 *
 * The battle (the month it is due), in this order:
 *   nobody sent                        lost: favor -50
 *   troops more than BATTLE_IN_TIME away  lost, too late: favor -25; the
 *                                      troops turn back unharmed
 *   their strength under the enemy's   lost, too weak: favor -10, and every
 *                                      man and ship sent is lost
 *   otherwise                          won: favor +25 and the right to build
 *                                      one more triumphal arch; each fort and
 *                                      station sent loses a share of its men
 *                                      by the margin (CONFIG.BATTLE_LOSSES)
 *   Troops that survive come home after as many months as they had covered,
 *   and walk (or sail) back in to their fort or station; one whose fort or
 *   station is gone disbands. A lost city is in enemy hands for
 *   BATTLE_FOREIGN_MONTHS (after any troops are home), then retaken.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { RNG } from '../core/rng.js';
import { UNIT_TYPES } from '../data/units.js';
import { THREATENED_CITIES, THREATENED_IDS, marchMonths, enemyWords } from '../data/battles.js';
import { Unit, removeUnit } from './military.js';
import { battleStrength, endDrill } from './training.js';
import { waterOf, shoreBerth } from './navy.js';

/** Ticks a soldier or ship may take to leave the province before it is taken to have found a way. */
export const AWAY_MAX_TICKS = CONFIG.TICKS_PER_DAY * 16;

/** The random stream for battles: its own, so the game's stream is untouched (see the header). */
function battleRng(game, key) {
  return new RNG(`${game.seed}:battle:${key}`);
}

/** The month (0-11) a mission's scheduled battle number `k` is asked for: Martius to October. */
export function requestMonth(game, k) {
  return 2 + battleRng(game, `event${k}`).range(0, 7);
}

/** The battle in progress, or null. */
export function currentBattle(game) {
  return game.military?.battle || null;
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

/** Monthly (after the month's ratings): requests, the march, the battle, the way home. */
export function battleMonthly(game) {
  const m = game.military;
  if (!m) return;
  const b = m.battle;
  const now = game.time.totalMonths;
  if (b) {
    if (b.phase === 'pending') {
      if (now >= b.due) fightBattle(game);
      else if (b.sent) stepMarch(game, b);
    } else if (b.phase === 'returning') {
      b.homeIn--;
      if (b.homeIn <= 0) troopsHome(game);
    } else if (b.phase === 'foreign') {
      b.foreignLeft--;
      if (b.foreignLeft <= 0) {
        game.message(`${THREATENED_CITIES[b.city].name} has been retaken by Rome.`, 'info');
        endBattle(game);
      }
    }
  }
  // (A request that comes while a battle is going on is dropped.)
  const req = dueRequest(game, now);
  if (req && !m.battle) requestTroops(game, req.city, req.enemy);
}

/** A request due this month, or null: a scheduled one, or (the sandbox, raids on) a random one. */
function dueRequest(game, now) {
  const events = game.scenario.distantBattles;
  if (Array.isArray(events)) {
    for (let k = 0; k < events.length; k++) {
      const e = events[k];
      if (THREATENED_CITIES[e.city] && now === (e.year - 1) * CONFIG.MONTHS_PER_YEAR + requestMonth(game, k)) return e;
    }
    return null;
  }
  const m = game.military;
  if (game.scenario.id !== 'sandbox' || !m.settings || m.battle) return null;
  if (now < CONFIG.SANDBOX_BATTLE_FROM || now - (m.battles?.lastEndMonth ?? -999) < CONFIG.SANDBOX_BATTLE_GAP) return null;
  // Only a city with an army to send is asked (Colonia's own, for the
  // sandbox): a staffed fort with men in it, or, for a city by the sea, a
  // Naval Station with ships and water to the sea. A city with no army never
  // hears of a war it could not join, nor pays 50 favor for it.
  const army = armyAtHome(game);
  const cities = army.soldiers ? THREATENED_IDS : army.ships ? THREATENED_IDS.filter((id) => THREATENED_CITIES[id].route === 'sea') : [];
  if (!cities.length) return null;
  const rng = battleRng(game, now);
  if (!rng.chance(CONFIG.SANDBOX_BATTLE_CHANCE)) return null;
  return { city: rng.pick(cities), enemy: 16 + 4 * rng.range(0, 6) };
}

/** Is there an army at home: soldiers of a staffed fort, ships of a station (with water to the sea)? */
export function armyAtHome(game) {
  let soldiers = false;
  let ships = false;
  for (const u of game.units.values()) {
    if (u.side !== 'rome' || u.away) continue;
    const post = game.buildings.get(u.fort || u.station);
    if (!post) continue;
    if (post.def.kind === 'fort' && post.efficiency > 0) soldiers = true;
    else if (post.def.kind === 'station' && game.map.seaEntry) ships = true;
  }
  return { soldiers, ships };
}

/** Caesar asks for troops: the battle is set for BATTLE_MONTHS from now. */
export function requestTroops(game, cityId, enemy) {
  const c = THREATENED_CITIES[cityId];
  if (!c) return null;
  const now = game.time.totalMonths;
  const b = { city: cityId, enemy, requested: now, due: now + CONFIG.BATTLE_MONTHS, phase: 'pending', sent: null, outcome: null, homeIn: 0, foreignLeft: 0 };
  game.military.battle = b;
  const sea = c.route === 'sea';
  game.message(`Caesar calls for troops: ${enemyWords(enemy)} of ${c.enemy} threatens ${c.name}, and the battle will be fought in ${CONFIG.BATTLE_MONTHS} months. Switch forts${sea ? ' (and, for a city by the sea, naval stations)' : ''} to Empire service and send them from the Imperial advisor; they need about ${marchMonths(cityId)} months to get there.`, 'imperial');
  game.events.emit('sound', { name: 'fanfare' });
  return b;
}

// ---------------------------------------------------------------------------
// Empire service and sending
// ---------------------------------------------------------------------------

/** Turn a fort's or Naval Station's Empire service switch on or off. */
export function setService(game, b, on) {
  if (!b || (b.def.kind !== 'fort' && b.def.kind !== 'station')) return false;
  b.service = !!on;
  return true;
}

/** Can the fleet answer this battle's call (a city on a sea route, and water from the sea)? */
export function fleetCanGo(game, cityId) {
  return THREATENED_CITIES[cityId]?.route === 'sea' && !!game.map.seaEntry;
}

/** The men and ships that would go if sent now: of every fort and station switched on, at home. */
export function serviceUnits(game, cityId) {
  const ships = fleetCanGo(game, cityId);
  const out = [];
  for (const u of game.units.values()) {
    if (u.side !== 'rome' || u.away) continue;
    const post = game.buildings.get(u.fort || u.station);
    if (!post || !post.service) continue;
    if (UNIT_TYPES[u.type].naval ? ships && post.def.kind === 'station' : post.def.kind === 'fort') out.push(u);
  }
  return out;
}

/** Strength of a list of men and ships (battleStrength each). */
export function strengthOf(units) {
  let s = 0;
  for (const u of units) s += battleStrength(u);
  return s;
}

/** Why troops cannot be sent right now, or '' when they can. */
export function sendBlocked(game) {
  const b = currentBattle(game);
  if (!b || b.phase !== 'pending') return 'Caesar has asked for no troops.';
  if (b.sent) return 'Your troops are already on their way.';
  if (!serviceUnits(game, b.city).length) return 'No soldiers to send: switch forts with soldiers in them to Empire service first.';
  return '';
}

/**
 * Send every man (and ship) of the forts and stations switched to Empire
 * service. @returns {{ok:boolean, reason?:string, men?:number, ships?:number, strength?:number}}
 */
export function sendTroops(game) {
  const why = sendBlocked(game);
  if (why) return { ok: false, reason: why };
  const b = currentBattle(game);
  const units = serviceUnits(game, b.city);
  const strength = strengthOf(units);
  const march = marchMonths(b.city);
  b.sent = { month: game.time.totalMonths, march, toGo: march, strength, men: [], ships: [], count: units.length };
  let men = 0;
  let ships = 0;
  for (const u of units) {
    endDrill(u);
    u.away = true;
    u.awayTick = game.time.totalTicks;
    u.path = null;
    u.target = 0;
    u.state = 'away';
    if (UNIT_TYPES[u.type].naval) ships++; else men++;
  }
  const c = THREATENED_CITIES[b.city];
  game.message(`${men} soldier${men === 1 ? '' : 's'}${ships ? ` and ${ships} liburnian${ships === 1 ? '' : 's'}` : ''} set out for ${c.name} (strength ${strength}). They need about ${march} months to get there.`, 'imperial');
  game.events.emit('sound', { name: 'horn' });
  return { ok: true, men, ships, strength };
}

/** A soldier or ship reached the edge of the province: it goes on with the troops. */
export function leaveForBattle(game, u) {
  const b = currentBattle(game);
  if (!b || !b.sent || b.phase !== 'pending') { u.away = false; u.state = 'march'; return; } // (the battle is over: home)
  const rec = { ...u, path: null, target: 0, away: false, moving: false };
  (UNIT_TYPES[u.type].naval ? b.sent.ships : b.sent.men).push(rec);
  removeUnit(game, u, 'away');
}

/** Records of the men and ships away (on the road, at the battle or coming home). */
function awayRecords(game) {
  const b = currentBattle(game);
  if (!b || !b.sent) return [];
  return [...b.sent.men, ...b.sent.ships];
}

/** Men and ships away per fort or station id (their places are kept). */
export function awayCounts(game) {
  const out = new Map();
  for (const r of awayRecords(game)) {
    const post = r.fort || r.station;
    if (post) out.set(post, (out.get(post) || 0) + 1);
  }
  return out;
}

/** The away records of one fort or station. */
export function awayOf(game, postId) {
  return awayRecords(game).filter((r) => (r.fort || r.station) === postId);
}

/**
 * A fort or Naval Station is gone (sim/military.js disbandFort, sim/navy.js
 * stationLost): its men and ships away at a distant battle have no post to
 * come back to, so they are released there and then: no more pay, no place
 * kept. Their strength still counts in the battle (it was fixed when they
 * were sent). @returns {number} how many were released
 */
export function dropAway(game, postId) {
  const b = currentBattle(game);
  if (!b || !b.sent) return 0;
  const before = b.sent.men.length + b.sent.ships.length;
  const keep = (r) => (r.fort || r.station) !== postId;
  b.sent.men = b.sent.men.filter(keep);
  b.sent.ships = b.sent.ships.filter(keep);
  return before - b.sent.men.length - b.sent.ships.length;
}

/** What the men and ships away cost a month (they are paid as at home). */
export function awayUpkeep(game) {
  let n = 0;
  // (Only men and ships with a post to come back to: dropAway releases the rest.)
  for (const r of awayRecords(game)) if (game.buildings.has(r.fort || r.station)) n += UNIT_TYPES[r.type]?.upkeep || 0;
  return n;
}

// ---------------------------------------------------------------------------
// The march and the battle
// ---------------------------------------------------------------------------

/** Months the enemy still has to march to the city, with `left` months before the battle. */
export function enemyToGo(b, left) {
  return Math.max(0, Math.min(THREATENED_CITIES[b.city].enemyMonths, left - 1));
}

/** A month on the road: one nearer, and one more while farther off than the enemy; never under 1. */
export function stepMarch(game, b) {
  const s = b.sent;
  const enemy = enemyToGo(b, b.due - game.time.totalMonths);
  let t = s.toGo - 1;
  if (t > enemy) t--;
  s.toGo = Math.max(1, t);
}

/**
 * How far off troops `toGo` months away now (or, by default, those already
 * sent; else troops sent this month) will be when the battle comes: the march
 * played forward month by month. In time when it is BATTLE_IN_TIME or less.
 */
export function projectedToGo(b, now, toGo = b.sent ? b.sent.toGo : marchMonths(b.city)) {
  let t = toGo;
  for (let m = now + 1; m < b.due; m++) {
    const e = enemyToGo(b, b.due - m);
    let x = t - 1;
    if (x > e) x--;
    t = Math.max(1, x);
  }
  return t;
}

/** The share of each fort's and station's men lost in a battle won by this advantage (CONFIG.BATTLE_LOSSES). */
export function lossShare(advantage) {
  for (const [upTo, share] of CONFIG.BATTLE_LOSSES) if (advantage <= upTo) return share;
  return 0;
}

/** The advantage of a won battle: 100 x (Rome - enemy) / Rome, truncated. */
export function advantageOf(rome, enemy) {
  return rome > 0 ? Math.trunc((100 * (rome - enemy)) / rome) : 0;
}

/** Men and ships still on their way out of the province (sent, not yet gone). */
function leaving(game) {
  const out = [];
  for (const u of game.units.values()) if (u.away) out.push(u);
  return out;
}

/** The battle is fought: who won, what it cost, what Caesar thinks. */
export function fightBattle(game) {
  const m = game.military;
  const b = m.battle;
  const s = b.sent;
  const c = THREATENED_CITIES[b.city];
  const r = game.city.ratings;
  const favor = (k) => { r.favor = Math.max(0, Math.min(100, r.favor + CONFIG.BATTLE_FAVOR[k])); return CONFIG.BATTLE_FAVOR[k]; };
  const late = leaving(game);
  let outcome;
  if (!s) {
    outcome = 'none';
    const f = favor('none');
    game.message(`You sent no troops: ${c.name} has fallen to ${c.enemy}. Caesar will not forget it (${f} favor).`, 'bad');
  } else if (s.toGo > CONFIG.BATTLE_IN_TIME) {
    outcome = 'late';
    const f = favor('late');
    for (const u of late) { u.away = false; u.state = 'march'; } // those still leaving turn back
    game.message(`Your troops were still ${s.toGo} months from ${c.name} when ${c.enemy} took it: too late (${f} favor). They turn for home.`, 'bad');
  } else if (s.strength < b.enemy) {
    outcome = 'weak';
    const f = favor('weak');
    const lost = s.men.length + s.ships.length + late.length;
    for (const u of late) removeUnit(game, u, 'died');
    game.military.stats.soldiersLost += s.men.length;
    game.military.stats.shipsLost = (game.military.stats.shipsLost || 0) + s.ships.length;
    s.men = [];
    s.ships = [];
    game.message(`Defeat at ${c.name}: your troops (strength ${s.strength}) were too few against ${c.enemy} (${b.enemy}), and all ${lost} were lost. The city has fallen (${f} favor).`, 'bad');
  } else {
    outcome = 'won';
    const f = favor('won');
    game.city.archesEarned = (game.city.archesEarned || 0) + 1;
    for (const u of late) { u.away = false; u.state = 'march'; }
    const share = lossShare(advantageOf(s.strength, b.enemy));
    const dead = takeLosses(game, s, share);
    game.message(`Victory at ${c.name}! Your troops (strength ${s.strength}) have beaten ${c.enemy} (${b.enemy})${dead ? `, losing ${dead}` : ''}. Caesar grants you a triumphal arch to build (${f > 0 ? '+' : ''}${f} favor).`, 'good');
    game.events.emit('sound', { name: 'fanfare' });
  }
  b.outcome = outcome;
  if (outcome === 'won') m.battles.won++; else m.battles.lost++;
  const survivors = s ? s.men.length + s.ships.length : 0;
  if (survivors > 0) {
    b.phase = 'returning';
    b.homeIn = Math.max(1, s.march - s.toGo); // as many months as they had covered
    b.homeTotal = b.homeIn; // (for the empire map)
  } else if (outcome === 'won') {
    endBattle(game);
  } else {
    b.phase = 'foreign';
    b.foreignLeft = CONFIG.BATTLE_FOREIGN_MONTHS;
  }
}

/**
 * A won battle's losses: in each fort and station sent, `share` of its men
 * (or ships), truncated, fall. The last of each fort's list fall first.
 * @returns {number} how many fell
 */
function takeLosses(game, s, share) {
  let dead = 0;
  for (const key of ['men', 'ships']) {
    const byPost = new Map();
    for (const rec of s[key]) {
      const post = rec.fort || rec.station;
      if (!byPost.has(post)) byPost.set(post, []);
      byPost.get(post).push(rec);
    }
    const keep = [];
    for (const list of byPost.values()) {
      const n = Math.floor(list.length * share);
      keep.push(...list.slice(0, list.length - n));
      dead += n;
      if (key === 'men') game.military.stats.soldiersLost += n;
      else game.military.stats.shipsLost = (game.military.stats.shipsLost || 0) + n;
    }
    s[key] = keep;
  }
  return dead;
}

/** The troops are back: each man walks in by the map exit, each ship sails in from the sea entry. */
export function troopsHome(game) {
  const m = game.military;
  const b = m.battle;
  const s = b.sent;
  const map = game.map;
  let back = 0;
  let disbanded = 0;
  const free = (post, list) => {
    const used = new Set(list.map((u) => u.slot));
    let k = 0;
    while (used.has(k)) k++;
    return k;
  };
  for (const rec of s.men) {
    const fort = game.buildings.get(rec.fort);
    if (!fort || fort.def.kind !== 'fort') { disbanded++; continue; }
    const mates = [...game.units.values()].filter((u) => u.fort === fort.id);
    const slot = mates.some((u) => u.slot === rec.slot) ? free(fort, mates) : rec.slot;
    restoreUnit(game, rec, map.exit.x + 0.5, map.exit.y + 0.5, { slot, state: 'march' });
    back++;
  }
  // Ships sail in from the sea entry, or appear at their berths when their
  // station's water is not the sea entry's (they went out their own way).
  const sea = map.seaEntry;
  const seaBody = sea ? map.navBody[map.idx(sea.x, sea.y)] : 0;
  for (const rec of s.ships) {
    const st = game.buildings.get(rec.station);
    const body = st && st.def.kind === 'station' ? waterOf(game, st) : 0;
    if (!body) { disbanded++; continue; }
    const mates = [...game.units.values()].filter((u) => u.station === st.id);
    const slot = mates.some((u) => u.slot === rec.slot) ? free(st, mates) : rec.slot;
    const berth = shoreBerth(game, st);
    const at = body === seaBody ? { x: sea.x + 0.5, y: sea.y + 0.5 } : { x: map.xOf(berth) + 0.5, y: map.yOf(berth) + 0.5 };
    restoreUnit(game, rec, at.x, at.y, { slot, state: 'sail', body });
    back++;
  }
  s.men = [];
  s.ships = [];
  const c = THREATENED_CITIES[b.city];
  const what = b.outcome === 'won' ? `Your victorious troops are home from ${c.name}` : `Your troops are back from ${c.name}`;
  game.message(`${what}: ${back} return${back === 1 ? 's' : ''} to ${back === 1 ? 'his post' : 'their posts'}${disbanded ? `, and ${disbanded} with no fort or station left to go to disband` : ''}.`, b.outcome === 'won' ? 'good' : 'info', map.exit.x, map.exit.y);
  if (b.outcome === 'won') endBattle(game);
  else {
    b.phase = 'foreign';
    b.foreignLeft = CONFIG.BATTLE_FOREIGN_MONTHS;
  }
}

/** Put a man or ship back on the map from its record. */
function restoreUnit(game, rec, x, y, set) {
  const u = new Unit(rec.id, rec.type, x, y);
  Object.assign(u, rec, { x, y, px: x, py: y, path: null, pathIndex: 0, target: 0, stuck: 0, away: false, drill: 0, moving: false, cooldown: 0 }, set);
  game.units.set(u.id, u);
  if (u.id >= game.nextUnitId) game.nextUnitId = u.id + 1;
  return u;
}

/** The battle and all that followed it is over. */
function endBattle(game) {
  const m = game.military;
  m.battle = null;
  m.battles.lastEndMonth = game.time.totalMonths;
}

// ---------------------------------------------------------------------------
// For the advisors, the info panels and the empire map
// ---------------------------------------------------------------------------

/**
 * Everything the screens show about the battle, or null:
 * { city, name, enemyName, enemy, words, sea, phase, monthsLeft, enemyToGo,
 *   enemyMonths, march, sent: {toGo, strength, men, ships, month}|null,
 *   outcome, homeIn, foreignLeft, ready: {men, ships, strength} }
 */
export function battleSummary(game) {
  const b = currentBattle(game);
  if (!b) return null;
  const c = THREATENED_CITIES[b.city];
  const now = game.time.totalMonths;
  const left = Math.max(0, b.due - now);
  const ready = b.phase === 'pending' && !b.sent ? serviceUnits(game, b.city) : [];
  const s = b.sent;
  return {
    city: b.city,
    name: c.name,
    enemyName: c.enemy,
    enemy: b.enemy,
    words: enemyWords(b.enemy),
    sea: c.route === 'sea',
    fleet: fleetCanGo(game, b.city),
    phase: b.phase,
    monthsLeft: left,
    enemyToGo: enemyToGo(b, left),
    enemyMonths: c.enemyMonths,
    march: marchMonths(b.city),
    inTime: b.phase === 'pending' ? projectedToGo(b, now) <= CONFIG.BATTLE_IN_TIME : null, // (sent now, or as sent)
    sent: s ? { toGo: s.toGo, strength: s.strength, men: s.men.length + leaving(game).filter((u) => !UNIT_TYPES[u.type].naval).length, ships: s.ships.length + leaving(game).filter((u) => UNIT_TYPES[u.type].naval).length, month: s.month, march: s.march } : null,
    outcome: b.outcome,
    homeIn: b.homeIn,
    foreignLeft: b.foreignLeft,
    ready: { men: ready.filter((u) => !UNIT_TYPES[u.type].naval).length, ships: ready.filter((u) => UNIT_TYPES[u.type].naval).length, strength: strengthOf(ready) },
  };
}

/** Triumphal arches the city may still build: one per battle won, less those standing. */
export function archesToBuild(game) {
  let standing = 0;
  for (const b of game.buildings.values()) if (b.def.kind === 'arch') standing++;
  return Math.max(0, (game.city.archesEarned || 0) - standing);
}

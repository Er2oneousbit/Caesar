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
 *   ship. They leave the province at once (the march months stand for the
 *   whole way); their records travel with the troops (`sent.men`,
 *   `sent.ships`). Their places at home are kept: the barracks
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
 *
 * Recall (Colonia's own; a fort's or station's panel, the Imperial advisor)
 *   While the battle is pending, the men (and ships) of one fort or station
 *   can be called back. Those still in the province on their way out (only
 *   in a save from before v0.18.3, when troops walked to the map's edge
 *   first) turn at once. Those already gone are reached by a rider, who rides at twice
 *   the marching pace: he needs riderMonths(covered) = half the months they
 *   have marched, rounded up, at least 1. They march on meanwhile (they do
 *   not know yet); when he reaches them they turn back and come home after
 *   as many months as they had marched out by then. Turned back, they no
 *   longer count in the battle (their strength comes off the army's). A
 *   rider who has not reached them when the battle is fought is too late:
 *   they fight with the rest, and come home by the battle's rule. An army
 *   everyone was called back from is "nobody sent" (-50 favor), so sending
 *   and recalling never costs less than staying home. Riders and the men
 *   coming home are military.recalls (they outlive the battle):
 *     { post, city, march, rider, riderTotal, homeIn, homeTotal, men, ships }
 *   rider > 0: the rider is out (his men are still in sent.men/ships);
 *   rider 0: turned back, their records in men/ships, home in homeIn months.
 *
 * No new men while deployed (sim/military.js, sim/navy.js)
 *   A fort or station with a rally point, or with men or ships away (on
 *   their way out, at the battle, or coming home), takes no recruits and no
 *   new liburnians: takesNewMen(). One already on his way still joins.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { RNG } from '../core/rng.js';
import { UNIT_TYPES } from '../data/units.js';
import { THREATENED_CITIES, SANDBOX_THREATENED_IDS, marchMonths, enemyWords } from '../data/battles.js';
import { homeSiteId } from '../data/sites.js';
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
  recalledMonthly(game); // (first: a group the rider turns this month starts its way home next month)
  if (b) {
    if (b.phase === 'pending') {
      if (now < b.due && b.sent) stepMarch(game, b);
      // A rider reaching his men in the battle's own month turns them in time.
      if (b.sent) ridersMonthly(game, b);
      if (now >= b.due) fightBattle(game);
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
  const cities = army.soldiers ? SANDBOX_THREATENED_IDS : army.ships ? SANDBOX_THREATENED_IDS.filter((id) => THREATENED_CITIES[id].route === 'sea') : [];
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
  game.message(`Caesar calls for troops: ${enemyWords(enemy)} of ${c.enemy} threatens ${c.name}, and the battle will be fought in ${CONFIG.BATTLE_MONTHS} months. Switch forts${sea ? ' (and, for a city by the sea, naval stations)' : ''} to Empire service and send them from the Imperial advisor; they need about ${marchMonths(homeSiteId(game), cityId)} months to get there.`, 'imperial', undefined, undefined, { kind: 'troops' });
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
  const march = marchMonths(homeSiteId(game), b.city);
  b.sent = { month: game.time.totalMonths, march, toGo: march, strength, men: [], ships: [], count: units.length };
  let men = 0;
  let ships = 0;
  // They leave the province at once: walking to the map's edge first took
  // longer than some of the marches themselves (playtest), and the march
  // months already stand for the whole way.
  for (const u of units) {
    endDrill(u);
    if (UNIT_TYPES[u.type].naval) ships++; else men++;
    leaveForBattle(game, u);
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

/** Records of the men and ships away (on the road, at the battle or coming home, recalled ones too). */
function awayRecords(game) {
  const b = currentBattle(game);
  const out = b && b.sent ? [...b.sent.men, ...b.sent.ships] : [];
  for (const r of game.military?.recalls || []) out.push(...r.men, ...r.ships);
  return out;
}

/**
 * Fort and station ids with any man or ship away: on his way out of the
 * province, gone to a distant battle, or coming home from it.
 */
export function postsAway(game) {
  const out = new Set(awayCounts(game).keys());
  for (const u of game.units.values()) if (u.away && (u.fort || u.station)) out.add(u.fort || u.station);
  return out;
}

/**
 * May this fort or station take a new recruit (or liburnian)? Not while it
 * is deployed (a rally point) or any of its men are away: new men would
 * only stand about the city with nobody to lead them. `away`: postsAway(),
 * passed in by callers that check many posts.
 */
export function takesNewMen(game, post, away = postsAway(game)) {
  return !post.rally && !away.has(post.id);
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
  const m = game.military;
  let n = 0;
  if (b && b.sent) {
    const before = b.sent.men.length + b.sent.ships.length;
    const keep = (r) => (r.fort || r.station) !== postId;
    b.sent.men = b.sent.men.filter(keep);
    b.sent.ships = b.sent.ships.filter(keep);
    n += before - b.sent.men.length - b.sent.ships.length;
  }
  // Recalled and on their way home, or a rider out to them: no post to come home to.
  if (m && m.recalls) {
    for (const r of m.recalls) if (r.post === postId) n += r.men.length + r.ships.length;
    m.recalls = m.recalls.filter((r) => r.post !== postId);
  }
  return n;
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
 * How far off troops `toGo` months away now (by default, those already
 * sent; for troops sent this month, pass their march) will be when the
 * battle comes: the march played forward month by month. In time when it is
 * BATTLE_IN_TIME or less.
 */
export function projectedToGo(b, now, toGo = b.sent.toGo) {
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

/**
 * A man or ship on his way out of the province turns for home: his route to
 * the exit is dropped too, or he would walk it to the end before turning.
 */
function turnHome(u) {
  u.away = false;
  u.state = UNIT_TYPES[u.type].naval ? 'sail' : 'march';
  u.path = null;
  u.pathIndex = 0;
  u.target = 0;
  u.stuck = 0;
  u.noPath = 0;
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
  ridersTooLate(game);
  let outcome;
  if (!s || s.strength <= 0) {
    // (Strength 0 with troops sent: every one of them was called back.)
    outcome = 'none';
    const f = favor('none');
    game.message(`${s ? 'You called all your troops back' : 'You sent no troops'}: ${c.name} has fallen to ${c.enemy}. Caesar will not forget it (${f} favor).`, 'bad');
  } else if (s.toGo > CONFIG.BATTLE_IN_TIME) {
    outcome = 'late';
    const f = favor('late');
    for (const u of late) turnHome(u); // those still leaving turn back
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
    for (const u of late) turnHome(u);
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
  const { back, disbanded } = bringBack(game, s.men, s.ships);
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

/**
 * Put men and ships back on the map from their records: each man walks in
 * by the map exit, each ship sails in from the sea entry (or appears at its
 * berth on other water). Those whose fort or station is gone disband.
 * @returns {{back:number, disbanded:number}}
 */
function bringBack(game, men, ships) {
  const map = game.map;
  let back = 0;
  let disbanded = 0;
  const free = (post, list) => {
    const used = new Set(list.map((u) => u.slot));
    let k = 0;
    while (used.has(k)) k++;
    return k;
  };
  for (const rec of men) {
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
  for (const rec of ships) {
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
  return { back, disbanded };
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
// Recall (see the header)
// ---------------------------------------------------------------------------

/**
 * Months a rider needs to reach troops who have marched `covered` months:
 * he rides at twice their pace, so half of it, rounded up, and at least the
 * month the order takes to go out (the battle's clock counts in months).
 */
export function riderMonths(covered) {
  return Math.max(1, Math.ceil(Math.max(0, covered) / 2));
}

/**
 * The recall entry of a fort or station, or null: its rider out, else its
 * men coming home (a post can have both only across two battles).
 */
export function recallOf(game, postId) {
  const mine = (game.military?.recalls || []).filter((r) => r.post === postId);
  return mine.find((r) => r.rider > 0) || mine[0] || null;
}

/** The records of a post's men and ships still with the army (not turned back). */
function withArmy(s, postId) {
  const mine = (r) => (r.fort || r.station) === postId;
  return { men: s.men.filter(mine), ships: s.ships.filter(mine) };
}

/** Why a fort's or station's troops cannot be recalled now, or '' when they can. */
export function recallBlocked(game, postId) {
  const b = currentBattle(game);
  if (!b || b.phase !== 'pending' || !b.sent) return 'None of its men are on their way to a battle.';
  if ((game.military.recalls || []).some((r) => r.post === postId && r.rider > 0)) return 'A rider is already carrying the order.';
  const out = withArmy(b.sent, postId);
  const leavingHere = leaving(game).some((u) => (u.fort || u.station) === postId);
  if (!out.men.length && !out.ships.length && !leavingHere) return 'None of its men are on their way to the battle.';
  return '';
}

/**
 * Call a fort's or station's men (or ships) back from the battle. Those
 * still in the province turn at once; a rider goes after the rest.
 * @returns {{ok:boolean, reason?:string, turned?:number, rider?:number}}
 *   turned: how many turned at once; rider: months until he reaches the rest (0: none needed)
 */
export function recallFromBattle(game, postId) {
  const why = recallBlocked(game, postId);
  if (why) return { ok: false, reason: why };
  const b = currentBattle(game);
  const s = b.sent;
  const post = game.buildings.get(postId);
  const name = post ? post.def.name : 'post';
  let turned = 0;
  for (const u of leaving(game)) {
    if ((u.fort || u.station) !== postId) continue;
    turnHome(u);
    s.strength = Math.max(0, s.strength - battleStrength(u));
    turned++;
  }
  const out = withArmy(s, postId);
  let rider = 0;
  if (out.men.length || out.ships.length) {
    rider = riderMonths(s.march - s.toGo);
    if (!game.military.recalls) game.military.recalls = [];
    game.military.recalls.push({ post: postId, city: b.city, march: s.march, rider, riderTotal: rider, homeIn: 0, homeTotal: 0, men: [], ships: [] });
  }
  const c = THREATENED_CITIES[b.city];
  const parts = [];
  if (turned) parts.push(`${turned} still in the province turn back at once`);
  if (rider) {
    const left = b.due - game.time.totalMonths;
    const when = rider > left ? ', after the battle: too late to keep them out of it' : rider === left ? ', just before the battle' : '';
    parts.push(`a rider sets out after the ${out.men.length + out.ships.length} on the road to ${c.name} and will reach them in ${rider} month${rider === 1 ? '' : 's'}${when}`);
  }
  game.message(`You recall the troops of the ${name}: ${parts.join(', and ')}.`, 'imperial', post?.x, post?.y);
  game.events.emit('sound', { name: 'horn' });
  return { ok: true, turned, rider };
}

/** Monthly, while the battle is pending: each rider out rides on, and turns his men when he reaches them. */
function ridersMonthly(game, b) {
  for (const r of game.military.recalls || []) {
    if (r.rider <= 0) continue;
    r.rider--;
    if (r.rider <= 0) turnBack(game, b, r);
  }
  if (game.military.recalls) game.military.recalls = game.military.recalls.filter((r) => r.rider > 0 || r.men.length + r.ships.length > 0);
}

/** The rider has reached his men: they leave the army and turn for home, as far off as they had marched. */
function turnBack(game, b, r) {
  const s = b.sent;
  const out = withArmy(s, r.post);
  const gone = new Set([...out.men, ...out.ships]);
  if (!gone.size) return; // (their post is gone and they were released: dropAway)
  s.men = s.men.filter((x) => !gone.has(x));
  s.ships = s.ships.filter((x) => !gone.has(x));
  s.strength = Math.max(0, s.strength - strengthOf(gone));
  r.men = out.men;
  r.ships = out.ships;
  r.homeIn = r.homeTotal = Math.max(1, s.march - s.toGo);
  const post = game.buildings.get(r.post);
  const n = gone.size;
  game.message(`The rider has reached the troops of the ${post ? post.def.name : 'post'} on the road to ${THREATENED_CITIES[b.city].name}: ${n === 1 ? 'he turns' : `all ${n} turn`} for home, ${r.homeIn} month${r.homeIn === 1 ? '' : 's'} away.`, 'imperial');
}

/** The battle is fought with riders still out: their men fought with the rest; the orders are void. */
function ridersTooLate(game) {
  const m = game.military;
  const late = (m.recalls || []).filter((r) => r.rider > 0);
  if (!late.length) return;
  m.recalls = m.recalls.filter((r) => r.rider <= 0);
  const names = late.map((r) => game.buildings.get(r.post)?.def.name).filter(Boolean);
  game.message(`The rider${late.length === 1 ? '' : 's'} did not reach the troops${names.length ? ` of the ${names.join(' and the ')}` : ''} before the battle: they fought with the rest.`, 'imperial');
}

/** Monthly: recalled troops on their way home come one month nearer, and walk (or sail) back in when they arrive. */
function recalledMonthly(game) {
  const m = game.military;
  if (!m.recalls || !m.recalls.length) return;
  const keep = [];
  for (const r of m.recalls) {
    if (r.rider > 0) { keep.push(r); continue; }
    r.homeIn--;
    if (r.homeIn > 0) { keep.push(r); continue; }
    const { back, disbanded } = bringBack(game, r.men, r.ships);
    const post = game.buildings.get(r.post);
    const map = game.map;
    game.message(`Your recalled troops are home from the road to ${THREATENED_CITIES[r.city]?.name || 'the battle'}: ${back} return${back === 1 ? 's' : ''} to the ${post ? post.def.name : 'post'}${disbanded ? `, and ${disbanded} with no post left to go to disband` : ''}.`, 'info', map.exit.x, map.exit.y);
  }
  m.recalls = keep;
}

// ---------------------------------------------------------------------------
// For the advisors, the info panels and the empire map
// ---------------------------------------------------------------------------

/**
 * Everything the screens show about the battle, or null:
 * { city, name, enemyName, enemy, words, sea, phase, monthsLeft, enemyToGo,
 *   enemyMonths, march, sent: {toGo, strength, men, ships, month}|null,
 *   outcome, homeIn, foreignLeft, ready: {men, ships, strength},
 *   recalls: recallSummary() }
 */
export function battleSummary(game) {
  const b = currentBattle(game);
  if (!b) return null;
  const c = THREATENED_CITIES[b.city];
  const now = game.time.totalMonths;
  const left = Math.max(0, b.due - now);
  const ready = b.phase === 'pending' && !b.sent ? serviceUnits(game, b.city) : [];
  const s = b.sent;
  const march = marchMonths(homeSiteId(game), b.city); // from this province's site (data/sites.js)
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
    march,
    inTime: b.phase === 'pending' ? projectedToGo(b, now, s ? s.toGo : march) <= CONFIG.BATTLE_IN_TIME : null, // (sent now, or as sent)
    sent: s ? { toGo: s.toGo, strength: s.strength, men: s.men.length + leaving(game).filter((u) => !UNIT_TYPES[u.type].naval).length, ships: s.ships.length + leaving(game).filter((u) => UNIT_TYPES[u.type].naval).length, month: s.month, march: s.march } : null,
    outcome: b.outcome,
    homeIn: b.homeIn,
    foreignLeft: b.foreignLeft,
    ready: { men: ready.filter((u) => !UNIT_TYPES[u.type].naval).length, ships: ready.filter((u) => UNIT_TYPES[u.type].naval).length, strength: strengthOf(ready) },
    recalls: recallSummary(game),
  };
}

/**
 * Riders out and recalled troops coming home, for the screens:
 * [{ post, name, city, cityName, march, rider, riderTotal, homeIn, homeTotal, men, ships }]
 * (`men`/`ships`: those coming home; while the rider is out, those he rides after).
 */
export function recallSummary(game) {
  const b = currentBattle(game);
  return (game.military?.recalls || []).map((r) => {
    const out = r.rider > 0 && b && b.sent ? withArmy(b.sent, r.post) : r;
    return {
      post: r.post, name: game.buildings.get(r.post)?.def.name || 'Post', city: r.city, cityName: THREATENED_CITIES[r.city]?.name || '',
      march: r.march, rider: r.rider, riderTotal: r.riderTotal, homeIn: r.homeIn, homeTotal: r.homeTotal, men: out.men.length, ships: out.ships.length,
    };
  });
}

/** Triumphal arches the city may still build: one per battle won, less those standing. */
export function archesToBuild(game) {
  let standing = 0;
  for (const b of game.buildings.values()) if (b.def.kind === 'arch') standing++;
  return Math.max(0, (game.city.archesEarned || 0) - standing);
}

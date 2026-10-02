#!/usr/bin/env node
/**
 * simulate.mjs - headless balance simulation
 * ----------------------------------------------------------------------------
 * Builds the demo city on a map and fast-forwards, printing one line of city
 * statistics per month, then a summary (fires, ratings, raids, crime,
 * health and disease, money). Use it to check balance changes without playing.
 *
 * Money: the city starts with SIM_MONEY so that it never feels poverty (a city
 * in debt cannot build, and favor falls), and the report says what it would
 * have needed instead: the most it was ever out of pocket (building plus the
 * running losses before it pays its way) against what the difficulty gives,
 * and the month it would have gone into debt. `npm run sweep` compares that
 * across difficulties and missions.
 *
 * Usage:
 *   node scripts/simulate.mjs [--scenario c1] [--type river] [--size 64]
 *                             [--seed demo] [--years 3] [--level 2]
 *                             [--difficulty normal] [--json]
 *   npm run sim -- --years 5
 *   npm run sim -- --difficulty insane --raids frequent --garrison
 *   npm run sim -- --pace       (how long the campaign's goals take, no city)
 *   npm run sim -- --capacity   (how many people each mission's buildings employ, no city)
 *   npm run sim -- --scenario c1 --unlocks --homes 40   (mission 1 as a player could build it)
 *   npm run sim -- --type coast --seed beach --years 4 --harbor   (sea trade: ships' stays at the dock)
 *   npm run sim -- --type coast --fishing 2   (two fishing wharves and a shipyard: fish a year per wharf)
 *   npm run sim -- --level 3 --venues --hippodrome   (the big venues and the hippodrome: entertainment scores)
 *   npm run sim -- --size 96 --level 3 --uptown --cloth --years 5   (Insulae, with clothing from the cloth industry)
 *   npm run sim -- --size 96 --level 3 --uptown --cloth --cloth-off 36 --years 5   (and when it stops)
 *   npm run sim -- --type coast --raids frequent --garrison --navy --years 8   (sea raids against a fleet)
 *   npm run sim -- --type coast --raids frequent --garrison --navy --academy --years 8   (and training)
 *
 * Campaign runs build every building unless --unlocks is given (then only
 * what the mission unlocks), so their numbers stay comparable with earlier
 * sweeps; a sandbox unlocks everything, so --unlocks changes nothing there.
 *
 * Made with ❤️ from your friendly hacker - er2oneousbit
 * ----------------------------------------------------------------------------
 */

import { Game } from '../src/core/game.js';
import { SCENARIOS, sandboxScenario, withDifficulty } from '../src/data/scenarios.js';
import { DIFFICULTY } from '../src/data/difficulty.js';
import { buildDemoCity, buildDemoGarrison, buildDemoHarbor, buildDemoFishery, buildDemoVenues, buildDemoHippodrome, buildDemoUptown, buildDemoCloth, buildDemoNavy, buildDemoResidence, UPTOWN_GOODS, DEMO_YARD_TIMBER } from '../src/dev/demoCity.js';
import { launchLegion, legionCount, soldierCount, isOverrun } from '../src/sim/legion.js';
import { trainedTotals } from '../src/sim/training.js';
import { log } from '../src/core/debug.js';
import { FOOD_TYPES } from '../src/data/goods.js';
import { goalMonths, monthsToMinutes, PACE_MOOD } from '../src/sim/pace.js';
import { sickHomes } from '../src/sim/disease.js';
import { planAction, applyPlan, anchorOffset } from '../src/sim/construction.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { missionCapacity, landOf } from '../src/sim/capacity.js';
import { generateMap } from '../src/world/mapgen.js';
import { HOUSE_TIERS } from '../src/data/housing.js';
import { CONFIG } from '../src/config.js';
import { goalStatus } from '../src/sim/ratings.js';
import { setTradeMode } from '../src/sim/trade.js';
import { spareBoat, hasBoatTimber } from '../src/sim/fishing.js';

const HELP = `
Headless balance simulation

  node scripts/simulate.mjs [options]

Options:
  --scenario <id>   campaign scenario id (c1..c7, c3m, c4p, c5p) instead of a sandbox map
  --unlocks         build only what the mission unlocks (campaign runs build everything without it)
  --homes <n>       at most n housing plots, to size the town to its jobs (default: the whole site)
  --type <t>        sandbox landscape: river | coast | lakes | plains | desert (default river)
  --size <n>        sandbox map size (default 64; Uber is 256)
  --difficulty <d>  easy | normal | hard | insane (default normal)
  --seed <s>        map seed (default "demo")
  --years <n>       years to simulate (default 3)
  --level <1-3>     demo city complexity (default 2)
  --garrison        also build a barracks, forts, towers and a wall (equipped)
  --harbor [docks]  after 6 months, a Dock (or this many) and a warehouse by the water, every sea
                    route open; the warehouse gets 300 pottery, furniture and oil a month for
                    export (the demo city makes none). Reports ships' stays and trade a year
  --fishing <n>     also build a shipyard and n fishing wharves (and a granary by them); the
                    shipyard starts with 400 timber (the demo city fells none)
  --venues          also build an amphitheater, a colosseum, a gladiator school and a menagerie
  --hippodrome      also build a hippodrome and a chariot maker
  --uptown          lift the homes toward the Insula: plazas, statues, a library, baths, the big
                    venues, vegetable farms; markets get pottery, furniture and oil every month
                    (a stand-in for those industries). Everything an Insula needs but clothing
  --cloth           also build the cloth industry: a flax farm, a linen maker, a clothing maker
  --cloth-off <m>   demolish the cloth industry after month m (homes lose their clothing)
  --caretaker       rebuild whatever burns or collapses, as a player would (npm run sweep)
  --salary          the governor draws his rank's salary from the treasury (default: none, so the
                    money and favor reported are the city's own)
  --raids <mode>    off | occasional | frequent (overrides the scenario)
  --sea-raids <s>   on | off: the Sea raids switch (default on: some raids come by sea where ships can sail)
  --navy            also build a naval station and a navalia, stocked for a squadron (where ships can sail)
  --academy         with --garrison also a Military Academy, with --navy also a Portus (training: who is trained)
  --legion <m>      Caesar's legions arrive at the start of month m (the size of a first attack, or
                    --legion-size n), with favor held at 5 so they attack; a Governor's House goes up
                    with the city. Reports the fight: men killed, soldiers lost, buildings lost, the
                    residence, and whether the city was overrun (a mission's loss)
  --json            print a JSON summary at the end
  --pace            print the campaign's pace (the fewest months each goal takes) and exit
  --capacity        print what each mission's buildings can employ (sim/capacity.js) and exit
  --verbose         print game messages as they happen
  --help            this help
`;

function parse(argv) {
  const o = { harbor: 0, scenario: null, type: 'river', size: 64, seed: 'demo', years: 3, level: 2, difficulty: 'normal', json: false, verbose: false, garrison: false, raids: null, pace: false, caretaker: false, capacity: false, unlocks: false, homes: Infinity, fishing: 0, venues: false, hippodrome: false, uptown: false, cloth: false, clothOff: 0, seaRaids: null, navy: false, salary: false, academy: false, legion: 0, legionSize: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--help' || a === '-h') { console.log(HELP); process.exit(0); }
    else if (a === '--scenario') o.scenario = next();
    else if (a === '--type') o.type = next();
    else if (a === '--size') o.size = Number(next());
    else if (a === '--seed') o.seed = next();
    else if (a === '--years') o.years = Number(next());
    else if (a === '--level') o.level = Number(next());
    else if (a === '--difficulty') o.difficulty = next();
    else if (a === '--json') o.json = true;
    else if (a === '--garrison') o.garrison = true;
    else if (a === '--fishing') o.fishing = Number(next());
    else if (a === '--venues') o.venues = true;
    else if (a === '--hippodrome') o.hippodrome = true;
    else if (a === '--uptown') o.uptown = true;
    else if (a === '--cloth') o.cloth = true;
    else if (a === '--cloth-off') o.clothOff = Number(next());
    else if (a === '--harbor') o.harbor = /^\d+$/.test(argv[i + 1] || '') ? Number(next()) : 1;
    else if (a === '--raids') o.raids = next();
    else if (a === '--sea-raids') o.seaRaids = next();
    else if (a === '--navy') o.navy = true;
    else if (a === '--salary') o.salary = true;
    else if (a === '--academy') o.academy = true;
    else if (a === '--legion') o.legion = Number(next());
    else if (a === '--legion-size') o.legionSize = Number(next());
    else if (a === '--verbose') o.verbose = true;
    else if (a === '--pace') o.pace = true;
    else if (a === '--caretaker') o.caretaker = true;
    else if (a === '--capacity') o.capacity = true;
    else if (a === '--unlocks') o.unlocks = true;
    else if (a === '--homes') {
      // A count, or the whole site would be built without a word (NaN caps nothing).
      o.homes = Number(next());
      if (!Number.isFinite(o.homes) || o.homes < 0) { console.error(`--homes needs a number of plots\n${HELP}`); process.exit(2); }
    }
    else { console.error(`Unknown option ${a}\n${HELP}`); process.exit(2); }
  }
  return o;
}

const opts = parse(process.argv.slice(2));
log.setLevel('warn');

// --pace: the campaign's goals against the game's rate limits (sim/pace.js).
if (opts.pace) {
  const f = (m) => (m ? String(Math.round(m)).padStart(4) : '   -');
  console.log(`Fewest months each goal takes (a city always ready, mood ${PACE_MOOD}); the slowest sets the mission's floor.`);
  console.log(' mission  map          pop  cult  pros  peace   floor (years, minutes at 1x)  planned');
  for (const s of SCENARIOS) {
    const m = goalMonths(s.goals);
    console.log(` ${s.id.padEnd(7)}  ${`${s.map.type} ${s.map.size}`.padEnd(11)} ${f(m.population)}  ${f(m.culture)}  ${f(m.prosperity)}  ${f(m.peace)}   ${(m.fastest / 12).toFixed(1).padStart(5)} y  ${String(Math.round(monthsToMinutes(m.fastest))).padStart(4)} min             ${s.paceYears} y`);
  }
  process.exit(0);
}
// --capacity: each mission's population goal against the jobs its buildings
// give and the room its map has (sim/capacity.js).
if (opts.capacity) {
  const pad = (v, n) => String(v).padStart(n);
  console.log(`Employment ceiling: the most people whose jobs keep unemployment at ${CONFIG.UNEMPLOYMENT_MOOD_FREE * 100}% or less, every home at the`);
  console.log('best working level (sim/capacity.js), for a lean and a sensible builder. Land: room to house and feed them.');
  console.log('A population goal must fit the sensible ceiling and the land (tests/campaign.test.mjs; missions 3 to 7 are known exceptions).');
  console.log(' mission  top home            working home      /tile   lean (jobs)   sensible (jobs)     land    goal');
  for (const s of SCENARIOS) {
    const { map } = generateMap({ width: s.map.size, height: s.map.size, seed: s.map.seed, type: s.map.type });
    const m = missionCapacity(s, landOf(map));
    const over = s.goals.population > Math.min(m.sensible.people, m.land) ? '  over' : '';
    console.log(` ${s.id.padEnd(7)}  ${HOUSE_TIERS[m.top].name.padEnd(18)}  ${HOUSE_TIERS[m.working].name.padEnd(16)} ${pad(m.perTile, 5)}  ${pad(m.lean.people, 6)} (${pad(m.lean.jobs, 4)})  ${pad(m.sensible.people, 8)} (${pad(m.sensible.jobs, 4)})  ${pad(m.land, 7)}  ${pad(s.goals.population, 6)}${over}`);
  }
  process.exit(0);
}
if (!DIFFICULTY[opts.difficulty]) { console.error(`Unknown difficulty ${opts.difficulty} (${Object.keys(DIFFICULTY).join(' | ')})`); process.exit(2); }

const scenario = opts.scenario
  ? withDifficulty(SCENARIOS.find((s) => s.id === opts.scenario), opts.difficulty)
  : sandboxScenario({ size: opts.size, type: opts.type, seed: opts.seed, difficulty: opts.difficulty });
if (!scenario) { console.error(`Unknown scenario ${opts.scenario}`); process.exit(2); }
const SIM_MONEY = 20000;
if (opts.seaRaids !== null && !['on', 'off'].includes(opts.seaRaids)) { console.error(`--sea-raids takes on or off
${HELP}`); process.exit(2); }
const game = new Game({ scenario, flags: { unlockall: !opts.unlocks, money: SIM_MONEY, raids: opts.raids, searaids: opts.seaRaids } });
// The governor's salary (sim/governor.js) is his own, not the city's: it goes
// into savings he can give back (donations) or spend on gifts. Unless asked,
// the demo governor draws none and Rome judges none (he is a Citizen, whose
// rate is 0), so the money and favor here are the city's alone and stay
// comparable with runs from before the salary existed. With --salary he
// draws his rank's rate: 20 Dn a month in the sandbox (a Procurator).
if (!opts.salary) Object.assign(game.city.governor, { rank: 0, salaryRank: 0 });
const messages = [];
game.events.on('message', (m) => { messages.push(m); if (opts.verbose) console.log(`   [${m.level}] ${m.text}`); });
let wonMonth = null; // a campaign mission: the month every goal was first met
game.events.on('victory', () => { wonMonth ??= game.time.totalMonths; });

const res = buildDemoCity(game, { level: opts.level, homes: opts.homes });
if (!res.ok) { console.error(`Demo city failed: ${res.reason}`); process.exit(1); }
if (opts.garrison) {
  const gar = buildDemoGarrison(game, res.center, { stock: true, academy: opts.academy });
  console.log(`Garrison: ${gar.forts.length} forts, barracks ${gar.barracks ? 'yes' : 'no'}, ${gar.towers.length} towers, ${gar.wall} wall tiles${opts.academy ? `, academy ${gar.academy ? 'yes' : 'no'}` : ''}`);
}
// --legion: a residence for Caesar's men to go for (built after everything
// else, so a run without the flag is laid out exactly as before).
const residence = opts.legion ? buildDemoResidence(game, res.center) : null;
if (opts.legion) console.log(`Legion: Caesar's legions arrive in month ${opts.legion}; Governor's House ${residence ? `at ${residence.x},${residence.y}` : 'not built'}`);
const fishery = opts.fishing > 0 ? buildDemoFishery(game, res.center, { wharves: opts.fishing }) : null;
if (opts.navy) {
  const nv = buildDemoNavy(game, res.center, { stock: true, portus: opts.academy });
  console.log(`Navy: naval station ${nv.station ? 'yes' : 'no'}, navalia ${nv.navalia ? 'yes' : 'no'}${opts.academy ? `, portus ${nv.portus ? 'yes' : 'no'}` : ''}`);
}
if (fishery) console.log(`Fishery: shipyard ${fishery.shipyard ? 'yes' : 'no'}, ${fishery.wharves.length} wharves, granary ${fishery.granary ? 'yes' : 'no'}; ${game.map.fishingGrounds.length} fishing grounds on the map`);
if (opts.venues) {
  const v = buildDemoVenues(game, res.center);
  console.log(`Venues: ${Object.entries(v).map(([k, b]) => `${k} ${b ? 'yes' : 'no'}`).join(', ')}`);
}
if (opts.hippodrome) {
  const hip = buildDemoHippodrome(game, res.center);
  console.log(`Hippodrome: ${hip.hippodrome ? 'yes' : 'no'}, chariot maker ${hip.maker ? 'yes' : 'no'}`);
}
// --uptown and --cloth: homes that can reach the Insula, and the clothing it needs.
const uptown = opts.uptown ? buildDemoUptown(game, res) : null;
if (uptown) console.log(`Uptown: ${Object.entries(uptown.built).map(([k, v]) => `${k} ${v === true ? 'yes' : v === false ? 'no' : v}`).join(', ')}; markets get ${UPTOWN_GOODS.join(', ')} every month`);
const cloth = opts.cloth ? buildDemoCloth(game, res.center) : null;
if (cloth) console.log(`Cloth: flax farm ${cloth.farm ? 'yes' : 'no'}, linen maker ${cloth.linen ? 'yes' : 'no'}, clothing maker ${cloth.clothing ? 'yes' : 'no'}, warehouse ${cloth.warehouse ? 'yes' : 'no'}${opts.clothOff ? `; demolished after month ${opts.clothOff}` : ''}`);
console.log(`Map ${scenario.map.type} ${scenario.map.size} seed=${game.seed}  difficulty=${game.difficultyKey}  buildings=${game.buildings.size}  farms=${res.farms}  treasury=${Math.round(game.city.treasury)}`);

// --caretaker: a player's minimum. The demo city never rebuilds, so on the
// harder levels a burned Forum or a collapsed reservoir left it without taxes
// or water for good, and the money it needed said more about neglect than
// about the difficulty. Every few days, whatever the demo city built that is
// gone (a home plot included) is cleared and built again, and paid for.
const keep = opts.caretaker ? [...game.buildings.values()].map((b) => ({ type: b.house ? 'house' : b.type, x: b.x, y: b.y, size: b.house ? 1 : b.size })) : [];
let rebuilt = 0;
function caretake() {
  for (const k of keep) {
    let taken = false;
    for (let dy = 0; dy < k.size && !taken; dy++) for (let dx = 0; dx < k.size; dx++) if (game.map.buildingAt(k.x + dx, k.y + dy)) { taken = true; break; }
    if (taken) continue; // standing (a home may have grown into a block), or something else is there
    applyPlan(game, planAction(game, 'clear', k.x, k.y, k.x + k.size - 1, k.y + k.size - 1));
    const off = anchorOffset(k.type); // (a hippodrome is held by the middle of its 15 tiles)
    const plan = planAction(game, k.type, k.x + off.x, k.y + off.y, k.x + off.x, k.y + off.y);
    if (plan && plan.count > 0 && applyPlan(game, plan).ok) rebuilt++;
  }
}
// --harbor: sea trade, measured tick by tick (see the help). Without it the
// run is exactly what it always was.
const harbor = { docks: 0, warehouse: null, from: 0, stays: [], moored: new Map(), exports: 0, imports: 0, summary: null };
const HARBOR_EXPORTS = ['pottery', 'furniture', 'oil'];
function buildHarbor() {
  for (let k = 0; k < opts.harbor; k++) {
    const h = buildDemoHarbor(game, res.center);
    if (!h.ok) break;
    harbor.docks++;
    harbor.warehouse = harbor.warehouse || h.warehouse;
  }
  if (!harbor.docks) { console.log('Harbor: no Dock could be built (no sea access here?)'); return; }
  for (const g of HARBOR_EXPORTS) setTradeMode(game, g, 'export', 0);
  harbor.from = game.time.totalDays;
  const y = game.city.finance.thisYear;
  harbor.exports -= y.exports || 0; // count from now
  harbor.imports -= y.imports || 0;
}
/** Monthly: the harbor's warehouse gets goods to export, room allowing (a stand-in for workshops). */
function harborMonth() {
  const wh = harbor.warehouse;
  if (!wh || !game.buildings.has(wh.id)) return;
  for (const g of HARBOR_EXPORTS) {
    let used = 0;
    for (const k in wh.stock) used += wh.stock[k] + (wh.incoming[k] || 0);
    wh.stock[g] += Math.max(0, Math.min(300, CONFIG.WAREHOUSE_CAPACITY - used));
  }
}
/** Every tick: when each ship tied up and when it cast off. */
function harborTick() {
  for (const w of game.walkers.values()) if (w.type === 'ship' && w.state === 'docked' && !harbor.moored.has(w.id)) harbor.moored.set(w.id, game.time.totalTicks);
  for (const [id, t] of harbor.moored) {
    const w = game.walkers.get(id);
    if (w && w.state === 'docked') continue;
    harbor.stays.push((game.time.totalTicks - t) / CONFIG.TICKS_PER_DAY);
    harbor.moored.delete(id);
  }
}
// --fishing: the days the shipyard stood staffed with no spare and no timber
// for its next boat (sim/fishing.js), counted at each day's end. Running a
// day at a time is the same run: game.runDays only counts ticks.
const yardWait = { days: 0 };
function fisheryDay() {
  const yard = fishery.shipyard; // (none where no water has fish: --type plains)
  if (!yard || !game.buildings.has(yard.id) || yard.efficiency <= 0 || yard.accessRoad < 0) return;
  if (!spareBoat(game, yard) && !hasBoatTimber(yard)) yardWait.days++;
}
function runDays(n) {
  if (!fishery) { runTicksFor(n); return; }
  for (let d = 0; d < n; d++) { runTicksFor(1); fisheryDay(); }
}
function runTicksFor(n) {
  if (!harbor.docks) { game.runDays(n); return; }
  for (let t = 0; t < n * CONFIG.TICKS_PER_DAY; t++) {
    const year = game.time.year;
    game.tick();
    if (game.time.year !== year) { // the ledger rolled over
      harbor.exports += game.city.finance.lastYear.exports || 0;
      harbor.imports += game.city.finance.lastYear.imports || 0;
    }
    harborTick();
  }
}
const runMonth = () => {
  if (harbor.docks) harborMonth();
  if (uptown) uptown.monthly();
  if (!opts.caretaker) { runDays(16); return; }
  for (let k = 0; k < 4; k++) { runDays(4); caretake(); }
};

/** The Insula's level: homes need clothing from here up. */
const INSULA = HOUSE_TIERS.findIndex((t) => t.goods.includes('clothing'));
const clothing = { months: [], peak: 0, offAt: null, peakBefore: 0 };
const pad = (v, n) => String(v).padStart(n);
console.log(' date        pop  work/jobs  unemp  mood  fed%  food(gran/mkt)  treas   tiers');
const t0 = Date.now();
// Money (see the header): what the city would have needed, month by month.
const funds = scenario.funds; // what this difficulty starts a player with
const built = SIM_MONEY - game.city.treasury;
const money = { funds, built, need: built, needMonth: 0, debtMonth: null };
const treasuryByMonth = [];
// --legion: when they came, how long the fight took, and a lost mission.
const legion = { arrived: null, size: 0, soldiersBefore: 0, shipsBefore: 0, overrunMonth: null, endedMonth: null };
game.events.on('defeat', () => { legion.overrunMonth ??= game.time.totalMonths; });
for (let m = 0; m < opts.years * 12; m++) {
  if (opts.legion && m === opts.legion) {
    game.city.ratings.favor = 5;
    legion.soldiersBefore = soldierCount(game);
    const army = launchLegion(game, opts.legionSize || 0);
    legion.arrived = army ? m : null;
    legion.size = army ? army.size : 0;
  }
  if (legion.arrived !== null && legion.endedMonth === null && !game.military.caesar.army) legion.endedMonth = m;
  if (opts.harbor && m === 6) buildHarbor();
  if (cloth && opts.clothOff && m === opts.clothOff) clothOff();
  runMonth();
  if (opts.uptown || opts.cloth) clothMonth(m + 1);
  const c = game.city;
  treasuryByMonth.push(c.treasury);
  const out = SIM_MONEY - c.treasury;
  if (out > money.need) { money.need = Math.round(out); money.needMonth = m + 1; }
  if (money.debtMonth === null && out > funds) money.debtMonth = m + 1;
  let gran = 0;
  let mkt = 0;
  for (const b of game.buildings.values()) {
    if (b.def.kind === 'granary') for (const f of FOOD_TYPES) gran += b.stock[f];
    if (b.def.kind === 'market') for (const f of FOOD_TYPES) mkt += b.stock[f];
  }
  const tiers = c.tierCounts.map((n, i) => (n ? `${i}:${n}` : null)).filter(Boolean).join(' ');
  console.log(`${game.time.shortLabel().padEnd(11)} ${pad(c.population, 5)} ${pad(c.employed, 5)}/${pad(c.jobs, 4)} ${pad(Math.round(c.unemploymentRate * 100), 5)}% ${pad(c.sentiment, 4)} ${pad(Math.round(c.fedShare * 100), 5)} ${pad(Math.round(gran), 7)}/${pad(Math.round(mkt), 5)} ${pad(Math.round(c.treasury), 7)}   ${tiers}`);
}
const c = game.city;
console.log(`\nSimulated ${opts.years} years in ${Date.now() - t0} ms. Fires ${c.stats.fires}, collapses ${c.stats.collapses}, evolutions ${c.stats.evolutions}, devolutions ${c.stats.devolutions}`);
console.log(`Ratings: culture ${Math.floor(c.ratings.culture)} prosperity ${Math.floor(c.ratings.prosperity)} peace ${Math.floor(c.ratings.peace)} favor ${Math.floor(c.ratings.favor)}`);
const ms = game.military.stats;
console.log(`Military: ${game.military.settings ? 'raids on' : 'no raids'}; raids ${ms.raids}, repelled ${ms.repelled}, raiders slain ${ms.enemiesKilled}, buildings lost ${ms.buildingsLost}, plundered ${Math.round((c.finance.thisYear.plunder || 0) + (c.finance.lastYear?.plunder || 0))} Dn (last 2 years), soldiers ${[...game.units.values()].filter((u) => u.side === 'rome' && u.type !== 'liburnian').length}`);
if (ms.seaRaids || opts.navy) console.log(`Sea: raids by sea ${ms.seaRaids || 0}, raider ships sunk ${ms.shipsSunk || 0}, liburnians built ${ms.shipsBuilt || 0}, lost ${ms.shipsLost || 0}, afloat ${[...game.units.values()].filter((u) => u.type === 'liburnian').length}, fishing boats sunk ${ms.boatsSunk || 0}`);
if (opts.legion) {
  const cs = game.military.caesar;
  const res2 = residence ? (game.buildings.has(residence.id) ? 'standing' : 'destroyed') : 'none';
  const left = cs.army ? `${legionCount(game)} of ${cs.army.size} still in the province (${cs.army.retreating ? 'leaving' : cs.army.halted ? 'halted' : 'attacking'})` : `gone by month ${legion.endedMonth ?? '-'}`;
  console.log(`Legion: ${legion.arrived === null ? 'could not get in' : `${legion.size} arrived in month ${legion.arrived} against ${legion.soldiersBefore} soldiers`}; ${left}; attacks ${cs.stats.attacks}, destroyed ${cs.stats.beaten}, marched home ${cs.stats.withdrew}, legionaries slain ${cs.stats.slain}; soldiers lost ${ms.soldiersLost}; buildings lost to them ${cs.stats.buildingsLost || 0}; residence ${res2}; overrun ${legion.overrunMonth === null ? (isOverrun(game) ? 'now (no goals in a sandbox: not a loss)' : 'never') : `in month ${legion.overrunMonth} (mission lost)`}; peak population ${c.stats.peakPopulation}, now ${c.population}`);
}
if (opts.academy) {
  const t = trainedTotals(game);
  console.log(`Training: soldiers trained ${t.soldiersTrained} of ${t.soldiers} (${ms.soldiersTrained || 0} at the academy so far), crews trained ${t.shipsTrained} of ${t.ships} (${ms.crewsTrained || 0} at the Portus so far)`);
}
const cr = c.crime.total;
console.log(`Crime: protesters ${cr.protesters}, thieves ${cr.thieves} (${cr.caught} criminals caught), thefts ${cr.thefts}, stolen ${cr.stolen} Dn and ${cr.looted} goods, riots ${cr.riots}, burned by rioters ${cr.riotBurned}; lowest home mood ${lowestMood(game)}`);
const hs = c.health.total;
const health = { cityHealth: c.health.value, target: c.health.target, outbreaks: hs.outbreaks, spread: hs.spread, deaths: hs.deaths, cured: hs.cured, recovered: hs.recovered, sickHomes: sickHomes(game).length, peakRisk: peakRisk(game) };
console.log(`Health: city health ${health.cityHealth} (homes average ${health.target}); outbreaks ${health.outbreaks} (${health.spread} caught from a neighbor), deaths ${health.deaths}, cured by physicians ${health.cured}, recovered ${health.recovered}; sick homes now ${health.sickHomes}, highest disease risk ${health.peakRisk}`);
const req = c.stats;
console.log(`Emperor: requests met ${req.requestsMet ?? '?'}, failed ${req.requestsFailed ?? '?'}; mood factors ${JSON.stringify(Object.fromEntries(Object.entries(c.sentimentFactors || {}).map(([k, v]) => [k, Math.round(v)])))}`);
const last = treasuryByMonth.length;
money.lastYearMonthly = last >= 12 ? Math.round((treasuryByMonth[last - 1] - treasuryByMonth[last - 13 < 0 ? 0 : last - 13]) / 12) : null;
money.margin = funds - money.need;
money.rebuilt = rebuilt;
console.log(`Money: built ${Math.round(built)} Dn; most out of pocket ${money.need} Dn (month ${money.needMonth}); ${game.difficulty.name} gives ${funds} Dn: margin ${money.margin}${money.debtMonth ? `, in debt from month ${money.debtMonth}` : ''}; last year ${money.lastYearMonthly >= 0 ? '+' : ''}${money.lastYearMonthly} Dn a month${opts.caretaker ? `; ${rebuilt} rebuilt` : ''}`);
if (opts.scenario) {
  const goals = goalStatus(game).map((r) => `${r.key} ${r.have}/${r.need}${r.ok ? '' : ' (short)'}`).join(', ');
  console.log(`Goals${opts.unlocks ? '' : ' (built with every building, not only those of the mission: see --unlocks)'}: ${goals}; ${wonMonth === null ? 'not met' : `all met in month ${wonMonth}`}`);
}
if (harbor.docks) {
  const years = (game.time.totalDays - harbor.from) / (CONFIG.DAYS_PER_MONTH * CONFIG.MONTHS_PER_YEAR);
  const y = game.city.finance.thisYear;
  const n = harbor.stays.length;
  const s = {
    docks: harbor.docks,
    ships: n,
    avgStayDays: n ? +(harbor.stays.reduce((a, b) => a + b, 0) / n).toFixed(1) : 0,
    longestStayDays: n ? +Math.max(...harbor.stays).toFixed(1) : 0,
    exportsPerYear: Math.round((harbor.exports + (y.exports || 0)) / years),
    importsPerYear: Math.round((harbor.imports + (y.imports || 0)) / years),
  };
  harbor.summary = s;
  console.log(`Harbor: ${s.docks} dock${s.docks === 1 ? '' : 's'}, ${s.ships} ships in ${years.toFixed(1)} years, average stay ${s.avgStayDays} days (longest ${s.longestStayDays}); exports ${s.exportsPerYear} Dn a year, imports ${s.importsPerYear} Dn a year`);
}
const bad = messages.filter((m) => m.level === 'bad').map((m) => m.text);
if (bad.length) console.log(`Bad events (${bad.length}):`, [...new Set(bad)].slice(0, 8));
// Fishing: what each wharf landed, against a pig farm's yearly harvest at full
// staff and fertility on this difficulty (the land food fish stands in for).
let fishing = null;
if (fishery) {
  const wharves = [...game.buildings.values()].filter((b) => b.def.kind === 'wharf');
  const catches = wharves.map((b) => (b.catches || 0) * CONFIG.FISH_CATCH);
  const perYear = catches.map((n) => Math.round(n / opts.years));
  const pigYear = Math.round((CONFIG.CART_CAPACITY * CONFIG.DAYS_PER_MONTH * CONFIG.MONTHS_PER_YEAR * game.difficulty.production) / BUILDINGS.farm_pig.productionDays);
  const yard = [...game.buildings.values()].find((b) => b.def.kind === 'shipyard');
  const staff = wharves.map((b) => Math.round(b.efficiency * 100));
  // The timber: read off the yard the demo built, even if it has burned since.
  const built = fishery.shipyard;
  fishing = { wharves: wharves.length, perYear, staff, boatsBuilt: yard ? yard.boatsBuilt || 0 : 0, fishMade: c.produced.fish || 0, pigFarmYear: pigYear, timberUsed: built ? (built.boatsBuilt || 0) * CONFIG.SHIPYARD_BOAT_TIMBER : 0, timberLeft: built ? built.stock.timber : 0, yardWaitDays: yardWait.days };
  console.log(`Fishing: ${wharves.length} wharves (staff ${staff.join('%, ')}%), fish a year per wharf ${perYear.join(', ')} (${BUILDINGS.wharf.workers} workers each); a pig farm at full staff and fertility: ${pigYear} a year (${BUILDINGS.farm_pig.workers} workers); boats built ${fishing.boatsBuilt}${built ? `; timber used ${fishing.timberUsed}, ${fishing.timberLeft} left in the yard (it started with ${DEMO_YARD_TIMBER}); days the yard waited for timber ${yardWait.days}` : ''}`);
}
if (opts.uptown || opts.cloth) {
  const last = clothing.months.at(-1) || { top: 0, wanting: 0, dressed: 0 };
  const made = (g) => c.produced[g] || 0;
  const firstTop = clothing.months.find((r) => r.top > 0);
  console.log(`Clothing: made flax ${made('flax')}, linen ${made('linen')}, clothing ${made('clothing')}; homes at the Insula or above: first in month ${firstTop ? firstTop.month : '-'}, at most ${clothing.peak}, now ${last.top}; Tenements and up with clothing now ${last.dressed} of ${last.wanting}`);
  if (clothing.offAt !== null) {
    const after = clothing.months.filter((r) => r.month > opts.clothOff);
    console.log(`Cloth industry demolished after month ${opts.clothOff}: ${clothing.peakBefore} homes at the Insula or above at most before, ${after.length ? Math.min(...after.map((r) => r.top)) : '-'} at the fewest after (${after.map((r) => r.top).join(' ')})`);
  }
}
const fountains = [...game.buildings.values()].filter((b) => b.type === 'fountain');
const water = { fountains: fountains.length, wet: fountains.filter((b) => b.hasWater).length };
if (opts.json) console.log(JSON.stringify({ ...(harbor.summary ? { harbor: harbor.summary } : {}), population: c.population, treasury: c.treasury, ratings: c.ratings, stats: c.stats, tiers: c.tierCounts, crime: c.crime.total, health, money, water, avgTier: c.avgTier, sentiment: c.sentiment, ...(fishing ? { fishing } : {}), ...(opts.uptown || opts.cloth ? { clothing: { peak: clothing.peak, months: clothing.months, produced: { flax: c.produced.flax || 0, linen: c.produced.linen || 0, clothing: c.produced.clothing || 0 } } } : {}) }));

/**
 * --cloth-off: demolish the cloth industry (and the clothing in store), as a
 * fire or a player might, to see how many homes fall back without it.
 */
function clothOff() {
  for (const b of [cloth.farm, cloth.linen, cloth.clothing]) {
    if (!b) continue;
    // Gone for good: the caretaker (--caretaker) must not build it again.
    for (let k = keep.length - 1; k >= 0; k--) if (keep[k].x === b.x && keep[k].y === b.y && keep[k].type === b.type) keep.splice(k, 1);
    if (game.buildings.has(b.id)) applyPlan(game, planAction(game, 'clear', b.x, b.y, b.x + b.size - 1, b.y + b.size - 1));
  }
  for (const b of game.buildings.values()) if (b.stock && b.stock.clothing && !b.house) b.stock.clothing = 0;
  // And what is on its way: carts' loads and market buyers' baskets.
  for (const w of game.walkers.values()) {
    if (w.cargo && w.cargo.good === 'clothing') w.cargo.amount = 0;
    if (w.load && w.load.clothing) w.load.clothing = 0;
  }
  clothing.offAt = game.time.totalMonths;
  clothing.peakBefore = clothing.peak;
}

/** --uptown / --cloth: homes at the Insula or above, month by month, and the clothing they had. */
function clothMonth(month) {
  let top = 0;
  let wanting = 0;
  let dressed = 0;
  for (const b of game.buildings.values()) {
    const h = b.house;
    if (!h || h.pop <= 0) continue;
    if (h.tier >= INSULA) top++;
    if (h.tier >= INSULA - 1) { wanting++; if (h.goods.clothing > 0.01) dressed++; }
  }
  clothing.months.push({ month, top, wanting, dressed });
  clothing.peak = Math.max(clothing.peak, top);
}

/** The highest disease risk of any occupied home (sim/disease.js). */
function peakRisk(g) {
  let top = 0;
  for (const b of g.buildings.values()) if (b.house && b.house.pop > 0) top = Math.max(top, b.house.diseaseRisk || 0);
  return Math.round(top);
}

/** The unhappiest occupied home's mood (sim/mood.js), or '-' with nobody home. */
function lowestMood(g) {
  let low = null;
  for (const b of g.buildings.values()) {
    const m = b.house && b.house.pop > 0 ? b.house.mood : null;
    if (m !== null && m !== undefined && (low === null || m < low)) low = m;
  }
  return low ?? '-';
}

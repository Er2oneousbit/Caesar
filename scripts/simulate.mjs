#!/usr/bin/env node
/**
 * simulate.mjs - headless balance simulation
 * ----------------------------------------------------------------------------
 * Builds the demo city on a map and fast-forwards, printing one line of city
 * statistics per month. Use it to check balance changes without playing.
 *
 * Usage:
 *   node scripts/simulate.mjs [--scenario c1] [--type river] [--size 64]
 *                             [--seed demo] [--years 3] [--level 2]
 *                             [--difficulty normal] [--json]
 *   npm run sim -- --years 5
 *   npm run sim -- --difficulty insane --raids frequent --garrison
 *
 * Made with ❤️ from your friendly hacker - er2oneousbit
 * ----------------------------------------------------------------------------
 */

import { Game } from '../src/core/game.js';
import { SCENARIOS, sandboxScenario, withDifficulty } from '../src/data/scenarios.js';
import { DIFFICULTY } from '../src/data/difficulty.js';
import { buildDemoCity, buildDemoGarrison } from '../src/dev/demoCity.js';
import { log } from '../src/core/debug.js';
import { FOOD_TYPES } from '../src/data/goods.js';

const HELP = `
Headless balance simulation

  node scripts/simulate.mjs [options]

Options:
  --scenario <id>   campaign scenario id (c1..c7) instead of a sandbox map
  --type <t>        sandbox landscape: river | coast | lakes | plains | desert (default river)
  --size <n>        sandbox map size (default 64; Uber is 256)
  --difficulty <d>  easy | normal | hard | insane (default normal)
  --seed <s>        map seed (default "demo")
  --years <n>       years to simulate (default 3)
  --level <1-3>     demo city complexity (default 2)
  --garrison        also build a barracks, forts, towers and a wall (equipped)
  --raids <mode>    off | occasional | frequent (overrides the scenario)
  --json            print a JSON summary at the end
  --verbose         print game messages as they happen
  --help            this help
`;

function parse(argv) {
  const o = { scenario: null, type: 'river', size: 64, seed: 'demo', years: 3, level: 2, difficulty: 'normal', json: false, verbose: false, garrison: false, raids: null };
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
    else if (a === '--raids') o.raids = next();
    else if (a === '--verbose') o.verbose = true;
    else { console.error(`Unknown option ${a}\n${HELP}`); process.exit(2); }
  }
  return o;
}

const opts = parse(process.argv.slice(2));
log.setLevel('warn');
if (!DIFFICULTY[opts.difficulty]) { console.error(`Unknown difficulty ${opts.difficulty} (${Object.keys(DIFFICULTY).join(' | ')})`); process.exit(2); }

const scenario = opts.scenario
  ? withDifficulty(SCENARIOS.find((s) => s.id === opts.scenario), opts.difficulty)
  : sandboxScenario({ size: opts.size, type: opts.type, seed: opts.seed, difficulty: opts.difficulty });
if (!scenario) { console.error(`Unknown scenario ${opts.scenario}`); process.exit(2); }
const game = new Game({ scenario, flags: { unlockall: true, money: 20000, raids: opts.raids } });
const messages = [];
game.events.on('message', (m) => { messages.push(m); if (opts.verbose) console.log(`   [${m.level}] ${m.text}`); });

const res = buildDemoCity(game, { level: opts.level });
if (!res.ok) { console.error(`Demo city failed: ${res.reason}`); process.exit(1); }
if (opts.garrison) {
  const gar = buildDemoGarrison(game, res.center, { stock: true });
  console.log(`Garrison: ${gar.forts.length} forts, barracks ${gar.barracks ? 'yes' : 'no'}, ${gar.towers.length} towers, ${gar.wall} wall tiles`);
}
console.log(`Map ${scenario.map.type} ${scenario.map.size} seed=${game.seed}  difficulty=${game.difficultyKey}  buildings=${game.buildings.size}  farms=${res.farms}  treasury=${Math.round(game.city.treasury)}`);

const pad = (v, n) => String(v).padStart(n);
console.log(' date        pop  work/jobs  unemp  mood  fed%  food(gran/mkt)  treas   tiers');
const t0 = Date.now();
for (let m = 0; m < opts.years * 12; m++) {
  game.runDays(16);
  const c = game.city;
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
console.log(`Military: ${game.military.settings ? 'raids on' : 'no raids'}; raids ${ms.raids}, repelled ${ms.repelled}, raiders slain ${ms.enemiesKilled}, buildings lost ${ms.buildingsLost}, plundered ${Math.round((c.finance.thisYear.plunder || 0) + (c.finance.lastYear?.plunder || 0))} Dn (last 2 years), soldiers ${[...game.units.values()].filter((u) => u.side === 'rome').length}`);
const req = c.stats;
console.log(`Emperor: requests met ${req.requestsMet ?? '?'}, failed ${req.requestsFailed ?? '?'}; mood factors ${JSON.stringify(Object.fromEntries(Object.entries(c.sentimentFactors || {}).map(([k, v]) => [k, Math.round(v)])))}`);
const bad = messages.filter((m) => m.level === 'bad').map((m) => m.text);
if (bad.length) console.log(`Bad events (${bad.length}):`, [...new Set(bad)].slice(0, 8));
if (opts.json) console.log(JSON.stringify({ population: c.population, treasury: c.treasury, ratings: c.ratings, stats: c.stats, tiers: c.tierCounts }));

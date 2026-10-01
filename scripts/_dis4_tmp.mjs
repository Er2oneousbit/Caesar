import fs from 'node:fs';
import { deserializeGame } from '../src/core/save.js';
import { CONFIG } from '../src/config.js';
import { log } from '../src/core/debug.js';
log.setLevel('error');
const raw = fs.readFileSync(process.argv[2], 'utf8');
for (const [rate, heat, spread] of [[0.31, 1, 0.005], [0.31, 0.3, 0.003], [0.2, 0.3, 0.003], [0.15, 0.3, 0.003], [0.15, 0.15, 0.0015]]) {
  let tot = 0, deaths = 0, pop = 0;
  for (const seed of [0, 1, 2]) {
    CONFIG.DISEASE_RATE = rate; CONFIG.DISEASE_HEAT = heat; CONFIG.DISEASE_SPREAD_CHANCE = spread;
    const g = deserializeGame(JSON.parse(raw));
    for (let k = 0; k < seed; k++) g.rng.next();
    g.runDays(192);
    const o0 = g.city.health.total.outbreaks, d0 = g.city.health.total.deaths;
    g.runDays(192);
    tot += g.city.health.total.outbreaks - o0; deaths += g.city.health.total.deaths - d0; pop += g.city.population;
  }
  console.log(`rate ${rate} heat ${heat} spread ${spread}: year-2 outbreaks ${(tot / 3).toFixed(1)}, deaths ${(deaths / 3).toFixed(0)}, pop ${(pop / 3).toFixed(0)}`);
}

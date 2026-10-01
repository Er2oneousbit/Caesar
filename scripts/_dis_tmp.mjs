import fs from 'node:fs';
import { deserializeGame } from '../src/core/save.js';
import { houseHealth, dailyRisk } from '../src/sim/disease.js';
import { log } from '../src/core/debug.js';
log.setLevel('error');
const g = deserializeGame(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
console.log('gods', JSON.stringify(Object.fromEntries(Object.entries(g.city.gods).map(([k, v]) => [k, { mood: Math.round(v.mood), angered: v.angered, temples: v.temples }]))));
console.log('venusBoost', g.city.venusBoost, 'difficulty disease', g.difficulty.disease);
const homes = [...g.buildings.values()].filter((b) => b.house && b.house.pop > 0);
for (const b of homes.slice(0, 12)) {
  const s = houseHealth(g, b);
  console.log(`home tier ${b.house.tier} pop ${b.house.pop} size ${b.size} score ${s} risk ${Math.round(b.house.diseaseRisk)} perDay ${dailyRisk(s, b.house.pop, g.difficulty.disease).toFixed(3)} sick ${b.house.sick} clinic ${b.house.clinic}`);
}
const before = new Map(homes.map((b) => [b.id, b.house.diseaseRisk]));
g.runDays(16);
console.log('after 16 days:');
for (const b of homes.slice(0, 12)) if (g.buildings.has(b.id)) console.log(`  risk ${Math.round(before.get(b.id))} -> ${Math.round(b.house.diseaseRisk)} (+${((b.house.diseaseRisk - before.get(b.id)) / 16).toFixed(2)}/day) sick ${b.house.sick}`);

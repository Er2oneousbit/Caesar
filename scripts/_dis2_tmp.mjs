import fs from 'node:fs';
import { deserializeGame } from '../src/core/save.js';
import { log } from '../src/core/debug.js';
import { CONFIG } from '../src/config.js';
log.setLevel('error');
const g = deserializeGame(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
const b = [...g.buildings.values()].find((x) => x.house && x.house.pop === 7 && x.house.diseaseRisk > 30 && x.house.diseaseRisk < 40);
let last = b.house.diseaseRisk;
const log2 = [];
for (let t = 0; t < CONFIG.TICKS_PER_DAY * 6; t++) {
  g.tick();
  if (b.house.diseaseRisk !== last) { log2.push(`tick ${t}: ${last.toFixed(2)} -> ${b.house.diseaseRisk.toFixed(2)}`); last = b.house.diseaseRisk; }
}
console.log(log2.join('\n'));
console.log('TICKS_PER_DAY', CONFIG.TICKS_PER_DAY);

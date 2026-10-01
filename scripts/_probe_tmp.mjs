import { Game } from '../src/core/game.js';
import { sandboxScenario } from '../src/data/scenarios.js';
import { buildDemoCity } from '../src/dev/demoCity.js';
import { log } from '../src/core/debug.js';
log.setLevel('error');
let bad = 0, total = 0; const ex = [];
for (const type of ['river', 'lakes', 'coast']) for (let n = 0; n < 40; n++) {
  const g = new Game({ scenario: sandboxScenario({ size: 96, type, seed: `menu-${n}` }), flags: { unlockall: true, money: 100000 } });
  g.log = { ...log, info() {}, debug() {} };
  buildDemoCity(g, { level: 2 });
  g.runDays(16 * 5);
  const lack = [...g.buildings.values()].filter((b) => (b.def.needsRoad && b.def.workers && b.accessRoad < 0) || (b.house && b.house.pop >= 0 && b.accessRoad < 0));
  total++;
  if (lack.length) { bad++; if (ex.length < 6) ex.push(`${type} menu-${n}: ${lack.length} [${[...new Set(lack.map((b) => b.type))].join(',')}]`); }
}
console.log(`${bad}/${total} menu towns have buildings with no road`); console.log(ex.join('\n'));

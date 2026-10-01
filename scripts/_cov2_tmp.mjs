import fs from 'node:fs';
import { deserializeGame } from '../src/core/save.js';
import { riskRates } from '../src/sim/risk.js';
import { log } from '../src/core/debug.js';
log.setLevel('error');
const g = deserializeGame(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
const days = 192;
const t = new Map();
const label = (b) => (b.house ? `home${b.house.tier}` : b.type);
for (let d = 0; d < days; d++) {
  const before = new Map([...g.buildings.values()].map((b) => [b.id, [b.fireRisk, b.damageRisk]]));
  g.runDays(1);
  for (const b of g.buildings.values()) {
    const r = riskRates(b);
    let s = t.get(b.id);
    if (!s) { s = { type: label(b), x: b.x, y: b.y, size: b.size, f: r.fire > 0, dm: r.damage > 0, lf: d, ld: d, gf: 0, gd: 0, maxF: 0, maxD: 0 }; t.set(b.id, s); }
    const p = before.get(b.id) || [0, 0];
    if (b.fireRisk < p[0] - 0.01) s.lf = d;
    if (b.damageRisk < p[1] - 0.01) s.ld = d;
    s.gf = Math.max(s.gf, d - s.lf); s.gd = Math.max(s.gd, d - s.ld);
    s.maxF = Math.max(s.maxF, b.fireRisk); s.maxD = Math.max(s.maxD, b.damageRisk);
  }
}
const rows = [...t.values()];
const sum = (arr, k) => { const v = arr.map((r) => r[k]).sort((a, b) => a - b); return v.length ? `n ${v.length}, median ${v[v.length >> 1]}, 90% ${v[Math.floor(v.length * 0.9)]}, max ${v[v.length - 1]}` : 'none'; };
console.log('prefect gap days (burnable):', sum(rows.filter((r) => r.f), 'gf'));
console.log('engineer gap days (can collapse):', sum(rows.filter((r) => r.dm), 'gd'));
console.log('never reached by engineers in 192 days:', rows.filter((r) => r.dm && r.gd >= days - 2).map((r) => `${r.type}@${r.x},${r.y}`).join(', '));
console.log('never reached by prefects:', rows.filter((r) => r.f && r.gf >= days - 2).map((r) => `${r.type}@${r.x},${r.y}`).join(', '));
console.log('posts:', [...g.buildings.values()].filter((b) => ['engineer_post', 'prefecture', 'clinic'].includes(b.type)).map((b) => `${b.type}@${b.x},${b.y} eff ${b.efficiency.toFixed(2)} road ${b.accessRoad >= 0}`).join(' | '));
console.log(`fires ${g.city.stats.fires} collapses ${g.city.stats.collapses}`);

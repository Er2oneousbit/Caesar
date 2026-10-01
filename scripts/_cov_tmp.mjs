import fs from 'node:fs';
import { deserializeGame } from '../src/core/save.js';
import { log } from '../src/core/debug.js';
log.setLevel('error');
const g = deserializeGame(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
const days = Number(process.argv[3] || 192);
const track = new Map(); // id -> {type, fireGap, dmgGap, disGap, lastF, lastD, lastS}
const label = (b) => (b.house ? `home${b.house.tier}` : b.type);
let day = 0;
const prev = new Map();
for (; day < days; day++) {
  g.runDays(1);
  for (const b of g.buildings.values()) {
    let t = track.get(b.id);
    if (!t) { t = { type: label(b), x: b.x, y: b.y, lastF: day, lastD: day, lastS: day, fGap: 0, dGap: 0, sGap: 0, eff: [] }; track.set(b.id, t); }
    const p = prev.get(b.id) || { f: 0, d: 0, s: 0 };
    if (b.fireRisk < p.f - 0.01) t.lastF = day;
    if (b.damageRisk < p.d - 0.01) t.lastD = day;
    const s = b.house ? b.house.diseaseRisk || 0 : 0;
    if (s < p.s - 0.01) t.lastS = day;
    t.fGap = Math.max(t.fGap, day - t.lastF); t.dGap = Math.max(t.dGap, day - t.lastD); t.sGap = Math.max(t.sGap, day - t.lastS);
    if (b.def.workers) t.eff.push(b.efficiency);
    prev.set(b.id, { f: b.fireRisk, d: b.damageRisk, s });
  }
}
const c = g.city;
console.log(`after ${days} days: ${g.time.label()} pop ${c.population}, fires ${c.stats.fires}, collapses ${c.stats.collapses}, outbreaks total ${c.health.total.outbreaks}`);
const rows = [...track.values()];
const gap = (k) => { const v = rows.map((r) => r[k]).sort((a, b) => a - b); return `median ${v[v.length >> 1]}, 90% ${v[Math.floor(v.length * 0.9)]}, max ${v[v.length - 1]}`; };
console.log('longest gap between prefect visits (days):', gap('fGap'));
console.log('longest gap between engineer visits (days):', gap('dGap'));
console.log('worst unserved:', rows.sort((a, b) => b.dGap - a.dGap).slice(0, 10).map((r) => `${r.type}@${r.x},${r.y} eng ${r.dGap} pref ${r.fGap}`).join(' | '));
const eff = {}; for (const r of rows) if (r.eff.length) { const k = r.type; (eff[k] ||= []).push(r.eff.reduce((a, b) => a + b, 0) / r.eff.length); }
console.log('staffing:', Object.entries(eff).map(([k, v]) => `${k} ${Math.round(100 * v.reduce((a, b) => a + b, 0) / v.length)}%`).join(', '));
const ws = {}; for (const w of g.walkers.values()) ws[w.type] = (ws[w.type] || 0) + 1; console.log('walkers now', JSON.stringify(ws));
console.log(g.messages.slice(0, 25).map((m) => `${m.date || ''} ${m.text}`).join('\n'));

import fs from 'node:fs';
import { deserializeGame } from '../src/core/save.js';
import { log } from '../src/core/debug.js';
log.setLevel('error');
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log('save version', raw.version, 'meta', JSON.stringify(raw.meta));
console.log('scenario', JSON.stringify({ size: raw.scenario?.map, military: raw.scenario?.military, invasions: raw.scenario?.invasions, difficulty: raw.difficulty, funds: raw.scenario?.funds }));
const g = deserializeGame(raw);
const c = g.city;
console.log('date', g.time.label(), 'months', g.time.totalMonths, 'pop', c.population, 'treasury', Math.round(c.treasury), 'mood', c.sentiment, 'unemp', Math.round(c.unemploymentRate*100)+'%', 'workforce', c.workforce, 'jobs', c.jobs);
console.log('stats', JSON.stringify(c.stats));
console.log('health', JSON.stringify(c.health));
console.log('request', JSON.stringify(c.request), 'nextRequestMonth', c.nextRequestMonth);
console.log('military next raid', g.military?.nextRaidMonth, 'raids', JSON.stringify(g.military?.stats || {}).slice(0, 200));
const kinds = {}; for (const b of g.buildings.values()) { const k = b.house ? 'house:'+b.house.tier : b.type; kinds[k] = (kinds[k]||0)+1; }
console.log('buildings', JSON.stringify(kinds));
console.log('labor', JSON.stringify(c.laborByCat), 'priority', JSON.stringify(c.laborPriority));
const msgs = (g.messages || []).map((m) => `${m.date || ''} ${m.text}`);
console.log('messages', msgs.length); console.log(msgs.slice(-60).join('\n'));

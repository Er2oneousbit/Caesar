/**
 * console.js
 * ----------------------------------------------------------------------------
 * In-game debug console (toggle with the backtick key). Meant for testers and
 * developers: give money, fast-forward, spawn disasters, inspect state.
 * No eval: only the commands listed in COMMANDS exist.
 * ----------------------------------------------------------------------------
 */

import { h } from './dom.js';
import { CONFIG } from '../config.js';
import { GOODS } from '../data/goods.js';
import { buildDemoCity, buildDemoGarrison, buildDemoHarbor } from '../dev/demoCity.js';
import { igniteBuilding, collapseBuilding } from '../sim/risk.js';
import { isStorage, storageCapacity, storageUsed } from '../sim/storage.js';
import { launchInvasion, threatSummary, garrisonCounts, enemyCount } from '../sim/military.js';
import { UNIT_TYPES, FORT_CAPACITY } from '../data/units.js';
import { log } from '../core/debug.js';

export const CONSOLE_HELP = [
  ['help', 'List commands'],
  ['money <n>', 'Add n denarii (negative to remove)'],
  ['freebuild on|off', 'Construction costs nothing'],
  ['speed <0-4>', 'Set game speed'],
  ['days <n>', 'Fast-forward n days instantly'],
  ['demo [1-3]', 'Build the demo city layout'],
  ['give <good> <n>', 'Put goods into your warehouses/granaries'],
  ['fire', 'Set a random building on fire'],
  ['collapse', 'Collapse a random building'],
  ['favor <n>', 'Set the Emperor\'s favor (0-100)'],
  ['mood <n>', 'Set city sentiment (0-100)'],
  ['garrison', 'Build a barracks, three forts, towers, a ranch and a wall (equipped)'],
  ['harbor', 'Build a dock + warehouse and open every sea route (river/coast maps)'],
  ['invade [n]', 'Launch a raid of n warriors right now (default: normal size)'],
  ['army', 'List forts, soldiers, barracks stock and the raid schedule'],
  ['win', 'Trigger victory'],
  ['stats', 'Print city statistics'],
  ['goto <x> <y>', 'Center the view on a tile'],
  ['loglevel <lvl>', 'error | warn | info | debug'],
  ['clear', 'Clear the console'],
];

export class DebugConsole {
  constructor(app, root) {
    this.app = app;
    this.out = h('div', { class: 'out' });
    this.input = h('input', { id: 'console-input', type: 'text', placeholder: 'Type a command (help)', autocomplete: 'off', spellcheck: 'false', onkeydown: (e) => this.onKey(e) });
    this.el = h('div', { id: 'console', class: 'hidden' }, this.out, this.input);
    this.history = [];
    this.hIndex = 0;
    root.appendChild(this.el);
    this.print('Colonia debug console. Type "help".');
  }

  get open() { return !this.el.classList.contains('hidden'); }

  toggle() {
    this.el.classList.toggle('hidden');
    if (this.open) setTimeout(() => this.input.focus(), 0);
    else this.input.blur();
  }

  print(text, cls = '') {
    this.out.appendChild(h('div', { class: cls }, text));
    this.out.scrollTop = this.out.scrollHeight;
  }

  onKey(e) {
    if (e.key === 'Enter') {
      const cmd = this.input.value.trim();
      this.input.value = '';
      if (!cmd) return;
      this.history.push(cmd);
      this.hIndex = this.history.length;
      this.print(`> ${cmd}`);
      try {
        const res = this.run(cmd);
        if (res) this.print(res);
      } catch (err) {
        this.print(`Error: ${err.message}`);
        log.error('Console command failed:', err);
      }
    } else if (e.key === 'ArrowUp') {
      this.hIndex = Math.max(0, this.hIndex - 1);
      this.input.value = this.history[this.hIndex] || '';
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      this.hIndex = Math.min(this.history.length, this.hIndex + 1);
      this.input.value = this.history[this.hIndex] || '';
      e.preventDefault();
    }
  }

  /** Execute one command line. Returns text to print. */
  run(line) {
    const [cmd, ...args] = line.split(/\s+/);
    const app = this.app;
    const g = app.game;
    const need = () => { if (!g) throw new Error('No game running'); };
    switch (cmd.toLowerCase()) {
      case 'help':
        return CONSOLE_HELP.map(([k, v]) => `${k.padEnd(18)} ${v}`).join('\n');
      case 'clear':
        this.out.replaceChildren();
        return '';
      case 'money': {
        need();
        const n = Number(args[0]);
        if (!Number.isFinite(n)) throw new Error('usage: money <n>');
        g.city.treasury += n;
        return `Treasury: ${Math.round(g.city.treasury)} Dn`;
      }
      case 'freebuild':
        need();
        g.cheats.freeBuild = args[0] !== 'off';
        return `Free build ${g.cheats.freeBuild ? 'ON' : 'OFF'}`;
      case 'speed': {
        const n = Number(args[0]);
        if (!(n >= 0 && n < CONFIG.SPEEDS.length)) throw new Error('usage: speed <0-4>');
        if (n === 0) app.paused = true;
        else app.setSpeed(n);
        return `Speed ${n}`;
      }
      case 'days': {
        need();
        const n = Math.min(3650, Math.max(1, Number(args[0]) || 16));
        const t0 = performance.now();
        g.runDays(n);
        return `Ran ${n} days in ${Math.round(performance.now() - t0)} ms. Date: ${g.time.label()}`;
      }
      case 'demo': {
        need();
        const res = buildDemoCity(g, { level: Number(args[0]) || 2 });
        if (res.center) app.renderer.camera.centerOnTile(res.center.x, res.center.y);
        return res.ok ? `Demo city built (${res.farms} farms).` : `Demo failed: ${res.reason}`;
      }
      case 'give': {
        need();
        const good = args[0];
        const n = Number(args[1]) || 400;
        if (!GOODS[good]) throw new Error(`unknown good. Options: ${Object.keys(GOODS).join(', ')}`);
        let left = n;
        for (const b of g.buildings.values()) {
          if (left <= 0) break;
          if (!isStorage(b) || b.stock[good] === undefined) continue;
          const room = storageCapacity(b) - storageUsed(b);
          const put = Math.min(room, left);
          b.stock[good] += put;
          left -= put;
        }
        return left > 0 ? `Stored ${n - left}; no room for ${left} (build a granary/warehouse).` : `Stored ${n} ${good}.`;
      }
      case 'fire':
      case 'collapse': {
        need();
        const list = [...g.buildings.values()];
        if (!list.length) return 'Nothing to destroy.';
        const b = list[g.rng.int(list.length)];
        if (cmd === 'fire') igniteBuilding(g, b);
        else collapseBuilding(g, b);
        app.renderer.camera.centerOnTile(b.x, b.y);
        return `${cmd} at ${b.x},${b.y}`;
      }
      case 'favor':
        need();
        g.city.ratings.favor = Math.max(0, Math.min(100, Number(args[0]) || 50));
        return `Favor ${g.city.ratings.favor}`;
      case 'mood':
        need();
        g.city.sentiment = Math.max(0, Math.min(100, Number(args[0]) || 50));
        return `Sentiment ${g.city.sentiment}`;
      case 'garrison':
      case 'harbor': {
        need();
        const center = cityCenter(g);
        if (!center) return 'Build some homes first (try: demo 2).';
        if (cmd === 'garrison') {
          const res = buildDemoGarrison(g, center, { stock: true });
          if (res.barracks) app.renderer.camera.centerOnTile(res.barracks.x, res.barracks.y);
          return res.ok ? `Garrison built: ${res.forts.length} forts, ${res.towers.length} towers, ${res.wall} wall tiles. Recruits arrive over the next weeks.` : 'Could not find room for a barracks and forts near the city.';
        }
        const res = buildDemoHarbor(g, center);
        if (res.dock) app.renderer.camera.centerOnTile(res.dock.x, res.dock.y);
        return res.ok ? `Harbor built; sea routes opened: ${res.routes.join(', ') || 'none in this scenario'}.` : 'No navigable shore near the city (try a river or coast map).';
      }
      case 'invade': {
        need();
        if (g.military.active) return 'A raid is already under way.';
        const n = args[0] ? Math.max(1, Math.min(60, Number(args[0]) || 0)) : 0;
        const inv = launchInvasion(g, null, n || undefined);
        app.renderer.camera.centerOnTile(inv.origin.x, inv.origin.y);
        return `Raid of ${inv.size} launched from ${inv.origin.x},${inv.origin.y}.`;
      }
      case 'army': {
        need();
        const m = g.military;
        const counts = garrisonCounts(g);
        const lines = [];
        for (const b of g.buildings.values()) {
          if (b.def.kind === 'fort') {
            lines.push(`${b.def.name} #${b.id} at ${b.x},${b.y}: ${counts.get(b.id) || 0}/${FORT_CAPACITY} ${UNIT_TYPES[b.def.unit].name.toLowerCase()}s, ${b.recruiting || 0} on the way, staff ${Math.round(b.efficiency * 100)}%${b.rally ? `, deployed to ${Math.floor(b.rally.x)},${Math.floor(b.rally.y)}` : ''}`);
          } else if (b.def.kind === 'barracks') {
            lines.push(`Barracks #${b.id}: ${Object.entries(b.stock).map(([k, v]) => `${k} ${v}`).join(', ')}, training ${Math.round(b.trainProgress || 0)}%${b.blocked ? ` (${b.blocked})` : ''}`);
          }
        }
        if (!lines.length) lines.push('No forts or barracks.');
        lines.push(`Raiders on the map: ${enemyCount(g)}. ${threatSummary(g).text}`);
        lines.push(m.settings ? `Next raid: month ${m.nextRaidMonth} (now ${g.time.totalMonths}).` : 'Raids are off in this game.');
        lines.push(`Record: ${m.stats.raids} raids, ${m.stats.repelled} repelled, ${m.stats.enemiesKilled} raiders slain, ${m.stats.soldiersLost} soldiers lost, ${m.stats.trained} trained.`);
        return lines.join('\n');
      }
      case 'win':
        need();
        g.city.victory = true;
        g.events.emit('victory', { scenario: g.scenario.id });
        return 'Victory triggered.';
      case 'stats': {
        need();
        const c = g.city;
        return [
          `Date ${g.time.label()}  pop ${c.population}  treasury ${Math.round(c.treasury)}`,
          `workforce ${c.workforce} jobs ${c.jobs} employed ${c.employed} unemployment ${(c.unemploymentRate * 100).toFixed(1)}%`,
          `sentiment ${c.sentiment} fed ${(c.fedShare * 100).toFixed(0)}% buildings ${g.buildings.size} walkers ${g.walkers.size}`,
          `ratings C${Math.floor(c.ratings.culture)} P${Math.floor(c.ratings.prosperity)} Pe${Math.floor(c.ratings.peace)} F${Math.floor(c.ratings.favor)}`,
          `tiers ${c.tierCounts.join(',')}`,
        ].join('\n');
      }
      case 'goto': {
        need();
        const x = Number(args[0]);
        const y = Number(args[1]);
        if (!g.map.inBounds(x, y)) throw new Error('usage: goto <x> <y> (inside the map)');
        app.renderer.camera.centerOnTile(x, y);
        return `Centered on ${x},${y}`;
      }
      case 'loglevel':
        log.setLevel(args[0]);
        return `Log level ${args[0]}`;
      default:
        throw new Error(`Unknown command "${cmd}". Type help.`);
    }
  }
}

/** Average position of the city's homes (where demo extras get built). */
function cityCenter(g) {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (const b of g.buildings.values()) if (b.house) { sx += b.x; sy += b.y; n++; }
  return n ? { x: Math.round(sx / n), y: Math.round(sy / n) } : null;
}

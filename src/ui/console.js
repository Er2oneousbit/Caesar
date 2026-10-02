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
import { BUILDINGS } from '../data/buildings.js';
import { buildDemoCity, buildDemoGarrison, buildDemoHarbor, buildDemoFishery, buildDemoHippodrome, buildDemoCloth, buildDemoNavy, buildDemoAcademy, buildDemoPortus, DEMO_YARD_TIMBER } from '../dev/demoCity.js';
import { wharfBoat, boatStatus } from '../sim/fishing.js';
import { igniteBuilding, collapseBuilding } from '../sim/risk.js';
import { isStorage, storageCapacity, storageUsed, isStable, stableRoom } from '../sim/storage.js';
import { launchInvasion, threatSummary, garrisonCounts, enemyCount } from '../sim/military.js';
import { squadronCounts, shipStatus } from '../sim/navy.js';
import { startMarch, launchLegion, legionCount, siegeOrder } from '../sim/legion.js';
import { requestTroops, fightBattle, archesToBuild } from '../sim/battle.js';
import { THREATENED_CITIES } from '../data/battles.js';
import { commitCrime, crimeChance, criminalsAbout, unhappiestHomes, crimeEnabled } from '../sim/crime.js';
import { outbreak, sickHomes, riskiestHomes, diseaseEnabled } from '../sim/disease.js';
import { applyEvent, eventCondition, startQuake, newEmperor, quakeSummary, tradeHaltText } from '../sim/events.js';
import { QUAKE_SIZES } from '../data/events.js';
import { UNIT_TYPES, FORT_CAPACITY, STATION_CAPACITY } from '../data/units.js';
import { WEATHER, SEASON_NAMES, seasonalKind, SNOW_LEVELS } from '../render/weather.js';
import { dayTime } from '../render/lighting.js';
import { MOODS, TRACKS } from '../audio/composer.js';
import { log } from '../core/debug.js';

export const CONSOLE_HELP = [
  ['help', 'List commands'],
  ['money <n>', 'Add n denarii (negative to remove)'],
  ['savings <n>', 'Add n denarii to the governor\'s personal savings (negative to remove)'],
  ['freebuild on|off', 'Construction costs nothing'],
  ['speed <0-4>', 'Set game speed'],
  ['days <n>', 'Fast-forward n days instantly'],
  ['demo [1-3]', 'Build the demo city layout'],
  ['give <good> <n>', 'Put goods into your warehouses/granaries'],
  ['fire', 'Set a random building on fire'],
  ['collapse', 'Collapse a random building'],
  ['favor <n>', 'Set the Emperor\'s favor (0-100)'],
  ['mood <n>', 'Set city sentiment (0-100)'],
  ['crime', 'Crime report: the year so far, criminals about, the unhappiest homes'],
  ['crime <kind>', 'The home under the cursor (or the unhappiest) sends out a protester, a thief or a riot now'],
  ['riot', 'Same as crime riot'],
  ['unrest <n>', 'Set the mood of every home (0-100); they drift back toward their targets'],
  ['health', 'Health report: city health, outbreaks this year, sick homes, the homes closest to an outbreak'],
  ['sick [id | x y]', 'The home under the cursor (or #id, or at x,y; else the one at most risk) falls sick now'],
  ['event', 'Events report: Rome\'s wage, trade stopped, an earthquake shaking, the events so far'],
  ['event <kind>', 'An event now: wageup | wagedown | land | sea | water | mine | clay | quake [small|medium|large] | emperor'],
  ['garrison', 'Build a barracks, three forts, towers, a ranch and a wall (equipped, and military labor goes first)'],
  ['harbor', 'Build a dock + warehouse and open every sea route (river/coast maps)'],
  ['fishing', 'Build a shipyard (stocked with timber), two fishing wharves and a granary on the nearest water with fish'],
  ['grounds', 'List the fishing grounds, and every wharf and its boat'],
  ['hippodrome', 'Build a Circus (hippodrome) and a Factio (chariot stable) beside the city'],
  ['cloth', 'Build the cloth industry beside the city: a Linarium, a Textrinum, a Taberna Vestiaria and a Horreum'],
  ['navy', 'Build a naval station and a navalia on the shore, stocked for a squadron of liburnians (river/coast maps)'],
  ['academy', 'Build a Campus (military academy) near the city, and a Portus by the first Statio if there is one (they train only at full staff)'],
  ['invade [n]', 'Launch a raid of n warriors right now (default: normal size)'],
  ['searaid [n]', 'Launch a raid of n warriors by sea right now (river/coast maps; default: normal size)'],
  ['legion', 'Caesar\'s legions set out from Rome now (they arrive in 12 months)'],
  ['legion now [n]', 'Caesar\'s legions (n men; default: the next attack\'s size) arrive at the map entrance now'],
  ['battle [city] [n]', `Caesar calls for troops now: city ${Object.keys(THREATENED_CITIES).join(' | ')}, enemy strength n`],
  ['battle now', 'Fight the pending distant battle now'],
  ['arch', 'Grant a triumphal arch to build, as for a distant battle won'],
  ['army', 'List forts, naval stations, soldiers, ships, barracks and navalia stock and the raid schedule'],
  ['win', 'Trigger victory'],
  ['stats', 'Print city statistics'],
  ['goto <x> <y>', 'Center the view on a tile'],
  ['weather <kind>', 'Change the weather now: clear | cloudy | rain | storm | snow'],
  ['snow <0-3>', 'Set the snow lying on the ground (0 none .. 3 deep); it melts again by itself'],
  ['sky <0-1>|off', 'Freeze the time of day (0.3 noon, 0.67 sunset, 0.8 night) or let it run'],
  ['music [on|off|next]', 'Music status, switch it, or skip to a new piece'],
  ['music tracks', 'List the music tracks (and the moods they play in)'],
  ['music play <track>', 'Play a track now, by name (e.g. music play prima lux)'],
  ['music mood <m>|auto', 'Force a mood: menu, day, night, danger, festival (auto = follow the game)'],
  ['music wav [mood] [s]', 'Render music offline and download it as a WAV file (default: day, 60 s)'],
  ['music check', 'Render every mood offline and print its loudness (finds silent or clipping music)'],
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
      case 'savings': {
        need();
        const n = Number(args[0]);
        if (!Number.isFinite(n)) throw new Error('usage: savings <n>');
        const gv = g.city.governor;
        gv.savings = Math.max(0, Math.floor(gv.savings + n));
        return `Savings: ${gv.savings} Dn`;
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
        // Horses go to the Horse Ranches' stables: no warehouse keeps them.
        const kept = !!GOODS[good].keptAt;
        for (const b of g.buildings.values()) {
          if (left <= 0) break;
          if (kept ? !isStable(b, good) : !isStorage(b) || b.stock[good] === undefined) continue;
          const room = kept ? stableRoom(b) : storageCapacity(b) - storageUsed(b);
          const put = Math.min(room, left);
          b.stock[good] += put;
          left -= put;
        }
        const where = kept ? `an ${BUILDINGS[GOODS[good].keptAt].name} with room` : 'a granary/warehouse';
        return left > 0 ? `Stored ${n - left}; no room for ${left} (build ${where}).` : `Stored ${n} ${good}.`;
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
      case 'crime':
      case 'riot': {
        need();
        const kind = cmd.toLowerCase() === 'riot' ? 'riot' : { protest: 'protester', protester: 'protester', thief: 'thief', riot: 'riot' }[(args[0] || '').toLowerCase()];
        if (!kind) {
          if (args[0]) throw new Error('usage: crime [protest|thief|riot]');
          return crimeReport(g);
        }
        const b = homeAtCursor(app, g) || unhappiestHome(g);
        if (!b) return 'No one lives in the city yet.';
        const w = commitCrime(g, b, kind);
        app.renderer.camera.centerOnTile(b.x, b.y);
        return w ? `A ${kind} from the home at ${b.x},${b.y}.` : `Nothing happened at ${b.x},${b.y}: no road close enough.`;
      }
      case 'unrest': {
        need();
        const n = Number(args[0]);
        if (!(n >= 0 && n <= 100)) throw new Error('usage: unrest <0-100>');
        let homes = 0;
        for (const b of g.buildings.values()) if (b.house && b.house.pop > 0) { b.house.mood = Math.round(n); homes++; }
        return `${homes} homes now at mood ${Math.round(n)}.`;
      }
      case 'health':
        need();
        return healthReport(g);
      case 'event': {
        need();
        const kind = (args[0] || '').toLowerCase();
        if (!kind) return eventReport(g);
        if (kind === 'quake') {
          const size = args[1] || 'small';
          if (!QUAKE_SIZES[size]) throw new Error(`usage: event quake [${Object.keys(QUAKE_SIZES).join('|')}]`);
          const q = startQuake(g, size);
          return q ? `${quakeSummary(g)}.` : 'No earthquake: one is already shaking, or there is no city to strike.';
        }
        if (kind === 'emperor') { newEmperor(g); return 'A new Caesar rules: favor is 50.'; }
        const key = { wageup: 'wageUp', wagedown: 'wageDown', land: 'land', sea: 'sea', water: 'water', mine: 'mine', clay: 'clay' }[kind];
        if (!key) throw new Error(`usage: event [${EVENT_KINDS}]`);
        if (!eventCondition(g, key)) return `It cannot happen now (${EVENT_NEEDS[key]}).`;
        applyEvent(g, key, g.rng.range(1, 4)); // (a wage event's step, as the month's draw gives)
        return `${key}: done.`;
      }
      case 'sick': {
        need();
        const b = pickHome(app, g, args);
        if (!b) return 'No one lives in the city yet (or no home there).';
        const dead = outbreak(g, b, 'console');
        app.renderer.camera.centerOnTile(b.x, b.y);
        if (!dead) return `The home at ${b.x},${b.y} is already sick.`;
        return b.house.sick > 0 ? `The home at ${b.x},${b.y} fell sick: ${dead} died, ${b.house.pop} sick for ${b.house.sick} days.` : `The home at ${b.x},${b.y} fell sick: all ${dead} died.`;
      }
      case 'garrison':
      case 'harbor': {
        need();
        const center = cityCenter(g);
        if (!center) return 'Build some homes first (try: demo 2).';
        if (cmd === 'garrison') {
          const res = buildDemoGarrison(g, center, { stock: true, militaryFirst: true });
          if (res.barracks) app.renderer.camera.centerOnTile(res.barracks.x, res.barracks.y);
          return res.ok ? `Garrison built: ${res.forts.length} forts, ${res.towers.length} towers, ${res.wall} wall tiles. Military labor now goes first (Labor advisor). Recruits arrive over the next weeks.` : 'Could not find room for a barracks and forts near the city.';
        }
        const res = buildDemoHarbor(g, center);
        if (res.dock) app.renderer.camera.centerOnTile(res.dock.x, res.dock.y);
        return res.ok ? `Harbor built; sea routes opened: ${res.routes.join(', ') || 'none in this scenario'}.` : 'No navigable shore near the city (try a river or coast map).';
      }
      case 'fishing':
      case 'cloth':
      case 'hippodrome': {
        need();
        const center = cityCenter(g);
        if (!center) return 'Build some homes first (try: demo 2).';
        if (cmd === 'fishing') {
          const res = buildDemoFishery(g, center);
          if (res.shipyard) app.renderer.camera.centerOnTile(res.shipyard.x, res.shipyard.y);
          return res.ok ? `Fishing quarter built: a shipyard stocked with ${DEMO_YARD_TIMBER} timber (${DEMO_YARD_TIMBER / CONFIG.SHIPYARD_BOAT_TIMBER} boats), ${res.wharves.length} wharves${res.granary ? ' and a granary' : ''}. The first boat comes in ${CONFIG.SHIPYARD_BOAT_DAYS} days at full staff.` : 'No water with fishing grounds near the city (try a coast or river map).';
        }
        if (cmd === 'cloth') {
          const res = buildDemoCloth(g, center);
          if (res.linen) app.renderer.camera.centerOnTile(res.linen.x, res.linen.y);
          if (res.ok) return 'Cloth industry built: a Linarium, a Textrinum, a Taberna Vestiaria and a Horreum. Homes need clothing from the Insula up.';
          return res.farm || res.linen ? 'Cloth industry only partly built (no room, or no meadow for the Linarium).' : 'No room for the cloth industry near the city (the Linarium needs meadow), or it is locked in this mission.';
        }
        const res = buildDemoHippodrome(g, center);
        if (res.hippodrome) app.renderer.camera.centerOnTile(res.hippodrome.x + 7, res.hippodrome.y + 2);
        return res.hippodrome ? `Circus built${res.maker ? ', with a Factio' : ' (no room for a Factio)'}.` : 'No room for a Circus (15 x 5 clear tiles) near the city, or there is one already.';
      }
      case 'grounds': {
        need();
        const lines = g.map.fishingGrounds.map((gr, n) => `Ground ${n + 1} at ${gr.x},${gr.y} (water #${gr.body})`);
        if (!lines.length) lines.push('No fishing grounds on this map (no river, sea or lake of 80+ tiles).');
        for (const b of g.buildings.values()) {
          if (b.def.kind !== 'wharf') continue;
          const boat = wharfBoat(g, b);
          lines.push(`${b.def.name} #${b.id} at ${b.x},${b.y}: ${boat ? boatStatus(g, b) : 'no boat'}, ${b.stock.fish || 0} fish, ${b.catches || 0} catches, staff ${Math.round(b.efficiency * 100)}%`);
        }
        return lines.join('\n');
      }
      case 'navy': {
        need();
        const center = cityCenter(g);
        if (!center) return 'Build some homes first (try: demo 2).';
        const res = buildDemoNavy(g, center, { stock: true });
        if (res.station) app.renderer.camera.centerOnTile(res.station.x, res.station.y);
        if (res.ok) return `Fleet built: a Statio and a Navalia stocked for ${STATION_CAPACITY} liburnians (one every ${CONFIG.NAVALIA_BUILD_DAYS} days at full staff; military labor may need to go first).`;
        return res.station ? 'A Statio was built, but no room for a Navalia on its water.' : 'No shore near the city that ships can reach (try a river or coast map), or the fleet is locked in this mission.';
      }
      case 'academy': {
        need();
        const center = cityCenter(g);
        if (!center) return 'Build some homes first (try: demo 2).';
        const academy = buildDemoAcademy(g, center);
        const station = [...g.buildings.values()].find((b) => b.def.kind === 'station');
        const portus = station ? buildDemoPortus(g, station) : null;
        const shown = academy || portus;
        if (shown) app.renderer.camera.centerOnTile(shown.x, shown.y);
        const parts = [academy ? `a Campus at ${academy.x},${academy.y}` : null, portus ? `a Portus at ${portus.x},${portus.y}` : null].filter(Boolean);
        return parts.length ? `Built ${parts.join(' and ')}. They train only at full staff (military labor may need to go first).` : 'No room for a Campus near the city, or it is locked in this mission.';
      }
      case 'invade':
      case 'searaid': {
        need();
        if (g.military.active) return 'A raid is already under way.';
        const n = args[0] ? Math.max(1, Math.min(60, Number(args[0]) || 0)) : 0;
        const sea = cmd.toLowerCase() === 'searaid';
        if (sea && !g.military.seaRaids) return 'Sea raids are off in this city (Settings).';
        const inv = launchInvasion(g, null, n || undefined, { sea });
        app.renderer.camera.centerOnTile(inv.origin.x, inv.origin.y);
        if (sea && !inv.sea) return `No landing could be found, so a raid of ${inv.size} came by land from ${inv.origin.x},${inv.origin.y}.`;
        return inv.sea ? `Raid of ${inv.size} by sea in ${inv.ships} ship${inv.ships === 1 ? '' : 's'}, landing at ${inv.origin.x},${inv.origin.y}.` : `Raid of ${inv.size} launched from ${inv.origin.x},${inv.origin.y}.`;
      }
      case 'legion': {
        // Caesar's legions (sim/legion.js): set them marching, or bring them now.
        need();
        const cs = g.military.caesar;
        if (cs.army) return `Caesar's legions are already in the province: ${legionCount(g)} of ${cs.army.size} left.`;
        if (args[0] === 'now') {
          const n = args[1] ? Math.max(1, Math.min(150, Number(args[1]) || 0)) : 0;
          const army = launchLegion(g, n);
          if (!army) return 'The legions could not get in: the map entrance is shut in.';
          app.renderer.camera.centerOnTile(g.map.entry.x, g.map.entry.y);
          return `${army.size} imperial legionaries arrive at the map entrance (attack ${cs.attacks}).`;
        }
        if (cs.countdown > 0) return `Caesar's legions (${cs.size}) are already marching: ${cs.countdown} days to go. "legion now" brings them at once.`;
        startMarch(g);
        return `Caesar's legions (${cs.size}) set out from Rome: they arrive in ${cs.countdown} days. Favor ${Math.floor(g.city.ratings.favor)}: ${siegeOrder(g.difficulty, g.city.ratings.favor, 1)} on arrival.`;
      }
      case 'battle': {
        // Distant battles (sim/battle.js): a call for troops now, or its battle now.
        need();
        const b = g.military.battle;
        if (args[0] === 'now') {
          if (!b || b.phase !== 'pending') return 'No battle is pending. "battle [city] [strength]" asks for troops.';
          fightBattle(g);
          return `The battle at ${THREATENED_CITIES[b.city].name} is fought: ${b.outcome}.`;
        }
        if (b) return `A battle is already going on (${THREATENED_CITIES[b.city].name}, ${b.phase}). "battle now" fights it.`;
        const city = THREATENED_CITIES[args[0]] ? args[0] : 'placentia';
        const strength = Math.max(1, Number(args[1]) || Number(args[0]) || 16);
        requestTroops(g, city, strength);
        return `Caesar asks for troops for ${THREATENED_CITIES[city].name} against strength ${strength}; the battle in ${g.military.battle.due - g.time.totalMonths} months. Cities: ${Object.keys(THREATENED_CITIES).join(', ')}.`;
      }
      case 'arch': {
        need();
        g.city.archesEarned = (g.city.archesEarned || 0) + 1;
        app.ui.sidebar?.renderList?.();
        return `A triumphal arch to build (Government & Decor, across a straight road): ${archesToBuild(g)} now.`;
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
            lines.push(`${b.def.name} #${b.id}: ${Object.entries(b.stock).map(([k, v]) => `${k} ${v}`).join(', ')}, training ${Math.round(b.trainProgress || 0)}%${b.blocked ? ` (${b.blocked})` : ''}`);
          } else if (b.def.kind === 'station') {
            lines.push(`${b.def.name} #${b.id} at ${b.x},${b.y}: ${squadronCounts(g).get(b.id) || 0}/${STATION_CAPACITY} liburnians, staff ${Math.round(b.efficiency * 100)}%${b.rally ? `, deployed to ${Math.floor(b.rally.x)},${Math.floor(b.rally.y)}` : ''}`);
          } else if (b.def.kind === 'navalia') {
            lines.push(`${b.def.name} #${b.id}: ${Object.entries(b.stock).map(([k, v]) => `${k} ${v}`).join(', ')}, building ${Math.round(b.progress || 0)}%, ${b.built || 0} launched${b.blocked ? ` (${b.blocked})` : ''}`);
          }
        }
        for (const u of g.units.values()) {
          if (UNIT_TYPES[u.type].naval) lines.push(`${UNIT_TYPES[u.type].name} #${u.id} at ${Math.floor(u.x)},${Math.floor(u.y)}: ${shipStatus(g, u)}, hull ${Math.ceil(u.hp)}/${u.maxHp}`);
        }
        if (!lines.length) lines.push('No forts or barracks.');
        lines.push(`Raiders on the map: ${enemyCount(g)}. ${threatSummary(g).text}`);
        lines.push(m.settings ? `Next raid: month ${m.nextRaidMonth} (now ${g.time.totalMonths}); sea raids ${m.seaRaids ? 'on' : 'off'}${g.map.seaEntry ? '' : ' (no water from the sea here)'}.` : 'Raids are off in this game.');
        lines.push(`Record: ${m.stats.raids} raids (${m.stats.seaRaids || 0} by sea), ${m.stats.repelled} repelled, ${m.stats.enemiesKilled} raiders slain, ${m.stats.soldiersLost} soldiers lost, ${m.stats.prefectsLost || 0} prefects lost, ${m.stats.trained} trained; ${m.stats.shipsBuilt || 0} liburnians built, ${m.stats.shipsLost || 0} lost, ${m.stats.shipsSunk || 0} raider ships sunk, ${m.stats.boatsSunk || 0} fishing boats lost.`);
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
      case 'weather': {
        const kind = (args[0] || '').toLowerCase();
        if (!WEATHER[kind]) return `Weather now: ${app.renderer.weather.kind}. Options: ${Object.keys(WEATHER).join(', ')}`;
        if (!app.renderer.weatherOn) return 'Weather is switched off in Settings.';
        const season = app.renderer.pal.season; // the season the weather follows
        const fits = seasonalKind(kind, season);
        app.renderer.weather.force(fits);
        if (fits !== kind) {
          return app.renderer.seasonsOn
            ? `Weather: ${WEATHER[fits].label} (${WEATHER[kind].label.toLowerCase()} is not possible in ${SEASON_NAMES[season].toLowerCase()}).`
            : `Weather: ${WEATHER[fits].label} (Seasons are off in Settings, so the weather stays summer's: no snow).`;
        }
        return `Weather: ${WEATHER[kind].label} (it builds up over a few seconds of game time).`;
      }
      case 'snow': {
        const r = app.renderer;
        const w = r.weather;
        const lvl = Number(args[0]);
        if (args[0] === undefined || !Number.isInteger(lvl) || lvl < 0 || lvl > SNOW_LEVELS) return `Snow cover now: level ${w.coverLevel} (${Math.round(w.cover * 100)}%). Usage: snow <0-${SNOW_LEVELS}>`;
        if (!r.weatherOn || !r.seasonsOn) return 'Snow cover needs both Weather and Seasons switched on in Settings.';
        w.cover = [0, 0.28, 0.62, 0.95][lvl]; // inside each level's band
        w.coverLevel = lvl;
        return lvl ? `Snow cover: level ${lvl}. It melts again unless it keeps snowing (slowly in winter, fast in spring).` : 'Snow cover cleared.';
      }
      case 'sky': {
        const r = app.renderer;
        if (args[0] === 'off' || args[0] === undefined) {
          r.fixedTime = null;
          return g ? `Time of day runs again (now ${dayTime(g.time.totalTicks).toFixed(2)}).` : 'Time of day runs again.';
        }
        const t = Number(args[0]);
        if (!(t >= 0 && t <= 1)) throw new Error('usage: sky <0-1> | off');
        r.fixedTime = t;
        return `Time of day frozen at ${t} (sky off to release).`;
      }
      case 'music': {
        const mu = app.music;
        const sub = (args[0] || '').toLowerCase();
        if (sub === 'on' || sub === 'off') {
          app.settings.music = sub === 'on';
          app.applySettings();
          return mu.describe();
        }
        if (sub === 'next') { mu.skip(); return 'Starting a new piece.'; }
        if (sub === 'tracks') return TRACKS.map((t, k) => `${String(k + 1).padStart(2)}. ${t.title.padEnd(13)} ${t.moods.join(', ')}`).join('\n');
        if (sub === 'play') {
          const name = args.slice(1).join(' ');
          const byNumber = TRACKS[Number(name) - 1];
          const t = mu.play(byNumber ? byNumber.id : name);
          if (!t) throw new Error('usage: music play <track name or number> (music tracks lists them)');
          return `Playing ${t.title}.`;
        }
        if (sub === 'mood') {
          const m = (args[1] || '').toLowerCase();
          if (m !== 'auto' && !MOODS[m]) throw new Error(`usage: music mood ${Object.keys(MOODS).join('|')}|auto`);
          mu.force(m);
          return m === 'auto' ? 'The music follows the game again.' : `Music mood forced to ${m} (music mood auto to release).`;
        }
        if (sub === 'check') {
          app.musicSelfCheck().then((r) => this.print(Object.entries(r).map(([k, v]) => `${k.padEnd(9)} peak ${v.peak.toFixed(2)}  ${v.rmsDb} dBFS${v.bad ? '  BROKEN' : ''}`).join('\n'))).catch((err) => this.print(`Error: ${err.message}`));
          return 'Rendering every mood...';
        }
        if (sub === 'wav') {
          const mood = MOODS[args[1]] ? args[1] : 'day';
          const secs = Math.max(5, Math.min(300, Number(args[2]) || Number(args[1]) || 60));
          app.exportMusic(mood, secs).then((msg) => this.print(msg)).catch((err) => this.print(`Error: ${err.message}`));
          return `Rendering ${secs} s of ${mood} music...`;
        }
        return mu.describe();
      }
      case 'loglevel':
        log.setLevel(args[0]);
        return `Log level ${args[0]}`;
      default:
        throw new Error(`Unknown command "${cmd}". Type help.`);
    }
  }
}

/** The occupied home under the mouse pointer, or null. */
function homeAtCursor(app, g) {
  const t = app.input && app.input.hover;
  if (!t || !g.map.inBounds(t.x, t.y)) return null;
  const b = g.buildings.get(g.map.buildingAt(t.x, t.y));
  return b && b.house && b.house.pop > 0 ? b : null;
}

/** The occupied home with the lowest mood (the oldest on a tie), or null. */
function unhappiestHome(g) {
  let best = null;
  for (const b of g.buildings.values()) {
    const h = b.house;
    if (!h || h.pop <= 0) continue;
    const m = h.mood ?? g.city.sentiment;
    if (!best || m < (best.house.mood ?? g.city.sentiment)) best = b;
  }
  return best;
}

/**
 * The home the `sick` command means: `#id` or `id`, or `x y`, else the one
 * under the cursor, else the occupied home with the highest disease risk.
 */
function pickHome(app, g, args) {
  const occupied = (b) => (b && b.house && b.house.pop > 0 ? b : null);
  if (args.length >= 2) {
    const x = Number(args[0]);
    const y = Number(args[1]);
    if (!g.map.inBounds(x, y)) throw new Error('usage: sick [id | x y]');
    return occupied(g.buildings.get(g.map.buildingAt(x, y)));
  }
  if (args.length === 1) return occupied(g.buildings.get(Number(String(args[0]).replace('#', ''))));
  const here = homeAtCursor(app, g);
  if (here) return here;
  let best = null;
  for (const b of g.buildings.values()) {
    if (!occupied(b) || b.house.sick > 0) continue;
    if (!best || (b.house.diseaseRisk || 0) > (best.house.diseaseRisk || 0)) best = b;
  }
  return best;
}

/** The `event` command's kinds, and what each needs to happen. */
const EVENT_KINDS = 'wageup|wagedown|land|sea|water|mine|clay|quake [size]|emperor';
const EVENT_NEEDS = {
  wageUp: 'Rome already pays the most it will', wageDown: 'Rome already pays the least it will',
  land: 'no open land route', sea: 'no open sea route with a staffed Emporium', water: 'fewer than 200 people, or no disease here',
  mine: 'no iron mine', clay: 'no clay pit',
};

/** The `event` command's report: Rome's wage, trade stopped, a quake, what came so far. */
function eventReport(g) {
  const ev = g.city.events;
  const counts = Object.entries(ev.counts).map(([k, n]) => `${k} ${n}`).join(', ');
  return [
    `Rome pays ${g.city.romeWage} Dn (you pay ${g.city.wage}).`,
    tradeHaltText(g, 'land') || 'Caravans travel freely.',
    tradeHaltText(g, 'sea') || 'Ships sail freely.',
    quakeSummary(g) || 'No earthquake.',
    `So far: ${counts || 'nothing'}.`,
    `Usage: event [${EVENT_KINDS}]`,
  ].join('\n');
}

/** The `health` command's report. */
function healthReport(g) {
  const c = g.city;
  const hc = c.health;
  const y = hc.year;
  const sick = sickHomes(g);
  const on = diseaseEnabled(g)
    ? `Disease is on (${g.difficulty.name}: x${g.difficulty.disease ?? 1}); none below ${CONFIG.DISEASE_MIN_POP} people (now ${c.population}).`
    : 'There is no disease in this mission.';
  return [
    on,
    `City health ${hc.value} (the homes' average ${hc.target}; it moves ${CONFIG.HEALTH_STEP} a month).`,
    `This year: ${y.outbreaks} outbreaks (${y.spread} caught from a neighbor), ${y.deaths} died, ${y.cured} cured by physicians, ${y.recovered} recovered.`,
    `Sick now: ${sick.length ? sick.map((b) => `#${b.id} at ${b.x},${b.y} (${b.house.sick} days)`).join(', ') : 'none'}.`,
    'Closest to an outbreak:',
    ...riskiestHomes(g).map((l) => `  ${l}`),
  ].join('\n');
}

/** The `crime` command's report. */
function crimeReport(g) {
  const c = g.city;
  const y = c.crime.year;
  const about = criminalsAbout(g);
  const chance = crimeChance(c.sentiment) * (g.difficulty.crime ?? 1);
  return [
    crimeEnabled(g) ? `Crime is on (${g.difficulty.name}: x${g.difficulty.crime ?? 1}); none below ${CONFIG.CRIME_MIN_POP} people (now ${c.population}).` : 'There is no crime in this mission.',
    `City mood ${c.sentiment}: a ${Math.round(chance * 100)}% daily chance of trouble (half that for homes a prefect patrols).`,
    `This year: ${y.protesters} protesters, ${y.thieves} thieves, ${y.thefts} thefts (${y.stolen} Dn, ${y.looted} goods), ${y.riots} riots, ${y.riotBurned} buildings burned by rioters, ${y.caught} criminals caught.`,
    `About now: ${about.protester} protesters, ${about.thief} thieves, ${about.rioter} rioters.`,
    'Unhappiest homes:',
    ...unhappiestHomes(g).map((l) => `  ${l}`),
  ].join('\n');
}

/** Average position of the city's homes (where demo extras get built). */
function cityCenter(g) {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (const b of g.buildings.values()) if (b.house) { sx += b.x; sy += b.y; n++; }
  return n ? { x: Math.round(sx / n), y: Math.round(sy / n) } : null;
}

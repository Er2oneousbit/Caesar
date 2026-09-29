/**
 * help.js
 * ----------------------------------------------------------------------------
 * The in-game manual. Tabs: Getting started, Controls, Housing, Production,
 * Services, Debug & options, About. Tables are generated from the game data,
 * so the help can never drift out of date with the balance numbers.
 * ----------------------------------------------------------------------------
 */

import { h, mount } from './dom.js';
import { CONFIG } from '../config.js';
import { HOUSE_TIERS } from '../data/housing.js';
import { BUILDINGS } from '../data/buildings.js';
import { GOODS } from '../data/goods.js';
import { KEY_HELP } from '../input/input.js';
import { tierNeeds } from './advisors.js';
import { CONSOLE_HELP } from './console.js';

const TABS = [
  ['start', 'Getting started'],
  ['controls', 'Controls'],
  ['housing', 'Housing'],
  ['production', 'Production'],
  ['services', 'Services'],
  ['debug', 'Debug & options'],
  ['about', 'About'],
];

export const URL_FLAGS = [
  ['debug=1', 'Show the debug HUD (FPS, tick time, entity counts, hovered tile).'],
  ['log=debug|info|warn|error', 'Browser console log level (default info).'],
  ['skipmenu=1', 'Skip the main menu and start a sandbox immediately.'],
  ['scenario=c1 … c7', 'Start a campaign mission directly.'],
  ['seed=TEXT', 'Force the map seed for new games (same seed = same map).'],
  ['map=small|medium|large', 'Sandbox map size.'],
  ['maptype=river|coast|lakes|plains|desert', 'Sandbox landscape.'],
  ['money=N', 'Override the starting treasury.'],
  ['speed=0-4', 'Starting game speed (0 = paused).'],
  ['unlockall=1', 'Every building and every campaign mission available.'],
  ['mute=1', 'Start with sound off.'],
];

function chain(...steps) {
  return h('div', { class: 'row', style: { margin: '4px 0' } }, steps.flatMap((s, i) => (i ? [h('span', { class: 'muted' }, '→'), h('span', { class: 'chip' }, s)] : [h('span', { class: 'chip' }, s)])));
}

function content(tab) {
  switch (tab) {
    case 'start':
      return [
        h('p', {}, 'You are the governor of a new Roman colony. Build homes, keep people fed, safe and happy, and meet the mission goals.'),
        h('ol', {},
          h('li', {}, h('b', {}, 'Roads first. '), 'Everything travels by road: settlers, workers, goods and services. Your city must connect to the Imperial road at the map edge (green marker on the minimap).'),
          h('li', {}, h('b', {}, 'Housing plots. '), 'Drag the Housing tool (H) beside a road. Settlers walk in and pitch tents.'),
          h('li', {}, h('b', {}, 'Water. '), 'A Well within 2 tiles lets tents become lean-tos. Later, fountains fed by a reservoir unlock better homes.'),
          h('li', {}, h('b', {}, 'Safety. '), 'A Prefecture (fire) and an Engineer\'s Post (collapse) must send walkers past every building, or they will burn or fall down.'),
          h('li', {}, h('b', {}, 'Food. '), 'Wheat Farm on meadow → Granary → Market. The market vendor sells food door to door.'),
          h('li', {}, h('b', {}, 'Religion, culture, taxes. '), 'Temples, schools, theaters and a Forum (for taxes) let homes grow and money flow.'),
          h('li', {}, h('b', {}, 'Click things! '), 'Every building explains what it is doing. Homes list exactly what they need to reach the next level.')),
        h('h4', {}, 'How walkers work'),
        h('p', {}, 'Most services are delivered by walkers who wander the streets. A home only counts as having a temple, market or prefect if the right walker passed within 2 tiles recently. Short loops of road around your blocks work better than long dead ends.'),
        h('h4', {}, 'Workers'),
        h('p', {}, `About ${Math.round(CONFIG.WORKFORCE_RATIO * 100)}% of ordinary citizens work. A building can only hire if people live within ${CONFIG.LABOR_RANGE} tiles of it along the roads. If there are more jobs than workers, set priorities in the Labor advisor.`),
      ];
    case 'controls':
      return h('table', { class: 'tbl' }, KEY_HELP.map(([k, v]) => h('tr', {}, h('td', {}, h('b', {}, k)), h('td', {}, v))),
        h('tr', {}, h('td', {}, h('b', {}, 'Touch')), h('td', {}, 'Tap = click, drag = scroll or build, pinch = zoom, two fingers = scroll')));
    case 'housing':
      return [
        h('p', {}, 'Homes climb one level at a time when they have everything the next level needs, and fall back when they lose something for a few days. Levels 7+ need a 2×2 block and 10+ a 3×3 block: small neighboring homes merge as they grow, so leave them room.'),
        h('table', { class: 'tbl' },
          h('tr', {}, h('th', {}, 'Level'), h('th', { class: 'r' }, 'People/tile'), h('th', {}, 'Needs')),
          HOUSE_TIERS.slice(1).map((t, i) => h('tr', {}, h('td', {}, `${i + 1}. ${t.name}${t.patrician ? ' ★' : ''}`), h('td', { class: 'r num' }, t.popPerTile), h('td', { style: { fontSize: '12.5px' } }, tierNeeds(i + 1))))),
        h('p', { class: 'muted' }, '★ = patricians: they pay far more tax but do not work.'),
      ];
    case 'production':
      return [
        h('h4', {}, 'Food'),
        chain('Farm (on meadow)', 'Granary', 'Market buyer', 'Market vendor', 'Homes'),
        h('p', { class: 'muted' }, 'Farms need meadow (yellow-green land). Fertility = share of meadow under the field.'),
        h('h4', {}, 'Goods'),
        chain('Clay Pit (near water)', 'Potter', 'Warehouse', 'Market', 'Homes (Pottery)'),
        chain('Timber Yard (near forest)', 'Carpenter', 'Warehouse', 'Market', 'Homes (Furniture)'),
        chain('Olive Grove (meadow)', 'Oil Press', 'Warehouse', 'Market', 'Homes (Oil)'),
        chain('Vineyard (meadow)', 'Winery', 'Warehouse', 'Market', 'Homes (Wine)'),
        chain('Iron Mine (by rocks)', 'Weaponsmith', 'Warehouse', 'Export'),
        chain('Marble Quarry (by rocks)', 'Warehouse', 'Export'),
        h('p', {}, 'Raw materials go straight to a workshop that needs them, otherwise to a warehouse, which later sends them to workshops that run low.'),
        h('h4', {}, 'Trade'),
        h('p', {}, 'Open routes in the Trade advisor. Caravans visit staffed warehouses connected to the Imperial road. Mark goods for export (keep a reserve) or import (up to a target). Prices per 100 units:'),
        h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, 'Good'), h('th', { class: 'r' }, 'Import cost'), h('th', { class: 'r' }, 'Export price')),
          Object.entries(GOODS).map(([, g]) => h('tr', {}, h('td', {}, `${g.icon} ${g.name}`), h('td', { class: 'r num' }, g.buy), h('td', { class: 'r num' }, g.sell)))),
      ];
    case 'services': {
      const row = (key) => {
        const d = BUILDINGS[key];
        return h('tr', {}, h('td', {}, h('b', {}, d.name)), h('td', { style: { fontSize: '12.5px' } }, d.desc));
      };
      return [
        h('table', { class: 'tbl' }, ['well', 'fountain', 'reservoir', 'prefecture', 'engineer_post', 'market', 'granary', 'warehouse', 'temple_ceres', 'school', 'library', 'academy', 'theater', 'actor_troupe', 'amphitheater', 'gladiator_school', 'colosseum', 'menagerie', 'barber', 'clinic', 'baths', 'hospital', 'forum', 'senate', 'garden', 'oracle'].map(row)),
        h('h4', {}, 'Ratings'),
        h('p', {}, 'Culture comes from religion, education and entertainment coverage. Prosperity from housing quality, profit and employment. Peace grows while citizens are content. Favor is the Emperor\'s opinion: pay tribute, answer his requests, avoid debt.'),
      ];
    }
    case 'debug':
      return [
        h('h4', {}, 'URL options'),
        h('p', {}, 'Add these to the page address, e.g. colonia.html?debug=1&seed=42'),
        h('table', { class: 'tbl' }, URL_FLAGS.map(([k, v]) => h('tr', {}, h('td', {}, h('code', {}, k)), h('td', {}, v)))),
        h('h4', {}, 'Debug console (press `)'),
        h('table', { class: 'tbl' }, CONSOLE_HELP.map(([k, v]) => h('tr', {}, h('td', {}, h('code', {}, k)), h('td', {}, v)))),
        h('p', { class: 'muted' }, 'In the browser dev tools, window.colonia exposes the running app (app.game is the simulation) for poking around.'),
      ];
    case 'about':
      return [
        h('p', {}, `${CONFIG.GAME_TITLE} v${CONFIG.VERSION}: an original browser city builder inspired by classic Roman city-building games. Everything you see is drawn in code; nothing is taken from any commercial game.`),
        h('p', {}, 'Developed with Claude (Anthropic) using Claude Code.'),
        h('p', { class: 'muted' }, 'Made with ❤️ from your friendly hacker - er2oneousbit'),
      ];
    default:
      return 'Unknown page';
  }
}

export function helpModal(app, tab = 'start') {
  const body = h('div', { class: 'modal-body' });
  const tabs = h('div', { class: 'tabs' });
  const show = (t) => {
    mount(tabs, TABS.map(([k, name]) => h('button', { class: `tab${k === t ? ' active' : ''}`, onclick: () => show(k) }, name)));
    mount(body, content(t));
    body.scrollTop = 0;
  };
  show(tab);
  return h('div', { class: 'modal' },
    h('div', { class: 'modal-head' }, h('h2', {}, 'How to play'), h('button', { class: 'panel-close', title: 'Close (Esc)', onclick: () => app.ui.closeModal() }, '×')),
    tabs,
    body);
}

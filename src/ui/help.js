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
import { UNIT_TYPES } from '../data/units.js';
import { KEY_HELP } from '../input/input.js';
import { tierNeeds } from './advisors.js';
import { CONSOLE_HELP } from './console.js';
import { RAID_MIN_POP } from '../sim/military.js';
import { DIFFICULTY } from '../data/difficulty.js';
import { GODS, GOD_KEYS } from '../data/gods.js';

/** "none on Easy, 5 on Normal, 10 on Hard, 15 on Insane": crime's cost in peace by difficulty. */
const peaceByLevel = (base) => Object.values(DIFFICULTY)
  .map((d) => (d.crimePeace > 0 ? `${base * d.crimePeace} on ${d.name}` : `none on ${d.name}`)).join(', ');

const TABS = [
  ['start', 'Getting started'],
  ['controls', 'Controls'],
  ['housing', 'Housing'],
  ['production', 'Production'],
  ['services', 'Services'],
  ['military', 'Military'],
  ['debug', 'Debug & options'],
  ['about', 'About'],
];

export const URL_FLAGS = [
  ['debug=1', 'Show the debug HUD (FPS, tick time, entity counts, hovered tile).'],
  ['log=debug|info|warn|error', 'Browser console log level (default info).'],
  ['skipmenu=1', 'Skip the main menu and start a sandbox immediately.'],
  ['scenario=c1 … c7', 'Start a campaign mission directly.'],
  ['seed=TEXT', 'Force the map seed for new games (same seed = same map).'],
  ['map=small|medium|large|uber', 'Sandbox map size (Uber is 256×256).'],
  ['maptype=river|coast|lakes|plains|desert', 'Sandbox landscape.'],
  ['difficulty=easy|normal|hard|insane', 'Difficulty for skipmenu=1 and scenario=… starts.'],
  ['money=N', 'Override the starting treasury.'],
  ['speed=0-4', 'Starting game speed (0 = paused).'],
  ['unlockall=1', 'Every building and every campaign mission available.'],
  ['raids=off|occasional|frequent', 'Override raids for new games (testing).'],
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
          h('li', {}, h('b', {}, 'Roads first. '), 'Everything travels by road: settlers, workers, goods and services. Your city must connect to the Imperial road at the map edge. A gateway with green pennants marks the map entrance, where settlers and caravans arrive; red pennants mark the exit, where people leave (also green and red on the minimap).'),
          h('li', {}, h('b', {}, 'Housing plots. '), 'Drag the Housing tool (H) beside a road. Settlers walk in and pitch tents.'),
          h('li', {}, h('b', {}, 'A road must touch every other building. '), 'A prefecture, a market, a farm or any other building with workers needs a road along one of its edges. The side does not matter (the door is only art): any edge touching a road works, but a road that only meets a corner does not. Homes are easier: a road within 2 tiles will do. A building with no road gets no workers and does nothing at all: it is drawn in orange while you place it, with the edge tiles where a road would serve it picked out, and once built a red sign with a crossed-out road floats over it until a road reaches it.'),
          h('li', {}, h('b', {}, 'Water. '), 'A Well within 2 tiles lets tents become family tents. Later, fountains fed by a reservoir unlock better homes. With the Housing tool in hand, a faint blue shows where homes would get water (paler for wells, stronger for fountains); placing a fountain shows where the reservoirs pipe water in teal, with the reach of the fountains in blue on top. Wells and reservoirs need no road, but keep them within 2 tiles of one: only there can an engineer repair them.'),
          h('li', {}, h('b', {}, 'Safety. '), 'A Prefecture (fire) and an Engineer\'s Post (collapse) must send walkers past every building, or they will burn or fall down. Prefects also keep order: see Crime under Services. Click the rubble of a fallen building to see what it was, why it fell and when.'),
          h('li', {}, h('b', {}, 'Food. '), 'Wheat Farm on meadow → Granary → Market. The market vendor sells food door to door.'),
          h('li', {}, h('b', {}, 'Religion, culture, taxes. '), `Temples, schools, theaters and a Forum (for taxes) let homes grow and money flow. A home pays tax for ${CONFIG.TAX_ACCESS_DAYS} days after a tax collector walks by; its panel says whether it is registered, and why not.`),
          h('li', {}, h('b', {}, 'Click things! '), 'Every building explains what it is doing. Homes list exactly what they need to reach the next level.')),
        h('h4', {}, 'How walkers work'),
        h('p', {}, 'Most services are delivered by walkers who wander the streets. A home only counts as having a temple, market or prefect if the right walker passed within 2 tiles recently. Short loops of road around your blocks work better than long dead ends.'),
        h('p', {}, 'A Roadblock (Roads menu) turns roaming walkers back, so they keep to the streets you mean them to serve. Click one to let some kinds through (priests, market vendors...). Carts, market buyers, settlers, caravans and anyone else heading somewhere always pass.'),
        h('p', {}, 'Click a walker to see who it is, where it comes from, what it is doing and carrying, and what it thinks of the city. Follow keeps it in view until you move the map.'),
        h('h4', {}, 'Workers'),
        h('p', {}, `About ${Math.round(CONFIG.WORKFORCE_RATIO * 100)}% of ordinary citizens work. A building can only hire if people live within ${CONFIG.LABOR_RANGE} tiles of it along the roads. If there are more jobs than workers, set priorities in the Labor advisor. If there are more workers than jobs, the idle ones grumble: the ⚒ in the top bar shows unemployment, and above ${Math.round(CONFIG.UNEMPLOYMENT_MOOD_FREE * 100)}% (amber) it lowers the city's mood. Build workplaces, or stop adding homes.`),
        h('h4', {}, 'Day, night, seasons, weather and music'),
        h('p', {}, 'The sun sets every few minutes of game time and the city lights its lamps; the grass and trees follow the seasons (shown next to the date); spring brings rain, summer the odd thunderstorm, fall some showers and winter snow, which settles on the ground, trees and roofs and melts again in spring. The music follows along: ten tracks of a few minutes for building and for the night, merry music after a festival, and war drums when raiders come. None of it changes how your city works, except on Insane: there nothing grows on the farms in winter (December to Februarius), so fill the granaries in the fall. Switch any of it off in Settings (game menu, Esc); M turns the music on and off.'),
      ];
    case 'controls':
      return h('table', { class: 'tbl' }, KEY_HELP.map(([k, v]) => h('tr', {}, h('td', {}, h('b', {}, k)), h('td', {}, v))),
        h('tr', {}, h('td', {}, h('b', {}, 'Touch')), h('td', {}, 'Tap = click, drag = scroll or build, pinch = zoom, two fingers = scroll')));
    case 'housing':
      return [
        h('p', {}, 'Homes move up one level a day as soon as they have everything the next level needs, and fall back one level after a few bad days in a row (3, or 6 on Easy): a missing need, or desirability down at the floor of its level. Levels 1-10 are single tiles (four alike next to each other may join into one block), 11-14 are 2×2, 15-18 3×3 and 19-20 4×4: a home takes over homes of its level or lower, clear land and gardens beside it as it grows, so leave it room. Villas hold fewer people than insulae, so some residents move out when one is built.'),
        h('table', { class: 'tbl' },
          h('tr', {}, h('th', {}, 'Level'), h('th', { class: 'r' }, 'People'), h('th', {}, 'Needs')),
          HOUSE_TIERS.slice(1).map((t, i) => h('tr', {}, h('td', {}, `${i + 1}. ${t.name}${t.patrician ? ' ★' : ''}`), h('td', { class: 'r num' }, t.people), h('td', { style: { fontSize: '12.5px' } }, tierNeeds(i + 1))))),
        h('p', { class: 'muted' }, '★ = patricians: they pay far more tax but do not work. People: per tile for levels 1-10, per home above. Desirability (des) is what the level below needs to move up.'),
      ];
    case 'production':
      return [
        h('h4', {}, 'Food'),
        chain('Farm (on meadow)', 'Granary', 'Market buyer', 'Market vendor', 'Homes'),
        h('p', { class: 'muted' }, 'Farms need meadow (yellow-green land). Fertility = share of meadow under the field. On Insane nothing grows in winter (December to Februarius): stock up the granaries before it comes.'),
        h('h4', {}, 'Goods'),
        chain('Clay Pit (near water)', 'Potter', 'Warehouse', 'Market', 'Homes (Pottery)'),
        chain('Timber Yard (near forest)', 'Carpenter', 'Warehouse', 'Market', 'Homes (Furniture)'),
        chain('Olive Grove (meadow)', 'Oil Press', 'Warehouse', 'Market', 'Homes (Oil)'),
        chain('Vineyard (meadow)', 'Winery', 'Warehouse', 'Market', 'Homes (Wine)'),
        chain('Iron Mine (by rocks)', 'Weaponsmith', 'Warehouse', 'Export'),
        chain('Marble Quarry (by rocks)', 'Warehouse', 'Export'),
        h('p', {}, 'Raw materials go straight to a workshop that needs them, otherwise to a warehouse, which later sends them to workshops that run low.'),
        h('h4', {}, 'Granary and warehouse orders'),
        h('p', {}, 'Click a granary or warehouse and click a good\'s order to cycle it:'),
        h('ul', {},
          h('li', {}, h('b', {}, 'Accept: '), 'carts and traders may bring it here (new warehouses refuse food: it belongs in granaries).'),
          h('li', {}, h('b', {}, 'Refuse: '), 'nothing brings it here. Markets, exports and the Emperor still take it out.'),
          h('li', {}, h('b', {}, 'Get: '), 'its own cart also fetches it from other storage on its roads. A warehouse keeps 5 to 8 loads (up to 4 a trip, when 4 or fewer are left); a granary fills up, 8 loads a trip, leaving the last load elsewhere. Two buildings on Get never take from each other.'),
          h('li', {}, h('b', {}, 'Empty: '), 'a switch per building: it takes nothing in and its cart sends everything elsewhere, one load a trip. A good with nowhere to go stays; the panel names it.')),
        h('p', { class: 'muted' }, 'One cart at a time, once a day. Get and Empty need the building at least half staffed.'),
        h('p', {}, 'Something not working? The Problems overlay (top bar) raises a column over every home that cannot grow, colored by what it lacks, and over every building that does not work; point at one to see why. The Production advisor shows what was made and used last month, lists the idle buildings with a button to go to each, and names the bottlenecks.'),
        h('h4', {}, 'Trade'),
        h('p', {}, 'Open routes in the Trade advisor or on the Empire map, then mark goods for export (keep a reserve) or import (up to a target) in the Trade advisor. Partners trade in two ways:'),
        h('ul', {},
          h('li', {}, h('b', {}, 'Land routes: '), 'caravans walk in along the Imperial road to a staffed warehouse, trade, and leave by the exit.'),
          h('li', {}, h('b', {}, 'Sea routes: '), 'merchant ships sail in from the map edge to a staffed Dock. Docks must stand on the bank of a river, the coast or a big lake that reaches the map edge (ships sail under bridges). Ships unload imports onto the quay, dock workers cart them to warehouses, granaries or workshops, and ships buy exports from warehouses near the dock. Desert and plains provinces often have no sea access.')),
        h('p', {}, 'The Empire map (E, or the compass in the top bar) shows your province, Rome and every partner with its route. Caravans and ships on their way move along their routes in their city\'s color; point at one (or tap it) for the days until it arrives. Click a city for what it buys and sells, and to open its route. The game keeps running while it is open.'),
        h('p', {}, 'Prices per 100 units:'),
        h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, 'Good'), h('th', { class: 'r' }, 'Import cost'), h('th', { class: 'r' }, 'Export price')),
          Object.entries(GOODS).map(([, g]) => h('tr', {}, h('td', {}, `${g.icon} ${g.name}`), h('td', { class: 'r num' }, g.buy), h('td', { class: 'r num' }, g.sell)))),
      ];
    case 'services': {
      const row = (key) => {
        const d = BUILDINGS[key];
        return h('tr', {}, h('td', {}, h('b', {}, d.name)), h('td', { style: { fontSize: '12.5px' } }, d.desc));
      };
      return [
        h('table', { class: 'tbl' }, ['well', 'fountain', 'reservoir', 'prefecture', 'engineer_post', 'market', 'granary', 'warehouse', 'dock', 'temple_ceres', 'school', 'library', 'academy', 'theater', 'actor_troupe', 'amphitheater', 'gladiator_school', 'colosseum', 'menagerie', 'barber', 'clinic', 'baths', 'hospital', 'forum', 'senate', 'garden', 'oracle'].map(row)),
        h('h4', {}, 'Gods'),
        h('p', {}, `Five gods watch over the city, each with a temple of its own. Each wants about one staffed temple per ${CONFIG.PEOPLE_PER_TEMPLE} of its share of citizens; towns under 800 people are left alone. A content god (mood ${CONFIG.GOD_BLESS_MOOD} or more, which takes festivals or oracles) blesses the city; a neglected one (${CONFIG.GOD_WRATH_MOOD} or less) strikes. A god that has struck stays angered until its mood is back above ${CONFIG.GOD_CALM_MOOD}, and Mercury and Venus strike harder if angered again (not in the first two campaign missions). The Religion advisor shows each god's mood.`),
        h('table', { class: 'tbl' }, GOD_KEYS.map((k) => h('tr', {}, h('td', {}, h('b', { style: { color: GODS[k].color } }, GODS[k].name)), h('td', { style: { fontSize: '12.5px' } }, `${GODS[k].domain}. Blessing: ${GODS[k].blessing} Wrath: ${GODS[k].wrath}`)))),
        h('h4', {}, 'Crime'),
        h('p', {}, `Every household has a mood of its own: the city's mood, lower for a hungry home, a squalid street or the poor living among villas, a little higher for plenty of food or no tax collector at the door. Click a home to see it (Mood and order). Once the city has ${CONFIG.CRIME_MIN_POP} people, an unhappy home can breed trouble:`),
        h('ul', {},
          h('li', {}, h('b', {}, 'Protesters '), `(mood under ${CONFIG.CRIME_MOOD}) stand in the street for a few days. Harmless: they cost no peace, except on Insane, where every ${DIFFICULTY.insane.protestPeaceEvery}th costs ${CONFIG.PROTEST_PEACE}.`),
          h('li', {}, h('b', {}, 'Thieves '), `(under ${CONFIG.THIEF_MOOD}) sneak to the Forum or Senate and steal part of this year's taxes, at most ${CONFIG.THEFT_CAP} Dn and never more than the treasury holds, or empty half a market stall. Each costs peace (${peaceByLevel(CONFIG.THIEF_PEACE)}), and on all but Easy the month's peace gain.`),
          h('li', {}, h('b', {}, 'Riots '), `(${CONFIG.RIOT_MOOD} or less, while the city's mood is under ${CONFIG.RIOT_CITY_MOOD}): the rioters burn their own home and march on the finest building nearby, setting fire to what they pass. Peace falls (${peaceByLevel(CONFIG.RIOT_PEACE)}), but the anger is spent: every home's mood rises by ${CONFIG.RIOT_MOOD_BOOST}.`)),
        h('p', {}, `The angrier the city, the likelier trouble is. A prefect passing a home halves the chance for ${CONFIG.POLICE_DAYS} days, and prefects and soldiers catch the criminals they meet; prefects on patrol chase thieves and rioters within ${CONFIG.HUNT_RANGE} tiles. The Crime overlay shows which homes are close to trouble and why. The first two campaign missions have no crime.`),
        h('h4', {}, 'Health and disease'),
        h('p', {}, `Every home has a health score out of 100: its level (up to ${CONFIG.HEALTH_LEVEL_MAX}), health care (a medicus ${CONFIG.HEALTH_CARE_MEDICUS}, a hospital within ${CONFIG.HOSPITAL_RADIUS} tiles ${CONFIG.HEALTH_CARE_HOSPITAL}, both ${CONFIG.HEALTH_CARE_BOTH}), baths ${CONFIG.HEALTH_BATHS}, a barber ${CONFIG.HEALTH_BARBER}, fountain water ${CONFIG.HEALTH_FOUNTAIN} (not a well) and ${CONFIG.HEALTH_PER_FOOD} for each kind of food; a home whose people eat and that has no food at all scores at most ${CONFIG.HEALTH_HUNGRY_MAX} (tents forage). Click a home to see it (Health).`),
        h('p', {}, `Once the city has ${CONFIG.DISEASE_MIN_POP} people, crowded homes with a poor score build up disease risk, as buildings build up fire risk, and a physician passing by clears it. A home that falls sick loses about a fifth of its people (a tenth near a hospital), cannot move up or take in settlers for ${CONFIG.SICK_DAYS} days, and may pass the sickness to the homes touching it. A staffed Medicus sends a physician to cure it, as a Prefecture sends prefects to a fire. The Disease overlay shows which homes are at risk and which are sick. The first two campaign missions have no disease.`),
        h('h4', {}, 'Ratings'),
        h('p', {}, 'Culture comes from religion, education and entertainment coverage. Prosperity from housing quality, profit and employment. Peace grows while citizens are content. Favor is the Emperor\'s opinion: pay tribute, answer his requests, avoid debt. In debt nothing can be built; Rome lends money (Finance advisor), repaid monthly with interest.'),
      ];
    }
    case 'military':
      return [
        h('p', {}, `Some provinces are raided by barbarian warbands. Scouts warn you about three months before a raid (the ⚠ alert in the top bar), and raiders never come before the city has ${RAID_MIN_POP} people. Warbands grow as your city grows.`),
        h('p', {}, 'Once scouts have seen a warband, the Empire map (E) shows it closing in from its side, with its size and the months left. Click it to look at the map edge it will enter by, where your towers and soldiers should wait.'),
        h('h4', {}, 'Recruiting'),
        chain('Barracks', 'recruit walks by road', 'Fort'),
        h('p', {}, 'A staffed Barracks trains a recruit every few days and sends him to the emptiest staffed fort. Each fort holds 8 soldiers. Recruits need equipment at the Barracks, delivered by cart from workshops, ranches and warehouses:'),
        chain('Iron Mine', 'Weaponsmith', 'Barracks', 'Legionary'),
        chain('Timber Yard + Iron Mine', 'Fletcher', 'Barracks', 'Archer'),
        chain('Horse Ranch (meadow)', 'Barracks', 'Cavalryman'),
        h('p', {}, 'A Horse Ranch starts with 2 breeding mares and gains one about every 30 staffed days, up to 8. Foals come faster as the herd grows, so build ranches early. Horses can also be imported by trade.'),
        h('h4', {}, 'Soldiers'),
        h('table', { class: 'tbl' }, Object.values(UNIT_TYPES).map((u) => h('tr', {}, h('td', {}, h('b', { style: { color: u.color } }, u.name)), h('td', { style: { fontSize: '12.5px' } }, `${u.desc}${u.upkeep ? ` Pay ${u.upkeep} Dn/month.` : ''}`)))),
        h('h4', {}, 'Orders'),
        h('p', {}, 'Garrisons guard the land around their fort (cavalry ride out farther). Click a fort and press Deploy, then click the map, to post its soldiers somewhere else: at a gate, a bridge or the edge of town. Recall brings them home.'),
        h('h4', {}, 'Defenses'),
        h('p', {}, 'Watchtowers shoot raiders within 8 tiles. Walls must be broken before raiders can pass; drag a wall across a road to build a gate that citizens can use but raiders cannot. Raiders take the cheapest way to your buildings, so a wall with a gap is just a detour.'),
        h('p', {}, 'Raiders burn or wreck what they reach, and a warband that is not driven off leaves with plunder from your treasury. Kill most of it and the survivors flee; repelling a raid raises Peace and the Emperor\'s favor.'),
      ];
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

/**
 * help.js
 * ----------------------------------------------------------------------------
 * The in-game manual. Tabs: Getting started, Controls, Housing, Production,
 * Services, Military, Building names, Debug & options, About. Tables are generated from the game data,
 * so the help can never drift out of date with the balance numbers.
 * ----------------------------------------------------------------------------
 */

import { h, mount } from './dom.js';
import { CONFIG } from '../config.js';
import { HOUSE_TIERS, MAX_TIER } from '../data/housing.js';
import { BUILDINGS, TOOLS, CATEGORIES, GATE, VENUE_POINTS, VENUE_BOTH_BONUS, ENT_SEATS_MAX, ENT_BASE_MAX, buildingsInCategory } from '../data/buildings.js';
import { GOODS } from '../data/goods.js';
import { TRADE_PARTNERS, SCENARIOS, LAST_STEP, missionsAtStep } from '../data/scenarios.js';
import { DEMAND_TIERS, carryPerYear } from '../sim/tradeDemand.js';
import { TRIP_DAYS_PER_UNIT } from '../data/empireRoutes.js';
import { FIRST_VISIT_DAYS } from '../sim/trade.js';
import { UNIT_TYPES, STATION_CAPACITY } from '../data/units.js';
import { KEY_HELP } from '../input/input.js';
import { tierNeeds } from './advisors.js';
import { CONSOLE_HELP } from './console.js';
import { RAID_MIN_POP, RUMOUR_MONTHS, SCOUT_MONTHS } from '../sim/military.js';
import { DIFFICULTY } from '../data/difficulty.js';
import { GODS, GOD_KEYS } from '../data/gods.js';
import { RANKS, TOP_RANK } from '../data/ranks.js';
import { GIFT_SIZES } from '../sim/emperor.js';
import { ROME_WAGE_MIN, ROME_WAGE_MAX, TRADE_HALT_DAYS, BAD_WATER_MIN_POP } from '../data/events.js';
import { atATime } from './trainingInfo.js';

/** The campaign's steps with two provinces (the manual names them from the data). */
function branchSteps() {
  const steps = [];
  for (let n = 1; n <= LAST_STEP; n++) if (missionsAtStep(n).length > 1) steps.push(n);
  return steps;
}

/** "Steps 3 to 10" for a run of steps, else "Steps 3, 4 and 6". */
export function stepsText(steps) {
  if (steps.length > 2 && steps.every((n, i) => !i || n === steps[i - 1] + 1)) return `Steps ${steps[0]} to ${steps.at(-1)}`;
  return `Steps ${steps.join(', ').replace(/, (\d+)$/, ' and $1')}`;
}

/** "Tarraco and Alexandria": the partners that sell (`side` 'sells') or buy (`side` 'buys') a good, from the data. */
const partnersWho = (side, good) => {
  const names = Object.values(TRADE_PARTNERS).filter((p) => p[side][good]).map((p) => p.name);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] || 'nobody';
};

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
  ['names', 'Building names'],
  ['debug', 'Debug & options'],
  ['about', 'About'],
];

export const URL_FLAGS = [
  ['debug=1', 'Show the debug HUD (FPS, tick time, entity counts, hovered tile).'],
  ['log=debug|info|warn|error', 'Browser console log level (default info).'],
  ['skipmenu=1', 'Skip the main menu and start a sandbox immediately.'],
  ['scenario=c1 … c7, c3m, c4p, c5p', 'Start a campaign mission directly (c3m Firmum, c4p Paestum, c5p Beneventum: the provinces beside missions 3 to 5).'],
  ['seed=TEXT', 'Force the map seed for new games (same seed = same map).'],
  ['map=small|medium|large|uber', 'Sandbox map size (Uber is 256×256).'],
  ['maptype=river|coast|lakes|plains|desert', 'Sandbox landscape.'],
  ['difficulty=easy|normal|hard|insane', 'Difficulty for skipmenu=1 and scenario=… starts.'],
  ['money=N', 'Override the starting treasury.'],
  ['speed=0-4', 'Starting game speed (0 = paused).'],
  ['unlockall=1', 'Every building and every campaign mission available.'],
  ['raids=off|occasional|frequent', 'Override raids for new games (testing).'],
  ['searaids=off|on', 'Sea raids switch for new games (off: every raid comes by land).'],
  ['natives=1', 'With skipmenu=1: the sandbox has native villages.'],
  ['people=gauls|ligurians|carthaginians|...|site', 'Who raids new games: a people, or the province\'s own (testing).'],
  ['wolves=on|off', 'Wolf packs on new games\' maps, or none (testing).'],
  ['events=off', 'No events, random or scheduled, in this session\'s games (testing).'],
  ['events=wages,sea', 'The sandbox setup (and a skipmenu=1 sandbox) starts with only these events ticked (wages, land, sea, water, mine, clay, or none).'],
  ['mute=1', 'Start with sound off.'],
];

function chain(...steps) {
  return h('div', { class: 'row', style: { margin: '4px 0' } }, steps.flatMap((s, i) => (i ? [h('span', { class: 'muted' }, '→'), h('span', { class: 'chip' }, s)] : [h('span', { class: 'chip' }, s)])));
}

/**
 * Every building's Latin name beside its English one, by build menu
 * category (the gate after the wall that cuts it). Clear Land is a tool, not
 * a building, and keeps its English name, so it is not listed.
 */
function nameRows() {
  const row = (def) => h('tr', {}, h('td', {}, h('b', {}, def.name)), h('td', {}, def.en));
  return CATEGORIES.flatMap((c) => [
    h('tr', {}, h('th', { colspan: 2 }, c.name)),
    ...buildingsInCategory(c.key).flatMap(({ key, def }) => (key === 'wall' ? [row(def), row(GATE)] : [row(def)])),
  ]);
}

function content(tab) {
  switch (tab) {
    case 'start':
      return [
        h('p', {}, 'You are the governor of a new Roman colony. Build homes, keep people fed, safe and happy, and meet the mission goals.'),
        h('ol', {},
          h('li', {}, h('b', {}, 'Roads first. '), 'Everything travels by road (Via): settlers, workers, goods and services. Your city must connect to the Imperial road at the map edge. A gateway with green pennants marks the map entrance, where settlers and caravans arrive; red pennants mark the exit, where people leave (also green and red on the minimap).'),
          h('li', {}, h('b', {}, 'Housing plots. '), 'Drag the Area (Housing Plot) tool, H, beside a road. Settlers walk in and pitch tents.'),
          h('li', {}, h('b', {}, 'A road must touch every other building. '), 'A prefecture, a market, a farm or any other building with workers needs a road along one of its edges. The side does not matter (the door is only art): any edge touching a road works, but a road that only meets a corner does not. Held beside a road on one side only, a building turns its front to it by itself; R turns it your way instead (until you pick another tool). Homes are easier: a road within 2 tiles will do. A building with no road gets no workers and does nothing at all: it is drawn in orange while you place it, with the edge tiles where a road would serve it picked out, and once built a red sign with a crossed-out road floats over it until a road reaches it.'),
          h('li', {}, h('b', {}, 'Water. '), 'A Puteus (Well) within 2 tiles lets tents become family tents. Later, a Lacus (Fountain) fed by a Castellum Aquae (Reservoir) unlocks better homes. With the Housing tool in hand, a blue tint shows where homes would get water (pale for wells, a clear outlined blue for fountains); placing a fountain shows where the reservoirs pipe water in teal, with the reach of the fountains in blue on top. Wells and reservoirs need no road, and wells, fountains and reservoirs never burn or wear out.'),
          h('li', {}, h('b', {}, 'Safety. '), 'An Excubitorium (Prefecture), against fire, and a Collegium Fabrum (Engineer\'s Post), against collapse, must send walkers past every building, or they will burn or fall down. Their walkers head for the streets closest to disaster, but a post looks after its own neighbourhood: give a big city several. A prefect puts out one burning building at a time, half a day each, and the flames keep spreading from the rest meanwhile: a block on fire needs several prefects. Click the rubble to see what stood there and rebuild it in one click. A workshop is as likely to collapse as to burn. Warehouses, engineer\'s posts, water works, farms, gardens, statues and forts never burn or collapse on their own (raiders, rioters and an angered Mercury can still destroy them). Prefects also keep order: see Crime under Services. Click the rubble of a fallen building to see what it was, why it fell and when.'),
          h('li', {}, h('b', {}, 'Food. '), 'Seges (Wheat Farm) on meadow → Granarium (Granary) → Macellum (Market). The market vendor sells food door to door.'),
          h('li', {}, h('b', {}, 'Religion, culture, taxes. '), `Temples, schools, theaters and a Forum (for taxes) let homes grow and money flow. A home pays tax for ${CONFIG.TAX_ACCESS_DAYS} days after a tax collector walks by; its panel says whether it is registered, and why not.`),
          h('li', {}, h('b', {}, 'Click things! '), 'Every building explains what it is doing. Homes list exactly what they need to reach the next level.')),
        h('h4', {}, 'How walkers work'),
        h('p', {}, 'Most services are delivered by walkers who wander the streets. A home only counts as having a temple, market or prefect if the right walker passed within 2 tiles recently. At a junction a walker heads for the street whose homes most need him: those whose last visit from a walker like him (for a priest, one of his god) is running out or has run out (for a market vendor, those lowest in the food and goods his market has), looking past the next corner too. Short loops of road around your blocks work better than long dead ends, and a building still serves only its own neighbourhood: homes far from it, or down a long dead end, need one of their own.'),
        h('p', {}, 'A Claustra (Roadblock, in the Roads menu) turns roaming walkers back, so they keep to the streets you mean them to serve. Click one to let some kinds through (priests, market vendors...). Carts, market buyers, settlers, caravans and anyone else heading somewhere always pass.'),
        h('p', {}, 'Click a walker to see who it is, where it comes from, what it is doing and carrying, and what it thinks of the city. Follow keeps it in view until you move the map.'),
        h('h4', {}, 'Bridges'),
        h('p', {}, `Two bridges carry a road across water (Roads menu): drag one straight from open land on one bank to open land on the other. The Pons (Ship Bridge, ${TOOLS.bridge.cost} Dn a water tile, 3 to 16 tiles of water) stands high on stone arches: every boat sails under it. The Pons Sublicius (Low Bridge, ${TOOLS.low_bridge.cost} Dn a tile, 1 to 16 tiles) is timber on piles: cheaper, but no boat passes it. Merchant ships, fishing boats, liburnians and raider ships all stay on their own side, so a low bridge between the sea and an Emporium cuts the dock off. While you place one, the build menu warns of every dock, station or wharf it would cut off; a low bridge below the city also keeps raider ships out of the upper river.`),
        h('h4', {}, 'Workers'),
        h('p', {}, `About ${Math.round(CONFIG.WORKFORCE_RATIO * 100)}% of ordinary citizens work. A building can only hire if people live within ${CONFIG.LABOR_RANGE} tiles of it along the roads. If there are more jobs than workers, set priorities in the Labor advisor. If there are more workers than jobs, the idle ones grumble: the ⚒ in the top bar shows unemployment, and above ${Math.round(CONFIG.UNEMPLOYMENT_MOOD_FREE * 100)}% (amber) it lowers the city's mood. Build workplaces, or stop adding homes: in the first campaign missions, whose buildings give little work, the population goal is what a sensibly built town of them employs. Patricians (★ homes, from the Villa up) never work but still need every service, so a city with villas holds more people for the same jobs.`),
        h('h4', {}, 'The campaign'),
        h('p', {}, `${LAST_STEP} steps, each opened by winning a mission of the step before. ${stepsText(branchSteps())} offer two provinces at the same rank: a peaceful one (no raids and no army; more people and higher culture and prosperity goals, and from step 4 more favor too) and a military one (raids, forts and Caesar's calls for troops; at step 3 Firmum brings raids and forts a step sooner than the campaign had them). From step 3 both ask for Caesar's favor. After a win, choose your next post from the two cards on the victory screen; you may switch between peaceful and military at every step. Each card's Start opens the province's briefing, and Back returns to the choice. If a city at a step with two provinces is overrun, the defeat screen offers that step's choice again. The Campaign list shows both provinces of a step side by side, and keeps every mission you have won open to replay.`),
        h('p', {}, `Figlina and Beneventum, and from step 6 the provinces, trade on bigger quotas (a partner may buy 1,500, 2,500 or 4,000 of a good a year; from step 6 it may change, and a message tells you when), and so can ask for more people. The last step's maps are the largest, and their fields, forests and rocky hills lie far apart: since a building hires only from homes within ${CONFIG.LABOR_RANGE} road tiles, the city grows in districts, each with its own homes, markets and services. Win either province of step ${LAST_STEP} and Rome hails you ${RANKS[TOP_RANK].name}: your career is crowned.`),
        h('h4', {}, 'Native villages'),
        h('p', {}, 'In Mutina and Luna (and a sandbox that asks for them) the Ligurians still live in villages of their own: a meeting place with huts round it. Their land is every tile within 3 of a hut and 6 of a meeting place (the Native land overlay shows it). A village starts angry, and anything you build on its land (not a road or a wall) sets it attacking: its men break your building down. A Sacellum Pacis (Mission Post, Temples menu) sends a missionary along the roads: every hut and meeting place within 4 tiles of him is calmed for 100 days. Soldiers, towers and prefects fight villagers only while they attack. While a mission post is staffed, calmed villages send traders to buy up to 3 loads of your exports from the nearest warehouse.'),
        h('h4', {}, 'Hall of Fame'),
        h('p', {}, 'Every campaign win is scored: its four ratings added, plus 100 x its people / the population goal (at most 200), plus 100 x the mission\'s planned years / the years it took (at most 150), all times the difficulty (Easy x0.5, Normal x1, Hard x1.5, Insane x2), plus 50 for each distant battle won and 25 for each raid repelled. The Hall of Fame (main menu, campaign screen) lists the ten best wins, each province once with its best, and your career: the best win at each step, plus 500 once Rome hails you Caesar. The sandbox is not scored.'),
        h('h4', {}, 'Day, night, seasons, weather and music'),
        h('p', {}, 'The sun sets every few minutes of game time and the city lights its lamps; the grass and trees follow the seasons (shown next to the date); spring brings rain, summer the odd thunderstorm, fall some showers and winter snow, which settles on the ground, trees and roofs and melts again in spring. The music follows along: ten tracks of a few minutes for building and for the night, merry music after a festival, and war drums when raiders come. None of it changes how your city works, except on Insane: there nothing grows on the farms in winter (December to Februarius), so fill the granaries in the fall. Switch any of it off in Settings (game menu, Esc); M turns the music on and off.'),
        h('h4', {}, 'Auto-pause and idle buildings'),
        h('p', {}, 'Settings can pause the game the moment a fire breaks out, scouts report a raid, raiders or Caesar\'s legions arrive (on at first), Caesar asks for goods or troops, a building collapses or disease breaks out. A note says why: click it to look, Space resumes. A building\'s panel has ◀ ▶ (or , and .) to visit every building of its kind, and Next idle for those of its kind that are not working or are short of what they need; I visits the idle buildings of every kind, as does the Production advisor\'s button.'),
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
        chain('Farm (on meadow)', 'Granarium (Granary)', 'Macellum (Market) buyer', 'Macellum vendor', 'Homes'),
        h('p', { class: 'muted' }, 'Farms need meadow (yellow-green land; with a farm in hand it is outlined in green-gold, even under snow). Fertility = share of meadow under the field. On Insane nothing grows in winter (December to Februarius): stock up the granaries before it comes.'),
        chain('Silva Caedua (Timber Yard): timber', 'Fabrica Navalis (Shipyard): boats', 'Piscatoria (Fishing Wharf)', 'Granarium', 'Macellum', 'Homes (Fish)'),
        h('p', {}, `Fish is a food of its own, a fifth kind beside wheat, vegetables, fruit and meat, so a city by the water can skip a farm for its two- and three-food homes. Wharves and shipyards stand on the bank of a river, the sea or a big lake (a pond has no fish), right at the water's edge: one whole side on the water, no land between; gulls circle over the fishing grounds. A Fabrica Navalis builds a boat from ${CONFIG.SHIPYARD_BOAT_TIMBER} timber in ${CONFIG.SHIPYARD_BOAT_DAYS} days at full staff and sends it to the nearest staffed wharf on its water that has none; it keeps one spare ready. The timber is Colonia's own rule (the original's boats cost nothing): carts bring it like a workshop's raw material, from a Silva Caedua (Timber Yard) or a warehouse, the yard holds up to ${BUILDINGS.shipyard.inputCap}, and without a boat's worth the work waits. The wharf's boat sails to the nearest fishing ground, fishes ${CONFIG.FISH_DAYS} days and brings back ${CONFIG.FISH_CATCH} fish, about one load a month when the ground is near; carts take the catch to a granary. Fewer workers mean a longer wait between trips. The sea does not freeze: wharves fish all winter, even on Insane. Neptune's wrath sinks every boat, and the shipyards must build new ones, from new timber.`),
        h('h4', {}, 'Goods'),
        chain('Cretifodina (Clay Pit, near water)', 'Figlina (Potter)', 'Horreum (Warehouse)', 'Macellum (Market)', 'Homes (Pottery)'),
        chain('Silva Caedua (Timber Yard, near forest)', 'Officina Lignaria (Carpenter)', 'Horreum', 'Macellum', 'Homes (Furniture)'),
        chain('Olivetum (Olive Grove, meadow)', 'Trapetum (Oil Press)', 'Horreum', 'Macellum', 'Homes (Oil)'),
        chain('Vinea (Vineyard, meadow)', 'Cella Vinaria (Winery)', 'Horreum', 'Macellum', 'Homes (Wine)'),
        chain('Linarium (Flax Field, meadow)', 'Textrinum (Linen Weaver)', 'Taberna Vestiaria (Clothing Maker)', 'Horreum', 'Macellum', 'Homes (Clothing)'),
        h('p', { class: 'muted' }, `Clothing takes two workshops: a Textrinum spins and weaves flax into linen, and a Taberna Vestiaria sews the linen into clothing. Homes need it from the Insula up (a Tenement already stocks it). Linen can also be bought (${partnersWho('sells', 'linen')} sell it) for a Taberna Vestiaria, and ${partnersWho('buys', 'clothing')} buy clothing.`),
        chain('Ferraria (Iron Mine, by rocks)', 'Fabrica (Weaponsmith)', 'Horreum', 'Export'),
        chain('Lapicidina (Marble Quarry, by rocks)', 'Horreum', 'Export'),
        h('p', {}, 'Raw materials go straight to a workshop that needs them (timber to a shipyard too), otherwise to a warehouse, which later sends them to workshops and shipyards that run low.'),
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
          h('li', {}, h('b', {}, 'Sea routes: '), 'merchant ships sail in from the map edge to a staffed Emporium (Trade Dock). It must stand on the bank of a river, the coast or a big lake that reaches the map edge (ships sail under a ship bridge, never past a low bridge), right at the water\'s edge: one whole side on the water, with no strip of land between any of it and the water (so do the Navalia, the Statio and the Portus). A ship waits at the Emporium while it trades: its imports land on the quay (you pay as they land) and the dock workers (up to 3, by staffing) cart them to warehouses, granaries or workshops, and fetch its exports from warehouses near the dock (you are paid as each load goes aboard). It sails when both are done, or after 48 days: keep a warehouse near the Emporium, and build a second one for several sea partners (the panel of the Emporium and the Trade advisor say when ships are waiting offshore for a free one). Desert and plains provinces often have no sea access.')),
        h('p', {}, 'Horses are the exception: no warehouse keeps them. They live at an Equaria (Horse Ranch), so horses you buy go to a Tirocinium that needs them or to a ranch with room in its stables, and horses you sell are taken from the ranches (by a caravan from those on its warehouse\'s roads, by ship from staffed ranches near the Emporium). Without a ranch no horses can be imported; the Trade advisor says so.'),
        h('p', {}, `Each partner buys and sells at most a set amount of each good a year (its card shows this year's). A mission may set what a partner buys on the original's tiers (${DEMAND_TIERS.slice(1, -1).map((n) => n.toLocaleString('en-US')).join(', ')} or ${DEMAND_TIERS.at(-1).toLocaleString('en-US')} a year) and change it during the mission: a message names the city and the good when its demand rises, falls or stops. A route busier than its traders can carry (about ${Math.round(carryPerYear('land') / 100) * 100} a year by caravan, ${Math.round(carryPerYear('sea') / 100) * 100} by ship) sends them more often.`),
        h('p', {}, `Distance counts (Colonia's own rule; in the original it did not): a trader needs ${TRIP_DAYS_PER_UNIT} days for every unit of its route on the Empire map, each way, and a quiet route cannot send them more often than one can go home and come back, so a far partner comes less often (a busy one still carries its whole year). The first trader comes when it can have made the trip, at least ${FIRST_VISIT_DAYS} days after you open the route. A route's card says how many days its traders are on the way and how often they come.`),
        h('p', {}, 'The Empire map (E, or the compass in the top bar) shows your province where its city stands (each mission has its own place; the sandbox setup lets you choose), Rome and every partner with its route along the roads or the sea lanes. Caravans and ships on their way move along their routes in their city\'s color; point at one (or tap it) for the days until it arrives. Click a city for what it buys and sells, and to open its route. The game keeps running while it is open.'),
        h('p', {}, `Prices are each partner's own (Colonia's own rules; in the original every partner paid one price). Your nearest partner trades at the prices below, your farthest at ${Math.round(CONFIG.TRADE_DISTANCE_PREMIUM * 100)}% more and the others in between by the length of their route, both ways: a far partner's goods cost more, and a far market pays more for yours. A mission may have a local market of its own, a few goods cheap or dear with every partner (its briefing and the Trade advisor say which). And each New Year every good's price drifts, up to ${Math.round(CONFIG.PRICE_DRIFT_MAX * 100)}% either way and pulled back toward the base over the years; a message names the biggest moves. A route's card shows each good at that partner's price this year, and the Import and Export choices the range across your partners.`),
        h('p', {}, 'Choose whom you trade with (Colonia\'s own rule): each good on a route\'s card has a switch beside its price, all on to begin with. Untick it and that partner neither buys nor sells you that good, so you can sell only to the buyers who pay best or buy only from the cheapest seller. The good\'s Import or Export setting stays the master: a good trades with a partner only while its setting allows it and that partner\'s switch is on. The Goods table counts the partners left on (to 3 of 5 buyers). Switched-off goods do not make a route busier, and a partner with every good switched off sends no traders until you switch one back on. The trade log names what each visit sold and bought.'),
        h('p', {}, 'Base prices per 100 units (your nearest partner, before the local market and the year\'s drift):'),
        h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, 'Good'), h('th', { class: 'r' }, 'Import cost'), h('th', { class: 'r' }, 'Export price')),
          Object.entries(GOODS).map(([, g]) => h('tr', {}, h('td', {}, `${g.icon} ${g.name}`), h('td', { class: 'r num' }, g.buy), h('td', { class: 'r num' }, g.sell)))),
      ];
    case 'services': {
      const row = (key) => {
        const d = BUILDINGS[key];
        return h('tr', {}, h('td', {}, h('b', {}, d.name), d.en !== d.name ? h('div', { class: 'muted' }, d.en) : null), h('td', { style: { fontSize: '12.5px' } }, d.desc));
      };
      return [
        h('table', { class: 'tbl' }, ['well', 'fountain', 'reservoir', 'prefecture', 'engineer_post', 'market', 'granary', 'warehouse', 'dock', 'shipyard', 'wharf', 'temple_ceres', 'temple_large_ceres', 'school', 'library', 'academy', 'theater', 'actor_troupe', 'amphitheater', 'gladiator_school', 'colosseum', 'menagerie', 'hippodrome', 'chariot_maker', 'barber', 'clinic', 'baths', 'hospital', 'forum', 'senate', 'garden', 'gardener_yard', 'oracle'].map(row)),
        h('h4', {}, 'Gardens and statues'),
        h('p', {}, `Where you can build a Topiaria (Gardeners' Yard, ${BUILDINGS.gardener_yard.cost} Dn, ${BUILDINGS.gardener_yard.workers} workers), gardens and statues need tending. Its gardeners roam the streets like prefects and tend every garden and statue within ${CONFIG.SERVICE_RADIUS} tiles of their road (a garden or statue needs no road of its own, so set it where a gardener walks by), heading for the ones longest untended. A month (${CONFIG.CARE_GRACE_DAYS} days) after its last visit a garden or statue starts to lose its desirability, a step every ${CONFIG.CARE_STEP_DAYS} days (${CONFIG.CARE_LEVELS.slice(1, -1).join('%, ')}%), down to ${CONFIG.CARE_LEVELS.at(-1)}% of it six months after the visit, and looks it; the next gardener puts it back in full. Easy fades at half that pace, Insane half again as fast. Plazas, the triumphal arch, the Oracle and your residence never fade. Click a garden or statue to see its care; the Gardens and statues overlay shows them all, and the gardeners. Where a province has no gardeners' yard, its gardens and statues keep their full bonus.`),
        h('h4', {}, 'Entertainment'),
        h('p', {}, `A home's entertainment is the points of every venue whose entertainer passed by lately (Theatrum ${VENUE_POINTS.theater}, Amphitheatrum ${VENUE_POINTS.amphitheater} or ${VENUE_POINTS.amphitheater + VENUE_BOTH_BONUS.amphitheater} with plays and gladiators, Arena ${VENUE_POINTS.colosseum} or ${VENUE_POINTS.colosseum + VENUE_BOTH_BONUS.colosseum} with gladiators and beasts, the Circus's charioteer ${VENUE_POINTS.hippodrome}), plus a share for every home of how well the venues' seats cover the city: up to ${ENT_SEATS_MAX}, or ${ENT_BASE_MAX} with races at the Circus, which seats the whole city. Venues only send entertainers while shows are booked. The Circus (Hippodrome: one per city, 15 × 5 tiles; click to place it by its middle) gets its races from a Factio (Chariot Stable): each team books 32 days. Its charioteer drives twice as fast and twice as far as other entertainers, and prosperity rises a little while races run. The top two homes need ${HOUSE_TIERS[MAX_TIER - 1].ent} and ${HOUSE_TIERS[MAX_TIER].ent}: the Imperial Palatium needs the Circus.`),
        h('h4', {}, 'Gods'),
        h('p', {}, `Five gods watch over the city, each with a temple of its own, small or large. Each wants about one staffed temple per ${CONFIG.PEOPLE_PER_TEMPLE} of its share of citizens, and a large temple counts as two (its priest walks the same rounds as a small temple's); towns under 800 people are left alone. Above that the gods are jealous: the one with strictly the most temples is the favourite (its mood target rises to 100), the one with strictly the fewest loses 25; a tie means neither. A content god (mood ${CONFIG.GOD_BLESS_MOOD} or more, which takes festivals or oracles) blesses the city; a neglected one (${CONFIG.GOD_WRATH_MOOD} or less) strikes. A god that has struck stays angered until its mood is back above ${CONFIG.GOD_CALM_MOOD}, and Mercury and Venus strike harder if angered again (not in the first two campaign missions). The Religion advisor shows each god's mood.`),
        h('p', {}, `Festivals (Religion advisor) cost money, food from the granaries (${CONFIG.FESTIVAL_FOOD_SHARE.map((s) => `${Math.round(s * 100)}%`).join(', ')} of a month's food for a small, large or grand one, a load at least) and, large or grand, wine from the warehouses (a grand one a load per ${CONFIG.FESTIVAL_WINE_PEOPLE} citizens and one more, a large one half that); without all of it there is no festival. It is held at the god's temples, and a bigger feast needs more priests: a staffed temple of the god has 1, a large temple 2; a small festival needs 1, a large one 3, a grand one 3 and an Oracle (from the missions that have it). The next can follow after ${CONFIG.FESTIVAL_COOLDOWN.join(', ')} months, though one held within ${CONFIG.FESTIVAL_CITY_FULL_MONTHS} months of the last lifts the people's mood less (its god's in full). A god with no festival in its honor for more than ${CONFIG.FESTIVAL_FREE_MONTHS} months is neglected: its mood target falls a point a month, ${CONFIG.FESTIVAL_NEGLECT_MAX} at most, until a festival of any size (towns under 800 people aside). Small festivals for each god in turn keep all five content.`),
        h('table', { class: 'tbl' }, GOD_KEYS.map((k) => h('tr', {}, h('td', {}, h('b', { style: { color: GODS[k].color } }, GODS[k].name)), h('td', { style: { fontSize: '12.5px' } }, `${GODS[k].domain}. Blessing: ${GODS[k].blessing} Wrath: ${GODS[k].wrath}`)))),
        h('h4', {}, 'Crime'),
        h('p', {}, `Every household has a mood of its own: the city's mood, lower for a hungry home, a squalid street or the poor living among villas, a little higher for plenty of food or no tax collector at the door. Click a home to see it (Mood and order). Once the city has ${CONFIG.CRIME_MIN_POP} people, an unhappy home can breed trouble:`),
        h('ul', {},
          h('li', {}, h('b', {}, 'Protesters '), `(mood under ${CONFIG.CRIME_MOOD}) stand in the street for a few days. Harmless: they cost no peace, except on Insane, where every ${DIFFICULTY.insane.protestPeaceEvery}th costs ${CONFIG.PROTEST_PEACE}.`),
          h('li', {}, h('b', {}, 'Thieves '), `(under ${CONFIG.THIEF_MOOD}) sneak to the Forum or the Curia (Senate House) and steal part of this year's taxes, at most ${CONFIG.THEFT_CAP} Dn and never more than the treasury holds, or empty half a market stall. Each costs peace (${peaceByLevel(CONFIG.THIEF_PEACE)}), and on all but Easy the month's peace gain.`),
          h('li', {}, h('b', {}, 'Riots '), `(${CONFIG.RIOT_MOOD} or less, while the city's mood is under ${CONFIG.RIOT_CITY_MOOD}): the rioters burn their own home and march on the finest building nearby, setting fire to what they pass. Peace falls (${peaceByLevel(CONFIG.RIOT_PEACE)}), but the anger is spent: every home's mood rises by ${CONFIG.RIOT_MOOD_BOOST}.`)),
        h('p', {}, `The angrier the city, the likelier trouble is. A prefect passing a home halves the chance for ${CONFIG.POLICE_DAYS} days, and prefects and soldiers catch the criminals they meet; prefects on patrol chase thieves and rioters within ${CONFIG.HUNT_RANGE} tiles. The Crime overlay shows which homes are close to trouble and why. The first two campaign missions have no crime.`),
        h('h4', {}, 'Health and disease'),
        h('p', {}, `Every home has a health score out of 100: its level (up to ${CONFIG.HEALTH_LEVEL_MAX}), health care (a medicus ${CONFIG.HEALTH_CARE_MEDICUS}, a hospital within ${CONFIG.HOSPITAL_RADIUS} tiles ${CONFIG.HEALTH_CARE_HOSPITAL}, both ${CONFIG.HEALTH_CARE_BOTH}), baths ${CONFIG.HEALTH_BATHS}, a barber ${CONFIG.HEALTH_BARBER}, fountain water ${CONFIG.HEALTH_FOUNTAIN} (not a well) and ${CONFIG.HEALTH_PER_FOOD} for each kind of food; a home whose people eat and that has no food at all scores at most ${CONFIG.HEALTH_HUNGRY_MAX} (tents forage). Click a home to see it (Health).`),
        h('p', {}, `Once the city has ${CONFIG.DISEASE_MIN_POP} people, crowded homes with a poor score build up disease risk, as buildings build up fire risk, and a physician passing by clears it. A home that falls sick loses about a fifth of its people (a tenth near a hospital), cannot move up or take in settlers for ${CONFIG.SICK_DAYS} days, and may pass the sickness to the homes touching it. A staffed Medicus (Physician) sends a physician to cure it, as an Excubitorium (Prefecture) sends prefects to a fire. The Disease overlay shows which homes are at risk and which are sick. The first two campaign missions have no disease.`),
        h('p', {}, `The Health, Education and Entertainment advisors (F2) show, for each kind of building, how many there are and how many have workers, the people its walkers reached (a hospital: the homes within ${CONFIG.HOSPITAL_RADIUS} tiles), and how many of the people whose homes need it to keep or reach their level have it, in words from None to Full. A building serves every home its walker passes, however many; venues are the exception, with seats that set the entertainment every home gets. Each advisor gives one line of advice on what holds homes back most; click a building's name to go to one. The Health advisor also shows city health, which moves ${CONFIG.HEALTH_STEP} points a month toward the homes' average score, and the year's outbreaks; the Overview has city health and crime at a glance.`),
        h('h4', {}, 'Events'),
        h('p', {}, `Now and then fortune strikes the province, as in the original. Each month there is a chance of a random event, if the mission allows it (the sandbox: those ticked in its setup, each event with its own switch and an Events box for them all; an unticked one never comes and the rest come as often as before): Rome raising or cutting wages (between ${ROME_WAGE_MIN} and ${ROME_WAGE_MAX} Dn: citizens measure your wage against Rome's, so match a rise in the Labor advisor or the mood suffers), landslides or sandstorms stopping every caravan for ${TRADE_HALT_DAYS} days (storms: every ship), bad water lowering city health (from ${BAD_WATER_MIN_POP} people), or the oldest iron mine or clay pit caving in. They come half as often on Easy and half again as often on Insane, and the same one not again within ${DIFFICULTY.normal.eventCooldown} months (${DIFFICULTY.easy.eventCooldown} on Easy, ${DIFFICULTY.insane.eventCooldown} on Insane). Some missions also schedule a change of emperor (favor starts afresh at 50), a price change, or an earthquake: cracks spread from near the middle of the city for days, and every tile they cross loses what stood there and becomes rock for good, so build round them. The first two missions have no events.`),
        h('h4', {}, 'Ratings'),
        h('p', {}, `Culture comes from religion, education and entertainment coverage. Prosperity from housing quality, profit and employment. Peace grows while citizens are content, and falls in any month enemies are in the province; Rome proclaims no victory until they are gone. Favor is the Emperor's opinion: pay tribute, answer his requests and his calls for troops, avoid debt. Favor 0 does not end the game, but at ${CONFIG.LEGION_FAVOR} or less Caesar sends his legions against you (see Military). In debt nothing can be built; Rome lends money (Finance advisor), repaid monthly with interest.`),
        h('h4', {}, 'The governor: rank, salary, savings'),
        h('p', {}, `You hold a rank, from ${RANKS[0].name} to ${RANKS[TOP_RANK].name}: each step of the campaign is played one rank higher, both of its provinces alike (${RANKS[0].name} in the first, ${RANKS[SCENARIOS.at(-1).rank].name} in the last, and a win at the last step makes you ${RANKS[TOP_RANK].name}), and the sandbox lets you pick one. Your rank sets the most salary Rome lets you draw: ${RANKS.map((r) => `${r.name} ${r.salary}`).join(', ')} Dn a month. In the Imperial advisor you can draw your rank's rate or a lower rank's, never a higher one's (those are listed greyed out). The salary is paid at each month's end from the treasury into your personal savings, but never when the treasury cannot cover it. At New Year Rome looks at what you drew over the year: less than your rank's pay, by your own choice, earns a point of favor.`),
        h('p', {}, `Your savings are your own and go with you from mission to mission (to both provinces of the next step where it has two). Spend them on gifts to the Emperor (Imperial advisor): a modest, generous or lavish gift costs ${GIFT_SIZES.map((g) => `1/${g.share} of your savings plus ${g.base} Dn`).join(', ')}, and pleases him by ${GIFT_SIZES.map((g) => `+${g.favor[0]}`).join(', ')} favor; each further gift within a year of your last pleases him less, and he counts afresh 12 months after the last. Or give them to the city: a donation goes into the treasury and is not counted as profit. Festivals are paid from the treasury.`),
        h('p', {}, `Your residence: a Praetorium (Governor's House: ${BUILDINGS.governor_house.cost} Dn, 3×3), Praetorium Maius (Villa: ${BUILDINGS.governor_villa.cost} Dn, 4×4) or Regia (Palace: ${BUILDINGS.governor_palace.cost} Dn, 5×5), under Government & Decor. It is kept by servants (${BUILDINGS.governor_house.workers}, ${BUILDINGS.governor_villa.workers} and ${BUILDINGS.governor_palace.workers} workers), so it needs a road like any building with workers, and makes the land around it very desirable as far as it is staffed (+${BUILDINGS.governor_house.des[0]}, +${BUILDINGS.governor_villa.des[0]}, +${BUILDINGS.governor_palace.des[0]} beside it). Only one may stand at a time: demolish it to build a bigger one. Rioters within ${CONFIG.RIOT_TARGET_RANGE} tiles go for it before anything else.`),
      ];
    }
    case 'military':
      return [
        h('p', {}, `Some provinces are raided by barbarian warbands, and raiders never come before the city has ${RAID_MIN_POP} people. Warbands grow as your city grows. You are warned three times (the ⚠ alert in the top bar shows from the first): about ${RUMOUR_MONTHS} months before a raid traders speak of a warband gathering beyond the frontier; about ${SCOUT_MONTHS} months before, scouts report its size and the side it will come from (or that it comes by sea, and where it will land); a month before, a last warning names its side (or its landing) again. A town that falls under ${RAID_MIN_POP} people by the scouts' report has its raid put off: the warband "drifted away".`),
        h('p', {}, 'The Empire map (E) shows the warband closing in: at the frontier while it is only rumoured, then from its side, with its size and the months left. Click it to look at the map edge it will enter by, where your towers and soldiers should wait. Clicking the first two warnings opens the Empire map on it; the last one takes you to the place (unless the ships found no shore).'),
        h('h4', {}, 'Recruiting'),
        chain('Tirocinium (Barracks)', 'recruit walks by road', 'Fort'),
        h('p', {}, 'A staffed Tirocinium trains a recruit every few days and sends him to the emptiest staffed fort: a Castra (Legion Fort), Praesidium (Archer Fort) or Castra Equitum (Cavalry Fort). Each fort holds 8 soldiers. A deployed fort takes no recruits until it is recalled (one already on his way still joins). Recruits need equipment at the Tirocinium, delivered by cart from workshops, ranches and warehouses (horses come from a ranch, or from the Emporium when imported):'),
        chain('Ferraria (Iron Mine)', 'Fabrica (Weaponsmith)', 'Tirocinium', 'Legionary'),
        chain('Silva Caedua (Timber Yard) + Ferraria', 'Officina Sagittaria (Fletcher)', 'Tirocinium', 'Archer'),
        chain('Equaria (Horse Ranch, meadow)', 'Tirocinium', 'Cavalryman'),
        h('p', {}, 'An Equaria starts with 2 breeding mares and gains one about every 30 staffed days, up to 8. Foals come faster as the herd grows, so build ranches early. The horses stay in the ranch\'s stables, 8 at most (a full ranch foals no more), until a Tirocinium needs them for cavalry: then a groom leads them straight there. Warehouses never keep horses. Horses can also be imported by trade, but only into a ranch with room.'),
        h('h4', {}, 'Soldiers and ships'),
        h('table', { class: 'tbl' }, Object.values(UNIT_TYPES).map((u) => h('tr', {}, h('td', {}, h('b', { style: { color: u.color } }, u.name)), h('td', { style: { fontSize: '12.5px' } }, `${u.desc}${u.upkeep ? ` Pay ${u.upkeep} Dn/month.` : ''}`)))),
        h('h4', {}, 'Orders'),
        h('p', {}, 'A garrison at rest holds its fort. Its men rest in the yard, inside the walls, where the wounded heal (full in a month; liburnians mend at their berths), and while enemies are in the province (or a wolf comes near) they stand to on its ground outside the walls. They fight only what comes to them (a legionary or cavalryman steps out to strike an enemy within about 2 tiles of the ranks and steps back; an archer shoots whatever comes in range of his post; anyone answers an enemy striking at him). To fight in the field, click a fort and press Deploy, then click the map (or press F with its panel open): the soldiers march there, hold that spot and fight raiders around it (about 1.5x their sight), at a gate, a bridge, the edge of town or on top of a warband. Their standard marks the spot: click it to open the fort, or drag it somewhere else to send them there. Recall brings them home.'),
        h('p', {}, 'Every fort has a number, as the legions had: Castra I, Praesidium II. A new fort takes the lowest number no other fort holds, so one built after a fort was torn down takes its number again. Shift+1 to Shift+9 glides to fort I to IX and opens it; pressed again, to its standard if it is deployed. The number shows in the fort\'s panel and over its standard.'),
        h('h4', {}, 'Training'),
        chain('Tirocinium', 'Campus (Military Academy)', 'Fort'),
        h('p', {}, `A Campus trains soldiers, but only while every one of its ${BUILDINGS.military_academy.workers} workers is in place. Each new recruit marches first to the academy nearest his fort and trains there ${CONFIG.ACADEMY_TRAIN_DAYS} days (counted only while it is fully staffed: one short of staff pauses him, for up to ${CONFIG.TRAIN_WAIT_MAX_DAYS} days), his place in the fort kept for him, then marches on, trained (the academy demolished meanwhile, he goes on untrained). Soldiers who joined untrained go too, ${atATime()} from each fort and never its last man, while the fort is at rest: not deployed, none of its men at a distant battle, no raid on or a month away and no enemy about. Each walks out of the gate to the academy, trains there the same days by the same rules, and walks back into the yard trained; a raid or a deployment brings him straight back, untrained if he had not finished, and a fort sent to a distant battle takes him along. A fort's panel shows how many of its men are trained, and who is at the academy. Trained legionaries standing their ground (at their post, or standing to fight) take a quarter of a missile's damage and +${UNIT_TYPES.legionary.holdDefense} defense (close order); trained archers and cavalry +${UNIT_TYPES.archer.trainedDefense} defense. Attack and health never change.`),
        h('h4', {}, 'Defenses'),
        h('p', {}, 'A Turris (Watchtower) shoots raiders (and wolves) within 8 tiles. A Murus (Wall) must be broken before raiders can pass; drag a wall across a road to build a Porta (Gate) that citizens can use but raiders cannot. Raiders take the cheapest way to your buildings, so a wall with a gap is just a detour.'),
        h('p', {}, 'Raiders burn or wreck what they reach, and a warband that is not driven off leaves with plunder from your treasury. Kill most of it and the survivors flee; repelling a raid raises Peace and the Emperor\'s favor.'),
        h('p', {}, 'Each military province is raided by a people of its own, named in every warning: Gauls with swordsmen and axemen, who make for the finest homes; Ligurian hillmen and slingers, after your food; Carthaginians with Numidian horse, javelin men, hoplites and the odd war elephant, who strike at your forts first; the Boii with war chariots; Lusitanians; the Cimbri and Teutones. A people sends as many men as weigh what any warband of that raid would, and breaks at its own losses (a Gaulish mob sooner than a drilled army). Its slingers and javelin men strike your people in the streets while you have fewer than 4 soldiers. The Military advisor describes your enemies; click a warrior to see his people and what the warband is after. The sandbox meets a mixed band unless its setup asks for the province\'s own people.'),
        h('h4', {}, 'Wolves'),
        h('p', {}, 'In the woods of the northern and hill provinces (and in a sandbox with Wolves ticked) live packs of 6 to 8 wolves. A pack keeps to open country at the city\'s edge, moving on every few days, but falls on anyone who walks near: cart pushers, caravans, settlers, service walkers (not prefects, who fight back). A walker dies in 4 bites on Normal (5 on Easy, 3 on Hard). Deploy a fort where a pack rests to clear it; towers and prefects fight wolves too. While one wolf lives the pack grows back, a wolf a month: kill them all. Wolves break no buildings and do not count as enemies in the province. Click a wolf to see its pack.'),
        h('p', {}, 'Urbs Magna and Puteoli schedule a gladiators\' revolt: for 3 months every gladiator who leaves his school turns on the city and wrecks what he reaches until soldiers or prefects put him down. With no gladiator school at work, nothing happens.'),
        h('p', {}, `Prefects on their rounds fight raiders, Caesar's legionaries, rebel gladiators and wolves who come within ${CONFIG.PREFECT_FIGHT_REACH} tiles, standing their ground until the enemy is more than ${CONFIG.PREFECT_FIGHT_LEASH} tiles off. A prefect hits about a third as hard as a legionary and usually loses: he slows a warband, he does not stop it. One killed is replaced only after his prefecture's usual delay, so the streets go unwatched for a while (the Military advisor counts prefects lost). His kills count toward the raid like a soldier's. A prefect running to a fire does not stop to fight.`),
        h('h4', {}, 'Raids by sea'),
        h('p', {}, `Where a river or the sea reaches the map edge, about ${Math.round(CONFIG.SEA_RAID_SHARE * 100)}% of raids come by ship (the Sea raids switch, on by default, in Settings and the sandbox setup). Scouts say so ("by sea, from the ..."), and the Empire map shows the warband in a longship. Raider ships sail in from the edge of the water, ${CONFIG.RAID_SHIP_CREW} raiders a ship, and put them ashore near the city, about ${CONFIG.LANDING_WALK} tiles' walk from the nearest home: from there they fight like any warband. The ships wait offshore and leave when the raid is over; fleeing raiders run back to them.`),
        h('p', {}, `At sea each raider ship throws up to ${CONFIG.RAID_SHIP_POTS} fire pots, one every 2 days, at anything within 5 tiles of it: a fishing boat sinks; a building by the shore takes ${CONFIG.RAID_SHIP_POT_DAMAGE} damage (more on harder levels) and ${CONFIG.RAID_SHIP_FIRE_HEAT} points of fire risk, which a passing prefect clears. A ship sunk before it lands drowns its raiders.`),
        h('h4', {}, 'The fleet'),
        chain('Timber + Iron + Linen', 'Navalia (Naval Dockyard)', 'liburnian rows by water', 'Statio (Naval Station)'),
        h('p', {}, `The Navalia, a naval dockyard on the shore, builds a liburnian from ${Object.entries(CONFIG.LIBURNIAN_COST).map(([g, n]) => `${n} ${GOODS[g].name.toLowerCase()}`).join(', ')} in ${CONFIG.NAVALIA_BUILD_DAYS} days at full staff. Carts bring the materials while a staffed Statio on its water has an empty berth, and each new ship rows to the emptiest one. A Statio berths a squadron of ${STATION_CAPACITY}.`),
        h('p', {}, `A squadron fights raider ships within ${CONFIG.STATION_GUARD} tiles of its berths: its marines shoot arrows, and it rams the ships it reaches. Click the station, press Deploy (or F) and click the water to send it elsewhere on its river or sea, or drag its flag over the water (it then guards ${CONFIG.STATION_GUARD_DEPLOYED} tiles around that spot); Recall brings it home. One liburnian beats one raider ship, but several raider ships together can sink it; the Navalia builds another. If a station is lost, its ships go to another station on the same water with an empty berth, and the rest are laid up.`),
        h('p', {}, `The Portus (Training Harbor: Colonia's own, after the harbor Agrippa cut near Naples to train his crews) is the fleet's academy: a training harbor on the shore of the stations' water, working only at full staff. A new liburnian rows to it first and moors there ${CONFIG.PORTUS_TRAIN_DAYS} days (only while it is fully staffed) before going to its berth; untrained ships at their berths take turns the same way, ${atATime()} from each station. A trained crew rows faster, rams harder (${UNIT_TYPES.liburnian.trainedRam} to ${UNIT_TYPES.liburnian.ram}) and is harder to hit.`),
        h('h4', {}, 'Caesar\'s legions'),
        h('p', {}, `If the Emperor's favor falls to ${CONFIG.LEGION_FAVOR} or less, Caesar warns you and sends his own legions: they march from Rome for 12 months (the Empire map shows them coming) and enter by the map entrance. Halfway, and again a month before they come, a reminder says what your favor at that moment would make them do. Nothing stops the march, but your favor when they arrive decides what they do: at ${DIFFICULTY.normal.legionHome} or more (on Normal; ${DIFFICULTY.easy.legionHome} on Easy, ${DIFFICULTY.hard.legionHome} on Hard, ${DIFFICULTY.insane.legionHome} on Insane) they march home; from ${DIFFICULTY.normal.legionHalt} (${DIFFICULTY.easy.legionHalt}, ${DIFFICULTY.hard.legionHalt}, ${DIFFICULTY.insane.legionHalt}) they halt where they stand during their first year; below that they attack: your residence first, then the finest homes, then anything, breaking through whatever stands in the way. Each attack is bigger than the last: ${CONFIG.LEGION_SIZES.join(', ')} imperial legionaries (fewer on Easy, more on Hard and Insane, never more than ${CONFIG.LEGION_MAX}), better armed than your own. Destroy them and Caesar respects your stand (+${CONFIG.LEGION_RESPECT} favor); an army that marches home earns nothing. Raids go on meanwhile.`),
        h('p', {}, `A mission is lost only when the city is overrun: more invaders (Caesar's men and raiders) in the province than your soldiers plus ${CONFIG.OVERRUN_MARGIN}, while fewer than a quarter of the most people your city ever had still live there.`),
        h('h4', {}, 'Distant battles'),
        h('p', {}, `In every mission with forts (Firmum at step 3, then the fourth mission on, never a peaceful province; and in the sandbox when raids are on, now and then from the third year, but only once you have soldiers in a staffed fort, or ships for a city by the sea) Caesar calls for troops: an enemy threatens a city of the empire, and the battle is fought ${CONFIG.BATTLE_MONTHS} months later (the Empire map shows the city, the enemy coming and your troops on their way). Switch forts to Empire service (a fort's panel or the Military advisor) and send them from the Imperial advisor: every soldier of those forts leaves at once, and their places at home are kept. For a city by the sea, naval stations (Stationes) switched on send their squadrons too, if your water reaches the sea.`),
        h('p', {}, `Their strength: a legionary counts ${UNIT_TYPES.legionary.strength} (${UNIT_TYPES.legionary.trainedStrength} trained at a Campus, the military academy), an archer or cavalryman ${UNIT_TYPES.archer.strength} (${UNIT_TYPES.archer.trainedStrength}), a liburnian ${UNIT_TYPES.liburnian.strength} (${UNIT_TYPES.liburnian.trainedStrength} with a trained crew). They need a few months to get there, by the length of their way on the Empire map from your province (at least ${CONFIG.BATTLE_MIN_MONTHS}); troops sent late march faster until they catch up with the enemy, but must be within ${CONFIG.BATTLE_IN_TIME} months of the city when the battle comes. At least as strong as the enemy: victory, +${CONFIG.BATTLE_FAVOR.won} favor and a triumphal arch, the troops losing a share of their men (the bigger their margin, the fewer) and coming home. Too weak: ${CONFIG.BATTLE_FAVOR.weak} favor and every man and ship sent is lost. Too late: ${CONFIG.BATTLE_FAVOR.late}, and they come home. Nobody sent: ${CONFIG.BATTLE_FAVOR.none}. A lost city stays in enemy hands for two years.`),
        h('p', {}, `Until the battle, a fort's men (or a station's ships) can be recalled: Recall from its panel or the Imperial advisor. Those still in the province turn at once; for the rest a rider carries the order at twice their pace, needing half the months they have marched (at least one), and they march on until he reaches them, then come home taking as long as they had marched out. Turned back, they no longer count in the battle. If everyone is recalled, it counts as nobody sent (${CONFIG.BATTLE_FAVOR.none}). A rider who reaches them only after the battle is too late: they fight. A fort or station that is deployed, or has men away, takes no recruits (no new liburnians) until it is recalled and its men are home; one already on his way still joins. Nor can a fort or station with men or ships away be cleared, demolished or undone until they are home; raiders who bring it down release them where they are.`),
        h('h4', {}, 'Triumphal arches'),
        h('p', {}, `Each distant battle won earns a Fornix (Triumphal Arch), free, under Government & Decor while one is there to build. It is 3×3 and goes across a straight road, which runs on under it: the road must cross its middle from side to side, with no other road under it. It makes the land around it very desirable (+${BUILDINGS.triumphal_arch.des[0]} beside it, fading over ${BUILDINGS.triumphal_arch.des[3]} tiles). An arch that is lost may be built again.`),
      ];
    case 'names':
      return [
        h('p', {}, 'Every building goes by its Latin name, as the colonists would have called it. The build menu, its tooltips and a building\'s panel show the English name with it; messages and advisors use the Latin. Clear Land is a tool and keeps its English name.'),
        h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, 'Latin'), h('th', {}, 'English')), nameRows()),
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

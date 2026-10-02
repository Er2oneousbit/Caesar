# Gameplay guide

The rules and numbers behind Colonia. Every number here comes from `src/config.js` or `src/data/*.js`; if you change those, update this page (the in-game Help tables are generated from the data automatically).

## Time

* A game day takes 2.5 seconds at 1x (8 simulation ticks a second, 20 a day); 16 days make a month (40 seconds), 3 months a season (2 minutes) and 12 months a year (8 minutes at 1x; it was 5.3 until v0.12.2, when seasons flew by). 2x, 4x and 8x run faster.
* Speeds: 1x, 2x, 4x, 8x. People walk 2 tiles a game day, 1.2 tiles a second at 1x; their legs step with the ground they cover, so they match at every speed and stand still while paused. Carts roll a little slower, soldiers march at their own pace (table under *Military*).

## Map sizes

Sandbox maps come in Small (64x64), Medium (96x96), Large (128x128) and **Uber (256x256)**: sixteen times the land of Small, room for a capital and its whole province. Settlers walk in from the map entrance (a stone gateway with green pennants where the Imperial road meets the map edge; the exit, where people leave, has red ones) to the home they picked; on a big map that can be far, so anyone with more than a 70-tile walk rides in on a mule, up to twice walking speed (a trot): trips up to 140 tiles take no longer than a 70-tile walk. Uber costs about the same per frame as Large (only the tiles on screen are drawn) and a year-old Uber city saves in about 300 KB.

**Around the Imperial road** a band of plain land at least 6 tiles wide each side (its edge wanders out to about 8) has no rock and no meadow. Rock can never be cleared and every city starts along the road, so outcrops there would wall off the first blocks; farm plots belong out in the fields, a short road away. Rock beyond the band stays for marble quarries and iron mines.

**Farm plots** (meadow, the yellow-green land farms need) come as whole fields: broad patches, most near water, with no field smaller than 12 tiles, so a 3x3 farm usually sits entirely on meadow at full fertility.

## Difficulty

Chosen in the Sandbox setup and in every campaign briefing (the menus remember your last choice). Each mission in the Campaign list shows the hardest level you have beaten it on. All levers live in `src/data/difficulty.js`:

| Lever | Easy | Normal | Hard | Insane |
|---|---|---|---|---|
| Starting funds | x1.5 | x1 | x0.6 | x0.4 |
| Fire and collapse risk | x0.5 | x1 | x1.3 | x1.5 |
| Farm, raw material and workshop speed | x1.15 | x1 | x0.9 | x0.8 |
| Farms grow in winter (December to Februarius) | yes | yes | yes | no |
| Caravans and ships in winter | as usual | as usual | as usual | half as many |
| Settlers per day | x1.25 | x1 | x0.85 | x0.7 |
| City mood | | | | -8 |
| Raiders per warband | x0.7 | x1 | x1.3 | x1.5 |
| Raider health, attack and siege damage | | | | x1.15 |
| Months until the first raid and between raids | | | | x0.75 |
| Size of the Emperor's requests | | | | x1.5 |
| Months between requests | | | | x0.7 (about 10-18) |
| Months to deliver a request | 12 | 12 | 12 | 9 |
| Bad days in a row before a home falls back a level | 6 | 3 | 3 | 3 |
| Daily chance an unhappy home breeds trouble (crime) | x0.5 | x1 | x1.2 | x1.4 |
| Disease risk, and its spread to the homes next door | x0.5 | x1 | x1.3 | x1.5 |

Insane is for veterans: staff the Excubitorium (Prefecture) and the Collegium Fabrum (Engineer's Post) first (labor priorities), because an unpatrolled building burns or collapses a third sooner than on Normal, and plan for roughly twice Normal's army. In winter nothing grows on any farm (crops, pigs, and the foals and herd of the Equaria, the horse ranch): fields keep their progress and grow again from Martius, workers stay on, and carts still haul the harvest already in store. Games start in Ianuarius, so the first harvest waits for spring; a message warns in October, and the city lives on its granaries (or imports) from December to Februarius. Size farms for about a third more than the city eats (a full Insane wheat farm grows about 576 units a year instead of 768) and keep roughly 0.75 units per citizen in store when winter comes. Winter also costs the Equaria about a quarter of the year's foals and mares, so start it early. The headless simulator shows how a level plays out: `npm run sim -- --difficulty insane --raids occasional --garrison`.

## Building names

Every building goes by its Latin name, as the colonists would have called it: messages, advisors, the panels and this guide use it. The build menu shows the English name under the Latin one, its tooltip and a building's panel title give both (*Castra (Legion Fort)*), and the in-game manual has this table under *Building names*. Clear Land is a tool, not a building, and keeps its English name. The names live in `src/data/buildings.js` (`name` and `en`); the type keys behind them, which saves and sprites use, never changed. Below, a building's English name follows its Latin one in brackets the first time it comes up in each section.

| Menu | Latin (English) |
|---|---|
| Housing | Area (Housing Plot) |
| Roads | Via (Road), Platea (Plaza), Pons (Bridge), Claustra (Roadblock) |
| Water | Aquaeductus (Aqueduct), Puteus (Well), Lacus (Fountain), Castellum Aquae (Reservoir) |
| Health | Tonstrina (Barber), Medicus (Physician), Balneae (Baths), Valetudinarium (Hospital) |
| Temples | Aedes Cereris, Neptuni, Mercurii, Martis, Veneris (Temple of Ceres, Neptune, Mercury, Mars, Venus); Templum Cereris, Neptuni, Mercurii, Martis, Veneris (Grand Temple of each); Oraculum (Oracle) |
| Education | Ludus Litterarius (School), Bibliotheca (Library), Academia (Academy) |
| Entertainment | Theatrum (Theater), Amphitheatrum (Amphitheater), Arena (Great Arena), Grex (Actor Troupe), Ludus Gladiatorius (Gladiator School), Vivarium (Menagerie), Circus (Hippodrome), Factio (Chariot Stable) |
| Government & Decor | Forum, Curia (Senate House), Praetorium (Governor's House), Praetorium Maius (Governor's Villa), Regia (Governor's Palace), Viridarium (Garden), Signum (Small Statue), Statua (Statue), Colossus (Grand Statue), Fornix (Triumphal Arch) |
| Engineering | Collegium Fabrum (Engineer's Post) |
| Security | Excubitorium (Prefecture) |
| Farms | Seges (Wheat Farm), Hortus (Vegetable Farm), Pomarium (Orchard), Hara (Pig Farm), Olivetum (Olive Grove), Vinea (Vineyard), Linarium (Flax Field), Piscatoria (Fishing Wharf), Equaria (Horse Ranch) |
| Industry | Cretifodina (Clay Pit), Silva Caedua (Timber Yard), Ferraria (Iron Mine), Lapicidina (Marble Quarry), Figlina (Potter), Officina Lignaria (Carpenter), Trapetum (Oil Press), Cella Vinaria (Winery), Fabrica (Weaponsmith), Officina Sagittaria (Fletcher), Textrinum (Linen Weaver), Taberna Vestiaria (Clothing Maker), Fabrica Navalis (Shipyard) |
| Storage & Markets | Macellum (Market), Granarium (Granary), Horreum (Warehouse), Emporium (Trade Dock) |
| Military | Murus (Wall), Porta (Gate, cut where a wall crosses a road), Tirocinium (Barracks), Campus (Military Academy), Castra (Legion Fort), Praesidium (Archer Fort), Castra Equitum (Cavalry Fort), Turris (Watchtower), Navalia (Naval Dockyard), Portus (Training Harbor), Statio (Naval Station) |

Where a message counts several of a kind it uses the Latin plural: *2 Figlinae are waiting for clay: build more Cretifodinae*. In plain description, as here, the English word may stand for the kind of building (a warehouse, the forts).

## Housing

A housing plot (Area) costs 10 Dn. Settlers arrive when the city mood is at least 30, the plot is within 2 tiles of a road, and that road connects to the map entrance. A home uses the nearest road that reaches the entrance, even when an unconnected street runs closer; other buildings use a road touching them, again preferring one that reaches the entrance, so a stray bit of road laid against a building never cuts it off from its workers and walkers.

**Road access, plainly.** Every building with workers must have a road touching one of its edges (wells, reservoirs, gardens, statues and the Oraculum (Oracle) need no road). The door's side does not matter: any edge touching a road works. A road that only meets a corner does not count. Homes take a road within 2 tiles, corners included. A building with no road gets no workers and does nothing at all, so the game makes it hard to miss:

* While you place it, the building is drawn in orange instead of green, the tiles along its edges where a road would serve it are picked out in yellow, and the warning shows by the cursor as well as in the sidebar.
* Once built, a red sign with a crossed-out road floats over it, at every zoom and under every overlay, until a road reaches it (also over a home with no road within 2 tiles).
* A building with workers that has had no road for 8 days says so once in a message (*The Excubitorium at 30,41 has no road touching it: it gets no workers and does nothing.*); click it to go there. Its panel and the Problems overlay say the same.

Homes follow the housing ladder of the original game: 20 levels, rebuilt with Colonia's own names and numbers (`src/data/housing.js`).

* **Moving up:** each day a home checks the next level. As soon as it has everything that level needs, and its desirability is at least its own level's `up`, it moves up at once. Never more than one level a day.
* **Falling back:** a bad day is desirability at or below the level's floor ("Bad at" below), or any need of its own level missing. After **3 bad days in a row** (6 on Easy) it drops one level; any other day resets the count. The info panel says how many days are left. Tents never fall back.
* **Residents over capacity** (after falling back, or moving up into a Villa, which holds far fewer people than an Insula) leave as homeless and look for room elsewhere, or leave the city if there is none.
* **Footprints:** levels 1-10 are single tiles, 11-14 are 2x2, 15-18 3x3 and 19-20 4x4. Reaching 11, 15 or 19, a home grows into the bigger square: it tries the square anchored on itself, then shifted up-left, left and up, and takes over homes of its level or lower first, then clear land, and gardens only as a last resort. A home only partly inside the square breaks into single-tile homes, and those left outside carry on (with no service visits yet). No room: the panel says so, and it tries again every day. Leave room, or build housing in bands 2, 3 or 4 deep.
* **Blocks:** four single-tile homes of the same level, side by side in a square, may join into one 2x2 block (vacant lots count as tents). It is still that level, holds four times the people, and is judged on its best tile. About one tile in three never starts a block (fixed per map), so streets keep some variety.
* **Splitting:** a 2x2, 3x3 or 4x4 home that falls below its footprint's levels keeps its top-left corner at the smaller size (or another corner, if only that one still has a road within 2 tiles); every other tile becomes an Apartment House. People and goods are shared by the tiles each part covers. A tile with no road within 2 tiles becomes a vacant lot, and its people look for another home.

| # | Level | Size | People | To reach it | Bad at | Tax |
|---|---|---|---|---|---|---|
| 1 | Tent | 1x1 | 5/tile | settlers | never | 1 |
| 2 | Family Tent | 1x1 | 7/tile | des -12, well | -14 | 1 |
| 3 | Lean-to | 1x1 | 9/tile | des -6, 1 food type | -9 | 1 |
| 4 | Hut | 1x1 | 11/tile | des -1, 1 god | -4 | 2 |
| 5 | Cottage | 1x1 | 13/tile | des 3, fountain | 0 | 2 |
| 6 | Stone Cottage | 1x1 | 14/tile | des 7, entertainment 10 | 4 | 2 |
| 7 | Townhouse | 1x1 | 16/tile | des 11, school or library | 8 | 3 |
| 8 | Merchant House | 1x1 | 17/tile | des 15, baths, pottery | 12 | 3 |
| 9 | Domus | 1x1 | 18/tile | des 19, entertainment 20 | 16 | 3 |
| 10 | Apartment House | 1x1 | 20/tile | des 23, medicus or hospital, furniture | 20 | 4 |
| 11 | Tenement | 2x2 | 80 | des 28, school and library, barber, oil, room to grow to 2x2 | 22 | 4 |
| 12 | Insula | 2x2 | 88 | des 34, 2 food types, entertainment 30, clothing | 31 | 5 |
| 13 | Villa ★ | 2x2 | 44 | des 40, 2 gods, wine | 37 | 8 |
| 14 | Garden Villa ★ | 2x2 | 48 | des 45, entertainment 40, medicus and hospital | 41 | 9 |
| 15 | Peristyle Villa ★ | 3x3 | 99 | des 49, entertainment 45, academy (with school and library), room to grow to 3x3 | 43 | 10 |
| 16 | Marble Villa ★ | 3x3 | 108 | des 53, 3 food types, 3 gods, entertainment 50 | 49 | 11 |
| 17 | Mansion ★ | 3x3 | 117 | des 57, entertainment 55, 2 wine sources | 53 | 12 |
| 18 | Palatium ★ | 3x3 | 126 | des 61, 4 gods, entertainment 60 | 57 | 13 |
| 19 | Grand Palatium ★ | 4x4 | 192 | des 66, entertainment 80, room to grow to 4x4 | 60 | 15 |
| 20 | Imperial Palatium ★ | 4x4 | 208 | des 72, entertainment 95 | 68 | 16 |

Needs add up: each level also needs everything the levels below it need. "To reach it" gives the desirability the level below needs to move up. "Bad at" is the floor for a home at that level. ★ Patricians (levels 13 and up) do not work, but pay much higher taxes, and never emigrate.

* **Food:** tents forage and need none. Others eat only as many kinds as their level needs (a quarter unit per person per month, shared between the kinds; when one runs short, the rest comes from other food in the house), and market vendors bring only those kinds, topped up to three months.
* **Goods** (pottery, furniture, oil, clothing, wine) are used up twice a month, and only the ones the level needs. When one runs out, the next day is a bad day. A home stocks a good already one level before it needs it (a Tenement buys clothing for the Insula).
* **Clothing** (Colonia's own, not in the original) is needed from the Insula up, villas and palaces included: the last level whose people work, so a city clothes its people before it builds villas. A city saved before version 10 loads with three months of clothing in its Tenements and better homes: time to build the chain (its first clothing takes about two months). After that, a home without it falls back a level after its bad days (3, 6 on Easy).
* **Wine sources** (levels 17 and up): a working (staffed) winery counts as one, and so does each open trade route that sells wine while wine is set to import.
* **Education** is a tier: a school or a library, then both, then both and an academy. An academy alone does nothing.
* **Health:** barber and baths are needs of their own; medical care is a medicus or a hospital (within 12 tiles), then both.
* **Desirability** is read on the best tile of the home. Humble homes (levels 1-6) are poor neighbors, levels 9 and up good ones, villas and palaces very good. Gardens, statues, temples and plazas lift a block; a big home's best tile is usually on its edge, so decorate around it. Palaces need plazas or large statues.

## Services (walkers)

Most services are delivered by walkers. A walker serves every building within **2 tiles** of each road tile it steps on, and a home remembers the visit for **96 days** (a tax collector's visit, 48). Roamers walk 22-30 tiles, prefer to go straight, avoid tiles they just walked, stay within about 13 tiles of their building, and prefer streets with something to serve: at a junction a roamer looks up to 8 tiles down each way (to the next junction, a dead end, or a roadblock that would stop it) and favors the ways with buildings along them over empty road such as the Imperial road out to the map edge; a way that reaches a building within those 8 tiles, like a short spur to a clay pit, counts in full. An outpost at the end of a longer empty road is visited less: give it a post of its own. Short loops of road around housing blocks are covered far better than long dead ends.

| Service | Building | Notes |
|---|---|---|
| Fire safety, police | Excubitorium (Prefecture, 6 workers) | Prefects reset fire risk and give homes 32 days of police cover (half the crime); they run to fires and douse everything within 4 tiles, and catch protesters, thieves and rioters (see Crime). On their rounds they fight raiders and Caesar's legionaries within 2 tiles (see Military: Prefects). At a junction a prefect is drawn to the way whose buildings are closest to burning, and the next prefect sets out as the last one turns for home |
| Collapse | Collegium Fabrum (Engineer's Post, 5) | Engineers reset collapse risk. Like prefects, they are drawn to the way whose buildings are closest to falling down, and the next sets out as the last turns for home |
| Religion | Aedes (temples, 2) | One per god: Ceres, Neptune, Mercury, Mars, Venus (see Gods) |
| Food & goods | Macellum (Market, 5) | Up to two vendors on the streets; the buyer restocks from granaries/warehouses |
| Education | Ludus Litterarius (School, 10), Bibliotheca (Library, 20), Academia (Academy, 30) | Tiers: school or library, both, both and an academy |
| Health | Tonstrina (Barber, 2), Medicus (Physician, 5), Balneae (Baths, 10, needs piped water), Valetudinarium (Hospital, 30, area 12 tiles) | Barber and baths are needs of their own; medicus and hospital make up medical care. All of them raise a home's health score; a physician passing clears its disease risk and cures the sick, and a medicus sends one to an outbreak (see Health and disease) |
| Entertainment | Theatrum (Theater) 10 pts, Amphitheatrum (Amphitheater) 15 (20 with plays and gladiators booked), Arena (Great Arena) 20 (30 with gladiators and beasts), Circus (Hippodrome) 30 | Each needs performers from a training building: Grex (Actor Troupe), Ludus Gladiatorius (Gladiator School), Vivarium (Menagerie), Factio (Chariot Stable) |
| Taxes | Forum (6), Curia (Senate House, 30) | Only visited homes pay tax |

**Roadblocks** (Claustra; Roads menu, 12 Dn) go on a road tile. Walkers roaming the streets turn back at one, so a building serves only the homes on its side; click a roadblock to let groups through (prefects and engineers, priests, market vendors, entertainers, teachers/librarians/scholars, barbers/physicians/bath attendants, tax collectors; none at first). Everyone heading somewhere passes: carts, market buyers, settlers, caravans, prefects running to a fire or chasing a criminal, physicians sent to the sick, and roamers walking home (who still serve homes along the way, as on any walk). Soldiers and raiders ignore roadblocks. Clearing one leaves its road.

**Inspecting walkers.** Click a walker for its panel: who it is, where it comes from, what it is doing and carrying, and what it says. Citizens mention the city's most pressing trouble (Caesar's legions first, then raiders, hunger, fire, sickness, troops away at a distant battle, unemployment over 12%, taxes more than 2 points over the default, wages under the fair wage, debt, an angry god, a mood under 35) or talk about their work; protesters say what upsets their home most; a walker keeps the same line for 8 days. *Follow* keeps the view on it until you move the map. A caravan or merchant ship also lists its business: on its way in, what it comes to buy and sell (the goods its city wants that you export, and those it sells that you import); a ship at the dock, what it still has to unload and to buy, what it bought and sold so far with the denarii each way, and its days at the dock; once it has traded, what it bought here and sold here, and the denarii each way. An Emporium's (Trade Dock's) panel shows its ship and how long it has been tied up, what is still to unload and to load (and how much of that is on a worker's cart), and its dock workers out.

A home's **entertainment score** is the points of every venue whose entertainer passed by recently, plus a city-wide base of up to 20: for each kind of venue, the share of the population its working venues can seat (theater 400, amphitheater 900, arena 2,000 people), averaged over the three kinds and divided by 5. A growing city needs more venues, not just one of each. A working hippodrome (staffed, races booked) seats the whole city: its 100% is added to the three kinds' sum, still divided by 3, so the base can reach 26 (up to 6 more for every home). The best score is 26 + 10 + 20 + 30 + 30 = 116; without a hippodrome it is 80.

**The Circus** (Hippodrome; Entertainment menu, mission 7 and the sandbox): 15 x 5 tiles, three 5 x 5 sections in a row along the map's x axis (you hold it by its middle tile), one per city, 900 Dn, 40 workers. A road beside any section serves it; clicking any section opens its panel, and demolishing any section takes the whole. Only the whole burns or collapses (one risk for it), and the rubble's Rebuild puts all of it back. A **Factio** (Chariot Stable: 3x3, 75 Dn, 10 workers) sends a team every 8 days at full staff when the hippodrome's races run low; each team books 32 days of races, so one maker keeps them going. While races run, the hippodrome sends its charioteer out every 8 days: he drives twice as fast and twice as far (52 tiles) as other entertainers and gives the homes he passes 30 points; its seats cover the whole city; and the prosperity target rises by 2. With no races it does nothing at all (in the original its charioteer drove without races; Colonia keeps its rule that a venue needs its shows). Placing one with no Factio in the city warns you. Rioters prize it just below villas and palatia.

**The top two homes need the hippodrome's help.** The Grand Palatium needs 80 entertainment and the Imperial Palatium 95 (they were 70 and 80): without a hippodrome the most a home can get is 80, every other venue at its best, so the Imperial Palatium needs one, as in the original. Measured on the level 3 demo city with every venue (river and lakes maps, 3 years): without a hippodrome no home scored 60; with one, 55 to 58% of homes scored 80 or more and 38 to 43% scored 95 or more.

Water is by area, not walkers: Puteus (Well) 2 tiles; Lacus (Fountain) 4 tiles (must be inside a full reservoir's 10-tile piped area); a Castellum Aquae (Reservoir) fills when it touches water or connects by aqueduct to a full reservoir. An Aquaeductus (Aqueduct) and a road cross only at right angles, each straight through the crossing tile: a road may not run along under an aqueduct, nor turn or branch under it, and an aqueduct may not turn over a road (roads already under aqueducts in an older city stay). While you place housing plots, a blue tint shows where homes would get water (pale for well water, a clear outlined blue for fountain water); while you place a fountain or baths, a faint teal shows the reservoirs' piped area, where they would run, and placing a fountain also shows the fountains' reach in outlined blue on top. Placing or clicking a well or fountain shows its own reach in dark blue, a reservoir its piped area in dark teal. Wells and reservoirs need no road. Wells, fountains and reservoirs never burn or collapse.

## Workers

* About **32%** of plebeian residents work.
* A building can hire only if occupied housing is within **40 road tiles**.
* Short of workers? Everyone gets the same share, except categories you mark as **priorities** in the Labor advisor, which are filled first in order.
* Efficiency = workers / needed. It scales production speed and how often walkers go out.

## Food and industry

* People eat **0.25 units per month** (a 100-unit load feeds 400 person-months).
* Farms must sit on meadow. Output scales with the share of meadow under the 3x3 field. With a farm (or any building placed on meadow) in hand, the meadow is tinted green-gold with a clear outline, also under snow. A full wheat farm makes 100 units every 20 days (about 80 a month, enough for ~300 people). Fields never catch fire or wear out (raiders and rioters can still destroy them). On Insane nothing grows in winter (December to Februarius; see [Difficulty](#difficulty)).
* Farm wagons haul up to 400 units, other carts up to 200; a producer can have 2 carts on the road.
* **Fish** is a food of its own: a fifth kind beside wheat, vegetables, fruit and meat (no home needs more than 3 kinds, so it never replaces a land food; it lets a city by the water skip a farm). Granaries take it; warehouses refuse it unless you order otherwise; markets sell it like any food, after the kinds a home already keeps. No trade partner deals in it yet.
* **Fishing** (from mission 4): a **Fabrica Navalis** (Shipyard: 2x2, 100 Dn, 10 workers, Industry) and a **Piscatoria** (Fishing Wharf: 2x2, 60 Dn, 6 workers, Food Production) stand on land on the bank of water with fish: a river, the sea or a lake of at least 80 tiles (not a pond). The wharf's water must have a fishing ground; gulls circle over each. Grounds are worked out from the map itself: 3 to 6 tiles out from the shore where the water allows (the widest spots of a narrow river), not by the map's edge, one per 150 tiles of water (1 to 10 on one water, 10 tiles apart; on the map at most 8 on a 96x96 map, more on a bigger one, up to 24; the biggest waters first; a lake left without one has no fish, like a pond). More than the original's 8 a map: a 128 coast now has about 10 and a river 4.
  * The shipyard builds a fishing boat from **100 timber** in 16 days at full staff (longer with fewer workers, and by the difficulty's production: 18 on Hard, 20 on Insane). The timber is Colonia's own rule: the original's shipyard needed no materials at all. The work goes on only while the yard holds the 100 timber (without it the boat on the slip waits where it is, nothing lost), and the timber is used when the boat is launched. Carts bring timber like a workshop's raw material: a Silva Caedua's (Timber Yard's) carts, dock wagons and warehouses holding timber send it to the nearest Officina Lignaria (Carpenter), Officina Sagittaria (Fletcher) or shipyard with room, before storage. The yard holds up to 200 (two boats). Its panel shows the timber against the 100 a boat needs, with loads on their way; when a wharf on its water waits for a boat and the yard has none, the panel says *Needs timber: build a Silva Caedua (Timber Yard) or buy timber.* (buying only where a partner of the mission sells it), the wharf says *Waiting for a boat: the shipyard has no timber*, and the Production advisor lists it with its hint. A yard that only lacks wood for its spare says so plainly, not as a trouble. Placing a shipyard where the city has no timber yard, no boat's worth of timber in store and no open route selling it warns first. Every mission with a shipyard has the timber yard and woods for it; Paestum and Portus Mercatorum have no partner selling timber, so there it must be felled. A city saved before version 17 loads with 100 timber in a yard that had a boat started, so that boat is launched on time, and none in the others. The boat waits on the water by the yard until the nearest staffed wharf on the same water without a boat needs it (nearest by water, not the first one built), then sails there and belongs to it. The yard keeps one spare boat and builds nothing more while it waits.
  * The wharf's boat waits at the wharf (1.02 - staffing) x 10 days (0.2 days at full staff, 5.2 at half, never with nobody at work, and not while the wharf holds 200 fish or more), sails at walking pace (2 tiles a day) to the nearest fishing ground by water, fishes 4 days (5 on Insane, by the production lever), comes back and lands 100 fish. The wharf carts them to a granary like a farm's harvest (up to 200 a cart). Where the wharf stands matters: measured on Normal (`npm run sim -- --type coast --fishing 2`, a level 2 town), a wharf 8 to 10 tiles from its ground made about 950 to 1,300 fish a year (a trip of 11 to 14 days), 15 tiles away about 650, 22 tiles 600, 30 tiles 400 and 60 tiles 200. A pig farm at full staff and fertility makes about 740 a year with 10 workers to the wharf's 6, so a wharf by its ground is the cheapest food there is, once the shipyard is paid for. Build wharves near the gulls.
  * Fishing goes on all year: the sea does not freeze, even in an Insane winter when the fields rest.
  * A demolished wharf's boat sinks with it, as does a demolished yard's spare; the yards build new ones. A boat that cannot find its way home is lost with its catch, with a message at most once a month. Neptune's wrath sinks every fishing boat; replacing them takes 100 timber each. Raider ships throw fire pots at boats within 5 tiles (see [Raids by sea](#military)); raiders on land never attack boats.
* You can read a cart at a glance: it carries its good (sacks of wheat, crates of vegetables or fruit, baskets of olives or grapes, meat, flat baskets of silver fish, clay, logs, iron ingots, marble blocks, pots, pale amphorae of oil, dark amphorae of wine, tables and chairs, shields and spears, sheaves of arrows, bundles of flax, bolts of linen, folded clothes in every dye), piled 1 to 4 high for how full it is. A farm's wagon is longer and pulled by an ox; a storehouse's cart shows its load against the most its orders move (a warehouse's 400-unit Get load, a granary's 800), so a routine 100-unit lot reads a quarter full; only a farm's cart is a wagon. Horses are not carted: a drover leads them, one horse per 100 units. An empty cart on its way home shows its bare bed.
* Raw material goes to a workshop that needs it (timber to a shipyard too), else to a warehouse (which later ships it to workshops and shipyards that run low). Finished goods go to warehouses; markets fetch them for homes that need them.

| Chain | Placement rule |
|---|---|
| Cretifodina (Clay Pit) → Figlina (Potter) → Pottery | clay pit within 2 tiles of water |
| Silva Caedua (Timber Yard) → Officina Lignaria (Carpenter) → Furniture | within 2 tiles of woods: at least 4 tiles of forest (lone trees are not enough) |
| Olivetum (Olive Grove) → Trapetum (Oil Press) → Oil | grove on meadow |
| Vinea (Vineyard) → Cella Vinaria (Winery) → Wine | vineyard on meadow |
| Linarium (Flax Field) → Textrinum (Linen Weaver) → Taberna Vestiaria (Clothing Maker) → Clothing | flax field on meadow (its field turns blue as it flowers) |
| Ferraria (Iron Mine) → Fabrica (Weaponsmith) → Weapons | mine touching rocks (export good; legionaries need 50 each) |
| Silva Caedua + Ferraria → Officina Sagittaria (Fletcher) → Arrows | 100 timber + 50 iron per 100 arrows (archers need 50 each) |
| Equaria (Horse Ranch) → Horses | ranch on meadow (1 horse = 100 units; cavalry need 1 each); horses stay at the ranch, never in a warehouse |
| Lapicidina (Marble Quarry) → Marble | touching rocks (export good) |

Workshops follow a **recipe**: most use 100 units of one raw material per 100-unit batch; the Officina Sagittaria needs both timber and iron and waits until it has both.

**Cloth** (Colonia's own, not in the original; from mission 4, where the other workshops open): clothing takes two workshops. A **Linarium** (Flax Field: 3x3, 40 Dn, 10 workers, Industry labor, 100 flax every 24 days at full staff and fertility, resting in an Insane winter like every farm) feeds a **Textrinum** (Linen Weaver: 2x2, 45 Dn, 10 workers, 100 flax into 100 linen in 20 days), whose linen goes by cart straight to a **Taberna Vestiaria** (Clothing Maker: 2x2, 50 Dn, 10 workers, 100 linen into 100 clothing in 18 days). Linen counts as a raw material: carts take it to a Taberna Vestiaria first and warehouses send it on to one running low, like clay to a potter. Clothing goes to a warehouse, and markets fetch it for homes from the Tenement up. Thirty workers from field to tunic, against eighteen for furniture: the chain is work as well as goods. Tarraco and Alexandria sell linen, so a city without flax fields (a desert, say) can still sew; Capua and Corinthus buy clothing.

### Granary and warehouse orders

Click a granary or warehouse: each good (each food, in a granary) has an order button, and a click cycles it through three orders. Its panel also says what the orders are doing right now.

* **Accept** (the default): carts and traders may bring it here. New warehouses refuse food, which belongs in granaries; set a food to Accept to store it in a warehouse.
* **Refuse**: nothing brings it here: producer and dock carts, other storage's carts and caravan imports go elsewhere. Nobody taking it out cares: market buyers, exports and the Emperor still take a refused good.
* **Get**: deliveries come as for Accept, and the building's own cart also fetches the good from other storage on its roads.
  * A warehouse fetches while it holds 4 loads (400 units) or less and has room for 8, from another warehouse, while the others hold more than 4 loads between them. It brings up to 4 loads a trip and prefers nearer and fuller warehouses (each load stored there counts as 4 tiles of road), so Get keeps 5 to 8 loads; it does not fill the warehouse.
  * A granary fetches while it has room for a load: up to 8 loads (800 units) of one food, from the nearest granary (one with 400 units or less to give counts as twice as far), taking the food on Get that granary holds most of. It never takes the last 100 units of a food from the granaries on its roads.
  * A building on Get for a good is never a source of it, so two of them never pass a good back and forth.
* **Empty the granary / warehouse** (a switch): it takes nothing in, and its cart carries everything out, up to 200 units a trip, wherever any cart would take it: a barracks that needs it, a workshop that uses it, a granary, or other storage that accepts it. A good with nowhere to go stays (the panel names it) and the cart takes the next one. Get pauses while emptying. Market buyers, ships buying exports and the Emperor still take from it; caravans pass it by for another warehouse.
* A storage building sends **one cart at a time**, decided once a day: Empty, else Get, else (warehouses) its routine trips with weapons and arrows to a barracks and raw materials to workshops. Get and Empty need the building at least half staffed; taking deliveries needs only some staff. The room for a Get cart's load is held at home from the moment it leaves, so nothing is lost on the way back.
* The Emperor's requests take from storage not on Get first.

**Finding what is wrong.** The **Problems** overlay (top bar) raises a column over each home with a problem, the most urgent first: a sick home (pale green); a home already falling back a level (tall, colored by the first thing it lacks); a home in unrest (wine red: mood under 30, or it has already sent out a protester or thief; only where there is crime); and a home that cannot move up, colored by the first thing it lacks (water, food, temples, entertainment, education, health, goods, desirability, room to grow), unless it is already as good as the province allows (its next level needs a building or a trade partner the mission does not have); empty lots no settler can reach and buildings that do not work are red, buildings that work badly (understaffed, short of goods, nowhere to deliver) amber. Point at a column for the reason; a legend lists the colors. The **Production** advisor shows, for each good, what was made, used (eaten, worked up, built into boats and ships, used by homes, spent on recruits, sent to the Emperor), imported and exported last month and what the storehouses hold; lists the buildings that are not working, grouped by reason, with a *Show* button that goes to each in turn; and names the bottlenecks: workshops waiting for a raw material, and shipyards for timber (and what makes it or who sells it), buildings without workers, harvests with nowhere to go, goods used faster than they come in, homes short of food. The **Overview** tab charts population, treasury and mood month by month (up to 20 years).

## Money

* **Wages:** default 24 Dn per worker per year (Rome's fair wage). Paid monthly.
* **Taxes:** at the default 7% rate each resident pays `5 x the level's tax` Dn per year (a Hut resident 10, a Domus resident 15, an Insula resident 25, an Imperial Palatium resident 80; see the housing table). A town of Cottages with most of its people registered and working about pays its wages; Huts do not, and better homes bring a profit. The rate scales this linearly. Only homes a tax collector visited in the last 48 days pay; a home's panel says whether it is registered and for how many more days, or why not (no Forum, a Forum without workers, or no collector lately), and the Finance tab counts the homes that are not. A lone Forum's collector can spend whole rounds on streets nobody lives on, such as the Imperial road, and the registrations he left behind run out: a second Forum, or roadblocks at the ends of a block, keep collectors on your streets.
* **Tribute:** each year Rome takes half a denarius per citizen above 150. Paying raises favor; failing costs 10 favor.
* **Trade:** open a route once (Trade advisor), then a caravan comes every 32-56 days and a ship every 64-96 (about the original's pace; on Insane both come half as often in winter). Each good can be set to export (keep a reserve) or import (up to a target). Partners buy and sell limited amounts per year. See *Trade* below.
* **Army pay:** 2-3 Dn per soldier per month (ledger row "Army pay"). Raiders who get away carry off up to 15% of the treasury ("Lost to raiders").
* **The governor's salary** (Imperial advisor): paid at each month's end, after wages, taxes and army pay, from the treasury into your personal savings (ledger row "Governor's salary", counted as spending). It is not paid in a month the treasury cannot cover it, so it never puts the city in debt, and it stops once a mission is won. See *The governor* below.
* Construction needs money in the treasury; running wages into debt costs 3 favor a month, and nothing can be built until you are out of it.
* **Loans from Rome** (Finance advisor): Rome lends 2,000 Dn whenever no loan is being repaid, in debt or not, repaid automatically in equal monthly instalments over 24 months with interest over the whole term of 10% on Easy, 20% on Normal, 30% on Hard and 40% on Insane (2,200 to 2,800 Dn in all). Instalments are paid each month before wages, even from an empty treasury (the debt that follows costs favor from that month). The loan and its repayments have ledger lines of their own and do not count as profit or loss for prosperity; borrowed money pays tribute and the Emperor's requests like any other, at the loan's interest.

## Trade

| | Land route | Sea route |
|---|---|---|
| Who comes | a caravan (with a mule: plain bales on the way in, what it bought from you on the way out) | a merchant ship, sail striped in the partner's color |
| From | the Imperial road entrance | the map edge where the river/sea leaves the map |
| To | the nearest staffed warehouse on the road network that is not emptying | a free, staffed **Emporium** (Trade Dock) |
| Per visit | up to 800 units each way | up to 2,400 units each way |
| Imports go | straight into that warehouse, unless it refuses the good or is emptying | the dock's crane lands them on the quay (2,400 units), 400 every 3 days; dock workers cart them to where any cart would take them: a barracks that needs them, a workshop that uses them, a granary (food) or a warehouse that accepts them |
| Exports come from | that warehouse | staffed warehouses within 60 road tiles of the dock, fetched by dock workers, the nearest first (Refuse and Empty make no difference) |
| Paid | at once | imports as each lot lands on the quay, exports as each lot goes aboard |
| Stays | a moment | until both sides are done: about 18 days with storage 5 road tiles from the dock, 25 at 10, 38 at 15 (longer when the goods split into more wagons, or with fewer dock workers); 48 days at most |

* An **Emporium** (Trade Dock: 3x3, 10 workers, 120 Dn) must touch navigable water: water connected to the map edge through a body of at least 80 tiles. Rivers and coasts always qualify, big lakes touching the edge sometimes do, desert and plains maps usually do not. Ships sail under bridges.
* One ship ties up at a dock at a time, and waits there while it trades. When it ties up it settles what it will sell you (each import you set, up to its yearly quota and your import level, counting what other ships still have aboard and what dock workers are carting; the crane stops early if your stock reaches the level meanwhile) and what it wants to buy (each export, up to its quota and what you have above your export level in the warehouses its workers can reach in time); 2,400 units each way at most.
* **Dock workers**: an Emporium sends out 3 at 75% staff or more (8 of its 10 workers), 2 at 50% or more, 1 with any staff. Each carries up to 400 units of one good a trip (less to a workshop or barracks with room for less, which still come first). A free worker first takes a lot from the quay to storage, and from there goes straight on to a warehouse to fetch an export for the ship; when the quay is empty it fetches an export from the dock. Workers claim what they set out for, so several of them (of any dock) never take a good below your export level. A worker does not set out on a trip it cannot finish before the ship's 48 days are up.
* **The ship sails** when everything is unloaded (or nothing could land for a day: the quay is full, or the treasury empty) and everything it wants is aboard (or nothing more can be fetched), or after 48 days, or when its Emporium is demolished (at once) or loses its staff (at the Emporium's next daily check). A ship whose city bought its year's worth meanwhile (from another of its ships) wants no more. A ship with nothing to trade sails at once. Cargo still aboard is neither paid for nor counted; an export a worker brings back after the ship sailed stays on the quay as yours, and dock workers take it back to storage. A demolished Emporium's workers take their loads to storage. The trade log gets one entry a ship, when it sails.
* Busy harbors: a stay is 2 to 7 weeks, so a city with several sea partners needs 2 or 3 Emporia; a ship that finds every one taken waits offshore and tries again 6 days later, and while one waits the Emporium's panel and the Trade advisor say whose ships are waiting. Keep a warehouse near each.
* Horses are the exception everywhere above: they live at an Equaria (Horse Ranch), never in a warehouse, so the ranches stand in for the warehouses when horses are bought or sold, and with no ranch none can be imported (see **Horses stay at the ranch** under the military).
* Partners and routes (open cost in Dn):

| Partner | Route | Sells | Buys |
|---|---|---|---|
| Tarraco (500) | land | timber, olives, linen | wheat, pottery |
| Lugdunum (800) | land | iron, meat, arrows | oil, wine, fruit |
| Aquileia (600) | land | pottery, vegetables | clay, olives, meat |
| Capua (700) | land | wheat, wine | pottery, furniture, iron, clothing |
| Massilia (700) | sea | clay, wine | furniture, vegetables, pottery |
| Carthago (1000) | sea | fruit, grapes, furniture | weapons, marble, timber |
| Cirta (900) | sea | horses, fruit | weapons, pottery, oil |
| Corinthus (1200) | sea | marble, oil | wine, wheat, iron, arrows, clothing |
| Alexandria (1400) | sea | wheat, vegetables, linen | wine, oil, weapons, furniture |

**The Empire map** (E, the compass in the top bar, or the button under the Trade advisor's small map) shows the Mediterranean world from the Atlantic to Syria, each city where it really is: your province (the red star, on the Etruscan coast north of Rome), Rome, every partner of the scenario with its route (solid when open, faint and broken while closed, grey where ships cannot reach you), and who is on the way. Caravans keep to the roads (along the coast of Gaul from Tarraco, over the Alps from Lugdunum, through the Po valley from Aquileia, through Rome from Capua); ships keep to the sea lanes, those from Corinthus and Alexandria through the Strait of Messina.

* A caravan or ship sets out from its city 10 to 32 days before it arrives (longer the farther it comes along its route: Capua 10, Tarraco 14, Corinthus 21, Alexandria 32) and moves along its route in its city's color. The first one after you open a route sets out from its city that day and arrives 8 days later, so it never appears halfway along. Point at it (or tap it) for the days left: *Massilia ship: 6 days*. The side panel lists those on the way and those coming later (*sets out in 12 days*). A ship that found no free staffed Emporium comes back 6 days later, so it shows 6 days out again.
* A warband shows as a red banner from the first word of it, about 6 months before it strikes, closing in over those months. While it is only rumoured it stands at the frontier, north of the province, with no number (*Warband gathering beyond the frontier, in about 6 months*): its side and size are not known yet. Once the scouts have seen it (about 3 months out) it shows with its size, half way in from the side it will enter by: *Warband of 14 from the north, in 3 months*. Click it (or *Show the edge*) to close the map and look at the map edge it will come from. A warband coming by sea sails in a dark longship out on the sea (*Warband of 14 by sea from the north-east, in 3 months*), and *Show the landing* looks at the shore where the scouts expect it to land (corrected a month out if they will land elsewhere; *no landing found* if they can find none, and will come overland). A warning about a warband or Caesar's legions on the way opens this map with it picked out. Raiders already in the province show at your city; click them to look at them.
* Click a city (or its caravan or ship) for what it sells and buys, this year's amounts, and the button to open its route.

* Caesar's legions, once they set out (see *Caesar's legions*), show as a purple standard with an eagle on the road from Rome, with their number, over the 12 months of their march; in the province, beside it.
* A distant battle (see *Distant battles*) shows the threatened city as a small walled square (dark while the enemy holds it), the enemy's banner on its line of march toward it, and your troops' red standard with their strength on their way there and back. Click any of them for the Imperial advisor.

The map only reads the game: the game keeps running while it is open (pause with Space), and nothing on it changes trade, raids or wars.

## Military

**Raids.** Firmum, the military province of step 3, every province from step 4 on but the peaceful ones (Paestum and Beneventum), and sandboxes unless set to peaceful are raided. The first raid comes after about 8 years with occasional raids and 5 with frequent ones (campaign missions: 2 years in Firmum, 5 in Pons Aelius, 4 in Portus Mercatorum, 3.5 in mission 6 and 3 in mission 7), 25% sooner on Insane, and none while the city has fewer than 300 people. You are warned three times (⚠ in the top bar from the first), one message a month at most:

* **About 6 months ahead**, traders speak of a warband gathering beyond the frontier, with the months left, but not its size or side: nothing about it is fixed yet. A city under 300 people hears nothing.
* **About 3 months ahead**, scouts report its size and the side it will come from (*a warband of about 14 raiders gathering to the north, 3 months away*), or that it comes by sea and where it will land. If the city has fallen under 300 people by then, the raid is put off 6 months and, if anything had been said, *the warband has drifted away, for now*.
* **A month ahead**, a last warning names its side again (*a month away and will come in from the north*), or for a raid by sea where its ships make for the shore, looked for again then (*not where the scouts first thought* if that changed). If they can find no shore (the city built along it, or the *Sea raids* switch turned off), they come overland, from a side the scouts cannot tell yet.
* A raid dated inside a stage's lead (a short interval, a raid put off) skips the stages already past: the scouts' report comes straight away if it is 3 months off or less. The first two warnings open the Empire map on the warband when clicked; the last one takes you to the place (or, for ships that found no shore, to the Empire map). The arrival is as before.

The Empire map shows the warband closing in, its size, and the map edge it will enter by. A warband has about `base + population / 450 + raids so far` warriors (x0.7 Easy, x1.3 Hard, x1.5 Insane; 3 to 40; on Insane raiders also have 15% more health and attack, and come 25% sooner), with slingers once the city passes 700 people and horsemen past 1,200. Raiders spawn on a map edge that can reach your homes and head for the nearest buildings, which they wreck or burn. They flee when 70% of the band is dead, and give up after 80 days, 10 buildings destroyed, or being cut off; a band that reached the city takes plunder when it leaves.

Repelling a raid: +8 peace, +3 favor. Each building lost: -1 peace.

**Raids by sea** (not in the original, which had no war at sea; on by default, with a *Sea raids* switch in *Settings* and the sandbox setup). Where a river or the sea reaches the map edge (ships can sail it), about a third of raids come by ship: when the scouts see a raid coming, a roll decides, on a random stream of its own (the map seed and the raid's number), so the same city gets the same raids and a raid by land is exactly the raid it always was. Switched off, or on a map without such water, every raid comes by land. The scouts say so (*by sea, from the north-east ... will come ashore near 44, 14*).

* The warband comes in raider ships, 8 raiders a ship (at most 5 ships), sailing in one after another from the edge of the water where merchant ships come in (a little faster than a walker: about 1.8 tiles a day). They land on open shore by that water from which raiders can walk to a home, the walk to the nearest home as close to 6 tiles as there is (never under 3), put their raiders ashore and wait offshore. From the landing the raiders fight like any warband; the raid's 80 days count from the first landing, and ships that cannot put their raiders ashore within 60 days give up. When the raid is over the ships sail away; fleeing raiders run back to the landing and board, while one of their ships is afloat (else they run for the map edge).
* At sea each raider ship throws up to 10 fire pots, one every 2 days, at anything within 5 tiles: a fishing boat sinks (its shipyard builds another, from another 100 timber); a building takes 20 damage (x the difficulty's raider strength: 23 on Insane) and 25 points of fire risk if it can burn, which a passing prefect clears as always. Pots alone never let a raid carry off plunder. Ten pots are 200 damage: four huts, or half a dock. Watchtowers (Turres) and soldiers on land cannot reach ships.
* A ship sunk before it lands drowns the raiders aboard (they count as slain).

Measured (`npm run sim`-style script, the level 2 demo city on six coast maps with two wharves, a raid of 16 by sea on Normal): with no defense the raiders landed every time and the raid ended as an undefended land raid does (10 buildings lost, 960 Dn of plunder, about 12 pot hits and 1 fishing boat sunk); with a squadron of four at its berths four of six raids were sunk at sea (no building lost), and the two that landed came ashore out of the squadron's reach: where the station stands, and where you deploy it, matters.

**The fleet** (Pons Aelius, Portus Mercatorum and mission 7, which have raids and water from the sea, and the sandbox; Firmum is raided but its lakes do not reach the sea):

* A **Navalia** (Naval Dockyard: 3x3, 400 Dn, 12 workers, Military; on the bank of water ships can sail, like a dock) builds a **liburnian**, a light warship with two banks of oars and a bronze ram, from 300 timber, 100 iron and 100 linen, in 30 days at full staff. It works only while it holds those and a staffed Statio (Naval Station) on its water has an empty berth; carts bring the materials (up to 400 of each) only then, before any workshop, as they do weapons for a barracks, and warehouses send them over. Each new ship rows to the emptiest such station.
* A **Statio** (3x3, 500 Dn, 10 workers, Military; on the shore; 800 hp; never burns or decays, rioters spare it) berths a squadron of 4 on the water beside it. The squadron fights raider ships within 12 tiles of its berths and chases them 4 tiles farther. **Deploy** (station panel or Military advisor), then click the water, sends it anywhere on its own river or sea (the nearest water within 2 tiles of the click); it guards 8 tiles around that spot. **Recall** brings it home. A station lost (demolished or wrecked) sends its ships to another station on the same water with an empty berth; any left over are laid up and gone.
* Fighting: a liburnian (180 hp) shoots arrows (13 attack, every 1.5 days, range 4.5 tiles) and rams a ship it reaches (45 damage, every 3 days); it rows faster than a raider ship sails (2.4 tiles a day to 1.8). A raider ship has 140 hp (x the difficulty's raider strength) and shoots back (9 attack, range 5). One liburnian beats one raider ship; five raider ships sink one liburnian. Pay: 4 Dn a liburnian a month ("Army pay").
* The **Portus** (Training Harbor; Colonia's own, wherever the Navalia is: Pons Aelius, Portus Mercatorum, mission 7 and the sandbox): the fleet's academy, after the harbor Agrippa cut near Naples to train his crews (Rome's first war fleet, in 260 BC, learned to row on benches on dry land while its ships were built). 3x3, 600 Dn, 12 workers (Military), desirability -4; on the shore of water ships can sail, the Navalia's rule. It trains only at full staff, and only crews of stations on its own water. A new liburnian rows first to the berth of the Portus nearest its station and **moors there 8 days** (counted only while the Portus is fully staffed; kept waiting more than 32 days, it rows on untrained), then rows to its berth, trained; the station's panel and the Portus's show who is in training and the days left; ships already at their berths stay there, as soldiers at rest do. A raid or a deployment calls a new ship on its way (or moored there, training) straight to its station, untrained, and one launched during a raid goes straight there. A trained crew rows faster (2.7 tiles a day to 2.4), rams harder (55 to 45) and is harder to hit (+3 defense). In a distant battle a liburnian counts 4, trained 6. The station's panel shows "3 of 4 trained".
* Click a liburnian or a raider ship for its panel: its hull, what it is doing, its station, whether its crew is trained (or the raiders and fire pots aboard). The Military advisor has a *Fleet* card (liburnians, at sea, pay, raider ships sunk, raids by sea) and the stations with Deploy and Recall.

**Recruiting.** A staffed Tirocinium (Barracks) trains one recruit every 8 days (at full staff) and sends him by road to the emptiest staffed fort. Each fort holds 8 soldiers. Equipment is delivered to the Tirocinium by cart only while forts have empty places:

| Soldier | Fort | Needs | HP | Attack | Defense | Range | Speed (1x) | Pay |
|---|---|---|---|---|---|---|---|---|
| Legionary | Castra (Legion Fort, 300) | 50 weapons | 110 | 14 | 9 | melee | 0.9 tiles/s | 2 |
| Archer | Praesidium (Archer Fort, 220) | 50 arrows | 60 | 10 | 3 | 6.5 tiles | 0.9 | 2 |
| Cavalryman | Castra Equitum (Cavalry Fort, 350) | 1 horse | 120 | 15 | 6 | melee | 1.6 | 3 |

Pay is Dn per soldier per month, on top of the wages of the forts' and barracks' staff (8 and 10 workers). A full set of three forts with a barracks employs about 34 people, so size the army to the city: an army that takes the farmers leaves the city hungry (use labor priorities).

**Training: the Campus** (Military Academy; wherever there are forts: Firmum at step 3, then mission 4 on, the peaceful provinces aside). The original's academy: 3x3, 1,000 Dn, 20 workers (Military), desirability -3 (rings -3, -2, -1); it can burn and collapse. It trains only at **full staff**: 19 of 20 workers trains nobody.

* Every soldier is trained or not, for good; the fort panel shows "5 of 8 trained" and the Military advisor the whole army's count.
* A new recruit marches first to the fully staffed academy nearest **his fort** (the larger of the two axis distances between the buildings' middles; the nearest to the fort, not the barracks, so a recruit may cross the city and back), and **trains there 16 days** (a month) before he is trained: the days count only while the academy is fully staffed (one worker short pauses him, and he goes on where he stopped once it is staffed again; kept waiting more than 32 days in all, he gives up and goes on untrained), and his place in the fort is held for him meanwhile. Then, trained, he marches on to his fort. If the academy is demolished on the way or while he trains, he walks on untrained. The fort's panel and the academy's show who is in training and the days left; click the recruit for his own. The month costs a garrison time: in a script (the level 2 demo city on three maps, its three forts with a staffed Campus and military labor first), after 8 months the forts held 10, 13 and 12 soldiers, every one trained, with 2 more at the academy, where they held 13, 14 and 13 when training was instant. With no such academy (or no road joining barracks, academy and fort) he goes straight to the fort.
* Soldiers already in a fort are never sent to the academy: an undeployed fort holds its ground (see Orders), so a man who joined untrained stays so, and only the next recruits, passing the academy on their way, come trained.
* What it gives (Colonia has no morale, so the original's staying power and close order become numbers): a trained **legionary holding position** (standing his ground: still at his post, by the fort or where it was deployed, or standing to fight a raider in reach; not running after one or marching) has +4 defense and takes a quarter of every missile's damage (a sling stone that would do 3.5 does 0.5: the original's close order took 1 damage a missile); trained **archers and cavalry** +2 defense at all times. Attack and hit points never change. In a distant battle a soldier counts 2 (legionary) or 1 (auxiliary), one more trained (see Distant battles).

**Horse breeding.** An Equaria (Horse Ranch: 3x3 on meadow, 10 workers) starts with 2 breeding mares and gains one every 30 staffed days, up to 8. Foaling speed scales with the herd (a new ranch works at a quarter of a mature one's pace); at 8 mares on full meadow it produces a horse about every 30 days.

**Horses stay at the ranch.** No warehouse keeps horses (a warehouse has no order for them). A ranch's stables hold 8 horses; a full ranch foals no more until some leave, and its panel says so. While a fort has empty places for cavalry, a groom leads the horses the forts still need (up to 4 at a time) straight to a Tirocinium with room; otherwise they wait at the ranch. Horses can also be imported from Cirta: they go to a Tirocinium that needs them or to a staffed ranch with room. **Without a ranch no horses can be imported** (with horses on Import, the Trade advisor says so), and a ship brings no more than the staffed ranches have room for plus what the Tirocinia still need. Horses you sell are taken from the ranches: a caravan's from the ranches on its warehouse's roads, a ship's by dock workers from staffed ranches near the Emporium. The city's stock (trade levels, the Emperor's requests, the Production and Military advisors) counts the horses at the ranches. The Emperor asks for horses only while you have a ranch, in whole horses, and never more than your ranches' stables hold together.

Older saves: horses that were in a warehouse move to a ranch with room when the save loads; what no ranch has room for waits at its warehouse (its panel says so) until its cart can take it to a ranch with room or a Tirocinium that needs it.

**Orders.** As in the original, a fort that is not deployed **holds its ground**: its soldiers stand on their posts by the fort and fight only what comes to them. A legionary or cavalryman steps out to strike an enemy within about 2 tiles of the fort's ranks (any of its men's posts, so the men behind the front rank join in) and steps back, letting go of one that moves a tile beyond that; an archer shoots whatever comes in range of his post (6.5 tiles) and never walks out; and anyone answers an enemy striking at him (a slinger out of reach of the ranks) for as long as it does. The same holds against raiders by land or sea and against Caesar's legions. To fight in the field, **Deploy** (fort panel or Military advisor) plants a standard anywhere: the soldiers march there, hold that spot and go out to meet raiders within about 1.5x their sight of it (legion 12 tiles, archers 13.5, cavalry 18), chasing up to 4 tiles beyond that. **Recall** sends them home. If a fort is destroyed or demolished, its garrison disbands. Forts never burn or decay.

Measured (a script on six maps, the level 2 demo city with its three forts, one raid of 8 on Normal): forts left at rest killed 17 raiders in all and lost 9 men, but 3 of the 6 raids broke 10 buildings and won; deployed onto the warband as it came (what `npm run sim -- --garrison` now does), they killed 46, lost 29 men and 3 buildings, and repelled every raid. Before this change, when every fort charged anything within 14 to 26 tiles, it was 37 killed, 28 lost, 21 buildings and 5 of 6 repelled.

**Defenses.** Turres (watchtowers: 2x2, 6 workers) shoot one arrow about every 1.5 s at full staff at raiders within 8 tiles (12 damage). Walls (Murus: 12 Dn per tile, 220 hp) block raiders; dragging a wall across a road builds a gate (Porta: 40 Dn, 320 hp) that citizens use freely but raiders must break. Dragging a road through a wall cuts a gate. Raiders pick the cheapest way to your buildings, and breaking a wall counts as 14 extra tiles of walking, so close every gap. Damaged walls show cracks; buildings patch raid damage slowly once the fighting stops.

**Prefects** fight enemies who come close, as in the original. A prefect walking his rounds (on patrol or heading home; not one running to a fire, putting one out or chasing a criminal) stops when a raider or one of Caesar's legionaries on land is within 2 tiles, and fights him where he stands: 40 health, attack 5 (about a third of a legionary's 14), defense 2, a blow a day. He keeps standing his ground while the enemy is within 3 tiles, striking while it is within 2; once it is farther he goes back to his rounds (he never chases one). The enemy turns on him when no soldier is near, and usually wins: on Normal a raider kills a lone prefect in about 4 blows and takes about 14 of his 70 health in return. A prefect does not heal. One killed is gone: his prefecture sends the next only after its usual 3 days (longer when short-staffed), so the streets go unwatched meanwhile, and the Military advisor counts *prefects lost*. A message comes only when two or more fall within 10 days and 12 tiles of each other. His kills count toward the raid's slain (or the legion's) like a soldier's. Raiders still aboard their ships are out of his reach, as is an enemy across water, a wall or a building. He lets a fleeing warband go, and leaves Caesar's men alone while they wait their turn at the entrance, march home or stand halted (so a halted army is not provoked into cutting down one prefect after another). Fires come first: a prefect sent to a fire leaves the fight. Click a fighting prefect and his panel says *Fighting a raider* and shows his health. Measured (the level 2 demo city with 4 prefectures and no soldiers, 10 raiders, three maps, Normal and Insane): the raid still ended with 10 buildings lost every time, with 0 to 2 prefects killed; prefects slow a warband, they do not stop it.

### Caesar's legions

The original's teeth for a governor out of favor (and the reason favor 0 no longer recalls you).

* **The warning.** Checked every day: with favor at **10 or less** and no attack already coming or in the province, Caesar sends his legions, and says so every time (the original warned only the first time). They march from Rome for **12 months** (the Empire map shows them, the top bar shows *⚠ Legions*). Two reminders follow: **halfway** (6 months out, which opens the Empire map when clicked) and **a month away** (which takes you to the map entrance), each saying what your favor at that moment would make them do on arrival, with the bands that would change it (*At your favor now (8) they would attack; from 18 they would halt, from 24 turn for home*). Nothing calls the march off: favor won back meanwhile only decides what they do when they come.
* **The army.** Imperial legionaries (110 health as your legionary, attack 18 against his 14, defense 11 against 9: the original's proportions), entering at the map entrance in companies (a gate or wall on the entrance tile itself is torn down first): **16, 32, 48, then 72** for the first, second, third and every later attack in this city, x0.7 on Easy, x1.3 on Hard and x1.5 on Insane (Easy 11, 22, 34, 50; Hard 21, 42, 62, 75; Insane 24, 48, 72, 75), never more than 75. Insane's tougher raiders do not make them tougher.
* **Their targets.** Your residence first; with none, the homes of the best level that has people (the nearest of them); then anything. They go round the city where they can and break through buildings and walls where they must (a building in the way costs them as much as 20 tiles of walking). They fight soldiers who come close, and prefects who fight them (see Prefects above), and towers shoot them as they shoot raiders.
* **Favor decides, every day they are in the province** (the sane order; the original's bands were swapped):

  | Favor | Easy | Normal | Hard | Insane |
  |---|---|---|---|---|
  | They march home (for good) | 22+ | 24+ | 27+ | 30+ |
  | They halt where they stand (in their first year only) | 17-21 | 18-23 | 20-26 | 22-29 |
  | They attack | under 17 | under 18 | under 20 | under 22 |

  A halted army stands still but fights anyone who attacks it; after a year at your gates it attacks whatever the favor in that band. An army with nothing it can reach for 4 days goes home, and any army after two years in the province. A legionary leaves alone for 20 days a soldier he cannot get at (across water).
* **The end.** When the last imperial legionary is gone the attack is over. An army **destroyed** earns Caesar's respect: **+10 favor**. An army that marched home earns nothing (the original paid a retreat as a victory). The next day, favor still at 10 or less sends the next, bigger attack.
* Raids go on meanwhile: a warband and the legions can be in the province together, each counted apart. The danger music plays for both. Buildings they wreck cost peace as raiders' do.
* Console: `legion` sets them marching now, `legion now [n]` brings them at once.

### Distant battles

Caesar asks the province for troops to defend a city of the empire. In every mission with forts (never in a peaceful province): Ariminum in Firmum's year 2 (a small army of 12: one fort of legionaries is enough), Placentia in Pons Aelius, Saguntum in Portus Mercatorum, Ariminum in mission 6, Messana and later Placentia again in mission 7, each of these in its mission's year 3 (4 in mission 6, 9 for the second in mission 7), in a month from Martius to October drawn from the map's seed. In the **sandbox with raids on**, from the third year, each month brings a request with a chance of 1 in 36 (about one every three years), at least a year after the last one ended, for a city and an enemy strength (16 to 40) drawn from the map's seed, but only to a city with an army to send: a staffed fort with soldiers in it, or (for Saguntum or Messana only) a Statio (Naval Station) with ships and water to the sea. A city with no army is never asked, nor fined for not answering. A request that comes while another battle is still going on (or its city still lost) is dropped, as in the original. None of these cities trades with you.

* **The request.** *Caesar calls for troops: a large army of Carthage threatens Saguntum, and the battle will be fought in 24 months.* The enemy's strength is shown in words (a small army under 23, a large army under 45, a mighty host from 45) and as a number in the Imperial advisor.
* **Empire service.** Each fort and each Statio has an *Empire service* switch (its panel, the Military advisor, the Imperial advisor), off at first. The Imperial advisor's *Send the troops* button (once per battle, with a confirmation) sends **every** soldier of every fort switched on, and, when the city lies on a **sea route** (Saguntum, Messana) and your water reaches the sea, every liburnian of every station switched on (Colonia's own: the original's fleet had no part). Soldiers march out by the map exit, ships sail out by the sea entry; their places at home are kept (the barracks and the navalia do not fill them), and they are paid as usual.
* **Strength**, fixed when they are sent: a legionary 2 (3 trained at a Campus, the military academy), an archer or cavalryman 1 (2 trained), a liburnian 4 (6 with a trained crew). The original's enemy strengths are halved for Colonia's 8-man forts.
* **The march.** They need the length of their way on the empire map, at 4 map units a month, at least 3 months (Placentia and Ariminum 3, Messana 5, Saguntum 7). Each month they come a month nearer, and one more while they are farther off than the enemy is from the city (troops sent late catch up), never nearer than a month (there, they wait). The enemy waits at its gathering place until its own march (6 to 8 months) must begin, and reaches the city in the battle's month. The Imperial advisor says whether troops sent now would come in time.
* **The battle**, in its month, in this order: nobody sent: lost, **-50 favor**; troops more than 2 months away: lost, too late, **-25**, and they come home unharmed; their strength under the enemy's: lost, too weak, **-10**, and every man and ship sent is lost; otherwise **won: +25 favor and a triumphal arch** to build. A win costs each fort and station sent a share of its men by the margin `100 x (yours - enemy) / yours`: under 10, 70%; 10-24, 50%; 25-49, 25%; 50-74, 15%; 75 and up, 10% (the original's 5% and 0% rows could never be reached; a tie is a win). Survivors come home after as many months as they covered and walk (or sail) back to their posts; one whose fort or station is gone disbands. A lost city is in enemy hands for 24 months (after any troops are home), then retaken.
* Console: `battle [city] [n]` asks for troops now, `battle now` fights the pending battle now.

### Triumphal arches

Each distant battle won earns one **Fornix** (Triumphal Arch; Government & Decor, shown there only while one is there to build, *Free (1)*): 3x3, free, no workers, never burns or decays (Caesar's legions and raiders can wreck it, 1,200 health). It is built **across a straight road**: the road must run through its middle row or column from side to side, plain road (not a plaza, bridge or the Imperial road's entrance) with no roadblock, and its other six tiles must be open land with no road (so not over a junction or a road two wide). The road runs on under it and walkers pass as before (soldiers and raiders go round it). Desirability +18 beside it, in rings of 18, 18, 15, 15, 12 (the falling reading of the original's numbers). An arch that is lost (demolished or destroyed) may be built again; its road stays clear (rubble falls only either side of it).

## Saving

Games are stored in the browser's localStorage under `colonia.save.<slot>`: `auto` (every 3 months and whenever the page is hidden or closed), `quick` (F5 / F9) and `slot1`-`slot5`. Map layers are run-length compressed and walker paths packed, so a year-old small city saves in about 120 KB and a year-old Uber city in about 300 KB; most of a big save is its buildings (about 0.8 KB each). Browsers usually allow about 5 MB per site, so a handful of big-city saves can fill it. The Save/Load menus show each save's size and the total in use. Saves are tied to that browser and site: for backups, the 💾 beside each save in the Save and Load menus downloads that save as a file without loading it (exactly as stored, named like `colonia-slot1-aquae-clarae-279bc.json`), *Export current game* downloads the game being played, and *Copy save data* copies it as text. The save format is versioned (currently 17: shipyards hold timber, and an older save loads with 100 timber in a yard that had a boat started and none in the others; version 15 was the staged raid warnings and the legions' reminders; version 14 and older saves load with each warning whose moment has passed counted as given, so none comes late or twice; version 14 was Caesar's legions, distant battles, the forts' and stations' Empire service switch and triumphal arches; version 13 and older saves load with no legions coming, no battle, no arch earned, every switch off and the population peak (for the overrun rule) starting again from the population they have, and a city that was at favor 0 goes on (the legions set out the next day); version 13 was the governor; version 12 was training at the Military Academy and the Portus, and large temples: version 11 saves load with every soldier, ship and recruit untrained and nobody on the way to be trained; version 11 was sea raids and the fleet: version 10 saves load with no fleet and the Sea raids switch on, and a raid the scouts already saw comes by land as it would have; version 10 was the cloth industry: version 9 saves load with no flax, linen or clothing in store, their Tenements and better homes with three months of clothing; version 8 saves load without fish or a hippodrome; version 7 brought granary and warehouse orders, rubble that remembers what fell, and the original's five gods; version 6 saves still load, each good a storehouse accepted on Accept and the rest on Refuse, nothing emptying, old rubble without its story, and Jupiter's temples, mood, priests and every home's access to him becoming Mercury's, and Vesta's Venus's; version 5 saves load with nobody sick and city health at 50, and version 4 saves too, their homes also starting at the city's mood). Until version 1.0 a release may change it: saves from before v0.7 (the 20-level housing ladder) cannot be loaded, and say so.

## City mood (sentiment)

Starts from 50 and is recalculated monthly (moving halfway toward the new value):

| Factor | Effect |
|---|---|
| Tax rate | -3 per point above 7%, +1.5 per point below |
| Wages | +0.8 per Dn above 24, -0.8 below |
| Unemployment | -60 x (rate - 10%), max -15 |
| Hunger | up to -18 when nobody has food |
| Housing quality | -4 to +10 by average level (+10 at an average of Apartment Houses) |
| Gods | -8 to +6 by average mood |
| Festivals | temporary boost |
| New city | +20 for the first year |
| Difficulty | -8 on Insane |

The top bar shows the mood (🙂) and, beside it, unemployment (⚒): the share of the workforce with no job. It turns amber above 10%, where it starts to cost mood; its tooltip says how much, and a click opens the Labor advisor. More workplaces, or fewer new homes, bring it down.

Mood 30+ brings settlers; below 25 people start leaving.

## Home mood and crime

Every household also has a **mood** of its own (0-100, the house panel's *Mood and order*), used for crime only: settlers and emigrants still follow the city's mood. Twice a month (the 1st and the 9th) each home moves at most 3 points toward a target:

| Term | Effect |
|---|---|
| City mood | the starting point |
| Hunger | -5, -10, then -15 for each update in a row that a home which eats went without at its meal and still has no food (tents forage) |
| Food variety | +3 per kind of food beyond what its level needs, at most +6 |
| Envy | tents, lean-tos and huts: -8 in a city with villas or palatia, -5 with insulae (level 11+) but no villas |
| Desirability | its street's desirability / 5, from -5 to +5 |
| Untaxed | +3 while no tax collector has registered it |

A new household starts at the city's mood. The panel and the crime overlay name the home's worst trouble, or else the city's worst mood factor.

**The daily roll.** Once the city has 300 people (never in the first two campaign missions), each day one unhappy home may breed trouble: the one with the lowest mood among homes below 50 that still can (a home at 50 or more settles down and can start again). The chance is 61% x (1 - city mood / 108) a day (61% at mood 0, 44% at 30, 27% at 60, 5% at 100), times the difficulty's crime lever, and halved when a prefect passed that home in the last 32 days. What happens is the worst the home can do:

* **Protester** (mood under 50, once per unhappy spell): stands in the street by the home for about four days. Harmless: it costs no peace, except on Insane, where every fifth protest costs 1.
* **Thief** (mood under 35, once): walks to the nearest staffed Forum or Curia (Senate House; within 50 road tiles) and steals a quarter of this year's taxes there, at most 400 Dn and never more than the treasury holds (nothing under 5), shown as *Stolen by thieves* in the Finance ledger; with no Forum or Curia in reach he takes half the biggest stock of the nearest stocked market (at most 100). A prefect or soldier who catches him on the way saves it all.
* **Riot** (mood 15 or less while the city's mood is under 30, with a road within 4 tiles): the rioters set their own home alight (its people become homeless), and a mob of 1 to 6 (by population: up to 150, 300, 800, 1,200, 2,000 people, more) marches across country on the most prized building within 40 tiles (the governor's residence, the Curia, then villas and palatia, an arena, a hospital, venues, schools, baths, the Forum, a medicus, temples, workshops, the granary, markets, insulae...), or with none that close the nearest such building it can walk to, setting alight each building it passes (not warehouses, forts, towers, wells, fountains, reservoirs, statues or gardens, nor homes of level 6 or below) and resting by the flames about three days. Rioters leave after 16 days, or when nothing they can reach is left to burn. A riot costs peace at once (see *Peace* below), but the anger is spent: every home's mood rises by 20.

**Catching criminals.** A prefect (not one fighting a fire or a raider) or a soldier beside a criminal holds him until he gives up: about 15 ticks for a prefect, 6 for a soldier. Every 10 ticks a prefect on patrol also looks for a thief or rioter within 30 tiles that nobody chases yet and runs after him (across fields if need be); after the catch he goes home. One he cannot reach (across a river) he leaves alone for 8 days and keeps on his patrol. Fires come first: a prefect sent to a fire drops the chase.

**The crime overlay** (top bar) raises a column over each occupied home by its mood, taller and redder for more crime (0: 10, 1-10: 8, 11-20: 6, 21-30: 4, 31-40: 2, 41-49: 1, 50+: none); a home that has already sent out a protester or thief stands at 8 or more. Excubitoria (prefectures), prefects and criminals stay in view; point at a home for its mood, its trouble and whether a prefect patrols it.

## Health and disease

Every occupied home has a **health score** (0-100, the house panel's *Health* section), from what it has:

| Part | Points |
|---|---|
| Its level | its number, up to 10 |
| Health care | a medicus visit and a hospital within 12 tiles 50, a hospital alone 40, a medicus alone 30 |
| Baths / barber | 15 / 10 |
| Fountain water | 10 (a well does not count) |
| Food | 10 for each kind in the pantry |

At most 100, and at most 40 for a home whose level eats and that has no food at all. For example a Domus (level 9) with a medicus, baths, a barber, a fountain and two kinds of food scores 9 + 30 + 15 + 10 + 10 + 20 = 94.

**Disease risk** builds like fire risk, on each occupied home every day: 0.2 x (100 - score) / 100 x crowding x the difficulty's disease lever, give or take 40%, where crowding is 0.5 + residents / 40 (at most 2), and half that within a staffed hospital's reach. A physician passing within 2 tiles clears it. A crowded home of 40 scoring 20 that no physician visits reaches 100 in about 10 months on Normal; a home scoring 80 would take over three years, and has a medicus anyway. From 100 a home has a 25% chance a day to **fall sick**. There is no disease while the city has under 200 people, nor in the first two campaign missions.

**A sick home.** When it falls sick a fifth of its residents die (a tenth within a hospital's reach), at least one; a home left empty becomes a vacant lot. The rest are sick for 32 days: the home cannot move up and takes in no settlers, and each day every occupied home touching it gains 0.3 disease risk and has a 0.3% chance to fall sick too (times the lever, halved within a hospital's reach), once a day however many sick homes it touches. A physician who passes cures it at once. A staffed Medicus (Physician) within 24 road tiles sends one, the way prefectures send prefects to fires (a physician already on his rounds nearby is called over first); he stays a day, then sees to the next sick home nearby or goes back. Otherwise the home recovers by itself when its days run out. The first outbreak of a month has a message of its own; the month's others are summed up in one message at the start of the next.

**City health** moves 2 points a month toward the residents' average score (weighted by residents). It stays at 50 while the city has under 200 people. It is shown (the Health advisor and the Overview), not a rating: it feeds no rating and not migration.

**The Disease overlay** (top bar) raises a column over each occupied home by its disease risk, like the fire overlay, and a pale green one at full height over each sick home. Medici, hospitals, baths and barbers stay in view, with their walkers; point at a home for its score, what lowers it (no medicus, no baths, well water only, no food...), its risk and the days its sickness has left. Citizens talk about it when a home is sick. Keeping a physician passing every street is the cure: in the balance sim's demo city, whose one Medicus covers most of its homes, an outbreak comes about once in five years on Normal (and hardly ever on Easy), while its basic version, with wells and no medicus, barber or baths, has over a hundred in three years. The **Health** overlay shows which homes a barber, a medicus and the baths reach.

## Health, Education and Entertainment advisors

Three advisor tabs (F2) show how well the city's services cover its people. Each lists every kind of building with how many are **staffed** of those built (Balneae without piped water are counted apart), its **reach** (the residents of homes one of its walkers visited in the last 96 days; for a hospital, the homes within 12 tiles while it is staffed; also as a share of everyone) and the **homes' needs** it meets: of the people whose homes need it for their next level (their own, at the top), how many have it. A home that needs only "a medicus or a hospital" is served by either, and one that needs only "a school or a library" likewise. Click a building's name to go to each of them in turn.

Coverage is a truncated percentage (100 means everyone) in one of twelve words: None (0%), Almost none (1-9%), Very poor (10-19%), Poor (20-29%), Weak (30-39%), Patchy (40-49%), About half (50-59%), Fair (60-69%), Good (70-79%), Very good (80-89%), Nearly full (90-99%), Full (100%). Colonia's coverage is not the original's places per building: here a school or a medicus serves every home its walker passes, however many, so the advisors count the people actually reached. Venues are the exception: their seats (theater 400, amphitheater 900, arena 2,000; the original had 500, 800 and 1,500) set the city-wide entertainment base, and the Entertainment advisor shows them.

* **Health:** city health out of 100 with a verdict by tens (red below 40; "too small to judge" under 200 people) and whether it is rising or falling toward last month's average; sick homes now (with *Show*), and outbreaks, deaths and cures this year and last; the Medicus (Physician), Valetudinarium (Hospital), Balneae (Baths) and Tonstrina (Barber) rows. Advice: the health building that holds the most homes back (from their next level, or from keeping their own; a tie goes to the baths, then the barber, then the medicus, then the hospital), saying whether none is built, none works, or more are needed; else, where there is disease and a tenth or more of the people have no medicus or hospital near, that their homes fall sick more often; else a need no building of the province can meet ("this province has no Valetudinarium to build"); else that health care meets every home's needs.
* **Education:** the Ludus Litterarius (School), Bibliotheca (Library) and Academia (Academy) rows and the kind that serves the smallest share of those who need it. Advice: the building that holds the most homes back (academies counted too; ties go to the school, then the library), saying whether none is built, none works, or more are needed; else that no home needs schooling yet (Townhouses and up do); else a need the province cannot meet; else that every home that needs schooling has it.
* **Entertainment:** the city-wide base every home gets (0 to 20) and the seats behind it; per venue kind the staffed venues, the kinds of show booked of those they can stage (a theater plays; an amphitheater plays and bouts; an arena bouts and beasts), the seats of venues with shows as a share of the population, and the people reached; the training buildings and whom they supply; homes short of their next level's entertainment, and how many get no entertainer's visit at all; when the next festival can be held (the button goes to the Religion advisor). Advice, in the original's order: if more short homes get no entertainer's visit than get one, build venues among them (and, since a venue without shows sends no entertainer, which venues lack performers); if no home is short, all is well (or no home needs entertainment yet: Stone Cottages and up do); else the venue kind most in need of performers (each kind of show a staffed venue lacks weighs 1 at a theater, 2 at an amphitheater, 3 at an arena, counting only performers the province can train), with the kinds of show they lack and who trains the performers; else build more venues. The base and the coverage words are the day's count, what homes get until the next day.

The **Overview** shows city health (click it for the Health advisor) and crime at a glance: rioters, thieves or protesters on the streets now, worst first, or none (or no crime in a town under 300 people, or in the first two campaign missions).

## Fire and collapse

Every building gains fire and collapse risk daily at its own rates (homes by level), at the original's pace (x0.62 of the listed rates since v0.12.2: an ordinary building left unserved on Normal burns or falls in about 10 months), x0.5 Easy, x1.3 Hard, x1.5 Insane. At 100 there is a 25% chance per day of disaster. A burning ruin burns for 6 days and can spread: each building beside the flames gains 5 fire risk a day and has a 2% chance a day to catch, once a day however many burning tiles it touches. An unguarded fire in a dense block usually takes a handful of homes; a prefect on the way usually stops it at one or two. Prefects within 24 road tiles are dispatched automatically.

Left with no prefect or engineer passing, an ordinary building reaches 100 in about 100 days on Normal, for fire and collapse alike:

* **As likely to burn as to collapse:** workshops (potter, carpenter, oil press, winery, weaponsmith, fletcher), the timber yard, and every other building not named below: markets, granaries, health, education and entertainment buildings, the Forum and Curia, barracks; and Domus and Apartment Houses. Docks burn a little sooner.
* **Burn first:** homes from Tent to Merchant House (Tents and Family Tents never collapse).
* **Collapse first:** temples, the clay pit, iron mine and marble quarry, Tenements and up. The Excubitorium (Prefecture), Oraculum (Oracle) and Turris (Watchtower) cannot burn at all.
* **Never burn or collapse:** warehouses, the Collegium Fabrum (Engineer's Post), wells, fountains, reservoirs, farms and the Equaria (Horse Ranch), gardens, statues and forts. Only raiders, rioters and an angered Mercury (who burns the fullest granary or warehouse) can destroy them (rioters set fire to farms and engineer's posts, never to warehouses, water works or forts). They never catch from a fire next door either; their panel says so, and the Fire risk and Collapse risk overlays raise no column over them.

Rubble remembers what stood there. Click it: *Ruins of an Excubitorium, burned down in Iul 280 BC.* (Rubble that fell before the buildings had their Latin names keeps the English one it recorded.) The causes are burned down, burned by an angry god, burned by raiders, burned by rioters, collapsed, torn down by raiders, and (for a wall) broken down by raiders. Every tile of a fallen building keeps the record until it is cleared or built over. Its panel has a **Rebuild** button that puts the same building back on the same spot (a home's plots come back as empty lots, a broken wall as wall) at the usual price plus clearing the rubble; it is greyed out with the reason while the ruins still burn, or when there is no money or something now stands in the way, and Undo takes it back like any building. Rubble in a save made by an older version of the game says only *Rubble from a disaster*. (Ruins from before v0.12.2 know what fell but not where it stood exactly, so they offer no Rebuild.)

## Gods

The original's five gods: Ceres, Neptune, Mercury, Mars and Venus. Every temple (Aedes Cereris, Aedes Neptuni and so on) is the same but for its god (50 Dn, 2 workers, a priest every 4 days); the first mission has Ceres and Mercury, the second adds the other three.

**Large temples** (Templum Cereris, Templum Neptuni and so on: the grand temples; from mission 3), one per god as in the original: 3x3, 150 Dn, 5 workers, desirability +14 (rings 14, 14, 12, 12, 10). The same priest on the same round as a small temple, so no farther reach on the ground; it counts as **two temples** toward its god (the original counted 1,500 people of coverage to a small temple's 750). Two small temples do the same for 100 Dn and 4 workers; the large one pays back in desirability and in fewer buildings to keep up. Homes still count distinct gods: no level needs a large temple. It burns and collapses like the small ones (the original; Augustus makes them fire-proof). The Religion advisor counts a staffed large temple as two and says so ("2 (0 small, 1 large: a large temple counts as two)").

Each god wants one staffed temple per 500 of its share of citizens (a fifth of the population; a large temple counts as two). Towns under 800 people are left alone. Above that, a god with no temple sinks toward mood 5 and eventually strikes (mood 12 or less; then 8 months before it can strike again, and its mood rises 12). Blessings (mood 92+, then 14 months before the next) need festivals or oracles on top of good coverage.

A god that strikes stays **angered** until its mood is back above 50 (the Religion advisor says so). If Mercury or Venus strikes again before then, the wrath is harder. The first two campaign missions spare a new player that: there a second wrath is like the first.

| God | Blessing | Wrath | Angered again |
|---|---|---|---|
| Ceres | instant harvest on every farm | farm progress lost | the same |
| Neptune | trade windfall (200 Dn + 0.2 a citizen) | buildings near water weakened, and every fishing boat sinks | the same |
| Mercury | the working granary with the least food receives 600 each of wheat, vegetables, fruit and meat (never fish: the four land foods), as far as it has room and accepts them (a granary set to refuse every land food is passed over; any granary if none is staffed) | the granary or warehouse holding the most loses 1600 units (a granary wheat first, then vegetables, fruit, meat, fish; a warehouse its largest stocks first) | that storehouse burns down, with everything in it; the fire can spread |
| Mars | +10 peace | brawls: -10 peace, treasury looted (100 Dn + 0.1 a citizen) | the same |
| Venus | every home's mood +25, and the city mood +15, fading a fifth a month | every home's mood capped at 50, then -5; the city mood -5, fading | homes capped at 45, then -10; the city mood -10, fading; and where disease can break out, every home gains disease risk of 80 x (100 - its health score) / 100 (x the difficulty's disease lever): badly served homes go most of the way to an outbreak, and a passing physician clears it |

Venus's part of the city mood shows in the Overview's mood breakdown as "Venus's blessing or wrath" while it lasts (it fades x0.8 a month and is gone once under half a point). Measured in the balance sim's demo city (six seeds): a blessing lifts the city mood about 7 points; a first wrath takes about 3, a second about 9 more for a few months, and its thieves cost about 20 peace on Normal and Hard.

## Ratings and winning

* **Culture:** religion, entertainment (full marks at an average score of 40), school, library, academy coverage (+ Curia). Moves at most 4 points a month.
* **Prosperity:** average house level (full marks at an average of Insulae), patricians, last year's profit, unemployment, wages, Curia, and +2 while the Circus has races. Moves at most 2 points a month.
* **Peace:** +1 a month while mood is 45+, -2 while it is under 30; in a month when enemies were in the province (raiders ashore or in their ships off the coast, or Caesar's legions) it gains nothing and falls 2 instead; +8 for each raid repelled, -1 for each building raiders destroy. Crime costs peace by difficulty:

  | | Easy | Normal | Hard | Insane |
  |---|---|---|---|---|
  | Riot | none | -5 | -10 | -15 |
  | Thief | none | -1, and no gain that month | -2, and no gain that month | -3, and no gain that month |
  | Protests | none | none | none | -1 for every fifth |
* **Favor:** requests (+10 / -12), tribute, gifts, debt, the governor's salary at New Year, distant battles (+25 won, -10 too weak, -25 too late, -50 nobody sent), a raid repelled (+3), Caesar's legions destroyed (+10). Drifts toward 50. Favor 0 does not end the game: at 10 or less Caesar sends his legions (see *Caesar's legions*). The Emperor first asks in the city's fourth year (36-48 months in), once it has 500 people, then every 14-26 months for money or goods he can see you make, due in 12 months; Insane asks for half as much again, more often, due in 9.

A mission is won when every goal is met at the same time (checked monthly), and no enemies are in the province: with raiders or Caesar's legions on the map Rome waits (a message says so once) and proclaims the victory at the first month's end after they are gone. You can keep building afterwards. It is lost only when the city is **overrun** (checked daily, in a mission: the sandbox has no goals and is never lost): more invaders in the province (Caesar's legionaries, raiders ashore and raiders still aboard their ships) than your soldiers plus 2 (ships do not count), while the population is under a quarter of the most it has been in this mission. The original's rule; the message says so.

## The governor

**Rank.** Eleven ranks, each with the monthly salary Rome allows it:

| Rank | Citizen | Clerk | Engineer | Architect | Quaestor | Procurator | Aedile | Praetor | Consul | Proconsul | Caesar |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Salary (Dn a month) | 0 | 2 | 5 | 8 | 12 | 20 | 30 | 40 | 60 | 80 | 100 |

Each step of the campaign is played at one rank, both provinces of a step alike: Citizen at step 1, one up each step after, Aedile at step 7 (the higher ranks wait for a longer campaign). The sandbox setup lets you pick a rank (Procurator unless you choose). The rank never changes during a mission; the victory screen names the next one.

**Salary.** It starts at your rank's rate; the Imperial advisor lets you draw any rank's rate instead. It is paid at each month's end from the treasury into your personal savings, but only when the treasury can cover it. At New Year Rome looks at what you were actually paid over the year and finds the lowest rank whose year of pay covers it: each rank above your own costs 1 favor (a Quaestor paid an Aedile's 360 Dn loses 2), a year below your rank's pay earns +1 however far below if you chose a lower rate (a Citizen, at 0, cannot earn it; months the treasury could not pay you earn nothing), and your own rank's pay changes nothing. Switching to a modest rate on the last day of the year does not help: it is the year's pay that counts. The year you win a mission is never weighed at a New Year, so when the mission is won Rome takes back from your savings whatever you drew above your rank's rate that year, before the savings go on to the next mission. The Imperial advisor shows what you will have drawn by New Year at the current rate, and what Rome will make of it. (Favor drifts back toward 50, half a point a month, so the effect fades over the following months.)

**Savings** are your own, and go with you: winning a mission carries them to the next step, to both of its provinces where it has two (the last win at a step sets what the next one starts with), and a mission played again starts from what it started with the time before. The first mission and the sandbox start with none. They are spent two ways (festivals stay paid from the treasury):

* **Gifts to the Emperor** (Imperial advisor). Their price grows with your savings: a modest gift costs an eighth of your savings plus 20 Dn, a generous one a quarter plus 50, a lavish one half plus 100. Each further gift within a year of your last one pleases him less:

  | Gift | 1st | 2nd | 3rd | 4th | 5th and later |
  |---|---|---|---|---|---|
  | Modest | +3 | +1 | 0 | 0 | 0 |
  | Generous | +5 | +3 | +1 | 0 | 0 |
  | Lavish | +10 | +5 | +3 | +1 | 0 |

  His count starts again 12 months after your last gift. A gift that would please him no more cannot be sent. Example: with 400 Dn saved the gifts cost 70, 150 and 300; a lavish one leaves 100 and gives +10; a month later a modest one costs 32 and gives +1.
* **Donations** to the treasury, any amount up to your savings. The ledger shows them on their own row ("Governor's donations"), and like a loan they do not count as profit for prosperity.

**The residence.** The Praetorium (Governor's House: 3x3, 150 Dn, desirability +12 falling by 2 every 2 tiles over 3), the Praetorium Maius (Governor's Villa: 4x4, 400 Dn, +20, by 3 over 4) and the Regia (Governor's Palace: 5x5, 750 Dn, +28, by 4 over 5), under Government & Decor: the house from mission 1, the villa from mission 3, the palace from mission 5, all three in the sandbox. They are kept by servants (4, 8 and 12 workers, Government labor, like the Forum; Colonia's own, the original's needed none), so they need a road like any building with workers, and they give their desirability only as far as they are staffed: an unstaffed residence is a shuttered house that adds nothing. They can burn or crack like other stone buildings (slowly). Only one may stand at a time: building another is refused until you demolish the one you have. It does nothing for your salary, savings or favor; it is the grandest decoration in the city, and rioters go for it before anything else.

## The campaign

Seven steps and ten missions. The first two teach the basics and have no crime or disease. The goals grow with the housing ladder: each mission's buildings let homes reach a certain level, and its culture and prosperity goals ask for a good share of what those buildings can give. "Mission 4" in this manual means step 4, either of its provinces, unless a province is named.

**Branches.** Steps 3, 4 and 5 offer two provinces at the same rank, with the same start year and funds, as the original's career did from its third rank: one **peaceful**, one **military**. A military province has raids, forts and Caesar's calls for troops (Firmum brings them to step 3, a step sooner than the campaign had them); a peaceful one has no raids, no forts, barracks, towers, walls or fleet, and asks for more culture and prosperity, and from step 4 more favor (with no army, Caesar's legions are its real danger: keep his favor). Winning any mission of a step opens both of the next, so you may switch tracks at every split; the missions you won stay open to replay. After a win the victory screen offers "Choose your next post": a card for each province (its track, a line of its story, its map and goals, and what threatens it), each with a Start button that opens its briefing, whose Back returns to the choice. If a city at a step with two provinces is overrun, the defeat screen offers the same choice again ("Choose a province again"). The Campaign list shows one row per step, the two provinces side by side, the step's number turning to a check once either is won. Your savings go to both provinces of the next step. A record of wins from before the branches needs nothing done: it opens what it opened before, and the new provinces beside the steps it reached.

| Step | Peaceful | Military | Rank |
|---|---|---|---|
| 1 | Novum Castrum (one mission) | | Citizen |
| 2 | Aquae Clarae (one mission) | | Clerk |
| 3 | Figlina | Firmum | Engineer |
| 4 | Paestum | Pons Aelius | Architect |
| 5 | Beneventum | Portus Mercatorum | Quaestor |
| 6 | Oasis Aurea (one mission) | | Procurator |
| 7 | Urbs Magna (one mission) | | Aedile |

The new provinces are Roman colonies of the 270s and 260s BC. **Firmum** (264 BC, a hilltop over the Picene country): lakes and woods with no water to the map's edge, so every raid comes over land; the first raid two years in (3 to 4 warriors on Normal), legionaries only (an iron mine, a weaponsmith, a barracks, a Castra, the Campus, towers and walls; archers, cavalry and the fleet wait for step 4), Aquileia and Capua (which buys iron) by land, and Caesar's call for troops for Ariminum in its second year. **Paestum** (273 BC, the Greek temple city of Poseidonia): a coast with Capua by land and Massilia and Corinthus by sea, everything of mission 4 but the army and the fleet. **Beneventum** (268 BC, on the Appian Way): a river map whose four partners all come by land, everything of mission 5 but the army and the fleet.

**Population and jobs.** About a third of your plebeians look for work, and above 10% unemployment the city's mood falls (up to 15 points), so peace stops growing. The first two missions unlock few buildings that hire (farms, a granary, markets, prefects, engineers, a Forum, temples, then fountains, a school and a theater), so their goals are what a sensibly built town of them employs: about 300 people in mission 1, 450 in mission 2. More homes there only add idle hands. Later missions add workshops, shows, schools and baths, and trade: whatever a partner buys keeps farms and workshops staffed, so jobs grow with your exports. Every mission's population goal is a little under what a sensibly built city of its buildings employs at 10% unemployment (`npm run sim -- --capacity`): Figlina 950, Firmum 1,100, Pons Aelius 2,700, Paestum 2,700, Portus Mercatorum 4,600, Beneventum 3,000, Oasis Aurea 3,500, Urbs Magna 5,800. (Missions 3 to 7 asked for 3,500 to 12,000 people, more than their jobs could employ, and could not be won; they will ask for more again when the economy has the jobs for it: see the ROADMAP.)

| Mission | Map | Population | Culture | Prosperity | Peace | Favor | Homes up to | First raid |
|---|---|---|---|---|---|---|---|---|
| 1 Novum Castrum | river, 64 | 300 | 15 | | 35 | | Hut | |
| 2 Aquae Clarae | lakes, 96 | 450 | 35 | 20 | 45 | | Townhouse | |
| 3 Figlina (peaceful) | plains, 112 | 950 | 45 | 30 | 50 | | Domus | |
| 3 Firmum (military) | lakes, 112 | 1,100 | 35 | 20 | 48 | | Domus | 2 years |
| 4 Pons Aelius (military) | river, 128 | 2,700 | 50 | 40 | 55 | | Villa | 5 years |
| 4 Paestum (peaceful) | coast, 128 | 2,700 | 60 | 50 | 65 | 40 | Villa | |
| 5 Portus Mercatorum (military) | coast, 128 | 4,600 | 60 | 50 | 60 | 55 | Grand Palatium | 4 years |
| 5 Beneventum (peaceful) | river, 128 | 3,000 | 65 | 60 | 70 | 65 | Grand Palatium | |
| 6 Oasis Aurea | desert, 128 | 3,500 | 60 | 55 | 70 | 60 | Grand Palatium | 3.5 years |
| 7 Urbs Magna | lakes, 160 | 5,800 | 75 | 70 | 75 | 65 | Imperial Palatium | 3 years |

Mission 3 opens the Amphitheatrum (Amphitheater) and the Ludus Gladiatorius (Gladiator School) for its Domus: a theater alone gives a home at most 16 entertainment (10 for a visit, 6 for the seats), and a Domus needs 20. Mission 4 opens shipyards and fishing wharves, and the cloth industry (Linarium, Textrinum, Taberna Vestiaria) its Insulae need: without clothing its homes would stop at Tenements. Missions 5 and 6 have every building but the Circus (Hippodrome) and its Factio (Chariot Stable), which only mission 7 (and the sandbox) has; without a hippodrome the Imperial Palatium (95 entertainment) is out of reach there.

**How long a mission takes.** Settlers come about 60 a month at a good mood of 70 (more in a city's first year), peace grows a point a month from 20, culture and prosperity rise a few points a month. In the first two missions and the three new provinces peace sets the length, in the other missions from 3 on the population, so even a city that is always ready needs about 1.3 years for the first mission, 2.1 for the second, 3.6 (Figlina) or 2.3 (Firmum) at step 3, 5.7 (Pons Aelius) or 3.75 (Paestum) at step 4, 7.8 (Portus Mercatorum) or 4.2 (Beneventum) at step 5, 8.5 for step 6 and 15 for the last (`npm run sim -- --pace` prints the table). A year is 8 minutes at 1x; with the city to build first, that makes roughly 45 minutes for the first missions and a few hours for the last at normal speed.

## The world around the city (visual only)

None of this changes the simulation: the same seed plays out the same way with every setting on or off, and saves do not store it.

* **Day and night** (*Settings*: Day and night). One day and night takes 5 minutes at 1x (under 40 seconds at 8x) and stops while the game is paused. Daylight lasts a bit over half of it; sunset and dawn get warm colors. From dusk, homes light their windows one by one (about half their windows, more in bigger homes), temples, forts, towers, gates, docks and venues light torches, one walker in three carries a lantern, raiders carry torches, and fires light up their surroundings. Closed buildings (no staff) and farms, workshops and storehouses stay dark. Tool previews, radius overlays and selection outlines are drawn after the lighting, so they are always bright. Info overlays turn the tint off.
* **Seasons** (*Settings*: Seasons). Four seasons follow the calendar: **Winter** is December to Februarius, **Spring** Martius to Maius, **Summer** Iunius to Augustus and **Fall** September to November (a season is 80 seconds at 1x). A new game starts in Ianuarius, mid-winter. The top bar shows the season next to the date (❄️ Winter, 🌱 Spring, ☀️ Summer, 🍂 Fall; hover it for the full date and the weather). The month sets the colors: December to Februarius are full winter (snow only ever falls on winter scenery), Aprilis full spring, Iunius and Iulius full summer and October full fall; Martius, Maius, Augustus, September and November blend two looks. Winter: grey-green grass and a third of the round trees bare. Spring: fresh green, meadows full of flowers, blossoms on some trees. Fall: olive-gold grass and orange, gold and red leaves. Cypresses never change. With *Seasons* off the colors stay summer's, and so does the weather (no snow). The calendar's seasons (`sim/time.js`) also drive the Insane farm winter, whether or not *Seasons* is on: resting fields keep their crop at the height it reached, dry and dull, fruit trees and vines stand bare and most pigs stay in the sty.
* **Snow cover** (*Settings*: Weather and Seasons). Snow settles while it falls: a dusting after about 2 days of snowfall, deep snow after about 6. The ground, trees, rocks, roofs and fields turn white; roads, plazas and water stay clear. It melts slowly in dry winter weather (about 25 game days from deep snow) and within about 5 days once spring comes (faster in the rain). The white look is baked into the sprites, so it costs nothing per frame; a new snow level (or a new month) is prepared in the background and swapped in whole.
* **Weather** (*Settings*: Weather). Each season has its own weather. **Spring** is the rainy season: rain about 45% of the time, three times as much as summer. **Summer** is mostly clear (about three quarters of the time) and its rain comes as the odd thunderstorm. **Fall** is cloudier, with rain about 30% of the time. **Winter** only snows (about 45% of the time): there is no rain and no thunder in winter, and snow never falls in any other season. A new season draws new weather on its first day; after that a spell lasts 20 to 45 seconds of game time. When winter starts, any rain stops at once; when spring starts, the snow melts away, so rain and snow never fall together. A new or loaded game opens with 12 to 25 seconds of clear sky. Overcast dims the scene and hides sun shadows and cloud shade. Thunderstorms flash (at most every 5 seconds) and thunder rolls in a moment later; heavy storms make some homes light their lamps by day. Birds stay home at night and in rain or snow.
* **Reduced motion.** When the system asks for reduced motion, decorative motion stops: no swaying trees, glints, falling rain or snow, lightning flashes, fling or zoom animation. Colors, lights, snow on the ground and flags (held still) remain.
* **Debug console:** `weather rain` (clear, cloudy, rain, storm, snow) changes the weather now (in winter rain and storms fall as snow, and snow turns to rain in the other seasons); `snow 3` sets the snow lying on the ground (0 to 3; it melts again by itself); `sky 0.8` freezes the time of day (0.3 noon, 0.67 sunset, 0.8 night) and `sky off` lets it run again.

## Music

Original music, written by the game's own composer and played live by synthesized instruments (nothing is recorded). It starts on the title screen: at once where the browser allows autoplay, otherwise with the first click, tap or key press on *Click, tap or press a key to begin* (browsers hold sound back until then; that first gesture never presses a menu button). With the music off or muted there is no title screen. Then it follows the city:

| Mood | When | Plays |
|---|---|---|
| Menu | The main menu | Tracks: *Colonia*, *Vesper* |
| Day | Building the city | Tracks: *Colonia*, *Prima Lux*, *Mane in Foro*, *Via Nova*, *Aquae Vivae*, *Messis*, *Lares*; 6 to 14 seconds of silence between them |
| Night | After dusk (with *Day and night* on) | Tracks: *Lares*, *Vesper*, *Nox Serena*, *Stellae* (slow pan flute and lyre, no drums) |
| Festival | For a while after a festival, and on victory | A new bright lydian or mixolydian dance with jingles each time |
| Danger | While raiders are on the map | New fast phrygian war music, drums and horn calls, one piece after another |

The ten tracks each run 3 to 5 minutes and always sound the same: each has its own key, tempo, meter, pipes and tune, and its own way in (the lyre alone, a drone and a pipe call, the drums building up, the pipe alone, a slow swell, or the whole band). They come in random order, never one of the last three. A piece is built from an opening, rounds of sections (the theme, a higher answer, a calmer contrast on the other pipe, a passage for the lyre alone) and an ending; festival and battle pieces are built the same way and run about 3 minutes.

Raiders and festivals take over at once: the old piece fades out in a second and a half. Between calm moods a track is never cut off: if it plays in the new mood too it carries on, otherwise it finishes its phrase and plays its ending before the next one starts. *Settings* has a music switch and its own volume (separate from sound effects); **M** switches it too; *Mute all sounds* silences everything. Console: `music` (status, with the track playing), `music next`, `music tracks`, `music play prima lux` (or a number), `music mood danger` (or `auto`), `music check` (render and measure every mood), `music wav day 60` (download a WAV).

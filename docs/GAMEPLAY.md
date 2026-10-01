# Gameplay guide

The rules and numbers behind Colonia. Every number here comes from `src/config.js` or `src/data/*.js`; if you change those, update this page (the in-game Help tables are generated from the data automatically).

## Time

* A game day takes 1.67 seconds at 1x (12 simulation ticks a second, 20 a day); 16 days make a month (about 27 seconds) and 12 months a year (about 5 minutes at 1x).
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

Insane is for veterans: staff the Prefecture and Engineer's Post first (labor priorities), because an unpatrolled building now burns or collapses in about two months instead of three, and plan for roughly twice Normal's army. In winter nothing grows on any farm (crops, pigs, and the Horse Ranch's foals and herd): fields keep their progress and grow again from Martius, workers stay on, and carts still haul the harvest already in store. Games start in Ianuarius, so the first harvest waits for spring; a message warns in October, and the city lives on its granaries (or imports) from December to Februarius. Size farms for about a third more than the city eats (a full Insane wheat farm grows about 576 units a year instead of 768) and keep roughly 0.75 units per citizen in store when winter comes. Winter also costs the Horse Ranch about a quarter of the year's foals and mares, so start it early. The headless simulator shows how a level plays out: `npm run sim -- --difficulty insane --raids occasional --garrison`.

## Housing

A Housing Plot costs 10 Dn. Settlers arrive when the city mood is at least 30, the plot is within 2 tiles of a road, and that road connects to the map entrance. A home uses the nearest road that reaches the entrance, even when an unconnected street runs closer; other buildings use a road touching them, again preferring one that reaches the entrance, so a stray bit of road laid against a building never cuts it off from its workers and walkers.

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
| 12 | Insula | 2x2 | 88 | des 34, 2 food types, entertainment 30 | 31 | 5 |
| 13 | Villa ★ | 2x2 | 44 | des 40, 2 gods, wine | 37 | 8 |
| 14 | Garden Villa ★ | 2x2 | 48 | des 45, entertainment 40, medicus and hospital | 41 | 9 |
| 15 | Peristyle Villa ★ | 3x3 | 99 | des 49, entertainment 45, academy (with school and library), room to grow to 3x3 | 43 | 10 |
| 16 | Marble Villa ★ | 3x3 | 108 | des 53, 3 food types, 3 gods, entertainment 50 | 49 | 11 |
| 17 | Mansion ★ | 3x3 | 117 | des 57, entertainment 55, 2 wine sources | 53 | 12 |
| 18 | Palatium ★ | 3x3 | 126 | des 61, 4 gods, entertainment 60 | 57 | 13 |
| 19 | Grand Palatium ★ | 4x4 | 192 | des 66, entertainment 70, room to grow to 4x4 | 60 | 15 |
| 20 | Imperial Palatium ★ | 4x4 | 208 | des 72, entertainment 80 | 68 | 16 |

Needs add up: each level also needs everything the levels below it need. "To reach it" gives the desirability the level below needs to move up. "Bad at" is the floor for a home at that level. ★ Patricians (levels 13 and up) do not work, but pay much higher taxes, and never emigrate.

* **Food:** tents forage and need none. Others eat only as many kinds as their level needs (a quarter unit per person per month, shared between the kinds; when one runs short, the rest comes from other food in the house), and market vendors bring only those kinds, topped up to three months.
* **Goods** (pottery, furniture, oil, wine) are used up twice a month, and only the ones the level needs. When one runs out, the next day is a bad day.
* **Wine sources** (levels 17 and up): a working (staffed) winery counts as one, and so does each open trade route that sells wine while wine is set to import.
* **Education** is a tier: a school or a library, then both, then both and an academy. An academy alone does nothing.
* **Health:** barber and baths are needs of their own; medical care is a medicus or a hospital (within 12 tiles), then both.
* **Desirability** is read on the best tile of the home. Humble homes (levels 1-6) are poor neighbors, levels 9 and up good ones, villas and palaces very good. Gardens, statues, temples and plazas lift a block; a big home's best tile is usually on its edge, so decorate around it. Palaces need plazas or large statues.

## Services (walkers)

Most services are delivered by walkers. A walker serves every building within **2 tiles** of each road tile it steps on, and a home remembers the visit for **96 days** (a tax collector's visit, 48). Roamers walk 22-30 tiles, prefer to go straight, avoid tiles they just walked, stay within about 13 tiles of their building, and prefer streets with something to serve: at a junction a roamer looks up to 8 tiles down each way (to the next junction, a dead end, or a roadblock that would stop it) and favors the ways with buildings along them over empty road such as the Imperial road out to the map edge; a way that reaches a building within those 8 tiles, like a short spur to a clay pit, counts in full. An outpost at the end of a longer empty road is visited less: give it a post of its own. Short loops of road around housing blocks are covered far better than long dead ends.

| Service | Building | Notes |
|---|---|---|
| Fire safety, police | Prefecture (6 workers) | Prefects reset fire risk and give homes 32 days of police cover (half the crime); they run to fires and douse everything within 4 tiles, and catch protesters, thieves and rioters (see Crime) |
| Collapse | Engineer's Post (5) | Engineers reset collapse risk |
| Religion | Temples (2) | One per god: Jupiter, Ceres, Neptune, Mars, Vesta |
| Food & goods | Market (5) | Up to two vendors on the streets; the buyer restocks from granaries/warehouses |
| Education | School (10), Library (20), Academy (30) | Tiers: school or library, both, both and an academy |
| Health | Barber (2), Medicus (5), Thermae (10, needs piped water), Valetudinarium (30, area 12 tiles) | Barber and baths are needs of their own; medicus and hospital make up medical care. All of them raise a home's health score; a physician passing clears its disease risk and cures the sick, and a medicus sends one to an outbreak (see Health and disease) |
| Entertainment | Theater 10 pts, Amphitheater 15 (20 with plays and gladiators booked), Colosseum 20 (30 with gladiators and beasts) | Each needs performers from a training building: Actor Troupe, Gladiator School, Menagerie |
| Taxes | Forum (6), Senate (30) | Only visited homes pay tax |

**Roadblocks** (Roads menu, 12 Dn) go on a road tile. Walkers roaming the streets turn back at one, so a building serves only the homes on its side; click a roadblock to let groups through (prefects and engineers, priests, market vendors, entertainers, teachers/librarians/scholars, barbers/physicians/bath attendants, tax collectors; none at first). Everyone heading somewhere passes: carts, market buyers, settlers, caravans, prefects running to a fire or chasing a criminal, physicians sent to the sick, and roamers walking home (who still serve homes along the way, as on any walk). Soldiers and raiders ignore roadblocks. Clearing one leaves its road.

**Inspecting walkers.** Click a walker for its panel: who it is, where it comes from, what it is doing and carrying, and what it says. Citizens mention the city's most pressing trouble (raiders first, then hunger, fire, unemployment over 12%, taxes more than 2 points over the default, wages under the fair wage, debt, an angry god, a mood under 35) or talk about their work; protesters say what upsets their home most; a walker keeps the same line for 8 days. *Follow* keeps the view on it until you move the map.

A home's **entertainment score** is the points of every venue whose entertainer passed by recently, plus a city-wide base of up to 20: for each kind of venue, the share of the population its working venues can seat (theater 400, amphitheater 900, colosseum 2,000 people), averaged over the three kinds and divided by 5. A growing city needs more venues, not just one of each.

Water is by area, not walkers: Well 2 tiles; Fountain 4 tiles (must be inside a full reservoir's 10-tile piped area); a Reservoir fills when it touches water or connects by aqueduct to a full reservoir. While you place housing plots, a faint blue shows where homes would get water (paler for well water, stronger for fountain water); while you place a fountain or baths, the same faint blue shows the reservoirs' piped area, where they would run. Placing or clicking a well, fountain or reservoir shows its own reach in dark blue. Wells and reservoirs need no road, but they wear out like everything else, and an engineer repairs only what lies within 2 tiles of the road he walks: one placed further from every road is flagged when you place it, on its panel and on the Problems overlay, and in time it collapses.

## Workers

* About **32%** of plebeian residents work.
* A building can hire only if occupied housing is within **40 road tiles**.
* Short of workers? Everyone gets the same share, except categories you mark as **priorities** in the Labor advisor, which are filled first in order.
* Efficiency = workers / needed. It scales production speed and how often walkers go out.

## Food and industry

* People eat **0.25 units per month** (a 100-unit load feeds 400 person-months).
* Farms must sit on meadow. Output scales with the share of meadow under the 3x3 field. A full wheat farm makes 100 units every 20 days (about 80 a month, enough for ~300 people). Fields never burn. On Insane nothing grows in winter (December to Februarius; see [Difficulty](#difficulty)).
* Farm wagons haul up to 400 units, other carts up to 200; a producer can have 2 carts on the road.
* Raw material goes to a workshop that needs it, else to a warehouse (which later ships it to workshops that run low). Finished goods go to warehouses; markets fetch them for homes that need them.

| Chain | Placement rule |
|---|---|
| Clay Pit → Potter → Pottery | clay pit within 2 tiles of water |
| Timber Yard → Carpenter → Furniture | within 2 tiles of woods: at least 4 tiles of forest (lone trees are not enough) |
| Olive Grove → Oil Press → Oil | grove on meadow |
| Vineyard → Winery → Wine | vineyard on meadow |
| Iron Mine → Weaponsmith → Weapons | mine touching rocks (export good; legionaries need 50 each) |
| Timber Yard + Iron Mine → Fletcher → Arrows | 100 timber + 50 iron per 100 arrows (archers need 50 each) |
| Horse Ranch → Horses | ranch on meadow (1 horse = 100 units; cavalry need 1 each) |
| Marble Quarry → Marble | touching rocks (export good) |

Workshops follow a **recipe**: most use 100 units of one raw material per 100-unit batch; the Fletcher needs both timber and iron and waits until it has both.

### Granary and warehouse orders

Click a granary or warehouse: each good (each food, in a granary) has an order button, and a click cycles it through three orders. Its panel also says what the orders are doing right now.

* **Accept** (the default): carts and traders may bring it here. New warehouses refuse food, which belongs in granaries; set a food to Accept to store it in a warehouse.
* **Refuse**: nothing brings it here: producer and dock carts, other storage's carts and caravan imports go elsewhere. Nobody taking it out cares: market buyers, exports and the Emperor still take a refused good.
* **Get**: deliveries come as for Accept, and the building's own cart also fetches the good from other storage on its roads.
  * A warehouse fetches while it holds 4 loads (400 units) or less and has room for 8, from another warehouse, while the others hold more than 4 loads between them. It brings up to 4 loads a trip and prefers nearer and fuller warehouses (each load stored there counts as 4 tiles of road), so Get keeps 5 to 8 loads; it does not fill the warehouse.
  * A granary fetches while it has room for a load: up to 8 loads (800 units) of one food, from the nearest granary (one with 400 units or less to give counts as twice as far), taking the food on Get that granary holds most of. It never takes the last 100 units of a food from the granaries on its roads.
  * A building on Get for a good is never a source of it, so two of them never pass a good back and forth.
* **Empty the granary / warehouse** (a switch): it takes nothing in, and its cart carries everything out, up to 200 units a trip, wherever any cart would take it: a barracks that needs it, a workshop that uses it, a granary, or other storage that accepts it. A good with nowhere to go stays (the panel names it) and the cart takes the next one. Get pauses while emptying. Market buyers, traders and the Emperor still take from it.
* A storage building sends **one cart at a time**, decided once a day: Empty, else Get, else (warehouses) its routine trips with weapons, arrows and horses to a barracks and raw materials to workshops. Get and Empty need the building at least half staffed; taking deliveries needs only some staff. The room for a Get cart's load is held at home from the moment it leaves, so nothing is lost on the way back.
* The Emperor's requests take from storage not on Get first.

**Finding what is wrong.** The **Problems** overlay (top bar) raises a column over each home with a problem, the most urgent first: a sick home (pale green); a home already falling back a level (tall, colored by the first thing it lacks); a home in unrest (wine red: mood under 30, or it has already sent out a protester or thief; only where there is crime); and a home that cannot move up, colored by the first thing it lacks (water, food, temples, entertainment, education, health, goods, desirability, room to grow), unless it is already as good as the province allows (its next level needs a building or a trade partner the mission does not have); empty lots no settler can reach and buildings that do not work are red, buildings that work badly (understaffed, short of goods, nowhere to deliver) amber. Point at a column for the reason; a legend lists the colors. The **Production** advisor shows, for each good, what was made, used (eaten, worked up, used by homes, spent on recruits, sent to the Emperor), imported and exported last month and what the storehouses hold; lists the buildings that are not working, grouped by reason, with a *Show* button that goes to each in turn; and names the bottlenecks: workshops waiting for a raw material (and what makes it or who sells it), buildings without workers, harvests with nowhere to go, goods used faster than they come in, homes short of food. The **Overview** tab charts population, treasury and mood month by month (up to 20 years).

## Money

* **Wages:** default 24 Dn per worker per year (Rome's fair wage). Paid monthly.
* **Taxes:** at the default 7% rate each resident pays `5 x the level's tax` Dn per year (a Hut resident 10, a Domus resident 15, an Insula resident 25, an Imperial Palatium resident 80; see the housing table). A town of Cottages with most of its people registered and working about pays its wages; Huts do not, and better homes bring a profit. The rate scales this linearly. Only homes a tax collector visited in the last 48 days pay; a home's panel says whether it is registered and for how many more days, or why not (no Forum, a Forum without workers, or no collector lately), and the Finance tab counts the homes that are not. A lone Forum's collector can spend whole rounds on streets nobody lives on, such as the Imperial road, and the registrations he left behind run out: a second Forum, or roadblocks at the ends of a block, keep collectors on your streets.
* **Tribute:** each year Rome takes half a denarius per citizen above 150. Paying raises favor; failing costs 10 favor.
* **Trade:** open a route once (Trade advisor), then a caravan or ship comes every 32-56 days. Each good can be set to export (keep a reserve) or import (up to a target). Partners buy and sell limited amounts per year. See *Trade* below.
* **Army pay:** 2-3 Dn per soldier per month (ledger row "Army pay"). Raiders who get away carry off up to 15% of the treasury ("Lost to raiders").
* Construction needs money in the treasury; running wages into debt costs 3 favor a month, and nothing can be built until you are out of it.
* **Loans from Rome** (Finance advisor): Rome lends 2,000 Dn whenever no loan is being repaid, in debt or not, repaid automatically in equal monthly instalments over 24 months with interest over the whole term of 10% on Easy, 20% on Normal, 30% on Hard and 40% on Insane (2,200 to 2,800 Dn in all). Instalments are paid each month before wages, even from an empty treasury (the debt that follows costs favor from that month). The loan and its repayments have ledger lines of their own and do not count as profit or loss for prosperity; borrowed money pays tribute and the Emperor's requests like any other, at the loan's interest.

## Trade

| | Land route | Sea route |
|---|---|---|
| Who comes | a caravan (with a mule) | a merchant ship, sail striped in the partner's color |
| From | the Imperial road entrance | the map edge where the river/sea leaves the map |
| To | the nearest staffed warehouse on the road network | a free, staffed **Dock** |
| Per visit | up to 800 units each way | up to 1,200 units each way |
| Imports go | straight into that warehouse, unless it refuses the good or is emptying | onto the dock's quay (1,600 units); dock workers cart them to warehouses, granaries or workshops that accept them |
| Exports come from | that warehouse | staffed warehouses within 60 road tiles of the dock |

* A **Dock** (3x3, 10 workers, 120 Dn) must touch navigable water: water connected to the map edge through a body of at least 80 tiles. Rivers and coasts always qualify, big lakes touching the edge sometimes do, desert and plains maps usually do not. Ships sail under bridges.
* One ship ties up at a dock at a time (6 game days, 10 seconds at 1x); more docks serve more routes at once.
* Partners and routes (open cost in Dn):

| Partner | Route | Sells | Buys |
|---|---|---|---|
| Tarraco (500) | land | timber, olives | wheat, pottery |
| Lugdunum (800) | land | iron, meat, arrows | oil, wine, fruit |
| Aquileia (600) | land | pottery, vegetables | clay, olives, meat |
| Capua (700) | land | wheat, wine | pottery, furniture, iron |
| Massilia (700) | sea | clay, wine | furniture, vegetables, pottery |
| Carthago (1000) | sea | fruit, grapes, furniture | weapons, marble, timber |
| Cirta (900) | sea | horses, fruit | weapons, pottery, oil |
| Corinthus (1200) | sea | marble, oil | wine, wheat, iron, arrows |
| Alexandria (1400) | sea | wheat, vegetables | wine, oil, weapons, furniture |

## Military

**Raids.** Provinces from mission 4 on (and sandboxes, unless set to peaceful) are raided. The first raid comes after about 5 years with occasional raids and 3 with frequent ones (campaign missions: 5 years in mission 4, then 4, 3.5 and 3), 25% sooner on Insane, and none while the city has fewer than 300 people. Scouts warn you about 3 months ahead with the direction (⚠ in the top bar). A warband has about `base + population / 450 + raids so far` warriors (x0.7 Easy, x1.3 Hard, x1.5 Insane; 3 to 40; on Insane raiders also have 15% more health and attack, and come 25% sooner), with slingers once the city passes 700 people and horsemen past 1,200. Raiders spawn on a map edge that can reach your homes and head for the nearest buildings, which they wreck or burn. They flee when 70% of the band is dead, and give up after 80 days, 10 buildings destroyed, or being cut off; a band that reached the city takes plunder when it leaves.

Repelling a raid: +8 peace, +3 favor. Each building lost: -1 peace.

**Recruiting.** A staffed Barracks trains one recruit every 8 days (at full staff) and sends him by road to the emptiest staffed fort. Each fort holds 8 soldiers. Equipment is delivered to the Barracks by cart only while forts have empty places:

| Soldier | Fort | Needs | HP | Attack | Defense | Range | Speed (1x) | Pay |
|---|---|---|---|---|---|---|---|---|
| Legionary | Legion Fort (300) | 50 weapons | 110 | 14 | 9 | melee | 0.9 tiles/s | 2 |
| Archer | Archer Fort (220) | 50 arrows | 60 | 10 | 3 | 6.5 tiles | 0.9 | 2 |
| Cavalryman | Cavalry Fort (350) | 1 horse | 120 | 15 | 6 | melee | 1.6 | 3 |

Pay is Dn per soldier per month, on top of the wages of the forts' and barracks' staff (8 and 10 workers). A full set of three forts with a barracks employs about 34 people, so size the army to the city: an army that takes the farmers leaves the city hungry (use labor priorities).

**Horse breeding.** A Horse Ranch (3x3 on meadow, 10 workers) starts with 2 breeding mares and gains one every 30 staffed days, up to 8. Foaling speed scales with the herd (a new ranch works at a quarter of a mature one's pace); at 8 mares on full meadow it produces a horse about every 30 days. Horses can also be imported from Cirta.

**Orders.** A garrison guards the area around its fort (legion 16 tiles, archers 14, cavalry 26) and chases raiders up to 4 tiles beyond that. **Deploy** (fort panel or Military advisor) plants a standard anywhere: the soldiers hold that spot and fight within about 1.5x their sight. **Recall** sends them home. If a fort is destroyed or demolished, its garrison disbands. Forts never burn or decay.

**Defenses.** Watchtowers (2x2, 6 workers) shoot one arrow about every 1.5 s at full staff at raiders within 8 tiles (12 damage). Walls (12 Dn per tile, 220 hp) block raiders; dragging a wall across a road builds a gate (40 Dn, 320 hp) that citizens use freely but raiders must break. Dragging a road through a wall cuts a gate. Raiders pick the cheapest way to your buildings, and breaking a wall counts as 14 extra tiles of walking, so close every gap. Damaged walls show cracks; buildings patch raid damage slowly once the fighting stops.

## Saving

Games are stored in the browser's localStorage under `colonia.save.<slot>`: `auto` (every 3 months and whenever the page is hidden or closed), `quick` (F5 / F9) and `slot1`-`slot5`. Map layers are run-length compressed and walker paths packed, so a year-old small city saves in about 120 KB and a year-old Uber city in about 300 KB; most of a big save is its buildings (about 0.8 KB each). Browsers usually allow about 5 MB per site, so a handful of big-city saves can fill it. The Save/Load menus show each save's size and the total in use. Saves are tied to that browser and site: use *Export to file* or *Copy save data* for backups. The save format is versioned (currently 7: granary and warehouse orders; version 6 saves still load, each good a storehouse accepted on Accept and the rest on Refuse, nothing emptying; version 5 saves load with nobody sick and city health at 50, and version 4 saves too, their homes also starting at the city's mood). Until version 1.0 a release may change it: saves from before v0.7 (the 20-level housing ladder) cannot be loaded, and say so.

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
* **Thief** (mood under 35, once): walks to the nearest staffed Forum or Senate (within 50 road tiles) and steals a quarter of this year's taxes there, at most 400 Dn and never more than the treasury holds (nothing under 5), shown as *Stolen by thieves* in the Finance ledger; with no Forum or Senate in reach he takes half the biggest stock of the nearest stocked market (at most 100). A prefect or soldier who catches him on the way saves it all.
* **Riot** (mood 15 or less while the city's mood is under 30, with a road within 4 tiles): the rioters set their own home alight (its people become homeless), and a mob of 1 to 6 (by population: up to 150, 300, 800, 1,200, 2,000 people, more) marches across country on the most prized building within 40 tiles (the Senate, then villas and palatia, a colosseum, a hospital, venues, schools, baths, the Forum, a medicus, temples, workshops, the granary, markets, insulae...), or with none that close the nearest such building it can walk to, setting alight each building it passes (not warehouses, forts, towers, wells, fountains, reservoirs, statues or gardens, nor homes of level 6 or below) and resting by the flames about three days. Rioters leave after 16 days, or when nothing they can reach is left to burn. A riot costs peace at once (see *Peace* below), but the anger is spent: every home's mood rises by 20.

**Catching criminals.** A prefect (not one fighting a fire) or a soldier beside a criminal holds him until he gives up: about 15 ticks for a prefect, 6 for a soldier. Every 10 ticks a prefect on patrol also looks for a thief or rioter within 30 tiles that nobody chases yet and runs after him (across fields if need be); after the catch he goes home. One he cannot reach (across a river) he leaves alone for 8 days and keeps on his patrol. Fires come first: a prefect sent to a fire drops the chase.

**The crime overlay** (top bar) raises a column over each occupied home by its mood, taller and redder for more crime (0: 10, 1-10: 8, 11-20: 6, 21-30: 4, 31-40: 2, 41-49: 1, 50+: none); a home that has already sent out a protester or thief stands at 8 or more. Prefectures, prefects and criminals stay in view; point at a home for its mood, its trouble and whether a prefect patrols it.

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

**Disease risk** builds like fire risk, on each occupied home every day: 0.5 x (100 - score) / 100 x crowding x the difficulty's disease lever, give or take 40%, where crowding is 0.5 + residents / 40 (at most 2), and half that within a staffed hospital's reach. A physician passing within 2 tiles clears it. A crowded home of 40 scoring 20 that no physician visits reaches 100 in about 10 months on Normal; a home scoring 80 would take over three years, and has a medicus anyway. From 100 a home has a 25% chance a day to **fall sick**. There is no disease while the city has under 200 people, nor in the first two campaign missions.

**A sick home.** When it falls sick a fifth of its residents die (a tenth within a hospital's reach), at least one; a home left empty becomes a vacant lot. The rest are sick for 32 days: the home cannot move up and takes in no settlers, and each day every occupied home touching it gains 1 disease risk and has a 0.5% chance to fall sick too (times the lever, halved within a hospital's reach), once a day however many sick homes it touches. A physician who passes cures it at once. A staffed Medicus within 24 road tiles sends one, the way prefectures send prefects to fires (a physician already on his rounds nearby is called over first); he stays a day, then sees to the next sick home nearby or goes back. Otherwise the home recovers by itself when its days run out. The first outbreak of a month has a message of its own; the month's others are summed up in one message at the start of the next.

**City health** moves 2 points a month toward the residents' average score (weighted by residents). It stays at 50 while the city has under 200 people. It is shown, not a rating: it feeds no rating and not migration.

**The Disease overlay** (top bar) raises a column over each occupied home by its disease risk, like the fire overlay, and a pale green one at full height over each sick home. Medici, hospitals, baths and barbers stay in view, with their walkers; point at a home for its score, what lowers it (no medicus, no baths, well water only, no food...), its risk and the days its sickness has left. Citizens talk about it when a home is sick. Keeping a physician passing every street is the cure: in the balance sim's demo city, whose one Medicus covers most of its homes, an outbreak comes about once in five years on Normal (and hardly ever on Easy), while its basic version, with wells and no medicus, barber or baths, has over a hundred in three years. The **Health** overlay shows which homes a barber, a medicus and the baths reach.

## Fire and collapse

Every building gains fire and collapse risk daily (houses by level, industry faster; x0.5 Easy, x1.3 Hard, x1.5 Insane). At 100 there is a 25% chance per day of disaster. A burning ruin burns for 6 days and can spread: each building beside the flames gains 5 fire risk a day and has a 2% chance a day to catch, once a day however many burning tiles it touches. An unguarded fire in a dense block usually takes a handful of homes; a prefect on the way usually stops it at one or two. Prefects within 24 road tiles are dispatched automatically.

## Gods

Each god wants one staffed temple per 500 of its share of citizens (a fifth of the population). Towns under 800 people are left alone. Above that, a god with no temple sinks toward mood 5 and eventually strikes. Blessings (mood 92+) need festivals or oracles on top of good coverage.

| God | Blessing | Wrath |
|---|---|---|
| Jupiter | +10 favor | lightning sets a home on fire |
| Ceres | instant harvest on every farm | farm progress lost |
| Neptune | trade windfall (money) | buildings near water weakened |
| Mars | +10 peace | brawls: -10 peace, treasury looted |
| Vesta | fire risk reset city-wide | several homes on the brink of fire |

## Ratings and winning

* **Culture:** religion, entertainment (full marks at an average score of 40), school, library, academy coverage (+ Senate). Moves at most 4 points a month.
* **Prosperity:** average house level (full marks at an average of Insulae), patricians, last year's profit, unemployment, wages, Senate. Moves at most 2 points a month.
* **Peace:** +1 a month while mood is 45+, -2 while it is under 30; +8 for each raid repelled, -1 for each building raiders destroy. Crime costs peace by difficulty:

  | | Easy | Normal | Hard | Insane |
  |---|---|---|---|---|
  | Riot | none | -5 | -10 | -15 |
  | Thief | none | -1, and no gain that month | -2, and no gain that month | -3, and no gain that month |
  | Protests | none | none | none | -1 for every fifth |
* **Favor:** requests (+10 / -12), tribute, gifts, debt. Drifts toward 50. At 0 you are recalled (game over). The Emperor asks every 14-26 months (from 150 people) for money or goods he can see you make, due in 12 months; Insane asks for half as much again, more often, due in 9.

A mission is won when every goal is met at the same time (checked monthly). You can keep building afterwards.

## The campaign

Seven missions, each opening the next. The first two teach the basics and have no crime or disease. The goals grow with the housing ladder: each mission's buildings let homes reach a certain level, and its culture and prosperity goals ask for a good share of what those buildings can give.

| Mission | Map | Population | Culture | Prosperity | Peace | Favor | Homes up to | First raid |
|---|---|---|---|---|---|---|---|---|
| 1 Novum Castrum | river, 64 | 1,200 | 15 | | 35 | | Hut | |
| 2 Aquae Clarae | lakes, 96 | 2,500 | 35 | 20 | 45 | | Townhouse | |
| 3 Figlina | plains, 112 | 3,500 | 45 | 30 | 50 | | Domus | |
| 4 Pons Aelius | river, 128 | 5,000 | 50 | 40 | 55 | | Villa | 5 years |
| 5 Portus Mercatorum | coast, 128 | 6,500 | 60 | 50 | 60 | 55 | Imperial Palatium | 4 years |
| 6 Oasis Aurea | desert, 128 | 7,000 | 60 | 55 | 65 | 60 | Imperial Palatium | 3.5 years |
| 7 Urbs Magna | lakes, 160 | 12,000 | 75 | 70 | 75 | 65 | Imperial Palatium | 3 years |

**How long a mission takes.** Settlers come about 60 a month at a good mood of 70 (more in a city's first year), peace grows a point a month from 20, culture and prosperity rise a few points a month, so even a city that is always ready for the next settler needs about 1.3 years for the first mission, 2.2, 3.6, 5.7, 7.8 and 8.5 for the next ones and 15 for the last (`npm run sim -- --pace` prints the table). A year is about 5.3 minutes at 1x; with the city to build first, that makes roughly half an hour for the first missions and a few hours for the last at normal speed.

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

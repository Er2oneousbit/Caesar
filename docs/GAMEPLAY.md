# Gameplay guide

The rules and numbers behind Colonia. Every number here comes from `src/config.js` or `src/data/*.js`; if you change those, update this page (the in-game Help tables are generated from the data automatically).

## Time

* A game day takes 1.67 seconds at 1x (12 simulation ticks a second, 20 a day); 16 days make a month (about 27 seconds) and 12 months a year (about 5 minutes at 1x).
* Speeds: 1x, 2x, 4x, 8x. People walk 2 tiles a game day, 1.2 tiles a second at 1x; their legs step with the ground they cover, so they match at every speed and stand still while paused. Carts roll a little slower, soldiers march at their own pace (table under *Military*).

## Map sizes

Sandbox maps come in Small (64x64), Medium (96x96), Large (128x128) and **Uber (256x256)**: sixteen times the land of Small, room for a capital and its whole province. Settlers walk in from the map entrance to the home they picked; on a big map that can be far, so anyone with more than a 70-tile walk rides in on a mule, up to twice walking speed (a trot): trips up to 140 tiles take no longer than a 70-tile walk. Uber costs about the same per frame as Large (only the tiles on screen are drawn) and a year-old Uber city saves in about 300 KB.

**Around the Imperial road** the land is kept free of rock for about 5 tiles each side (4 at the least, where the edge of an outcrop wanders in). Rock can never be cleared and every city starts along the road, so outcrops there would wall off the first blocks. Rock elsewhere stays for marble quarries and iron mines.

## Difficulty

Chosen in the Sandbox setup and in every campaign briefing (the menus remember your last choice). Each mission in the Campaign list shows the hardest level you have beaten it on. All levers live in `src/data/difficulty.js`:

| Lever | Easy | Normal | Hard | Insane |
|---|---|---|---|---|
| Starting funds | x1.5 | x1 | x0.6 | x0.4 |
| Fire and collapse risk | x0.7 | x1 | x1.3 | x1.5 |
| Farm, raw material and workshop speed | x1.15 | x1 | x0.9 | x0.8 |
| Settlers per day | x1.25 | x1 | x0.85 | x0.7 |
| City mood | | | | -8 |
| Raiders per warband | x0.7 | x1 | x1.3 | x1.5 |
| Raider health, attack and siege damage | | | | x1.15 |
| Months until the first raid and between raids | | | | x0.75 |
| Size of the Emperor's requests | | | | x1.5 |
| Months between requests | | | | x0.7 (about 10-18) |
| Months to deliver a request | 12 | 12 | 12 | 9 |

Insane is for veterans: staff the Prefecture and Engineer's Post first (labor priorities), because an unpatrolled building now burns or collapses in about two months instead of three, and plan for roughly twice Normal's army. The headless simulator shows how a level plays out: `npm run sim -- --difficulty insane --raids occasional --garrison`.

## Housing

A Housing Plot costs 10 Dn. Settlers arrive when the city mood is at least 30, the plot is within 2 tiles of a road, and that road connects to the map entrance.

A home climbs **one level at a time** after 3 consecutive days with everything the next level needs, and falls one level after 10 consecutive days of missing something its current level needs (desirability gets a 5-point grace margin). Residents over the new capacity move out.

| # | Level | Size | People/tile | Needs (cumulative) |
|---|---|---|---|---|
| 1 | Tent | 1x1 | 5 | settlers |
| 2 | Lean-to | 1x1 | 7 | well, desirability -12 |
| 3 | Hut | 1x1 | 9 | 1 food, des -8 |
| 4 | Cottage | 1x1 | 11 | 1 god, des -4 |
| 5 | Townhouse | 1x1 | 13 | fountain, entertainment 10, des 2 |
| 6 | Domus | 1x1 | 15 | pottery, ent 15, des 6 |
| 7 | Tenement | 2x2 | 16 | 2 foods, school, 1 health, des 10 |
| 8 | Insula | 2x2 | 18 | furniture, 2 gods, ent 25, 2 health, des 14 |
| 9 | Upper Insula | 2x2 | 20 | oil, library, ent 35, des 18 |
| 10 | Villa ★ | 3x3 | 9 | wine, 3 foods, 3 gods, ent 45, 3 health, des 25 |
| 11 | Grand Villa ★ | 3x3 | 11 | academy, ent 55, des 34 |
| 12 | Palatium ★ | 3x3 | 13 | 4 gods, hospital (4 health), ent 70, des 45 |

★ Patricians do not work but pay much higher taxes.

**Growing bigger:** when a 1x1 home qualifies for level 7 it merges with small neighboring homes or empty land into a 2x2 block (and 2x2 into 3x3 for level 10). Leave room, or place housing in 2-deep and 3-deep bands.

## Services (walkers)

Most services are delivered by walkers. A walker serves every building within **2 tiles** of each road tile it steps on, and a home remembers the visit for **48 days**. Roamers walk 22-30 tiles, prefer to go straight, avoid tiles they just walked, and stay within about 13 tiles of their building. Short loops of road around housing blocks are covered far better than long dead ends.

| Service | Building | Notes |
|---|---|---|
| Fire safety | Prefecture (6 workers) | Prefects reset fire risk; they run to fires and douse everything within 4 tiles |
| Collapse | Engineer's Post (5) | Engineers reset collapse risk |
| Religion | Temples (2) | One per god: Jupiter, Ceres, Neptune, Mars, Vesta |
| Food & goods | Market (5) | Up to two vendors on the streets; the buyer restocks from granaries/warehouses |
| Education | School (10), Library (20), Academy (30) | |
| Health | Barber (2), Medicus (5), Thermae (10, needs piped water), Valetudinarium (30, area 12 tiles) | |
| Entertainment | Theater 15 pts, Amphitheater 25, Colosseum 35 | Each needs performers from a training building: Actor Troupe, Gladiator School, Menagerie |
| Taxes | Forum (6), Senate (30) | Only visited homes pay tax |

Water is by area, not walkers: Well 2 tiles; Fountain 4 tiles (must be inside a full reservoir's 10-tile piped area); a Reservoir fills when it touches water or connects by aqueduct to a full reservoir.

## Workers

* About **32%** of plebeian residents work.
* A building can hire only if occupied housing is within **40 road tiles**.
* Short of workers? Everyone gets the same share, except categories you mark as **priorities** in the Labor advisor, which are filled first in order.
* Efficiency = workers / needed. It scales production speed and how often walkers go out.

## Food and industry

* People eat **0.25 units per month** (a 100-unit load feeds 400 person-months).
* Farms must sit on meadow. Output scales with the share of meadow under the 3x3 field. A full wheat farm makes 100 units every 20 days (about 80 a month, enough for ~300 people). Fields never burn.
* Farm wagons haul up to 400 units, other carts up to 200; a producer can have 2 carts on the road.
* Raw material goes to a workshop that needs it, else to a warehouse (which later ships it to workshops that run low). Finished goods go to warehouses; markets fetch them for homes that need them.

| Chain | Placement rule |
|---|---|
| Clay Pit → Potter → Pottery | clay pit within 2 tiles of water |
| Timber Yard → Carpenter → Furniture | within 2 tiles of forest |
| Olive Grove → Oil Press → Oil | grove on meadow |
| Vineyard → Winery → Wine | vineyard on meadow |
| Iron Mine → Weaponsmith → Weapons | mine touching rocks (export good; legionaries need 50 each) |
| Timber Yard + Iron Mine → Fletcher → Arrows | 100 timber + 50 iron per 100 arrows (archers need 50 each) |
| Horse Ranch → Horses | ranch on meadow (1 horse = 100 units; cavalry need 1 each) |
| Marble Quarry → Marble | touching rocks (export good) |

Workshops follow a **recipe**: most use 100 units of one raw material per 100-unit batch; the Fletcher needs both timber and iron and waits until it has both.

## Money

* **Wages:** default 24 Dn per worker per year (Rome's fair wage). Paid monthly.
* **Taxes:** at the default 7% rate each resident pays `2 x tier tax level` Dn per year (a Domus resident ~6, an Insula resident ~10, a Palatium resident ~32). The rate scales this linearly. Only homes a tax collector visited pay.
* **Tribute:** each year Rome takes half a denarius per citizen above 150. Paying raises favor; failing costs 10 favor.
* **Trade:** open a route once (Trade advisor), then a caravan or ship comes every 32-56 days. Each good can be set to export (keep a reserve) or import (up to a target). Partners buy and sell limited amounts per year. See *Trade* below.
* **Army pay:** 2-3 Dn per soldier per month (ledger row "Army pay"). Raiders who get away carry off up to 15% of the treasury ("Lost to raiders").
* Construction needs money in the treasury; running wages into debt costs 3 favor a month.

## Trade

| | Land route | Sea route |
|---|---|---|
| Who comes | a caravan (with a mule) | a merchant ship, sail striped in the partner's color |
| From | the Imperial road entrance | the map edge where the river/sea leaves the map |
| To | the nearest staffed warehouse on the road network | a free, staffed **Dock** |
| Per visit | up to 800 units each way | up to 1,200 units each way |
| Imports go | straight into that warehouse | onto the dock's quay (1,600 units); dock workers cart them to warehouses, granaries or workshops |
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

**Raids.** Provinces from mission 4 on (and sandboxes, unless set to peaceful) are raided. Scouts warn you about 3 months ahead with the direction (⚠ in the top bar). No raids come while the city has fewer than 120 people. A warband has about `base + population / 450 + raids so far` warriors (x0.7 Easy, x1.3 Hard, x1.5 Insane; 3 to 40; on Insane raiders also have 15% more health and attack, and come 25% sooner), with slingers once the city passes 700 people and horsemen past 1,200. Raiders spawn on a map edge that can reach your homes and head for the nearest buildings, which they wreck or burn. They flee when 70% of the band is dead, and give up after 80 days, 10 buildings destroyed, or being cut off; a band that reached the city takes plunder when it leaves.

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

Games are stored in the browser's localStorage under `colonia.save.<slot>`: `auto` (every 3 months and whenever the page is hidden or closed), `quick` (F5 / F9) and `slot1`-`slot5`. Map layers are run-length compressed and walker paths packed, so a year-old small city saves in about 120 KB and a year-old Uber city in about 300 KB; most of a big save is its buildings (about 0.8 KB each). Browsers usually allow about 5 MB per site, so a handful of big-city saves can fill it. The Save/Load menus show each save's size and the total in use. Saves are tied to that browser and site: use *Export to file* or *Copy save data* for backups. The save format is versioned (currently 3); older saves still load.

## City mood (sentiment)

Starts from 50 and is recalculated monthly (moving halfway toward the new value):

| Factor | Effect |
|---|---|
| Tax rate | -3 per point above 7%, +1.5 per point below |
| Wages | +0.8 per Dn above 24, -0.8 below |
| Unemployment | -60 x (rate - 10%), max -15 |
| Hunger | up to -18 when nobody has food |
| Housing quality | -4 to +10 by average level |
| Gods | -8 to +6 by average mood |
| Festivals | temporary boost |
| New city | +20 for the first year |
| Difficulty | -8 on Insane |

Mood 30+ brings settlers; below 25 people start leaving.

## Fire and collapse

Every building gains fire and collapse risk daily (houses by level, industry faster; x0.7 Easy, x1.3 Hard, x1.5 Insane). At 100 there is a 25% chance per day of disaster. A burning ruin burns for 6 days and can spread (3% per neighbor per day). Prefects within 24 road tiles are dispatched automatically.

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

* **Culture:** religion, entertainment, school, library, academy coverage (+ Senate).
* **Prosperity:** average house level, patricians, last year's profit, unemployment, wages, Senate. Moves at most 2 points a month.
* **Peace:** +1 a month while mood is 45+, -2 while it is under 30; +8 for each raid repelled, -1 for each building raiders destroy.
* **Favor:** requests (+10 / -12), tribute, gifts, debt. Drifts toward 50. At 0 you are recalled (game over). The Emperor asks every 14-26 months (from 150 people) for money or goods he can see you make, due in 12 months; Insane asks for half as much again, more often, due in 9.

A mission is won when every goal is met at the same time (checked monthly). You can keep building afterwards.

## The world around the city (visual only)

None of this changes the simulation: the same seed plays out the same way with every setting on or off, and saves do not store it.

* **Day and night** (*Settings*: Day and night). One day and night takes 5 minutes at 1x (under 40 seconds at 8x) and stops while the game is paused. Daylight lasts a bit over half of it; sunset and dawn get warm colors. From dusk, homes light their windows one by one (about half their windows, more in bigger homes), temples, forts, towers, gates, docks and venues light torches, one walker in three carries a lantern, raiders carry torches, and fires light up their surroundings. Closed buildings (no staff) and farms, workshops and storehouses stay dark. Tool previews, radius overlays and selection outlines are drawn after the lighting, so they are always bright. Info overlays turn the tint off.
* **Seasons** (*Settings*: Seasons). The month sets the colors: Ianuarius is mid-winter, Aprilis mid-spring, Iulius mid-summer, October mid-autumn, and the months between blend. Winter: grey-green grass and a third of the round trees bare. Spring: fresh green, meadows full of flowers, blossoms on some trees. Autumn: olive-gold grass and orange, gold and red leaves. Cypresses never change.
* **Weather** (*Settings*: Weather). A spell of weather lasts 35 to 110 seconds of game time, then the next is drawn with odds by season (summer is mostly clear with the odd thunderstorm; autumn and winter bring more rain; snow falls only in winter and turns to rain when spring comes). Rain and snow never fall together: when one follows the other, the first stops before the second starts. Overcast dims the scene and hides sun shadows and cloud shade. Thunderstorms flash (at most every 5 seconds) and thunder rolls in a moment later; heavy storms make some homes light their lamps by day. Birds stay home at night and in rain or snow.
* **Reduced motion.** When the system asks for reduced motion, decorative motion stops: no swaying trees, glints, falling rain or snow, lightning flashes, fling or zoom animation. Colors, lights and flags (held still) remain.
* **Debug console:** `weather rain` (clear, cloudy, rain, storm, snow) changes the weather now; `sky 0.8` freezes the time of day (0.3 noon, 0.67 sunset, 0.8 night) and `sky off` lets it run again.

## Music

Original music, composed while you play and played by synthesized instruments (nothing is recorded, so it never loops). It starts after your first click or key press (a browser rule), and follows the city:

| Mood | When | Sounds like |
|---|---|---|
| Menu | The main menu | Stately reed pipe over lyre, dorian or aeolian |
| Day | Building the city | Lyre, reed pipe or pan flute, light frame drum; mixolydian, dorian or ionian, in 4/4 or a lilting 6/8; 8 to 20 seconds of silence between pieces |
| Night | After dusk (with *Day and night* on) | Slow pan flute and sparse lyre, no drums |
| Festival | For a while after a festival, and on victory | Bright lydian or mixolydian dance with jingles |
| Danger | While raiders are on the map | Fast phrygian war drums, horn calls, no pauses |

A new mood takes over at once: the old piece fades out in a second and a half. *Settings* has a music switch and its own volume (separate from sound effects); **M** switches it too; *Mute all sounds* silences everything. Console: `music` (status), `music next`, `music mood danger` (or `auto`), `music check` (render and measure every mood), `music wav day 60` (download a WAV).

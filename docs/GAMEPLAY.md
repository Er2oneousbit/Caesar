# Gameplay guide

The rules and numbers behind Colonia. Every number here comes from `src/config.js` or `src/data/*.js`; if you change those, update this page (the in-game Help tables are generated from the data automatically).

## Time

* 1 day = 1 second at normal speed, 16 days per month, 12 months per year (about 3 minutes per year at 1x).
* Speeds: 1x, 2x, 3x, 5x. Walkers move about 2 tiles per second at 1x.

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
| Iron Mine → Weaponsmith → Weapons | mine touching rocks (export good) |
| Marble Quarry → Marble | touching rocks (export good) |

## Money

* **Wages:** default 24 Dn per worker per year (Rome's fair wage). Paid monthly.
* **Taxes:** at the default 7% rate each resident pays `2 x tier tax level` Dn per year (a Domus resident ~6, an Insula resident ~10, a Palatium resident ~32). The rate scales this linearly. Only homes a tax collector visited pay.
* **Tribute:** each year Rome takes half a denarius per citizen above 150. Paying raises favor; failing costs 10 favor.
* **Trade:** open a route once, then caravans come every 32-56 days to a staffed warehouse on the road network. Each good can be set to export (keep a reserve) or import (up to a target). Partners buy and sell limited amounts per year.
* Construction needs money in the treasury; running wages into debt costs 3 favor a month.

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

Mood 30+ brings settlers; below 25 people start leaving.

## Fire and collapse

Every building gains fire and collapse risk daily (houses by level, industry faster). At 100 there is a 25% chance per day of disaster. A burning ruin burns for 6 days and can spread (3% per neighbor per day). Prefects within 24 road tiles are dispatched automatically.

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
* **Peace:** +1 a month while mood is 45+, -2 while it is under 30.
* **Favor:** requests (+10 / -12), tribute, gifts, debt. Drifts toward 50. At 0 you are recalled (game over).

A mission is won when every goal is met at the same time (checked monthly). You can keep building afterwards.

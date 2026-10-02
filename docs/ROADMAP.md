# Roadmap

What exists, what Caesar III had that Colonia does not (yet), and how to modernize it. New feature requests are added here first; bugs are fixed right away.

## The plan: a remake, modernized

Colonia is a remake and modernization of Caesar III. The original's rules, buildings and campaign shape are the core, rebuilt with original art, sound and text. On top come the quality-of-life changes players now expect, many of them first seen in the community engines: Julius (the original's exact game logic on modern systems) and Augustus (Julius plus gameplay improvements such as roadblocks, market special orders and monuments).

## Next up (suggested order)

1. **Campaign branches and more tiers** (parity #13): a peaceful and a military province at each step (steps 3, 4 and 5 came in v0.15.0), in this order:
   * Steps 6 and 7: a sibling for Oasis Aurea and one for Urbs Magna, each of the other kind.
   * Three more tiers, steps 8, 9 and 10, each with two paths, so the career reaches the top ranks (Colonia's 11 ranks: one per step, and the last rank for winning the last step, or as the ranks are mapped then).
   The last tiers reach populations in the tens of thousands and ratings in the 80s, with harder provinces (disease, crime, the Emperor's legions and requests for troops). Each new mission gets its `paceYears` from `npm run sim -- --pace`. **The rule: a mission's goals must fit its jobs.** Its population goal is at most what a sensibly built city of its buildings employs at 10% unemployment (`src/sim/capacity.js`, `npm run sim -- --capacity`), and its map must house and feed that many; `tests/campaign.test.mjs` holds every mission to it (missions 3 to 7 are listed exceptions until the late missions get their jobs). So the later tiers need the economy's jobs first: see "The late missions need more jobs" below.
2. **Logistics from the mods**: market special orders, partial warehouse storage, supply posts for forts, and roadblock permissions on gates, bridges, granaries and warehouses.

Alongside: the sim fuzzer and the save corpus, so all of this lands without breaking anyone's city.

## Done (v0.15.0)

* **Campaign branches** (parity #13, the first three): after a win you choose your next province, a peaceful or a military one, both at the same rank, and may switch tracks at every choice; a city that is overrun is offered the same step's choice again. Three new provinces, all Roman colonies of the 270s and 260s BC: **Firmum** (military, step 3, beside Figlina), a frontier hill town against the Picenes with a legion fort and the Campus a step early, raids from its second year and a call for troops for Ariminum; **Paestum** (peaceful, step 4, beside Pons Aelius), an old Greek city of temples trading by sea; **Beneventum** (peaceful, step 5, beside Portus Mercatorum), a market town on the Via Appia. Their population goals fit their jobs (`npm run sim -- --capacity`): 1,100, 2,700 and 3,000 people; peace sets their pace (2.3, 3.75 and 4.2 years). Savings go to both provinces of the next step
* The campaign's pace rule is per step: a mission is no shorter than the shortest of the step before
* Headless sim: Easy, Normal, Hard and Insane identical to v0.14.0
* 548 unit tests, 127 browser checks

## Done (v0.14.0)

* **Caesar's legions** (parity #1): favor at 0 no longer recalls the governor. At favor 10 or less Caesar warns and, 12 months later, sends his legions (16, 32, 48, then 72 imperial legionaries, times the raid lever, at most 75), shown marching from Rome on the empire map. They go for the governor's residence, then the best homes. Favor recovering past the difficulty's band sends them home, a middle band halts them, and only destroying them earns +10. A mission is lost only when the city is overrun: the legions and raiders outnumber its soldiers by more than 2 while it holds under a quarter of its peak population. A walled-in map entrance does not keep them out, a legionary leaves alone a soldier he cannot reach, and any army goes home after two years
* **Distant battles** (parity #1): Caesar asks for troops in missions 4 to 7, and now and then in a sandbox with raids on (only a city with soldiers, or ships for a city by the sea, is asked). Forts and Naval Stations have an Empire service switch; liburnians can go when the threatened city lies on a sea route (Colonia's own). The battle weighs every man and ship sent (a trained one counts more) against the enemy: a win is +25 favor and the right to a triumphal arch, too weak -10 and every man lost, too late -25, nobody sent -50. Four new cities to defend on the empire map: Placentia, Ariminum, Saguntum and Messana
* **Triumphal arches** (parity #16): free, 3x3, across a road, one per battle won; very desirable
* **The governor** (parity #6): eleven ranks from Citizen to Caesar, one per campaign mission for now (the sandbox picks one); a monthly salary, set in the Imperial advisor, paid from the treasury into personal savings that go with you from mission to mission. Paying yourself above your rank costs favor at New Year, judged on what was actually paid, and what was drawn above it in the year of victory is taken back. Gifts to Caesar now come from your savings, priced by them, each further one within a year pleasing him less; donations from savings go to the treasury. Three residences (Praetorium, Praetorium Maius, Regia), one at a time, the rioters' first target
* **Military Academy and Portus** (parity #17): recruits pass through the academy on their way to their fort, and soldiers at rest take turns; a trained legionary holding his ground takes a quarter of missile damage and gains defense, and counts more in a distant battle. The Portus (Colonia's own, after Agrippa's training harbor) does the same for liburnian crews: faster, ramming 55 instead of 45, better defended
* **Large temples** (parity #18): a 3x3 Templum for each god, counted as two temples
* **Latin names**: every building shows its Latin name (Castra, Horreum, Balneae, Excubitorium...), with the English name under it in the build menu and beside it in the inspect panel; the manual has a table of them
* Fixed: the box under the build menu grew with a hovered item's description and pushed the last item of a scrolled list out from under the pointer, so a click on it missed
* Headless sim: Easy, Normal, Hard and Insane identical to v0.13.4 apart from building names in messages (the demo city never lets favor fall, sends no troops and builds none of the new buildings)
* 537 unit tests, 123 browser checks

## Done (v0.13.4)

* **Prefects and engineers watch the whole neighbourhood**: at a junction they are drawn to the way whose buildings are closest to burning or falling down, and a post sends its next walker as the last one turns for home instead of waiting for him to walk back. In a mission 2 playtest the far street of a block six tiles from its prefecture went 165 days unvisited (a Stone Cottage burns at about 100) and five homes burned within weeks; the longest gap there is now 58 to 82 days over six seeds, and the city that lost 35 buildings in three years loses none after the homes already at the brink when it was saved. Headless sim: fires 0 on every level (Normal was 1, Hard 1, Insane 3); on Normal over five seeds fires 14 to 0, collapses 4 to 4, homes moving down 363 to 242. A hippodrome draws them too, by its risk on any of its sections
* 432 unit tests

## Done (v0.13.3)

* **Carters are clickable on their carts**: a click on a cart (or on a farm wagon and its ox) picks the carter pushing it. The click target covered only the figure, while the cart drawn ahead of him is most of what the eye sees
* 429 unit tests

## Done (v0.13.2)

* **The Health, Education and Entertainment advisors fit a phone in any font**: with wider fonts (Linux's defaults, Verdana) the Entertainment advisor's Venues table ran 15 px past a 390 px screen and scrolled sideways. On narrow screens the coverage tables now tighten and their figures may wrap. The browser check measures the three tabs in Verdana too, so it catches this on any machine (it failed on the old styles)
* **Play in the browser**: the game is published on GitHub Pages at https://er2oneousbit.github.io/Colonia/ once CI passes on the release branch (the same tested `dist/colonia.html`), and the README links to it
* On GitHub Actions a failed browser check, or a crash with the last check that passed, is written as an error annotation, public on the run's page, so a CI failure names itself (the run's log needs admin rights)

## Done (v0.13.1)

* **The info panel keeps still while you aim**: its timed refresh (every 0.7 s) now rebuilds off-screen and swaps in only when something changed. Before, the whole panel was replaced each time, so on a slow machine a button (a storehouse's order) was never still long enough to click; the browser checks failed on the CI runner for that reason
* Browser checks made sound on slower machines (run at a 4x slower CPU, 4 runs of 114/114): the snowy look may take up to 90 frames to swap in whole (more art came with v0.13.0), and the roadblock click waits until no walker stands on it
* Notes and code comments say what changed and why, in neutral terms

## Done (v0.13.0)

New advisors, the sea, cloth and a fleet.

* **Health, Education and Entertainment advisors** (parity #15): per kind of building, how many are built and staffed, the people their walkers reach and how many of the people whose homes need them they serve (Colonia's walker reach and venue seats, in twelve coverage words), with one line of advice on what holds homes back most; city health, its trend and the year's outbreaks; the Overview's health and crime lines. Click a building type to go to each in turn
* **Fishing** (parity #2): a Shipyard builds fishing boats (16 days, no materials, one spare); a Wharf's boat sails to the nearest fishing ground (where the gulls circle, found in the map's own water, never saved), fishes 4 days and brings home 100 fish, carted to a granary. **Fish is a food of its own** (a fifth kind beside wheat, vegetables, fruit and meat; no home's food need changed). Fishing goes on in an Insane winter. From mission 4
* **The hippodrome** (parity #5): a 15 x 5 racetrack (three linked sections), one per city, with a Chariot Maker sending the teams; while races run its charioteer gives homes 30 entertainment and its seats cover the whole city, and prosperity rises a little. Mission 7 and the sandbox. Measured with it, the top homes cleared their entertainment needs easily, so they rose: Grand Palatium 70 to 80, Imperial Palatium 80 to 95, which now needs a hippodrome. In missions 5 and 6 (no hippodrome) the top home is now the Grand Palatium
* **Cloth**: a Flax Farm, a Linen Maker and a Clothing Maker; **homes need clothing from the Insula up**, beside pottery, furniture and oil. Alexandria and Tarraco sell linen, Capua and Corinthus buy clothing. From mission 4. Older saves give homes of Tenement and up 3 months of clothing to start
* **Sea raids and a provincial fleet** (Caesar III had no war at sea): on maps where navigable water reaches the sea, about a third of raids come in raider ships that land their warband on the shore, throw fire pots at fishing boats and buildings by the water, then wait offshore and take the survivors home. Rome's answer is the **liburnian**, a light two-banked warship with a ram: the **Navalia** builds them from timber, iron and linen, and a **Naval Station** berths a squadron of four that you deploy like a fort's soldiers. In a scripted raid of 16 by sea, an undefended town lost about 10 buildings and 960 Dn; with a squadron about 3.5 and 320 Dn, and most raider ships sank before landing. On by default with a switch (sandbox setup and Settings) for the original's land-only raids (see Decisions). Missions 4, 5 and 7 and the sandbox
* Saves are version 11 (9 fish and the hippodrome, 10 cloth, 11 the fleet); version 4 to 10 saves load
* Measured against v0.12.2: `npm run sim` byte-identical on all four difficulties; the campaign's pace unchanged; the sweep identical for missions 4 and 5, and mission 7 (its raids now partly by sea, and the sweep's city builds no fleet) loses more to raiders: peace after 5 years 34 to 18-23
* Four browser checks that failed now and then had their causes found and fixed (a walker leaving the map mid-click, a farm needing all nine tiles of meadow, a panel read during its rebuild, a deploy click landing on the info panel)
* 428 unit tests (+87), 114 browser checks (+14)

## Done (v0.12.2)

From playtests on Normal and Insane, a 5-year sandbox save among them:

* **Dock trade as in the original** (ships traded everything the moment they arrived and left 6 days later): a ship ties up and waits while the Dock's workers carry its goods. A crane lands imports on the quay, 400 units every 3 days (paid as they land), and up to 3 dock workers (by staffing) cart them on, wherever any cart would take them, then fetch exports from warehouses within 60 road tiles and hand them aboard (paid on hand-over), 400 units a trip. The ship sails when both sides are done, after 48 days at most, or at once with nothing to trade. A full exchange takes about 18, 25 and 38 days with the warehouse 5, 10 and 15 road tiles off (the original's 23, 33 and 44). One Dock is now busy most of the year: a city trading with several sea partners does better with two (exports 4,309 Dn a year with one, 5,440 with two, in the harbor sim). The Dock's and the ship's panels show what is left to unload and load. None of the original's dock bugs (paid exports left behind, lost imports)
* **Ships at the original's pace**: every 64 to 96 days per sea route (were 32 to 56, twice the original's), carrying up to 2,400 units each way (were 1,200); caravans unchanged. On **Insane** half as many caravans and ships come in winter. A partner's distance changes nothing, as in the original; on the empire map a new route's first trader now sets out from its city instead of appearing halfway
* **The empire map is the real Mediterranean**: Iberia, Gaul and the Alps, the Italian boot with Sicily, Sardinia and Corsica, Greece and the Aegean, Asia Minor, the Levant, Egypt and the Nile, North Africa, with rivers, mountains and region names; every city where it really is (Lugdunum up the Rhone, Corinthus on its isthmus), your province on the Etruscan coast; land routes over land, sea routes over water (tests hold both)
* **A slower calendar**: a year takes 8 minutes at 1x (was 5.3), a season 2 minutes (seasons went by too fast). Nothing changes in game time; 2x-8x run faster
* **Fire, collapse and disease at the original's pace**: every fire and collapse rate runs x0.62, the original's clock (an ordinary building left unserved on Normal lasts about 10 months); disease 0.5 -> 0.2 a day at most, and a sick home now adds 0.3 a day to its neighbors (was 1, five times a Family Tent's own: in a 5-year playtest save one outbreak set off whole blocks, about 30 a year among 31 homes; replayed, about 10)
* **Later trouble**: the Emperor's first request comes 36 to 48 months in, from 500 people (was 14 to 26 months, from 150); a sandbox's first raid after 8 years with occasional raids and 5 with frequent ones (were 5 and 3). The sandbox setup said raiders need 120 people; it is 300
* **Rubble has a Rebuild button**: the same building on the same spot (a home's plots as empty lots), at the usual price plus clearing, undone like any building
* **Caravans and ships list their business**: on their way in, what they come to buy and sell; once traded, what they bought and sold here and the denarii each way
* **People are easier to click**: the walker under the pointer is taken when the button goes down (a walker moved on before the release), with a bigger target on open ground; a building or roadblock under the click keeps it
* **Baths without piped water look dry** (they were always drawn full)
* **The demo city gives every building a road** (rock or water could break one of its fixed streets: 51 of 120 menu towns showed no-road signs, and the balance sim's cities had road-less fountains). Its money yardstick moved: mission 3's town now pays its fountain workers
* Saves are version 8 (dock trade); version 7 to 4 saves load (a ship moored in a version 7 save sails on at once)
* Measured against v0.12.1 (`npm run sim`, 3 years): Normal fires 1 -> 1, outbreaks 5 -> 0, peace 33 -> 36; Hard 618 -> 669 people, fires 5 -> 1; Insane 515 -> 620 people, fires 13 -> 3, margin -3,141 -> 384. The campaign's pace unchanged in years
* 341 unit tests (+31), 100 browser checks

## Done (v0.12.1)

* **The main menu never shows the dark beyond the map** (it opened with a lot of black on the screen). Its town was built on a 64-tile map, often near the edge, and the view centered on it; the menu map is now 96 tiles and its slow tour is fitted to the screen: the town in the middle where the map allows, else the tour moves inward (keeping the town in view) and swings less, and a screen bigger than the map zooms in, fitted again when the window changes size. Probed at 1920x1080, 1280x800, 2560x1440 and a phone over six random menu maps: no screen corner off the map in five minutes of drift
* The roadmap's open lists hold open work only: done parity items leave the list (each open one keeps its number), and partly done items say what is left
* 310 unit tests (+1), 98 browser checks

## Done (v0.12.0)

Trade, storage and the gods (parity items 10, 12 and 14), and fixes from playtests of missions 1 and 2:

* **Granary and warehouse orders** (parity item 10): each good in a warehouse, and each food in a granary, is set to Accept, Refuse or Get (click to cycle), and each building has an Empty switch. Refuse and Empty stop deliveries only: markets, exports, the Emperor and other buildings' carts still take from it. Get sends the building's own cart along its roads to fetch from other storage (a warehouse keeps 5 to 8 loads, a granary fills up; never between two buildings on Get, never the last 100 units of a food); Empty sends its goods to barracks, workshops, granaries or other warehouses, a load at a time, skipping a good with nowhere to go. Room is held for every cart on its way, so nothing is lost. The info panel says what Get and Empty are doing. Nothing changes for a city that never sets an order (the sims are identical). Not copied from the original: its distance bug, lost loads, Get while emptying, one stuck good blocking Empty
* **The empire map** (parity item 12; E, the compass in the top bar, or the Trade advisor): the inland sea from Tarraco to Alexandria with Rome, your province and every partner's route; click a city for its trade card and the button to open the route. Caravans and ships travel their routes in the partner's color with the days until they arrive; a scouted warband closes in with its size, its side and the months left, and clicking it shows the map edge it will enter by. Works on phones
* **The original's five gods** (parity item 14): Ceres, Neptune, Mercury, Mars and Venus; Mercury and Venus replace Jupiter and Vesta, and every temple costs 50 Dn, each with its own roof color. **Mercury** blesses the emptiest working granary with 600 of each food; his wrath takes 1,600 units from the fullest storehouse, and angered again before he calms, burns it. **Venus** lifts every home's mood by 25 and the city's by a boost that fades; her wrath caps home moods and lowers the city's, and angered again, homes with poor health care gain disease risk. The first two missions are spared the harder wraths. Older saves carry Jupiter's temples, mood, priests and access over to Mercury, and Vesta's to Venus
* **Carts show what they carry**: sacks of wheat, crates, baskets, joints of meat, lumps of clay, logs, ingots, marble blocks, pots, amphorae (wine dark-stoppered, oil pale), furniture, shields and spears, sheaves of arrows, stacked 1 to 4 by how full the cart is; farm wagons are drawn by an ox, horses are led on a rope, and caravans' mules carry away what they bought
* **Fire and collapse at the original's balance** (fire came much faster than collapse): workshops and the timber yard now burn and collapse at one pace (they burned 1.5 to 2.8 times sooner); warehouses, engineer's posts, wells, fountains and reservoirs never burn or collapse on their own. Homes are unchanged (tents and huts still burn first, as in the original). Over 18 demo cities at Normal, fires to collapses went from 112:15 to 78:12; the sweep's mission 3 city on Normal had 19 fires in 5 years, now none
* **Mission goals that fit the jobs** (in a playtest, mission 1's 1,200 people could not be employed by its buildings, so unemployment held mood under the 45 peace needs): missions 1 and 2 now ask for 300 and 450 people, what a sensibly built town of their buildings employs at 10% unemployment, measured by play (`npm run sim -- --unlocks` builds only what a mission allows). Mission 3 unlocks the amphitheater and gladiator school, so its homes reach Domus. A test holds every mission's goal to what its buildings can employ (`src/sim/capacity.js`, `npm run sim -- --capacity`); missions 3 to 7 are listed exceptions until the late economy has more jobs (see below)
* **Buildings with no road are impossible to miss**: a red no-road sign floats over any working building no road touches (and any home with no road within 2 tiles); while placing, the preview turns orange, the edge tiles where a road would serve are outlined, and the warning shows by the cursor; a building that has gone 8 days without a road says so once in the messages. Any edge touching a road works, whichever side its door is drawn on; a corner does not. (In the playtest, prefectures and engineer's posts set inside housing blocks never got workers, and the town burned and collapsed by month 7)
* **Rubble remembers** what stood there, how it fell and when: "Ruins of a Prefecture, burned down in Iul 280 BC"
* **Unemployment on the top bar** (⚒, beside the mood): amber above 10%, where it starts to cost mood; its tooltip says how much, and a click opens the Labor advisor
* **The reservoirs' piped area is teal**, so placing a fountain shows the existing fountains' reach (blue) on top of it; in the same pale blue the two could not be told apart
* **Export any save** to a file from the Save and Load menus (💾 beside each slot), without loading it; *Export current game* exports the game being played
* The main menu's backdrop tours its town in a slow figure eight (it used to pan away until the town was out of sight)
* Saves are version 7 (storage orders, rubble records, the five gods); version 6, 5 and 4 saves load
* Measured against v0.11.1 (`npm run sim`, 3 years): Normal 525 to 669 people, fires 9 to 1, margin 587 to 5,199 Dn (its mood falls 45 to 40 and peace 53 to 33: the bigger town meets the job shortage below); Hard fires 11 to 5; Insane margin -4,586 to -3,141. Sweep, missions 3, 4 and 6 over 5 years: fires down on every difficulty but mission 6 Hard (11 to 20); Insane's mission 3 need 8,402 to 5,291 Dn; mission 4 peace on Normal 36 to 80. The campaign's pace changes only for missions 1 and 2
* 309 unit tests (+81), 98 browser checks (+18)

## Done (v0.11.1)

* **Money for every difficulty, measured** (the aim: a sensibly run city of modest homes pays its way; the lever is taxes). Each resident now pays 5 Dn a year per point of their home's tax weight, not 2: before, only a city of Apartment Houses paid its wages, so every smaller one lost money on every difficulty, and the starting funds only said how soon it went broke (a sensible city on Normal was in debt by its third year in mission 3; on Insane by month 8). A Cottage town now about pays its way and better homes make a profit; the starting funds are unchanged
* **`npm run sweep`**, the balance table: every difficulty on every campaign map, with a level 3 demo city (piped water, so its homes climb like a player's) that rebuilds what burns or collapses; it reports the money the city needed against what the difficulty gives, beside population, mood, peace, fires, thieves and outbreaks, read against each difficulty's intent (Easy never short, Normal comfortable, Hard tight, Insane barely enough). `npm run sim` now reports that money too (its city starts rich, so it never showed)
* Measured with the sweep, missions 4, 6 and 7 (margin as a share of the starting funds): Easy about +75%, Normal +50%, Hard +3% to +27%, Insane about -50% for the demo city (it keeps a fixed layout and rebuilt 50 to 156 burned buildings in 5 years; a sharp player covers fires better). Replaying the lost mission 3 Insane game with the same moves: it now stays solvent (at worst -112 Dn after thieves took 1,135) instead of 1,276 Dn in debt, so money is no longer what decides Insane; mood (about 30 after the new-city bonus ends) is. The early missions stay harder for the demo city, partly because it builds what they do not unlock
* 228 unit tests (+2), 80 browser checks

## Done (v0.11.0)

Fixes from playing mission 3 on Insane (the game said things that were not so, or said nothing):

* **Homes with food** (Overview) counts the homes whose people eat (tents forage, and are left out) that hold food. It used to count homes not going hungry, and tents never go hungry, so a city of tents with no food anywhere read 100%. The mood's food factor is unchanged
* **Wells and reservoirs out of every engineer's reach**: they need no road, but they wear out, and an engineer repairs only what lies within 2 tiles of the road he walks. Placing one further off now warns, and its panel and the Problems overlay flag it (a reservoir collapsing unseen dries every fountain and bath it feeds)
* **A home's tax line says why it pays nothing**: no Forum, a Forum without workers or a road, or no tax collector in the last 48 days (with what to do about it); a registered home shows how many days its registration has left. It used to say "needs a Forum nearby" with a Forum next door. The Finance tab counts the homes that are not registered
* The balance sim is byte-identical on every difficulty after these three
* **Loans from Rome** (Finance advisor): a city in debt could never build again, so one that lost its Forum while in the red could never recover. Rome now lends 2,000 Dn whenever no loan is being repaid, repaid monthly over 24 months with interest by difficulty (10% Easy to 40% Insane, a new lever in the difficulty table); the debt message points to it. Borrowed money is not counted as profit. A city that never borrows plays exactly as before
* **Roamers prefer streets with something to serve**: at a junction a roaming walker looks up to 8 tiles down each way (stopping at a roadblock that would stop it) and favors the ways lined with buildings or reaching one, so short spurs to an outlying building keep their visits. A lone Forum's tax collector (and the engineers) used to spend whole rounds on the Imperial road out to the empty map edge. Replaying the mission 3 game with the same moves, the three key buildings that collapsed in August now stand. Over 12 maps: fires down on every difficulty (Hard 11 to 7.8 in 3 years), protests down, the campaign's pace unchanged

* **Disease** (parity item 4): every home has a health score (its level, a medicus, a hospital within reach, baths, a barber, fountain water, each kind of food; at most 40 with no food at all). Crowded, unhealthy homes build disease risk like fire risk, and a passing physician clears it; at 100 a home may fall sick: a fifth of its people die (a tenth near a hospital), and for 32 days it cannot move up or take in settlers and may pass it to the homes touching it (once a day each). A staffed Medicus sends a physician to cure it, as prefectures send prefects to fires. City health (the residents' average score) moves 2 a month, shown only. None below 200 people or in the first two missions; a new difficulty lever (x0.5 Easy, x1.3 Hard, x1.5 Insane). A Disease overlay (disease risk, sick homes marked), a *Health* section in the house panel, a pale cloth on a sick home's door post, sick homes and homes in unrest first on the Problems overlay, citizens who talk about it, console `health` and `sick`, and the sim report's outbreaks and deaths
* Saves are version 6; version 5 and 4 saves load with nobody sick
* Measured, 12 maps x 3 years against v0.10.1: population up on Easy, Normal and Hard (Hard 425 to 456), fires down on every difficulty (Normal 4.8 to 3.0), outbreaks per city 0.1 (Easy), 0.8, 1.0 and 4.6 (Insane); Insane's neglected demo city also meets more thieves (4.8 to 12.4) and a little less peace (31 to 28); the campaign's pace unchanged
* 226 unit tests (+34), 80 browser checks (+1)

## Done (v0.10.1)

* **Crime costs peace by difficulty**: none on Easy; on Normal a riot costs 5 and a thief 1 and that month's gain; Hard doubles it (10 and 2), Insane triples it (15 and 3). Protests stay free, except on Insane, where every fifth costs 1: even a well-run Insane city sees about 17 a year, so a cost for each would sink peace faster than it can grow. Measured over 12 maps: Easy, Normal and Hard play exactly as v0.10.0; Insane ends 3 years with peace 31 instead of 45, and a neglected Insane city loses it all
* 194 unit tests (+2), 79 browser checks

## Done (v0.10.0)

* **Crime** (parity item 3): every household has a mood of its own (the city's mood plus hunger, food variety, envy of the rich, its street's desirability, and whether the tax collector has found it), used for crime only; settlers still follow the city's mood. Once the city has 300 people, each day the unhappiest home that still can may send out a **protester** (harmless), a **thief** (walks to the Forum or Senate and steals a quarter of the year's taxes, at most 400 Dn and never more than the treasury holds; with no Forum in reach, half a market's biggest stock) or, in a very unhappy city, a **riot** (the rioters burn their own home and march on the most prized building nearby, setting fire to what they pass; afterwards every home's mood rises by 20). The chance follows the city's mood, times a new difficulty lever (x0.5 on Easy, x1.2 Hard, x1.4 Insane), and none in the first two campaign missions
* **Prefects as police**: a prefect passing a home halves its chance of trouble for 32 days (a change from the original, where patrols did not prevent crime); prefects and soldiers catch the criminals they meet, and prefects on patrol chase thieves and rioters within 30 tiles. A prefect who catches a thief on the way saves the money
* **Peace**: a month with a thief about brings no peace gain, a riot costs 5 at once; protests cost nothing
* **Crime overlay** (a column over every unhappy home by its mood, taller for a home that already sent a criminal; point at one for its mood, its worst trouble and whether a prefect patrols it), a *Mood and order* section in the house panel, *Stolen by thieves* in the Finance ledger, citizens who talk about it, and protester, thief and rioter walkers of their own
* Console: `crime`, `crime protest|thief|riot`, `riot`, `unrest <n>`; `npm run sim` reports protesters, thieves, thefts, riots and what rioters burned
* The balance sim's demo city now builds every service it plans (on its default seed it had silently lost its Forum and second market, so it never collected tax); the balance baseline moved with it (see the commit)
* Saves are version 5; version 4 saves load with fresh moods and no crime yet
* 192 unit tests (+32), 79 browser checks (+1)

## Done (v0.9.1)

* **The Problems overlay** (top bar): a column over every home that cannot move up, colored by the first thing it lacks (water, food, temples, entertainment, education, health, goods, desirability, room to grow) and taller when it is already falling back (none where the next level needs something the mission cannot give, such as fountains in the first mission); red over empty lots no settler can reach and over buildings that do not work, amber over those that work badly. Point at a column for the reason in words; a legend lists the colors (not on phones, where a tap on the building says it)
* **The Production advisor**: per good, what was made, used, imported and exported last month and what the storehouses hold, with the month's change; the buildings that are not working, grouped by reason, each group with a *Show* button that goes to the next one; and the bottlenecks in plain words (workshops waiting for a raw material, with what makes it and who sells it; buildings without workers; harvests with nowhere to go; goods used faster than they come in; homes short of food)
* **Trend charts** on the Overview tab: population, treasury and mood, month by month, up to 20 years
* A goods book in the simulation counts it all (bookkeeping only: the city plays exactly as before)
* 160 unit tests (+5), 78 browser checks (+3)

## Done (v0.9.0)

* **Roadblocks** (Roads menu, 12 Dn): placed on a road, they turn back walkers who roam the streets serving homes, so a temple, market or school serves the blocks you mean it to. Click one to let groups through: prefects and engineers, priests, market vendors, entertainers, teachers and librarians, barbers and physicians, tax collectors (none at first). Carts, market buyers, settlers, caravans, prefects running to a fire and roamers on their way home always pass, and soldiers and raiders never notice one. Clearing a roadblock leaves its road; roadblocks are saved (older saves load without any)
* **Click a walker** to see who it is, where it comes from, what it is doing and carrying, and what it has to say: citizens talk about what troubles the city most (raiders, hunger, fires, no work, taxes, low pay, debt, an angry god, a gloomy mood) or about their own work, newcomers about their hopes, emigrants about why they leave, traders about trade. All the lines are Colonia's own. *Follow* keeps the walker in view until you move the map; a ring marks it
* In-game help: roadblocks and walkers; the raid rule now says 300 people (it still said 120, from before v0.7.5)
* 155 unit tests (+7), 75 browser checks (+6)

## Done (v0.8.2)

* **A longer campaign**: the seven missions' goals follow the 20-level ladder and set their length. Mission 1 asks for 1,200 people, culture 15 and peace 35 (was 250 people alone, won in about 5 months); mission 7 for 12,000 people, culture 75, prosperity 70, peace 75 and favor 65 (was 6,000, 60, 55, 40, 55). Each mission's culture and prosperity goals ask for a good share of what its buildings can give, and the homes they allow climb through the campaign: Huts, Townhouses, Domus, Villas, then every level
* **Bigger maps** for missions 2 to 7: 96, 112, 128, 128, 128 and 160 tiles a side (were 80, 96, 96, 112, 96 and 128), each with farmland for half as many again as its goal
* **Planned pace**: the fewest game years the goals allow, from the game's own rates (settlers a month at a good mood, peace a point a month, culture and prosperity a few points a month): 1.3, 2.2, 3.6, 5.7, 7.8, 8.5 and 15.4 years (were 0.2 to 7). With the city to build first, that is roughly half an hour for the first missions and a few hours for the last at normal speed. `npm run sim -- --pace` prints the table; a test holds each mission to its plan
* The first mission has a Forum: a longer first mission needs taxes (the demo town went broke in about two and a half years without one)
* Mission hints use the new level names and say what the goals need (peace needs a mood of 45 or more; the top homes need wine from two sources)
* Missions already under way keep their map and take the new goals
* 148 unit tests (+4)

## Done (v0.8.1)

* **Every god's temple looks like its god**, on the map and in the build menu: roof and wall colors, the god's color and emblem on the pediment, and something of the god's in front (Jupiter: a gilded roof, a thunderbolt and an eagle on a column; Ceres: an ochre roof, a wheat sheaf and baskets of the harvest; Neptune: a verdigris roof, a trident and a pool with a dolphin; Mars: a dark red roof, a shield and a trophy of arms; Vesta: a round temple with a bronze dome and the sacred hearth, as the real one in the Forum). Mercury's and Venus's temples are drawn already, for the switch to the original's five gods (since made: item 14, where Jupiter's and Vesta's temples gave way to theirs)
* **New statues**: a marble orator on a moulded pedestal, a bronze warrior with spear and cloak on a stepped plinth among cypresses and flower beds, and a bronze horseman on a tall inscribed pedestal in a paved square
* **A new iron mine**: a rocky hillside with a timber-framed entrance, a winding frame, rails, an ore cart and a heap of red ore
* **Aqueducts**: the channel steps down to a reservoir's rim and pours in (it used to butt into the reservoir's wall above its rim); a straight aqueduct crossing a road is a bridge, a pier each side and one wide arch with the road beneath
* `render.html?artset=1` sets out these pieces beside the demo city; the art sheet shows every temple, statue and mine (`extras=1`)
* 144 unit tests (+3)

## Done (v0.8.0)

* **A library of music tracks**: ten named tracks of 3 to 5 minutes for the menu, the day and the night (*Colonia*, *Prima Lux*, *Mane in Foro*, *Via Nova*, *Aquae Vivae*, *Messis*, *Lares*, *Vesper*, *Nox Serena*, *Stellae*), picked at random and never one of the last three. Pieces used to be about 20 bars, under a minute, each a new random one. Each track is written from a fixed seed with its own key, tempo, meter, pipes and tune, so it sounds the same every time, and has its own way in: the lyre alone, a drone and a pipe call, the drums building up, the pipe alone, a slow swell, or the whole band
* Longer forms for all music: an opening, rounds of sections until the piece is long enough (the theme, a higher answer, a calmer contrast on the other pipe with a thinner accompaniment, a passage for the lyre alone), and an ending. Festival and battle music keep pieces of their own, new each time, now about 3 minutes (were under one)
* No more cut-off tracks: raiders and festivals still take over at once, but between calm moods a track that plays in the new mood carries on, and one that does not finishes its phrase and plays its ending
* Console `music tracks` and `music play <track>`; the music lab plays each track
* 141 unit tests (+5), 69 browser checks (+1)

## Done (v0.7.5)

* **Raids come later**: the first raid waits 5 years with occasional raids (was 2.5) and 3 with frequent ones (was 1.5); campaign missions 4 to 7 wait 5, 4, 3.5 and 3 years (were 3, 2.3, 2 and 1.7); Insane still 25% sooner. No raid while the city has fewer than 300 people (was 120). There was no time to build a town and an army (an iron mine, a weaponsmith, a barracks and a fort) before the first warband: on Normal it arrived in the sandbox's third year
* Measured (demo city without an army, 4 landscapes x 3 seeds x 4 difficulties, 8 years, occasional raids): raids per city on Normal 1.5 (was 2.1), buildings lost 11 (was 16), population after 8 years +22%; on Insane cities no longer collapse (238 people after 8 years, was 85)
* 136 unit tests (+1)

## Done (v0.7.4)

* **A timber yard needs woods**: at least 4 tiles of forest within 2 tiles, to be placed (the preview turns red and says so) and to keep working. A single lone tree used to count as forest, so a third of the spots it accepted were out in open country, and such a yard ran at full speed
* 135 unit tests (+1)

## Done (v0.7.3)

* **Fires spread more slowly**: a building beside a fire is heated (+5 fire risk, was +10) and gets its chance to catch (2%, was 3%) once a day, however many burning tiles it touches; before, it rolled once per burning tile, so a big burning building rolled against its neighbors several times a day. One fire in an unguarded 48-tile block of tents now burns about 10 tiles in 40 days (median 8, worst of 40 runs 31), where it burned the whole block (46); with a prefecture beside the block, 1.4 (was 1.8). How often fires start is unchanged: in the demo-city sweep (prefects on patrol) fire counts stay about the same, population within 3%
* 134 unit tests (+2)

## Done (v0.7.2)

* The Imperial road runs straight in from the map edge for 3 tiles at both ends, so the entrance and exit gateways always face the map edge with the road passing straight through (on about a quarter of maps a road end ran along the edge and turned its gateway sideways, toward the middle of the map)
* No single-tile water: water patches smaller than a 2x2 pond become land (lakes, plains and desert maps had a few specks each)
* Settings: each checkbox stays beside its label (a long help text used to push it onto a line of its own, where it looked unlabeled above the next setting)
* Maps for a given seed changed where a speck or a road end moved; saves keep their own map
* 132 unit tests (+2), 68 browser checks (+1)

## Done (v0.7.1)

* **Water where you build**: with the Housing tool in hand, a faint blue shows where homes would get water, as the original did (paler for well water, stronger for fountain water); placing a fountain or baths shows the reservoirs' piped area in the same faint blue, so you can see where it will run. Each area gets a thin outline, and the placement preview of a well, fountain or reservoir still draws on top
* In-game help: well water turns tents into Family Tents (it still said lean-tos, from before the 20-level ladder)
* 130 unit tests (+1), 67 browser checks (+2)

## Done (v0.7.0)

* **The 20-level housing ladder** of the original game, rebuilt with Colonia's own names and numbers: single-tile homes up to level 10 (four alike, side by side, can join into a 2x2 block), 2x2 insulae and villas, 3x3 villas and palaces, 4x4 palaces. New art for the new levels (Family Tent, Stone Cottage, Merchant House, Apartment House, the 2x2 villas and the 4x4 palaces); the art sheet shows every level and the blocks, and `render.html?ladder=1` sets out one home of every level beside the city
* **The original's rules for moving up and down**: a home moves up as soon as it qualifies (one level a day) and falls back after 3 bad days in a row, a bad day being a missing need or desirability at its level's floor (each level now has its own floor and ceiling); Easy allows 6 bad days (a new difficulty lever). Growing homes take over homes of their own level or lower, then clear land, then gardens, and break up homes they only partly cover; big homes split when they fall back (keeping a corner that still has a road in reach); residents over capacity look for another home, as when an Insula becomes a Villa
* **The original's needs**: education and medical care as tiers, barber and baths as needs of their own, two wine sources for the top levels (a staffed winery, and each open route selling wine while wine is set to import), and entertainment as a city-wide base (venue seats against the population) plus the venues whose entertainers passed by, worth more while a venue runs both kinds of show. Tents forage; homes eat and stock only the kinds of food their level needs; goods are used twice a month; a service visit lasts 96 days; emigrants leave the humblest homes first, never villas or palaces
* **Where the original has a plain bug, Colonia does not copy it**: a 3x3 home broken up by a growing palace keeps all nine tiles (and its people and goods); homes that split share people and goods by the tiles each part covers; market food deliveries top a home up instead of piling a full portion on top; an unstaffed winery is not a wine source
* Mood and prosperity rescaled to the longer ladder (full marks for housing at an average of Apartment Houses and Insulae); culture needs an average entertainment of 40 for full marks (was 35), since every home now gets the city-wide base
* Saves from before v0.7 cannot be loaded, and say so (until 1.0 a release may break older saves)
* Measured (`npm run sim`, demo city, 4 landscapes x 3 seeds x 4 difficulties, 5 years, no raids): population about the same as v0.6.2 (Easy +4%, Normal +5%, Hard flat, Insane +11%), everyone fed where some cities starved (tents forage), a fifth fewer homes moving up and down on Easy and Normal (fewer on Hard and Insane too), prosperity about 3 points lower and culture 1 to 8 higher (a service visit now lasts 96 days, so more homes count as covered); the demo city (wells only, no shows) never gets past level 4 in either version, so the upper ladder was checked with desirability probes of decorated blocks instead. With Colonia's building values a well-decorated block reaches the 2x2 levels with gardens, temples and statues, and the palaces with plazas or large statues
* 129 unit tests (+26), 65 browser checks (+2)

## Done (v0.6.2)

* The `--garrison` balance simulation no longer collapses: the demo garrison had put military labor first (a v0.5.1 test fix), which left prefects, engineers and farms short of hands; on Hard and Insane most demo cities burned down or starved to 0. Over 12 maps, Insane now ends near 370 people with about 12 soldiers (was 7 people and 1 soldier). The console `garrison` showcase still puts military labor first, and now says so
* A building no longer loses its workers and walkers to a stray piece of road laid against it: buildings (and homes, within their 2 tiles) prefer a road that reaches the map entrance over one that does not, as the rules always said. This also removed the last random failure of the smoke test's garrison step (0 of 300 seeds, was 1)
* 103 unit tests (+2)

## Done (v0.6.1)

Fixes from a review of v0.6:
* Title screen: a quick Enter or key press now leaves the keyboard on the menu (it was lost until Tab); where autoplay starts a moment late (Firefox, Safari) the title card no longer flashes up and fades out
* Top bar: the season's name only shows while the bar has room (it clipped the Help and Messages buttons at about 1281-1450 px wide)
* Snow and season changes that arrive a few frames apart no longer mix two looks on screen or draw hundreds of sprites in one frame (the complete old look stays until the new one is ready)
* Map gates face the Imperial road as it was laid (saved with the map), so a road built beside the entrance or exit no longer turns the gate across the road
* Horse Ranch "Next mare" counts the Insane winter rest
* Docs: the months that blend season looks, the test list in the README
* 101 unit tests (+3), 63 browser checks (+3)

## Done (v0.6)

* **Menu music**: the music starts on the title screen, at once where the browser allows autoplay, otherwise with the first click, tap or key on a "Click, tap or press a key to begin" gate (which never presses a menu button); on phones one tap is enough (it took two)
* **Four seasons with their own weather**: Winter (December to Februarius), Spring, Summer and Fall, shown in the top bar; spring is the rainy season (nearly three times summer's rain), summer mostly clear with the odd thunderstorm, fall showery, and winter only snows (no winter rain or thunder, no snow outside winter); a new season brings new weather at once; a new or loaded game opens clear
* **Winter looks like winter**: December to Februarius are full winter scenery, and snow settles on the ground, trees, rocks, roofs and fields, then melts in spring; the new look is prepared in the background and swapped in whole (this also removed the old one-frame hitch at every month change); `snow 0-3` console command
* **Insane: nothing grows on the farms in winter** (crops, pigs and the Horse Ranch rest from December to Februarius, keeping their progress); warnings in October, December and at the start, winter-toned resting fields, info-panel status; Easy, Normal and Hard play out exactly as before
* **Map entrance and exit gateways**: stone pillars and a lintel over the Imperial road where it meets the map edge, green pennants where people arrive, red where they leave, torches at night
* A fresh map no longer scrolls off to the side by itself (a menu vanishing under a still cursor looked like a cursor at the screen edge)
* 98 unit tests (+17), 60 browser checks (+16)

## Done (v0.5.2)

* No rock or meadow within 6 tiles of the Imperial road (the first building lots are always usable; rock beyond stays for quarries and mines)
* Farm plots come as whole fields: broader meadow noise, smoothing, no field under 12 tiles, meadow share measured over land (coasts and desert oases were nearly barren); more full-fertility farm room on almost every landscape
* Easy: fire and collapse risk x0.5 (was x0.7); most young cities never see a fire
* Demo city and garrison builders only use roads that reach the map entry (fixes a random smoke-test failure)

## Done (v0.5.1)

* People walk instead of jog: the game clock runs at 12 ticks a second (a game day takes 1.67 s at 1x, balance unchanged), speeds are 1x/2x/4x/8x, and legs step with the distance walked; long-trip settlers ride their mules at a trot (2x)
* No rock within about 5 tiles of the Imperial road
* Rain and snow no longer fall at the same time

## Done (v0.5)

* **Uber maps**: 256x256 sandboxes (sixteen times Small); settlers with a long way to go ride in on mules
* **Insane difficulty**: every difficulty lever in one table (`src/data/difficulty.js`); Insane scales money, fire risk, production, immigration, city mood, raid size, timing and raider strength, and the Emperor's demands; difficulty choice in campaign briefings, remembered between games, with a "beaten on" badge per mission; `difficulty=` URL flag and `--difficulty` in the simulator
* **Smaller saves** (format v3): map layers run-length coded, paths packed to 16 bits; an Uber save dropped from about 780 KB to 300 KB; older saves still load
* 16 new unit tests (save packing, old saves, Uber, difficulty levers), 4 new smoke checks (79 unit tests, 44 browser checks)

## Done (v0.4)

* **Music**: generative soundtrack composed live in modal scales, played by synthesized lyre (Karplus-Strong), reed pipe, pan flute, frame drums, horn and sistrum through a generated reverb; moods for the menu, day, night, festivals and raids with crossfades; music switch and volume in Settings, M key, console controls and WAV export
* Music lab page (`tests/e2e/music.html`), 9 composer tests, 4 new smoke checks (63 unit tests, 40 browser checks)

## Done (v0.3)

* **Day and night**: sky tint by time of day, lit windows (positions recorded from the art), torches, lanterns on walkers, glowing fires; a setting
* **Seasons**: monthly ground and tree palettes (spring blossoms, autumn leaves, bare winter trees); a setting
* **Weather**: clear, cloudy, rain, thunderstorms with thunder, winter snow; a setting; reduced-motion safe
* **Animation**: fluttering flags and banners, shoppers at stocked markets, crowds during shows, forge sparks, altar fires
* **Smooth camera**: eased zoom toward the cursor, drag fling, glides to messages and landmarks, trackpad-friendly wheel
* **Terrain**: 8 ground variants with small details, soft blended edges between grass, meadow, forest floor, sand and rock
* **Art detail**: wall texture and contact shadows, tiled roofs with ridges and eave shadows, 8 looks per home (shutters, flower boxes, chimneys, jars, fences, washing lines)
* Art sheet page for reviewing every home look (`tests/e2e/artsheet.html`); 54 headless tests, 36-check browser smoke test

## Done (v0.2)

* **Military**: barracks, legion/archer/cavalry forts, watchtowers, walls and gates; raids with warnings, scaling warbands, siege, retreat and plunder; deploy/recall orders; Military advisor and raid alert
* **Supply chains for troops**: weapons (legionaries), Fletcher arrows from timber + iron (archers), Horse Ranch with a growing breeding herd (cavalry)
* **Sea trade**: navigable water detection, Docks, merchant ships, land/sea routes, 9 partners, empire map in the Trade advisor
* Autosave when the page is hidden or closed; save sizes and storage usage in the menus
* Open source: MIT license, contributing guide, code of conduct, security policy, issue/PR templates, CI with a reproducible-build check
* Tests: 37 headless tests (core, military, trade), 32-check browser smoke test
* Graphics: building shadows, construction rise-in, swaying forests, water glints, fountain spray, fire glow and embers, hearth smoke, cloud shadows and birds (with a setting and reduced-motion support); water supply radius on click and while placing

## Done (v0.1)

* Procedural maps: river, coast, lakes, plains, desert; seeds; 3 sizes
* Roads, plazas, bridges, aqueducts, clearing, undo
* 12 housing levels with merging into 2x2 and 3x3 homes
* Walker-based services: prefects, engineers, priests, teachers, librarians, scholars, barbers, physicians, bath attendants, entertainers, tax collectors, market vendors and buyers
* Water network: wells, reservoirs, aqueducts, fountains, piped area
* Food chain: 6 farm types, granaries, markets
* Industry: 4 raw materials + marble, 5 workshops, warehouses feeding workshops
* Entertainment with performer supply (theater, amphitheater, colosseum)
* Fire and collapse, spreading fires, prefects responding to fires
* Labor with priorities; immigration/emigration driven by city mood
* Taxes, wages, tribute, ledger; overland trade with 6 partner cities
* Five gods with moods, festivals, blessings and wrath
* Ratings (culture, prosperity, peace, favor), Emperor's requests and gifts
* 7-mission campaign + sandbox; victory and defeat
* Advisors, overlays (water, fire, collapse, desirability, services, employment), minimap
* Save slots, autosave, file export/import, crash screen with report
* Touch controls and phone layout; synthesized sound effects
* Tests: 16 headless sim tests, 18-check browser smoke test, balance simulator

## Caesar III parity: what the original had that Colonia does not (yet)

Open items only; each keeps its number (#n) for good, so the release notes and the Done lists still point at it. Done so far: #3 crime (v0.10.0), #4 disease (v0.11.0), #11 walker click-to-inspect (v0.9.0), #10 granary and warehouse orders, #12 the empire map and #14 the original's five gods (v0.12.0), #2 fishing wharves and shipyards, #5 the hippodrome and #15 the Health, Education and Entertainment advisors (v0.13.0), #1 the Emperor's legions and distant battles, #6 the governor's residence, salary and rank, #16 triumphal arches, #17 the Military Academy (with Colonia's own Portus) and #18 large temples (v0.14.0).

* **#7** **Map rotation** (view the city from 4 angles).
* **#8** **Scenario/map editor**, which doubles as modding (missions saved as data files).
* **#9** **Events**: floods, earthquakes, a gladiator revolt, a change of Emperor, Rome raising or cutting wages, price changes, trade route disruptions (a route shut for a year); difficulty scales how often they come.
* **#13** **Campaign branches**: at points in the campaign, choose between a peaceful and a military province, as the original did.
* **#19** **Wolves** on wild land that attack walkers until soldiers clear them.
* **#20** **Native villages and missionary posts**, found in some of the original's provinces. Colonia could lean into diplomacy: a trading post, or tribute, turns would-be raiders into trade partners.
* **#21** **Enemy armies by region**: the original's invaders differed by province and era; Colonia has three generic raider types.
* **#22** **Hall of Fame** for the best career scores.
* **#23** **City sounds**: the original played each building's sounds near the camera. Ours would be synthesized (market chatter, forge clanks, gulls at the docks) and change as you zoom.

## Modernization: from the community engines

What Augustus (4.0) added to the original, checked against its manual and release notes, adapted to Colonia:

* **Roadblock permissions on gates, bridges, granaries and warehouses** (roadblocks themselves came in v0.9.0): only roaming service walkers are stopped. Anything with a destination (carts, caravans, settlers, market buyers) passes, so service coverage becomes a puzzle instead of a dice roll. Each roadblock carries a permission per group of walkers: maintenance (engineers and prefects), priests, the market vendor, entertainers, education, medicine, tax collectors, labor seekers, missionaries and watchmen, plus everyone else. Gates, bridges, granaries and warehouses can carry the same permissions. Roadblocks default to denying everyone.
* **Market special orders**: each market switches every good on or off (all on by default). The buyer only fetches goods that are on, and the vendor only hands out goods that are on and that the house's next level uses.
* **Partial warehouse storage** (Accept, Refuse and Get per good came in v0.12.0): a limit per good counted in loads (accept up to it, get up to it), and later versions' "maintain a reserve".
* **Supply posts**: fort soldiers eat. One post per map; its quartermaster fetches food from granaries, and shortages cut morale (an option; the original's rule is the default).
* **Monuments**: Grand Temples (one per god, and how many a city may build is an option, 2 by default), a Pantheon and a Lighthouse. You pay to place the footprint, then a work camp hauls goods from warehouses and an architect's guild (called the engineer's guild in Augustus 2.0) sends architects who advance each stage. Finished monuments never burn or collapse and cost monthly upkeep. A late-game goal and a place to spend surplus goods.
* **Caravanserai**: the land counterpart of the Lighthouse; when it is staffed and fed, disruptions to land trade last half as long, and a trade policy (seller, buyer or quantity) can be set.
* **Global labour pool**: an option that removes the need for labor-seeking walkers to pass homes; every building with road access is fully staffed while enough citizens are unemployed, and category priorities still apply. The original's rule is the default.
* **Building rotation** for gatehouses, warehouses, forts and hippodromes.
* **Extended campaign**: after victory, the player can accept the promotion again or extend the regency, indefinitely.
* **Monthly levies**: some buildings (monuments) cost upkeep in denarii.
* **Also in Augustus 4.0, candidates for later**: the **Cart Depot** (ox carts move goods between storage buildings on orders: source, destination, good, condition), the **Tavern** (wine, meat and fish give entertainment), the **Watchtower** (a cheaper tower that needs no weapons but needs a barracks), the **Highway** (a fast road that only destination walkers can use, with a cost per tile), and new materials (stone, sand, bricks, concrete, gold) with a **City Mint**.
* Already in Colonia: zoom, much bigger maps (Uber), a console, roadblocks, and per-good Accept, Refuse and Get orders with an Empty switch for granaries and warehouses.

## Modernization: Colonia's own

Seeing why:

* **Charts per good over time** (the Production advisor and the trend charts came in v0.9.1).
* **Production calculator**: turns a target into building counts (feeding 1,000 people takes about 3 full wheat farms).
* **Walker traffic heat map**: where walkers actually go, which shows where roadblocks belong.
* **Year in review** and a **city chronicle**: a yearly report card with charts, and an auto-written history of the city ("297 BC: the great fire of the east quarter took 14 homes").

* **The late missions need more jobs** (found when mission 1's goal of 1,200 people met a town with about 100 jobs; missions 1 and 2 now ask for 300 and 450, measured). Missions 3 to 7 keep their goals, but `npm run sim -- --capacity` says their buildings cannot employ that many: at 10% unemployment a sensibly built city of mission 3 employs about 980 people (goal 3,500), mission 4 2,820 (5,000), mission 5 4,810 (6,500), mission 6 3,690 (7,000) and mission 7 6,060 (12,000); a lean one fewer still (740, 1,650, 3,400, 2,710, 4,060). The cloth industry raised missions 4 to 7 (they were 2,470, 4,070, 2,880 and 4,810): its three buildings for the Insulae's clothing, and Capua's and Corinthus's purchases of it. These numbers lean on the sensible profile's 2 home tiles per tile of a walker's roam, a chosen figure: at the demo city's denser 1.2 they would be far higher (mission 5 would fit), so measure a late mission by play before trusting either. Two limits: each partner buys only so much a year (its `buys`), which caps exports and the farms and workshops behind them, and villa residents do not work, so the model leaves them out. The economy needs more jobs before these goals can be checked again: bigger export demand (more partners, larger or growing yearly purchases), job-rich buildings, or villa quarters the model counts (a patrician district raises the people a city holds without adding to its workforce). Then set each goal from the model, take the mission off `KNOWN_OVER` in `tests/campaign.test.mjs`, and set its `paceYears` again.

From playtesting (still to decide which to take):

* **Every other roamer still picks its turns at random**: since v0.13.4 prefects and engineers head for the streets closest to burning or falling down, and set out as the last one turns for home, but priests, teachers, physicians, barbers, bath attendants, market vendors, entertainers and tax collectors still choose junctions by chance, one at a time. Found in a mission 2 save, where the Stone Cottages on a school's far street waited months for a teacher. The same pull could use each home's access timer (a street whose homes are about to lose their temple, school or market draws the walker), measured the same way: the longest gap between visits per home, over several seeds, before and after. Physicians matter most once disease is on.
* **The new city's mood bonus ends as a 20-point cliff** at month 12; on Insane it lands just when the economy is weakest. A taper over several months would be kinder and easier to read.
* **The early missions on Hard and Insane**: the sweep's demo city finds them harsh, partly because it builds what those missions do not unlock (`npm run sim -- --unlocks` builds only what they allow); measure again with it before changing anything.
* **Unstaffed buildings wear out from the day they are placed**: industry burned or collapsed three times before its first worker came. Either risk grows only once staffed, or the placement and building panels say so.
* **Buildings placed together collapse together**: everything built on day one reached its collapse point in the same month, so three key buildings fell at once. Some spread in their starting risk would turn a sudden disaster into a warning.
* **A city with many sea partners needs 2 to 3 Docks** (found when ships started waiting at the dock while dock workers load and unload them): a stay now lasts 2 to 7 weeks and a Dock is held from the moment a ship sets sail for it, so five sea partners (about 12 ships a year) keep one Dock busy, and a ship that finds every Dock taken tries again 6 days later. Measured with `npm run sim -- --type coast --seed beach --years 4 --harbor` (the warehouse 16 road tiles from the dock): one Dock served 13 ships in 3.5 years (29 days a stay on average) where it served 29 at 6 days a stay, and exports fell from 5,698 to 4,309 Dn a year; a second Dock brought them back to 5,440 (6,363 with two Docks before). Faithful to the original, but the player should be told: ships waiting offshore at an anchorage beside a busy Dock (the original's queue) instead of the route retrying, or a "harbor" indicator (*Ships are waiting for a free Dock*) in the Trade advisor and on the Dock.

Playing smoother:

* **Blueprints**: copy and paste housing blocks, and a ghost planner that builds each piece once you can afford it.
* **Pinned stats**: pin any good or rating to the top bar.
* **Cycle idle buildings**: jump between the idle buildings of one kind.
* **Auto-pause on events**: fires, scouted raids, the Emperor's requests.
* **Per-building labor priority**, on top of the category priorities.
* **Custom difficulty**: sliders over the lever table (every lever already lives in one table).
* **Interactive tutorial mission**.
* **Photo mode**: hide the UI, pick the time of day, season and weather, save a screenshot.
* **Accessibility**: UI scale and a screen-reader pass (reduced motion is already honored).
* **Challenge seeds and ironman**: a fixed map plus rules, with medals and par times; autosave-only games.
* **Share-a-map link**: seed, landscape, size and difficulty in one link (the URL flags already exist).

Platform:

* **Sim in a Web Worker**: keeps big maps smooth at 8x, still deterministic.
* **Installable offline app** for the standalone build.
* **Downloads in the claude.ai viewer**: route save export through the viewer's downloads capability, so Export works there too.
* **Scripting console**: a sandboxed build API for automating your own layouts.

Security:

* **Save import hardening**: treat imported saves as untrusted input (size caps, map-size bounds, rejecting `__proto__` keys, a fuzzed loader). Today the loader checks the structure and the version.
* **Content Security Policy** for the single-file build.

## Built on the deterministic sim

The sim is deterministic (seeded RNG, never `Math.random`), so the same seed plus the same player actions rebuild a city exactly.

* **Replay and timelapse**: record the player's actions with the tick they happened on, then play them back: a timelapse of the city growing, a rewind to before a disaster, and bug reports that come with a replay instead of "it broke somehow".
* **Desirability after loading**: a loaded game works out every home's desirability at once, while a running game does so only when the map changes, so a home's desirability can differ between a save and the game it came from (the random numbers stay in step; found reviewing v0.11.0). Work it out on the same schedule in both, or save it.
* **Sim fuzzer**: thousands of game-days of random building, demolishing and speed changes, checking invariants: the books balance, no stock goes negative, save and reload gives the same game, no walker is stuck forever. It finds bugs before players do.
* **Save corpus in CI**: keep a save from every release and prove each one still loads.
* **More in `npm run sweep`** (it runs every difficulty on every campaign map since v0.11.1): sandbox landscapes and seeds, and a garrison run.

## Beyond the original (optional, later)

Ideas that would change the original's economy or rules; each would come as an option:

* **Dynamic prices**: each partner's prices drift with what you sell to it.
* **Partner contracts**: optional side jobs ("Carthago wants 800 wine by next year and pays 150%").
* **Deeper production chains**: salt pans, garum (fish and salt), a mill and bakery for bread, sheep to wool (a second source of cloth, beside the flax and linen built above).
* **Paved roads**: faster carts, higher cost.
* **Sewers and latrines**, paired with disease.
* **Edicts**: policies with trade-offs (a bread dole, a curfew, public games).
* **Climate per landscape**: deserts never snow, northern maps get long winters.
* **"Harsh seasons" mode**: weather affects the city (drought cuts harvests, snow slows carts).

## Polish ideas

* More building animation: turning mill wheels, laundry flapping, working farmers and fishermen.
* Optional sprite packs: load PNG art (hand-drawn or AI-assisted) over the procedural sprites, keyed like the sprite cache, with the procedural art as the fallback (Augustus can load outside images too). The art sheet (`tests/e2e/artsheet.html`) is the reference for sizes and anchors.
* Keyboard remapping and a colorblind-friendly overlay palette.
* Performance: cache static terrain into chunk canvases for the most zoomed-out view. When the screen is full of tiles (the middle of a Large or Uber map) that view costs about 16 ms a frame in headless Chromium against 4 ms one zoom level in; chunks would cut its thousands of ground draw calls to a few dozen (see ARCHITECTURE.md, *Draw calls*).
* Smaller saves for very big cities: buildings are about 0.8 KB each in a save (mostly the house record), so a 1,500-building capital needs about 1.5 MB per slot. Dropping default-valued fields, or compressing the whole save, would stretch the ~5 MB browser allowance further.

## Decisions

* **Modern features**: pure quality of life (roadblocks, market special orders, partial warehouse storage, building rotation) is on by default. Changes to the original's rules (supply posts, the global labour pool, everything under "Beyond the original") come as options that default to the original. Exception: sea raids and the fleet are on by default, with a *Sea raids* switch (Settings, the sandbox setup) that makes every raid come by land as before.
* **Gods**: the original's five, Ceres, Neptune, Mercury, Mars and Venus. Mercury and Venus replace Jupiter and Vesta, and older saves map the old gods' moods over. (Built: item 14.)
* **Housing**: the original's 20 levels, with Colonia's own names and numbers. Done in v0.7, ahead of disease and crime. Where the original has a plain bug, Colonia does not copy it and makes no option of it; behavior that is odd but possibly meant stays as the original had it.
* **Crime, disease and events**: on at every difficulty, as they always were in the original, and gentler on Easy.
* **Localization**: not planned.
* **Caesar's anger** (items 1, #1): as in the original, favor at 0 no longer recalls the governor. At favor 10 or less Caesar warns and sends his legions after 12 months (shown marching on the empire map); recovering favor sends them home, and the mission is lost only if they overrun the city.
* **Gifts and rank** (item 2, #6): the governor draws a salary by rank into personal savings, carried from mission to mission; gifts to Caesar come from those savings, as in the original. One rank per mission for now (Citizen in mission 1); the top ranks come with the longer campaign.
* **The fleet in distant battles** (Colonia's own): when the threatened city lies on a sea route, Naval Station squadrons can be sent with the forts' soldiers and count toward the battle.
* **Campaign branches** (#13): after a win the player chooses the next province, peaceful or military, both at the same rank, and may switch tracks at every split. First at steps 3, 4 and 5, each beside the existing mission: Firmum (military) beside Figlina, Paestum (peaceful) beside Pons Aelius, Beneventum (peaceful) beside Portus Mercatorum, all colonies of the 270s and 260s BC. Military provinces bring raids early, forts a step sooner and Caesar's requests for troops; peaceful ones no raids and higher culture and prosperity goals.
* **Names**: every building shows a Latin name, with its English name in the build menu and the inspect panel.
* **Music**: about 10 tracks of a few minutes for day, night and the menu, picked at random; festivals and raids keep their own music, also a few minutes long. The settings do not name the tracks; the console does (`music`, `music tracks`).
* **Saves**: until 1.0 a release may stop loading older saves (always with a readable message).
* **Version numbers**: after 0.9 comes 0.10; 1.0 only when the game is ready for it.

Made with ❤️ from your friendly hacker - er2oneousbit

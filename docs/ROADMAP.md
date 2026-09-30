# Roadmap

What exists, what Caesar III had that Colonia does not (yet), and how to modernize it. New feature requests are added here first; bugs are fixed right away.

## The plan: a remake, modernized

Colonia is a remake and modernization of Caesar III. The original's rules, buildings and campaign shape are the core, rebuilt with original art, sound and text. On top come the quality-of-life changes players now expect, many of them first seen in the community engines: Julius (the original's exact game logic on modern systems) and Augustus (Julius plus gameplay improvements such as roadblocks, market special orders and monuments).

## Next up (suggested order)

1. **Art the owner flagged**: aqueducts meeting a reservoir join it badly (the channel should run up into the reservoir's rim); an aqueduct crossing a road should be drawn as a bridge, the channel carried over the road on an arch; the three statues need redrawing (they look poor); and every temple needs a look of its own so each god can be told apart at a glance, on the map and in the build menu (roof and pediment colors, the god's emblem and statue). Design the temples for the original's five gods (Ceres, Neptune, Mercury, Mars, Venus; see Decisions), so the switch in item 7 needs no second pass.
2. **A library of music tracks**: about 10 tracks of a few minutes each (today a piece is about 20 bars, under a minute, then a pause and a new random piece), each with an opening of its own (lead instrument, tempo, mode and theme) so they are told apart from the first bars, picked at random without repeating the last few. Still composed by our generator, each track from a fixed seed and a longer form (more sections, varied returns of the theme). Day, night and the menu draw from the library; festivals and raids keep music of their own (it has to come in quickly when they start), but made just as long, a few minutes rather than under one. To decide: whether settings name the tracks.
3. **Roadblocks and walker click-to-inspect**: the modern must-have, and the walkers get something to say again.
4. **Disease and crime**, with their overlays and the Health, Education and Entertainment advisors (on at every difficulty, gentler on Easy).
5. **The Problems overlay and production stats**: the original's Problems overlay, now with the reason behind every problem.
6. **The Emperor's world**: the empire map, then the Emperor's legions, requests for troops, distant battles and triumphal arches.
7. **Classic content still missing**: hippodrome (it joins the entertainment score: its own points and seats, and the top levels' entertainment needs get a second look), fishing wharves and shipyards (fish counts with meat as one food type), military academy, large temples, the governor's residence with salary and rank, and the original's five gods.
8. **Logistics from the mods**: market special orders, partial warehouse storage, supply posts for forts.

Alongside: the sim fuzzer and the save corpus, so all of this lands without breaking anyone's city.

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

1. **The Emperor's legions** marching on a governor whose favor collapses, which gives the favor rating real teeth; distant battles the Emperor asks you to send troops to.
2. **Water industry**: fishing wharves (fish as a food) and shipyards.
3. **Crime**: criminals from unhappy neighborhoods. Unemployment and low mood breed thieves who rob the treasury and markets, and rioters who burn buildings; prefects double as police, as in the original. With a crime overlay.
4. **Disease**: plague outbreaks in dense, unhealthy blocks that clinics, hospitals and baths prevent, so health buildings matter beyond housing needs. It can reuse the fire and collapse risk machinery.
5. **Hippodrome** (chariot races) as a fourth entertainment venue, with a chariot maker to supply it.
6. **Governor's residence and personal salary** (a personal fund for gifts, rank-based salary), and the **rank ladder** from Citizen to Caesar.
7. **Map rotation** (view the city from 4 angles).
8. **Scenario/map editor**, which doubles as modding (missions saved as data files).
9. **Events**: floods, earthquakes, a gladiator revolt, a change of Emperor, Rome raising or cutting wages, price changes, trade route disruptions (a route shut for a year); difficulty scales how often they come.
10. **Warehouse/granary orders** ("get goods", "empty storage") and granary-to-granary transfers.
11. **Walker click-to-inspect** (currently only buildings and tiles): who it is, where it came from, where it is going, what it carries, and what it thinks of the city (the original's walkers talked; ours get their own lines).
12. **Empire map**: a full map screen of the province and the lands around it, showing where the city lies, Rome, every trade partner and its route (open or not, what it buys and sells), caravans and ships on their way with how many days until they arrive, and scouted warbands marching in with their size, the map edge they will enter by and the months left. Today the Trade advisor has a small static empire map (`ui/empireMap.js`). Most of the rest can be shown from state the sim already keeps, without changing balance or saves: each route's `nextVisit` day (`sim/trade.js`), and the raid schedule `nextRaidMonth` and `warned` { origin, size, dir } (`sim/military.js`). Travelers moving on the map would be drawn from those timers, not simulated. Like the original's empire map it covers the whole inland sea (the partners reach from Tarraco to Alexandria). To decide: where it opens (hotkey, top-bar button, links from raid and trade messages), and whether clicking a warband pans the city view to its entry edge.
13. **Campaign branches**: at points in the campaign, choose between a peaceful and a military province, as the original did.
14. **The original's five gods**: Ceres, Neptune, Mercury, Mars and Venus. Colonia has Jupiter and Vesta in place of Mercury (trade) and Venus (happiness).
15. **Health, Education and Entertainment advisors**, and a **Problems overlay**.
16. **Triumphal arches**, awarded for battles won.
17. **Military academy**: trains soldiers who fight better.
18. **Large temples**: bigger temples with more reach (all of Colonia's temples are 2x2).
19. **Wolves** on wild land that attack walkers until soldiers clear them.
20. **Native villages and missionary posts**, found in some of the original's provinces. Colonia could lean into diplomacy: a trading post, or tribute, turns would-be raiders into trade partners.
21. **Enemy armies by region**: the original's invaders differed by province and era; Colonia has three generic raider types.
22. **Hall of Fame** for the best career scores.
23. **City sounds**: the original played each building's sounds near the camera. Ours would be synthesized (market chatter, forge clanks, gulls at the docks) and change as you zoom.

## Modernization: from the community engines

What Augustus (4.0) added to the original, checked against its manual and release notes, adapted to Colonia:

* **Roadblocks**: only roaming service walkers are stopped. Anything with a destination (carts, caravans, settlers, market buyers) passes, so service coverage becomes a puzzle instead of a dice roll. Each roadblock carries a permission per group of walkers: maintenance (engineers and prefects), priests, the market vendor, entertainers, education, medicine, tax collectors, labor seekers, missionaries and watchmen, plus everyone else. Gates, bridges, granaries and warehouses can carry the same permissions. Roadblocks default to denying everyone.
* **Market special orders**: each market switches every good on or off (all on by default). The buyer only fetches goods that are on, and the vendor only hands out goods that are on and that the house's next level uses.
* **Partial warehouse storage**: per good in each warehouse or granary, a state (not accepting, accepting up to a limit, getting from other storage, and later versions add maintaining a reserve) and a limit counted in loads.
* **Supply posts**: fort soldiers eat. One post per map; its quartermaster fetches food from granaries, and shortages cut morale (an option; the original's rule is the default).
* **Monuments**: Grand Temples (one per god, and how many a city may build is an option, 2 by default), a Pantheon and a Lighthouse. You pay to place the footprint, then a work camp hauls goods from warehouses and an architect's guild (called the engineer's guild in Augustus 2.0) sends architects who advance each stage. Finished monuments never burn or collapse and cost monthly upkeep. A late-game goal and a place to spend surplus goods.
* **Caravanserai**: the land counterpart of the Lighthouse; when it is staffed and fed, disruptions to land trade last half as long, and a trade policy (seller, buyer or quantity) can be set.
* **Global labour pool**: an option that removes the need for labor-seeking walkers to pass homes; every building with road access is fully staffed while enough citizens are unemployed, and category priorities still apply. The original's rule is the default.
* **Building rotation** for gatehouses, warehouses, forts and hippodromes.
* **Extended campaign**: after victory, the player can accept the promotion again or extend the regency, indefinitely.
* **Monthly levies**: some buildings (monuments) cost upkeep in denarii.
* **Also in Augustus 4.0, candidates for later**: the **Cart Depot** (ox carts move goods between storage buildings on orders: source, destination, good, condition), the **Tavern** (wine, meat and fish give entertainment), the **Watchtower** (a cheaper tower that needs no weapons but needs a barracks), the **Highway** (a fast road that only destination walkers can use, with a cost per tile), and new materials (stone, sand, bricks, concrete, gold) with a **City Mint**.
* Already in Colonia: zoom, much bigger maps (Uber) and a console.

## Modernization: Colonia's own

Seeing why:

* **Reasons in the Problems overlay**: color every home by the one thing blocking its next level (water, food variety, a temple, desirability...), and every idle building by its reason, with the details in the tooltip.
* **Production and logistics stats**: per good, how much was made and used each month; per building, why it is idle (no workers, no raw material, no storage, no road); a hint at the bottleneck. Charts in the advisors belong here (population, treasury and mood history are already recorded in `city.history`).
* **Production calculator**: turns a target into building counts (feeding 1,000 people takes about 3 full wheat farms).
* **Walker traffic heat map**: where walkers actually go, which shows where roadblocks belong.
* **Year in review** and a **city chronicle**: a yearly report card with charts, and an auto-written history of the city ("297 BC: the great fire of the east quarter took 14 homes").

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
* **Sim fuzzer**: thousands of game-days of random building, demolishing and speed changes, checking invariants: the books balance, no stock goes negative, save and reload gives the same game, no walker is stuck forever. It finds bugs before players do.
* **Save corpus in CI**: keep a save from every release and prove each one still loads.
* **`npm run sweep`**: the balance table (4 landscapes x 3 seeds x 4 difficulties, with and without a garrison) as a real script instead of one-off scratch copies.

## Beyond the original (optional, later)

Ideas that would change the original's economy or rules; each would come as an option:

* **Dynamic prices**: each partner's prices drift with what you sell to it.
* **Partner contracts**: optional side jobs ("Carthago wants 800 wine by next year and pays 150%").
* **Loans from Rome**, at interest.
* **Deeper production chains**: salt pans, garum (fish and salt), a mill and bakery for bread, sheep to wool to cloth.
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

* **Modern features**: pure quality of life (roadblocks, market special orders, partial warehouse storage, building rotation) is on by default. Changes to the original's rules (supply posts, the global labour pool, everything under "Beyond the original") come as options that default to the original.
* **Gods**: the original's five, Ceres, Neptune, Mercury, Mars and Venus. Mercury and Venus replace Jupiter and Vesta, and older saves map the old gods' moods over.
* **Housing**: the original's 20 levels, with Colonia's own names and numbers. Done in v0.7, ahead of disease and crime (the owner's call). Where the original has a plain bug, Colonia does not copy it and makes no option of it; behavior that is odd but possibly meant stays as the original had it.
* **Crime, disease and events**: on at every difficulty, as they always were in the original, and gentler on Easy.
* **Localization**: not planned.
* **Music**: about 10 tracks of a few minutes for day, night and the menu, picked at random; festivals and raids keep their own music, also a few minutes long.
* **Saves**: until 1.0 a release may stop loading older saves (always with a readable message).
* **Version numbers**: after 0.9 comes 0.10; 1.0 only when the owner says the game is ready.

Made with ❤️ from your friendly hacker - er2oneousbit

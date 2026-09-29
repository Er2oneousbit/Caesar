# Roadmap

What exists, what Caesar III had that Colonia does not (yet), and how to modernize it. New feature requests are added here first; bugs are fixed right away.

## The plan: a remake, modernized

Colonia is a remake and modernization of Caesar III. The original's rules, buildings and campaign shape are the core, rebuilt with original art, sound and text. On top come the quality-of-life changes players now expect, many of them first seen in the community engines: Julius (the original's exact game logic on modern systems) and Augustus (Julius plus gameplay improvements such as roadblocks, market special orders and monuments).

## Next up (suggested order)

1. **Roadblocks and walker click-to-inspect**: the modern must-have, and the walkers get something to say again.
2. **Disease and crime**, with their overlays and the Health, Education and Entertainment advisors.
3. **The Problems overlay and production stats**: the original's Problems overlay, now with the reason behind every problem.
4. **The Emperor's world**: the empire map, then the Emperor's legions, requests for troops, distant battles and triumphal arches.
5. **Classic buildings still missing**: hippodrome, fishing wharves and shipyards, military academy, large temples, and the governor's residence with salary and rank.
6. **Logistics from the mods**: market special orders, partial warehouse storage, supply posts for forts.

Alongside: the sim fuzzer and the save corpus, so all of this lands without breaking anyone's city.

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
15. **The full 20-level housing ladder**, from small tents to luxury palaces (Colonia has 12 levels).
16. **Health, Education and Entertainment advisors**, and a **Problems overlay**.
17. **Triumphal arches**, awarded for battles won.
18. **Military academy**: trains soldiers who fight better.
19. **Large temples**: bigger temples with more reach (all of Colonia's temples are 2x2).
20. **Wolves** on wild land that attack walkers until soldiers clear them.
21. **Native villages and missionary posts**, found in some of the original's provinces. Colonia could lean into diplomacy: a trading post, or tribute, turns would-be raiders into trade partners.
22. **Enemy armies by region**: the original's invaders differed by province and era; Colonia has three generic raider types.
23. **Hall of Fame** for the best career scores.
24. **City sounds**: the original played each building's sounds near the camera. Ours would be synthesized (market chatter, forge clanks, gulls at the docks) and change as you zoom.

## Modernization: from the community engines

What Augustus added to the original, adapted to Colonia:

* **Roadblocks**: roaming walkers stop, carts and settlers pass, so service coverage becomes a puzzle instead of a dice roll. With a switch per kind of walker (Augustus later added permissions for labor seekers and tax collectors).
* **Market special orders**: choose which goods a market buys.
* **Partial warehouse storage**: accept a good only up to a set amount.
* **Supply posts**: soldiers in forts eat, fed from the granaries.
* **Monuments**: Grand Temples (one per god), a Pantheon and a Lighthouse, built over years from goods deliveries with a work camp and an engineer's guild; plus a Caravanserai for land trade. A late-game goal and a place to spend surplus goods.
* **Global labour pool**: buildings hire from the whole city instead of needing homes within reach.
* **Building rotation** for gatehouses, warehouses, forts and hippodromes.
* **Extended campaign**: keep governing a province after its goals are met.
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
* **Localization**: Italian first, and Latin for the purists.
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

## Open questions

* Rules the mods changed (supply posts, a city-wide labour pool): the original's rule by default with the change as an option, or the other way round?
* Pantheon: switch to the original's five gods (Mercury and Venus in place of Jupiter and Vesta)? Saves would map the old gods' moods over.
* Housing: the original's 20 levels, or keep Colonia's 12 larger steps?
* Crime, disease and events: on for every difficulty, or off on Easy and scaling up from there?

Made with ❤️ from your friendly hacker - er2oneousbit

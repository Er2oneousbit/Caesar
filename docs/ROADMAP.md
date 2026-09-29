# Roadmap

What exists, what the classic game had that Colonia does not (yet), and ideas. Roughly in priority order. New feature requests are added here first; bugs are fixed right away.

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

## Next up (suggested order)

Picked for value per effort; each is described in the sections below.

1. Roadblocks and walker click-to-inspect
2. The "next level" overlay, and production and logistics stats
3. Sim fuzzer and save corpus
4. Disease and crime
5. Replay and timelapse
6. The wider world: the regional map, then the Emperor's legions, then distant battles

## Missing compared to the classic formula

1. **The Emperor's legions** marching on a governor whose favor collapses, which gives the favor rating real teeth; distant battles the Emperor asks you to send troops to.
2. **Water industry**: fishing wharves (fish as a food) and shipyards.
3. **Crime**: criminals from unhappy neighborhoods. Unemployment and low mood breed thieves who rob the treasury and markets, and rioters who burn buildings; prefects double as police, as in the original.
4. **Disease**: plague outbreaks in dense, unhealthy blocks that clinics, hospitals and baths prevent, so health buildings matter beyond housing needs. It can reuse the fire and collapse risk machinery.
5. **Hippodrome** (chariot races) as a fourth entertainment venue.
6. **Governor's residence and personal salary** (a personal fund for gifts, rank-based salary).
7. **Map rotation** (view the city from 4 angles).
8. **Scenario/map editor**, which doubles as modding (missions saved as data files).
9. **Events**: floods, earthquakes, price changes, trade route disruptions (a route shut for a year); difficulty scales how often they come.
10. **Warehouse/granary orders** ("get goods", "empty storage") and granary-to-granary transfers.
11. **Walker click-to-inspect** (currently only buildings and tiles): who it is, where it came from, where it is going, what it carries.
12. **Regional map**: a full map screen of the province and the lands around it, showing where the city lies, Rome, every trade partner and its route (open or not, what it buys and sells), caravans and ships on their way with how many days until they arrive, and scouted warbands marching in with their size, the map edge they will enter by and the months left. Today the Trade advisor has a small static empire map (`ui/empireMap.js`). Most of the rest can be shown from state the sim already keeps, without changing balance or saves: each route's `nextVisit` day (`sim/trade.js`), and the raid schedule `nextRaidMonth` and `warned` { origin, size, dir } (`sim/military.js`). Travelers moving on the map would be drawn from those timers, not simulated. To decide: where it opens (hotkey, top-bar button, links from raid and trade messages), whether clicking a warband pans the city view to its entry edge, and whether the geography is Italy-centred or the whole inland sea (the partners reach from Tarraco to Alexandria).
13. **Campaign branches**: at points in the campaign, choose between a peaceful and a military province, as the original did.

## Beyond the original: tools for optimizers

* **Roadblocks**: roaming walkers cannot pass, carts and settlers can, so service coverage becomes a puzzle instead of a dice roll (Pharaoh's big quality-of-life addition; Caesar III never had them).
* **"Next level" overlay**: color every home by the one thing blocking its next level (water, food variety, a temple, desirability...), with the reason in the tooltip.
* **Production and logistics stats**: per good, how much was made and used each month; per building, why it is idle (no workers, no raw material, no storage, no road); a hint at the bottleneck. Charts in the advisors belong here (population, treasury and mood history are already recorded in `city.history`).
* **Blueprints**: copy and paste housing blocks, and a ghost planner that places the pieces and builds each one once you can afford it.

## Built on the deterministic sim

The sim is deterministic (seeded RNG, never `Math.random`), so the same seed plus the same player actions rebuild a city exactly.

* **Replay and timelapse**: record the player's actions with the tick they happened on, then play them back: a timelapse of the city growing, a rewind to before a disaster, and bug reports that come with a replay instead of "it broke somehow".
* **Sim fuzzer**: thousands of game-days of random building, demolishing and speed changes, checking invariants: the books balance, no stock goes negative, save and reload gives the same game, no walker is stuck forever. It finds bugs before players do.
* **Save corpus in CI**: keep a save from every release and prove each one still loads.
* **`npm run sweep`**: the balance table (4 landscapes x 3 seeds x 4 difficulties, with and without a garrison) as a real script instead of one-off scratch copies.

## Polish ideas

* More building animation: turning mill wheels, laundry flapping, working farmers and fishermen.
* Optional sprite packs: load PNG art (hand-drawn or AI-assisted) over the procedural sprites, keyed like the sprite cache, with the procedural art as the fallback. The art sheet (`tests/e2e/artsheet.html`) is the reference for sizes and anchors.
* Keyboard remapping and a colorblind-friendly overlay palette.
* A synthesized city soundscape (market chatter, forge clanks, gulls at the docks) that changes as you zoom.
* Performance: cache static terrain into chunk canvases for the most zoomed-out view. When the screen is full of tiles (the middle of a Large or Uber map) that view costs about 16 ms a frame in headless Chromium against 4 ms one zoom level in; chunks would cut its thousands of ground draw calls to a few dozen (see ARCHITECTURE.md, *Draw calls*).
* Smaller saves for very big cities: buildings are about 0.8 KB each in a save (mostly the house record), so a 1,500-building capital needs about 1.5 MB per slot. Dropping default-valued fields, or compressing the whole save, would stretch the ~5 MB browser allowance further.

## Open questions

* Stay close to classic Caesar, or "Caesar with modern quality of life"? Roadblocks and blueprints are not in the original.
* Crime, disease and events: on for every difficulty, or off on Easy and scaling up from there?

Made with ❤️ from your friendly hacker - er2oneousbit

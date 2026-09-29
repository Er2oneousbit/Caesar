# Architecture

How Colonia is put together, for whoever touches the code next.

## Big picture

```
            +------------------------- browser only --------------------------+
            |                                                                 |
 index.html |  main.js -> App (app.js) ---- Renderer (render/*)  canvas       |
 or dist/   |               |  \-------- UI (ui/*)            DOM widgets    |
            |               |  \-------- Input (input/*)      mouse/touch/keys|
            |               |  \-------- Sfx, Music (audio/*) WebAudio       |
            +---------------|-------------------------------------------------+
                            v
            +-------------- runs anywhere (browser AND Node) ----------------+
            |  Game (core/game.js)                                           |
            |    map (world/map.js)      typed-array tile layers             |
            |    buildings: Map<id, Building>   walkers: Map<id, Walker>     |
            |    units: Map<id, Unit> (soldiers + raiders), projectiles      |
            |    city: plain object (money, ratings, trade, gods...)         |
            |    systems: sim/*.js       pure functions of (game, ...)       |
            |    events: EventBus  ---> UI/audio/renderer subscribe          |
            +-----------------------------------------------------------------+
```

The simulation never touches the DOM. That single rule is what makes the headless tests (`tests/sim.test.mjs`), the balance simulator (`scripts/simulate.mjs`) and the live main-menu background all work.

## The main loop (`app.js`)

Each animation frame:

1. Add `dt * TICKS_PER_SECOND * speed` to an accumulator and run whole simulation ticks (capped at `MAX_TICKS_PER_FRAME` so a slow frame cannot snowball).
2. Keyboard and edge scrolling.
3. Render. The leftover fraction of a tick (`alpha`) interpolates walker positions so they glide at 60 FPS even though the sim runs at 20 Hz.
4. Refresh UI widgets (HUD 4x/second, info panel ~1.4x/second, advisors every 1.5 s).

## The tick (`core/game.js`)

```
tick():
  time.advance()                          calendar, reports new day/month/year
  updateWalkers()                         movement + arrival logic (incl. ships)
  updateMilitary()                        soldiers, raiders, towers, missiles
  for buildings whose phase == tick-of-day:
      kind-specific daily logic (house evolves, farm grows, market buys...)
      updateServiceSpawns()               roaming walkers
      updateLaborAccess()                 can it hire? (housing within 40 road tiles)
      updateRisk()                        fire / collapse
  on new day:   labor, water, desirability (if dirty), stats, immigration,
                emigration, fires spreading, caravans and ships, raid progress
                and supply demand for barracks
  on new month: food/goods consumption, wages & taxes, army pay, raid
                warnings/launch, mood, religion, ratings, Emperor requests,
                history, victory/defeat
  on new year:  tribute, ledger rollover, trade quotas reset
```

Buildings get a `phase` (`id % TICKS_PER_DAY`) so their daily work is spread over the 20 ticks of a day instead of spiking at midnight.

## Data model

* **Map** (`world/map.js`): one `Uint8Array`/`Int32Array` per layer, index `y * w + x`. Persistent layers: terrain, variant, road, aqueduct, rubble, fixedRoad, wall (wall/gate). Derived layers (rebuilt, never saved): building ids, desirability, water coverage bits, road network ids, distance to water, **navigable** water (connected to the map edge; ships) plus `seaEntry`.
* **Building** (`sim/entities.js`): plain object. `b.def` is the static definition from `data/buildings.js`. Kind-specific fields: `house` (tier, pop, pantry, service timers), `stock`/`incoming`/`accept` (storage, markets, workshops), `shows` (venues), `hasWater`, `fertility`.
* **Walker**: plain object with `kind` = `roamer` (wanders serving buildings), `carrier` (goes somewhere and comes back), `traveler` (goes somewhere and vanishes) or `ship` (like a traveler, but its path runs over navigable water instead of roads). Movement is always "stand on tile (x,y), walk toward (tx,ty), progress 0..1".
* **Unit** (`sim/military.js`): soldiers and raiders are not walkers. They move freely over open land in continuous tile coordinates (tile centers at .5), fight, and are drawn live by `render/militaryArt.js`. `px/py` keep the previous tick's position so the renderer can interpolate.
* **Reservations**: a cart on its way reserves room at its target (`incoming`), settlers reserve beds (`house.incoming`), performers reserve a venue slot. `killWalker()` always releases them, so storage never overfills and houses never overbook.

Everything is serializable JSON, see `core/save.js`. Map layers are PackBits run-length coded then base64 (`"pb:..."`, or plain base64 when that is smaller) and walker/soldier paths are packed as 16-bit tile indices (`"u16:..."`; maps are at most 256x256, so every index fits). The save format is versioned (`SAVE_VERSION`, currently 3: 2 added the military, 3 the packing); older saves load and get fresh defaults for what they lack. Campaign saves store only the mission id plus `difficulty`; sandbox saves store their whole scenario.

**Difficulty** (`data/difficulty.js`) is one table of levers per level (funds, risk, production, immigration, mood, raid size/interval, raider strength, the Emperor's request size/interval/deadline). `Game` looks the level up once (`game.difficulty`, from `scenario.difficulty`) and each system reads its own lever; campaign missions get a level through `withDifficulty()` (`data/scenarios.js`), which also scales their funds.

## The genre mechanics, where they live

| Mechanic | File | Short version |
|---|---|---|
| Service coverage | `sim/services.js` | Roamers set per-house access timers (48 days) on buildings within 2 tiles of each step. |
| Roaming | `sim/movement.js` | Never reverse, prefer straight, avoid recently walked tiles, stay within 13 tiles of home. |
| House levels | `sim/housing.js`, `data/housing.js` | Climb one tier after 3 good days, fall after 10 bad days; tiers 7+ merge neighbors into 2x2 / 3x3. |
| Immigration | `sim/population.js` | Mood >= 30 and free beds on the entrance's road network; groups walk in from the map edge. Past a 70-tile trip they bring a pack mule and move up to 4x faster (big maps). |
| Labor | `sim/labor.js` | 32% of plebeians work; priorities first, then proportional shares. |
| Water | `sim/water.js` | Reservoir next to water fills; aqueducts flood-fill to more reservoirs; piped area feeds fountains/baths. |
| Desirability | `sim/desirability.js` | Every building radiates `[value, step, stepSize, range]`; terrain adds waterfront/tree bonuses. |
| Fire/collapse | `sim/risk.js` | Daily risk growth; prefects/engineers reset it; burning ruins spread and get doused. |
| Food & goods | `sim/production.js`, `sim/market.js`, `sim/storage.js` | Producer -> cart -> workshop/granary/warehouse -> market buyer -> market vendor -> house pantry. |
| Money | `sim/economy.js` | Monthly wages and taxes (only houses a tax collector visited), yearly tribute. |
| Trade | `sim/trade.js` | Open routes; land partners send caravans to a warehouse, sea partners send ships to a Dock (imports land on the quay and are carted away, exports come from warehouses near the dock); per-good import/export levels and yearly caps. |
| Military | `sim/military.js` | Barracks equip recruits from delivered weapons/arrows/horses and send them to forts; soldiers hold BFS formation spots around their fort or rally point and engage raiders in their guard radius; raiders follow a Dijkstra flow field from every building (walls cost extra) and siege what they reach; towers shoot; invasions are scheduled, warned, launched, repelled or withdraw with plunder. |
| Horse breeding | `sim/production.js` | A ranch's herd grows 2 -> 8 with staffed days; foaling rate scales with herd size. |
| Gods | `sim/religion.js` | Mood from temple coverage + festivals + oracles; blessings and wrath. |
| Ratings / win | `sim/ratings.js` | Culture, prosperity, peace, favor drift toward targets; goals checked monthly. |
| Emperor | `sim/emperor.js` | Periodic requests with deadlines; gifts. |

## Rendering (`render/`)

* **Projection**: tile (x, y) top corner at world pixel `((x - y) * 32, (x + y) * 16)`. Camera scale = zoom x devicePixelRatio; everything is drawn in device pixels for crisp art.
* **Camera** (`camera.js`): `zoomIndex` is the zoom level the player picked; `zoomF` is the zoom shown, which eases to the level in about 0.2 s with the point under the cursor pinned. Also a fling (drag velocity that decays) and `glideToTile` (eased travel, used by messages, advisors, the minimap and Home). `centerOnTile` and setting `zoomIndex` stay instant (loads, tests). `smooth = false` (reduced motion) makes everything instant. `update(dt)` runs once per frame from the renderer.
* **Sprites**: every piece of art is a `spec` (size, anchor, draw function) rendered once per zoom level into an offscreen canvas (`sprites.js`). Art is procedural (`terrainArt.js`, `buildingArt.js`) using the tiny iso kit in `draw.js` (boxes with wall texture and contact shadows, tiled roofs with eave shadows, columns, windows with optional shutters and flower boxes, trees). Sprites are made for the zoom LEVEL and remember their scale `s`; while a zoom eases, `blit()` stretches them by `scale / s` (building strips snap to whole pixels so they do not show seams). New sprites get about 8 ms per frame (`spriteBudgetMs`); past that the cache borrows the other kept zoom level's copy, so a zoom never stalls while hundreds of sprites are drawn, and they sharpen over the next few frames.
* **Draw calls**: keep them down in the per-tile passes. Chromium flushes a canvas mid-frame past a few thousand draw calls, which roughly doubled the frame time when zoomed out, so edge blends are painted into the ground tile's sprite (`groundBlendSpec`) instead of drawn as a second sprite. Test zoomed-out views (`zoom=0`) after adding anything per tile.
* **Depth sorting**: flat things (terrain, roads, rubble) draw first. Everything tall is sorted by the x + y of its front point. Multi-tile buildings are cut into half-tile-wide vertical **strips**, each sorted by the front-most footprint tile it covers. That is what lets a walker pass correctly in front of and behind a colosseum with a simple sort.
* **Overlays** (`overlays.js`): tile tints and info columns; non-relevant buildings drawn as flat footprints.
* **Life in the picture** (visual only, never touches the sim): buildings cast soft shadows to the lower right (drawn after the ground, before objects; `shadowLength()` in `buildingArt.js`); new buildings rise out of the ground with a dust puff; forests sway using 5 cached wind frames whose phase rolls across the map; water glints; working fountains spray; fires glow and throw embers; homes smoke; smithies throw sparks. `ambient.js` draws drifting cloud shadows and passing birds. Settings can turn the ambient layer off, and the OS reduced-motion preference disables all decorative motion.
* **Live details** (`liveArt.js`): drawn every frame on top of their building as `K_EXTRA` items right after its strips: flag cloth (the sprite only has the poles when drawn with `live = true`; `FLAG_SPECS` in `buildingArt.js` lists every flag), shoppers along the front of a stocked market, spectators in theaters and arenas while a show is booked (seats hidden by the stage or the arena floor are skipped), the temple altar fire.
* **Terrain**: 8 ground variants per land type. Where two kinds of ground meet, a wavy fringe of the stronger one (forest floor > grass > meadow > sand > rock, `BLEND_RANK`) is painted onto the weaker tile. The packed blend code per tile is cached (`Renderer.blendAt`) until `map.revision` changes.
* **Order of a frame**: ground, building shadows, sorted objects, particles, cloud shade and birds, then the **night** (`lighting.js`: the scene is multiplied by a half-resolution light map filled with the sky tint plus warm pools of light, then window/torch/fire glows are added), then **rain/snow/lightning** (`weather.js`), then tool previews, radius hints and selection outlines, so those are never darkened.
* **Day, season, weather** are derived per frame in `Renderer.updateEnvironment()`: time of day from `game.time.totalTicks` (`dayTime`, `DAY_TICKS`), the season palette from `game.time.month` (`seasonPalette`; ground/tree/blend sprite keys end in `~<month>` and last month's are dropped when it changes), and the weather state machine advanced by the game ticks that passed (so it pauses with the game). Window positions for night lights come from the art itself: `draw.js` records where `windows()` and `door()` put openings when the art is drawn into `recordingContext()`.
* **Coverage hints**: clicking a well/fountain/reservoir, or placing one, paints its supply area (dark blue) over the area already covered by that kind (pale blue, read from the sim's water layer).
* **Military layer** (`militaryArt.js`): walls/gates are cached sprites keyed by their neighbor mask (like aqueducts); soldiers, raiders, arrows, sling stones and rally flags are drawn live each frame and depth-sorted with everything else.

## Audio (`audio/`)

* **Sound effects** (`sfx.js`): a few oscillators or a noise burst per sound, created on the first click (browsers only allow sound after a user gesture). The app suspends the audio context while the tab is hidden.
* **Music** is generated, never recorded, in three layers:
  * `composer.js` writes the notes and nothing else (pure, deterministic for a random source, tested in node). A `Piece` has a mood (tempo range, meters, modes, keys, lead instrument, drum and lyre styles, silence after it), a form (intro, A, A2, B, A3, outro), a one-bar theme that returns varied in the A sections, harmonies with perfect fifths under a drone, and melodies that move mostly by step, put chord tones on strong beats and long notes, and end phrases on the tonic or the fifth. `nextBar()` returns timed events (`{ t, dur, inst, midi, vel, pan }`).
  * `instruments.js` synthesizes them: Karplus-Strong lyre (cached per note, tuned with `playbackRate`), reed pipe, pan flute, drone, frame drum, horn, sistrum, plus a generated reverb and a gentle high-pass. `Studio` holds what all pieces share; each piece plays through its own `Band` so it can fade out while the next begins.
  * `music.js` schedules bars half a second ahead on the audio clock (look-ahead scheduling: steady timing even when frames stutter), switches pieces at once when the mood changes, leaves silence between calm pieces, and can render any mood offline (`renderMood`) for WAV export and tests.
* The app picks the mood every frame (`App.musicMood()`): raiders on the map, then a recent festival, then night (the sky's lamps) or day; the main menu has its own. Victory plays festival music, defeat the night music.
* Checking what you cannot hear: `tests/e2e/music.html` renders every mood and measures peak and loudness and each instrument's tuning; the smoke test runs `App.musicSelfCheck()` in the built game.

## Adding things

* **A new building**: add an entry to `data/buildings.js` (pick an existing `kind` if possible), add an art function in `render/buildingArt.js` (`ART` map, and a height in `HEIGHT`), unlock it in `data/scenarios.js`. If it needs new behavior, add a case in `Game.updateBuilding()` and a module in `sim/`. Draw windows and doors with `windows()` / `door()` and they light up at night by themselves; torches go in `TORCHES` (`render/lighting.js`), flags in `FLAG_SPECS` (drawn with `flagPoles()`). Check the result in `tests/e2e/artsheet.html` and `tests/e2e/render.html` (`time=0.8` for night).
* **A new walker**: `data/walkers.js` + an effect case in `sim/services.js` (roamers) or a state in `sim/walkers.js` `onPathEnd()`.
* **A new house need**: add the field to `HOUSE_TIERS`, measure it in `evaluateHouse()`, check it in `checkTier()`, explain it in `describeNeed()` (`ui/infoPanel.js`).
* **A new trade partner**: `TRADE_PARTNERS` in `data/scenarios.js` (`route: 'land' | 'sea'`, `pos` on the empire map). Only give sea partners to scenarios whose maps have navigable water.
* **A new soldier type**: `data/units.js`, a fort in `data/buildings.js` (`kind: 'fort'`, `unit`), a `RECRUIT_COST` in `data/goods.js`, art in `render/militaryArt.js`.
* **Balance**: `config.js` first (difficulty levers: `data/difficulty.js`). Then `npm run sim -- --years 5` (add `--difficulty insane`, `--raids occasional --garrison`, `--size 256`) to see the effect without playing.
* **A new map size**: add it to `MAP_SIZES` and `MAP_SIZE_NOTES` (`world/mapgen.js`) and to the `map=` flag list in `core/debug.js`. `GameMap` allows up to 256x256 (paths in saves are packed as 16-bit indices).

## Testing

* `npm test`: 79 node:test tests: `tests/sim.test.mjs` (core city), `tests/military.test.mjs` and `tests/trade.test.mjs` drive the real sim through the public construction API; `tests/save.test.mjs` covers the save packing, old saves and an Uber save; `tests/sandbox.test.mjs` the difficulty levers (up to Insane, campaign included) and Uber maps with mule-riding settlers; `tests/render.test.mjs` covers the camera, sprite cache, sky, seasons, weather and terrain blending; `tests/music.test.mjs` the composer.
* `npm run test:e2e`: 44 checks; the build is opened in headless Chromium and played with real mouse/keyboard input: the sandbox menu (Uber, Insane), building, advisors, a garrison with deploy-by-click, a raid alert, the empire map, smooth zoom, night lights, weather, settings, music (starts after the first click, M key, every mood rendered and measured), autosave on page hide, save + reload + load, a campaign mission started on Insane from its briefing, and a phone layout.
* CI (`.github/workflows/ci.yml`) runs both, and fails if `dist/colonia.html` is not the output of `npm run build` (the build is byte-for-byte reproducible).
* `npm run sim`: prints monthly stats (population, jobs, mood, fed %, granary/market stock, treasury, house tiers) for a scripted demo city.

# Architecture

How Colonia is put together, for whoever touches the code next.

## Big picture

```
            +------------------------- browser only --------------------------+
            |                                                                 |
 index.html |  main.js -> App (app.js) ---- Renderer (render/*)  canvas       |
 or dist/   |               |  \-------- UI (ui/*)            DOM widgets    |
            |               |  \-------- Input (input/*)      mouse/touch/keys|
            |               |  \-------- Sfx (audio/*)        WebAudio       |
            +---------------|-------------------------------------------------+
                            v
            +-------------- runs anywhere (browser AND Node) ----------------+
            |  Game (core/game.js)                                           |
            |    map (world/map.js)      typed-array tile layers             |
            |    buildings: Map<id, Building>   walkers: Map<id, Walker>     |
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
  updateWalkers()                         movement + arrival logic
  for buildings whose phase == tick-of-day:
      kind-specific daily logic (house evolves, farm grows, market buys...)
      updateServiceSpawns()               roaming walkers
      updateLaborAccess()                 can it hire? (housing within 40 road tiles)
      updateRisk()                        fire / collapse
  on new day:   labor, water, desirability (if dirty), stats, immigration,
                emigration, fires spreading, trade caravans
  on new month: food/goods consumption, wages & taxes, mood, religion,
                ratings, Emperor requests, history, victory/defeat
  on new year:  tribute, ledger rollover, trade quotas reset
```

Buildings get a `phase` (`id % TICKS_PER_DAY`) so their daily work is spread over the 20 ticks of a day instead of spiking at midnight.

## Data model

* **Map** (`world/map.js`): one `Uint8Array`/`Int32Array` per layer, index `y * w + x`. Persistent layers: terrain, variant, road, aqueduct, rubble, fixedRoad. Derived layers (rebuilt, never saved): building ids, desirability, water coverage bits, road network ids, distance to water.
* **Building** (`sim/entities.js`): plain object. `b.def` is the static definition from `data/buildings.js`. Kind-specific fields: `house` (tier, pop, pantry, service timers), `stock`/`incoming`/`accept` (storage, markets, workshops), `shows` (venues), `hasWater`, `fertility`.
* **Walker**: plain object with `kind` = `roamer` (wanders serving buildings), `carrier` (goes somewhere and comes back) or `traveler` (goes somewhere and vanishes). Movement is always "stand on tile (x,y), walk toward (tx,ty), progress 0..1".
* **Reservations**: a cart on its way reserves room at its target (`incoming`), settlers reserve beds (`house.incoming`), performers reserve a venue slot. `killWalker()` always releases them, so storage never overfills and houses never overbook.

Everything is serializable JSON (typed arrays go through base64), see `core/save.js`.

## The genre mechanics, where they live

| Mechanic | File | Short version |
|---|---|---|
| Service coverage | `sim/services.js` | Roamers set per-house access timers (48 days) on buildings within 2 tiles of each step. |
| Roaming | `sim/movement.js` | Never reverse, prefer straight, avoid recently walked tiles, stay within 13 tiles of home. |
| House levels | `sim/housing.js`, `data/housing.js` | Climb one tier after 3 good days, fall after 10 bad days; tiers 7+ merge neighbors into 2x2 / 3x3. |
| Immigration | `sim/population.js` | Mood >= 30 and free beds on the entrance's road network; groups walk in from the map edge. |
| Labor | `sim/labor.js` | 32% of plebeians work; priorities first, then proportional shares. |
| Water | `sim/water.js` | Reservoir next to water fills; aqueducts flood-fill to more reservoirs; piped area feeds fountains/baths. |
| Desirability | `sim/desirability.js` | Every building radiates `[value, step, stepSize, range]`; terrain adds waterfront/tree bonuses. |
| Fire/collapse | `sim/risk.js` | Daily risk growth; prefects/engineers reset it; burning ruins spread and get doused. |
| Food & goods | `sim/production.js`, `sim/market.js`, `sim/storage.js` | Producer -> cart -> workshop/granary/warehouse -> market buyer -> market vendor -> house pantry. |
| Money | `sim/economy.js` | Monthly wages and taxes (only houses a tax collector visited), yearly tribute. |
| Trade | `sim/trade.js` | Open routes; caravans visit warehouses; per-good import/export levels and yearly caps. |
| Gods | `sim/religion.js` | Mood from temple coverage + festivals + oracles; blessings and wrath. |
| Ratings / win | `sim/ratings.js` | Culture, prosperity, peace, favor drift toward targets; goals checked monthly. |
| Emperor | `sim/emperor.js` | Periodic requests with deadlines; gifts. |

## Rendering (`render/`)

* **Projection**: tile (x, y) top corner at world pixel `((x - y) * 32, (x + y) * 16)`. Camera scale = zoom x devicePixelRatio; everything is drawn in device pixels for crisp art.
* **Sprites**: every piece of art is a `spec` (size, anchor, draw function) rendered once per zoom level into an offscreen canvas (`sprites.js`). Art is procedural (`terrainArt.js`, `buildingArt.js`) using the tiny iso kit in `draw.js` (boxes, roofs, columns, windows, trees).
* **Depth sorting**: flat things (terrain, roads, rubble) draw first. Everything tall is sorted by the x + y of its front point. Multi-tile buildings are cut into half-tile-wide vertical **strips**, each sorted by the front-most footprint tile it covers. That is what lets a walker pass correctly in front of and behind a colosseum with a simple sort.
* **Overlays** (`overlays.js`): tile tints and info columns; non-relevant buildings drawn as flat footprints.

## Adding things

* **A new building**: add an entry to `data/buildings.js` (pick an existing `kind` if possible), add an art function in `render/buildingArt.js` (`ART` map, and a height in `HEIGHT`), unlock it in `data/scenarios.js`. If it needs new behavior, add a case in `Game.updateBuilding()` and a module in `sim/`.
* **A new walker**: `data/walkers.js` + an effect case in `sim/services.js` (roamers) or a state in `sim/walkers.js` `onPathEnd()`.
* **A new house need**: add the field to `HOUSE_TIERS`, measure it in `evaluateHouse()`, check it in `checkTier()`, explain it in `describeNeed()` (`ui/infoPanel.js`).
* **Balance**: `config.js` first. Then `npm run sim -- --years 5` to see the effect without playing.

## Testing

* `npm test`: 16 node:test tests drive the real sim through the public construction API.
* `npm run test:e2e`: builds are opened in headless Chromium and played with real mouse/keyboard input, including save + reload + load and a phone layout.
* `npm run sim`: prints monthly stats (population, jobs, mood, fed %, granary/market stock, treasury, house tiers) for a scripted demo city.

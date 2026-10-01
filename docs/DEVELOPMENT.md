# Developing Colonia

Notes for working on the code: setup, commands, debug tools, code style, tests and where things live. Colonia is a one-person project and does not take outside contributions (see [CONTRIBUTING.md](../CONTRIBUTING.md)); this page is for the maintainer and the tools that help build it.

For how the pieces fit together read [ARCHITECTURE.md](ARCHITECTURE.md); for the rules and numbers as a player sees them, [GAMEPLAY.md](GAMEPLAY.md); for what is planned, [ROADMAP.md](ROADMAP.md).

---

## The one hard rule: original work only

Colonia is inspired by *Caesar III*, but contains nothing from it or any other commercial game: no graphics, sounds, music, maps, text or data files, and no code copied from decompiled games or from the open-source engines. Art is drawn in code (`src/render/*Art.js`), sounds are synthesized (`src/audio/sfx.js`), the music is written by the game's own composer and synthesized live (`src/audio/composer.js`, `instruments.js`, `music.js`), and all names and text are written for this project. Mechanics and numbers may be learned from references and expressed in our own words and code. Roman history, gods and place names belong to everyone.

---

## Setup

Requirements: **Node 18+** (22 or newer recommended) and a modern browser.

```bash
npm install        # esbuild, the only dev dependency
npm run dev        # dev server at http://localhost:8080/ with live source files
```

Opening `index.html` straight from disk shows a warning on purpose: browsers block ES modules on `file://`. Use the dev server, or build `dist/colonia.html`.

Playwright is only needed for the browser tests and screenshots:

```bash
npm i --no-save playwright && npx playwright install chromium
```

## Commands

| Command | What it does |
|---|---|
| `npm test` | Headless tests (`node:test`, no browser, a few seconds) |
| `npm run build` | Builds `dist/colonia.html`, the whole game in one file (reproducible byte for byte) |
| `npm run test:e2e` | Plays the built game in headless Chromium (`--file <html>` tests another build, `--shots <dir>` saves screenshots) |
| `npm run check` | test + build + e2e, the same as CI |
| `npm run sim -- --years 5 --type lakes` | Headless balance run, one line of stats per month (`--help` lists the options: difficulty, raids, garrison, size, seed...) |
| `npm run sim -- --type coast --fishing 2` | Also a shipyard and 2 fishing wharves: fish a year per wharf against a pig farm's harvest |
| `npm run sim -- --level 3 --venues --hippodrome` | Also an amphitheater, a colosseum (and their schools), a hippodrome and a chariot maker |
| `npm run sim -- --size 96 --level 3 --uptown --cloth --years 5` | Insulae: `--uptown` adds what they need but clothing (plazas, statues, a library, baths, the big venues, vegetable farms; markets topped up with pottery, furniture and oil each month as a stand-in for those industries), `--cloth` a Flax Farm, Linen Maker and Clothing Maker; `--cloth-off <month>` demolishes the cloth quarter then. The report adds a `Clothing:` line: what was made, and homes at the Insula or above |
| `npm run sim -- --pace` | The campaign's pace: the fewest months each mission's goals take (`src/sim/pace.js`) |
| `npm run sim -- --capacity` | What each mission's buildings can employ (`src/sim/capacity.js`): its best home, jobs per 100 people, the employment ceiling and the land ceiling beside its population goal |
| `npm run sim -- --scenario c1 --unlocks --homes 40` | A campaign mission built only with the buildings it unlocks (without `--unlocks` campaign runs build everything, as `npm run sweep` always has), on at most 40 housing plots (`--homes`), to see a town sized to its jobs; the report ends with the goals and the month they were all met |
| `npm run sim -- --type coast --raids frequent --garrison --navy --years 8` | Sea raids: `--navy` adds a Naval Station and a Navalia stocked for a squadron; `--sea-raids off` turns the switch off (every raid by land, the run as before sea raids). The report adds a `Sea:` line: raids by sea, raider ships sunk, liburnians built, lost and afloat, fishing boats sunk |
| `npm run sim -- --type coast --seed beach --years 4 --harbor [docks]` | Sea trade: after 6 months a Dock (or that many) and a warehouse by the water, every sea route open, and 300 pottery, furniture and oil a month put in the warehouse for export (the demo city makes no goods). The report adds a `Harbor:` line: ships, their average and longest stay at the dock, and exports and imports in Dn a year. Without `--harbor` the run is unchanged |
| `npm run sim -- --salary` | The governor draws his rank's salary from the treasury (20 Dn a month in the sandbox, a Procurator; a mission's own rank with `--scenario`). Without it the demo governor draws none and Rome judges none, so the money and favor reported are the city's alone, as before the salary existed |
| `npm run sweep` | The balance table: every difficulty on every campaign map (level 3 demo city with piped water, rebuilding what burns): the money it needed against what the difficulty gives, and how the city ended. `--missions c3,c4 --difficulties normal,insane --years 3` narrow it |
| `npm run screenshots` | Renders showcase frames to `tests/e2e/out/` |
| `scripts/run.ps1`, `scripts/run.sh` | Launch the built game (Windows PowerShell 7+, Linux/macOS) |

`dist/colonia.html` is committed on purpose, so players can download one file and double-click it. CI rebuilds it and fails if the committed copy is stale: commit the rebuilt file with every source change.

The same file is the web version: after CI passes on the release branch, `.github/workflows/pages.yml` publishes the commit CI tested to GitHub Pages as `index.html` (https://er2oneousbit.github.io/Colonia/). It needs Settings > Pages > Source: **GitHub Actions**, and can be run by hand from the Actions tab.

## Debug options

URL flags, appended to the address (for example `dist/colonia.html?debug=1&seed=42&skipmenu=1`):

| Flag | Effect |
|---|---|
| `debug=1` | Debug HUD: FPS, frame/sim/render ms, entity counts, hovered tile |
| `log=debug\|info\|warn\|error` | Console log level |
| `skipmenu=1` | Start a sandbox immediately |
| `scenario=c1` ... `c7` | Start a campaign mission directly |
| `seed=TEXT` | Map seed for new games |
| `map=small\|medium\|large\|uber` | Sandbox map size (Uber is 256x256) |
| `maptype=river\|coast\|lakes\|plains\|desert` | Sandbox landscape |
| `difficulty=easy\|normal\|hard\|insane` | Difficulty for `skipmenu=1` and `scenario=` starts |
| `money=N` | Starting treasury override |
| `speed=0-4` | Starting speed (0 = paused) |
| `unlockall=1` | All buildings and missions unlocked |
| `raids=off\|occasional\|frequent` | Override raids for new games |
| `searaids=off\|on` | The Sea raids switch for new games (off: every raid comes by land) |
| `mute=1` | Sound off |

**Debug console** (backquote key; `help` lists everything): `money 5000`, `freebuild on`, `days 120`, `demo 2` (builds a sample city), `give pottery 800`, `fire`, `collapse`, `invade 12` (raid now), `searaid 12` (a raid by sea now, where ships can sail), `army` (forts, naval stations, every ship, the raid schedule), `garrison`, `navy` (a Naval Station and a Navalia on the shore, stocked for a squadron), `fishing` (a shipyard, two wharves and a granary on the nearest water with fish), `grounds` (the fishing grounds, and every wharf with its boat), `hippodrome` (a hippodrome and a chariot maker beside the city), `cloth` (a flax farm, a linen maker, a clothing maker and a warehouse beside the city), `favor 80`, `savings 400` (add to the governor's personal savings, for gifts), `mood 70`, `crime` (a crime report: the year's counts, criminals about, the unhappiest homes), `crime protest` / `crime thief` / `crime riot` (the home under the cursor, or the unhappiest one, does it now), `riot`, `unrest 20` (set every home's mood; they drift back), `health` (a health report: city health and the homes' average, the year's outbreaks, deaths and cures, the sick homes, the homes closest to an outbreak), `sick` (the home under the cursor falls sick now; `sick 12` for home #12, `sick 30 40` for the home at 30,40, and with no cursor or argument the home with the highest disease risk), `win`, `stats`, `goto 30 40`, `weather storm`, `snow 3`, `sky 0.8` (freeze the time of day; `sky off`), `music` (status; `music next`, `music tracks`, `music play prima lux`, `music mood danger`, `music mood auto`, `music check`, `music wav day 60`), `loglevel debug`.

In the browser's dev tools, `window.colonia` is the running app (`colonia.game` is the simulation).

**Art and music tools** (with `npm run dev` running):

* `/tests/e2e/artsheet.html`: every home level in all 8 looks, blocks, every god's temple, statues and mines, buildings with flags, and carts: every good at a half and a full load in both facings, farm wagons at 100 to 400, led horses, caravan mules (`tiers=1,2` for some levels only, `extras=1` to keep the other sections, `carts=1` for the carts alone, `water=1` for fishing and races alone: the shipyard and wharf turned to each side of the water, the hippodrome's three sections as one, the chariot maker, fishing boats, gulls and chariots; `cloth=1` for the cloth industry: the flax field at each growth stage and resting, the Linen Maker and the Clothing Maker in their looks, and the carts; `navy=1` for the fleet: the Navalia (each side of the water, empty slip, frames, planked hull) and the Naval Station on each side, the liburnian rowing, in battle, at its berth and damaged, and the raider ship sailing in, throwing a fire pot and offshore; `scale=1` shows them at the default zoom).
* `/tests/e2e/render.html`: the demo city in one frame. Parameters are listed at the top of the file: `time=0.8` (night), `month`, `weather`, `look=market`, `walker=cart` (center on a cart), `place=house` (a placement preview), `ladder=1` (a home of every level), `artset=1` (aqueducts joining reservoirs and bridging a road, statues, every temple, the mines), `military=1`, `busy=1`, `fishing=1` (a shipyard and two wharves, the boats out after `fishDays`), `hippodrome=1` (races on, chariots on the track), `cloth=1` (the cloth industry, the view on its workshops after `clothDays`)...
* `/tests/e2e/music.html`: play each track and each mood; *Run the check* renders every mood offline and reports peak, loudness and each instrument's tuning.

---

## Code style

- Plain modern JavaScript (ES modules), **no runtime dependencies**, no framework.
- Two-space indent, semicolons, single quotes (`.editorconfig` sets the basics).
- Small modules with one job each. The simulation (`src/core`, `src/sim`, `src/world`, `src/data`) never touches the DOM, so it runs in Node for tests.
- Every file starts with a header comment explaining what it does. Comment the *why* of anything non-obvious, for the person reading it in six months. Docs and comments avoid em dashes.
- Balance numbers go in `src/config.js` or the `src/data/` tables, not inline in systems. Balance changes are checked with `npm run sim` before and after, and anything touching money or a difficulty lever also with `npm run sweep` (each difficulty's intent is in `scripts/sweep.mjs`). The sim city starts with 20,000 Dn so it never feels poverty; its `Money:` line says what it would have needed.
- Randomness in the simulation comes from `game.rng` (seeded, saved), never `Math.random()`, or saves and tests stop being reproducible. Visual-only effects may use `Math.random()`.
- Errors should be readable: a bad save file says what is wrong; a broken walker or building is logged and removed instead of crashing the city.

## Tests

- `tests/*.test.mjs` drive the real game through the same construction API the player uses (`planAction` / `applyPlan`), so they catch problems across systems: `sim` (core city, maps, fires), `housing` (the 20-level ladder), `campaign` (the missions' pace and goals), `walkers` (roadblocks, walker inspection), `production` (the goods book, the Problems overlay, the Production advisor), `crime` (home mood, the crime roll, criminals and catching them, riots), `disease` (the health score, disease risk, outbreaks, spreading, physicians, city health, the Disease overlay), `coverage` (the Health, Education and Entertainment advisors' figures and advice), `storage` (granary and warehouse orders: Accept, Refuse, Get, Empty and their carts), `military`, `trade`, `save`, `sandbox` (difficulty, raids), `render` (camera, sprites, seasons, weather, water hints), `empire` (the empire map's travelers and its geography: roads over land, sea lanes over water), `input`, `music` (composer and track library). Every new mechanic and every bug fix gets a test; a fix's test fails on the old code.
- `tests/e2e/smoke.mjs` plays the built game in headless Chromium with real mouse and keyboard input. Add a check for any new screen or control players depend on.

## Where things live

```
index.html              dev entry point (ES modules, needs the dev server)
dist/colonia.html       the whole game in one file (committed for easy play)
src/
  main.js               boot, crash screen
  app.js                browser app: main loop, game lifecycle, save/load glue
  config.js             every balance knob in one place
  core/                 game.js (simulation orchestrator), rng, events, debug, save
  world/                map layers, procedural map generator, pathfinding
  data/                 buildings, housing levels, goods, gods, walkers, scenarios,
                        difficulty (every difficulty lever in one table),
                        empireGeo (the empire map's coasts and routes, by
                        longitude and latitude)
  sim/                  one file per system: housing, labor, water, risk, economy,
                        market, production, trade (caravans + ships), military,
                        religion, ratings, emperor...
  render/               isometric camera, sprite cache, procedural art, renderer,
                        day/night lighting, seasons + weather, live details
  ui/                   DOM widgets: HUD, sidebar, info panel, advisors, empire map,
                        menus, help, console
  input/                mouse / touch / keyboard
  audio/                sound effects; music: composer.js (writes the notes and
                        holds the track library), instruments.js (synth), music.js
  dev/demoCity.js       builds a sample city through the public construction API
scripts/                serve.mjs, build.mjs, simulate.mjs, sweep.mjs, run.ps1, run.sh
tests/                  *.test.mjs, e2e/ (smoke test, screenshots, art sheet,
                        render and music pages)
docs/                   ARCHITECTURE.md, GAMEPLAY.md, ROADMAP.md, DEVELOPMENT.md
.github/                CI, publishing to GitHub Pages, the pull-request auto-close, the bug report form
```

**Recipes:**

* **A building:** add it to `BUILDINGS` in `src/data/buildings.js` (the field reference is at the top of that file), unlock it in `src/data/scenarios.js`, give it art in `src/render/buildingArt.js` (or it falls back to a generic block), and if it has new behavior, a `kind` handled in `Game.updateBuilding()`.
* **A good:** `src/data/goods.js`, then something that produces it (a farm or raw producer, or a workshop `recipe`) and something that uses it.
* **A campaign mission:** an entry in `SCENARIOS` (`src/data/scenarios.js`). Set its goals from what its unlocked buildings allow: its population goal at most the sensible employment ceiling `npm run sim -- --capacity` prints for it (and the land), its culture and prosperity a share of what its buildings can earn; then its `paceYears` from `npm run sim -- --pace`. `tests/campaign.test.mjs` checks all of it (missions 3 to 7 are its known exceptions, `KNOWN_OVER`, until they get the jobs: see the ROADMAP). Try it with `npm run sim -- --scenario <id> --unlocks`, sizing the town with `--homes`.
* **The capacity model** (`src/sim/capacity.js`) is a yardstick, not a simulation: for a city of P people, every home at the mission's best working level (patricians do not work, so villas are left out), it lists the buildings a player puts up and counts their workers; the employment ceiling is the largest P with 10% unemployment or less. Two profiles: `LEAN` (one building per trip's worth of homes, 4 home tiles per tile of a walker's `roam`, farms for just what the city eats: 59 jobs for a mission 1 town of 200) and `SENSIBLE`, a careful player's town (2 home tiles per tile of roam, a chosen figure: the demo city builds denser; and 3 farms more than needed, as the demo city does: 89 jobs for a town of 300). The goals are held to `SENSIBLE`, checked by play: in mission 1 the demo city on 40 plots (`--unlocks --homes 40`) had 312 people, 95 to 100 jobs and 4% out of work, and won in month 15; on its whole site, about 600 people for the same jobs, half the workers idle, peace stuck at 32. Industry only makes what homes use and partners buy, farms are on full meadow at the most productive difficulty, buildings come whole; every assumption is listed in the header, and `--capacity` shows what a change does to every mission.
* **A trade partner:** `TRADE_PARTNERS` in `src/data/scenarios.js`, placed with `pos: at(longitude, latitude)`, and the waypoints of its route on the empire map in `ROUTES_LL` (`src/data/empireGeo.js`; `npm test` fails if a road crosses the sea or a sea lane crosses land). `route: 'sea'` partners need a map with navigable water, so only list them in scenarios whose maps have it.
* **A unit type:** `src/data/units.js`, art in `src/render/militaryArt.js`, and a fort (`kind: 'fort'`, `unit: '<type>'`) plus a `RECRUIT_COST` entry in `src/data/goods.js`.
* **A music track:** an entry in `TRACKS` (`src/audio/composer.js`): an id, a title, the moods it plays in, a seed, and its key, tempo, meter, pipes, opening and length.
* **A save format change:** bump `SAVE_VERSION` in `src/config.js` and note it in the version history in `src/core/save.js`. Until 1.0 a release may stop loading older saves (raise `MIN_SAVE_VERSION`), but an older save must always fail with a readable message, never crash or load wrong.

## Troubleshooting (development)

| Symptom | Fix |
|---|---|
| "This is the developer version" page | You opened `index.html` from disk. Use `npm run dev`, or build `dist/colonia.html`. |
| `npm run build` says esbuild is missing | Run `npm install` first. |
| `npm run test:e2e` says Playwright is missing | `npm i --no-save playwright && npx playwright install chromium` (a plain `npm install` removes it again). |
| CI fails on the build check | The committed `dist/colonia.html` is stale: `npm run build` and commit it. |

Made with ❤️ from your friendly hacker - er2oneousbit

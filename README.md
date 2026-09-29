# Colonia

[![CI](https://github.com/Er2oneousbit/Caesar/actions/workflows/ci.yml/badge.svg)](https://github.com/Er2oneousbit/Caesar/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

*Veni, vidi, aedificavi.*

An original, open-source browser city builder in the spirit of **Caesar III**: lay out roads, settle families, keep them fed, safe, faithful and entertained, and watch tents grow into palaces as walkers carry services through the streets. Trade with the empire by caravan and by ship, and raise legions, archers and cavalry (on horses you breed yourself) to hold the walls when the raiders come.

Everything is made from scratch: the art is drawn procedurally in code, the sounds and music are synthesized live (the music is composed on the fly, so it never loops), and all names and text are original. No files, graphics, music or text from any commercial game are used. (If you want the *original* Caesar III, you need to own it; the open-source [Julius](https://github.com/bvschaik/julius) engine runs it on modern systems.)

---

## Play it

| You want to... | Do this |
|---|---|
| Just play | Open **`dist/colonia.html`** in Chrome, Edge or Firefox. Double-click works, no install needed. |
| Play on Windows with a launcher | `.\scripts\run.ps1` (PowerShell 7+) |
| Play on Linux / macOS | `scripts/run.sh` |
| Hack on the code | `npm install` then `npm run dev` (opens http://localhost:8080/) |

> Opening `index.html` straight from disk shows a warning on purpose: browsers block ES modules on `file://`. Use `dist/colonia.html` or the dev server.

---

## How the game works (60-second version)

1. **Roads first.** Walkers only move on roads. Your city must connect to the Imperial road (green dot on the minimap = entrance, red = exit).
2. **Housing plots** (H) beside roads attract settlers who pitch tents.
3. **Water:** a Well lets tents become lean-tos. Later, a Reservoir by a river pipes water to Fountains for better homes.
4. **Safety:** Prefectures (fire) and Engineer's Posts (collapse) must send walkers past every building.
5. **Food:** Wheat Farm on meadow → Granary → Market. Market vendors sell door to door.
6. **Culture and money:** temples, schools, theaters, baths and a Forum (taxes) let homes climb from Tent to Palatium (12 levels).
7. **Click everything.** Every building explains what it is doing, and homes list exactly what they need next.
8. **Trade** (Trade advisor): open land routes (caravans on the Imperial road) and sea routes (merchant ships to a **Dock** on a river or coast). The empire map shows who trades how.
9. **Defend:** from mission 4 on, raiders attack. A **Barracks** trains recruits for **forts**: legionaries need weapons (Weaponsmith), archers need arrows (**Fletcher**: timber + iron), cavalry need horses from a **Horse Ranch**, whose breeding herd grows from 2 to 8 mares over time. Add **watchtowers**, **walls** and **gates**, and use **Deploy** to post troops where the raiders will come.

Full in-game manual: press **F1**.

### Campaign

Seven original missions from a riverside village (*Novum Castrum*, 250 people) to a great capital (*Urbs Magna*, 6000 people with high ratings). Each unlocks more buildings; raids start in mission 4 and grow fiercer. Plus a **Sandbox** with 5 landscapes (river, coast, lakes, plains, desert), 4 map sizes up to **Uber** (256×256, sixteen times Small: room for a whole province), seeds and raid frequency (peaceful, occasional, frequent).

**Difficulty** (Easy, Normal, Hard, **Insane**) is picked in the Sandbox setup and in every mission briefing, and the campaign list shows the hardest level you've beaten each mission on. Insane is for veterans: 40% of the money, grumpier citizens, more fires, slower farms and workshops, bigger and tougher raids that come sooner, and an Emperor who wants 50% more, more often, with less time. The full table is in [docs/GAMEPLAY.md](docs/GAMEPLAY.md#difficulty).

### Saving

Games are saved in your browser's **localStorage**: an autosave slot (every 3 months and whenever you leave or hide the page), a quicksave (F5 / F9) and 5 manual slots. Saves are packed (a year-old Uber city is about 300 KB), and the Save/Load menus show how much space they use. Saves belong to that browser and site only, so use *Export to file* or *Copy save data* for backups or to move a city to another computer.

### A living world

The city lives through the day and the year, all drawn in code:

* **Day and night.** The sun sets every few minutes of game time; at dusk windows light up one by one, temples and forts light their torches, walkers carry lanterns and fires glow in the dark. (Tool previews and selections always stay bright.)
* **Seasons.** Grass and trees follow the calendar: spring blossoms and meadow flowers, summer green, orange and red autumn leaves, bare winter trees. Cypresses stay green all year.
* **Weather.** Clouds, rain, thunderstorms (with thunder) and, in winter, snow. Purely visual: it never affects the city.
* **Animation.** Flags and banners flutter, shoppers browse stocked markets, crowds fill theaters and arenas during shows, smiths throw sparks, altar fires flicker, forests sway, fountains spray, clouds and birds drift over.
* **Smooth camera.** Zoom eases toward the cursor, a fast drag flings the map, and jumping to a message or the entrance glides there.
* **Music.** An original soundtrack composed live as you play, in the old modes (dorian, phrygian, mixolydian...), played by synthesized lyre, reed pipes, pan flute, frame drums and horns. It follows the city: calm melodies while you build, quiet pan flute at night, merry tunes after a festival, war drums and horn calls when raiders attack. It never repeats. Press **M** to switch it off, or set its volume in *Settings*.

Each of these can be switched off in *Settings*; the system's *reduce motion* preference stops the decorative motion (no falling rain or lightning flashes).

### Controls

| Input | Action |
|---|---|
| W A S D / arrows, left-drag, middle-drag | Scroll |
| Mouse wheel, `+` / `-` | Zoom (eases toward the cursor) |
| Fast drag and let go | Fling the map; click to stop it |
| Left click | Inspect / place |
| Right click | Cancel tool / close panel |
| Space or P | Pause |
| M | Music on / off |
| 1 2 3 4 | Speed 1x 2x 3x 5x |
| H / R / X | Housing / Road / Clear tool |
| Ctrl+Z | Undo last construction (full refund, for a few days) |
| O, Shift+O | Next overlay, overlays off |
| F1 / F2 / F3 | Help / Advisors / debug HUD |
| F5 / F9 | Quick save / quick load |
| `` ` `` | Debug console |
| Esc | Cancel, close, game menu |
| Touch | Tap, drag, pinch to zoom |

---

## Debug options (URL flags)

Append to the address, for example `dist/colonia.html?debug=1&seed=42&skipmenu=1`

| Flag | Effect |
|---|---|
| `debug=1` | Debug HUD: FPS, frame/sim/render ms, entity counts, hovered tile |
| `log=debug\|info\|warn\|error` | Console log level |
| `skipmenu=1` | Start a sandbox immediately |
| `scenario=c1` ... `c7` | Start a campaign mission directly |
| `seed=TEXT` | Map seed for new games |
| `map=small\|medium\|large\|uber` | Sandbox map size (Uber is 256×256) |
| `maptype=river\|coast\|lakes\|plains\|desert` | Sandbox landscape |
| `difficulty=easy\|normal\|hard\|insane` | Difficulty for `skipmenu=1` and `scenario=…` starts |
| `money=N` | Starting treasury override |
| `speed=0-4` | Starting speed (0 = paused) |
| `unlockall=1` | All buildings and missions unlocked |
| `raids=off\|occasional\|frequent` | Override raids for new games |
| `mute=1` | Sound off |

**Debug console** (`` ` ``): `help`, `money 5000`, `freebuild on`, `days 120`, `demo 2` (builds a sample city), `give pottery 800`, `fire`, `collapse`, `invade 12` (raid now), `army` (forts, supplies, raid schedule), `favor 80`, `mood 70`, `win`, `stats`, `goto 30 40`, `weather storm` (clear, cloudy, rain, storm, snow), `sky 0.8` (freeze the time of day: 0.3 noon, 0.67 sunset, 0.8 night; `sky off` lets it run), `music` (status; `music next`, `music mood danger`, `music mood auto`, `music check`, `music wav day 60` downloads a WAV), `loglevel debug`.

In browser dev tools, `window.colonia` is the running app (`colonia.game` is the simulation).

---

## For developers

```
npm install          # esbuild (only needed for building)
npm run dev          # dev server with live source files
npm test             # headless simulation tests (node:test, no browser)
npm run build        # -> dist/colonia.html (single file, ~405 KB, reproducible)
npm run test:e2e     # drives the built game in headless Chromium (needs Playwright)
npm run sim -- --years 5 --type lakes    # headless balance simulation
npm run screenshots  # render the demo city to tests/e2e/out/*.png (day, night, seasons, weather...)
npm run check        # test + build + e2e
```

Requirements: Node 18+. Playwright is only needed for the e2e/screenshot scripts (`npm i --no-save playwright && npx playwright install chromium`). CI (`.github/workflows/ci.yml`) runs the tests, rebuilds `dist/colonia.html` and fails if the committed copy is stale, then runs the browser smoke test.

### Project layout

```
index.html              dev entry point (ES modules, needs the dev server)
dist/colonia.html       the whole game in one file (committed for easy play)
src/
  main.js               boot, crash screen
  app.js                browser app: main loop, game lifecycle, save/load glue
  config.js             EVERY balance knob in one place
  core/                 game.js (simulation orchestrator), rng, events, debug, save
  world/                map layers, procedural map generator, pathfinding
  data/                 buildings, housing tiers, goods, gods, walkers, scenarios,
                        difficulty (every difficulty lever in one table)
  sim/                  one file per system: housing, labor, water, risk, economy,
                        market, production, trade (caravans + ships), military,
                        religion, ratings, emperor...
  render/               isometric camera, sprite cache, procedural art (buildings,
                        terrain, walkers, soldiers/walls), renderer, day/night
                        lighting, seasons + weather, live details (flags, crowds)
  ui/                   DOM widgets: HUD, sidebar, info panel, advisors, empire map,
                        menus, help
  input/                mouse / touch / keyboard
  audio/                synthesized sound effects; generative music: composer.js
                        (writes the notes), instruments.js (synth), music.js (player)
  dev/demoCity.js       builds a sample city through the public construction API
scripts/                serve.mjs, build.mjs, simulate.mjs, run.ps1, run.sh
tests/                  *.test.mjs (sim, military, trade, save, sandbox, render, music), e2e/smoke.mjs,
                        e2e/screenshots.mjs, e2e/render.html, e2e/artsheet.html,
                        e2e/music.html (listen to each mood, check levels and tuning)
docs/                   ARCHITECTURE.md, GAMEPLAY.md, ROADMAP.md
.github/                CI workflow, issue and pull request templates
LICENSE, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md
```

Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit, [docs/GAMEPLAY.md](docs/GAMEPLAY.md) for the rules and numbers, and [docs/ROADMAP.md](docs/ROADMAP.md) for what is not built yet.

### Troubleshooting

| Symptom | Fix |
|---|---|
| "This is the developer version" page | You opened `index.html` from disk. Use `dist/colonia.html` or `npm run dev`. |
| Titles use a plain serif font | The Cinzel web font could not load (offline). Purely cosmetic. |
| Saves disappeared | Saves live in the browser's local storage for that exact file/URL (a different browser, a private window or clearing site data means no saves). Use *Save game > Export to file* or *Copy save data* for backups. |
| No music | Browsers only allow sound after your first click or key press. Check *Settings* (Music, Music volume, Mute all sounds) and press M. |
| Night is too dark, or rain distracts | *Settings*: switch off *Day and night* or *Weather* (each is purely visual). |
| Zooming out feels slow on an old computer | Switch off *Ambient effects* and *Weather* in *Settings*; the far zoom levels draw thousands of tiles. |
| "Could not save: storage is full" | Delete old slots in *Load game* (each save shows its size), or export them to files first. |
| Ships never come | Sea routes need navigable water that reaches the map edge (river, coast or a big edge lake) and a staffed Dock on its bank. Desert and plains maps often have none: use land routes there. |
| "Something broke in the city" screen | Click *Copy report* and file it with the seed and steps. *Download emergency save* keeps your city. |
| `npm run build` says esbuild is missing | Run `npm install` first. |

---

## Open source

Colonia is free and open source under the [MIT License](LICENSE). Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) for setup, code style and the one hard rule (original art, sound and text only). Please follow the [Code of Conduct](CODE_OF_CONDUCT.md), and report security problems privately as described in [SECURITY.md](SECURITY.md).

---

## Credits

Designed and developed with Claude (Anthropic) using Claude Code. Inspired by the classic Roman city builders of the late 1990s; Roman gods, places and history belong to everyone.

Made with ❤️ from your friendly hacker - er2oneousbit

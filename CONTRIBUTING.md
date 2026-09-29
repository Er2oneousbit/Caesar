# Contributing to Colonia

Thanks for wanting to help build the city! Bug reports, balance feedback, new buildings, art tweaks, docs fixes and tests are all welcome.

By contributing you agree that your work is released under the project's [MIT License](LICENSE), and you follow the [Code of Conduct](CODE_OF_CONDUCT.md).

---

## The one hard rule: original work only

Colonia is inspired by *Caesar III*, but it contains **nothing** from it or any other commercial game: no graphics, sounds, music, maps, text or data files, and no copied code from decompiled games. All art is drawn in code (`src/render/*Art.js`), sounds are synthesized (`src/audio/sfx.js`), and all names and text are written for this project.

Please keep it that way. Pull requests that add extracted or traced assets will be closed. Roman history, gods and place names belong to everyone and are fine.

---

## Getting set up

Requirements: **Node 18+** (22 recommended) and a modern browser.

```bash
git clone https://github.com/Er2oneousbit/Caesar.git
cd Caesar
npm install        # installs esbuild (the only dev dependency)
npm run dev        # dev server at http://localhost:8080/ with live source files
```

Handy URL flags while developing: `?debug=1&skipmenu=1&unlockall=1&seed=42`, `?scenario=c4`, `?raids=frequent`. The debug console (backtick key) has `demo`, `invade`, `army`, `days 120`, `money 5000` and more. See the in-game help (F1 → Debug).

### Everyday commands

| Command | What it does |
|---|---|
| `npm test` | Headless simulation tests (`node:test`, no browser, a few seconds) |
| `npm run build` | Builds `dist/colonia.html`, the whole game in one file |
| `npm run test:e2e` | Plays the built game in headless Chromium (needs Playwright, see below) |
| `npm run sim -- --years 5 --type coast` | Headless balance run, one line of stats per month |
| `npm run screenshots` | Renders showcase frames to `tests/e2e/out/` |
| `npm run check` | test + build + e2e, the same as CI |

Playwright is optional for day-to-day work. To run the browser tests locally:

```bash
npm i --no-save playwright && npx playwright install chromium
```

---

## Making a change

1. **Open an issue first** for anything bigger than a small fix, so we can agree on the approach.
2. Branch from the default branch: `git checkout -b fix/granary-overflow`.
3. Make the change, with tests where it makes sense (see below).
4. Run `npm run check` (or at least `npm test && npm run build`).
5. **Commit the rebuilt `dist/colonia.html`** together with your source changes. CI rebuilds it and fails if the committed file is stale. This is on purpose: players download that one file.
6. Open a pull request and fill in the template.

### Code style

- Plain modern JavaScript (ES modules), **no runtime dependencies**, no framework.
- Two-space indent, semicolons, single quotes (`.editorconfig` sets the basics).
- Small modules with one job each. The simulation (`src/core`, `src/sim`, `src/world`, `src/data`) must never touch the DOM, so it runs in Node for tests.
- Every file starts with a header comment explaining what it does. Comment the *why* of anything non-obvious: write for the person reading it in six months.
- Balance numbers go in `src/config.js` or the `src/data/` tables, not inline in systems.
- Randomness in the simulation must come from `game.rng` (seeded, saved), never `Math.random()`, or saves and tests stop being reproducible. (Visual-only effects may use `Math.random()`.)
- Errors should be readable: a bad save file says what is wrong, a broken walker or building is logged and removed instead of crashing the city.

### Tests

- Simulation tests live in `tests/sim.test.mjs`. They drive the real game through the same construction API the player uses (`planAction` / `applyPlan`), so they catch problems across systems. Add one for any new mechanic or bug fix.
- UI flows are covered by `tests/e2e/smoke.mjs`. Add a check if you add a new screen or button that players depend on.

---

## Where things live

Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Common recipes:

**Add a building:** add it to `BUILDINGS` in `src/data/buildings.js` (the field reference is at the top of that file), unlock it in `src/data/scenarios.js`, give it art in `src/render/buildingArt.js` (or it falls back to a generic block), and if it has new behavior, a `kind` handled in `Game.updateBuilding()`.

**Add a good:** `src/data/goods.js`, then something that produces it (a farm/raw producer, or a workshop `recipe`) and something that uses it.

**Add a trade partner:** `TRADE_PARTNERS` in `src/data/scenarios.js`. `route: 'sea'` partners need a map with navigable water (river, coast, or a big lake touching the map edge), so only list them in scenarios whose maps have it.

**Add a unit type:** `src/data/units.js`, art in `src/render/militaryArt.js`, and a fort (`kind: 'fort'`, `unit: '<type>'`) plus a `RECRUIT_COST` entry in `src/data/goods.js`.

**Change the save format:** bump `SAVE_VERSION` in `src/config.js`, keep loading older versions in `src/core/save.js`, and note it in the version history there.

---

## Reporting bugs

Open an issue with the **Bug report** template. The most useful things to include:

- What you did, what you expected, what happened.
- Browser + OS, and whether you used `dist/colonia.html`, the dev server, or another host.
- The **map seed** (shown in the debug HUD, `?debug=1`) or a save file (*Save game → Copy save data*).
- If you got the "Something broke in the city" screen, click **Copy report** and paste it.

Security problems: please follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

Made with ❤️ from your friendly hacker - er2oneousbit

# Colonia

[![CI](https://github.com/Er2oneousbit/Caesar/actions/workflows/ci.yml/badge.svg)](https://github.com/Er2oneousbit/Caesar/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

*Veni, vidi, aedificavi.*

A browser city builder in the spirit of **Caesar III**. Lay out roads, settle families, keep them fed, safe, faithful and entertained, and watch tents grow into palaces as walkers carry services through the streets. Trade with the empire by caravan and by ship, and raise legions, archers and cavalry to hold the walls when the raiders come.

Everything is original: the art is drawn in code, the sound and music are synthesized live, and all names and text are written for this game. Nothing from any commercial game is included. (If you want the *original* Caesar III, you need to own it; the open-source [Julius](https://github.com/bvschaik/julius) engine runs it on modern systems.)

---

## Play it

Download **[`dist/colonia.html`](dist/colonia.html)** (the *Download raw file* button on that page) and open it in Chrome, Edge or Firefox. It is the whole game in one file: no install, no account, nothing to set up. It works offline.

Saved games stay in your browser. Use *Save game → Export to file* to keep a backup or move a city to another computer.

## What's in it

* **The housing ladder of the original:** 20 levels, from a tent to an imperial palace. Homes grow from single tiles into 2x2 insulae and villas, 3x3 villas and 4x4 palaces as you bring them water, food, gods, schools, baths, entertainment and fine goods. Click any home to see exactly what it needs next.
* **A campaign** of seven missions, from a riverside village to a great capital (about half an hour for the first, a few hours for the last), and a **sandbox** with five landscapes, four map sizes (up to *Uber*, 256x256) and your choice of raids.
* **Crime:** unhappy homes send out protesters, thieves who rob the Forum or a market, and in a city at the end of its patience, rioters who burn their way toward its finest buildings. Prefects patrol as police and chase criminals down. The Crime overlay shows where trouble is brewing and why.
* **Four difficulties**, Easy to Insane.
* **Trade** by land and sea with nine partner cities, and an empire map.
* **Defense:** a barracks, forts for legionaries, archers and cavalry (on horses you breed), watchtowers, walls and gates.
* **A living world:** day and night, four seasons with snow in winter, rain and thunderstorms, fluttering flags, busy markets, crowds at the shows.
* **Music:** ten original tracks of a few minutes each for building and for the night, festival music, and war drums when raiders attack, all played live by synthesized lyre, pipes and drums.

Press **F1** in the game for the full manual. The rules and numbers are in [docs/GAMEPLAY.md](docs/GAMEPLAY.md).

## Getting started

1. **Roads first.** Walkers only move on roads, and your city must connect to the Imperial road. The gateway with green pennants is the map entrance, where settlers arrive.
2. **Housing plots** (H) beside the roads attract settlers, who pitch tents.
3. **Water:** a Well turns tents into family tents. Later, a Reservoir pipes water to Fountains for better homes. With the Housing tool in hand, a faint blue shows where homes would get water.
4. **Safety:** Prefectures (against fire, and as police against thieves and rioters) and Engineer's Posts (against collapse) must send walkers past every building.
5. **Food:** Wheat Farm on meadow → Granary → Market. Market vendors sell door to door.
6. **Grow:** temples, schools, theaters, baths and a Forum (for taxes) let homes move up.
7. **Click everything.** Every building says what it is doing and what it lacks.

## Controls

| Input | Action |
|---|---|
| W A S D / arrows, left-drag, middle-drag | Scroll |
| Mouse wheel, `+` / `-` | Zoom |
| Left click | Inspect / place |
| Right click | Cancel tool / close panel |
| Space or P | Pause |
| 1 2 3 4 | Speed 1x 2x 4x 8x |
| H / R / X | Housing / Road / Clear tool |
| Ctrl+Z | Undo the last construction (full refund, for a few days) |
| O, Shift+O | Next overlay, overlays off |
| F1 / F2 | Help / Advisors |
| F5 / F9 | Quick save / quick load |
| M | Music on / off |
| Esc | Cancel, close, game menu |
| Touch | Tap, drag, pinch to zoom |

## Troubleshooting

| Problem | Fix |
|---|---|
| No music | Browsers only allow sound after a click, tap or key press: the title screen says *Click, tap or press a key to begin*. Otherwise check *Settings* (Music, Music volume, Mute all sounds) and press M. |
| Saves disappeared | Saves live in the browser for that exact file: a different browser, a private window or clearing site data means no saves. Export your cities to files as a backup. |
| An old save will not load | Until version 1.0 a new release may not load older saves, and says so. Start a new city. |
| "Could not save: storage is full" | Delete old slots in *Load game* (each shows its size), or export them to files first. |
| Slow when zoomed far out | Switch off *Ambient effects* and *Weather* in *Settings*. |
| Night too dark, or rain distracting | Switch off *Day and night* or *Weather* in *Settings* (both are purely visual). |
| Ships never come | Sea routes need a river or coast that reaches the map edge, and a staffed Dock on its bank. Use land routes on maps without one. |
| "Something broke in the city" screen | Click *Copy report* and include it in a bug report. *Download emergency save* keeps your city. |

---

## Bug reports

Found a bug? [Open an issue](https://github.com/Er2oneousbit/Caesar/issues/new/choose) with the bug report form. Steps to reproduce, your browser, and a save file or crash report help most.

Security problems: please report them privately, as described in [SECURITY.md](SECURITY.md).

**This project does not take contributions.** Pull requests are closed automatically, and feature requests are not taken as issues. See [CONTRIBUTING.md](CONTRIBUTING.md). Under the MIT license you are free to fork it and make your own version.

## License and credits

[MIT License](LICENSE). Designed and developed with Claude (Anthropic) using Claude Code. Inspired by the classic Roman city builders of the late 1990s; Roman gods, places and history belong to everyone.

Developer notes (building, testing, debug tools): [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

Made with ❤️ from your friendly hacker - er2oneousbit

# Colonia

[![CI](https://github.com/Er2oneousbit/Caesar/actions/workflows/ci.yml/badge.svg)](https://github.com/Er2oneousbit/Caesar/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

*Veni, vidi, aedificavi.*

A browser city builder in the spirit of **Caesar III**. Lay out roads, settle families, keep them fed, safe, faithful and entertained, and watch tents grow into palaces as walkers carry services through the streets. Trade with the empire by caravan and by ship, and raise legions, archers and cavalry to hold the walls when the raiders come.

Everything is original: the art is drawn in code, the sound and music are synthesized live, and all names and text are written for this game. Nothing from any commercial game is included. (If you want the *original* Caesar III, you need to own it; the open-source [Julius](https://github.com/bvschaik/julius) engine runs it on modern systems.)

---

## Play it

**[Play in your browser](https://er2oneousbit.github.io/Colonia/)**: Chrome, Edge or Firefox, on a computer or a phone.

Or download **[`dist/colonia.html`](dist/colonia.html)** (the *Download raw file* button on that page) and open it. It is the whole game in one file: no install, no account, nothing to set up. It works offline.

Saved games stay in your browser. To keep a backup or move a city to another computer, press 💾 beside any save in the Save or Load menu to download it as a file (or *Export current game* for the game you are playing).

## What's in it

* **Latin names:** every building goes by its Roman name, a Horreum for your goods, the Castra for your legion, with its English name beside it in the build menu and when you click it.
* **The housing ladder of the original:** 20 levels, from a tent to an imperial palace. Homes grow from single tiles into 2x2 insulae and villas, 3x3 villas and 4x4 palaces as you bring them water, food, gods, schools, baths, entertainment and fine goods. Click any home to see exactly what it needs next.
* **A campaign** of ten steps, from a riverside village to a great city of many districts (about half an hour for the first, a few hours for the last). From step 3 on you choose your next post: a peaceful province judged on what you build, or a military one with raiders and a legion to raise. Win the last and Rome hails you Caesar. And a **sandbox** with five landscapes, four map sizes (up to *Uber*, 256x256), your choice of raids and of six places on the empire map.
* **Crime:** unhappy homes send out protesters, thieves who rob the Forum or a market, and in a city at the end of its patience, rioters who burn their way toward its finest buildings. Prefects patrol as police and chase criminals down. The Crime overlay shows where trouble is brewing and why.
* **Disease:** crowded, unhealthy homes can fall sick, lose people and pass it next door. A Medicus sends physicians to cure them, and baths, barbers, fountains, food and a hospital keep it away. The Disease overlay shows which homes are at risk.
* **The five gods of the original:** Ceres, Neptune, Mercury, Mars and Venus. Keep them content with temples (a large temple counts as two) and festivals and they bless the city (a bumper harvest, a trade windfall, food for the granaries, peace, a happier people); neglect them and they strike, and an angered Mercury or Venus strikes harder the second time.
* **Advisors (F2)** for every part of the city. The Health, Education and Entertainment advisors show, for each kind of building, how many work, whom they reach and how many of the people whose homes need them they serve, with one line of advice on what holds homes back most; the Overview gives city health and crime at a glance.
* **Fishing:** a shipyard builds fishing boats from timber; a wharf's boat sails out to where the gulls circle and brings the catch home. Fish is a food of its own, and the sea does not freeze in winter.
* **The Circus:** a 15-tile hippodrome with chariot races (a Factio sends the teams), the grandest show in the city and the key to its finest palaces.
* **Sea raids and a fleet** (new, not in the original, which had no war at sea): where a river or the coast reaches the sea, about a third of raids come by ship, throwing fire pots at boats and buildings by the shore before they land. A Navalia builds liburnians, light warships with two banks of oars and a bronze ram, from timber, iron and linen; naval stations (Stationes) berth them in squadrons you send out like a fort's soldiers, and the Portus, a training harbor, teaches their crews to row in time. A *Sea raids* switch turns it off.
* **Cloth and clothing** (new, not in the original): flax fields that flower blue, a Textrinum (linen weaver) at its loom and a Taberna Vestiaria (clothing maker) with tunics drying in the yard. From the Insula up, homes need clothing too; linen can also be bought from Hispania and Egypt.
* **The governor's career:** a rank from Citizen up to Caesar, a salary you set yourself (Rome frowns on a greedy governor) paid into personal savings that follow you from mission to mission, gifts to the Emperor from those savings, and a residence of your own: a house, a villa or a marble palace.
* **Four difficulties**, Easy to Insane.
* **Trade** by land and sea with twelve partner cities, each buying and selling its own goods up to a yearly quota (a busy route sends its traders more often, a far one less often) at its own prices: a far partner charges more and pays more, each province has a few goods cheap or dear, and every price moves a little each New Year. Choose whom you trade each good with: every partner's card has a switch per good, so you can sell only to the buyers who pay best. Ships wait at your Emporium (trade dock) while its workers unload them and bring your exports aboard. An empire map (E) of the Mediterranean, with your province where its city stood, that shows the caravans and ships on their way, the warbands gathering against you (from the first traders' word six months out; your scouts report their size and road three months out, and a last warning comes a month before), Caesar's legions on the road and your troops marching to a distant battle.
* **Granary and warehouse orders:** per good, accept it, refuse it, or *get* it (the building's cart fetches it from other storage), and an *Empty* switch that sends everything elsewhere.
* **Defense:** a barracks, forts for legionaries, archers and cavalry (on horses you breed or import, kept at the ranch until a barracks needs them), watchtowers, walls and gates. Forts at rest hold their ground, as in the original: deploy them to meet raiders in the field (a deployed fort takes no recruits until it is recalled). A Campus (military academy) trains your soldiers: trained legionaries holding their ground shrug off sling stones and arrows.
* **The Emperor's wrath and his wars:** let his favor sink to 10 and Caesar sends his own legions against your residence and finest homes, a year's march from Rome, with reminders halfway and a month out of what your favor would make them do; win back his favor before they arrive and they turn for home. He also calls for troops to save a city of the empire: send your forts (and, for a city by the sea, your fleet) in time and strong enough, and he grants you a triumphal arch to build across a road.
* **A living world:** day and night, four seasons with snow in winter, rain and thunderstorms, fluttering flags, busy markets, crowds at the shows, chariots racing round the spina.
* **Music:** ten original tracks of a few minutes each for building and for the night, festival music, and war drums when raiders attack, all played live by synthesized lyre, pipes and drums.

Press **F1** in the game for the full manual. The rules and numbers are in [docs/GAMEPLAY.md](docs/GAMEPLAY.md).

## Getting started

1. **Roads first.** Walkers only move on roads, and your city must connect to the Imperial road. The gateway with green pennants is the map entrance, where settlers arrive.
2. **Housing plots** (Area, H) beside the roads attract settlers, who pitch tents. Every building with workers needs a road touching one of its edges (any side; a corner does not count), or it gets no workers: a red sign with a crossed-out road floats over any building that has none.
3. **Water:** a Puteus (Well) turns tents into family tents. Later, a Castellum Aquae (Reservoir) pipes water to a Lacus (Fountain) for better homes. With the Housing tool in hand, an outlined blue shows where homes would get water.
4. **Safety:** an Excubitorium (Prefecture: against fire, and as police against thieves and rioters) and a Collegium Fabrum (Engineer's Post: against collapse) must send walkers past every building. Their walkers head for the streets closest to disaster, but each post looks after its own neighbourhood, so spread them out.
5. **Food:** Seges (Wheat Farm) on meadow → Granarium (Granary) → Macellum (Market). Market vendors sell door to door. With a farm in hand the meadow is outlined in green-gold, even under snow.
6. **Grow:** temples, schools, theaters, baths and a Forum (for taxes) let homes move up. Their walkers head for the streets whose homes most need a visit, but each building serves its own neighbourhood.
7. **Click everything.** Every building says what it is doing and what it lacks; walkers, soldiers, raiders and ships say who they are and what they are up to.

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
| E | Empire map |
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
| In debt and cannot build | Ask Rome for a loan in the Finance advisor (F2): the money comes at once and is repaid monthly with interest. |
| Tax income is falling | Click a home: its tax line says whether a tax collector has registered it, and for how long. A lone Forum's collector can wander off along the Imperial road; a second Forum, or roadblocks at the ends of your blocks, keep collectors on your streets. |
| A building never gets workers | No road touches it. A red sign with a crossed-out road floats over it, and after 8 days a message says where it is. Run a road along any of its edges; a road that only meets a corner does not count. |
| Fountains or baths ran dry | The reservoir feeding them, or an aqueduct linking it to a full one, is gone (raiders, or demolished by mistake). A fountain also needs its workers. Click a reservoir or fountain: its panel says whether it is full. Wells, fountains and reservoirs never burn or wear out. |
| Caesar's legions are coming | The Emperor's favor fell to 10 or less. Raise it before they arrive (his requests, gifts from your savings, troops when he calls for them) and they turn for home; otherwise ready your army. The mission is lost only if the city is overrun. The Imperial advisor (F2) says where they are and what they will do. |
| Ships never come | Sea routes need a river or coast that reaches the map edge, and a staffed Emporium (Trade Dock) on its bank. Use land routes on maps without one. If the Emporium's panel says ships are waiting offshore, every Emporium is busy: build another. |
| "Something broke in the city" screen | Click *Copy report* and include it in a bug report. *Download emergency save* keeps your city. |

---

## Bug reports

Found a bug? [Open an issue](https://github.com/Er2oneousbit/Caesar/issues/new/choose) with the bug report form. Steps to reproduce, your browser, and a save file or crash report help most.  Under the MIT license you are free to fork it and make your own version.

## License and credits

[MIT License](LICENSE). Designed and developed with Claude (Anthropic) using Claude Code. Inspired by the classic Roman city builders of the late 1990s; Roman gods, places and history belong to everyone.

Developer notes (building, testing, debug tools): [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

Made with ❤️ from your friendly hacker - er2oneousbit

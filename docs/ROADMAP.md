# Roadmap

What exists, what the classic game had that Colonia does not (yet), and ideas. Roughly in priority order.

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

## Missing compared to the classic formula

1. **The Emperor's legions** marching on a governor whose favor collapses; distant battles the Emperor asks you to send troops to.
2. **Water industry**: fishing wharves (fish as a food) and shipyards.
3. **Crime**: criminals from unhappy neighborhoods, theft, riots.
4. **Disease**: plague outbreaks that hospitals and baths prevent.
5. **Hippodrome** (chariot races) as a fourth entertainment venue.
6. **Governor's residence and personal salary** (a personal fund for gifts, rank-based salary).
7. **Map rotation** (view the city from 4 angles).
8. **Scenario/map editor**.
9. **Events**: floods, earthquakes, price changes, trade route disruptions.
10. **Warehouse/granary orders** ("get goods", "empty storage") and granary-to-granary transfers.
11. **Walker click-to-inspect** (currently only buildings and tiles).

## Polish ideas

* Background music (procedural, like the sound effects).
* Charts in the advisors (population, treasury and mood history are already recorded in `city.history`).
* More building animation: waving banners, turning mill wheels, crowds at venues and markets.
* Day/night cycle with lit windows (optional), smooth animated zoom, blended terrain edges.
* Keyboard remapping and a colorblind-friendly overlay palette.
* Performance: cache static terrain into chunk canvases for very zoomed-out views of 128x128 maps.

Made with ❤️ from your friendly hacker - er2oneousbit

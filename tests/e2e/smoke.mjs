#!/usr/bin/env node
/**
 * smoke.mjs - end-to-end smoke test of the BUILT game (dist/colonia.html).
 * ----------------------------------------------------------------------------
 * Drives headless Chromium like a player: main menu, sandbox start, building
 * with real mouse drags and keyboard shortcuts, advisors/help/menus, quick
 * save + reload + quick load, and a phone-sized layout check.
 *
 * Usage:  npm run build && npm run test:e2e
 *         node tests/e2e/smoke.mjs [--file dist/colonia.html] [--shots dir] [--help]
 * Needs Playwright (npm i -D playwright, or a global install).
 * Exit code 0 = all checks passed.
 * ----------------------------------------------------------------------------
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node tests/e2e/smoke.mjs [--file dist/colonia.html] [--shots dir]');
  process.exit(0);
}
const file = path.resolve(args.includes('--file') ? args[args.indexOf('--file') + 1] : path.join(ROOT, 'dist/colonia.html'));
const shots = args.includes('--shots') ? path.resolve(args[args.indexOf('--shots') + 1]) : null;
if (!fs.existsSync(file)) {
  console.error(`Missing ${file}. Run "npm run build" first.`);
  process.exit(2);
}
if (shots) fs.mkdirSync(shots, { recursive: true });

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const t of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(t); } catch { /* next */ }
  }
  console.error('Playwright not found. Install it with: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const { chromium } = loadPlaywright();
const url = pathToFileURL(file).href;
const results = [];
// On GitHub Actions a failure is also written as an annotation (public on
// the run's page and through the API, unlike the log), so it names itself.
const inCI = !!process.env.GITHUB_ACTIONS;
const annotate = (title, text) => { if (inCI) console.log(`::error title=${title}::${String(text).replace(/\s+/g, ' ').slice(0, 900)}`); };
const lastCheck = () => (results.length ? results[results.length - 1].name : 'start');
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) annotate('Smoke check failed', `${name}${detail ? ` (${detail})` : ''}`);
};
// A step that throws (a timeout, a missing element) ends the run: say where.
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, (err) => {
    annotate('Smoke test crashed', `${err && err.message} (after "${lastCheck()}")`);
    console.error(err);
    process.exit(1);
  });
}
// Network failures for optional web fonts are not game errors.
const ignorable = (t) => /fonts\.(googleapis|gstatic)|ERR_CERT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|Failed to load resource/i.test(t);

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !ignorable(m.text())) errors.push(m.text()); });

  // 1. Main menu
  await page.goto(url);
  await page.waitForSelector('.menu-card', { timeout: 15000 });
  check('main menu shows', await page.isVisible('text=Campaign'));
  // 1a. Browsers hold sound back until the first gesture: the menu waits
  //     behind the title gate, and clicking it starts the menu music (and
  //     does not press the menu button underneath).
  const gated = await page.evaluate(() => ({ gate: !!document.getElementById('title-gate'), inert: !!document.getElementById('main-menu').inert, playing: window.colonia.music.playing }));
  check('title gate covers the menu until the first click', gated.gate && gated.inert && !gated.playing, JSON.stringify(gated));
  if (shots) await page.screenshot({ path: path.join(shots, 'smoke-gate.png') });
  await page.click('#title-gate');
  await page.waitForFunction(() => window.colonia.music.barsPlayed > 0, null, { timeout: 5000 }).catch(() => {});
  const menuMusic = await page.evaluate(() => { const m = window.colonia.music; return { playing: m.playing, mood: m.mood, bars: m.barsPlayed, gate: !!document.querySelector('#title-gate:not(.leaving)'), modal: !!document.querySelector('.modal') }; });
  check('clicking the title gate starts the menu music', menuMusic.playing && menuMusic.mood === 'menu' && menuMusic.bars > 0 && !menuMusic.gate && !menuMusic.modal, JSON.stringify(menuMusic));
  // The menu really shows afterwards (isVisible ignores opacity and inert).
  await page.waitForTimeout(450);
  const shown = await page.evaluate(() => ({ opacity: getComputedStyle(document.querySelector('#main-menu .menu-card')).opacity, inert: !!document.getElementById('main-menu').inert }));
  check('the menu card fades in and takes input after the gate', shown.opacity === '1' && !shown.inert, JSON.stringify(shown));
  // 1a (cont.) The menu's backdrop tours its town and never shows the dark
  // beyond the map: ten minutes of drift, every corner of the screen on land.
  const tour = await page.evaluate(() => {
    const app = window.colonia;
    if (!app.menuOrbit) return null;
    const cam = app.renderer.camera;
    const map = app.menuGame.map;
    const vw = cam.viewW / cam.dpr;
    const vh = cam.viewH / cam.dpr;
    const c0 = { x: app.menuOrbit.fit.x, y: app.menuOrbit.fit.y };
    let far = 0;
    let off = 0;
    for (let k = 0; k < 600; k++) {
      app.menuDrift(1);
      const c = cam.center();
      far = Math.max(far, Math.hypot(c.x - c0.x, c.y - c0.y));
      for (const [sx, sy] of [[0, 0], [vw - 1, 0], [0, vh - 1], [vw - 1, vh - 1]]) {
        const t = cam.screenToTile(sx, sy);
        if (t.x < 0 || t.y < 0 || t.x >= map.w || t.y >= map.h) off++;
      }
    }
    return { far: Math.round(far), off, swing: app.menuOrbit.fit.scale, zoom: cam.zoomIndex };
  });
  // The menu's map is random: on some the town sits so near the edge that the
  // tour holds still rather than show the dark (swing 0). Otherwise it moves.
  check('the menu backdrop tours its town and never shows the dark beyond the map', !!tour && tour.off === 0 && tour.far <= 400 && (tour.swing > 0 ? tour.far > 50 : tour.far === 0), JSON.stringify(tour));
  // 1b. The rest of the gesture never presses a menu button: the second click
  //     of a double-click on the gate, or a held Enter key (auto-repeat).
  {
    const p2 = await ctx.newPage();
    await p2.goto(url);
    await p2.waitForSelector('#title-gate', { timeout: 15000 });
    const at = await p2.evaluate(() => { const r = [...document.querySelectorAll('#main-menu .btn')].find((b) => /Sandbox/.test(b.textContent)).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await p2.mouse.move(at.x, at.y);
    await p2.mouse.down(); await p2.mouse.up();
    await p2.waitForTimeout(300);
    await p2.mouse.down({ clickCount: 2 }); await p2.mouse.up({ clickCount: 2 });
    await p2.waitForTimeout(400);
    check('double-click on the title gate presses no menu button', !(await p2.$('.modal')));
    await p2.goto(url);
    await p2.waitForSelector('#title-gate', { timeout: 15000 });
    await p2.keyboard.down('Enter');
    await p2.waitForTimeout(500);
    for (let i = 0; i < 4; i++) { await p2.keyboard.down('Enter'); await p2.waitForTimeout(40); } // auto-repeats
    await p2.keyboard.up('Enter');
    await p2.waitForTimeout(400);
    const held = !(await p2.$('.modal'));
    await p2.keyboard.press('Enter');
    await p2.waitForTimeout(300);
    const opened = await p2.evaluate(() => { const m = document.querySelector('.modal'); return m ? m.textContent.slice(0, 40) : ''; });
    check('holding Enter on the title gate presses no menu button, then Enter opens the first one', held && /Campaign/.test(opened), JSON.stringify({ held, opened }));
    // A quick tap of Enter (the usual press) leaves the keyboard on the menu.
    await p2.goto(url);
    await p2.waitForSelector('#title-gate', { timeout: 15000 });
    await p2.keyboard.press('Enter');
    await p2.waitForTimeout(600);
    const focused = await p2.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent, modal: !!document.querySelector('.modal') }));
    check('a quick Enter on the title gate puts keyboard focus on the first menu button', focused.tag === 'BUTTON' && /Campaign/.test(focused.text) && !focused.modal, JSON.stringify(focused));
    await p2.close();
  }
  if (shots) await page.screenshot({ path: path.join(shots, 'smoke-menu.png') });

  // 2. Start a sandbox from the menu UI (after a look at the Uber size and Insane difficulty)
  await page.click('text=Sandbox');
  const sizeSel = 'select:has(option[value="uber"])';
  const uberLabel = await page.$eval(`${sizeSel} option[value="uber"]`, (o) => o.textContent);
  await page.selectOption(sizeSel, 'uber');
  const uberNote = await page.isVisible('text=Sixteen times the land of Small');
  await page.selectOption(sizeSel, 'medium');
  check('sandbox menu offers the Uber map with a note', uberLabel === 'Uber (256×256)' && uberNote, uberLabel);
  await page.selectOption('select.difficulty-select', 'insane');
  const insaneNote = await page.isVisible('text=For veterans.');
  await page.selectOption('select.difficulty-select', 'normal');
  check('sandbox menu offers Insane and describes each level', insaneNote && await page.isVisible('text=The game as designed.'));
  // Watch the first frames of the new game: its look (a winter month) must
  // replace the menu city's summer look at once, not piece by piece.
  await page.evaluate(() => {
    const r = window.colonia.renderer;
    const orig = r.render;
    window.__look = [];
    r.render = function (a, d) {
      orig.call(this, a, d);
      if (window.colonia.game && window.__look.length < 3) window.__look.push({ prev: this.palPrev, pending: this.stats.pending, key: this.pal.key });
    };
    window.__unhookRender = () => { r.render = orig; };
  });
  await page.click('text=Found the city');
  await page.waitForFunction(() => window.colonia && window.colonia.game, null, { timeout: 15000 });
  check('sandbox starts from the menu', true);
  await page.waitForFunction(() => window.__look.length >= 3, null, { timeout: 5000 }).catch(() => {});
  const look = await page.evaluate(() => { window.__unhookRender(); return window.__look; });
  check('a new game shows its own season from the first frame (no old-look patchwork)', look.length > 0 && look.every((f) => f.prev === null && !f.pending), JSON.stringify(look));
  // A fresh map holds still until the player does something: the cursor rests
  // where the button was (no pointer move, no key), so nothing may scroll.
  const camAt = () => page.evaluate(() => { const cam = window.colonia.renderer.camera; const c = cam.center(); return { x: c.x, y: c.y, moving: cam.moving }; });
  const cam0 = await camAt();
  // The clicks above count as the player's first interaction: music may start.
  await page.waitForTimeout(800);
  const cam1 = await camAt();
  const drift = Math.hypot(cam1.x - cam0.x, cam1.y - cam0.y);
  check('fresh map: the view holds still without input', drift < 1 && !cam1.moving, `moved ${Math.round(drift)} world px`);
  // Edge scrolling still works once the mouse really moves to the edge.
  const edgeY = await page.evaluate(() => { const r = window.colonia.canvas.getBoundingClientRect(); return r.top + r.height / 2; });
  await page.mouse.move(3, edgeY);
  await page.waitForTimeout(300);
  const cam2 = await camAt();
  await page.mouse.move(400, edgeY);
  check('edge scrolling works after a real mouse move', cam2.x < cam1.x - 50, `dx ${Math.round(cam2.x - cam1.x)}`);
  const music = await page.evaluate(() => { const m = window.colonia.music; return { playing: m.playing, mood: m.mood, bars: m.barsPlayed, now: m.nowPlaying }; });
  check('music plays in the day mood once the city is founded', music.playing && music.mood === 'day' && music.bars > 0, JSON.stringify(music));

  // 3. Build with real input: road drag + housing drag near the map entrance
  // The road tile nearest the map's center that has free land beside it
  // (a 6x3 patch 2-11 tiles off it). Only the one nearest tile was tried
  // before, and on a random map where water or forest hemmed it in the
  // check failed for that reason alone: every road tile is tried in turn.
  const found = await page.evaluate(() => {
    const app = window.colonia;
    const g = app.game;
    const m = g.map;
    app.paused = true;
    const roads = [];
    for (let i = 0; i < m.size; i++) if (m.road[i]) roads.push({ x: m.xOf(i), y: m.yOf(i), d: Math.hypot(m.xOf(i) - m.w / 2, m.yOf(i) - m.h / 2) });
    roads.sort((a, b) => a.d - b.d);
    for (const best of roads) {
      for (let r = 2; r < 12; r++) {
        for (const [dx, dy] of [[0, r], [r, 0], [0, -r], [-r, 0]]) {
          let ok = true;
          for (let k = 0; k < 6 && ok; k++) for (let j = 0; j < 3; j++) if (!m.isFree(best.x + dx + k, best.y + dy + j)) { ok = false; break; }
          if (ok) {
            app.renderer.camera.centerOnTile(best.x, best.y);
            return { info: { x: best.x, y: best.y, money: g.city.treasury, buildings: g.buildings.size }, spot: { x: best.x + dx, y: best.y + dy } };
          }
        }
      }
    }
    return { info: { x: roads[0].x, y: roads[0].y, money: g.city.treasury, buildings: g.buildings.size }, spot: null };
  });
  const info = found.info;
  const toScreen = (tx, ty) => page.evaluate(([x, y]) => {
    const cam = window.colonia.renderer.camera;
    const wx = (x + 0.5 - (y + 0.5)) * 32;
    const wy = (x + 0.5 + (y + 0.5)) * 16;
    const r = window.colonia.canvas.getBoundingClientRect();
    return { x: r.left + ((wx - cam.x) * cam.scale) / cam.dpr, y: r.top + ((wy - cam.y) * cam.scale) / cam.dpr };
  }, [tx, ty]);
  const spot = found.spot;
  check('found free land for the input test', !!spot);
  if (spot) {
    await page.keyboard.press('r');
    const a = await toScreen(spot.x, spot.y);
    const b = await toScreen(spot.x + 5, spot.y);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    const roadOk = await page.evaluate(({ x, y }) => window.colonia.game.map.road[window.colonia.game.map.idx(x + 3, y)] > 0, spot);
    // On failure, say where the drag went: the tiles under the mouse and the camera state.
    const roadDetail = roadOk ? '' : await page.evaluate(([s, p, q]) => {
      const app = window.colonia; const cam = app.renderer.camera; const m = app.game.map;
      const r = app.canvas.getBoundingClientRect();
      const under = (pt) => { const el = document.elementFromPoint(pt.x, pt.y); return { tile: cam.screenToTile(pt.x - r.left, pt.y - r.top), el: el ? (el.id || el.className) : null }; };
      return JSON.stringify({ spot: s, start: under(p), end: under(q), zoom: cam.zoom, target: cam.targetZoom, moving: cam.moving, tool: app.input.tool, paused: app.paused, modal: !!document.querySelector('.modal'), terrain: [0, 1, 2, 3, 4, 5].map((k) => m.terrain[m.idx(s.x + k, s.y)]) });
    }, [spot, a, b]);
    check('road drag builds a road', roadOk, roadDetail);
    await page.keyboard.press('h');
    const c = await toScreen(spot.x, spot.y + 1);
    const d = await toScreen(spot.x + 5, spot.y + 2);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(d.x, d.y, { steps: 8 });
    await page.mouse.up();
    const after = await page.evaluate(() => ({ money: window.colonia.game.city.treasury, buildings: window.colonia.game.buildings.size }));
    check('housing drag places houses', after.buildings >= info.buildings + 6, `${after.buildings - info.buildings} new`);
    check('construction costs money', after.money < info.money, `${info.money} -> ${after.money}`);
    await page.mouse.click(c.x, c.y, { button: 'right' }); // cancel tool
    check('right click cancels the tool', await page.evaluate(() => window.colonia.input.tool === null));
    await page.mouse.click(c.x, c.y);
    check('clicking a house opens the info panel', await page.isVisible('#info-panel'));
  }

  // 3b. No road, made obvious: a Prefecture placed where no road touches it.
  //     The ghost turns orange with the edge tiles a road would serve picked
  //     out and the warning by the cursor; once built, a red sign floats over
  //     it (counted by the renderer, and red pixels where it says it drew).
  //     Undone afterwards, so the demo city below has its land.
  const lone = await page.evaluate(() => {
    const app = window.colonia;
    const m = app.game.map;
    const c = app.renderer.camera.screenToTile(app.canvas.width / app.renderer.camera.dpr / 2, app.canvas.height / app.renderer.camera.dpr / 2);
    // Two tiles side by side (x and x + 3), each with nothing but open land within 3 tiles.
    const open = (x, y) => {
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (!m.isFree(x + dx, y + dy) || m.terrain[m.idx(x + dx, y + dy)] === 2) return false;
      return true;
    };
    for (let r = 0; r < 30; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = Math.round(c.x) + dx; const y = Math.round(c.y) + dy;
        if (open(x, y) && open(x + 3, y)) { app.renderer.camera.centerOnTile(x + 1, y); return { x, y }; }
      }
    }
    return null;
  });
  check('found open land away from roads for the no-road test', !!lone);
  if (lone) {
    await page.evaluate(() => window.colonia.ui.selectTool('prefecture'));
    await page.waitForTimeout(100);
    const lp = await toScreen(lone.x, lone.y);
    await page.mouse.move(lp.x - 6, lp.y);
    await page.mouse.move(lp.x, lp.y);
    await page.waitForTimeout(200);
    const ghost = await page.evaluate(() => {
      const t = document.getElementById('tooltip');
      const st = window.colonia.renderer.stats;
      return { noRoad: st.ghostNoRoad, edges: st.roadEdges, tip: !t.classList.contains('hidden') && t.classList.contains('warn'), text: t.textContent, side: !!document.querySelector('#tool-info .err') };
    });
    check('placing with no road: orange ghost, the 4 edge tiles picked out, the warning by the cursor and in the sidebar', ghost.noRoad && ghost.edges === 4 && ghost.tip && /No road touches it/.test(ghost.text) && ghost.side, JSON.stringify(ghost));
    await page.mouse.click(lp.x, lp.y);
    const lp2 = await toScreen(lone.x + 3, lone.y);
    await page.mouse.move(lp2.x, lp2.y, { steps: 3 }); // the ghost beside it, for the screenshot
    await page.waitForTimeout(200);
    const sign = await page.evaluate(({ x, y }) => {
      const app = window.colonia;
      const b = [...app.game.buildings.values()].find((v) => v.type === 'prefecture' && v.x === x && v.y === y);
      if (!b) return { placed: false };
      const r = app.renderer;
      const spot = r.noRoadSpots.find((s) => s.id === b.id);
      if (!spot) return { placed: true, count: r.stats.noRoad, spot: null };
      // Red pixels in the sign's disc, read back from the canvas.
      const ctx = app.canvas.getContext('2d');
      const n = Math.ceil(spot.r);
      const px = ctx.getImageData(Math.round(spot.x - n), Math.round(spot.y - n), 2 * n, 2 * n).data;
      let red = 0;
      for (let q = 0; q < px.length; q += 4) if (px[q] > 170 && px[q + 1] < 90 && px[q + 2] < 90) red++;
      return { placed: true, count: r.stats.noRoad, spot: true, red, of: px.length / 4 };
    }, lone);
    check('a building with no road gets the red no-road sign over it', sign.placed && sign.count >= 1 && sign.spot && sign.red > sign.of * 0.15, JSON.stringify(sign));
    if (shots) await page.screenshot({ path: path.join(shots, 'smoke-noroad.png') });
    await page.keyboard.press('Escape');
    const gone = await page.evaluate(({ x, y }) => {
      const app = window.colonia;
      app.undo();
      return ![...app.game.buildings.values()].some((v) => v.type === 'prefecture' && v.x === x && v.y === y);
    }, lone);
    check('the lone prefecture is undone again', gone);
  }

  // 4. Menus and advisors via keyboard
  await page.keyboard.press('F2');
  check('F2 opens advisors', await page.isVisible('text=Advisors'));
  for (const tab of ['Labor', 'Population', 'Production', 'Finance', 'Trade', 'Military', 'Health', 'Education', 'Entertainment', 'Religion', 'Ratings', 'Imperial']) {
    await page.click(`.tab:has-text("${tab}")`);
  }
  check('advisor tabs render', errors.length === 0, errors.join(' | '));
  await page.keyboard.press('Escape');
  await page.keyboard.press('F1');
  check('F1 opens help', await page.isVisible('text=How to play'));
  await page.keyboard.press('Escape');

  // 5. Let it run with the demo city, then quick save / reload / quick load
  await page.evaluate(() => {
    const app = window.colonia;
    app.ui.console.run('demo 2');
    app.ui.console.run('days 64');
    app.setSpeed(3);
  });
  await page.waitForTimeout(1500);
  if (shots) await page.screenshot({ path: path.join(shots, 'smoke-city.png') });
  const saved = await page.evaluate(() => ({ b: window.colonia.game.buildings.size, pop: window.colonia.game.city.population }));
  check('city grows', saved.pop > 50, `pop ${saved.pop}`);
  await page.evaluate(() => window.colonia.togglePause());

  // 5. (cont.) The housing ladder: a home shown at every level (1-20) gets its info
  //     panel with the level's name, and the Population advisor lists them all.
  const ladder = await page.evaluate(() => {
    const app = window.colonia;
    const home = [...app.game.buildings.values()].find((b) => b.house && b.house.pop > 0 && b.size === 1);
    if (!home) return { ok: false };
    const was = home.house.tier;
    const heads = [];
    for (let t = 1; t <= 20; t++) {
      home.house.tier = t;
      app.ui.info.showBuilding(home.id);
      heads.push(document.querySelector('#info-panel h3')?.textContent || '');
    }
    home.house.tier = was;
    app.ui.info.close();
    return { ok: true, heads };
  });
  check('the info panel names all 20 housing levels', ladder.ok && ladder.heads.length === 20 && ladder.heads[0] === 'Tent' && ladder.heads[19] === 'Imperial Palatium' && new Set(ladder.heads).size === 20 && errors.length === 0, JSON.stringify(ladder.heads));
  // 5. (cont.) Storage orders: a granary's or warehouse's panel has a button
  //     per good that cycles Accept, Refuse, Get, and an Empty switch
  //     (sim/storageOrders.js). This map's demo city has a granary but no
  //     warehouse; the phone check below uses a warehouse.
  const store = await page.evaluate(() => {
    const app = window.colonia;
    const all = [...app.game.buildings.values()];
    const b = all.find((x) => x.type === 'warehouse') || all.find((x) => x.type === 'granary');
    if (!b) return null;
    app.ui.info.showBuilding(b.id);
    return { id: b.id, good: b.type === 'warehouse' ? 'wine' : 'wheat', name: b.type };
  });
  check('demo city has a granary or warehouse', !!store);
  if (store) {
    const order = () => page.evaluate(({ id, good }) => window.colonia.game.buildings.get(id).orders[good], store);
    const seen = [await order()];
    for (let k = 0; k < 3; k++) {
      await page.click(`#info-panel .order-btn[data-good="${store.good}"]`);
      seen.push(await order());
    }
    // A slow press: the panel's timed rebuild (every 0.7 s) must wait for the
    // release, or the button is replaced under the pointer and the click lost.
    // The panel rebuilds every 0.7 s; a read that lands on a rebuild finds no
    // button (it failed once that way): read again until one is there.
    let box = null;
    for (let k = 0; k < 10 && !box; k++) {
      box = await page.locator(`#info-panel .order-btn[data-good="${store.good}"]`).boundingBox().catch(() => null);
      if (!box) await page.waitForTimeout(100);
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(900);
    await page.mouse.up();
    const slow = await order();
    for (let k = 0; k < 2; k++) await page.click(`#info-panel .order-btn[data-good="${store.good}"]`); // back to Accept
    check('a slow press on an order button is not lost to the panel refreshing', slow === 'refuse' && (await order()) === 'accept', `after the slow press: ${slow}`);
    const label = await page.textContent(`#info-panel .order-btn[data-good="${store.good}"]`);
    await page.click(`#info-panel button:has-text("Empty the ${store.name}")`);
    const emptying = await page.evaluate(({ id }) => window.colonia.game.buildings.get(id).emptying, store);
    const says = await page.textContent('#info-panel');
    await page.click('#info-panel button:has-text("Stop emptying")');
    const stopped = await page.evaluate(({ id }) => !window.colonia.game.buildings.get(id).emptying, store);
    await page.evaluate(() => window.colonia.ui.info.close());
    check(`a ${store.name}'s order cycles Accept, Refuse, Get in its panel, and Empty switches on and off`,
      seen.join() === 'accept,refuse,get,accept' && label === 'Accept' && emptying && /Emptying/.test(says) && stopped && errors.length === 0,
      JSON.stringify({ seen, label, emptying, stopped }));
  }
  // The Risks section shows odds only for what can go off: a well never
  // burns or collapses, and a Tent never collapses ("0%" read as "safe for now").
  // A well, not a warehouse: the menu's sandbox has a random seed, and the
  // demo city builds a warehouse only where it finds clay by water, but
  // always its wells.
  const risks = await page.evaluate(() => {
    const app = window.colonia;
    const all = [...app.game.buildings.values()];
    const text = (b) => {
      if (!b) return null;
      app.ui.info.showBuilding(b.id);
      const sec = [...document.querySelectorAll('#info-panel .panel-sec')].find((s) => s.querySelector('h5')?.textContent === 'Risks');
      return sec ? sec.textContent : null;
    };
    const out = { well: text(all.find((b) => b.type === 'well')), shop: text(all.find((b) => !b.house && b.def.fire > 0 && b.def.damage > 0)) };
    const home = all.find((b) => b.house && b.house.pop > 0 && b.size === 1);
    if (home) {
      const was = home.house.tier;
      home.house.tier = 1;
      out.tent = text(home);
      home.house.tier = was;
    }
    app.ui.info.close();
    return out;
  });
  check('info panel risks: odds for a workplace, none for a well or a Tent\'s collapse',
    /never burns or collapses/.test(risks.well || '') && !/%/.test(risks.well || '')
    && /Fire risk\s*\d+%/.test(risks.shop || '') && /Collapse risk\s*\d+%/.test(risks.shop || '')
    && /Fire risk\s*\d+%/.test(risks.tent || '') && /Collapse risk\s*None: it cannot collapse/.test(risks.tent || ''),
    JSON.stringify(risks));
  await page.keyboard.press('F2');
  await page.click('.tab:has-text("Population")');
  const rows = await page.evaluate(() => [...document.querySelectorAll('.modal tr')].filter((tr) => /^\d+\. /.test(tr.textContent)).length);
  check('Population advisor lists 20 housing levels', rows === 20, `${rows} rows`);
  await page.keyboard.press('Escape');

  // 5a. Water radius: clicking a well shows its area (dark blue); placing one
  //     shows the new area in dark blue over existing coverage in pale blue.
  const well = await page.evaluate(() => {
    const g = window.colonia.game;
    const w = [...g.buildings.values()].find((b) => b.def.kind === 'well');
    if (!w) return null;
    window.colonia.renderer.camera.centerOnTile(w.x, w.y);
    return { x: w.x, y: w.y };
  });
  check('demo city has a well', !!well);
  if (well) {
    await page.waitForTimeout(100);
    const wp = await toScreen(well.x, well.y);
    await page.mouse.click(wp.x, wp.y);
    await page.waitForTimeout(150);
    const cov = await page.evaluate(() => window.colonia.renderer.stats.coverage);
    check('clicking a well shows its 5x5 supply area', !!cov && cov.strong === 25, JSON.stringify(cov));
    await page.evaluate(() => window.colonia.ui.selectTool('well'));
    const free = await page.evaluate(({ x, y }) => {
      const m = window.colonia.game.map;
      for (let r = 1; r < 6; r++) for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r]]) if (m.isFree(x + dx, y + dy)) return { x: x + dx, y: y + dy };
      return null;
    }, well);
    if (free) {
      const fp = await toScreen(free.x, free.y);
      await page.mouse.move(fp.x, fp.y);
      await page.waitForTimeout(150);
      const pc = await page.evaluate(() => window.colonia.renderer.stats.coverage);
      check('placing a well: new area dark, existing coverage pale', !!pc && pc.strong === 25 && pc.pale > 0, JSON.stringify(pc));
    }
    await page.keyboard.press('Escape'); // cancel the tool (a second Esc would open the pause menu)
    await page.evaluate(() => window.colonia.ui.info.close());

    // 5a (cont.) Water where you build: with the Housing tool in hand the
    // ground shows the water homes would get (well water faint, fountain
    // water stronger); a fountain or baths shows the reservoirs' piped area.
    // The demo city only has wells, so a piped area (wider than the preview
    // of a fountain under the cursor, as a reservoir's is) with some fountain
    // water in it is written into the water layer (the game is paused: it stays).
    const hints = await page.evaluate(async ({ x, y }) => {
      const app = window.colonia;
      const m = app.game.map;
      for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) if (m.inBounds(x + dx, y + dy)) m.water[m.idx(x + dx, y + dy)] |= 4; // PIPED
      for (let dy = -1; dy <= 1; dy++) for (let dx = 3; dx <= 5; dx++) if (m.inBounds(x + dx, y + dy)) m.water[m.idx(x + dx, y + dy)] |= 2; // FOUNTAIN
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await frame();
      const none = app.renderer.stats.waterHint;
      app.ui.selectTool('house');
      await frame();
      const house = app.renderer.stats.waterHint;
      app.ui.selectTool('fountain');
      await frame();
      const fountain = app.renderer.stats.waterHint;
      app.ui.selectTool('baths');
      await frame();
      const baths = app.renderer.stats.waterHint;
      return { none, house, fountain, baths };
    }, well);
    check('Housing tool: faint blue where homes get water (wells pale, fountains stronger)', hints.none === null && !!hints.house && hints.house.well > 0 && hints.house.fountain > 0, JSON.stringify(hints));
    check('placing a fountain or baths shows the reservoirs\' piped area', !!hints.fountain && hints.fountain.piped > 0 && !!hints.baths && hints.baths.piped > 0, JSON.stringify(hints));
    await page.keyboard.press('Escape');
  }

  // 5a2. Roadblocks and walkers: a roadblock placed from the build menu, its
  //      panel lets a group through; a click on a walker's figure opens the
  //      walker's panel, and Follow keeps it in view.
  const rbSpot = await page.evaluate(() => {
    const app = window.colonia;
    const m = app.game.map;
    // A straight piece of road in the demo city, away from the map edge.
    const home = [...app.game.buildings.values()].find((b) => b.house && b.house.pop > 0);
    for (let r = 1; r < 20; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = home.x + dx; const y = home.y + dy;
        if (!m.inBounds(x, y) || m.road[m.idx(x, y)] !== 1 || m.wall[m.idx(x, y)] || m.fixedRoad[m.idx(x, y)]) continue;
        if (m.hasRoad(x + 1, y) && m.hasRoad(x - 1, y) && !m.hasRoad(x, y + 1) && !m.hasRoad(x, y - 1)) {
          app.renderer.camera.centerOnTile(x, y);
          return { x, y };
        }
      }
    }
    return null;
  });
  check('demo city has a straight road for a roadblock', !!rbSpot);
  if (rbSpot) {
    await page.click('.cat-btn[title^="Roads"]');
    // Build menu entries are found by their key: the names are the Latin
    // ones, with the English under them (data/buildings.js `en`).
    const rbItem = await page.evaluate(() => {
      const el = document.querySelector('.build-item[data-key="roadblock"] .nm');
      return el ? { text: el.textContent, en: el.querySelector('.en')?.textContent, title: el.closest('.build-item').title } : null;
    });
    check('the build menu shows the Latin name with the English under it, and the tooltip both', !!rbItem && rbItem.text.startsWith('Claustra') && rbItem.en === 'Roadblock' && rbItem.title.startsWith('Claustra (Roadblock)\n'), JSON.stringify(rbItem));
    await page.click('.build-item[data-key="roadblock"]');
    await page.waitForTimeout(100);
    const rp = await toScreen(rbSpot.x, rbSpot.y);
    await page.mouse.move(rp.x, rp.y);
    await page.waitForTimeout(100);
    await page.mouse.click(rp.x, rp.y);
    const placed = await page.evaluate(({ x, y }) => window.colonia.game.map.roadblock[window.colonia.game.map.idx(x, y)], rbSpot);
    check('the Roadblock tool places a roadblock on a road', placed === 128, `layer ${placed}`);
    await page.mouse.click(rp.x, rp.y, { button: 'right' });
    // A click on a walker's figure picks the walker, and walkers cross the
    // roadblock all the time (a slow CI machine clicked one): step the paused
    // game until no figure stands at the point, then click the roadblock.
    const rbWasPaused = await page.evaluate(({ x, y }) => {
      const app = window.colonia;
      const was = app.paused;
      app.paused = true; // still until the click is done
      const rect = app.canvas.getBoundingClientRect();
      for (let k = 0; k < 60 && app.renderer.pickWalker(x - rect.left, y - rect.top, false); k++) {
        for (let t = 0; t < 4; t++) app.game.tick();
        app.renderer.render(0, 0.016);
      }
      return was;
    }, rp);
    await page.mouse.click(rp.x, rp.y);
    const rbPanel = (await page.textContent('#info-panel h3').catch(() => '')) === 'Claustra (Roadblock)';
    await page.evaluate((was) => { window.colonia.paused = was; }, rbWasPaused);
    await page.click('#info-panel label:has-text("Priests") input');
    const allowed = await page.evaluate(({ x, y }) => window.colonia.game.map.roadblock[window.colonia.game.map.idx(x, y)], rbSpot);
    check('clicking a roadblock shows who it lets through; ticking a group lets it pass', rbPanel && allowed === (128 | 2), `panel ${rbPanel}, layer ${allowed}`);
    // A walker in view, clicked on its body.
    await page.evaluate(() => { window.colonia.ui.info.close(); window.colonia.game.runDays(2); });
    await page.waitForTimeout(200);
    const findWalker = () => page.evaluate(() => {
      const r = window.colonia.renderer;
      const cam = r.camera;
      const rect = window.colonia.canvas.getBoundingClientRect();
      for (const s of r.walkerSpots) {
        const q = cam.toScreen(s.wx, s.wy - 9);
        const x = rect.left + q.x / cam.dpr;
        const y = rect.top + q.y / cam.dpr;
        if (x < rect.left + 360 || x > rect.right - 40 || y < rect.top + 80 || y > rect.bottom - 120) continue; // clear of the panels
        if (r.pickWalker(x - rect.left, y - rect.top) !== s.id) continue; // not hidden behind another walker
        return { id: s.id, x, y };
      }
      return null;
    });
    let target = await findWalker();
    let how = 'one in view';
    if (!target) {
      // The menu picks a random map, and on about one in ten no walker is in
      // view near the roadblock two days on (the check failed now and then
      // for that reason alone). Bring one into view instead of hoping; a city
      // with no walker on its roads still fails.
      how = await page.evaluate(() => {
        const g = window.colonia.game;
        // Away from the map's edges (the camera stops at the border, so a walker
        // at the entrance, like a newcomer, would sit under the top panel), and
        // a street walker if there is one.
        const m = g.map;
        const inland = (v) => m.road[m.idx(v.x, v.y)] && v.x > 15 && v.y > 15 && v.x < m.w - 15 && v.y < m.h - 15;
        const all = [...g.walkers.values()];
        const w = all.find((v) => inland(v) && v.kind === 'roamer') || all.find(inland);
        if (!w) return `no walker on a road (${g.walkers.size} walkers, seed ${g.seed})`;
        window.colonia.renderer.camera.centerOnTile(w.x, w.y);
        return `none in view (seed ${g.seed}), centered on walker type ${w.type}`;
      });
      await page.waitForTimeout(200);
      target = await findWalker();
    }
    check('walkers are on screen to click', !!target, how);
    if (target) {
      await page.mouse.click(target.x, target.y);
      await page.waitForTimeout(150);
      const wp = await page.evaluate(() => ({
        target: window.colonia.ui.info.target,
        ring: window.colonia.renderer.selectedWalker,
        head: document.querySelector('#info-panel h3')?.textContent || '',
        says: document.querySelector('#info-panel .walker-says')?.textContent || '',
      }));
      check('clicking a walker opens its panel: who it is and what it says', wp.target?.kind === 'walker' && wp.target.id === target.id && wp.ring === target.id && wp.head.length > 0 && wp.says.length > 4, JSON.stringify(wp));
      await page.click('#info-panel button:has-text("Follow")');
      const following = await page.evaluate(() => !!window.colonia.renderer.follow);
      await page.mouse.click(target.x, target.y, { button: 'right' });
      const closed = await page.evaluate(() => !window.colonia.renderer.follow && !window.colonia.renderer.selectedWalker);
      check('Follow keeps a walker in view; closing the panel lets go', following && closed, JSON.stringify({ following, closed }));
      // The walker pressed on is the one clicked, even if it has walked on
      // by the release (at 4x it covers half a tile in a click).
      // Paused while it aims: running (at 4x since step 5) a walker could
      // walk out from under the pointer between finding it and the press,
      // and the check failed now and then for that reason alone.
      const wasPaused = await page.evaluate(() => { const app = window.colonia; const was = app.paused; if (!was) app.togglePause(); return was; });
      await page.waitForTimeout(50);
      // A walker can finish its trip during the press (it then leaves the map,
      // and the click rightly finds nothing: a failure once in about ten
      // runs). Such a try does not count; another walker is pressed instead.
      let press = null;
      for (let attempt = 0; attempt < 3 && !press; attempt++) {
        const fresh = await findWalker();
        if (!fresh) break;
        await page.mouse.move(fresh.x, fresh.y);
        // What the click logic sees at the press (in the detail on failure).
        const seen = await page.evaluate(({ x, y }) => {
          const app = window.colonia;
          const r = app.renderer;
          const rect = app.canvas.getBoundingClientRect();
          const sx = x - rect.left;
          const sy = y - rect.top;
          const t = r.camera.screenToTile(sx, sy);
          const m = app.game.map;
          return { strict: r.pickWalker(sx, sy, false), loose: r.pickWalker(sx, sy, true), tool: app.input.tool || null, tile: t, building: m.inBounds(t.x, t.y) ? m.buildingAt(t.x, t.y) : -1, paused: app.paused };
        }, fresh);
        await page.mouse.down();
        await page.evaluate(() => { const app = window.colonia; for (let k = 0; k < 12; k++) app.game.tick(); app.renderer.render(0, 0.016); });
        await page.mouse.up();
        await page.waitForTimeout(150);
        const got = await page.evaluate(() => window.colonia.ui.info.target);
        const stayed = await page.evaluate((id) => window.colonia.game.walkers.has(id), fresh.id);
        await page.mouse.click(fresh.x, fresh.y, { button: 'right' });
        if (stayed) press = { got, want: fresh.id, seen, attempt };
      }
      check('a walker pressed on is the one clicked, even if it walked on before the release', !!press && press.got?.kind === 'walker' && press.got.id === press.want, JSON.stringify(press));
      if (!wasPaused) await page.evaluate(() => window.colonia.togglePause());
    }
  }

  // 5a2b. Rubble remembers what stood there and offers to rebuild it, on the
  //      same spot, from its panel.
  const fell = await page.evaluate(() => {
    const app = window.colonia;
    const reply = app.ui.console.run('collapse');
    const m = /at (\d+),(\d+)/.exec(reply);
    if (!m) return { reply };
    const x = Number(m[1]);
    const y = Number(m[2]);
    app.ui.info.showTile(x, y);
    return { x, y, rubble: app.game.map.rubble[app.game.map.idx(x, y)] };
  });
  let rebuilt = null;
  if (fell.x !== undefined) {
    const label = await page.textContent('#info-panel button:has-text("Rebuild")').catch(() => null);
    await page.click('#info-panel button:has-text("Rebuild")').catch(() => {});
    rebuilt = await page.evaluate(({ x, y }) => ({ standing: window.colonia.game.map.buildingAt(x, y) > 0, panel: window.colonia.ui.info.target?.kind }), fell);
    rebuilt.label = label;
    await page.evaluate(() => window.colonia.ui.info.close());
  }
  check('rubble offers to rebuild what stood there, on the same spot', fell.rubble === 1 && !!rebuilt && rebuilt.standing && /^Rebuild the .+ \(\d+ Dn\)$/.test(rebuilt.label || ''), JSON.stringify({ fell, rebuilt }));

  // 5a2c. Fishing and the hippodrome: built with the console's builders (the
  //       player's construction API), their panels show the boat, the catch
  //       and the races; a click on any section of the track opens the
  //       hippodrome's panel.
  const water = await page.evaluate(() => {
    const app = window.colonia;
    const g = app.game;
    const free = g.cheats.freeBuild;
    g.cheats.freeBuild = true;
    const out = { fish: app.ui.console.run('fishing'), hip: app.ui.console.run('hippodrome') };
    g.cheats.freeBuild = free;
    const find = (k) => [...g.buildings.values()].find((b) => b.def.kind === k || b.type === k);
    const text = () => document.querySelector('#info-panel')?.textContent || '';
    const wharf = find('wharf');
    if (wharf) { app.ui.info.showBuilding(wharf.id); out.wharf = text(); }
    const part = find('hippodrome_part');
    if (part) { app.ui.info.showBuilding(part.id); out.target = app.ui.info.target?.id; out.main = part.main; out.hipPanel = text(); }
    app.ui.info.close();
    app.renderer.render(0, 0.016);
    return out;
  });
  check('a wharf can be placed, and its panel shows its boat and catch', /Fishing/.test(water.wharf || '') && /Catch in store/.test(water.wharf || '') && errors.length === 0, JSON.stringify({ fish: water.fish, wharf: (water.wharf || '').slice(0, 160) }));
  check('a hippodrome can be placed; any section opens its panel with the races', !!water.main && water.target === water.main && /Races/.test(water.hipPanel || '') && errors.length === 0, JSON.stringify({ hip: water.hip, target: water.target, main: water.main }));

  // 5a2d. The cloth industry from the build menu: each of the three buildings
  //       is in its category, the click picks it as the tool, and a click on
  //       the map places it (the flax farm on meadow, all beside a road).
  const clothPlaced = [];
  for (const [cat, key, size] of [['Farms', 'farm_flax', 3], ['Industry', 'linen_ws', 2], ['Industry', 'clothing_ws', 2]]) {
    const at = await page.evaluate(({ size, meadow }) => {
      const app = window.colonia;
      const m = app.game.map;
      const home = [...app.game.buildings.values()].find((b) => b.house && b.house.pop > 0);
      // Top-left corners of free land with a road along an edge; a farm needs
      // some meadow under it, as the game's own rule says (asking for all nine
      // tiles found no spot on maps whose fields lie back from the roads).
      const fits = (x, y) => {
        let fertile = 0;
        for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
          const i = m.idx(x + dx, y + dy);
          if (!m.isFree(x + dx, y + dy) || m.terrain[i] === 2) return false;
          if (m.terrain[i] === 1) fertile++;
        }
        if (meadow && fertile === 0) return false;
        for (let k = 0; k < size; k++) if (m.hasRoad(x + k, y - 1) || m.hasRoad(x + k, y + size) || m.hasRoad(x - 1, y + k) || m.hasRoad(x + size, y + k)) return true;
        return false;
      };
      for (let r = 2; r < 60; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = home.x + dx; const y = home.y + dy;
          if (!m.inBounds(x, y) || !m.inBounds(x + size, y + size) || !fits(x, y)) continue;
          // planAction takes a big building by its middle tile.
          const off = Math.floor((size - 1) / 2);
          app.renderer.camera.centerOnTile(x + off, y + off);
          app.renderer.render(0, 0.016);
          return { x, y, ax: x + off, ay: y + off };
        }
      }
      // The menu's sandbox has a random seed: on some maps no free meadow
      // touches a road. Then the free meadow nearest a road (walking over
      // open land, at most 10 tiles) will do, and the test drags a road to
      // it first (`link`: from a road tile to a tile beside the field).
      if (!meadow) return null;
      const free = (x, y) => {
        for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) if (!m.inBounds(x + dx, y + dy) || !m.isFree(x + dx, y + dy) || m.terrain[m.idx(x + dx, y + dy)] !== 1) return false;
        return true;
      };
      // Breadth first from every road tile over open land: how far, and from which road tile.
      const dist = new Map();
      const from = new Map();
      const queue = [];
      for (let i = 0; i < m.size; i++) if (m.road[i]) { dist.set(i, 0); from.set(i, i); queue.push(i); }
      for (let q = 0; q < queue.length; q++) {
        const i = queue[q];
        if (dist.get(i) >= 10) continue;
        const x = m.xOf(i); const y = m.yOf(i);
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (!m.inBounds(nx, ny)) continue;
          const j = m.idx(nx, ny);
          if (dist.has(j) || !m.isFree(nx, ny) || m.terrain[j] === 2) continue;
          dist.set(j, dist.get(i) + 1); from.set(j, from.get(i)); queue.push(j);
        }
      }
      let best = null;
      for (let y = 1; y < m.h - size - 1; y++) {
        for (let x = 1; x < m.w - size - 1; x++) {
          if (!free(x, y)) continue;
          for (let k = 0; k < size; k++) {
            for (const [lx, ly] of [[x + k, y - 1], [x + k, y + size], [x - 1, y + k], [x + size, y + k]]) {
              const d = dist.get(m.idx(lx, ly));
              if (d === undefined || d === 0 || (best && d >= best.d)) continue;
              const r = from.get(m.idx(lx, ly));
              best = { d, x, y, link: { x: lx, y: ly, rx: m.xOf(r), ry: m.yOf(r) } };
            }
          }
        }
      }
      if (!best) return null;
      const off = Math.floor((size - 1) / 2);
      app.renderer.camera.centerOnTile(Math.round((best.link.x + best.link.rx) / 2), Math.round((best.link.y + best.link.ry) / 2));
      app.renderer.render(0, 0.016);
      return { x: best.x, y: best.y, ax: best.x + off, ay: best.y + off, link: best.link };
    }, { size, meadow: key === 'farm_flax' });
    if (at && at.link) {
      // Drag a road from the road tile out to the field's edge, then look at the field.
      await page.evaluate(() => window.colonia.ui.selectTool('road'));
      await page.waitForTimeout(100);
      const a = await toScreen(at.link.rx, at.link.ry);
      const b = await toScreen(at.link.x, at.link.y);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
      await page.mouse.move(b.x, b.y, { steps: 5 });
      await page.mouse.up();
      await page.keyboard.press('Escape');
      await page.evaluate(({ ax, ay }) => { window.colonia.renderer.camera.centerOnTile(ax, ay); window.colonia.renderer.render(0, 0.016); }, at);
    }
    await page.click(`.cat-btn[title^="${cat}"]`);
    const listed = await page.isVisible(`.build-item[data-key="${key}"]`);
    if (listed) await page.click(`.build-item[data-key="${key}"]`);
    const tool = await page.evaluate(() => window.colonia.input.tool);
    let placed = null;
    if (at && tool === key) {
      const p = await toScreen(at.ax, at.ay);
      await page.mouse.move(p.x - 4, p.y);
      await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(100);
      await page.mouse.click(p.x, p.y);
      placed = await page.evaluate(({ x, y, key }) => {
        const app = window.colonia;
        const b = app.game.buildings.get(app.game.map.building[app.game.map.idx(x, y)]);
        return b && b.type === key ? { type: b.type, x: b.x, y: b.y, road: b.accessRoad >= 0 } : null;
      }, { ...at, key });
    }
    if (await page.evaluate(() => window.colonia.input.tool)) await page.keyboard.press('Escape');
    clothPlaced.push({ key, listed, tool, at, placed });
  }
  check('the Linarium, Textrinum and Taberna Vestiaria (the cloth chain) are in the build menu and can be placed', clothPlaced.every((c) => c.listed && c.tool === c.key && c.placed && c.placed.x === c.at.x && c.placed.y === c.at.y && c.placed.road) && errors.length === 0, JSON.stringify(clothPlaced));

  // 5a2e. The governor: his house picked from the build menu and placed with
  //       the mouse on open land (no road needed), then the Imperial advisor:
  //       his rank and savings, a salary picked from the list, and a gift
  //       paid from his savings.
  const govAt = await page.evaluate(() => {
    const app = window.colonia;
    const m = app.game.map;
    const home = [...app.game.buildings.values()].find((b) => b.house && b.house.pop > 0);
    const fits = (x, y) => {
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) if (!m.inBounds(x + dx, y + dy) || !m.isFree(x + dx, y + dy) || m.terrain[m.idx(x + dx, y + dy)] === 2) return false;
      return true;
    };
    for (let r = 4; r < 60; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !fits(home.x + dx, home.y + dy)) continue;
        app.renderer.camera.centerOnTile(home.x + dx + 1, home.y + dy + 1);
        app.renderer.render(0, 0.016);
        return { x: home.x + dx, y: home.y + dy };
      }
    }
    return null;
  });
  await page.click('.cat-btn[title^="Government"]');
  const govListed = await page.isVisible('.build-item[data-key="governor_house"]');
  if (govListed) await page.click('.build-item[data-key="governor_house"]');
  const govTool = await page.evaluate(() => window.colonia.input.tool);
  if (govAt && govTool === 'governor_house') {
    const p = await toScreen(govAt.x + 1, govAt.y + 1);
    await page.mouse.move(p.x - 4, p.y);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(100);
    await page.mouse.click(p.x, p.y);
  }
  if (await page.evaluate(() => window.colonia.input.tool)) await page.keyboard.press('Escape');
  const govPlaced = await page.evaluate(() => {
    const b = [...window.colonia.game.buildings.values()].find((x) => x.def.kind === 'residence');
    return b ? { type: b.type, x: b.x, y: b.y } : null;
  });
  check('the Governor\'s House is in the build menu and can be placed with no road', govListed && govTool === 'governor_house' && govPlaced && govPlaced.x === govAt.x && govPlaced.y === govAt.y && errors.length === 0, JSON.stringify({ govListed, govTool, govAt, govPlaced }));
  // Its panel's title: the Latin name with the English after it.
  const govHead = await page.evaluate(() => {
    const app = window.colonia;
    const b = [...app.game.buildings.values()].find((x) => x.def.kind === 'residence');
    if (!b) return null;
    app.ui.info.showBuilding(b.id);
    const head = document.querySelector('#info-panel h3')?.textContent || '';
    app.ui.info.close();
    return head;
  });
  check('a building\'s panel title shows its Latin name with the English after it', govHead === 'Praetorium (Governor\'s House)', JSON.stringify(govHead));
  await page.keyboard.press('F2');
  await page.click('.tab:has-text("Imperial")');
  const govText = await page.textContent('.governor-card');
  await page.selectOption('.salary-select', '6');
  const salaryRank = await page.evaluate(() => window.colonia.game.city.governor.salaryRank);
  const before = await page.evaluate(() => {
    const g = window.colonia.game;
    window.colonia.ui.console.run(`savings ${400 - g.city.governor.savings}`);
    return { favor: g.city.ratings.favor, treasury: g.city.treasury };
  });
  await page.click('.tab:has-text("Imperial")'); // shown again with the new savings
  const lavish = await page.textContent('.gift-btn:has-text("Lavish")');
  await page.click('.gift-btn:has-text("Lavish")');
  const after = await page.evaluate(() => ({ savings: window.colonia.game.city.governor.savings, favor: window.colonia.game.city.ratings.favor, treasury: window.colonia.game.city.treasury }));
  check('the Imperial advisor shows the rank and savings, sets the salary and sends a gift from savings', /Procurator/.test(govText) && /Personal savings/.test(govText) && salaryRank === 6 && /300 Dn \(\+10 favor\)/.test(lavish) && after.savings === 100 && after.favor > before.favor && after.treasury === before.treasury && errors.length === 0, JSON.stringify({ govText: govText.slice(0, 120), salaryRank, lavish, before, after }));
  await page.keyboard.press('Escape');

  // 5a3. The Problems overlay: a legend, and the reason over a flagged building;
  //      the Production advisor and the trend charts.
  await page.selectOption('.hud-select', 'problems');
  const flagged = await page.evaluate(async () => {
    const app = window.colonia;
    const g = app.game;
    const ov = app.renderer.overlay;
    const b = [...g.buildings.values()].find((x) => ov.tip(g, x) && x.size === 1);
    if (!b) return null;
    app.renderer.camera.centerOnTile(b.x, b.y);
    return { x: b.x, y: b.y, text: ov.tip(g, b) };
  });
  check('the Problems overlay flags something in the demo city', !!flagged);
  if (flagged) {
    await page.waitForTimeout(150);
    const fp = await toScreen(flagged.x, flagged.y);
    await page.mouse.move(fp.x, fp.y);
    await page.waitForTimeout(250);
    const tip = await page.evaluate(() => { const t = document.getElementById('tooltip'); return { shown: !t.classList.contains('hidden'), text: t.textContent }; });
    const legend = await page.isVisible('#overlay-legend:has-text("Home needs: water")');
    check('Problems overlay: a legend, and pointing at a building says what is wrong', tip.shown && tip.text === flagged.text && legend, JSON.stringify({ tip, legend, want: flagged.text }));
  }
  // 5a3b. The crime overlay, with a protester, a thief and a riot on the
  //       streets (drawn by their own art); then the criminals are cleared so
  //       they cannot upset the checks that follow.
  await page.evaluate(() => {
    const con = window.colonia.ui.console;
    con.run('crime protest');
    con.run('crime thief');
    con.run('riot');
  });
  await page.selectOption('.hud-select', 'crime');
  const crimeHome = await page.evaluate(() => {
    const app = window.colonia;
    const g = app.game;
    const ov = app.renderer.overlay;
    const b = [...g.buildings.values()].find((x) => x.house && x.house.pop > 0 && x.size === 1 && ov.tip(g, x));
    if (b) app.renderer.camera.centerOnTile(b.x, b.y);
    const about = {};
    for (const w of g.walkers.values()) if (w.kind === 'criminal') about[w.type] = (about[w.type] || 0) + 1;
    return { key: ov.key, about, home: b ? { x: b.x, y: b.y, text: ov.tip(g, b) } : null };
  });
  await page.waitForTimeout(300);
  let crimeTipShown = null;
  if (crimeHome.home) {
    const cp = await toScreen(crimeHome.home.x, crimeHome.home.y);
    await page.mouse.move(cp.x, cp.y);
    await page.waitForTimeout(250);
    crimeTipShown = await page.evaluate(() => document.getElementById('tooltip').textContent);
  }
  const crimeLegend = await page.isVisible('#overlay-legend:has-text("Little crime")');
  // The criminals appear by the unhappiest home, which on some random maps is
  // out of view of the home above: look at the protester (it stands still)
  // and count the criminals actually drawn there.
  await page.evaluate(() => {
    const app = window.colonia;
    const p = [...app.game.walkers.values()].find((w) => w.type === 'protester');
    if (p) app.renderer.camera.centerOnTile(p.x, p.y);
  });
  await page.waitForTimeout(300);
  const crimeDrawn = await page.evaluate(() => {
    const g = window.colonia.game;
    return window.colonia.renderer.walkerSpots.filter((s) => g.walkers.get(s.id)?.kind === 'criminal').length;
  });
  check('the crime overlay opens: legend, a home\'s mood on hover, criminals drawn, no errors',
    crimeHome.key === 'crime' && !!crimeHome.home && /Mood \d+/.test(crimeTipShown || '') && crimeLegend && crimeHome.about.protester >= 1 && crimeHome.about.thief >= 1 && crimeHome.about.rioter >= 1 && crimeDrawn > 0 && errors.length === 0,
    JSON.stringify({ ...crimeHome, crimeTipShown, crimeLegend, crimeDrawn, errors }));
  await page.evaluate(() => {
    const g = window.colonia.game;
    for (const w of [...g.walkers.values()]) if (w.kind === 'criminal') { w.dead = true; g.walkers.delete(w.id); }
  });
  // 5a3c. The Disease overlay, with a home made sick from the console: its
  //       column, its words on hover, the legend, no errors.
  const sickHome = await page.evaluate(() => {
    const app = window.colonia;
    const g = app.game;
    const b = [...g.buildings.values()].find((x) => x.house && x.house.pop >= 4 && x.size === 1);
    if (!b) return null;
    const said = app.ui.console.run(`sick ${b.x} ${b.y}`);
    app.renderer.camera.centerOnTile(b.x, b.y);
    return { x: b.x, y: b.y, said, sick: b.house.sick };
  });
  await page.selectOption('.hud-select', 'disease');
  await page.waitForTimeout(300);
  let healthTipShown = null;
  if (sickHome) {
    const hp = await toScreen(sickHome.x, sickHome.y);
    await page.mouse.move(hp.x, hp.y);
    await page.waitForTimeout(250);
    healthTipShown = await page.evaluate(() => document.getElementById('tooltip').textContent);
  }
  const healthLegend = await page.isVisible('#overlay-legend:has-text("Sick home")');
  const healthReport = await page.evaluate(() => window.colonia.ui.console.run('health'));
  check('the Disease overlay opens: a sick home marked, its health on hover, the legend, no errors',
    !!sickHome && sickHome.sick > 0 && /Sick: \d+ days? left/.test(healthTipShown || '') && /Health \d+/.test(healthTipShown || '') && healthLegend && /City health \d+/.test(healthReport) && errors.length === 0,
    JSON.stringify({ sickHome, healthTipShown, healthLegend, healthReport: healthReport.slice(0, 200), errors }));
  await page.selectOption('.hud-select', 'none');
  const legendGone = await page.isHidden('#overlay-legend');
  // Wheat in store, so the goods table has a row to show however young the
  // city is (the check used to find "Wheat" in a Wheat Farm's trouble line,
  // and the young city had made and stored nothing yet).
  await page.evaluate(() => window.colonia.ui.console.run('give wheat 400'));
  await page.keyboard.press('F2');
  await page.click('.tab:has-text("Production")');
  const prod = await page.evaluate(() => ({ rows: document.querySelectorAll('.modal table.tbl tr').length, text: document.querySelector('.modal-body')?.textContent || '', goods: [...document.querySelectorAll('.modal table.tbl tr td:first-child')].map((td) => td.textContent) }));
  await page.click('.tab:has-text("Overview")');
  const charts = await page.evaluate(() => document.querySelectorAll('.modal canvas.trend').length);
  check('Production advisor lists goods and bottlenecks; the Overview draws three trend charts', legendGone && prod.rows > 1 && /Bottlenecks/.test(prod.text) && prod.goods.some((t) => /Wheat/.test(t)) && charts === 3, JSON.stringify({ legendGone, rows: prod.rows, charts, goods: prod.goods.slice(0, 8) }));
  // 5a4. The Health, Education and Entertainment advisors open and show their
  //      numbers: a row per kind of building with figures, an advice line,
  //      and staffed counts that match the city; the Overview's health and
  //      crime lines. (A home is still sick from the Disease overlay check.)
  const overviewLines = await page.evaluate(() => document.querySelector('.modal-body').textContent);
  const coverageTabs = [];
  for (const [tab, kinds] of [['Health', ['clinic', 'hospital', 'baths', 'barber']], ['Education', ['school', 'library', 'academy']], ['Entertainment', ['theater', 'amphitheater', 'colosseum', 'actor_troupe', 'gladiator_school', 'menagerie']]]) {
    await page.click(`.tab:has-text("${tab}")`);
    coverageTabs.push(await page.evaluate(({ tab, kinds }) => {
      const g = window.colonia.game;
      const body = document.querySelector('.modal-body');
      const rows = kinds.map((k) => body.querySelector(`tr[data-kind="${k}"]`));
      // The "Staffed" cell of each row: "<staffed> of <built>", as the city has them.
      const staffedOk = rows.every((tr, i) => {
        if (!tr) return false;
        const all = [...g.buildings.values()].filter((b) => b.type === kinds[i]);
        return tr.children[1].textContent === `${all.filter((b) => b.efficiency > 0).length} of ${all.length}`;
      });
      const figures = rows.every((tr) => tr && [...tr.querySelectorAll('td.num')].every((td) => /\d/.test(td.textContent)));
      const advice = body.querySelector('.status.advice')?.textContent || '';
      return { tab, rows: rows.filter(Boolean).length, staffedOk, figures, advice, sick: /Sick homes now/.test(body.textContent) };
    }, { tab, kinds }));
  }
  check('the Health, Education and Entertainment advisors show every kind of building with its numbers and an advice line; the Overview has health and crime lines',
    coverageTabs.every((t) => t.staffedOk && t.figures && t.advice.length > 10) && coverageTabs[0].sick && /City health/.test(overviewLines) && /Crime/.test(overviewLines) && errors.length === 0,
    JSON.stringify({ coverageTabs, errors }));
  if (shots) await page.screenshot({ path: path.join(shots, 'smoke-advisor-entertainment.png') });
  // Clicking a building type's name goes to one of them, with its panel open.
  const named = await page.evaluate(() => {
    const link = document.querySelector('.modal-body tr[data-kind] .linkbtn');
    return link ? link.closest('tr').dataset.kind : null;
  });
  if (named) await page.click('.modal-body tr[data-kind] .linkbtn');
  await page.waitForTimeout(150);
  const shownType = await page.evaluate(() => {
    const app = window.colonia;
    const t = app.ui.info.target;
    const b = t && t.kind === 'building' ? app.game.buildings.get(t.id) : null;
    return { modal: !!document.querySelector('.modal'), type: b ? b.type : null };
  });
  check('clicking a building type in those advisors shows one of them', !!named && !shownType.modal && shownType.type === named, JSON.stringify({ named, shownType }));
  await page.evaluate(() => window.colonia.ui.info.close());
  if (shownType.modal) await page.keyboard.press('Escape'); // the click closed the advisors (Escape on the map opens the game menu)

  // 5b. Military: garrison, fort panel + deploy by clicking the map, raid alert, advisor
  const gar = await page.evaluate(() => {
    const app = window.colonia;
    app.paused = true;
    const out = app.ui.console.run('garrison');
    app.ui.console.run('days 60');
    const g = app.game;
    const forts = [...g.buildings.values()].filter((b) => b.def.kind === 'fort');
    const soldiers = [...g.units.values()].filter((u) => u.side === 'rome').length;
    const fort = forts.find((f) => [...g.units.values()].some((u) => u.fort === f.id)) || forts[0];
    const bk = [...g.buildings.values()].find((b) => b.type === 'barracks');
    const why = bk ? { eff: bk.efficiency, labor: bk.laborAccess, road: bk.accessRoad, stock: bk.stock, workforce: g.city.workforce, jobs: g.city.jobs, prio: g.city.laborPriority, fortsStaffed: forts.filter((f) => f.efficiency > 0).length } : { barracks: false };
    return { out, forts: forts.length, soldiers, fortId: fort ? fort.id : 0, fx: fort ? fort.x : 0, fy: fort ? fort.y : 0, why, seed: g.seed };
  });
  check('garrison: forts built and soldiers recruited', gar.forts >= 1 && gar.soldiers >= 1, `${gar.forts} forts, ${gar.soldiers} soldiers; ${gar.out}; ${JSON.stringify(gar.why)}; seed ${gar.seed}`);
  if (gar.fortId) {
    await page.evaluate((id) => { window.colonia.renderer.camera.centerOnTile(window.colonia.game.buildings.get(id).x, window.colonia.game.buildings.get(id).y); window.colonia.ui.info.showBuilding(id); }, gar.fortId);
    await page.click('#info-panel button:has-text("Deploy")');
    check('deploy button enters deploy mode', await page.evaluate(() => window.colonia.deploying > 0));
    // A free tile whose spot on screen shows the map: the first free tile
    // could lie under the open info panel, and the click then hit the panel
    // (seed 905205: no rally point set).
    const target = await page.evaluate(([fx, fy]) => {
      const app = window.colonia;
      const m = app.game.map;
      const cam = app.renderer.camera;
      const rect = app.canvas.getBoundingClientRect();
      const onMap = (x, y) => {
        const wx = (x + 0.5 - (y + 0.5)) * 32;
        const wy = (x + 0.5 + (y + 0.5)) * 16;
        const sx = rect.left + ((wx - cam.x) * cam.scale) / cam.dpr;
        const sy = rect.top + ((wy - cam.y) * cam.scale) / cam.dpr;
        return document.elementFromPoint(sx, sy) === app.canvas;
      };
      for (let r = 5; r < 14; r++) for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
        if (m.isFree(fx + dx, fy + dy) && onMap(fx + dx, fy + dy)) return { x: fx + dx, y: fy + dy };
      }
      return null;
    }, [gar.fx, gar.fy]);
    if (target) {
      const p = await toScreen(target.x, target.y);
      await page.mouse.click(p.x, p.y);
      const rally = await page.evaluate((id) => window.colonia.game.buildings.get(id).rally, gar.fortId);
      check('clicking the map deploys the soldiers there', !!rally && Math.floor(rally.x) === target.x && Math.floor(rally.y) === target.y, JSON.stringify(rally));
    } else check('clicking the map deploys the soldiers there', false, 'no free tile on screen near the fort');
    // Never leave deploy mode on for the steps that follow.
    await page.evaluate(() => { if (window.colonia.deploying) window.colonia.cancelDeploy(); });
  }
  // 5b2. The Empire map: E opens it and it draws (a scouted warband and a
  //      caravan on the way included), clicking the warband closes it and
  //      looks at the map edge it will enter by, Escape closes it.
  await page.evaluate(() => {
    const app = window.colonia;
    const g = app.game;
    const r0 = g.city.trade.routes.tarraco;
    window.__empireSaved = { warned: g.military.warned, next: g.military.nextRaidMonth, open: r0.open, visit: r0.nextVisit, paused: app.paused };
    app.paused = true; // hold the timers still while the test reads them
    // The middle of the x = 0 edge, which is north-west on screen (as the sim's scouts name it).
    g.military.warned = { origin: { x: 0, y: Math.floor(g.map.h / 2) }, size: 14, dir: 'north-west' };
    g.military.nextRaidMonth = g.time.totalMonths + 2;
    const r = g.city.trade.routes.tarraco;
    r.open = true;
    r.nextVisit = g.time.totalDays + 5;
  });
  await page.keyboard.press('e');
  await page.waitForSelector('canvas.empire-full', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(200);
  const empire = await page.evaluate(() => {
    const c = document.querySelector('canvas.empire-full');
    if (!c) return null;
    // Not blank: the parchment, the sea, the routes and figures give many colors.
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const colors = new Set();
    for (let i = 0; i < d.length; i += 4 * 37) colors.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4},${d[i + 3] >> 6}`);
    const ui = window.colonia.ui;
    return {
      kind: ui.modalKind, w: c.width, h: c.height, colors: colors.size,
      list: [...document.querySelectorAll('.empire-side .empire-row')].map((e) => e.textContent).filter((t) => /days|month/.test(t)),
      hudBtn: !!document.getElementById('hud-empire'),
    };
  });
  check('E opens the empire map and it draws', !!empire && empire.kind === 'empire' && empire.w > 300 && empire.colors > 12 && empire.hudBtn, JSON.stringify(empire && { ...empire, list: undefined }));
  check('the empire map lists the caravan and the warband with their time left', !!empire && empire.list.some((t) => /Tarraco caravan: 5 days/.test(t)) && empire.list.some((t) => /Warband of 14 from the north-west, in 2 months/.test(t)), JSON.stringify(empire && empire.list));
  // Hovering the warband reads it out; clicking it pans the city view to its edge.
  const band = await page.evaluate(() => {
    const view = window.colonia.ui.empire;
    const t = view.travelers.find((o) => o.kind === 'warband');
    return t ? view.clientPoint(t) : null;
  });
  if (band) {
    await page.mouse.move(band.x, band.y);
    await page.waitForTimeout(100);
    const readout = await page.textContent('.empire-readout');
    check('pointing at the warband reads it out', /Warband of 14 from the north-west, in 2 months/.test(readout), readout);
    const before = await page.evaluate(() => { const c = window.colonia.renderer.camera; const r = window.colonia.canvas.getBoundingClientRect(); return c.screenToTile(r.width / 2, r.height / 2); });
    await page.mouse.click(band.x, band.y);
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => { const c = window.colonia.renderer.camera; const r = window.colonia.canvas.getBoundingClientRect(); return { kind: window.colonia.ui.modalKind, at: c.screenToTile(r.width / 2, r.height / 2) }; });
    // Its edge is x = 0 in tile terms: the view moved toward it.
    check('clicking the warband closes the map and looks at its map edge', after.kind === null && after.at.x < before.x - 3, JSON.stringify({ before, after }));
  } else {
    check('the scouted warband is on the empire map', false);
  }
  await page.click('#hud-empire');
  await page.waitForTimeout(150);
  const viaButton = await page.evaluate(() => window.colonia.ui.modalKind);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  const closed = await page.evaluate(() => ({ kind: window.colonia.ui.modalKind, canvas: !!document.querySelector('canvas.empire-full') }));
  check('the top-bar compass opens the empire map and Escape closes it', viaButton === 'empire' && closed.kind === null && !closed.canvas, JSON.stringify({ viaButton, closed }));
  await page.evaluate(() => {
    const g = window.colonia.game;
    const was = window.__empireSaved; // put the raid schedule and the route back as they were
    g.military.warned = was.warned;
    g.military.nextRaidMonth = was.next;
    g.city.trade.routes.tarraco.open = was.open;
    g.city.trade.routes.tarraco.nextVisit = was.visit;
    window.colonia.paused = was.paused;
  });

  await page.evaluate(() => window.colonia.ui.console.run('invade 4'));
  await page.waitForTimeout(600);
  const threat = await page.evaluate(() => { const el = document.querySelector('.hud-btn.threat'); return el ? { hidden: el.classList.contains('hidden'), text: el.textContent } : null; });
  check('raid alert shows in the top bar', !!threat && !threat.hidden && threat.text.includes('⚔'), JSON.stringify(threat));
  await page.keyboard.press('F2');
  await page.click('.tab:has-text("Military")');
  check('military advisor lists forts', await page.isVisible('.modal th:has-text("Fort")'));
  await page.click('.tab:has-text("Trade")');
  check('trade advisor draws the empire map', await page.isVisible('canvas.empire-map'));
  await page.keyboard.press('Escape');

  // 5b3. Caesar's call for troops: the Imperial advisor switches the forts
  //      to Empire service and sends them (after its own confirmation).
  //      Then his legions: the top bar and the empire map name them. Then
  //      an arch earned goes across a road.
  await page.evaluate(() => window.colonia.ui.console.run('battle placentia 8'));
  await page.keyboard.press('F2');
  await page.click('.tab:has-text("Imperial")');
  const callText = await page.textContent('.battle-card');
  await page.evaluate(() => {
    // Every fort on: each click redraws the card, so find the buttons afresh.
    for (let k = 0; k < 12; k++) {
      const off = [...document.querySelectorAll('.battle-card .service-btn')].find((b) => !b.classList.contains('active'));
      if (!off) break;
      off.click();
    }
  });
  await page.click('.battle-card .send-troops');
  await page.click('.modal-foot .btn:has-text("Send them")');
  await page.waitForTimeout(200);
  const sent = await page.evaluate(() => {
    const g = window.colonia.game;
    const b = g.military.battle;
    return { sent: !!(b && b.sent), away: [...g.units.values()].filter((u) => u.away).length, strength: b && b.sent ? b.sent.strength : 0, kind: window.colonia.ui.modalKind, card: document.querySelector('.battle-card')?.textContent || '' };
  });
  check('the Imperial advisor shows Caesar\'s call for troops and sends the forts switched to Empire service', /Placentia/.test(callText) && sent.sent && sent.away > 0 && sent.strength > 0 && sent.kind === 'advisors' && /strength/.test(sent.card) && errors.length === 0, JSON.stringify({ call: callText.slice(0, 90), ...sent, card: sent.card.slice(0, 120) }));
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.colonia.ui.console.run('legion now 3'));
  await page.waitForTimeout(400);
  const legionHud = await page.evaluate(() => { const el = document.querySelector('.hud-btn.threat'); return el ? { hidden: el.classList.contains('hidden'), text: el.textContent, title: el.title } : null; });
  await page.keyboard.press('e');
  await page.waitForSelector('canvas.empire-full', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  const legionRows = await page.evaluate(() => [...document.querySelectorAll('.empire-side .empire-row')].map((e) => e.textContent));
  check('Caesar\'s legions arrive: the top bar names them, and the empire map shows them with the troops on their way', !!legionHud && !legionHud.hidden && /Caesar's legionaries/.test(legionHud.title)
    && legionRows.some((t) => /Caesar's legions in the province: 3 left/.test(t)) && legionRows.some((t) => /Your troops \(strength \d+\) on the way to Placentia/.test(t)), JSON.stringify({ legionHud, legionRows }));
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    // Caesar's men gone again (as if destroyed), so the steps that follow see the city as it was.
    const g = window.colonia.game;
    for (const u of [...g.units.values()]) if (u.legion) g.units.delete(u.id);
    g.military.caesar.army = null;
  });
  const archAt = await page.evaluate(() => {
    const app = window.colonia;
    const m = app.game.map;
    app.ui.console.run('arch');
    // A 5 x 3 patch of open land near the middle: a road along its middle row, the arch over it.
    const c = { x: Math.floor(m.w / 2), y: Math.floor(m.h / 2) };
    for (let r = 0; r < 30; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = c.x + dx;
          const y = c.y + dy;
          let ok = true;
          for (let j = -1; j <= 1 && ok; j++) for (let i = -1; i <= 5 && ok; i++) if (!m.isFree(x + i, y + j) || m.terrain[m.idx(x + i, y + j)] === 2) ok = false;
          if (ok) { app.renderer.camera.centerOnTile(x + 2, y); return { x, y }; }
        }
      }
    }
    return null;
  });
  let archPlaced = null;
  let archListed = false;
  let archTool = null;
  let archHover = null;
  if (archAt) {
    await page.waitForTimeout(150);
    await page.keyboard.press('r');
    const a = await toScreen(archAt.x, archAt.y);
    const b = await toScreen(archAt.x + 4, archAt.y);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.press('Escape');
    // (Another category first: a second click on the open one folds its list away.)
    await page.click('.cat-btn[title^="Roads"]');
    await page.click('.cat-btn[title^="Government"]');
    archListed = await page.isVisible('.build-item[data-key="triumphal_arch"]');
    if (archListed) {
      // Pointing at it fills the box under the list with its description.
      // That box used to grow with the text and shrink the list from below,
      // so the arch (the list's last item, scrolled to the bottom) slid
      // under the box while the pointer stayed put, and the click went to
      // the box: no tool. Point near its lower edge, as a player might, and
      // the arch must still be what is under the pointer.
      const arch = await page.evaluate(() => { const el = document.querySelector('.build-item[data-key="triumphal_arch"]'); el.scrollIntoView({ block: 'end' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom - 3, top: Math.round(r.top) }; });
      await page.mouse.move(arch.x, arch.y);
      await page.waitForTimeout(150);
      archHover = await page.evaluate((a) => { const e = document.elementFromPoint(a.x, a.y); return { under: e?.closest('[data-key]')?.dataset.key || e?.closest('[id]')?.id || null, top: Math.round(document.querySelector('.build-item[data-key="triumphal_arch"]').getBoundingClientRect().top), was: a.top, info: document.querySelector('#tool-info h4')?.textContent }; }, arch);
      await page.mouse.click(arch.x, arch.y);
    }
    const p = await toScreen(archAt.x + 2, archAt.y);
    await page.mouse.move(p.x - 4, p.y);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(100);
    archTool = await page.evaluate(() => { const r = window.colonia.renderer; return { tool: window.colonia.input.tool, plan: r.plan ? { reason: r.plan.reason, count: r.plan.count, at: r.plan.items[0] && [r.plan.items[0].x, r.plan.items[0].y] } : null }; });
    await page.mouse.click(p.x, p.y);
    if (await page.evaluate(() => window.colonia.input.tool)) await page.keyboard.press('Escape');
    await page.waitForTimeout(250); // (the build menu notices on its next frame)
    archPlaced = await page.evaluate(({ x, y }) => {
      const g = window.colonia.game;
      const b = [...g.buildings.values()].find((o) => o.type === 'triumphal_arch');
      return b ? { x: b.x, y: b.y, axis: b.axis, road: g.map.road[g.map.idx(x + 2, y)], listed: !!document.querySelector('.build-item[data-key="triumphal_arch"]') } : null;
    }, archAt);
  }
  // On failure: the road under the patch and the arch's plan there.
  const archWhy = archPlaced ? null : await page.evaluate((s) => {
    if (!s) return null;
    const app = window.colonia;
    const m = app.game.map;
    const rows = [-1, 0, 1].map((j) => [-1, 0, 1, 2, 3, 4, 5].map((i) => m.road[m.idx(s.x + i, s.y + j)]).join(''));
    return { rows, tool: app.input.tool, earned: app.game.city.archesEarned, modal: app.ui.modalKind, toasts: [...document.querySelectorAll('.toast')].slice(0, 3).map((e) => e.textContent) };
  }, archAt);
  check('pointing at the last build item shows it in the box below the list, and it stays under the pointer for the click', !!archHover && archHover.under === 'triumphal_arch' && archHover.top === archHover.was && /^Fornix/.test(archHover.info || ''), JSON.stringify(archHover));
  check('an arch earned is in the build menu and goes across a road, which runs on under it; then it leaves the menu', archListed && !!archPlaced && archPlaced.x === archAt.x + 1 && archPlaced.y === archAt.y - 1 && archPlaced.axis === 0 && archPlaced.road === 1 && !archPlaced.listed && errors.length === 0, JSON.stringify({ archAt, archListed, archTool, archPlaced, archWhy }));

  // 5c. The world around the city: smooth zoom, night lights, weather, settings.
  await page.evaluate(() => { window.colonia.renderer.camera.zoomIndex = 2; });
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(600);
  const zoomed = await page.evaluate(() => { const c = window.colonia.renderer.camera; return { zoom: c.zoom, target: c.targetZoom, moving: c.moving }; });
  check('mouse wheel eases to the next zoom level', zoomed.zoom === zoomed.target && zoomed.target > 1 && !zoomed.moving, JSON.stringify(zoomed));
  await page.evaluate(() => { window.colonia.renderer.camera.zoomIndex = 2; window.colonia.renderer.fixedTime = 0.8; });
  await page.waitForTimeout(250);
  const lights = await page.evaluate(() => window.colonia.renderer.stats.lights);
  check('at night homes and torches light up', lights > 0, `${lights} lights`);
  await page.evaluate(() => { window.colonia.renderer.fixedTime = null; window.colonia.ui.console.run('weather rain'); });
  check('console can change the weather', await page.evaluate(() => window.colonia.renderer.weather.kind === (window.colonia.renderer.pal.season === 'winter' ? 'snow' : 'rain')));
  // Seasons: the date chip names the season, and in winter rain falls as snow.
  const winter = await page.evaluate(() => {
    const app = window.colonia;
    const month = app.game.time.month;
    app.game.time.month = 0; // Ianuarius
    app.renderer.render(0, 0.016); // the renderer picks up the season
    app.ui.hud.update();
    const chip = document.querySelector('#hud-top .hud-stat.date');
    const out = { text: chip.textContent, title: chip.title, reply: app.ui.console.run('weather rain'), kind: app.renderer.weather.kind };
    app.renderer.render(0, 0.016);
    app.ui.hud.update();
    out.after = chip.title; // the tooltip names the (fitted) weather
    app.game.time.month = month;
    return out;
  });
  // The season's name only shows while the top bar has room for it.
  const fit = await page.evaluate(() => {
    const app = window.colonia;
    const c = app.game.city;
    const keep = { name: c.name, treasury: c.treasury, population: c.population };
    Object.assign(c, { name: 'Portus Mercatorum Magnus', treasury: 1234567, population: 23456 });
    app.ui.hud.update();
    const bar = document.getElementById('hud-top');
    const out = { hidden: bar.classList.contains('no-season'), over: bar.scrollWidth - bar.clientWidth };
    Object.assign(c, keep);
    app.ui.hud.update();
    out.shownAfter = !bar.classList.contains('no-season') || bar.scrollWidth > bar.clientWidth;
    return out;
  });
  // Unemployment sits beside the mood, amber once it costs mood.
  const workChip = await page.evaluate(() => {
    const app = window.colonia;
    const c = app.game.city;
    const keep = c.unemploymentRate;
    c.unemploymentRate = 0.3;
    app.ui.hud.update();
    const el = [...document.querySelectorAll('#hud-top .hud-stat')].find((e) => e.textContent.includes('⚒'));
    const out = { text: el && el.textContent, warn: !!el && el.classList.contains('warn'), title: el && el.title };
    c.unemploymentRate = keep;
    app.ui.hud.update();
    out.calm = !!el && !el.classList.contains('warn') === keep <= 0.1;
    return out;
  });
  check('the top bar shows unemployment, amber when it costs mood', /30%/.test(workChip.text || '') && workChip.warn && /lowers the city mood/.test(workChip.title || '') && workChip.calm, JSON.stringify(workChip));
  check('the season name gives way when the top bar is full',(fit.hidden || fit.over <= 0) && fit.shownAfter, JSON.stringify(fit));
  check('the top bar shows the season; winter only snows', winter.text.includes('Winter') && winter.title.includes('winter') && winter.kind === 'snow' && /not possible in winter/.test(winter.reply) && /snow/.test(winter.after), JSON.stringify(winter));
  // Snow settles: the ground, trees and roofs turn white (baked into the
  // sprites, so the new look is prepared, then swapped in whole).
  const snowy = await page.evaluate(() => {
    const app = window.colonia;
    const r = app.renderer;
    const month = app.game.time.month;
    app.game.time.month = 0;
    const home = [...app.game.buildings.values()].find((b) => b.def.kind === 'house');
    if (home) r.camera.centerOnTile(home.x, home.y); // some roofs in view
    app.ui.console.run('weather snow');
    const reply = app.ui.console.run('snow 3');
    let frames = 0;
    do { r.render(0, 0.016); frames++; } while ((r.palPrev !== null || r.snowPrev !== null) && frames < 60);
    const keys = [...r.sprites.current.keys()];
    const out = { reply, key: r.pal.key, frames, pending: r.stats.pending, snowSprites: keys.filter((k) => /~(p\d+)?n3$/.test(k)).length, buildings: keys.filter((k) => k.startsWith('b:') && k.endsWith('~n3')).length };
    app.game.time.month = month;
    return out;
  });
  // The new look is prepared a slice of time each frame, so a slower machine
  // needs more frames: 30 was enough until the new buildings' snowy art came
  // in (277 sprites; 37 frames at a 4x slower CPU, which failed CI). What
  // matters is that it swaps in whole, within about a second and a half.
  check('snow cover whitens ground, trees and roofs; the new look swaps in within 90 frames', /n3$/.test(snowy.key) && snowy.frames <= 90 && snowy.pending === 0 && snowy.snowSprites > 0 && snowy.buildings > 0, JSON.stringify(snowy));
  // Snow levels arriving a few frames apart (0 -> 1 -> 2, and a flip back):
  // every frame draws the ground in a single look, and the change completes.
  // (Only ground: a tree's sway frame never drawn in the old look has no
  // stand-in and is made in the new look at once.)
  const overlap = await page.evaluate(() => {
    const app = window.colonia;
    const r = app.renderer;
    const month = app.game.time.month;
    app.game.time.month = 0;
    app.ui.console.run('snow 0');
    for (let i = 0; i < 80 && (r.palPrev !== null || r.snowPrev !== null || i < 2); i++) r.render(0, 0.016);
    const get = r.sprites.get;
    let looks = {};
    r.sprites.get = function (key, spec, fb) {
      const spr = get.call(this, key, spec, fb);
      const m = /^g.*~(p\d+(?:n\d)?)$/.exec(key);
      if (m) {
        const old = fb !== null && fb !== undefined ? this.current.get(fb) || this.borrow(fb) : null;
        const look = old && spr === old ? /~(p\d+(?:n\d)?)$/.exec(fb)[1] : m[1];
        looks[look] = (looks[look] || 0) + 1;
      }
      return spr;
    };
    const frames = [];
    const frame = () => { looks = {}; r.render(0, 0.016); frames.push(looks); };
    try {
      app.ui.console.run('snow 1'); frame(); frame();
      app.ui.console.run('snow 2'); frame(); frame();
      app.ui.console.run('snow 1'); frame();
      for (let i = 0; i < 80 && (r.palPrev !== null || r.snowPrev !== null); i++) frame();
    } finally {
      r.sprites.get = get;
      app.game.time.month = month;
    }
    const mixed = frames.filter((f) => Object.keys(f).length > 1);
    return { mixed: mixed.length, example: mixed[0], frames: frames.length, done: r.palPrev === null && r.snowPrev === null, key: r.pal.key };
  });
  check('overlapping snow changes never mix two looks in one frame, and finish', overlap.mixed === 0 && overlap.done && /n1$/.test(overlap.key), JSON.stringify(overlap));
  // Reduced motion: no falling flakes, but the snow on the ground still shows.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const still = await page.evaluate(() => {
    const app = window.colonia;
    const r = app.renderer;
    const month = app.game.time.month;
    app.game.time.month = 0;
    app.applySettings();
    r.weather.flakes.length = 0;
    r.weather.force('snow', true);
    for (let i = 0; i < 5; i++) r.render(0, 0.016);
    const out = { motion: r.motionOn, flakes: r.weather.flakes.length, key: r.pal.key };
    app.game.time.month = month;
    return out;
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => window.colonia.applySettings());
  check('reduced motion: no falling snow, snow on the ground still shows', !still.motion && still.flakes === 0 && /n\d$/.test(still.key), JSON.stringify(still));
  // Weather off: the snow is gone, and so are its sprites.
  const bare = await page.evaluate(() => {
    const app = window.colonia;
    const r = app.renderer;
    const month = app.game.time.month;
    app.game.time.month = 0;
    app.settings.weather = false;
    app.applySettings();
    let frames = 0;
    do { r.render(0, 0.016); frames++; } while ((r.palPrev !== null || r.snowPrev !== null) && frames < 60);
    const left = [...r.sprites.byScale.values()].flatMap((m) => [...m.keys()]).filter((k) => /~(p\d+)?n\d$/.test(k)).length;
    const out = { key: r.pal.key, cover: r.weather.cover, left, frames };
    app.settings.weather = true;
    app.applySettings();
    app.game.time.month = month;
    return out;
  });
  check('weather off clears the snow and its sprites', bare.key === 'p0' && bare.cover === 0 && bare.left === 0, JSON.stringify(bare));
  await page.evaluate(() => window.colonia.renderer.weather.force('clear', true));
  await page.evaluate(() => window.colonia.ui.info.close()); // (Escape would close this first)
  await page.keyboard.press('Escape'); // pause menu
  await page.click('.modal button:has-text("Settings")');
  const worldToggles = await page.isVisible('text=Day and night') && await page.isVisible('text=Seasons') && await page.isVisible('text=Weather: clouds');
  await page.click('label:has-text("Day and night") input');
  const dayOff = await page.evaluate(() => window.colonia.renderer.dayNightOn === false && window.colonia.settings.dayNight === false);
  await page.click('label:has-text("Day and night") input');
  const dayOn = await page.evaluate(() => window.colonia.renderer.dayNightOn === true);
  check('settings switch day/night, seasons and weather', worldToggles && dayOff && dayOn, JSON.stringify({ worldToggles, dayOff, dayOn }));
  // Every settings checkbox sits on the first line of its own label, even
  // with a long help text below it (it used to wrap onto a line of its own).
  const boxes = await page.evaluate(() => [...document.querySelectorAll('.modal .check-row')].map((row) => {
    const box = row.querySelector('input').getBoundingClientRect();
    const text = row.querySelector('span').getBoundingClientRect();
    return { label: row.textContent.slice(0, 24), beside: box.right <= text.left + 1, sameLine: box.top >= text.top - 6 && box.top <= text.top + 10 };
  }));
  check('each settings checkbox sits beside its label', boxes.length >= 8 && boxes.every((b) => b.beside && b.sameLine), JSON.stringify(boxes.filter((b) => !b.beside || !b.sameLine)));
  const musicVol = await page.isVisible('text=Music volume');
  await page.click('label:has-text("Music (M)") input');
  const musicOff = await page.evaluate(() => window.colonia.music.enabled === false && !window.colonia.music.playing);
  await page.click('label:has-text("Music (M)") input');
  const musicOn = await page.evaluate(() => window.colonia.music.enabled === true);
  check('settings: music switch and volume', musicVol && musicOff && musicOn, JSON.stringify({ musicVol, musicOff, musicOn }));
  await page.click('.modal button:has-text("Done")'); // closes the menus: back to the game
  await page.keyboard.press('m');
  const mOff = await page.evaluate(() => window.colonia.settings.music === false && window.colonia.music.enabled === false);
  await page.keyboard.press('m');
  const mOn = await page.evaluate(() => window.colonia.settings.music === true);
  check('M key switches the music off and on', mOff && mOn);
  // The track library, live: a named track plays, and a change of mood from
  // day to night lets a day-only track finish its phrase and end (no cut).
  const lib = await page.evaluate(async () => {
    const m = window.colonia.music;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    m.force('day');
    m.play('prima-lux');
    await wait(500);
    const title = m.piece && m.piece.track ? m.piece.track.title : null;
    m.force('night');
    await wait(300);
    const still = m.piece && m.piece.track ? m.piece.track.title : null;
    const ending = m.piece ? m.piece.sections[m.piece.sections.length - 1].name : null;
    const left = m.piece ? m.piece.sections.length - m.piece.sectionIndex : -1;
    m.force('auto');
    return { title, still, ending, left, now: m.nowPlaying };
  });
  check('music: a named track plays; a change of mood lets it end its phrase instead of cutting it', lib.title === 'Prima Lux' && lib.still === 'Prima Lux' && lib.ending === 'outro' && lib.left >= 1 && lib.left <= 2, JSON.stringify(lib));
  // The synthesized music itself: every mood rendered offline, measured.
  const mc = await page.evaluate(() => window.colonia.musicSelfCheck(4));
  const mcOk = Object.values(mc).every((m) => !m.bad && m.peak > 0.02 && m.peak < 0.99 && m.rmsDb > -45);
  check('every music mood renders: audible, not clipping', mcOk, Object.entries(mc).map(([k, v]) => `${k} ${v.rmsDb}dB/${v.peak}`).join(', '));
  const savedNow = await page.evaluate(() => ({ b: window.colonia.game.buildings.size }));
  await page.keyboard.press('F5');
  // Leaving the page writes the autosave slot (localStorage).
  const autoBefore = await page.evaluate(() => localStorage.getItem('colonia.save.auto'));
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const autoAfter = await page.evaluate(() => { const s = localStorage.getItem('colonia.save.auto'); return s ? JSON.parse(s).meta : null; });
  check('autosave written when the page is hidden/closed', !!autoAfter && (!autoBefore || JSON.parse(autoBefore).meta.savedAt !== autoAfter.savedAt), autoAfter ? autoAfter.savedAt : 'none');
  await page.reload();
  await page.waitForSelector('.menu-card');
  check('Continue offered after a quick save', await page.isVisible('text=Continue'));
  await page.evaluate(() => window.colonia.quickLoad());
  await page.waitForFunction(() => window.colonia.game, null, { timeout: 15000 });
  const loaded = await page.evaluate(() => window.colonia.game.buildings.size);
  check('quick save survives a reload', loaded === savedNow.b, `${savedNow.b} vs ${loaded}`);
  const units = await page.evaluate(() => window.colonia.game.units.size);
  check('soldiers and raiders survive save + load', units > 0, `${units} units`);
  await page.keyboard.press('Escape');
  await page.click('text=Save game');
  check('save menu shows localStorage usage', await page.isVisible('text=Stored in this browser (localStorage)'));
  // Each saved slot exports on its own, without loading it: the file is the
  // slot's text exactly as stored, named after the slot, city and year.
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
    page.click('.modal .card:has-text("Quicksave") .slot-export'),
  ]);
  let slotFile = null;
  if (dl) {
    const p = await dl.path();
    const text = p ? fs.readFileSync(p, 'utf8') : '';
    const stored = await page.evaluate(() => localStorage.getItem('colonia.save.quick'));
    slotFile = { name: dl.suggestedFilename(), same: text === stored };
  }
  check('a save slot exports to a file of its own', !!slotFile && /^colonia-quick-.+-\d+(bc|ad)\.json$/.test(slotFile.name) && slotFile.same, JSON.stringify(slotFile));
  await page.keyboard.press('Escape');

  // 6. In-game confirm dialog: restart the map from the pause menu
  await page.keyboard.press('Escape');
  await page.click('text=Restart this map');
  const dialog = await page.isVisible('[role="alertdialog"]');
  check('restart asks for confirmation in-game', dialog);
  await page.click('[role="alertdialog"] .btn.danger');
  const fresh = await page.evaluate(() => window.colonia.game.buildings.size);
  check('confirming restart starts a fresh map', fresh === 0, `${fresh} buildings`);

  // 6b. A campaign mission on Insane: the briefing picks the difficulty,
  //     scales the starting funds, and the game remembers both.
  await page.evaluate(() => window.colonia.toMainMenu());
  await page.waitForSelector('.menu-card');
  await page.click('.menu-card button:has-text("Campaign")');
  await page.click('.scenario >> nth=0');
  await page.selectOption('.modal select.difficulty-select', 'insane');
  const fundsText = await page.textContent('.modal .row:has-text("Starting funds")');
  const shownFunds = Number((/Starting funds: ([\d,]+) Dn/.exec(fundsText) || [])[1]?.replace(/,/g, ''));
  await page.click('.modal button:has-text("Begin")');
  await page.waitForFunction(() => window.colonia.game && window.colonia.game.scenario.id === 'c1', null, { timeout: 15000 });
  {
    const m0 = await page.evaluate(() => ({ ...window.colonia.input.mouse, game: undefined }));
    const c0 = await camAt();
    await page.waitForTimeout(500);
    const c1 = await camAt();
    const d = Math.hypot(c1.x - c0.x, c1.y - c0.y);
    check('campaign start: the view holds still without input', d < 1 && !c1.moving, `moved ${Math.round(d)} world px, input.mouse at start ${JSON.stringify(m0)}`);
  }
  const camp = await page.evaluate(() => { const g = window.colonia.game; return { key: g.difficultyKey, treasury: Math.round(g.city.treasury), pref: window.colonia.settings.difficulty, winter: g.messages.some((m) => /nothing grows on the farms/.test(m.text)) }; });
  check('Insane mission start warns that nothing grows on the farms in winter', camp.winter);
  check('campaign briefing starts a mission on Insane with scaled funds', camp.key === 'insane' && camp.treasury === 2400 && shownFunds === 2400 && camp.pref === 'insane', JSON.stringify({ ...camp, shownFunds }));
  await page.keyboard.press('Escape');
  await page.click('.modal button:has-text("Mission briefing")');
  const inGame = await page.isVisible('.modal :text("Difficulty: Insane")') && await page.isVisible('.modal button:has-text("Close")') && !(await page.isVisible('.modal select.difficulty-select'));
  check('in-game briefing shows the difficulty being played', inGame);
  await page.click('.modal button:has-text("Close")');

  // 6c. Where autoplay is allowed the menu music starts with no gate at all.
  {
    const b2 = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    const p2 = await b2.newPage();
    await p2.goto(url);
    await p2.waitForFunction(() => window.colonia && window.colonia.music.barsPlayed > 0, null, { timeout: 8000 }).catch(() => {});
    const auto = await p2.evaluate(() => ({ playing: window.colonia.music.playing, mood: window.colonia.music.mood, gate: !!document.getElementById('title-gate') }));
    check('autoplay allowed: menu music starts at once, no gate', auto.playing && auto.mood === 'menu' && !auto.gate, JSON.stringify(auto));
    await b2.close();
  }

  // 6d. The fleet (sim/navy.js) on a coast: place a Naval Station and a
  //     Navalia with the mouse, then a working fleet (console `navy`), its
  //     squadron deployed by the station's Deploy button and a click on the
  //     water, a ship's panel, the Military advisor's stations, a raid by sea.
  {
    const np = await ctx.newPage();
    const nerrors = [];
    np.on('pageerror', (e) => nerrors.push(`pageerror: ${e.message}`));
    np.on('console', (m) => { if (m.type() === 'error' && !ignorable(m.text())) nerrors.push(m.text()); });
    await np.goto(`${url}?skipmenu=1&maptype=coast&map=small&seed=demo&mute=1&money=90000`);
    await np.waitForFunction(() => window.colonia && window.colonia.game, null, { timeout: 15000 });
    await np.evaluate(() => { const app = window.colonia; app.paused = true; app.ui.console.run('demo 2'); app.ui.console.run('days 60'); app.renderer.camera.zoomIndex = 2; });
    const nScreen = (tx, ty) => np.evaluate(([x, y]) => {
      const cam = window.colonia.renderer.camera;
      const wx = (x + 0.5 - (y + 0.5)) * 32;
      const wy = (x + 0.5 + (y + 0.5)) * 16;
      const r = window.colonia.canvas.getBoundingClientRect();
      return { x: r.left + ((wx - cam.x) * cam.scale) / cam.dpr, y: r.top + ((wy - cam.y) * cam.scale) / cam.dpr };
    }, [tx, ty]);
    // Two open 3x3 spots on the shore of the sea, apart from each other.
    const spots = await np.evaluate(() => {
      const g = window.colonia.game;
      const m = g.map;
      const out = [];
      for (let y = 2; y < m.h - 5 && out.length < 2; y++) {
        for (let x = 2; x < m.w - 5 && out.length < 2; x++) {
          if (m.navigableBeside(x, y, 3) < 0) continue;
          let ok = true;
          for (let dy = 0; dy < 3 && ok; dy++) for (let dx = 0; dx < 3; dx++) if (!m.isFree(x + dx, y + dy) || m.terrain[m.idx(x + dx, y + dy)] === 2) { ok = false; break; }
          if (ok && out.every((o) => Math.abs(o.x - x) > 4 || Math.abs(o.y - y) > 4)) out.push({ x, y });
        }
      }
      if (out[0]) window.colonia.renderer.camera.centerOnTile(out[0].x + 1, out[0].y + 1);
      return out;
    });
    check('fleet: open shore for a station and a navalia', spots.length === 2, JSON.stringify(spots));
    const placed = [];
    for (const [k, type] of [[0, 'naval_station'], [1, 'navalia']]) {
      if (!spots[k]) break;
      await np.evaluate(([s, t]) => { window.colonia.renderer.camera.centerOnTile(s.x + 1, s.y + 1); window.colonia.ui.selectTool(t); }, [spots[k], type]);
      await np.waitForTimeout(250);
      const p = await nScreen(spots[k].x + 1, spots[k].y + 1); // the cursor is the middle of a 3x3
      await np.mouse.move(p.x - 5, p.y);
      await np.mouse.move(p.x, p.y);
      await np.mouse.click(p.x, p.y);
      placed.push(await np.evaluate(([s, t]) => window.colonia.game.buildings.get(window.colonia.game.map.building[window.colonia.game.map.idx(s.x, s.y)])?.type === t, [spots[k], type]));
    }
    check('fleet: a click places a Naval Station and a Navalia on the shore', placed.length === 2 && placed.every(Boolean), JSON.stringify(placed));
    await np.mouse.click(10, 300, { button: 'right' });
    // A working fleet: stocked, staffed (military first), a few months on.
    const fleet = await np.evaluate(() => {
      const app = window.colonia;
      const out = app.ui.console.run('navy');
      app.game.city.laborPriority = ['military'];
      app.ui.console.run('days 140');
      const g = app.game;
      const st = [...g.buildings.values()].filter((b) => b.def.kind === 'station').find((b) => [...g.units.values()].some((u) => u.station === b.id));
      return { out, st: st ? { id: st.id, x: st.x, y: st.y } : null, ships: [...g.units.values()].filter((u) => u.type === 'liburnian').length };
    });
    check('fleet: the navalia builds liburnians that berth at a station', fleet.ships >= 1 && !!fleet.st, JSON.stringify(fleet));
    if (fleet.st) {
      await np.evaluate((s) => { window.colonia.renderer.camera.centerOnTile(s.x + 1, s.y + 1); window.colonia.ui.info.showBuilding(s.id); }, fleet.st);
      await np.waitForTimeout(250);
      await np.click('#info-panel button:has-text("Deploy")');
      const water = await np.evaluate((s) => {
        const m = window.colonia.game.map;
        const st = window.colonia.game.buildings.get(s.id);
        const body = m.navBody[st.berth];
        for (let r = 5; r < 12; r++) for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r], [r, r], [-r, -r]]) {
          const x = s.x + 1 + dx; const y = s.y + 1 + dy;
          if (m.inBounds(x, y) && m.navBody[m.idx(x, y)] === body) return { x, y };
        }
        return null;
      }, fleet.st);
      if (water) {
        const p = await nScreen(water.x, water.y);
        await np.mouse.click(p.x, p.y);
      }
      const rally = await np.evaluate((id) => window.colonia.game.buildings.get(id).rally, fleet.st.id);
      check('fleet: Deploy and a click on the water send the squadron there', !!water && !!rally && Math.abs(Math.floor(rally.x) - water.x) <= 2 && Math.abs(Math.floor(rally.y) - water.y) <= 2, JSON.stringify({ water, rally }));
      await np.evaluate(() => { window.colonia.paused = false; window.colonia.ui.console.run('days 8'); window.colonia.paused = true; });
      // Click a liburnian: its panel.
      await np.evaluate(() => { const u = [...window.colonia.game.units.values()].find((v) => v.type === 'liburnian'); window.colonia.renderer.camera.centerOnTile(Math.floor(u.x), Math.floor(u.y)); });
      await np.waitForTimeout(400);
      const shipAt = await np.evaluate(() => {
        const r = window.colonia.renderer;
        const s = r.shipSpots.find((o) => window.colonia.game.units.get(o.id)?.type === 'liburnian');
        if (!s) return null;
        const cam = r.camera;
        const rect = window.colonia.canvas.getBoundingClientRect();
        return { x: rect.left + ((s.wx - cam.x) * cam.scale) / cam.dpr, y: rect.top + ((s.wy - 12 - cam.y) * cam.scale) / cam.dpr };
      });
      if (shipAt) await np.mouse.click(shipAt.x, shipAt.y);
      await np.waitForTimeout(200);
      const panel = await np.evaluate(() => ({ kind: window.colonia.ui.info.target?.kind, text: document.getElementById('info-panel').textContent }));
      check('fleet: clicking a liburnian shows its panel', panel.kind === 'unit' && /Liburnian/.test(panel.text) && /Hull/.test(panel.text), JSON.stringify({ kind: panel.kind }));
      if (shots) await np.screenshot({ path: path.join(shots, 'smoke-fleet.png') });
    }
    await np.keyboard.press('F2');
    await np.click('.tab:has-text("Military")');
    check('fleet: the Military advisor shows the fleet and its stations', await np.isVisible('.modal h4:has-text("Fleet")') && await np.isVisible('.modal th:has-text("Station")'));
    await np.keyboard.press('Escape');
    const raid = await np.evaluate(() => {
      const app = window.colonia;
      const said = app.ui.console.run('searaid 10');
      app.ui.console.run('days 3');
      const g = app.game;
      return { said, sea: !!g.military.active?.sea, ships: [...g.units.values()].filter((u) => u.type === 'raider_ship').length };
    });
    check('fleet: a raid by sea sails in on raider ships', raid.sea && raid.ships >= 1, JSON.stringify(raid));
    check('fleet: no errors on the coast', nerrors.length === 0, nerrors.join(' | '));
    await np.close();
  }

  // 7. Phone layout: no horizontal scroll, sidebar becomes a bottom sheet
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const perrors = [];
  phone.on('pageerror', (e) => perrors.push(e.message));
  await phone.goto(`${url}?skipmenu=1&map=small&seed=phone`); // a map where the demo city gets a warehouse
  await phone.waitForFunction(() => window.colonia && window.colonia.game, null, { timeout: 15000 });
  const layout = await phone.evaluate(() => {
    const sb = document.getElementById('sidebar').getBoundingClientRect();
    return { scrollW: document.documentElement.scrollWidth, w: window.innerWidth, sbTop: sb.top, sbH: sb.height };
  });
  check('phone: no horizontal scroll', layout.scrollW <= layout.w, `${layout.scrollW} <= ${layout.w}`);
  check('phone: build menu docked at the bottom', layout.sbTop > 400, `top ${Math.round(layout.sbTop)}`);
  if (shots) await phone.screenshot({ path: path.join(shots, 'smoke-phone.png') });
  // The warehouse panel fits a phone: no sideways scroll inside it, and a tap cycles an order.
  const phoneWh = await phone.evaluate(() => {
    const app = window.colonia;
    app.ui.console.run('demo 2');
    const wh = [...app.game.buildings.values()].find((b) => b.type === 'warehouse');
    if (!wh) return null;
    app.ui.info.showBuilding(wh.id);
    const panel = document.getElementById('info-panel');
    return { id: wh.id, scrollW: panel.scrollWidth, w: panel.clientWidth };
  });
  if (phoneWh) {
    await phone.tap('#info-panel .order-btn[data-good="oil"]');
    const oil = await phone.evaluate((id) => window.colonia.game.buildings.get(id).orders.oil, phoneWh.id);
    if (shots) await phone.screenshot({ path: path.join(shots, 'smoke-phone-warehouse.png') });
    check('phone: the warehouse panel fits, and a tap cycles an order', phoneWh.scrollW <= phoneWh.w && oil === 'refuse', JSON.stringify({ ...phoneWh, oil }));
  } else {
    check('phone: demo city has a warehouse', false);
  }
  // The Empire map on a phone: the compass opens it, the map fits the width
  // with the panel below it, and nothing scrolls sideways.
  await phone.tap('#hud-empire');
  await phone.waitForSelector('canvas.empire-full', { timeout: 3000 }).catch(() => {});
  await phone.waitForTimeout(200);
  const pe = await phone.evaluate(() => {
    const c = document.querySelector('canvas.empire-full');
    const side = document.querySelector('.empire-side');
    if (!c || !side) return null;
    const cr = c.getBoundingClientRect();
    return { w: Math.round(cr.width), right: Math.round(cr.right), vw: window.innerWidth, sideTop: Math.round(side.getBoundingClientRect().top), mapBottom: Math.round(cr.bottom), scrollW: document.documentElement.scrollWidth };
  });
  check('phone: the empire map opens from the top bar and fits the screen', !!pe && pe.w > 250 && pe.right <= pe.vw && pe.scrollW <= pe.vw && pe.sideTop >= pe.mapBottom, JSON.stringify(pe));
  if (shots) await phone.screenshot({ path: path.join(shots, 'smoke-phone-empire.png') });
  // The Health, Education and Entertainment advisors on a phone: each opens
  // with its table, nothing scrolls sideways, and the fourteen tabs leave the
  // page most of the window.
  await phone.keyboard.press('Escape');
  // In a wide font as well (Verdana, about as wide as Linux's defaults):
  // the Venues table fit here and ran 15 px over on the CI runner.
  const wideFont = await phone.addStyleTag({ content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important; }' });
  const phoneTabs = [];
  for (const tab of ['health', 'education', 'entertainment']) {
    phoneTabs.push(await phone.evaluate((t) => {
      window.colonia.ui.openAdvisors(t);
      const body = document.querySelector('.modal-body');
      const tabs = document.querySelector('.modal .tabs');
      return { tab: t, rows: body.querySelectorAll('tr[data-kind]').length, scrollW: body.scrollWidth, w: body.clientWidth, page: document.documentElement.scrollWidth, tabsH: Math.round(tabs.getBoundingClientRect().height) };
    }, tab));
    if (shots) await phone.screenshot({ path: path.join(shots, `smoke-phone-${tab}.png`) });
    await phone.keyboard.press('Escape');
  }
  // Every build menu list, and the inspect panel of the buildings with the
  // longest names, in the same wide font: the Latin name, the English under
  // it and the cost stay inside the list, and a title wraps rather than
  // pushing the panel sideways.
  const phoneNames = await phone.evaluate(() => {
    const app = window.colonia;
    const sb = app.ui.sidebar;
    const list = document.getElementById('build-list');
    const over = [];
    const was = sb.category;
    for (const cat of [...document.querySelectorAll('.cat-btn')].map((b) => b.title)) {
      document.querySelector(`.cat-btn[title="${cat}"]`).click(); // (a click renders the buttons anew)
      list.classList.remove('collapsed');
      const right = list.getBoundingClientRect().right;
      for (const item of list.querySelectorAll('.build-item')) {
        const r = item.getBoundingClientRect();
        const cost = item.querySelector('.cost').getBoundingClientRect();
        if (r.right > right + 0.5 || cost.right > r.right + 0.5 || item.scrollWidth > item.clientWidth) over.push(`${cat}:${item.dataset.key}`);
      }
    }
    sb.category = was;
    sb.renderCategories();
    sb.renderList();
    // The longest titles, in a building's panel (the demo city's warehouse,
    // its title row swapped for each): inside the panel, and on two lines at
    // most, the English one wrapping under the Latin as a whole.
    const panel = document.getElementById('info-panel');
    const heads = [];
    const wh = [...app.game.buildings.values()].find((x) => x.type === 'warehouse');
    if (wh) {
      app.ui.info.showBuilding(wh.id);
      const title = (name, en) => {
        panel.querySelector('.panel-head').replaceWith(app.ui.info.head(name, '3×3', en));
        return panel.querySelector('h3');
      };
      const oneLine = title('Forum', 'Forum').getBoundingClientRect().height;
      for (const [name, en] of [['Templum Mercurii', 'Grand Temple of Mercury'], ['Officina Sagittaria', 'Fletcher'], ['Taberna Vestiaria', 'Clothing Maker'], ['Ludus Gladiatorius', 'Gladiator School'], ['Praetorium Maius', "Governor's Villa"], ['Collegium Fabrum', "Engineer's Post"], ['Castellum Aquae', 'Reservoir']]) {
        const h3 = title(name, en);
        const r = h3.getBoundingClientRect();
        heads.push({ name, lines: Math.round(r.height / oneLine), fits: panel.scrollWidth <= panel.clientWidth && r.right <= panel.getBoundingClientRect().right });
      }
      app.ui.info.close();
    }
    return { over, items: list.querySelectorAll('.build-item').length, heads };
  });
  await wideFont.evaluate((el) => el.remove());
  check('phone: long Latin names fit every build menu list, and in two lines at most the inspect panel\'s title', phoneNames.over.length === 0 && phoneNames.heads.length === 7 && phoneNames.heads.every((x) => x.fits && x.lines <= 2), JSON.stringify(phoneNames));
  check('phone: the Health, Education and Entertainment advisors open and fit the width', phoneTabs.every((t) => t.rows >= 3 && t.scrollW <= t.w && t.page <= 390 && t.tabsH < 120), JSON.stringify(phoneTabs));
  check('phone: no page errors', perrors.length === 0, perrors.join(' | '));
  // 7b. Phone main menu: ONE tap on the title gate starts the music. Nothing
  //     may query the page before the tap: Playwright's evaluate() counts as a
  //     user gesture and would hide a missing touch unlock.
  const tapPage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await tapPage.goto(url);
  await tapPage.waitForTimeout(2500);
  await tapPage.touchscreen.tap(195, 422);
  await tapPage.waitForTimeout(800);
  const tapped = await tapPage.evaluate(() => ({ ctx: window.colonia.sfx.ctx && window.colonia.sfx.ctx.state, playing: window.colonia.music.playing, mood: window.colonia.music.mood, gate: !!document.querySelector('#title-gate:not(.leaving)'), modal: !!document.querySelector('.modal') }));
  check('phone: one tap on the title gate starts the menu music', tapped.playing && tapped.mood === 'menu' && !tapped.gate && !tapped.modal, JSON.stringify(tapped));
  await tapPage.close();

  check('no page errors overall', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

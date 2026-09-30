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
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
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
  const info = await page.evaluate(() => {
    const app = window.colonia;
    const g = app.game;
    app.paused = true;
    // Find the imperial road tile nearest the map center, then free land beside it.
    let best = null;
    for (let i = 0; i < g.map.size; i++) {
      if (!g.map.road[i]) continue;
      const x = g.map.xOf(i);
      const y = g.map.yOf(i);
      const d = Math.hypot(x - g.map.w / 2, y - g.map.h / 2);
      if (!best || d < best.d) best = { x, y, d };
    }
    app.renderer.camera.centerOnTile(best.x, best.y);
    return { x: best.x, y: best.y, money: g.city.treasury, buildings: g.buildings.size };
  });
  const toScreen = (tx, ty) => page.evaluate(([x, y]) => {
    const cam = window.colonia.renderer.camera;
    const wx = (x + 0.5 - (y + 0.5)) * 32;
    const wy = (x + 0.5 + (y + 0.5)) * 16;
    const r = window.colonia.canvas.getBoundingClientRect();
    return { x: r.left + ((wx - cam.x) * cam.scale) / cam.dpr, y: r.top + ((wy - cam.y) * cam.scale) / cam.dpr };
  }, [tx, ty]);
  // Find a free spot 3..8 tiles from the road for a little street.
  const spot = await page.evaluate(({ x, y }) => {
    const m = window.colonia.game.map;
    for (let r = 2; r < 12; r++) {
      for (const [dx, dy] of [[0, r], [r, 0], [0, -r], [-r, 0]]) {
        let ok = true;
        for (let k = 0; k < 6 && ok; k++) for (let j = 0; j < 3; j++) if (!m.isFree(x + dx + k, y + dy + j)) { ok = false; break; }
        if (ok) return { x: x + dx, y: y + dy };
      }
    }
    return null;
  }, info);
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

  // 4. Menus and advisors via keyboard
  await page.keyboard.press('F2');
  check('F2 opens advisors', await page.isVisible('text=Advisors'));
  for (const tab of ['Labor', 'Population', 'Production', 'Finance', 'Trade', 'Military', 'Religion', 'Ratings', 'Imperial']) {
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
    await page.click('.build-item:has-text("Roadblock")');
    await page.waitForTimeout(100);
    const rp = await toScreen(rbSpot.x, rbSpot.y);
    await page.mouse.move(rp.x, rp.y);
    await page.waitForTimeout(100);
    await page.mouse.click(rp.x, rp.y);
    const placed = await page.evaluate(({ x, y }) => window.colonia.game.map.roadblock[window.colonia.game.map.idx(x, y)], rbSpot);
    check('the Roadblock tool places a roadblock on a road', placed === 128, `layer ${placed}`);
    await page.mouse.click(rp.x, rp.y, { button: 'right' });
    await page.mouse.click(rp.x, rp.y);
    const rbPanel = await page.isVisible('#info-panel h3:has-text("Roadblock")');
    await page.click('#info-panel label:has-text("Priests") input');
    const allowed = await page.evaluate(({ x, y }) => window.colonia.game.map.roadblock[window.colonia.game.map.idx(x, y)], rbSpot);
    check('clicking a roadblock shows who it lets through; ticking a group lets it pass', rbPanel && allowed === (128 | 2), `panel ${rbPanel}, layer ${allowed}`);
    // A walker in view, clicked on its body.
    await page.evaluate(() => { window.colonia.ui.info.close(); window.colonia.game.runDays(2); });
    await page.waitForTimeout(200);
    const target = await page.evaluate(() => {
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
    check('walkers are on screen to click', !!target);
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
    }
  }

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
  await page.selectOption('.hud-select', 'none');
  const legendGone = await page.isHidden('#overlay-legend');
  await page.keyboard.press('F2');
  await page.click('.tab:has-text("Production")');
  const prod = await page.evaluate(() => ({ rows: document.querySelectorAll('.modal table.tbl tr').length, text: document.querySelector('.modal-body')?.textContent || '' }));
  await page.click('.tab:has-text("Overview")');
  const charts = await page.evaluate(() => document.querySelectorAll('.modal canvas.trend').length);
  check('Production advisor lists goods and bottlenecks; the Overview draws three trend charts', legendGone && prod.rows > 1 && /Bottlenecks/.test(prod.text) && /Wheat/.test(prod.text) && charts === 3, JSON.stringify({ legendGone, rows: prod.rows, charts }));
  await page.keyboard.press('Escape');

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
    return { out, forts: forts.length, soldiers, fortId: fort ? fort.id : 0, fx: fort ? fort.x : 0, fy: fort ? fort.y : 0 };
  });
  check('garrison: forts built and soldiers recruited', gar.forts >= 1 && gar.soldiers >= 1, `${gar.forts} forts, ${gar.soldiers} soldiers`);
  if (gar.fortId) {
    await page.evaluate((id) => { window.colonia.renderer.camera.centerOnTile(window.colonia.game.buildings.get(id).x, window.colonia.game.buildings.get(id).y); window.colonia.ui.info.showBuilding(id); }, gar.fortId);
    await page.click('#info-panel button:has-text("Deploy")');
    check('deploy button enters deploy mode', await page.evaluate(() => window.colonia.deploying > 0));
    const target = await page.evaluate(([fx, fy]) => {
      const m = window.colonia.game.map;
      for (let r = 5; r < 14; r++) for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r]]) if (m.isFree(fx + dx, fy + dy)) return { x: fx + dx, y: fy + dy };
      return null;
    }, [gar.fx, gar.fy]);
    if (target) {
      const p = await toScreen(target.x, target.y);
      await page.mouse.click(p.x, p.y);
      const rally = await page.evaluate((id) => window.colonia.game.buildings.get(id).rally, gar.fortId);
      check('clicking the map deploys the soldiers there', !!rally && Math.floor(rally.x) === target.x && Math.floor(rally.y) === target.y, JSON.stringify(rally));
    }
  }
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
  check('the season name gives way when the top bar is full', (fit.hidden || fit.over <= 0) && fit.shownAfter, JSON.stringify(fit));
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
  check('snow cover whitens ground, trees and roofs; the new look swaps in within 30 frames', /n3$/.test(snowy.key) && snowy.frames <= 30 && snowy.pending === 0 && snowy.snowSprites > 0 && snowy.buildings > 0, JSON.stringify(snowy));
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

  // 7. Phone layout: no horizontal scroll, sidebar becomes a bottom sheet
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const perrors = [];
  phone.on('pageerror', (e) => perrors.push(e.message));
  await phone.goto(`${url}?skipmenu=1&map=small`);
  await phone.waitForFunction(() => window.colonia && window.colonia.game, null, { timeout: 15000 });
  const layout = await phone.evaluate(() => {
    const sb = document.getElementById('sidebar').getBoundingClientRect();
    return { scrollW: document.documentElement.scrollWidth, w: window.innerWidth, sbTop: sb.top, sbH: sb.height };
  });
  check('phone: no horizontal scroll', layout.scrollW <= layout.w, `${layout.scrollW} <= ${layout.w}`);
  check('phone: build menu docked at the bottom', layout.sbTop > 400, `top ${Math.round(layout.sbTop)}`);
  if (shots) await phone.screenshot({ path: path.join(shots, 'smoke-phone.png') });
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

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
  if (shots) await page.screenshot({ path: path.join(shots, 'smoke-menu.png') });

  // 2. Start a sandbox from the menu UI
  await page.click('text=Sandbox');
  await page.click('text=Found the city');
  await page.waitForFunction(() => window.colonia && window.colonia.game, null, { timeout: 15000 });
  check('sandbox starts from the menu', true);
  // The clicks above count as the player's first interaction: music may start.
  await page.waitForTimeout(800);
  const music = await page.evaluate(() => { const m = window.colonia.music; return { playing: m.playing, mood: m.mood, bars: m.barsPlayed, now: m.nowPlaying }; });
  check('music starts after the first click, in the day mood', music.playing && music.mood === 'day' && music.bars > 0, JSON.stringify(music));

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
    check('road drag builds a road', roadOk);
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
  for (const tab of ['Labor', 'Finance', 'Trade', 'Military', 'Religion', 'Ratings', 'Imperial']) {
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
  }

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
  check('console can change the weather', await page.evaluate(() => window.colonia.renderer.weather.kind === 'rain'));
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

  check('no page errors overall', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

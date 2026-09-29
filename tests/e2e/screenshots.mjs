#!/usr/bin/env node
/**
 * screenshots.mjs - render the demo city in headless Chromium and save PNGs.
 * ----------------------------------------------------------------------------
 * Usage:  node tests/e2e/screenshots.mjs [--out dir] [--port 8123] [--help]
 * Needs Playwright (npm i -D playwright, or a global install).
 * Output: <out>/render-*.png plus a JSON summary on stdout.
 * ----------------------------------------------------------------------------
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const tries = ['playwright', '/opt/node22/lib/node_modules/playwright'];
  for (const t of tries) {
    try { return require(t); } catch { /* try next */ }
  }
  console.error('Playwright not found. Install it with: npm i -D playwright');
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node tests/e2e/screenshots.mjs [--out dir] [--port 8123] [--shots name:query,...]');
  process.exit(0);
}
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(ROOT, 'tests/e2e/out');
const port = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 8123;
fs.mkdirSync(outDir, { recursive: true });

const shots = [
  ['city', 'scenario=c1&months=8&zoom=2'],
  ['closeup', 'scenario=c1&months=8&zoom=4&w=1000&h=700'],
  ['far', 'scenario=c1&months=8&zoom=0'],
  ['overlay-water', 'scenario=c1&months=8&zoom=2&overlay=water'],
  ['overlay-des', 'scenario=c1&months=8&zoom=2&overlay=desirability'],
  ['coast', 'scenario=sandbox&maptype=coast&seed=beach&months=4&zoom=1'],
];

const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.mjs'), '--port', String(port)], { stdio: 'pipe' });
await new Promise((resolve) => server.stdout.once('data', resolve));

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const results = {};
try {
  for (const [name, query] of shots) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://127.0.0.1:${port}/tests/e2e/render.html?${query}`);
    await page.waitForFunction(() => window.__done === true, null, { timeout: 60000 });
    const result = await page.evaluate(() => window.__result);
    await page.screenshot({ path: path.join(outDir, `render-${name}.png`) });
    results[name] = { ...result, errors };
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
console.log(JSON.stringify(results, null, 2));

#!/usr/bin/env node
/**
 * build.mjs - bundle the whole game into ONE self-contained HTML file.
 * ----------------------------------------------------------------------------
 * Output: dist/colonia.html (JS + CSS inlined). It runs by double-clicking,
 * from file://, from any static host, or as a claude.ai artifact.
 *
 * Usage:
 *   node scripts/build.mjs [--out dist/colonia.html] [--no-minify] [--help]
 *   npm run build
 *
 * Requires esbuild (npm install). Everything else is plain Node.
 * Made with ❤️ from your friendly hacker - er2oneousbit
 * ----------------------------------------------------------------------------
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `
Colonia single-file build

  node scripts/build.mjs [options]

Options:
  --out <file>    Output HTML file (default dist/colonia.html)
  --no-minify     Keep the bundle readable (bigger file, easier debugging)
  --artifact      Emit a page FRAGMENT for claude.ai artifacts (no html/head/body
                  tags; the host wraps it). Default out: dist/colonia.artifact.html
  --help          Show this help

Made with ❤️ from your friendly hacker - er2oneousbit
`;

function parseArgs(argv) {
  const o = { out: null, minify: true, artifact: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { console.log(HELP); process.exit(0); }
    else if (a === '--out') o.out = path.resolve(argv[++i]);
    else if (a === '--no-minify') o.minify = false;
    else if (a === '--artifact') o.artifact = true;
    else { console.error(`Unknown option: ${a}\n${HELP}`); process.exit(2); }
  }
  if (!o.out) o.out = path.join(ROOT, 'dist', o.artifact ? 'colonia.artifact.html' : 'colonia.html');
  return o;
}

async function loadEsbuild() {
  try {
    return await import('esbuild');
  } catch {
    console.error('esbuild is not installed. Run "npm install" in the project folder first.');
    process.exit(1);
  }
}

const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%238e1b1b'/%3E%3Cpath d='M10 26 32 12 54 26Z' fill='%23d6ab3c'/%3E%3Crect x='14' y='28' width='6' height='20' fill='%23f3ecdc'/%3E%3Crect x='29' y='28' width='6' height='20' fill='%23f3ecdc'/%3E%3Crect x='44' y='28' width='6' height='20' fill='%23f3ecdc'/%3E%3Crect x='10' y='50' width='44' height='5' fill='%23d6ab3c'/%3E%3C/svg%3E";

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const esbuild = await loadEsbuild();
  const t0 = Date.now();

  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'main.js')],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    minify: opts.minify,
    legalComments: 'none',
    write: false,
    logLevel: 'warning',
  });
  let js = result.outputFiles[0].text;
  // Never let "</script>" inside the bundle close the inline script tag.
  js = js.replace(/<\/script/gi, '<\\/script');

  const cssPath = path.join(ROOT, 'src', 'ui', 'styles.css');
  let css = fs.readFileSync(cssPath, 'utf8');
  if (opts.minify) css = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n\s*\n/g, '\n');

  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&display=swap" rel="stylesheet">`;
  // Artifact hosts wrap the page in their own document skeleton.
  const fragment = `<title>Colonia</title>
<!-- Colonia v${version}: an original browser city builder. Made with ❤️ from your friendly hacker - er2oneousbit -->
${fonts}
<style>
${css}
</style>
<div id="app"></div>
<noscript><p style="color:#fff;padding:20px">Colonia needs JavaScript enabled.</p></noscript>
<script>
${js}
</script>
`;
  const html = opts.artifact ? fragment : `<!doctype html>
<!-- Colonia v${version}: an original browser city builder. Built ${new Date().toISOString()}.
     Made with ❤️ from your friendly hacker - er2oneousbit -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>Colonia</title>
<meta name="description" content="Colonia: an original browser city builder inspired by classic Roman city-building games.">
<link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&display=swap" rel="stylesheet">
<style>
${css}
</style>
</head>
<body>
<div id="app"></div>
<noscript><p style="color:#fff;padding:20px">Colonia needs JavaScript enabled.</p></noscript>
<script>
${js}
</script>
</body>
</html>
`;
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, html);
  const kb = (fs.statSync(opts.out).size / 1024).toFixed(1);
  console.log(`Built ${path.relative(ROOT, opts.out)} (${kb} KB) in ${Date.now() - t0} ms`);
}

main().catch((err) => {
  console.error('Build failed:', err && err.message ? err.message : err);
  process.exit(1);
});

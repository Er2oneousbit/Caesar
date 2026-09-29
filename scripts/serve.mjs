#!/usr/bin/env node
/**
 * serve.mjs - tiny zero-dependency static file server for development.
 * ----------------------------------------------------------------------------
 * Why: browsers refuse to load ES modules from file:// URLs, so the dev build
 * (index.html + src/*.js) must be served over http. The single-file build in
 * dist/ does NOT need this.
 *
 * Usage:
 *   node scripts/serve.mjs [--port 8080] [--host 127.0.0.1] [--open] [--help]
 *   npm run dev
 *
 * Made with ❤️ from your friendly hacker - er2oneousbit
 * ----------------------------------------------------------------------------
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `
Colonia dev server

  node scripts/serve.mjs [options]

Options:
  --port <n>     Port to listen on (default 8080, or $PORT)
  --host <addr>  Interface to bind (default 127.0.0.1; use 0.0.0.0 for LAN)
  --open         Open the game in your default browser
  --help         Show this help

Then browse to http://localhost:<port>/  (add ?debug=1 for the debug HUD)

Made with ❤️ from your friendly hacker - er2oneousbit
`;

function parseArgs(argv) {
  const opts = { port: Number(process.env.PORT) || 8080, host: '127.0.0.1', open: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--open') opts.open = true;
    else if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--host') opts.host = argv[++i];
    else {
      console.error(`Unknown option: ${a}\n${HELP}`);
      process.exit(2);
    }
  }
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
    console.error(`Invalid --port value. ${HELP}`);
    process.exit(2);
  }
  return opts;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8',
};

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, (err) => { if (err) console.warn(`Could not open a browser automatically: ${err.message}`); });
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}

const server = http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.normalize(path.join(ROOT, urlPath));
    // Never serve anything outside the project folder.
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end(`Not found: ${urlPath}`);
      return;
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.error('[serve] error:', err);
    res.writeHead(500).end('Server error');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${opts.port} is already in use. Try --port ${opts.port + 1}`);
  else console.error('[serve] failed:', err.message);
  process.exit(1);
});

server.listen(opts.port, opts.host, () => {
  const url = `http://${opts.host === '0.0.0.0' ? 'localhost' : opts.host}:${opts.port}/`;
  console.log(`Colonia dev server running at ${url}  (Ctrl+C to stop)`);
  if (opts.open) openBrowser(url);
});

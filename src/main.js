/**
 * main.js - Colonia entry point
 * ----------------------------------------------------------------------------
 * Colonia: an original browser city builder in the spirit of the classic
 * Roman city-building games. Pure JavaScript + Canvas 2D, no dependencies.
 *
 * Boot sequence:
 *   1. parse URL flags (?debug=1 etc., see core/debug.js)
 *   2. install global error handlers (crash screen with a copyable report)
 *   3. create the App (canvas, renderer, UI, input, audio) and boot it
 *
 * Credits: developed with Claude (Anthropic) using Claude Code.
 * Made with ❤️ from your friendly hacker - er2oneousbit
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from './config.js';
import { parseFlags, log } from './core/debug.js';
import { App } from './app.js';
import { serializeGame } from './core/save.js';

let app = null;
let crashShown = false;

/** Full-screen crash report. Offers copy, emergency save, continue, reload. */
function showCrash(err) {
  if (crashShown) return;
  crashShown = true;
  const msg = err && err.message ? err.message : String(err);
  const stack = err && err.stack ? err.stack : '';
  let gameInfo = 'no game running';
  if (app && app.game) {
    const g = app.game;
    gameInfo = `${g.scenario.id} seed=${g.seed} date=${g.time.label()} pop=${g.city.population} buildings=${g.buildings.size} walkers=${g.walkers.size}`;
  }
  const report = [
    `${CONFIG.GAME_TITLE} v${CONFIG.VERSION} crash report`,
    `time: ${new Date().toISOString()}`,
    `browser: ${navigator.userAgent}`,
    `url: ${location.href}`,
    `game: ${gameInfo}`,
    '',
    `error: ${msg}`,
    stack,
    '',
    '--- recent log ---',
    log.dump(),
  ].join('\n');

  const el = document.createElement('div');
  el.id = 'crash';
  el.innerHTML = `
    <div class="box">
      <h2 style="margin-top:0">Something broke in the city</h2>
      <p>The game hit an unexpected error. You can try to keep playing, grab an emergency save, or copy the report for a bug ticket.</p>
      <pre></pre>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" data-a="copy">Copy report</button>
        <button class="btn" data-a="save">Download emergency save</button>
        <button class="btn" data-a="copysave">Copy save data</button>
        <button class="btn" data-a="continue">Try to continue</button>
        <button class="btn primary" data-a="reload">Reload</button>
      </div>
    </div>`;
  el.querySelector('pre').textContent = report;
  el.addEventListener('click', async (e) => {
    const a = e.target && e.target.dataset ? e.target.dataset.a : null;
    if (a === 'copy') {
      try { await navigator.clipboard.writeText(report); e.target.textContent = 'Copied!'; } catch { e.target.textContent = 'Copy failed: select the text manually'; }
    } else if (a === 'save') {
      try {
        const blob = new Blob([JSON.stringify(serializeGame(app.game))], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'colonia-emergency-save.json';
        link.click();
      } catch (saveErr) {
        e.target.textContent = `Save failed: ${saveErr.message}`;
      }
    } else if (a === 'copysave') {
      try {
        await navigator.clipboard.writeText(JSON.stringify(serializeGame(app.game)));
        e.target.textContent = 'Save copied!';
      } catch (copyErr) {
        e.target.textContent = `Copy failed: ${copyErr.message || 'clipboard blocked'}`;
      }
    } else if (a === 'continue') {
      el.remove();
      crashShown = false;
      if (app) { app.crashed = false; app.errorCount = 0; }
    } else if (a === 'reload') {
      location.reload();
    }
  });
  document.body.appendChild(el);
}

function boot() {
  const flags = parseFlags();
  log.setLevel(flags.log);
  log.info(`${CONFIG.GAME_TITLE} v${CONFIG.VERSION} starting`, flags);

  window.__coloniaCrash = showCrash;
  window.addEventListener('error', (e) => {
    const err = e.error || new Error(e.message || 'Unknown error');
    if (/ResizeObserver loop/.test(String(e.message))) return; // harmless browser noise
    log.error('Uncaught error:', err);
    if (!app) showCrash(err);
    else if (app.ui) app.ui.toastError(`Something went wrong: ${err.message} (details in the console)`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    log.error('Unhandled promise rejection:', e.reason);
    if (app && app.ui) app.ui.toastError(`Something went wrong: ${e.reason && e.reason.message ? e.reason.message : e.reason}`);
  });

  const root = document.getElementById('app');
  if (!root) throw new Error('Missing #app element in the page');

  // When hosted as a claude.ai artifact, the viewer can hot-swap a new
  // version of the page. Hand it a snapshot of the running city so players
  // keep their game across republishes. Harmless everywhere else.
  const hot = typeof window !== 'undefined' && window.claude ? window.claude.hot : null;
  try {
    if (hot && typeof hot.snapshot === 'function') {
      hot.snapshot(() => (app && app.game ? { save: serializeGame(app.game, { camera: app.renderer.camera.serialize() }) } : {}));
    }
  } catch (err) {
    log.warn('Hot snapshot unavailable:', err);
  }

  const start = (data) => {
    try {
      app = new App(root, flags);
      window.colonia = app;
      if (data && data.save) {
        try {
          app.loadData(data.save);
          return;
        } catch (err) {
          log.warn('Could not restore the previous session, starting fresh:', err);
        }
      }
      app.boot();
    } catch (err) {
      log.error('Boot failed:', err);
      showCrash(err);
    }
  };
  if (hot && typeof hot.ready === 'function') hot.ready(start);
  else start((hot && hot.data) || {});
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

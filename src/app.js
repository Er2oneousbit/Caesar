/**
 * app.js
 * ----------------------------------------------------------------------------
 * The browser application: owns the canvas, renderer, UI, input, audio and
 * the currently running Game, and drives the main loop.
 *
 * Main loop (requestAnimationFrame):
 *   1. run as many fixed simulation ticks as real time allows
 *      (TICKS_PER_SECOND * speed), capped so a slow frame cannot spiral
 *   2. keyboard/edge scrolling
 *   3. render (walkers are interpolated between ticks for smooth motion)
 *   4. refresh UI widgets
 *
 * The simulation (core/game.js) never touches the DOM; everything
 * browser-specific lives here and under ui/, render/, input/, audio/.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from './config.js';
import { worldOf, fitTour } from './render/camera.js';
import { log } from './core/debug.js';
import { Game } from './core/game.js';
import { saveToSlot, readSlot, deserializeGame, exportToFile, exportSlotToFile, importFromFile, serializeGame, canDownloadFiles } from './core/save.js';
import { Renderer } from './render/renderer.js';
import { OVERLAYS } from './render/overlays.js';
import { UI } from './ui/ui.js';
import { h } from './ui/dom.js';
import { victoryMenu, defeatMenu, briefing, latestSave } from './ui/menus.js';
import { Input } from './input/input.js';
import { Sfx } from './audio/sfx.js';
import { Music, renderMood, encodeWav, measure } from './audio/music.js';
import { MOODS } from './audio/composer.js';
import { applyPlan as applyConstruction, canUndo as canUndoConstruction, undoLast } from './sim/construction.js';
import { findScenario, sandboxScenario, withDifficulty, SCENARIOS } from './data/scenarios.js';
import { DIFFICULTY, DIFFICULTY_ORDER } from './data/difficulty.js';
import { farmSeasonNotice } from './sim/production.js';
import { MAP_SIZES } from './world/mapgen.js';
import { buildDemoCity } from './dev/demoCity.js';
import { deployFort, enemyCount } from './sim/military.js';

/** Input events that count as a user activation (HTML spec) in some browser. */
const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];

const DEFAULT_SETTINGS = { volume: 0.5, muted: false, music: true, musicVolume: 0.35, edgeScroll: true, autosave: true, showFps: false, theme: 'auto', ambient: true, dayNight: true, seasons: true, weather: true, difficulty: 'normal' };

/** Does the player's system ask for less motion (accessibility setting)? */
function prefersReducedMotion() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be unavailable */ }
}

/** The menu background's tour: its reach from the town's middle (world px) and pace (radians a second). */
const MENU_ORBIT = 320;
const MENU_ORBIT_SPEED = 0.04;
/** The menu backdrop's map: room around its town so the view stays on land. */
const MENU_MAP_SIZE = 96;
const MENU_ZOOM = 2; // CONFIG.ZOOM_LEVELS index: 1x

export class App {
  /**
   * @param {HTMLElement} root  container element
   * @param {object} flags      parsed URL flags (core/debug.js)
   */
  constructor(root, flags) {
    this.root = root;
    this.flags = flags;
    this.log = log;
    this.settings = readJson(`${CONFIG.STORAGE_PREFIX}settings`, DEFAULT_SETTINGS);
    this.progress = readJson(`${CONFIG.STORAGE_PREFIX}progress`, { completed: [], best: {} }); // best = { missionId: hardest difficulty won }
    this.sfx = new Sfx();
    this.music = new Music();
    this.musicOverride = null; // mood after victory/defeat
    this.canvas = h('canvas', { id: 'view' });
    root.appendChild(this.canvas);
    this.renderer = new Renderer(this.canvas);
    // Thunder rolls in a moment after the lightning (only in a game, not behind the main menu).
    this.renderer.weather.onThunder = (delay) => setTimeout(() => { if (this.game) this.sfx.play('thunder'); }, delay * 1000);
    this.ui = new UI(this, root);
    this.input = new Input(this);
    this.game = null;
    this.menuGame = null;
    this.speedIndex = flags.speed && flags.speed > 0 ? Math.min(4, flags.speed) : 1;
    this.paused = flags.speed === 0;
    this.acc = 0;
    this.lastFrame = performance.now();
    this.perf = { fps: 0, frames: 0, fpsTime: 0, frameMs: 0, simMs: 0, ticks: 0 };
    this.debugHud = !!flags.debug;
    this.errorCount = 0;
    this.gameUnsub = [];
    this.deploying = 0; // fort id while the player picks where to deploy its soldiers
    this.lastExitSave = -Infinity; // performance.now() of the last save-on-exit (throttle)
    this.autosaveWarned = false;
    this.applySettings();
    // Autosave when the tab is hidden or the page is being closed/reloaded.
    // localStorage writes are synchronous, so this finishes before the page goes.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.autosaveNow('hidden');
      // Hidden tab: pause all sound (the music carries on when it comes back).
      const ctx = this.sfx.ctx;
      if (document.visibilityState === 'hidden') { if (ctx) ctx.suspend().catch(() => {}); }
      else if (this.audioUnlocked) { if (ctx) ctx.resume().catch(() => {}); }
      else this.tryAutoplay(); // opened in a background tab: try again now it shows
    });
    // Browsers only allow sound after the player interacts: start the audio
    // (and the music) on the first click, tap or key press anywhere. A mouse
    // press counts on pointerdown, but a touch or pen only on pointerup /
    // touchend (HTML "activation-triggering" events), so listen to all of them.
    this.audioUnlocked = false;
    const unlock = () => this.unlockAudio();
    for (const t of UNLOCK_EVENTS) window.addEventListener(t, unlock, true);
    this.unlockHandlers = unlock;
    window.addEventListener('pagehide', () => this.autosaveNow('pagehide'));
    window.addEventListener('resize', () => this.resize());
    this.resize();
    // Where the browser (or the page embedding the game) allows autoplay, the
    // music starts right away; elsewhere the main menu shows the title gate.
    this.tryAutoplay();
    requestAnimationFrame((t) => this.frame(t));
  }

  get showDebugHud() { return this.debugHud || this.settings.showFps; }

  /** Decide what to show first based on URL flags. */
  boot() {
    if (this.flags.scenario) {
      const s = findScenario(this.flags.scenario);
      if (s) { this.newScenario(s.id, this.flags.difficulty || 'normal'); return; }
      log.warn(`Unknown scenario "${this.flags.scenario}"`);
    }
    if (this.flags.skipmenu) {
      this.newSandbox({ size: this.flags.map || 'medium', type: this.flags.maptype || 'river', seed: this.flags.seed ?? 'quickstart', difficulty: this.flags.difficulty || 'normal', funds: 8000 });
      return;
    }
    this.toMainMenu();
  }

  resize() {
    const sidebarHidden = this.ui && this.ui.sidebar.el.classList.contains('hidden');
    const sidebarW = sidebarHidden ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) || 0;
    // #app is inset by the phone's safe areas, so size from it, not the window.
    const rect = this.root.getBoundingClientRect();
    const w = Math.max(200, (rect.width || window.innerWidth) - sidebarW);
    const hgt = Math.max(200, rect.height || window.innerHeight);
    this.renderer.resize(w, hgt, window.devicePixelRatio || 1);
  }

  // -------------------------------------------------------------- settings
  applySettings() {
    const s = this.settings;
    this.sfx.setVolume(s.volume);
    this.sfx.setMuted(s.muted || this.flags.mute);
    this.music.setVolume(s.musicVolume ?? DEFAULT_SETTINGS.musicVolume);
    this.music.setEnabled(s.music !== false);
    this.music.setMuted(s.muted || this.flags.mute);
    // Decorative motion: clouds/birds follow the setting; swaying trees, glints
    // and build animations also stop when the system asks for reduced motion.
    const reduced = prefersReducedMotion();
    const r = this.renderer;
    r.ambientOn = s.ambient !== false && !reduced;
    r.motionOn = !reduced;
    // The world around the city (all visual only).
    r.dayNightOn = s.dayNight !== false;
    r.seasonsOn = s.seasons !== false;
    r.weatherOn = s.weather !== false;
    // Only touch the theme attribute if the player picked a theme; 'auto'
    // leaves whatever the page host (or the OS) decided.
    const root = document.documentElement;
    if (s.theme === 'light' || s.theme === 'dark') {
      root.dataset.theme = s.theme;
      this.themeSetByGame = true;
    } else if (this.themeSetByGame) {
      delete root.dataset.theme;
      this.themeSetByGame = false;
    }
    writeJson(`${CONFIG.STORAGE_PREFIX}settings`, s);
  }

  // ------------------------------------------------------------ game setup
  /** The difficulty the menus start on: the player's last choice (or Normal). */
  difficultyPref() {
    return DIFFICULTY[this.settings.difficulty] ? this.settings.difficulty : 'normal';
  }

  /** Remember the difficulty picked in a menu for next time. */
  setDifficultyPref(key) {
    if (!DIFFICULTY[key] || this.settings.difficulty === key) return;
    this.settings.difficulty = key;
    writeJson(`${CONFIG.STORAGE_PREFIX}settings`, this.settings);
  }

  /** Start a campaign scenario by id, at a difficulty (default: Normal). */
  newScenario(id, difficulty = 'normal') {
    const scenario = withDifficulty(findScenario(id), difficulty);
    if (!scenario) { this.ui.toastError(`Unknown scenario ${id}`); return; }
    this.startGame(new Game({ scenario, flags: this.flags }));
    for (const hint of scenario.hints || []) this.game.message(hint, 'info');
    farmSeasonNotice(this.game, true); // Insane: missions start in winter, when nothing grows
  }

  /** Start a sandbox game with the given settings. */
  newSandbox(opts) {
    const scenario = sandboxScenario({
      size: MAP_SIZES[opts.size] || MAP_SIZES.medium,
      type: opts.type || 'river',
      seed: opts.seed ?? Math.floor(Math.random() * 1e6),
      funds: opts.funds || 8000,
      difficulty: opts.difficulty || 'normal',
      invasions: opts.invasions || 'occasional',
    });
    this.startGame(new Game({ scenario, flags: this.flags }));
    this.game.message('Welcome, governor! Press F1 any time for help.', 'info');
    farmSeasonNotice(this.game, true); // Insane: the city is founded in winter, when nothing grows
  }

  /** Restart the current map from scratch. */
  restart() {
    if (!this.game) return;
    const scenario = this.game.scenario;
    this.ui.closeModal();
    this.startGame(new Game({ scenario, flags: { ...this.flags, seed: this.game.seed } }));
    farmSeasonNotice(this.game, true);
  }

  /** Make `game` the active game and hook up its events. */
  startGame(game, cameraState = null) {
    for (const u of this.gameUnsub) u();
    this.gameUnsub = [];
    this.cancelDeploy();
    this.menuGame = null;
    this.game = game;
    this.musicOverride = null;
    this.acc = 0;
    this.renderer.attach(game);
    if (cameraState) this.renderer.camera.restore(cameraState);
    else this.centerOnEntry();
    const ev = game.events;
    this.gameUnsub.push(
      ev.on('message', (m) => this.ui.messages.push(m)),
      ev.on('sound', ({ name }) => this.sfx.play(name)),
      ev.on('victory', () => this.onVictory()),
      ev.on('defeat', ({ reason }) => this.onDefeat(reason)),
      ev.on('month', () => this.onMonth()),
    );
    this.input.setTool(null);
    this.ui.onGameStarted(game);
    this.resize();
    if (!cameraState) this.centerOnEntry();
    this.paused = this.flags.speed === 0;
    window.colonia = this;
    log.info(`Game started: ${game.scenario.name} (${game.scenario.id}), seed ${game.seed}`);
  }

  onMonth() {
    const g = this.game;
    if (this.settings.autosave && g.time.totalMonths % CONFIG.AUTOSAVE_EVERY_MONTHS === 0) this.autosaveNow('monthly');
  }

  /**
   * Write the autosave slot now (monthly, and when the page is hidden or
   * closed). Skipped for finished games. Exit saves run at most once per 5 s,
   * because closing a tab fires both visibilitychange and pagehide.
   */
  autosaveNow(why) {
    const g = this.game;
    if (!g || !this.settings.autosave || g.city.victory || g.city.defeat) return;
    if (why !== 'monthly') {
      // Closing a tab fires visibilitychange AND pagehide: save once.
      const now = performance.now();
      if (now - this.lastExitSave < 5000) return;
      this.lastExitSave = now;
    }
    const res = saveToSlot(g, 'auto', { camera: this.renderer.camera.serialize() });
    if (res.ok) { log.debug(`Autosaved (${why}, ${Math.round(res.bytes / 1024)} KB)`); return; }
    log.warn('Autosave failed:', res.reason);
    if (!this.autosaveWarned && why === 'monthly') {
      this.autosaveWarned = true;
      this.ui.toastError(`Autosave failed: ${res.reason}`);
    }
  }

  onVictory() {
    const id = this.game.scenario.id;
    if (!this.progress.completed.includes(id)) this.progress.completed.push(id);
    // Remember the hardest difficulty each mission was won on (campaign list badge).
    const best = this.progress.best || (this.progress.best = {});
    const rank = (k) => DIFFICULTY_ORDER.indexOf(k);
    if (rank(this.game.difficultyKey) > rank(best[id] ?? '')) best[id] = this.game.difficultyKey;
    writeJson(`${CONFIG.STORAGE_PREFIX}progress`, this.progress);
    this.sfx.play('victory');
    this.musicOverride = 'festival';
    this.ui.showModal(victoryMenu(this), { pause: true, kind: 'outcome' });
  }

  onDefeat(reason) {
    this.sfx.play('wrath');
    this.musicOverride = 'night';
    this.ui.showModal(defeatMenu(this, reason), { pause: true, kind: 'outcome' });
  }

  // ------------------------------------------------------------------ audio
  /** First user gesture: create/resume the audio context and start the music. */
  unlockAudio() {
    const ctx = this.sfx._ensure();
    if (!ctx) return;
    this.music.attach(ctx);
    // Some key presses (Escape...) do not count as a real interaction, so keep
    // listening until the browser has actually let the sound start.
    if (!this.audioWatch) {
      this.audioWatch = true;
      ctx.addEventListener('statechange', () => this.onAudioState(ctx));
    }
    if (ctx.state === 'running') this.onAudioState(ctx);
    else ctx.resume().then(() => this.onAudioState(ctx)).catch(() => {});
  }

  /** The audio context runs: stop listening for gestures, drop the title gate. */
  onAudioState(ctx) {
    if (ctx.state !== 'running' || this.audioUnlocked) return;
    this.audioUnlocked = true;
    for (const t of UNLOCK_EVENTS) window.removeEventListener(t, this.unlockHandlers, true);
    this.ui.hideAudioGate();
  }

  /**
   * Try to start the sound without a gesture. Works where autoplay is allowed
   * (browser setting, or an embedding page with allow="autoplay"); elsewhere
   * the context stays suspended until the first click. Only when the music
   * would be heard, and not in a hidden tab.
   */
  tryAutoplay() {
    if (this.audioUnlocked || this.music.level() <= 0) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    // Firefox can say up front that autoplay is blocked: then skip the doomed
    // context (and its console notice); the title gate asks for the click.
    if (typeof navigator !== 'undefined' && navigator.getAutoplayPolicy?.('audiocontext') === 'disallowed') return;
    this.unlockAudio();
  }

  /**
   * Should the main menu wait behind the title gate? Only while the browser
   * is holding back music the player would hear (not muted, music on, some
   * volume) and Web Audio exists at all.
   */
  needsAudioGate() {
    if (this.audioUnlocked || this.music.level() <= 0) return false;
    const ctx = this.sfx.ctx;
    if (ctx) return ctx.state !== 'running';
    return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
  }

  /**
   * The music's mood for what is happening: raiders on the map beat
   * everything, then a recent festival, then night or day.
   */
  musicMood() {
    const g = this.game;
    if (!g) return 'menu';
    if (this.musicOverride) return this.musicOverride;
    if (g.military && (g.military.active || enemyCount(g) > 0)) return 'danger';
    if (g.city.festivalBoost >= 2.5) return 'festival';
    if (this.renderer.sky.lamps >= 0.6) return 'night';
    return 'day';
  }

  /** M key / Settings: music on or off. */
  toggleMusic() {
    this.settings.music = this.settings.music === false;
    this.applySettings();
    this.ui.messages.push({ text: `Music ${this.settings.music ? 'on' : 'off'} (M).`, level: 'info', date: '' });
  }

  /**
   * Render a few seconds of every mood offline and measure it: peak and RMS
   * loudness. Catches silent, clipping or broken music (console `music check`,
   * browser smoke test).
   * @returns {Promise<Object<string,{peak:number, rmsDb:number, bad:boolean}>>}
   */
  async musicSelfCheck(seconds = 6) {
    const out = {};
    for (const mood of Object.keys(MOODS)) {
      const m = measure(await renderMood(mood, seconds));
      out[mood] = { peak: Math.round(m.peak * 1000) / 1000, rmsDb: Math.round(m.rmsDb * 10) / 10, bad: m.bad };
    }
    return out;
  }

  /**
   * Render `seconds` of a mood and download it as a WAV file (console).
   * @returns {Promise<string>} a status line
   */
  async exportMusic(mood, seconds) {
    const buf = await renderMood(mood, seconds);
    const blob = encodeWav(buf);
    if (!canDownloadFiles()) return `Rendered ${seconds} s of ${mood} music (${Math.round(blob.size / 1024)} KB), but downloads are not available in this embedded version.`;
    const a = h('a', { href: URL.createObjectURL(blob), download: `colonia-${mood}.wav` });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return `Saved colonia-${mood}.wav (${seconds} s, ${Math.round(blob.size / 1024)} KB).`;
  }

  /** Leave the current game and show the main menu over a living demo city. */
  toMainMenu() {
    for (const u of this.gameUnsub) u();
    this.gameUnsub = [];
    this.game = null;
    this.musicOverride = null;
    this.input.setTool(null);
    this.ui.closeModal();
    this.ui.showMainMenu();
    this.resize();
    this.startMenuBackground();
  }

  /**
   * The menu's slow tour of its town: a figure eight around the town's middle
   * (MENU_ORBIT world px across and half that tall, a loop in about two and
   * a half minutes). It used to pan one way for good, until the view stopped
   * against the map's limits in an empty corner with the town out of sight.
   */
  menuDrift(dt) {
    const o = this.menuOrbit;
    if (!o) return;
    o.t += dt;
    const cam = this.renderer.camera;
    // Fit the tour to the screen again whenever its size changes (a resize,
    // a phone turned): the view must never reach past the map's edge.
    const sig = `${cam.viewW}x${cam.viewH}@${cam.dpr}`;
    if (o.sig !== sig) this.fitMenuTour(sig);
    const a = o.t * MENU_ORBIT_SPEED;
    const r = MENU_ORBIT * o.fit.scale;
    cam.setCenter(o.fit.x + Math.sin(a) * r, o.fit.y + Math.sin(2 * a) * r * 0.35);
  }

  /**
   * Choose the tour's middle, swing and zoom for this screen (fitTour): the
   * town at the middle where the map allows, otherwise nearer the map's
   * middle or a smaller swing, and a closer zoom if the map is smaller than
   * the screen. The menu used to open on a town by the map's edge with a
   * third of the screen dark.
   */
  fitMenuTour(sig) {
    const o = this.menuOrbit;
    const cam = this.renderer.camera;
    const map = this.menuGame.map;
    o.sig = sig;
    for (let z = MENU_ZOOM; z < CONFIG.ZOOM_LEVELS.length; z++) {
      cam.zoomIndex = z;
      const halfW = cam.viewW / cam.scale / 2;
      const halfH = cam.viewH / cam.scale / 2;
      const fit = fitTour(map.w, map.h, o.c, halfW, halfH, MENU_ORBIT, MENU_ORBIT * 0.35);
      if (fit) { o.fit = fit; return; }
    }
    o.fit = { x: o.c.x, y: o.c.y, scale: 0 }; // a screen bigger than the map at every zoom: hold still
  }

  startMenuBackground() {
    try {
      const types = ['river', 'lakes', 'coast'];
      const scenario = sandboxScenario({ size: MENU_MAP_SIZE, type: types[Math.floor(Math.random() * types.length)], seed: `menu-${Math.floor(Math.random() * 1000)}` });
      const g = new Game({ scenario, flags: { unlockall: true, money: 100000 } });
      g.log = { ...log, info() {}, debug() {} };
      const res = buildDemoCity(g, { level: 2 });
      g.runDays(16 * 5);
      this.menuGame = g;
      this.renderer.attach(g);
      this.renderer.camera.zoomIndex = MENU_ZOOM;
      const town = res.center || { x: MENU_MAP_SIZE / 2, y: MENU_MAP_SIZE / 2 };
      this.menuOrbit = { c: worldOf(town.x + 0.5, town.y + 0.5), t: 0, sig: null, fit: null };
      this.menuDrift(0); // fit the tour to this screen and take its first spot
    } catch (err) {
      log.warn('Menu background failed (harmless):', err);
      this.menuGame = null;
    }
  }

  // --------------------------------------------------------- save / load
  saveSlot(slot) {
    if (!this.game) return;
    const res = saveToSlot(this.game, slot, { camera: this.renderer.camera.serialize() });
    if (res.ok) this.ui.messages.push({ text: `Game saved (${Math.round(res.bytes / 1024)} KB).`, level: 'good', date: '' });
    else this.ui.toastError(res.reason);
  }

  loadSlot(slot) {
    try {
      const data = readSlot(slot);
      if (!data) { this.ui.toastError('That save slot is empty.'); return; }
      this.loadData(data);
    } catch (err) {
      log.error('Load failed:', err);
      this.ui.toastError(`Could not load: ${err.message}`);
    }
  }

  loadData(data) {
    const game = deserializeGame(data, this.flags);
    this.startGame(game, data.camera || null);
    this.ui.messages.push({ text: `Loaded ${data.meta?.city || 'city'} (${data.meta?.date || ''}).`, level: 'good', date: '' });
  }

  continueAutosave() {
    const latest = latestSave();
    this.loadSlot(latest ? latest.slot : 'auto');
  }
  quickSave() { this.saveSlot('quick'); }
  quickLoad() { this.loadSlot('quick'); }

  exportSave() {
    if (!this.game) return;
    try {
      exportToFile(this.game, { camera: this.renderer.camera.serialize() });
    } catch (err) {
      this.ui.toastError(`Export failed: ${err.message}`);
    }
  }

  /** Download one save slot as a file, without loading it. */
  exportSlot(slot) {
    try {
      const name = exportSlotToFile(slot);
      this.ui.messages.push({ text: `Exported ${name} to your downloads.`, level: 'good', date: '' });
    } catch (err) {
      this.ui.toastError(`Export failed: ${err.message}`);
    }
  }

  /** Copy the save to the clipboard (works where file downloads are blocked). */
  copySave() {
    if (!this.game) return;
    const text = JSON.stringify(serializeGame(this.game, { camera: this.renderer.camera.serialize() }));
    const fallback = () => this.ui.showText('Save data', text, 'Select all and copy this text somewhere safe. Load it later with "Paste save data".');
    try {
      navigator.clipboard.writeText(text).then(
        () => this.ui.messages.push({ text: `Save data copied (${Math.round(text.length / 1024)} KB). Paste it into a text file to keep it.`, level: 'good', date: '' }),
        fallback,
      );
    } catch {
      fallback();
    }
  }

  /** Load a save from pasted text. */
  importText(text) {
    try {
      const data = JSON.parse(String(text || '').trim());
      this.loadData(data);
    } catch (err) {
      this.ui.toastError(`Could not load that text: ${err.message}`);
    }
  }

  async importSave(file) {
    try {
      const data = await importFromFile(file);
      this.loadData(data);
    } catch (err) {
      log.error('Import failed:', err);
      this.ui.toastError(`Could not import: ${err.message}`);
    }
  }

  // ------------------------------------------------------------- actions
  // The Advisors and the Empire map let the game run and keep the keyboard shortcuts.
  blockingModal() { return this.ui.mainMenuOpen || (this.ui.hasModal() && this.ui.modalKind !== 'advisors' && this.ui.modalKind !== 'empire'); }

  applyPlan(plan) {
    if (!this.game || !plan) return;
    const res = applyConstruction(this.game, plan);
    if (!res.ok) {
      this.ui.toastError(res.reason || plan.reason || 'Cannot build there.');
      return;
    }
    // A single-building tool stays selected so you can place several.
  }

  canUndo() { return !!this.game && canUndoConstruction(this.game); }

  undo() {
    if (!this.game) return;
    const res = undoLast(this.game);
    if (res.ok) this.ui.messages.push({ text: `Undone. Refunded ${res.refund} Dn.`, level: 'info', date: '' });
    else this.ui.toastError(res.reason);
  }

  // ------------------------------------------------------------ military
  /** Start picking a tile where a fort's soldiers should stand. */
  startDeploy(fortId) {
    const f = this.game?.buildings.get(fortId);
    if (!f) return;
    this.input.setTool(null);
    this.deploying = fortId;
    this.renderer.deployFort = fortId;
    this.ui.messages.push({ text: `Click where the ${f.def.name}'s soldiers should stand. Right-click or Esc cancels.`, level: 'info', date: '' });
  }

  cancelDeploy() {
    this.deploying = 0;
    this.renderer.deployFort = 0;
  }

  /** Center the view on the raiders (or open the military advisor if none are here). */
  focusThreat() {
    const g = this.game;
    if (!g) return;
    let n = 0;
    let sx = 0;
    let sy = 0;
    for (const u of g.units.values()) if (u.side === 'enemy') { sx += u.x; sy += u.y; n++; }
    if (n) this.renderer.camera.glideToTile(Math.floor(sx / n), Math.floor(sy / n));
    else this.ui.openAdvisors('military');
  }

  /**
   * A click on the map (no tool in hand). `screen` (CSS px, optional) lets a
   * click on a walker's figure pick the walker instead of what is under it.
   */
  /**
   * `pressed`: the walkers under the pointer when the button went down
   * (input.js: { strict, loose } ids, 0 for none). A click on a figure
   * itself picks the walker; else a building or roadblock under the click
   * wins; else the generous box around a walker still catches it.
   */
  clickTile(x, y, screen = null, pressed = null) {
    const g = this.game;
    if (this.deploying && g) {
      const id = this.deploying;
      this.cancelDeploy();
      if (g.map.inBounds(x, y) && deployFort(g, id, x, y)) {
        this.sfx.play('horn');
        this.ui.messages.push({ text: `Soldiers are marching to ${x}, ${y}.`, level: 'info', date: '' });
      }
      if (g.buildings.has(id)) this.ui.info.showBuilding(id);
      return;
    }
    if (!g || !g.map.inBounds(x, y)) { this.ui.info.close(); return; }
    this.sfx.play('click');
    const alive = (id) => (id && g.walkers.has(id) ? id : 0);
    const r = this.renderer;
    const strict = alive(pressed?.strict) || (screen ? r.pickWalker(screen.x, screen.y, false) : 0);
    const onSomething = g.map.buildingAt(x, y) || g.map.roadblock[g.map.idx(x, y)];
    const wid = strict || (onSomething ? 0 : alive(pressed?.loose) || (screen ? r.pickWalker(screen.x, screen.y, true) : 0));
    if (wid) { this.ui.info.showWalker(wid); return; }
    const id = g.map.buildingAt(x, y);
    if (id) this.ui.info.showBuilding(id);
    else this.ui.info.showTile(x, y);
  }

  rightClick() {
    if (this.deploying) { this.cancelDeploy(); return; }
    if (this.input.tool) this.ui.selectTool(null);
    else if (this.ui.info.open) this.ui.info.close();
  }

  escape() {
    if (this.ui.console.open) { this.ui.console.toggle(); return; }
    if (this.ui.hasModal()) {
      if (this.ui.modalKind !== 'outcome') this.ui.closeModal();
      return;
    }
    if (this.ui.mainMenuOpen) return;
    if (this.deploying) { this.cancelDeploy(); return; }
    if (this.input.tool) { this.ui.selectTool(null); return; }
    if (this.ui.info.open) { this.ui.info.close(); return; }
    this.ui.openPauseMenu();
  }

  togglePause() { this.paused = !this.paused; }

  setSpeed(i) {
    this.speedIndex = Math.max(1, Math.min(CONFIG.SPEEDS.length - 1, i));
    this.paused = false;
  }

  setOverlay(key) {
    this.renderer.setOverlay(key);
    this.ui.updateOverlayHelp(); // the legend changes with it, not a frame later
  }

  cycleOverlay(dir) {
    const i = OVERLAYS.findIndex((o) => o.key === this.renderer.overlay.key);
    const next = OVERLAYS[(i + dir + OVERLAYS.length) % OVERLAYS.length];
    this.setOverlay(next.key);
    this.ui.messages.push({ text: `Overlay: ${next.name}`, level: 'info', date: '' });
  }

  /** Look at the map entrance (glide = travel there instead of jumping). */
  centerOnEntry(glide = false) {
    const g = this.game;
    if (!g) return;
    const e = g.map.entry;
    // Aim a little inside the map from the entrance.
    const cx = Math.round(e.x + (g.map.w / 2 - e.x) * 0.25);
    const cy = Math.round(e.y + (g.map.h / 2 - e.y) * 0.25);
    if (glide) this.renderer.camera.glideToTile(cx, cy);
    else this.renderer.camera.centerOnTile(cx, cy);
  }

  toggleDebugHud() { this.debugHud = !this.debugHud; }
  toggleConsole() { this.ui.console.toggle(); }

  showBriefing() {
    if (this.game) this.ui.showModal(briefing(this, this.game.scenario));
  }

  // ----------------------------------------------------------- main loop
  isPaused() { return this.paused || this.ui.modalPause || this.crashed; }

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    const frameStart = performance.now();
    try {
      const g = this.game || this.menuGame;
      let alpha = 0;
      let ticks = 0;
      let simMs = 0;
      if (g && !(this.game && this.isPaused())) {
        const speed = this.game ? CONFIG.SPEEDS[this.speedIndex] : 1;
        this.acc += dt * CONFIG.TICKS_PER_SECOND * speed;
        const t0 = performance.now();
        while (this.acc >= 1 && ticks < CONFIG.MAX_TICKS_PER_FRAME) {
          g.tick();
          this.acc -= 1;
          ticks++;
        }
        if (ticks >= CONFIG.MAX_TICKS_PER_FRAME) this.acc = 0; // drop backlog, do not spiral
        simMs = performance.now() - t0;
        alpha = this.acc;
      }
      if (!this.game && this.menuGame) this.menuDrift(dt);
      this.input.update(dt);
      this.renderer.render(alpha, dt);
      this.music.setMood(this.musicMood());
      this.ui.update(dt, now);
      // performance counters
      const p = this.perf;
      p.frames++;
      p.fpsTime += dt;
      p.simMs = simMs;
      p.ticks = ticks;
      p.frameMs = performance.now() - frameStart;
      if (p.fpsTime >= 1) { p.fps = p.frames; p.frames = 0; p.fpsTime = 0; }
      this.errorCount = Math.max(0, this.errorCount - 0.02);
    } catch (err) {
      this.errorCount++;
      log.error('Frame failed:', err);
      if (this.errorCount > 3 && !this.crashed) {
        this.crashed = true;
        if (typeof window.__coloniaCrash === 'function') window.__coloniaCrash(err);
      }
    }
  }
}

export { SCENARIOS };

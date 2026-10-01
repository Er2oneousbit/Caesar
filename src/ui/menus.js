/**
 * menus.js
 * ----------------------------------------------------------------------------
 * Main menu, campaign & sandbox setup, save/load, settings, pause menu,
 * scenario briefing and the victory/defeat screens.
 *
 * Every function returns a DOM element; UI.showModal() / UI.showMainMenu()
 * decide where it goes.
 * ----------------------------------------------------------------------------
 */

import { h, fmt } from './dom.js';
import { CONFIG } from '../config.js';
import { SCENARIOS, withDifficulty } from '../data/scenarios.js';
import { MAP_SIZES, MAP_SIZE_NOTES, MAP_TYPES } from '../world/mapgen.js';
import { DIFFICULTY } from '../data/difficulty.js';
import { listSlots, deleteSlot, canDownloadFiles, slotSize, storageUsage, STORAGE_BUDGET } from '../core/save.js';
import { goalStatus } from '../sim/ratings.js';

export const SAVE_SLOTS = ['auto', 'quick', 'slot1', 'slot2', 'slot3', 'slot4', 'slot5'];
const SLOT_NAMES = { auto: 'Autosave', quick: 'Quicksave', slot1: 'Slot 1', slot2: 'Slot 2', slot3: 'Slot 3', slot4: 'Slot 4', slot5: 'Slot 5' };

const FOOTER = 'Made with ❤️ from your friendly hacker - er2oneousbit';

function modal(title, body, foot, cls = '', onClose = null) {
  return h('div', { class: `modal ${cls}` },
    h('div', { class: 'modal-head' }, h('h2', {}, title), onClose ? h('button', { class: 'panel-close', title: 'Close', onclick: onClose }, '×') : null),
    h('div', { class: 'modal-body' }, body),
    foot ? h('div', { class: 'modal-foot' }, foot) : null);
}

// ---------------------------------------------------------------------------
// Main menu
// ---------------------------------------------------------------------------

/** The most recent autosave or quicksave, if any. */
export function latestSave() {
  const saves = listSlots(['auto', 'quick']).filter((s) => s.meta);
  saves.sort((a, b) => String(b.meta.savedAt).localeCompare(String(a.meta.savedAt)));
  return saves[0] || null;
}

export function mainMenu(app) {
  const latest = latestSave();
  const hasAuto = !!latest;
  return h('div', { id: 'main-menu' },
    h('div', { class: 'menu-card' },
      h('h1', {}, CONFIG.GAME_TITLE),
      h('div', { class: 'tagline' }, CONFIG.GAME_TAGLINE),
      hasAuto ? h('button', { class: 'btn primary', title: `${latest.meta.city}, ${latest.meta.date}`, onclick: () => app.loadSlot(latest.slot) }, 'Continue') : null,
      h('button', { class: `btn${hasAuto ? '' : ' primary'}`, onclick: () => app.ui.showModal(campaignMenu(app)) }, 'Campaign'),
      h('button', { class: 'btn', onclick: () => app.ui.showModal(sandboxMenu(app)) }, 'Sandbox'),
      h('button', { class: 'btn', onclick: () => app.ui.showModal(loadMenu(app)) }, 'Load game'),
      h('button', { class: 'btn', onclick: () => app.ui.openHelp() }, 'How to play'),
      h('button', { class: 'btn', onclick: () => app.ui.showModal(settingsMenu(app)) }, 'Settings'),
      h('button', { class: 'btn', onclick: () => app.ui.showModal(creditsMenu(app)) }, 'Credits'),
      h('div', { class: 'footer-note' }, `v${CONFIG.VERSION} · ${FOOTER}`)));
}

/**
 * Title gate shown over the main menu until the first click, tap or key
 * press (the gesture browsers require before any sound, which starts the
 * menu music). The whole screen is the target; the button is there for
 * keyboard and screen-reader users.
 */
export function titleGate(app) {
  return h('div', { id: 'title-gate', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'title-gate-h', 'aria-describedby': 'title-gate-hint' },
    h('div', { class: 'gate-card' },
      h('h1', { id: 'title-gate-h' }, CONFIG.GAME_TITLE),
      h('div', { class: 'tagline' }, CONFIG.GAME_TAGLINE),
      h('button', { class: 'btn primary gate-begin', type: 'button' }, '\u266A  Begin'),
      h('div', { id: 'title-gate-hint', class: 'gate-hint' }, 'Click, tap or press a key to begin. The music starts with it.')));
}

// ---------------------------------------------------------------------------
// Campaign
// ---------------------------------------------------------------------------

export function campaignMenu(app) {
  const done = app.progress.completed || [];
  const best = app.progress.best || {};
  const list = SCENARIOS.map((s, i) => {
    const unlocked = app.flags.unlockall || i === 0 || done.includes(SCENARIOS[i - 1].id) || done.includes(s.id);
    const goals = Object.entries(s.goals).filter(([, v]) => v).map(([k, v]) => `${k} ${fmt(v)}`).join(', ');
    const beaten = DIFFICULTY[best[s.id]];
    return h('button', {
      class: `scenario${unlocked ? '' : ' locked'}`,
      title: unlocked ? s.intro : 'Complete the previous mission to unlock',
      onclick: () => { if (unlocked) app.ui.showModal(briefing(app, s, (d) => app.newScenario(s.id, d))); },
    }, h('span', { class: 'n' }, done.includes(s.id) ? '✔' : String(i + 1)),
    h('span', { class: 't' }, h('b', {}, `${s.name}: ${s.title}`), h('span', { class: 'muted' }, `${MAP_TYPES[s.map.type].name} · Goals: ${goals}`)),
    beaten ? h('span', { class: `best ${best[s.id]}`, title: `Completed on ${beaten.name}` }, beaten.name) : null,
    unlocked ? null : h('span', {}, '🔒'));
  });
  return modal('Campaign', h('div', { class: 'scenario-list' }, list),
    [h('button', { class: 'btn', onclick: () => app.ui.closeModal() }, 'Back')], '', () => app.ui.closeModal());
}

/**
 * A difficulty <select> with the chosen level's description under it.
 * @param {string} current  difficulty key
 * @param {(key:string)=>void} onChange
 */
function difficultyField(current, onChange) {
  const desc = h('div', { class: 'muted', style: { fontSize: '12px' } }, DIFFICULTY[current].desc);
  return h('div', { class: 'field' }, h('label', {}, 'Difficulty'),
    h('select', {
      class: 'difficulty-select',
      onchange: (e) => { desc.textContent = DIFFICULTY[e.target.value].desc; onChange(e.target.value); },
    }, Object.entries(DIFFICULTY).map(([k, v]) => h('option', { value: k, selected: k === current }, v.name))),
    desc);
}

/**
 * Scenario briefing. Before a mission (onBegin given) the player picks the
 * difficulty and onBegin(key) starts it; from the game menu (no onBegin) it
 * shows the difficulty being played.
 */
export function briefing(app, s, onBegin = null) {
  const goals = Object.entries(s.goals).filter(([, v]) => v);
  let diff = onBegin ? app.difficultyPref() : (app.game?.difficultyKey || 'normal');
  // In a game `s` is the running scenario (funds already scaled); before one, scale them here.
  // In a game the map is the one being played (a save from an older release may have another size).
  const side = !onBegin && app.game ? app.game.map.w : s.map.size;
  const fundsText = () => `Starting funds: ${fmt(onBegin ? withDifficulty(s, diff).funds : s.funds)} Dn · Map: ${MAP_TYPES[s.map.type].name} (${side}×${side})`;
  const fundsRow = h('div', { class: 'row muted' }, fundsText());
  return modal(`${s.name}: ${s.title}`, [
    h('p', {}, s.intro),
    h('h4', {}, 'Goals'),
    goals.length ? h('ul', {}, goals.map(([k, v]) => h('li', {}, `${k[0].toUpperCase()}${k.slice(1)}: ${fmt(v)}`))) : h('div', { class: 'muted' }, 'None: build as you like.'),
    fundsRow,
    onBegin
      ? difficultyField(diff, (k) => { diff = k; fundsRow.textContent = fundsText(); })
      : h('div', { class: 'row muted' }, `Difficulty: ${DIFFICULTY[diff].name}`),
    s.hints && s.hints.length ? [h('h4', {}, 'Advice'), h('ul', {}, s.hints.map((t) => h('li', {}, t)))] : null,
  ], onBegin ? [
    h('button', { class: 'btn', onclick: () => app.ui.closeModal() }, 'Back'),
    h('button', { class: 'btn primary', onclick: () => { app.ui.closeModal(); app.setDifficultyPref(diff); onBegin(diff); } }, 'Begin'),
  ] : [
    h('button', { class: 'btn primary', onclick: () => app.ui.closeModal() }, 'Close'),
  ], 'narrow');
}

// ---------------------------------------------------------------------------
// Sandbox setup
// ---------------------------------------------------------------------------

export function sandboxMenu(app) {
  const state = {
    size: app.flags.map || 'medium',
    type: app.flags.maptype || 'river',
    seed: String(app.flags.seed ?? Math.floor(Math.random() * 1e6)),
    difficulty: app.difficultyPref(),
    funds: 8000,
    invasions: 'occasional',
  };
  const seedInput = h('input', { type: 'text', value: state.seed, oninput: (e) => { state.seed = e.target.value.trim() || '1'; } });
  const typeDesc = h('div', { class: 'muted', style: { fontSize: '12px' } }, MAP_TYPES[state.type].desc);
  const sizeDesc = h('div', { class: 'muted', style: { fontSize: '12px' } }, MAP_SIZE_NOTES[state.size] || '');
  return modal('Sandbox', [
    h('div', { class: 'grid2' },
      h('div', { class: 'field' }, h('label', {}, 'Map size'),
        h('select', { onchange: (e) => { state.size = e.target.value; sizeDesc.textContent = MAP_SIZE_NOTES[state.size] || ''; } }, Object.entries(MAP_SIZES).map(([k, v]) => h('option', { value: k, selected: k === state.size }, `${k[0].toUpperCase()}${k.slice(1)} (${v}×${v})`))),
        sizeDesc),
      h('div', { class: 'field' }, h('label', {}, 'Landscape'),
        h('select', { onchange: (e) => { state.type = e.target.value; typeDesc.textContent = MAP_TYPES[state.type].desc; } }, Object.entries(MAP_TYPES).map(([k, v]) => h('option', { value: k, selected: k === state.type }, v.name))),
        typeDesc),
      h('div', { class: 'field' }, h('label', {}, 'Map seed (same seed = same map)'),
        h('div', { class: 'row' }, seedInput, h('button', { class: 'btn small', onclick: () => { state.seed = String(Math.floor(Math.random() * 1e6)); seedInput.value = state.seed; } }, '🎲'))),
      difficultyField(state.difficulty, (k) => { state.difficulty = k; }),
      h('div', { class: 'field' }, h('label', {}, 'Starting funds (before difficulty)'),
        h('input', { type: 'number', min: 1000, max: 100000, step: 500, value: state.funds, onchange: (e) => { state.funds = Math.max(1000, Math.min(100000, Number(e.target.value) || 8000)); } })),
      h('div', { class: 'field' }, h('label', {}, 'Raids'),
        h('select', { onchange: (e) => { state.invasions = e.target.value; } },
          [['none', 'Peaceful (no raids)'], ['occasional', 'Occasional raids'], ['frequent', 'Frequent raids']].map(([k, n]) => h('option', { value: k, selected: k === state.invasions }, n))),
        h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Raiders never come before the city has 120 people, and scouts warn you about 3 months ahead.'))),
  ], [
    h('button', { class: 'btn', onclick: () => app.ui.closeModal() }, 'Back'),
    h('button', { class: 'btn primary', onclick: () => { app.ui.closeModal(); app.setDifficultyPref(state.difficulty); app.newSandbox(state); } }, 'Found the city'),
  ], 'narrow', () => app.ui.closeModal());
}

// ---------------------------------------------------------------------------
// Save / load
// ---------------------------------------------------------------------------

/** Download this slot as a .json file, without loading it (none where downloads are blocked). */
function slotExportButton(app, slot) {
  if (!canDownloadFiles()) return null;
  return h('button', { class: 'btn small slot-export', title: `Export ${SLOT_NAMES[slot] || slot} to a file`, onclick: () => app.exportSlot(slot) }, '💾');
}

function slotRow(app, slot, meta, actions) {
  const kb = Math.ceil(slotSize(slot) / 1024);
  return h('div', { class: 'card row', style: { marginBottom: '6px' } },
    h('div', { style: { flex: 1 } },
      h('b', {}, SLOT_NAMES[slot] || slot),
      meta ? h('div', { class: 'muted', style: { fontSize: '12px' } }, `${meta.city} · ${meta.date} · pop ${fmt(meta.population)}${DIFFICULTY[meta.difficulty] && meta.difficulty !== 'normal' ? ` · ${DIFFICULTY[meta.difficulty].name}` : ''} · ${new Date(meta.savedAt).toLocaleString()} · ${fmt(kb)} KB`) : h('div', { class: 'muted' }, 'Empty')),
    actions);
}

/** "Stored in this browser" box with a usage bar (Save and Load menus). */
function storageNote() {
  const u = storageUsage();
  if (!u.available) {
    return h('div', { class: 'status bad', style: { marginTop: '6px' } }, 'This browser is blocking local storage (private mode or site data disabled), so games cannot be saved here. Use "Copy save data" to keep your progress.');
  }
  const frac = Math.min(1, u.used / STORAGE_BUDGET);
  return h('div', { class: 'card', style: { marginTop: '6px' } },
    h('div', { class: 'row' }, h('b', { style: { flex: 1 } }, '💾 Stored in this browser (localStorage)'), h('span', { class: 'num' }, `${fmt(Math.ceil(u.used / 1024))} KB`)),
    h('div', { class: 'bar' }, h('i', { style: { width: `${Math.round(frac * 100)}%`, background: frac > 0.85 ? 'var(--bad)' : frac > 0.6 ? 'var(--warn)' : 'var(--good)' } })),
    h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '3px' } },
      `Most browsers allow about ${Math.round(STORAGE_BUDGET / 1048576)} MB per site. Saves stay on this computer and browser only, and clearing site data deletes them: export or copy a save to back it up. The autosave slot is written every ${CONFIG.AUTOSAVE_EVERY_MONTHS} months and whenever you leave the page.`));
}

export function loadMenu(app) {
  const slots = listSlots(SAVE_SLOTS);
  const byName = Object.fromEntries(slots.map((s) => [s.slot, s]));
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden', onchange: (e) => { const f = e.target.files[0]; if (f) app.importSave(f); } });
  const rows = SAVE_SLOTS.map((slot) => {
    const s = byName[slot];
    return slotRow(app, slot, s?.meta, s ? [
      s.corrupt ? h('span', { class: 'no' }, 'Corrupt') : h('button', { class: 'btn small primary', onclick: () => app.loadSlot(slot) }, 'Load'),
      slotExportButton(app, slot),
      h('button', { class: 'btn small danger', title: 'Delete this save', onclick: () => app.ui.confirm(`Delete ${SLOT_NAMES[slot]}? This cannot be undone.`, () => { deleteSlot(slot); app.ui.showModal(loadMenu(app)); }, { yes: 'Delete', danger: true }) }, '🗑'),
    ] : null);
  });
  return modal('Load game', [rows, fileInput, storageNote()], [
    h('button', { class: 'btn', onclick: () => fileInput.click() }, '📂 Import from file'),
    h('button', { class: 'btn', onclick: () => app.ui.askText('Paste save data', 'Paste the text you copied with "Copy save data".', 'Load', (text) => app.importText(text)) }, '📋 Paste save data'),
    h('button', { class: 'btn', onclick: () => app.ui.closeModal() }, 'Back'),
  ], 'narrow', () => app.ui.closeModal());
}

export function saveMenu(app) {
  const slots = listSlots(SAVE_SLOTS);
  const byName = Object.fromEntries(slots.map((s) => [s.slot, s]));
  const rows = SAVE_SLOTS.filter((s) => s !== 'auto').map((slot) => slotRow(app, slot, byName[slot]?.meta,
    [byName[slot] ? slotExportButton(app, slot) : null,
      h('button', { class: 'btn small primary', onclick: () => { const doSave = () => { app.saveSlot(slot); app.ui.closeModal(); }; if (!byName[slot]) doSave(); else app.ui.confirm(`Overwrite ${SLOT_NAMES[slot]}?`, doSave, { yes: 'Overwrite' }); } }, 'Save here')]));
  return modal('Save game', [rows, storageNote()], [
    canDownloadFiles() ? h('button', { class: 'btn', onclick: () => app.exportSave() }, '💾 Export current game') : null,
    h('button', { class: 'btn', onclick: () => app.copySave() }, '📋 Copy save data'),
    h('button', { class: 'btn', onclick: () => app.ui.closeModal() }, 'Back'),
  ], 'narrow', () => app.ui.closeModal());
}

// ---------------------------------------------------------------------------
// Settings, credits, pause
// ---------------------------------------------------------------------------

export function settingsMenu(app) {
  const s = app.settings;
  const vol = h('b', {}, `${Math.round(s.volume * 100)}%`);
  const mvol = h('b', {}, `${Math.round((s.musicVolume ?? 0.35) * 100)}%`);
  const check = (key, label, help) => h('label', { class: 'check-row' },
    h('input', { type: 'checkbox', checked: !!s[key], onchange: (e) => { s[key] = e.target.checked; app.applySettings(); } }),
    h('span', {}, label, help ? h('div', { class: 'muted', style: { fontSize: '12px' } }, help) : null));
  return modal('Settings', [
    h('div', { class: 'field' }, h('label', {}, 'Sound effects volume'), vol,
      h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.volume, oninput: (e) => { s.volume = Number(e.target.value); vol.textContent = `${Math.round(s.volume * 100)}%`; app.applySettings(); } })),
    check('music', 'Music (M)', 'Original music played live by synthesized lyre, pipes and drums, changing with the day, the night, festivals and raids.'),
    h('div', { class: 'field' }, h('label', {}, 'Music volume'), mvol,
      h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.musicVolume ?? 0.35, 'aria-label': 'Music volume', oninput: (e) => { s.musicVolume = Number(e.target.value); mvol.textContent = `${Math.round(s.musicVolume * 100)}%`; app.applySettings(); } })),
    check('muted', 'Mute all sounds'),
    check('edgeScroll', 'Scroll when the mouse touches the screen edge'),
    check('autosave', `Autosave every ${CONFIG.AUTOSAVE_EVERY_MONTHS} months and when you leave the page`, 'Uses the "Autosave" slot in this browser\'s local storage.'),
    check('ambient', 'Ambient effects: drifting cloud shadows and birds', 'Purely decorative. Swaying trees and other small animations also turn off when your system asks for reduced motion.'),
    check('dayNight', 'Day and night', 'The sun sets every few minutes of game time and the city lights its lamps. Tool previews stay bright.'),
    check('seasons', 'Seasons', 'Grass and trees change color through the year: spring blossoms, autumn leaves, bare winter trees. Switched off, the map and the weather stay in summer (no snow); the calendar season still shows next to the date.'),
    check('weather', 'Weather: clouds, rain, snow and thunderstorms', 'Visual only, it never affects the city. Snow settles on the ground, trees and roofs (with Seasons on) and melts after. Falling rain and snow and lightning are not drawn when your system asks for reduced motion; snow on the ground still shows.'),
    check('showFps', 'Show performance counters (debug HUD)'),
    h('div', { class: 'field' }, h('label', {}, 'Theme'),
      h('select', { onchange: (e) => { s.theme = e.target.value; app.applySettings(); } },
        [['auto', 'Match system'], ['light', 'Marble (light)'], ['dark', 'Basalt (dark)']].map(([k, n]) => h('option', { value: k, selected: s.theme === k }, n)))),
  ], [h('button', { class: 'btn primary', onclick: () => app.ui.closeModal() }, 'Done')], 'narrow', () => app.ui.closeModal());
}

export function creditsMenu(app) {
  return modal('Credits', [
    h('p', {}, `${CONFIG.GAME_TITLE} is an original city builder inspired by the classic Roman city-building games of the late 1990s. All art is drawn procedurally in code, the sound effects and music are synthesized live (the music is composed as you play), and all text is original.`),
    h('p', {}, 'Developed with Claude (Anthropic) using Claude Code.'),
    h('p', {}, 'Roman gods, places and history belong to everyone.'),
    h('p', { class: 'muted' }, FOOTER),
  ], [h('button', { class: 'btn primary', onclick: () => app.ui.closeModal() }, 'Close')], 'narrow', () => app.ui.closeModal());
}

export function pauseMenu(app) {
  const g = app.game;
  const btn = (label, fn, cls = '') => h('button', { class: `btn ${cls}`, style: { display: 'block', width: '100%', margin: '6px 0' }, onclick: fn }, label);
  return modal('Game menu', [
    btn('Resume', () => app.ui.closeModal(), 'primary'),
    btn('Save game', () => app.ui.showModal(saveMenu(app))),
    btn('Load game', () => app.ui.showModal(loadMenu(app))),
    btn('Mission briefing', () => app.ui.showModal(briefing(app, g.scenario))),
    btn('Settings', () => app.ui.showModal(settingsMenu(app))),
    btn('How to play', () => app.ui.openHelp()),
    btn('Restart this map', () => app.ui.confirm('Restart this map from scratch? Progress since your last save is lost.', () => app.restart(), { yes: 'Restart', danger: true })),
    btn('Quit to main menu', () => app.ui.confirm('Quit to the main menu? Progress since your last save is lost (the autosave remains).', () => app.toMainMenu(), { yes: 'Quit', danger: true }), 'danger'),
  ], null, 'narrow', () => app.ui.closeModal());
}

// ---------------------------------------------------------------------------
// Outcome screens
// ---------------------------------------------------------------------------

export function victoryMenu(app) {
  const g = app.game;
  const idx = SCENARIOS.findIndex((s) => s.id === g.scenario.id);
  const next = idx >= 0 ? SCENARIOS[idx + 1] : null;
  return modal('Victory!', [
    h('p', {}, `The Senate is delighted with ${g.city.name}. You have met every goal of this mission.`),
    h('table', { class: 'tbl' }, goalStatus(g).map((r) => h('tr', {}, h('td', {}, r.label), h('td', { class: 'r num ok' }, `${fmt(r.have)} / ${fmt(r.need)}`)))),
    h('p', { class: 'muted' }, `Founded ${fmt(g.time.totalMonths / 12)} years ago · ${fmt(g.city.stats.fires)} fires · ${fmt(g.city.stats.collapses)} collapses`),
  ], [
    h('button', { class: 'btn', onclick: () => app.ui.closeModal() }, 'Keep building'),
    next ? h('button', { class: 'btn primary', onclick: () => { app.ui.closeModal(); app.ui.showModal(briefing(app, next, (d) => app.newScenario(next.id, d))); } }, `Next: ${next.name}`) : null,
    h('button', { class: 'btn', onclick: () => app.toMainMenu() }, 'Main menu'),
  ], 'narrow');
}

export function defeatMenu(app, reason) {
  return modal('Recalled to Rome', [
    h('p', {}, reason || 'Your governorship has ended.'),
    h('p', { class: 'muted' }, 'Tip: keep the treasury out of debt, fulfill the Emperor\'s requests and send gifts when favor runs low.'),
  ], [
    h('button', { class: 'btn', onclick: () => app.ui.showModal(loadMenu(app)) }, 'Load a save'),
    h('button', { class: 'btn', onclick: () => app.restart() }, 'Try again'),
    h('button', { class: 'btn primary', onclick: () => app.toMainMenu() }, 'Main menu'),
  ], 'narrow');
}

#!/usr/bin/env node
/**
 * sweep.mjs - the balance table: every difficulty on every campaign map
 * ----------------------------------------------------------------------------
 * Runs the headless simulation (scripts/simulate.mjs) with the level 3 demo
 * city, the yardstick for money: with piped water its homes climb past Huts
 * as a sensible player's do, and with --caretaker whatever burns or collapses
 * is rebuilt, as a player would. For each mission and difficulty it prints what
 * the city would have needed to start with to never owe (building plus the
 * running losses before it pays its way) against what the difficulty gives,
 * and how it was doing at the end (gods: blessings and wraths in the run).
 * Each difficulty has an intent (see
 * INTENT); read the margins against it.
 *
 * A map where the demo city could not pipe water (no shore in reach, or no
 * way for an aqueduct) is marked "no water": its homes stay Huts, so its
 * money says less about a sensible player's.
 *
 * Usage:
 *   npm run sweep                       all missions, all difficulties, 5 years
 *   npm run sweep -- --years 3 --missions c3,c4 --difficulties normal,insane
 *
 * Made with ❤️ from your friendly hacker - er2oneousbit
 * ----------------------------------------------------------------------------
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SCENARIOS } from '../src/data/scenarios.js';
import { DIFFICULTY_ORDER } from '../src/data/difficulty.js';

/** What each difficulty promises about money (the table is read against this). */
const INTENT = {
  easy: 'never short of money',
  normal: 'comfortable when played sensibly',
  hard: 'tight: mistakes cost',
  insane: 'barely enough for a sharp player',
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const years = Number(opt('years', 5));
const missions = opt('missions', SCENARIOS.map((s) => s.id).join(',')).split(',');
const difficulties = opt('difficulties', DIFFICULTY_ORDER.join(',')).split(',');

function run(mission, difficulty) {
  const out = execFileSync('node', [path.join(ROOT, 'scripts/simulate.mjs'), '--scenario', mission, '--difficulty', difficulty, '--years', String(years), '--level', '3', '--caretaker', '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  return JSON.parse(out.slice(out.lastIndexOf('\n{') + 1));
}

const pad = (v, n) => String(v).padStart(n);
console.log(`Balance sweep: level 3 demo city, ${years} years. Margin = what the difficulty gives - the most the city was ever out of pocket.`);
for (const d of difficulties) console.log(`  ${d.padEnd(7)} ${INTENT[d] || ''}`);
console.log('\n mission difficulty   funds    need  margin  debt  last yr/mo    pop  tier  mood  peace  fires  rebuilt  thieves  outbreaks  gods +/-  water');
for (const m of missions) {
  for (const d of difficulties) {
    const j = run(m, d);
    const mo = j.money;
    const water = j.water && j.water.fountains ? (j.water.wet === j.water.fountains ? 'yes' : j.water.wet ? 'part' : 'no water') : 'no water';
    console.log(` ${m.padEnd(7)} ${d.padEnd(10)} ${pad(mo.funds, 6)} ${pad(mo.need, 7)} ${pad(mo.margin, 7)} ${pad(mo.debtMonth ?? '-', 5)} ${pad(mo.lastYearMonthly, 10)} ${pad(j.population, 6)} ${pad(j.avgTier.toFixed(1), 5)} ${pad(j.sentiment, 5)} ${pad(Math.floor(j.ratings.peace), 6)} ${pad(j.stats.fires, 6)} ${pad(mo.rebuilt, 8)} ${pad(j.crime.thieves, 8)} ${pad(j.health.outbreaks, 10)} ${pad(j.gods ? `+${j.gods.blessings}/-${j.gods.wraths}` : '-', 9)}  ${water}`);
  }
}

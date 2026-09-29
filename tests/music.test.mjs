/**
 * music.test.mjs - headless tests for the music composer (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * The composer only writes notes (no audio), so it can be checked here:
 * repeatable for a seed, every note in its mode and its instrument's range,
 * events inside their bar, the form of each mood, cadences landing home,
 * melodies that mostly move by step, and each mood's character (danger is
 * fast with war drums, night is slow with none). The synthesized sound itself
 * is checked in the browser (tests/e2e/smoke.mjs and tests/e2e/music.html).
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Piece, MOODS, MODES, degreeToMidi, stableRoots, noteName, isChordTone } from '../src/audio/composer.js';

/**
 * Deterministic random numbers. The seed is scrambled first: with a plain
 * LCG, neighbouring small seeds give nearly the same first numbers, so every
 * test piece would get the same tempo and mode.
 */
function seeded(seed = 1) {
  let s = (Math.imul(seed ^ 0x9e3779b9, 2654435761) ^ (seed << 13)) >>> 0;
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let k = 0; k < 4; k++) next();
  return next;
}

/** Every bar of a whole piece. */
function playAll(piece) {
  const bars = [];
  let b;
  while ((b = piece.nextBar())) bars.push(b);
  return bars;
}

const pc = (midi) => ((midi % 12) + 12) % 12;

test('music: the same seed writes the same piece, another seed a different one', () => {
  const a = JSON.stringify(playAll(new Piece('day', seeded(5))));
  const b = JSON.stringify(playAll(new Piece('day', seeded(5))));
  const c = JSON.stringify(playAll(new Piece('day', seeded(6))));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('music: every pitched note is in the mode and in its instrument range', () => {
  for (const mood of Object.keys(MOODS)) {
    for (let seed = 1; seed <= 12; seed++) {
      const p = new Piece(mood, seeded(seed * 31 + mood.length));
      const inScale = new Set(p.scale.map((s) => pc(p.root + s)));
      for (const bar of playAll(p)) {
        for (const e of bar.events) {
          if (e.midi === undefined) continue;
          assert.ok(inScale.has(pc(e.midi)), `${p.name}: ${e.inst} ${noteName(e.midi)} not in ${p.modeName}`);
          const [lo, hi] = p.ranges[e.inst];
          assert.ok(e.midi >= lo && e.midi <= hi, `${p.name}: ${e.inst} ${e.midi} outside ${lo}..${hi}`);
        }
      }
    }
  }
});

test('music: events sit inside their bar, in order, with sane values', () => {
  for (const mood of Object.keys(MOODS)) {
    const p = new Piece(mood, seeded(77));
    for (const bar of playAll(p)) {
      let last = -1;
      for (const e of bar.events) {
        assert.ok(e.t >= 0 && e.t < bar.dur + 1e-9, `${mood}: event at ${e.t} in a ${bar.dur} s bar`);
        assert.ok(e.t >= last, 'sorted by time');
        last = e.t;
        assert.ok(e.dur > 0, 'positive duration');
        assert.ok(e.vel > 0 && e.vel <= 1, `velocity ${e.vel}`);
        assert.ok(e.pan >= -1 && e.pan <= 1, `pan ${e.pan}`);
      }
    }
  }
});

test('music: each mood follows its form, then the piece ends', () => {
  for (const mood of Object.keys(MOODS)) {
    const p = new Piece(mood, seeded(3));
    const bars = playAll(p);
    assert.equal(bars.length, p.bars, `${mood}: ${bars.length} bars`);
    const sections = [...new Set(bars.map((b) => b.section))];
    assert.deepEqual(sections, MOODS[mood].form);
    assert.equal(p.nextBar(), null, 'stays finished');
    assert.ok(p.duration > 15 && p.duration < 120, `${mood}: ${p.duration.toFixed(1)} s`);
  }
});

test('music: phrases come home to the tonic and pause on the fifth', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const p = new Piece('day', seeded(seed));
    const tonicPc = pc(p.tonic);
    const fifthPc = pc(degreeToMidi(p.tonic, p.scale, 4));
    const bySection = {};
    for (const bar of playAll(p)) {
      const lead = bar.events.filter((e) => e.inst === p.lead);
      if (lead.length) bySection[bar.section] = lead[lead.length - 1];
    }
    assert.equal(pc(bySection.A2.midi), tonicPc, `${p.name}: A2 ends on the tonic`);
    assert.equal(pc(bySection.A3.midi), tonicPc, `${p.name}: A3 ends on the tonic`);
    assert.equal(pc(bySection.A.midi), fifthPc, `${p.name}: A pauses on the fifth`);
  }
});

test('music: melodies move mostly by step (singable, not random)', () => {
  let steps = 0;
  let total = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const p = new Piece('menu', seeded(seed));
    let prev = null;
    for (const bar of playAll(p)) {
      for (const e of bar.events) {
        if (e.inst !== p.lead || e.grace) continue;
        if (prev !== null) {
          total++;
          if (Math.abs(e.midi - prev) <= 4) steps++; // up to a major third
        }
        prev = e.midi;
      }
    }
  }
  assert.ok(steps / total > 0.7, `${Math.round((steps / total) * 100)}% steps`);
});

test('music: danger is fast with war drums and horns; night is slow and drumless', () => {
  const danger = new Piece('danger', seeded(9));
  const night = new Piece('night', seeded(9));
  assert.ok(danger.bpm > night.bpm + 40);
  const count = (p, pred) => playAll(p).reduce((n, b) => n + b.events.filter(pred).length, 0);
  assert.ok(count(new Piece('danger', seeded(9)), (e) => e.inst === 'horn') > 0, 'horn calls');
  assert.equal(count(night, (e) => e.inst === 'drum'), 0, 'no drums at night');
  const dangerDrumsPerBar = count(new Piece('danger', seeded(9)), (e) => e.inst === 'drum') / danger.bars;
  const dayDrumsPerBar = count(new Piece('day', seeded(9)), (e) => e.inst === 'drum') / new Piece('day', seeded(9)).bars;
  assert.ok(dangerDrumsPerBar > dayDrumsPerBar * 1.5, `danger ${dangerDrumsPerBar.toFixed(1)} vs day ${dayDrumsPerBar.toFixed(1)} drum hits per bar`);
  assert.equal(MOODS.danger.gap[1], 0, 'no silence between battle pieces');
});

test('music: harmonies only use chords with a perfect fifth (safe under the drone)', () => {
  for (const [name, scale] of Object.entries(MODES)) {
    const roots = stableRoots(scale);
    for (const r of roots) assert.equal(degreeToMidi(0, scale, r + 4) - degreeToMidi(0, scale, r), 7, `${name} degree ${r}`);
    for (let seed = 1; seed <= 5; seed++) {
      for (const mood of Object.keys(MOODS)) {
        const p = new Piece(mood, seeded(seed));
        for (const sec of p.sections) for (const h of sec.harmony) assert.ok(p.stable.includes(h), `${p.name} harmony ${h}`);
      }
    }
  }
});

test('music: theory helpers', () => {
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(50), 'D3');
  assert.equal(degreeToMidi(62, MODES.dorian, 0), 62);
  assert.equal(degreeToMidi(62, MODES.dorian, 7), 74);
  assert.equal(degreeToMidi(62, MODES.dorian, -1), 60); // C below D in D dorian
  assert.ok(isChordTone(4, 0) && isChordTone(2, 0) && !isChordTone(1, 0));
  assert.deepEqual(stableRoots(MODES.dorian), [0, 1, 2, 3, 4, 6]);
});

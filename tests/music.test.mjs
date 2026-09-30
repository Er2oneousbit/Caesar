/**
 * music.test.mjs - headless tests for the music composer (node:test)
 * ----------------------------------------------------------------------------
 * Run:  npm test
 *
 * The composer only writes notes (no audio), so it can be checked here:
 * repeatable for a seed, every note in its mode and its instrument's range,
 * events inside their bar, the form of each mood (a few minutes long),
 * cadences landing home, melodies that mostly move by step, each mood's
 * character (danger is fast with war drums, night is slow with none), and
 * the track library: ten named tracks of a few minutes, the same every time,
 * each opening its own way, picked at random without repeating the last
 * few, winding down to their ending when the mood moves on. The synthesized
 * sound itself is checked in the browser (tests/e2e/smoke.mjs and
 * tests/e2e/music.html).
 * ----------------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Piece, MOODS, MODES, TRACKS, TRACK_MEMORY, INTRO_STYLES, degreeToMidi, stableRoots, noteName, isChordTone, pickTrack, tracksFor, seededRandom } from '../src/audio/composer.js';
import { nextPiece } from '../src/audio/music.js';

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

test('music: every mood plays pieces of a few minutes: an opening, rounds of sections, an ending', () => {
  const known = new Set(['intro', 'A', 'A2', 'A3', 'A4', 'B', 'B2', 'C', 'C2', 'interlude', 'outro']);
  for (const mood of Object.keys(MOODS)) {
    for (let seed = 1; seed <= 4; seed++) {
      const p = new Piece(mood, seeded(seed));
      const bars = playAll(p);
      assert.equal(bars.length, p.bars, `${mood}: ${bars.length} bars`);
      const names = p.sections.map((sec) => sec.name);
      assert.equal(names[0], 'intro');
      assert.equal(names[names.length - 1], MOODS[mood].outro ? 'outro' : names[names.length - 1]);
      for (const n of ['A', 'A2', 'B', 'A3']) assert.ok(names.includes(n), `${mood}: has ${n}`);
      assert.ok(names.every((n) => known.has(n)), names.join(' '));
      assert.equal(p.nextBar(), null, 'stays finished');
      assert.ok(p.duration >= 150 && p.duration <= 330, `${mood}: ${p.duration.toFixed(0)} s`);
    }
  }
  assert.ok(!MOODS.danger.outro, 'battle pieces follow each other without an ending');
});

test('music: ten named tracks for day, night and the menu, a few minutes each, in key and range', () => {
  assert.equal(TRACKS.length, 10);
  for (const key of ['id', 'title', 'seed']) assert.equal(new Set(TRACKS.map((t) => t[key])).size, TRACKS.length, `unique ${key}s`);
  for (const t of TRACKS) {
    assert.ok(t.moods.length && t.moods.every((m) => ['menu', 'day', 'night'].includes(m)), `${t.title}: ${t.moods}`);
    assert.ok(INTRO_STYLES.includes(t.intro), `${t.title}: opening ${t.intro}`);
    const p = new Piece(t.moods[0], seededRandom(t.seed), t);
    assert.ok(p.duration >= 180 && p.duration <= 320, `${t.title}: ${(p.duration / 60).toFixed(1)} min`);
    const inScale = new Set(p.scale.map((d) => pc(p.root + d)));
    for (const bar of playAll(p)) {
      for (const e of bar.events) {
        if (e.midi === undefined) continue;
        assert.ok(inScale.has(pc(e.midi)), `${t.title}: ${e.inst} ${noteName(e.midi)}`);
        const [lo, hi] = p.ranges[e.inst];
        assert.ok(e.midi >= lo && e.midi <= hi, `${t.title}: ${e.inst} ${e.midi} outside ${lo}..${hi}`);
      }
    }
  }
  for (const mood of ['menu', 'day', 'night']) assert.ok(tracksFor(mood).length >= 2, `${mood} has tracks`);
  assert.equal(tracksFor('danger').length + tracksFor('festival').length, 0, 'festivals and raids keep their own music');
});

test('music: a track sounds the same every time; tracks differ, and open differently', () => {
  const notes = (t) => JSON.stringify(playAll(new Piece(t.moods[0], seededRandom(t.seed), t)));
  for (const t of TRACKS.slice(0, 3)) assert.equal(notes(t), notes(t), t.title);
  // The opening: who plays in the first two bars, and the first notes.
  const opening = (t) => {
    const p = new Piece(t.moods[0], seededRandom(t.seed), t);
    const bars = [p.nextBar(), p.nextBar()];
    return JSON.stringify(bars.map((b) => b.events.map((e) => [e.inst, e.midi ?? e.kind, Math.round(e.t * 100)])));
  };
  const openings = TRACKS.map(opening);
  assert.equal(new Set(openings).size, TRACKS.length, 'no two tracks open alike');
  assert.ok(new Set(TRACKS.map((t) => t.intro)).size >= 5, 'at least five kinds of opening');
  // The kinds of opening do what they say.
  const who = (t, bar) => {
    const p = new Piece(t.moods[0], seededRandom(t.seed), t);
    let b;
    for (let k = 0; k <= bar; k++) b = p.nextBar();
    return new Set(b.events.map((e) => e.inst));
  };
  const byIntro = (s) => TRACKS.find((t) => t.intro === s);
  assert.deepEqual([...who(byIntro('pipe'), 0)], [byIntro('pipe').lead], 'the pipe alone');
  assert.deepEqual([...who(byIntro('lyre'), 0)], ['lyre'], 'the lyre alone');
  assert.deepEqual([...who(byIntro('drums'), 0)], ['drum'], 'the drums first');
  assert.ok(who(byIntro('drums'), 2).has('lyre'), 'then the lyre joins');
  assert.deepEqual([...who(byIntro('drone'), 0)], ['pad'], 'the drone alone');
});

test('music: C sections hand the tune to the other pipe', () => {
  const t = TRACKS.find((x) => x.lead === 'aulos');
  const p = new Piece(t.moods[0], seededRandom(t.seed), t);
  assert.equal(p.lead2, 'syrinx');
  const leads = {};
  for (const bar of playAll(p)) {
    for (const e of bar.events) if (e.inst === 'aulos' || e.inst === 'syrinx') (leads[bar.section] ||= new Set()).add(e.inst);
  }
  assert.deepEqual([...leads.C], ['syrinx']);
  assert.deepEqual([...leads.A], ['aulos']);
});

test('music: tracks come in random order, never one of the last few', () => {
  const rng = seeded(42);
  for (const mood of ['day', 'night', 'menu']) {
    const pool = tracksFor(mood).map((t) => t.id);
    const recent = [];
    const played = [];
    for (let k = 0; k < 40; k++) {
      const p = nextPiece(mood, recent, rng);
      assert.ok(p.track && pool.includes(p.track.id), `${mood}: ${p.track?.id}`);
      played.push(p.track.id);
    }
    const memory = Math.min(TRACK_MEMORY, pool.length - 1);
    for (let k = 1; k < played.length; k++) {
      for (let back = 1; back <= memory; back++) assert.notEqual(played[k], played[k - back], `${mood}: ${played[k]} again after ${back}`);
    }
    assert.equal(new Set(played).size, pool.length, `${mood}: every track plays`);
  }
  // A track asked for during a raid still plays as itself: no horns, same notes.
  const day = TRACKS.find((x) => x.id === 'prima-lux');
  const inRaid = nextPiece('danger', [], rng, day);
  assert.equal(inRaid.mood, 'day');
  assert.equal(JSON.stringify(playAll(inRaid)), JSON.stringify(playAll(new Piece('day', seededRandom(day.seed), day))));
  assert.equal(pickTrack('danger', [], rng), null);
  const battle = nextPiece('danger', [], rng);
  assert.equal(battle.track, null, 'a new battle piece each time');
});

test('music: when the mood moves on, a piece finishes its phrase and plays its ending', () => {
  const t = TRACKS.find((x) => x.id === 'prima-lux');
  const p = new Piece('day', seededRandom(t.seed), t);
  for (let k = 0; k < 9; k++) p.nextBar(); // into the second section
  const at = p.sectionIndex;
  const left = p.sections[at].bars - p.barInSection;
  p.windDown();
  assert.deepEqual(p.sections.slice(at).map((sec) => sec.name), [p.sections[at].name, 'outro']);
  let n = 0;
  let last;
  let b;
  while ((b = p.nextBar())) { n++; last = b; }
  assert.equal(n, left + 2, 'the rest of the phrase, then the 2-bar ending');
  assert.equal(last.section, 'outro');
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

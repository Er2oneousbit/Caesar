/**
 * composer.js
 * ----------------------------------------------------------------------------
 * Generative music: this module WRITES the notes, music.js plays them.
 * Pure and deterministic for a given random source, so node tests can check
 * the output without any audio hardware.
 *
 * How a piece is built (all original, from plain modal music theory):
 *
 *   mood      what the music is for (menu, day, night, danger, festival):
 *             tempo range, meters, modes, keys, lead instrument, drum and
 *             lyre styles, how long the silence after a piece lasts
 *   mode      a seven-note scale (dorian, phrygian...). Pitches are written
 *             as scale DEGREES (0 = tonic, 7 = tonic an octave up, -1 = the
 *             note below the tonic) and turned into MIDI notes at the end.
 *   form      an opening (intro), then ROUNDS of 4-bar sections (A, A2, B,
 *             A3, C, C2, interlude, B2, A4) repeated until the piece reaches
 *             the mood's target length (a few minutes), then an ending
 *             (outro; battle music has none, the next piece follows on).
 *             Each section has a harmony every two bars (a chord root degree
 *             with a perfect fifth above it).
 *   opening   who starts, one of INTRO_STYLES: the lyre alone, a drone and
 *             a pipe call, the drums building up, the pipe alone, a slow
 *             swell, or the whole band.
 *   theme     a one-bar motif (rhythm + melody) that returns in every A
 *             section, varied: moved up or down the scale, ornamented, and
 *             answered by new bars. B sections bring a new idea higher up;
 *             C sections a calmer one, lower down, on the other pipe with a
 *             thinner accompaniment; an interlude leaves the lyre alone.
 *   parts     lead melody (reed pipe or pan flute), lyre arpeggios, a low
 *             drone, frame drums, horn calls (danger), jingles (festival).
 *   tracks    TRACKS: ten pieces with names, each written from a fixed seed
 *             with its own key, tempo, meter, instruments and opening, so a
 *             track sounds the same whenever it plays. Day, night and the
 *             menu play tracks; festivals and battles get new pieces of
 *             their own each time.
 *
 * Melody rules that keep generated tunes musical: mostly stepwise motion,
 * notes on strong beats and long notes land on chord tones, phrases end on
 * the tonic (full cadence) or the fifth (half cadence).
 *
 * Output of Piece.nextBar(): { dur, events }, event times relative to the
 * bar start in seconds:
 *   { t, dur, inst, midi, vel (0..1), pan (-1..1), kind (drums: 'dum'|'tek') }
 * ----------------------------------------------------------------------------
 */

/** Scales as semitones above the tonic. */
export const MODES = Object.freeze({
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  hijaz: [0, 1, 4, 5, 7, 8, 10], // "phrygian dominant": tense, eastern-sounding
  lydian: [0, 2, 4, 6, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
});

/**
 * Chord progressions (harmony root degrees, one per two bars) that suit each
 * mode, for 4-bar sections: [first half, second half].
 */
const PROGRESSIONS = {
  dorian: { A: [[0, 3], [0, 6], [0, 2]], B: [[3, 6], [2, 3], [6, 3]] },
  phrygian: { A: [[0, 1], [0, 6], [0, 3]], B: [[1, 0], [6, 1], [3, 1]] },
  mixolydian: { A: [[0, 6], [0, 3], [0, 4]], B: [[3, 6], [6, 3], [4, 6]] },
  aeolian: { A: [[0, 5], [0, 6], [0, 3]], B: [[5, 6], [3, 6], [2, 6]] },
  hijaz: { A: [[0, 1], [0, 6], [0, 3]], B: [[1, 0], [3, 1], [6, 1]] },
  lydian: { A: [[0, 1], [0, 4], [0, 1]], B: [[1, 4], [4, 1], [2, 1]] },
  ionian: { A: [[0, 3], [0, 4], [0, 5]], B: [[3, 4], [5, 3], [3, 4]] },
};

/**
 * What each mood sounds like. Tempo is in quarter-note beats per minute;
 * `target` is roughly how long a piece runs (seconds), `rounds` which
 * ROUNDS it repeats, `intro` its usual opening (tracks bring their own) and
 * `gap` the silence after it.
 */
export const MOODS = Object.freeze({
  menu: {
    tempo: [70, 78], meters: [8], modes: ['dorian', 'aeolian'], roots: [50, 52],
    leads: ['aulos'], arps: ['broken', 'walk'], drums: 'soft', horn: false, jingles: false,
    gap: [3, 6], density: 0.8, intro: 'swell', rounds: 'calm', target: 190, outro: true,
  },
  day: {
    tempo: [86, 102], meters: [8, 6], modes: ['mixolydian', 'dorian', 'ionian'], roots: [50, 53, 55],
    leads: ['aulos', 'syrinx'], arps: ['broken', 'walk'], drums: 'light', horn: false, jingles: false,
    gap: [6, 14], density: 1, intro: 'full', rounds: 'calm', target: 200, outro: true,
  },
  night: {
    tempo: [58, 68], meters: [8, 6], modes: ['dorian', 'aeolian'], roots: [50, 52, 48],
    leads: ['syrinx'], arps: ['sparse'], drums: 'none', horn: false, jingles: false,
    gap: [8, 18], density: 0.55, intro: 'drone', rounds: 'calm', target: 220, outro: true,
  },
  danger: {
    tempo: [118, 132], meters: [8], modes: ['phrygian', 'hijaz'], roots: [45, 47, 50],
    leads: ['aulos'], arps: ['drive'], drums: 'war', horn: true, jingles: false,
    gap: [0, 0], density: 1.2, intro: 'full', rounds: 'battle', target: 160, outro: false,
  },
  festival: {
    tempo: [106, 118], meters: [6, 8], modes: ['lydian', 'mixolydian'], roots: [53, 55],
    leads: ['aulos'], arps: ['broken'], drums: 'dance', horn: false, jingles: true,
    gap: [4, 8], density: 1.2, intro: 'full', rounds: 'festive', target: 160, outro: true,
  },
});

/** Playable MIDI ranges per instrument (kept inside when writing notes). */
export const RANGES = Object.freeze({
  aulos: [55, 81],
  syrinx: [60, 86],
  lyre: [43, 69], // kept under the melody so the tune stays clear
  pad: [31, 57],
  horn: [36, 57],
});

/** Section lengths in bars (the intro's depends on its style: INTRO_BARS). */
const SECTION_BARS = { A: 4, A2: 4, A3: 4, A4: 4, B: 4, B2: 4, C: 4, C2: 4, interlude: 4, outro: 2 };

/**
 * How a piece opens (see Piece.texture):
 *   full    the whole band softly: drone, a sparse lyre, soft drums
 *   lyre    the lyre's arpeggio alone
 *   drone   the drone alone, then a slow pipe call from the fifth to the tonic
 *   drums   two bars of drums, then the drone and the lyre join them
 *   pipe    the pipe alone plays the theme and answers it
 *   swell   the drone and a sparse lyre, growing from quiet to full
 */
export const INTRO_STYLES = Object.freeze(['full', 'lyre', 'drone', 'drums', 'pipe', 'swell']);
const INTRO_BARS = { full: 2, lyre: 2, drone: 2, drums: 4, pipe: 2, swell: 4 };

/**
 * Rounds of sections a piece repeats, in turn, until it is long enough:
 * the theme (A), a higher answer (B), a calmer contrast on the other pipe
 * (C) and, in calm music, the lyre alone (interlude). Every round ends on a
 * section that comes home to the tonic.
 */
const ROUNDS = {
  calm: [['A', 'A2', 'B', 'A3'], ['C', 'C2', 'interlude', 'A2', 'B2', 'A4'], ['A', 'B', 'A3'], ['C', 'A2', 'B2', 'A4']],
  festive: [['A', 'A2', 'B', 'A3'], ['C', 'C2', 'A2', 'B2', 'A4'], ['A', 'B', 'A3']],
  battle: [['A', 'A2', 'B', 'B2', 'A3'], ['C', 'C2', 'A2', 'B2', 'A4']],
};

/** The lyre's pattern in C sections: a change of texture from the rest. */
const CONTRAST_ARP = { broken: 'walk', walk: 'broken', sparse: 'walk', drive: 'drive' };

/**
 * The track library: day, night and the menu play these, picked at random
 * (never one of the last few). Each is written from its seed, so it sounds
 * the same every time: its key (root, MIDI), mode, tempo, meter (eighths
 * per bar), pipes, lyre pattern, drums, opening and length are fixed here,
 * and the tune comes from the seed. Titles are Latin: first light, morning
 * in the forum, the new road, living waters, harvest, the household gods,
 * evening, calm night, stars.
 */
export const TRACKS = Object.freeze([
  { id: 'colonia', title: 'Colonia', moods: ['menu', 'day'], seed: 'colonia', bpm: 74, meter: 8, mode: 'dorian', root: 50, lead: 'aulos', arp: 'broken', drums: 'soft', intro: 'swell', density: 0.8, target: 190 },
  { id: 'prima-lux', title: 'Prima Lux', moods: ['day'], seed: 'prima-lux', bpm: 92, meter: 6, mode: 'mixolydian', root: 55, lead: 'syrinx', arp: 'broken', drums: 'light', intro: 'lyre', target: 200 },
  { id: 'mane-in-foro', title: 'Mane in Foro', moods: ['day'], seed: 'mane-in-foro', bpm: 100, meter: 8, mode: 'ionian', root: 53, lead: 'aulos', arp: 'walk', drums: 'light', intro: 'drums', target: 190 },
  { id: 'via-nova', title: 'Via Nova', moods: ['day'], seed: 'via-nova', bpm: 88, meter: 8, mode: 'dorian', root: 52, lead: 'aulos', arp: 'broken', drums: 'light', intro: 'drone', target: 210 },
  { id: 'aquae-vivae', title: 'Aquae Vivae', moods: ['day'], seed: 'aquae-vivae', bpm: 96, meter: 6, mode: 'lydian', root: 50, lead: 'syrinx', arp: 'broken', drums: 'light', intro: 'pipe', target: 200 },
  { id: 'messis', title: 'Messis', moods: ['day'], seed: 'messis', bpm: 104, meter: 6, mode: 'mixolydian', root: 53, lead: 'aulos', arp: 'walk', drums: 'light', intro: 'full', density: 1.1, target: 190 },
  { id: 'lares', title: 'Lares', moods: ['day', 'night'], seed: 'lares', bpm: 70, meter: 8, mode: 'aeolian', root: 48, lead: 'syrinx', arp: 'walk', drums: 'soft', intro: 'lyre', density: 0.7, target: 220 },
  { id: 'vesper', title: 'Vesper', moods: ['menu', 'night'], seed: 'vesper', bpm: 64, meter: 8, mode: 'aeolian', root: 52, lead: 'syrinx', arp: 'sparse', drums: 'none', intro: 'drone', density: 0.55, target: 230 },
  { id: 'nox-serena', title: 'Nox Serena', moods: ['night'], seed: 'nox-serena', bpm: 60, meter: 6, mode: 'dorian', root: 50, lead: 'syrinx', arp: 'sparse', drums: 'none', intro: 'pipe', density: 0.55, target: 230 },
  { id: 'stellae', title: 'Stellae', moods: ['night'], seed: 'stellae', bpm: 62, meter: 8, mode: 'dorian', root: 48, lead: 'syrinx', arp: 'broken', drums: 'none', intro: 'swell', density: 0.6, target: 230 },
]);

/** How many of the last tracks are not played again for now. */
export const TRACK_MEMORY = 3;

/** The tracks for a mood (none for festivals and battles). */
export function tracksFor(mood) {
  return TRACKS.filter((t) => t.moods.includes(mood));
}

/**
 * Pick the next track for a mood at random, never one of `recent` (the ids
 * last played) while any other is left; null when the mood has no tracks.
 */
export function pickTrack(mood, recent, rng = Math.random) {
  const pool = tracksFor(mood);
  if (!pool.length) return null;
  let fresh = pool.filter((t) => !recent.includes(t.id));
  if (!fresh.length) fresh = pool.filter((t) => t.id !== recent[recent.length - 1]);
  if (!fresh.length) fresh = pool;
  return fresh[Math.floor(rng() * fresh.length) % fresh.length];
}

/**
 * A repeatable random source from a string (a track's seed): FNV-1a hash,
 * then mulberry32. Music only: the simulation has its own RNG.
 */
export function seededRandom(seed) {
  let h = 0x811c9dc5;
  const str = String(seed);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Melody rhythms: note lengths in eighth notes that fill one bar; a
 * negative length is a rest (the player takes a breath). The last lists are
 * for cadences (ending on a long note).
 */
const RHYTHMS = {
  8: {
    normal: [[2, 2, 2, 2], [3, 1, 2, 2], [1, 1, 2, 2, 2], [2, 1, 1, 4], [4, 2, 2], [1, 1, 1, 1, 4], [3, 3, 2], [2, 2, 4], [2, 1, 1, 2, 2], [-2, 2, 2, 2], [-1, 1, 2, 4], [2, 2, -2, 2]],
    calm: [[4, 4], [2, 6], [3, 1, 4], [8], [2, 2, 4], [6, 2], [-2, 2, 4], [4, -2, 2]],
    cadence: [[2, 2, 4], [4, 4], [2, 6], [3, 1, 4], [8]],
  },
  6: {
    normal: [[3, 3], [2, 1, 3], [1, 1, 1, 3], [3, 1, 1, 1], [2, 1, 2, 1], [1, 2, 3], [-1, 2, 3], [3, -1, 2]],
    calm: [[6], [3, 3], [2, 1, 3], [4, 2], [-3, 3]],
    cadence: [[3, 3], [6], [2, 1, 3]],
  },
};

/**
 * Lyre accompaniment: chord-tone index per eighth-note slot (null = rest).
 * Chord tones: 0 root, 1 third, 2 fifth, 3 octave, 4 tenth.
 */
const ARPS = {
  8: {
    broken: [0, 2, 3, 2, 1, 2, 3, 2],
    walk: [0, null, 2, null, 3, null, 2, 1],
    sparse: [0, null, null, 2, null, null, 3, null],
    drive: [0, 0, 2, 0, 3, 0, 2, 0],
  },
  6: {
    broken: [0, 2, 3, 1, 3, 2],
    walk: [0, null, 2, 3, null, 2],
    sparse: [0, null, null, 2, null, 3],
    drive: [0, 0, 2, 0, 3, 2],
  },
};

/** Frame drum patterns per eighth slot: 'D' low stroke, 't' rim stroke, '.' rest. */
const DRUMS = {
  8: { soft: 'D.....t.', light: 'D..tD.t.', war: 'DDtDDtDt', dance: 'D.ttD.tt' },
  6: { soft: 'D.....', light: 'D..t.t', war: 'DDtDtt', dance: 'D.tDtt' },
};

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** "D3" for MIDI 50. */
export function noteName(midi) {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Scale degree -> MIDI note, for a tonic MIDI note and a mode. */
export function degreeToMidi(tonic, scale, degree) {
  const oct = Math.floor(degree / 7);
  const d = degree - oct * 7;
  return tonic + scale[d] + oct * 12;
}

/** Is this degree a chord tone (root, third or fifth) of the harmony on `root`? */
export function isChordTone(degree, root) {
  const rel = ((((degree - root) % 7) + 7) % 7);
  return rel === 0 || rel === 2 || rel === 4;
}

/** Harmony roots that have a perfect fifth above them in this mode. */
export function stableRoots(scale) {
  const out = [];
  for (let d = 0; d < 7; d++) if (degreeToMidi(0, scale, d + 4) - degreeToMidi(0, scale, d) === 7) out.push(d);
  return out;
}

// ---------------------------------------------------------------------------
// Small random helpers (all take the piece's random source)
// ---------------------------------------------------------------------------

const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];
const between = (rng, a, b) => a + (b - a) * rng();

/** Pick from [[value, weight], ...]. */
function weighted(rng, pairs) {
  let total = 0;
  for (const [, w] of pairs) total += w;
  let r = rng() * total;
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
}

/** Nearest chord tone of `root` to `degree` (prefers going down on ties). */
function nearestChordTone(degree, root) {
  for (let off = 0; off < 4; off++) {
    if (isChordTone(degree - off, root)) return degree - off;
    if (isChordTone(degree + off, root)) return degree + off;
  }
  return degree;
}

// ---------------------------------------------------------------------------
// Melody writing
// ---------------------------------------------------------------------------

/** Default melody window in scale degrees around the tonic (a piece may narrow it). */
const LOW = -3;
const HIGH = 9;

/**
 * One bar of melody: a rhythm and a degree for each note.
 * @param {() => number} rng
 * @param {number[]} rhythm   note lengths in eighths (sum = bar length)
 * @param {number} harmony    chord root degree under this bar
 * @param {number} start      first degree (snapped to a chord tone)
 * @param {number|null} end   degree the bar must end on (cadence), or null
 * @param {number} slots      eighths per bar (8 or 6)
 * @param {number} [low]      lowest degree allowed
 * @param {number} [high]     highest degree allowed
 */
export function melodyBar(rng, rhythm, harmony, start, end, slots, low = LOW, high = HIGH) {
  const notes = [];
  let pos = 0;
  let deg = clampChord(start, harmony, low, high);
  let dir = rng() < 0.5 ? 1 : -1; // current direction: melodies move in arcs
  // The cadence note in the octave nearest to where the tune is.
  const goal = (from) => [end - 7, end, end + 7].filter((d) => d >= low && d <= high).sort((a, b) => Math.abs(a - from) - Math.abs(b - from))[0] ?? end;
  let first = true;
  for (let i = 0; i < rhythm.length; i++) {
    if (rhythm[i] < 0) { pos -= rhythm[i]; continue; } // a rest
    const len = rhythm[i];
    const last = i === rhythm.length - 1;
    if (last && end !== null) {
      // The cadence note, even when it is the bar's only note.
      deg = goal(deg);
    } else if (!first) {
      // Mostly steps, some small leaps, rarely a bigger one.
      const step = weighted(rng, [[0, 0.1], [1, 0.55], [2, 0.25], [3, 0.07], [4, 0.03]]);
      if (rng() < 0.25) dir = -dir;
      // Heading for a cadence: turn toward it for the last notes.
      if (end !== null && i >= rhythm.length - 2) dir = Math.sign(goal(deg) - deg) || dir;
      deg += step * dir;
      if (deg > high) { deg = high - 1; dir = -1; }
      if (deg < low) { deg = low + 1; dir = 1; }
      // Strong beats and long notes sit on the harmony.
      const strong = pos % (slots === 6 ? 3 : 4) === 0;
      if (strong || len >= 3) deg = clampChord(deg, harmony, low, high);
    }
    notes.push({ pos, len, deg });
    pos += len;
    first = false;
  }
  return notes;
}

/** Nearest chord tone inside [low, high]. */
function clampChord(deg, harmony, low, high) {
  let d = nearestChordTone(Math.max(low, Math.min(high, deg)), harmony);
  while (d > high) d -= 7;
  while (d < low) d += 7;
  return d;
}

/** A motif moved up or down the scale (a "sequence"), kept in range. */
function shiftMotif(motif, steps, harmony, low = LOW, high = HIGH) {
  return motif.map((n, i) => {
    let deg = Math.max(low, Math.min(high, n.deg + steps));
    if (i === 0 || n.len >= 3) deg = clampChord(deg, harmony, low, high);
    return { ...n, deg };
  });
}

/** Add a quick upper grace note before long notes (the last A section). */
function ornament(bar, high = HIGH) {
  const out = [];
  for (const n of bar) {
    if (n.len >= 3 && n.deg < high) {
      out.push({ pos: n.pos, len: 0.5, deg: n.deg + 1, grace: true });
      out.push({ pos: n.pos + 0.5, len: n.len - 0.5, deg: n.deg });
    } else out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// A piece
// ---------------------------------------------------------------------------

export class Piece {
  /**
   * @param {string} mood  key of MOODS
   * @param {() => number} [rng] random source in [0, 1)
   * @param {object} [track] an entry of TRACKS: fixes the key, tempo, meter,
   *        mode, instruments, opening and length (pass seededRandom(track.seed)
   *        as `rng` and the whole track comes out the same every time)
   */
  constructor(mood, rng = Math.random, track = null) {
    this.mood = MOODS[mood] ? mood : 'day';
    const m = MOODS[this.mood];
    const t = track || {};
    this.track = track;
    this.rng = rng;
    this.bpm = t.bpm ?? Math.round(between(rng, m.tempo[0], m.tempo[1]));
    this.eighth = 30 / this.bpm; // seconds per eighth note
    this.slots = t.meter ?? pick(rng, m.meters); // eighths per bar: 8 (4/4) or 6 (6/8)
    this.modeName = t.mode ?? pick(rng, m.modes);
    this.scale = MODES[this.modeName];
    this.root = t.root ?? pick(rng, m.roots); // tonic in the bass octave (MIDI)
    this.tonic = this.root + 12; // the melody's tonic
    this.lead = t.lead ?? pick(rng, m.leads);
    // The other pipe carries the contrasting C sections.
    this.lead2 = t.lead2 ?? (this.lead === 'aulos' ? 'syrinx' : 'aulos');
    [this.low, this.high] = this.window(this.lead);
    [this.low2, this.high2] = this.window(this.lead2);
    this.arp = t.arp ?? pick(rng, m.arps);
    // Accompaniment sits under the tune: the lyre stops a little above the melody's tonic.
    this.ranges = { ...RANGES, lyre: [RANGES.lyre[0], Math.min(RANGES.lyre[1], this.tonic + 3)] };
    this.cfg = { ...m, drums: t.drums ?? m.drums, density: t.density ?? m.density };
    this.introStyle = t.intro ?? m.intro;
    this.target = t.target ?? m.target;
    this.stable = stableRoots(this.scale);
    // The theme: a one-bar motif that returns in the A sections.
    this.theme = melodyBar(rng, this.rhythm('normal'), 0, pick(rng, [0, 2, 4]), null, this.slots, this.low, this.high);
    // Form: an opening, rounds of sections until the piece is long enough, an ending.
    this.sections = this.buildForm();
    this.bars = this.sections.reduce((s, sec) => s + sec.bars, 0);
    this.sectionIndex = 0;
    this.barInSection = 0;
    this.barCount = 0;
    this.melody = null; // bars of the current section's melody
  }

  /** Melody window (scale degrees) whose notes an instrument can actually play. */
  window(inst) {
    const [lo, hi] = RANGES[inst];
    let low = LOW;
    while (degreeToMidi(this.tonic, this.scale, low) < lo) low++;
    let high = HIGH;
    while (degreeToMidi(this.tonic, this.scale, high) > hi) high--;
    return [low, high];
  }

  /** Human-readable summary, for the console and debugging. */
  get name() {
    const what = this.track ? this.track.title : this.mood;
    return `${what}: ${noteName(this.root).replace(/\d+$/, '')} ${this.modeName}, ${this.bpm} bpm, ${this.slots === 6 ? '6/8' : '4/4'}, ${this.lead}`;
  }

  /** Seconds per bar. */
  get barDur() { return this.slots * this.eighth; }

  /** Total length of the piece in seconds (without the silence after it). */
  get duration() { return this.bars * this.barDur; }

  /** Silence to leave after this piece (seconds). */
  gapAfter() { return between(this.rng, this.cfg.gap[0], this.cfg.gap[1]); }

  rhythm(kind) {
    const table = RHYTHMS[this.slots];
    const calm = this.cfg.density < 0.8;
    return pick(this.rng, kind === 'cadence' ? table.cadence : calm && kind === 'normal' ? table.calm : table[kind]);
  }

  /**
   * The sections: the opening, then rounds (ROUNDS[cfg.rounds], in turn,
   * repeating) until the piece reaches its target length, then the ending
   * (battle music has none: the next piece follows straight on).
   */
  buildForm() {
    const rounds = ROUNDS[this.cfg.rounds] || ROUNDS.calm;
    const sections = [this.planSection('intro')];
    let bars = sections[0].bars + (this.cfg.outro ? SECTION_BARS.outro : 0);
    for (let r = 0; r < 12 && bars * this.barDur < this.target; r++) {
      for (const name of rounds[r % rounds.length]) {
        const sec = this.planSection(name);
        sections.push(sec);
        bars += sec.bars;
      }
    }
    if (this.cfg.outro) sections.push(this.planSection('outro'));
    return sections;
  }

  /** A section: its length, its harmony (a chord root per bar) and the pipe that leads it. */
  planSection(name) {
    const bars = name === 'intro' ? INTRO_BARS[this.introStyle] || 2 : SECTION_BARS[name] || 4;
    const prog = PROGRESSIONS[this.modeName] || PROGRESSIONS.dorian;
    let pair = [0, 0];
    if (name.startsWith('A') || name === 'interlude') pair = pick(this.rng, prog.A);
    else if (name.startsWith('B') || name.startsWith('C')) pair = pick(this.rng, prog.B);
    // Only chords with a perfect fifth (safe under a drone).
    const safe = pair.map((d) => (this.stable.includes(d) ? d : 0));
    const harmony = [];
    for (let b = 0; b < bars; b++) harmony.push(name === 'intro' || name === 'outro' ? 0 : safe[b < bars / 2 ? 0 : 1]);
    return { name, bars, harmony, lead: name.startsWith('C') ? this.lead2 : this.lead };
  }

  /**
   * Wrap up early: finish the section playing (or about to), then the ending.
   * Used when the game's mood moves on: a track is never cut off mid-phrase.
   */
  windDown() {
    const cur = this.sections[this.sectionIndex];
    if (!cur || cur.name === 'outro') return;
    this.sections = [...this.sections.slice(0, this.sectionIndex + 1), this.planSection('outro')];
    this.bars = this.sections.reduce((s, sec) => s + sec.bars, 0);
  }

  /** Write the melody bars for a section when it starts. */
  writeMelody(sec) {
    const rng = this.rng;
    const h = sec.harmony;
    const { low, high, slots } = this;
    const bar = (kind, harmony, start, end = null, lo = low, hi = high) => melodyBar(rng, this.rhythm(kind), harmony, start, end, slots, lo, hi);
    const shift = (motif, steps, harmony, lo = low, hi = high) => shiftMotif(motif, steps, harmony, lo, hi);
    const lastDeg = (b) => b[b.length - 1].deg;
    const bars = [];
    switch (sec.name) {
      case 'A': {
        bars.push(shift(this.theme, 0, h[0]));
        bars.push(bar('normal', h[1], lastDeg(bars[0])));
        bars.push(shift(this.theme, 0, h[2]));
        bars.push(bar('cadence', h[3], lastDeg(bars[2]), 4)); // half cadence, on the fifth
        break;
      }
      case 'A2': {
        const step = pick(rng, [1, -1, 2]);
        bars.push(shift(this.theme, step, h[0]));
        bars.push(bar('normal', h[1], lastDeg(bars[0])));
        bars.push(shift(this.theme, 0, h[2]));
        bars.push(bar('cadence', h[3], lastDeg(bars[2]), 0)); // home, on the tonic
        break;
      }
      case 'B':
      case 'B2': {
        // A new idea, higher up: starts from the fifth or the octave.
        const idea = bar('normal', h[0], pick(rng, [4, 7]));
        bars.push(idea);
        bars.push(bar('normal', h[1], lastDeg(idea)));
        bars.push(shift(idea, -1, h[2]));
        bars.push(bar('cadence', h[3], lastDeg(bars[2]), 4));
        break;
      }
      case 'C':
      case 'C2': {
        // The contrast: the other pipe, lower down and calmer, climbing by a
        // step on its return; C pauses on the fifth, C2 comes home.
        const lo = this.low2;
        const hi = Math.min(this.high2, 5);
        const idea = bar('calm', h[0], pick(rng, [0, 2]), null, lo, hi);
        bars.push(idea);
        bars.push(bar('normal', h[1], lastDeg(idea), null, lo, hi));
        bars.push(shift(idea, 1, h[2], lo, hi));
        bars.push(bar('cadence', h[3], lastDeg(bars[2]), sec.name === 'C' ? 4 : 0, lo, hi));
        break;
      }
      case 'A3':
      case 'A4': {
        bars.push(ornament(shift(this.theme, 0, h[0]), high));
        bars.push(bar('normal', h[1], lastDeg(bars[0])));
        bars.push(ornament(shift(this.theme, 0, h[2]), high));
        bars.push(bar('cadence', h[3], lastDeg(bars[2]), 0));
        break;
      }
      case 'intro': {
        for (let b = 0; b < sec.bars; b++) bars.push([]);
        if (this.introStyle === 'pipe') {
          // The pipe alone: the theme, answered, coming home.
          bars[0] = shift(this.theme, 0, 0);
          bars[1] = bar('cadence', 0, lastDeg(bars[0]), 0);
        } else if (this.introStyle === 'drone') {
          // Over the drone, a slow call from the fifth down to the tonic.
          bars[sec.bars - 1] = [{ pos: 0, len: slots / 2, deg: Math.min(4, high) }, { pos: slots / 2, len: slots / 2, deg: Math.max(low, 0) }];
        }
        break;
      }
      case 'outro': {
        // A last long tonic after the lyre winds down.
        bars.push([]);
        bars.push([{ pos: 0, len: slots, deg: Math.max(low, 0) }]);
        break;
      }
      default:
        for (let b = 0; b < sec.bars; b++) bars.push([]); // interlude: the lyre alone
    }
    return bars;
  }

  /** Fit a MIDI note into an instrument's range by octaves. */
  fit(midi, inst) {
    const [lo, hi] = this.ranges[inst];
    while (midi < lo) midi += 12;
    while (midi > hi) midi -= 12;
    return midi;
  }

  /** Small timing jitter (seconds) and velocity variation: sounds played, not typed. */
  human(vel) {
    return { dt: (this.rng() - 0.5) * 0.012, vel: Math.max(0.05, Math.min(1, vel * (0.9 + this.rng() * 0.2))) };
  }

  /**
   * Which parts play in this bar of this section, and how: the opening's
   * style decides who starts (see INTRO_STYLES), C sections thin the
   * texture, the interlude leaves the lyre on its own.
   */
  texture(sec, b) {
    const style = this.cfg.drums;
    // Openings and endings play the drums softly (battle drums stay), if at all.
    const soft = style === 'war' || style === 'none' ? style : 'soft';
    const out = { drone: true, lyre: true, arp: this.arp, strum: b === 0, drums: style, gain: 1 };
    if (sec.name === 'intro') {
      const s = this.introStyle;
      out.arp = this.arp === 'drive' ? 'drive' : 'sparse';
      out.drums = soft;
      if (s === 'lyre') { out.drone = false; out.arp = this.arp; out.drums = 'none'; }
      else if (s === 'drone') { out.lyre = false; out.strum = false; out.drums = 'none'; }
      else if (s === 'pipe') { out.drone = false; out.lyre = false; out.strum = false; out.drums = 'none'; }
      else if (s === 'swell') { out.drums = 'none'; out.gain = 0.45 + (0.55 * b) / Math.max(1, sec.bars - 1); }
      else if (s === 'drums') {
        out.drums = style === 'none' ? 'soft' : style;
        out.arp = this.arp;
        if (b < 2) { out.drone = false; out.lyre = false; out.strum = false; }
      }
    } else if (sec.name === 'outro') {
      out.arp = this.arp === 'drive' ? 'drive' : 'sparse';
      out.drums = soft;
    } else if (sec.name === 'interlude') {
      out.drums = 'none';
      out.arp = this.arp === 'sparse' ? 'walk' : this.arp;
    } else if (sec.name.startsWith('C')) {
      out.arp = CONTRAST_ARP[this.arp] || this.arp;
      if (style === 'light' || style === 'dance') out.drums = 'soft';
    }
    return out;
  }

  /**
   * Write the next bar.
   * @returns {{dur:number, events:Array, section:string}|null} null when the piece is over
   */
  nextBar() {
    const sec = this.sections[this.sectionIndex];
    if (!sec) return null;
    if (this.barInSection === 0) this.melody = this.writeMelody(sec);
    const b = this.barInSection;
    const harmony = sec.harmony[b];
    const e = this.eighth;
    const slots = this.slots;
    const events = [];
    const quiet = sec.name === 'intro' || sec.name === 'outro';
    const lastBarOfPiece = this.sectionIndex === this.sections.length - 1 && b === sec.bars - 1;
    const tx = this.texture(sec, b);

    // Drone: root and fifth, held for the harmony (two bars), from the first bar of each pair.
    if (tx.drone && (b % 2 === 0 || !this.texture(sec, b - 1).drone)) {
      const hold = Math.min(b % 2 === 0 ? 2 : 1, sec.bars - b) * this.barDur;
      const r = this.fit(degreeToMidi(this.root - 12, this.scale, harmony), 'pad');
      const f = this.fit(degreeToMidi(this.root - 12, this.scale, harmony + 4), 'pad');
      events.push({ t: 0, dur: hold + 0.25, inst: 'pad', midi: r, vel: 0.5 * tx.gain, pan: -0.15 });
      events.push({ t: 0, dur: hold + 0.25, inst: 'pad', midi: f, vel: 0.35 * tx.gain, pan: 0.15 });
    }

    // Lyre: arpeggio of the harmony's chord tones.
    const chord = [harmony, harmony + 2, harmony + 4, harmony + 7, harmony + 9];
    if (tx.lyre) {
      const pattern = ARPS[slots][tx.arp];
      const loud = sec.name === 'interlude' ? 1.15 : quiet ? 0.8 : 1;
      for (let s = 0; s < slots; s++) {
        const idx = pattern[s];
        if (idx === null || idx === undefined) continue;
        if (lastBarOfPiece && s >= slots / 2) break; // let the last chord ring
        const midi = this.fit(degreeToMidi(this.root, this.scale, chord[idx]), 'lyre');
        const h = this.human(s === 0 ? 0.8 : 0.55);
        events.push({ t: Math.max(0, s * e + h.dt), dur: e * 3, inst: 'lyre', midi, vel: Math.min(1, h.vel * loud * tx.gain), pan: -0.35 + idx * 0.15 });
      }
    }
    // A strummed chord at the start of each section (and the end of the piece).
    if ((tx.strum && b === 0) || lastBarOfPiece) {
      [0, 2, 3, 4].forEach((idx, k) => {
        const midi = this.fit(degreeToMidi(this.root, this.scale, chord[idx]), 'lyre');
        events.push({ t: k * 0.028 + (lastBarOfPiece ? (slots / 2) * e : 0), dur: e * 6, inst: 'lyre', midi, vel: 0.5 * tx.gain, pan: -0.3 + k * 0.2 });
      });
    }

    // Lead melody (the section's pipe).
    const lead = sec.lead || this.lead;
    const bar = this.melody[b] || [];
    for (const n of bar) {
      const midi = this.fit(degreeToMidi(this.tonic, this.scale, n.deg), lead);
      const h = this.human(n.grace ? 0.45 : 0.72);
      events.push({ t: Math.max(0, n.pos * e + h.dt), dur: n.len * e * 0.95, inst: lead, midi, vel: h.vel, pan: 0.1, grace: !!n.grace });
    }

    // Frame drum.
    const style = tx.drums;
    if (style !== 'none' && !(sec.name === 'outro' && b > 0)) {
      const drum = DRUMS[slots][style];
      for (let s = 0; s < slots; s++) {
        const c = drum[s];
        if (c === '.') continue;
        const h = this.human(c === 'D' ? (s === 0 ? 0.85 : 0.6) : 0.4);
        events.push({ t: Math.max(0, s * e + h.dt), dur: 0.4, inst: 'drum', kind: c === 'D' ? 'dum' : 'tek', vel: h.vel * (style === 'war' ? 1 : 0.7), pan: c === 'D' ? 0 : 0.25 });
      }
      // A roll into the next section on the last bar of a section.
      if (style !== 'soft' && b === sec.bars - 1 && !lastBarOfPiece && !quiet) {
        for (let k = 0; k < 4; k++) events.push({ t: (slots - 2 + k * 0.5) * e, dur: 0.2, inst: 'drum', kind: 'tek', vel: 0.35 + k * 0.1, pan: 0.2 });
      }
    }

    // Horn calls (danger): at the start of each section.
    if (this.cfg.horn && b === 0 && !quiet) {
      const call = [[0, 0, 3], [3, 4, 2], [5, 0, 3]]; // [start eighth, degree, length]
      for (const [s, d, len] of call) {
        if (s >= slots) continue;
        const midi = this.fit(degreeToMidi(this.root, this.scale, d), 'horn');
        events.push({ t: s * e, dur: len * e, inst: 'horn', midi, vel: 0.7, pan: -0.2 });
      }
    }

    // Jingles (festival): on the off-beats.
    if (this.cfg.jingles && !quiet && sec.name !== 'interlude') {
      for (let s = 1; s < slots; s += 2) events.push({ t: s * e, dur: 0.15, inst: 'jingle', vel: 0.3 + this.rng() * 0.2, pan: 0.4 });
    }

    events.sort((x, y) => x.t - y.t);
    const out = { dur: this.barDur, events, section: sec.name, bar: this.barCount };
    // Advance.
    this.barCount++;
    this.barInSection++;
    if (this.barInSection >= sec.bars) {
      this.barInSection = 0;
      this.sectionIndex++;
    }
    return out;
  }
}

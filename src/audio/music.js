/**
 * music.js
 * ----------------------------------------------------------------------------
 * Background music: picks the mood, asks the composer for bars, and schedules
 * them on the instruments a little ahead of time.
 *
 * Scheduling: a timer wakes every 60 ms and writes every bar that starts
 * within the next half second, with exact AudioContext times, so timing
 * stays tight even when frames are slow ("look-ahead" scheduling). When the
 * tab is hidden the app suspends the audio context: time stops, nothing
 * piles up, and the music carries on where it was when the tab comes back.
 *
 * Moods (chosen by the app every frame from the game state):
 *   menu      the main menu
 *   day       building the city
 *   night     after dusk (with Day and night on)
 *   danger    raiders on the map
 *   festival  after a festival, and on victory
 * A new mood takes over at once: the playing piece fades out over a second
 * and a half and a new piece in the new mood starts on the next beat. Calm
 * moods leave some silence between pieces, as classic city builders do.
 *
 * Pieces are generated (composer.js), so the music never loops.
 * renderWav() plays a mood into an OfflineAudioContext for the console's
 * `music wav` and for the browser tests.
 * ----------------------------------------------------------------------------
 */

import { Piece, MOODS } from './composer.js';
import { Studio, Band } from './instruments.js';

const LOOKAHEAD = 0.5; // seconds of music scheduled ahead
const TICK_MS = 60;
const FADE = 1.5; // seconds to fade a piece out when the mood changes

export class Music {
  constructor() {
    this.ac = null;
    this.master = null; // volume
    this.studio = null;
    this.enabled = true;
    this.volume = 0.35;
    this.muted = false;
    this.mood = 'menu'; // mood being played
    this.wanted = 'menu'; // mood the game asks for
    this.forced = null; // console override
    this.piece = null;
    this.band = null;
    this.nextBar = 0; // audio time where the next bar starts
    this.gapUntil = 0; // silence between pieces until this audio time
    this.timer = null;
    this.nowPlaying = '';
    this.barsPlayed = 0;
    this.rng = Math.random;
  }

  /** True once the audio context exists and the scheduler runs. */
  get playing() { return !!this.timer && !!this.ac && this.ac.state === 'running' && this.level() > 0; }

  /** Output level for the current settings. */
  level() {
    return this.enabled && !this.muted ? this.volume * 0.8 : 0;
  }

  /**
   * Hook the music into the (shared) audio context. Called on the first
   * click or key press, because browsers only allow sound after one.
   */
  attach(ac) {
    if (this.ac || !ac) return;
    this.ac = ac;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    this.master = ac.createGain();
    this.master.gain.value = this.level();
    comp.connect(this.master).connect(ac.destination);
    this.studio = new Studio(ac, comp);
    this.start();
  }

  /** Start the scheduler (if the music is on). */
  start() {
    if (!this.ac || this.timer || this.level() <= 0) return;
    this.nextBar = this.ac.currentTime + 0.25;
    this.gapUntil = 0;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Stop scheduling and fade out what is playing. */
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.endPiece(0.6);
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0));
    this.applyLevel();
  }

  setEnabled(on) {
    this.enabled = !!on;
    this.applyLevel();
  }

  setMuted(m) {
    this.muted = !!m;
    this.applyLevel();
  }

  applyLevel() {
    if (!this.ac) return;
    const g = this.master.gain;
    const t = this.ac.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(this.level(), t + 0.3);
    if (this.level() > 0) this.start();
    else this.stop();
  }

  /** The mood the game wants now (the console can force one instead). */
  setMood(mood) {
    if (MOODS[mood]) this.wanted = mood;
  }

  /** Console: force a mood ('auto' gives control back to the game). */
  force(mood) {
    this.forced = mood === 'auto' || !MOODS[mood] ? null : mood;
  }

  /** Console: skip to a new piece now. */
  skip() {
    this.endPiece(0.8);
    this.gapUntil = 0;
    if (this.ac) this.nextBar = this.ac.currentTime + 0.1;
  }

  newPiece() {
    this.piece = new Piece(this.mood, this.rng);
    this.band = new Band(this.studio);
    this.nowPlaying = this.piece.name;
  }

  endPiece(fade) {
    if (this.band) this.band.fadeOut(fade);
    this.band = null;
    this.piece = null;
    this.nowPlaying = '';
  }

  /** Scheduler: write every bar that starts within the look-ahead window. */
  tick() {
    const ac = this.ac;
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;
    // Fell behind (a stalled tab)? Skip ahead instead of rushing old notes.
    if (this.nextBar < now - 0.05) this.nextBar = now + 0.05;
    const want = this.forced || this.wanted;
    if (want !== this.mood) {
      // New mood: fade the old piece and start the new one right away (a slow
      // night bar can last three seconds; raiders should not wait for it).
      this.mood = want;
      this.endPiece(FADE);
      this.gapUntil = 0;
      this.nextBar = now + 0.1;
    }
    let guard = 0;
    while (this.nextBar < now + LOOKAHEAD && guard++ < 16) {
      if (this.nextBar < this.gapUntil) { this.nextBar = this.gapUntil; continue; }
      if (!this.piece) this.newPiece();
      const bar = this.piece.nextBar();
      if (!bar) {
        // Piece finished: rest a while (calm moods), then a new piece.
        this.gapUntil = this.nextBar + this.piece.gapAfter();
        this.band.retire(this.nextBar - now); // its last notes ring out on their own
        this.band = null;
        this.piece = null;
        this.nowPlaying = '';
        continue;
      }
      for (const ev of bar.events) this.band.play(ev, this.nextBar + ev.t);
      this.nextBar += bar.dur;
      this.barsPlayed++;
    }
  }

  /** Status line for the console. */
  describe() {
    if (!this.ac) return 'Music starts after your first click or key press.';
    const state = this.level() <= 0 ? 'off' : this.ac.state !== 'running' ? `waiting (${this.ac.state})` : 'on';
    return `Music ${state}, volume ${Math.round(this.volume * 100)}%, mood ${this.mood}${this.forced ? ' (forced)' : ''}. ${this.nowPlaying ? `Playing ${this.nowPlaying}.` : 'Between pieces.'}`;
  }
}

/**
 * Render `seconds` of music in a mood into a stereo AudioBuffer (offline, as
 * fast as the machine allows). Used by the console's `music wav` and tests.
 * @returns {Promise<AudioBuffer>}
 */
export async function renderMood(mood, seconds = 30, rng = Math.random, sampleRate = 44100) {
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OAC) throw new Error('This browser cannot render audio offline.');
  const ac = new OAC(2, Math.ceil(seconds * sampleRate), sampleRate);
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.01;
  comp.release.value = 0.25;
  const master = ac.createGain();
  master.gain.value = 0.8; // same as full volume live
  comp.connect(master).connect(ac.destination);
  const studio = new Studio(ac, comp);
  let t = 0.05;
  while (t < seconds) {
    const piece = new Piece(mood, rng);
    const band = new Band(studio);
    let bar;
    while ((bar = piece.nextBar()) && t < seconds) {
      for (const ev of bar.events) band.play(ev, t + ev.t);
      t += bar.dur;
    }
    t += Math.min(2, piece.gapAfter()); // keep renders short on silence
  }
  return ac.startRendering();
}

/** Encode an AudioBuffer as a 16-bit PCM WAV file (Blob). */
export function encodeWav(buffer) {
  const channels = Math.min(2, buffer.numberOfChannels);
  const len = buffer.length;
  const bytes = 44 + len * channels * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const text = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  text(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, len * channels * 2, true);
  const data = [];
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}

/**
 * Render one note of one instrument offline (tests: tuning, levels).
 * @returns {Promise<AudioBuffer>}
 */
export async function renderNote(inst, midi, dur = 0.8, seconds = 1.5, sampleRate = 44100) {
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  const ac = new OAC(2, Math.ceil(seconds * sampleRate), sampleRate);
  const studio = new Studio(ac, ac.destination);
  const band = new Band(studio);
  band.send.gain.value = 0; // dry only: easier to measure
  band.play({ inst, midi, dur, vel: 0.8, pan: 0 }, 0.02);
  return ac.startRendering();
}

/**
 * Fundamental frequency of a buffer's first channel between two times, by
 * autocorrelation (good enough to check tuning within a few cents).
 */
export function estimatePitch(buffer, from = 0.1, to = 0.4, minHz = 60, maxHz = 1600) {
  const sr = buffer.sampleRate;
  const d = buffer.getChannelData(0).subarray(Math.floor(from * sr), Math.floor(to * sr));
  const minLag = Math.floor(sr / maxHz);
  const maxLag = Math.min(d.length - 1, Math.ceil(sr / minHz));
  const corr = (lag) => {
    let s = 0;
    for (let i = 0; i + lag < d.length; i++) s += d[i] * d[i + lag];
    return s / (d.length - lag);
  };
  // First peak above 90% of the strongest: the fundamental, not an octave below.
  const values = [];
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const c = corr(lag);
    values.push(c);
    if (c > best) best = c;
  }
  let lag = minLag;
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] >= best * 0.9 && values[i] >= values[i - 1] && values[i] >= values[i + 1]) { lag = minLag + i; break; }
  }
  // Parabolic interpolation around the peak for sub-sample accuracy.
  const i = lag - minLag;
  const a = values[i - 1] ?? values[i];
  const b = values[i];
  const c = values[i + 1] ?? values[i];
  const shift = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  return sr / (lag + shift);
}

/**
 * Loudness and sanity numbers for rendered audio: peak, RMS (dBFS), and
 * whether anything is NaN. The browser tests use this to catch silent,
 * clipping or broken output.
 */
export function measure(buffer) {
  let peak = 0;
  let sum = 0;
  let n = 0;
  let bad = false;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) { bad = true; continue; }
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      sum += v * v;
      n++;
    }
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  return { peak, rms, rmsDb: 20 * Math.log10(rms || 1e-9), bad };
}

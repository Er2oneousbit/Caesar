/**
 * sfx.js
 * ----------------------------------------------------------------------------
 * Tiny synthesized sound effects (WebAudio). No audio files: every sound is a
 * few oscillators or a noise burst, so the game stays a single small file.
 *
 * Browsers only allow audio after a user gesture; the context is created
 * lazily on the first play() after a click/keypress.
 * ----------------------------------------------------------------------------
 */

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.5;
    this.muted = false;
    this.lastPlayed = new Map(); // name -> time, to avoid spamming
  }

  _ensure() {
    if (this.ctx) return this.ctx;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  setMuted(m) { this.muted = !!m; }

  /** Play a named effect. Unknown names are ignored. */
  play(name) {
    if (this.muted || this.volume <= 0) return;
    const now = performance.now();
    const minGap = { fire: 1500, collapse: 800, build: 60, click: 40, horn: 2500, clash: 160, arrow: 140 }[name] ?? 250;
    if (now - (this.lastPlayed.get(name) || 0) < minGap) return;
    this.lastPlayed.set(name, now);
    const ctx = this._ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t = ctx.currentTime;
    try {
      switch (name) {
        case 'click': this.tone(880, t, 0.04, 'triangle', 0.15); break;
        case 'build': this.tone(180, t, 0.08, 'square', 0.18, 90); this.noise(t, 0.06, 0.12, 800); break;
        case 'demolish': this.noise(t, 0.35, 0.3, 400); this.tone(90, t, 0.3, 'sawtooth', 0.12, 40); break;
        case 'collapse': this.noise(t, 0.8, 0.35, 250); break;
        case 'fire': [0, 0.18, 0.36].forEach((d) => this.tone(1040, t + d, 0.12, 'square', 0.12)); break;
        case 'splash': this.noise(t, 0.25, 0.15, 2500); break;
        case 'coin': this.tone(1320, t, 0.08, 'triangle', 0.2); this.tone(1760, t + 0.07, 0.12, 'triangle', 0.18); break;
        case 'blessing': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.09, 0.3, 'sine', 0.16)); break;
        case 'wrath': this.tone(110, t, 0.9, 'sawtooth', 0.14, 70); this.noise(t, 0.9, 0.12, 180); break;
        case 'fanfare': [392, 523, 659, 784].forEach((f, i) => this.tone(f, t + i * 0.12, 0.22, 'square', 0.1)); break;
        case 'festival': [659, 784, 880, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.1, 0.16, 'triangle', 0.14)); break;
        case 'victory': [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, t + i * 0.16, 0.5, 'triangle', 0.16)); break;
        case 'error': this.tone(220, t, 0.14, 'square', 0.12, 160); break;
        // --- military ---
        case 'horn': this.tone(147, t, 1.1, 'sawtooth', 0.12, 139); this.tone(220, t + 0.05, 1.0, 'triangle', 0.08, 208); break; // war horn
        case 'clash': this.tone(1400 + Math.random() * 500, t, 0.06, 'square', 0.05, 900); this.noise(t, 0.05, 0.08, 5000); break; // blades
        case 'arrow': this.noise(t, 0.09, 0.05, 7000); break; // whoosh
        case 'recruit': [0, 0.12].forEach((d) => this.tone(196, t + d, 0.08, 'triangle', 0.12, 150)); break; // drum beats
        default: break;
      }
    } catch {
      /* audio is best-effort */
    }
  }

  tone(freq, t, dur, type = 'sine', gain = 0.2, endFreq = null) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(t, dur, gain = 0.2, cutoff = 1000) {
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }
}

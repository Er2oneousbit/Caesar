/**
 * instruments.js
 * ----------------------------------------------------------------------------
 * The music's instruments, synthesized with WebAudio (no sample files).
 * Everything takes a BaseAudioContext, so the same code plays live
 * (AudioContext) or renders offline (OfflineAudioContext: WAV export and the
 * browser tests).
 *
 *   lyre    plucked strings: Karplus-Strong (a burst of noise circulating in
 *           a delay line that loses a little brightness each round trip).
 *           One buffer is computed per note and cached; playbackRate fixes
 *           the tuning error of a whole-sample delay line.
 *   aulos   double reed pipe: sawtooth + square slightly apart (the two
 *           pipes beating), a nasal formant, breath noise, a scoop into each
 *           note and vibrato that grows as the note is held
 *   syrinx  pan flute: sine + a little octave, a breathy "chiff" at the start
 *   pad     the low drone: two detuned triangles under a low-pass filter
 *   drum    frame drum: 'dum' (a pitched thump) and 'tek' (a rim slap)
 *   horn    cornu: sawtooth through a filter that opens as the note speaks
 *   jingle  sistrum: three tiny bursts of bright noise
 *
 * Mixing: Studio holds what all pieces share (a generated reverb, a noise
 * buffer, the pluck cache). Each playing piece gets a Band: its own fader
 * for the dry sound and the reverb send, so one piece can fade out while the
 * next begins. Per-note nodes disconnect themselves when they finish.
 * ----------------------------------------------------------------------------
 */

/** MIDI note -> frequency (A4 = 440 Hz). */
export const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

/** Reverb send levels per instrument (0..1). */
const SEND = { lyre: 0.35, aulos: 0.3, syrinx: 0.45, pad: 0.5, drum: 0.12, horn: 0.35, jingle: 0.25 };

/**
 * Shared per audio context: reverb, noise, pluck buffers, and the input all
 * bands mix into.
 */
export class Studio {
  /**
   * @param {BaseAudioContext} ac
   * @param {AudioNode} out   where the finished mix goes (compressor / master)
   */
  constructor(ac, out) {
    this.ac = ac;
    // Everything passes a gentle high-pass first: no sub-bass rumble.
    this.out = ac.createBiquadFilter();
    this.out.type = 'highpass';
    this.out.frequency.value = 45;
    this.out.Q.value = 0.7;
    this.out.connect(out);
    this.plucks = new Map(); // midi -> { buffer, rate }
    this.noise = makeNoise(ac, 2);
    this.reverbIn = ac.createGain();
    const verb = ac.createConvolver();
    verb.buffer = makeImpulse(ac, 2.4, 2.8);
    const wet = ac.createGain();
    wet.gain.value = 0.55;
    this.reverbIn.connect(verb).connect(wet).connect(this.out);
  }

  /**
   * A cached Karplus-Strong pluck for a MIDI note.
   * @returns {{buffer: AudioBuffer, rate: number}} rate = playbackRate that fixes the pitch
   */
  pluck(midi) {
    let p = this.plucks.get(midi);
    if (p) return p;
    const ac = this.ac;
    const sr = ac.sampleRate;
    const f = midiToHz(midi);
    // The loop below averages a sample with the NEXT one out of the delay
    // line, so a round trip takes N - 0.5 samples (not N + 0.5).
    const N = Math.max(8, Math.round(sr / f + 0.5));
    const actual = sr / (N - 0.5);
    // Gut strings ring for a second or two; high notes die sooner.
    const t60 = 1.8 - Math.min(0.8, f / 1000);
    const loss = Math.exp(Math.log(0.001) / (t60 * actual)); // per round trip
    const len = Math.floor(sr * (t60 + 0.25));
    const data = new Float32Array(len);
    const ring = new Float32Array(N);
    // Excitation: softened noise (a finger, not a pick), without DC.
    let lp = 0;
    let mean = 0;
    for (let i = 0; i < N; i++) {
      lp += (Math.random() * 2 - 1 - lp) * 0.5;
      ring[i] = lp;
      mean += lp;
    }
    mean /= N;
    for (let i = 0; i < N; i++) ring[i] -= mean;
    let idx = 0;
    let peak = 1e-9;
    for (let i = 0; i < len; i++) {
      const next = idx + 1 === N ? 0 : idx + 1;
      const out = ring[idx];
      data[i] = out;
      ring[idx] = (out + ring[next]) * 0.5 * loss;
      idx = next;
      const a = out < 0 ? -out : out;
      if (a > peak) peak = a;
    }
    // Normalize, and fade the very end so a cut-off tail never clicks.
    const g = 0.9 / peak;
    const fade = Math.floor(sr * 0.05);
    for (let i = 0; i < len; i++) data[i] *= g * (i > len - fade ? (len - i) / fade : 1);
    const buffer = ac.createBuffer(1, len, sr);
    buffer.getChannelData(0).set(data);
    p = { buffer, rate: f / actual };
    this.plucks.set(midi, p);
    return p;
  }
}

/** One piece's mix: a fader for its dry sound and its reverb send. */
export class Band {
  /** @param {Studio} studio */
  constructor(studio) {
    const ac = studio.ac;
    this.studio = studio;
    this.ac = ac;
    this.dry = ac.createGain();
    this.send = ac.createGain();
    this.dry.connect(studio.out);
    this.send.connect(studio.reverbIn);
    // The lyre's body: a little warmth low down, no harsh top.
    this.lyreIn = ac.createGain();
    const body = ac.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 240;
    body.Q.value = 1;
    body.gain.value = 4;
    const top = ac.createBiquadFilter();
    top.type = 'lowpass';
    top.frequency.value = 4200;
    this.lyreIn.connect(body).connect(top);
    top.connect(this.dry);
    const lyreSend = ac.createGain();
    lyreSend.gain.value = SEND.lyre;
    top.connect(lyreSend).connect(this.send);
  }

  /** Fade this band out over `seconds`, then disconnect it. */
  fadeOut(seconds = 1.5) {
    const t = this.ac.currentTime;
    for (const g of [this.dry.gain, this.send.gain]) {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + seconds);
    }
    if (typeof setTimeout === 'function') setTimeout(() => { this.dry.disconnect(); this.send.disconnect(); }, (seconds + 4) * 1000);
  }

  /** The piece is over: disconnect once its last notes have rung out. */
  retire(afterSeconds = 0) {
    if (typeof setTimeout === 'function') setTimeout(() => { this.dry.disconnect(); this.send.disconnect(); }, (Math.max(0, afterSeconds) + 5) * 1000);
  }

  /** Play one composer event at audio time `when`. Unknown instruments are ignored. */
  play(ev, when) {
    const t = Math.max(when, this.ac.currentTime);
    switch (ev.inst) {
      case 'lyre': return this.lyre(ev, t);
      case 'aulos': return this.aulos(ev, t);
      case 'syrinx': return this.syrinx(ev, t);
      case 'pad': return this.pad(ev, t);
      case 'drum': return this.drum(ev, t);
      case 'horn': return this.horn(ev, t);
      case 'jingle': return this.jingle(ev, t);
      default: return undefined;
    }
  }

  // --- plumbing --------------------------------------------------------

  /** A stereo position node (falls back to a plain gain where unsupported). */
  panner(pan) {
    const ac = this.ac;
    if (typeof ac.createStereoPanner === 'function') {
      const p = ac.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan || 0));
      return p;
    }
    return ac.createGain();
  }

  /**
   * Route a note's output (a panner) to the dry bus and the reverb send, and
   * disconnect its nodes when the last source ends.
   */
  route(inst, pan, nodes, sources, dest = null) {
    const ac = this.ac;
    const s = ac.createGain();
    s.gain.value = SEND[inst] ?? 0.2;
    if (dest) {
      pan.connect(dest);
    } else {
      pan.connect(this.dry);
      pan.connect(s).connect(this.send);
    }
    const all = [...nodes, pan, s];
    let left = sources.length;
    for (const src of sources) {
      src.onended = () => {
        left--;
        if (left <= 0) for (const n of all) { try { n.disconnect(); } catch { /* already gone */ } }
      };
    }
  }

  noiseSource(t, dur) {
    const src = this.ac.createBufferSource();
    src.buffer = this.studio.noise;
    src.loop = true;
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur);
    return src;
  }

  filter(type, freq, q = 1) {
    const f = this.ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  // --- instruments -----------------------------------------------------

  lyre(ev, t) {
    const ac = this.ac;
    const { buffer, rate } = this.studio.pluck(ev.midi);
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ac.createGain();
    const v = 0.34 * ev.vel;
    g.gain.setValueAtTime(v, t);
    // Let it ring, then damp it gently after about twice its written length.
    const damp = t + Math.max(0.25, ev.dur * 2);
    g.gain.setValueAtTime(v, damp);
    g.gain.setTargetAtTime(0, damp, 0.18);
    const end = Math.min(t + buffer.duration / rate, damp + 1);
    src.connect(g);
    const pan = this.panner(ev.pan);
    g.connect(pan);
    src.start(t);
    src.stop(end);
    this.route('lyre', pan, [src, g], [src], this.lyreIn);
  }

  aulos(ev, t) {
    const ac = this.ac;
    const f = midiToHz(ev.midi);
    const dur = Math.max(0.08, ev.dur);
    const grace = !!ev.grace;
    const o1 = ac.createOscillator();
    const o2 = ac.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'square';
    // A slight scoop up into the note, then the pitch settles.
    for (const [o, ratio] of [[o1, 1], [o2, 1.004]]) {
      o.frequency.setValueAtTime(f * ratio * (grace ? 1 : 0.985), t);
      o.frequency.exponentialRampToValueAtTime(f * ratio, t + 0.05);
    }
    const m1 = ac.createGain();
    const m2 = ac.createGain();
    m1.gain.value = 0.5;
    m2.gain.value = 0.22;
    // Vibrato grows as the note is held (not on short or grace notes).
    const nodes = [o1, o2, m1, m2];
    const sources = [o1, o2];
    if (!grace && dur > 0.3) {
      const lfo = ac.createOscillator();
      lfo.frequency.value = 5.2;
      const depth = ac.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.45, dur * 0.6));
      lfo.connect(depth);
      depth.connect(o1.frequency);
      depth.connect(o2.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.2);
      nodes.push(lfo, depth);
      sources.push(lfo);
    }
    const tone = this.filter('lowpass', Math.min(3400, f * 5), 0.7);
    const nasal = this.filter('peaking', 1450, 1.3);
    nasal.gain.value = 5;
    const env = ac.createGain();
    const v = (grace ? 0.2 : 0.3) * ev.vel;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(v, t + 0.03);
    env.gain.linearRampToValueAtTime(v * 0.82, t + 0.12);
    env.gain.setValueAtTime(v * 0.82, t + dur);
    env.gain.setTargetAtTime(0, t + dur, 0.035);
    o1.connect(m1).connect(tone);
    o2.connect(m2).connect(tone);
    tone.connect(nasal).connect(env);
    // Breath through the reed.
    const breath = this.noiseSource(t, dur + 0.3);
    const bf = this.filter('bandpass', Math.min(6000, f * 2.5), 1.5);
    const bg = ac.createGain();
    bg.gain.value = 0.18;
    breath.connect(bf).connect(bg).connect(env);
    const pan = this.panner(ev.pan);
    env.connect(pan);
    const stop = t + dur + 0.3;
    o1.start(t);
    o2.start(t);
    o1.stop(stop);
    o2.stop(stop);
    this.route('aulos', pan, [...nodes, tone, nasal, env, breath, bf, bg], [...sources, breath]);
  }

  syrinx(ev, t) {
    const ac = this.ac;
    const f = midiToHz(ev.midi);
    const dur = Math.max(0.1, ev.dur);
    const o1 = ac.createOscillator();
    const o2 = ac.createOscillator();
    o1.type = 'sine';
    o2.type = 'triangle';
    o1.frequency.value = f;
    o2.frequency.value = f * 2;
    const g2 = ac.createGain();
    g2.gain.value = 0.12;
    const env = ac.createGain();
    const v = 0.14 * ev.vel;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(v, t + 0.06);
    env.gain.setValueAtTime(v, t + dur);
    env.gain.setTargetAtTime(0, t + dur, 0.06);
    o1.connect(env);
    o2.connect(g2).connect(env);
    // A breathy "chiff" as the note starts, and a little air under it.
    const chiff = this.noiseSource(t, 0.08);
    const cf = this.filter('bandpass', Math.min(9000, f * 4), 3);
    const cg = ac.createGain();
    cg.gain.setValueAtTime(0.45 * ev.vel, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    chiff.connect(cf).connect(cg);
    const air = this.noiseSource(t, dur + 0.3);
    const af = this.filter('bandpass', Math.min(8000, f * 1.5), 0.8);
    const ag = ac.createGain();
    ag.gain.value = 0.1;
    air.connect(af).connect(ag).connect(env);
    const pan = this.panner(ev.pan);
    env.connect(pan);
    cg.connect(pan);
    const stop = t + dur + 0.4;
    o1.start(t);
    o2.start(t);
    o1.stop(stop);
    o2.stop(stop);
    this.route('syrinx', pan, [o1, o2, g2, env, chiff, cf, cg, air, af, ag], [o1, o2, chiff, air]);
  }

  pad(ev, t) {
    const ac = this.ac;
    const f = midiToHz(ev.midi);
    const dur = Math.max(0.5, ev.dur);
    const oscs = [['triangle', f * 0.997], ['triangle', f * 1.003]].map(([type, freq]) => {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      return o;
    });
    const lp = this.filter('lowpass', 750, 0.5);
    const env = ac.createGain();
    const v = 0.04 * ev.vel;
    const attack = Math.min(1.2, dur * 0.3);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(v, t + attack);
    env.gain.setValueAtTime(v, t + dur);
    env.gain.setTargetAtTime(0, t + dur, 0.5);
    for (const o of oscs) o.connect(lp);
    lp.connect(env);
    const pan = this.panner(ev.pan);
    env.connect(pan);
    for (const o of oscs) { o.start(t); o.stop(t + dur + 2.5); }
    this.route('pad', pan, [...oscs, lp, env], oscs);
  }

  drum(ev, t) {
    const ac = this.ac;
    const pan = this.panner(ev.pan);
    if (ev.kind === 'dum') {
      // The skin: a low sine that drops in pitch, and a soft thump of noise.
      const o = ac.createOscillator();
      o.frequency.setValueAtTime(100, t);
      o.frequency.exponentialRampToValueAtTime(52, t + 0.2);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.6 * ev.vel, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      const n = this.noiseSource(t, 0.1);
      const nf = this.filter('lowpass', 420, 0.7);
      const ng = ac.createGain();
      ng.gain.setValueAtTime(0.25 * ev.vel, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      o.connect(g).connect(pan);
      n.connect(nf).connect(ng).connect(pan);
      o.start(t);
      o.stop(t + 0.55);
      this.route('drum', pan, [o, g, n, nf, ng], [o, n]);
    } else {
      // The rim: a bright slap of noise with a hint of pitch.
      const n = this.noiseSource(t, 0.1);
      const nf = this.filter('bandpass', 2300, 1.2);
      const ng = ac.createGain();
      ng.gain.setValueAtTime(1.5 * ev.vel, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      const o = ac.createOscillator();
      o.frequency.value = 520;
      const og = ac.createGain();
      og.gain.setValueAtTime(0.25 * ev.vel, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
      n.connect(nf).connect(ng).connect(pan);
      o.connect(og).connect(pan);
      o.start(t);
      o.stop(t + 0.06);
      this.route('drum', pan, [n, nf, ng, o, og], [n, o]);
    }
  }

  horn(ev, t) {
    const ac = this.ac;
    const f = midiToHz(ev.midi);
    const dur = Math.max(0.15, ev.dur);
    const o1 = ac.createOscillator();
    const o2 = ac.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'sawtooth';
    for (const [o, ratio] of [[o1, 1], [o2, 1.0025]]) {
      o.frequency.setValueAtTime(f * ratio * 0.97, t); // the lips find the note
      o.frequency.exponentialRampToValueAtTime(f * ratio, t + 0.08);
    }
    // The brass "blat": the filter opens as the note speaks, then settles.
    const lp = this.filter('lowpass', 260, 2);
    lp.frequency.setValueAtTime(260, t);
    lp.frequency.exponentialRampToValueAtTime(1500, t + 0.12);
    lp.frequency.exponentialRampToValueAtTime(820, t + 0.4);
    const env = ac.createGain();
    const v = 0.09 * ev.vel;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(v, t + 0.06);
    env.gain.setValueAtTime(v, t + dur);
    env.gain.setTargetAtTime(0, t + dur, 0.07);
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(env);
    const pan = this.panner(ev.pan);
    env.connect(pan);
    o1.start(t);
    o2.start(t);
    o1.stop(t + dur + 0.5);
    o2.stop(t + dur + 0.5);
    this.route('horn', pan, [o1, o2, lp, env], [o1, o2]);
  }

  jingle(ev, t) {
    const ac = this.ac;
    const pan = this.panner(ev.pan);
    const nodes = [];
    const sources = [];
    for (let k = 0; k < 3; k++) {
      const at = t + k * 0.024;
      const n = this.noiseSource(at, 0.06);
      const hp = this.filter('highpass', 6000, 0.7);
      const bp = this.filter('bandpass', 8200, 3);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.35 * ev.vel * (1 - k * 0.25), at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
      n.connect(hp).connect(bp).connect(g).connect(pan);
      nodes.push(n, hp, bp, g);
      sources.push(n);
    }
    this.route('jingle', pan, nodes, sources);
  }
}

/** Two seconds of white noise (breath, drums, jingles). */
function makeNoise(ac, seconds) {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * A reverb impulse response: stereo noise decaying exponentially, darkening
 * as it fades (like a stone hall), after a short pre-delay.
 */
function makeImpulse(ac, seconds, decay) {
  const sr = ac.sampleRate;
  const len = Math.floor(sr * seconds);
  const pre = Math.floor(sr * 0.015);
  const buf = ac.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const x = (i - pre) / (len - pre);
      // Low-pass that closes over time: later reflections are duller.
      const k = 0.9 - 0.75 * x;
      lp += (Math.random() * 2 - 1 - lp) * k;
      d[i] = lp * Math.exp(-decay * x * 2.2) * 0.6;
    }
  }
  return buf;
}

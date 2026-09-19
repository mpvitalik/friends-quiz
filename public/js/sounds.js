// ==========================================================================
// Web Audio API Sound Generator (No external audio files needed)
// ==========================================================================

class SoundEffects {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    try {
      this.enabled = localStorage.getItem('friends_quiz_sound') !== 'off';
    } catch (e) { /* ignore */ }

    // Background music state
    this.music = null;          // { bus, filter, pad:[], timer, step }
    this.musicWanted = false;   // does the game want music right now?

    this._installUnlock();
  }

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // Browsers only allow AudioContext to start after a user gesture.
  // Unlock it on the very first interaction so timer ticks etc. can play later.
  _installUnlock() {
    const unlock = () => {
      this.init();
      // If the game asked for music before audio was unlocked, start it now.
      if (this.musicWanted) this.startMusic();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
    window.addEventListener('touchstart', unlock, { once: false });
  }

  setEnabled(on) {
    this.enabled = !!on;
    try {
      localStorage.setItem('friends_quiz_sound', this.enabled ? 'on' : 'off');
    } catch (e) { /* ignore */ }
    if (this.enabled) {
      this.init();
      if (this.musicWanted) this.startMusic();
    } else {
      this._teardownMusic();
    }
    return this.enabled;
  }

  toggle() {
    return this.setEnabled(!this.enabled);
  }

  // Low-level helper: play a single tone
  _tone(freq, startOffset, dur, { type = 'triangle', gain = 0.25, glideTo = null } = {}) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime + startOffset;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, now + dur);

    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + dur);
  }

  playBuzzer() {
    if (!this.enabled) return;
    this.init();
    this._tone(440, 0, 0.25, { type: 'sawtooth', gain: 0.3, glideTo: 880 });
  }

  playCorrect() {
    if (!this.enabled) return;
    this.init();
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 (major arpeggio)
    notes.forEach((f, i) => this._tone(f, i * 0.08, 0.35, { type: 'triangle', gain: 0.25 }));
  }

  playWrong() {
    if (!this.enabled) return;
    this.init();
    this._tone(160, 0, 0.4, { type: 'sawtooth', gain: 0.35, glideTo: 90 });
    this._tone(120, 0.06, 0.4, { type: 'square', gain: 0.15, glideTo: 70 });
  }

  playTick() {
    if (!this.enabled) return;
    this.init();
    this._tone(880, 0, 0.05, { type: 'sine', gain: 0.1 });
  }

  // Short UI blip for button taps / navigation
  playClick() {
    if (!this.enabled) return;
    this.init();
    this._tone(320, 0, 0.06, { type: 'square', gain: 0.08 });
    this._tone(480, 0.03, 0.06, { type: 'square', gain: 0.06 });
  }

  // Rising sweep when a new round / question starts
  playStart() {
    if (!this.enabled) return;
    this.init();
    [392, 523.25, 659.25].forEach((f, i) =>
      this._tone(f, i * 0.1, 0.22, { type: 'triangle', gain: 0.22 }));
  }

  // "Time is up" descending horn
  playTimeout() {
    if (!this.enabled) return;
    this.init();
    this._tone(330, 0, 0.5, { type: 'sawtooth', gain: 0.28, glideTo: 160 });
    this._tone(247, 0.12, 0.5, { type: 'sawtooth', gain: 0.2, glideTo: 120 });
  }

  playFanfare() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const notes = [
      { f: 523.25, d: 0.15 }, // C5
      { f: 523.25, d: 0.15 }, // C5
      { f: 523.25, d: 0.15 }, // C5
      { f: 659.25, d: 0.4 },  // E5
      { f: 587.33, d: 0.2 },  // D5
      { f: 783.99, d: 0.6 }   // G5
    ];

    let t = 0;
    notes.forEach(n => {
      this._tone(n.f, t, n.d, { type: 'triangle', gain: 0.3 });
      t += n.d * 0.9;
    });
  }

  // ========================================================================
  // Background music — an original, cheerful sitcom-style loop (C major):
  // lead melody + plucked chord arpeggio + bass + light hi-hat.
  // Fully synthesized, no audio files. 8 bars, repeats for the whole game.
  // ========================================================================

  _midi(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  _musicNote(freq, when, dur, { type = 'triangle', gain = 0.2, attack = 0.012, dest = null, detune = 0 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(gain, when + attack);
    g.gain.exponentialRampToValueAtTime(gain * 0.55, when + Math.min(dur * 0.5, 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g);
    g.connect(dest || this.music.filter);
    o.start(when);
    o.stop(when + dur + 0.05);
  }

  _hat(when) {
    const ctx = this.ctx;
    if (!this._noise) {
      const len = ctx.sampleRate * 0.1;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noise = buf;
    }
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    src.connect(hp); hp.connect(g); g.connect(this.music.bus);
    src.start(when);
    src.stop(when + 0.08);
  }

  // Schedule one eighth-note step of the 8-bar loop
  _musicStep(step, when, eighth) {
    const bar = Math.floor(step / 8) % 8;
    const pos = step % 8;

    // Chord per bar: C  Am  F  G  |  C  Am  F  G
    const CHORDS = [
      { bass: 48, tri: [60, 64, 67] },  // C
      { bass: 45, tri: [57, 60, 64] },  // Am
      { bass: 41, tri: [57, 60, 65] },  // F
      { bass: 43, tri: [59, 62, 67] },  // G
    ];
    const ch = CHORDS[bar % 4];

    // Bass: root on beats 1 and 3, fifth on the "and" of 2
    if (pos === 0 || pos === 4) this._musicNote(this._midi(ch.bass), when, eighth * 3.2, { type: 'triangle', gain: 0.42 });
    if (pos === 6) this._musicNote(this._midi(ch.bass + 7), when, eighth * 1.6, { type: 'triangle', gain: 0.3 });

    // Plucked arpeggio, up-down pattern over the triad
    const arp = [0, 1, 2, 1, 0, 1, 2, 1][pos];
    this._musicNote(this._midi(ch.tri[arp] + 12), when, eighth * 1.8, { type: 'sine', gain: 0.2, attack: 0.005 });

    // Light hi-hat on the off-beats
    if (pos % 2 === 1) this._hat(when);

    // Lead melody: [startStep, midi, lengthInEighths]
    const MELODY = [
      [[0,76,2],[2,79,1],[3,76,1],[4,74,2],[6,72,2]],
      [[0,72,2],[2,76,1],[3,81,1],[4,79,2],[6,76,2]],
      [[0,81,2],[2,79,1],[3,77,1],[4,76,2],[6,72,2]],
      [[0,74,2],[2,71,1],[3,74,1],[4,79,3]],
      [[0,79,2],[2,76,1],[3,79,1],[4,84,2],[6,79,2]],
      [[0,76,2],[2,81,1],[3,79,1],[4,76,2],[6,74,2]],
      [[0,77,2],[2,81,1],[3,84,1],[4,81,2],[6,77,2]],
      [[0,79,2],[2,77,1],[3,74,1],[4,72,4]],
    ];
    MELODY[bar].forEach(([st, m, len]) => {
      if (st === pos) {
        const f = this._midi(m);
        const d = eighth * len * 0.95;
        this._musicNote(f, when, d, { type: 'triangle', gain: 0.5, attack: 0.015 });
        this._musicNote(f, when, d, { type: 'sine', gain: 0.32, attack: 0.02, detune: 6 });
      }
    });
  }

  startMusic() {
    this.musicWanted = true;
    if (!this.enabled) return;
    this.init();
    if (!this.ctx || this.music) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Music bus — loud enough to be clearly heard over the SFX
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.linearRampToValueAtTime(0.55, now + 1.2);
    const comp = ctx.createDynamicsCompressor(); // keeps the louder mix from clipping
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    bus.connect(comp);
    comp.connect(ctx.destination);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 5200;
    filter.Q.value = 0.5;
    filter.connect(bus);

    this.music = { bus, filter, comp, timer: null };

    const bpm = 112;
    const eighth = 60 / bpm / 2;
    let step = 0;
    let next = now + 0.1;

    // Look-ahead scheduler: keeps ~0.6s of notes queued, drift-free
    this.music.timer = setInterval(() => {
      if (!this.ctx || !this.music) return;
      while (next < this.ctx.currentTime + 0.6) {
        this._musicStep(step, next, eighth);
        step = (step + 1) % 64;
        next += eighth;
      }
    }, 100);
  }

  // Stop but remember that the game still wants music (e.g. user hit mute)
  _teardownMusic() {
    const m = this.music;
    this.music = null;
    if (!m) return;
    clearInterval(m.timer);
    const ctx = this.ctx;
    if (ctx) {
      try { m.bus.gain.cancelScheduledValues(ctx.currentTime); m.bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.25); } catch (e) { /* ignore */ }
      setTimeout(() => { try { m.bus.disconnect(); m.comp && m.comp.disconnect(); } catch (e) { /* ignore */ } }, 1200);
    }
  }

  stopMusic() {
    this.musicWanted = false;
    this._teardownMusic();
  }
}

window.sounds = new SoundEffects();

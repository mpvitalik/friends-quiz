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
  // Background music — light "quiz tension" bed, à la a TV quiz show.
  // Fully synthesized (no audio files, no third-party melodies): a soft
  // string-like pad on a slow two-chord loop + a quiet heartbeat pulse.
  // ========================================================================

  startMusic() {
    this.musicWanted = true;
    if (!this.enabled) return;
    this.init();
    if (!this.ctx || this.music) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.linearRampToValueAtTime(0.05, now + 2.0); // gentle fade-in, quiet
    bus.connect(ctx.destination);

    // Keep everything soft and warm
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 850;
    filter.Q.value = 0.6;
    filter.connect(bus);

    // Sustained pad chord (A minor). Slight detune = string ensemble feel.
    const chordA = [110.0, 164.81, 220.0, 329.63];   // Am
    const chordF = [87.31, 174.61, 261.63, 349.23];  // F
    const pad = chordA.map((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = i === 0 ? 'triangle' : 'sawtooth';
      o.frequency.setValueAtTime(f, now);
      o.detune.value = (i - 1.5) * 5;
      g.gain.value = 0.11 / chordA.length;
      o.connect(g);
      g.connect(filter);
      o.start(now);
      return { o, g };
    });

    // Heartbeat / ticking pulse — the tension driver
    const bpm = 80;
    const beat = 60 / bpm;
    const bass = [55.0, 55.0, 65.41, 55.0, 43.65, 43.65, 65.41, 61.74]; // A1 walk / F1
    const state = { step: 0 };

    const timer = setInterval(() => {
      if (!this.ctx || !this.music) return;
      const t = this.ctx.currentTime + 0.05;
      const step = state.step;

      // Every 8 beats, drift the pad between Am and F
      if (step % 8 === 0) {
        const target = (step % 16 === 0) ? chordA : chordF;
        this.music.pad.forEach((v, i) => {
          try { v.o.frequency.setTargetAtTime(target[i], t, 1.2); } catch (e) { /* ignore */ }
        });
      }

      // Soft plucked bass on every beat
      const bf = bass[step % bass.length];
      const bo = this.ctx.createOscillator();
      const bg = this.ctx.createGain();
      bo.type = 'triangle';
      bo.frequency.setValueAtTime(bf, t);
      bg.gain.setValueAtTime(0.0001, t);
      bg.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.95);
      bo.connect(bg);
      bg.connect(this.music.filter);
      bo.start(t);
      bo.stop(t + beat);

      // Faint high "tick" on the off-beats
      if (step % 2 === 1) {
        const to = this.ctx.createOscillator();
        const tg = this.ctx.createGain();
        to.type = 'sine';
        to.frequency.setValueAtTime(1975.53, t);
        tg.gain.setValueAtTime(0.022, t);
        tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        to.connect(tg);
        tg.connect(this.music.bus);
        to.start(t);
        to.stop(t + 0.1);
      }

      state.step++;
    }, beat * 1000);

    this.music = { bus, filter, pad, timer };
  }

  // Stop but remember that the game still wants music (e.g. user hit mute)
  _teardownMusic() {
    const m = this.music;
    this.music = null;
    if (!m) return;
    clearInterval(m.timer);
    const ctx = this.ctx;
    if (ctx) {
      const now = ctx.currentTime;
      try { m.bus.gain.setTargetAtTime(0.0001, now, 0.35); } catch (e) { /* ignore */ }
      m.pad.forEach(v => {
        try {
          v.g.gain.setTargetAtTime(0.0001, now, 0.3);
          v.o.stop(now + 1.4);
        } catch (e) { /* ignore */ }
      });
      setTimeout(() => { try { m.bus.disconnect(); } catch (e) { /* ignore */ } }, 1800);
    }
  }

  stopMusic() {
    this.musicWanted = false;
    this._teardownMusic();
  }
}

window.sounds = new SoundEffects();

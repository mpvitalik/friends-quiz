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
    if (this.enabled) this.init();
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
}

window.sounds = new SoundEffects();

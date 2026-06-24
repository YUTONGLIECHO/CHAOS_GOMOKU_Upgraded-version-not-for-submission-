// audio.js
// WebAudio sound bus for CHAOS GOMOKU 3D. All sounds are generated at runtime
// (no asset files). Persists on/off + volume in localStorage ('cg3d_audio').
// Extracted from main.js (see ARCHITECTURE.md → "Conservative main.js split").

export class Sound {
  constructor() {
    this.on = true; this.volume = 0.6; this.ctx = null;
    try {
      const saved = JSON.parse(localStorage.getItem('cg3d_audio') || '{}');
      if (typeof saved.on === 'boolean') this.on = saved.on;
      if (typeof saved.volume === 'number') this.volume = saved.volume;
    } catch (e) { /* ignore */ }
  }
  _ensure() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; } } if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  save() { try { localStorage.setItem('cg3d_audio', JSON.stringify({ on: this.on, volume: this.volume })); } catch (e) {} }
  setOn(v) { this.on = v; this.save(); }
  setVolume(v) { this.volume = v; this.save(); }
  _tone(freq, dur, type = 'square', vol = 0.2, slideTo = null) {
    if (!this.on) return; this._ensure(); if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(Math.max(0.0001, vol * this.volume), t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t0); o.stop(t0 + dur);
  }
  _noise(dur, vol = 0.2) {
    if (!this.on) return; this._ensure(); if (!this.ctx) return;
    const t0 = this.ctx.currentTime, n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = buf; g.gain.setValueAtTime(vol * this.volume, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(g).connect(this.ctx.destination); src.start(t0);
  }
  play(name) {
    switch (name) {
      case 'place':     this._tone(180, 0.08, 'square', 0.25, 90); break;
      case 'hover':     this._tone(660, 0.03, 'square', 0.06); break;
      case 'charge':    this._tone(220, 0.35, 'sawtooth', 0.12, 880); break;
      case 'explosion': this._noise(0.5, 0.35); this._tone(80, 0.5, 'sawtooth', 0.2, 30); break;
      case 'ice':       this._tone(1200, 0.25, 'triangle', 0.12, 400); this._noise(0.2, 0.08); break;
      case 'rewind':    this._tone(700, 0.4, 'sine', 0.14, 160); break;
      case 'flip':      this._noise(0.6, 0.4); this._tone(60, 0.6, 'square', 0.25, 24); break;
      case 'win':       [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._tone(f, 0.18, 'square', 0.2), i * 110)); break;
      case 'loss':      [400, 320, 240, 160].forEach((f, i) => setTimeout(() => this._tone(f, 0.2, 'sawtooth', 0.18), i * 130)); break;
      case 'click':     this._tone(440, 0.04, 'square', 0.12); break;
      case 'type':      this._tone(1500, 0.015, 'square', 0.04); break;
      case 'boot':      this._tone(70, 0.7, 'sine', 0.10, 48); break;
      case 'glitch':    this._noise(0.18, 0.10); this._tone(520, 0.12, 'square', 0.08, 120); break;
      case 'grid':      this._tone(880, 0.05, 'triangle', 0.06, 1320); break;
      case 'warn':      this._tone(330, 0.30, 'sawtooth', 0.10, 220); break;
    }
  }
}

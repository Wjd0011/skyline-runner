export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.18;
    this.master.connect(this.ctx.destination);
  }

  tone(freq, dur, type = 'sine', gain = 0.5, slideTo = null) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  jump() { this.tone(320, 0.16, 'triangle', 0.5, 620); }
  land() { this.tone(120, 0.08, 'sine', 0.35, 80); }
  pickup() { this.tone(880, 0.12, 'square', 0.22, 1320); }
  stomp() { this.tone(180, 0.18, 'sawtooth', 0.35, 90); }
  pad() { this.tone(210, 0.22, 'sine', 0.5, 880); }
  hurt() { this.tone(160, 0.3, 'sawtooth', 0.4, 60); }
  over() {
    this.tone(300, 0.5, 'sine', 0.4, 80);
    setTimeout(() => this.tone(150, 0.7, 'sine', 0.3, 50), 120);
  }
  start() { this.tone(440, 0.1, 'square', 0.25, 660); setTimeout(() => this.tone(660, 0.14, 'square', 0.22, 880), 90); }
}

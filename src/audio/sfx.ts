/** No samples: a clink is a few inharmonic sine partials with fast decays, like a struck metal disc. */
class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private muted = false;
  private hidden = false;
  private lastClink = 0;

  /** Must be called from a user gesture (browsers block autoplay). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state !== 'running' && !this.hidden) this.ctx.resume().catch(() => {});
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(comp).connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 1.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Silent while the page is in the background; iOS may need the next tap to resume. */
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    if (!this.ctx) return;
    (hidden ? this.ctx.suspend() : this.ctx.resume()).catch(() => {});
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  private live(): { ctx: AudioContext; master: GainNode } | null {
    if (!this.ctx || !this.master || this.muted || this.ctx.state !== 'running') return null;
    return { ctx: this.ctx, master: this.master };
  }

  /** A coin hitting felt/metal. size 0..1 (bigger = lower), vel 0..1. */
  clink(size = 0.5, vel = 0.8, delay = 0) {
    const a = this.live();
    if (!a) return;
    const { ctx, master } = a;
    const now = ctx.currentTime + delay;
    // Avoid machine-gun stacking when many coins land at once.
    if (delay === 0 && now - this.lastClink < 0.025) return;
    this.lastClink = now;
    const f0 = 2300 - size * 1100 + (Math.random() - 0.5) * 120;
    const partials = [1, 1.52, 2.76, 3.93, 5.4];
    const out = ctx.createGain();
    out.gain.value = 0.16 * vel;
    out.connect(master);
    partials.forEach((p, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f0 * p;
      const decay = (0.55 - i * 0.08) * (0.7 + size * 0.6);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(1 / (i + 1.3), now + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.06, decay));
      o.connect(g).connect(out);
      o.start(now);
      o.stop(now + decay + 0.05);
    });
    this.noise(now, 0.03, 6000, 0.08 * vel, 1.5);
  }

  tick(pitch = 1) {
    const a = this.live();
    if (!a) return;
    const { ctx, master } = a;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1400 * pitch, now);
    o.frequency.exponentialRampToValueAtTime(900 * pitch, now + 0.05);
    g.gain.setValueAtTime(0.05, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    o.connect(g).connect(master);
    o.start(now);
    o.stop(now + 0.08);
  }

  whoosh(dur = 0.6, gain = 0.12) {
    const a = this.live();
    if (!a) return;
    const { ctx, master } = a;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(400, now);
    bp.frequency.exponentialRampToValueAtTime(2600, now + dur * 0.6);
    bp.frequency.exponentialRampToValueAtTime(900, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(bp).connect(g).connect(master);
    src.start(now);
    src.stop(now + dur + 0.05);
  }

  forge(dur = 1.1) {
    const a = this.live();
    if (!a) return;
    const { ctx, master } = a;
    const now = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.14, now + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(300, now);
    lp.frequency.exponentialRampToValueAtTime(2400, now + dur);
    [55, 82.4, 110.2].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'sawtooth';
      o.frequency.setValueAtTime(f, now);
      o.frequency.exponentialRampToValueAtTime(f * 2, now + dur);
      o.connect(lp);
      o.start(now);
      o.stop(now + dur + 0.5);
    });
    lp.connect(g).connect(master);
  }

  chime() {
    const a = this.live();
    if (!a) return;
    const { ctx, master } = a;
    const now = ctx.currentTime;
    [659.25, 987.77, 1318.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = now + i * 0.09;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 1.3);
    });
  }

  deny() {
    const a = this.live();
    if (!a) return;
    const { ctx, master } = a;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(180, now);
    o.frequency.exponentialRampToValueAtTime(110, now + 0.18);
    g.gain.setValueAtTime(0.16, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    o.connect(g).connect(master);
    o.start(now);
    o.stop(now + 0.25);
  }

  shift(up: boolean) {
    const a = this.live();
    if (!a) return;
    const { ctx, master } = a;
    this.whoosh(0.7, 0.07);
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(up ? 330 : 660, now);
    o.frequency.exponentialRampToValueAtTime(up ? 660 : 330, now + 0.5);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.06, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    o.connect(g).connect(master);
    o.start(now);
    o.stop(now + 0.65);
  }

  private noise(at: number, dur: number, freq: number, gain: number, q: number) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(at, Math.random());
    src.stop(at + dur + 0.02);
  }
}

export const sfx = new Sfx();

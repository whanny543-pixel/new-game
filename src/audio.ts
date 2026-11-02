// Tiny synthesized sound effects — no audio files to ship or license.

type Wave = OscillatorType;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastPlayed = new Map<string, number>();
  muted = false;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.35;
  }

  /** Rate-limit identical sounds so 30 simultaneous hits don't clip. */
  private gate(key: string, minGap: number) {
    if (!this.ctx || this.muted) return false;
    const now = this.ctx.currentTime;
    if (now - (this.lastPlayed.get(key) ?? -1) < minGap) return false;
    this.lastPlayed.set(key, now);
    return true;
  }

  private tone(freq: number, dur: number, type: Wave, vol: number, slideTo?: number, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, lowpass: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpass;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master!);
    src.start();
  }

  shoot() {
    if (this.gate('shoot', 0.06)) this.tone(880, 0.07, 'square', 0.05, 440);
  }
  turret() {
    if (this.gate('turret', 0.08)) this.tone(620, 0.09, 'sawtooth', 0.035, 260);
  }
  hit() {
    if (this.gate('hit', 0.05)) this.tone(200, 0.06, 'triangle', 0.08, 90);
  }
  pop() {
    if (this.gate('pop', 0.04)) this.noise(0.12, 0.25, 1800);
  }
  /** Pickup pitch climbs with combo — the "ka-ching" streak feeling. */
  pickup(combo: number) {
    if (this.gate('pickup', 0.03)) this.tone(660 * Math.pow(1.03, Math.min(combo, 40)), 0.08, 'sine', 0.12);
  }
  pay(progress: number) {
    if (this.gate('pay', 0.045)) this.tone(400 + progress * 500, 0.05, 'triangle', 0.07);
  }
  build() {
    if (!this.gate('build', 0.1)) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.14, undefined, i * 0.07));
  }
  hurt() {
    if (this.gate('hurt', 0.15)) this.tone(160, 0.18, 'sawtooth', 0.12, 70);
  }
  boss() {
    if (!this.gate('boss', 1)) return;
    this.tone(90, 0.8, 'sawtooth', 0.18, 45);
    this.noise(0.6, 0.3, 500);
  }
  wave() {
    if (!this.gate('wave', 0.5)) return;
    [392, 523].forEach((f, i) => this.tone(f, 0.25, 'square', 0.06, undefined, i * 0.12));
  }
  boom() {
    if (this.gate('boom', 0.2)) this.noise(0.9, 0.6, 700);
  }
}
